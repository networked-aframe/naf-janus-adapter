# Securing janus with JWT

You'll find in this document some notes on how to secure the access to the rooms with JWT in a Phoenix/Elixir app. This is not a full tutorial, some Elixir code is missing (creating a room table, graphql mutation to create a room and query to get the token for example). I wrote this documentation while implementing it in my app. -- Vincent Fretin

## janus side

Generate a private/public key:

    ssh-keygen -t rsa -b 2048 -f key.pem -N '' -m pem
    openssl rsa -in key.pem -outform PEM -pubout -out public.pem
    openssl rsa -in key.pem -outform DER -out key.der
    openssl rsa -in key.der -inform DER -RSAPublicKey_out -outform DER -out public.der

Janus side in `janus.plugin.sfu.cfg`, specify `auth_key` to the public key in DER format

    auth_key = /path/to/public.der

## backend side

The backend is a simple [Phoenix](https://phoenixframework.org/)/[Elixir](https://elixir-lang.org) app with [phx_gen_auth](https://github.com/aaronrenner/phx_gen_auth) with a room table associated to the user table.
[Absinthe](https://absinthe-graphql.org) is used to have a graphql endpoint to create a room and to get the JWT for the room. This code is not available. I describe the changes I made from here.

Add guardian dependency to `mix.exs`:

    {:guardian, "~> 2.0"},
 
Execute:

    mix deps.get

This will add those new dependencies:

    guardian 2.1.1
    jose 1.11.1

create `lib/myapp_web/perms_token.ex`
```
defmodule MyAppWeb.PermsToken do
  @moduledoc """
  generate token for creator of the room "123":
  MyAppWeb.PermsToken.token_for_perms(%{user_id: 1, kick_users: true, join_hub: true, room_ids: ["123"]})
  generate token for another authenticated participant for room "123":
  MyAppWeb.PermsToken.token_for_perms(%{user_id: 2, kick_users: false, join_hub: true, room_ids: ["123"]}})
  generate token for anonymous:
  MyAppWeb.PermsToken.token_for_perms(%{kick_users: false, join_hub: true, room_ids: ["123"]}})

  """
  use Guardian, otp_app: :myapp, secret_fetcher: MyAppWeb.PermsTokenSecretFetcher, allowed_algos: ["RS512"]

  def subject_for_token(_resource, %{"user_id" => user_id}) do
    {:ok, to_string(user_id)}
  end

  def subject_for_token(_resource, _claims) do
    {:ok, "anon"}
  end

  # we don't use the inverse
  def resource_from_claims(_), do: nil

  def token_for_perms(perms) do
    {:ok, token, _claims} =
      MyAppWeb.PermsToken.encode_and_sign(
        # PermsTokens do not have a resource associated with them
        nil,
        perms |> Map.put(:aud, :webrtc_auth),
        ttl: {5, :minutes},
        allowed_drift: 60 * 1000
      )
    token
  end
end

defmodule MyAppWeb.PermsTokenSecretFetcher do
  def fetch_signing_secret(mod, _opts) do
    {:ok, Application.get_env(:myapp, mod)[:perms_key] |> JOSE.JWK.from_pem_file()}
  end

  def fetch_verifying_secret(mod, _token_headers, _opts) do
    {:ok, Application.get_env(:myapp, mod)[:perms_key] |> JOSE.JWK.from_pem_file()}
  end
end
```

Start the backend with the environment variable pointing to the private key in PEM format:

    AUTH_KEY_PRIVATE=/path/to/key.pem mix phx.server

in `config/config.exs` (for development)

    config :myapp, MyAppWeb.PermsToken, perms_key: System.get_env("AUTH_KEY_PRIVATE")

in `config/releases.exs` or `config/runtime.exs` (for production):

    config :meetingrooms, MyAppWeb.PermsToken, perms_key: System.get_env("AUTH_KEY_PRIVATE") ||
    raise """
    environment variable AUTH_KEY_PRIVATE is missing.
    """

Do your security logic and generate a token like this for example:

    MyAppWeb.PermsToken.token_for_perms(
      %{user_id: user.id, kick_users: user.id == room.user_id, join_hub: true, room_ids: [room.slug]})

See what the different claims mean in the [janus-plugin-sfu api documentation](https://github.com/mozilla/janus-plugin-sfu/pull/86/files).

Send the generated token to the frontend via graphql, a REST api or websocket. The `callSomeAPItoGetTheToken` function below is for example a fetch request to get the token for a room if the user is allowed to access the room.

# frontend side

On the frontend side, get the JWT for the room and set it with `setJoinToken`.
In the `adapter-ready` listener:

    const permsToken = await callSomeAPItoGetTheToken();
    adapter.setJoinToken(permsToken);

The room should now be secure.

But wait, this is not enough.
The JWT is valid here 5 minutes. If participant A joins the room and participant B joins the room 5 minutes later, B will hear A, but A won't hear B because A couldn't subscribe to B's audio because of an expired token (`addOccupant/createSubscriber` called after receiving a `join` event in naf-janus-adapter). You will get in janus logs 
```
[WARN] Rejecting join from 0x7fb91400fc50 to room my-room as user 3196610745608672. Error: ExpiredSignature
```

You need to renew the JWT regularly, like every 4 minutes, you can hard code the 4 minutes in the code below (`const nextRefresh = 4 * 60 * 1000;`) or check the `exp` in the JWT with [jwt-decode](https://www.npmjs.com/package/jwt-decode) and subtract a margin like 1 min (in case you change the ttl of the JWT in your backend later) . Here is an example:
```
import jwt_decode from "jwt-decode";

const refreshPermsToken = async () => {
  const permsToken = await callSomeAPItoGetTheToken();
  NAF.connection.adapter.setJoinToken(permsToken);
  delayedRefreshPermsToken(permsToken);
}

const delayedRefreshPermsToken = (permsToken) => {
  // This doesn't validate the token
  const decoded = jwt_decode(permsToken);
  // Refresh the token 1 minute before it expires.
  const nextRefresh = new Date(decoded.exp * 1000 - 60 * 1000) - new Date();
  setTimeout(async () => {
    if (!NAF.connection.adapter) {
      // we disconnected
      return;
    }
    await refreshPermsToken();
  }, nextRefresh);
}
document.addEventListener('DOMContentLoaded', () => {
  const scene = document.querySelector('a-scene');
  scene.addEventListener('adapter-ready', async ({ detail: adapter }) => {
    const clientId = getYourClientId();
    adapter.setClientId(clientId);
    const permsToken = await callSomeAPItoGetTheToken();
    adapter.setJoinToken(permsToken);
    delayedRefreshPermsToken(permsToken);
    // do your thing with getUserMedia and adapter.setLocalMediaStream
  });
});
```

Now you have a full working solution.
