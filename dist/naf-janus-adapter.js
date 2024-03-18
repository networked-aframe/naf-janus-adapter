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

function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
function _slicedToArray(arr, i) { return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _unsupportedIterableToArray(arr, i) || _nonIterableRest(); }
function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _iterableToArrayLimit(r, l) { var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t["return"] && (u = t["return"](), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }
function _arrayWithHoles(arr) { if (Array.isArray(arr)) return arr; }
function _createForOfIteratorHelper(o, allowArrayLike) { var it = typeof Symbol !== "undefined" && o[Symbol.iterator] || o["@@iterator"]; if (!it) { if (Array.isArray(o) || (it = _unsupportedIterableToArray(o)) || allowArrayLike && o && typeof o.length === "number") { if (it) o = it; var i = 0; var F = function F() {}; return { s: F, n: function n() { if (i >= o.length) return { done: true }; return { done: false, value: o[i++] }; }, e: function e(_e) { throw _e; }, f: F }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); } var normalCompletion = true, didErr = false, err; return { s: function s() { it = it.call(o); }, n: function n() { var step = it.next(); normalCompletion = step.done; return step; }, e: function e(_e2) { didErr = true; err = _e2; }, f: function f() { try { if (!normalCompletion && it["return"] != null) it["return"](); } finally { if (didErr) throw err; } } }; }
function _unsupportedIterableToArray(o, minLen) { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(o, minLen); var n = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && o.constructor) n = o.constructor.name; if (n === "Map" || n === "Set") return Array.from(o); if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen); }
function _arrayLikeToArray(arr, len) { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i]; return arr2; }
function _regeneratorRuntime() { "use strict"; /*! regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/facebook/regenerator/blob/main/LICENSE */ _regeneratorRuntime = function _regeneratorRuntime() { return e; }; var t, e = {}, r = Object.prototype, n = r.hasOwnProperty, o = Object.defineProperty || function (t, e, r) { t[e] = r.value; }, i = "function" == typeof Symbol ? Symbol : {}, a = i.iterator || "@@iterator", c = i.asyncIterator || "@@asyncIterator", u = i.toStringTag || "@@toStringTag"; function define(t, e, r) { return Object.defineProperty(t, e, { value: r, enumerable: !0, configurable: !0, writable: !0 }), t[e]; } try { define({}, ""); } catch (t) { define = function define(t, e, r) { return t[e] = r; }; } function wrap(t, e, r, n) { var i = e && e.prototype instanceof Generator ? e : Generator, a = Object.create(i.prototype), c = new Context(n || []); return o(a, "_invoke", { value: makeInvokeMethod(t, r, c) }), a; } function tryCatch(t, e, r) { try { return { type: "normal", arg: t.call(e, r) }; } catch (t) { return { type: "throw", arg: t }; } } e.wrap = wrap; var h = "suspendedStart", l = "suspendedYield", f = "executing", s = "completed", y = {}; function Generator() {} function GeneratorFunction() {} function GeneratorFunctionPrototype() {} var p = {}; define(p, a, function () { return this; }); var d = Object.getPrototypeOf, v = d && d(d(values([]))); v && v !== r && n.call(v, a) && (p = v); var g = GeneratorFunctionPrototype.prototype = Generator.prototype = Object.create(p); function defineIteratorMethods(t) { ["next", "throw", "return"].forEach(function (e) { define(t, e, function (t) { return this._invoke(e, t); }); }); } function AsyncIterator(t, e) { function invoke(r, o, i, a) { var c = tryCatch(t[r], t, o); if ("throw" !== c.type) { var u = c.arg, h = u.value; return h && "object" == _typeof(h) && n.call(h, "__await") ? e.resolve(h.__await).then(function (t) { invoke("next", t, i, a); }, function (t) { invoke("throw", t, i, a); }) : e.resolve(h).then(function (t) { u.value = t, i(u); }, function (t) { return invoke("throw", t, i, a); }); } a(c.arg); } var r; o(this, "_invoke", { value: function value(t, n) { function callInvokeWithMethodAndArg() { return new e(function (e, r) { invoke(t, n, e, r); }); } return r = r ? r.then(callInvokeWithMethodAndArg, callInvokeWithMethodAndArg) : callInvokeWithMethodAndArg(); } }); } function makeInvokeMethod(e, r, n) { var o = h; return function (i, a) { if (o === f) throw new Error("Generator is already running"); if (o === s) { if ("throw" === i) throw a; return { value: t, done: !0 }; } for (n.method = i, n.arg = a;;) { var c = n.delegate; if (c) { var u = maybeInvokeDelegate(c, n); if (u) { if (u === y) continue; return u; } } if ("next" === n.method) n.sent = n._sent = n.arg;else if ("throw" === n.method) { if (o === h) throw o = s, n.arg; n.dispatchException(n.arg); } else "return" === n.method && n.abrupt("return", n.arg); o = f; var p = tryCatch(e, r, n); if ("normal" === p.type) { if (o = n.done ? s : l, p.arg === y) continue; return { value: p.arg, done: n.done }; } "throw" === p.type && (o = s, n.method = "throw", n.arg = p.arg); } }; } function maybeInvokeDelegate(e, r) { var n = r.method, o = e.iterator[n]; if (o === t) return r.delegate = null, "throw" === n && e.iterator["return"] && (r.method = "return", r.arg = t, maybeInvokeDelegate(e, r), "throw" === r.method) || "return" !== n && (r.method = "throw", r.arg = new TypeError("The iterator does not provide a '" + n + "' method")), y; var i = tryCatch(o, e.iterator, r.arg); if ("throw" === i.type) return r.method = "throw", r.arg = i.arg, r.delegate = null, y; var a = i.arg; return a ? a.done ? (r[e.resultName] = a.value, r.next = e.nextLoc, "return" !== r.method && (r.method = "next", r.arg = t), r.delegate = null, y) : a : (r.method = "throw", r.arg = new TypeError("iterator result is not an object"), r.delegate = null, y); } function pushTryEntry(t) { var e = { tryLoc: t[0] }; 1 in t && (e.catchLoc = t[1]), 2 in t && (e.finallyLoc = t[2], e.afterLoc = t[3]), this.tryEntries.push(e); } function resetTryEntry(t) { var e = t.completion || {}; e.type = "normal", delete e.arg, t.completion = e; } function Context(t) { this.tryEntries = [{ tryLoc: "root" }], t.forEach(pushTryEntry, this), this.reset(!0); } function values(e) { if (e || "" === e) { var r = e[a]; if (r) return r.call(e); if ("function" == typeof e.next) return e; if (!isNaN(e.length)) { var o = -1, i = function next() { for (; ++o < e.length;) if (n.call(e, o)) return next.value = e[o], next.done = !1, next; return next.value = t, next.done = !0, next; }; return i.next = i; } } throw new TypeError(_typeof(e) + " is not iterable"); } return GeneratorFunction.prototype = GeneratorFunctionPrototype, o(g, "constructor", { value: GeneratorFunctionPrototype, configurable: !0 }), o(GeneratorFunctionPrototype, "constructor", { value: GeneratorFunction, configurable: !0 }), GeneratorFunction.displayName = define(GeneratorFunctionPrototype, u, "GeneratorFunction"), e.isGeneratorFunction = function (t) { var e = "function" == typeof t && t.constructor; return !!e && (e === GeneratorFunction || "GeneratorFunction" === (e.displayName || e.name)); }, e.mark = function (t) { return Object.setPrototypeOf ? Object.setPrototypeOf(t, GeneratorFunctionPrototype) : (t.__proto__ = GeneratorFunctionPrototype, define(t, u, "GeneratorFunction")), t.prototype = Object.create(g), t; }, e.awrap = function (t) { return { __await: t }; }, defineIteratorMethods(AsyncIterator.prototype), define(AsyncIterator.prototype, c, function () { return this; }), e.AsyncIterator = AsyncIterator, e.async = function (t, r, n, o, i) { void 0 === i && (i = Promise); var a = new AsyncIterator(wrap(t, r, n, o), i); return e.isGeneratorFunction(r) ? a : a.next().then(function (t) { return t.done ? t.value : a.next(); }); }, defineIteratorMethods(g), define(g, u, "Generator"), define(g, a, function () { return this; }), define(g, "toString", function () { return "[object Generator]"; }), e.keys = function (t) { var e = Object(t), r = []; for (var n in e) r.push(n); return r.reverse(), function next() { for (; r.length;) { var t = r.pop(); if (t in e) return next.value = t, next.done = !1, next; } return next.done = !0, next; }; }, e.values = values, Context.prototype = { constructor: Context, reset: function reset(e) { if (this.prev = 0, this.next = 0, this.sent = this._sent = t, this.done = !1, this.delegate = null, this.method = "next", this.arg = t, this.tryEntries.forEach(resetTryEntry), !e) for (var r in this) "t" === r.charAt(0) && n.call(this, r) && !isNaN(+r.slice(1)) && (this[r] = t); }, stop: function stop() { this.done = !0; var t = this.tryEntries[0].completion; if ("throw" === t.type) throw t.arg; return this.rval; }, dispatchException: function dispatchException(e) { if (this.done) throw e; var r = this; function handle(n, o) { return a.type = "throw", a.arg = e, r.next = n, o && (r.method = "next", r.arg = t), !!o; } for (var o = this.tryEntries.length - 1; o >= 0; --o) { var i = this.tryEntries[o], a = i.completion; if ("root" === i.tryLoc) return handle("end"); if (i.tryLoc <= this.prev) { var c = n.call(i, "catchLoc"), u = n.call(i, "finallyLoc"); if (c && u) { if (this.prev < i.catchLoc) return handle(i.catchLoc, !0); if (this.prev < i.finallyLoc) return handle(i.finallyLoc); } else if (c) { if (this.prev < i.catchLoc) return handle(i.catchLoc, !0); } else { if (!u) throw new Error("try statement without catch or finally"); if (this.prev < i.finallyLoc) return handle(i.finallyLoc); } } } }, abrupt: function abrupt(t, e) { for (var r = this.tryEntries.length - 1; r >= 0; --r) { var o = this.tryEntries[r]; if (o.tryLoc <= this.prev && n.call(o, "finallyLoc") && this.prev < o.finallyLoc) { var i = o; break; } } i && ("break" === t || "continue" === t) && i.tryLoc <= e && e <= i.finallyLoc && (i = null); var a = i ? i.completion : {}; return a.type = t, a.arg = e, i ? (this.method = "next", this.next = i.finallyLoc, y) : this.complete(a); }, complete: function complete(t, e) { if ("throw" === t.type) throw t.arg; return "break" === t.type || "continue" === t.type ? this.next = t.arg : "return" === t.type ? (this.rval = this.arg = t.arg, this.method = "return", this.next = "end") : "normal" === t.type && e && (this.next = e), y; }, finish: function finish(t) { for (var e = this.tryEntries.length - 1; e >= 0; --e) { var r = this.tryEntries[e]; if (r.finallyLoc === t) return this.complete(r.completion, r.afterLoc), resetTryEntry(r), y; } }, "catch": function _catch(t) { for (var e = this.tryEntries.length - 1; e >= 0; --e) { var r = this.tryEntries[e]; if (r.tryLoc === t) { var n = r.completion; if ("throw" === n.type) { var o = n.arg; resetTryEntry(r); } return o; } } throw new Error("illegal catch attempt"); }, delegateYield: function delegateYield(e, r, n) { return this.delegate = { iterator: values(e), resultName: r, nextLoc: n }, "next" === this.method && (this.arg = t), y; } }, e; }
function asyncGeneratorStep(gen, resolve, reject, _next, _throw, key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { Promise.resolve(value).then(_next, _throw); } }
function _asyncToGenerator(fn) { return function () { var self = this, args = arguments; return new Promise(function (resolve, reject) { var gen = fn.apply(self, args); function _next(value) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, "next", value); } function _throw(err) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, "throw", err); } _next(undefined); }); }; }
function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }
function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, _toPropertyKey(descriptor.key), descriptor); } }
function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); Object.defineProperty(Constructor, "prototype", { writable: false }); return Constructor; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : String(i); }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
/* global NAF */
var mj = __webpack_require__(/*! @networked-aframe/minijanus */ "./node_modules/@networked-aframe/minijanus/minijanus.js");
mj.JanusSession.prototype.sendOriginal = mj.JanusSession.prototype.send;
mj.JanusSession.prototype.send = function (type, signal) {
  return this.sendOriginal(type, signal)["catch"](function (e) {
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
var SUBSCRIBE_TIMEOUT_MS = 15000;
function debounce(fn) {
  var curr = Promise.resolve();
  return function () {
    var _this = this;
    var args = Array.prototype.slice.call(arguments);
    curr = curr.then(function (_) {
      return fn.apply(_this, args);
    });
  };
}
function randomUint() {
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
}
function untilDataChannelOpen(dataChannel) {
  return new Promise(function (resolve, reject) {
    if (dataChannel.readyState === "open") {
      resolve();
    } else {
      var resolver, rejector;
      var clear = function clear() {
        dataChannel.removeEventListener("open", resolver);
        dataChannel.removeEventListener("error", rejector);
      };
      resolver = function resolver() {
        clear();
        resolve();
      };
      rejector = function rejector() {
        clear();
        reject();
      };
      dataChannel.addEventListener("open", resolver);
      dataChannel.addEventListener("error", rejector);
    }
  });
}
var isH264VideoSupported = function () {
  var video = document.createElement("video");
  return video.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"') !== "";
}();
var OPUS_PARAMETERS = {
  // indicates that we want to enable DTX to elide silence packets
  usedtx: 1,
  // indicates that we prefer to receive mono audio (important for voip profile)
  stereo: 0,
  // indicates that we prefer to send mono audio (important for voip profile)
  "sprop-stereo": 0
};
var DEFAULT_PEER_CONNECTION_CONFIG = {
  iceServers: [{
    urls: "stun:stun1.l.google.com:19302"
  }, {
    urls: "stun:stun2.l.google.com:19302"
  }]
};
var WS_NORMAL_CLOSURE = 1000;
var JanusAdapter = /*#__PURE__*/function () {
  function JanusAdapter() {
    _classCallCheck(this, JanusAdapter);
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
  _createClass(JanusAdapter, [{
    key: "setServerUrl",
    value: function setServerUrl(url) {
      this.serverUrl = url;
    }
  }, {
    key: "setApp",
    value: function setApp(app) {}
  }, {
    key: "setRoom",
    value: function setRoom(roomName) {
      this.room = roomName;
    }
  }, {
    key: "setJoinToken",
    value: function setJoinToken(joinToken) {
      this.joinToken = joinToken;
    }
  }, {
    key: "setClientId",
    value: function setClientId(clientId) {
      this.clientId = clientId;
    }
  }, {
    key: "setWebRtcOptions",
    value: function setWebRtcOptions(options) {
      this.webRtcOptions = options;
    }
  }, {
    key: "setPeerConnectionConfig",
    value: function setPeerConnectionConfig(peerConnectionConfig) {
      this.peerConnectionConfig = peerConnectionConfig;
    }
  }, {
    key: "setServerConnectListeners",
    value: function setServerConnectListeners(successListener, failureListener) {
      this.connectSuccess = successListener;
      this.connectFailure = failureListener;
    }
  }, {
    key: "setRoomOccupantListener",
    value: function setRoomOccupantListener(occupantListener) {
      this.onOccupantsChanged = occupantListener;
    }
  }, {
    key: "setDataChannelListeners",
    value: function setDataChannelListeners(openListener, closedListener, messageListener) {
      this.onOccupantConnected = openListener;
      this.onOccupantDisconnected = closedListener;
      this.onOccupantMessage = messageListener;
    }
  }, {
    key: "setReconnectionListeners",
    value: function setReconnectionListeners(reconnectingListener, reconnectedListener, reconnectionErrorListener) {
      // onReconnecting is called with the number of milliseconds until the next reconnection attempt
      this.onReconnecting = reconnectingListener;
      // onReconnected is called when the connection has been reestablished
      this.onReconnected = reconnectedListener;
      // onReconnectionError is called with an error when maxReconnectionAttempts has been reached
      this.onReconnectionError = reconnectionErrorListener;
    }
  }, {
    key: "setEventLoops",
    value: function setEventLoops(loops) {
      this.loops = loops;
    }
  }, {
    key: "connect",
    value: function connect() {
      var _this2 = this;
      debug("connecting to ".concat(this.serverUrl));
      var websocketConnection = new Promise(function (resolve, reject) {
        _this2.ws = new WebSocket(_this2.serverUrl, "janus-protocol");
        _this2.session = new mj.JanusSession(_this2.ws.send.bind(_this2.ws), {
          timeoutMs: 40000
        });
        _this2.ws.addEventListener("close", _this2.onWebsocketClose);
        _this2.ws.addEventListener("message", _this2.onWebsocketMessage);
        _this2.wsOnOpen = function () {
          _this2.ws.removeEventListener("open", _this2.wsOnOpen);
          _this2.onWebsocketOpen().then(resolve)["catch"](reject);
        };
        _this2.ws.addEventListener("open", _this2.wsOnOpen);
      });
      return Promise.all([websocketConnection, this.updateTimeOffset()]);
    }
  }, {
    key: "disconnect",
    value: function disconnect() {
      debug("disconnecting");
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
  }, {
    key: "isDisconnected",
    value: function isDisconnected() {
      return this.ws === null;
    }
  }, {
    key: "onWebsocketOpen",
    value: function () {
      var _onWebsocketOpen = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee() {
        var addOccupantPromises, i, occupantId;
        return _regeneratorRuntime().wrap(function _callee$(_context) {
          while (1) switch (_context.prev = _context.next) {
            case 0:
              _context.next = 2;
              return this.session.create();
            case 2:
              _context.next = 4;
              return this.createPublisher();
            case 4:
              this.publisher = _context.sent;
              // Call the naf connectSuccess callback before we start receiving WebRTC messages.
              this.connectSuccess(this.clientId);
              addOccupantPromises = [];
              i = 0;
            case 8:
              if (!(i < this.publisher.initialOccupants.length)) {
                _context.next = 16;
                break;
              }
              occupantId = this.publisher.initialOccupants[i];
              if (!(occupantId === this.clientId)) {
                _context.next = 12;
                break;
              }
              return _context.abrupt("continue", 13);
            case 12:
              // Happens during non-graceful reconnects due to zombie sessions
              addOccupantPromises.push(this.addOccupant(occupantId));
            case 13:
              i++;
              _context.next = 8;
              break;
            case 16:
              _context.next = 18;
              return Promise.all(addOccupantPromises);
            case 18:
            case "end":
              return _context.stop();
          }
        }, _callee, this);
      }));
      function onWebsocketOpen() {
        return _onWebsocketOpen.apply(this, arguments);
      }
      return onWebsocketOpen;
    }()
  }, {
    key: "onWebsocketClose",
    value: function onWebsocketClose(event) {
      var _this3 = this;
      // The connection was closed successfully. Don't try to reconnect.
      if (event.code === WS_NORMAL_CLOSURE) {
        return;
      }
      console.warn("Janus websocket closed unexpectedly.");
      if (this.onReconnecting) {
        this.onReconnecting(this.reconnectionDelay);
      }
      this.reconnectionTimeout = setTimeout(function () {
        return _this3.reconnect();
      }, this.reconnectionDelay);
    }
  }, {
    key: "reconnect",
    value: function reconnect() {
      var _this4 = this;
      // Dispose of all networked entities and other resources tied to the session.
      this.disconnect();
      this.connect().then(function () {
        _this4.reconnectionDelay = _this4.initialReconnectionDelay;
        _this4.reconnectionAttempts = 0;
        if (_this4.onReconnected) {
          _this4.onReconnected();
        }
      })["catch"](function (error) {
        _this4.reconnectionDelay += 1000;
        _this4.reconnectionAttempts++;
        if (_this4.reconnectionAttempts > _this4.maxReconnectionAttempts && _this4.onReconnectionError) {
          return _this4.onReconnectionError(new Error("Connection could not be reestablished, exceeded maximum number of reconnection attempts."));
        }
        console.warn("Error during reconnect, retrying.");
        console.warn(error);
        if (_this4.onReconnecting) {
          _this4.onReconnecting(_this4.reconnectionDelay);
        }
        _this4.reconnectionTimeout = setTimeout(function () {
          return _this4.reconnect();
        }, _this4.reconnectionDelay);
      });
    }
  }, {
    key: "performDelayedReconnect",
    value: function performDelayedReconnect() {
      var _this5 = this;
      if (this.delayedReconnectTimeout) {
        clearTimeout(this.delayedReconnectTimeout);
      }
      this.delayedReconnectTimeout = setTimeout(function () {
        _this5.delayedReconnectTimeout = null;
        _this5.reconnect();
      }, 10000);
    }
  }, {
    key: "onWebsocketMessage",
    value: function onWebsocketMessage(event) {
      this.session.receive(JSON.parse(event.data));
    }
  }, {
    key: "addOccupant",
    value: function () {
      var _addOccupant = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee2(occupantId) {
        var subscriber;
        return _regeneratorRuntime().wrap(function _callee2$(_context2) {
          while (1) switch (_context2.prev = _context2.next) {
            case 0:
              if (this.occupants[occupantId]) {
                this.removeOccupant(occupantId);
              }
              this.leftOccupants["delete"](occupantId);
              _context2.next = 4;
              return this.createSubscriber(occupantId);
            case 4:
              subscriber = _context2.sent;
              if (subscriber) {
                _context2.next = 7;
                break;
              }
              return _context2.abrupt("return");
            case 7:
              this.occupants[occupantId] = subscriber;
              this.setMediaStream(occupantId, subscriber.mediaStream);

              // Call the Networked AFrame callbacks for the new occupant.
              this.onOccupantConnected(occupantId);
              this.onOccupantsChanged(this.occupants);
              return _context2.abrupt("return", subscriber);
            case 12:
            case "end":
              return _context2.stop();
          }
        }, _callee2, this);
      }));
      function addOccupant(_x) {
        return _addOccupant.apply(this, arguments);
      }
      return addOccupant;
    }()
  }, {
    key: "removeAllOccupants",
    value: function removeAllOccupants() {
      var _iterator = _createForOfIteratorHelper(Object.getOwnPropertyNames(this.occupants)),
        _step;
      try {
        for (_iterator.s(); !(_step = _iterator.n()).done;) {
          var occupantId = _step.value;
          this.removeOccupant(occupantId);
        }
      } catch (err) {
        _iterator.e(err);
      } finally {
        _iterator.f();
      }
    }
  }, {
    key: "removeOccupant",
    value: function removeOccupant(occupantId) {
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
        var msg = "The user disconnected before the media stream was resolved.";
        this.pendingMediaRequests.get(occupantId).audio.reject(msg);
        this.pendingMediaRequests.get(occupantId).video.reject(msg);
        this.pendingMediaRequests["delete"](occupantId);
      }

      // Call the Networked AFrame callbacks for the removed occupant.
      this.onOccupantDisconnected(occupantId);
      this.onOccupantsChanged(this.occupants);
    }
  }, {
    key: "associate",
    value: function associate(conn, handle) {
      var _this6 = this;
      conn.addEventListener("icecandidate", function (ev) {
        handle.sendTrickle(ev.candidate || null)["catch"](function (e) {
          return error("Error trickling ICE: %o", e);
        });
      });
      conn.addEventListener("iceconnectionstatechange", function (ev) {
        if (conn.iceConnectionState === "connected") {
          console.log("ICE state changed to connected");
        }
        if (conn.iceConnectionState === "disconnected") {
          console.warn("ICE state changed to disconnected");
        }
        if (conn.iceConnectionState === "failed") {
          console.warn("ICE failure detected. Reconnecting in 10s.");
          _this6.performDelayedReconnect();
        }
      });

      // we have to debounce these because janus gets angry if you send it a new SDP before
      // it's finished processing an existing SDP. in actuality, it seems like this is maybe
      // too liberal and we need to wait some amount of time after an offer before sending another,
      // but we don't currently know any good way of detecting exactly how long :(
      conn.addEventListener("negotiationneeded", debounce(function (ev) {
        debug("Sending new offer for handle: %o", handle);
        var offer = conn.createOffer().then(_this6.configurePublisherSdp).then(_this6.fixSafariIceUFrag);
        var local = offer.then(function (o) {
          return conn.setLocalDescription(o);
        });
        var remote = offer;
        remote = remote.then(_this6.fixSafariIceUFrag).then(function (j) {
          return handle.sendJsep(j);
        }).then(function (r) {
          return conn.setRemoteDescription(r.jsep);
        });
        return Promise.all([local, remote])["catch"](function (e) {
          return error("Error negotiating offer: %o", e);
        });
      }));
      handle.on("event", debounce(function (ev) {
        var jsep = ev.jsep;
        if (jsep && jsep.type == "offer") {
          debug("Accepting new offer for handle: %o", handle);
          var answer = conn.setRemoteDescription(_this6.configureSubscriberSdp(jsep)).then(function (_) {
            return conn.createAnswer();
          }).then(_this6.fixSafariIceUFrag);
          var local = answer.then(function (a) {
            return conn.setLocalDescription(a);
          });
          var remote = answer.then(function (j) {
            return handle.sendJsep(j);
          });
          return Promise.all([local, remote])["catch"](function (e) {
            return error("Error negotiating answer: %o", e);
          });
        } else {
          // some other kind of event, nothing to do
          return null;
        }
      }));
    }
  }, {
    key: "createPublisher",
    value: function () {
      var _createPublisher = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee3() {
        var _this7 = this;
        var handle, conn, webrtcup, reliableChannel, unreliableChannel, message, err, initialOccupants;
        return _regeneratorRuntime().wrap(function _callee3$(_context3) {
          while (1) switch (_context3.prev = _context3.next) {
            case 0:
              handle = new mj.JanusPluginHandle(this.session);
              conn = new RTCPeerConnection(this.peerConnectionConfig || DEFAULT_PEER_CONNECTION_CONFIG);
              debug("pub waiting for sfu");
              _context3.next = 5;
              return handle.attach("janus.plugin.sfu", this.loops && this.clientId ? parseInt(this.clientId) % this.loops : undefined);
            case 5:
              this.associate(conn, handle);
              debug("pub waiting for data channels & webrtcup");
              webrtcup = new Promise(function (resolve) {
                return handle.on("webrtcup", resolve);
              }); // Unreliable datachannel: sending and receiving component updates.
              // Reliable datachannel: sending and recieving entity instantiations.
              reliableChannel = conn.createDataChannel("reliable", {
                ordered: true
              });
              unreliableChannel = conn.createDataChannel("unreliable", {
                ordered: false,
                maxRetransmits: 0
              });
              reliableChannel.addEventListener("message", function (e) {
                return _this7.onDataChannelMessage(e, "janus-reliable");
              });
              unreliableChannel.addEventListener("message", function (e) {
                return _this7.onDataChannelMessage(e, "janus-unreliable");
              });
              _context3.next = 14;
              return webrtcup;
            case 14:
              _context3.next = 16;
              return untilDataChannelOpen(reliableChannel);
            case 16:
              _context3.next = 18;
              return untilDataChannelOpen(unreliableChannel);
            case 18:
              // doing this here is sort of a hack around chrome renegotiation weirdness --
              // if we do it prior to webrtcup, chrome on gear VR will sometimes put a
              // renegotiation offer in flight while the first offer was still being
              // processed by janus. we should find some more principled way to figure out
              // when janus is done in the future.
              if (this.localMediaStream) {
                this.localMediaStream.getTracks().forEach(function (track) {
                  conn.addTrack(track, _this7.localMediaStream);
                });
              }

              // Handle all of the join and leave events.
              handle.on("event", function (ev) {
                var data = ev.plugindata.data;
                if (data.event == "join" && data.room_id == _this7.room) {
                  if (_this7.delayedReconnectTimeout) {
                    // Don't create a new RTCPeerConnection, all RTCPeerConnection will be closed in less than 10s.
                    return;
                  }
                  _this7.addOccupant(data.user_id);
                } else if (data.event == "leave" && data.room_id == _this7.room) {
                  _this7.removeOccupant(data.user_id);
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
                  _this7.onData(JSON.parse(data.body), "janus-event");
                }
              });
              debug("pub waiting for join");

              // Send join message to janus. Listen for join/leave messages. Automatically subscribe to all users' WebRTC data.
              _context3.next = 23;
              return this.sendJoin(handle, {
                notifications: true,
                data: true
              });
            case 23:
              message = _context3.sent;
              if (message.plugindata.data.success) {
                _context3.next = 29;
                break;
              }
              err = message.plugindata.data.error;
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
            case 29:
              initialOccupants = message.plugindata.data.response.users[this.room] || [];
              if (initialOccupants.includes(this.clientId)) {
                console.warn("Janus still has previous session for this client. Reconnecting in 10s.");
                this.performDelayedReconnect();
              }
              debug("publisher ready");
              return _context3.abrupt("return", {
                handle: handle,
                initialOccupants: initialOccupants,
                reliableChannel: reliableChannel,
                unreliableChannel: unreliableChannel,
                conn: conn
              });
            case 33:
            case "end":
              return _context3.stop();
          }
        }, _callee3, this);
      }));
      function createPublisher() {
        return _createPublisher.apply(this, arguments);
      }
      return createPublisher;
    }()
  }, {
    key: "configurePublisherSdp",
    value: function configurePublisherSdp(jsep) {
      jsep.sdp = jsep.sdp.replace(/a=fmtp:(109|111).*\r\n/g, function (line, pt) {
        var parameters = Object.assign(sdpUtils.parseFmtp(line), OPUS_PARAMETERS);
        return sdpUtils.writeFmtp({
          payloadType: pt,
          parameters: parameters
        });
      });
      return jsep;
    }
  }, {
    key: "configureSubscriberSdp",
    value: function configureSubscriberSdp(jsep) {
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
  }, {
    key: "fixSafariIceUFrag",
    value: function () {
      var _fixSafariIceUFrag = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee4(jsep) {
        return _regeneratorRuntime().wrap(function _callee4$(_context4) {
          while (1) switch (_context4.prev = _context4.next) {
            case 0:
              // Safari produces a \n instead of an \r\n for the ice-ufrag. See https://github.com/meetecho/janus-gateway/issues/1818
              jsep.sdp = jsep.sdp.replace(/[^\r]\na=ice-ufrag/g, "\r\na=ice-ufrag");
              return _context4.abrupt("return", jsep);
            case 2:
            case "end":
              return _context4.stop();
          }
        }, _callee4);
      }));
      function fixSafariIceUFrag(_x2) {
        return _fixSafariIceUFrag.apply(this, arguments);
      }
      return fixSafariIceUFrag;
    }()
  }, {
    key: "createSubscriber",
    value: function () {
      var _createSubscriber = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee5(occupantId) {
        var _this8 = this;
        var maxRetries,
          handle,
          conn,
          webrtcFailed,
          webrtcup,
          mediaStream,
          receivers,
          _args5 = arguments;
        return _regeneratorRuntime().wrap(function _callee5$(_context5) {
          while (1) switch (_context5.prev = _context5.next) {
            case 0:
              maxRetries = _args5.length > 1 && _args5[1] !== undefined ? _args5[1] : 5;
              if (!this.leftOccupants.has(occupantId)) {
                _context5.next = 4;
                break;
              }
              console.warn(occupantId + ": cancelled occupant connection, occupant left before subscription negotation.");
              return _context5.abrupt("return", null);
            case 4:
              handle = new mj.JanusPluginHandle(this.session);
              conn = new RTCPeerConnection(this.peerConnectionConfig || DEFAULT_PEER_CONNECTION_CONFIG);
              debug(occupantId + ": sub waiting for sfu");
              _context5.next = 9;
              return handle.attach("janus.plugin.sfu", this.loops ? parseInt(occupantId) % this.loops : undefined);
            case 9:
              this.associate(conn, handle);
              debug(occupantId + ": sub waiting for join");
              if (!this.leftOccupants.has(occupantId)) {
                _context5.next = 15;
                break;
              }
              conn.close();
              console.warn(occupantId + ": cancelled occupant connection, occupant left after attach");
              return _context5.abrupt("return", null);
            case 15:
              webrtcFailed = false;
              webrtcup = new Promise(function (resolve) {
                var leftInterval = setInterval(function () {
                  if (_this8.leftOccupants.has(occupantId)) {
                    clearInterval(leftInterval);
                    resolve();
                  }
                }, 1000);
                var timeout = setTimeout(function () {
                  clearInterval(leftInterval);
                  webrtcFailed = true;
                  resolve();
                }, SUBSCRIBE_TIMEOUT_MS);
                handle.on("webrtcup", function () {
                  clearTimeout(timeout);
                  clearInterval(leftInterval);
                  resolve();
                });
              }); // Send join message to janus. Don't listen for join/leave messages. Subscribe to the occupant's media.
              // Janus should send us an offer for this occupant's media in response to this.
              _context5.next = 19;
              return this.sendJoin(handle, {
                media: occupantId
              });
            case 19:
              if (!this.leftOccupants.has(occupantId)) {
                _context5.next = 23;
                break;
              }
              conn.close();
              console.warn(occupantId + ": cancelled occupant connection, occupant left after join");
              return _context5.abrupt("return", null);
            case 23:
              debug(occupantId + ": sub waiting for webrtcup");
              _context5.next = 26;
              return webrtcup;
            case 26:
              if (!this.leftOccupants.has(occupantId)) {
                _context5.next = 30;
                break;
              }
              conn.close();
              console.warn(occupantId + ": cancel occupant connection, occupant left during or after webrtcup");
              return _context5.abrupt("return", null);
            case 30:
              if (!webrtcFailed) {
                _context5.next = 39;
                break;
              }
              conn.close();
              if (!(maxRetries > 0)) {
                _context5.next = 37;
                break;
              }
              console.warn(occupantId + ": webrtc up timed out, retrying");
              return _context5.abrupt("return", this.createSubscriber(occupantId, maxRetries - 1));
            case 37:
              console.warn(occupantId + ": webrtc up timed out");
              return _context5.abrupt("return", null);
            case 39:
              if (!(isSafari && !this._iOSHackDelayedInitialPeer)) {
                _context5.next = 43;
                break;
              }
              _context5.next = 42;
              return new Promise(function (resolve) {
                return setTimeout(resolve, 3000);
              });
            case 42:
              this._iOSHackDelayedInitialPeer = true;
            case 43:
              mediaStream = new MediaStream();
              receivers = conn.getReceivers();
              receivers.forEach(function (receiver) {
                if (receiver.track) {
                  mediaStream.addTrack(receiver.track);
                }
              });
              if (mediaStream.getTracks().length === 0) {
                mediaStream = null;
              }
              debug(occupantId + ": subscriber ready");
              return _context5.abrupt("return", {
                handle: handle,
                mediaStream: mediaStream,
                conn: conn
              });
            case 49:
            case "end":
              return _context5.stop();
          }
        }, _callee5, this);
      }));
      function createSubscriber(_x3) {
        return _createSubscriber.apply(this, arguments);
      }
      return createSubscriber;
    }()
  }, {
    key: "sendJoin",
    value: function sendJoin(handle, subscribe) {
      return handle.sendMessage({
        kind: "join",
        room_id: this.room,
        user_id: this.clientId,
        subscribe: subscribe,
        token: this.joinToken
      });
    }
  }, {
    key: "toggleFreeze",
    value: function toggleFreeze() {
      if (this.frozen) {
        this.unfreeze();
      } else {
        this.freeze();
      }
    }
  }, {
    key: "freeze",
    value: function freeze() {
      this.frozen = true;
    }
  }, {
    key: "unfreeze",
    value: function unfreeze() {
      this.frozen = false;
      this.flushPendingUpdates();
    }
  }, {
    key: "dataForUpdateMultiMessage",
    value: function dataForUpdateMultiMessage(networkId, message) {
      // "d" is an array of entity datas, where each item in the array represents a unique entity and contains
      // metadata for the entity, and an array of components that have been updated on the entity.
      // This method finds the data corresponding to the given networkId.
      for (var i = 0, l = message.data.d.length; i < l; i++) {
        var data = message.data.d[i];
        if (data.networkId === networkId) {
          return data;
        }
      }
      return null;
    }
  }, {
    key: "getPendingData",
    value: function getPendingData(networkId, message) {
      if (!message) return null;
      var data = message.dataType === "um" ? this.dataForUpdateMultiMessage(networkId, message) : message.data;

      // Ignore messages relating to users who have disconnected since freezing, their entities
      // will have aleady been removed by NAF.
      // Note that delete messages have no "owner" so we have to check for that as well.
      if (data.owner && !this.occupants[data.owner]) return null;

      // Ignore messages from users that we may have blocked while frozen.
      if (data.owner && this.blockedClients.has(data.owner)) return null;
      return data;
    }

    // Used externally
  }, {
    key: "getPendingDataForNetworkId",
    value: function getPendingDataForNetworkId(networkId) {
      return this.getPendingData(networkId, this.frozenUpdates.get(networkId));
    }
  }, {
    key: "flushPendingUpdates",
    value: function flushPendingUpdates() {
      var _iterator2 = _createForOfIteratorHelper(this.frozenUpdates),
        _step2;
      try {
        for (_iterator2.s(); !(_step2 = _iterator2.n()).done;) {
          var _step2$value = _slicedToArray(_step2.value, 2),
            networkId = _step2$value[0],
            message = _step2$value[1];
          var data = this.getPendingData(networkId, message);
          if (!data) continue;

          // Override the data type on "um" messages types, since we extract entity updates from "um" messages into
          // individual frozenUpdates in storeSingleMessage.
          var dataType = message.dataType === "um" ? "u" : message.dataType;
          this.onOccupantMessage(null, dataType, data, message.source);
        }
      } catch (err) {
        _iterator2.e(err);
      } finally {
        _iterator2.f();
      }
      this.frozenUpdates.clear();
    }
  }, {
    key: "storeMessage",
    value: function storeMessage(message) {
      if (message.dataType === "um") {
        // UpdateMulti
        for (var i = 0, l = message.data.d.length; i < l; i++) {
          this.storeSingleMessage(message, i);
        }
      } else {
        this.storeSingleMessage(message);
      }
    }
  }, {
    key: "storeSingleMessage",
    value: function storeSingleMessage(message, index) {
      var data = index !== undefined ? message.data.d[index] : message.data;
      var dataType = message.dataType;
      var source = message.source;
      var networkId = data.networkId;
      if (!this.frozenUpdates.has(networkId)) {
        this.frozenUpdates.set(networkId, message);
      } else {
        var storedMessage = this.frozenUpdates.get(networkId);
        var storedData = storedMessage.dataType === "um" ? this.dataForUpdateMultiMessage(networkId, storedMessage) : storedMessage.data;

        // Avoid updating components if the entity data received did not come from the current owner.
        var isOutdatedMessage = data.lastOwnerTime < storedData.lastOwnerTime;
        var isContemporaneousMessage = data.lastOwnerTime === storedData.lastOwnerTime;
        if (isOutdatedMessage || isContemporaneousMessage && storedData.owner > data.owner) {
          return;
        }
        if (dataType === "r") {
          var createdWhileFrozen = storedData && storedData.isFirstSync;
          if (createdWhileFrozen) {
            // If the entity was created and deleted while frozen, don't bother conveying anything to the consumer.
            this.frozenUpdates["delete"](networkId);
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
  }, {
    key: "onDataChannelMessage",
    value: function onDataChannelMessage(e, source) {
      this.onData(JSON.parse(e.data), source);
    }
  }, {
    key: "onData",
    value: function onData(message, source) {
      if (debug.enabled) {
        debug("DC in: ".concat(message));
      }
      if (!message.dataType) return;
      message.source = source;
      if (this.frozen) {
        this.storeMessage(message);
      } else {
        this.onOccupantMessage(null, message.dataType, message.data, message.source);
      }
    }
  }, {
    key: "shouldStartConnectionTo",
    value: function shouldStartConnectionTo(client) {
      return true;
    }
  }, {
    key: "startStreamConnection",
    value: function startStreamConnection(client) {}
  }, {
    key: "closeStreamConnection",
    value: function closeStreamConnection(client) {}
  }, {
    key: "getConnectStatus",
    value: function getConnectStatus(clientId) {
      return this.occupants[clientId] ? NAF.adapters.IS_CONNECTED : NAF.adapters.NOT_CONNECTED;
    }
  }, {
    key: "updateTimeOffset",
    value: function () {
      var _updateTimeOffset = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee6() {
        var _this9 = this;
        var clientSentTime, res, precision, serverReceivedTime, clientReceivedTime, serverTime, timeOffset;
        return _regeneratorRuntime().wrap(function _callee6$(_context6) {
          while (1) switch (_context6.prev = _context6.next) {
            case 0:
              if (!this.isDisconnected()) {
                _context6.next = 2;
                break;
              }
              return _context6.abrupt("return");
            case 2:
              clientSentTime = Date.now();
              _context6.next = 5;
              return fetch(document.location.href, {
                method: "HEAD",
                cache: "no-cache"
              });
            case 5:
              res = _context6.sent;
              precision = 1000;
              serverReceivedTime = new Date(res.headers.get("Date")).getTime() + precision / 2;
              clientReceivedTime = Date.now();
              serverTime = serverReceivedTime + (clientReceivedTime - clientSentTime) / 2;
              timeOffset = serverTime - clientReceivedTime;
              this.serverTimeRequests++;
              if (this.serverTimeRequests <= 10) {
                this.timeOffsets.push(timeOffset);
              } else {
                this.timeOffsets[this.serverTimeRequests % 10] = timeOffset;
              }
              this.avgTimeOffset = this.timeOffsets.reduce(function (acc, offset) {
                return acc += offset;
              }, 0) / this.timeOffsets.length;
              if (this.serverTimeRequests > 10) {
                debug("new server time offset: ".concat(this.avgTimeOffset, "ms"));
                setTimeout(function () {
                  return _this9.updateTimeOffset();
                }, 5 * 60 * 1000); // Sync clock every 5 minutes.
              } else {
                this.updateTimeOffset();
              }
            case 15:
            case "end":
              return _context6.stop();
          }
        }, _callee6, this);
      }));
      function updateTimeOffset() {
        return _updateTimeOffset.apply(this, arguments);
      }
      return updateTimeOffset;
    }()
  }, {
    key: "getServerTime",
    value: function getServerTime() {
      return Date.now() + this.avgTimeOffset;
    }
  }, {
    key: "getMediaStream",
    value: function getMediaStream(clientId) {
      var _this10 = this;
      var type = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : "audio";
      if (this.mediaStreams[clientId]) {
        debug("Already had ".concat(type, " for ").concat(clientId));
        return Promise.resolve(this.mediaStreams[clientId][type]);
      } else {
        debug("Waiting on ".concat(type, " for ").concat(clientId));
        if (!this.pendingMediaRequests.has(clientId)) {
          this.pendingMediaRequests.set(clientId, {});
          var audioPromise = new Promise(function (resolve, reject) {
            _this10.pendingMediaRequests.get(clientId).audio = {
              resolve: resolve,
              reject: reject
            };
          });
          var videoPromise = new Promise(function (resolve, reject) {
            _this10.pendingMediaRequests.get(clientId).video = {
              resolve: resolve,
              reject: reject
            };
          });
          this.pendingMediaRequests.get(clientId).audio.promise = audioPromise;
          this.pendingMediaRequests.get(clientId).video.promise = videoPromise;
          audioPromise["catch"](function (e) {
            return console.warn("".concat(clientId, " getMediaStream Audio Error"), e);
          });
          videoPromise["catch"](function (e) {
            return console.warn("".concat(clientId, " getMediaStream Video Error"), e);
          });
        }
        return this.pendingMediaRequests.get(clientId)[type].promise;
      }
    }
  }, {
    key: "setMediaStream",
    value: function setMediaStream(clientId, stream) {
      // Safari doesn't like it when you use single a mixed media stream where one of the tracks is inactive, so we
      // split the tracks into two streams.
      var audioStream = new MediaStream();
      try {
        stream.getAudioTracks().forEach(function (track) {
          return audioStream.addTrack(track);
        });
      } catch (e) {
        console.warn("".concat(clientId, " setMediaStream Audio Error"), e);
      }
      var videoStream = new MediaStream();
      try {
        stream.getVideoTracks().forEach(function (track) {
          return videoStream.addTrack(track);
        });
      } catch (e) {
        console.warn("".concat(clientId, " setMediaStream Video Error"), e);
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
  }, {
    key: "setLocalMediaStream",
    value: function () {
      var _setLocalMediaStream = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee7(stream) {
        var _this11 = this;
        var existingSenders, newSenders, tracks, _loop, i;
        return _regeneratorRuntime().wrap(function _callee7$(_context8) {
          while (1) switch (_context8.prev = _context8.next) {
            case 0:
              if (!(this.publisher && this.publisher.conn)) {
                _context8.next = 12;
                break;
              }
              existingSenders = this.publisher.conn.getSenders();
              newSenders = [];
              tracks = stream.getTracks();
              _loop = /*#__PURE__*/_regeneratorRuntime().mark(function _loop() {
                var t, sender;
                return _regeneratorRuntime().wrap(function _loop$(_context7) {
                  while (1) switch (_context7.prev = _context7.next) {
                    case 0:
                      t = tracks[i];
                      sender = existingSenders.find(function (s) {
                        return s.track != null && s.track.kind == t.kind;
                      });
                      if (!(sender != null)) {
                        _context7.next = 14;
                        break;
                      }
                      if (!sender.replaceTrack) {
                        _context7.next = 9;
                        break;
                      }
                      _context7.next = 6;
                      return sender.replaceTrack(t);
                    case 6:
                      // Workaround https://bugzilla.mozilla.org/show_bug.cgi?id=1576771
                      if (t.kind === "video" && t.enabled && navigator.userAgent.toLowerCase().indexOf('firefox') > -1) {
                        t.enabled = false;
                        setTimeout(function () {
                          return t.enabled = true;
                        }, 1000);
                      }
                      _context7.next = 11;
                      break;
                    case 9:
                      // Fallback for browsers that don't support replaceTrack. At this time of this writing
                      // most browsers support it, and testing this code path seems to not work properly
                      // in Chrome anymore.
                      stream.removeTrack(sender.track);
                      stream.addTrack(t);
                    case 11:
                      newSenders.push(sender);
                      _context7.next = 15;
                      break;
                    case 14:
                      newSenders.push(_this11.publisher.conn.addTrack(t, stream));
                    case 15:
                    case "end":
                      return _context7.stop();
                  }
                }, _loop);
              });
              i = 0;
            case 6:
              if (!(i < tracks.length)) {
                _context8.next = 11;
                break;
              }
              return _context8.delegateYield(_loop(), "t0", 8);
            case 8:
              i++;
              _context8.next = 6;
              break;
            case 11:
              existingSenders.forEach(function (s) {
                if (!newSenders.includes(s)) {
                  s.track.enabled = false;
                }
              });
            case 12:
              this.localMediaStream = stream;
              this.setMediaStream(this.clientId, stream);
            case 14:
            case "end":
              return _context8.stop();
          }
        }, _callee7, this);
      }));
      function setLocalMediaStream(_x4) {
        return _setLocalMediaStream.apply(this, arguments);
      }
      return setLocalMediaStream;
    }()
  }, {
    key: "enableMicrophone",
    value: function enableMicrophone(enabled) {
      if (this.publisher && this.publisher.conn) {
        this.publisher.conn.getSenders().forEach(function (s) {
          if (s.track.kind == "audio") {
            s.track.enabled = enabled;
          }
        });
      }
    }
  }, {
    key: "sendData",
    value: function sendData(clientId, dataType, data) {
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
                  dataType: dataType,
                  data: data
                }),
                whom: clientId
              });
            }
            break;
          case "datachannel":
            if (this.publisher.unreliableChannel.readyState === "open") {
              this.publisher.unreliableChannel.send(JSON.stringify({
                clientId: clientId,
                dataType: dataType,
                data: data
              }));
            }
            break;
          default:
            this.unreliableTransport(clientId, dataType, data);
            break;
        }
      }
    }
  }, {
    key: "sendDataGuaranteed",
    value: function sendDataGuaranteed(clientId, dataType, data) {
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
                  dataType: dataType,
                  data: data
                }),
                whom: clientId
              });
            }
            break;
          case "datachannel":
            if (this.publisher.reliableChannel.readyState === "open") {
              this.publisher.reliableChannel.send(JSON.stringify({
                clientId: clientId,
                dataType: dataType,
                data: data
              }));
            }
            break;
          default:
            this.reliableTransport(clientId, dataType, data);
            break;
        }
      }
    }
  }, {
    key: "broadcastData",
    value: function broadcastData(dataType, data) {
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
                  dataType: dataType,
                  data: data
                })
              });
            }
            break;
          case "datachannel":
            if (this.publisher.unreliableChannel.readyState === "open") {
              this.publisher.unreliableChannel.send(JSON.stringify({
                dataType: dataType,
                data: data
              }));
            }
            break;
          default:
            this.unreliableTransport(undefined, dataType, data);
            break;
        }
      }
    }
  }, {
    key: "broadcastDataGuaranteed",
    value: function broadcastDataGuaranteed(dataType, data) {
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
                  dataType: dataType,
                  data: data
                })
              });
            }
            break;
          case "datachannel":
            if (this.publisher.reliableChannel.readyState === "open") {
              this.publisher.reliableChannel.send(JSON.stringify({
                dataType: dataType,
                data: data
              }));
            }
            break;
          default:
            this.reliableTransport(undefined, dataType, data);
            break;
        }
      }
    }
  }, {
    key: "kick",
    value: function kick(clientId, permsToken) {
      return this.publisher.handle.sendMessage({
        kind: "kick",
        room_id: this.room,
        user_id: clientId,
        token: permsToken
      }).then(function () {
        document.body.dispatchEvent(new CustomEvent("kicked", {
          detail: {
            clientId: clientId
          }
        }));
      });
    }
  }, {
    key: "block",
    value: function block(clientId) {
      var _this12 = this;
      return this.publisher.handle.sendMessage({
        kind: "block",
        whom: clientId
      }).then(function () {
        _this12.blockedClients.set(clientId, true);
        document.body.dispatchEvent(new CustomEvent("blocked", {
          detail: {
            clientId: clientId
          }
        }));
      });
    }
  }, {
    key: "unblock",
    value: function unblock(clientId) {
      var _this13 = this;
      return this.publisher.handle.sendMessage({
        kind: "unblock",
        whom: clientId
      }).then(function () {
        _this13.blockedClients["delete"](clientId);
        document.body.dispatchEvent(new CustomEvent("unblocked", {
          detail: {
            clientId: clientId
          }
        }));
      });
    }
  }]);
  return JanusAdapter;
}();
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibmFmLWphbnVzLWFkYXB0ZXIuanMiLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0Esa0JBQWtCO0FBQ2xCO0FBQ0E7QUFDQTtBQUNBLEdBQUc7QUFDSDs7QUFFQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsR0FBRztBQUNIOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLGlEQUFpRCxvQkFBb0I7QUFDckU7O0FBRUE7QUFDQTtBQUNBLGdDQUFnQyxZQUFZO0FBQzVDOztBQUVBO0FBQ0E7QUFDQSxnQ0FBZ0MsUUFBUSxjQUFjO0FBQ3REOztBQUVBO0FBQ0E7QUFDQSxnQ0FBZ0Msc0JBQXNCO0FBQ3REOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsR0FBRztBQUNIOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxHQUFHO0FBQ0g7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEdBQUc7QUFDSDs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsZ0dBQWdHO0FBQ2hHO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQSxvQkFBb0IscUJBQXFCO0FBQ3pDO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLHNHQUFzRztBQUN0RztBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsMkJBQTJCLDJDQUEyQztBQUN0RTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxPQUFPO0FBQ1A7QUFDQSxzQ0FBc0M7QUFDdEM7QUFDQSxHQUFHO0FBQ0g7O0FBRUE7QUFDQSwyQkFBMkIsYUFBYTs7QUFFeEMseUJBQXlCO0FBQ3pCLDZCQUE2QixxQkFBcUI7QUFDbEQ7O0FBRUE7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEtBQUs7QUFDTDtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7OytDQzNQQSxxSkFBQUEsbUJBQUEsWUFBQUEsb0JBQUEsV0FBQUMsQ0FBQSxTQUFBQyxDQUFBLEVBQUFELENBQUEsT0FBQUUsQ0FBQSxHQUFBQyxNQUFBLENBQUFDLFNBQUEsRUFBQUMsQ0FBQSxHQUFBSCxDQUFBLENBQUFJLGNBQUEsRUFBQUMsQ0FBQSxHQUFBSixNQUFBLENBQUFLLGNBQUEsY0FBQVAsQ0FBQSxFQUFBRCxDQUFBLEVBQUFFLENBQUEsSUFBQUQsQ0FBQSxDQUFBRCxDQUFBLElBQUFFLENBQUEsQ0FBQU8sS0FBQSxLQUFBQyxDQUFBLHdCQUFBQyxNQUFBLEdBQUFBLE1BQUEsT0FBQUMsQ0FBQSxHQUFBRixDQUFBLENBQUFHLFFBQUEsa0JBQUFDLENBQUEsR0FBQUosQ0FBQSxDQUFBSyxhQUFBLHVCQUFBQyxDQUFBLEdBQUFOLENBQUEsQ0FBQU8sV0FBQSw4QkFBQUMsT0FBQWpCLENBQUEsRUFBQUQsQ0FBQSxFQUFBRSxDQUFBLFdBQUFDLE1BQUEsQ0FBQUssY0FBQSxDQUFBUCxDQUFBLEVBQUFELENBQUEsSUFBQVMsS0FBQSxFQUFBUCxDQUFBLEVBQUFpQixVQUFBLE1BQUFDLFlBQUEsTUFBQUMsUUFBQSxTQUFBcEIsQ0FBQSxDQUFBRCxDQUFBLFdBQUFrQixNQUFBLG1CQUFBakIsQ0FBQSxJQUFBaUIsTUFBQSxZQUFBQSxPQUFBakIsQ0FBQSxFQUFBRCxDQUFBLEVBQUFFLENBQUEsV0FBQUQsQ0FBQSxDQUFBRCxDQUFBLElBQUFFLENBQUEsZ0JBQUFvQixLQUFBckIsQ0FBQSxFQUFBRCxDQUFBLEVBQUFFLENBQUEsRUFBQUcsQ0FBQSxRQUFBSyxDQUFBLEdBQUFWLENBQUEsSUFBQUEsQ0FBQSxDQUFBSSxTQUFBLFlBQUFtQixTQUFBLEdBQUF2QixDQUFBLEdBQUF1QixTQUFBLEVBQUFYLENBQUEsR0FBQVQsTUFBQSxDQUFBcUIsTUFBQSxDQUFBZCxDQUFBLENBQUFOLFNBQUEsR0FBQVUsQ0FBQSxPQUFBVyxPQUFBLENBQUFwQixDQUFBLGdCQUFBRSxDQUFBLENBQUFLLENBQUEsZUFBQUgsS0FBQSxFQUFBaUIsZ0JBQUEsQ0FBQXpCLENBQUEsRUFBQUMsQ0FBQSxFQUFBWSxDQUFBLE1BQUFGLENBQUEsYUFBQWUsU0FBQTFCLENBQUEsRUFBQUQsQ0FBQSxFQUFBRSxDQUFBLG1CQUFBMEIsSUFBQSxZQUFBQyxHQUFBLEVBQUE1QixDQUFBLENBQUE2QixJQUFBLENBQUE5QixDQUFBLEVBQUFFLENBQUEsY0FBQUQsQ0FBQSxhQUFBMkIsSUFBQSxXQUFBQyxHQUFBLEVBQUE1QixDQUFBLFFBQUFELENBQUEsQ0FBQXNCLElBQUEsR0FBQUEsSUFBQSxNQUFBUyxDQUFBLHFCQUFBQyxDQUFBLHFCQUFBQyxDQUFBLGdCQUFBQyxDQUFBLGdCQUFBQyxDQUFBLGdCQUFBWixVQUFBLGNBQUFhLGtCQUFBLGNBQUFDLDJCQUFBLFNBQUFDLENBQUEsT0FBQXBCLE1BQUEsQ0FBQW9CLENBQUEsRUFBQTFCLENBQUEscUNBQUEyQixDQUFBLEdBQUFwQyxNQUFBLENBQUFxQyxjQUFBLEVBQUFDLENBQUEsR0FBQUYsQ0FBQSxJQUFBQSxDQUFBLENBQUFBLENBQUEsQ0FBQUcsTUFBQSxRQUFBRCxDQUFBLElBQUFBLENBQUEsS0FBQXZDLENBQUEsSUFBQUcsQ0FBQSxDQUFBeUIsSUFBQSxDQUFBVyxDQUFBLEVBQUE3QixDQUFBLE1BQUEwQixDQUFBLEdBQUFHLENBQUEsT0FBQUUsQ0FBQSxHQUFBTiwwQkFBQSxDQUFBakMsU0FBQSxHQUFBbUIsU0FBQSxDQUFBbkIsU0FBQSxHQUFBRCxNQUFBLENBQUFxQixNQUFBLENBQUFjLENBQUEsWUFBQU0sc0JBQUEzQyxDQUFBLGdDQUFBNEMsT0FBQSxXQUFBN0MsQ0FBQSxJQUFBa0IsTUFBQSxDQUFBakIsQ0FBQSxFQUFBRCxDQUFBLFlBQUFDLENBQUEsZ0JBQUE2QyxPQUFBLENBQUE5QyxDQUFBLEVBQUFDLENBQUEsc0JBQUE4QyxjQUFBOUMsQ0FBQSxFQUFBRCxDQUFBLGFBQUFnRCxPQUFBOUMsQ0FBQSxFQUFBSyxDQUFBLEVBQUFHLENBQUEsRUFBQUUsQ0FBQSxRQUFBRSxDQUFBLEdBQUFhLFFBQUEsQ0FBQTFCLENBQUEsQ0FBQUMsQ0FBQSxHQUFBRCxDQUFBLEVBQUFNLENBQUEsbUJBQUFPLENBQUEsQ0FBQWMsSUFBQSxRQUFBWixDQUFBLEdBQUFGLENBQUEsQ0FBQWUsR0FBQSxFQUFBRSxDQUFBLEdBQUFmLENBQUEsQ0FBQVAsS0FBQSxTQUFBc0IsQ0FBQSxnQkFBQWtCLE9BQUEsQ0FBQWxCLENBQUEsS0FBQTFCLENBQUEsQ0FBQXlCLElBQUEsQ0FBQUMsQ0FBQSxlQUFBL0IsQ0FBQSxDQUFBa0QsT0FBQSxDQUFBbkIsQ0FBQSxDQUFBb0IsT0FBQSxFQUFBQyxJQUFBLFdBQUFuRCxDQUFBLElBQUErQyxNQUFBLFNBQUEvQyxDQUFBLEVBQUFTLENBQUEsRUFBQUUsQ0FBQSxnQkFBQVgsQ0FBQSxJQUFBK0MsTUFBQSxVQUFBL0MsQ0FBQSxFQUFBUyxDQUFBLEVBQUFFLENBQUEsUUFBQVosQ0FBQSxDQUFBa0QsT0FBQSxDQUFBbkIsQ0FBQSxFQUFBcUIsSUFBQSxXQUFBbkQsQ0FBQSxJQUFBZSxDQUFBLENBQUFQLEtBQUEsR0FBQVIsQ0FBQSxFQUFBUyxDQUFBLENBQUFNLENBQUEsZ0JBQUFmLENBQUEsV0FBQStDLE1BQUEsVUFBQS9DLENBQUEsRUFBQVMsQ0FBQSxFQUFBRSxDQUFBLFNBQUFBLENBQUEsQ0FBQUUsQ0FBQSxDQUFBZSxHQUFBLFNBQUEzQixDQUFBLEVBQUFLLENBQUEsb0JBQUFFLEtBQUEsV0FBQUEsTUFBQVIsQ0FBQSxFQUFBSSxDQUFBLGFBQUFnRCwyQkFBQSxlQUFBckQsQ0FBQSxXQUFBQSxDQUFBLEVBQUFFLENBQUEsSUFBQThDLE1BQUEsQ0FBQS9DLENBQUEsRUFBQUksQ0FBQSxFQUFBTCxDQUFBLEVBQUFFLENBQUEsZ0JBQUFBLENBQUEsR0FBQUEsQ0FBQSxHQUFBQSxDQUFBLENBQUFrRCxJQUFBLENBQUFDLDBCQUFBLEVBQUFBLDBCQUFBLElBQUFBLDBCQUFBLHFCQUFBM0IsaUJBQUExQixDQUFBLEVBQUFFLENBQUEsRUFBQUcsQ0FBQSxRQUFBRSxDQUFBLEdBQUF3QixDQUFBLG1CQUFBckIsQ0FBQSxFQUFBRSxDQUFBLFFBQUFMLENBQUEsS0FBQTBCLENBQUEsWUFBQXFCLEtBQUEsc0NBQUEvQyxDQUFBLEtBQUEyQixDQUFBLG9CQUFBeEIsQ0FBQSxRQUFBRSxDQUFBLFdBQUFILEtBQUEsRUFBQVIsQ0FBQSxFQUFBc0QsSUFBQSxlQUFBbEQsQ0FBQSxDQUFBbUQsTUFBQSxHQUFBOUMsQ0FBQSxFQUFBTCxDQUFBLENBQUF3QixHQUFBLEdBQUFqQixDQUFBLFVBQUFFLENBQUEsR0FBQVQsQ0FBQSxDQUFBb0QsUUFBQSxNQUFBM0MsQ0FBQSxRQUFBRSxDQUFBLEdBQUEwQyxtQkFBQSxDQUFBNUMsQ0FBQSxFQUFBVCxDQUFBLE9BQUFXLENBQUEsUUFBQUEsQ0FBQSxLQUFBbUIsQ0FBQSxtQkFBQW5CLENBQUEscUJBQUFYLENBQUEsQ0FBQW1ELE1BQUEsRUFBQW5ELENBQUEsQ0FBQXNELElBQUEsR0FBQXRELENBQUEsQ0FBQXVELEtBQUEsR0FBQXZELENBQUEsQ0FBQXdCLEdBQUEsc0JBQUF4QixDQUFBLENBQUFtRCxNQUFBLFFBQUFqRCxDQUFBLEtBQUF3QixDQUFBLFFBQUF4QixDQUFBLEdBQUEyQixDQUFBLEVBQUE3QixDQUFBLENBQUF3QixHQUFBLEVBQUF4QixDQUFBLENBQUF3RCxpQkFBQSxDQUFBeEQsQ0FBQSxDQUFBd0IsR0FBQSx1QkFBQXhCLENBQUEsQ0FBQW1ELE1BQUEsSUFBQW5ELENBQUEsQ0FBQXlELE1BQUEsV0FBQXpELENBQUEsQ0FBQXdCLEdBQUEsR0FBQXRCLENBQUEsR0FBQTBCLENBQUEsTUFBQUssQ0FBQSxHQUFBWCxRQUFBLENBQUEzQixDQUFBLEVBQUFFLENBQUEsRUFBQUcsQ0FBQSxvQkFBQWlDLENBQUEsQ0FBQVYsSUFBQSxRQUFBckIsQ0FBQSxHQUFBRixDQUFBLENBQUFrRCxJQUFBLEdBQUFyQixDQUFBLEdBQUFGLENBQUEsRUFBQU0sQ0FBQSxDQUFBVCxHQUFBLEtBQUFNLENBQUEscUJBQUExQixLQUFBLEVBQUE2QixDQUFBLENBQUFULEdBQUEsRUFBQTBCLElBQUEsRUFBQWxELENBQUEsQ0FBQWtELElBQUEsa0JBQUFqQixDQUFBLENBQUFWLElBQUEsS0FBQXJCLENBQUEsR0FBQTJCLENBQUEsRUFBQTdCLENBQUEsQ0FBQW1ELE1BQUEsWUFBQW5ELENBQUEsQ0FBQXdCLEdBQUEsR0FBQVMsQ0FBQSxDQUFBVCxHQUFBLG1CQUFBNkIsb0JBQUExRCxDQUFBLEVBQUFFLENBQUEsUUFBQUcsQ0FBQSxHQUFBSCxDQUFBLENBQUFzRCxNQUFBLEVBQUFqRCxDQUFBLEdBQUFQLENBQUEsQ0FBQWEsUUFBQSxDQUFBUixDQUFBLE9BQUFFLENBQUEsS0FBQU4sQ0FBQSxTQUFBQyxDQUFBLENBQUF1RCxRQUFBLHFCQUFBcEQsQ0FBQSxJQUFBTCxDQUFBLENBQUFhLFFBQUEsZUFBQVgsQ0FBQSxDQUFBc0QsTUFBQSxhQUFBdEQsQ0FBQSxDQUFBMkIsR0FBQSxHQUFBNUIsQ0FBQSxFQUFBeUQsbUJBQUEsQ0FBQTFELENBQUEsRUFBQUUsQ0FBQSxlQUFBQSxDQUFBLENBQUFzRCxNQUFBLGtCQUFBbkQsQ0FBQSxLQUFBSCxDQUFBLENBQUFzRCxNQUFBLFlBQUF0RCxDQUFBLENBQUEyQixHQUFBLE9BQUFrQyxTQUFBLHVDQUFBMUQsQ0FBQSxpQkFBQThCLENBQUEsTUFBQXpCLENBQUEsR0FBQWlCLFFBQUEsQ0FBQXBCLENBQUEsRUFBQVAsQ0FBQSxDQUFBYSxRQUFBLEVBQUFYLENBQUEsQ0FBQTJCLEdBQUEsbUJBQUFuQixDQUFBLENBQUFrQixJQUFBLFNBQUExQixDQUFBLENBQUFzRCxNQUFBLFlBQUF0RCxDQUFBLENBQUEyQixHQUFBLEdBQUFuQixDQUFBLENBQUFtQixHQUFBLEVBQUEzQixDQUFBLENBQUF1RCxRQUFBLFNBQUF0QixDQUFBLE1BQUF2QixDQUFBLEdBQUFGLENBQUEsQ0FBQW1CLEdBQUEsU0FBQWpCLENBQUEsR0FBQUEsQ0FBQSxDQUFBMkMsSUFBQSxJQUFBckQsQ0FBQSxDQUFBRixDQUFBLENBQUFnRSxVQUFBLElBQUFwRCxDQUFBLENBQUFILEtBQUEsRUFBQVAsQ0FBQSxDQUFBK0QsSUFBQSxHQUFBakUsQ0FBQSxDQUFBa0UsT0FBQSxlQUFBaEUsQ0FBQSxDQUFBc0QsTUFBQSxLQUFBdEQsQ0FBQSxDQUFBc0QsTUFBQSxXQUFBdEQsQ0FBQSxDQUFBMkIsR0FBQSxHQUFBNUIsQ0FBQSxHQUFBQyxDQUFBLENBQUF1RCxRQUFBLFNBQUF0QixDQUFBLElBQUF2QixDQUFBLElBQUFWLENBQUEsQ0FBQXNELE1BQUEsWUFBQXRELENBQUEsQ0FBQTJCLEdBQUEsT0FBQWtDLFNBQUEsc0NBQUE3RCxDQUFBLENBQUF1RCxRQUFBLFNBQUF0QixDQUFBLGNBQUFnQyxhQUFBbEUsQ0FBQSxRQUFBRCxDQUFBLEtBQUFvRSxNQUFBLEVBQUFuRSxDQUFBLFlBQUFBLENBQUEsS0FBQUQsQ0FBQSxDQUFBcUUsUUFBQSxHQUFBcEUsQ0FBQSxXQUFBQSxDQUFBLEtBQUFELENBQUEsQ0FBQXNFLFVBQUEsR0FBQXJFLENBQUEsS0FBQUQsQ0FBQSxDQUFBdUUsUUFBQSxHQUFBdEUsQ0FBQSxXQUFBdUUsVUFBQSxDQUFBQyxJQUFBLENBQUF6RSxDQUFBLGNBQUEwRSxjQUFBekUsQ0FBQSxRQUFBRCxDQUFBLEdBQUFDLENBQUEsQ0FBQTBFLFVBQUEsUUFBQTNFLENBQUEsQ0FBQTRCLElBQUEsb0JBQUE1QixDQUFBLENBQUE2QixHQUFBLEVBQUE1QixDQUFBLENBQUEwRSxVQUFBLEdBQUEzRSxDQUFBLGFBQUF5QixRQUFBeEIsQ0FBQSxTQUFBdUUsVUFBQSxNQUFBSixNQUFBLGFBQUFuRSxDQUFBLENBQUE0QyxPQUFBLENBQUFzQixZQUFBLGNBQUFTLEtBQUEsaUJBQUFsQyxPQUFBMUMsQ0FBQSxRQUFBQSxDQUFBLFdBQUFBLENBQUEsUUFBQUUsQ0FBQSxHQUFBRixDQUFBLENBQUFZLENBQUEsT0FBQVYsQ0FBQSxTQUFBQSxDQUFBLENBQUE0QixJQUFBLENBQUE5QixDQUFBLDRCQUFBQSxDQUFBLENBQUFpRSxJQUFBLFNBQUFqRSxDQUFBLE9BQUE2RSxLQUFBLENBQUE3RSxDQUFBLENBQUE4RSxNQUFBLFNBQUF2RSxDQUFBLE9BQUFHLENBQUEsWUFBQXVELEtBQUEsYUFBQTFELENBQUEsR0FBQVAsQ0FBQSxDQUFBOEUsTUFBQSxPQUFBekUsQ0FBQSxDQUFBeUIsSUFBQSxDQUFBOUIsQ0FBQSxFQUFBTyxDQUFBLFVBQUEwRCxJQUFBLENBQUF4RCxLQUFBLEdBQUFULENBQUEsQ0FBQU8sQ0FBQSxHQUFBMEQsSUFBQSxDQUFBVixJQUFBLE9BQUFVLElBQUEsU0FBQUEsSUFBQSxDQUFBeEQsS0FBQSxHQUFBUixDQUFBLEVBQUFnRSxJQUFBLENBQUFWLElBQUEsT0FBQVUsSUFBQSxZQUFBdkQsQ0FBQSxDQUFBdUQsSUFBQSxHQUFBdkQsQ0FBQSxnQkFBQXFELFNBQUEsQ0FBQWQsT0FBQSxDQUFBakQsQ0FBQSxrQ0FBQW9DLGlCQUFBLENBQUFoQyxTQUFBLEdBQUFpQywwQkFBQSxFQUFBOUIsQ0FBQSxDQUFBb0MsQ0FBQSxtQkFBQWxDLEtBQUEsRUFBQTRCLDBCQUFBLEVBQUFqQixZQUFBLFNBQUFiLENBQUEsQ0FBQThCLDBCQUFBLG1CQUFBNUIsS0FBQSxFQUFBMkIsaUJBQUEsRUFBQWhCLFlBQUEsU0FBQWdCLGlCQUFBLENBQUEyQyxXQUFBLEdBQUE3RCxNQUFBLENBQUFtQiwwQkFBQSxFQUFBckIsQ0FBQSx3QkFBQWhCLENBQUEsQ0FBQWdGLG1CQUFBLGFBQUEvRSxDQUFBLFFBQUFELENBQUEsd0JBQUFDLENBQUEsSUFBQUEsQ0FBQSxDQUFBZ0YsV0FBQSxXQUFBakYsQ0FBQSxLQUFBQSxDQUFBLEtBQUFvQyxpQkFBQSw2QkFBQXBDLENBQUEsQ0FBQStFLFdBQUEsSUFBQS9FLENBQUEsQ0FBQWtGLElBQUEsT0FBQWxGLENBQUEsQ0FBQW1GLElBQUEsYUFBQWxGLENBQUEsV0FBQUUsTUFBQSxDQUFBaUYsY0FBQSxHQUFBakYsTUFBQSxDQUFBaUYsY0FBQSxDQUFBbkYsQ0FBQSxFQUFBb0MsMEJBQUEsS0FBQXBDLENBQUEsQ0FBQW9GLFNBQUEsR0FBQWhELDBCQUFBLEVBQUFuQixNQUFBLENBQUFqQixDQUFBLEVBQUFlLENBQUEseUJBQUFmLENBQUEsQ0FBQUcsU0FBQSxHQUFBRCxNQUFBLENBQUFxQixNQUFBLENBQUFtQixDQUFBLEdBQUExQyxDQUFBLEtBQUFELENBQUEsQ0FBQXNGLEtBQUEsYUFBQXJGLENBQUEsYUFBQWtELE9BQUEsRUFBQWxELENBQUEsT0FBQTJDLHFCQUFBLENBQUFHLGFBQUEsQ0FBQTNDLFNBQUEsR0FBQWMsTUFBQSxDQUFBNkIsYUFBQSxDQUFBM0MsU0FBQSxFQUFBVSxDQUFBLGlDQUFBZCxDQUFBLENBQUErQyxhQUFBLEdBQUFBLGFBQUEsRUFBQS9DLENBQUEsQ0FBQXVGLEtBQUEsYUFBQXRGLENBQUEsRUFBQUMsQ0FBQSxFQUFBRyxDQUFBLEVBQUFFLENBQUEsRUFBQUcsQ0FBQSxlQUFBQSxDQUFBLEtBQUFBLENBQUEsR0FBQThFLE9BQUEsT0FBQTVFLENBQUEsT0FBQW1DLGFBQUEsQ0FBQXpCLElBQUEsQ0FBQXJCLENBQUEsRUFBQUMsQ0FBQSxFQUFBRyxDQUFBLEVBQUFFLENBQUEsR0FBQUcsQ0FBQSxVQUFBVixDQUFBLENBQUFnRixtQkFBQSxDQUFBOUUsQ0FBQSxJQUFBVSxDQUFBLEdBQUFBLENBQUEsQ0FBQXFELElBQUEsR0FBQWIsSUFBQSxXQUFBbkQsQ0FBQSxXQUFBQSxDQUFBLENBQUFzRCxJQUFBLEdBQUF0RCxDQUFBLENBQUFRLEtBQUEsR0FBQUcsQ0FBQSxDQUFBcUQsSUFBQSxXQUFBckIscUJBQUEsQ0FBQUQsQ0FBQSxHQUFBekIsTUFBQSxDQUFBeUIsQ0FBQSxFQUFBM0IsQ0FBQSxnQkFBQUUsTUFBQSxDQUFBeUIsQ0FBQSxFQUFBL0IsQ0FBQSxpQ0FBQU0sTUFBQSxDQUFBeUIsQ0FBQSw2REFBQTNDLENBQUEsQ0FBQXlGLElBQUEsYUFBQXhGLENBQUEsUUFBQUQsQ0FBQSxHQUFBRyxNQUFBLENBQUFGLENBQUEsR0FBQUMsQ0FBQSxnQkFBQUcsQ0FBQSxJQUFBTCxDQUFBLEVBQUFFLENBQUEsQ0FBQXVFLElBQUEsQ0FBQXBFLENBQUEsVUFBQUgsQ0FBQSxDQUFBd0YsT0FBQSxhQUFBekIsS0FBQSxXQUFBL0QsQ0FBQSxDQUFBNEUsTUFBQSxTQUFBN0UsQ0FBQSxHQUFBQyxDQUFBLENBQUF5RixHQUFBLFFBQUExRixDQUFBLElBQUFELENBQUEsU0FBQWlFLElBQUEsQ0FBQXhELEtBQUEsR0FBQVIsQ0FBQSxFQUFBZ0UsSUFBQSxDQUFBVixJQUFBLE9BQUFVLElBQUEsV0FBQUEsSUFBQSxDQUFBVixJQUFBLE9BQUFVLElBQUEsUUFBQWpFLENBQUEsQ0FBQTBDLE1BQUEsR0FBQUEsTUFBQSxFQUFBakIsT0FBQSxDQUFBckIsU0FBQSxLQUFBNkUsV0FBQSxFQUFBeEQsT0FBQSxFQUFBbUQsS0FBQSxXQUFBQSxNQUFBNUUsQ0FBQSxhQUFBNEYsSUFBQSxXQUFBM0IsSUFBQSxXQUFBTixJQUFBLFFBQUFDLEtBQUEsR0FBQTNELENBQUEsT0FBQXNELElBQUEsWUFBQUUsUUFBQSxjQUFBRCxNQUFBLGdCQUFBM0IsR0FBQSxHQUFBNUIsQ0FBQSxPQUFBdUUsVUFBQSxDQUFBM0IsT0FBQSxDQUFBNkIsYUFBQSxJQUFBMUUsQ0FBQSxXQUFBRSxDQUFBLGtCQUFBQSxDQUFBLENBQUEyRixNQUFBLE9BQUF4RixDQUFBLENBQUF5QixJQUFBLE9BQUE1QixDQUFBLE1BQUEyRSxLQUFBLEVBQUEzRSxDQUFBLENBQUE0RixLQUFBLGNBQUE1RixDQUFBLElBQUFELENBQUEsTUFBQThGLElBQUEsV0FBQUEsS0FBQSxTQUFBeEMsSUFBQSxXQUFBdEQsQ0FBQSxRQUFBdUUsVUFBQSxJQUFBRyxVQUFBLGtCQUFBMUUsQ0FBQSxDQUFBMkIsSUFBQSxRQUFBM0IsQ0FBQSxDQUFBNEIsR0FBQSxjQUFBbUUsSUFBQSxLQUFBbkMsaUJBQUEsV0FBQUEsa0JBQUE3RCxDQUFBLGFBQUF1RCxJQUFBLFFBQUF2RCxDQUFBLE1BQUFFLENBQUEsa0JBQUErRixPQUFBNUYsQ0FBQSxFQUFBRSxDQUFBLFdBQUFLLENBQUEsQ0FBQWdCLElBQUEsWUFBQWhCLENBQUEsQ0FBQWlCLEdBQUEsR0FBQTdCLENBQUEsRUFBQUUsQ0FBQSxDQUFBK0QsSUFBQSxHQUFBNUQsQ0FBQSxFQUFBRSxDQUFBLEtBQUFMLENBQUEsQ0FBQXNELE1BQUEsV0FBQXRELENBQUEsQ0FBQTJCLEdBQUEsR0FBQTVCLENBQUEsS0FBQU0sQ0FBQSxhQUFBQSxDQUFBLFFBQUFpRSxVQUFBLENBQUFNLE1BQUEsTUFBQXZFLENBQUEsU0FBQUEsQ0FBQSxRQUFBRyxDQUFBLFFBQUE4RCxVQUFBLENBQUFqRSxDQUFBLEdBQUFLLENBQUEsR0FBQUYsQ0FBQSxDQUFBaUUsVUFBQSxpQkFBQWpFLENBQUEsQ0FBQTBELE1BQUEsU0FBQTZCLE1BQUEsYUFBQXZGLENBQUEsQ0FBQTBELE1BQUEsU0FBQXdCLElBQUEsUUFBQTlFLENBQUEsR0FBQVQsQ0FBQSxDQUFBeUIsSUFBQSxDQUFBcEIsQ0FBQSxlQUFBTSxDQUFBLEdBQUFYLENBQUEsQ0FBQXlCLElBQUEsQ0FBQXBCLENBQUEscUJBQUFJLENBQUEsSUFBQUUsQ0FBQSxhQUFBNEUsSUFBQSxHQUFBbEYsQ0FBQSxDQUFBMkQsUUFBQSxTQUFBNEIsTUFBQSxDQUFBdkYsQ0FBQSxDQUFBMkQsUUFBQSxnQkFBQXVCLElBQUEsR0FBQWxGLENBQUEsQ0FBQTRELFVBQUEsU0FBQTJCLE1BQUEsQ0FBQXZGLENBQUEsQ0FBQTRELFVBQUEsY0FBQXhELENBQUEsYUFBQThFLElBQUEsR0FBQWxGLENBQUEsQ0FBQTJELFFBQUEsU0FBQTRCLE1BQUEsQ0FBQXZGLENBQUEsQ0FBQTJELFFBQUEscUJBQUFyRCxDQUFBLFlBQUFzQyxLQUFBLHFEQUFBc0MsSUFBQSxHQUFBbEYsQ0FBQSxDQUFBNEQsVUFBQSxTQUFBMkIsTUFBQSxDQUFBdkYsQ0FBQSxDQUFBNEQsVUFBQSxZQUFBUixNQUFBLFdBQUFBLE9BQUE3RCxDQUFBLEVBQUFELENBQUEsYUFBQUUsQ0FBQSxRQUFBc0UsVUFBQSxDQUFBTSxNQUFBLE1BQUE1RSxDQUFBLFNBQUFBLENBQUEsUUFBQUssQ0FBQSxRQUFBaUUsVUFBQSxDQUFBdEUsQ0FBQSxPQUFBSyxDQUFBLENBQUE2RCxNQUFBLFNBQUF3QixJQUFBLElBQUF2RixDQUFBLENBQUF5QixJQUFBLENBQUF2QixDQUFBLHdCQUFBcUYsSUFBQSxHQUFBckYsQ0FBQSxDQUFBK0QsVUFBQSxRQUFBNUQsQ0FBQSxHQUFBSCxDQUFBLGFBQUFHLENBQUEsaUJBQUFULENBQUEsbUJBQUFBLENBQUEsS0FBQVMsQ0FBQSxDQUFBMEQsTUFBQSxJQUFBcEUsQ0FBQSxJQUFBQSxDQUFBLElBQUFVLENBQUEsQ0FBQTRELFVBQUEsS0FBQTVELENBQUEsY0FBQUUsQ0FBQSxHQUFBRixDQUFBLEdBQUFBLENBQUEsQ0FBQWlFLFVBQUEsY0FBQS9ELENBQUEsQ0FBQWdCLElBQUEsR0FBQTNCLENBQUEsRUFBQVcsQ0FBQSxDQUFBaUIsR0FBQSxHQUFBN0IsQ0FBQSxFQUFBVSxDQUFBLFNBQUE4QyxNQUFBLGdCQUFBUyxJQUFBLEdBQUF2RCxDQUFBLENBQUE0RCxVQUFBLEVBQUFuQyxDQUFBLFNBQUErRCxRQUFBLENBQUF0RixDQUFBLE1BQUFzRixRQUFBLFdBQUFBLFNBQUFqRyxDQUFBLEVBQUFELENBQUEsb0JBQUFDLENBQUEsQ0FBQTJCLElBQUEsUUFBQTNCLENBQUEsQ0FBQTRCLEdBQUEscUJBQUE1QixDQUFBLENBQUEyQixJQUFBLG1CQUFBM0IsQ0FBQSxDQUFBMkIsSUFBQSxRQUFBcUMsSUFBQSxHQUFBaEUsQ0FBQSxDQUFBNEIsR0FBQSxnQkFBQTVCLENBQUEsQ0FBQTJCLElBQUEsU0FBQW9FLElBQUEsUUFBQW5FLEdBQUEsR0FBQTVCLENBQUEsQ0FBQTRCLEdBQUEsT0FBQTJCLE1BQUEsa0JBQUFTLElBQUEseUJBQUFoRSxDQUFBLENBQUEyQixJQUFBLElBQUE1QixDQUFBLFVBQUFpRSxJQUFBLEdBQUFqRSxDQUFBLEdBQUFtQyxDQUFBLEtBQUFnRSxNQUFBLFdBQUFBLE9BQUFsRyxDQUFBLGFBQUFELENBQUEsUUFBQXdFLFVBQUEsQ0FBQU0sTUFBQSxNQUFBOUUsQ0FBQSxTQUFBQSxDQUFBLFFBQUFFLENBQUEsUUFBQXNFLFVBQUEsQ0FBQXhFLENBQUEsT0FBQUUsQ0FBQSxDQUFBb0UsVUFBQSxLQUFBckUsQ0FBQSxjQUFBaUcsUUFBQSxDQUFBaEcsQ0FBQSxDQUFBeUUsVUFBQSxFQUFBekUsQ0FBQSxDQUFBcUUsUUFBQSxHQUFBRyxhQUFBLENBQUF4RSxDQUFBLEdBQUFpQyxDQUFBLHlCQUFBaUUsT0FBQW5HLENBQUEsYUFBQUQsQ0FBQSxRQUFBd0UsVUFBQSxDQUFBTSxNQUFBLE1BQUE5RSxDQUFBLFNBQUFBLENBQUEsUUFBQUUsQ0FBQSxRQUFBc0UsVUFBQSxDQUFBeEUsQ0FBQSxPQUFBRSxDQUFBLENBQUFrRSxNQUFBLEtBQUFuRSxDQUFBLFFBQUFJLENBQUEsR0FBQUgsQ0FBQSxDQUFBeUUsVUFBQSxrQkFBQXRFLENBQUEsQ0FBQXVCLElBQUEsUUFBQXJCLENBQUEsR0FBQUYsQ0FBQSxDQUFBd0IsR0FBQSxFQUFBNkMsYUFBQSxDQUFBeEUsQ0FBQSxZQUFBSyxDQUFBLGdCQUFBK0MsS0FBQSw4QkFBQStDLGFBQUEsV0FBQUEsY0FBQXJHLENBQUEsRUFBQUUsQ0FBQSxFQUFBRyxDQUFBLGdCQUFBb0QsUUFBQSxLQUFBNUMsUUFBQSxFQUFBNkIsTUFBQSxDQUFBMUMsQ0FBQSxHQUFBZ0UsVUFBQSxFQUFBOUQsQ0FBQSxFQUFBZ0UsT0FBQSxFQUFBN0QsQ0FBQSxvQkFBQW1ELE1BQUEsVUFBQTNCLEdBQUEsR0FBQTVCLENBQUEsR0FBQWtDLENBQUEsT0FBQW5DLENBQUE7QUFBQSxTQUFBc0csbUJBQUFDLEdBQUEsRUFBQXJELE9BQUEsRUFBQXNELE1BQUEsRUFBQUMsS0FBQSxFQUFBQyxNQUFBLEVBQUFDLEdBQUEsRUFBQTlFLEdBQUEsY0FBQStFLElBQUEsR0FBQUwsR0FBQSxDQUFBSSxHQUFBLEVBQUE5RSxHQUFBLE9BQUFwQixLQUFBLEdBQUFtRyxJQUFBLENBQUFuRyxLQUFBLFdBQUFvRyxLQUFBLElBQUFMLE1BQUEsQ0FBQUssS0FBQSxpQkFBQUQsSUFBQSxDQUFBckQsSUFBQSxJQUFBTCxPQUFBLENBQUF6QyxLQUFBLFlBQUErRSxPQUFBLENBQUF0QyxPQUFBLENBQUF6QyxLQUFBLEVBQUEyQyxJQUFBLENBQUFxRCxLQUFBLEVBQUFDLE1BQUE7QUFBQSxTQUFBSSxrQkFBQUMsRUFBQSw2QkFBQUMsSUFBQSxTQUFBQyxJQUFBLEdBQUFDLFNBQUEsYUFBQTFCLE9BQUEsV0FBQXRDLE9BQUEsRUFBQXNELE1BQUEsUUFBQUQsR0FBQSxHQUFBUSxFQUFBLENBQUFJLEtBQUEsQ0FBQUgsSUFBQSxFQUFBQyxJQUFBLFlBQUFSLE1BQUFoRyxLQUFBLElBQUE2RixrQkFBQSxDQUFBQyxHQUFBLEVBQUFyRCxPQUFBLEVBQUFzRCxNQUFBLEVBQUFDLEtBQUEsRUFBQUMsTUFBQSxVQUFBakcsS0FBQSxjQUFBaUcsT0FBQVUsR0FBQSxJQUFBZCxrQkFBQSxDQUFBQyxHQUFBLEVBQUFyRCxPQUFBLEVBQUFzRCxNQUFBLEVBQUFDLEtBQUEsRUFBQUMsTUFBQSxXQUFBVSxHQUFBLEtBQUFYLEtBQUEsQ0FBQVksU0FBQTtBQUFBLFNBQUFDLGdCQUFBQyxRQUFBLEVBQUFDLFdBQUEsVUFBQUQsUUFBQSxZQUFBQyxXQUFBLGVBQUF6RCxTQUFBO0FBQUEsU0FBQTBELGtCQUFBQyxNQUFBLEVBQUFDLEtBQUEsYUFBQWpILENBQUEsTUFBQUEsQ0FBQSxHQUFBaUgsS0FBQSxDQUFBN0MsTUFBQSxFQUFBcEUsQ0FBQSxVQUFBa0gsVUFBQSxHQUFBRCxLQUFBLENBQUFqSCxDQUFBLEdBQUFrSCxVQUFBLENBQUF6RyxVQUFBLEdBQUF5RyxVQUFBLENBQUF6RyxVQUFBLFdBQUF5RyxVQUFBLENBQUF4RyxZQUFBLHdCQUFBd0csVUFBQSxFQUFBQSxVQUFBLENBQUF2RyxRQUFBLFNBQUFsQixNQUFBLENBQUFLLGNBQUEsQ0FBQWtILE1BQUEsRUFBQUcsY0FBQSxDQUFBRCxVQUFBLENBQUFqQixHQUFBLEdBQUFpQixVQUFBO0FBQUEsU0FBQUUsYUFBQU4sV0FBQSxFQUFBTyxVQUFBLEVBQUFDLFdBQUEsUUFBQUQsVUFBQSxFQUFBTixpQkFBQSxDQUFBRCxXQUFBLENBQUFwSCxTQUFBLEVBQUEySCxVQUFBLE9BQUFDLFdBQUEsRUFBQVAsaUJBQUEsQ0FBQUQsV0FBQSxFQUFBUSxXQUFBLEdBQUE3SCxNQUFBLENBQUFLLGNBQUEsQ0FBQWdILFdBQUEsaUJBQUFuRyxRQUFBLG1CQUFBbUcsV0FBQTtBQUFBLFNBQUFLLGVBQUE1SCxDQUFBLFFBQUFTLENBQUEsR0FBQXVILFlBQUEsQ0FBQWhJLENBQUEsZ0NBQUFnRCxPQUFBLENBQUF2QyxDQUFBLElBQUFBLENBQUEsR0FBQXdILE1BQUEsQ0FBQXhILENBQUE7QUFBQSxTQUFBdUgsYUFBQWhJLENBQUEsRUFBQUMsQ0FBQSxvQkFBQStDLE9BQUEsQ0FBQWhELENBQUEsTUFBQUEsQ0FBQSxTQUFBQSxDQUFBLE1BQUFELENBQUEsR0FBQUMsQ0FBQSxDQUFBVSxNQUFBLENBQUF3SCxXQUFBLGtCQUFBbkksQ0FBQSxRQUFBVSxDQUFBLEdBQUFWLENBQUEsQ0FBQThCLElBQUEsQ0FBQTdCLENBQUEsRUFBQUMsQ0FBQSxnQ0FBQStDLE9BQUEsQ0FBQXZDLENBQUEsVUFBQUEsQ0FBQSxZQUFBcUQsU0FBQSx5RUFBQTdELENBQUEsR0FBQWdJLE1BQUEsR0FBQUUsTUFBQSxFQUFBbkksQ0FBQTtBQURBO0FBQ0EsSUFBSW9JLEVBQUUsR0FBR0MsbUJBQU8sQ0FBQyw0RkFBNkIsQ0FBQztBQUMvQ0QsRUFBRSxDQUFDRSxZQUFZLENBQUNuSSxTQUFTLENBQUNvSSxZQUFZLEdBQUdILEVBQUUsQ0FBQ0UsWUFBWSxDQUFDbkksU0FBUyxDQUFDcUksSUFBSTtBQUN2RUosRUFBRSxDQUFDRSxZQUFZLENBQUNuSSxTQUFTLENBQUNxSSxJQUFJLEdBQUcsVUFBUzdHLElBQUksRUFBRThHLE1BQU0sRUFBRTtFQUN0RCxPQUFPLElBQUksQ0FBQ0YsWUFBWSxDQUFDNUcsSUFBSSxFQUFFOEcsTUFBTSxDQUFDLFNBQU0sQ0FBQyxVQUFDMUksQ0FBQyxFQUFLO0lBQ2xELElBQUlBLENBQUMsQ0FBQzJJLE9BQU8sSUFBSTNJLENBQUMsQ0FBQzJJLE9BQU8sQ0FBQ0MsT0FBTyxDQUFDLFdBQVcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFO01BQ3BEQyxPQUFPLENBQUNoQyxLQUFLLENBQUMsc0JBQXNCLENBQUM7TUFDckNpQyxHQUFHLENBQUNDLFVBQVUsQ0FBQ0MsT0FBTyxDQUFDQyxTQUFTLENBQUMsQ0FBQztJQUNwQyxDQUFDLE1BQU07TUFDTCxNQUFNakosQ0FBQztJQUNUO0VBQ0YsQ0FBQyxDQUFDO0FBQ0osQ0FBQztBQUVELElBQUlrSixRQUFRLEdBQUdaLG1CQUFPLENBQUMsc0NBQUssQ0FBQztBQUM3QjtBQUNBO0FBQ0E7QUFDQSxJQUFJYSxLQUFLLEdBQUdOLE9BQU8sQ0FBQ08sR0FBRztBQUN2QixJQUFJQyxJQUFJLEdBQUdSLE9BQU8sQ0FBQ1EsSUFBSTtBQUN2QixJQUFJeEMsS0FBSyxHQUFHZ0MsT0FBTyxDQUFDaEMsS0FBSztBQUN6QixJQUFJeUMsUUFBUSxHQUFHLGdDQUFnQyxDQUFDQyxJQUFJLENBQUNDLFNBQVMsQ0FBQ0MsU0FBUyxDQUFDO0FBRXpFLElBQU1DLG9CQUFvQixHQUFHLEtBQUs7QUFFbEMsU0FBU0MsUUFBUUEsQ0FBQzVDLEVBQUUsRUFBRTtFQUNwQixJQUFJNkMsSUFBSSxHQUFHcEUsT0FBTyxDQUFDdEMsT0FBTyxDQUFDLENBQUM7RUFDNUIsT0FBTyxZQUFXO0lBQUEsSUFBQTJHLEtBQUE7SUFDaEIsSUFBSTVDLElBQUksR0FBRzZDLEtBQUssQ0FBQzFKLFNBQVMsQ0FBQzBGLEtBQUssQ0FBQ2hFLElBQUksQ0FBQ29GLFNBQVMsQ0FBQztJQUNoRDBDLElBQUksR0FBR0EsSUFBSSxDQUFDeEcsSUFBSSxDQUFDLFVBQUEyRyxDQUFDO01BQUEsT0FBSWhELEVBQUUsQ0FBQ0ksS0FBSyxDQUFDMEMsS0FBSSxFQUFFNUMsSUFBSSxDQUFDO0lBQUEsRUFBQztFQUM3QyxDQUFDO0FBQ0g7QUFFQSxTQUFTK0MsVUFBVUEsQ0FBQSxFQUFHO0VBQ3BCLE9BQU9DLElBQUksQ0FBQ0MsS0FBSyxDQUFDRCxJQUFJLENBQUNFLE1BQU0sQ0FBQyxDQUFDLEdBQUcvQixNQUFNLENBQUNnQyxnQkFBZ0IsQ0FBQztBQUM1RDtBQUVBLFNBQVNDLG9CQUFvQkEsQ0FBQ0MsV0FBVyxFQUFFO0VBQ3pDLE9BQU8sSUFBSTlFLE9BQU8sQ0FBQyxVQUFDdEMsT0FBTyxFQUFFc0QsTUFBTSxFQUFLO0lBQ3RDLElBQUk4RCxXQUFXLENBQUNDLFVBQVUsS0FBSyxNQUFNLEVBQUU7TUFDckNySCxPQUFPLENBQUMsQ0FBQztJQUNYLENBQUMsTUFBTTtNQUNMLElBQUlzSCxRQUFRLEVBQUVDLFFBQVE7TUFFdEIsSUFBTUMsS0FBSyxHQUFHLFNBQVJBLEtBQUtBLENBQUEsRUFBUztRQUNsQkosV0FBVyxDQUFDSyxtQkFBbUIsQ0FBQyxNQUFNLEVBQUVILFFBQVEsQ0FBQztRQUNqREYsV0FBVyxDQUFDSyxtQkFBbUIsQ0FBQyxPQUFPLEVBQUVGLFFBQVEsQ0FBQztNQUNwRCxDQUFDO01BRURELFFBQVEsR0FBRyxTQUFBQSxTQUFBLEVBQU07UUFDZkUsS0FBSyxDQUFDLENBQUM7UUFDUHhILE9BQU8sQ0FBQyxDQUFDO01BQ1gsQ0FBQztNQUNEdUgsUUFBUSxHQUFHLFNBQUFBLFNBQUEsRUFBTTtRQUNmQyxLQUFLLENBQUMsQ0FBQztRQUNQbEUsTUFBTSxDQUFDLENBQUM7TUFDVixDQUFDO01BRUQ4RCxXQUFXLENBQUNNLGdCQUFnQixDQUFDLE1BQU0sRUFBRUosUUFBUSxDQUFDO01BQzlDRixXQUFXLENBQUNNLGdCQUFnQixDQUFDLE9BQU8sRUFBRUgsUUFBUSxDQUFDO0lBQ2pEO0VBQ0YsQ0FBQyxDQUFDO0FBQ0o7QUFFQSxJQUFNSSxvQkFBb0IsR0FBSSxZQUFNO0VBQ2xDLElBQU1DLEtBQUssR0FBR0MsUUFBUSxDQUFDQyxhQUFhLENBQUMsT0FBTyxDQUFDO0VBQzdDLE9BQU9GLEtBQUssQ0FBQ0csV0FBVyxDQUFDLDRDQUE0QyxDQUFDLEtBQUssRUFBRTtBQUMvRSxDQUFDLENBQUUsQ0FBQztBQUVKLElBQU1DLGVBQWUsR0FBRztFQUN0QjtFQUNBQyxNQUFNLEVBQUUsQ0FBQztFQUNUO0VBQ0FDLE1BQU0sRUFBRSxDQUFDO0VBQ1Q7RUFDQSxjQUFjLEVBQUU7QUFDbEIsQ0FBQztBQUVELElBQU1DLDhCQUE4QixHQUFHO0VBQ3JDQyxVQUFVLEVBQUUsQ0FBQztJQUFFQyxJQUFJLEVBQUU7RUFBZ0MsQ0FBQyxFQUFFO0lBQUVBLElBQUksRUFBRTtFQUFnQyxDQUFDO0FBQ25HLENBQUM7QUFFRCxJQUFNQyxpQkFBaUIsR0FBRyxJQUFJO0FBQUMsSUFFekJDLFlBQVk7RUFDaEIsU0FBQUEsYUFBQSxFQUFjO0lBQUFuRSxlQUFBLE9BQUFtRSxZQUFBO0lBQ1osSUFBSSxDQUFDQyxJQUFJLEdBQUcsSUFBSTtJQUNoQjtJQUNBLElBQUksQ0FBQ0MsUUFBUSxHQUFHLElBQUk7SUFDcEIsSUFBSSxDQUFDQyxTQUFTLEdBQUcsSUFBSTtJQUVyQixJQUFJLENBQUNDLFNBQVMsR0FBRyxJQUFJO0lBQ3JCLElBQUksQ0FBQ0MsYUFBYSxHQUFHLENBQUMsQ0FBQztJQUN2QixJQUFJLENBQUNDLG9CQUFvQixHQUFHLElBQUk7SUFDaEMsSUFBSSxDQUFDQyxFQUFFLEdBQUcsSUFBSTtJQUNkLElBQUksQ0FBQ0MsT0FBTyxHQUFHLElBQUk7SUFDbkIsSUFBSSxDQUFDQyxpQkFBaUIsR0FBRyxhQUFhO0lBQ3RDLElBQUksQ0FBQ0MsbUJBQW1CLEdBQUcsYUFBYTs7SUFFeEM7SUFDQTtJQUNBLElBQUksQ0FBQ0Msd0JBQXdCLEdBQUcsSUFBSSxHQUFHbkMsSUFBSSxDQUFDRSxNQUFNLENBQUMsQ0FBQztJQUNwRCxJQUFJLENBQUNrQyxpQkFBaUIsR0FBRyxJQUFJLENBQUNELHdCQUF3QjtJQUN0RCxJQUFJLENBQUNFLG1CQUFtQixHQUFHLElBQUk7SUFDL0IsSUFBSSxDQUFDQyx1QkFBdUIsR0FBRyxFQUFFO0lBQ2pDLElBQUksQ0FBQ0Msb0JBQW9CLEdBQUcsQ0FBQztJQUU3QixJQUFJLENBQUNDLFNBQVMsR0FBRyxJQUFJO0lBQ3JCLElBQUksQ0FBQ0MsU0FBUyxHQUFHLENBQUMsQ0FBQztJQUNuQixJQUFJLENBQUNDLGFBQWEsR0FBRyxJQUFJQyxHQUFHLENBQUMsQ0FBQztJQUM5QixJQUFJLENBQUNDLFlBQVksR0FBRyxDQUFDLENBQUM7SUFDdEIsSUFBSSxDQUFDQyxnQkFBZ0IsR0FBRyxJQUFJO0lBQzVCLElBQUksQ0FBQ0Msb0JBQW9CLEdBQUcsSUFBSUMsR0FBRyxDQUFDLENBQUM7SUFFckMsSUFBSSxDQUFDQyxjQUFjLEdBQUcsSUFBSUQsR0FBRyxDQUFDLENBQUM7SUFDL0IsSUFBSSxDQUFDRSxhQUFhLEdBQUcsSUFBSUYsR0FBRyxDQUFDLENBQUM7SUFFOUIsSUFBSSxDQUFDRyxXQUFXLEdBQUcsRUFBRTtJQUNyQixJQUFJLENBQUNDLGtCQUFrQixHQUFHLENBQUM7SUFDM0IsSUFBSSxDQUFDQyxhQUFhLEdBQUcsQ0FBQztJQUV0QixJQUFJLENBQUNDLGVBQWUsR0FBRyxJQUFJLENBQUNBLGVBQWUsQ0FBQ0MsSUFBSSxDQUFDLElBQUksQ0FBQztJQUN0RCxJQUFJLENBQUNDLGdCQUFnQixHQUFHLElBQUksQ0FBQ0EsZ0JBQWdCLENBQUNELElBQUksQ0FBQyxJQUFJLENBQUM7SUFDeEQsSUFBSSxDQUFDRSxrQkFBa0IsR0FBRyxJQUFJLENBQUNBLGtCQUFrQixDQUFDRixJQUFJLENBQUMsSUFBSSxDQUFDO0lBQzVELElBQUksQ0FBQ0csb0JBQW9CLEdBQUcsSUFBSSxDQUFDQSxvQkFBb0IsQ0FBQ0gsSUFBSSxDQUFDLElBQUksQ0FBQztJQUNoRSxJQUFJLENBQUNJLE1BQU0sR0FBRyxJQUFJLENBQUNBLE1BQU0sQ0FBQ0osSUFBSSxDQUFDLElBQUksQ0FBQztFQUN0QztFQUFDekYsWUFBQSxDQUFBMkQsWUFBQTtJQUFBOUUsR0FBQTtJQUFBbEcsS0FBQSxFQUVELFNBQUFtTixhQUFhQyxHQUFHLEVBQUU7TUFDaEIsSUFBSSxDQUFDaEMsU0FBUyxHQUFHZ0MsR0FBRztJQUN0QjtFQUFDO0lBQUFsSCxHQUFBO0lBQUFsRyxLQUFBLEVBRUQsU0FBQXFOLE9BQU9DLEdBQUcsRUFBRSxDQUFDO0VBQUM7SUFBQXBILEdBQUE7SUFBQWxHLEtBQUEsRUFFZCxTQUFBdU4sUUFBUUMsUUFBUSxFQUFFO01BQ2hCLElBQUksQ0FBQ3ZDLElBQUksR0FBR3VDLFFBQVE7SUFDdEI7RUFBQztJQUFBdEgsR0FBQTtJQUFBbEcsS0FBQSxFQUVELFNBQUF5TixhQUFhdEMsU0FBUyxFQUFFO01BQ3RCLElBQUksQ0FBQ0EsU0FBUyxHQUFHQSxTQUFTO0lBQzVCO0VBQUM7SUFBQWpGLEdBQUE7SUFBQWxHLEtBQUEsRUFFRCxTQUFBME4sWUFBWXhDLFFBQVEsRUFBRTtNQUNwQixJQUFJLENBQUNBLFFBQVEsR0FBR0EsUUFBUTtJQUMxQjtFQUFDO0lBQUFoRixHQUFBO0lBQUFsRyxLQUFBLEVBRUQsU0FBQTJOLGlCQUFpQkMsT0FBTyxFQUFFO01BQ3hCLElBQUksQ0FBQ3ZDLGFBQWEsR0FBR3VDLE9BQU87SUFDOUI7RUFBQztJQUFBMUgsR0FBQTtJQUFBbEcsS0FBQSxFQUVELFNBQUE2Tix3QkFBd0J2QyxvQkFBb0IsRUFBRTtNQUM1QyxJQUFJLENBQUNBLG9CQUFvQixHQUFHQSxvQkFBb0I7SUFDbEQ7RUFBQztJQUFBcEYsR0FBQTtJQUFBbEcsS0FBQSxFQUVELFNBQUE4TiwwQkFBMEJDLGVBQWUsRUFBRUMsZUFBZSxFQUFFO01BQzFELElBQUksQ0FBQ0MsY0FBYyxHQUFHRixlQUFlO01BQ3JDLElBQUksQ0FBQ0csY0FBYyxHQUFHRixlQUFlO0lBQ3ZDO0VBQUM7SUFBQTlILEdBQUE7SUFBQWxHLEtBQUEsRUFFRCxTQUFBbU8sd0JBQXdCQyxnQkFBZ0IsRUFBRTtNQUN4QyxJQUFJLENBQUNDLGtCQUFrQixHQUFHRCxnQkFBZ0I7SUFDNUM7RUFBQztJQUFBbEksR0FBQTtJQUFBbEcsS0FBQSxFQUVELFNBQUFzTyx3QkFBd0JDLFlBQVksRUFBRUMsY0FBYyxFQUFFQyxlQUFlLEVBQUU7TUFDckUsSUFBSSxDQUFDQyxtQkFBbUIsR0FBR0gsWUFBWTtNQUN2QyxJQUFJLENBQUNJLHNCQUFzQixHQUFHSCxjQUFjO01BQzVDLElBQUksQ0FBQ0ksaUJBQWlCLEdBQUdILGVBQWU7SUFDMUM7RUFBQztJQUFBdkksR0FBQTtJQUFBbEcsS0FBQSxFQUVELFNBQUE2Tyx5QkFBeUJDLG9CQUFvQixFQUFFQyxtQkFBbUIsRUFBRUMseUJBQXlCLEVBQUU7TUFDN0Y7TUFDQSxJQUFJLENBQUNDLGNBQWMsR0FBR0gsb0JBQW9CO01BQzFDO01BQ0EsSUFBSSxDQUFDSSxhQUFhLEdBQUdILG1CQUFtQjtNQUN4QztNQUNBLElBQUksQ0FBQ0ksbUJBQW1CLEdBQUdILHlCQUF5QjtJQUN0RDtFQUFDO0lBQUE5SSxHQUFBO0lBQUFsRyxLQUFBLEVBRUQsU0FBQW9QLGNBQWNDLEtBQUssRUFBRTtNQUNuQixJQUFJLENBQUNBLEtBQUssR0FBR0EsS0FBSztJQUNwQjtFQUFDO0lBQUFuSixHQUFBO0lBQUFsRyxLQUFBLEVBRUQsU0FBQXNQLFFBQUEsRUFBVTtNQUFBLElBQUFDLE1BQUE7TUFDUjdHLEtBQUssa0JBQUE4RyxNQUFBLENBQWtCLElBQUksQ0FBQ3BFLFNBQVMsQ0FBRSxDQUFDO01BRXhDLElBQU1xRSxtQkFBbUIsR0FBRyxJQUFJMUssT0FBTyxDQUFDLFVBQUN0QyxPQUFPLEVBQUVzRCxNQUFNLEVBQUs7UUFDM0R3SixNQUFJLENBQUNoRSxFQUFFLEdBQUcsSUFBSW1FLFNBQVMsQ0FBQ0gsTUFBSSxDQUFDbkUsU0FBUyxFQUFFLGdCQUFnQixDQUFDO1FBRXpEbUUsTUFBSSxDQUFDL0QsT0FBTyxHQUFHLElBQUk1RCxFQUFFLENBQUNFLFlBQVksQ0FBQ3lILE1BQUksQ0FBQ2hFLEVBQUUsQ0FBQ3ZELElBQUksQ0FBQzhFLElBQUksQ0FBQ3lDLE1BQUksQ0FBQ2hFLEVBQUUsQ0FBQyxFQUFFO1VBQUVvRSxTQUFTLEVBQUU7UUFBTSxDQUFDLENBQUM7UUFFcEZKLE1BQUksQ0FBQ2hFLEVBQUUsQ0FBQ3BCLGdCQUFnQixDQUFDLE9BQU8sRUFBRW9GLE1BQUksQ0FBQ3hDLGdCQUFnQixDQUFDO1FBQ3hEd0MsTUFBSSxDQUFDaEUsRUFBRSxDQUFDcEIsZ0JBQWdCLENBQUMsU0FBUyxFQUFFb0YsTUFBSSxDQUFDdkMsa0JBQWtCLENBQUM7UUFFNUR1QyxNQUFJLENBQUNLLFFBQVEsR0FBRyxZQUFNO1VBQ3BCTCxNQUFJLENBQUNoRSxFQUFFLENBQUNyQixtQkFBbUIsQ0FBQyxNQUFNLEVBQUVxRixNQUFJLENBQUNLLFFBQVEsQ0FBQztVQUNsREwsTUFBSSxDQUFDMUMsZUFBZSxDQUFDLENBQUMsQ0FDbkJsSyxJQUFJLENBQUNGLE9BQU8sQ0FBQyxTQUNSLENBQUNzRCxNQUFNLENBQUM7UUFDbEIsQ0FBQztRQUVEd0osTUFBSSxDQUFDaEUsRUFBRSxDQUFDcEIsZ0JBQWdCLENBQUMsTUFBTSxFQUFFb0YsTUFBSSxDQUFDSyxRQUFRLENBQUM7TUFDakQsQ0FBQyxDQUFDO01BRUYsT0FBTzdLLE9BQU8sQ0FBQzhLLEdBQUcsQ0FBQyxDQUFDSixtQkFBbUIsRUFBRSxJQUFJLENBQUNLLGdCQUFnQixDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ3BFO0VBQUM7SUFBQTVKLEdBQUE7SUFBQWxHLEtBQUEsRUFFRCxTQUFBK1AsV0FBQSxFQUFhO01BQ1hySCxLQUFLLGdCQUFnQixDQUFDO01BRXRCc0gsWUFBWSxDQUFDLElBQUksQ0FBQ25FLG1CQUFtQixDQUFDO01BRXRDLElBQUksQ0FBQ29FLGtCQUFrQixDQUFDLENBQUM7TUFDekIsSUFBSSxDQUFDL0QsYUFBYSxHQUFHLElBQUlDLEdBQUcsQ0FBQyxDQUFDO01BRTlCLElBQUksSUFBSSxDQUFDSCxTQUFTLEVBQUU7UUFDbEI7UUFDQSxJQUFJLENBQUNBLFNBQVMsQ0FBQ2tFLElBQUksQ0FBQ0MsS0FBSyxDQUFDLENBQUM7UUFDM0IsSUFBSSxDQUFDbkUsU0FBUyxHQUFHLElBQUk7TUFDdkI7TUFFQSxJQUFJLElBQUksQ0FBQ1IsT0FBTyxFQUFFO1FBQ2hCLElBQUksQ0FBQ0EsT0FBTyxDQUFDNEUsT0FBTyxDQUFDLENBQUM7UUFDdEIsSUFBSSxDQUFDNUUsT0FBTyxHQUFHLElBQUk7TUFDckI7TUFFQSxJQUFJLElBQUksQ0FBQ0QsRUFBRSxFQUFFO1FBQ1gsSUFBSSxDQUFDQSxFQUFFLENBQUNyQixtQkFBbUIsQ0FBQyxNQUFNLEVBQUUsSUFBSSxDQUFDMEYsUUFBUSxDQUFDO1FBQ2xELElBQUksQ0FBQ3JFLEVBQUUsQ0FBQ3JCLG1CQUFtQixDQUFDLE9BQU8sRUFBRSxJQUFJLENBQUM2QyxnQkFBZ0IsQ0FBQztRQUMzRCxJQUFJLENBQUN4QixFQUFFLENBQUNyQixtQkFBbUIsQ0FBQyxTQUFTLEVBQUUsSUFBSSxDQUFDOEMsa0JBQWtCLENBQUM7UUFDL0QsSUFBSSxDQUFDekIsRUFBRSxDQUFDNEUsS0FBSyxDQUFDLENBQUM7UUFDZixJQUFJLENBQUM1RSxFQUFFLEdBQUcsSUFBSTtNQUNoQjs7TUFFQTtNQUNBO01BQ0E7TUFDQSxJQUFJLElBQUksQ0FBQzhFLHVCQUF1QixFQUFFO1FBQ2hDTCxZQUFZLENBQUMsSUFBSSxDQUFDSyx1QkFBdUIsQ0FBQztRQUMxQyxJQUFJLENBQUNBLHVCQUF1QixHQUFHLElBQUk7TUFDckM7SUFDRjtFQUFDO0lBQUFuSyxHQUFBO0lBQUFsRyxLQUFBLEVBRUQsU0FBQXNRLGVBQUEsRUFBaUI7TUFDZixPQUFPLElBQUksQ0FBQy9FLEVBQUUsS0FBSyxJQUFJO0lBQ3pCO0VBQUM7SUFBQXJGLEdBQUE7SUFBQWxHLEtBQUE7TUFBQSxJQUFBdVEsZ0JBQUEsR0FBQWxLLGlCQUFBLGVBQUEvRyxtQkFBQSxHQUFBb0YsSUFBQSxDQUVELFNBQUE4TCxRQUFBO1FBQUEsSUFBQUMsbUJBQUEsRUFBQXhRLENBQUEsRUFBQXlRLFVBQUE7UUFBQSxPQUFBcFIsbUJBQUEsR0FBQXVCLElBQUEsVUFBQThQLFNBQUFDLFFBQUE7VUFBQSxrQkFBQUEsUUFBQSxDQUFBekwsSUFBQSxHQUFBeUwsUUFBQSxDQUFBcE4sSUFBQTtZQUFBO2NBQUFvTixRQUFBLENBQUFwTixJQUFBO2NBQUEsT0FFUSxJQUFJLENBQUNnSSxPQUFPLENBQUN6SyxNQUFNLENBQUMsQ0FBQztZQUFBO2NBQUE2UCxRQUFBLENBQUFwTixJQUFBO2NBQUEsT0FLSixJQUFJLENBQUNxTixlQUFlLENBQUMsQ0FBQztZQUFBO2NBQTdDLElBQUksQ0FBQzdFLFNBQVMsR0FBQTRFLFFBQUEsQ0FBQTFOLElBQUE7Y0FFZDtjQUNBLElBQUksQ0FBQytLLGNBQWMsQ0FBQyxJQUFJLENBQUMvQyxRQUFRLENBQUM7Y0FFNUJ1RixtQkFBbUIsR0FBRyxFQUFFO2NBRXJCeFEsQ0FBQyxHQUFHLENBQUM7WUFBQTtjQUFBLE1BQUVBLENBQUMsR0FBRyxJQUFJLENBQUMrTCxTQUFTLENBQUM4RSxnQkFBZ0IsQ0FBQ3pNLE1BQU07Z0JBQUF1TSxRQUFBLENBQUFwTixJQUFBO2dCQUFBO2NBQUE7Y0FDbERrTixVQUFVLEdBQUcsSUFBSSxDQUFDMUUsU0FBUyxDQUFDOEUsZ0JBQWdCLENBQUM3USxDQUFDLENBQUM7Y0FBQSxNQUNqRHlRLFVBQVUsS0FBSyxJQUFJLENBQUN4RixRQUFRO2dCQUFBMEYsUUFBQSxDQUFBcE4sSUFBQTtnQkFBQTtjQUFBO2NBQUEsT0FBQW9OLFFBQUEsQ0FBQXZOLE1BQUE7WUFBQTtjQUFZO2NBQzVDb04sbUJBQW1CLENBQUN6TSxJQUFJLENBQUMsSUFBSSxDQUFDK00sV0FBVyxDQUFDTCxVQUFVLENBQUMsQ0FBQztZQUFDO2NBSEd6USxDQUFDLEVBQUU7Y0FBQTJRLFFBQUEsQ0FBQXBOLElBQUE7Y0FBQTtZQUFBO2NBQUFvTixRQUFBLENBQUFwTixJQUFBO2NBQUEsT0FNekR1QixPQUFPLENBQUM4SyxHQUFHLENBQUNZLG1CQUFtQixDQUFDO1lBQUE7WUFBQTtjQUFBLE9BQUFHLFFBQUEsQ0FBQXRMLElBQUE7VUFBQTtRQUFBLEdBQUFrTCxPQUFBO01BQUEsQ0FDdkM7TUFBQSxTQUFBM0QsZ0JBQUE7UUFBQSxPQUFBMEQsZ0JBQUEsQ0FBQTdKLEtBQUEsT0FBQUQsU0FBQTtNQUFBO01BQUEsT0FBQW9HLGVBQUE7SUFBQTtFQUFBO0lBQUEzRyxHQUFBO0lBQUFsRyxLQUFBLEVBRUQsU0FBQStNLGlCQUFpQmlFLEtBQUssRUFBRTtNQUFBLElBQUFDLE1BQUE7TUFDdEI7TUFDQSxJQUFJRCxLQUFLLENBQUNFLElBQUksS0FBS25HLGlCQUFpQixFQUFFO1FBQ3BDO01BQ0Y7TUFFQTNDLE9BQU8sQ0FBQ1EsSUFBSSxDQUFDLHNDQUFzQyxDQUFDO01BQ3BELElBQUksSUFBSSxDQUFDcUcsY0FBYyxFQUFFO1FBQ3ZCLElBQUksQ0FBQ0EsY0FBYyxDQUFDLElBQUksQ0FBQ3JELGlCQUFpQixDQUFDO01BQzdDO01BRUEsSUFBSSxDQUFDQyxtQkFBbUIsR0FBR3NGLFVBQVUsQ0FBQztRQUFBLE9BQU1GLE1BQUksQ0FBQ3pJLFNBQVMsQ0FBQyxDQUFDO01BQUEsR0FBRSxJQUFJLENBQUNvRCxpQkFBaUIsQ0FBQztJQUN2RjtFQUFDO0lBQUExRixHQUFBO0lBQUFsRyxLQUFBLEVBRUQsU0FBQXdJLFVBQUEsRUFBWTtNQUFBLElBQUE0SSxNQUFBO01BQ1Y7TUFDQSxJQUFJLENBQUNyQixVQUFVLENBQUMsQ0FBQztNQUVqQixJQUFJLENBQUNULE9BQU8sQ0FBQyxDQUFDLENBQ1gzTSxJQUFJLENBQUMsWUFBTTtRQUNWeU8sTUFBSSxDQUFDeEYsaUJBQWlCLEdBQUd3RixNQUFJLENBQUN6Rix3QkFBd0I7UUFDdER5RixNQUFJLENBQUNyRixvQkFBb0IsR0FBRyxDQUFDO1FBRTdCLElBQUlxRixNQUFJLENBQUNsQyxhQUFhLEVBQUU7VUFDdEJrQyxNQUFJLENBQUNsQyxhQUFhLENBQUMsQ0FBQztRQUN0QjtNQUNGLENBQUMsQ0FBQyxTQUNJLENBQUMsVUFBQTlJLEtBQUssRUFBSTtRQUNkZ0wsTUFBSSxDQUFDeEYsaUJBQWlCLElBQUksSUFBSTtRQUM5QndGLE1BQUksQ0FBQ3JGLG9CQUFvQixFQUFFO1FBRTNCLElBQUlxRixNQUFJLENBQUNyRixvQkFBb0IsR0FBR3FGLE1BQUksQ0FBQ3RGLHVCQUF1QixJQUFJc0YsTUFBSSxDQUFDakMsbUJBQW1CLEVBQUU7VUFDeEYsT0FBT2lDLE1BQUksQ0FBQ2pDLG1CQUFtQixDQUM3QixJQUFJdE0sS0FBSyxDQUFDLDBGQUEwRixDQUN0RyxDQUFDO1FBQ0g7UUFFQXVGLE9BQU8sQ0FBQ1EsSUFBSSxDQUFDLG1DQUFtQyxDQUFDO1FBQ2pEUixPQUFPLENBQUNRLElBQUksQ0FBQ3hDLEtBQUssQ0FBQztRQUVuQixJQUFJZ0wsTUFBSSxDQUFDbkMsY0FBYyxFQUFFO1VBQ3ZCbUMsTUFBSSxDQUFDbkMsY0FBYyxDQUFDbUMsTUFBSSxDQUFDeEYsaUJBQWlCLENBQUM7UUFDN0M7UUFFQXdGLE1BQUksQ0FBQ3ZGLG1CQUFtQixHQUFHc0YsVUFBVSxDQUFDO1VBQUEsT0FBTUMsTUFBSSxDQUFDNUksU0FBUyxDQUFDLENBQUM7UUFBQSxHQUFFNEksTUFBSSxDQUFDeEYsaUJBQWlCLENBQUM7TUFDdkYsQ0FBQyxDQUFDO0lBQ047RUFBQztJQUFBMUYsR0FBQTtJQUFBbEcsS0FBQSxFQUVELFNBQUFxUix3QkFBQSxFQUEwQjtNQUFBLElBQUFDLE1BQUE7TUFDeEIsSUFBSSxJQUFJLENBQUNqQix1QkFBdUIsRUFBRTtRQUNoQ0wsWUFBWSxDQUFDLElBQUksQ0FBQ0ssdUJBQXVCLENBQUM7TUFDNUM7TUFFQSxJQUFJLENBQUNBLHVCQUF1QixHQUFHYyxVQUFVLENBQUMsWUFBTTtRQUM5Q0csTUFBSSxDQUFDakIsdUJBQXVCLEdBQUcsSUFBSTtRQUNuQ2lCLE1BQUksQ0FBQzlJLFNBQVMsQ0FBQyxDQUFDO01BQ2xCLENBQUMsRUFBRSxLQUFLLENBQUM7SUFDWDtFQUFDO0lBQUF0QyxHQUFBO0lBQUFsRyxLQUFBLEVBRUQsU0FBQWdOLG1CQUFtQmdFLEtBQUssRUFBRTtNQUN4QixJQUFJLENBQUN4RixPQUFPLENBQUMrRixPQUFPLENBQUNDLElBQUksQ0FBQ0MsS0FBSyxDQUFDVCxLQUFLLENBQUNVLElBQUksQ0FBQyxDQUFDO0lBQzlDO0VBQUM7SUFBQXhMLEdBQUE7SUFBQWxHLEtBQUE7TUFBQSxJQUFBMlIsWUFBQSxHQUFBdEwsaUJBQUEsZUFBQS9HLG1CQUFBLEdBQUFvRixJQUFBLENBRUQsU0FBQWtOLFNBQWtCbEIsVUFBVTtRQUFBLElBQUFtQixVQUFBO1FBQUEsT0FBQXZTLG1CQUFBLEdBQUF1QixJQUFBLFVBQUFpUixVQUFBQyxTQUFBO1VBQUEsa0JBQUFBLFNBQUEsQ0FBQTVNLElBQUEsR0FBQTRNLFNBQUEsQ0FBQXZPLElBQUE7WUFBQTtjQUMxQixJQUFJLElBQUksQ0FBQ3lJLFNBQVMsQ0FBQ3lFLFVBQVUsQ0FBQyxFQUFFO2dCQUM5QixJQUFJLENBQUNzQixjQUFjLENBQUN0QixVQUFVLENBQUM7Y0FDakM7Y0FFQSxJQUFJLENBQUN4RSxhQUFhLFVBQU8sQ0FBQ3dFLFVBQVUsQ0FBQztjQUFDcUIsU0FBQSxDQUFBdk8sSUFBQTtjQUFBLE9BRWYsSUFBSSxDQUFDeU8sZ0JBQWdCLENBQUN2QixVQUFVLENBQUM7WUFBQTtjQUFwRG1CLFVBQVUsR0FBQUUsU0FBQSxDQUFBN08sSUFBQTtjQUFBLElBRVQyTyxVQUFVO2dCQUFBRSxTQUFBLENBQUF2TyxJQUFBO2dCQUFBO2NBQUE7Y0FBQSxPQUFBdU8sU0FBQSxDQUFBMU8sTUFBQTtZQUFBO2NBRWYsSUFBSSxDQUFDNEksU0FBUyxDQUFDeUUsVUFBVSxDQUFDLEdBQUdtQixVQUFVO2NBRXZDLElBQUksQ0FBQ0ssY0FBYyxDQUFDeEIsVUFBVSxFQUFFbUIsVUFBVSxDQUFDTSxXQUFXLENBQUM7O2NBRXZEO2NBQ0EsSUFBSSxDQUFDekQsbUJBQW1CLENBQUNnQyxVQUFVLENBQUM7Y0FDcEMsSUFBSSxDQUFDckMsa0JBQWtCLENBQUMsSUFBSSxDQUFDcEMsU0FBUyxDQUFDO2NBQUMsT0FBQThGLFNBQUEsQ0FBQTFPLE1BQUEsV0FFakN3TyxVQUFVO1lBQUE7WUFBQTtjQUFBLE9BQUFFLFNBQUEsQ0FBQXpNLElBQUE7VUFBQTtRQUFBLEdBQUFzTSxRQUFBO01BQUEsQ0FDbEI7TUFBQSxTQUFBYixZQUFBcUIsRUFBQTtRQUFBLE9BQUFULFlBQUEsQ0FBQWpMLEtBQUEsT0FBQUQsU0FBQTtNQUFBO01BQUEsT0FBQXNLLFdBQUE7SUFBQTtFQUFBO0lBQUE3SyxHQUFBO0lBQUFsRyxLQUFBLEVBRUQsU0FBQWlRLG1CQUFBLEVBQXFCO01BQUEsSUFBQW9DLFNBQUEsR0FBQUMsMEJBQUEsQ0FDTTVTLE1BQU0sQ0FBQzZTLG1CQUFtQixDQUFDLElBQUksQ0FBQ3RHLFNBQVMsQ0FBQztRQUFBdUcsS0FBQTtNQUFBO1FBQW5FLEtBQUFILFNBQUEsQ0FBQTVRLENBQUEsTUFBQStRLEtBQUEsR0FBQUgsU0FBQSxDQUFBelMsQ0FBQSxJQUFBa0QsSUFBQSxHQUFxRTtVQUFBLElBQTFENE4sVUFBVSxHQUFBOEIsS0FBQSxDQUFBeFMsS0FBQTtVQUNuQixJQUFJLENBQUNnUyxjQUFjLENBQUN0QixVQUFVLENBQUM7UUFDakM7TUFBQyxTQUFBL0osR0FBQTtRQUFBMEwsU0FBQSxDQUFBOVMsQ0FBQSxDQUFBb0gsR0FBQTtNQUFBO1FBQUEwTCxTQUFBLENBQUE3USxDQUFBO01BQUE7SUFDSDtFQUFDO0lBQUEwRSxHQUFBO0lBQUFsRyxLQUFBLEVBRUQsU0FBQWdTLGVBQWV0QixVQUFVLEVBQUU7TUFDekIsSUFBSSxDQUFDeEUsYUFBYSxDQUFDdUcsR0FBRyxDQUFDL0IsVUFBVSxDQUFDO01BRWxDLElBQUksSUFBSSxDQUFDekUsU0FBUyxDQUFDeUUsVUFBVSxDQUFDLEVBQUU7UUFDOUI7UUFDQSxJQUFJLENBQUN6RSxTQUFTLENBQUN5RSxVQUFVLENBQUMsQ0FBQ1IsSUFBSSxDQUFDQyxLQUFLLENBQUMsQ0FBQztRQUN2QyxPQUFPLElBQUksQ0FBQ2xFLFNBQVMsQ0FBQ3lFLFVBQVUsQ0FBQztNQUNuQztNQUVBLElBQUksSUFBSSxDQUFDdEUsWUFBWSxDQUFDc0UsVUFBVSxDQUFDLEVBQUU7UUFDakMsT0FBTyxJQUFJLENBQUN0RSxZQUFZLENBQUNzRSxVQUFVLENBQUM7TUFDdEM7TUFFQSxJQUFJLElBQUksQ0FBQ3BFLG9CQUFvQixDQUFDb0csR0FBRyxDQUFDaEMsVUFBVSxDQUFDLEVBQUU7UUFDN0MsSUFBTWlDLEdBQUcsR0FBRyw2REFBNkQ7UUFDekUsSUFBSSxDQUFDckcsb0JBQW9CLENBQUNzRyxHQUFHLENBQUNsQyxVQUFVLENBQUMsQ0FBQ21DLEtBQUssQ0FBQzlNLE1BQU0sQ0FBQzRNLEdBQUcsQ0FBQztRQUMzRCxJQUFJLENBQUNyRyxvQkFBb0IsQ0FBQ3NHLEdBQUcsQ0FBQ2xDLFVBQVUsQ0FBQyxDQUFDckcsS0FBSyxDQUFDdEUsTUFBTSxDQUFDNE0sR0FBRyxDQUFDO1FBQzNELElBQUksQ0FBQ3JHLG9CQUFvQixVQUFPLENBQUNvRSxVQUFVLENBQUM7TUFDOUM7O01BRUE7TUFDQSxJQUFJLENBQUMvQixzQkFBc0IsQ0FBQytCLFVBQVUsQ0FBQztNQUN2QyxJQUFJLENBQUNyQyxrQkFBa0IsQ0FBQyxJQUFJLENBQUNwQyxTQUFTLENBQUM7SUFDekM7RUFBQztJQUFBL0YsR0FBQTtJQUFBbEcsS0FBQSxFQUVELFNBQUE4UyxVQUFVNUMsSUFBSSxFQUFFMUssTUFBTSxFQUFFO01BQUEsSUFBQXVOLE1BQUE7TUFDdEI3QyxJQUFJLENBQUMvRixnQkFBZ0IsQ0FBQyxjQUFjLEVBQUUsVUFBQTZJLEVBQUUsRUFBSTtRQUMxQ3hOLE1BQU0sQ0FBQ3lOLFdBQVcsQ0FBQ0QsRUFBRSxDQUFDRSxTQUFTLElBQUksSUFBSSxDQUFDLFNBQU0sQ0FBQyxVQUFBM1QsQ0FBQztVQUFBLE9BQUk2RyxLQUFLLENBQUMseUJBQXlCLEVBQUU3RyxDQUFDLENBQUM7UUFBQSxFQUFDO01BQzFGLENBQUMsQ0FBQztNQUNGMlEsSUFBSSxDQUFDL0YsZ0JBQWdCLENBQUMsMEJBQTBCLEVBQUUsVUFBQTZJLEVBQUUsRUFBSTtRQUN0RCxJQUFJOUMsSUFBSSxDQUFDaUQsa0JBQWtCLEtBQUssV0FBVyxFQUFFO1VBQzNDL0ssT0FBTyxDQUFDTyxHQUFHLENBQUMsZ0NBQWdDLENBQUM7UUFDL0M7UUFDQSxJQUFJdUgsSUFBSSxDQUFDaUQsa0JBQWtCLEtBQUssY0FBYyxFQUFFO1VBQzlDL0ssT0FBTyxDQUFDUSxJQUFJLENBQUMsbUNBQW1DLENBQUM7UUFDbkQ7UUFDQSxJQUFJc0gsSUFBSSxDQUFDaUQsa0JBQWtCLEtBQUssUUFBUSxFQUFFO1VBQ3hDL0ssT0FBTyxDQUFDUSxJQUFJLENBQUMsNENBQTRDLENBQUM7VUFDMURtSyxNQUFJLENBQUMxQix1QkFBdUIsQ0FBQyxDQUFDO1FBQ2hDO01BQ0YsQ0FBQyxDQUFDOztNQUVGO01BQ0E7TUFDQTtNQUNBO01BQ0FuQixJQUFJLENBQUMvRixnQkFBZ0IsQ0FDbkIsbUJBQW1CLEVBQ25CakIsUUFBUSxDQUFDLFVBQUE4SixFQUFFLEVBQUk7UUFDYnRLLEtBQUssQ0FBQyxrQ0FBa0MsRUFBRWxELE1BQU0sQ0FBQztRQUNqRCxJQUFJNE4sS0FBSyxHQUFHbEQsSUFBSSxDQUFDbUQsV0FBVyxDQUFDLENBQUMsQ0FBQzFRLElBQUksQ0FBQ29RLE1BQUksQ0FBQ08scUJBQXFCLENBQUMsQ0FBQzNRLElBQUksQ0FBQ29RLE1BQUksQ0FBQ1EsaUJBQWlCLENBQUM7UUFDNUYsSUFBSUMsS0FBSyxHQUFHSixLQUFLLENBQUN6USxJQUFJLENBQUMsVUFBQTdDLENBQUM7VUFBQSxPQUFJb1EsSUFBSSxDQUFDdUQsbUJBQW1CLENBQUMzVCxDQUFDLENBQUM7UUFBQSxFQUFDO1FBQ3hELElBQUk0VCxNQUFNLEdBQUdOLEtBQUs7UUFFbEJNLE1BQU0sR0FBR0EsTUFBTSxDQUNaL1EsSUFBSSxDQUFDb1EsTUFBSSxDQUFDUSxpQkFBaUIsQ0FBQyxDQUM1QjVRLElBQUksQ0FBQyxVQUFBZ1IsQ0FBQztVQUFBLE9BQUluTyxNQUFNLENBQUNvTyxRQUFRLENBQUNELENBQUMsQ0FBQztRQUFBLEVBQUMsQ0FDN0JoUixJQUFJLENBQUMsVUFBQWxELENBQUM7VUFBQSxPQUFJeVEsSUFBSSxDQUFDMkQsb0JBQW9CLENBQUNwVSxDQUFDLENBQUNxVSxJQUFJLENBQUM7UUFBQSxFQUFDO1FBQy9DLE9BQU8vTyxPQUFPLENBQUM4SyxHQUFHLENBQUMsQ0FBQzJELEtBQUssRUFBRUUsTUFBTSxDQUFDLENBQUMsU0FBTSxDQUFDLFVBQUFuVSxDQUFDO1VBQUEsT0FBSTZHLEtBQUssQ0FBQyw2QkFBNkIsRUFBRTdHLENBQUMsQ0FBQztRQUFBLEVBQUM7TUFDekYsQ0FBQyxDQUNILENBQUM7TUFDRGlHLE1BQU0sQ0FBQ3VPLEVBQUUsQ0FDUCxPQUFPLEVBQ1A3SyxRQUFRLENBQUMsVUFBQThKLEVBQUUsRUFBSTtRQUNiLElBQUljLElBQUksR0FBR2QsRUFBRSxDQUFDYyxJQUFJO1FBQ2xCLElBQUlBLElBQUksSUFBSUEsSUFBSSxDQUFDM1MsSUFBSSxJQUFJLE9BQU8sRUFBRTtVQUNoQ3VILEtBQUssQ0FBQyxvQ0FBb0MsRUFBRWxELE1BQU0sQ0FBQztVQUNuRCxJQUFJd08sTUFBTSxHQUFHOUQsSUFBSSxDQUNkMkQsb0JBQW9CLENBQUNkLE1BQUksQ0FBQ2tCLHNCQUFzQixDQUFDSCxJQUFJLENBQUMsQ0FBQyxDQUN2RG5SLElBQUksQ0FBQyxVQUFBMkcsQ0FBQztZQUFBLE9BQUk0RyxJQUFJLENBQUNnRSxZQUFZLENBQUMsQ0FBQztVQUFBLEVBQUMsQ0FDOUJ2UixJQUFJLENBQUNvUSxNQUFJLENBQUNRLGlCQUFpQixDQUFDO1VBQy9CLElBQUlDLEtBQUssR0FBR1EsTUFBTSxDQUFDclIsSUFBSSxDQUFDLFVBQUF4QyxDQUFDO1lBQUEsT0FBSStQLElBQUksQ0FBQ3VELG1CQUFtQixDQUFDdFQsQ0FBQyxDQUFDO1VBQUEsRUFBQztVQUN6RCxJQUFJdVQsTUFBTSxHQUFHTSxNQUFNLENBQUNyUixJQUFJLENBQUMsVUFBQWdSLENBQUM7WUFBQSxPQUFJbk8sTUFBTSxDQUFDb08sUUFBUSxDQUFDRCxDQUFDLENBQUM7VUFBQSxFQUFDO1VBQ2pELE9BQU81TyxPQUFPLENBQUM4SyxHQUFHLENBQUMsQ0FBQzJELEtBQUssRUFBRUUsTUFBTSxDQUFDLENBQUMsU0FBTSxDQUFDLFVBQUFuVSxDQUFDO1lBQUEsT0FBSTZHLEtBQUssQ0FBQyw4QkFBOEIsRUFBRTdHLENBQUMsQ0FBQztVQUFBLEVBQUM7UUFDMUYsQ0FBQyxNQUFNO1VBQ0w7VUFDQSxPQUFPLElBQUk7UUFDYjtNQUNGLENBQUMsQ0FDSCxDQUFDO0lBQ0g7RUFBQztJQUFBMkcsR0FBQTtJQUFBbEcsS0FBQTtNQUFBLElBQUFtVSxnQkFBQSxHQUFBOU4saUJBQUEsZUFBQS9HLG1CQUFBLEdBQUFvRixJQUFBLENBRUQsU0FBQTBQLFNBQUE7UUFBQSxJQUFBQyxNQUFBO1FBQUEsSUFBQTdPLE1BQUEsRUFBQTBLLElBQUEsRUFBQW9FLFFBQUEsRUFBQUMsZUFBQSxFQUFBQyxpQkFBQSxFQUFBdE0sT0FBQSxFQUFBdkIsR0FBQSxFQUFBbUssZ0JBQUE7UUFBQSxPQUFBeFIsbUJBQUEsR0FBQXVCLElBQUEsVUFBQTRULFVBQUFDLFNBQUE7VUFBQSxrQkFBQUEsU0FBQSxDQUFBdlAsSUFBQSxHQUFBdVAsU0FBQSxDQUFBbFIsSUFBQTtZQUFBO2NBQ01nQyxNQUFNLEdBQUcsSUFBSW9DLEVBQUUsQ0FBQytNLGlCQUFpQixDQUFDLElBQUksQ0FBQ25KLE9BQU8sQ0FBQztjQUMvQzBFLElBQUksR0FBRyxJQUFJMEUsaUJBQWlCLENBQUMsSUFBSSxDQUFDdEosb0JBQW9CLElBQUlWLDhCQUE4QixDQUFDO2NBRTdGbEMsS0FBSyxDQUFDLHFCQUFxQixDQUFDO2NBQUNnTSxTQUFBLENBQUFsUixJQUFBO2NBQUEsT0FDdkJnQyxNQUFNLENBQUNxUCxNQUFNLENBQUMsa0JBQWtCLEVBQUUsSUFBSSxDQUFDeEYsS0FBSyxJQUFJLElBQUksQ0FBQ25FLFFBQVEsR0FBRzRKLFFBQVEsQ0FBQyxJQUFJLENBQUM1SixRQUFRLENBQUMsR0FBRyxJQUFJLENBQUNtRSxLQUFLLEdBQUd6SSxTQUFTLENBQUM7WUFBQTtjQUV2SCxJQUFJLENBQUNrTSxTQUFTLENBQUM1QyxJQUFJLEVBQUUxSyxNQUFNLENBQUM7Y0FFNUJrRCxLQUFLLENBQUMsMENBQTBDLENBQUM7Y0FDN0M0TCxRQUFRLEdBQUcsSUFBSXZQLE9BQU8sQ0FBQyxVQUFBdEMsT0FBTztnQkFBQSxPQUFJK0MsTUFBTSxDQUFDdU8sRUFBRSxDQUFDLFVBQVUsRUFBRXRSLE9BQU8sQ0FBQztjQUFBLEVBQUMsRUFFckU7Y0FDQTtjQUNJOFIsZUFBZSxHQUFHckUsSUFBSSxDQUFDNkUsaUJBQWlCLENBQUMsVUFBVSxFQUFFO2dCQUFFQyxPQUFPLEVBQUU7Y0FBSyxDQUFDLENBQUM7Y0FDdkVSLGlCQUFpQixHQUFHdEUsSUFBSSxDQUFDNkUsaUJBQWlCLENBQUMsWUFBWSxFQUFFO2dCQUMzREMsT0FBTyxFQUFFLEtBQUs7Z0JBQ2RDLGNBQWMsRUFBRTtjQUNsQixDQUFDLENBQUM7Y0FFRlYsZUFBZSxDQUFDcEssZ0JBQWdCLENBQUMsU0FBUyxFQUFFLFVBQUE1SyxDQUFDO2dCQUFBLE9BQUk4VSxNQUFJLENBQUNwSCxvQkFBb0IsQ0FBQzFOLENBQUMsRUFBRSxnQkFBZ0IsQ0FBQztjQUFBLEVBQUM7Y0FDaEdpVixpQkFBaUIsQ0FBQ3JLLGdCQUFnQixDQUFDLFNBQVMsRUFBRSxVQUFBNUssQ0FBQztnQkFBQSxPQUFJOFUsTUFBSSxDQUFDcEgsb0JBQW9CLENBQUMxTixDQUFDLEVBQUUsa0JBQWtCLENBQUM7Y0FBQSxFQUFDO2NBQUNtVixTQUFBLENBQUFsUixJQUFBO2NBQUEsT0FFL0Y4USxRQUFRO1lBQUE7Y0FBQUksU0FBQSxDQUFBbFIsSUFBQTtjQUFBLE9BQ1JvRyxvQkFBb0IsQ0FBQzJLLGVBQWUsQ0FBQztZQUFBO2NBQUFHLFNBQUEsQ0FBQWxSLElBQUE7Y0FBQSxPQUNyQ29HLG9CQUFvQixDQUFDNEssaUJBQWlCLENBQUM7WUFBQTtjQUU3QztjQUNBO2NBQ0E7Y0FDQTtjQUNBO2NBQ0EsSUFBSSxJQUFJLENBQUNuSSxnQkFBZ0IsRUFBRTtnQkFDekIsSUFBSSxDQUFDQSxnQkFBZ0IsQ0FBQzZJLFNBQVMsQ0FBQyxDQUFDLENBQUM5UyxPQUFPLENBQUMsVUFBQStTLEtBQUssRUFBSTtrQkFDakRqRixJQUFJLENBQUNrRixRQUFRLENBQUNELEtBQUssRUFBRWQsTUFBSSxDQUFDaEksZ0JBQWdCLENBQUM7Z0JBQzdDLENBQUMsQ0FBQztjQUNKOztjQUVBO2NBQ0E3RyxNQUFNLENBQUN1TyxFQUFFLENBQUMsT0FBTyxFQUFFLFVBQUFmLEVBQUUsRUFBSTtnQkFDdkIsSUFBSXRCLElBQUksR0FBR3NCLEVBQUUsQ0FBQ3FDLFVBQVUsQ0FBQzNELElBQUk7Z0JBQzdCLElBQUlBLElBQUksQ0FBQ1YsS0FBSyxJQUFJLE1BQU0sSUFBSVUsSUFBSSxDQUFDNEQsT0FBTyxJQUFJakIsTUFBSSxDQUFDcEosSUFBSSxFQUFFO2tCQUNyRCxJQUFJb0osTUFBSSxDQUFDaEUsdUJBQXVCLEVBQUU7b0JBQ2hDO29CQUNBO2tCQUNGO2tCQUNBZ0UsTUFBSSxDQUFDdEQsV0FBVyxDQUFDVyxJQUFJLENBQUM2RCxPQUFPLENBQUM7Z0JBQ2hDLENBQUMsTUFBTSxJQUFJN0QsSUFBSSxDQUFDVixLQUFLLElBQUksT0FBTyxJQUFJVSxJQUFJLENBQUM0RCxPQUFPLElBQUlqQixNQUFJLENBQUNwSixJQUFJLEVBQUU7a0JBQzdEb0osTUFBSSxDQUFDckMsY0FBYyxDQUFDTixJQUFJLENBQUM2RCxPQUFPLENBQUM7Z0JBQ25DLENBQUMsTUFBTSxJQUFJN0QsSUFBSSxDQUFDVixLQUFLLElBQUksU0FBUyxFQUFFO2tCQUNsQzFHLFFBQVEsQ0FBQ2tMLElBQUksQ0FBQ0MsYUFBYSxDQUFDLElBQUlDLFdBQVcsQ0FBQyxTQUFTLEVBQUU7b0JBQUVDLE1BQU0sRUFBRTtzQkFBRXpLLFFBQVEsRUFBRXdHLElBQUksQ0FBQ2tFO29CQUFHO2tCQUFFLENBQUMsQ0FBQyxDQUFDO2dCQUM1RixDQUFDLE1BQU0sSUFBSWxFLElBQUksQ0FBQ1YsS0FBSyxJQUFJLFdBQVcsRUFBRTtrQkFDcEMxRyxRQUFRLENBQUNrTCxJQUFJLENBQUNDLGFBQWEsQ0FBQyxJQUFJQyxXQUFXLENBQUMsV0FBVyxFQUFFO29CQUFFQyxNQUFNLEVBQUU7c0JBQUV6SyxRQUFRLEVBQUV3RyxJQUFJLENBQUNrRTtvQkFBRztrQkFBRSxDQUFDLENBQUMsQ0FBQztnQkFDOUYsQ0FBQyxNQUFNLElBQUlsRSxJQUFJLENBQUNWLEtBQUssS0FBSyxNQUFNLEVBQUU7a0JBQ2hDcUQsTUFBSSxDQUFDbkgsTUFBTSxDQUFDc0UsSUFBSSxDQUFDQyxLQUFLLENBQUNDLElBQUksQ0FBQzhELElBQUksQ0FBQyxFQUFFLGFBQWEsQ0FBQztnQkFDbkQ7Y0FDRixDQUFDLENBQUM7Y0FFRjlNLEtBQUssQ0FBQyxzQkFBc0IsQ0FBQzs7Y0FFN0I7Y0FBQWdNLFNBQUEsQ0FBQWxSLElBQUE7Y0FBQSxPQUNvQixJQUFJLENBQUNxUyxRQUFRLENBQUNyUSxNQUFNLEVBQUU7Z0JBQ3hDc1EsYUFBYSxFQUFFLElBQUk7Z0JBQ25CcEUsSUFBSSxFQUFFO2NBQ1IsQ0FBQyxDQUFDO1lBQUE7Y0FIRXhKLE9BQU8sR0FBQXdNLFNBQUEsQ0FBQXhSLElBQUE7Y0FBQSxJQUtOZ0YsT0FBTyxDQUFDbU4sVUFBVSxDQUFDM0QsSUFBSSxDQUFDcUUsT0FBTztnQkFBQXJCLFNBQUEsQ0FBQWxSLElBQUE7Z0JBQUE7Y0FBQTtjQUM1Qm1ELEdBQUcsR0FBR3VCLE9BQU8sQ0FBQ21OLFVBQVUsQ0FBQzNELElBQUksQ0FBQ3RMLEtBQUs7Y0FDekNnQyxPQUFPLENBQUNoQyxLQUFLLENBQUNPLEdBQUcsQ0FBQztjQUNsQjtjQUNBO2NBQ0E7Y0FDQTtjQUNBO2NBQ0E7Y0FDQTtjQUNBdUosSUFBSSxDQUFDQyxLQUFLLENBQUMsQ0FBQztjQUFDLE1BQ1B4SixHQUFHO1lBQUE7Y0FHUG1LLGdCQUFnQixHQUFHNUksT0FBTyxDQUFDbU4sVUFBVSxDQUFDM0QsSUFBSSxDQUFDc0UsUUFBUSxDQUFDQyxLQUFLLENBQUMsSUFBSSxDQUFDaEwsSUFBSSxDQUFDLElBQUksRUFBRTtjQUU5RSxJQUFJNkYsZ0JBQWdCLENBQUNvRixRQUFRLENBQUMsSUFBSSxDQUFDaEwsUUFBUSxDQUFDLEVBQUU7Z0JBQzVDOUMsT0FBTyxDQUFDUSxJQUFJLENBQUMsd0VBQXdFLENBQUM7Z0JBQ3RGLElBQUksQ0FBQ3lJLHVCQUF1QixDQUFDLENBQUM7Y0FDaEM7Y0FFQTNJLEtBQUssQ0FBQyxpQkFBaUIsQ0FBQztjQUFDLE9BQUFnTSxTQUFBLENBQUFyUixNQUFBLFdBQ2xCO2dCQUNMbUMsTUFBTSxFQUFOQSxNQUFNO2dCQUNOc0wsZ0JBQWdCLEVBQWhCQSxnQkFBZ0I7Z0JBQ2hCeUQsZUFBZSxFQUFmQSxlQUFlO2dCQUNmQyxpQkFBaUIsRUFBakJBLGlCQUFpQjtnQkFDakJ0RSxJQUFJLEVBQUpBO2NBQ0YsQ0FBQztZQUFBO1lBQUE7Y0FBQSxPQUFBd0UsU0FBQSxDQUFBcFAsSUFBQTtVQUFBO1FBQUEsR0FBQThPLFFBQUE7TUFBQSxDQUNGO01BQUEsU0FBQXZELGdCQUFBO1FBQUEsT0FBQXNELGdCQUFBLENBQUF6TixLQUFBLE9BQUFELFNBQUE7TUFBQTtNQUFBLE9BQUFvSyxlQUFBO0lBQUE7RUFBQTtJQUFBM0ssR0FBQTtJQUFBbEcsS0FBQSxFQUVELFNBQUFzVCxzQkFBc0JRLElBQUksRUFBRTtNQUMxQkEsSUFBSSxDQUFDcUMsR0FBRyxHQUFHckMsSUFBSSxDQUFDcUMsR0FBRyxDQUFDQyxPQUFPLENBQUMseUJBQXlCLEVBQUUsVUFBQ0MsSUFBSSxFQUFFQyxFQUFFLEVBQUs7UUFDbkUsSUFBTUMsVUFBVSxHQUFHN1csTUFBTSxDQUFDOFcsTUFBTSxDQUFDL04sUUFBUSxDQUFDZ08sU0FBUyxDQUFDSixJQUFJLENBQUMsRUFBRTVMLGVBQWUsQ0FBQztRQUMzRSxPQUFPaEMsUUFBUSxDQUFDaU8sU0FBUyxDQUFDO1VBQUVDLFdBQVcsRUFBRUwsRUFBRTtVQUFFQyxVQUFVLEVBQUVBO1FBQVcsQ0FBQyxDQUFDO01BQ3hFLENBQUMsQ0FBQztNQUNGLE9BQU96QyxJQUFJO0lBQ2I7RUFBQztJQUFBNU4sR0FBQTtJQUFBbEcsS0FBQSxFQUVELFNBQUFpVSx1QkFBdUJILElBQUksRUFBRTtNQUMzQjtNQUNBLElBQUksQ0FBQzFKLG9CQUFvQixFQUFFO1FBQ3pCLElBQUlyQixTQUFTLENBQUNDLFNBQVMsQ0FBQ2IsT0FBTyxDQUFDLGdCQUFnQixDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUU7VUFDeEQ7VUFDQTJMLElBQUksQ0FBQ3FDLEdBQUcsR0FBR3JDLElBQUksQ0FBQ3FDLEdBQUcsQ0FBQ0MsT0FBTyxDQUFDLGVBQWUsRUFBRSxJQUFJLENBQUM7UUFDcEQ7TUFDRjs7TUFFQTtNQUNBLElBQUlyTixTQUFTLENBQUNDLFNBQVMsQ0FBQ2IsT0FBTyxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFO1FBQ2pEMkwsSUFBSSxDQUFDcUMsR0FBRyxHQUFHckMsSUFBSSxDQUFDcUMsR0FBRyxDQUFDQyxPQUFPLENBQ3pCLDZCQUE2QixFQUM3QixnSkFDRixDQUFDO01BQ0gsQ0FBQyxNQUFNO1FBQ0x0QyxJQUFJLENBQUNxQyxHQUFHLEdBQUdyQyxJQUFJLENBQUNxQyxHQUFHLENBQUNDLE9BQU8sQ0FDekIsNkJBQTZCLEVBQzdCLGdKQUNGLENBQUM7TUFDSDtNQUNBLE9BQU90QyxJQUFJO0lBQ2I7RUFBQztJQUFBNU4sR0FBQTtJQUFBbEcsS0FBQTtNQUFBLElBQUE0VyxrQkFBQSxHQUFBdlEsaUJBQUEsZUFBQS9HLG1CQUFBLEdBQUFvRixJQUFBLENBRUQsU0FBQW1TLFNBQXdCL0MsSUFBSTtRQUFBLE9BQUF4VSxtQkFBQSxHQUFBdUIsSUFBQSxVQUFBaVcsVUFBQUMsU0FBQTtVQUFBLGtCQUFBQSxTQUFBLENBQUE1UixJQUFBLEdBQUE0UixTQUFBLENBQUF2VCxJQUFBO1lBQUE7Y0FDMUI7Y0FDQXNRLElBQUksQ0FBQ3FDLEdBQUcsR0FBR3JDLElBQUksQ0FBQ3FDLEdBQUcsQ0FBQ0MsT0FBTyxDQUFDLHFCQUFxQixFQUFFLGlCQUFpQixDQUFDO2NBQUMsT0FBQVcsU0FBQSxDQUFBMVQsTUFBQSxXQUMvRHlRLElBQUk7WUFBQTtZQUFBO2NBQUEsT0FBQWlELFNBQUEsQ0FBQXpSLElBQUE7VUFBQTtRQUFBLEdBQUF1UixRQUFBO01BQUEsQ0FDWjtNQUFBLFNBQUF0RCxrQkFBQXlELEdBQUE7UUFBQSxPQUFBSixrQkFBQSxDQUFBbFEsS0FBQSxPQUFBRCxTQUFBO01BQUE7TUFBQSxPQUFBOE0saUJBQUE7SUFBQTtFQUFBO0lBQUFyTixHQUFBO0lBQUFsRyxLQUFBO01BQUEsSUFBQWlYLGlCQUFBLEdBQUE1USxpQkFBQSxlQUFBL0csbUJBQUEsR0FBQW9GLElBQUEsQ0FFRCxTQUFBd1MsU0FBdUJ4RyxVQUFVO1FBQUEsSUFBQXlHLE1BQUE7UUFBQSxJQUFBQyxVQUFBO1VBQUE1UixNQUFBO1VBQUEwSyxJQUFBO1VBQUFtSCxZQUFBO1VBQUEvQyxRQUFBO1VBQUFuQyxXQUFBO1VBQUFtRixTQUFBO1VBQUFDLE1BQUEsR0FBQTlRLFNBQUE7UUFBQSxPQUFBbkgsbUJBQUEsR0FBQXVCLElBQUEsVUFBQTJXLFVBQUFDLFNBQUE7VUFBQSxrQkFBQUEsU0FBQSxDQUFBdFMsSUFBQSxHQUFBc1MsU0FBQSxDQUFBalUsSUFBQTtZQUFBO2NBQUU0VCxVQUFVLEdBQUFHLE1BQUEsQ0FBQWxULE1BQUEsUUFBQWtULE1BQUEsUUFBQTNRLFNBQUEsR0FBQTJRLE1BQUEsTUFBRyxDQUFDO2NBQUEsS0FDM0MsSUFBSSxDQUFDckwsYUFBYSxDQUFDd0csR0FBRyxDQUFDaEMsVUFBVSxDQUFDO2dCQUFBK0csU0FBQSxDQUFBalUsSUFBQTtnQkFBQTtjQUFBO2NBQ3BDNEUsT0FBTyxDQUFDUSxJQUFJLENBQUM4SCxVQUFVLEdBQUcsZ0ZBQWdGLENBQUM7Y0FBQyxPQUFBK0csU0FBQSxDQUFBcFUsTUFBQSxXQUNyRyxJQUFJO1lBQUE7Y0FHVG1DLE1BQU0sR0FBRyxJQUFJb0MsRUFBRSxDQUFDK00saUJBQWlCLENBQUMsSUFBSSxDQUFDbkosT0FBTyxDQUFDO2NBQy9DMEUsSUFBSSxHQUFHLElBQUkwRSxpQkFBaUIsQ0FBQyxJQUFJLENBQUN0SixvQkFBb0IsSUFBSVYsOEJBQThCLENBQUM7Y0FFN0ZsQyxLQUFLLENBQUNnSSxVQUFVLEdBQUcsdUJBQXVCLENBQUM7Y0FBQytHLFNBQUEsQ0FBQWpVLElBQUE7Y0FBQSxPQUN0Q2dDLE1BQU0sQ0FBQ3FQLE1BQU0sQ0FBQyxrQkFBa0IsRUFBRSxJQUFJLENBQUN4RixLQUFLLEdBQUd5RixRQUFRLENBQUNwRSxVQUFVLENBQUMsR0FBRyxJQUFJLENBQUNyQixLQUFLLEdBQUd6SSxTQUFTLENBQUM7WUFBQTtjQUVuRyxJQUFJLENBQUNrTSxTQUFTLENBQUM1QyxJQUFJLEVBQUUxSyxNQUFNLENBQUM7Y0FFNUJrRCxLQUFLLENBQUNnSSxVQUFVLEdBQUcsd0JBQXdCLENBQUM7Y0FBQyxLQUV6QyxJQUFJLENBQUN4RSxhQUFhLENBQUN3RyxHQUFHLENBQUNoQyxVQUFVLENBQUM7Z0JBQUErRyxTQUFBLENBQUFqVSxJQUFBO2dCQUFBO2NBQUE7Y0FDcEMwTSxJQUFJLENBQUNDLEtBQUssQ0FBQyxDQUFDO2NBQ1ovSCxPQUFPLENBQUNRLElBQUksQ0FBQzhILFVBQVUsR0FBRyw2REFBNkQsQ0FBQztjQUFDLE9BQUErRyxTQUFBLENBQUFwVSxNQUFBLFdBQ2xGLElBQUk7WUFBQTtjQUdUZ1UsWUFBWSxHQUFHLEtBQUs7Y0FFbEIvQyxRQUFRLEdBQUcsSUFBSXZQLE9BQU8sQ0FBQyxVQUFBdEMsT0FBTyxFQUFJO2dCQUN0QyxJQUFNaVYsWUFBWSxHQUFHQyxXQUFXLENBQUMsWUFBTTtrQkFDckMsSUFBSVIsTUFBSSxDQUFDakwsYUFBYSxDQUFDd0csR0FBRyxDQUFDaEMsVUFBVSxDQUFDLEVBQUU7b0JBQ3RDa0gsYUFBYSxDQUFDRixZQUFZLENBQUM7b0JBQzNCalYsT0FBTyxDQUFDLENBQUM7a0JBQ1g7Z0JBQ0YsQ0FBQyxFQUFFLElBQUksQ0FBQztnQkFFUixJQUFNb1YsT0FBTyxHQUFHMUcsVUFBVSxDQUFDLFlBQU07a0JBQy9CeUcsYUFBYSxDQUFDRixZQUFZLENBQUM7a0JBQzNCTCxZQUFZLEdBQUcsSUFBSTtrQkFDbkI1VSxPQUFPLENBQUMsQ0FBQztnQkFDWCxDQUFDLEVBQUV3RyxvQkFBb0IsQ0FBQztnQkFFeEJ6RCxNQUFNLENBQUN1TyxFQUFFLENBQUMsVUFBVSxFQUFFLFlBQU07a0JBQzFCL0QsWUFBWSxDQUFDNkgsT0FBTyxDQUFDO2tCQUNyQkQsYUFBYSxDQUFDRixZQUFZLENBQUM7a0JBQzNCalYsT0FBTyxDQUFDLENBQUM7Z0JBQ1gsQ0FBQyxDQUFDO2NBQ0osQ0FBQyxDQUFDLEVBRUY7Y0FDQTtjQUFBZ1YsU0FBQSxDQUFBalUsSUFBQTtjQUFBLE9BQ00sSUFBSSxDQUFDcVMsUUFBUSxDQUFDclEsTUFBTSxFQUFFO2dCQUFFc1MsS0FBSyxFQUFFcEg7Y0FBVyxDQUFDLENBQUM7WUFBQTtjQUFBLEtBRTlDLElBQUksQ0FBQ3hFLGFBQWEsQ0FBQ3dHLEdBQUcsQ0FBQ2hDLFVBQVUsQ0FBQztnQkFBQStHLFNBQUEsQ0FBQWpVLElBQUE7Z0JBQUE7Y0FBQTtjQUNwQzBNLElBQUksQ0FBQ0MsS0FBSyxDQUFDLENBQUM7Y0FDWi9ILE9BQU8sQ0FBQ1EsSUFBSSxDQUFDOEgsVUFBVSxHQUFHLDJEQUEyRCxDQUFDO2NBQUMsT0FBQStHLFNBQUEsQ0FBQXBVLE1BQUEsV0FDaEYsSUFBSTtZQUFBO2NBR2JxRixLQUFLLENBQUNnSSxVQUFVLEdBQUcsNEJBQTRCLENBQUM7Y0FBQytHLFNBQUEsQ0FBQWpVLElBQUE7Y0FBQSxPQUMzQzhRLFFBQVE7WUFBQTtjQUFBLEtBRVYsSUFBSSxDQUFDcEksYUFBYSxDQUFDd0csR0FBRyxDQUFDaEMsVUFBVSxDQUFDO2dCQUFBK0csU0FBQSxDQUFBalUsSUFBQTtnQkFBQTtjQUFBO2NBQ3BDME0sSUFBSSxDQUFDQyxLQUFLLENBQUMsQ0FBQztjQUNaL0gsT0FBTyxDQUFDUSxJQUFJLENBQUM4SCxVQUFVLEdBQUcsc0VBQXNFLENBQUM7Y0FBQyxPQUFBK0csU0FBQSxDQUFBcFUsTUFBQSxXQUMzRixJQUFJO1lBQUE7Y0FBQSxLQUdUZ1UsWUFBWTtnQkFBQUksU0FBQSxDQUFBalUsSUFBQTtnQkFBQTtjQUFBO2NBQ2QwTSxJQUFJLENBQUNDLEtBQUssQ0FBQyxDQUFDO2NBQUMsTUFDVGlILFVBQVUsR0FBRyxDQUFDO2dCQUFBSyxTQUFBLENBQUFqVSxJQUFBO2dCQUFBO2NBQUE7Y0FDaEI0RSxPQUFPLENBQUNRLElBQUksQ0FBQzhILFVBQVUsR0FBRyxpQ0FBaUMsQ0FBQztjQUFDLE9BQUErRyxTQUFBLENBQUFwVSxNQUFBLFdBQ3RELElBQUksQ0FBQzRPLGdCQUFnQixDQUFDdkIsVUFBVSxFQUFFMEcsVUFBVSxHQUFHLENBQUMsQ0FBQztZQUFBO2NBRXhEaFAsT0FBTyxDQUFDUSxJQUFJLENBQUM4SCxVQUFVLEdBQUcsdUJBQXVCLENBQUM7Y0FBQyxPQUFBK0csU0FBQSxDQUFBcFUsTUFBQSxXQUM1QyxJQUFJO1lBQUE7Y0FBQSxNQUlYd0YsUUFBUSxJQUFJLENBQUMsSUFBSSxDQUFDa1AsMEJBQTBCO2dCQUFBTixTQUFBLENBQUFqVSxJQUFBO2dCQUFBO2NBQUE7Y0FBQWlVLFNBQUEsQ0FBQWpVLElBQUE7Y0FBQSxPQUd2QyxJQUFJdUIsT0FBTyxDQUFDLFVBQUN0QyxPQUFPO2dCQUFBLE9BQUswTyxVQUFVLENBQUMxTyxPQUFPLEVBQUUsSUFBSSxDQUFDO2NBQUEsRUFBQztZQUFBO2NBQzFELElBQUksQ0FBQ3NWLDBCQUEwQixHQUFHLElBQUk7WUFBQztjQUdyQzVGLFdBQVcsR0FBRyxJQUFJNkYsV0FBVyxDQUFDLENBQUM7Y0FDL0JWLFNBQVMsR0FBR3BILElBQUksQ0FBQytILFlBQVksQ0FBQyxDQUFDO2NBQ25DWCxTQUFTLENBQUNsVixPQUFPLENBQUMsVUFBQThWLFFBQVEsRUFBSTtnQkFDNUIsSUFBSUEsUUFBUSxDQUFDL0MsS0FBSyxFQUFFO2tCQUNsQmhELFdBQVcsQ0FBQ2lELFFBQVEsQ0FBQzhDLFFBQVEsQ0FBQy9DLEtBQUssQ0FBQztnQkFDdEM7Y0FDRixDQUFDLENBQUM7Y0FDRixJQUFJaEQsV0FBVyxDQUFDK0MsU0FBUyxDQUFDLENBQUMsQ0FBQzdRLE1BQU0sS0FBSyxDQUFDLEVBQUU7Z0JBQ3hDOE4sV0FBVyxHQUFHLElBQUk7Y0FDcEI7Y0FFQXpKLEtBQUssQ0FBQ2dJLFVBQVUsR0FBRyxvQkFBb0IsQ0FBQztjQUFDLE9BQUErRyxTQUFBLENBQUFwVSxNQUFBLFdBQ2xDO2dCQUNMbUMsTUFBTSxFQUFOQSxNQUFNO2dCQUNOMk0sV0FBVyxFQUFYQSxXQUFXO2dCQUNYakMsSUFBSSxFQUFKQTtjQUNGLENBQUM7WUFBQTtZQUFBO2NBQUEsT0FBQXVILFNBQUEsQ0FBQW5TLElBQUE7VUFBQTtRQUFBLEdBQUE0UixRQUFBO01BQUEsQ0FDRjtNQUFBLFNBQUFqRixpQkFBQWtHLEdBQUE7UUFBQSxPQUFBbEIsaUJBQUEsQ0FBQXZRLEtBQUEsT0FBQUQsU0FBQTtNQUFBO01BQUEsT0FBQXdMLGdCQUFBO0lBQUE7RUFBQTtJQUFBL0wsR0FBQTtJQUFBbEcsS0FBQSxFQUVELFNBQUE2VixTQUFTclEsTUFBTSxFQUFFNFMsU0FBUyxFQUFFO01BQzFCLE9BQU81UyxNQUFNLENBQUM2UyxXQUFXLENBQUM7UUFDeEJDLElBQUksRUFBRSxNQUFNO1FBQ1poRCxPQUFPLEVBQUUsSUFBSSxDQUFDckssSUFBSTtRQUNsQnNLLE9BQU8sRUFBRSxJQUFJLENBQUNySyxRQUFRO1FBQ3RCa04sU0FBUyxFQUFUQSxTQUFTO1FBQ1RHLEtBQUssRUFBRSxJQUFJLENBQUNwTjtNQUNkLENBQUMsQ0FBQztJQUNKO0VBQUM7SUFBQWpGLEdBQUE7SUFBQWxHLEtBQUEsRUFFRCxTQUFBd1ksYUFBQSxFQUFlO01BQ2IsSUFBSSxJQUFJLENBQUNDLE1BQU0sRUFBRTtRQUNmLElBQUksQ0FBQ0MsUUFBUSxDQUFDLENBQUM7TUFDakIsQ0FBQyxNQUFNO1FBQ0wsSUFBSSxDQUFDQyxNQUFNLENBQUMsQ0FBQztNQUNmO0lBQ0Y7RUFBQztJQUFBelMsR0FBQTtJQUFBbEcsS0FBQSxFQUVELFNBQUEyWSxPQUFBLEVBQVM7TUFDUCxJQUFJLENBQUNGLE1BQU0sR0FBRyxJQUFJO0lBQ3BCO0VBQUM7SUFBQXZTLEdBQUE7SUFBQWxHLEtBQUEsRUFFRCxTQUFBMFksU0FBQSxFQUFXO01BQ1QsSUFBSSxDQUFDRCxNQUFNLEdBQUcsS0FBSztNQUNuQixJQUFJLENBQUNHLG1CQUFtQixDQUFDLENBQUM7SUFDNUI7RUFBQztJQUFBMVMsR0FBQTtJQUFBbEcsS0FBQSxFQUVELFNBQUE2WSwwQkFBMEJDLFNBQVMsRUFBRTVRLE9BQU8sRUFBRTtNQUM1QztNQUNBO01BQ0E7TUFDQSxLQUFLLElBQUlqSSxDQUFDLEdBQUcsQ0FBQyxFQUFFc0IsQ0FBQyxHQUFHMkcsT0FBTyxDQUFDd0osSUFBSSxDQUFDNVAsQ0FBQyxDQUFDdUMsTUFBTSxFQUFFcEUsQ0FBQyxHQUFHc0IsQ0FBQyxFQUFFdEIsQ0FBQyxFQUFFLEVBQUU7UUFDckQsSUFBTXlSLElBQUksR0FBR3hKLE9BQU8sQ0FBQ3dKLElBQUksQ0FBQzVQLENBQUMsQ0FBQzdCLENBQUMsQ0FBQztRQUU5QixJQUFJeVIsSUFBSSxDQUFDb0gsU0FBUyxLQUFLQSxTQUFTLEVBQUU7VUFDaEMsT0FBT3BILElBQUk7UUFDYjtNQUNGO01BRUEsT0FBTyxJQUFJO0lBQ2I7RUFBQztJQUFBeEwsR0FBQTtJQUFBbEcsS0FBQSxFQUVELFNBQUErWSxlQUFlRCxTQUFTLEVBQUU1USxPQUFPLEVBQUU7TUFDakMsSUFBSSxDQUFDQSxPQUFPLEVBQUUsT0FBTyxJQUFJO01BRXpCLElBQUl3SixJQUFJLEdBQUd4SixPQUFPLENBQUM4USxRQUFRLEtBQUssSUFBSSxHQUFHLElBQUksQ0FBQ0gseUJBQXlCLENBQUNDLFNBQVMsRUFBRTVRLE9BQU8sQ0FBQyxHQUFHQSxPQUFPLENBQUN3SixJQUFJOztNQUV4RztNQUNBO01BQ0E7TUFDQSxJQUFJQSxJQUFJLENBQUN1SCxLQUFLLElBQUksQ0FBQyxJQUFJLENBQUNoTixTQUFTLENBQUN5RixJQUFJLENBQUN1SCxLQUFLLENBQUMsRUFBRSxPQUFPLElBQUk7O01BRTFEO01BQ0EsSUFBSXZILElBQUksQ0FBQ3VILEtBQUssSUFBSSxJQUFJLENBQUN6TSxjQUFjLENBQUNrRyxHQUFHLENBQUNoQixJQUFJLENBQUN1SCxLQUFLLENBQUMsRUFBRSxPQUFPLElBQUk7TUFFbEUsT0FBT3ZILElBQUk7SUFDYjs7SUFFQTtFQUFBO0lBQUF4TCxHQUFBO0lBQUFsRyxLQUFBLEVBQ0EsU0FBQWtaLDJCQUEyQkosU0FBUyxFQUFFO01BQ3BDLE9BQU8sSUFBSSxDQUFDQyxjQUFjLENBQUNELFNBQVMsRUFBRSxJQUFJLENBQUNyTSxhQUFhLENBQUNtRyxHQUFHLENBQUNrRyxTQUFTLENBQUMsQ0FBQztJQUMxRTtFQUFDO0lBQUE1UyxHQUFBO0lBQUFsRyxLQUFBLEVBRUQsU0FBQTRZLG9CQUFBLEVBQXNCO01BQUEsSUFBQU8sVUFBQSxHQUFBN0csMEJBQUEsQ0FDZSxJQUFJLENBQUM3RixhQUFhO1FBQUEyTSxNQUFBO01BQUE7UUFBckQsS0FBQUQsVUFBQSxDQUFBMVgsQ0FBQSxNQUFBMlgsTUFBQSxHQUFBRCxVQUFBLENBQUF2WixDQUFBLElBQUFrRCxJQUFBLEdBQXVEO1VBQUEsSUFBQXVXLFlBQUEsR0FBQUMsY0FBQSxDQUFBRixNQUFBLENBQUFwWixLQUFBO1lBQTNDOFksU0FBUyxHQUFBTyxZQUFBO1lBQUVuUixPQUFPLEdBQUFtUixZQUFBO1VBQzVCLElBQUkzSCxJQUFJLEdBQUcsSUFBSSxDQUFDcUgsY0FBYyxDQUFDRCxTQUFTLEVBQUU1USxPQUFPLENBQUM7VUFDbEQsSUFBSSxDQUFDd0osSUFBSSxFQUFFOztVQUVYO1VBQ0E7VUFDQSxJQUFNc0gsUUFBUSxHQUFHOVEsT0FBTyxDQUFDOFEsUUFBUSxLQUFLLElBQUksR0FBRyxHQUFHLEdBQUc5USxPQUFPLENBQUM4USxRQUFRO1VBRW5FLElBQUksQ0FBQ3BLLGlCQUFpQixDQUFDLElBQUksRUFBRW9LLFFBQVEsRUFBRXRILElBQUksRUFBRXhKLE9BQU8sQ0FBQ3FSLE1BQU0sQ0FBQztRQUM5RDtNQUFDLFNBQUE1UyxHQUFBO1FBQUF3UyxVQUFBLENBQUE1WixDQUFBLENBQUFvSCxHQUFBO01BQUE7UUFBQXdTLFVBQUEsQ0FBQTNYLENBQUE7TUFBQTtNQUNELElBQUksQ0FBQ2lMLGFBQWEsQ0FBQ3hDLEtBQUssQ0FBQyxDQUFDO0lBQzVCO0VBQUM7SUFBQS9ELEdBQUE7SUFBQWxHLEtBQUEsRUFFRCxTQUFBd1osYUFBYXRSLE9BQU8sRUFBRTtNQUNwQixJQUFJQSxPQUFPLENBQUM4USxRQUFRLEtBQUssSUFBSSxFQUFFO1FBQUU7UUFDL0IsS0FBSyxJQUFJL1ksQ0FBQyxHQUFHLENBQUMsRUFBRXNCLENBQUMsR0FBRzJHLE9BQU8sQ0FBQ3dKLElBQUksQ0FBQzVQLENBQUMsQ0FBQ3VDLE1BQU0sRUFBRXBFLENBQUMsR0FBR3NCLENBQUMsRUFBRXRCLENBQUMsRUFBRSxFQUFFO1VBQ3JELElBQUksQ0FBQ3daLGtCQUFrQixDQUFDdlIsT0FBTyxFQUFFakksQ0FBQyxDQUFDO1FBQ3JDO01BQ0YsQ0FBQyxNQUFNO1FBQ0wsSUFBSSxDQUFDd1osa0JBQWtCLENBQUN2UixPQUFPLENBQUM7TUFDbEM7SUFDRjtFQUFDO0lBQUFoQyxHQUFBO0lBQUFsRyxLQUFBLEVBRUQsU0FBQXlaLG1CQUFtQnZSLE9BQU8sRUFBRXdSLEtBQUssRUFBRTtNQUNqQyxJQUFNaEksSUFBSSxHQUFHZ0ksS0FBSyxLQUFLOVMsU0FBUyxHQUFHc0IsT0FBTyxDQUFDd0osSUFBSSxDQUFDNVAsQ0FBQyxDQUFDNFgsS0FBSyxDQUFDLEdBQUd4UixPQUFPLENBQUN3SixJQUFJO01BQ3ZFLElBQU1zSCxRQUFRLEdBQUc5USxPQUFPLENBQUM4USxRQUFRO01BQ2pDLElBQU1PLE1BQU0sR0FBR3JSLE9BQU8sQ0FBQ3FSLE1BQU07TUFFN0IsSUFBTVQsU0FBUyxHQUFHcEgsSUFBSSxDQUFDb0gsU0FBUztNQUVoQyxJQUFJLENBQUMsSUFBSSxDQUFDck0sYUFBYSxDQUFDaUcsR0FBRyxDQUFDb0csU0FBUyxDQUFDLEVBQUU7UUFDdEMsSUFBSSxDQUFDck0sYUFBYSxDQUFDa04sR0FBRyxDQUFDYixTQUFTLEVBQUU1USxPQUFPLENBQUM7TUFDNUMsQ0FBQyxNQUFNO1FBQ0wsSUFBTTBSLGFBQWEsR0FBRyxJQUFJLENBQUNuTixhQUFhLENBQUNtRyxHQUFHLENBQUNrRyxTQUFTLENBQUM7UUFDdkQsSUFBTWUsVUFBVSxHQUFHRCxhQUFhLENBQUNaLFFBQVEsS0FBSyxJQUFJLEdBQUcsSUFBSSxDQUFDSCx5QkFBeUIsQ0FBQ0MsU0FBUyxFQUFFYyxhQUFhLENBQUMsR0FBR0EsYUFBYSxDQUFDbEksSUFBSTs7UUFFbEk7UUFDQSxJQUFNb0ksaUJBQWlCLEdBQUdwSSxJQUFJLENBQUNxSSxhQUFhLEdBQUdGLFVBQVUsQ0FBQ0UsYUFBYTtRQUN2RSxJQUFNQyx3QkFBd0IsR0FBR3RJLElBQUksQ0FBQ3FJLGFBQWEsS0FBS0YsVUFBVSxDQUFDRSxhQUFhO1FBQ2hGLElBQUlELGlCQUFpQixJQUFLRSx3QkFBd0IsSUFBSUgsVUFBVSxDQUFDWixLQUFLLEdBQUd2SCxJQUFJLENBQUN1SCxLQUFNLEVBQUU7VUFDcEY7UUFDRjtRQUVBLElBQUlELFFBQVEsS0FBSyxHQUFHLEVBQUU7VUFDcEIsSUFBTWlCLGtCQUFrQixHQUFHSixVQUFVLElBQUlBLFVBQVUsQ0FBQ0ssV0FBVztVQUMvRCxJQUFJRCxrQkFBa0IsRUFBRTtZQUN0QjtZQUNBLElBQUksQ0FBQ3hOLGFBQWEsVUFBTyxDQUFDcU0sU0FBUyxDQUFDO1VBQ3RDLENBQUMsTUFBTTtZQUNMO1lBQ0EsSUFBSSxDQUFDck0sYUFBYSxDQUFDa04sR0FBRyxDQUFDYixTQUFTLEVBQUU1USxPQUFPLENBQUM7VUFDNUM7UUFDRixDQUFDLE1BQU07VUFDTDtVQUNBLElBQUkyUixVQUFVLENBQUNNLFVBQVUsSUFBSXpJLElBQUksQ0FBQ3lJLFVBQVUsRUFBRTtZQUM1Q3phLE1BQU0sQ0FBQzhXLE1BQU0sQ0FBQ3FELFVBQVUsQ0FBQ00sVUFBVSxFQUFFekksSUFBSSxDQUFDeUksVUFBVSxDQUFDO1VBQ3ZEO1FBQ0Y7TUFDRjtJQUNGO0VBQUM7SUFBQWpVLEdBQUE7SUFBQWxHLEtBQUEsRUFFRCxTQUFBaU4scUJBQXFCMU4sQ0FBQyxFQUFFZ2EsTUFBTSxFQUFFO01BQzlCLElBQUksQ0FBQ3JNLE1BQU0sQ0FBQ3NFLElBQUksQ0FBQ0MsS0FBSyxDQUFDbFMsQ0FBQyxDQUFDbVMsSUFBSSxDQUFDLEVBQUU2SCxNQUFNLENBQUM7SUFDekM7RUFBQztJQUFBclQsR0FBQTtJQUFBbEcsS0FBQSxFQUVELFNBQUFrTixPQUFPaEYsT0FBTyxFQUFFcVIsTUFBTSxFQUFFO01BQ3RCLElBQUk3USxLQUFLLENBQUMwUixPQUFPLEVBQUU7UUFDakIxUixLQUFLLFdBQUE4RyxNQUFBLENBQVd0SCxPQUFPLENBQUUsQ0FBQztNQUM1QjtNQUVBLElBQUksQ0FBQ0EsT0FBTyxDQUFDOFEsUUFBUSxFQUFFO01BRXZCOVEsT0FBTyxDQUFDcVIsTUFBTSxHQUFHQSxNQUFNO01BRXZCLElBQUksSUFBSSxDQUFDZCxNQUFNLEVBQUU7UUFDZixJQUFJLENBQUNlLFlBQVksQ0FBQ3RSLE9BQU8sQ0FBQztNQUM1QixDQUFDLE1BQU07UUFDTCxJQUFJLENBQUMwRyxpQkFBaUIsQ0FBQyxJQUFJLEVBQUUxRyxPQUFPLENBQUM4USxRQUFRLEVBQUU5USxPQUFPLENBQUN3SixJQUFJLEVBQUV4SixPQUFPLENBQUNxUixNQUFNLENBQUM7TUFDOUU7SUFDRjtFQUFDO0lBQUFyVCxHQUFBO0lBQUFsRyxLQUFBLEVBRUQsU0FBQXFhLHdCQUF3QkMsTUFBTSxFQUFFO01BQzlCLE9BQU8sSUFBSTtJQUNiO0VBQUM7SUFBQXBVLEdBQUE7SUFBQWxHLEtBQUEsRUFFRCxTQUFBdWEsc0JBQXNCRCxNQUFNLEVBQUUsQ0FBQztFQUFDO0lBQUFwVSxHQUFBO0lBQUFsRyxLQUFBLEVBRWhDLFNBQUF3YSxzQkFBc0JGLE1BQU0sRUFBRSxDQUFDO0VBQUM7SUFBQXBVLEdBQUE7SUFBQWxHLEtBQUEsRUFFaEMsU0FBQXlhLGlCQUFpQnZQLFFBQVEsRUFBRTtNQUN6QixPQUFPLElBQUksQ0FBQ2UsU0FBUyxDQUFDZixRQUFRLENBQUMsR0FBRzdDLEdBQUcsQ0FBQ3FTLFFBQVEsQ0FBQ0MsWUFBWSxHQUFHdFMsR0FBRyxDQUFDcVMsUUFBUSxDQUFDRSxhQUFhO0lBQzFGO0VBQUM7SUFBQTFVLEdBQUE7SUFBQWxHLEtBQUE7TUFBQSxJQUFBNmEsaUJBQUEsR0FBQXhVLGlCQUFBLGVBQUEvRyxtQkFBQSxHQUFBb0YsSUFBQSxDQUVELFNBQUFvVyxTQUFBO1FBQUEsSUFBQUMsTUFBQTtRQUFBLElBQUFDLGNBQUEsRUFBQUMsR0FBQSxFQUFBQyxTQUFBLEVBQUFDLGtCQUFBLEVBQUFDLGtCQUFBLEVBQUFDLFVBQUEsRUFBQUMsVUFBQTtRQUFBLE9BQUFoYyxtQkFBQSxHQUFBdUIsSUFBQSxVQUFBMGEsVUFBQUMsU0FBQTtVQUFBLGtCQUFBQSxTQUFBLENBQUFyVyxJQUFBLEdBQUFxVyxTQUFBLENBQUFoWSxJQUFBO1lBQUE7Y0FBQSxLQUNNLElBQUksQ0FBQzhNLGNBQWMsQ0FBQyxDQUFDO2dCQUFBa0wsU0FBQSxDQUFBaFksSUFBQTtnQkFBQTtjQUFBO2NBQUEsT0FBQWdZLFNBQUEsQ0FBQW5ZLE1BQUE7WUFBQTtjQUVuQjJYLGNBQWMsR0FBR1MsSUFBSSxDQUFDQyxHQUFHLENBQUMsQ0FBQztjQUFBRixTQUFBLENBQUFoWSxJQUFBO2NBQUEsT0FFZm1ZLEtBQUssQ0FBQ3JSLFFBQVEsQ0FBQ3NSLFFBQVEsQ0FBQ0MsSUFBSSxFQUFFO2dCQUM5QzlZLE1BQU0sRUFBRSxNQUFNO2dCQUNkK1ksS0FBSyxFQUFFO2NBQ1QsQ0FBQyxDQUFDO1lBQUE7Y0FISWIsR0FBRyxHQUFBTyxTQUFBLENBQUF0WSxJQUFBO2NBS0hnWSxTQUFTLEdBQUcsSUFBSTtjQUNoQkMsa0JBQWtCLEdBQUcsSUFBSU0sSUFBSSxDQUFDUixHQUFHLENBQUNjLE9BQU8sQ0FBQ25KLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDb0osT0FBTyxDQUFDLENBQUMsR0FBR2QsU0FBUyxHQUFHLENBQUM7Y0FDaEZFLGtCQUFrQixHQUFHSyxJQUFJLENBQUNDLEdBQUcsQ0FBQyxDQUFDO2NBQy9CTCxVQUFVLEdBQUdGLGtCQUFrQixHQUFHLENBQUNDLGtCQUFrQixHQUFHSixjQUFjLElBQUksQ0FBQztjQUMzRU0sVUFBVSxHQUFHRCxVQUFVLEdBQUdELGtCQUFrQjtjQUVsRCxJQUFJLENBQUN6TyxrQkFBa0IsRUFBRTtjQUV6QixJQUFJLElBQUksQ0FBQ0Esa0JBQWtCLElBQUksRUFBRSxFQUFFO2dCQUNqQyxJQUFJLENBQUNELFdBQVcsQ0FBQzFJLElBQUksQ0FBQ3NYLFVBQVUsQ0FBQztjQUNuQyxDQUFDLE1BQU07Z0JBQ0wsSUFBSSxDQUFDNU8sV0FBVyxDQUFDLElBQUksQ0FBQ0Msa0JBQWtCLEdBQUcsRUFBRSxDQUFDLEdBQUcyTyxVQUFVO2NBQzdEO2NBRUEsSUFBSSxDQUFDMU8sYUFBYSxHQUFHLElBQUksQ0FBQ0YsV0FBVyxDQUFDdVAsTUFBTSxDQUFDLFVBQUNDLEdBQUcsRUFBRUMsTUFBTTtnQkFBQSxPQUFNRCxHQUFHLElBQUlDLE1BQU07Y0FBQSxDQUFDLEVBQUUsQ0FBQyxDQUFDLEdBQUcsSUFBSSxDQUFDelAsV0FBVyxDQUFDckksTUFBTTtjQUUzRyxJQUFJLElBQUksQ0FBQ3NJLGtCQUFrQixHQUFHLEVBQUUsRUFBRTtnQkFDaENqRSxLQUFLLDRCQUFBOEcsTUFBQSxDQUE0QixJQUFJLENBQUM1QyxhQUFhLE9BQUksQ0FBQztnQkFDeER1RSxVQUFVLENBQUM7a0JBQUEsT0FBTTRKLE1BQUksQ0FBQ2pMLGdCQUFnQixDQUFDLENBQUM7Z0JBQUEsR0FBRSxDQUFDLEdBQUcsRUFBRSxHQUFHLElBQUksQ0FBQyxDQUFDLENBQUM7Y0FDNUQsQ0FBQyxNQUFNO2dCQUNMLElBQUksQ0FBQ0EsZ0JBQWdCLENBQUMsQ0FBQztjQUN6QjtZQUFDO1lBQUE7Y0FBQSxPQUFBMEwsU0FBQSxDQUFBbFcsSUFBQTtVQUFBO1FBQUEsR0FBQXdWLFFBQUE7TUFBQSxDQUNGO01BQUEsU0FBQWhMLGlCQUFBO1FBQUEsT0FBQStLLGlCQUFBLENBQUFuVSxLQUFBLE9BQUFELFNBQUE7TUFBQTtNQUFBLE9BQUFxSixnQkFBQTtJQUFBO0VBQUE7SUFBQTVKLEdBQUE7SUFBQWxHLEtBQUEsRUFFRCxTQUFBb2MsY0FBQSxFQUFnQjtNQUNkLE9BQU9YLElBQUksQ0FBQ0MsR0FBRyxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUM5TyxhQUFhO0lBQ3hDO0VBQUM7SUFBQTFHLEdBQUE7SUFBQWxHLEtBQUEsRUFFRCxTQUFBcWMsZUFBZW5SLFFBQVEsRUFBa0I7TUFBQSxJQUFBb1IsT0FBQTtNQUFBLElBQWhCbmIsSUFBSSxHQUFBc0YsU0FBQSxDQUFBcEMsTUFBQSxRQUFBb0MsU0FBQSxRQUFBRyxTQUFBLEdBQUFILFNBQUEsTUFBRyxPQUFPO01BQ3JDLElBQUksSUFBSSxDQUFDMkYsWUFBWSxDQUFDbEIsUUFBUSxDQUFDLEVBQUU7UUFDL0J4QyxLQUFLLGdCQUFBOEcsTUFBQSxDQUFnQnJPLElBQUksV0FBQXFPLE1BQUEsQ0FBUXRFLFFBQVEsQ0FBRSxDQUFDO1FBQzVDLE9BQU9uRyxPQUFPLENBQUN0QyxPQUFPLENBQUMsSUFBSSxDQUFDMkosWUFBWSxDQUFDbEIsUUFBUSxDQUFDLENBQUMvSixJQUFJLENBQUMsQ0FBQztNQUMzRCxDQUFDLE1BQU07UUFDTHVILEtBQUssZUFBQThHLE1BQUEsQ0FBZXJPLElBQUksV0FBQXFPLE1BQUEsQ0FBUXRFLFFBQVEsQ0FBRSxDQUFDO1FBQzNDLElBQUksQ0FBQyxJQUFJLENBQUNvQixvQkFBb0IsQ0FBQ29HLEdBQUcsQ0FBQ3hILFFBQVEsQ0FBQyxFQUFFO1VBQzVDLElBQUksQ0FBQ29CLG9CQUFvQixDQUFDcU4sR0FBRyxDQUFDek8sUUFBUSxFQUFFLENBQUMsQ0FBQyxDQUFDO1VBRTNDLElBQU1xUixZQUFZLEdBQUcsSUFBSXhYLE9BQU8sQ0FBQyxVQUFDdEMsT0FBTyxFQUFFc0QsTUFBTSxFQUFLO1lBQ3BEdVcsT0FBSSxDQUFDaFEsb0JBQW9CLENBQUNzRyxHQUFHLENBQUMxSCxRQUFRLENBQUMsQ0FBQzJILEtBQUssR0FBRztjQUFFcFEsT0FBTyxFQUFQQSxPQUFPO2NBQUVzRCxNQUFNLEVBQU5BO1lBQU8sQ0FBQztVQUNyRSxDQUFDLENBQUM7VUFDRixJQUFNeVcsWUFBWSxHQUFHLElBQUl6WCxPQUFPLENBQUMsVUFBQ3RDLE9BQU8sRUFBRXNELE1BQU0sRUFBSztZQUNwRHVXLE9BQUksQ0FBQ2hRLG9CQUFvQixDQUFDc0csR0FBRyxDQUFDMUgsUUFBUSxDQUFDLENBQUNiLEtBQUssR0FBRztjQUFFNUgsT0FBTyxFQUFQQSxPQUFPO2NBQUVzRCxNQUFNLEVBQU5BO1lBQU8sQ0FBQztVQUNyRSxDQUFDLENBQUM7VUFFRixJQUFJLENBQUN1RyxvQkFBb0IsQ0FBQ3NHLEdBQUcsQ0FBQzFILFFBQVEsQ0FBQyxDQUFDMkgsS0FBSyxDQUFDNEosT0FBTyxHQUFHRixZQUFZO1VBQ3BFLElBQUksQ0FBQ2pRLG9CQUFvQixDQUFDc0csR0FBRyxDQUFDMUgsUUFBUSxDQUFDLENBQUNiLEtBQUssQ0FBQ29TLE9BQU8sR0FBR0QsWUFBWTtVQUVwRUQsWUFBWSxTQUFNLENBQUMsVUFBQWhkLENBQUM7WUFBQSxPQUFJNkksT0FBTyxDQUFDUSxJQUFJLElBQUE0RyxNQUFBLENBQUl0RSxRQUFRLGtDQUErQjNMLENBQUMsQ0FBQztVQUFBLEVBQUM7VUFDbEZpZCxZQUFZLFNBQU0sQ0FBQyxVQUFBamQsQ0FBQztZQUFBLE9BQUk2SSxPQUFPLENBQUNRLElBQUksSUFBQTRHLE1BQUEsQ0FBSXRFLFFBQVEsa0NBQStCM0wsQ0FBQyxDQUFDO1VBQUEsRUFBQztRQUNwRjtRQUNBLE9BQU8sSUFBSSxDQUFDK00sb0JBQW9CLENBQUNzRyxHQUFHLENBQUMxSCxRQUFRLENBQUMsQ0FBQy9KLElBQUksQ0FBQyxDQUFDc2IsT0FBTztNQUM5RDtJQUNGO0VBQUM7SUFBQXZXLEdBQUE7SUFBQWxHLEtBQUEsRUFFRCxTQUFBa1MsZUFBZWhILFFBQVEsRUFBRXdSLE1BQU0sRUFBRTtNQUMvQjtNQUNBO01BQ0EsSUFBTUMsV0FBVyxHQUFHLElBQUkzRSxXQUFXLENBQUMsQ0FBQztNQUNyQyxJQUFJO1FBQ0owRSxNQUFNLENBQUNFLGNBQWMsQ0FBQyxDQUFDLENBQUN4YSxPQUFPLENBQUMsVUFBQStTLEtBQUs7VUFBQSxPQUFJd0gsV0FBVyxDQUFDdkgsUUFBUSxDQUFDRCxLQUFLLENBQUM7UUFBQSxFQUFDO01BRXJFLENBQUMsQ0FBQyxPQUFNNVYsQ0FBQyxFQUFFO1FBQ1Q2SSxPQUFPLENBQUNRLElBQUksSUFBQTRHLE1BQUEsQ0FBSXRFLFFBQVEsa0NBQStCM0wsQ0FBQyxDQUFDO01BQzNEO01BQ0EsSUFBTXNkLFdBQVcsR0FBRyxJQUFJN0UsV0FBVyxDQUFDLENBQUM7TUFDckMsSUFBSTtRQUNKMEUsTUFBTSxDQUFDSSxjQUFjLENBQUMsQ0FBQyxDQUFDMWEsT0FBTyxDQUFDLFVBQUErUyxLQUFLO1VBQUEsT0FBSTBILFdBQVcsQ0FBQ3pILFFBQVEsQ0FBQ0QsS0FBSyxDQUFDO1FBQUEsRUFBQztNQUVyRSxDQUFDLENBQUMsT0FBTzVWLENBQUMsRUFBRTtRQUNWNkksT0FBTyxDQUFDUSxJQUFJLElBQUE0RyxNQUFBLENBQUl0RSxRQUFRLGtDQUErQjNMLENBQUMsQ0FBQztNQUMzRDtNQUVBLElBQUksQ0FBQzZNLFlBQVksQ0FBQ2xCLFFBQVEsQ0FBQyxHQUFHO1FBQUUySCxLQUFLLEVBQUU4SixXQUFXO1FBQUV0UyxLQUFLLEVBQUV3UztNQUFZLENBQUM7O01BRXhFO01BQ0EsSUFBSSxJQUFJLENBQUN2USxvQkFBb0IsQ0FBQ29HLEdBQUcsQ0FBQ3hILFFBQVEsQ0FBQyxFQUFFO1FBQzNDLElBQUksQ0FBQ29CLG9CQUFvQixDQUFDc0csR0FBRyxDQUFDMUgsUUFBUSxDQUFDLENBQUMySCxLQUFLLENBQUNwUSxPQUFPLENBQUNrYSxXQUFXLENBQUM7UUFDbEUsSUFBSSxDQUFDclEsb0JBQW9CLENBQUNzRyxHQUFHLENBQUMxSCxRQUFRLENBQUMsQ0FBQ2IsS0FBSyxDQUFDNUgsT0FBTyxDQUFDb2EsV0FBVyxDQUFDO01BQ3BFO0lBQ0Y7RUFBQztJQUFBM1csR0FBQTtJQUFBbEcsS0FBQTtNQUFBLElBQUErYyxvQkFBQSxHQUFBMVcsaUJBQUEsZUFBQS9HLG1CQUFBLEdBQUFvRixJQUFBLENBRUQsU0FBQXNZLFNBQTBCTixNQUFNO1FBQUEsSUFBQU8sT0FBQTtRQUFBLElBQUFDLGVBQUEsRUFBQUMsVUFBQSxFQUFBQyxNQUFBLEVBQUFDLEtBQUEsRUFBQXBkLENBQUE7UUFBQSxPQUFBWCxtQkFBQSxHQUFBdUIsSUFBQSxVQUFBeWMsVUFBQUMsU0FBQTtVQUFBLGtCQUFBQSxTQUFBLENBQUFwWSxJQUFBLEdBQUFvWSxTQUFBLENBQUEvWixJQUFBO1lBQUE7Y0FBQSxNQVExQixJQUFJLENBQUN3SSxTQUFTLElBQUksSUFBSSxDQUFDQSxTQUFTLENBQUNrRSxJQUFJO2dCQUFBcU4sU0FBQSxDQUFBL1osSUFBQTtnQkFBQTtjQUFBO2NBQ2pDMFosZUFBZSxHQUFHLElBQUksQ0FBQ2xSLFNBQVMsQ0FBQ2tFLElBQUksQ0FBQ3NOLFVBQVUsQ0FBQyxDQUFDO2NBQ2xETCxVQUFVLEdBQUcsRUFBRTtjQUNmQyxNQUFNLEdBQUdWLE1BQU0sQ0FBQ3hILFNBQVMsQ0FBQyxDQUFDO2NBQUFtSSxLQUFBLGdCQUFBL2QsbUJBQUEsR0FBQW9GLElBQUEsVUFBQTJZLE1BQUE7Z0JBQUEsSUFBQTdkLENBQUEsRUFBQWllLE1BQUE7Z0JBQUEsT0FBQW5lLG1CQUFBLEdBQUF1QixJQUFBLFVBQUE2YyxPQUFBQyxTQUFBO2tCQUFBLGtCQUFBQSxTQUFBLENBQUF4WSxJQUFBLEdBQUF3WSxTQUFBLENBQUFuYSxJQUFBO29CQUFBO3NCQUd6QmhFLENBQUMsR0FBRzRkLE1BQU0sQ0FBQ25kLENBQUMsQ0FBQztzQkFDYndkLE1BQU0sR0FBR1AsZUFBZSxDQUFDVSxJQUFJLENBQUMsVUFBQW5jLENBQUM7d0JBQUEsT0FBSUEsQ0FBQyxDQUFDMFQsS0FBSyxJQUFJLElBQUksSUFBSTFULENBQUMsQ0FBQzBULEtBQUssQ0FBQ21ELElBQUksSUFBSTlZLENBQUMsQ0FBQzhZLElBQUk7c0JBQUEsRUFBQztzQkFBQSxNQUUvRW1GLE1BQU0sSUFBSSxJQUFJO3dCQUFBRSxTQUFBLENBQUFuYSxJQUFBO3dCQUFBO3NCQUFBO3NCQUFBLEtBQ1ppYSxNQUFNLENBQUNJLFlBQVk7d0JBQUFGLFNBQUEsQ0FBQW5hLElBQUE7d0JBQUE7c0JBQUE7c0JBQUFtYSxTQUFBLENBQUFuYSxJQUFBO3NCQUFBLE9BQ2ZpYSxNQUFNLENBQUNJLFlBQVksQ0FBQ3JlLENBQUMsQ0FBQztvQkFBQTtzQkFFNUI7c0JBQ0EsSUFBSUEsQ0FBQyxDQUFDOFksSUFBSSxLQUFLLE9BQU8sSUFBSTlZLENBQUMsQ0FBQzRhLE9BQU8sSUFBSXJSLFNBQVMsQ0FBQ0MsU0FBUyxDQUFDOFUsV0FBVyxDQUFDLENBQUMsQ0FBQzNWLE9BQU8sQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRTt3QkFDaEczSSxDQUFDLENBQUM0YSxPQUFPLEdBQUcsS0FBSzt3QkFDakJqSixVQUFVLENBQUM7MEJBQUEsT0FBTTNSLENBQUMsQ0FBQzRhLE9BQU8sR0FBRyxJQUFJO3dCQUFBLEdBQUUsSUFBSSxDQUFDO3NCQUMxQztzQkFBQ3VELFNBQUEsQ0FBQW5hLElBQUE7c0JBQUE7b0JBQUE7c0JBRUQ7c0JBQ0E7c0JBQ0E7c0JBQ0FrWixNQUFNLENBQUNxQixXQUFXLENBQUNOLE1BQU0sQ0FBQ3RJLEtBQUssQ0FBQztzQkFDaEN1SCxNQUFNLENBQUN0SCxRQUFRLENBQUM1VixDQUFDLENBQUM7b0JBQUM7c0JBRXJCMmQsVUFBVSxDQUFDblosSUFBSSxDQUFDeVosTUFBTSxDQUFDO3NCQUFDRSxTQUFBLENBQUFuYSxJQUFBO3NCQUFBO29CQUFBO3NCQUV4QjJaLFVBQVUsQ0FBQ25aLElBQUksQ0FBQ2laLE9BQUksQ0FBQ2pSLFNBQVMsQ0FBQ2tFLElBQUksQ0FBQ2tGLFFBQVEsQ0FBQzVWLENBQUMsRUFBRWtkLE1BQU0sQ0FBQyxDQUFDO29CQUFDO29CQUFBO3NCQUFBLE9BQUFpQixTQUFBLENBQUFyWSxJQUFBO2tCQUFBO2dCQUFBLEdBQUErWCxLQUFBO2NBQUE7Y0F0QnBEcGQsQ0FBQyxHQUFHLENBQUM7WUFBQTtjQUFBLE1BQUVBLENBQUMsR0FBR21kLE1BQU0sQ0FBQy9ZLE1BQU07Z0JBQUFrWixTQUFBLENBQUEvWixJQUFBO2dCQUFBO2NBQUE7Y0FBQSxPQUFBK1osU0FBQSxDQUFBM1gsYUFBQSxDQUFBeVgsS0FBQTtZQUFBO2NBQUVwZCxDQUFDLEVBQUU7Y0FBQXNkLFNBQUEsQ0FBQS9aLElBQUE7Y0FBQTtZQUFBO2NBeUJ0QzBaLGVBQWUsQ0FBQzlhLE9BQU8sQ0FBQyxVQUFBWCxDQUFDLEVBQUk7Z0JBQzNCLElBQUksQ0FBQzBiLFVBQVUsQ0FBQ2pILFFBQVEsQ0FBQ3pVLENBQUMsQ0FBQyxFQUFFO2tCQUMzQkEsQ0FBQyxDQUFDMFQsS0FBSyxDQUFDaUYsT0FBTyxHQUFHLEtBQUs7Z0JBQ3pCO2NBQ0YsQ0FBQyxDQUFDO1lBQUM7Y0FFTCxJQUFJLENBQUMvTixnQkFBZ0IsR0FBR3FRLE1BQU07Y0FDOUIsSUFBSSxDQUFDeEssY0FBYyxDQUFDLElBQUksQ0FBQ2hILFFBQVEsRUFBRXdSLE1BQU0sQ0FBQztZQUFDO1lBQUE7Y0FBQSxPQUFBYSxTQUFBLENBQUFqWSxJQUFBO1VBQUE7UUFBQSxHQUFBMFgsUUFBQTtNQUFBLENBQzVDO01BQUEsU0FBQWdCLG9CQUFBQyxHQUFBO1FBQUEsT0FBQWxCLG9CQUFBLENBQUFyVyxLQUFBLE9BQUFELFNBQUE7TUFBQTtNQUFBLE9BQUF1WCxtQkFBQTtJQUFBO0VBQUE7SUFBQTlYLEdBQUE7SUFBQWxHLEtBQUEsRUFFRCxTQUFBa2UsaUJBQWlCOUQsT0FBTyxFQUFFO01BQ3hCLElBQUksSUFBSSxDQUFDcE8sU0FBUyxJQUFJLElBQUksQ0FBQ0EsU0FBUyxDQUFDa0UsSUFBSSxFQUFFO1FBQ3pDLElBQUksQ0FBQ2xFLFNBQVMsQ0FBQ2tFLElBQUksQ0FBQ3NOLFVBQVUsQ0FBQyxDQUFDLENBQUNwYixPQUFPLENBQUMsVUFBQVgsQ0FBQyxFQUFJO1VBQzVDLElBQUlBLENBQUMsQ0FBQzBULEtBQUssQ0FBQ21ELElBQUksSUFBSSxPQUFPLEVBQUU7WUFDM0I3VyxDQUFDLENBQUMwVCxLQUFLLENBQUNpRixPQUFPLEdBQUdBLE9BQU87VUFDM0I7UUFDRixDQUFDLENBQUM7TUFDSjtJQUNGO0VBQUM7SUFBQWxVLEdBQUE7SUFBQWxHLEtBQUEsRUFFRCxTQUFBbWUsU0FBU2pULFFBQVEsRUFBRThOLFFBQVEsRUFBRXRILElBQUksRUFBRTtNQUNqQyxJQUFJLENBQUMsSUFBSSxDQUFDMUYsU0FBUyxFQUFFO1FBQ25CNUQsT0FBTyxDQUFDUSxJQUFJLENBQUMscUNBQXFDLENBQUM7TUFDckQsQ0FBQyxNQUFNO1FBQ0wsUUFBUSxJQUFJLENBQUM4QyxtQkFBbUI7VUFDOUIsS0FBSyxXQUFXO1lBQ2QsSUFBSSxJQUFJLENBQUNILEVBQUUsQ0FBQ3pCLFVBQVUsS0FBSyxDQUFDLEVBQUU7Y0FBRTtjQUM5QixJQUFJLENBQUNrQyxTQUFTLENBQUN4RyxNQUFNLENBQUM2UyxXQUFXLENBQUM7Z0JBQUVDLElBQUksRUFBRSxNQUFNO2dCQUFFOUMsSUFBSSxFQUFFaEUsSUFBSSxDQUFDNE0sU0FBUyxDQUFDO2tCQUFFcEYsUUFBUSxFQUFSQSxRQUFRO2tCQUFFdEgsSUFBSSxFQUFKQTtnQkFBSyxDQUFDLENBQUM7Z0JBQUUyTSxJQUFJLEVBQUVuVDtjQUFTLENBQUMsQ0FBQztZQUMvRztZQUNBO1VBQ0YsS0FBSyxhQUFhO1lBQ2hCLElBQUksSUFBSSxDQUFDYyxTQUFTLENBQUN3SSxpQkFBaUIsQ0FBQzFLLFVBQVUsS0FBSyxNQUFNLEVBQUU7Y0FDMUQsSUFBSSxDQUFDa0MsU0FBUyxDQUFDd0ksaUJBQWlCLENBQUN4TSxJQUFJLENBQUN3SixJQUFJLENBQUM0TSxTQUFTLENBQUM7Z0JBQUVsVCxRQUFRLEVBQVJBLFFBQVE7Z0JBQUU4TixRQUFRLEVBQVJBLFFBQVE7Z0JBQUV0SCxJQUFJLEVBQUpBO2NBQUssQ0FBQyxDQUFDLENBQUM7WUFDckY7WUFDQTtVQUNGO1lBQ0UsSUFBSSxDQUFDaEcsbUJBQW1CLENBQUNSLFFBQVEsRUFBRThOLFFBQVEsRUFBRXRILElBQUksQ0FBQztZQUNsRDtRQUNKO01BQ0Y7SUFDRjtFQUFDO0lBQUF4TCxHQUFBO0lBQUFsRyxLQUFBLEVBRUQsU0FBQXNlLG1CQUFtQnBULFFBQVEsRUFBRThOLFFBQVEsRUFBRXRILElBQUksRUFBRTtNQUMzQyxJQUFJLENBQUMsSUFBSSxDQUFDMUYsU0FBUyxFQUFFO1FBQ25CNUQsT0FBTyxDQUFDUSxJQUFJLENBQUMsK0NBQStDLENBQUM7TUFDL0QsQ0FBQyxNQUFNO1FBQ0wsUUFBUSxJQUFJLENBQUM2QyxpQkFBaUI7VUFDNUIsS0FBSyxXQUFXO1lBQ2QsSUFBSSxJQUFJLENBQUNGLEVBQUUsQ0FBQ3pCLFVBQVUsS0FBSyxDQUFDLEVBQUU7Y0FBRTtjQUM5QixJQUFJLENBQUNrQyxTQUFTLENBQUN4RyxNQUFNLENBQUM2UyxXQUFXLENBQUM7Z0JBQUVDLElBQUksRUFBRSxNQUFNO2dCQUFFOUMsSUFBSSxFQUFFaEUsSUFBSSxDQUFDNE0sU0FBUyxDQUFDO2tCQUFFcEYsUUFBUSxFQUFSQSxRQUFRO2tCQUFFdEgsSUFBSSxFQUFKQTtnQkFBSyxDQUFDLENBQUM7Z0JBQUUyTSxJQUFJLEVBQUVuVDtjQUFTLENBQUMsQ0FBQztZQUMvRztZQUNBO1VBQ0YsS0FBSyxhQUFhO1lBQ2hCLElBQUksSUFBSSxDQUFDYyxTQUFTLENBQUN1SSxlQUFlLENBQUN6SyxVQUFVLEtBQUssTUFBTSxFQUFFO2NBQ3hELElBQUksQ0FBQ2tDLFNBQVMsQ0FBQ3VJLGVBQWUsQ0FBQ3ZNLElBQUksQ0FBQ3dKLElBQUksQ0FBQzRNLFNBQVMsQ0FBQztnQkFBRWxULFFBQVEsRUFBUkEsUUFBUTtnQkFBRThOLFFBQVEsRUFBUkEsUUFBUTtnQkFBRXRILElBQUksRUFBSkE7Y0FBSyxDQUFDLENBQUMsQ0FBQztZQUNuRjtZQUNBO1VBQ0Y7WUFDRSxJQUFJLENBQUNqRyxpQkFBaUIsQ0FBQ1AsUUFBUSxFQUFFOE4sUUFBUSxFQUFFdEgsSUFBSSxDQUFDO1lBQ2hEO1FBQ0o7TUFDRjtJQUNGO0VBQUM7SUFBQXhMLEdBQUE7SUFBQWxHLEtBQUEsRUFFRCxTQUFBdWUsY0FBY3ZGLFFBQVEsRUFBRXRILElBQUksRUFBRTtNQUM1QixJQUFJLENBQUMsSUFBSSxDQUFDMUYsU0FBUyxFQUFFO1FBQ25CNUQsT0FBTyxDQUFDUSxJQUFJLENBQUMsMENBQTBDLENBQUM7TUFDMUQsQ0FBQyxNQUFNO1FBQ0wsUUFBUSxJQUFJLENBQUM4QyxtQkFBbUI7VUFDOUIsS0FBSyxXQUFXO1lBQ2QsSUFBSSxJQUFJLENBQUNILEVBQUUsQ0FBQ3pCLFVBQVUsS0FBSyxDQUFDLEVBQUU7Y0FBRTtjQUM5QixJQUFJLENBQUNrQyxTQUFTLENBQUN4RyxNQUFNLENBQUM2UyxXQUFXLENBQUM7Z0JBQUVDLElBQUksRUFBRSxNQUFNO2dCQUFFOUMsSUFBSSxFQUFFaEUsSUFBSSxDQUFDNE0sU0FBUyxDQUFDO2tCQUFFcEYsUUFBUSxFQUFSQSxRQUFRO2tCQUFFdEgsSUFBSSxFQUFKQTtnQkFBSyxDQUFDO2NBQUUsQ0FBQyxDQUFDO1lBQy9GO1lBQ0E7VUFDRixLQUFLLGFBQWE7WUFDaEIsSUFBSSxJQUFJLENBQUMxRixTQUFTLENBQUN3SSxpQkFBaUIsQ0FBQzFLLFVBQVUsS0FBSyxNQUFNLEVBQUU7Y0FDMUQsSUFBSSxDQUFDa0MsU0FBUyxDQUFDd0ksaUJBQWlCLENBQUN4TSxJQUFJLENBQUN3SixJQUFJLENBQUM0TSxTQUFTLENBQUM7Z0JBQUVwRixRQUFRLEVBQVJBLFFBQVE7Z0JBQUV0SCxJQUFJLEVBQUpBO2NBQUssQ0FBQyxDQUFDLENBQUM7WUFDM0U7WUFDQTtVQUNGO1lBQ0UsSUFBSSxDQUFDaEcsbUJBQW1CLENBQUM5RSxTQUFTLEVBQUVvUyxRQUFRLEVBQUV0SCxJQUFJLENBQUM7WUFDbkQ7UUFDSjtNQUNGO0lBQ0Y7RUFBQztJQUFBeEwsR0FBQTtJQUFBbEcsS0FBQSxFQUVELFNBQUF3ZSx3QkFBd0J4RixRQUFRLEVBQUV0SCxJQUFJLEVBQUU7TUFDdEMsSUFBSSxDQUFDLElBQUksQ0FBQzFGLFNBQVMsRUFBRTtRQUNuQjVELE9BQU8sQ0FBQ1EsSUFBSSxDQUFDLG9EQUFvRCxDQUFDO01BQ3BFLENBQUMsTUFBTTtRQUNMLFFBQVEsSUFBSSxDQUFDNkMsaUJBQWlCO1VBQzVCLEtBQUssV0FBVztZQUNkLElBQUksSUFBSSxDQUFDRixFQUFFLENBQUN6QixVQUFVLEtBQUssQ0FBQyxFQUFFO2NBQUU7Y0FDOUIsSUFBSSxDQUFDa0MsU0FBUyxDQUFDeEcsTUFBTSxDQUFDNlMsV0FBVyxDQUFDO2dCQUFFQyxJQUFJLEVBQUUsTUFBTTtnQkFBRTlDLElBQUksRUFBRWhFLElBQUksQ0FBQzRNLFNBQVMsQ0FBQztrQkFBRXBGLFFBQVEsRUFBUkEsUUFBUTtrQkFBRXRILElBQUksRUFBSkE7Z0JBQUssQ0FBQztjQUFFLENBQUMsQ0FBQztZQUMvRjtZQUNBO1VBQ0YsS0FBSyxhQUFhO1lBQ2hCLElBQUksSUFBSSxDQUFDMUYsU0FBUyxDQUFDdUksZUFBZSxDQUFDekssVUFBVSxLQUFLLE1BQU0sRUFBRTtjQUN4RCxJQUFJLENBQUNrQyxTQUFTLENBQUN1SSxlQUFlLENBQUN2TSxJQUFJLENBQUN3SixJQUFJLENBQUM0TSxTQUFTLENBQUM7Z0JBQUVwRixRQUFRLEVBQVJBLFFBQVE7Z0JBQUV0SCxJQUFJLEVBQUpBO2NBQUssQ0FBQyxDQUFDLENBQUM7WUFDekU7WUFDQTtVQUNGO1lBQ0UsSUFBSSxDQUFDakcsaUJBQWlCLENBQUM3RSxTQUFTLEVBQUVvUyxRQUFRLEVBQUV0SCxJQUFJLENBQUM7WUFDakQ7UUFDSjtNQUNGO0lBQ0Y7RUFBQztJQUFBeEwsR0FBQTtJQUFBbEcsS0FBQSxFQUVELFNBQUF5ZSxLQUFLdlQsUUFBUSxFQUFFd1QsVUFBVSxFQUFFO01BQ3pCLE9BQU8sSUFBSSxDQUFDMVMsU0FBUyxDQUFDeEcsTUFBTSxDQUFDNlMsV0FBVyxDQUFDO1FBQUVDLElBQUksRUFBRSxNQUFNO1FBQUVoRCxPQUFPLEVBQUUsSUFBSSxDQUFDckssSUFBSTtRQUFFc0ssT0FBTyxFQUFFckssUUFBUTtRQUFFcU4sS0FBSyxFQUFFbUc7TUFBVyxDQUFDLENBQUMsQ0FBQy9iLElBQUksQ0FBQyxZQUFNO1FBQzlIMkgsUUFBUSxDQUFDa0wsSUFBSSxDQUFDQyxhQUFhLENBQUMsSUFBSUMsV0FBVyxDQUFDLFFBQVEsRUFBRTtVQUFFQyxNQUFNLEVBQUU7WUFBRXpLLFFBQVEsRUFBRUE7VUFBUztRQUFFLENBQUMsQ0FBQyxDQUFDO01BQzVGLENBQUMsQ0FBQztJQUNKO0VBQUM7SUFBQWhGLEdBQUE7SUFBQWxHLEtBQUEsRUFFRCxTQUFBMmUsTUFBTXpULFFBQVEsRUFBRTtNQUFBLElBQUEwVCxPQUFBO01BQ2QsT0FBTyxJQUFJLENBQUM1UyxTQUFTLENBQUN4RyxNQUFNLENBQUM2UyxXQUFXLENBQUM7UUFBRUMsSUFBSSxFQUFFLE9BQU87UUFBRStGLElBQUksRUFBRW5UO01BQVMsQ0FBQyxDQUFDLENBQUN2SSxJQUFJLENBQUMsWUFBTTtRQUNyRmljLE9BQUksQ0FBQ3BTLGNBQWMsQ0FBQ21OLEdBQUcsQ0FBQ3pPLFFBQVEsRUFBRSxJQUFJLENBQUM7UUFDdkNaLFFBQVEsQ0FBQ2tMLElBQUksQ0FBQ0MsYUFBYSxDQUFDLElBQUlDLFdBQVcsQ0FBQyxTQUFTLEVBQUU7VUFBRUMsTUFBTSxFQUFFO1lBQUV6SyxRQUFRLEVBQUVBO1VBQVM7UUFBRSxDQUFDLENBQUMsQ0FBQztNQUM3RixDQUFDLENBQUM7SUFDSjtFQUFDO0lBQUFoRixHQUFBO0lBQUFsRyxLQUFBLEVBRUQsU0FBQTZlLFFBQVEzVCxRQUFRLEVBQUU7TUFBQSxJQUFBNFQsT0FBQTtNQUNoQixPQUFPLElBQUksQ0FBQzlTLFNBQVMsQ0FBQ3hHLE1BQU0sQ0FBQzZTLFdBQVcsQ0FBQztRQUFFQyxJQUFJLEVBQUUsU0FBUztRQUFFK0YsSUFBSSxFQUFFblQ7TUFBUyxDQUFDLENBQUMsQ0FBQ3ZJLElBQUksQ0FBQyxZQUFNO1FBQ3ZGbWMsT0FBSSxDQUFDdFMsY0FBYyxVQUFPLENBQUN0QixRQUFRLENBQUM7UUFDcENaLFFBQVEsQ0FBQ2tMLElBQUksQ0FBQ0MsYUFBYSxDQUFDLElBQUlDLFdBQVcsQ0FBQyxXQUFXLEVBQUU7VUFBRUMsTUFBTSxFQUFFO1lBQUV6SyxRQUFRLEVBQUVBO1VBQVM7UUFBRSxDQUFDLENBQUMsQ0FBQztNQUMvRixDQUFDLENBQUM7SUFDSjtFQUFDO0VBQUEsT0FBQUYsWUFBQTtBQUFBO0FBR0gzQyxHQUFHLENBQUNxUyxRQUFRLENBQUNxRSxRQUFRLENBQUMsT0FBTyxFQUFFL1QsWUFBWSxDQUFDO0FBRTVDZ1UsTUFBTSxDQUFDQyxPQUFPLEdBQUdqVSxZQUFZOzs7Ozs7Ozs7OztBQ3ZrQzdCO0FBQ2E7O0FBRWI7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsSUFBSTtBQUNKO0FBQ0E7O0FBRUE7QUFDQTtBQUNBLGdCQUFnQixvQkFBb0I7QUFDcEM7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxrQkFBa0Isa0JBQWtCO0FBQ3BDO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSx3Q0FBd0M7QUFDeEM7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBLElBQUk7QUFDSjtBQUNBLElBQUk7QUFDSjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7O0FBRUE7QUFDQSw2Q0FBNkM7QUFDN0M7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0Esb0JBQW9CO0FBQ3BCLDJCQUEyQjtBQUMzQjtBQUNBO0FBQ0E7QUFDQSw4REFBOEQ7QUFDOUQsa0JBQWtCLGtCQUFrQjtBQUNwQztBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLFFBQVE7QUFDUjtBQUNBO0FBQ0EsS0FBSztBQUNMLGlEQUFpRDtBQUNqRDtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsS0FBSztBQUNMO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsSUFBSTtBQUNKO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxHQUFHO0FBQ0g7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxrQkFBa0Isa0JBQWtCLE9BQU87QUFDM0M7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEdBQUc7QUFDSDtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLE9BQU87QUFDUDtBQUNBO0FBQ0E7QUFDQSxLQUFLO0FBQ0wsR0FBRztBQUNIO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0EsNkNBQTZDO0FBQzdDO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEdBQUc7O0FBRUg7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsR0FBRztBQUNIO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxHQUFHO0FBQ0g7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBLEtBQUs7QUFDTDtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQSxLQUFLO0FBQ0w7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0Esd0JBQXdCO0FBQ3hCO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxHQUFHO0FBQ0g7QUFDQTtBQUNBO0FBQ0EsS0FBSztBQUNMOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxNQUFNO0FBQ047QUFDQTtBQUNBO0FBQ0EsTUFBTTtBQUNOO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsS0FBSztBQUNMO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUFHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLFlBQVk7QUFDWjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxZQUFZO0FBQ1o7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxJQUFJO0FBQ0o7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLElBQUk7QUFDSjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLGtCQUFrQixrQkFBa0I7QUFDcEM7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxrQkFBa0Isa0JBQWtCO0FBQ3BDO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0EsSUFBSSxJQUEwQjtBQUM5QjtBQUNBOzs7Ozs7O1VDanlCQTtVQUNBOztVQUVBO1VBQ0E7VUFDQTtVQUNBO1VBQ0E7VUFDQTtVQUNBO1VBQ0E7VUFDQTtVQUNBO1VBQ0E7VUFDQTtVQUNBOztVQUVBO1VBQ0E7O1VBRUE7VUFDQTtVQUNBOzs7O1VFdEJBO1VBQ0E7VUFDQTtVQUNBIiwic291cmNlcyI6WyJ3ZWJwYWNrOi8vQG5ldHdvcmtlZC1hZnJhbWUvbmFmLWphbnVzLWFkYXB0ZXIvLi9ub2RlX21vZHVsZXMvQG5ldHdvcmtlZC1hZnJhbWUvbWluaWphbnVzL21pbmlqYW51cy5qcyIsIndlYnBhY2s6Ly9AbmV0d29ya2VkLWFmcmFtZS9uYWYtamFudXMtYWRhcHRlci8uL3NyYy9pbmRleC5qcyIsIndlYnBhY2s6Ly9AbmV0d29ya2VkLWFmcmFtZS9uYWYtamFudXMtYWRhcHRlci8uL25vZGVfbW9kdWxlcy9zZHAvc2RwLmpzIiwid2VicGFjazovL0BuZXR3b3JrZWQtYWZyYW1lL25hZi1qYW51cy1hZGFwdGVyL3dlYnBhY2svYm9vdHN0cmFwIiwid2VicGFjazovL0BuZXR3b3JrZWQtYWZyYW1lL25hZi1qYW51cy1hZGFwdGVyL3dlYnBhY2svYmVmb3JlLXN0YXJ0dXAiLCJ3ZWJwYWNrOi8vQG5ldHdvcmtlZC1hZnJhbWUvbmFmLWphbnVzLWFkYXB0ZXIvd2VicGFjay9zdGFydHVwIiwid2VicGFjazovL0BuZXR3b3JrZWQtYWZyYW1lL25hZi1qYW51cy1hZGFwdGVyL3dlYnBhY2svYWZ0ZXItc3RhcnR1cCJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFJlcHJlc2VudHMgYSBoYW5kbGUgdG8gYSBzaW5nbGUgSmFudXMgcGx1Z2luIG9uIGEgSmFudXMgc2Vzc2lvbi4gRWFjaCBXZWJSVEMgY29ubmVjdGlvbiB0byB0aGUgSmFudXMgc2VydmVyIHdpbGwgYmVcbiAqIGFzc29jaWF0ZWQgd2l0aCBhIHNpbmdsZSBoYW5kbGUuIE9uY2UgYXR0YWNoZWQgdG8gdGhlIHNlcnZlciwgdGhpcyBoYW5kbGUgd2lsbCBiZSBnaXZlbiBhIHVuaXF1ZSBJRCB3aGljaCBzaG91bGQgYmVcbiAqIHVzZWQgdG8gYXNzb2NpYXRlIGl0IHdpdGggZnV0dXJlIHNpZ25hbGxpbmcgbWVzc2FnZXMuXG4gKlxuICogU2VlIGh0dHBzOi8vamFudXMuY29uZi5tZWV0ZWNoby5jb20vZG9jcy9yZXN0Lmh0bWwjaGFuZGxlcy5cbiAqKi9cbmZ1bmN0aW9uIEphbnVzUGx1Z2luSGFuZGxlKHNlc3Npb24pIHtcbiAgdGhpcy5zZXNzaW9uID0gc2Vzc2lvbjtcbiAgdGhpcy5pZCA9IHVuZGVmaW5lZDtcbn1cblxuLyoqIEF0dGFjaGVzIHRoaXMgaGFuZGxlIHRvIHRoZSBKYW51cyBzZXJ2ZXIgYW5kIHNldHMgaXRzIElELiAqKi9cbkphbnVzUGx1Z2luSGFuZGxlLnByb3RvdHlwZS5hdHRhY2ggPSBmdW5jdGlvbihwbHVnaW4sIGxvb3BfaW5kZXgpIHtcbiAgdmFyIHBheWxvYWQgPSB7IHBsdWdpbjogcGx1Z2luLCBsb29wX2luZGV4OiBsb29wX2luZGV4LCBcImZvcmNlLWJ1bmRsZVwiOiB0cnVlLCBcImZvcmNlLXJ0Y3AtbXV4XCI6IHRydWUgfTtcbiAgcmV0dXJuIHRoaXMuc2Vzc2lvbi5zZW5kKFwiYXR0YWNoXCIsIHBheWxvYWQpLnRoZW4ocmVzcCA9PiB7XG4gICAgdGhpcy5pZCA9IHJlc3AuZGF0YS5pZDtcbiAgICByZXR1cm4gcmVzcDtcbiAgfSk7XG59O1xuXG4vKiogRGV0YWNoZXMgdGhpcyBoYW5kbGUuICoqL1xuSmFudXNQbHVnaW5IYW5kbGUucHJvdG90eXBlLmRldGFjaCA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5zZW5kKFwiZGV0YWNoXCIpO1xufTtcblxuLyoqIFJlZ2lzdGVycyBhIGNhbGxiYWNrIHRvIGJlIGZpcmVkIHVwb24gdGhlIHJlY2VwdGlvbiBvZiBhbnkgaW5jb21pbmcgSmFudXMgc2lnbmFscyBmb3IgdGhpcyBwbHVnaW4gaGFuZGxlIHdpdGggdGhlXG4gKiBgamFudXNgIGF0dHJpYnV0ZSBlcXVhbCB0byBgZXZgLlxuICoqL1xuSmFudXNQbHVnaW5IYW5kbGUucHJvdG90eXBlLm9uID0gZnVuY3Rpb24oZXYsIGNhbGxiYWNrKSB7XG4gIHJldHVybiB0aGlzLnNlc3Npb24ub24oZXYsIHNpZ25hbCA9PiB7XG4gICAgaWYgKHNpZ25hbC5zZW5kZXIgPT0gdGhpcy5pZCkge1xuICAgICAgY2FsbGJhY2soc2lnbmFsKTtcbiAgICB9XG4gIH0pO1xufTtcblxuLyoqXG4gKiBTZW5kcyBhIHNpZ25hbCBhc3NvY2lhdGVkIHdpdGggdGhpcyBoYW5kbGUuIFNpZ25hbHMgc2hvdWxkIGJlIEpTT04tc2VyaWFsaXphYmxlIG9iamVjdHMuIFJldHVybnMgYSBwcm9taXNlIHRoYXQgd2lsbFxuICogYmUgcmVzb2x2ZWQgb3IgcmVqZWN0ZWQgd2hlbiBhIHJlc3BvbnNlIHRvIHRoaXMgc2lnbmFsIGlzIHJlY2VpdmVkLCBvciB3aGVuIG5vIHJlc3BvbnNlIGlzIHJlY2VpdmVkIHdpdGhpbiB0aGVcbiAqIHNlc3Npb24gdGltZW91dC5cbiAqKi9cbkphbnVzUGx1Z2luSGFuZGxlLnByb3RvdHlwZS5zZW5kID0gZnVuY3Rpb24odHlwZSwgc2lnbmFsKSB7XG4gIHJldHVybiB0aGlzLnNlc3Npb24uc2VuZCh0eXBlLCBPYmplY3QuYXNzaWduKHsgaGFuZGxlX2lkOiB0aGlzLmlkIH0sIHNpZ25hbCkpO1xufTtcblxuLyoqIFNlbmRzIGEgcGx1Z2luLXNwZWNpZmljIG1lc3NhZ2UgYXNzb2NpYXRlZCB3aXRoIHRoaXMgaGFuZGxlLiAqKi9cbkphbnVzUGx1Z2luSGFuZGxlLnByb3RvdHlwZS5zZW5kTWVzc2FnZSA9IGZ1bmN0aW9uKGJvZHkpIHtcbiAgcmV0dXJuIHRoaXMuc2VuZChcIm1lc3NhZ2VcIiwgeyBib2R5OiBib2R5IH0pO1xufTtcblxuLyoqIFNlbmRzIGEgSlNFUCBvZmZlciBvciBhbnN3ZXIgYXNzb2NpYXRlZCB3aXRoIHRoaXMgaGFuZGxlLiAqKi9cbkphbnVzUGx1Z2luSGFuZGxlLnByb3RvdHlwZS5zZW5kSnNlcCA9IGZ1bmN0aW9uKGpzZXApIHtcbiAgcmV0dXJuIHRoaXMuc2VuZChcIm1lc3NhZ2VcIiwgeyBib2R5OiB7fSwganNlcDoganNlcCB9KTtcbn07XG5cbi8qKiBTZW5kcyBhbiBJQ0UgdHJpY2tsZSBjYW5kaWRhdGUgYXNzb2NpYXRlZCB3aXRoIHRoaXMgaGFuZGxlLiAqKi9cbkphbnVzUGx1Z2luSGFuZGxlLnByb3RvdHlwZS5zZW5kVHJpY2tsZSA9IGZ1bmN0aW9uKGNhbmRpZGF0ZSkge1xuICByZXR1cm4gdGhpcy5zZW5kKFwidHJpY2tsZVwiLCB7IGNhbmRpZGF0ZTogY2FuZGlkYXRlIH0pO1xufTtcblxuLyoqXG4gKiBSZXByZXNlbnRzIGEgSmFudXMgc2Vzc2lvbiAtLSBhIEphbnVzIGNvbnRleHQgZnJvbSB3aXRoaW4gd2hpY2ggeW91IGNhbiBvcGVuIG11bHRpcGxlIGhhbmRsZXMgYW5kIGNvbm5lY3Rpb25zLiBPbmNlXG4gKiBjcmVhdGVkLCB0aGlzIHNlc3Npb24gd2lsbCBiZSBnaXZlbiBhIHVuaXF1ZSBJRCB3aGljaCBzaG91bGQgYmUgdXNlZCB0byBhc3NvY2lhdGUgaXQgd2l0aCBmdXR1cmUgc2lnbmFsbGluZyBtZXNzYWdlcy5cbiAqXG4gKiBTZWUgaHR0cHM6Ly9qYW51cy5jb25mLm1lZXRlY2hvLmNvbS9kb2NzL3Jlc3QuaHRtbCNzZXNzaW9ucy5cbiAqKi9cbmZ1bmN0aW9uIEphbnVzU2Vzc2lvbihvdXRwdXQsIG9wdGlvbnMpIHtcbiAgdGhpcy5vdXRwdXQgPSBvdXRwdXQ7XG4gIHRoaXMuaWQgPSB1bmRlZmluZWQ7XG4gIHRoaXMubmV4dFR4SWQgPSAwO1xuICB0aGlzLnR4bnMgPSB7fTtcbiAgdGhpcy5ldmVudEhhbmRsZXJzID0ge307XG4gIHRoaXMub3B0aW9ucyA9IE9iamVjdC5hc3NpZ24oe1xuICAgIHZlcmJvc2U6IGZhbHNlLFxuICAgIHRpbWVvdXRNczogMTAwMDAsXG4gICAga2VlcGFsaXZlTXM6IDMwMDAwXG4gIH0sIG9wdGlvbnMpO1xufVxuXG4vKiogQ3JlYXRlcyB0aGlzIHNlc3Npb24gb24gdGhlIEphbnVzIHNlcnZlciBhbmQgc2V0cyBpdHMgSUQuICoqL1xuSmFudXNTZXNzaW9uLnByb3RvdHlwZS5jcmVhdGUgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuc2VuZChcImNyZWF0ZVwiKS50aGVuKHJlc3AgPT4ge1xuICAgIHRoaXMuaWQgPSByZXNwLmRhdGEuaWQ7XG4gICAgcmV0dXJuIHJlc3A7XG4gIH0pO1xufTtcblxuLyoqXG4gKiBEZXN0cm95cyB0aGlzIHNlc3Npb24uIE5vdGUgdGhhdCB1cG9uIGRlc3RydWN0aW9uLCBKYW51cyB3aWxsIGFsc28gY2xvc2UgdGhlIHNpZ25hbGxpbmcgdHJhbnNwb3J0IChpZiBhcHBsaWNhYmxlKSBhbmRcbiAqIGFueSBvcGVuIFdlYlJUQyBjb25uZWN0aW9ucy5cbiAqKi9cbkphbnVzU2Vzc2lvbi5wcm90b3R5cGUuZGVzdHJveSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5zZW5kKFwiZGVzdHJveVwiKS50aGVuKChyZXNwKSA9PiB7XG4gICAgdGhpcy5kaXNwb3NlKCk7XG4gICAgcmV0dXJuIHJlc3A7XG4gIH0pO1xufTtcblxuLyoqXG4gKiBEaXNwb3NlcyBvZiB0aGlzIHNlc3Npb24gaW4gYSB3YXkgc3VjaCB0aGF0IG5vIGZ1cnRoZXIgaW5jb21pbmcgc2lnbmFsbGluZyBtZXNzYWdlcyB3aWxsIGJlIHByb2Nlc3NlZC5cbiAqIE91dHN0YW5kaW5nIHRyYW5zYWN0aW9ucyB3aWxsIGJlIHJlamVjdGVkLlxuICoqL1xuSmFudXNTZXNzaW9uLnByb3RvdHlwZS5kaXNwb3NlID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuX2tpbGxLZWVwYWxpdmUoKTtcbiAgdGhpcy5ldmVudEhhbmRsZXJzID0ge307XG4gIGZvciAodmFyIHR4SWQgaW4gdGhpcy50eG5zKSB7XG4gICAgaWYgKHRoaXMudHhucy5oYXNPd25Qcm9wZXJ0eSh0eElkKSkge1xuICAgICAgdmFyIHR4biA9IHRoaXMudHhuc1t0eElkXTtcbiAgICAgIGNsZWFyVGltZW91dCh0eG4udGltZW91dCk7XG4gICAgICB0eG4ucmVqZWN0KG5ldyBFcnJvcihcIkphbnVzIHNlc3Npb24gd2FzIGRpc3Bvc2VkLlwiKSk7XG4gICAgICBkZWxldGUgdGhpcy50eG5zW3R4SWRdO1xuICAgIH1cbiAgfVxufTtcblxuLyoqXG4gKiBXaGV0aGVyIHRoaXMgc2lnbmFsIHJlcHJlc2VudHMgYW4gZXJyb3IsIGFuZCB0aGUgYXNzb2NpYXRlZCBwcm9taXNlIChpZiBhbnkpIHNob3VsZCBiZSByZWplY3RlZC5cbiAqIFVzZXJzIHNob3VsZCBvdmVycmlkZSB0aGlzIHRvIGhhbmRsZSBhbnkgY3VzdG9tIHBsdWdpbi1zcGVjaWZpYyBlcnJvciBjb252ZW50aW9ucy5cbiAqKi9cbkphbnVzU2Vzc2lvbi5wcm90b3R5cGUuaXNFcnJvciA9IGZ1bmN0aW9uKHNpZ25hbCkge1xuICByZXR1cm4gc2lnbmFsLmphbnVzID09PSBcImVycm9yXCI7XG59O1xuXG4vKiogUmVnaXN0ZXJzIGEgY2FsbGJhY2sgdG8gYmUgZmlyZWQgdXBvbiB0aGUgcmVjZXB0aW9uIG9mIGFueSBpbmNvbWluZyBKYW51cyBzaWduYWxzIGZvciB0aGlzIHNlc3Npb24gd2l0aCB0aGVcbiAqIGBqYW51c2AgYXR0cmlidXRlIGVxdWFsIHRvIGBldmAuXG4gKiovXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLm9uID0gZnVuY3Rpb24oZXYsIGNhbGxiYWNrKSB7XG4gIHZhciBoYW5kbGVycyA9IHRoaXMuZXZlbnRIYW5kbGVyc1tldl07XG4gIGlmIChoYW5kbGVycyA9PSBudWxsKSB7XG4gICAgaGFuZGxlcnMgPSB0aGlzLmV2ZW50SGFuZGxlcnNbZXZdID0gW107XG4gIH1cbiAgaGFuZGxlcnMucHVzaChjYWxsYmFjayk7XG59O1xuXG4vKipcbiAqIENhbGxiYWNrIGZvciByZWNlaXZpbmcgSlNPTiBzaWduYWxsaW5nIG1lc3NhZ2VzIHBlcnRpbmVudCB0byB0aGlzIHNlc3Npb24uIElmIHRoZSBzaWduYWxzIGFyZSByZXNwb25zZXMgdG8gcHJldmlvdXNseVxuICogc2VudCBzaWduYWxzLCB0aGUgcHJvbWlzZXMgZm9yIHRoZSBvdXRnb2luZyBzaWduYWxzIHdpbGwgYmUgcmVzb2x2ZWQgb3IgcmVqZWN0ZWQgYXBwcm9wcmlhdGVseSB3aXRoIHRoaXMgc2lnbmFsIGFzIGFuXG4gKiBhcmd1bWVudC5cbiAqXG4gKiBFeHRlcm5hbCBjYWxsZXJzIHNob3VsZCBjYWxsIHRoaXMgZnVuY3Rpb24gZXZlcnkgdGltZSBhIG5ldyBzaWduYWwgYXJyaXZlcyBvbiB0aGUgdHJhbnNwb3J0OyBmb3IgZXhhbXBsZSwgaW4gYVxuICogV2ViU29ja2V0J3MgYG1lc3NhZ2VgIGV2ZW50LCBvciB3aGVuIGEgbmV3IGRhdHVtIHNob3dzIHVwIGluIGFuIEhUVFAgbG9uZy1wb2xsaW5nIHJlc3BvbnNlLlxuICoqL1xuSmFudXNTZXNzaW9uLnByb3RvdHlwZS5yZWNlaXZlID0gZnVuY3Rpb24oc2lnbmFsKSB7XG4gIGlmICh0aGlzLm9wdGlvbnMudmVyYm9zZSkge1xuICAgIHRoaXMuX2xvZ0luY29taW5nKHNpZ25hbCk7XG4gIH1cbiAgaWYgKHNpZ25hbC5zZXNzaW9uX2lkICE9IHRoaXMuaWQpIHtcbiAgICBjb25zb2xlLndhcm4oXCJJbmNvcnJlY3Qgc2Vzc2lvbiBJRCByZWNlaXZlZCBpbiBKYW51cyBzaWduYWxsaW5nIG1lc3NhZ2U6IHdhcyBcIiArIHNpZ25hbC5zZXNzaW9uX2lkICsgXCIsIGV4cGVjdGVkIFwiICsgdGhpcy5pZCArIFwiLlwiKTtcbiAgfVxuXG4gIHZhciByZXNwb25zZVR5cGUgPSBzaWduYWwuamFudXM7XG4gIHZhciBoYW5kbGVycyA9IHRoaXMuZXZlbnRIYW5kbGVyc1tyZXNwb25zZVR5cGVdO1xuICBpZiAoaGFuZGxlcnMgIT0gbnVsbCkge1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgaGFuZGxlcnMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGhhbmRsZXJzW2ldKHNpZ25hbCk7XG4gICAgfVxuICB9XG5cbiAgaWYgKHNpZ25hbC50cmFuc2FjdGlvbiAhPSBudWxsKSB7XG4gICAgdmFyIHR4biA9IHRoaXMudHhuc1tzaWduYWwudHJhbnNhY3Rpb25dO1xuICAgIGlmICh0eG4gPT0gbnVsbCkge1xuICAgICAgLy8gdGhpcyBpcyBhIHJlc3BvbnNlIHRvIGEgdHJhbnNhY3Rpb24gdGhhdCB3YXNuJ3QgY2F1c2VkIHZpYSBKYW51c1Nlc3Npb24uc2VuZCwgb3IgYSBwbHVnaW4gcmVwbGllZCB0d2ljZSB0byBhXG4gICAgICAvLyBzaW5nbGUgcmVxdWVzdCwgb3IgdGhlIHNlc3Npb24gd2FzIGRpc3Bvc2VkLCBvciBzb21ldGhpbmcgZWxzZSB0aGF0IGlzbid0IHVuZGVyIG91ciBwdXJ2aWV3OyB0aGF0J3MgZmluZVxuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmIChyZXNwb25zZVR5cGUgPT09IFwiYWNrXCIgJiYgdHhuLnR5cGUgPT0gXCJtZXNzYWdlXCIpIHtcbiAgICAgIC8vIHRoaXMgaXMgYW4gYWNrIG9mIGFuIGFzeW5jaHJvbm91c2x5LXByb2Nlc3NlZCBwbHVnaW4gcmVxdWVzdCwgd2Ugc2hvdWxkIHdhaXQgdG8gcmVzb2x2ZSB0aGUgcHJvbWlzZSB1bnRpbCB0aGVcbiAgICAgIC8vIGFjdHVhbCByZXNwb25zZSBjb21lcyBpblxuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNsZWFyVGltZW91dCh0eG4udGltZW91dCk7XG5cbiAgICBkZWxldGUgdGhpcy50eG5zW3NpZ25hbC50cmFuc2FjdGlvbl07XG4gICAgKHRoaXMuaXNFcnJvcihzaWduYWwpID8gdHhuLnJlamVjdCA6IHR4bi5yZXNvbHZlKShzaWduYWwpO1xuICB9XG59O1xuXG4vKipcbiAqIFNlbmRzIGEgc2lnbmFsIGFzc29jaWF0ZWQgd2l0aCB0aGlzIHNlc3Npb24sIGJlZ2lubmluZyBhIG5ldyB0cmFuc2FjdGlvbi4gUmV0dXJucyBhIHByb21pc2UgdGhhdCB3aWxsIGJlIHJlc29sdmVkIG9yXG4gKiByZWplY3RlZCB3aGVuIGEgcmVzcG9uc2UgaXMgcmVjZWl2ZWQgaW4gdGhlIHNhbWUgdHJhbnNhY3Rpb24sIG9yIHdoZW4gbm8gcmVzcG9uc2UgaXMgcmVjZWl2ZWQgd2l0aGluIHRoZSBzZXNzaW9uXG4gKiB0aW1lb3V0LlxuICoqL1xuSmFudXNTZXNzaW9uLnByb3RvdHlwZS5zZW5kID0gZnVuY3Rpb24odHlwZSwgc2lnbmFsKSB7XG4gIHNpZ25hbCA9IE9iamVjdC5hc3NpZ24oeyB0cmFuc2FjdGlvbjogKHRoaXMubmV4dFR4SWQrKykudG9TdHJpbmcoKSB9LCBzaWduYWwpO1xuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIHZhciB0aW1lb3V0ID0gbnVsbDtcbiAgICBpZiAodGhpcy5vcHRpb25zLnRpbWVvdXRNcykge1xuICAgICAgdGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICBkZWxldGUgdGhpcy50eG5zW3NpZ25hbC50cmFuc2FjdGlvbl07XG4gICAgICAgIHJlamVjdChuZXcgRXJyb3IoXCJTaWduYWxsaW5nIHRyYW5zYWN0aW9uIHdpdGggdHhpZCBcIiArIHNpZ25hbC50cmFuc2FjdGlvbiArIFwiIHRpbWVkIG91dC5cIikpO1xuICAgICAgfSwgdGhpcy5vcHRpb25zLnRpbWVvdXRNcyk7XG4gICAgfVxuICAgIHRoaXMudHhuc1tzaWduYWwudHJhbnNhY3Rpb25dID0geyByZXNvbHZlOiByZXNvbHZlLCByZWplY3Q6IHJlamVjdCwgdGltZW91dDogdGltZW91dCwgdHlwZTogdHlwZSB9O1xuICAgIHRoaXMuX3RyYW5zbWl0KHR5cGUsIHNpZ25hbCk7XG4gIH0pO1xufTtcblxuSmFudXNTZXNzaW9uLnByb3RvdHlwZS5fdHJhbnNtaXQgPSBmdW5jdGlvbih0eXBlLCBzaWduYWwpIHtcbiAgc2lnbmFsID0gT2JqZWN0LmFzc2lnbih7IGphbnVzOiB0eXBlIH0sIHNpZ25hbCk7XG5cbiAgaWYgKHRoaXMuaWQgIT0gbnVsbCkgeyAvLyB0aGlzLmlkIGlzIHVuZGVmaW5lZCBpbiB0aGUgc3BlY2lhbCBjYXNlIHdoZW4gd2UncmUgc2VuZGluZyB0aGUgc2Vzc2lvbiBjcmVhdGUgbWVzc2FnZVxuICAgIHNpZ25hbCA9IE9iamVjdC5hc3NpZ24oeyBzZXNzaW9uX2lkOiB0aGlzLmlkIH0sIHNpZ25hbCk7XG4gIH1cblxuICBpZiAodGhpcy5vcHRpb25zLnZlcmJvc2UpIHtcbiAgICB0aGlzLl9sb2dPdXRnb2luZyhzaWduYWwpO1xuICB9XG5cbiAgdGhpcy5vdXRwdXQoSlNPTi5zdHJpbmdpZnkoc2lnbmFsKSk7XG4gIHRoaXMuX3Jlc2V0S2VlcGFsaXZlKCk7XG59O1xuXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLl9sb2dPdXRnb2luZyA9IGZ1bmN0aW9uKHNpZ25hbCkge1xuICB2YXIga2luZCA9IHNpZ25hbC5qYW51cztcbiAgaWYgKGtpbmQgPT09IFwibWVzc2FnZVwiICYmIHNpZ25hbC5qc2VwKSB7XG4gICAga2luZCA9IHNpZ25hbC5qc2VwLnR5cGU7XG4gIH1cbiAgdmFyIG1lc3NhZ2UgPSBcIj4gT3V0Z29pbmcgSmFudXMgXCIgKyAoa2luZCB8fCBcInNpZ25hbFwiKSArIFwiICgjXCIgKyBzaWduYWwudHJhbnNhY3Rpb24gKyBcIik6IFwiO1xuICBjb25zb2xlLmRlYnVnKFwiJWNcIiArIG1lc3NhZ2UsIFwiY29sb3I6ICMwNDBcIiwgc2lnbmFsKTtcbn07XG5cbkphbnVzU2Vzc2lvbi5wcm90b3R5cGUuX2xvZ0luY29taW5nID0gZnVuY3Rpb24oc2lnbmFsKSB7XG4gIHZhciBraW5kID0gc2lnbmFsLmphbnVzO1xuICB2YXIgbWVzc2FnZSA9IHNpZ25hbC50cmFuc2FjdGlvbiA/XG4gICAgICBcIjwgSW5jb21pbmcgSmFudXMgXCIgKyAoa2luZCB8fCBcInNpZ25hbFwiKSArIFwiICgjXCIgKyBzaWduYWwudHJhbnNhY3Rpb24gKyBcIik6IFwiIDpcbiAgICAgIFwiPCBJbmNvbWluZyBKYW51cyBcIiArIChraW5kIHx8IFwic2lnbmFsXCIpICsgXCI6IFwiO1xuICBjb25zb2xlLmRlYnVnKFwiJWNcIiArIG1lc3NhZ2UsIFwiY29sb3I6ICMwMDRcIiwgc2lnbmFsKTtcbn07XG5cbkphbnVzU2Vzc2lvbi5wcm90b3R5cGUuX3NlbmRLZWVwYWxpdmUgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuc2VuZChcImtlZXBhbGl2ZVwiKTtcbn07XG5cbkphbnVzU2Vzc2lvbi5wcm90b3R5cGUuX2tpbGxLZWVwYWxpdmUgPSBmdW5jdGlvbigpIHtcbiAgY2xlYXJUaW1lb3V0KHRoaXMua2VlcGFsaXZlVGltZW91dCk7XG59O1xuXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLl9yZXNldEtlZXBhbGl2ZSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLl9raWxsS2VlcGFsaXZlKCk7XG4gIGlmICh0aGlzLm9wdGlvbnMua2VlcGFsaXZlTXMpIHtcbiAgICB0aGlzLmtlZXBhbGl2ZVRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMuX3NlbmRLZWVwYWxpdmUoKS5jYXRjaChlID0+IGNvbnNvbGUuZXJyb3IoXCJFcnJvciByZWNlaXZlZCBmcm9tIGtlZXBhbGl2ZTogXCIsIGUpKTtcbiAgICB9LCB0aGlzLm9wdGlvbnMua2VlcGFsaXZlTXMpO1xuICB9XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgSmFudXNQbHVnaW5IYW5kbGUsXG4gIEphbnVzU2Vzc2lvblxufTtcbiIsIi8qIGdsb2JhbCBOQUYgKi9cbnZhciBtaiA9IHJlcXVpcmUoXCJAbmV0d29ya2VkLWFmcmFtZS9taW5pamFudXNcIik7XG5tai5KYW51c1Nlc3Npb24ucHJvdG90eXBlLnNlbmRPcmlnaW5hbCA9IG1qLkphbnVzU2Vzc2lvbi5wcm90b3R5cGUuc2VuZDtcbm1qLkphbnVzU2Vzc2lvbi5wcm90b3R5cGUuc2VuZCA9IGZ1bmN0aW9uKHR5cGUsIHNpZ25hbCkge1xuICByZXR1cm4gdGhpcy5zZW5kT3JpZ2luYWwodHlwZSwgc2lnbmFsKS5jYXRjaCgoZSkgPT4ge1xuICAgIGlmIChlLm1lc3NhZ2UgJiYgZS5tZXNzYWdlLmluZGV4T2YoXCJ0aW1lZCBvdXRcIikgPiAtMSkge1xuICAgICAgY29uc29sZS5lcnJvcihcIndlYiBzb2NrZXQgdGltZWQgb3V0XCIpO1xuICAgICAgTkFGLmNvbm5lY3Rpb24uYWRhcHRlci5yZWNvbm5lY3QoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3coZSk7XG4gICAgfVxuICB9KTtcbn1cblxudmFyIHNkcFV0aWxzID0gcmVxdWlyZShcInNkcFwiKTtcbi8vdmFyIGRlYnVnID0gcmVxdWlyZShcImRlYnVnXCIpKFwibmFmLWphbnVzLWFkYXB0ZXI6ZGVidWdcIik7XG4vL3ZhciB3YXJuID0gcmVxdWlyZShcImRlYnVnXCIpKFwibmFmLWphbnVzLWFkYXB0ZXI6d2FyblwiKTtcbi8vdmFyIGVycm9yID0gcmVxdWlyZShcImRlYnVnXCIpKFwibmFmLWphbnVzLWFkYXB0ZXI6ZXJyb3JcIik7XG52YXIgZGVidWcgPSBjb25zb2xlLmxvZztcbnZhciB3YXJuID0gY29uc29sZS53YXJuO1xudmFyIGVycm9yID0gY29uc29sZS5lcnJvcjtcbnZhciBpc1NhZmFyaSA9IC9eKCg/IWNocm9tZXxhbmRyb2lkKS4pKnNhZmFyaS9pLnRlc3QobmF2aWdhdG9yLnVzZXJBZ2VudCk7XG5cbmNvbnN0IFNVQlNDUklCRV9USU1FT1VUX01TID0gMTUwMDA7XG5cbmZ1bmN0aW9uIGRlYm91bmNlKGZuKSB7XG4gIHZhciBjdXJyID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgYXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cyk7XG4gICAgY3VyciA9IGN1cnIudGhlbihfID0+IGZuLmFwcGx5KHRoaXMsIGFyZ3MpKTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gcmFuZG9tVWludCgpIHtcbiAgcmV0dXJuIE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIE51bWJlci5NQVhfU0FGRV9JTlRFR0VSKTtcbn1cblxuZnVuY3Rpb24gdW50aWxEYXRhQ2hhbm5lbE9wZW4oZGF0YUNoYW5uZWwpIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICBpZiAoZGF0YUNoYW5uZWwucmVhZHlTdGF0ZSA9PT0gXCJvcGVuXCIpIHtcbiAgICAgIHJlc29sdmUoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgbGV0IHJlc29sdmVyLCByZWplY3RvcjtcblxuICAgICAgY29uc3QgY2xlYXIgPSAoKSA9PiB7XG4gICAgICAgIGRhdGFDaGFubmVsLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJvcGVuXCIsIHJlc29sdmVyKTtcbiAgICAgICAgZGF0YUNoYW5uZWwucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImVycm9yXCIsIHJlamVjdG9yKTtcbiAgICAgIH07XG5cbiAgICAgIHJlc29sdmVyID0gKCkgPT4ge1xuICAgICAgICBjbGVhcigpO1xuICAgICAgICByZXNvbHZlKCk7XG4gICAgICB9O1xuICAgICAgcmVqZWN0b3IgPSAoKSA9PiB7XG4gICAgICAgIGNsZWFyKCk7XG4gICAgICAgIHJlamVjdCgpO1xuICAgICAgfTtcblxuICAgICAgZGF0YUNoYW5uZWwuYWRkRXZlbnRMaXN0ZW5lcihcIm9wZW5cIiwgcmVzb2x2ZXIpO1xuICAgICAgZGF0YUNoYW5uZWwuYWRkRXZlbnRMaXN0ZW5lcihcImVycm9yXCIsIHJlamVjdG9yKTtcbiAgICB9XG4gIH0pO1xufVxuXG5jb25zdCBpc0gyNjRWaWRlb1N1cHBvcnRlZCA9ICgoKSA9PiB7XG4gIGNvbnN0IHZpZGVvID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInZpZGVvXCIpO1xuICByZXR1cm4gdmlkZW8uY2FuUGxheVR5cGUoJ3ZpZGVvL21wNDsgY29kZWNzPVwiYXZjMS40MkUwMUUsIG1wNGEuNDAuMlwiJykgIT09IFwiXCI7XG59KSgpO1xuXG5jb25zdCBPUFVTX1BBUkFNRVRFUlMgPSB7XG4gIC8vIGluZGljYXRlcyB0aGF0IHdlIHdhbnQgdG8gZW5hYmxlIERUWCB0byBlbGlkZSBzaWxlbmNlIHBhY2tldHNcbiAgdXNlZHR4OiAxLFxuICAvLyBpbmRpY2F0ZXMgdGhhdCB3ZSBwcmVmZXIgdG8gcmVjZWl2ZSBtb25vIGF1ZGlvIChpbXBvcnRhbnQgZm9yIHZvaXAgcHJvZmlsZSlcbiAgc3RlcmVvOiAwLFxuICAvLyBpbmRpY2F0ZXMgdGhhdCB3ZSBwcmVmZXIgdG8gc2VuZCBtb25vIGF1ZGlvIChpbXBvcnRhbnQgZm9yIHZvaXAgcHJvZmlsZSlcbiAgXCJzcHJvcC1zdGVyZW9cIjogMFxufTtcblxuY29uc3QgREVGQVVMVF9QRUVSX0NPTk5FQ1RJT05fQ09ORklHID0ge1xuICBpY2VTZXJ2ZXJzOiBbeyB1cmxzOiBcInN0dW46c3R1bjEubC5nb29nbGUuY29tOjE5MzAyXCIgfSwgeyB1cmxzOiBcInN0dW46c3R1bjIubC5nb29nbGUuY29tOjE5MzAyXCIgfV1cbn07XG5cbmNvbnN0IFdTX05PUk1BTF9DTE9TVVJFID0gMTAwMDtcblxuY2xhc3MgSmFudXNBZGFwdGVyIHtcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgdGhpcy5yb29tID0gbnVsbDtcbiAgICAvLyBXZSBleHBlY3QgdGhlIGNvbnN1bWVyIHRvIHNldCBhIGNsaWVudCBpZCBiZWZvcmUgY29ubmVjdGluZy5cbiAgICB0aGlzLmNsaWVudElkID0gbnVsbDtcbiAgICB0aGlzLmpvaW5Ub2tlbiA9IG51bGw7XG5cbiAgICB0aGlzLnNlcnZlclVybCA9IG51bGw7XG4gICAgdGhpcy53ZWJSdGNPcHRpb25zID0ge307XG4gICAgdGhpcy5wZWVyQ29ubmVjdGlvbkNvbmZpZyA9IG51bGw7XG4gICAgdGhpcy53cyA9IG51bGw7XG4gICAgdGhpcy5zZXNzaW9uID0gbnVsbDtcbiAgICB0aGlzLnJlbGlhYmxlVHJhbnNwb3J0ID0gXCJkYXRhY2hhbm5lbFwiO1xuICAgIHRoaXMudW5yZWxpYWJsZVRyYW5zcG9ydCA9IFwiZGF0YWNoYW5uZWxcIjtcblxuICAgIC8vIEluIHRoZSBldmVudCB0aGUgc2VydmVyIHJlc3RhcnRzIGFuZCBhbGwgY2xpZW50cyBsb3NlIGNvbm5lY3Rpb24sIHJlY29ubmVjdCB3aXRoXG4gICAgLy8gc29tZSByYW5kb20gaml0dGVyIGFkZGVkIHRvIHByZXZlbnQgc2ltdWx0YW5lb3VzIHJlY29ubmVjdGlvbiByZXF1ZXN0cy5cbiAgICB0aGlzLmluaXRpYWxSZWNvbm5lY3Rpb25EZWxheSA9IDEwMDAgKiBNYXRoLnJhbmRvbSgpO1xuICAgIHRoaXMucmVjb25uZWN0aW9uRGVsYXkgPSB0aGlzLmluaXRpYWxSZWNvbm5lY3Rpb25EZWxheTtcbiAgICB0aGlzLnJlY29ubmVjdGlvblRpbWVvdXQgPSBudWxsO1xuICAgIHRoaXMubWF4UmVjb25uZWN0aW9uQXR0ZW1wdHMgPSAxMDtcbiAgICB0aGlzLnJlY29ubmVjdGlvbkF0dGVtcHRzID0gMDtcblxuICAgIHRoaXMucHVibGlzaGVyID0gbnVsbDtcbiAgICB0aGlzLm9jY3VwYW50cyA9IHt9O1xuICAgIHRoaXMubGVmdE9jY3VwYW50cyA9IG5ldyBTZXQoKTtcbiAgICB0aGlzLm1lZGlhU3RyZWFtcyA9IHt9O1xuICAgIHRoaXMubG9jYWxNZWRpYVN0cmVhbSA9IG51bGw7XG4gICAgdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cyA9IG5ldyBNYXAoKTtcblxuICAgIHRoaXMuYmxvY2tlZENsaWVudHMgPSBuZXcgTWFwKCk7XG4gICAgdGhpcy5mcm96ZW5VcGRhdGVzID0gbmV3IE1hcCgpO1xuXG4gICAgdGhpcy50aW1lT2Zmc2V0cyA9IFtdO1xuICAgIHRoaXMuc2VydmVyVGltZVJlcXVlc3RzID0gMDtcbiAgICB0aGlzLmF2Z1RpbWVPZmZzZXQgPSAwO1xuXG4gICAgdGhpcy5vbldlYnNvY2tldE9wZW4gPSB0aGlzLm9uV2Vic29ja2V0T3Blbi5iaW5kKHRoaXMpO1xuICAgIHRoaXMub25XZWJzb2NrZXRDbG9zZSA9IHRoaXMub25XZWJzb2NrZXRDbG9zZS5iaW5kKHRoaXMpO1xuICAgIHRoaXMub25XZWJzb2NrZXRNZXNzYWdlID0gdGhpcy5vbldlYnNvY2tldE1lc3NhZ2UuYmluZCh0aGlzKTtcbiAgICB0aGlzLm9uRGF0YUNoYW5uZWxNZXNzYWdlID0gdGhpcy5vbkRhdGFDaGFubmVsTWVzc2FnZS5iaW5kKHRoaXMpO1xuICAgIHRoaXMub25EYXRhID0gdGhpcy5vbkRhdGEuYmluZCh0aGlzKTtcbiAgfVxuXG4gIHNldFNlcnZlclVybCh1cmwpIHtcbiAgICB0aGlzLnNlcnZlclVybCA9IHVybDtcbiAgfVxuXG4gIHNldEFwcChhcHApIHt9XG5cbiAgc2V0Um9vbShyb29tTmFtZSkge1xuICAgIHRoaXMucm9vbSA9IHJvb21OYW1lO1xuICB9XG5cbiAgc2V0Sm9pblRva2VuKGpvaW5Ub2tlbikge1xuICAgIHRoaXMuam9pblRva2VuID0gam9pblRva2VuO1xuICB9XG5cbiAgc2V0Q2xpZW50SWQoY2xpZW50SWQpIHtcbiAgICB0aGlzLmNsaWVudElkID0gY2xpZW50SWQ7XG4gIH1cblxuICBzZXRXZWJSdGNPcHRpb25zKG9wdGlvbnMpIHtcbiAgICB0aGlzLndlYlJ0Y09wdGlvbnMgPSBvcHRpb25zO1xuICB9XG5cbiAgc2V0UGVlckNvbm5lY3Rpb25Db25maWcocGVlckNvbm5lY3Rpb25Db25maWcpIHtcbiAgICB0aGlzLnBlZXJDb25uZWN0aW9uQ29uZmlnID0gcGVlckNvbm5lY3Rpb25Db25maWc7XG4gIH1cblxuICBzZXRTZXJ2ZXJDb25uZWN0TGlzdGVuZXJzKHN1Y2Nlc3NMaXN0ZW5lciwgZmFpbHVyZUxpc3RlbmVyKSB7XG4gICAgdGhpcy5jb25uZWN0U3VjY2VzcyA9IHN1Y2Nlc3NMaXN0ZW5lcjtcbiAgICB0aGlzLmNvbm5lY3RGYWlsdXJlID0gZmFpbHVyZUxpc3RlbmVyO1xuICB9XG5cbiAgc2V0Um9vbU9jY3VwYW50TGlzdGVuZXIob2NjdXBhbnRMaXN0ZW5lcikge1xuICAgIHRoaXMub25PY2N1cGFudHNDaGFuZ2VkID0gb2NjdXBhbnRMaXN0ZW5lcjtcbiAgfVxuXG4gIHNldERhdGFDaGFubmVsTGlzdGVuZXJzKG9wZW5MaXN0ZW5lciwgY2xvc2VkTGlzdGVuZXIsIG1lc3NhZ2VMaXN0ZW5lcikge1xuICAgIHRoaXMub25PY2N1cGFudENvbm5lY3RlZCA9IG9wZW5MaXN0ZW5lcjtcbiAgICB0aGlzLm9uT2NjdXBhbnREaXNjb25uZWN0ZWQgPSBjbG9zZWRMaXN0ZW5lcjtcbiAgICB0aGlzLm9uT2NjdXBhbnRNZXNzYWdlID0gbWVzc2FnZUxpc3RlbmVyO1xuICB9XG5cbiAgc2V0UmVjb25uZWN0aW9uTGlzdGVuZXJzKHJlY29ubmVjdGluZ0xpc3RlbmVyLCByZWNvbm5lY3RlZExpc3RlbmVyLCByZWNvbm5lY3Rpb25FcnJvckxpc3RlbmVyKSB7XG4gICAgLy8gb25SZWNvbm5lY3RpbmcgaXMgY2FsbGVkIHdpdGggdGhlIG51bWJlciBvZiBtaWxsaXNlY29uZHMgdW50aWwgdGhlIG5leHQgcmVjb25uZWN0aW9uIGF0dGVtcHRcbiAgICB0aGlzLm9uUmVjb25uZWN0aW5nID0gcmVjb25uZWN0aW5nTGlzdGVuZXI7XG4gICAgLy8gb25SZWNvbm5lY3RlZCBpcyBjYWxsZWQgd2hlbiB0aGUgY29ubmVjdGlvbiBoYXMgYmVlbiByZWVzdGFibGlzaGVkXG4gICAgdGhpcy5vblJlY29ubmVjdGVkID0gcmVjb25uZWN0ZWRMaXN0ZW5lcjtcbiAgICAvLyBvblJlY29ubmVjdGlvbkVycm9yIGlzIGNhbGxlZCB3aXRoIGFuIGVycm9yIHdoZW4gbWF4UmVjb25uZWN0aW9uQXR0ZW1wdHMgaGFzIGJlZW4gcmVhY2hlZFxuICAgIHRoaXMub25SZWNvbm5lY3Rpb25FcnJvciA9IHJlY29ubmVjdGlvbkVycm9yTGlzdGVuZXI7XG4gIH1cblxuICBzZXRFdmVudExvb3BzKGxvb3BzKSB7XG4gICAgdGhpcy5sb29wcyA9IGxvb3BzO1xuICB9XG5cbiAgY29ubmVjdCgpIHtcbiAgICBkZWJ1ZyhgY29ubmVjdGluZyB0byAke3RoaXMuc2VydmVyVXJsfWApO1xuXG4gICAgY29uc3Qgd2Vic29ja2V0Q29ubmVjdGlvbiA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIHRoaXMud3MgPSBuZXcgV2ViU29ja2V0KHRoaXMuc2VydmVyVXJsLCBcImphbnVzLXByb3RvY29sXCIpO1xuXG4gICAgICB0aGlzLnNlc3Npb24gPSBuZXcgbWouSmFudXNTZXNzaW9uKHRoaXMud3Muc2VuZC5iaW5kKHRoaXMud3MpLCB7IHRpbWVvdXRNczogNDAwMDAgfSk7XG5cbiAgICAgIHRoaXMud3MuYWRkRXZlbnRMaXN0ZW5lcihcImNsb3NlXCIsIHRoaXMub25XZWJzb2NrZXRDbG9zZSk7XG4gICAgICB0aGlzLndzLmFkZEV2ZW50TGlzdGVuZXIoXCJtZXNzYWdlXCIsIHRoaXMub25XZWJzb2NrZXRNZXNzYWdlKTtcblxuICAgICAgdGhpcy53c09uT3BlbiA9ICgpID0+IHtcbiAgICAgICAgdGhpcy53cy5yZW1vdmVFdmVudExpc3RlbmVyKFwib3BlblwiLCB0aGlzLndzT25PcGVuKTtcbiAgICAgICAgdGhpcy5vbldlYnNvY2tldE9wZW4oKVxuICAgICAgICAgIC50aGVuKHJlc29sdmUpXG4gICAgICAgICAgLmNhdGNoKHJlamVjdCk7XG4gICAgICB9O1xuXG4gICAgICB0aGlzLndzLmFkZEV2ZW50TGlzdGVuZXIoXCJvcGVuXCIsIHRoaXMud3NPbk9wZW4pO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIFByb21pc2UuYWxsKFt3ZWJzb2NrZXRDb25uZWN0aW9uLCB0aGlzLnVwZGF0ZVRpbWVPZmZzZXQoKV0pO1xuICB9XG5cbiAgZGlzY29ubmVjdCgpIHtcbiAgICBkZWJ1ZyhgZGlzY29ubmVjdGluZ2ApO1xuXG4gICAgY2xlYXJUaW1lb3V0KHRoaXMucmVjb25uZWN0aW9uVGltZW91dCk7XG5cbiAgICB0aGlzLnJlbW92ZUFsbE9jY3VwYW50cygpO1xuICAgIHRoaXMubGVmdE9jY3VwYW50cyA9IG5ldyBTZXQoKTtcblxuICAgIGlmICh0aGlzLnB1Ymxpc2hlcikge1xuICAgICAgLy8gQ2xvc2UgdGhlIHB1Ymxpc2hlciBwZWVyIGNvbm5lY3Rpb24uIFdoaWNoIGFsc28gZGV0YWNoZXMgdGhlIHBsdWdpbiBoYW5kbGUuXG4gICAgICB0aGlzLnB1Ymxpc2hlci5jb25uLmNsb3NlKCk7XG4gICAgICB0aGlzLnB1Ymxpc2hlciA9IG51bGw7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuc2Vzc2lvbikge1xuICAgICAgdGhpcy5zZXNzaW9uLmRpc3Bvc2UoKTtcbiAgICAgIHRoaXMuc2Vzc2lvbiA9IG51bGw7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMud3MpIHtcbiAgICAgIHRoaXMud3MucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm9wZW5cIiwgdGhpcy53c09uT3Blbik7XG4gICAgICB0aGlzLndzLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJjbG9zZVwiLCB0aGlzLm9uV2Vic29ja2V0Q2xvc2UpO1xuICAgICAgdGhpcy53cy5yZW1vdmVFdmVudExpc3RlbmVyKFwibWVzc2FnZVwiLCB0aGlzLm9uV2Vic29ja2V0TWVzc2FnZSk7XG4gICAgICB0aGlzLndzLmNsb3NlKCk7XG4gICAgICB0aGlzLndzID0gbnVsbDtcbiAgICB9XG5cbiAgICAvLyBOb3cgdGhhdCBhbGwgUlRDUGVlckNvbm5lY3Rpb24gY2xvc2VkLCBiZSBzdXJlIHRvIG5vdCBjYWxsXG4gICAgLy8gcmVjb25uZWN0KCkgYWdhaW4gdmlhIHBlcmZvcm1EZWxheWVkUmVjb25uZWN0IGlmIHByZXZpb3VzXG4gICAgLy8gUlRDUGVlckNvbm5lY3Rpb24gd2FzIGluIHRoZSBmYWlsZWQgc3RhdGUuXG4gICAgaWYgKHRoaXMuZGVsYXllZFJlY29ubmVjdFRpbWVvdXQpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLmRlbGF5ZWRSZWNvbm5lY3RUaW1lb3V0KTtcbiAgICAgIHRoaXMuZGVsYXllZFJlY29ubmVjdFRpbWVvdXQgPSBudWxsO1xuICAgIH1cbiAgfVxuXG4gIGlzRGlzY29ubmVjdGVkKCkge1xuICAgIHJldHVybiB0aGlzLndzID09PSBudWxsO1xuICB9XG5cbiAgYXN5bmMgb25XZWJzb2NrZXRPcGVuKCkge1xuICAgIC8vIENyZWF0ZSB0aGUgSmFudXMgU2Vzc2lvblxuICAgIGF3YWl0IHRoaXMuc2Vzc2lvbi5jcmVhdGUoKTtcblxuICAgIC8vIEF0dGFjaCB0aGUgU0ZVIFBsdWdpbiBhbmQgY3JlYXRlIGEgUlRDUGVlckNvbm5lY3Rpb24gZm9yIHRoZSBwdWJsaXNoZXIuXG4gICAgLy8gVGhlIHB1Ymxpc2hlciBzZW5kcyBhdWRpbyBhbmQgb3BlbnMgdHdvIGJpZGlyZWN0aW9uYWwgZGF0YSBjaGFubmVscy5cbiAgICAvLyBPbmUgcmVsaWFibGUgZGF0YWNoYW5uZWwgYW5kIG9uZSB1bnJlbGlhYmxlLlxuICAgIHRoaXMucHVibGlzaGVyID0gYXdhaXQgdGhpcy5jcmVhdGVQdWJsaXNoZXIoKTtcblxuICAgIC8vIENhbGwgdGhlIG5hZiBjb25uZWN0U3VjY2VzcyBjYWxsYmFjayBiZWZvcmUgd2Ugc3RhcnQgcmVjZWl2aW5nIFdlYlJUQyBtZXNzYWdlcy5cbiAgICB0aGlzLmNvbm5lY3RTdWNjZXNzKHRoaXMuY2xpZW50SWQpO1xuXG4gICAgY29uc3QgYWRkT2NjdXBhbnRQcm9taXNlcyA9IFtdO1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aGlzLnB1Ymxpc2hlci5pbml0aWFsT2NjdXBhbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBjb25zdCBvY2N1cGFudElkID0gdGhpcy5wdWJsaXNoZXIuaW5pdGlhbE9jY3VwYW50c1tpXTtcbiAgICAgIGlmIChvY2N1cGFudElkID09PSB0aGlzLmNsaWVudElkKSBjb250aW51ZTsgLy8gSGFwcGVucyBkdXJpbmcgbm9uLWdyYWNlZnVsIHJlY29ubmVjdHMgZHVlIHRvIHpvbWJpZSBzZXNzaW9uc1xuICAgICAgYWRkT2NjdXBhbnRQcm9taXNlcy5wdXNoKHRoaXMuYWRkT2NjdXBhbnQob2NjdXBhbnRJZCkpO1xuICAgIH1cblxuICAgIGF3YWl0IFByb21pc2UuYWxsKGFkZE9jY3VwYW50UHJvbWlzZXMpO1xuICB9XG5cbiAgb25XZWJzb2NrZXRDbG9zZShldmVudCkge1xuICAgIC8vIFRoZSBjb25uZWN0aW9uIHdhcyBjbG9zZWQgc3VjY2Vzc2Z1bGx5LiBEb24ndCB0cnkgdG8gcmVjb25uZWN0LlxuICAgIGlmIChldmVudC5jb2RlID09PSBXU19OT1JNQUxfQ0xPU1VSRSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnNvbGUud2FybihcIkphbnVzIHdlYnNvY2tldCBjbG9zZWQgdW5leHBlY3RlZGx5LlwiKTtcbiAgICBpZiAodGhpcy5vblJlY29ubmVjdGluZykge1xuICAgICAgdGhpcy5vblJlY29ubmVjdGluZyh0aGlzLnJlY29ubmVjdGlvbkRlbGF5KTtcbiAgICB9XG5cbiAgICB0aGlzLnJlY29ubmVjdGlvblRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHRoaXMucmVjb25uZWN0KCksIHRoaXMucmVjb25uZWN0aW9uRGVsYXkpO1xuICB9XG5cbiAgcmVjb25uZWN0KCkge1xuICAgIC8vIERpc3Bvc2Ugb2YgYWxsIG5ldHdvcmtlZCBlbnRpdGllcyBhbmQgb3RoZXIgcmVzb3VyY2VzIHRpZWQgdG8gdGhlIHNlc3Npb24uXG4gICAgdGhpcy5kaXNjb25uZWN0KCk7XG5cbiAgICB0aGlzLmNvbm5lY3QoKVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICB0aGlzLnJlY29ubmVjdGlvbkRlbGF5ID0gdGhpcy5pbml0aWFsUmVjb25uZWN0aW9uRGVsYXk7XG4gICAgICAgIHRoaXMucmVjb25uZWN0aW9uQXR0ZW1wdHMgPSAwO1xuXG4gICAgICAgIGlmICh0aGlzLm9uUmVjb25uZWN0ZWQpIHtcbiAgICAgICAgICB0aGlzLm9uUmVjb25uZWN0ZWQoKTtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIHRoaXMucmVjb25uZWN0aW9uRGVsYXkgKz0gMTAwMDtcbiAgICAgICAgdGhpcy5yZWNvbm5lY3Rpb25BdHRlbXB0cysrO1xuXG4gICAgICAgIGlmICh0aGlzLnJlY29ubmVjdGlvbkF0dGVtcHRzID4gdGhpcy5tYXhSZWNvbm5lY3Rpb25BdHRlbXB0cyAmJiB0aGlzLm9uUmVjb25uZWN0aW9uRXJyb3IpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5vblJlY29ubmVjdGlvbkVycm9yKFxuICAgICAgICAgICAgbmV3IEVycm9yKFwiQ29ubmVjdGlvbiBjb3VsZCBub3QgYmUgcmVlc3RhYmxpc2hlZCwgZXhjZWVkZWQgbWF4aW11bSBudW1iZXIgb2YgcmVjb25uZWN0aW9uIGF0dGVtcHRzLlwiKVxuICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zb2xlLndhcm4oXCJFcnJvciBkdXJpbmcgcmVjb25uZWN0LCByZXRyeWluZy5cIik7XG4gICAgICAgIGNvbnNvbGUud2FybihlcnJvcik7XG5cbiAgICAgICAgaWYgKHRoaXMub25SZWNvbm5lY3RpbmcpIHtcbiAgICAgICAgICB0aGlzLm9uUmVjb25uZWN0aW5nKHRoaXMucmVjb25uZWN0aW9uRGVsYXkpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5yZWNvbm5lY3Rpb25UaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB0aGlzLnJlY29ubmVjdCgpLCB0aGlzLnJlY29ubmVjdGlvbkRlbGF5KTtcbiAgICAgIH0pO1xuICB9XG5cbiAgcGVyZm9ybURlbGF5ZWRSZWNvbm5lY3QoKSB7XG4gICAgaWYgKHRoaXMuZGVsYXllZFJlY29ubmVjdFRpbWVvdXQpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLmRlbGF5ZWRSZWNvbm5lY3RUaW1lb3V0KTtcbiAgICB9XG5cbiAgICB0aGlzLmRlbGF5ZWRSZWNvbm5lY3RUaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0aGlzLmRlbGF5ZWRSZWNvbm5lY3RUaW1lb3V0ID0gbnVsbDtcbiAgICAgIHRoaXMucmVjb25uZWN0KCk7XG4gICAgfSwgMTAwMDApO1xuICB9XG5cbiAgb25XZWJzb2NrZXRNZXNzYWdlKGV2ZW50KSB7XG4gICAgdGhpcy5zZXNzaW9uLnJlY2VpdmUoSlNPTi5wYXJzZShldmVudC5kYXRhKSk7XG4gIH1cblxuICBhc3luYyBhZGRPY2N1cGFudChvY2N1cGFudElkKSB7XG4gICAgaWYgKHRoaXMub2NjdXBhbnRzW29jY3VwYW50SWRdKSB7XG4gICAgICB0aGlzLnJlbW92ZU9jY3VwYW50KG9jY3VwYW50SWQpO1xuICAgIH1cblxuICAgIHRoaXMubGVmdE9jY3VwYW50cy5kZWxldGUob2NjdXBhbnRJZCk7XG5cbiAgICB2YXIgc3Vic2NyaWJlciA9IGF3YWl0IHRoaXMuY3JlYXRlU3Vic2NyaWJlcihvY2N1cGFudElkKTtcblxuICAgIGlmICghc3Vic2NyaWJlcikgcmV0dXJuO1xuXG4gICAgdGhpcy5vY2N1cGFudHNbb2NjdXBhbnRJZF0gPSBzdWJzY3JpYmVyO1xuXG4gICAgdGhpcy5zZXRNZWRpYVN0cmVhbShvY2N1cGFudElkLCBzdWJzY3JpYmVyLm1lZGlhU3RyZWFtKTtcblxuICAgIC8vIENhbGwgdGhlIE5ldHdvcmtlZCBBRnJhbWUgY2FsbGJhY2tzIGZvciB0aGUgbmV3IG9jY3VwYW50LlxuICAgIHRoaXMub25PY2N1cGFudENvbm5lY3RlZChvY2N1cGFudElkKTtcbiAgICB0aGlzLm9uT2NjdXBhbnRzQ2hhbmdlZCh0aGlzLm9jY3VwYW50cyk7XG5cbiAgICByZXR1cm4gc3Vic2NyaWJlcjtcbiAgfVxuXG4gIHJlbW92ZUFsbE9jY3VwYW50cygpIHtcbiAgICBmb3IgKGNvbnN0IG9jY3VwYW50SWQgb2YgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXModGhpcy5vY2N1cGFudHMpKSB7XG4gICAgICB0aGlzLnJlbW92ZU9jY3VwYW50KG9jY3VwYW50SWQpO1xuICAgIH1cbiAgfVxuXG4gIHJlbW92ZU9jY3VwYW50KG9jY3VwYW50SWQpIHtcbiAgICB0aGlzLmxlZnRPY2N1cGFudHMuYWRkKG9jY3VwYW50SWQpO1xuXG4gICAgaWYgKHRoaXMub2NjdXBhbnRzW29jY3VwYW50SWRdKSB7XG4gICAgICAvLyBDbG9zZSB0aGUgc3Vic2NyaWJlciBwZWVyIGNvbm5lY3Rpb24uIFdoaWNoIGFsc28gZGV0YWNoZXMgdGhlIHBsdWdpbiBoYW5kbGUuXG4gICAgICB0aGlzLm9jY3VwYW50c1tvY2N1cGFudElkXS5jb25uLmNsb3NlKCk7XG4gICAgICBkZWxldGUgdGhpcy5vY2N1cGFudHNbb2NjdXBhbnRJZF07XG4gICAgfVxuXG4gICAgaWYgKHRoaXMubWVkaWFTdHJlYW1zW29jY3VwYW50SWRdKSB7XG4gICAgICBkZWxldGUgdGhpcy5tZWRpYVN0cmVhbXNbb2NjdXBhbnRJZF07XG4gICAgfVxuXG4gICAgaWYgKHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuaGFzKG9jY3VwYW50SWQpKSB7XG4gICAgICBjb25zdCBtc2cgPSBcIlRoZSB1c2VyIGRpc2Nvbm5lY3RlZCBiZWZvcmUgdGhlIG1lZGlhIHN0cmVhbSB3YXMgcmVzb2x2ZWQuXCI7XG4gICAgICB0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmdldChvY2N1cGFudElkKS5hdWRpby5yZWplY3QobXNnKTtcbiAgICAgIHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuZ2V0KG9jY3VwYW50SWQpLnZpZGVvLnJlamVjdChtc2cpO1xuICAgICAgdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5kZWxldGUob2NjdXBhbnRJZCk7XG4gICAgfVxuXG4gICAgLy8gQ2FsbCB0aGUgTmV0d29ya2VkIEFGcmFtZSBjYWxsYmFja3MgZm9yIHRoZSByZW1vdmVkIG9jY3VwYW50LlxuICAgIHRoaXMub25PY2N1cGFudERpc2Nvbm5lY3RlZChvY2N1cGFudElkKTtcbiAgICB0aGlzLm9uT2NjdXBhbnRzQ2hhbmdlZCh0aGlzLm9jY3VwYW50cyk7XG4gIH1cblxuICBhc3NvY2lhdGUoY29ubiwgaGFuZGxlKSB7XG4gICAgY29ubi5hZGRFdmVudExpc3RlbmVyKFwiaWNlY2FuZGlkYXRlXCIsIGV2ID0+IHtcbiAgICAgIGhhbmRsZS5zZW5kVHJpY2tsZShldi5jYW5kaWRhdGUgfHwgbnVsbCkuY2F0Y2goZSA9PiBlcnJvcihcIkVycm9yIHRyaWNrbGluZyBJQ0U6ICVvXCIsIGUpKTtcbiAgICB9KTtcbiAgICBjb25uLmFkZEV2ZW50TGlzdGVuZXIoXCJpY2Vjb25uZWN0aW9uc3RhdGVjaGFuZ2VcIiwgZXYgPT4ge1xuICAgICAgaWYgKGNvbm4uaWNlQ29ubmVjdGlvblN0YXRlID09PSBcImNvbm5lY3RlZFwiKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKFwiSUNFIHN0YXRlIGNoYW5nZWQgdG8gY29ubmVjdGVkXCIpO1xuICAgICAgfVxuICAgICAgaWYgKGNvbm4uaWNlQ29ubmVjdGlvblN0YXRlID09PSBcImRpc2Nvbm5lY3RlZFwiKSB7XG4gICAgICAgIGNvbnNvbGUud2FybihcIklDRSBzdGF0ZSBjaGFuZ2VkIHRvIGRpc2Nvbm5lY3RlZFwiKTtcbiAgICAgIH1cbiAgICAgIGlmIChjb25uLmljZUNvbm5lY3Rpb25TdGF0ZSA9PT0gXCJmYWlsZWRcIikge1xuICAgICAgICBjb25zb2xlLndhcm4oXCJJQ0UgZmFpbHVyZSBkZXRlY3RlZC4gUmVjb25uZWN0aW5nIGluIDEwcy5cIik7XG4gICAgICAgIHRoaXMucGVyZm9ybURlbGF5ZWRSZWNvbm5lY3QoKTtcbiAgICAgIH1cbiAgICB9KVxuXG4gICAgLy8gd2UgaGF2ZSB0byBkZWJvdW5jZSB0aGVzZSBiZWNhdXNlIGphbnVzIGdldHMgYW5ncnkgaWYgeW91IHNlbmQgaXQgYSBuZXcgU0RQIGJlZm9yZVxuICAgIC8vIGl0J3MgZmluaXNoZWQgcHJvY2Vzc2luZyBhbiBleGlzdGluZyBTRFAuIGluIGFjdHVhbGl0eSwgaXQgc2VlbXMgbGlrZSB0aGlzIGlzIG1heWJlXG4gICAgLy8gdG9vIGxpYmVyYWwgYW5kIHdlIG5lZWQgdG8gd2FpdCBzb21lIGFtb3VudCBvZiB0aW1lIGFmdGVyIGFuIG9mZmVyIGJlZm9yZSBzZW5kaW5nIGFub3RoZXIsXG4gICAgLy8gYnV0IHdlIGRvbid0IGN1cnJlbnRseSBrbm93IGFueSBnb29kIHdheSBvZiBkZXRlY3RpbmcgZXhhY3RseSBob3cgbG9uZyA6KFxuICAgIGNvbm4uYWRkRXZlbnRMaXN0ZW5lcihcbiAgICAgIFwibmVnb3RpYXRpb25uZWVkZWRcIixcbiAgICAgIGRlYm91bmNlKGV2ID0+IHtcbiAgICAgICAgZGVidWcoXCJTZW5kaW5nIG5ldyBvZmZlciBmb3IgaGFuZGxlOiAlb1wiLCBoYW5kbGUpO1xuICAgICAgICB2YXIgb2ZmZXIgPSBjb25uLmNyZWF0ZU9mZmVyKCkudGhlbih0aGlzLmNvbmZpZ3VyZVB1Ymxpc2hlclNkcCkudGhlbih0aGlzLmZpeFNhZmFyaUljZVVGcmFnKTtcbiAgICAgICAgdmFyIGxvY2FsID0gb2ZmZXIudGhlbihvID0+IGNvbm4uc2V0TG9jYWxEZXNjcmlwdGlvbihvKSk7XG4gICAgICAgIHZhciByZW1vdGUgPSBvZmZlcjtcblxuICAgICAgICByZW1vdGUgPSByZW1vdGVcbiAgICAgICAgICAudGhlbih0aGlzLmZpeFNhZmFyaUljZVVGcmFnKVxuICAgICAgICAgIC50aGVuKGogPT4gaGFuZGxlLnNlbmRKc2VwKGopKVxuICAgICAgICAgIC50aGVuKHIgPT4gY29ubi5zZXRSZW1vdGVEZXNjcmlwdGlvbihyLmpzZXApKTtcbiAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKFtsb2NhbCwgcmVtb3RlXSkuY2F0Y2goZSA9PiBlcnJvcihcIkVycm9yIG5lZ290aWF0aW5nIG9mZmVyOiAlb1wiLCBlKSk7XG4gICAgICB9KVxuICAgICk7XG4gICAgaGFuZGxlLm9uKFxuICAgICAgXCJldmVudFwiLFxuICAgICAgZGVib3VuY2UoZXYgPT4ge1xuICAgICAgICB2YXIganNlcCA9IGV2LmpzZXA7XG4gICAgICAgIGlmIChqc2VwICYmIGpzZXAudHlwZSA9PSBcIm9mZmVyXCIpIHtcbiAgICAgICAgICBkZWJ1ZyhcIkFjY2VwdGluZyBuZXcgb2ZmZXIgZm9yIGhhbmRsZTogJW9cIiwgaGFuZGxlKTtcbiAgICAgICAgICB2YXIgYW5zd2VyID0gY29ublxuICAgICAgICAgICAgLnNldFJlbW90ZURlc2NyaXB0aW9uKHRoaXMuY29uZmlndXJlU3Vic2NyaWJlclNkcChqc2VwKSlcbiAgICAgICAgICAgIC50aGVuKF8gPT4gY29ubi5jcmVhdGVBbnN3ZXIoKSlcbiAgICAgICAgICAgIC50aGVuKHRoaXMuZml4U2FmYXJpSWNlVUZyYWcpO1xuICAgICAgICAgIHZhciBsb2NhbCA9IGFuc3dlci50aGVuKGEgPT4gY29ubi5zZXRMb2NhbERlc2NyaXB0aW9uKGEpKTtcbiAgICAgICAgICB2YXIgcmVtb3RlID0gYW5zd2VyLnRoZW4oaiA9PiBoYW5kbGUuc2VuZEpzZXAoaikpO1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLmFsbChbbG9jYWwsIHJlbW90ZV0pLmNhdGNoKGUgPT4gZXJyb3IoXCJFcnJvciBuZWdvdGlhdGluZyBhbnN3ZXI6ICVvXCIsIGUpKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBzb21lIG90aGVyIGtpbmQgb2YgZXZlbnQsIG5vdGhpbmcgdG8gZG9cbiAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICApO1xuICB9XG5cbiAgYXN5bmMgY3JlYXRlUHVibGlzaGVyKCkge1xuICAgIHZhciBoYW5kbGUgPSBuZXcgbWouSmFudXNQbHVnaW5IYW5kbGUodGhpcy5zZXNzaW9uKTtcbiAgICB2YXIgY29ubiA9IG5ldyBSVENQZWVyQ29ubmVjdGlvbih0aGlzLnBlZXJDb25uZWN0aW9uQ29uZmlnIHx8IERFRkFVTFRfUEVFUl9DT05ORUNUSU9OX0NPTkZJRyk7XG5cbiAgICBkZWJ1ZyhcInB1YiB3YWl0aW5nIGZvciBzZnVcIik7XG4gICAgYXdhaXQgaGFuZGxlLmF0dGFjaChcImphbnVzLnBsdWdpbi5zZnVcIiwgdGhpcy5sb29wcyAmJiB0aGlzLmNsaWVudElkID8gcGFyc2VJbnQodGhpcy5jbGllbnRJZCkgJSB0aGlzLmxvb3BzIDogdW5kZWZpbmVkKTtcblxuICAgIHRoaXMuYXNzb2NpYXRlKGNvbm4sIGhhbmRsZSk7XG5cbiAgICBkZWJ1ZyhcInB1YiB3YWl0aW5nIGZvciBkYXRhIGNoYW5uZWxzICYgd2VicnRjdXBcIik7XG4gICAgdmFyIHdlYnJ0Y3VwID0gbmV3IFByb21pc2UocmVzb2x2ZSA9PiBoYW5kbGUub24oXCJ3ZWJydGN1cFwiLCByZXNvbHZlKSk7XG5cbiAgICAvLyBVbnJlbGlhYmxlIGRhdGFjaGFubmVsOiBzZW5kaW5nIGFuZCByZWNlaXZpbmcgY29tcG9uZW50IHVwZGF0ZXMuXG4gICAgLy8gUmVsaWFibGUgZGF0YWNoYW5uZWw6IHNlbmRpbmcgYW5kIHJlY2lldmluZyBlbnRpdHkgaW5zdGFudGlhdGlvbnMuXG4gICAgdmFyIHJlbGlhYmxlQ2hhbm5lbCA9IGNvbm4uY3JlYXRlRGF0YUNoYW5uZWwoXCJyZWxpYWJsZVwiLCB7IG9yZGVyZWQ6IHRydWUgfSk7XG4gICAgdmFyIHVucmVsaWFibGVDaGFubmVsID0gY29ubi5jcmVhdGVEYXRhQ2hhbm5lbChcInVucmVsaWFibGVcIiwge1xuICAgICAgb3JkZXJlZDogZmFsc2UsXG4gICAgICBtYXhSZXRyYW5zbWl0czogMFxuICAgIH0pO1xuXG4gICAgcmVsaWFibGVDaGFubmVsLmFkZEV2ZW50TGlzdGVuZXIoXCJtZXNzYWdlXCIsIGUgPT4gdGhpcy5vbkRhdGFDaGFubmVsTWVzc2FnZShlLCBcImphbnVzLXJlbGlhYmxlXCIpKTtcbiAgICB1bnJlbGlhYmxlQ2hhbm5lbC5hZGRFdmVudExpc3RlbmVyKFwibWVzc2FnZVwiLCBlID0+IHRoaXMub25EYXRhQ2hhbm5lbE1lc3NhZ2UoZSwgXCJqYW51cy11bnJlbGlhYmxlXCIpKTtcblxuICAgIGF3YWl0IHdlYnJ0Y3VwO1xuICAgIGF3YWl0IHVudGlsRGF0YUNoYW5uZWxPcGVuKHJlbGlhYmxlQ2hhbm5lbCk7XG4gICAgYXdhaXQgdW50aWxEYXRhQ2hhbm5lbE9wZW4odW5yZWxpYWJsZUNoYW5uZWwpO1xuXG4gICAgLy8gZG9pbmcgdGhpcyBoZXJlIGlzIHNvcnQgb2YgYSBoYWNrIGFyb3VuZCBjaHJvbWUgcmVuZWdvdGlhdGlvbiB3ZWlyZG5lc3MgLS1cbiAgICAvLyBpZiB3ZSBkbyBpdCBwcmlvciB0byB3ZWJydGN1cCwgY2hyb21lIG9uIGdlYXIgVlIgd2lsbCBzb21ldGltZXMgcHV0IGFcbiAgICAvLyByZW5lZ290aWF0aW9uIG9mZmVyIGluIGZsaWdodCB3aGlsZSB0aGUgZmlyc3Qgb2ZmZXIgd2FzIHN0aWxsIGJlaW5nXG4gICAgLy8gcHJvY2Vzc2VkIGJ5IGphbnVzLiB3ZSBzaG91bGQgZmluZCBzb21lIG1vcmUgcHJpbmNpcGxlZCB3YXkgdG8gZmlndXJlIG91dFxuICAgIC8vIHdoZW4gamFudXMgaXMgZG9uZSBpbiB0aGUgZnV0dXJlLlxuICAgIGlmICh0aGlzLmxvY2FsTWVkaWFTdHJlYW0pIHtcbiAgICAgIHRoaXMubG9jYWxNZWRpYVN0cmVhbS5nZXRUcmFja3MoKS5mb3JFYWNoKHRyYWNrID0+IHtcbiAgICAgICAgY29ubi5hZGRUcmFjayh0cmFjaywgdGhpcy5sb2NhbE1lZGlhU3RyZWFtKTtcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIEhhbmRsZSBhbGwgb2YgdGhlIGpvaW4gYW5kIGxlYXZlIGV2ZW50cy5cbiAgICBoYW5kbGUub24oXCJldmVudFwiLCBldiA9PiB7XG4gICAgICB2YXIgZGF0YSA9IGV2LnBsdWdpbmRhdGEuZGF0YTtcbiAgICAgIGlmIChkYXRhLmV2ZW50ID09IFwiam9pblwiICYmIGRhdGEucm9vbV9pZCA9PSB0aGlzLnJvb20pIHtcbiAgICAgICAgaWYgKHRoaXMuZGVsYXllZFJlY29ubmVjdFRpbWVvdXQpIHtcbiAgICAgICAgICAvLyBEb24ndCBjcmVhdGUgYSBuZXcgUlRDUGVlckNvbm5lY3Rpb24sIGFsbCBSVENQZWVyQ29ubmVjdGlvbiB3aWxsIGJlIGNsb3NlZCBpbiBsZXNzIHRoYW4gMTBzLlxuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmFkZE9jY3VwYW50KGRhdGEudXNlcl9pZCk7XG4gICAgICB9IGVsc2UgaWYgKGRhdGEuZXZlbnQgPT0gXCJsZWF2ZVwiICYmIGRhdGEucm9vbV9pZCA9PSB0aGlzLnJvb20pIHtcbiAgICAgICAgdGhpcy5yZW1vdmVPY2N1cGFudChkYXRhLnVzZXJfaWQpO1xuICAgICAgfSBlbHNlIGlmIChkYXRhLmV2ZW50ID09IFwiYmxvY2tlZFwiKSB7XG4gICAgICAgIGRvY3VtZW50LmJvZHkuZGlzcGF0Y2hFdmVudChuZXcgQ3VzdG9tRXZlbnQoXCJibG9ja2VkXCIsIHsgZGV0YWlsOiB7IGNsaWVudElkOiBkYXRhLmJ5IH0gfSkpO1xuICAgICAgfSBlbHNlIGlmIChkYXRhLmV2ZW50ID09IFwidW5ibG9ja2VkXCIpIHtcbiAgICAgICAgZG9jdW1lbnQuYm9keS5kaXNwYXRjaEV2ZW50KG5ldyBDdXN0b21FdmVudChcInVuYmxvY2tlZFwiLCB7IGRldGFpbDogeyBjbGllbnRJZDogZGF0YS5ieSB9IH0pKTtcbiAgICAgIH0gZWxzZSBpZiAoZGF0YS5ldmVudCA9PT0gXCJkYXRhXCIpIHtcbiAgICAgICAgdGhpcy5vbkRhdGEoSlNPTi5wYXJzZShkYXRhLmJvZHkpLCBcImphbnVzLWV2ZW50XCIpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgZGVidWcoXCJwdWIgd2FpdGluZyBmb3Igam9pblwiKTtcblxuICAgIC8vIFNlbmQgam9pbiBtZXNzYWdlIHRvIGphbnVzLiBMaXN0ZW4gZm9yIGpvaW4vbGVhdmUgbWVzc2FnZXMuIEF1dG9tYXRpY2FsbHkgc3Vic2NyaWJlIHRvIGFsbCB1c2VycycgV2ViUlRDIGRhdGEuXG4gICAgdmFyIG1lc3NhZ2UgPSBhd2FpdCB0aGlzLnNlbmRKb2luKGhhbmRsZSwge1xuICAgICAgbm90aWZpY2F0aW9uczogdHJ1ZSxcbiAgICAgIGRhdGE6IHRydWVcbiAgICB9KTtcblxuICAgIGlmICghbWVzc2FnZS5wbHVnaW5kYXRhLmRhdGEuc3VjY2Vzcykge1xuICAgICAgY29uc3QgZXJyID0gbWVzc2FnZS5wbHVnaW5kYXRhLmRhdGEuZXJyb3I7XG4gICAgICBjb25zb2xlLmVycm9yKGVycik7XG4gICAgICAvLyBXZSBtYXkgZ2V0IGhlcmUgYmVjYXVzZSBvZiBhbiBleHBpcmVkIEpXVC5cbiAgICAgIC8vIENsb3NlIHRoZSBjb25uZWN0aW9uIG91cnNlbGYgb3RoZXJ3aXNlIGphbnVzIHdpbGwgY2xvc2UgaXQgYWZ0ZXJcbiAgICAgIC8vIHNlc3Npb25fdGltZW91dCBiZWNhdXNlIHdlIGRpZG4ndCBzZW5kIGFueSBrZWVwYWxpdmUgYW5kIHRoaXMgd2lsbFxuICAgICAgLy8gdHJpZ2dlciBhIGRlbGF5ZWQgcmVjb25uZWN0IGJlY2F1c2Ugb2YgdGhlIGljZWNvbm5lY3Rpb25zdGF0ZWNoYW5nZVxuICAgICAgLy8gbGlzdGVuZXIgZm9yIGZhaWx1cmUgc3RhdGUuXG4gICAgICAvLyBFdmVuIGlmIHRoZSBhcHAgY29kZSBjYWxscyBkaXNjb25uZWN0IGluIGNhc2Ugb2YgZXJyb3IsIGRpc2Nvbm5lY3RcbiAgICAgIC8vIHdvbid0IGNsb3NlIHRoZSBwZWVyIGNvbm5lY3Rpb24gYmVjYXVzZSB0aGlzLnB1Ymxpc2hlciBpcyBub3Qgc2V0LlxuICAgICAgY29ubi5jbG9zZSgpO1xuICAgICAgdGhyb3cgZXJyO1xuICAgIH1cblxuICAgIHZhciBpbml0aWFsT2NjdXBhbnRzID0gbWVzc2FnZS5wbHVnaW5kYXRhLmRhdGEucmVzcG9uc2UudXNlcnNbdGhpcy5yb29tXSB8fCBbXTtcblxuICAgIGlmIChpbml0aWFsT2NjdXBhbnRzLmluY2x1ZGVzKHRoaXMuY2xpZW50SWQpKSB7XG4gICAgICBjb25zb2xlLndhcm4oXCJKYW51cyBzdGlsbCBoYXMgcHJldmlvdXMgc2Vzc2lvbiBmb3IgdGhpcyBjbGllbnQuIFJlY29ubmVjdGluZyBpbiAxMHMuXCIpO1xuICAgICAgdGhpcy5wZXJmb3JtRGVsYXllZFJlY29ubmVjdCgpO1xuICAgIH1cblxuICAgIGRlYnVnKFwicHVibGlzaGVyIHJlYWR5XCIpO1xuICAgIHJldHVybiB7XG4gICAgICBoYW5kbGUsXG4gICAgICBpbml0aWFsT2NjdXBhbnRzLFxuICAgICAgcmVsaWFibGVDaGFubmVsLFxuICAgICAgdW5yZWxpYWJsZUNoYW5uZWwsXG4gICAgICBjb25uXG4gICAgfTtcbiAgfVxuXG4gIGNvbmZpZ3VyZVB1Ymxpc2hlclNkcChqc2VwKSB7XG4gICAganNlcC5zZHAgPSBqc2VwLnNkcC5yZXBsYWNlKC9hPWZtdHA6KDEwOXwxMTEpLipcXHJcXG4vZywgKGxpbmUsIHB0KSA9PiB7XG4gICAgICBjb25zdCBwYXJhbWV0ZXJzID0gT2JqZWN0LmFzc2lnbihzZHBVdGlscy5wYXJzZUZtdHAobGluZSksIE9QVVNfUEFSQU1FVEVSUyk7XG4gICAgICByZXR1cm4gc2RwVXRpbHMud3JpdGVGbXRwKHsgcGF5bG9hZFR5cGU6IHB0LCBwYXJhbWV0ZXJzOiBwYXJhbWV0ZXJzIH0pO1xuICAgIH0pO1xuICAgIHJldHVybiBqc2VwO1xuICB9XG5cbiAgY29uZmlndXJlU3Vic2NyaWJlclNkcChqc2VwKSB7XG4gICAgLy8gdG9kbzogY29uc2lkZXIgY2xlYW5pbmcgdXAgdGhlc2UgaGFja3MgdG8gdXNlIHNkcHV0aWxzXG4gICAgaWYgKCFpc0gyNjRWaWRlb1N1cHBvcnRlZCkge1xuICAgICAgaWYgKG5hdmlnYXRvci51c2VyQWdlbnQuaW5kZXhPZihcIkhlYWRsZXNzQ2hyb21lXCIpICE9PSAtMSkge1xuICAgICAgICAvLyBIZWFkbGVzc0Nocm9tZSAoZS5nLiBwdXBwZXRlZXIpIGRvZXNuJ3Qgc3VwcG9ydCB3ZWJydGMgdmlkZW8gc3RyZWFtcywgc28gd2UgcmVtb3ZlIHRob3NlIGxpbmVzIGZyb20gdGhlIFNEUC5cbiAgICAgICAganNlcC5zZHAgPSBqc2VwLnNkcC5yZXBsYWNlKC9tPXZpZGVvW15dKm09LywgXCJtPVwiKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBUT0RPOiBIYWNrIHRvIGdldCB2aWRlbyB3b3JraW5nIG9uIENocm9tZSBmb3IgQW5kcm9pZC4gaHR0cHM6Ly9ncm91cHMuZ29vZ2xlLmNvbS9mb3J1bS8jIXRvcGljL21vemlsbGEuZGV2Lm1lZGlhL1llMjl2dU1UcG84XG4gICAgaWYgKG5hdmlnYXRvci51c2VyQWdlbnQuaW5kZXhPZihcIkFuZHJvaWRcIikgPT09IC0xKSB7XG4gICAgICBqc2VwLnNkcCA9IGpzZXAuc2RwLnJlcGxhY2UoXG4gICAgICAgIFwiYT1ydGNwLWZiOjEwNyBnb29nLXJlbWJcXHJcXG5cIixcbiAgICAgICAgXCJhPXJ0Y3AtZmI6MTA3IGdvb2ctcmVtYlxcclxcbmE9cnRjcC1mYjoxMDcgdHJhbnNwb3J0LWNjXFxyXFxuYT1mbXRwOjEwNyBsZXZlbC1hc3ltbWV0cnktYWxsb3dlZD0xO3BhY2tldGl6YXRpb24tbW9kZT0xO3Byb2ZpbGUtbGV2ZWwtaWQ9NDJlMDFmXFxyXFxuXCJcbiAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGpzZXAuc2RwID0ganNlcC5zZHAucmVwbGFjZShcbiAgICAgICAgXCJhPXJ0Y3AtZmI6MTA3IGdvb2ctcmVtYlxcclxcblwiLFxuICAgICAgICBcImE9cnRjcC1mYjoxMDcgZ29vZy1yZW1iXFxyXFxuYT1ydGNwLWZiOjEwNyB0cmFuc3BvcnQtY2NcXHJcXG5hPWZtdHA6MTA3IGxldmVsLWFzeW1tZXRyeS1hbGxvd2VkPTE7cGFja2V0aXphdGlvbi1tb2RlPTE7cHJvZmlsZS1sZXZlbC1pZD00MjAwMWZcXHJcXG5cIlxuICAgICAgKTtcbiAgICB9XG4gICAgcmV0dXJuIGpzZXA7XG4gIH1cblxuICBhc3luYyBmaXhTYWZhcmlJY2VVRnJhZyhqc2VwKSB7XG4gICAgLy8gU2FmYXJpIHByb2R1Y2VzIGEgXFxuIGluc3RlYWQgb2YgYW4gXFxyXFxuIGZvciB0aGUgaWNlLXVmcmFnLiBTZWUgaHR0cHM6Ly9naXRodWIuY29tL21lZXRlY2hvL2phbnVzLWdhdGV3YXkvaXNzdWVzLzE4MThcbiAgICBqc2VwLnNkcCA9IGpzZXAuc2RwLnJlcGxhY2UoL1teXFxyXVxcbmE9aWNlLXVmcmFnL2csIFwiXFxyXFxuYT1pY2UtdWZyYWdcIik7XG4gICAgcmV0dXJuIGpzZXBcbiAgfVxuXG4gIGFzeW5jIGNyZWF0ZVN1YnNjcmliZXIob2NjdXBhbnRJZCwgbWF4UmV0cmllcyA9IDUpIHtcbiAgICBpZiAodGhpcy5sZWZ0T2NjdXBhbnRzLmhhcyhvY2N1cGFudElkKSkge1xuICAgICAgY29uc29sZS53YXJuKG9jY3VwYW50SWQgKyBcIjogY2FuY2VsbGVkIG9jY3VwYW50IGNvbm5lY3Rpb24sIG9jY3VwYW50IGxlZnQgYmVmb3JlIHN1YnNjcmlwdGlvbiBuZWdvdGF0aW9uLlwiKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIHZhciBoYW5kbGUgPSBuZXcgbWouSmFudXNQbHVnaW5IYW5kbGUodGhpcy5zZXNzaW9uKTtcbiAgICB2YXIgY29ubiA9IG5ldyBSVENQZWVyQ29ubmVjdGlvbih0aGlzLnBlZXJDb25uZWN0aW9uQ29uZmlnIHx8IERFRkFVTFRfUEVFUl9DT05ORUNUSU9OX0NPTkZJRyk7XG5cbiAgICBkZWJ1ZyhvY2N1cGFudElkICsgXCI6IHN1YiB3YWl0aW5nIGZvciBzZnVcIik7XG4gICAgYXdhaXQgaGFuZGxlLmF0dGFjaChcImphbnVzLnBsdWdpbi5zZnVcIiwgdGhpcy5sb29wcyA/IHBhcnNlSW50KG9jY3VwYW50SWQpICUgdGhpcy5sb29wcyA6IHVuZGVmaW5lZCk7XG5cbiAgICB0aGlzLmFzc29jaWF0ZShjb25uLCBoYW5kbGUpO1xuXG4gICAgZGVidWcob2NjdXBhbnRJZCArIFwiOiBzdWIgd2FpdGluZyBmb3Igam9pblwiKTtcblxuICAgIGlmICh0aGlzLmxlZnRPY2N1cGFudHMuaGFzKG9jY3VwYW50SWQpKSB7XG4gICAgICBjb25uLmNsb3NlKCk7XG4gICAgICBjb25zb2xlLndhcm4ob2NjdXBhbnRJZCArIFwiOiBjYW5jZWxsZWQgb2NjdXBhbnQgY29ubmVjdGlvbiwgb2NjdXBhbnQgbGVmdCBhZnRlciBhdHRhY2hcIik7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBsZXQgd2VicnRjRmFpbGVkID0gZmFsc2U7XG5cbiAgICBjb25zdCB3ZWJydGN1cCA9IG5ldyBQcm9taXNlKHJlc29sdmUgPT4ge1xuICAgICAgY29uc3QgbGVmdEludGVydmFsID0gc2V0SW50ZXJ2YWwoKCkgPT4ge1xuICAgICAgICBpZiAodGhpcy5sZWZ0T2NjdXBhbnRzLmhhcyhvY2N1cGFudElkKSkge1xuICAgICAgICAgIGNsZWFySW50ZXJ2YWwobGVmdEludGVydmFsKTtcbiAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgIH1cbiAgICAgIH0sIDEwMDApO1xuXG4gICAgICBjb25zdCB0aW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIGNsZWFySW50ZXJ2YWwobGVmdEludGVydmFsKTtcbiAgICAgICAgd2VicnRjRmFpbGVkID0gdHJ1ZTtcbiAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgfSwgU1VCU0NSSUJFX1RJTUVPVVRfTVMpO1xuXG4gICAgICBoYW5kbGUub24oXCJ3ZWJydGN1cFwiLCAoKSA9PiB7XG4gICAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICAgICAgY2xlYXJJbnRlcnZhbChsZWZ0SW50ZXJ2YWwpO1xuICAgICAgICByZXNvbHZlKCk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIC8vIFNlbmQgam9pbiBtZXNzYWdlIHRvIGphbnVzLiBEb24ndCBsaXN0ZW4gZm9yIGpvaW4vbGVhdmUgbWVzc2FnZXMuIFN1YnNjcmliZSB0byB0aGUgb2NjdXBhbnQncyBtZWRpYS5cbiAgICAvLyBKYW51cyBzaG91bGQgc2VuZCB1cyBhbiBvZmZlciBmb3IgdGhpcyBvY2N1cGFudCdzIG1lZGlhIGluIHJlc3BvbnNlIHRvIHRoaXMuXG4gICAgYXdhaXQgdGhpcy5zZW5kSm9pbihoYW5kbGUsIHsgbWVkaWE6IG9jY3VwYW50SWQgfSk7XG5cbiAgICBpZiAodGhpcy5sZWZ0T2NjdXBhbnRzLmhhcyhvY2N1cGFudElkKSkge1xuICAgICAgY29ubi5jbG9zZSgpO1xuICAgICAgY29uc29sZS53YXJuKG9jY3VwYW50SWQgKyBcIjogY2FuY2VsbGVkIG9jY3VwYW50IGNvbm5lY3Rpb24sIG9jY3VwYW50IGxlZnQgYWZ0ZXIgam9pblwiKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGRlYnVnKG9jY3VwYW50SWQgKyBcIjogc3ViIHdhaXRpbmcgZm9yIHdlYnJ0Y3VwXCIpO1xuICAgIGF3YWl0IHdlYnJ0Y3VwO1xuXG4gICAgaWYgKHRoaXMubGVmdE9jY3VwYW50cy5oYXMob2NjdXBhbnRJZCkpIHtcbiAgICAgIGNvbm4uY2xvc2UoKTtcbiAgICAgIGNvbnNvbGUud2FybihvY2N1cGFudElkICsgXCI6IGNhbmNlbCBvY2N1cGFudCBjb25uZWN0aW9uLCBvY2N1cGFudCBsZWZ0IGR1cmluZyBvciBhZnRlciB3ZWJydGN1cFwiKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGlmICh3ZWJydGNGYWlsZWQpIHtcbiAgICAgIGNvbm4uY2xvc2UoKTtcbiAgICAgIGlmIChtYXhSZXRyaWVzID4gMCkge1xuICAgICAgICBjb25zb2xlLndhcm4ob2NjdXBhbnRJZCArIFwiOiB3ZWJydGMgdXAgdGltZWQgb3V0LCByZXRyeWluZ1wiKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlU3Vic2NyaWJlcihvY2N1cGFudElkLCBtYXhSZXRyaWVzIC0gMSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zb2xlLndhcm4ob2NjdXBhbnRJZCArIFwiOiB3ZWJydGMgdXAgdGltZWQgb3V0XCIpO1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoaXNTYWZhcmkgJiYgIXRoaXMuX2lPU0hhY2tEZWxheWVkSW5pdGlhbFBlZXIpIHtcbiAgICAgIC8vIEhBQ0s6IHRoZSBmaXJzdCBwZWVyIG9uIFNhZmFyaSBkdXJpbmcgcGFnZSBsb2FkIGNhbiBmYWlsIHRvIHdvcmsgaWYgd2UgZG9uJ3RcbiAgICAgIC8vIHdhaXQgc29tZSB0aW1lIGJlZm9yZSBjb250aW51aW5nIGhlcmUuIFNlZTogaHR0cHM6Ly9naXRodWIuY29tL21vemlsbGEvaHVicy9wdWxsLzE2OTJcbiAgICAgIGF3YWl0IChuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gc2V0VGltZW91dChyZXNvbHZlLCAzMDAwKSkpO1xuICAgICAgdGhpcy5faU9TSGFja0RlbGF5ZWRJbml0aWFsUGVlciA9IHRydWU7XG4gICAgfVxuXG4gICAgdmFyIG1lZGlhU3RyZWFtID0gbmV3IE1lZGlhU3RyZWFtKCk7XG4gICAgdmFyIHJlY2VpdmVycyA9IGNvbm4uZ2V0UmVjZWl2ZXJzKCk7XG4gICAgcmVjZWl2ZXJzLmZvckVhY2gocmVjZWl2ZXIgPT4ge1xuICAgICAgaWYgKHJlY2VpdmVyLnRyYWNrKSB7XG4gICAgICAgIG1lZGlhU3RyZWFtLmFkZFRyYWNrKHJlY2VpdmVyLnRyYWNrKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBpZiAobWVkaWFTdHJlYW0uZ2V0VHJhY2tzKCkubGVuZ3RoID09PSAwKSB7XG4gICAgICBtZWRpYVN0cmVhbSA9IG51bGw7XG4gICAgfVxuXG4gICAgZGVidWcob2NjdXBhbnRJZCArIFwiOiBzdWJzY3JpYmVyIHJlYWR5XCIpO1xuICAgIHJldHVybiB7XG4gICAgICBoYW5kbGUsXG4gICAgICBtZWRpYVN0cmVhbSxcbiAgICAgIGNvbm5cbiAgICB9O1xuICB9XG5cbiAgc2VuZEpvaW4oaGFuZGxlLCBzdWJzY3JpYmUpIHtcbiAgICByZXR1cm4gaGFuZGxlLnNlbmRNZXNzYWdlKHtcbiAgICAgIGtpbmQ6IFwiam9pblwiLFxuICAgICAgcm9vbV9pZDogdGhpcy5yb29tLFxuICAgICAgdXNlcl9pZDogdGhpcy5jbGllbnRJZCxcbiAgICAgIHN1YnNjcmliZSxcbiAgICAgIHRva2VuOiB0aGlzLmpvaW5Ub2tlblxuICAgIH0pO1xuICB9XG5cbiAgdG9nZ2xlRnJlZXplKCkge1xuICAgIGlmICh0aGlzLmZyb3plbikge1xuICAgICAgdGhpcy51bmZyZWV6ZSgpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmZyZWV6ZSgpO1xuICAgIH1cbiAgfVxuXG4gIGZyZWV6ZSgpIHtcbiAgICB0aGlzLmZyb3plbiA9IHRydWU7XG4gIH1cblxuICB1bmZyZWV6ZSgpIHtcbiAgICB0aGlzLmZyb3plbiA9IGZhbHNlO1xuICAgIHRoaXMuZmx1c2hQZW5kaW5nVXBkYXRlcygpO1xuICB9XG5cbiAgZGF0YUZvclVwZGF0ZU11bHRpTWVzc2FnZShuZXR3b3JrSWQsIG1lc3NhZ2UpIHtcbiAgICAvLyBcImRcIiBpcyBhbiBhcnJheSBvZiBlbnRpdHkgZGF0YXMsIHdoZXJlIGVhY2ggaXRlbSBpbiB0aGUgYXJyYXkgcmVwcmVzZW50cyBhIHVuaXF1ZSBlbnRpdHkgYW5kIGNvbnRhaW5zXG4gICAgLy8gbWV0YWRhdGEgZm9yIHRoZSBlbnRpdHksIGFuZCBhbiBhcnJheSBvZiBjb21wb25lbnRzIHRoYXQgaGF2ZSBiZWVuIHVwZGF0ZWQgb24gdGhlIGVudGl0eS5cbiAgICAvLyBUaGlzIG1ldGhvZCBmaW5kcyB0aGUgZGF0YSBjb3JyZXNwb25kaW5nIHRvIHRoZSBnaXZlbiBuZXR3b3JrSWQuXG4gICAgZm9yIChsZXQgaSA9IDAsIGwgPSBtZXNzYWdlLmRhdGEuZC5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAgIGNvbnN0IGRhdGEgPSBtZXNzYWdlLmRhdGEuZFtpXTtcblxuICAgICAgaWYgKGRhdGEubmV0d29ya0lkID09PSBuZXR3b3JrSWQpIHtcbiAgICAgICAgcmV0dXJuIGRhdGE7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBnZXRQZW5kaW5nRGF0YShuZXR3b3JrSWQsIG1lc3NhZ2UpIHtcbiAgICBpZiAoIW1lc3NhZ2UpIHJldHVybiBudWxsO1xuXG4gICAgbGV0IGRhdGEgPSBtZXNzYWdlLmRhdGFUeXBlID09PSBcInVtXCIgPyB0aGlzLmRhdGFGb3JVcGRhdGVNdWx0aU1lc3NhZ2UobmV0d29ya0lkLCBtZXNzYWdlKSA6IG1lc3NhZ2UuZGF0YTtcblxuICAgIC8vIElnbm9yZSBtZXNzYWdlcyByZWxhdGluZyB0byB1c2VycyB3aG8gaGF2ZSBkaXNjb25uZWN0ZWQgc2luY2UgZnJlZXppbmcsIHRoZWlyIGVudGl0aWVzXG4gICAgLy8gd2lsbCBoYXZlIGFsZWFkeSBiZWVuIHJlbW92ZWQgYnkgTkFGLlxuICAgIC8vIE5vdGUgdGhhdCBkZWxldGUgbWVzc2FnZXMgaGF2ZSBubyBcIm93bmVyXCIgc28gd2UgaGF2ZSB0byBjaGVjayBmb3IgdGhhdCBhcyB3ZWxsLlxuICAgIGlmIChkYXRhLm93bmVyICYmICF0aGlzLm9jY3VwYW50c1tkYXRhLm93bmVyXSkgcmV0dXJuIG51bGw7XG5cbiAgICAvLyBJZ25vcmUgbWVzc2FnZXMgZnJvbSB1c2VycyB0aGF0IHdlIG1heSBoYXZlIGJsb2NrZWQgd2hpbGUgZnJvemVuLlxuICAgIGlmIChkYXRhLm93bmVyICYmIHRoaXMuYmxvY2tlZENsaWVudHMuaGFzKGRhdGEub3duZXIpKSByZXR1cm4gbnVsbDtcblxuICAgIHJldHVybiBkYXRhXG4gIH1cblxuICAvLyBVc2VkIGV4dGVybmFsbHlcbiAgZ2V0UGVuZGluZ0RhdGFGb3JOZXR3b3JrSWQobmV0d29ya0lkKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0UGVuZGluZ0RhdGEobmV0d29ya0lkLCB0aGlzLmZyb3plblVwZGF0ZXMuZ2V0KG5ldHdvcmtJZCkpO1xuICB9XG5cbiAgZmx1c2hQZW5kaW5nVXBkYXRlcygpIHtcbiAgICBmb3IgKGNvbnN0IFtuZXR3b3JrSWQsIG1lc3NhZ2VdIG9mIHRoaXMuZnJvemVuVXBkYXRlcykge1xuICAgICAgbGV0IGRhdGEgPSB0aGlzLmdldFBlbmRpbmdEYXRhKG5ldHdvcmtJZCwgbWVzc2FnZSk7XG4gICAgICBpZiAoIWRhdGEpIGNvbnRpbnVlO1xuXG4gICAgICAvLyBPdmVycmlkZSB0aGUgZGF0YSB0eXBlIG9uIFwidW1cIiBtZXNzYWdlcyB0eXBlcywgc2luY2Ugd2UgZXh0cmFjdCBlbnRpdHkgdXBkYXRlcyBmcm9tIFwidW1cIiBtZXNzYWdlcyBpbnRvXG4gICAgICAvLyBpbmRpdmlkdWFsIGZyb3plblVwZGF0ZXMgaW4gc3RvcmVTaW5nbGVNZXNzYWdlLlxuICAgICAgY29uc3QgZGF0YVR5cGUgPSBtZXNzYWdlLmRhdGFUeXBlID09PSBcInVtXCIgPyBcInVcIiA6IG1lc3NhZ2UuZGF0YVR5cGU7XG5cbiAgICAgIHRoaXMub25PY2N1cGFudE1lc3NhZ2UobnVsbCwgZGF0YVR5cGUsIGRhdGEsIG1lc3NhZ2Uuc291cmNlKTtcbiAgICB9XG4gICAgdGhpcy5mcm96ZW5VcGRhdGVzLmNsZWFyKCk7XG4gIH1cblxuICBzdG9yZU1lc3NhZ2UobWVzc2FnZSkge1xuICAgIGlmIChtZXNzYWdlLmRhdGFUeXBlID09PSBcInVtXCIpIHsgLy8gVXBkYXRlTXVsdGlcbiAgICAgIGZvciAobGV0IGkgPSAwLCBsID0gbWVzc2FnZS5kYXRhLmQubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICAgIHRoaXMuc3RvcmVTaW5nbGVNZXNzYWdlKG1lc3NhZ2UsIGkpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnN0b3JlU2luZ2xlTWVzc2FnZShtZXNzYWdlKTtcbiAgICB9XG4gIH1cblxuICBzdG9yZVNpbmdsZU1lc3NhZ2UobWVzc2FnZSwgaW5kZXgpIHtcbiAgICBjb25zdCBkYXRhID0gaW5kZXggIT09IHVuZGVmaW5lZCA/IG1lc3NhZ2UuZGF0YS5kW2luZGV4XSA6IG1lc3NhZ2UuZGF0YTtcbiAgICBjb25zdCBkYXRhVHlwZSA9IG1lc3NhZ2UuZGF0YVR5cGU7XG4gICAgY29uc3Qgc291cmNlID0gbWVzc2FnZS5zb3VyY2U7XG5cbiAgICBjb25zdCBuZXR3b3JrSWQgPSBkYXRhLm5ldHdvcmtJZDtcblxuICAgIGlmICghdGhpcy5mcm96ZW5VcGRhdGVzLmhhcyhuZXR3b3JrSWQpKSB7XG4gICAgICB0aGlzLmZyb3plblVwZGF0ZXMuc2V0KG5ldHdvcmtJZCwgbWVzc2FnZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IHN0b3JlZE1lc3NhZ2UgPSB0aGlzLmZyb3plblVwZGF0ZXMuZ2V0KG5ldHdvcmtJZCk7XG4gICAgICBjb25zdCBzdG9yZWREYXRhID0gc3RvcmVkTWVzc2FnZS5kYXRhVHlwZSA9PT0gXCJ1bVwiID8gdGhpcy5kYXRhRm9yVXBkYXRlTXVsdGlNZXNzYWdlKG5ldHdvcmtJZCwgc3RvcmVkTWVzc2FnZSkgOiBzdG9yZWRNZXNzYWdlLmRhdGE7XG5cbiAgICAgIC8vIEF2b2lkIHVwZGF0aW5nIGNvbXBvbmVudHMgaWYgdGhlIGVudGl0eSBkYXRhIHJlY2VpdmVkIGRpZCBub3QgY29tZSBmcm9tIHRoZSBjdXJyZW50IG93bmVyLlxuICAgICAgY29uc3QgaXNPdXRkYXRlZE1lc3NhZ2UgPSBkYXRhLmxhc3RPd25lclRpbWUgPCBzdG9yZWREYXRhLmxhc3RPd25lclRpbWU7XG4gICAgICBjb25zdCBpc0NvbnRlbXBvcmFuZW91c01lc3NhZ2UgPSBkYXRhLmxhc3RPd25lclRpbWUgPT09IHN0b3JlZERhdGEubGFzdE93bmVyVGltZTtcbiAgICAgIGlmIChpc091dGRhdGVkTWVzc2FnZSB8fCAoaXNDb250ZW1wb3JhbmVvdXNNZXNzYWdlICYmIHN0b3JlZERhdGEub3duZXIgPiBkYXRhLm93bmVyKSkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmIChkYXRhVHlwZSA9PT0gXCJyXCIpIHtcbiAgICAgICAgY29uc3QgY3JlYXRlZFdoaWxlRnJvemVuID0gc3RvcmVkRGF0YSAmJiBzdG9yZWREYXRhLmlzRmlyc3RTeW5jO1xuICAgICAgICBpZiAoY3JlYXRlZFdoaWxlRnJvemVuKSB7XG4gICAgICAgICAgLy8gSWYgdGhlIGVudGl0eSB3YXMgY3JlYXRlZCBhbmQgZGVsZXRlZCB3aGlsZSBmcm96ZW4sIGRvbid0IGJvdGhlciBjb252ZXlpbmcgYW55dGhpbmcgdG8gdGhlIGNvbnN1bWVyLlxuICAgICAgICAgIHRoaXMuZnJvemVuVXBkYXRlcy5kZWxldGUobmV0d29ya0lkKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBEZWxldGUgbWVzc2FnZXMgb3ZlcnJpZGUgYW55IG90aGVyIG1lc3NhZ2VzIGZvciB0aGlzIGVudGl0eVxuICAgICAgICAgIHRoaXMuZnJvemVuVXBkYXRlcy5zZXQobmV0d29ya0lkLCBtZXNzYWdlKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gbWVyZ2UgaW4gY29tcG9uZW50IHVwZGF0ZXNcbiAgICAgICAgaWYgKHN0b3JlZERhdGEuY29tcG9uZW50cyAmJiBkYXRhLmNvbXBvbmVudHMpIHtcbiAgICAgICAgICBPYmplY3QuYXNzaWduKHN0b3JlZERhdGEuY29tcG9uZW50cywgZGF0YS5jb21wb25lbnRzKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIG9uRGF0YUNoYW5uZWxNZXNzYWdlKGUsIHNvdXJjZSkge1xuICAgIHRoaXMub25EYXRhKEpTT04ucGFyc2UoZS5kYXRhKSwgc291cmNlKTtcbiAgfVxuXG4gIG9uRGF0YShtZXNzYWdlLCBzb3VyY2UpIHtcbiAgICBpZiAoZGVidWcuZW5hYmxlZCkge1xuICAgICAgZGVidWcoYERDIGluOiAke21lc3NhZ2V9YCk7XG4gICAgfVxuXG4gICAgaWYgKCFtZXNzYWdlLmRhdGFUeXBlKSByZXR1cm47XG5cbiAgICBtZXNzYWdlLnNvdXJjZSA9IHNvdXJjZTtcblxuICAgIGlmICh0aGlzLmZyb3plbikge1xuICAgICAgdGhpcy5zdG9yZU1lc3NhZ2UobWVzc2FnZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMub25PY2N1cGFudE1lc3NhZ2UobnVsbCwgbWVzc2FnZS5kYXRhVHlwZSwgbWVzc2FnZS5kYXRhLCBtZXNzYWdlLnNvdXJjZSk7XG4gICAgfVxuICB9XG5cbiAgc2hvdWxkU3RhcnRDb25uZWN0aW9uVG8oY2xpZW50KSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICBzdGFydFN0cmVhbUNvbm5lY3Rpb24oY2xpZW50KSB7fVxuXG4gIGNsb3NlU3RyZWFtQ29ubmVjdGlvbihjbGllbnQpIHt9XG5cbiAgZ2V0Q29ubmVjdFN0YXR1cyhjbGllbnRJZCkge1xuICAgIHJldHVybiB0aGlzLm9jY3VwYW50c1tjbGllbnRJZF0gPyBOQUYuYWRhcHRlcnMuSVNfQ09OTkVDVEVEIDogTkFGLmFkYXB0ZXJzLk5PVF9DT05ORUNURUQ7XG4gIH1cblxuICBhc3luYyB1cGRhdGVUaW1lT2Zmc2V0KCkge1xuICAgIGlmICh0aGlzLmlzRGlzY29ubmVjdGVkKCkpIHJldHVybjtcblxuICAgIGNvbnN0IGNsaWVudFNlbnRUaW1lID0gRGF0ZS5ub3coKTtcblxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoKGRvY3VtZW50LmxvY2F0aW9uLmhyZWYsIHtcbiAgICAgIG1ldGhvZDogXCJIRUFEXCIsXG4gICAgICBjYWNoZTogXCJuby1jYWNoZVwiXG4gICAgfSk7XG5cbiAgICBjb25zdCBwcmVjaXNpb24gPSAxMDAwO1xuICAgIGNvbnN0IHNlcnZlclJlY2VpdmVkVGltZSA9IG5ldyBEYXRlKHJlcy5oZWFkZXJzLmdldChcIkRhdGVcIikpLmdldFRpbWUoKSArIHByZWNpc2lvbiAvIDI7XG4gICAgY29uc3QgY2xpZW50UmVjZWl2ZWRUaW1lID0gRGF0ZS5ub3coKTtcbiAgICBjb25zdCBzZXJ2ZXJUaW1lID0gc2VydmVyUmVjZWl2ZWRUaW1lICsgKGNsaWVudFJlY2VpdmVkVGltZSAtIGNsaWVudFNlbnRUaW1lKSAvIDI7XG4gICAgY29uc3QgdGltZU9mZnNldCA9IHNlcnZlclRpbWUgLSBjbGllbnRSZWNlaXZlZFRpbWU7XG5cbiAgICB0aGlzLnNlcnZlclRpbWVSZXF1ZXN0cysrO1xuXG4gICAgaWYgKHRoaXMuc2VydmVyVGltZVJlcXVlc3RzIDw9IDEwKSB7XG4gICAgICB0aGlzLnRpbWVPZmZzZXRzLnB1c2godGltZU9mZnNldCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMudGltZU9mZnNldHNbdGhpcy5zZXJ2ZXJUaW1lUmVxdWVzdHMgJSAxMF0gPSB0aW1lT2Zmc2V0O1xuICAgIH1cblxuICAgIHRoaXMuYXZnVGltZU9mZnNldCA9IHRoaXMudGltZU9mZnNldHMucmVkdWNlKChhY2MsIG9mZnNldCkgPT4gKGFjYyArPSBvZmZzZXQpLCAwKSAvIHRoaXMudGltZU9mZnNldHMubGVuZ3RoO1xuXG4gICAgaWYgKHRoaXMuc2VydmVyVGltZVJlcXVlc3RzID4gMTApIHtcbiAgICAgIGRlYnVnKGBuZXcgc2VydmVyIHRpbWUgb2Zmc2V0OiAke3RoaXMuYXZnVGltZU9mZnNldH1tc2ApO1xuICAgICAgc2V0VGltZW91dCgoKSA9PiB0aGlzLnVwZGF0ZVRpbWVPZmZzZXQoKSwgNSAqIDYwICogMTAwMCk7IC8vIFN5bmMgY2xvY2sgZXZlcnkgNSBtaW51dGVzLlxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnVwZGF0ZVRpbWVPZmZzZXQoKTtcbiAgICB9XG4gIH1cblxuICBnZXRTZXJ2ZXJUaW1lKCkge1xuICAgIHJldHVybiBEYXRlLm5vdygpICsgdGhpcy5hdmdUaW1lT2Zmc2V0O1xuICB9XG5cbiAgZ2V0TWVkaWFTdHJlYW0oY2xpZW50SWQsIHR5cGUgPSBcImF1ZGlvXCIpIHtcbiAgICBpZiAodGhpcy5tZWRpYVN0cmVhbXNbY2xpZW50SWRdKSB7XG4gICAgICBkZWJ1ZyhgQWxyZWFkeSBoYWQgJHt0eXBlfSBmb3IgJHtjbGllbnRJZH1gKTtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodGhpcy5tZWRpYVN0cmVhbXNbY2xpZW50SWRdW3R5cGVdKTtcbiAgICB9IGVsc2Uge1xuICAgICAgZGVidWcoYFdhaXRpbmcgb24gJHt0eXBlfSBmb3IgJHtjbGllbnRJZH1gKTtcbiAgICAgIGlmICghdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5oYXMoY2xpZW50SWQpKSB7XG4gICAgICAgIHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuc2V0KGNsaWVudElkLCB7fSk7XG5cbiAgICAgICAgY29uc3QgYXVkaW9Qcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICAgIHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuZ2V0KGNsaWVudElkKS5hdWRpbyA9IHsgcmVzb2x2ZSwgcmVqZWN0IH07XG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCB2aWRlb1Byb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgICAgdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5nZXQoY2xpZW50SWQpLnZpZGVvID0geyByZXNvbHZlLCByZWplY3QgfTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5nZXQoY2xpZW50SWQpLmF1ZGlvLnByb21pc2UgPSBhdWRpb1Byb21pc2U7XG4gICAgICAgIHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuZ2V0KGNsaWVudElkKS52aWRlby5wcm9taXNlID0gdmlkZW9Qcm9taXNlO1xuXG4gICAgICAgIGF1ZGlvUHJvbWlzZS5jYXRjaChlID0+IGNvbnNvbGUud2FybihgJHtjbGllbnRJZH0gZ2V0TWVkaWFTdHJlYW0gQXVkaW8gRXJyb3JgLCBlKSk7XG4gICAgICAgIHZpZGVvUHJvbWlzZS5jYXRjaChlID0+IGNvbnNvbGUud2FybihgJHtjbGllbnRJZH0gZ2V0TWVkaWFTdHJlYW0gVmlkZW8gRXJyb3JgLCBlKSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5nZXQoY2xpZW50SWQpW3R5cGVdLnByb21pc2U7XG4gICAgfVxuICB9XG5cbiAgc2V0TWVkaWFTdHJlYW0oY2xpZW50SWQsIHN0cmVhbSkge1xuICAgIC8vIFNhZmFyaSBkb2Vzbid0IGxpa2UgaXQgd2hlbiB5b3UgdXNlIHNpbmdsZSBhIG1peGVkIG1lZGlhIHN0cmVhbSB3aGVyZSBvbmUgb2YgdGhlIHRyYWNrcyBpcyBpbmFjdGl2ZSwgc28gd2VcbiAgICAvLyBzcGxpdCB0aGUgdHJhY2tzIGludG8gdHdvIHN0cmVhbXMuXG4gICAgY29uc3QgYXVkaW9TdHJlYW0gPSBuZXcgTWVkaWFTdHJlYW0oKTtcbiAgICB0cnkge1xuICAgIHN0cmVhbS5nZXRBdWRpb1RyYWNrcygpLmZvckVhY2godHJhY2sgPT4gYXVkaW9TdHJlYW0uYWRkVHJhY2sodHJhY2spKTtcblxuICAgIH0gY2F0Y2goZSkge1xuICAgICAgY29uc29sZS53YXJuKGAke2NsaWVudElkfSBzZXRNZWRpYVN0cmVhbSBBdWRpbyBFcnJvcmAsIGUpO1xuICAgIH1cbiAgICBjb25zdCB2aWRlb1N0cmVhbSA9IG5ldyBNZWRpYVN0cmVhbSgpO1xuICAgIHRyeSB7XG4gICAgc3RyZWFtLmdldFZpZGVvVHJhY2tzKCkuZm9yRWFjaCh0cmFjayA9PiB2aWRlb1N0cmVhbS5hZGRUcmFjayh0cmFjaykpO1xuXG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc29sZS53YXJuKGAke2NsaWVudElkfSBzZXRNZWRpYVN0cmVhbSBWaWRlbyBFcnJvcmAsIGUpO1xuICAgIH1cblxuICAgIHRoaXMubWVkaWFTdHJlYW1zW2NsaWVudElkXSA9IHsgYXVkaW86IGF1ZGlvU3RyZWFtLCB2aWRlbzogdmlkZW9TdHJlYW0gfTtcblxuICAgIC8vIFJlc29sdmUgdGhlIHByb21pc2UgZm9yIHRoZSB1c2VyJ3MgbWVkaWEgc3RyZWFtIGlmIGl0IGV4aXN0cy5cbiAgICBpZiAodGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5oYXMoY2xpZW50SWQpKSB7XG4gICAgICB0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmdldChjbGllbnRJZCkuYXVkaW8ucmVzb2x2ZShhdWRpb1N0cmVhbSk7XG4gICAgICB0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmdldChjbGllbnRJZCkudmlkZW8ucmVzb2x2ZSh2aWRlb1N0cmVhbSk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgc2V0TG9jYWxNZWRpYVN0cmVhbShzdHJlYW0pIHtcbiAgICAvLyBvdXIgam9iIGhlcmUgaXMgdG8gbWFrZSBzdXJlIHRoZSBjb25uZWN0aW9uIHdpbmRzIHVwIHdpdGggUlRQIHNlbmRlcnMgc2VuZGluZyB0aGUgc3R1ZmYgaW4gdGhpcyBzdHJlYW0sXG4gICAgLy8gYW5kIG5vdCB0aGUgc3R1ZmYgdGhhdCBpc24ndCBpbiB0aGlzIHN0cmVhbS4gc3RyYXRlZ3kgaXMgdG8gcmVwbGFjZSBleGlzdGluZyB0cmFja3MgaWYgd2UgY2FuLCBhZGQgdHJhY2tzXG4gICAgLy8gdGhhdCB3ZSBjYW4ndCByZXBsYWNlLCBhbmQgZGlzYWJsZSB0cmFja3MgdGhhdCBkb24ndCBleGlzdCBhbnltb3JlLlxuXG4gICAgLy8gbm90ZSB0aGF0IHdlIGRvbid0IGV2ZXIgcmVtb3ZlIGEgdHJhY2sgZnJvbSB0aGUgc3RyZWFtIC0tIHNpbmNlIEphbnVzIGRvZXNuJ3Qgc3VwcG9ydCBVbmlmaWVkIFBsYW4sIHdlIGFic29sdXRlbHlcbiAgICAvLyBjYW4ndCB3aW5kIHVwIHdpdGggYSBTRFAgdGhhdCBoYXMgPjEgYXVkaW8gb3IgPjEgdmlkZW8gdHJhY2tzLCBldmVuIGlmIG9uZSBvZiB0aGVtIGlzIGluYWN0aXZlICh3aGF0IHlvdSBnZXQgaWZcbiAgICAvLyB5b3UgcmVtb3ZlIGEgdHJhY2sgZnJvbSBhbiBleGlzdGluZyBzdHJlYW0uKVxuICAgIGlmICh0aGlzLnB1Ymxpc2hlciAmJiB0aGlzLnB1Ymxpc2hlci5jb25uKSB7XG4gICAgICBjb25zdCBleGlzdGluZ1NlbmRlcnMgPSB0aGlzLnB1Ymxpc2hlci5jb25uLmdldFNlbmRlcnMoKTtcbiAgICAgIGNvbnN0IG5ld1NlbmRlcnMgPSBbXTtcbiAgICAgIGNvbnN0IHRyYWNrcyA9IHN0cmVhbS5nZXRUcmFja3MoKTtcblxuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0cmFja3MubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgY29uc3QgdCA9IHRyYWNrc1tpXTtcbiAgICAgICAgY29uc3Qgc2VuZGVyID0gZXhpc3RpbmdTZW5kZXJzLmZpbmQocyA9PiBzLnRyYWNrICE9IG51bGwgJiYgcy50cmFjay5raW5kID09IHQua2luZCk7XG5cbiAgICAgICAgaWYgKHNlbmRlciAhPSBudWxsKSB7XG4gICAgICAgICAgaWYgKHNlbmRlci5yZXBsYWNlVHJhY2spIHtcbiAgICAgICAgICAgIGF3YWl0IHNlbmRlci5yZXBsYWNlVHJhY2sodCk7XG5cbiAgICAgICAgICAgIC8vIFdvcmthcm91bmQgaHR0cHM6Ly9idWd6aWxsYS5tb3ppbGxhLm9yZy9zaG93X2J1Zy5jZ2k/aWQ9MTU3Njc3MVxuICAgICAgICAgICAgaWYgKHQua2luZCA9PT0gXCJ2aWRlb1wiICYmIHQuZW5hYmxlZCAmJiBuYXZpZ2F0b3IudXNlckFnZW50LnRvTG93ZXJDYXNlKCkuaW5kZXhPZignZmlyZWZveCcpID4gLTEpIHtcbiAgICAgICAgICAgICAgdC5lbmFibGVkID0gZmFsc2U7XG4gICAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4gdC5lbmFibGVkID0gdHJ1ZSwgMTAwMCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIEZhbGxiYWNrIGZvciBicm93c2VycyB0aGF0IGRvbid0IHN1cHBvcnQgcmVwbGFjZVRyYWNrLiBBdCB0aGlzIHRpbWUgb2YgdGhpcyB3cml0aW5nXG4gICAgICAgICAgICAvLyBtb3N0IGJyb3dzZXJzIHN1cHBvcnQgaXQsIGFuZCB0ZXN0aW5nIHRoaXMgY29kZSBwYXRoIHNlZW1zIHRvIG5vdCB3b3JrIHByb3Blcmx5XG4gICAgICAgICAgICAvLyBpbiBDaHJvbWUgYW55bW9yZS5cbiAgICAgICAgICAgIHN0cmVhbS5yZW1vdmVUcmFjayhzZW5kZXIudHJhY2spO1xuICAgICAgICAgICAgc3RyZWFtLmFkZFRyYWNrKHQpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBuZXdTZW5kZXJzLnB1c2goc2VuZGVyKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBuZXdTZW5kZXJzLnB1c2godGhpcy5wdWJsaXNoZXIuY29ubi5hZGRUcmFjayh0LCBzdHJlYW0pKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgZXhpc3RpbmdTZW5kZXJzLmZvckVhY2gocyA9PiB7XG4gICAgICAgIGlmICghbmV3U2VuZGVycy5pbmNsdWRlcyhzKSkge1xuICAgICAgICAgIHMudHJhY2suZW5hYmxlZCA9IGZhbHNlO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gICAgdGhpcy5sb2NhbE1lZGlhU3RyZWFtID0gc3RyZWFtO1xuICAgIHRoaXMuc2V0TWVkaWFTdHJlYW0odGhpcy5jbGllbnRJZCwgc3RyZWFtKTtcbiAgfVxuXG4gIGVuYWJsZU1pY3JvcGhvbmUoZW5hYmxlZCkge1xuICAgIGlmICh0aGlzLnB1Ymxpc2hlciAmJiB0aGlzLnB1Ymxpc2hlci5jb25uKSB7XG4gICAgICB0aGlzLnB1Ymxpc2hlci5jb25uLmdldFNlbmRlcnMoKS5mb3JFYWNoKHMgPT4ge1xuICAgICAgICBpZiAocy50cmFjay5raW5kID09IFwiYXVkaW9cIikge1xuICAgICAgICAgIHMudHJhY2suZW5hYmxlZCA9IGVuYWJsZWQ7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIHNlbmREYXRhKGNsaWVudElkLCBkYXRhVHlwZSwgZGF0YSkge1xuICAgIGlmICghdGhpcy5wdWJsaXNoZXIpIHtcbiAgICAgIGNvbnNvbGUud2FybihcInNlbmREYXRhIGNhbGxlZCB3aXRob3V0IGEgcHVibGlzaGVyXCIpO1xuICAgIH0gZWxzZSB7XG4gICAgICBzd2l0Y2ggKHRoaXMudW5yZWxpYWJsZVRyYW5zcG9ydCkge1xuICAgICAgICBjYXNlIFwid2Vic29ja2V0XCI6XG4gICAgICAgICAgaWYgKHRoaXMud3MucmVhZHlTdGF0ZSA9PT0gMSkgeyAvLyBPUEVOXG4gICAgICAgICAgICB0aGlzLnB1Ymxpc2hlci5oYW5kbGUuc2VuZE1lc3NhZ2UoeyBraW5kOiBcImRhdGFcIiwgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBkYXRhVHlwZSwgZGF0YSB9KSwgd2hvbTogY2xpZW50SWQgfSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIFwiZGF0YWNoYW5uZWxcIjpcbiAgICAgICAgICBpZiAodGhpcy5wdWJsaXNoZXIudW5yZWxpYWJsZUNoYW5uZWwucmVhZHlTdGF0ZSA9PT0gXCJvcGVuXCIpIHtcbiAgICAgICAgICAgIHRoaXMucHVibGlzaGVyLnVucmVsaWFibGVDaGFubmVsLnNlbmQoSlNPTi5zdHJpbmdpZnkoeyBjbGllbnRJZCwgZGF0YVR5cGUsIGRhdGEgfSkpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICB0aGlzLnVucmVsaWFibGVUcmFuc3BvcnQoY2xpZW50SWQsIGRhdGFUeXBlLCBkYXRhKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBzZW5kRGF0YUd1YXJhbnRlZWQoY2xpZW50SWQsIGRhdGFUeXBlLCBkYXRhKSB7XG4gICAgaWYgKCF0aGlzLnB1Ymxpc2hlcikge1xuICAgICAgY29uc29sZS53YXJuKFwic2VuZERhdGFHdWFyYW50ZWVkIGNhbGxlZCB3aXRob3V0IGEgcHVibGlzaGVyXCIpO1xuICAgIH0gZWxzZSB7XG4gICAgICBzd2l0Y2ggKHRoaXMucmVsaWFibGVUcmFuc3BvcnQpIHtcbiAgICAgICAgY2FzZSBcIndlYnNvY2tldFwiOlxuICAgICAgICAgIGlmICh0aGlzLndzLnJlYWR5U3RhdGUgPT09IDEpIHsgLy8gT1BFTlxuICAgICAgICAgICAgdGhpcy5wdWJsaXNoZXIuaGFuZGxlLnNlbmRNZXNzYWdlKHsga2luZDogXCJkYXRhXCIsIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZGF0YVR5cGUsIGRhdGEgfSksIHdob206IGNsaWVudElkIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSBcImRhdGFjaGFubmVsXCI6XG4gICAgICAgICAgaWYgKHRoaXMucHVibGlzaGVyLnJlbGlhYmxlQ2hhbm5lbC5yZWFkeVN0YXRlID09PSBcIm9wZW5cIikge1xuICAgICAgICAgICAgdGhpcy5wdWJsaXNoZXIucmVsaWFibGVDaGFubmVsLnNlbmQoSlNPTi5zdHJpbmdpZnkoeyBjbGllbnRJZCwgZGF0YVR5cGUsIGRhdGEgfSkpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICB0aGlzLnJlbGlhYmxlVHJhbnNwb3J0KGNsaWVudElkLCBkYXRhVHlwZSwgZGF0YSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgYnJvYWRjYXN0RGF0YShkYXRhVHlwZSwgZGF0YSkge1xuICAgIGlmICghdGhpcy5wdWJsaXNoZXIpIHtcbiAgICAgIGNvbnNvbGUud2FybihcImJyb2FkY2FzdERhdGEgY2FsbGVkIHdpdGhvdXQgYSBwdWJsaXNoZXJcIik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHN3aXRjaCAodGhpcy51bnJlbGlhYmxlVHJhbnNwb3J0KSB7XG4gICAgICAgIGNhc2UgXCJ3ZWJzb2NrZXRcIjpcbiAgICAgICAgICBpZiAodGhpcy53cy5yZWFkeVN0YXRlID09PSAxKSB7IC8vIE9QRU5cbiAgICAgICAgICAgIHRoaXMucHVibGlzaGVyLmhhbmRsZS5zZW5kTWVzc2FnZSh7IGtpbmQ6IFwiZGF0YVwiLCBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGRhdGFUeXBlLCBkYXRhIH0pIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSBcImRhdGFjaGFubmVsXCI6XG4gICAgICAgICAgaWYgKHRoaXMucHVibGlzaGVyLnVucmVsaWFibGVDaGFubmVsLnJlYWR5U3RhdGUgPT09IFwib3BlblwiKSB7XG4gICAgICAgICAgICB0aGlzLnB1Ymxpc2hlci51bnJlbGlhYmxlQ2hhbm5lbC5zZW5kKEpTT04uc3RyaW5naWZ5KHsgZGF0YVR5cGUsIGRhdGEgfSkpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICB0aGlzLnVucmVsaWFibGVUcmFuc3BvcnQodW5kZWZpbmVkLCBkYXRhVHlwZSwgZGF0YSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgYnJvYWRjYXN0RGF0YUd1YXJhbnRlZWQoZGF0YVR5cGUsIGRhdGEpIHtcbiAgICBpZiAoIXRoaXMucHVibGlzaGVyKSB7XG4gICAgICBjb25zb2xlLndhcm4oXCJicm9hZGNhc3REYXRhR3VhcmFudGVlZCBjYWxsZWQgd2l0aG91dCBhIHB1Ymxpc2hlclwiKTtcbiAgICB9IGVsc2Uge1xuICAgICAgc3dpdGNoICh0aGlzLnJlbGlhYmxlVHJhbnNwb3J0KSB7XG4gICAgICAgIGNhc2UgXCJ3ZWJzb2NrZXRcIjpcbiAgICAgICAgICBpZiAodGhpcy53cy5yZWFkeVN0YXRlID09PSAxKSB7IC8vIE9QRU5cbiAgICAgICAgICAgIHRoaXMucHVibGlzaGVyLmhhbmRsZS5zZW5kTWVzc2FnZSh7IGtpbmQ6IFwiZGF0YVwiLCBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGRhdGFUeXBlLCBkYXRhIH0pIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSBcImRhdGFjaGFubmVsXCI6XG4gICAgICAgICAgaWYgKHRoaXMucHVibGlzaGVyLnJlbGlhYmxlQ2hhbm5lbC5yZWFkeVN0YXRlID09PSBcIm9wZW5cIikge1xuICAgICAgICAgICAgdGhpcy5wdWJsaXNoZXIucmVsaWFibGVDaGFubmVsLnNlbmQoSlNPTi5zdHJpbmdpZnkoeyBkYXRhVHlwZSwgZGF0YSB9KSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHRoaXMucmVsaWFibGVUcmFuc3BvcnQodW5kZWZpbmVkLCBkYXRhVHlwZSwgZGF0YSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAga2ljayhjbGllbnRJZCwgcGVybXNUb2tlbikge1xuICAgIHJldHVybiB0aGlzLnB1Ymxpc2hlci5oYW5kbGUuc2VuZE1lc3NhZ2UoeyBraW5kOiBcImtpY2tcIiwgcm9vbV9pZDogdGhpcy5yb29tLCB1c2VyX2lkOiBjbGllbnRJZCwgdG9rZW46IHBlcm1zVG9rZW4gfSkudGhlbigoKSA9PiB7XG4gICAgICBkb2N1bWVudC5ib2R5LmRpc3BhdGNoRXZlbnQobmV3IEN1c3RvbUV2ZW50KFwia2lja2VkXCIsIHsgZGV0YWlsOiB7IGNsaWVudElkOiBjbGllbnRJZCB9IH0pKTtcbiAgICB9KTtcbiAgfVxuXG4gIGJsb2NrKGNsaWVudElkKSB7XG4gICAgcmV0dXJuIHRoaXMucHVibGlzaGVyLmhhbmRsZS5zZW5kTWVzc2FnZSh7IGtpbmQ6IFwiYmxvY2tcIiwgd2hvbTogY2xpZW50SWQgfSkudGhlbigoKSA9PiB7XG4gICAgICB0aGlzLmJsb2NrZWRDbGllbnRzLnNldChjbGllbnRJZCwgdHJ1ZSk7XG4gICAgICBkb2N1bWVudC5ib2R5LmRpc3BhdGNoRXZlbnQobmV3IEN1c3RvbUV2ZW50KFwiYmxvY2tlZFwiLCB7IGRldGFpbDogeyBjbGllbnRJZDogY2xpZW50SWQgfSB9KSk7XG4gICAgfSk7XG4gIH1cblxuICB1bmJsb2NrKGNsaWVudElkKSB7XG4gICAgcmV0dXJuIHRoaXMucHVibGlzaGVyLmhhbmRsZS5zZW5kTWVzc2FnZSh7IGtpbmQ6IFwidW5ibG9ja1wiLCB3aG9tOiBjbGllbnRJZCB9KS50aGVuKCgpID0+IHtcbiAgICAgIHRoaXMuYmxvY2tlZENsaWVudHMuZGVsZXRlKGNsaWVudElkKTtcbiAgICAgIGRvY3VtZW50LmJvZHkuZGlzcGF0Y2hFdmVudChuZXcgQ3VzdG9tRXZlbnQoXCJ1bmJsb2NrZWRcIiwgeyBkZXRhaWw6IHsgY2xpZW50SWQ6IGNsaWVudElkIH0gfSkpO1xuICAgIH0pO1xuICB9XG59XG5cbk5BRi5hZGFwdGVycy5yZWdpc3RlcihcImphbnVzXCIsIEphbnVzQWRhcHRlcik7XG5cbm1vZHVsZS5leHBvcnRzID0gSmFudXNBZGFwdGVyO1xuIiwiLyogZXNsaW50LWVudiBub2RlICovXG4ndXNlIHN0cmljdCc7XG5cbi8vIFNEUCBoZWxwZXJzLlxuY29uc3QgU0RQVXRpbHMgPSB7fTtcblxuLy8gR2VuZXJhdGUgYW4gYWxwaGFudW1lcmljIGlkZW50aWZpZXIgZm9yIGNuYW1lIG9yIG1pZHMuXG4vLyBUT0RPOiB1c2UgVVVJRHMgaW5zdGVhZD8gaHR0cHM6Ly9naXN0LmdpdGh1Yi5jb20vamVkLzk4Mjg4M1xuU0RQVXRpbHMuZ2VuZXJhdGVJZGVudGlmaWVyID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zdWJzdHJpbmcoMiwgMTIpO1xufTtcblxuLy8gVGhlIFJUQ1AgQ05BTUUgdXNlZCBieSBhbGwgcGVlcmNvbm5lY3Rpb25zIGZyb20gdGhlIHNhbWUgSlMuXG5TRFBVdGlscy5sb2NhbENOYW1lID0gU0RQVXRpbHMuZ2VuZXJhdGVJZGVudGlmaWVyKCk7XG5cbi8vIFNwbGl0cyBTRFAgaW50byBsaW5lcywgZGVhbGluZyB3aXRoIGJvdGggQ1JMRiBhbmQgTEYuXG5TRFBVdGlscy5zcGxpdExpbmVzID0gZnVuY3Rpb24oYmxvYikge1xuICByZXR1cm4gYmxvYi50cmltKCkuc3BsaXQoJ1xcbicpLm1hcChsaW5lID0+IGxpbmUudHJpbSgpKTtcbn07XG4vLyBTcGxpdHMgU0RQIGludG8gc2Vzc2lvbnBhcnQgYW5kIG1lZGlhc2VjdGlvbnMuIEVuc3VyZXMgQ1JMRi5cblNEUFV0aWxzLnNwbGl0U2VjdGlvbnMgPSBmdW5jdGlvbihibG9iKSB7XG4gIGNvbnN0IHBhcnRzID0gYmxvYi5zcGxpdCgnXFxubT0nKTtcbiAgcmV0dXJuIHBhcnRzLm1hcCgocGFydCwgaW5kZXgpID0+IChpbmRleCA+IDAgP1xuICAgICdtPScgKyBwYXJ0IDogcGFydCkudHJpbSgpICsgJ1xcclxcbicpO1xufTtcblxuLy8gUmV0dXJucyB0aGUgc2Vzc2lvbiBkZXNjcmlwdGlvbi5cblNEUFV0aWxzLmdldERlc2NyaXB0aW9uID0gZnVuY3Rpb24oYmxvYikge1xuICBjb25zdCBzZWN0aW9ucyA9IFNEUFV0aWxzLnNwbGl0U2VjdGlvbnMoYmxvYik7XG4gIHJldHVybiBzZWN0aW9ucyAmJiBzZWN0aW9uc1swXTtcbn07XG5cbi8vIFJldHVybnMgdGhlIGluZGl2aWR1YWwgbWVkaWEgc2VjdGlvbnMuXG5TRFBVdGlscy5nZXRNZWRpYVNlY3Rpb25zID0gZnVuY3Rpb24oYmxvYikge1xuICBjb25zdCBzZWN0aW9ucyA9IFNEUFV0aWxzLnNwbGl0U2VjdGlvbnMoYmxvYik7XG4gIHNlY3Rpb25zLnNoaWZ0KCk7XG4gIHJldHVybiBzZWN0aW9ucztcbn07XG5cbi8vIFJldHVybnMgbGluZXMgdGhhdCBzdGFydCB3aXRoIGEgY2VydGFpbiBwcmVmaXguXG5TRFBVdGlscy5tYXRjaFByZWZpeCA9IGZ1bmN0aW9uKGJsb2IsIHByZWZpeCkge1xuICByZXR1cm4gU0RQVXRpbHMuc3BsaXRMaW5lcyhibG9iKS5maWx0ZXIobGluZSA9PiBsaW5lLmluZGV4T2YocHJlZml4KSA9PT0gMCk7XG59O1xuXG4vLyBQYXJzZXMgYW4gSUNFIGNhbmRpZGF0ZSBsaW5lLiBTYW1wbGUgaW5wdXQ6XG4vLyBjYW5kaWRhdGU6NzAyNzg2MzUwIDIgdWRwIDQxODE5OTAyIDguOC44LjggNjA3NjkgdHlwIHJlbGF5IHJhZGRyIDguOC44Ljhcbi8vIHJwb3J0IDU1OTk2XCJcbi8vIElucHV0IGNhbiBiZSBwcmVmaXhlZCB3aXRoIGE9LlxuU0RQVXRpbHMucGFyc2VDYW5kaWRhdGUgPSBmdW5jdGlvbihsaW5lKSB7XG4gIGxldCBwYXJ0cztcbiAgLy8gUGFyc2UgYm90aCB2YXJpYW50cy5cbiAgaWYgKGxpbmUuaW5kZXhPZignYT1jYW5kaWRhdGU6JykgPT09IDApIHtcbiAgICBwYXJ0cyA9IGxpbmUuc3Vic3RyaW5nKDEyKS5zcGxpdCgnICcpO1xuICB9IGVsc2Uge1xuICAgIHBhcnRzID0gbGluZS5zdWJzdHJpbmcoMTApLnNwbGl0KCcgJyk7XG4gIH1cblxuICBjb25zdCBjYW5kaWRhdGUgPSB7XG4gICAgZm91bmRhdGlvbjogcGFydHNbMF0sXG4gICAgY29tcG9uZW50OiB7MTogJ3J0cCcsIDI6ICdydGNwJ31bcGFydHNbMV1dIHx8IHBhcnRzWzFdLFxuICAgIHByb3RvY29sOiBwYXJ0c1syXS50b0xvd2VyQ2FzZSgpLFxuICAgIHByaW9yaXR5OiBwYXJzZUludChwYXJ0c1szXSwgMTApLFxuICAgIGlwOiBwYXJ0c1s0XSxcbiAgICBhZGRyZXNzOiBwYXJ0c1s0XSwgLy8gYWRkcmVzcyBpcyBhbiBhbGlhcyBmb3IgaXAuXG4gICAgcG9ydDogcGFyc2VJbnQocGFydHNbNV0sIDEwKSxcbiAgICAvLyBza2lwIHBhcnRzWzZdID09ICd0eXAnXG4gICAgdHlwZTogcGFydHNbN10sXG4gIH07XG5cbiAgZm9yIChsZXQgaSA9IDg7IGkgPCBwYXJ0cy5sZW5ndGg7IGkgKz0gMikge1xuICAgIHN3aXRjaCAocGFydHNbaV0pIHtcbiAgICAgIGNhc2UgJ3JhZGRyJzpcbiAgICAgICAgY2FuZGlkYXRlLnJlbGF0ZWRBZGRyZXNzID0gcGFydHNbaSArIDFdO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3Jwb3J0JzpcbiAgICAgICAgY2FuZGlkYXRlLnJlbGF0ZWRQb3J0ID0gcGFyc2VJbnQocGFydHNbaSArIDFdLCAxMCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAndGNwdHlwZSc6XG4gICAgICAgIGNhbmRpZGF0ZS50Y3BUeXBlID0gcGFydHNbaSArIDFdO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3VmcmFnJzpcbiAgICAgICAgY2FuZGlkYXRlLnVmcmFnID0gcGFydHNbaSArIDFdOyAvLyBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eS5cbiAgICAgICAgY2FuZGlkYXRlLnVzZXJuYW1lRnJhZ21lbnQgPSBwYXJ0c1tpICsgMV07XG4gICAgICAgIGJyZWFrO1xuICAgICAgZGVmYXVsdDogLy8gZXh0ZW5zaW9uIGhhbmRsaW5nLCBpbiBwYXJ0aWN1bGFyIHVmcmFnLiBEb24ndCBvdmVyd3JpdGUuXG4gICAgICAgIGlmIChjYW5kaWRhdGVbcGFydHNbaV1dID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBjYW5kaWRhdGVbcGFydHNbaV1dID0gcGFydHNbaSArIDFdO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuICByZXR1cm4gY2FuZGlkYXRlO1xufTtcblxuLy8gVHJhbnNsYXRlcyBhIGNhbmRpZGF0ZSBvYmplY3QgaW50byBTRFAgY2FuZGlkYXRlIGF0dHJpYnV0ZS5cbi8vIFRoaXMgZG9lcyBub3QgaW5jbHVkZSB0aGUgYT0gcHJlZml4IVxuU0RQVXRpbHMud3JpdGVDYW5kaWRhdGUgPSBmdW5jdGlvbihjYW5kaWRhdGUpIHtcbiAgY29uc3Qgc2RwID0gW107XG4gIHNkcC5wdXNoKGNhbmRpZGF0ZS5mb3VuZGF0aW9uKTtcblxuICBjb25zdCBjb21wb25lbnQgPSBjYW5kaWRhdGUuY29tcG9uZW50O1xuICBpZiAoY29tcG9uZW50ID09PSAncnRwJykge1xuICAgIHNkcC5wdXNoKDEpO1xuICB9IGVsc2UgaWYgKGNvbXBvbmVudCA9PT0gJ3J0Y3AnKSB7XG4gICAgc2RwLnB1c2goMik7XG4gIH0gZWxzZSB7XG4gICAgc2RwLnB1c2goY29tcG9uZW50KTtcbiAgfVxuICBzZHAucHVzaChjYW5kaWRhdGUucHJvdG9jb2wudG9VcHBlckNhc2UoKSk7XG4gIHNkcC5wdXNoKGNhbmRpZGF0ZS5wcmlvcml0eSk7XG4gIHNkcC5wdXNoKGNhbmRpZGF0ZS5hZGRyZXNzIHx8IGNhbmRpZGF0ZS5pcCk7XG4gIHNkcC5wdXNoKGNhbmRpZGF0ZS5wb3J0KTtcblxuICBjb25zdCB0eXBlID0gY2FuZGlkYXRlLnR5cGU7XG4gIHNkcC5wdXNoKCd0eXAnKTtcbiAgc2RwLnB1c2godHlwZSk7XG4gIGlmICh0eXBlICE9PSAnaG9zdCcgJiYgY2FuZGlkYXRlLnJlbGF0ZWRBZGRyZXNzICYmXG4gICAgICBjYW5kaWRhdGUucmVsYXRlZFBvcnQpIHtcbiAgICBzZHAucHVzaCgncmFkZHInKTtcbiAgICBzZHAucHVzaChjYW5kaWRhdGUucmVsYXRlZEFkZHJlc3MpO1xuICAgIHNkcC5wdXNoKCdycG9ydCcpO1xuICAgIHNkcC5wdXNoKGNhbmRpZGF0ZS5yZWxhdGVkUG9ydCk7XG4gIH1cbiAgaWYgKGNhbmRpZGF0ZS50Y3BUeXBlICYmIGNhbmRpZGF0ZS5wcm90b2NvbC50b0xvd2VyQ2FzZSgpID09PSAndGNwJykge1xuICAgIHNkcC5wdXNoKCd0Y3B0eXBlJyk7XG4gICAgc2RwLnB1c2goY2FuZGlkYXRlLnRjcFR5cGUpO1xuICB9XG4gIGlmIChjYW5kaWRhdGUudXNlcm5hbWVGcmFnbWVudCB8fCBjYW5kaWRhdGUudWZyYWcpIHtcbiAgICBzZHAucHVzaCgndWZyYWcnKTtcbiAgICBzZHAucHVzaChjYW5kaWRhdGUudXNlcm5hbWVGcmFnbWVudCB8fCBjYW5kaWRhdGUudWZyYWcpO1xuICB9XG4gIHJldHVybiAnY2FuZGlkYXRlOicgKyBzZHAuam9pbignICcpO1xufTtcblxuLy8gUGFyc2VzIGFuIGljZS1vcHRpb25zIGxpbmUsIHJldHVybnMgYW4gYXJyYXkgb2Ygb3B0aW9uIHRhZ3MuXG4vLyBTYW1wbGUgaW5wdXQ6XG4vLyBhPWljZS1vcHRpb25zOmZvbyBiYXJcblNEUFV0aWxzLnBhcnNlSWNlT3B0aW9ucyA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgcmV0dXJuIGxpbmUuc3Vic3RyaW5nKDE0KS5zcGxpdCgnICcpO1xufTtcblxuLy8gUGFyc2VzIGEgcnRwbWFwIGxpbmUsIHJldHVybnMgUlRDUnRwQ29kZGVjUGFyYW1ldGVycy4gU2FtcGxlIGlucHV0OlxuLy8gYT1ydHBtYXA6MTExIG9wdXMvNDgwMDAvMlxuU0RQVXRpbHMucGFyc2VSdHBNYXAgPSBmdW5jdGlvbihsaW5lKSB7XG4gIGxldCBwYXJ0cyA9IGxpbmUuc3Vic3RyaW5nKDkpLnNwbGl0KCcgJyk7XG4gIGNvbnN0IHBhcnNlZCA9IHtcbiAgICBwYXlsb2FkVHlwZTogcGFyc2VJbnQocGFydHMuc2hpZnQoKSwgMTApLCAvLyB3YXM6IGlkXG4gIH07XG5cbiAgcGFydHMgPSBwYXJ0c1swXS5zcGxpdCgnLycpO1xuXG4gIHBhcnNlZC5uYW1lID0gcGFydHNbMF07XG4gIHBhcnNlZC5jbG9ja1JhdGUgPSBwYXJzZUludChwYXJ0c1sxXSwgMTApOyAvLyB3YXM6IGNsb2NrcmF0ZVxuICBwYXJzZWQuY2hhbm5lbHMgPSBwYXJ0cy5sZW5ndGggPT09IDMgPyBwYXJzZUludChwYXJ0c1syXSwgMTApIDogMTtcbiAgLy8gbGVnYWN5IGFsaWFzLCBnb3QgcmVuYW1lZCBiYWNrIHRvIGNoYW5uZWxzIGluIE9SVEMuXG4gIHBhcnNlZC5udW1DaGFubmVscyA9IHBhcnNlZC5jaGFubmVscztcbiAgcmV0dXJuIHBhcnNlZDtcbn07XG5cbi8vIEdlbmVyYXRlcyBhIHJ0cG1hcCBsaW5lIGZyb20gUlRDUnRwQ29kZWNDYXBhYmlsaXR5IG9yXG4vLyBSVENSdHBDb2RlY1BhcmFtZXRlcnMuXG5TRFBVdGlscy53cml0ZVJ0cE1hcCA9IGZ1bmN0aW9uKGNvZGVjKSB7XG4gIGxldCBwdCA9IGNvZGVjLnBheWxvYWRUeXBlO1xuICBpZiAoY29kZWMucHJlZmVycmVkUGF5bG9hZFR5cGUgIT09IHVuZGVmaW5lZCkge1xuICAgIHB0ID0gY29kZWMucHJlZmVycmVkUGF5bG9hZFR5cGU7XG4gIH1cbiAgY29uc3QgY2hhbm5lbHMgPSBjb2RlYy5jaGFubmVscyB8fCBjb2RlYy5udW1DaGFubmVscyB8fCAxO1xuICByZXR1cm4gJ2E9cnRwbWFwOicgKyBwdCArICcgJyArIGNvZGVjLm5hbWUgKyAnLycgKyBjb2RlYy5jbG9ja1JhdGUgK1xuICAgICAgKGNoYW5uZWxzICE9PSAxID8gJy8nICsgY2hhbm5lbHMgOiAnJykgKyAnXFxyXFxuJztcbn07XG5cbi8vIFBhcnNlcyBhIGV4dG1hcCBsaW5lIChoZWFkZXJleHRlbnNpb24gZnJvbSBSRkMgNTI4NSkuIFNhbXBsZSBpbnB1dDpcbi8vIGE9ZXh0bWFwOjIgdXJuOmlldGY6cGFyYW1zOnJ0cC1oZHJleHQ6dG9mZnNldFxuLy8gYT1leHRtYXA6Mi9zZW5kb25seSB1cm46aWV0ZjpwYXJhbXM6cnRwLWhkcmV4dDp0b2Zmc2V0XG5TRFBVdGlscy5wYXJzZUV4dG1hcCA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgY29uc3QgcGFydHMgPSBsaW5lLnN1YnN0cmluZyg5KS5zcGxpdCgnICcpO1xuICByZXR1cm4ge1xuICAgIGlkOiBwYXJzZUludChwYXJ0c1swXSwgMTApLFxuICAgIGRpcmVjdGlvbjogcGFydHNbMF0uaW5kZXhPZignLycpID4gMCA/IHBhcnRzWzBdLnNwbGl0KCcvJylbMV0gOiAnc2VuZHJlY3YnLFxuICAgIHVyaTogcGFydHNbMV0sXG4gICAgYXR0cmlidXRlczogcGFydHMuc2xpY2UoMikuam9pbignICcpLFxuICB9O1xufTtcblxuLy8gR2VuZXJhdGVzIGFuIGV4dG1hcCBsaW5lIGZyb20gUlRDUnRwSGVhZGVyRXh0ZW5zaW9uUGFyYW1ldGVycyBvclxuLy8gUlRDUnRwSGVhZGVyRXh0ZW5zaW9uLlxuU0RQVXRpbHMud3JpdGVFeHRtYXAgPSBmdW5jdGlvbihoZWFkZXJFeHRlbnNpb24pIHtcbiAgcmV0dXJuICdhPWV4dG1hcDonICsgKGhlYWRlckV4dGVuc2lvbi5pZCB8fCBoZWFkZXJFeHRlbnNpb24ucHJlZmVycmVkSWQpICtcbiAgICAgIChoZWFkZXJFeHRlbnNpb24uZGlyZWN0aW9uICYmIGhlYWRlckV4dGVuc2lvbi5kaXJlY3Rpb24gIT09ICdzZW5kcmVjdidcbiAgICAgICAgPyAnLycgKyBoZWFkZXJFeHRlbnNpb24uZGlyZWN0aW9uXG4gICAgICAgIDogJycpICtcbiAgICAgICcgJyArIGhlYWRlckV4dGVuc2lvbi51cmkgK1xuICAgICAgKGhlYWRlckV4dGVuc2lvbi5hdHRyaWJ1dGVzID8gJyAnICsgaGVhZGVyRXh0ZW5zaW9uLmF0dHJpYnV0ZXMgOiAnJykgK1xuICAgICAgJ1xcclxcbic7XG59O1xuXG4vLyBQYXJzZXMgYSBmbXRwIGxpbmUsIHJldHVybnMgZGljdGlvbmFyeS4gU2FtcGxlIGlucHV0OlxuLy8gYT1mbXRwOjk2IHZicj1vbjtjbmc9b25cbi8vIEFsc28gZGVhbHMgd2l0aCB2YnI9b247IGNuZz1vblxuU0RQVXRpbHMucGFyc2VGbXRwID0gZnVuY3Rpb24obGluZSkge1xuICBjb25zdCBwYXJzZWQgPSB7fTtcbiAgbGV0IGt2O1xuICBjb25zdCBwYXJ0cyA9IGxpbmUuc3Vic3RyaW5nKGxpbmUuaW5kZXhPZignICcpICsgMSkuc3BsaXQoJzsnKTtcbiAgZm9yIChsZXQgaiA9IDA7IGogPCBwYXJ0cy5sZW5ndGg7IGorKykge1xuICAgIGt2ID0gcGFydHNbal0udHJpbSgpLnNwbGl0KCc9Jyk7XG4gICAgcGFyc2VkW2t2WzBdLnRyaW0oKV0gPSBrdlsxXTtcbiAgfVxuICByZXR1cm4gcGFyc2VkO1xufTtcblxuLy8gR2VuZXJhdGVzIGEgZm10cCBsaW5lIGZyb20gUlRDUnRwQ29kZWNDYXBhYmlsaXR5IG9yIFJUQ1J0cENvZGVjUGFyYW1ldGVycy5cblNEUFV0aWxzLndyaXRlRm10cCA9IGZ1bmN0aW9uKGNvZGVjKSB7XG4gIGxldCBsaW5lID0gJyc7XG4gIGxldCBwdCA9IGNvZGVjLnBheWxvYWRUeXBlO1xuICBpZiAoY29kZWMucHJlZmVycmVkUGF5bG9hZFR5cGUgIT09IHVuZGVmaW5lZCkge1xuICAgIHB0ID0gY29kZWMucHJlZmVycmVkUGF5bG9hZFR5cGU7XG4gIH1cbiAgaWYgKGNvZGVjLnBhcmFtZXRlcnMgJiYgT2JqZWN0LmtleXMoY29kZWMucGFyYW1ldGVycykubGVuZ3RoKSB7XG4gICAgY29uc3QgcGFyYW1zID0gW107XG4gICAgT2JqZWN0LmtleXMoY29kZWMucGFyYW1ldGVycykuZm9yRWFjaChwYXJhbSA9PiB7XG4gICAgICBpZiAoY29kZWMucGFyYW1ldGVyc1twYXJhbV0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBwYXJhbXMucHVzaChwYXJhbSArICc9JyArIGNvZGVjLnBhcmFtZXRlcnNbcGFyYW1dKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHBhcmFtcy5wdXNoKHBhcmFtKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBsaW5lICs9ICdhPWZtdHA6JyArIHB0ICsgJyAnICsgcGFyYW1zLmpvaW4oJzsnKSArICdcXHJcXG4nO1xuICB9XG4gIHJldHVybiBsaW5lO1xufTtcblxuLy8gUGFyc2VzIGEgcnRjcC1mYiBsaW5lLCByZXR1cm5zIFJUQ1BSdGNwRmVlZGJhY2sgb2JqZWN0LiBTYW1wbGUgaW5wdXQ6XG4vLyBhPXJ0Y3AtZmI6OTggbmFjayBycHNpXG5TRFBVdGlscy5wYXJzZVJ0Y3BGYiA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgY29uc3QgcGFydHMgPSBsaW5lLnN1YnN0cmluZyhsaW5lLmluZGV4T2YoJyAnKSArIDEpLnNwbGl0KCcgJyk7XG4gIHJldHVybiB7XG4gICAgdHlwZTogcGFydHMuc2hpZnQoKSxcbiAgICBwYXJhbWV0ZXI6IHBhcnRzLmpvaW4oJyAnKSxcbiAgfTtcbn07XG5cbi8vIEdlbmVyYXRlIGE9cnRjcC1mYiBsaW5lcyBmcm9tIFJUQ1J0cENvZGVjQ2FwYWJpbGl0eSBvciBSVENSdHBDb2RlY1BhcmFtZXRlcnMuXG5TRFBVdGlscy53cml0ZVJ0Y3BGYiA9IGZ1bmN0aW9uKGNvZGVjKSB7XG4gIGxldCBsaW5lcyA9ICcnO1xuICBsZXQgcHQgPSBjb2RlYy5wYXlsb2FkVHlwZTtcbiAgaWYgKGNvZGVjLnByZWZlcnJlZFBheWxvYWRUeXBlICE9PSB1bmRlZmluZWQpIHtcbiAgICBwdCA9IGNvZGVjLnByZWZlcnJlZFBheWxvYWRUeXBlO1xuICB9XG4gIGlmIChjb2RlYy5ydGNwRmVlZGJhY2sgJiYgY29kZWMucnRjcEZlZWRiYWNrLmxlbmd0aCkge1xuICAgIC8vIEZJWE1FOiBzcGVjaWFsIGhhbmRsaW5nIGZvciB0cnItaW50P1xuICAgIGNvZGVjLnJ0Y3BGZWVkYmFjay5mb3JFYWNoKGZiID0+IHtcbiAgICAgIGxpbmVzICs9ICdhPXJ0Y3AtZmI6JyArIHB0ICsgJyAnICsgZmIudHlwZSArXG4gICAgICAoZmIucGFyYW1ldGVyICYmIGZiLnBhcmFtZXRlci5sZW5ndGggPyAnICcgKyBmYi5wYXJhbWV0ZXIgOiAnJykgK1xuICAgICAgICAgICdcXHJcXG4nO1xuICAgIH0pO1xuICB9XG4gIHJldHVybiBsaW5lcztcbn07XG5cbi8vIFBhcnNlcyBhIFJGQyA1NTc2IHNzcmMgbWVkaWEgYXR0cmlidXRlLiBTYW1wbGUgaW5wdXQ6XG4vLyBhPXNzcmM6MzczNTkyODU1OSBjbmFtZTpzb21ldGhpbmdcblNEUFV0aWxzLnBhcnNlU3NyY01lZGlhID0gZnVuY3Rpb24obGluZSkge1xuICBjb25zdCBzcCA9IGxpbmUuaW5kZXhPZignICcpO1xuICBjb25zdCBwYXJ0cyA9IHtcbiAgICBzc3JjOiBwYXJzZUludChsaW5lLnN1YnN0cmluZyg3LCBzcCksIDEwKSxcbiAgfTtcbiAgY29uc3QgY29sb24gPSBsaW5lLmluZGV4T2YoJzonLCBzcCk7XG4gIGlmIChjb2xvbiA+IC0xKSB7XG4gICAgcGFydHMuYXR0cmlidXRlID0gbGluZS5zdWJzdHJpbmcoc3AgKyAxLCBjb2xvbik7XG4gICAgcGFydHMudmFsdWUgPSBsaW5lLnN1YnN0cmluZyhjb2xvbiArIDEpO1xuICB9IGVsc2Uge1xuICAgIHBhcnRzLmF0dHJpYnV0ZSA9IGxpbmUuc3Vic3RyaW5nKHNwICsgMSk7XG4gIH1cbiAgcmV0dXJuIHBhcnRzO1xufTtcblxuLy8gUGFyc2UgYSBzc3JjLWdyb3VwIGxpbmUgKHNlZSBSRkMgNTU3NikuIFNhbXBsZSBpbnB1dDpcbi8vIGE9c3NyYy1ncm91cDpzZW1hbnRpY3MgMTIgMzRcblNEUFV0aWxzLnBhcnNlU3NyY0dyb3VwID0gZnVuY3Rpb24obGluZSkge1xuICBjb25zdCBwYXJ0cyA9IGxpbmUuc3Vic3RyaW5nKDEzKS5zcGxpdCgnICcpO1xuICByZXR1cm4ge1xuICAgIHNlbWFudGljczogcGFydHMuc2hpZnQoKSxcbiAgICBzc3JjczogcGFydHMubWFwKHNzcmMgPT4gcGFyc2VJbnQoc3NyYywgMTApKSxcbiAgfTtcbn07XG5cbi8vIEV4dHJhY3RzIHRoZSBNSUQgKFJGQyA1ODg4KSBmcm9tIGEgbWVkaWEgc2VjdGlvbi5cbi8vIFJldHVybnMgdGhlIE1JRCBvciB1bmRlZmluZWQgaWYgbm8gbWlkIGxpbmUgd2FzIGZvdW5kLlxuU0RQVXRpbHMuZ2V0TWlkID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIGNvbnN0IG1pZCA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9bWlkOicpWzBdO1xuICBpZiAobWlkKSB7XG4gICAgcmV0dXJuIG1pZC5zdWJzdHJpbmcoNik7XG4gIH1cbn07XG5cbi8vIFBhcnNlcyBhIGZpbmdlcnByaW50IGxpbmUgZm9yIERUTFMtU1JUUC5cblNEUFV0aWxzLnBhcnNlRmluZ2VycHJpbnQgPSBmdW5jdGlvbihsaW5lKSB7XG4gIGNvbnN0IHBhcnRzID0gbGluZS5zdWJzdHJpbmcoMTQpLnNwbGl0KCcgJyk7XG4gIHJldHVybiB7XG4gICAgYWxnb3JpdGhtOiBwYXJ0c1swXS50b0xvd2VyQ2FzZSgpLCAvLyBhbGdvcml0aG0gaXMgY2FzZS1zZW5zaXRpdmUgaW4gRWRnZS5cbiAgICB2YWx1ZTogcGFydHNbMV0udG9VcHBlckNhc2UoKSwgLy8gdGhlIGRlZmluaXRpb24gaXMgdXBwZXItY2FzZSBpbiBSRkMgNDU3Mi5cbiAgfTtcbn07XG5cbi8vIEV4dHJhY3RzIERUTFMgcGFyYW1ldGVycyBmcm9tIFNEUCBtZWRpYSBzZWN0aW9uIG9yIHNlc3Npb25wYXJ0LlxuLy8gRklYTUU6IGZvciBjb25zaXN0ZW5jeSB3aXRoIG90aGVyIGZ1bmN0aW9ucyB0aGlzIHNob3VsZCBvbmx5XG4vLyAgIGdldCB0aGUgZmluZ2VycHJpbnQgbGluZSBhcyBpbnB1dC4gU2VlIGFsc28gZ2V0SWNlUGFyYW1ldGVycy5cblNEUFV0aWxzLmdldER0bHNQYXJhbWV0ZXJzID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uLCBzZXNzaW9ucGFydCkge1xuICBjb25zdCBsaW5lcyA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiArIHNlc3Npb25wYXJ0LFxuICAgICdhPWZpbmdlcnByaW50OicpO1xuICAvLyBOb3RlOiBhPXNldHVwIGxpbmUgaXMgaWdub3JlZCBzaW5jZSB3ZSB1c2UgdGhlICdhdXRvJyByb2xlIGluIEVkZ2UuXG4gIHJldHVybiB7XG4gICAgcm9sZTogJ2F1dG8nLFxuICAgIGZpbmdlcnByaW50czogbGluZXMubWFwKFNEUFV0aWxzLnBhcnNlRmluZ2VycHJpbnQpLFxuICB9O1xufTtcblxuLy8gU2VyaWFsaXplcyBEVExTIHBhcmFtZXRlcnMgdG8gU0RQLlxuU0RQVXRpbHMud3JpdGVEdGxzUGFyYW1ldGVycyA9IGZ1bmN0aW9uKHBhcmFtcywgc2V0dXBUeXBlKSB7XG4gIGxldCBzZHAgPSAnYT1zZXR1cDonICsgc2V0dXBUeXBlICsgJ1xcclxcbic7XG4gIHBhcmFtcy5maW5nZXJwcmludHMuZm9yRWFjaChmcCA9PiB7XG4gICAgc2RwICs9ICdhPWZpbmdlcnByaW50OicgKyBmcC5hbGdvcml0aG0gKyAnICcgKyBmcC52YWx1ZSArICdcXHJcXG4nO1xuICB9KTtcbiAgcmV0dXJuIHNkcDtcbn07XG5cbi8vIFBhcnNlcyBhPWNyeXB0byBsaW5lcyBpbnRvXG4vLyAgIGh0dHBzOi8vcmF3Z2l0LmNvbS9hYm9iYS9lZGdlcnRjL21hc3Rlci9tc29ydGMtcnM0Lmh0bWwjZGljdGlvbmFyeS1ydGNzcnRwc2Rlc3BhcmFtZXRlcnMtbWVtYmVyc1xuU0RQVXRpbHMucGFyc2VDcnlwdG9MaW5lID0gZnVuY3Rpb24obGluZSkge1xuICBjb25zdCBwYXJ0cyA9IGxpbmUuc3Vic3RyaW5nKDkpLnNwbGl0KCcgJyk7XG4gIHJldHVybiB7XG4gICAgdGFnOiBwYXJzZUludChwYXJ0c1swXSwgMTApLFxuICAgIGNyeXB0b1N1aXRlOiBwYXJ0c1sxXSxcbiAgICBrZXlQYXJhbXM6IHBhcnRzWzJdLFxuICAgIHNlc3Npb25QYXJhbXM6IHBhcnRzLnNsaWNlKDMpLFxuICB9O1xufTtcblxuU0RQVXRpbHMud3JpdGVDcnlwdG9MaW5lID0gZnVuY3Rpb24ocGFyYW1ldGVycykge1xuICByZXR1cm4gJ2E9Y3J5cHRvOicgKyBwYXJhbWV0ZXJzLnRhZyArICcgJyArXG4gICAgcGFyYW1ldGVycy5jcnlwdG9TdWl0ZSArICcgJyArXG4gICAgKHR5cGVvZiBwYXJhbWV0ZXJzLmtleVBhcmFtcyA9PT0gJ29iamVjdCdcbiAgICAgID8gU0RQVXRpbHMud3JpdGVDcnlwdG9LZXlQYXJhbXMocGFyYW1ldGVycy5rZXlQYXJhbXMpXG4gICAgICA6IHBhcmFtZXRlcnMua2V5UGFyYW1zKSArXG4gICAgKHBhcmFtZXRlcnMuc2Vzc2lvblBhcmFtcyA/ICcgJyArIHBhcmFtZXRlcnMuc2Vzc2lvblBhcmFtcy5qb2luKCcgJykgOiAnJykgK1xuICAgICdcXHJcXG4nO1xufTtcblxuLy8gUGFyc2VzIHRoZSBjcnlwdG8ga2V5IHBhcmFtZXRlcnMgaW50b1xuLy8gICBodHRwczovL3Jhd2dpdC5jb20vYWJvYmEvZWRnZXJ0Yy9tYXN0ZXIvbXNvcnRjLXJzNC5odG1sI3J0Y3NydHBrZXlwYXJhbSpcblNEUFV0aWxzLnBhcnNlQ3J5cHRvS2V5UGFyYW1zID0gZnVuY3Rpb24oa2V5UGFyYW1zKSB7XG4gIGlmIChrZXlQYXJhbXMuaW5kZXhPZignaW5saW5lOicpICE9PSAwKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgY29uc3QgcGFydHMgPSBrZXlQYXJhbXMuc3Vic3RyaW5nKDcpLnNwbGl0KCd8Jyk7XG4gIHJldHVybiB7XG4gICAga2V5TWV0aG9kOiAnaW5saW5lJyxcbiAgICBrZXlTYWx0OiBwYXJ0c1swXSxcbiAgICBsaWZlVGltZTogcGFydHNbMV0sXG4gICAgbWtpVmFsdWU6IHBhcnRzWzJdID8gcGFydHNbMl0uc3BsaXQoJzonKVswXSA6IHVuZGVmaW5lZCxcbiAgICBta2lMZW5ndGg6IHBhcnRzWzJdID8gcGFydHNbMl0uc3BsaXQoJzonKVsxXSA6IHVuZGVmaW5lZCxcbiAgfTtcbn07XG5cblNEUFV0aWxzLndyaXRlQ3J5cHRvS2V5UGFyYW1zID0gZnVuY3Rpb24oa2V5UGFyYW1zKSB7XG4gIHJldHVybiBrZXlQYXJhbXMua2V5TWV0aG9kICsgJzonXG4gICAgKyBrZXlQYXJhbXMua2V5U2FsdCArXG4gICAgKGtleVBhcmFtcy5saWZlVGltZSA/ICd8JyArIGtleVBhcmFtcy5saWZlVGltZSA6ICcnKSArXG4gICAgKGtleVBhcmFtcy5ta2lWYWx1ZSAmJiBrZXlQYXJhbXMubWtpTGVuZ3RoXG4gICAgICA/ICd8JyArIGtleVBhcmFtcy5ta2lWYWx1ZSArICc6JyArIGtleVBhcmFtcy5ta2lMZW5ndGhcbiAgICAgIDogJycpO1xufTtcblxuLy8gRXh0cmFjdHMgYWxsIFNERVMgcGFyYW1ldGVycy5cblNEUFV0aWxzLmdldENyeXB0b1BhcmFtZXRlcnMgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24sIHNlc3Npb25wYXJ0KSB7XG4gIGNvbnN0IGxpbmVzID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uICsgc2Vzc2lvbnBhcnQsXG4gICAgJ2E9Y3J5cHRvOicpO1xuICByZXR1cm4gbGluZXMubWFwKFNEUFV0aWxzLnBhcnNlQ3J5cHRvTGluZSk7XG59O1xuXG4vLyBQYXJzZXMgSUNFIGluZm9ybWF0aW9uIGZyb20gU0RQIG1lZGlhIHNlY3Rpb24gb3Igc2Vzc2lvbnBhcnQuXG4vLyBGSVhNRTogZm9yIGNvbnNpc3RlbmN5IHdpdGggb3RoZXIgZnVuY3Rpb25zIHRoaXMgc2hvdWxkIG9ubHlcbi8vICAgZ2V0IHRoZSBpY2UtdWZyYWcgYW5kIGljZS1wd2QgbGluZXMgYXMgaW5wdXQuXG5TRFBVdGlscy5nZXRJY2VQYXJhbWV0ZXJzID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uLCBzZXNzaW9ucGFydCkge1xuICBjb25zdCB1ZnJhZyA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiArIHNlc3Npb25wYXJ0LFxuICAgICdhPWljZS11ZnJhZzonKVswXTtcbiAgY29uc3QgcHdkID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uICsgc2Vzc2lvbnBhcnQsXG4gICAgJ2E9aWNlLXB3ZDonKVswXTtcbiAgaWYgKCEodWZyYWcgJiYgcHdkKSkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIHJldHVybiB7XG4gICAgdXNlcm5hbWVGcmFnbWVudDogdWZyYWcuc3Vic3RyaW5nKDEyKSxcbiAgICBwYXNzd29yZDogcHdkLnN1YnN0cmluZygxMCksXG4gIH07XG59O1xuXG4vLyBTZXJpYWxpemVzIElDRSBwYXJhbWV0ZXJzIHRvIFNEUC5cblNEUFV0aWxzLndyaXRlSWNlUGFyYW1ldGVycyA9IGZ1bmN0aW9uKHBhcmFtcykge1xuICBsZXQgc2RwID0gJ2E9aWNlLXVmcmFnOicgKyBwYXJhbXMudXNlcm5hbWVGcmFnbWVudCArICdcXHJcXG4nICtcbiAgICAgICdhPWljZS1wd2Q6JyArIHBhcmFtcy5wYXNzd29yZCArICdcXHJcXG4nO1xuICBpZiAocGFyYW1zLmljZUxpdGUpIHtcbiAgICBzZHAgKz0gJ2E9aWNlLWxpdGVcXHJcXG4nO1xuICB9XG4gIHJldHVybiBzZHA7XG59O1xuXG4vLyBQYXJzZXMgdGhlIFNEUCBtZWRpYSBzZWN0aW9uIGFuZCByZXR1cm5zIFJUQ1J0cFBhcmFtZXRlcnMuXG5TRFBVdGlscy5wYXJzZVJ0cFBhcmFtZXRlcnMgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgY29uc3QgZGVzY3JpcHRpb24gPSB7XG4gICAgY29kZWNzOiBbXSxcbiAgICBoZWFkZXJFeHRlbnNpb25zOiBbXSxcbiAgICBmZWNNZWNoYW5pc21zOiBbXSxcbiAgICBydGNwOiBbXSxcbiAgfTtcbiAgY29uc3QgbGluZXMgPSBTRFBVdGlscy5zcGxpdExpbmVzKG1lZGlhU2VjdGlvbik7XG4gIGNvbnN0IG1saW5lID0gbGluZXNbMF0uc3BsaXQoJyAnKTtcbiAgZGVzY3JpcHRpb24ucHJvZmlsZSA9IG1saW5lWzJdO1xuICBmb3IgKGxldCBpID0gMzsgaSA8IG1saW5lLmxlbmd0aDsgaSsrKSB7IC8vIGZpbmQgYWxsIGNvZGVjcyBmcm9tIG1saW5lWzMuLl1cbiAgICBjb25zdCBwdCA9IG1saW5lW2ldO1xuICAgIGNvbnN0IHJ0cG1hcGxpbmUgPSBTRFBVdGlscy5tYXRjaFByZWZpeChcbiAgICAgIG1lZGlhU2VjdGlvbiwgJ2E9cnRwbWFwOicgKyBwdCArICcgJylbMF07XG4gICAgaWYgKHJ0cG1hcGxpbmUpIHtcbiAgICAgIGNvbnN0IGNvZGVjID0gU0RQVXRpbHMucGFyc2VSdHBNYXAocnRwbWFwbGluZSk7XG4gICAgICBjb25zdCBmbXRwcyA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KFxuICAgICAgICBtZWRpYVNlY3Rpb24sICdhPWZtdHA6JyArIHB0ICsgJyAnKTtcbiAgICAgIC8vIE9ubHkgdGhlIGZpcnN0IGE9Zm10cDo8cHQ+IGlzIGNvbnNpZGVyZWQuXG4gICAgICBjb2RlYy5wYXJhbWV0ZXJzID0gZm10cHMubGVuZ3RoID8gU0RQVXRpbHMucGFyc2VGbXRwKGZtdHBzWzBdKSA6IHt9O1xuICAgICAgY29kZWMucnRjcEZlZWRiYWNrID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgoXG4gICAgICAgIG1lZGlhU2VjdGlvbiwgJ2E9cnRjcC1mYjonICsgcHQgKyAnICcpXG4gICAgICAgIC5tYXAoU0RQVXRpbHMucGFyc2VSdGNwRmIpO1xuICAgICAgZGVzY3JpcHRpb24uY29kZWNzLnB1c2goY29kZWMpO1xuICAgICAgLy8gcGFyc2UgRkVDIG1lY2hhbmlzbXMgZnJvbSBydHBtYXAgbGluZXMuXG4gICAgICBzd2l0Y2ggKGNvZGVjLm5hbWUudG9VcHBlckNhc2UoKSkge1xuICAgICAgICBjYXNlICdSRUQnOlxuICAgICAgICBjYXNlICdVTFBGRUMnOlxuICAgICAgICAgIGRlc2NyaXB0aW9uLmZlY01lY2hhbmlzbXMucHVzaChjb2RlYy5uYW1lLnRvVXBwZXJDYXNlKCkpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OiAvLyBvbmx5IFJFRCBhbmQgVUxQRkVDIGFyZSByZWNvZ25pemVkIGFzIEZFQyBtZWNoYW5pc21zLlxuICAgICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPWV4dG1hcDonKS5mb3JFYWNoKGxpbmUgPT4ge1xuICAgIGRlc2NyaXB0aW9uLmhlYWRlckV4dGVuc2lvbnMucHVzaChTRFBVdGlscy5wYXJzZUV4dG1hcChsaW5lKSk7XG4gIH0pO1xuICBjb25zdCB3aWxkY2FyZFJ0Y3BGYiA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9cnRjcC1mYjoqICcpXG4gICAgLm1hcChTRFBVdGlscy5wYXJzZVJ0Y3BGYik7XG4gIGRlc2NyaXB0aW9uLmNvZGVjcy5mb3JFYWNoKGNvZGVjID0+IHtcbiAgICB3aWxkY2FyZFJ0Y3BGYi5mb3JFYWNoKGZiPT4ge1xuICAgICAgY29uc3QgZHVwbGljYXRlID0gY29kZWMucnRjcEZlZWRiYWNrLmZpbmQoZXhpc3RpbmdGZWVkYmFjayA9PiB7XG4gICAgICAgIHJldHVybiBleGlzdGluZ0ZlZWRiYWNrLnR5cGUgPT09IGZiLnR5cGUgJiZcbiAgICAgICAgICBleGlzdGluZ0ZlZWRiYWNrLnBhcmFtZXRlciA9PT0gZmIucGFyYW1ldGVyO1xuICAgICAgfSk7XG4gICAgICBpZiAoIWR1cGxpY2F0ZSkge1xuICAgICAgICBjb2RlYy5ydGNwRmVlZGJhY2sucHVzaChmYik7XG4gICAgICB9XG4gICAgfSk7XG4gIH0pO1xuICAvLyBGSVhNRTogcGFyc2UgcnRjcC5cbiAgcmV0dXJuIGRlc2NyaXB0aW9uO1xufTtcblxuLy8gR2VuZXJhdGVzIHBhcnRzIG9mIHRoZSBTRFAgbWVkaWEgc2VjdGlvbiBkZXNjcmliaW5nIHRoZSBjYXBhYmlsaXRpZXMgL1xuLy8gcGFyYW1ldGVycy5cblNEUFV0aWxzLndyaXRlUnRwRGVzY3JpcHRpb24gPSBmdW5jdGlvbihraW5kLCBjYXBzKSB7XG4gIGxldCBzZHAgPSAnJztcblxuICAvLyBCdWlsZCB0aGUgbWxpbmUuXG4gIHNkcCArPSAnbT0nICsga2luZCArICcgJztcbiAgc2RwICs9IGNhcHMuY29kZWNzLmxlbmd0aCA+IDAgPyAnOScgOiAnMCc7IC8vIHJlamVjdCBpZiBubyBjb2RlY3MuXG4gIHNkcCArPSAnICcgKyAoY2Fwcy5wcm9maWxlIHx8ICdVRFAvVExTL1JUUC9TQVZQRicpICsgJyAnO1xuICBzZHAgKz0gY2Fwcy5jb2RlY3MubWFwKGNvZGVjID0+IHtcbiAgICBpZiAoY29kZWMucHJlZmVycmVkUGF5bG9hZFR5cGUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIGNvZGVjLnByZWZlcnJlZFBheWxvYWRUeXBlO1xuICAgIH1cbiAgICByZXR1cm4gY29kZWMucGF5bG9hZFR5cGU7XG4gIH0pLmpvaW4oJyAnKSArICdcXHJcXG4nO1xuXG4gIHNkcCArPSAnYz1JTiBJUDQgMC4wLjAuMFxcclxcbic7XG4gIHNkcCArPSAnYT1ydGNwOjkgSU4gSVA0IDAuMC4wLjBcXHJcXG4nO1xuXG4gIC8vIEFkZCBhPXJ0cG1hcCBsaW5lcyBmb3IgZWFjaCBjb2RlYy4gQWxzbyBmbXRwIGFuZCBydGNwLWZiLlxuICBjYXBzLmNvZGVjcy5mb3JFYWNoKGNvZGVjID0+IHtcbiAgICBzZHAgKz0gU0RQVXRpbHMud3JpdGVSdHBNYXAoY29kZWMpO1xuICAgIHNkcCArPSBTRFBVdGlscy53cml0ZUZtdHAoY29kZWMpO1xuICAgIHNkcCArPSBTRFBVdGlscy53cml0ZVJ0Y3BGYihjb2RlYyk7XG4gIH0pO1xuICBsZXQgbWF4cHRpbWUgPSAwO1xuICBjYXBzLmNvZGVjcy5mb3JFYWNoKGNvZGVjID0+IHtcbiAgICBpZiAoY29kZWMubWF4cHRpbWUgPiBtYXhwdGltZSkge1xuICAgICAgbWF4cHRpbWUgPSBjb2RlYy5tYXhwdGltZTtcbiAgICB9XG4gIH0pO1xuICBpZiAobWF4cHRpbWUgPiAwKSB7XG4gICAgc2RwICs9ICdhPW1heHB0aW1lOicgKyBtYXhwdGltZSArICdcXHJcXG4nO1xuICB9XG5cbiAgaWYgKGNhcHMuaGVhZGVyRXh0ZW5zaW9ucykge1xuICAgIGNhcHMuaGVhZGVyRXh0ZW5zaW9ucy5mb3JFYWNoKGV4dGVuc2lvbiA9PiB7XG4gICAgICBzZHAgKz0gU0RQVXRpbHMud3JpdGVFeHRtYXAoZXh0ZW5zaW9uKTtcbiAgICB9KTtcbiAgfVxuICAvLyBGSVhNRTogd3JpdGUgZmVjTWVjaGFuaXNtcy5cbiAgcmV0dXJuIHNkcDtcbn07XG5cbi8vIFBhcnNlcyB0aGUgU0RQIG1lZGlhIHNlY3Rpb24gYW5kIHJldHVybnMgYW4gYXJyYXkgb2Zcbi8vIFJUQ1J0cEVuY29kaW5nUGFyYW1ldGVycy5cblNEUFV0aWxzLnBhcnNlUnRwRW5jb2RpbmdQYXJhbWV0ZXJzID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIGNvbnN0IGVuY29kaW5nUGFyYW1ldGVycyA9IFtdO1xuICBjb25zdCBkZXNjcmlwdGlvbiA9IFNEUFV0aWxzLnBhcnNlUnRwUGFyYW1ldGVycyhtZWRpYVNlY3Rpb24pO1xuICBjb25zdCBoYXNSZWQgPSBkZXNjcmlwdGlvbi5mZWNNZWNoYW5pc21zLmluZGV4T2YoJ1JFRCcpICE9PSAtMTtcbiAgY29uc3QgaGFzVWxwZmVjID0gZGVzY3JpcHRpb24uZmVjTWVjaGFuaXNtcy5pbmRleE9mKCdVTFBGRUMnKSAhPT0gLTE7XG5cbiAgLy8gZmlsdGVyIGE9c3NyYzouLi4gY25hbWU6LCBpZ25vcmUgUGxhbkItbXNpZFxuICBjb25zdCBzc3JjcyA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9c3NyYzonKVxuICAgIC5tYXAobGluZSA9PiBTRFBVdGlscy5wYXJzZVNzcmNNZWRpYShsaW5lKSlcbiAgICAuZmlsdGVyKHBhcnRzID0+IHBhcnRzLmF0dHJpYnV0ZSA9PT0gJ2NuYW1lJyk7XG4gIGNvbnN0IHByaW1hcnlTc3JjID0gc3NyY3MubGVuZ3RoID4gMCAmJiBzc3Jjc1swXS5zc3JjO1xuICBsZXQgc2Vjb25kYXJ5U3NyYztcblxuICBjb25zdCBmbG93cyA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9c3NyYy1ncm91cDpGSUQnKVxuICAgIC5tYXAobGluZSA9PiB7XG4gICAgICBjb25zdCBwYXJ0cyA9IGxpbmUuc3Vic3RyaW5nKDE3KS5zcGxpdCgnICcpO1xuICAgICAgcmV0dXJuIHBhcnRzLm1hcChwYXJ0ID0+IHBhcnNlSW50KHBhcnQsIDEwKSk7XG4gICAgfSk7XG4gIGlmIChmbG93cy5sZW5ndGggPiAwICYmIGZsb3dzWzBdLmxlbmd0aCA+IDEgJiYgZmxvd3NbMF1bMF0gPT09IHByaW1hcnlTc3JjKSB7XG4gICAgc2Vjb25kYXJ5U3NyYyA9IGZsb3dzWzBdWzFdO1xuICB9XG5cbiAgZGVzY3JpcHRpb24uY29kZWNzLmZvckVhY2goY29kZWMgPT4ge1xuICAgIGlmIChjb2RlYy5uYW1lLnRvVXBwZXJDYXNlKCkgPT09ICdSVFgnICYmIGNvZGVjLnBhcmFtZXRlcnMuYXB0KSB7XG4gICAgICBsZXQgZW5jUGFyYW0gPSB7XG4gICAgICAgIHNzcmM6IHByaW1hcnlTc3JjLFxuICAgICAgICBjb2RlY1BheWxvYWRUeXBlOiBwYXJzZUludChjb2RlYy5wYXJhbWV0ZXJzLmFwdCwgMTApLFxuICAgICAgfTtcbiAgICAgIGlmIChwcmltYXJ5U3NyYyAmJiBzZWNvbmRhcnlTc3JjKSB7XG4gICAgICAgIGVuY1BhcmFtLnJ0eCA9IHtzc3JjOiBzZWNvbmRhcnlTc3JjfTtcbiAgICAgIH1cbiAgICAgIGVuY29kaW5nUGFyYW1ldGVycy5wdXNoKGVuY1BhcmFtKTtcbiAgICAgIGlmIChoYXNSZWQpIHtcbiAgICAgICAgZW5jUGFyYW0gPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KGVuY1BhcmFtKSk7XG4gICAgICAgIGVuY1BhcmFtLmZlYyA9IHtcbiAgICAgICAgICBzc3JjOiBwcmltYXJ5U3NyYyxcbiAgICAgICAgICBtZWNoYW5pc206IGhhc1VscGZlYyA/ICdyZWQrdWxwZmVjJyA6ICdyZWQnLFxuICAgICAgICB9O1xuICAgICAgICBlbmNvZGluZ1BhcmFtZXRlcnMucHVzaChlbmNQYXJhbSk7XG4gICAgICB9XG4gICAgfVxuICB9KTtcbiAgaWYgKGVuY29kaW5nUGFyYW1ldGVycy5sZW5ndGggPT09IDAgJiYgcHJpbWFyeVNzcmMpIHtcbiAgICBlbmNvZGluZ1BhcmFtZXRlcnMucHVzaCh7XG4gICAgICBzc3JjOiBwcmltYXJ5U3NyYyxcbiAgICB9KTtcbiAgfVxuXG4gIC8vIHdlIHN1cHBvcnQgYm90aCBiPUFTIGFuZCBiPVRJQVMgYnV0IGludGVycHJldCBBUyBhcyBUSUFTLlxuICBsZXQgYmFuZHdpZHRoID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYj0nKTtcbiAgaWYgKGJhbmR3aWR0aC5sZW5ndGgpIHtcbiAgICBpZiAoYmFuZHdpZHRoWzBdLmluZGV4T2YoJ2I9VElBUzonKSA9PT0gMCkge1xuICAgICAgYmFuZHdpZHRoID0gcGFyc2VJbnQoYmFuZHdpZHRoWzBdLnN1YnN0cmluZyg3KSwgMTApO1xuICAgIH0gZWxzZSBpZiAoYmFuZHdpZHRoWzBdLmluZGV4T2YoJ2I9QVM6JykgPT09IDApIHtcbiAgICAgIC8vIHVzZSBmb3JtdWxhIGZyb20gSlNFUCB0byBjb252ZXJ0IGI9QVMgdG8gVElBUyB2YWx1ZS5cbiAgICAgIGJhbmR3aWR0aCA9IHBhcnNlSW50KGJhbmR3aWR0aFswXS5zdWJzdHJpbmcoNSksIDEwKSAqIDEwMDAgKiAwLjk1XG4gICAgICAgICAgLSAoNTAgKiA0MCAqIDgpO1xuICAgIH0gZWxzZSB7XG4gICAgICBiYW5kd2lkdGggPSB1bmRlZmluZWQ7XG4gICAgfVxuICAgIGVuY29kaW5nUGFyYW1ldGVycy5mb3JFYWNoKHBhcmFtcyA9PiB7XG4gICAgICBwYXJhbXMubWF4Qml0cmF0ZSA9IGJhbmR3aWR0aDtcbiAgICB9KTtcbiAgfVxuICByZXR1cm4gZW5jb2RpbmdQYXJhbWV0ZXJzO1xufTtcblxuLy8gcGFyc2VzIGh0dHA6Ly9kcmFmdC5vcnRjLm9yZy8jcnRjcnRjcHBhcmFtZXRlcnMqXG5TRFBVdGlscy5wYXJzZVJ0Y3BQYXJhbWV0ZXJzID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIGNvbnN0IHJ0Y3BQYXJhbWV0ZXJzID0ge307XG5cbiAgLy8gR2V0cyB0aGUgZmlyc3QgU1NSQy4gTm90ZSB0aGF0IHdpdGggUlRYIHRoZXJlIG1pZ2h0IGJlIG11bHRpcGxlXG4gIC8vIFNTUkNzLlxuICBjb25zdCByZW1vdGVTc3JjID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1zc3JjOicpXG4gICAgLm1hcChsaW5lID0+IFNEUFV0aWxzLnBhcnNlU3NyY01lZGlhKGxpbmUpKVxuICAgIC5maWx0ZXIob2JqID0+IG9iai5hdHRyaWJ1dGUgPT09ICdjbmFtZScpWzBdO1xuICBpZiAocmVtb3RlU3NyYykge1xuICAgIHJ0Y3BQYXJhbWV0ZXJzLmNuYW1lID0gcmVtb3RlU3NyYy52YWx1ZTtcbiAgICBydGNwUGFyYW1ldGVycy5zc3JjID0gcmVtb3RlU3NyYy5zc3JjO1xuICB9XG5cbiAgLy8gRWRnZSB1c2VzIHRoZSBjb21wb3VuZCBhdHRyaWJ1dGUgaW5zdGVhZCBvZiByZWR1Y2VkU2l6ZVxuICAvLyBjb21wb3VuZCBpcyAhcmVkdWNlZFNpemVcbiAgY29uc3QgcnNpemUgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPXJ0Y3AtcnNpemUnKTtcbiAgcnRjcFBhcmFtZXRlcnMucmVkdWNlZFNpemUgPSByc2l6ZS5sZW5ndGggPiAwO1xuICBydGNwUGFyYW1ldGVycy5jb21wb3VuZCA9IHJzaXplLmxlbmd0aCA9PT0gMDtcblxuICAvLyBwYXJzZXMgdGhlIHJ0Y3AtbXV4IGF0dHLRlmJ1dGUuXG4gIC8vIE5vdGUgdGhhdCBFZGdlIGRvZXMgbm90IHN1cHBvcnQgdW5tdXhlZCBSVENQLlxuICBjb25zdCBtdXggPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPXJ0Y3AtbXV4Jyk7XG4gIHJ0Y3BQYXJhbWV0ZXJzLm11eCA9IG11eC5sZW5ndGggPiAwO1xuXG4gIHJldHVybiBydGNwUGFyYW1ldGVycztcbn07XG5cblNEUFV0aWxzLndyaXRlUnRjcFBhcmFtZXRlcnMgPSBmdW5jdGlvbihydGNwUGFyYW1ldGVycykge1xuICBsZXQgc2RwID0gJyc7XG4gIGlmIChydGNwUGFyYW1ldGVycy5yZWR1Y2VkU2l6ZSkge1xuICAgIHNkcCArPSAnYT1ydGNwLXJzaXplXFxyXFxuJztcbiAgfVxuICBpZiAocnRjcFBhcmFtZXRlcnMubXV4KSB7XG4gICAgc2RwICs9ICdhPXJ0Y3AtbXV4XFxyXFxuJztcbiAgfVxuICBpZiAocnRjcFBhcmFtZXRlcnMuc3NyYyAhPT0gdW5kZWZpbmVkICYmIHJ0Y3BQYXJhbWV0ZXJzLmNuYW1lKSB7XG4gICAgc2RwICs9ICdhPXNzcmM6JyArIHJ0Y3BQYXJhbWV0ZXJzLnNzcmMgK1xuICAgICAgJyBjbmFtZTonICsgcnRjcFBhcmFtZXRlcnMuY25hbWUgKyAnXFxyXFxuJztcbiAgfVxuICByZXR1cm4gc2RwO1xufTtcblxuXG4vLyBwYXJzZXMgZWl0aGVyIGE9bXNpZDogb3IgYT1zc3JjOi4uLiBtc2lkIGxpbmVzIGFuZCByZXR1cm5zXG4vLyB0aGUgaWQgb2YgdGhlIE1lZGlhU3RyZWFtIGFuZCBNZWRpYVN0cmVhbVRyYWNrLlxuU0RQVXRpbHMucGFyc2VNc2lkID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIGxldCBwYXJ0cztcbiAgY29uc3Qgc3BlYyA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9bXNpZDonKTtcbiAgaWYgKHNwZWMubGVuZ3RoID09PSAxKSB7XG4gICAgcGFydHMgPSBzcGVjWzBdLnN1YnN0cmluZyg3KS5zcGxpdCgnICcpO1xuICAgIHJldHVybiB7c3RyZWFtOiBwYXJ0c1swXSwgdHJhY2s6IHBhcnRzWzFdfTtcbiAgfVxuICBjb25zdCBwbGFuQiA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9c3NyYzonKVxuICAgIC5tYXAobGluZSA9PiBTRFBVdGlscy5wYXJzZVNzcmNNZWRpYShsaW5lKSlcbiAgICAuZmlsdGVyKG1zaWRQYXJ0cyA9PiBtc2lkUGFydHMuYXR0cmlidXRlID09PSAnbXNpZCcpO1xuICBpZiAocGxhbkIubGVuZ3RoID4gMCkge1xuICAgIHBhcnRzID0gcGxhbkJbMF0udmFsdWUuc3BsaXQoJyAnKTtcbiAgICByZXR1cm4ge3N0cmVhbTogcGFydHNbMF0sIHRyYWNrOiBwYXJ0c1sxXX07XG4gIH1cbn07XG5cbi8vIFNDVFBcbi8vIHBhcnNlcyBkcmFmdC1pZXRmLW1tdXNpYy1zY3RwLXNkcC0yNiBmaXJzdCBhbmQgZmFsbHMgYmFja1xuLy8gdG8gZHJhZnQtaWV0Zi1tbXVzaWMtc2N0cC1zZHAtMDVcblNEUFV0aWxzLnBhcnNlU2N0cERlc2NyaXB0aW9uID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIGNvbnN0IG1saW5lID0gU0RQVXRpbHMucGFyc2VNTGluZShtZWRpYVNlY3Rpb24pO1xuICBjb25zdCBtYXhTaXplTGluZSA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9bWF4LW1lc3NhZ2Utc2l6ZTonKTtcbiAgbGV0IG1heE1lc3NhZ2VTaXplO1xuICBpZiAobWF4U2l6ZUxpbmUubGVuZ3RoID4gMCkge1xuICAgIG1heE1lc3NhZ2VTaXplID0gcGFyc2VJbnQobWF4U2l6ZUxpbmVbMF0uc3Vic3RyaW5nKDE5KSwgMTApO1xuICB9XG4gIGlmIChpc05hTihtYXhNZXNzYWdlU2l6ZSkpIHtcbiAgICBtYXhNZXNzYWdlU2l6ZSA9IDY1NTM2O1xuICB9XG4gIGNvbnN0IHNjdHBQb3J0ID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1zY3RwLXBvcnQ6Jyk7XG4gIGlmIChzY3RwUG9ydC5sZW5ndGggPiAwKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHBvcnQ6IHBhcnNlSW50KHNjdHBQb3J0WzBdLnN1YnN0cmluZygxMiksIDEwKSxcbiAgICAgIHByb3RvY29sOiBtbGluZS5mbXQsXG4gICAgICBtYXhNZXNzYWdlU2l6ZSxcbiAgICB9O1xuICB9XG4gIGNvbnN0IHNjdHBNYXBMaW5lcyA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9c2N0cG1hcDonKTtcbiAgaWYgKHNjdHBNYXBMaW5lcy5sZW5ndGggPiAwKSB7XG4gICAgY29uc3QgcGFydHMgPSBzY3RwTWFwTGluZXNbMF1cbiAgICAgIC5zdWJzdHJpbmcoMTApXG4gICAgICAuc3BsaXQoJyAnKTtcbiAgICByZXR1cm4ge1xuICAgICAgcG9ydDogcGFyc2VJbnQocGFydHNbMF0sIDEwKSxcbiAgICAgIHByb3RvY29sOiBwYXJ0c1sxXSxcbiAgICAgIG1heE1lc3NhZ2VTaXplLFxuICAgIH07XG4gIH1cbn07XG5cbi8vIFNDVFBcbi8vIG91dHB1dHMgdGhlIGRyYWZ0LWlldGYtbW11c2ljLXNjdHAtc2RwLTI2IHZlcnNpb24gdGhhdCBhbGwgYnJvd3NlcnNcbi8vIHN1cHBvcnQgYnkgbm93IHJlY2VpdmluZyBpbiB0aGlzIGZvcm1hdCwgdW5sZXNzIHdlIG9yaWdpbmFsbHkgcGFyc2VkXG4vLyBhcyB0aGUgZHJhZnQtaWV0Zi1tbXVzaWMtc2N0cC1zZHAtMDUgZm9ybWF0IChpbmRpY2F0ZWQgYnkgdGhlIG0tbGluZVxuLy8gcHJvdG9jb2wgb2YgRFRMUy9TQ1RQIC0tIHdpdGhvdXQgVURQLyBvciBUQ1AvKVxuU0RQVXRpbHMud3JpdGVTY3RwRGVzY3JpcHRpb24gPSBmdW5jdGlvbihtZWRpYSwgc2N0cCkge1xuICBsZXQgb3V0cHV0ID0gW107XG4gIGlmIChtZWRpYS5wcm90b2NvbCAhPT0gJ0RUTFMvU0NUUCcpIHtcbiAgICBvdXRwdXQgPSBbXG4gICAgICAnbT0nICsgbWVkaWEua2luZCArICcgOSAnICsgbWVkaWEucHJvdG9jb2wgKyAnICcgKyBzY3RwLnByb3RvY29sICsgJ1xcclxcbicsXG4gICAgICAnYz1JTiBJUDQgMC4wLjAuMFxcclxcbicsXG4gICAgICAnYT1zY3RwLXBvcnQ6JyArIHNjdHAucG9ydCArICdcXHJcXG4nLFxuICAgIF07XG4gIH0gZWxzZSB7XG4gICAgb3V0cHV0ID0gW1xuICAgICAgJ209JyArIG1lZGlhLmtpbmQgKyAnIDkgJyArIG1lZGlhLnByb3RvY29sICsgJyAnICsgc2N0cC5wb3J0ICsgJ1xcclxcbicsXG4gICAgICAnYz1JTiBJUDQgMC4wLjAuMFxcclxcbicsXG4gICAgICAnYT1zY3RwbWFwOicgKyBzY3RwLnBvcnQgKyAnICcgKyBzY3RwLnByb3RvY29sICsgJyA2NTUzNVxcclxcbicsXG4gICAgXTtcbiAgfVxuICBpZiAoc2N0cC5tYXhNZXNzYWdlU2l6ZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgb3V0cHV0LnB1c2goJ2E9bWF4LW1lc3NhZ2Utc2l6ZTonICsgc2N0cC5tYXhNZXNzYWdlU2l6ZSArICdcXHJcXG4nKTtcbiAgfVxuICByZXR1cm4gb3V0cHV0LmpvaW4oJycpO1xufTtcblxuLy8gR2VuZXJhdGUgYSBzZXNzaW9uIElEIGZvciBTRFAuXG4vLyBodHRwczovL3Rvb2xzLmlldGYub3JnL2h0bWwvZHJhZnQtaWV0Zi1ydGN3ZWItanNlcC0yMCNzZWN0aW9uLTUuMi4xXG4vLyByZWNvbW1lbmRzIHVzaW5nIGEgY3J5cHRvZ3JhcGhpY2FsbHkgcmFuZG9tICt2ZSA2NC1iaXQgdmFsdWVcbi8vIGJ1dCByaWdodCBub3cgdGhpcyBzaG91bGQgYmUgYWNjZXB0YWJsZSBhbmQgd2l0aGluIHRoZSByaWdodCByYW5nZVxuU0RQVXRpbHMuZ2VuZXJhdGVTZXNzaW9uSWQgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIE1hdGgucmFuZG9tKCkudG9TdHJpbmcoKS5zdWJzdHIoMiwgMjIpO1xufTtcblxuLy8gV3JpdGUgYm9pbGVyIHBsYXRlIGZvciBzdGFydCBvZiBTRFBcbi8vIHNlc3NJZCBhcmd1bWVudCBpcyBvcHRpb25hbCAtIGlmIG5vdCBzdXBwbGllZCBpdCB3aWxsXG4vLyBiZSBnZW5lcmF0ZWQgcmFuZG9tbHlcbi8vIHNlc3NWZXJzaW9uIGlzIG9wdGlvbmFsIGFuZCBkZWZhdWx0cyB0byAyXG4vLyBzZXNzVXNlciBpcyBvcHRpb25hbCBhbmQgZGVmYXVsdHMgdG8gJ3RoaXNpc2FkYXB0ZXJvcnRjJ1xuU0RQVXRpbHMud3JpdGVTZXNzaW9uQm9pbGVycGxhdGUgPSBmdW5jdGlvbihzZXNzSWQsIHNlc3NWZXIsIHNlc3NVc2VyKSB7XG4gIGxldCBzZXNzaW9uSWQ7XG4gIGNvbnN0IHZlcnNpb24gPSBzZXNzVmVyICE9PSB1bmRlZmluZWQgPyBzZXNzVmVyIDogMjtcbiAgaWYgKHNlc3NJZCkge1xuICAgIHNlc3Npb25JZCA9IHNlc3NJZDtcbiAgfSBlbHNlIHtcbiAgICBzZXNzaW9uSWQgPSBTRFBVdGlscy5nZW5lcmF0ZVNlc3Npb25JZCgpO1xuICB9XG4gIGNvbnN0IHVzZXIgPSBzZXNzVXNlciB8fCAndGhpc2lzYWRhcHRlcm9ydGMnO1xuICAvLyBGSVhNRTogc2Vzcy1pZCBzaG91bGQgYmUgYW4gTlRQIHRpbWVzdGFtcC5cbiAgcmV0dXJuICd2PTBcXHJcXG4nICtcbiAgICAgICdvPScgKyB1c2VyICsgJyAnICsgc2Vzc2lvbklkICsgJyAnICsgdmVyc2lvbiArXG4gICAgICAgICcgSU4gSVA0IDEyNy4wLjAuMVxcclxcbicgK1xuICAgICAgJ3M9LVxcclxcbicgK1xuICAgICAgJ3Q9MCAwXFxyXFxuJztcbn07XG5cbi8vIEdldHMgdGhlIGRpcmVjdGlvbiBmcm9tIHRoZSBtZWRpYVNlY3Rpb24gb3IgdGhlIHNlc3Npb25wYXJ0LlxuU0RQVXRpbHMuZ2V0RGlyZWN0aW9uID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uLCBzZXNzaW9ucGFydCkge1xuICAvLyBMb29rIGZvciBzZW5kcmVjdiwgc2VuZG9ubHksIHJlY3Zvbmx5LCBpbmFjdGl2ZSwgZGVmYXVsdCB0byBzZW5kcmVjdi5cbiAgY29uc3QgbGluZXMgPSBTRFBVdGlscy5zcGxpdExpbmVzKG1lZGlhU2VjdGlvbik7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgbGluZXMubGVuZ3RoOyBpKyspIHtcbiAgICBzd2l0Y2ggKGxpbmVzW2ldKSB7XG4gICAgICBjYXNlICdhPXNlbmRyZWN2JzpcbiAgICAgIGNhc2UgJ2E9c2VuZG9ubHknOlxuICAgICAgY2FzZSAnYT1yZWN2b25seSc6XG4gICAgICBjYXNlICdhPWluYWN0aXZlJzpcbiAgICAgICAgcmV0dXJuIGxpbmVzW2ldLnN1YnN0cmluZygyKTtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIC8vIEZJWE1FOiBXaGF0IHNob3VsZCBoYXBwZW4gaGVyZT9cbiAgICB9XG4gIH1cbiAgaWYgKHNlc3Npb25wYXJ0KSB7XG4gICAgcmV0dXJuIFNEUFV0aWxzLmdldERpcmVjdGlvbihzZXNzaW9ucGFydCk7XG4gIH1cbiAgcmV0dXJuICdzZW5kcmVjdic7XG59O1xuXG5TRFBVdGlscy5nZXRLaW5kID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIGNvbnN0IGxpbmVzID0gU0RQVXRpbHMuc3BsaXRMaW5lcyhtZWRpYVNlY3Rpb24pO1xuICBjb25zdCBtbGluZSA9IGxpbmVzWzBdLnNwbGl0KCcgJyk7XG4gIHJldHVybiBtbGluZVswXS5zdWJzdHJpbmcoMik7XG59O1xuXG5TRFBVdGlscy5pc1JlamVjdGVkID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIHJldHVybiBtZWRpYVNlY3Rpb24uc3BsaXQoJyAnLCAyKVsxXSA9PT0gJzAnO1xufTtcblxuU0RQVXRpbHMucGFyc2VNTGluZSA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbikge1xuICBjb25zdCBsaW5lcyA9IFNEUFV0aWxzLnNwbGl0TGluZXMobWVkaWFTZWN0aW9uKTtcbiAgY29uc3QgcGFydHMgPSBsaW5lc1swXS5zdWJzdHJpbmcoMikuc3BsaXQoJyAnKTtcbiAgcmV0dXJuIHtcbiAgICBraW5kOiBwYXJ0c1swXSxcbiAgICBwb3J0OiBwYXJzZUludChwYXJ0c1sxXSwgMTApLFxuICAgIHByb3RvY29sOiBwYXJ0c1syXSxcbiAgICBmbXQ6IHBhcnRzLnNsaWNlKDMpLmpvaW4oJyAnKSxcbiAgfTtcbn07XG5cblNEUFV0aWxzLnBhcnNlT0xpbmUgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgY29uc3QgbGluZSA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ289JylbMF07XG4gIGNvbnN0IHBhcnRzID0gbGluZS5zdWJzdHJpbmcoMikuc3BsaXQoJyAnKTtcbiAgcmV0dXJuIHtcbiAgICB1c2VybmFtZTogcGFydHNbMF0sXG4gICAgc2Vzc2lvbklkOiBwYXJ0c1sxXSxcbiAgICBzZXNzaW9uVmVyc2lvbjogcGFyc2VJbnQocGFydHNbMl0sIDEwKSxcbiAgICBuZXRUeXBlOiBwYXJ0c1szXSxcbiAgICBhZGRyZXNzVHlwZTogcGFydHNbNF0sXG4gICAgYWRkcmVzczogcGFydHNbNV0sXG4gIH07XG59O1xuXG4vLyBhIHZlcnkgbmFpdmUgaW50ZXJwcmV0YXRpb24gb2YgYSB2YWxpZCBTRFAuXG5TRFBVdGlscy5pc1ZhbGlkU0RQID0gZnVuY3Rpb24oYmxvYikge1xuICBpZiAodHlwZW9mIGJsb2IgIT09ICdzdHJpbmcnIHx8IGJsb2IubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGNvbnN0IGxpbmVzID0gU0RQVXRpbHMuc3BsaXRMaW5lcyhibG9iKTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBsaW5lcy5sZW5ndGg7IGkrKykge1xuICAgIGlmIChsaW5lc1tpXS5sZW5ndGggPCAyIHx8IGxpbmVzW2ldLmNoYXJBdCgxKSAhPT0gJz0nKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIC8vIFRPRE86IGNoZWNrIHRoZSBtb2RpZmllciBhIGJpdCBtb3JlLlxuICB9XG4gIHJldHVybiB0cnVlO1xufTtcblxuLy8gRXhwb3NlIHB1YmxpYyBtZXRob2RzLlxuaWYgKHR5cGVvZiBtb2R1bGUgPT09ICdvYmplY3QnKSB7XG4gIG1vZHVsZS5leHBvcnRzID0gU0RQVXRpbHM7XG59XG4iLCIvLyBUaGUgbW9kdWxlIGNhY2hlXG52YXIgX193ZWJwYWNrX21vZHVsZV9jYWNoZV9fID0ge307XG5cbi8vIFRoZSByZXF1aXJlIGZ1bmN0aW9uXG5mdW5jdGlvbiBfX3dlYnBhY2tfcmVxdWlyZV9fKG1vZHVsZUlkKSB7XG5cdC8vIENoZWNrIGlmIG1vZHVsZSBpcyBpbiBjYWNoZVxuXHR2YXIgY2FjaGVkTW9kdWxlID0gX193ZWJwYWNrX21vZHVsZV9jYWNoZV9fW21vZHVsZUlkXTtcblx0aWYgKGNhY2hlZE1vZHVsZSAhPT0gdW5kZWZpbmVkKSB7XG5cdFx0cmV0dXJuIGNhY2hlZE1vZHVsZS5leHBvcnRzO1xuXHR9XG5cdC8vIENyZWF0ZSBhIG5ldyBtb2R1bGUgKGFuZCBwdXQgaXQgaW50byB0aGUgY2FjaGUpXG5cdHZhciBtb2R1bGUgPSBfX3dlYnBhY2tfbW9kdWxlX2NhY2hlX19bbW9kdWxlSWRdID0ge1xuXHRcdC8vIG5vIG1vZHVsZS5pZCBuZWVkZWRcblx0XHQvLyBubyBtb2R1bGUubG9hZGVkIG5lZWRlZFxuXHRcdGV4cG9ydHM6IHt9XG5cdH07XG5cblx0Ly8gRXhlY3V0ZSB0aGUgbW9kdWxlIGZ1bmN0aW9uXG5cdF9fd2VicGFja19tb2R1bGVzX19bbW9kdWxlSWRdKG1vZHVsZSwgbW9kdWxlLmV4cG9ydHMsIF9fd2VicGFja19yZXF1aXJlX18pO1xuXG5cdC8vIFJldHVybiB0aGUgZXhwb3J0cyBvZiB0aGUgbW9kdWxlXG5cdHJldHVybiBtb2R1bGUuZXhwb3J0cztcbn1cblxuIiwiIiwiLy8gc3RhcnR1cFxuLy8gTG9hZCBlbnRyeSBtb2R1bGUgYW5kIHJldHVybiBleHBvcnRzXG4vLyBUaGlzIGVudHJ5IG1vZHVsZSBpcyByZWZlcmVuY2VkIGJ5IG90aGVyIG1vZHVsZXMgc28gaXQgY2FuJ3QgYmUgaW5saW5lZFxudmFyIF9fd2VicGFja19leHBvcnRzX18gPSBfX3dlYnBhY2tfcmVxdWlyZV9fKFwiLi9zcmMvaW5kZXguanNcIik7XG4iLCIiXSwibmFtZXMiOlsiX3JlZ2VuZXJhdG9yUnVudGltZSIsImUiLCJ0IiwiciIsIk9iamVjdCIsInByb3RvdHlwZSIsIm4iLCJoYXNPd25Qcm9wZXJ0eSIsIm8iLCJkZWZpbmVQcm9wZXJ0eSIsInZhbHVlIiwiaSIsIlN5bWJvbCIsImEiLCJpdGVyYXRvciIsImMiLCJhc3luY0l0ZXJhdG9yIiwidSIsInRvU3RyaW5nVGFnIiwiZGVmaW5lIiwiZW51bWVyYWJsZSIsImNvbmZpZ3VyYWJsZSIsIndyaXRhYmxlIiwid3JhcCIsIkdlbmVyYXRvciIsImNyZWF0ZSIsIkNvbnRleHQiLCJtYWtlSW52b2tlTWV0aG9kIiwidHJ5Q2F0Y2giLCJ0eXBlIiwiYXJnIiwiY2FsbCIsImgiLCJsIiwiZiIsInMiLCJ5IiwiR2VuZXJhdG9yRnVuY3Rpb24iLCJHZW5lcmF0b3JGdW5jdGlvblByb3RvdHlwZSIsInAiLCJkIiwiZ2V0UHJvdG90eXBlT2YiLCJ2IiwidmFsdWVzIiwiZyIsImRlZmluZUl0ZXJhdG9yTWV0aG9kcyIsImZvckVhY2giLCJfaW52b2tlIiwiQXN5bmNJdGVyYXRvciIsImludm9rZSIsIl90eXBlb2YiLCJyZXNvbHZlIiwiX19hd2FpdCIsInRoZW4iLCJjYWxsSW52b2tlV2l0aE1ldGhvZEFuZEFyZyIsIkVycm9yIiwiZG9uZSIsIm1ldGhvZCIsImRlbGVnYXRlIiwibWF5YmVJbnZva2VEZWxlZ2F0ZSIsInNlbnQiLCJfc2VudCIsImRpc3BhdGNoRXhjZXB0aW9uIiwiYWJydXB0IiwiVHlwZUVycm9yIiwicmVzdWx0TmFtZSIsIm5leHQiLCJuZXh0TG9jIiwicHVzaFRyeUVudHJ5IiwidHJ5TG9jIiwiY2F0Y2hMb2MiLCJmaW5hbGx5TG9jIiwiYWZ0ZXJMb2MiLCJ0cnlFbnRyaWVzIiwicHVzaCIsInJlc2V0VHJ5RW50cnkiLCJjb21wbGV0aW9uIiwicmVzZXQiLCJpc05hTiIsImxlbmd0aCIsImRpc3BsYXlOYW1lIiwiaXNHZW5lcmF0b3JGdW5jdGlvbiIsImNvbnN0cnVjdG9yIiwibmFtZSIsIm1hcmsiLCJzZXRQcm90b3R5cGVPZiIsIl9fcHJvdG9fXyIsImF3cmFwIiwiYXN5bmMiLCJQcm9taXNlIiwia2V5cyIsInJldmVyc2UiLCJwb3AiLCJwcmV2IiwiY2hhckF0Iiwic2xpY2UiLCJzdG9wIiwicnZhbCIsImhhbmRsZSIsImNvbXBsZXRlIiwiZmluaXNoIiwiX2NhdGNoIiwiZGVsZWdhdGVZaWVsZCIsImFzeW5jR2VuZXJhdG9yU3RlcCIsImdlbiIsInJlamVjdCIsIl9uZXh0IiwiX3Rocm93Iiwia2V5IiwiaW5mbyIsImVycm9yIiwiX2FzeW5jVG9HZW5lcmF0b3IiLCJmbiIsInNlbGYiLCJhcmdzIiwiYXJndW1lbnRzIiwiYXBwbHkiLCJlcnIiLCJ1bmRlZmluZWQiLCJfY2xhc3NDYWxsQ2hlY2siLCJpbnN0YW5jZSIsIkNvbnN0cnVjdG9yIiwiX2RlZmluZVByb3BlcnRpZXMiLCJ0YXJnZXQiLCJwcm9wcyIsImRlc2NyaXB0b3IiLCJfdG9Qcm9wZXJ0eUtleSIsIl9jcmVhdGVDbGFzcyIsInByb3RvUHJvcHMiLCJzdGF0aWNQcm9wcyIsIl90b1ByaW1pdGl2ZSIsIlN0cmluZyIsInRvUHJpbWl0aXZlIiwiTnVtYmVyIiwibWoiLCJyZXF1aXJlIiwiSmFudXNTZXNzaW9uIiwic2VuZE9yaWdpbmFsIiwic2VuZCIsInNpZ25hbCIsIm1lc3NhZ2UiLCJpbmRleE9mIiwiY29uc29sZSIsIk5BRiIsImNvbm5lY3Rpb24iLCJhZGFwdGVyIiwicmVjb25uZWN0Iiwic2RwVXRpbHMiLCJkZWJ1ZyIsImxvZyIsIndhcm4iLCJpc1NhZmFyaSIsInRlc3QiLCJuYXZpZ2F0b3IiLCJ1c2VyQWdlbnQiLCJTVUJTQ1JJQkVfVElNRU9VVF9NUyIsImRlYm91bmNlIiwiY3VyciIsIl90aGlzIiwiQXJyYXkiLCJfIiwicmFuZG9tVWludCIsIk1hdGgiLCJmbG9vciIsInJhbmRvbSIsIk1BWF9TQUZFX0lOVEVHRVIiLCJ1bnRpbERhdGFDaGFubmVsT3BlbiIsImRhdGFDaGFubmVsIiwicmVhZHlTdGF0ZSIsInJlc29sdmVyIiwicmVqZWN0b3IiLCJjbGVhciIsInJlbW92ZUV2ZW50TGlzdGVuZXIiLCJhZGRFdmVudExpc3RlbmVyIiwiaXNIMjY0VmlkZW9TdXBwb3J0ZWQiLCJ2aWRlbyIsImRvY3VtZW50IiwiY3JlYXRlRWxlbWVudCIsImNhblBsYXlUeXBlIiwiT1BVU19QQVJBTUVURVJTIiwidXNlZHR4Iiwic3RlcmVvIiwiREVGQVVMVF9QRUVSX0NPTk5FQ1RJT05fQ09ORklHIiwiaWNlU2VydmVycyIsInVybHMiLCJXU19OT1JNQUxfQ0xPU1VSRSIsIkphbnVzQWRhcHRlciIsInJvb20iLCJjbGllbnRJZCIsImpvaW5Ub2tlbiIsInNlcnZlclVybCIsIndlYlJ0Y09wdGlvbnMiLCJwZWVyQ29ubmVjdGlvbkNvbmZpZyIsIndzIiwic2Vzc2lvbiIsInJlbGlhYmxlVHJhbnNwb3J0IiwidW5yZWxpYWJsZVRyYW5zcG9ydCIsImluaXRpYWxSZWNvbm5lY3Rpb25EZWxheSIsInJlY29ubmVjdGlvbkRlbGF5IiwicmVjb25uZWN0aW9uVGltZW91dCIsIm1heFJlY29ubmVjdGlvbkF0dGVtcHRzIiwicmVjb25uZWN0aW9uQXR0ZW1wdHMiLCJwdWJsaXNoZXIiLCJvY2N1cGFudHMiLCJsZWZ0T2NjdXBhbnRzIiwiU2V0IiwibWVkaWFTdHJlYW1zIiwibG9jYWxNZWRpYVN0cmVhbSIsInBlbmRpbmdNZWRpYVJlcXVlc3RzIiwiTWFwIiwiYmxvY2tlZENsaWVudHMiLCJmcm96ZW5VcGRhdGVzIiwidGltZU9mZnNldHMiLCJzZXJ2ZXJUaW1lUmVxdWVzdHMiLCJhdmdUaW1lT2Zmc2V0Iiwib25XZWJzb2NrZXRPcGVuIiwiYmluZCIsIm9uV2Vic29ja2V0Q2xvc2UiLCJvbldlYnNvY2tldE1lc3NhZ2UiLCJvbkRhdGFDaGFubmVsTWVzc2FnZSIsIm9uRGF0YSIsInNldFNlcnZlclVybCIsInVybCIsInNldEFwcCIsImFwcCIsInNldFJvb20iLCJyb29tTmFtZSIsInNldEpvaW5Ub2tlbiIsInNldENsaWVudElkIiwic2V0V2ViUnRjT3B0aW9ucyIsIm9wdGlvbnMiLCJzZXRQZWVyQ29ubmVjdGlvbkNvbmZpZyIsInNldFNlcnZlckNvbm5lY3RMaXN0ZW5lcnMiLCJzdWNjZXNzTGlzdGVuZXIiLCJmYWlsdXJlTGlzdGVuZXIiLCJjb25uZWN0U3VjY2VzcyIsImNvbm5lY3RGYWlsdXJlIiwic2V0Um9vbU9jY3VwYW50TGlzdGVuZXIiLCJvY2N1cGFudExpc3RlbmVyIiwib25PY2N1cGFudHNDaGFuZ2VkIiwic2V0RGF0YUNoYW5uZWxMaXN0ZW5lcnMiLCJvcGVuTGlzdGVuZXIiLCJjbG9zZWRMaXN0ZW5lciIsIm1lc3NhZ2VMaXN0ZW5lciIsIm9uT2NjdXBhbnRDb25uZWN0ZWQiLCJvbk9jY3VwYW50RGlzY29ubmVjdGVkIiwib25PY2N1cGFudE1lc3NhZ2UiLCJzZXRSZWNvbm5lY3Rpb25MaXN0ZW5lcnMiLCJyZWNvbm5lY3RpbmdMaXN0ZW5lciIsInJlY29ubmVjdGVkTGlzdGVuZXIiLCJyZWNvbm5lY3Rpb25FcnJvckxpc3RlbmVyIiwib25SZWNvbm5lY3RpbmciLCJvblJlY29ubmVjdGVkIiwib25SZWNvbm5lY3Rpb25FcnJvciIsInNldEV2ZW50TG9vcHMiLCJsb29wcyIsImNvbm5lY3QiLCJfdGhpczIiLCJjb25jYXQiLCJ3ZWJzb2NrZXRDb25uZWN0aW9uIiwiV2ViU29ja2V0IiwidGltZW91dE1zIiwid3NPbk9wZW4iLCJhbGwiLCJ1cGRhdGVUaW1lT2Zmc2V0IiwiZGlzY29ubmVjdCIsImNsZWFyVGltZW91dCIsInJlbW92ZUFsbE9jY3VwYW50cyIsImNvbm4iLCJjbG9zZSIsImRpc3Bvc2UiLCJkZWxheWVkUmVjb25uZWN0VGltZW91dCIsImlzRGlzY29ubmVjdGVkIiwiX29uV2Vic29ja2V0T3BlbiIsIl9jYWxsZWUiLCJhZGRPY2N1cGFudFByb21pc2VzIiwib2NjdXBhbnRJZCIsIl9jYWxsZWUkIiwiX2NvbnRleHQiLCJjcmVhdGVQdWJsaXNoZXIiLCJpbml0aWFsT2NjdXBhbnRzIiwiYWRkT2NjdXBhbnQiLCJldmVudCIsIl90aGlzMyIsImNvZGUiLCJzZXRUaW1lb3V0IiwiX3RoaXM0IiwicGVyZm9ybURlbGF5ZWRSZWNvbm5lY3QiLCJfdGhpczUiLCJyZWNlaXZlIiwiSlNPTiIsInBhcnNlIiwiZGF0YSIsIl9hZGRPY2N1cGFudCIsIl9jYWxsZWUyIiwic3Vic2NyaWJlciIsIl9jYWxsZWUyJCIsIl9jb250ZXh0MiIsInJlbW92ZU9jY3VwYW50IiwiY3JlYXRlU3Vic2NyaWJlciIsInNldE1lZGlhU3RyZWFtIiwibWVkaWFTdHJlYW0iLCJfeCIsIl9pdGVyYXRvciIsIl9jcmVhdGVGb3JPZkl0ZXJhdG9ySGVscGVyIiwiZ2V0T3duUHJvcGVydHlOYW1lcyIsIl9zdGVwIiwiYWRkIiwiaGFzIiwibXNnIiwiZ2V0IiwiYXVkaW8iLCJhc3NvY2lhdGUiLCJfdGhpczYiLCJldiIsInNlbmRUcmlja2xlIiwiY2FuZGlkYXRlIiwiaWNlQ29ubmVjdGlvblN0YXRlIiwib2ZmZXIiLCJjcmVhdGVPZmZlciIsImNvbmZpZ3VyZVB1Ymxpc2hlclNkcCIsImZpeFNhZmFyaUljZVVGcmFnIiwibG9jYWwiLCJzZXRMb2NhbERlc2NyaXB0aW9uIiwicmVtb3RlIiwiaiIsInNlbmRKc2VwIiwic2V0UmVtb3RlRGVzY3JpcHRpb24iLCJqc2VwIiwib24iLCJhbnN3ZXIiLCJjb25maWd1cmVTdWJzY3JpYmVyU2RwIiwiY3JlYXRlQW5zd2VyIiwiX2NyZWF0ZVB1Ymxpc2hlciIsIl9jYWxsZWUzIiwiX3RoaXM3Iiwid2VicnRjdXAiLCJyZWxpYWJsZUNoYW5uZWwiLCJ1bnJlbGlhYmxlQ2hhbm5lbCIsIl9jYWxsZWUzJCIsIl9jb250ZXh0MyIsIkphbnVzUGx1Z2luSGFuZGxlIiwiUlRDUGVlckNvbm5lY3Rpb24iLCJhdHRhY2giLCJwYXJzZUludCIsImNyZWF0ZURhdGFDaGFubmVsIiwib3JkZXJlZCIsIm1heFJldHJhbnNtaXRzIiwiZ2V0VHJhY2tzIiwidHJhY2siLCJhZGRUcmFjayIsInBsdWdpbmRhdGEiLCJyb29tX2lkIiwidXNlcl9pZCIsImJvZHkiLCJkaXNwYXRjaEV2ZW50IiwiQ3VzdG9tRXZlbnQiLCJkZXRhaWwiLCJieSIsInNlbmRKb2luIiwibm90aWZpY2F0aW9ucyIsInN1Y2Nlc3MiLCJyZXNwb25zZSIsInVzZXJzIiwiaW5jbHVkZXMiLCJzZHAiLCJyZXBsYWNlIiwibGluZSIsInB0IiwicGFyYW1ldGVycyIsImFzc2lnbiIsInBhcnNlRm10cCIsIndyaXRlRm10cCIsInBheWxvYWRUeXBlIiwiX2ZpeFNhZmFyaUljZVVGcmFnIiwiX2NhbGxlZTQiLCJfY2FsbGVlNCQiLCJfY29udGV4dDQiLCJfeDIiLCJfY3JlYXRlU3Vic2NyaWJlciIsIl9jYWxsZWU1IiwiX3RoaXM4IiwibWF4UmV0cmllcyIsIndlYnJ0Y0ZhaWxlZCIsInJlY2VpdmVycyIsIl9hcmdzNSIsIl9jYWxsZWU1JCIsIl9jb250ZXh0NSIsImxlZnRJbnRlcnZhbCIsInNldEludGVydmFsIiwiY2xlYXJJbnRlcnZhbCIsInRpbWVvdXQiLCJtZWRpYSIsIl9pT1NIYWNrRGVsYXllZEluaXRpYWxQZWVyIiwiTWVkaWFTdHJlYW0iLCJnZXRSZWNlaXZlcnMiLCJyZWNlaXZlciIsIl94MyIsInN1YnNjcmliZSIsInNlbmRNZXNzYWdlIiwia2luZCIsInRva2VuIiwidG9nZ2xlRnJlZXplIiwiZnJvemVuIiwidW5mcmVlemUiLCJmcmVlemUiLCJmbHVzaFBlbmRpbmdVcGRhdGVzIiwiZGF0YUZvclVwZGF0ZU11bHRpTWVzc2FnZSIsIm5ldHdvcmtJZCIsImdldFBlbmRpbmdEYXRhIiwiZGF0YVR5cGUiLCJvd25lciIsImdldFBlbmRpbmdEYXRhRm9yTmV0d29ya0lkIiwiX2l0ZXJhdG9yMiIsIl9zdGVwMiIsIl9zdGVwMiR2YWx1ZSIsIl9zbGljZWRUb0FycmF5Iiwic291cmNlIiwic3RvcmVNZXNzYWdlIiwic3RvcmVTaW5nbGVNZXNzYWdlIiwiaW5kZXgiLCJzZXQiLCJzdG9yZWRNZXNzYWdlIiwic3RvcmVkRGF0YSIsImlzT3V0ZGF0ZWRNZXNzYWdlIiwibGFzdE93bmVyVGltZSIsImlzQ29udGVtcG9yYW5lb3VzTWVzc2FnZSIsImNyZWF0ZWRXaGlsZUZyb3plbiIsImlzRmlyc3RTeW5jIiwiY29tcG9uZW50cyIsImVuYWJsZWQiLCJzaG91bGRTdGFydENvbm5lY3Rpb25UbyIsImNsaWVudCIsInN0YXJ0U3RyZWFtQ29ubmVjdGlvbiIsImNsb3NlU3RyZWFtQ29ubmVjdGlvbiIsImdldENvbm5lY3RTdGF0dXMiLCJhZGFwdGVycyIsIklTX0NPTk5FQ1RFRCIsIk5PVF9DT05ORUNURUQiLCJfdXBkYXRlVGltZU9mZnNldCIsIl9jYWxsZWU2IiwiX3RoaXM5IiwiY2xpZW50U2VudFRpbWUiLCJyZXMiLCJwcmVjaXNpb24iLCJzZXJ2ZXJSZWNlaXZlZFRpbWUiLCJjbGllbnRSZWNlaXZlZFRpbWUiLCJzZXJ2ZXJUaW1lIiwidGltZU9mZnNldCIsIl9jYWxsZWU2JCIsIl9jb250ZXh0NiIsIkRhdGUiLCJub3ciLCJmZXRjaCIsImxvY2F0aW9uIiwiaHJlZiIsImNhY2hlIiwiaGVhZGVycyIsImdldFRpbWUiLCJyZWR1Y2UiLCJhY2MiLCJvZmZzZXQiLCJnZXRTZXJ2ZXJUaW1lIiwiZ2V0TWVkaWFTdHJlYW0iLCJfdGhpczEwIiwiYXVkaW9Qcm9taXNlIiwidmlkZW9Qcm9taXNlIiwicHJvbWlzZSIsInN0cmVhbSIsImF1ZGlvU3RyZWFtIiwiZ2V0QXVkaW9UcmFja3MiLCJ2aWRlb1N0cmVhbSIsImdldFZpZGVvVHJhY2tzIiwiX3NldExvY2FsTWVkaWFTdHJlYW0iLCJfY2FsbGVlNyIsIl90aGlzMTEiLCJleGlzdGluZ1NlbmRlcnMiLCJuZXdTZW5kZXJzIiwidHJhY2tzIiwiX2xvb3AiLCJfY2FsbGVlNyQiLCJfY29udGV4dDgiLCJnZXRTZW5kZXJzIiwic2VuZGVyIiwiX2xvb3AkIiwiX2NvbnRleHQ3IiwiZmluZCIsInJlcGxhY2VUcmFjayIsInRvTG93ZXJDYXNlIiwicmVtb3ZlVHJhY2siLCJzZXRMb2NhbE1lZGlhU3RyZWFtIiwiX3g0IiwiZW5hYmxlTWljcm9waG9uZSIsInNlbmREYXRhIiwic3RyaW5naWZ5Iiwid2hvbSIsInNlbmREYXRhR3VhcmFudGVlZCIsImJyb2FkY2FzdERhdGEiLCJicm9hZGNhc3REYXRhR3VhcmFudGVlZCIsImtpY2siLCJwZXJtc1Rva2VuIiwiYmxvY2siLCJfdGhpczEyIiwidW5ibG9jayIsIl90aGlzMTMiLCJyZWdpc3RlciIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlUm9vdCI6IiJ9