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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,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O0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEVBQUU7O0FBRUY7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsV0FBVyw0Q0FBNEM7O0FBRXZEO0FBQ0E7QUFDQTtBQUNBLFdBQVcsUUFBUTtBQUNuQjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxJQUFJO0FBQ0o7QUFDQTtBQUNBLEdBQUc7QUFDSDtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQSxZQUFZLFFBQVE7QUFDcEI7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsR0FBRztBQUNIO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsWUFBWTtBQUNaO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEdBQUc7QUFDSDtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxpQkFBaUIsbUJBQU8sQ0FBQyxvREFBVTs7QUFFbkMsT0FBTyxZQUFZOztBQUVuQjtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0EsR0FBRztBQUNIO0FBQ0E7QUFDQTs7Ozs7Ozs7Ozs7O0FDM1FBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0Esd0JBQXdCLG1CQUFPLENBQUMsc0NBQUk7QUFDcEM7O0FBRUE7QUFDQTtBQUNBLEVBQUU7O0FBRUY7QUFDQTtBQUNBOztBQUVBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQSxXQUFXLFFBQVE7QUFDbkIsWUFBWSxlQUFlO0FBQzNCO0FBQ0E7QUFDQTtBQUNBOztBQUVBLGtCQUFrQixzQkFBc0I7QUFDeEM7QUFDQSxjQUFjO0FBQ2Q7O0FBRUE7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBLFdBQVcsUUFBUTtBQUNuQixZQUFZO0FBQ1o7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLElBQUk7O0FBRUo7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQSx1Q0FBdUM7O0FBRXZDO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQSxJQUFJO0FBQ0o7QUFDQTtBQUNBO0FBQ0EsR0FBRzs7QUFFSDtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQSxXQUFXLFFBQVE7QUFDbkI7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTs7QUFFQSxjQUFjLFNBQVM7QUFDdkI7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7O0FBRUE7QUFDQTtBQUNBLEtBQUs7QUFDTDtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQSxZQUFZLFFBQVE7QUFDcEI7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0EsV0FBVyxRQUFRO0FBQ25CLFlBQVk7QUFDWjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTs7QUFFQSw4Q0FBOEMsU0FBUztBQUN2RDtBQUNBO0FBQ0E7QUFDQTs7QUFFQSw4Q0FBOEMsU0FBUztBQUN2RDtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBLFdBQVcsUUFBUTtBQUNuQixZQUFZLFFBQVE7QUFDcEI7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0EsV0FBVyxPQUFPO0FBQ2xCLFlBQVk7QUFDWjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBOztBQUVBO0FBQ0E7O0FBRUE7Ozs7Ozs7Ozs7O0FDalJBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxXQUFXLGVBQWU7QUFDMUIsV0FBVyxRQUFRO0FBQ25CLFlBQVksT0FBTztBQUNuQixZQUFZO0FBQ1o7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsSUFBSTtBQUNKO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBLFdBQVcsUUFBUTtBQUNuQixZQUFZO0FBQ1o7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBLFdBQVcsUUFBUTtBQUNuQixZQUFZO0FBQ1o7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQSxXQUFXLFFBQVE7QUFDbkIsWUFBWTtBQUNaO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBOzs7Ozs7Ozs7Ozs7QUNqS0E7QUFDYTs7QUFFYjtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxJQUFJO0FBQ0o7QUFDQTs7QUFFQTtBQUNBO0FBQ0EsZ0JBQWdCLG9CQUFvQjtBQUNwQztBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLGtCQUFrQixrQkFBa0I7QUFDcEM7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLHdDQUF3QztBQUN4QztBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0EsSUFBSTtBQUNKO0FBQ0EsSUFBSTtBQUNKO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTs7QUFFQTtBQUNBLDZDQUE2QztBQUM3QztBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQSxvQkFBb0I7QUFDcEIsMkJBQTJCO0FBQzNCO0FBQ0E7QUFDQTtBQUNBLDhEQUE4RDtBQUM5RCxrQkFBa0Isa0JBQWtCO0FBQ3BDO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsUUFBUTtBQUNSO0FBQ0E7QUFDQSxLQUFLO0FBQ0wsaURBQWlEO0FBQ2pEO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxLQUFLO0FBQ0w7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxJQUFJO0FBQ0o7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEdBQUc7QUFDSDtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLGtCQUFrQixrQkFBa0IsT0FBTztBQUMzQztBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsR0FBRztBQUNIO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsT0FBTztBQUNQO0FBQ0E7QUFDQTtBQUNBLEtBQUs7QUFDTCxHQUFHO0FBQ0g7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQSw2Q0FBNkM7QUFDN0M7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsR0FBRzs7QUFFSDtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxHQUFHO0FBQ0g7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEdBQUc7QUFDSDtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0EsS0FBSztBQUNMO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEtBQUs7QUFDTDtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSx3QkFBd0I7QUFDeEI7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEdBQUc7QUFDSDtBQUNBO0FBQ0E7QUFDQSxLQUFLO0FBQ0w7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLE1BQU07QUFDTjtBQUNBO0FBQ0E7QUFDQSxNQUFNO0FBQ047QUFDQTtBQUNBO0FBQ0E7QUFDQSxLQUFLO0FBQ0w7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQUdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsWUFBWTtBQUNaO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLFlBQVk7QUFDWjtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLElBQUk7QUFDSjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsSUFBSTtBQUNKO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0Esa0JBQWtCLGtCQUFrQjtBQUNwQztBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLGtCQUFrQixrQkFBa0I7QUFDcEM7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQSxJQUFJLElBQTBCO0FBQzlCO0FBQ0E7Ozs7Ozs7VUNqeUJBO1VBQ0E7O1VBRUE7VUFDQTtVQUNBO1VBQ0E7VUFDQTtVQUNBO1VBQ0E7VUFDQTtVQUNBO1VBQ0E7VUFDQTtVQUNBO1VBQ0E7O1VBRUE7VUFDQTs7VUFFQTtVQUNBO1VBQ0E7Ozs7VUV0QkE7VUFDQTtVQUNBO1VBQ0EiLCJzb3VyY2VzIjpbIndlYnBhY2s6Ly9AbmV0d29ya2VkLWFmcmFtZS9uYWYtamFudXMtYWRhcHRlci8uL25vZGVfbW9kdWxlcy9AbmV0d29ya2VkLWFmcmFtZS9taW5pamFudXMvbWluaWphbnVzLmpzIiwid2VicGFjazovL0BuZXR3b3JrZWQtYWZyYW1lL25hZi1qYW51cy1hZGFwdGVyLy4vc3JjL2luZGV4LmpzIiwid2VicGFjazovL0BuZXR3b3JrZWQtYWZyYW1lL25hZi1qYW51cy1hZGFwdGVyLy4vbm9kZV9tb2R1bGVzL2RlYnVnL3NyYy9icm93c2VyLmpzIiwid2VicGFjazovL0BuZXR3b3JrZWQtYWZyYW1lL25hZi1qYW51cy1hZGFwdGVyLy4vbm9kZV9tb2R1bGVzL2RlYnVnL3NyYy9jb21tb24uanMiLCJ3ZWJwYWNrOi8vQG5ldHdvcmtlZC1hZnJhbWUvbmFmLWphbnVzLWFkYXB0ZXIvLi9ub2RlX21vZHVsZXMvbXMvaW5kZXguanMiLCJ3ZWJwYWNrOi8vQG5ldHdvcmtlZC1hZnJhbWUvbmFmLWphbnVzLWFkYXB0ZXIvLi9ub2RlX21vZHVsZXMvc2RwL3NkcC5qcyIsIndlYnBhY2s6Ly9AbmV0d29ya2VkLWFmcmFtZS9uYWYtamFudXMtYWRhcHRlci93ZWJwYWNrL2Jvb3RzdHJhcCIsIndlYnBhY2s6Ly9AbmV0d29ya2VkLWFmcmFtZS9uYWYtamFudXMtYWRhcHRlci93ZWJwYWNrL2JlZm9yZS1zdGFydHVwIiwid2VicGFjazovL0BuZXR3b3JrZWQtYWZyYW1lL25hZi1qYW51cy1hZGFwdGVyL3dlYnBhY2svc3RhcnR1cCIsIndlYnBhY2s6Ly9AbmV0d29ya2VkLWFmcmFtZS9uYWYtamFudXMtYWRhcHRlci93ZWJwYWNrL2FmdGVyLXN0YXJ0dXAiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBSZXByZXNlbnRzIGEgaGFuZGxlIHRvIGEgc2luZ2xlIEphbnVzIHBsdWdpbiBvbiBhIEphbnVzIHNlc3Npb24uIEVhY2ggV2ViUlRDIGNvbm5lY3Rpb24gdG8gdGhlIEphbnVzIHNlcnZlciB3aWxsIGJlXG4gKiBhc3NvY2lhdGVkIHdpdGggYSBzaW5nbGUgaGFuZGxlLiBPbmNlIGF0dGFjaGVkIHRvIHRoZSBzZXJ2ZXIsIHRoaXMgaGFuZGxlIHdpbGwgYmUgZ2l2ZW4gYSB1bmlxdWUgSUQgd2hpY2ggc2hvdWxkIGJlXG4gKiB1c2VkIHRvIGFzc29jaWF0ZSBpdCB3aXRoIGZ1dHVyZSBzaWduYWxsaW5nIG1lc3NhZ2VzLlxuICpcbiAqIFNlZSBodHRwczovL2phbnVzLmNvbmYubWVldGVjaG8uY29tL2RvY3MvcmVzdC5odG1sI2hhbmRsZXMuXG4gKiovXG5mdW5jdGlvbiBKYW51c1BsdWdpbkhhbmRsZShzZXNzaW9uKSB7XG4gIHRoaXMuc2Vzc2lvbiA9IHNlc3Npb247XG4gIHRoaXMuaWQgPSB1bmRlZmluZWQ7XG59XG5cbi8qKiBBdHRhY2hlcyB0aGlzIGhhbmRsZSB0byB0aGUgSmFudXMgc2VydmVyIGFuZCBzZXRzIGl0cyBJRC4gKiovXG5KYW51c1BsdWdpbkhhbmRsZS5wcm90b3R5cGUuYXR0YWNoID0gZnVuY3Rpb24ocGx1Z2luLCBsb29wX2luZGV4KSB7XG4gIHZhciBwYXlsb2FkID0geyBwbHVnaW46IHBsdWdpbiwgbG9vcF9pbmRleDogbG9vcF9pbmRleCwgXCJmb3JjZS1idW5kbGVcIjogdHJ1ZSwgXCJmb3JjZS1ydGNwLW11eFwiOiB0cnVlIH07XG4gIHJldHVybiB0aGlzLnNlc3Npb24uc2VuZChcImF0dGFjaFwiLCBwYXlsb2FkKS50aGVuKHJlc3AgPT4ge1xuICAgIHRoaXMuaWQgPSByZXNwLmRhdGEuaWQ7XG4gICAgcmV0dXJuIHJlc3A7XG4gIH0pO1xufTtcblxuLyoqIERldGFjaGVzIHRoaXMgaGFuZGxlLiAqKi9cbkphbnVzUGx1Z2luSGFuZGxlLnByb3RvdHlwZS5kZXRhY2ggPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuc2VuZChcImRldGFjaFwiKTtcbn07XG5cbi8qKiBSZWdpc3RlcnMgYSBjYWxsYmFjayB0byBiZSBmaXJlZCB1cG9uIHRoZSByZWNlcHRpb24gb2YgYW55IGluY29taW5nIEphbnVzIHNpZ25hbHMgZm9yIHRoaXMgcGx1Z2luIGhhbmRsZSB3aXRoIHRoZVxuICogYGphbnVzYCBhdHRyaWJ1dGUgZXF1YWwgdG8gYGV2YC5cbiAqKi9cbkphbnVzUGx1Z2luSGFuZGxlLnByb3RvdHlwZS5vbiA9IGZ1bmN0aW9uKGV2LCBjYWxsYmFjaykge1xuICByZXR1cm4gdGhpcy5zZXNzaW9uLm9uKGV2LCBzaWduYWwgPT4ge1xuICAgIGlmIChzaWduYWwuc2VuZGVyID09IHRoaXMuaWQpIHtcbiAgICAgIGNhbGxiYWNrKHNpZ25hbCk7XG4gICAgfVxuICB9KTtcbn07XG5cbi8qKlxuICogU2VuZHMgYSBzaWduYWwgYXNzb2NpYXRlZCB3aXRoIHRoaXMgaGFuZGxlLiBTaWduYWxzIHNob3VsZCBiZSBKU09OLXNlcmlhbGl6YWJsZSBvYmplY3RzLiBSZXR1cm5zIGEgcHJvbWlzZSB0aGF0IHdpbGxcbiAqIGJlIHJlc29sdmVkIG9yIHJlamVjdGVkIHdoZW4gYSByZXNwb25zZSB0byB0aGlzIHNpZ25hbCBpcyByZWNlaXZlZCwgb3Igd2hlbiBubyByZXNwb25zZSBpcyByZWNlaXZlZCB3aXRoaW4gdGhlXG4gKiBzZXNzaW9uIHRpbWVvdXQuXG4gKiovXG5KYW51c1BsdWdpbkhhbmRsZS5wcm90b3R5cGUuc2VuZCA9IGZ1bmN0aW9uKHR5cGUsIHNpZ25hbCkge1xuICByZXR1cm4gdGhpcy5zZXNzaW9uLnNlbmQodHlwZSwgT2JqZWN0LmFzc2lnbih7IGhhbmRsZV9pZDogdGhpcy5pZCB9LCBzaWduYWwpKTtcbn07XG5cbi8qKiBTZW5kcyBhIHBsdWdpbi1zcGVjaWZpYyBtZXNzYWdlIGFzc29jaWF0ZWQgd2l0aCB0aGlzIGhhbmRsZS4gKiovXG5KYW51c1BsdWdpbkhhbmRsZS5wcm90b3R5cGUuc2VuZE1lc3NhZ2UgPSBmdW5jdGlvbihib2R5KSB7XG4gIHJldHVybiB0aGlzLnNlbmQoXCJtZXNzYWdlXCIsIHsgYm9keTogYm9keSB9KTtcbn07XG5cbi8qKiBTZW5kcyBhIEpTRVAgb2ZmZXIgb3IgYW5zd2VyIGFzc29jaWF0ZWQgd2l0aCB0aGlzIGhhbmRsZS4gKiovXG5KYW51c1BsdWdpbkhhbmRsZS5wcm90b3R5cGUuc2VuZEpzZXAgPSBmdW5jdGlvbihqc2VwKSB7XG4gIHJldHVybiB0aGlzLnNlbmQoXCJtZXNzYWdlXCIsIHsgYm9keToge30sIGpzZXA6IGpzZXAgfSk7XG59O1xuXG4vKiogU2VuZHMgYW4gSUNFIHRyaWNrbGUgY2FuZGlkYXRlIGFzc29jaWF0ZWQgd2l0aCB0aGlzIGhhbmRsZS4gKiovXG5KYW51c1BsdWdpbkhhbmRsZS5wcm90b3R5cGUuc2VuZFRyaWNrbGUgPSBmdW5jdGlvbihjYW5kaWRhdGUpIHtcbiAgcmV0dXJuIHRoaXMuc2VuZChcInRyaWNrbGVcIiwgeyBjYW5kaWRhdGU6IGNhbmRpZGF0ZSB9KTtcbn07XG5cbi8qKlxuICogUmVwcmVzZW50cyBhIEphbnVzIHNlc3Npb24gLS0gYSBKYW51cyBjb250ZXh0IGZyb20gd2l0aGluIHdoaWNoIHlvdSBjYW4gb3BlbiBtdWx0aXBsZSBoYW5kbGVzIGFuZCBjb25uZWN0aW9ucy4gT25jZVxuICogY3JlYXRlZCwgdGhpcyBzZXNzaW9uIHdpbGwgYmUgZ2l2ZW4gYSB1bmlxdWUgSUQgd2hpY2ggc2hvdWxkIGJlIHVzZWQgdG8gYXNzb2NpYXRlIGl0IHdpdGggZnV0dXJlIHNpZ25hbGxpbmcgbWVzc2FnZXMuXG4gKlxuICogU2VlIGh0dHBzOi8vamFudXMuY29uZi5tZWV0ZWNoby5jb20vZG9jcy9yZXN0Lmh0bWwjc2Vzc2lvbnMuXG4gKiovXG5mdW5jdGlvbiBKYW51c1Nlc3Npb24ob3V0cHV0LCBvcHRpb25zKSB7XG4gIHRoaXMub3V0cHV0ID0gb3V0cHV0O1xuICB0aGlzLmlkID0gdW5kZWZpbmVkO1xuICB0aGlzLm5leHRUeElkID0gMDtcbiAgdGhpcy50eG5zID0ge307XG4gIHRoaXMuZXZlbnRIYW5kbGVycyA9IHt9O1xuICB0aGlzLm9wdGlvbnMgPSBPYmplY3QuYXNzaWduKHtcbiAgICB2ZXJib3NlOiBmYWxzZSxcbiAgICB0aW1lb3V0TXM6IDEwMDAwLFxuICAgIGtlZXBhbGl2ZU1zOiAzMDAwMFxuICB9LCBvcHRpb25zKTtcbn1cblxuLyoqIENyZWF0ZXMgdGhpcyBzZXNzaW9uIG9uIHRoZSBKYW51cyBzZXJ2ZXIgYW5kIHNldHMgaXRzIElELiAqKi9cbkphbnVzU2Vzc2lvbi5wcm90b3R5cGUuY3JlYXRlID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLnNlbmQoXCJjcmVhdGVcIikudGhlbihyZXNwID0+IHtcbiAgICB0aGlzLmlkID0gcmVzcC5kYXRhLmlkO1xuICAgIHJldHVybiByZXNwO1xuICB9KTtcbn07XG5cbi8qKlxuICogRGVzdHJveXMgdGhpcyBzZXNzaW9uLiBOb3RlIHRoYXQgdXBvbiBkZXN0cnVjdGlvbiwgSmFudXMgd2lsbCBhbHNvIGNsb3NlIHRoZSBzaWduYWxsaW5nIHRyYW5zcG9ydCAoaWYgYXBwbGljYWJsZSkgYW5kXG4gKiBhbnkgb3BlbiBXZWJSVEMgY29ubmVjdGlvbnMuXG4gKiovXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLmRlc3Ryb3kgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuc2VuZChcImRlc3Ryb3lcIikudGhlbigocmVzcCkgPT4ge1xuICAgIHRoaXMuZGlzcG9zZSgpO1xuICAgIHJldHVybiByZXNwO1xuICB9KTtcbn07XG5cbi8qKlxuICogRGlzcG9zZXMgb2YgdGhpcyBzZXNzaW9uIGluIGEgd2F5IHN1Y2ggdGhhdCBubyBmdXJ0aGVyIGluY29taW5nIHNpZ25hbGxpbmcgbWVzc2FnZXMgd2lsbCBiZSBwcm9jZXNzZWQuXG4gKiBPdXRzdGFuZGluZyB0cmFuc2FjdGlvbnMgd2lsbCBiZSByZWplY3RlZC5cbiAqKi9cbkphbnVzU2Vzc2lvbi5wcm90b3R5cGUuZGlzcG9zZSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLl9raWxsS2VlcGFsaXZlKCk7XG4gIHRoaXMuZXZlbnRIYW5kbGVycyA9IHt9O1xuICBmb3IgKHZhciB0eElkIGluIHRoaXMudHhucykge1xuICAgIGlmICh0aGlzLnR4bnMuaGFzT3duUHJvcGVydHkodHhJZCkpIHtcbiAgICAgIHZhciB0eG4gPSB0aGlzLnR4bnNbdHhJZF07XG4gICAgICBjbGVhclRpbWVvdXQodHhuLnRpbWVvdXQpO1xuICAgICAgdHhuLnJlamVjdChuZXcgRXJyb3IoXCJKYW51cyBzZXNzaW9uIHdhcyBkaXNwb3NlZC5cIikpO1xuICAgICAgZGVsZXRlIHRoaXMudHhuc1t0eElkXTtcbiAgICB9XG4gIH1cbn07XG5cbi8qKlxuICogV2hldGhlciB0aGlzIHNpZ25hbCByZXByZXNlbnRzIGFuIGVycm9yLCBhbmQgdGhlIGFzc29jaWF0ZWQgcHJvbWlzZSAoaWYgYW55KSBzaG91bGQgYmUgcmVqZWN0ZWQuXG4gKiBVc2VycyBzaG91bGQgb3ZlcnJpZGUgdGhpcyB0byBoYW5kbGUgYW55IGN1c3RvbSBwbHVnaW4tc3BlY2lmaWMgZXJyb3IgY29udmVudGlvbnMuXG4gKiovXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLmlzRXJyb3IgPSBmdW5jdGlvbihzaWduYWwpIHtcbiAgcmV0dXJuIHNpZ25hbC5qYW51cyA9PT0gXCJlcnJvclwiO1xufTtcblxuLyoqIFJlZ2lzdGVycyBhIGNhbGxiYWNrIHRvIGJlIGZpcmVkIHVwb24gdGhlIHJlY2VwdGlvbiBvZiBhbnkgaW5jb21pbmcgSmFudXMgc2lnbmFscyBmb3IgdGhpcyBzZXNzaW9uIHdpdGggdGhlXG4gKiBgamFudXNgIGF0dHJpYnV0ZSBlcXVhbCB0byBgZXZgLlxuICoqL1xuSmFudXNTZXNzaW9uLnByb3RvdHlwZS5vbiA9IGZ1bmN0aW9uKGV2LCBjYWxsYmFjaykge1xuICB2YXIgaGFuZGxlcnMgPSB0aGlzLmV2ZW50SGFuZGxlcnNbZXZdO1xuICBpZiAoaGFuZGxlcnMgPT0gbnVsbCkge1xuICAgIGhhbmRsZXJzID0gdGhpcy5ldmVudEhhbmRsZXJzW2V2XSA9IFtdO1xuICB9XG4gIGhhbmRsZXJzLnB1c2goY2FsbGJhY2spO1xufTtcblxuLyoqXG4gKiBDYWxsYmFjayBmb3IgcmVjZWl2aW5nIEpTT04gc2lnbmFsbGluZyBtZXNzYWdlcyBwZXJ0aW5lbnQgdG8gdGhpcyBzZXNzaW9uLiBJZiB0aGUgc2lnbmFscyBhcmUgcmVzcG9uc2VzIHRvIHByZXZpb3VzbHlcbiAqIHNlbnQgc2lnbmFscywgdGhlIHByb21pc2VzIGZvciB0aGUgb3V0Z29pbmcgc2lnbmFscyB3aWxsIGJlIHJlc29sdmVkIG9yIHJlamVjdGVkIGFwcHJvcHJpYXRlbHkgd2l0aCB0aGlzIHNpZ25hbCBhcyBhblxuICogYXJndW1lbnQuXG4gKlxuICogRXh0ZXJuYWwgY2FsbGVycyBzaG91bGQgY2FsbCB0aGlzIGZ1bmN0aW9uIGV2ZXJ5IHRpbWUgYSBuZXcgc2lnbmFsIGFycml2ZXMgb24gdGhlIHRyYW5zcG9ydDsgZm9yIGV4YW1wbGUsIGluIGFcbiAqIFdlYlNvY2tldCdzIGBtZXNzYWdlYCBldmVudCwgb3Igd2hlbiBhIG5ldyBkYXR1bSBzaG93cyB1cCBpbiBhbiBIVFRQIGxvbmctcG9sbGluZyByZXNwb25zZS5cbiAqKi9cbkphbnVzU2Vzc2lvbi5wcm90b3R5cGUucmVjZWl2ZSA9IGZ1bmN0aW9uKHNpZ25hbCkge1xuICBpZiAodGhpcy5vcHRpb25zLnZlcmJvc2UpIHtcbiAgICB0aGlzLl9sb2dJbmNvbWluZyhzaWduYWwpO1xuICB9XG4gIGlmIChzaWduYWwuc2Vzc2lvbl9pZCAhPSB0aGlzLmlkKSB7XG4gICAgY29uc29sZS53YXJuKFwiSW5jb3JyZWN0IHNlc3Npb24gSUQgcmVjZWl2ZWQgaW4gSmFudXMgc2lnbmFsbGluZyBtZXNzYWdlOiB3YXMgXCIgKyBzaWduYWwuc2Vzc2lvbl9pZCArIFwiLCBleHBlY3RlZCBcIiArIHRoaXMuaWQgKyBcIi5cIik7XG4gIH1cblxuICB2YXIgcmVzcG9uc2VUeXBlID0gc2lnbmFsLmphbnVzO1xuICB2YXIgaGFuZGxlcnMgPSB0aGlzLmV2ZW50SGFuZGxlcnNbcmVzcG9uc2VUeXBlXTtcbiAgaWYgKGhhbmRsZXJzICE9IG51bGwpIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGhhbmRsZXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBoYW5kbGVyc1tpXShzaWduYWwpO1xuICAgIH1cbiAgfVxuXG4gIGlmIChzaWduYWwudHJhbnNhY3Rpb24gIT0gbnVsbCkge1xuICAgIHZhciB0eG4gPSB0aGlzLnR4bnNbc2lnbmFsLnRyYW5zYWN0aW9uXTtcbiAgICBpZiAodHhuID09IG51bGwpIHtcbiAgICAgIC8vIHRoaXMgaXMgYSByZXNwb25zZSB0byBhIHRyYW5zYWN0aW9uIHRoYXQgd2Fzbid0IGNhdXNlZCB2aWEgSmFudXNTZXNzaW9uLnNlbmQsIG9yIGEgcGx1Z2luIHJlcGxpZWQgdHdpY2UgdG8gYVxuICAgICAgLy8gc2luZ2xlIHJlcXVlc3QsIG9yIHRoZSBzZXNzaW9uIHdhcyBkaXNwb3NlZCwgb3Igc29tZXRoaW5nIGVsc2UgdGhhdCBpc24ndCB1bmRlciBvdXIgcHVydmlldzsgdGhhdCdzIGZpbmVcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAocmVzcG9uc2VUeXBlID09PSBcImFja1wiICYmIHR4bi50eXBlID09IFwibWVzc2FnZVwiKSB7XG4gICAgICAvLyB0aGlzIGlzIGFuIGFjayBvZiBhbiBhc3luY2hyb25vdXNseS1wcm9jZXNzZWQgcGx1Z2luIHJlcXVlc3QsIHdlIHNob3VsZCB3YWl0IHRvIHJlc29sdmUgdGhlIHByb21pc2UgdW50aWwgdGhlXG4gICAgICAvLyBhY3R1YWwgcmVzcG9uc2UgY29tZXMgaW5cbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjbGVhclRpbWVvdXQodHhuLnRpbWVvdXQpO1xuXG4gICAgZGVsZXRlIHRoaXMudHhuc1tzaWduYWwudHJhbnNhY3Rpb25dO1xuICAgICh0aGlzLmlzRXJyb3Ioc2lnbmFsKSA/IHR4bi5yZWplY3QgOiB0eG4ucmVzb2x2ZSkoc2lnbmFsKTtcbiAgfVxufTtcblxuLyoqXG4gKiBTZW5kcyBhIHNpZ25hbCBhc3NvY2lhdGVkIHdpdGggdGhpcyBzZXNzaW9uLCBiZWdpbm5pbmcgYSBuZXcgdHJhbnNhY3Rpb24uIFJldHVybnMgYSBwcm9taXNlIHRoYXQgd2lsbCBiZSByZXNvbHZlZCBvclxuICogcmVqZWN0ZWQgd2hlbiBhIHJlc3BvbnNlIGlzIHJlY2VpdmVkIGluIHRoZSBzYW1lIHRyYW5zYWN0aW9uLCBvciB3aGVuIG5vIHJlc3BvbnNlIGlzIHJlY2VpdmVkIHdpdGhpbiB0aGUgc2Vzc2lvblxuICogdGltZW91dC5cbiAqKi9cbkphbnVzU2Vzc2lvbi5wcm90b3R5cGUuc2VuZCA9IGZ1bmN0aW9uKHR5cGUsIHNpZ25hbCkge1xuICBzaWduYWwgPSBPYmplY3QuYXNzaWduKHsgdHJhbnNhY3Rpb246ICh0aGlzLm5leHRUeElkKyspLnRvU3RyaW5nKCkgfSwgc2lnbmFsKTtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICB2YXIgdGltZW91dCA9IG51bGw7XG4gICAgaWYgKHRoaXMub3B0aW9ucy50aW1lb3V0TXMpIHtcbiAgICAgIHRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgZGVsZXRlIHRoaXMudHhuc1tzaWduYWwudHJhbnNhY3Rpb25dO1xuICAgICAgICByZWplY3QobmV3IEVycm9yKFwiU2lnbmFsbGluZyB0cmFuc2FjdGlvbiB3aXRoIHR4aWQgXCIgKyBzaWduYWwudHJhbnNhY3Rpb24gKyBcIiB0aW1lZCBvdXQuXCIpKTtcbiAgICAgIH0sIHRoaXMub3B0aW9ucy50aW1lb3V0TXMpO1xuICAgIH1cbiAgICB0aGlzLnR4bnNbc2lnbmFsLnRyYW5zYWN0aW9uXSA9IHsgcmVzb2x2ZTogcmVzb2x2ZSwgcmVqZWN0OiByZWplY3QsIHRpbWVvdXQ6IHRpbWVvdXQsIHR5cGU6IHR5cGUgfTtcbiAgICB0aGlzLl90cmFuc21pdCh0eXBlLCBzaWduYWwpO1xuICB9KTtcbn07XG5cbkphbnVzU2Vzc2lvbi5wcm90b3R5cGUuX3RyYW5zbWl0ID0gZnVuY3Rpb24odHlwZSwgc2lnbmFsKSB7XG4gIHNpZ25hbCA9IE9iamVjdC5hc3NpZ24oeyBqYW51czogdHlwZSB9LCBzaWduYWwpO1xuXG4gIGlmICh0aGlzLmlkICE9IG51bGwpIHsgLy8gdGhpcy5pZCBpcyB1bmRlZmluZWQgaW4gdGhlIHNwZWNpYWwgY2FzZSB3aGVuIHdlJ3JlIHNlbmRpbmcgdGhlIHNlc3Npb24gY3JlYXRlIG1lc3NhZ2VcbiAgICBzaWduYWwgPSBPYmplY3QuYXNzaWduKHsgc2Vzc2lvbl9pZDogdGhpcy5pZCB9LCBzaWduYWwpO1xuICB9XG5cbiAgaWYgKHRoaXMub3B0aW9ucy52ZXJib3NlKSB7XG4gICAgdGhpcy5fbG9nT3V0Z29pbmcoc2lnbmFsKTtcbiAgfVxuXG4gIHRoaXMub3V0cHV0KEpTT04uc3RyaW5naWZ5KHNpZ25hbCkpO1xuICB0aGlzLl9yZXNldEtlZXBhbGl2ZSgpO1xufTtcblxuSmFudXNTZXNzaW9uLnByb3RvdHlwZS5fbG9nT3V0Z29pbmcgPSBmdW5jdGlvbihzaWduYWwpIHtcbiAgdmFyIGtpbmQgPSBzaWduYWwuamFudXM7XG4gIGlmIChraW5kID09PSBcIm1lc3NhZ2VcIiAmJiBzaWduYWwuanNlcCkge1xuICAgIGtpbmQgPSBzaWduYWwuanNlcC50eXBlO1xuICB9XG4gIHZhciBtZXNzYWdlID0gXCI+IE91dGdvaW5nIEphbnVzIFwiICsgKGtpbmQgfHwgXCJzaWduYWxcIikgKyBcIiAoI1wiICsgc2lnbmFsLnRyYW5zYWN0aW9uICsgXCIpOiBcIjtcbiAgY29uc29sZS5kZWJ1ZyhcIiVjXCIgKyBtZXNzYWdlLCBcImNvbG9yOiAjMDQwXCIsIHNpZ25hbCk7XG59O1xuXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLl9sb2dJbmNvbWluZyA9IGZ1bmN0aW9uKHNpZ25hbCkge1xuICB2YXIga2luZCA9IHNpZ25hbC5qYW51cztcbiAgdmFyIG1lc3NhZ2UgPSBzaWduYWwudHJhbnNhY3Rpb24gP1xuICAgICAgXCI8IEluY29taW5nIEphbnVzIFwiICsgKGtpbmQgfHwgXCJzaWduYWxcIikgKyBcIiAoI1wiICsgc2lnbmFsLnRyYW5zYWN0aW9uICsgXCIpOiBcIiA6XG4gICAgICBcIjwgSW5jb21pbmcgSmFudXMgXCIgKyAoa2luZCB8fCBcInNpZ25hbFwiKSArIFwiOiBcIjtcbiAgY29uc29sZS5kZWJ1ZyhcIiVjXCIgKyBtZXNzYWdlLCBcImNvbG9yOiAjMDA0XCIsIHNpZ25hbCk7XG59O1xuXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLl9zZW5kS2VlcGFsaXZlID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLnNlbmQoXCJrZWVwYWxpdmVcIik7XG59O1xuXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLl9raWxsS2VlcGFsaXZlID0gZnVuY3Rpb24oKSB7XG4gIGNsZWFyVGltZW91dCh0aGlzLmtlZXBhbGl2ZVRpbWVvdXQpO1xufTtcblxuSmFudXNTZXNzaW9uLnByb3RvdHlwZS5fcmVzZXRLZWVwYWxpdmUgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5fa2lsbEtlZXBhbGl2ZSgpO1xuICBpZiAodGhpcy5vcHRpb25zLmtlZXBhbGl2ZU1zKSB7XG4gICAgdGhpcy5rZWVwYWxpdmVUaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0aGlzLl9zZW5kS2VlcGFsaXZlKCkuY2F0Y2goZSA9PiBjb25zb2xlLmVycm9yKFwiRXJyb3IgcmVjZWl2ZWQgZnJvbSBrZWVwYWxpdmU6IFwiLCBlKSk7XG4gICAgfSwgdGhpcy5vcHRpb25zLmtlZXBhbGl2ZU1zKTtcbiAgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIEphbnVzUGx1Z2luSGFuZGxlLFxuICBKYW51c1Nlc3Npb25cbn07XG4iLCIvKiBnbG9iYWwgTkFGICovXG52YXIgbWogPSByZXF1aXJlKFwiQG5ldHdvcmtlZC1hZnJhbWUvbWluaWphbnVzXCIpO1xubWouSmFudXNTZXNzaW9uLnByb3RvdHlwZS5zZW5kT3JpZ2luYWwgPSBtai5KYW51c1Nlc3Npb24ucHJvdG90eXBlLnNlbmQ7XG5tai5KYW51c1Nlc3Npb24ucHJvdG90eXBlLnNlbmQgPSBmdW5jdGlvbih0eXBlLCBzaWduYWwpIHtcbiAgcmV0dXJuIHRoaXMuc2VuZE9yaWdpbmFsKHR5cGUsIHNpZ25hbCkuY2F0Y2goKGUpID0+IHtcbiAgICBpZiAoZS5tZXNzYWdlICYmIGUubWVzc2FnZS5pbmRleE9mKFwidGltZWQgb3V0XCIpID4gLTEpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJ3ZWIgc29ja2V0IHRpbWVkIG91dFwiKTtcbiAgICAgIE5BRi5jb25uZWN0aW9uLmFkYXB0ZXIucmVjb25uZWN0KCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93KGUpO1xuICAgIH1cbiAgfSk7XG59XG5cbnZhciBzZHBVdGlscyA9IHJlcXVpcmUoXCJzZHBcIik7XG52YXIgZGVidWcgPSByZXF1aXJlKFwiZGVidWdcIikoXCJuYWYtamFudXMtYWRhcHRlcjpkZWJ1Z1wiKTtcbnZhciB3YXJuID0gcmVxdWlyZShcImRlYnVnXCIpKFwibmFmLWphbnVzLWFkYXB0ZXI6d2FyblwiKTtcbnZhciBlcnJvciA9IHJlcXVpcmUoXCJkZWJ1Z1wiKShcIm5hZi1qYW51cy1hZGFwdGVyOmVycm9yXCIpO1xudmFyIGlzU2FmYXJpID0gL14oKD8hY2hyb21lfGFuZHJvaWQpLikqc2FmYXJpL2kudGVzdChuYXZpZ2F0b3IudXNlckFnZW50KTtcblxuY29uc3QgU1VCU0NSSUJFX1RJTUVPVVRfTVMgPSAxNTAwMDtcblxuY29uc3QgQVZBSUxBQkxFX09DQ1VQQU5UU19USFJFU0hPTEQgPSA1O1xuY29uc3QgTUFYX1NVQlNDUklCRV9ERUxBWSA9IDUwMDA7XG5cbmZ1bmN0aW9uIHJhbmRvbURlbGF5KG1pbiwgbWF4KSB7XG4gIHJldHVybiBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHtcbiAgICBjb25zdCBkZWxheSA9IE1hdGgucmFuZG9tKCkgKiAobWF4IC0gbWluKSArIG1pbjtcbiAgICBzZXRUaW1lb3V0KHJlc29sdmUsIGRlbGF5KTtcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIGRlYm91bmNlKGZuKSB7XG4gIHZhciBjdXJyID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgYXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cyk7XG4gICAgY3VyciA9IGN1cnIudGhlbihfID0+IGZuLmFwcGx5KHRoaXMsIGFyZ3MpKTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gcmFuZG9tVWludCgpIHtcbiAgcmV0dXJuIE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIE51bWJlci5NQVhfU0FGRV9JTlRFR0VSKTtcbn1cblxuZnVuY3Rpb24gdW50aWxEYXRhQ2hhbm5lbE9wZW4oZGF0YUNoYW5uZWwpIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICBpZiAoZGF0YUNoYW5uZWwucmVhZHlTdGF0ZSA9PT0gXCJvcGVuXCIpIHtcbiAgICAgIHJlc29sdmUoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgbGV0IHJlc29sdmVyLCByZWplY3RvcjtcblxuICAgICAgY29uc3QgY2xlYXIgPSAoKSA9PiB7XG4gICAgICAgIGRhdGFDaGFubmVsLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJvcGVuXCIsIHJlc29sdmVyKTtcbiAgICAgICAgZGF0YUNoYW5uZWwucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImVycm9yXCIsIHJlamVjdG9yKTtcbiAgICAgIH07XG5cbiAgICAgIHJlc29sdmVyID0gKCkgPT4ge1xuICAgICAgICBjbGVhcigpO1xuICAgICAgICByZXNvbHZlKCk7XG4gICAgICB9O1xuICAgICAgcmVqZWN0b3IgPSAoKSA9PiB7XG4gICAgICAgIGNsZWFyKCk7XG4gICAgICAgIHJlamVjdCgpO1xuICAgICAgfTtcblxuICAgICAgZGF0YUNoYW5uZWwuYWRkRXZlbnRMaXN0ZW5lcihcIm9wZW5cIiwgcmVzb2x2ZXIpO1xuICAgICAgZGF0YUNoYW5uZWwuYWRkRXZlbnRMaXN0ZW5lcihcImVycm9yXCIsIHJlamVjdG9yKTtcbiAgICB9XG4gIH0pO1xufVxuXG5jb25zdCBpc0gyNjRWaWRlb1N1cHBvcnRlZCA9ICgoKSA9PiB7XG4gIGNvbnN0IHZpZGVvID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInZpZGVvXCIpO1xuICByZXR1cm4gdmlkZW8uY2FuUGxheVR5cGUoJ3ZpZGVvL21wNDsgY29kZWNzPVwiYXZjMS40MkUwMUUsIG1wNGEuNDAuMlwiJykgIT09IFwiXCI7XG59KSgpO1xuXG5jb25zdCBPUFVTX1BBUkFNRVRFUlMgPSB7XG4gIC8vIGluZGljYXRlcyB0aGF0IHdlIHdhbnQgdG8gZW5hYmxlIERUWCB0byBlbGlkZSBzaWxlbmNlIHBhY2tldHNcbiAgdXNlZHR4OiAxLFxuICAvLyBpbmRpY2F0ZXMgdGhhdCB3ZSBwcmVmZXIgdG8gcmVjZWl2ZSBtb25vIGF1ZGlvIChpbXBvcnRhbnQgZm9yIHZvaXAgcHJvZmlsZSlcbiAgc3RlcmVvOiAwLFxuICAvLyBpbmRpY2F0ZXMgdGhhdCB3ZSBwcmVmZXIgdG8gc2VuZCBtb25vIGF1ZGlvIChpbXBvcnRhbnQgZm9yIHZvaXAgcHJvZmlsZSlcbiAgXCJzcHJvcC1zdGVyZW9cIjogMFxufTtcblxuY29uc3QgREVGQVVMVF9QRUVSX0NPTk5FQ1RJT05fQ09ORklHID0ge1xuICBpY2VTZXJ2ZXJzOiBbeyB1cmxzOiBcInN0dW46c3R1bjEubC5nb29nbGUuY29tOjE5MzAyXCIgfSwgeyB1cmxzOiBcInN0dW46c3R1bjIubC5nb29nbGUuY29tOjE5MzAyXCIgfV1cbn07XG5cbmNvbnN0IFdTX05PUk1BTF9DTE9TVVJFID0gMTAwMDtcblxuY2xhc3MgSmFudXNBZGFwdGVyIHtcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgdGhpcy5yb29tID0gbnVsbDtcbiAgICAvLyBXZSBleHBlY3QgdGhlIGNvbnN1bWVyIHRvIHNldCBhIGNsaWVudCBpZCBiZWZvcmUgY29ubmVjdGluZy5cbiAgICB0aGlzLmNsaWVudElkID0gbnVsbDtcbiAgICB0aGlzLmpvaW5Ub2tlbiA9IG51bGw7XG5cbiAgICB0aGlzLnNlcnZlclVybCA9IG51bGw7XG4gICAgdGhpcy53ZWJSdGNPcHRpb25zID0ge307XG4gICAgdGhpcy5wZWVyQ29ubmVjdGlvbkNvbmZpZyA9IG51bGw7XG4gICAgdGhpcy53cyA9IG51bGw7XG4gICAgdGhpcy5zZXNzaW9uID0gbnVsbDtcbiAgICB0aGlzLnJlbGlhYmxlVHJhbnNwb3J0ID0gXCJkYXRhY2hhbm5lbFwiO1xuICAgIHRoaXMudW5yZWxpYWJsZVRyYW5zcG9ydCA9IFwiZGF0YWNoYW5uZWxcIjtcblxuICAgIC8vIEluIHRoZSBldmVudCB0aGUgc2VydmVyIHJlc3RhcnRzIGFuZCBhbGwgY2xpZW50cyBsb3NlIGNvbm5lY3Rpb24sIHJlY29ubmVjdCB3aXRoXG4gICAgLy8gc29tZSByYW5kb20gaml0dGVyIGFkZGVkIHRvIHByZXZlbnQgc2ltdWx0YW5lb3VzIHJlY29ubmVjdGlvbiByZXF1ZXN0cy5cbiAgICB0aGlzLmluaXRpYWxSZWNvbm5lY3Rpb25EZWxheSA9IDEwMDAgKiBNYXRoLnJhbmRvbSgpO1xuICAgIHRoaXMucmVjb25uZWN0aW9uRGVsYXkgPSB0aGlzLmluaXRpYWxSZWNvbm5lY3Rpb25EZWxheTtcbiAgICB0aGlzLnJlY29ubmVjdGlvblRpbWVvdXQgPSBudWxsO1xuICAgIHRoaXMubWF4UmVjb25uZWN0aW9uQXR0ZW1wdHMgPSAxMDtcbiAgICB0aGlzLnJlY29ubmVjdGlvbkF0dGVtcHRzID0gMDtcblxuICAgIHRoaXMucHVibGlzaGVyID0gbnVsbDtcbiAgICB0aGlzLm9jY3VwYW50SWRzID0gW107XG4gICAgdGhpcy5vY2N1cGFudHMgPSB7fTtcbiAgICB0aGlzLm1lZGlhU3RyZWFtcyA9IHt9O1xuICAgIHRoaXMubG9jYWxNZWRpYVN0cmVhbSA9IG51bGw7XG4gICAgdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cyA9IG5ldyBNYXAoKTtcblxuICAgIHRoaXMucGVuZGluZ09jY3VwYW50cyA9IG5ldyBTZXQoKTtcbiAgICB0aGlzLmF2YWlsYWJsZU9jY3VwYW50cyA9IFtdO1xuICAgIHRoaXMucmVxdWVzdGVkT2NjdXBhbnRzID0gbnVsbDtcblxuICAgIHRoaXMuYmxvY2tlZENsaWVudHMgPSBuZXcgTWFwKCk7XG4gICAgdGhpcy5mcm96ZW5VcGRhdGVzID0gbmV3IE1hcCgpO1xuXG4gICAgdGhpcy50aW1lT2Zmc2V0cyA9IFtdO1xuICAgIHRoaXMuc2VydmVyVGltZVJlcXVlc3RzID0gMDtcbiAgICB0aGlzLmF2Z1RpbWVPZmZzZXQgPSAwO1xuXG4gICAgdGhpcy5vbldlYnNvY2tldE9wZW4gPSB0aGlzLm9uV2Vic29ja2V0T3Blbi5iaW5kKHRoaXMpO1xuICAgIHRoaXMub25XZWJzb2NrZXRDbG9zZSA9IHRoaXMub25XZWJzb2NrZXRDbG9zZS5iaW5kKHRoaXMpO1xuICAgIHRoaXMub25XZWJzb2NrZXRNZXNzYWdlID0gdGhpcy5vbldlYnNvY2tldE1lc3NhZ2UuYmluZCh0aGlzKTtcbiAgICB0aGlzLm9uRGF0YUNoYW5uZWxNZXNzYWdlID0gdGhpcy5vbkRhdGFDaGFubmVsTWVzc2FnZS5iaW5kKHRoaXMpO1xuICAgIHRoaXMub25EYXRhID0gdGhpcy5vbkRhdGEuYmluZCh0aGlzKTtcbiAgfVxuXG4gIHNldFNlcnZlclVybCh1cmwpIHtcbiAgICB0aGlzLnNlcnZlclVybCA9IHVybDtcbiAgfVxuXG4gIHNldEFwcChhcHApIHt9XG5cbiAgc2V0Um9vbShyb29tTmFtZSkge1xuICAgIHRoaXMucm9vbSA9IHJvb21OYW1lO1xuICB9XG5cbiAgc2V0Sm9pblRva2VuKGpvaW5Ub2tlbikge1xuICAgIHRoaXMuam9pblRva2VuID0gam9pblRva2VuO1xuICB9XG5cbiAgc2V0Q2xpZW50SWQoY2xpZW50SWQpIHtcbiAgICB0aGlzLmNsaWVudElkID0gY2xpZW50SWQ7XG4gIH1cblxuICBzZXRXZWJSdGNPcHRpb25zKG9wdGlvbnMpIHtcbiAgICB0aGlzLndlYlJ0Y09wdGlvbnMgPSBvcHRpb25zO1xuICB9XG5cbiAgc2V0UGVlckNvbm5lY3Rpb25Db25maWcocGVlckNvbm5lY3Rpb25Db25maWcpIHtcbiAgICB0aGlzLnBlZXJDb25uZWN0aW9uQ29uZmlnID0gcGVlckNvbm5lY3Rpb25Db25maWc7XG4gIH1cblxuICBzZXRTZXJ2ZXJDb25uZWN0TGlzdGVuZXJzKHN1Y2Nlc3NMaXN0ZW5lciwgZmFpbHVyZUxpc3RlbmVyKSB7XG4gICAgdGhpcy5jb25uZWN0U3VjY2VzcyA9IHN1Y2Nlc3NMaXN0ZW5lcjtcbiAgICB0aGlzLmNvbm5lY3RGYWlsdXJlID0gZmFpbHVyZUxpc3RlbmVyO1xuICB9XG5cbiAgc2V0Um9vbU9jY3VwYW50TGlzdGVuZXIob2NjdXBhbnRMaXN0ZW5lcikge1xuICAgIHRoaXMub25PY2N1cGFudHNDaGFuZ2VkID0gb2NjdXBhbnRMaXN0ZW5lcjtcbiAgfVxuXG4gIHNldERhdGFDaGFubmVsTGlzdGVuZXJzKG9wZW5MaXN0ZW5lciwgY2xvc2VkTGlzdGVuZXIsIG1lc3NhZ2VMaXN0ZW5lcikge1xuICAgIHRoaXMub25PY2N1cGFudENvbm5lY3RlZCA9IG9wZW5MaXN0ZW5lcjtcbiAgICB0aGlzLm9uT2NjdXBhbnREaXNjb25uZWN0ZWQgPSBjbG9zZWRMaXN0ZW5lcjtcbiAgICB0aGlzLm9uT2NjdXBhbnRNZXNzYWdlID0gbWVzc2FnZUxpc3RlbmVyO1xuICB9XG5cbiAgc2V0UmVjb25uZWN0aW9uTGlzdGVuZXJzKHJlY29ubmVjdGluZ0xpc3RlbmVyLCByZWNvbm5lY3RlZExpc3RlbmVyLCByZWNvbm5lY3Rpb25FcnJvckxpc3RlbmVyKSB7XG4gICAgLy8gb25SZWNvbm5lY3RpbmcgaXMgY2FsbGVkIHdpdGggdGhlIG51bWJlciBvZiBtaWxsaXNlY29uZHMgdW50aWwgdGhlIG5leHQgcmVjb25uZWN0aW9uIGF0dGVtcHRcbiAgICB0aGlzLm9uUmVjb25uZWN0aW5nID0gcmVjb25uZWN0aW5nTGlzdGVuZXI7XG4gICAgLy8gb25SZWNvbm5lY3RlZCBpcyBjYWxsZWQgd2hlbiB0aGUgY29ubmVjdGlvbiBoYXMgYmVlbiByZWVzdGFibGlzaGVkXG4gICAgdGhpcy5vblJlY29ubmVjdGVkID0gcmVjb25uZWN0ZWRMaXN0ZW5lcjtcbiAgICAvLyBvblJlY29ubmVjdGlvbkVycm9yIGlzIGNhbGxlZCB3aXRoIGFuIGVycm9yIHdoZW4gbWF4UmVjb25uZWN0aW9uQXR0ZW1wdHMgaGFzIGJlZW4gcmVhY2hlZFxuICAgIHRoaXMub25SZWNvbm5lY3Rpb25FcnJvciA9IHJlY29ubmVjdGlvbkVycm9yTGlzdGVuZXI7XG4gIH1cblxuICBzZXRFdmVudExvb3BzKGxvb3BzKSB7XG4gICAgdGhpcy5sb29wcyA9IGxvb3BzO1xuICB9XG5cbiAgY29ubmVjdCgpIHtcbiAgICBkZWJ1ZyhgY29ubmVjdGluZyB0byAke3RoaXMuc2VydmVyVXJsfWApO1xuXG4gICAgY29uc3Qgd2Vic29ja2V0Q29ubmVjdGlvbiA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIHRoaXMud3MgPSBuZXcgV2ViU29ja2V0KHRoaXMuc2VydmVyVXJsLCBcImphbnVzLXByb3RvY29sXCIpO1xuXG4gICAgICB0aGlzLnNlc3Npb24gPSBuZXcgbWouSmFudXNTZXNzaW9uKHRoaXMud3Muc2VuZC5iaW5kKHRoaXMud3MpLCB7IHRpbWVvdXRNczogNDAwMDAgfSk7XG5cbiAgICAgIHRoaXMud3MuYWRkRXZlbnRMaXN0ZW5lcihcImNsb3NlXCIsIHRoaXMub25XZWJzb2NrZXRDbG9zZSk7XG4gICAgICB0aGlzLndzLmFkZEV2ZW50TGlzdGVuZXIoXCJtZXNzYWdlXCIsIHRoaXMub25XZWJzb2NrZXRNZXNzYWdlKTtcblxuICAgICAgdGhpcy53c09uT3BlbiA9ICgpID0+IHtcbiAgICAgICAgdGhpcy53cy5yZW1vdmVFdmVudExpc3RlbmVyKFwib3BlblwiLCB0aGlzLndzT25PcGVuKTtcbiAgICAgICAgdGhpcy5vbldlYnNvY2tldE9wZW4oKVxuICAgICAgICAgIC50aGVuKHJlc29sdmUpXG4gICAgICAgICAgLmNhdGNoKHJlamVjdCk7XG4gICAgICB9O1xuXG4gICAgICB0aGlzLndzLmFkZEV2ZW50TGlzdGVuZXIoXCJvcGVuXCIsIHRoaXMud3NPbk9wZW4pO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIFByb21pc2UuYWxsKFt3ZWJzb2NrZXRDb25uZWN0aW9uLCB0aGlzLnVwZGF0ZVRpbWVPZmZzZXQoKV0pO1xuICB9XG5cbiAgZGlzY29ubmVjdCgpIHtcbiAgICBkZWJ1ZyhgZGlzY29ubmVjdGluZ2ApO1xuXG4gICAgY2xlYXJUaW1lb3V0KHRoaXMucmVjb25uZWN0aW9uVGltZW91dCk7XG5cbiAgICB0aGlzLnJlbW92ZUFsbE9jY3VwYW50cygpO1xuXG4gICAgaWYgKHRoaXMucHVibGlzaGVyKSB7XG4gICAgICAvLyBDbG9zZSB0aGUgcHVibGlzaGVyIHBlZXIgY29ubmVjdGlvbi4gV2hpY2ggYWxzbyBkZXRhY2hlcyB0aGUgcGx1Z2luIGhhbmRsZS5cbiAgICAgIHRoaXMucHVibGlzaGVyLmNvbm4uY2xvc2UoKTtcbiAgICAgIHRoaXMucHVibGlzaGVyID0gbnVsbDtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5zZXNzaW9uKSB7XG4gICAgICB0aGlzLnNlc3Npb24uZGlzcG9zZSgpO1xuICAgICAgdGhpcy5zZXNzaW9uID0gbnVsbDtcbiAgICB9XG5cbiAgICBpZiAodGhpcy53cykge1xuICAgICAgdGhpcy53cy5yZW1vdmVFdmVudExpc3RlbmVyKFwib3BlblwiLCB0aGlzLndzT25PcGVuKTtcbiAgICAgIHRoaXMud3MucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImNsb3NlXCIsIHRoaXMub25XZWJzb2NrZXRDbG9zZSk7XG4gICAgICB0aGlzLndzLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJtZXNzYWdlXCIsIHRoaXMub25XZWJzb2NrZXRNZXNzYWdlKTtcbiAgICAgIHRoaXMud3MuY2xvc2UoKTtcbiAgICAgIHRoaXMud3MgPSBudWxsO1xuICAgIH1cblxuICAgIC8vIE5vdyB0aGF0IGFsbCBSVENQZWVyQ29ubmVjdGlvbiBjbG9zZWQsIGJlIHN1cmUgdG8gbm90IGNhbGxcbiAgICAvLyByZWNvbm5lY3QoKSBhZ2FpbiB2aWEgcGVyZm9ybURlbGF5ZWRSZWNvbm5lY3QgaWYgcHJldmlvdXNcbiAgICAvLyBSVENQZWVyQ29ubmVjdGlvbiB3YXMgaW4gdGhlIGZhaWxlZCBzdGF0ZS5cbiAgICBpZiAodGhpcy5kZWxheWVkUmVjb25uZWN0VGltZW91dCkge1xuICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuZGVsYXllZFJlY29ubmVjdFRpbWVvdXQpO1xuICAgICAgdGhpcy5kZWxheWVkUmVjb25uZWN0VGltZW91dCA9IG51bGw7XG4gICAgfVxuICB9XG5cbiAgaXNEaXNjb25uZWN0ZWQoKSB7XG4gICAgcmV0dXJuIHRoaXMud3MgPT09IG51bGw7XG4gIH1cblxuICBhc3luYyBvbldlYnNvY2tldE9wZW4oKSB7XG4gICAgLy8gQ3JlYXRlIHRoZSBKYW51cyBTZXNzaW9uXG4gICAgYXdhaXQgdGhpcy5zZXNzaW9uLmNyZWF0ZSgpO1xuXG4gICAgLy8gQXR0YWNoIHRoZSBTRlUgUGx1Z2luIGFuZCBjcmVhdGUgYSBSVENQZWVyQ29ubmVjdGlvbiBmb3IgdGhlIHB1Ymxpc2hlci5cbiAgICAvLyBUaGUgcHVibGlzaGVyIHNlbmRzIGF1ZGlvIGFuZCBvcGVucyB0d28gYmlkaXJlY3Rpb25hbCBkYXRhIGNoYW5uZWxzLlxuICAgIC8vIE9uZSByZWxpYWJsZSBkYXRhY2hhbm5lbCBhbmQgb25lIHVucmVsaWFibGUuXG4gICAgdGhpcy5wdWJsaXNoZXIgPSBhd2FpdCB0aGlzLmNyZWF0ZVB1Ymxpc2hlcigpO1xuXG4gICAgLy8gQ2FsbCB0aGUgbmFmIGNvbm5lY3RTdWNjZXNzIGNhbGxiYWNrIGJlZm9yZSB3ZSBzdGFydCByZWNlaXZpbmcgV2ViUlRDIG1lc3NhZ2VzLlxuICAgIHRoaXMuY29ubmVjdFN1Y2Nlc3ModGhpcy5jbGllbnRJZCk7XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRoaXMucHVibGlzaGVyLmluaXRpYWxPY2N1cGFudHMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGNvbnN0IG9jY3VwYW50SWQgPSB0aGlzLnB1Ymxpc2hlci5pbml0aWFsT2NjdXBhbnRzW2ldO1xuICAgICAgaWYgKG9jY3VwYW50SWQgPT09IHRoaXMuY2xpZW50SWQpIGNvbnRpbnVlOyAvLyBIYXBwZW5zIGR1cmluZyBub24tZ3JhY2VmdWwgcmVjb25uZWN0cyBkdWUgdG8gem9tYmllIHNlc3Npb25zXG4gICAgICB0aGlzLmFkZEF2YWlsYWJsZU9jY3VwYW50KG9jY3VwYW50SWQpO1xuICAgIH1cblxuICAgIHRoaXMuc3luY09jY3VwYW50cygpO1xuICB9XG5cbiAgb25XZWJzb2NrZXRDbG9zZShldmVudCkge1xuICAgIC8vIFRoZSBjb25uZWN0aW9uIHdhcyBjbG9zZWQgc3VjY2Vzc2Z1bGx5LiBEb24ndCB0cnkgdG8gcmVjb25uZWN0LlxuICAgIGlmIChldmVudC5jb2RlID09PSBXU19OT1JNQUxfQ0xPU1VSRSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnNvbGUud2FybihcIkphbnVzIHdlYnNvY2tldCBjbG9zZWQgdW5leHBlY3RlZGx5LlwiKTtcbiAgICBpZiAodGhpcy5vblJlY29ubmVjdGluZykge1xuICAgICAgdGhpcy5vblJlY29ubmVjdGluZyh0aGlzLnJlY29ubmVjdGlvbkRlbGF5KTtcbiAgICB9XG5cbiAgICB0aGlzLnJlY29ubmVjdGlvblRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHRoaXMucmVjb25uZWN0KCksIHRoaXMucmVjb25uZWN0aW9uRGVsYXkpO1xuICB9XG5cbiAgcmVjb25uZWN0KCkge1xuICAgIC8vIERpc3Bvc2Ugb2YgYWxsIG5ldHdvcmtlZCBlbnRpdGllcyBhbmQgb3RoZXIgcmVzb3VyY2VzIHRpZWQgdG8gdGhlIHNlc3Npb24uXG4gICAgdGhpcy5kaXNjb25uZWN0KCk7XG5cbiAgICB0aGlzLmNvbm5lY3QoKVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICB0aGlzLnJlY29ubmVjdGlvbkRlbGF5ID0gdGhpcy5pbml0aWFsUmVjb25uZWN0aW9uRGVsYXk7XG4gICAgICAgIHRoaXMucmVjb25uZWN0aW9uQXR0ZW1wdHMgPSAwO1xuXG4gICAgICAgIGlmICh0aGlzLm9uUmVjb25uZWN0ZWQpIHtcbiAgICAgICAgICB0aGlzLm9uUmVjb25uZWN0ZWQoKTtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIHRoaXMucmVjb25uZWN0aW9uRGVsYXkgKz0gMTAwMDtcbiAgICAgICAgdGhpcy5yZWNvbm5lY3Rpb25BdHRlbXB0cysrO1xuXG4gICAgICAgIGlmICh0aGlzLnJlY29ubmVjdGlvbkF0dGVtcHRzID4gdGhpcy5tYXhSZWNvbm5lY3Rpb25BdHRlbXB0cyAmJiB0aGlzLm9uUmVjb25uZWN0aW9uRXJyb3IpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5vblJlY29ubmVjdGlvbkVycm9yKFxuICAgICAgICAgICAgbmV3IEVycm9yKFwiQ29ubmVjdGlvbiBjb3VsZCBub3QgYmUgcmVlc3RhYmxpc2hlZCwgZXhjZWVkZWQgbWF4aW11bSBudW1iZXIgb2YgcmVjb25uZWN0aW9uIGF0dGVtcHRzLlwiKVxuICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zb2xlLndhcm4oXCJFcnJvciBkdXJpbmcgcmVjb25uZWN0LCByZXRyeWluZy5cIik7XG4gICAgICAgIGNvbnNvbGUud2FybihlcnJvcik7XG5cbiAgICAgICAgaWYgKHRoaXMub25SZWNvbm5lY3RpbmcpIHtcbiAgICAgICAgICB0aGlzLm9uUmVjb25uZWN0aW5nKHRoaXMucmVjb25uZWN0aW9uRGVsYXkpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5yZWNvbm5lY3Rpb25UaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB0aGlzLnJlY29ubmVjdCgpLCB0aGlzLnJlY29ubmVjdGlvbkRlbGF5KTtcbiAgICAgIH0pO1xuICB9XG5cbiAgcGVyZm9ybURlbGF5ZWRSZWNvbm5lY3QoKSB7XG4gICAgaWYgKHRoaXMuZGVsYXllZFJlY29ubmVjdFRpbWVvdXQpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLmRlbGF5ZWRSZWNvbm5lY3RUaW1lb3V0KTtcbiAgICB9XG5cbiAgICB0aGlzLmRlbGF5ZWRSZWNvbm5lY3RUaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0aGlzLmRlbGF5ZWRSZWNvbm5lY3RUaW1lb3V0ID0gbnVsbDtcbiAgICAgIHRoaXMucmVjb25uZWN0KCk7XG4gICAgfSwgMTAwMDApO1xuICB9XG5cbiAgb25XZWJzb2NrZXRNZXNzYWdlKGV2ZW50KSB7XG4gICAgdGhpcy5zZXNzaW9uLnJlY2VpdmUoSlNPTi5wYXJzZShldmVudC5kYXRhKSk7XG4gIH1cblxuICBhZGRBdmFpbGFibGVPY2N1cGFudChvY2N1cGFudElkKSB7XG4gICAgaWYgKHRoaXMuYXZhaWxhYmxlT2NjdXBhbnRzLmluZGV4T2Yob2NjdXBhbnRJZCkgPT09IC0xKSB7XG4gICAgICB0aGlzLmF2YWlsYWJsZU9jY3VwYW50cy5wdXNoKG9jY3VwYW50SWQpO1xuICAgIH1cbiAgfVxuXG4gIHJlbW92ZUF2YWlsYWJsZU9jY3VwYW50KG9jY3VwYW50SWQpIHtcbiAgICBjb25zdCBpZHggPSB0aGlzLmF2YWlsYWJsZU9jY3VwYW50cy5pbmRleE9mKG9jY3VwYW50SWQpO1xuICAgIGlmIChpZHggIT09IC0xKSB7XG4gICAgICB0aGlzLmF2YWlsYWJsZU9jY3VwYW50cy5zcGxpY2UoaWR4LCAxKTtcbiAgICB9XG4gIH1cblxuICBzeW5jT2NjdXBhbnRzKHJlcXVlc3RlZE9jY3VwYW50cykge1xuICAgIGlmIChyZXF1ZXN0ZWRPY2N1cGFudHMpIHtcbiAgICAgIHRoaXMucmVxdWVzdGVkT2NjdXBhbnRzID0gcmVxdWVzdGVkT2NjdXBhbnRzO1xuICAgIH1cblxuICAgIGlmICghdGhpcy5yZXF1ZXN0ZWRPY2N1cGFudHMpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBBZGQgYW55IHJlcXVlc3RlZCwgYXZhaWxhYmxlLCBhbmQgbm9uLXBlbmRpbmcgb2NjdXBhbnRzLlxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGhpcy5yZXF1ZXN0ZWRPY2N1cGFudHMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGNvbnN0IG9jY3VwYW50SWQgPSB0aGlzLnJlcXVlc3RlZE9jY3VwYW50c1tpXTtcbiAgICAgIGlmICghdGhpcy5vY2N1cGFudHNbb2NjdXBhbnRJZF0gJiYgdGhpcy5hdmFpbGFibGVPY2N1cGFudHMuaW5kZXhPZihvY2N1cGFudElkKSAhPT0gLTEgJiYgIXRoaXMucGVuZGluZ09jY3VwYW50cy5oYXMob2NjdXBhbnRJZCkpIHtcbiAgICAgICAgdGhpcy5hZGRPY2N1cGFudChvY2N1cGFudElkKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBSZW1vdmUgYW55IHVucmVxdWVzdGVkIGFuZCBjdXJyZW50bHkgYWRkZWQgb2NjdXBhbnRzLlxuICAgIGZvciAobGV0IGogPSAwOyBqIDwgdGhpcy5hdmFpbGFibGVPY2N1cGFudHMubGVuZ3RoOyBqKyspIHtcbiAgICAgIGNvbnN0IG9jY3VwYW50SWQgPSB0aGlzLmF2YWlsYWJsZU9jY3VwYW50c1tqXTtcbiAgICAgIGlmICh0aGlzLm9jY3VwYW50c1tvY2N1cGFudElkXSAmJiB0aGlzLnJlcXVlc3RlZE9jY3VwYW50cy5pbmRleE9mKG9jY3VwYW50SWQpID09PSAtMSkge1xuICAgICAgICB0aGlzLnJlbW92ZU9jY3VwYW50KG9jY3VwYW50SWQpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIENhbGwgdGhlIE5ldHdvcmtlZCBBRnJhbWUgY2FsbGJhY2tzIGZvciB0aGUgdXBkYXRlZCBvY2N1cGFudHMgbGlzdC5cbiAgICB0aGlzLm9uT2NjdXBhbnRzQ2hhbmdlZCh0aGlzLm9jY3VwYW50cyk7XG4gIH1cblxuICBhc3luYyBhZGRPY2N1cGFudChvY2N1cGFudElkKSB7XG4gICAgdGhpcy5wZW5kaW5nT2NjdXBhbnRzLmFkZChvY2N1cGFudElkKTtcbiAgICBcbiAgICBjb25zdCBhdmFpbGFibGVPY2N1cGFudHNDb3VudCA9IHRoaXMuYXZhaWxhYmxlT2NjdXBhbnRzLmxlbmd0aDtcbiAgICBpZiAoYXZhaWxhYmxlT2NjdXBhbnRzQ291bnQgPiBBVkFJTEFCTEVfT0NDVVBBTlRTX1RIUkVTSE9MRCkge1xuICAgICAgYXdhaXQgcmFuZG9tRGVsYXkoMCwgTUFYX1NVQlNDUklCRV9ERUxBWSk7XG4gICAgfVxuICBcbiAgICBjb25zdCBzdWJzY3JpYmVyID0gYXdhaXQgdGhpcy5jcmVhdGVTdWJzY3JpYmVyKG9jY3VwYW50SWQpO1xuICAgIGlmIChzdWJzY3JpYmVyKSB7XG4gICAgICBpZighdGhpcy5wZW5kaW5nT2NjdXBhbnRzLmhhcyhvY2N1cGFudElkKSkge1xuICAgICAgICBzdWJzY3JpYmVyLmNvbm4uY2xvc2UoKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMucGVuZGluZ09jY3VwYW50cy5kZWxldGUob2NjdXBhbnRJZCk7XG4gICAgICAgIHRoaXMub2NjdXBhbnRJZHMucHVzaChvY2N1cGFudElkKTtcbiAgICAgICAgdGhpcy5vY2N1cGFudHNbb2NjdXBhbnRJZF0gPSBzdWJzY3JpYmVyO1xuXG4gICAgICAgIHRoaXMuc2V0TWVkaWFTdHJlYW0ob2NjdXBhbnRJZCwgc3Vic2NyaWJlci5tZWRpYVN0cmVhbSk7XG5cbiAgICAgICAgLy8gQ2FsbCB0aGUgTmV0d29ya2VkIEFGcmFtZSBjYWxsYmFja3MgZm9yIHRoZSBuZXcgb2NjdXBhbnQuXG4gICAgICAgIHRoaXMub25PY2N1cGFudENvbm5lY3RlZChvY2N1cGFudElkKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZW1vdmVBbGxPY2N1cGFudHMoKSB7XG4gICAgdGhpcy5wZW5kaW5nT2NjdXBhbnRzLmNsZWFyKCk7XG4gICAgZm9yIChsZXQgaSA9IHRoaXMub2NjdXBhbnRJZHMubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICAgIHRoaXMucmVtb3ZlT2NjdXBhbnQodGhpcy5vY2N1cGFudElkc1tpXSk7XG4gICAgfVxuICB9XG5cbiAgcmVtb3ZlT2NjdXBhbnQob2NjdXBhbnRJZCkge1xuICAgIHRoaXMucGVuZGluZ09jY3VwYW50cy5kZWxldGUob2NjdXBhbnRJZCk7XG4gICAgXG4gICAgaWYgKHRoaXMub2NjdXBhbnRzW29jY3VwYW50SWRdKSB7XG4gICAgICAvLyBDbG9zZSB0aGUgc3Vic2NyaWJlciBwZWVyIGNvbm5lY3Rpb24uIFdoaWNoIGFsc28gZGV0YWNoZXMgdGhlIHBsdWdpbiBoYW5kbGUuXG4gICAgICB0aGlzLm9jY3VwYW50c1tvY2N1cGFudElkXS5jb25uLmNsb3NlKCk7XG4gICAgICBkZWxldGUgdGhpcy5vY2N1cGFudHNbb2NjdXBhbnRJZF07XG4gICAgICBcbiAgICAgIHRoaXMub2NjdXBhbnRJZHMuc3BsaWNlKHRoaXMub2NjdXBhbnRJZHMuaW5kZXhPZihvY2N1cGFudElkKSwgMSk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMubWVkaWFTdHJlYW1zW29jY3VwYW50SWRdKSB7XG4gICAgICBkZWxldGUgdGhpcy5tZWRpYVN0cmVhbXNbb2NjdXBhbnRJZF07XG4gICAgfVxuXG4gICAgaWYgKHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuaGFzKG9jY3VwYW50SWQpKSB7XG4gICAgICBjb25zdCBtc2cgPSBcIlRoZSB1c2VyIGRpc2Nvbm5lY3RlZCBiZWZvcmUgdGhlIG1lZGlhIHN0cmVhbSB3YXMgcmVzb2x2ZWQuXCI7XG4gICAgICB0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmdldChvY2N1cGFudElkKS5hdWRpby5yZWplY3QobXNnKTtcbiAgICAgIHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuZ2V0KG9jY3VwYW50SWQpLnZpZGVvLnJlamVjdChtc2cpO1xuICAgICAgdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5kZWxldGUob2NjdXBhbnRJZCk7XG4gICAgfVxuXG4gICAgLy8gQ2FsbCB0aGUgTmV0d29ya2VkIEFGcmFtZSBjYWxsYmFja3MgZm9yIHRoZSByZW1vdmVkIG9jY3VwYW50LlxuICAgIHRoaXMub25PY2N1cGFudERpc2Nvbm5lY3RlZChvY2N1cGFudElkKTtcbiAgfVxuXG4gIGFzc29jaWF0ZShjb25uLCBoYW5kbGUpIHtcbiAgICBjb25uLmFkZEV2ZW50TGlzdGVuZXIoXCJpY2VjYW5kaWRhdGVcIiwgZXYgPT4ge1xuICAgICAgaGFuZGxlLnNlbmRUcmlja2xlKGV2LmNhbmRpZGF0ZSB8fCBudWxsKS5jYXRjaChlID0+IGVycm9yKFwiRXJyb3IgdHJpY2tsaW5nIElDRTogJW9cIiwgZSkpO1xuICAgIH0pO1xuICAgIGNvbm4uYWRkRXZlbnRMaXN0ZW5lcihcImljZWNvbm5lY3Rpb25zdGF0ZWNoYW5nZVwiLCBldiA9PiB7XG4gICAgICBpZiAoY29ubi5pY2VDb25uZWN0aW9uU3RhdGUgPT09IFwiY29ubmVjdGVkXCIpIHtcbiAgICAgICAgY29uc29sZS5sb2coXCJJQ0Ugc3RhdGUgY2hhbmdlZCB0byBjb25uZWN0ZWRcIik7XG4gICAgICB9XG4gICAgICBpZiAoY29ubi5pY2VDb25uZWN0aW9uU3RhdGUgPT09IFwiZGlzY29ubmVjdGVkXCIpIHtcbiAgICAgICAgY29uc29sZS53YXJuKFwiSUNFIHN0YXRlIGNoYW5nZWQgdG8gZGlzY29ubmVjdGVkXCIpO1xuICAgICAgfVxuICAgICAgaWYgKGNvbm4uaWNlQ29ubmVjdGlvblN0YXRlID09PSBcImZhaWxlZFwiKSB7XG4gICAgICAgIGNvbnNvbGUud2FybihcIklDRSBmYWlsdXJlIGRldGVjdGVkLiBSZWNvbm5lY3RpbmcgaW4gMTBzLlwiKTtcbiAgICAgICAgdGhpcy5wZXJmb3JtRGVsYXllZFJlY29ubmVjdCgpO1xuICAgICAgfVxuICAgIH0pXG5cbiAgICAvLyB3ZSBoYXZlIHRvIGRlYm91bmNlIHRoZXNlIGJlY2F1c2UgamFudXMgZ2V0cyBhbmdyeSBpZiB5b3Ugc2VuZCBpdCBhIG5ldyBTRFAgYmVmb3JlXG4gICAgLy8gaXQncyBmaW5pc2hlZCBwcm9jZXNzaW5nIGFuIGV4aXN0aW5nIFNEUC4gaW4gYWN0dWFsaXR5LCBpdCBzZWVtcyBsaWtlIHRoaXMgaXMgbWF5YmVcbiAgICAvLyB0b28gbGliZXJhbCBhbmQgd2UgbmVlZCB0byB3YWl0IHNvbWUgYW1vdW50IG9mIHRpbWUgYWZ0ZXIgYW4gb2ZmZXIgYmVmb3JlIHNlbmRpbmcgYW5vdGhlcixcbiAgICAvLyBidXQgd2UgZG9uJ3QgY3VycmVudGx5IGtub3cgYW55IGdvb2Qgd2F5IG9mIGRldGVjdGluZyBleGFjdGx5IGhvdyBsb25nIDooXG4gICAgY29ubi5hZGRFdmVudExpc3RlbmVyKFxuICAgICAgXCJuZWdvdGlhdGlvbm5lZWRlZFwiLFxuICAgICAgZGVib3VuY2UoZXYgPT4ge1xuICAgICAgICBkZWJ1ZyhcIlNlbmRpbmcgbmV3IG9mZmVyIGZvciBoYW5kbGU6ICVvXCIsIGhhbmRsZSk7XG4gICAgICAgIHZhciBvZmZlciA9IGNvbm4uY3JlYXRlT2ZmZXIoKS50aGVuKHRoaXMuY29uZmlndXJlUHVibGlzaGVyU2RwKS50aGVuKHRoaXMuZml4U2FmYXJpSWNlVUZyYWcpO1xuICAgICAgICB2YXIgbG9jYWwgPSBvZmZlci50aGVuKG8gPT4gY29ubi5zZXRMb2NhbERlc2NyaXB0aW9uKG8pKTtcbiAgICAgICAgdmFyIHJlbW90ZSA9IG9mZmVyO1xuXG4gICAgICAgIHJlbW90ZSA9IHJlbW90ZVxuICAgICAgICAgIC50aGVuKHRoaXMuZml4U2FmYXJpSWNlVUZyYWcpXG4gICAgICAgICAgLnRoZW4oaiA9PiBoYW5kbGUuc2VuZEpzZXAoaikpXG4gICAgICAgICAgLnRoZW4ociA9PiBjb25uLnNldFJlbW90ZURlc2NyaXB0aW9uKHIuanNlcCkpO1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5hbGwoW2xvY2FsLCByZW1vdGVdKS5jYXRjaChlID0+IGVycm9yKFwiRXJyb3IgbmVnb3RpYXRpbmcgb2ZmZXI6ICVvXCIsIGUpKTtcbiAgICAgIH0pXG4gICAgKTtcbiAgICBoYW5kbGUub24oXG4gICAgICBcImV2ZW50XCIsXG4gICAgICBkZWJvdW5jZShldiA9PiB7XG4gICAgICAgIHZhciBqc2VwID0gZXYuanNlcDtcbiAgICAgICAgaWYgKGpzZXAgJiYganNlcC50eXBlID09IFwib2ZmZXJcIikge1xuICAgICAgICAgIGRlYnVnKFwiQWNjZXB0aW5nIG5ldyBvZmZlciBmb3IgaGFuZGxlOiAlb1wiLCBoYW5kbGUpO1xuICAgICAgICAgIHZhciBhbnN3ZXIgPSBjb25uXG4gICAgICAgICAgICAuc2V0UmVtb3RlRGVzY3JpcHRpb24odGhpcy5jb25maWd1cmVTdWJzY3JpYmVyU2RwKGpzZXApKVxuICAgICAgICAgICAgLnRoZW4oXyA9PiBjb25uLmNyZWF0ZUFuc3dlcigpKVxuICAgICAgICAgICAgLnRoZW4odGhpcy5maXhTYWZhcmlJY2VVRnJhZyk7XG4gICAgICAgICAgdmFyIGxvY2FsID0gYW5zd2VyLnRoZW4oYSA9PiBjb25uLnNldExvY2FsRGVzY3JpcHRpb24oYSkpO1xuICAgICAgICAgIHZhciByZW1vdGUgPSBhbnN3ZXIudGhlbihqID0+IGhhbmRsZS5zZW5kSnNlcChqKSk7XG4gICAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKFtsb2NhbCwgcmVtb3RlXSkuY2F0Y2goZSA9PiBlcnJvcihcIkVycm9yIG5lZ290aWF0aW5nIGFuc3dlcjogJW9cIiwgZSkpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIHNvbWUgb3RoZXIga2luZCBvZiBldmVudCwgbm90aGluZyB0byBkb1xuICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG4gICAgICB9KVxuICAgICk7XG4gIH1cblxuICBhc3luYyBjcmVhdGVQdWJsaXNoZXIoKSB7XG4gICAgdmFyIGhhbmRsZSA9IG5ldyBtai5KYW51c1BsdWdpbkhhbmRsZSh0aGlzLnNlc3Npb24pO1xuICAgIHZhciBjb25uID0gbmV3IFJUQ1BlZXJDb25uZWN0aW9uKHRoaXMucGVlckNvbm5lY3Rpb25Db25maWcgfHwgREVGQVVMVF9QRUVSX0NPTk5FQ1RJT05fQ09ORklHKTtcblxuICAgIGRlYnVnKFwicHViIHdhaXRpbmcgZm9yIHNmdVwiKTtcbiAgICBhd2FpdCBoYW5kbGUuYXR0YWNoKFwiamFudXMucGx1Z2luLnNmdVwiLCB0aGlzLmxvb3BzICYmIHRoaXMuY2xpZW50SWQgPyBwYXJzZUludCh0aGlzLmNsaWVudElkKSAlIHRoaXMubG9vcHMgOiB1bmRlZmluZWQpO1xuXG4gICAgdGhpcy5hc3NvY2lhdGUoY29ubiwgaGFuZGxlKTtcblxuICAgIGRlYnVnKFwicHViIHdhaXRpbmcgZm9yIGRhdGEgY2hhbm5lbHMgJiB3ZWJydGN1cFwiKTtcbiAgICB2YXIgd2VicnRjdXAgPSBuZXcgUHJvbWlzZShyZXNvbHZlID0+IGhhbmRsZS5vbihcIndlYnJ0Y3VwXCIsIHJlc29sdmUpKTtcblxuICAgIC8vIFVucmVsaWFibGUgZGF0YWNoYW5uZWw6IHNlbmRpbmcgYW5kIHJlY2VpdmluZyBjb21wb25lbnQgdXBkYXRlcy5cbiAgICAvLyBSZWxpYWJsZSBkYXRhY2hhbm5lbDogc2VuZGluZyBhbmQgcmVjaWV2aW5nIGVudGl0eSBpbnN0YW50aWF0aW9ucy5cbiAgICB2YXIgcmVsaWFibGVDaGFubmVsID0gY29ubi5jcmVhdGVEYXRhQ2hhbm5lbChcInJlbGlhYmxlXCIsIHsgb3JkZXJlZDogdHJ1ZSB9KTtcbiAgICB2YXIgdW5yZWxpYWJsZUNoYW5uZWwgPSBjb25uLmNyZWF0ZURhdGFDaGFubmVsKFwidW5yZWxpYWJsZVwiLCB7XG4gICAgICBvcmRlcmVkOiBmYWxzZSxcbiAgICAgIG1heFJldHJhbnNtaXRzOiAwXG4gICAgfSk7XG5cbiAgICByZWxpYWJsZUNoYW5uZWwuYWRkRXZlbnRMaXN0ZW5lcihcIm1lc3NhZ2VcIiwgZSA9PiB0aGlzLm9uRGF0YUNoYW5uZWxNZXNzYWdlKGUsIFwiamFudXMtcmVsaWFibGVcIikpO1xuICAgIHVucmVsaWFibGVDaGFubmVsLmFkZEV2ZW50TGlzdGVuZXIoXCJtZXNzYWdlXCIsIGUgPT4gdGhpcy5vbkRhdGFDaGFubmVsTWVzc2FnZShlLCBcImphbnVzLXVucmVsaWFibGVcIikpO1xuXG4gICAgYXdhaXQgd2VicnRjdXA7XG4gICAgYXdhaXQgdW50aWxEYXRhQ2hhbm5lbE9wZW4ocmVsaWFibGVDaGFubmVsKTtcbiAgICBhd2FpdCB1bnRpbERhdGFDaGFubmVsT3Blbih1bnJlbGlhYmxlQ2hhbm5lbCk7XG5cbiAgICAvLyBkb2luZyB0aGlzIGhlcmUgaXMgc29ydCBvZiBhIGhhY2sgYXJvdW5kIGNocm9tZSByZW5lZ290aWF0aW9uIHdlaXJkbmVzcyAtLVxuICAgIC8vIGlmIHdlIGRvIGl0IHByaW9yIHRvIHdlYnJ0Y3VwLCBjaHJvbWUgb24gZ2VhciBWUiB3aWxsIHNvbWV0aW1lcyBwdXQgYVxuICAgIC8vIHJlbmVnb3RpYXRpb24gb2ZmZXIgaW4gZmxpZ2h0IHdoaWxlIHRoZSBmaXJzdCBvZmZlciB3YXMgc3RpbGwgYmVpbmdcbiAgICAvLyBwcm9jZXNzZWQgYnkgamFudXMuIHdlIHNob3VsZCBmaW5kIHNvbWUgbW9yZSBwcmluY2lwbGVkIHdheSB0byBmaWd1cmUgb3V0XG4gICAgLy8gd2hlbiBqYW51cyBpcyBkb25lIGluIHRoZSBmdXR1cmUuXG4gICAgaWYgKHRoaXMubG9jYWxNZWRpYVN0cmVhbSkge1xuICAgICAgdGhpcy5sb2NhbE1lZGlhU3RyZWFtLmdldFRyYWNrcygpLmZvckVhY2godHJhY2sgPT4ge1xuICAgICAgICBjb25uLmFkZFRyYWNrKHRyYWNrLCB0aGlzLmxvY2FsTWVkaWFTdHJlYW0pO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gSGFuZGxlIGFsbCBvZiB0aGUgam9pbiBhbmQgbGVhdmUgZXZlbnRzLlxuICAgIGhhbmRsZS5vbihcImV2ZW50XCIsIGV2ID0+IHtcbiAgICAgIHZhciBkYXRhID0gZXYucGx1Z2luZGF0YS5kYXRhO1xuICAgICAgaWYgKGRhdGEuZXZlbnQgPT0gXCJqb2luXCIgJiYgZGF0YS5yb29tX2lkID09IHRoaXMucm9vbSkge1xuICAgICAgICBpZiAodGhpcy5kZWxheWVkUmVjb25uZWN0VGltZW91dCkge1xuICAgICAgICAgIC8vIERvbid0IGNyZWF0ZSBhIG5ldyBSVENQZWVyQ29ubmVjdGlvbiwgYWxsIFJUQ1BlZXJDb25uZWN0aW9uIHdpbGwgYmUgY2xvc2VkIGluIGxlc3MgdGhhbiAxMHMuXG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuYWRkQXZhaWxhYmxlT2NjdXBhbnQoZGF0YS51c2VyX2lkKTtcbiAgICAgICAgdGhpcy5zeW5jT2NjdXBhbnRzKCk7XG4gICAgICB9IGVsc2UgaWYgKGRhdGEuZXZlbnQgPT0gXCJsZWF2ZVwiICYmIGRhdGEucm9vbV9pZCA9PSB0aGlzLnJvb20pIHtcbiAgICAgICAgdGhpcy5yZW1vdmVBdmFpbGFibGVPY2N1cGFudChkYXRhLnVzZXJfaWQpO1xuICAgICAgICB0aGlzLnJlbW92ZU9jY3VwYW50KGRhdGEudXNlcl9pZCk7XG4gICAgICB9IGVsc2UgaWYgKGRhdGEuZXZlbnQgPT0gXCJibG9ja2VkXCIpIHtcbiAgICAgICAgZG9jdW1lbnQuYm9keS5kaXNwYXRjaEV2ZW50KG5ldyBDdXN0b21FdmVudChcImJsb2NrZWRcIiwgeyBkZXRhaWw6IHsgY2xpZW50SWQ6IGRhdGEuYnkgfSB9KSk7XG4gICAgICB9IGVsc2UgaWYgKGRhdGEuZXZlbnQgPT0gXCJ1bmJsb2NrZWRcIikge1xuICAgICAgICBkb2N1bWVudC5ib2R5LmRpc3BhdGNoRXZlbnQobmV3IEN1c3RvbUV2ZW50KFwidW5ibG9ja2VkXCIsIHsgZGV0YWlsOiB7IGNsaWVudElkOiBkYXRhLmJ5IH0gfSkpO1xuICAgICAgfSBlbHNlIGlmIChkYXRhLmV2ZW50ID09PSBcImRhdGFcIikge1xuICAgICAgICB0aGlzLm9uRGF0YShKU09OLnBhcnNlKGRhdGEuYm9keSksIFwiamFudXMtZXZlbnRcIik7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBkZWJ1ZyhcInB1YiB3YWl0aW5nIGZvciBqb2luXCIpO1xuXG4gICAgLy8gU2VuZCBqb2luIG1lc3NhZ2UgdG8gamFudXMuIExpc3RlbiBmb3Igam9pbi9sZWF2ZSBtZXNzYWdlcy4gQXV0b21hdGljYWxseSBzdWJzY3JpYmUgdG8gYWxsIHVzZXJzJyBXZWJSVEMgZGF0YS5cbiAgICB2YXIgbWVzc2FnZSA9IGF3YWl0IHRoaXMuc2VuZEpvaW4oaGFuZGxlLCB7XG4gICAgICBub3RpZmljYXRpb25zOiB0cnVlLFxuICAgICAgZGF0YTogdHJ1ZVxuICAgIH0pO1xuXG4gICAgaWYgKCFtZXNzYWdlLnBsdWdpbmRhdGEuZGF0YS5zdWNjZXNzKSB7XG4gICAgICBjb25zdCBlcnIgPSBtZXNzYWdlLnBsdWdpbmRhdGEuZGF0YS5lcnJvcjtcbiAgICAgIGNvbnNvbGUuZXJyb3IoZXJyKTtcbiAgICAgIC8vIFdlIG1heSBnZXQgaGVyZSBiZWNhdXNlIG9mIGFuIGV4cGlyZWQgSldULlxuICAgICAgLy8gQ2xvc2UgdGhlIGNvbm5lY3Rpb24gb3Vyc2VsZiBvdGhlcndpc2UgamFudXMgd2lsbCBjbG9zZSBpdCBhZnRlclxuICAgICAgLy8gc2Vzc2lvbl90aW1lb3V0IGJlY2F1c2Ugd2UgZGlkbid0IHNlbmQgYW55IGtlZXBhbGl2ZSBhbmQgdGhpcyB3aWxsXG4gICAgICAvLyB0cmlnZ2VyIGEgZGVsYXllZCByZWNvbm5lY3QgYmVjYXVzZSBvZiB0aGUgaWNlY29ubmVjdGlvbnN0YXRlY2hhbmdlXG4gICAgICAvLyBsaXN0ZW5lciBmb3IgZmFpbHVyZSBzdGF0ZS5cbiAgICAgIC8vIEV2ZW4gaWYgdGhlIGFwcCBjb2RlIGNhbGxzIGRpc2Nvbm5lY3QgaW4gY2FzZSBvZiBlcnJvciwgZGlzY29ubmVjdFxuICAgICAgLy8gd29uJ3QgY2xvc2UgdGhlIHBlZXIgY29ubmVjdGlvbiBiZWNhdXNlIHRoaXMucHVibGlzaGVyIGlzIG5vdCBzZXQuXG4gICAgICBjb25uLmNsb3NlKCk7XG4gICAgICB0aHJvdyBlcnI7XG4gICAgfVxuXG4gICAgdmFyIGluaXRpYWxPY2N1cGFudHMgPSBtZXNzYWdlLnBsdWdpbmRhdGEuZGF0YS5yZXNwb25zZS51c2Vyc1t0aGlzLnJvb21dIHx8IFtdO1xuXG4gICAgaWYgKGluaXRpYWxPY2N1cGFudHMuaW5jbHVkZXModGhpcy5jbGllbnRJZCkpIHtcbiAgICAgIGNvbnNvbGUud2FybihcIkphbnVzIHN0aWxsIGhhcyBwcmV2aW91cyBzZXNzaW9uIGZvciB0aGlzIGNsaWVudC4gUmVjb25uZWN0aW5nIGluIDEwcy5cIik7XG4gICAgICB0aGlzLnBlcmZvcm1EZWxheWVkUmVjb25uZWN0KCk7XG4gICAgfVxuXG4gICAgZGVidWcoXCJwdWJsaXNoZXIgcmVhZHlcIik7XG4gICAgcmV0dXJuIHtcbiAgICAgIGhhbmRsZSxcbiAgICAgIGluaXRpYWxPY2N1cGFudHMsXG4gICAgICByZWxpYWJsZUNoYW5uZWwsXG4gICAgICB1bnJlbGlhYmxlQ2hhbm5lbCxcbiAgICAgIGNvbm5cbiAgICB9O1xuICB9XG5cbiAgY29uZmlndXJlUHVibGlzaGVyU2RwKGpzZXApIHtcbiAgICBqc2VwLnNkcCA9IGpzZXAuc2RwLnJlcGxhY2UoL2E9Zm10cDooMTA5fDExMSkuKlxcclxcbi9nLCAobGluZSwgcHQpID0+IHtcbiAgICAgIGNvbnN0IHBhcmFtZXRlcnMgPSBPYmplY3QuYXNzaWduKHNkcFV0aWxzLnBhcnNlRm10cChsaW5lKSwgT1BVU19QQVJBTUVURVJTKTtcbiAgICAgIHJldHVybiBzZHBVdGlscy53cml0ZUZtdHAoeyBwYXlsb2FkVHlwZTogcHQsIHBhcmFtZXRlcnM6IHBhcmFtZXRlcnMgfSk7XG4gICAgfSk7XG4gICAgcmV0dXJuIGpzZXA7XG4gIH1cblxuICBjb25maWd1cmVTdWJzY3JpYmVyU2RwKGpzZXApIHtcbiAgICAvLyB0b2RvOiBjb25zaWRlciBjbGVhbmluZyB1cCB0aGVzZSBoYWNrcyB0byB1c2Ugc2RwdXRpbHNcbiAgICBpZiAoIWlzSDI2NFZpZGVvU3VwcG9ydGVkKSB7XG4gICAgICBpZiAobmF2aWdhdG9yLnVzZXJBZ2VudC5pbmRleE9mKFwiSGVhZGxlc3NDaHJvbWVcIikgIT09IC0xKSB7XG4gICAgICAgIC8vIEhlYWRsZXNzQ2hyb21lIChlLmcuIHB1cHBldGVlcikgZG9lc24ndCBzdXBwb3J0IHdlYnJ0YyB2aWRlbyBzdHJlYW1zLCBzbyB3ZSByZW1vdmUgdGhvc2UgbGluZXMgZnJvbSB0aGUgU0RQLlxuICAgICAgICBqc2VwLnNkcCA9IGpzZXAuc2RwLnJlcGxhY2UoL209dmlkZW9bXl0qbT0vLCBcIm09XCIpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFRPRE86IEhhY2sgdG8gZ2V0IHZpZGVvIHdvcmtpbmcgb24gQ2hyb21lIGZvciBBbmRyb2lkLiBodHRwczovL2dyb3Vwcy5nb29nbGUuY29tL2ZvcnVtLyMhdG9waWMvbW96aWxsYS5kZXYubWVkaWEvWWUyOXZ1TVRwbzhcbiAgICBpZiAobmF2aWdhdG9yLnVzZXJBZ2VudC5pbmRleE9mKFwiQW5kcm9pZFwiKSA9PT0gLTEpIHtcbiAgICAgIGpzZXAuc2RwID0ganNlcC5zZHAucmVwbGFjZShcbiAgICAgICAgXCJhPXJ0Y3AtZmI6MTA3IGdvb2ctcmVtYlxcclxcblwiLFxuICAgICAgICBcImE9cnRjcC1mYjoxMDcgZ29vZy1yZW1iXFxyXFxuYT1ydGNwLWZiOjEwNyB0cmFuc3BvcnQtY2NcXHJcXG5hPWZtdHA6MTA3IGxldmVsLWFzeW1tZXRyeS1hbGxvd2VkPTE7cGFja2V0aXphdGlvbi1tb2RlPTE7cHJvZmlsZS1sZXZlbC1pZD00MmUwMWZcXHJcXG5cIlxuICAgICAgKTtcbiAgICB9IGVsc2Uge1xuICAgICAganNlcC5zZHAgPSBqc2VwLnNkcC5yZXBsYWNlKFxuICAgICAgICBcImE9cnRjcC1mYjoxMDcgZ29vZy1yZW1iXFxyXFxuXCIsXG4gICAgICAgIFwiYT1ydGNwLWZiOjEwNyBnb29nLXJlbWJcXHJcXG5hPXJ0Y3AtZmI6MTA3IHRyYW5zcG9ydC1jY1xcclxcbmE9Zm10cDoxMDcgbGV2ZWwtYXN5bW1ldHJ5LWFsbG93ZWQ9MTtwYWNrZXRpemF0aW9uLW1vZGU9MTtwcm9maWxlLWxldmVsLWlkPTQyMDAxZlxcclxcblwiXG4gICAgICApO1xuICAgIH1cbiAgICByZXR1cm4ganNlcDtcbiAgfVxuXG4gIGFzeW5jIGZpeFNhZmFyaUljZVVGcmFnKGpzZXApIHtcbiAgICAvLyBTYWZhcmkgcHJvZHVjZXMgYSBcXG4gaW5zdGVhZCBvZiBhbiBcXHJcXG4gZm9yIHRoZSBpY2UtdWZyYWcuIFNlZSBodHRwczovL2dpdGh1Yi5jb20vbWVldGVjaG8vamFudXMtZ2F0ZXdheS9pc3N1ZXMvMTgxOFxuICAgIGpzZXAuc2RwID0ganNlcC5zZHAucmVwbGFjZSgvW15cXHJdXFxuYT1pY2UtdWZyYWcvZywgXCJcXHJcXG5hPWljZS11ZnJhZ1wiKTtcbiAgICByZXR1cm4ganNlcFxuICB9XG5cbiAgYXN5bmMgY3JlYXRlU3Vic2NyaWJlcihvY2N1cGFudElkLCBtYXhSZXRyaWVzID0gNSkge1xuICAgIGlmICh0aGlzLmF2YWlsYWJsZU9jY3VwYW50cy5pbmRleE9mKG9jY3VwYW50SWQpID09PSAtMSkge1xuICAgICAgY29uc29sZS53YXJuKG9jY3VwYW50SWQgKyBcIjogY2FuY2VsbGVkIG9jY3VwYW50IGNvbm5lY3Rpb24sIG9jY3VwYW50IGxlZnQgYmVmb3JlIHN1YnNjcmlwdGlvbiBuZWdvdGF0aW9uLlwiKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIHZhciBoYW5kbGUgPSBuZXcgbWouSmFudXNQbHVnaW5IYW5kbGUodGhpcy5zZXNzaW9uKTtcbiAgICB2YXIgY29ubiA9IG5ldyBSVENQZWVyQ29ubmVjdGlvbih0aGlzLnBlZXJDb25uZWN0aW9uQ29uZmlnIHx8IERFRkFVTFRfUEVFUl9DT05ORUNUSU9OX0NPTkZJRyk7XG5cbiAgICBkZWJ1ZyhvY2N1cGFudElkICsgXCI6IHN1YiB3YWl0aW5nIGZvciBzZnVcIik7XG4gICAgYXdhaXQgaGFuZGxlLmF0dGFjaChcImphbnVzLnBsdWdpbi5zZnVcIiwgdGhpcy5sb29wcyA/IHBhcnNlSW50KG9jY3VwYW50SWQpICUgdGhpcy5sb29wcyA6IHVuZGVmaW5lZCk7XG5cbiAgICB0aGlzLmFzc29jaWF0ZShjb25uLCBoYW5kbGUpO1xuXG4gICAgZGVidWcob2NjdXBhbnRJZCArIFwiOiBzdWIgd2FpdGluZyBmb3Igam9pblwiKTtcblxuICAgIGlmICh0aGlzLmF2YWlsYWJsZU9jY3VwYW50cy5pbmRleE9mKG9jY3VwYW50SWQpID09PSAtMSkge1xuICAgICAgY29ubi5jbG9zZSgpO1xuICAgICAgY29uc29sZS53YXJuKG9jY3VwYW50SWQgKyBcIjogY2FuY2VsbGVkIG9jY3VwYW50IGNvbm5lY3Rpb24sIG9jY3VwYW50IGxlZnQgYWZ0ZXIgYXR0YWNoXCIpO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgbGV0IHdlYnJ0Y0ZhaWxlZCA9IGZhbHNlO1xuXG4gICAgY29uc3Qgd2VicnRjdXAgPSBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHtcbiAgICAgIGNvbnN0IGxlZnRJbnRlcnZhbCA9IHNldEludGVydmFsKCgpID0+IHtcbiAgICAgICAgaWYgKHRoaXMuYXZhaWxhYmxlT2NjdXBhbnRzLmluZGV4T2Yob2NjdXBhbnRJZCkgPT09IC0xKSB7XG4gICAgICAgICAgY2xlYXJJbnRlcnZhbChsZWZ0SW50ZXJ2YWwpO1xuICAgICAgICAgIHJlc29sdmUoKTtcbiAgICAgICAgfVxuICAgICAgfSwgMTAwMCk7XG5cbiAgICAgIGNvbnN0IHRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgY2xlYXJJbnRlcnZhbChsZWZ0SW50ZXJ2YWwpO1xuICAgICAgICB3ZWJydGNGYWlsZWQgPSB0cnVlO1xuICAgICAgICByZXNvbHZlKCk7XG4gICAgICB9LCBTVUJTQ1JJQkVfVElNRU9VVF9NUyk7XG5cbiAgICAgIGhhbmRsZS5vbihcIndlYnJ0Y3VwXCIsICgpID0+IHtcbiAgICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xuICAgICAgICBjbGVhckludGVydmFsKGxlZnRJbnRlcnZhbCk7XG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgLy8gU2VuZCBqb2luIG1lc3NhZ2UgdG8gamFudXMuIERvbid0IGxpc3RlbiBmb3Igam9pbi9sZWF2ZSBtZXNzYWdlcy4gU3Vic2NyaWJlIHRvIHRoZSBvY2N1cGFudCdzIG1lZGlhLlxuICAgIC8vIEphbnVzIHNob3VsZCBzZW5kIHVzIGFuIG9mZmVyIGZvciB0aGlzIG9jY3VwYW50J3MgbWVkaWEgaW4gcmVzcG9uc2UgdG8gdGhpcy5cbiAgICBhd2FpdCB0aGlzLnNlbmRKb2luKGhhbmRsZSwgeyBtZWRpYTogb2NjdXBhbnRJZCB9KTtcblxuICAgIGlmICh0aGlzLmF2YWlsYWJsZU9jY3VwYW50cy5pbmRleE9mKG9jY3VwYW50SWQpID09PSAtMSkge1xuICAgICAgY29ubi5jbG9zZSgpO1xuICAgICAgY29uc29sZS53YXJuKG9jY3VwYW50SWQgKyBcIjogY2FuY2VsbGVkIG9jY3VwYW50IGNvbm5lY3Rpb24sIG9jY3VwYW50IGxlZnQgYWZ0ZXIgam9pblwiKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGRlYnVnKG9jY3VwYW50SWQgKyBcIjogc3ViIHdhaXRpbmcgZm9yIHdlYnJ0Y3VwXCIpO1xuICAgIGF3YWl0IHdlYnJ0Y3VwO1xuXG4gICAgaWYgKHRoaXMuYXZhaWxhYmxlT2NjdXBhbnRzLmluZGV4T2Yob2NjdXBhbnRJZCkgPT09IC0xKSB7XG4gICAgICBjb25uLmNsb3NlKCk7XG4gICAgICBjb25zb2xlLndhcm4ob2NjdXBhbnRJZCArIFwiOiBjYW5jZWwgb2NjdXBhbnQgY29ubmVjdGlvbiwgb2NjdXBhbnQgbGVmdCBkdXJpbmcgb3IgYWZ0ZXIgd2VicnRjdXBcIik7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBpZiAod2VicnRjRmFpbGVkKSB7XG4gICAgICBjb25uLmNsb3NlKCk7XG4gICAgICBpZiAobWF4UmV0cmllcyA+IDApIHtcbiAgICAgICAgY29uc29sZS53YXJuKG9jY3VwYW50SWQgKyBcIjogd2VicnRjIHVwIHRpbWVkIG91dCwgcmV0cnlpbmdcIik7XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVN1YnNjcmliZXIob2NjdXBhbnRJZCwgbWF4UmV0cmllcyAtIDEpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc29sZS53YXJuKG9jY3VwYW50SWQgKyBcIjogd2VicnRjIHVwIHRpbWVkIG91dFwiKTtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGlzU2FmYXJpICYmICF0aGlzLl9pT1NIYWNrRGVsYXllZEluaXRpYWxQZWVyKSB7XG4gICAgICAvLyBIQUNLOiB0aGUgZmlyc3QgcGVlciBvbiBTYWZhcmkgZHVyaW5nIHBhZ2UgbG9hZCBjYW4gZmFpbCB0byB3b3JrIGlmIHdlIGRvbid0XG4gICAgICAvLyB3YWl0IHNvbWUgdGltZSBiZWZvcmUgY29udGludWluZyBoZXJlLiBTZWU6IGh0dHBzOi8vZ2l0aHViLmNvbS9tb3ppbGxhL2h1YnMvcHVsbC8xNjkyXG4gICAgICBhd2FpdCAobmV3IFByb21pc2UoKHJlc29sdmUpID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMzAwMCkpKTtcbiAgICAgIHRoaXMuX2lPU0hhY2tEZWxheWVkSW5pdGlhbFBlZXIgPSB0cnVlO1xuICAgIH1cblxuICAgIHZhciBtZWRpYVN0cmVhbSA9IG5ldyBNZWRpYVN0cmVhbSgpO1xuICAgIHZhciByZWNlaXZlcnMgPSBjb25uLmdldFJlY2VpdmVycygpO1xuICAgIHJlY2VpdmVycy5mb3JFYWNoKHJlY2VpdmVyID0+IHtcbiAgICAgIGlmIChyZWNlaXZlci50cmFjaykge1xuICAgICAgICBtZWRpYVN0cmVhbS5hZGRUcmFjayhyZWNlaXZlci50cmFjayk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgaWYgKG1lZGlhU3RyZWFtLmdldFRyYWNrcygpLmxlbmd0aCA9PT0gMCkge1xuICAgICAgbWVkaWFTdHJlYW0gPSBudWxsO1xuICAgIH1cblxuICAgIGRlYnVnKG9jY3VwYW50SWQgKyBcIjogc3Vic2NyaWJlciByZWFkeVwiKTtcbiAgICByZXR1cm4ge1xuICAgICAgaGFuZGxlLFxuICAgICAgbWVkaWFTdHJlYW0sXG4gICAgICBjb25uXG4gICAgfTtcbiAgfVxuXG4gIHNlbmRKb2luKGhhbmRsZSwgc3Vic2NyaWJlKSB7XG4gICAgcmV0dXJuIGhhbmRsZS5zZW5kTWVzc2FnZSh7XG4gICAgICBraW5kOiBcImpvaW5cIixcbiAgICAgIHJvb21faWQ6IHRoaXMucm9vbSxcbiAgICAgIHVzZXJfaWQ6IHRoaXMuY2xpZW50SWQsXG4gICAgICBzdWJzY3JpYmUsXG4gICAgICB0b2tlbjogdGhpcy5qb2luVG9rZW5cbiAgICB9KTtcbiAgfVxuXG4gIHRvZ2dsZUZyZWV6ZSgpIHtcbiAgICBpZiAodGhpcy5mcm96ZW4pIHtcbiAgICAgIHRoaXMudW5mcmVlemUoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5mcmVlemUoKTtcbiAgICB9XG4gIH1cblxuICBmcmVlemUoKSB7XG4gICAgdGhpcy5mcm96ZW4gPSB0cnVlO1xuICB9XG5cbiAgdW5mcmVlemUoKSB7XG4gICAgdGhpcy5mcm96ZW4gPSBmYWxzZTtcbiAgICB0aGlzLmZsdXNoUGVuZGluZ1VwZGF0ZXMoKTtcbiAgfVxuXG4gIGRhdGFGb3JVcGRhdGVNdWx0aU1lc3NhZ2UobmV0d29ya0lkLCBtZXNzYWdlKSB7XG4gICAgLy8gXCJkXCIgaXMgYW4gYXJyYXkgb2YgZW50aXR5IGRhdGFzLCB3aGVyZSBlYWNoIGl0ZW0gaW4gdGhlIGFycmF5IHJlcHJlc2VudHMgYSB1bmlxdWUgZW50aXR5IGFuZCBjb250YWluc1xuICAgIC8vIG1ldGFkYXRhIGZvciB0aGUgZW50aXR5LCBhbmQgYW4gYXJyYXkgb2YgY29tcG9uZW50cyB0aGF0IGhhdmUgYmVlbiB1cGRhdGVkIG9uIHRoZSBlbnRpdHkuXG4gICAgLy8gVGhpcyBtZXRob2QgZmluZHMgdGhlIGRhdGEgY29ycmVzcG9uZGluZyB0byB0aGUgZ2l2ZW4gbmV0d29ya0lkLlxuICAgIGZvciAobGV0IGkgPSAwLCBsID0gbWVzc2FnZS5kYXRhLmQubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICBjb25zdCBkYXRhID0gbWVzc2FnZS5kYXRhLmRbaV07XG5cbiAgICAgIGlmIChkYXRhLm5ldHdvcmtJZCA9PT0gbmV0d29ya0lkKSB7XG4gICAgICAgIHJldHVybiBkYXRhO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgZ2V0UGVuZGluZ0RhdGEobmV0d29ya0lkLCBtZXNzYWdlKSB7XG4gICAgaWYgKCFtZXNzYWdlKSByZXR1cm4gbnVsbDtcblxuICAgIGxldCBkYXRhID0gbWVzc2FnZS5kYXRhVHlwZSA9PT0gXCJ1bVwiID8gdGhpcy5kYXRhRm9yVXBkYXRlTXVsdGlNZXNzYWdlKG5ldHdvcmtJZCwgbWVzc2FnZSkgOiBtZXNzYWdlLmRhdGE7XG5cbiAgICAvLyBJZ25vcmUgbWVzc2FnZXMgcmVsYXRpbmcgdG8gdXNlcnMgd2hvIGhhdmUgZGlzY29ubmVjdGVkIHNpbmNlIGZyZWV6aW5nLCB0aGVpciBlbnRpdGllc1xuICAgIC8vIHdpbGwgaGF2ZSBhbGVhZHkgYmVlbiByZW1vdmVkIGJ5IE5BRi5cbiAgICAvLyBOb3RlIHRoYXQgZGVsZXRlIG1lc3NhZ2VzIGhhdmUgbm8gXCJvd25lclwiIHNvIHdlIGhhdmUgdG8gY2hlY2sgZm9yIHRoYXQgYXMgd2VsbC5cbiAgICBpZiAoZGF0YS5vd25lciAmJiAhdGhpcy5vY2N1cGFudHNbZGF0YS5vd25lcl0pIHJldHVybiBudWxsO1xuXG4gICAgLy8gSWdub3JlIG1lc3NhZ2VzIGZyb20gdXNlcnMgdGhhdCB3ZSBtYXkgaGF2ZSBibG9ja2VkIHdoaWxlIGZyb3plbi5cbiAgICBpZiAoZGF0YS5vd25lciAmJiB0aGlzLmJsb2NrZWRDbGllbnRzLmhhcyhkYXRhLm93bmVyKSkgcmV0dXJuIG51bGw7XG5cbiAgICByZXR1cm4gZGF0YVxuICB9XG5cbiAgLy8gVXNlZCBleHRlcm5hbGx5XG4gIGdldFBlbmRpbmdEYXRhRm9yTmV0d29ya0lkKG5ldHdvcmtJZCkge1xuICAgIHJldHVybiB0aGlzLmdldFBlbmRpbmdEYXRhKG5ldHdvcmtJZCwgdGhpcy5mcm96ZW5VcGRhdGVzLmdldChuZXR3b3JrSWQpKTtcbiAgfVxuXG4gIGZsdXNoUGVuZGluZ1VwZGF0ZXMoKSB7XG4gICAgZm9yIChjb25zdCBbbmV0d29ya0lkLCBtZXNzYWdlXSBvZiB0aGlzLmZyb3plblVwZGF0ZXMpIHtcbiAgICAgIGxldCBkYXRhID0gdGhpcy5nZXRQZW5kaW5nRGF0YShuZXR3b3JrSWQsIG1lc3NhZ2UpO1xuICAgICAgaWYgKCFkYXRhKSBjb250aW51ZTtcblxuICAgICAgLy8gT3ZlcnJpZGUgdGhlIGRhdGEgdHlwZSBvbiBcInVtXCIgbWVzc2FnZXMgdHlwZXMsIHNpbmNlIHdlIGV4dHJhY3QgZW50aXR5IHVwZGF0ZXMgZnJvbSBcInVtXCIgbWVzc2FnZXMgaW50b1xuICAgICAgLy8gaW5kaXZpZHVhbCBmcm96ZW5VcGRhdGVzIGluIHN0b3JlU2luZ2xlTWVzc2FnZS5cbiAgICAgIGNvbnN0IGRhdGFUeXBlID0gbWVzc2FnZS5kYXRhVHlwZSA9PT0gXCJ1bVwiID8gXCJ1XCIgOiBtZXNzYWdlLmRhdGFUeXBlO1xuXG4gICAgICB0aGlzLm9uT2NjdXBhbnRNZXNzYWdlKG51bGwsIGRhdGFUeXBlLCBkYXRhLCBtZXNzYWdlLnNvdXJjZSk7XG4gICAgfVxuICAgIHRoaXMuZnJvemVuVXBkYXRlcy5jbGVhcigpO1xuICB9XG5cbiAgc3RvcmVNZXNzYWdlKG1lc3NhZ2UpIHtcbiAgICBpZiAobWVzc2FnZS5kYXRhVHlwZSA9PT0gXCJ1bVwiKSB7IC8vIFVwZGF0ZU11bHRpXG4gICAgICBmb3IgKGxldCBpID0gMCwgbCA9IG1lc3NhZ2UuZGF0YS5kLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgICB0aGlzLnN0b3JlU2luZ2xlTWVzc2FnZShtZXNzYWdlLCBpKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5zdG9yZVNpbmdsZU1lc3NhZ2UobWVzc2FnZSk7XG4gICAgfVxuICB9XG5cbiAgc3RvcmVTaW5nbGVNZXNzYWdlKG1lc3NhZ2UsIGluZGV4KSB7XG4gICAgY29uc3QgZGF0YSA9IGluZGV4ICE9PSB1bmRlZmluZWQgPyBtZXNzYWdlLmRhdGEuZFtpbmRleF0gOiBtZXNzYWdlLmRhdGE7XG4gICAgY29uc3QgZGF0YVR5cGUgPSBtZXNzYWdlLmRhdGFUeXBlO1xuICAgIGNvbnN0IHNvdXJjZSA9IG1lc3NhZ2Uuc291cmNlO1xuXG4gICAgY29uc3QgbmV0d29ya0lkID0gZGF0YS5uZXR3b3JrSWQ7XG5cbiAgICBpZiAoIXRoaXMuZnJvemVuVXBkYXRlcy5oYXMobmV0d29ya0lkKSkge1xuICAgICAgdGhpcy5mcm96ZW5VcGRhdGVzLnNldChuZXR3b3JrSWQsIG1lc3NhZ2UpO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBzdG9yZWRNZXNzYWdlID0gdGhpcy5mcm96ZW5VcGRhdGVzLmdldChuZXR3b3JrSWQpO1xuICAgICAgY29uc3Qgc3RvcmVkRGF0YSA9IHN0b3JlZE1lc3NhZ2UuZGF0YVR5cGUgPT09IFwidW1cIiA/IHRoaXMuZGF0YUZvclVwZGF0ZU11bHRpTWVzc2FnZShuZXR3b3JrSWQsIHN0b3JlZE1lc3NhZ2UpIDogc3RvcmVkTWVzc2FnZS5kYXRhO1xuXG4gICAgICAvLyBBdm9pZCB1cGRhdGluZyBjb21wb25lbnRzIGlmIHRoZSBlbnRpdHkgZGF0YSByZWNlaXZlZCBkaWQgbm90IGNvbWUgZnJvbSB0aGUgY3VycmVudCBvd25lci5cbiAgICAgIGNvbnN0IGlzT3V0ZGF0ZWRNZXNzYWdlID0gZGF0YS5sYXN0T3duZXJUaW1lIDwgc3RvcmVkRGF0YS5sYXN0T3duZXJUaW1lO1xuICAgICAgY29uc3QgaXNDb250ZW1wb3JhbmVvdXNNZXNzYWdlID0gZGF0YS5sYXN0T3duZXJUaW1lID09PSBzdG9yZWREYXRhLmxhc3RPd25lclRpbWU7XG4gICAgICBpZiAoaXNPdXRkYXRlZE1lc3NhZ2UgfHwgKGlzQ29udGVtcG9yYW5lb3VzTWVzc2FnZSAmJiBzdG9yZWREYXRhLm93bmVyID4gZGF0YS5vd25lcikpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAoZGF0YVR5cGUgPT09IFwiclwiKSB7XG4gICAgICAgIGNvbnN0IGNyZWF0ZWRXaGlsZUZyb3plbiA9IHN0b3JlZERhdGEgJiYgc3RvcmVkRGF0YS5pc0ZpcnN0U3luYztcbiAgICAgICAgaWYgKGNyZWF0ZWRXaGlsZUZyb3plbikge1xuICAgICAgICAgIC8vIElmIHRoZSBlbnRpdHkgd2FzIGNyZWF0ZWQgYW5kIGRlbGV0ZWQgd2hpbGUgZnJvemVuLCBkb24ndCBib3RoZXIgY29udmV5aW5nIGFueXRoaW5nIHRvIHRoZSBjb25zdW1lci5cbiAgICAgICAgICB0aGlzLmZyb3plblVwZGF0ZXMuZGVsZXRlKG5ldHdvcmtJZCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gRGVsZXRlIG1lc3NhZ2VzIG92ZXJyaWRlIGFueSBvdGhlciBtZXNzYWdlcyBmb3IgdGhpcyBlbnRpdHlcbiAgICAgICAgICB0aGlzLmZyb3plblVwZGF0ZXMuc2V0KG5ldHdvcmtJZCwgbWVzc2FnZSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIG1lcmdlIGluIGNvbXBvbmVudCB1cGRhdGVzXG4gICAgICAgIGlmIChzdG9yZWREYXRhLmNvbXBvbmVudHMgJiYgZGF0YS5jb21wb25lbnRzKSB7XG4gICAgICAgICAgT2JqZWN0LmFzc2lnbihzdG9yZWREYXRhLmNvbXBvbmVudHMsIGRhdGEuY29tcG9uZW50cyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBvbkRhdGFDaGFubmVsTWVzc2FnZShlLCBzb3VyY2UpIHtcbiAgICB0aGlzLm9uRGF0YShKU09OLnBhcnNlKGUuZGF0YSksIHNvdXJjZSk7XG4gIH1cblxuICBvbkRhdGEobWVzc2FnZSwgc291cmNlKSB7XG4gICAgaWYgKGRlYnVnLmVuYWJsZWQpIHtcbiAgICAgIGRlYnVnKGBEQyBpbjogJHttZXNzYWdlfWApO1xuICAgIH1cblxuICAgIGlmICghbWVzc2FnZS5kYXRhVHlwZSkgcmV0dXJuO1xuXG4gICAgbWVzc2FnZS5zb3VyY2UgPSBzb3VyY2U7XG5cbiAgICBpZiAodGhpcy5mcm96ZW4pIHtcbiAgICAgIHRoaXMuc3RvcmVNZXNzYWdlKG1lc3NhZ2UpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLm9uT2NjdXBhbnRNZXNzYWdlKG51bGwsIG1lc3NhZ2UuZGF0YVR5cGUsIG1lc3NhZ2UuZGF0YSwgbWVzc2FnZS5zb3VyY2UpO1xuICAgIH1cbiAgfVxuXG4gIHNob3VsZFN0YXJ0Q29ubmVjdGlvblRvKGNsaWVudCkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgc3RhcnRTdHJlYW1Db25uZWN0aW9uKGNsaWVudCkge31cblxuICBjbG9zZVN0cmVhbUNvbm5lY3Rpb24oY2xpZW50KSB7fVxuXG4gIGdldENvbm5lY3RTdGF0dXMoY2xpZW50SWQpIHtcbiAgICByZXR1cm4gdGhpcy5vY2N1cGFudHNbY2xpZW50SWRdID8gTkFGLmFkYXB0ZXJzLklTX0NPTk5FQ1RFRCA6IE5BRi5hZGFwdGVycy5OT1RfQ09OTkVDVEVEO1xuICB9XG5cbiAgYXN5bmMgdXBkYXRlVGltZU9mZnNldCgpIHtcbiAgICBpZiAodGhpcy5pc0Rpc2Nvbm5lY3RlZCgpKSByZXR1cm47XG5cbiAgICBjb25zdCBjbGllbnRTZW50VGltZSA9IERhdGUubm93KCk7XG5cbiAgICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaChkb2N1bWVudC5sb2NhdGlvbi5ocmVmLCB7XG4gICAgICBtZXRob2Q6IFwiSEVBRFwiLFxuICAgICAgY2FjaGU6IFwibm8tY2FjaGVcIlxuICAgIH0pO1xuXG4gICAgY29uc3QgcHJlY2lzaW9uID0gMTAwMDtcbiAgICBjb25zdCBzZXJ2ZXJSZWNlaXZlZFRpbWUgPSBuZXcgRGF0ZShyZXMuaGVhZGVycy5nZXQoXCJEYXRlXCIpKS5nZXRUaW1lKCkgKyBwcmVjaXNpb24gLyAyO1xuICAgIGNvbnN0IGNsaWVudFJlY2VpdmVkVGltZSA9IERhdGUubm93KCk7XG4gICAgY29uc3Qgc2VydmVyVGltZSA9IHNlcnZlclJlY2VpdmVkVGltZSArIChjbGllbnRSZWNlaXZlZFRpbWUgLSBjbGllbnRTZW50VGltZSkgLyAyO1xuICAgIGNvbnN0IHRpbWVPZmZzZXQgPSBzZXJ2ZXJUaW1lIC0gY2xpZW50UmVjZWl2ZWRUaW1lO1xuXG4gICAgdGhpcy5zZXJ2ZXJUaW1lUmVxdWVzdHMrKztcblxuICAgIGlmICh0aGlzLnNlcnZlclRpbWVSZXF1ZXN0cyA8PSAxMCkge1xuICAgICAgdGhpcy50aW1lT2Zmc2V0cy5wdXNoKHRpbWVPZmZzZXQpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnRpbWVPZmZzZXRzW3RoaXMuc2VydmVyVGltZVJlcXVlc3RzICUgMTBdID0gdGltZU9mZnNldDtcbiAgICB9XG5cbiAgICB0aGlzLmF2Z1RpbWVPZmZzZXQgPSB0aGlzLnRpbWVPZmZzZXRzLnJlZHVjZSgoYWNjLCBvZmZzZXQpID0+IChhY2MgKz0gb2Zmc2V0KSwgMCkgLyB0aGlzLnRpbWVPZmZzZXRzLmxlbmd0aDtcblxuICAgIGlmICh0aGlzLnNlcnZlclRpbWVSZXF1ZXN0cyA+IDEwKSB7XG4gICAgICBkZWJ1ZyhgbmV3IHNlcnZlciB0aW1lIG9mZnNldDogJHt0aGlzLmF2Z1RpbWVPZmZzZXR9bXNgKTtcbiAgICAgIHNldFRpbWVvdXQoKCkgPT4gdGhpcy51cGRhdGVUaW1lT2Zmc2V0KCksIDUgKiA2MCAqIDEwMDApOyAvLyBTeW5jIGNsb2NrIGV2ZXJ5IDUgbWludXRlcy5cbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy51cGRhdGVUaW1lT2Zmc2V0KCk7XG4gICAgfVxuICB9XG5cbiAgZ2V0U2VydmVyVGltZSgpIHtcbiAgICByZXR1cm4gRGF0ZS5ub3coKSArIHRoaXMuYXZnVGltZU9mZnNldDtcbiAgfVxuXG4gIGdldE1lZGlhU3RyZWFtKGNsaWVudElkLCB0eXBlID0gXCJhdWRpb1wiKSB7XG4gICAgaWYgKHRoaXMubWVkaWFTdHJlYW1zW2NsaWVudElkXSkge1xuICAgICAgZGVidWcoYEFscmVhZHkgaGFkICR7dHlwZX0gZm9yICR7Y2xpZW50SWR9YCk7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHRoaXMubWVkaWFTdHJlYW1zW2NsaWVudElkXVt0eXBlXSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGRlYnVnKGBXYWl0aW5nIG9uICR7dHlwZX0gZm9yICR7Y2xpZW50SWR9YCk7XG4gICAgICBpZiAoIXRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuaGFzKGNsaWVudElkKSkge1xuICAgICAgICB0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLnNldChjbGllbnRJZCwge30pO1xuXG4gICAgICAgIGNvbnN0IGF1ZGlvUHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgICB0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmdldChjbGllbnRJZCkuYXVkaW8gPSB7IHJlc29sdmUsIHJlamVjdCB9O1xuICAgICAgICB9KTtcbiAgICAgICAgY29uc3QgdmlkZW9Qcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICAgIHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuZ2V0KGNsaWVudElkKS52aWRlbyA9IHsgcmVzb2x2ZSwgcmVqZWN0IH07XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuZ2V0KGNsaWVudElkKS5hdWRpby5wcm9taXNlID0gYXVkaW9Qcm9taXNlO1xuICAgICAgICB0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmdldChjbGllbnRJZCkudmlkZW8ucHJvbWlzZSA9IHZpZGVvUHJvbWlzZTtcblxuICAgICAgICBhdWRpb1Byb21pc2UuY2F0Y2goZSA9PiBjb25zb2xlLndhcm4oYCR7Y2xpZW50SWR9IGdldE1lZGlhU3RyZWFtIEF1ZGlvIEVycm9yYCwgZSkpO1xuICAgICAgICB2aWRlb1Byb21pc2UuY2F0Y2goZSA9PiBjb25zb2xlLndhcm4oYCR7Y2xpZW50SWR9IGdldE1lZGlhU3RyZWFtIFZpZGVvIEVycm9yYCwgZSkpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuZ2V0KGNsaWVudElkKVt0eXBlXS5wcm9taXNlO1xuICAgIH1cbiAgfVxuXG4gIHNldE1lZGlhU3RyZWFtKGNsaWVudElkLCBzdHJlYW0pIHtcbiAgICAvLyBTYWZhcmkgZG9lc24ndCBsaWtlIGl0IHdoZW4geW91IHVzZSBzaW5nbGUgYSBtaXhlZCBtZWRpYSBzdHJlYW0gd2hlcmUgb25lIG9mIHRoZSB0cmFja3MgaXMgaW5hY3RpdmUsIHNvIHdlXG4gICAgLy8gc3BsaXQgdGhlIHRyYWNrcyBpbnRvIHR3byBzdHJlYW1zLlxuICAgIGNvbnN0IGF1ZGlvU3RyZWFtID0gbmV3IE1lZGlhU3RyZWFtKCk7XG4gICAgdHJ5IHtcbiAgICBzdHJlYW0uZ2V0QXVkaW9UcmFja3MoKS5mb3JFYWNoKHRyYWNrID0+IGF1ZGlvU3RyZWFtLmFkZFRyYWNrKHRyYWNrKSk7XG5cbiAgICB9IGNhdGNoKGUpIHtcbiAgICAgIGNvbnNvbGUud2FybihgJHtjbGllbnRJZH0gc2V0TWVkaWFTdHJlYW0gQXVkaW8gRXJyb3JgLCBlKTtcbiAgICB9XG4gICAgY29uc3QgdmlkZW9TdHJlYW0gPSBuZXcgTWVkaWFTdHJlYW0oKTtcbiAgICB0cnkge1xuICAgIHN0cmVhbS5nZXRWaWRlb1RyYWNrcygpLmZvckVhY2godHJhY2sgPT4gdmlkZW9TdHJlYW0uYWRkVHJhY2sodHJhY2spKTtcblxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGNvbnNvbGUud2FybihgJHtjbGllbnRJZH0gc2V0TWVkaWFTdHJlYW0gVmlkZW8gRXJyb3JgLCBlKTtcbiAgICB9XG5cbiAgICB0aGlzLm1lZGlhU3RyZWFtc1tjbGllbnRJZF0gPSB7IGF1ZGlvOiBhdWRpb1N0cmVhbSwgdmlkZW86IHZpZGVvU3RyZWFtIH07XG5cbiAgICAvLyBSZXNvbHZlIHRoZSBwcm9taXNlIGZvciB0aGUgdXNlcidzIG1lZGlhIHN0cmVhbSBpZiBpdCBleGlzdHMuXG4gICAgaWYgKHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuaGFzKGNsaWVudElkKSkge1xuICAgICAgdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5nZXQoY2xpZW50SWQpLmF1ZGlvLnJlc29sdmUoYXVkaW9TdHJlYW0pO1xuICAgICAgdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5nZXQoY2xpZW50SWQpLnZpZGVvLnJlc29sdmUodmlkZW9TdHJlYW0pO1xuICAgIH1cbiAgfVxuXG4gIGdldExvY2FsTWVkaWFTdHJlYW0oKSB7XG4gICAgcmV0dXJuIHRoaXMubG9jYWxNZWRpYVN0cmVhbTtcbiAgfVxuXG4gIGFzeW5jIHNldExvY2FsTWVkaWFTdHJlYW0oc3RyZWFtKSB7XG4gICAgLy8gb3VyIGpvYiBoZXJlIGlzIHRvIG1ha2Ugc3VyZSB0aGUgY29ubmVjdGlvbiB3aW5kcyB1cCB3aXRoIFJUUCBzZW5kZXJzIHNlbmRpbmcgdGhlIHN0dWZmIGluIHRoaXMgc3RyZWFtLFxuICAgIC8vIGFuZCBub3QgdGhlIHN0dWZmIHRoYXQgaXNuJ3QgaW4gdGhpcyBzdHJlYW0uIHN0cmF0ZWd5IGlzIHRvIHJlcGxhY2UgZXhpc3RpbmcgdHJhY2tzIGlmIHdlIGNhbiwgYWRkIHRyYWNrc1xuICAgIC8vIHRoYXQgd2UgY2FuJ3QgcmVwbGFjZSwgYW5kIGRpc2FibGUgdHJhY2tzIHRoYXQgZG9uJ3QgZXhpc3QgYW55bW9yZS5cblxuICAgIC8vIG5vdGUgdGhhdCB3ZSBkb24ndCBldmVyIHJlbW92ZSBhIHRyYWNrIGZyb20gdGhlIHN0cmVhbSAtLSBzaW5jZSBKYW51cyBkb2Vzbid0IHN1cHBvcnQgVW5pZmllZCBQbGFuLCB3ZSBhYnNvbHV0ZWx5XG4gICAgLy8gY2FuJ3Qgd2luZCB1cCB3aXRoIGEgU0RQIHRoYXQgaGFzID4xIGF1ZGlvIG9yID4xIHZpZGVvIHRyYWNrcywgZXZlbiBpZiBvbmUgb2YgdGhlbSBpcyBpbmFjdGl2ZSAod2hhdCB5b3UgZ2V0IGlmXG4gICAgLy8geW91IHJlbW92ZSBhIHRyYWNrIGZyb20gYW4gZXhpc3Rpbmcgc3RyZWFtLilcbiAgICBpZiAodGhpcy5wdWJsaXNoZXIgJiYgdGhpcy5wdWJsaXNoZXIuY29ubikge1xuICAgICAgY29uc3QgZXhpc3RpbmdTZW5kZXJzID0gdGhpcy5wdWJsaXNoZXIuY29ubi5nZXRTZW5kZXJzKCk7XG4gICAgICBjb25zdCBuZXdTZW5kZXJzID0gW107XG4gICAgICBjb25zdCB0cmFja3MgPSBzdHJlYW0uZ2V0VHJhY2tzKCk7XG5cbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdHJhY2tzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGNvbnN0IHQgPSB0cmFja3NbaV07XG4gICAgICAgIGNvbnN0IHNlbmRlciA9IGV4aXN0aW5nU2VuZGVycy5maW5kKHMgPT4gcy50cmFjayAhPSBudWxsICYmIHMudHJhY2sua2luZCA9PSB0LmtpbmQpO1xuXG4gICAgICAgIGlmIChzZW5kZXIgIT0gbnVsbCkge1xuICAgICAgICAgIGlmIChzZW5kZXIucmVwbGFjZVRyYWNrKSB7XG4gICAgICAgICAgICBhd2FpdCBzZW5kZXIucmVwbGFjZVRyYWNrKHQpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBGYWxsYmFjayBmb3IgYnJvd3NlcnMgdGhhdCBkb24ndCBzdXBwb3J0IHJlcGxhY2VUcmFjay4gQXQgdGhpcyB0aW1lIG9mIHRoaXMgd3JpdGluZ1xuICAgICAgICAgICAgLy8gbW9zdCBicm93c2VycyBzdXBwb3J0IGl0LCBhbmQgdGVzdGluZyB0aGlzIGNvZGUgcGF0aCBzZWVtcyB0byBub3Qgd29yayBwcm9wZXJseVxuICAgICAgICAgICAgLy8gaW4gQ2hyb21lIGFueW1vcmUuXG4gICAgICAgICAgICBzdHJlYW0ucmVtb3ZlVHJhY2soc2VuZGVyLnRyYWNrKTtcbiAgICAgICAgICAgIHN0cmVhbS5hZGRUcmFjayh0KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgbmV3U2VuZGVycy5wdXNoKHNlbmRlcik7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgbmV3U2VuZGVycy5wdXNoKHRoaXMucHVibGlzaGVyLmNvbm4uYWRkVHJhY2sodCwgc3RyZWFtKSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGV4aXN0aW5nU2VuZGVycy5mb3JFYWNoKHMgPT4ge1xuICAgICAgICBpZiAoIW5ld1NlbmRlcnMuaW5jbHVkZXMocykpIHtcbiAgICAgICAgICBzLnRyYWNrLmVuYWJsZWQgPSBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICAgIHRoaXMubG9jYWxNZWRpYVN0cmVhbSA9IHN0cmVhbTtcbiAgICB0aGlzLnNldE1lZGlhU3RyZWFtKHRoaXMuY2xpZW50SWQsIHN0cmVhbSk7XG4gIH1cblxuICBlbmFibGVNaWNyb3Bob25lKGVuYWJsZWQpIHtcbiAgICBpZiAodGhpcy5wdWJsaXNoZXIgJiYgdGhpcy5wdWJsaXNoZXIuY29ubikge1xuICAgICAgdGhpcy5wdWJsaXNoZXIuY29ubi5nZXRTZW5kZXJzKCkuZm9yRWFjaChzID0+IHtcbiAgICAgICAgaWYgKHMudHJhY2sua2luZCA9PSBcImF1ZGlvXCIpIHtcbiAgICAgICAgICBzLnRyYWNrLmVuYWJsZWQgPSBlbmFibGVkO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICBzZW5kRGF0YShjbGllbnRJZCwgZGF0YVR5cGUsIGRhdGEpIHtcbiAgICBpZiAoIXRoaXMucHVibGlzaGVyKSB7XG4gICAgICBjb25zb2xlLndhcm4oXCJzZW5kRGF0YSBjYWxsZWQgd2l0aG91dCBhIHB1Ymxpc2hlclwiKTtcbiAgICB9IGVsc2Uge1xuICAgICAgc3dpdGNoICh0aGlzLnVucmVsaWFibGVUcmFuc3BvcnQpIHtcbiAgICAgICAgY2FzZSBcIndlYnNvY2tldFwiOlxuICAgICAgICAgIGlmICh0aGlzLndzLnJlYWR5U3RhdGUgPT09IDEpIHsgLy8gT1BFTlxuICAgICAgICAgICAgdGhpcy5wdWJsaXNoZXIuaGFuZGxlLnNlbmRNZXNzYWdlKHsga2luZDogXCJkYXRhXCIsIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZGF0YVR5cGUsIGRhdGEgfSksIHdob206IGNsaWVudElkIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSBcImRhdGFjaGFubmVsXCI6XG4gICAgICAgICAgaWYgKHRoaXMucHVibGlzaGVyLnVucmVsaWFibGVDaGFubmVsLnJlYWR5U3RhdGUgPT09IFwib3BlblwiKSB7XG4gICAgICAgICAgICB0aGlzLnB1Ymxpc2hlci51bnJlbGlhYmxlQ2hhbm5lbC5zZW5kKEpTT04uc3RyaW5naWZ5KHsgY2xpZW50SWQsIGRhdGFUeXBlLCBkYXRhIH0pKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgdGhpcy51bnJlbGlhYmxlVHJhbnNwb3J0KGNsaWVudElkLCBkYXRhVHlwZSwgZGF0YSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgc2VuZERhdGFHdWFyYW50ZWVkKGNsaWVudElkLCBkYXRhVHlwZSwgZGF0YSkge1xuICAgIGlmICghdGhpcy5wdWJsaXNoZXIpIHtcbiAgICAgIGNvbnNvbGUud2FybihcInNlbmREYXRhR3VhcmFudGVlZCBjYWxsZWQgd2l0aG91dCBhIHB1Ymxpc2hlclwiKTtcbiAgICB9IGVsc2Uge1xuICAgICAgc3dpdGNoICh0aGlzLnJlbGlhYmxlVHJhbnNwb3J0KSB7XG4gICAgICAgIGNhc2UgXCJ3ZWJzb2NrZXRcIjpcbiAgICAgICAgICBpZiAodGhpcy53cy5yZWFkeVN0YXRlID09PSAxKSB7IC8vIE9QRU5cbiAgICAgICAgICAgIHRoaXMucHVibGlzaGVyLmhhbmRsZS5zZW5kTWVzc2FnZSh7IGtpbmQ6IFwiZGF0YVwiLCBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGRhdGFUeXBlLCBkYXRhIH0pLCB3aG9tOiBjbGllbnRJZCB9KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgXCJkYXRhY2hhbm5lbFwiOlxuICAgICAgICAgIGlmICh0aGlzLnB1Ymxpc2hlci5yZWxpYWJsZUNoYW5uZWwucmVhZHlTdGF0ZSA9PT0gXCJvcGVuXCIpIHtcbiAgICAgICAgICAgIHRoaXMucHVibGlzaGVyLnJlbGlhYmxlQ2hhbm5lbC5zZW5kKEpTT04uc3RyaW5naWZ5KHsgY2xpZW50SWQsIGRhdGFUeXBlLCBkYXRhIH0pKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgdGhpcy5yZWxpYWJsZVRyYW5zcG9ydChjbGllbnRJZCwgZGF0YVR5cGUsIGRhdGEpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGJyb2FkY2FzdERhdGEoZGF0YVR5cGUsIGRhdGEpIHtcbiAgICBpZiAoIXRoaXMucHVibGlzaGVyKSB7XG4gICAgICBjb25zb2xlLndhcm4oXCJicm9hZGNhc3REYXRhIGNhbGxlZCB3aXRob3V0IGEgcHVibGlzaGVyXCIpO1xuICAgIH0gZWxzZSB7XG4gICAgICBzd2l0Y2ggKHRoaXMudW5yZWxpYWJsZVRyYW5zcG9ydCkge1xuICAgICAgICBjYXNlIFwid2Vic29ja2V0XCI6XG4gICAgICAgICAgaWYgKHRoaXMud3MucmVhZHlTdGF0ZSA9PT0gMSkgeyAvLyBPUEVOXG4gICAgICAgICAgICB0aGlzLnB1Ymxpc2hlci5oYW5kbGUuc2VuZE1lc3NhZ2UoeyBraW5kOiBcImRhdGFcIiwgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBkYXRhVHlwZSwgZGF0YSB9KSB9KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgXCJkYXRhY2hhbm5lbFwiOlxuICAgICAgICAgIGlmICh0aGlzLnB1Ymxpc2hlci51bnJlbGlhYmxlQ2hhbm5lbC5yZWFkeVN0YXRlID09PSBcIm9wZW5cIikge1xuICAgICAgICAgICAgdGhpcy5wdWJsaXNoZXIudW5yZWxpYWJsZUNoYW5uZWwuc2VuZChKU09OLnN0cmluZ2lmeSh7IGRhdGFUeXBlLCBkYXRhIH0pKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgdGhpcy51bnJlbGlhYmxlVHJhbnNwb3J0KHVuZGVmaW5lZCwgZGF0YVR5cGUsIGRhdGEpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGJyb2FkY2FzdERhdGFHdWFyYW50ZWVkKGRhdGFUeXBlLCBkYXRhKSB7XG4gICAgaWYgKCF0aGlzLnB1Ymxpc2hlcikge1xuICAgICAgY29uc29sZS53YXJuKFwiYnJvYWRjYXN0RGF0YUd1YXJhbnRlZWQgY2FsbGVkIHdpdGhvdXQgYSBwdWJsaXNoZXJcIik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHN3aXRjaCAodGhpcy5yZWxpYWJsZVRyYW5zcG9ydCkge1xuICAgICAgICBjYXNlIFwid2Vic29ja2V0XCI6XG4gICAgICAgICAgaWYgKHRoaXMud3MucmVhZHlTdGF0ZSA9PT0gMSkgeyAvLyBPUEVOXG4gICAgICAgICAgICB0aGlzLnB1Ymxpc2hlci5oYW5kbGUuc2VuZE1lc3NhZ2UoeyBraW5kOiBcImRhdGFcIiwgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBkYXRhVHlwZSwgZGF0YSB9KSB9KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgXCJkYXRhY2hhbm5lbFwiOlxuICAgICAgICAgIGlmICh0aGlzLnB1Ymxpc2hlci5yZWxpYWJsZUNoYW5uZWwucmVhZHlTdGF0ZSA9PT0gXCJvcGVuXCIpIHtcbiAgICAgICAgICAgIHRoaXMucHVibGlzaGVyLnJlbGlhYmxlQ2hhbm5lbC5zZW5kKEpTT04uc3RyaW5naWZ5KHsgZGF0YVR5cGUsIGRhdGEgfSkpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICB0aGlzLnJlbGlhYmxlVHJhbnNwb3J0KHVuZGVmaW5lZCwgZGF0YVR5cGUsIGRhdGEpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGtpY2soY2xpZW50SWQsIHBlcm1zVG9rZW4pIHtcbiAgICByZXR1cm4gdGhpcy5wdWJsaXNoZXIuaGFuZGxlLnNlbmRNZXNzYWdlKHsga2luZDogXCJraWNrXCIsIHJvb21faWQ6IHRoaXMucm9vbSwgdXNlcl9pZDogY2xpZW50SWQsIHRva2VuOiBwZXJtc1Rva2VuIH0pLnRoZW4oKCkgPT4ge1xuICAgICAgZG9jdW1lbnQuYm9keS5kaXNwYXRjaEV2ZW50KG5ldyBDdXN0b21FdmVudChcImtpY2tlZFwiLCB7IGRldGFpbDogeyBjbGllbnRJZDogY2xpZW50SWQgfSB9KSk7XG4gICAgfSk7XG4gIH1cblxuICBibG9jayhjbGllbnRJZCkge1xuICAgIHJldHVybiB0aGlzLnB1Ymxpc2hlci5oYW5kbGUuc2VuZE1lc3NhZ2UoeyBraW5kOiBcImJsb2NrXCIsIHdob206IGNsaWVudElkIH0pLnRoZW4oKCkgPT4ge1xuICAgICAgdGhpcy5ibG9ja2VkQ2xpZW50cy5zZXQoY2xpZW50SWQsIHRydWUpO1xuICAgICAgZG9jdW1lbnQuYm9keS5kaXNwYXRjaEV2ZW50KG5ldyBDdXN0b21FdmVudChcImJsb2NrZWRcIiwgeyBkZXRhaWw6IHsgY2xpZW50SWQ6IGNsaWVudElkIH0gfSkpO1xuICAgIH0pO1xuICB9XG5cbiAgdW5ibG9jayhjbGllbnRJZCkge1xuICAgIHJldHVybiB0aGlzLnB1Ymxpc2hlci5oYW5kbGUuc2VuZE1lc3NhZ2UoeyBraW5kOiBcInVuYmxvY2tcIiwgd2hvbTogY2xpZW50SWQgfSkudGhlbigoKSA9PiB7XG4gICAgICB0aGlzLmJsb2NrZWRDbGllbnRzLmRlbGV0ZShjbGllbnRJZCk7XG4gICAgICBkb2N1bWVudC5ib2R5LmRpc3BhdGNoRXZlbnQobmV3IEN1c3RvbUV2ZW50KFwidW5ibG9ja2VkXCIsIHsgZGV0YWlsOiB7IGNsaWVudElkOiBjbGllbnRJZCB9IH0pKTtcbiAgICB9KTtcbiAgfVxufVxuXG5OQUYuYWRhcHRlcnMucmVnaXN0ZXIoXCJqYW51c1wiLCBKYW51c0FkYXB0ZXIpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEphbnVzQWRhcHRlcjtcbiIsIi8qIGVzbGludC1lbnYgYnJvd3NlciAqL1xuXG4vKipcbiAqIFRoaXMgaXMgdGhlIHdlYiBicm93c2VyIGltcGxlbWVudGF0aW9uIG9mIGBkZWJ1ZygpYC5cbiAqL1xuXG5leHBvcnRzLmZvcm1hdEFyZ3MgPSBmb3JtYXRBcmdzO1xuZXhwb3J0cy5zYXZlID0gc2F2ZTtcbmV4cG9ydHMubG9hZCA9IGxvYWQ7XG5leHBvcnRzLnVzZUNvbG9ycyA9IHVzZUNvbG9ycztcbmV4cG9ydHMuc3RvcmFnZSA9IGxvY2Fsc3RvcmFnZSgpO1xuZXhwb3J0cy5kZXN0cm95ID0gKCgpID0+IHtcblx0bGV0IHdhcm5lZCA9IGZhbHNlO1xuXG5cdHJldHVybiAoKSA9PiB7XG5cdFx0aWYgKCF3YXJuZWQpIHtcblx0XHRcdHdhcm5lZCA9IHRydWU7XG5cdFx0XHRjb25zb2xlLndhcm4oJ0luc3RhbmNlIG1ldGhvZCBgZGVidWcuZGVzdHJveSgpYCBpcyBkZXByZWNhdGVkIGFuZCBubyBsb25nZXIgZG9lcyBhbnl0aGluZy4gSXQgd2lsbCBiZSByZW1vdmVkIGluIHRoZSBuZXh0IG1ham9yIHZlcnNpb24gb2YgYGRlYnVnYC4nKTtcblx0XHR9XG5cdH07XG59KSgpO1xuXG4vKipcbiAqIENvbG9ycy5cbiAqL1xuXG5leHBvcnRzLmNvbG9ycyA9IFtcblx0JyMwMDAwQ0MnLFxuXHQnIzAwMDBGRicsXG5cdCcjMDAzM0NDJyxcblx0JyMwMDMzRkYnLFxuXHQnIzAwNjZDQycsXG5cdCcjMDA2NkZGJyxcblx0JyMwMDk5Q0MnLFxuXHQnIzAwOTlGRicsXG5cdCcjMDBDQzAwJyxcblx0JyMwMENDMzMnLFxuXHQnIzAwQ0M2NicsXG5cdCcjMDBDQzk5Jyxcblx0JyMwMENDQ0MnLFxuXHQnIzAwQ0NGRicsXG5cdCcjMzMwMENDJyxcblx0JyMzMzAwRkYnLFxuXHQnIzMzMzNDQycsXG5cdCcjMzMzM0ZGJyxcblx0JyMzMzY2Q0MnLFxuXHQnIzMzNjZGRicsXG5cdCcjMzM5OUNDJyxcblx0JyMzMzk5RkYnLFxuXHQnIzMzQ0MwMCcsXG5cdCcjMzNDQzMzJyxcblx0JyMzM0NDNjYnLFxuXHQnIzMzQ0M5OScsXG5cdCcjMzNDQ0NDJyxcblx0JyMzM0NDRkYnLFxuXHQnIzY2MDBDQycsXG5cdCcjNjYwMEZGJyxcblx0JyM2NjMzQ0MnLFxuXHQnIzY2MzNGRicsXG5cdCcjNjZDQzAwJyxcblx0JyM2NkNDMzMnLFxuXHQnIzk5MDBDQycsXG5cdCcjOTkwMEZGJyxcblx0JyM5OTMzQ0MnLFxuXHQnIzk5MzNGRicsXG5cdCcjOTlDQzAwJyxcblx0JyM5OUNDMzMnLFxuXHQnI0NDMDAwMCcsXG5cdCcjQ0MwMDMzJyxcblx0JyNDQzAwNjYnLFxuXHQnI0NDMDA5OScsXG5cdCcjQ0MwMENDJyxcblx0JyNDQzAwRkYnLFxuXHQnI0NDMzMwMCcsXG5cdCcjQ0MzMzMzJyxcblx0JyNDQzMzNjYnLFxuXHQnI0NDMzM5OScsXG5cdCcjQ0MzM0NDJyxcblx0JyNDQzMzRkYnLFxuXHQnI0NDNjYwMCcsXG5cdCcjQ0M2NjMzJyxcblx0JyNDQzk5MDAnLFxuXHQnI0NDOTkzMycsXG5cdCcjQ0NDQzAwJyxcblx0JyNDQ0NDMzMnLFxuXHQnI0ZGMDAwMCcsXG5cdCcjRkYwMDMzJyxcblx0JyNGRjAwNjYnLFxuXHQnI0ZGMDA5OScsXG5cdCcjRkYwMENDJyxcblx0JyNGRjAwRkYnLFxuXHQnI0ZGMzMwMCcsXG5cdCcjRkYzMzMzJyxcblx0JyNGRjMzNjYnLFxuXHQnI0ZGMzM5OScsXG5cdCcjRkYzM0NDJyxcblx0JyNGRjMzRkYnLFxuXHQnI0ZGNjYwMCcsXG5cdCcjRkY2NjMzJyxcblx0JyNGRjk5MDAnLFxuXHQnI0ZGOTkzMycsXG5cdCcjRkZDQzAwJyxcblx0JyNGRkNDMzMnXG5dO1xuXG4vKipcbiAqIEN1cnJlbnRseSBvbmx5IFdlYktpdC1iYXNlZCBXZWIgSW5zcGVjdG9ycywgRmlyZWZveCA+PSB2MzEsXG4gKiBhbmQgdGhlIEZpcmVidWcgZXh0ZW5zaW9uIChhbnkgRmlyZWZveCB2ZXJzaW9uKSBhcmUga25vd25cbiAqIHRvIHN1cHBvcnQgXCIlY1wiIENTUyBjdXN0b21pemF0aW9ucy5cbiAqXG4gKiBUT0RPOiBhZGQgYSBgbG9jYWxTdG9yYWdlYCB2YXJpYWJsZSB0byBleHBsaWNpdGx5IGVuYWJsZS9kaXNhYmxlIGNvbG9yc1xuICovXG5cbi8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBjb21wbGV4aXR5XG5mdW5jdGlvbiB1c2VDb2xvcnMoKSB7XG5cdC8vIE5COiBJbiBhbiBFbGVjdHJvbiBwcmVsb2FkIHNjcmlwdCwgZG9jdW1lbnQgd2lsbCBiZSBkZWZpbmVkIGJ1dCBub3QgZnVsbHlcblx0Ly8gaW5pdGlhbGl6ZWQuIFNpbmNlIHdlIGtub3cgd2UncmUgaW4gQ2hyb21lLCB3ZSdsbCBqdXN0IGRldGVjdCB0aGlzIGNhc2Vcblx0Ly8gZXhwbGljaXRseVxuXHRpZiAodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgJiYgd2luZG93LnByb2Nlc3MgJiYgKHdpbmRvdy5wcm9jZXNzLnR5cGUgPT09ICdyZW5kZXJlcicgfHwgd2luZG93LnByb2Nlc3MuX19ud2pzKSkge1xuXHRcdHJldHVybiB0cnVlO1xuXHR9XG5cblx0Ly8gSW50ZXJuZXQgRXhwbG9yZXIgYW5kIEVkZ2UgZG8gbm90IHN1cHBvcnQgY29sb3JzLlxuXHRpZiAodHlwZW9mIG5hdmlnYXRvciAhPT0gJ3VuZGVmaW5lZCcgJiYgbmF2aWdhdG9yLnVzZXJBZ2VudCAmJiBuYXZpZ2F0b3IudXNlckFnZW50LnRvTG93ZXJDYXNlKCkubWF0Y2goLyhlZGdlfHRyaWRlbnQpXFwvKFxcZCspLykpIHtcblx0XHRyZXR1cm4gZmFsc2U7XG5cdH1cblxuXHQvLyBJcyB3ZWJraXQ/IGh0dHA6Ly9zdGFja292ZXJmbG93LmNvbS9hLzE2NDU5NjA2LzM3Njc3M1xuXHQvLyBkb2N1bWVudCBpcyB1bmRlZmluZWQgaW4gcmVhY3QtbmF0aXZlOiBodHRwczovL2dpdGh1Yi5jb20vZmFjZWJvb2svcmVhY3QtbmF0aXZlL3B1bGwvMTYzMlxuXHRyZXR1cm4gKHR5cGVvZiBkb2N1bWVudCAhPT0gJ3VuZGVmaW5lZCcgJiYgZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50ICYmIGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5zdHlsZSAmJiBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuc3R5bGUuV2Via2l0QXBwZWFyYW5jZSkgfHxcblx0XHQvLyBJcyBmaXJlYnVnPyBodHRwOi8vc3RhY2tvdmVyZmxvdy5jb20vYS8zOTgxMjAvMzc2NzczXG5cdFx0KHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnICYmIHdpbmRvdy5jb25zb2xlICYmICh3aW5kb3cuY29uc29sZS5maXJlYnVnIHx8ICh3aW5kb3cuY29uc29sZS5leGNlcHRpb24gJiYgd2luZG93LmNvbnNvbGUudGFibGUpKSkgfHxcblx0XHQvLyBJcyBmaXJlZm94ID49IHYzMT9cblx0XHQvLyBodHRwczovL2RldmVsb3Blci5tb3ppbGxhLm9yZy9lbi1VUy9kb2NzL1Rvb2xzL1dlYl9Db25zb2xlI1N0eWxpbmdfbWVzc2FnZXNcblx0XHQodHlwZW9mIG5hdmlnYXRvciAhPT0gJ3VuZGVmaW5lZCcgJiYgbmF2aWdhdG9yLnVzZXJBZ2VudCAmJiBuYXZpZ2F0b3IudXNlckFnZW50LnRvTG93ZXJDYXNlKCkubWF0Y2goL2ZpcmVmb3hcXC8oXFxkKykvKSAmJiBwYXJzZUludChSZWdFeHAuJDEsIDEwKSA+PSAzMSkgfHxcblx0XHQvLyBEb3VibGUgY2hlY2sgd2Via2l0IGluIHVzZXJBZ2VudCBqdXN0IGluIGNhc2Ugd2UgYXJlIGluIGEgd29ya2VyXG5cdFx0KHR5cGVvZiBuYXZpZ2F0b3IgIT09ICd1bmRlZmluZWQnICYmIG5hdmlnYXRvci51c2VyQWdlbnQgJiYgbmF2aWdhdG9yLnVzZXJBZ2VudC50b0xvd2VyQ2FzZSgpLm1hdGNoKC9hcHBsZXdlYmtpdFxcLyhcXGQrKS8pKTtcbn1cblxuLyoqXG4gKiBDb2xvcml6ZSBsb2cgYXJndW1lbnRzIGlmIGVuYWJsZWQuXG4gKlxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5mdW5jdGlvbiBmb3JtYXRBcmdzKGFyZ3MpIHtcblx0YXJnc1swXSA9ICh0aGlzLnVzZUNvbG9ycyA/ICclYycgOiAnJykgK1xuXHRcdHRoaXMubmFtZXNwYWNlICtcblx0XHQodGhpcy51c2VDb2xvcnMgPyAnICVjJyA6ICcgJykgK1xuXHRcdGFyZ3NbMF0gK1xuXHRcdCh0aGlzLnVzZUNvbG9ycyA/ICclYyAnIDogJyAnKSArXG5cdFx0JysnICsgbW9kdWxlLmV4cG9ydHMuaHVtYW5pemUodGhpcy5kaWZmKTtcblxuXHRpZiAoIXRoaXMudXNlQ29sb3JzKSB7XG5cdFx0cmV0dXJuO1xuXHR9XG5cblx0Y29uc3QgYyA9ICdjb2xvcjogJyArIHRoaXMuY29sb3I7XG5cdGFyZ3Muc3BsaWNlKDEsIDAsIGMsICdjb2xvcjogaW5oZXJpdCcpO1xuXG5cdC8vIFRoZSBmaW5hbCBcIiVjXCIgaXMgc29tZXdoYXQgdHJpY2t5LCBiZWNhdXNlIHRoZXJlIGNvdWxkIGJlIG90aGVyXG5cdC8vIGFyZ3VtZW50cyBwYXNzZWQgZWl0aGVyIGJlZm9yZSBvciBhZnRlciB0aGUgJWMsIHNvIHdlIG5lZWQgdG9cblx0Ly8gZmlndXJlIG91dCB0aGUgY29ycmVjdCBpbmRleCB0byBpbnNlcnQgdGhlIENTUyBpbnRvXG5cdGxldCBpbmRleCA9IDA7XG5cdGxldCBsYXN0QyA9IDA7XG5cdGFyZ3NbMF0ucmVwbGFjZSgvJVthLXpBLVolXS9nLCBtYXRjaCA9PiB7XG5cdFx0aWYgKG1hdGNoID09PSAnJSUnKSB7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdGluZGV4Kys7XG5cdFx0aWYgKG1hdGNoID09PSAnJWMnKSB7XG5cdFx0XHQvLyBXZSBvbmx5IGFyZSBpbnRlcmVzdGVkIGluIHRoZSAqbGFzdCogJWNcblx0XHRcdC8vICh0aGUgdXNlciBtYXkgaGF2ZSBwcm92aWRlZCB0aGVpciBvd24pXG5cdFx0XHRsYXN0QyA9IGluZGV4O1xuXHRcdH1cblx0fSk7XG5cblx0YXJncy5zcGxpY2UobGFzdEMsIDAsIGMpO1xufVxuXG4vKipcbiAqIEludm9rZXMgYGNvbnNvbGUuZGVidWcoKWAgd2hlbiBhdmFpbGFibGUuXG4gKiBOby1vcCB3aGVuIGBjb25zb2xlLmRlYnVnYCBpcyBub3QgYSBcImZ1bmN0aW9uXCIuXG4gKiBJZiBgY29uc29sZS5kZWJ1Z2AgaXMgbm90IGF2YWlsYWJsZSwgZmFsbHMgYmFja1xuICogdG8gYGNvbnNvbGUubG9nYC5cbiAqXG4gKiBAYXBpIHB1YmxpY1xuICovXG5leHBvcnRzLmxvZyA9IGNvbnNvbGUuZGVidWcgfHwgY29uc29sZS5sb2cgfHwgKCgpID0+IHt9KTtcblxuLyoqXG4gKiBTYXZlIGBuYW1lc3BhY2VzYC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gbmFtZXNwYWNlc1xuICogQGFwaSBwcml2YXRlXG4gKi9cbmZ1bmN0aW9uIHNhdmUobmFtZXNwYWNlcykge1xuXHR0cnkge1xuXHRcdGlmIChuYW1lc3BhY2VzKSB7XG5cdFx0XHRleHBvcnRzLnN0b3JhZ2Uuc2V0SXRlbSgnZGVidWcnLCBuYW1lc3BhY2VzKTtcblx0XHR9IGVsc2Uge1xuXHRcdFx0ZXhwb3J0cy5zdG9yYWdlLnJlbW92ZUl0ZW0oJ2RlYnVnJyk7XG5cdFx0fVxuXHR9IGNhdGNoIChlcnJvcikge1xuXHRcdC8vIFN3YWxsb3dcblx0XHQvLyBYWFggKEBRaXgtKSBzaG91bGQgd2UgYmUgbG9nZ2luZyB0aGVzZT9cblx0fVxufVxuXG4vKipcbiAqIExvYWQgYG5hbWVzcGFjZXNgLlxuICpcbiAqIEByZXR1cm4ge1N0cmluZ30gcmV0dXJucyB0aGUgcHJldmlvdXNseSBwZXJzaXN0ZWQgZGVidWcgbW9kZXNcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5mdW5jdGlvbiBsb2FkKCkge1xuXHRsZXQgcjtcblx0dHJ5IHtcblx0XHRyID0gZXhwb3J0cy5zdG9yYWdlLmdldEl0ZW0oJ2RlYnVnJyk7XG5cdH0gY2F0Y2ggKGVycm9yKSB7XG5cdFx0Ly8gU3dhbGxvd1xuXHRcdC8vIFhYWCAoQFFpeC0pIHNob3VsZCB3ZSBiZSBsb2dnaW5nIHRoZXNlP1xuXHR9XG5cblx0Ly8gSWYgZGVidWcgaXNuJ3Qgc2V0IGluIExTLCBhbmQgd2UncmUgaW4gRWxlY3Ryb24sIHRyeSB0byBsb2FkICRERUJVR1xuXHRpZiAoIXIgJiYgdHlwZW9mIHByb2Nlc3MgIT09ICd1bmRlZmluZWQnICYmICdlbnYnIGluIHByb2Nlc3MpIHtcblx0XHRyID0gcHJvY2Vzcy5lbnYuREVCVUc7XG5cdH1cblxuXHRyZXR1cm4gcjtcbn1cblxuLyoqXG4gKiBMb2NhbHN0b3JhZ2UgYXR0ZW1wdHMgdG8gcmV0dXJuIHRoZSBsb2NhbHN0b3JhZ2UuXG4gKlxuICogVGhpcyBpcyBuZWNlc3NhcnkgYmVjYXVzZSBzYWZhcmkgdGhyb3dzXG4gKiB3aGVuIGEgdXNlciBkaXNhYmxlcyBjb29raWVzL2xvY2Fsc3RvcmFnZVxuICogYW5kIHlvdSBhdHRlbXB0IHRvIGFjY2VzcyBpdC5cbiAqXG4gKiBAcmV0dXJuIHtMb2NhbFN0b3JhZ2V9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBsb2NhbHN0b3JhZ2UoKSB7XG5cdHRyeSB7XG5cdFx0Ly8gVFZNTEtpdCAoQXBwbGUgVFYgSlMgUnVudGltZSkgZG9lcyBub3QgaGF2ZSBhIHdpbmRvdyBvYmplY3QsIGp1c3QgbG9jYWxTdG9yYWdlIGluIHRoZSBnbG9iYWwgY29udGV4dFxuXHRcdC8vIFRoZSBCcm93c2VyIGFsc28gaGFzIGxvY2FsU3RvcmFnZSBpbiB0aGUgZ2xvYmFsIGNvbnRleHQuXG5cdFx0cmV0dXJuIGxvY2FsU3RvcmFnZTtcblx0fSBjYXRjaCAoZXJyb3IpIHtcblx0XHQvLyBTd2FsbG93XG5cdFx0Ly8gWFhYIChAUWl4LSkgc2hvdWxkIHdlIGJlIGxvZ2dpbmcgdGhlc2U/XG5cdH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL2NvbW1vbicpKGV4cG9ydHMpO1xuXG5jb25zdCB7Zm9ybWF0dGVyc30gPSBtb2R1bGUuZXhwb3J0cztcblxuLyoqXG4gKiBNYXAgJWogdG8gYEpTT04uc3RyaW5naWZ5KClgLCBzaW5jZSBubyBXZWIgSW5zcGVjdG9ycyBkbyB0aGF0IGJ5IGRlZmF1bHQuXG4gKi9cblxuZm9ybWF0dGVycy5qID0gZnVuY3Rpb24gKHYpIHtcblx0dHJ5IHtcblx0XHRyZXR1cm4gSlNPTi5zdHJpbmdpZnkodik7XG5cdH0gY2F0Y2ggKGVycm9yKSB7XG5cdFx0cmV0dXJuICdbVW5leHBlY3RlZEpTT05QYXJzZUVycm9yXTogJyArIGVycm9yLm1lc3NhZ2U7XG5cdH1cbn07XG4iLCJcbi8qKlxuICogVGhpcyBpcyB0aGUgY29tbW9uIGxvZ2ljIGZvciBib3RoIHRoZSBOb2RlLmpzIGFuZCB3ZWIgYnJvd3NlclxuICogaW1wbGVtZW50YXRpb25zIG9mIGBkZWJ1ZygpYC5cbiAqL1xuXG5mdW5jdGlvbiBzZXR1cChlbnYpIHtcblx0Y3JlYXRlRGVidWcuZGVidWcgPSBjcmVhdGVEZWJ1Zztcblx0Y3JlYXRlRGVidWcuZGVmYXVsdCA9IGNyZWF0ZURlYnVnO1xuXHRjcmVhdGVEZWJ1Zy5jb2VyY2UgPSBjb2VyY2U7XG5cdGNyZWF0ZURlYnVnLmRpc2FibGUgPSBkaXNhYmxlO1xuXHRjcmVhdGVEZWJ1Zy5lbmFibGUgPSBlbmFibGU7XG5cdGNyZWF0ZURlYnVnLmVuYWJsZWQgPSBlbmFibGVkO1xuXHRjcmVhdGVEZWJ1Zy5odW1hbml6ZSA9IHJlcXVpcmUoJ21zJyk7XG5cdGNyZWF0ZURlYnVnLmRlc3Ryb3kgPSBkZXN0cm95O1xuXG5cdE9iamVjdC5rZXlzKGVudikuZm9yRWFjaChrZXkgPT4ge1xuXHRcdGNyZWF0ZURlYnVnW2tleV0gPSBlbnZba2V5XTtcblx0fSk7XG5cblx0LyoqXG5cdCogVGhlIGN1cnJlbnRseSBhY3RpdmUgZGVidWcgbW9kZSBuYW1lcywgYW5kIG5hbWVzIHRvIHNraXAuXG5cdCovXG5cblx0Y3JlYXRlRGVidWcubmFtZXMgPSBbXTtcblx0Y3JlYXRlRGVidWcuc2tpcHMgPSBbXTtcblxuXHQvKipcblx0KiBNYXAgb2Ygc3BlY2lhbCBcIiVuXCIgaGFuZGxpbmcgZnVuY3Rpb25zLCBmb3IgdGhlIGRlYnVnIFwiZm9ybWF0XCIgYXJndW1lbnQuXG5cdCpcblx0KiBWYWxpZCBrZXkgbmFtZXMgYXJlIGEgc2luZ2xlLCBsb3dlciBvciB1cHBlci1jYXNlIGxldHRlciwgaS5lLiBcIm5cIiBhbmQgXCJOXCIuXG5cdCovXG5cdGNyZWF0ZURlYnVnLmZvcm1hdHRlcnMgPSB7fTtcblxuXHQvKipcblx0KiBTZWxlY3RzIGEgY29sb3IgZm9yIGEgZGVidWcgbmFtZXNwYWNlXG5cdCogQHBhcmFtIHtTdHJpbmd9IG5hbWVzcGFjZSBUaGUgbmFtZXNwYWNlIHN0cmluZyBmb3IgdGhlIGRlYnVnIGluc3RhbmNlIHRvIGJlIGNvbG9yZWRcblx0KiBAcmV0dXJuIHtOdW1iZXJ8U3RyaW5nfSBBbiBBTlNJIGNvbG9yIGNvZGUgZm9yIHRoZSBnaXZlbiBuYW1lc3BhY2Vcblx0KiBAYXBpIHByaXZhdGVcblx0Ki9cblx0ZnVuY3Rpb24gc2VsZWN0Q29sb3IobmFtZXNwYWNlKSB7XG5cdFx0bGV0IGhhc2ggPSAwO1xuXG5cdFx0Zm9yIChsZXQgaSA9IDA7IGkgPCBuYW1lc3BhY2UubGVuZ3RoOyBpKyspIHtcblx0XHRcdGhhc2ggPSAoKGhhc2ggPDwgNSkgLSBoYXNoKSArIG5hbWVzcGFjZS5jaGFyQ29kZUF0KGkpO1xuXHRcdFx0aGFzaCB8PSAwOyAvLyBDb252ZXJ0IHRvIDMyYml0IGludGVnZXJcblx0XHR9XG5cblx0XHRyZXR1cm4gY3JlYXRlRGVidWcuY29sb3JzW01hdGguYWJzKGhhc2gpICUgY3JlYXRlRGVidWcuY29sb3JzLmxlbmd0aF07XG5cdH1cblx0Y3JlYXRlRGVidWcuc2VsZWN0Q29sb3IgPSBzZWxlY3RDb2xvcjtcblxuXHQvKipcblx0KiBDcmVhdGUgYSBkZWJ1Z2dlciB3aXRoIHRoZSBnaXZlbiBgbmFtZXNwYWNlYC5cblx0KlxuXHQqIEBwYXJhbSB7U3RyaW5nfSBuYW1lc3BhY2Vcblx0KiBAcmV0dXJuIHtGdW5jdGlvbn1cblx0KiBAYXBpIHB1YmxpY1xuXHQqL1xuXHRmdW5jdGlvbiBjcmVhdGVEZWJ1ZyhuYW1lc3BhY2UpIHtcblx0XHRsZXQgcHJldlRpbWU7XG5cdFx0bGV0IGVuYWJsZU92ZXJyaWRlID0gbnVsbDtcblx0XHRsZXQgbmFtZXNwYWNlc0NhY2hlO1xuXHRcdGxldCBlbmFibGVkQ2FjaGU7XG5cblx0XHRmdW5jdGlvbiBkZWJ1ZyguLi5hcmdzKSB7XG5cdFx0XHQvLyBEaXNhYmxlZD9cblx0XHRcdGlmICghZGVidWcuZW5hYmxlZCkge1xuXHRcdFx0XHRyZXR1cm47XG5cdFx0XHR9XG5cblx0XHRcdGNvbnN0IHNlbGYgPSBkZWJ1ZztcblxuXHRcdFx0Ly8gU2V0IGBkaWZmYCB0aW1lc3RhbXBcblx0XHRcdGNvbnN0IGN1cnIgPSBOdW1iZXIobmV3IERhdGUoKSk7XG5cdFx0XHRjb25zdCBtcyA9IGN1cnIgLSAocHJldlRpbWUgfHwgY3Vycik7XG5cdFx0XHRzZWxmLmRpZmYgPSBtcztcblx0XHRcdHNlbGYucHJldiA9IHByZXZUaW1lO1xuXHRcdFx0c2VsZi5jdXJyID0gY3Vycjtcblx0XHRcdHByZXZUaW1lID0gY3VycjtcblxuXHRcdFx0YXJnc1swXSA9IGNyZWF0ZURlYnVnLmNvZXJjZShhcmdzWzBdKTtcblxuXHRcdFx0aWYgKHR5cGVvZiBhcmdzWzBdICE9PSAnc3RyaW5nJykge1xuXHRcdFx0XHQvLyBBbnl0aGluZyBlbHNlIGxldCdzIGluc3BlY3Qgd2l0aCAlT1xuXHRcdFx0XHRhcmdzLnVuc2hpZnQoJyVPJyk7XG5cdFx0XHR9XG5cblx0XHRcdC8vIEFwcGx5IGFueSBgZm9ybWF0dGVyc2AgdHJhbnNmb3JtYXRpb25zXG5cdFx0XHRsZXQgaW5kZXggPSAwO1xuXHRcdFx0YXJnc1swXSA9IGFyZ3NbMF0ucmVwbGFjZSgvJShbYS16QS1aJV0pL2csIChtYXRjaCwgZm9ybWF0KSA9PiB7XG5cdFx0XHRcdC8vIElmIHdlIGVuY291bnRlciBhbiBlc2NhcGVkICUgdGhlbiBkb24ndCBpbmNyZWFzZSB0aGUgYXJyYXkgaW5kZXhcblx0XHRcdFx0aWYgKG1hdGNoID09PSAnJSUnKSB7XG5cdFx0XHRcdFx0cmV0dXJuICclJztcblx0XHRcdFx0fVxuXHRcdFx0XHRpbmRleCsrO1xuXHRcdFx0XHRjb25zdCBmb3JtYXR0ZXIgPSBjcmVhdGVEZWJ1Zy5mb3JtYXR0ZXJzW2Zvcm1hdF07XG5cdFx0XHRcdGlmICh0eXBlb2YgZm9ybWF0dGVyID09PSAnZnVuY3Rpb24nKSB7XG5cdFx0XHRcdFx0Y29uc3QgdmFsID0gYXJnc1tpbmRleF07XG5cdFx0XHRcdFx0bWF0Y2ggPSBmb3JtYXR0ZXIuY2FsbChzZWxmLCB2YWwpO1xuXG5cdFx0XHRcdFx0Ly8gTm93IHdlIG5lZWQgdG8gcmVtb3ZlIGBhcmdzW2luZGV4XWAgc2luY2UgaXQncyBpbmxpbmVkIGluIHRoZSBgZm9ybWF0YFxuXHRcdFx0XHRcdGFyZ3Muc3BsaWNlKGluZGV4LCAxKTtcblx0XHRcdFx0XHRpbmRleC0tO1xuXHRcdFx0XHR9XG5cdFx0XHRcdHJldHVybiBtYXRjaDtcblx0XHRcdH0pO1xuXG5cdFx0XHQvLyBBcHBseSBlbnYtc3BlY2lmaWMgZm9ybWF0dGluZyAoY29sb3JzLCBldGMuKVxuXHRcdFx0Y3JlYXRlRGVidWcuZm9ybWF0QXJncy5jYWxsKHNlbGYsIGFyZ3MpO1xuXG5cdFx0XHRjb25zdCBsb2dGbiA9IHNlbGYubG9nIHx8IGNyZWF0ZURlYnVnLmxvZztcblx0XHRcdGxvZ0ZuLmFwcGx5KHNlbGYsIGFyZ3MpO1xuXHRcdH1cblxuXHRcdGRlYnVnLm5hbWVzcGFjZSA9IG5hbWVzcGFjZTtcblx0XHRkZWJ1Zy51c2VDb2xvcnMgPSBjcmVhdGVEZWJ1Zy51c2VDb2xvcnMoKTtcblx0XHRkZWJ1Zy5jb2xvciA9IGNyZWF0ZURlYnVnLnNlbGVjdENvbG9yKG5hbWVzcGFjZSk7XG5cdFx0ZGVidWcuZXh0ZW5kID0gZXh0ZW5kO1xuXHRcdGRlYnVnLmRlc3Ryb3kgPSBjcmVhdGVEZWJ1Zy5kZXN0cm95OyAvLyBYWFggVGVtcG9yYXJ5LiBXaWxsIGJlIHJlbW92ZWQgaW4gdGhlIG5leHQgbWFqb3IgcmVsZWFzZS5cblxuXHRcdE9iamVjdC5kZWZpbmVQcm9wZXJ0eShkZWJ1ZywgJ2VuYWJsZWQnLCB7XG5cdFx0XHRlbnVtZXJhYmxlOiB0cnVlLFxuXHRcdFx0Y29uZmlndXJhYmxlOiBmYWxzZSxcblx0XHRcdGdldDogKCkgPT4ge1xuXHRcdFx0XHRpZiAoZW5hYmxlT3ZlcnJpZGUgIT09IG51bGwpIHtcblx0XHRcdFx0XHRyZXR1cm4gZW5hYmxlT3ZlcnJpZGU7XG5cdFx0XHRcdH1cblx0XHRcdFx0aWYgKG5hbWVzcGFjZXNDYWNoZSAhPT0gY3JlYXRlRGVidWcubmFtZXNwYWNlcykge1xuXHRcdFx0XHRcdG5hbWVzcGFjZXNDYWNoZSA9IGNyZWF0ZURlYnVnLm5hbWVzcGFjZXM7XG5cdFx0XHRcdFx0ZW5hYmxlZENhY2hlID0gY3JlYXRlRGVidWcuZW5hYmxlZChuYW1lc3BhY2UpO1xuXHRcdFx0XHR9XG5cblx0XHRcdFx0cmV0dXJuIGVuYWJsZWRDYWNoZTtcblx0XHRcdH0sXG5cdFx0XHRzZXQ6IHYgPT4ge1xuXHRcdFx0XHRlbmFibGVPdmVycmlkZSA9IHY7XG5cdFx0XHR9XG5cdFx0fSk7XG5cblx0XHQvLyBFbnYtc3BlY2lmaWMgaW5pdGlhbGl6YXRpb24gbG9naWMgZm9yIGRlYnVnIGluc3RhbmNlc1xuXHRcdGlmICh0eXBlb2YgY3JlYXRlRGVidWcuaW5pdCA9PT0gJ2Z1bmN0aW9uJykge1xuXHRcdFx0Y3JlYXRlRGVidWcuaW5pdChkZWJ1Zyk7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIGRlYnVnO1xuXHR9XG5cblx0ZnVuY3Rpb24gZXh0ZW5kKG5hbWVzcGFjZSwgZGVsaW1pdGVyKSB7XG5cdFx0Y29uc3QgbmV3RGVidWcgPSBjcmVhdGVEZWJ1Zyh0aGlzLm5hbWVzcGFjZSArICh0eXBlb2YgZGVsaW1pdGVyID09PSAndW5kZWZpbmVkJyA/ICc6JyA6IGRlbGltaXRlcikgKyBuYW1lc3BhY2UpO1xuXHRcdG5ld0RlYnVnLmxvZyA9IHRoaXMubG9nO1xuXHRcdHJldHVybiBuZXdEZWJ1Zztcblx0fVxuXG5cdC8qKlxuXHQqIEVuYWJsZXMgYSBkZWJ1ZyBtb2RlIGJ5IG5hbWVzcGFjZXMuIFRoaXMgY2FuIGluY2x1ZGUgbW9kZXNcblx0KiBzZXBhcmF0ZWQgYnkgYSBjb2xvbiBhbmQgd2lsZGNhcmRzLlxuXHQqXG5cdCogQHBhcmFtIHtTdHJpbmd9IG5hbWVzcGFjZXNcblx0KiBAYXBpIHB1YmxpY1xuXHQqL1xuXHRmdW5jdGlvbiBlbmFibGUobmFtZXNwYWNlcykge1xuXHRcdGNyZWF0ZURlYnVnLnNhdmUobmFtZXNwYWNlcyk7XG5cdFx0Y3JlYXRlRGVidWcubmFtZXNwYWNlcyA9IG5hbWVzcGFjZXM7XG5cblx0XHRjcmVhdGVEZWJ1Zy5uYW1lcyA9IFtdO1xuXHRcdGNyZWF0ZURlYnVnLnNraXBzID0gW107XG5cblx0XHRsZXQgaTtcblx0XHRjb25zdCBzcGxpdCA9ICh0eXBlb2YgbmFtZXNwYWNlcyA9PT0gJ3N0cmluZycgPyBuYW1lc3BhY2VzIDogJycpLnNwbGl0KC9bXFxzLF0rLyk7XG5cdFx0Y29uc3QgbGVuID0gc3BsaXQubGVuZ3RoO1xuXG5cdFx0Zm9yIChpID0gMDsgaSA8IGxlbjsgaSsrKSB7XG5cdFx0XHRpZiAoIXNwbGl0W2ldKSB7XG5cdFx0XHRcdC8vIGlnbm9yZSBlbXB0eSBzdHJpbmdzXG5cdFx0XHRcdGNvbnRpbnVlO1xuXHRcdFx0fVxuXG5cdFx0XHRuYW1lc3BhY2VzID0gc3BsaXRbaV0ucmVwbGFjZSgvXFwqL2csICcuKj8nKTtcblxuXHRcdFx0aWYgKG5hbWVzcGFjZXNbMF0gPT09ICctJykge1xuXHRcdFx0XHRjcmVhdGVEZWJ1Zy5za2lwcy5wdXNoKG5ldyBSZWdFeHAoJ14nICsgbmFtZXNwYWNlcy5zbGljZSgxKSArICckJykpO1xuXHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0Y3JlYXRlRGVidWcubmFtZXMucHVzaChuZXcgUmVnRXhwKCdeJyArIG5hbWVzcGFjZXMgKyAnJCcpKTtcblx0XHRcdH1cblx0XHR9XG5cdH1cblxuXHQvKipcblx0KiBEaXNhYmxlIGRlYnVnIG91dHB1dC5cblx0KlxuXHQqIEByZXR1cm4ge1N0cmluZ30gbmFtZXNwYWNlc1xuXHQqIEBhcGkgcHVibGljXG5cdCovXG5cdGZ1bmN0aW9uIGRpc2FibGUoKSB7XG5cdFx0Y29uc3QgbmFtZXNwYWNlcyA9IFtcblx0XHRcdC4uLmNyZWF0ZURlYnVnLm5hbWVzLm1hcCh0b05hbWVzcGFjZSksXG5cdFx0XHQuLi5jcmVhdGVEZWJ1Zy5za2lwcy5tYXAodG9OYW1lc3BhY2UpLm1hcChuYW1lc3BhY2UgPT4gJy0nICsgbmFtZXNwYWNlKVxuXHRcdF0uam9pbignLCcpO1xuXHRcdGNyZWF0ZURlYnVnLmVuYWJsZSgnJyk7XG5cdFx0cmV0dXJuIG5hbWVzcGFjZXM7XG5cdH1cblxuXHQvKipcblx0KiBSZXR1cm5zIHRydWUgaWYgdGhlIGdpdmVuIG1vZGUgbmFtZSBpcyBlbmFibGVkLCBmYWxzZSBvdGhlcndpc2UuXG5cdCpcblx0KiBAcGFyYW0ge1N0cmluZ30gbmFtZVxuXHQqIEByZXR1cm4ge0Jvb2xlYW59XG5cdCogQGFwaSBwdWJsaWNcblx0Ki9cblx0ZnVuY3Rpb24gZW5hYmxlZChuYW1lKSB7XG5cdFx0aWYgKG5hbWVbbmFtZS5sZW5ndGggLSAxXSA9PT0gJyonKSB7XG5cdFx0XHRyZXR1cm4gdHJ1ZTtcblx0XHR9XG5cblx0XHRsZXQgaTtcblx0XHRsZXQgbGVuO1xuXG5cdFx0Zm9yIChpID0gMCwgbGVuID0gY3JlYXRlRGVidWcuc2tpcHMubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcblx0XHRcdGlmIChjcmVhdGVEZWJ1Zy5za2lwc1tpXS50ZXN0KG5hbWUpKSB7XG5cdFx0XHRcdHJldHVybiBmYWxzZTtcblx0XHRcdH1cblx0XHR9XG5cblx0XHRmb3IgKGkgPSAwLCBsZW4gPSBjcmVhdGVEZWJ1Zy5uYW1lcy5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuXHRcdFx0aWYgKGNyZWF0ZURlYnVnLm5hbWVzW2ldLnRlc3QobmFtZSkpIHtcblx0XHRcdFx0cmV0dXJuIHRydWU7XG5cdFx0XHR9XG5cdFx0fVxuXG5cdFx0cmV0dXJuIGZhbHNlO1xuXHR9XG5cblx0LyoqXG5cdCogQ29udmVydCByZWdleHAgdG8gbmFtZXNwYWNlXG5cdCpcblx0KiBAcGFyYW0ge1JlZ0V4cH0gcmVneGVwXG5cdCogQHJldHVybiB7U3RyaW5nfSBuYW1lc3BhY2Vcblx0KiBAYXBpIHByaXZhdGVcblx0Ki9cblx0ZnVuY3Rpb24gdG9OYW1lc3BhY2UocmVnZXhwKSB7XG5cdFx0cmV0dXJuIHJlZ2V4cC50b1N0cmluZygpXG5cdFx0XHQuc3Vic3RyaW5nKDIsIHJlZ2V4cC50b1N0cmluZygpLmxlbmd0aCAtIDIpXG5cdFx0XHQucmVwbGFjZSgvXFwuXFwqXFw/JC8sICcqJyk7XG5cdH1cblxuXHQvKipcblx0KiBDb2VyY2UgYHZhbGAuXG5cdCpcblx0KiBAcGFyYW0ge01peGVkfSB2YWxcblx0KiBAcmV0dXJuIHtNaXhlZH1cblx0KiBAYXBpIHByaXZhdGVcblx0Ki9cblx0ZnVuY3Rpb24gY29lcmNlKHZhbCkge1xuXHRcdGlmICh2YWwgaW5zdGFuY2VvZiBFcnJvcikge1xuXHRcdFx0cmV0dXJuIHZhbC5zdGFjayB8fCB2YWwubWVzc2FnZTtcblx0XHR9XG5cdFx0cmV0dXJuIHZhbDtcblx0fVxuXG5cdC8qKlxuXHQqIFhYWCBETyBOT1QgVVNFLiBUaGlzIGlzIGEgdGVtcG9yYXJ5IHN0dWIgZnVuY3Rpb24uXG5cdCogWFhYIEl0IFdJTEwgYmUgcmVtb3ZlZCBpbiB0aGUgbmV4dCBtYWpvciByZWxlYXNlLlxuXHQqL1xuXHRmdW5jdGlvbiBkZXN0cm95KCkge1xuXHRcdGNvbnNvbGUud2FybignSW5zdGFuY2UgbWV0aG9kIGBkZWJ1Zy5kZXN0cm95KClgIGlzIGRlcHJlY2F0ZWQgYW5kIG5vIGxvbmdlciBkb2VzIGFueXRoaW5nLiBJdCB3aWxsIGJlIHJlbW92ZWQgaW4gdGhlIG5leHQgbWFqb3IgdmVyc2lvbiBvZiBgZGVidWdgLicpO1xuXHR9XG5cblx0Y3JlYXRlRGVidWcuZW5hYmxlKGNyZWF0ZURlYnVnLmxvYWQoKSk7XG5cblx0cmV0dXJuIGNyZWF0ZURlYnVnO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHNldHVwO1xuIiwiLyoqXG4gKiBIZWxwZXJzLlxuICovXG5cbnZhciBzID0gMTAwMDtcbnZhciBtID0gcyAqIDYwO1xudmFyIGggPSBtICogNjA7XG52YXIgZCA9IGggKiAyNDtcbnZhciB3ID0gZCAqIDc7XG52YXIgeSA9IGQgKiAzNjUuMjU7XG5cbi8qKlxuICogUGFyc2Ugb3IgZm9ybWF0IHRoZSBnaXZlbiBgdmFsYC5cbiAqXG4gKiBPcHRpb25zOlxuICpcbiAqICAtIGBsb25nYCB2ZXJib3NlIGZvcm1hdHRpbmcgW2ZhbHNlXVxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfE51bWJlcn0gdmFsXG4gKiBAcGFyYW0ge09iamVjdH0gW29wdGlvbnNdXG4gKiBAdGhyb3dzIHtFcnJvcn0gdGhyb3cgYW4gZXJyb3IgaWYgdmFsIGlzIG5vdCBhIG5vbi1lbXB0eSBzdHJpbmcgb3IgYSBudW1iZXJcbiAqIEByZXR1cm4ge1N0cmluZ3xOdW1iZXJ9XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24odmFsLCBvcHRpb25zKSB7XG4gIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xuICB2YXIgdHlwZSA9IHR5cGVvZiB2YWw7XG4gIGlmICh0eXBlID09PSAnc3RyaW5nJyAmJiB2YWwubGVuZ3RoID4gMCkge1xuICAgIHJldHVybiBwYXJzZSh2YWwpO1xuICB9IGVsc2UgaWYgKHR5cGUgPT09ICdudW1iZXInICYmIGlzRmluaXRlKHZhbCkpIHtcbiAgICByZXR1cm4gb3B0aW9ucy5sb25nID8gZm10TG9uZyh2YWwpIDogZm10U2hvcnQodmFsKTtcbiAgfVxuICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgJ3ZhbCBpcyBub3QgYSBub24tZW1wdHkgc3RyaW5nIG9yIGEgdmFsaWQgbnVtYmVyLiB2YWw9JyArXG4gICAgICBKU09OLnN0cmluZ2lmeSh2YWwpXG4gICk7XG59O1xuXG4vKipcbiAqIFBhcnNlIHRoZSBnaXZlbiBgc3RyYCBhbmQgcmV0dXJuIG1pbGxpc2Vjb25kcy5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gc3RyXG4gKiBAcmV0dXJuIHtOdW1iZXJ9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBwYXJzZShzdHIpIHtcbiAgc3RyID0gU3RyaW5nKHN0cik7XG4gIGlmIChzdHIubGVuZ3RoID4gMTAwKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIHZhciBtYXRjaCA9IC9eKC0/KD86XFxkKyk/XFwuP1xcZCspICoobWlsbGlzZWNvbmRzP3xtc2Vjcz98bXN8c2Vjb25kcz98c2Vjcz98c3xtaW51dGVzP3xtaW5zP3xtfGhvdXJzP3xocnM/fGh8ZGF5cz98ZHx3ZWVrcz98d3x5ZWFycz98eXJzP3x5KT8kL2kuZXhlYyhcbiAgICBzdHJcbiAgKTtcbiAgaWYgKCFtYXRjaCkge1xuICAgIHJldHVybjtcbiAgfVxuICB2YXIgbiA9IHBhcnNlRmxvYXQobWF0Y2hbMV0pO1xuICB2YXIgdHlwZSA9IChtYXRjaFsyXSB8fCAnbXMnKS50b0xvd2VyQ2FzZSgpO1xuICBzd2l0Y2ggKHR5cGUpIHtcbiAgICBjYXNlICd5ZWFycyc6XG4gICAgY2FzZSAneWVhcic6XG4gICAgY2FzZSAneXJzJzpcbiAgICBjYXNlICd5cic6XG4gICAgY2FzZSAneSc6XG4gICAgICByZXR1cm4gbiAqIHk7XG4gICAgY2FzZSAnd2Vla3MnOlxuICAgIGNhc2UgJ3dlZWsnOlxuICAgIGNhc2UgJ3cnOlxuICAgICAgcmV0dXJuIG4gKiB3O1xuICAgIGNhc2UgJ2RheXMnOlxuICAgIGNhc2UgJ2RheSc6XG4gICAgY2FzZSAnZCc6XG4gICAgICByZXR1cm4gbiAqIGQ7XG4gICAgY2FzZSAnaG91cnMnOlxuICAgIGNhc2UgJ2hvdXInOlxuICAgIGNhc2UgJ2hycyc6XG4gICAgY2FzZSAnaHInOlxuICAgIGNhc2UgJ2gnOlxuICAgICAgcmV0dXJuIG4gKiBoO1xuICAgIGNhc2UgJ21pbnV0ZXMnOlxuICAgIGNhc2UgJ21pbnV0ZSc6XG4gICAgY2FzZSAnbWlucyc6XG4gICAgY2FzZSAnbWluJzpcbiAgICBjYXNlICdtJzpcbiAgICAgIHJldHVybiBuICogbTtcbiAgICBjYXNlICdzZWNvbmRzJzpcbiAgICBjYXNlICdzZWNvbmQnOlxuICAgIGNhc2UgJ3NlY3MnOlxuICAgIGNhc2UgJ3NlYyc6XG4gICAgY2FzZSAncyc6XG4gICAgICByZXR1cm4gbiAqIHM7XG4gICAgY2FzZSAnbWlsbGlzZWNvbmRzJzpcbiAgICBjYXNlICdtaWxsaXNlY29uZCc6XG4gICAgY2FzZSAnbXNlY3MnOlxuICAgIGNhc2UgJ21zZWMnOlxuICAgIGNhc2UgJ21zJzpcbiAgICAgIHJldHVybiBuO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG59XG5cbi8qKlxuICogU2hvcnQgZm9ybWF0IGZvciBgbXNgLlxuICpcbiAqIEBwYXJhbSB7TnVtYmVyfSBtc1xuICogQHJldHVybiB7U3RyaW5nfVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gZm10U2hvcnQobXMpIHtcbiAgdmFyIG1zQWJzID0gTWF0aC5hYnMobXMpO1xuICBpZiAobXNBYnMgPj0gZCkge1xuICAgIHJldHVybiBNYXRoLnJvdW5kKG1zIC8gZCkgKyAnZCc7XG4gIH1cbiAgaWYgKG1zQWJzID49IGgpIHtcbiAgICByZXR1cm4gTWF0aC5yb3VuZChtcyAvIGgpICsgJ2gnO1xuICB9XG4gIGlmIChtc0FicyA+PSBtKSB7XG4gICAgcmV0dXJuIE1hdGgucm91bmQobXMgLyBtKSArICdtJztcbiAgfVxuICBpZiAobXNBYnMgPj0gcykge1xuICAgIHJldHVybiBNYXRoLnJvdW5kKG1zIC8gcykgKyAncyc7XG4gIH1cbiAgcmV0dXJuIG1zICsgJ21zJztcbn1cblxuLyoqXG4gKiBMb25nIGZvcm1hdCBmb3IgYG1zYC5cbiAqXG4gKiBAcGFyYW0ge051bWJlcn0gbXNcbiAqIEByZXR1cm4ge1N0cmluZ31cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIGZtdExvbmcobXMpIHtcbiAgdmFyIG1zQWJzID0gTWF0aC5hYnMobXMpO1xuICBpZiAobXNBYnMgPj0gZCkge1xuICAgIHJldHVybiBwbHVyYWwobXMsIG1zQWJzLCBkLCAnZGF5Jyk7XG4gIH1cbiAgaWYgKG1zQWJzID49IGgpIHtcbiAgICByZXR1cm4gcGx1cmFsKG1zLCBtc0FicywgaCwgJ2hvdXInKTtcbiAgfVxuICBpZiAobXNBYnMgPj0gbSkge1xuICAgIHJldHVybiBwbHVyYWwobXMsIG1zQWJzLCBtLCAnbWludXRlJyk7XG4gIH1cbiAgaWYgKG1zQWJzID49IHMpIHtcbiAgICByZXR1cm4gcGx1cmFsKG1zLCBtc0FicywgcywgJ3NlY29uZCcpO1xuICB9XG4gIHJldHVybiBtcyArICcgbXMnO1xufVxuXG4vKipcbiAqIFBsdXJhbGl6YXRpb24gaGVscGVyLlxuICovXG5cbmZ1bmN0aW9uIHBsdXJhbChtcywgbXNBYnMsIG4sIG5hbWUpIHtcbiAgdmFyIGlzUGx1cmFsID0gbXNBYnMgPj0gbiAqIDEuNTtcbiAgcmV0dXJuIE1hdGgucm91bmQobXMgLyBuKSArICcgJyArIG5hbWUgKyAoaXNQbHVyYWwgPyAncycgOiAnJyk7XG59XG4iLCIvKiBlc2xpbnQtZW52IG5vZGUgKi9cbid1c2Ugc3RyaWN0JztcblxuLy8gU0RQIGhlbHBlcnMuXG5jb25zdCBTRFBVdGlscyA9IHt9O1xuXG4vLyBHZW5lcmF0ZSBhbiBhbHBoYW51bWVyaWMgaWRlbnRpZmllciBmb3IgY25hbWUgb3IgbWlkcy5cbi8vIFRPRE86IHVzZSBVVUlEcyBpbnN0ZWFkPyBodHRwczovL2dpc3QuZ2l0aHViLmNvbS9qZWQvOTgyODgzXG5TRFBVdGlscy5nZW5lcmF0ZUlkZW50aWZpZXIgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIE1hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnN1YnN0cmluZygyLCAxMik7XG59O1xuXG4vLyBUaGUgUlRDUCBDTkFNRSB1c2VkIGJ5IGFsbCBwZWVyY29ubmVjdGlvbnMgZnJvbSB0aGUgc2FtZSBKUy5cblNEUFV0aWxzLmxvY2FsQ05hbWUgPSBTRFBVdGlscy5nZW5lcmF0ZUlkZW50aWZpZXIoKTtcblxuLy8gU3BsaXRzIFNEUCBpbnRvIGxpbmVzLCBkZWFsaW5nIHdpdGggYm90aCBDUkxGIGFuZCBMRi5cblNEUFV0aWxzLnNwbGl0TGluZXMgPSBmdW5jdGlvbihibG9iKSB7XG4gIHJldHVybiBibG9iLnRyaW0oKS5zcGxpdCgnXFxuJykubWFwKGxpbmUgPT4gbGluZS50cmltKCkpO1xufTtcbi8vIFNwbGl0cyBTRFAgaW50byBzZXNzaW9ucGFydCBhbmQgbWVkaWFzZWN0aW9ucy4gRW5zdXJlcyBDUkxGLlxuU0RQVXRpbHMuc3BsaXRTZWN0aW9ucyA9IGZ1bmN0aW9uKGJsb2IpIHtcbiAgY29uc3QgcGFydHMgPSBibG9iLnNwbGl0KCdcXG5tPScpO1xuICByZXR1cm4gcGFydHMubWFwKChwYXJ0LCBpbmRleCkgPT4gKGluZGV4ID4gMCA/XG4gICAgJ209JyArIHBhcnQgOiBwYXJ0KS50cmltKCkgKyAnXFxyXFxuJyk7XG59O1xuXG4vLyBSZXR1cm5zIHRoZSBzZXNzaW9uIGRlc2NyaXB0aW9uLlxuU0RQVXRpbHMuZ2V0RGVzY3JpcHRpb24gPSBmdW5jdGlvbihibG9iKSB7XG4gIGNvbnN0IHNlY3Rpb25zID0gU0RQVXRpbHMuc3BsaXRTZWN0aW9ucyhibG9iKTtcbiAgcmV0dXJuIHNlY3Rpb25zICYmIHNlY3Rpb25zWzBdO1xufTtcblxuLy8gUmV0dXJucyB0aGUgaW5kaXZpZHVhbCBtZWRpYSBzZWN0aW9ucy5cblNEUFV0aWxzLmdldE1lZGlhU2VjdGlvbnMgPSBmdW5jdGlvbihibG9iKSB7XG4gIGNvbnN0IHNlY3Rpb25zID0gU0RQVXRpbHMuc3BsaXRTZWN0aW9ucyhibG9iKTtcbiAgc2VjdGlvbnMuc2hpZnQoKTtcbiAgcmV0dXJuIHNlY3Rpb25zO1xufTtcblxuLy8gUmV0dXJucyBsaW5lcyB0aGF0IHN0YXJ0IHdpdGggYSBjZXJ0YWluIHByZWZpeC5cblNEUFV0aWxzLm1hdGNoUHJlZml4ID0gZnVuY3Rpb24oYmxvYiwgcHJlZml4KSB7XG4gIHJldHVybiBTRFBVdGlscy5zcGxpdExpbmVzKGJsb2IpLmZpbHRlcihsaW5lID0+IGxpbmUuaW5kZXhPZihwcmVmaXgpID09PSAwKTtcbn07XG5cbi8vIFBhcnNlcyBhbiBJQ0UgY2FuZGlkYXRlIGxpbmUuIFNhbXBsZSBpbnB1dDpcbi8vIGNhbmRpZGF0ZTo3MDI3ODYzNTAgMiB1ZHAgNDE4MTk5MDIgOC44LjguOCA2MDc2OSB0eXAgcmVsYXkgcmFkZHIgOC44LjguOFxuLy8gcnBvcnQgNTU5OTZcIlxuLy8gSW5wdXQgY2FuIGJlIHByZWZpeGVkIHdpdGggYT0uXG5TRFBVdGlscy5wYXJzZUNhbmRpZGF0ZSA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgbGV0IHBhcnRzO1xuICAvLyBQYXJzZSBib3RoIHZhcmlhbnRzLlxuICBpZiAobGluZS5pbmRleE9mKCdhPWNhbmRpZGF0ZTonKSA9PT0gMCkge1xuICAgIHBhcnRzID0gbGluZS5zdWJzdHJpbmcoMTIpLnNwbGl0KCcgJyk7XG4gIH0gZWxzZSB7XG4gICAgcGFydHMgPSBsaW5lLnN1YnN0cmluZygxMCkuc3BsaXQoJyAnKTtcbiAgfVxuXG4gIGNvbnN0IGNhbmRpZGF0ZSA9IHtcbiAgICBmb3VuZGF0aW9uOiBwYXJ0c1swXSxcbiAgICBjb21wb25lbnQ6IHsxOiAncnRwJywgMjogJ3J0Y3AnfVtwYXJ0c1sxXV0gfHwgcGFydHNbMV0sXG4gICAgcHJvdG9jb2w6IHBhcnRzWzJdLnRvTG93ZXJDYXNlKCksXG4gICAgcHJpb3JpdHk6IHBhcnNlSW50KHBhcnRzWzNdLCAxMCksXG4gICAgaXA6IHBhcnRzWzRdLFxuICAgIGFkZHJlc3M6IHBhcnRzWzRdLCAvLyBhZGRyZXNzIGlzIGFuIGFsaWFzIGZvciBpcC5cbiAgICBwb3J0OiBwYXJzZUludChwYXJ0c1s1XSwgMTApLFxuICAgIC8vIHNraXAgcGFydHNbNl0gPT0gJ3R5cCdcbiAgICB0eXBlOiBwYXJ0c1s3XSxcbiAgfTtcblxuICBmb3IgKGxldCBpID0gODsgaSA8IHBhcnRzLmxlbmd0aDsgaSArPSAyKSB7XG4gICAgc3dpdGNoIChwYXJ0c1tpXSkge1xuICAgICAgY2FzZSAncmFkZHInOlxuICAgICAgICBjYW5kaWRhdGUucmVsYXRlZEFkZHJlc3MgPSBwYXJ0c1tpICsgMV07XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAncnBvcnQnOlxuICAgICAgICBjYW5kaWRhdGUucmVsYXRlZFBvcnQgPSBwYXJzZUludChwYXJ0c1tpICsgMV0sIDEwKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICd0Y3B0eXBlJzpcbiAgICAgICAgY2FuZGlkYXRlLnRjcFR5cGUgPSBwYXJ0c1tpICsgMV07XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAndWZyYWcnOlxuICAgICAgICBjYW5kaWRhdGUudWZyYWcgPSBwYXJ0c1tpICsgMV07IC8vIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5LlxuICAgICAgICBjYW5kaWRhdGUudXNlcm5hbWVGcmFnbWVudCA9IHBhcnRzW2kgKyAxXTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBkZWZhdWx0OiAvLyBleHRlbnNpb24gaGFuZGxpbmcsIGluIHBhcnRpY3VsYXIgdWZyYWcuIERvbid0IG92ZXJ3cml0ZS5cbiAgICAgICAgaWYgKGNhbmRpZGF0ZVtwYXJ0c1tpXV0gPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIGNhbmRpZGF0ZVtwYXJ0c1tpXV0gPSBwYXJ0c1tpICsgMV07XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG4gIHJldHVybiBjYW5kaWRhdGU7XG59O1xuXG4vLyBUcmFuc2xhdGVzIGEgY2FuZGlkYXRlIG9iamVjdCBpbnRvIFNEUCBjYW5kaWRhdGUgYXR0cmlidXRlLlxuLy8gVGhpcyBkb2VzIG5vdCBpbmNsdWRlIHRoZSBhPSBwcmVmaXghXG5TRFBVdGlscy53cml0ZUNhbmRpZGF0ZSA9IGZ1bmN0aW9uKGNhbmRpZGF0ZSkge1xuICBjb25zdCBzZHAgPSBbXTtcbiAgc2RwLnB1c2goY2FuZGlkYXRlLmZvdW5kYXRpb24pO1xuXG4gIGNvbnN0IGNvbXBvbmVudCA9IGNhbmRpZGF0ZS5jb21wb25lbnQ7XG4gIGlmIChjb21wb25lbnQgPT09ICdydHAnKSB7XG4gICAgc2RwLnB1c2goMSk7XG4gIH0gZWxzZSBpZiAoY29tcG9uZW50ID09PSAncnRjcCcpIHtcbiAgICBzZHAucHVzaCgyKTtcbiAgfSBlbHNlIHtcbiAgICBzZHAucHVzaChjb21wb25lbnQpO1xuICB9XG4gIHNkcC5wdXNoKGNhbmRpZGF0ZS5wcm90b2NvbC50b1VwcGVyQ2FzZSgpKTtcbiAgc2RwLnB1c2goY2FuZGlkYXRlLnByaW9yaXR5KTtcbiAgc2RwLnB1c2goY2FuZGlkYXRlLmFkZHJlc3MgfHwgY2FuZGlkYXRlLmlwKTtcbiAgc2RwLnB1c2goY2FuZGlkYXRlLnBvcnQpO1xuXG4gIGNvbnN0IHR5cGUgPSBjYW5kaWRhdGUudHlwZTtcbiAgc2RwLnB1c2goJ3R5cCcpO1xuICBzZHAucHVzaCh0eXBlKTtcbiAgaWYgKHR5cGUgIT09ICdob3N0JyAmJiBjYW5kaWRhdGUucmVsYXRlZEFkZHJlc3MgJiZcbiAgICAgIGNhbmRpZGF0ZS5yZWxhdGVkUG9ydCkge1xuICAgIHNkcC5wdXNoKCdyYWRkcicpO1xuICAgIHNkcC5wdXNoKGNhbmRpZGF0ZS5yZWxhdGVkQWRkcmVzcyk7XG4gICAgc2RwLnB1c2goJ3Jwb3J0Jyk7XG4gICAgc2RwLnB1c2goY2FuZGlkYXRlLnJlbGF0ZWRQb3J0KTtcbiAgfVxuICBpZiAoY2FuZGlkYXRlLnRjcFR5cGUgJiYgY2FuZGlkYXRlLnByb3RvY29sLnRvTG93ZXJDYXNlKCkgPT09ICd0Y3AnKSB7XG4gICAgc2RwLnB1c2goJ3RjcHR5cGUnKTtcbiAgICBzZHAucHVzaChjYW5kaWRhdGUudGNwVHlwZSk7XG4gIH1cbiAgaWYgKGNhbmRpZGF0ZS51c2VybmFtZUZyYWdtZW50IHx8IGNhbmRpZGF0ZS51ZnJhZykge1xuICAgIHNkcC5wdXNoKCd1ZnJhZycpO1xuICAgIHNkcC5wdXNoKGNhbmRpZGF0ZS51c2VybmFtZUZyYWdtZW50IHx8IGNhbmRpZGF0ZS51ZnJhZyk7XG4gIH1cbiAgcmV0dXJuICdjYW5kaWRhdGU6JyArIHNkcC5qb2luKCcgJyk7XG59O1xuXG4vLyBQYXJzZXMgYW4gaWNlLW9wdGlvbnMgbGluZSwgcmV0dXJucyBhbiBhcnJheSBvZiBvcHRpb24gdGFncy5cbi8vIFNhbXBsZSBpbnB1dDpcbi8vIGE9aWNlLW9wdGlvbnM6Zm9vIGJhclxuU0RQVXRpbHMucGFyc2VJY2VPcHRpb25zID0gZnVuY3Rpb24obGluZSkge1xuICByZXR1cm4gbGluZS5zdWJzdHJpbmcoMTQpLnNwbGl0KCcgJyk7XG59O1xuXG4vLyBQYXJzZXMgYSBydHBtYXAgbGluZSwgcmV0dXJucyBSVENSdHBDb2RkZWNQYXJhbWV0ZXJzLiBTYW1wbGUgaW5wdXQ6XG4vLyBhPXJ0cG1hcDoxMTEgb3B1cy80ODAwMC8yXG5TRFBVdGlscy5wYXJzZVJ0cE1hcCA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgbGV0IHBhcnRzID0gbGluZS5zdWJzdHJpbmcoOSkuc3BsaXQoJyAnKTtcbiAgY29uc3QgcGFyc2VkID0ge1xuICAgIHBheWxvYWRUeXBlOiBwYXJzZUludChwYXJ0cy5zaGlmdCgpLCAxMCksIC8vIHdhczogaWRcbiAgfTtcblxuICBwYXJ0cyA9IHBhcnRzWzBdLnNwbGl0KCcvJyk7XG5cbiAgcGFyc2VkLm5hbWUgPSBwYXJ0c1swXTtcbiAgcGFyc2VkLmNsb2NrUmF0ZSA9IHBhcnNlSW50KHBhcnRzWzFdLCAxMCk7IC8vIHdhczogY2xvY2tyYXRlXG4gIHBhcnNlZC5jaGFubmVscyA9IHBhcnRzLmxlbmd0aCA9PT0gMyA/IHBhcnNlSW50KHBhcnRzWzJdLCAxMCkgOiAxO1xuICAvLyBsZWdhY3kgYWxpYXMsIGdvdCByZW5hbWVkIGJhY2sgdG8gY2hhbm5lbHMgaW4gT1JUQy5cbiAgcGFyc2VkLm51bUNoYW5uZWxzID0gcGFyc2VkLmNoYW5uZWxzO1xuICByZXR1cm4gcGFyc2VkO1xufTtcblxuLy8gR2VuZXJhdGVzIGEgcnRwbWFwIGxpbmUgZnJvbSBSVENSdHBDb2RlY0NhcGFiaWxpdHkgb3Jcbi8vIFJUQ1J0cENvZGVjUGFyYW1ldGVycy5cblNEUFV0aWxzLndyaXRlUnRwTWFwID0gZnVuY3Rpb24oY29kZWMpIHtcbiAgbGV0IHB0ID0gY29kZWMucGF5bG9hZFR5cGU7XG4gIGlmIChjb2RlYy5wcmVmZXJyZWRQYXlsb2FkVHlwZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgcHQgPSBjb2RlYy5wcmVmZXJyZWRQYXlsb2FkVHlwZTtcbiAgfVxuICBjb25zdCBjaGFubmVscyA9IGNvZGVjLmNoYW5uZWxzIHx8IGNvZGVjLm51bUNoYW5uZWxzIHx8IDE7XG4gIHJldHVybiAnYT1ydHBtYXA6JyArIHB0ICsgJyAnICsgY29kZWMubmFtZSArICcvJyArIGNvZGVjLmNsb2NrUmF0ZSArXG4gICAgICAoY2hhbm5lbHMgIT09IDEgPyAnLycgKyBjaGFubmVscyA6ICcnKSArICdcXHJcXG4nO1xufTtcblxuLy8gUGFyc2VzIGEgZXh0bWFwIGxpbmUgKGhlYWRlcmV4dGVuc2lvbiBmcm9tIFJGQyA1Mjg1KS4gU2FtcGxlIGlucHV0OlxuLy8gYT1leHRtYXA6MiB1cm46aWV0ZjpwYXJhbXM6cnRwLWhkcmV4dDp0b2Zmc2V0XG4vLyBhPWV4dG1hcDoyL3NlbmRvbmx5IHVybjppZXRmOnBhcmFtczpydHAtaGRyZXh0OnRvZmZzZXRcblNEUFV0aWxzLnBhcnNlRXh0bWFwID0gZnVuY3Rpb24obGluZSkge1xuICBjb25zdCBwYXJ0cyA9IGxpbmUuc3Vic3RyaW5nKDkpLnNwbGl0KCcgJyk7XG4gIHJldHVybiB7XG4gICAgaWQ6IHBhcnNlSW50KHBhcnRzWzBdLCAxMCksXG4gICAgZGlyZWN0aW9uOiBwYXJ0c1swXS5pbmRleE9mKCcvJykgPiAwID8gcGFydHNbMF0uc3BsaXQoJy8nKVsxXSA6ICdzZW5kcmVjdicsXG4gICAgdXJpOiBwYXJ0c1sxXSxcbiAgICBhdHRyaWJ1dGVzOiBwYXJ0cy5zbGljZSgyKS5qb2luKCcgJyksXG4gIH07XG59O1xuXG4vLyBHZW5lcmF0ZXMgYW4gZXh0bWFwIGxpbmUgZnJvbSBSVENSdHBIZWFkZXJFeHRlbnNpb25QYXJhbWV0ZXJzIG9yXG4vLyBSVENSdHBIZWFkZXJFeHRlbnNpb24uXG5TRFBVdGlscy53cml0ZUV4dG1hcCA9IGZ1bmN0aW9uKGhlYWRlckV4dGVuc2lvbikge1xuICByZXR1cm4gJ2E9ZXh0bWFwOicgKyAoaGVhZGVyRXh0ZW5zaW9uLmlkIHx8IGhlYWRlckV4dGVuc2lvbi5wcmVmZXJyZWRJZCkgK1xuICAgICAgKGhlYWRlckV4dGVuc2lvbi5kaXJlY3Rpb24gJiYgaGVhZGVyRXh0ZW5zaW9uLmRpcmVjdGlvbiAhPT0gJ3NlbmRyZWN2J1xuICAgICAgICA/ICcvJyArIGhlYWRlckV4dGVuc2lvbi5kaXJlY3Rpb25cbiAgICAgICAgOiAnJykgK1xuICAgICAgJyAnICsgaGVhZGVyRXh0ZW5zaW9uLnVyaSArXG4gICAgICAoaGVhZGVyRXh0ZW5zaW9uLmF0dHJpYnV0ZXMgPyAnICcgKyBoZWFkZXJFeHRlbnNpb24uYXR0cmlidXRlcyA6ICcnKSArXG4gICAgICAnXFxyXFxuJztcbn07XG5cbi8vIFBhcnNlcyBhIGZtdHAgbGluZSwgcmV0dXJucyBkaWN0aW9uYXJ5LiBTYW1wbGUgaW5wdXQ6XG4vLyBhPWZtdHA6OTYgdmJyPW9uO2NuZz1vblxuLy8gQWxzbyBkZWFscyB3aXRoIHZicj1vbjsgY25nPW9uXG5TRFBVdGlscy5wYXJzZUZtdHAgPSBmdW5jdGlvbihsaW5lKSB7XG4gIGNvbnN0IHBhcnNlZCA9IHt9O1xuICBsZXQga3Y7XG4gIGNvbnN0IHBhcnRzID0gbGluZS5zdWJzdHJpbmcobGluZS5pbmRleE9mKCcgJykgKyAxKS5zcGxpdCgnOycpO1xuICBmb3IgKGxldCBqID0gMDsgaiA8IHBhcnRzLmxlbmd0aDsgaisrKSB7XG4gICAga3YgPSBwYXJ0c1tqXS50cmltKCkuc3BsaXQoJz0nKTtcbiAgICBwYXJzZWRba3ZbMF0udHJpbSgpXSA9IGt2WzFdO1xuICB9XG4gIHJldHVybiBwYXJzZWQ7XG59O1xuXG4vLyBHZW5lcmF0ZXMgYSBmbXRwIGxpbmUgZnJvbSBSVENSdHBDb2RlY0NhcGFiaWxpdHkgb3IgUlRDUnRwQ29kZWNQYXJhbWV0ZXJzLlxuU0RQVXRpbHMud3JpdGVGbXRwID0gZnVuY3Rpb24oY29kZWMpIHtcbiAgbGV0IGxpbmUgPSAnJztcbiAgbGV0IHB0ID0gY29kZWMucGF5bG9hZFR5cGU7XG4gIGlmIChjb2RlYy5wcmVmZXJyZWRQYXlsb2FkVHlwZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgcHQgPSBjb2RlYy5wcmVmZXJyZWRQYXlsb2FkVHlwZTtcbiAgfVxuICBpZiAoY29kZWMucGFyYW1ldGVycyAmJiBPYmplY3Qua2V5cyhjb2RlYy5wYXJhbWV0ZXJzKS5sZW5ndGgpIHtcbiAgICBjb25zdCBwYXJhbXMgPSBbXTtcbiAgICBPYmplY3Qua2V5cyhjb2RlYy5wYXJhbWV0ZXJzKS5mb3JFYWNoKHBhcmFtID0+IHtcbiAgICAgIGlmIChjb2RlYy5wYXJhbWV0ZXJzW3BhcmFtXSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHBhcmFtcy5wdXNoKHBhcmFtICsgJz0nICsgY29kZWMucGFyYW1ldGVyc1twYXJhbV0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcGFyYW1zLnB1c2gocGFyYW0pO1xuICAgICAgfVxuICAgIH0pO1xuICAgIGxpbmUgKz0gJ2E9Zm10cDonICsgcHQgKyAnICcgKyBwYXJhbXMuam9pbignOycpICsgJ1xcclxcbic7XG4gIH1cbiAgcmV0dXJuIGxpbmU7XG59O1xuXG4vLyBQYXJzZXMgYSBydGNwLWZiIGxpbmUsIHJldHVybnMgUlRDUFJ0Y3BGZWVkYmFjayBvYmplY3QuIFNhbXBsZSBpbnB1dDpcbi8vIGE9cnRjcC1mYjo5OCBuYWNrIHJwc2lcblNEUFV0aWxzLnBhcnNlUnRjcEZiID0gZnVuY3Rpb24obGluZSkge1xuICBjb25zdCBwYXJ0cyA9IGxpbmUuc3Vic3RyaW5nKGxpbmUuaW5kZXhPZignICcpICsgMSkuc3BsaXQoJyAnKTtcbiAgcmV0dXJuIHtcbiAgICB0eXBlOiBwYXJ0cy5zaGlmdCgpLFxuICAgIHBhcmFtZXRlcjogcGFydHMuam9pbignICcpLFxuICB9O1xufTtcblxuLy8gR2VuZXJhdGUgYT1ydGNwLWZiIGxpbmVzIGZyb20gUlRDUnRwQ29kZWNDYXBhYmlsaXR5IG9yIFJUQ1J0cENvZGVjUGFyYW1ldGVycy5cblNEUFV0aWxzLndyaXRlUnRjcEZiID0gZnVuY3Rpb24oY29kZWMpIHtcbiAgbGV0IGxpbmVzID0gJyc7XG4gIGxldCBwdCA9IGNvZGVjLnBheWxvYWRUeXBlO1xuICBpZiAoY29kZWMucHJlZmVycmVkUGF5bG9hZFR5cGUgIT09IHVuZGVmaW5lZCkge1xuICAgIHB0ID0gY29kZWMucHJlZmVycmVkUGF5bG9hZFR5cGU7XG4gIH1cbiAgaWYgKGNvZGVjLnJ0Y3BGZWVkYmFjayAmJiBjb2RlYy5ydGNwRmVlZGJhY2subGVuZ3RoKSB7XG4gICAgLy8gRklYTUU6IHNwZWNpYWwgaGFuZGxpbmcgZm9yIHRyci1pbnQ/XG4gICAgY29kZWMucnRjcEZlZWRiYWNrLmZvckVhY2goZmIgPT4ge1xuICAgICAgbGluZXMgKz0gJ2E9cnRjcC1mYjonICsgcHQgKyAnICcgKyBmYi50eXBlICtcbiAgICAgIChmYi5wYXJhbWV0ZXIgJiYgZmIucGFyYW1ldGVyLmxlbmd0aCA/ICcgJyArIGZiLnBhcmFtZXRlciA6ICcnKSArXG4gICAgICAgICAgJ1xcclxcbic7XG4gICAgfSk7XG4gIH1cbiAgcmV0dXJuIGxpbmVzO1xufTtcblxuLy8gUGFyc2VzIGEgUkZDIDU1NzYgc3NyYyBtZWRpYSBhdHRyaWJ1dGUuIFNhbXBsZSBpbnB1dDpcbi8vIGE9c3NyYzozNzM1OTI4NTU5IGNuYW1lOnNvbWV0aGluZ1xuU0RQVXRpbHMucGFyc2VTc3JjTWVkaWEgPSBmdW5jdGlvbihsaW5lKSB7XG4gIGNvbnN0IHNwID0gbGluZS5pbmRleE9mKCcgJyk7XG4gIGNvbnN0IHBhcnRzID0ge1xuICAgIHNzcmM6IHBhcnNlSW50KGxpbmUuc3Vic3RyaW5nKDcsIHNwKSwgMTApLFxuICB9O1xuICBjb25zdCBjb2xvbiA9IGxpbmUuaW5kZXhPZignOicsIHNwKTtcbiAgaWYgKGNvbG9uID4gLTEpIHtcbiAgICBwYXJ0cy5hdHRyaWJ1dGUgPSBsaW5lLnN1YnN0cmluZyhzcCArIDEsIGNvbG9uKTtcbiAgICBwYXJ0cy52YWx1ZSA9IGxpbmUuc3Vic3RyaW5nKGNvbG9uICsgMSk7XG4gIH0gZWxzZSB7XG4gICAgcGFydHMuYXR0cmlidXRlID0gbGluZS5zdWJzdHJpbmcoc3AgKyAxKTtcbiAgfVxuICByZXR1cm4gcGFydHM7XG59O1xuXG4vLyBQYXJzZSBhIHNzcmMtZ3JvdXAgbGluZSAoc2VlIFJGQyA1NTc2KS4gU2FtcGxlIGlucHV0OlxuLy8gYT1zc3JjLWdyb3VwOnNlbWFudGljcyAxMiAzNFxuU0RQVXRpbHMucGFyc2VTc3JjR3JvdXAgPSBmdW5jdGlvbihsaW5lKSB7XG4gIGNvbnN0IHBhcnRzID0gbGluZS5zdWJzdHJpbmcoMTMpLnNwbGl0KCcgJyk7XG4gIHJldHVybiB7XG4gICAgc2VtYW50aWNzOiBwYXJ0cy5zaGlmdCgpLFxuICAgIHNzcmNzOiBwYXJ0cy5tYXAoc3NyYyA9PiBwYXJzZUludChzc3JjLCAxMCkpLFxuICB9O1xufTtcblxuLy8gRXh0cmFjdHMgdGhlIE1JRCAoUkZDIDU4ODgpIGZyb20gYSBtZWRpYSBzZWN0aW9uLlxuLy8gUmV0dXJucyB0aGUgTUlEIG9yIHVuZGVmaW5lZCBpZiBubyBtaWQgbGluZSB3YXMgZm91bmQuXG5TRFBVdGlscy5nZXRNaWQgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgY29uc3QgbWlkID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1taWQ6JylbMF07XG4gIGlmIChtaWQpIHtcbiAgICByZXR1cm4gbWlkLnN1YnN0cmluZyg2KTtcbiAgfVxufTtcblxuLy8gUGFyc2VzIGEgZmluZ2VycHJpbnQgbGluZSBmb3IgRFRMUy1TUlRQLlxuU0RQVXRpbHMucGFyc2VGaW5nZXJwcmludCA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgY29uc3QgcGFydHMgPSBsaW5lLnN1YnN0cmluZygxNCkuc3BsaXQoJyAnKTtcbiAgcmV0dXJuIHtcbiAgICBhbGdvcml0aG06IHBhcnRzWzBdLnRvTG93ZXJDYXNlKCksIC8vIGFsZ29yaXRobSBpcyBjYXNlLXNlbnNpdGl2ZSBpbiBFZGdlLlxuICAgIHZhbHVlOiBwYXJ0c1sxXS50b1VwcGVyQ2FzZSgpLCAvLyB0aGUgZGVmaW5pdGlvbiBpcyB1cHBlci1jYXNlIGluIFJGQyA0NTcyLlxuICB9O1xufTtcblxuLy8gRXh0cmFjdHMgRFRMUyBwYXJhbWV0ZXJzIGZyb20gU0RQIG1lZGlhIHNlY3Rpb24gb3Igc2Vzc2lvbnBhcnQuXG4vLyBGSVhNRTogZm9yIGNvbnNpc3RlbmN5IHdpdGggb3RoZXIgZnVuY3Rpb25zIHRoaXMgc2hvdWxkIG9ubHlcbi8vICAgZ2V0IHRoZSBmaW5nZXJwcmludCBsaW5lIGFzIGlucHV0LiBTZWUgYWxzbyBnZXRJY2VQYXJhbWV0ZXJzLlxuU0RQVXRpbHMuZ2V0RHRsc1BhcmFtZXRlcnMgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24sIHNlc3Npb25wYXJ0KSB7XG4gIGNvbnN0IGxpbmVzID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uICsgc2Vzc2lvbnBhcnQsXG4gICAgJ2E9ZmluZ2VycHJpbnQ6Jyk7XG4gIC8vIE5vdGU6IGE9c2V0dXAgbGluZSBpcyBpZ25vcmVkIHNpbmNlIHdlIHVzZSB0aGUgJ2F1dG8nIHJvbGUgaW4gRWRnZS5cbiAgcmV0dXJuIHtcbiAgICByb2xlOiAnYXV0bycsXG4gICAgZmluZ2VycHJpbnRzOiBsaW5lcy5tYXAoU0RQVXRpbHMucGFyc2VGaW5nZXJwcmludCksXG4gIH07XG59O1xuXG4vLyBTZXJpYWxpemVzIERUTFMgcGFyYW1ldGVycyB0byBTRFAuXG5TRFBVdGlscy53cml0ZUR0bHNQYXJhbWV0ZXJzID0gZnVuY3Rpb24ocGFyYW1zLCBzZXR1cFR5cGUpIHtcbiAgbGV0IHNkcCA9ICdhPXNldHVwOicgKyBzZXR1cFR5cGUgKyAnXFxyXFxuJztcbiAgcGFyYW1zLmZpbmdlcnByaW50cy5mb3JFYWNoKGZwID0+IHtcbiAgICBzZHAgKz0gJ2E9ZmluZ2VycHJpbnQ6JyArIGZwLmFsZ29yaXRobSArICcgJyArIGZwLnZhbHVlICsgJ1xcclxcbic7XG4gIH0pO1xuICByZXR1cm4gc2RwO1xufTtcblxuLy8gUGFyc2VzIGE9Y3J5cHRvIGxpbmVzIGludG9cbi8vICAgaHR0cHM6Ly9yYXdnaXQuY29tL2Fib2JhL2VkZ2VydGMvbWFzdGVyL21zb3J0Yy1yczQuaHRtbCNkaWN0aW9uYXJ5LXJ0Y3NydHBzZGVzcGFyYW1ldGVycy1tZW1iZXJzXG5TRFBVdGlscy5wYXJzZUNyeXB0b0xpbmUgPSBmdW5jdGlvbihsaW5lKSB7XG4gIGNvbnN0IHBhcnRzID0gbGluZS5zdWJzdHJpbmcoOSkuc3BsaXQoJyAnKTtcbiAgcmV0dXJuIHtcbiAgICB0YWc6IHBhcnNlSW50KHBhcnRzWzBdLCAxMCksXG4gICAgY3J5cHRvU3VpdGU6IHBhcnRzWzFdLFxuICAgIGtleVBhcmFtczogcGFydHNbMl0sXG4gICAgc2Vzc2lvblBhcmFtczogcGFydHMuc2xpY2UoMyksXG4gIH07XG59O1xuXG5TRFBVdGlscy53cml0ZUNyeXB0b0xpbmUgPSBmdW5jdGlvbihwYXJhbWV0ZXJzKSB7XG4gIHJldHVybiAnYT1jcnlwdG86JyArIHBhcmFtZXRlcnMudGFnICsgJyAnICtcbiAgICBwYXJhbWV0ZXJzLmNyeXB0b1N1aXRlICsgJyAnICtcbiAgICAodHlwZW9mIHBhcmFtZXRlcnMua2V5UGFyYW1zID09PSAnb2JqZWN0J1xuICAgICAgPyBTRFBVdGlscy53cml0ZUNyeXB0b0tleVBhcmFtcyhwYXJhbWV0ZXJzLmtleVBhcmFtcylcbiAgICAgIDogcGFyYW1ldGVycy5rZXlQYXJhbXMpICtcbiAgICAocGFyYW1ldGVycy5zZXNzaW9uUGFyYW1zID8gJyAnICsgcGFyYW1ldGVycy5zZXNzaW9uUGFyYW1zLmpvaW4oJyAnKSA6ICcnKSArXG4gICAgJ1xcclxcbic7XG59O1xuXG4vLyBQYXJzZXMgdGhlIGNyeXB0byBrZXkgcGFyYW1ldGVycyBpbnRvXG4vLyAgIGh0dHBzOi8vcmF3Z2l0LmNvbS9hYm9iYS9lZGdlcnRjL21hc3Rlci9tc29ydGMtcnM0Lmh0bWwjcnRjc3J0cGtleXBhcmFtKlxuU0RQVXRpbHMucGFyc2VDcnlwdG9LZXlQYXJhbXMgPSBmdW5jdGlvbihrZXlQYXJhbXMpIHtcbiAgaWYgKGtleVBhcmFtcy5pbmRleE9mKCdpbmxpbmU6JykgIT09IDApIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICBjb25zdCBwYXJ0cyA9IGtleVBhcmFtcy5zdWJzdHJpbmcoNykuc3BsaXQoJ3wnKTtcbiAgcmV0dXJuIHtcbiAgICBrZXlNZXRob2Q6ICdpbmxpbmUnLFxuICAgIGtleVNhbHQ6IHBhcnRzWzBdLFxuICAgIGxpZmVUaW1lOiBwYXJ0c1sxXSxcbiAgICBta2lWYWx1ZTogcGFydHNbMl0gPyBwYXJ0c1syXS5zcGxpdCgnOicpWzBdIDogdW5kZWZpbmVkLFxuICAgIG1raUxlbmd0aDogcGFydHNbMl0gPyBwYXJ0c1syXS5zcGxpdCgnOicpWzFdIDogdW5kZWZpbmVkLFxuICB9O1xufTtcblxuU0RQVXRpbHMud3JpdGVDcnlwdG9LZXlQYXJhbXMgPSBmdW5jdGlvbihrZXlQYXJhbXMpIHtcbiAgcmV0dXJuIGtleVBhcmFtcy5rZXlNZXRob2QgKyAnOidcbiAgICArIGtleVBhcmFtcy5rZXlTYWx0ICtcbiAgICAoa2V5UGFyYW1zLmxpZmVUaW1lID8gJ3wnICsga2V5UGFyYW1zLmxpZmVUaW1lIDogJycpICtcbiAgICAoa2V5UGFyYW1zLm1raVZhbHVlICYmIGtleVBhcmFtcy5ta2lMZW5ndGhcbiAgICAgID8gJ3wnICsga2V5UGFyYW1zLm1raVZhbHVlICsgJzonICsga2V5UGFyYW1zLm1raUxlbmd0aFxuICAgICAgOiAnJyk7XG59O1xuXG4vLyBFeHRyYWN0cyBhbGwgU0RFUyBwYXJhbWV0ZXJzLlxuU0RQVXRpbHMuZ2V0Q3J5cHRvUGFyYW1ldGVycyA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbiwgc2Vzc2lvbnBhcnQpIHtcbiAgY29uc3QgbGluZXMgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24gKyBzZXNzaW9ucGFydCxcbiAgICAnYT1jcnlwdG86Jyk7XG4gIHJldHVybiBsaW5lcy5tYXAoU0RQVXRpbHMucGFyc2VDcnlwdG9MaW5lKTtcbn07XG5cbi8vIFBhcnNlcyBJQ0UgaW5mb3JtYXRpb24gZnJvbSBTRFAgbWVkaWEgc2VjdGlvbiBvciBzZXNzaW9ucGFydC5cbi8vIEZJWE1FOiBmb3IgY29uc2lzdGVuY3kgd2l0aCBvdGhlciBmdW5jdGlvbnMgdGhpcyBzaG91bGQgb25seVxuLy8gICBnZXQgdGhlIGljZS11ZnJhZyBhbmQgaWNlLXB3ZCBsaW5lcyBhcyBpbnB1dC5cblNEUFV0aWxzLmdldEljZVBhcmFtZXRlcnMgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24sIHNlc3Npb25wYXJ0KSB7XG4gIGNvbnN0IHVmcmFnID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uICsgc2Vzc2lvbnBhcnQsXG4gICAgJ2E9aWNlLXVmcmFnOicpWzBdO1xuICBjb25zdCBwd2QgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24gKyBzZXNzaW9ucGFydCxcbiAgICAnYT1pY2UtcHdkOicpWzBdO1xuICBpZiAoISh1ZnJhZyAmJiBwd2QpKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgcmV0dXJuIHtcbiAgICB1c2VybmFtZUZyYWdtZW50OiB1ZnJhZy5zdWJzdHJpbmcoMTIpLFxuICAgIHBhc3N3b3JkOiBwd2Quc3Vic3RyaW5nKDEwKSxcbiAgfTtcbn07XG5cbi8vIFNlcmlhbGl6ZXMgSUNFIHBhcmFtZXRlcnMgdG8gU0RQLlxuU0RQVXRpbHMud3JpdGVJY2VQYXJhbWV0ZXJzID0gZnVuY3Rpb24ocGFyYW1zKSB7XG4gIGxldCBzZHAgPSAnYT1pY2UtdWZyYWc6JyArIHBhcmFtcy51c2VybmFtZUZyYWdtZW50ICsgJ1xcclxcbicgK1xuICAgICAgJ2E9aWNlLXB3ZDonICsgcGFyYW1zLnBhc3N3b3JkICsgJ1xcclxcbic7XG4gIGlmIChwYXJhbXMuaWNlTGl0ZSkge1xuICAgIHNkcCArPSAnYT1pY2UtbGl0ZVxcclxcbic7XG4gIH1cbiAgcmV0dXJuIHNkcDtcbn07XG5cbi8vIFBhcnNlcyB0aGUgU0RQIG1lZGlhIHNlY3Rpb24gYW5kIHJldHVybnMgUlRDUnRwUGFyYW1ldGVycy5cblNEUFV0aWxzLnBhcnNlUnRwUGFyYW1ldGVycyA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbikge1xuICBjb25zdCBkZXNjcmlwdGlvbiA9IHtcbiAgICBjb2RlY3M6IFtdLFxuICAgIGhlYWRlckV4dGVuc2lvbnM6IFtdLFxuICAgIGZlY01lY2hhbmlzbXM6IFtdLFxuICAgIHJ0Y3A6IFtdLFxuICB9O1xuICBjb25zdCBsaW5lcyA9IFNEUFV0aWxzLnNwbGl0TGluZXMobWVkaWFTZWN0aW9uKTtcbiAgY29uc3QgbWxpbmUgPSBsaW5lc1swXS5zcGxpdCgnICcpO1xuICBkZXNjcmlwdGlvbi5wcm9maWxlID0gbWxpbmVbMl07XG4gIGZvciAobGV0IGkgPSAzOyBpIDwgbWxpbmUubGVuZ3RoOyBpKyspIHsgLy8gZmluZCBhbGwgY29kZWNzIGZyb20gbWxpbmVbMy4uXVxuICAgIGNvbnN0IHB0ID0gbWxpbmVbaV07XG4gICAgY29uc3QgcnRwbWFwbGluZSA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KFxuICAgICAgbWVkaWFTZWN0aW9uLCAnYT1ydHBtYXA6JyArIHB0ICsgJyAnKVswXTtcbiAgICBpZiAocnRwbWFwbGluZSkge1xuICAgICAgY29uc3QgY29kZWMgPSBTRFBVdGlscy5wYXJzZVJ0cE1hcChydHBtYXBsaW5lKTtcbiAgICAgIGNvbnN0IGZtdHBzID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgoXG4gICAgICAgIG1lZGlhU2VjdGlvbiwgJ2E9Zm10cDonICsgcHQgKyAnICcpO1xuICAgICAgLy8gT25seSB0aGUgZmlyc3QgYT1mbXRwOjxwdD4gaXMgY29uc2lkZXJlZC5cbiAgICAgIGNvZGVjLnBhcmFtZXRlcnMgPSBmbXRwcy5sZW5ndGggPyBTRFBVdGlscy5wYXJzZUZtdHAoZm10cHNbMF0pIDoge307XG4gICAgICBjb2RlYy5ydGNwRmVlZGJhY2sgPSBTRFBVdGlscy5tYXRjaFByZWZpeChcbiAgICAgICAgbWVkaWFTZWN0aW9uLCAnYT1ydGNwLWZiOicgKyBwdCArICcgJylcbiAgICAgICAgLm1hcChTRFBVdGlscy5wYXJzZVJ0Y3BGYik7XG4gICAgICBkZXNjcmlwdGlvbi5jb2RlY3MucHVzaChjb2RlYyk7XG4gICAgICAvLyBwYXJzZSBGRUMgbWVjaGFuaXNtcyBmcm9tIHJ0cG1hcCBsaW5lcy5cbiAgICAgIHN3aXRjaCAoY29kZWMubmFtZS50b1VwcGVyQ2FzZSgpKSB7XG4gICAgICAgIGNhc2UgJ1JFRCc6XG4gICAgICAgIGNhc2UgJ1VMUEZFQyc6XG4gICAgICAgICAgZGVzY3JpcHRpb24uZmVjTWVjaGFuaXNtcy5wdXNoKGNvZGVjLm5hbWUudG9VcHBlckNhc2UoKSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGRlZmF1bHQ6IC8vIG9ubHkgUkVEIGFuZCBVTFBGRUMgYXJlIHJlY29nbml6ZWQgYXMgRkVDIG1lY2hhbmlzbXMuXG4gICAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9ZXh0bWFwOicpLmZvckVhY2gobGluZSA9PiB7XG4gICAgZGVzY3JpcHRpb24uaGVhZGVyRXh0ZW5zaW9ucy5wdXNoKFNEUFV0aWxzLnBhcnNlRXh0bWFwKGxpbmUpKTtcbiAgfSk7XG4gIGNvbnN0IHdpbGRjYXJkUnRjcEZiID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1ydGNwLWZiOiogJylcbiAgICAubWFwKFNEUFV0aWxzLnBhcnNlUnRjcEZiKTtcbiAgZGVzY3JpcHRpb24uY29kZWNzLmZvckVhY2goY29kZWMgPT4ge1xuICAgIHdpbGRjYXJkUnRjcEZiLmZvckVhY2goZmI9PiB7XG4gICAgICBjb25zdCBkdXBsaWNhdGUgPSBjb2RlYy5ydGNwRmVlZGJhY2suZmluZChleGlzdGluZ0ZlZWRiYWNrID0+IHtcbiAgICAgICAgcmV0dXJuIGV4aXN0aW5nRmVlZGJhY2sudHlwZSA9PT0gZmIudHlwZSAmJlxuICAgICAgICAgIGV4aXN0aW5nRmVlZGJhY2sucGFyYW1ldGVyID09PSBmYi5wYXJhbWV0ZXI7XG4gICAgICB9KTtcbiAgICAgIGlmICghZHVwbGljYXRlKSB7XG4gICAgICAgIGNvZGVjLnJ0Y3BGZWVkYmFjay5wdXNoKGZiKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSk7XG4gIC8vIEZJWE1FOiBwYXJzZSBydGNwLlxuICByZXR1cm4gZGVzY3JpcHRpb247XG59O1xuXG4vLyBHZW5lcmF0ZXMgcGFydHMgb2YgdGhlIFNEUCBtZWRpYSBzZWN0aW9uIGRlc2NyaWJpbmcgdGhlIGNhcGFiaWxpdGllcyAvXG4vLyBwYXJhbWV0ZXJzLlxuU0RQVXRpbHMud3JpdGVSdHBEZXNjcmlwdGlvbiA9IGZ1bmN0aW9uKGtpbmQsIGNhcHMpIHtcbiAgbGV0IHNkcCA9ICcnO1xuXG4gIC8vIEJ1aWxkIHRoZSBtbGluZS5cbiAgc2RwICs9ICdtPScgKyBraW5kICsgJyAnO1xuICBzZHAgKz0gY2Fwcy5jb2RlY3MubGVuZ3RoID4gMCA/ICc5JyA6ICcwJzsgLy8gcmVqZWN0IGlmIG5vIGNvZGVjcy5cbiAgc2RwICs9ICcgJyArIChjYXBzLnByb2ZpbGUgfHwgJ1VEUC9UTFMvUlRQL1NBVlBGJykgKyAnICc7XG4gIHNkcCArPSBjYXBzLmNvZGVjcy5tYXAoY29kZWMgPT4ge1xuICAgIGlmIChjb2RlYy5wcmVmZXJyZWRQYXlsb2FkVHlwZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXR1cm4gY29kZWMucHJlZmVycmVkUGF5bG9hZFR5cGU7XG4gICAgfVxuICAgIHJldHVybiBjb2RlYy5wYXlsb2FkVHlwZTtcbiAgfSkuam9pbignICcpICsgJ1xcclxcbic7XG5cbiAgc2RwICs9ICdjPUlOIElQNCAwLjAuMC4wXFxyXFxuJztcbiAgc2RwICs9ICdhPXJ0Y3A6OSBJTiBJUDQgMC4wLjAuMFxcclxcbic7XG5cbiAgLy8gQWRkIGE9cnRwbWFwIGxpbmVzIGZvciBlYWNoIGNvZGVjLiBBbHNvIGZtdHAgYW5kIHJ0Y3AtZmIuXG4gIGNhcHMuY29kZWNzLmZvckVhY2goY29kZWMgPT4ge1xuICAgIHNkcCArPSBTRFBVdGlscy53cml0ZVJ0cE1hcChjb2RlYyk7XG4gICAgc2RwICs9IFNEUFV0aWxzLndyaXRlRm10cChjb2RlYyk7XG4gICAgc2RwICs9IFNEUFV0aWxzLndyaXRlUnRjcEZiKGNvZGVjKTtcbiAgfSk7XG4gIGxldCBtYXhwdGltZSA9IDA7XG4gIGNhcHMuY29kZWNzLmZvckVhY2goY29kZWMgPT4ge1xuICAgIGlmIChjb2RlYy5tYXhwdGltZSA+IG1heHB0aW1lKSB7XG4gICAgICBtYXhwdGltZSA9IGNvZGVjLm1heHB0aW1lO1xuICAgIH1cbiAgfSk7XG4gIGlmIChtYXhwdGltZSA+IDApIHtcbiAgICBzZHAgKz0gJ2E9bWF4cHRpbWU6JyArIG1heHB0aW1lICsgJ1xcclxcbic7XG4gIH1cblxuICBpZiAoY2Fwcy5oZWFkZXJFeHRlbnNpb25zKSB7XG4gICAgY2Fwcy5oZWFkZXJFeHRlbnNpb25zLmZvckVhY2goZXh0ZW5zaW9uID0+IHtcbiAgICAgIHNkcCArPSBTRFBVdGlscy53cml0ZUV4dG1hcChleHRlbnNpb24pO1xuICAgIH0pO1xuICB9XG4gIC8vIEZJWE1FOiB3cml0ZSBmZWNNZWNoYW5pc21zLlxuICByZXR1cm4gc2RwO1xufTtcblxuLy8gUGFyc2VzIHRoZSBTRFAgbWVkaWEgc2VjdGlvbiBhbmQgcmV0dXJucyBhbiBhcnJheSBvZlxuLy8gUlRDUnRwRW5jb2RpbmdQYXJhbWV0ZXJzLlxuU0RQVXRpbHMucGFyc2VSdHBFbmNvZGluZ1BhcmFtZXRlcnMgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgY29uc3QgZW5jb2RpbmdQYXJhbWV0ZXJzID0gW107XG4gIGNvbnN0IGRlc2NyaXB0aW9uID0gU0RQVXRpbHMucGFyc2VSdHBQYXJhbWV0ZXJzKG1lZGlhU2VjdGlvbik7XG4gIGNvbnN0IGhhc1JlZCA9IGRlc2NyaXB0aW9uLmZlY01lY2hhbmlzbXMuaW5kZXhPZignUkVEJykgIT09IC0xO1xuICBjb25zdCBoYXNVbHBmZWMgPSBkZXNjcmlwdGlvbi5mZWNNZWNoYW5pc21zLmluZGV4T2YoJ1VMUEZFQycpICE9PSAtMTtcblxuICAvLyBmaWx0ZXIgYT1zc3JjOi4uLiBjbmFtZTosIGlnbm9yZSBQbGFuQi1tc2lkXG4gIGNvbnN0IHNzcmNzID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1zc3JjOicpXG4gICAgLm1hcChsaW5lID0+IFNEUFV0aWxzLnBhcnNlU3NyY01lZGlhKGxpbmUpKVxuICAgIC5maWx0ZXIocGFydHMgPT4gcGFydHMuYXR0cmlidXRlID09PSAnY25hbWUnKTtcbiAgY29uc3QgcHJpbWFyeVNzcmMgPSBzc3Jjcy5sZW5ndGggPiAwICYmIHNzcmNzWzBdLnNzcmM7XG4gIGxldCBzZWNvbmRhcnlTc3JjO1xuXG4gIGNvbnN0IGZsb3dzID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1zc3JjLWdyb3VwOkZJRCcpXG4gICAgLm1hcChsaW5lID0+IHtcbiAgICAgIGNvbnN0IHBhcnRzID0gbGluZS5zdWJzdHJpbmcoMTcpLnNwbGl0KCcgJyk7XG4gICAgICByZXR1cm4gcGFydHMubWFwKHBhcnQgPT4gcGFyc2VJbnQocGFydCwgMTApKTtcbiAgICB9KTtcbiAgaWYgKGZsb3dzLmxlbmd0aCA+IDAgJiYgZmxvd3NbMF0ubGVuZ3RoID4gMSAmJiBmbG93c1swXVswXSA9PT0gcHJpbWFyeVNzcmMpIHtcbiAgICBzZWNvbmRhcnlTc3JjID0gZmxvd3NbMF1bMV07XG4gIH1cblxuICBkZXNjcmlwdGlvbi5jb2RlY3MuZm9yRWFjaChjb2RlYyA9PiB7XG4gICAgaWYgKGNvZGVjLm5hbWUudG9VcHBlckNhc2UoKSA9PT0gJ1JUWCcgJiYgY29kZWMucGFyYW1ldGVycy5hcHQpIHtcbiAgICAgIGxldCBlbmNQYXJhbSA9IHtcbiAgICAgICAgc3NyYzogcHJpbWFyeVNzcmMsXG4gICAgICAgIGNvZGVjUGF5bG9hZFR5cGU6IHBhcnNlSW50KGNvZGVjLnBhcmFtZXRlcnMuYXB0LCAxMCksXG4gICAgICB9O1xuICAgICAgaWYgKHByaW1hcnlTc3JjICYmIHNlY29uZGFyeVNzcmMpIHtcbiAgICAgICAgZW5jUGFyYW0ucnR4ID0ge3NzcmM6IHNlY29uZGFyeVNzcmN9O1xuICAgICAgfVxuICAgICAgZW5jb2RpbmdQYXJhbWV0ZXJzLnB1c2goZW5jUGFyYW0pO1xuICAgICAgaWYgKGhhc1JlZCkge1xuICAgICAgICBlbmNQYXJhbSA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoZW5jUGFyYW0pKTtcbiAgICAgICAgZW5jUGFyYW0uZmVjID0ge1xuICAgICAgICAgIHNzcmM6IHByaW1hcnlTc3JjLFxuICAgICAgICAgIG1lY2hhbmlzbTogaGFzVWxwZmVjID8gJ3JlZCt1bHBmZWMnIDogJ3JlZCcsXG4gICAgICAgIH07XG4gICAgICAgIGVuY29kaW5nUGFyYW1ldGVycy5wdXNoKGVuY1BhcmFtKTtcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xuICBpZiAoZW5jb2RpbmdQYXJhbWV0ZXJzLmxlbmd0aCA9PT0gMCAmJiBwcmltYXJ5U3NyYykge1xuICAgIGVuY29kaW5nUGFyYW1ldGVycy5wdXNoKHtcbiAgICAgIHNzcmM6IHByaW1hcnlTc3JjLFxuICAgIH0pO1xuICB9XG5cbiAgLy8gd2Ugc3VwcG9ydCBib3RoIGI9QVMgYW5kIGI9VElBUyBidXQgaW50ZXJwcmV0IEFTIGFzIFRJQVMuXG4gIGxldCBiYW5kd2lkdGggPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdiPScpO1xuICBpZiAoYmFuZHdpZHRoLmxlbmd0aCkge1xuICAgIGlmIChiYW5kd2lkdGhbMF0uaW5kZXhPZignYj1USUFTOicpID09PSAwKSB7XG4gICAgICBiYW5kd2lkdGggPSBwYXJzZUludChiYW5kd2lkdGhbMF0uc3Vic3RyaW5nKDcpLCAxMCk7XG4gICAgfSBlbHNlIGlmIChiYW5kd2lkdGhbMF0uaW5kZXhPZignYj1BUzonKSA9PT0gMCkge1xuICAgICAgLy8gdXNlIGZvcm11bGEgZnJvbSBKU0VQIHRvIGNvbnZlcnQgYj1BUyB0byBUSUFTIHZhbHVlLlxuICAgICAgYmFuZHdpZHRoID0gcGFyc2VJbnQoYmFuZHdpZHRoWzBdLnN1YnN0cmluZyg1KSwgMTApICogMTAwMCAqIDAuOTVcbiAgICAgICAgICAtICg1MCAqIDQwICogOCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGJhbmR3aWR0aCA9IHVuZGVmaW5lZDtcbiAgICB9XG4gICAgZW5jb2RpbmdQYXJhbWV0ZXJzLmZvckVhY2gocGFyYW1zID0+IHtcbiAgICAgIHBhcmFtcy5tYXhCaXRyYXRlID0gYmFuZHdpZHRoO1xuICAgIH0pO1xuICB9XG4gIHJldHVybiBlbmNvZGluZ1BhcmFtZXRlcnM7XG59O1xuXG4vLyBwYXJzZXMgaHR0cDovL2RyYWZ0Lm9ydGMub3JnLyNydGNydGNwcGFyYW1ldGVycypcblNEUFV0aWxzLnBhcnNlUnRjcFBhcmFtZXRlcnMgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgY29uc3QgcnRjcFBhcmFtZXRlcnMgPSB7fTtcblxuICAvLyBHZXRzIHRoZSBmaXJzdCBTU1JDLiBOb3RlIHRoYXQgd2l0aCBSVFggdGhlcmUgbWlnaHQgYmUgbXVsdGlwbGVcbiAgLy8gU1NSQ3MuXG4gIGNvbnN0IHJlbW90ZVNzcmMgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPXNzcmM6JylcbiAgICAubWFwKGxpbmUgPT4gU0RQVXRpbHMucGFyc2VTc3JjTWVkaWEobGluZSkpXG4gICAgLmZpbHRlcihvYmogPT4gb2JqLmF0dHJpYnV0ZSA9PT0gJ2NuYW1lJylbMF07XG4gIGlmIChyZW1vdGVTc3JjKSB7XG4gICAgcnRjcFBhcmFtZXRlcnMuY25hbWUgPSByZW1vdGVTc3JjLnZhbHVlO1xuICAgIHJ0Y3BQYXJhbWV0ZXJzLnNzcmMgPSByZW1vdGVTc3JjLnNzcmM7XG4gIH1cblxuICAvLyBFZGdlIHVzZXMgdGhlIGNvbXBvdW5kIGF0dHJpYnV0ZSBpbnN0ZWFkIG9mIHJlZHVjZWRTaXplXG4gIC8vIGNvbXBvdW5kIGlzICFyZWR1Y2VkU2l6ZVxuICBjb25zdCByc2l6ZSA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9cnRjcC1yc2l6ZScpO1xuICBydGNwUGFyYW1ldGVycy5yZWR1Y2VkU2l6ZSA9IHJzaXplLmxlbmd0aCA+IDA7XG4gIHJ0Y3BQYXJhbWV0ZXJzLmNvbXBvdW5kID0gcnNpemUubGVuZ3RoID09PSAwO1xuXG4gIC8vIHBhcnNlcyB0aGUgcnRjcC1tdXggYXR0ctGWYnV0ZS5cbiAgLy8gTm90ZSB0aGF0IEVkZ2UgZG9lcyBub3Qgc3VwcG9ydCB1bm11eGVkIFJUQ1AuXG4gIGNvbnN0IG11eCA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9cnRjcC1tdXgnKTtcbiAgcnRjcFBhcmFtZXRlcnMubXV4ID0gbXV4Lmxlbmd0aCA+IDA7XG5cbiAgcmV0dXJuIHJ0Y3BQYXJhbWV0ZXJzO1xufTtcblxuU0RQVXRpbHMud3JpdGVSdGNwUGFyYW1ldGVycyA9IGZ1bmN0aW9uKHJ0Y3BQYXJhbWV0ZXJzKSB7XG4gIGxldCBzZHAgPSAnJztcbiAgaWYgKHJ0Y3BQYXJhbWV0ZXJzLnJlZHVjZWRTaXplKSB7XG4gICAgc2RwICs9ICdhPXJ0Y3AtcnNpemVcXHJcXG4nO1xuICB9XG4gIGlmIChydGNwUGFyYW1ldGVycy5tdXgpIHtcbiAgICBzZHAgKz0gJ2E9cnRjcC1tdXhcXHJcXG4nO1xuICB9XG4gIGlmIChydGNwUGFyYW1ldGVycy5zc3JjICE9PSB1bmRlZmluZWQgJiYgcnRjcFBhcmFtZXRlcnMuY25hbWUpIHtcbiAgICBzZHAgKz0gJ2E9c3NyYzonICsgcnRjcFBhcmFtZXRlcnMuc3NyYyArXG4gICAgICAnIGNuYW1lOicgKyBydGNwUGFyYW1ldGVycy5jbmFtZSArICdcXHJcXG4nO1xuICB9XG4gIHJldHVybiBzZHA7XG59O1xuXG5cbi8vIHBhcnNlcyBlaXRoZXIgYT1tc2lkOiBvciBhPXNzcmM6Li4uIG1zaWQgbGluZXMgYW5kIHJldHVybnNcbi8vIHRoZSBpZCBvZiB0aGUgTWVkaWFTdHJlYW0gYW5kIE1lZGlhU3RyZWFtVHJhY2suXG5TRFBVdGlscy5wYXJzZU1zaWQgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgbGV0IHBhcnRzO1xuICBjb25zdCBzcGVjID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1tc2lkOicpO1xuICBpZiAoc3BlYy5sZW5ndGggPT09IDEpIHtcbiAgICBwYXJ0cyA9IHNwZWNbMF0uc3Vic3RyaW5nKDcpLnNwbGl0KCcgJyk7XG4gICAgcmV0dXJuIHtzdHJlYW06IHBhcnRzWzBdLCB0cmFjazogcGFydHNbMV19O1xuICB9XG4gIGNvbnN0IHBsYW5CID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1zc3JjOicpXG4gICAgLm1hcChsaW5lID0+IFNEUFV0aWxzLnBhcnNlU3NyY01lZGlhKGxpbmUpKVxuICAgIC5maWx0ZXIobXNpZFBhcnRzID0+IG1zaWRQYXJ0cy5hdHRyaWJ1dGUgPT09ICdtc2lkJyk7XG4gIGlmIChwbGFuQi5sZW5ndGggPiAwKSB7XG4gICAgcGFydHMgPSBwbGFuQlswXS52YWx1ZS5zcGxpdCgnICcpO1xuICAgIHJldHVybiB7c3RyZWFtOiBwYXJ0c1swXSwgdHJhY2s6IHBhcnRzWzFdfTtcbiAgfVxufTtcblxuLy8gU0NUUFxuLy8gcGFyc2VzIGRyYWZ0LWlldGYtbW11c2ljLXNjdHAtc2RwLTI2IGZpcnN0IGFuZCBmYWxscyBiYWNrXG4vLyB0byBkcmFmdC1pZXRmLW1tdXNpYy1zY3RwLXNkcC0wNVxuU0RQVXRpbHMucGFyc2VTY3RwRGVzY3JpcHRpb24gPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgY29uc3QgbWxpbmUgPSBTRFBVdGlscy5wYXJzZU1MaW5lKG1lZGlhU2VjdGlvbik7XG4gIGNvbnN0IG1heFNpemVMaW5lID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1tYXgtbWVzc2FnZS1zaXplOicpO1xuICBsZXQgbWF4TWVzc2FnZVNpemU7XG4gIGlmIChtYXhTaXplTGluZS5sZW5ndGggPiAwKSB7XG4gICAgbWF4TWVzc2FnZVNpemUgPSBwYXJzZUludChtYXhTaXplTGluZVswXS5zdWJzdHJpbmcoMTkpLCAxMCk7XG4gIH1cbiAgaWYgKGlzTmFOKG1heE1lc3NhZ2VTaXplKSkge1xuICAgIG1heE1lc3NhZ2VTaXplID0gNjU1MzY7XG4gIH1cbiAgY29uc3Qgc2N0cFBvcnQgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPXNjdHAtcG9ydDonKTtcbiAgaWYgKHNjdHBQb3J0Lmxlbmd0aCA+IDApIHtcbiAgICByZXR1cm4ge1xuICAgICAgcG9ydDogcGFyc2VJbnQoc2N0cFBvcnRbMF0uc3Vic3RyaW5nKDEyKSwgMTApLFxuICAgICAgcHJvdG9jb2w6IG1saW5lLmZtdCxcbiAgICAgIG1heE1lc3NhZ2VTaXplLFxuICAgIH07XG4gIH1cbiAgY29uc3Qgc2N0cE1hcExpbmVzID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1zY3RwbWFwOicpO1xuICBpZiAoc2N0cE1hcExpbmVzLmxlbmd0aCA+IDApIHtcbiAgICBjb25zdCBwYXJ0cyA9IHNjdHBNYXBMaW5lc1swXVxuICAgICAgLnN1YnN0cmluZygxMClcbiAgICAgIC5zcGxpdCgnICcpO1xuICAgIHJldHVybiB7XG4gICAgICBwb3J0OiBwYXJzZUludChwYXJ0c1swXSwgMTApLFxuICAgICAgcHJvdG9jb2w6IHBhcnRzWzFdLFxuICAgICAgbWF4TWVzc2FnZVNpemUsXG4gICAgfTtcbiAgfVxufTtcblxuLy8gU0NUUFxuLy8gb3V0cHV0cyB0aGUgZHJhZnQtaWV0Zi1tbXVzaWMtc2N0cC1zZHAtMjYgdmVyc2lvbiB0aGF0IGFsbCBicm93c2Vyc1xuLy8gc3VwcG9ydCBieSBub3cgcmVjZWl2aW5nIGluIHRoaXMgZm9ybWF0LCB1bmxlc3Mgd2Ugb3JpZ2luYWxseSBwYXJzZWRcbi8vIGFzIHRoZSBkcmFmdC1pZXRmLW1tdXNpYy1zY3RwLXNkcC0wNSBmb3JtYXQgKGluZGljYXRlZCBieSB0aGUgbS1saW5lXG4vLyBwcm90b2NvbCBvZiBEVExTL1NDVFAgLS0gd2l0aG91dCBVRFAvIG9yIFRDUC8pXG5TRFBVdGlscy53cml0ZVNjdHBEZXNjcmlwdGlvbiA9IGZ1bmN0aW9uKG1lZGlhLCBzY3RwKSB7XG4gIGxldCBvdXRwdXQgPSBbXTtcbiAgaWYgKG1lZGlhLnByb3RvY29sICE9PSAnRFRMUy9TQ1RQJykge1xuICAgIG91dHB1dCA9IFtcbiAgICAgICdtPScgKyBtZWRpYS5raW5kICsgJyA5ICcgKyBtZWRpYS5wcm90b2NvbCArICcgJyArIHNjdHAucHJvdG9jb2wgKyAnXFxyXFxuJyxcbiAgICAgICdjPUlOIElQNCAwLjAuMC4wXFxyXFxuJyxcbiAgICAgICdhPXNjdHAtcG9ydDonICsgc2N0cC5wb3J0ICsgJ1xcclxcbicsXG4gICAgXTtcbiAgfSBlbHNlIHtcbiAgICBvdXRwdXQgPSBbXG4gICAgICAnbT0nICsgbWVkaWEua2luZCArICcgOSAnICsgbWVkaWEucHJvdG9jb2wgKyAnICcgKyBzY3RwLnBvcnQgKyAnXFxyXFxuJyxcbiAgICAgICdjPUlOIElQNCAwLjAuMC4wXFxyXFxuJyxcbiAgICAgICdhPXNjdHBtYXA6JyArIHNjdHAucG9ydCArICcgJyArIHNjdHAucHJvdG9jb2wgKyAnIDY1NTM1XFxyXFxuJyxcbiAgICBdO1xuICB9XG4gIGlmIChzY3RwLm1heE1lc3NhZ2VTaXplICE9PSB1bmRlZmluZWQpIHtcbiAgICBvdXRwdXQucHVzaCgnYT1tYXgtbWVzc2FnZS1zaXplOicgKyBzY3RwLm1heE1lc3NhZ2VTaXplICsgJ1xcclxcbicpO1xuICB9XG4gIHJldHVybiBvdXRwdXQuam9pbignJyk7XG59O1xuXG4vLyBHZW5lcmF0ZSBhIHNlc3Npb24gSUQgZm9yIFNEUC5cbi8vIGh0dHBzOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9kcmFmdC1pZXRmLXJ0Y3dlYi1qc2VwLTIwI3NlY3Rpb24tNS4yLjFcbi8vIHJlY29tbWVuZHMgdXNpbmcgYSBjcnlwdG9ncmFwaGljYWxseSByYW5kb20gK3ZlIDY0LWJpdCB2YWx1ZVxuLy8gYnV0IHJpZ2h0IG5vdyB0aGlzIHNob3VsZCBiZSBhY2NlcHRhYmxlIGFuZCB3aXRoaW4gdGhlIHJpZ2h0IHJhbmdlXG5TRFBVdGlscy5nZW5lcmF0ZVNlc3Npb25JZCA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gTWF0aC5yYW5kb20oKS50b1N0cmluZygpLnN1YnN0cigyLCAyMik7XG59O1xuXG4vLyBXcml0ZSBib2lsZXIgcGxhdGUgZm9yIHN0YXJ0IG9mIFNEUFxuLy8gc2Vzc0lkIGFyZ3VtZW50IGlzIG9wdGlvbmFsIC0gaWYgbm90IHN1cHBsaWVkIGl0IHdpbGxcbi8vIGJlIGdlbmVyYXRlZCByYW5kb21seVxuLy8gc2Vzc1ZlcnNpb24gaXMgb3B0aW9uYWwgYW5kIGRlZmF1bHRzIHRvIDJcbi8vIHNlc3NVc2VyIGlzIG9wdGlvbmFsIGFuZCBkZWZhdWx0cyB0byAndGhpc2lzYWRhcHRlcm9ydGMnXG5TRFBVdGlscy53cml0ZVNlc3Npb25Cb2lsZXJwbGF0ZSA9IGZ1bmN0aW9uKHNlc3NJZCwgc2Vzc1Zlciwgc2Vzc1VzZXIpIHtcbiAgbGV0IHNlc3Npb25JZDtcbiAgY29uc3QgdmVyc2lvbiA9IHNlc3NWZXIgIT09IHVuZGVmaW5lZCA/IHNlc3NWZXIgOiAyO1xuICBpZiAoc2Vzc0lkKSB7XG4gICAgc2Vzc2lvbklkID0gc2Vzc0lkO1xuICB9IGVsc2Uge1xuICAgIHNlc3Npb25JZCA9IFNEUFV0aWxzLmdlbmVyYXRlU2Vzc2lvbklkKCk7XG4gIH1cbiAgY29uc3QgdXNlciA9IHNlc3NVc2VyIHx8ICd0aGlzaXNhZGFwdGVyb3J0Yyc7XG4gIC8vIEZJWE1FOiBzZXNzLWlkIHNob3VsZCBiZSBhbiBOVFAgdGltZXN0YW1wLlxuICByZXR1cm4gJ3Y9MFxcclxcbicgK1xuICAgICAgJ289JyArIHVzZXIgKyAnICcgKyBzZXNzaW9uSWQgKyAnICcgKyB2ZXJzaW9uICtcbiAgICAgICAgJyBJTiBJUDQgMTI3LjAuMC4xXFxyXFxuJyArXG4gICAgICAncz0tXFxyXFxuJyArXG4gICAgICAndD0wIDBcXHJcXG4nO1xufTtcblxuLy8gR2V0cyB0aGUgZGlyZWN0aW9uIGZyb20gdGhlIG1lZGlhU2VjdGlvbiBvciB0aGUgc2Vzc2lvbnBhcnQuXG5TRFBVdGlscy5nZXREaXJlY3Rpb24gPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24sIHNlc3Npb25wYXJ0KSB7XG4gIC8vIExvb2sgZm9yIHNlbmRyZWN2LCBzZW5kb25seSwgcmVjdm9ubHksIGluYWN0aXZlLCBkZWZhdWx0IHRvIHNlbmRyZWN2LlxuICBjb25zdCBsaW5lcyA9IFNEUFV0aWxzLnNwbGl0TGluZXMobWVkaWFTZWN0aW9uKTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBsaW5lcy5sZW5ndGg7IGkrKykge1xuICAgIHN3aXRjaCAobGluZXNbaV0pIHtcbiAgICAgIGNhc2UgJ2E9c2VuZHJlY3YnOlxuICAgICAgY2FzZSAnYT1zZW5kb25seSc6XG4gICAgICBjYXNlICdhPXJlY3Zvbmx5JzpcbiAgICAgIGNhc2UgJ2E9aW5hY3RpdmUnOlxuICAgICAgICByZXR1cm4gbGluZXNbaV0uc3Vic3RyaW5nKDIpO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgLy8gRklYTUU6IFdoYXQgc2hvdWxkIGhhcHBlbiBoZXJlP1xuICAgIH1cbiAgfVxuICBpZiAoc2Vzc2lvbnBhcnQpIHtcbiAgICByZXR1cm4gU0RQVXRpbHMuZ2V0RGlyZWN0aW9uKHNlc3Npb25wYXJ0KTtcbiAgfVxuICByZXR1cm4gJ3NlbmRyZWN2Jztcbn07XG5cblNEUFV0aWxzLmdldEtpbmQgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgY29uc3QgbGluZXMgPSBTRFBVdGlscy5zcGxpdExpbmVzKG1lZGlhU2VjdGlvbik7XG4gIGNvbnN0IG1saW5lID0gbGluZXNbMF0uc3BsaXQoJyAnKTtcbiAgcmV0dXJuIG1saW5lWzBdLnN1YnN0cmluZygyKTtcbn07XG5cblNEUFV0aWxzLmlzUmVqZWN0ZWQgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgcmV0dXJuIG1lZGlhU2VjdGlvbi5zcGxpdCgnICcsIDIpWzFdID09PSAnMCc7XG59O1xuXG5TRFBVdGlscy5wYXJzZU1MaW5lID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIGNvbnN0IGxpbmVzID0gU0RQVXRpbHMuc3BsaXRMaW5lcyhtZWRpYVNlY3Rpb24pO1xuICBjb25zdCBwYXJ0cyA9IGxpbmVzWzBdLnN1YnN0cmluZygyKS5zcGxpdCgnICcpO1xuICByZXR1cm4ge1xuICAgIGtpbmQ6IHBhcnRzWzBdLFxuICAgIHBvcnQ6IHBhcnNlSW50KHBhcnRzWzFdLCAxMCksXG4gICAgcHJvdG9jb2w6IHBhcnRzWzJdLFxuICAgIGZtdDogcGFydHMuc2xpY2UoMykuam9pbignICcpLFxuICB9O1xufTtcblxuU0RQVXRpbHMucGFyc2VPTGluZSA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbikge1xuICBjb25zdCBsaW5lID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnbz0nKVswXTtcbiAgY29uc3QgcGFydHMgPSBsaW5lLnN1YnN0cmluZygyKS5zcGxpdCgnICcpO1xuICByZXR1cm4ge1xuICAgIHVzZXJuYW1lOiBwYXJ0c1swXSxcbiAgICBzZXNzaW9uSWQ6IHBhcnRzWzFdLFxuICAgIHNlc3Npb25WZXJzaW9uOiBwYXJzZUludChwYXJ0c1syXSwgMTApLFxuICAgIG5ldFR5cGU6IHBhcnRzWzNdLFxuICAgIGFkZHJlc3NUeXBlOiBwYXJ0c1s0XSxcbiAgICBhZGRyZXNzOiBwYXJ0c1s1XSxcbiAgfTtcbn07XG5cbi8vIGEgdmVyeSBuYWl2ZSBpbnRlcnByZXRhdGlvbiBvZiBhIHZhbGlkIFNEUC5cblNEUFV0aWxzLmlzVmFsaWRTRFAgPSBmdW5jdGlvbihibG9iKSB7XG4gIGlmICh0eXBlb2YgYmxvYiAhPT0gJ3N0cmluZycgfHwgYmxvYi5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgY29uc3QgbGluZXMgPSBTRFBVdGlscy5zcGxpdExpbmVzKGJsb2IpO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGxpbmVzLmxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKGxpbmVzW2ldLmxlbmd0aCA8IDIgfHwgbGluZXNbaV0uY2hhckF0KDEpICE9PSAnPScpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgLy8gVE9ETzogY2hlY2sgdGhlIG1vZGlmaWVyIGEgYml0IG1vcmUuXG4gIH1cbiAgcmV0dXJuIHRydWU7XG59O1xuXG4vLyBFeHBvc2UgcHVibGljIG1ldGhvZHMuXG5pZiAodHlwZW9mIG1vZHVsZSA9PT0gJ29iamVjdCcpIHtcbiAgbW9kdWxlLmV4cG9ydHMgPSBTRFBVdGlscztcbn1cbiIsIi8vIFRoZSBtb2R1bGUgY2FjaGVcbnZhciBfX3dlYnBhY2tfbW9kdWxlX2NhY2hlX18gPSB7fTtcblxuLy8gVGhlIHJlcXVpcmUgZnVuY3Rpb25cbmZ1bmN0aW9uIF9fd2VicGFja19yZXF1aXJlX18obW9kdWxlSWQpIHtcblx0Ly8gQ2hlY2sgaWYgbW9kdWxlIGlzIGluIGNhY2hlXG5cdHZhciBjYWNoZWRNb2R1bGUgPSBfX3dlYnBhY2tfbW9kdWxlX2NhY2hlX19bbW9kdWxlSWRdO1xuXHRpZiAoY2FjaGVkTW9kdWxlICE9PSB1bmRlZmluZWQpIHtcblx0XHRyZXR1cm4gY2FjaGVkTW9kdWxlLmV4cG9ydHM7XG5cdH1cblx0Ly8gQ3JlYXRlIGEgbmV3IG1vZHVsZSAoYW5kIHB1dCBpdCBpbnRvIHRoZSBjYWNoZSlcblx0dmFyIG1vZHVsZSA9IF9fd2VicGFja19tb2R1bGVfY2FjaGVfX1ttb2R1bGVJZF0gPSB7XG5cdFx0Ly8gbm8gbW9kdWxlLmlkIG5lZWRlZFxuXHRcdC8vIG5vIG1vZHVsZS5sb2FkZWQgbmVlZGVkXG5cdFx0ZXhwb3J0czoge31cblx0fTtcblxuXHQvLyBFeGVjdXRlIHRoZSBtb2R1bGUgZnVuY3Rpb25cblx0X193ZWJwYWNrX21vZHVsZXNfX1ttb2R1bGVJZF0obW9kdWxlLCBtb2R1bGUuZXhwb3J0cywgX193ZWJwYWNrX3JlcXVpcmVfXyk7XG5cblx0Ly8gUmV0dXJuIHRoZSBleHBvcnRzIG9mIHRoZSBtb2R1bGVcblx0cmV0dXJuIG1vZHVsZS5leHBvcnRzO1xufVxuXG4iLCIiLCIvLyBzdGFydHVwXG4vLyBMb2FkIGVudHJ5IG1vZHVsZSBhbmQgcmV0dXJuIGV4cG9ydHNcbi8vIFRoaXMgZW50cnkgbW9kdWxlIGlzIHJlZmVyZW5jZWQgYnkgb3RoZXIgbW9kdWxlcyBzbyBpdCBjYW4ndCBiZSBpbmxpbmVkXG52YXIgX193ZWJwYWNrX2V4cG9ydHNfXyA9IF9fd2VicGFja19yZXF1aXJlX18oXCIuL3NyYy9pbmRleC5qc1wiKTtcbiIsIiJdLCJuYW1lcyI6WyJtaiIsInJlcXVpcmUiLCJKYW51c1Nlc3Npb24iLCJwcm90b3R5cGUiLCJzZW5kT3JpZ2luYWwiLCJzZW5kIiwidHlwZSIsInNpZ25hbCIsImNhdGNoIiwiZSIsIm1lc3NhZ2UiLCJpbmRleE9mIiwiY29uc29sZSIsImVycm9yIiwiTkFGIiwiY29ubmVjdGlvbiIsImFkYXB0ZXIiLCJyZWNvbm5lY3QiLCJzZHBVdGlscyIsImRlYnVnIiwid2FybiIsImlzU2FmYXJpIiwidGVzdCIsIm5hdmlnYXRvciIsInVzZXJBZ2VudCIsIlNVQlNDUklCRV9USU1FT1VUX01TIiwiQVZBSUxBQkxFX09DQ1VQQU5UU19USFJFU0hPTEQiLCJNQVhfU1VCU0NSSUJFX0RFTEFZIiwicmFuZG9tRGVsYXkiLCJtaW4iLCJtYXgiLCJQcm9taXNlIiwicmVzb2x2ZSIsImRlbGF5IiwiTWF0aCIsInJhbmRvbSIsInNldFRpbWVvdXQiLCJkZWJvdW5jZSIsImZuIiwiY3VyciIsImFyZ3MiLCJBcnJheSIsInNsaWNlIiwiY2FsbCIsImFyZ3VtZW50cyIsInRoZW4iLCJfIiwiYXBwbHkiLCJyYW5kb21VaW50IiwiZmxvb3IiLCJOdW1iZXIiLCJNQVhfU0FGRV9JTlRFR0VSIiwidW50aWxEYXRhQ2hhbm5lbE9wZW4iLCJkYXRhQ2hhbm5lbCIsInJlamVjdCIsInJlYWR5U3RhdGUiLCJyZXNvbHZlciIsInJlamVjdG9yIiwiY2xlYXIiLCJyZW1vdmVFdmVudExpc3RlbmVyIiwiYWRkRXZlbnRMaXN0ZW5lciIsImlzSDI2NFZpZGVvU3VwcG9ydGVkIiwidmlkZW8iLCJkb2N1bWVudCIsImNyZWF0ZUVsZW1lbnQiLCJjYW5QbGF5VHlwZSIsIk9QVVNfUEFSQU1FVEVSUyIsInVzZWR0eCIsInN0ZXJlbyIsIkRFRkFVTFRfUEVFUl9DT05ORUNUSU9OX0NPTkZJRyIsImljZVNlcnZlcnMiLCJ1cmxzIiwiV1NfTk9STUFMX0NMT1NVUkUiLCJKYW51c0FkYXB0ZXIiLCJjb25zdHJ1Y3RvciIsInJvb20iLCJjbGllbnRJZCIsImpvaW5Ub2tlbiIsInNlcnZlclVybCIsIndlYlJ0Y09wdGlvbnMiLCJwZWVyQ29ubmVjdGlvbkNvbmZpZyIsIndzIiwic2Vzc2lvbiIsInJlbGlhYmxlVHJhbnNwb3J0IiwidW5yZWxpYWJsZVRyYW5zcG9ydCIsImluaXRpYWxSZWNvbm5lY3Rpb25EZWxheSIsInJlY29ubmVjdGlvbkRlbGF5IiwicmVjb25uZWN0aW9uVGltZW91dCIsIm1heFJlY29ubmVjdGlvbkF0dGVtcHRzIiwicmVjb25uZWN0aW9uQXR0ZW1wdHMiLCJwdWJsaXNoZXIiLCJvY2N1cGFudElkcyIsIm9jY3VwYW50cyIsIm1lZGlhU3RyZWFtcyIsImxvY2FsTWVkaWFTdHJlYW0iLCJwZW5kaW5nTWVkaWFSZXF1ZXN0cyIsIk1hcCIsInBlbmRpbmdPY2N1cGFudHMiLCJTZXQiLCJhdmFpbGFibGVPY2N1cGFudHMiLCJyZXF1ZXN0ZWRPY2N1cGFudHMiLCJibG9ja2VkQ2xpZW50cyIsImZyb3plblVwZGF0ZXMiLCJ0aW1lT2Zmc2V0cyIsInNlcnZlclRpbWVSZXF1ZXN0cyIsImF2Z1RpbWVPZmZzZXQiLCJvbldlYnNvY2tldE9wZW4iLCJiaW5kIiwib25XZWJzb2NrZXRDbG9zZSIsIm9uV2Vic29ja2V0TWVzc2FnZSIsIm9uRGF0YUNoYW5uZWxNZXNzYWdlIiwib25EYXRhIiwic2V0U2VydmVyVXJsIiwidXJsIiwic2V0QXBwIiwiYXBwIiwic2V0Um9vbSIsInJvb21OYW1lIiwic2V0Sm9pblRva2VuIiwic2V0Q2xpZW50SWQiLCJzZXRXZWJSdGNPcHRpb25zIiwib3B0aW9ucyIsInNldFBlZXJDb25uZWN0aW9uQ29uZmlnIiwic2V0U2VydmVyQ29ubmVjdExpc3RlbmVycyIsInN1Y2Nlc3NMaXN0ZW5lciIsImZhaWx1cmVMaXN0ZW5lciIsImNvbm5lY3RTdWNjZXNzIiwiY29ubmVjdEZhaWx1cmUiLCJzZXRSb29tT2NjdXBhbnRMaXN0ZW5lciIsIm9jY3VwYW50TGlzdGVuZXIiLCJvbk9jY3VwYW50c0NoYW5nZWQiLCJzZXREYXRhQ2hhbm5lbExpc3RlbmVycyIsIm9wZW5MaXN0ZW5lciIsImNsb3NlZExpc3RlbmVyIiwibWVzc2FnZUxpc3RlbmVyIiwib25PY2N1cGFudENvbm5lY3RlZCIsIm9uT2NjdXBhbnREaXNjb25uZWN0ZWQiLCJvbk9jY3VwYW50TWVzc2FnZSIsInNldFJlY29ubmVjdGlvbkxpc3RlbmVycyIsInJlY29ubmVjdGluZ0xpc3RlbmVyIiwicmVjb25uZWN0ZWRMaXN0ZW5lciIsInJlY29ubmVjdGlvbkVycm9yTGlzdGVuZXIiLCJvblJlY29ubmVjdGluZyIsIm9uUmVjb25uZWN0ZWQiLCJvblJlY29ubmVjdGlvbkVycm9yIiwic2V0RXZlbnRMb29wcyIsImxvb3BzIiwiY29ubmVjdCIsIndlYnNvY2tldENvbm5lY3Rpb24iLCJXZWJTb2NrZXQiLCJ0aW1lb3V0TXMiLCJ3c09uT3BlbiIsImFsbCIsInVwZGF0ZVRpbWVPZmZzZXQiLCJkaXNjb25uZWN0IiwiY2xlYXJUaW1lb3V0IiwicmVtb3ZlQWxsT2NjdXBhbnRzIiwiY29ubiIsImNsb3NlIiwiZGlzcG9zZSIsImRlbGF5ZWRSZWNvbm5lY3RUaW1lb3V0IiwiaXNEaXNjb25uZWN0ZWQiLCJjcmVhdGUiLCJjcmVhdGVQdWJsaXNoZXIiLCJpIiwiaW5pdGlhbE9jY3VwYW50cyIsImxlbmd0aCIsIm9jY3VwYW50SWQiLCJhZGRBdmFpbGFibGVPY2N1cGFudCIsInN5bmNPY2N1cGFudHMiLCJldmVudCIsImNvZGUiLCJFcnJvciIsInBlcmZvcm1EZWxheWVkUmVjb25uZWN0IiwicmVjZWl2ZSIsIkpTT04iLCJwYXJzZSIsImRhdGEiLCJwdXNoIiwicmVtb3ZlQXZhaWxhYmxlT2NjdXBhbnQiLCJpZHgiLCJzcGxpY2UiLCJoYXMiLCJhZGRPY2N1cGFudCIsImoiLCJyZW1vdmVPY2N1cGFudCIsImFkZCIsImF2YWlsYWJsZU9jY3VwYW50c0NvdW50Iiwic3Vic2NyaWJlciIsImNyZWF0ZVN1YnNjcmliZXIiLCJkZWxldGUiLCJzZXRNZWRpYVN0cmVhbSIsIm1lZGlhU3RyZWFtIiwibXNnIiwiZ2V0IiwiYXVkaW8iLCJhc3NvY2lhdGUiLCJoYW5kbGUiLCJldiIsInNlbmRUcmlja2xlIiwiY2FuZGlkYXRlIiwiaWNlQ29ubmVjdGlvblN0YXRlIiwibG9nIiwib2ZmZXIiLCJjcmVhdGVPZmZlciIsImNvbmZpZ3VyZVB1Ymxpc2hlclNkcCIsImZpeFNhZmFyaUljZVVGcmFnIiwibG9jYWwiLCJvIiwic2V0TG9jYWxEZXNjcmlwdGlvbiIsInJlbW90ZSIsInNlbmRKc2VwIiwiciIsInNldFJlbW90ZURlc2NyaXB0aW9uIiwianNlcCIsIm9uIiwiYW5zd2VyIiwiY29uZmlndXJlU3Vic2NyaWJlclNkcCIsImNyZWF0ZUFuc3dlciIsImEiLCJKYW51c1BsdWdpbkhhbmRsZSIsIlJUQ1BlZXJDb25uZWN0aW9uIiwiYXR0YWNoIiwicGFyc2VJbnQiLCJ1bmRlZmluZWQiLCJ3ZWJydGN1cCIsInJlbGlhYmxlQ2hhbm5lbCIsImNyZWF0ZURhdGFDaGFubmVsIiwib3JkZXJlZCIsInVucmVsaWFibGVDaGFubmVsIiwibWF4UmV0cmFuc21pdHMiLCJnZXRUcmFja3MiLCJmb3JFYWNoIiwidHJhY2siLCJhZGRUcmFjayIsInBsdWdpbmRhdGEiLCJyb29tX2lkIiwidXNlcl9pZCIsImJvZHkiLCJkaXNwYXRjaEV2ZW50IiwiQ3VzdG9tRXZlbnQiLCJkZXRhaWwiLCJieSIsInNlbmRKb2luIiwibm90aWZpY2F0aW9ucyIsInN1Y2Nlc3MiLCJlcnIiLCJyZXNwb25zZSIsInVzZXJzIiwiaW5jbHVkZXMiLCJzZHAiLCJyZXBsYWNlIiwibGluZSIsInB0IiwicGFyYW1ldGVycyIsIk9iamVjdCIsImFzc2lnbiIsInBhcnNlRm10cCIsIndyaXRlRm10cCIsInBheWxvYWRUeXBlIiwibWF4UmV0cmllcyIsIndlYnJ0Y0ZhaWxlZCIsImxlZnRJbnRlcnZhbCIsInNldEludGVydmFsIiwiY2xlYXJJbnRlcnZhbCIsInRpbWVvdXQiLCJtZWRpYSIsIl9pT1NIYWNrRGVsYXllZEluaXRpYWxQZWVyIiwiTWVkaWFTdHJlYW0iLCJyZWNlaXZlcnMiLCJnZXRSZWNlaXZlcnMiLCJyZWNlaXZlciIsInN1YnNjcmliZSIsInNlbmRNZXNzYWdlIiwia2luZCIsInRva2VuIiwidG9nZ2xlRnJlZXplIiwiZnJvemVuIiwidW5mcmVlemUiLCJmcmVlemUiLCJmbHVzaFBlbmRpbmdVcGRhdGVzIiwiZGF0YUZvclVwZGF0ZU11bHRpTWVzc2FnZSIsIm5ldHdvcmtJZCIsImwiLCJkIiwiZ2V0UGVuZGluZ0RhdGEiLCJkYXRhVHlwZSIsIm93bmVyIiwiZ2V0UGVuZGluZ0RhdGFGb3JOZXR3b3JrSWQiLCJzb3VyY2UiLCJzdG9yZU1lc3NhZ2UiLCJzdG9yZVNpbmdsZU1lc3NhZ2UiLCJpbmRleCIsInNldCIsInN0b3JlZE1lc3NhZ2UiLCJzdG9yZWREYXRhIiwiaXNPdXRkYXRlZE1lc3NhZ2UiLCJsYXN0T3duZXJUaW1lIiwiaXNDb250ZW1wb3JhbmVvdXNNZXNzYWdlIiwiY3JlYXRlZFdoaWxlRnJvemVuIiwiaXNGaXJzdFN5bmMiLCJjb21wb25lbnRzIiwiZW5hYmxlZCIsInNob3VsZFN0YXJ0Q29ubmVjdGlvblRvIiwiY2xpZW50Iiwic3RhcnRTdHJlYW1Db25uZWN0aW9uIiwiY2xvc2VTdHJlYW1Db25uZWN0aW9uIiwiZ2V0Q29ubmVjdFN0YXR1cyIsImFkYXB0ZXJzIiwiSVNfQ09OTkVDVEVEIiwiTk9UX0NPTk5FQ1RFRCIsImNsaWVudFNlbnRUaW1lIiwiRGF0ZSIsIm5vdyIsInJlcyIsImZldGNoIiwibG9jYXRpb24iLCJocmVmIiwibWV0aG9kIiwiY2FjaGUiLCJwcmVjaXNpb24iLCJzZXJ2ZXJSZWNlaXZlZFRpbWUiLCJoZWFkZXJzIiwiZ2V0VGltZSIsImNsaWVudFJlY2VpdmVkVGltZSIsInNlcnZlclRpbWUiLCJ0aW1lT2Zmc2V0IiwicmVkdWNlIiwiYWNjIiwib2Zmc2V0IiwiZ2V0U2VydmVyVGltZSIsImdldE1lZGlhU3RyZWFtIiwiYXVkaW9Qcm9taXNlIiwidmlkZW9Qcm9taXNlIiwicHJvbWlzZSIsInN0cmVhbSIsImF1ZGlvU3RyZWFtIiwiZ2V0QXVkaW9UcmFja3MiLCJ2aWRlb1N0cmVhbSIsImdldFZpZGVvVHJhY2tzIiwiZ2V0TG9jYWxNZWRpYVN0cmVhbSIsInNldExvY2FsTWVkaWFTdHJlYW0iLCJleGlzdGluZ1NlbmRlcnMiLCJnZXRTZW5kZXJzIiwibmV3U2VuZGVycyIsInRyYWNrcyIsInQiLCJzZW5kZXIiLCJmaW5kIiwicyIsInJlcGxhY2VUcmFjayIsInJlbW92ZVRyYWNrIiwiZW5hYmxlTWljcm9waG9uZSIsInNlbmREYXRhIiwic3RyaW5naWZ5Iiwid2hvbSIsInNlbmREYXRhR3VhcmFudGVlZCIsImJyb2FkY2FzdERhdGEiLCJicm9hZGNhc3REYXRhR3VhcmFudGVlZCIsImtpY2siLCJwZXJtc1Rva2VuIiwiYmxvY2siLCJ1bmJsb2NrIiwicmVnaXN0ZXIiLCJtb2R1bGUiLCJleHBvcnRzIl0sInNvdXJjZVJvb3QiOiIifQ==