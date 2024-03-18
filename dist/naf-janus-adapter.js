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
var debug = __webpack_require__(/*! debug */ "./node_modules/debug/src/browser.js")("naf-janus-adapter:debug");
var warn = __webpack_require__(/*! debug */ "./node_modules/debug/src/browser.js")("naf-janus-adapter:warn");
var error = __webpack_require__(/*! debug */ "./node_modules/debug/src/browser.js")("naf-janus-adapter:error");
var isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
const SUBSCRIBE_TIMEOUT_MS = 15000;
const AVAILABLE_OCCUPANTS_THRESHOLD = 5;
const MAX_SUBSCRIBE_DELAY = 5000;
function randomDelay(min, max) {
  return new Promise(resolve => {
    const delay = Math.random() * (max - min) + min;
    setTimeout(resolve, delay);
  });
}
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
    this.publisher = null;
    this.occupantIds = [];
    this.occupants = {};
    this.mediaStreams = {};
    this.localMediaStream = null;
    this.pendingMediaRequests = new Map();
    this.pendingOccupants = new Set();
    this.availableOccupants = [];
    this.requestedOccupants = null;
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
    debug(`connecting to ${this.serverUrl}`);
    const websocketConnection = new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.serverUrl, "janus-protocol");
      this.session = new mj.JanusSession(this.ws.send.bind(this.ws), {
        timeoutMs: 40000
      });
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
    for (let i = 0; i < this.publisher.initialOccupants.length; i++) {
      const occupantId = this.publisher.initialOccupants[i];
      if (occupantId === this.clientId) continue; // Happens during non-graceful reconnects due to zombie sessions
      this.addAvailableOccupant(occupantId);
    }
    this.syncOccupants();
  }
  onWebsocketClose(event) {
    // The connection was closed successfully. Don't try to reconnect.
    if (event.code === WS_NORMAL_CLOSURE) {
      return;
    }
    console.warn("Janus websocket closed unexpectedly.");
    if (this.onReconnecting) {
      this.onReconnecting(this.reconnectionDelay);
    }
    this.reconnectionTimeout = setTimeout(() => this.reconnect(), this.reconnectionDelay);
  }
  reconnect() {
    // Dispose of all networked entities and other resources tied to the session.
    this.disconnect();
    this.connect().then(() => {
      this.reconnectionDelay = this.initialReconnectionDelay;
      this.reconnectionAttempts = 0;
      if (this.onReconnected) {
        this.onReconnected();
      }
    }).catch(error => {
      this.reconnectionDelay += 1000;
      this.reconnectionAttempts++;
      if (this.reconnectionAttempts > this.maxReconnectionAttempts && this.onReconnectionError) {
        return this.onReconnectionError(new Error("Connection could not be reestablished, exceeded maximum number of reconnection attempts."));
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
  addAvailableOccupant(occupantId) {
    if (this.availableOccupants.indexOf(occupantId) === -1) {
      this.availableOccupants.push(occupantId);
    }
  }
  removeAvailableOccupant(occupantId) {
    const idx = this.availableOccupants.indexOf(occupantId);
    if (idx !== -1) {
      this.availableOccupants.splice(idx, 1);
    }
  }
  syncOccupants(requestedOccupants) {
    if (requestedOccupants) {
      this.requestedOccupants = requestedOccupants;
    }
    if (!this.requestedOccupants) {
      return;
    }

    // Add any requested, available, and non-pending occupants.
    for (let i = 0; i < this.requestedOccupants.length; i++) {
      const occupantId = this.requestedOccupants[i];
      if (!this.occupants[occupantId] && this.availableOccupants.indexOf(occupantId) !== -1 && !this.pendingOccupants.has(occupantId)) {
        this.addOccupant(occupantId);
      }
    }

    // Remove any unrequested and currently added occupants.
    for (let j = 0; j < this.availableOccupants.length; j++) {
      const occupantId = this.availableOccupants[j];
      if (this.occupants[occupantId] && this.requestedOccupants.indexOf(occupantId) === -1) {
        this.removeOccupant(occupantId);
      }
    }

    // Call the Networked AFrame callbacks for the updated occupants list.
    this.onOccupantsChanged(this.occupants);
  }
  async addOccupant(occupantId) {
    this.pendingOccupants.add(occupantId);
    const availableOccupantsCount = this.availableOccupants.length;
    if (availableOccupantsCount > AVAILABLE_OCCUPANTS_THRESHOLD) {
      await randomDelay(0, MAX_SUBSCRIBE_DELAY);
    }
    const subscriber = await this.createSubscriber(occupantId);
    if (subscriber) {
      if (!this.pendingOccupants.has(occupantId)) {
        subscriber.conn.close();
      } else {
        this.pendingOccupants.delete(occupantId);
        this.occupantIds.push(occupantId);
        this.occupants[occupantId] = subscriber;
        this.setMediaStream(occupantId, subscriber.mediaStream);

        // Call the Networked AFrame callbacks for the new occupant.
        this.onOccupantConnected(occupantId);
      }
    }
  }
  removeAllOccupants() {
    this.pendingOccupants.clear();
    for (let i = this.occupantIds.length - 1; i >= 0; i--) {
      this.removeOccupant(this.occupantIds[i]);
    }
  }
  removeOccupant(occupantId) {
    this.pendingOccupants.delete(occupantId);
    if (this.occupants[occupantId]) {
      // Close the subscriber peer connection. Which also detaches the plugin handle.
      this.occupants[occupantId].conn.close();
      delete this.occupants[occupantId];
      this.occupantIds.splice(this.occupantIds.indexOf(occupantId), 1);
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
        this.addAvailableOccupant(data.user_id);
        this.syncOccupants();
      } else if (data.event == "leave" && data.room_id == this.room) {
        this.removeAvailableOccupant(data.user_id);
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
    if (this.availableOccupants.indexOf(occupantId) === -1) {
      console.warn(occupantId + ": cancelled occupant connection, occupant left before subscription negotation.");
      return null;
    }
    var handle = new mj.JanusPluginHandle(this.session);
    var conn = new RTCPeerConnection(this.peerConnectionConfig || DEFAULT_PEER_CONNECTION_CONFIG);
    debug(occupantId + ": sub waiting for sfu");
    await handle.attach("janus.plugin.sfu", this.loops ? parseInt(occupantId) % this.loops : undefined);
    this.associate(conn, handle);
    debug(occupantId + ": sub waiting for join");
    if (this.availableOccupants.indexOf(occupantId) === -1) {
      conn.close();
      console.warn(occupantId + ": cancelled occupant connection, occupant left after attach");
      return null;
    }
    let webrtcFailed = false;
    const webrtcup = new Promise(resolve => {
      const leftInterval = setInterval(() => {
        if (this.availableOccupants.indexOf(occupantId) === -1) {
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
    if (this.availableOccupants.indexOf(occupantId) === -1) {
      conn.close();
      console.warn(occupantId + ": cancelled occupant connection, occupant left after join");
      return null;
    }
    debug(occupantId + ": sub waiting for webrtcup");
    await webrtcup;
    if (this.availableOccupants.indexOf(occupantId) === -1) {
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

            // Workaround https://bugzilla.mozilla.org/show_bug.cgi?id=1576771
            if (t.kind === "video" && t.enabled && navigator.userAgent.toLowerCase().indexOf('firefox') > -1) {
              t.enabled = false;
              setTimeout(() => t.enabled = true, 1000);
            }
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

/***/ "./node_modules/debug/src/browser.js":
/*!*******************************************!*\
  !*** ./node_modules/debug/src/browser.js ***!
  \*******************************************/
/***/ ((module, exports, __webpack_require__) => {

/* eslint-env browser */

/**
 * This is the web browser implementation of `debug()`.
 */

exports.formatArgs = formatArgs;
exports.save = save;
exports.load = load;
exports.useColors = useColors;
exports.storage = localstorage();
exports.destroy = (() => {
	let warned = false;

	return () => {
		if (!warned) {
			warned = true;
			console.warn('Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.');
		}
	};
})();

/**
 * Colors.
 */

exports.colors = [
	'#0000CC',
	'#0000FF',
	'#0033CC',
	'#0033FF',
	'#0066CC',
	'#0066FF',
	'#0099CC',
	'#0099FF',
	'#00CC00',
	'#00CC33',
	'#00CC66',
	'#00CC99',
	'#00CCCC',
	'#00CCFF',
	'#3300CC',
	'#3300FF',
	'#3333CC',
	'#3333FF',
	'#3366CC',
	'#3366FF',
	'#3399CC',
	'#3399FF',
	'#33CC00',
	'#33CC33',
	'#33CC66',
	'#33CC99',
	'#33CCCC',
	'#33CCFF',
	'#6600CC',
	'#6600FF',
	'#6633CC',
	'#6633FF',
	'#66CC00',
	'#66CC33',
	'#9900CC',
	'#9900FF',
	'#9933CC',
	'#9933FF',
	'#99CC00',
	'#99CC33',
	'#CC0000',
	'#CC0033',
	'#CC0066',
	'#CC0099',
	'#CC00CC',
	'#CC00FF',
	'#CC3300',
	'#CC3333',
	'#CC3366',
	'#CC3399',
	'#CC33CC',
	'#CC33FF',
	'#CC6600',
	'#CC6633',
	'#CC9900',
	'#CC9933',
	'#CCCC00',
	'#CCCC33',
	'#FF0000',
	'#FF0033',
	'#FF0066',
	'#FF0099',
	'#FF00CC',
	'#FF00FF',
	'#FF3300',
	'#FF3333',
	'#FF3366',
	'#FF3399',
	'#FF33CC',
	'#FF33FF',
	'#FF6600',
	'#FF6633',
	'#FF9900',
	'#FF9933',
	'#FFCC00',
	'#FFCC33'
];

/**
 * Currently only WebKit-based Web Inspectors, Firefox >= v31,
 * and the Firebug extension (any Firefox version) are known
 * to support "%c" CSS customizations.
 *
 * TODO: add a `localStorage` variable to explicitly enable/disable colors
 */

// eslint-disable-next-line complexity
function useColors() {
	// NB: In an Electron preload script, document will be defined but not fully
	// initialized. Since we know we're in Chrome, we'll just detect this case
	// explicitly
	if (typeof window !== 'undefined' && window.process && (window.process.type === 'renderer' || window.process.__nwjs)) {
		return true;
	}

	// Internet Explorer and Edge do not support colors.
	if (typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/)) {
		return false;
	}

	// Is webkit? http://stackoverflow.com/a/16459606/376773
	// document is undefined in react-native: https://github.com/facebook/react-native/pull/1632
	return (typeof document !== 'undefined' && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance) ||
		// Is firebug? http://stackoverflow.com/a/398120/376773
		(typeof window !== 'undefined' && window.console && (window.console.firebug || (window.console.exception && window.console.table))) ||
		// Is firefox >= v31?
		// https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
		(typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/) && parseInt(RegExp.$1, 10) >= 31) ||
		// Double check webkit in userAgent just in case we are in a worker
		(typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/));
}

/**
 * Colorize log arguments if enabled.
 *
 * @api public
 */

function formatArgs(args) {
	args[0] = (this.useColors ? '%c' : '') +
		this.namespace +
		(this.useColors ? ' %c' : ' ') +
		args[0] +
		(this.useColors ? '%c ' : ' ') +
		'+' + module.exports.humanize(this.diff);

	if (!this.useColors) {
		return;
	}

	const c = 'color: ' + this.color;
	args.splice(1, 0, c, 'color: inherit');

	// The final "%c" is somewhat tricky, because there could be other
	// arguments passed either before or after the %c, so we need to
	// figure out the correct index to insert the CSS into
	let index = 0;
	let lastC = 0;
	args[0].replace(/%[a-zA-Z%]/g, match => {
		if (match === '%%') {
			return;
		}
		index++;
		if (match === '%c') {
			// We only are interested in the *last* %c
			// (the user may have provided their own)
			lastC = index;
		}
	});

	args.splice(lastC, 0, c);
}

/**
 * Invokes `console.debug()` when available.
 * No-op when `console.debug` is not a "function".
 * If `console.debug` is not available, falls back
 * to `console.log`.
 *
 * @api public
 */
exports.log = console.debug || console.log || (() => {});

/**
 * Save `namespaces`.
 *
 * @param {String} namespaces
 * @api private
 */
function save(namespaces) {
	try {
		if (namespaces) {
			exports.storage.setItem('debug', namespaces);
		} else {
			exports.storage.removeItem('debug');
		}
	} catch (error) {
		// Swallow
		// XXX (@Qix-) should we be logging these?
	}
}

/**
 * Load `namespaces`.
 *
 * @return {String} returns the previously persisted debug modes
 * @api private
 */
function load() {
	let r;
	try {
		r = exports.storage.getItem('debug');
	} catch (error) {
		// Swallow
		// XXX (@Qix-) should we be logging these?
	}

	// If debug isn't set in LS, and we're in Electron, try to load $DEBUG
	if (!r && typeof process !== 'undefined' && 'env' in process) {
		r = process.env.DEBUG;
	}

	return r;
}

/**
 * Localstorage attempts to return the localstorage.
 *
 * This is necessary because safari throws
 * when a user disables cookies/localstorage
 * and you attempt to access it.
 *
 * @return {LocalStorage}
 * @api private
 */

function localstorage() {
	try {
		// TVMLKit (Apple TV JS Runtime) does not have a window object, just localStorage in the global context
		// The Browser also has localStorage in the global context.
		return localStorage;
	} catch (error) {
		// Swallow
		// XXX (@Qix-) should we be logging these?
	}
}

module.exports = __webpack_require__(/*! ./common */ "./node_modules/debug/src/common.js")(exports);

const {formatters} = module.exports;

/**
 * Map %j to `JSON.stringify()`, since no Web Inspectors do that by default.
 */

formatters.j = function (v) {
	try {
		return JSON.stringify(v);
	} catch (error) {
		return '[UnexpectedJSONParseError]: ' + error.message;
	}
};


/***/ }),

/***/ "./node_modules/debug/src/common.js":
/*!******************************************!*\
  !*** ./node_modules/debug/src/common.js ***!
  \******************************************/
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {


/**
 * This is the common logic for both the Node.js and web browser
 * implementations of `debug()`.
 */

function setup(env) {
	createDebug.debug = createDebug;
	createDebug.default = createDebug;
	createDebug.coerce = coerce;
	createDebug.disable = disable;
	createDebug.enable = enable;
	createDebug.enabled = enabled;
	createDebug.humanize = __webpack_require__(/*! ms */ "./node_modules/ms/index.js");
	createDebug.destroy = destroy;

	Object.keys(env).forEach(key => {
		createDebug[key] = env[key];
	});

	/**
	* The currently active debug mode names, and names to skip.
	*/

	createDebug.names = [];
	createDebug.skips = [];

	/**
	* Map of special "%n" handling functions, for the debug "format" argument.
	*
	* Valid key names are a single, lower or upper-case letter, i.e. "n" and "N".
	*/
	createDebug.formatters = {};

	/**
	* Selects a color for a debug namespace
	* @param {String} namespace The namespace string for the debug instance to be colored
	* @return {Number|String} An ANSI color code for the given namespace
	* @api private
	*/
	function selectColor(namespace) {
		let hash = 0;

		for (let i = 0; i < namespace.length; i++) {
			hash = ((hash << 5) - hash) + namespace.charCodeAt(i);
			hash |= 0; // Convert to 32bit integer
		}

		return createDebug.colors[Math.abs(hash) % createDebug.colors.length];
	}
	createDebug.selectColor = selectColor;

	/**
	* Create a debugger with the given `namespace`.
	*
	* @param {String} namespace
	* @return {Function}
	* @api public
	*/
	function createDebug(namespace) {
		let prevTime;
		let enableOverride = null;
		let namespacesCache;
		let enabledCache;

		function debug(...args) {
			// Disabled?
			if (!debug.enabled) {
				return;
			}

			const self = debug;

			// Set `diff` timestamp
			const curr = Number(new Date());
			const ms = curr - (prevTime || curr);
			self.diff = ms;
			self.prev = prevTime;
			self.curr = curr;
			prevTime = curr;

			args[0] = createDebug.coerce(args[0]);

			if (typeof args[0] !== 'string') {
				// Anything else let's inspect with %O
				args.unshift('%O');
			}

			// Apply any `formatters` transformations
			let index = 0;
			args[0] = args[0].replace(/%([a-zA-Z%])/g, (match, format) => {
				// If we encounter an escaped % then don't increase the array index
				if (match === '%%') {
					return '%';
				}
				index++;
				const formatter = createDebug.formatters[format];
				if (typeof formatter === 'function') {
					const val = args[index];
					match = formatter.call(self, val);

					// Now we need to remove `args[index]` since it's inlined in the `format`
					args.splice(index, 1);
					index--;
				}
				return match;
			});

			// Apply env-specific formatting (colors, etc.)
			createDebug.formatArgs.call(self, args);

			const logFn = self.log || createDebug.log;
			logFn.apply(self, args);
		}

		debug.namespace = namespace;
		debug.useColors = createDebug.useColors();
		debug.color = createDebug.selectColor(namespace);
		debug.extend = extend;
		debug.destroy = createDebug.destroy; // XXX Temporary. Will be removed in the next major release.

		Object.defineProperty(debug, 'enabled', {
			enumerable: true,
			configurable: false,
			get: () => {
				if (enableOverride !== null) {
					return enableOverride;
				}
				if (namespacesCache !== createDebug.namespaces) {
					namespacesCache = createDebug.namespaces;
					enabledCache = createDebug.enabled(namespace);
				}

				return enabledCache;
			},
			set: v => {
				enableOverride = v;
			}
		});

		// Env-specific initialization logic for debug instances
		if (typeof createDebug.init === 'function') {
			createDebug.init(debug);
		}

		return debug;
	}

	function extend(namespace, delimiter) {
		const newDebug = createDebug(this.namespace + (typeof delimiter === 'undefined' ? ':' : delimiter) + namespace);
		newDebug.log = this.log;
		return newDebug;
	}

	/**
	* Enables a debug mode by namespaces. This can include modes
	* separated by a colon and wildcards.
	*
	* @param {String} namespaces
	* @api public
	*/
	function enable(namespaces) {
		createDebug.save(namespaces);
		createDebug.namespaces = namespaces;

		createDebug.names = [];
		createDebug.skips = [];

		let i;
		const split = (typeof namespaces === 'string' ? namespaces : '').split(/[\s,]+/);
		const len = split.length;

		for (i = 0; i < len; i++) {
			if (!split[i]) {
				// ignore empty strings
				continue;
			}

			namespaces = split[i].replace(/\*/g, '.*?');

			if (namespaces[0] === '-') {
				createDebug.skips.push(new RegExp('^' + namespaces.slice(1) + '$'));
			} else {
				createDebug.names.push(new RegExp('^' + namespaces + '$'));
			}
		}
	}

	/**
	* Disable debug output.
	*
	* @return {String} namespaces
	* @api public
	*/
	function disable() {
		const namespaces = [
			...createDebug.names.map(toNamespace),
			...createDebug.skips.map(toNamespace).map(namespace => '-' + namespace)
		].join(',');
		createDebug.enable('');
		return namespaces;
	}

	/**
	* Returns true if the given mode name is enabled, false otherwise.
	*
	* @param {String} name
	* @return {Boolean}
	* @api public
	*/
	function enabled(name) {
		if (name[name.length - 1] === '*') {
			return true;
		}

		let i;
		let len;

		for (i = 0, len = createDebug.skips.length; i < len; i++) {
			if (createDebug.skips[i].test(name)) {
				return false;
			}
		}

		for (i = 0, len = createDebug.names.length; i < len; i++) {
			if (createDebug.names[i].test(name)) {
				return true;
			}
		}

		return false;
	}

	/**
	* Convert regexp to namespace
	*
	* @param {RegExp} regxep
	* @return {String} namespace
	* @api private
	*/
	function toNamespace(regexp) {
		return regexp.toString()
			.substring(2, regexp.toString().length - 2)
			.replace(/\.\*\?$/, '*');
	}

	/**
	* Coerce `val`.
	*
	* @param {Mixed} val
	* @return {Mixed}
	* @api private
	*/
	function coerce(val) {
		if (val instanceof Error) {
			return val.stack || val.message;
		}
		return val;
	}

	/**
	* XXX DO NOT USE. This is a temporary stub function.
	* XXX It WILL be removed in the next major release.
	*/
	function destroy() {
		console.warn('Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.');
	}

	createDebug.enable(createDebug.load());

	return createDebug;
}

module.exports = setup;


/***/ }),

/***/ "./node_modules/ms/index.js":
/*!**********************************!*\
  !*** ./node_modules/ms/index.js ***!
  \**********************************/
/***/ ((module) => {

/**
 * Helpers.
 */

var s = 1000;
var m = s * 60;
var h = m * 60;
var d = h * 24;
var w = d * 7;
var y = d * 365.25;

/**
 * Parse or format the given `val`.
 *
 * Options:
 *
 *  - `long` verbose formatting [false]
 *
 * @param {String|Number} val
 * @param {Object} [options]
 * @throws {Error} throw an error if val is not a non-empty string or a number
 * @return {String|Number}
 * @api public
 */

module.exports = function(val, options) {
  options = options || {};
  var type = typeof val;
  if (type === 'string' && val.length > 0) {
    return parse(val);
  } else if (type === 'number' && isFinite(val)) {
    return options.long ? fmtLong(val) : fmtShort(val);
  }
  throw new Error(
    'val is not a non-empty string or a valid number. val=' +
      JSON.stringify(val)
  );
};

/**
 * Parse the given `str` and return milliseconds.
 *
 * @param {String} str
 * @return {Number}
 * @api private
 */

function parse(str) {
  str = String(str);
  if (str.length > 100) {
    return;
  }
  var match = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(
    str
  );
  if (!match) {
    return;
  }
  var n = parseFloat(match[1]);
  var type = (match[2] || 'ms').toLowerCase();
  switch (type) {
    case 'years':
    case 'year':
    case 'yrs':
    case 'yr':
    case 'y':
      return n * y;
    case 'weeks':
    case 'week':
    case 'w':
      return n * w;
    case 'days':
    case 'day':
    case 'd':
      return n * d;
    case 'hours':
    case 'hour':
    case 'hrs':
    case 'hr':
    case 'h':
      return n * h;
    case 'minutes':
    case 'minute':
    case 'mins':
    case 'min':
    case 'm':
      return n * m;
    case 'seconds':
    case 'second':
    case 'secs':
    case 'sec':
    case 's':
      return n * s;
    case 'milliseconds':
    case 'millisecond':
    case 'msecs':
    case 'msec':
    case 'ms':
      return n;
    default:
      return undefined;
  }
}

/**
 * Short format for `ms`.
 *
 * @param {Number} ms
 * @return {String}
 * @api private
 */

function fmtShort(ms) {
  var msAbs = Math.abs(ms);
  if (msAbs >= d) {
    return Math.round(ms / d) + 'd';
  }
  if (msAbs >= h) {
    return Math.round(ms / h) + 'h';
  }
  if (msAbs >= m) {
    return Math.round(ms / m) + 'm';
  }
  if (msAbs >= s) {
    return Math.round(ms / s) + 's';
  }
  return ms + 'ms';
}

/**
 * Long format for `ms`.
 *
 * @param {Number} ms
 * @return {String}
 * @api private
 */

function fmtLong(ms) {
  var msAbs = Math.abs(ms);
  if (msAbs >= d) {
    return plural(ms, msAbs, d, 'day');
  }
  if (msAbs >= h) {
    return plural(ms, msAbs, h, 'hour');
  }
  if (msAbs >= m) {
    return plural(ms, msAbs, m, 'minute');
  }
  if (msAbs >= s) {
    return plural(ms, msAbs, s, 'second');
  }
  return ms + ' ms';
}

/**
 * Pluralization helper.
 */

function plural(ms, msAbs, n, name) {
  var isPlural = msAbs >= n * 1.5;
  return Math.round(ms / n) + ' ' + name + (isPlural ? 's' : '');
}


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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,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QTtBQUNBO0FBQ0E7QUFDQSxDQUFDOztBQUVEO0FBQ0E7QUFDQTs7QUFFQSxjQUFjO0FBQ2Q7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxFQUFFOztBQUVGO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLFdBQVcsNENBQTRDOztBQUV2RDtBQUNBO0FBQ0E7QUFDQSxXQUFXLFFBQVE7QUFDbkI7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0Es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QTs7QUFFQTtBQUNBOztBQUVBOzs7Ozs7Ozs7OztBQ2pSQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsV0FBVyxlQUFlO0FBQzFCLFdBQVcsUUFBUTtBQUNuQixZQUFZLE9BQU87QUFDbkIsWUFBWTtBQUNaO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLElBQUk7QUFDSjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQSxXQUFXLFFBQVE7QUFDbkIsWUFBWTtBQUNaO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQSxXQUFXLFFBQVE7QUFDbkIsWUFBWTtBQUNaO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0EsV0FBVyxRQUFRO0FBQ25CLFlBQVk7QUFDWjtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTs7Ozs7Ozs7Ozs7O0FDaktBO0FBQ2E7O0FBRWI7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsSUFBSTtBQUNKO0FBQ0E7O0FBRUE7QUFDQTtBQUNBLGdCQUFnQixvQkFBb0I7QUFDcEM7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxrQkFBa0Isa0JBQWtCO0FBQ3BDO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSx3Q0FBd0M7QUFDeEM7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBLElBQUk7QUFDSjtBQUNBLElBQUk7QUFDSjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7O0FBRUE7QUFDQSw2Q0FBNkM7QUFDN0M7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0Esb0JBQW9CO0FBQ3BCLDJCQUEyQjtBQUMzQjtBQUNBO0FBQ0E7QUFDQSw4REFBOEQ7QUFDOUQsa0JBQWtCLGtCQUFrQjtBQUNwQztBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLFFBQVE7QUFDUjtBQUNBO0FBQ0EsS0FBSztBQUNMLGlEQUFpRDtBQUNqRDtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsS0FBSztBQUNMO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsSUFBSTtBQUNKO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxHQUFHO0FBQ0g7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxrQkFBa0Isa0JBQWtCLE9BQU87QUFDM0M7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEdBQUc7QUFDSDtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLE9BQU87QUFDUDtBQUNBO0FBQ0E7QUFDQSxLQUFLO0FBQ0wsR0FBRztBQUNIO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0EsNkNBQTZDO0FBQzdDO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEdBQUc7O0FBRUg7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsR0FBRztBQUNIO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxHQUFHO0FBQ0g7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBLEtBQUs7QUFDTDtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQSxLQUFLO0FBQ0w7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0Esd0JBQXdCO0FBQ3hCO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxHQUFHO0FBQ0g7QUFDQTtBQUNBO0FBQ0EsS0FBSztBQUNMOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxNQUFNO0FBQ047QUFDQTtBQUNBO0FBQ0EsTUFBTTtBQUNOO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsS0FBSztBQUNMO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUFHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLFlBQVk7QUFDWjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxZQUFZO0FBQ1o7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxJQUFJO0FBQ0o7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLElBQUk7QUFDSjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLGtCQUFrQixrQkFBa0I7QUFDcEM7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxrQkFBa0Isa0JBQWtCO0FBQ3BDO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0EsSUFBSSxJQUEwQjtBQUM5QjtBQUNBOzs7Ozs7O1VDanlCQTtVQUNBOztVQUVBO1VBQ0E7VUFDQTtVQUNBO1VBQ0E7VUFDQTtVQUNBO1VBQ0E7VUFDQTtVQUNBO1VBQ0E7VUFDQTtVQUNBOztVQUVBO1VBQ0E7O1VBRUE7VUFDQTtVQUNBOzs7O1VFdEJBO1VBQ0E7VUFDQTtVQUNBIiwic291cmNlcyI6WyJ3ZWJwYWNrOi8vQG5ldHdvcmtlZC1hZnJhbWUvbmFmLWphbnVzLWFkYXB0ZXIvLi9ub2RlX21vZHVsZXMvQG5ldHdvcmtlZC1hZnJhbWUvbWluaWphbnVzL21pbmlqYW51cy5qcyIsIndlYnBhY2s6Ly9AbmV0d29ya2VkLWFmcmFtZS9uYWYtamFudXMtYWRhcHRlci8uL3NyYy9pbmRleC5qcyIsIndlYnBhY2s6Ly9AbmV0d29ya2VkLWFmcmFtZS9uYWYtamFudXMtYWRhcHRlci8uL25vZGVfbW9kdWxlcy9kZWJ1Zy9zcmMvYnJvd3Nlci5qcyIsIndlYnBhY2s6Ly9AbmV0d29ya2VkLWFmcmFtZS9uYWYtamFudXMtYWRhcHRlci8uL25vZGVfbW9kdWxlcy9kZWJ1Zy9zcmMvY29tbW9uLmpzIiwid2VicGFjazovL0BuZXR3b3JrZWQtYWZyYW1lL25hZi1qYW51cy1hZGFwdGVyLy4vbm9kZV9tb2R1bGVzL21zL2luZGV4LmpzIiwid2VicGFjazovL0BuZXR3b3JrZWQtYWZyYW1lL25hZi1qYW51cy1hZGFwdGVyLy4vbm9kZV9tb2R1bGVzL3NkcC9zZHAuanMiLCJ3ZWJwYWNrOi8vQG5ldHdvcmtlZC1hZnJhbWUvbmFmLWphbnVzLWFkYXB0ZXIvd2VicGFjay9ib290c3RyYXAiLCJ3ZWJwYWNrOi8vQG5ldHdvcmtlZC1hZnJhbWUvbmFmLWphbnVzLWFkYXB0ZXIvd2VicGFjay9iZWZvcmUtc3RhcnR1cCIsIndlYnBhY2s6Ly9AbmV0d29ya2VkLWFmcmFtZS9uYWYtamFudXMtYWRhcHRlci93ZWJwYWNrL3N0YXJ0dXAiLCJ3ZWJwYWNrOi8vQG5ldHdvcmtlZC1hZnJhbWUvbmFmLWphbnVzLWFkYXB0ZXIvd2VicGFjay9hZnRlci1zdGFydHVwIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogUmVwcmVzZW50cyBhIGhhbmRsZSB0byBhIHNpbmdsZSBKYW51cyBwbHVnaW4gb24gYSBKYW51cyBzZXNzaW9uLiBFYWNoIFdlYlJUQyBjb25uZWN0aW9uIHRvIHRoZSBKYW51cyBzZXJ2ZXIgd2lsbCBiZVxuICogYXNzb2NpYXRlZCB3aXRoIGEgc2luZ2xlIGhhbmRsZS4gT25jZSBhdHRhY2hlZCB0byB0aGUgc2VydmVyLCB0aGlzIGhhbmRsZSB3aWxsIGJlIGdpdmVuIGEgdW5pcXVlIElEIHdoaWNoIHNob3VsZCBiZVxuICogdXNlZCB0byBhc3NvY2lhdGUgaXQgd2l0aCBmdXR1cmUgc2lnbmFsbGluZyBtZXNzYWdlcy5cbiAqXG4gKiBTZWUgaHR0cHM6Ly9qYW51cy5jb25mLm1lZXRlY2hvLmNvbS9kb2NzL3Jlc3QuaHRtbCNoYW5kbGVzLlxuICoqL1xuZnVuY3Rpb24gSmFudXNQbHVnaW5IYW5kbGUoc2Vzc2lvbikge1xuICB0aGlzLnNlc3Npb24gPSBzZXNzaW9uO1xuICB0aGlzLmlkID0gdW5kZWZpbmVkO1xufVxuXG4vKiogQXR0YWNoZXMgdGhpcyBoYW5kbGUgdG8gdGhlIEphbnVzIHNlcnZlciBhbmQgc2V0cyBpdHMgSUQuICoqL1xuSmFudXNQbHVnaW5IYW5kbGUucHJvdG90eXBlLmF0dGFjaCA9IGZ1bmN0aW9uKHBsdWdpbiwgbG9vcF9pbmRleCkge1xuICB2YXIgcGF5bG9hZCA9IHsgcGx1Z2luOiBwbHVnaW4sIGxvb3BfaW5kZXg6IGxvb3BfaW5kZXgsIFwiZm9yY2UtYnVuZGxlXCI6IHRydWUsIFwiZm9yY2UtcnRjcC1tdXhcIjogdHJ1ZSB9O1xuICByZXR1cm4gdGhpcy5zZXNzaW9uLnNlbmQoXCJhdHRhY2hcIiwgcGF5bG9hZCkudGhlbihyZXNwID0+IHtcbiAgICB0aGlzLmlkID0gcmVzcC5kYXRhLmlkO1xuICAgIHJldHVybiByZXNwO1xuICB9KTtcbn07XG5cbi8qKiBEZXRhY2hlcyB0aGlzIGhhbmRsZS4gKiovXG5KYW51c1BsdWdpbkhhbmRsZS5wcm90b3R5cGUuZGV0YWNoID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLnNlbmQoXCJkZXRhY2hcIik7XG59O1xuXG4vKiogUmVnaXN0ZXJzIGEgY2FsbGJhY2sgdG8gYmUgZmlyZWQgdXBvbiB0aGUgcmVjZXB0aW9uIG9mIGFueSBpbmNvbWluZyBKYW51cyBzaWduYWxzIGZvciB0aGlzIHBsdWdpbiBoYW5kbGUgd2l0aCB0aGVcbiAqIGBqYW51c2AgYXR0cmlidXRlIGVxdWFsIHRvIGBldmAuXG4gKiovXG5KYW51c1BsdWdpbkhhbmRsZS5wcm90b3R5cGUub24gPSBmdW5jdGlvbihldiwgY2FsbGJhY2spIHtcbiAgcmV0dXJuIHRoaXMuc2Vzc2lvbi5vbihldiwgc2lnbmFsID0+IHtcbiAgICBpZiAoc2lnbmFsLnNlbmRlciA9PSB0aGlzLmlkKSB7XG4gICAgICBjYWxsYmFjayhzaWduYWwpO1xuICAgIH1cbiAgfSk7XG59O1xuXG4vKipcbiAqIFNlbmRzIGEgc2lnbmFsIGFzc29jaWF0ZWQgd2l0aCB0aGlzIGhhbmRsZS4gU2lnbmFscyBzaG91bGQgYmUgSlNPTi1zZXJpYWxpemFibGUgb2JqZWN0cy4gUmV0dXJucyBhIHByb21pc2UgdGhhdCB3aWxsXG4gKiBiZSByZXNvbHZlZCBvciByZWplY3RlZCB3aGVuIGEgcmVzcG9uc2UgdG8gdGhpcyBzaWduYWwgaXMgcmVjZWl2ZWQsIG9yIHdoZW4gbm8gcmVzcG9uc2UgaXMgcmVjZWl2ZWQgd2l0aGluIHRoZVxuICogc2Vzc2lvbiB0aW1lb3V0LlxuICoqL1xuSmFudXNQbHVnaW5IYW5kbGUucHJvdG90eXBlLnNlbmQgPSBmdW5jdGlvbih0eXBlLCBzaWduYWwpIHtcbiAgcmV0dXJuIHRoaXMuc2Vzc2lvbi5zZW5kKHR5cGUsIE9iamVjdC5hc3NpZ24oeyBoYW5kbGVfaWQ6IHRoaXMuaWQgfSwgc2lnbmFsKSk7XG59O1xuXG4vKiogU2VuZHMgYSBwbHVnaW4tc3BlY2lmaWMgbWVzc2FnZSBhc3NvY2lhdGVkIHdpdGggdGhpcyBoYW5kbGUuICoqL1xuSmFudXNQbHVnaW5IYW5kbGUucHJvdG90eXBlLnNlbmRNZXNzYWdlID0gZnVuY3Rpb24oYm9keSkge1xuICByZXR1cm4gdGhpcy5zZW5kKFwibWVzc2FnZVwiLCB7IGJvZHk6IGJvZHkgfSk7XG59O1xuXG4vKiogU2VuZHMgYSBKU0VQIG9mZmVyIG9yIGFuc3dlciBhc3NvY2lhdGVkIHdpdGggdGhpcyBoYW5kbGUuICoqL1xuSmFudXNQbHVnaW5IYW5kbGUucHJvdG90eXBlLnNlbmRKc2VwID0gZnVuY3Rpb24oanNlcCkge1xuICByZXR1cm4gdGhpcy5zZW5kKFwibWVzc2FnZVwiLCB7IGJvZHk6IHt9LCBqc2VwOiBqc2VwIH0pO1xufTtcblxuLyoqIFNlbmRzIGFuIElDRSB0cmlja2xlIGNhbmRpZGF0ZSBhc3NvY2lhdGVkIHdpdGggdGhpcyBoYW5kbGUuICoqL1xuSmFudXNQbHVnaW5IYW5kbGUucHJvdG90eXBlLnNlbmRUcmlja2xlID0gZnVuY3Rpb24oY2FuZGlkYXRlKSB7XG4gIHJldHVybiB0aGlzLnNlbmQoXCJ0cmlja2xlXCIsIHsgY2FuZGlkYXRlOiBjYW5kaWRhdGUgfSk7XG59O1xuXG4vKipcbiAqIFJlcHJlc2VudHMgYSBKYW51cyBzZXNzaW9uIC0tIGEgSmFudXMgY29udGV4dCBmcm9tIHdpdGhpbiB3aGljaCB5b3UgY2FuIG9wZW4gbXVsdGlwbGUgaGFuZGxlcyBhbmQgY29ubmVjdGlvbnMuIE9uY2VcbiAqIGNyZWF0ZWQsIHRoaXMgc2Vzc2lvbiB3aWxsIGJlIGdpdmVuIGEgdW5pcXVlIElEIHdoaWNoIHNob3VsZCBiZSB1c2VkIHRvIGFzc29jaWF0ZSBpdCB3aXRoIGZ1dHVyZSBzaWduYWxsaW5nIG1lc3NhZ2VzLlxuICpcbiAqIFNlZSBodHRwczovL2phbnVzLmNvbmYubWVldGVjaG8uY29tL2RvY3MvcmVzdC5odG1sI3Nlc3Npb25zLlxuICoqL1xuZnVuY3Rpb24gSmFudXNTZXNzaW9uKG91dHB1dCwgb3B0aW9ucykge1xuICB0aGlzLm91dHB1dCA9IG91dHB1dDtcbiAgdGhpcy5pZCA9IHVuZGVmaW5lZDtcbiAgdGhpcy5uZXh0VHhJZCA9IDA7XG4gIHRoaXMudHhucyA9IHt9O1xuICB0aGlzLmV2ZW50SGFuZGxlcnMgPSB7fTtcbiAgdGhpcy5vcHRpb25zID0gT2JqZWN0LmFzc2lnbih7XG4gICAgdmVyYm9zZTogZmFsc2UsXG4gICAgdGltZW91dE1zOiAxMDAwMCxcbiAgICBrZWVwYWxpdmVNczogMzAwMDBcbiAgfSwgb3B0aW9ucyk7XG59XG5cbi8qKiBDcmVhdGVzIHRoaXMgc2Vzc2lvbiBvbiB0aGUgSmFudXMgc2VydmVyIGFuZCBzZXRzIGl0cyBJRC4gKiovXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLmNyZWF0ZSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5zZW5kKFwiY3JlYXRlXCIpLnRoZW4ocmVzcCA9PiB7XG4gICAgdGhpcy5pZCA9IHJlc3AuZGF0YS5pZDtcbiAgICByZXR1cm4gcmVzcDtcbiAgfSk7XG59O1xuXG4vKipcbiAqIERlc3Ryb3lzIHRoaXMgc2Vzc2lvbi4gTm90ZSB0aGF0IHVwb24gZGVzdHJ1Y3Rpb24sIEphbnVzIHdpbGwgYWxzbyBjbG9zZSB0aGUgc2lnbmFsbGluZyB0cmFuc3BvcnQgKGlmIGFwcGxpY2FibGUpIGFuZFxuICogYW55IG9wZW4gV2ViUlRDIGNvbm5lY3Rpb25zLlxuICoqL1xuSmFudXNTZXNzaW9uLnByb3RvdHlwZS5kZXN0cm95ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLnNlbmQoXCJkZXN0cm95XCIpLnRoZW4oKHJlc3ApID0+IHtcbiAgICB0aGlzLmRpc3Bvc2UoKTtcbiAgICByZXR1cm4gcmVzcDtcbiAgfSk7XG59O1xuXG4vKipcbiAqIERpc3Bvc2VzIG9mIHRoaXMgc2Vzc2lvbiBpbiBhIHdheSBzdWNoIHRoYXQgbm8gZnVydGhlciBpbmNvbWluZyBzaWduYWxsaW5nIG1lc3NhZ2VzIHdpbGwgYmUgcHJvY2Vzc2VkLlxuICogT3V0c3RhbmRpbmcgdHJhbnNhY3Rpb25zIHdpbGwgYmUgcmVqZWN0ZWQuXG4gKiovXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLmRpc3Bvc2UgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5fa2lsbEtlZXBhbGl2ZSgpO1xuICB0aGlzLmV2ZW50SGFuZGxlcnMgPSB7fTtcbiAgZm9yICh2YXIgdHhJZCBpbiB0aGlzLnR4bnMpIHtcbiAgICBpZiAodGhpcy50eG5zLmhhc093blByb3BlcnR5KHR4SWQpKSB7XG4gICAgICB2YXIgdHhuID0gdGhpcy50eG5zW3R4SWRdO1xuICAgICAgY2xlYXJUaW1lb3V0KHR4bi50aW1lb3V0KTtcbiAgICAgIHR4bi5yZWplY3QobmV3IEVycm9yKFwiSmFudXMgc2Vzc2lvbiB3YXMgZGlzcG9zZWQuXCIpKTtcbiAgICAgIGRlbGV0ZSB0aGlzLnR4bnNbdHhJZF07XG4gICAgfVxuICB9XG59O1xuXG4vKipcbiAqIFdoZXRoZXIgdGhpcyBzaWduYWwgcmVwcmVzZW50cyBhbiBlcnJvciwgYW5kIHRoZSBhc3NvY2lhdGVkIHByb21pc2UgKGlmIGFueSkgc2hvdWxkIGJlIHJlamVjdGVkLlxuICogVXNlcnMgc2hvdWxkIG92ZXJyaWRlIHRoaXMgdG8gaGFuZGxlIGFueSBjdXN0b20gcGx1Z2luLXNwZWNpZmljIGVycm9yIGNvbnZlbnRpb25zLlxuICoqL1xuSmFudXNTZXNzaW9uLnByb3RvdHlwZS5pc0Vycm9yID0gZnVuY3Rpb24oc2lnbmFsKSB7XG4gIHJldHVybiBzaWduYWwuamFudXMgPT09IFwiZXJyb3JcIjtcbn07XG5cbi8qKiBSZWdpc3RlcnMgYSBjYWxsYmFjayB0byBiZSBmaXJlZCB1cG9uIHRoZSByZWNlcHRpb24gb2YgYW55IGluY29taW5nIEphbnVzIHNpZ25hbHMgZm9yIHRoaXMgc2Vzc2lvbiB3aXRoIHRoZVxuICogYGphbnVzYCBhdHRyaWJ1dGUgZXF1YWwgdG8gYGV2YC5cbiAqKi9cbkphbnVzU2Vzc2lvbi5wcm90b3R5cGUub24gPSBmdW5jdGlvbihldiwgY2FsbGJhY2spIHtcbiAgdmFyIGhhbmRsZXJzID0gdGhpcy5ldmVudEhhbmRsZXJzW2V2XTtcbiAgaWYgKGhhbmRsZXJzID09IG51bGwpIHtcbiAgICBoYW5kbGVycyA9IHRoaXMuZXZlbnRIYW5kbGVyc1tldl0gPSBbXTtcbiAgfVxuICBoYW5kbGVycy5wdXNoKGNhbGxiYWNrKTtcbn07XG5cbi8qKlxuICogQ2FsbGJhY2sgZm9yIHJlY2VpdmluZyBKU09OIHNpZ25hbGxpbmcgbWVzc2FnZXMgcGVydGluZW50IHRvIHRoaXMgc2Vzc2lvbi4gSWYgdGhlIHNpZ25hbHMgYXJlIHJlc3BvbnNlcyB0byBwcmV2aW91c2x5XG4gKiBzZW50IHNpZ25hbHMsIHRoZSBwcm9taXNlcyBmb3IgdGhlIG91dGdvaW5nIHNpZ25hbHMgd2lsbCBiZSByZXNvbHZlZCBvciByZWplY3RlZCBhcHByb3ByaWF0ZWx5IHdpdGggdGhpcyBzaWduYWwgYXMgYW5cbiAqIGFyZ3VtZW50LlxuICpcbiAqIEV4dGVybmFsIGNhbGxlcnMgc2hvdWxkIGNhbGwgdGhpcyBmdW5jdGlvbiBldmVyeSB0aW1lIGEgbmV3IHNpZ25hbCBhcnJpdmVzIG9uIHRoZSB0cmFuc3BvcnQ7IGZvciBleGFtcGxlLCBpbiBhXG4gKiBXZWJTb2NrZXQncyBgbWVzc2FnZWAgZXZlbnQsIG9yIHdoZW4gYSBuZXcgZGF0dW0gc2hvd3MgdXAgaW4gYW4gSFRUUCBsb25nLXBvbGxpbmcgcmVzcG9uc2UuXG4gKiovXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLnJlY2VpdmUgPSBmdW5jdGlvbihzaWduYWwpIHtcbiAgaWYgKHRoaXMub3B0aW9ucy52ZXJib3NlKSB7XG4gICAgdGhpcy5fbG9nSW5jb21pbmcoc2lnbmFsKTtcbiAgfVxuICBpZiAoc2lnbmFsLnNlc3Npb25faWQgIT0gdGhpcy5pZCkge1xuICAgIGNvbnNvbGUud2FybihcIkluY29ycmVjdCBzZXNzaW9uIElEIHJlY2VpdmVkIGluIEphbnVzIHNpZ25hbGxpbmcgbWVzc2FnZTogd2FzIFwiICsgc2lnbmFsLnNlc3Npb25faWQgKyBcIiwgZXhwZWN0ZWQgXCIgKyB0aGlzLmlkICsgXCIuXCIpO1xuICB9XG5cbiAgdmFyIHJlc3BvbnNlVHlwZSA9IHNpZ25hbC5qYW51cztcbiAgdmFyIGhhbmRsZXJzID0gdGhpcy5ldmVudEhhbmRsZXJzW3Jlc3BvbnNlVHlwZV07XG4gIGlmIChoYW5kbGVycyAhPSBudWxsKSB7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBoYW5kbGVycy5sZW5ndGg7IGkrKykge1xuICAgICAgaGFuZGxlcnNbaV0oc2lnbmFsKTtcbiAgICB9XG4gIH1cblxuICBpZiAoc2lnbmFsLnRyYW5zYWN0aW9uICE9IG51bGwpIHtcbiAgICB2YXIgdHhuID0gdGhpcy50eG5zW3NpZ25hbC50cmFuc2FjdGlvbl07XG4gICAgaWYgKHR4biA9PSBudWxsKSB7XG4gICAgICAvLyB0aGlzIGlzIGEgcmVzcG9uc2UgdG8gYSB0cmFuc2FjdGlvbiB0aGF0IHdhc24ndCBjYXVzZWQgdmlhIEphbnVzU2Vzc2lvbi5zZW5kLCBvciBhIHBsdWdpbiByZXBsaWVkIHR3aWNlIHRvIGFcbiAgICAgIC8vIHNpbmdsZSByZXF1ZXN0LCBvciB0aGUgc2Vzc2lvbiB3YXMgZGlzcG9zZWQsIG9yIHNvbWV0aGluZyBlbHNlIHRoYXQgaXNuJ3QgdW5kZXIgb3VyIHB1cnZpZXc7IHRoYXQncyBmaW5lXG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKHJlc3BvbnNlVHlwZSA9PT0gXCJhY2tcIiAmJiB0eG4udHlwZSA9PSBcIm1lc3NhZ2VcIikge1xuICAgICAgLy8gdGhpcyBpcyBhbiBhY2sgb2YgYW4gYXN5bmNocm9ub3VzbHktcHJvY2Vzc2VkIHBsdWdpbiByZXF1ZXN0LCB3ZSBzaG91bGQgd2FpdCB0byByZXNvbHZlIHRoZSBwcm9taXNlIHVudGlsIHRoZVxuICAgICAgLy8gYWN0dWFsIHJlc3BvbnNlIGNvbWVzIGluXG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY2xlYXJUaW1lb3V0KHR4bi50aW1lb3V0KTtcblxuICAgIGRlbGV0ZSB0aGlzLnR4bnNbc2lnbmFsLnRyYW5zYWN0aW9uXTtcbiAgICAodGhpcy5pc0Vycm9yKHNpZ25hbCkgPyB0eG4ucmVqZWN0IDogdHhuLnJlc29sdmUpKHNpZ25hbCk7XG4gIH1cbn07XG5cbi8qKlxuICogU2VuZHMgYSBzaWduYWwgYXNzb2NpYXRlZCB3aXRoIHRoaXMgc2Vzc2lvbiwgYmVnaW5uaW5nIGEgbmV3IHRyYW5zYWN0aW9uLiBSZXR1cm5zIGEgcHJvbWlzZSB0aGF0IHdpbGwgYmUgcmVzb2x2ZWQgb3JcbiAqIHJlamVjdGVkIHdoZW4gYSByZXNwb25zZSBpcyByZWNlaXZlZCBpbiB0aGUgc2FtZSB0cmFuc2FjdGlvbiwgb3Igd2hlbiBubyByZXNwb25zZSBpcyByZWNlaXZlZCB3aXRoaW4gdGhlIHNlc3Npb25cbiAqIHRpbWVvdXQuXG4gKiovXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLnNlbmQgPSBmdW5jdGlvbih0eXBlLCBzaWduYWwpIHtcbiAgc2lnbmFsID0gT2JqZWN0LmFzc2lnbih7IHRyYW5zYWN0aW9uOiAodGhpcy5uZXh0VHhJZCsrKS50b1N0cmluZygpIH0sIHNpZ25hbCk7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgdmFyIHRpbWVvdXQgPSBudWxsO1xuICAgIGlmICh0aGlzLm9wdGlvbnMudGltZW91dE1zKSB7XG4gICAgICB0aW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIGRlbGV0ZSB0aGlzLnR4bnNbc2lnbmFsLnRyYW5zYWN0aW9uXTtcbiAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihcIlNpZ25hbGxpbmcgdHJhbnNhY3Rpb24gd2l0aCB0eGlkIFwiICsgc2lnbmFsLnRyYW5zYWN0aW9uICsgXCIgdGltZWQgb3V0LlwiKSk7XG4gICAgICB9LCB0aGlzLm9wdGlvbnMudGltZW91dE1zKTtcbiAgICB9XG4gICAgdGhpcy50eG5zW3NpZ25hbC50cmFuc2FjdGlvbl0gPSB7IHJlc29sdmU6IHJlc29sdmUsIHJlamVjdDogcmVqZWN0LCB0aW1lb3V0OiB0aW1lb3V0LCB0eXBlOiB0eXBlIH07XG4gICAgdGhpcy5fdHJhbnNtaXQodHlwZSwgc2lnbmFsKTtcbiAgfSk7XG59O1xuXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLl90cmFuc21pdCA9IGZ1bmN0aW9uKHR5cGUsIHNpZ25hbCkge1xuICBzaWduYWwgPSBPYmplY3QuYXNzaWduKHsgamFudXM6IHR5cGUgfSwgc2lnbmFsKTtcblxuICBpZiAodGhpcy5pZCAhPSBudWxsKSB7IC8vIHRoaXMuaWQgaXMgdW5kZWZpbmVkIGluIHRoZSBzcGVjaWFsIGNhc2Ugd2hlbiB3ZSdyZSBzZW5kaW5nIHRoZSBzZXNzaW9uIGNyZWF0ZSBtZXNzYWdlXG4gICAgc2lnbmFsID0gT2JqZWN0LmFzc2lnbih7IHNlc3Npb25faWQ6IHRoaXMuaWQgfSwgc2lnbmFsKTtcbiAgfVxuXG4gIGlmICh0aGlzLm9wdGlvbnMudmVyYm9zZSkge1xuICAgIHRoaXMuX2xvZ091dGdvaW5nKHNpZ25hbCk7XG4gIH1cblxuICB0aGlzLm91dHB1dChKU09OLnN0cmluZ2lmeShzaWduYWwpKTtcbiAgdGhpcy5fcmVzZXRLZWVwYWxpdmUoKTtcbn07XG5cbkphbnVzU2Vzc2lvbi5wcm90b3R5cGUuX2xvZ091dGdvaW5nID0gZnVuY3Rpb24oc2lnbmFsKSB7XG4gIHZhciBraW5kID0gc2lnbmFsLmphbnVzO1xuICBpZiAoa2luZCA9PT0gXCJtZXNzYWdlXCIgJiYgc2lnbmFsLmpzZXApIHtcbiAgICBraW5kID0gc2lnbmFsLmpzZXAudHlwZTtcbiAgfVxuICB2YXIgbWVzc2FnZSA9IFwiPiBPdXRnb2luZyBKYW51cyBcIiArIChraW5kIHx8IFwic2lnbmFsXCIpICsgXCIgKCNcIiArIHNpZ25hbC50cmFuc2FjdGlvbiArIFwiKTogXCI7XG4gIGNvbnNvbGUuZGVidWcoXCIlY1wiICsgbWVzc2FnZSwgXCJjb2xvcjogIzA0MFwiLCBzaWduYWwpO1xufTtcblxuSmFudXNTZXNzaW9uLnByb3RvdHlwZS5fbG9nSW5jb21pbmcgPSBmdW5jdGlvbihzaWduYWwpIHtcbiAgdmFyIGtpbmQgPSBzaWduYWwuamFudXM7XG4gIHZhciBtZXNzYWdlID0gc2lnbmFsLnRyYW5zYWN0aW9uID9cbiAgICAgIFwiPCBJbmNvbWluZyBKYW51cyBcIiArIChraW5kIHx8IFwic2lnbmFsXCIpICsgXCIgKCNcIiArIHNpZ25hbC50cmFuc2FjdGlvbiArIFwiKTogXCIgOlxuICAgICAgXCI8IEluY29taW5nIEphbnVzIFwiICsgKGtpbmQgfHwgXCJzaWduYWxcIikgKyBcIjogXCI7XG4gIGNvbnNvbGUuZGVidWcoXCIlY1wiICsgbWVzc2FnZSwgXCJjb2xvcjogIzAwNFwiLCBzaWduYWwpO1xufTtcblxuSmFudXNTZXNzaW9uLnByb3RvdHlwZS5fc2VuZEtlZXBhbGl2ZSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5zZW5kKFwia2VlcGFsaXZlXCIpO1xufTtcblxuSmFudXNTZXNzaW9uLnByb3RvdHlwZS5fa2lsbEtlZXBhbGl2ZSA9IGZ1bmN0aW9uKCkge1xuICBjbGVhclRpbWVvdXQodGhpcy5rZWVwYWxpdmVUaW1lb3V0KTtcbn07XG5cbkphbnVzU2Vzc2lvbi5wcm90b3R5cGUuX3Jlc2V0S2VlcGFsaXZlID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuX2tpbGxLZWVwYWxpdmUoKTtcbiAgaWYgKHRoaXMub3B0aW9ucy5rZWVwYWxpdmVNcykge1xuICAgIHRoaXMua2VlcGFsaXZlVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy5fc2VuZEtlZXBhbGl2ZSgpLmNhdGNoKGUgPT4gY29uc29sZS5lcnJvcihcIkVycm9yIHJlY2VpdmVkIGZyb20ga2VlcGFsaXZlOiBcIiwgZSkpO1xuICAgIH0sIHRoaXMub3B0aW9ucy5rZWVwYWxpdmVNcyk7XG4gIH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBKYW51c1BsdWdpbkhhbmRsZSxcbiAgSmFudXNTZXNzaW9uXG59O1xuIiwiLyogZ2xvYmFsIE5BRiAqL1xudmFyIG1qID0gcmVxdWlyZShcIkBuZXR3b3JrZWQtYWZyYW1lL21pbmlqYW51c1wiKTtcbm1qLkphbnVzU2Vzc2lvbi5wcm90b3R5cGUuc2VuZE9yaWdpbmFsID0gbWouSmFudXNTZXNzaW9uLnByb3RvdHlwZS5zZW5kO1xubWouSmFudXNTZXNzaW9uLnByb3RvdHlwZS5zZW5kID0gZnVuY3Rpb24odHlwZSwgc2lnbmFsKSB7XG4gIHJldHVybiB0aGlzLnNlbmRPcmlnaW5hbCh0eXBlLCBzaWduYWwpLmNhdGNoKChlKSA9PiB7XG4gICAgaWYgKGUubWVzc2FnZSAmJiBlLm1lc3NhZ2UuaW5kZXhPZihcInRpbWVkIG91dFwiKSA+IC0xKSB7XG4gICAgICBjb25zb2xlLmVycm9yKFwid2ViIHNvY2tldCB0aW1lZCBvdXRcIik7XG4gICAgICBOQUYuY29ubmVjdGlvbi5hZGFwdGVyLnJlY29ubmVjdCgpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyhlKTtcbiAgICB9XG4gIH0pO1xufVxuXG52YXIgc2RwVXRpbHMgPSByZXF1aXJlKFwic2RwXCIpO1xudmFyIGRlYnVnID0gcmVxdWlyZShcImRlYnVnXCIpKFwibmFmLWphbnVzLWFkYXB0ZXI6ZGVidWdcIik7XG52YXIgd2FybiA9IHJlcXVpcmUoXCJkZWJ1Z1wiKShcIm5hZi1qYW51cy1hZGFwdGVyOndhcm5cIik7XG52YXIgZXJyb3IgPSByZXF1aXJlKFwiZGVidWdcIikoXCJuYWYtamFudXMtYWRhcHRlcjplcnJvclwiKTtcbnZhciBpc1NhZmFyaSA9IC9eKCg/IWNocm9tZXxhbmRyb2lkKS4pKnNhZmFyaS9pLnRlc3QobmF2aWdhdG9yLnVzZXJBZ2VudCk7XG5cbmNvbnN0IFNVQlNDUklCRV9USU1FT1VUX01TID0gMTUwMDA7XG5cbmNvbnN0IEFWQUlMQUJMRV9PQ0NVUEFOVFNfVEhSRVNIT0xEID0gNTtcbmNvbnN0IE1BWF9TVUJTQ1JJQkVfREVMQVkgPSA1MDAwO1xuXG5mdW5jdGlvbiByYW5kb21EZWxheShtaW4sIG1heCkge1xuICByZXR1cm4gbmV3IFByb21pc2UocmVzb2x2ZSA9PiB7XG4gICAgY29uc3QgZGVsYXkgPSBNYXRoLnJhbmRvbSgpICogKG1heCAtIG1pbikgKyBtaW47XG4gICAgc2V0VGltZW91dChyZXNvbHZlLCBkZWxheSk7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBkZWJvdW5jZShmbikge1xuICB2YXIgY3VyciA9IFByb21pc2UucmVzb2x2ZSgpO1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIGFyZ3MgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMpO1xuICAgIGN1cnIgPSBjdXJyLnRoZW4oXyA9PiBmbi5hcHBseSh0aGlzLCBhcmdzKSk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIHJhbmRvbVVpbnQoKSB7XG4gIHJldHVybiBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiBOdW1iZXIuTUFYX1NBRkVfSU5URUdFUik7XG59XG5cbmZ1bmN0aW9uIHVudGlsRGF0YUNoYW5uZWxPcGVuKGRhdGFDaGFubmVsKSB7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgaWYgKGRhdGFDaGFubmVsLnJlYWR5U3RhdGUgPT09IFwib3BlblwiKSB7XG4gICAgICByZXNvbHZlKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGxldCByZXNvbHZlciwgcmVqZWN0b3I7XG5cbiAgICAgIGNvbnN0IGNsZWFyID0gKCkgPT4ge1xuICAgICAgICBkYXRhQ2hhbm5lbC5yZW1vdmVFdmVudExpc3RlbmVyKFwib3BlblwiLCByZXNvbHZlcik7XG4gICAgICAgIGRhdGFDaGFubmVsLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJlcnJvclwiLCByZWplY3Rvcik7XG4gICAgICB9O1xuXG4gICAgICByZXNvbHZlciA9ICgpID0+IHtcbiAgICAgICAgY2xlYXIoKTtcbiAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgfTtcbiAgICAgIHJlamVjdG9yID0gKCkgPT4ge1xuICAgICAgICBjbGVhcigpO1xuICAgICAgICByZWplY3QoKTtcbiAgICAgIH07XG5cbiAgICAgIGRhdGFDaGFubmVsLmFkZEV2ZW50TGlzdGVuZXIoXCJvcGVuXCIsIHJlc29sdmVyKTtcbiAgICAgIGRhdGFDaGFubmVsLmFkZEV2ZW50TGlzdGVuZXIoXCJlcnJvclwiLCByZWplY3Rvcik7XG4gICAgfVxuICB9KTtcbn1cblxuY29uc3QgaXNIMjY0VmlkZW9TdXBwb3J0ZWQgPSAoKCkgPT4ge1xuICBjb25zdCB2aWRlbyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJ2aWRlb1wiKTtcbiAgcmV0dXJuIHZpZGVvLmNhblBsYXlUeXBlKCd2aWRlby9tcDQ7IGNvZGVjcz1cImF2YzEuNDJFMDFFLCBtcDRhLjQwLjJcIicpICE9PSBcIlwiO1xufSkoKTtcblxuY29uc3QgT1BVU19QQVJBTUVURVJTID0ge1xuICAvLyBpbmRpY2F0ZXMgdGhhdCB3ZSB3YW50IHRvIGVuYWJsZSBEVFggdG8gZWxpZGUgc2lsZW5jZSBwYWNrZXRzXG4gIHVzZWR0eDogMSxcbiAgLy8gaW5kaWNhdGVzIHRoYXQgd2UgcHJlZmVyIHRvIHJlY2VpdmUgbW9ubyBhdWRpbyAoaW1wb3J0YW50IGZvciB2b2lwIHByb2ZpbGUpXG4gIHN0ZXJlbzogMCxcbiAgLy8gaW5kaWNhdGVzIHRoYXQgd2UgcHJlZmVyIHRvIHNlbmQgbW9ubyBhdWRpbyAoaW1wb3J0YW50IGZvciB2b2lwIHByb2ZpbGUpXG4gIFwic3Byb3Atc3RlcmVvXCI6IDBcbn07XG5cbmNvbnN0IERFRkFVTFRfUEVFUl9DT05ORUNUSU9OX0NPTkZJRyA9IHtcbiAgaWNlU2VydmVyczogW3sgdXJsczogXCJzdHVuOnN0dW4xLmwuZ29vZ2xlLmNvbToxOTMwMlwiIH0sIHsgdXJsczogXCJzdHVuOnN0dW4yLmwuZ29vZ2xlLmNvbToxOTMwMlwiIH1dXG59O1xuXG5jb25zdCBXU19OT1JNQUxfQ0xPU1VSRSA9IDEwMDA7XG5cbmNsYXNzIEphbnVzQWRhcHRlciB7XG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHRoaXMucm9vbSA9IG51bGw7XG4gICAgLy8gV2UgZXhwZWN0IHRoZSBjb25zdW1lciB0byBzZXQgYSBjbGllbnQgaWQgYmVmb3JlIGNvbm5lY3RpbmcuXG4gICAgdGhpcy5jbGllbnRJZCA9IG51bGw7XG4gICAgdGhpcy5qb2luVG9rZW4gPSBudWxsO1xuXG4gICAgdGhpcy5zZXJ2ZXJVcmwgPSBudWxsO1xuICAgIHRoaXMud2ViUnRjT3B0aW9ucyA9IHt9O1xuICAgIHRoaXMucGVlckNvbm5lY3Rpb25Db25maWcgPSBudWxsO1xuICAgIHRoaXMud3MgPSBudWxsO1xuICAgIHRoaXMuc2Vzc2lvbiA9IG51bGw7XG4gICAgdGhpcy5yZWxpYWJsZVRyYW5zcG9ydCA9IFwiZGF0YWNoYW5uZWxcIjtcbiAgICB0aGlzLnVucmVsaWFibGVUcmFuc3BvcnQgPSBcImRhdGFjaGFubmVsXCI7XG5cbiAgICAvLyBJbiB0aGUgZXZlbnQgdGhlIHNlcnZlciByZXN0YXJ0cyBhbmQgYWxsIGNsaWVudHMgbG9zZSBjb25uZWN0aW9uLCByZWNvbm5lY3Qgd2l0aFxuICAgIC8vIHNvbWUgcmFuZG9tIGppdHRlciBhZGRlZCB0byBwcmV2ZW50IHNpbXVsdGFuZW91cyByZWNvbm5lY3Rpb24gcmVxdWVzdHMuXG4gICAgdGhpcy5pbml0aWFsUmVjb25uZWN0aW9uRGVsYXkgPSAxMDAwICogTWF0aC5yYW5kb20oKTtcbiAgICB0aGlzLnJlY29ubmVjdGlvbkRlbGF5ID0gdGhpcy5pbml0aWFsUmVjb25uZWN0aW9uRGVsYXk7XG4gICAgdGhpcy5yZWNvbm5lY3Rpb25UaW1lb3V0ID0gbnVsbDtcbiAgICB0aGlzLm1heFJlY29ubmVjdGlvbkF0dGVtcHRzID0gMTA7XG4gICAgdGhpcy5yZWNvbm5lY3Rpb25BdHRlbXB0cyA9IDA7XG5cbiAgICB0aGlzLnB1Ymxpc2hlciA9IG51bGw7XG4gICAgdGhpcy5vY2N1cGFudElkcyA9IFtdO1xuICAgIHRoaXMub2NjdXBhbnRzID0ge307XG4gICAgdGhpcy5tZWRpYVN0cmVhbXMgPSB7fTtcbiAgICB0aGlzLmxvY2FsTWVkaWFTdHJlYW0gPSBudWxsO1xuICAgIHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMgPSBuZXcgTWFwKCk7XG5cbiAgICB0aGlzLnBlbmRpbmdPY2N1cGFudHMgPSBuZXcgU2V0KCk7XG4gICAgdGhpcy5hdmFpbGFibGVPY2N1cGFudHMgPSBbXTtcbiAgICB0aGlzLnJlcXVlc3RlZE9jY3VwYW50cyA9IG51bGw7XG5cbiAgICB0aGlzLmJsb2NrZWRDbGllbnRzID0gbmV3IE1hcCgpO1xuICAgIHRoaXMuZnJvemVuVXBkYXRlcyA9IG5ldyBNYXAoKTtcblxuICAgIHRoaXMudGltZU9mZnNldHMgPSBbXTtcbiAgICB0aGlzLnNlcnZlclRpbWVSZXF1ZXN0cyA9IDA7XG4gICAgdGhpcy5hdmdUaW1lT2Zmc2V0ID0gMDtcblxuICAgIHRoaXMub25XZWJzb2NrZXRPcGVuID0gdGhpcy5vbldlYnNvY2tldE9wZW4uYmluZCh0aGlzKTtcbiAgICB0aGlzLm9uV2Vic29ja2V0Q2xvc2UgPSB0aGlzLm9uV2Vic29ja2V0Q2xvc2UuYmluZCh0aGlzKTtcbiAgICB0aGlzLm9uV2Vic29ja2V0TWVzc2FnZSA9IHRoaXMub25XZWJzb2NrZXRNZXNzYWdlLmJpbmQodGhpcyk7XG4gICAgdGhpcy5vbkRhdGFDaGFubmVsTWVzc2FnZSA9IHRoaXMub25EYXRhQ2hhbm5lbE1lc3NhZ2UuYmluZCh0aGlzKTtcbiAgICB0aGlzLm9uRGF0YSA9IHRoaXMub25EYXRhLmJpbmQodGhpcyk7XG4gIH1cblxuICBzZXRTZXJ2ZXJVcmwodXJsKSB7XG4gICAgdGhpcy5zZXJ2ZXJVcmwgPSB1cmw7XG4gIH1cblxuICBzZXRBcHAoYXBwKSB7fVxuXG4gIHNldFJvb20ocm9vbU5hbWUpIHtcbiAgICB0aGlzLnJvb20gPSByb29tTmFtZTtcbiAgfVxuXG4gIHNldEpvaW5Ub2tlbihqb2luVG9rZW4pIHtcbiAgICB0aGlzLmpvaW5Ub2tlbiA9IGpvaW5Ub2tlbjtcbiAgfVxuXG4gIHNldENsaWVudElkKGNsaWVudElkKSB7XG4gICAgdGhpcy5jbGllbnRJZCA9IGNsaWVudElkO1xuICB9XG5cbiAgc2V0V2ViUnRjT3B0aW9ucyhvcHRpb25zKSB7XG4gICAgdGhpcy53ZWJSdGNPcHRpb25zID0gb3B0aW9ucztcbiAgfVxuXG4gIHNldFBlZXJDb25uZWN0aW9uQ29uZmlnKHBlZXJDb25uZWN0aW9uQ29uZmlnKSB7XG4gICAgdGhpcy5wZWVyQ29ubmVjdGlvbkNvbmZpZyA9IHBlZXJDb25uZWN0aW9uQ29uZmlnO1xuICB9XG5cbiAgc2V0U2VydmVyQ29ubmVjdExpc3RlbmVycyhzdWNjZXNzTGlzdGVuZXIsIGZhaWx1cmVMaXN0ZW5lcikge1xuICAgIHRoaXMuY29ubmVjdFN1Y2Nlc3MgPSBzdWNjZXNzTGlzdGVuZXI7XG4gICAgdGhpcy5jb25uZWN0RmFpbHVyZSA9IGZhaWx1cmVMaXN0ZW5lcjtcbiAgfVxuXG4gIHNldFJvb21PY2N1cGFudExpc3RlbmVyKG9jY3VwYW50TGlzdGVuZXIpIHtcbiAgICB0aGlzLm9uT2NjdXBhbnRzQ2hhbmdlZCA9IG9jY3VwYW50TGlzdGVuZXI7XG4gIH1cblxuICBzZXREYXRhQ2hhbm5lbExpc3RlbmVycyhvcGVuTGlzdGVuZXIsIGNsb3NlZExpc3RlbmVyLCBtZXNzYWdlTGlzdGVuZXIpIHtcbiAgICB0aGlzLm9uT2NjdXBhbnRDb25uZWN0ZWQgPSBvcGVuTGlzdGVuZXI7XG4gICAgdGhpcy5vbk9jY3VwYW50RGlzY29ubmVjdGVkID0gY2xvc2VkTGlzdGVuZXI7XG4gICAgdGhpcy5vbk9jY3VwYW50TWVzc2FnZSA9IG1lc3NhZ2VMaXN0ZW5lcjtcbiAgfVxuXG4gIHNldFJlY29ubmVjdGlvbkxpc3RlbmVycyhyZWNvbm5lY3RpbmdMaXN0ZW5lciwgcmVjb25uZWN0ZWRMaXN0ZW5lciwgcmVjb25uZWN0aW9uRXJyb3JMaXN0ZW5lcikge1xuICAgIC8vIG9uUmVjb25uZWN0aW5nIGlzIGNhbGxlZCB3aXRoIHRoZSBudW1iZXIgb2YgbWlsbGlzZWNvbmRzIHVudGlsIHRoZSBuZXh0IHJlY29ubmVjdGlvbiBhdHRlbXB0XG4gICAgdGhpcy5vblJlY29ubmVjdGluZyA9IHJlY29ubmVjdGluZ0xpc3RlbmVyO1xuICAgIC8vIG9uUmVjb25uZWN0ZWQgaXMgY2FsbGVkIHdoZW4gdGhlIGNvbm5lY3Rpb24gaGFzIGJlZW4gcmVlc3RhYmxpc2hlZFxuICAgIHRoaXMub25SZWNvbm5lY3RlZCA9IHJlY29ubmVjdGVkTGlzdGVuZXI7XG4gICAgLy8gb25SZWNvbm5lY3Rpb25FcnJvciBpcyBjYWxsZWQgd2l0aCBhbiBlcnJvciB3aGVuIG1heFJlY29ubmVjdGlvbkF0dGVtcHRzIGhhcyBiZWVuIHJlYWNoZWRcbiAgICB0aGlzLm9uUmVjb25uZWN0aW9uRXJyb3IgPSByZWNvbm5lY3Rpb25FcnJvckxpc3RlbmVyO1xuICB9XG5cbiAgc2V0RXZlbnRMb29wcyhsb29wcykge1xuICAgIHRoaXMubG9vcHMgPSBsb29wcztcbiAgfVxuXG4gIGNvbm5lY3QoKSB7XG4gICAgZGVidWcoYGNvbm5lY3RpbmcgdG8gJHt0aGlzLnNlcnZlclVybH1gKTtcblxuICAgIGNvbnN0IHdlYnNvY2tldENvbm5lY3Rpb24gPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICB0aGlzLndzID0gbmV3IFdlYlNvY2tldCh0aGlzLnNlcnZlclVybCwgXCJqYW51cy1wcm90b2NvbFwiKTtcblxuICAgICAgdGhpcy5zZXNzaW9uID0gbmV3IG1qLkphbnVzU2Vzc2lvbih0aGlzLndzLnNlbmQuYmluZCh0aGlzLndzKSwgeyB0aW1lb3V0TXM6IDQwMDAwIH0pO1xuXG4gICAgICB0aGlzLndzLmFkZEV2ZW50TGlzdGVuZXIoXCJjbG9zZVwiLCB0aGlzLm9uV2Vic29ja2V0Q2xvc2UpO1xuICAgICAgdGhpcy53cy5hZGRFdmVudExpc3RlbmVyKFwibWVzc2FnZVwiLCB0aGlzLm9uV2Vic29ja2V0TWVzc2FnZSk7XG5cbiAgICAgIHRoaXMud3NPbk9wZW4gPSAoKSA9PiB7XG4gICAgICAgIHRoaXMud3MucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm9wZW5cIiwgdGhpcy53c09uT3Blbik7XG4gICAgICAgIHRoaXMub25XZWJzb2NrZXRPcGVuKClcbiAgICAgICAgICAudGhlbihyZXNvbHZlKVxuICAgICAgICAgIC5jYXRjaChyZWplY3QpO1xuICAgICAgfTtcblxuICAgICAgdGhpcy53cy5hZGRFdmVudExpc3RlbmVyKFwib3BlblwiLCB0aGlzLndzT25PcGVuKTtcbiAgICB9KTtcblxuICAgIHJldHVybiBQcm9taXNlLmFsbChbd2Vic29ja2V0Q29ubmVjdGlvbiwgdGhpcy51cGRhdGVUaW1lT2Zmc2V0KCldKTtcbiAgfVxuXG4gIGRpc2Nvbm5lY3QoKSB7XG4gICAgZGVidWcoYGRpc2Nvbm5lY3RpbmdgKTtcblxuICAgIGNsZWFyVGltZW91dCh0aGlzLnJlY29ubmVjdGlvblRpbWVvdXQpO1xuXG4gICAgdGhpcy5yZW1vdmVBbGxPY2N1cGFudHMoKTtcblxuICAgIGlmICh0aGlzLnB1Ymxpc2hlcikge1xuICAgICAgLy8gQ2xvc2UgdGhlIHB1Ymxpc2hlciBwZWVyIGNvbm5lY3Rpb24uIFdoaWNoIGFsc28gZGV0YWNoZXMgdGhlIHBsdWdpbiBoYW5kbGUuXG4gICAgICB0aGlzLnB1Ymxpc2hlci5jb25uLmNsb3NlKCk7XG4gICAgICB0aGlzLnB1Ymxpc2hlciA9IG51bGw7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuc2Vzc2lvbikge1xuICAgICAgdGhpcy5zZXNzaW9uLmRpc3Bvc2UoKTtcbiAgICAgIHRoaXMuc2Vzc2lvbiA9IG51bGw7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMud3MpIHtcbiAgICAgIHRoaXMud3MucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm9wZW5cIiwgdGhpcy53c09uT3Blbik7XG4gICAgICB0aGlzLndzLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJjbG9zZVwiLCB0aGlzLm9uV2Vic29ja2V0Q2xvc2UpO1xuICAgICAgdGhpcy53cy5yZW1vdmVFdmVudExpc3RlbmVyKFwibWVzc2FnZVwiLCB0aGlzLm9uV2Vic29ja2V0TWVzc2FnZSk7XG4gICAgICB0aGlzLndzLmNsb3NlKCk7XG4gICAgICB0aGlzLndzID0gbnVsbDtcbiAgICB9XG5cbiAgICAvLyBOb3cgdGhhdCBhbGwgUlRDUGVlckNvbm5lY3Rpb24gY2xvc2VkLCBiZSBzdXJlIHRvIG5vdCBjYWxsXG4gICAgLy8gcmVjb25uZWN0KCkgYWdhaW4gdmlhIHBlcmZvcm1EZWxheWVkUmVjb25uZWN0IGlmIHByZXZpb3VzXG4gICAgLy8gUlRDUGVlckNvbm5lY3Rpb24gd2FzIGluIHRoZSBmYWlsZWQgc3RhdGUuXG4gICAgaWYgKHRoaXMuZGVsYXllZFJlY29ubmVjdFRpbWVvdXQpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLmRlbGF5ZWRSZWNvbm5lY3RUaW1lb3V0KTtcbiAgICAgIHRoaXMuZGVsYXllZFJlY29ubmVjdFRpbWVvdXQgPSBudWxsO1xuICAgIH1cbiAgfVxuXG4gIGlzRGlzY29ubmVjdGVkKCkge1xuICAgIHJldHVybiB0aGlzLndzID09PSBudWxsO1xuICB9XG5cbiAgYXN5bmMgb25XZWJzb2NrZXRPcGVuKCkge1xuICAgIC8vIENyZWF0ZSB0aGUgSmFudXMgU2Vzc2lvblxuICAgIGF3YWl0IHRoaXMuc2Vzc2lvbi5jcmVhdGUoKTtcblxuICAgIC8vIEF0dGFjaCB0aGUgU0ZVIFBsdWdpbiBhbmQgY3JlYXRlIGEgUlRDUGVlckNvbm5lY3Rpb24gZm9yIHRoZSBwdWJsaXNoZXIuXG4gICAgLy8gVGhlIHB1Ymxpc2hlciBzZW5kcyBhdWRpbyBhbmQgb3BlbnMgdHdvIGJpZGlyZWN0aW9uYWwgZGF0YSBjaGFubmVscy5cbiAgICAvLyBPbmUgcmVsaWFibGUgZGF0YWNoYW5uZWwgYW5kIG9uZSB1bnJlbGlhYmxlLlxuICAgIHRoaXMucHVibGlzaGVyID0gYXdhaXQgdGhpcy5jcmVhdGVQdWJsaXNoZXIoKTtcblxuICAgIC8vIENhbGwgdGhlIG5hZiBjb25uZWN0U3VjY2VzcyBjYWxsYmFjayBiZWZvcmUgd2Ugc3RhcnQgcmVjZWl2aW5nIFdlYlJUQyBtZXNzYWdlcy5cbiAgICB0aGlzLmNvbm5lY3RTdWNjZXNzKHRoaXMuY2xpZW50SWQpO1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aGlzLnB1Ymxpc2hlci5pbml0aWFsT2NjdXBhbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBjb25zdCBvY2N1cGFudElkID0gdGhpcy5wdWJsaXNoZXIuaW5pdGlhbE9jY3VwYW50c1tpXTtcbiAgICAgIGlmIChvY2N1cGFudElkID09PSB0aGlzLmNsaWVudElkKSBjb250aW51ZTsgLy8gSGFwcGVucyBkdXJpbmcgbm9uLWdyYWNlZnVsIHJlY29ubmVjdHMgZHVlIHRvIHpvbWJpZSBzZXNzaW9uc1xuICAgICAgdGhpcy5hZGRBdmFpbGFibGVPY2N1cGFudChvY2N1cGFudElkKTtcbiAgICB9XG5cbiAgICB0aGlzLnN5bmNPY2N1cGFudHMoKTtcbiAgfVxuXG4gIG9uV2Vic29ja2V0Q2xvc2UoZXZlbnQpIHtcbiAgICAvLyBUaGUgY29ubmVjdGlvbiB3YXMgY2xvc2VkIHN1Y2Nlc3NmdWxseS4gRG9uJ3QgdHJ5IHRvIHJlY29ubmVjdC5cbiAgICBpZiAoZXZlbnQuY29kZSA9PT0gV1NfTk9STUFMX0NMT1NVUkUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zb2xlLndhcm4oXCJKYW51cyB3ZWJzb2NrZXQgY2xvc2VkIHVuZXhwZWN0ZWRseS5cIik7XG4gICAgaWYgKHRoaXMub25SZWNvbm5lY3RpbmcpIHtcbiAgICAgIHRoaXMub25SZWNvbm5lY3RpbmcodGhpcy5yZWNvbm5lY3Rpb25EZWxheSk7XG4gICAgfVxuXG4gICAgdGhpcy5yZWNvbm5lY3Rpb25UaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB0aGlzLnJlY29ubmVjdCgpLCB0aGlzLnJlY29ubmVjdGlvbkRlbGF5KTtcbiAgfVxuXG4gIHJlY29ubmVjdCgpIHtcbiAgICAvLyBEaXNwb3NlIG9mIGFsbCBuZXR3b3JrZWQgZW50aXRpZXMgYW5kIG90aGVyIHJlc291cmNlcyB0aWVkIHRvIHRoZSBzZXNzaW9uLlxuICAgIHRoaXMuZGlzY29ubmVjdCgpO1xuXG4gICAgdGhpcy5jb25uZWN0KClcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgdGhpcy5yZWNvbm5lY3Rpb25EZWxheSA9IHRoaXMuaW5pdGlhbFJlY29ubmVjdGlvbkRlbGF5O1xuICAgICAgICB0aGlzLnJlY29ubmVjdGlvbkF0dGVtcHRzID0gMDtcblxuICAgICAgICBpZiAodGhpcy5vblJlY29ubmVjdGVkKSB7XG4gICAgICAgICAgdGhpcy5vblJlY29ubmVjdGVkKCk7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICB0aGlzLnJlY29ubmVjdGlvbkRlbGF5ICs9IDEwMDA7XG4gICAgICAgIHRoaXMucmVjb25uZWN0aW9uQXR0ZW1wdHMrKztcblxuICAgICAgICBpZiAodGhpcy5yZWNvbm5lY3Rpb25BdHRlbXB0cyA+IHRoaXMubWF4UmVjb25uZWN0aW9uQXR0ZW1wdHMgJiYgdGhpcy5vblJlY29ubmVjdGlvbkVycm9yKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMub25SZWNvbm5lY3Rpb25FcnJvcihcbiAgICAgICAgICAgIG5ldyBFcnJvcihcIkNvbm5lY3Rpb24gY291bGQgbm90IGJlIHJlZXN0YWJsaXNoZWQsIGV4Y2VlZGVkIG1heGltdW0gbnVtYmVyIG9mIHJlY29ubmVjdGlvbiBhdHRlbXB0cy5cIilcbiAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc29sZS53YXJuKFwiRXJyb3IgZHVyaW5nIHJlY29ubmVjdCwgcmV0cnlpbmcuXCIpO1xuICAgICAgICBjb25zb2xlLndhcm4oZXJyb3IpO1xuXG4gICAgICAgIGlmICh0aGlzLm9uUmVjb25uZWN0aW5nKSB7XG4gICAgICAgICAgdGhpcy5vblJlY29ubmVjdGluZyh0aGlzLnJlY29ubmVjdGlvbkRlbGF5KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMucmVjb25uZWN0aW9uVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4gdGhpcy5yZWNvbm5lY3QoKSwgdGhpcy5yZWNvbm5lY3Rpb25EZWxheSk7XG4gICAgICB9KTtcbiAgfVxuXG4gIHBlcmZvcm1EZWxheWVkUmVjb25uZWN0KCkge1xuICAgIGlmICh0aGlzLmRlbGF5ZWRSZWNvbm5lY3RUaW1lb3V0KSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5kZWxheWVkUmVjb25uZWN0VGltZW91dCk7XG4gICAgfVxuXG4gICAgdGhpcy5kZWxheWVkUmVjb25uZWN0VGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy5kZWxheWVkUmVjb25uZWN0VGltZW91dCA9IG51bGw7XG4gICAgICB0aGlzLnJlY29ubmVjdCgpO1xuICAgIH0sIDEwMDAwKTtcbiAgfVxuXG4gIG9uV2Vic29ja2V0TWVzc2FnZShldmVudCkge1xuICAgIHRoaXMuc2Vzc2lvbi5yZWNlaXZlKEpTT04ucGFyc2UoZXZlbnQuZGF0YSkpO1xuICB9XG5cbiAgYWRkQXZhaWxhYmxlT2NjdXBhbnQob2NjdXBhbnRJZCkge1xuICAgIGlmICh0aGlzLmF2YWlsYWJsZU9jY3VwYW50cy5pbmRleE9mKG9jY3VwYW50SWQpID09PSAtMSkge1xuICAgICAgdGhpcy5hdmFpbGFibGVPY2N1cGFudHMucHVzaChvY2N1cGFudElkKTtcbiAgICB9XG4gIH1cblxuICByZW1vdmVBdmFpbGFibGVPY2N1cGFudChvY2N1cGFudElkKSB7XG4gICAgY29uc3QgaWR4ID0gdGhpcy5hdmFpbGFibGVPY2N1cGFudHMuaW5kZXhPZihvY2N1cGFudElkKTtcbiAgICBpZiAoaWR4ICE9PSAtMSkge1xuICAgICAgdGhpcy5hdmFpbGFibGVPY2N1cGFudHMuc3BsaWNlKGlkeCwgMSk7XG4gICAgfVxuICB9XG5cbiAgc3luY09jY3VwYW50cyhyZXF1ZXN0ZWRPY2N1cGFudHMpIHtcbiAgICBpZiAocmVxdWVzdGVkT2NjdXBhbnRzKSB7XG4gICAgICB0aGlzLnJlcXVlc3RlZE9jY3VwYW50cyA9IHJlcXVlc3RlZE9jY3VwYW50cztcbiAgICB9XG5cbiAgICBpZiAoIXRoaXMucmVxdWVzdGVkT2NjdXBhbnRzKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gQWRkIGFueSByZXF1ZXN0ZWQsIGF2YWlsYWJsZSwgYW5kIG5vbi1wZW5kaW5nIG9jY3VwYW50cy5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRoaXMucmVxdWVzdGVkT2NjdXBhbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBjb25zdCBvY2N1cGFudElkID0gdGhpcy5yZXF1ZXN0ZWRPY2N1cGFudHNbaV07XG4gICAgICBpZiAoIXRoaXMub2NjdXBhbnRzW29jY3VwYW50SWRdICYmIHRoaXMuYXZhaWxhYmxlT2NjdXBhbnRzLmluZGV4T2Yob2NjdXBhbnRJZCkgIT09IC0xICYmICF0aGlzLnBlbmRpbmdPY2N1cGFudHMuaGFzKG9jY3VwYW50SWQpKSB7XG4gICAgICAgIHRoaXMuYWRkT2NjdXBhbnQob2NjdXBhbnRJZCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gUmVtb3ZlIGFueSB1bnJlcXVlc3RlZCBhbmQgY3VycmVudGx5IGFkZGVkIG9jY3VwYW50cy5cbiAgICBmb3IgKGxldCBqID0gMDsgaiA8IHRoaXMuYXZhaWxhYmxlT2NjdXBhbnRzLmxlbmd0aDsgaisrKSB7XG4gICAgICBjb25zdCBvY2N1cGFudElkID0gdGhpcy5hdmFpbGFibGVPY2N1cGFudHNbal07XG4gICAgICBpZiAodGhpcy5vY2N1cGFudHNbb2NjdXBhbnRJZF0gJiYgdGhpcy5yZXF1ZXN0ZWRPY2N1cGFudHMuaW5kZXhPZihvY2N1cGFudElkKSA9PT0gLTEpIHtcbiAgICAgICAgdGhpcy5yZW1vdmVPY2N1cGFudChvY2N1cGFudElkKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBDYWxsIHRoZSBOZXR3b3JrZWQgQUZyYW1lIGNhbGxiYWNrcyBmb3IgdGhlIHVwZGF0ZWQgb2NjdXBhbnRzIGxpc3QuXG4gICAgdGhpcy5vbk9jY3VwYW50c0NoYW5nZWQodGhpcy5vY2N1cGFudHMpO1xuICB9XG5cbiAgYXN5bmMgYWRkT2NjdXBhbnQob2NjdXBhbnRJZCkge1xuICAgIHRoaXMucGVuZGluZ09jY3VwYW50cy5hZGQob2NjdXBhbnRJZCk7XG4gICAgXG4gICAgY29uc3QgYXZhaWxhYmxlT2NjdXBhbnRzQ291bnQgPSB0aGlzLmF2YWlsYWJsZU9jY3VwYW50cy5sZW5ndGg7XG4gICAgaWYgKGF2YWlsYWJsZU9jY3VwYW50c0NvdW50ID4gQVZBSUxBQkxFX09DQ1VQQU5UU19USFJFU0hPTEQpIHtcbiAgICAgIGF3YWl0IHJhbmRvbURlbGF5KDAsIE1BWF9TVUJTQ1JJQkVfREVMQVkpO1xuICAgIH1cbiAgXG4gICAgY29uc3Qgc3Vic2NyaWJlciA9IGF3YWl0IHRoaXMuY3JlYXRlU3Vic2NyaWJlcihvY2N1cGFudElkKTtcbiAgICBpZiAoc3Vic2NyaWJlcikge1xuICAgICAgaWYoIXRoaXMucGVuZGluZ09jY3VwYW50cy5oYXMob2NjdXBhbnRJZCkpIHtcbiAgICAgICAgc3Vic2NyaWJlci5jb25uLmNsb3NlKCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnBlbmRpbmdPY2N1cGFudHMuZGVsZXRlKG9jY3VwYW50SWQpO1xuICAgICAgICB0aGlzLm9jY3VwYW50SWRzLnB1c2gob2NjdXBhbnRJZCk7XG4gICAgICAgIHRoaXMub2NjdXBhbnRzW29jY3VwYW50SWRdID0gc3Vic2NyaWJlcjtcblxuICAgICAgICB0aGlzLnNldE1lZGlhU3RyZWFtKG9jY3VwYW50SWQsIHN1YnNjcmliZXIubWVkaWFTdHJlYW0pO1xuXG4gICAgICAgIC8vIENhbGwgdGhlIE5ldHdvcmtlZCBBRnJhbWUgY2FsbGJhY2tzIGZvciB0aGUgbmV3IG9jY3VwYW50LlxuICAgICAgICB0aGlzLm9uT2NjdXBhbnRDb25uZWN0ZWQob2NjdXBhbnRJZCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmVtb3ZlQWxsT2NjdXBhbnRzKCkge1xuICAgIHRoaXMucGVuZGluZ09jY3VwYW50cy5jbGVhcigpO1xuICAgIGZvciAobGV0IGkgPSB0aGlzLm9jY3VwYW50SWRzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICB0aGlzLnJlbW92ZU9jY3VwYW50KHRoaXMub2NjdXBhbnRJZHNbaV0pO1xuICAgIH1cbiAgfVxuXG4gIHJlbW92ZU9jY3VwYW50KG9jY3VwYW50SWQpIHtcbiAgICB0aGlzLnBlbmRpbmdPY2N1cGFudHMuZGVsZXRlKG9jY3VwYW50SWQpO1xuICAgIFxuICAgIGlmICh0aGlzLm9jY3VwYW50c1tvY2N1cGFudElkXSkge1xuICAgICAgLy8gQ2xvc2UgdGhlIHN1YnNjcmliZXIgcGVlciBjb25uZWN0aW9uLiBXaGljaCBhbHNvIGRldGFjaGVzIHRoZSBwbHVnaW4gaGFuZGxlLlxuICAgICAgdGhpcy5vY2N1cGFudHNbb2NjdXBhbnRJZF0uY29ubi5jbG9zZSgpO1xuICAgICAgZGVsZXRlIHRoaXMub2NjdXBhbnRzW29jY3VwYW50SWRdO1xuICAgICAgXG4gICAgICB0aGlzLm9jY3VwYW50SWRzLnNwbGljZSh0aGlzLm9jY3VwYW50SWRzLmluZGV4T2Yob2NjdXBhbnRJZCksIDEpO1xuICAgIH1cblxuICAgIGlmICh0aGlzLm1lZGlhU3RyZWFtc1tvY2N1cGFudElkXSkge1xuICAgICAgZGVsZXRlIHRoaXMubWVkaWFTdHJlYW1zW29jY3VwYW50SWRdO1xuICAgIH1cblxuICAgIGlmICh0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmhhcyhvY2N1cGFudElkKSkge1xuICAgICAgY29uc3QgbXNnID0gXCJUaGUgdXNlciBkaXNjb25uZWN0ZWQgYmVmb3JlIHRoZSBtZWRpYSBzdHJlYW0gd2FzIHJlc29sdmVkLlwiO1xuICAgICAgdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5nZXQob2NjdXBhbnRJZCkuYXVkaW8ucmVqZWN0KG1zZyk7XG4gICAgICB0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmdldChvY2N1cGFudElkKS52aWRlby5yZWplY3QobXNnKTtcbiAgICAgIHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuZGVsZXRlKG9jY3VwYW50SWQpO1xuICAgIH1cblxuICAgIC8vIENhbGwgdGhlIE5ldHdvcmtlZCBBRnJhbWUgY2FsbGJhY2tzIGZvciB0aGUgcmVtb3ZlZCBvY2N1cGFudC5cbiAgICB0aGlzLm9uT2NjdXBhbnREaXNjb25uZWN0ZWQob2NjdXBhbnRJZCk7XG4gIH1cblxuICBhc3NvY2lhdGUoY29ubiwgaGFuZGxlKSB7XG4gICAgY29ubi5hZGRFdmVudExpc3RlbmVyKFwiaWNlY2FuZGlkYXRlXCIsIGV2ID0+IHtcbiAgICAgIGhhbmRsZS5zZW5kVHJpY2tsZShldi5jYW5kaWRhdGUgfHwgbnVsbCkuY2F0Y2goZSA9PiBlcnJvcihcIkVycm9yIHRyaWNrbGluZyBJQ0U6ICVvXCIsIGUpKTtcbiAgICB9KTtcbiAgICBjb25uLmFkZEV2ZW50TGlzdGVuZXIoXCJpY2Vjb25uZWN0aW9uc3RhdGVjaGFuZ2VcIiwgZXYgPT4ge1xuICAgICAgaWYgKGNvbm4uaWNlQ29ubmVjdGlvblN0YXRlID09PSBcImNvbm5lY3RlZFwiKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKFwiSUNFIHN0YXRlIGNoYW5nZWQgdG8gY29ubmVjdGVkXCIpO1xuICAgICAgfVxuICAgICAgaWYgKGNvbm4uaWNlQ29ubmVjdGlvblN0YXRlID09PSBcImRpc2Nvbm5lY3RlZFwiKSB7XG4gICAgICAgIGNvbnNvbGUud2FybihcIklDRSBzdGF0ZSBjaGFuZ2VkIHRvIGRpc2Nvbm5lY3RlZFwiKTtcbiAgICAgIH1cbiAgICAgIGlmIChjb25uLmljZUNvbm5lY3Rpb25TdGF0ZSA9PT0gXCJmYWlsZWRcIikge1xuICAgICAgICBjb25zb2xlLndhcm4oXCJJQ0UgZmFpbHVyZSBkZXRlY3RlZC4gUmVjb25uZWN0aW5nIGluIDEwcy5cIik7XG4gICAgICAgIHRoaXMucGVyZm9ybURlbGF5ZWRSZWNvbm5lY3QoKTtcbiAgICAgIH1cbiAgICB9KVxuXG4gICAgLy8gd2UgaGF2ZSB0byBkZWJvdW5jZSB0aGVzZSBiZWNhdXNlIGphbnVzIGdldHMgYW5ncnkgaWYgeW91IHNlbmQgaXQgYSBuZXcgU0RQIGJlZm9yZVxuICAgIC8vIGl0J3MgZmluaXNoZWQgcHJvY2Vzc2luZyBhbiBleGlzdGluZyBTRFAuIGluIGFjdHVhbGl0eSwgaXQgc2VlbXMgbGlrZSB0aGlzIGlzIG1heWJlXG4gICAgLy8gdG9vIGxpYmVyYWwgYW5kIHdlIG5lZWQgdG8gd2FpdCBzb21lIGFtb3VudCBvZiB0aW1lIGFmdGVyIGFuIG9mZmVyIGJlZm9yZSBzZW5kaW5nIGFub3RoZXIsXG4gICAgLy8gYnV0IHdlIGRvbid0IGN1cnJlbnRseSBrbm93IGFueSBnb29kIHdheSBvZiBkZXRlY3RpbmcgZXhhY3RseSBob3cgbG9uZyA6KFxuICAgIGNvbm4uYWRkRXZlbnRMaXN0ZW5lcihcbiAgICAgIFwibmVnb3RpYXRpb25uZWVkZWRcIixcbiAgICAgIGRlYm91bmNlKGV2ID0+IHtcbiAgICAgICAgZGVidWcoXCJTZW5kaW5nIG5ldyBvZmZlciBmb3IgaGFuZGxlOiAlb1wiLCBoYW5kbGUpO1xuICAgICAgICB2YXIgb2ZmZXIgPSBjb25uLmNyZWF0ZU9mZmVyKCkudGhlbih0aGlzLmNvbmZpZ3VyZVB1Ymxpc2hlclNkcCkudGhlbih0aGlzLmZpeFNhZmFyaUljZVVGcmFnKTtcbiAgICAgICAgdmFyIGxvY2FsID0gb2ZmZXIudGhlbihvID0+IGNvbm4uc2V0TG9jYWxEZXNjcmlwdGlvbihvKSk7XG4gICAgICAgIHZhciByZW1vdGUgPSBvZmZlcjtcblxuICAgICAgICByZW1vdGUgPSByZW1vdGVcbiAgICAgICAgICAudGhlbih0aGlzLmZpeFNhZmFyaUljZVVGcmFnKVxuICAgICAgICAgIC50aGVuKGogPT4gaGFuZGxlLnNlbmRKc2VwKGopKVxuICAgICAgICAgIC50aGVuKHIgPT4gY29ubi5zZXRSZW1vdGVEZXNjcmlwdGlvbihyLmpzZXApKTtcbiAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKFtsb2NhbCwgcmVtb3RlXSkuY2F0Y2goZSA9PiBlcnJvcihcIkVycm9yIG5lZ290aWF0aW5nIG9mZmVyOiAlb1wiLCBlKSk7XG4gICAgICB9KVxuICAgICk7XG4gICAgaGFuZGxlLm9uKFxuICAgICAgXCJldmVudFwiLFxuICAgICAgZGVib3VuY2UoZXYgPT4ge1xuICAgICAgICB2YXIganNlcCA9IGV2LmpzZXA7XG4gICAgICAgIGlmIChqc2VwICYmIGpzZXAudHlwZSA9PSBcIm9mZmVyXCIpIHtcbiAgICAgICAgICBkZWJ1ZyhcIkFjY2VwdGluZyBuZXcgb2ZmZXIgZm9yIGhhbmRsZTogJW9cIiwgaGFuZGxlKTtcbiAgICAgICAgICB2YXIgYW5zd2VyID0gY29ublxuICAgICAgICAgICAgLnNldFJlbW90ZURlc2NyaXB0aW9uKHRoaXMuY29uZmlndXJlU3Vic2NyaWJlclNkcChqc2VwKSlcbiAgICAgICAgICAgIC50aGVuKF8gPT4gY29ubi5jcmVhdGVBbnN3ZXIoKSlcbiAgICAgICAgICAgIC50aGVuKHRoaXMuZml4U2FmYXJpSWNlVUZyYWcpO1xuICAgICAgICAgIHZhciBsb2NhbCA9IGFuc3dlci50aGVuKGEgPT4gY29ubi5zZXRMb2NhbERlc2NyaXB0aW9uKGEpKTtcbiAgICAgICAgICB2YXIgcmVtb3RlID0gYW5zd2VyLnRoZW4oaiA9PiBoYW5kbGUuc2VuZEpzZXAoaikpO1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLmFsbChbbG9jYWwsIHJlbW90ZV0pLmNhdGNoKGUgPT4gZXJyb3IoXCJFcnJvciBuZWdvdGlhdGluZyBhbnN3ZXI6ICVvXCIsIGUpKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBzb21lIG90aGVyIGtpbmQgb2YgZXZlbnQsIG5vdGhpbmcgdG8gZG9cbiAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICApO1xuICB9XG5cbiAgYXN5bmMgY3JlYXRlUHVibGlzaGVyKCkge1xuICAgIHZhciBoYW5kbGUgPSBuZXcgbWouSmFudXNQbHVnaW5IYW5kbGUodGhpcy5zZXNzaW9uKTtcbiAgICB2YXIgY29ubiA9IG5ldyBSVENQZWVyQ29ubmVjdGlvbih0aGlzLnBlZXJDb25uZWN0aW9uQ29uZmlnIHx8IERFRkFVTFRfUEVFUl9DT05ORUNUSU9OX0NPTkZJRyk7XG5cbiAgICBkZWJ1ZyhcInB1YiB3YWl0aW5nIGZvciBzZnVcIik7XG4gICAgYXdhaXQgaGFuZGxlLmF0dGFjaChcImphbnVzLnBsdWdpbi5zZnVcIiwgdGhpcy5sb29wcyAmJiB0aGlzLmNsaWVudElkID8gcGFyc2VJbnQodGhpcy5jbGllbnRJZCkgJSB0aGlzLmxvb3BzIDogdW5kZWZpbmVkKTtcblxuICAgIHRoaXMuYXNzb2NpYXRlKGNvbm4sIGhhbmRsZSk7XG5cbiAgICBkZWJ1ZyhcInB1YiB3YWl0aW5nIGZvciBkYXRhIGNoYW5uZWxzICYgd2VicnRjdXBcIik7XG4gICAgdmFyIHdlYnJ0Y3VwID0gbmV3IFByb21pc2UocmVzb2x2ZSA9PiBoYW5kbGUub24oXCJ3ZWJydGN1cFwiLCByZXNvbHZlKSk7XG5cbiAgICAvLyBVbnJlbGlhYmxlIGRhdGFjaGFubmVsOiBzZW5kaW5nIGFuZCByZWNlaXZpbmcgY29tcG9uZW50IHVwZGF0ZXMuXG4gICAgLy8gUmVsaWFibGUgZGF0YWNoYW5uZWw6IHNlbmRpbmcgYW5kIHJlY2lldmluZyBlbnRpdHkgaW5zdGFudGlhdGlvbnMuXG4gICAgdmFyIHJlbGlhYmxlQ2hhbm5lbCA9IGNvbm4uY3JlYXRlRGF0YUNoYW5uZWwoXCJyZWxpYWJsZVwiLCB7IG9yZGVyZWQ6IHRydWUgfSk7XG4gICAgdmFyIHVucmVsaWFibGVDaGFubmVsID0gY29ubi5jcmVhdGVEYXRhQ2hhbm5lbChcInVucmVsaWFibGVcIiwge1xuICAgICAgb3JkZXJlZDogZmFsc2UsXG4gICAgICBtYXhSZXRyYW5zbWl0czogMFxuICAgIH0pO1xuXG4gICAgcmVsaWFibGVDaGFubmVsLmFkZEV2ZW50TGlzdGVuZXIoXCJtZXNzYWdlXCIsIGUgPT4gdGhpcy5vbkRhdGFDaGFubmVsTWVzc2FnZShlLCBcImphbnVzLXJlbGlhYmxlXCIpKTtcbiAgICB1bnJlbGlhYmxlQ2hhbm5lbC5hZGRFdmVudExpc3RlbmVyKFwibWVzc2FnZVwiLCBlID0+IHRoaXMub25EYXRhQ2hhbm5lbE1lc3NhZ2UoZSwgXCJqYW51cy11bnJlbGlhYmxlXCIpKTtcblxuICAgIGF3YWl0IHdlYnJ0Y3VwO1xuICAgIGF3YWl0IHVudGlsRGF0YUNoYW5uZWxPcGVuKHJlbGlhYmxlQ2hhbm5lbCk7XG4gICAgYXdhaXQgdW50aWxEYXRhQ2hhbm5lbE9wZW4odW5yZWxpYWJsZUNoYW5uZWwpO1xuXG4gICAgLy8gZG9pbmcgdGhpcyBoZXJlIGlzIHNvcnQgb2YgYSBoYWNrIGFyb3VuZCBjaHJvbWUgcmVuZWdvdGlhdGlvbiB3ZWlyZG5lc3MgLS1cbiAgICAvLyBpZiB3ZSBkbyBpdCBwcmlvciB0byB3ZWJydGN1cCwgY2hyb21lIG9uIGdlYXIgVlIgd2lsbCBzb21ldGltZXMgcHV0IGFcbiAgICAvLyByZW5lZ290aWF0aW9uIG9mZmVyIGluIGZsaWdodCB3aGlsZSB0aGUgZmlyc3Qgb2ZmZXIgd2FzIHN0aWxsIGJlaW5nXG4gICAgLy8gcHJvY2Vzc2VkIGJ5IGphbnVzLiB3ZSBzaG91bGQgZmluZCBzb21lIG1vcmUgcHJpbmNpcGxlZCB3YXkgdG8gZmlndXJlIG91dFxuICAgIC8vIHdoZW4gamFudXMgaXMgZG9uZSBpbiB0aGUgZnV0dXJlLlxuICAgIGlmICh0aGlzLmxvY2FsTWVkaWFTdHJlYW0pIHtcbiAgICAgIHRoaXMubG9jYWxNZWRpYVN0cmVhbS5nZXRUcmFja3MoKS5mb3JFYWNoKHRyYWNrID0+IHtcbiAgICAgICAgY29ubi5hZGRUcmFjayh0cmFjaywgdGhpcy5sb2NhbE1lZGlhU3RyZWFtKTtcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIEhhbmRsZSBhbGwgb2YgdGhlIGpvaW4gYW5kIGxlYXZlIGV2ZW50cy5cbiAgICBoYW5kbGUub24oXCJldmVudFwiLCBldiA9PiB7XG4gICAgICB2YXIgZGF0YSA9IGV2LnBsdWdpbmRhdGEuZGF0YTtcbiAgICAgIGlmIChkYXRhLmV2ZW50ID09IFwiam9pblwiICYmIGRhdGEucm9vbV9pZCA9PSB0aGlzLnJvb20pIHtcbiAgICAgICAgaWYgKHRoaXMuZGVsYXllZFJlY29ubmVjdFRpbWVvdXQpIHtcbiAgICAgICAgICAvLyBEb24ndCBjcmVhdGUgYSBuZXcgUlRDUGVlckNvbm5lY3Rpb24sIGFsbCBSVENQZWVyQ29ubmVjdGlvbiB3aWxsIGJlIGNsb3NlZCBpbiBsZXNzIHRoYW4gMTBzLlxuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmFkZEF2YWlsYWJsZU9jY3VwYW50KGRhdGEudXNlcl9pZCk7XG4gICAgICAgIHRoaXMuc3luY09jY3VwYW50cygpO1xuICAgICAgfSBlbHNlIGlmIChkYXRhLmV2ZW50ID09IFwibGVhdmVcIiAmJiBkYXRhLnJvb21faWQgPT0gdGhpcy5yb29tKSB7XG4gICAgICAgIHRoaXMucmVtb3ZlQXZhaWxhYmxlT2NjdXBhbnQoZGF0YS51c2VyX2lkKTtcbiAgICAgICAgdGhpcy5yZW1vdmVPY2N1cGFudChkYXRhLnVzZXJfaWQpO1xuICAgICAgfSBlbHNlIGlmIChkYXRhLmV2ZW50ID09IFwiYmxvY2tlZFwiKSB7XG4gICAgICAgIGRvY3VtZW50LmJvZHkuZGlzcGF0Y2hFdmVudChuZXcgQ3VzdG9tRXZlbnQoXCJibG9ja2VkXCIsIHsgZGV0YWlsOiB7IGNsaWVudElkOiBkYXRhLmJ5IH0gfSkpO1xuICAgICAgfSBlbHNlIGlmIChkYXRhLmV2ZW50ID09IFwidW5ibG9ja2VkXCIpIHtcbiAgICAgICAgZG9jdW1lbnQuYm9keS5kaXNwYXRjaEV2ZW50KG5ldyBDdXN0b21FdmVudChcInVuYmxvY2tlZFwiLCB7IGRldGFpbDogeyBjbGllbnRJZDogZGF0YS5ieSB9IH0pKTtcbiAgICAgIH0gZWxzZSBpZiAoZGF0YS5ldmVudCA9PT0gXCJkYXRhXCIpIHtcbiAgICAgICAgdGhpcy5vbkRhdGEoSlNPTi5wYXJzZShkYXRhLmJvZHkpLCBcImphbnVzLWV2ZW50XCIpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgZGVidWcoXCJwdWIgd2FpdGluZyBmb3Igam9pblwiKTtcblxuICAgIC8vIFNlbmQgam9pbiBtZXNzYWdlIHRvIGphbnVzLiBMaXN0ZW4gZm9yIGpvaW4vbGVhdmUgbWVzc2FnZXMuIEF1dG9tYXRpY2FsbHkgc3Vic2NyaWJlIHRvIGFsbCB1c2VycycgV2ViUlRDIGRhdGEuXG4gICAgdmFyIG1lc3NhZ2UgPSBhd2FpdCB0aGlzLnNlbmRKb2luKGhhbmRsZSwge1xuICAgICAgbm90aWZpY2F0aW9uczogdHJ1ZSxcbiAgICAgIGRhdGE6IHRydWVcbiAgICB9KTtcblxuICAgIGlmICghbWVzc2FnZS5wbHVnaW5kYXRhLmRhdGEuc3VjY2Vzcykge1xuICAgICAgY29uc3QgZXJyID0gbWVzc2FnZS5wbHVnaW5kYXRhLmRhdGEuZXJyb3I7XG4gICAgICBjb25zb2xlLmVycm9yKGVycik7XG4gICAgICAvLyBXZSBtYXkgZ2V0IGhlcmUgYmVjYXVzZSBvZiBhbiBleHBpcmVkIEpXVC5cbiAgICAgIC8vIENsb3NlIHRoZSBjb25uZWN0aW9uIG91cnNlbGYgb3RoZXJ3aXNlIGphbnVzIHdpbGwgY2xvc2UgaXQgYWZ0ZXJcbiAgICAgIC8vIHNlc3Npb25fdGltZW91dCBiZWNhdXNlIHdlIGRpZG4ndCBzZW5kIGFueSBrZWVwYWxpdmUgYW5kIHRoaXMgd2lsbFxuICAgICAgLy8gdHJpZ2dlciBhIGRlbGF5ZWQgcmVjb25uZWN0IGJlY2F1c2Ugb2YgdGhlIGljZWNvbm5lY3Rpb25zdGF0ZWNoYW5nZVxuICAgICAgLy8gbGlzdGVuZXIgZm9yIGZhaWx1cmUgc3RhdGUuXG4gICAgICAvLyBFdmVuIGlmIHRoZSBhcHAgY29kZSBjYWxscyBkaXNjb25uZWN0IGluIGNhc2Ugb2YgZXJyb3IsIGRpc2Nvbm5lY3RcbiAgICAgIC8vIHdvbid0IGNsb3NlIHRoZSBwZWVyIGNvbm5lY3Rpb24gYmVjYXVzZSB0aGlzLnB1Ymxpc2hlciBpcyBub3Qgc2V0LlxuICAgICAgY29ubi5jbG9zZSgpO1xuICAgICAgdGhyb3cgZXJyO1xuICAgIH1cblxuICAgIHZhciBpbml0aWFsT2NjdXBhbnRzID0gbWVzc2FnZS5wbHVnaW5kYXRhLmRhdGEucmVzcG9uc2UudXNlcnNbdGhpcy5yb29tXSB8fCBbXTtcblxuICAgIGlmIChpbml0aWFsT2NjdXBhbnRzLmluY2x1ZGVzKHRoaXMuY2xpZW50SWQpKSB7XG4gICAgICBjb25zb2xlLndhcm4oXCJKYW51cyBzdGlsbCBoYXMgcHJldmlvdXMgc2Vzc2lvbiBmb3IgdGhpcyBjbGllbnQuIFJlY29ubmVjdGluZyBpbiAxMHMuXCIpO1xuICAgICAgdGhpcy5wZXJmb3JtRGVsYXllZFJlY29ubmVjdCgpO1xuICAgIH1cblxuICAgIGRlYnVnKFwicHVibGlzaGVyIHJlYWR5XCIpO1xuICAgIHJldHVybiB7XG4gICAgICBoYW5kbGUsXG4gICAgICBpbml0aWFsT2NjdXBhbnRzLFxuICAgICAgcmVsaWFibGVDaGFubmVsLFxuICAgICAgdW5yZWxpYWJsZUNoYW5uZWwsXG4gICAgICBjb25uXG4gICAgfTtcbiAgfVxuXG4gIGNvbmZpZ3VyZVB1Ymxpc2hlclNkcChqc2VwKSB7XG4gICAganNlcC5zZHAgPSBqc2VwLnNkcC5yZXBsYWNlKC9hPWZtdHA6KDEwOXwxMTEpLipcXHJcXG4vZywgKGxpbmUsIHB0KSA9PiB7XG4gICAgICBjb25zdCBwYXJhbWV0ZXJzID0gT2JqZWN0LmFzc2lnbihzZHBVdGlscy5wYXJzZUZtdHAobGluZSksIE9QVVNfUEFSQU1FVEVSUyk7XG4gICAgICByZXR1cm4gc2RwVXRpbHMud3JpdGVGbXRwKHsgcGF5bG9hZFR5cGU6IHB0LCBwYXJhbWV0ZXJzOiBwYXJhbWV0ZXJzIH0pO1xuICAgIH0pO1xuICAgIHJldHVybiBqc2VwO1xuICB9XG5cbiAgY29uZmlndXJlU3Vic2NyaWJlclNkcChqc2VwKSB7XG4gICAgLy8gdG9kbzogY29uc2lkZXIgY2xlYW5pbmcgdXAgdGhlc2UgaGFja3MgdG8gdXNlIHNkcHV0aWxzXG4gICAgaWYgKCFpc0gyNjRWaWRlb1N1cHBvcnRlZCkge1xuICAgICAgaWYgKG5hdmlnYXRvci51c2VyQWdlbnQuaW5kZXhPZihcIkhlYWRsZXNzQ2hyb21lXCIpICE9PSAtMSkge1xuICAgICAgICAvLyBIZWFkbGVzc0Nocm9tZSAoZS5nLiBwdXBwZXRlZXIpIGRvZXNuJ3Qgc3VwcG9ydCB3ZWJydGMgdmlkZW8gc3RyZWFtcywgc28gd2UgcmVtb3ZlIHRob3NlIGxpbmVzIGZyb20gdGhlIFNEUC5cbiAgICAgICAganNlcC5zZHAgPSBqc2VwLnNkcC5yZXBsYWNlKC9tPXZpZGVvW15dKm09LywgXCJtPVwiKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBUT0RPOiBIYWNrIHRvIGdldCB2aWRlbyB3b3JraW5nIG9uIENocm9tZSBmb3IgQW5kcm9pZC4gaHR0cHM6Ly9ncm91cHMuZ29vZ2xlLmNvbS9mb3J1bS8jIXRvcGljL21vemlsbGEuZGV2Lm1lZGlhL1llMjl2dU1UcG84XG4gICAgaWYgKG5hdmlnYXRvci51c2VyQWdlbnQuaW5kZXhPZihcIkFuZHJvaWRcIikgPT09IC0xKSB7XG4gICAgICBqc2VwLnNkcCA9IGpzZXAuc2RwLnJlcGxhY2UoXG4gICAgICAgIFwiYT1ydGNwLWZiOjEwNyBnb29nLXJlbWJcXHJcXG5cIixcbiAgICAgICAgXCJhPXJ0Y3AtZmI6MTA3IGdvb2ctcmVtYlxcclxcbmE9cnRjcC1mYjoxMDcgdHJhbnNwb3J0LWNjXFxyXFxuYT1mbXRwOjEwNyBsZXZlbC1hc3ltbWV0cnktYWxsb3dlZD0xO3BhY2tldGl6YXRpb24tbW9kZT0xO3Byb2ZpbGUtbGV2ZWwtaWQ9NDJlMDFmXFxyXFxuXCJcbiAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGpzZXAuc2RwID0ganNlcC5zZHAucmVwbGFjZShcbiAgICAgICAgXCJhPXJ0Y3AtZmI6MTA3IGdvb2ctcmVtYlxcclxcblwiLFxuICAgICAgICBcImE9cnRjcC1mYjoxMDcgZ29vZy1yZW1iXFxyXFxuYT1ydGNwLWZiOjEwNyB0cmFuc3BvcnQtY2NcXHJcXG5hPWZtdHA6MTA3IGxldmVsLWFzeW1tZXRyeS1hbGxvd2VkPTE7cGFja2V0aXphdGlvbi1tb2RlPTE7cHJvZmlsZS1sZXZlbC1pZD00MjAwMWZcXHJcXG5cIlxuICAgICAgKTtcbiAgICB9XG4gICAgcmV0dXJuIGpzZXA7XG4gIH1cblxuICBhc3luYyBmaXhTYWZhcmlJY2VVRnJhZyhqc2VwKSB7XG4gICAgLy8gU2FmYXJpIHByb2R1Y2VzIGEgXFxuIGluc3RlYWQgb2YgYW4gXFxyXFxuIGZvciB0aGUgaWNlLXVmcmFnLiBTZWUgaHR0cHM6Ly9naXRodWIuY29tL21lZXRlY2hvL2phbnVzLWdhdGV3YXkvaXNzdWVzLzE4MThcbiAgICBqc2VwLnNkcCA9IGpzZXAuc2RwLnJlcGxhY2UoL1teXFxyXVxcbmE9aWNlLXVmcmFnL2csIFwiXFxyXFxuYT1pY2UtdWZyYWdcIik7XG4gICAgcmV0dXJuIGpzZXBcbiAgfVxuXG4gIGFzeW5jIGNyZWF0ZVN1YnNjcmliZXIob2NjdXBhbnRJZCwgbWF4UmV0cmllcyA9IDUpIHtcbiAgICBpZiAodGhpcy5hdmFpbGFibGVPY2N1cGFudHMuaW5kZXhPZihvY2N1cGFudElkKSA9PT0gLTEpIHtcbiAgICAgIGNvbnNvbGUud2FybihvY2N1cGFudElkICsgXCI6IGNhbmNlbGxlZCBvY2N1cGFudCBjb25uZWN0aW9uLCBvY2N1cGFudCBsZWZ0IGJlZm9yZSBzdWJzY3JpcHRpb24gbmVnb3RhdGlvbi5cIik7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICB2YXIgaGFuZGxlID0gbmV3IG1qLkphbnVzUGx1Z2luSGFuZGxlKHRoaXMuc2Vzc2lvbik7XG4gICAgdmFyIGNvbm4gPSBuZXcgUlRDUGVlckNvbm5lY3Rpb24odGhpcy5wZWVyQ29ubmVjdGlvbkNvbmZpZyB8fCBERUZBVUxUX1BFRVJfQ09OTkVDVElPTl9DT05GSUcpO1xuXG4gICAgZGVidWcob2NjdXBhbnRJZCArIFwiOiBzdWIgd2FpdGluZyBmb3Igc2Z1XCIpO1xuICAgIGF3YWl0IGhhbmRsZS5hdHRhY2goXCJqYW51cy5wbHVnaW4uc2Z1XCIsIHRoaXMubG9vcHMgPyBwYXJzZUludChvY2N1cGFudElkKSAlIHRoaXMubG9vcHMgOiB1bmRlZmluZWQpO1xuXG4gICAgdGhpcy5hc3NvY2lhdGUoY29ubiwgaGFuZGxlKTtcblxuICAgIGRlYnVnKG9jY3VwYW50SWQgKyBcIjogc3ViIHdhaXRpbmcgZm9yIGpvaW5cIik7XG5cbiAgICBpZiAodGhpcy5hdmFpbGFibGVPY2N1cGFudHMuaW5kZXhPZihvY2N1cGFudElkKSA9PT0gLTEpIHtcbiAgICAgIGNvbm4uY2xvc2UoKTtcbiAgICAgIGNvbnNvbGUud2FybihvY2N1cGFudElkICsgXCI6IGNhbmNlbGxlZCBvY2N1cGFudCBjb25uZWN0aW9uLCBvY2N1cGFudCBsZWZ0IGFmdGVyIGF0dGFjaFwiKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGxldCB3ZWJydGNGYWlsZWQgPSBmYWxzZTtcblxuICAgIGNvbnN0IHdlYnJ0Y3VwID0gbmV3IFByb21pc2UocmVzb2x2ZSA9PiB7XG4gICAgICBjb25zdCBsZWZ0SW50ZXJ2YWwgPSBzZXRJbnRlcnZhbCgoKSA9PiB7XG4gICAgICAgIGlmICh0aGlzLmF2YWlsYWJsZU9jY3VwYW50cy5pbmRleE9mKG9jY3VwYW50SWQpID09PSAtMSkge1xuICAgICAgICAgIGNsZWFySW50ZXJ2YWwobGVmdEludGVydmFsKTtcbiAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgIH1cbiAgICAgIH0sIDEwMDApO1xuXG4gICAgICBjb25zdCB0aW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIGNsZWFySW50ZXJ2YWwobGVmdEludGVydmFsKTtcbiAgICAgICAgd2VicnRjRmFpbGVkID0gdHJ1ZTtcbiAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgfSwgU1VCU0NSSUJFX1RJTUVPVVRfTVMpO1xuXG4gICAgICBoYW5kbGUub24oXCJ3ZWJydGN1cFwiLCAoKSA9PiB7XG4gICAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICAgICAgY2xlYXJJbnRlcnZhbChsZWZ0SW50ZXJ2YWwpO1xuICAgICAgICByZXNvbHZlKCk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIC8vIFNlbmQgam9pbiBtZXNzYWdlIHRvIGphbnVzLiBEb24ndCBsaXN0ZW4gZm9yIGpvaW4vbGVhdmUgbWVzc2FnZXMuIFN1YnNjcmliZSB0byB0aGUgb2NjdXBhbnQncyBtZWRpYS5cbiAgICAvLyBKYW51cyBzaG91bGQgc2VuZCB1cyBhbiBvZmZlciBmb3IgdGhpcyBvY2N1cGFudCdzIG1lZGlhIGluIHJlc3BvbnNlIHRvIHRoaXMuXG4gICAgYXdhaXQgdGhpcy5zZW5kSm9pbihoYW5kbGUsIHsgbWVkaWE6IG9jY3VwYW50SWQgfSk7XG5cbiAgICBpZiAodGhpcy5hdmFpbGFibGVPY2N1cGFudHMuaW5kZXhPZihvY2N1cGFudElkKSA9PT0gLTEpIHtcbiAgICAgIGNvbm4uY2xvc2UoKTtcbiAgICAgIGNvbnNvbGUud2FybihvY2N1cGFudElkICsgXCI6IGNhbmNlbGxlZCBvY2N1cGFudCBjb25uZWN0aW9uLCBvY2N1cGFudCBsZWZ0IGFmdGVyIGpvaW5cIik7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBkZWJ1ZyhvY2N1cGFudElkICsgXCI6IHN1YiB3YWl0aW5nIGZvciB3ZWJydGN1cFwiKTtcbiAgICBhd2FpdCB3ZWJydGN1cDtcblxuICAgIGlmICh0aGlzLmF2YWlsYWJsZU9jY3VwYW50cy5pbmRleE9mKG9jY3VwYW50SWQpID09PSAtMSkge1xuICAgICAgY29ubi5jbG9zZSgpO1xuICAgICAgY29uc29sZS53YXJuKG9jY3VwYW50SWQgKyBcIjogY2FuY2VsIG9jY3VwYW50IGNvbm5lY3Rpb24sIG9jY3VwYW50IGxlZnQgZHVyaW5nIG9yIGFmdGVyIHdlYnJ0Y3VwXCIpO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgaWYgKHdlYnJ0Y0ZhaWxlZCkge1xuICAgICAgY29ubi5jbG9zZSgpO1xuICAgICAgaWYgKG1heFJldHJpZXMgPiAwKSB7XG4gICAgICAgIGNvbnNvbGUud2FybihvY2N1cGFudElkICsgXCI6IHdlYnJ0YyB1cCB0aW1lZCBvdXQsIHJldHJ5aW5nXCIpO1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVTdWJzY3JpYmVyKG9jY3VwYW50SWQsIG1heFJldHJpZXMgLSAxKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnNvbGUud2FybihvY2N1cGFudElkICsgXCI6IHdlYnJ0YyB1cCB0aW1lZCBvdXRcIik7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChpc1NhZmFyaSAmJiAhdGhpcy5faU9TSGFja0RlbGF5ZWRJbml0aWFsUGVlcikge1xuICAgICAgLy8gSEFDSzogdGhlIGZpcnN0IHBlZXIgb24gU2FmYXJpIGR1cmluZyBwYWdlIGxvYWQgY2FuIGZhaWwgdG8gd29yayBpZiB3ZSBkb24ndFxuICAgICAgLy8gd2FpdCBzb21lIHRpbWUgYmVmb3JlIGNvbnRpbnVpbmcgaGVyZS4gU2VlOiBodHRwczovL2dpdGh1Yi5jb20vbW96aWxsYS9odWJzL3B1bGwvMTY5MlxuICAgICAgYXdhaXQgKG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDMwMDApKSk7XG4gICAgICB0aGlzLl9pT1NIYWNrRGVsYXllZEluaXRpYWxQZWVyID0gdHJ1ZTtcbiAgICB9XG5cbiAgICB2YXIgbWVkaWFTdHJlYW0gPSBuZXcgTWVkaWFTdHJlYW0oKTtcbiAgICB2YXIgcmVjZWl2ZXJzID0gY29ubi5nZXRSZWNlaXZlcnMoKTtcbiAgICByZWNlaXZlcnMuZm9yRWFjaChyZWNlaXZlciA9PiB7XG4gICAgICBpZiAocmVjZWl2ZXIudHJhY2spIHtcbiAgICAgICAgbWVkaWFTdHJlYW0uYWRkVHJhY2socmVjZWl2ZXIudHJhY2spO1xuICAgICAgfVxuICAgIH0pO1xuICAgIGlmIChtZWRpYVN0cmVhbS5nZXRUcmFja3MoKS5sZW5ndGggPT09IDApIHtcbiAgICAgIG1lZGlhU3RyZWFtID0gbnVsbDtcbiAgICB9XG5cbiAgICBkZWJ1ZyhvY2N1cGFudElkICsgXCI6IHN1YnNjcmliZXIgcmVhZHlcIik7XG4gICAgcmV0dXJuIHtcbiAgICAgIGhhbmRsZSxcbiAgICAgIG1lZGlhU3RyZWFtLFxuICAgICAgY29ublxuICAgIH07XG4gIH1cblxuICBzZW5kSm9pbihoYW5kbGUsIHN1YnNjcmliZSkge1xuICAgIHJldHVybiBoYW5kbGUuc2VuZE1lc3NhZ2Uoe1xuICAgICAga2luZDogXCJqb2luXCIsXG4gICAgICByb29tX2lkOiB0aGlzLnJvb20sXG4gICAgICB1c2VyX2lkOiB0aGlzLmNsaWVudElkLFxuICAgICAgc3Vic2NyaWJlLFxuICAgICAgdG9rZW46IHRoaXMuam9pblRva2VuXG4gICAgfSk7XG4gIH1cblxuICB0b2dnbGVGcmVlemUoKSB7XG4gICAgaWYgKHRoaXMuZnJvemVuKSB7XG4gICAgICB0aGlzLnVuZnJlZXplKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuZnJlZXplKCk7XG4gICAgfVxuICB9XG5cbiAgZnJlZXplKCkge1xuICAgIHRoaXMuZnJvemVuID0gdHJ1ZTtcbiAgfVxuXG4gIHVuZnJlZXplKCkge1xuICAgIHRoaXMuZnJvemVuID0gZmFsc2U7XG4gICAgdGhpcy5mbHVzaFBlbmRpbmdVcGRhdGVzKCk7XG4gIH1cblxuICBkYXRhRm9yVXBkYXRlTXVsdGlNZXNzYWdlKG5ldHdvcmtJZCwgbWVzc2FnZSkge1xuICAgIC8vIFwiZFwiIGlzIGFuIGFycmF5IG9mIGVudGl0eSBkYXRhcywgd2hlcmUgZWFjaCBpdGVtIGluIHRoZSBhcnJheSByZXByZXNlbnRzIGEgdW5pcXVlIGVudGl0eSBhbmQgY29udGFpbnNcbiAgICAvLyBtZXRhZGF0YSBmb3IgdGhlIGVudGl0eSwgYW5kIGFuIGFycmF5IG9mIGNvbXBvbmVudHMgdGhhdCBoYXZlIGJlZW4gdXBkYXRlZCBvbiB0aGUgZW50aXR5LlxuICAgIC8vIFRoaXMgbWV0aG9kIGZpbmRzIHRoZSBkYXRhIGNvcnJlc3BvbmRpbmcgdG8gdGhlIGdpdmVuIG5ldHdvcmtJZC5cbiAgICBmb3IgKGxldCBpID0gMCwgbCA9IG1lc3NhZ2UuZGF0YS5kLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgY29uc3QgZGF0YSA9IG1lc3NhZ2UuZGF0YS5kW2ldO1xuXG4gICAgICBpZiAoZGF0YS5uZXR3b3JrSWQgPT09IG5ldHdvcmtJZCkge1xuICAgICAgICByZXR1cm4gZGF0YTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGdldFBlbmRpbmdEYXRhKG5ldHdvcmtJZCwgbWVzc2FnZSkge1xuICAgIGlmICghbWVzc2FnZSkgcmV0dXJuIG51bGw7XG5cbiAgICBsZXQgZGF0YSA9IG1lc3NhZ2UuZGF0YVR5cGUgPT09IFwidW1cIiA/IHRoaXMuZGF0YUZvclVwZGF0ZU11bHRpTWVzc2FnZShuZXR3b3JrSWQsIG1lc3NhZ2UpIDogbWVzc2FnZS5kYXRhO1xuXG4gICAgLy8gSWdub3JlIG1lc3NhZ2VzIHJlbGF0aW5nIHRvIHVzZXJzIHdobyBoYXZlIGRpc2Nvbm5lY3RlZCBzaW5jZSBmcmVlemluZywgdGhlaXIgZW50aXRpZXNcbiAgICAvLyB3aWxsIGhhdmUgYWxlYWR5IGJlZW4gcmVtb3ZlZCBieSBOQUYuXG4gICAgLy8gTm90ZSB0aGF0IGRlbGV0ZSBtZXNzYWdlcyBoYXZlIG5vIFwib3duZXJcIiBzbyB3ZSBoYXZlIHRvIGNoZWNrIGZvciB0aGF0IGFzIHdlbGwuXG4gICAgaWYgKGRhdGEub3duZXIgJiYgIXRoaXMub2NjdXBhbnRzW2RhdGEub3duZXJdKSByZXR1cm4gbnVsbDtcblxuICAgIC8vIElnbm9yZSBtZXNzYWdlcyBmcm9tIHVzZXJzIHRoYXQgd2UgbWF5IGhhdmUgYmxvY2tlZCB3aGlsZSBmcm96ZW4uXG4gICAgaWYgKGRhdGEub3duZXIgJiYgdGhpcy5ibG9ja2VkQ2xpZW50cy5oYXMoZGF0YS5vd25lcikpIHJldHVybiBudWxsO1xuXG4gICAgcmV0dXJuIGRhdGFcbiAgfVxuXG4gIC8vIFVzZWQgZXh0ZXJuYWxseVxuICBnZXRQZW5kaW5nRGF0YUZvck5ldHdvcmtJZChuZXR3b3JrSWQpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRQZW5kaW5nRGF0YShuZXR3b3JrSWQsIHRoaXMuZnJvemVuVXBkYXRlcy5nZXQobmV0d29ya0lkKSk7XG4gIH1cblxuICBmbHVzaFBlbmRpbmdVcGRhdGVzKCkge1xuICAgIGZvciAoY29uc3QgW25ldHdvcmtJZCwgbWVzc2FnZV0gb2YgdGhpcy5mcm96ZW5VcGRhdGVzKSB7XG4gICAgICBsZXQgZGF0YSA9IHRoaXMuZ2V0UGVuZGluZ0RhdGEobmV0d29ya0lkLCBtZXNzYWdlKTtcbiAgICAgIGlmICghZGF0YSkgY29udGludWU7XG5cbiAgICAgIC8vIE92ZXJyaWRlIHRoZSBkYXRhIHR5cGUgb24gXCJ1bVwiIG1lc3NhZ2VzIHR5cGVzLCBzaW5jZSB3ZSBleHRyYWN0IGVudGl0eSB1cGRhdGVzIGZyb20gXCJ1bVwiIG1lc3NhZ2VzIGludG9cbiAgICAgIC8vIGluZGl2aWR1YWwgZnJvemVuVXBkYXRlcyBpbiBzdG9yZVNpbmdsZU1lc3NhZ2UuXG4gICAgICBjb25zdCBkYXRhVHlwZSA9IG1lc3NhZ2UuZGF0YVR5cGUgPT09IFwidW1cIiA/IFwidVwiIDogbWVzc2FnZS5kYXRhVHlwZTtcblxuICAgICAgdGhpcy5vbk9jY3VwYW50TWVzc2FnZShudWxsLCBkYXRhVHlwZSwgZGF0YSwgbWVzc2FnZS5zb3VyY2UpO1xuICAgIH1cbiAgICB0aGlzLmZyb3plblVwZGF0ZXMuY2xlYXIoKTtcbiAgfVxuXG4gIHN0b3JlTWVzc2FnZShtZXNzYWdlKSB7XG4gICAgaWYgKG1lc3NhZ2UuZGF0YVR5cGUgPT09IFwidW1cIikgeyAvLyBVcGRhdGVNdWx0aVxuICAgICAgZm9yIChsZXQgaSA9IDAsIGwgPSBtZXNzYWdlLmRhdGEuZC5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAgICAgdGhpcy5zdG9yZVNpbmdsZU1lc3NhZ2UobWVzc2FnZSwgaSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuc3RvcmVTaW5nbGVNZXNzYWdlKG1lc3NhZ2UpO1xuICAgIH1cbiAgfVxuXG4gIHN0b3JlU2luZ2xlTWVzc2FnZShtZXNzYWdlLCBpbmRleCkge1xuICAgIGNvbnN0IGRhdGEgPSBpbmRleCAhPT0gdW5kZWZpbmVkID8gbWVzc2FnZS5kYXRhLmRbaW5kZXhdIDogbWVzc2FnZS5kYXRhO1xuICAgIGNvbnN0IGRhdGFUeXBlID0gbWVzc2FnZS5kYXRhVHlwZTtcbiAgICBjb25zdCBzb3VyY2UgPSBtZXNzYWdlLnNvdXJjZTtcblxuICAgIGNvbnN0IG5ldHdvcmtJZCA9IGRhdGEubmV0d29ya0lkO1xuXG4gICAgaWYgKCF0aGlzLmZyb3plblVwZGF0ZXMuaGFzKG5ldHdvcmtJZCkpIHtcbiAgICAgIHRoaXMuZnJvemVuVXBkYXRlcy5zZXQobmV0d29ya0lkLCBtZXNzYWdlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3Qgc3RvcmVkTWVzc2FnZSA9IHRoaXMuZnJvemVuVXBkYXRlcy5nZXQobmV0d29ya0lkKTtcbiAgICAgIGNvbnN0IHN0b3JlZERhdGEgPSBzdG9yZWRNZXNzYWdlLmRhdGFUeXBlID09PSBcInVtXCIgPyB0aGlzLmRhdGFGb3JVcGRhdGVNdWx0aU1lc3NhZ2UobmV0d29ya0lkLCBzdG9yZWRNZXNzYWdlKSA6IHN0b3JlZE1lc3NhZ2UuZGF0YTtcblxuICAgICAgLy8gQXZvaWQgdXBkYXRpbmcgY29tcG9uZW50cyBpZiB0aGUgZW50aXR5IGRhdGEgcmVjZWl2ZWQgZGlkIG5vdCBjb21lIGZyb20gdGhlIGN1cnJlbnQgb3duZXIuXG4gICAgICBjb25zdCBpc091dGRhdGVkTWVzc2FnZSA9IGRhdGEubGFzdE93bmVyVGltZSA8IHN0b3JlZERhdGEubGFzdE93bmVyVGltZTtcbiAgICAgIGNvbnN0IGlzQ29udGVtcG9yYW5lb3VzTWVzc2FnZSA9IGRhdGEubGFzdE93bmVyVGltZSA9PT0gc3RvcmVkRGF0YS5sYXN0T3duZXJUaW1lO1xuICAgICAgaWYgKGlzT3V0ZGF0ZWRNZXNzYWdlIHx8IChpc0NvbnRlbXBvcmFuZW91c01lc3NhZ2UgJiYgc3RvcmVkRGF0YS5vd25lciA+IGRhdGEub3duZXIpKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKGRhdGFUeXBlID09PSBcInJcIikge1xuICAgICAgICBjb25zdCBjcmVhdGVkV2hpbGVGcm96ZW4gPSBzdG9yZWREYXRhICYmIHN0b3JlZERhdGEuaXNGaXJzdFN5bmM7XG4gICAgICAgIGlmIChjcmVhdGVkV2hpbGVGcm96ZW4pIHtcbiAgICAgICAgICAvLyBJZiB0aGUgZW50aXR5IHdhcyBjcmVhdGVkIGFuZCBkZWxldGVkIHdoaWxlIGZyb3plbiwgZG9uJ3QgYm90aGVyIGNvbnZleWluZyBhbnl0aGluZyB0byB0aGUgY29uc3VtZXIuXG4gICAgICAgICAgdGhpcy5mcm96ZW5VcGRhdGVzLmRlbGV0ZShuZXR3b3JrSWQpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIERlbGV0ZSBtZXNzYWdlcyBvdmVycmlkZSBhbnkgb3RoZXIgbWVzc2FnZXMgZm9yIHRoaXMgZW50aXR5XG4gICAgICAgICAgdGhpcy5mcm96ZW5VcGRhdGVzLnNldChuZXR3b3JrSWQsIG1lc3NhZ2UpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBtZXJnZSBpbiBjb21wb25lbnQgdXBkYXRlc1xuICAgICAgICBpZiAoc3RvcmVkRGF0YS5jb21wb25lbnRzICYmIGRhdGEuY29tcG9uZW50cykge1xuICAgICAgICAgIE9iamVjdC5hc3NpZ24oc3RvcmVkRGF0YS5jb21wb25lbnRzLCBkYXRhLmNvbXBvbmVudHMpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgb25EYXRhQ2hhbm5lbE1lc3NhZ2UoZSwgc291cmNlKSB7XG4gICAgdGhpcy5vbkRhdGEoSlNPTi5wYXJzZShlLmRhdGEpLCBzb3VyY2UpO1xuICB9XG5cbiAgb25EYXRhKG1lc3NhZ2UsIHNvdXJjZSkge1xuICAgIGlmIChkZWJ1Zy5lbmFibGVkKSB7XG4gICAgICBkZWJ1ZyhgREMgaW46ICR7bWVzc2FnZX1gKTtcbiAgICB9XG5cbiAgICBpZiAoIW1lc3NhZ2UuZGF0YVR5cGUpIHJldHVybjtcblxuICAgIG1lc3NhZ2Uuc291cmNlID0gc291cmNlO1xuXG4gICAgaWYgKHRoaXMuZnJvemVuKSB7XG4gICAgICB0aGlzLnN0b3JlTWVzc2FnZShtZXNzYWdlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5vbk9jY3VwYW50TWVzc2FnZShudWxsLCBtZXNzYWdlLmRhdGFUeXBlLCBtZXNzYWdlLmRhdGEsIG1lc3NhZ2Uuc291cmNlKTtcbiAgICB9XG4gIH1cblxuICBzaG91bGRTdGFydENvbm5lY3Rpb25UbyhjbGllbnQpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIHN0YXJ0U3RyZWFtQ29ubmVjdGlvbihjbGllbnQpIHt9XG5cbiAgY2xvc2VTdHJlYW1Db25uZWN0aW9uKGNsaWVudCkge31cblxuICBnZXRDb25uZWN0U3RhdHVzKGNsaWVudElkKSB7XG4gICAgcmV0dXJuIHRoaXMub2NjdXBhbnRzW2NsaWVudElkXSA/IE5BRi5hZGFwdGVycy5JU19DT05ORUNURUQgOiBOQUYuYWRhcHRlcnMuTk9UX0NPTk5FQ1RFRDtcbiAgfVxuXG4gIGFzeW5jIHVwZGF0ZVRpbWVPZmZzZXQoKSB7XG4gICAgaWYgKHRoaXMuaXNEaXNjb25uZWN0ZWQoKSkgcmV0dXJuO1xuXG4gICAgY29uc3QgY2xpZW50U2VudFRpbWUgPSBEYXRlLm5vdygpO1xuXG4gICAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2goZG9jdW1lbnQubG9jYXRpb24uaHJlZiwge1xuICAgICAgbWV0aG9kOiBcIkhFQURcIixcbiAgICAgIGNhY2hlOiBcIm5vLWNhY2hlXCJcbiAgICB9KTtcblxuICAgIGNvbnN0IHByZWNpc2lvbiA9IDEwMDA7XG4gICAgY29uc3Qgc2VydmVyUmVjZWl2ZWRUaW1lID0gbmV3IERhdGUocmVzLmhlYWRlcnMuZ2V0KFwiRGF0ZVwiKSkuZ2V0VGltZSgpICsgcHJlY2lzaW9uIC8gMjtcbiAgICBjb25zdCBjbGllbnRSZWNlaXZlZFRpbWUgPSBEYXRlLm5vdygpO1xuICAgIGNvbnN0IHNlcnZlclRpbWUgPSBzZXJ2ZXJSZWNlaXZlZFRpbWUgKyAoY2xpZW50UmVjZWl2ZWRUaW1lIC0gY2xpZW50U2VudFRpbWUpIC8gMjtcbiAgICBjb25zdCB0aW1lT2Zmc2V0ID0gc2VydmVyVGltZSAtIGNsaWVudFJlY2VpdmVkVGltZTtcblxuICAgIHRoaXMuc2VydmVyVGltZVJlcXVlc3RzKys7XG5cbiAgICBpZiAodGhpcy5zZXJ2ZXJUaW1lUmVxdWVzdHMgPD0gMTApIHtcbiAgICAgIHRoaXMudGltZU9mZnNldHMucHVzaCh0aW1lT2Zmc2V0KTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy50aW1lT2Zmc2V0c1t0aGlzLnNlcnZlclRpbWVSZXF1ZXN0cyAlIDEwXSA9IHRpbWVPZmZzZXQ7XG4gICAgfVxuXG4gICAgdGhpcy5hdmdUaW1lT2Zmc2V0ID0gdGhpcy50aW1lT2Zmc2V0cy5yZWR1Y2UoKGFjYywgb2Zmc2V0KSA9PiAoYWNjICs9IG9mZnNldCksIDApIC8gdGhpcy50aW1lT2Zmc2V0cy5sZW5ndGg7XG5cbiAgICBpZiAodGhpcy5zZXJ2ZXJUaW1lUmVxdWVzdHMgPiAxMCkge1xuICAgICAgZGVidWcoYG5ldyBzZXJ2ZXIgdGltZSBvZmZzZXQ6ICR7dGhpcy5hdmdUaW1lT2Zmc2V0fW1zYCk7XG4gICAgICBzZXRUaW1lb3V0KCgpID0+IHRoaXMudXBkYXRlVGltZU9mZnNldCgpLCA1ICogNjAgKiAxMDAwKTsgLy8gU3luYyBjbG9jayBldmVyeSA1IG1pbnV0ZXMuXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMudXBkYXRlVGltZU9mZnNldCgpO1xuICAgIH1cbiAgfVxuXG4gIGdldFNlcnZlclRpbWUoKSB7XG4gICAgcmV0dXJuIERhdGUubm93KCkgKyB0aGlzLmF2Z1RpbWVPZmZzZXQ7XG4gIH1cblxuICBnZXRNZWRpYVN0cmVhbShjbGllbnRJZCwgdHlwZSA9IFwiYXVkaW9cIikge1xuICAgIGlmICh0aGlzLm1lZGlhU3RyZWFtc1tjbGllbnRJZF0pIHtcbiAgICAgIGRlYnVnKGBBbHJlYWR5IGhhZCAke3R5cGV9IGZvciAke2NsaWVudElkfWApO1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh0aGlzLm1lZGlhU3RyZWFtc1tjbGllbnRJZF1bdHlwZV0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBkZWJ1ZyhgV2FpdGluZyBvbiAke3R5cGV9IGZvciAke2NsaWVudElkfWApO1xuICAgICAgaWYgKCF0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmhhcyhjbGllbnRJZCkpIHtcbiAgICAgICAgdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5zZXQoY2xpZW50SWQsIHt9KTtcblxuICAgICAgICBjb25zdCBhdWRpb1Byb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgICAgdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5nZXQoY2xpZW50SWQpLmF1ZGlvID0geyByZXNvbHZlLCByZWplY3QgfTtcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IHZpZGVvUHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgICB0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmdldChjbGllbnRJZCkudmlkZW8gPSB7IHJlc29sdmUsIHJlamVjdCB9O1xuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmdldChjbGllbnRJZCkuYXVkaW8ucHJvbWlzZSA9IGF1ZGlvUHJvbWlzZTtcbiAgICAgICAgdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5nZXQoY2xpZW50SWQpLnZpZGVvLnByb21pc2UgPSB2aWRlb1Byb21pc2U7XG5cbiAgICAgICAgYXVkaW9Qcm9taXNlLmNhdGNoKGUgPT4gY29uc29sZS53YXJuKGAke2NsaWVudElkfSBnZXRNZWRpYVN0cmVhbSBBdWRpbyBFcnJvcmAsIGUpKTtcbiAgICAgICAgdmlkZW9Qcm9taXNlLmNhdGNoKGUgPT4gY29uc29sZS53YXJuKGAke2NsaWVudElkfSBnZXRNZWRpYVN0cmVhbSBWaWRlbyBFcnJvcmAsIGUpKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmdldChjbGllbnRJZClbdHlwZV0ucHJvbWlzZTtcbiAgICB9XG4gIH1cblxuICBzZXRNZWRpYVN0cmVhbShjbGllbnRJZCwgc3RyZWFtKSB7XG4gICAgLy8gU2FmYXJpIGRvZXNuJ3QgbGlrZSBpdCB3aGVuIHlvdSB1c2Ugc2luZ2xlIGEgbWl4ZWQgbWVkaWEgc3RyZWFtIHdoZXJlIG9uZSBvZiB0aGUgdHJhY2tzIGlzIGluYWN0aXZlLCBzbyB3ZVxuICAgIC8vIHNwbGl0IHRoZSB0cmFja3MgaW50byB0d28gc3RyZWFtcy5cbiAgICBjb25zdCBhdWRpb1N0cmVhbSA9IG5ldyBNZWRpYVN0cmVhbSgpO1xuICAgIHRyeSB7XG4gICAgc3RyZWFtLmdldEF1ZGlvVHJhY2tzKCkuZm9yRWFjaCh0cmFjayA9PiBhdWRpb1N0cmVhbS5hZGRUcmFjayh0cmFjaykpO1xuXG4gICAgfSBjYXRjaChlKSB7XG4gICAgICBjb25zb2xlLndhcm4oYCR7Y2xpZW50SWR9IHNldE1lZGlhU3RyZWFtIEF1ZGlvIEVycm9yYCwgZSk7XG4gICAgfVxuICAgIGNvbnN0IHZpZGVvU3RyZWFtID0gbmV3IE1lZGlhU3RyZWFtKCk7XG4gICAgdHJ5IHtcbiAgICBzdHJlYW0uZ2V0VmlkZW9UcmFja3MoKS5mb3JFYWNoKHRyYWNrID0+IHZpZGVvU3RyZWFtLmFkZFRyYWNrKHRyYWNrKSk7XG5cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjb25zb2xlLndhcm4oYCR7Y2xpZW50SWR9IHNldE1lZGlhU3RyZWFtIFZpZGVvIEVycm9yYCwgZSk7XG4gICAgfVxuXG4gICAgdGhpcy5tZWRpYVN0cmVhbXNbY2xpZW50SWRdID0geyBhdWRpbzogYXVkaW9TdHJlYW0sIHZpZGVvOiB2aWRlb1N0cmVhbSB9O1xuXG4gICAgLy8gUmVzb2x2ZSB0aGUgcHJvbWlzZSBmb3IgdGhlIHVzZXIncyBtZWRpYSBzdHJlYW0gaWYgaXQgZXhpc3RzLlxuICAgIGlmICh0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmhhcyhjbGllbnRJZCkpIHtcbiAgICAgIHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuZ2V0KGNsaWVudElkKS5hdWRpby5yZXNvbHZlKGF1ZGlvU3RyZWFtKTtcbiAgICAgIHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuZ2V0KGNsaWVudElkKS52aWRlby5yZXNvbHZlKHZpZGVvU3RyZWFtKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBzZXRMb2NhbE1lZGlhU3RyZWFtKHN0cmVhbSkge1xuICAgIC8vIG91ciBqb2IgaGVyZSBpcyB0byBtYWtlIHN1cmUgdGhlIGNvbm5lY3Rpb24gd2luZHMgdXAgd2l0aCBSVFAgc2VuZGVycyBzZW5kaW5nIHRoZSBzdHVmZiBpbiB0aGlzIHN0cmVhbSxcbiAgICAvLyBhbmQgbm90IHRoZSBzdHVmZiB0aGF0IGlzbid0IGluIHRoaXMgc3RyZWFtLiBzdHJhdGVneSBpcyB0byByZXBsYWNlIGV4aXN0aW5nIHRyYWNrcyBpZiB3ZSBjYW4sIGFkZCB0cmFja3NcbiAgICAvLyB0aGF0IHdlIGNhbid0IHJlcGxhY2UsIGFuZCBkaXNhYmxlIHRyYWNrcyB0aGF0IGRvbid0IGV4aXN0IGFueW1vcmUuXG5cbiAgICAvLyBub3RlIHRoYXQgd2UgZG9uJ3QgZXZlciByZW1vdmUgYSB0cmFjayBmcm9tIHRoZSBzdHJlYW0gLS0gc2luY2UgSmFudXMgZG9lc24ndCBzdXBwb3J0IFVuaWZpZWQgUGxhbiwgd2UgYWJzb2x1dGVseVxuICAgIC8vIGNhbid0IHdpbmQgdXAgd2l0aCBhIFNEUCB0aGF0IGhhcyA+MSBhdWRpbyBvciA+MSB2aWRlbyB0cmFja3MsIGV2ZW4gaWYgb25lIG9mIHRoZW0gaXMgaW5hY3RpdmUgKHdoYXQgeW91IGdldCBpZlxuICAgIC8vIHlvdSByZW1vdmUgYSB0cmFjayBmcm9tIGFuIGV4aXN0aW5nIHN0cmVhbS4pXG4gICAgaWYgKHRoaXMucHVibGlzaGVyICYmIHRoaXMucHVibGlzaGVyLmNvbm4pIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nU2VuZGVycyA9IHRoaXMucHVibGlzaGVyLmNvbm4uZ2V0U2VuZGVycygpO1xuICAgICAgY29uc3QgbmV3U2VuZGVycyA9IFtdO1xuICAgICAgY29uc3QgdHJhY2tzID0gc3RyZWFtLmdldFRyYWNrcygpO1xuXG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRyYWNrcy5sZW5ndGg7IGkrKykge1xuICAgICAgICBjb25zdCB0ID0gdHJhY2tzW2ldO1xuICAgICAgICBjb25zdCBzZW5kZXIgPSBleGlzdGluZ1NlbmRlcnMuZmluZChzID0+IHMudHJhY2sgIT0gbnVsbCAmJiBzLnRyYWNrLmtpbmQgPT0gdC5raW5kKTtcblxuICAgICAgICBpZiAoc2VuZGVyICE9IG51bGwpIHtcbiAgICAgICAgICBpZiAoc2VuZGVyLnJlcGxhY2VUcmFjaykge1xuICAgICAgICAgICAgYXdhaXQgc2VuZGVyLnJlcGxhY2VUcmFjayh0KTtcblxuICAgICAgICAgICAgLy8gV29ya2Fyb3VuZCBodHRwczovL2J1Z3ppbGxhLm1vemlsbGEub3JnL3Nob3dfYnVnLmNnaT9pZD0xNTc2NzcxXG4gICAgICAgICAgICBpZiAodC5raW5kID09PSBcInZpZGVvXCIgJiYgdC5lbmFibGVkICYmIG5hdmlnYXRvci51c2VyQWdlbnQudG9Mb3dlckNhc2UoKS5pbmRleE9mKCdmaXJlZm94JykgPiAtMSkge1xuICAgICAgICAgICAgICB0LmVuYWJsZWQgPSBmYWxzZTtcbiAgICAgICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB0LmVuYWJsZWQgPSB0cnVlLCAxMDAwKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gRmFsbGJhY2sgZm9yIGJyb3dzZXJzIHRoYXQgZG9uJ3Qgc3VwcG9ydCByZXBsYWNlVHJhY2suIEF0IHRoaXMgdGltZSBvZiB0aGlzIHdyaXRpbmdcbiAgICAgICAgICAgIC8vIG1vc3QgYnJvd3NlcnMgc3VwcG9ydCBpdCwgYW5kIHRlc3RpbmcgdGhpcyBjb2RlIHBhdGggc2VlbXMgdG8gbm90IHdvcmsgcHJvcGVybHlcbiAgICAgICAgICAgIC8vIGluIENocm9tZSBhbnltb3JlLlxuICAgICAgICAgICAgc3RyZWFtLnJlbW92ZVRyYWNrKHNlbmRlci50cmFjayk7XG4gICAgICAgICAgICBzdHJlYW0uYWRkVHJhY2sodCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIG5ld1NlbmRlcnMucHVzaChzZW5kZXIpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIG5ld1NlbmRlcnMucHVzaCh0aGlzLnB1Ymxpc2hlci5jb25uLmFkZFRyYWNrKHQsIHN0cmVhbSkpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBleGlzdGluZ1NlbmRlcnMuZm9yRWFjaChzID0+IHtcbiAgICAgICAgaWYgKCFuZXdTZW5kZXJzLmluY2x1ZGVzKHMpKSB7XG4gICAgICAgICAgcy50cmFjay5lbmFibGVkID0gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgICB0aGlzLmxvY2FsTWVkaWFTdHJlYW0gPSBzdHJlYW07XG4gICAgdGhpcy5zZXRNZWRpYVN0cmVhbSh0aGlzLmNsaWVudElkLCBzdHJlYW0pO1xuICB9XG5cbiAgZW5hYmxlTWljcm9waG9uZShlbmFibGVkKSB7XG4gICAgaWYgKHRoaXMucHVibGlzaGVyICYmIHRoaXMucHVibGlzaGVyLmNvbm4pIHtcbiAgICAgIHRoaXMucHVibGlzaGVyLmNvbm4uZ2V0U2VuZGVycygpLmZvckVhY2gocyA9PiB7XG4gICAgICAgIGlmIChzLnRyYWNrLmtpbmQgPT0gXCJhdWRpb1wiKSB7XG4gICAgICAgICAgcy50cmFjay5lbmFibGVkID0gZW5hYmxlZDtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgc2VuZERhdGEoY2xpZW50SWQsIGRhdGFUeXBlLCBkYXRhKSB7XG4gICAgaWYgKCF0aGlzLnB1Ymxpc2hlcikge1xuICAgICAgY29uc29sZS53YXJuKFwic2VuZERhdGEgY2FsbGVkIHdpdGhvdXQgYSBwdWJsaXNoZXJcIik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHN3aXRjaCAodGhpcy51bnJlbGlhYmxlVHJhbnNwb3J0KSB7XG4gICAgICAgIGNhc2UgXCJ3ZWJzb2NrZXRcIjpcbiAgICAgICAgICBpZiAodGhpcy53cy5yZWFkeVN0YXRlID09PSAxKSB7IC8vIE9QRU5cbiAgICAgICAgICAgIHRoaXMucHVibGlzaGVyLmhhbmRsZS5zZW5kTWVzc2FnZSh7IGtpbmQ6IFwiZGF0YVwiLCBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGRhdGFUeXBlLCBkYXRhIH0pLCB3aG9tOiBjbGllbnRJZCB9KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgXCJkYXRhY2hhbm5lbFwiOlxuICAgICAgICAgIGlmICh0aGlzLnB1Ymxpc2hlci51bnJlbGlhYmxlQ2hhbm5lbC5yZWFkeVN0YXRlID09PSBcIm9wZW5cIikge1xuICAgICAgICAgICAgdGhpcy5wdWJsaXNoZXIudW5yZWxpYWJsZUNoYW5uZWwuc2VuZChKU09OLnN0cmluZ2lmeSh7IGNsaWVudElkLCBkYXRhVHlwZSwgZGF0YSB9KSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHRoaXMudW5yZWxpYWJsZVRyYW5zcG9ydChjbGllbnRJZCwgZGF0YVR5cGUsIGRhdGEpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHNlbmREYXRhR3VhcmFudGVlZChjbGllbnRJZCwgZGF0YVR5cGUsIGRhdGEpIHtcbiAgICBpZiAoIXRoaXMucHVibGlzaGVyKSB7XG4gICAgICBjb25zb2xlLndhcm4oXCJzZW5kRGF0YUd1YXJhbnRlZWQgY2FsbGVkIHdpdGhvdXQgYSBwdWJsaXNoZXJcIik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHN3aXRjaCAodGhpcy5yZWxpYWJsZVRyYW5zcG9ydCkge1xuICAgICAgICBjYXNlIFwid2Vic29ja2V0XCI6XG4gICAgICAgICAgaWYgKHRoaXMud3MucmVhZHlTdGF0ZSA9PT0gMSkgeyAvLyBPUEVOXG4gICAgICAgICAgICB0aGlzLnB1Ymxpc2hlci5oYW5kbGUuc2VuZE1lc3NhZ2UoeyBraW5kOiBcImRhdGFcIiwgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBkYXRhVHlwZSwgZGF0YSB9KSwgd2hvbTogY2xpZW50SWQgfSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIFwiZGF0YWNoYW5uZWxcIjpcbiAgICAgICAgICBpZiAodGhpcy5wdWJsaXNoZXIucmVsaWFibGVDaGFubmVsLnJlYWR5U3RhdGUgPT09IFwib3BlblwiKSB7XG4gICAgICAgICAgICB0aGlzLnB1Ymxpc2hlci5yZWxpYWJsZUNoYW5uZWwuc2VuZChKU09OLnN0cmluZ2lmeSh7IGNsaWVudElkLCBkYXRhVHlwZSwgZGF0YSB9KSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHRoaXMucmVsaWFibGVUcmFuc3BvcnQoY2xpZW50SWQsIGRhdGFUeXBlLCBkYXRhKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBicm9hZGNhc3REYXRhKGRhdGFUeXBlLCBkYXRhKSB7XG4gICAgaWYgKCF0aGlzLnB1Ymxpc2hlcikge1xuICAgICAgY29uc29sZS53YXJuKFwiYnJvYWRjYXN0RGF0YSBjYWxsZWQgd2l0aG91dCBhIHB1Ymxpc2hlclwiKTtcbiAgICB9IGVsc2Uge1xuICAgICAgc3dpdGNoICh0aGlzLnVucmVsaWFibGVUcmFuc3BvcnQpIHtcbiAgICAgICAgY2FzZSBcIndlYnNvY2tldFwiOlxuICAgICAgICAgIGlmICh0aGlzLndzLnJlYWR5U3RhdGUgPT09IDEpIHsgLy8gT1BFTlxuICAgICAgICAgICAgdGhpcy5wdWJsaXNoZXIuaGFuZGxlLnNlbmRNZXNzYWdlKHsga2luZDogXCJkYXRhXCIsIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZGF0YVR5cGUsIGRhdGEgfSkgfSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIFwiZGF0YWNoYW5uZWxcIjpcbiAgICAgICAgICBpZiAodGhpcy5wdWJsaXNoZXIudW5yZWxpYWJsZUNoYW5uZWwucmVhZHlTdGF0ZSA9PT0gXCJvcGVuXCIpIHtcbiAgICAgICAgICAgIHRoaXMucHVibGlzaGVyLnVucmVsaWFibGVDaGFubmVsLnNlbmQoSlNPTi5zdHJpbmdpZnkoeyBkYXRhVHlwZSwgZGF0YSB9KSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHRoaXMudW5yZWxpYWJsZVRyYW5zcG9ydCh1bmRlZmluZWQsIGRhdGFUeXBlLCBkYXRhKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBicm9hZGNhc3REYXRhR3VhcmFudGVlZChkYXRhVHlwZSwgZGF0YSkge1xuICAgIGlmICghdGhpcy5wdWJsaXNoZXIpIHtcbiAgICAgIGNvbnNvbGUud2FybihcImJyb2FkY2FzdERhdGFHdWFyYW50ZWVkIGNhbGxlZCB3aXRob3V0IGEgcHVibGlzaGVyXCIpO1xuICAgIH0gZWxzZSB7XG4gICAgICBzd2l0Y2ggKHRoaXMucmVsaWFibGVUcmFuc3BvcnQpIHtcbiAgICAgICAgY2FzZSBcIndlYnNvY2tldFwiOlxuICAgICAgICAgIGlmICh0aGlzLndzLnJlYWR5U3RhdGUgPT09IDEpIHsgLy8gT1BFTlxuICAgICAgICAgICAgdGhpcy5wdWJsaXNoZXIuaGFuZGxlLnNlbmRNZXNzYWdlKHsga2luZDogXCJkYXRhXCIsIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZGF0YVR5cGUsIGRhdGEgfSkgfSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIFwiZGF0YWNoYW5uZWxcIjpcbiAgICAgICAgICBpZiAodGhpcy5wdWJsaXNoZXIucmVsaWFibGVDaGFubmVsLnJlYWR5U3RhdGUgPT09IFwib3BlblwiKSB7XG4gICAgICAgICAgICB0aGlzLnB1Ymxpc2hlci5yZWxpYWJsZUNoYW5uZWwuc2VuZChKU09OLnN0cmluZ2lmeSh7IGRhdGFUeXBlLCBkYXRhIH0pKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgdGhpcy5yZWxpYWJsZVRyYW5zcG9ydCh1bmRlZmluZWQsIGRhdGFUeXBlLCBkYXRhKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBraWNrKGNsaWVudElkLCBwZXJtc1Rva2VuKSB7XG4gICAgcmV0dXJuIHRoaXMucHVibGlzaGVyLmhhbmRsZS5zZW5kTWVzc2FnZSh7IGtpbmQ6IFwia2lja1wiLCByb29tX2lkOiB0aGlzLnJvb20sIHVzZXJfaWQ6IGNsaWVudElkLCB0b2tlbjogcGVybXNUb2tlbiB9KS50aGVuKCgpID0+IHtcbiAgICAgIGRvY3VtZW50LmJvZHkuZGlzcGF0Y2hFdmVudChuZXcgQ3VzdG9tRXZlbnQoXCJraWNrZWRcIiwgeyBkZXRhaWw6IHsgY2xpZW50SWQ6IGNsaWVudElkIH0gfSkpO1xuICAgIH0pO1xuICB9XG5cbiAgYmxvY2soY2xpZW50SWQpIHtcbiAgICByZXR1cm4gdGhpcy5wdWJsaXNoZXIuaGFuZGxlLnNlbmRNZXNzYWdlKHsga2luZDogXCJibG9ja1wiLCB3aG9tOiBjbGllbnRJZCB9KS50aGVuKCgpID0+IHtcbiAgICAgIHRoaXMuYmxvY2tlZENsaWVudHMuc2V0KGNsaWVudElkLCB0cnVlKTtcbiAgICAgIGRvY3VtZW50LmJvZHkuZGlzcGF0Y2hFdmVudChuZXcgQ3VzdG9tRXZlbnQoXCJibG9ja2VkXCIsIHsgZGV0YWlsOiB7IGNsaWVudElkOiBjbGllbnRJZCB9IH0pKTtcbiAgICB9KTtcbiAgfVxuXG4gIHVuYmxvY2soY2xpZW50SWQpIHtcbiAgICByZXR1cm4gdGhpcy5wdWJsaXNoZXIuaGFuZGxlLnNlbmRNZXNzYWdlKHsga2luZDogXCJ1bmJsb2NrXCIsIHdob206IGNsaWVudElkIH0pLnRoZW4oKCkgPT4ge1xuICAgICAgdGhpcy5ibG9ja2VkQ2xpZW50cy5kZWxldGUoY2xpZW50SWQpO1xuICAgICAgZG9jdW1lbnQuYm9keS5kaXNwYXRjaEV2ZW50KG5ldyBDdXN0b21FdmVudChcInVuYmxvY2tlZFwiLCB7IGRldGFpbDogeyBjbGllbnRJZDogY2xpZW50SWQgfSB9KSk7XG4gICAgfSk7XG4gIH1cbn1cblxuTkFGLmFkYXB0ZXJzLnJlZ2lzdGVyKFwiamFudXNcIiwgSmFudXNBZGFwdGVyKTtcblxubW9kdWxlLmV4cG9ydHMgPSBKYW51c0FkYXB0ZXI7XG4iLCIvKiBlc2xpbnQtZW52IGJyb3dzZXIgKi9cblxuLyoqXG4gKiBUaGlzIGlzIHRoZSB3ZWIgYnJvd3NlciBpbXBsZW1lbnRhdGlvbiBvZiBgZGVidWcoKWAuXG4gKi9cblxuZXhwb3J0cy5mb3JtYXRBcmdzID0gZm9ybWF0QXJncztcbmV4cG9ydHMuc2F2ZSA9IHNhdmU7XG5leHBvcnRzLmxvYWQgPSBsb2FkO1xuZXhwb3J0cy51c2VDb2xvcnMgPSB1c2VDb2xvcnM7XG5leHBvcnRzLnN0b3JhZ2UgPSBsb2NhbHN0b3JhZ2UoKTtcbmV4cG9ydHMuZGVzdHJveSA9ICgoKSA9PiB7XG5cdGxldCB3YXJuZWQgPSBmYWxzZTtcblxuXHRyZXR1cm4gKCkgPT4ge1xuXHRcdGlmICghd2FybmVkKSB7XG5cdFx0XHR3YXJuZWQgPSB0cnVlO1xuXHRcdFx0Y29uc29sZS53YXJuKCdJbnN0YW5jZSBtZXRob2QgYGRlYnVnLmRlc3Ryb3koKWAgaXMgZGVwcmVjYXRlZCBhbmQgbm8gbG9uZ2VyIGRvZXMgYW55dGhpbmcuIEl0IHdpbGwgYmUgcmVtb3ZlZCBpbiB0aGUgbmV4dCBtYWpvciB2ZXJzaW9uIG9mIGBkZWJ1Z2AuJyk7XG5cdFx0fVxuXHR9O1xufSkoKTtcblxuLyoqXG4gKiBDb2xvcnMuXG4gKi9cblxuZXhwb3J0cy5jb2xvcnMgPSBbXG5cdCcjMDAwMENDJyxcblx0JyMwMDAwRkYnLFxuXHQnIzAwMzNDQycsXG5cdCcjMDAzM0ZGJyxcblx0JyMwMDY2Q0MnLFxuXHQnIzAwNjZGRicsXG5cdCcjMDA5OUNDJyxcblx0JyMwMDk5RkYnLFxuXHQnIzAwQ0MwMCcsXG5cdCcjMDBDQzMzJyxcblx0JyMwMENDNjYnLFxuXHQnIzAwQ0M5OScsXG5cdCcjMDBDQ0NDJyxcblx0JyMwMENDRkYnLFxuXHQnIzMzMDBDQycsXG5cdCcjMzMwMEZGJyxcblx0JyMzMzMzQ0MnLFxuXHQnIzMzMzNGRicsXG5cdCcjMzM2NkNDJyxcblx0JyMzMzY2RkYnLFxuXHQnIzMzOTlDQycsXG5cdCcjMzM5OUZGJyxcblx0JyMzM0NDMDAnLFxuXHQnIzMzQ0MzMycsXG5cdCcjMzNDQzY2Jyxcblx0JyMzM0NDOTknLFxuXHQnIzMzQ0NDQycsXG5cdCcjMzNDQ0ZGJyxcblx0JyM2NjAwQ0MnLFxuXHQnIzY2MDBGRicsXG5cdCcjNjYzM0NDJyxcblx0JyM2NjMzRkYnLFxuXHQnIzY2Q0MwMCcsXG5cdCcjNjZDQzMzJyxcblx0JyM5OTAwQ0MnLFxuXHQnIzk5MDBGRicsXG5cdCcjOTkzM0NDJyxcblx0JyM5OTMzRkYnLFxuXHQnIzk5Q0MwMCcsXG5cdCcjOTlDQzMzJyxcblx0JyNDQzAwMDAnLFxuXHQnI0NDMDAzMycsXG5cdCcjQ0MwMDY2Jyxcblx0JyNDQzAwOTknLFxuXHQnI0NDMDBDQycsXG5cdCcjQ0MwMEZGJyxcblx0JyNDQzMzMDAnLFxuXHQnI0NDMzMzMycsXG5cdCcjQ0MzMzY2Jyxcblx0JyNDQzMzOTknLFxuXHQnI0NDMzNDQycsXG5cdCcjQ0MzM0ZGJyxcblx0JyNDQzY2MDAnLFxuXHQnI0NDNjYzMycsXG5cdCcjQ0M5OTAwJyxcblx0JyNDQzk5MzMnLFxuXHQnI0NDQ0MwMCcsXG5cdCcjQ0NDQzMzJyxcblx0JyNGRjAwMDAnLFxuXHQnI0ZGMDAzMycsXG5cdCcjRkYwMDY2Jyxcblx0JyNGRjAwOTknLFxuXHQnI0ZGMDBDQycsXG5cdCcjRkYwMEZGJyxcblx0JyNGRjMzMDAnLFxuXHQnI0ZGMzMzMycsXG5cdCcjRkYzMzY2Jyxcblx0JyNGRjMzOTknLFxuXHQnI0ZGMzNDQycsXG5cdCcjRkYzM0ZGJyxcblx0JyNGRjY2MDAnLFxuXHQnI0ZGNjYzMycsXG5cdCcjRkY5OTAwJyxcblx0JyNGRjk5MzMnLFxuXHQnI0ZGQ0MwMCcsXG5cdCcjRkZDQzMzJ1xuXTtcblxuLyoqXG4gKiBDdXJyZW50bHkgb25seSBXZWJLaXQtYmFzZWQgV2ViIEluc3BlY3RvcnMsIEZpcmVmb3ggPj0gdjMxLFxuICogYW5kIHRoZSBGaXJlYnVnIGV4dGVuc2lvbiAoYW55IEZpcmVmb3ggdmVyc2lvbikgYXJlIGtub3duXG4gKiB0byBzdXBwb3J0IFwiJWNcIiBDU1MgY3VzdG9taXphdGlvbnMuXG4gKlxuICogVE9ETzogYWRkIGEgYGxvY2FsU3RvcmFnZWAgdmFyaWFibGUgdG8gZXhwbGljaXRseSBlbmFibGUvZGlzYWJsZSBjb2xvcnNcbiAqL1xuXG4vLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgY29tcGxleGl0eVxuZnVuY3Rpb24gdXNlQ29sb3JzKCkge1xuXHQvLyBOQjogSW4gYW4gRWxlY3Ryb24gcHJlbG9hZCBzY3JpcHQsIGRvY3VtZW50IHdpbGwgYmUgZGVmaW5lZCBidXQgbm90IGZ1bGx5XG5cdC8vIGluaXRpYWxpemVkLiBTaW5jZSB3ZSBrbm93IHdlJ3JlIGluIENocm9tZSwgd2UnbGwganVzdCBkZXRlY3QgdGhpcyBjYXNlXG5cdC8vIGV4cGxpY2l0bHlcblx0aWYgKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnICYmIHdpbmRvdy5wcm9jZXNzICYmICh3aW5kb3cucHJvY2Vzcy50eXBlID09PSAncmVuZGVyZXInIHx8IHdpbmRvdy5wcm9jZXNzLl9fbndqcykpIHtcblx0XHRyZXR1cm4gdHJ1ZTtcblx0fVxuXG5cdC8vIEludGVybmV0IEV4cGxvcmVyIGFuZCBFZGdlIGRvIG5vdCBzdXBwb3J0IGNvbG9ycy5cblx0aWYgKHR5cGVvZiBuYXZpZ2F0b3IgIT09ICd1bmRlZmluZWQnICYmIG5hdmlnYXRvci51c2VyQWdlbnQgJiYgbmF2aWdhdG9yLnVzZXJBZ2VudC50b0xvd2VyQ2FzZSgpLm1hdGNoKC8oZWRnZXx0cmlkZW50KVxcLyhcXGQrKS8pKSB7XG5cdFx0cmV0dXJuIGZhbHNlO1xuXHR9XG5cblx0Ly8gSXMgd2Via2l0PyBodHRwOi8vc3RhY2tvdmVyZmxvdy5jb20vYS8xNjQ1OTYwNi8zNzY3NzNcblx0Ly8gZG9jdW1lbnQgaXMgdW5kZWZpbmVkIGluIHJlYWN0LW5hdGl2ZTogaHR0cHM6Ly9naXRodWIuY29tL2ZhY2Vib29rL3JlYWN0LW5hdGl2ZS9wdWxsLzE2MzJcblx0cmV0dXJuICh0eXBlb2YgZG9jdW1lbnQgIT09ICd1bmRlZmluZWQnICYmIGRvY3VtZW50LmRvY3VtZW50RWxlbWVudCAmJiBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuc3R5bGUgJiYgZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LnN0eWxlLldlYmtpdEFwcGVhcmFuY2UpIHx8XG5cdFx0Ly8gSXMgZmlyZWJ1Zz8gaHR0cDovL3N0YWNrb3ZlcmZsb3cuY29tL2EvMzk4MTIwLzM3Njc3M1xuXHRcdCh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyAmJiB3aW5kb3cuY29uc29sZSAmJiAod2luZG93LmNvbnNvbGUuZmlyZWJ1ZyB8fCAod2luZG93LmNvbnNvbGUuZXhjZXB0aW9uICYmIHdpbmRvdy5jb25zb2xlLnRhYmxlKSkpIHx8XG5cdFx0Ly8gSXMgZmlyZWZveCA+PSB2MzE/XG5cdFx0Ly8gaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4tVVMvZG9jcy9Ub29scy9XZWJfQ29uc29sZSNTdHlsaW5nX21lc3NhZ2VzXG5cdFx0KHR5cGVvZiBuYXZpZ2F0b3IgIT09ICd1bmRlZmluZWQnICYmIG5hdmlnYXRvci51c2VyQWdlbnQgJiYgbmF2aWdhdG9yLnVzZXJBZ2VudC50b0xvd2VyQ2FzZSgpLm1hdGNoKC9maXJlZm94XFwvKFxcZCspLykgJiYgcGFyc2VJbnQoUmVnRXhwLiQxLCAxMCkgPj0gMzEpIHx8XG5cdFx0Ly8gRG91YmxlIGNoZWNrIHdlYmtpdCBpbiB1c2VyQWdlbnQganVzdCBpbiBjYXNlIHdlIGFyZSBpbiBhIHdvcmtlclxuXHRcdCh0eXBlb2YgbmF2aWdhdG9yICE9PSAndW5kZWZpbmVkJyAmJiBuYXZpZ2F0b3IudXNlckFnZW50ICYmIG5hdmlnYXRvci51c2VyQWdlbnQudG9Mb3dlckNhc2UoKS5tYXRjaCgvYXBwbGV3ZWJraXRcXC8oXFxkKykvKSk7XG59XG5cbi8qKlxuICogQ29sb3JpemUgbG9nIGFyZ3VtZW50cyBpZiBlbmFibGVkLlxuICpcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZnVuY3Rpb24gZm9ybWF0QXJncyhhcmdzKSB7XG5cdGFyZ3NbMF0gPSAodGhpcy51c2VDb2xvcnMgPyAnJWMnIDogJycpICtcblx0XHR0aGlzLm5hbWVzcGFjZSArXG5cdFx0KHRoaXMudXNlQ29sb3JzID8gJyAlYycgOiAnICcpICtcblx0XHRhcmdzWzBdICtcblx0XHQodGhpcy51c2VDb2xvcnMgPyAnJWMgJyA6ICcgJykgK1xuXHRcdCcrJyArIG1vZHVsZS5leHBvcnRzLmh1bWFuaXplKHRoaXMuZGlmZik7XG5cblx0aWYgKCF0aGlzLnVzZUNvbG9ycykge1xuXHRcdHJldHVybjtcblx0fVxuXG5cdGNvbnN0IGMgPSAnY29sb3I6ICcgKyB0aGlzLmNvbG9yO1xuXHRhcmdzLnNwbGljZSgxLCAwLCBjLCAnY29sb3I6IGluaGVyaXQnKTtcblxuXHQvLyBUaGUgZmluYWwgXCIlY1wiIGlzIHNvbWV3aGF0IHRyaWNreSwgYmVjYXVzZSB0aGVyZSBjb3VsZCBiZSBvdGhlclxuXHQvLyBhcmd1bWVudHMgcGFzc2VkIGVpdGhlciBiZWZvcmUgb3IgYWZ0ZXIgdGhlICVjLCBzbyB3ZSBuZWVkIHRvXG5cdC8vIGZpZ3VyZSBvdXQgdGhlIGNvcnJlY3QgaW5kZXggdG8gaW5zZXJ0IHRoZSBDU1MgaW50b1xuXHRsZXQgaW5kZXggPSAwO1xuXHRsZXQgbGFzdEMgPSAwO1xuXHRhcmdzWzBdLnJlcGxhY2UoLyVbYS16QS1aJV0vZywgbWF0Y2ggPT4ge1xuXHRcdGlmIChtYXRjaCA9PT0gJyUlJykge1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHRpbmRleCsrO1xuXHRcdGlmIChtYXRjaCA9PT0gJyVjJykge1xuXHRcdFx0Ly8gV2Ugb25seSBhcmUgaW50ZXJlc3RlZCBpbiB0aGUgKmxhc3QqICVjXG5cdFx0XHQvLyAodGhlIHVzZXIgbWF5IGhhdmUgcHJvdmlkZWQgdGhlaXIgb3duKVxuXHRcdFx0bGFzdEMgPSBpbmRleDtcblx0XHR9XG5cdH0pO1xuXG5cdGFyZ3Muc3BsaWNlKGxhc3RDLCAwLCBjKTtcbn1cblxuLyoqXG4gKiBJbnZva2VzIGBjb25zb2xlLmRlYnVnKClgIHdoZW4gYXZhaWxhYmxlLlxuICogTm8tb3Agd2hlbiBgY29uc29sZS5kZWJ1Z2AgaXMgbm90IGEgXCJmdW5jdGlvblwiLlxuICogSWYgYGNvbnNvbGUuZGVidWdgIGlzIG5vdCBhdmFpbGFibGUsIGZhbGxzIGJhY2tcbiAqIHRvIGBjb25zb2xlLmxvZ2AuXG4gKlxuICogQGFwaSBwdWJsaWNcbiAqL1xuZXhwb3J0cy5sb2cgPSBjb25zb2xlLmRlYnVnIHx8IGNvbnNvbGUubG9nIHx8ICgoKSA9PiB7fSk7XG5cbi8qKlxuICogU2F2ZSBgbmFtZXNwYWNlc2AuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IG5hbWVzcGFjZXNcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5mdW5jdGlvbiBzYXZlKG5hbWVzcGFjZXMpIHtcblx0dHJ5IHtcblx0XHRpZiAobmFtZXNwYWNlcykge1xuXHRcdFx0ZXhwb3J0cy5zdG9yYWdlLnNldEl0ZW0oJ2RlYnVnJywgbmFtZXNwYWNlcyk7XG5cdFx0fSBlbHNlIHtcblx0XHRcdGV4cG9ydHMuc3RvcmFnZS5yZW1vdmVJdGVtKCdkZWJ1ZycpO1xuXHRcdH1cblx0fSBjYXRjaCAoZXJyb3IpIHtcblx0XHQvLyBTd2FsbG93XG5cdFx0Ly8gWFhYIChAUWl4LSkgc2hvdWxkIHdlIGJlIGxvZ2dpbmcgdGhlc2U/XG5cdH1cbn1cblxuLyoqXG4gKiBMb2FkIGBuYW1lc3BhY2VzYC5cbiAqXG4gKiBAcmV0dXJuIHtTdHJpbmd9IHJldHVybnMgdGhlIHByZXZpb3VzbHkgcGVyc2lzdGVkIGRlYnVnIG1vZGVzXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuZnVuY3Rpb24gbG9hZCgpIHtcblx0bGV0IHI7XG5cdHRyeSB7XG5cdFx0ciA9IGV4cG9ydHMuc3RvcmFnZS5nZXRJdGVtKCdkZWJ1ZycpO1xuXHR9IGNhdGNoIChlcnJvcikge1xuXHRcdC8vIFN3YWxsb3dcblx0XHQvLyBYWFggKEBRaXgtKSBzaG91bGQgd2UgYmUgbG9nZ2luZyB0aGVzZT9cblx0fVxuXG5cdC8vIElmIGRlYnVnIGlzbid0IHNldCBpbiBMUywgYW5kIHdlJ3JlIGluIEVsZWN0cm9uLCB0cnkgdG8gbG9hZCAkREVCVUdcblx0aWYgKCFyICYmIHR5cGVvZiBwcm9jZXNzICE9PSAndW5kZWZpbmVkJyAmJiAnZW52JyBpbiBwcm9jZXNzKSB7XG5cdFx0ciA9IHByb2Nlc3MuZW52LkRFQlVHO1xuXHR9XG5cblx0cmV0dXJuIHI7XG59XG5cbi8qKlxuICogTG9jYWxzdG9yYWdlIGF0dGVtcHRzIHRvIHJldHVybiB0aGUgbG9jYWxzdG9yYWdlLlxuICpcbiAqIFRoaXMgaXMgbmVjZXNzYXJ5IGJlY2F1c2Ugc2FmYXJpIHRocm93c1xuICogd2hlbiBhIHVzZXIgZGlzYWJsZXMgY29va2llcy9sb2NhbHN0b3JhZ2VcbiAqIGFuZCB5b3UgYXR0ZW1wdCB0byBhY2Nlc3MgaXQuXG4gKlxuICogQHJldHVybiB7TG9jYWxTdG9yYWdlfVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gbG9jYWxzdG9yYWdlKCkge1xuXHR0cnkge1xuXHRcdC8vIFRWTUxLaXQgKEFwcGxlIFRWIEpTIFJ1bnRpbWUpIGRvZXMgbm90IGhhdmUgYSB3aW5kb3cgb2JqZWN0LCBqdXN0IGxvY2FsU3RvcmFnZSBpbiB0aGUgZ2xvYmFsIGNvbnRleHRcblx0XHQvLyBUaGUgQnJvd3NlciBhbHNvIGhhcyBsb2NhbFN0b3JhZ2UgaW4gdGhlIGdsb2JhbCBjb250ZXh0LlxuXHRcdHJldHVybiBsb2NhbFN0b3JhZ2U7XG5cdH0gY2F0Y2ggKGVycm9yKSB7XG5cdFx0Ly8gU3dhbGxvd1xuXHRcdC8vIFhYWCAoQFFpeC0pIHNob3VsZCB3ZSBiZSBsb2dnaW5nIHRoZXNlP1xuXHR9XG59XG5cbm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9jb21tb24nKShleHBvcnRzKTtcblxuY29uc3Qge2Zvcm1hdHRlcnN9ID0gbW9kdWxlLmV4cG9ydHM7XG5cbi8qKlxuICogTWFwICVqIHRvIGBKU09OLnN0cmluZ2lmeSgpYCwgc2luY2Ugbm8gV2ViIEluc3BlY3RvcnMgZG8gdGhhdCBieSBkZWZhdWx0LlxuICovXG5cbmZvcm1hdHRlcnMuaiA9IGZ1bmN0aW9uICh2KSB7XG5cdHRyeSB7XG5cdFx0cmV0dXJuIEpTT04uc3RyaW5naWZ5KHYpO1xuXHR9IGNhdGNoIChlcnJvcikge1xuXHRcdHJldHVybiAnW1VuZXhwZWN0ZWRKU09OUGFyc2VFcnJvcl06ICcgKyBlcnJvci5tZXNzYWdlO1xuXHR9XG59O1xuIiwiXG4vKipcbiAqIFRoaXMgaXMgdGhlIGNvbW1vbiBsb2dpYyBmb3IgYm90aCB0aGUgTm9kZS5qcyBhbmQgd2ViIGJyb3dzZXJcbiAqIGltcGxlbWVudGF0aW9ucyBvZiBgZGVidWcoKWAuXG4gKi9cblxuZnVuY3Rpb24gc2V0dXAoZW52KSB7XG5cdGNyZWF0ZURlYnVnLmRlYnVnID0gY3JlYXRlRGVidWc7XG5cdGNyZWF0ZURlYnVnLmRlZmF1bHQgPSBjcmVhdGVEZWJ1Zztcblx0Y3JlYXRlRGVidWcuY29lcmNlID0gY29lcmNlO1xuXHRjcmVhdGVEZWJ1Zy5kaXNhYmxlID0gZGlzYWJsZTtcblx0Y3JlYXRlRGVidWcuZW5hYmxlID0gZW5hYmxlO1xuXHRjcmVhdGVEZWJ1Zy5lbmFibGVkID0gZW5hYmxlZDtcblx0Y3JlYXRlRGVidWcuaHVtYW5pemUgPSByZXF1aXJlKCdtcycpO1xuXHRjcmVhdGVEZWJ1Zy5kZXN0cm95ID0gZGVzdHJveTtcblxuXHRPYmplY3Qua2V5cyhlbnYpLmZvckVhY2goa2V5ID0+IHtcblx0XHRjcmVhdGVEZWJ1Z1trZXldID0gZW52W2tleV07XG5cdH0pO1xuXG5cdC8qKlxuXHQqIFRoZSBjdXJyZW50bHkgYWN0aXZlIGRlYnVnIG1vZGUgbmFtZXMsIGFuZCBuYW1lcyB0byBza2lwLlxuXHQqL1xuXG5cdGNyZWF0ZURlYnVnLm5hbWVzID0gW107XG5cdGNyZWF0ZURlYnVnLnNraXBzID0gW107XG5cblx0LyoqXG5cdCogTWFwIG9mIHNwZWNpYWwgXCIlblwiIGhhbmRsaW5nIGZ1bmN0aW9ucywgZm9yIHRoZSBkZWJ1ZyBcImZvcm1hdFwiIGFyZ3VtZW50LlxuXHQqXG5cdCogVmFsaWQga2V5IG5hbWVzIGFyZSBhIHNpbmdsZSwgbG93ZXIgb3IgdXBwZXItY2FzZSBsZXR0ZXIsIGkuZS4gXCJuXCIgYW5kIFwiTlwiLlxuXHQqL1xuXHRjcmVhdGVEZWJ1Zy5mb3JtYXR0ZXJzID0ge307XG5cblx0LyoqXG5cdCogU2VsZWN0cyBhIGNvbG9yIGZvciBhIGRlYnVnIG5hbWVzcGFjZVxuXHQqIEBwYXJhbSB7U3RyaW5nfSBuYW1lc3BhY2UgVGhlIG5hbWVzcGFjZSBzdHJpbmcgZm9yIHRoZSBkZWJ1ZyBpbnN0YW5jZSB0byBiZSBjb2xvcmVkXG5cdCogQHJldHVybiB7TnVtYmVyfFN0cmluZ30gQW4gQU5TSSBjb2xvciBjb2RlIGZvciB0aGUgZ2l2ZW4gbmFtZXNwYWNlXG5cdCogQGFwaSBwcml2YXRlXG5cdCovXG5cdGZ1bmN0aW9uIHNlbGVjdENvbG9yKG5hbWVzcGFjZSkge1xuXHRcdGxldCBoYXNoID0gMDtcblxuXHRcdGZvciAobGV0IGkgPSAwOyBpIDwgbmFtZXNwYWNlLmxlbmd0aDsgaSsrKSB7XG5cdFx0XHRoYXNoID0gKChoYXNoIDw8IDUpIC0gaGFzaCkgKyBuYW1lc3BhY2UuY2hhckNvZGVBdChpKTtcblx0XHRcdGhhc2ggfD0gMDsgLy8gQ29udmVydCB0byAzMmJpdCBpbnRlZ2VyXG5cdFx0fVxuXG5cdFx0cmV0dXJuIGNyZWF0ZURlYnVnLmNvbG9yc1tNYXRoLmFicyhoYXNoKSAlIGNyZWF0ZURlYnVnLmNvbG9ycy5sZW5ndGhdO1xuXHR9XG5cdGNyZWF0ZURlYnVnLnNlbGVjdENvbG9yID0gc2VsZWN0Q29sb3I7XG5cblx0LyoqXG5cdCogQ3JlYXRlIGEgZGVidWdnZXIgd2l0aCB0aGUgZ2l2ZW4gYG5hbWVzcGFjZWAuXG5cdCpcblx0KiBAcGFyYW0ge1N0cmluZ30gbmFtZXNwYWNlXG5cdCogQHJldHVybiB7RnVuY3Rpb259XG5cdCogQGFwaSBwdWJsaWNcblx0Ki9cblx0ZnVuY3Rpb24gY3JlYXRlRGVidWcobmFtZXNwYWNlKSB7XG5cdFx0bGV0IHByZXZUaW1lO1xuXHRcdGxldCBlbmFibGVPdmVycmlkZSA9IG51bGw7XG5cdFx0bGV0IG5hbWVzcGFjZXNDYWNoZTtcblx0XHRsZXQgZW5hYmxlZENhY2hlO1xuXG5cdFx0ZnVuY3Rpb24gZGVidWcoLi4uYXJncykge1xuXHRcdFx0Ly8gRGlzYWJsZWQ/XG5cdFx0XHRpZiAoIWRlYnVnLmVuYWJsZWQpIHtcblx0XHRcdFx0cmV0dXJuO1xuXHRcdFx0fVxuXG5cdFx0XHRjb25zdCBzZWxmID0gZGVidWc7XG5cblx0XHRcdC8vIFNldCBgZGlmZmAgdGltZXN0YW1wXG5cdFx0XHRjb25zdCBjdXJyID0gTnVtYmVyKG5ldyBEYXRlKCkpO1xuXHRcdFx0Y29uc3QgbXMgPSBjdXJyIC0gKHByZXZUaW1lIHx8IGN1cnIpO1xuXHRcdFx0c2VsZi5kaWZmID0gbXM7XG5cdFx0XHRzZWxmLnByZXYgPSBwcmV2VGltZTtcblx0XHRcdHNlbGYuY3VyciA9IGN1cnI7XG5cdFx0XHRwcmV2VGltZSA9IGN1cnI7XG5cblx0XHRcdGFyZ3NbMF0gPSBjcmVhdGVEZWJ1Zy5jb2VyY2UoYXJnc1swXSk7XG5cblx0XHRcdGlmICh0eXBlb2YgYXJnc1swXSAhPT0gJ3N0cmluZycpIHtcblx0XHRcdFx0Ly8gQW55dGhpbmcgZWxzZSBsZXQncyBpbnNwZWN0IHdpdGggJU9cblx0XHRcdFx0YXJncy51bnNoaWZ0KCclTycpO1xuXHRcdFx0fVxuXG5cdFx0XHQvLyBBcHBseSBhbnkgYGZvcm1hdHRlcnNgIHRyYW5zZm9ybWF0aW9uc1xuXHRcdFx0bGV0IGluZGV4ID0gMDtcblx0XHRcdGFyZ3NbMF0gPSBhcmdzWzBdLnJlcGxhY2UoLyUoW2EtekEtWiVdKS9nLCAobWF0Y2gsIGZvcm1hdCkgPT4ge1xuXHRcdFx0XHQvLyBJZiB3ZSBlbmNvdW50ZXIgYW4gZXNjYXBlZCAlIHRoZW4gZG9uJ3QgaW5jcmVhc2UgdGhlIGFycmF5IGluZGV4XG5cdFx0XHRcdGlmIChtYXRjaCA9PT0gJyUlJykge1xuXHRcdFx0XHRcdHJldHVybiAnJSc7XG5cdFx0XHRcdH1cblx0XHRcdFx0aW5kZXgrKztcblx0XHRcdFx0Y29uc3QgZm9ybWF0dGVyID0gY3JlYXRlRGVidWcuZm9ybWF0dGVyc1tmb3JtYXRdO1xuXHRcdFx0XHRpZiAodHlwZW9mIGZvcm1hdHRlciA9PT0gJ2Z1bmN0aW9uJykge1xuXHRcdFx0XHRcdGNvbnN0IHZhbCA9IGFyZ3NbaW5kZXhdO1xuXHRcdFx0XHRcdG1hdGNoID0gZm9ybWF0dGVyLmNhbGwoc2VsZiwgdmFsKTtcblxuXHRcdFx0XHRcdC8vIE5vdyB3ZSBuZWVkIHRvIHJlbW92ZSBgYXJnc1tpbmRleF1gIHNpbmNlIGl0J3MgaW5saW5lZCBpbiB0aGUgYGZvcm1hdGBcblx0XHRcdFx0XHRhcmdzLnNwbGljZShpbmRleCwgMSk7XG5cdFx0XHRcdFx0aW5kZXgtLTtcblx0XHRcdFx0fVxuXHRcdFx0XHRyZXR1cm4gbWF0Y2g7XG5cdFx0XHR9KTtcblxuXHRcdFx0Ly8gQXBwbHkgZW52LXNwZWNpZmljIGZvcm1hdHRpbmcgKGNvbG9ycywgZXRjLilcblx0XHRcdGNyZWF0ZURlYnVnLmZvcm1hdEFyZ3MuY2FsbChzZWxmLCBhcmdzKTtcblxuXHRcdFx0Y29uc3QgbG9nRm4gPSBzZWxmLmxvZyB8fCBjcmVhdGVEZWJ1Zy5sb2c7XG5cdFx0XHRsb2dGbi5hcHBseShzZWxmLCBhcmdzKTtcblx0XHR9XG5cblx0XHRkZWJ1Zy5uYW1lc3BhY2UgPSBuYW1lc3BhY2U7XG5cdFx0ZGVidWcudXNlQ29sb3JzID0gY3JlYXRlRGVidWcudXNlQ29sb3JzKCk7XG5cdFx0ZGVidWcuY29sb3IgPSBjcmVhdGVEZWJ1Zy5zZWxlY3RDb2xvcihuYW1lc3BhY2UpO1xuXHRcdGRlYnVnLmV4dGVuZCA9IGV4dGVuZDtcblx0XHRkZWJ1Zy5kZXN0cm95ID0gY3JlYXRlRGVidWcuZGVzdHJveTsgLy8gWFhYIFRlbXBvcmFyeS4gV2lsbCBiZSByZW1vdmVkIGluIHRoZSBuZXh0IG1ham9yIHJlbGVhc2UuXG5cblx0XHRPYmplY3QuZGVmaW5lUHJvcGVydHkoZGVidWcsICdlbmFibGVkJywge1xuXHRcdFx0ZW51bWVyYWJsZTogdHJ1ZSxcblx0XHRcdGNvbmZpZ3VyYWJsZTogZmFsc2UsXG5cdFx0XHRnZXQ6ICgpID0+IHtcblx0XHRcdFx0aWYgKGVuYWJsZU92ZXJyaWRlICE9PSBudWxsKSB7XG5cdFx0XHRcdFx0cmV0dXJuIGVuYWJsZU92ZXJyaWRlO1xuXHRcdFx0XHR9XG5cdFx0XHRcdGlmIChuYW1lc3BhY2VzQ2FjaGUgIT09IGNyZWF0ZURlYnVnLm5hbWVzcGFjZXMpIHtcblx0XHRcdFx0XHRuYW1lc3BhY2VzQ2FjaGUgPSBjcmVhdGVEZWJ1Zy5uYW1lc3BhY2VzO1xuXHRcdFx0XHRcdGVuYWJsZWRDYWNoZSA9IGNyZWF0ZURlYnVnLmVuYWJsZWQobmFtZXNwYWNlKTtcblx0XHRcdFx0fVxuXG5cdFx0XHRcdHJldHVybiBlbmFibGVkQ2FjaGU7XG5cdFx0XHR9LFxuXHRcdFx0c2V0OiB2ID0+IHtcblx0XHRcdFx0ZW5hYmxlT3ZlcnJpZGUgPSB2O1xuXHRcdFx0fVxuXHRcdH0pO1xuXG5cdFx0Ly8gRW52LXNwZWNpZmljIGluaXRpYWxpemF0aW9uIGxvZ2ljIGZvciBkZWJ1ZyBpbnN0YW5jZXNcblx0XHRpZiAodHlwZW9mIGNyZWF0ZURlYnVnLmluaXQgPT09ICdmdW5jdGlvbicpIHtcblx0XHRcdGNyZWF0ZURlYnVnLmluaXQoZGVidWcpO1xuXHRcdH1cblxuXHRcdHJldHVybiBkZWJ1Zztcblx0fVxuXG5cdGZ1bmN0aW9uIGV4dGVuZChuYW1lc3BhY2UsIGRlbGltaXRlcikge1xuXHRcdGNvbnN0IG5ld0RlYnVnID0gY3JlYXRlRGVidWcodGhpcy5uYW1lc3BhY2UgKyAodHlwZW9mIGRlbGltaXRlciA9PT0gJ3VuZGVmaW5lZCcgPyAnOicgOiBkZWxpbWl0ZXIpICsgbmFtZXNwYWNlKTtcblx0XHRuZXdEZWJ1Zy5sb2cgPSB0aGlzLmxvZztcblx0XHRyZXR1cm4gbmV3RGVidWc7XG5cdH1cblxuXHQvKipcblx0KiBFbmFibGVzIGEgZGVidWcgbW9kZSBieSBuYW1lc3BhY2VzLiBUaGlzIGNhbiBpbmNsdWRlIG1vZGVzXG5cdCogc2VwYXJhdGVkIGJ5IGEgY29sb24gYW5kIHdpbGRjYXJkcy5cblx0KlxuXHQqIEBwYXJhbSB7U3RyaW5nfSBuYW1lc3BhY2VzXG5cdCogQGFwaSBwdWJsaWNcblx0Ki9cblx0ZnVuY3Rpb24gZW5hYmxlKG5hbWVzcGFjZXMpIHtcblx0XHRjcmVhdGVEZWJ1Zy5zYXZlKG5hbWVzcGFjZXMpO1xuXHRcdGNyZWF0ZURlYnVnLm5hbWVzcGFjZXMgPSBuYW1lc3BhY2VzO1xuXG5cdFx0Y3JlYXRlRGVidWcubmFtZXMgPSBbXTtcblx0XHRjcmVhdGVEZWJ1Zy5za2lwcyA9IFtdO1xuXG5cdFx0bGV0IGk7XG5cdFx0Y29uc3Qgc3BsaXQgPSAodHlwZW9mIG5hbWVzcGFjZXMgPT09ICdzdHJpbmcnID8gbmFtZXNwYWNlcyA6ICcnKS5zcGxpdCgvW1xccyxdKy8pO1xuXHRcdGNvbnN0IGxlbiA9IHNwbGl0Lmxlbmd0aDtcblxuXHRcdGZvciAoaSA9IDA7IGkgPCBsZW47IGkrKykge1xuXHRcdFx0aWYgKCFzcGxpdFtpXSkge1xuXHRcdFx0XHQvLyBpZ25vcmUgZW1wdHkgc3RyaW5nc1xuXHRcdFx0XHRjb250aW51ZTtcblx0XHRcdH1cblxuXHRcdFx0bmFtZXNwYWNlcyA9IHNwbGl0W2ldLnJlcGxhY2UoL1xcKi9nLCAnLio/Jyk7XG5cblx0XHRcdGlmIChuYW1lc3BhY2VzWzBdID09PSAnLScpIHtcblx0XHRcdFx0Y3JlYXRlRGVidWcuc2tpcHMucHVzaChuZXcgUmVnRXhwKCdeJyArIG5hbWVzcGFjZXMuc2xpY2UoMSkgKyAnJCcpKTtcblx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdGNyZWF0ZURlYnVnLm5hbWVzLnB1c2gobmV3IFJlZ0V4cCgnXicgKyBuYW1lc3BhY2VzICsgJyQnKSk7XG5cdFx0XHR9XG5cdFx0fVxuXHR9XG5cblx0LyoqXG5cdCogRGlzYWJsZSBkZWJ1ZyBvdXRwdXQuXG5cdCpcblx0KiBAcmV0dXJuIHtTdHJpbmd9IG5hbWVzcGFjZXNcblx0KiBAYXBpIHB1YmxpY1xuXHQqL1xuXHRmdW5jdGlvbiBkaXNhYmxlKCkge1xuXHRcdGNvbnN0IG5hbWVzcGFjZXMgPSBbXG5cdFx0XHQuLi5jcmVhdGVEZWJ1Zy5uYW1lcy5tYXAodG9OYW1lc3BhY2UpLFxuXHRcdFx0Li4uY3JlYXRlRGVidWcuc2tpcHMubWFwKHRvTmFtZXNwYWNlKS5tYXAobmFtZXNwYWNlID0+ICctJyArIG5hbWVzcGFjZSlcblx0XHRdLmpvaW4oJywnKTtcblx0XHRjcmVhdGVEZWJ1Zy5lbmFibGUoJycpO1xuXHRcdHJldHVybiBuYW1lc3BhY2VzO1xuXHR9XG5cblx0LyoqXG5cdCogUmV0dXJucyB0cnVlIGlmIHRoZSBnaXZlbiBtb2RlIG5hbWUgaXMgZW5hYmxlZCwgZmFsc2Ugb3RoZXJ3aXNlLlxuXHQqXG5cdCogQHBhcmFtIHtTdHJpbmd9IG5hbWVcblx0KiBAcmV0dXJuIHtCb29sZWFufVxuXHQqIEBhcGkgcHVibGljXG5cdCovXG5cdGZ1bmN0aW9uIGVuYWJsZWQobmFtZSkge1xuXHRcdGlmIChuYW1lW25hbWUubGVuZ3RoIC0gMV0gPT09ICcqJykge1xuXHRcdFx0cmV0dXJuIHRydWU7XG5cdFx0fVxuXG5cdFx0bGV0IGk7XG5cdFx0bGV0IGxlbjtcblxuXHRcdGZvciAoaSA9IDAsIGxlbiA9IGNyZWF0ZURlYnVnLnNraXBzLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG5cdFx0XHRpZiAoY3JlYXRlRGVidWcuc2tpcHNbaV0udGVzdChuYW1lKSkge1xuXHRcdFx0XHRyZXR1cm4gZmFsc2U7XG5cdFx0XHR9XG5cdFx0fVxuXG5cdFx0Zm9yIChpID0gMCwgbGVuID0gY3JlYXRlRGVidWcubmFtZXMubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcblx0XHRcdGlmIChjcmVhdGVEZWJ1Zy5uYW1lc1tpXS50ZXN0KG5hbWUpKSB7XG5cdFx0XHRcdHJldHVybiB0cnVlO1xuXHRcdFx0fVxuXHRcdH1cblxuXHRcdHJldHVybiBmYWxzZTtcblx0fVxuXG5cdC8qKlxuXHQqIENvbnZlcnQgcmVnZXhwIHRvIG5hbWVzcGFjZVxuXHQqXG5cdCogQHBhcmFtIHtSZWdFeHB9IHJlZ3hlcFxuXHQqIEByZXR1cm4ge1N0cmluZ30gbmFtZXNwYWNlXG5cdCogQGFwaSBwcml2YXRlXG5cdCovXG5cdGZ1bmN0aW9uIHRvTmFtZXNwYWNlKHJlZ2V4cCkge1xuXHRcdHJldHVybiByZWdleHAudG9TdHJpbmcoKVxuXHRcdFx0LnN1YnN0cmluZygyLCByZWdleHAudG9TdHJpbmcoKS5sZW5ndGggLSAyKVxuXHRcdFx0LnJlcGxhY2UoL1xcLlxcKlxcPyQvLCAnKicpO1xuXHR9XG5cblx0LyoqXG5cdCogQ29lcmNlIGB2YWxgLlxuXHQqXG5cdCogQHBhcmFtIHtNaXhlZH0gdmFsXG5cdCogQHJldHVybiB7TWl4ZWR9XG5cdCogQGFwaSBwcml2YXRlXG5cdCovXG5cdGZ1bmN0aW9uIGNvZXJjZSh2YWwpIHtcblx0XHRpZiAodmFsIGluc3RhbmNlb2YgRXJyb3IpIHtcblx0XHRcdHJldHVybiB2YWwuc3RhY2sgfHwgdmFsLm1lc3NhZ2U7XG5cdFx0fVxuXHRcdHJldHVybiB2YWw7XG5cdH1cblxuXHQvKipcblx0KiBYWFggRE8gTk9UIFVTRS4gVGhpcyBpcyBhIHRlbXBvcmFyeSBzdHViIGZ1bmN0aW9uLlxuXHQqIFhYWCBJdCBXSUxMIGJlIHJlbW92ZWQgaW4gdGhlIG5leHQgbWFqb3IgcmVsZWFzZS5cblx0Ki9cblx0ZnVuY3Rpb24gZGVzdHJveSgpIHtcblx0XHRjb25zb2xlLndhcm4oJ0luc3RhbmNlIG1ldGhvZCBgZGVidWcuZGVzdHJveSgpYCBpcyBkZXByZWNhdGVkIGFuZCBubyBsb25nZXIgZG9lcyBhbnl0aGluZy4gSXQgd2lsbCBiZSByZW1vdmVkIGluIHRoZSBuZXh0IG1ham9yIHZlcnNpb24gb2YgYGRlYnVnYC4nKTtcblx0fVxuXG5cdGNyZWF0ZURlYnVnLmVuYWJsZShjcmVhdGVEZWJ1Zy5sb2FkKCkpO1xuXG5cdHJldHVybiBjcmVhdGVEZWJ1Zztcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBzZXR1cDtcbiIsIi8qKlxuICogSGVscGVycy5cbiAqL1xuXG52YXIgcyA9IDEwMDA7XG52YXIgbSA9IHMgKiA2MDtcbnZhciBoID0gbSAqIDYwO1xudmFyIGQgPSBoICogMjQ7XG52YXIgdyA9IGQgKiA3O1xudmFyIHkgPSBkICogMzY1LjI1O1xuXG4vKipcbiAqIFBhcnNlIG9yIGZvcm1hdCB0aGUgZ2l2ZW4gYHZhbGAuXG4gKlxuICogT3B0aW9uczpcbiAqXG4gKiAgLSBgbG9uZ2AgdmVyYm9zZSBmb3JtYXR0aW5nIFtmYWxzZV1cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ3xOdW1iZXJ9IHZhbFxuICogQHBhcmFtIHtPYmplY3R9IFtvcHRpb25zXVxuICogQHRocm93cyB7RXJyb3J9IHRocm93IGFuIGVycm9yIGlmIHZhbCBpcyBub3QgYSBub24tZW1wdHkgc3RyaW5nIG9yIGEgbnVtYmVyXG4gKiBAcmV0dXJuIHtTdHJpbmd8TnVtYmVyfVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKHZhbCwgb3B0aW9ucykge1xuICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcbiAgdmFyIHR5cGUgPSB0eXBlb2YgdmFsO1xuICBpZiAodHlwZSA9PT0gJ3N0cmluZycgJiYgdmFsLmxlbmd0aCA+IDApIHtcbiAgICByZXR1cm4gcGFyc2UodmFsKTtcbiAgfSBlbHNlIGlmICh0eXBlID09PSAnbnVtYmVyJyAmJiBpc0Zpbml0ZSh2YWwpKSB7XG4gICAgcmV0dXJuIG9wdGlvbnMubG9uZyA/IGZtdExvbmcodmFsKSA6IGZtdFNob3J0KHZhbCk7XG4gIH1cbiAgdGhyb3cgbmV3IEVycm9yKFxuICAgICd2YWwgaXMgbm90IGEgbm9uLWVtcHR5IHN0cmluZyBvciBhIHZhbGlkIG51bWJlci4gdmFsPScgK1xuICAgICAgSlNPTi5zdHJpbmdpZnkodmFsKVxuICApO1xufTtcblxuLyoqXG4gKiBQYXJzZSB0aGUgZ2l2ZW4gYHN0cmAgYW5kIHJldHVybiBtaWxsaXNlY29uZHMuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHN0clxuICogQHJldHVybiB7TnVtYmVyfVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gcGFyc2Uoc3RyKSB7XG4gIHN0ciA9IFN0cmluZyhzdHIpO1xuICBpZiAoc3RyLmxlbmd0aCA+IDEwMCkge1xuICAgIHJldHVybjtcbiAgfVxuICB2YXIgbWF0Y2ggPSAvXigtPyg/OlxcZCspP1xcLj9cXGQrKSAqKG1pbGxpc2Vjb25kcz98bXNlY3M/fG1zfHNlY29uZHM/fHNlY3M/fHN8bWludXRlcz98bWlucz98bXxob3Vycz98aHJzP3xofGRheXM/fGR8d2Vla3M/fHd8eWVhcnM/fHlycz98eSk/JC9pLmV4ZWMoXG4gICAgc3RyXG4gICk7XG4gIGlmICghbWF0Y2gpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgdmFyIG4gPSBwYXJzZUZsb2F0KG1hdGNoWzFdKTtcbiAgdmFyIHR5cGUgPSAobWF0Y2hbMl0gfHwgJ21zJykudG9Mb3dlckNhc2UoKTtcbiAgc3dpdGNoICh0eXBlKSB7XG4gICAgY2FzZSAneWVhcnMnOlxuICAgIGNhc2UgJ3llYXInOlxuICAgIGNhc2UgJ3lycyc6XG4gICAgY2FzZSAneXInOlxuICAgIGNhc2UgJ3knOlxuICAgICAgcmV0dXJuIG4gKiB5O1xuICAgIGNhc2UgJ3dlZWtzJzpcbiAgICBjYXNlICd3ZWVrJzpcbiAgICBjYXNlICd3JzpcbiAgICAgIHJldHVybiBuICogdztcbiAgICBjYXNlICdkYXlzJzpcbiAgICBjYXNlICdkYXknOlxuICAgIGNhc2UgJ2QnOlxuICAgICAgcmV0dXJuIG4gKiBkO1xuICAgIGNhc2UgJ2hvdXJzJzpcbiAgICBjYXNlICdob3VyJzpcbiAgICBjYXNlICdocnMnOlxuICAgIGNhc2UgJ2hyJzpcbiAgICBjYXNlICdoJzpcbiAgICAgIHJldHVybiBuICogaDtcbiAgICBjYXNlICdtaW51dGVzJzpcbiAgICBjYXNlICdtaW51dGUnOlxuICAgIGNhc2UgJ21pbnMnOlxuICAgIGNhc2UgJ21pbic6XG4gICAgY2FzZSAnbSc6XG4gICAgICByZXR1cm4gbiAqIG07XG4gICAgY2FzZSAnc2Vjb25kcyc6XG4gICAgY2FzZSAnc2Vjb25kJzpcbiAgICBjYXNlICdzZWNzJzpcbiAgICBjYXNlICdzZWMnOlxuICAgIGNhc2UgJ3MnOlxuICAgICAgcmV0dXJuIG4gKiBzO1xuICAgIGNhc2UgJ21pbGxpc2Vjb25kcyc6XG4gICAgY2FzZSAnbWlsbGlzZWNvbmQnOlxuICAgIGNhc2UgJ21zZWNzJzpcbiAgICBjYXNlICdtc2VjJzpcbiAgICBjYXNlICdtcyc6XG4gICAgICByZXR1cm4gbjtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxufVxuXG4vKipcbiAqIFNob3J0IGZvcm1hdCBmb3IgYG1zYC5cbiAqXG4gKiBAcGFyYW0ge051bWJlcn0gbXNcbiAqIEByZXR1cm4ge1N0cmluZ31cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIGZtdFNob3J0KG1zKSB7XG4gIHZhciBtc0FicyA9IE1hdGguYWJzKG1zKTtcbiAgaWYgKG1zQWJzID49IGQpIHtcbiAgICByZXR1cm4gTWF0aC5yb3VuZChtcyAvIGQpICsgJ2QnO1xuICB9XG4gIGlmIChtc0FicyA+PSBoKSB7XG4gICAgcmV0dXJuIE1hdGgucm91bmQobXMgLyBoKSArICdoJztcbiAgfVxuICBpZiAobXNBYnMgPj0gbSkge1xuICAgIHJldHVybiBNYXRoLnJvdW5kKG1zIC8gbSkgKyAnbSc7XG4gIH1cbiAgaWYgKG1zQWJzID49IHMpIHtcbiAgICByZXR1cm4gTWF0aC5yb3VuZChtcyAvIHMpICsgJ3MnO1xuICB9XG4gIHJldHVybiBtcyArICdtcyc7XG59XG5cbi8qKlxuICogTG9uZyBmb3JtYXQgZm9yIGBtc2AuXG4gKlxuICogQHBhcmFtIHtOdW1iZXJ9IG1zXG4gKiBAcmV0dXJuIHtTdHJpbmd9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBmbXRMb25nKG1zKSB7XG4gIHZhciBtc0FicyA9IE1hdGguYWJzKG1zKTtcbiAgaWYgKG1zQWJzID49IGQpIHtcbiAgICByZXR1cm4gcGx1cmFsKG1zLCBtc0FicywgZCwgJ2RheScpO1xuICB9XG4gIGlmIChtc0FicyA+PSBoKSB7XG4gICAgcmV0dXJuIHBsdXJhbChtcywgbXNBYnMsIGgsICdob3VyJyk7XG4gIH1cbiAgaWYgKG1zQWJzID49IG0pIHtcbiAgICByZXR1cm4gcGx1cmFsKG1zLCBtc0FicywgbSwgJ21pbnV0ZScpO1xuICB9XG4gIGlmIChtc0FicyA+PSBzKSB7XG4gICAgcmV0dXJuIHBsdXJhbChtcywgbXNBYnMsIHMsICdzZWNvbmQnKTtcbiAgfVxuICByZXR1cm4gbXMgKyAnIG1zJztcbn1cblxuLyoqXG4gKiBQbHVyYWxpemF0aW9uIGhlbHBlci5cbiAqL1xuXG5mdW5jdGlvbiBwbHVyYWwobXMsIG1zQWJzLCBuLCBuYW1lKSB7XG4gIHZhciBpc1BsdXJhbCA9IG1zQWJzID49IG4gKiAxLjU7XG4gIHJldHVybiBNYXRoLnJvdW5kKG1zIC8gbikgKyAnICcgKyBuYW1lICsgKGlzUGx1cmFsID8gJ3MnIDogJycpO1xufVxuIiwiLyogZXNsaW50LWVudiBub2RlICovXG4ndXNlIHN0cmljdCc7XG5cbi8vIFNEUCBoZWxwZXJzLlxuY29uc3QgU0RQVXRpbHMgPSB7fTtcblxuLy8gR2VuZXJhdGUgYW4gYWxwaGFudW1lcmljIGlkZW50aWZpZXIgZm9yIGNuYW1lIG9yIG1pZHMuXG4vLyBUT0RPOiB1c2UgVVVJRHMgaW5zdGVhZD8gaHR0cHM6Ly9naXN0LmdpdGh1Yi5jb20vamVkLzk4Mjg4M1xuU0RQVXRpbHMuZ2VuZXJhdGVJZGVudGlmaWVyID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zdWJzdHJpbmcoMiwgMTIpO1xufTtcblxuLy8gVGhlIFJUQ1AgQ05BTUUgdXNlZCBieSBhbGwgcGVlcmNvbm5lY3Rpb25zIGZyb20gdGhlIHNhbWUgSlMuXG5TRFBVdGlscy5sb2NhbENOYW1lID0gU0RQVXRpbHMuZ2VuZXJhdGVJZGVudGlmaWVyKCk7XG5cbi8vIFNwbGl0cyBTRFAgaW50byBsaW5lcywgZGVhbGluZyB3aXRoIGJvdGggQ1JMRiBhbmQgTEYuXG5TRFBVdGlscy5zcGxpdExpbmVzID0gZnVuY3Rpb24oYmxvYikge1xuICByZXR1cm4gYmxvYi50cmltKCkuc3BsaXQoJ1xcbicpLm1hcChsaW5lID0+IGxpbmUudHJpbSgpKTtcbn07XG4vLyBTcGxpdHMgU0RQIGludG8gc2Vzc2lvbnBhcnQgYW5kIG1lZGlhc2VjdGlvbnMuIEVuc3VyZXMgQ1JMRi5cblNEUFV0aWxzLnNwbGl0U2VjdGlvbnMgPSBmdW5jdGlvbihibG9iKSB7XG4gIGNvbnN0IHBhcnRzID0gYmxvYi5zcGxpdCgnXFxubT0nKTtcbiAgcmV0dXJuIHBhcnRzLm1hcCgocGFydCwgaW5kZXgpID0+IChpbmRleCA+IDAgP1xuICAgICdtPScgKyBwYXJ0IDogcGFydCkudHJpbSgpICsgJ1xcclxcbicpO1xufTtcblxuLy8gUmV0dXJucyB0aGUgc2Vzc2lvbiBkZXNjcmlwdGlvbi5cblNEUFV0aWxzLmdldERlc2NyaXB0aW9uID0gZnVuY3Rpb24oYmxvYikge1xuICBjb25zdCBzZWN0aW9ucyA9IFNEUFV0aWxzLnNwbGl0U2VjdGlvbnMoYmxvYik7XG4gIHJldHVybiBzZWN0aW9ucyAmJiBzZWN0aW9uc1swXTtcbn07XG5cbi8vIFJldHVybnMgdGhlIGluZGl2aWR1YWwgbWVkaWEgc2VjdGlvbnMuXG5TRFBVdGlscy5nZXRNZWRpYVNlY3Rpb25zID0gZnVuY3Rpb24oYmxvYikge1xuICBjb25zdCBzZWN0aW9ucyA9IFNEUFV0aWxzLnNwbGl0U2VjdGlvbnMoYmxvYik7XG4gIHNlY3Rpb25zLnNoaWZ0KCk7XG4gIHJldHVybiBzZWN0aW9ucztcbn07XG5cbi8vIFJldHVybnMgbGluZXMgdGhhdCBzdGFydCB3aXRoIGEgY2VydGFpbiBwcmVmaXguXG5TRFBVdGlscy5tYXRjaFByZWZpeCA9IGZ1bmN0aW9uKGJsb2IsIHByZWZpeCkge1xuICByZXR1cm4gU0RQVXRpbHMuc3BsaXRMaW5lcyhibG9iKS5maWx0ZXIobGluZSA9PiBsaW5lLmluZGV4T2YocHJlZml4KSA9PT0gMCk7XG59O1xuXG4vLyBQYXJzZXMgYW4gSUNFIGNhbmRpZGF0ZSBsaW5lLiBTYW1wbGUgaW5wdXQ6XG4vLyBjYW5kaWRhdGU6NzAyNzg2MzUwIDIgdWRwIDQxODE5OTAyIDguOC44LjggNjA3NjkgdHlwIHJlbGF5IHJhZGRyIDguOC44Ljhcbi8vIHJwb3J0IDU1OTk2XCJcbi8vIElucHV0IGNhbiBiZSBwcmVmaXhlZCB3aXRoIGE9LlxuU0RQVXRpbHMucGFyc2VDYW5kaWRhdGUgPSBmdW5jdGlvbihsaW5lKSB7XG4gIGxldCBwYXJ0cztcbiAgLy8gUGFyc2UgYm90aCB2YXJpYW50cy5cbiAgaWYgKGxpbmUuaW5kZXhPZignYT1jYW5kaWRhdGU6JykgPT09IDApIHtcbiAgICBwYXJ0cyA9IGxpbmUuc3Vic3RyaW5nKDEyKS5zcGxpdCgnICcpO1xuICB9IGVsc2Uge1xuICAgIHBhcnRzID0gbGluZS5zdWJzdHJpbmcoMTApLnNwbGl0KCcgJyk7XG4gIH1cblxuICBjb25zdCBjYW5kaWRhdGUgPSB7XG4gICAgZm91bmRhdGlvbjogcGFydHNbMF0sXG4gICAgY29tcG9uZW50OiB7MTogJ3J0cCcsIDI6ICdydGNwJ31bcGFydHNbMV1dIHx8IHBhcnRzWzFdLFxuICAgIHByb3RvY29sOiBwYXJ0c1syXS50b0xvd2VyQ2FzZSgpLFxuICAgIHByaW9yaXR5OiBwYXJzZUludChwYXJ0c1szXSwgMTApLFxuICAgIGlwOiBwYXJ0c1s0XSxcbiAgICBhZGRyZXNzOiBwYXJ0c1s0XSwgLy8gYWRkcmVzcyBpcyBhbiBhbGlhcyBmb3IgaXAuXG4gICAgcG9ydDogcGFyc2VJbnQocGFydHNbNV0sIDEwKSxcbiAgICAvLyBza2lwIHBhcnRzWzZdID09ICd0eXAnXG4gICAgdHlwZTogcGFydHNbN10sXG4gIH07XG5cbiAgZm9yIChsZXQgaSA9IDg7IGkgPCBwYXJ0cy5sZW5ndGg7IGkgKz0gMikge1xuICAgIHN3aXRjaCAocGFydHNbaV0pIHtcbiAgICAgIGNhc2UgJ3JhZGRyJzpcbiAgICAgICAgY2FuZGlkYXRlLnJlbGF0ZWRBZGRyZXNzID0gcGFydHNbaSArIDFdO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3Jwb3J0JzpcbiAgICAgICAgY2FuZGlkYXRlLnJlbGF0ZWRQb3J0ID0gcGFyc2VJbnQocGFydHNbaSArIDFdLCAxMCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAndGNwdHlwZSc6XG4gICAgICAgIGNhbmRpZGF0ZS50Y3BUeXBlID0gcGFydHNbaSArIDFdO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3VmcmFnJzpcbiAgICAgICAgY2FuZGlkYXRlLnVmcmFnID0gcGFydHNbaSArIDFdOyAvLyBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eS5cbiAgICAgICAgY2FuZGlkYXRlLnVzZXJuYW1lRnJhZ21lbnQgPSBwYXJ0c1tpICsgMV07XG4gICAgICAgIGJyZWFrO1xuICAgICAgZGVmYXVsdDogLy8gZXh0ZW5zaW9uIGhhbmRsaW5nLCBpbiBwYXJ0aWN1bGFyIHVmcmFnLiBEb24ndCBvdmVyd3JpdGUuXG4gICAgICAgIGlmIChjYW5kaWRhdGVbcGFydHNbaV1dID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBjYW5kaWRhdGVbcGFydHNbaV1dID0gcGFydHNbaSArIDFdO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuICByZXR1cm4gY2FuZGlkYXRlO1xufTtcblxuLy8gVHJhbnNsYXRlcyBhIGNhbmRpZGF0ZSBvYmplY3QgaW50byBTRFAgY2FuZGlkYXRlIGF0dHJpYnV0ZS5cbi8vIFRoaXMgZG9lcyBub3QgaW5jbHVkZSB0aGUgYT0gcHJlZml4IVxuU0RQVXRpbHMud3JpdGVDYW5kaWRhdGUgPSBmdW5jdGlvbihjYW5kaWRhdGUpIHtcbiAgY29uc3Qgc2RwID0gW107XG4gIHNkcC5wdXNoKGNhbmRpZGF0ZS5mb3VuZGF0aW9uKTtcblxuICBjb25zdCBjb21wb25lbnQgPSBjYW5kaWRhdGUuY29tcG9uZW50O1xuICBpZiAoY29tcG9uZW50ID09PSAncnRwJykge1xuICAgIHNkcC5wdXNoKDEpO1xuICB9IGVsc2UgaWYgKGNvbXBvbmVudCA9PT0gJ3J0Y3AnKSB7XG4gICAgc2RwLnB1c2goMik7XG4gIH0gZWxzZSB7XG4gICAgc2RwLnB1c2goY29tcG9uZW50KTtcbiAgfVxuICBzZHAucHVzaChjYW5kaWRhdGUucHJvdG9jb2wudG9VcHBlckNhc2UoKSk7XG4gIHNkcC5wdXNoKGNhbmRpZGF0ZS5wcmlvcml0eSk7XG4gIHNkcC5wdXNoKGNhbmRpZGF0ZS5hZGRyZXNzIHx8IGNhbmRpZGF0ZS5pcCk7XG4gIHNkcC5wdXNoKGNhbmRpZGF0ZS5wb3J0KTtcblxuICBjb25zdCB0eXBlID0gY2FuZGlkYXRlLnR5cGU7XG4gIHNkcC5wdXNoKCd0eXAnKTtcbiAgc2RwLnB1c2godHlwZSk7XG4gIGlmICh0eXBlICE9PSAnaG9zdCcgJiYgY2FuZGlkYXRlLnJlbGF0ZWRBZGRyZXNzICYmXG4gICAgICBjYW5kaWRhdGUucmVsYXRlZFBvcnQpIHtcbiAgICBzZHAucHVzaCgncmFkZHInKTtcbiAgICBzZHAucHVzaChjYW5kaWRhdGUucmVsYXRlZEFkZHJlc3MpO1xuICAgIHNkcC5wdXNoKCdycG9ydCcpO1xuICAgIHNkcC5wdXNoKGNhbmRpZGF0ZS5yZWxhdGVkUG9ydCk7XG4gIH1cbiAgaWYgKGNhbmRpZGF0ZS50Y3BUeXBlICYmIGNhbmRpZGF0ZS5wcm90b2NvbC50b0xvd2VyQ2FzZSgpID09PSAndGNwJykge1xuICAgIHNkcC5wdXNoKCd0Y3B0eXBlJyk7XG4gICAgc2RwLnB1c2goY2FuZGlkYXRlLnRjcFR5cGUpO1xuICB9XG4gIGlmIChjYW5kaWRhdGUudXNlcm5hbWVGcmFnbWVudCB8fCBjYW5kaWRhdGUudWZyYWcpIHtcbiAgICBzZHAucHVzaCgndWZyYWcnKTtcbiAgICBzZHAucHVzaChjYW5kaWRhdGUudXNlcm5hbWVGcmFnbWVudCB8fCBjYW5kaWRhdGUudWZyYWcpO1xuICB9XG4gIHJldHVybiAnY2FuZGlkYXRlOicgKyBzZHAuam9pbignICcpO1xufTtcblxuLy8gUGFyc2VzIGFuIGljZS1vcHRpb25zIGxpbmUsIHJldHVybnMgYW4gYXJyYXkgb2Ygb3B0aW9uIHRhZ3MuXG4vLyBTYW1wbGUgaW5wdXQ6XG4vLyBhPWljZS1vcHRpb25zOmZvbyBiYXJcblNEUFV0aWxzLnBhcnNlSWNlT3B0aW9ucyA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgcmV0dXJuIGxpbmUuc3Vic3RyaW5nKDE0KS5zcGxpdCgnICcpO1xufTtcblxuLy8gUGFyc2VzIGEgcnRwbWFwIGxpbmUsIHJldHVybnMgUlRDUnRwQ29kZGVjUGFyYW1ldGVycy4gU2FtcGxlIGlucHV0OlxuLy8gYT1ydHBtYXA6MTExIG9wdXMvNDgwMDAvMlxuU0RQVXRpbHMucGFyc2VSdHBNYXAgPSBmdW5jdGlvbihsaW5lKSB7XG4gIGxldCBwYXJ0cyA9IGxpbmUuc3Vic3RyaW5nKDkpLnNwbGl0KCcgJyk7XG4gIGNvbnN0IHBhcnNlZCA9IHtcbiAgICBwYXlsb2FkVHlwZTogcGFyc2VJbnQocGFydHMuc2hpZnQoKSwgMTApLCAvLyB3YXM6IGlkXG4gIH07XG5cbiAgcGFydHMgPSBwYXJ0c1swXS5zcGxpdCgnLycpO1xuXG4gIHBhcnNlZC5uYW1lID0gcGFydHNbMF07XG4gIHBhcnNlZC5jbG9ja1JhdGUgPSBwYXJzZUludChwYXJ0c1sxXSwgMTApOyAvLyB3YXM6IGNsb2NrcmF0ZVxuICBwYXJzZWQuY2hhbm5lbHMgPSBwYXJ0cy5sZW5ndGggPT09IDMgPyBwYXJzZUludChwYXJ0c1syXSwgMTApIDogMTtcbiAgLy8gbGVnYWN5IGFsaWFzLCBnb3QgcmVuYW1lZCBiYWNrIHRvIGNoYW5uZWxzIGluIE9SVEMuXG4gIHBhcnNlZC5udW1DaGFubmVscyA9IHBhcnNlZC5jaGFubmVscztcbiAgcmV0dXJuIHBhcnNlZDtcbn07XG5cbi8vIEdlbmVyYXRlcyBhIHJ0cG1hcCBsaW5lIGZyb20gUlRDUnRwQ29kZWNDYXBhYmlsaXR5IG9yXG4vLyBSVENSdHBDb2RlY1BhcmFtZXRlcnMuXG5TRFBVdGlscy53cml0ZVJ0cE1hcCA9IGZ1bmN0aW9uKGNvZGVjKSB7XG4gIGxldCBwdCA9IGNvZGVjLnBheWxvYWRUeXBlO1xuICBpZiAoY29kZWMucHJlZmVycmVkUGF5bG9hZFR5cGUgIT09IHVuZGVmaW5lZCkge1xuICAgIHB0ID0gY29kZWMucHJlZmVycmVkUGF5bG9hZFR5cGU7XG4gIH1cbiAgY29uc3QgY2hhbm5lbHMgPSBjb2RlYy5jaGFubmVscyB8fCBjb2RlYy5udW1DaGFubmVscyB8fCAxO1xuICByZXR1cm4gJ2E9cnRwbWFwOicgKyBwdCArICcgJyArIGNvZGVjLm5hbWUgKyAnLycgKyBjb2RlYy5jbG9ja1JhdGUgK1xuICAgICAgKGNoYW5uZWxzICE9PSAxID8gJy8nICsgY2hhbm5lbHMgOiAnJykgKyAnXFxyXFxuJztcbn07XG5cbi8vIFBhcnNlcyBhIGV4dG1hcCBsaW5lIChoZWFkZXJleHRlbnNpb24gZnJvbSBSRkMgNTI4NSkuIFNhbXBsZSBpbnB1dDpcbi8vIGE9ZXh0bWFwOjIgdXJuOmlldGY6cGFyYW1zOnJ0cC1oZHJleHQ6dG9mZnNldFxuLy8gYT1leHRtYXA6Mi9zZW5kb25seSB1cm46aWV0ZjpwYXJhbXM6cnRwLWhkcmV4dDp0b2Zmc2V0XG5TRFBVdGlscy5wYXJzZUV4dG1hcCA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgY29uc3QgcGFydHMgPSBsaW5lLnN1YnN0cmluZyg5KS5zcGxpdCgnICcpO1xuICByZXR1cm4ge1xuICAgIGlkOiBwYXJzZUludChwYXJ0c1swXSwgMTApLFxuICAgIGRpcmVjdGlvbjogcGFydHNbMF0uaW5kZXhPZignLycpID4gMCA/IHBhcnRzWzBdLnNwbGl0KCcvJylbMV0gOiAnc2VuZHJlY3YnLFxuICAgIHVyaTogcGFydHNbMV0sXG4gICAgYXR0cmlidXRlczogcGFydHMuc2xpY2UoMikuam9pbignICcpLFxuICB9O1xufTtcblxuLy8gR2VuZXJhdGVzIGFuIGV4dG1hcCBsaW5lIGZyb20gUlRDUnRwSGVhZGVyRXh0ZW5zaW9uUGFyYW1ldGVycyBvclxuLy8gUlRDUnRwSGVhZGVyRXh0ZW5zaW9uLlxuU0RQVXRpbHMud3JpdGVFeHRtYXAgPSBmdW5jdGlvbihoZWFkZXJFeHRlbnNpb24pIHtcbiAgcmV0dXJuICdhPWV4dG1hcDonICsgKGhlYWRlckV4dGVuc2lvbi5pZCB8fCBoZWFkZXJFeHRlbnNpb24ucHJlZmVycmVkSWQpICtcbiAgICAgIChoZWFkZXJFeHRlbnNpb24uZGlyZWN0aW9uICYmIGhlYWRlckV4dGVuc2lvbi5kaXJlY3Rpb24gIT09ICdzZW5kcmVjdidcbiAgICAgICAgPyAnLycgKyBoZWFkZXJFeHRlbnNpb24uZGlyZWN0aW9uXG4gICAgICAgIDogJycpICtcbiAgICAgICcgJyArIGhlYWRlckV4dGVuc2lvbi51cmkgK1xuICAgICAgKGhlYWRlckV4dGVuc2lvbi5hdHRyaWJ1dGVzID8gJyAnICsgaGVhZGVyRXh0ZW5zaW9uLmF0dHJpYnV0ZXMgOiAnJykgK1xuICAgICAgJ1xcclxcbic7XG59O1xuXG4vLyBQYXJzZXMgYSBmbXRwIGxpbmUsIHJldHVybnMgZGljdGlvbmFyeS4gU2FtcGxlIGlucHV0OlxuLy8gYT1mbXRwOjk2IHZicj1vbjtjbmc9b25cbi8vIEFsc28gZGVhbHMgd2l0aCB2YnI9b247IGNuZz1vblxuU0RQVXRpbHMucGFyc2VGbXRwID0gZnVuY3Rpb24obGluZSkge1xuICBjb25zdCBwYXJzZWQgPSB7fTtcbiAgbGV0IGt2O1xuICBjb25zdCBwYXJ0cyA9IGxpbmUuc3Vic3RyaW5nKGxpbmUuaW5kZXhPZignICcpICsgMSkuc3BsaXQoJzsnKTtcbiAgZm9yIChsZXQgaiA9IDA7IGogPCBwYXJ0cy5sZW5ndGg7IGorKykge1xuICAgIGt2ID0gcGFydHNbal0udHJpbSgpLnNwbGl0KCc9Jyk7XG4gICAgcGFyc2VkW2t2WzBdLnRyaW0oKV0gPSBrdlsxXTtcbiAgfVxuICByZXR1cm4gcGFyc2VkO1xufTtcblxuLy8gR2VuZXJhdGVzIGEgZm10cCBsaW5lIGZyb20gUlRDUnRwQ29kZWNDYXBhYmlsaXR5IG9yIFJUQ1J0cENvZGVjUGFyYW1ldGVycy5cblNEUFV0aWxzLndyaXRlRm10cCA9IGZ1bmN0aW9uKGNvZGVjKSB7XG4gIGxldCBsaW5lID0gJyc7XG4gIGxldCBwdCA9IGNvZGVjLnBheWxvYWRUeXBlO1xuICBpZiAoY29kZWMucHJlZmVycmVkUGF5bG9hZFR5cGUgIT09IHVuZGVmaW5lZCkge1xuICAgIHB0ID0gY29kZWMucHJlZmVycmVkUGF5bG9hZFR5cGU7XG4gIH1cbiAgaWYgKGNvZGVjLnBhcmFtZXRlcnMgJiYgT2JqZWN0LmtleXMoY29kZWMucGFyYW1ldGVycykubGVuZ3RoKSB7XG4gICAgY29uc3QgcGFyYW1zID0gW107XG4gICAgT2JqZWN0LmtleXMoY29kZWMucGFyYW1ldGVycykuZm9yRWFjaChwYXJhbSA9PiB7XG4gICAgICBpZiAoY29kZWMucGFyYW1ldGVyc1twYXJhbV0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBwYXJhbXMucHVzaChwYXJhbSArICc9JyArIGNvZGVjLnBhcmFtZXRlcnNbcGFyYW1dKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHBhcmFtcy5wdXNoKHBhcmFtKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBsaW5lICs9ICdhPWZtdHA6JyArIHB0ICsgJyAnICsgcGFyYW1zLmpvaW4oJzsnKSArICdcXHJcXG4nO1xuICB9XG4gIHJldHVybiBsaW5lO1xufTtcblxuLy8gUGFyc2VzIGEgcnRjcC1mYiBsaW5lLCByZXR1cm5zIFJUQ1BSdGNwRmVlZGJhY2sgb2JqZWN0LiBTYW1wbGUgaW5wdXQ6XG4vLyBhPXJ0Y3AtZmI6OTggbmFjayBycHNpXG5TRFBVdGlscy5wYXJzZVJ0Y3BGYiA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgY29uc3QgcGFydHMgPSBsaW5lLnN1YnN0cmluZyhsaW5lLmluZGV4T2YoJyAnKSArIDEpLnNwbGl0KCcgJyk7XG4gIHJldHVybiB7XG4gICAgdHlwZTogcGFydHMuc2hpZnQoKSxcbiAgICBwYXJhbWV0ZXI6IHBhcnRzLmpvaW4oJyAnKSxcbiAgfTtcbn07XG5cbi8vIEdlbmVyYXRlIGE9cnRjcC1mYiBsaW5lcyBmcm9tIFJUQ1J0cENvZGVjQ2FwYWJpbGl0eSBvciBSVENSdHBDb2RlY1BhcmFtZXRlcnMuXG5TRFBVdGlscy53cml0ZVJ0Y3BGYiA9IGZ1bmN0aW9uKGNvZGVjKSB7XG4gIGxldCBsaW5lcyA9ICcnO1xuICBsZXQgcHQgPSBjb2RlYy5wYXlsb2FkVHlwZTtcbiAgaWYgKGNvZGVjLnByZWZlcnJlZFBheWxvYWRUeXBlICE9PSB1bmRlZmluZWQpIHtcbiAgICBwdCA9IGNvZGVjLnByZWZlcnJlZFBheWxvYWRUeXBlO1xuICB9XG4gIGlmIChjb2RlYy5ydGNwRmVlZGJhY2sgJiYgY29kZWMucnRjcEZlZWRiYWNrLmxlbmd0aCkge1xuICAgIC8vIEZJWE1FOiBzcGVjaWFsIGhhbmRsaW5nIGZvciB0cnItaW50P1xuICAgIGNvZGVjLnJ0Y3BGZWVkYmFjay5mb3JFYWNoKGZiID0+IHtcbiAgICAgIGxpbmVzICs9ICdhPXJ0Y3AtZmI6JyArIHB0ICsgJyAnICsgZmIudHlwZSArXG4gICAgICAoZmIucGFyYW1ldGVyICYmIGZiLnBhcmFtZXRlci5sZW5ndGggPyAnICcgKyBmYi5wYXJhbWV0ZXIgOiAnJykgK1xuICAgICAgICAgICdcXHJcXG4nO1xuICAgIH0pO1xuICB9XG4gIHJldHVybiBsaW5lcztcbn07XG5cbi8vIFBhcnNlcyBhIFJGQyA1NTc2IHNzcmMgbWVkaWEgYXR0cmlidXRlLiBTYW1wbGUgaW5wdXQ6XG4vLyBhPXNzcmM6MzczNTkyODU1OSBjbmFtZTpzb21ldGhpbmdcblNEUFV0aWxzLnBhcnNlU3NyY01lZGlhID0gZnVuY3Rpb24obGluZSkge1xuICBjb25zdCBzcCA9IGxpbmUuaW5kZXhPZignICcpO1xuICBjb25zdCBwYXJ0cyA9IHtcbiAgICBzc3JjOiBwYXJzZUludChsaW5lLnN1YnN0cmluZyg3LCBzcCksIDEwKSxcbiAgfTtcbiAgY29uc3QgY29sb24gPSBsaW5lLmluZGV4T2YoJzonLCBzcCk7XG4gIGlmIChjb2xvbiA+IC0xKSB7XG4gICAgcGFydHMuYXR0cmlidXRlID0gbGluZS5zdWJzdHJpbmcoc3AgKyAxLCBjb2xvbik7XG4gICAgcGFydHMudmFsdWUgPSBsaW5lLnN1YnN0cmluZyhjb2xvbiArIDEpO1xuICB9IGVsc2Uge1xuICAgIHBhcnRzLmF0dHJpYnV0ZSA9IGxpbmUuc3Vic3RyaW5nKHNwICsgMSk7XG4gIH1cbiAgcmV0dXJuIHBhcnRzO1xufTtcblxuLy8gUGFyc2UgYSBzc3JjLWdyb3VwIGxpbmUgKHNlZSBSRkMgNTU3NikuIFNhbXBsZSBpbnB1dDpcbi8vIGE9c3NyYy1ncm91cDpzZW1hbnRpY3MgMTIgMzRcblNEUFV0aWxzLnBhcnNlU3NyY0dyb3VwID0gZnVuY3Rpb24obGluZSkge1xuICBjb25zdCBwYXJ0cyA9IGxpbmUuc3Vic3RyaW5nKDEzKS5zcGxpdCgnICcpO1xuICByZXR1cm4ge1xuICAgIHNlbWFudGljczogcGFydHMuc2hpZnQoKSxcbiAgICBzc3JjczogcGFydHMubWFwKHNzcmMgPT4gcGFyc2VJbnQoc3NyYywgMTApKSxcbiAgfTtcbn07XG5cbi8vIEV4dHJhY3RzIHRoZSBNSUQgKFJGQyA1ODg4KSBmcm9tIGEgbWVkaWEgc2VjdGlvbi5cbi8vIFJldHVybnMgdGhlIE1JRCBvciB1bmRlZmluZWQgaWYgbm8gbWlkIGxpbmUgd2FzIGZvdW5kLlxuU0RQVXRpbHMuZ2V0TWlkID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIGNvbnN0IG1pZCA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9bWlkOicpWzBdO1xuICBpZiAobWlkKSB7XG4gICAgcmV0dXJuIG1pZC5zdWJzdHJpbmcoNik7XG4gIH1cbn07XG5cbi8vIFBhcnNlcyBhIGZpbmdlcnByaW50IGxpbmUgZm9yIERUTFMtU1JUUC5cblNEUFV0aWxzLnBhcnNlRmluZ2VycHJpbnQgPSBmdW5jdGlvbihsaW5lKSB7XG4gIGNvbnN0IHBhcnRzID0gbGluZS5zdWJzdHJpbmcoMTQpLnNwbGl0KCcgJyk7XG4gIHJldHVybiB7XG4gICAgYWxnb3JpdGhtOiBwYXJ0c1swXS50b0xvd2VyQ2FzZSgpLCAvLyBhbGdvcml0aG0gaXMgY2FzZS1zZW5zaXRpdmUgaW4gRWRnZS5cbiAgICB2YWx1ZTogcGFydHNbMV0udG9VcHBlckNhc2UoKSwgLy8gdGhlIGRlZmluaXRpb24gaXMgdXBwZXItY2FzZSBpbiBSRkMgNDU3Mi5cbiAgfTtcbn07XG5cbi8vIEV4dHJhY3RzIERUTFMgcGFyYW1ldGVycyBmcm9tIFNEUCBtZWRpYSBzZWN0aW9uIG9yIHNlc3Npb25wYXJ0LlxuLy8gRklYTUU6IGZvciBjb25zaXN0ZW5jeSB3aXRoIG90aGVyIGZ1bmN0aW9ucyB0aGlzIHNob3VsZCBvbmx5XG4vLyAgIGdldCB0aGUgZmluZ2VycHJpbnQgbGluZSBhcyBpbnB1dC4gU2VlIGFsc28gZ2V0SWNlUGFyYW1ldGVycy5cblNEUFV0aWxzLmdldER0bHNQYXJhbWV0ZXJzID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uLCBzZXNzaW9ucGFydCkge1xuICBjb25zdCBsaW5lcyA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiArIHNlc3Npb25wYXJ0LFxuICAgICdhPWZpbmdlcnByaW50OicpO1xuICAvLyBOb3RlOiBhPXNldHVwIGxpbmUgaXMgaWdub3JlZCBzaW5jZSB3ZSB1c2UgdGhlICdhdXRvJyByb2xlIGluIEVkZ2UuXG4gIHJldHVybiB7XG4gICAgcm9sZTogJ2F1dG8nLFxuICAgIGZpbmdlcnByaW50czogbGluZXMubWFwKFNEUFV0aWxzLnBhcnNlRmluZ2VycHJpbnQpLFxuICB9O1xufTtcblxuLy8gU2VyaWFsaXplcyBEVExTIHBhcmFtZXRlcnMgdG8gU0RQLlxuU0RQVXRpbHMud3JpdGVEdGxzUGFyYW1ldGVycyA9IGZ1bmN0aW9uKHBhcmFtcywgc2V0dXBUeXBlKSB7XG4gIGxldCBzZHAgPSAnYT1zZXR1cDonICsgc2V0dXBUeXBlICsgJ1xcclxcbic7XG4gIHBhcmFtcy5maW5nZXJwcmludHMuZm9yRWFjaChmcCA9PiB7XG4gICAgc2RwICs9ICdhPWZpbmdlcnByaW50OicgKyBmcC5hbGdvcml0aG0gKyAnICcgKyBmcC52YWx1ZSArICdcXHJcXG4nO1xuICB9KTtcbiAgcmV0dXJuIHNkcDtcbn07XG5cbi8vIFBhcnNlcyBhPWNyeXB0byBsaW5lcyBpbnRvXG4vLyAgIGh0dHBzOi8vcmF3Z2l0LmNvbS9hYm9iYS9lZGdlcnRjL21hc3Rlci9tc29ydGMtcnM0Lmh0bWwjZGljdGlvbmFyeS1ydGNzcnRwc2Rlc3BhcmFtZXRlcnMtbWVtYmVyc1xuU0RQVXRpbHMucGFyc2VDcnlwdG9MaW5lID0gZnVuY3Rpb24obGluZSkge1xuICBjb25zdCBwYXJ0cyA9IGxpbmUuc3Vic3RyaW5nKDkpLnNwbGl0KCcgJyk7XG4gIHJldHVybiB7XG4gICAgdGFnOiBwYXJzZUludChwYXJ0c1swXSwgMTApLFxuICAgIGNyeXB0b1N1aXRlOiBwYXJ0c1sxXSxcbiAgICBrZXlQYXJhbXM6IHBhcnRzWzJdLFxuICAgIHNlc3Npb25QYXJhbXM6IHBhcnRzLnNsaWNlKDMpLFxuICB9O1xufTtcblxuU0RQVXRpbHMud3JpdGVDcnlwdG9MaW5lID0gZnVuY3Rpb24ocGFyYW1ldGVycykge1xuICByZXR1cm4gJ2E9Y3J5cHRvOicgKyBwYXJhbWV0ZXJzLnRhZyArICcgJyArXG4gICAgcGFyYW1ldGVycy5jcnlwdG9TdWl0ZSArICcgJyArXG4gICAgKHR5cGVvZiBwYXJhbWV0ZXJzLmtleVBhcmFtcyA9PT0gJ29iamVjdCdcbiAgICAgID8gU0RQVXRpbHMud3JpdGVDcnlwdG9LZXlQYXJhbXMocGFyYW1ldGVycy5rZXlQYXJhbXMpXG4gICAgICA6IHBhcmFtZXRlcnMua2V5UGFyYW1zKSArXG4gICAgKHBhcmFtZXRlcnMuc2Vzc2lvblBhcmFtcyA/ICcgJyArIHBhcmFtZXRlcnMuc2Vzc2lvblBhcmFtcy5qb2luKCcgJykgOiAnJykgK1xuICAgICdcXHJcXG4nO1xufTtcblxuLy8gUGFyc2VzIHRoZSBjcnlwdG8ga2V5IHBhcmFtZXRlcnMgaW50b1xuLy8gICBodHRwczovL3Jhd2dpdC5jb20vYWJvYmEvZWRnZXJ0Yy9tYXN0ZXIvbXNvcnRjLXJzNC5odG1sI3J0Y3NydHBrZXlwYXJhbSpcblNEUFV0aWxzLnBhcnNlQ3J5cHRvS2V5UGFyYW1zID0gZnVuY3Rpb24oa2V5UGFyYW1zKSB7XG4gIGlmIChrZXlQYXJhbXMuaW5kZXhPZignaW5saW5lOicpICE9PSAwKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgY29uc3QgcGFydHMgPSBrZXlQYXJhbXMuc3Vic3RyaW5nKDcpLnNwbGl0KCd8Jyk7XG4gIHJldHVybiB7XG4gICAga2V5TWV0aG9kOiAnaW5saW5lJyxcbiAgICBrZXlTYWx0OiBwYXJ0c1swXSxcbiAgICBsaWZlVGltZTogcGFydHNbMV0sXG4gICAgbWtpVmFsdWU6IHBhcnRzWzJdID8gcGFydHNbMl0uc3BsaXQoJzonKVswXSA6IHVuZGVmaW5lZCxcbiAgICBta2lMZW5ndGg6IHBhcnRzWzJdID8gcGFydHNbMl0uc3BsaXQoJzonKVsxXSA6IHVuZGVmaW5lZCxcbiAgfTtcbn07XG5cblNEUFV0aWxzLndyaXRlQ3J5cHRvS2V5UGFyYW1zID0gZnVuY3Rpb24oa2V5UGFyYW1zKSB7XG4gIHJldHVybiBrZXlQYXJhbXMua2V5TWV0aG9kICsgJzonXG4gICAgKyBrZXlQYXJhbXMua2V5U2FsdCArXG4gICAgKGtleVBhcmFtcy5saWZlVGltZSA/ICd8JyArIGtleVBhcmFtcy5saWZlVGltZSA6ICcnKSArXG4gICAgKGtleVBhcmFtcy5ta2lWYWx1ZSAmJiBrZXlQYXJhbXMubWtpTGVuZ3RoXG4gICAgICA/ICd8JyArIGtleVBhcmFtcy5ta2lWYWx1ZSArICc6JyArIGtleVBhcmFtcy5ta2lMZW5ndGhcbiAgICAgIDogJycpO1xufTtcblxuLy8gRXh0cmFjdHMgYWxsIFNERVMgcGFyYW1ldGVycy5cblNEUFV0aWxzLmdldENyeXB0b1BhcmFtZXRlcnMgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24sIHNlc3Npb25wYXJ0KSB7XG4gIGNvbnN0IGxpbmVzID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uICsgc2Vzc2lvbnBhcnQsXG4gICAgJ2E9Y3J5cHRvOicpO1xuICByZXR1cm4gbGluZXMubWFwKFNEUFV0aWxzLnBhcnNlQ3J5cHRvTGluZSk7XG59O1xuXG4vLyBQYXJzZXMgSUNFIGluZm9ybWF0aW9uIGZyb20gU0RQIG1lZGlhIHNlY3Rpb24gb3Igc2Vzc2lvbnBhcnQuXG4vLyBGSVhNRTogZm9yIGNvbnNpc3RlbmN5IHdpdGggb3RoZXIgZnVuY3Rpb25zIHRoaXMgc2hvdWxkIG9ubHlcbi8vICAgZ2V0IHRoZSBpY2UtdWZyYWcgYW5kIGljZS1wd2QgbGluZXMgYXMgaW5wdXQuXG5TRFBVdGlscy5nZXRJY2VQYXJhbWV0ZXJzID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uLCBzZXNzaW9ucGFydCkge1xuICBjb25zdCB1ZnJhZyA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiArIHNlc3Npb25wYXJ0LFxuICAgICdhPWljZS11ZnJhZzonKVswXTtcbiAgY29uc3QgcHdkID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uICsgc2Vzc2lvbnBhcnQsXG4gICAgJ2E9aWNlLXB3ZDonKVswXTtcbiAgaWYgKCEodWZyYWcgJiYgcHdkKSkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIHJldHVybiB7XG4gICAgdXNlcm5hbWVGcmFnbWVudDogdWZyYWcuc3Vic3RyaW5nKDEyKSxcbiAgICBwYXNzd29yZDogcHdkLnN1YnN0cmluZygxMCksXG4gIH07XG59O1xuXG4vLyBTZXJpYWxpemVzIElDRSBwYXJhbWV0ZXJzIHRvIFNEUC5cblNEUFV0aWxzLndyaXRlSWNlUGFyYW1ldGVycyA9IGZ1bmN0aW9uKHBhcmFtcykge1xuICBsZXQgc2RwID0gJ2E9aWNlLXVmcmFnOicgKyBwYXJhbXMudXNlcm5hbWVGcmFnbWVudCArICdcXHJcXG4nICtcbiAgICAgICdhPWljZS1wd2Q6JyArIHBhcmFtcy5wYXNzd29yZCArICdcXHJcXG4nO1xuICBpZiAocGFyYW1zLmljZUxpdGUpIHtcbiAgICBzZHAgKz0gJ2E9aWNlLWxpdGVcXHJcXG4nO1xuICB9XG4gIHJldHVybiBzZHA7XG59O1xuXG4vLyBQYXJzZXMgdGhlIFNEUCBtZWRpYSBzZWN0aW9uIGFuZCByZXR1cm5zIFJUQ1J0cFBhcmFtZXRlcnMuXG5TRFBVdGlscy5wYXJzZVJ0cFBhcmFtZXRlcnMgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgY29uc3QgZGVzY3JpcHRpb24gPSB7XG4gICAgY29kZWNzOiBbXSxcbiAgICBoZWFkZXJFeHRlbnNpb25zOiBbXSxcbiAgICBmZWNNZWNoYW5pc21zOiBbXSxcbiAgICBydGNwOiBbXSxcbiAgfTtcbiAgY29uc3QgbGluZXMgPSBTRFBVdGlscy5zcGxpdExpbmVzKG1lZGlhU2VjdGlvbik7XG4gIGNvbnN0IG1saW5lID0gbGluZXNbMF0uc3BsaXQoJyAnKTtcbiAgZGVzY3JpcHRpb24ucHJvZmlsZSA9IG1saW5lWzJdO1xuICBmb3IgKGxldCBpID0gMzsgaSA8IG1saW5lLmxlbmd0aDsgaSsrKSB7IC8vIGZpbmQgYWxsIGNvZGVjcyBmcm9tIG1saW5lWzMuLl1cbiAgICBjb25zdCBwdCA9IG1saW5lW2ldO1xuICAgIGNvbnN0IHJ0cG1hcGxpbmUgPSBTRFBVdGlscy5tYXRjaFByZWZpeChcbiAgICAgIG1lZGlhU2VjdGlvbiwgJ2E9cnRwbWFwOicgKyBwdCArICcgJylbMF07XG4gICAgaWYgKHJ0cG1hcGxpbmUpIHtcbiAgICAgIGNvbnN0IGNvZGVjID0gU0RQVXRpbHMucGFyc2VSdHBNYXAocnRwbWFwbGluZSk7XG4gICAgICBjb25zdCBmbXRwcyA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KFxuICAgICAgICBtZWRpYVNlY3Rpb24sICdhPWZtdHA6JyArIHB0ICsgJyAnKTtcbiAgICAgIC8vIE9ubHkgdGhlIGZpcnN0IGE9Zm10cDo8cHQ+IGlzIGNvbnNpZGVyZWQuXG4gICAgICBjb2RlYy5wYXJhbWV0ZXJzID0gZm10cHMubGVuZ3RoID8gU0RQVXRpbHMucGFyc2VGbXRwKGZtdHBzWzBdKSA6IHt9O1xuICAgICAgY29kZWMucnRjcEZlZWRiYWNrID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgoXG4gICAgICAgIG1lZGlhU2VjdGlvbiwgJ2E9cnRjcC1mYjonICsgcHQgKyAnICcpXG4gICAgICAgIC5tYXAoU0RQVXRpbHMucGFyc2VSdGNwRmIpO1xuICAgICAgZGVzY3JpcHRpb24uY29kZWNzLnB1c2goY29kZWMpO1xuICAgICAgLy8gcGFyc2UgRkVDIG1lY2hhbmlzbXMgZnJvbSBydHBtYXAgbGluZXMuXG4gICAgICBzd2l0Y2ggKGNvZGVjLm5hbWUudG9VcHBlckNhc2UoKSkge1xuICAgICAgICBjYXNlICdSRUQnOlxuICAgICAgICBjYXNlICdVTFBGRUMnOlxuICAgICAgICAgIGRlc2NyaXB0aW9uLmZlY01lY2hhbmlzbXMucHVzaChjb2RlYy5uYW1lLnRvVXBwZXJDYXNlKCkpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OiAvLyBvbmx5IFJFRCBhbmQgVUxQRkVDIGFyZSByZWNvZ25pemVkIGFzIEZFQyBtZWNoYW5pc21zLlxuICAgICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPWV4dG1hcDonKS5mb3JFYWNoKGxpbmUgPT4ge1xuICAgIGRlc2NyaXB0aW9uLmhlYWRlckV4dGVuc2lvbnMucHVzaChTRFBVdGlscy5wYXJzZUV4dG1hcChsaW5lKSk7XG4gIH0pO1xuICBjb25zdCB3aWxkY2FyZFJ0Y3BGYiA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9cnRjcC1mYjoqICcpXG4gICAgLm1hcChTRFBVdGlscy5wYXJzZVJ0Y3BGYik7XG4gIGRlc2NyaXB0aW9uLmNvZGVjcy5mb3JFYWNoKGNvZGVjID0+IHtcbiAgICB3aWxkY2FyZFJ0Y3BGYi5mb3JFYWNoKGZiPT4ge1xuICAgICAgY29uc3QgZHVwbGljYXRlID0gY29kZWMucnRjcEZlZWRiYWNrLmZpbmQoZXhpc3RpbmdGZWVkYmFjayA9PiB7XG4gICAgICAgIHJldHVybiBleGlzdGluZ0ZlZWRiYWNrLnR5cGUgPT09IGZiLnR5cGUgJiZcbiAgICAgICAgICBleGlzdGluZ0ZlZWRiYWNrLnBhcmFtZXRlciA9PT0gZmIucGFyYW1ldGVyO1xuICAgICAgfSk7XG4gICAgICBpZiAoIWR1cGxpY2F0ZSkge1xuICAgICAgICBjb2RlYy5ydGNwRmVlZGJhY2sucHVzaChmYik7XG4gICAgICB9XG4gICAgfSk7XG4gIH0pO1xuICAvLyBGSVhNRTogcGFyc2UgcnRjcC5cbiAgcmV0dXJuIGRlc2NyaXB0aW9uO1xufTtcblxuLy8gR2VuZXJhdGVzIHBhcnRzIG9mIHRoZSBTRFAgbWVkaWEgc2VjdGlvbiBkZXNjcmliaW5nIHRoZSBjYXBhYmlsaXRpZXMgL1xuLy8gcGFyYW1ldGVycy5cblNEUFV0aWxzLndyaXRlUnRwRGVzY3JpcHRpb24gPSBmdW5jdGlvbihraW5kLCBjYXBzKSB7XG4gIGxldCBzZHAgPSAnJztcblxuICAvLyBCdWlsZCB0aGUgbWxpbmUuXG4gIHNkcCArPSAnbT0nICsga2luZCArICcgJztcbiAgc2RwICs9IGNhcHMuY29kZWNzLmxlbmd0aCA+IDAgPyAnOScgOiAnMCc7IC8vIHJlamVjdCBpZiBubyBjb2RlY3MuXG4gIHNkcCArPSAnICcgKyAoY2Fwcy5wcm9maWxlIHx8ICdVRFAvVExTL1JUUC9TQVZQRicpICsgJyAnO1xuICBzZHAgKz0gY2Fwcy5jb2RlY3MubWFwKGNvZGVjID0+IHtcbiAgICBpZiAoY29kZWMucHJlZmVycmVkUGF5bG9hZFR5cGUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIGNvZGVjLnByZWZlcnJlZFBheWxvYWRUeXBlO1xuICAgIH1cbiAgICByZXR1cm4gY29kZWMucGF5bG9hZFR5cGU7XG4gIH0pLmpvaW4oJyAnKSArICdcXHJcXG4nO1xuXG4gIHNkcCArPSAnYz1JTiBJUDQgMC4wLjAuMFxcclxcbic7XG4gIHNkcCArPSAnYT1ydGNwOjkgSU4gSVA0IDAuMC4wLjBcXHJcXG4nO1xuXG4gIC8vIEFkZCBhPXJ0cG1hcCBsaW5lcyBmb3IgZWFjaCBjb2RlYy4gQWxzbyBmbXRwIGFuZCBydGNwLWZiLlxuICBjYXBzLmNvZGVjcy5mb3JFYWNoKGNvZGVjID0+IHtcbiAgICBzZHAgKz0gU0RQVXRpbHMud3JpdGVSdHBNYXAoY29kZWMpO1xuICAgIHNkcCArPSBTRFBVdGlscy53cml0ZUZtdHAoY29kZWMpO1xuICAgIHNkcCArPSBTRFBVdGlscy53cml0ZVJ0Y3BGYihjb2RlYyk7XG4gIH0pO1xuICBsZXQgbWF4cHRpbWUgPSAwO1xuICBjYXBzLmNvZGVjcy5mb3JFYWNoKGNvZGVjID0+IHtcbiAgICBpZiAoY29kZWMubWF4cHRpbWUgPiBtYXhwdGltZSkge1xuICAgICAgbWF4cHRpbWUgPSBjb2RlYy5tYXhwdGltZTtcbiAgICB9XG4gIH0pO1xuICBpZiAobWF4cHRpbWUgPiAwKSB7XG4gICAgc2RwICs9ICdhPW1heHB0aW1lOicgKyBtYXhwdGltZSArICdcXHJcXG4nO1xuICB9XG5cbiAgaWYgKGNhcHMuaGVhZGVyRXh0ZW5zaW9ucykge1xuICAgIGNhcHMuaGVhZGVyRXh0ZW5zaW9ucy5mb3JFYWNoKGV4dGVuc2lvbiA9PiB7XG4gICAgICBzZHAgKz0gU0RQVXRpbHMud3JpdGVFeHRtYXAoZXh0ZW5zaW9uKTtcbiAgICB9KTtcbiAgfVxuICAvLyBGSVhNRTogd3JpdGUgZmVjTWVjaGFuaXNtcy5cbiAgcmV0dXJuIHNkcDtcbn07XG5cbi8vIFBhcnNlcyB0aGUgU0RQIG1lZGlhIHNlY3Rpb24gYW5kIHJldHVybnMgYW4gYXJyYXkgb2Zcbi8vIFJUQ1J0cEVuY29kaW5nUGFyYW1ldGVycy5cblNEUFV0aWxzLnBhcnNlUnRwRW5jb2RpbmdQYXJhbWV0ZXJzID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIGNvbnN0IGVuY29kaW5nUGFyYW1ldGVycyA9IFtdO1xuICBjb25zdCBkZXNjcmlwdGlvbiA9IFNEUFV0aWxzLnBhcnNlUnRwUGFyYW1ldGVycyhtZWRpYVNlY3Rpb24pO1xuICBjb25zdCBoYXNSZWQgPSBkZXNjcmlwdGlvbi5mZWNNZWNoYW5pc21zLmluZGV4T2YoJ1JFRCcpICE9PSAtMTtcbiAgY29uc3QgaGFzVWxwZmVjID0gZGVzY3JpcHRpb24uZmVjTWVjaGFuaXNtcy5pbmRleE9mKCdVTFBGRUMnKSAhPT0gLTE7XG5cbiAgLy8gZmlsdGVyIGE9c3NyYzouLi4gY25hbWU6LCBpZ25vcmUgUGxhbkItbXNpZFxuICBjb25zdCBzc3JjcyA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9c3NyYzonKVxuICAgIC5tYXAobGluZSA9PiBTRFBVdGlscy5wYXJzZVNzcmNNZWRpYShsaW5lKSlcbiAgICAuZmlsdGVyKHBhcnRzID0+IHBhcnRzLmF0dHJpYnV0ZSA9PT0gJ2NuYW1lJyk7XG4gIGNvbnN0IHByaW1hcnlTc3JjID0gc3NyY3MubGVuZ3RoID4gMCAmJiBzc3Jjc1swXS5zc3JjO1xuICBsZXQgc2Vjb25kYXJ5U3NyYztcblxuICBjb25zdCBmbG93cyA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9c3NyYy1ncm91cDpGSUQnKVxuICAgIC5tYXAobGluZSA9PiB7XG4gICAgICBjb25zdCBwYXJ0cyA9IGxpbmUuc3Vic3RyaW5nKDE3KS5zcGxpdCgnICcpO1xuICAgICAgcmV0dXJuIHBhcnRzLm1hcChwYXJ0ID0+IHBhcnNlSW50KHBhcnQsIDEwKSk7XG4gICAgfSk7XG4gIGlmIChmbG93cy5sZW5ndGggPiAwICYmIGZsb3dzWzBdLmxlbmd0aCA+IDEgJiYgZmxvd3NbMF1bMF0gPT09IHByaW1hcnlTc3JjKSB7XG4gICAgc2Vjb25kYXJ5U3NyYyA9IGZsb3dzWzBdWzFdO1xuICB9XG5cbiAgZGVzY3JpcHRpb24uY29kZWNzLmZvckVhY2goY29kZWMgPT4ge1xuICAgIGlmIChjb2RlYy5uYW1lLnRvVXBwZXJDYXNlKCkgPT09ICdSVFgnICYmIGNvZGVjLnBhcmFtZXRlcnMuYXB0KSB7XG4gICAgICBsZXQgZW5jUGFyYW0gPSB7XG4gICAgICAgIHNzcmM6IHByaW1hcnlTc3JjLFxuICAgICAgICBjb2RlY1BheWxvYWRUeXBlOiBwYXJzZUludChjb2RlYy5wYXJhbWV0ZXJzLmFwdCwgMTApLFxuICAgICAgfTtcbiAgICAgIGlmIChwcmltYXJ5U3NyYyAmJiBzZWNvbmRhcnlTc3JjKSB7XG4gICAgICAgIGVuY1BhcmFtLnJ0eCA9IHtzc3JjOiBzZWNvbmRhcnlTc3JjfTtcbiAgICAgIH1cbiAgICAgIGVuY29kaW5nUGFyYW1ldGVycy5wdXNoKGVuY1BhcmFtKTtcbiAgICAgIGlmIChoYXNSZWQpIHtcbiAgICAgICAgZW5jUGFyYW0gPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KGVuY1BhcmFtKSk7XG4gICAgICAgIGVuY1BhcmFtLmZlYyA9IHtcbiAgICAgICAgICBzc3JjOiBwcmltYXJ5U3NyYyxcbiAgICAgICAgICBtZWNoYW5pc206IGhhc1VscGZlYyA/ICdyZWQrdWxwZmVjJyA6ICdyZWQnLFxuICAgICAgICB9O1xuICAgICAgICBlbmNvZGluZ1BhcmFtZXRlcnMucHVzaChlbmNQYXJhbSk7XG4gICAgICB9XG4gICAgfVxuICB9KTtcbiAgaWYgKGVuY29kaW5nUGFyYW1ldGVycy5sZW5ndGggPT09IDAgJiYgcHJpbWFyeVNzcmMpIHtcbiAgICBlbmNvZGluZ1BhcmFtZXRlcnMucHVzaCh7XG4gICAgICBzc3JjOiBwcmltYXJ5U3NyYyxcbiAgICB9KTtcbiAgfVxuXG4gIC8vIHdlIHN1cHBvcnQgYm90aCBiPUFTIGFuZCBiPVRJQVMgYnV0IGludGVycHJldCBBUyBhcyBUSUFTLlxuICBsZXQgYmFuZHdpZHRoID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYj0nKTtcbiAgaWYgKGJhbmR3aWR0aC5sZW5ndGgpIHtcbiAgICBpZiAoYmFuZHdpZHRoWzBdLmluZGV4T2YoJ2I9VElBUzonKSA9PT0gMCkge1xuICAgICAgYmFuZHdpZHRoID0gcGFyc2VJbnQoYmFuZHdpZHRoWzBdLnN1YnN0cmluZyg3KSwgMTApO1xuICAgIH0gZWxzZSBpZiAoYmFuZHdpZHRoWzBdLmluZGV4T2YoJ2I9QVM6JykgPT09IDApIHtcbiAgICAgIC8vIHVzZSBmb3JtdWxhIGZyb20gSlNFUCB0byBjb252ZXJ0IGI9QVMgdG8gVElBUyB2YWx1ZS5cbiAgICAgIGJhbmR3aWR0aCA9IHBhcnNlSW50KGJhbmR3aWR0aFswXS5zdWJzdHJpbmcoNSksIDEwKSAqIDEwMDAgKiAwLjk1XG4gICAgICAgICAgLSAoNTAgKiA0MCAqIDgpO1xuICAgIH0gZWxzZSB7XG4gICAgICBiYW5kd2lkdGggPSB1bmRlZmluZWQ7XG4gICAgfVxuICAgIGVuY29kaW5nUGFyYW1ldGVycy5mb3JFYWNoKHBhcmFtcyA9PiB7XG4gICAgICBwYXJhbXMubWF4Qml0cmF0ZSA9IGJhbmR3aWR0aDtcbiAgICB9KTtcbiAgfVxuICByZXR1cm4gZW5jb2RpbmdQYXJhbWV0ZXJzO1xufTtcblxuLy8gcGFyc2VzIGh0dHA6Ly9kcmFmdC5vcnRjLm9yZy8jcnRjcnRjcHBhcmFtZXRlcnMqXG5TRFBVdGlscy5wYXJzZVJ0Y3BQYXJhbWV0ZXJzID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIGNvbnN0IHJ0Y3BQYXJhbWV0ZXJzID0ge307XG5cbiAgLy8gR2V0cyB0aGUgZmlyc3QgU1NSQy4gTm90ZSB0aGF0IHdpdGggUlRYIHRoZXJlIG1pZ2h0IGJlIG11bHRpcGxlXG4gIC8vIFNTUkNzLlxuICBjb25zdCByZW1vdGVTc3JjID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1zc3JjOicpXG4gICAgLm1hcChsaW5lID0+IFNEUFV0aWxzLnBhcnNlU3NyY01lZGlhKGxpbmUpKVxuICAgIC5maWx0ZXIob2JqID0+IG9iai5hdHRyaWJ1dGUgPT09ICdjbmFtZScpWzBdO1xuICBpZiAocmVtb3RlU3NyYykge1xuICAgIHJ0Y3BQYXJhbWV0ZXJzLmNuYW1lID0gcmVtb3RlU3NyYy52YWx1ZTtcbiAgICBydGNwUGFyYW1ldGVycy5zc3JjID0gcmVtb3RlU3NyYy5zc3JjO1xuICB9XG5cbiAgLy8gRWRnZSB1c2VzIHRoZSBjb21wb3VuZCBhdHRyaWJ1dGUgaW5zdGVhZCBvZiByZWR1Y2VkU2l6ZVxuICAvLyBjb21wb3VuZCBpcyAhcmVkdWNlZFNpemVcbiAgY29uc3QgcnNpemUgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPXJ0Y3AtcnNpemUnKTtcbiAgcnRjcFBhcmFtZXRlcnMucmVkdWNlZFNpemUgPSByc2l6ZS5sZW5ndGggPiAwO1xuICBydGNwUGFyYW1ldGVycy5jb21wb3VuZCA9IHJzaXplLmxlbmd0aCA9PT0gMDtcblxuICAvLyBwYXJzZXMgdGhlIHJ0Y3AtbXV4IGF0dHLRlmJ1dGUuXG4gIC8vIE5vdGUgdGhhdCBFZGdlIGRvZXMgbm90IHN1cHBvcnQgdW5tdXhlZCBSVENQLlxuICBjb25zdCBtdXggPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPXJ0Y3AtbXV4Jyk7XG4gIHJ0Y3BQYXJhbWV0ZXJzLm11eCA9IG11eC5sZW5ndGggPiAwO1xuXG4gIHJldHVybiBydGNwUGFyYW1ldGVycztcbn07XG5cblNEUFV0aWxzLndyaXRlUnRjcFBhcmFtZXRlcnMgPSBmdW5jdGlvbihydGNwUGFyYW1ldGVycykge1xuICBsZXQgc2RwID0gJyc7XG4gIGlmIChydGNwUGFyYW1ldGVycy5yZWR1Y2VkU2l6ZSkge1xuICAgIHNkcCArPSAnYT1ydGNwLXJzaXplXFxyXFxuJztcbiAgfVxuICBpZiAocnRjcFBhcmFtZXRlcnMubXV4KSB7XG4gICAgc2RwICs9ICdhPXJ0Y3AtbXV4XFxyXFxuJztcbiAgfVxuICBpZiAocnRjcFBhcmFtZXRlcnMuc3NyYyAhPT0gdW5kZWZpbmVkICYmIHJ0Y3BQYXJhbWV0ZXJzLmNuYW1lKSB7XG4gICAgc2RwICs9ICdhPXNzcmM6JyArIHJ0Y3BQYXJhbWV0ZXJzLnNzcmMgK1xuICAgICAgJyBjbmFtZTonICsgcnRjcFBhcmFtZXRlcnMuY25hbWUgKyAnXFxyXFxuJztcbiAgfVxuICByZXR1cm4gc2RwO1xufTtcblxuXG4vLyBwYXJzZXMgZWl0aGVyIGE9bXNpZDogb3IgYT1zc3JjOi4uLiBtc2lkIGxpbmVzIGFuZCByZXR1cm5zXG4vLyB0aGUgaWQgb2YgdGhlIE1lZGlhU3RyZWFtIGFuZCBNZWRpYVN0cmVhbVRyYWNrLlxuU0RQVXRpbHMucGFyc2VNc2lkID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIGxldCBwYXJ0cztcbiAgY29uc3Qgc3BlYyA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9bXNpZDonKTtcbiAgaWYgKHNwZWMubGVuZ3RoID09PSAxKSB7XG4gICAgcGFydHMgPSBzcGVjWzBdLnN1YnN0cmluZyg3KS5zcGxpdCgnICcpO1xuICAgIHJldHVybiB7c3RyZWFtOiBwYXJ0c1swXSwgdHJhY2s6IHBhcnRzWzFdfTtcbiAgfVxuICBjb25zdCBwbGFuQiA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9c3NyYzonKVxuICAgIC5tYXAobGluZSA9PiBTRFBVdGlscy5wYXJzZVNzcmNNZWRpYShsaW5lKSlcbiAgICAuZmlsdGVyKG1zaWRQYXJ0cyA9PiBtc2lkUGFydHMuYXR0cmlidXRlID09PSAnbXNpZCcpO1xuICBpZiAocGxhbkIubGVuZ3RoID4gMCkge1xuICAgIHBhcnRzID0gcGxhbkJbMF0udmFsdWUuc3BsaXQoJyAnKTtcbiAgICByZXR1cm4ge3N0cmVhbTogcGFydHNbMF0sIHRyYWNrOiBwYXJ0c1sxXX07XG4gIH1cbn07XG5cbi8vIFNDVFBcbi8vIHBhcnNlcyBkcmFmdC1pZXRmLW1tdXNpYy1zY3RwLXNkcC0yNiBmaXJzdCBhbmQgZmFsbHMgYmFja1xuLy8gdG8gZHJhZnQtaWV0Zi1tbXVzaWMtc2N0cC1zZHAtMDVcblNEUFV0aWxzLnBhcnNlU2N0cERlc2NyaXB0aW9uID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIGNvbnN0IG1saW5lID0gU0RQVXRpbHMucGFyc2VNTGluZShtZWRpYVNlY3Rpb24pO1xuICBjb25zdCBtYXhTaXplTGluZSA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9bWF4LW1lc3NhZ2Utc2l6ZTonKTtcbiAgbGV0IG1heE1lc3NhZ2VTaXplO1xuICBpZiAobWF4U2l6ZUxpbmUubGVuZ3RoID4gMCkge1xuICAgIG1heE1lc3NhZ2VTaXplID0gcGFyc2VJbnQobWF4U2l6ZUxpbmVbMF0uc3Vic3RyaW5nKDE5KSwgMTApO1xuICB9XG4gIGlmIChpc05hTihtYXhNZXNzYWdlU2l6ZSkpIHtcbiAgICBtYXhNZXNzYWdlU2l6ZSA9IDY1NTM2O1xuICB9XG4gIGNvbnN0IHNjdHBQb3J0ID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1zY3RwLXBvcnQ6Jyk7XG4gIGlmIChzY3RwUG9ydC5sZW5ndGggPiAwKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHBvcnQ6IHBhcnNlSW50KHNjdHBQb3J0WzBdLnN1YnN0cmluZygxMiksIDEwKSxcbiAgICAgIHByb3RvY29sOiBtbGluZS5mbXQsXG4gICAgICBtYXhNZXNzYWdlU2l6ZSxcbiAgICB9O1xuICB9XG4gIGNvbnN0IHNjdHBNYXBMaW5lcyA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9c2N0cG1hcDonKTtcbiAgaWYgKHNjdHBNYXBMaW5lcy5sZW5ndGggPiAwKSB7XG4gICAgY29uc3QgcGFydHMgPSBzY3RwTWFwTGluZXNbMF1cbiAgICAgIC5zdWJzdHJpbmcoMTApXG4gICAgICAuc3BsaXQoJyAnKTtcbiAgICByZXR1cm4ge1xuICAgICAgcG9ydDogcGFyc2VJbnQocGFydHNbMF0sIDEwKSxcbiAgICAgIHByb3RvY29sOiBwYXJ0c1sxXSxcbiAgICAgIG1heE1lc3NhZ2VTaXplLFxuICAgIH07XG4gIH1cbn07XG5cbi8vIFNDVFBcbi8vIG91dHB1dHMgdGhlIGRyYWZ0LWlldGYtbW11c2ljLXNjdHAtc2RwLTI2IHZlcnNpb24gdGhhdCBhbGwgYnJvd3NlcnNcbi8vIHN1cHBvcnQgYnkgbm93IHJlY2VpdmluZyBpbiB0aGlzIGZvcm1hdCwgdW5sZXNzIHdlIG9yaWdpbmFsbHkgcGFyc2VkXG4vLyBhcyB0aGUgZHJhZnQtaWV0Zi1tbXVzaWMtc2N0cC1zZHAtMDUgZm9ybWF0IChpbmRpY2F0ZWQgYnkgdGhlIG0tbGluZVxuLy8gcHJvdG9jb2wgb2YgRFRMUy9TQ1RQIC0tIHdpdGhvdXQgVURQLyBvciBUQ1AvKVxuU0RQVXRpbHMud3JpdGVTY3RwRGVzY3JpcHRpb24gPSBmdW5jdGlvbihtZWRpYSwgc2N0cCkge1xuICBsZXQgb3V0cHV0ID0gW107XG4gIGlmIChtZWRpYS5wcm90b2NvbCAhPT0gJ0RUTFMvU0NUUCcpIHtcbiAgICBvdXRwdXQgPSBbXG4gICAgICAnbT0nICsgbWVkaWEua2luZCArICcgOSAnICsgbWVkaWEucHJvdG9jb2wgKyAnICcgKyBzY3RwLnByb3RvY29sICsgJ1xcclxcbicsXG4gICAgICAnYz1JTiBJUDQgMC4wLjAuMFxcclxcbicsXG4gICAgICAnYT1zY3RwLXBvcnQ6JyArIHNjdHAucG9ydCArICdcXHJcXG4nLFxuICAgIF07XG4gIH0gZWxzZSB7XG4gICAgb3V0cHV0ID0gW1xuICAgICAgJ209JyArIG1lZGlhLmtpbmQgKyAnIDkgJyArIG1lZGlhLnByb3RvY29sICsgJyAnICsgc2N0cC5wb3J0ICsgJ1xcclxcbicsXG4gICAgICAnYz1JTiBJUDQgMC4wLjAuMFxcclxcbicsXG4gICAgICAnYT1zY3RwbWFwOicgKyBzY3RwLnBvcnQgKyAnICcgKyBzY3RwLnByb3RvY29sICsgJyA2NTUzNVxcclxcbicsXG4gICAgXTtcbiAgfVxuICBpZiAoc2N0cC5tYXhNZXNzYWdlU2l6ZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgb3V0cHV0LnB1c2goJ2E9bWF4LW1lc3NhZ2Utc2l6ZTonICsgc2N0cC5tYXhNZXNzYWdlU2l6ZSArICdcXHJcXG4nKTtcbiAgfVxuICByZXR1cm4gb3V0cHV0LmpvaW4oJycpO1xufTtcblxuLy8gR2VuZXJhdGUgYSBzZXNzaW9uIElEIGZvciBTRFAuXG4vLyBodHRwczovL3Rvb2xzLmlldGYub3JnL2h0bWwvZHJhZnQtaWV0Zi1ydGN3ZWItanNlcC0yMCNzZWN0aW9uLTUuMi4xXG4vLyByZWNvbW1lbmRzIHVzaW5nIGEgY3J5cHRvZ3JhcGhpY2FsbHkgcmFuZG9tICt2ZSA2NC1iaXQgdmFsdWVcbi8vIGJ1dCByaWdodCBub3cgdGhpcyBzaG91bGQgYmUgYWNjZXB0YWJsZSBhbmQgd2l0aGluIHRoZSByaWdodCByYW5nZVxuU0RQVXRpbHMuZ2VuZXJhdGVTZXNzaW9uSWQgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIE1hdGgucmFuZG9tKCkudG9TdHJpbmcoKS5zdWJzdHIoMiwgMjIpO1xufTtcblxuLy8gV3JpdGUgYm9pbGVyIHBsYXRlIGZvciBzdGFydCBvZiBTRFBcbi8vIHNlc3NJZCBhcmd1bWVudCBpcyBvcHRpb25hbCAtIGlmIG5vdCBzdXBwbGllZCBpdCB3aWxsXG4vLyBiZSBnZW5lcmF0ZWQgcmFuZG9tbHlcbi8vIHNlc3NWZXJzaW9uIGlzIG9wdGlvbmFsIGFuZCBkZWZhdWx0cyB0byAyXG4vLyBzZXNzVXNlciBpcyBvcHRpb25hbCBhbmQgZGVmYXVsdHMgdG8gJ3RoaXNpc2FkYXB0ZXJvcnRjJ1xuU0RQVXRpbHMud3JpdGVTZXNzaW9uQm9pbGVycGxhdGUgPSBmdW5jdGlvbihzZXNzSWQsIHNlc3NWZXIsIHNlc3NVc2VyKSB7XG4gIGxldCBzZXNzaW9uSWQ7XG4gIGNvbnN0IHZlcnNpb24gPSBzZXNzVmVyICE9PSB1bmRlZmluZWQgPyBzZXNzVmVyIDogMjtcbiAgaWYgKHNlc3NJZCkge1xuICAgIHNlc3Npb25JZCA9IHNlc3NJZDtcbiAgfSBlbHNlIHtcbiAgICBzZXNzaW9uSWQgPSBTRFBVdGlscy5nZW5lcmF0ZVNlc3Npb25JZCgpO1xuICB9XG4gIGNvbnN0IHVzZXIgPSBzZXNzVXNlciB8fCAndGhpc2lzYWRhcHRlcm9ydGMnO1xuICAvLyBGSVhNRTogc2Vzcy1pZCBzaG91bGQgYmUgYW4gTlRQIHRpbWVzdGFtcC5cbiAgcmV0dXJuICd2PTBcXHJcXG4nICtcbiAgICAgICdvPScgKyB1c2VyICsgJyAnICsgc2Vzc2lvbklkICsgJyAnICsgdmVyc2lvbiArXG4gICAgICAgICcgSU4gSVA0IDEyNy4wLjAuMVxcclxcbicgK1xuICAgICAgJ3M9LVxcclxcbicgK1xuICAgICAgJ3Q9MCAwXFxyXFxuJztcbn07XG5cbi8vIEdldHMgdGhlIGRpcmVjdGlvbiBmcm9tIHRoZSBtZWRpYVNlY3Rpb24gb3IgdGhlIHNlc3Npb25wYXJ0LlxuU0RQVXRpbHMuZ2V0RGlyZWN0aW9uID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uLCBzZXNzaW9ucGFydCkge1xuICAvLyBMb29rIGZvciBzZW5kcmVjdiwgc2VuZG9ubHksIHJlY3Zvbmx5LCBpbmFjdGl2ZSwgZGVmYXVsdCB0byBzZW5kcmVjdi5cbiAgY29uc3QgbGluZXMgPSBTRFBVdGlscy5zcGxpdExpbmVzKG1lZGlhU2VjdGlvbik7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgbGluZXMubGVuZ3RoOyBpKyspIHtcbiAgICBzd2l0Y2ggKGxpbmVzW2ldKSB7XG4gICAgICBjYXNlICdhPXNlbmRyZWN2JzpcbiAgICAgIGNhc2UgJ2E9c2VuZG9ubHknOlxuICAgICAgY2FzZSAnYT1yZWN2b25seSc6XG4gICAgICBjYXNlICdhPWluYWN0aXZlJzpcbiAgICAgICAgcmV0dXJuIGxpbmVzW2ldLnN1YnN0cmluZygyKTtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIC8vIEZJWE1FOiBXaGF0IHNob3VsZCBoYXBwZW4gaGVyZT9cbiAgICB9XG4gIH1cbiAgaWYgKHNlc3Npb25wYXJ0KSB7XG4gICAgcmV0dXJuIFNEUFV0aWxzLmdldERpcmVjdGlvbihzZXNzaW9ucGFydCk7XG4gIH1cbiAgcmV0dXJuICdzZW5kcmVjdic7XG59O1xuXG5TRFBVdGlscy5nZXRLaW5kID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIGNvbnN0IGxpbmVzID0gU0RQVXRpbHMuc3BsaXRMaW5lcyhtZWRpYVNlY3Rpb24pO1xuICBjb25zdCBtbGluZSA9IGxpbmVzWzBdLnNwbGl0KCcgJyk7XG4gIHJldHVybiBtbGluZVswXS5zdWJzdHJpbmcoMik7XG59O1xuXG5TRFBVdGlscy5pc1JlamVjdGVkID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIHJldHVybiBtZWRpYVNlY3Rpb24uc3BsaXQoJyAnLCAyKVsxXSA9PT0gJzAnO1xufTtcblxuU0RQVXRpbHMucGFyc2VNTGluZSA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbikge1xuICBjb25zdCBsaW5lcyA9IFNEUFV0aWxzLnNwbGl0TGluZXMobWVkaWFTZWN0aW9uKTtcbiAgY29uc3QgcGFydHMgPSBsaW5lc1swXS5zdWJzdHJpbmcoMikuc3BsaXQoJyAnKTtcbiAgcmV0dXJuIHtcbiAgICBraW5kOiBwYXJ0c1swXSxcbiAgICBwb3J0OiBwYXJzZUludChwYXJ0c1sxXSwgMTApLFxuICAgIHByb3RvY29sOiBwYXJ0c1syXSxcbiAgICBmbXQ6IHBhcnRzLnNsaWNlKDMpLmpvaW4oJyAnKSxcbiAgfTtcbn07XG5cblNEUFV0aWxzLnBhcnNlT0xpbmUgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgY29uc3QgbGluZSA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ289JylbMF07XG4gIGNvbnN0IHBhcnRzID0gbGluZS5zdWJzdHJpbmcoMikuc3BsaXQoJyAnKTtcbiAgcmV0dXJuIHtcbiAgICB1c2VybmFtZTogcGFydHNbMF0sXG4gICAgc2Vzc2lvbklkOiBwYXJ0c1sxXSxcbiAgICBzZXNzaW9uVmVyc2lvbjogcGFyc2VJbnQocGFydHNbMl0sIDEwKSxcbiAgICBuZXRUeXBlOiBwYXJ0c1szXSxcbiAgICBhZGRyZXNzVHlwZTogcGFydHNbNF0sXG4gICAgYWRkcmVzczogcGFydHNbNV0sXG4gIH07XG59O1xuXG4vLyBhIHZlcnkgbmFpdmUgaW50ZXJwcmV0YXRpb24gb2YgYSB2YWxpZCBTRFAuXG5TRFBVdGlscy5pc1ZhbGlkU0RQID0gZnVuY3Rpb24oYmxvYikge1xuICBpZiAodHlwZW9mIGJsb2IgIT09ICdzdHJpbmcnIHx8IGJsb2IubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGNvbnN0IGxpbmVzID0gU0RQVXRpbHMuc3BsaXRMaW5lcyhibG9iKTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBsaW5lcy5sZW5ndGg7IGkrKykge1xuICAgIGlmIChsaW5lc1tpXS5sZW5ndGggPCAyIHx8IGxpbmVzW2ldLmNoYXJBdCgxKSAhPT0gJz0nKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIC8vIFRPRE86IGNoZWNrIHRoZSBtb2RpZmllciBhIGJpdCBtb3JlLlxuICB9XG4gIHJldHVybiB0cnVlO1xufTtcblxuLy8gRXhwb3NlIHB1YmxpYyBtZXRob2RzLlxuaWYgKHR5cGVvZiBtb2R1bGUgPT09ICdvYmplY3QnKSB7XG4gIG1vZHVsZS5leHBvcnRzID0gU0RQVXRpbHM7XG59XG4iLCIvLyBUaGUgbW9kdWxlIGNhY2hlXG52YXIgX193ZWJwYWNrX21vZHVsZV9jYWNoZV9fID0ge307XG5cbi8vIFRoZSByZXF1aXJlIGZ1bmN0aW9uXG5mdW5jdGlvbiBfX3dlYnBhY2tfcmVxdWlyZV9fKG1vZHVsZUlkKSB7XG5cdC8vIENoZWNrIGlmIG1vZHVsZSBpcyBpbiBjYWNoZVxuXHR2YXIgY2FjaGVkTW9kdWxlID0gX193ZWJwYWNrX21vZHVsZV9jYWNoZV9fW21vZHVsZUlkXTtcblx0aWYgKGNhY2hlZE1vZHVsZSAhPT0gdW5kZWZpbmVkKSB7XG5cdFx0cmV0dXJuIGNhY2hlZE1vZHVsZS5leHBvcnRzO1xuXHR9XG5cdC8vIENyZWF0ZSBhIG5ldyBtb2R1bGUgKGFuZCBwdXQgaXQgaW50byB0aGUgY2FjaGUpXG5cdHZhciBtb2R1bGUgPSBfX3dlYnBhY2tfbW9kdWxlX2NhY2hlX19bbW9kdWxlSWRdID0ge1xuXHRcdC8vIG5vIG1vZHVsZS5pZCBuZWVkZWRcblx0XHQvLyBubyBtb2R1bGUubG9hZGVkIG5lZWRlZFxuXHRcdGV4cG9ydHM6IHt9XG5cdH07XG5cblx0Ly8gRXhlY3V0ZSB0aGUgbW9kdWxlIGZ1bmN0aW9uXG5cdF9fd2VicGFja19tb2R1bGVzX19bbW9kdWxlSWRdKG1vZHVsZSwgbW9kdWxlLmV4cG9ydHMsIF9fd2VicGFja19yZXF1aXJlX18pO1xuXG5cdC8vIFJldHVybiB0aGUgZXhwb3J0cyBvZiB0aGUgbW9kdWxlXG5cdHJldHVybiBtb2R1bGUuZXhwb3J0cztcbn1cblxuIiwiIiwiLy8gc3RhcnR1cFxuLy8gTG9hZCBlbnRyeSBtb2R1bGUgYW5kIHJldHVybiBleHBvcnRzXG4vLyBUaGlzIGVudHJ5IG1vZHVsZSBpcyByZWZlcmVuY2VkIGJ5IG90aGVyIG1vZHVsZXMgc28gaXQgY2FuJ3QgYmUgaW5saW5lZFxudmFyIF9fd2VicGFja19leHBvcnRzX18gPSBfX3dlYnBhY2tfcmVxdWlyZV9fKFwiLi9zcmMvaW5kZXguanNcIik7XG4iLCIiXSwibmFtZXMiOlsibWoiLCJyZXF1aXJlIiwiSmFudXNTZXNzaW9uIiwicHJvdG90eXBlIiwic2VuZE9yaWdpbmFsIiwic2VuZCIsInR5cGUiLCJzaWduYWwiLCJjYXRjaCIsImUiLCJtZXNzYWdlIiwiaW5kZXhPZiIsImNvbnNvbGUiLCJlcnJvciIsIk5BRiIsImNvbm5lY3Rpb24iLCJhZGFwdGVyIiwicmVjb25uZWN0Iiwic2RwVXRpbHMiLCJkZWJ1ZyIsIndhcm4iLCJpc1NhZmFyaSIsInRlc3QiLCJuYXZpZ2F0b3IiLCJ1c2VyQWdlbnQiLCJTVUJTQ1JJQkVfVElNRU9VVF9NUyIsIkFWQUlMQUJMRV9PQ0NVUEFOVFNfVEhSRVNIT0xEIiwiTUFYX1NVQlNDUklCRV9ERUxBWSIsInJhbmRvbURlbGF5IiwibWluIiwibWF4IiwiUHJvbWlzZSIsInJlc29sdmUiLCJkZWxheSIsIk1hdGgiLCJyYW5kb20iLCJzZXRUaW1lb3V0IiwiZGVib3VuY2UiLCJmbiIsImN1cnIiLCJhcmdzIiwiQXJyYXkiLCJzbGljZSIsImNhbGwiLCJhcmd1bWVudHMiLCJ0aGVuIiwiXyIsImFwcGx5IiwicmFuZG9tVWludCIsImZsb29yIiwiTnVtYmVyIiwiTUFYX1NBRkVfSU5URUdFUiIsInVudGlsRGF0YUNoYW5uZWxPcGVuIiwiZGF0YUNoYW5uZWwiLCJyZWplY3QiLCJyZWFkeVN0YXRlIiwicmVzb2x2ZXIiLCJyZWplY3RvciIsImNsZWFyIiwicmVtb3ZlRXZlbnRMaXN0ZW5lciIsImFkZEV2ZW50TGlzdGVuZXIiLCJpc0gyNjRWaWRlb1N1cHBvcnRlZCIsInZpZGVvIiwiZG9jdW1lbnQiLCJjcmVhdGVFbGVtZW50IiwiY2FuUGxheVR5cGUiLCJPUFVTX1BBUkFNRVRFUlMiLCJ1c2VkdHgiLCJzdGVyZW8iLCJERUZBVUxUX1BFRVJfQ09OTkVDVElPTl9DT05GSUciLCJpY2VTZXJ2ZXJzIiwidXJscyIsIldTX05PUk1BTF9DTE9TVVJFIiwiSmFudXNBZGFwdGVyIiwiY29uc3RydWN0b3IiLCJyb29tIiwiY2xpZW50SWQiLCJqb2luVG9rZW4iLCJzZXJ2ZXJVcmwiLCJ3ZWJSdGNPcHRpb25zIiwicGVlckNvbm5lY3Rpb25Db25maWciLCJ3cyIsInNlc3Npb24iLCJyZWxpYWJsZVRyYW5zcG9ydCIsInVucmVsaWFibGVUcmFuc3BvcnQiLCJpbml0aWFsUmVjb25uZWN0aW9uRGVsYXkiLCJyZWNvbm5lY3Rpb25EZWxheSIsInJlY29ubmVjdGlvblRpbWVvdXQiLCJtYXhSZWNvbm5lY3Rpb25BdHRlbXB0cyIsInJlY29ubmVjdGlvbkF0dGVtcHRzIiwicHVibGlzaGVyIiwib2NjdXBhbnRJZHMiLCJvY2N1cGFudHMiLCJtZWRpYVN0cmVhbXMiLCJsb2NhbE1lZGlhU3RyZWFtIiwicGVuZGluZ01lZGlhUmVxdWVzdHMiLCJNYXAiLCJwZW5kaW5nT2NjdXBhbnRzIiwiU2V0IiwiYXZhaWxhYmxlT2NjdXBhbnRzIiwicmVxdWVzdGVkT2NjdXBhbnRzIiwiYmxvY2tlZENsaWVudHMiLCJmcm96ZW5VcGRhdGVzIiwidGltZU9mZnNldHMiLCJzZXJ2ZXJUaW1lUmVxdWVzdHMiLCJhdmdUaW1lT2Zmc2V0Iiwib25XZWJzb2NrZXRPcGVuIiwiYmluZCIsIm9uV2Vic29ja2V0Q2xvc2UiLCJvbldlYnNvY2tldE1lc3NhZ2UiLCJvbkRhdGFDaGFubmVsTWVzc2FnZSIsIm9uRGF0YSIsInNldFNlcnZlclVybCIsInVybCIsInNldEFwcCIsImFwcCIsInNldFJvb20iLCJyb29tTmFtZSIsInNldEpvaW5Ub2tlbiIsInNldENsaWVudElkIiwic2V0V2ViUnRjT3B0aW9ucyIsIm9wdGlvbnMiLCJzZXRQZWVyQ29ubmVjdGlvbkNvbmZpZyIsInNldFNlcnZlckNvbm5lY3RMaXN0ZW5lcnMiLCJzdWNjZXNzTGlzdGVuZXIiLCJmYWlsdXJlTGlzdGVuZXIiLCJjb25uZWN0U3VjY2VzcyIsImNvbm5lY3RGYWlsdXJlIiwic2V0Um9vbU9jY3VwYW50TGlzdGVuZXIiLCJvY2N1cGFudExpc3RlbmVyIiwib25PY2N1cGFudHNDaGFuZ2VkIiwic2V0RGF0YUNoYW5uZWxMaXN0ZW5lcnMiLCJvcGVuTGlzdGVuZXIiLCJjbG9zZWRMaXN0ZW5lciIsIm1lc3NhZ2VMaXN0ZW5lciIsIm9uT2NjdXBhbnRDb25uZWN0ZWQiLCJvbk9jY3VwYW50RGlzY29ubmVjdGVkIiwib25PY2N1cGFudE1lc3NhZ2UiLCJzZXRSZWNvbm5lY3Rpb25MaXN0ZW5lcnMiLCJyZWNvbm5lY3RpbmdMaXN0ZW5lciIsInJlY29ubmVjdGVkTGlzdGVuZXIiLCJyZWNvbm5lY3Rpb25FcnJvckxpc3RlbmVyIiwib25SZWNvbm5lY3RpbmciLCJvblJlY29ubmVjdGVkIiwib25SZWNvbm5lY3Rpb25FcnJvciIsInNldEV2ZW50TG9vcHMiLCJsb29wcyIsImNvbm5lY3QiLCJ3ZWJzb2NrZXRDb25uZWN0aW9uIiwiV2ViU29ja2V0IiwidGltZW91dE1zIiwid3NPbk9wZW4iLCJhbGwiLCJ1cGRhdGVUaW1lT2Zmc2V0IiwiZGlzY29ubmVjdCIsImNsZWFyVGltZW91dCIsInJlbW92ZUFsbE9jY3VwYW50cyIsImNvbm4iLCJjbG9zZSIsImRpc3Bvc2UiLCJkZWxheWVkUmVjb25uZWN0VGltZW91dCIsImlzRGlzY29ubmVjdGVkIiwiY3JlYXRlIiwiY3JlYXRlUHVibGlzaGVyIiwiaSIsImluaXRpYWxPY2N1cGFudHMiLCJsZW5ndGgiLCJvY2N1cGFudElkIiwiYWRkQXZhaWxhYmxlT2NjdXBhbnQiLCJzeW5jT2NjdXBhbnRzIiwiZXZlbnQiLCJjb2RlIiwiRXJyb3IiLCJwZXJmb3JtRGVsYXllZFJlY29ubmVjdCIsInJlY2VpdmUiLCJKU09OIiwicGFyc2UiLCJkYXRhIiwicHVzaCIsInJlbW92ZUF2YWlsYWJsZU9jY3VwYW50IiwiaWR4Iiwic3BsaWNlIiwiaGFzIiwiYWRkT2NjdXBhbnQiLCJqIiwicmVtb3ZlT2NjdXBhbnQiLCJhZGQiLCJhdmFpbGFibGVPY2N1cGFudHNDb3VudCIsInN1YnNjcmliZXIiLCJjcmVhdGVTdWJzY3JpYmVyIiwiZGVsZXRlIiwic2V0TWVkaWFTdHJlYW0iLCJtZWRpYVN0cmVhbSIsIm1zZyIsImdldCIsImF1ZGlvIiwiYXNzb2NpYXRlIiwiaGFuZGxlIiwiZXYiLCJzZW5kVHJpY2tsZSIsImNhbmRpZGF0ZSIsImljZUNvbm5lY3Rpb25TdGF0ZSIsImxvZyIsIm9mZmVyIiwiY3JlYXRlT2ZmZXIiLCJjb25maWd1cmVQdWJsaXNoZXJTZHAiLCJmaXhTYWZhcmlJY2VVRnJhZyIsImxvY2FsIiwibyIsInNldExvY2FsRGVzY3JpcHRpb24iLCJyZW1vdGUiLCJzZW5kSnNlcCIsInIiLCJzZXRSZW1vdGVEZXNjcmlwdGlvbiIsImpzZXAiLCJvbiIsImFuc3dlciIsImNvbmZpZ3VyZVN1YnNjcmliZXJTZHAiLCJjcmVhdGVBbnN3ZXIiLCJhIiwiSmFudXNQbHVnaW5IYW5kbGUiLCJSVENQZWVyQ29ubmVjdGlvbiIsImF0dGFjaCIsInBhcnNlSW50IiwidW5kZWZpbmVkIiwid2VicnRjdXAiLCJyZWxpYWJsZUNoYW5uZWwiLCJjcmVhdGVEYXRhQ2hhbm5lbCIsIm9yZGVyZWQiLCJ1bnJlbGlhYmxlQ2hhbm5lbCIsIm1heFJldHJhbnNtaXRzIiwiZ2V0VHJhY2tzIiwiZm9yRWFjaCIsInRyYWNrIiwiYWRkVHJhY2siLCJwbHVnaW5kYXRhIiwicm9vbV9pZCIsInVzZXJfaWQiLCJib2R5IiwiZGlzcGF0Y2hFdmVudCIsIkN1c3RvbUV2ZW50IiwiZGV0YWlsIiwiYnkiLCJzZW5kSm9pbiIsIm5vdGlmaWNhdGlvbnMiLCJzdWNjZXNzIiwiZXJyIiwicmVzcG9uc2UiLCJ1c2VycyIsImluY2x1ZGVzIiwic2RwIiwicmVwbGFjZSIsImxpbmUiLCJwdCIsInBhcmFtZXRlcnMiLCJPYmplY3QiLCJhc3NpZ24iLCJwYXJzZUZtdHAiLCJ3cml0ZUZtdHAiLCJwYXlsb2FkVHlwZSIsIm1heFJldHJpZXMiLCJ3ZWJydGNGYWlsZWQiLCJsZWZ0SW50ZXJ2YWwiLCJzZXRJbnRlcnZhbCIsImNsZWFySW50ZXJ2YWwiLCJ0aW1lb3V0IiwibWVkaWEiLCJfaU9TSGFja0RlbGF5ZWRJbml0aWFsUGVlciIsIk1lZGlhU3RyZWFtIiwicmVjZWl2ZXJzIiwiZ2V0UmVjZWl2ZXJzIiwicmVjZWl2ZXIiLCJzdWJzY3JpYmUiLCJzZW5kTWVzc2FnZSIsImtpbmQiLCJ0b2tlbiIsInRvZ2dsZUZyZWV6ZSIsImZyb3plbiIsInVuZnJlZXplIiwiZnJlZXplIiwiZmx1c2hQZW5kaW5nVXBkYXRlcyIsImRhdGFGb3JVcGRhdGVNdWx0aU1lc3NhZ2UiLCJuZXR3b3JrSWQiLCJsIiwiZCIsImdldFBlbmRpbmdEYXRhIiwiZGF0YVR5cGUiLCJvd25lciIsImdldFBlbmRpbmdEYXRhRm9yTmV0d29ya0lkIiwic291cmNlIiwic3RvcmVNZXNzYWdlIiwic3RvcmVTaW5nbGVNZXNzYWdlIiwiaW5kZXgiLCJzZXQiLCJzdG9yZWRNZXNzYWdlIiwic3RvcmVkRGF0YSIsImlzT3V0ZGF0ZWRNZXNzYWdlIiwibGFzdE93bmVyVGltZSIsImlzQ29udGVtcG9yYW5lb3VzTWVzc2FnZSIsImNyZWF0ZWRXaGlsZUZyb3plbiIsImlzRmlyc3RTeW5jIiwiY29tcG9uZW50cyIsImVuYWJsZWQiLCJzaG91bGRTdGFydENvbm5lY3Rpb25UbyIsImNsaWVudCIsInN0YXJ0U3RyZWFtQ29ubmVjdGlvbiIsImNsb3NlU3RyZWFtQ29ubmVjdGlvbiIsImdldENvbm5lY3RTdGF0dXMiLCJhZGFwdGVycyIsIklTX0NPTk5FQ1RFRCIsIk5PVF9DT05ORUNURUQiLCJjbGllbnRTZW50VGltZSIsIkRhdGUiLCJub3ciLCJyZXMiLCJmZXRjaCIsImxvY2F0aW9uIiwiaHJlZiIsIm1ldGhvZCIsImNhY2hlIiwicHJlY2lzaW9uIiwic2VydmVyUmVjZWl2ZWRUaW1lIiwiaGVhZGVycyIsImdldFRpbWUiLCJjbGllbnRSZWNlaXZlZFRpbWUiLCJzZXJ2ZXJUaW1lIiwidGltZU9mZnNldCIsInJlZHVjZSIsImFjYyIsIm9mZnNldCIsImdldFNlcnZlclRpbWUiLCJnZXRNZWRpYVN0cmVhbSIsImF1ZGlvUHJvbWlzZSIsInZpZGVvUHJvbWlzZSIsInByb21pc2UiLCJzdHJlYW0iLCJhdWRpb1N0cmVhbSIsImdldEF1ZGlvVHJhY2tzIiwidmlkZW9TdHJlYW0iLCJnZXRWaWRlb1RyYWNrcyIsInNldExvY2FsTWVkaWFTdHJlYW0iLCJleGlzdGluZ1NlbmRlcnMiLCJnZXRTZW5kZXJzIiwibmV3U2VuZGVycyIsInRyYWNrcyIsInQiLCJzZW5kZXIiLCJmaW5kIiwicyIsInJlcGxhY2VUcmFjayIsInRvTG93ZXJDYXNlIiwicmVtb3ZlVHJhY2siLCJlbmFibGVNaWNyb3Bob25lIiwic2VuZERhdGEiLCJzdHJpbmdpZnkiLCJ3aG9tIiwic2VuZERhdGFHdWFyYW50ZWVkIiwiYnJvYWRjYXN0RGF0YSIsImJyb2FkY2FzdERhdGFHdWFyYW50ZWVkIiwia2ljayIsInBlcm1zVG9rZW4iLCJibG9jayIsInVuYmxvY2siLCJyZWdpc3RlciIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlUm9vdCI6IiJ9