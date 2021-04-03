Example on ubuntu 18.04, you need to build libwebsocket libsrtp libnice usrsctp janus-gateway janus-plugin-sfu
Please use latest versions if possible to have the latest security patches, this doc won't necessary be updated.

```
apt-get -y update && apt-get install -y libmicrohttpd-dev \
    libjansson-dev \
    libnice-dev \
    libssl-dev \
    libsrtp-dev \
    libglib2.0-dev \
    libopus-dev \
    libogg-dev \
    libconfig-dev \
    libssl-dev \
    pkg-config \
    gengetopt \
    libtool \
    automake \
    build-essential \
    subversion \
    git \
    cmake \
    unzip \
    zip \
    cargo \
    wget \
    sudo

LIBWEBSOCKET="3.2.3" && wget https://github.com/warmcat/libwebsockets/archive/v$LIBWEBSOCKET.tar.gz && \
tar xzvf v$LIBWEBSOCKET.tar.gz && \
cd libwebsockets-$LIBWEBSOCKET && \
mkdir build && \
cd build && \
cmake -DLWS_MAX_SMP=1 -DLWS_WITHOUT_EXTENSIONS=0 -DCMAKE_INSTALL_PREFIX:PATH=/usr -DCMAKE_C_FLAGS="-fpic" .. && \
make && make install

SRTP="2.3.0" && apt-get remove -y libsrtp0-dev libsrtp0 && wget https://github.com/cisco/libsrtp/archive/v$SRTP.tar.gz && \
tar xfv v$SRTP.tar.gz && \
cd libsrtp-$SRTP && \
./configure --prefix=/usr --enable-openssl && \
make shared_library && sudo make install

# libnice 2021-02-21 11:10 (post 0.1.18)
apt-get -y --no-install-recommends install \
    ninja-build \
    python3 \
    python3-pip \
    python3-setuptools \
    python3-wheel && \
apt-get remove -y libnice-dev libnice10 && \
apt-get install -y gtk-doc-tools libgnutls28-dev && \
pip3 install meson && \
git clone https://gitlab.freedesktop.org/libnice/libnice && \
cd libnice && \
git checkout 36aa468c4916cfccd4363f0e27af19f2aeae8604 && \
meson --prefix=/usr build && \
ninja -C build && \
ninja -C build install

# datachannel build
# Jan 13, 2021 0.9.5.0 07f871bda23943c43c9e74cc54f25130459de830
cd /tmp && git clone https://github.com/sctplab/usrsctp.git && cd /usrsctp && \
git checkout 0.9.5.0 && \
./bootstrap && \
./configure --prefix=/usr --disable-programs --disable-inet --disable-inet6 && \
make && make install

# 2021-02-23 14:57 caaba91081ba8e5578a24bca1495a8572f08e65c (post v0.10.10)
cd /tmp && git clone https://github.com/meetecho/janus-gateway.git && cd /tmp/janus-gateway && \
git checkout caaba91081ba8e5578a24bca1495a8572f08e65c && \
sh autogen.sh &&  \
CFLAGS="${CFLAGS} -fno-omit-frame-pointer" ./configure --prefix=/usr \
--disable-all-plugins --disable-all-handlers && \
make && make install && make configs

cd /tmp && git clone -b master https://github.com/mozilla/janus-plugin-sfu.git && cd /tmp/janus-plugin-sfu && \
cargo build --release && \
mkdir -p "/usr/lib/janus/plugins" && \
mkdir -p "/usr/lib/janus/events" && \
cp /tmp/janus-plugin-sfu/target/release/libjanus_plugin_sfu.so "/usr/lib/janus/plugins"
```

You  need to open the rtp port range (UDP) on your server firewall.
You may configure the port range explicitly in janus.jcfg (keep the original but change these values)

```
general: {
  session_timeout = 38
  debug_level = 4  # use 5 to have more logs
  debug_timestamps = true
  admin_secret = "CHANGE_IT"
}
media: {
  rtp_port_range = "51610-65535"
}
nat: {
  nice_debug = false  # set it to true to have more logs
  ignore_mdns = true
  nat_1_1_mapping = YOUR_PUBLIC_IP
}
transports: {
  disable = "libjanus_pfunix.so"
}
```

janus.transport.websockets.jcfg (these values only)
```
general: {
  json = "indented"
  ws = true
  ws_port = 8188
  wss = false
}

admin: {
  admin_ws = false
  admin_ws_port = 7188
  admin_wss = false
}

certificates: {
}
```

and allow the UDP 51610-65535 on your server's firewall.

If you want to start janus as a systemd service, look at https://github.com/meetecho/janus-gateway/pull/2591#issuecomment-812480322


Example of nginx conf:
```
server {
  listen      [::]:80;
  listen      80;
  server_name preprod.example.com;
  # allow letsencrypt
  location ~ /\.well-known {
    allow all;
    root /var/www/webroot;
    try_files $uri $uri/ =404;
  }
  return 301 https://preprod.example.com$request_uri;
}

server {
  listen      [::]:443 ssl http2;
  listen      443 ssl http2;
  server_name preprod.example.com;
  keepalive_timeout   70;
  root /home/user/vr/public;
  # allow letsencrypt
  location ~ /\.well-known {
    allow all;
    root /var/www/webroot;
    try_files $uri $uri/ =404;
  }
  location /janus {
    proxy_pass http://127.0.0.1:8188;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
  }
  location / {
    root /home/user/vr/public;
  }
  ssl_certificate /etc/letsencrypt/live/preprod.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/preprod.example.com/privkey.pem;
  ssl_session_timeout 1d;
  ssl_session_cache shared:MozSSL:10m;  # about 40000 sessions
  ssl_session_tickets off;  # curl https://ssl-config.mozilla.org/ffdhe2048.txt > /etc/nginx/dhparam.pem
  ssl_dhparam /etc/nginx/dhparam.pem;  # see https://ssl-config.mozilla.org/#server=nginx&server-version=1.14.0&config=intermediate
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
  ssl_prefer_server_ciphers off;  # HSTS (ngx_http_headers_module is required) (15768000 seconds = 6 months)
  add_header Strict-Transport-Security max-age=15768000;  ssl_stapling on;
  ssl_stapling_verify on;
  ssl_trusted_certificate /etc/letsencrypt/live/preprod.example.com/chain.pem;
  resolver 8.8.8.8 8.8.4.4;
}
```

Generate letsencrypt certificate
```
mkdir -p /var/www/webroot
certbot certonly --deploy-hook "nginx -s reload" --webroot -w /var/www/webroot -d preprod.example.com
```
