/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ "./node_modules/@networked-aframe/minijanus/minijanus.js":
/*!***************************************************************!*\
  !*** ./node_modules/@networked-aframe/minijanus/minijanus.js ***!
  \***************************************************************/
/***/ ((module) => {

/**
 * Represents a handle to a single Janus plugin on a Janus session. Each WebRTC connection to the Janus server will be
 * associated with a single handle. Once attached to the server, this handle will be given a unique ID which should be
 * used to associate it with future signalling messages.
 *
 * See https://janus.conf.meetecho.com/docs/rest.html#handles.
 **/
function JanusPluginHandle(session) {
  this.session = session;
  this.id = undefined;
}

/** Attaches this handle to the Janus server and sets its ID. **/
JanusPluginHandle.prototype.attach = function(plugin, loop_index) {
  var payload = { plugin: plugin, loop_index: loop_index, "force-bundle": true, "force-rtcp-mux": true };
  return this.session.send("attach", payload).then(resp => {
    this.id = resp.data.id;
    return resp;
  });
};

/** Detaches this handle. **/
JanusPluginHandle.prototype.detach = function() {
  return this.send("detach");
};

/** Registers a callback to be fired upon the reception of any incoming Janus signals for this plugin handle with the
 * `janus` attribute equal to `ev`.
 **/
JanusPluginHandle.prototype.on = function(ev, callback) {
  return this.session.on(ev, signal => {
    if (signal.sender == this.id) {
      callback(signal);
    }
  });
};

/**
 * Sends a signal associated with this handle. Signals should be JSON-serializable objects. Returns a promise that will
 * be resolved or rejected when a response to this signal is received, or when no response is received within the
 * session timeout.
 **/
JanusPluginHandle.prototype.send = function(type, signal) {
  return this.session.send(type, Object.assign({ handle_id: this.id }, signal));
};

/** Sends a plugin-specific message associated with this handle. **/
JanusPluginHandle.prototype.sendMessage = function(body) {
  return this.send("message", { body: body });
};

/** Sends a JSEP offer or answer associated with this handle. **/
JanusPluginHandle.prototype.sendJsep = function(jsep) {
  return this.send("message", { body: {}, jsep: jsep });
};

/** Sends an ICE trickle candidate associated with this handle. **/
JanusPluginHandle.prototype.sendTrickle = function(candidate) {
  return this.send("trickle", { candidate: candidate });
};

/**
 * Represents a Janus session -- a Janus context from within which you can open multiple handles and connections. Once
 * created, this session will be given a unique ID which should be used to associate it with future signalling messages.
 *
 * See https://janus.conf.meetecho.com/docs/rest.html#sessions.
 **/
function JanusSession(output, options) {
  this.output = output;
  this.id = undefined;
  this.nextTxId = 0;
  this.txns = {};
  this.eventHandlers = {};
  this.options = Object.assign({
    verbose: false,
    timeoutMs: 10000,
    keepaliveMs: 30000
  }, options);
}

/** Creates this session on the Janus server and sets its ID. **/
JanusSession.prototype.create = function() {
  return this.send("create").then(resp => {
    this.id = resp.data.id;
    return resp;
  });
};

/**
 * Destroys this session. Note that upon destruction, Janus will also close the signalling transport (if applicable) and
 * any open WebRTC connections.
 **/
JanusSession.prototype.destroy = function() {
  return this.send("destroy").then((resp) => {
    this.dispose();
    return resp;
  });
};

/**
 * Disposes of this session in a way such that no further incoming signalling messages will be processed.
 * Outstanding transactions will be rejected.
 **/
JanusSession.prototype.dispose = function() {
  this._killKeepalive();
  this.eventHandlers = {};
  for (var txId in this.txns) {
    if (this.txns.hasOwnProperty(txId)) {
      var txn = this.txns[txId];
      clearTimeout(txn.timeout);
      txn.reject(new Error("Janus session was disposed."));
      delete this.txns[txId];
    }
  }
};

/**
 * Whether this signal represents an error, and the associated promise (if any) should be rejected.
 * Users should override this to handle any custom plugin-specific error conventions.
 **/
JanusSession.prototype.isError = function(signal) {
  return signal.janus === "error";
};

/** Registers a callback to be fired upon the reception of any incoming Janus signals for this session with the
 * `janus` attribute equal to `ev`.
 **/
JanusSession.prototype.on = function(ev, callback) {
  var handlers = this.eventHandlers[ev];
  if (handlers == null) {
    handlers = this.eventHandlers[ev] = [];
  }
  handlers.push(callback);
};

/**
 * Callback for receiving JSON signalling messages pertinent to this session. If the signals are responses to previously
 * sent signals, the promises for the outgoing signals will be resolved or rejected appropriately with this signal as an
 * argument.
 *
 * External callers should call this function every time a new signal arrives on the transport; for example, in a
 * WebSocket's `message` event, or when a new datum shows up in an HTTP long-polling response.
 **/
JanusSession.prototype.receive = function(signal) {
  if (this.options.verbose) {
    this._logIncoming(signal);
  }
  if (signal.session_id != this.id) {
    console.warn("Incorrect session ID received in Janus signalling message: was " + signal.session_id + ", expected " + this.id + ".");
  }

  var responseType = signal.janus;
  var handlers = this.eventHandlers[responseType];
  if (handlers != null) {
    for (var i = 0; i < handlers.length; i++) {
      handlers[i](signal);
    }
  }

  if (signal.transaction != null) {
    var txn = this.txns[signal.transaction];
    if (txn == null) {
      // this is a response to a transaction that wasn't caused via JanusSession.send, or a plugin replied twice to a
      // single request, or the session was disposed, or something else that isn't under our purview; that's fine
      return;
    }

    if (responseType === "ack" && txn.type == "message") {
      // this is an ack of an asynchronously-processed plugin request, we should wait to resolve the promise until the
      // actual response comes in
      return;
    }

    clearTimeout(txn.timeout);

    delete this.txns[signal.transaction];
    (this.isError(signal) ? txn.reject : txn.resolve)(signal);
  }
};

/**
 * Sends a signal associated with this session, beginning a new transaction. Returns a promise that will be resolved or
 * rejected when a response is received in the same transaction, or when no response is received within the session
 * timeout.
 **/
JanusSession.prototype.send = function(type, signal) {
  signal = Object.assign({ transaction: (this.nextTxId++).toString() }, signal);
  return new Promise((resolve, reject) => {
    var timeout = null;
    if (this.options.timeoutMs) {
      timeout = setTimeout(() => {
        delete this.txns[signal.transaction];
        reject(new Error("Signalling transaction with txid " + signal.transaction + " timed out."));
      }, this.options.timeoutMs);
    }
    this.txns[signal.transaction] = { resolve: resolve, reject: reject, timeout: timeout, type: type };
    this._transmit(type, signal);
  });
};

JanusSession.prototype._transmit = function(type, signal) {
  signal = Object.assign({ janus: type }, signal);

  if (this.id != null) { // this.id is undefined in the special case when we're sending the session create message
    signal = Object.assign({ session_id: this.id }, signal);
  }

  if (this.options.verbose) {
    this._logOutgoing(signal);
  }

  this.output(JSON.stringify(signal));
  this._resetKeepalive();
};

JanusSession.prototype._logOutgoing = function(signal) {
  var kind = signal.janus;
  if (kind === "message" && signal.jsep) {
    kind = signal.jsep.type;
  }
  var message = "> Outgoing Janus " + (kind || "signal") + " (#" + signal.transaction + "): ";
  console.debug("%c" + message, "color: #040", signal);
};

JanusSession.prototype._logIncoming = function(signal) {
  var kind = signal.janus;
  var message = signal.transaction ?
      "< Incoming Janus " + (kind || "signal") + " (#" + signal.transaction + "): " :
      "< Incoming Janus " + (kind || "signal") + ": ";
  console.debug("%c" + message, "color: #004", signal);
};

JanusSession.prototype._sendKeepalive = function() {
  return this.send("keepalive");
};

JanusSession.prototype._killKeepalive = function() {
  clearTimeout(this.keepaliveTimeout);
};

JanusSession.prototype._resetKeepalive = function() {
  this._killKeepalive();
  if (this.options.keepaliveMs) {
    this.keepaliveTimeout = setTimeout(() => {
      this._sendKeepalive().catch(e => console.error("Error received from keepalive: ", e));
    }, this.options.keepaliveMs);
  }
};

module.exports = {
  JanusPluginHandle,
  JanusSession
};


/***/ }),

/***/ "./src/index.js":
/*!**********************!*\
  !*** ./src/index.js ***!
  \**********************/
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

/* global NAF */
var mj = __webpack_require__(/*! @networked-aframe/minijanus */ "./node_modules/@networked-aframe/minijanus/minijanus.js");
mj.JanusSession.prototype.sendOriginal = mj.JanusSession.prototype.send;
mj.JanusSession.prototype.send = function (type, signal) {
  return this.sendOriginal(type, signal).catch(e => {
    if (e.message && e.message.indexOf("timed out") > -1) {
      console.error("web socket timed out");
      NAF.connection.adapter.reconnect();
    } else {
      throw e;
    }
  });
};
var sdpUtils = __webpack_require__(/*! sdp */ "./node_modules/sdp/sdp.js");
//var debug = require("debug")("naf-janus-adapter:debug");
//var warn = require("debug")("naf-janus-adapter:warn");
//var error = require("debug")("naf-janus-adapter:error");
var debug = console.log;
var warn = console.warn;
var error = console.error;
var isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
const SUBSCRIBE_TIMEOUT_MS = 15000;
function debounce(fn) {
  var curr = Promise.resolve();
  return function () {
    var args = Array.prototype.slice.call(arguments);
    curr = curr.then(_ => fn.apply(this, args));
  };
}
function randomUint() {
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
}
function untilDataChannelOpen(dataChannel) {
  return new Promise((resolve, reject) => {
    if (dataChannel.readyState === "open") {
      resolve();
    } else {
      let resolver, rejector;
      const clear = () => {
        dataChannel.removeEventListener("open", resolver);
        dataChannel.removeEventListener("error", rejector);
      };
      resolver = () => {
        clear();
        resolve();
      };
      rejector = () => {
        clear();
        reject();
      };
      dataChannel.addEventListener("open", resolver);
      dataChannel.addEventListener("error", rejector);
    }
  });
}
const isH264VideoSupported = (() => {
  const video = document.createElement("video");
  return video.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"') !== "";
})();
const OPUS_PARAMETERS = {
  // indicates that we want to enable DTX to elide silence packets
  usedtx: 1,
  // indicates that we prefer to receive mono audio (important for voip profile)
  stereo: 0,
  // indicates that we prefer to send mono audio (important for voip profile)
  "sprop-stereo": 0
};
const DEFAULT_PEER_CONNECTION_CONFIG = {
  iceServers: [{
    urls: "stun:stun1.l.google.com:19302"
  }, {
    urls: "stun:stun2.l.google.com:19302"
  }]
};
const WS_NORMAL_CLOSURE = 1000;
class JanusAdapter {
  constructor() {
    this.room = null;
    // We expect the consumer to set a client id before connecting.
    this.clientId = null;
    this.joinToken = null;
    this.serverUrl = null;
    this.webRtcOptions = {};
    this.peerConnectionConfig = null;
    this.ws = null;
    this.session = null;
    this.reliableTransport = "datachannel";
    this.unreliableTransport = "datachannel";

    // In the event the server restarts and all clients lose connection, reconnect with
    // some random jitter added to prevent simultaneous reconnection requests.
    this.initialReconnectionDelay = 1000 * Math.random();
    this.reconnectionDelay = this.initialReconnectionDelay;
    this.reconnectionTimeout = null;
    this.maxReconnectionAttempts = 10;
    this.reconnectionAttempts = 0;
    this.isReconnecting = false;
    this.publisher = null;
    this.occupants = {};
    this.leftOccupants = new Set();
    this.mediaStreams = {};
    this.localMediaStream = null;
    this.pendingMediaRequests = new Map();
    this.blockedClients = new Map();
    this.frozenUpdates = new Map();
    this.timeOffsets = [];
    this.serverTimeRequests = 0;
    this.avgTimeOffset = 0;
    this.onWebsocketOpen = this.onWebsocketOpen.bind(this);
    this.onWebsocketClose = this.onWebsocketClose.bind(this);
    this.onWebsocketMessage = this.onWebsocketMessage.bind(this);
    this.onDataChannelMessage = this.onDataChannelMessage.bind(this);
    this.onData = this.onData.bind(this);
  }
  setServerUrl(url) {
    this.serverUrl = url;
  }
  setApp(app) {}
  setRoom(roomName) {
    this.room = roomName;
  }
  setJoinToken(joinToken) {
    this.joinToken = joinToken;
  }
  setClientId(clientId) {
    this.clientId = clientId;
  }
  setWebRtcOptions(options) {
    this.webRtcOptions = options;
  }
  setPeerConnectionConfig(peerConnectionConfig) {
    this.peerConnectionConfig = peerConnectionConfig;
  }
  setServerConnectListeners(successListener, failureListener) {
    this.connectSuccess = successListener;
    this.connectFailure = failureListener;
  }
  setRoomOccupantListener(occupantListener) {
    this.onOccupantsChanged = occupantListener;
  }
  setDataChannelListeners(openListener, closedListener, messageListener) {
    this.onOccupantConnected = openListener;
    this.onOccupantDisconnected = closedListener;
    this.onOccupantMessage = messageListener;
  }
  setReconnectionListeners(reconnectingListener, reconnectedListener, reconnectionErrorListener) {
    // onReconnecting is called with the number of milliseconds until the next reconnection attempt
    this.onReconnecting = reconnectingListener;
    // onReconnected is called when the connection has been reestablished
    this.onReconnected = reconnectedListener;
    // onReconnectionError is called with an error when maxReconnectionAttempts has been reached
    this.onReconnectionError = reconnectionErrorListener;
  }
  setEventLoops(loops) {
    this.loops = loops;
  }
  connect() {
    if (this.serverUrl === '/') {
      this.serverUrl = '/janus';
    }
    if (this.serverUrl === '/janus') {
      if (location.protocol === 'https:') {
        this.serverUrl = 'wss://' + location.host + '/janus';
      } else {
        this.serverUrl = 'ws://' + location.host + '/janus';
      }
    }
    debug(`connecting to ${this.serverUrl}`);
    const websocketConnection = new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.serverUrl, "janus-protocol");
      this.session = new mj.JanusSession(this.ws.send.bind(this.ws), {
        timeoutMs: 40000
      });
      this.websocketConnectionPromise = {};
      this.websocketConnectionPromise.resolve = resolve;
      this.websocketConnectionPromise.reject = reject;
      this.ws.addEventListener("close", this.onWebsocketClose);
      this.ws.addEventListener("message", this.onWebsocketMessage);
      this.wsOnOpen = () => {
        this.ws.removeEventListener("open", this.wsOnOpen);
        this.onWebsocketOpen().then(resolve).catch(reject);
      };
      this.ws.addEventListener("open", this.wsOnOpen);
    });
    return Promise.all([websocketConnection, this.updateTimeOffset()]);
  }
  disconnect() {
    debug(`disconnecting`);
    clearTimeout(this.reconnectionTimeout);
    this.removeAllOccupants();
    this.leftOccupants = new Set();
    if (this.publisher) {
      // Close the publisher peer connection. Which also detaches the plugin handle.
      this.publisher.conn.close();
      this.publisher = null;
    }
    if (this.session) {
      this.session.dispose();
      this.session = null;
    }
    if (this.ws) {
      this.ws.removeEventListener("open", this.wsOnOpen);
      this.ws.removeEventListener("close", this.onWebsocketClose);
      this.ws.removeEventListener("message", this.onWebsocketMessage);
      this.ws.close();
      this.ws = null;
    }

    // Now that all RTCPeerConnection closed, be sure to not call
    // reconnect() again via performDelayedReconnect if previous
    // RTCPeerConnection was in the failed state.
    if (this.delayedReconnectTimeout) {
      clearTimeout(this.delayedReconnectTimeout);
      this.delayedReconnectTimeout = null;
    }
  }
  isDisconnected() {
    return this.ws === null;
  }
  async onWebsocketOpen() {
    // Create the Janus Session
    await this.session.create();

    // Attach the SFU Plugin and create a RTCPeerConnection for the publisher.
    // The publisher sends audio and opens two bidirectional data channels.
    // One reliable datachannel and one unreliable.
    this.publisher = await this.createPublisher();

    // Call the naf connectSuccess callback before we start receiving WebRTC messages.
    this.connectSuccess(this.clientId);
    const addOccupantPromises = [];
    for (let i = 0; i < this.publisher.initialOccupants.length; i++) {
      const occupantId = this.publisher.initialOccupants[i];
      if (occupantId === this.clientId) continue; // Happens during non-graceful reconnects due to zombie sessions
      addOccupantPromises.push(this.addOccupant(occupantId));
    }
    await Promise.all(addOccupantPromises);
  }
  onWebsocketClose(event) {
    // The connection was closed successfully. Don't try to reconnect.
    if (event.code === WS_NORMAL_CLOSURE) {
      return;
    }
    this.websocketConnectionPromise.reject(event);
    if (!this.isReconnecting) {
      this.isReconnecting = true;
      console.warn("Janus websocket closed unexpectedly.");
      if (this.onReconnecting) {
        this.onReconnecting(this.reconnectionDelay);
      }
      this.reconnectionTimeout = setTimeout(() => this.reconnect(), this.reconnectionDelay);
    }
  }
  reconnect() {
    // Dispose of all networked entities and other resources tied to the session.
    this.disconnect();
    this.connect().then(() => {
      this.reconnectionDelay = this.initialReconnectionDelay;
      this.reconnectionAttempts = 0;
      this.isReconnecting = false;
      if (this.onReconnected) {
        this.onReconnected();
      }
    }).catch(error => {
      this.reconnectionDelay += 1000;
      this.reconnectionAttempts++;
      if (this.reconnectionAttempts > this.maxReconnectionAttempts) {
        const error = new Error("Connection could not be reestablished, exceeded maximum number of reconnection attempts.");
        if (this.onReconnectionError) {
          return this.onReconnectionError(error);
        } else {
          console.warn(error);
          return;
        }
      }
      console.warn("Error during reconnect, retrying.");
      console.warn(error);
      if (this.onReconnecting) {
        this.onReconnecting(this.reconnectionDelay);
      }
      this.reconnectionTimeout = setTimeout(() => this.reconnect(), this.reconnectionDelay);
    });
  }
  performDelayedReconnect() {
    if (this.delayedReconnectTimeout) {
      clearTimeout(this.delayedReconnectTimeout);
    }
    this.delayedReconnectTimeout = setTimeout(() => {
      this.delayedReconnectTimeout = null;
      this.reconnect();
    }, 10000);
  }
  onWebsocketMessage(event) {
    this.session.receive(JSON.parse(event.data));
  }
  async addOccupant(occupantId) {
    if (this.occupants[occupantId]) {
      this.removeOccupant(occupantId);
    }
    this.leftOccupants.delete(occupantId);
    var subscriber = await this.createSubscriber(occupantId);
    if (!subscriber) return;
    this.occupants[occupantId] = subscriber;
    this.setMediaStream(occupantId, subscriber.mediaStream);

    // Call the Networked AFrame callbacks for the new occupant.
    this.onOccupantConnected(occupantId);
    this.onOccupantsChanged(this.occupants);
    return subscriber;
  }
  removeAllOccupants() {
    for (const occupantId of Object.getOwnPropertyNames(this.occupants)) {
      this.removeOccupant(occupantId);
    }
  }
  removeOccupant(occupantId) {
    this.leftOccupants.add(occupantId);
    if (this.occupants[occupantId]) {
      // Close the subscriber peer connection. Which also detaches the plugin handle.
      this.occupants[occupantId].conn.close();
      delete this.occupants[occupantId];
    }
    if (this.mediaStreams[occupantId]) {
      delete this.mediaStreams[occupantId];
    }
    if (this.pendingMediaRequests.has(occupantId)) {
      const msg = "The user disconnected before the media stream was resolved.";
      this.pendingMediaRequests.get(occupantId).audio.reject(msg);
      this.pendingMediaRequests.get(occupantId).video.reject(msg);
      this.pendingMediaRequests.delete(occupantId);
    }

    // Call the Networked AFrame callbacks for the removed occupant.
    this.onOccupantDisconnected(occupantId);
    this.onOccupantsChanged(this.occupants);
  }
  associate(conn, handle) {
    conn.addEventListener("icecandidate", ev => {
      handle.sendTrickle(ev.candidate || null).catch(e => error("Error trickling ICE: %o", e));
    });
    conn.addEventListener("iceconnectionstatechange", ev => {
      if (conn.iceConnectionState === "connected") {
        console.log("ICE state changed to connected");
      }
      if (conn.iceConnectionState === "disconnected") {
        console.warn("ICE state changed to disconnected");
      }
      if (conn.iceConnectionState === "failed") {
        console.warn("ICE failure detected. Reconnecting in 10s.");
        this.performDelayedReconnect();
      }
    });

    // we have to debounce these because janus gets angry if you send it a new SDP before
    // it's finished processing an existing SDP. in actuality, it seems like this is maybe
    // too liberal and we need to wait some amount of time after an offer before sending another,
    // but we don't currently know any good way of detecting exactly how long :(
    conn.addEventListener("negotiationneeded", debounce(ev => {
      debug("Sending new offer for handle: %o", handle);
      var offer = conn.createOffer().then(this.configurePublisherSdp).then(this.fixSafariIceUFrag);
      var local = offer.then(o => conn.setLocalDescription(o));
      var remote = offer;
      remote = remote.then(this.fixSafariIceUFrag).then(j => handle.sendJsep(j)).then(r => conn.setRemoteDescription(r.jsep));
      return Promise.all([local, remote]).catch(e => error("Error negotiating offer: %o", e));
    }));
    handle.on("event", debounce(ev => {
      var jsep = ev.jsep;
      if (jsep && jsep.type == "offer") {
        debug("Accepting new offer for handle: %o", handle);
        var answer = conn.setRemoteDescription(this.configureSubscriberSdp(jsep)).then(_ => conn.createAnswer()).then(this.fixSafariIceUFrag);
        var local = answer.then(a => conn.setLocalDescription(a));
        var remote = answer.then(j => handle.sendJsep(j));
        return Promise.all([local, remote]).catch(e => error("Error negotiating answer: %o", e));
      } else {
        // some other kind of event, nothing to do
        return null;
      }
    }));
  }
  async createPublisher() {
    var handle = new mj.JanusPluginHandle(this.session);
    var conn = new RTCPeerConnection(this.peerConnectionConfig || DEFAULT_PEER_CONNECTION_CONFIG);
    debug("pub waiting for sfu");
    await handle.attach("janus.plugin.sfu", this.loops && this.clientId ? parseInt(this.clientId) % this.loops : undefined);
    this.associate(conn, handle);
    debug("pub waiting for data channels & webrtcup");
    var webrtcup = new Promise(resolve => handle.on("webrtcup", resolve));

    // Unreliable datachannel: sending and receiving component updates.
    // Reliable datachannel: sending and recieving entity instantiations.
    var reliableChannel = conn.createDataChannel("reliable", {
      ordered: true
    });
    var unreliableChannel = conn.createDataChannel("unreliable", {
      ordered: false,
      maxRetransmits: 0
    });
    reliableChannel.addEventListener("message", e => this.onDataChannelMessage(e, "janus-reliable"));
    unreliableChannel.addEventListener("message", e => this.onDataChannelMessage(e, "janus-unreliable"));
    await webrtcup;
    await untilDataChannelOpen(reliableChannel);
    await untilDataChannelOpen(unreliableChannel);

    // doing this here is sort of a hack around chrome renegotiation weirdness --
    // if we do it prior to webrtcup, chrome on gear VR will sometimes put a
    // renegotiation offer in flight while the first offer was still being
    // processed by janus. we should find some more principled way to figure out
    // when janus is done in the future.
    if (this.localMediaStream) {
      this.localMediaStream.getTracks().forEach(track => {
        conn.addTrack(track, this.localMediaStream);
      });
    }

    // Handle all of the join and leave events.
    handle.on("event", ev => {
      var data = ev.plugindata.data;
      if (data.event == "join" && data.room_id == this.room) {
        if (this.delayedReconnectTimeout) {
          // Don't create a new RTCPeerConnection, all RTCPeerConnection will be closed in less than 10s.
          return;
        }
        this.addOccupant(data.user_id);
      } else if (data.event == "leave" && data.room_id == this.room) {
        this.removeOccupant(data.user_id);
      } else if (data.event == "blocked") {
        document.body.dispatchEvent(new CustomEvent("blocked", {
          detail: {
            clientId: data.by
          }
        }));
      } else if (data.event == "unblocked") {
        document.body.dispatchEvent(new CustomEvent("unblocked", {
          detail: {
            clientId: data.by
          }
        }));
      } else if (data.event === "data") {
        this.onData(JSON.parse(data.body), "janus-event");
      }
    });
    debug("pub waiting for join");

    // Send join message to janus. Listen for join/leave messages. Automatically subscribe to all users' WebRTC data.
    var message = await this.sendJoin(handle, {
      notifications: true,
      data: true
    });
    if (!message.plugindata.data.success) {
      const err = message.plugindata.data.error;
      console.error(err);
      // We may get here because of an expired JWT.
      // Close the connection ourself otherwise janus will close it after
      // session_timeout because we didn't send any keepalive and this will
      // trigger a delayed reconnect because of the iceconnectionstatechange
      // listener for failure state.
      // Even if the app code calls disconnect in case of error, disconnect
      // won't close the peer connection because this.publisher is not set.
      conn.close();
      throw err;
    }
    var initialOccupants = message.plugindata.data.response.users[this.room] || [];
    if (initialOccupants.includes(this.clientId)) {
      console.warn("Janus still has previous session for this client. Reconnecting in 10s.");
      this.performDelayedReconnect();
    }
    debug("publisher ready");
    return {
      handle,
      initialOccupants,
      reliableChannel,
      unreliableChannel,
      conn
    };
  }
  configurePublisherSdp(jsep) {
    jsep.sdp = jsep.sdp.replace(/a=fmtp:(109|111).*\r\n/g, (line, pt) => {
      const parameters = Object.assign(sdpUtils.parseFmtp(line), OPUS_PARAMETERS);
      return sdpUtils.writeFmtp({
        payloadType: pt,
        parameters: parameters
      });
    });
    return jsep;
  }
  configureSubscriberSdp(jsep) {
    // todo: consider cleaning up these hacks to use sdputils
    if (!isH264VideoSupported) {
      if (navigator.userAgent.indexOf("HeadlessChrome") !== -1) {
        // HeadlessChrome (e.g. puppeteer) doesn't support webrtc video streams, so we remove those lines from the SDP.
        jsep.sdp = jsep.sdp.replace(/m=video[^]*m=/, "m=");
      }
    }

    // TODO: Hack to get video working on Chrome for Android. https://groups.google.com/forum/#!topic/mozilla.dev.media/Ye29vuMTpo8
    if (navigator.userAgent.indexOf("Android") === -1) {
      jsep.sdp = jsep.sdp.replace("a=rtcp-fb:107 goog-remb\r\n", "a=rtcp-fb:107 goog-remb\r\na=rtcp-fb:107 transport-cc\r\na=fmtp:107 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f\r\n");
    } else {
      jsep.sdp = jsep.sdp.replace("a=rtcp-fb:107 goog-remb\r\n", "a=rtcp-fb:107 goog-remb\r\na=rtcp-fb:107 transport-cc\r\na=fmtp:107 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f\r\n");
    }
    return jsep;
  }
  async fixSafariIceUFrag(jsep) {
    // Safari produces a \n instead of an \r\n for the ice-ufrag. See https://github.com/meetecho/janus-gateway/issues/1818
    jsep.sdp = jsep.sdp.replace(/[^\r]\na=ice-ufrag/g, "\r\na=ice-ufrag");
    return jsep;
  }
  async createSubscriber(occupantId, maxRetries = 5) {
    if (this.leftOccupants.has(occupantId)) {
      console.warn(occupantId + ": cancelled occupant connection, occupant left before subscription negotation.");
      return null;
    }
    var handle = new mj.JanusPluginHandle(this.session);
    var conn = new RTCPeerConnection(this.peerConnectionConfig || DEFAULT_PEER_CONNECTION_CONFIG);
    debug(occupantId + ": sub waiting for sfu");
    await handle.attach("janus.plugin.sfu", this.loops ? parseInt(occupantId) % this.loops : undefined);
    this.associate(conn, handle);
    debug(occupantId + ": sub waiting for join");
    if (this.leftOccupants.has(occupantId)) {
      conn.close();
      console.warn(occupantId + ": cancelled occupant connection, occupant left after attach");
      return null;
    }
    let webrtcFailed = false;
    const webrtcup = new Promise(resolve => {
      const leftInterval = setInterval(() => {
        if (this.leftOccupants.has(occupantId)) {
          clearInterval(leftInterval);
          resolve();
        }
      }, 1000);
      const timeout = setTimeout(() => {
        clearInterval(leftInterval);
        webrtcFailed = true;
        resolve();
      }, SUBSCRIBE_TIMEOUT_MS);
      handle.on("webrtcup", () => {
        clearTimeout(timeout);
        clearInterval(leftInterval);
        resolve();
      });
    });

    // Send join message to janus. Don't listen for join/leave messages. Subscribe to the occupant's media.
    // Janus should send us an offer for this occupant's media in response to this.
    await this.sendJoin(handle, {
      media: occupantId
    });
    if (this.leftOccupants.has(occupantId)) {
      conn.close();
      console.warn(occupantId + ": cancelled occupant connection, occupant left after join");
      return null;
    }
    debug(occupantId + ": sub waiting for webrtcup");
    await webrtcup;
    if (this.leftOccupants.has(occupantId)) {
      conn.close();
      console.warn(occupantId + ": cancel occupant connection, occupant left during or after webrtcup");
      return null;
    }
    if (webrtcFailed) {
      conn.close();
      if (maxRetries > 0) {
        console.warn(occupantId + ": webrtc up timed out, retrying");
        return this.createSubscriber(occupantId, maxRetries - 1);
      } else {
        console.warn(occupantId + ": webrtc up timed out");
        return null;
      }
    }
    if (isSafari && !this._iOSHackDelayedInitialPeer) {
      // HACK: the first peer on Safari during page load can fail to work if we don't
      // wait some time before continuing here. See: https://github.com/mozilla/hubs/pull/1692
      await new Promise(resolve => setTimeout(resolve, 3000));
      this._iOSHackDelayedInitialPeer = true;
    }
    var mediaStream = new MediaStream();
    var receivers = conn.getReceivers();
    receivers.forEach(receiver => {
      if (receiver.track) {
        mediaStream.addTrack(receiver.track);
      }
    });
    if (mediaStream.getTracks().length === 0) {
      mediaStream = null;
    }
    debug(occupantId + ": subscriber ready");
    return {
      handle,
      mediaStream,
      conn
    };
  }
  sendJoin(handle, subscribe) {
    return handle.sendMessage({
      kind: "join",
      room_id: this.room,
      user_id: this.clientId,
      subscribe,
      token: this.joinToken
    });
  }
  toggleFreeze() {
    if (this.frozen) {
      this.unfreeze();
    } else {
      this.freeze();
    }
  }
  freeze() {
    this.frozen = true;
  }
  unfreeze() {
    this.frozen = false;
    this.flushPendingUpdates();
  }
  dataForUpdateMultiMessage(networkId, message) {
    // "d" is an array of entity datas, where each item in the array represents a unique entity and contains
    // metadata for the entity, and an array of components that have been updated on the entity.
    // This method finds the data corresponding to the given networkId.
    for (let i = 0, l = message.data.d.length; i < l; i++) {
      const data = message.data.d[i];
      if (data.networkId === networkId) {
        return data;
      }
    }
    return null;
  }
  getPendingData(networkId, message) {
    if (!message) return null;
    let data = message.dataType === "um" ? this.dataForUpdateMultiMessage(networkId, message) : message.data;

    // Ignore messages relating to users who have disconnected since freezing, their entities
    // will have aleady been removed by NAF.
    // Note that delete messages have no "owner" so we have to check for that as well.
    if (data.owner && !this.occupants[data.owner]) return null;

    // Ignore messages from users that we may have blocked while frozen.
    if (data.owner && this.blockedClients.has(data.owner)) return null;
    return data;
  }

  // Used externally
  getPendingDataForNetworkId(networkId) {
    return this.getPendingData(networkId, this.frozenUpdates.get(networkId));
  }
  flushPendingUpdates() {
    for (const [networkId, message] of this.frozenUpdates) {
      let data = this.getPendingData(networkId, message);
      if (!data) continue;

      // Override the data type on "um" messages types, since we extract entity updates from "um" messages into
      // individual frozenUpdates in storeSingleMessage.
      const dataType = message.dataType === "um" ? "u" : message.dataType;
      this.onOccupantMessage(null, dataType, data, message.source);
    }
    this.frozenUpdates.clear();
  }
  storeMessage(message) {
    if (message.dataType === "um") {
      // UpdateMulti
      for (let i = 0, l = message.data.d.length; i < l; i++) {
        this.storeSingleMessage(message, i);
      }
    } else {
      this.storeSingleMessage(message);
    }
  }
  storeSingleMessage(message, index) {
    const data = index !== undefined ? message.data.d[index] : message.data;
    const dataType = message.dataType;
    const source = message.source;
    const networkId = data.networkId;
    if (!this.frozenUpdates.has(networkId)) {
      this.frozenUpdates.set(networkId, message);
    } else {
      const storedMessage = this.frozenUpdates.get(networkId);
      const storedData = storedMessage.dataType === "um" ? this.dataForUpdateMultiMessage(networkId, storedMessage) : storedMessage.data;

      // Avoid updating components if the entity data received did not come from the current owner.
      const isOutdatedMessage = data.lastOwnerTime < storedData.lastOwnerTime;
      const isContemporaneousMessage = data.lastOwnerTime === storedData.lastOwnerTime;
      if (isOutdatedMessage || isContemporaneousMessage && storedData.owner > data.owner) {
        return;
      }
      if (dataType === "r") {
        const createdWhileFrozen = storedData && storedData.isFirstSync;
        if (createdWhileFrozen) {
          // If the entity was created and deleted while frozen, don't bother conveying anything to the consumer.
          this.frozenUpdates.delete(networkId);
        } else {
          // Delete messages override any other messages for this entity
          this.frozenUpdates.set(networkId, message);
        }
      } else {
        // merge in component updates
        if (storedData.components && data.components) {
          Object.assign(storedData.components, data.components);
        }
      }
    }
  }
  onDataChannelMessage(e, source) {
    this.onData(JSON.parse(e.data), source);
  }
  onData(message, source) {
    if (debug.enabled) {
      debug(`DC in: ${message}`);
    }
    if (!message.dataType) return;
    message.source = source;
    if (this.frozen) {
      this.storeMessage(message);
    } else {
      this.onOccupantMessage(null, message.dataType, message.data, message.source);
    }
  }
  shouldStartConnectionTo(client) {
    return true;
  }
  startStreamConnection(client) {}
  closeStreamConnection(client) {}
  getConnectStatus(clientId) {
    return this.occupants[clientId] ? NAF.adapters.IS_CONNECTED : NAF.adapters.NOT_CONNECTED;
  }
  async updateTimeOffset() {
    if (this.isDisconnected()) return;
    const clientSentTime = Date.now();
    const res = await fetch(document.location.href, {
      method: "HEAD",
      cache: "no-cache"
    });
    const precision = 1000;
    const serverReceivedTime = new Date(res.headers.get("Date")).getTime() + precision / 2;
    const clientReceivedTime = Date.now();
    const serverTime = serverReceivedTime + (clientReceivedTime - clientSentTime) / 2;
    const timeOffset = serverTime - clientReceivedTime;
    this.serverTimeRequests++;
    if (this.serverTimeRequests <= 10) {
      this.timeOffsets.push(timeOffset);
    } else {
      this.timeOffsets[this.serverTimeRequests % 10] = timeOffset;
    }
    this.avgTimeOffset = this.timeOffsets.reduce((acc, offset) => acc += offset, 0) / this.timeOffsets.length;
    if (this.serverTimeRequests > 10) {
      debug(`new server time offset: ${this.avgTimeOffset}ms`);
      setTimeout(() => this.updateTimeOffset(), 5 * 60 * 1000); // Sync clock every 5 minutes.
    } else {
      this.updateTimeOffset();
    }
  }
  getServerTime() {
    return Date.now() + this.avgTimeOffset;
  }
  getMediaStream(clientId, type = "audio") {
    if (this.mediaStreams[clientId]) {
      debug(`Already had ${type} for ${clientId}`);
      return Promise.resolve(this.mediaStreams[clientId][type]);
    } else {
      debug(`Waiting on ${type} for ${clientId}`);
      if (!this.pendingMediaRequests.has(clientId)) {
        this.pendingMediaRequests.set(clientId, {});
        const audioPromise = new Promise((resolve, reject) => {
          this.pendingMediaRequests.get(clientId).audio = {
            resolve,
            reject
          };
        });
        const videoPromise = new Promise((resolve, reject) => {
          this.pendingMediaRequests.get(clientId).video = {
            resolve,
            reject
          };
        });
        this.pendingMediaRequests.get(clientId).audio.promise = audioPromise;
        this.pendingMediaRequests.get(clientId).video.promise = videoPromise;
        audioPromise.catch(e => console.warn(`${clientId} getMediaStream Audio Error`, e));
        videoPromise.catch(e => console.warn(`${clientId} getMediaStream Video Error`, e));
      }
      return this.pendingMediaRequests.get(clientId)[type].promise;
    }
  }
  setMediaStream(clientId, stream) {
    // Safari doesn't like it when you use single a mixed media stream where one of the tracks is inactive, so we
    // split the tracks into two streams.
    const audioStream = new MediaStream();
    try {
      stream.getAudioTracks().forEach(track => audioStream.addTrack(track));
    } catch (e) {
      console.warn(`${clientId} setMediaStream Audio Error`, e);
    }
    const videoStream = new MediaStream();
    try {
      stream.getVideoTracks().forEach(track => videoStream.addTrack(track));
    } catch (e) {
      console.warn(`${clientId} setMediaStream Video Error`, e);
    }
    this.mediaStreams[clientId] = {
      audio: audioStream,
      video: videoStream
    };

    // Resolve the promise for the user's media stream if it exists.
    if (this.pendingMediaRequests.has(clientId)) {
      this.pendingMediaRequests.get(clientId).audio.resolve(audioStream);
      this.pendingMediaRequests.get(clientId).video.resolve(videoStream);
    }
  }
  getLocalMediaStream() {
    return this.localMediaStream;
  }
  async setLocalMediaStream(stream) {
    // our job here is to make sure the connection winds up with RTP senders sending the stuff in this stream,
    // and not the stuff that isn't in this stream. strategy is to replace existing tracks if we can, add tracks
    // that we can't replace, and disable tracks that don't exist anymore.

    // note that we don't ever remove a track from the stream -- since Janus doesn't support Unified Plan, we absolutely
    // can't wind up with a SDP that has >1 audio or >1 video tracks, even if one of them is inactive (what you get if
    // you remove a track from an existing stream.)
    if (this.publisher && this.publisher.conn) {
      const existingSenders = this.publisher.conn.getSenders();
      const newSenders = [];
      const tracks = stream.getTracks();
      for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i];
        const sender = existingSenders.find(s => s.track != null && s.track.kind == t.kind);
        if (sender != null) {
          if (sender.replaceTrack) {
            await sender.replaceTrack(t);
          } else {
            // Fallback for browsers that don't support replaceTrack. At this time of this writing
            // most browsers support it, and testing this code path seems to not work properly
            // in Chrome anymore.
            stream.removeTrack(sender.track);
            stream.addTrack(t);
          }
          newSenders.push(sender);
        } else {
          newSenders.push(this.publisher.conn.addTrack(t, stream));
        }
      }
      existingSenders.forEach(s => {
        if (!newSenders.includes(s)) {
          s.track.enabled = false;
        }
      });
    }
    this.localMediaStream = stream;
    this.setMediaStream(this.clientId, stream);
  }
  enableMicrophone(enabled) {
    if (this.publisher && this.publisher.conn) {
      this.publisher.conn.getSenders().forEach(s => {
        if (s.track.kind == "audio") {
          s.track.enabled = enabled;
        }
      });
    }
  }
  sendData(clientId, dataType, data) {
    if (!this.publisher) {
      console.warn("sendData called without a publisher");
    } else {
      switch (this.unreliableTransport) {
        case "websocket":
          if (this.ws.readyState === 1) {
            // OPEN
            this.publisher.handle.sendMessage({
              kind: "data",
              body: JSON.stringify({
                dataType,
                data
              }),
              whom: clientId
            });
          }
          break;
        case "datachannel":
          if (this.publisher.unreliableChannel.readyState === "open") {
            this.publisher.unreliableChannel.send(JSON.stringify({
              clientId,
              dataType,
              data
            }));
          }
          break;
        default:
          this.unreliableTransport(clientId, dataType, data);
          break;
      }
    }
  }
  sendDataGuaranteed(clientId, dataType, data) {
    if (!this.publisher) {
      console.warn("sendDataGuaranteed called without a publisher");
    } else {
      switch (this.reliableTransport) {
        case "websocket":
          if (this.ws.readyState === 1) {
            // OPEN
            this.publisher.handle.sendMessage({
              kind: "data",
              body: JSON.stringify({
                dataType,
                data
              }),
              whom: clientId
            });
          }
          break;
        case "datachannel":
          if (this.publisher.reliableChannel.readyState === "open") {
            this.publisher.reliableChannel.send(JSON.stringify({
              clientId,
              dataType,
              data
            }));
          }
          break;
        default:
          this.reliableTransport(clientId, dataType, data);
          break;
      }
    }
  }
  broadcastData(dataType, data) {
    if (!this.publisher) {
      console.warn("broadcastData called without a publisher");
    } else {
      switch (this.unreliableTransport) {
        case "websocket":
          if (this.ws.readyState === 1) {
            // OPEN
            this.publisher.handle.sendMessage({
              kind: "data",
              body: JSON.stringify({
                dataType,
                data
              })
            });
          }
          break;
        case "datachannel":
          if (this.publisher.unreliableChannel.readyState === "open") {
            this.publisher.unreliableChannel.send(JSON.stringify({
              dataType,
              data
            }));
          }
          break;
        default:
          this.unreliableTransport(undefined, dataType, data);
          break;
      }
    }
  }
  broadcastDataGuaranteed(dataType, data) {
    if (!this.publisher) {
      console.warn("broadcastDataGuaranteed called without a publisher");
    } else {
      switch (this.reliableTransport) {
        case "websocket":
          if (this.ws.readyState === 1) {
            // OPEN
            this.publisher.handle.sendMessage({
              kind: "data",
              body: JSON.stringify({
                dataType,
                data
              })
            });
          }
          break;
        case "datachannel":
          if (this.publisher.reliableChannel.readyState === "open") {
            this.publisher.reliableChannel.send(JSON.stringify({
              dataType,
              data
            }));
          }
          break;
        default:
          this.reliableTransport(undefined, dataType, data);
          break;
      }
    }
  }
  kick(clientId, permsToken) {
    return this.publisher.handle.sendMessage({
      kind: "kick",
      room_id: this.room,
      user_id: clientId,
      token: permsToken
    }).then(() => {
      document.body.dispatchEvent(new CustomEvent("kicked", {
        detail: {
          clientId: clientId
        }
      }));
    });
  }
  block(clientId) {
    return this.publisher.handle.sendMessage({
      kind: "block",
      whom: clientId
    }).then(() => {
      this.blockedClients.set(clientId, true);
      document.body.dispatchEvent(new CustomEvent("blocked", {
        detail: {
          clientId: clientId
        }
      }));
    });
  }
  unblock(clientId) {
    return this.publisher.handle.sendMessage({
      kind: "unblock",
      whom: clientId
    }).then(() => {
      this.blockedClients.delete(clientId);
      document.body.dispatchEvent(new CustomEvent("unblocked", {
        detail: {
          clientId: clientId
        }
      }));
    });
  }
}
NAF.adapters.register("janus", JanusAdapter);
module.exports = JanusAdapter;

/***/ }),

/***/ "./node_modules/sdp/sdp.js":
/*!*********************************!*\
  !*** ./node_modules/sdp/sdp.js ***!
  \*********************************/
/***/ ((module) => {

"use strict";
/* eslint-env node */


// SDP helpers.
const SDPUtils = {};

// Generate an alphanumeric identifier for cname or mids.
// TODO: use UUIDs instead? https://gist.github.com/jed/982883
SDPUtils.generateIdentifier = function() {
  return Math.random().toString(36).substring(2, 12);
};

// The RTCP CNAME used by all peerconnections from the same JS.
SDPUtils.localCName = SDPUtils.generateIdentifier();

// Splits SDP into lines, dealing with both CRLF and LF.
SDPUtils.splitLines = function(blob) {
  return blob.trim().split('\n').map(line => line.trim());
};
// Splits SDP into sessionpart and mediasections. Ensures CRLF.
SDPUtils.splitSections = function(blob) {
  const parts = blob.split('\nm=');
  return parts.map((part, index) => (index > 0 ?
    'm=' + part : part).trim() + '\r\n');
};

// Returns the session description.
SDPUtils.getDescription = function(blob) {
  const sections = SDPUtils.splitSections(blob);
  return sections && sections[0];
};

// Returns the individual media sections.
SDPUtils.getMediaSections = function(blob) {
  const sections = SDPUtils.splitSections(blob);
  sections.shift();
  return sections;
};

// Returns lines that start with a certain prefix.
SDPUtils.matchPrefix = function(blob, prefix) {
  return SDPUtils.splitLines(blob).filter(line => line.indexOf(prefix) === 0);
};

// Parses an ICE candidate line. Sample input:
// candidate:702786350 2 udp 41819902 8.8.8.8 60769 typ relay raddr 8.8.8.8
// rport 55996"
// Input can be prefixed with a=.
SDPUtils.parseCandidate = function(line) {
  let parts;
  // Parse both variants.
  if (line.indexOf('a=candidate:') === 0) {
    parts = line.substring(12).split(' ');
  } else {
    parts = line.substring(10).split(' ');
  }

  const candidate = {
    foundation: parts[0],
    component: {1: 'rtp', 2: 'rtcp'}[parts[1]] || parts[1],
    protocol: parts[2].toLowerCase(),
    priority: parseInt(parts[3], 10),
    ip: parts[4],
    address: parts[4], // address is an alias for ip.
    port: parseInt(parts[5], 10),
    // skip parts[6] == 'typ'
    type: parts[7],
  };

  for (let i = 8; i < parts.length; i += 2) {
    switch (parts[i]) {
      case 'raddr':
        candidate.relatedAddress = parts[i + 1];
        break;
      case 'rport':
        candidate.relatedPort = parseInt(parts[i + 1], 10);
        break;
      case 'tcptype':
        candidate.tcpType = parts[i + 1];
        break;
      case 'ufrag':
        candidate.ufrag = parts[i + 1]; // for backward compatibility.
        candidate.usernameFragment = parts[i + 1];
        break;
      default: // extension handling, in particular ufrag. Don't overwrite.
        if (candidate[parts[i]] === undefined) {
          candidate[parts[i]] = parts[i + 1];
        }
        break;
    }
  }
  return candidate;
};

// Translates a candidate object into SDP candidate attribute.
// This does not include the a= prefix!
SDPUtils.writeCandidate = function(candidate) {
  const sdp = [];
  sdp.push(candidate.foundation);

  const component = candidate.component;
  if (component === 'rtp') {
    sdp.push(1);
  } else if (component === 'rtcp') {
    sdp.push(2);
  } else {
    sdp.push(component);
  }
  sdp.push(candidate.protocol.toUpperCase());
  sdp.push(candidate.priority);
  sdp.push(candidate.address || candidate.ip);
  sdp.push(candidate.port);

  const type = candidate.type;
  sdp.push('typ');
  sdp.push(type);
  if (type !== 'host' && candidate.relatedAddress &&
      candidate.relatedPort) {
    sdp.push('raddr');
    sdp.push(candidate.relatedAddress);
    sdp.push('rport');
    sdp.push(candidate.relatedPort);
  }
  if (candidate.tcpType && candidate.protocol.toLowerCase() === 'tcp') {
    sdp.push('tcptype');
    sdp.push(candidate.tcpType);
  }
  if (candidate.usernameFragment || candidate.ufrag) {
    sdp.push('ufrag');
    sdp.push(candidate.usernameFragment || candidate.ufrag);
  }
  return 'candidate:' + sdp.join(' ');
};

// Parses an ice-options line, returns an array of option tags.
// Sample input:
// a=ice-options:foo bar
SDPUtils.parseIceOptions = function(line) {
  return line.substring(14).split(' ');
};

// Parses a rtpmap line, returns RTCRtpCoddecParameters. Sample input:
// a=rtpmap:111 opus/48000/2
SDPUtils.parseRtpMap = function(line) {
  let parts = line.substring(9).split(' ');
  const parsed = {
    payloadType: parseInt(parts.shift(), 10), // was: id
  };

  parts = parts[0].split('/');

  parsed.name = parts[0];
  parsed.clockRate = parseInt(parts[1], 10); // was: clockrate
  parsed.channels = parts.length === 3 ? parseInt(parts[2], 10) : 1;
  // legacy alias, got renamed back to channels in ORTC.
  parsed.numChannels = parsed.channels;
  return parsed;
};

// Generates a rtpmap line from RTCRtpCodecCapability or
// RTCRtpCodecParameters.
SDPUtils.writeRtpMap = function(codec) {
  let pt = codec.payloadType;
  if (codec.preferredPayloadType !== undefined) {
    pt = codec.preferredPayloadType;
  }
  const channels = codec.channels || codec.numChannels || 1;
  return 'a=rtpmap:' + pt + ' ' + codec.name + '/' + codec.clockRate +
      (channels !== 1 ? '/' + channels : '') + '\r\n';
};

// Parses a extmap line (headerextension from RFC 5285). Sample input:
// a=extmap:2 urn:ietf:params:rtp-hdrext:toffset
// a=extmap:2/sendonly urn:ietf:params:rtp-hdrext:toffset
SDPUtils.parseExtmap = function(line) {
  const parts = line.substring(9).split(' ');
  return {
    id: parseInt(parts[0], 10),
    direction: parts[0].indexOf('/') > 0 ? parts[0].split('/')[1] : 'sendrecv',
    uri: parts[1],
    attributes: parts.slice(2).join(' '),
  };
};

// Generates an extmap line from RTCRtpHeaderExtensionParameters or
// RTCRtpHeaderExtension.
SDPUtils.writeExtmap = function(headerExtension) {
  return 'a=extmap:' + (headerExtension.id || headerExtension.preferredId) +
      (headerExtension.direction && headerExtension.direction !== 'sendrecv'
        ? '/' + headerExtension.direction
        : '') +
      ' ' + headerExtension.uri +
      (headerExtension.attributes ? ' ' + headerExtension.attributes : '') +
      '\r\n';
};

// Parses a fmtp line, returns dictionary. Sample input:
// a=fmtp:96 vbr=on;cng=on
// Also deals with vbr=on; cng=on
SDPUtils.parseFmtp = function(line) {
  const parsed = {};
  let kv;
  const parts = line.substring(line.indexOf(' ') + 1).split(';');
  for (let j = 0; j < parts.length; j++) {
    kv = parts[j].trim().split('=');
    parsed[kv[0].trim()] = kv[1];
  }
  return parsed;
};

// Generates a fmtp line from RTCRtpCodecCapability or RTCRtpCodecParameters.
SDPUtils.writeFmtp = function(codec) {
  let line = '';
  let pt = codec.payloadType;
  if (codec.preferredPayloadType !== undefined) {
    pt = codec.preferredPayloadType;
  }
  if (codec.parameters && Object.keys(codec.parameters).length) {
    const params = [];
    Object.keys(codec.parameters).forEach(param => {
      if (codec.parameters[param] !== undefined) {
        params.push(param + '=' + codec.parameters[param]);
      } else {
        params.push(param);
      }
    });
    line += 'a=fmtp:' + pt + ' ' + params.join(';') + '\r\n';
  }
  return line;
};

// Parses a rtcp-fb line, returns RTCPRtcpFeedback object. Sample input:
// a=rtcp-fb:98 nack rpsi
SDPUtils.parseRtcpFb = function(line) {
  const parts = line.substring(line.indexOf(' ') + 1).split(' ');
  return {
    type: parts.shift(),
    parameter: parts.join(' '),
  };
};

// Generate a=rtcp-fb lines from RTCRtpCodecCapability or RTCRtpCodecParameters.
SDPUtils.writeRtcpFb = function(codec) {
  let lines = '';
  let pt = codec.payloadType;
  if (codec.preferredPayloadType !== undefined) {
    pt = codec.preferredPayloadType;
  }
  if (codec.rtcpFeedback && codec.rtcpFeedback.length) {
    // FIXME: special handling for trr-int?
    codec.rtcpFeedback.forEach(fb => {
      lines += 'a=rtcp-fb:' + pt + ' ' + fb.type +
      (fb.parameter && fb.parameter.length ? ' ' + fb.parameter : '') +
          '\r\n';
    });
  }
  return lines;
};

// Parses a RFC 5576 ssrc media attribute. Sample input:
// a=ssrc:3735928559 cname:something
SDPUtils.parseSsrcMedia = function(line) {
  const sp = line.indexOf(' ');
  const parts = {
    ssrc: parseInt(line.substring(7, sp), 10),
  };
  const colon = line.indexOf(':', sp);
  if (colon > -1) {
    parts.attribute = line.substring(sp + 1, colon);
    parts.value = line.substring(colon + 1);
  } else {
    parts.attribute = line.substring(sp + 1);
  }
  return parts;
};

// Parse a ssrc-group line (see RFC 5576). Sample input:
// a=ssrc-group:semantics 12 34
SDPUtils.parseSsrcGroup = function(line) {
  const parts = line.substring(13).split(' ');
  return {
    semantics: parts.shift(),
    ssrcs: parts.map(ssrc => parseInt(ssrc, 10)),
  };
};

// Extracts the MID (RFC 5888) from a media section.
// Returns the MID or undefined if no mid line was found.
SDPUtils.getMid = function(mediaSection) {
  const mid = SDPUtils.matchPrefix(mediaSection, 'a=mid:')[0];
  if (mid) {
    return mid.substring(6);
  }
};

// Parses a fingerprint line for DTLS-SRTP.
SDPUtils.parseFingerprint = function(line) {
  const parts = line.substring(14).split(' ');
  return {
    algorithm: parts[0].toLowerCase(), // algorithm is case-sensitive in Edge.
    value: parts[1].toUpperCase(), // the definition is upper-case in RFC 4572.
  };
};

// Extracts DTLS parameters from SDP media section or sessionpart.
// FIXME: for consistency with other functions this should only
//   get the fingerprint line as input. See also getIceParameters.
SDPUtils.getDtlsParameters = function(mediaSection, sessionpart) {
  const lines = SDPUtils.matchPrefix(mediaSection + sessionpart,
    'a=fingerprint:');
  // Note: a=setup line is ignored since we use the 'auto' role in Edge.
  return {
    role: 'auto',
    fingerprints: lines.map(SDPUtils.parseFingerprint),
  };
};

// Serializes DTLS parameters to SDP.
SDPUtils.writeDtlsParameters = function(params, setupType) {
  let sdp = 'a=setup:' + setupType + '\r\n';
  params.fingerprints.forEach(fp => {
    sdp += 'a=fingerprint:' + fp.algorithm + ' ' + fp.value + '\r\n';
  });
  return sdp;
};

// Parses a=crypto lines into
//   https://rawgit.com/aboba/edgertc/master/msortc-rs4.html#dictionary-rtcsrtpsdesparameters-members
SDPUtils.parseCryptoLine = function(line) {
  const parts = line.substring(9).split(' ');
  return {
    tag: parseInt(parts[0], 10),
    cryptoSuite: parts[1],
    keyParams: parts[2],
    sessionParams: parts.slice(3),
  };
};

SDPUtils.writeCryptoLine = function(parameters) {
  return 'a=crypto:' + parameters.tag + ' ' +
    parameters.cryptoSuite + ' ' +
    (typeof parameters.keyParams === 'object'
      ? SDPUtils.writeCryptoKeyParams(parameters.keyParams)
      : parameters.keyParams) +
    (parameters.sessionParams ? ' ' + parameters.sessionParams.join(' ') : '') +
    '\r\n';
};

// Parses the crypto key parameters into
//   https://rawgit.com/aboba/edgertc/master/msortc-rs4.html#rtcsrtpkeyparam*
SDPUtils.parseCryptoKeyParams = function(keyParams) {
  if (keyParams.indexOf('inline:') !== 0) {
    return null;
  }
  const parts = keyParams.substring(7).split('|');
  return {
    keyMethod: 'inline',
    keySalt: parts[0],
    lifeTime: parts[1],
    mkiValue: parts[2] ? parts[2].split(':')[0] : undefined,
    mkiLength: parts[2] ? parts[2].split(':')[1] : undefined,
  };
};

SDPUtils.writeCryptoKeyParams = function(keyParams) {
  return keyParams.keyMethod + ':'
    + keyParams.keySalt +
    (keyParams.lifeTime ? '|' + keyParams.lifeTime : '') +
    (keyParams.mkiValue && keyParams.mkiLength
      ? '|' + keyParams.mkiValue + ':' + keyParams.mkiLength
      : '');
};

// Extracts all SDES parameters.
SDPUtils.getCryptoParameters = function(mediaSection, sessionpart) {
  const lines = SDPUtils.matchPrefix(mediaSection + sessionpart,
    'a=crypto:');
  return lines.map(SDPUtils.parseCryptoLine);
};

// Parses ICE information from SDP media section or sessionpart.
// FIXME: for consistency with other functions this should only
//   get the ice-ufrag and ice-pwd lines as input.
SDPUtils.getIceParameters = function(mediaSection, sessionpart) {
  const ufrag = SDPUtils.matchPrefix(mediaSection + sessionpart,
    'a=ice-ufrag:')[0];
  const pwd = SDPUtils.matchPrefix(mediaSection + sessionpart,
    'a=ice-pwd:')[0];
  if (!(ufrag && pwd)) {
    return null;
  }
  return {
    usernameFragment: ufrag.substring(12),
    password: pwd.substring(10),
  };
};

// Serializes ICE parameters to SDP.
SDPUtils.writeIceParameters = function(params) {
  let sdp = 'a=ice-ufrag:' + params.usernameFragment + '\r\n' +
      'a=ice-pwd:' + params.password + '\r\n';
  if (params.iceLite) {
    sdp += 'a=ice-lite\r\n';
  }
  return sdp;
};

// Parses the SDP media section and returns RTCRtpParameters.
SDPUtils.parseRtpParameters = function(mediaSection) {
  const description = {
    codecs: [],
    headerExtensions: [],
    fecMechanisms: [],
    rtcp: [],
  };
  const lines = SDPUtils.splitLines(mediaSection);
  const mline = lines[0].split(' ');
  description.profile = mline[2];
  for (let i = 3; i < mline.length; i++) { // find all codecs from mline[3..]
    const pt = mline[i];
    const rtpmapline = SDPUtils.matchPrefix(
      mediaSection, 'a=rtpmap:' + pt + ' ')[0];
    if (rtpmapline) {
      const codec = SDPUtils.parseRtpMap(rtpmapline);
      const fmtps = SDPUtils.matchPrefix(
        mediaSection, 'a=fmtp:' + pt + ' ');
      // Only the first a=fmtp:<pt> is considered.
      codec.parameters = fmtps.length ? SDPUtils.parseFmtp(fmtps[0]) : {};
      codec.rtcpFeedback = SDPUtils.matchPrefix(
        mediaSection, 'a=rtcp-fb:' + pt + ' ')
        .map(SDPUtils.parseRtcpFb);
      description.codecs.push(codec);
      // parse FEC mechanisms from rtpmap lines.
      switch (codec.name.toUpperCase()) {
        case 'RED':
        case 'ULPFEC':
          description.fecMechanisms.push(codec.name.toUpperCase());
          break;
        default: // only RED and ULPFEC are recognized as FEC mechanisms.
          break;
      }
    }
  }
  SDPUtils.matchPrefix(mediaSection, 'a=extmap:').forEach(line => {
    description.headerExtensions.push(SDPUtils.parseExtmap(line));
  });
  const wildcardRtcpFb = SDPUtils.matchPrefix(mediaSection, 'a=rtcp-fb:* ')
    .map(SDPUtils.parseRtcpFb);
  description.codecs.forEach(codec => {
    wildcardRtcpFb.forEach(fb=> {
      const duplicate = codec.rtcpFeedback.find(existingFeedback => {
        return existingFeedback.type === fb.type &&
          existingFeedback.parameter === fb.parameter;
      });
      if (!duplicate) {
        codec.rtcpFeedback.push(fb);
      }
    });
  });
  // FIXME: parse rtcp.
  return description;
};

// Generates parts of the SDP media section describing the capabilities /
// parameters.
SDPUtils.writeRtpDescription = function(kind, caps) {
  let sdp = '';

  // Build the mline.
  sdp += 'm=' + kind + ' ';
  sdp += caps.codecs.length > 0 ? '9' : '0'; // reject if no codecs.
  sdp += ' ' + (caps.profile || 'UDP/TLS/RTP/SAVPF') + ' ';
  sdp += caps.codecs.map(codec => {
    if (codec.preferredPayloadType !== undefined) {
      return codec.preferredPayloadType;
    }
    return codec.payloadType;
  }).join(' ') + '\r\n';

  sdp += 'c=IN IP4 0.0.0.0\r\n';
  sdp += 'a=rtcp:9 IN IP4 0.0.0.0\r\n';

  // Add a=rtpmap lines for each codec. Also fmtp and rtcp-fb.
  caps.codecs.forEach(codec => {
    sdp += SDPUtils.writeRtpMap(codec);
    sdp += SDPUtils.writeFmtp(codec);
    sdp += SDPUtils.writeRtcpFb(codec);
  });
  let maxptime = 0;
  caps.codecs.forEach(codec => {
    if (codec.maxptime > maxptime) {
      maxptime = codec.maxptime;
    }
  });
  if (maxptime > 0) {
    sdp += 'a=maxptime:' + maxptime + '\r\n';
  }

  if (caps.headerExtensions) {
    caps.headerExtensions.forEach(extension => {
      sdp += SDPUtils.writeExtmap(extension);
    });
  }
  // FIXME: write fecMechanisms.
  return sdp;
};

// Parses the SDP media section and returns an array of
// RTCRtpEncodingParameters.
SDPUtils.parseRtpEncodingParameters = function(mediaSection) {
  const encodingParameters = [];
  const description = SDPUtils.parseRtpParameters(mediaSection);
  const hasRed = description.fecMechanisms.indexOf('RED') !== -1;
  const hasUlpfec = description.fecMechanisms.indexOf('ULPFEC') !== -1;

  // filter a=ssrc:... cname:, ignore PlanB-msid
  const ssrcs = SDPUtils.matchPrefix(mediaSection, 'a=ssrc:')
    .map(line => SDPUtils.parseSsrcMedia(line))
    .filter(parts => parts.attribute === 'cname');
  const primarySsrc = ssrcs.length > 0 && ssrcs[0].ssrc;
  let secondarySsrc;

  const flows = SDPUtils.matchPrefix(mediaSection, 'a=ssrc-group:FID')
    .map(line => {
      const parts = line.substring(17).split(' ');
      return parts.map(part => parseInt(part, 10));
    });
  if (flows.length > 0 && flows[0].length > 1 && flows[0][0] === primarySsrc) {
    secondarySsrc = flows[0][1];
  }

  description.codecs.forEach(codec => {
    if (codec.name.toUpperCase() === 'RTX' && codec.parameters.apt) {
      let encParam = {
        ssrc: primarySsrc,
        codecPayloadType: parseInt(codec.parameters.apt, 10),
      };
      if (primarySsrc && secondarySsrc) {
        encParam.rtx = {ssrc: secondarySsrc};
      }
      encodingParameters.push(encParam);
      if (hasRed) {
        encParam = JSON.parse(JSON.stringify(encParam));
        encParam.fec = {
          ssrc: primarySsrc,
          mechanism: hasUlpfec ? 'red+ulpfec' : 'red',
        };
        encodingParameters.push(encParam);
      }
    }
  });
  if (encodingParameters.length === 0 && primarySsrc) {
    encodingParameters.push({
      ssrc: primarySsrc,
    });
  }

  // we support both b=AS and b=TIAS but interpret AS as TIAS.
  let bandwidth = SDPUtils.matchPrefix(mediaSection, 'b=');
  if (bandwidth.length) {
    if (bandwidth[0].indexOf('b=TIAS:') === 0) {
      bandwidth = parseInt(bandwidth[0].substring(7), 10);
    } else if (bandwidth[0].indexOf('b=AS:') === 0) {
      // use formula from JSEP to convert b=AS to TIAS value.
      bandwidth = parseInt(bandwidth[0].substring(5), 10) * 1000 * 0.95
          - (50 * 40 * 8);
    } else {
      bandwidth = undefined;
    }
    encodingParameters.forEach(params => {
      params.maxBitrate = bandwidth;
    });
  }
  return encodingParameters;
};

// parses http://draft.ortc.org/#rtcrtcpparameters*
SDPUtils.parseRtcpParameters = function(mediaSection) {
  const rtcpParameters = {};

  // Gets the first SSRC. Note that with RTX there might be multiple
  // SSRCs.
  const remoteSsrc = SDPUtils.matchPrefix(mediaSection, 'a=ssrc:')
    .map(line => SDPUtils.parseSsrcMedia(line))
    .filter(obj => obj.attribute === 'cname')[0];
  if (remoteSsrc) {
    rtcpParameters.cname = remoteSsrc.value;
    rtcpParameters.ssrc = remoteSsrc.ssrc;
  }

  // Edge uses the compound attribute instead of reducedSize
  // compound is !reducedSize
  const rsize = SDPUtils.matchPrefix(mediaSection, 'a=rtcp-rsize');
  rtcpParameters.reducedSize = rsize.length > 0;
  rtcpParameters.compound = rsize.length === 0;

  // parses the rtcp-mux attrіbute.
  // Note that Edge does not support unmuxed RTCP.
  const mux = SDPUtils.matchPrefix(mediaSection, 'a=rtcp-mux');
  rtcpParameters.mux = mux.length > 0;

  return rtcpParameters;
};

SDPUtils.writeRtcpParameters = function(rtcpParameters) {
  let sdp = '';
  if (rtcpParameters.reducedSize) {
    sdp += 'a=rtcp-rsize\r\n';
  }
  if (rtcpParameters.mux) {
    sdp += 'a=rtcp-mux\r\n';
  }
  if (rtcpParameters.ssrc !== undefined && rtcpParameters.cname) {
    sdp += 'a=ssrc:' + rtcpParameters.ssrc +
      ' cname:' + rtcpParameters.cname + '\r\n';
  }
  return sdp;
};


// parses either a=msid: or a=ssrc:... msid lines and returns
// the id of the MediaStream and MediaStreamTrack.
SDPUtils.parseMsid = function(mediaSection) {
  let parts;
  const spec = SDPUtils.matchPrefix(mediaSection, 'a=msid:');
  if (spec.length === 1) {
    parts = spec[0].substring(7).split(' ');
    return {stream: parts[0], track: parts[1]};
  }
  const planB = SDPUtils.matchPrefix(mediaSection, 'a=ssrc:')
    .map(line => SDPUtils.parseSsrcMedia(line))
    .filter(msidParts => msidParts.attribute === 'msid');
  if (planB.length > 0) {
    parts = planB[0].value.split(' ');
    return {stream: parts[0], track: parts[1]};
  }
};

// SCTP
// parses draft-ietf-mmusic-sctp-sdp-26 first and falls back
// to draft-ietf-mmusic-sctp-sdp-05
SDPUtils.parseSctpDescription = function(mediaSection) {
  const mline = SDPUtils.parseMLine(mediaSection);
  const maxSizeLine = SDPUtils.matchPrefix(mediaSection, 'a=max-message-size:');
  let maxMessageSize;
  if (maxSizeLine.length > 0) {
    maxMessageSize = parseInt(maxSizeLine[0].substring(19), 10);
  }
  if (isNaN(maxMessageSize)) {
    maxMessageSize = 65536;
  }
  const sctpPort = SDPUtils.matchPrefix(mediaSection, 'a=sctp-port:');
  if (sctpPort.length > 0) {
    return {
      port: parseInt(sctpPort[0].substring(12), 10),
      protocol: mline.fmt,
      maxMessageSize,
    };
  }
  const sctpMapLines = SDPUtils.matchPrefix(mediaSection, 'a=sctpmap:');
  if (sctpMapLines.length > 0) {
    const parts = sctpMapLines[0]
      .substring(10)
      .split(' ');
    return {
      port: parseInt(parts[0], 10),
      protocol: parts[1],
      maxMessageSize,
    };
  }
};

// SCTP
// outputs the draft-ietf-mmusic-sctp-sdp-26 version that all browsers
// support by now receiving in this format, unless we originally parsed
// as the draft-ietf-mmusic-sctp-sdp-05 format (indicated by the m-line
// protocol of DTLS/SCTP -- without UDP/ or TCP/)
SDPUtils.writeSctpDescription = function(media, sctp) {
  let output = [];
  if (media.protocol !== 'DTLS/SCTP') {
    output = [
      'm=' + media.kind + ' 9 ' + media.protocol + ' ' + sctp.protocol + '\r\n',
      'c=IN IP4 0.0.0.0\r\n',
      'a=sctp-port:' + sctp.port + '\r\n',
    ];
  } else {
    output = [
      'm=' + media.kind + ' 9 ' + media.protocol + ' ' + sctp.port + '\r\n',
      'c=IN IP4 0.0.0.0\r\n',
      'a=sctpmap:' + sctp.port + ' ' + sctp.protocol + ' 65535\r\n',
    ];
  }
  if (sctp.maxMessageSize !== undefined) {
    output.push('a=max-message-size:' + sctp.maxMessageSize + '\r\n');
  }
  return output.join('');
};

// Generate a session ID for SDP.
// https://tools.ietf.org/html/draft-ietf-rtcweb-jsep-20#section-5.2.1
// recommends using a cryptographically random +ve 64-bit value
// but right now this should be acceptable and within the right range
SDPUtils.generateSessionId = function() {
  return Math.random().toString().substr(2, 22);
};

// Write boiler plate for start of SDP
// sessId argument is optional - if not supplied it will
// be generated randomly
// sessVersion is optional and defaults to 2
// sessUser is optional and defaults to 'thisisadapterortc'
SDPUtils.writeSessionBoilerplate = function(sessId, sessVer, sessUser) {
  let sessionId;
  const version = sessVer !== undefined ? sessVer : 2;
  if (sessId) {
    sessionId = sessId;
  } else {
    sessionId = SDPUtils.generateSessionId();
  }
  const user = sessUser || 'thisisadapterortc';
  // FIXME: sess-id should be an NTP timestamp.
  return 'v=0\r\n' +
      'o=' + user + ' ' + sessionId + ' ' + version +
        ' IN IP4 127.0.0.1\r\n' +
      's=-\r\n' +
      't=0 0\r\n';
};

// Gets the direction from the mediaSection or the sessionpart.
SDPUtils.getDirection = function(mediaSection, sessionpart) {
  // Look for sendrecv, sendonly, recvonly, inactive, default to sendrecv.
  const lines = SDPUtils.splitLines(mediaSection);
  for (let i = 0; i < lines.length; i++) {
    switch (lines[i]) {
      case 'a=sendrecv':
      case 'a=sendonly':
      case 'a=recvonly':
      case 'a=inactive':
        return lines[i].substring(2);
      default:
        // FIXME: What should happen here?
    }
  }
  if (sessionpart) {
    return SDPUtils.getDirection(sessionpart);
  }
  return 'sendrecv';
};

SDPUtils.getKind = function(mediaSection) {
  const lines = SDPUtils.splitLines(mediaSection);
  const mline = lines[0].split(' ');
  return mline[0].substring(2);
};

SDPUtils.isRejected = function(mediaSection) {
  return mediaSection.split(' ', 2)[1] === '0';
};

SDPUtils.parseMLine = function(mediaSection) {
  const lines = SDPUtils.splitLines(mediaSection);
  const parts = lines[0].substring(2).split(' ');
  return {
    kind: parts[0],
    port: parseInt(parts[1], 10),
    protocol: parts[2],
    fmt: parts.slice(3).join(' '),
  };
};

SDPUtils.parseOLine = function(mediaSection) {
  const line = SDPUtils.matchPrefix(mediaSection, 'o=')[0];
  const parts = line.substring(2).split(' ');
  return {
    username: parts[0],
    sessionId: parts[1],
    sessionVersion: parseInt(parts[2], 10),
    netType: parts[3],
    addressType: parts[4],
    address: parts[5],
  };
};

// a very naive interpretation of a valid SDP.
SDPUtils.isValidSDP = function(blob) {
  if (typeof blob !== 'string' || blob.length === 0) {
    return false;
  }
  const lines = SDPUtils.splitLines(blob);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length < 2 || lines[i].charAt(1) !== '=') {
      return false;
    }
    // TODO: check the modifier a bit more.
  }
  return true;
};

// Expose public methods.
if (true) {
  module.exports = SDPUtils;
}


/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module is referenced by other modules so it can't be inlined
/******/ 	var __webpack_exports__ = __webpack_require__("./src/index.js");
/******/ 	
/******/ })()
;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibmFmLWphbnVzLWFkYXB0ZXIuanMiLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0Esa0JBQWtCO0FBQ2xCO0FBQ0E7QUFDQTtBQUNBLEdBQUc7QUFDSDs7QUFFQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsR0FBRztBQUNIOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLGlEQUFpRCxvQkFBb0I7QUFDckU7O0FBRUE7QUFDQTtBQUNBLGdDQUFnQyxZQUFZO0FBQzVDOztBQUVBO0FBQ0E7QUFDQSxnQ0FBZ0MsUUFBUSxjQUFjO0FBQ3REOztBQUVBO0FBQ0E7QUFDQSxnQ0FBZ0Msc0JBQXNCO0FBQ3REOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsR0FBRztBQUNIOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxHQUFHO0FBQ0g7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEdBQUc7QUFDSDs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsZ0dBQWdHO0FBQ2hHO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQSxvQkFBb0IscUJBQXFCO0FBQ3pDO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLHNHQUFzRztBQUN0RztBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsMkJBQTJCLDJDQUEyQztBQUN0RTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxPQUFPO0FBQ1A7QUFDQSxzQ0FBc0M7QUFDdEM7QUFDQSxHQUFHO0FBQ0g7O0FBRUE7QUFDQSwyQkFBMkIsYUFBYTs7QUFFeEMseUJBQXlCO0FBQ3pCLDZCQUE2QixxQkFBcUI7QUFDbEQ7O0FBRUE7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEtBQUs7QUFDTDtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBOzs7Ozs7Ozs7OztBQzVQQTtBQUNBLElBQUlBLEVBQUUsR0FBR0MsbUJBQU8sQ0FBQyw0RkFBNkIsQ0FBQztBQUMvQ0QsRUFBRSxDQUFDRSxZQUFZLENBQUNDLFNBQVMsQ0FBQ0MsWUFBWSxHQUFHSixFQUFFLENBQUNFLFlBQVksQ0FBQ0MsU0FBUyxDQUFDRSxJQUFJO0FBQ3ZFTCxFQUFFLENBQUNFLFlBQVksQ0FBQ0MsU0FBUyxDQUFDRSxJQUFJLEdBQUcsVUFBU0MsSUFBSSxFQUFFQyxNQUFNLEVBQUU7RUFDdEQsT0FBTyxJQUFJLENBQUNILFlBQVksQ0FBQ0UsSUFBSSxFQUFFQyxNQUFNLENBQUMsQ0FBQ0MsS0FBSyxDQUFFQyxDQUFDLElBQUs7SUFDbEQsSUFBSUEsQ0FBQyxDQUFDQyxPQUFPLElBQUlELENBQUMsQ0FBQ0MsT0FBTyxDQUFDQyxPQUFPLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUU7TUFDcERDLE9BQU8sQ0FBQ0MsS0FBSyxDQUFDLHNCQUFzQixDQUFDO01BQ3JDQyxHQUFHLENBQUNDLFVBQVUsQ0FBQ0MsT0FBTyxDQUFDQyxTQUFTLENBQUMsQ0FBQztJQUNwQyxDQUFDLE1BQU07TUFDTCxNQUFNUixDQUFDO0lBQ1Q7RUFDRixDQUFDLENBQUM7QUFDSixDQUFDO0FBRUQsSUFBSVMsUUFBUSxHQUFHakIsbUJBQU8sQ0FBQyxzQ0FBSyxDQUFDO0FBQzdCO0FBQ0E7QUFDQTtBQUNBLElBQUlrQixLQUFLLEdBQUdQLE9BQU8sQ0FBQ1EsR0FBRztBQUN2QixJQUFJQyxJQUFJLEdBQUdULE9BQU8sQ0FBQ1MsSUFBSTtBQUN2QixJQUFJUixLQUFLLEdBQUdELE9BQU8sQ0FBQ0MsS0FBSztBQUN6QixJQUFJUyxRQUFRLEdBQUcsZ0NBQWdDLENBQUNDLElBQUksQ0FBQ0MsU0FBUyxDQUFDQyxTQUFTLENBQUM7QUFFekUsTUFBTUMsb0JBQW9CLEdBQUcsS0FBSztBQUVsQyxTQUFTQyxRQUFRQSxDQUFDQyxFQUFFLEVBQUU7RUFDcEIsSUFBSUMsSUFBSSxHQUFHQyxPQUFPLENBQUNDLE9BQU8sQ0FBQyxDQUFDO0VBQzVCLE9BQU8sWUFBVztJQUNoQixJQUFJQyxJQUFJLEdBQUdDLEtBQUssQ0FBQzlCLFNBQVMsQ0FBQytCLEtBQUssQ0FBQ0MsSUFBSSxDQUFDQyxTQUFTLENBQUM7SUFDaERQLElBQUksR0FBR0EsSUFBSSxDQUFDUSxJQUFJLENBQUNDLENBQUMsSUFBSVYsRUFBRSxDQUFDVyxLQUFLLENBQUMsSUFBSSxFQUFFUCxJQUFJLENBQUMsQ0FBQztFQUM3QyxDQUFDO0FBQ0g7QUFFQSxTQUFTUSxVQUFVQSxDQUFBLEVBQUc7RUFDcEIsT0FBT0MsSUFBSSxDQUFDQyxLQUFLLENBQUNELElBQUksQ0FBQ0UsTUFBTSxDQUFDLENBQUMsR0FBR0MsTUFBTSxDQUFDQyxnQkFBZ0IsQ0FBQztBQUM1RDtBQUVBLFNBQVNDLG9CQUFvQkEsQ0FBQ0MsV0FBVyxFQUFFO0VBQ3pDLE9BQU8sSUFBSWpCLE9BQU8sQ0FBQyxDQUFDQyxPQUFPLEVBQUVpQixNQUFNLEtBQUs7SUFDdEMsSUFBSUQsV0FBVyxDQUFDRSxVQUFVLEtBQUssTUFBTSxFQUFFO01BQ3JDbEIsT0FBTyxDQUFDLENBQUM7SUFDWCxDQUFDLE1BQU07TUFDTCxJQUFJbUIsUUFBUSxFQUFFQyxRQUFRO01BRXRCLE1BQU1DLEtBQUssR0FBR0EsQ0FBQSxLQUFNO1FBQ2xCTCxXQUFXLENBQUNNLG1CQUFtQixDQUFDLE1BQU0sRUFBRUgsUUFBUSxDQUFDO1FBQ2pESCxXQUFXLENBQUNNLG1CQUFtQixDQUFDLE9BQU8sRUFBRUYsUUFBUSxDQUFDO01BQ3BELENBQUM7TUFFREQsUUFBUSxHQUFHQSxDQUFBLEtBQU07UUFDZkUsS0FBSyxDQUFDLENBQUM7UUFDUHJCLE9BQU8sQ0FBQyxDQUFDO01BQ1gsQ0FBQztNQUNEb0IsUUFBUSxHQUFHQSxDQUFBLEtBQU07UUFDZkMsS0FBSyxDQUFDLENBQUM7UUFDUEosTUFBTSxDQUFDLENBQUM7TUFDVixDQUFDO01BRURELFdBQVcsQ0FBQ08sZ0JBQWdCLENBQUMsTUFBTSxFQUFFSixRQUFRLENBQUM7TUFDOUNILFdBQVcsQ0FBQ08sZ0JBQWdCLENBQUMsT0FBTyxFQUFFSCxRQUFRLENBQUM7SUFDakQ7RUFDRixDQUFDLENBQUM7QUFDSjtBQUVBLE1BQU1JLG9CQUFvQixHQUFHLENBQUMsTUFBTTtFQUNsQyxNQUFNQyxLQUFLLEdBQUdDLFFBQVEsQ0FBQ0MsYUFBYSxDQUFDLE9BQU8sQ0FBQztFQUM3QyxPQUFPRixLQUFLLENBQUNHLFdBQVcsQ0FBQyw0Q0FBNEMsQ0FBQyxLQUFLLEVBQUU7QUFDL0UsQ0FBQyxFQUFFLENBQUM7QUFFSixNQUFNQyxlQUFlLEdBQUc7RUFDdEI7RUFDQUMsTUFBTSxFQUFFLENBQUM7RUFDVDtFQUNBQyxNQUFNLEVBQUUsQ0FBQztFQUNUO0VBQ0EsY0FBYyxFQUFFO0FBQ2xCLENBQUM7QUFFRCxNQUFNQyw4QkFBOEIsR0FBRztFQUNyQ0MsVUFBVSxFQUFFLENBQUM7SUFBRUMsSUFBSSxFQUFFO0VBQWdDLENBQUMsRUFBRTtJQUFFQSxJQUFJLEVBQUU7RUFBZ0MsQ0FBQztBQUNuRyxDQUFDO0FBRUQsTUFBTUMsaUJBQWlCLEdBQUcsSUFBSTtBQUU5QixNQUFNQyxZQUFZLENBQUM7RUFDakJDLFdBQVdBLENBQUEsRUFBRztJQUNaLElBQUksQ0FBQ0MsSUFBSSxHQUFHLElBQUk7SUFDaEI7SUFDQSxJQUFJLENBQUNDLFFBQVEsR0FBRyxJQUFJO0lBQ3BCLElBQUksQ0FBQ0MsU0FBUyxHQUFHLElBQUk7SUFFckIsSUFBSSxDQUFDQyxTQUFTLEdBQUcsSUFBSTtJQUNyQixJQUFJLENBQUNDLGFBQWEsR0FBRyxDQUFDLENBQUM7SUFDdkIsSUFBSSxDQUFDQyxvQkFBb0IsR0FBRyxJQUFJO0lBQ2hDLElBQUksQ0FBQ0MsRUFBRSxHQUFHLElBQUk7SUFDZCxJQUFJLENBQUNDLE9BQU8sR0FBRyxJQUFJO0lBQ25CLElBQUksQ0FBQ0MsaUJBQWlCLEdBQUcsYUFBYTtJQUN0QyxJQUFJLENBQUNDLG1CQUFtQixHQUFHLGFBQWE7O0lBRXhDO0lBQ0E7SUFDQSxJQUFJLENBQUNDLHdCQUF3QixHQUFHLElBQUksR0FBR3RDLElBQUksQ0FBQ0UsTUFBTSxDQUFDLENBQUM7SUFDcEQsSUFBSSxDQUFDcUMsaUJBQWlCLEdBQUcsSUFBSSxDQUFDRCx3QkFBd0I7SUFDdEQsSUFBSSxDQUFDRSxtQkFBbUIsR0FBRyxJQUFJO0lBQy9CLElBQUksQ0FBQ0MsdUJBQXVCLEdBQUcsRUFBRTtJQUNqQyxJQUFJLENBQUNDLG9CQUFvQixHQUFHLENBQUM7SUFDN0IsSUFBSSxDQUFDQyxjQUFjLEdBQUcsS0FBSztJQUUzQixJQUFJLENBQUNDLFNBQVMsR0FBRyxJQUFJO0lBQ3JCLElBQUksQ0FBQ0MsU0FBUyxHQUFHLENBQUMsQ0FBQztJQUNuQixJQUFJLENBQUNDLGFBQWEsR0FBRyxJQUFJQyxHQUFHLENBQUMsQ0FBQztJQUM5QixJQUFJLENBQUNDLFlBQVksR0FBRyxDQUFDLENBQUM7SUFDdEIsSUFBSSxDQUFDQyxnQkFBZ0IsR0FBRyxJQUFJO0lBQzVCLElBQUksQ0FBQ0Msb0JBQW9CLEdBQUcsSUFBSUMsR0FBRyxDQUFDLENBQUM7SUFFckMsSUFBSSxDQUFDQyxjQUFjLEdBQUcsSUFBSUQsR0FBRyxDQUFDLENBQUM7SUFDL0IsSUFBSSxDQUFDRSxhQUFhLEdBQUcsSUFBSUYsR0FBRyxDQUFDLENBQUM7SUFFOUIsSUFBSSxDQUFDRyxXQUFXLEdBQUcsRUFBRTtJQUNyQixJQUFJLENBQUNDLGtCQUFrQixHQUFHLENBQUM7SUFDM0IsSUFBSSxDQUFDQyxhQUFhLEdBQUcsQ0FBQztJQUV0QixJQUFJLENBQUNDLGVBQWUsR0FBRyxJQUFJLENBQUNBLGVBQWUsQ0FBQ0MsSUFBSSxDQUFDLElBQUksQ0FBQztJQUN0RCxJQUFJLENBQUNDLGdCQUFnQixHQUFHLElBQUksQ0FBQ0EsZ0JBQWdCLENBQUNELElBQUksQ0FBQyxJQUFJLENBQUM7SUFDeEQsSUFBSSxDQUFDRSxrQkFBa0IsR0FBRyxJQUFJLENBQUNBLGtCQUFrQixDQUFDRixJQUFJLENBQUMsSUFBSSxDQUFDO0lBQzVELElBQUksQ0FBQ0csb0JBQW9CLEdBQUcsSUFBSSxDQUFDQSxvQkFBb0IsQ0FBQ0gsSUFBSSxDQUFDLElBQUksQ0FBQztJQUNoRSxJQUFJLENBQUNJLE1BQU0sR0FBRyxJQUFJLENBQUNBLE1BQU0sQ0FBQ0osSUFBSSxDQUFDLElBQUksQ0FBQztFQUN0QztFQUVBSyxZQUFZQSxDQUFDQyxHQUFHLEVBQUU7SUFDaEIsSUFBSSxDQUFDakMsU0FBUyxHQUFHaUMsR0FBRztFQUN0QjtFQUVBQyxNQUFNQSxDQUFDQyxHQUFHLEVBQUUsQ0FBQztFQUViQyxPQUFPQSxDQUFDQyxRQUFRLEVBQUU7SUFDaEIsSUFBSSxDQUFDeEMsSUFBSSxHQUFHd0MsUUFBUTtFQUN0QjtFQUVBQyxZQUFZQSxDQUFDdkMsU0FBUyxFQUFFO0lBQ3RCLElBQUksQ0FBQ0EsU0FBUyxHQUFHQSxTQUFTO0VBQzVCO0VBRUF3QyxXQUFXQSxDQUFDekMsUUFBUSxFQUFFO0lBQ3BCLElBQUksQ0FBQ0EsUUFBUSxHQUFHQSxRQUFRO0VBQzFCO0VBRUEwQyxnQkFBZ0JBLENBQUNDLE9BQU8sRUFBRTtJQUN4QixJQUFJLENBQUN4QyxhQUFhLEdBQUd3QyxPQUFPO0VBQzlCO0VBRUFDLHVCQUF1QkEsQ0FBQ3hDLG9CQUFvQixFQUFFO0lBQzVDLElBQUksQ0FBQ0Esb0JBQW9CLEdBQUdBLG9CQUFvQjtFQUNsRDtFQUVBeUMseUJBQXlCQSxDQUFDQyxlQUFlLEVBQUVDLGVBQWUsRUFBRTtJQUMxRCxJQUFJLENBQUNDLGNBQWMsR0FBR0YsZUFBZTtJQUNyQyxJQUFJLENBQUNHLGNBQWMsR0FBR0YsZUFBZTtFQUN2QztFQUVBRyx1QkFBdUJBLENBQUNDLGdCQUFnQixFQUFFO0lBQ3hDLElBQUksQ0FBQ0Msa0JBQWtCLEdBQUdELGdCQUFnQjtFQUM1QztFQUVBRSx1QkFBdUJBLENBQUNDLFlBQVksRUFBRUMsY0FBYyxFQUFFQyxlQUFlLEVBQUU7SUFDckUsSUFBSSxDQUFDQyxtQkFBbUIsR0FBR0gsWUFBWTtJQUN2QyxJQUFJLENBQUNJLHNCQUFzQixHQUFHSCxjQUFjO0lBQzVDLElBQUksQ0FBQ0ksaUJBQWlCLEdBQUdILGVBQWU7RUFDMUM7RUFFQUksd0JBQXdCQSxDQUFDQyxvQkFBb0IsRUFBRUMsbUJBQW1CLEVBQUVDLHlCQUF5QixFQUFFO0lBQzdGO0lBQ0EsSUFBSSxDQUFDQyxjQUFjLEdBQUdILG9CQUFvQjtJQUMxQztJQUNBLElBQUksQ0FBQ0ksYUFBYSxHQUFHSCxtQkFBbUI7SUFDeEM7SUFDQSxJQUFJLENBQUNJLG1CQUFtQixHQUFHSCx5QkFBeUI7RUFDdEQ7RUFFQUksYUFBYUEsQ0FBQ0MsS0FBSyxFQUFFO0lBQ25CLElBQUksQ0FBQ0EsS0FBSyxHQUFHQSxLQUFLO0VBQ3BCO0VBRUFDLE9BQU9BLENBQUEsRUFBRztJQUNSLElBQUksSUFBSSxDQUFDbkUsU0FBUyxLQUFLLEdBQUcsRUFBRTtNQUMxQixJQUFJLENBQUNBLFNBQVMsR0FBRyxRQUFRO0lBQzNCO0lBQ0EsSUFBSSxJQUFJLENBQUNBLFNBQVMsS0FBSyxRQUFRLEVBQUU7TUFDL0IsSUFBSW9FLFFBQVEsQ0FBQ0MsUUFBUSxLQUFLLFFBQVEsRUFBRTtRQUNsQyxJQUFJLENBQUNyRSxTQUFTLEdBQUcsUUFBUSxHQUFHb0UsUUFBUSxDQUFDRSxJQUFJLEdBQUcsUUFBUTtNQUN0RCxDQUFDLE1BQU07UUFDTCxJQUFJLENBQUN0RSxTQUFTLEdBQUcsT0FBTyxHQUFHb0UsUUFBUSxDQUFDRSxJQUFJLEdBQUcsUUFBUTtNQUNyRDtJQUNGO0lBQ0EzSCxLQUFLLENBQUMsaUJBQWlCLElBQUksQ0FBQ3FELFNBQVMsRUFBRSxDQUFDO0lBRXhDLE1BQU11RSxtQkFBbUIsR0FBRyxJQUFJakgsT0FBTyxDQUFDLENBQUNDLE9BQU8sRUFBRWlCLE1BQU0sS0FBSztNQUMzRCxJQUFJLENBQUMyQixFQUFFLEdBQUcsSUFBSXFFLFNBQVMsQ0FBQyxJQUFJLENBQUN4RSxTQUFTLEVBQUUsZ0JBQWdCLENBQUM7TUFFekQsSUFBSSxDQUFDSSxPQUFPLEdBQUcsSUFBSTVFLEVBQUUsQ0FBQ0UsWUFBWSxDQUFDLElBQUksQ0FBQ3lFLEVBQUUsQ0FBQ3RFLElBQUksQ0FBQzhGLElBQUksQ0FBQyxJQUFJLENBQUN4QixFQUFFLENBQUMsRUFBRTtRQUFFc0UsU0FBUyxFQUFFO01BQU0sQ0FBQyxDQUFDO01BRXBGLElBQUksQ0FBQ0MsMEJBQTBCLEdBQUcsQ0FBQyxDQUFDO01BQ3BDLElBQUksQ0FBQ0EsMEJBQTBCLENBQUNuSCxPQUFPLEdBQUdBLE9BQU87TUFDakQsSUFBSSxDQUFDbUgsMEJBQTBCLENBQUNsRyxNQUFNLEdBQUdBLE1BQU07TUFFL0MsSUFBSSxDQUFDMkIsRUFBRSxDQUFDckIsZ0JBQWdCLENBQUMsT0FBTyxFQUFFLElBQUksQ0FBQzhDLGdCQUFnQixDQUFDO01BQ3hELElBQUksQ0FBQ3pCLEVBQUUsQ0FBQ3JCLGdCQUFnQixDQUFDLFNBQVMsRUFBRSxJQUFJLENBQUMrQyxrQkFBa0IsQ0FBQztNQUU1RCxJQUFJLENBQUM4QyxRQUFRLEdBQUcsTUFBTTtRQUNwQixJQUFJLENBQUN4RSxFQUFFLENBQUN0QixtQkFBbUIsQ0FBQyxNQUFNLEVBQUUsSUFBSSxDQUFDOEYsUUFBUSxDQUFDO1FBQ2xELElBQUksQ0FBQ2pELGVBQWUsQ0FBQyxDQUFDLENBQ25CN0QsSUFBSSxDQUFDTixPQUFPLENBQUMsQ0FDYnZCLEtBQUssQ0FBQ3dDLE1BQU0sQ0FBQztNQUNsQixDQUFDO01BRUQsSUFBSSxDQUFDMkIsRUFBRSxDQUFDckIsZ0JBQWdCLENBQUMsTUFBTSxFQUFFLElBQUksQ0FBQzZGLFFBQVEsQ0FBQztJQUNqRCxDQUFDLENBQUM7SUFFRixPQUFPckgsT0FBTyxDQUFDc0gsR0FBRyxDQUFDLENBQUNMLG1CQUFtQixFQUFFLElBQUksQ0FBQ00sZ0JBQWdCLENBQUMsQ0FBQyxDQUFDLENBQUM7RUFDcEU7RUFFQUMsVUFBVUEsQ0FBQSxFQUFHO0lBQ1huSSxLQUFLLENBQUMsZUFBZSxDQUFDO0lBRXRCb0ksWUFBWSxDQUFDLElBQUksQ0FBQ3RFLG1CQUFtQixDQUFDO0lBRXRDLElBQUksQ0FBQ3VFLGtCQUFrQixDQUFDLENBQUM7SUFDekIsSUFBSSxDQUFDakUsYUFBYSxHQUFHLElBQUlDLEdBQUcsQ0FBQyxDQUFDO0lBRTlCLElBQUksSUFBSSxDQUFDSCxTQUFTLEVBQUU7TUFDbEI7TUFDQSxJQUFJLENBQUNBLFNBQVMsQ0FBQ29FLElBQUksQ0FBQ0MsS0FBSyxDQUFDLENBQUM7TUFDM0IsSUFBSSxDQUFDckUsU0FBUyxHQUFHLElBQUk7SUFDdkI7SUFFQSxJQUFJLElBQUksQ0FBQ1QsT0FBTyxFQUFFO01BQ2hCLElBQUksQ0FBQ0EsT0FBTyxDQUFDK0UsT0FBTyxDQUFDLENBQUM7TUFDdEIsSUFBSSxDQUFDL0UsT0FBTyxHQUFHLElBQUk7SUFDckI7SUFFQSxJQUFJLElBQUksQ0FBQ0QsRUFBRSxFQUFFO01BQ1gsSUFBSSxDQUFDQSxFQUFFLENBQUN0QixtQkFBbUIsQ0FBQyxNQUFNLEVBQUUsSUFBSSxDQUFDOEYsUUFBUSxDQUFDO01BQ2xELElBQUksQ0FBQ3hFLEVBQUUsQ0FBQ3RCLG1CQUFtQixDQUFDLE9BQU8sRUFBRSxJQUFJLENBQUMrQyxnQkFBZ0IsQ0FBQztNQUMzRCxJQUFJLENBQUN6QixFQUFFLENBQUN0QixtQkFBbUIsQ0FBQyxTQUFTLEVBQUUsSUFBSSxDQUFDZ0Qsa0JBQWtCLENBQUM7TUFDL0QsSUFBSSxDQUFDMUIsRUFBRSxDQUFDK0UsS0FBSyxDQUFDLENBQUM7TUFDZixJQUFJLENBQUMvRSxFQUFFLEdBQUcsSUFBSTtJQUNoQjs7SUFFQTtJQUNBO0lBQ0E7SUFDQSxJQUFJLElBQUksQ0FBQ2lGLHVCQUF1QixFQUFFO01BQ2hDTCxZQUFZLENBQUMsSUFBSSxDQUFDSyx1QkFBdUIsQ0FBQztNQUMxQyxJQUFJLENBQUNBLHVCQUF1QixHQUFHLElBQUk7SUFDckM7RUFDRjtFQUVBQyxjQUFjQSxDQUFBLEVBQUc7SUFDZixPQUFPLElBQUksQ0FBQ2xGLEVBQUUsS0FBSyxJQUFJO0VBQ3pCO0VBRUEsTUFBTXVCLGVBQWVBLENBQUEsRUFBRztJQUN0QjtJQUNBLE1BQU0sSUFBSSxDQUFDdEIsT0FBTyxDQUFDa0YsTUFBTSxDQUFDLENBQUM7O0lBRTNCO0lBQ0E7SUFDQTtJQUNBLElBQUksQ0FBQ3pFLFNBQVMsR0FBRyxNQUFNLElBQUksQ0FBQzBFLGVBQWUsQ0FBQyxDQUFDOztJQUU3QztJQUNBLElBQUksQ0FBQ3pDLGNBQWMsQ0FBQyxJQUFJLENBQUNoRCxRQUFRLENBQUM7SUFFbEMsTUFBTTBGLG1CQUFtQixHQUFHLEVBQUU7SUFFOUIsS0FBSyxJQUFJQyxDQUFDLEdBQUcsQ0FBQyxFQUFFQSxDQUFDLEdBQUcsSUFBSSxDQUFDNUUsU0FBUyxDQUFDNkUsZ0JBQWdCLENBQUNDLE1BQU0sRUFBRUYsQ0FBQyxFQUFFLEVBQUU7TUFDL0QsTUFBTUcsVUFBVSxHQUFHLElBQUksQ0FBQy9FLFNBQVMsQ0FBQzZFLGdCQUFnQixDQUFDRCxDQUFDLENBQUM7TUFDckQsSUFBSUcsVUFBVSxLQUFLLElBQUksQ0FBQzlGLFFBQVEsRUFBRSxTQUFTLENBQUM7TUFDNUMwRixtQkFBbUIsQ0FBQ0ssSUFBSSxDQUFDLElBQUksQ0FBQ0MsV0FBVyxDQUFDRixVQUFVLENBQUMsQ0FBQztJQUN4RDtJQUVBLE1BQU10SSxPQUFPLENBQUNzSCxHQUFHLENBQUNZLG1CQUFtQixDQUFDO0VBQ3hDO0VBRUE1RCxnQkFBZ0JBLENBQUNtRSxLQUFLLEVBQUU7SUFDdEI7SUFDQSxJQUFJQSxLQUFLLENBQUNDLElBQUksS0FBS3RHLGlCQUFpQixFQUFFO01BQ3BDO0lBQ0Y7SUFFQSxJQUFJLENBQUNnRiwwQkFBMEIsQ0FBQ2xHLE1BQU0sQ0FBQ3VILEtBQUssQ0FBQztJQUU3QyxJQUFJLENBQUMsSUFBSSxDQUFDbkYsY0FBYyxFQUFFO01BQ3hCLElBQUksQ0FBQ0EsY0FBYyxHQUFHLElBQUk7TUFDMUJ4RSxPQUFPLENBQUNTLElBQUksQ0FBQyxzQ0FBc0MsQ0FBQztNQUNwRCxJQUFJLElBQUksQ0FBQ2lILGNBQWMsRUFBRTtRQUN2QixJQUFJLENBQUNBLGNBQWMsQ0FBQyxJQUFJLENBQUN0RCxpQkFBaUIsQ0FBQztNQUM3QztNQUVBLElBQUksQ0FBQ0MsbUJBQW1CLEdBQUd3RixVQUFVLENBQUMsTUFBTSxJQUFJLENBQUN4SixTQUFTLENBQUMsQ0FBQyxFQUFFLElBQUksQ0FBQytELGlCQUFpQixDQUFDO0lBQ3ZGO0VBQ0Y7RUFFQS9ELFNBQVNBLENBQUEsRUFBRztJQUNWO0lBQ0EsSUFBSSxDQUFDcUksVUFBVSxDQUFDLENBQUM7SUFFakIsSUFBSSxDQUFDWCxPQUFPLENBQUMsQ0FBQyxDQUNYdEcsSUFBSSxDQUFDLE1BQU07TUFDVixJQUFJLENBQUMyQyxpQkFBaUIsR0FBRyxJQUFJLENBQUNELHdCQUF3QjtNQUN0RCxJQUFJLENBQUNJLG9CQUFvQixHQUFHLENBQUM7TUFDN0IsSUFBSSxDQUFDQyxjQUFjLEdBQUcsS0FBSztNQUUzQixJQUFJLElBQUksQ0FBQ21ELGFBQWEsRUFBRTtRQUN0QixJQUFJLENBQUNBLGFBQWEsQ0FBQyxDQUFDO01BQ3RCO0lBQ0YsQ0FBQyxDQUFDLENBQ0QvSCxLQUFLLENBQUNLLEtBQUssSUFBSTtNQUNkLElBQUksQ0FBQ21FLGlCQUFpQixJQUFJLElBQUk7TUFDOUIsSUFBSSxDQUFDRyxvQkFBb0IsRUFBRTtNQUUzQixJQUFJLElBQUksQ0FBQ0Esb0JBQW9CLEdBQUcsSUFBSSxDQUFDRCx1QkFBdUIsRUFBRTtRQUM1RCxNQUFNckUsS0FBSyxHQUFHLElBQUk2SixLQUFLLENBQ3JCLDBGQUNGLENBQUM7UUFDRCxJQUFJLElBQUksQ0FBQ2xDLG1CQUFtQixFQUFFO1VBQzVCLE9BQU8sSUFBSSxDQUFDQSxtQkFBbUIsQ0FBQzNILEtBQUssQ0FBQztRQUN4QyxDQUFDLE1BQU07VUFDTEQsT0FBTyxDQUFDUyxJQUFJLENBQUNSLEtBQUssQ0FBQztVQUNuQjtRQUNGO01BQ0Y7TUFFQUQsT0FBTyxDQUFDUyxJQUFJLENBQUMsbUNBQW1DLENBQUM7TUFDakRULE9BQU8sQ0FBQ1MsSUFBSSxDQUFDUixLQUFLLENBQUM7TUFFbkIsSUFBSSxJQUFJLENBQUN5SCxjQUFjLEVBQUU7UUFDdkIsSUFBSSxDQUFDQSxjQUFjLENBQUMsSUFBSSxDQUFDdEQsaUJBQWlCLENBQUM7TUFDN0M7TUFFQSxJQUFJLENBQUNDLG1CQUFtQixHQUFHd0YsVUFBVSxDQUFDLE1BQU0sSUFBSSxDQUFDeEosU0FBUyxDQUFDLENBQUMsRUFBRSxJQUFJLENBQUMrRCxpQkFBaUIsQ0FBQztJQUN2RixDQUFDLENBQUM7RUFDTjtFQUVBMkYsdUJBQXVCQSxDQUFBLEVBQUc7SUFDeEIsSUFBSSxJQUFJLENBQUNmLHVCQUF1QixFQUFFO01BQ2hDTCxZQUFZLENBQUMsSUFBSSxDQUFDSyx1QkFBdUIsQ0FBQztJQUM1QztJQUVBLElBQUksQ0FBQ0EsdUJBQXVCLEdBQUdhLFVBQVUsQ0FBQyxNQUFNO01BQzlDLElBQUksQ0FBQ2IsdUJBQXVCLEdBQUcsSUFBSTtNQUNuQyxJQUFJLENBQUMzSSxTQUFTLENBQUMsQ0FBQztJQUNsQixDQUFDLEVBQUUsS0FBSyxDQUFDO0VBQ1g7RUFFQW9GLGtCQUFrQkEsQ0FBQ2tFLEtBQUssRUFBRTtJQUN4QixJQUFJLENBQUMzRixPQUFPLENBQUNnRyxPQUFPLENBQUNDLElBQUksQ0FBQ0MsS0FBSyxDQUFDUCxLQUFLLENBQUNRLElBQUksQ0FBQyxDQUFDO0VBQzlDO0VBRUEsTUFBTVQsV0FBV0EsQ0FBQ0YsVUFBVSxFQUFFO0lBQzVCLElBQUksSUFBSSxDQUFDOUUsU0FBUyxDQUFDOEUsVUFBVSxDQUFDLEVBQUU7TUFDOUIsSUFBSSxDQUFDWSxjQUFjLENBQUNaLFVBQVUsQ0FBQztJQUNqQztJQUVBLElBQUksQ0FBQzdFLGFBQWEsQ0FBQzBGLE1BQU0sQ0FBQ2IsVUFBVSxDQUFDO0lBRXJDLElBQUljLFVBQVUsR0FBRyxNQUFNLElBQUksQ0FBQ0MsZ0JBQWdCLENBQUNmLFVBQVUsQ0FBQztJQUV4RCxJQUFJLENBQUNjLFVBQVUsRUFBRTtJQUVqQixJQUFJLENBQUM1RixTQUFTLENBQUM4RSxVQUFVLENBQUMsR0FBR2MsVUFBVTtJQUV2QyxJQUFJLENBQUNFLGNBQWMsQ0FBQ2hCLFVBQVUsRUFBRWMsVUFBVSxDQUFDRyxXQUFXLENBQUM7O0lBRXZEO0lBQ0EsSUFBSSxDQUFDdEQsbUJBQW1CLENBQUNxQyxVQUFVLENBQUM7SUFDcEMsSUFBSSxDQUFDMUMsa0JBQWtCLENBQUMsSUFBSSxDQUFDcEMsU0FBUyxDQUFDO0lBRXZDLE9BQU80RixVQUFVO0VBQ25CO0VBRUExQixrQkFBa0JBLENBQUEsRUFBRztJQUNuQixLQUFLLE1BQU1ZLFVBQVUsSUFBSWtCLE1BQU0sQ0FBQ0MsbUJBQW1CLENBQUMsSUFBSSxDQUFDakcsU0FBUyxDQUFDLEVBQUU7TUFDbkUsSUFBSSxDQUFDMEYsY0FBYyxDQUFDWixVQUFVLENBQUM7SUFDakM7RUFDRjtFQUVBWSxjQUFjQSxDQUFDWixVQUFVLEVBQUU7SUFDekIsSUFBSSxDQUFDN0UsYUFBYSxDQUFDaUcsR0FBRyxDQUFDcEIsVUFBVSxDQUFDO0lBRWxDLElBQUksSUFBSSxDQUFDOUUsU0FBUyxDQUFDOEUsVUFBVSxDQUFDLEVBQUU7TUFDOUI7TUFDQSxJQUFJLENBQUM5RSxTQUFTLENBQUM4RSxVQUFVLENBQUMsQ0FBQ1gsSUFBSSxDQUFDQyxLQUFLLENBQUMsQ0FBQztNQUN2QyxPQUFPLElBQUksQ0FBQ3BFLFNBQVMsQ0FBQzhFLFVBQVUsQ0FBQztJQUNuQztJQUVBLElBQUksSUFBSSxDQUFDM0UsWUFBWSxDQUFDMkUsVUFBVSxDQUFDLEVBQUU7TUFDakMsT0FBTyxJQUFJLENBQUMzRSxZQUFZLENBQUMyRSxVQUFVLENBQUM7SUFDdEM7SUFFQSxJQUFJLElBQUksQ0FBQ3pFLG9CQUFvQixDQUFDOEYsR0FBRyxDQUFDckIsVUFBVSxDQUFDLEVBQUU7TUFDN0MsTUFBTXNCLEdBQUcsR0FBRyw2REFBNkQ7TUFDekUsSUFBSSxDQUFDL0Ysb0JBQW9CLENBQUNnRyxHQUFHLENBQUN2QixVQUFVLENBQUMsQ0FBQ3dCLEtBQUssQ0FBQzVJLE1BQU0sQ0FBQzBJLEdBQUcsQ0FBQztNQUMzRCxJQUFJLENBQUMvRixvQkFBb0IsQ0FBQ2dHLEdBQUcsQ0FBQ3ZCLFVBQVUsQ0FBQyxDQUFDNUcsS0FBSyxDQUFDUixNQUFNLENBQUMwSSxHQUFHLENBQUM7TUFDM0QsSUFBSSxDQUFDL0Ysb0JBQW9CLENBQUNzRixNQUFNLENBQUNiLFVBQVUsQ0FBQztJQUM5Qzs7SUFFQTtJQUNBLElBQUksQ0FBQ3BDLHNCQUFzQixDQUFDb0MsVUFBVSxDQUFDO0lBQ3ZDLElBQUksQ0FBQzFDLGtCQUFrQixDQUFDLElBQUksQ0FBQ3BDLFNBQVMsQ0FBQztFQUN6QztFQUVBdUcsU0FBU0EsQ0FBQ3BDLElBQUksRUFBRXFDLE1BQU0sRUFBRTtJQUN0QnJDLElBQUksQ0FBQ25HLGdCQUFnQixDQUFDLGNBQWMsRUFBRXlJLEVBQUUsSUFBSTtNQUMxQ0QsTUFBTSxDQUFDRSxXQUFXLENBQUNELEVBQUUsQ0FBQ0UsU0FBUyxJQUFJLElBQUksQ0FBQyxDQUFDekwsS0FBSyxDQUFDQyxDQUFDLElBQUlJLEtBQUssQ0FBQyx5QkFBeUIsRUFBRUosQ0FBQyxDQUFDLENBQUM7SUFDMUYsQ0FBQyxDQUFDO0lBQ0ZnSixJQUFJLENBQUNuRyxnQkFBZ0IsQ0FBQywwQkFBMEIsRUFBRXlJLEVBQUUsSUFBSTtNQUN0RCxJQUFJdEMsSUFBSSxDQUFDeUMsa0JBQWtCLEtBQUssV0FBVyxFQUFFO1FBQzNDdEwsT0FBTyxDQUFDUSxHQUFHLENBQUMsZ0NBQWdDLENBQUM7TUFDL0M7TUFDQSxJQUFJcUksSUFBSSxDQUFDeUMsa0JBQWtCLEtBQUssY0FBYyxFQUFFO1FBQzlDdEwsT0FBTyxDQUFDUyxJQUFJLENBQUMsbUNBQW1DLENBQUM7TUFDbkQ7TUFDQSxJQUFJb0ksSUFBSSxDQUFDeUMsa0JBQWtCLEtBQUssUUFBUSxFQUFFO1FBQ3hDdEwsT0FBTyxDQUFDUyxJQUFJLENBQUMsNENBQTRDLENBQUM7UUFDMUQsSUFBSSxDQUFDc0osdUJBQXVCLENBQUMsQ0FBQztNQUNoQztJQUNGLENBQUMsQ0FBQzs7SUFFRjtJQUNBO0lBQ0E7SUFDQTtJQUNBbEIsSUFBSSxDQUFDbkcsZ0JBQWdCLENBQ25CLG1CQUFtQixFQUNuQjNCLFFBQVEsQ0FBQ29LLEVBQUUsSUFBSTtNQUNiNUssS0FBSyxDQUFDLGtDQUFrQyxFQUFFMkssTUFBTSxDQUFDO01BQ2pELElBQUlLLEtBQUssR0FBRzFDLElBQUksQ0FBQzJDLFdBQVcsQ0FBQyxDQUFDLENBQUMvSixJQUFJLENBQUMsSUFBSSxDQUFDZ0sscUJBQXFCLENBQUMsQ0FBQ2hLLElBQUksQ0FBQyxJQUFJLENBQUNpSyxpQkFBaUIsQ0FBQztNQUM1RixJQUFJQyxLQUFLLEdBQUdKLEtBQUssQ0FBQzlKLElBQUksQ0FBQ21LLENBQUMsSUFBSS9DLElBQUksQ0FBQ2dELG1CQUFtQixDQUFDRCxDQUFDLENBQUMsQ0FBQztNQUN4RCxJQUFJRSxNQUFNLEdBQUdQLEtBQUs7TUFFbEJPLE1BQU0sR0FBR0EsTUFBTSxDQUNackssSUFBSSxDQUFDLElBQUksQ0FBQ2lLLGlCQUFpQixDQUFDLENBQzVCakssSUFBSSxDQUFDc0ssQ0FBQyxJQUFJYixNQUFNLENBQUNjLFFBQVEsQ0FBQ0QsQ0FBQyxDQUFDLENBQUMsQ0FDN0J0SyxJQUFJLENBQUN3SyxDQUFDLElBQUlwRCxJQUFJLENBQUNxRCxvQkFBb0IsQ0FBQ0QsQ0FBQyxDQUFDRSxJQUFJLENBQUMsQ0FBQztNQUMvQyxPQUFPakwsT0FBTyxDQUFDc0gsR0FBRyxDQUFDLENBQUNtRCxLQUFLLEVBQUVHLE1BQU0sQ0FBQyxDQUFDLENBQUNsTSxLQUFLLENBQUNDLENBQUMsSUFBSUksS0FBSyxDQUFDLDZCQUE2QixFQUFFSixDQUFDLENBQUMsQ0FBQztJQUN6RixDQUFDLENBQ0gsQ0FBQztJQUNEcUwsTUFBTSxDQUFDa0IsRUFBRSxDQUNQLE9BQU8sRUFDUHJMLFFBQVEsQ0FBQ29LLEVBQUUsSUFBSTtNQUNiLElBQUlnQixJQUFJLEdBQUdoQixFQUFFLENBQUNnQixJQUFJO01BQ2xCLElBQUlBLElBQUksSUFBSUEsSUFBSSxDQUFDek0sSUFBSSxJQUFJLE9BQU8sRUFBRTtRQUNoQ2EsS0FBSyxDQUFDLG9DQUFvQyxFQUFFMkssTUFBTSxDQUFDO1FBQ25ELElBQUltQixNQUFNLEdBQUd4RCxJQUFJLENBQ2RxRCxvQkFBb0IsQ0FBQyxJQUFJLENBQUNJLHNCQUFzQixDQUFDSCxJQUFJLENBQUMsQ0FBQyxDQUN2RDFLLElBQUksQ0FBQ0MsQ0FBQyxJQUFJbUgsSUFBSSxDQUFDMEQsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUM5QjlLLElBQUksQ0FBQyxJQUFJLENBQUNpSyxpQkFBaUIsQ0FBQztRQUMvQixJQUFJQyxLQUFLLEdBQUdVLE1BQU0sQ0FBQzVLLElBQUksQ0FBQytLLENBQUMsSUFBSTNELElBQUksQ0FBQ2dELG1CQUFtQixDQUFDVyxDQUFDLENBQUMsQ0FBQztRQUN6RCxJQUFJVixNQUFNLEdBQUdPLE1BQU0sQ0FBQzVLLElBQUksQ0FBQ3NLLENBQUMsSUFBSWIsTUFBTSxDQUFDYyxRQUFRLENBQUNELENBQUMsQ0FBQyxDQUFDO1FBQ2pELE9BQU83SyxPQUFPLENBQUNzSCxHQUFHLENBQUMsQ0FBQ21ELEtBQUssRUFBRUcsTUFBTSxDQUFDLENBQUMsQ0FBQ2xNLEtBQUssQ0FBQ0MsQ0FBQyxJQUFJSSxLQUFLLENBQUMsOEJBQThCLEVBQUVKLENBQUMsQ0FBQyxDQUFDO01BQzFGLENBQUMsTUFBTTtRQUNMO1FBQ0EsT0FBTyxJQUFJO01BQ2I7SUFDRixDQUFDLENBQ0gsQ0FBQztFQUNIO0VBRUEsTUFBTXNKLGVBQWVBLENBQUEsRUFBRztJQUN0QixJQUFJK0IsTUFBTSxHQUFHLElBQUk5TCxFQUFFLENBQUNxTixpQkFBaUIsQ0FBQyxJQUFJLENBQUN6SSxPQUFPLENBQUM7SUFDbkQsSUFBSTZFLElBQUksR0FBRyxJQUFJNkQsaUJBQWlCLENBQUMsSUFBSSxDQUFDNUksb0JBQW9CLElBQUlYLDhCQUE4QixDQUFDO0lBRTdGNUMsS0FBSyxDQUFDLHFCQUFxQixDQUFDO0lBQzVCLE1BQU0ySyxNQUFNLENBQUN5QixNQUFNLENBQUMsa0JBQWtCLEVBQUUsSUFBSSxDQUFDN0UsS0FBSyxJQUFJLElBQUksQ0FBQ3BFLFFBQVEsR0FBR2tKLFFBQVEsQ0FBQyxJQUFJLENBQUNsSixRQUFRLENBQUMsR0FBRyxJQUFJLENBQUNvRSxLQUFLLEdBQUcrRSxTQUFTLENBQUM7SUFFdkgsSUFBSSxDQUFDNUIsU0FBUyxDQUFDcEMsSUFBSSxFQUFFcUMsTUFBTSxDQUFDO0lBRTVCM0ssS0FBSyxDQUFDLDBDQUEwQyxDQUFDO0lBQ2pELElBQUl1TSxRQUFRLEdBQUcsSUFBSTVMLE9BQU8sQ0FBQ0MsT0FBTyxJQUFJK0osTUFBTSxDQUFDa0IsRUFBRSxDQUFDLFVBQVUsRUFBRWpMLE9BQU8sQ0FBQyxDQUFDOztJQUVyRTtJQUNBO0lBQ0EsSUFBSTRMLGVBQWUsR0FBR2xFLElBQUksQ0FBQ21FLGlCQUFpQixDQUFDLFVBQVUsRUFBRTtNQUFFQyxPQUFPLEVBQUU7SUFBSyxDQUFDLENBQUM7SUFDM0UsSUFBSUMsaUJBQWlCLEdBQUdyRSxJQUFJLENBQUNtRSxpQkFBaUIsQ0FBQyxZQUFZLEVBQUU7TUFDM0RDLE9BQU8sRUFBRSxLQUFLO01BQ2RFLGNBQWMsRUFBRTtJQUNsQixDQUFDLENBQUM7SUFFRkosZUFBZSxDQUFDckssZ0JBQWdCLENBQUMsU0FBUyxFQUFFN0MsQ0FBQyxJQUFJLElBQUksQ0FBQzZGLG9CQUFvQixDQUFDN0YsQ0FBQyxFQUFFLGdCQUFnQixDQUFDLENBQUM7SUFDaEdxTixpQkFBaUIsQ0FBQ3hLLGdCQUFnQixDQUFDLFNBQVMsRUFBRTdDLENBQUMsSUFBSSxJQUFJLENBQUM2RixvQkFBb0IsQ0FBQzdGLENBQUMsRUFBRSxrQkFBa0IsQ0FBQyxDQUFDO0lBRXBHLE1BQU1pTixRQUFRO0lBQ2QsTUFBTTVLLG9CQUFvQixDQUFDNkssZUFBZSxDQUFDO0lBQzNDLE1BQU03SyxvQkFBb0IsQ0FBQ2dMLGlCQUFpQixDQUFDOztJQUU3QztJQUNBO0lBQ0E7SUFDQTtJQUNBO0lBQ0EsSUFBSSxJQUFJLENBQUNwSSxnQkFBZ0IsRUFBRTtNQUN6QixJQUFJLENBQUNBLGdCQUFnQixDQUFDc0ksU0FBUyxDQUFDLENBQUMsQ0FBQ0MsT0FBTyxDQUFDQyxLQUFLLElBQUk7UUFDakR6RSxJQUFJLENBQUMwRSxRQUFRLENBQUNELEtBQUssRUFBRSxJQUFJLENBQUN4SSxnQkFBZ0IsQ0FBQztNQUM3QyxDQUFDLENBQUM7SUFDSjs7SUFFQTtJQUNBb0csTUFBTSxDQUFDa0IsRUFBRSxDQUFDLE9BQU8sRUFBRWpCLEVBQUUsSUFBSTtNQUN2QixJQUFJaEIsSUFBSSxHQUFHZ0IsRUFBRSxDQUFDcUMsVUFBVSxDQUFDckQsSUFBSTtNQUM3QixJQUFJQSxJQUFJLENBQUNSLEtBQUssSUFBSSxNQUFNLElBQUlRLElBQUksQ0FBQ3NELE9BQU8sSUFBSSxJQUFJLENBQUNoSyxJQUFJLEVBQUU7UUFDckQsSUFBSSxJQUFJLENBQUN1Rix1QkFBdUIsRUFBRTtVQUNoQztVQUNBO1FBQ0Y7UUFDQSxJQUFJLENBQUNVLFdBQVcsQ0FBQ1MsSUFBSSxDQUFDdUQsT0FBTyxDQUFDO01BQ2hDLENBQUMsTUFBTSxJQUFJdkQsSUFBSSxDQUFDUixLQUFLLElBQUksT0FBTyxJQUFJUSxJQUFJLENBQUNzRCxPQUFPLElBQUksSUFBSSxDQUFDaEssSUFBSSxFQUFFO1FBQzdELElBQUksQ0FBQzJHLGNBQWMsQ0FBQ0QsSUFBSSxDQUFDdUQsT0FBTyxDQUFDO01BQ25DLENBQUMsTUFBTSxJQUFJdkQsSUFBSSxDQUFDUixLQUFLLElBQUksU0FBUyxFQUFFO1FBQ2xDOUcsUUFBUSxDQUFDOEssSUFBSSxDQUFDQyxhQUFhLENBQUMsSUFBSUMsV0FBVyxDQUFDLFNBQVMsRUFBRTtVQUFFQyxNQUFNLEVBQUU7WUFBRXBLLFFBQVEsRUFBRXlHLElBQUksQ0FBQzREO1VBQUc7UUFBRSxDQUFDLENBQUMsQ0FBQztNQUM1RixDQUFDLE1BQU0sSUFBSTVELElBQUksQ0FBQ1IsS0FBSyxJQUFJLFdBQVcsRUFBRTtRQUNwQzlHLFFBQVEsQ0FBQzhLLElBQUksQ0FBQ0MsYUFBYSxDQUFDLElBQUlDLFdBQVcsQ0FBQyxXQUFXLEVBQUU7VUFBRUMsTUFBTSxFQUFFO1lBQUVwSyxRQUFRLEVBQUV5RyxJQUFJLENBQUM0RDtVQUFHO1FBQUUsQ0FBQyxDQUFDLENBQUM7TUFDOUYsQ0FBQyxNQUFNLElBQUk1RCxJQUFJLENBQUNSLEtBQUssS0FBSyxNQUFNLEVBQUU7UUFDaEMsSUFBSSxDQUFDaEUsTUFBTSxDQUFDc0UsSUFBSSxDQUFDQyxLQUFLLENBQUNDLElBQUksQ0FBQ3dELElBQUksQ0FBQyxFQUFFLGFBQWEsQ0FBQztNQUNuRDtJQUNGLENBQUMsQ0FBQztJQUVGcE4sS0FBSyxDQUFDLHNCQUFzQixDQUFDOztJQUU3QjtJQUNBLElBQUlULE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQ2tPLFFBQVEsQ0FBQzlDLE1BQU0sRUFBRTtNQUN4QytDLGFBQWEsRUFBRSxJQUFJO01BQ25COUQsSUFBSSxFQUFFO0lBQ1IsQ0FBQyxDQUFDO0lBRUYsSUFBSSxDQUFDckssT0FBTyxDQUFDME4sVUFBVSxDQUFDckQsSUFBSSxDQUFDK0QsT0FBTyxFQUFFO01BQ3BDLE1BQU1DLEdBQUcsR0FBR3JPLE9BQU8sQ0FBQzBOLFVBQVUsQ0FBQ3JELElBQUksQ0FBQ2xLLEtBQUs7TUFDekNELE9BQU8sQ0FBQ0MsS0FBSyxDQUFDa08sR0FBRyxDQUFDO01BQ2xCO01BQ0E7TUFDQTtNQUNBO01BQ0E7TUFDQTtNQUNBO01BQ0F0RixJQUFJLENBQUNDLEtBQUssQ0FBQyxDQUFDO01BQ1osTUFBTXFGLEdBQUc7SUFDWDtJQUVBLElBQUk3RSxnQkFBZ0IsR0FBR3hKLE9BQU8sQ0FBQzBOLFVBQVUsQ0FBQ3JELElBQUksQ0FBQ2lFLFFBQVEsQ0FBQ0MsS0FBSyxDQUFDLElBQUksQ0FBQzVLLElBQUksQ0FBQyxJQUFJLEVBQUU7SUFFOUUsSUFBSTZGLGdCQUFnQixDQUFDZ0YsUUFBUSxDQUFDLElBQUksQ0FBQzVLLFFBQVEsQ0FBQyxFQUFFO01BQzVDMUQsT0FBTyxDQUFDUyxJQUFJLENBQUMsd0VBQXdFLENBQUM7TUFDdEYsSUFBSSxDQUFDc0osdUJBQXVCLENBQUMsQ0FBQztJQUNoQztJQUVBeEosS0FBSyxDQUFDLGlCQUFpQixDQUFDO0lBQ3hCLE9BQU87TUFDTDJLLE1BQU07TUFDTjVCLGdCQUFnQjtNQUNoQnlELGVBQWU7TUFDZkcsaUJBQWlCO01BQ2pCckU7SUFDRixDQUFDO0VBQ0g7RUFFQTRDLHFCQUFxQkEsQ0FBQ1UsSUFBSSxFQUFFO0lBQzFCQSxJQUFJLENBQUNvQyxHQUFHLEdBQUdwQyxJQUFJLENBQUNvQyxHQUFHLENBQUNDLE9BQU8sQ0FBQyx5QkFBeUIsRUFBRSxDQUFDQyxJQUFJLEVBQUVDLEVBQUUsS0FBSztNQUNuRSxNQUFNQyxVQUFVLEdBQUdqRSxNQUFNLENBQUNrRSxNQUFNLENBQUN0TyxRQUFRLENBQUN1TyxTQUFTLENBQUNKLElBQUksQ0FBQyxFQUFFekwsZUFBZSxDQUFDO01BQzNFLE9BQU8xQyxRQUFRLENBQUN3TyxTQUFTLENBQUM7UUFBRUMsV0FBVyxFQUFFTCxFQUFFO1FBQUVDLFVBQVUsRUFBRUE7TUFBVyxDQUFDLENBQUM7SUFDeEUsQ0FBQyxDQUFDO0lBQ0YsT0FBT3hDLElBQUk7RUFDYjtFQUVBRyxzQkFBc0JBLENBQUNILElBQUksRUFBRTtJQUMzQjtJQUNBLElBQUksQ0FBQ3hKLG9CQUFvQixFQUFFO01BQ3pCLElBQUkvQixTQUFTLENBQUNDLFNBQVMsQ0FBQ2QsT0FBTyxDQUFDLGdCQUFnQixDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUU7UUFDeEQ7UUFDQW9NLElBQUksQ0FBQ29DLEdBQUcsR0FBR3BDLElBQUksQ0FBQ29DLEdBQUcsQ0FBQ0MsT0FBTyxDQUFDLGVBQWUsRUFBRSxJQUFJLENBQUM7TUFDcEQ7SUFDRjs7SUFFQTtJQUNBLElBQUk1TixTQUFTLENBQUNDLFNBQVMsQ0FBQ2QsT0FBTyxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFO01BQ2pEb00sSUFBSSxDQUFDb0MsR0FBRyxHQUFHcEMsSUFBSSxDQUFDb0MsR0FBRyxDQUFDQyxPQUFPLENBQ3pCLDZCQUE2QixFQUM3QixnSkFDRixDQUFDO0lBQ0gsQ0FBQyxNQUFNO01BQ0xyQyxJQUFJLENBQUNvQyxHQUFHLEdBQUdwQyxJQUFJLENBQUNvQyxHQUFHLENBQUNDLE9BQU8sQ0FDekIsNkJBQTZCLEVBQzdCLGdKQUNGLENBQUM7SUFDSDtJQUNBLE9BQU9yQyxJQUFJO0VBQ2I7RUFFQSxNQUFNVCxpQkFBaUJBLENBQUNTLElBQUksRUFBRTtJQUM1QjtJQUNBQSxJQUFJLENBQUNvQyxHQUFHLEdBQUdwQyxJQUFJLENBQUNvQyxHQUFHLENBQUNDLE9BQU8sQ0FBQyxxQkFBcUIsRUFBRSxpQkFBaUIsQ0FBQztJQUNyRSxPQUFPckMsSUFBSTtFQUNiO0VBRUEsTUFBTTVCLGdCQUFnQkEsQ0FBQ2YsVUFBVSxFQUFFd0YsVUFBVSxHQUFHLENBQUMsRUFBRTtJQUNqRCxJQUFJLElBQUksQ0FBQ3JLLGFBQWEsQ0FBQ2tHLEdBQUcsQ0FBQ3JCLFVBQVUsQ0FBQyxFQUFFO01BQ3RDeEosT0FBTyxDQUFDUyxJQUFJLENBQUMrSSxVQUFVLEdBQUcsZ0ZBQWdGLENBQUM7TUFDM0csT0FBTyxJQUFJO0lBQ2I7SUFFQSxJQUFJMEIsTUFBTSxHQUFHLElBQUk5TCxFQUFFLENBQUNxTixpQkFBaUIsQ0FBQyxJQUFJLENBQUN6SSxPQUFPLENBQUM7SUFDbkQsSUFBSTZFLElBQUksR0FBRyxJQUFJNkQsaUJBQWlCLENBQUMsSUFBSSxDQUFDNUksb0JBQW9CLElBQUlYLDhCQUE4QixDQUFDO0lBRTdGNUMsS0FBSyxDQUFDaUosVUFBVSxHQUFHLHVCQUF1QixDQUFDO0lBQzNDLE1BQU0wQixNQUFNLENBQUN5QixNQUFNLENBQUMsa0JBQWtCLEVBQUUsSUFBSSxDQUFDN0UsS0FBSyxHQUFHOEUsUUFBUSxDQUFDcEQsVUFBVSxDQUFDLEdBQUcsSUFBSSxDQUFDMUIsS0FBSyxHQUFHK0UsU0FBUyxDQUFDO0lBRW5HLElBQUksQ0FBQzVCLFNBQVMsQ0FBQ3BDLElBQUksRUFBRXFDLE1BQU0sQ0FBQztJQUU1QjNLLEtBQUssQ0FBQ2lKLFVBQVUsR0FBRyx3QkFBd0IsQ0FBQztJQUU1QyxJQUFJLElBQUksQ0FBQzdFLGFBQWEsQ0FBQ2tHLEdBQUcsQ0FBQ3JCLFVBQVUsQ0FBQyxFQUFFO01BQ3RDWCxJQUFJLENBQUNDLEtBQUssQ0FBQyxDQUFDO01BQ1o5SSxPQUFPLENBQUNTLElBQUksQ0FBQytJLFVBQVUsR0FBRyw2REFBNkQsQ0FBQztNQUN4RixPQUFPLElBQUk7SUFDYjtJQUVBLElBQUl5RixZQUFZLEdBQUcsS0FBSztJQUV4QixNQUFNbkMsUUFBUSxHQUFHLElBQUk1TCxPQUFPLENBQUNDLE9BQU8sSUFBSTtNQUN0QyxNQUFNK04sWUFBWSxHQUFHQyxXQUFXLENBQUMsTUFBTTtRQUNyQyxJQUFJLElBQUksQ0FBQ3hLLGFBQWEsQ0FBQ2tHLEdBQUcsQ0FBQ3JCLFVBQVUsQ0FBQyxFQUFFO1VBQ3RDNEYsYUFBYSxDQUFDRixZQUFZLENBQUM7VUFDM0IvTixPQUFPLENBQUMsQ0FBQztRQUNYO01BQ0YsQ0FBQyxFQUFFLElBQUksQ0FBQztNQUVSLE1BQU1rTyxPQUFPLEdBQUd4RixVQUFVLENBQUMsTUFBTTtRQUMvQnVGLGFBQWEsQ0FBQ0YsWUFBWSxDQUFDO1FBQzNCRCxZQUFZLEdBQUcsSUFBSTtRQUNuQjlOLE9BQU8sQ0FBQyxDQUFDO01BQ1gsQ0FBQyxFQUFFTCxvQkFBb0IsQ0FBQztNQUV4Qm9LLE1BQU0sQ0FBQ2tCLEVBQUUsQ0FBQyxVQUFVLEVBQUUsTUFBTTtRQUMxQnpELFlBQVksQ0FBQzBHLE9BQU8sQ0FBQztRQUNyQkQsYUFBYSxDQUFDRixZQUFZLENBQUM7UUFDM0IvTixPQUFPLENBQUMsQ0FBQztNQUNYLENBQUMsQ0FBQztJQUNKLENBQUMsQ0FBQzs7SUFFRjtJQUNBO0lBQ0EsTUFBTSxJQUFJLENBQUM2TSxRQUFRLENBQUM5QyxNQUFNLEVBQUU7TUFBRW9FLEtBQUssRUFBRTlGO0lBQVcsQ0FBQyxDQUFDO0lBRWxELElBQUksSUFBSSxDQUFDN0UsYUFBYSxDQUFDa0csR0FBRyxDQUFDckIsVUFBVSxDQUFDLEVBQUU7TUFDdENYLElBQUksQ0FBQ0MsS0FBSyxDQUFDLENBQUM7TUFDWjlJLE9BQU8sQ0FBQ1MsSUFBSSxDQUFDK0ksVUFBVSxHQUFHLDJEQUEyRCxDQUFDO01BQ3RGLE9BQU8sSUFBSTtJQUNiO0lBRUFqSixLQUFLLENBQUNpSixVQUFVLEdBQUcsNEJBQTRCLENBQUM7SUFDaEQsTUFBTXNELFFBQVE7SUFFZCxJQUFJLElBQUksQ0FBQ25JLGFBQWEsQ0FBQ2tHLEdBQUcsQ0FBQ3JCLFVBQVUsQ0FBQyxFQUFFO01BQ3RDWCxJQUFJLENBQUNDLEtBQUssQ0FBQyxDQUFDO01BQ1o5SSxPQUFPLENBQUNTLElBQUksQ0FBQytJLFVBQVUsR0FBRyxzRUFBc0UsQ0FBQztNQUNqRyxPQUFPLElBQUk7SUFDYjtJQUVBLElBQUl5RixZQUFZLEVBQUU7TUFDaEJwRyxJQUFJLENBQUNDLEtBQUssQ0FBQyxDQUFDO01BQ1osSUFBSWtHLFVBQVUsR0FBRyxDQUFDLEVBQUU7UUFDbEJoUCxPQUFPLENBQUNTLElBQUksQ0FBQytJLFVBQVUsR0FBRyxpQ0FBaUMsQ0FBQztRQUM1RCxPQUFPLElBQUksQ0FBQ2UsZ0JBQWdCLENBQUNmLFVBQVUsRUFBRXdGLFVBQVUsR0FBRyxDQUFDLENBQUM7TUFDMUQsQ0FBQyxNQUFNO1FBQ0xoUCxPQUFPLENBQUNTLElBQUksQ0FBQytJLFVBQVUsR0FBRyx1QkFBdUIsQ0FBQztRQUNsRCxPQUFPLElBQUk7TUFDYjtJQUNGO0lBRUEsSUFBSTlJLFFBQVEsSUFBSSxDQUFDLElBQUksQ0FBQzZPLDBCQUEwQixFQUFFO01BQ2hEO01BQ0E7TUFDQSxNQUFPLElBQUlyTyxPQUFPLENBQUVDLE9BQU8sSUFBSzBJLFVBQVUsQ0FBQzFJLE9BQU8sRUFBRSxJQUFJLENBQUMsQ0FBRTtNQUMzRCxJQUFJLENBQUNvTywwQkFBMEIsR0FBRyxJQUFJO0lBQ3hDO0lBRUEsSUFBSTlFLFdBQVcsR0FBRyxJQUFJK0UsV0FBVyxDQUFDLENBQUM7SUFDbkMsSUFBSUMsU0FBUyxHQUFHNUcsSUFBSSxDQUFDNkcsWUFBWSxDQUFDLENBQUM7SUFDbkNELFNBQVMsQ0FBQ3BDLE9BQU8sQ0FBQ3NDLFFBQVEsSUFBSTtNQUM1QixJQUFJQSxRQUFRLENBQUNyQyxLQUFLLEVBQUU7UUFDbEI3QyxXQUFXLENBQUM4QyxRQUFRLENBQUNvQyxRQUFRLENBQUNyQyxLQUFLLENBQUM7TUFDdEM7SUFDRixDQUFDLENBQUM7SUFDRixJQUFJN0MsV0FBVyxDQUFDMkMsU0FBUyxDQUFDLENBQUMsQ0FBQzdELE1BQU0sS0FBSyxDQUFDLEVBQUU7TUFDeENrQixXQUFXLEdBQUcsSUFBSTtJQUNwQjtJQUVBbEssS0FBSyxDQUFDaUosVUFBVSxHQUFHLG9CQUFvQixDQUFDO0lBQ3hDLE9BQU87TUFDTDBCLE1BQU07TUFDTlQsV0FBVztNQUNYNUI7SUFDRixDQUFDO0VBQ0g7RUFFQW1GLFFBQVFBLENBQUM5QyxNQUFNLEVBQUUwRSxTQUFTLEVBQUU7SUFDMUIsT0FBTzFFLE1BQU0sQ0FBQzJFLFdBQVcsQ0FBQztNQUN4QkMsSUFBSSxFQUFFLE1BQU07TUFDWnJDLE9BQU8sRUFBRSxJQUFJLENBQUNoSyxJQUFJO01BQ2xCaUssT0FBTyxFQUFFLElBQUksQ0FBQ2hLLFFBQVE7TUFDdEJrTSxTQUFTO01BQ1RHLEtBQUssRUFBRSxJQUFJLENBQUNwTTtJQUNkLENBQUMsQ0FBQztFQUNKO0VBRUFxTSxZQUFZQSxDQUFBLEVBQUc7SUFDYixJQUFJLElBQUksQ0FBQ0MsTUFBTSxFQUFFO01BQ2YsSUFBSSxDQUFDQyxRQUFRLENBQUMsQ0FBQztJQUNqQixDQUFDLE1BQU07TUFDTCxJQUFJLENBQUNDLE1BQU0sQ0FBQyxDQUFDO0lBQ2Y7RUFDRjtFQUVBQSxNQUFNQSxDQUFBLEVBQUc7SUFDUCxJQUFJLENBQUNGLE1BQU0sR0FBRyxJQUFJO0VBQ3BCO0VBRUFDLFFBQVFBLENBQUEsRUFBRztJQUNULElBQUksQ0FBQ0QsTUFBTSxHQUFHLEtBQUs7SUFDbkIsSUFBSSxDQUFDRyxtQkFBbUIsQ0FBQyxDQUFDO0VBQzVCO0VBRUFDLHlCQUF5QkEsQ0FBQ0MsU0FBUyxFQUFFeFEsT0FBTyxFQUFFO0lBQzVDO0lBQ0E7SUFDQTtJQUNBLEtBQUssSUFBSXVKLENBQUMsR0FBRyxDQUFDLEVBQUVrSCxDQUFDLEdBQUd6USxPQUFPLENBQUNxSyxJQUFJLENBQUNxRyxDQUFDLENBQUNqSCxNQUFNLEVBQUVGLENBQUMsR0FBR2tILENBQUMsRUFBRWxILENBQUMsRUFBRSxFQUFFO01BQ3JELE1BQU1jLElBQUksR0FBR3JLLE9BQU8sQ0FBQ3FLLElBQUksQ0FBQ3FHLENBQUMsQ0FBQ25ILENBQUMsQ0FBQztNQUU5QixJQUFJYyxJQUFJLENBQUNtRyxTQUFTLEtBQUtBLFNBQVMsRUFBRTtRQUNoQyxPQUFPbkcsSUFBSTtNQUNiO0lBQ0Y7SUFFQSxPQUFPLElBQUk7RUFDYjtFQUVBc0csY0FBY0EsQ0FBQ0gsU0FBUyxFQUFFeFEsT0FBTyxFQUFFO0lBQ2pDLElBQUksQ0FBQ0EsT0FBTyxFQUFFLE9BQU8sSUFBSTtJQUV6QixJQUFJcUssSUFBSSxHQUFHckssT0FBTyxDQUFDNFEsUUFBUSxLQUFLLElBQUksR0FBRyxJQUFJLENBQUNMLHlCQUF5QixDQUFDQyxTQUFTLEVBQUV4USxPQUFPLENBQUMsR0FBR0EsT0FBTyxDQUFDcUssSUFBSTs7SUFFeEc7SUFDQTtJQUNBO0lBQ0EsSUFBSUEsSUFBSSxDQUFDd0csS0FBSyxJQUFJLENBQUMsSUFBSSxDQUFDak0sU0FBUyxDQUFDeUYsSUFBSSxDQUFDd0csS0FBSyxDQUFDLEVBQUUsT0FBTyxJQUFJOztJQUUxRDtJQUNBLElBQUl4RyxJQUFJLENBQUN3RyxLQUFLLElBQUksSUFBSSxDQUFDMUwsY0FBYyxDQUFDNEYsR0FBRyxDQUFDVixJQUFJLENBQUN3RyxLQUFLLENBQUMsRUFBRSxPQUFPLElBQUk7SUFFbEUsT0FBT3hHLElBQUk7RUFDYjs7RUFFQTtFQUNBeUcsMEJBQTBCQSxDQUFDTixTQUFTLEVBQUU7SUFDcEMsT0FBTyxJQUFJLENBQUNHLGNBQWMsQ0FBQ0gsU0FBUyxFQUFFLElBQUksQ0FBQ3BMLGFBQWEsQ0FBQzZGLEdBQUcsQ0FBQ3VGLFNBQVMsQ0FBQyxDQUFDO0VBQzFFO0VBRUFGLG1CQUFtQkEsQ0FBQSxFQUFHO0lBQ3BCLEtBQUssTUFBTSxDQUFDRSxTQUFTLEVBQUV4USxPQUFPLENBQUMsSUFBSSxJQUFJLENBQUNvRixhQUFhLEVBQUU7TUFDckQsSUFBSWlGLElBQUksR0FBRyxJQUFJLENBQUNzRyxjQUFjLENBQUNILFNBQVMsRUFBRXhRLE9BQU8sQ0FBQztNQUNsRCxJQUFJLENBQUNxSyxJQUFJLEVBQUU7O01BRVg7TUFDQTtNQUNBLE1BQU11RyxRQUFRLEdBQUc1USxPQUFPLENBQUM0USxRQUFRLEtBQUssSUFBSSxHQUFHLEdBQUcsR0FBRzVRLE9BQU8sQ0FBQzRRLFFBQVE7TUFFbkUsSUFBSSxDQUFDckosaUJBQWlCLENBQUMsSUFBSSxFQUFFcUosUUFBUSxFQUFFdkcsSUFBSSxFQUFFckssT0FBTyxDQUFDK1EsTUFBTSxDQUFDO0lBQzlEO0lBQ0EsSUFBSSxDQUFDM0wsYUFBYSxDQUFDMUMsS0FBSyxDQUFDLENBQUM7RUFDNUI7RUFFQXNPLFlBQVlBLENBQUNoUixPQUFPLEVBQUU7SUFDcEIsSUFBSUEsT0FBTyxDQUFDNFEsUUFBUSxLQUFLLElBQUksRUFBRTtNQUFFO01BQy9CLEtBQUssSUFBSXJILENBQUMsR0FBRyxDQUFDLEVBQUVrSCxDQUFDLEdBQUd6USxPQUFPLENBQUNxSyxJQUFJLENBQUNxRyxDQUFDLENBQUNqSCxNQUFNLEVBQUVGLENBQUMsR0FBR2tILENBQUMsRUFBRWxILENBQUMsRUFBRSxFQUFFO1FBQ3JELElBQUksQ0FBQzBILGtCQUFrQixDQUFDalIsT0FBTyxFQUFFdUosQ0FBQyxDQUFDO01BQ3JDO0lBQ0YsQ0FBQyxNQUFNO01BQ0wsSUFBSSxDQUFDMEgsa0JBQWtCLENBQUNqUixPQUFPLENBQUM7SUFDbEM7RUFDRjtFQUVBaVIsa0JBQWtCQSxDQUFDalIsT0FBTyxFQUFFa1IsS0FBSyxFQUFFO0lBQ2pDLE1BQU03RyxJQUFJLEdBQUc2RyxLQUFLLEtBQUtuRSxTQUFTLEdBQUcvTSxPQUFPLENBQUNxSyxJQUFJLENBQUNxRyxDQUFDLENBQUNRLEtBQUssQ0FBQyxHQUFHbFIsT0FBTyxDQUFDcUssSUFBSTtJQUN2RSxNQUFNdUcsUUFBUSxHQUFHNVEsT0FBTyxDQUFDNFEsUUFBUTtJQUNqQyxNQUFNRyxNQUFNLEdBQUcvUSxPQUFPLENBQUMrUSxNQUFNO0lBRTdCLE1BQU1QLFNBQVMsR0FBR25HLElBQUksQ0FBQ21HLFNBQVM7SUFFaEMsSUFBSSxDQUFDLElBQUksQ0FBQ3BMLGFBQWEsQ0FBQzJGLEdBQUcsQ0FBQ3lGLFNBQVMsQ0FBQyxFQUFFO01BQ3RDLElBQUksQ0FBQ3BMLGFBQWEsQ0FBQytMLEdBQUcsQ0FBQ1gsU0FBUyxFQUFFeFEsT0FBTyxDQUFDO0lBQzVDLENBQUMsTUFBTTtNQUNMLE1BQU1vUixhQUFhLEdBQUcsSUFBSSxDQUFDaE0sYUFBYSxDQUFDNkYsR0FBRyxDQUFDdUYsU0FBUyxDQUFDO01BQ3ZELE1BQU1hLFVBQVUsR0FBR0QsYUFBYSxDQUFDUixRQUFRLEtBQUssSUFBSSxHQUFHLElBQUksQ0FBQ0wseUJBQXlCLENBQUNDLFNBQVMsRUFBRVksYUFBYSxDQUFDLEdBQUdBLGFBQWEsQ0FBQy9HLElBQUk7O01BRWxJO01BQ0EsTUFBTWlILGlCQUFpQixHQUFHakgsSUFBSSxDQUFDa0gsYUFBYSxHQUFHRixVQUFVLENBQUNFLGFBQWE7TUFDdkUsTUFBTUMsd0JBQXdCLEdBQUduSCxJQUFJLENBQUNrSCxhQUFhLEtBQUtGLFVBQVUsQ0FBQ0UsYUFBYTtNQUNoRixJQUFJRCxpQkFBaUIsSUFBS0Usd0JBQXdCLElBQUlILFVBQVUsQ0FBQ1IsS0FBSyxHQUFHeEcsSUFBSSxDQUFDd0csS0FBTSxFQUFFO1FBQ3BGO01BQ0Y7TUFFQSxJQUFJRCxRQUFRLEtBQUssR0FBRyxFQUFFO1FBQ3BCLE1BQU1hLGtCQUFrQixHQUFHSixVQUFVLElBQUlBLFVBQVUsQ0FBQ0ssV0FBVztRQUMvRCxJQUFJRCxrQkFBa0IsRUFBRTtVQUN0QjtVQUNBLElBQUksQ0FBQ3JNLGFBQWEsQ0FBQ21GLE1BQU0sQ0FBQ2lHLFNBQVMsQ0FBQztRQUN0QyxDQUFDLE1BQU07VUFDTDtVQUNBLElBQUksQ0FBQ3BMLGFBQWEsQ0FBQytMLEdBQUcsQ0FBQ1gsU0FBUyxFQUFFeFEsT0FBTyxDQUFDO1FBQzVDO01BQ0YsQ0FBQyxNQUFNO1FBQ0w7UUFDQSxJQUFJcVIsVUFBVSxDQUFDTSxVQUFVLElBQUl0SCxJQUFJLENBQUNzSCxVQUFVLEVBQUU7VUFDNUMvRyxNQUFNLENBQUNrRSxNQUFNLENBQUN1QyxVQUFVLENBQUNNLFVBQVUsRUFBRXRILElBQUksQ0FBQ3NILFVBQVUsQ0FBQztRQUN2RDtNQUNGO0lBQ0Y7RUFDRjtFQUVBL0wsb0JBQW9CQSxDQUFDN0YsQ0FBQyxFQUFFZ1IsTUFBTSxFQUFFO0lBQzlCLElBQUksQ0FBQ2xMLE1BQU0sQ0FBQ3NFLElBQUksQ0FBQ0MsS0FBSyxDQUFDckssQ0FBQyxDQUFDc0ssSUFBSSxDQUFDLEVBQUUwRyxNQUFNLENBQUM7RUFDekM7RUFFQWxMLE1BQU1BLENBQUM3RixPQUFPLEVBQUUrUSxNQUFNLEVBQUU7SUFDdEIsSUFBSXRRLEtBQUssQ0FBQ21SLE9BQU8sRUFBRTtNQUNqQm5SLEtBQUssQ0FBQyxVQUFVVCxPQUFPLEVBQUUsQ0FBQztJQUM1QjtJQUVBLElBQUksQ0FBQ0EsT0FBTyxDQUFDNFEsUUFBUSxFQUFFO0lBRXZCNVEsT0FBTyxDQUFDK1EsTUFBTSxHQUFHQSxNQUFNO0lBRXZCLElBQUksSUFBSSxDQUFDWixNQUFNLEVBQUU7TUFDZixJQUFJLENBQUNhLFlBQVksQ0FBQ2hSLE9BQU8sQ0FBQztJQUM1QixDQUFDLE1BQU07TUFDTCxJQUFJLENBQUN1SCxpQkFBaUIsQ0FBQyxJQUFJLEVBQUV2SCxPQUFPLENBQUM0USxRQUFRLEVBQUU1USxPQUFPLENBQUNxSyxJQUFJLEVBQUVySyxPQUFPLENBQUMrUSxNQUFNLENBQUM7SUFDOUU7RUFDRjtFQUVBYyx1QkFBdUJBLENBQUNDLE1BQU0sRUFBRTtJQUM5QixPQUFPLElBQUk7RUFDYjtFQUVBQyxxQkFBcUJBLENBQUNELE1BQU0sRUFBRSxDQUFDO0VBRS9CRSxxQkFBcUJBLENBQUNGLE1BQU0sRUFBRSxDQUFDO0VBRS9CRyxnQkFBZ0JBLENBQUNyTyxRQUFRLEVBQUU7SUFDekIsT0FBTyxJQUFJLENBQUNnQixTQUFTLENBQUNoQixRQUFRLENBQUMsR0FBR3hELEdBQUcsQ0FBQzhSLFFBQVEsQ0FBQ0MsWUFBWSxHQUFHL1IsR0FBRyxDQUFDOFIsUUFBUSxDQUFDRSxhQUFhO0VBQzFGO0VBRUEsTUFBTXpKLGdCQUFnQkEsQ0FBQSxFQUFHO0lBQ3ZCLElBQUksSUFBSSxDQUFDUSxjQUFjLENBQUMsQ0FBQyxFQUFFO0lBRTNCLE1BQU1rSixjQUFjLEdBQUdDLElBQUksQ0FBQ0MsR0FBRyxDQUFDLENBQUM7SUFFakMsTUFBTUMsR0FBRyxHQUFHLE1BQU1DLEtBQUssQ0FBQzFQLFFBQVEsQ0FBQ21GLFFBQVEsQ0FBQ3dLLElBQUksRUFBRTtNQUM5Q0MsTUFBTSxFQUFFLE1BQU07TUFDZEMsS0FBSyxFQUFFO0lBQ1QsQ0FBQyxDQUFDO0lBRUYsTUFBTUMsU0FBUyxHQUFHLElBQUk7SUFDdEIsTUFBTUMsa0JBQWtCLEdBQUcsSUFBSVIsSUFBSSxDQUFDRSxHQUFHLENBQUNPLE9BQU8sQ0FBQzlILEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDK0gsT0FBTyxDQUFDLENBQUMsR0FBR0gsU0FBUyxHQUFHLENBQUM7SUFDdEYsTUFBTUksa0JBQWtCLEdBQUdYLElBQUksQ0FBQ0MsR0FBRyxDQUFDLENBQUM7SUFDckMsTUFBTVcsVUFBVSxHQUFHSixrQkFBa0IsR0FBRyxDQUFDRyxrQkFBa0IsR0FBR1osY0FBYyxJQUFJLENBQUM7SUFDakYsTUFBTWMsVUFBVSxHQUFHRCxVQUFVLEdBQUdELGtCQUFrQjtJQUVsRCxJQUFJLENBQUMzTixrQkFBa0IsRUFBRTtJQUV6QixJQUFJLElBQUksQ0FBQ0Esa0JBQWtCLElBQUksRUFBRSxFQUFFO01BQ2pDLElBQUksQ0FBQ0QsV0FBVyxDQUFDc0UsSUFBSSxDQUFDd0osVUFBVSxDQUFDO0lBQ25DLENBQUMsTUFBTTtNQUNMLElBQUksQ0FBQzlOLFdBQVcsQ0FBQyxJQUFJLENBQUNDLGtCQUFrQixHQUFHLEVBQUUsQ0FBQyxHQUFHNk4sVUFBVTtJQUM3RDtJQUVBLElBQUksQ0FBQzVOLGFBQWEsR0FBRyxJQUFJLENBQUNGLFdBQVcsQ0FBQytOLE1BQU0sQ0FBQyxDQUFDQyxHQUFHLEVBQUVDLE1BQU0sS0FBTUQsR0FBRyxJQUFJQyxNQUFPLEVBQUUsQ0FBQyxDQUFDLEdBQUcsSUFBSSxDQUFDak8sV0FBVyxDQUFDb0UsTUFBTTtJQUUzRyxJQUFJLElBQUksQ0FBQ25FLGtCQUFrQixHQUFHLEVBQUUsRUFBRTtNQUNoQzdFLEtBQUssQ0FBQywyQkFBMkIsSUFBSSxDQUFDOEUsYUFBYSxJQUFJLENBQUM7TUFDeER3RSxVQUFVLENBQUMsTUFBTSxJQUFJLENBQUNwQixnQkFBZ0IsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEVBQUUsR0FBRyxJQUFJLENBQUMsQ0FBQyxDQUFDO0lBQzVELENBQUMsTUFBTTtNQUNMLElBQUksQ0FBQ0EsZ0JBQWdCLENBQUMsQ0FBQztJQUN6QjtFQUNGO0VBRUE0SyxhQUFhQSxDQUFBLEVBQUc7SUFDZCxPQUFPakIsSUFBSSxDQUFDQyxHQUFHLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQ2hOLGFBQWE7RUFDeEM7RUFFQWlPLGNBQWNBLENBQUM1UCxRQUFRLEVBQUVoRSxJQUFJLEdBQUcsT0FBTyxFQUFFO0lBQ3ZDLElBQUksSUFBSSxDQUFDbUYsWUFBWSxDQUFDbkIsUUFBUSxDQUFDLEVBQUU7TUFDL0JuRCxLQUFLLENBQUMsZUFBZWIsSUFBSSxRQUFRZ0UsUUFBUSxFQUFFLENBQUM7TUFDNUMsT0FBT3hDLE9BQU8sQ0FBQ0MsT0FBTyxDQUFDLElBQUksQ0FBQzBELFlBQVksQ0FBQ25CLFFBQVEsQ0FBQyxDQUFDaEUsSUFBSSxDQUFDLENBQUM7SUFDM0QsQ0FBQyxNQUFNO01BQ0xhLEtBQUssQ0FBQyxjQUFjYixJQUFJLFFBQVFnRSxRQUFRLEVBQUUsQ0FBQztNQUMzQyxJQUFJLENBQUMsSUFBSSxDQUFDcUIsb0JBQW9CLENBQUM4RixHQUFHLENBQUNuSCxRQUFRLENBQUMsRUFBRTtRQUM1QyxJQUFJLENBQUNxQixvQkFBb0IsQ0FBQ2tNLEdBQUcsQ0FBQ3ZOLFFBQVEsRUFBRSxDQUFDLENBQUMsQ0FBQztRQUUzQyxNQUFNNlAsWUFBWSxHQUFHLElBQUlyUyxPQUFPLENBQUMsQ0FBQ0MsT0FBTyxFQUFFaUIsTUFBTSxLQUFLO1VBQ3BELElBQUksQ0FBQzJDLG9CQUFvQixDQUFDZ0csR0FBRyxDQUFDckgsUUFBUSxDQUFDLENBQUNzSCxLQUFLLEdBQUc7WUFBRTdKLE9BQU87WUFBRWlCO1VBQU8sQ0FBQztRQUNyRSxDQUFDLENBQUM7UUFDRixNQUFNb1IsWUFBWSxHQUFHLElBQUl0UyxPQUFPLENBQUMsQ0FBQ0MsT0FBTyxFQUFFaUIsTUFBTSxLQUFLO1VBQ3BELElBQUksQ0FBQzJDLG9CQUFvQixDQUFDZ0csR0FBRyxDQUFDckgsUUFBUSxDQUFDLENBQUNkLEtBQUssR0FBRztZQUFFekIsT0FBTztZQUFFaUI7VUFBTyxDQUFDO1FBQ3JFLENBQUMsQ0FBQztRQUVGLElBQUksQ0FBQzJDLG9CQUFvQixDQUFDZ0csR0FBRyxDQUFDckgsUUFBUSxDQUFDLENBQUNzSCxLQUFLLENBQUN5SSxPQUFPLEdBQUdGLFlBQVk7UUFDcEUsSUFBSSxDQUFDeE8sb0JBQW9CLENBQUNnRyxHQUFHLENBQUNySCxRQUFRLENBQUMsQ0FBQ2QsS0FBSyxDQUFDNlEsT0FBTyxHQUFHRCxZQUFZO1FBRXBFRCxZQUFZLENBQUMzVCxLQUFLLENBQUNDLENBQUMsSUFBSUcsT0FBTyxDQUFDUyxJQUFJLENBQUMsR0FBR2lELFFBQVEsNkJBQTZCLEVBQUU3RCxDQUFDLENBQUMsQ0FBQztRQUNsRjJULFlBQVksQ0FBQzVULEtBQUssQ0FBQ0MsQ0FBQyxJQUFJRyxPQUFPLENBQUNTLElBQUksQ0FBQyxHQUFHaUQsUUFBUSw2QkFBNkIsRUFBRTdELENBQUMsQ0FBQyxDQUFDO01BQ3BGO01BQ0EsT0FBTyxJQUFJLENBQUNrRixvQkFBb0IsQ0FBQ2dHLEdBQUcsQ0FBQ3JILFFBQVEsQ0FBQyxDQUFDaEUsSUFBSSxDQUFDLENBQUMrVCxPQUFPO0lBQzlEO0VBQ0Y7RUFFQWpKLGNBQWNBLENBQUM5RyxRQUFRLEVBQUVnUSxNQUFNLEVBQUU7SUFDL0I7SUFDQTtJQUNBLE1BQU1DLFdBQVcsR0FBRyxJQUFJbkUsV0FBVyxDQUFDLENBQUM7SUFDckMsSUFBSTtNQUNKa0UsTUFBTSxDQUFDRSxjQUFjLENBQUMsQ0FBQyxDQUFDdkcsT0FBTyxDQUFDQyxLQUFLLElBQUlxRyxXQUFXLENBQUNwRyxRQUFRLENBQUNELEtBQUssQ0FBQyxDQUFDO0lBRXJFLENBQUMsQ0FBQyxPQUFNek4sQ0FBQyxFQUFFO01BQ1RHLE9BQU8sQ0FBQ1MsSUFBSSxDQUFDLEdBQUdpRCxRQUFRLDZCQUE2QixFQUFFN0QsQ0FBQyxDQUFDO0lBQzNEO0lBQ0EsTUFBTWdVLFdBQVcsR0FBRyxJQUFJckUsV0FBVyxDQUFDLENBQUM7SUFDckMsSUFBSTtNQUNKa0UsTUFBTSxDQUFDSSxjQUFjLENBQUMsQ0FBQyxDQUFDekcsT0FBTyxDQUFDQyxLQUFLLElBQUl1RyxXQUFXLENBQUN0RyxRQUFRLENBQUNELEtBQUssQ0FBQyxDQUFDO0lBRXJFLENBQUMsQ0FBQyxPQUFPek4sQ0FBQyxFQUFFO01BQ1ZHLE9BQU8sQ0FBQ1MsSUFBSSxDQUFDLEdBQUdpRCxRQUFRLDZCQUE2QixFQUFFN0QsQ0FBQyxDQUFDO0lBQzNEO0lBRUEsSUFBSSxDQUFDZ0YsWUFBWSxDQUFDbkIsUUFBUSxDQUFDLEdBQUc7TUFBRXNILEtBQUssRUFBRTJJLFdBQVc7TUFBRS9RLEtBQUssRUFBRWlSO0lBQVksQ0FBQzs7SUFFeEU7SUFDQSxJQUFJLElBQUksQ0FBQzlPLG9CQUFvQixDQUFDOEYsR0FBRyxDQUFDbkgsUUFBUSxDQUFDLEVBQUU7TUFDM0MsSUFBSSxDQUFDcUIsb0JBQW9CLENBQUNnRyxHQUFHLENBQUNySCxRQUFRLENBQUMsQ0FBQ3NILEtBQUssQ0FBQzdKLE9BQU8sQ0FBQ3dTLFdBQVcsQ0FBQztNQUNsRSxJQUFJLENBQUM1TyxvQkFBb0IsQ0FBQ2dHLEdBQUcsQ0FBQ3JILFFBQVEsQ0FBQyxDQUFDZCxLQUFLLENBQUN6QixPQUFPLENBQUMwUyxXQUFXLENBQUM7SUFDcEU7RUFDRjtFQUVBRSxtQkFBbUJBLENBQUEsRUFBRztJQUNwQixPQUFPLElBQUksQ0FBQ2pQLGdCQUFnQjtFQUM5QjtFQUVBLE1BQU1rUCxtQkFBbUJBLENBQUNOLE1BQU0sRUFBRTtJQUNoQztJQUNBO0lBQ0E7O0lBRUE7SUFDQTtJQUNBO0lBQ0EsSUFBSSxJQUFJLENBQUNqUCxTQUFTLElBQUksSUFBSSxDQUFDQSxTQUFTLENBQUNvRSxJQUFJLEVBQUU7TUFDekMsTUFBTW9MLGVBQWUsR0FBRyxJQUFJLENBQUN4UCxTQUFTLENBQUNvRSxJQUFJLENBQUNxTCxVQUFVLENBQUMsQ0FBQztNQUN4RCxNQUFNQyxVQUFVLEdBQUcsRUFBRTtNQUNyQixNQUFNQyxNQUFNLEdBQUdWLE1BQU0sQ0FBQ3RHLFNBQVMsQ0FBQyxDQUFDO01BRWpDLEtBQUssSUFBSS9ELENBQUMsR0FBRyxDQUFDLEVBQUVBLENBQUMsR0FBRytLLE1BQU0sQ0FBQzdLLE1BQU0sRUFBRUYsQ0FBQyxFQUFFLEVBQUU7UUFDdEMsTUFBTWdMLENBQUMsR0FBR0QsTUFBTSxDQUFDL0ssQ0FBQyxDQUFDO1FBQ25CLE1BQU1pTCxNQUFNLEdBQUdMLGVBQWUsQ0FBQ00sSUFBSSxDQUFDQyxDQUFDLElBQUlBLENBQUMsQ0FBQ2xILEtBQUssSUFBSSxJQUFJLElBQUlrSCxDQUFDLENBQUNsSCxLQUFLLENBQUN3QyxJQUFJLElBQUl1RSxDQUFDLENBQUN2RSxJQUFJLENBQUM7UUFFbkYsSUFBSXdFLE1BQU0sSUFBSSxJQUFJLEVBQUU7VUFDbEIsSUFBSUEsTUFBTSxDQUFDRyxZQUFZLEVBQUU7WUFDdkIsTUFBTUgsTUFBTSxDQUFDRyxZQUFZLENBQUNKLENBQUMsQ0FBQztVQUM5QixDQUFDLE1BQU07WUFDTDtZQUNBO1lBQ0E7WUFDQVgsTUFBTSxDQUFDZ0IsV0FBVyxDQUFDSixNQUFNLENBQUNoSCxLQUFLLENBQUM7WUFDaENvRyxNQUFNLENBQUNuRyxRQUFRLENBQUM4RyxDQUFDLENBQUM7VUFDcEI7VUFDQUYsVUFBVSxDQUFDMUssSUFBSSxDQUFDNkssTUFBTSxDQUFDO1FBQ3pCLENBQUMsTUFBTTtVQUNMSCxVQUFVLENBQUMxSyxJQUFJLENBQUMsSUFBSSxDQUFDaEYsU0FBUyxDQUFDb0UsSUFBSSxDQUFDMEUsUUFBUSxDQUFDOEcsQ0FBQyxFQUFFWCxNQUFNLENBQUMsQ0FBQztRQUMxRDtNQUNGO01BQ0FPLGVBQWUsQ0FBQzVHLE9BQU8sQ0FBQ21ILENBQUMsSUFBSTtRQUMzQixJQUFJLENBQUNMLFVBQVUsQ0FBQzdGLFFBQVEsQ0FBQ2tHLENBQUMsQ0FBQyxFQUFFO1VBQzNCQSxDQUFDLENBQUNsSCxLQUFLLENBQUNvRSxPQUFPLEdBQUcsS0FBSztRQUN6QjtNQUNGLENBQUMsQ0FBQztJQUNKO0lBQ0EsSUFBSSxDQUFDNU0sZ0JBQWdCLEdBQUc0TyxNQUFNO0lBQzlCLElBQUksQ0FBQ2xKLGNBQWMsQ0FBQyxJQUFJLENBQUM5RyxRQUFRLEVBQUVnUSxNQUFNLENBQUM7RUFDNUM7RUFFQWlCLGdCQUFnQkEsQ0FBQ2pELE9BQU8sRUFBRTtJQUN4QixJQUFJLElBQUksQ0FBQ2pOLFNBQVMsSUFBSSxJQUFJLENBQUNBLFNBQVMsQ0FBQ29FLElBQUksRUFBRTtNQUN6QyxJQUFJLENBQUNwRSxTQUFTLENBQUNvRSxJQUFJLENBQUNxTCxVQUFVLENBQUMsQ0FBQyxDQUFDN0csT0FBTyxDQUFDbUgsQ0FBQyxJQUFJO1FBQzVDLElBQUlBLENBQUMsQ0FBQ2xILEtBQUssQ0FBQ3dDLElBQUksSUFBSSxPQUFPLEVBQUU7VUFDM0IwRSxDQUFDLENBQUNsSCxLQUFLLENBQUNvRSxPQUFPLEdBQUdBLE9BQU87UUFDM0I7TUFDRixDQUFDLENBQUM7SUFDSjtFQUNGO0VBRUFrRCxRQUFRQSxDQUFDbFIsUUFBUSxFQUFFZ04sUUFBUSxFQUFFdkcsSUFBSSxFQUFFO0lBQ2pDLElBQUksQ0FBQyxJQUFJLENBQUMxRixTQUFTLEVBQUU7TUFDbkJ6RSxPQUFPLENBQUNTLElBQUksQ0FBQyxxQ0FBcUMsQ0FBQztJQUNyRCxDQUFDLE1BQU07TUFDTCxRQUFRLElBQUksQ0FBQ3lELG1CQUFtQjtRQUM5QixLQUFLLFdBQVc7VUFDZCxJQUFJLElBQUksQ0FBQ0gsRUFBRSxDQUFDMUIsVUFBVSxLQUFLLENBQUMsRUFBRTtZQUFFO1lBQzlCLElBQUksQ0FBQ29DLFNBQVMsQ0FBQ3lHLE1BQU0sQ0FBQzJFLFdBQVcsQ0FBQztjQUFFQyxJQUFJLEVBQUUsTUFBTTtjQUFFbkMsSUFBSSxFQUFFMUQsSUFBSSxDQUFDNEssU0FBUyxDQUFDO2dCQUFFbkUsUUFBUTtnQkFBRXZHO2NBQUssQ0FBQyxDQUFDO2NBQUUySyxJQUFJLEVBQUVwUjtZQUFTLENBQUMsQ0FBQztVQUMvRztVQUNBO1FBQ0YsS0FBSyxhQUFhO1VBQ2hCLElBQUksSUFBSSxDQUFDZSxTQUFTLENBQUN5SSxpQkFBaUIsQ0FBQzdLLFVBQVUsS0FBSyxNQUFNLEVBQUU7WUFDMUQsSUFBSSxDQUFDb0MsU0FBUyxDQUFDeUksaUJBQWlCLENBQUN6TixJQUFJLENBQUN3SyxJQUFJLENBQUM0SyxTQUFTLENBQUM7Y0FBRW5SLFFBQVE7Y0FBRWdOLFFBQVE7Y0FBRXZHO1lBQUssQ0FBQyxDQUFDLENBQUM7VUFDckY7VUFDQTtRQUNGO1VBQ0UsSUFBSSxDQUFDakcsbUJBQW1CLENBQUNSLFFBQVEsRUFBRWdOLFFBQVEsRUFBRXZHLElBQUksQ0FBQztVQUNsRDtNQUNKO0lBQ0Y7RUFDRjtFQUVBNEssa0JBQWtCQSxDQUFDclIsUUFBUSxFQUFFZ04sUUFBUSxFQUFFdkcsSUFBSSxFQUFFO0lBQzNDLElBQUksQ0FBQyxJQUFJLENBQUMxRixTQUFTLEVBQUU7TUFDbkJ6RSxPQUFPLENBQUNTLElBQUksQ0FBQywrQ0FBK0MsQ0FBQztJQUMvRCxDQUFDLE1BQU07TUFDTCxRQUFRLElBQUksQ0FBQ3dELGlCQUFpQjtRQUM1QixLQUFLLFdBQVc7VUFDZCxJQUFJLElBQUksQ0FBQ0YsRUFBRSxDQUFDMUIsVUFBVSxLQUFLLENBQUMsRUFBRTtZQUFFO1lBQzlCLElBQUksQ0FBQ29DLFNBQVMsQ0FBQ3lHLE1BQU0sQ0FBQzJFLFdBQVcsQ0FBQztjQUFFQyxJQUFJLEVBQUUsTUFBTTtjQUFFbkMsSUFBSSxFQUFFMUQsSUFBSSxDQUFDNEssU0FBUyxDQUFDO2dCQUFFbkUsUUFBUTtnQkFBRXZHO2NBQUssQ0FBQyxDQUFDO2NBQUUySyxJQUFJLEVBQUVwUjtZQUFTLENBQUMsQ0FBQztVQUMvRztVQUNBO1FBQ0YsS0FBSyxhQUFhO1VBQ2hCLElBQUksSUFBSSxDQUFDZSxTQUFTLENBQUNzSSxlQUFlLENBQUMxSyxVQUFVLEtBQUssTUFBTSxFQUFFO1lBQ3hELElBQUksQ0FBQ29DLFNBQVMsQ0FBQ3NJLGVBQWUsQ0FBQ3ROLElBQUksQ0FBQ3dLLElBQUksQ0FBQzRLLFNBQVMsQ0FBQztjQUFFblIsUUFBUTtjQUFFZ04sUUFBUTtjQUFFdkc7WUFBSyxDQUFDLENBQUMsQ0FBQztVQUNuRjtVQUNBO1FBQ0Y7VUFDRSxJQUFJLENBQUNsRyxpQkFBaUIsQ0FBQ1AsUUFBUSxFQUFFZ04sUUFBUSxFQUFFdkcsSUFBSSxDQUFDO1VBQ2hEO01BQ0o7SUFDRjtFQUNGO0VBRUE2SyxhQUFhQSxDQUFDdEUsUUFBUSxFQUFFdkcsSUFBSSxFQUFFO0lBQzVCLElBQUksQ0FBQyxJQUFJLENBQUMxRixTQUFTLEVBQUU7TUFDbkJ6RSxPQUFPLENBQUNTLElBQUksQ0FBQywwQ0FBMEMsQ0FBQztJQUMxRCxDQUFDLE1BQU07TUFDTCxRQUFRLElBQUksQ0FBQ3lELG1CQUFtQjtRQUM5QixLQUFLLFdBQVc7VUFDZCxJQUFJLElBQUksQ0FBQ0gsRUFBRSxDQUFDMUIsVUFBVSxLQUFLLENBQUMsRUFBRTtZQUFFO1lBQzlCLElBQUksQ0FBQ29DLFNBQVMsQ0FBQ3lHLE1BQU0sQ0FBQzJFLFdBQVcsQ0FBQztjQUFFQyxJQUFJLEVBQUUsTUFBTTtjQUFFbkMsSUFBSSxFQUFFMUQsSUFBSSxDQUFDNEssU0FBUyxDQUFDO2dCQUFFbkUsUUFBUTtnQkFBRXZHO2NBQUssQ0FBQztZQUFFLENBQUMsQ0FBQztVQUMvRjtVQUNBO1FBQ0YsS0FBSyxhQUFhO1VBQ2hCLElBQUksSUFBSSxDQUFDMUYsU0FBUyxDQUFDeUksaUJBQWlCLENBQUM3SyxVQUFVLEtBQUssTUFBTSxFQUFFO1lBQzFELElBQUksQ0FBQ29DLFNBQVMsQ0FBQ3lJLGlCQUFpQixDQUFDek4sSUFBSSxDQUFDd0ssSUFBSSxDQUFDNEssU0FBUyxDQUFDO2NBQUVuRSxRQUFRO2NBQUV2RztZQUFLLENBQUMsQ0FBQyxDQUFDO1VBQzNFO1VBQ0E7UUFDRjtVQUNFLElBQUksQ0FBQ2pHLG1CQUFtQixDQUFDMkksU0FBUyxFQUFFNkQsUUFBUSxFQUFFdkcsSUFBSSxDQUFDO1VBQ25EO01BQ0o7SUFDRjtFQUNGO0VBRUE4Syx1QkFBdUJBLENBQUN2RSxRQUFRLEVBQUV2RyxJQUFJLEVBQUU7SUFDdEMsSUFBSSxDQUFDLElBQUksQ0FBQzFGLFNBQVMsRUFBRTtNQUNuQnpFLE9BQU8sQ0FBQ1MsSUFBSSxDQUFDLG9EQUFvRCxDQUFDO0lBQ3BFLENBQUMsTUFBTTtNQUNMLFFBQVEsSUFBSSxDQUFDd0QsaUJBQWlCO1FBQzVCLEtBQUssV0FBVztVQUNkLElBQUksSUFBSSxDQUFDRixFQUFFLENBQUMxQixVQUFVLEtBQUssQ0FBQyxFQUFFO1lBQUU7WUFDOUIsSUFBSSxDQUFDb0MsU0FBUyxDQUFDeUcsTUFBTSxDQUFDMkUsV0FBVyxDQUFDO2NBQUVDLElBQUksRUFBRSxNQUFNO2NBQUVuQyxJQUFJLEVBQUUxRCxJQUFJLENBQUM0SyxTQUFTLENBQUM7Z0JBQUVuRSxRQUFRO2dCQUFFdkc7Y0FBSyxDQUFDO1lBQUUsQ0FBQyxDQUFDO1VBQy9GO1VBQ0E7UUFDRixLQUFLLGFBQWE7VUFDaEIsSUFBSSxJQUFJLENBQUMxRixTQUFTLENBQUNzSSxlQUFlLENBQUMxSyxVQUFVLEtBQUssTUFBTSxFQUFFO1lBQ3hELElBQUksQ0FBQ29DLFNBQVMsQ0FBQ3NJLGVBQWUsQ0FBQ3ROLElBQUksQ0FBQ3dLLElBQUksQ0FBQzRLLFNBQVMsQ0FBQztjQUFFbkUsUUFBUTtjQUFFdkc7WUFBSyxDQUFDLENBQUMsQ0FBQztVQUN6RTtVQUNBO1FBQ0Y7VUFDRSxJQUFJLENBQUNsRyxpQkFBaUIsQ0FBQzRJLFNBQVMsRUFBRTZELFFBQVEsRUFBRXZHLElBQUksQ0FBQztVQUNqRDtNQUNKO0lBQ0Y7RUFDRjtFQUVBK0ssSUFBSUEsQ0FBQ3hSLFFBQVEsRUFBRXlSLFVBQVUsRUFBRTtJQUN6QixPQUFPLElBQUksQ0FBQzFRLFNBQVMsQ0FBQ3lHLE1BQU0sQ0FBQzJFLFdBQVcsQ0FBQztNQUFFQyxJQUFJLEVBQUUsTUFBTTtNQUFFckMsT0FBTyxFQUFFLElBQUksQ0FBQ2hLLElBQUk7TUFBRWlLLE9BQU8sRUFBRWhLLFFBQVE7TUFBRXFNLEtBQUssRUFBRW9GO0lBQVcsQ0FBQyxDQUFDLENBQUMxVCxJQUFJLENBQUMsTUFBTTtNQUM5SG9CLFFBQVEsQ0FBQzhLLElBQUksQ0FBQ0MsYUFBYSxDQUFDLElBQUlDLFdBQVcsQ0FBQyxRQUFRLEVBQUU7UUFBRUMsTUFBTSxFQUFFO1VBQUVwSyxRQUFRLEVBQUVBO1FBQVM7TUFBRSxDQUFDLENBQUMsQ0FBQztJQUM1RixDQUFDLENBQUM7RUFDSjtFQUVBMFIsS0FBS0EsQ0FBQzFSLFFBQVEsRUFBRTtJQUNkLE9BQU8sSUFBSSxDQUFDZSxTQUFTLENBQUN5RyxNQUFNLENBQUMyRSxXQUFXLENBQUM7TUFBRUMsSUFBSSxFQUFFLE9BQU87TUFBRWdGLElBQUksRUFBRXBSO0lBQVMsQ0FBQyxDQUFDLENBQUNqQyxJQUFJLENBQUMsTUFBTTtNQUNyRixJQUFJLENBQUN3RCxjQUFjLENBQUNnTSxHQUFHLENBQUN2TixRQUFRLEVBQUUsSUFBSSxDQUFDO01BQ3ZDYixRQUFRLENBQUM4SyxJQUFJLENBQUNDLGFBQWEsQ0FBQyxJQUFJQyxXQUFXLENBQUMsU0FBUyxFQUFFO1FBQUVDLE1BQU0sRUFBRTtVQUFFcEssUUFBUSxFQUFFQTtRQUFTO01BQUUsQ0FBQyxDQUFDLENBQUM7SUFDN0YsQ0FBQyxDQUFDO0VBQ0o7RUFFQTJSLE9BQU9BLENBQUMzUixRQUFRLEVBQUU7SUFDaEIsT0FBTyxJQUFJLENBQUNlLFNBQVMsQ0FBQ3lHLE1BQU0sQ0FBQzJFLFdBQVcsQ0FBQztNQUFFQyxJQUFJLEVBQUUsU0FBUztNQUFFZ0YsSUFBSSxFQUFFcFI7SUFBUyxDQUFDLENBQUMsQ0FBQ2pDLElBQUksQ0FBQyxNQUFNO01BQ3ZGLElBQUksQ0FBQ3dELGNBQWMsQ0FBQ29GLE1BQU0sQ0FBQzNHLFFBQVEsQ0FBQztNQUNwQ2IsUUFBUSxDQUFDOEssSUFBSSxDQUFDQyxhQUFhLENBQUMsSUFBSUMsV0FBVyxDQUFDLFdBQVcsRUFBRTtRQUFFQyxNQUFNLEVBQUU7VUFBRXBLLFFBQVEsRUFBRUE7UUFBUztNQUFFLENBQUMsQ0FBQyxDQUFDO0lBQy9GLENBQUMsQ0FBQztFQUNKO0FBQ0Y7QUFFQXhELEdBQUcsQ0FBQzhSLFFBQVEsQ0FBQ3NELFFBQVEsQ0FBQyxPQUFPLEVBQUUvUixZQUFZLENBQUM7QUFFNUNnUyxNQUFNLENBQUNDLE9BQU8sR0FBR2pTLFlBQVk7Ozs7Ozs7Ozs7O0FDaG1DN0I7QUFDYTs7QUFFYjtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxJQUFJO0FBQ0o7QUFDQTs7QUFFQTtBQUNBO0FBQ0EsZ0JBQWdCLG9CQUFvQjtBQUNwQztBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLGtCQUFrQixrQkFBa0I7QUFDcEM7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLHdDQUF3QztBQUN4QztBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0EsSUFBSTtBQUNKO0FBQ0EsSUFBSTtBQUNKO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTs7QUFFQTtBQUNBLDZDQUE2QztBQUM3QztBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQSxvQkFBb0I7QUFDcEIsMkJBQTJCO0FBQzNCO0FBQ0E7QUFDQTtBQUNBLDhEQUE4RDtBQUM5RCxrQkFBa0Isa0JBQWtCO0FBQ3BDO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsUUFBUTtBQUNSO0FBQ0E7QUFDQSxLQUFLO0FBQ0wsaURBQWlEO0FBQ2pEO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxLQUFLO0FBQ0w7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxJQUFJO0FBQ0o7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEdBQUc7QUFDSDtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLGtCQUFrQixrQkFBa0IsT0FBTztBQUMzQztBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsR0FBRztBQUNIO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsT0FBTztBQUNQO0FBQ0E7QUFDQTtBQUNBLEtBQUs7QUFDTCxHQUFHO0FBQ0g7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQSw2Q0FBNkM7QUFDN0M7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsR0FBRzs7QUFFSDtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxHQUFHO0FBQ0g7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEdBQUc7QUFDSDtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0EsS0FBSztBQUNMO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEtBQUs7QUFDTDtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSx3QkFBd0I7QUFDeEI7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEdBQUc7QUFDSDtBQUNBO0FBQ0E7QUFDQSxLQUFLO0FBQ0w7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLE1BQU07QUFDTjtBQUNBO0FBQ0E7QUFDQSxNQUFNO0FBQ047QUFDQTtBQUNBO0FBQ0E7QUFDQSxLQUFLO0FBQ0w7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQUdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsWUFBWTtBQUNaO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLFlBQVk7QUFDWjtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLElBQUk7QUFDSjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsSUFBSTtBQUNKO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0Esa0JBQWtCLGtCQUFrQjtBQUNwQztBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLGtCQUFrQixrQkFBa0I7QUFDcEM7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQSxJQUFJLElBQTBCO0FBQzlCO0FBQ0E7Ozs7Ozs7VUNqeUJBO1VBQ0E7O1VBRUE7VUFDQTtVQUNBO1VBQ0E7VUFDQTtVQUNBO1VBQ0E7VUFDQTtVQUNBO1VBQ0E7VUFDQTtVQUNBO1VBQ0E7O1VBRUE7VUFDQTs7VUFFQTtVQUNBO1VBQ0E7Ozs7VUV0QkE7VUFDQTtVQUNBO1VBQ0EiLCJzb3VyY2VzIjpbIndlYnBhY2s6Ly9AbmV0d29ya2VkLWFmcmFtZS9uYWYtamFudXMtYWRhcHRlci8uL25vZGVfbW9kdWxlcy9AbmV0d29ya2VkLWFmcmFtZS9taW5pamFudXMvbWluaWphbnVzLmpzIiwid2VicGFjazovL0BuZXR3b3JrZWQtYWZyYW1lL25hZi1qYW51cy1hZGFwdGVyLy4vc3JjL2luZGV4LmpzIiwid2VicGFjazovL0BuZXR3b3JrZWQtYWZyYW1lL25hZi1qYW51cy1hZGFwdGVyLy4vbm9kZV9tb2R1bGVzL3NkcC9zZHAuanMiLCJ3ZWJwYWNrOi8vQG5ldHdvcmtlZC1hZnJhbWUvbmFmLWphbnVzLWFkYXB0ZXIvd2VicGFjay9ib290c3RyYXAiLCJ3ZWJwYWNrOi8vQG5ldHdvcmtlZC1hZnJhbWUvbmFmLWphbnVzLWFkYXB0ZXIvd2VicGFjay9iZWZvcmUtc3RhcnR1cCIsIndlYnBhY2s6Ly9AbmV0d29ya2VkLWFmcmFtZS9uYWYtamFudXMtYWRhcHRlci93ZWJwYWNrL3N0YXJ0dXAiLCJ3ZWJwYWNrOi8vQG5ldHdvcmtlZC1hZnJhbWUvbmFmLWphbnVzLWFkYXB0ZXIvd2VicGFjay9hZnRlci1zdGFydHVwIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogUmVwcmVzZW50cyBhIGhhbmRsZSB0byBhIHNpbmdsZSBKYW51cyBwbHVnaW4gb24gYSBKYW51cyBzZXNzaW9uLiBFYWNoIFdlYlJUQyBjb25uZWN0aW9uIHRvIHRoZSBKYW51cyBzZXJ2ZXIgd2lsbCBiZVxuICogYXNzb2NpYXRlZCB3aXRoIGEgc2luZ2xlIGhhbmRsZS4gT25jZSBhdHRhY2hlZCB0byB0aGUgc2VydmVyLCB0aGlzIGhhbmRsZSB3aWxsIGJlIGdpdmVuIGEgdW5pcXVlIElEIHdoaWNoIHNob3VsZCBiZVxuICogdXNlZCB0byBhc3NvY2lhdGUgaXQgd2l0aCBmdXR1cmUgc2lnbmFsbGluZyBtZXNzYWdlcy5cbiAqXG4gKiBTZWUgaHR0cHM6Ly9qYW51cy5jb25mLm1lZXRlY2hvLmNvbS9kb2NzL3Jlc3QuaHRtbCNoYW5kbGVzLlxuICoqL1xuZnVuY3Rpb24gSmFudXNQbHVnaW5IYW5kbGUoc2Vzc2lvbikge1xuICB0aGlzLnNlc3Npb24gPSBzZXNzaW9uO1xuICB0aGlzLmlkID0gdW5kZWZpbmVkO1xufVxuXG4vKiogQXR0YWNoZXMgdGhpcyBoYW5kbGUgdG8gdGhlIEphbnVzIHNlcnZlciBhbmQgc2V0cyBpdHMgSUQuICoqL1xuSmFudXNQbHVnaW5IYW5kbGUucHJvdG90eXBlLmF0dGFjaCA9IGZ1bmN0aW9uKHBsdWdpbiwgbG9vcF9pbmRleCkge1xuICB2YXIgcGF5bG9hZCA9IHsgcGx1Z2luOiBwbHVnaW4sIGxvb3BfaW5kZXg6IGxvb3BfaW5kZXgsIFwiZm9yY2UtYnVuZGxlXCI6IHRydWUsIFwiZm9yY2UtcnRjcC1tdXhcIjogdHJ1ZSB9O1xuICByZXR1cm4gdGhpcy5zZXNzaW9uLnNlbmQoXCJhdHRhY2hcIiwgcGF5bG9hZCkudGhlbihyZXNwID0+IHtcbiAgICB0aGlzLmlkID0gcmVzcC5kYXRhLmlkO1xuICAgIHJldHVybiByZXNwO1xuICB9KTtcbn07XG5cbi8qKiBEZXRhY2hlcyB0aGlzIGhhbmRsZS4gKiovXG5KYW51c1BsdWdpbkhhbmRsZS5wcm90b3R5cGUuZGV0YWNoID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLnNlbmQoXCJkZXRhY2hcIik7XG59O1xuXG4vKiogUmVnaXN0ZXJzIGEgY2FsbGJhY2sgdG8gYmUgZmlyZWQgdXBvbiB0aGUgcmVjZXB0aW9uIG9mIGFueSBpbmNvbWluZyBKYW51cyBzaWduYWxzIGZvciB0aGlzIHBsdWdpbiBoYW5kbGUgd2l0aCB0aGVcbiAqIGBqYW51c2AgYXR0cmlidXRlIGVxdWFsIHRvIGBldmAuXG4gKiovXG5KYW51c1BsdWdpbkhhbmRsZS5wcm90b3R5cGUub24gPSBmdW5jdGlvbihldiwgY2FsbGJhY2spIHtcbiAgcmV0dXJuIHRoaXMuc2Vzc2lvbi5vbihldiwgc2lnbmFsID0+IHtcbiAgICBpZiAoc2lnbmFsLnNlbmRlciA9PSB0aGlzLmlkKSB7XG4gICAgICBjYWxsYmFjayhzaWduYWwpO1xuICAgIH1cbiAgfSk7XG59O1xuXG4vKipcbiAqIFNlbmRzIGEgc2lnbmFsIGFzc29jaWF0ZWQgd2l0aCB0aGlzIGhhbmRsZS4gU2lnbmFscyBzaG91bGQgYmUgSlNPTi1zZXJpYWxpemFibGUgb2JqZWN0cy4gUmV0dXJucyBhIHByb21pc2UgdGhhdCB3aWxsXG4gKiBiZSByZXNvbHZlZCBvciByZWplY3RlZCB3aGVuIGEgcmVzcG9uc2UgdG8gdGhpcyBzaWduYWwgaXMgcmVjZWl2ZWQsIG9yIHdoZW4gbm8gcmVzcG9uc2UgaXMgcmVjZWl2ZWQgd2l0aGluIHRoZVxuICogc2Vzc2lvbiB0aW1lb3V0LlxuICoqL1xuSmFudXNQbHVnaW5IYW5kbGUucHJvdG90eXBlLnNlbmQgPSBmdW5jdGlvbih0eXBlLCBzaWduYWwpIHtcbiAgcmV0dXJuIHRoaXMuc2Vzc2lvbi5zZW5kKHR5cGUsIE9iamVjdC5hc3NpZ24oeyBoYW5kbGVfaWQ6IHRoaXMuaWQgfSwgc2lnbmFsKSk7XG59O1xuXG4vKiogU2VuZHMgYSBwbHVnaW4tc3BlY2lmaWMgbWVzc2FnZSBhc3NvY2lhdGVkIHdpdGggdGhpcyBoYW5kbGUuICoqL1xuSmFudXNQbHVnaW5IYW5kbGUucHJvdG90eXBlLnNlbmRNZXNzYWdlID0gZnVuY3Rpb24oYm9keSkge1xuICByZXR1cm4gdGhpcy5zZW5kKFwibWVzc2FnZVwiLCB7IGJvZHk6IGJvZHkgfSk7XG59O1xuXG4vKiogU2VuZHMgYSBKU0VQIG9mZmVyIG9yIGFuc3dlciBhc3NvY2lhdGVkIHdpdGggdGhpcyBoYW5kbGUuICoqL1xuSmFudXNQbHVnaW5IYW5kbGUucHJvdG90eXBlLnNlbmRKc2VwID0gZnVuY3Rpb24oanNlcCkge1xuICByZXR1cm4gdGhpcy5zZW5kKFwibWVzc2FnZVwiLCB7IGJvZHk6IHt9LCBqc2VwOiBqc2VwIH0pO1xufTtcblxuLyoqIFNlbmRzIGFuIElDRSB0cmlja2xlIGNhbmRpZGF0ZSBhc3NvY2lhdGVkIHdpdGggdGhpcyBoYW5kbGUuICoqL1xuSmFudXNQbHVnaW5IYW5kbGUucHJvdG90eXBlLnNlbmRUcmlja2xlID0gZnVuY3Rpb24oY2FuZGlkYXRlKSB7XG4gIHJldHVybiB0aGlzLnNlbmQoXCJ0cmlja2xlXCIsIHsgY2FuZGlkYXRlOiBjYW5kaWRhdGUgfSk7XG59O1xuXG4vKipcbiAqIFJlcHJlc2VudHMgYSBKYW51cyBzZXNzaW9uIC0tIGEgSmFudXMgY29udGV4dCBmcm9tIHdpdGhpbiB3aGljaCB5b3UgY2FuIG9wZW4gbXVsdGlwbGUgaGFuZGxlcyBhbmQgY29ubmVjdGlvbnMuIE9uY2VcbiAqIGNyZWF0ZWQsIHRoaXMgc2Vzc2lvbiB3aWxsIGJlIGdpdmVuIGEgdW5pcXVlIElEIHdoaWNoIHNob3VsZCBiZSB1c2VkIHRvIGFzc29jaWF0ZSBpdCB3aXRoIGZ1dHVyZSBzaWduYWxsaW5nIG1lc3NhZ2VzLlxuICpcbiAqIFNlZSBodHRwczovL2phbnVzLmNvbmYubWVldGVjaG8uY29tL2RvY3MvcmVzdC5odG1sI3Nlc3Npb25zLlxuICoqL1xuZnVuY3Rpb24gSmFudXNTZXNzaW9uKG91dHB1dCwgb3B0aW9ucykge1xuICB0aGlzLm91dHB1dCA9IG91dHB1dDtcbiAgdGhpcy5pZCA9IHVuZGVmaW5lZDtcbiAgdGhpcy5uZXh0VHhJZCA9IDA7XG4gIHRoaXMudHhucyA9IHt9O1xuICB0aGlzLmV2ZW50SGFuZGxlcnMgPSB7fTtcbiAgdGhpcy5vcHRpb25zID0gT2JqZWN0LmFzc2lnbih7XG4gICAgdmVyYm9zZTogZmFsc2UsXG4gICAgdGltZW91dE1zOiAxMDAwMCxcbiAgICBrZWVwYWxpdmVNczogMzAwMDBcbiAgfSwgb3B0aW9ucyk7XG59XG5cbi8qKiBDcmVhdGVzIHRoaXMgc2Vzc2lvbiBvbiB0aGUgSmFudXMgc2VydmVyIGFuZCBzZXRzIGl0cyBJRC4gKiovXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLmNyZWF0ZSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5zZW5kKFwiY3JlYXRlXCIpLnRoZW4ocmVzcCA9PiB7XG4gICAgdGhpcy5pZCA9IHJlc3AuZGF0YS5pZDtcbiAgICByZXR1cm4gcmVzcDtcbiAgfSk7XG59O1xuXG4vKipcbiAqIERlc3Ryb3lzIHRoaXMgc2Vzc2lvbi4gTm90ZSB0aGF0IHVwb24gZGVzdHJ1Y3Rpb24sIEphbnVzIHdpbGwgYWxzbyBjbG9zZSB0aGUgc2lnbmFsbGluZyB0cmFuc3BvcnQgKGlmIGFwcGxpY2FibGUpIGFuZFxuICogYW55IG9wZW4gV2ViUlRDIGNvbm5lY3Rpb25zLlxuICoqL1xuSmFudXNTZXNzaW9uLnByb3RvdHlwZS5kZXN0cm95ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLnNlbmQoXCJkZXN0cm95XCIpLnRoZW4oKHJlc3ApID0+IHtcbiAgICB0aGlzLmRpc3Bvc2UoKTtcbiAgICByZXR1cm4gcmVzcDtcbiAgfSk7XG59O1xuXG4vKipcbiAqIERpc3Bvc2VzIG9mIHRoaXMgc2Vzc2lvbiBpbiBhIHdheSBzdWNoIHRoYXQgbm8gZnVydGhlciBpbmNvbWluZyBzaWduYWxsaW5nIG1lc3NhZ2VzIHdpbGwgYmUgcHJvY2Vzc2VkLlxuICogT3V0c3RhbmRpbmcgdHJhbnNhY3Rpb25zIHdpbGwgYmUgcmVqZWN0ZWQuXG4gKiovXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLmRpc3Bvc2UgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5fa2lsbEtlZXBhbGl2ZSgpO1xuICB0aGlzLmV2ZW50SGFuZGxlcnMgPSB7fTtcbiAgZm9yICh2YXIgdHhJZCBpbiB0aGlzLnR4bnMpIHtcbiAgICBpZiAodGhpcy50eG5zLmhhc093blByb3BlcnR5KHR4SWQpKSB7XG4gICAgICB2YXIgdHhuID0gdGhpcy50eG5zW3R4SWRdO1xuICAgICAgY2xlYXJUaW1lb3V0KHR4bi50aW1lb3V0KTtcbiAgICAgIHR4bi5yZWplY3QobmV3IEVycm9yKFwiSmFudXMgc2Vzc2lvbiB3YXMgZGlzcG9zZWQuXCIpKTtcbiAgICAgIGRlbGV0ZSB0aGlzLnR4bnNbdHhJZF07XG4gICAgfVxuICB9XG59O1xuXG4vKipcbiAqIFdoZXRoZXIgdGhpcyBzaWduYWwgcmVwcmVzZW50cyBhbiBlcnJvciwgYW5kIHRoZSBhc3NvY2lhdGVkIHByb21pc2UgKGlmIGFueSkgc2hvdWxkIGJlIHJlamVjdGVkLlxuICogVXNlcnMgc2hvdWxkIG92ZXJyaWRlIHRoaXMgdG8gaGFuZGxlIGFueSBjdXN0b20gcGx1Z2luLXNwZWNpZmljIGVycm9yIGNvbnZlbnRpb25zLlxuICoqL1xuSmFudXNTZXNzaW9uLnByb3RvdHlwZS5pc0Vycm9yID0gZnVuY3Rpb24oc2lnbmFsKSB7XG4gIHJldHVybiBzaWduYWwuamFudXMgPT09IFwiZXJyb3JcIjtcbn07XG5cbi8qKiBSZWdpc3RlcnMgYSBjYWxsYmFjayB0byBiZSBmaXJlZCB1cG9uIHRoZSByZWNlcHRpb24gb2YgYW55IGluY29taW5nIEphbnVzIHNpZ25hbHMgZm9yIHRoaXMgc2Vzc2lvbiB3aXRoIHRoZVxuICogYGphbnVzYCBhdHRyaWJ1dGUgZXF1YWwgdG8gYGV2YC5cbiAqKi9cbkphbnVzU2Vzc2lvbi5wcm90b3R5cGUub24gPSBmdW5jdGlvbihldiwgY2FsbGJhY2spIHtcbiAgdmFyIGhhbmRsZXJzID0gdGhpcy5ldmVudEhhbmRsZXJzW2V2XTtcbiAgaWYgKGhhbmRsZXJzID09IG51bGwpIHtcbiAgICBoYW5kbGVycyA9IHRoaXMuZXZlbnRIYW5kbGVyc1tldl0gPSBbXTtcbiAgfVxuICBoYW5kbGVycy5wdXNoKGNhbGxiYWNrKTtcbn07XG5cbi8qKlxuICogQ2FsbGJhY2sgZm9yIHJlY2VpdmluZyBKU09OIHNpZ25hbGxpbmcgbWVzc2FnZXMgcGVydGluZW50IHRvIHRoaXMgc2Vzc2lvbi4gSWYgdGhlIHNpZ25hbHMgYXJlIHJlc3BvbnNlcyB0byBwcmV2aW91c2x5XG4gKiBzZW50IHNpZ25hbHMsIHRoZSBwcm9taXNlcyBmb3IgdGhlIG91dGdvaW5nIHNpZ25hbHMgd2lsbCBiZSByZXNvbHZlZCBvciByZWplY3RlZCBhcHByb3ByaWF0ZWx5IHdpdGggdGhpcyBzaWduYWwgYXMgYW5cbiAqIGFyZ3VtZW50LlxuICpcbiAqIEV4dGVybmFsIGNhbGxlcnMgc2hvdWxkIGNhbGwgdGhpcyBmdW5jdGlvbiBldmVyeSB0aW1lIGEgbmV3IHNpZ25hbCBhcnJpdmVzIG9uIHRoZSB0cmFuc3BvcnQ7IGZvciBleGFtcGxlLCBpbiBhXG4gKiBXZWJTb2NrZXQncyBgbWVzc2FnZWAgZXZlbnQsIG9yIHdoZW4gYSBuZXcgZGF0dW0gc2hvd3MgdXAgaW4gYW4gSFRUUCBsb25nLXBvbGxpbmcgcmVzcG9uc2UuXG4gKiovXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLnJlY2VpdmUgPSBmdW5jdGlvbihzaWduYWwpIHtcbiAgaWYgKHRoaXMub3B0aW9ucy52ZXJib3NlKSB7XG4gICAgdGhpcy5fbG9nSW5jb21pbmcoc2lnbmFsKTtcbiAgfVxuICBpZiAoc2lnbmFsLnNlc3Npb25faWQgIT0gdGhpcy5pZCkge1xuICAgIGNvbnNvbGUud2FybihcIkluY29ycmVjdCBzZXNzaW9uIElEIHJlY2VpdmVkIGluIEphbnVzIHNpZ25hbGxpbmcgbWVzc2FnZTogd2FzIFwiICsgc2lnbmFsLnNlc3Npb25faWQgKyBcIiwgZXhwZWN0ZWQgXCIgKyB0aGlzLmlkICsgXCIuXCIpO1xuICB9XG5cbiAgdmFyIHJlc3BvbnNlVHlwZSA9IHNpZ25hbC5qYW51cztcbiAgdmFyIGhhbmRsZXJzID0gdGhpcy5ldmVudEhhbmRsZXJzW3Jlc3BvbnNlVHlwZV07XG4gIGlmIChoYW5kbGVycyAhPSBudWxsKSB7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBoYW5kbGVycy5sZW5ndGg7IGkrKykge1xuICAgICAgaGFuZGxlcnNbaV0oc2lnbmFsKTtcbiAgICB9XG4gIH1cblxuICBpZiAoc2lnbmFsLnRyYW5zYWN0aW9uICE9IG51bGwpIHtcbiAgICB2YXIgdHhuID0gdGhpcy50eG5zW3NpZ25hbC50cmFuc2FjdGlvbl07XG4gICAgaWYgKHR4biA9PSBudWxsKSB7XG4gICAgICAvLyB0aGlzIGlzIGEgcmVzcG9uc2UgdG8gYSB0cmFuc2FjdGlvbiB0aGF0IHdhc24ndCBjYXVzZWQgdmlhIEphbnVzU2Vzc2lvbi5zZW5kLCBvciBhIHBsdWdpbiByZXBsaWVkIHR3aWNlIHRvIGFcbiAgICAgIC8vIHNpbmdsZSByZXF1ZXN0LCBvciB0aGUgc2Vzc2lvbiB3YXMgZGlzcG9zZWQsIG9yIHNvbWV0aGluZyBlbHNlIHRoYXQgaXNuJ3QgdW5kZXIgb3VyIHB1cnZpZXc7IHRoYXQncyBmaW5lXG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKHJlc3BvbnNlVHlwZSA9PT0gXCJhY2tcIiAmJiB0eG4udHlwZSA9PSBcIm1lc3NhZ2VcIikge1xuICAgICAgLy8gdGhpcyBpcyBhbiBhY2sgb2YgYW4gYXN5bmNocm9ub3VzbHktcHJvY2Vzc2VkIHBsdWdpbiByZXF1ZXN0LCB3ZSBzaG91bGQgd2FpdCB0byByZXNvbHZlIHRoZSBwcm9taXNlIHVudGlsIHRoZVxuICAgICAgLy8gYWN0dWFsIHJlc3BvbnNlIGNvbWVzIGluXG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY2xlYXJUaW1lb3V0KHR4bi50aW1lb3V0KTtcblxuICAgIGRlbGV0ZSB0aGlzLnR4bnNbc2lnbmFsLnRyYW5zYWN0aW9uXTtcbiAgICAodGhpcy5pc0Vycm9yKHNpZ25hbCkgPyB0eG4ucmVqZWN0IDogdHhuLnJlc29sdmUpKHNpZ25hbCk7XG4gIH1cbn07XG5cbi8qKlxuICogU2VuZHMgYSBzaWduYWwgYXNzb2NpYXRlZCB3aXRoIHRoaXMgc2Vzc2lvbiwgYmVnaW5uaW5nIGEgbmV3IHRyYW5zYWN0aW9uLiBSZXR1cm5zIGEgcHJvbWlzZSB0aGF0IHdpbGwgYmUgcmVzb2x2ZWQgb3JcbiAqIHJlamVjdGVkIHdoZW4gYSByZXNwb25zZSBpcyByZWNlaXZlZCBpbiB0aGUgc2FtZSB0cmFuc2FjdGlvbiwgb3Igd2hlbiBubyByZXNwb25zZSBpcyByZWNlaXZlZCB3aXRoaW4gdGhlIHNlc3Npb25cbiAqIHRpbWVvdXQuXG4gKiovXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLnNlbmQgPSBmdW5jdGlvbih0eXBlLCBzaWduYWwpIHtcbiAgc2lnbmFsID0gT2JqZWN0LmFzc2lnbih7IHRyYW5zYWN0aW9uOiAodGhpcy5uZXh0VHhJZCsrKS50b1N0cmluZygpIH0sIHNpZ25hbCk7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgdmFyIHRpbWVvdXQgPSBudWxsO1xuICAgIGlmICh0aGlzLm9wdGlvbnMudGltZW91dE1zKSB7XG4gICAgICB0aW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIGRlbGV0ZSB0aGlzLnR4bnNbc2lnbmFsLnRyYW5zYWN0aW9uXTtcbiAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihcIlNpZ25hbGxpbmcgdHJhbnNhY3Rpb24gd2l0aCB0eGlkIFwiICsgc2lnbmFsLnRyYW5zYWN0aW9uICsgXCIgdGltZWQgb3V0LlwiKSk7XG4gICAgICB9LCB0aGlzLm9wdGlvbnMudGltZW91dE1zKTtcbiAgICB9XG4gICAgdGhpcy50eG5zW3NpZ25hbC50cmFuc2FjdGlvbl0gPSB7IHJlc29sdmU6IHJlc29sdmUsIHJlamVjdDogcmVqZWN0LCB0aW1lb3V0OiB0aW1lb3V0LCB0eXBlOiB0eXBlIH07XG4gICAgdGhpcy5fdHJhbnNtaXQodHlwZSwgc2lnbmFsKTtcbiAgfSk7XG59O1xuXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLl90cmFuc21pdCA9IGZ1bmN0aW9uKHR5cGUsIHNpZ25hbCkge1xuICBzaWduYWwgPSBPYmplY3QuYXNzaWduKHsgamFudXM6IHR5cGUgfSwgc2lnbmFsKTtcblxuICBpZiAodGhpcy5pZCAhPSBudWxsKSB7IC8vIHRoaXMuaWQgaXMgdW5kZWZpbmVkIGluIHRoZSBzcGVjaWFsIGNhc2Ugd2hlbiB3ZSdyZSBzZW5kaW5nIHRoZSBzZXNzaW9uIGNyZWF0ZSBtZXNzYWdlXG4gICAgc2lnbmFsID0gT2JqZWN0LmFzc2lnbih7IHNlc3Npb25faWQ6IHRoaXMuaWQgfSwgc2lnbmFsKTtcbiAgfVxuXG4gIGlmICh0aGlzLm9wdGlvbnMudmVyYm9zZSkge1xuICAgIHRoaXMuX2xvZ091dGdvaW5nKHNpZ25hbCk7XG4gIH1cblxuICB0aGlzLm91dHB1dChKU09OLnN0cmluZ2lmeShzaWduYWwpKTtcbiAgdGhpcy5fcmVzZXRLZWVwYWxpdmUoKTtcbn07XG5cbkphbnVzU2Vzc2lvbi5wcm90b3R5cGUuX2xvZ091dGdvaW5nID0gZnVuY3Rpb24oc2lnbmFsKSB7XG4gIHZhciBraW5kID0gc2lnbmFsLmphbnVzO1xuICBpZiAoa2luZCA9PT0gXCJtZXNzYWdlXCIgJiYgc2lnbmFsLmpzZXApIHtcbiAgICBraW5kID0gc2lnbmFsLmpzZXAudHlwZTtcbiAgfVxuICB2YXIgbWVzc2FnZSA9IFwiPiBPdXRnb2luZyBKYW51cyBcIiArIChraW5kIHx8IFwic2lnbmFsXCIpICsgXCIgKCNcIiArIHNpZ25hbC50cmFuc2FjdGlvbiArIFwiKTogXCI7XG4gIGNvbnNvbGUuZGVidWcoXCIlY1wiICsgbWVzc2FnZSwgXCJjb2xvcjogIzA0MFwiLCBzaWduYWwpO1xufTtcblxuSmFudXNTZXNzaW9uLnByb3RvdHlwZS5fbG9nSW5jb21pbmcgPSBmdW5jdGlvbihzaWduYWwpIHtcbiAgdmFyIGtpbmQgPSBzaWduYWwuamFudXM7XG4gIHZhciBtZXNzYWdlID0gc2lnbmFsLnRyYW5zYWN0aW9uID9cbiAgICAgIFwiPCBJbmNvbWluZyBKYW51cyBcIiArIChraW5kIHx8IFwic2lnbmFsXCIpICsgXCIgKCNcIiArIHNpZ25hbC50cmFuc2FjdGlvbiArIFwiKTogXCIgOlxuICAgICAgXCI8IEluY29taW5nIEphbnVzIFwiICsgKGtpbmQgfHwgXCJzaWduYWxcIikgKyBcIjogXCI7XG4gIGNvbnNvbGUuZGVidWcoXCIlY1wiICsgbWVzc2FnZSwgXCJjb2xvcjogIzAwNFwiLCBzaWduYWwpO1xufTtcblxuSmFudXNTZXNzaW9uLnByb3RvdHlwZS5fc2VuZEtlZXBhbGl2ZSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5zZW5kKFwia2VlcGFsaXZlXCIpO1xufTtcblxuSmFudXNTZXNzaW9uLnByb3RvdHlwZS5fa2lsbEtlZXBhbGl2ZSA9IGZ1bmN0aW9uKCkge1xuICBjbGVhclRpbWVvdXQodGhpcy5rZWVwYWxpdmVUaW1lb3V0KTtcbn07XG5cbkphbnVzU2Vzc2lvbi5wcm90b3R5cGUuX3Jlc2V0S2VlcGFsaXZlID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuX2tpbGxLZWVwYWxpdmUoKTtcbiAgaWYgKHRoaXMub3B0aW9ucy5rZWVwYWxpdmVNcykge1xuICAgIHRoaXMua2VlcGFsaXZlVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy5fc2VuZEtlZXBhbGl2ZSgpLmNhdGNoKGUgPT4gY29uc29sZS5lcnJvcihcIkVycm9yIHJlY2VpdmVkIGZyb20ga2VlcGFsaXZlOiBcIiwgZSkpO1xuICAgIH0sIHRoaXMub3B0aW9ucy5rZWVwYWxpdmVNcyk7XG4gIH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBKYW51c1BsdWdpbkhhbmRsZSxcbiAgSmFudXNTZXNzaW9uXG59O1xuIiwiLyogZ2xvYmFsIE5BRiAqL1xudmFyIG1qID0gcmVxdWlyZShcIkBuZXR3b3JrZWQtYWZyYW1lL21pbmlqYW51c1wiKTtcbm1qLkphbnVzU2Vzc2lvbi5wcm90b3R5cGUuc2VuZE9yaWdpbmFsID0gbWouSmFudXNTZXNzaW9uLnByb3RvdHlwZS5zZW5kO1xubWouSmFudXNTZXNzaW9uLnByb3RvdHlwZS5zZW5kID0gZnVuY3Rpb24odHlwZSwgc2lnbmFsKSB7XG4gIHJldHVybiB0aGlzLnNlbmRPcmlnaW5hbCh0eXBlLCBzaWduYWwpLmNhdGNoKChlKSA9PiB7XG4gICAgaWYgKGUubWVzc2FnZSAmJiBlLm1lc3NhZ2UuaW5kZXhPZihcInRpbWVkIG91dFwiKSA+IC0xKSB7XG4gICAgICBjb25zb2xlLmVycm9yKFwid2ViIHNvY2tldCB0aW1lZCBvdXRcIik7XG4gICAgICBOQUYuY29ubmVjdGlvbi5hZGFwdGVyLnJlY29ubmVjdCgpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyhlKTtcbiAgICB9XG4gIH0pO1xufVxuXG52YXIgc2RwVXRpbHMgPSByZXF1aXJlKFwic2RwXCIpO1xuLy92YXIgZGVidWcgPSByZXF1aXJlKFwiZGVidWdcIikoXCJuYWYtamFudXMtYWRhcHRlcjpkZWJ1Z1wiKTtcbi8vdmFyIHdhcm4gPSByZXF1aXJlKFwiZGVidWdcIikoXCJuYWYtamFudXMtYWRhcHRlcjp3YXJuXCIpO1xuLy92YXIgZXJyb3IgPSByZXF1aXJlKFwiZGVidWdcIikoXCJuYWYtamFudXMtYWRhcHRlcjplcnJvclwiKTtcbnZhciBkZWJ1ZyA9IGNvbnNvbGUubG9nO1xudmFyIHdhcm4gPSBjb25zb2xlLndhcm47XG52YXIgZXJyb3IgPSBjb25zb2xlLmVycm9yO1xudmFyIGlzU2FmYXJpID0gL14oKD8hY2hyb21lfGFuZHJvaWQpLikqc2FmYXJpL2kudGVzdChuYXZpZ2F0b3IudXNlckFnZW50KTtcblxuY29uc3QgU1VCU0NSSUJFX1RJTUVPVVRfTVMgPSAxNTAwMDtcblxuZnVuY3Rpb24gZGVib3VuY2UoZm4pIHtcbiAgdmFyIGN1cnIgPSBQcm9taXNlLnJlc29sdmUoKTtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciBhcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzKTtcbiAgICBjdXJyID0gY3Vyci50aGVuKF8gPT4gZm4uYXBwbHkodGhpcywgYXJncykpO1xuICB9O1xufVxuXG5mdW5jdGlvbiByYW5kb21VaW50KCkge1xuICByZXR1cm4gTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogTnVtYmVyLk1BWF9TQUZFX0lOVEVHRVIpO1xufVxuXG5mdW5jdGlvbiB1bnRpbERhdGFDaGFubmVsT3BlbihkYXRhQ2hhbm5lbCkge1xuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIGlmIChkYXRhQ2hhbm5lbC5yZWFkeVN0YXRlID09PSBcIm9wZW5cIikge1xuICAgICAgcmVzb2x2ZSgpO1xuICAgIH0gZWxzZSB7XG4gICAgICBsZXQgcmVzb2x2ZXIsIHJlamVjdG9yO1xuXG4gICAgICBjb25zdCBjbGVhciA9ICgpID0+IHtcbiAgICAgICAgZGF0YUNoYW5uZWwucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm9wZW5cIiwgcmVzb2x2ZXIpO1xuICAgICAgICBkYXRhQ2hhbm5lbC5yZW1vdmVFdmVudExpc3RlbmVyKFwiZXJyb3JcIiwgcmVqZWN0b3IpO1xuICAgICAgfTtcblxuICAgICAgcmVzb2x2ZXIgPSAoKSA9PiB7XG4gICAgICAgIGNsZWFyKCk7XG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH07XG4gICAgICByZWplY3RvciA9ICgpID0+IHtcbiAgICAgICAgY2xlYXIoKTtcbiAgICAgICAgcmVqZWN0KCk7XG4gICAgICB9O1xuXG4gICAgICBkYXRhQ2hhbm5lbC5hZGRFdmVudExpc3RlbmVyKFwib3BlblwiLCByZXNvbHZlcik7XG4gICAgICBkYXRhQ2hhbm5lbC5hZGRFdmVudExpc3RlbmVyKFwiZXJyb3JcIiwgcmVqZWN0b3IpO1xuICAgIH1cbiAgfSk7XG59XG5cbmNvbnN0IGlzSDI2NFZpZGVvU3VwcG9ydGVkID0gKCgpID0+IHtcbiAgY29uc3QgdmlkZW8gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwidmlkZW9cIik7XG4gIHJldHVybiB2aWRlby5jYW5QbGF5VHlwZSgndmlkZW8vbXA0OyBjb2RlY3M9XCJhdmMxLjQyRTAxRSwgbXA0YS40MC4yXCInKSAhPT0gXCJcIjtcbn0pKCk7XG5cbmNvbnN0IE9QVVNfUEFSQU1FVEVSUyA9IHtcbiAgLy8gaW5kaWNhdGVzIHRoYXQgd2Ugd2FudCB0byBlbmFibGUgRFRYIHRvIGVsaWRlIHNpbGVuY2UgcGFja2V0c1xuICB1c2VkdHg6IDEsXG4gIC8vIGluZGljYXRlcyB0aGF0IHdlIHByZWZlciB0byByZWNlaXZlIG1vbm8gYXVkaW8gKGltcG9ydGFudCBmb3Igdm9pcCBwcm9maWxlKVxuICBzdGVyZW86IDAsXG4gIC8vIGluZGljYXRlcyB0aGF0IHdlIHByZWZlciB0byBzZW5kIG1vbm8gYXVkaW8gKGltcG9ydGFudCBmb3Igdm9pcCBwcm9maWxlKVxuICBcInNwcm9wLXN0ZXJlb1wiOiAwXG59O1xuXG5jb25zdCBERUZBVUxUX1BFRVJfQ09OTkVDVElPTl9DT05GSUcgPSB7XG4gIGljZVNlcnZlcnM6IFt7IHVybHM6IFwic3R1bjpzdHVuMS5sLmdvb2dsZS5jb206MTkzMDJcIiB9LCB7IHVybHM6IFwic3R1bjpzdHVuMi5sLmdvb2dsZS5jb206MTkzMDJcIiB9XVxufTtcblxuY29uc3QgV1NfTk9STUFMX0NMT1NVUkUgPSAxMDAwO1xuXG5jbGFzcyBKYW51c0FkYXB0ZXIge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICB0aGlzLnJvb20gPSBudWxsO1xuICAgIC8vIFdlIGV4cGVjdCB0aGUgY29uc3VtZXIgdG8gc2V0IGEgY2xpZW50IGlkIGJlZm9yZSBjb25uZWN0aW5nLlxuICAgIHRoaXMuY2xpZW50SWQgPSBudWxsO1xuICAgIHRoaXMuam9pblRva2VuID0gbnVsbDtcblxuICAgIHRoaXMuc2VydmVyVXJsID0gbnVsbDtcbiAgICB0aGlzLndlYlJ0Y09wdGlvbnMgPSB7fTtcbiAgICB0aGlzLnBlZXJDb25uZWN0aW9uQ29uZmlnID0gbnVsbDtcbiAgICB0aGlzLndzID0gbnVsbDtcbiAgICB0aGlzLnNlc3Npb24gPSBudWxsO1xuICAgIHRoaXMucmVsaWFibGVUcmFuc3BvcnQgPSBcImRhdGFjaGFubmVsXCI7XG4gICAgdGhpcy51bnJlbGlhYmxlVHJhbnNwb3J0ID0gXCJkYXRhY2hhbm5lbFwiO1xuXG4gICAgLy8gSW4gdGhlIGV2ZW50IHRoZSBzZXJ2ZXIgcmVzdGFydHMgYW5kIGFsbCBjbGllbnRzIGxvc2UgY29ubmVjdGlvbiwgcmVjb25uZWN0IHdpdGhcbiAgICAvLyBzb21lIHJhbmRvbSBqaXR0ZXIgYWRkZWQgdG8gcHJldmVudCBzaW11bHRhbmVvdXMgcmVjb25uZWN0aW9uIHJlcXVlc3RzLlxuICAgIHRoaXMuaW5pdGlhbFJlY29ubmVjdGlvbkRlbGF5ID0gMTAwMCAqIE1hdGgucmFuZG9tKCk7XG4gICAgdGhpcy5yZWNvbm5lY3Rpb25EZWxheSA9IHRoaXMuaW5pdGlhbFJlY29ubmVjdGlvbkRlbGF5O1xuICAgIHRoaXMucmVjb25uZWN0aW9uVGltZW91dCA9IG51bGw7XG4gICAgdGhpcy5tYXhSZWNvbm5lY3Rpb25BdHRlbXB0cyA9IDEwO1xuICAgIHRoaXMucmVjb25uZWN0aW9uQXR0ZW1wdHMgPSAwO1xuICAgIHRoaXMuaXNSZWNvbm5lY3RpbmcgPSBmYWxzZTtcblxuICAgIHRoaXMucHVibGlzaGVyID0gbnVsbDtcbiAgICB0aGlzLm9jY3VwYW50cyA9IHt9O1xuICAgIHRoaXMubGVmdE9jY3VwYW50cyA9IG5ldyBTZXQoKTtcbiAgICB0aGlzLm1lZGlhU3RyZWFtcyA9IHt9O1xuICAgIHRoaXMubG9jYWxNZWRpYVN0cmVhbSA9IG51bGw7XG4gICAgdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cyA9IG5ldyBNYXAoKTtcblxuICAgIHRoaXMuYmxvY2tlZENsaWVudHMgPSBuZXcgTWFwKCk7XG4gICAgdGhpcy5mcm96ZW5VcGRhdGVzID0gbmV3IE1hcCgpO1xuXG4gICAgdGhpcy50aW1lT2Zmc2V0cyA9IFtdO1xuICAgIHRoaXMuc2VydmVyVGltZVJlcXVlc3RzID0gMDtcbiAgICB0aGlzLmF2Z1RpbWVPZmZzZXQgPSAwO1xuXG4gICAgdGhpcy5vbldlYnNvY2tldE9wZW4gPSB0aGlzLm9uV2Vic29ja2V0T3Blbi5iaW5kKHRoaXMpO1xuICAgIHRoaXMub25XZWJzb2NrZXRDbG9zZSA9IHRoaXMub25XZWJzb2NrZXRDbG9zZS5iaW5kKHRoaXMpO1xuICAgIHRoaXMub25XZWJzb2NrZXRNZXNzYWdlID0gdGhpcy5vbldlYnNvY2tldE1lc3NhZ2UuYmluZCh0aGlzKTtcbiAgICB0aGlzLm9uRGF0YUNoYW5uZWxNZXNzYWdlID0gdGhpcy5vbkRhdGFDaGFubmVsTWVzc2FnZS5iaW5kKHRoaXMpO1xuICAgIHRoaXMub25EYXRhID0gdGhpcy5vbkRhdGEuYmluZCh0aGlzKTtcbiAgfVxuXG4gIHNldFNlcnZlclVybCh1cmwpIHtcbiAgICB0aGlzLnNlcnZlclVybCA9IHVybDtcbiAgfVxuXG4gIHNldEFwcChhcHApIHt9XG5cbiAgc2V0Um9vbShyb29tTmFtZSkge1xuICAgIHRoaXMucm9vbSA9IHJvb21OYW1lO1xuICB9XG5cbiAgc2V0Sm9pblRva2VuKGpvaW5Ub2tlbikge1xuICAgIHRoaXMuam9pblRva2VuID0gam9pblRva2VuO1xuICB9XG5cbiAgc2V0Q2xpZW50SWQoY2xpZW50SWQpIHtcbiAgICB0aGlzLmNsaWVudElkID0gY2xpZW50SWQ7XG4gIH1cblxuICBzZXRXZWJSdGNPcHRpb25zKG9wdGlvbnMpIHtcbiAgICB0aGlzLndlYlJ0Y09wdGlvbnMgPSBvcHRpb25zO1xuICB9XG5cbiAgc2V0UGVlckNvbm5lY3Rpb25Db25maWcocGVlckNvbm5lY3Rpb25Db25maWcpIHtcbiAgICB0aGlzLnBlZXJDb25uZWN0aW9uQ29uZmlnID0gcGVlckNvbm5lY3Rpb25Db25maWc7XG4gIH1cblxuICBzZXRTZXJ2ZXJDb25uZWN0TGlzdGVuZXJzKHN1Y2Nlc3NMaXN0ZW5lciwgZmFpbHVyZUxpc3RlbmVyKSB7XG4gICAgdGhpcy5jb25uZWN0U3VjY2VzcyA9IHN1Y2Nlc3NMaXN0ZW5lcjtcbiAgICB0aGlzLmNvbm5lY3RGYWlsdXJlID0gZmFpbHVyZUxpc3RlbmVyO1xuICB9XG5cbiAgc2V0Um9vbU9jY3VwYW50TGlzdGVuZXIob2NjdXBhbnRMaXN0ZW5lcikge1xuICAgIHRoaXMub25PY2N1cGFudHNDaGFuZ2VkID0gb2NjdXBhbnRMaXN0ZW5lcjtcbiAgfVxuXG4gIHNldERhdGFDaGFubmVsTGlzdGVuZXJzKG9wZW5MaXN0ZW5lciwgY2xvc2VkTGlzdGVuZXIsIG1lc3NhZ2VMaXN0ZW5lcikge1xuICAgIHRoaXMub25PY2N1cGFudENvbm5lY3RlZCA9IG9wZW5MaXN0ZW5lcjtcbiAgICB0aGlzLm9uT2NjdXBhbnREaXNjb25uZWN0ZWQgPSBjbG9zZWRMaXN0ZW5lcjtcbiAgICB0aGlzLm9uT2NjdXBhbnRNZXNzYWdlID0gbWVzc2FnZUxpc3RlbmVyO1xuICB9XG5cbiAgc2V0UmVjb25uZWN0aW9uTGlzdGVuZXJzKHJlY29ubmVjdGluZ0xpc3RlbmVyLCByZWNvbm5lY3RlZExpc3RlbmVyLCByZWNvbm5lY3Rpb25FcnJvckxpc3RlbmVyKSB7XG4gICAgLy8gb25SZWNvbm5lY3RpbmcgaXMgY2FsbGVkIHdpdGggdGhlIG51bWJlciBvZiBtaWxsaXNlY29uZHMgdW50aWwgdGhlIG5leHQgcmVjb25uZWN0aW9uIGF0dGVtcHRcbiAgICB0aGlzLm9uUmVjb25uZWN0aW5nID0gcmVjb25uZWN0aW5nTGlzdGVuZXI7XG4gICAgLy8gb25SZWNvbm5lY3RlZCBpcyBjYWxsZWQgd2hlbiB0aGUgY29ubmVjdGlvbiBoYXMgYmVlbiByZWVzdGFibGlzaGVkXG4gICAgdGhpcy5vblJlY29ubmVjdGVkID0gcmVjb25uZWN0ZWRMaXN0ZW5lcjtcbiAgICAvLyBvblJlY29ubmVjdGlvbkVycm9yIGlzIGNhbGxlZCB3aXRoIGFuIGVycm9yIHdoZW4gbWF4UmVjb25uZWN0aW9uQXR0ZW1wdHMgaGFzIGJlZW4gcmVhY2hlZFxuICAgIHRoaXMub25SZWNvbm5lY3Rpb25FcnJvciA9IHJlY29ubmVjdGlvbkVycm9yTGlzdGVuZXI7XG4gIH1cblxuICBzZXRFdmVudExvb3BzKGxvb3BzKSB7XG4gICAgdGhpcy5sb29wcyA9IGxvb3BzO1xuICB9XG5cbiAgY29ubmVjdCgpIHtcbiAgICBpZiAodGhpcy5zZXJ2ZXJVcmwgPT09ICcvJykge1xuICAgICAgdGhpcy5zZXJ2ZXJVcmwgPSAnL2phbnVzJztcbiAgICB9XG4gICAgaWYgKHRoaXMuc2VydmVyVXJsID09PSAnL2phbnVzJykge1xuICAgICAgaWYgKGxvY2F0aW9uLnByb3RvY29sID09PSAnaHR0cHM6Jykge1xuICAgICAgICB0aGlzLnNlcnZlclVybCA9ICd3c3M6Ly8nICsgbG9jYXRpb24uaG9zdCArICcvamFudXMnO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5zZXJ2ZXJVcmwgPSAnd3M6Ly8nICsgbG9jYXRpb24uaG9zdCArICcvamFudXMnO1xuICAgICAgfVxuICAgIH1cbiAgICBkZWJ1ZyhgY29ubmVjdGluZyB0byAke3RoaXMuc2VydmVyVXJsfWApO1xuXG4gICAgY29uc3Qgd2Vic29ja2V0Q29ubmVjdGlvbiA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIHRoaXMud3MgPSBuZXcgV2ViU29ja2V0KHRoaXMuc2VydmVyVXJsLCBcImphbnVzLXByb3RvY29sXCIpO1xuXG4gICAgICB0aGlzLnNlc3Npb24gPSBuZXcgbWouSmFudXNTZXNzaW9uKHRoaXMud3Muc2VuZC5iaW5kKHRoaXMud3MpLCB7IHRpbWVvdXRNczogNDAwMDAgfSk7XG5cbiAgICAgIHRoaXMud2Vic29ja2V0Q29ubmVjdGlvblByb21pc2UgPSB7fTtcbiAgICAgIHRoaXMud2Vic29ja2V0Q29ubmVjdGlvblByb21pc2UucmVzb2x2ZSA9IHJlc29sdmU7XG4gICAgICB0aGlzLndlYnNvY2tldENvbm5lY3Rpb25Qcm9taXNlLnJlamVjdCA9IHJlamVjdDtcblxuICAgICAgdGhpcy53cy5hZGRFdmVudExpc3RlbmVyKFwiY2xvc2VcIiwgdGhpcy5vbldlYnNvY2tldENsb3NlKTtcbiAgICAgIHRoaXMud3MuYWRkRXZlbnRMaXN0ZW5lcihcIm1lc3NhZ2VcIiwgdGhpcy5vbldlYnNvY2tldE1lc3NhZ2UpO1xuXG4gICAgICB0aGlzLndzT25PcGVuID0gKCkgPT4ge1xuICAgICAgICB0aGlzLndzLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJvcGVuXCIsIHRoaXMud3NPbk9wZW4pO1xuICAgICAgICB0aGlzLm9uV2Vic29ja2V0T3BlbigpXG4gICAgICAgICAgLnRoZW4ocmVzb2x2ZSlcbiAgICAgICAgICAuY2F0Y2gocmVqZWN0KTtcbiAgICAgIH07XG5cbiAgICAgIHRoaXMud3MuYWRkRXZlbnRMaXN0ZW5lcihcIm9wZW5cIiwgdGhpcy53c09uT3Blbik7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gUHJvbWlzZS5hbGwoW3dlYnNvY2tldENvbm5lY3Rpb24sIHRoaXMudXBkYXRlVGltZU9mZnNldCgpXSk7XG4gIH1cblxuICBkaXNjb25uZWN0KCkge1xuICAgIGRlYnVnKGBkaXNjb25uZWN0aW5nYCk7XG5cbiAgICBjbGVhclRpbWVvdXQodGhpcy5yZWNvbm5lY3Rpb25UaW1lb3V0KTtcblxuICAgIHRoaXMucmVtb3ZlQWxsT2NjdXBhbnRzKCk7XG4gICAgdGhpcy5sZWZ0T2NjdXBhbnRzID0gbmV3IFNldCgpO1xuXG4gICAgaWYgKHRoaXMucHVibGlzaGVyKSB7XG4gICAgICAvLyBDbG9zZSB0aGUgcHVibGlzaGVyIHBlZXIgY29ubmVjdGlvbi4gV2hpY2ggYWxzbyBkZXRhY2hlcyB0aGUgcGx1Z2luIGhhbmRsZS5cbiAgICAgIHRoaXMucHVibGlzaGVyLmNvbm4uY2xvc2UoKTtcbiAgICAgIHRoaXMucHVibGlzaGVyID0gbnVsbDtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5zZXNzaW9uKSB7XG4gICAgICB0aGlzLnNlc3Npb24uZGlzcG9zZSgpO1xuICAgICAgdGhpcy5zZXNzaW9uID0gbnVsbDtcbiAgICB9XG5cbiAgICBpZiAodGhpcy53cykge1xuICAgICAgdGhpcy53cy5yZW1vdmVFdmVudExpc3RlbmVyKFwib3BlblwiLCB0aGlzLndzT25PcGVuKTtcbiAgICAgIHRoaXMud3MucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImNsb3NlXCIsIHRoaXMub25XZWJzb2NrZXRDbG9zZSk7XG4gICAgICB0aGlzLndzLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJtZXNzYWdlXCIsIHRoaXMub25XZWJzb2NrZXRNZXNzYWdlKTtcbiAgICAgIHRoaXMud3MuY2xvc2UoKTtcbiAgICAgIHRoaXMud3MgPSBudWxsO1xuICAgIH1cblxuICAgIC8vIE5vdyB0aGF0IGFsbCBSVENQZWVyQ29ubmVjdGlvbiBjbG9zZWQsIGJlIHN1cmUgdG8gbm90IGNhbGxcbiAgICAvLyByZWNvbm5lY3QoKSBhZ2FpbiB2aWEgcGVyZm9ybURlbGF5ZWRSZWNvbm5lY3QgaWYgcHJldmlvdXNcbiAgICAvLyBSVENQZWVyQ29ubmVjdGlvbiB3YXMgaW4gdGhlIGZhaWxlZCBzdGF0ZS5cbiAgICBpZiAodGhpcy5kZWxheWVkUmVjb25uZWN0VGltZW91dCkge1xuICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuZGVsYXllZFJlY29ubmVjdFRpbWVvdXQpO1xuICAgICAgdGhpcy5kZWxheWVkUmVjb25uZWN0VGltZW91dCA9IG51bGw7XG4gICAgfVxuICB9XG5cbiAgaXNEaXNjb25uZWN0ZWQoKSB7XG4gICAgcmV0dXJuIHRoaXMud3MgPT09IG51bGw7XG4gIH1cblxuICBhc3luYyBvbldlYnNvY2tldE9wZW4oKSB7XG4gICAgLy8gQ3JlYXRlIHRoZSBKYW51cyBTZXNzaW9uXG4gICAgYXdhaXQgdGhpcy5zZXNzaW9uLmNyZWF0ZSgpO1xuXG4gICAgLy8gQXR0YWNoIHRoZSBTRlUgUGx1Z2luIGFuZCBjcmVhdGUgYSBSVENQZWVyQ29ubmVjdGlvbiBmb3IgdGhlIHB1Ymxpc2hlci5cbiAgICAvLyBUaGUgcHVibGlzaGVyIHNlbmRzIGF1ZGlvIGFuZCBvcGVucyB0d28gYmlkaXJlY3Rpb25hbCBkYXRhIGNoYW5uZWxzLlxuICAgIC8vIE9uZSByZWxpYWJsZSBkYXRhY2hhbm5lbCBhbmQgb25lIHVucmVsaWFibGUuXG4gICAgdGhpcy5wdWJsaXNoZXIgPSBhd2FpdCB0aGlzLmNyZWF0ZVB1Ymxpc2hlcigpO1xuXG4gICAgLy8gQ2FsbCB0aGUgbmFmIGNvbm5lY3RTdWNjZXNzIGNhbGxiYWNrIGJlZm9yZSB3ZSBzdGFydCByZWNlaXZpbmcgV2ViUlRDIG1lc3NhZ2VzLlxuICAgIHRoaXMuY29ubmVjdFN1Y2Nlc3ModGhpcy5jbGllbnRJZCk7XG5cbiAgICBjb25zdCBhZGRPY2N1cGFudFByb21pc2VzID0gW107XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRoaXMucHVibGlzaGVyLmluaXRpYWxPY2N1cGFudHMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGNvbnN0IG9jY3VwYW50SWQgPSB0aGlzLnB1Ymxpc2hlci5pbml0aWFsT2NjdXBhbnRzW2ldO1xuICAgICAgaWYgKG9jY3VwYW50SWQgPT09IHRoaXMuY2xpZW50SWQpIGNvbnRpbnVlOyAvLyBIYXBwZW5zIGR1cmluZyBub24tZ3JhY2VmdWwgcmVjb25uZWN0cyBkdWUgdG8gem9tYmllIHNlc3Npb25zXG4gICAgICBhZGRPY2N1cGFudFByb21pc2VzLnB1c2godGhpcy5hZGRPY2N1cGFudChvY2N1cGFudElkKSk7XG4gICAgfVxuXG4gICAgYXdhaXQgUHJvbWlzZS5hbGwoYWRkT2NjdXBhbnRQcm9taXNlcyk7XG4gIH1cblxuICBvbldlYnNvY2tldENsb3NlKGV2ZW50KSB7XG4gICAgLy8gVGhlIGNvbm5lY3Rpb24gd2FzIGNsb3NlZCBzdWNjZXNzZnVsbHkuIERvbid0IHRyeSB0byByZWNvbm5lY3QuXG4gICAgaWYgKGV2ZW50LmNvZGUgPT09IFdTX05PUk1BTF9DTE9TVVJFKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy53ZWJzb2NrZXRDb25uZWN0aW9uUHJvbWlzZS5yZWplY3QoZXZlbnQpO1xuXG4gICAgaWYgKCF0aGlzLmlzUmVjb25uZWN0aW5nKSB7XG4gICAgICB0aGlzLmlzUmVjb25uZWN0aW5nID0gdHJ1ZTtcbiAgICAgIGNvbnNvbGUud2FybihcIkphbnVzIHdlYnNvY2tldCBjbG9zZWQgdW5leHBlY3RlZGx5LlwiKTtcbiAgICAgIGlmICh0aGlzLm9uUmVjb25uZWN0aW5nKSB7XG4gICAgICAgIHRoaXMub25SZWNvbm5lY3RpbmcodGhpcy5yZWNvbm5lY3Rpb25EZWxheSk7XG4gICAgICB9XG5cbiAgICAgIHRoaXMucmVjb25uZWN0aW9uVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4gdGhpcy5yZWNvbm5lY3QoKSwgdGhpcy5yZWNvbm5lY3Rpb25EZWxheSk7XG4gICAgfVxuICB9XG5cbiAgcmVjb25uZWN0KCkge1xuICAgIC8vIERpc3Bvc2Ugb2YgYWxsIG5ldHdvcmtlZCBlbnRpdGllcyBhbmQgb3RoZXIgcmVzb3VyY2VzIHRpZWQgdG8gdGhlIHNlc3Npb24uXG4gICAgdGhpcy5kaXNjb25uZWN0KCk7XG5cbiAgICB0aGlzLmNvbm5lY3QoKVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICB0aGlzLnJlY29ubmVjdGlvbkRlbGF5ID0gdGhpcy5pbml0aWFsUmVjb25uZWN0aW9uRGVsYXk7XG4gICAgICAgIHRoaXMucmVjb25uZWN0aW9uQXR0ZW1wdHMgPSAwO1xuICAgICAgICB0aGlzLmlzUmVjb25uZWN0aW5nID0gZmFsc2U7XG5cbiAgICAgICAgaWYgKHRoaXMub25SZWNvbm5lY3RlZCkge1xuICAgICAgICAgIHRoaXMub25SZWNvbm5lY3RlZCgpO1xuICAgICAgICB9XG4gICAgICB9KVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgdGhpcy5yZWNvbm5lY3Rpb25EZWxheSArPSAxMDAwO1xuICAgICAgICB0aGlzLnJlY29ubmVjdGlvbkF0dGVtcHRzKys7XG5cbiAgICAgICAgaWYgKHRoaXMucmVjb25uZWN0aW9uQXR0ZW1wdHMgPiB0aGlzLm1heFJlY29ubmVjdGlvbkF0dGVtcHRzKSB7XG4gICAgICAgICAgY29uc3QgZXJyb3IgPSBuZXcgRXJyb3IoXG4gICAgICAgICAgICBcIkNvbm5lY3Rpb24gY291bGQgbm90IGJlIHJlZXN0YWJsaXNoZWQsIGV4Y2VlZGVkIG1heGltdW0gbnVtYmVyIG9mIHJlY29ubmVjdGlvbiBhdHRlbXB0cy5cIlxuICAgICAgICAgICk7XG4gICAgICAgICAgaWYgKHRoaXMub25SZWNvbm5lY3Rpb25FcnJvcikge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMub25SZWNvbm5lY3Rpb25FcnJvcihlcnJvcik7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnNvbGUud2FybihlcnJvcik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc29sZS53YXJuKFwiRXJyb3IgZHVyaW5nIHJlY29ubmVjdCwgcmV0cnlpbmcuXCIpO1xuICAgICAgICBjb25zb2xlLndhcm4oZXJyb3IpO1xuXG4gICAgICAgIGlmICh0aGlzLm9uUmVjb25uZWN0aW5nKSB7XG4gICAgICAgICAgdGhpcy5vblJlY29ubmVjdGluZyh0aGlzLnJlY29ubmVjdGlvbkRlbGF5KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMucmVjb25uZWN0aW9uVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4gdGhpcy5yZWNvbm5lY3QoKSwgdGhpcy5yZWNvbm5lY3Rpb25EZWxheSk7XG4gICAgICB9KTtcbiAgfVxuXG4gIHBlcmZvcm1EZWxheWVkUmVjb25uZWN0KCkge1xuICAgIGlmICh0aGlzLmRlbGF5ZWRSZWNvbm5lY3RUaW1lb3V0KSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5kZWxheWVkUmVjb25uZWN0VGltZW91dCk7XG4gICAgfVxuXG4gICAgdGhpcy5kZWxheWVkUmVjb25uZWN0VGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy5kZWxheWVkUmVjb25uZWN0VGltZW91dCA9IG51bGw7XG4gICAgICB0aGlzLnJlY29ubmVjdCgpO1xuICAgIH0sIDEwMDAwKTtcbiAgfVxuXG4gIG9uV2Vic29ja2V0TWVzc2FnZShldmVudCkge1xuICAgIHRoaXMuc2Vzc2lvbi5yZWNlaXZlKEpTT04ucGFyc2UoZXZlbnQuZGF0YSkpO1xuICB9XG5cbiAgYXN5bmMgYWRkT2NjdXBhbnQob2NjdXBhbnRJZCkge1xuICAgIGlmICh0aGlzLm9jY3VwYW50c1tvY2N1cGFudElkXSkge1xuICAgICAgdGhpcy5yZW1vdmVPY2N1cGFudChvY2N1cGFudElkKTtcbiAgICB9XG5cbiAgICB0aGlzLmxlZnRPY2N1cGFudHMuZGVsZXRlKG9jY3VwYW50SWQpO1xuXG4gICAgdmFyIHN1YnNjcmliZXIgPSBhd2FpdCB0aGlzLmNyZWF0ZVN1YnNjcmliZXIob2NjdXBhbnRJZCk7XG5cbiAgICBpZiAoIXN1YnNjcmliZXIpIHJldHVybjtcblxuICAgIHRoaXMub2NjdXBhbnRzW29jY3VwYW50SWRdID0gc3Vic2NyaWJlcjtcblxuICAgIHRoaXMuc2V0TWVkaWFTdHJlYW0ob2NjdXBhbnRJZCwgc3Vic2NyaWJlci5tZWRpYVN0cmVhbSk7XG5cbiAgICAvLyBDYWxsIHRoZSBOZXR3b3JrZWQgQUZyYW1lIGNhbGxiYWNrcyBmb3IgdGhlIG5ldyBvY2N1cGFudC5cbiAgICB0aGlzLm9uT2NjdXBhbnRDb25uZWN0ZWQob2NjdXBhbnRJZCk7XG4gICAgdGhpcy5vbk9jY3VwYW50c0NoYW5nZWQodGhpcy5vY2N1cGFudHMpO1xuXG4gICAgcmV0dXJuIHN1YnNjcmliZXI7XG4gIH1cblxuICByZW1vdmVBbGxPY2N1cGFudHMoKSB7XG4gICAgZm9yIChjb25zdCBvY2N1cGFudElkIG9mIE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKHRoaXMub2NjdXBhbnRzKSkge1xuICAgICAgdGhpcy5yZW1vdmVPY2N1cGFudChvY2N1cGFudElkKTtcbiAgICB9XG4gIH1cblxuICByZW1vdmVPY2N1cGFudChvY2N1cGFudElkKSB7XG4gICAgdGhpcy5sZWZ0T2NjdXBhbnRzLmFkZChvY2N1cGFudElkKTtcblxuICAgIGlmICh0aGlzLm9jY3VwYW50c1tvY2N1cGFudElkXSkge1xuICAgICAgLy8gQ2xvc2UgdGhlIHN1YnNjcmliZXIgcGVlciBjb25uZWN0aW9uLiBXaGljaCBhbHNvIGRldGFjaGVzIHRoZSBwbHVnaW4gaGFuZGxlLlxuICAgICAgdGhpcy5vY2N1cGFudHNbb2NjdXBhbnRJZF0uY29ubi5jbG9zZSgpO1xuICAgICAgZGVsZXRlIHRoaXMub2NjdXBhbnRzW29jY3VwYW50SWRdO1xuICAgIH1cblxuICAgIGlmICh0aGlzLm1lZGlhU3RyZWFtc1tvY2N1cGFudElkXSkge1xuICAgICAgZGVsZXRlIHRoaXMubWVkaWFTdHJlYW1zW29jY3VwYW50SWRdO1xuICAgIH1cblxuICAgIGlmICh0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmhhcyhvY2N1cGFudElkKSkge1xuICAgICAgY29uc3QgbXNnID0gXCJUaGUgdXNlciBkaXNjb25uZWN0ZWQgYmVmb3JlIHRoZSBtZWRpYSBzdHJlYW0gd2FzIHJlc29sdmVkLlwiO1xuICAgICAgdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5nZXQob2NjdXBhbnRJZCkuYXVkaW8ucmVqZWN0KG1zZyk7XG4gICAgICB0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmdldChvY2N1cGFudElkKS52aWRlby5yZWplY3QobXNnKTtcbiAgICAgIHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuZGVsZXRlKG9jY3VwYW50SWQpO1xuICAgIH1cblxuICAgIC8vIENhbGwgdGhlIE5ldHdvcmtlZCBBRnJhbWUgY2FsbGJhY2tzIGZvciB0aGUgcmVtb3ZlZCBvY2N1cGFudC5cbiAgICB0aGlzLm9uT2NjdXBhbnREaXNjb25uZWN0ZWQob2NjdXBhbnRJZCk7XG4gICAgdGhpcy5vbk9jY3VwYW50c0NoYW5nZWQodGhpcy5vY2N1cGFudHMpO1xuICB9XG5cbiAgYXNzb2NpYXRlKGNvbm4sIGhhbmRsZSkge1xuICAgIGNvbm4uYWRkRXZlbnRMaXN0ZW5lcihcImljZWNhbmRpZGF0ZVwiLCBldiA9PiB7XG4gICAgICBoYW5kbGUuc2VuZFRyaWNrbGUoZXYuY2FuZGlkYXRlIHx8IG51bGwpLmNhdGNoKGUgPT4gZXJyb3IoXCJFcnJvciB0cmlja2xpbmcgSUNFOiAlb1wiLCBlKSk7XG4gICAgfSk7XG4gICAgY29ubi5hZGRFdmVudExpc3RlbmVyKFwiaWNlY29ubmVjdGlvbnN0YXRlY2hhbmdlXCIsIGV2ID0+IHtcbiAgICAgIGlmIChjb25uLmljZUNvbm5lY3Rpb25TdGF0ZSA9PT0gXCJjb25uZWN0ZWRcIikge1xuICAgICAgICBjb25zb2xlLmxvZyhcIklDRSBzdGF0ZSBjaGFuZ2VkIHRvIGNvbm5lY3RlZFwiKTtcbiAgICAgIH1cbiAgICAgIGlmIChjb25uLmljZUNvbm5lY3Rpb25TdGF0ZSA9PT0gXCJkaXNjb25uZWN0ZWRcIikge1xuICAgICAgICBjb25zb2xlLndhcm4oXCJJQ0Ugc3RhdGUgY2hhbmdlZCB0byBkaXNjb25uZWN0ZWRcIik7XG4gICAgICB9XG4gICAgICBpZiAoY29ubi5pY2VDb25uZWN0aW9uU3RhdGUgPT09IFwiZmFpbGVkXCIpIHtcbiAgICAgICAgY29uc29sZS53YXJuKFwiSUNFIGZhaWx1cmUgZGV0ZWN0ZWQuIFJlY29ubmVjdGluZyBpbiAxMHMuXCIpO1xuICAgICAgICB0aGlzLnBlcmZvcm1EZWxheWVkUmVjb25uZWN0KCk7XG4gICAgICB9XG4gICAgfSlcblxuICAgIC8vIHdlIGhhdmUgdG8gZGVib3VuY2UgdGhlc2UgYmVjYXVzZSBqYW51cyBnZXRzIGFuZ3J5IGlmIHlvdSBzZW5kIGl0IGEgbmV3IFNEUCBiZWZvcmVcbiAgICAvLyBpdCdzIGZpbmlzaGVkIHByb2Nlc3NpbmcgYW4gZXhpc3RpbmcgU0RQLiBpbiBhY3R1YWxpdHksIGl0IHNlZW1zIGxpa2UgdGhpcyBpcyBtYXliZVxuICAgIC8vIHRvbyBsaWJlcmFsIGFuZCB3ZSBuZWVkIHRvIHdhaXQgc29tZSBhbW91bnQgb2YgdGltZSBhZnRlciBhbiBvZmZlciBiZWZvcmUgc2VuZGluZyBhbm90aGVyLFxuICAgIC8vIGJ1dCB3ZSBkb24ndCBjdXJyZW50bHkga25vdyBhbnkgZ29vZCB3YXkgb2YgZGV0ZWN0aW5nIGV4YWN0bHkgaG93IGxvbmcgOihcbiAgICBjb25uLmFkZEV2ZW50TGlzdGVuZXIoXG4gICAgICBcIm5lZ290aWF0aW9ubmVlZGVkXCIsXG4gICAgICBkZWJvdW5jZShldiA9PiB7XG4gICAgICAgIGRlYnVnKFwiU2VuZGluZyBuZXcgb2ZmZXIgZm9yIGhhbmRsZTogJW9cIiwgaGFuZGxlKTtcbiAgICAgICAgdmFyIG9mZmVyID0gY29ubi5jcmVhdGVPZmZlcigpLnRoZW4odGhpcy5jb25maWd1cmVQdWJsaXNoZXJTZHApLnRoZW4odGhpcy5maXhTYWZhcmlJY2VVRnJhZyk7XG4gICAgICAgIHZhciBsb2NhbCA9IG9mZmVyLnRoZW4obyA9PiBjb25uLnNldExvY2FsRGVzY3JpcHRpb24obykpO1xuICAgICAgICB2YXIgcmVtb3RlID0gb2ZmZXI7XG5cbiAgICAgICAgcmVtb3RlID0gcmVtb3RlXG4gICAgICAgICAgLnRoZW4odGhpcy5maXhTYWZhcmlJY2VVRnJhZylcbiAgICAgICAgICAudGhlbihqID0+IGhhbmRsZS5zZW5kSnNlcChqKSlcbiAgICAgICAgICAudGhlbihyID0+IGNvbm4uc2V0UmVtb3RlRGVzY3JpcHRpb24oci5qc2VwKSk7XG4gICAgICAgIHJldHVybiBQcm9taXNlLmFsbChbbG9jYWwsIHJlbW90ZV0pLmNhdGNoKGUgPT4gZXJyb3IoXCJFcnJvciBuZWdvdGlhdGluZyBvZmZlcjogJW9cIiwgZSkpO1xuICAgICAgfSlcbiAgICApO1xuICAgIGhhbmRsZS5vbihcbiAgICAgIFwiZXZlbnRcIixcbiAgICAgIGRlYm91bmNlKGV2ID0+IHtcbiAgICAgICAgdmFyIGpzZXAgPSBldi5qc2VwO1xuICAgICAgICBpZiAoanNlcCAmJiBqc2VwLnR5cGUgPT0gXCJvZmZlclwiKSB7XG4gICAgICAgICAgZGVidWcoXCJBY2NlcHRpbmcgbmV3IG9mZmVyIGZvciBoYW5kbGU6ICVvXCIsIGhhbmRsZSk7XG4gICAgICAgICAgdmFyIGFuc3dlciA9IGNvbm5cbiAgICAgICAgICAgIC5zZXRSZW1vdGVEZXNjcmlwdGlvbih0aGlzLmNvbmZpZ3VyZVN1YnNjcmliZXJTZHAoanNlcCkpXG4gICAgICAgICAgICAudGhlbihfID0+IGNvbm4uY3JlYXRlQW5zd2VyKCkpXG4gICAgICAgICAgICAudGhlbih0aGlzLmZpeFNhZmFyaUljZVVGcmFnKTtcbiAgICAgICAgICB2YXIgbG9jYWwgPSBhbnN3ZXIudGhlbihhID0+IGNvbm4uc2V0TG9jYWxEZXNjcmlwdGlvbihhKSk7XG4gICAgICAgICAgdmFyIHJlbW90ZSA9IGFuc3dlci50aGVuKGogPT4gaGFuZGxlLnNlbmRKc2VwKGopKTtcbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5hbGwoW2xvY2FsLCByZW1vdGVdKS5jYXRjaChlID0+IGVycm9yKFwiRXJyb3IgbmVnb3RpYXRpbmcgYW5zd2VyOiAlb1wiLCBlKSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gc29tZSBvdGhlciBraW5kIG9mIGV2ZW50LCBub3RoaW5nIHRvIGRvXG4gICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgKTtcbiAgfVxuXG4gIGFzeW5jIGNyZWF0ZVB1Ymxpc2hlcigpIHtcbiAgICB2YXIgaGFuZGxlID0gbmV3IG1qLkphbnVzUGx1Z2luSGFuZGxlKHRoaXMuc2Vzc2lvbik7XG4gICAgdmFyIGNvbm4gPSBuZXcgUlRDUGVlckNvbm5lY3Rpb24odGhpcy5wZWVyQ29ubmVjdGlvbkNvbmZpZyB8fCBERUZBVUxUX1BFRVJfQ09OTkVDVElPTl9DT05GSUcpO1xuXG4gICAgZGVidWcoXCJwdWIgd2FpdGluZyBmb3Igc2Z1XCIpO1xuICAgIGF3YWl0IGhhbmRsZS5hdHRhY2goXCJqYW51cy5wbHVnaW4uc2Z1XCIsIHRoaXMubG9vcHMgJiYgdGhpcy5jbGllbnRJZCA/IHBhcnNlSW50KHRoaXMuY2xpZW50SWQpICUgdGhpcy5sb29wcyA6IHVuZGVmaW5lZCk7XG5cbiAgICB0aGlzLmFzc29jaWF0ZShjb25uLCBoYW5kbGUpO1xuXG4gICAgZGVidWcoXCJwdWIgd2FpdGluZyBmb3IgZGF0YSBjaGFubmVscyAmIHdlYnJ0Y3VwXCIpO1xuICAgIHZhciB3ZWJydGN1cCA9IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gaGFuZGxlLm9uKFwid2VicnRjdXBcIiwgcmVzb2x2ZSkpO1xuXG4gICAgLy8gVW5yZWxpYWJsZSBkYXRhY2hhbm5lbDogc2VuZGluZyBhbmQgcmVjZWl2aW5nIGNvbXBvbmVudCB1cGRhdGVzLlxuICAgIC8vIFJlbGlhYmxlIGRhdGFjaGFubmVsOiBzZW5kaW5nIGFuZCByZWNpZXZpbmcgZW50aXR5IGluc3RhbnRpYXRpb25zLlxuICAgIHZhciByZWxpYWJsZUNoYW5uZWwgPSBjb25uLmNyZWF0ZURhdGFDaGFubmVsKFwicmVsaWFibGVcIiwgeyBvcmRlcmVkOiB0cnVlIH0pO1xuICAgIHZhciB1bnJlbGlhYmxlQ2hhbm5lbCA9IGNvbm4uY3JlYXRlRGF0YUNoYW5uZWwoXCJ1bnJlbGlhYmxlXCIsIHtcbiAgICAgIG9yZGVyZWQ6IGZhbHNlLFxuICAgICAgbWF4UmV0cmFuc21pdHM6IDBcbiAgICB9KTtcblxuICAgIHJlbGlhYmxlQ2hhbm5lbC5hZGRFdmVudExpc3RlbmVyKFwibWVzc2FnZVwiLCBlID0+IHRoaXMub25EYXRhQ2hhbm5lbE1lc3NhZ2UoZSwgXCJqYW51cy1yZWxpYWJsZVwiKSk7XG4gICAgdW5yZWxpYWJsZUNoYW5uZWwuYWRkRXZlbnRMaXN0ZW5lcihcIm1lc3NhZ2VcIiwgZSA9PiB0aGlzLm9uRGF0YUNoYW5uZWxNZXNzYWdlKGUsIFwiamFudXMtdW5yZWxpYWJsZVwiKSk7XG5cbiAgICBhd2FpdCB3ZWJydGN1cDtcbiAgICBhd2FpdCB1bnRpbERhdGFDaGFubmVsT3BlbihyZWxpYWJsZUNoYW5uZWwpO1xuICAgIGF3YWl0IHVudGlsRGF0YUNoYW5uZWxPcGVuKHVucmVsaWFibGVDaGFubmVsKTtcblxuICAgIC8vIGRvaW5nIHRoaXMgaGVyZSBpcyBzb3J0IG9mIGEgaGFjayBhcm91bmQgY2hyb21lIHJlbmVnb3RpYXRpb24gd2VpcmRuZXNzIC0tXG4gICAgLy8gaWYgd2UgZG8gaXQgcHJpb3IgdG8gd2VicnRjdXAsIGNocm9tZSBvbiBnZWFyIFZSIHdpbGwgc29tZXRpbWVzIHB1dCBhXG4gICAgLy8gcmVuZWdvdGlhdGlvbiBvZmZlciBpbiBmbGlnaHQgd2hpbGUgdGhlIGZpcnN0IG9mZmVyIHdhcyBzdGlsbCBiZWluZ1xuICAgIC8vIHByb2Nlc3NlZCBieSBqYW51cy4gd2Ugc2hvdWxkIGZpbmQgc29tZSBtb3JlIHByaW5jaXBsZWQgd2F5IHRvIGZpZ3VyZSBvdXRcbiAgICAvLyB3aGVuIGphbnVzIGlzIGRvbmUgaW4gdGhlIGZ1dHVyZS5cbiAgICBpZiAodGhpcy5sb2NhbE1lZGlhU3RyZWFtKSB7XG4gICAgICB0aGlzLmxvY2FsTWVkaWFTdHJlYW0uZ2V0VHJhY2tzKCkuZm9yRWFjaCh0cmFjayA9PiB7XG4gICAgICAgIGNvbm4uYWRkVHJhY2sodHJhY2ssIHRoaXMubG9jYWxNZWRpYVN0cmVhbSk7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBIYW5kbGUgYWxsIG9mIHRoZSBqb2luIGFuZCBsZWF2ZSBldmVudHMuXG4gICAgaGFuZGxlLm9uKFwiZXZlbnRcIiwgZXYgPT4ge1xuICAgICAgdmFyIGRhdGEgPSBldi5wbHVnaW5kYXRhLmRhdGE7XG4gICAgICBpZiAoZGF0YS5ldmVudCA9PSBcImpvaW5cIiAmJiBkYXRhLnJvb21faWQgPT0gdGhpcy5yb29tKSB7XG4gICAgICAgIGlmICh0aGlzLmRlbGF5ZWRSZWNvbm5lY3RUaW1lb3V0KSB7XG4gICAgICAgICAgLy8gRG9uJ3QgY3JlYXRlIGEgbmV3IFJUQ1BlZXJDb25uZWN0aW9uLCBhbGwgUlRDUGVlckNvbm5lY3Rpb24gd2lsbCBiZSBjbG9zZWQgaW4gbGVzcyB0aGFuIDEwcy5cbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5hZGRPY2N1cGFudChkYXRhLnVzZXJfaWQpO1xuICAgICAgfSBlbHNlIGlmIChkYXRhLmV2ZW50ID09IFwibGVhdmVcIiAmJiBkYXRhLnJvb21faWQgPT0gdGhpcy5yb29tKSB7XG4gICAgICAgIHRoaXMucmVtb3ZlT2NjdXBhbnQoZGF0YS51c2VyX2lkKTtcbiAgICAgIH0gZWxzZSBpZiAoZGF0YS5ldmVudCA9PSBcImJsb2NrZWRcIikge1xuICAgICAgICBkb2N1bWVudC5ib2R5LmRpc3BhdGNoRXZlbnQobmV3IEN1c3RvbUV2ZW50KFwiYmxvY2tlZFwiLCB7IGRldGFpbDogeyBjbGllbnRJZDogZGF0YS5ieSB9IH0pKTtcbiAgICAgIH0gZWxzZSBpZiAoZGF0YS5ldmVudCA9PSBcInVuYmxvY2tlZFwiKSB7XG4gICAgICAgIGRvY3VtZW50LmJvZHkuZGlzcGF0Y2hFdmVudChuZXcgQ3VzdG9tRXZlbnQoXCJ1bmJsb2NrZWRcIiwgeyBkZXRhaWw6IHsgY2xpZW50SWQ6IGRhdGEuYnkgfSB9KSk7XG4gICAgICB9IGVsc2UgaWYgKGRhdGEuZXZlbnQgPT09IFwiZGF0YVwiKSB7XG4gICAgICAgIHRoaXMub25EYXRhKEpTT04ucGFyc2UoZGF0YS5ib2R5KSwgXCJqYW51cy1ldmVudFwiKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGRlYnVnKFwicHViIHdhaXRpbmcgZm9yIGpvaW5cIik7XG5cbiAgICAvLyBTZW5kIGpvaW4gbWVzc2FnZSB0byBqYW51cy4gTGlzdGVuIGZvciBqb2luL2xlYXZlIG1lc3NhZ2VzLiBBdXRvbWF0aWNhbGx5IHN1YnNjcmliZSB0byBhbGwgdXNlcnMnIFdlYlJUQyBkYXRhLlxuICAgIHZhciBtZXNzYWdlID0gYXdhaXQgdGhpcy5zZW5kSm9pbihoYW5kbGUsIHtcbiAgICAgIG5vdGlmaWNhdGlvbnM6IHRydWUsXG4gICAgICBkYXRhOiB0cnVlXG4gICAgfSk7XG5cbiAgICBpZiAoIW1lc3NhZ2UucGx1Z2luZGF0YS5kYXRhLnN1Y2Nlc3MpIHtcbiAgICAgIGNvbnN0IGVyciA9IG1lc3NhZ2UucGx1Z2luZGF0YS5kYXRhLmVycm9yO1xuICAgICAgY29uc29sZS5lcnJvcihlcnIpO1xuICAgICAgLy8gV2UgbWF5IGdldCBoZXJlIGJlY2F1c2Ugb2YgYW4gZXhwaXJlZCBKV1QuXG4gICAgICAvLyBDbG9zZSB0aGUgY29ubmVjdGlvbiBvdXJzZWxmIG90aGVyd2lzZSBqYW51cyB3aWxsIGNsb3NlIGl0IGFmdGVyXG4gICAgICAvLyBzZXNzaW9uX3RpbWVvdXQgYmVjYXVzZSB3ZSBkaWRuJ3Qgc2VuZCBhbnkga2VlcGFsaXZlIGFuZCB0aGlzIHdpbGxcbiAgICAgIC8vIHRyaWdnZXIgYSBkZWxheWVkIHJlY29ubmVjdCBiZWNhdXNlIG9mIHRoZSBpY2Vjb25uZWN0aW9uc3RhdGVjaGFuZ2VcbiAgICAgIC8vIGxpc3RlbmVyIGZvciBmYWlsdXJlIHN0YXRlLlxuICAgICAgLy8gRXZlbiBpZiB0aGUgYXBwIGNvZGUgY2FsbHMgZGlzY29ubmVjdCBpbiBjYXNlIG9mIGVycm9yLCBkaXNjb25uZWN0XG4gICAgICAvLyB3b24ndCBjbG9zZSB0aGUgcGVlciBjb25uZWN0aW9uIGJlY2F1c2UgdGhpcy5wdWJsaXNoZXIgaXMgbm90IHNldC5cbiAgICAgIGNvbm4uY2xvc2UoKTtcbiAgICAgIHRocm93IGVycjtcbiAgICB9XG5cbiAgICB2YXIgaW5pdGlhbE9jY3VwYW50cyA9IG1lc3NhZ2UucGx1Z2luZGF0YS5kYXRhLnJlc3BvbnNlLnVzZXJzW3RoaXMucm9vbV0gfHwgW107XG5cbiAgICBpZiAoaW5pdGlhbE9jY3VwYW50cy5pbmNsdWRlcyh0aGlzLmNsaWVudElkKSkge1xuICAgICAgY29uc29sZS53YXJuKFwiSmFudXMgc3RpbGwgaGFzIHByZXZpb3VzIHNlc3Npb24gZm9yIHRoaXMgY2xpZW50LiBSZWNvbm5lY3RpbmcgaW4gMTBzLlwiKTtcbiAgICAgIHRoaXMucGVyZm9ybURlbGF5ZWRSZWNvbm5lY3QoKTtcbiAgICB9XG5cbiAgICBkZWJ1ZyhcInB1Ymxpc2hlciByZWFkeVwiKTtcbiAgICByZXR1cm4ge1xuICAgICAgaGFuZGxlLFxuICAgICAgaW5pdGlhbE9jY3VwYW50cyxcbiAgICAgIHJlbGlhYmxlQ2hhbm5lbCxcbiAgICAgIHVucmVsaWFibGVDaGFubmVsLFxuICAgICAgY29ublxuICAgIH07XG4gIH1cblxuICBjb25maWd1cmVQdWJsaXNoZXJTZHAoanNlcCkge1xuICAgIGpzZXAuc2RwID0ganNlcC5zZHAucmVwbGFjZSgvYT1mbXRwOigxMDl8MTExKS4qXFxyXFxuL2csIChsaW5lLCBwdCkgPT4ge1xuICAgICAgY29uc3QgcGFyYW1ldGVycyA9IE9iamVjdC5hc3NpZ24oc2RwVXRpbHMucGFyc2VGbXRwKGxpbmUpLCBPUFVTX1BBUkFNRVRFUlMpO1xuICAgICAgcmV0dXJuIHNkcFV0aWxzLndyaXRlRm10cCh7IHBheWxvYWRUeXBlOiBwdCwgcGFyYW1ldGVyczogcGFyYW1ldGVycyB9KTtcbiAgICB9KTtcbiAgICByZXR1cm4ganNlcDtcbiAgfVxuXG4gIGNvbmZpZ3VyZVN1YnNjcmliZXJTZHAoanNlcCkge1xuICAgIC8vIHRvZG86IGNvbnNpZGVyIGNsZWFuaW5nIHVwIHRoZXNlIGhhY2tzIHRvIHVzZSBzZHB1dGlsc1xuICAgIGlmICghaXNIMjY0VmlkZW9TdXBwb3J0ZWQpIHtcbiAgICAgIGlmIChuYXZpZ2F0b3IudXNlckFnZW50LmluZGV4T2YoXCJIZWFkbGVzc0Nocm9tZVwiKSAhPT0gLTEpIHtcbiAgICAgICAgLy8gSGVhZGxlc3NDaHJvbWUgKGUuZy4gcHVwcGV0ZWVyKSBkb2Vzbid0IHN1cHBvcnQgd2VicnRjIHZpZGVvIHN0cmVhbXMsIHNvIHdlIHJlbW92ZSB0aG9zZSBsaW5lcyBmcm9tIHRoZSBTRFAuXG4gICAgICAgIGpzZXAuc2RwID0ganNlcC5zZHAucmVwbGFjZSgvbT12aWRlb1teXSptPS8sIFwibT1cIik7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gVE9ETzogSGFjayB0byBnZXQgdmlkZW8gd29ya2luZyBvbiBDaHJvbWUgZm9yIEFuZHJvaWQuIGh0dHBzOi8vZ3JvdXBzLmdvb2dsZS5jb20vZm9ydW0vIyF0b3BpYy9tb3ppbGxhLmRldi5tZWRpYS9ZZTI5dnVNVHBvOFxuICAgIGlmIChuYXZpZ2F0b3IudXNlckFnZW50LmluZGV4T2YoXCJBbmRyb2lkXCIpID09PSAtMSkge1xuICAgICAganNlcC5zZHAgPSBqc2VwLnNkcC5yZXBsYWNlKFxuICAgICAgICBcImE9cnRjcC1mYjoxMDcgZ29vZy1yZW1iXFxyXFxuXCIsXG4gICAgICAgIFwiYT1ydGNwLWZiOjEwNyBnb29nLXJlbWJcXHJcXG5hPXJ0Y3AtZmI6MTA3IHRyYW5zcG9ydC1jY1xcclxcbmE9Zm10cDoxMDcgbGV2ZWwtYXN5bW1ldHJ5LWFsbG93ZWQ9MTtwYWNrZXRpemF0aW9uLW1vZGU9MTtwcm9maWxlLWxldmVsLWlkPTQyZTAxZlxcclxcblwiXG4gICAgICApO1xuICAgIH0gZWxzZSB7XG4gICAgICBqc2VwLnNkcCA9IGpzZXAuc2RwLnJlcGxhY2UoXG4gICAgICAgIFwiYT1ydGNwLWZiOjEwNyBnb29nLXJlbWJcXHJcXG5cIixcbiAgICAgICAgXCJhPXJ0Y3AtZmI6MTA3IGdvb2ctcmVtYlxcclxcbmE9cnRjcC1mYjoxMDcgdHJhbnNwb3J0LWNjXFxyXFxuYT1mbXRwOjEwNyBsZXZlbC1hc3ltbWV0cnktYWxsb3dlZD0xO3BhY2tldGl6YXRpb24tbW9kZT0xO3Byb2ZpbGUtbGV2ZWwtaWQ9NDIwMDFmXFxyXFxuXCJcbiAgICAgICk7XG4gICAgfVxuICAgIHJldHVybiBqc2VwO1xuICB9XG5cbiAgYXN5bmMgZml4U2FmYXJpSWNlVUZyYWcoanNlcCkge1xuICAgIC8vIFNhZmFyaSBwcm9kdWNlcyBhIFxcbiBpbnN0ZWFkIG9mIGFuIFxcclxcbiBmb3IgdGhlIGljZS11ZnJhZy4gU2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9tZWV0ZWNoby9qYW51cy1nYXRld2F5L2lzc3Vlcy8xODE4XG4gICAganNlcC5zZHAgPSBqc2VwLnNkcC5yZXBsYWNlKC9bXlxccl1cXG5hPWljZS11ZnJhZy9nLCBcIlxcclxcbmE9aWNlLXVmcmFnXCIpO1xuICAgIHJldHVybiBqc2VwXG4gIH1cblxuICBhc3luYyBjcmVhdGVTdWJzY3JpYmVyKG9jY3VwYW50SWQsIG1heFJldHJpZXMgPSA1KSB7XG4gICAgaWYgKHRoaXMubGVmdE9jY3VwYW50cy5oYXMob2NjdXBhbnRJZCkpIHtcbiAgICAgIGNvbnNvbGUud2FybihvY2N1cGFudElkICsgXCI6IGNhbmNlbGxlZCBvY2N1cGFudCBjb25uZWN0aW9uLCBvY2N1cGFudCBsZWZ0IGJlZm9yZSBzdWJzY3JpcHRpb24gbmVnb3RhdGlvbi5cIik7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICB2YXIgaGFuZGxlID0gbmV3IG1qLkphbnVzUGx1Z2luSGFuZGxlKHRoaXMuc2Vzc2lvbik7XG4gICAgdmFyIGNvbm4gPSBuZXcgUlRDUGVlckNvbm5lY3Rpb24odGhpcy5wZWVyQ29ubmVjdGlvbkNvbmZpZyB8fCBERUZBVUxUX1BFRVJfQ09OTkVDVElPTl9DT05GSUcpO1xuXG4gICAgZGVidWcob2NjdXBhbnRJZCArIFwiOiBzdWIgd2FpdGluZyBmb3Igc2Z1XCIpO1xuICAgIGF3YWl0IGhhbmRsZS5hdHRhY2goXCJqYW51cy5wbHVnaW4uc2Z1XCIsIHRoaXMubG9vcHMgPyBwYXJzZUludChvY2N1cGFudElkKSAlIHRoaXMubG9vcHMgOiB1bmRlZmluZWQpO1xuXG4gICAgdGhpcy5hc3NvY2lhdGUoY29ubiwgaGFuZGxlKTtcblxuICAgIGRlYnVnKG9jY3VwYW50SWQgKyBcIjogc3ViIHdhaXRpbmcgZm9yIGpvaW5cIik7XG5cbiAgICBpZiAodGhpcy5sZWZ0T2NjdXBhbnRzLmhhcyhvY2N1cGFudElkKSkge1xuICAgICAgY29ubi5jbG9zZSgpO1xuICAgICAgY29uc29sZS53YXJuKG9jY3VwYW50SWQgKyBcIjogY2FuY2VsbGVkIG9jY3VwYW50IGNvbm5lY3Rpb24sIG9jY3VwYW50IGxlZnQgYWZ0ZXIgYXR0YWNoXCIpO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgbGV0IHdlYnJ0Y0ZhaWxlZCA9IGZhbHNlO1xuXG4gICAgY29uc3Qgd2VicnRjdXAgPSBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHtcbiAgICAgIGNvbnN0IGxlZnRJbnRlcnZhbCA9IHNldEludGVydmFsKCgpID0+IHtcbiAgICAgICAgaWYgKHRoaXMubGVmdE9jY3VwYW50cy5oYXMob2NjdXBhbnRJZCkpIHtcbiAgICAgICAgICBjbGVhckludGVydmFsKGxlZnRJbnRlcnZhbCk7XG4gICAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgICB9XG4gICAgICB9LCAxMDAwKTtcblxuICAgICAgY29uc3QgdGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICBjbGVhckludGVydmFsKGxlZnRJbnRlcnZhbCk7XG4gICAgICAgIHdlYnJ0Y0ZhaWxlZCA9IHRydWU7XG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH0sIFNVQlNDUklCRV9USU1FT1VUX01TKTtcblxuICAgICAgaGFuZGxlLm9uKFwid2VicnRjdXBcIiwgKCkgPT4ge1xuICAgICAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XG4gICAgICAgIGNsZWFySW50ZXJ2YWwobGVmdEludGVydmFsKTtcbiAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICAvLyBTZW5kIGpvaW4gbWVzc2FnZSB0byBqYW51cy4gRG9uJ3QgbGlzdGVuIGZvciBqb2luL2xlYXZlIG1lc3NhZ2VzLiBTdWJzY3JpYmUgdG8gdGhlIG9jY3VwYW50J3MgbWVkaWEuXG4gICAgLy8gSmFudXMgc2hvdWxkIHNlbmQgdXMgYW4gb2ZmZXIgZm9yIHRoaXMgb2NjdXBhbnQncyBtZWRpYSBpbiByZXNwb25zZSB0byB0aGlzLlxuICAgIGF3YWl0IHRoaXMuc2VuZEpvaW4oaGFuZGxlLCB7IG1lZGlhOiBvY2N1cGFudElkIH0pO1xuXG4gICAgaWYgKHRoaXMubGVmdE9jY3VwYW50cy5oYXMob2NjdXBhbnRJZCkpIHtcbiAgICAgIGNvbm4uY2xvc2UoKTtcbiAgICAgIGNvbnNvbGUud2FybihvY2N1cGFudElkICsgXCI6IGNhbmNlbGxlZCBvY2N1cGFudCBjb25uZWN0aW9uLCBvY2N1cGFudCBsZWZ0IGFmdGVyIGpvaW5cIik7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBkZWJ1ZyhvY2N1cGFudElkICsgXCI6IHN1YiB3YWl0aW5nIGZvciB3ZWJydGN1cFwiKTtcbiAgICBhd2FpdCB3ZWJydGN1cDtcblxuICAgIGlmICh0aGlzLmxlZnRPY2N1cGFudHMuaGFzKG9jY3VwYW50SWQpKSB7XG4gICAgICBjb25uLmNsb3NlKCk7XG4gICAgICBjb25zb2xlLndhcm4ob2NjdXBhbnRJZCArIFwiOiBjYW5jZWwgb2NjdXBhbnQgY29ubmVjdGlvbiwgb2NjdXBhbnQgbGVmdCBkdXJpbmcgb3IgYWZ0ZXIgd2VicnRjdXBcIik7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBpZiAod2VicnRjRmFpbGVkKSB7XG4gICAgICBjb25uLmNsb3NlKCk7XG4gICAgICBpZiAobWF4UmV0cmllcyA+IDApIHtcbiAgICAgICAgY29uc29sZS53YXJuKG9jY3VwYW50SWQgKyBcIjogd2VicnRjIHVwIHRpbWVkIG91dCwgcmV0cnlpbmdcIik7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVN1YnNjcmliZXIob2NjdXBhbnRJZCwgbWF4UmV0cmllcyAtIDEpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc29sZS53YXJuKG9jY3VwYW50SWQgKyBcIjogd2VicnRjIHVwIHRpbWVkIG91dFwiKTtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGlzU2FmYXJpICYmICF0aGlzLl9pT1NIYWNrRGVsYXllZEluaXRpYWxQZWVyKSB7XG4gICAgICAvLyBIQUNLOiB0aGUgZmlyc3QgcGVlciBvbiBTYWZhcmkgZHVyaW5nIHBhZ2UgbG9hZCBjYW4gZmFpbCB0byB3b3JrIGlmIHdlIGRvbid0XG4gICAgICAvLyB3YWl0IHNvbWUgdGltZSBiZWZvcmUgY29udGludWluZyBoZXJlLiBTZWU6IGh0dHBzOi8vZ2l0aHViLmNvbS9tb3ppbGxhL2h1YnMvcHVsbC8xNjkyXG4gICAgICBhd2FpdCAobmV3IFByb21pc2UoKHJlc29sdmUpID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMzAwMCkpKTtcbiAgICAgIHRoaXMuX2lPU0hhY2tEZWxheWVkSW5pdGlhbFBlZXIgPSB0cnVlO1xuICAgIH1cblxuICAgIHZhciBtZWRpYVN0cmVhbSA9IG5ldyBNZWRpYVN0cmVhbSgpO1xuICAgIHZhciByZWNlaXZlcnMgPSBjb25uLmdldFJlY2VpdmVycygpO1xuICAgIHJlY2VpdmVycy5mb3JFYWNoKHJlY2VpdmVyID0+IHtcbiAgICAgIGlmIChyZWNlaXZlci50cmFjaykge1xuICAgICAgICBtZWRpYVN0cmVhbS5hZGRUcmFjayhyZWNlaXZlci50cmFjayk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgaWYgKG1lZGlhU3RyZWFtLmdldFRyYWNrcygpLmxlbmd0aCA9PT0gMCkge1xuICAgICAgbWVkaWFTdHJlYW0gPSBudWxsO1xuICAgIH1cblxuICAgIGRlYnVnKG9jY3VwYW50SWQgKyBcIjogc3Vic2NyaWJlciByZWFkeVwiKTtcbiAgICByZXR1cm4ge1xuICAgICAgaGFuZGxlLFxuICAgICAgbWVkaWFTdHJlYW0sXG4gICAgICBjb25uXG4gICAgfTtcbiAgfVxuXG4gIHNlbmRKb2luKGhhbmRsZSwgc3Vic2NyaWJlKSB7XG4gICAgcmV0dXJuIGhhbmRsZS5zZW5kTWVzc2FnZSh7XG4gICAgICBraW5kOiBcImpvaW5cIixcbiAgICAgIHJvb21faWQ6IHRoaXMucm9vbSxcbiAgICAgIHVzZXJfaWQ6IHRoaXMuY2xpZW50SWQsXG4gICAgICBzdWJzY3JpYmUsXG4gICAgICB0b2tlbjogdGhpcy5qb2luVG9rZW5cbiAgICB9KTtcbiAgfVxuXG4gIHRvZ2dsZUZyZWV6ZSgpIHtcbiAgICBpZiAodGhpcy5mcm96ZW4pIHtcbiAgICAgIHRoaXMudW5mcmVlemUoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5mcmVlemUoKTtcbiAgICB9XG4gIH1cblxuICBmcmVlemUoKSB7XG4gICAgdGhpcy5mcm96ZW4gPSB0cnVlO1xuICB9XG5cbiAgdW5mcmVlemUoKSB7XG4gICAgdGhpcy5mcm96ZW4gPSBmYWxzZTtcbiAgICB0aGlzLmZsdXNoUGVuZGluZ1VwZGF0ZXMoKTtcbiAgfVxuXG4gIGRhdGFGb3JVcGRhdGVNdWx0aU1lc3NhZ2UobmV0d29ya0lkLCBtZXNzYWdlKSB7XG4gICAgLy8gXCJkXCIgaXMgYW4gYXJyYXkgb2YgZW50aXR5IGRhdGFzLCB3aGVyZSBlYWNoIGl0ZW0gaW4gdGhlIGFycmF5IHJlcHJlc2VudHMgYSB1bmlxdWUgZW50aXR5IGFuZCBjb250YWluc1xuICAgIC8vIG1ldGFkYXRhIGZvciB0aGUgZW50aXR5LCBhbmQgYW4gYXJyYXkgb2YgY29tcG9uZW50cyB0aGF0IGhhdmUgYmVlbiB1cGRhdGVkIG9uIHRoZSBlbnRpdHkuXG4gICAgLy8gVGhpcyBtZXRob2QgZmluZHMgdGhlIGRhdGEgY29ycmVzcG9uZGluZyB0byB0aGUgZ2l2ZW4gbmV0d29ya0lkLlxuICAgIGZvciAobGV0IGkgPSAwLCBsID0gbWVzc2FnZS5kYXRhLmQubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICBjb25zdCBkYXRhID0gbWVzc2FnZS5kYXRhLmRbaV07XG5cbiAgICAgIGlmIChkYXRhLm5ldHdvcmtJZCA9PT0gbmV0d29ya0lkKSB7XG4gICAgICAgIHJldHVybiBkYXRhO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgZ2V0UGVuZGluZ0RhdGEobmV0d29ya0lkLCBtZXNzYWdlKSB7XG4gICAgaWYgKCFtZXNzYWdlKSByZXR1cm4gbnVsbDtcblxuICAgIGxldCBkYXRhID0gbWVzc2FnZS5kYXRhVHlwZSA9PT0gXCJ1bVwiID8gdGhpcy5kYXRhRm9yVXBkYXRlTXVsdGlNZXNzYWdlKG5ldHdvcmtJZCwgbWVzc2FnZSkgOiBtZXNzYWdlLmRhdGE7XG5cbiAgICAvLyBJZ25vcmUgbWVzc2FnZXMgcmVsYXRpbmcgdG8gdXNlcnMgd2hvIGhhdmUgZGlzY29ubmVjdGVkIHNpbmNlIGZyZWV6aW5nLCB0aGVpciBlbnRpdGllc1xuICAgIC8vIHdpbGwgaGF2ZSBhbGVhZHkgYmVlbiByZW1vdmVkIGJ5IE5BRi5cbiAgICAvLyBOb3RlIHRoYXQgZGVsZXRlIG1lc3NhZ2VzIGhhdmUgbm8gXCJvd25lclwiIHNvIHdlIGhhdmUgdG8gY2hlY2sgZm9yIHRoYXQgYXMgd2VsbC5cbiAgICBpZiAoZGF0YS5vd25lciAmJiAhdGhpcy5vY2N1cGFudHNbZGF0YS5vd25lcl0pIHJldHVybiBudWxsO1xuXG4gICAgLy8gSWdub3JlIG1lc3NhZ2VzIGZyb20gdXNlcnMgdGhhdCB3ZSBtYXkgaGF2ZSBibG9ja2VkIHdoaWxlIGZyb3plbi5cbiAgICBpZiAoZGF0YS5vd25lciAmJiB0aGlzLmJsb2NrZWRDbGllbnRzLmhhcyhkYXRhLm93bmVyKSkgcmV0dXJuIG51bGw7XG5cbiAgICByZXR1cm4gZGF0YVxuICB9XG5cbiAgLy8gVXNlZCBleHRlcm5hbGx5XG4gIGdldFBlbmRpbmdEYXRhRm9yTmV0d29ya0lkKG5ldHdvcmtJZCkge1xuICAgIHJldHVybiB0aGlzLmdldFBlbmRpbmdEYXRhKG5ldHdvcmtJZCwgdGhpcy5mcm96ZW5VcGRhdGVzLmdldChuZXR3b3JrSWQpKTtcbiAgfVxuXG4gIGZsdXNoUGVuZGluZ1VwZGF0ZXMoKSB7XG4gICAgZm9yIChjb25zdCBbbmV0d29ya0lkLCBtZXNzYWdlXSBvZiB0aGlzLmZyb3plblVwZGF0ZXMpIHtcbiAgICAgIGxldCBkYXRhID0gdGhpcy5nZXRQZW5kaW5nRGF0YShuZXR3b3JrSWQsIG1lc3NhZ2UpO1xuICAgICAgaWYgKCFkYXRhKSBjb250aW51ZTtcblxuICAgICAgLy8gT3ZlcnJpZGUgdGhlIGRhdGEgdHlwZSBvbiBcInVtXCIgbWVzc2FnZXMgdHlwZXMsIHNpbmNlIHdlIGV4dHJhY3QgZW50aXR5IHVwZGF0ZXMgZnJvbSBcInVtXCIgbWVzc2FnZXMgaW50b1xuICAgICAgLy8gaW5kaXZpZHVhbCBmcm96ZW5VcGRhdGVzIGluIHN0b3JlU2luZ2xlTWVzc2FnZS5cbiAgICAgIGNvbnN0IGRhdGFUeXBlID0gbWVzc2FnZS5kYXRhVHlwZSA9PT0gXCJ1bVwiID8gXCJ1XCIgOiBtZXNzYWdlLmRhdGFUeXBlO1xuXG4gICAgICB0aGlzLm9uT2NjdXBhbnRNZXNzYWdlKG51bGwsIGRhdGFUeXBlLCBkYXRhLCBtZXNzYWdlLnNvdXJjZSk7XG4gICAgfVxuICAgIHRoaXMuZnJvemVuVXBkYXRlcy5jbGVhcigpO1xuICB9XG5cbiAgc3RvcmVNZXNzYWdlKG1lc3NhZ2UpIHtcbiAgICBpZiAobWVzc2FnZS5kYXRhVHlwZSA9PT0gXCJ1bVwiKSB7IC8vIFVwZGF0ZU11bHRpXG4gICAgICBmb3IgKGxldCBpID0gMCwgbCA9IG1lc3NhZ2UuZGF0YS5kLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgICB0aGlzLnN0b3JlU2luZ2xlTWVzc2FnZShtZXNzYWdlLCBpKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5zdG9yZVNpbmdsZU1lc3NhZ2UobWVzc2FnZSk7XG4gICAgfVxuICB9XG5cbiAgc3RvcmVTaW5nbGVNZXNzYWdlKG1lc3NhZ2UsIGluZGV4KSB7XG4gICAgY29uc3QgZGF0YSA9IGluZGV4ICE9PSB1bmRlZmluZWQgPyBtZXNzYWdlLmRhdGEuZFtpbmRleF0gOiBtZXNzYWdlLmRhdGE7XG4gICAgY29uc3QgZGF0YVR5cGUgPSBtZXNzYWdlLmRhdGFUeXBlO1xuICAgIGNvbnN0IHNvdXJjZSA9IG1lc3NhZ2Uuc291cmNlO1xuXG4gICAgY29uc3QgbmV0d29ya0lkID0gZGF0YS5uZXR3b3JrSWQ7XG5cbiAgICBpZiAoIXRoaXMuZnJvemVuVXBkYXRlcy5oYXMobmV0d29ya0lkKSkge1xuICAgICAgdGhpcy5mcm96ZW5VcGRhdGVzLnNldChuZXR3b3JrSWQsIG1lc3NhZ2UpO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBzdG9yZWRNZXNzYWdlID0gdGhpcy5mcm96ZW5VcGRhdGVzLmdldChuZXR3b3JrSWQpO1xuICAgICAgY29uc3Qgc3RvcmVkRGF0YSA9IHN0b3JlZE1lc3NhZ2UuZGF0YVR5cGUgPT09IFwidW1cIiA/IHRoaXMuZGF0YUZvclVwZGF0ZU11bHRpTWVzc2FnZShuZXR3b3JrSWQsIHN0b3JlZE1lc3NhZ2UpIDogc3RvcmVkTWVzc2FnZS5kYXRhO1xuXG4gICAgICAvLyBBdm9pZCB1cGRhdGluZyBjb21wb25lbnRzIGlmIHRoZSBlbnRpdHkgZGF0YSByZWNlaXZlZCBkaWQgbm90IGNvbWUgZnJvbSB0aGUgY3VycmVudCBvd25lci5cbiAgICAgIGNvbnN0IGlzT3V0ZGF0ZWRNZXNzYWdlID0gZGF0YS5sYXN0T3duZXJUaW1lIDwgc3RvcmVkRGF0YS5sYXN0T3duZXJUaW1lO1xuICAgICAgY29uc3QgaXNDb250ZW1wb3JhbmVvdXNNZXNzYWdlID0gZGF0YS5sYXN0T3duZXJUaW1lID09PSBzdG9yZWREYXRhLmxhc3RPd25lclRpbWU7XG4gICAgICBpZiAoaXNPdXRkYXRlZE1lc3NhZ2UgfHwgKGlzQ29udGVtcG9yYW5lb3VzTWVzc2FnZSAmJiBzdG9yZWREYXRhLm93bmVyID4gZGF0YS5vd25lcikpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAoZGF0YVR5cGUgPT09IFwiclwiKSB7XG4gICAgICAgIGNvbnN0IGNyZWF0ZWRXaGlsZUZyb3plbiA9IHN0b3JlZERhdGEgJiYgc3RvcmVkRGF0YS5pc0ZpcnN0U3luYztcbiAgICAgICAgaWYgKGNyZWF0ZWRXaGlsZUZyb3plbikge1xuICAgICAgICAgIC8vIElmIHRoZSBlbnRpdHkgd2FzIGNyZWF0ZWQgYW5kIGRlbGV0ZWQgd2hpbGUgZnJvemVuLCBkb24ndCBib3RoZXIgY29udmV5aW5nIGFueXRoaW5nIHRvIHRoZSBjb25zdW1lci5cbiAgICAgICAgICB0aGlzLmZyb3plblVwZGF0ZXMuZGVsZXRlKG5ldHdvcmtJZCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gRGVsZXRlIG1lc3NhZ2VzIG92ZXJyaWRlIGFueSBvdGhlciBtZXNzYWdlcyBmb3IgdGhpcyBlbnRpdHlcbiAgICAgICAgICB0aGlzLmZyb3plblVwZGF0ZXMuc2V0KG5ldHdvcmtJZCwgbWVzc2FnZSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIG1lcmdlIGluIGNvbXBvbmVudCB1cGRhdGVzXG4gICAgICAgIGlmIChzdG9yZWREYXRhLmNvbXBvbmVudHMgJiYgZGF0YS5jb21wb25lbnRzKSB7XG4gICAgICAgICAgT2JqZWN0LmFzc2lnbihzdG9yZWREYXRhLmNvbXBvbmVudHMsIGRhdGEuY29tcG9uZW50cyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBvbkRhdGFDaGFubmVsTWVzc2FnZShlLCBzb3VyY2UpIHtcbiAgICB0aGlzLm9uRGF0YShKU09OLnBhcnNlKGUuZGF0YSksIHNvdXJjZSk7XG4gIH1cblxuICBvbkRhdGEobWVzc2FnZSwgc291cmNlKSB7XG4gICAgaWYgKGRlYnVnLmVuYWJsZWQpIHtcbiAgICAgIGRlYnVnKGBEQyBpbjogJHttZXNzYWdlfWApO1xuICAgIH1cblxuICAgIGlmICghbWVzc2FnZS5kYXRhVHlwZSkgcmV0dXJuO1xuXG4gICAgbWVzc2FnZS5zb3VyY2UgPSBzb3VyY2U7XG5cbiAgICBpZiAodGhpcy5mcm96ZW4pIHtcbiAgICAgIHRoaXMuc3RvcmVNZXNzYWdlKG1lc3NhZ2UpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLm9uT2NjdXBhbnRNZXNzYWdlKG51bGwsIG1lc3NhZ2UuZGF0YVR5cGUsIG1lc3NhZ2UuZGF0YSwgbWVzc2FnZS5zb3VyY2UpO1xuICAgIH1cbiAgfVxuXG4gIHNob3VsZFN0YXJ0Q29ubmVjdGlvblRvKGNsaWVudCkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgc3RhcnRTdHJlYW1Db25uZWN0aW9uKGNsaWVudCkge31cblxuICBjbG9zZVN0cmVhbUNvbm5lY3Rpb24oY2xpZW50KSB7fVxuXG4gIGdldENvbm5lY3RTdGF0dXMoY2xpZW50SWQpIHtcbiAgICByZXR1cm4gdGhpcy5vY2N1cGFudHNbY2xpZW50SWRdID8gTkFGLmFkYXB0ZXJzLklTX0NPTk5FQ1RFRCA6IE5BRi5hZGFwdGVycy5OT1RfQ09OTkVDVEVEO1xuICB9XG5cbiAgYXN5bmMgdXBkYXRlVGltZU9mZnNldCgpIHtcbiAgICBpZiAodGhpcy5pc0Rpc2Nvbm5lY3RlZCgpKSByZXR1cm47XG5cbiAgICBjb25zdCBjbGllbnRTZW50VGltZSA9IERhdGUubm93KCk7XG5cbiAgICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaChkb2N1bWVudC5sb2NhdGlvbi5ocmVmLCB7XG4gICAgICBtZXRob2Q6IFwiSEVBRFwiLFxuICAgICAgY2FjaGU6IFwibm8tY2FjaGVcIlxuICAgIH0pO1xuXG4gICAgY29uc3QgcHJlY2lzaW9uID0gMTAwMDtcbiAgICBjb25zdCBzZXJ2ZXJSZWNlaXZlZFRpbWUgPSBuZXcgRGF0ZShyZXMuaGVhZGVycy5nZXQoXCJEYXRlXCIpKS5nZXRUaW1lKCkgKyBwcmVjaXNpb24gLyAyO1xuICAgIGNvbnN0IGNsaWVudFJlY2VpdmVkVGltZSA9IERhdGUubm93KCk7XG4gICAgY29uc3Qgc2VydmVyVGltZSA9IHNlcnZlclJlY2VpdmVkVGltZSArIChjbGllbnRSZWNlaXZlZFRpbWUgLSBjbGllbnRTZW50VGltZSkgLyAyO1xuICAgIGNvbnN0IHRpbWVPZmZzZXQgPSBzZXJ2ZXJUaW1lIC0gY2xpZW50UmVjZWl2ZWRUaW1lO1xuXG4gICAgdGhpcy5zZXJ2ZXJUaW1lUmVxdWVzdHMrKztcblxuICAgIGlmICh0aGlzLnNlcnZlclRpbWVSZXF1ZXN0cyA8PSAxMCkge1xuICAgICAgdGhpcy50aW1lT2Zmc2V0cy5wdXNoKHRpbWVPZmZzZXQpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnRpbWVPZmZzZXRzW3RoaXMuc2VydmVyVGltZVJlcXVlc3RzICUgMTBdID0gdGltZU9mZnNldDtcbiAgICB9XG5cbiAgICB0aGlzLmF2Z1RpbWVPZmZzZXQgPSB0aGlzLnRpbWVPZmZzZXRzLnJlZHVjZSgoYWNjLCBvZmZzZXQpID0+IChhY2MgKz0gb2Zmc2V0KSwgMCkgLyB0aGlzLnRpbWVPZmZzZXRzLmxlbmd0aDtcblxuICAgIGlmICh0aGlzLnNlcnZlclRpbWVSZXF1ZXN0cyA+IDEwKSB7XG4gICAgICBkZWJ1ZyhgbmV3IHNlcnZlciB0aW1lIG9mZnNldDogJHt0aGlzLmF2Z1RpbWVPZmZzZXR9bXNgKTtcbiAgICAgIHNldFRpbWVvdXQoKCkgPT4gdGhpcy51cGRhdGVUaW1lT2Zmc2V0KCksIDUgKiA2MCAqIDEwMDApOyAvLyBTeW5jIGNsb2NrIGV2ZXJ5IDUgbWludXRlcy5cbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy51cGRhdGVUaW1lT2Zmc2V0KCk7XG4gICAgfVxuICB9XG5cbiAgZ2V0U2VydmVyVGltZSgpIHtcbiAgICByZXR1cm4gRGF0ZS5ub3coKSArIHRoaXMuYXZnVGltZU9mZnNldDtcbiAgfVxuXG4gIGdldE1lZGlhU3RyZWFtKGNsaWVudElkLCB0eXBlID0gXCJhdWRpb1wiKSB7XG4gICAgaWYgKHRoaXMubWVkaWFTdHJlYW1zW2NsaWVudElkXSkge1xuICAgICAgZGVidWcoYEFscmVhZHkgaGFkICR7dHlwZX0gZm9yICR7Y2xpZW50SWR9YCk7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHRoaXMubWVkaWFTdHJlYW1zW2NsaWVudElkXVt0eXBlXSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGRlYnVnKGBXYWl0aW5nIG9uICR7dHlwZX0gZm9yICR7Y2xpZW50SWR9YCk7XG4gICAgICBpZiAoIXRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuaGFzKGNsaWVudElkKSkge1xuICAgICAgICB0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLnNldChjbGllbnRJZCwge30pO1xuXG4gICAgICAgIGNvbnN0IGF1ZGlvUHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgICB0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmdldChjbGllbnRJZCkuYXVkaW8gPSB7IHJlc29sdmUsIHJlamVjdCB9O1xuICAgICAgICB9KTtcbiAgICAgICAgY29uc3QgdmlkZW9Qcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICAgIHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuZ2V0KGNsaWVudElkKS52aWRlbyA9IHsgcmVzb2x2ZSwgcmVqZWN0IH07XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuZ2V0KGNsaWVudElkKS5hdWRpby5wcm9taXNlID0gYXVkaW9Qcm9taXNlO1xuICAgICAgICB0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmdldChjbGllbnRJZCkudmlkZW8ucHJvbWlzZSA9IHZpZGVvUHJvbWlzZTtcblxuICAgICAgICBhdWRpb1Byb21pc2UuY2F0Y2goZSA9PiBjb25zb2xlLndhcm4oYCR7Y2xpZW50SWR9IGdldE1lZGlhU3RyZWFtIEF1ZGlvIEVycm9yYCwgZSkpO1xuICAgICAgICB2aWRlb1Byb21pc2UuY2F0Y2goZSA9PiBjb25zb2xlLndhcm4oYCR7Y2xpZW50SWR9IGdldE1lZGlhU3RyZWFtIFZpZGVvIEVycm9yYCwgZSkpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuZ2V0KGNsaWVudElkKVt0eXBlXS5wcm9taXNlO1xuICAgIH1cbiAgfVxuXG4gIHNldE1lZGlhU3RyZWFtKGNsaWVudElkLCBzdHJlYW0pIHtcbiAgICAvLyBTYWZhcmkgZG9lc24ndCBsaWtlIGl0IHdoZW4geW91IHVzZSBzaW5nbGUgYSBtaXhlZCBtZWRpYSBzdHJlYW0gd2hlcmUgb25lIG9mIHRoZSB0cmFja3MgaXMgaW5hY3RpdmUsIHNvIHdlXG4gICAgLy8gc3BsaXQgdGhlIHRyYWNrcyBpbnRvIHR3byBzdHJlYW1zLlxuICAgIGNvbnN0IGF1ZGlvU3RyZWFtID0gbmV3IE1lZGlhU3RyZWFtKCk7XG4gICAgdHJ5IHtcbiAgICBzdHJlYW0uZ2V0QXVkaW9UcmFja3MoKS5mb3JFYWNoKHRyYWNrID0+IGF1ZGlvU3RyZWFtLmFkZFRyYWNrKHRyYWNrKSk7XG5cbiAgICB9IGNhdGNoKGUpIHtcbiAgICAgIGNvbnNvbGUud2FybihgJHtjbGllbnRJZH0gc2V0TWVkaWFTdHJlYW0gQXVkaW8gRXJyb3JgLCBlKTtcbiAgICB9XG4gICAgY29uc3QgdmlkZW9TdHJlYW0gPSBuZXcgTWVkaWFTdHJlYW0oKTtcbiAgICB0cnkge1xuICAgIHN0cmVhbS5nZXRWaWRlb1RyYWNrcygpLmZvckVhY2godHJhY2sgPT4gdmlkZW9TdHJlYW0uYWRkVHJhY2sodHJhY2spKTtcblxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGNvbnNvbGUud2FybihgJHtjbGllbnRJZH0gc2V0TWVkaWFTdHJlYW0gVmlkZW8gRXJyb3JgLCBlKTtcbiAgICB9XG5cbiAgICB0aGlzLm1lZGlhU3RyZWFtc1tjbGllbnRJZF0gPSB7IGF1ZGlvOiBhdWRpb1N0cmVhbSwgdmlkZW86IHZpZGVvU3RyZWFtIH07XG5cbiAgICAvLyBSZXNvbHZlIHRoZSBwcm9taXNlIGZvciB0aGUgdXNlcidzIG1lZGlhIHN0cmVhbSBpZiBpdCBleGlzdHMuXG4gICAgaWYgKHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuaGFzKGNsaWVudElkKSkge1xuICAgICAgdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5nZXQoY2xpZW50SWQpLmF1ZGlvLnJlc29sdmUoYXVkaW9TdHJlYW0pO1xuICAgICAgdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5nZXQoY2xpZW50SWQpLnZpZGVvLnJlc29sdmUodmlkZW9TdHJlYW0pO1xuICAgIH1cbiAgfVxuXG4gIGdldExvY2FsTWVkaWFTdHJlYW0oKSB7XG4gICAgcmV0dXJuIHRoaXMubG9jYWxNZWRpYVN0cmVhbTtcbiAgfVxuXG4gIGFzeW5jIHNldExvY2FsTWVkaWFTdHJlYW0oc3RyZWFtKSB7XG4gICAgLy8gb3VyIGpvYiBoZXJlIGlzIHRvIG1ha2Ugc3VyZSB0aGUgY29ubmVjdGlvbiB3aW5kcyB1cCB3aXRoIFJUUCBzZW5kZXJzIHNlbmRpbmcgdGhlIHN0dWZmIGluIHRoaXMgc3RyZWFtLFxuICAgIC8vIGFuZCBub3QgdGhlIHN0dWZmIHRoYXQgaXNuJ3QgaW4gdGhpcyBzdHJlYW0uIHN0cmF0ZWd5IGlzIHRvIHJlcGxhY2UgZXhpc3RpbmcgdHJhY2tzIGlmIHdlIGNhbiwgYWRkIHRyYWNrc1xuICAgIC8vIHRoYXQgd2UgY2FuJ3QgcmVwbGFjZSwgYW5kIGRpc2FibGUgdHJhY2tzIHRoYXQgZG9uJ3QgZXhpc3QgYW55bW9yZS5cblxuICAgIC8vIG5vdGUgdGhhdCB3ZSBkb24ndCBldmVyIHJlbW92ZSBhIHRyYWNrIGZyb20gdGhlIHN0cmVhbSAtLSBzaW5jZSBKYW51cyBkb2Vzbid0IHN1cHBvcnQgVW5pZmllZCBQbGFuLCB3ZSBhYnNvbHV0ZWx5XG4gICAgLy8gY2FuJ3Qgd2luZCB1cCB3aXRoIGEgU0RQIHRoYXQgaGFzID4xIGF1ZGlvIG9yID4xIHZpZGVvIHRyYWNrcywgZXZlbiBpZiBvbmUgb2YgdGhlbSBpcyBpbmFjdGl2ZSAod2hhdCB5b3UgZ2V0IGlmXG4gICAgLy8geW91IHJlbW92ZSBhIHRyYWNrIGZyb20gYW4gZXhpc3Rpbmcgc3RyZWFtLilcbiAgICBpZiAodGhpcy5wdWJsaXNoZXIgJiYgdGhpcy5wdWJsaXNoZXIuY29ubikge1xuICAgICAgY29uc3QgZXhpc3RpbmdTZW5kZXJzID0gdGhpcy5wdWJsaXNoZXIuY29ubi5nZXRTZW5kZXJzKCk7XG4gICAgICBjb25zdCBuZXdTZW5kZXJzID0gW107XG4gICAgICBjb25zdCB0cmFja3MgPSBzdHJlYW0uZ2V0VHJhY2tzKCk7XG5cbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdHJhY2tzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGNvbnN0IHQgPSB0cmFja3NbaV07XG4gICAgICAgIGNvbnN0IHNlbmRlciA9IGV4aXN0aW5nU2VuZGVycy5maW5kKHMgPT4gcy50cmFjayAhPSBudWxsICYmIHMudHJhY2sua2luZCA9PSB0LmtpbmQpO1xuXG4gICAgICAgIGlmIChzZW5kZXIgIT0gbnVsbCkge1xuICAgICAgICAgIGlmIChzZW5kZXIucmVwbGFjZVRyYWNrKSB7XG4gICAgICAgICAgICBhd2FpdCBzZW5kZXIucmVwbGFjZVRyYWNrKHQpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBGYWxsYmFjayBmb3IgYnJvd3NlcnMgdGhhdCBkb24ndCBzdXBwb3J0IHJlcGxhY2VUcmFjay4gQXQgdGhpcyB0aW1lIG9mIHRoaXMgd3JpdGluZ1xuICAgICAgICAgICAgLy8gbW9zdCBicm93c2VycyBzdXBwb3J0IGl0LCBhbmQgdGVzdGluZyB0aGlzIGNvZGUgcGF0aCBzZWVtcyB0byBub3Qgd29yayBwcm9wZXJseVxuICAgICAgICAgICAgLy8gaW4gQ2hyb21lIGFueW1vcmUuXG4gICAgICAgICAgICBzdHJlYW0ucmVtb3ZlVHJhY2soc2VuZGVyLnRyYWNrKTtcbiAgICAgICAgICAgIHN0cmVhbS5hZGRUcmFjayh0KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgbmV3U2VuZGVycy5wdXNoKHNlbmRlcik7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgbmV3U2VuZGVycy5wdXNoKHRoaXMucHVibGlzaGVyLmNvbm4uYWRkVHJhY2sodCwgc3RyZWFtKSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGV4aXN0aW5nU2VuZGVycy5mb3JFYWNoKHMgPT4ge1xuICAgICAgICBpZiAoIW5ld1NlbmRlcnMuaW5jbHVkZXMocykpIHtcbiAgICAgICAgICBzLnRyYWNrLmVuYWJsZWQgPSBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICAgIHRoaXMubG9jYWxNZWRpYVN0cmVhbSA9IHN0cmVhbTtcbiAgICB0aGlzLnNldE1lZGlhU3RyZWFtKHRoaXMuY2xpZW50SWQsIHN0cmVhbSk7XG4gIH1cblxuICBlbmFibGVNaWNyb3Bob25lKGVuYWJsZWQpIHtcbiAgICBpZiAodGhpcy5wdWJsaXNoZXIgJiYgdGhpcy5wdWJsaXNoZXIuY29ubikge1xuICAgICAgdGhpcy5wdWJsaXNoZXIuY29ubi5nZXRTZW5kZXJzKCkuZm9yRWFjaChzID0+IHtcbiAgICAgICAgaWYgKHMudHJhY2sua2luZCA9PSBcImF1ZGlvXCIpIHtcbiAgICAgICAgICBzLnRyYWNrLmVuYWJsZWQgPSBlbmFibGVkO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICBzZW5kRGF0YShjbGllbnRJZCwgZGF0YVR5cGUsIGRhdGEpIHtcbiAgICBpZiAoIXRoaXMucHVibGlzaGVyKSB7XG4gICAgICBjb25zb2xlLndhcm4oXCJzZW5kRGF0YSBjYWxsZWQgd2l0aG91dCBhIHB1Ymxpc2hlclwiKTtcbiAgICB9IGVsc2Uge1xuICAgICAgc3dpdGNoICh0aGlzLnVucmVsaWFibGVUcmFuc3BvcnQpIHtcbiAgICAgICAgY2FzZSBcIndlYnNvY2tldFwiOlxuICAgICAgICAgIGlmICh0aGlzLndzLnJlYWR5U3RhdGUgPT09IDEpIHsgLy8gT1BFTlxuICAgICAgICAgICAgdGhpcy5wdWJsaXNoZXIuaGFuZGxlLnNlbmRNZXNzYWdlKHsga2luZDogXCJkYXRhXCIsIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZGF0YVR5cGUsIGRhdGEgfSksIHdob206IGNsaWVudElkIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSBcImRhdGFjaGFubmVsXCI6XG4gICAgICAgICAgaWYgKHRoaXMucHVibGlzaGVyLnVucmVsaWFibGVDaGFubmVsLnJlYWR5U3RhdGUgPT09IFwib3BlblwiKSB7XG4gICAgICAgICAgICB0aGlzLnB1Ymxpc2hlci51bnJlbGlhYmxlQ2hhbm5lbC5zZW5kKEpTT04uc3RyaW5naWZ5KHsgY2xpZW50SWQsIGRhdGFUeXBlLCBkYXRhIH0pKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgdGhpcy51bnJlbGlhYmxlVHJhbnNwb3J0KGNsaWVudElkLCBkYXRhVHlwZSwgZGF0YSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgc2VuZERhdGFHdWFyYW50ZWVkKGNsaWVudElkLCBkYXRhVHlwZSwgZGF0YSkge1xuICAgIGlmICghdGhpcy5wdWJsaXNoZXIpIHtcbiAgICAgIGNvbnNvbGUud2FybihcInNlbmREYXRhR3VhcmFudGVlZCBjYWxsZWQgd2l0aG91dCBhIHB1Ymxpc2hlclwiKTtcbiAgICB9IGVsc2Uge1xuICAgICAgc3dpdGNoICh0aGlzLnJlbGlhYmxlVHJhbnNwb3J0KSB7XG4gICAgICAgIGNhc2UgXCJ3ZWJzb2NrZXRcIjpcbiAgICAgICAgICBpZiAodGhpcy53cy5yZWFkeVN0YXRlID09PSAxKSB7IC8vIE9QRU5cbiAgICAgICAgICAgIHRoaXMucHVibGlzaGVyLmhhbmRsZS5zZW5kTWVzc2FnZSh7IGtpbmQ6IFwiZGF0YVwiLCBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGRhdGFUeXBlLCBkYXRhIH0pLCB3aG9tOiBjbGllbnRJZCB9KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgXCJkYXRhY2hhbm5lbFwiOlxuICAgICAgICAgIGlmICh0aGlzLnB1Ymxpc2hlci5yZWxpYWJsZUNoYW5uZWwucmVhZHlTdGF0ZSA9PT0gXCJvcGVuXCIpIHtcbiAgICAgICAgICAgIHRoaXMucHVibGlzaGVyLnJlbGlhYmxlQ2hhbm5lbC5zZW5kKEpTT04uc3RyaW5naWZ5KHsgY2xpZW50SWQsIGRhdGFUeXBlLCBkYXRhIH0pKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgdGhpcy5yZWxpYWJsZVRyYW5zcG9ydChjbGllbnRJZCwgZGF0YVR5cGUsIGRhdGEpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGJyb2FkY2FzdERhdGEoZGF0YVR5cGUsIGRhdGEpIHtcbiAgICBpZiAoIXRoaXMucHVibGlzaGVyKSB7XG4gICAgICBjb25zb2xlLndhcm4oXCJicm9hZGNhc3REYXRhIGNhbGxlZCB3aXRob3V0IGEgcHVibGlzaGVyXCIpO1xuICAgIH0gZWxzZSB7XG4gICAgICBzd2l0Y2ggKHRoaXMudW5yZWxpYWJsZVRyYW5zcG9ydCkge1xuICAgICAgICBjYXNlIFwid2Vic29ja2V0XCI6XG4gICAgICAgICAgaWYgKHRoaXMud3MucmVhZHlTdGF0ZSA9PT0gMSkgeyAvLyBPUEVOXG4gICAgICAgICAgICB0aGlzLnB1Ymxpc2hlci5oYW5kbGUuc2VuZE1lc3NhZ2UoeyBraW5kOiBcImRhdGFcIiwgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBkYXRhVHlwZSwgZGF0YSB9KSB9KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgXCJkYXRhY2hhbm5lbFwiOlxuICAgICAgICAgIGlmICh0aGlzLnB1Ymxpc2hlci51bnJlbGlhYmxlQ2hhbm5lbC5yZWFkeVN0YXRlID09PSBcIm9wZW5cIikge1xuICAgICAgICAgICAgdGhpcy5wdWJsaXNoZXIudW5yZWxpYWJsZUNoYW5uZWwuc2VuZChKU09OLnN0cmluZ2lmeSh7IGRhdGFUeXBlLCBkYXRhIH0pKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgdGhpcy51bnJlbGlhYmxlVHJhbnNwb3J0KHVuZGVmaW5lZCwgZGF0YVR5cGUsIGRhdGEpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGJyb2FkY2FzdERhdGFHdWFyYW50ZWVkKGRhdGFUeXBlLCBkYXRhKSB7XG4gICAgaWYgKCF0aGlzLnB1Ymxpc2hlcikge1xuICAgICAgY29uc29sZS53YXJuKFwiYnJvYWRjYXN0RGF0YUd1YXJhbnRlZWQgY2FsbGVkIHdpdGhvdXQgYSBwdWJsaXNoZXJcIik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHN3aXRjaCAodGhpcy5yZWxpYWJsZVRyYW5zcG9ydCkge1xuICAgICAgICBjYXNlIFwid2Vic29ja2V0XCI6XG4gICAgICAgICAgaWYgKHRoaXMud3MucmVhZHlTdGF0ZSA9PT0gMSkgeyAvLyBPUEVOXG4gICAgICAgICAgICB0aGlzLnB1Ymxpc2hlci5oYW5kbGUuc2VuZE1lc3NhZ2UoeyBraW5kOiBcImRhdGFcIiwgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBkYXRhVHlwZSwgZGF0YSB9KSB9KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgXCJkYXRhY2hhbm5lbFwiOlxuICAgICAgICAgIGlmICh0aGlzLnB1Ymxpc2hlci5yZWxpYWJsZUNoYW5uZWwucmVhZHlTdGF0ZSA9PT0gXCJvcGVuXCIpIHtcbiAgICAgICAgICAgIHRoaXMucHVibGlzaGVyLnJlbGlhYmxlQ2hhbm5lbC5zZW5kKEpTT04uc3RyaW5naWZ5KHsgZGF0YVR5cGUsIGRhdGEgfSkpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICB0aGlzLnJlbGlhYmxlVHJhbnNwb3J0KHVuZGVmaW5lZCwgZGF0YVR5cGUsIGRhdGEpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGtpY2soY2xpZW50SWQsIHBlcm1zVG9rZW4pIHtcbiAgICByZXR1cm4gdGhpcy5wdWJsaXNoZXIuaGFuZGxlLnNlbmRNZXNzYWdlKHsga2luZDogXCJraWNrXCIsIHJvb21faWQ6IHRoaXMucm9vbSwgdXNlcl9pZDogY2xpZW50SWQsIHRva2VuOiBwZXJtc1Rva2VuIH0pLnRoZW4oKCkgPT4ge1xuICAgICAgZG9jdW1lbnQuYm9keS5kaXNwYXRjaEV2ZW50KG5ldyBDdXN0b21FdmVudChcImtpY2tlZFwiLCB7IGRldGFpbDogeyBjbGllbnRJZDogY2xpZW50SWQgfSB9KSk7XG4gICAgfSk7XG4gIH1cblxuICBibG9jayhjbGllbnRJZCkge1xuICAgIHJldHVybiB0aGlzLnB1Ymxpc2hlci5oYW5kbGUuc2VuZE1lc3NhZ2UoeyBraW5kOiBcImJsb2NrXCIsIHdob206IGNsaWVudElkIH0pLnRoZW4oKCkgPT4ge1xuICAgICAgdGhpcy5ibG9ja2VkQ2xpZW50cy5zZXQoY2xpZW50SWQsIHRydWUpO1xuICAgICAgZG9jdW1lbnQuYm9keS5kaXNwYXRjaEV2ZW50KG5ldyBDdXN0b21FdmVudChcImJsb2NrZWRcIiwgeyBkZXRhaWw6IHsgY2xpZW50SWQ6IGNsaWVudElkIH0gfSkpO1xuICAgIH0pO1xuICB9XG5cbiAgdW5ibG9jayhjbGllbnRJZCkge1xuICAgIHJldHVybiB0aGlzLnB1Ymxpc2hlci5oYW5kbGUuc2VuZE1lc3NhZ2UoeyBraW5kOiBcInVuYmxvY2tcIiwgd2hvbTogY2xpZW50SWQgfSkudGhlbigoKSA9PiB7XG4gICAgICB0aGlzLmJsb2NrZWRDbGllbnRzLmRlbGV0ZShjbGllbnRJZCk7XG4gICAgICBkb2N1bWVudC5ib2R5LmRpc3BhdGNoRXZlbnQobmV3IEN1c3RvbUV2ZW50KFwidW5ibG9ja2VkXCIsIHsgZGV0YWlsOiB7IGNsaWVudElkOiBjbGllbnRJZCB9IH0pKTtcbiAgICB9KTtcbiAgfVxufVxuXG5OQUYuYWRhcHRlcnMucmVnaXN0ZXIoXCJqYW51c1wiLCBKYW51c0FkYXB0ZXIpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEphbnVzQWRhcHRlcjtcbiIsIi8qIGVzbGludC1lbnYgbm9kZSAqL1xuJ3VzZSBzdHJpY3QnO1xuXG4vLyBTRFAgaGVscGVycy5cbmNvbnN0IFNEUFV0aWxzID0ge307XG5cbi8vIEdlbmVyYXRlIGFuIGFscGhhbnVtZXJpYyBpZGVudGlmaWVyIGZvciBjbmFtZSBvciBtaWRzLlxuLy8gVE9ETzogdXNlIFVVSURzIGluc3RlYWQ/IGh0dHBzOi8vZ2lzdC5naXRodWIuY29tL2plZC85ODI4ODNcblNEUFV0aWxzLmdlbmVyYXRlSWRlbnRpZmllciA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gTWF0aC5yYW5kb20oKS50b1N0cmluZygzNikuc3Vic3RyaW5nKDIsIDEyKTtcbn07XG5cbi8vIFRoZSBSVENQIENOQU1FIHVzZWQgYnkgYWxsIHBlZXJjb25uZWN0aW9ucyBmcm9tIHRoZSBzYW1lIEpTLlxuU0RQVXRpbHMubG9jYWxDTmFtZSA9IFNEUFV0aWxzLmdlbmVyYXRlSWRlbnRpZmllcigpO1xuXG4vLyBTcGxpdHMgU0RQIGludG8gbGluZXMsIGRlYWxpbmcgd2l0aCBib3RoIENSTEYgYW5kIExGLlxuU0RQVXRpbHMuc3BsaXRMaW5lcyA9IGZ1bmN0aW9uKGJsb2IpIHtcbiAgcmV0dXJuIGJsb2IudHJpbSgpLnNwbGl0KCdcXG4nKS5tYXAobGluZSA9PiBsaW5lLnRyaW0oKSk7XG59O1xuLy8gU3BsaXRzIFNEUCBpbnRvIHNlc3Npb25wYXJ0IGFuZCBtZWRpYXNlY3Rpb25zLiBFbnN1cmVzIENSTEYuXG5TRFBVdGlscy5zcGxpdFNlY3Rpb25zID0gZnVuY3Rpb24oYmxvYikge1xuICBjb25zdCBwYXJ0cyA9IGJsb2Iuc3BsaXQoJ1xcbm09Jyk7XG4gIHJldHVybiBwYXJ0cy5tYXAoKHBhcnQsIGluZGV4KSA9PiAoaW5kZXggPiAwID9cbiAgICAnbT0nICsgcGFydCA6IHBhcnQpLnRyaW0oKSArICdcXHJcXG4nKTtcbn07XG5cbi8vIFJldHVybnMgdGhlIHNlc3Npb24gZGVzY3JpcHRpb24uXG5TRFBVdGlscy5nZXREZXNjcmlwdGlvbiA9IGZ1bmN0aW9uKGJsb2IpIHtcbiAgY29uc3Qgc2VjdGlvbnMgPSBTRFBVdGlscy5zcGxpdFNlY3Rpb25zKGJsb2IpO1xuICByZXR1cm4gc2VjdGlvbnMgJiYgc2VjdGlvbnNbMF07XG59O1xuXG4vLyBSZXR1cm5zIHRoZSBpbmRpdmlkdWFsIG1lZGlhIHNlY3Rpb25zLlxuU0RQVXRpbHMuZ2V0TWVkaWFTZWN0aW9ucyA9IGZ1bmN0aW9uKGJsb2IpIHtcbiAgY29uc3Qgc2VjdGlvbnMgPSBTRFBVdGlscy5zcGxpdFNlY3Rpb25zKGJsb2IpO1xuICBzZWN0aW9ucy5zaGlmdCgpO1xuICByZXR1cm4gc2VjdGlvbnM7XG59O1xuXG4vLyBSZXR1cm5zIGxpbmVzIHRoYXQgc3RhcnQgd2l0aCBhIGNlcnRhaW4gcHJlZml4LlxuU0RQVXRpbHMubWF0Y2hQcmVmaXggPSBmdW5jdGlvbihibG9iLCBwcmVmaXgpIHtcbiAgcmV0dXJuIFNEUFV0aWxzLnNwbGl0TGluZXMoYmxvYikuZmlsdGVyKGxpbmUgPT4gbGluZS5pbmRleE9mKHByZWZpeCkgPT09IDApO1xufTtcblxuLy8gUGFyc2VzIGFuIElDRSBjYW5kaWRhdGUgbGluZS4gU2FtcGxlIGlucHV0OlxuLy8gY2FuZGlkYXRlOjcwMjc4NjM1MCAyIHVkcCA0MTgxOTkwMiA4LjguOC44IDYwNzY5IHR5cCByZWxheSByYWRkciA4LjguOC44XG4vLyBycG9ydCA1NTk5NlwiXG4vLyBJbnB1dCBjYW4gYmUgcHJlZml4ZWQgd2l0aCBhPS5cblNEUFV0aWxzLnBhcnNlQ2FuZGlkYXRlID0gZnVuY3Rpb24obGluZSkge1xuICBsZXQgcGFydHM7XG4gIC8vIFBhcnNlIGJvdGggdmFyaWFudHMuXG4gIGlmIChsaW5lLmluZGV4T2YoJ2E9Y2FuZGlkYXRlOicpID09PSAwKSB7XG4gICAgcGFydHMgPSBsaW5lLnN1YnN0cmluZygxMikuc3BsaXQoJyAnKTtcbiAgfSBlbHNlIHtcbiAgICBwYXJ0cyA9IGxpbmUuc3Vic3RyaW5nKDEwKS5zcGxpdCgnICcpO1xuICB9XG5cbiAgY29uc3QgY2FuZGlkYXRlID0ge1xuICAgIGZvdW5kYXRpb246IHBhcnRzWzBdLFxuICAgIGNvbXBvbmVudDogezE6ICdydHAnLCAyOiAncnRjcCd9W3BhcnRzWzFdXSB8fCBwYXJ0c1sxXSxcbiAgICBwcm90b2NvbDogcGFydHNbMl0udG9Mb3dlckNhc2UoKSxcbiAgICBwcmlvcml0eTogcGFyc2VJbnQocGFydHNbM10sIDEwKSxcbiAgICBpcDogcGFydHNbNF0sXG4gICAgYWRkcmVzczogcGFydHNbNF0sIC8vIGFkZHJlc3MgaXMgYW4gYWxpYXMgZm9yIGlwLlxuICAgIHBvcnQ6IHBhcnNlSW50KHBhcnRzWzVdLCAxMCksXG4gICAgLy8gc2tpcCBwYXJ0c1s2XSA9PSAndHlwJ1xuICAgIHR5cGU6IHBhcnRzWzddLFxuICB9O1xuXG4gIGZvciAobGV0IGkgPSA4OyBpIDwgcGFydHMubGVuZ3RoOyBpICs9IDIpIHtcbiAgICBzd2l0Y2ggKHBhcnRzW2ldKSB7XG4gICAgICBjYXNlICdyYWRkcic6XG4gICAgICAgIGNhbmRpZGF0ZS5yZWxhdGVkQWRkcmVzcyA9IHBhcnRzW2kgKyAxXTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdycG9ydCc6XG4gICAgICAgIGNhbmRpZGF0ZS5yZWxhdGVkUG9ydCA9IHBhcnNlSW50KHBhcnRzW2kgKyAxXSwgMTApO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3RjcHR5cGUnOlxuICAgICAgICBjYW5kaWRhdGUudGNwVHlwZSA9IHBhcnRzW2kgKyAxXTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICd1ZnJhZyc6XG4gICAgICAgIGNhbmRpZGF0ZS51ZnJhZyA9IHBhcnRzW2kgKyAxXTsgLy8gZm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHkuXG4gICAgICAgIGNhbmRpZGF0ZS51c2VybmFtZUZyYWdtZW50ID0gcGFydHNbaSArIDFdO1xuICAgICAgICBicmVhaztcbiAgICAgIGRlZmF1bHQ6IC8vIGV4dGVuc2lvbiBoYW5kbGluZywgaW4gcGFydGljdWxhciB1ZnJhZy4gRG9uJ3Qgb3ZlcndyaXRlLlxuICAgICAgICBpZiAoY2FuZGlkYXRlW3BhcnRzW2ldXSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgY2FuZGlkYXRlW3BhcnRzW2ldXSA9IHBhcnRzW2kgKyAxXTtcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGNhbmRpZGF0ZTtcbn07XG5cbi8vIFRyYW5zbGF0ZXMgYSBjYW5kaWRhdGUgb2JqZWN0IGludG8gU0RQIGNhbmRpZGF0ZSBhdHRyaWJ1dGUuXG4vLyBUaGlzIGRvZXMgbm90IGluY2x1ZGUgdGhlIGE9IHByZWZpeCFcblNEUFV0aWxzLndyaXRlQ2FuZGlkYXRlID0gZnVuY3Rpb24oY2FuZGlkYXRlKSB7XG4gIGNvbnN0IHNkcCA9IFtdO1xuICBzZHAucHVzaChjYW5kaWRhdGUuZm91bmRhdGlvbik7XG5cbiAgY29uc3QgY29tcG9uZW50ID0gY2FuZGlkYXRlLmNvbXBvbmVudDtcbiAgaWYgKGNvbXBvbmVudCA9PT0gJ3J0cCcpIHtcbiAgICBzZHAucHVzaCgxKTtcbiAgfSBlbHNlIGlmIChjb21wb25lbnQgPT09ICdydGNwJykge1xuICAgIHNkcC5wdXNoKDIpO1xuICB9IGVsc2Uge1xuICAgIHNkcC5wdXNoKGNvbXBvbmVudCk7XG4gIH1cbiAgc2RwLnB1c2goY2FuZGlkYXRlLnByb3RvY29sLnRvVXBwZXJDYXNlKCkpO1xuICBzZHAucHVzaChjYW5kaWRhdGUucHJpb3JpdHkpO1xuICBzZHAucHVzaChjYW5kaWRhdGUuYWRkcmVzcyB8fCBjYW5kaWRhdGUuaXApO1xuICBzZHAucHVzaChjYW5kaWRhdGUucG9ydCk7XG5cbiAgY29uc3QgdHlwZSA9IGNhbmRpZGF0ZS50eXBlO1xuICBzZHAucHVzaCgndHlwJyk7XG4gIHNkcC5wdXNoKHR5cGUpO1xuICBpZiAodHlwZSAhPT0gJ2hvc3QnICYmIGNhbmRpZGF0ZS5yZWxhdGVkQWRkcmVzcyAmJlxuICAgICAgY2FuZGlkYXRlLnJlbGF0ZWRQb3J0KSB7XG4gICAgc2RwLnB1c2goJ3JhZGRyJyk7XG4gICAgc2RwLnB1c2goY2FuZGlkYXRlLnJlbGF0ZWRBZGRyZXNzKTtcbiAgICBzZHAucHVzaCgncnBvcnQnKTtcbiAgICBzZHAucHVzaChjYW5kaWRhdGUucmVsYXRlZFBvcnQpO1xuICB9XG4gIGlmIChjYW5kaWRhdGUudGNwVHlwZSAmJiBjYW5kaWRhdGUucHJvdG9jb2wudG9Mb3dlckNhc2UoKSA9PT0gJ3RjcCcpIHtcbiAgICBzZHAucHVzaCgndGNwdHlwZScpO1xuICAgIHNkcC5wdXNoKGNhbmRpZGF0ZS50Y3BUeXBlKTtcbiAgfVxuICBpZiAoY2FuZGlkYXRlLnVzZXJuYW1lRnJhZ21lbnQgfHwgY2FuZGlkYXRlLnVmcmFnKSB7XG4gICAgc2RwLnB1c2goJ3VmcmFnJyk7XG4gICAgc2RwLnB1c2goY2FuZGlkYXRlLnVzZXJuYW1lRnJhZ21lbnQgfHwgY2FuZGlkYXRlLnVmcmFnKTtcbiAgfVxuICByZXR1cm4gJ2NhbmRpZGF0ZTonICsgc2RwLmpvaW4oJyAnKTtcbn07XG5cbi8vIFBhcnNlcyBhbiBpY2Utb3B0aW9ucyBsaW5lLCByZXR1cm5zIGFuIGFycmF5IG9mIG9wdGlvbiB0YWdzLlxuLy8gU2FtcGxlIGlucHV0OlxuLy8gYT1pY2Utb3B0aW9uczpmb28gYmFyXG5TRFBVdGlscy5wYXJzZUljZU9wdGlvbnMgPSBmdW5jdGlvbihsaW5lKSB7XG4gIHJldHVybiBsaW5lLnN1YnN0cmluZygxNCkuc3BsaXQoJyAnKTtcbn07XG5cbi8vIFBhcnNlcyBhIHJ0cG1hcCBsaW5lLCByZXR1cm5zIFJUQ1J0cENvZGRlY1BhcmFtZXRlcnMuIFNhbXBsZSBpbnB1dDpcbi8vIGE9cnRwbWFwOjExMSBvcHVzLzQ4MDAwLzJcblNEUFV0aWxzLnBhcnNlUnRwTWFwID0gZnVuY3Rpb24obGluZSkge1xuICBsZXQgcGFydHMgPSBsaW5lLnN1YnN0cmluZyg5KS5zcGxpdCgnICcpO1xuICBjb25zdCBwYXJzZWQgPSB7XG4gICAgcGF5bG9hZFR5cGU6IHBhcnNlSW50KHBhcnRzLnNoaWZ0KCksIDEwKSwgLy8gd2FzOiBpZFxuICB9O1xuXG4gIHBhcnRzID0gcGFydHNbMF0uc3BsaXQoJy8nKTtcblxuICBwYXJzZWQubmFtZSA9IHBhcnRzWzBdO1xuICBwYXJzZWQuY2xvY2tSYXRlID0gcGFyc2VJbnQocGFydHNbMV0sIDEwKTsgLy8gd2FzOiBjbG9ja3JhdGVcbiAgcGFyc2VkLmNoYW5uZWxzID0gcGFydHMubGVuZ3RoID09PSAzID8gcGFyc2VJbnQocGFydHNbMl0sIDEwKSA6IDE7XG4gIC8vIGxlZ2FjeSBhbGlhcywgZ290IHJlbmFtZWQgYmFjayB0byBjaGFubmVscyBpbiBPUlRDLlxuICBwYXJzZWQubnVtQ2hhbm5lbHMgPSBwYXJzZWQuY2hhbm5lbHM7XG4gIHJldHVybiBwYXJzZWQ7XG59O1xuXG4vLyBHZW5lcmF0ZXMgYSBydHBtYXAgbGluZSBmcm9tIFJUQ1J0cENvZGVjQ2FwYWJpbGl0eSBvclxuLy8gUlRDUnRwQ29kZWNQYXJhbWV0ZXJzLlxuU0RQVXRpbHMud3JpdGVSdHBNYXAgPSBmdW5jdGlvbihjb2RlYykge1xuICBsZXQgcHQgPSBjb2RlYy5wYXlsb2FkVHlwZTtcbiAgaWYgKGNvZGVjLnByZWZlcnJlZFBheWxvYWRUeXBlICE9PSB1bmRlZmluZWQpIHtcbiAgICBwdCA9IGNvZGVjLnByZWZlcnJlZFBheWxvYWRUeXBlO1xuICB9XG4gIGNvbnN0IGNoYW5uZWxzID0gY29kZWMuY2hhbm5lbHMgfHwgY29kZWMubnVtQ2hhbm5lbHMgfHwgMTtcbiAgcmV0dXJuICdhPXJ0cG1hcDonICsgcHQgKyAnICcgKyBjb2RlYy5uYW1lICsgJy8nICsgY29kZWMuY2xvY2tSYXRlICtcbiAgICAgIChjaGFubmVscyAhPT0gMSA/ICcvJyArIGNoYW5uZWxzIDogJycpICsgJ1xcclxcbic7XG59O1xuXG4vLyBQYXJzZXMgYSBleHRtYXAgbGluZSAoaGVhZGVyZXh0ZW5zaW9uIGZyb20gUkZDIDUyODUpLiBTYW1wbGUgaW5wdXQ6XG4vLyBhPWV4dG1hcDoyIHVybjppZXRmOnBhcmFtczpydHAtaGRyZXh0OnRvZmZzZXRcbi8vIGE9ZXh0bWFwOjIvc2VuZG9ubHkgdXJuOmlldGY6cGFyYW1zOnJ0cC1oZHJleHQ6dG9mZnNldFxuU0RQVXRpbHMucGFyc2VFeHRtYXAgPSBmdW5jdGlvbihsaW5lKSB7XG4gIGNvbnN0IHBhcnRzID0gbGluZS5zdWJzdHJpbmcoOSkuc3BsaXQoJyAnKTtcbiAgcmV0dXJuIHtcbiAgICBpZDogcGFyc2VJbnQocGFydHNbMF0sIDEwKSxcbiAgICBkaXJlY3Rpb246IHBhcnRzWzBdLmluZGV4T2YoJy8nKSA+IDAgPyBwYXJ0c1swXS5zcGxpdCgnLycpWzFdIDogJ3NlbmRyZWN2JyxcbiAgICB1cmk6IHBhcnRzWzFdLFxuICAgIGF0dHJpYnV0ZXM6IHBhcnRzLnNsaWNlKDIpLmpvaW4oJyAnKSxcbiAgfTtcbn07XG5cbi8vIEdlbmVyYXRlcyBhbiBleHRtYXAgbGluZSBmcm9tIFJUQ1J0cEhlYWRlckV4dGVuc2lvblBhcmFtZXRlcnMgb3Jcbi8vIFJUQ1J0cEhlYWRlckV4dGVuc2lvbi5cblNEUFV0aWxzLndyaXRlRXh0bWFwID0gZnVuY3Rpb24oaGVhZGVyRXh0ZW5zaW9uKSB7XG4gIHJldHVybiAnYT1leHRtYXA6JyArIChoZWFkZXJFeHRlbnNpb24uaWQgfHwgaGVhZGVyRXh0ZW5zaW9uLnByZWZlcnJlZElkKSArXG4gICAgICAoaGVhZGVyRXh0ZW5zaW9uLmRpcmVjdGlvbiAmJiBoZWFkZXJFeHRlbnNpb24uZGlyZWN0aW9uICE9PSAnc2VuZHJlY3YnXG4gICAgICAgID8gJy8nICsgaGVhZGVyRXh0ZW5zaW9uLmRpcmVjdGlvblxuICAgICAgICA6ICcnKSArXG4gICAgICAnICcgKyBoZWFkZXJFeHRlbnNpb24udXJpICtcbiAgICAgIChoZWFkZXJFeHRlbnNpb24uYXR0cmlidXRlcyA/ICcgJyArIGhlYWRlckV4dGVuc2lvbi5hdHRyaWJ1dGVzIDogJycpICtcbiAgICAgICdcXHJcXG4nO1xufTtcblxuLy8gUGFyc2VzIGEgZm10cCBsaW5lLCByZXR1cm5zIGRpY3Rpb25hcnkuIFNhbXBsZSBpbnB1dDpcbi8vIGE9Zm10cDo5NiB2YnI9b247Y25nPW9uXG4vLyBBbHNvIGRlYWxzIHdpdGggdmJyPW9uOyBjbmc9b25cblNEUFV0aWxzLnBhcnNlRm10cCA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgY29uc3QgcGFyc2VkID0ge307XG4gIGxldCBrdjtcbiAgY29uc3QgcGFydHMgPSBsaW5lLnN1YnN0cmluZyhsaW5lLmluZGV4T2YoJyAnKSArIDEpLnNwbGl0KCc7Jyk7XG4gIGZvciAobGV0IGogPSAwOyBqIDwgcGFydHMubGVuZ3RoOyBqKyspIHtcbiAgICBrdiA9IHBhcnRzW2pdLnRyaW0oKS5zcGxpdCgnPScpO1xuICAgIHBhcnNlZFtrdlswXS50cmltKCldID0ga3ZbMV07XG4gIH1cbiAgcmV0dXJuIHBhcnNlZDtcbn07XG5cbi8vIEdlbmVyYXRlcyBhIGZtdHAgbGluZSBmcm9tIFJUQ1J0cENvZGVjQ2FwYWJpbGl0eSBvciBSVENSdHBDb2RlY1BhcmFtZXRlcnMuXG5TRFBVdGlscy53cml0ZUZtdHAgPSBmdW5jdGlvbihjb2RlYykge1xuICBsZXQgbGluZSA9ICcnO1xuICBsZXQgcHQgPSBjb2RlYy5wYXlsb2FkVHlwZTtcbiAgaWYgKGNvZGVjLnByZWZlcnJlZFBheWxvYWRUeXBlICE9PSB1bmRlZmluZWQpIHtcbiAgICBwdCA9IGNvZGVjLnByZWZlcnJlZFBheWxvYWRUeXBlO1xuICB9XG4gIGlmIChjb2RlYy5wYXJhbWV0ZXJzICYmIE9iamVjdC5rZXlzKGNvZGVjLnBhcmFtZXRlcnMpLmxlbmd0aCkge1xuICAgIGNvbnN0IHBhcmFtcyA9IFtdO1xuICAgIE9iamVjdC5rZXlzKGNvZGVjLnBhcmFtZXRlcnMpLmZvckVhY2gocGFyYW0gPT4ge1xuICAgICAgaWYgKGNvZGVjLnBhcmFtZXRlcnNbcGFyYW1dICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcGFyYW1zLnB1c2gocGFyYW0gKyAnPScgKyBjb2RlYy5wYXJhbWV0ZXJzW3BhcmFtXSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwYXJhbXMucHVzaChwYXJhbSk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgbGluZSArPSAnYT1mbXRwOicgKyBwdCArICcgJyArIHBhcmFtcy5qb2luKCc7JykgKyAnXFxyXFxuJztcbiAgfVxuICByZXR1cm4gbGluZTtcbn07XG5cbi8vIFBhcnNlcyBhIHJ0Y3AtZmIgbGluZSwgcmV0dXJucyBSVENQUnRjcEZlZWRiYWNrIG9iamVjdC4gU2FtcGxlIGlucHV0OlxuLy8gYT1ydGNwLWZiOjk4IG5hY2sgcnBzaVxuU0RQVXRpbHMucGFyc2VSdGNwRmIgPSBmdW5jdGlvbihsaW5lKSB7XG4gIGNvbnN0IHBhcnRzID0gbGluZS5zdWJzdHJpbmcobGluZS5pbmRleE9mKCcgJykgKyAxKS5zcGxpdCgnICcpO1xuICByZXR1cm4ge1xuICAgIHR5cGU6IHBhcnRzLnNoaWZ0KCksXG4gICAgcGFyYW1ldGVyOiBwYXJ0cy5qb2luKCcgJyksXG4gIH07XG59O1xuXG4vLyBHZW5lcmF0ZSBhPXJ0Y3AtZmIgbGluZXMgZnJvbSBSVENSdHBDb2RlY0NhcGFiaWxpdHkgb3IgUlRDUnRwQ29kZWNQYXJhbWV0ZXJzLlxuU0RQVXRpbHMud3JpdGVSdGNwRmIgPSBmdW5jdGlvbihjb2RlYykge1xuICBsZXQgbGluZXMgPSAnJztcbiAgbGV0IHB0ID0gY29kZWMucGF5bG9hZFR5cGU7XG4gIGlmIChjb2RlYy5wcmVmZXJyZWRQYXlsb2FkVHlwZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgcHQgPSBjb2RlYy5wcmVmZXJyZWRQYXlsb2FkVHlwZTtcbiAgfVxuICBpZiAoY29kZWMucnRjcEZlZWRiYWNrICYmIGNvZGVjLnJ0Y3BGZWVkYmFjay5sZW5ndGgpIHtcbiAgICAvLyBGSVhNRTogc3BlY2lhbCBoYW5kbGluZyBmb3IgdHJyLWludD9cbiAgICBjb2RlYy5ydGNwRmVlZGJhY2suZm9yRWFjaChmYiA9PiB7XG4gICAgICBsaW5lcyArPSAnYT1ydGNwLWZiOicgKyBwdCArICcgJyArIGZiLnR5cGUgK1xuICAgICAgKGZiLnBhcmFtZXRlciAmJiBmYi5wYXJhbWV0ZXIubGVuZ3RoID8gJyAnICsgZmIucGFyYW1ldGVyIDogJycpICtcbiAgICAgICAgICAnXFxyXFxuJztcbiAgICB9KTtcbiAgfVxuICByZXR1cm4gbGluZXM7XG59O1xuXG4vLyBQYXJzZXMgYSBSRkMgNTU3NiBzc3JjIG1lZGlhIGF0dHJpYnV0ZS4gU2FtcGxlIGlucHV0OlxuLy8gYT1zc3JjOjM3MzU5Mjg1NTkgY25hbWU6c29tZXRoaW5nXG5TRFBVdGlscy5wYXJzZVNzcmNNZWRpYSA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgY29uc3Qgc3AgPSBsaW5lLmluZGV4T2YoJyAnKTtcbiAgY29uc3QgcGFydHMgPSB7XG4gICAgc3NyYzogcGFyc2VJbnQobGluZS5zdWJzdHJpbmcoNywgc3ApLCAxMCksXG4gIH07XG4gIGNvbnN0IGNvbG9uID0gbGluZS5pbmRleE9mKCc6Jywgc3ApO1xuICBpZiAoY29sb24gPiAtMSkge1xuICAgIHBhcnRzLmF0dHJpYnV0ZSA9IGxpbmUuc3Vic3RyaW5nKHNwICsgMSwgY29sb24pO1xuICAgIHBhcnRzLnZhbHVlID0gbGluZS5zdWJzdHJpbmcoY29sb24gKyAxKTtcbiAgfSBlbHNlIHtcbiAgICBwYXJ0cy5hdHRyaWJ1dGUgPSBsaW5lLnN1YnN0cmluZyhzcCArIDEpO1xuICB9XG4gIHJldHVybiBwYXJ0cztcbn07XG5cbi8vIFBhcnNlIGEgc3NyYy1ncm91cCBsaW5lIChzZWUgUkZDIDU1NzYpLiBTYW1wbGUgaW5wdXQ6XG4vLyBhPXNzcmMtZ3JvdXA6c2VtYW50aWNzIDEyIDM0XG5TRFBVdGlscy5wYXJzZVNzcmNHcm91cCA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgY29uc3QgcGFydHMgPSBsaW5lLnN1YnN0cmluZygxMykuc3BsaXQoJyAnKTtcbiAgcmV0dXJuIHtcbiAgICBzZW1hbnRpY3M6IHBhcnRzLnNoaWZ0KCksXG4gICAgc3NyY3M6IHBhcnRzLm1hcChzc3JjID0+IHBhcnNlSW50KHNzcmMsIDEwKSksXG4gIH07XG59O1xuXG4vLyBFeHRyYWN0cyB0aGUgTUlEIChSRkMgNTg4OCkgZnJvbSBhIG1lZGlhIHNlY3Rpb24uXG4vLyBSZXR1cm5zIHRoZSBNSUQgb3IgdW5kZWZpbmVkIGlmIG5vIG1pZCBsaW5lIHdhcyBmb3VuZC5cblNEUFV0aWxzLmdldE1pZCA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbikge1xuICBjb25zdCBtaWQgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPW1pZDonKVswXTtcbiAgaWYgKG1pZCkge1xuICAgIHJldHVybiBtaWQuc3Vic3RyaW5nKDYpO1xuICB9XG59O1xuXG4vLyBQYXJzZXMgYSBmaW5nZXJwcmludCBsaW5lIGZvciBEVExTLVNSVFAuXG5TRFBVdGlscy5wYXJzZUZpbmdlcnByaW50ID0gZnVuY3Rpb24obGluZSkge1xuICBjb25zdCBwYXJ0cyA9IGxpbmUuc3Vic3RyaW5nKDE0KS5zcGxpdCgnICcpO1xuICByZXR1cm4ge1xuICAgIGFsZ29yaXRobTogcGFydHNbMF0udG9Mb3dlckNhc2UoKSwgLy8gYWxnb3JpdGhtIGlzIGNhc2Utc2Vuc2l0aXZlIGluIEVkZ2UuXG4gICAgdmFsdWU6IHBhcnRzWzFdLnRvVXBwZXJDYXNlKCksIC8vIHRoZSBkZWZpbml0aW9uIGlzIHVwcGVyLWNhc2UgaW4gUkZDIDQ1NzIuXG4gIH07XG59O1xuXG4vLyBFeHRyYWN0cyBEVExTIHBhcmFtZXRlcnMgZnJvbSBTRFAgbWVkaWEgc2VjdGlvbiBvciBzZXNzaW9ucGFydC5cbi8vIEZJWE1FOiBmb3IgY29uc2lzdGVuY3kgd2l0aCBvdGhlciBmdW5jdGlvbnMgdGhpcyBzaG91bGQgb25seVxuLy8gICBnZXQgdGhlIGZpbmdlcnByaW50IGxpbmUgYXMgaW5wdXQuIFNlZSBhbHNvIGdldEljZVBhcmFtZXRlcnMuXG5TRFBVdGlscy5nZXREdGxzUGFyYW1ldGVycyA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbiwgc2Vzc2lvbnBhcnQpIHtcbiAgY29uc3QgbGluZXMgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24gKyBzZXNzaW9ucGFydCxcbiAgICAnYT1maW5nZXJwcmludDonKTtcbiAgLy8gTm90ZTogYT1zZXR1cCBsaW5lIGlzIGlnbm9yZWQgc2luY2Ugd2UgdXNlIHRoZSAnYXV0bycgcm9sZSBpbiBFZGdlLlxuICByZXR1cm4ge1xuICAgIHJvbGU6ICdhdXRvJyxcbiAgICBmaW5nZXJwcmludHM6IGxpbmVzLm1hcChTRFBVdGlscy5wYXJzZUZpbmdlcnByaW50KSxcbiAgfTtcbn07XG5cbi8vIFNlcmlhbGl6ZXMgRFRMUyBwYXJhbWV0ZXJzIHRvIFNEUC5cblNEUFV0aWxzLndyaXRlRHRsc1BhcmFtZXRlcnMgPSBmdW5jdGlvbihwYXJhbXMsIHNldHVwVHlwZSkge1xuICBsZXQgc2RwID0gJ2E9c2V0dXA6JyArIHNldHVwVHlwZSArICdcXHJcXG4nO1xuICBwYXJhbXMuZmluZ2VycHJpbnRzLmZvckVhY2goZnAgPT4ge1xuICAgIHNkcCArPSAnYT1maW5nZXJwcmludDonICsgZnAuYWxnb3JpdGhtICsgJyAnICsgZnAudmFsdWUgKyAnXFxyXFxuJztcbiAgfSk7XG4gIHJldHVybiBzZHA7XG59O1xuXG4vLyBQYXJzZXMgYT1jcnlwdG8gbGluZXMgaW50b1xuLy8gICBodHRwczovL3Jhd2dpdC5jb20vYWJvYmEvZWRnZXJ0Yy9tYXN0ZXIvbXNvcnRjLXJzNC5odG1sI2RpY3Rpb25hcnktcnRjc3J0cHNkZXNwYXJhbWV0ZXJzLW1lbWJlcnNcblNEUFV0aWxzLnBhcnNlQ3J5cHRvTGluZSA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgY29uc3QgcGFydHMgPSBsaW5lLnN1YnN0cmluZyg5KS5zcGxpdCgnICcpO1xuICByZXR1cm4ge1xuICAgIHRhZzogcGFyc2VJbnQocGFydHNbMF0sIDEwKSxcbiAgICBjcnlwdG9TdWl0ZTogcGFydHNbMV0sXG4gICAga2V5UGFyYW1zOiBwYXJ0c1syXSxcbiAgICBzZXNzaW9uUGFyYW1zOiBwYXJ0cy5zbGljZSgzKSxcbiAgfTtcbn07XG5cblNEUFV0aWxzLndyaXRlQ3J5cHRvTGluZSA9IGZ1bmN0aW9uKHBhcmFtZXRlcnMpIHtcbiAgcmV0dXJuICdhPWNyeXB0bzonICsgcGFyYW1ldGVycy50YWcgKyAnICcgK1xuICAgIHBhcmFtZXRlcnMuY3J5cHRvU3VpdGUgKyAnICcgK1xuICAgICh0eXBlb2YgcGFyYW1ldGVycy5rZXlQYXJhbXMgPT09ICdvYmplY3QnXG4gICAgICA/IFNEUFV0aWxzLndyaXRlQ3J5cHRvS2V5UGFyYW1zKHBhcmFtZXRlcnMua2V5UGFyYW1zKVxuICAgICAgOiBwYXJhbWV0ZXJzLmtleVBhcmFtcykgK1xuICAgIChwYXJhbWV0ZXJzLnNlc3Npb25QYXJhbXMgPyAnICcgKyBwYXJhbWV0ZXJzLnNlc3Npb25QYXJhbXMuam9pbignICcpIDogJycpICtcbiAgICAnXFxyXFxuJztcbn07XG5cbi8vIFBhcnNlcyB0aGUgY3J5cHRvIGtleSBwYXJhbWV0ZXJzIGludG9cbi8vICAgaHR0cHM6Ly9yYXdnaXQuY29tL2Fib2JhL2VkZ2VydGMvbWFzdGVyL21zb3J0Yy1yczQuaHRtbCNydGNzcnRwa2V5cGFyYW0qXG5TRFBVdGlscy5wYXJzZUNyeXB0b0tleVBhcmFtcyA9IGZ1bmN0aW9uKGtleVBhcmFtcykge1xuICBpZiAoa2V5UGFyYW1zLmluZGV4T2YoJ2lubGluZTonKSAhPT0gMCkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIGNvbnN0IHBhcnRzID0ga2V5UGFyYW1zLnN1YnN0cmluZyg3KS5zcGxpdCgnfCcpO1xuICByZXR1cm4ge1xuICAgIGtleU1ldGhvZDogJ2lubGluZScsXG4gICAga2V5U2FsdDogcGFydHNbMF0sXG4gICAgbGlmZVRpbWU6IHBhcnRzWzFdLFxuICAgIG1raVZhbHVlOiBwYXJ0c1syXSA/IHBhcnRzWzJdLnNwbGl0KCc6JylbMF0gOiB1bmRlZmluZWQsXG4gICAgbWtpTGVuZ3RoOiBwYXJ0c1syXSA/IHBhcnRzWzJdLnNwbGl0KCc6JylbMV0gOiB1bmRlZmluZWQsXG4gIH07XG59O1xuXG5TRFBVdGlscy53cml0ZUNyeXB0b0tleVBhcmFtcyA9IGZ1bmN0aW9uKGtleVBhcmFtcykge1xuICByZXR1cm4ga2V5UGFyYW1zLmtleU1ldGhvZCArICc6J1xuICAgICsga2V5UGFyYW1zLmtleVNhbHQgK1xuICAgIChrZXlQYXJhbXMubGlmZVRpbWUgPyAnfCcgKyBrZXlQYXJhbXMubGlmZVRpbWUgOiAnJykgK1xuICAgIChrZXlQYXJhbXMubWtpVmFsdWUgJiYga2V5UGFyYW1zLm1raUxlbmd0aFxuICAgICAgPyAnfCcgKyBrZXlQYXJhbXMubWtpVmFsdWUgKyAnOicgKyBrZXlQYXJhbXMubWtpTGVuZ3RoXG4gICAgICA6ICcnKTtcbn07XG5cbi8vIEV4dHJhY3RzIGFsbCBTREVTIHBhcmFtZXRlcnMuXG5TRFBVdGlscy5nZXRDcnlwdG9QYXJhbWV0ZXJzID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uLCBzZXNzaW9ucGFydCkge1xuICBjb25zdCBsaW5lcyA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiArIHNlc3Npb25wYXJ0LFxuICAgICdhPWNyeXB0bzonKTtcbiAgcmV0dXJuIGxpbmVzLm1hcChTRFBVdGlscy5wYXJzZUNyeXB0b0xpbmUpO1xufTtcblxuLy8gUGFyc2VzIElDRSBpbmZvcm1hdGlvbiBmcm9tIFNEUCBtZWRpYSBzZWN0aW9uIG9yIHNlc3Npb25wYXJ0LlxuLy8gRklYTUU6IGZvciBjb25zaXN0ZW5jeSB3aXRoIG90aGVyIGZ1bmN0aW9ucyB0aGlzIHNob3VsZCBvbmx5XG4vLyAgIGdldCB0aGUgaWNlLXVmcmFnIGFuZCBpY2UtcHdkIGxpbmVzIGFzIGlucHV0LlxuU0RQVXRpbHMuZ2V0SWNlUGFyYW1ldGVycyA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbiwgc2Vzc2lvbnBhcnQpIHtcbiAgY29uc3QgdWZyYWcgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24gKyBzZXNzaW9ucGFydCxcbiAgICAnYT1pY2UtdWZyYWc6JylbMF07XG4gIGNvbnN0IHB3ZCA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiArIHNlc3Npb25wYXJ0LFxuICAgICdhPWljZS1wd2Q6JylbMF07XG4gIGlmICghKHVmcmFnICYmIHB3ZCkpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICByZXR1cm4ge1xuICAgIHVzZXJuYW1lRnJhZ21lbnQ6IHVmcmFnLnN1YnN0cmluZygxMiksXG4gICAgcGFzc3dvcmQ6IHB3ZC5zdWJzdHJpbmcoMTApLFxuICB9O1xufTtcblxuLy8gU2VyaWFsaXplcyBJQ0UgcGFyYW1ldGVycyB0byBTRFAuXG5TRFBVdGlscy53cml0ZUljZVBhcmFtZXRlcnMgPSBmdW5jdGlvbihwYXJhbXMpIHtcbiAgbGV0IHNkcCA9ICdhPWljZS11ZnJhZzonICsgcGFyYW1zLnVzZXJuYW1lRnJhZ21lbnQgKyAnXFxyXFxuJyArXG4gICAgICAnYT1pY2UtcHdkOicgKyBwYXJhbXMucGFzc3dvcmQgKyAnXFxyXFxuJztcbiAgaWYgKHBhcmFtcy5pY2VMaXRlKSB7XG4gICAgc2RwICs9ICdhPWljZS1saXRlXFxyXFxuJztcbiAgfVxuICByZXR1cm4gc2RwO1xufTtcblxuLy8gUGFyc2VzIHRoZSBTRFAgbWVkaWEgc2VjdGlvbiBhbmQgcmV0dXJucyBSVENSdHBQYXJhbWV0ZXJzLlxuU0RQVXRpbHMucGFyc2VSdHBQYXJhbWV0ZXJzID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIGNvbnN0IGRlc2NyaXB0aW9uID0ge1xuICAgIGNvZGVjczogW10sXG4gICAgaGVhZGVyRXh0ZW5zaW9uczogW10sXG4gICAgZmVjTWVjaGFuaXNtczogW10sXG4gICAgcnRjcDogW10sXG4gIH07XG4gIGNvbnN0IGxpbmVzID0gU0RQVXRpbHMuc3BsaXRMaW5lcyhtZWRpYVNlY3Rpb24pO1xuICBjb25zdCBtbGluZSA9IGxpbmVzWzBdLnNwbGl0KCcgJyk7XG4gIGRlc2NyaXB0aW9uLnByb2ZpbGUgPSBtbGluZVsyXTtcbiAgZm9yIChsZXQgaSA9IDM7IGkgPCBtbGluZS5sZW5ndGg7IGkrKykgeyAvLyBmaW5kIGFsbCBjb2RlY3MgZnJvbSBtbGluZVszLi5dXG4gICAgY29uc3QgcHQgPSBtbGluZVtpXTtcbiAgICBjb25zdCBydHBtYXBsaW5lID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgoXG4gICAgICBtZWRpYVNlY3Rpb24sICdhPXJ0cG1hcDonICsgcHQgKyAnICcpWzBdO1xuICAgIGlmIChydHBtYXBsaW5lKSB7XG4gICAgICBjb25zdCBjb2RlYyA9IFNEUFV0aWxzLnBhcnNlUnRwTWFwKHJ0cG1hcGxpbmUpO1xuICAgICAgY29uc3QgZm10cHMgPSBTRFBVdGlscy5tYXRjaFByZWZpeChcbiAgICAgICAgbWVkaWFTZWN0aW9uLCAnYT1mbXRwOicgKyBwdCArICcgJyk7XG4gICAgICAvLyBPbmx5IHRoZSBmaXJzdCBhPWZtdHA6PHB0PiBpcyBjb25zaWRlcmVkLlxuICAgICAgY29kZWMucGFyYW1ldGVycyA9IGZtdHBzLmxlbmd0aCA/IFNEUFV0aWxzLnBhcnNlRm10cChmbXRwc1swXSkgOiB7fTtcbiAgICAgIGNvZGVjLnJ0Y3BGZWVkYmFjayA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KFxuICAgICAgICBtZWRpYVNlY3Rpb24sICdhPXJ0Y3AtZmI6JyArIHB0ICsgJyAnKVxuICAgICAgICAubWFwKFNEUFV0aWxzLnBhcnNlUnRjcEZiKTtcbiAgICAgIGRlc2NyaXB0aW9uLmNvZGVjcy5wdXNoKGNvZGVjKTtcbiAgICAgIC8vIHBhcnNlIEZFQyBtZWNoYW5pc21zIGZyb20gcnRwbWFwIGxpbmVzLlxuICAgICAgc3dpdGNoIChjb2RlYy5uYW1lLnRvVXBwZXJDYXNlKCkpIHtcbiAgICAgICAgY2FzZSAnUkVEJzpcbiAgICAgICAgY2FzZSAnVUxQRkVDJzpcbiAgICAgICAgICBkZXNjcmlwdGlvbi5mZWNNZWNoYW5pc21zLnB1c2goY29kZWMubmFtZS50b1VwcGVyQ2FzZSgpKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgZGVmYXVsdDogLy8gb25seSBSRUQgYW5kIFVMUEZFQyBhcmUgcmVjb2duaXplZCBhcyBGRUMgbWVjaGFuaXNtcy5cbiAgICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1leHRtYXA6JykuZm9yRWFjaChsaW5lID0+IHtcbiAgICBkZXNjcmlwdGlvbi5oZWFkZXJFeHRlbnNpb25zLnB1c2goU0RQVXRpbHMucGFyc2VFeHRtYXAobGluZSkpO1xuICB9KTtcbiAgY29uc3Qgd2lsZGNhcmRSdGNwRmIgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPXJ0Y3AtZmI6KiAnKVxuICAgIC5tYXAoU0RQVXRpbHMucGFyc2VSdGNwRmIpO1xuICBkZXNjcmlwdGlvbi5jb2RlY3MuZm9yRWFjaChjb2RlYyA9PiB7XG4gICAgd2lsZGNhcmRSdGNwRmIuZm9yRWFjaChmYj0+IHtcbiAgICAgIGNvbnN0IGR1cGxpY2F0ZSA9IGNvZGVjLnJ0Y3BGZWVkYmFjay5maW5kKGV4aXN0aW5nRmVlZGJhY2sgPT4ge1xuICAgICAgICByZXR1cm4gZXhpc3RpbmdGZWVkYmFjay50eXBlID09PSBmYi50eXBlICYmXG4gICAgICAgICAgZXhpc3RpbmdGZWVkYmFjay5wYXJhbWV0ZXIgPT09IGZiLnBhcmFtZXRlcjtcbiAgICAgIH0pO1xuICAgICAgaWYgKCFkdXBsaWNhdGUpIHtcbiAgICAgICAgY29kZWMucnRjcEZlZWRiYWNrLnB1c2goZmIpO1xuICAgICAgfVxuICAgIH0pO1xuICB9KTtcbiAgLy8gRklYTUU6IHBhcnNlIHJ0Y3AuXG4gIHJldHVybiBkZXNjcmlwdGlvbjtcbn07XG5cbi8vIEdlbmVyYXRlcyBwYXJ0cyBvZiB0aGUgU0RQIG1lZGlhIHNlY3Rpb24gZGVzY3JpYmluZyB0aGUgY2FwYWJpbGl0aWVzIC9cbi8vIHBhcmFtZXRlcnMuXG5TRFBVdGlscy53cml0ZVJ0cERlc2NyaXB0aW9uID0gZnVuY3Rpb24oa2luZCwgY2Fwcykge1xuICBsZXQgc2RwID0gJyc7XG5cbiAgLy8gQnVpbGQgdGhlIG1saW5lLlxuICBzZHAgKz0gJ209JyArIGtpbmQgKyAnICc7XG4gIHNkcCArPSBjYXBzLmNvZGVjcy5sZW5ndGggPiAwID8gJzknIDogJzAnOyAvLyByZWplY3QgaWYgbm8gY29kZWNzLlxuICBzZHAgKz0gJyAnICsgKGNhcHMucHJvZmlsZSB8fCAnVURQL1RMUy9SVFAvU0FWUEYnKSArICcgJztcbiAgc2RwICs9IGNhcHMuY29kZWNzLm1hcChjb2RlYyA9PiB7XG4gICAgaWYgKGNvZGVjLnByZWZlcnJlZFBheWxvYWRUeXBlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybiBjb2RlYy5wcmVmZXJyZWRQYXlsb2FkVHlwZTtcbiAgICB9XG4gICAgcmV0dXJuIGNvZGVjLnBheWxvYWRUeXBlO1xuICB9KS5qb2luKCcgJykgKyAnXFxyXFxuJztcblxuICBzZHAgKz0gJ2M9SU4gSVA0IDAuMC4wLjBcXHJcXG4nO1xuICBzZHAgKz0gJ2E9cnRjcDo5IElOIElQNCAwLjAuMC4wXFxyXFxuJztcblxuICAvLyBBZGQgYT1ydHBtYXAgbGluZXMgZm9yIGVhY2ggY29kZWMuIEFsc28gZm10cCBhbmQgcnRjcC1mYi5cbiAgY2Fwcy5jb2RlY3MuZm9yRWFjaChjb2RlYyA9PiB7XG4gICAgc2RwICs9IFNEUFV0aWxzLndyaXRlUnRwTWFwKGNvZGVjKTtcbiAgICBzZHAgKz0gU0RQVXRpbHMud3JpdGVGbXRwKGNvZGVjKTtcbiAgICBzZHAgKz0gU0RQVXRpbHMud3JpdGVSdGNwRmIoY29kZWMpO1xuICB9KTtcbiAgbGV0IG1heHB0aW1lID0gMDtcbiAgY2Fwcy5jb2RlY3MuZm9yRWFjaChjb2RlYyA9PiB7XG4gICAgaWYgKGNvZGVjLm1heHB0aW1lID4gbWF4cHRpbWUpIHtcbiAgICAgIG1heHB0aW1lID0gY29kZWMubWF4cHRpbWU7XG4gICAgfVxuICB9KTtcbiAgaWYgKG1heHB0aW1lID4gMCkge1xuICAgIHNkcCArPSAnYT1tYXhwdGltZTonICsgbWF4cHRpbWUgKyAnXFxyXFxuJztcbiAgfVxuXG4gIGlmIChjYXBzLmhlYWRlckV4dGVuc2lvbnMpIHtcbiAgICBjYXBzLmhlYWRlckV4dGVuc2lvbnMuZm9yRWFjaChleHRlbnNpb24gPT4ge1xuICAgICAgc2RwICs9IFNEUFV0aWxzLndyaXRlRXh0bWFwKGV4dGVuc2lvbik7XG4gICAgfSk7XG4gIH1cbiAgLy8gRklYTUU6IHdyaXRlIGZlY01lY2hhbmlzbXMuXG4gIHJldHVybiBzZHA7XG59O1xuXG4vLyBQYXJzZXMgdGhlIFNEUCBtZWRpYSBzZWN0aW9uIGFuZCByZXR1cm5zIGFuIGFycmF5IG9mXG4vLyBSVENSdHBFbmNvZGluZ1BhcmFtZXRlcnMuXG5TRFBVdGlscy5wYXJzZVJ0cEVuY29kaW5nUGFyYW1ldGVycyA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbikge1xuICBjb25zdCBlbmNvZGluZ1BhcmFtZXRlcnMgPSBbXTtcbiAgY29uc3QgZGVzY3JpcHRpb24gPSBTRFBVdGlscy5wYXJzZVJ0cFBhcmFtZXRlcnMobWVkaWFTZWN0aW9uKTtcbiAgY29uc3QgaGFzUmVkID0gZGVzY3JpcHRpb24uZmVjTWVjaGFuaXNtcy5pbmRleE9mKCdSRUQnKSAhPT0gLTE7XG4gIGNvbnN0IGhhc1VscGZlYyA9IGRlc2NyaXB0aW9uLmZlY01lY2hhbmlzbXMuaW5kZXhPZignVUxQRkVDJykgIT09IC0xO1xuXG4gIC8vIGZpbHRlciBhPXNzcmM6Li4uIGNuYW1lOiwgaWdub3JlIFBsYW5CLW1zaWRcbiAgY29uc3Qgc3NyY3MgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPXNzcmM6JylcbiAgICAubWFwKGxpbmUgPT4gU0RQVXRpbHMucGFyc2VTc3JjTWVkaWEobGluZSkpXG4gICAgLmZpbHRlcihwYXJ0cyA9PiBwYXJ0cy5hdHRyaWJ1dGUgPT09ICdjbmFtZScpO1xuICBjb25zdCBwcmltYXJ5U3NyYyA9IHNzcmNzLmxlbmd0aCA+IDAgJiYgc3NyY3NbMF0uc3NyYztcbiAgbGV0IHNlY29uZGFyeVNzcmM7XG5cbiAgY29uc3QgZmxvd3MgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPXNzcmMtZ3JvdXA6RklEJylcbiAgICAubWFwKGxpbmUgPT4ge1xuICAgICAgY29uc3QgcGFydHMgPSBsaW5lLnN1YnN0cmluZygxNykuc3BsaXQoJyAnKTtcbiAgICAgIHJldHVybiBwYXJ0cy5tYXAocGFydCA9PiBwYXJzZUludChwYXJ0LCAxMCkpO1xuICAgIH0pO1xuICBpZiAoZmxvd3MubGVuZ3RoID4gMCAmJiBmbG93c1swXS5sZW5ndGggPiAxICYmIGZsb3dzWzBdWzBdID09PSBwcmltYXJ5U3NyYykge1xuICAgIHNlY29uZGFyeVNzcmMgPSBmbG93c1swXVsxXTtcbiAgfVxuXG4gIGRlc2NyaXB0aW9uLmNvZGVjcy5mb3JFYWNoKGNvZGVjID0+IHtcbiAgICBpZiAoY29kZWMubmFtZS50b1VwcGVyQ2FzZSgpID09PSAnUlRYJyAmJiBjb2RlYy5wYXJhbWV0ZXJzLmFwdCkge1xuICAgICAgbGV0IGVuY1BhcmFtID0ge1xuICAgICAgICBzc3JjOiBwcmltYXJ5U3NyYyxcbiAgICAgICAgY29kZWNQYXlsb2FkVHlwZTogcGFyc2VJbnQoY29kZWMucGFyYW1ldGVycy5hcHQsIDEwKSxcbiAgICAgIH07XG4gICAgICBpZiAocHJpbWFyeVNzcmMgJiYgc2Vjb25kYXJ5U3NyYykge1xuICAgICAgICBlbmNQYXJhbS5ydHggPSB7c3NyYzogc2Vjb25kYXJ5U3NyY307XG4gICAgICB9XG4gICAgICBlbmNvZGluZ1BhcmFtZXRlcnMucHVzaChlbmNQYXJhbSk7XG4gICAgICBpZiAoaGFzUmVkKSB7XG4gICAgICAgIGVuY1BhcmFtID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShlbmNQYXJhbSkpO1xuICAgICAgICBlbmNQYXJhbS5mZWMgPSB7XG4gICAgICAgICAgc3NyYzogcHJpbWFyeVNzcmMsXG4gICAgICAgICAgbWVjaGFuaXNtOiBoYXNVbHBmZWMgPyAncmVkK3VscGZlYycgOiAncmVkJyxcbiAgICAgICAgfTtcbiAgICAgICAgZW5jb2RpbmdQYXJhbWV0ZXJzLnB1c2goZW5jUGFyYW0pO1xuICAgICAgfVxuICAgIH1cbiAgfSk7XG4gIGlmIChlbmNvZGluZ1BhcmFtZXRlcnMubGVuZ3RoID09PSAwICYmIHByaW1hcnlTc3JjKSB7XG4gICAgZW5jb2RpbmdQYXJhbWV0ZXJzLnB1c2goe1xuICAgICAgc3NyYzogcHJpbWFyeVNzcmMsXG4gICAgfSk7XG4gIH1cblxuICAvLyB3ZSBzdXBwb3J0IGJvdGggYj1BUyBhbmQgYj1USUFTIGJ1dCBpbnRlcnByZXQgQVMgYXMgVElBUy5cbiAgbGV0IGJhbmR3aWR0aCA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2I9Jyk7XG4gIGlmIChiYW5kd2lkdGgubGVuZ3RoKSB7XG4gICAgaWYgKGJhbmR3aWR0aFswXS5pbmRleE9mKCdiPVRJQVM6JykgPT09IDApIHtcbiAgICAgIGJhbmR3aWR0aCA9IHBhcnNlSW50KGJhbmR3aWR0aFswXS5zdWJzdHJpbmcoNyksIDEwKTtcbiAgICB9IGVsc2UgaWYgKGJhbmR3aWR0aFswXS5pbmRleE9mKCdiPUFTOicpID09PSAwKSB7XG4gICAgICAvLyB1c2UgZm9ybXVsYSBmcm9tIEpTRVAgdG8gY29udmVydCBiPUFTIHRvIFRJQVMgdmFsdWUuXG4gICAgICBiYW5kd2lkdGggPSBwYXJzZUludChiYW5kd2lkdGhbMF0uc3Vic3RyaW5nKDUpLCAxMCkgKiAxMDAwICogMC45NVxuICAgICAgICAgIC0gKDUwICogNDAgKiA4KTtcbiAgICB9IGVsc2Uge1xuICAgICAgYmFuZHdpZHRoID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBlbmNvZGluZ1BhcmFtZXRlcnMuZm9yRWFjaChwYXJhbXMgPT4ge1xuICAgICAgcGFyYW1zLm1heEJpdHJhdGUgPSBiYW5kd2lkdGg7XG4gICAgfSk7XG4gIH1cbiAgcmV0dXJuIGVuY29kaW5nUGFyYW1ldGVycztcbn07XG5cbi8vIHBhcnNlcyBodHRwOi8vZHJhZnQub3J0Yy5vcmcvI3J0Y3J0Y3BwYXJhbWV0ZXJzKlxuU0RQVXRpbHMucGFyc2VSdGNwUGFyYW1ldGVycyA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbikge1xuICBjb25zdCBydGNwUGFyYW1ldGVycyA9IHt9O1xuXG4gIC8vIEdldHMgdGhlIGZpcnN0IFNTUkMuIE5vdGUgdGhhdCB3aXRoIFJUWCB0aGVyZSBtaWdodCBiZSBtdWx0aXBsZVxuICAvLyBTU1JDcy5cbiAgY29uc3QgcmVtb3RlU3NyYyA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9c3NyYzonKVxuICAgIC5tYXAobGluZSA9PiBTRFBVdGlscy5wYXJzZVNzcmNNZWRpYShsaW5lKSlcbiAgICAuZmlsdGVyKG9iaiA9PiBvYmouYXR0cmlidXRlID09PSAnY25hbWUnKVswXTtcbiAgaWYgKHJlbW90ZVNzcmMpIHtcbiAgICBydGNwUGFyYW1ldGVycy5jbmFtZSA9IHJlbW90ZVNzcmMudmFsdWU7XG4gICAgcnRjcFBhcmFtZXRlcnMuc3NyYyA9IHJlbW90ZVNzcmMuc3NyYztcbiAgfVxuXG4gIC8vIEVkZ2UgdXNlcyB0aGUgY29tcG91bmQgYXR0cmlidXRlIGluc3RlYWQgb2YgcmVkdWNlZFNpemVcbiAgLy8gY29tcG91bmQgaXMgIXJlZHVjZWRTaXplXG4gIGNvbnN0IHJzaXplID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1ydGNwLXJzaXplJyk7XG4gIHJ0Y3BQYXJhbWV0ZXJzLnJlZHVjZWRTaXplID0gcnNpemUubGVuZ3RoID4gMDtcbiAgcnRjcFBhcmFtZXRlcnMuY29tcG91bmQgPSByc2l6ZS5sZW5ndGggPT09IDA7XG5cbiAgLy8gcGFyc2VzIHRoZSBydGNwLW11eCBhdHRy0ZZidXRlLlxuICAvLyBOb3RlIHRoYXQgRWRnZSBkb2VzIG5vdCBzdXBwb3J0IHVubXV4ZWQgUlRDUC5cbiAgY29uc3QgbXV4ID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1ydGNwLW11eCcpO1xuICBydGNwUGFyYW1ldGVycy5tdXggPSBtdXgubGVuZ3RoID4gMDtcblxuICByZXR1cm4gcnRjcFBhcmFtZXRlcnM7XG59O1xuXG5TRFBVdGlscy53cml0ZVJ0Y3BQYXJhbWV0ZXJzID0gZnVuY3Rpb24ocnRjcFBhcmFtZXRlcnMpIHtcbiAgbGV0IHNkcCA9ICcnO1xuICBpZiAocnRjcFBhcmFtZXRlcnMucmVkdWNlZFNpemUpIHtcbiAgICBzZHAgKz0gJ2E9cnRjcC1yc2l6ZVxcclxcbic7XG4gIH1cbiAgaWYgKHJ0Y3BQYXJhbWV0ZXJzLm11eCkge1xuICAgIHNkcCArPSAnYT1ydGNwLW11eFxcclxcbic7XG4gIH1cbiAgaWYgKHJ0Y3BQYXJhbWV0ZXJzLnNzcmMgIT09IHVuZGVmaW5lZCAmJiBydGNwUGFyYW1ldGVycy5jbmFtZSkge1xuICAgIHNkcCArPSAnYT1zc3JjOicgKyBydGNwUGFyYW1ldGVycy5zc3JjICtcbiAgICAgICcgY25hbWU6JyArIHJ0Y3BQYXJhbWV0ZXJzLmNuYW1lICsgJ1xcclxcbic7XG4gIH1cbiAgcmV0dXJuIHNkcDtcbn07XG5cblxuLy8gcGFyc2VzIGVpdGhlciBhPW1zaWQ6IG9yIGE9c3NyYzouLi4gbXNpZCBsaW5lcyBhbmQgcmV0dXJuc1xuLy8gdGhlIGlkIG9mIHRoZSBNZWRpYVN0cmVhbSBhbmQgTWVkaWFTdHJlYW1UcmFjay5cblNEUFV0aWxzLnBhcnNlTXNpZCA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbikge1xuICBsZXQgcGFydHM7XG4gIGNvbnN0IHNwZWMgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPW1zaWQ6Jyk7XG4gIGlmIChzcGVjLmxlbmd0aCA9PT0gMSkge1xuICAgIHBhcnRzID0gc3BlY1swXS5zdWJzdHJpbmcoNykuc3BsaXQoJyAnKTtcbiAgICByZXR1cm4ge3N0cmVhbTogcGFydHNbMF0sIHRyYWNrOiBwYXJ0c1sxXX07XG4gIH1cbiAgY29uc3QgcGxhbkIgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPXNzcmM6JylcbiAgICAubWFwKGxpbmUgPT4gU0RQVXRpbHMucGFyc2VTc3JjTWVkaWEobGluZSkpXG4gICAgLmZpbHRlcihtc2lkUGFydHMgPT4gbXNpZFBhcnRzLmF0dHJpYnV0ZSA9PT0gJ21zaWQnKTtcbiAgaWYgKHBsYW5CLmxlbmd0aCA+IDApIHtcbiAgICBwYXJ0cyA9IHBsYW5CWzBdLnZhbHVlLnNwbGl0KCcgJyk7XG4gICAgcmV0dXJuIHtzdHJlYW06IHBhcnRzWzBdLCB0cmFjazogcGFydHNbMV19O1xuICB9XG59O1xuXG4vLyBTQ1RQXG4vLyBwYXJzZXMgZHJhZnQtaWV0Zi1tbXVzaWMtc2N0cC1zZHAtMjYgZmlyc3QgYW5kIGZhbGxzIGJhY2tcbi8vIHRvIGRyYWZ0LWlldGYtbW11c2ljLXNjdHAtc2RwLTA1XG5TRFBVdGlscy5wYXJzZVNjdHBEZXNjcmlwdGlvbiA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbikge1xuICBjb25zdCBtbGluZSA9IFNEUFV0aWxzLnBhcnNlTUxpbmUobWVkaWFTZWN0aW9uKTtcbiAgY29uc3QgbWF4U2l6ZUxpbmUgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPW1heC1tZXNzYWdlLXNpemU6Jyk7XG4gIGxldCBtYXhNZXNzYWdlU2l6ZTtcbiAgaWYgKG1heFNpemVMaW5lLmxlbmd0aCA+IDApIHtcbiAgICBtYXhNZXNzYWdlU2l6ZSA9IHBhcnNlSW50KG1heFNpemVMaW5lWzBdLnN1YnN0cmluZygxOSksIDEwKTtcbiAgfVxuICBpZiAoaXNOYU4obWF4TWVzc2FnZVNpemUpKSB7XG4gICAgbWF4TWVzc2FnZVNpemUgPSA2NTUzNjtcbiAgfVxuICBjb25zdCBzY3RwUG9ydCA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9c2N0cC1wb3J0OicpO1xuICBpZiAoc2N0cFBvcnQubGVuZ3RoID4gMCkge1xuICAgIHJldHVybiB7XG4gICAgICBwb3J0OiBwYXJzZUludChzY3RwUG9ydFswXS5zdWJzdHJpbmcoMTIpLCAxMCksXG4gICAgICBwcm90b2NvbDogbWxpbmUuZm10LFxuICAgICAgbWF4TWVzc2FnZVNpemUsXG4gICAgfTtcbiAgfVxuICBjb25zdCBzY3RwTWFwTGluZXMgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPXNjdHBtYXA6Jyk7XG4gIGlmIChzY3RwTWFwTGluZXMubGVuZ3RoID4gMCkge1xuICAgIGNvbnN0IHBhcnRzID0gc2N0cE1hcExpbmVzWzBdXG4gICAgICAuc3Vic3RyaW5nKDEwKVxuICAgICAgLnNwbGl0KCcgJyk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHBvcnQ6IHBhcnNlSW50KHBhcnRzWzBdLCAxMCksXG4gICAgICBwcm90b2NvbDogcGFydHNbMV0sXG4gICAgICBtYXhNZXNzYWdlU2l6ZSxcbiAgICB9O1xuICB9XG59O1xuXG4vLyBTQ1RQXG4vLyBvdXRwdXRzIHRoZSBkcmFmdC1pZXRmLW1tdXNpYy1zY3RwLXNkcC0yNiB2ZXJzaW9uIHRoYXQgYWxsIGJyb3dzZXJzXG4vLyBzdXBwb3J0IGJ5IG5vdyByZWNlaXZpbmcgaW4gdGhpcyBmb3JtYXQsIHVubGVzcyB3ZSBvcmlnaW5hbGx5IHBhcnNlZFxuLy8gYXMgdGhlIGRyYWZ0LWlldGYtbW11c2ljLXNjdHAtc2RwLTA1IGZvcm1hdCAoaW5kaWNhdGVkIGJ5IHRoZSBtLWxpbmVcbi8vIHByb3RvY29sIG9mIERUTFMvU0NUUCAtLSB3aXRob3V0IFVEUC8gb3IgVENQLylcblNEUFV0aWxzLndyaXRlU2N0cERlc2NyaXB0aW9uID0gZnVuY3Rpb24obWVkaWEsIHNjdHApIHtcbiAgbGV0IG91dHB1dCA9IFtdO1xuICBpZiAobWVkaWEucHJvdG9jb2wgIT09ICdEVExTL1NDVFAnKSB7XG4gICAgb3V0cHV0ID0gW1xuICAgICAgJ209JyArIG1lZGlhLmtpbmQgKyAnIDkgJyArIG1lZGlhLnByb3RvY29sICsgJyAnICsgc2N0cC5wcm90b2NvbCArICdcXHJcXG4nLFxuICAgICAgJ2M9SU4gSVA0IDAuMC4wLjBcXHJcXG4nLFxuICAgICAgJ2E9c2N0cC1wb3J0OicgKyBzY3RwLnBvcnQgKyAnXFxyXFxuJyxcbiAgICBdO1xuICB9IGVsc2Uge1xuICAgIG91dHB1dCA9IFtcbiAgICAgICdtPScgKyBtZWRpYS5raW5kICsgJyA5ICcgKyBtZWRpYS5wcm90b2NvbCArICcgJyArIHNjdHAucG9ydCArICdcXHJcXG4nLFxuICAgICAgJ2M9SU4gSVA0IDAuMC4wLjBcXHJcXG4nLFxuICAgICAgJ2E9c2N0cG1hcDonICsgc2N0cC5wb3J0ICsgJyAnICsgc2N0cC5wcm90b2NvbCArICcgNjU1MzVcXHJcXG4nLFxuICAgIF07XG4gIH1cbiAgaWYgKHNjdHAubWF4TWVzc2FnZVNpemUgIT09IHVuZGVmaW5lZCkge1xuICAgIG91dHB1dC5wdXNoKCdhPW1heC1tZXNzYWdlLXNpemU6JyArIHNjdHAubWF4TWVzc2FnZVNpemUgKyAnXFxyXFxuJyk7XG4gIH1cbiAgcmV0dXJuIG91dHB1dC5qb2luKCcnKTtcbn07XG5cbi8vIEdlbmVyYXRlIGEgc2Vzc2lvbiBJRCBmb3IgU0RQLlxuLy8gaHR0cHM6Ly90b29scy5pZXRmLm9yZy9odG1sL2RyYWZ0LWlldGYtcnRjd2ViLWpzZXAtMjAjc2VjdGlvbi01LjIuMVxuLy8gcmVjb21tZW5kcyB1c2luZyBhIGNyeXB0b2dyYXBoaWNhbGx5IHJhbmRvbSArdmUgNjQtYml0IHZhbHVlXG4vLyBidXQgcmlnaHQgbm93IHRoaXMgc2hvdWxkIGJlIGFjY2VwdGFibGUgYW5kIHdpdGhpbiB0aGUgcmlnaHQgcmFuZ2VcblNEUFV0aWxzLmdlbmVyYXRlU2Vzc2lvbklkID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKCkuc3Vic3RyKDIsIDIyKTtcbn07XG5cbi8vIFdyaXRlIGJvaWxlciBwbGF0ZSBmb3Igc3RhcnQgb2YgU0RQXG4vLyBzZXNzSWQgYXJndW1lbnQgaXMgb3B0aW9uYWwgLSBpZiBub3Qgc3VwcGxpZWQgaXQgd2lsbFxuLy8gYmUgZ2VuZXJhdGVkIHJhbmRvbWx5XG4vLyBzZXNzVmVyc2lvbiBpcyBvcHRpb25hbCBhbmQgZGVmYXVsdHMgdG8gMlxuLy8gc2Vzc1VzZXIgaXMgb3B0aW9uYWwgYW5kIGRlZmF1bHRzIHRvICd0aGlzaXNhZGFwdGVyb3J0YydcblNEUFV0aWxzLndyaXRlU2Vzc2lvbkJvaWxlcnBsYXRlID0gZnVuY3Rpb24oc2Vzc0lkLCBzZXNzVmVyLCBzZXNzVXNlcikge1xuICBsZXQgc2Vzc2lvbklkO1xuICBjb25zdCB2ZXJzaW9uID0gc2Vzc1ZlciAhPT0gdW5kZWZpbmVkID8gc2Vzc1ZlciA6IDI7XG4gIGlmIChzZXNzSWQpIHtcbiAgICBzZXNzaW9uSWQgPSBzZXNzSWQ7XG4gIH0gZWxzZSB7XG4gICAgc2Vzc2lvbklkID0gU0RQVXRpbHMuZ2VuZXJhdGVTZXNzaW9uSWQoKTtcbiAgfVxuICBjb25zdCB1c2VyID0gc2Vzc1VzZXIgfHwgJ3RoaXNpc2FkYXB0ZXJvcnRjJztcbiAgLy8gRklYTUU6IHNlc3MtaWQgc2hvdWxkIGJlIGFuIE5UUCB0aW1lc3RhbXAuXG4gIHJldHVybiAndj0wXFxyXFxuJyArXG4gICAgICAnbz0nICsgdXNlciArICcgJyArIHNlc3Npb25JZCArICcgJyArIHZlcnNpb24gK1xuICAgICAgICAnIElOIElQNCAxMjcuMC4wLjFcXHJcXG4nICtcbiAgICAgICdzPS1cXHJcXG4nICtcbiAgICAgICd0PTAgMFxcclxcbic7XG59O1xuXG4vLyBHZXRzIHRoZSBkaXJlY3Rpb24gZnJvbSB0aGUgbWVkaWFTZWN0aW9uIG9yIHRoZSBzZXNzaW9ucGFydC5cblNEUFV0aWxzLmdldERpcmVjdGlvbiA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbiwgc2Vzc2lvbnBhcnQpIHtcbiAgLy8gTG9vayBmb3Igc2VuZHJlY3YsIHNlbmRvbmx5LCByZWN2b25seSwgaW5hY3RpdmUsIGRlZmF1bHQgdG8gc2VuZHJlY3YuXG4gIGNvbnN0IGxpbmVzID0gU0RQVXRpbHMuc3BsaXRMaW5lcyhtZWRpYVNlY3Rpb24pO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGxpbmVzLmxlbmd0aDsgaSsrKSB7XG4gICAgc3dpdGNoIChsaW5lc1tpXSkge1xuICAgICAgY2FzZSAnYT1zZW5kcmVjdic6XG4gICAgICBjYXNlICdhPXNlbmRvbmx5JzpcbiAgICAgIGNhc2UgJ2E9cmVjdm9ubHknOlxuICAgICAgY2FzZSAnYT1pbmFjdGl2ZSc6XG4gICAgICAgIHJldHVybiBsaW5lc1tpXS5zdWJzdHJpbmcoMik7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICAvLyBGSVhNRTogV2hhdCBzaG91bGQgaGFwcGVuIGhlcmU/XG4gICAgfVxuICB9XG4gIGlmIChzZXNzaW9ucGFydCkge1xuICAgIHJldHVybiBTRFBVdGlscy5nZXREaXJlY3Rpb24oc2Vzc2lvbnBhcnQpO1xuICB9XG4gIHJldHVybiAnc2VuZHJlY3YnO1xufTtcblxuU0RQVXRpbHMuZ2V0S2luZCA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbikge1xuICBjb25zdCBsaW5lcyA9IFNEUFV0aWxzLnNwbGl0TGluZXMobWVkaWFTZWN0aW9uKTtcbiAgY29uc3QgbWxpbmUgPSBsaW5lc1swXS5zcGxpdCgnICcpO1xuICByZXR1cm4gbWxpbmVbMF0uc3Vic3RyaW5nKDIpO1xufTtcblxuU0RQVXRpbHMuaXNSZWplY3RlZCA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbikge1xuICByZXR1cm4gbWVkaWFTZWN0aW9uLnNwbGl0KCcgJywgMilbMV0gPT09ICcwJztcbn07XG5cblNEUFV0aWxzLnBhcnNlTUxpbmUgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgY29uc3QgbGluZXMgPSBTRFBVdGlscy5zcGxpdExpbmVzKG1lZGlhU2VjdGlvbik7XG4gIGNvbnN0IHBhcnRzID0gbGluZXNbMF0uc3Vic3RyaW5nKDIpLnNwbGl0KCcgJyk7XG4gIHJldHVybiB7XG4gICAga2luZDogcGFydHNbMF0sXG4gICAgcG9ydDogcGFyc2VJbnQocGFydHNbMV0sIDEwKSxcbiAgICBwcm90b2NvbDogcGFydHNbMl0sXG4gICAgZm10OiBwYXJ0cy5zbGljZSgzKS5qb2luKCcgJyksXG4gIH07XG59O1xuXG5TRFBVdGlscy5wYXJzZU9MaW5lID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIGNvbnN0IGxpbmUgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdvPScpWzBdO1xuICBjb25zdCBwYXJ0cyA9IGxpbmUuc3Vic3RyaW5nKDIpLnNwbGl0KCcgJyk7XG4gIHJldHVybiB7XG4gICAgdXNlcm5hbWU6IHBhcnRzWzBdLFxuICAgIHNlc3Npb25JZDogcGFydHNbMV0sXG4gICAgc2Vzc2lvblZlcnNpb246IHBhcnNlSW50KHBhcnRzWzJdLCAxMCksXG4gICAgbmV0VHlwZTogcGFydHNbM10sXG4gICAgYWRkcmVzc1R5cGU6IHBhcnRzWzRdLFxuICAgIGFkZHJlc3M6IHBhcnRzWzVdLFxuICB9O1xufTtcblxuLy8gYSB2ZXJ5IG5haXZlIGludGVycHJldGF0aW9uIG9mIGEgdmFsaWQgU0RQLlxuU0RQVXRpbHMuaXNWYWxpZFNEUCA9IGZ1bmN0aW9uKGJsb2IpIHtcbiAgaWYgKHR5cGVvZiBibG9iICE9PSAnc3RyaW5nJyB8fCBibG9iLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBjb25zdCBsaW5lcyA9IFNEUFV0aWxzLnNwbGl0TGluZXMoYmxvYik7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgbGluZXMubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAobGluZXNbaV0ubGVuZ3RoIDwgMiB8fCBsaW5lc1tpXS5jaGFyQXQoMSkgIT09ICc9Jykge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICAvLyBUT0RPOiBjaGVjayB0aGUgbW9kaWZpZXIgYSBiaXQgbW9yZS5cbiAgfVxuICByZXR1cm4gdHJ1ZTtcbn07XG5cbi8vIEV4cG9zZSBwdWJsaWMgbWV0aG9kcy5cbmlmICh0eXBlb2YgbW9kdWxlID09PSAnb2JqZWN0Jykge1xuICBtb2R1bGUuZXhwb3J0cyA9IFNEUFV0aWxzO1xufVxuIiwiLy8gVGhlIG1vZHVsZSBjYWNoZVxudmFyIF9fd2VicGFja19tb2R1bGVfY2FjaGVfXyA9IHt9O1xuXG4vLyBUaGUgcmVxdWlyZSBmdW5jdGlvblxuZnVuY3Rpb24gX193ZWJwYWNrX3JlcXVpcmVfXyhtb2R1bGVJZCkge1xuXHQvLyBDaGVjayBpZiBtb2R1bGUgaXMgaW4gY2FjaGVcblx0dmFyIGNhY2hlZE1vZHVsZSA9IF9fd2VicGFja19tb2R1bGVfY2FjaGVfX1ttb2R1bGVJZF07XG5cdGlmIChjYWNoZWRNb2R1bGUgIT09IHVuZGVmaW5lZCkge1xuXHRcdHJldHVybiBjYWNoZWRNb2R1bGUuZXhwb3J0cztcblx0fVxuXHQvLyBDcmVhdGUgYSBuZXcgbW9kdWxlIChhbmQgcHV0IGl0IGludG8gdGhlIGNhY2hlKVxuXHR2YXIgbW9kdWxlID0gX193ZWJwYWNrX21vZHVsZV9jYWNoZV9fW21vZHVsZUlkXSA9IHtcblx0XHQvLyBubyBtb2R1bGUuaWQgbmVlZGVkXG5cdFx0Ly8gbm8gbW9kdWxlLmxvYWRlZCBuZWVkZWRcblx0XHRleHBvcnRzOiB7fVxuXHR9O1xuXG5cdC8vIEV4ZWN1dGUgdGhlIG1vZHVsZSBmdW5jdGlvblxuXHRfX3dlYnBhY2tfbW9kdWxlc19fW21vZHVsZUlkXShtb2R1bGUsIG1vZHVsZS5leHBvcnRzLCBfX3dlYnBhY2tfcmVxdWlyZV9fKTtcblxuXHQvLyBSZXR1cm4gdGhlIGV4cG9ydHMgb2YgdGhlIG1vZHVsZVxuXHRyZXR1cm4gbW9kdWxlLmV4cG9ydHM7XG59XG5cbiIsIiIsIi8vIHN0YXJ0dXBcbi8vIExvYWQgZW50cnkgbW9kdWxlIGFuZCByZXR1cm4gZXhwb3J0c1xuLy8gVGhpcyBlbnRyeSBtb2R1bGUgaXMgcmVmZXJlbmNlZCBieSBvdGhlciBtb2R1bGVzIHNvIGl0IGNhbid0IGJlIGlubGluZWRcbnZhciBfX3dlYnBhY2tfZXhwb3J0c19fID0gX193ZWJwYWNrX3JlcXVpcmVfXyhcIi4vc3JjL2luZGV4LmpzXCIpO1xuIiwiIl0sIm5hbWVzIjpbIm1qIiwicmVxdWlyZSIsIkphbnVzU2Vzc2lvbiIsInByb3RvdHlwZSIsInNlbmRPcmlnaW5hbCIsInNlbmQiLCJ0eXBlIiwic2lnbmFsIiwiY2F0Y2giLCJlIiwibWVzc2FnZSIsImluZGV4T2YiLCJjb25zb2xlIiwiZXJyb3IiLCJOQUYiLCJjb25uZWN0aW9uIiwiYWRhcHRlciIsInJlY29ubmVjdCIsInNkcFV0aWxzIiwiZGVidWciLCJsb2ciLCJ3YXJuIiwiaXNTYWZhcmkiLCJ0ZXN0IiwibmF2aWdhdG9yIiwidXNlckFnZW50IiwiU1VCU0NSSUJFX1RJTUVPVVRfTVMiLCJkZWJvdW5jZSIsImZuIiwiY3VyciIsIlByb21pc2UiLCJyZXNvbHZlIiwiYXJncyIsIkFycmF5Iiwic2xpY2UiLCJjYWxsIiwiYXJndW1lbnRzIiwidGhlbiIsIl8iLCJhcHBseSIsInJhbmRvbVVpbnQiLCJNYXRoIiwiZmxvb3IiLCJyYW5kb20iLCJOdW1iZXIiLCJNQVhfU0FGRV9JTlRFR0VSIiwidW50aWxEYXRhQ2hhbm5lbE9wZW4iLCJkYXRhQ2hhbm5lbCIsInJlamVjdCIsInJlYWR5U3RhdGUiLCJyZXNvbHZlciIsInJlamVjdG9yIiwiY2xlYXIiLCJyZW1vdmVFdmVudExpc3RlbmVyIiwiYWRkRXZlbnRMaXN0ZW5lciIsImlzSDI2NFZpZGVvU3VwcG9ydGVkIiwidmlkZW8iLCJkb2N1bWVudCIsImNyZWF0ZUVsZW1lbnQiLCJjYW5QbGF5VHlwZSIsIk9QVVNfUEFSQU1FVEVSUyIsInVzZWR0eCIsInN0ZXJlbyIsIkRFRkFVTFRfUEVFUl9DT05ORUNUSU9OX0NPTkZJRyIsImljZVNlcnZlcnMiLCJ1cmxzIiwiV1NfTk9STUFMX0NMT1NVUkUiLCJKYW51c0FkYXB0ZXIiLCJjb25zdHJ1Y3RvciIsInJvb20iLCJjbGllbnRJZCIsImpvaW5Ub2tlbiIsInNlcnZlclVybCIsIndlYlJ0Y09wdGlvbnMiLCJwZWVyQ29ubmVjdGlvbkNvbmZpZyIsIndzIiwic2Vzc2lvbiIsInJlbGlhYmxlVHJhbnNwb3J0IiwidW5yZWxpYWJsZVRyYW5zcG9ydCIsImluaXRpYWxSZWNvbm5lY3Rpb25EZWxheSIsInJlY29ubmVjdGlvbkRlbGF5IiwicmVjb25uZWN0aW9uVGltZW91dCIsIm1heFJlY29ubmVjdGlvbkF0dGVtcHRzIiwicmVjb25uZWN0aW9uQXR0ZW1wdHMiLCJpc1JlY29ubmVjdGluZyIsInB1Ymxpc2hlciIsIm9jY3VwYW50cyIsImxlZnRPY2N1cGFudHMiLCJTZXQiLCJtZWRpYVN0cmVhbXMiLCJsb2NhbE1lZGlhU3RyZWFtIiwicGVuZGluZ01lZGlhUmVxdWVzdHMiLCJNYXAiLCJibG9ja2VkQ2xpZW50cyIsImZyb3plblVwZGF0ZXMiLCJ0aW1lT2Zmc2V0cyIsInNlcnZlclRpbWVSZXF1ZXN0cyIsImF2Z1RpbWVPZmZzZXQiLCJvbldlYnNvY2tldE9wZW4iLCJiaW5kIiwib25XZWJzb2NrZXRDbG9zZSIsIm9uV2Vic29ja2V0TWVzc2FnZSIsIm9uRGF0YUNoYW5uZWxNZXNzYWdlIiwib25EYXRhIiwic2V0U2VydmVyVXJsIiwidXJsIiwic2V0QXBwIiwiYXBwIiwic2V0Um9vbSIsInJvb21OYW1lIiwic2V0Sm9pblRva2VuIiwic2V0Q2xpZW50SWQiLCJzZXRXZWJSdGNPcHRpb25zIiwib3B0aW9ucyIsInNldFBlZXJDb25uZWN0aW9uQ29uZmlnIiwic2V0U2VydmVyQ29ubmVjdExpc3RlbmVycyIsInN1Y2Nlc3NMaXN0ZW5lciIsImZhaWx1cmVMaXN0ZW5lciIsImNvbm5lY3RTdWNjZXNzIiwiY29ubmVjdEZhaWx1cmUiLCJzZXRSb29tT2NjdXBhbnRMaXN0ZW5lciIsIm9jY3VwYW50TGlzdGVuZXIiLCJvbk9jY3VwYW50c0NoYW5nZWQiLCJzZXREYXRhQ2hhbm5lbExpc3RlbmVycyIsIm9wZW5MaXN0ZW5lciIsImNsb3NlZExpc3RlbmVyIiwibWVzc2FnZUxpc3RlbmVyIiwib25PY2N1cGFudENvbm5lY3RlZCIsIm9uT2NjdXBhbnREaXNjb25uZWN0ZWQiLCJvbk9jY3VwYW50TWVzc2FnZSIsInNldFJlY29ubmVjdGlvbkxpc3RlbmVycyIsInJlY29ubmVjdGluZ0xpc3RlbmVyIiwicmVjb25uZWN0ZWRMaXN0ZW5lciIsInJlY29ubmVjdGlvbkVycm9yTGlzdGVuZXIiLCJvblJlY29ubmVjdGluZyIsIm9uUmVjb25uZWN0ZWQiLCJvblJlY29ubmVjdGlvbkVycm9yIiwic2V0RXZlbnRMb29wcyIsImxvb3BzIiwiY29ubmVjdCIsImxvY2F0aW9uIiwicHJvdG9jb2wiLCJob3N0Iiwid2Vic29ja2V0Q29ubmVjdGlvbiIsIldlYlNvY2tldCIsInRpbWVvdXRNcyIsIndlYnNvY2tldENvbm5lY3Rpb25Qcm9taXNlIiwid3NPbk9wZW4iLCJhbGwiLCJ1cGRhdGVUaW1lT2Zmc2V0IiwiZGlzY29ubmVjdCIsImNsZWFyVGltZW91dCIsInJlbW92ZUFsbE9jY3VwYW50cyIsImNvbm4iLCJjbG9zZSIsImRpc3Bvc2UiLCJkZWxheWVkUmVjb25uZWN0VGltZW91dCIsImlzRGlzY29ubmVjdGVkIiwiY3JlYXRlIiwiY3JlYXRlUHVibGlzaGVyIiwiYWRkT2NjdXBhbnRQcm9taXNlcyIsImkiLCJpbml0aWFsT2NjdXBhbnRzIiwibGVuZ3RoIiwib2NjdXBhbnRJZCIsInB1c2giLCJhZGRPY2N1cGFudCIsImV2ZW50IiwiY29kZSIsInNldFRpbWVvdXQiLCJFcnJvciIsInBlcmZvcm1EZWxheWVkUmVjb25uZWN0IiwicmVjZWl2ZSIsIkpTT04iLCJwYXJzZSIsImRhdGEiLCJyZW1vdmVPY2N1cGFudCIsImRlbGV0ZSIsInN1YnNjcmliZXIiLCJjcmVhdGVTdWJzY3JpYmVyIiwic2V0TWVkaWFTdHJlYW0iLCJtZWRpYVN0cmVhbSIsIk9iamVjdCIsImdldE93blByb3BlcnR5TmFtZXMiLCJhZGQiLCJoYXMiLCJtc2ciLCJnZXQiLCJhdWRpbyIsImFzc29jaWF0ZSIsImhhbmRsZSIsImV2Iiwic2VuZFRyaWNrbGUiLCJjYW5kaWRhdGUiLCJpY2VDb25uZWN0aW9uU3RhdGUiLCJvZmZlciIsImNyZWF0ZU9mZmVyIiwiY29uZmlndXJlUHVibGlzaGVyU2RwIiwiZml4U2FmYXJpSWNlVUZyYWciLCJsb2NhbCIsIm8iLCJzZXRMb2NhbERlc2NyaXB0aW9uIiwicmVtb3RlIiwiaiIsInNlbmRKc2VwIiwiciIsInNldFJlbW90ZURlc2NyaXB0aW9uIiwianNlcCIsIm9uIiwiYW5zd2VyIiwiY29uZmlndXJlU3Vic2NyaWJlclNkcCIsImNyZWF0ZUFuc3dlciIsImEiLCJKYW51c1BsdWdpbkhhbmRsZSIsIlJUQ1BlZXJDb25uZWN0aW9uIiwiYXR0YWNoIiwicGFyc2VJbnQiLCJ1bmRlZmluZWQiLCJ3ZWJydGN1cCIsInJlbGlhYmxlQ2hhbm5lbCIsImNyZWF0ZURhdGFDaGFubmVsIiwib3JkZXJlZCIsInVucmVsaWFibGVDaGFubmVsIiwibWF4UmV0cmFuc21pdHMiLCJnZXRUcmFja3MiLCJmb3JFYWNoIiwidHJhY2siLCJhZGRUcmFjayIsInBsdWdpbmRhdGEiLCJyb29tX2lkIiwidXNlcl9pZCIsImJvZHkiLCJkaXNwYXRjaEV2ZW50IiwiQ3VzdG9tRXZlbnQiLCJkZXRhaWwiLCJieSIsInNlbmRKb2luIiwibm90aWZpY2F0aW9ucyIsInN1Y2Nlc3MiLCJlcnIiLCJyZXNwb25zZSIsInVzZXJzIiwiaW5jbHVkZXMiLCJzZHAiLCJyZXBsYWNlIiwibGluZSIsInB0IiwicGFyYW1ldGVycyIsImFzc2lnbiIsInBhcnNlRm10cCIsIndyaXRlRm10cCIsInBheWxvYWRUeXBlIiwibWF4UmV0cmllcyIsIndlYnJ0Y0ZhaWxlZCIsImxlZnRJbnRlcnZhbCIsInNldEludGVydmFsIiwiY2xlYXJJbnRlcnZhbCIsInRpbWVvdXQiLCJtZWRpYSIsIl9pT1NIYWNrRGVsYXllZEluaXRpYWxQZWVyIiwiTWVkaWFTdHJlYW0iLCJyZWNlaXZlcnMiLCJnZXRSZWNlaXZlcnMiLCJyZWNlaXZlciIsInN1YnNjcmliZSIsInNlbmRNZXNzYWdlIiwia2luZCIsInRva2VuIiwidG9nZ2xlRnJlZXplIiwiZnJvemVuIiwidW5mcmVlemUiLCJmcmVlemUiLCJmbHVzaFBlbmRpbmdVcGRhdGVzIiwiZGF0YUZvclVwZGF0ZU11bHRpTWVzc2FnZSIsIm5ldHdvcmtJZCIsImwiLCJkIiwiZ2V0UGVuZGluZ0RhdGEiLCJkYXRhVHlwZSIsIm93bmVyIiwiZ2V0UGVuZGluZ0RhdGFGb3JOZXR3b3JrSWQiLCJzb3VyY2UiLCJzdG9yZU1lc3NhZ2UiLCJzdG9yZVNpbmdsZU1lc3NhZ2UiLCJpbmRleCIsInNldCIsInN0b3JlZE1lc3NhZ2UiLCJzdG9yZWREYXRhIiwiaXNPdXRkYXRlZE1lc3NhZ2UiLCJsYXN0T3duZXJUaW1lIiwiaXNDb250ZW1wb3JhbmVvdXNNZXNzYWdlIiwiY3JlYXRlZFdoaWxlRnJvemVuIiwiaXNGaXJzdFN5bmMiLCJjb21wb25lbnRzIiwiZW5hYmxlZCIsInNob3VsZFN0YXJ0Q29ubmVjdGlvblRvIiwiY2xpZW50Iiwic3RhcnRTdHJlYW1Db25uZWN0aW9uIiwiY2xvc2VTdHJlYW1Db25uZWN0aW9uIiwiZ2V0Q29ubmVjdFN0YXR1cyIsImFkYXB0ZXJzIiwiSVNfQ09OTkVDVEVEIiwiTk9UX0NPTk5FQ1RFRCIsImNsaWVudFNlbnRUaW1lIiwiRGF0ZSIsIm5vdyIsInJlcyIsImZldGNoIiwiaHJlZiIsIm1ldGhvZCIsImNhY2hlIiwicHJlY2lzaW9uIiwic2VydmVyUmVjZWl2ZWRUaW1lIiwiaGVhZGVycyIsImdldFRpbWUiLCJjbGllbnRSZWNlaXZlZFRpbWUiLCJzZXJ2ZXJUaW1lIiwidGltZU9mZnNldCIsInJlZHVjZSIsImFjYyIsIm9mZnNldCIsImdldFNlcnZlclRpbWUiLCJnZXRNZWRpYVN0cmVhbSIsImF1ZGlvUHJvbWlzZSIsInZpZGVvUHJvbWlzZSIsInByb21pc2UiLCJzdHJlYW0iLCJhdWRpb1N0cmVhbSIsImdldEF1ZGlvVHJhY2tzIiwidmlkZW9TdHJlYW0iLCJnZXRWaWRlb1RyYWNrcyIsImdldExvY2FsTWVkaWFTdHJlYW0iLCJzZXRMb2NhbE1lZGlhU3RyZWFtIiwiZXhpc3RpbmdTZW5kZXJzIiwiZ2V0U2VuZGVycyIsIm5ld1NlbmRlcnMiLCJ0cmFja3MiLCJ0Iiwic2VuZGVyIiwiZmluZCIsInMiLCJyZXBsYWNlVHJhY2siLCJyZW1vdmVUcmFjayIsImVuYWJsZU1pY3JvcGhvbmUiLCJzZW5kRGF0YSIsInN0cmluZ2lmeSIsIndob20iLCJzZW5kRGF0YUd1YXJhbnRlZWQiLCJicm9hZGNhc3REYXRhIiwiYnJvYWRjYXN0RGF0YUd1YXJhbnRlZWQiLCJraWNrIiwicGVybXNUb2tlbiIsImJsb2NrIiwidW5ibG9jayIsInJlZ2lzdGVyIiwibW9kdWxlIiwiZXhwb3J0cyJdLCJzb3VyY2VSb290IjoiIn0=