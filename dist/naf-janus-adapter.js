/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ "./node_modules/@networked-aframe/minijanus/minijanus.js"
/*!***************************************************************!*\
  !*** ./node_modules/@networked-aframe/minijanus/minijanus.js ***!
  \***************************************************************/
(module) {

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


/***/ },

/***/ "./src/index.js"
/*!**********************!*\
  !*** ./src/index.js ***!
  \**********************/
(module, __unused_webpack_exports, __webpack_require__) {

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

/***/ },

/***/ "./node_modules/sdp/sdp.js"
/*!*********************************!*\
  !*** ./node_modules/sdp/sdp.js ***!
  \*********************************/
(module) {

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
      candidate.relatedPort !== undefined) {
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
// Non-key-value such as telephone-events `0-15` get parsed as
// {`0-15`:undefined}
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


/***/ }

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
/******/ 		if (!(moduleId in __webpack_modules__)) {
/******/ 			delete __webpack_module_cache__[moduleId];
/******/ 			var e = new Error("Cannot find module '" + moduleId + "'");
/******/ 			e.code = 'MODULE_NOT_FOUND';
/******/ 			throw e;
/******/ 		}
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,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QUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBLG9CQUFvQjtBQUNwQiwyQkFBMkI7QUFDM0I7QUFDQSxJQUFJO0FBQ0o7QUFDQTtBQUNBO0FBQ0EsOERBQThEO0FBQzlELGtCQUFrQixrQkFBa0I7QUFDcEM7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxRQUFRO0FBQ1I7QUFDQTtBQUNBLEtBQUs7QUFDTCxpREFBaUQ7QUFDakQ7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEtBQUs7QUFDTDtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLElBQUk7QUFDSjtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsR0FBRztBQUNIO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0Esa0JBQWtCLGtCQUFrQixPQUFPO0FBQzNDO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxHQUFHO0FBQ0g7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxPQUFPO0FBQ1A7QUFDQTtBQUNBO0FBQ0EsS0FBSztBQUNMLEdBQUc7QUFDSDtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBLDZDQUE2QztBQUM3QztBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxHQUFHOztBQUVIO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEdBQUc7QUFDSDtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsR0FBRztBQUNIO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQSxLQUFLO0FBQ0w7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsS0FBSztBQUNMO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLHdCQUF3QjtBQUN4QjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsR0FBRztBQUNIO0FBQ0E7QUFDQTtBQUNBLEtBQUs7QUFDTDs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsTUFBTTtBQUNOO0FBQ0E7QUFDQTtBQUNBLE1BQU07QUFDTjtBQUNBO0FBQ0E7QUFDQTtBQUNBLEtBQUs7QUFDTDtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FBR0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxZQUFZO0FBQ1o7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsWUFBWTtBQUNaO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsSUFBSTtBQUNKO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxJQUFJO0FBQ0o7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQSxrQkFBa0Isa0JBQWtCO0FBQ3BDO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0Esa0JBQWtCLGtCQUFrQjtBQUNwQztBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBLElBQUksSUFBMEI7QUFDOUI7QUFDQTs7Ozs7OztVQ255QkE7VUFDQTs7VUFFQTtVQUNBO1VBQ0E7VUFDQTtVQUNBO1VBQ0E7VUFDQTtVQUNBO1VBQ0E7VUFDQTtVQUNBO1VBQ0E7VUFDQTs7VUFFQTtVQUNBO1VBQ0E7VUFDQTtVQUNBO1VBQ0E7VUFDQTtVQUNBOztVQUVBO1VBQ0E7VUFDQTs7OztVRTVCQTtVQUNBO1VBQ0E7VUFDQSIsInNvdXJjZXMiOlsid2VicGFjazovL0BuZXR3b3JrZWQtYWZyYW1lL25hZi1qYW51cy1hZGFwdGVyLy4vbm9kZV9tb2R1bGVzL0BuZXR3b3JrZWQtYWZyYW1lL21pbmlqYW51cy9taW5pamFudXMuanMiLCJ3ZWJwYWNrOi8vQG5ldHdvcmtlZC1hZnJhbWUvbmFmLWphbnVzLWFkYXB0ZXIvLi9zcmMvaW5kZXguanMiLCJ3ZWJwYWNrOi8vQG5ldHdvcmtlZC1hZnJhbWUvbmFmLWphbnVzLWFkYXB0ZXIvLi9ub2RlX21vZHVsZXMvc2RwL3NkcC5qcyIsIndlYnBhY2s6Ly9AbmV0d29ya2VkLWFmcmFtZS9uYWYtamFudXMtYWRhcHRlci93ZWJwYWNrL2Jvb3RzdHJhcCIsIndlYnBhY2s6Ly9AbmV0d29ya2VkLWFmcmFtZS9uYWYtamFudXMtYWRhcHRlci93ZWJwYWNrL2JlZm9yZS1zdGFydHVwIiwid2VicGFjazovL0BuZXR3b3JrZWQtYWZyYW1lL25hZi1qYW51cy1hZGFwdGVyL3dlYnBhY2svc3RhcnR1cCIsIndlYnBhY2s6Ly9AbmV0d29ya2VkLWFmcmFtZS9uYWYtamFudXMtYWRhcHRlci93ZWJwYWNrL2FmdGVyLXN0YXJ0dXAiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBSZXByZXNlbnRzIGEgaGFuZGxlIHRvIGEgc2luZ2xlIEphbnVzIHBsdWdpbiBvbiBhIEphbnVzIHNlc3Npb24uIEVhY2ggV2ViUlRDIGNvbm5lY3Rpb24gdG8gdGhlIEphbnVzIHNlcnZlciB3aWxsIGJlXG4gKiBhc3NvY2lhdGVkIHdpdGggYSBzaW5nbGUgaGFuZGxlLiBPbmNlIGF0dGFjaGVkIHRvIHRoZSBzZXJ2ZXIsIHRoaXMgaGFuZGxlIHdpbGwgYmUgZ2l2ZW4gYSB1bmlxdWUgSUQgd2hpY2ggc2hvdWxkIGJlXG4gKiB1c2VkIHRvIGFzc29jaWF0ZSBpdCB3aXRoIGZ1dHVyZSBzaWduYWxsaW5nIG1lc3NhZ2VzLlxuICpcbiAqIFNlZSBodHRwczovL2phbnVzLmNvbmYubWVldGVjaG8uY29tL2RvY3MvcmVzdC5odG1sI2hhbmRsZXMuXG4gKiovXG5mdW5jdGlvbiBKYW51c1BsdWdpbkhhbmRsZShzZXNzaW9uKSB7XG4gIHRoaXMuc2Vzc2lvbiA9IHNlc3Npb247XG4gIHRoaXMuaWQgPSB1bmRlZmluZWQ7XG59XG5cbi8qKiBBdHRhY2hlcyB0aGlzIGhhbmRsZSB0byB0aGUgSmFudXMgc2VydmVyIGFuZCBzZXRzIGl0cyBJRC4gKiovXG5KYW51c1BsdWdpbkhhbmRsZS5wcm90b3R5cGUuYXR0YWNoID0gZnVuY3Rpb24ocGx1Z2luLCBsb29wX2luZGV4KSB7XG4gIHZhciBwYXlsb2FkID0geyBwbHVnaW46IHBsdWdpbiwgbG9vcF9pbmRleDogbG9vcF9pbmRleCwgXCJmb3JjZS1idW5kbGVcIjogdHJ1ZSwgXCJmb3JjZS1ydGNwLW11eFwiOiB0cnVlIH07XG4gIHJldHVybiB0aGlzLnNlc3Npb24uc2VuZChcImF0dGFjaFwiLCBwYXlsb2FkKS50aGVuKHJlc3AgPT4ge1xuICAgIHRoaXMuaWQgPSByZXNwLmRhdGEuaWQ7XG4gICAgcmV0dXJuIHJlc3A7XG4gIH0pO1xufTtcblxuLyoqIERldGFjaGVzIHRoaXMgaGFuZGxlLiAqKi9cbkphbnVzUGx1Z2luSGFuZGxlLnByb3RvdHlwZS5kZXRhY2ggPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuc2VuZChcImRldGFjaFwiKTtcbn07XG5cbi8qKiBSZWdpc3RlcnMgYSBjYWxsYmFjayB0byBiZSBmaXJlZCB1cG9uIHRoZSByZWNlcHRpb24gb2YgYW55IGluY29taW5nIEphbnVzIHNpZ25hbHMgZm9yIHRoaXMgcGx1Z2luIGhhbmRsZSB3aXRoIHRoZVxuICogYGphbnVzYCBhdHRyaWJ1dGUgZXF1YWwgdG8gYGV2YC5cbiAqKi9cbkphbnVzUGx1Z2luSGFuZGxlLnByb3RvdHlwZS5vbiA9IGZ1bmN0aW9uKGV2LCBjYWxsYmFjaykge1xuICByZXR1cm4gdGhpcy5zZXNzaW9uLm9uKGV2LCBzaWduYWwgPT4ge1xuICAgIGlmIChzaWduYWwuc2VuZGVyID09IHRoaXMuaWQpIHtcbiAgICAgIGNhbGxiYWNrKHNpZ25hbCk7XG4gICAgfVxuICB9KTtcbn07XG5cbi8qKlxuICogU2VuZHMgYSBzaWduYWwgYXNzb2NpYXRlZCB3aXRoIHRoaXMgaGFuZGxlLiBTaWduYWxzIHNob3VsZCBiZSBKU09OLXNlcmlhbGl6YWJsZSBvYmplY3RzLiBSZXR1cm5zIGEgcHJvbWlzZSB0aGF0IHdpbGxcbiAqIGJlIHJlc29sdmVkIG9yIHJlamVjdGVkIHdoZW4gYSByZXNwb25zZSB0byB0aGlzIHNpZ25hbCBpcyByZWNlaXZlZCwgb3Igd2hlbiBubyByZXNwb25zZSBpcyByZWNlaXZlZCB3aXRoaW4gdGhlXG4gKiBzZXNzaW9uIHRpbWVvdXQuXG4gKiovXG5KYW51c1BsdWdpbkhhbmRsZS5wcm90b3R5cGUuc2VuZCA9IGZ1bmN0aW9uKHR5cGUsIHNpZ25hbCkge1xuICByZXR1cm4gdGhpcy5zZXNzaW9uLnNlbmQodHlwZSwgT2JqZWN0LmFzc2lnbih7IGhhbmRsZV9pZDogdGhpcy5pZCB9LCBzaWduYWwpKTtcbn07XG5cbi8qKiBTZW5kcyBhIHBsdWdpbi1zcGVjaWZpYyBtZXNzYWdlIGFzc29jaWF0ZWQgd2l0aCB0aGlzIGhhbmRsZS4gKiovXG5KYW51c1BsdWdpbkhhbmRsZS5wcm90b3R5cGUuc2VuZE1lc3NhZ2UgPSBmdW5jdGlvbihib2R5KSB7XG4gIHJldHVybiB0aGlzLnNlbmQoXCJtZXNzYWdlXCIsIHsgYm9keTogYm9keSB9KTtcbn07XG5cbi8qKiBTZW5kcyBhIEpTRVAgb2ZmZXIgb3IgYW5zd2VyIGFzc29jaWF0ZWQgd2l0aCB0aGlzIGhhbmRsZS4gKiovXG5KYW51c1BsdWdpbkhhbmRsZS5wcm90b3R5cGUuc2VuZEpzZXAgPSBmdW5jdGlvbihqc2VwKSB7XG4gIHJldHVybiB0aGlzLnNlbmQoXCJtZXNzYWdlXCIsIHsgYm9keToge30sIGpzZXA6IGpzZXAgfSk7XG59O1xuXG4vKiogU2VuZHMgYW4gSUNFIHRyaWNrbGUgY2FuZGlkYXRlIGFzc29jaWF0ZWQgd2l0aCB0aGlzIGhhbmRsZS4gKiovXG5KYW51c1BsdWdpbkhhbmRsZS5wcm90b3R5cGUuc2VuZFRyaWNrbGUgPSBmdW5jdGlvbihjYW5kaWRhdGUpIHtcbiAgcmV0dXJuIHRoaXMuc2VuZChcInRyaWNrbGVcIiwgeyBjYW5kaWRhdGU6IGNhbmRpZGF0ZSB9KTtcbn07XG5cbi8qKlxuICogUmVwcmVzZW50cyBhIEphbnVzIHNlc3Npb24gLS0gYSBKYW51cyBjb250ZXh0IGZyb20gd2l0aGluIHdoaWNoIHlvdSBjYW4gb3BlbiBtdWx0aXBsZSBoYW5kbGVzIGFuZCBjb25uZWN0aW9ucy4gT25jZVxuICogY3JlYXRlZCwgdGhpcyBzZXNzaW9uIHdpbGwgYmUgZ2l2ZW4gYSB1bmlxdWUgSUQgd2hpY2ggc2hvdWxkIGJlIHVzZWQgdG8gYXNzb2NpYXRlIGl0IHdpdGggZnV0dXJlIHNpZ25hbGxpbmcgbWVzc2FnZXMuXG4gKlxuICogU2VlIGh0dHBzOi8vamFudXMuY29uZi5tZWV0ZWNoby5jb20vZG9jcy9yZXN0Lmh0bWwjc2Vzc2lvbnMuXG4gKiovXG5mdW5jdGlvbiBKYW51c1Nlc3Npb24ob3V0cHV0LCBvcHRpb25zKSB7XG4gIHRoaXMub3V0cHV0ID0gb3V0cHV0O1xuICB0aGlzLmlkID0gdW5kZWZpbmVkO1xuICB0aGlzLm5leHRUeElkID0gMDtcbiAgdGhpcy50eG5zID0ge307XG4gIHRoaXMuZXZlbnRIYW5kbGVycyA9IHt9O1xuICB0aGlzLm9wdGlvbnMgPSBPYmplY3QuYXNzaWduKHtcbiAgICB2ZXJib3NlOiBmYWxzZSxcbiAgICB0aW1lb3V0TXM6IDEwMDAwLFxuICAgIGtlZXBhbGl2ZU1zOiAzMDAwMFxuICB9LCBvcHRpb25zKTtcbn1cblxuLyoqIENyZWF0ZXMgdGhpcyBzZXNzaW9uIG9uIHRoZSBKYW51cyBzZXJ2ZXIgYW5kIHNldHMgaXRzIElELiAqKi9cbkphbnVzU2Vzc2lvbi5wcm90b3R5cGUuY3JlYXRlID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLnNlbmQoXCJjcmVhdGVcIikudGhlbihyZXNwID0+IHtcbiAgICB0aGlzLmlkID0gcmVzcC5kYXRhLmlkO1xuICAgIHJldHVybiByZXNwO1xuICB9KTtcbn07XG5cbi8qKlxuICogRGVzdHJveXMgdGhpcyBzZXNzaW9uLiBOb3RlIHRoYXQgdXBvbiBkZXN0cnVjdGlvbiwgSmFudXMgd2lsbCBhbHNvIGNsb3NlIHRoZSBzaWduYWxsaW5nIHRyYW5zcG9ydCAoaWYgYXBwbGljYWJsZSkgYW5kXG4gKiBhbnkgb3BlbiBXZWJSVEMgY29ubmVjdGlvbnMuXG4gKiovXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLmRlc3Ryb3kgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuc2VuZChcImRlc3Ryb3lcIikudGhlbigocmVzcCkgPT4ge1xuICAgIHRoaXMuZGlzcG9zZSgpO1xuICAgIHJldHVybiByZXNwO1xuICB9KTtcbn07XG5cbi8qKlxuICogRGlzcG9zZXMgb2YgdGhpcyBzZXNzaW9uIGluIGEgd2F5IHN1Y2ggdGhhdCBubyBmdXJ0aGVyIGluY29taW5nIHNpZ25hbGxpbmcgbWVzc2FnZXMgd2lsbCBiZSBwcm9jZXNzZWQuXG4gKiBPdXRzdGFuZGluZyB0cmFuc2FjdGlvbnMgd2lsbCBiZSByZWplY3RlZC5cbiAqKi9cbkphbnVzU2Vzc2lvbi5wcm90b3R5cGUuZGlzcG9zZSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLl9raWxsS2VlcGFsaXZlKCk7XG4gIHRoaXMuZXZlbnRIYW5kbGVycyA9IHt9O1xuICBmb3IgKHZhciB0eElkIGluIHRoaXMudHhucykge1xuICAgIGlmICh0aGlzLnR4bnMuaGFzT3duUHJvcGVydHkodHhJZCkpIHtcbiAgICAgIHZhciB0eG4gPSB0aGlzLnR4bnNbdHhJZF07XG4gICAgICBjbGVhclRpbWVvdXQodHhuLnRpbWVvdXQpO1xuICAgICAgdHhuLnJlamVjdChuZXcgRXJyb3IoXCJKYW51cyBzZXNzaW9uIHdhcyBkaXNwb3NlZC5cIikpO1xuICAgICAgZGVsZXRlIHRoaXMudHhuc1t0eElkXTtcbiAgICB9XG4gIH1cbn07XG5cbi8qKlxuICogV2hldGhlciB0aGlzIHNpZ25hbCByZXByZXNlbnRzIGFuIGVycm9yLCBhbmQgdGhlIGFzc29jaWF0ZWQgcHJvbWlzZSAoaWYgYW55KSBzaG91bGQgYmUgcmVqZWN0ZWQuXG4gKiBVc2VycyBzaG91bGQgb3ZlcnJpZGUgdGhpcyB0byBoYW5kbGUgYW55IGN1c3RvbSBwbHVnaW4tc3BlY2lmaWMgZXJyb3IgY29udmVudGlvbnMuXG4gKiovXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLmlzRXJyb3IgPSBmdW5jdGlvbihzaWduYWwpIHtcbiAgcmV0dXJuIHNpZ25hbC5qYW51cyA9PT0gXCJlcnJvclwiO1xufTtcblxuLyoqIFJlZ2lzdGVycyBhIGNhbGxiYWNrIHRvIGJlIGZpcmVkIHVwb24gdGhlIHJlY2VwdGlvbiBvZiBhbnkgaW5jb21pbmcgSmFudXMgc2lnbmFscyBmb3IgdGhpcyBzZXNzaW9uIHdpdGggdGhlXG4gKiBgamFudXNgIGF0dHJpYnV0ZSBlcXVhbCB0byBgZXZgLlxuICoqL1xuSmFudXNTZXNzaW9uLnByb3RvdHlwZS5vbiA9IGZ1bmN0aW9uKGV2LCBjYWxsYmFjaykge1xuICB2YXIgaGFuZGxlcnMgPSB0aGlzLmV2ZW50SGFuZGxlcnNbZXZdO1xuICBpZiAoaGFuZGxlcnMgPT0gbnVsbCkge1xuICAgIGhhbmRsZXJzID0gdGhpcy5ldmVudEhhbmRsZXJzW2V2XSA9IFtdO1xuICB9XG4gIGhhbmRsZXJzLnB1c2goY2FsbGJhY2spO1xufTtcblxuLyoqXG4gKiBDYWxsYmFjayBmb3IgcmVjZWl2aW5nIEpTT04gc2lnbmFsbGluZyBtZXNzYWdlcyBwZXJ0aW5lbnQgdG8gdGhpcyBzZXNzaW9uLiBJZiB0aGUgc2lnbmFscyBhcmUgcmVzcG9uc2VzIHRvIHByZXZpb3VzbHlcbiAqIHNlbnQgc2lnbmFscywgdGhlIHByb21pc2VzIGZvciB0aGUgb3V0Z29pbmcgc2lnbmFscyB3aWxsIGJlIHJlc29sdmVkIG9yIHJlamVjdGVkIGFwcHJvcHJpYXRlbHkgd2l0aCB0aGlzIHNpZ25hbCBhcyBhblxuICogYXJndW1lbnQuXG4gKlxuICogRXh0ZXJuYWwgY2FsbGVycyBzaG91bGQgY2FsbCB0aGlzIGZ1bmN0aW9uIGV2ZXJ5IHRpbWUgYSBuZXcgc2lnbmFsIGFycml2ZXMgb24gdGhlIHRyYW5zcG9ydDsgZm9yIGV4YW1wbGUsIGluIGFcbiAqIFdlYlNvY2tldCdzIGBtZXNzYWdlYCBldmVudCwgb3Igd2hlbiBhIG5ldyBkYXR1bSBzaG93cyB1cCBpbiBhbiBIVFRQIGxvbmctcG9sbGluZyByZXNwb25zZS5cbiAqKi9cbkphbnVzU2Vzc2lvbi5wcm90b3R5cGUucmVjZWl2ZSA9IGZ1bmN0aW9uKHNpZ25hbCkge1xuICBpZiAodGhpcy5vcHRpb25zLnZlcmJvc2UpIHtcbiAgICB0aGlzLl9sb2dJbmNvbWluZyhzaWduYWwpO1xuICB9XG4gIGlmIChzaWduYWwuc2Vzc2lvbl9pZCAhPSB0aGlzLmlkKSB7XG4gICAgY29uc29sZS53YXJuKFwiSW5jb3JyZWN0IHNlc3Npb24gSUQgcmVjZWl2ZWQgaW4gSmFudXMgc2lnbmFsbGluZyBtZXNzYWdlOiB3YXMgXCIgKyBzaWduYWwuc2Vzc2lvbl9pZCArIFwiLCBleHBlY3RlZCBcIiArIHRoaXMuaWQgKyBcIi5cIik7XG4gIH1cblxuICB2YXIgcmVzcG9uc2VUeXBlID0gc2lnbmFsLmphbnVzO1xuICB2YXIgaGFuZGxlcnMgPSB0aGlzLmV2ZW50SGFuZGxlcnNbcmVzcG9uc2VUeXBlXTtcbiAgaWYgKGhhbmRsZXJzICE9IG51bGwpIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGhhbmRsZXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBoYW5kbGVyc1tpXShzaWduYWwpO1xuICAgIH1cbiAgfVxuXG4gIGlmIChzaWduYWwudHJhbnNhY3Rpb24gIT0gbnVsbCkge1xuICAgIHZhciB0eG4gPSB0aGlzLnR4bnNbc2lnbmFsLnRyYW5zYWN0aW9uXTtcbiAgICBpZiAodHhuID09IG51bGwpIHtcbiAgICAgIC8vIHRoaXMgaXMgYSByZXNwb25zZSB0byBhIHRyYW5zYWN0aW9uIHRoYXQgd2Fzbid0IGNhdXNlZCB2aWEgSmFudXNTZXNzaW9uLnNlbmQsIG9yIGEgcGx1Z2luIHJlcGxpZWQgdHdpY2UgdG8gYVxuICAgICAgLy8gc2luZ2xlIHJlcXVlc3QsIG9yIHRoZSBzZXNzaW9uIHdhcyBkaXNwb3NlZCwgb3Igc29tZXRoaW5nIGVsc2UgdGhhdCBpc24ndCB1bmRlciBvdXIgcHVydmlldzsgdGhhdCdzIGZpbmVcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAocmVzcG9uc2VUeXBlID09PSBcImFja1wiICYmIHR4bi50eXBlID09IFwibWVzc2FnZVwiKSB7XG4gICAgICAvLyB0aGlzIGlzIGFuIGFjayBvZiBhbiBhc3luY2hyb25vdXNseS1wcm9jZXNzZWQgcGx1Z2luIHJlcXVlc3QsIHdlIHNob3VsZCB3YWl0IHRvIHJlc29sdmUgdGhlIHByb21pc2UgdW50aWwgdGhlXG4gICAgICAvLyBhY3R1YWwgcmVzcG9uc2UgY29tZXMgaW5cbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjbGVhclRpbWVvdXQodHhuLnRpbWVvdXQpO1xuXG4gICAgZGVsZXRlIHRoaXMudHhuc1tzaWduYWwudHJhbnNhY3Rpb25dO1xuICAgICh0aGlzLmlzRXJyb3Ioc2lnbmFsKSA/IHR4bi5yZWplY3QgOiB0eG4ucmVzb2x2ZSkoc2lnbmFsKTtcbiAgfVxufTtcblxuLyoqXG4gKiBTZW5kcyBhIHNpZ25hbCBhc3NvY2lhdGVkIHdpdGggdGhpcyBzZXNzaW9uLCBiZWdpbm5pbmcgYSBuZXcgdHJhbnNhY3Rpb24uIFJldHVybnMgYSBwcm9taXNlIHRoYXQgd2lsbCBiZSByZXNvbHZlZCBvclxuICogcmVqZWN0ZWQgd2hlbiBhIHJlc3BvbnNlIGlzIHJlY2VpdmVkIGluIHRoZSBzYW1lIHRyYW5zYWN0aW9uLCBvciB3aGVuIG5vIHJlc3BvbnNlIGlzIHJlY2VpdmVkIHdpdGhpbiB0aGUgc2Vzc2lvblxuICogdGltZW91dC5cbiAqKi9cbkphbnVzU2Vzc2lvbi5wcm90b3R5cGUuc2VuZCA9IGZ1bmN0aW9uKHR5cGUsIHNpZ25hbCkge1xuICBzaWduYWwgPSBPYmplY3QuYXNzaWduKHsgdHJhbnNhY3Rpb246ICh0aGlzLm5leHRUeElkKyspLnRvU3RyaW5nKCkgfSwgc2lnbmFsKTtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICB2YXIgdGltZW91dCA9IG51bGw7XG4gICAgaWYgKHRoaXMub3B0aW9ucy50aW1lb3V0TXMpIHtcbiAgICAgIHRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgZGVsZXRlIHRoaXMudHhuc1tzaWduYWwudHJhbnNhY3Rpb25dO1xuICAgICAgICByZWplY3QobmV3IEVycm9yKFwiU2lnbmFsbGluZyB0cmFuc2FjdGlvbiB3aXRoIHR4aWQgXCIgKyBzaWduYWwudHJhbnNhY3Rpb24gKyBcIiB0aW1lZCBvdXQuXCIpKTtcbiAgICAgIH0sIHRoaXMub3B0aW9ucy50aW1lb3V0TXMpO1xuICAgIH1cbiAgICB0aGlzLnR4bnNbc2lnbmFsLnRyYW5zYWN0aW9uXSA9IHsgcmVzb2x2ZTogcmVzb2x2ZSwgcmVqZWN0OiByZWplY3QsIHRpbWVvdXQ6IHRpbWVvdXQsIHR5cGU6IHR5cGUgfTtcbiAgICB0aGlzLl90cmFuc21pdCh0eXBlLCBzaWduYWwpO1xuICB9KTtcbn07XG5cbkphbnVzU2Vzc2lvbi5wcm90b3R5cGUuX3RyYW5zbWl0ID0gZnVuY3Rpb24odHlwZSwgc2lnbmFsKSB7XG4gIHNpZ25hbCA9IE9iamVjdC5hc3NpZ24oeyBqYW51czogdHlwZSB9LCBzaWduYWwpO1xuXG4gIGlmICh0aGlzLmlkICE9IG51bGwpIHsgLy8gdGhpcy5pZCBpcyB1bmRlZmluZWQgaW4gdGhlIHNwZWNpYWwgY2FzZSB3aGVuIHdlJ3JlIHNlbmRpbmcgdGhlIHNlc3Npb24gY3JlYXRlIG1lc3NhZ2VcbiAgICBzaWduYWwgPSBPYmplY3QuYXNzaWduKHsgc2Vzc2lvbl9pZDogdGhpcy5pZCB9LCBzaWduYWwpO1xuICB9XG5cbiAgaWYgKHRoaXMub3B0aW9ucy52ZXJib3NlKSB7XG4gICAgdGhpcy5fbG9nT3V0Z29pbmcoc2lnbmFsKTtcbiAgfVxuXG4gIHRoaXMub3V0cHV0KEpTT04uc3RyaW5naWZ5KHNpZ25hbCkpO1xuICB0aGlzLl9yZXNldEtlZXBhbGl2ZSgpO1xufTtcblxuSmFudXNTZXNzaW9uLnByb3RvdHlwZS5fbG9nT3V0Z29pbmcgPSBmdW5jdGlvbihzaWduYWwpIHtcbiAgdmFyIGtpbmQgPSBzaWduYWwuamFudXM7XG4gIGlmIChraW5kID09PSBcIm1lc3NhZ2VcIiAmJiBzaWduYWwuanNlcCkge1xuICAgIGtpbmQgPSBzaWduYWwuanNlcC50eXBlO1xuICB9XG4gIHZhciBtZXNzYWdlID0gXCI+IE91dGdvaW5nIEphbnVzIFwiICsgKGtpbmQgfHwgXCJzaWduYWxcIikgKyBcIiAoI1wiICsgc2lnbmFsLnRyYW5zYWN0aW9uICsgXCIpOiBcIjtcbiAgY29uc29sZS5kZWJ1ZyhcIiVjXCIgKyBtZXNzYWdlLCBcImNvbG9yOiAjMDQwXCIsIHNpZ25hbCk7XG59O1xuXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLl9sb2dJbmNvbWluZyA9IGZ1bmN0aW9uKHNpZ25hbCkge1xuICB2YXIga2luZCA9IHNpZ25hbC5qYW51cztcbiAgdmFyIG1lc3NhZ2UgPSBzaWduYWwudHJhbnNhY3Rpb24gP1xuICAgICAgXCI8IEluY29taW5nIEphbnVzIFwiICsgKGtpbmQgfHwgXCJzaWduYWxcIikgKyBcIiAoI1wiICsgc2lnbmFsLnRyYW5zYWN0aW9uICsgXCIpOiBcIiA6XG4gICAgICBcIjwgSW5jb21pbmcgSmFudXMgXCIgKyAoa2luZCB8fCBcInNpZ25hbFwiKSArIFwiOiBcIjtcbiAgY29uc29sZS5kZWJ1ZyhcIiVjXCIgKyBtZXNzYWdlLCBcImNvbG9yOiAjMDA0XCIsIHNpZ25hbCk7XG59O1xuXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLl9zZW5kS2VlcGFsaXZlID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLnNlbmQoXCJrZWVwYWxpdmVcIik7XG59O1xuXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLl9raWxsS2VlcGFsaXZlID0gZnVuY3Rpb24oKSB7XG4gIGNsZWFyVGltZW91dCh0aGlzLmtlZXBhbGl2ZVRpbWVvdXQpO1xufTtcblxuSmFudXNTZXNzaW9uLnByb3RvdHlwZS5fcmVzZXRLZWVwYWxpdmUgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5fa2lsbEtlZXBhbGl2ZSgpO1xuICBpZiAodGhpcy5vcHRpb25zLmtlZXBhbGl2ZU1zKSB7XG4gICAgdGhpcy5rZWVwYWxpdmVUaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0aGlzLl9zZW5kS2VlcGFsaXZlKCkuY2F0Y2goZSA9PiBjb25zb2xlLmVycm9yKFwiRXJyb3IgcmVjZWl2ZWQgZnJvbSBrZWVwYWxpdmU6IFwiLCBlKSk7XG4gICAgfSwgdGhpcy5vcHRpb25zLmtlZXBhbGl2ZU1zKTtcbiAgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIEphbnVzUGx1Z2luSGFuZGxlLFxuICBKYW51c1Nlc3Npb25cbn07XG4iLCIvKiBnbG9iYWwgTkFGICovXG52YXIgbWogPSByZXF1aXJlKFwiQG5ldHdvcmtlZC1hZnJhbWUvbWluaWphbnVzXCIpO1xubWouSmFudXNTZXNzaW9uLnByb3RvdHlwZS5zZW5kT3JpZ2luYWwgPSBtai5KYW51c1Nlc3Npb24ucHJvdG90eXBlLnNlbmQ7XG5tai5KYW51c1Nlc3Npb24ucHJvdG90eXBlLnNlbmQgPSBmdW5jdGlvbih0eXBlLCBzaWduYWwpIHtcbiAgcmV0dXJuIHRoaXMuc2VuZE9yaWdpbmFsKHR5cGUsIHNpZ25hbCkuY2F0Y2goKGUpID0+IHtcbiAgICBpZiAoZS5tZXNzYWdlICYmIGUubWVzc2FnZS5pbmRleE9mKFwidGltZWQgb3V0XCIpID4gLTEpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJ3ZWIgc29ja2V0IHRpbWVkIG91dFwiKTtcbiAgICAgIE5BRi5jb25uZWN0aW9uLmFkYXB0ZXIucmVjb25uZWN0KCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93KGUpO1xuICAgIH1cbiAgfSk7XG59XG5cbnZhciBzZHBVdGlscyA9IHJlcXVpcmUoXCJzZHBcIik7XG4vL3ZhciBkZWJ1ZyA9IHJlcXVpcmUoXCJkZWJ1Z1wiKShcIm5hZi1qYW51cy1hZGFwdGVyOmRlYnVnXCIpO1xuLy92YXIgd2FybiA9IHJlcXVpcmUoXCJkZWJ1Z1wiKShcIm5hZi1qYW51cy1hZGFwdGVyOndhcm5cIik7XG4vL3ZhciBlcnJvciA9IHJlcXVpcmUoXCJkZWJ1Z1wiKShcIm5hZi1qYW51cy1hZGFwdGVyOmVycm9yXCIpO1xudmFyIGRlYnVnID0gY29uc29sZS5sb2c7XG52YXIgd2FybiA9IGNvbnNvbGUud2FybjtcbnZhciBlcnJvciA9IGNvbnNvbGUuZXJyb3I7XG52YXIgaXNTYWZhcmkgPSAvXigoPyFjaHJvbWV8YW5kcm9pZCkuKSpzYWZhcmkvaS50ZXN0KG5hdmlnYXRvci51c2VyQWdlbnQpO1xuXG5jb25zdCBTVUJTQ1JJQkVfVElNRU9VVF9NUyA9IDE1MDAwO1xuXG5mdW5jdGlvbiBkZWJvdW5jZShmbikge1xuICB2YXIgY3VyciA9IFByb21pc2UucmVzb2x2ZSgpO1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIGFyZ3MgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMpO1xuICAgIGN1cnIgPSBjdXJyLnRoZW4oXyA9PiBmbi5hcHBseSh0aGlzLCBhcmdzKSk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIHJhbmRvbVVpbnQoKSB7XG4gIHJldHVybiBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiBOdW1iZXIuTUFYX1NBRkVfSU5URUdFUik7XG59XG5cbmZ1bmN0aW9uIHVudGlsRGF0YUNoYW5uZWxPcGVuKGRhdGFDaGFubmVsKSB7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgaWYgKGRhdGFDaGFubmVsLnJlYWR5U3RhdGUgPT09IFwib3BlblwiKSB7XG4gICAgICByZXNvbHZlKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGxldCByZXNvbHZlciwgcmVqZWN0b3I7XG5cbiAgICAgIGNvbnN0IGNsZWFyID0gKCkgPT4ge1xuICAgICAgICBkYXRhQ2hhbm5lbC5yZW1vdmVFdmVudExpc3RlbmVyKFwib3BlblwiLCByZXNvbHZlcik7XG4gICAgICAgIGRhdGFDaGFubmVsLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJlcnJvclwiLCByZWplY3Rvcik7XG4gICAgICB9O1xuXG4gICAgICByZXNvbHZlciA9ICgpID0+IHtcbiAgICAgICAgY2xlYXIoKTtcbiAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgfTtcbiAgICAgIHJlamVjdG9yID0gKCkgPT4ge1xuICAgICAgICBjbGVhcigpO1xuICAgICAgICByZWplY3QoKTtcbiAgICAgIH07XG5cbiAgICAgIGRhdGFDaGFubmVsLmFkZEV2ZW50TGlzdGVuZXIoXCJvcGVuXCIsIHJlc29sdmVyKTtcbiAgICAgIGRhdGFDaGFubmVsLmFkZEV2ZW50TGlzdGVuZXIoXCJlcnJvclwiLCByZWplY3Rvcik7XG4gICAgfVxuICB9KTtcbn1cblxuY29uc3QgaXNIMjY0VmlkZW9TdXBwb3J0ZWQgPSAoKCkgPT4ge1xuICBjb25zdCB2aWRlbyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJ2aWRlb1wiKTtcbiAgcmV0dXJuIHZpZGVvLmNhblBsYXlUeXBlKCd2aWRlby9tcDQ7IGNvZGVjcz1cImF2YzEuNDJFMDFFLCBtcDRhLjQwLjJcIicpICE9PSBcIlwiO1xufSkoKTtcblxuY29uc3QgT1BVU19QQVJBTUVURVJTID0ge1xuICAvLyBpbmRpY2F0ZXMgdGhhdCB3ZSB3YW50IHRvIGVuYWJsZSBEVFggdG8gZWxpZGUgc2lsZW5jZSBwYWNrZXRzXG4gIHVzZWR0eDogMSxcbiAgLy8gaW5kaWNhdGVzIHRoYXQgd2UgcHJlZmVyIHRvIHJlY2VpdmUgbW9ubyBhdWRpbyAoaW1wb3J0YW50IGZvciB2b2lwIHByb2ZpbGUpXG4gIHN0ZXJlbzogMCxcbiAgLy8gaW5kaWNhdGVzIHRoYXQgd2UgcHJlZmVyIHRvIHNlbmQgbW9ubyBhdWRpbyAoaW1wb3J0YW50IGZvciB2b2lwIHByb2ZpbGUpXG4gIFwic3Byb3Atc3RlcmVvXCI6IDBcbn07XG5cbmNvbnN0IERFRkFVTFRfUEVFUl9DT05ORUNUSU9OX0NPTkZJRyA9IHtcbiAgaWNlU2VydmVyczogW3sgdXJsczogXCJzdHVuOnN0dW4xLmwuZ29vZ2xlLmNvbToxOTMwMlwiIH0sIHsgdXJsczogXCJzdHVuOnN0dW4yLmwuZ29vZ2xlLmNvbToxOTMwMlwiIH1dXG59O1xuXG5jb25zdCBXU19OT1JNQUxfQ0xPU1VSRSA9IDEwMDA7XG5cbmNsYXNzIEphbnVzQWRhcHRlciB7XG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHRoaXMucm9vbSA9IG51bGw7XG4gICAgLy8gV2UgZXhwZWN0IHRoZSBjb25zdW1lciB0byBzZXQgYSBjbGllbnQgaWQgYmVmb3JlIGNvbm5lY3RpbmcuXG4gICAgdGhpcy5jbGllbnRJZCA9IG51bGw7XG4gICAgdGhpcy5qb2luVG9rZW4gPSBudWxsO1xuXG4gICAgdGhpcy5zZXJ2ZXJVcmwgPSBudWxsO1xuICAgIHRoaXMud2ViUnRjT3B0aW9ucyA9IHt9O1xuICAgIHRoaXMucGVlckNvbm5lY3Rpb25Db25maWcgPSBudWxsO1xuICAgIHRoaXMud3MgPSBudWxsO1xuICAgIHRoaXMuc2Vzc2lvbiA9IG51bGw7XG4gICAgdGhpcy5yZWxpYWJsZVRyYW5zcG9ydCA9IFwiZGF0YWNoYW5uZWxcIjtcbiAgICB0aGlzLnVucmVsaWFibGVUcmFuc3BvcnQgPSBcImRhdGFjaGFubmVsXCI7XG5cbiAgICAvLyBJbiB0aGUgZXZlbnQgdGhlIHNlcnZlciByZXN0YXJ0cyBhbmQgYWxsIGNsaWVudHMgbG9zZSBjb25uZWN0aW9uLCByZWNvbm5lY3Qgd2l0aFxuICAgIC8vIHNvbWUgcmFuZG9tIGppdHRlciBhZGRlZCB0byBwcmV2ZW50IHNpbXVsdGFuZW91cyByZWNvbm5lY3Rpb24gcmVxdWVzdHMuXG4gICAgdGhpcy5pbml0aWFsUmVjb25uZWN0aW9uRGVsYXkgPSAxMDAwICogTWF0aC5yYW5kb20oKTtcbiAgICB0aGlzLnJlY29ubmVjdGlvbkRlbGF5ID0gdGhpcy5pbml0aWFsUmVjb25uZWN0aW9uRGVsYXk7XG4gICAgdGhpcy5yZWNvbm5lY3Rpb25UaW1lb3V0ID0gbnVsbDtcbiAgICB0aGlzLm1heFJlY29ubmVjdGlvbkF0dGVtcHRzID0gMTA7XG4gICAgdGhpcy5yZWNvbm5lY3Rpb25BdHRlbXB0cyA9IDA7XG4gICAgdGhpcy5pc1JlY29ubmVjdGluZyA9IGZhbHNlO1xuXG4gICAgdGhpcy5wdWJsaXNoZXIgPSBudWxsO1xuICAgIHRoaXMub2NjdXBhbnRzID0ge307XG4gICAgdGhpcy5sZWZ0T2NjdXBhbnRzID0gbmV3IFNldCgpO1xuICAgIHRoaXMubWVkaWFTdHJlYW1zID0ge307XG4gICAgdGhpcy5sb2NhbE1lZGlhU3RyZWFtID0gbnVsbDtcbiAgICB0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzID0gbmV3IE1hcCgpO1xuXG4gICAgdGhpcy5ibG9ja2VkQ2xpZW50cyA9IG5ldyBNYXAoKTtcbiAgICB0aGlzLmZyb3plblVwZGF0ZXMgPSBuZXcgTWFwKCk7XG5cbiAgICB0aGlzLnRpbWVPZmZzZXRzID0gW107XG4gICAgdGhpcy5zZXJ2ZXJUaW1lUmVxdWVzdHMgPSAwO1xuICAgIHRoaXMuYXZnVGltZU9mZnNldCA9IDA7XG5cbiAgICB0aGlzLm9uV2Vic29ja2V0T3BlbiA9IHRoaXMub25XZWJzb2NrZXRPcGVuLmJpbmQodGhpcyk7XG4gICAgdGhpcy5vbldlYnNvY2tldENsb3NlID0gdGhpcy5vbldlYnNvY2tldENsb3NlLmJpbmQodGhpcyk7XG4gICAgdGhpcy5vbldlYnNvY2tldE1lc3NhZ2UgPSB0aGlzLm9uV2Vic29ja2V0TWVzc2FnZS5iaW5kKHRoaXMpO1xuICAgIHRoaXMub25EYXRhQ2hhbm5lbE1lc3NhZ2UgPSB0aGlzLm9uRGF0YUNoYW5uZWxNZXNzYWdlLmJpbmQodGhpcyk7XG4gICAgdGhpcy5vbkRhdGEgPSB0aGlzLm9uRGF0YS5iaW5kKHRoaXMpO1xuICB9XG5cbiAgc2V0U2VydmVyVXJsKHVybCkge1xuICAgIHRoaXMuc2VydmVyVXJsID0gdXJsO1xuICB9XG5cbiAgc2V0QXBwKGFwcCkge31cblxuICBzZXRSb29tKHJvb21OYW1lKSB7XG4gICAgdGhpcy5yb29tID0gcm9vbU5hbWU7XG4gIH1cblxuICBzZXRKb2luVG9rZW4oam9pblRva2VuKSB7XG4gICAgdGhpcy5qb2luVG9rZW4gPSBqb2luVG9rZW47XG4gIH1cblxuICBzZXRDbGllbnRJZChjbGllbnRJZCkge1xuICAgIHRoaXMuY2xpZW50SWQgPSBjbGllbnRJZDtcbiAgfVxuXG4gIHNldFdlYlJ0Y09wdGlvbnMob3B0aW9ucykge1xuICAgIHRoaXMud2ViUnRjT3B0aW9ucyA9IG9wdGlvbnM7XG4gIH1cblxuICBzZXRQZWVyQ29ubmVjdGlvbkNvbmZpZyhwZWVyQ29ubmVjdGlvbkNvbmZpZykge1xuICAgIHRoaXMucGVlckNvbm5lY3Rpb25Db25maWcgPSBwZWVyQ29ubmVjdGlvbkNvbmZpZztcbiAgfVxuXG4gIHNldFNlcnZlckNvbm5lY3RMaXN0ZW5lcnMoc3VjY2Vzc0xpc3RlbmVyLCBmYWlsdXJlTGlzdGVuZXIpIHtcbiAgICB0aGlzLmNvbm5lY3RTdWNjZXNzID0gc3VjY2Vzc0xpc3RlbmVyO1xuICAgIHRoaXMuY29ubmVjdEZhaWx1cmUgPSBmYWlsdXJlTGlzdGVuZXI7XG4gIH1cblxuICBzZXRSb29tT2NjdXBhbnRMaXN0ZW5lcihvY2N1cGFudExpc3RlbmVyKSB7XG4gICAgdGhpcy5vbk9jY3VwYW50c0NoYW5nZWQgPSBvY2N1cGFudExpc3RlbmVyO1xuICB9XG5cbiAgc2V0RGF0YUNoYW5uZWxMaXN0ZW5lcnMob3Blbkxpc3RlbmVyLCBjbG9zZWRMaXN0ZW5lciwgbWVzc2FnZUxpc3RlbmVyKSB7XG4gICAgdGhpcy5vbk9jY3VwYW50Q29ubmVjdGVkID0gb3Blbkxpc3RlbmVyO1xuICAgIHRoaXMub25PY2N1cGFudERpc2Nvbm5lY3RlZCA9IGNsb3NlZExpc3RlbmVyO1xuICAgIHRoaXMub25PY2N1cGFudE1lc3NhZ2UgPSBtZXNzYWdlTGlzdGVuZXI7XG4gIH1cblxuICBzZXRSZWNvbm5lY3Rpb25MaXN0ZW5lcnMocmVjb25uZWN0aW5nTGlzdGVuZXIsIHJlY29ubmVjdGVkTGlzdGVuZXIsIHJlY29ubmVjdGlvbkVycm9yTGlzdGVuZXIpIHtcbiAgICAvLyBvblJlY29ubmVjdGluZyBpcyBjYWxsZWQgd2l0aCB0aGUgbnVtYmVyIG9mIG1pbGxpc2Vjb25kcyB1bnRpbCB0aGUgbmV4dCByZWNvbm5lY3Rpb24gYXR0ZW1wdFxuICAgIHRoaXMub25SZWNvbm5lY3RpbmcgPSByZWNvbm5lY3RpbmdMaXN0ZW5lcjtcbiAgICAvLyBvblJlY29ubmVjdGVkIGlzIGNhbGxlZCB3aGVuIHRoZSBjb25uZWN0aW9uIGhhcyBiZWVuIHJlZXN0YWJsaXNoZWRcbiAgICB0aGlzLm9uUmVjb25uZWN0ZWQgPSByZWNvbm5lY3RlZExpc3RlbmVyO1xuICAgIC8vIG9uUmVjb25uZWN0aW9uRXJyb3IgaXMgY2FsbGVkIHdpdGggYW4gZXJyb3Igd2hlbiBtYXhSZWNvbm5lY3Rpb25BdHRlbXB0cyBoYXMgYmVlbiByZWFjaGVkXG4gICAgdGhpcy5vblJlY29ubmVjdGlvbkVycm9yID0gcmVjb25uZWN0aW9uRXJyb3JMaXN0ZW5lcjtcbiAgfVxuXG4gIHNldEV2ZW50TG9vcHMobG9vcHMpIHtcbiAgICB0aGlzLmxvb3BzID0gbG9vcHM7XG4gIH1cblxuICBjb25uZWN0KCkge1xuICAgIGlmICh0aGlzLnNlcnZlclVybCA9PT0gJy8nKSB7XG4gICAgICB0aGlzLnNlcnZlclVybCA9ICcvamFudXMnO1xuICAgIH1cbiAgICBpZiAodGhpcy5zZXJ2ZXJVcmwgPT09ICcvamFudXMnKSB7XG4gICAgICBpZiAobG9jYXRpb24ucHJvdG9jb2wgPT09ICdodHRwczonKSB7XG4gICAgICAgIHRoaXMuc2VydmVyVXJsID0gJ3dzczovLycgKyBsb2NhdGlvbi5ob3N0ICsgJy9qYW51cyc7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnNlcnZlclVybCA9ICd3czovLycgKyBsb2NhdGlvbi5ob3N0ICsgJy9qYW51cyc7XG4gICAgICB9XG4gICAgfVxuICAgIGRlYnVnKGBjb25uZWN0aW5nIHRvICR7dGhpcy5zZXJ2ZXJVcmx9YCk7XG5cbiAgICBjb25zdCB3ZWJzb2NrZXRDb25uZWN0aW9uID0gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgdGhpcy53cyA9IG5ldyBXZWJTb2NrZXQodGhpcy5zZXJ2ZXJVcmwsIFwiamFudXMtcHJvdG9jb2xcIik7XG5cbiAgICAgIHRoaXMuc2Vzc2lvbiA9IG5ldyBtai5KYW51c1Nlc3Npb24odGhpcy53cy5zZW5kLmJpbmQodGhpcy53cyksIHsgdGltZW91dE1zOiA0MDAwMCB9KTtcblxuICAgICAgdGhpcy53ZWJzb2NrZXRDb25uZWN0aW9uUHJvbWlzZSA9IHt9O1xuICAgICAgdGhpcy53ZWJzb2NrZXRDb25uZWN0aW9uUHJvbWlzZS5yZXNvbHZlID0gcmVzb2x2ZTtcbiAgICAgIHRoaXMud2Vic29ja2V0Q29ubmVjdGlvblByb21pc2UucmVqZWN0ID0gcmVqZWN0O1xuXG4gICAgICB0aGlzLndzLmFkZEV2ZW50TGlzdGVuZXIoXCJjbG9zZVwiLCB0aGlzLm9uV2Vic29ja2V0Q2xvc2UpO1xuICAgICAgdGhpcy53cy5hZGRFdmVudExpc3RlbmVyKFwibWVzc2FnZVwiLCB0aGlzLm9uV2Vic29ja2V0TWVzc2FnZSk7XG5cbiAgICAgIHRoaXMud3NPbk9wZW4gPSAoKSA9PiB7XG4gICAgICAgIHRoaXMud3MucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm9wZW5cIiwgdGhpcy53c09uT3Blbik7XG4gICAgICAgIHRoaXMub25XZWJzb2NrZXRPcGVuKClcbiAgICAgICAgICAudGhlbihyZXNvbHZlKVxuICAgICAgICAgIC5jYXRjaChyZWplY3QpO1xuICAgICAgfTtcblxuICAgICAgdGhpcy53cy5hZGRFdmVudExpc3RlbmVyKFwib3BlblwiLCB0aGlzLndzT25PcGVuKTtcbiAgICB9KTtcblxuICAgIHJldHVybiBQcm9taXNlLmFsbChbd2Vic29ja2V0Q29ubmVjdGlvbiwgdGhpcy51cGRhdGVUaW1lT2Zmc2V0KCldKTtcbiAgfVxuXG4gIGRpc2Nvbm5lY3QoKSB7XG4gICAgZGVidWcoYGRpc2Nvbm5lY3RpbmdgKTtcblxuICAgIGNsZWFyVGltZW91dCh0aGlzLnJlY29ubmVjdGlvblRpbWVvdXQpO1xuXG4gICAgdGhpcy5yZW1vdmVBbGxPY2N1cGFudHMoKTtcbiAgICB0aGlzLmxlZnRPY2N1cGFudHMgPSBuZXcgU2V0KCk7XG5cbiAgICBpZiAodGhpcy5wdWJsaXNoZXIpIHtcbiAgICAgIC8vIENsb3NlIHRoZSBwdWJsaXNoZXIgcGVlciBjb25uZWN0aW9uLiBXaGljaCBhbHNvIGRldGFjaGVzIHRoZSBwbHVnaW4gaGFuZGxlLlxuICAgICAgdGhpcy5wdWJsaXNoZXIuY29ubi5jbG9zZSgpO1xuICAgICAgdGhpcy5wdWJsaXNoZXIgPSBudWxsO1xuICAgIH1cblxuICAgIGlmICh0aGlzLnNlc3Npb24pIHtcbiAgICAgIHRoaXMuc2Vzc2lvbi5kaXNwb3NlKCk7XG4gICAgICB0aGlzLnNlc3Npb24gPSBudWxsO1xuICAgIH1cblxuICAgIGlmICh0aGlzLndzKSB7XG4gICAgICB0aGlzLndzLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJvcGVuXCIsIHRoaXMud3NPbk9wZW4pO1xuICAgICAgdGhpcy53cy5yZW1vdmVFdmVudExpc3RlbmVyKFwiY2xvc2VcIiwgdGhpcy5vbldlYnNvY2tldENsb3NlKTtcbiAgICAgIHRoaXMud3MucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm1lc3NhZ2VcIiwgdGhpcy5vbldlYnNvY2tldE1lc3NhZ2UpO1xuICAgICAgdGhpcy53cy5jbG9zZSgpO1xuICAgICAgdGhpcy53cyA9IG51bGw7XG4gICAgfVxuXG4gICAgLy8gTm93IHRoYXQgYWxsIFJUQ1BlZXJDb25uZWN0aW9uIGNsb3NlZCwgYmUgc3VyZSB0byBub3QgY2FsbFxuICAgIC8vIHJlY29ubmVjdCgpIGFnYWluIHZpYSBwZXJmb3JtRGVsYXllZFJlY29ubmVjdCBpZiBwcmV2aW91c1xuICAgIC8vIFJUQ1BlZXJDb25uZWN0aW9uIHdhcyBpbiB0aGUgZmFpbGVkIHN0YXRlLlxuICAgIGlmICh0aGlzLmRlbGF5ZWRSZWNvbm5lY3RUaW1lb3V0KSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5kZWxheWVkUmVjb25uZWN0VGltZW91dCk7XG4gICAgICB0aGlzLmRlbGF5ZWRSZWNvbm5lY3RUaW1lb3V0ID0gbnVsbDtcbiAgICB9XG4gIH1cblxuICBpc0Rpc2Nvbm5lY3RlZCgpIHtcbiAgICByZXR1cm4gdGhpcy53cyA9PT0gbnVsbDtcbiAgfVxuXG4gIGFzeW5jIG9uV2Vic29ja2V0T3BlbigpIHtcbiAgICAvLyBDcmVhdGUgdGhlIEphbnVzIFNlc3Npb25cbiAgICBhd2FpdCB0aGlzLnNlc3Npb24uY3JlYXRlKCk7XG5cbiAgICAvLyBBdHRhY2ggdGhlIFNGVSBQbHVnaW4gYW5kIGNyZWF0ZSBhIFJUQ1BlZXJDb25uZWN0aW9uIGZvciB0aGUgcHVibGlzaGVyLlxuICAgIC8vIFRoZSBwdWJsaXNoZXIgc2VuZHMgYXVkaW8gYW5kIG9wZW5zIHR3byBiaWRpcmVjdGlvbmFsIGRhdGEgY2hhbm5lbHMuXG4gICAgLy8gT25lIHJlbGlhYmxlIGRhdGFjaGFubmVsIGFuZCBvbmUgdW5yZWxpYWJsZS5cbiAgICB0aGlzLnB1Ymxpc2hlciA9IGF3YWl0IHRoaXMuY3JlYXRlUHVibGlzaGVyKCk7XG5cbiAgICAvLyBDYWxsIHRoZSBuYWYgY29ubmVjdFN1Y2Nlc3MgY2FsbGJhY2sgYmVmb3JlIHdlIHN0YXJ0IHJlY2VpdmluZyBXZWJSVEMgbWVzc2FnZXMuXG4gICAgdGhpcy5jb25uZWN0U3VjY2Vzcyh0aGlzLmNsaWVudElkKTtcblxuICAgIGNvbnN0IGFkZE9jY3VwYW50UHJvbWlzZXMgPSBbXTtcblxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGhpcy5wdWJsaXNoZXIuaW5pdGlhbE9jY3VwYW50cy5sZW5ndGg7IGkrKykge1xuICAgICAgY29uc3Qgb2NjdXBhbnRJZCA9IHRoaXMucHVibGlzaGVyLmluaXRpYWxPY2N1cGFudHNbaV07XG4gICAgICBpZiAob2NjdXBhbnRJZCA9PT0gdGhpcy5jbGllbnRJZCkgY29udGludWU7IC8vIEhhcHBlbnMgZHVyaW5nIG5vbi1ncmFjZWZ1bCByZWNvbm5lY3RzIGR1ZSB0byB6b21iaWUgc2Vzc2lvbnNcbiAgICAgIGFkZE9jY3VwYW50UHJvbWlzZXMucHVzaCh0aGlzLmFkZE9jY3VwYW50KG9jY3VwYW50SWQpKTtcbiAgICB9XG5cbiAgICBhd2FpdCBQcm9taXNlLmFsbChhZGRPY2N1cGFudFByb21pc2VzKTtcbiAgfVxuXG4gIG9uV2Vic29ja2V0Q2xvc2UoZXZlbnQpIHtcbiAgICAvLyBUaGUgY29ubmVjdGlvbiB3YXMgY2xvc2VkIHN1Y2Nlc3NmdWxseS4gRG9uJ3QgdHJ5IHRvIHJlY29ubmVjdC5cbiAgICBpZiAoZXZlbnQuY29kZSA9PT0gV1NfTk9STUFMX0NMT1NVUkUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLndlYnNvY2tldENvbm5lY3Rpb25Qcm9taXNlLnJlamVjdChldmVudCk7XG5cbiAgICBpZiAoIXRoaXMuaXNSZWNvbm5lY3RpbmcpIHtcbiAgICAgIHRoaXMuaXNSZWNvbm5lY3RpbmcgPSB0cnVlO1xuICAgICAgY29uc29sZS53YXJuKFwiSmFudXMgd2Vic29ja2V0IGNsb3NlZCB1bmV4cGVjdGVkbHkuXCIpO1xuICAgICAgaWYgKHRoaXMub25SZWNvbm5lY3RpbmcpIHtcbiAgICAgICAgdGhpcy5vblJlY29ubmVjdGluZyh0aGlzLnJlY29ubmVjdGlvbkRlbGF5KTtcbiAgICAgIH1cblxuICAgICAgdGhpcy5yZWNvbm5lY3Rpb25UaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB0aGlzLnJlY29ubmVjdCgpLCB0aGlzLnJlY29ubmVjdGlvbkRlbGF5KTtcbiAgICB9XG4gIH1cblxuICByZWNvbm5lY3QoKSB7XG4gICAgLy8gRGlzcG9zZSBvZiBhbGwgbmV0d29ya2VkIGVudGl0aWVzIGFuZCBvdGhlciByZXNvdXJjZXMgdGllZCB0byB0aGUgc2Vzc2lvbi5cbiAgICB0aGlzLmRpc2Nvbm5lY3QoKTtcblxuICAgIHRoaXMuY29ubmVjdCgpXG4gICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgIHRoaXMucmVjb25uZWN0aW9uRGVsYXkgPSB0aGlzLmluaXRpYWxSZWNvbm5lY3Rpb25EZWxheTtcbiAgICAgICAgdGhpcy5yZWNvbm5lY3Rpb25BdHRlbXB0cyA9IDA7XG4gICAgICAgIHRoaXMuaXNSZWNvbm5lY3RpbmcgPSBmYWxzZTtcblxuICAgICAgICBpZiAodGhpcy5vblJlY29ubmVjdGVkKSB7XG4gICAgICAgICAgdGhpcy5vblJlY29ubmVjdGVkKCk7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICB0aGlzLnJlY29ubmVjdGlvbkRlbGF5ICs9IDEwMDA7XG4gICAgICAgIHRoaXMucmVjb25uZWN0aW9uQXR0ZW1wdHMrKztcblxuICAgICAgICBpZiAodGhpcy5yZWNvbm5lY3Rpb25BdHRlbXB0cyA+IHRoaXMubWF4UmVjb25uZWN0aW9uQXR0ZW1wdHMpIHtcbiAgICAgICAgICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcihcbiAgICAgICAgICAgIFwiQ29ubmVjdGlvbiBjb3VsZCBub3QgYmUgcmVlc3RhYmxpc2hlZCwgZXhjZWVkZWQgbWF4aW11bSBudW1iZXIgb2YgcmVjb25uZWN0aW9uIGF0dGVtcHRzLlwiXG4gICAgICAgICAgKTtcbiAgICAgICAgICBpZiAodGhpcy5vblJlY29ubmVjdGlvbkVycm9yKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5vblJlY29ubmVjdGlvbkVycm9yKGVycm9yKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc29sZS53YXJuKGVycm9yKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zb2xlLndhcm4oXCJFcnJvciBkdXJpbmcgcmVjb25uZWN0LCByZXRyeWluZy5cIik7XG4gICAgICAgIGNvbnNvbGUud2FybihlcnJvcik7XG5cbiAgICAgICAgaWYgKHRoaXMub25SZWNvbm5lY3RpbmcpIHtcbiAgICAgICAgICB0aGlzLm9uUmVjb25uZWN0aW5nKHRoaXMucmVjb25uZWN0aW9uRGVsYXkpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5yZWNvbm5lY3Rpb25UaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB0aGlzLnJlY29ubmVjdCgpLCB0aGlzLnJlY29ubmVjdGlvbkRlbGF5KTtcbiAgICAgIH0pO1xuICB9XG5cbiAgcGVyZm9ybURlbGF5ZWRSZWNvbm5lY3QoKSB7XG4gICAgaWYgKHRoaXMuZGVsYXllZFJlY29ubmVjdFRpbWVvdXQpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLmRlbGF5ZWRSZWNvbm5lY3RUaW1lb3V0KTtcbiAgICB9XG5cbiAgICB0aGlzLmRlbGF5ZWRSZWNvbm5lY3RUaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0aGlzLmRlbGF5ZWRSZWNvbm5lY3RUaW1lb3V0ID0gbnVsbDtcbiAgICAgIHRoaXMucmVjb25uZWN0KCk7XG4gICAgfSwgMTAwMDApO1xuICB9XG5cbiAgb25XZWJzb2NrZXRNZXNzYWdlKGV2ZW50KSB7XG4gICAgdGhpcy5zZXNzaW9uLnJlY2VpdmUoSlNPTi5wYXJzZShldmVudC5kYXRhKSk7XG4gIH1cblxuICBhc3luYyBhZGRPY2N1cGFudChvY2N1cGFudElkKSB7XG4gICAgaWYgKHRoaXMub2NjdXBhbnRzW29jY3VwYW50SWRdKSB7XG4gICAgICB0aGlzLnJlbW92ZU9jY3VwYW50KG9jY3VwYW50SWQpO1xuICAgIH1cblxuICAgIHRoaXMubGVmdE9jY3VwYW50cy5kZWxldGUob2NjdXBhbnRJZCk7XG5cbiAgICB2YXIgc3Vic2NyaWJlciA9IGF3YWl0IHRoaXMuY3JlYXRlU3Vic2NyaWJlcihvY2N1cGFudElkKTtcblxuICAgIGlmICghc3Vic2NyaWJlcikgcmV0dXJuO1xuXG4gICAgdGhpcy5vY2N1cGFudHNbb2NjdXBhbnRJZF0gPSBzdWJzY3JpYmVyO1xuXG4gICAgdGhpcy5zZXRNZWRpYVN0cmVhbShvY2N1cGFudElkLCBzdWJzY3JpYmVyLm1lZGlhU3RyZWFtKTtcblxuICAgIC8vIENhbGwgdGhlIE5ldHdvcmtlZCBBRnJhbWUgY2FsbGJhY2tzIGZvciB0aGUgbmV3IG9jY3VwYW50LlxuICAgIHRoaXMub25PY2N1cGFudENvbm5lY3RlZChvY2N1cGFudElkKTtcbiAgICB0aGlzLm9uT2NjdXBhbnRzQ2hhbmdlZCh0aGlzLm9jY3VwYW50cyk7XG5cbiAgICByZXR1cm4gc3Vic2NyaWJlcjtcbiAgfVxuXG4gIHJlbW92ZUFsbE9jY3VwYW50cygpIHtcbiAgICBmb3IgKGNvbnN0IG9jY3VwYW50SWQgb2YgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXModGhpcy5vY2N1cGFudHMpKSB7XG4gICAgICB0aGlzLnJlbW92ZU9jY3VwYW50KG9jY3VwYW50SWQpO1xuICAgIH1cbiAgfVxuXG4gIHJlbW92ZU9jY3VwYW50KG9jY3VwYW50SWQpIHtcbiAgICB0aGlzLmxlZnRPY2N1cGFudHMuYWRkKG9jY3VwYW50SWQpO1xuXG4gICAgaWYgKHRoaXMub2NjdXBhbnRzW29jY3VwYW50SWRdKSB7XG4gICAgICAvLyBDbG9zZSB0aGUgc3Vic2NyaWJlciBwZWVyIGNvbm5lY3Rpb24uIFdoaWNoIGFsc28gZGV0YWNoZXMgdGhlIHBsdWdpbiBoYW5kbGUuXG4gICAgICB0aGlzLm9jY3VwYW50c1tvY2N1cGFudElkXS5jb25uLmNsb3NlKCk7XG4gICAgICBkZWxldGUgdGhpcy5vY2N1cGFudHNbb2NjdXBhbnRJZF07XG4gICAgfVxuXG4gICAgaWYgKHRoaXMubWVkaWFTdHJlYW1zW29jY3VwYW50SWRdKSB7XG4gICAgICBkZWxldGUgdGhpcy5tZWRpYVN0cmVhbXNbb2NjdXBhbnRJZF07XG4gICAgfVxuXG4gICAgaWYgKHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuaGFzKG9jY3VwYW50SWQpKSB7XG4gICAgICBjb25zdCBtc2cgPSBcIlRoZSB1c2VyIGRpc2Nvbm5lY3RlZCBiZWZvcmUgdGhlIG1lZGlhIHN0cmVhbSB3YXMgcmVzb2x2ZWQuXCI7XG4gICAgICB0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmdldChvY2N1cGFudElkKS5hdWRpby5yZWplY3QobXNnKTtcbiAgICAgIHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuZ2V0KG9jY3VwYW50SWQpLnZpZGVvLnJlamVjdChtc2cpO1xuICAgICAgdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5kZWxldGUob2NjdXBhbnRJZCk7XG4gICAgfVxuXG4gICAgLy8gQ2FsbCB0aGUgTmV0d29ya2VkIEFGcmFtZSBjYWxsYmFja3MgZm9yIHRoZSByZW1vdmVkIG9jY3VwYW50LlxuICAgIHRoaXMub25PY2N1cGFudERpc2Nvbm5lY3RlZChvY2N1cGFudElkKTtcbiAgICB0aGlzLm9uT2NjdXBhbnRzQ2hhbmdlZCh0aGlzLm9jY3VwYW50cyk7XG4gIH1cblxuICBhc3NvY2lhdGUoY29ubiwgaGFuZGxlKSB7XG4gICAgY29ubi5hZGRFdmVudExpc3RlbmVyKFwiaWNlY2FuZGlkYXRlXCIsIGV2ID0+IHtcbiAgICAgIGhhbmRsZS5zZW5kVHJpY2tsZShldi5jYW5kaWRhdGUgfHwgbnVsbCkuY2F0Y2goZSA9PiBlcnJvcihcIkVycm9yIHRyaWNrbGluZyBJQ0U6ICVvXCIsIGUpKTtcbiAgICB9KTtcbiAgICBjb25uLmFkZEV2ZW50TGlzdGVuZXIoXCJpY2Vjb25uZWN0aW9uc3RhdGVjaGFuZ2VcIiwgZXYgPT4ge1xuICAgICAgaWYgKGNvbm4uaWNlQ29ubmVjdGlvblN0YXRlID09PSBcImNvbm5lY3RlZFwiKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKFwiSUNFIHN0YXRlIGNoYW5nZWQgdG8gY29ubmVjdGVkXCIpO1xuICAgICAgfVxuICAgICAgaWYgKGNvbm4uaWNlQ29ubmVjdGlvblN0YXRlID09PSBcImRpc2Nvbm5lY3RlZFwiKSB7XG4gICAgICAgIGNvbnNvbGUud2FybihcIklDRSBzdGF0ZSBjaGFuZ2VkIHRvIGRpc2Nvbm5lY3RlZFwiKTtcbiAgICAgIH1cbiAgICAgIGlmIChjb25uLmljZUNvbm5lY3Rpb25TdGF0ZSA9PT0gXCJmYWlsZWRcIikge1xuICAgICAgICBjb25zb2xlLndhcm4oXCJJQ0UgZmFpbHVyZSBkZXRlY3RlZC4gUmVjb25uZWN0aW5nIGluIDEwcy5cIik7XG4gICAgICAgIHRoaXMucGVyZm9ybURlbGF5ZWRSZWNvbm5lY3QoKTtcbiAgICAgIH1cbiAgICB9KVxuXG4gICAgLy8gd2UgaGF2ZSB0byBkZWJvdW5jZSB0aGVzZSBiZWNhdXNlIGphbnVzIGdldHMgYW5ncnkgaWYgeW91IHNlbmQgaXQgYSBuZXcgU0RQIGJlZm9yZVxuICAgIC8vIGl0J3MgZmluaXNoZWQgcHJvY2Vzc2luZyBhbiBleGlzdGluZyBTRFAuIGluIGFjdHVhbGl0eSwgaXQgc2VlbXMgbGlrZSB0aGlzIGlzIG1heWJlXG4gICAgLy8gdG9vIGxpYmVyYWwgYW5kIHdlIG5lZWQgdG8gd2FpdCBzb21lIGFtb3VudCBvZiB0aW1lIGFmdGVyIGFuIG9mZmVyIGJlZm9yZSBzZW5kaW5nIGFub3RoZXIsXG4gICAgLy8gYnV0IHdlIGRvbid0IGN1cnJlbnRseSBrbm93IGFueSBnb29kIHdheSBvZiBkZXRlY3RpbmcgZXhhY3RseSBob3cgbG9uZyA6KFxuICAgIGNvbm4uYWRkRXZlbnRMaXN0ZW5lcihcbiAgICAgIFwibmVnb3RpYXRpb25uZWVkZWRcIixcbiAgICAgIGRlYm91bmNlKGV2ID0+IHtcbiAgICAgICAgZGVidWcoXCJTZW5kaW5nIG5ldyBvZmZlciBmb3IgaGFuZGxlOiAlb1wiLCBoYW5kbGUpO1xuICAgICAgICB2YXIgb2ZmZXIgPSBjb25uLmNyZWF0ZU9mZmVyKCkudGhlbih0aGlzLmNvbmZpZ3VyZVB1Ymxpc2hlclNkcCkudGhlbih0aGlzLmZpeFNhZmFyaUljZVVGcmFnKTtcbiAgICAgICAgdmFyIGxvY2FsID0gb2ZmZXIudGhlbihvID0+IGNvbm4uc2V0TG9jYWxEZXNjcmlwdGlvbihvKSk7XG4gICAgICAgIHZhciByZW1vdGUgPSBvZmZlcjtcblxuICAgICAgICByZW1vdGUgPSByZW1vdGVcbiAgICAgICAgICAudGhlbih0aGlzLmZpeFNhZmFyaUljZVVGcmFnKVxuICAgICAgICAgIC50aGVuKGogPT4gaGFuZGxlLnNlbmRKc2VwKGopKVxuICAgICAgICAgIC50aGVuKHIgPT4gY29ubi5zZXRSZW1vdGVEZXNjcmlwdGlvbihyLmpzZXApKTtcbiAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKFtsb2NhbCwgcmVtb3RlXSkuY2F0Y2goZSA9PiBlcnJvcihcIkVycm9yIG5lZ290aWF0aW5nIG9mZmVyOiAlb1wiLCBlKSk7XG4gICAgICB9KVxuICAgICk7XG4gICAgaGFuZGxlLm9uKFxuICAgICAgXCJldmVudFwiLFxuICAgICAgZGVib3VuY2UoZXYgPT4ge1xuICAgICAgICB2YXIganNlcCA9IGV2LmpzZXA7XG4gICAgICAgIGlmIChqc2VwICYmIGpzZXAudHlwZSA9PSBcIm9mZmVyXCIpIHtcbiAgICAgICAgICBkZWJ1ZyhcIkFjY2VwdGluZyBuZXcgb2ZmZXIgZm9yIGhhbmRsZTogJW9cIiwgaGFuZGxlKTtcbiAgICAgICAgICB2YXIgYW5zd2VyID0gY29ublxuICAgICAgICAgICAgLnNldFJlbW90ZURlc2NyaXB0aW9uKHRoaXMuY29uZmlndXJlU3Vic2NyaWJlclNkcChqc2VwKSlcbiAgICAgICAgICAgIC50aGVuKF8gPT4gY29ubi5jcmVhdGVBbnN3ZXIoKSlcbiAgICAgICAgICAgIC50aGVuKHRoaXMuZml4U2FmYXJpSWNlVUZyYWcpO1xuICAgICAgICAgIHZhciBsb2NhbCA9IGFuc3dlci50aGVuKGEgPT4gY29ubi5zZXRMb2NhbERlc2NyaXB0aW9uKGEpKTtcbiAgICAgICAgICB2YXIgcmVtb3RlID0gYW5zd2VyLnRoZW4oaiA9PiBoYW5kbGUuc2VuZEpzZXAoaikpO1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLmFsbChbbG9jYWwsIHJlbW90ZV0pLmNhdGNoKGUgPT4gZXJyb3IoXCJFcnJvciBuZWdvdGlhdGluZyBhbnN3ZXI6ICVvXCIsIGUpKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBzb21lIG90aGVyIGtpbmQgb2YgZXZlbnQsIG5vdGhpbmcgdG8gZG9cbiAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICApO1xuICB9XG5cbiAgYXN5bmMgY3JlYXRlUHVibGlzaGVyKCkge1xuICAgIHZhciBoYW5kbGUgPSBuZXcgbWouSmFudXNQbHVnaW5IYW5kbGUodGhpcy5zZXNzaW9uKTtcbiAgICB2YXIgY29ubiA9IG5ldyBSVENQZWVyQ29ubmVjdGlvbih0aGlzLnBlZXJDb25uZWN0aW9uQ29uZmlnIHx8IERFRkFVTFRfUEVFUl9DT05ORUNUSU9OX0NPTkZJRyk7XG5cbiAgICBkZWJ1ZyhcInB1YiB3YWl0aW5nIGZvciBzZnVcIik7XG4gICAgYXdhaXQgaGFuZGxlLmF0dGFjaChcImphbnVzLnBsdWdpbi5zZnVcIiwgdGhpcy5sb29wcyAmJiB0aGlzLmNsaWVudElkID8gcGFyc2VJbnQodGhpcy5jbGllbnRJZCkgJSB0aGlzLmxvb3BzIDogdW5kZWZpbmVkKTtcblxuICAgIHRoaXMuYXNzb2NpYXRlKGNvbm4sIGhhbmRsZSk7XG5cbiAgICBkZWJ1ZyhcInB1YiB3YWl0aW5nIGZvciBkYXRhIGNoYW5uZWxzICYgd2VicnRjdXBcIik7XG4gICAgdmFyIHdlYnJ0Y3VwID0gbmV3IFByb21pc2UocmVzb2x2ZSA9PiBoYW5kbGUub24oXCJ3ZWJydGN1cFwiLCByZXNvbHZlKSk7XG5cbiAgICAvLyBVbnJlbGlhYmxlIGRhdGFjaGFubmVsOiBzZW5kaW5nIGFuZCByZWNlaXZpbmcgY29tcG9uZW50IHVwZGF0ZXMuXG4gICAgLy8gUmVsaWFibGUgZGF0YWNoYW5uZWw6IHNlbmRpbmcgYW5kIHJlY2lldmluZyBlbnRpdHkgaW5zdGFudGlhdGlvbnMuXG4gICAgdmFyIHJlbGlhYmxlQ2hhbm5lbCA9IGNvbm4uY3JlYXRlRGF0YUNoYW5uZWwoXCJyZWxpYWJsZVwiLCB7IG9yZGVyZWQ6IHRydWUgfSk7XG4gICAgdmFyIHVucmVsaWFibGVDaGFubmVsID0gY29ubi5jcmVhdGVEYXRhQ2hhbm5lbChcInVucmVsaWFibGVcIiwge1xuICAgICAgb3JkZXJlZDogZmFsc2UsXG4gICAgICBtYXhSZXRyYW5zbWl0czogMFxuICAgIH0pO1xuXG4gICAgcmVsaWFibGVDaGFubmVsLmFkZEV2ZW50TGlzdGVuZXIoXCJtZXNzYWdlXCIsIGUgPT4gdGhpcy5vbkRhdGFDaGFubmVsTWVzc2FnZShlLCBcImphbnVzLXJlbGlhYmxlXCIpKTtcbiAgICB1bnJlbGlhYmxlQ2hhbm5lbC5hZGRFdmVudExpc3RlbmVyKFwibWVzc2FnZVwiLCBlID0+IHRoaXMub25EYXRhQ2hhbm5lbE1lc3NhZ2UoZSwgXCJqYW51cy11bnJlbGlhYmxlXCIpKTtcblxuICAgIGF3YWl0IHdlYnJ0Y3VwO1xuICAgIGF3YWl0IHVudGlsRGF0YUNoYW5uZWxPcGVuKHJlbGlhYmxlQ2hhbm5lbCk7XG4gICAgYXdhaXQgdW50aWxEYXRhQ2hhbm5lbE9wZW4odW5yZWxpYWJsZUNoYW5uZWwpO1xuXG4gICAgLy8gZG9pbmcgdGhpcyBoZXJlIGlzIHNvcnQgb2YgYSBoYWNrIGFyb3VuZCBjaHJvbWUgcmVuZWdvdGlhdGlvbiB3ZWlyZG5lc3MgLS1cbiAgICAvLyBpZiB3ZSBkbyBpdCBwcmlvciB0byB3ZWJydGN1cCwgY2hyb21lIG9uIGdlYXIgVlIgd2lsbCBzb21ldGltZXMgcHV0IGFcbiAgICAvLyByZW5lZ290aWF0aW9uIG9mZmVyIGluIGZsaWdodCB3aGlsZSB0aGUgZmlyc3Qgb2ZmZXIgd2FzIHN0aWxsIGJlaW5nXG4gICAgLy8gcHJvY2Vzc2VkIGJ5IGphbnVzLiB3ZSBzaG91bGQgZmluZCBzb21lIG1vcmUgcHJpbmNpcGxlZCB3YXkgdG8gZmlndXJlIG91dFxuICAgIC8vIHdoZW4gamFudXMgaXMgZG9uZSBpbiB0aGUgZnV0dXJlLlxuICAgIGlmICh0aGlzLmxvY2FsTWVkaWFTdHJlYW0pIHtcbiAgICAgIHRoaXMubG9jYWxNZWRpYVN0cmVhbS5nZXRUcmFja3MoKS5mb3JFYWNoKHRyYWNrID0+IHtcbiAgICAgICAgY29ubi5hZGRUcmFjayh0cmFjaywgdGhpcy5sb2NhbE1lZGlhU3RyZWFtKTtcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIEhhbmRsZSBhbGwgb2YgdGhlIGpvaW4gYW5kIGxlYXZlIGV2ZW50cy5cbiAgICBoYW5kbGUub24oXCJldmVudFwiLCBldiA9PiB7XG4gICAgICB2YXIgZGF0YSA9IGV2LnBsdWdpbmRhdGEuZGF0YTtcbiAgICAgIGlmIChkYXRhLmV2ZW50ID09IFwiam9pblwiICYmIGRhdGEucm9vbV9pZCA9PSB0aGlzLnJvb20pIHtcbiAgICAgICAgaWYgKHRoaXMuZGVsYXllZFJlY29ubmVjdFRpbWVvdXQpIHtcbiAgICAgICAgICAvLyBEb24ndCBjcmVhdGUgYSBuZXcgUlRDUGVlckNvbm5lY3Rpb24sIGFsbCBSVENQZWVyQ29ubmVjdGlvbiB3aWxsIGJlIGNsb3NlZCBpbiBsZXNzIHRoYW4gMTBzLlxuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmFkZE9jY3VwYW50KGRhdGEudXNlcl9pZCk7XG4gICAgICB9IGVsc2UgaWYgKGRhdGEuZXZlbnQgPT0gXCJsZWF2ZVwiICYmIGRhdGEucm9vbV9pZCA9PSB0aGlzLnJvb20pIHtcbiAgICAgICAgdGhpcy5yZW1vdmVPY2N1cGFudChkYXRhLnVzZXJfaWQpO1xuICAgICAgfSBlbHNlIGlmIChkYXRhLmV2ZW50ID09IFwiYmxvY2tlZFwiKSB7XG4gICAgICAgIGRvY3VtZW50LmJvZHkuZGlzcGF0Y2hFdmVudChuZXcgQ3VzdG9tRXZlbnQoXCJibG9ja2VkXCIsIHsgZGV0YWlsOiB7IGNsaWVudElkOiBkYXRhLmJ5IH0gfSkpO1xuICAgICAgfSBlbHNlIGlmIChkYXRhLmV2ZW50ID09IFwidW5ibG9ja2VkXCIpIHtcbiAgICAgICAgZG9jdW1lbnQuYm9keS5kaXNwYXRjaEV2ZW50KG5ldyBDdXN0b21FdmVudChcInVuYmxvY2tlZFwiLCB7IGRldGFpbDogeyBjbGllbnRJZDogZGF0YS5ieSB9IH0pKTtcbiAgICAgIH0gZWxzZSBpZiAoZGF0YS5ldmVudCA9PT0gXCJkYXRhXCIpIHtcbiAgICAgICAgdGhpcy5vbkRhdGEoSlNPTi5wYXJzZShkYXRhLmJvZHkpLCBcImphbnVzLWV2ZW50XCIpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgZGVidWcoXCJwdWIgd2FpdGluZyBmb3Igam9pblwiKTtcblxuICAgIC8vIFNlbmQgam9pbiBtZXNzYWdlIHRvIGphbnVzLiBMaXN0ZW4gZm9yIGpvaW4vbGVhdmUgbWVzc2FnZXMuIEF1dG9tYXRpY2FsbHkgc3Vic2NyaWJlIHRvIGFsbCB1c2VycycgV2ViUlRDIGRhdGEuXG4gICAgdmFyIG1lc3NhZ2UgPSBhd2FpdCB0aGlzLnNlbmRKb2luKGhhbmRsZSwge1xuICAgICAgbm90aWZpY2F0aW9uczogdHJ1ZSxcbiAgICAgIGRhdGE6IHRydWVcbiAgICB9KTtcblxuICAgIGlmICghbWVzc2FnZS5wbHVnaW5kYXRhLmRhdGEuc3VjY2Vzcykge1xuICAgICAgY29uc3QgZXJyID0gbWVzc2FnZS5wbHVnaW5kYXRhLmRhdGEuZXJyb3I7XG4gICAgICBjb25zb2xlLmVycm9yKGVycik7XG4gICAgICAvLyBXZSBtYXkgZ2V0IGhlcmUgYmVjYXVzZSBvZiBhbiBleHBpcmVkIEpXVC5cbiAgICAgIC8vIENsb3NlIHRoZSBjb25uZWN0aW9uIG91cnNlbGYgb3RoZXJ3aXNlIGphbnVzIHdpbGwgY2xvc2UgaXQgYWZ0ZXJcbiAgICAgIC8vIHNlc3Npb25fdGltZW91dCBiZWNhdXNlIHdlIGRpZG4ndCBzZW5kIGFueSBrZWVwYWxpdmUgYW5kIHRoaXMgd2lsbFxuICAgICAgLy8gdHJpZ2dlciBhIGRlbGF5ZWQgcmVjb25uZWN0IGJlY2F1c2Ugb2YgdGhlIGljZWNvbm5lY3Rpb25zdGF0ZWNoYW5nZVxuICAgICAgLy8gbGlzdGVuZXIgZm9yIGZhaWx1cmUgc3RhdGUuXG4gICAgICAvLyBFdmVuIGlmIHRoZSBhcHAgY29kZSBjYWxscyBkaXNjb25uZWN0IGluIGNhc2Ugb2YgZXJyb3IsIGRpc2Nvbm5lY3RcbiAgICAgIC8vIHdvbid0IGNsb3NlIHRoZSBwZWVyIGNvbm5lY3Rpb24gYmVjYXVzZSB0aGlzLnB1Ymxpc2hlciBpcyBub3Qgc2V0LlxuICAgICAgY29ubi5jbG9zZSgpO1xuICAgICAgdGhyb3cgZXJyO1xuICAgIH1cblxuICAgIHZhciBpbml0aWFsT2NjdXBhbnRzID0gbWVzc2FnZS5wbHVnaW5kYXRhLmRhdGEucmVzcG9uc2UudXNlcnNbdGhpcy5yb29tXSB8fCBbXTtcblxuICAgIGlmIChpbml0aWFsT2NjdXBhbnRzLmluY2x1ZGVzKHRoaXMuY2xpZW50SWQpKSB7XG4gICAgICBjb25zb2xlLndhcm4oXCJKYW51cyBzdGlsbCBoYXMgcHJldmlvdXMgc2Vzc2lvbiBmb3IgdGhpcyBjbGllbnQuIFJlY29ubmVjdGluZyBpbiAxMHMuXCIpO1xuICAgICAgdGhpcy5wZXJmb3JtRGVsYXllZFJlY29ubmVjdCgpO1xuICAgIH1cblxuICAgIGRlYnVnKFwicHVibGlzaGVyIHJlYWR5XCIpO1xuICAgIHJldHVybiB7XG4gICAgICBoYW5kbGUsXG4gICAgICBpbml0aWFsT2NjdXBhbnRzLFxuICAgICAgcmVsaWFibGVDaGFubmVsLFxuICAgICAgdW5yZWxpYWJsZUNoYW5uZWwsXG4gICAgICBjb25uXG4gICAgfTtcbiAgfVxuXG4gIGNvbmZpZ3VyZVB1Ymxpc2hlclNkcChqc2VwKSB7XG4gICAganNlcC5zZHAgPSBqc2VwLnNkcC5yZXBsYWNlKC9hPWZtdHA6KDEwOXwxMTEpLipcXHJcXG4vZywgKGxpbmUsIHB0KSA9PiB7XG4gICAgICBjb25zdCBwYXJhbWV0ZXJzID0gT2JqZWN0LmFzc2lnbihzZHBVdGlscy5wYXJzZUZtdHAobGluZSksIE9QVVNfUEFSQU1FVEVSUyk7XG4gICAgICByZXR1cm4gc2RwVXRpbHMud3JpdGVGbXRwKHsgcGF5bG9hZFR5cGU6IHB0LCBwYXJhbWV0ZXJzOiBwYXJhbWV0ZXJzIH0pO1xuICAgIH0pO1xuICAgIHJldHVybiBqc2VwO1xuICB9XG5cbiAgY29uZmlndXJlU3Vic2NyaWJlclNkcChqc2VwKSB7XG4gICAgLy8gdG9kbzogY29uc2lkZXIgY2xlYW5pbmcgdXAgdGhlc2UgaGFja3MgdG8gdXNlIHNkcHV0aWxzXG4gICAgaWYgKCFpc0gyNjRWaWRlb1N1cHBvcnRlZCkge1xuICAgICAgaWYgKG5hdmlnYXRvci51c2VyQWdlbnQuaW5kZXhPZihcIkhlYWRsZXNzQ2hyb21lXCIpICE9PSAtMSkge1xuICAgICAgICAvLyBIZWFkbGVzc0Nocm9tZSAoZS5nLiBwdXBwZXRlZXIpIGRvZXNuJ3Qgc3VwcG9ydCB3ZWJydGMgdmlkZW8gc3RyZWFtcywgc28gd2UgcmVtb3ZlIHRob3NlIGxpbmVzIGZyb20gdGhlIFNEUC5cbiAgICAgICAganNlcC5zZHAgPSBqc2VwLnNkcC5yZXBsYWNlKC9tPXZpZGVvW15dKm09LywgXCJtPVwiKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBUT0RPOiBIYWNrIHRvIGdldCB2aWRlbyB3b3JraW5nIG9uIENocm9tZSBmb3IgQW5kcm9pZC4gaHR0cHM6Ly9ncm91cHMuZ29vZ2xlLmNvbS9mb3J1bS8jIXRvcGljL21vemlsbGEuZGV2Lm1lZGlhL1llMjl2dU1UcG84XG4gICAgaWYgKG5hdmlnYXRvci51c2VyQWdlbnQuaW5kZXhPZihcIkFuZHJvaWRcIikgPT09IC0xKSB7XG4gICAgICBqc2VwLnNkcCA9IGpzZXAuc2RwLnJlcGxhY2UoXG4gICAgICAgIFwiYT1ydGNwLWZiOjEwNyBnb29nLXJlbWJcXHJcXG5cIixcbiAgICAgICAgXCJhPXJ0Y3AtZmI6MTA3IGdvb2ctcmVtYlxcclxcbmE9cnRjcC1mYjoxMDcgdHJhbnNwb3J0LWNjXFxyXFxuYT1mbXRwOjEwNyBsZXZlbC1hc3ltbWV0cnktYWxsb3dlZD0xO3BhY2tldGl6YXRpb24tbW9kZT0xO3Byb2ZpbGUtbGV2ZWwtaWQ9NDJlMDFmXFxyXFxuXCJcbiAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGpzZXAuc2RwID0ganNlcC5zZHAucmVwbGFjZShcbiAgICAgICAgXCJhPXJ0Y3AtZmI6MTA3IGdvb2ctcmVtYlxcclxcblwiLFxuICAgICAgICBcImE9cnRjcC1mYjoxMDcgZ29vZy1yZW1iXFxyXFxuYT1ydGNwLWZiOjEwNyB0cmFuc3BvcnQtY2NcXHJcXG5hPWZtdHA6MTA3IGxldmVsLWFzeW1tZXRyeS1hbGxvd2VkPTE7cGFja2V0aXphdGlvbi1tb2RlPTE7cHJvZmlsZS1sZXZlbC1pZD00MjAwMWZcXHJcXG5cIlxuICAgICAgKTtcbiAgICB9XG4gICAgcmV0dXJuIGpzZXA7XG4gIH1cblxuICBhc3luYyBmaXhTYWZhcmlJY2VVRnJhZyhqc2VwKSB7XG4gICAgLy8gU2FmYXJpIHByb2R1Y2VzIGEgXFxuIGluc3RlYWQgb2YgYW4gXFxyXFxuIGZvciB0aGUgaWNlLXVmcmFnLiBTZWUgaHR0cHM6Ly9naXRodWIuY29tL21lZXRlY2hvL2phbnVzLWdhdGV3YXkvaXNzdWVzLzE4MThcbiAgICBqc2VwLnNkcCA9IGpzZXAuc2RwLnJlcGxhY2UoL1teXFxyXVxcbmE9aWNlLXVmcmFnL2csIFwiXFxyXFxuYT1pY2UtdWZyYWdcIik7XG4gICAgcmV0dXJuIGpzZXBcbiAgfVxuXG4gIGFzeW5jIGNyZWF0ZVN1YnNjcmliZXIob2NjdXBhbnRJZCwgbWF4UmV0cmllcyA9IDUpIHtcbiAgICBpZiAodGhpcy5sZWZ0T2NjdXBhbnRzLmhhcyhvY2N1cGFudElkKSkge1xuICAgICAgY29uc29sZS53YXJuKG9jY3VwYW50SWQgKyBcIjogY2FuY2VsbGVkIG9jY3VwYW50IGNvbm5lY3Rpb24sIG9jY3VwYW50IGxlZnQgYmVmb3JlIHN1YnNjcmlwdGlvbiBuZWdvdGF0aW9uLlwiKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIHZhciBoYW5kbGUgPSBuZXcgbWouSmFudXNQbHVnaW5IYW5kbGUodGhpcy5zZXNzaW9uKTtcbiAgICB2YXIgY29ubiA9IG5ldyBSVENQZWVyQ29ubmVjdGlvbih0aGlzLnBlZXJDb25uZWN0aW9uQ29uZmlnIHx8IERFRkFVTFRfUEVFUl9DT05ORUNUSU9OX0NPTkZJRyk7XG5cbiAgICBkZWJ1ZyhvY2N1cGFudElkICsgXCI6IHN1YiB3YWl0aW5nIGZvciBzZnVcIik7XG4gICAgYXdhaXQgaGFuZGxlLmF0dGFjaChcImphbnVzLnBsdWdpbi5zZnVcIiwgdGhpcy5sb29wcyA/IHBhcnNlSW50KG9jY3VwYW50SWQpICUgdGhpcy5sb29wcyA6IHVuZGVmaW5lZCk7XG5cbiAgICB0aGlzLmFzc29jaWF0ZShjb25uLCBoYW5kbGUpO1xuXG4gICAgZGVidWcob2NjdXBhbnRJZCArIFwiOiBzdWIgd2FpdGluZyBmb3Igam9pblwiKTtcblxuICAgIGlmICh0aGlzLmxlZnRPY2N1cGFudHMuaGFzKG9jY3VwYW50SWQpKSB7XG4gICAgICBjb25uLmNsb3NlKCk7XG4gICAgICBjb25zb2xlLndhcm4ob2NjdXBhbnRJZCArIFwiOiBjYW5jZWxsZWQgb2NjdXBhbnQgY29ubmVjdGlvbiwgb2NjdXBhbnQgbGVmdCBhZnRlciBhdHRhY2hcIik7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBsZXQgd2VicnRjRmFpbGVkID0gZmFsc2U7XG5cbiAgICBjb25zdCB3ZWJydGN1cCA9IG5ldyBQcm9taXNlKHJlc29sdmUgPT4ge1xuICAgICAgY29uc3QgbGVmdEludGVydmFsID0gc2V0SW50ZXJ2YWwoKCkgPT4ge1xuICAgICAgICBpZiAodGhpcy5sZWZ0T2NjdXBhbnRzLmhhcyhvY2N1cGFudElkKSkge1xuICAgICAgICAgIGNsZWFySW50ZXJ2YWwobGVmdEludGVydmFsKTtcbiAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgIH1cbiAgICAgIH0sIDEwMDApO1xuXG4gICAgICBjb25zdCB0aW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIGNsZWFySW50ZXJ2YWwobGVmdEludGVydmFsKTtcbiAgICAgICAgd2VicnRjRmFpbGVkID0gdHJ1ZTtcbiAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgfSwgU1VCU0NSSUJFX1RJTUVPVVRfTVMpO1xuXG4gICAgICBoYW5kbGUub24oXCJ3ZWJydGN1cFwiLCAoKSA9PiB7XG4gICAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICAgICAgY2xlYXJJbnRlcnZhbChsZWZ0SW50ZXJ2YWwpO1xuICAgICAgICByZXNvbHZlKCk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIC8vIFNlbmQgam9pbiBtZXNzYWdlIHRvIGphbnVzLiBEb24ndCBsaXN0ZW4gZm9yIGpvaW4vbGVhdmUgbWVzc2FnZXMuIFN1YnNjcmliZSB0byB0aGUgb2NjdXBhbnQncyBtZWRpYS5cbiAgICAvLyBKYW51cyBzaG91bGQgc2VuZCB1cyBhbiBvZmZlciBmb3IgdGhpcyBvY2N1cGFudCdzIG1lZGlhIGluIHJlc3BvbnNlIHRvIHRoaXMuXG4gICAgYXdhaXQgdGhpcy5zZW5kSm9pbihoYW5kbGUsIHsgbWVkaWE6IG9jY3VwYW50SWQgfSk7XG5cbiAgICBpZiAodGhpcy5sZWZ0T2NjdXBhbnRzLmhhcyhvY2N1cGFudElkKSkge1xuICAgICAgY29ubi5jbG9zZSgpO1xuICAgICAgY29uc29sZS53YXJuKG9jY3VwYW50SWQgKyBcIjogY2FuY2VsbGVkIG9jY3VwYW50IGNvbm5lY3Rpb24sIG9jY3VwYW50IGxlZnQgYWZ0ZXIgam9pblwiKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGRlYnVnKG9jY3VwYW50SWQgKyBcIjogc3ViIHdhaXRpbmcgZm9yIHdlYnJ0Y3VwXCIpO1xuICAgIGF3YWl0IHdlYnJ0Y3VwO1xuXG4gICAgaWYgKHRoaXMubGVmdE9jY3VwYW50cy5oYXMob2NjdXBhbnRJZCkpIHtcbiAgICAgIGNvbm4uY2xvc2UoKTtcbiAgICAgIGNvbnNvbGUud2FybihvY2N1cGFudElkICsgXCI6IGNhbmNlbCBvY2N1cGFudCBjb25uZWN0aW9uLCBvY2N1cGFudCBsZWZ0IGR1cmluZyBvciBhZnRlciB3ZWJydGN1cFwiKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGlmICh3ZWJydGNGYWlsZWQpIHtcbiAgICAgIGNvbm4uY2xvc2UoKTtcbiAgICAgIGlmIChtYXhSZXRyaWVzID4gMCkge1xuICAgICAgICBjb25zb2xlLndhcm4ob2NjdXBhbnRJZCArIFwiOiB3ZWJydGMgdXAgdGltZWQgb3V0LCByZXRyeWluZ1wiKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlU3Vic2NyaWJlcihvY2N1cGFudElkLCBtYXhSZXRyaWVzIC0gMSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zb2xlLndhcm4ob2NjdXBhbnRJZCArIFwiOiB3ZWJydGMgdXAgdGltZWQgb3V0XCIpO1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoaXNTYWZhcmkgJiYgIXRoaXMuX2lPU0hhY2tEZWxheWVkSW5pdGlhbFBlZXIpIHtcbiAgICAgIC8vIEhBQ0s6IHRoZSBmaXJzdCBwZWVyIG9uIFNhZmFyaSBkdXJpbmcgcGFnZSBsb2FkIGNhbiBmYWlsIHRvIHdvcmsgaWYgd2UgZG9uJ3RcbiAgICAgIC8vIHdhaXQgc29tZSB0aW1lIGJlZm9yZSBjb250aW51aW5nIGhlcmUuIFNlZTogaHR0cHM6Ly9naXRodWIuY29tL21vemlsbGEvaHVicy9wdWxsLzE2OTJcbiAgICAgIGF3YWl0IChuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gc2V0VGltZW91dChyZXNvbHZlLCAzMDAwKSkpO1xuICAgICAgdGhpcy5faU9TSGFja0RlbGF5ZWRJbml0aWFsUGVlciA9IHRydWU7XG4gICAgfVxuXG4gICAgdmFyIG1lZGlhU3RyZWFtID0gbmV3IE1lZGlhU3RyZWFtKCk7XG4gICAgdmFyIHJlY2VpdmVycyA9IGNvbm4uZ2V0UmVjZWl2ZXJzKCk7XG4gICAgcmVjZWl2ZXJzLmZvckVhY2gocmVjZWl2ZXIgPT4ge1xuICAgICAgaWYgKHJlY2VpdmVyLnRyYWNrKSB7XG4gICAgICAgIG1lZGlhU3RyZWFtLmFkZFRyYWNrKHJlY2VpdmVyLnRyYWNrKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBpZiAobWVkaWFTdHJlYW0uZ2V0VHJhY2tzKCkubGVuZ3RoID09PSAwKSB7XG4gICAgICBtZWRpYVN0cmVhbSA9IG51bGw7XG4gICAgfVxuXG4gICAgZGVidWcob2NjdXBhbnRJZCArIFwiOiBzdWJzY3JpYmVyIHJlYWR5XCIpO1xuICAgIHJldHVybiB7XG4gICAgICBoYW5kbGUsXG4gICAgICBtZWRpYVN0cmVhbSxcbiAgICAgIGNvbm5cbiAgICB9O1xuICB9XG5cbiAgc2VuZEpvaW4oaGFuZGxlLCBzdWJzY3JpYmUpIHtcbiAgICByZXR1cm4gaGFuZGxlLnNlbmRNZXNzYWdlKHtcbiAgICAgIGtpbmQ6IFwiam9pblwiLFxuICAgICAgcm9vbV9pZDogdGhpcy5yb29tLFxuICAgICAgdXNlcl9pZDogdGhpcy5jbGllbnRJZCxcbiAgICAgIHN1YnNjcmliZSxcbiAgICAgIHRva2VuOiB0aGlzLmpvaW5Ub2tlblxuICAgIH0pO1xuICB9XG5cbiAgdG9nZ2xlRnJlZXplKCkge1xuICAgIGlmICh0aGlzLmZyb3plbikge1xuICAgICAgdGhpcy51bmZyZWV6ZSgpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmZyZWV6ZSgpO1xuICAgIH1cbiAgfVxuXG4gIGZyZWV6ZSgpIHtcbiAgICB0aGlzLmZyb3plbiA9IHRydWU7XG4gIH1cblxuICB1bmZyZWV6ZSgpIHtcbiAgICB0aGlzLmZyb3plbiA9IGZhbHNlO1xuICAgIHRoaXMuZmx1c2hQZW5kaW5nVXBkYXRlcygpO1xuICB9XG5cbiAgZGF0YUZvclVwZGF0ZU11bHRpTWVzc2FnZShuZXR3b3JrSWQsIG1lc3NhZ2UpIHtcbiAgICAvLyBcImRcIiBpcyBhbiBhcnJheSBvZiBlbnRpdHkgZGF0YXMsIHdoZXJlIGVhY2ggaXRlbSBpbiB0aGUgYXJyYXkgcmVwcmVzZW50cyBhIHVuaXF1ZSBlbnRpdHkgYW5kIGNvbnRhaW5zXG4gICAgLy8gbWV0YWRhdGEgZm9yIHRoZSBlbnRpdHksIGFuZCBhbiBhcnJheSBvZiBjb21wb25lbnRzIHRoYXQgaGF2ZSBiZWVuIHVwZGF0ZWQgb24gdGhlIGVudGl0eS5cbiAgICAvLyBUaGlzIG1ldGhvZCBmaW5kcyB0aGUgZGF0YSBjb3JyZXNwb25kaW5nIHRvIHRoZSBnaXZlbiBuZXR3b3JrSWQuXG4gICAgZm9yIChsZXQgaSA9IDAsIGwgPSBtZXNzYWdlLmRhdGEuZC5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAgIGNvbnN0IGRhdGEgPSBtZXNzYWdlLmRhdGEuZFtpXTtcblxuICAgICAgaWYgKGRhdGEubmV0d29ya0lkID09PSBuZXR3b3JrSWQpIHtcbiAgICAgICAgcmV0dXJuIGRhdGE7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBnZXRQZW5kaW5nRGF0YShuZXR3b3JrSWQsIG1lc3NhZ2UpIHtcbiAgICBpZiAoIW1lc3NhZ2UpIHJldHVybiBudWxsO1xuXG4gICAgbGV0IGRhdGEgPSBtZXNzYWdlLmRhdGFUeXBlID09PSBcInVtXCIgPyB0aGlzLmRhdGFGb3JVcGRhdGVNdWx0aU1lc3NhZ2UobmV0d29ya0lkLCBtZXNzYWdlKSA6IG1lc3NhZ2UuZGF0YTtcblxuICAgIC8vIElnbm9yZSBtZXNzYWdlcyByZWxhdGluZyB0byB1c2VycyB3aG8gaGF2ZSBkaXNjb25uZWN0ZWQgc2luY2UgZnJlZXppbmcsIHRoZWlyIGVudGl0aWVzXG4gICAgLy8gd2lsbCBoYXZlIGFsZWFkeSBiZWVuIHJlbW92ZWQgYnkgTkFGLlxuICAgIC8vIE5vdGUgdGhhdCBkZWxldGUgbWVzc2FnZXMgaGF2ZSBubyBcIm93bmVyXCIgc28gd2UgaGF2ZSB0byBjaGVjayBmb3IgdGhhdCBhcyB3ZWxsLlxuICAgIGlmIChkYXRhLm93bmVyICYmICF0aGlzLm9jY3VwYW50c1tkYXRhLm93bmVyXSkgcmV0dXJuIG51bGw7XG5cbiAgICAvLyBJZ25vcmUgbWVzc2FnZXMgZnJvbSB1c2VycyB0aGF0IHdlIG1heSBoYXZlIGJsb2NrZWQgd2hpbGUgZnJvemVuLlxuICAgIGlmIChkYXRhLm93bmVyICYmIHRoaXMuYmxvY2tlZENsaWVudHMuaGFzKGRhdGEub3duZXIpKSByZXR1cm4gbnVsbDtcblxuICAgIHJldHVybiBkYXRhXG4gIH1cblxuICAvLyBVc2VkIGV4dGVybmFsbHlcbiAgZ2V0UGVuZGluZ0RhdGFGb3JOZXR3b3JrSWQobmV0d29ya0lkKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0UGVuZGluZ0RhdGEobmV0d29ya0lkLCB0aGlzLmZyb3plblVwZGF0ZXMuZ2V0KG5ldHdvcmtJZCkpO1xuICB9XG5cbiAgZmx1c2hQZW5kaW5nVXBkYXRlcygpIHtcbiAgICBmb3IgKGNvbnN0IFtuZXR3b3JrSWQsIG1lc3NhZ2VdIG9mIHRoaXMuZnJvemVuVXBkYXRlcykge1xuICAgICAgbGV0IGRhdGEgPSB0aGlzLmdldFBlbmRpbmdEYXRhKG5ldHdvcmtJZCwgbWVzc2FnZSk7XG4gICAgICBpZiAoIWRhdGEpIGNvbnRpbnVlO1xuXG4gICAgICAvLyBPdmVycmlkZSB0aGUgZGF0YSB0eXBlIG9uIFwidW1cIiBtZXNzYWdlcyB0eXBlcywgc2luY2Ugd2UgZXh0cmFjdCBlbnRpdHkgdXBkYXRlcyBmcm9tIFwidW1cIiBtZXNzYWdlcyBpbnRvXG4gICAgICAvLyBpbmRpdmlkdWFsIGZyb3plblVwZGF0ZXMgaW4gc3RvcmVTaW5nbGVNZXNzYWdlLlxuICAgICAgY29uc3QgZGF0YVR5cGUgPSBtZXNzYWdlLmRhdGFUeXBlID09PSBcInVtXCIgPyBcInVcIiA6IG1lc3NhZ2UuZGF0YVR5cGU7XG5cbiAgICAgIHRoaXMub25PY2N1cGFudE1lc3NhZ2UobnVsbCwgZGF0YVR5cGUsIGRhdGEsIG1lc3NhZ2Uuc291cmNlKTtcbiAgICB9XG4gICAgdGhpcy5mcm96ZW5VcGRhdGVzLmNsZWFyKCk7XG4gIH1cblxuICBzdG9yZU1lc3NhZ2UobWVzc2FnZSkge1xuICAgIGlmIChtZXNzYWdlLmRhdGFUeXBlID09PSBcInVtXCIpIHsgLy8gVXBkYXRlTXVsdGlcbiAgICAgIGZvciAobGV0IGkgPSAwLCBsID0gbWVzc2FnZS5kYXRhLmQubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICAgIHRoaXMuc3RvcmVTaW5nbGVNZXNzYWdlKG1lc3NhZ2UsIGkpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnN0b3JlU2luZ2xlTWVzc2FnZShtZXNzYWdlKTtcbiAgICB9XG4gIH1cblxuICBzdG9yZVNpbmdsZU1lc3NhZ2UobWVzc2FnZSwgaW5kZXgpIHtcbiAgICBjb25zdCBkYXRhID0gaW5kZXggIT09IHVuZGVmaW5lZCA/IG1lc3NhZ2UuZGF0YS5kW2luZGV4XSA6IG1lc3NhZ2UuZGF0YTtcbiAgICBjb25zdCBkYXRhVHlwZSA9IG1lc3NhZ2UuZGF0YVR5cGU7XG4gICAgY29uc3Qgc291cmNlID0gbWVzc2FnZS5zb3VyY2U7XG5cbiAgICBjb25zdCBuZXR3b3JrSWQgPSBkYXRhLm5ldHdvcmtJZDtcblxuICAgIGlmICghdGhpcy5mcm96ZW5VcGRhdGVzLmhhcyhuZXR3b3JrSWQpKSB7XG4gICAgICB0aGlzLmZyb3plblVwZGF0ZXMuc2V0KG5ldHdvcmtJZCwgbWVzc2FnZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IHN0b3JlZE1lc3NhZ2UgPSB0aGlzLmZyb3plblVwZGF0ZXMuZ2V0KG5ldHdvcmtJZCk7XG4gICAgICBjb25zdCBzdG9yZWREYXRhID0gc3RvcmVkTWVzc2FnZS5kYXRhVHlwZSA9PT0gXCJ1bVwiID8gdGhpcy5kYXRhRm9yVXBkYXRlTXVsdGlNZXNzYWdlKG5ldHdvcmtJZCwgc3RvcmVkTWVzc2FnZSkgOiBzdG9yZWRNZXNzYWdlLmRhdGE7XG5cbiAgICAgIC8vIEF2b2lkIHVwZGF0aW5nIGNvbXBvbmVudHMgaWYgdGhlIGVudGl0eSBkYXRhIHJlY2VpdmVkIGRpZCBub3QgY29tZSBmcm9tIHRoZSBjdXJyZW50IG93bmVyLlxuICAgICAgY29uc3QgaXNPdXRkYXRlZE1lc3NhZ2UgPSBkYXRhLmxhc3RPd25lclRpbWUgPCBzdG9yZWREYXRhLmxhc3RPd25lclRpbWU7XG4gICAgICBjb25zdCBpc0NvbnRlbXBvcmFuZW91c01lc3NhZ2UgPSBkYXRhLmxhc3RPd25lclRpbWUgPT09IHN0b3JlZERhdGEubGFzdE93bmVyVGltZTtcbiAgICAgIGlmIChpc091dGRhdGVkTWVzc2FnZSB8fCAoaXNDb250ZW1wb3JhbmVvdXNNZXNzYWdlICYmIHN0b3JlZERhdGEub3duZXIgPiBkYXRhLm93bmVyKSkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmIChkYXRhVHlwZSA9PT0gXCJyXCIpIHtcbiAgICAgICAgY29uc3QgY3JlYXRlZFdoaWxlRnJvemVuID0gc3RvcmVkRGF0YSAmJiBzdG9yZWREYXRhLmlzRmlyc3RTeW5jO1xuICAgICAgICBpZiAoY3JlYXRlZFdoaWxlRnJvemVuKSB7XG4gICAgICAgICAgLy8gSWYgdGhlIGVudGl0eSB3YXMgY3JlYXRlZCBhbmQgZGVsZXRlZCB3aGlsZSBmcm96ZW4sIGRvbid0IGJvdGhlciBjb252ZXlpbmcgYW55dGhpbmcgdG8gdGhlIGNvbnN1bWVyLlxuICAgICAgICAgIHRoaXMuZnJvemVuVXBkYXRlcy5kZWxldGUobmV0d29ya0lkKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBEZWxldGUgbWVzc2FnZXMgb3ZlcnJpZGUgYW55IG90aGVyIG1lc3NhZ2VzIGZvciB0aGlzIGVudGl0eVxuICAgICAgICAgIHRoaXMuZnJvemVuVXBkYXRlcy5zZXQobmV0d29ya0lkLCBtZXNzYWdlKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gbWVyZ2UgaW4gY29tcG9uZW50IHVwZGF0ZXNcbiAgICAgICAgaWYgKHN0b3JlZERhdGEuY29tcG9uZW50cyAmJiBkYXRhLmNvbXBvbmVudHMpIHtcbiAgICAgICAgICBPYmplY3QuYXNzaWduKHN0b3JlZERhdGEuY29tcG9uZW50cywgZGF0YS5jb21wb25lbnRzKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIG9uRGF0YUNoYW5uZWxNZXNzYWdlKGUsIHNvdXJjZSkge1xuICAgIHRoaXMub25EYXRhKEpTT04ucGFyc2UoZS5kYXRhKSwgc291cmNlKTtcbiAgfVxuXG4gIG9uRGF0YShtZXNzYWdlLCBzb3VyY2UpIHtcbiAgICBpZiAoZGVidWcuZW5hYmxlZCkge1xuICAgICAgZGVidWcoYERDIGluOiAke21lc3NhZ2V9YCk7XG4gICAgfVxuXG4gICAgaWYgKCFtZXNzYWdlLmRhdGFUeXBlKSByZXR1cm47XG5cbiAgICBtZXNzYWdlLnNvdXJjZSA9IHNvdXJjZTtcblxuICAgIGlmICh0aGlzLmZyb3plbikge1xuICAgICAgdGhpcy5zdG9yZU1lc3NhZ2UobWVzc2FnZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMub25PY2N1cGFudE1lc3NhZ2UobnVsbCwgbWVzc2FnZS5kYXRhVHlwZSwgbWVzc2FnZS5kYXRhLCBtZXNzYWdlLnNvdXJjZSk7XG4gICAgfVxuICB9XG5cbiAgc2hvdWxkU3RhcnRDb25uZWN0aW9uVG8oY2xpZW50KSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICBzdGFydFN0cmVhbUNvbm5lY3Rpb24oY2xpZW50KSB7fVxuXG4gIGNsb3NlU3RyZWFtQ29ubmVjdGlvbihjbGllbnQpIHt9XG5cbiAgZ2V0Q29ubmVjdFN0YXR1cyhjbGllbnRJZCkge1xuICAgIHJldHVybiB0aGlzLm9jY3VwYW50c1tjbGllbnRJZF0gPyBOQUYuYWRhcHRlcnMuSVNfQ09OTkVDVEVEIDogTkFGLmFkYXB0ZXJzLk5PVF9DT05ORUNURUQ7XG4gIH1cblxuICBhc3luYyB1cGRhdGVUaW1lT2Zmc2V0KCkge1xuICAgIGlmICh0aGlzLmlzRGlzY29ubmVjdGVkKCkpIHJldHVybjtcblxuICAgIGNvbnN0IGNsaWVudFNlbnRUaW1lID0gRGF0ZS5ub3coKTtcblxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoKGRvY3VtZW50LmxvY2F0aW9uLmhyZWYsIHtcbiAgICAgIG1ldGhvZDogXCJIRUFEXCIsXG4gICAgICBjYWNoZTogXCJuby1jYWNoZVwiXG4gICAgfSk7XG5cbiAgICBjb25zdCBwcmVjaXNpb24gPSAxMDAwO1xuICAgIGNvbnN0IHNlcnZlclJlY2VpdmVkVGltZSA9IG5ldyBEYXRlKHJlcy5oZWFkZXJzLmdldChcIkRhdGVcIikpLmdldFRpbWUoKSArIHByZWNpc2lvbiAvIDI7XG4gICAgY29uc3QgY2xpZW50UmVjZWl2ZWRUaW1lID0gRGF0ZS5ub3coKTtcbiAgICBjb25zdCBzZXJ2ZXJUaW1lID0gc2VydmVyUmVjZWl2ZWRUaW1lICsgKGNsaWVudFJlY2VpdmVkVGltZSAtIGNsaWVudFNlbnRUaW1lKSAvIDI7XG4gICAgY29uc3QgdGltZU9mZnNldCA9IHNlcnZlclRpbWUgLSBjbGllbnRSZWNlaXZlZFRpbWU7XG5cbiAgICB0aGlzLnNlcnZlclRpbWVSZXF1ZXN0cysrO1xuXG4gICAgaWYgKHRoaXMuc2VydmVyVGltZVJlcXVlc3RzIDw9IDEwKSB7XG4gICAgICB0aGlzLnRpbWVPZmZzZXRzLnB1c2godGltZU9mZnNldCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMudGltZU9mZnNldHNbdGhpcy5zZXJ2ZXJUaW1lUmVxdWVzdHMgJSAxMF0gPSB0aW1lT2Zmc2V0O1xuICAgIH1cblxuICAgIHRoaXMuYXZnVGltZU9mZnNldCA9IHRoaXMudGltZU9mZnNldHMucmVkdWNlKChhY2MsIG9mZnNldCkgPT4gKGFjYyArPSBvZmZzZXQpLCAwKSAvIHRoaXMudGltZU9mZnNldHMubGVuZ3RoO1xuXG4gICAgaWYgKHRoaXMuc2VydmVyVGltZVJlcXVlc3RzID4gMTApIHtcbiAgICAgIGRlYnVnKGBuZXcgc2VydmVyIHRpbWUgb2Zmc2V0OiAke3RoaXMuYXZnVGltZU9mZnNldH1tc2ApO1xuICAgICAgc2V0VGltZW91dCgoKSA9PiB0aGlzLnVwZGF0ZVRpbWVPZmZzZXQoKSwgNSAqIDYwICogMTAwMCk7IC8vIFN5bmMgY2xvY2sgZXZlcnkgNSBtaW51dGVzLlxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnVwZGF0ZVRpbWVPZmZzZXQoKTtcbiAgICB9XG4gIH1cblxuICBnZXRTZXJ2ZXJUaW1lKCkge1xuICAgIHJldHVybiBEYXRlLm5vdygpICsgdGhpcy5hdmdUaW1lT2Zmc2V0O1xuICB9XG5cbiAgZ2V0TWVkaWFTdHJlYW0oY2xpZW50SWQsIHR5cGUgPSBcImF1ZGlvXCIpIHtcbiAgICBpZiAodGhpcy5tZWRpYVN0cmVhbXNbY2xpZW50SWRdKSB7XG4gICAgICBkZWJ1ZyhgQWxyZWFkeSBoYWQgJHt0eXBlfSBmb3IgJHtjbGllbnRJZH1gKTtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodGhpcy5tZWRpYVN0cmVhbXNbY2xpZW50SWRdW3R5cGVdKTtcbiAgICB9IGVsc2Uge1xuICAgICAgZGVidWcoYFdhaXRpbmcgb24gJHt0eXBlfSBmb3IgJHtjbGllbnRJZH1gKTtcbiAgICAgIGlmICghdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5oYXMoY2xpZW50SWQpKSB7XG4gICAgICAgIHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuc2V0KGNsaWVudElkLCB7fSk7XG5cbiAgICAgICAgY29uc3QgYXVkaW9Qcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICAgIHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuZ2V0KGNsaWVudElkKS5hdWRpbyA9IHsgcmVzb2x2ZSwgcmVqZWN0IH07XG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCB2aWRlb1Byb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgICAgdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5nZXQoY2xpZW50SWQpLnZpZGVvID0geyByZXNvbHZlLCByZWplY3QgfTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5nZXQoY2xpZW50SWQpLmF1ZGlvLnByb21pc2UgPSBhdWRpb1Byb21pc2U7XG4gICAgICAgIHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuZ2V0KGNsaWVudElkKS52aWRlby5wcm9taXNlID0gdmlkZW9Qcm9taXNlO1xuXG4gICAgICAgIGF1ZGlvUHJvbWlzZS5jYXRjaChlID0+IGNvbnNvbGUud2FybihgJHtjbGllbnRJZH0gZ2V0TWVkaWFTdHJlYW0gQXVkaW8gRXJyb3JgLCBlKSk7XG4gICAgICAgIHZpZGVvUHJvbWlzZS5jYXRjaChlID0+IGNvbnNvbGUud2FybihgJHtjbGllbnRJZH0gZ2V0TWVkaWFTdHJlYW0gVmlkZW8gRXJyb3JgLCBlKSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5nZXQoY2xpZW50SWQpW3R5cGVdLnByb21pc2U7XG4gICAgfVxuICB9XG5cbiAgc2V0TWVkaWFTdHJlYW0oY2xpZW50SWQsIHN0cmVhbSkge1xuICAgIC8vIFNhZmFyaSBkb2Vzbid0IGxpa2UgaXQgd2hlbiB5b3UgdXNlIHNpbmdsZSBhIG1peGVkIG1lZGlhIHN0cmVhbSB3aGVyZSBvbmUgb2YgdGhlIHRyYWNrcyBpcyBpbmFjdGl2ZSwgc28gd2VcbiAgICAvLyBzcGxpdCB0aGUgdHJhY2tzIGludG8gdHdvIHN0cmVhbXMuXG4gICAgY29uc3QgYXVkaW9TdHJlYW0gPSBuZXcgTWVkaWFTdHJlYW0oKTtcbiAgICB0cnkge1xuICAgIHN0cmVhbS5nZXRBdWRpb1RyYWNrcygpLmZvckVhY2godHJhY2sgPT4gYXVkaW9TdHJlYW0uYWRkVHJhY2sodHJhY2spKTtcblxuICAgIH0gY2F0Y2goZSkge1xuICAgICAgY29uc29sZS53YXJuKGAke2NsaWVudElkfSBzZXRNZWRpYVN0cmVhbSBBdWRpbyBFcnJvcmAsIGUpO1xuICAgIH1cbiAgICBjb25zdCB2aWRlb1N0cmVhbSA9IG5ldyBNZWRpYVN0cmVhbSgpO1xuICAgIHRyeSB7XG4gICAgc3RyZWFtLmdldFZpZGVvVHJhY2tzKCkuZm9yRWFjaCh0cmFjayA9PiB2aWRlb1N0cmVhbS5hZGRUcmFjayh0cmFjaykpO1xuXG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc29sZS53YXJuKGAke2NsaWVudElkfSBzZXRNZWRpYVN0cmVhbSBWaWRlbyBFcnJvcmAsIGUpO1xuICAgIH1cblxuICAgIHRoaXMubWVkaWFTdHJlYW1zW2NsaWVudElkXSA9IHsgYXVkaW86IGF1ZGlvU3RyZWFtLCB2aWRlbzogdmlkZW9TdHJlYW0gfTtcblxuICAgIC8vIFJlc29sdmUgdGhlIHByb21pc2UgZm9yIHRoZSB1c2VyJ3MgbWVkaWEgc3RyZWFtIGlmIGl0IGV4aXN0cy5cbiAgICBpZiAodGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5oYXMoY2xpZW50SWQpKSB7XG4gICAgICB0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmdldChjbGllbnRJZCkuYXVkaW8ucmVzb2x2ZShhdWRpb1N0cmVhbSk7XG4gICAgICB0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmdldChjbGllbnRJZCkudmlkZW8ucmVzb2x2ZSh2aWRlb1N0cmVhbSk7XG4gICAgfVxuICB9XG5cbiAgZ2V0TG9jYWxNZWRpYVN0cmVhbSgpIHtcbiAgICByZXR1cm4gdGhpcy5sb2NhbE1lZGlhU3RyZWFtO1xuICB9XG5cbiAgYXN5bmMgc2V0TG9jYWxNZWRpYVN0cmVhbShzdHJlYW0pIHtcbiAgICAvLyBvdXIgam9iIGhlcmUgaXMgdG8gbWFrZSBzdXJlIHRoZSBjb25uZWN0aW9uIHdpbmRzIHVwIHdpdGggUlRQIHNlbmRlcnMgc2VuZGluZyB0aGUgc3R1ZmYgaW4gdGhpcyBzdHJlYW0sXG4gICAgLy8gYW5kIG5vdCB0aGUgc3R1ZmYgdGhhdCBpc24ndCBpbiB0aGlzIHN0cmVhbS4gc3RyYXRlZ3kgaXMgdG8gcmVwbGFjZSBleGlzdGluZyB0cmFja3MgaWYgd2UgY2FuLCBhZGQgdHJhY2tzXG4gICAgLy8gdGhhdCB3ZSBjYW4ndCByZXBsYWNlLCBhbmQgZGlzYWJsZSB0cmFja3MgdGhhdCBkb24ndCBleGlzdCBhbnltb3JlLlxuXG4gICAgLy8gbm90ZSB0aGF0IHdlIGRvbid0IGV2ZXIgcmVtb3ZlIGEgdHJhY2sgZnJvbSB0aGUgc3RyZWFtIC0tIHNpbmNlIEphbnVzIGRvZXNuJ3Qgc3VwcG9ydCBVbmlmaWVkIFBsYW4sIHdlIGFic29sdXRlbHlcbiAgICAvLyBjYW4ndCB3aW5kIHVwIHdpdGggYSBTRFAgdGhhdCBoYXMgPjEgYXVkaW8gb3IgPjEgdmlkZW8gdHJhY2tzLCBldmVuIGlmIG9uZSBvZiB0aGVtIGlzIGluYWN0aXZlICh3aGF0IHlvdSBnZXQgaWZcbiAgICAvLyB5b3UgcmVtb3ZlIGEgdHJhY2sgZnJvbSBhbiBleGlzdGluZyBzdHJlYW0uKVxuICAgIGlmICh0aGlzLnB1Ymxpc2hlciAmJiB0aGlzLnB1Ymxpc2hlci5jb25uKSB7XG4gICAgICBjb25zdCBleGlzdGluZ1NlbmRlcnMgPSB0aGlzLnB1Ymxpc2hlci5jb25uLmdldFNlbmRlcnMoKTtcbiAgICAgIGNvbnN0IG5ld1NlbmRlcnMgPSBbXTtcbiAgICAgIGNvbnN0IHRyYWNrcyA9IHN0cmVhbS5nZXRUcmFja3MoKTtcblxuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0cmFja3MubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgY29uc3QgdCA9IHRyYWNrc1tpXTtcbiAgICAgICAgY29uc3Qgc2VuZGVyID0gZXhpc3RpbmdTZW5kZXJzLmZpbmQocyA9PiBzLnRyYWNrICE9IG51bGwgJiYgcy50cmFjay5raW5kID09IHQua2luZCk7XG5cbiAgICAgICAgaWYgKHNlbmRlciAhPSBudWxsKSB7XG4gICAgICAgICAgaWYgKHNlbmRlci5yZXBsYWNlVHJhY2spIHtcbiAgICAgICAgICAgIGF3YWl0IHNlbmRlci5yZXBsYWNlVHJhY2sodCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIEZhbGxiYWNrIGZvciBicm93c2VycyB0aGF0IGRvbid0IHN1cHBvcnQgcmVwbGFjZVRyYWNrLiBBdCB0aGlzIHRpbWUgb2YgdGhpcyB3cml0aW5nXG4gICAgICAgICAgICAvLyBtb3N0IGJyb3dzZXJzIHN1cHBvcnQgaXQsIGFuZCB0ZXN0aW5nIHRoaXMgY29kZSBwYXRoIHNlZW1zIHRvIG5vdCB3b3JrIHByb3Blcmx5XG4gICAgICAgICAgICAvLyBpbiBDaHJvbWUgYW55bW9yZS5cbiAgICAgICAgICAgIHN0cmVhbS5yZW1vdmVUcmFjayhzZW5kZXIudHJhY2spO1xuICAgICAgICAgICAgc3RyZWFtLmFkZFRyYWNrKHQpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBuZXdTZW5kZXJzLnB1c2goc2VuZGVyKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBuZXdTZW5kZXJzLnB1c2godGhpcy5wdWJsaXNoZXIuY29ubi5hZGRUcmFjayh0LCBzdHJlYW0pKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgZXhpc3RpbmdTZW5kZXJzLmZvckVhY2gocyA9PiB7XG4gICAgICAgIGlmICghbmV3U2VuZGVycy5pbmNsdWRlcyhzKSkge1xuICAgICAgICAgIHMudHJhY2suZW5hYmxlZCA9IGZhbHNlO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gICAgdGhpcy5sb2NhbE1lZGlhU3RyZWFtID0gc3RyZWFtO1xuICAgIHRoaXMuc2V0TWVkaWFTdHJlYW0odGhpcy5jbGllbnRJZCwgc3RyZWFtKTtcbiAgfVxuXG4gIGVuYWJsZU1pY3JvcGhvbmUoZW5hYmxlZCkge1xuICAgIGlmICh0aGlzLnB1Ymxpc2hlciAmJiB0aGlzLnB1Ymxpc2hlci5jb25uKSB7XG4gICAgICB0aGlzLnB1Ymxpc2hlci5jb25uLmdldFNlbmRlcnMoKS5mb3JFYWNoKHMgPT4ge1xuICAgICAgICBpZiAocy50cmFjay5raW5kID09IFwiYXVkaW9cIikge1xuICAgICAgICAgIHMudHJhY2suZW5hYmxlZCA9IGVuYWJsZWQ7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIHNlbmREYXRhKGNsaWVudElkLCBkYXRhVHlwZSwgZGF0YSkge1xuICAgIGlmICghdGhpcy5wdWJsaXNoZXIpIHtcbiAgICAgIGNvbnNvbGUud2FybihcInNlbmREYXRhIGNhbGxlZCB3aXRob3V0IGEgcHVibGlzaGVyXCIpO1xuICAgIH0gZWxzZSB7XG4gICAgICBzd2l0Y2ggKHRoaXMudW5yZWxpYWJsZVRyYW5zcG9ydCkge1xuICAgICAgICBjYXNlIFwid2Vic29ja2V0XCI6XG4gICAgICAgICAgaWYgKHRoaXMud3MucmVhZHlTdGF0ZSA9PT0gMSkgeyAvLyBPUEVOXG4gICAgICAgICAgICB0aGlzLnB1Ymxpc2hlci5oYW5kbGUuc2VuZE1lc3NhZ2UoeyBraW5kOiBcImRhdGFcIiwgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBkYXRhVHlwZSwgZGF0YSB9KSwgd2hvbTogY2xpZW50SWQgfSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIFwiZGF0YWNoYW5uZWxcIjpcbiAgICAgICAgICBpZiAodGhpcy5wdWJsaXNoZXIudW5yZWxpYWJsZUNoYW5uZWwucmVhZHlTdGF0ZSA9PT0gXCJvcGVuXCIpIHtcbiAgICAgICAgICAgIHRoaXMucHVibGlzaGVyLnVucmVsaWFibGVDaGFubmVsLnNlbmQoSlNPTi5zdHJpbmdpZnkoeyBjbGllbnRJZCwgZGF0YVR5cGUsIGRhdGEgfSkpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICB0aGlzLnVucmVsaWFibGVUcmFuc3BvcnQoY2xpZW50SWQsIGRhdGFUeXBlLCBkYXRhKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBzZW5kRGF0YUd1YXJhbnRlZWQoY2xpZW50SWQsIGRhdGFUeXBlLCBkYXRhKSB7XG4gICAgaWYgKCF0aGlzLnB1Ymxpc2hlcikge1xuICAgICAgY29uc29sZS53YXJuKFwic2VuZERhdGFHdWFyYW50ZWVkIGNhbGxlZCB3aXRob3V0IGEgcHVibGlzaGVyXCIpO1xuICAgIH0gZWxzZSB7XG4gICAgICBzd2l0Y2ggKHRoaXMucmVsaWFibGVUcmFuc3BvcnQpIHtcbiAgICAgICAgY2FzZSBcIndlYnNvY2tldFwiOlxuICAgICAgICAgIGlmICh0aGlzLndzLnJlYWR5U3RhdGUgPT09IDEpIHsgLy8gT1BFTlxuICAgICAgICAgICAgdGhpcy5wdWJsaXNoZXIuaGFuZGxlLnNlbmRNZXNzYWdlKHsga2luZDogXCJkYXRhXCIsIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZGF0YVR5cGUsIGRhdGEgfSksIHdob206IGNsaWVudElkIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSBcImRhdGFjaGFubmVsXCI6XG4gICAgICAgICAgaWYgKHRoaXMucHVibGlzaGVyLnJlbGlhYmxlQ2hhbm5lbC5yZWFkeVN0YXRlID09PSBcIm9wZW5cIikge1xuICAgICAgICAgICAgdGhpcy5wdWJsaXNoZXIucmVsaWFibGVDaGFubmVsLnNlbmQoSlNPTi5zdHJpbmdpZnkoeyBjbGllbnRJZCwgZGF0YVR5cGUsIGRhdGEgfSkpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICB0aGlzLnJlbGlhYmxlVHJhbnNwb3J0KGNsaWVudElkLCBkYXRhVHlwZSwgZGF0YSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgYnJvYWRjYXN0RGF0YShkYXRhVHlwZSwgZGF0YSkge1xuICAgIGlmICghdGhpcy5wdWJsaXNoZXIpIHtcbiAgICAgIGNvbnNvbGUud2FybihcImJyb2FkY2FzdERhdGEgY2FsbGVkIHdpdGhvdXQgYSBwdWJsaXNoZXJcIik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHN3aXRjaCAodGhpcy51bnJlbGlhYmxlVHJhbnNwb3J0KSB7XG4gICAgICAgIGNhc2UgXCJ3ZWJzb2NrZXRcIjpcbiAgICAgICAgICBpZiAodGhpcy53cy5yZWFkeVN0YXRlID09PSAxKSB7IC8vIE9QRU5cbiAgICAgICAgICAgIHRoaXMucHVibGlzaGVyLmhhbmRsZS5zZW5kTWVzc2FnZSh7IGtpbmQ6IFwiZGF0YVwiLCBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGRhdGFUeXBlLCBkYXRhIH0pIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSBcImRhdGFjaGFubmVsXCI6XG4gICAgICAgICAgaWYgKHRoaXMucHVibGlzaGVyLnVucmVsaWFibGVDaGFubmVsLnJlYWR5U3RhdGUgPT09IFwib3BlblwiKSB7XG4gICAgICAgICAgICB0aGlzLnB1Ymxpc2hlci51bnJlbGlhYmxlQ2hhbm5lbC5zZW5kKEpTT04uc3RyaW5naWZ5KHsgZGF0YVR5cGUsIGRhdGEgfSkpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICB0aGlzLnVucmVsaWFibGVUcmFuc3BvcnQodW5kZWZpbmVkLCBkYXRhVHlwZSwgZGF0YSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgYnJvYWRjYXN0RGF0YUd1YXJhbnRlZWQoZGF0YVR5cGUsIGRhdGEpIHtcbiAgICBpZiAoIXRoaXMucHVibGlzaGVyKSB7XG4gICAgICBjb25zb2xlLndhcm4oXCJicm9hZGNhc3REYXRhR3VhcmFudGVlZCBjYWxsZWQgd2l0aG91dCBhIHB1Ymxpc2hlclwiKTtcbiAgICB9IGVsc2Uge1xuICAgICAgc3dpdGNoICh0aGlzLnJlbGlhYmxlVHJhbnNwb3J0KSB7XG4gICAgICAgIGNhc2UgXCJ3ZWJzb2NrZXRcIjpcbiAgICAgICAgICBpZiAodGhpcy53cy5yZWFkeVN0YXRlID09PSAxKSB7IC8vIE9QRU5cbiAgICAgICAgICAgIHRoaXMucHVibGlzaGVyLmhhbmRsZS5zZW5kTWVzc2FnZSh7IGtpbmQ6IFwiZGF0YVwiLCBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGRhdGFUeXBlLCBkYXRhIH0pIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSBcImRhdGFjaGFubmVsXCI6XG4gICAgICAgICAgaWYgKHRoaXMucHVibGlzaGVyLnJlbGlhYmxlQ2hhbm5lbC5yZWFkeVN0YXRlID09PSBcIm9wZW5cIikge1xuICAgICAgICAgICAgdGhpcy5wdWJsaXNoZXIucmVsaWFibGVDaGFubmVsLnNlbmQoSlNPTi5zdHJpbmdpZnkoeyBkYXRhVHlwZSwgZGF0YSB9KSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHRoaXMucmVsaWFibGVUcmFuc3BvcnQodW5kZWZpbmVkLCBkYXRhVHlwZSwgZGF0YSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAga2ljayhjbGllbnRJZCwgcGVybXNUb2tlbikge1xuICAgIHJldHVybiB0aGlzLnB1Ymxpc2hlci5oYW5kbGUuc2VuZE1lc3NhZ2UoeyBraW5kOiBcImtpY2tcIiwgcm9vbV9pZDogdGhpcy5yb29tLCB1c2VyX2lkOiBjbGllbnRJZCwgdG9rZW46IHBlcm1zVG9rZW4gfSkudGhlbigoKSA9PiB7XG4gICAgICBkb2N1bWVudC5ib2R5LmRpc3BhdGNoRXZlbnQobmV3IEN1c3RvbUV2ZW50KFwia2lja2VkXCIsIHsgZGV0YWlsOiB7IGNsaWVudElkOiBjbGllbnRJZCB9IH0pKTtcbiAgICB9KTtcbiAgfVxuXG4gIGJsb2NrKGNsaWVudElkKSB7XG4gICAgcmV0dXJuIHRoaXMucHVibGlzaGVyLmhhbmRsZS5zZW5kTWVzc2FnZSh7IGtpbmQ6IFwiYmxvY2tcIiwgd2hvbTogY2xpZW50SWQgfSkudGhlbigoKSA9PiB7XG4gICAgICB0aGlzLmJsb2NrZWRDbGllbnRzLnNldChjbGllbnRJZCwgdHJ1ZSk7XG4gICAgICBkb2N1bWVudC5ib2R5LmRpc3BhdGNoRXZlbnQobmV3IEN1c3RvbUV2ZW50KFwiYmxvY2tlZFwiLCB7IGRldGFpbDogeyBjbGllbnRJZDogY2xpZW50SWQgfSB9KSk7XG4gICAgfSk7XG4gIH1cblxuICB1bmJsb2NrKGNsaWVudElkKSB7XG4gICAgcmV0dXJuIHRoaXMucHVibGlzaGVyLmhhbmRsZS5zZW5kTWVzc2FnZSh7IGtpbmQ6IFwidW5ibG9ja1wiLCB3aG9tOiBjbGllbnRJZCB9KS50aGVuKCgpID0+IHtcbiAgICAgIHRoaXMuYmxvY2tlZENsaWVudHMuZGVsZXRlKGNsaWVudElkKTtcbiAgICAgIGRvY3VtZW50LmJvZHkuZGlzcGF0Y2hFdmVudChuZXcgQ3VzdG9tRXZlbnQoXCJ1bmJsb2NrZWRcIiwgeyBkZXRhaWw6IHsgY2xpZW50SWQ6IGNsaWVudElkIH0gfSkpO1xuICAgIH0pO1xuICB9XG59XG5cbk5BRi5hZGFwdGVycy5yZWdpc3RlcihcImphbnVzXCIsIEphbnVzQWRhcHRlcik7XG5cbm1vZHVsZS5leHBvcnRzID0gSmFudXNBZGFwdGVyO1xuIiwiLyogZXNsaW50LWVudiBub2RlICovXG4ndXNlIHN0cmljdCc7XG5cbi8vIFNEUCBoZWxwZXJzLlxuY29uc3QgU0RQVXRpbHMgPSB7fTtcblxuLy8gR2VuZXJhdGUgYW4gYWxwaGFudW1lcmljIGlkZW50aWZpZXIgZm9yIGNuYW1lIG9yIG1pZHMuXG4vLyBUT0RPOiB1c2UgVVVJRHMgaW5zdGVhZD8gaHR0cHM6Ly9naXN0LmdpdGh1Yi5jb20vamVkLzk4Mjg4M1xuU0RQVXRpbHMuZ2VuZXJhdGVJZGVudGlmaWVyID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zdWJzdHJpbmcoMiwgMTIpO1xufTtcblxuLy8gVGhlIFJUQ1AgQ05BTUUgdXNlZCBieSBhbGwgcGVlcmNvbm5lY3Rpb25zIGZyb20gdGhlIHNhbWUgSlMuXG5TRFBVdGlscy5sb2NhbENOYW1lID0gU0RQVXRpbHMuZ2VuZXJhdGVJZGVudGlmaWVyKCk7XG5cbi8vIFNwbGl0cyBTRFAgaW50byBsaW5lcywgZGVhbGluZyB3aXRoIGJvdGggQ1JMRiBhbmQgTEYuXG5TRFBVdGlscy5zcGxpdExpbmVzID0gZnVuY3Rpb24oYmxvYikge1xuICByZXR1cm4gYmxvYi50cmltKCkuc3BsaXQoJ1xcbicpLm1hcChsaW5lID0+IGxpbmUudHJpbSgpKTtcbn07XG4vLyBTcGxpdHMgU0RQIGludG8gc2Vzc2lvbnBhcnQgYW5kIG1lZGlhc2VjdGlvbnMuIEVuc3VyZXMgQ1JMRi5cblNEUFV0aWxzLnNwbGl0U2VjdGlvbnMgPSBmdW5jdGlvbihibG9iKSB7XG4gIGNvbnN0IHBhcnRzID0gYmxvYi5zcGxpdCgnXFxubT0nKTtcbiAgcmV0dXJuIHBhcnRzLm1hcCgocGFydCwgaW5kZXgpID0+IChpbmRleCA+IDAgP1xuICAgICdtPScgKyBwYXJ0IDogcGFydCkudHJpbSgpICsgJ1xcclxcbicpO1xufTtcblxuLy8gUmV0dXJucyB0aGUgc2Vzc2lvbiBkZXNjcmlwdGlvbi5cblNEUFV0aWxzLmdldERlc2NyaXB0aW9uID0gZnVuY3Rpb24oYmxvYikge1xuICBjb25zdCBzZWN0aW9ucyA9IFNEUFV0aWxzLnNwbGl0U2VjdGlvbnMoYmxvYik7XG4gIHJldHVybiBzZWN0aW9ucyAmJiBzZWN0aW9uc1swXTtcbn07XG5cbi8vIFJldHVybnMgdGhlIGluZGl2aWR1YWwgbWVkaWEgc2VjdGlvbnMuXG5TRFBVdGlscy5nZXRNZWRpYVNlY3Rpb25zID0gZnVuY3Rpb24oYmxvYikge1xuICBjb25zdCBzZWN0aW9ucyA9IFNEUFV0aWxzLnNwbGl0U2VjdGlvbnMoYmxvYik7XG4gIHNlY3Rpb25zLnNoaWZ0KCk7XG4gIHJldHVybiBzZWN0aW9ucztcbn07XG5cbi8vIFJldHVybnMgbGluZXMgdGhhdCBzdGFydCB3aXRoIGEgY2VydGFpbiBwcmVmaXguXG5TRFBVdGlscy5tYXRjaFByZWZpeCA9IGZ1bmN0aW9uKGJsb2IsIHByZWZpeCkge1xuICByZXR1cm4gU0RQVXRpbHMuc3BsaXRMaW5lcyhibG9iKS5maWx0ZXIobGluZSA9PiBsaW5lLmluZGV4T2YocHJlZml4KSA9PT0gMCk7XG59O1xuXG4vLyBQYXJzZXMgYW4gSUNFIGNhbmRpZGF0ZSBsaW5lLiBTYW1wbGUgaW5wdXQ6XG4vLyBjYW5kaWRhdGU6NzAyNzg2MzUwIDIgdWRwIDQxODE5OTAyIDguOC44LjggNjA3NjkgdHlwIHJlbGF5IHJhZGRyIDguOC44Ljhcbi8vIHJwb3J0IDU1OTk2XCJcbi8vIElucHV0IGNhbiBiZSBwcmVmaXhlZCB3aXRoIGE9LlxuU0RQVXRpbHMucGFyc2VDYW5kaWRhdGUgPSBmdW5jdGlvbihsaW5lKSB7XG4gIGxldCBwYXJ0cztcbiAgLy8gUGFyc2UgYm90aCB2YXJpYW50cy5cbiAgaWYgKGxpbmUuaW5kZXhPZignYT1jYW5kaWRhdGU6JykgPT09IDApIHtcbiAgICBwYXJ0cyA9IGxpbmUuc3Vic3RyaW5nKDEyKS5zcGxpdCgnICcpO1xuICB9IGVsc2Uge1xuICAgIHBhcnRzID0gbGluZS5zdWJzdHJpbmcoMTApLnNwbGl0KCcgJyk7XG4gIH1cblxuICBjb25zdCBjYW5kaWRhdGUgPSB7XG4gICAgZm91bmRhdGlvbjogcGFydHNbMF0sXG4gICAgY29tcG9uZW50OiB7MTogJ3J0cCcsIDI6ICdydGNwJ31bcGFydHNbMV1dIHx8IHBhcnRzWzFdLFxuICAgIHByb3RvY29sOiBwYXJ0c1syXS50b0xvd2VyQ2FzZSgpLFxuICAgIHByaW9yaXR5OiBwYXJzZUludChwYXJ0c1szXSwgMTApLFxuICAgIGlwOiBwYXJ0c1s0XSxcbiAgICBhZGRyZXNzOiBwYXJ0c1s0XSwgLy8gYWRkcmVzcyBpcyBhbiBhbGlhcyBmb3IgaXAuXG4gICAgcG9ydDogcGFyc2VJbnQocGFydHNbNV0sIDEwKSxcbiAgICAvLyBza2lwIHBhcnRzWzZdID09ICd0eXAnXG4gICAgdHlwZTogcGFydHNbN10sXG4gIH07XG5cbiAgZm9yIChsZXQgaSA9IDg7IGkgPCBwYXJ0cy5sZW5ndGg7IGkgKz0gMikge1xuICAgIHN3aXRjaCAocGFydHNbaV0pIHtcbiAgICAgIGNhc2UgJ3JhZGRyJzpcbiAgICAgICAgY2FuZGlkYXRlLnJlbGF0ZWRBZGRyZXNzID0gcGFydHNbaSArIDFdO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3Jwb3J0JzpcbiAgICAgICAgY2FuZGlkYXRlLnJlbGF0ZWRQb3J0ID0gcGFyc2VJbnQocGFydHNbaSArIDFdLCAxMCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAndGNwdHlwZSc6XG4gICAgICAgIGNhbmRpZGF0ZS50Y3BUeXBlID0gcGFydHNbaSArIDFdO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3VmcmFnJzpcbiAgICAgICAgY2FuZGlkYXRlLnVmcmFnID0gcGFydHNbaSArIDFdOyAvLyBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eS5cbiAgICAgICAgY2FuZGlkYXRlLnVzZXJuYW1lRnJhZ21lbnQgPSBwYXJ0c1tpICsgMV07XG4gICAgICAgIGJyZWFrO1xuICAgICAgZGVmYXVsdDogLy8gZXh0ZW5zaW9uIGhhbmRsaW5nLCBpbiBwYXJ0aWN1bGFyIHVmcmFnLiBEb24ndCBvdmVyd3JpdGUuXG4gICAgICAgIGlmIChjYW5kaWRhdGVbcGFydHNbaV1dID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBjYW5kaWRhdGVbcGFydHNbaV1dID0gcGFydHNbaSArIDFdO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuICByZXR1cm4gY2FuZGlkYXRlO1xufTtcblxuLy8gVHJhbnNsYXRlcyBhIGNhbmRpZGF0ZSBvYmplY3QgaW50byBTRFAgY2FuZGlkYXRlIGF0dHJpYnV0ZS5cbi8vIFRoaXMgZG9lcyBub3QgaW5jbHVkZSB0aGUgYT0gcHJlZml4IVxuU0RQVXRpbHMud3JpdGVDYW5kaWRhdGUgPSBmdW5jdGlvbihjYW5kaWRhdGUpIHtcbiAgY29uc3Qgc2RwID0gW107XG4gIHNkcC5wdXNoKGNhbmRpZGF0ZS5mb3VuZGF0aW9uKTtcblxuICBjb25zdCBjb21wb25lbnQgPSBjYW5kaWRhdGUuY29tcG9uZW50O1xuICBpZiAoY29tcG9uZW50ID09PSAncnRwJykge1xuICAgIHNkcC5wdXNoKDEpO1xuICB9IGVsc2UgaWYgKGNvbXBvbmVudCA9PT0gJ3J0Y3AnKSB7XG4gICAgc2RwLnB1c2goMik7XG4gIH0gZWxzZSB7XG4gICAgc2RwLnB1c2goY29tcG9uZW50KTtcbiAgfVxuICBzZHAucHVzaChjYW5kaWRhdGUucHJvdG9jb2wudG9VcHBlckNhc2UoKSk7XG4gIHNkcC5wdXNoKGNhbmRpZGF0ZS5wcmlvcml0eSk7XG4gIHNkcC5wdXNoKGNhbmRpZGF0ZS5hZGRyZXNzIHx8IGNhbmRpZGF0ZS5pcCk7XG4gIHNkcC5wdXNoKGNhbmRpZGF0ZS5wb3J0KTtcblxuICBjb25zdCB0eXBlID0gY2FuZGlkYXRlLnR5cGU7XG4gIHNkcC5wdXNoKCd0eXAnKTtcbiAgc2RwLnB1c2godHlwZSk7XG4gIGlmICh0eXBlICE9PSAnaG9zdCcgJiYgY2FuZGlkYXRlLnJlbGF0ZWRBZGRyZXNzICYmXG4gICAgICBjYW5kaWRhdGUucmVsYXRlZFBvcnQgIT09IHVuZGVmaW5lZCkge1xuICAgIHNkcC5wdXNoKCdyYWRkcicpO1xuICAgIHNkcC5wdXNoKGNhbmRpZGF0ZS5yZWxhdGVkQWRkcmVzcyk7XG4gICAgc2RwLnB1c2goJ3Jwb3J0Jyk7XG4gICAgc2RwLnB1c2goY2FuZGlkYXRlLnJlbGF0ZWRQb3J0KTtcbiAgfVxuICBpZiAoY2FuZGlkYXRlLnRjcFR5cGUgJiYgY2FuZGlkYXRlLnByb3RvY29sLnRvTG93ZXJDYXNlKCkgPT09ICd0Y3AnKSB7XG4gICAgc2RwLnB1c2goJ3RjcHR5cGUnKTtcbiAgICBzZHAucHVzaChjYW5kaWRhdGUudGNwVHlwZSk7XG4gIH1cbiAgaWYgKGNhbmRpZGF0ZS51c2VybmFtZUZyYWdtZW50IHx8IGNhbmRpZGF0ZS51ZnJhZykge1xuICAgIHNkcC5wdXNoKCd1ZnJhZycpO1xuICAgIHNkcC5wdXNoKGNhbmRpZGF0ZS51c2VybmFtZUZyYWdtZW50IHx8IGNhbmRpZGF0ZS51ZnJhZyk7XG4gIH1cbiAgcmV0dXJuICdjYW5kaWRhdGU6JyArIHNkcC5qb2luKCcgJyk7XG59O1xuXG4vLyBQYXJzZXMgYW4gaWNlLW9wdGlvbnMgbGluZSwgcmV0dXJucyBhbiBhcnJheSBvZiBvcHRpb24gdGFncy5cbi8vIFNhbXBsZSBpbnB1dDpcbi8vIGE9aWNlLW9wdGlvbnM6Zm9vIGJhclxuU0RQVXRpbHMucGFyc2VJY2VPcHRpb25zID0gZnVuY3Rpb24obGluZSkge1xuICByZXR1cm4gbGluZS5zdWJzdHJpbmcoMTQpLnNwbGl0KCcgJyk7XG59O1xuXG4vLyBQYXJzZXMgYSBydHBtYXAgbGluZSwgcmV0dXJucyBSVENSdHBDb2RkZWNQYXJhbWV0ZXJzLiBTYW1wbGUgaW5wdXQ6XG4vLyBhPXJ0cG1hcDoxMTEgb3B1cy80ODAwMC8yXG5TRFBVdGlscy5wYXJzZVJ0cE1hcCA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgbGV0IHBhcnRzID0gbGluZS5zdWJzdHJpbmcoOSkuc3BsaXQoJyAnKTtcbiAgY29uc3QgcGFyc2VkID0ge1xuICAgIHBheWxvYWRUeXBlOiBwYXJzZUludChwYXJ0cy5zaGlmdCgpLCAxMCksIC8vIHdhczogaWRcbiAgfTtcblxuICBwYXJ0cyA9IHBhcnRzWzBdLnNwbGl0KCcvJyk7XG5cbiAgcGFyc2VkLm5hbWUgPSBwYXJ0c1swXTtcbiAgcGFyc2VkLmNsb2NrUmF0ZSA9IHBhcnNlSW50KHBhcnRzWzFdLCAxMCk7IC8vIHdhczogY2xvY2tyYXRlXG4gIHBhcnNlZC5jaGFubmVscyA9IHBhcnRzLmxlbmd0aCA9PT0gMyA/IHBhcnNlSW50KHBhcnRzWzJdLCAxMCkgOiAxO1xuICAvLyBsZWdhY3kgYWxpYXMsIGdvdCByZW5hbWVkIGJhY2sgdG8gY2hhbm5lbHMgaW4gT1JUQy5cbiAgcGFyc2VkLm51bUNoYW5uZWxzID0gcGFyc2VkLmNoYW5uZWxzO1xuICByZXR1cm4gcGFyc2VkO1xufTtcblxuLy8gR2VuZXJhdGVzIGEgcnRwbWFwIGxpbmUgZnJvbSBSVENSdHBDb2RlY0NhcGFiaWxpdHkgb3Jcbi8vIFJUQ1J0cENvZGVjUGFyYW1ldGVycy5cblNEUFV0aWxzLndyaXRlUnRwTWFwID0gZnVuY3Rpb24oY29kZWMpIHtcbiAgbGV0IHB0ID0gY29kZWMucGF5bG9hZFR5cGU7XG4gIGlmIChjb2RlYy5wcmVmZXJyZWRQYXlsb2FkVHlwZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgcHQgPSBjb2RlYy5wcmVmZXJyZWRQYXlsb2FkVHlwZTtcbiAgfVxuICBjb25zdCBjaGFubmVscyA9IGNvZGVjLmNoYW5uZWxzIHx8IGNvZGVjLm51bUNoYW5uZWxzIHx8IDE7XG4gIHJldHVybiAnYT1ydHBtYXA6JyArIHB0ICsgJyAnICsgY29kZWMubmFtZSArICcvJyArIGNvZGVjLmNsb2NrUmF0ZSArXG4gICAgICAoY2hhbm5lbHMgIT09IDEgPyAnLycgKyBjaGFubmVscyA6ICcnKSArICdcXHJcXG4nO1xufTtcblxuLy8gUGFyc2VzIGEgZXh0bWFwIGxpbmUgKGhlYWRlcmV4dGVuc2lvbiBmcm9tIFJGQyA1Mjg1KS4gU2FtcGxlIGlucHV0OlxuLy8gYT1leHRtYXA6MiB1cm46aWV0ZjpwYXJhbXM6cnRwLWhkcmV4dDp0b2Zmc2V0XG4vLyBhPWV4dG1hcDoyL3NlbmRvbmx5IHVybjppZXRmOnBhcmFtczpydHAtaGRyZXh0OnRvZmZzZXRcblNEUFV0aWxzLnBhcnNlRXh0bWFwID0gZnVuY3Rpb24obGluZSkge1xuICBjb25zdCBwYXJ0cyA9IGxpbmUuc3Vic3RyaW5nKDkpLnNwbGl0KCcgJyk7XG4gIHJldHVybiB7XG4gICAgaWQ6IHBhcnNlSW50KHBhcnRzWzBdLCAxMCksXG4gICAgZGlyZWN0aW9uOiBwYXJ0c1swXS5pbmRleE9mKCcvJykgPiAwID8gcGFydHNbMF0uc3BsaXQoJy8nKVsxXSA6ICdzZW5kcmVjdicsXG4gICAgdXJpOiBwYXJ0c1sxXSxcbiAgICBhdHRyaWJ1dGVzOiBwYXJ0cy5zbGljZSgyKS5qb2luKCcgJyksXG4gIH07XG59O1xuXG4vLyBHZW5lcmF0ZXMgYW4gZXh0bWFwIGxpbmUgZnJvbSBSVENSdHBIZWFkZXJFeHRlbnNpb25QYXJhbWV0ZXJzIG9yXG4vLyBSVENSdHBIZWFkZXJFeHRlbnNpb24uXG5TRFBVdGlscy53cml0ZUV4dG1hcCA9IGZ1bmN0aW9uKGhlYWRlckV4dGVuc2lvbikge1xuICByZXR1cm4gJ2E9ZXh0bWFwOicgKyAoaGVhZGVyRXh0ZW5zaW9uLmlkIHx8IGhlYWRlckV4dGVuc2lvbi5wcmVmZXJyZWRJZCkgK1xuICAgICAgKGhlYWRlckV4dGVuc2lvbi5kaXJlY3Rpb24gJiYgaGVhZGVyRXh0ZW5zaW9uLmRpcmVjdGlvbiAhPT0gJ3NlbmRyZWN2J1xuICAgICAgICA/ICcvJyArIGhlYWRlckV4dGVuc2lvbi5kaXJlY3Rpb25cbiAgICAgICAgOiAnJykgK1xuICAgICAgJyAnICsgaGVhZGVyRXh0ZW5zaW9uLnVyaSArXG4gICAgICAoaGVhZGVyRXh0ZW5zaW9uLmF0dHJpYnV0ZXMgPyAnICcgKyBoZWFkZXJFeHRlbnNpb24uYXR0cmlidXRlcyA6ICcnKSArXG4gICAgICAnXFxyXFxuJztcbn07XG5cbi8vIFBhcnNlcyBhIGZtdHAgbGluZSwgcmV0dXJucyBkaWN0aW9uYXJ5LiBTYW1wbGUgaW5wdXQ6XG4vLyBhPWZtdHA6OTYgdmJyPW9uO2NuZz1vblxuLy8gQWxzbyBkZWFscyB3aXRoIHZicj1vbjsgY25nPW9uXG4vLyBOb24ta2V5LXZhbHVlIHN1Y2ggYXMgdGVsZXBob25lLWV2ZW50cyBgMC0xNWAgZ2V0IHBhcnNlZCBhc1xuLy8ge2AwLTE1YDp1bmRlZmluZWR9XG5TRFBVdGlscy5wYXJzZUZtdHAgPSBmdW5jdGlvbihsaW5lKSB7XG4gIGNvbnN0IHBhcnNlZCA9IHt9O1xuICBsZXQga3Y7XG4gIGNvbnN0IHBhcnRzID0gbGluZS5zdWJzdHJpbmcobGluZS5pbmRleE9mKCcgJykgKyAxKS5zcGxpdCgnOycpO1xuICBmb3IgKGxldCBqID0gMDsgaiA8IHBhcnRzLmxlbmd0aDsgaisrKSB7XG4gICAga3YgPSBwYXJ0c1tqXS50cmltKCkuc3BsaXQoJz0nKTtcbiAgICBwYXJzZWRba3ZbMF0udHJpbSgpXSA9IGt2WzFdO1xuICB9XG4gIHJldHVybiBwYXJzZWQ7XG59O1xuXG4vLyBHZW5lcmF0ZXMgYSBmbXRwIGxpbmUgZnJvbSBSVENSdHBDb2RlY0NhcGFiaWxpdHkgb3IgUlRDUnRwQ29kZWNQYXJhbWV0ZXJzLlxuU0RQVXRpbHMud3JpdGVGbXRwID0gZnVuY3Rpb24oY29kZWMpIHtcbiAgbGV0IGxpbmUgPSAnJztcbiAgbGV0IHB0ID0gY29kZWMucGF5bG9hZFR5cGU7XG4gIGlmIChjb2RlYy5wcmVmZXJyZWRQYXlsb2FkVHlwZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgcHQgPSBjb2RlYy5wcmVmZXJyZWRQYXlsb2FkVHlwZTtcbiAgfVxuICBpZiAoY29kZWMucGFyYW1ldGVycyAmJiBPYmplY3Qua2V5cyhjb2RlYy5wYXJhbWV0ZXJzKS5sZW5ndGgpIHtcbiAgICBjb25zdCBwYXJhbXMgPSBbXTtcbiAgICBPYmplY3Qua2V5cyhjb2RlYy5wYXJhbWV0ZXJzKS5mb3JFYWNoKHBhcmFtID0+IHtcbiAgICAgIGlmIChjb2RlYy5wYXJhbWV0ZXJzW3BhcmFtXSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHBhcmFtcy5wdXNoKHBhcmFtICsgJz0nICsgY29kZWMucGFyYW1ldGVyc1twYXJhbV0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcGFyYW1zLnB1c2gocGFyYW0pO1xuICAgICAgfVxuICAgIH0pO1xuICAgIGxpbmUgKz0gJ2E9Zm10cDonICsgcHQgKyAnICcgKyBwYXJhbXMuam9pbignOycpICsgJ1xcclxcbic7XG4gIH1cbiAgcmV0dXJuIGxpbmU7XG59O1xuXG4vLyBQYXJzZXMgYSBydGNwLWZiIGxpbmUsIHJldHVybnMgUlRDUFJ0Y3BGZWVkYmFjayBvYmplY3QuIFNhbXBsZSBpbnB1dDpcbi8vIGE9cnRjcC1mYjo5OCBuYWNrIHJwc2lcblNEUFV0aWxzLnBhcnNlUnRjcEZiID0gZnVuY3Rpb24obGluZSkge1xuICBjb25zdCBwYXJ0cyA9IGxpbmUuc3Vic3RyaW5nKGxpbmUuaW5kZXhPZignICcpICsgMSkuc3BsaXQoJyAnKTtcbiAgcmV0dXJuIHtcbiAgICB0eXBlOiBwYXJ0cy5zaGlmdCgpLFxuICAgIHBhcmFtZXRlcjogcGFydHMuam9pbignICcpLFxuICB9O1xufTtcblxuLy8gR2VuZXJhdGUgYT1ydGNwLWZiIGxpbmVzIGZyb20gUlRDUnRwQ29kZWNDYXBhYmlsaXR5IG9yIFJUQ1J0cENvZGVjUGFyYW1ldGVycy5cblNEUFV0aWxzLndyaXRlUnRjcEZiID0gZnVuY3Rpb24oY29kZWMpIHtcbiAgbGV0IGxpbmVzID0gJyc7XG4gIGxldCBwdCA9IGNvZGVjLnBheWxvYWRUeXBlO1xuICBpZiAoY29kZWMucHJlZmVycmVkUGF5bG9hZFR5cGUgIT09IHVuZGVmaW5lZCkge1xuICAgIHB0ID0gY29kZWMucHJlZmVycmVkUGF5bG9hZFR5cGU7XG4gIH1cbiAgaWYgKGNvZGVjLnJ0Y3BGZWVkYmFjayAmJiBjb2RlYy5ydGNwRmVlZGJhY2subGVuZ3RoKSB7XG4gICAgLy8gRklYTUU6IHNwZWNpYWwgaGFuZGxpbmcgZm9yIHRyci1pbnQ/XG4gICAgY29kZWMucnRjcEZlZWRiYWNrLmZvckVhY2goZmIgPT4ge1xuICAgICAgbGluZXMgKz0gJ2E9cnRjcC1mYjonICsgcHQgKyAnICcgKyBmYi50eXBlICtcbiAgICAgIChmYi5wYXJhbWV0ZXIgJiYgZmIucGFyYW1ldGVyLmxlbmd0aCA/ICcgJyArIGZiLnBhcmFtZXRlciA6ICcnKSArXG4gICAgICAgICAgJ1xcclxcbic7XG4gICAgfSk7XG4gIH1cbiAgcmV0dXJuIGxpbmVzO1xufTtcblxuLy8gUGFyc2VzIGEgUkZDIDU1NzYgc3NyYyBtZWRpYSBhdHRyaWJ1dGUuIFNhbXBsZSBpbnB1dDpcbi8vIGE9c3NyYzozNzM1OTI4NTU5IGNuYW1lOnNvbWV0aGluZ1xuU0RQVXRpbHMucGFyc2VTc3JjTWVkaWEgPSBmdW5jdGlvbihsaW5lKSB7XG4gIGNvbnN0IHNwID0gbGluZS5pbmRleE9mKCcgJyk7XG4gIGNvbnN0IHBhcnRzID0ge1xuICAgIHNzcmM6IHBhcnNlSW50KGxpbmUuc3Vic3RyaW5nKDcsIHNwKSwgMTApLFxuICB9O1xuICBjb25zdCBjb2xvbiA9IGxpbmUuaW5kZXhPZignOicsIHNwKTtcbiAgaWYgKGNvbG9uID4gLTEpIHtcbiAgICBwYXJ0cy5hdHRyaWJ1dGUgPSBsaW5lLnN1YnN0cmluZyhzcCArIDEsIGNvbG9uKTtcbiAgICBwYXJ0cy52YWx1ZSA9IGxpbmUuc3Vic3RyaW5nKGNvbG9uICsgMSk7XG4gIH0gZWxzZSB7XG4gICAgcGFydHMuYXR0cmlidXRlID0gbGluZS5zdWJzdHJpbmcoc3AgKyAxKTtcbiAgfVxuICByZXR1cm4gcGFydHM7XG59O1xuXG4vLyBQYXJzZSBhIHNzcmMtZ3JvdXAgbGluZSAoc2VlIFJGQyA1NTc2KS4gU2FtcGxlIGlucHV0OlxuLy8gYT1zc3JjLWdyb3VwOnNlbWFudGljcyAxMiAzNFxuU0RQVXRpbHMucGFyc2VTc3JjR3JvdXAgPSBmdW5jdGlvbihsaW5lKSB7XG4gIGNvbnN0IHBhcnRzID0gbGluZS5zdWJzdHJpbmcoMTMpLnNwbGl0KCcgJyk7XG4gIHJldHVybiB7XG4gICAgc2VtYW50aWNzOiBwYXJ0cy5zaGlmdCgpLFxuICAgIHNzcmNzOiBwYXJ0cy5tYXAoc3NyYyA9PiBwYXJzZUludChzc3JjLCAxMCkpLFxuICB9O1xufTtcblxuLy8gRXh0cmFjdHMgdGhlIE1JRCAoUkZDIDU4ODgpIGZyb20gYSBtZWRpYSBzZWN0aW9uLlxuLy8gUmV0dXJucyB0aGUgTUlEIG9yIHVuZGVmaW5lZCBpZiBubyBtaWQgbGluZSB3YXMgZm91bmQuXG5TRFBVdGlscy5nZXRNaWQgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgY29uc3QgbWlkID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1taWQ6JylbMF07XG4gIGlmIChtaWQpIHtcbiAgICByZXR1cm4gbWlkLnN1YnN0cmluZyg2KTtcbiAgfVxufTtcblxuLy8gUGFyc2VzIGEgZmluZ2VycHJpbnQgbGluZSBmb3IgRFRMUy1TUlRQLlxuU0RQVXRpbHMucGFyc2VGaW5nZXJwcmludCA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgY29uc3QgcGFydHMgPSBsaW5lLnN1YnN0cmluZygxNCkuc3BsaXQoJyAnKTtcbiAgcmV0dXJuIHtcbiAgICBhbGdvcml0aG06IHBhcnRzWzBdLnRvTG93ZXJDYXNlKCksIC8vIGFsZ29yaXRobSBpcyBjYXNlLXNlbnNpdGl2ZSBpbiBFZGdlLlxuICAgIHZhbHVlOiBwYXJ0c1sxXS50b1VwcGVyQ2FzZSgpLCAvLyB0aGUgZGVmaW5pdGlvbiBpcyB1cHBlci1jYXNlIGluIFJGQyA0NTcyLlxuICB9O1xufTtcblxuLy8gRXh0cmFjdHMgRFRMUyBwYXJhbWV0ZXJzIGZyb20gU0RQIG1lZGlhIHNlY3Rpb24gb3Igc2Vzc2lvbnBhcnQuXG4vLyBGSVhNRTogZm9yIGNvbnNpc3RlbmN5IHdpdGggb3RoZXIgZnVuY3Rpb25zIHRoaXMgc2hvdWxkIG9ubHlcbi8vICAgZ2V0IHRoZSBmaW5nZXJwcmludCBsaW5lIGFzIGlucHV0LiBTZWUgYWxzbyBnZXRJY2VQYXJhbWV0ZXJzLlxuU0RQVXRpbHMuZ2V0RHRsc1BhcmFtZXRlcnMgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24sIHNlc3Npb25wYXJ0KSB7XG4gIGNvbnN0IGxpbmVzID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uICsgc2Vzc2lvbnBhcnQsXG4gICAgJ2E9ZmluZ2VycHJpbnQ6Jyk7XG4gIC8vIE5vdGU6IGE9c2V0dXAgbGluZSBpcyBpZ25vcmVkIHNpbmNlIHdlIHVzZSB0aGUgJ2F1dG8nIHJvbGUgaW4gRWRnZS5cbiAgcmV0dXJuIHtcbiAgICByb2xlOiAnYXV0bycsXG4gICAgZmluZ2VycHJpbnRzOiBsaW5lcy5tYXAoU0RQVXRpbHMucGFyc2VGaW5nZXJwcmludCksXG4gIH07XG59O1xuXG4vLyBTZXJpYWxpemVzIERUTFMgcGFyYW1ldGVycyB0byBTRFAuXG5TRFBVdGlscy53cml0ZUR0bHNQYXJhbWV0ZXJzID0gZnVuY3Rpb24ocGFyYW1zLCBzZXR1cFR5cGUpIHtcbiAgbGV0IHNkcCA9ICdhPXNldHVwOicgKyBzZXR1cFR5cGUgKyAnXFxyXFxuJztcbiAgcGFyYW1zLmZpbmdlcnByaW50cy5mb3JFYWNoKGZwID0+IHtcbiAgICBzZHAgKz0gJ2E9ZmluZ2VycHJpbnQ6JyArIGZwLmFsZ29yaXRobSArICcgJyArIGZwLnZhbHVlICsgJ1xcclxcbic7XG4gIH0pO1xuICByZXR1cm4gc2RwO1xufTtcblxuLy8gUGFyc2VzIGE9Y3J5cHRvIGxpbmVzIGludG9cbi8vICAgaHR0cHM6Ly9yYXdnaXQuY29tL2Fib2JhL2VkZ2VydGMvbWFzdGVyL21zb3J0Yy1yczQuaHRtbCNkaWN0aW9uYXJ5LXJ0Y3NydHBzZGVzcGFyYW1ldGVycy1tZW1iZXJzXG5TRFBVdGlscy5wYXJzZUNyeXB0b0xpbmUgPSBmdW5jdGlvbihsaW5lKSB7XG4gIGNvbnN0IHBhcnRzID0gbGluZS5zdWJzdHJpbmcoOSkuc3BsaXQoJyAnKTtcbiAgcmV0dXJuIHtcbiAgICB0YWc6IHBhcnNlSW50KHBhcnRzWzBdLCAxMCksXG4gICAgY3J5cHRvU3VpdGU6IHBhcnRzWzFdLFxuICAgIGtleVBhcmFtczogcGFydHNbMl0sXG4gICAgc2Vzc2lvblBhcmFtczogcGFydHMuc2xpY2UoMyksXG4gIH07XG59O1xuXG5TRFBVdGlscy53cml0ZUNyeXB0b0xpbmUgPSBmdW5jdGlvbihwYXJhbWV0ZXJzKSB7XG4gIHJldHVybiAnYT1jcnlwdG86JyArIHBhcmFtZXRlcnMudGFnICsgJyAnICtcbiAgICBwYXJhbWV0ZXJzLmNyeXB0b1N1aXRlICsgJyAnICtcbiAgICAodHlwZW9mIHBhcmFtZXRlcnMua2V5UGFyYW1zID09PSAnb2JqZWN0J1xuICAgICAgPyBTRFBVdGlscy53cml0ZUNyeXB0b0tleVBhcmFtcyhwYXJhbWV0ZXJzLmtleVBhcmFtcylcbiAgICAgIDogcGFyYW1ldGVycy5rZXlQYXJhbXMpICtcbiAgICAocGFyYW1ldGVycy5zZXNzaW9uUGFyYW1zID8gJyAnICsgcGFyYW1ldGVycy5zZXNzaW9uUGFyYW1zLmpvaW4oJyAnKSA6ICcnKSArXG4gICAgJ1xcclxcbic7XG59O1xuXG4vLyBQYXJzZXMgdGhlIGNyeXB0byBrZXkgcGFyYW1ldGVycyBpbnRvXG4vLyAgIGh0dHBzOi8vcmF3Z2l0LmNvbS9hYm9iYS9lZGdlcnRjL21hc3Rlci9tc29ydGMtcnM0Lmh0bWwjcnRjc3J0cGtleXBhcmFtKlxuU0RQVXRpbHMucGFyc2VDcnlwdG9LZXlQYXJhbXMgPSBmdW5jdGlvbihrZXlQYXJhbXMpIHtcbiAgaWYgKGtleVBhcmFtcy5pbmRleE9mKCdpbmxpbmU6JykgIT09IDApIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICBjb25zdCBwYXJ0cyA9IGtleVBhcmFtcy5zdWJzdHJpbmcoNykuc3BsaXQoJ3wnKTtcbiAgcmV0dXJuIHtcbiAgICBrZXlNZXRob2Q6ICdpbmxpbmUnLFxuICAgIGtleVNhbHQ6IHBhcnRzWzBdLFxuICAgIGxpZmVUaW1lOiBwYXJ0c1sxXSxcbiAgICBta2lWYWx1ZTogcGFydHNbMl0gPyBwYXJ0c1syXS5zcGxpdCgnOicpWzBdIDogdW5kZWZpbmVkLFxuICAgIG1raUxlbmd0aDogcGFydHNbMl0gPyBwYXJ0c1syXS5zcGxpdCgnOicpWzFdIDogdW5kZWZpbmVkLFxuICB9O1xufTtcblxuU0RQVXRpbHMud3JpdGVDcnlwdG9LZXlQYXJhbXMgPSBmdW5jdGlvbihrZXlQYXJhbXMpIHtcbiAgcmV0dXJuIGtleVBhcmFtcy5rZXlNZXRob2QgKyAnOidcbiAgICArIGtleVBhcmFtcy5rZXlTYWx0ICtcbiAgICAoa2V5UGFyYW1zLmxpZmVUaW1lID8gJ3wnICsga2V5UGFyYW1zLmxpZmVUaW1lIDogJycpICtcbiAgICAoa2V5UGFyYW1zLm1raVZhbHVlICYmIGtleVBhcmFtcy5ta2lMZW5ndGhcbiAgICAgID8gJ3wnICsga2V5UGFyYW1zLm1raVZhbHVlICsgJzonICsga2V5UGFyYW1zLm1raUxlbmd0aFxuICAgICAgOiAnJyk7XG59O1xuXG4vLyBFeHRyYWN0cyBhbGwgU0RFUyBwYXJhbWV0ZXJzLlxuU0RQVXRpbHMuZ2V0Q3J5cHRvUGFyYW1ldGVycyA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbiwgc2Vzc2lvbnBhcnQpIHtcbiAgY29uc3QgbGluZXMgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24gKyBzZXNzaW9ucGFydCxcbiAgICAnYT1jcnlwdG86Jyk7XG4gIHJldHVybiBsaW5lcy5tYXAoU0RQVXRpbHMucGFyc2VDcnlwdG9MaW5lKTtcbn07XG5cbi8vIFBhcnNlcyBJQ0UgaW5mb3JtYXRpb24gZnJvbSBTRFAgbWVkaWEgc2VjdGlvbiBvciBzZXNzaW9ucGFydC5cbi8vIEZJWE1FOiBmb3IgY29uc2lzdGVuY3kgd2l0aCBvdGhlciBmdW5jdGlvbnMgdGhpcyBzaG91bGQgb25seVxuLy8gICBnZXQgdGhlIGljZS11ZnJhZyBhbmQgaWNlLXB3ZCBsaW5lcyBhcyBpbnB1dC5cblNEUFV0aWxzLmdldEljZVBhcmFtZXRlcnMgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24sIHNlc3Npb25wYXJ0KSB7XG4gIGNvbnN0IHVmcmFnID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uICsgc2Vzc2lvbnBhcnQsXG4gICAgJ2E9aWNlLXVmcmFnOicpWzBdO1xuICBjb25zdCBwd2QgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24gKyBzZXNzaW9ucGFydCxcbiAgICAnYT1pY2UtcHdkOicpWzBdO1xuICBpZiAoISh1ZnJhZyAmJiBwd2QpKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgcmV0dXJuIHtcbiAgICB1c2VybmFtZUZyYWdtZW50OiB1ZnJhZy5zdWJzdHJpbmcoMTIpLFxuICAgIHBhc3N3b3JkOiBwd2Quc3Vic3RyaW5nKDEwKSxcbiAgfTtcbn07XG5cbi8vIFNlcmlhbGl6ZXMgSUNFIHBhcmFtZXRlcnMgdG8gU0RQLlxuU0RQVXRpbHMud3JpdGVJY2VQYXJhbWV0ZXJzID0gZnVuY3Rpb24ocGFyYW1zKSB7XG4gIGxldCBzZHAgPSAnYT1pY2UtdWZyYWc6JyArIHBhcmFtcy51c2VybmFtZUZyYWdtZW50ICsgJ1xcclxcbicgK1xuICAgICAgJ2E9aWNlLXB3ZDonICsgcGFyYW1zLnBhc3N3b3JkICsgJ1xcclxcbic7XG4gIGlmIChwYXJhbXMuaWNlTGl0ZSkge1xuICAgIHNkcCArPSAnYT1pY2UtbGl0ZVxcclxcbic7XG4gIH1cbiAgcmV0dXJuIHNkcDtcbn07XG5cbi8vIFBhcnNlcyB0aGUgU0RQIG1lZGlhIHNlY3Rpb24gYW5kIHJldHVybnMgUlRDUnRwUGFyYW1ldGVycy5cblNEUFV0aWxzLnBhcnNlUnRwUGFyYW1ldGVycyA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbikge1xuICBjb25zdCBkZXNjcmlwdGlvbiA9IHtcbiAgICBjb2RlY3M6IFtdLFxuICAgIGhlYWRlckV4dGVuc2lvbnM6IFtdLFxuICAgIGZlY01lY2hhbmlzbXM6IFtdLFxuICAgIHJ0Y3A6IFtdLFxuICB9O1xuICBjb25zdCBsaW5lcyA9IFNEUFV0aWxzLnNwbGl0TGluZXMobWVkaWFTZWN0aW9uKTtcbiAgY29uc3QgbWxpbmUgPSBsaW5lc1swXS5zcGxpdCgnICcpO1xuICBkZXNjcmlwdGlvbi5wcm9maWxlID0gbWxpbmVbMl07XG4gIGZvciAobGV0IGkgPSAzOyBpIDwgbWxpbmUubGVuZ3RoOyBpKyspIHsgLy8gZmluZCBhbGwgY29kZWNzIGZyb20gbWxpbmVbMy4uXVxuICAgIGNvbnN0IHB0ID0gbWxpbmVbaV07XG4gICAgY29uc3QgcnRwbWFwbGluZSA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KFxuICAgICAgbWVkaWFTZWN0aW9uLCAnYT1ydHBtYXA6JyArIHB0ICsgJyAnKVswXTtcbiAgICBpZiAocnRwbWFwbGluZSkge1xuICAgICAgY29uc3QgY29kZWMgPSBTRFBVdGlscy5wYXJzZVJ0cE1hcChydHBtYXBsaW5lKTtcbiAgICAgIGNvbnN0IGZtdHBzID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgoXG4gICAgICAgIG1lZGlhU2VjdGlvbiwgJ2E9Zm10cDonICsgcHQgKyAnICcpO1xuICAgICAgLy8gT25seSB0aGUgZmlyc3QgYT1mbXRwOjxwdD4gaXMgY29uc2lkZXJlZC5cbiAgICAgIGNvZGVjLnBhcmFtZXRlcnMgPSBmbXRwcy5sZW5ndGggPyBTRFBVdGlscy5wYXJzZUZtdHAoZm10cHNbMF0pIDoge307XG4gICAgICBjb2RlYy5ydGNwRmVlZGJhY2sgPSBTRFBVdGlscy5tYXRjaFByZWZpeChcbiAgICAgICAgbWVkaWFTZWN0aW9uLCAnYT1ydGNwLWZiOicgKyBwdCArICcgJylcbiAgICAgICAgLm1hcChTRFBVdGlscy5wYXJzZVJ0Y3BGYik7XG4gICAgICBkZXNjcmlwdGlvbi5jb2RlY3MucHVzaChjb2RlYyk7XG4gICAgICAvLyBwYXJzZSBGRUMgbWVjaGFuaXNtcyBmcm9tIHJ0cG1hcCBsaW5lcy5cbiAgICAgIHN3aXRjaCAoY29kZWMubmFtZS50b1VwcGVyQ2FzZSgpKSB7XG4gICAgICAgIGNhc2UgJ1JFRCc6XG4gICAgICAgIGNhc2UgJ1VMUEZFQyc6XG4gICAgICAgICAgZGVzY3JpcHRpb24uZmVjTWVjaGFuaXNtcy5wdXNoKGNvZGVjLm5hbWUudG9VcHBlckNhc2UoKSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGRlZmF1bHQ6IC8vIG9ubHkgUkVEIGFuZCBVTFBGRUMgYXJlIHJlY29nbml6ZWQgYXMgRkVDIG1lY2hhbmlzbXMuXG4gICAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9ZXh0bWFwOicpLmZvckVhY2gobGluZSA9PiB7XG4gICAgZGVzY3JpcHRpb24uaGVhZGVyRXh0ZW5zaW9ucy5wdXNoKFNEUFV0aWxzLnBhcnNlRXh0bWFwKGxpbmUpKTtcbiAgfSk7XG4gIGNvbnN0IHdpbGRjYXJkUnRjcEZiID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1ydGNwLWZiOiogJylcbiAgICAubWFwKFNEUFV0aWxzLnBhcnNlUnRjcEZiKTtcbiAgZGVzY3JpcHRpb24uY29kZWNzLmZvckVhY2goY29kZWMgPT4ge1xuICAgIHdpbGRjYXJkUnRjcEZiLmZvckVhY2goZmI9PiB7XG4gICAgICBjb25zdCBkdXBsaWNhdGUgPSBjb2RlYy5ydGNwRmVlZGJhY2suZmluZChleGlzdGluZ0ZlZWRiYWNrID0+IHtcbiAgICAgICAgcmV0dXJuIGV4aXN0aW5nRmVlZGJhY2sudHlwZSA9PT0gZmIudHlwZSAmJlxuICAgICAgICAgIGV4aXN0aW5nRmVlZGJhY2sucGFyYW1ldGVyID09PSBmYi5wYXJhbWV0ZXI7XG4gICAgICB9KTtcbiAgICAgIGlmICghZHVwbGljYXRlKSB7XG4gICAgICAgIGNvZGVjLnJ0Y3BGZWVkYmFjay5wdXNoKGZiKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSk7XG4gIC8vIEZJWE1FOiBwYXJzZSBydGNwLlxuICByZXR1cm4gZGVzY3JpcHRpb247XG59O1xuXG4vLyBHZW5lcmF0ZXMgcGFydHMgb2YgdGhlIFNEUCBtZWRpYSBzZWN0aW9uIGRlc2NyaWJpbmcgdGhlIGNhcGFiaWxpdGllcyAvXG4vLyBwYXJhbWV0ZXJzLlxuU0RQVXRpbHMud3JpdGVSdHBEZXNjcmlwdGlvbiA9IGZ1bmN0aW9uKGtpbmQsIGNhcHMpIHtcbiAgbGV0IHNkcCA9ICcnO1xuXG4gIC8vIEJ1aWxkIHRoZSBtbGluZS5cbiAgc2RwICs9ICdtPScgKyBraW5kICsgJyAnO1xuICBzZHAgKz0gY2Fwcy5jb2RlY3MubGVuZ3RoID4gMCA/ICc5JyA6ICcwJzsgLy8gcmVqZWN0IGlmIG5vIGNvZGVjcy5cbiAgc2RwICs9ICcgJyArIChjYXBzLnByb2ZpbGUgfHwgJ1VEUC9UTFMvUlRQL1NBVlBGJykgKyAnICc7XG4gIHNkcCArPSBjYXBzLmNvZGVjcy5tYXAoY29kZWMgPT4ge1xuICAgIGlmIChjb2RlYy5wcmVmZXJyZWRQYXlsb2FkVHlwZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXR1cm4gY29kZWMucHJlZmVycmVkUGF5bG9hZFR5cGU7XG4gICAgfVxuICAgIHJldHVybiBjb2RlYy5wYXlsb2FkVHlwZTtcbiAgfSkuam9pbignICcpICsgJ1xcclxcbic7XG5cbiAgc2RwICs9ICdjPUlOIElQNCAwLjAuMC4wXFxyXFxuJztcbiAgc2RwICs9ICdhPXJ0Y3A6OSBJTiBJUDQgMC4wLjAuMFxcclxcbic7XG5cbiAgLy8gQWRkIGE9cnRwbWFwIGxpbmVzIGZvciBlYWNoIGNvZGVjLiBBbHNvIGZtdHAgYW5kIHJ0Y3AtZmIuXG4gIGNhcHMuY29kZWNzLmZvckVhY2goY29kZWMgPT4ge1xuICAgIHNkcCArPSBTRFBVdGlscy53cml0ZVJ0cE1hcChjb2RlYyk7XG4gICAgc2RwICs9IFNEUFV0aWxzLndyaXRlRm10cChjb2RlYyk7XG4gICAgc2RwICs9IFNEUFV0aWxzLndyaXRlUnRjcEZiKGNvZGVjKTtcbiAgfSk7XG4gIGxldCBtYXhwdGltZSA9IDA7XG4gIGNhcHMuY29kZWNzLmZvckVhY2goY29kZWMgPT4ge1xuICAgIGlmIChjb2RlYy5tYXhwdGltZSA+IG1heHB0aW1lKSB7XG4gICAgICBtYXhwdGltZSA9IGNvZGVjLm1heHB0aW1lO1xuICAgIH1cbiAgfSk7XG4gIGlmIChtYXhwdGltZSA+IDApIHtcbiAgICBzZHAgKz0gJ2E9bWF4cHRpbWU6JyArIG1heHB0aW1lICsgJ1xcclxcbic7XG4gIH1cblxuICBpZiAoY2Fwcy5oZWFkZXJFeHRlbnNpb25zKSB7XG4gICAgY2Fwcy5oZWFkZXJFeHRlbnNpb25zLmZvckVhY2goZXh0ZW5zaW9uID0+IHtcbiAgICAgIHNkcCArPSBTRFBVdGlscy53cml0ZUV4dG1hcChleHRlbnNpb24pO1xuICAgIH0pO1xuICB9XG4gIC8vIEZJWE1FOiB3cml0ZSBmZWNNZWNoYW5pc21zLlxuICByZXR1cm4gc2RwO1xufTtcblxuLy8gUGFyc2VzIHRoZSBTRFAgbWVkaWEgc2VjdGlvbiBhbmQgcmV0dXJucyBhbiBhcnJheSBvZlxuLy8gUlRDUnRwRW5jb2RpbmdQYXJhbWV0ZXJzLlxuU0RQVXRpbHMucGFyc2VSdHBFbmNvZGluZ1BhcmFtZXRlcnMgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgY29uc3QgZW5jb2RpbmdQYXJhbWV0ZXJzID0gW107XG4gIGNvbnN0IGRlc2NyaXB0aW9uID0gU0RQVXRpbHMucGFyc2VSdHBQYXJhbWV0ZXJzKG1lZGlhU2VjdGlvbik7XG4gIGNvbnN0IGhhc1JlZCA9IGRlc2NyaXB0aW9uLmZlY01lY2hhbmlzbXMuaW5kZXhPZignUkVEJykgIT09IC0xO1xuICBjb25zdCBoYXNVbHBmZWMgPSBkZXNjcmlwdGlvbi5mZWNNZWNoYW5pc21zLmluZGV4T2YoJ1VMUEZFQycpICE9PSAtMTtcblxuICAvLyBmaWx0ZXIgYT1zc3JjOi4uLiBjbmFtZTosIGlnbm9yZSBQbGFuQi1tc2lkXG4gIGNvbnN0IHNzcmNzID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1zc3JjOicpXG4gICAgLm1hcChsaW5lID0+IFNEUFV0aWxzLnBhcnNlU3NyY01lZGlhKGxpbmUpKVxuICAgIC5maWx0ZXIocGFydHMgPT4gcGFydHMuYXR0cmlidXRlID09PSAnY25hbWUnKTtcbiAgY29uc3QgcHJpbWFyeVNzcmMgPSBzc3Jjcy5sZW5ndGggPiAwICYmIHNzcmNzWzBdLnNzcmM7XG4gIGxldCBzZWNvbmRhcnlTc3JjO1xuXG4gIGNvbnN0IGZsb3dzID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1zc3JjLWdyb3VwOkZJRCcpXG4gICAgLm1hcChsaW5lID0+IHtcbiAgICAgIGNvbnN0IHBhcnRzID0gbGluZS5zdWJzdHJpbmcoMTcpLnNwbGl0KCcgJyk7XG4gICAgICByZXR1cm4gcGFydHMubWFwKHBhcnQgPT4gcGFyc2VJbnQocGFydCwgMTApKTtcbiAgICB9KTtcbiAgaWYgKGZsb3dzLmxlbmd0aCA+IDAgJiYgZmxvd3NbMF0ubGVuZ3RoID4gMSAmJiBmbG93c1swXVswXSA9PT0gcHJpbWFyeVNzcmMpIHtcbiAgICBzZWNvbmRhcnlTc3JjID0gZmxvd3NbMF1bMV07XG4gIH1cblxuICBkZXNjcmlwdGlvbi5jb2RlY3MuZm9yRWFjaChjb2RlYyA9PiB7XG4gICAgaWYgKGNvZGVjLm5hbWUudG9VcHBlckNhc2UoKSA9PT0gJ1JUWCcgJiYgY29kZWMucGFyYW1ldGVycy5hcHQpIHtcbiAgICAgIGxldCBlbmNQYXJhbSA9IHtcbiAgICAgICAgc3NyYzogcHJpbWFyeVNzcmMsXG4gICAgICAgIGNvZGVjUGF5bG9hZFR5cGU6IHBhcnNlSW50KGNvZGVjLnBhcmFtZXRlcnMuYXB0LCAxMCksXG4gICAgICB9O1xuICAgICAgaWYgKHByaW1hcnlTc3JjICYmIHNlY29uZGFyeVNzcmMpIHtcbiAgICAgICAgZW5jUGFyYW0ucnR4ID0ge3NzcmM6IHNlY29uZGFyeVNzcmN9O1xuICAgICAgfVxuICAgICAgZW5jb2RpbmdQYXJhbWV0ZXJzLnB1c2goZW5jUGFyYW0pO1xuICAgICAgaWYgKGhhc1JlZCkge1xuICAgICAgICBlbmNQYXJhbSA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoZW5jUGFyYW0pKTtcbiAgICAgICAgZW5jUGFyYW0uZmVjID0ge1xuICAgICAgICAgIHNzcmM6IHByaW1hcnlTc3JjLFxuICAgICAgICAgIG1lY2hhbmlzbTogaGFzVWxwZmVjID8gJ3JlZCt1bHBmZWMnIDogJ3JlZCcsXG4gICAgICAgIH07XG4gICAgICAgIGVuY29kaW5nUGFyYW1ldGVycy5wdXNoKGVuY1BhcmFtKTtcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xuICBpZiAoZW5jb2RpbmdQYXJhbWV0ZXJzLmxlbmd0aCA9PT0gMCAmJiBwcmltYXJ5U3NyYykge1xuICAgIGVuY29kaW5nUGFyYW1ldGVycy5wdXNoKHtcbiAgICAgIHNzcmM6IHByaW1hcnlTc3JjLFxuICAgIH0pO1xuICB9XG5cbiAgLy8gd2Ugc3VwcG9ydCBib3RoIGI9QVMgYW5kIGI9VElBUyBidXQgaW50ZXJwcmV0IEFTIGFzIFRJQVMuXG4gIGxldCBiYW5kd2lkdGggPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdiPScpO1xuICBpZiAoYmFuZHdpZHRoLmxlbmd0aCkge1xuICAgIGlmIChiYW5kd2lkdGhbMF0uaW5kZXhPZignYj1USUFTOicpID09PSAwKSB7XG4gICAgICBiYW5kd2lkdGggPSBwYXJzZUludChiYW5kd2lkdGhbMF0uc3Vic3RyaW5nKDcpLCAxMCk7XG4gICAgfSBlbHNlIGlmIChiYW5kd2lkdGhbMF0uaW5kZXhPZignYj1BUzonKSA9PT0gMCkge1xuICAgICAgLy8gdXNlIGZvcm11bGEgZnJvbSBKU0VQIHRvIGNvbnZlcnQgYj1BUyB0byBUSUFTIHZhbHVlLlxuICAgICAgYmFuZHdpZHRoID0gcGFyc2VJbnQoYmFuZHdpZHRoWzBdLnN1YnN0cmluZyg1KSwgMTApICogMTAwMCAqIDAuOTVcbiAgICAgICAgICAtICg1MCAqIDQwICogOCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGJhbmR3aWR0aCA9IHVuZGVmaW5lZDtcbiAgICB9XG4gICAgZW5jb2RpbmdQYXJhbWV0ZXJzLmZvckVhY2gocGFyYW1zID0+IHtcbiAgICAgIHBhcmFtcy5tYXhCaXRyYXRlID0gYmFuZHdpZHRoO1xuICAgIH0pO1xuICB9XG4gIHJldHVybiBlbmNvZGluZ1BhcmFtZXRlcnM7XG59O1xuXG4vLyBwYXJzZXMgaHR0cDovL2RyYWZ0Lm9ydGMub3JnLyNydGNydGNwcGFyYW1ldGVycypcblNEUFV0aWxzLnBhcnNlUnRjcFBhcmFtZXRlcnMgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgY29uc3QgcnRjcFBhcmFtZXRlcnMgPSB7fTtcblxuICAvLyBHZXRzIHRoZSBmaXJzdCBTU1JDLiBOb3RlIHRoYXQgd2l0aCBSVFggdGhlcmUgbWlnaHQgYmUgbXVsdGlwbGVcbiAgLy8gU1NSQ3MuXG4gIGNvbnN0IHJlbW90ZVNzcmMgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPXNzcmM6JylcbiAgICAubWFwKGxpbmUgPT4gU0RQVXRpbHMucGFyc2VTc3JjTWVkaWEobGluZSkpXG4gICAgLmZpbHRlcihvYmogPT4gb2JqLmF0dHJpYnV0ZSA9PT0gJ2NuYW1lJylbMF07XG4gIGlmIChyZW1vdGVTc3JjKSB7XG4gICAgcnRjcFBhcmFtZXRlcnMuY25hbWUgPSByZW1vdGVTc3JjLnZhbHVlO1xuICAgIHJ0Y3BQYXJhbWV0ZXJzLnNzcmMgPSByZW1vdGVTc3JjLnNzcmM7XG4gIH1cblxuICAvLyBFZGdlIHVzZXMgdGhlIGNvbXBvdW5kIGF0dHJpYnV0ZSBpbnN0ZWFkIG9mIHJlZHVjZWRTaXplXG4gIC8vIGNvbXBvdW5kIGlzICFyZWR1Y2VkU2l6ZVxuICBjb25zdCByc2l6ZSA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9cnRjcC1yc2l6ZScpO1xuICBydGNwUGFyYW1ldGVycy5yZWR1Y2VkU2l6ZSA9IHJzaXplLmxlbmd0aCA+IDA7XG4gIHJ0Y3BQYXJhbWV0ZXJzLmNvbXBvdW5kID0gcnNpemUubGVuZ3RoID09PSAwO1xuXG4gIC8vIHBhcnNlcyB0aGUgcnRjcC1tdXggYXR0ctGWYnV0ZS5cbiAgLy8gTm90ZSB0aGF0IEVkZ2UgZG9lcyBub3Qgc3VwcG9ydCB1bm11eGVkIFJUQ1AuXG4gIGNvbnN0IG11eCA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9cnRjcC1tdXgnKTtcbiAgcnRjcFBhcmFtZXRlcnMubXV4ID0gbXV4Lmxlbmd0aCA+IDA7XG5cbiAgcmV0dXJuIHJ0Y3BQYXJhbWV0ZXJzO1xufTtcblxuU0RQVXRpbHMud3JpdGVSdGNwUGFyYW1ldGVycyA9IGZ1bmN0aW9uKHJ0Y3BQYXJhbWV0ZXJzKSB7XG4gIGxldCBzZHAgPSAnJztcbiAgaWYgKHJ0Y3BQYXJhbWV0ZXJzLnJlZHVjZWRTaXplKSB7XG4gICAgc2RwICs9ICdhPXJ0Y3AtcnNpemVcXHJcXG4nO1xuICB9XG4gIGlmIChydGNwUGFyYW1ldGVycy5tdXgpIHtcbiAgICBzZHAgKz0gJ2E9cnRjcC1tdXhcXHJcXG4nO1xuICB9XG4gIGlmIChydGNwUGFyYW1ldGVycy5zc3JjICE9PSB1bmRlZmluZWQgJiYgcnRjcFBhcmFtZXRlcnMuY25hbWUpIHtcbiAgICBzZHAgKz0gJ2E9c3NyYzonICsgcnRjcFBhcmFtZXRlcnMuc3NyYyArXG4gICAgICAnIGNuYW1lOicgKyBydGNwUGFyYW1ldGVycy5jbmFtZSArICdcXHJcXG4nO1xuICB9XG4gIHJldHVybiBzZHA7XG59O1xuXG5cbi8vIHBhcnNlcyBlaXRoZXIgYT1tc2lkOiBvciBhPXNzcmM6Li4uIG1zaWQgbGluZXMgYW5kIHJldHVybnNcbi8vIHRoZSBpZCBvZiB0aGUgTWVkaWFTdHJlYW0gYW5kIE1lZGlhU3RyZWFtVHJhY2suXG5TRFBVdGlscy5wYXJzZU1zaWQgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgbGV0IHBhcnRzO1xuICBjb25zdCBzcGVjID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1tc2lkOicpO1xuICBpZiAoc3BlYy5sZW5ndGggPT09IDEpIHtcbiAgICBwYXJ0cyA9IHNwZWNbMF0uc3Vic3RyaW5nKDcpLnNwbGl0KCcgJyk7XG4gICAgcmV0dXJuIHtzdHJlYW06IHBhcnRzWzBdLCB0cmFjazogcGFydHNbMV19O1xuICB9XG4gIGNvbnN0IHBsYW5CID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1zc3JjOicpXG4gICAgLm1hcChsaW5lID0+IFNEUFV0aWxzLnBhcnNlU3NyY01lZGlhKGxpbmUpKVxuICAgIC5maWx0ZXIobXNpZFBhcnRzID0+IG1zaWRQYXJ0cy5hdHRyaWJ1dGUgPT09ICdtc2lkJyk7XG4gIGlmIChwbGFuQi5sZW5ndGggPiAwKSB7XG4gICAgcGFydHMgPSBwbGFuQlswXS52YWx1ZS5zcGxpdCgnICcpO1xuICAgIHJldHVybiB7c3RyZWFtOiBwYXJ0c1swXSwgdHJhY2s6IHBhcnRzWzFdfTtcbiAgfVxufTtcblxuLy8gU0NUUFxuLy8gcGFyc2VzIGRyYWZ0LWlldGYtbW11c2ljLXNjdHAtc2RwLTI2IGZpcnN0IGFuZCBmYWxscyBiYWNrXG4vLyB0byBkcmFmdC1pZXRmLW1tdXNpYy1zY3RwLXNkcC0wNVxuU0RQVXRpbHMucGFyc2VTY3RwRGVzY3JpcHRpb24gPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgY29uc3QgbWxpbmUgPSBTRFBVdGlscy5wYXJzZU1MaW5lKG1lZGlhU2VjdGlvbik7XG4gIGNvbnN0IG1heFNpemVMaW5lID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1tYXgtbWVzc2FnZS1zaXplOicpO1xuICBsZXQgbWF4TWVzc2FnZVNpemU7XG4gIGlmIChtYXhTaXplTGluZS5sZW5ndGggPiAwKSB7XG4gICAgbWF4TWVzc2FnZVNpemUgPSBwYXJzZUludChtYXhTaXplTGluZVswXS5zdWJzdHJpbmcoMTkpLCAxMCk7XG4gIH1cbiAgaWYgKGlzTmFOKG1heE1lc3NhZ2VTaXplKSkge1xuICAgIG1heE1lc3NhZ2VTaXplID0gNjU1MzY7XG4gIH1cbiAgY29uc3Qgc2N0cFBvcnQgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPXNjdHAtcG9ydDonKTtcbiAgaWYgKHNjdHBQb3J0Lmxlbmd0aCA+IDApIHtcbiAgICByZXR1cm4ge1xuICAgICAgcG9ydDogcGFyc2VJbnQoc2N0cFBvcnRbMF0uc3Vic3RyaW5nKDEyKSwgMTApLFxuICAgICAgcHJvdG9jb2w6IG1saW5lLmZtdCxcbiAgICAgIG1heE1lc3NhZ2VTaXplLFxuICAgIH07XG4gIH1cbiAgY29uc3Qgc2N0cE1hcExpbmVzID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1zY3RwbWFwOicpO1xuICBpZiAoc2N0cE1hcExpbmVzLmxlbmd0aCA+IDApIHtcbiAgICBjb25zdCBwYXJ0cyA9IHNjdHBNYXBMaW5lc1swXVxuICAgICAgLnN1YnN0cmluZygxMClcbiAgICAgIC5zcGxpdCgnICcpO1xuICAgIHJldHVybiB7XG4gICAgICBwb3J0OiBwYXJzZUludChwYXJ0c1swXSwgMTApLFxuICAgICAgcHJvdG9jb2w6IHBhcnRzWzFdLFxuICAgICAgbWF4TWVzc2FnZVNpemUsXG4gICAgfTtcbiAgfVxufTtcblxuLy8gU0NUUFxuLy8gb3V0cHV0cyB0aGUgZHJhZnQtaWV0Zi1tbXVzaWMtc2N0cC1zZHAtMjYgdmVyc2lvbiB0aGF0IGFsbCBicm93c2Vyc1xuLy8gc3VwcG9ydCBieSBub3cgcmVjZWl2aW5nIGluIHRoaXMgZm9ybWF0LCB1bmxlc3Mgd2Ugb3JpZ2luYWxseSBwYXJzZWRcbi8vIGFzIHRoZSBkcmFmdC1pZXRmLW1tdXNpYy1zY3RwLXNkcC0wNSBmb3JtYXQgKGluZGljYXRlZCBieSB0aGUgbS1saW5lXG4vLyBwcm90b2NvbCBvZiBEVExTL1NDVFAgLS0gd2l0aG91dCBVRFAvIG9yIFRDUC8pXG5TRFBVdGlscy53cml0ZVNjdHBEZXNjcmlwdGlvbiA9IGZ1bmN0aW9uKG1lZGlhLCBzY3RwKSB7XG4gIGxldCBvdXRwdXQgPSBbXTtcbiAgaWYgKG1lZGlhLnByb3RvY29sICE9PSAnRFRMUy9TQ1RQJykge1xuICAgIG91dHB1dCA9IFtcbiAgICAgICdtPScgKyBtZWRpYS5raW5kICsgJyA5ICcgKyBtZWRpYS5wcm90b2NvbCArICcgJyArIHNjdHAucHJvdG9jb2wgKyAnXFxyXFxuJyxcbiAgICAgICdjPUlOIElQNCAwLjAuMC4wXFxyXFxuJyxcbiAgICAgICdhPXNjdHAtcG9ydDonICsgc2N0cC5wb3J0ICsgJ1xcclxcbicsXG4gICAgXTtcbiAgfSBlbHNlIHtcbiAgICBvdXRwdXQgPSBbXG4gICAgICAnbT0nICsgbWVkaWEua2luZCArICcgOSAnICsgbWVkaWEucHJvdG9jb2wgKyAnICcgKyBzY3RwLnBvcnQgKyAnXFxyXFxuJyxcbiAgICAgICdjPUlOIElQNCAwLjAuMC4wXFxyXFxuJyxcbiAgICAgICdhPXNjdHBtYXA6JyArIHNjdHAucG9ydCArICcgJyArIHNjdHAucHJvdG9jb2wgKyAnIDY1NTM1XFxyXFxuJyxcbiAgICBdO1xuICB9XG4gIGlmIChzY3RwLm1heE1lc3NhZ2VTaXplICE9PSB1bmRlZmluZWQpIHtcbiAgICBvdXRwdXQucHVzaCgnYT1tYXgtbWVzc2FnZS1zaXplOicgKyBzY3RwLm1heE1lc3NhZ2VTaXplICsgJ1xcclxcbicpO1xuICB9XG4gIHJldHVybiBvdXRwdXQuam9pbignJyk7XG59O1xuXG4vLyBHZW5lcmF0ZSBhIHNlc3Npb24gSUQgZm9yIFNEUC5cbi8vIGh0dHBzOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9kcmFmdC1pZXRmLXJ0Y3dlYi1qc2VwLTIwI3NlY3Rpb24tNS4yLjFcbi8vIHJlY29tbWVuZHMgdXNpbmcgYSBjcnlwdG9ncmFwaGljYWxseSByYW5kb20gK3ZlIDY0LWJpdCB2YWx1ZVxuLy8gYnV0IHJpZ2h0IG5vdyB0aGlzIHNob3VsZCBiZSBhY2NlcHRhYmxlIGFuZCB3aXRoaW4gdGhlIHJpZ2h0IHJhbmdlXG5TRFBVdGlscy5nZW5lcmF0ZVNlc3Npb25JZCA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gTWF0aC5yYW5kb20oKS50b1N0cmluZygpLnN1YnN0cigyLCAyMik7XG59O1xuXG4vLyBXcml0ZSBib2lsZXIgcGxhdGUgZm9yIHN0YXJ0IG9mIFNEUFxuLy8gc2Vzc0lkIGFyZ3VtZW50IGlzIG9wdGlvbmFsIC0gaWYgbm90IHN1cHBsaWVkIGl0IHdpbGxcbi8vIGJlIGdlbmVyYXRlZCByYW5kb21seVxuLy8gc2Vzc1ZlcnNpb24gaXMgb3B0aW9uYWwgYW5kIGRlZmF1bHRzIHRvIDJcbi8vIHNlc3NVc2VyIGlzIG9wdGlvbmFsIGFuZCBkZWZhdWx0cyB0byAndGhpc2lzYWRhcHRlcm9ydGMnXG5TRFBVdGlscy53cml0ZVNlc3Npb25Cb2lsZXJwbGF0ZSA9IGZ1bmN0aW9uKHNlc3NJZCwgc2Vzc1Zlciwgc2Vzc1VzZXIpIHtcbiAgbGV0IHNlc3Npb25JZDtcbiAgY29uc3QgdmVyc2lvbiA9IHNlc3NWZXIgIT09IHVuZGVmaW5lZCA/IHNlc3NWZXIgOiAyO1xuICBpZiAoc2Vzc0lkKSB7XG4gICAgc2Vzc2lvbklkID0gc2Vzc0lkO1xuICB9IGVsc2Uge1xuICAgIHNlc3Npb25JZCA9IFNEUFV0aWxzLmdlbmVyYXRlU2Vzc2lvbklkKCk7XG4gIH1cbiAgY29uc3QgdXNlciA9IHNlc3NVc2VyIHx8ICd0aGlzaXNhZGFwdGVyb3J0Yyc7XG4gIC8vIEZJWE1FOiBzZXNzLWlkIHNob3VsZCBiZSBhbiBOVFAgdGltZXN0YW1wLlxuICByZXR1cm4gJ3Y9MFxcclxcbicgK1xuICAgICAgJ289JyArIHVzZXIgKyAnICcgKyBzZXNzaW9uSWQgKyAnICcgKyB2ZXJzaW9uICtcbiAgICAgICAgJyBJTiBJUDQgMTI3LjAuMC4xXFxyXFxuJyArXG4gICAgICAncz0tXFxyXFxuJyArXG4gICAgICAndD0wIDBcXHJcXG4nO1xufTtcblxuLy8gR2V0cyB0aGUgZGlyZWN0aW9uIGZyb20gdGhlIG1lZGlhU2VjdGlvbiBvciB0aGUgc2Vzc2lvbnBhcnQuXG5TRFBVdGlscy5nZXREaXJlY3Rpb24gPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24sIHNlc3Npb25wYXJ0KSB7XG4gIC8vIExvb2sgZm9yIHNlbmRyZWN2LCBzZW5kb25seSwgcmVjdm9ubHksIGluYWN0aXZlLCBkZWZhdWx0IHRvIHNlbmRyZWN2LlxuICBjb25zdCBsaW5lcyA9IFNEUFV0aWxzLnNwbGl0TGluZXMobWVkaWFTZWN0aW9uKTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBsaW5lcy5sZW5ndGg7IGkrKykge1xuICAgIHN3aXRjaCAobGluZXNbaV0pIHtcbiAgICAgIGNhc2UgJ2E9c2VuZHJlY3YnOlxuICAgICAgY2FzZSAnYT1zZW5kb25seSc6XG4gICAgICBjYXNlICdhPXJlY3Zvbmx5JzpcbiAgICAgIGNhc2UgJ2E9aW5hY3RpdmUnOlxuICAgICAgICByZXR1cm4gbGluZXNbaV0uc3Vic3RyaW5nKDIpO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgLy8gRklYTUU6IFdoYXQgc2hvdWxkIGhhcHBlbiBoZXJlP1xuICAgIH1cbiAgfVxuICBpZiAoc2Vzc2lvbnBhcnQpIHtcbiAgICByZXR1cm4gU0RQVXRpbHMuZ2V0RGlyZWN0aW9uKHNlc3Npb25wYXJ0KTtcbiAgfVxuICByZXR1cm4gJ3NlbmRyZWN2Jztcbn07XG5cblNEUFV0aWxzLmdldEtpbmQgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgY29uc3QgbGluZXMgPSBTRFBVdGlscy5zcGxpdExpbmVzKG1lZGlhU2VjdGlvbik7XG4gIGNvbnN0IG1saW5lID0gbGluZXNbMF0uc3BsaXQoJyAnKTtcbiAgcmV0dXJuIG1saW5lWzBdLnN1YnN0cmluZygyKTtcbn07XG5cblNEUFV0aWxzLmlzUmVqZWN0ZWQgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgcmV0dXJuIG1lZGlhU2VjdGlvbi5zcGxpdCgnICcsIDIpWzFdID09PSAnMCc7XG59O1xuXG5TRFBVdGlscy5wYXJzZU1MaW5lID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIGNvbnN0IGxpbmVzID0gU0RQVXRpbHMuc3BsaXRMaW5lcyhtZWRpYVNlY3Rpb24pO1xuICBjb25zdCBwYXJ0cyA9IGxpbmVzWzBdLnN1YnN0cmluZygyKS5zcGxpdCgnICcpO1xuICByZXR1cm4ge1xuICAgIGtpbmQ6IHBhcnRzWzBdLFxuICAgIHBvcnQ6IHBhcnNlSW50KHBhcnRzWzFdLCAxMCksXG4gICAgcHJvdG9jb2w6IHBhcnRzWzJdLFxuICAgIGZtdDogcGFydHMuc2xpY2UoMykuam9pbignICcpLFxuICB9O1xufTtcblxuU0RQVXRpbHMucGFyc2VPTGluZSA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbikge1xuICBjb25zdCBsaW5lID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnbz0nKVswXTtcbiAgY29uc3QgcGFydHMgPSBsaW5lLnN1YnN0cmluZygyKS5zcGxpdCgnICcpO1xuICByZXR1cm4ge1xuICAgIHVzZXJuYW1lOiBwYXJ0c1swXSxcbiAgICBzZXNzaW9uSWQ6IHBhcnRzWzFdLFxuICAgIHNlc3Npb25WZXJzaW9uOiBwYXJzZUludChwYXJ0c1syXSwgMTApLFxuICAgIG5ldFR5cGU6IHBhcnRzWzNdLFxuICAgIGFkZHJlc3NUeXBlOiBwYXJ0c1s0XSxcbiAgICBhZGRyZXNzOiBwYXJ0c1s1XSxcbiAgfTtcbn07XG5cbi8vIGEgdmVyeSBuYWl2ZSBpbnRlcnByZXRhdGlvbiBvZiBhIHZhbGlkIFNEUC5cblNEUFV0aWxzLmlzVmFsaWRTRFAgPSBmdW5jdGlvbihibG9iKSB7XG4gIGlmICh0eXBlb2YgYmxvYiAhPT0gJ3N0cmluZycgfHwgYmxvYi5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgY29uc3QgbGluZXMgPSBTRFBVdGlscy5zcGxpdExpbmVzKGJsb2IpO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGxpbmVzLmxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKGxpbmVzW2ldLmxlbmd0aCA8IDIgfHwgbGluZXNbaV0uY2hhckF0KDEpICE9PSAnPScpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgLy8gVE9ETzogY2hlY2sgdGhlIG1vZGlmaWVyIGEgYml0IG1vcmUuXG4gIH1cbiAgcmV0dXJuIHRydWU7XG59O1xuXG4vLyBFeHBvc2UgcHVibGljIG1ldGhvZHMuXG5pZiAodHlwZW9mIG1vZHVsZSA9PT0gJ29iamVjdCcpIHtcbiAgbW9kdWxlLmV4cG9ydHMgPSBTRFBVdGlscztcbn1cbiIsIi8vIFRoZSBtb2R1bGUgY2FjaGVcbnZhciBfX3dlYnBhY2tfbW9kdWxlX2NhY2hlX18gPSB7fTtcblxuLy8gVGhlIHJlcXVpcmUgZnVuY3Rpb25cbmZ1bmN0aW9uIF9fd2VicGFja19yZXF1aXJlX18obW9kdWxlSWQpIHtcblx0Ly8gQ2hlY2sgaWYgbW9kdWxlIGlzIGluIGNhY2hlXG5cdHZhciBjYWNoZWRNb2R1bGUgPSBfX3dlYnBhY2tfbW9kdWxlX2NhY2hlX19bbW9kdWxlSWRdO1xuXHRpZiAoY2FjaGVkTW9kdWxlICE9PSB1bmRlZmluZWQpIHtcblx0XHRyZXR1cm4gY2FjaGVkTW9kdWxlLmV4cG9ydHM7XG5cdH1cblx0Ly8gQ3JlYXRlIGEgbmV3IG1vZHVsZSAoYW5kIHB1dCBpdCBpbnRvIHRoZSBjYWNoZSlcblx0dmFyIG1vZHVsZSA9IF9fd2VicGFja19tb2R1bGVfY2FjaGVfX1ttb2R1bGVJZF0gPSB7XG5cdFx0Ly8gbm8gbW9kdWxlLmlkIG5lZWRlZFxuXHRcdC8vIG5vIG1vZHVsZS5sb2FkZWQgbmVlZGVkXG5cdFx0ZXhwb3J0czoge31cblx0fTtcblxuXHQvLyBFeGVjdXRlIHRoZSBtb2R1bGUgZnVuY3Rpb25cblx0aWYgKCEobW9kdWxlSWQgaW4gX193ZWJwYWNrX21vZHVsZXNfXykpIHtcblx0XHRkZWxldGUgX193ZWJwYWNrX21vZHVsZV9jYWNoZV9fW21vZHVsZUlkXTtcblx0XHR2YXIgZSA9IG5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIgKyBtb2R1bGVJZCArIFwiJ1wiKTtcblx0XHRlLmNvZGUgPSAnTU9EVUxFX05PVF9GT1VORCc7XG5cdFx0dGhyb3cgZTtcblx0fVxuXHRfX3dlYnBhY2tfbW9kdWxlc19fW21vZHVsZUlkXShtb2R1bGUsIG1vZHVsZS5leHBvcnRzLCBfX3dlYnBhY2tfcmVxdWlyZV9fKTtcblxuXHQvLyBSZXR1cm4gdGhlIGV4cG9ydHMgb2YgdGhlIG1vZHVsZVxuXHRyZXR1cm4gbW9kdWxlLmV4cG9ydHM7XG59XG5cbiIsIiIsIi8vIHN0YXJ0dXBcbi8vIExvYWQgZW50cnkgbW9kdWxlIGFuZCByZXR1cm4gZXhwb3J0c1xuLy8gVGhpcyBlbnRyeSBtb2R1bGUgaXMgcmVmZXJlbmNlZCBieSBvdGhlciBtb2R1bGVzIHNvIGl0IGNhbid0IGJlIGlubGluZWRcbnZhciBfX3dlYnBhY2tfZXhwb3J0c19fID0gX193ZWJwYWNrX3JlcXVpcmVfXyhcIi4vc3JjL2luZGV4LmpzXCIpO1xuIiwiIl0sIm5hbWVzIjpbIm1qIiwicmVxdWlyZSIsIkphbnVzU2Vzc2lvbiIsInByb3RvdHlwZSIsInNlbmRPcmlnaW5hbCIsInNlbmQiLCJ0eXBlIiwic2lnbmFsIiwiY2F0Y2giLCJlIiwibWVzc2FnZSIsImluZGV4T2YiLCJjb25zb2xlIiwiZXJyb3IiLCJOQUYiLCJjb25uZWN0aW9uIiwiYWRhcHRlciIsInJlY29ubmVjdCIsInNkcFV0aWxzIiwiZGVidWciLCJsb2ciLCJ3YXJuIiwiaXNTYWZhcmkiLCJ0ZXN0IiwibmF2aWdhdG9yIiwidXNlckFnZW50IiwiU1VCU0NSSUJFX1RJTUVPVVRfTVMiLCJkZWJvdW5jZSIsImZuIiwiY3VyciIsIlByb21pc2UiLCJyZXNvbHZlIiwiYXJncyIsIkFycmF5Iiwic2xpY2UiLCJjYWxsIiwiYXJndW1lbnRzIiwidGhlbiIsIl8iLCJhcHBseSIsInJhbmRvbVVpbnQiLCJNYXRoIiwiZmxvb3IiLCJyYW5kb20iLCJOdW1iZXIiLCJNQVhfU0FGRV9JTlRFR0VSIiwidW50aWxEYXRhQ2hhbm5lbE9wZW4iLCJkYXRhQ2hhbm5lbCIsInJlamVjdCIsInJlYWR5U3RhdGUiLCJyZXNvbHZlciIsInJlamVjdG9yIiwiY2xlYXIiLCJyZW1vdmVFdmVudExpc3RlbmVyIiwiYWRkRXZlbnRMaXN0ZW5lciIsImlzSDI2NFZpZGVvU3VwcG9ydGVkIiwidmlkZW8iLCJkb2N1bWVudCIsImNyZWF0ZUVsZW1lbnQiLCJjYW5QbGF5VHlwZSIsIk9QVVNfUEFSQU1FVEVSUyIsInVzZWR0eCIsInN0ZXJlbyIsIkRFRkFVTFRfUEVFUl9DT05ORUNUSU9OX0NPTkZJRyIsImljZVNlcnZlcnMiLCJ1cmxzIiwiV1NfTk9STUFMX0NMT1NVUkUiLCJKYW51c0FkYXB0ZXIiLCJjb25zdHJ1Y3RvciIsInJvb20iLCJjbGllbnRJZCIsImpvaW5Ub2tlbiIsInNlcnZlclVybCIsIndlYlJ0Y09wdGlvbnMiLCJwZWVyQ29ubmVjdGlvbkNvbmZpZyIsIndzIiwic2Vzc2lvbiIsInJlbGlhYmxlVHJhbnNwb3J0IiwidW5yZWxpYWJsZVRyYW5zcG9ydCIsImluaXRpYWxSZWNvbm5lY3Rpb25EZWxheSIsInJlY29ubmVjdGlvbkRlbGF5IiwicmVjb25uZWN0aW9uVGltZW91dCIsIm1heFJlY29ubmVjdGlvbkF0dGVtcHRzIiwicmVjb25uZWN0aW9uQXR0ZW1wdHMiLCJpc1JlY29ubmVjdGluZyIsInB1Ymxpc2hlciIsIm9jY3VwYW50cyIsImxlZnRPY2N1cGFudHMiLCJTZXQiLCJtZWRpYVN0cmVhbXMiLCJsb2NhbE1lZGlhU3RyZWFtIiwicGVuZGluZ01lZGlhUmVxdWVzdHMiLCJNYXAiLCJibG9ja2VkQ2xpZW50cyIsImZyb3plblVwZGF0ZXMiLCJ0aW1lT2Zmc2V0cyIsInNlcnZlclRpbWVSZXF1ZXN0cyIsImF2Z1RpbWVPZmZzZXQiLCJvbldlYnNvY2tldE9wZW4iLCJiaW5kIiwib25XZWJzb2NrZXRDbG9zZSIsIm9uV2Vic29ja2V0TWVzc2FnZSIsIm9uRGF0YUNoYW5uZWxNZXNzYWdlIiwib25EYXRhIiwic2V0U2VydmVyVXJsIiwidXJsIiwic2V0QXBwIiwiYXBwIiwic2V0Um9vbSIsInJvb21OYW1lIiwic2V0Sm9pblRva2VuIiwic2V0Q2xpZW50SWQiLCJzZXRXZWJSdGNPcHRpb25zIiwib3B0aW9ucyIsInNldFBlZXJDb25uZWN0aW9uQ29uZmlnIiwic2V0U2VydmVyQ29ubmVjdExpc3RlbmVycyIsInN1Y2Nlc3NMaXN0ZW5lciIsImZhaWx1cmVMaXN0ZW5lciIsImNvbm5lY3RTdWNjZXNzIiwiY29ubmVjdEZhaWx1cmUiLCJzZXRSb29tT2NjdXBhbnRMaXN0ZW5lciIsIm9jY3VwYW50TGlzdGVuZXIiLCJvbk9jY3VwYW50c0NoYW5nZWQiLCJzZXREYXRhQ2hhbm5lbExpc3RlbmVycyIsIm9wZW5MaXN0ZW5lciIsImNsb3NlZExpc3RlbmVyIiwibWVzc2FnZUxpc3RlbmVyIiwib25PY2N1cGFudENvbm5lY3RlZCIsIm9uT2NjdXBhbnREaXNjb25uZWN0ZWQiLCJvbk9jY3VwYW50TWVzc2FnZSIsInNldFJlY29ubmVjdGlvbkxpc3RlbmVycyIsInJlY29ubmVjdGluZ0xpc3RlbmVyIiwicmVjb25uZWN0ZWRMaXN0ZW5lciIsInJlY29ubmVjdGlvbkVycm9yTGlzdGVuZXIiLCJvblJlY29ubmVjdGluZyIsIm9uUmVjb25uZWN0ZWQiLCJvblJlY29ubmVjdGlvbkVycm9yIiwic2V0RXZlbnRMb29wcyIsImxvb3BzIiwiY29ubmVjdCIsImxvY2F0aW9uIiwicHJvdG9jb2wiLCJob3N0Iiwid2Vic29ja2V0Q29ubmVjdGlvbiIsIldlYlNvY2tldCIsInRpbWVvdXRNcyIsIndlYnNvY2tldENvbm5lY3Rpb25Qcm9taXNlIiwid3NPbk9wZW4iLCJhbGwiLCJ1cGRhdGVUaW1lT2Zmc2V0IiwiZGlzY29ubmVjdCIsImNsZWFyVGltZW91dCIsInJlbW92ZUFsbE9jY3VwYW50cyIsImNvbm4iLCJjbG9zZSIsImRpc3Bvc2UiLCJkZWxheWVkUmVjb25uZWN0VGltZW91dCIsImlzRGlzY29ubmVjdGVkIiwiY3JlYXRlIiwiY3JlYXRlUHVibGlzaGVyIiwiYWRkT2NjdXBhbnRQcm9taXNlcyIsImkiLCJpbml0aWFsT2NjdXBhbnRzIiwibGVuZ3RoIiwib2NjdXBhbnRJZCIsInB1c2giLCJhZGRPY2N1cGFudCIsImV2ZW50IiwiY29kZSIsInNldFRpbWVvdXQiLCJFcnJvciIsInBlcmZvcm1EZWxheWVkUmVjb25uZWN0IiwicmVjZWl2ZSIsIkpTT04iLCJwYXJzZSIsImRhdGEiLCJyZW1vdmVPY2N1cGFudCIsImRlbGV0ZSIsInN1YnNjcmliZXIiLCJjcmVhdGVTdWJzY3JpYmVyIiwic2V0TWVkaWFTdHJlYW0iLCJtZWRpYVN0cmVhbSIsIk9iamVjdCIsImdldE93blByb3BlcnR5TmFtZXMiLCJhZGQiLCJoYXMiLCJtc2ciLCJnZXQiLCJhdWRpbyIsImFzc29jaWF0ZSIsImhhbmRsZSIsImV2Iiwic2VuZFRyaWNrbGUiLCJjYW5kaWRhdGUiLCJpY2VDb25uZWN0aW9uU3RhdGUiLCJvZmZlciIsImNyZWF0ZU9mZmVyIiwiY29uZmlndXJlUHVibGlzaGVyU2RwIiwiZml4U2FmYXJpSWNlVUZyYWciLCJsb2NhbCIsIm8iLCJzZXRMb2NhbERlc2NyaXB0aW9uIiwicmVtb3RlIiwiaiIsInNlbmRKc2VwIiwiciIsInNldFJlbW90ZURlc2NyaXB0aW9uIiwianNlcCIsIm9uIiwiYW5zd2VyIiwiY29uZmlndXJlU3Vic2NyaWJlclNkcCIsImNyZWF0ZUFuc3dlciIsImEiLCJKYW51c1BsdWdpbkhhbmRsZSIsIlJUQ1BlZXJDb25uZWN0aW9uIiwiYXR0YWNoIiwicGFyc2VJbnQiLCJ1bmRlZmluZWQiLCJ3ZWJydGN1cCIsInJlbGlhYmxlQ2hhbm5lbCIsImNyZWF0ZURhdGFDaGFubmVsIiwib3JkZXJlZCIsInVucmVsaWFibGVDaGFubmVsIiwibWF4UmV0cmFuc21pdHMiLCJnZXRUcmFja3MiLCJmb3JFYWNoIiwidHJhY2siLCJhZGRUcmFjayIsInBsdWdpbmRhdGEiLCJyb29tX2lkIiwidXNlcl9pZCIsImJvZHkiLCJkaXNwYXRjaEV2ZW50IiwiQ3VzdG9tRXZlbnQiLCJkZXRhaWwiLCJieSIsInNlbmRKb2luIiwibm90aWZpY2F0aW9ucyIsInN1Y2Nlc3MiLCJlcnIiLCJyZXNwb25zZSIsInVzZXJzIiwiaW5jbHVkZXMiLCJzZHAiLCJyZXBsYWNlIiwibGluZSIsInB0IiwicGFyYW1ldGVycyIsImFzc2lnbiIsInBhcnNlRm10cCIsIndyaXRlRm10cCIsInBheWxvYWRUeXBlIiwibWF4UmV0cmllcyIsIndlYnJ0Y0ZhaWxlZCIsImxlZnRJbnRlcnZhbCIsInNldEludGVydmFsIiwiY2xlYXJJbnRlcnZhbCIsInRpbWVvdXQiLCJtZWRpYSIsIl9pT1NIYWNrRGVsYXllZEluaXRpYWxQZWVyIiwiTWVkaWFTdHJlYW0iLCJyZWNlaXZlcnMiLCJnZXRSZWNlaXZlcnMiLCJyZWNlaXZlciIsInN1YnNjcmliZSIsInNlbmRNZXNzYWdlIiwia2luZCIsInRva2VuIiwidG9nZ2xlRnJlZXplIiwiZnJvemVuIiwidW5mcmVlemUiLCJmcmVlemUiLCJmbHVzaFBlbmRpbmdVcGRhdGVzIiwiZGF0YUZvclVwZGF0ZU11bHRpTWVzc2FnZSIsIm5ldHdvcmtJZCIsImwiLCJkIiwiZ2V0UGVuZGluZ0RhdGEiLCJkYXRhVHlwZSIsIm93bmVyIiwiZ2V0UGVuZGluZ0RhdGFGb3JOZXR3b3JrSWQiLCJzb3VyY2UiLCJzdG9yZU1lc3NhZ2UiLCJzdG9yZVNpbmdsZU1lc3NhZ2UiLCJpbmRleCIsInNldCIsInN0b3JlZE1lc3NhZ2UiLCJzdG9yZWREYXRhIiwiaXNPdXRkYXRlZE1lc3NhZ2UiLCJsYXN0T3duZXJUaW1lIiwiaXNDb250ZW1wb3JhbmVvdXNNZXNzYWdlIiwiY3JlYXRlZFdoaWxlRnJvemVuIiwiaXNGaXJzdFN5bmMiLCJjb21wb25lbnRzIiwiZW5hYmxlZCIsInNob3VsZFN0YXJ0Q29ubmVjdGlvblRvIiwiY2xpZW50Iiwic3RhcnRTdHJlYW1Db25uZWN0aW9uIiwiY2xvc2VTdHJlYW1Db25uZWN0aW9uIiwiZ2V0Q29ubmVjdFN0YXR1cyIsImFkYXB0ZXJzIiwiSVNfQ09OTkVDVEVEIiwiTk9UX0NPTk5FQ1RFRCIsImNsaWVudFNlbnRUaW1lIiwiRGF0ZSIsIm5vdyIsInJlcyIsImZldGNoIiwiaHJlZiIsIm1ldGhvZCIsImNhY2hlIiwicHJlY2lzaW9uIiwic2VydmVyUmVjZWl2ZWRUaW1lIiwiaGVhZGVycyIsImdldFRpbWUiLCJjbGllbnRSZWNlaXZlZFRpbWUiLCJzZXJ2ZXJUaW1lIiwidGltZU9mZnNldCIsInJlZHVjZSIsImFjYyIsIm9mZnNldCIsImdldFNlcnZlclRpbWUiLCJnZXRNZWRpYVN0cmVhbSIsImF1ZGlvUHJvbWlzZSIsInZpZGVvUHJvbWlzZSIsInByb21pc2UiLCJzdHJlYW0iLCJhdWRpb1N0cmVhbSIsImdldEF1ZGlvVHJhY2tzIiwidmlkZW9TdHJlYW0iLCJnZXRWaWRlb1RyYWNrcyIsImdldExvY2FsTWVkaWFTdHJlYW0iLCJzZXRMb2NhbE1lZGlhU3RyZWFtIiwiZXhpc3RpbmdTZW5kZXJzIiwiZ2V0U2VuZGVycyIsIm5ld1NlbmRlcnMiLCJ0cmFja3MiLCJ0Iiwic2VuZGVyIiwiZmluZCIsInMiLCJyZXBsYWNlVHJhY2siLCJyZW1vdmVUcmFjayIsImVuYWJsZU1pY3JvcGhvbmUiLCJzZW5kRGF0YSIsInN0cmluZ2lmeSIsIndob20iLCJzZW5kRGF0YUd1YXJhbnRlZWQiLCJicm9hZGNhc3REYXRhIiwiYnJvYWRjYXN0RGF0YUd1YXJhbnRlZWQiLCJraWNrIiwicGVybXNUb2tlbiIsImJsb2NrIiwidW5ibG9jayIsInJlZ2lzdGVyIiwibW9kdWxlIiwiZXhwb3J0cyJdLCJzb3VyY2VSb290IjoiIn0=