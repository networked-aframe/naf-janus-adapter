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

function _typeof(obj) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (obj) { return typeof obj; } : function (obj) { return obj && "function" == typeof Symbol && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }, _typeof(obj); }
function _slicedToArray(arr, i) { return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _unsupportedIterableToArray(arr, i) || _nonIterableRest(); }
function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _iterableToArrayLimit(arr, i) { var _i = null == arr ? null : "undefined" != typeof Symbol && arr[Symbol.iterator] || arr["@@iterator"]; if (null != _i) { var _s, _e, _x, _r, _arr = [], _n = !0, _d = !1; try { if (_x = (_i = _i.call(arr)).next, 0 === i) { if (Object(_i) !== _i) return; _n = !1; } else for (; !(_n = (_s = _x.call(_i)).done) && (_arr.push(_s.value), _arr.length !== i); _n = !0); } catch (err) { _d = !0, _e = err; } finally { try { if (!_n && null != _i["return"] && (_r = _i["return"](), Object(_r) !== _r)) return; } finally { if (_d) throw _e; } } return _arr; } }
function _arrayWithHoles(arr) { if (Array.isArray(arr)) return arr; }
function _createForOfIteratorHelper(o, allowArrayLike) { var it = typeof Symbol !== "undefined" && o[Symbol.iterator] || o["@@iterator"]; if (!it) { if (Array.isArray(o) || (it = _unsupportedIterableToArray(o)) || allowArrayLike && o && typeof o.length === "number") { if (it) o = it; var i = 0; var F = function F() {}; return { s: F, n: function n() { if (i >= o.length) return { done: true }; return { done: false, value: o[i++] }; }, e: function e(_e2) { throw _e2; }, f: F }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); } var normalCompletion = true, didErr = false, err; return { s: function s() { it = it.call(o); }, n: function n() { var step = it.next(); normalCompletion = step.done; return step; }, e: function e(_e3) { didErr = true; err = _e3; }, f: function f() { try { if (!normalCompletion && it["return"] != null) it["return"](); } finally { if (didErr) throw err; } } }; }
function _unsupportedIterableToArray(o, minLen) { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(o, minLen); var n = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && o.constructor) n = o.constructor.name; if (n === "Map" || n === "Set") return Array.from(o); if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen); }
function _arrayLikeToArray(arr, len) { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i]; return arr2; }
function _regeneratorRuntime() { "use strict"; /*! regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/facebook/regenerator/blob/main/LICENSE */ _regeneratorRuntime = function _regeneratorRuntime() { return exports; }; var exports = {}, Op = Object.prototype, hasOwn = Op.hasOwnProperty, defineProperty = Object.defineProperty || function (obj, key, desc) { obj[key] = desc.value; }, $Symbol = "function" == typeof Symbol ? Symbol : {}, iteratorSymbol = $Symbol.iterator || "@@iterator", asyncIteratorSymbol = $Symbol.asyncIterator || "@@asyncIterator", toStringTagSymbol = $Symbol.toStringTag || "@@toStringTag"; function define(obj, key, value) { return Object.defineProperty(obj, key, { value: value, enumerable: !0, configurable: !0, writable: !0 }), obj[key]; } try { define({}, ""); } catch (err) { define = function define(obj, key, value) { return obj[key] = value; }; } function wrap(innerFn, outerFn, self, tryLocsList) { var protoGenerator = outerFn && outerFn.prototype instanceof Generator ? outerFn : Generator, generator = Object.create(protoGenerator.prototype), context = new Context(tryLocsList || []); return defineProperty(generator, "_invoke", { value: makeInvokeMethod(innerFn, self, context) }), generator; } function tryCatch(fn, obj, arg) { try { return { type: "normal", arg: fn.call(obj, arg) }; } catch (err) { return { type: "throw", arg: err }; } } exports.wrap = wrap; var ContinueSentinel = {}; function Generator() {} function GeneratorFunction() {} function GeneratorFunctionPrototype() {} var IteratorPrototype = {}; define(IteratorPrototype, iteratorSymbol, function () { return this; }); var getProto = Object.getPrototypeOf, NativeIteratorPrototype = getProto && getProto(getProto(values([]))); NativeIteratorPrototype && NativeIteratorPrototype !== Op && hasOwn.call(NativeIteratorPrototype, iteratorSymbol) && (IteratorPrototype = NativeIteratorPrototype); var Gp = GeneratorFunctionPrototype.prototype = Generator.prototype = Object.create(IteratorPrototype); function defineIteratorMethods(prototype) { ["next", "throw", "return"].forEach(function (method) { define(prototype, method, function (arg) { return this._invoke(method, arg); }); }); } function AsyncIterator(generator, PromiseImpl) { function invoke(method, arg, resolve, reject) { var record = tryCatch(generator[method], generator, arg); if ("throw" !== record.type) { var result = record.arg, value = result.value; return value && "object" == _typeof(value) && hasOwn.call(value, "__await") ? PromiseImpl.resolve(value.__await).then(function (value) { invoke("next", value, resolve, reject); }, function (err) { invoke("throw", err, resolve, reject); }) : PromiseImpl.resolve(value).then(function (unwrapped) { result.value = unwrapped, resolve(result); }, function (error) { return invoke("throw", error, resolve, reject); }); } reject(record.arg); } var previousPromise; defineProperty(this, "_invoke", { value: function value(method, arg) { function callInvokeWithMethodAndArg() { return new PromiseImpl(function (resolve, reject) { invoke(method, arg, resolve, reject); }); } return previousPromise = previousPromise ? previousPromise.then(callInvokeWithMethodAndArg, callInvokeWithMethodAndArg) : callInvokeWithMethodAndArg(); } }); } function makeInvokeMethod(innerFn, self, context) { var state = "suspendedStart"; return function (method, arg) { if ("executing" === state) throw new Error("Generator is already running"); if ("completed" === state) { if ("throw" === method) throw arg; return doneResult(); } for (context.method = method, context.arg = arg;;) { var delegate = context.delegate; if (delegate) { var delegateResult = maybeInvokeDelegate(delegate, context); if (delegateResult) { if (delegateResult === ContinueSentinel) continue; return delegateResult; } } if ("next" === context.method) context.sent = context._sent = context.arg;else if ("throw" === context.method) { if ("suspendedStart" === state) throw state = "completed", context.arg; context.dispatchException(context.arg); } else "return" === context.method && context.abrupt("return", context.arg); state = "executing"; var record = tryCatch(innerFn, self, context); if ("normal" === record.type) { if (state = context.done ? "completed" : "suspendedYield", record.arg === ContinueSentinel) continue; return { value: record.arg, done: context.done }; } "throw" === record.type && (state = "completed", context.method = "throw", context.arg = record.arg); } }; } function maybeInvokeDelegate(delegate, context) { var methodName = context.method, method = delegate.iterator[methodName]; if (undefined === method) return context.delegate = null, "throw" === methodName && delegate.iterator["return"] && (context.method = "return", context.arg = undefined, maybeInvokeDelegate(delegate, context), "throw" === context.method) || "return" !== methodName && (context.method = "throw", context.arg = new TypeError("The iterator does not provide a '" + methodName + "' method")), ContinueSentinel; var record = tryCatch(method, delegate.iterator, context.arg); if ("throw" === record.type) return context.method = "throw", context.arg = record.arg, context.delegate = null, ContinueSentinel; var info = record.arg; return info ? info.done ? (context[delegate.resultName] = info.value, context.next = delegate.nextLoc, "return" !== context.method && (context.method = "next", context.arg = undefined), context.delegate = null, ContinueSentinel) : info : (context.method = "throw", context.arg = new TypeError("iterator result is not an object"), context.delegate = null, ContinueSentinel); } function pushTryEntry(locs) { var entry = { tryLoc: locs[0] }; 1 in locs && (entry.catchLoc = locs[1]), 2 in locs && (entry.finallyLoc = locs[2], entry.afterLoc = locs[3]), this.tryEntries.push(entry); } function resetTryEntry(entry) { var record = entry.completion || {}; record.type = "normal", delete record.arg, entry.completion = record; } function Context(tryLocsList) { this.tryEntries = [{ tryLoc: "root" }], tryLocsList.forEach(pushTryEntry, this), this.reset(!0); } function values(iterable) { if (iterable) { var iteratorMethod = iterable[iteratorSymbol]; if (iteratorMethod) return iteratorMethod.call(iterable); if ("function" == typeof iterable.next) return iterable; if (!isNaN(iterable.length)) { var i = -1, next = function next() { for (; ++i < iterable.length;) if (hasOwn.call(iterable, i)) return next.value = iterable[i], next.done = !1, next; return next.value = undefined, next.done = !0, next; }; return next.next = next; } } return { next: doneResult }; } function doneResult() { return { value: undefined, done: !0 }; } return GeneratorFunction.prototype = GeneratorFunctionPrototype, defineProperty(Gp, "constructor", { value: GeneratorFunctionPrototype, configurable: !0 }), defineProperty(GeneratorFunctionPrototype, "constructor", { value: GeneratorFunction, configurable: !0 }), GeneratorFunction.displayName = define(GeneratorFunctionPrototype, toStringTagSymbol, "GeneratorFunction"), exports.isGeneratorFunction = function (genFun) { var ctor = "function" == typeof genFun && genFun.constructor; return !!ctor && (ctor === GeneratorFunction || "GeneratorFunction" === (ctor.displayName || ctor.name)); }, exports.mark = function (genFun) { return Object.setPrototypeOf ? Object.setPrototypeOf(genFun, GeneratorFunctionPrototype) : (genFun.__proto__ = GeneratorFunctionPrototype, define(genFun, toStringTagSymbol, "GeneratorFunction")), genFun.prototype = Object.create(Gp), genFun; }, exports.awrap = function (arg) { return { __await: arg }; }, defineIteratorMethods(AsyncIterator.prototype), define(AsyncIterator.prototype, asyncIteratorSymbol, function () { return this; }), exports.AsyncIterator = AsyncIterator, exports.async = function (innerFn, outerFn, self, tryLocsList, PromiseImpl) { void 0 === PromiseImpl && (PromiseImpl = Promise); var iter = new AsyncIterator(wrap(innerFn, outerFn, self, tryLocsList), PromiseImpl); return exports.isGeneratorFunction(outerFn) ? iter : iter.next().then(function (result) { return result.done ? result.value : iter.next(); }); }, defineIteratorMethods(Gp), define(Gp, toStringTagSymbol, "Generator"), define(Gp, iteratorSymbol, function () { return this; }), define(Gp, "toString", function () { return "[object Generator]"; }), exports.keys = function (val) { var object = Object(val), keys = []; for (var key in object) keys.push(key); return keys.reverse(), function next() { for (; keys.length;) { var key = keys.pop(); if (key in object) return next.value = key, next.done = !1, next; } return next.done = !0, next; }; }, exports.values = values, Context.prototype = { constructor: Context, reset: function reset(skipTempReset) { if (this.prev = 0, this.next = 0, this.sent = this._sent = undefined, this.done = !1, this.delegate = null, this.method = "next", this.arg = undefined, this.tryEntries.forEach(resetTryEntry), !skipTempReset) for (var name in this) "t" === name.charAt(0) && hasOwn.call(this, name) && !isNaN(+name.slice(1)) && (this[name] = undefined); }, stop: function stop() { this.done = !0; var rootRecord = this.tryEntries[0].completion; if ("throw" === rootRecord.type) throw rootRecord.arg; return this.rval; }, dispatchException: function dispatchException(exception) { if (this.done) throw exception; var context = this; function handle(loc, caught) { return record.type = "throw", record.arg = exception, context.next = loc, caught && (context.method = "next", context.arg = undefined), !!caught; } for (var i = this.tryEntries.length - 1; i >= 0; --i) { var entry = this.tryEntries[i], record = entry.completion; if ("root" === entry.tryLoc) return handle("end"); if (entry.tryLoc <= this.prev) { var hasCatch = hasOwn.call(entry, "catchLoc"), hasFinally = hasOwn.call(entry, "finallyLoc"); if (hasCatch && hasFinally) { if (this.prev < entry.catchLoc) return handle(entry.catchLoc, !0); if (this.prev < entry.finallyLoc) return handle(entry.finallyLoc); } else if (hasCatch) { if (this.prev < entry.catchLoc) return handle(entry.catchLoc, !0); } else { if (!hasFinally) throw new Error("try statement without catch or finally"); if (this.prev < entry.finallyLoc) return handle(entry.finallyLoc); } } } }, abrupt: function abrupt(type, arg) { for (var i = this.tryEntries.length - 1; i >= 0; --i) { var entry = this.tryEntries[i]; if (entry.tryLoc <= this.prev && hasOwn.call(entry, "finallyLoc") && this.prev < entry.finallyLoc) { var finallyEntry = entry; break; } } finallyEntry && ("break" === type || "continue" === type) && finallyEntry.tryLoc <= arg && arg <= finallyEntry.finallyLoc && (finallyEntry = null); var record = finallyEntry ? finallyEntry.completion : {}; return record.type = type, record.arg = arg, finallyEntry ? (this.method = "next", this.next = finallyEntry.finallyLoc, ContinueSentinel) : this.complete(record); }, complete: function complete(record, afterLoc) { if ("throw" === record.type) throw record.arg; return "break" === record.type || "continue" === record.type ? this.next = record.arg : "return" === record.type ? (this.rval = this.arg = record.arg, this.method = "return", this.next = "end") : "normal" === record.type && afterLoc && (this.next = afterLoc), ContinueSentinel; }, finish: function finish(finallyLoc) { for (var i = this.tryEntries.length - 1; i >= 0; --i) { var entry = this.tryEntries[i]; if (entry.finallyLoc === finallyLoc) return this.complete(entry.completion, entry.afterLoc), resetTryEntry(entry), ContinueSentinel; } }, "catch": function _catch(tryLoc) { for (var i = this.tryEntries.length - 1; i >= 0; --i) { var entry = this.tryEntries[i]; if (entry.tryLoc === tryLoc) { var record = entry.completion; if ("throw" === record.type) { var thrown = record.arg; resetTryEntry(entry); } return thrown; } } throw new Error("illegal catch attempt"); }, delegateYield: function delegateYield(iterable, resultName, nextLoc) { return this.delegate = { iterator: values(iterable), resultName: resultName, nextLoc: nextLoc }, "next" === this.method && (this.arg = undefined), ContinueSentinel; } }, exports; }
function asyncGeneratorStep(gen, resolve, reject, _next, _throw, key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { Promise.resolve(value).then(_next, _throw); } }
function _asyncToGenerator(fn) { return function () { var self = this, args = arguments; return new Promise(function (resolve, reject) { var gen = fn.apply(self, args); function _next(value) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, "next", value); } function _throw(err) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, "throw", err); } _next(undefined); }); }; }
function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }
function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, _toPropertyKey(descriptor.key), descriptor); } }
function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); Object.defineProperty(Constructor, "prototype", { writable: false }); return Constructor; }
function _toPropertyKey(arg) { var key = _toPrimitive(arg, "string"); return _typeof(key) === "symbol" ? key : String(key); }
function _toPrimitive(input, hint) { if (_typeof(input) !== "object" || input === null) return input; var prim = input[Symbol.toPrimitive]; if (prim !== undefined) { var res = prim.call(input, hint || "default"); if (_typeof(res) !== "object") return res; throw new TypeError("@@toPrimitive must return a primitive value."); } return (hint === "string" ? String : Number)(input); }
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
var debug = __webpack_require__(/*! debug */ "./node_modules/debug/src/browser.js")("naf-janus-adapter:debug");
var warn = __webpack_require__(/*! debug */ "./node_modules/debug/src/browser.js")("naf-janus-adapter:warn");
var error = __webpack_require__(/*! debug */ "./node_modules/debug/src/browser.js")("naf-janus-adapter:error");
var isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
var SUBSCRIBE_TIMEOUT_MS = 15000;
var AVAILABLE_OCCUPANTS_THRESHOLD = 5;
var MAX_SUBSCRIBE_DELAY = 5000;
function randomDelay(min, max) {
  return new Promise(function (resolve) {
    var delay = Math.random() * (max - min) + min;
    setTimeout(resolve, delay);
  });
}
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
        var i, occupantId;
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
              i = 0;
            case 7:
              if (!(i < this.publisher.initialOccupants.length)) {
                _context.next = 15;
                break;
              }
              occupantId = this.publisher.initialOccupants[i];
              if (!(occupantId === this.clientId)) {
                _context.next = 11;
                break;
              }
              return _context.abrupt("continue", 12);
            case 11:
              // Happens during non-graceful reconnects due to zombie sessions
              this.addAvailableOccupant(occupantId);
            case 12:
              i++;
              _context.next = 7;
              break;
            case 15:
              this.syncOccupants();
            case 16:
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
    key: "addAvailableOccupant",
    value: function addAvailableOccupant(occupantId) {
      if (this.availableOccupants.indexOf(occupantId) === -1) {
        this.availableOccupants.push(occupantId);
      }
    }
  }, {
    key: "removeAvailableOccupant",
    value: function removeAvailableOccupant(occupantId) {
      var idx = this.availableOccupants.indexOf(occupantId);
      if (idx !== -1) {
        this.availableOccupants.splice(idx, 1);
      }
    }
  }, {
    key: "syncOccupants",
    value: function syncOccupants(requestedOccupants) {
      if (requestedOccupants) {
        this.requestedOccupants = requestedOccupants;
      }
      if (!this.requestedOccupants) {
        return;
      }

      // Add any requested, available, and non-pending occupants.
      for (var i = 0; i < this.requestedOccupants.length; i++) {
        var occupantId = this.requestedOccupants[i];
        if (!this.occupants[occupantId] && this.availableOccupants.indexOf(occupantId) !== -1 && !this.pendingOccupants.has(occupantId)) {
          this.addOccupant(occupantId);
        }
      }

      // Remove any unrequested and currently added occupants.
      for (var j = 0; j < this.availableOccupants.length; j++) {
        var _occupantId = this.availableOccupants[j];
        if (this.occupants[_occupantId] && this.requestedOccupants.indexOf(_occupantId) === -1) {
          this.removeOccupant(_occupantId);
        }
      }

      // Call the Networked AFrame callbacks for the updated occupants list.
      this.onOccupantsChanged(this.occupants);
    }
  }, {
    key: "addOccupant",
    value: function () {
      var _addOccupant = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee2(occupantId) {
        var availableOccupantsCount, subscriber;
        return _regeneratorRuntime().wrap(function _callee2$(_context2) {
          while (1) switch (_context2.prev = _context2.next) {
            case 0:
              this.pendingOccupants.add(occupantId);
              availableOccupantsCount = this.availableOccupants.length;
              if (!(availableOccupantsCount > AVAILABLE_OCCUPANTS_THRESHOLD)) {
                _context2.next = 5;
                break;
              }
              _context2.next = 5;
              return randomDelay(0, MAX_SUBSCRIBE_DELAY);
            case 5:
              _context2.next = 7;
              return this.createSubscriber(occupantId);
            case 7:
              subscriber = _context2.sent;
              if (subscriber) {
                if (!this.pendingOccupants.has(occupantId)) {
                  subscriber.conn.close();
                } else {
                  this.pendingOccupants["delete"](occupantId);
                  this.occupantIds.push(occupantId);
                  this.occupants[occupantId] = subscriber;
                  this.setMediaStream(occupantId, subscriber.mediaStream);

                  // Call the Networked AFrame callbacks for the new occupant.
                  this.onOccupantConnected(occupantId);
                }
              }
            case 9:
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
      this.pendingOccupants.clear();
      for (var i = this.occupantIds.length - 1; i >= 0; i--) {
        this.removeOccupant(this.occupantIds[i]);
      }
    }
  }, {
    key: "removeOccupant",
    value: function removeOccupant(occupantId) {
      this.pendingOccupants["delete"](occupantId);
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
        var msg = "The user disconnected before the media stream was resolved.";
        this.pendingMediaRequests.get(occupantId).audio.reject(msg);
        this.pendingMediaRequests.get(occupantId).video.reject(msg);
        this.pendingMediaRequests["delete"](occupantId);
      }

      // Call the Networked AFrame callbacks for the removed occupant.
      this.onOccupantDisconnected(occupantId);
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
                  _this7.addAvailableOccupant(data.user_id);
                  _this7.syncOccupants();
                } else if (data.event == "leave" && data.room_id == _this7.room) {
                  _this7.removeAvailableOccupant(data.user_id);
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
              if (!(this.availableOccupants.indexOf(occupantId) === -1)) {
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
              if (!(this.availableOccupants.indexOf(occupantId) === -1)) {
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
                  if (_this8.availableOccupants.indexOf(occupantId) === -1) {
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
              if (!(this.availableOccupants.indexOf(occupantId) === -1)) {
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
              if (!(this.availableOccupants.indexOf(occupantId) === -1)) {
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
      var _iterator = _createForOfIteratorHelper(this.frozenUpdates),
        _step;
      try {
        for (_iterator.s(); !(_step = _iterator.n()).done;) {
          var _step$value = _slicedToArray(_step.value, 2),
            networkId = _step$value[0],
            message = _step$value[1];
          var data = this.getPendingData(networkId, message);
          if (!data) continue;

          // Override the data type on "um" messages types, since we extract entity updates from "um" messages into
          // individual frozenUpdates in storeSingleMessage.
          var dataType = message.dataType === "um" ? "u" : message.dataType;
          this.onOccupantMessage(null, dataType, data, message.source);
        }
      } catch (err) {
        _iterator.e(err);
      } finally {
        _iterator.f();
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
            this.publisher.handle.sendMessage({
              kind: "data",
              body: JSON.stringify({
                dataType: dataType,
                data: data
              }),
              whom: clientId
            });
            break;
          case "datachannel":
            this.publisher.unreliableChannel.send(JSON.stringify({
              clientId: clientId,
              dataType: dataType,
              data: data
            }));
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
            this.publisher.handle.sendMessage({
              kind: "data",
              body: JSON.stringify({
                dataType: dataType,
                data: data
              }),
              whom: clientId
            });
            break;
          case "datachannel":
            this.publisher.reliableChannel.send(JSON.stringify({
              clientId: clientId,
              dataType: dataType,
              data: data
            }));
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
            this.publisher.handle.sendMessage({
              kind: "data",
              body: JSON.stringify({
                dataType: dataType,
                data: data
              })
            });
            break;
          case "datachannel":
            this.publisher.unreliableChannel.send(JSON.stringify({
              dataType: dataType,
              data: data
            }));
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
            this.publisher.handle.sendMessage({
              kind: "data",
              body: JSON.stringify({
                dataType: dataType,
                data: data
              })
            });
            break;
          case "datachannel":
            this.publisher.reliableChannel.send(JSON.stringify({
              dataType: dataType,
              data: data
            }));
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,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O0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxrQkFBa0Isa0JBQWtCLE9BQU87QUFDM0M7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEdBQUc7QUFDSDtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLE9BQU87QUFDUDtBQUNBO0FBQ0E7QUFDQSxLQUFLO0FBQ0wsR0FBRztBQUNIO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0EsNkNBQTZDO0FBQzdDO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEdBQUc7O0FBRUg7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsR0FBRztBQUNIO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxHQUFHO0FBQ0g7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBLEtBQUs7QUFDTDtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQSxLQUFLO0FBQ0w7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0Esd0JBQXdCO0FBQ3hCO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxHQUFHO0FBQ0g7QUFDQTtBQUNBO0FBQ0EsS0FBSztBQUNMOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxNQUFNO0FBQ047QUFDQTtBQUNBO0FBQ0EsTUFBTTtBQUNOO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsS0FBSztBQUNMO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUFHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLFlBQVk7QUFDWjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxZQUFZO0FBQ1o7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxJQUFJO0FBQ0o7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLElBQUk7QUFDSjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLGtCQUFrQixrQkFBa0I7QUFDcEM7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxrQkFBa0Isa0JBQWtCO0FBQ3BDO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0EsSUFBSSxJQUEwQjtBQUM5QjtBQUNBOzs7Ozs7O1VDanlCQTtVQUNBOztVQUVBO1VBQ0E7VUFDQTtVQUNBO1VBQ0E7VUFDQTtVQUNBO1VBQ0E7VUFDQTtVQUNBO1VBQ0E7VUFDQTtVQUNBOztVQUVBO1VBQ0E7O1VBRUE7VUFDQTtVQUNBOzs7O1VFdEJBO1VBQ0E7VUFDQTtVQUNBIiwic291cmNlcyI6WyJ3ZWJwYWNrOi8vQG5ldHdvcmtlZC1hZnJhbWUvbmFmLWphbnVzLWFkYXB0ZXIvLi9ub2RlX21vZHVsZXMvQG5ldHdvcmtlZC1hZnJhbWUvbWluaWphbnVzL21pbmlqYW51cy5qcyIsIndlYnBhY2s6Ly9AbmV0d29ya2VkLWFmcmFtZS9uYWYtamFudXMtYWRhcHRlci8uL3NyYy9pbmRleC5qcyIsIndlYnBhY2s6Ly9AbmV0d29ya2VkLWFmcmFtZS9uYWYtamFudXMtYWRhcHRlci8uL25vZGVfbW9kdWxlcy9kZWJ1Zy9zcmMvYnJvd3Nlci5qcyIsIndlYnBhY2s6Ly9AbmV0d29ya2VkLWFmcmFtZS9uYWYtamFudXMtYWRhcHRlci8uL25vZGVfbW9kdWxlcy9kZWJ1Zy9zcmMvY29tbW9uLmpzIiwid2VicGFjazovL0BuZXR3b3JrZWQtYWZyYW1lL25hZi1qYW51cy1hZGFwdGVyLy4vbm9kZV9tb2R1bGVzL21zL2luZGV4LmpzIiwid2VicGFjazovL0BuZXR3b3JrZWQtYWZyYW1lL25hZi1qYW51cy1hZGFwdGVyLy4vbm9kZV9tb2R1bGVzL3NkcC9zZHAuanMiLCJ3ZWJwYWNrOi8vQG5ldHdvcmtlZC1hZnJhbWUvbmFmLWphbnVzLWFkYXB0ZXIvd2VicGFjay9ib290c3RyYXAiLCJ3ZWJwYWNrOi8vQG5ldHdvcmtlZC1hZnJhbWUvbmFmLWphbnVzLWFkYXB0ZXIvd2VicGFjay9iZWZvcmUtc3RhcnR1cCIsIndlYnBhY2s6Ly9AbmV0d29ya2VkLWFmcmFtZS9uYWYtamFudXMtYWRhcHRlci93ZWJwYWNrL3N0YXJ0dXAiLCJ3ZWJwYWNrOi8vQG5ldHdvcmtlZC1hZnJhbWUvbmFmLWphbnVzLWFkYXB0ZXIvd2VicGFjay9hZnRlci1zdGFydHVwIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogUmVwcmVzZW50cyBhIGhhbmRsZSB0byBhIHNpbmdsZSBKYW51cyBwbHVnaW4gb24gYSBKYW51cyBzZXNzaW9uLiBFYWNoIFdlYlJUQyBjb25uZWN0aW9uIHRvIHRoZSBKYW51cyBzZXJ2ZXIgd2lsbCBiZVxuICogYXNzb2NpYXRlZCB3aXRoIGEgc2luZ2xlIGhhbmRsZS4gT25jZSBhdHRhY2hlZCB0byB0aGUgc2VydmVyLCB0aGlzIGhhbmRsZSB3aWxsIGJlIGdpdmVuIGEgdW5pcXVlIElEIHdoaWNoIHNob3VsZCBiZVxuICogdXNlZCB0byBhc3NvY2lhdGUgaXQgd2l0aCBmdXR1cmUgc2lnbmFsbGluZyBtZXNzYWdlcy5cbiAqXG4gKiBTZWUgaHR0cHM6Ly9qYW51cy5jb25mLm1lZXRlY2hvLmNvbS9kb2NzL3Jlc3QuaHRtbCNoYW5kbGVzLlxuICoqL1xuZnVuY3Rpb24gSmFudXNQbHVnaW5IYW5kbGUoc2Vzc2lvbikge1xuICB0aGlzLnNlc3Npb24gPSBzZXNzaW9uO1xuICB0aGlzLmlkID0gdW5kZWZpbmVkO1xufVxuXG4vKiogQXR0YWNoZXMgdGhpcyBoYW5kbGUgdG8gdGhlIEphbnVzIHNlcnZlciBhbmQgc2V0cyBpdHMgSUQuICoqL1xuSmFudXNQbHVnaW5IYW5kbGUucHJvdG90eXBlLmF0dGFjaCA9IGZ1bmN0aW9uKHBsdWdpbiwgbG9vcF9pbmRleCkge1xuICB2YXIgcGF5bG9hZCA9IHsgcGx1Z2luOiBwbHVnaW4sIGxvb3BfaW5kZXg6IGxvb3BfaW5kZXgsIFwiZm9yY2UtYnVuZGxlXCI6IHRydWUsIFwiZm9yY2UtcnRjcC1tdXhcIjogdHJ1ZSB9O1xuICByZXR1cm4gdGhpcy5zZXNzaW9uLnNlbmQoXCJhdHRhY2hcIiwgcGF5bG9hZCkudGhlbihyZXNwID0+IHtcbiAgICB0aGlzLmlkID0gcmVzcC5kYXRhLmlkO1xuICAgIHJldHVybiByZXNwO1xuICB9KTtcbn07XG5cbi8qKiBEZXRhY2hlcyB0aGlzIGhhbmRsZS4gKiovXG5KYW51c1BsdWdpbkhhbmRsZS5wcm90b3R5cGUuZGV0YWNoID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLnNlbmQoXCJkZXRhY2hcIik7XG59O1xuXG4vKiogUmVnaXN0ZXJzIGEgY2FsbGJhY2sgdG8gYmUgZmlyZWQgdXBvbiB0aGUgcmVjZXB0aW9uIG9mIGFueSBpbmNvbWluZyBKYW51cyBzaWduYWxzIGZvciB0aGlzIHBsdWdpbiBoYW5kbGUgd2l0aCB0aGVcbiAqIGBqYW51c2AgYXR0cmlidXRlIGVxdWFsIHRvIGBldmAuXG4gKiovXG5KYW51c1BsdWdpbkhhbmRsZS5wcm90b3R5cGUub24gPSBmdW5jdGlvbihldiwgY2FsbGJhY2spIHtcbiAgcmV0dXJuIHRoaXMuc2Vzc2lvbi5vbihldiwgc2lnbmFsID0+IHtcbiAgICBpZiAoc2lnbmFsLnNlbmRlciA9PSB0aGlzLmlkKSB7XG4gICAgICBjYWxsYmFjayhzaWduYWwpO1xuICAgIH1cbiAgfSk7XG59O1xuXG4vKipcbiAqIFNlbmRzIGEgc2lnbmFsIGFzc29jaWF0ZWQgd2l0aCB0aGlzIGhhbmRsZS4gU2lnbmFscyBzaG91bGQgYmUgSlNPTi1zZXJpYWxpemFibGUgb2JqZWN0cy4gUmV0dXJucyBhIHByb21pc2UgdGhhdCB3aWxsXG4gKiBiZSByZXNvbHZlZCBvciByZWplY3RlZCB3aGVuIGEgcmVzcG9uc2UgdG8gdGhpcyBzaWduYWwgaXMgcmVjZWl2ZWQsIG9yIHdoZW4gbm8gcmVzcG9uc2UgaXMgcmVjZWl2ZWQgd2l0aGluIHRoZVxuICogc2Vzc2lvbiB0aW1lb3V0LlxuICoqL1xuSmFudXNQbHVnaW5IYW5kbGUucHJvdG90eXBlLnNlbmQgPSBmdW5jdGlvbih0eXBlLCBzaWduYWwpIHtcbiAgcmV0dXJuIHRoaXMuc2Vzc2lvbi5zZW5kKHR5cGUsIE9iamVjdC5hc3NpZ24oeyBoYW5kbGVfaWQ6IHRoaXMuaWQgfSwgc2lnbmFsKSk7XG59O1xuXG4vKiogU2VuZHMgYSBwbHVnaW4tc3BlY2lmaWMgbWVzc2FnZSBhc3NvY2lhdGVkIHdpdGggdGhpcyBoYW5kbGUuICoqL1xuSmFudXNQbHVnaW5IYW5kbGUucHJvdG90eXBlLnNlbmRNZXNzYWdlID0gZnVuY3Rpb24oYm9keSkge1xuICByZXR1cm4gdGhpcy5zZW5kKFwibWVzc2FnZVwiLCB7IGJvZHk6IGJvZHkgfSk7XG59O1xuXG4vKiogU2VuZHMgYSBKU0VQIG9mZmVyIG9yIGFuc3dlciBhc3NvY2lhdGVkIHdpdGggdGhpcyBoYW5kbGUuICoqL1xuSmFudXNQbHVnaW5IYW5kbGUucHJvdG90eXBlLnNlbmRKc2VwID0gZnVuY3Rpb24oanNlcCkge1xuICByZXR1cm4gdGhpcy5zZW5kKFwibWVzc2FnZVwiLCB7IGJvZHk6IHt9LCBqc2VwOiBqc2VwIH0pO1xufTtcblxuLyoqIFNlbmRzIGFuIElDRSB0cmlja2xlIGNhbmRpZGF0ZSBhc3NvY2lhdGVkIHdpdGggdGhpcyBoYW5kbGUuICoqL1xuSmFudXNQbHVnaW5IYW5kbGUucHJvdG90eXBlLnNlbmRUcmlja2xlID0gZnVuY3Rpb24oY2FuZGlkYXRlKSB7XG4gIHJldHVybiB0aGlzLnNlbmQoXCJ0cmlja2xlXCIsIHsgY2FuZGlkYXRlOiBjYW5kaWRhdGUgfSk7XG59O1xuXG4vKipcbiAqIFJlcHJlc2VudHMgYSBKYW51cyBzZXNzaW9uIC0tIGEgSmFudXMgY29udGV4dCBmcm9tIHdpdGhpbiB3aGljaCB5b3UgY2FuIG9wZW4gbXVsdGlwbGUgaGFuZGxlcyBhbmQgY29ubmVjdGlvbnMuIE9uY2VcbiAqIGNyZWF0ZWQsIHRoaXMgc2Vzc2lvbiB3aWxsIGJlIGdpdmVuIGEgdW5pcXVlIElEIHdoaWNoIHNob3VsZCBiZSB1c2VkIHRvIGFzc29jaWF0ZSBpdCB3aXRoIGZ1dHVyZSBzaWduYWxsaW5nIG1lc3NhZ2VzLlxuICpcbiAqIFNlZSBodHRwczovL2phbnVzLmNvbmYubWVldGVjaG8uY29tL2RvY3MvcmVzdC5odG1sI3Nlc3Npb25zLlxuICoqL1xuZnVuY3Rpb24gSmFudXNTZXNzaW9uKG91dHB1dCwgb3B0aW9ucykge1xuICB0aGlzLm91dHB1dCA9IG91dHB1dDtcbiAgdGhpcy5pZCA9IHVuZGVmaW5lZDtcbiAgdGhpcy5uZXh0VHhJZCA9IDA7XG4gIHRoaXMudHhucyA9IHt9O1xuICB0aGlzLmV2ZW50SGFuZGxlcnMgPSB7fTtcbiAgdGhpcy5vcHRpb25zID0gT2JqZWN0LmFzc2lnbih7XG4gICAgdmVyYm9zZTogZmFsc2UsXG4gICAgdGltZW91dE1zOiAxMDAwMCxcbiAgICBrZWVwYWxpdmVNczogMzAwMDBcbiAgfSwgb3B0aW9ucyk7XG59XG5cbi8qKiBDcmVhdGVzIHRoaXMgc2Vzc2lvbiBvbiB0aGUgSmFudXMgc2VydmVyIGFuZCBzZXRzIGl0cyBJRC4gKiovXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLmNyZWF0ZSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5zZW5kKFwiY3JlYXRlXCIpLnRoZW4ocmVzcCA9PiB7XG4gICAgdGhpcy5pZCA9IHJlc3AuZGF0YS5pZDtcbiAgICByZXR1cm4gcmVzcDtcbiAgfSk7XG59O1xuXG4vKipcbiAqIERlc3Ryb3lzIHRoaXMgc2Vzc2lvbi4gTm90ZSB0aGF0IHVwb24gZGVzdHJ1Y3Rpb24sIEphbnVzIHdpbGwgYWxzbyBjbG9zZSB0aGUgc2lnbmFsbGluZyB0cmFuc3BvcnQgKGlmIGFwcGxpY2FibGUpIGFuZFxuICogYW55IG9wZW4gV2ViUlRDIGNvbm5lY3Rpb25zLlxuICoqL1xuSmFudXNTZXNzaW9uLnByb3RvdHlwZS5kZXN0cm95ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLnNlbmQoXCJkZXN0cm95XCIpLnRoZW4oKHJlc3ApID0+IHtcbiAgICB0aGlzLmRpc3Bvc2UoKTtcbiAgICByZXR1cm4gcmVzcDtcbiAgfSk7XG59O1xuXG4vKipcbiAqIERpc3Bvc2VzIG9mIHRoaXMgc2Vzc2lvbiBpbiBhIHdheSBzdWNoIHRoYXQgbm8gZnVydGhlciBpbmNvbWluZyBzaWduYWxsaW5nIG1lc3NhZ2VzIHdpbGwgYmUgcHJvY2Vzc2VkLlxuICogT3V0c3RhbmRpbmcgdHJhbnNhY3Rpb25zIHdpbGwgYmUgcmVqZWN0ZWQuXG4gKiovXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLmRpc3Bvc2UgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5fa2lsbEtlZXBhbGl2ZSgpO1xuICB0aGlzLmV2ZW50SGFuZGxlcnMgPSB7fTtcbiAgZm9yICh2YXIgdHhJZCBpbiB0aGlzLnR4bnMpIHtcbiAgICBpZiAodGhpcy50eG5zLmhhc093blByb3BlcnR5KHR4SWQpKSB7XG4gICAgICB2YXIgdHhuID0gdGhpcy50eG5zW3R4SWRdO1xuICAgICAgY2xlYXJUaW1lb3V0KHR4bi50aW1lb3V0KTtcbiAgICAgIHR4bi5yZWplY3QobmV3IEVycm9yKFwiSmFudXMgc2Vzc2lvbiB3YXMgZGlzcG9zZWQuXCIpKTtcbiAgICAgIGRlbGV0ZSB0aGlzLnR4bnNbdHhJZF07XG4gICAgfVxuICB9XG59O1xuXG4vKipcbiAqIFdoZXRoZXIgdGhpcyBzaWduYWwgcmVwcmVzZW50cyBhbiBlcnJvciwgYW5kIHRoZSBhc3NvY2lhdGVkIHByb21pc2UgKGlmIGFueSkgc2hvdWxkIGJlIHJlamVjdGVkLlxuICogVXNlcnMgc2hvdWxkIG92ZXJyaWRlIHRoaXMgdG8gaGFuZGxlIGFueSBjdXN0b20gcGx1Z2luLXNwZWNpZmljIGVycm9yIGNvbnZlbnRpb25zLlxuICoqL1xuSmFudXNTZXNzaW9uLnByb3RvdHlwZS5pc0Vycm9yID0gZnVuY3Rpb24oc2lnbmFsKSB7XG4gIHJldHVybiBzaWduYWwuamFudXMgPT09IFwiZXJyb3JcIjtcbn07XG5cbi8qKiBSZWdpc3RlcnMgYSBjYWxsYmFjayB0byBiZSBmaXJlZCB1cG9uIHRoZSByZWNlcHRpb24gb2YgYW55IGluY29taW5nIEphbnVzIHNpZ25hbHMgZm9yIHRoaXMgc2Vzc2lvbiB3aXRoIHRoZVxuICogYGphbnVzYCBhdHRyaWJ1dGUgZXF1YWwgdG8gYGV2YC5cbiAqKi9cbkphbnVzU2Vzc2lvbi5wcm90b3R5cGUub24gPSBmdW5jdGlvbihldiwgY2FsbGJhY2spIHtcbiAgdmFyIGhhbmRsZXJzID0gdGhpcy5ldmVudEhhbmRsZXJzW2V2XTtcbiAgaWYgKGhhbmRsZXJzID09IG51bGwpIHtcbiAgICBoYW5kbGVycyA9IHRoaXMuZXZlbnRIYW5kbGVyc1tldl0gPSBbXTtcbiAgfVxuICBoYW5kbGVycy5wdXNoKGNhbGxiYWNrKTtcbn07XG5cbi8qKlxuICogQ2FsbGJhY2sgZm9yIHJlY2VpdmluZyBKU09OIHNpZ25hbGxpbmcgbWVzc2FnZXMgcGVydGluZW50IHRvIHRoaXMgc2Vzc2lvbi4gSWYgdGhlIHNpZ25hbHMgYXJlIHJlc3BvbnNlcyB0byBwcmV2aW91c2x5XG4gKiBzZW50IHNpZ25hbHMsIHRoZSBwcm9taXNlcyBmb3IgdGhlIG91dGdvaW5nIHNpZ25hbHMgd2lsbCBiZSByZXNvbHZlZCBvciByZWplY3RlZCBhcHByb3ByaWF0ZWx5IHdpdGggdGhpcyBzaWduYWwgYXMgYW5cbiAqIGFyZ3VtZW50LlxuICpcbiAqIEV4dGVybmFsIGNhbGxlcnMgc2hvdWxkIGNhbGwgdGhpcyBmdW5jdGlvbiBldmVyeSB0aW1lIGEgbmV3IHNpZ25hbCBhcnJpdmVzIG9uIHRoZSB0cmFuc3BvcnQ7IGZvciBleGFtcGxlLCBpbiBhXG4gKiBXZWJTb2NrZXQncyBgbWVzc2FnZWAgZXZlbnQsIG9yIHdoZW4gYSBuZXcgZGF0dW0gc2hvd3MgdXAgaW4gYW4gSFRUUCBsb25nLXBvbGxpbmcgcmVzcG9uc2UuXG4gKiovXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLnJlY2VpdmUgPSBmdW5jdGlvbihzaWduYWwpIHtcbiAgaWYgKHRoaXMub3B0aW9ucy52ZXJib3NlKSB7XG4gICAgdGhpcy5fbG9nSW5jb21pbmcoc2lnbmFsKTtcbiAgfVxuICBpZiAoc2lnbmFsLnNlc3Npb25faWQgIT0gdGhpcy5pZCkge1xuICAgIGNvbnNvbGUud2FybihcIkluY29ycmVjdCBzZXNzaW9uIElEIHJlY2VpdmVkIGluIEphbnVzIHNpZ25hbGxpbmcgbWVzc2FnZTogd2FzIFwiICsgc2lnbmFsLnNlc3Npb25faWQgKyBcIiwgZXhwZWN0ZWQgXCIgKyB0aGlzLmlkICsgXCIuXCIpO1xuICB9XG5cbiAgdmFyIHJlc3BvbnNlVHlwZSA9IHNpZ25hbC5qYW51cztcbiAgdmFyIGhhbmRsZXJzID0gdGhpcy5ldmVudEhhbmRsZXJzW3Jlc3BvbnNlVHlwZV07XG4gIGlmIChoYW5kbGVycyAhPSBudWxsKSB7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBoYW5kbGVycy5sZW5ndGg7IGkrKykge1xuICAgICAgaGFuZGxlcnNbaV0oc2lnbmFsKTtcbiAgICB9XG4gIH1cblxuICBpZiAoc2lnbmFsLnRyYW5zYWN0aW9uICE9IG51bGwpIHtcbiAgICB2YXIgdHhuID0gdGhpcy50eG5zW3NpZ25hbC50cmFuc2FjdGlvbl07XG4gICAgaWYgKHR4biA9PSBudWxsKSB7XG4gICAgICAvLyB0aGlzIGlzIGEgcmVzcG9uc2UgdG8gYSB0cmFuc2FjdGlvbiB0aGF0IHdhc24ndCBjYXVzZWQgdmlhIEphbnVzU2Vzc2lvbi5zZW5kLCBvciBhIHBsdWdpbiByZXBsaWVkIHR3aWNlIHRvIGFcbiAgICAgIC8vIHNpbmdsZSByZXF1ZXN0LCBvciB0aGUgc2Vzc2lvbiB3YXMgZGlzcG9zZWQsIG9yIHNvbWV0aGluZyBlbHNlIHRoYXQgaXNuJ3QgdW5kZXIgb3VyIHB1cnZpZXc7IHRoYXQncyBmaW5lXG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKHJlc3BvbnNlVHlwZSA9PT0gXCJhY2tcIiAmJiB0eG4udHlwZSA9PSBcIm1lc3NhZ2VcIikge1xuICAgICAgLy8gdGhpcyBpcyBhbiBhY2sgb2YgYW4gYXN5bmNocm9ub3VzbHktcHJvY2Vzc2VkIHBsdWdpbiByZXF1ZXN0LCB3ZSBzaG91bGQgd2FpdCB0byByZXNvbHZlIHRoZSBwcm9taXNlIHVudGlsIHRoZVxuICAgICAgLy8gYWN0dWFsIHJlc3BvbnNlIGNvbWVzIGluXG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY2xlYXJUaW1lb3V0KHR4bi50aW1lb3V0KTtcblxuICAgIGRlbGV0ZSB0aGlzLnR4bnNbc2lnbmFsLnRyYW5zYWN0aW9uXTtcbiAgICAodGhpcy5pc0Vycm9yKHNpZ25hbCkgPyB0eG4ucmVqZWN0IDogdHhuLnJlc29sdmUpKHNpZ25hbCk7XG4gIH1cbn07XG5cbi8qKlxuICogU2VuZHMgYSBzaWduYWwgYXNzb2NpYXRlZCB3aXRoIHRoaXMgc2Vzc2lvbiwgYmVnaW5uaW5nIGEgbmV3IHRyYW5zYWN0aW9uLiBSZXR1cm5zIGEgcHJvbWlzZSB0aGF0IHdpbGwgYmUgcmVzb2x2ZWQgb3JcbiAqIHJlamVjdGVkIHdoZW4gYSByZXNwb25zZSBpcyByZWNlaXZlZCBpbiB0aGUgc2FtZSB0cmFuc2FjdGlvbiwgb3Igd2hlbiBubyByZXNwb25zZSBpcyByZWNlaXZlZCB3aXRoaW4gdGhlIHNlc3Npb25cbiAqIHRpbWVvdXQuXG4gKiovXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLnNlbmQgPSBmdW5jdGlvbih0eXBlLCBzaWduYWwpIHtcbiAgc2lnbmFsID0gT2JqZWN0LmFzc2lnbih7IHRyYW5zYWN0aW9uOiAodGhpcy5uZXh0VHhJZCsrKS50b1N0cmluZygpIH0sIHNpZ25hbCk7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgdmFyIHRpbWVvdXQgPSBudWxsO1xuICAgIGlmICh0aGlzLm9wdGlvbnMudGltZW91dE1zKSB7XG4gICAgICB0aW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIGRlbGV0ZSB0aGlzLnR4bnNbc2lnbmFsLnRyYW5zYWN0aW9uXTtcbiAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihcIlNpZ25hbGxpbmcgdHJhbnNhY3Rpb24gd2l0aCB0eGlkIFwiICsgc2lnbmFsLnRyYW5zYWN0aW9uICsgXCIgdGltZWQgb3V0LlwiKSk7XG4gICAgICB9LCB0aGlzLm9wdGlvbnMudGltZW91dE1zKTtcbiAgICB9XG4gICAgdGhpcy50eG5zW3NpZ25hbC50cmFuc2FjdGlvbl0gPSB7IHJlc29sdmU6IHJlc29sdmUsIHJlamVjdDogcmVqZWN0LCB0aW1lb3V0OiB0aW1lb3V0LCB0eXBlOiB0eXBlIH07XG4gICAgdGhpcy5fdHJhbnNtaXQodHlwZSwgc2lnbmFsKTtcbiAgfSk7XG59O1xuXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLl90cmFuc21pdCA9IGZ1bmN0aW9uKHR5cGUsIHNpZ25hbCkge1xuICBzaWduYWwgPSBPYmplY3QuYXNzaWduKHsgamFudXM6IHR5cGUgfSwgc2lnbmFsKTtcblxuICBpZiAodGhpcy5pZCAhPSBudWxsKSB7IC8vIHRoaXMuaWQgaXMgdW5kZWZpbmVkIGluIHRoZSBzcGVjaWFsIGNhc2Ugd2hlbiB3ZSdyZSBzZW5kaW5nIHRoZSBzZXNzaW9uIGNyZWF0ZSBtZXNzYWdlXG4gICAgc2lnbmFsID0gT2JqZWN0LmFzc2lnbih7IHNlc3Npb25faWQ6IHRoaXMuaWQgfSwgc2lnbmFsKTtcbiAgfVxuXG4gIGlmICh0aGlzLm9wdGlvbnMudmVyYm9zZSkge1xuICAgIHRoaXMuX2xvZ091dGdvaW5nKHNpZ25hbCk7XG4gIH1cblxuICB0aGlzLm91dHB1dChKU09OLnN0cmluZ2lmeShzaWduYWwpKTtcbiAgdGhpcy5fcmVzZXRLZWVwYWxpdmUoKTtcbn07XG5cbkphbnVzU2Vzc2lvbi5wcm90b3R5cGUuX2xvZ091dGdvaW5nID0gZnVuY3Rpb24oc2lnbmFsKSB7XG4gIHZhciBraW5kID0gc2lnbmFsLmphbnVzO1xuICBpZiAoa2luZCA9PT0gXCJtZXNzYWdlXCIgJiYgc2lnbmFsLmpzZXApIHtcbiAgICBraW5kID0gc2lnbmFsLmpzZXAudHlwZTtcbiAgfVxuICB2YXIgbWVzc2FnZSA9IFwiPiBPdXRnb2luZyBKYW51cyBcIiArIChraW5kIHx8IFwic2lnbmFsXCIpICsgXCIgKCNcIiArIHNpZ25hbC50cmFuc2FjdGlvbiArIFwiKTogXCI7XG4gIGNvbnNvbGUuZGVidWcoXCIlY1wiICsgbWVzc2FnZSwgXCJjb2xvcjogIzA0MFwiLCBzaWduYWwpO1xufTtcblxuSmFudXNTZXNzaW9uLnByb3RvdHlwZS5fbG9nSW5jb21pbmcgPSBmdW5jdGlvbihzaWduYWwpIHtcbiAgdmFyIGtpbmQgPSBzaWduYWwuamFudXM7XG4gIHZhciBtZXNzYWdlID0gc2lnbmFsLnRyYW5zYWN0aW9uID9cbiAgICAgIFwiPCBJbmNvbWluZyBKYW51cyBcIiArIChraW5kIHx8IFwic2lnbmFsXCIpICsgXCIgKCNcIiArIHNpZ25hbC50cmFuc2FjdGlvbiArIFwiKTogXCIgOlxuICAgICAgXCI8IEluY29taW5nIEphbnVzIFwiICsgKGtpbmQgfHwgXCJzaWduYWxcIikgKyBcIjogXCI7XG4gIGNvbnNvbGUuZGVidWcoXCIlY1wiICsgbWVzc2FnZSwgXCJjb2xvcjogIzAwNFwiLCBzaWduYWwpO1xufTtcblxuSmFudXNTZXNzaW9uLnByb3RvdHlwZS5fc2VuZEtlZXBhbGl2ZSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5zZW5kKFwia2VlcGFsaXZlXCIpO1xufTtcblxuSmFudXNTZXNzaW9uLnByb3RvdHlwZS5fa2lsbEtlZXBhbGl2ZSA9IGZ1bmN0aW9uKCkge1xuICBjbGVhclRpbWVvdXQodGhpcy5rZWVwYWxpdmVUaW1lb3V0KTtcbn07XG5cbkphbnVzU2Vzc2lvbi5wcm90b3R5cGUuX3Jlc2V0S2VlcGFsaXZlID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuX2tpbGxLZWVwYWxpdmUoKTtcbiAgaWYgKHRoaXMub3B0aW9ucy5rZWVwYWxpdmVNcykge1xuICAgIHRoaXMua2VlcGFsaXZlVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy5fc2VuZEtlZXBhbGl2ZSgpLmNhdGNoKGUgPT4gY29uc29sZS5lcnJvcihcIkVycm9yIHJlY2VpdmVkIGZyb20ga2VlcGFsaXZlOiBcIiwgZSkpO1xuICAgIH0sIHRoaXMub3B0aW9ucy5rZWVwYWxpdmVNcyk7XG4gIH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBKYW51c1BsdWdpbkhhbmRsZSxcbiAgSmFudXNTZXNzaW9uXG59O1xuIiwiLyogZ2xvYmFsIE5BRiAqL1xudmFyIG1qID0gcmVxdWlyZShcIkBuZXR3b3JrZWQtYWZyYW1lL21pbmlqYW51c1wiKTtcbm1qLkphbnVzU2Vzc2lvbi5wcm90b3R5cGUuc2VuZE9yaWdpbmFsID0gbWouSmFudXNTZXNzaW9uLnByb3RvdHlwZS5zZW5kO1xubWouSmFudXNTZXNzaW9uLnByb3RvdHlwZS5zZW5kID0gZnVuY3Rpb24odHlwZSwgc2lnbmFsKSB7XG4gIHJldHVybiB0aGlzLnNlbmRPcmlnaW5hbCh0eXBlLCBzaWduYWwpLmNhdGNoKChlKSA9PiB7XG4gICAgaWYgKGUubWVzc2FnZSAmJiBlLm1lc3NhZ2UuaW5kZXhPZihcInRpbWVkIG91dFwiKSA+IC0xKSB7XG4gICAgICBjb25zb2xlLmVycm9yKFwid2ViIHNvY2tldCB0aW1lZCBvdXRcIik7XG4gICAgICBOQUYuY29ubmVjdGlvbi5hZGFwdGVyLnJlY29ubmVjdCgpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyhlKTtcbiAgICB9XG4gIH0pO1xufVxuXG52YXIgc2RwVXRpbHMgPSByZXF1aXJlKFwic2RwXCIpO1xudmFyIGRlYnVnID0gcmVxdWlyZShcImRlYnVnXCIpKFwibmFmLWphbnVzLWFkYXB0ZXI6ZGVidWdcIik7XG52YXIgd2FybiA9IHJlcXVpcmUoXCJkZWJ1Z1wiKShcIm5hZi1qYW51cy1hZGFwdGVyOndhcm5cIik7XG52YXIgZXJyb3IgPSByZXF1aXJlKFwiZGVidWdcIikoXCJuYWYtamFudXMtYWRhcHRlcjplcnJvclwiKTtcbnZhciBpc1NhZmFyaSA9IC9eKCg/IWNocm9tZXxhbmRyb2lkKS4pKnNhZmFyaS9pLnRlc3QobmF2aWdhdG9yLnVzZXJBZ2VudCk7XG5cbmNvbnN0IFNVQlNDUklCRV9USU1FT1VUX01TID0gMTUwMDA7XG5cbmNvbnN0IEFWQUlMQUJMRV9PQ0NVUEFOVFNfVEhSRVNIT0xEID0gNTtcbmNvbnN0IE1BWF9TVUJTQ1JJQkVfREVMQVkgPSA1MDAwO1xuXG5mdW5jdGlvbiByYW5kb21EZWxheShtaW4sIG1heCkge1xuICByZXR1cm4gbmV3IFByb21pc2UocmVzb2x2ZSA9PiB7XG4gICAgY29uc3QgZGVsYXkgPSBNYXRoLnJhbmRvbSgpICogKG1heCAtIG1pbikgKyBtaW47XG4gICAgc2V0VGltZW91dChyZXNvbHZlLCBkZWxheSk7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBkZWJvdW5jZShmbikge1xuICB2YXIgY3VyciA9IFByb21pc2UucmVzb2x2ZSgpO1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIGFyZ3MgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMpO1xuICAgIGN1cnIgPSBjdXJyLnRoZW4oXyA9PiBmbi5hcHBseSh0aGlzLCBhcmdzKSk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIHJhbmRvbVVpbnQoKSB7XG4gIHJldHVybiBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiBOdW1iZXIuTUFYX1NBRkVfSU5URUdFUik7XG59XG5cbmZ1bmN0aW9uIHVudGlsRGF0YUNoYW5uZWxPcGVuKGRhdGFDaGFubmVsKSB7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgaWYgKGRhdGFDaGFubmVsLnJlYWR5U3RhdGUgPT09IFwib3BlblwiKSB7XG4gICAgICByZXNvbHZlKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGxldCByZXNvbHZlciwgcmVqZWN0b3I7XG5cbiAgICAgIGNvbnN0IGNsZWFyID0gKCkgPT4ge1xuICAgICAgICBkYXRhQ2hhbm5lbC5yZW1vdmVFdmVudExpc3RlbmVyKFwib3BlblwiLCByZXNvbHZlcik7XG4gICAgICAgIGRhdGFDaGFubmVsLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJlcnJvclwiLCByZWplY3Rvcik7XG4gICAgICB9O1xuXG4gICAgICByZXNvbHZlciA9ICgpID0+IHtcbiAgICAgICAgY2xlYXIoKTtcbiAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgfTtcbiAgICAgIHJlamVjdG9yID0gKCkgPT4ge1xuICAgICAgICBjbGVhcigpO1xuICAgICAgICByZWplY3QoKTtcbiAgICAgIH07XG5cbiAgICAgIGRhdGFDaGFubmVsLmFkZEV2ZW50TGlzdGVuZXIoXCJvcGVuXCIsIHJlc29sdmVyKTtcbiAgICAgIGRhdGFDaGFubmVsLmFkZEV2ZW50TGlzdGVuZXIoXCJlcnJvclwiLCByZWplY3Rvcik7XG4gICAgfVxuICB9KTtcbn1cblxuY29uc3QgaXNIMjY0VmlkZW9TdXBwb3J0ZWQgPSAoKCkgPT4ge1xuICBjb25zdCB2aWRlbyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJ2aWRlb1wiKTtcbiAgcmV0dXJuIHZpZGVvLmNhblBsYXlUeXBlKCd2aWRlby9tcDQ7IGNvZGVjcz1cImF2YzEuNDJFMDFFLCBtcDRhLjQwLjJcIicpICE9PSBcIlwiO1xufSkoKTtcblxuY29uc3QgT1BVU19QQVJBTUVURVJTID0ge1xuICAvLyBpbmRpY2F0ZXMgdGhhdCB3ZSB3YW50IHRvIGVuYWJsZSBEVFggdG8gZWxpZGUgc2lsZW5jZSBwYWNrZXRzXG4gIHVzZWR0eDogMSxcbiAgLy8gaW5kaWNhdGVzIHRoYXQgd2UgcHJlZmVyIHRvIHJlY2VpdmUgbW9ubyBhdWRpbyAoaW1wb3J0YW50IGZvciB2b2lwIHByb2ZpbGUpXG4gIHN0ZXJlbzogMCxcbiAgLy8gaW5kaWNhdGVzIHRoYXQgd2UgcHJlZmVyIHRvIHNlbmQgbW9ubyBhdWRpbyAoaW1wb3J0YW50IGZvciB2b2lwIHByb2ZpbGUpXG4gIFwic3Byb3Atc3RlcmVvXCI6IDBcbn07XG5cbmNvbnN0IERFRkFVTFRfUEVFUl9DT05ORUNUSU9OX0NPTkZJRyA9IHtcbiAgaWNlU2VydmVyczogW3sgdXJsczogXCJzdHVuOnN0dW4xLmwuZ29vZ2xlLmNvbToxOTMwMlwiIH0sIHsgdXJsczogXCJzdHVuOnN0dW4yLmwuZ29vZ2xlLmNvbToxOTMwMlwiIH1dXG59O1xuXG5jb25zdCBXU19OT1JNQUxfQ0xPU1VSRSA9IDEwMDA7XG5cbmNsYXNzIEphbnVzQWRhcHRlciB7XG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHRoaXMucm9vbSA9IG51bGw7XG4gICAgLy8gV2UgZXhwZWN0IHRoZSBjb25zdW1lciB0byBzZXQgYSBjbGllbnQgaWQgYmVmb3JlIGNvbm5lY3RpbmcuXG4gICAgdGhpcy5jbGllbnRJZCA9IG51bGw7XG4gICAgdGhpcy5qb2luVG9rZW4gPSBudWxsO1xuXG4gICAgdGhpcy5zZXJ2ZXJVcmwgPSBudWxsO1xuICAgIHRoaXMud2ViUnRjT3B0aW9ucyA9IHt9O1xuICAgIHRoaXMucGVlckNvbm5lY3Rpb25Db25maWcgPSBudWxsO1xuICAgIHRoaXMud3MgPSBudWxsO1xuICAgIHRoaXMuc2Vzc2lvbiA9IG51bGw7XG4gICAgdGhpcy5yZWxpYWJsZVRyYW5zcG9ydCA9IFwiZGF0YWNoYW5uZWxcIjtcbiAgICB0aGlzLnVucmVsaWFibGVUcmFuc3BvcnQgPSBcImRhdGFjaGFubmVsXCI7XG5cbiAgICAvLyBJbiB0aGUgZXZlbnQgdGhlIHNlcnZlciByZXN0YXJ0cyBhbmQgYWxsIGNsaWVudHMgbG9zZSBjb25uZWN0aW9uLCByZWNvbm5lY3Qgd2l0aFxuICAgIC8vIHNvbWUgcmFuZG9tIGppdHRlciBhZGRlZCB0byBwcmV2ZW50IHNpbXVsdGFuZW91cyByZWNvbm5lY3Rpb24gcmVxdWVzdHMuXG4gICAgdGhpcy5pbml0aWFsUmVjb25uZWN0aW9uRGVsYXkgPSAxMDAwICogTWF0aC5yYW5kb20oKTtcbiAgICB0aGlzLnJlY29ubmVjdGlvbkRlbGF5ID0gdGhpcy5pbml0aWFsUmVjb25uZWN0aW9uRGVsYXk7XG4gICAgdGhpcy5yZWNvbm5lY3Rpb25UaW1lb3V0ID0gbnVsbDtcbiAgICB0aGlzLm1heFJlY29ubmVjdGlvbkF0dGVtcHRzID0gMTA7XG4gICAgdGhpcy5yZWNvbm5lY3Rpb25BdHRlbXB0cyA9IDA7XG5cbiAgICB0aGlzLnB1Ymxpc2hlciA9IG51bGw7XG4gICAgdGhpcy5vY2N1cGFudElkcyA9IFtdO1xuICAgIHRoaXMub2NjdXBhbnRzID0ge307XG4gICAgdGhpcy5tZWRpYVN0cmVhbXMgPSB7fTtcbiAgICB0aGlzLmxvY2FsTWVkaWFTdHJlYW0gPSBudWxsO1xuICAgIHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMgPSBuZXcgTWFwKCk7XG5cbiAgICB0aGlzLnBlbmRpbmdPY2N1cGFudHMgPSBuZXcgU2V0KCk7XG4gICAgdGhpcy5hdmFpbGFibGVPY2N1cGFudHMgPSBbXTtcbiAgICB0aGlzLnJlcXVlc3RlZE9jY3VwYW50cyA9IG51bGw7XG5cbiAgICB0aGlzLmJsb2NrZWRDbGllbnRzID0gbmV3IE1hcCgpO1xuICAgIHRoaXMuZnJvemVuVXBkYXRlcyA9IG5ldyBNYXAoKTtcblxuICAgIHRoaXMudGltZU9mZnNldHMgPSBbXTtcbiAgICB0aGlzLnNlcnZlclRpbWVSZXF1ZXN0cyA9IDA7XG4gICAgdGhpcy5hdmdUaW1lT2Zmc2V0ID0gMDtcblxuICAgIHRoaXMub25XZWJzb2NrZXRPcGVuID0gdGhpcy5vbldlYnNvY2tldE9wZW4uYmluZCh0aGlzKTtcbiAgICB0aGlzLm9uV2Vic29ja2V0Q2xvc2UgPSB0aGlzLm9uV2Vic29ja2V0Q2xvc2UuYmluZCh0aGlzKTtcbiAgICB0aGlzLm9uV2Vic29ja2V0TWVzc2FnZSA9IHRoaXMub25XZWJzb2NrZXRNZXNzYWdlLmJpbmQodGhpcyk7XG4gICAgdGhpcy5vbkRhdGFDaGFubmVsTWVzc2FnZSA9IHRoaXMub25EYXRhQ2hhbm5lbE1lc3NhZ2UuYmluZCh0aGlzKTtcbiAgICB0aGlzLm9uRGF0YSA9IHRoaXMub25EYXRhLmJpbmQodGhpcyk7XG4gIH1cblxuICBzZXRTZXJ2ZXJVcmwodXJsKSB7XG4gICAgdGhpcy5zZXJ2ZXJVcmwgPSB1cmw7XG4gIH1cblxuICBzZXRBcHAoYXBwKSB7fVxuXG4gIHNldFJvb20ocm9vbU5hbWUpIHtcbiAgICB0aGlzLnJvb20gPSByb29tTmFtZTtcbiAgfVxuXG4gIHNldEpvaW5Ub2tlbihqb2luVG9rZW4pIHtcbiAgICB0aGlzLmpvaW5Ub2tlbiA9IGpvaW5Ub2tlbjtcbiAgfVxuXG4gIHNldENsaWVudElkKGNsaWVudElkKSB7XG4gICAgdGhpcy5jbGllbnRJZCA9IGNsaWVudElkO1xuICB9XG5cbiAgc2V0V2ViUnRjT3B0aW9ucyhvcHRpb25zKSB7XG4gICAgdGhpcy53ZWJSdGNPcHRpb25zID0gb3B0aW9ucztcbiAgfVxuXG4gIHNldFBlZXJDb25uZWN0aW9uQ29uZmlnKHBlZXJDb25uZWN0aW9uQ29uZmlnKSB7XG4gICAgdGhpcy5wZWVyQ29ubmVjdGlvbkNvbmZpZyA9IHBlZXJDb25uZWN0aW9uQ29uZmlnO1xuICB9XG5cbiAgc2V0U2VydmVyQ29ubmVjdExpc3RlbmVycyhzdWNjZXNzTGlzdGVuZXIsIGZhaWx1cmVMaXN0ZW5lcikge1xuICAgIHRoaXMuY29ubmVjdFN1Y2Nlc3MgPSBzdWNjZXNzTGlzdGVuZXI7XG4gICAgdGhpcy5jb25uZWN0RmFpbHVyZSA9IGZhaWx1cmVMaXN0ZW5lcjtcbiAgfVxuXG4gIHNldFJvb21PY2N1cGFudExpc3RlbmVyKG9jY3VwYW50TGlzdGVuZXIpIHtcbiAgICB0aGlzLm9uT2NjdXBhbnRzQ2hhbmdlZCA9IG9jY3VwYW50TGlzdGVuZXI7XG4gIH1cblxuICBzZXREYXRhQ2hhbm5lbExpc3RlbmVycyhvcGVuTGlzdGVuZXIsIGNsb3NlZExpc3RlbmVyLCBtZXNzYWdlTGlzdGVuZXIpIHtcbiAgICB0aGlzLm9uT2NjdXBhbnRDb25uZWN0ZWQgPSBvcGVuTGlzdGVuZXI7XG4gICAgdGhpcy5vbk9jY3VwYW50RGlzY29ubmVjdGVkID0gY2xvc2VkTGlzdGVuZXI7XG4gICAgdGhpcy5vbk9jY3VwYW50TWVzc2FnZSA9IG1lc3NhZ2VMaXN0ZW5lcjtcbiAgfVxuXG4gIHNldFJlY29ubmVjdGlvbkxpc3RlbmVycyhyZWNvbm5lY3RpbmdMaXN0ZW5lciwgcmVjb25uZWN0ZWRMaXN0ZW5lciwgcmVjb25uZWN0aW9uRXJyb3JMaXN0ZW5lcikge1xuICAgIC8vIG9uUmVjb25uZWN0aW5nIGlzIGNhbGxlZCB3aXRoIHRoZSBudW1iZXIgb2YgbWlsbGlzZWNvbmRzIHVudGlsIHRoZSBuZXh0IHJlY29ubmVjdGlvbiBhdHRlbXB0XG4gICAgdGhpcy5vblJlY29ubmVjdGluZyA9IHJlY29ubmVjdGluZ0xpc3RlbmVyO1xuICAgIC8vIG9uUmVjb25uZWN0ZWQgaXMgY2FsbGVkIHdoZW4gdGhlIGNvbm5lY3Rpb24gaGFzIGJlZW4gcmVlc3RhYmxpc2hlZFxuICAgIHRoaXMub25SZWNvbm5lY3RlZCA9IHJlY29ubmVjdGVkTGlzdGVuZXI7XG4gICAgLy8gb25SZWNvbm5lY3Rpb25FcnJvciBpcyBjYWxsZWQgd2l0aCBhbiBlcnJvciB3aGVuIG1heFJlY29ubmVjdGlvbkF0dGVtcHRzIGhhcyBiZWVuIHJlYWNoZWRcbiAgICB0aGlzLm9uUmVjb25uZWN0aW9uRXJyb3IgPSByZWNvbm5lY3Rpb25FcnJvckxpc3RlbmVyO1xuICB9XG5cbiAgc2V0RXZlbnRMb29wcyhsb29wcykge1xuICAgIHRoaXMubG9vcHMgPSBsb29wcztcbiAgfVxuXG4gIGNvbm5lY3QoKSB7XG4gICAgZGVidWcoYGNvbm5lY3RpbmcgdG8gJHt0aGlzLnNlcnZlclVybH1gKTtcblxuICAgIGNvbnN0IHdlYnNvY2tldENvbm5lY3Rpb24gPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICB0aGlzLndzID0gbmV3IFdlYlNvY2tldCh0aGlzLnNlcnZlclVybCwgXCJqYW51cy1wcm90b2NvbFwiKTtcblxuICAgICAgdGhpcy5zZXNzaW9uID0gbmV3IG1qLkphbnVzU2Vzc2lvbih0aGlzLndzLnNlbmQuYmluZCh0aGlzLndzKSwgeyB0aW1lb3V0TXM6IDQwMDAwIH0pO1xuXG4gICAgICB0aGlzLndzLmFkZEV2ZW50TGlzdGVuZXIoXCJjbG9zZVwiLCB0aGlzLm9uV2Vic29ja2V0Q2xvc2UpO1xuICAgICAgdGhpcy53cy5hZGRFdmVudExpc3RlbmVyKFwibWVzc2FnZVwiLCB0aGlzLm9uV2Vic29ja2V0TWVzc2FnZSk7XG5cbiAgICAgIHRoaXMud3NPbk9wZW4gPSAoKSA9PiB7XG4gICAgICAgIHRoaXMud3MucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm9wZW5cIiwgdGhpcy53c09uT3Blbik7XG4gICAgICAgIHRoaXMub25XZWJzb2NrZXRPcGVuKClcbiAgICAgICAgICAudGhlbihyZXNvbHZlKVxuICAgICAgICAgIC5jYXRjaChyZWplY3QpO1xuICAgICAgfTtcblxuICAgICAgdGhpcy53cy5hZGRFdmVudExpc3RlbmVyKFwib3BlblwiLCB0aGlzLndzT25PcGVuKTtcbiAgICB9KTtcblxuICAgIHJldHVybiBQcm9taXNlLmFsbChbd2Vic29ja2V0Q29ubmVjdGlvbiwgdGhpcy51cGRhdGVUaW1lT2Zmc2V0KCldKTtcbiAgfVxuXG4gIGRpc2Nvbm5lY3QoKSB7XG4gICAgZGVidWcoYGRpc2Nvbm5lY3RpbmdgKTtcblxuICAgIGNsZWFyVGltZW91dCh0aGlzLnJlY29ubmVjdGlvblRpbWVvdXQpO1xuXG4gICAgdGhpcy5yZW1vdmVBbGxPY2N1cGFudHMoKTtcblxuICAgIGlmICh0aGlzLnB1Ymxpc2hlcikge1xuICAgICAgLy8gQ2xvc2UgdGhlIHB1Ymxpc2hlciBwZWVyIGNvbm5lY3Rpb24uIFdoaWNoIGFsc28gZGV0YWNoZXMgdGhlIHBsdWdpbiBoYW5kbGUuXG4gICAgICB0aGlzLnB1Ymxpc2hlci5jb25uLmNsb3NlKCk7XG4gICAgICB0aGlzLnB1Ymxpc2hlciA9IG51bGw7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuc2Vzc2lvbikge1xuICAgICAgdGhpcy5zZXNzaW9uLmRpc3Bvc2UoKTtcbiAgICAgIHRoaXMuc2Vzc2lvbiA9IG51bGw7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMud3MpIHtcbiAgICAgIHRoaXMud3MucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm9wZW5cIiwgdGhpcy53c09uT3Blbik7XG4gICAgICB0aGlzLndzLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJjbG9zZVwiLCB0aGlzLm9uV2Vic29ja2V0Q2xvc2UpO1xuICAgICAgdGhpcy53cy5yZW1vdmVFdmVudExpc3RlbmVyKFwibWVzc2FnZVwiLCB0aGlzLm9uV2Vic29ja2V0TWVzc2FnZSk7XG4gICAgICB0aGlzLndzLmNsb3NlKCk7XG4gICAgICB0aGlzLndzID0gbnVsbDtcbiAgICB9XG5cbiAgICAvLyBOb3cgdGhhdCBhbGwgUlRDUGVlckNvbm5lY3Rpb24gY2xvc2VkLCBiZSBzdXJlIHRvIG5vdCBjYWxsXG4gICAgLy8gcmVjb25uZWN0KCkgYWdhaW4gdmlhIHBlcmZvcm1EZWxheWVkUmVjb25uZWN0IGlmIHByZXZpb3VzXG4gICAgLy8gUlRDUGVlckNvbm5lY3Rpb24gd2FzIGluIHRoZSBmYWlsZWQgc3RhdGUuXG4gICAgaWYgKHRoaXMuZGVsYXllZFJlY29ubmVjdFRpbWVvdXQpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLmRlbGF5ZWRSZWNvbm5lY3RUaW1lb3V0KTtcbiAgICAgIHRoaXMuZGVsYXllZFJlY29ubmVjdFRpbWVvdXQgPSBudWxsO1xuICAgIH1cbiAgfVxuXG4gIGlzRGlzY29ubmVjdGVkKCkge1xuICAgIHJldHVybiB0aGlzLndzID09PSBudWxsO1xuICB9XG5cbiAgYXN5bmMgb25XZWJzb2NrZXRPcGVuKCkge1xuICAgIC8vIENyZWF0ZSB0aGUgSmFudXMgU2Vzc2lvblxuICAgIGF3YWl0IHRoaXMuc2Vzc2lvbi5jcmVhdGUoKTtcblxuICAgIC8vIEF0dGFjaCB0aGUgU0ZVIFBsdWdpbiBhbmQgY3JlYXRlIGEgUlRDUGVlckNvbm5lY3Rpb24gZm9yIHRoZSBwdWJsaXNoZXIuXG4gICAgLy8gVGhlIHB1Ymxpc2hlciBzZW5kcyBhdWRpbyBhbmQgb3BlbnMgdHdvIGJpZGlyZWN0aW9uYWwgZGF0YSBjaGFubmVscy5cbiAgICAvLyBPbmUgcmVsaWFibGUgZGF0YWNoYW5uZWwgYW5kIG9uZSB1bnJlbGlhYmxlLlxuICAgIHRoaXMucHVibGlzaGVyID0gYXdhaXQgdGhpcy5jcmVhdGVQdWJsaXNoZXIoKTtcblxuICAgIC8vIENhbGwgdGhlIG5hZiBjb25uZWN0U3VjY2VzcyBjYWxsYmFjayBiZWZvcmUgd2Ugc3RhcnQgcmVjZWl2aW5nIFdlYlJUQyBtZXNzYWdlcy5cbiAgICB0aGlzLmNvbm5lY3RTdWNjZXNzKHRoaXMuY2xpZW50SWQpO1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aGlzLnB1Ymxpc2hlci5pbml0aWFsT2NjdXBhbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBjb25zdCBvY2N1cGFudElkID0gdGhpcy5wdWJsaXNoZXIuaW5pdGlhbE9jY3VwYW50c1tpXTtcbiAgICAgIGlmIChvY2N1cGFudElkID09PSB0aGlzLmNsaWVudElkKSBjb250aW51ZTsgLy8gSGFwcGVucyBkdXJpbmcgbm9uLWdyYWNlZnVsIHJlY29ubmVjdHMgZHVlIHRvIHpvbWJpZSBzZXNzaW9uc1xuICAgICAgdGhpcy5hZGRBdmFpbGFibGVPY2N1cGFudChvY2N1cGFudElkKTtcbiAgICB9XG5cbiAgICB0aGlzLnN5bmNPY2N1cGFudHMoKTtcbiAgfVxuXG4gIG9uV2Vic29ja2V0Q2xvc2UoZXZlbnQpIHtcbiAgICAvLyBUaGUgY29ubmVjdGlvbiB3YXMgY2xvc2VkIHN1Y2Nlc3NmdWxseS4gRG9uJ3QgdHJ5IHRvIHJlY29ubmVjdC5cbiAgICBpZiAoZXZlbnQuY29kZSA9PT0gV1NfTk9STUFMX0NMT1NVUkUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zb2xlLndhcm4oXCJKYW51cyB3ZWJzb2NrZXQgY2xvc2VkIHVuZXhwZWN0ZWRseS5cIik7XG4gICAgaWYgKHRoaXMub25SZWNvbm5lY3RpbmcpIHtcbiAgICAgIHRoaXMub25SZWNvbm5lY3RpbmcodGhpcy5yZWNvbm5lY3Rpb25EZWxheSk7XG4gICAgfVxuXG4gICAgdGhpcy5yZWNvbm5lY3Rpb25UaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB0aGlzLnJlY29ubmVjdCgpLCB0aGlzLnJlY29ubmVjdGlvbkRlbGF5KTtcbiAgfVxuXG4gIHJlY29ubmVjdCgpIHtcbiAgICAvLyBEaXNwb3NlIG9mIGFsbCBuZXR3b3JrZWQgZW50aXRpZXMgYW5kIG90aGVyIHJlc291cmNlcyB0aWVkIHRvIHRoZSBzZXNzaW9uLlxuICAgIHRoaXMuZGlzY29ubmVjdCgpO1xuXG4gICAgdGhpcy5jb25uZWN0KClcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgdGhpcy5yZWNvbm5lY3Rpb25EZWxheSA9IHRoaXMuaW5pdGlhbFJlY29ubmVjdGlvbkRlbGF5O1xuICAgICAgICB0aGlzLnJlY29ubmVjdGlvbkF0dGVtcHRzID0gMDtcblxuICAgICAgICBpZiAodGhpcy5vblJlY29ubmVjdGVkKSB7XG4gICAgICAgICAgdGhpcy5vblJlY29ubmVjdGVkKCk7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICB0aGlzLnJlY29ubmVjdGlvbkRlbGF5ICs9IDEwMDA7XG4gICAgICAgIHRoaXMucmVjb25uZWN0aW9uQXR0ZW1wdHMrKztcblxuICAgICAgICBpZiAodGhpcy5yZWNvbm5lY3Rpb25BdHRlbXB0cyA+IHRoaXMubWF4UmVjb25uZWN0aW9uQXR0ZW1wdHMgJiYgdGhpcy5vblJlY29ubmVjdGlvbkVycm9yKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMub25SZWNvbm5lY3Rpb25FcnJvcihcbiAgICAgICAgICAgIG5ldyBFcnJvcihcIkNvbm5lY3Rpb24gY291bGQgbm90IGJlIHJlZXN0YWJsaXNoZWQsIGV4Y2VlZGVkIG1heGltdW0gbnVtYmVyIG9mIHJlY29ubmVjdGlvbiBhdHRlbXB0cy5cIilcbiAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc29sZS53YXJuKFwiRXJyb3IgZHVyaW5nIHJlY29ubmVjdCwgcmV0cnlpbmcuXCIpO1xuICAgICAgICBjb25zb2xlLndhcm4oZXJyb3IpO1xuXG4gICAgICAgIGlmICh0aGlzLm9uUmVjb25uZWN0aW5nKSB7XG4gICAgICAgICAgdGhpcy5vblJlY29ubmVjdGluZyh0aGlzLnJlY29ubmVjdGlvbkRlbGF5KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMucmVjb25uZWN0aW9uVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4gdGhpcy5yZWNvbm5lY3QoKSwgdGhpcy5yZWNvbm5lY3Rpb25EZWxheSk7XG4gICAgICB9KTtcbiAgfVxuXG4gIHBlcmZvcm1EZWxheWVkUmVjb25uZWN0KCkge1xuICAgIGlmICh0aGlzLmRlbGF5ZWRSZWNvbm5lY3RUaW1lb3V0KSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5kZWxheWVkUmVjb25uZWN0VGltZW91dCk7XG4gICAgfVxuXG4gICAgdGhpcy5kZWxheWVkUmVjb25uZWN0VGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy5kZWxheWVkUmVjb25uZWN0VGltZW91dCA9IG51bGw7XG4gICAgICB0aGlzLnJlY29ubmVjdCgpO1xuICAgIH0sIDEwMDAwKTtcbiAgfVxuXG4gIG9uV2Vic29ja2V0TWVzc2FnZShldmVudCkge1xuICAgIHRoaXMuc2Vzc2lvbi5yZWNlaXZlKEpTT04ucGFyc2UoZXZlbnQuZGF0YSkpO1xuICB9XG5cbiAgYWRkQXZhaWxhYmxlT2NjdXBhbnQob2NjdXBhbnRJZCkge1xuICAgIGlmICh0aGlzLmF2YWlsYWJsZU9jY3VwYW50cy5pbmRleE9mKG9jY3VwYW50SWQpID09PSAtMSkge1xuICAgICAgdGhpcy5hdmFpbGFibGVPY2N1cGFudHMucHVzaChvY2N1cGFudElkKTtcbiAgICB9XG4gIH1cblxuICByZW1vdmVBdmFpbGFibGVPY2N1cGFudChvY2N1cGFudElkKSB7XG4gICAgY29uc3QgaWR4ID0gdGhpcy5hdmFpbGFibGVPY2N1cGFudHMuaW5kZXhPZihvY2N1cGFudElkKTtcbiAgICBpZiAoaWR4ICE9PSAtMSkge1xuICAgICAgdGhpcy5hdmFpbGFibGVPY2N1cGFudHMuc3BsaWNlKGlkeCwgMSk7XG4gICAgfVxuICB9XG5cbiAgc3luY09jY3VwYW50cyhyZXF1ZXN0ZWRPY2N1cGFudHMpIHtcbiAgICBpZiAocmVxdWVzdGVkT2NjdXBhbnRzKSB7XG4gICAgICB0aGlzLnJlcXVlc3RlZE9jY3VwYW50cyA9IHJlcXVlc3RlZE9jY3VwYW50cztcbiAgICB9XG5cbiAgICBpZiAoIXRoaXMucmVxdWVzdGVkT2NjdXBhbnRzKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gQWRkIGFueSByZXF1ZXN0ZWQsIGF2YWlsYWJsZSwgYW5kIG5vbi1wZW5kaW5nIG9jY3VwYW50cy5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRoaXMucmVxdWVzdGVkT2NjdXBhbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBjb25zdCBvY2N1cGFudElkID0gdGhpcy5yZXF1ZXN0ZWRPY2N1cGFudHNbaV07XG4gICAgICBpZiAoIXRoaXMub2NjdXBhbnRzW29jY3VwYW50SWRdICYmIHRoaXMuYXZhaWxhYmxlT2NjdXBhbnRzLmluZGV4T2Yob2NjdXBhbnRJZCkgIT09IC0xICYmICF0aGlzLnBlbmRpbmdPY2N1cGFudHMuaGFzKG9jY3VwYW50SWQpKSB7XG4gICAgICAgIHRoaXMuYWRkT2NjdXBhbnQob2NjdXBhbnRJZCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gUmVtb3ZlIGFueSB1bnJlcXVlc3RlZCBhbmQgY3VycmVudGx5IGFkZGVkIG9jY3VwYW50cy5cbiAgICBmb3IgKGxldCBqID0gMDsgaiA8IHRoaXMuYXZhaWxhYmxlT2NjdXBhbnRzLmxlbmd0aDsgaisrKSB7XG4gICAgICBjb25zdCBvY2N1cGFudElkID0gdGhpcy5hdmFpbGFibGVPY2N1cGFudHNbal07XG4gICAgICBpZiAodGhpcy5vY2N1cGFudHNbb2NjdXBhbnRJZF0gJiYgdGhpcy5yZXF1ZXN0ZWRPY2N1cGFudHMuaW5kZXhPZihvY2N1cGFudElkKSA9PT0gLTEpIHtcbiAgICAgICAgdGhpcy5yZW1vdmVPY2N1cGFudChvY2N1cGFudElkKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBDYWxsIHRoZSBOZXR3b3JrZWQgQUZyYW1lIGNhbGxiYWNrcyBmb3IgdGhlIHVwZGF0ZWQgb2NjdXBhbnRzIGxpc3QuXG4gICAgdGhpcy5vbk9jY3VwYW50c0NoYW5nZWQodGhpcy5vY2N1cGFudHMpO1xuICB9XG5cbiAgYXN5bmMgYWRkT2NjdXBhbnQob2NjdXBhbnRJZCkge1xuICAgIHRoaXMucGVuZGluZ09jY3VwYW50cy5hZGQob2NjdXBhbnRJZCk7XG4gICAgXG4gICAgY29uc3QgYXZhaWxhYmxlT2NjdXBhbnRzQ291bnQgPSB0aGlzLmF2YWlsYWJsZU9jY3VwYW50cy5sZW5ndGg7XG4gICAgaWYgKGF2YWlsYWJsZU9jY3VwYW50c0NvdW50ID4gQVZBSUxBQkxFX09DQ1VQQU5UU19USFJFU0hPTEQpIHtcbiAgICAgIGF3YWl0IHJhbmRvbURlbGF5KDAsIE1BWF9TVUJTQ1JJQkVfREVMQVkpO1xuICAgIH1cbiAgXG4gICAgY29uc3Qgc3Vic2NyaWJlciA9IGF3YWl0IHRoaXMuY3JlYXRlU3Vic2NyaWJlcihvY2N1cGFudElkKTtcbiAgICBpZiAoc3Vic2NyaWJlcikge1xuICAgICAgaWYoIXRoaXMucGVuZGluZ09jY3VwYW50cy5oYXMob2NjdXBhbnRJZCkpIHtcbiAgICAgICAgc3Vic2NyaWJlci5jb25uLmNsb3NlKCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnBlbmRpbmdPY2N1cGFudHMuZGVsZXRlKG9jY3VwYW50SWQpO1xuICAgICAgICB0aGlzLm9jY3VwYW50SWRzLnB1c2gob2NjdXBhbnRJZCk7XG4gICAgICAgIHRoaXMub2NjdXBhbnRzW29jY3VwYW50SWRdID0gc3Vic2NyaWJlcjtcblxuICAgICAgICB0aGlzLnNldE1lZGlhU3RyZWFtKG9jY3VwYW50SWQsIHN1YnNjcmliZXIubWVkaWFTdHJlYW0pO1xuXG4gICAgICAgIC8vIENhbGwgdGhlIE5ldHdvcmtlZCBBRnJhbWUgY2FsbGJhY2tzIGZvciB0aGUgbmV3IG9jY3VwYW50LlxuICAgICAgICB0aGlzLm9uT2NjdXBhbnRDb25uZWN0ZWQob2NjdXBhbnRJZCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmVtb3ZlQWxsT2NjdXBhbnRzKCkge1xuICAgIHRoaXMucGVuZGluZ09jY3VwYW50cy5jbGVhcigpO1xuICAgIGZvciAobGV0IGkgPSB0aGlzLm9jY3VwYW50SWRzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICB0aGlzLnJlbW92ZU9jY3VwYW50KHRoaXMub2NjdXBhbnRJZHNbaV0pO1xuICAgIH1cbiAgfVxuXG4gIHJlbW92ZU9jY3VwYW50KG9jY3VwYW50SWQpIHtcbiAgICB0aGlzLnBlbmRpbmdPY2N1cGFudHMuZGVsZXRlKG9jY3VwYW50SWQpO1xuICAgIFxuICAgIGlmICh0aGlzLm9jY3VwYW50c1tvY2N1cGFudElkXSkge1xuICAgICAgLy8gQ2xvc2UgdGhlIHN1YnNjcmliZXIgcGVlciBjb25uZWN0aW9uLiBXaGljaCBhbHNvIGRldGFjaGVzIHRoZSBwbHVnaW4gaGFuZGxlLlxuICAgICAgdGhpcy5vY2N1cGFudHNbb2NjdXBhbnRJZF0uY29ubi5jbG9zZSgpO1xuICAgICAgZGVsZXRlIHRoaXMub2NjdXBhbnRzW29jY3VwYW50SWRdO1xuICAgICAgXG4gICAgICB0aGlzLm9jY3VwYW50SWRzLnNwbGljZSh0aGlzLm9jY3VwYW50SWRzLmluZGV4T2Yob2NjdXBhbnRJZCksIDEpO1xuICAgIH1cblxuICAgIGlmICh0aGlzLm1lZGlhU3RyZWFtc1tvY2N1cGFudElkXSkge1xuICAgICAgZGVsZXRlIHRoaXMubWVkaWFTdHJlYW1zW29jY3VwYW50SWRdO1xuICAgIH1cblxuICAgIGlmICh0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmhhcyhvY2N1cGFudElkKSkge1xuICAgICAgY29uc3QgbXNnID0gXCJUaGUgdXNlciBkaXNjb25uZWN0ZWQgYmVmb3JlIHRoZSBtZWRpYSBzdHJlYW0gd2FzIHJlc29sdmVkLlwiO1xuICAgICAgdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5nZXQob2NjdXBhbnRJZCkuYXVkaW8ucmVqZWN0KG1zZyk7XG4gICAgICB0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmdldChvY2N1cGFudElkKS52aWRlby5yZWplY3QobXNnKTtcbiAgICAgIHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuZGVsZXRlKG9jY3VwYW50SWQpO1xuICAgIH1cblxuICAgIC8vIENhbGwgdGhlIE5ldHdvcmtlZCBBRnJhbWUgY2FsbGJhY2tzIGZvciB0aGUgcmVtb3ZlZCBvY2N1cGFudC5cbiAgICB0aGlzLm9uT2NjdXBhbnREaXNjb25uZWN0ZWQob2NjdXBhbnRJZCk7XG4gIH1cblxuICBhc3NvY2lhdGUoY29ubiwgaGFuZGxlKSB7XG4gICAgY29ubi5hZGRFdmVudExpc3RlbmVyKFwiaWNlY2FuZGlkYXRlXCIsIGV2ID0+IHtcbiAgICAgIGhhbmRsZS5zZW5kVHJpY2tsZShldi5jYW5kaWRhdGUgfHwgbnVsbCkuY2F0Y2goZSA9PiBlcnJvcihcIkVycm9yIHRyaWNrbGluZyBJQ0U6ICVvXCIsIGUpKTtcbiAgICB9KTtcbiAgICBjb25uLmFkZEV2ZW50TGlzdGVuZXIoXCJpY2Vjb25uZWN0aW9uc3RhdGVjaGFuZ2VcIiwgZXYgPT4ge1xuICAgICAgaWYgKGNvbm4uaWNlQ29ubmVjdGlvblN0YXRlID09PSBcImNvbm5lY3RlZFwiKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKFwiSUNFIHN0YXRlIGNoYW5nZWQgdG8gY29ubmVjdGVkXCIpO1xuICAgICAgfVxuICAgICAgaWYgKGNvbm4uaWNlQ29ubmVjdGlvblN0YXRlID09PSBcImRpc2Nvbm5lY3RlZFwiKSB7XG4gICAgICAgIGNvbnNvbGUud2FybihcIklDRSBzdGF0ZSBjaGFuZ2VkIHRvIGRpc2Nvbm5lY3RlZFwiKTtcbiAgICAgIH1cbiAgICAgIGlmIChjb25uLmljZUNvbm5lY3Rpb25TdGF0ZSA9PT0gXCJmYWlsZWRcIikge1xuICAgICAgICBjb25zb2xlLndhcm4oXCJJQ0UgZmFpbHVyZSBkZXRlY3RlZC4gUmVjb25uZWN0aW5nIGluIDEwcy5cIik7XG4gICAgICAgIHRoaXMucGVyZm9ybURlbGF5ZWRSZWNvbm5lY3QoKTtcbiAgICAgIH1cbiAgICB9KVxuXG4gICAgLy8gd2UgaGF2ZSB0byBkZWJvdW5jZSB0aGVzZSBiZWNhdXNlIGphbnVzIGdldHMgYW5ncnkgaWYgeW91IHNlbmQgaXQgYSBuZXcgU0RQIGJlZm9yZVxuICAgIC8vIGl0J3MgZmluaXNoZWQgcHJvY2Vzc2luZyBhbiBleGlzdGluZyBTRFAuIGluIGFjdHVhbGl0eSwgaXQgc2VlbXMgbGlrZSB0aGlzIGlzIG1heWJlXG4gICAgLy8gdG9vIGxpYmVyYWwgYW5kIHdlIG5lZWQgdG8gd2FpdCBzb21lIGFtb3VudCBvZiB0aW1lIGFmdGVyIGFuIG9mZmVyIGJlZm9yZSBzZW5kaW5nIGFub3RoZXIsXG4gICAgLy8gYnV0IHdlIGRvbid0IGN1cnJlbnRseSBrbm93IGFueSBnb29kIHdheSBvZiBkZXRlY3RpbmcgZXhhY3RseSBob3cgbG9uZyA6KFxuICAgIGNvbm4uYWRkRXZlbnRMaXN0ZW5lcihcbiAgICAgIFwibmVnb3RpYXRpb25uZWVkZWRcIixcbiAgICAgIGRlYm91bmNlKGV2ID0+IHtcbiAgICAgICAgZGVidWcoXCJTZW5kaW5nIG5ldyBvZmZlciBmb3IgaGFuZGxlOiAlb1wiLCBoYW5kbGUpO1xuICAgICAgICB2YXIgb2ZmZXIgPSBjb25uLmNyZWF0ZU9mZmVyKCkudGhlbih0aGlzLmNvbmZpZ3VyZVB1Ymxpc2hlclNkcCkudGhlbih0aGlzLmZpeFNhZmFyaUljZVVGcmFnKTtcbiAgICAgICAgdmFyIGxvY2FsID0gb2ZmZXIudGhlbihvID0+IGNvbm4uc2V0TG9jYWxEZXNjcmlwdGlvbihvKSk7XG4gICAgICAgIHZhciByZW1vdGUgPSBvZmZlcjtcblxuICAgICAgICByZW1vdGUgPSByZW1vdGVcbiAgICAgICAgICAudGhlbih0aGlzLmZpeFNhZmFyaUljZVVGcmFnKVxuICAgICAgICAgIC50aGVuKGogPT4gaGFuZGxlLnNlbmRKc2VwKGopKVxuICAgICAgICAgIC50aGVuKHIgPT4gY29ubi5zZXRSZW1vdGVEZXNjcmlwdGlvbihyLmpzZXApKTtcbiAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKFtsb2NhbCwgcmVtb3RlXSkuY2F0Y2goZSA9PiBlcnJvcihcIkVycm9yIG5lZ290aWF0aW5nIG9mZmVyOiAlb1wiLCBlKSk7XG4gICAgICB9KVxuICAgICk7XG4gICAgaGFuZGxlLm9uKFxuICAgICAgXCJldmVudFwiLFxuICAgICAgZGVib3VuY2UoZXYgPT4ge1xuICAgICAgICB2YXIganNlcCA9IGV2LmpzZXA7XG4gICAgICAgIGlmIChqc2VwICYmIGpzZXAudHlwZSA9PSBcIm9mZmVyXCIpIHtcbiAgICAgICAgICBkZWJ1ZyhcIkFjY2VwdGluZyBuZXcgb2ZmZXIgZm9yIGhhbmRsZTogJW9cIiwgaGFuZGxlKTtcbiAgICAgICAgICB2YXIgYW5zd2VyID0gY29ublxuICAgICAgICAgICAgLnNldFJlbW90ZURlc2NyaXB0aW9uKHRoaXMuY29uZmlndXJlU3Vic2NyaWJlclNkcChqc2VwKSlcbiAgICAgICAgICAgIC50aGVuKF8gPT4gY29ubi5jcmVhdGVBbnN3ZXIoKSlcbiAgICAgICAgICAgIC50aGVuKHRoaXMuZml4U2FmYXJpSWNlVUZyYWcpO1xuICAgICAgICAgIHZhciBsb2NhbCA9IGFuc3dlci50aGVuKGEgPT4gY29ubi5zZXRMb2NhbERlc2NyaXB0aW9uKGEpKTtcbiAgICAgICAgICB2YXIgcmVtb3RlID0gYW5zd2VyLnRoZW4oaiA9PiBoYW5kbGUuc2VuZEpzZXAoaikpO1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLmFsbChbbG9jYWwsIHJlbW90ZV0pLmNhdGNoKGUgPT4gZXJyb3IoXCJFcnJvciBuZWdvdGlhdGluZyBhbnN3ZXI6ICVvXCIsIGUpKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBzb21lIG90aGVyIGtpbmQgb2YgZXZlbnQsIG5vdGhpbmcgdG8gZG9cbiAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICApO1xuICB9XG5cbiAgYXN5bmMgY3JlYXRlUHVibGlzaGVyKCkge1xuICAgIHZhciBoYW5kbGUgPSBuZXcgbWouSmFudXNQbHVnaW5IYW5kbGUodGhpcy5zZXNzaW9uKTtcbiAgICB2YXIgY29ubiA9IG5ldyBSVENQZWVyQ29ubmVjdGlvbih0aGlzLnBlZXJDb25uZWN0aW9uQ29uZmlnIHx8IERFRkFVTFRfUEVFUl9DT05ORUNUSU9OX0NPTkZJRyk7XG5cbiAgICBkZWJ1ZyhcInB1YiB3YWl0aW5nIGZvciBzZnVcIik7XG4gICAgYXdhaXQgaGFuZGxlLmF0dGFjaChcImphbnVzLnBsdWdpbi5zZnVcIiwgdGhpcy5sb29wcyAmJiB0aGlzLmNsaWVudElkID8gcGFyc2VJbnQodGhpcy5jbGllbnRJZCkgJSB0aGlzLmxvb3BzIDogdW5kZWZpbmVkKTtcblxuICAgIHRoaXMuYXNzb2NpYXRlKGNvbm4sIGhhbmRsZSk7XG5cbiAgICBkZWJ1ZyhcInB1YiB3YWl0aW5nIGZvciBkYXRhIGNoYW5uZWxzICYgd2VicnRjdXBcIik7XG4gICAgdmFyIHdlYnJ0Y3VwID0gbmV3IFByb21pc2UocmVzb2x2ZSA9PiBoYW5kbGUub24oXCJ3ZWJydGN1cFwiLCByZXNvbHZlKSk7XG5cbiAgICAvLyBVbnJlbGlhYmxlIGRhdGFjaGFubmVsOiBzZW5kaW5nIGFuZCByZWNlaXZpbmcgY29tcG9uZW50IHVwZGF0ZXMuXG4gICAgLy8gUmVsaWFibGUgZGF0YWNoYW5uZWw6IHNlbmRpbmcgYW5kIHJlY2lldmluZyBlbnRpdHkgaW5zdGFudGlhdGlvbnMuXG4gICAgdmFyIHJlbGlhYmxlQ2hhbm5lbCA9IGNvbm4uY3JlYXRlRGF0YUNoYW5uZWwoXCJyZWxpYWJsZVwiLCB7IG9yZGVyZWQ6IHRydWUgfSk7XG4gICAgdmFyIHVucmVsaWFibGVDaGFubmVsID0gY29ubi5jcmVhdGVEYXRhQ2hhbm5lbChcInVucmVsaWFibGVcIiwge1xuICAgICAgb3JkZXJlZDogZmFsc2UsXG4gICAgICBtYXhSZXRyYW5zbWl0czogMFxuICAgIH0pO1xuXG4gICAgcmVsaWFibGVDaGFubmVsLmFkZEV2ZW50TGlzdGVuZXIoXCJtZXNzYWdlXCIsIGUgPT4gdGhpcy5vbkRhdGFDaGFubmVsTWVzc2FnZShlLCBcImphbnVzLXJlbGlhYmxlXCIpKTtcbiAgICB1bnJlbGlhYmxlQ2hhbm5lbC5hZGRFdmVudExpc3RlbmVyKFwibWVzc2FnZVwiLCBlID0+IHRoaXMub25EYXRhQ2hhbm5lbE1lc3NhZ2UoZSwgXCJqYW51cy11bnJlbGlhYmxlXCIpKTtcblxuICAgIGF3YWl0IHdlYnJ0Y3VwO1xuICAgIGF3YWl0IHVudGlsRGF0YUNoYW5uZWxPcGVuKHJlbGlhYmxlQ2hhbm5lbCk7XG4gICAgYXdhaXQgdW50aWxEYXRhQ2hhbm5lbE9wZW4odW5yZWxpYWJsZUNoYW5uZWwpO1xuXG4gICAgLy8gZG9pbmcgdGhpcyBoZXJlIGlzIHNvcnQgb2YgYSBoYWNrIGFyb3VuZCBjaHJvbWUgcmVuZWdvdGlhdGlvbiB3ZWlyZG5lc3MgLS1cbiAgICAvLyBpZiB3ZSBkbyBpdCBwcmlvciB0byB3ZWJydGN1cCwgY2hyb21lIG9uIGdlYXIgVlIgd2lsbCBzb21ldGltZXMgcHV0IGFcbiAgICAvLyByZW5lZ290aWF0aW9uIG9mZmVyIGluIGZsaWdodCB3aGlsZSB0aGUgZmlyc3Qgb2ZmZXIgd2FzIHN0aWxsIGJlaW5nXG4gICAgLy8gcHJvY2Vzc2VkIGJ5IGphbnVzLiB3ZSBzaG91bGQgZmluZCBzb21lIG1vcmUgcHJpbmNpcGxlZCB3YXkgdG8gZmlndXJlIG91dFxuICAgIC8vIHdoZW4gamFudXMgaXMgZG9uZSBpbiB0aGUgZnV0dXJlLlxuICAgIGlmICh0aGlzLmxvY2FsTWVkaWFTdHJlYW0pIHtcbiAgICAgIHRoaXMubG9jYWxNZWRpYVN0cmVhbS5nZXRUcmFja3MoKS5mb3JFYWNoKHRyYWNrID0+IHtcbiAgICAgICAgY29ubi5hZGRUcmFjayh0cmFjaywgdGhpcy5sb2NhbE1lZGlhU3RyZWFtKTtcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIEhhbmRsZSBhbGwgb2YgdGhlIGpvaW4gYW5kIGxlYXZlIGV2ZW50cy5cbiAgICBoYW5kbGUub24oXCJldmVudFwiLCBldiA9PiB7XG4gICAgICB2YXIgZGF0YSA9IGV2LnBsdWdpbmRhdGEuZGF0YTtcbiAgICAgIGlmIChkYXRhLmV2ZW50ID09IFwiam9pblwiICYmIGRhdGEucm9vbV9pZCA9PSB0aGlzLnJvb20pIHtcbiAgICAgICAgaWYgKHRoaXMuZGVsYXllZFJlY29ubmVjdFRpbWVvdXQpIHtcbiAgICAgICAgICAvLyBEb24ndCBjcmVhdGUgYSBuZXcgUlRDUGVlckNvbm5lY3Rpb24sIGFsbCBSVENQZWVyQ29ubmVjdGlvbiB3aWxsIGJlIGNsb3NlZCBpbiBsZXNzIHRoYW4gMTBzLlxuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmFkZEF2YWlsYWJsZU9jY3VwYW50KGRhdGEudXNlcl9pZCk7XG4gICAgICAgIHRoaXMuc3luY09jY3VwYW50cygpO1xuICAgICAgfSBlbHNlIGlmIChkYXRhLmV2ZW50ID09IFwibGVhdmVcIiAmJiBkYXRhLnJvb21faWQgPT0gdGhpcy5yb29tKSB7XG4gICAgICAgIHRoaXMucmVtb3ZlQXZhaWxhYmxlT2NjdXBhbnQoZGF0YS51c2VyX2lkKTtcbiAgICAgICAgdGhpcy5yZW1vdmVPY2N1cGFudChkYXRhLnVzZXJfaWQpO1xuICAgICAgfSBlbHNlIGlmIChkYXRhLmV2ZW50ID09IFwiYmxvY2tlZFwiKSB7XG4gICAgICAgIGRvY3VtZW50LmJvZHkuZGlzcGF0Y2hFdmVudChuZXcgQ3VzdG9tRXZlbnQoXCJibG9ja2VkXCIsIHsgZGV0YWlsOiB7IGNsaWVudElkOiBkYXRhLmJ5IH0gfSkpO1xuICAgICAgfSBlbHNlIGlmIChkYXRhLmV2ZW50ID09IFwidW5ibG9ja2VkXCIpIHtcbiAgICAgICAgZG9jdW1lbnQuYm9keS5kaXNwYXRjaEV2ZW50KG5ldyBDdXN0b21FdmVudChcInVuYmxvY2tlZFwiLCB7IGRldGFpbDogeyBjbGllbnRJZDogZGF0YS5ieSB9IH0pKTtcbiAgICAgIH0gZWxzZSBpZiAoZGF0YS5ldmVudCA9PT0gXCJkYXRhXCIpIHtcbiAgICAgICAgdGhpcy5vbkRhdGEoSlNPTi5wYXJzZShkYXRhLmJvZHkpLCBcImphbnVzLWV2ZW50XCIpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgZGVidWcoXCJwdWIgd2FpdGluZyBmb3Igam9pblwiKTtcblxuICAgIC8vIFNlbmQgam9pbiBtZXNzYWdlIHRvIGphbnVzLiBMaXN0ZW4gZm9yIGpvaW4vbGVhdmUgbWVzc2FnZXMuIEF1dG9tYXRpY2FsbHkgc3Vic2NyaWJlIHRvIGFsbCB1c2VycycgV2ViUlRDIGRhdGEuXG4gICAgdmFyIG1lc3NhZ2UgPSBhd2FpdCB0aGlzLnNlbmRKb2luKGhhbmRsZSwge1xuICAgICAgbm90aWZpY2F0aW9uczogdHJ1ZSxcbiAgICAgIGRhdGE6IHRydWVcbiAgICB9KTtcblxuICAgIGlmICghbWVzc2FnZS5wbHVnaW5kYXRhLmRhdGEuc3VjY2Vzcykge1xuICAgICAgY29uc3QgZXJyID0gbWVzc2FnZS5wbHVnaW5kYXRhLmRhdGEuZXJyb3I7XG4gICAgICBjb25zb2xlLmVycm9yKGVycik7XG4gICAgICAvLyBXZSBtYXkgZ2V0IGhlcmUgYmVjYXVzZSBvZiBhbiBleHBpcmVkIEpXVC5cbiAgICAgIC8vIENsb3NlIHRoZSBjb25uZWN0aW9uIG91cnNlbGYgb3RoZXJ3aXNlIGphbnVzIHdpbGwgY2xvc2UgaXQgYWZ0ZXJcbiAgICAgIC8vIHNlc3Npb25fdGltZW91dCBiZWNhdXNlIHdlIGRpZG4ndCBzZW5kIGFueSBrZWVwYWxpdmUgYW5kIHRoaXMgd2lsbFxuICAgICAgLy8gdHJpZ2dlciBhIGRlbGF5ZWQgcmVjb25uZWN0IGJlY2F1c2Ugb2YgdGhlIGljZWNvbm5lY3Rpb25zdGF0ZWNoYW5nZVxuICAgICAgLy8gbGlzdGVuZXIgZm9yIGZhaWx1cmUgc3RhdGUuXG4gICAgICAvLyBFdmVuIGlmIHRoZSBhcHAgY29kZSBjYWxscyBkaXNjb25uZWN0IGluIGNhc2Ugb2YgZXJyb3IsIGRpc2Nvbm5lY3RcbiAgICAgIC8vIHdvbid0IGNsb3NlIHRoZSBwZWVyIGNvbm5lY3Rpb24gYmVjYXVzZSB0aGlzLnB1Ymxpc2hlciBpcyBub3Qgc2V0LlxuICAgICAgY29ubi5jbG9zZSgpO1xuICAgICAgdGhyb3cgZXJyO1xuICAgIH1cblxuICAgIHZhciBpbml0aWFsT2NjdXBhbnRzID0gbWVzc2FnZS5wbHVnaW5kYXRhLmRhdGEucmVzcG9uc2UudXNlcnNbdGhpcy5yb29tXSB8fCBbXTtcblxuICAgIGlmIChpbml0aWFsT2NjdXBhbnRzLmluY2x1ZGVzKHRoaXMuY2xpZW50SWQpKSB7XG4gICAgICBjb25zb2xlLndhcm4oXCJKYW51cyBzdGlsbCBoYXMgcHJldmlvdXMgc2Vzc2lvbiBmb3IgdGhpcyBjbGllbnQuIFJlY29ubmVjdGluZyBpbiAxMHMuXCIpO1xuICAgICAgdGhpcy5wZXJmb3JtRGVsYXllZFJlY29ubmVjdCgpO1xuICAgIH1cblxuICAgIGRlYnVnKFwicHVibGlzaGVyIHJlYWR5XCIpO1xuICAgIHJldHVybiB7XG4gICAgICBoYW5kbGUsXG4gICAgICBpbml0aWFsT2NjdXBhbnRzLFxuICAgICAgcmVsaWFibGVDaGFubmVsLFxuICAgICAgdW5yZWxpYWJsZUNoYW5uZWwsXG4gICAgICBjb25uXG4gICAgfTtcbiAgfVxuXG4gIGNvbmZpZ3VyZVB1Ymxpc2hlclNkcChqc2VwKSB7XG4gICAganNlcC5zZHAgPSBqc2VwLnNkcC5yZXBsYWNlKC9hPWZtdHA6KDEwOXwxMTEpLipcXHJcXG4vZywgKGxpbmUsIHB0KSA9PiB7XG4gICAgICBjb25zdCBwYXJhbWV0ZXJzID0gT2JqZWN0LmFzc2lnbihzZHBVdGlscy5wYXJzZUZtdHAobGluZSksIE9QVVNfUEFSQU1FVEVSUyk7XG4gICAgICByZXR1cm4gc2RwVXRpbHMud3JpdGVGbXRwKHsgcGF5bG9hZFR5cGU6IHB0LCBwYXJhbWV0ZXJzOiBwYXJhbWV0ZXJzIH0pO1xuICAgIH0pO1xuICAgIHJldHVybiBqc2VwO1xuICB9XG5cbiAgY29uZmlndXJlU3Vic2NyaWJlclNkcChqc2VwKSB7XG4gICAgLy8gdG9kbzogY29uc2lkZXIgY2xlYW5pbmcgdXAgdGhlc2UgaGFja3MgdG8gdXNlIHNkcHV0aWxzXG4gICAgaWYgKCFpc0gyNjRWaWRlb1N1cHBvcnRlZCkge1xuICAgICAgaWYgKG5hdmlnYXRvci51c2VyQWdlbnQuaW5kZXhPZihcIkhlYWRsZXNzQ2hyb21lXCIpICE9PSAtMSkge1xuICAgICAgICAvLyBIZWFkbGVzc0Nocm9tZSAoZS5nLiBwdXBwZXRlZXIpIGRvZXNuJ3Qgc3VwcG9ydCB3ZWJydGMgdmlkZW8gc3RyZWFtcywgc28gd2UgcmVtb3ZlIHRob3NlIGxpbmVzIGZyb20gdGhlIFNEUC5cbiAgICAgICAganNlcC5zZHAgPSBqc2VwLnNkcC5yZXBsYWNlKC9tPXZpZGVvW15dKm09LywgXCJtPVwiKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBUT0RPOiBIYWNrIHRvIGdldCB2aWRlbyB3b3JraW5nIG9uIENocm9tZSBmb3IgQW5kcm9pZC4gaHR0cHM6Ly9ncm91cHMuZ29vZ2xlLmNvbS9mb3J1bS8jIXRvcGljL21vemlsbGEuZGV2Lm1lZGlhL1llMjl2dU1UcG84XG4gICAgaWYgKG5hdmlnYXRvci51c2VyQWdlbnQuaW5kZXhPZihcIkFuZHJvaWRcIikgPT09IC0xKSB7XG4gICAgICBqc2VwLnNkcCA9IGpzZXAuc2RwLnJlcGxhY2UoXG4gICAgICAgIFwiYT1ydGNwLWZiOjEwNyBnb29nLXJlbWJcXHJcXG5cIixcbiAgICAgICAgXCJhPXJ0Y3AtZmI6MTA3IGdvb2ctcmVtYlxcclxcbmE9cnRjcC1mYjoxMDcgdHJhbnNwb3J0LWNjXFxyXFxuYT1mbXRwOjEwNyBsZXZlbC1hc3ltbWV0cnktYWxsb3dlZD0xO3BhY2tldGl6YXRpb24tbW9kZT0xO3Byb2ZpbGUtbGV2ZWwtaWQ9NDJlMDFmXFxyXFxuXCJcbiAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGpzZXAuc2RwID0ganNlcC5zZHAucmVwbGFjZShcbiAgICAgICAgXCJhPXJ0Y3AtZmI6MTA3IGdvb2ctcmVtYlxcclxcblwiLFxuICAgICAgICBcImE9cnRjcC1mYjoxMDcgZ29vZy1yZW1iXFxyXFxuYT1ydGNwLWZiOjEwNyB0cmFuc3BvcnQtY2NcXHJcXG5hPWZtdHA6MTA3IGxldmVsLWFzeW1tZXRyeS1hbGxvd2VkPTE7cGFja2V0aXphdGlvbi1tb2RlPTE7cHJvZmlsZS1sZXZlbC1pZD00MjAwMWZcXHJcXG5cIlxuICAgICAgKTtcbiAgICB9XG4gICAgcmV0dXJuIGpzZXA7XG4gIH1cblxuICBhc3luYyBmaXhTYWZhcmlJY2VVRnJhZyhqc2VwKSB7XG4gICAgLy8gU2FmYXJpIHByb2R1Y2VzIGEgXFxuIGluc3RlYWQgb2YgYW4gXFxyXFxuIGZvciB0aGUgaWNlLXVmcmFnLiBTZWUgaHR0cHM6Ly9naXRodWIuY29tL21lZXRlY2hvL2phbnVzLWdhdGV3YXkvaXNzdWVzLzE4MThcbiAgICBqc2VwLnNkcCA9IGpzZXAuc2RwLnJlcGxhY2UoL1teXFxyXVxcbmE9aWNlLXVmcmFnL2csIFwiXFxyXFxuYT1pY2UtdWZyYWdcIik7XG4gICAgcmV0dXJuIGpzZXBcbiAgfVxuXG4gIGFzeW5jIGNyZWF0ZVN1YnNjcmliZXIob2NjdXBhbnRJZCwgbWF4UmV0cmllcyA9IDUpIHtcbiAgICBpZiAodGhpcy5hdmFpbGFibGVPY2N1cGFudHMuaW5kZXhPZihvY2N1cGFudElkKSA9PT0gLTEpIHtcbiAgICAgIGNvbnNvbGUud2FybihvY2N1cGFudElkICsgXCI6IGNhbmNlbGxlZCBvY2N1cGFudCBjb25uZWN0aW9uLCBvY2N1cGFudCBsZWZ0IGJlZm9yZSBzdWJzY3JpcHRpb24gbmVnb3RhdGlvbi5cIik7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICB2YXIgaGFuZGxlID0gbmV3IG1qLkphbnVzUGx1Z2luSGFuZGxlKHRoaXMuc2Vzc2lvbik7XG4gICAgdmFyIGNvbm4gPSBuZXcgUlRDUGVlckNvbm5lY3Rpb24odGhpcy5wZWVyQ29ubmVjdGlvbkNvbmZpZyB8fCBERUZBVUxUX1BFRVJfQ09OTkVDVElPTl9DT05GSUcpO1xuXG4gICAgZGVidWcob2NjdXBhbnRJZCArIFwiOiBzdWIgd2FpdGluZyBmb3Igc2Z1XCIpO1xuICAgIGF3YWl0IGhhbmRsZS5hdHRhY2goXCJqYW51cy5wbHVnaW4uc2Z1XCIsIHRoaXMubG9vcHMgPyBwYXJzZUludChvY2N1cGFudElkKSAlIHRoaXMubG9vcHMgOiB1bmRlZmluZWQpO1xuXG4gICAgdGhpcy5hc3NvY2lhdGUoY29ubiwgaGFuZGxlKTtcblxuICAgIGRlYnVnKG9jY3VwYW50SWQgKyBcIjogc3ViIHdhaXRpbmcgZm9yIGpvaW5cIik7XG5cbiAgICBpZiAodGhpcy5hdmFpbGFibGVPY2N1cGFudHMuaW5kZXhPZihvY2N1cGFudElkKSA9PT0gLTEpIHtcbiAgICAgIGNvbm4uY2xvc2UoKTtcbiAgICAgIGNvbnNvbGUud2FybihvY2N1cGFudElkICsgXCI6IGNhbmNlbGxlZCBvY2N1cGFudCBjb25uZWN0aW9uLCBvY2N1cGFudCBsZWZ0IGFmdGVyIGF0dGFjaFwiKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGxldCB3ZWJydGNGYWlsZWQgPSBmYWxzZTtcblxuICAgIGNvbnN0IHdlYnJ0Y3VwID0gbmV3IFByb21pc2UocmVzb2x2ZSA9PiB7XG4gICAgICBjb25zdCBsZWZ0SW50ZXJ2YWwgPSBzZXRJbnRlcnZhbCgoKSA9PiB7XG4gICAgICAgIGlmICh0aGlzLmF2YWlsYWJsZU9jY3VwYW50cy5pbmRleE9mKG9jY3VwYW50SWQpID09PSAtMSkge1xuICAgICAgICAgIGNsZWFySW50ZXJ2YWwobGVmdEludGVydmFsKTtcbiAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgIH1cbiAgICAgIH0sIDEwMDApO1xuXG4gICAgICBjb25zdCB0aW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIGNsZWFySW50ZXJ2YWwobGVmdEludGVydmFsKTtcbiAgICAgICAgd2VicnRjRmFpbGVkID0gdHJ1ZTtcbiAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgfSwgU1VCU0NSSUJFX1RJTUVPVVRfTVMpO1xuXG4gICAgICBoYW5kbGUub24oXCJ3ZWJydGN1cFwiLCAoKSA9PiB7XG4gICAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICAgICAgY2xlYXJJbnRlcnZhbChsZWZ0SW50ZXJ2YWwpO1xuICAgICAgICByZXNvbHZlKCk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIC8vIFNlbmQgam9pbiBtZXNzYWdlIHRvIGphbnVzLiBEb24ndCBsaXN0ZW4gZm9yIGpvaW4vbGVhdmUgbWVzc2FnZXMuIFN1YnNjcmliZSB0byB0aGUgb2NjdXBhbnQncyBtZWRpYS5cbiAgICAvLyBKYW51cyBzaG91bGQgc2VuZCB1cyBhbiBvZmZlciBmb3IgdGhpcyBvY2N1cGFudCdzIG1lZGlhIGluIHJlc3BvbnNlIHRvIHRoaXMuXG4gICAgYXdhaXQgdGhpcy5zZW5kSm9pbihoYW5kbGUsIHsgbWVkaWE6IG9jY3VwYW50SWQgfSk7XG5cbiAgICBpZiAodGhpcy5hdmFpbGFibGVPY2N1cGFudHMuaW5kZXhPZihvY2N1cGFudElkKSA9PT0gLTEpIHtcbiAgICAgIGNvbm4uY2xvc2UoKTtcbiAgICAgIGNvbnNvbGUud2FybihvY2N1cGFudElkICsgXCI6IGNhbmNlbGxlZCBvY2N1cGFudCBjb25uZWN0aW9uLCBvY2N1cGFudCBsZWZ0IGFmdGVyIGpvaW5cIik7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBkZWJ1ZyhvY2N1cGFudElkICsgXCI6IHN1YiB3YWl0aW5nIGZvciB3ZWJydGN1cFwiKTtcbiAgICBhd2FpdCB3ZWJydGN1cDtcblxuICAgIGlmICh0aGlzLmF2YWlsYWJsZU9jY3VwYW50cy5pbmRleE9mKG9jY3VwYW50SWQpID09PSAtMSkge1xuICAgICAgY29ubi5jbG9zZSgpO1xuICAgICAgY29uc29sZS53YXJuKG9jY3VwYW50SWQgKyBcIjogY2FuY2VsIG9jY3VwYW50IGNvbm5lY3Rpb24sIG9jY3VwYW50IGxlZnQgZHVyaW5nIG9yIGFmdGVyIHdlYnJ0Y3VwXCIpO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgaWYgKHdlYnJ0Y0ZhaWxlZCkge1xuICAgICAgY29ubi5jbG9zZSgpO1xuICAgICAgaWYgKG1heFJldHJpZXMgPiAwKSB7XG4gICAgICAgIGNvbnNvbGUud2FybihvY2N1cGFudElkICsgXCI6IHdlYnJ0YyB1cCB0aW1lZCBvdXQsIHJldHJ5aW5nXCIpO1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVTdWJzY3JpYmVyKG9jY3VwYW50SWQsIG1heFJldHJpZXMgLSAxKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnNvbGUud2FybihvY2N1cGFudElkICsgXCI6IHdlYnJ0YyB1cCB0aW1lZCBvdXRcIik7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChpc1NhZmFyaSAmJiAhdGhpcy5faU9TSGFja0RlbGF5ZWRJbml0aWFsUGVlcikge1xuICAgICAgLy8gSEFDSzogdGhlIGZpcnN0IHBlZXIgb24gU2FmYXJpIGR1cmluZyBwYWdlIGxvYWQgY2FuIGZhaWwgdG8gd29yayBpZiB3ZSBkb24ndFxuICAgICAgLy8gd2FpdCBzb21lIHRpbWUgYmVmb3JlIGNvbnRpbnVpbmcgaGVyZS4gU2VlOiBodHRwczovL2dpdGh1Yi5jb20vbW96aWxsYS9odWJzL3B1bGwvMTY5MlxuICAgICAgYXdhaXQgKG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDMwMDApKSk7XG4gICAgICB0aGlzLl9pT1NIYWNrRGVsYXllZEluaXRpYWxQZWVyID0gdHJ1ZTtcbiAgICB9XG5cbiAgICB2YXIgbWVkaWFTdHJlYW0gPSBuZXcgTWVkaWFTdHJlYW0oKTtcbiAgICB2YXIgcmVjZWl2ZXJzID0gY29ubi5nZXRSZWNlaXZlcnMoKTtcbiAgICByZWNlaXZlcnMuZm9yRWFjaChyZWNlaXZlciA9PiB7XG4gICAgICBpZiAocmVjZWl2ZXIudHJhY2spIHtcbiAgICAgICAgbWVkaWFTdHJlYW0uYWRkVHJhY2socmVjZWl2ZXIudHJhY2spO1xuICAgICAgfVxuICAgIH0pO1xuICAgIGlmIChtZWRpYVN0cmVhbS5nZXRUcmFja3MoKS5sZW5ndGggPT09IDApIHtcbiAgICAgIG1lZGlhU3RyZWFtID0gbnVsbDtcbiAgICB9XG5cbiAgICBkZWJ1ZyhvY2N1cGFudElkICsgXCI6IHN1YnNjcmliZXIgcmVhZHlcIik7XG4gICAgcmV0dXJuIHtcbiAgICAgIGhhbmRsZSxcbiAgICAgIG1lZGlhU3RyZWFtLFxuICAgICAgY29ublxuICAgIH07XG4gIH1cblxuICBzZW5kSm9pbihoYW5kbGUsIHN1YnNjcmliZSkge1xuICAgIHJldHVybiBoYW5kbGUuc2VuZE1lc3NhZ2Uoe1xuICAgICAga2luZDogXCJqb2luXCIsXG4gICAgICByb29tX2lkOiB0aGlzLnJvb20sXG4gICAgICB1c2VyX2lkOiB0aGlzLmNsaWVudElkLFxuICAgICAgc3Vic2NyaWJlLFxuICAgICAgdG9rZW46IHRoaXMuam9pblRva2VuXG4gICAgfSk7XG4gIH1cblxuICB0b2dnbGVGcmVlemUoKSB7XG4gICAgaWYgKHRoaXMuZnJvemVuKSB7XG4gICAgICB0aGlzLnVuZnJlZXplKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuZnJlZXplKCk7XG4gICAgfVxuICB9XG5cbiAgZnJlZXplKCkge1xuICAgIHRoaXMuZnJvemVuID0gdHJ1ZTtcbiAgfVxuXG4gIHVuZnJlZXplKCkge1xuICAgIHRoaXMuZnJvemVuID0gZmFsc2U7XG4gICAgdGhpcy5mbHVzaFBlbmRpbmdVcGRhdGVzKCk7XG4gIH1cblxuICBkYXRhRm9yVXBkYXRlTXVsdGlNZXNzYWdlKG5ldHdvcmtJZCwgbWVzc2FnZSkge1xuICAgIC8vIFwiZFwiIGlzIGFuIGFycmF5IG9mIGVudGl0eSBkYXRhcywgd2hlcmUgZWFjaCBpdGVtIGluIHRoZSBhcnJheSByZXByZXNlbnRzIGEgdW5pcXVlIGVudGl0eSBhbmQgY29udGFpbnNcbiAgICAvLyBtZXRhZGF0YSBmb3IgdGhlIGVudGl0eSwgYW5kIGFuIGFycmF5IG9mIGNvbXBvbmVudHMgdGhhdCBoYXZlIGJlZW4gdXBkYXRlZCBvbiB0aGUgZW50aXR5LlxuICAgIC8vIFRoaXMgbWV0aG9kIGZpbmRzIHRoZSBkYXRhIGNvcnJlc3BvbmRpbmcgdG8gdGhlIGdpdmVuIG5ldHdvcmtJZC5cbiAgICBmb3IgKGxldCBpID0gMCwgbCA9IG1lc3NhZ2UuZGF0YS5kLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgY29uc3QgZGF0YSA9IG1lc3NhZ2UuZGF0YS5kW2ldO1xuXG4gICAgICBpZiAoZGF0YS5uZXR3b3JrSWQgPT09IG5ldHdvcmtJZCkge1xuICAgICAgICByZXR1cm4gZGF0YTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGdldFBlbmRpbmdEYXRhKG5ldHdvcmtJZCwgbWVzc2FnZSkge1xuICAgIGlmICghbWVzc2FnZSkgcmV0dXJuIG51bGw7XG5cbiAgICBsZXQgZGF0YSA9IG1lc3NhZ2UuZGF0YVR5cGUgPT09IFwidW1cIiA/IHRoaXMuZGF0YUZvclVwZGF0ZU11bHRpTWVzc2FnZShuZXR3b3JrSWQsIG1lc3NhZ2UpIDogbWVzc2FnZS5kYXRhO1xuXG4gICAgLy8gSWdub3JlIG1lc3NhZ2VzIHJlbGF0aW5nIHRvIHVzZXJzIHdobyBoYXZlIGRpc2Nvbm5lY3RlZCBzaW5jZSBmcmVlemluZywgdGhlaXIgZW50aXRpZXNcbiAgICAvLyB3aWxsIGhhdmUgYWxlYWR5IGJlZW4gcmVtb3ZlZCBieSBOQUYuXG4gICAgLy8gTm90ZSB0aGF0IGRlbGV0ZSBtZXNzYWdlcyBoYXZlIG5vIFwib3duZXJcIiBzbyB3ZSBoYXZlIHRvIGNoZWNrIGZvciB0aGF0IGFzIHdlbGwuXG4gICAgaWYgKGRhdGEub3duZXIgJiYgIXRoaXMub2NjdXBhbnRzW2RhdGEub3duZXJdKSByZXR1cm4gbnVsbDtcblxuICAgIC8vIElnbm9yZSBtZXNzYWdlcyBmcm9tIHVzZXJzIHRoYXQgd2UgbWF5IGhhdmUgYmxvY2tlZCB3aGlsZSBmcm96ZW4uXG4gICAgaWYgKGRhdGEub3duZXIgJiYgdGhpcy5ibG9ja2VkQ2xpZW50cy5oYXMoZGF0YS5vd25lcikpIHJldHVybiBudWxsO1xuXG4gICAgcmV0dXJuIGRhdGFcbiAgfVxuXG4gIC8vIFVzZWQgZXh0ZXJuYWxseVxuICBnZXRQZW5kaW5nRGF0YUZvck5ldHdvcmtJZChuZXR3b3JrSWQpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRQZW5kaW5nRGF0YShuZXR3b3JrSWQsIHRoaXMuZnJvemVuVXBkYXRlcy5nZXQobmV0d29ya0lkKSk7XG4gIH1cblxuICBmbHVzaFBlbmRpbmdVcGRhdGVzKCkge1xuICAgIGZvciAoY29uc3QgW25ldHdvcmtJZCwgbWVzc2FnZV0gb2YgdGhpcy5mcm96ZW5VcGRhdGVzKSB7XG4gICAgICBsZXQgZGF0YSA9IHRoaXMuZ2V0UGVuZGluZ0RhdGEobmV0d29ya0lkLCBtZXNzYWdlKTtcbiAgICAgIGlmICghZGF0YSkgY29udGludWU7XG5cbiAgICAgIC8vIE92ZXJyaWRlIHRoZSBkYXRhIHR5cGUgb24gXCJ1bVwiIG1lc3NhZ2VzIHR5cGVzLCBzaW5jZSB3ZSBleHRyYWN0IGVudGl0eSB1cGRhdGVzIGZyb20gXCJ1bVwiIG1lc3NhZ2VzIGludG9cbiAgICAgIC8vIGluZGl2aWR1YWwgZnJvemVuVXBkYXRlcyBpbiBzdG9yZVNpbmdsZU1lc3NhZ2UuXG4gICAgICBjb25zdCBkYXRhVHlwZSA9IG1lc3NhZ2UuZGF0YVR5cGUgPT09IFwidW1cIiA/IFwidVwiIDogbWVzc2FnZS5kYXRhVHlwZTtcblxuICAgICAgdGhpcy5vbk9jY3VwYW50TWVzc2FnZShudWxsLCBkYXRhVHlwZSwgZGF0YSwgbWVzc2FnZS5zb3VyY2UpO1xuICAgIH1cbiAgICB0aGlzLmZyb3plblVwZGF0ZXMuY2xlYXIoKTtcbiAgfVxuXG4gIHN0b3JlTWVzc2FnZShtZXNzYWdlKSB7XG4gICAgaWYgKG1lc3NhZ2UuZGF0YVR5cGUgPT09IFwidW1cIikgeyAvLyBVcGRhdGVNdWx0aVxuICAgICAgZm9yIChsZXQgaSA9IDAsIGwgPSBtZXNzYWdlLmRhdGEuZC5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAgICAgdGhpcy5zdG9yZVNpbmdsZU1lc3NhZ2UobWVzc2FnZSwgaSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuc3RvcmVTaW5nbGVNZXNzYWdlKG1lc3NhZ2UpO1xuICAgIH1cbiAgfVxuXG4gIHN0b3JlU2luZ2xlTWVzc2FnZShtZXNzYWdlLCBpbmRleCkge1xuICAgIGNvbnN0IGRhdGEgPSBpbmRleCAhPT0gdW5kZWZpbmVkID8gbWVzc2FnZS5kYXRhLmRbaW5kZXhdIDogbWVzc2FnZS5kYXRhO1xuICAgIGNvbnN0IGRhdGFUeXBlID0gbWVzc2FnZS5kYXRhVHlwZTtcbiAgICBjb25zdCBzb3VyY2UgPSBtZXNzYWdlLnNvdXJjZTtcblxuICAgIGNvbnN0IG5ldHdvcmtJZCA9IGRhdGEubmV0d29ya0lkO1xuXG4gICAgaWYgKCF0aGlzLmZyb3plblVwZGF0ZXMuaGFzKG5ldHdvcmtJZCkpIHtcbiAgICAgIHRoaXMuZnJvemVuVXBkYXRlcy5zZXQobmV0d29ya0lkLCBtZXNzYWdlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3Qgc3RvcmVkTWVzc2FnZSA9IHRoaXMuZnJvemVuVXBkYXRlcy5nZXQobmV0d29ya0lkKTtcbiAgICAgIGNvbnN0IHN0b3JlZERhdGEgPSBzdG9yZWRNZXNzYWdlLmRhdGFUeXBlID09PSBcInVtXCIgPyB0aGlzLmRhdGFGb3JVcGRhdGVNdWx0aU1lc3NhZ2UobmV0d29ya0lkLCBzdG9yZWRNZXNzYWdlKSA6IHN0b3JlZE1lc3NhZ2UuZGF0YTtcblxuICAgICAgLy8gQXZvaWQgdXBkYXRpbmcgY29tcG9uZW50cyBpZiB0aGUgZW50aXR5IGRhdGEgcmVjZWl2ZWQgZGlkIG5vdCBjb21lIGZyb20gdGhlIGN1cnJlbnQgb3duZXIuXG4gICAgICBjb25zdCBpc091dGRhdGVkTWVzc2FnZSA9IGRhdGEubGFzdE93bmVyVGltZSA8IHN0b3JlZERhdGEubGFzdE93bmVyVGltZTtcbiAgICAgIGNvbnN0IGlzQ29udGVtcG9yYW5lb3VzTWVzc2FnZSA9IGRhdGEubGFzdE93bmVyVGltZSA9PT0gc3RvcmVkRGF0YS5sYXN0T3duZXJUaW1lO1xuICAgICAgaWYgKGlzT3V0ZGF0ZWRNZXNzYWdlIHx8IChpc0NvbnRlbXBvcmFuZW91c01lc3NhZ2UgJiYgc3RvcmVkRGF0YS5vd25lciA+IGRhdGEub3duZXIpKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKGRhdGFUeXBlID09PSBcInJcIikge1xuICAgICAgICBjb25zdCBjcmVhdGVkV2hpbGVGcm96ZW4gPSBzdG9yZWREYXRhICYmIHN0b3JlZERhdGEuaXNGaXJzdFN5bmM7XG4gICAgICAgIGlmIChjcmVhdGVkV2hpbGVGcm96ZW4pIHtcbiAgICAgICAgICAvLyBJZiB0aGUgZW50aXR5IHdhcyBjcmVhdGVkIGFuZCBkZWxldGVkIHdoaWxlIGZyb3plbiwgZG9uJ3QgYm90aGVyIGNvbnZleWluZyBhbnl0aGluZyB0byB0aGUgY29uc3VtZXIuXG4gICAgICAgICAgdGhpcy5mcm96ZW5VcGRhdGVzLmRlbGV0ZShuZXR3b3JrSWQpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIERlbGV0ZSBtZXNzYWdlcyBvdmVycmlkZSBhbnkgb3RoZXIgbWVzc2FnZXMgZm9yIHRoaXMgZW50aXR5XG4gICAgICAgICAgdGhpcy5mcm96ZW5VcGRhdGVzLnNldChuZXR3b3JrSWQsIG1lc3NhZ2UpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBtZXJnZSBpbiBjb21wb25lbnQgdXBkYXRlc1xuICAgICAgICBpZiAoc3RvcmVkRGF0YS5jb21wb25lbnRzICYmIGRhdGEuY29tcG9uZW50cykge1xuICAgICAgICAgIE9iamVjdC5hc3NpZ24oc3RvcmVkRGF0YS5jb21wb25lbnRzLCBkYXRhLmNvbXBvbmVudHMpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgb25EYXRhQ2hhbm5lbE1lc3NhZ2UoZSwgc291cmNlKSB7XG4gICAgdGhpcy5vbkRhdGEoSlNPTi5wYXJzZShlLmRhdGEpLCBzb3VyY2UpO1xuICB9XG5cbiAgb25EYXRhKG1lc3NhZ2UsIHNvdXJjZSkge1xuICAgIGlmIChkZWJ1Zy5lbmFibGVkKSB7XG4gICAgICBkZWJ1ZyhgREMgaW46ICR7bWVzc2FnZX1gKTtcbiAgICB9XG5cbiAgICBpZiAoIW1lc3NhZ2UuZGF0YVR5cGUpIHJldHVybjtcblxuICAgIG1lc3NhZ2Uuc291cmNlID0gc291cmNlO1xuXG4gICAgaWYgKHRoaXMuZnJvemVuKSB7XG4gICAgICB0aGlzLnN0b3JlTWVzc2FnZShtZXNzYWdlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5vbk9jY3VwYW50TWVzc2FnZShudWxsLCBtZXNzYWdlLmRhdGFUeXBlLCBtZXNzYWdlLmRhdGEsIG1lc3NhZ2Uuc291cmNlKTtcbiAgICB9XG4gIH1cblxuICBzaG91bGRTdGFydENvbm5lY3Rpb25UbyhjbGllbnQpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIHN0YXJ0U3RyZWFtQ29ubmVjdGlvbihjbGllbnQpIHt9XG5cbiAgY2xvc2VTdHJlYW1Db25uZWN0aW9uKGNsaWVudCkge31cblxuICBnZXRDb25uZWN0U3RhdHVzKGNsaWVudElkKSB7XG4gICAgcmV0dXJuIHRoaXMub2NjdXBhbnRzW2NsaWVudElkXSA/IE5BRi5hZGFwdGVycy5JU19DT05ORUNURUQgOiBOQUYuYWRhcHRlcnMuTk9UX0NPTk5FQ1RFRDtcbiAgfVxuXG4gIGFzeW5jIHVwZGF0ZVRpbWVPZmZzZXQoKSB7XG4gICAgaWYgKHRoaXMuaXNEaXNjb25uZWN0ZWQoKSkgcmV0dXJuO1xuXG4gICAgY29uc3QgY2xpZW50U2VudFRpbWUgPSBEYXRlLm5vdygpO1xuXG4gICAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2goZG9jdW1lbnQubG9jYXRpb24uaHJlZiwge1xuICAgICAgbWV0aG9kOiBcIkhFQURcIixcbiAgICAgIGNhY2hlOiBcIm5vLWNhY2hlXCJcbiAgICB9KTtcblxuICAgIGNvbnN0IHByZWNpc2lvbiA9IDEwMDA7XG4gICAgY29uc3Qgc2VydmVyUmVjZWl2ZWRUaW1lID0gbmV3IERhdGUocmVzLmhlYWRlcnMuZ2V0KFwiRGF0ZVwiKSkuZ2V0VGltZSgpICsgcHJlY2lzaW9uIC8gMjtcbiAgICBjb25zdCBjbGllbnRSZWNlaXZlZFRpbWUgPSBEYXRlLm5vdygpO1xuICAgIGNvbnN0IHNlcnZlclRpbWUgPSBzZXJ2ZXJSZWNlaXZlZFRpbWUgKyAoY2xpZW50UmVjZWl2ZWRUaW1lIC0gY2xpZW50U2VudFRpbWUpIC8gMjtcbiAgICBjb25zdCB0aW1lT2Zmc2V0ID0gc2VydmVyVGltZSAtIGNsaWVudFJlY2VpdmVkVGltZTtcblxuICAgIHRoaXMuc2VydmVyVGltZVJlcXVlc3RzKys7XG5cbiAgICBpZiAodGhpcy5zZXJ2ZXJUaW1lUmVxdWVzdHMgPD0gMTApIHtcbiAgICAgIHRoaXMudGltZU9mZnNldHMucHVzaCh0aW1lT2Zmc2V0KTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy50aW1lT2Zmc2V0c1t0aGlzLnNlcnZlclRpbWVSZXF1ZXN0cyAlIDEwXSA9IHRpbWVPZmZzZXQ7XG4gICAgfVxuXG4gICAgdGhpcy5hdmdUaW1lT2Zmc2V0ID0gdGhpcy50aW1lT2Zmc2V0cy5yZWR1Y2UoKGFjYywgb2Zmc2V0KSA9PiAoYWNjICs9IG9mZnNldCksIDApIC8gdGhpcy50aW1lT2Zmc2V0cy5sZW5ndGg7XG5cbiAgICBpZiAodGhpcy5zZXJ2ZXJUaW1lUmVxdWVzdHMgPiAxMCkge1xuICAgICAgZGVidWcoYG5ldyBzZXJ2ZXIgdGltZSBvZmZzZXQ6ICR7dGhpcy5hdmdUaW1lT2Zmc2V0fW1zYCk7XG4gICAgICBzZXRUaW1lb3V0KCgpID0+IHRoaXMudXBkYXRlVGltZU9mZnNldCgpLCA1ICogNjAgKiAxMDAwKTsgLy8gU3luYyBjbG9jayBldmVyeSA1IG1pbnV0ZXMuXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMudXBkYXRlVGltZU9mZnNldCgpO1xuICAgIH1cbiAgfVxuXG4gIGdldFNlcnZlclRpbWUoKSB7XG4gICAgcmV0dXJuIERhdGUubm93KCkgKyB0aGlzLmF2Z1RpbWVPZmZzZXQ7XG4gIH1cblxuICBnZXRNZWRpYVN0cmVhbShjbGllbnRJZCwgdHlwZSA9IFwiYXVkaW9cIikge1xuICAgIGlmICh0aGlzLm1lZGlhU3RyZWFtc1tjbGllbnRJZF0pIHtcbiAgICAgIGRlYnVnKGBBbHJlYWR5IGhhZCAke3R5cGV9IGZvciAke2NsaWVudElkfWApO1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh0aGlzLm1lZGlhU3RyZWFtc1tjbGllbnRJZF1bdHlwZV0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBkZWJ1ZyhgV2FpdGluZyBvbiAke3R5cGV9IGZvciAke2NsaWVudElkfWApO1xuICAgICAgaWYgKCF0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmhhcyhjbGllbnRJZCkpIHtcbiAgICAgICAgdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5zZXQoY2xpZW50SWQsIHt9KTtcblxuICAgICAgICBjb25zdCBhdWRpb1Byb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgICAgdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5nZXQoY2xpZW50SWQpLmF1ZGlvID0geyByZXNvbHZlLCByZWplY3QgfTtcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IHZpZGVvUHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgICB0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmdldChjbGllbnRJZCkudmlkZW8gPSB7IHJlc29sdmUsIHJlamVjdCB9O1xuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmdldChjbGllbnRJZCkuYXVkaW8ucHJvbWlzZSA9IGF1ZGlvUHJvbWlzZTtcbiAgICAgICAgdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5nZXQoY2xpZW50SWQpLnZpZGVvLnByb21pc2UgPSB2aWRlb1Byb21pc2U7XG5cbiAgICAgICAgYXVkaW9Qcm9taXNlLmNhdGNoKGUgPT4gY29uc29sZS53YXJuKGAke2NsaWVudElkfSBnZXRNZWRpYVN0cmVhbSBBdWRpbyBFcnJvcmAsIGUpKTtcbiAgICAgICAgdmlkZW9Qcm9taXNlLmNhdGNoKGUgPT4gY29uc29sZS53YXJuKGAke2NsaWVudElkfSBnZXRNZWRpYVN0cmVhbSBWaWRlbyBFcnJvcmAsIGUpKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmdldChjbGllbnRJZClbdHlwZV0ucHJvbWlzZTtcbiAgICB9XG4gIH1cblxuICBzZXRNZWRpYVN0cmVhbShjbGllbnRJZCwgc3RyZWFtKSB7XG4gICAgLy8gU2FmYXJpIGRvZXNuJ3QgbGlrZSBpdCB3aGVuIHlvdSB1c2Ugc2luZ2xlIGEgbWl4ZWQgbWVkaWEgc3RyZWFtIHdoZXJlIG9uZSBvZiB0aGUgdHJhY2tzIGlzIGluYWN0aXZlLCBzbyB3ZVxuICAgIC8vIHNwbGl0IHRoZSB0cmFja3MgaW50byB0d28gc3RyZWFtcy5cbiAgICBjb25zdCBhdWRpb1N0cmVhbSA9IG5ldyBNZWRpYVN0cmVhbSgpO1xuICAgIHRyeSB7XG4gICAgc3RyZWFtLmdldEF1ZGlvVHJhY2tzKCkuZm9yRWFjaCh0cmFjayA9PiBhdWRpb1N0cmVhbS5hZGRUcmFjayh0cmFjaykpO1xuXG4gICAgfSBjYXRjaChlKSB7XG4gICAgICBjb25zb2xlLndhcm4oYCR7Y2xpZW50SWR9IHNldE1lZGlhU3RyZWFtIEF1ZGlvIEVycm9yYCwgZSk7XG4gICAgfVxuICAgIGNvbnN0IHZpZGVvU3RyZWFtID0gbmV3IE1lZGlhU3RyZWFtKCk7XG4gICAgdHJ5IHtcbiAgICBzdHJlYW0uZ2V0VmlkZW9UcmFja3MoKS5mb3JFYWNoKHRyYWNrID0+IHZpZGVvU3RyZWFtLmFkZFRyYWNrKHRyYWNrKSk7XG5cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjb25zb2xlLndhcm4oYCR7Y2xpZW50SWR9IHNldE1lZGlhU3RyZWFtIFZpZGVvIEVycm9yYCwgZSk7XG4gICAgfVxuXG4gICAgdGhpcy5tZWRpYVN0cmVhbXNbY2xpZW50SWRdID0geyBhdWRpbzogYXVkaW9TdHJlYW0sIHZpZGVvOiB2aWRlb1N0cmVhbSB9O1xuXG4gICAgLy8gUmVzb2x2ZSB0aGUgcHJvbWlzZSBmb3IgdGhlIHVzZXIncyBtZWRpYSBzdHJlYW0gaWYgaXQgZXhpc3RzLlxuICAgIGlmICh0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmhhcyhjbGllbnRJZCkpIHtcbiAgICAgIHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuZ2V0KGNsaWVudElkKS5hdWRpby5yZXNvbHZlKGF1ZGlvU3RyZWFtKTtcbiAgICAgIHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuZ2V0KGNsaWVudElkKS52aWRlby5yZXNvbHZlKHZpZGVvU3RyZWFtKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBzZXRMb2NhbE1lZGlhU3RyZWFtKHN0cmVhbSkge1xuICAgIC8vIG91ciBqb2IgaGVyZSBpcyB0byBtYWtlIHN1cmUgdGhlIGNvbm5lY3Rpb24gd2luZHMgdXAgd2l0aCBSVFAgc2VuZGVycyBzZW5kaW5nIHRoZSBzdHVmZiBpbiB0aGlzIHN0cmVhbSxcbiAgICAvLyBhbmQgbm90IHRoZSBzdHVmZiB0aGF0IGlzbid0IGluIHRoaXMgc3RyZWFtLiBzdHJhdGVneSBpcyB0byByZXBsYWNlIGV4aXN0aW5nIHRyYWNrcyBpZiB3ZSBjYW4sIGFkZCB0cmFja3NcbiAgICAvLyB0aGF0IHdlIGNhbid0IHJlcGxhY2UsIGFuZCBkaXNhYmxlIHRyYWNrcyB0aGF0IGRvbid0IGV4aXN0IGFueW1vcmUuXG5cbiAgICAvLyBub3RlIHRoYXQgd2UgZG9uJ3QgZXZlciByZW1vdmUgYSB0cmFjayBmcm9tIHRoZSBzdHJlYW0gLS0gc2luY2UgSmFudXMgZG9lc24ndCBzdXBwb3J0IFVuaWZpZWQgUGxhbiwgd2UgYWJzb2x1dGVseVxuICAgIC8vIGNhbid0IHdpbmQgdXAgd2l0aCBhIFNEUCB0aGF0IGhhcyA+MSBhdWRpbyBvciA+MSB2aWRlbyB0cmFja3MsIGV2ZW4gaWYgb25lIG9mIHRoZW0gaXMgaW5hY3RpdmUgKHdoYXQgeW91IGdldCBpZlxuICAgIC8vIHlvdSByZW1vdmUgYSB0cmFjayBmcm9tIGFuIGV4aXN0aW5nIHN0cmVhbS4pXG4gICAgaWYgKHRoaXMucHVibGlzaGVyICYmIHRoaXMucHVibGlzaGVyLmNvbm4pIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nU2VuZGVycyA9IHRoaXMucHVibGlzaGVyLmNvbm4uZ2V0U2VuZGVycygpO1xuICAgICAgY29uc3QgbmV3U2VuZGVycyA9IFtdO1xuICAgICAgY29uc3QgdHJhY2tzID0gc3RyZWFtLmdldFRyYWNrcygpO1xuXG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRyYWNrcy5sZW5ndGg7IGkrKykge1xuICAgICAgICBjb25zdCB0ID0gdHJhY2tzW2ldO1xuICAgICAgICBjb25zdCBzZW5kZXIgPSBleGlzdGluZ1NlbmRlcnMuZmluZChzID0+IHMudHJhY2sgIT0gbnVsbCAmJiBzLnRyYWNrLmtpbmQgPT0gdC5raW5kKTtcblxuICAgICAgICBpZiAoc2VuZGVyICE9IG51bGwpIHtcbiAgICAgICAgICBpZiAoc2VuZGVyLnJlcGxhY2VUcmFjaykge1xuICAgICAgICAgICAgYXdhaXQgc2VuZGVyLnJlcGxhY2VUcmFjayh0KTtcblxuICAgICAgICAgICAgLy8gV29ya2Fyb3VuZCBodHRwczovL2J1Z3ppbGxhLm1vemlsbGEub3JnL3Nob3dfYnVnLmNnaT9pZD0xNTc2NzcxXG4gICAgICAgICAgICBpZiAodC5raW5kID09PSBcInZpZGVvXCIgJiYgdC5lbmFibGVkICYmIG5hdmlnYXRvci51c2VyQWdlbnQudG9Mb3dlckNhc2UoKS5pbmRleE9mKCdmaXJlZm94JykgPiAtMSkge1xuICAgICAgICAgICAgICB0LmVuYWJsZWQgPSBmYWxzZTtcbiAgICAgICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB0LmVuYWJsZWQgPSB0cnVlLCAxMDAwKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gRmFsbGJhY2sgZm9yIGJyb3dzZXJzIHRoYXQgZG9uJ3Qgc3VwcG9ydCByZXBsYWNlVHJhY2suIEF0IHRoaXMgdGltZSBvZiB0aGlzIHdyaXRpbmdcbiAgICAgICAgICAgIC8vIG1vc3QgYnJvd3NlcnMgc3VwcG9ydCBpdCwgYW5kIHRlc3RpbmcgdGhpcyBjb2RlIHBhdGggc2VlbXMgdG8gbm90IHdvcmsgcHJvcGVybHlcbiAgICAgICAgICAgIC8vIGluIENocm9tZSBhbnltb3JlLlxuICAgICAgICAgICAgc3RyZWFtLnJlbW92ZVRyYWNrKHNlbmRlci50cmFjayk7XG4gICAgICAgICAgICBzdHJlYW0uYWRkVHJhY2sodCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIG5ld1NlbmRlcnMucHVzaChzZW5kZXIpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIG5ld1NlbmRlcnMucHVzaCh0aGlzLnB1Ymxpc2hlci5jb25uLmFkZFRyYWNrKHQsIHN0cmVhbSkpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBleGlzdGluZ1NlbmRlcnMuZm9yRWFjaChzID0+IHtcbiAgICAgICAgaWYgKCFuZXdTZW5kZXJzLmluY2x1ZGVzKHMpKSB7XG4gICAgICAgICAgcy50cmFjay5lbmFibGVkID0gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgICB0aGlzLmxvY2FsTWVkaWFTdHJlYW0gPSBzdHJlYW07XG4gICAgdGhpcy5zZXRNZWRpYVN0cmVhbSh0aGlzLmNsaWVudElkLCBzdHJlYW0pO1xuICB9XG5cbiAgZW5hYmxlTWljcm9waG9uZShlbmFibGVkKSB7XG4gICAgaWYgKHRoaXMucHVibGlzaGVyICYmIHRoaXMucHVibGlzaGVyLmNvbm4pIHtcbiAgICAgIHRoaXMucHVibGlzaGVyLmNvbm4uZ2V0U2VuZGVycygpLmZvckVhY2gocyA9PiB7XG4gICAgICAgIGlmIChzLnRyYWNrLmtpbmQgPT0gXCJhdWRpb1wiKSB7XG4gICAgICAgICAgcy50cmFjay5lbmFibGVkID0gZW5hYmxlZDtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgc2VuZERhdGEoY2xpZW50SWQsIGRhdGFUeXBlLCBkYXRhKSB7XG4gICAgaWYgKCF0aGlzLnB1Ymxpc2hlcikge1xuICAgICAgY29uc29sZS53YXJuKFwic2VuZERhdGEgY2FsbGVkIHdpdGhvdXQgYSBwdWJsaXNoZXJcIik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHN3aXRjaCAodGhpcy51bnJlbGlhYmxlVHJhbnNwb3J0KSB7XG4gICAgICAgIGNhc2UgXCJ3ZWJzb2NrZXRcIjpcbiAgICAgICAgICB0aGlzLnB1Ymxpc2hlci5oYW5kbGUuc2VuZE1lc3NhZ2UoeyBraW5kOiBcImRhdGFcIiwgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBkYXRhVHlwZSwgZGF0YSB9KSwgd2hvbTogY2xpZW50SWQgfSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgXCJkYXRhY2hhbm5lbFwiOlxuICAgICAgICAgIHRoaXMucHVibGlzaGVyLnVucmVsaWFibGVDaGFubmVsLnNlbmQoSlNPTi5zdHJpbmdpZnkoeyBjbGllbnRJZCwgZGF0YVR5cGUsIGRhdGEgfSkpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHRoaXMudW5yZWxpYWJsZVRyYW5zcG9ydChjbGllbnRJZCwgZGF0YVR5cGUsIGRhdGEpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHNlbmREYXRhR3VhcmFudGVlZChjbGllbnRJZCwgZGF0YVR5cGUsIGRhdGEpIHtcbiAgICBpZiAoIXRoaXMucHVibGlzaGVyKSB7XG4gICAgICBjb25zb2xlLndhcm4oXCJzZW5kRGF0YUd1YXJhbnRlZWQgY2FsbGVkIHdpdGhvdXQgYSBwdWJsaXNoZXJcIik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHN3aXRjaCAodGhpcy5yZWxpYWJsZVRyYW5zcG9ydCkge1xuICAgICAgICBjYXNlIFwid2Vic29ja2V0XCI6XG4gICAgICAgICAgdGhpcy5wdWJsaXNoZXIuaGFuZGxlLnNlbmRNZXNzYWdlKHsga2luZDogXCJkYXRhXCIsIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZGF0YVR5cGUsIGRhdGEgfSksIHdob206IGNsaWVudElkIH0pO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIFwiZGF0YWNoYW5uZWxcIjpcbiAgICAgICAgICB0aGlzLnB1Ymxpc2hlci5yZWxpYWJsZUNoYW5uZWwuc2VuZChKU09OLnN0cmluZ2lmeSh7IGNsaWVudElkLCBkYXRhVHlwZSwgZGF0YSB9KSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgdGhpcy5yZWxpYWJsZVRyYW5zcG9ydChjbGllbnRJZCwgZGF0YVR5cGUsIGRhdGEpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGJyb2FkY2FzdERhdGEoZGF0YVR5cGUsIGRhdGEpIHtcbiAgICBpZiAoIXRoaXMucHVibGlzaGVyKSB7XG4gICAgICBjb25zb2xlLndhcm4oXCJicm9hZGNhc3REYXRhIGNhbGxlZCB3aXRob3V0IGEgcHVibGlzaGVyXCIpO1xuICAgIH0gZWxzZSB7XG4gICAgICBzd2l0Y2ggKHRoaXMudW5yZWxpYWJsZVRyYW5zcG9ydCkge1xuICAgICAgICBjYXNlIFwid2Vic29ja2V0XCI6XG4gICAgICAgICAgdGhpcy5wdWJsaXNoZXIuaGFuZGxlLnNlbmRNZXNzYWdlKHsga2luZDogXCJkYXRhXCIsIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZGF0YVR5cGUsIGRhdGEgfSkgfSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgXCJkYXRhY2hhbm5lbFwiOlxuICAgICAgICAgIHRoaXMucHVibGlzaGVyLnVucmVsaWFibGVDaGFubmVsLnNlbmQoSlNPTi5zdHJpbmdpZnkoeyBkYXRhVHlwZSwgZGF0YSB9KSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgdGhpcy51bnJlbGlhYmxlVHJhbnNwb3J0KHVuZGVmaW5lZCwgZGF0YVR5cGUsIGRhdGEpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGJyb2FkY2FzdERhdGFHdWFyYW50ZWVkKGRhdGFUeXBlLCBkYXRhKSB7XG4gICAgaWYgKCF0aGlzLnB1Ymxpc2hlcikge1xuICAgICAgY29uc29sZS53YXJuKFwiYnJvYWRjYXN0RGF0YUd1YXJhbnRlZWQgY2FsbGVkIHdpdGhvdXQgYSBwdWJsaXNoZXJcIik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHN3aXRjaCAodGhpcy5yZWxpYWJsZVRyYW5zcG9ydCkge1xuICAgICAgICBjYXNlIFwid2Vic29ja2V0XCI6XG4gICAgICAgICAgdGhpcy5wdWJsaXNoZXIuaGFuZGxlLnNlbmRNZXNzYWdlKHsga2luZDogXCJkYXRhXCIsIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZGF0YVR5cGUsIGRhdGEgfSkgfSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgXCJkYXRhY2hhbm5lbFwiOlxuICAgICAgICAgIHRoaXMucHVibGlzaGVyLnJlbGlhYmxlQ2hhbm5lbC5zZW5kKEpTT04uc3RyaW5naWZ5KHsgZGF0YVR5cGUsIGRhdGEgfSkpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHRoaXMucmVsaWFibGVUcmFuc3BvcnQodW5kZWZpbmVkLCBkYXRhVHlwZSwgZGF0YSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAga2ljayhjbGllbnRJZCwgcGVybXNUb2tlbikge1xuICAgIHJldHVybiB0aGlzLnB1Ymxpc2hlci5oYW5kbGUuc2VuZE1lc3NhZ2UoeyBraW5kOiBcImtpY2tcIiwgcm9vbV9pZDogdGhpcy5yb29tLCB1c2VyX2lkOiBjbGllbnRJZCwgdG9rZW46IHBlcm1zVG9rZW4gfSkudGhlbigoKSA9PiB7XG4gICAgICBkb2N1bWVudC5ib2R5LmRpc3BhdGNoRXZlbnQobmV3IEN1c3RvbUV2ZW50KFwia2lja2VkXCIsIHsgZGV0YWlsOiB7IGNsaWVudElkOiBjbGllbnRJZCB9IH0pKTtcbiAgICB9KTtcbiAgfVxuXG4gIGJsb2NrKGNsaWVudElkKSB7XG4gICAgcmV0dXJuIHRoaXMucHVibGlzaGVyLmhhbmRsZS5zZW5kTWVzc2FnZSh7IGtpbmQ6IFwiYmxvY2tcIiwgd2hvbTogY2xpZW50SWQgfSkudGhlbigoKSA9PiB7XG4gICAgICB0aGlzLmJsb2NrZWRDbGllbnRzLnNldChjbGllbnRJZCwgdHJ1ZSk7XG4gICAgICBkb2N1bWVudC5ib2R5LmRpc3BhdGNoRXZlbnQobmV3IEN1c3RvbUV2ZW50KFwiYmxvY2tlZFwiLCB7IGRldGFpbDogeyBjbGllbnRJZDogY2xpZW50SWQgfSB9KSk7XG4gICAgfSk7XG4gIH1cblxuICB1bmJsb2NrKGNsaWVudElkKSB7XG4gICAgcmV0dXJuIHRoaXMucHVibGlzaGVyLmhhbmRsZS5zZW5kTWVzc2FnZSh7IGtpbmQ6IFwidW5ibG9ja1wiLCB3aG9tOiBjbGllbnRJZCB9KS50aGVuKCgpID0+IHtcbiAgICAgIHRoaXMuYmxvY2tlZENsaWVudHMuZGVsZXRlKGNsaWVudElkKTtcbiAgICAgIGRvY3VtZW50LmJvZHkuZGlzcGF0Y2hFdmVudChuZXcgQ3VzdG9tRXZlbnQoXCJ1bmJsb2NrZWRcIiwgeyBkZXRhaWw6IHsgY2xpZW50SWQ6IGNsaWVudElkIH0gfSkpO1xuICAgIH0pO1xuICB9XG59XG5cbk5BRi5hZGFwdGVycy5yZWdpc3RlcihcImphbnVzXCIsIEphbnVzQWRhcHRlcik7XG5cbm1vZHVsZS5leHBvcnRzID0gSmFudXNBZGFwdGVyO1xuIiwiLyogZXNsaW50LWVudiBicm93c2VyICovXG5cbi8qKlxuICogVGhpcyBpcyB0aGUgd2ViIGJyb3dzZXIgaW1wbGVtZW50YXRpb24gb2YgYGRlYnVnKClgLlxuICovXG5cbmV4cG9ydHMuZm9ybWF0QXJncyA9IGZvcm1hdEFyZ3M7XG5leHBvcnRzLnNhdmUgPSBzYXZlO1xuZXhwb3J0cy5sb2FkID0gbG9hZDtcbmV4cG9ydHMudXNlQ29sb3JzID0gdXNlQ29sb3JzO1xuZXhwb3J0cy5zdG9yYWdlID0gbG9jYWxzdG9yYWdlKCk7XG5leHBvcnRzLmRlc3Ryb3kgPSAoKCkgPT4ge1xuXHRsZXQgd2FybmVkID0gZmFsc2U7XG5cblx0cmV0dXJuICgpID0+IHtcblx0XHRpZiAoIXdhcm5lZCkge1xuXHRcdFx0d2FybmVkID0gdHJ1ZTtcblx0XHRcdGNvbnNvbGUud2FybignSW5zdGFuY2UgbWV0aG9kIGBkZWJ1Zy5kZXN0cm95KClgIGlzIGRlcHJlY2F0ZWQgYW5kIG5vIGxvbmdlciBkb2VzIGFueXRoaW5nLiBJdCB3aWxsIGJlIHJlbW92ZWQgaW4gdGhlIG5leHQgbWFqb3IgdmVyc2lvbiBvZiBgZGVidWdgLicpO1xuXHRcdH1cblx0fTtcbn0pKCk7XG5cbi8qKlxuICogQ29sb3JzLlxuICovXG5cbmV4cG9ydHMuY29sb3JzID0gW1xuXHQnIzAwMDBDQycsXG5cdCcjMDAwMEZGJyxcblx0JyMwMDMzQ0MnLFxuXHQnIzAwMzNGRicsXG5cdCcjMDA2NkNDJyxcblx0JyMwMDY2RkYnLFxuXHQnIzAwOTlDQycsXG5cdCcjMDA5OUZGJyxcblx0JyMwMENDMDAnLFxuXHQnIzAwQ0MzMycsXG5cdCcjMDBDQzY2Jyxcblx0JyMwMENDOTknLFxuXHQnIzAwQ0NDQycsXG5cdCcjMDBDQ0ZGJyxcblx0JyMzMzAwQ0MnLFxuXHQnIzMzMDBGRicsXG5cdCcjMzMzM0NDJyxcblx0JyMzMzMzRkYnLFxuXHQnIzMzNjZDQycsXG5cdCcjMzM2NkZGJyxcblx0JyMzMzk5Q0MnLFxuXHQnIzMzOTlGRicsXG5cdCcjMzNDQzAwJyxcblx0JyMzM0NDMzMnLFxuXHQnIzMzQ0M2NicsXG5cdCcjMzNDQzk5Jyxcblx0JyMzM0NDQ0MnLFxuXHQnIzMzQ0NGRicsXG5cdCcjNjYwMENDJyxcblx0JyM2NjAwRkYnLFxuXHQnIzY2MzNDQycsXG5cdCcjNjYzM0ZGJyxcblx0JyM2NkNDMDAnLFxuXHQnIzY2Q0MzMycsXG5cdCcjOTkwMENDJyxcblx0JyM5OTAwRkYnLFxuXHQnIzk5MzNDQycsXG5cdCcjOTkzM0ZGJyxcblx0JyM5OUNDMDAnLFxuXHQnIzk5Q0MzMycsXG5cdCcjQ0MwMDAwJyxcblx0JyNDQzAwMzMnLFxuXHQnI0NDMDA2NicsXG5cdCcjQ0MwMDk5Jyxcblx0JyNDQzAwQ0MnLFxuXHQnI0NDMDBGRicsXG5cdCcjQ0MzMzAwJyxcblx0JyNDQzMzMzMnLFxuXHQnI0NDMzM2NicsXG5cdCcjQ0MzMzk5Jyxcblx0JyNDQzMzQ0MnLFxuXHQnI0NDMzNGRicsXG5cdCcjQ0M2NjAwJyxcblx0JyNDQzY2MzMnLFxuXHQnI0NDOTkwMCcsXG5cdCcjQ0M5OTMzJyxcblx0JyNDQ0NDMDAnLFxuXHQnI0NDQ0MzMycsXG5cdCcjRkYwMDAwJyxcblx0JyNGRjAwMzMnLFxuXHQnI0ZGMDA2NicsXG5cdCcjRkYwMDk5Jyxcblx0JyNGRjAwQ0MnLFxuXHQnI0ZGMDBGRicsXG5cdCcjRkYzMzAwJyxcblx0JyNGRjMzMzMnLFxuXHQnI0ZGMzM2NicsXG5cdCcjRkYzMzk5Jyxcblx0JyNGRjMzQ0MnLFxuXHQnI0ZGMzNGRicsXG5cdCcjRkY2NjAwJyxcblx0JyNGRjY2MzMnLFxuXHQnI0ZGOTkwMCcsXG5cdCcjRkY5OTMzJyxcblx0JyNGRkNDMDAnLFxuXHQnI0ZGQ0MzMydcbl07XG5cbi8qKlxuICogQ3VycmVudGx5IG9ubHkgV2ViS2l0LWJhc2VkIFdlYiBJbnNwZWN0b3JzLCBGaXJlZm94ID49IHYzMSxcbiAqIGFuZCB0aGUgRmlyZWJ1ZyBleHRlbnNpb24gKGFueSBGaXJlZm94IHZlcnNpb24pIGFyZSBrbm93blxuICogdG8gc3VwcG9ydCBcIiVjXCIgQ1NTIGN1c3RvbWl6YXRpb25zLlxuICpcbiAqIFRPRE86IGFkZCBhIGBsb2NhbFN0b3JhZ2VgIHZhcmlhYmxlIHRvIGV4cGxpY2l0bHkgZW5hYmxlL2Rpc2FibGUgY29sb3JzXG4gKi9cblxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIGNvbXBsZXhpdHlcbmZ1bmN0aW9uIHVzZUNvbG9ycygpIHtcblx0Ly8gTkI6IEluIGFuIEVsZWN0cm9uIHByZWxvYWQgc2NyaXB0LCBkb2N1bWVudCB3aWxsIGJlIGRlZmluZWQgYnV0IG5vdCBmdWxseVxuXHQvLyBpbml0aWFsaXplZC4gU2luY2Ugd2Uga25vdyB3ZSdyZSBpbiBDaHJvbWUsIHdlJ2xsIGp1c3QgZGV0ZWN0IHRoaXMgY2FzZVxuXHQvLyBleHBsaWNpdGx5XG5cdGlmICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyAmJiB3aW5kb3cucHJvY2VzcyAmJiAod2luZG93LnByb2Nlc3MudHlwZSA9PT0gJ3JlbmRlcmVyJyB8fCB3aW5kb3cucHJvY2Vzcy5fX253anMpKSB7XG5cdFx0cmV0dXJuIHRydWU7XG5cdH1cblxuXHQvLyBJbnRlcm5ldCBFeHBsb3JlciBhbmQgRWRnZSBkbyBub3Qgc3VwcG9ydCBjb2xvcnMuXG5cdGlmICh0eXBlb2YgbmF2aWdhdG9yICE9PSAndW5kZWZpbmVkJyAmJiBuYXZpZ2F0b3IudXNlckFnZW50ICYmIG5hdmlnYXRvci51c2VyQWdlbnQudG9Mb3dlckNhc2UoKS5tYXRjaCgvKGVkZ2V8dHJpZGVudClcXC8oXFxkKykvKSkge1xuXHRcdHJldHVybiBmYWxzZTtcblx0fVxuXG5cdC8vIElzIHdlYmtpdD8gaHR0cDovL3N0YWNrb3ZlcmZsb3cuY29tL2EvMTY0NTk2MDYvMzc2NzczXG5cdC8vIGRvY3VtZW50IGlzIHVuZGVmaW5lZCBpbiByZWFjdC1uYXRpdmU6IGh0dHBzOi8vZ2l0aHViLmNvbS9mYWNlYm9vay9yZWFjdC1uYXRpdmUvcHVsbC8xNjMyXG5cdHJldHVybiAodHlwZW9mIGRvY3VtZW50ICE9PSAndW5kZWZpbmVkJyAmJiBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQgJiYgZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LnN0eWxlICYmIGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5zdHlsZS5XZWJraXRBcHBlYXJhbmNlKSB8fFxuXHRcdC8vIElzIGZpcmVidWc/IGh0dHA6Ly9zdGFja292ZXJmbG93LmNvbS9hLzM5ODEyMC8zNzY3NzNcblx0XHQodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgJiYgd2luZG93LmNvbnNvbGUgJiYgKHdpbmRvdy5jb25zb2xlLmZpcmVidWcgfHwgKHdpbmRvdy5jb25zb2xlLmV4Y2VwdGlvbiAmJiB3aW5kb3cuY29uc29sZS50YWJsZSkpKSB8fFxuXHRcdC8vIElzIGZpcmVmb3ggPj0gdjMxP1xuXHRcdC8vIGh0dHBzOi8vZGV2ZWxvcGVyLm1vemlsbGEub3JnL2VuLVVTL2RvY3MvVG9vbHMvV2ViX0NvbnNvbGUjU3R5bGluZ19tZXNzYWdlc1xuXHRcdCh0eXBlb2YgbmF2aWdhdG9yICE9PSAndW5kZWZpbmVkJyAmJiBuYXZpZ2F0b3IudXNlckFnZW50ICYmIG5hdmlnYXRvci51c2VyQWdlbnQudG9Mb3dlckNhc2UoKS5tYXRjaCgvZmlyZWZveFxcLyhcXGQrKS8pICYmIHBhcnNlSW50KFJlZ0V4cC4kMSwgMTApID49IDMxKSB8fFxuXHRcdC8vIERvdWJsZSBjaGVjayB3ZWJraXQgaW4gdXNlckFnZW50IGp1c3QgaW4gY2FzZSB3ZSBhcmUgaW4gYSB3b3JrZXJcblx0XHQodHlwZW9mIG5hdmlnYXRvciAhPT0gJ3VuZGVmaW5lZCcgJiYgbmF2aWdhdG9yLnVzZXJBZ2VudCAmJiBuYXZpZ2F0b3IudXNlckFnZW50LnRvTG93ZXJDYXNlKCkubWF0Y2goL2FwcGxld2Via2l0XFwvKFxcZCspLykpO1xufVxuXG4vKipcbiAqIENvbG9yaXplIGxvZyBhcmd1bWVudHMgaWYgZW5hYmxlZC5cbiAqXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbmZ1bmN0aW9uIGZvcm1hdEFyZ3MoYXJncykge1xuXHRhcmdzWzBdID0gKHRoaXMudXNlQ29sb3JzID8gJyVjJyA6ICcnKSArXG5cdFx0dGhpcy5uYW1lc3BhY2UgK1xuXHRcdCh0aGlzLnVzZUNvbG9ycyA/ICcgJWMnIDogJyAnKSArXG5cdFx0YXJnc1swXSArXG5cdFx0KHRoaXMudXNlQ29sb3JzID8gJyVjICcgOiAnICcpICtcblx0XHQnKycgKyBtb2R1bGUuZXhwb3J0cy5odW1hbml6ZSh0aGlzLmRpZmYpO1xuXG5cdGlmICghdGhpcy51c2VDb2xvcnMpIHtcblx0XHRyZXR1cm47XG5cdH1cblxuXHRjb25zdCBjID0gJ2NvbG9yOiAnICsgdGhpcy5jb2xvcjtcblx0YXJncy5zcGxpY2UoMSwgMCwgYywgJ2NvbG9yOiBpbmhlcml0Jyk7XG5cblx0Ly8gVGhlIGZpbmFsIFwiJWNcIiBpcyBzb21ld2hhdCB0cmlja3ksIGJlY2F1c2UgdGhlcmUgY291bGQgYmUgb3RoZXJcblx0Ly8gYXJndW1lbnRzIHBhc3NlZCBlaXRoZXIgYmVmb3JlIG9yIGFmdGVyIHRoZSAlYywgc28gd2UgbmVlZCB0b1xuXHQvLyBmaWd1cmUgb3V0IHRoZSBjb3JyZWN0IGluZGV4IHRvIGluc2VydCB0aGUgQ1NTIGludG9cblx0bGV0IGluZGV4ID0gMDtcblx0bGV0IGxhc3RDID0gMDtcblx0YXJnc1swXS5yZXBsYWNlKC8lW2EtekEtWiVdL2csIG1hdGNoID0+IHtcblx0XHRpZiAobWF0Y2ggPT09ICclJScpIHtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0aW5kZXgrKztcblx0XHRpZiAobWF0Y2ggPT09ICclYycpIHtcblx0XHRcdC8vIFdlIG9ubHkgYXJlIGludGVyZXN0ZWQgaW4gdGhlICpsYXN0KiAlY1xuXHRcdFx0Ly8gKHRoZSB1c2VyIG1heSBoYXZlIHByb3ZpZGVkIHRoZWlyIG93bilcblx0XHRcdGxhc3RDID0gaW5kZXg7XG5cdFx0fVxuXHR9KTtcblxuXHRhcmdzLnNwbGljZShsYXN0QywgMCwgYyk7XG59XG5cbi8qKlxuICogSW52b2tlcyBgY29uc29sZS5kZWJ1ZygpYCB3aGVuIGF2YWlsYWJsZS5cbiAqIE5vLW9wIHdoZW4gYGNvbnNvbGUuZGVidWdgIGlzIG5vdCBhIFwiZnVuY3Rpb25cIi5cbiAqIElmIGBjb25zb2xlLmRlYnVnYCBpcyBub3QgYXZhaWxhYmxlLCBmYWxscyBiYWNrXG4gKiB0byBgY29uc29sZS5sb2dgLlxuICpcbiAqIEBhcGkgcHVibGljXG4gKi9cbmV4cG9ydHMubG9nID0gY29uc29sZS5kZWJ1ZyB8fCBjb25zb2xlLmxvZyB8fCAoKCkgPT4ge30pO1xuXG4vKipcbiAqIFNhdmUgYG5hbWVzcGFjZXNgLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lc3BhY2VzXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuZnVuY3Rpb24gc2F2ZShuYW1lc3BhY2VzKSB7XG5cdHRyeSB7XG5cdFx0aWYgKG5hbWVzcGFjZXMpIHtcblx0XHRcdGV4cG9ydHMuc3RvcmFnZS5zZXRJdGVtKCdkZWJ1ZycsIG5hbWVzcGFjZXMpO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHRleHBvcnRzLnN0b3JhZ2UucmVtb3ZlSXRlbSgnZGVidWcnKTtcblx0XHR9XG5cdH0gY2F0Y2ggKGVycm9yKSB7XG5cdFx0Ly8gU3dhbGxvd1xuXHRcdC8vIFhYWCAoQFFpeC0pIHNob3VsZCB3ZSBiZSBsb2dnaW5nIHRoZXNlP1xuXHR9XG59XG5cbi8qKlxuICogTG9hZCBgbmFtZXNwYWNlc2AuXG4gKlxuICogQHJldHVybiB7U3RyaW5nfSByZXR1cm5zIHRoZSBwcmV2aW91c2x5IHBlcnNpc3RlZCBkZWJ1ZyBtb2Rlc1xuICogQGFwaSBwcml2YXRlXG4gKi9cbmZ1bmN0aW9uIGxvYWQoKSB7XG5cdGxldCByO1xuXHR0cnkge1xuXHRcdHIgPSBleHBvcnRzLnN0b3JhZ2UuZ2V0SXRlbSgnZGVidWcnKTtcblx0fSBjYXRjaCAoZXJyb3IpIHtcblx0XHQvLyBTd2FsbG93XG5cdFx0Ly8gWFhYIChAUWl4LSkgc2hvdWxkIHdlIGJlIGxvZ2dpbmcgdGhlc2U/XG5cdH1cblxuXHQvLyBJZiBkZWJ1ZyBpc24ndCBzZXQgaW4gTFMsIGFuZCB3ZSdyZSBpbiBFbGVjdHJvbiwgdHJ5IHRvIGxvYWQgJERFQlVHXG5cdGlmICghciAmJiB0eXBlb2YgcHJvY2VzcyAhPT0gJ3VuZGVmaW5lZCcgJiYgJ2VudicgaW4gcHJvY2Vzcykge1xuXHRcdHIgPSBwcm9jZXNzLmVudi5ERUJVRztcblx0fVxuXG5cdHJldHVybiByO1xufVxuXG4vKipcbiAqIExvY2Fsc3RvcmFnZSBhdHRlbXB0cyB0byByZXR1cm4gdGhlIGxvY2Fsc3RvcmFnZS5cbiAqXG4gKiBUaGlzIGlzIG5lY2Vzc2FyeSBiZWNhdXNlIHNhZmFyaSB0aHJvd3NcbiAqIHdoZW4gYSB1c2VyIGRpc2FibGVzIGNvb2tpZXMvbG9jYWxzdG9yYWdlXG4gKiBhbmQgeW91IGF0dGVtcHQgdG8gYWNjZXNzIGl0LlxuICpcbiAqIEByZXR1cm4ge0xvY2FsU3RvcmFnZX1cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIGxvY2Fsc3RvcmFnZSgpIHtcblx0dHJ5IHtcblx0XHQvLyBUVk1MS2l0IChBcHBsZSBUViBKUyBSdW50aW1lKSBkb2VzIG5vdCBoYXZlIGEgd2luZG93IG9iamVjdCwganVzdCBsb2NhbFN0b3JhZ2UgaW4gdGhlIGdsb2JhbCBjb250ZXh0XG5cdFx0Ly8gVGhlIEJyb3dzZXIgYWxzbyBoYXMgbG9jYWxTdG9yYWdlIGluIHRoZSBnbG9iYWwgY29udGV4dC5cblx0XHRyZXR1cm4gbG9jYWxTdG9yYWdlO1xuXHR9IGNhdGNoIChlcnJvcikge1xuXHRcdC8vIFN3YWxsb3dcblx0XHQvLyBYWFggKEBRaXgtKSBzaG91bGQgd2UgYmUgbG9nZ2luZyB0aGVzZT9cblx0fVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoJy4vY29tbW9uJykoZXhwb3J0cyk7XG5cbmNvbnN0IHtmb3JtYXR0ZXJzfSA9IG1vZHVsZS5leHBvcnRzO1xuXG4vKipcbiAqIE1hcCAlaiB0byBgSlNPTi5zdHJpbmdpZnkoKWAsIHNpbmNlIG5vIFdlYiBJbnNwZWN0b3JzIGRvIHRoYXQgYnkgZGVmYXVsdC5cbiAqL1xuXG5mb3JtYXR0ZXJzLmogPSBmdW5jdGlvbiAodikge1xuXHR0cnkge1xuXHRcdHJldHVybiBKU09OLnN0cmluZ2lmeSh2KTtcblx0fSBjYXRjaCAoZXJyb3IpIHtcblx0XHRyZXR1cm4gJ1tVbmV4cGVjdGVkSlNPTlBhcnNlRXJyb3JdOiAnICsgZXJyb3IubWVzc2FnZTtcblx0fVxufTtcbiIsIlxuLyoqXG4gKiBUaGlzIGlzIHRoZSBjb21tb24gbG9naWMgZm9yIGJvdGggdGhlIE5vZGUuanMgYW5kIHdlYiBicm93c2VyXG4gKiBpbXBsZW1lbnRhdGlvbnMgb2YgYGRlYnVnKClgLlxuICovXG5cbmZ1bmN0aW9uIHNldHVwKGVudikge1xuXHRjcmVhdGVEZWJ1Zy5kZWJ1ZyA9IGNyZWF0ZURlYnVnO1xuXHRjcmVhdGVEZWJ1Zy5kZWZhdWx0ID0gY3JlYXRlRGVidWc7XG5cdGNyZWF0ZURlYnVnLmNvZXJjZSA9IGNvZXJjZTtcblx0Y3JlYXRlRGVidWcuZGlzYWJsZSA9IGRpc2FibGU7XG5cdGNyZWF0ZURlYnVnLmVuYWJsZSA9IGVuYWJsZTtcblx0Y3JlYXRlRGVidWcuZW5hYmxlZCA9IGVuYWJsZWQ7XG5cdGNyZWF0ZURlYnVnLmh1bWFuaXplID0gcmVxdWlyZSgnbXMnKTtcblx0Y3JlYXRlRGVidWcuZGVzdHJveSA9IGRlc3Ryb3k7XG5cblx0T2JqZWN0LmtleXMoZW52KS5mb3JFYWNoKGtleSA9PiB7XG5cdFx0Y3JlYXRlRGVidWdba2V5XSA9IGVudltrZXldO1xuXHR9KTtcblxuXHQvKipcblx0KiBUaGUgY3VycmVudGx5IGFjdGl2ZSBkZWJ1ZyBtb2RlIG5hbWVzLCBhbmQgbmFtZXMgdG8gc2tpcC5cblx0Ki9cblxuXHRjcmVhdGVEZWJ1Zy5uYW1lcyA9IFtdO1xuXHRjcmVhdGVEZWJ1Zy5za2lwcyA9IFtdO1xuXG5cdC8qKlxuXHQqIE1hcCBvZiBzcGVjaWFsIFwiJW5cIiBoYW5kbGluZyBmdW5jdGlvbnMsIGZvciB0aGUgZGVidWcgXCJmb3JtYXRcIiBhcmd1bWVudC5cblx0KlxuXHQqIFZhbGlkIGtleSBuYW1lcyBhcmUgYSBzaW5nbGUsIGxvd2VyIG9yIHVwcGVyLWNhc2UgbGV0dGVyLCBpLmUuIFwiblwiIGFuZCBcIk5cIi5cblx0Ki9cblx0Y3JlYXRlRGVidWcuZm9ybWF0dGVycyA9IHt9O1xuXG5cdC8qKlxuXHQqIFNlbGVjdHMgYSBjb2xvciBmb3IgYSBkZWJ1ZyBuYW1lc3BhY2Vcblx0KiBAcGFyYW0ge1N0cmluZ30gbmFtZXNwYWNlIFRoZSBuYW1lc3BhY2Ugc3RyaW5nIGZvciB0aGUgZGVidWcgaW5zdGFuY2UgdG8gYmUgY29sb3JlZFxuXHQqIEByZXR1cm4ge051bWJlcnxTdHJpbmd9IEFuIEFOU0kgY29sb3IgY29kZSBmb3IgdGhlIGdpdmVuIG5hbWVzcGFjZVxuXHQqIEBhcGkgcHJpdmF0ZVxuXHQqL1xuXHRmdW5jdGlvbiBzZWxlY3RDb2xvcihuYW1lc3BhY2UpIHtcblx0XHRsZXQgaGFzaCA9IDA7XG5cblx0XHRmb3IgKGxldCBpID0gMDsgaSA8IG5hbWVzcGFjZS5sZW5ndGg7IGkrKykge1xuXHRcdFx0aGFzaCA9ICgoaGFzaCA8PCA1KSAtIGhhc2gpICsgbmFtZXNwYWNlLmNoYXJDb2RlQXQoaSk7XG5cdFx0XHRoYXNoIHw9IDA7IC8vIENvbnZlcnQgdG8gMzJiaXQgaW50ZWdlclxuXHRcdH1cblxuXHRcdHJldHVybiBjcmVhdGVEZWJ1Zy5jb2xvcnNbTWF0aC5hYnMoaGFzaCkgJSBjcmVhdGVEZWJ1Zy5jb2xvcnMubGVuZ3RoXTtcblx0fVxuXHRjcmVhdGVEZWJ1Zy5zZWxlY3RDb2xvciA9IHNlbGVjdENvbG9yO1xuXG5cdC8qKlxuXHQqIENyZWF0ZSBhIGRlYnVnZ2VyIHdpdGggdGhlIGdpdmVuIGBuYW1lc3BhY2VgLlxuXHQqXG5cdCogQHBhcmFtIHtTdHJpbmd9IG5hbWVzcGFjZVxuXHQqIEByZXR1cm4ge0Z1bmN0aW9ufVxuXHQqIEBhcGkgcHVibGljXG5cdCovXG5cdGZ1bmN0aW9uIGNyZWF0ZURlYnVnKG5hbWVzcGFjZSkge1xuXHRcdGxldCBwcmV2VGltZTtcblx0XHRsZXQgZW5hYmxlT3ZlcnJpZGUgPSBudWxsO1xuXHRcdGxldCBuYW1lc3BhY2VzQ2FjaGU7XG5cdFx0bGV0IGVuYWJsZWRDYWNoZTtcblxuXHRcdGZ1bmN0aW9uIGRlYnVnKC4uLmFyZ3MpIHtcblx0XHRcdC8vIERpc2FibGVkP1xuXHRcdFx0aWYgKCFkZWJ1Zy5lbmFibGVkKSB7XG5cdFx0XHRcdHJldHVybjtcblx0XHRcdH1cblxuXHRcdFx0Y29uc3Qgc2VsZiA9IGRlYnVnO1xuXG5cdFx0XHQvLyBTZXQgYGRpZmZgIHRpbWVzdGFtcFxuXHRcdFx0Y29uc3QgY3VyciA9IE51bWJlcihuZXcgRGF0ZSgpKTtcblx0XHRcdGNvbnN0IG1zID0gY3VyciAtIChwcmV2VGltZSB8fCBjdXJyKTtcblx0XHRcdHNlbGYuZGlmZiA9IG1zO1xuXHRcdFx0c2VsZi5wcmV2ID0gcHJldlRpbWU7XG5cdFx0XHRzZWxmLmN1cnIgPSBjdXJyO1xuXHRcdFx0cHJldlRpbWUgPSBjdXJyO1xuXG5cdFx0XHRhcmdzWzBdID0gY3JlYXRlRGVidWcuY29lcmNlKGFyZ3NbMF0pO1xuXG5cdFx0XHRpZiAodHlwZW9mIGFyZ3NbMF0gIT09ICdzdHJpbmcnKSB7XG5cdFx0XHRcdC8vIEFueXRoaW5nIGVsc2UgbGV0J3MgaW5zcGVjdCB3aXRoICVPXG5cdFx0XHRcdGFyZ3MudW5zaGlmdCgnJU8nKTtcblx0XHRcdH1cblxuXHRcdFx0Ly8gQXBwbHkgYW55IGBmb3JtYXR0ZXJzYCB0cmFuc2Zvcm1hdGlvbnNcblx0XHRcdGxldCBpbmRleCA9IDA7XG5cdFx0XHRhcmdzWzBdID0gYXJnc1swXS5yZXBsYWNlKC8lKFthLXpBLVolXSkvZywgKG1hdGNoLCBmb3JtYXQpID0+IHtcblx0XHRcdFx0Ly8gSWYgd2UgZW5jb3VudGVyIGFuIGVzY2FwZWQgJSB0aGVuIGRvbid0IGluY3JlYXNlIHRoZSBhcnJheSBpbmRleFxuXHRcdFx0XHRpZiAobWF0Y2ggPT09ICclJScpIHtcblx0XHRcdFx0XHRyZXR1cm4gJyUnO1xuXHRcdFx0XHR9XG5cdFx0XHRcdGluZGV4Kys7XG5cdFx0XHRcdGNvbnN0IGZvcm1hdHRlciA9IGNyZWF0ZURlYnVnLmZvcm1hdHRlcnNbZm9ybWF0XTtcblx0XHRcdFx0aWYgKHR5cGVvZiBmb3JtYXR0ZXIgPT09ICdmdW5jdGlvbicpIHtcblx0XHRcdFx0XHRjb25zdCB2YWwgPSBhcmdzW2luZGV4XTtcblx0XHRcdFx0XHRtYXRjaCA9IGZvcm1hdHRlci5jYWxsKHNlbGYsIHZhbCk7XG5cblx0XHRcdFx0XHQvLyBOb3cgd2UgbmVlZCB0byByZW1vdmUgYGFyZ3NbaW5kZXhdYCBzaW5jZSBpdCdzIGlubGluZWQgaW4gdGhlIGBmb3JtYXRgXG5cdFx0XHRcdFx0YXJncy5zcGxpY2UoaW5kZXgsIDEpO1xuXHRcdFx0XHRcdGluZGV4LS07XG5cdFx0XHRcdH1cblx0XHRcdFx0cmV0dXJuIG1hdGNoO1xuXHRcdFx0fSk7XG5cblx0XHRcdC8vIEFwcGx5IGVudi1zcGVjaWZpYyBmb3JtYXR0aW5nIChjb2xvcnMsIGV0Yy4pXG5cdFx0XHRjcmVhdGVEZWJ1Zy5mb3JtYXRBcmdzLmNhbGwoc2VsZiwgYXJncyk7XG5cblx0XHRcdGNvbnN0IGxvZ0ZuID0gc2VsZi5sb2cgfHwgY3JlYXRlRGVidWcubG9nO1xuXHRcdFx0bG9nRm4uYXBwbHkoc2VsZiwgYXJncyk7XG5cdFx0fVxuXG5cdFx0ZGVidWcubmFtZXNwYWNlID0gbmFtZXNwYWNlO1xuXHRcdGRlYnVnLnVzZUNvbG9ycyA9IGNyZWF0ZURlYnVnLnVzZUNvbG9ycygpO1xuXHRcdGRlYnVnLmNvbG9yID0gY3JlYXRlRGVidWcuc2VsZWN0Q29sb3IobmFtZXNwYWNlKTtcblx0XHRkZWJ1Zy5leHRlbmQgPSBleHRlbmQ7XG5cdFx0ZGVidWcuZGVzdHJveSA9IGNyZWF0ZURlYnVnLmRlc3Ryb3k7IC8vIFhYWCBUZW1wb3JhcnkuIFdpbGwgYmUgcmVtb3ZlZCBpbiB0aGUgbmV4dCBtYWpvciByZWxlYXNlLlxuXG5cdFx0T2JqZWN0LmRlZmluZVByb3BlcnR5KGRlYnVnLCAnZW5hYmxlZCcsIHtcblx0XHRcdGVudW1lcmFibGU6IHRydWUsXG5cdFx0XHRjb25maWd1cmFibGU6IGZhbHNlLFxuXHRcdFx0Z2V0OiAoKSA9PiB7XG5cdFx0XHRcdGlmIChlbmFibGVPdmVycmlkZSAhPT0gbnVsbCkge1xuXHRcdFx0XHRcdHJldHVybiBlbmFibGVPdmVycmlkZTtcblx0XHRcdFx0fVxuXHRcdFx0XHRpZiAobmFtZXNwYWNlc0NhY2hlICE9PSBjcmVhdGVEZWJ1Zy5uYW1lc3BhY2VzKSB7XG5cdFx0XHRcdFx0bmFtZXNwYWNlc0NhY2hlID0gY3JlYXRlRGVidWcubmFtZXNwYWNlcztcblx0XHRcdFx0XHRlbmFibGVkQ2FjaGUgPSBjcmVhdGVEZWJ1Zy5lbmFibGVkKG5hbWVzcGFjZSk7XG5cdFx0XHRcdH1cblxuXHRcdFx0XHRyZXR1cm4gZW5hYmxlZENhY2hlO1xuXHRcdFx0fSxcblx0XHRcdHNldDogdiA9PiB7XG5cdFx0XHRcdGVuYWJsZU92ZXJyaWRlID0gdjtcblx0XHRcdH1cblx0XHR9KTtcblxuXHRcdC8vIEVudi1zcGVjaWZpYyBpbml0aWFsaXphdGlvbiBsb2dpYyBmb3IgZGVidWcgaW5zdGFuY2VzXG5cdFx0aWYgKHR5cGVvZiBjcmVhdGVEZWJ1Zy5pbml0ID09PSAnZnVuY3Rpb24nKSB7XG5cdFx0XHRjcmVhdGVEZWJ1Zy5pbml0KGRlYnVnKTtcblx0XHR9XG5cblx0XHRyZXR1cm4gZGVidWc7XG5cdH1cblxuXHRmdW5jdGlvbiBleHRlbmQobmFtZXNwYWNlLCBkZWxpbWl0ZXIpIHtcblx0XHRjb25zdCBuZXdEZWJ1ZyA9IGNyZWF0ZURlYnVnKHRoaXMubmFtZXNwYWNlICsgKHR5cGVvZiBkZWxpbWl0ZXIgPT09ICd1bmRlZmluZWQnID8gJzonIDogZGVsaW1pdGVyKSArIG5hbWVzcGFjZSk7XG5cdFx0bmV3RGVidWcubG9nID0gdGhpcy5sb2c7XG5cdFx0cmV0dXJuIG5ld0RlYnVnO1xuXHR9XG5cblx0LyoqXG5cdCogRW5hYmxlcyBhIGRlYnVnIG1vZGUgYnkgbmFtZXNwYWNlcy4gVGhpcyBjYW4gaW5jbHVkZSBtb2Rlc1xuXHQqIHNlcGFyYXRlZCBieSBhIGNvbG9uIGFuZCB3aWxkY2FyZHMuXG5cdCpcblx0KiBAcGFyYW0ge1N0cmluZ30gbmFtZXNwYWNlc1xuXHQqIEBhcGkgcHVibGljXG5cdCovXG5cdGZ1bmN0aW9uIGVuYWJsZShuYW1lc3BhY2VzKSB7XG5cdFx0Y3JlYXRlRGVidWcuc2F2ZShuYW1lc3BhY2VzKTtcblx0XHRjcmVhdGVEZWJ1Zy5uYW1lc3BhY2VzID0gbmFtZXNwYWNlcztcblxuXHRcdGNyZWF0ZURlYnVnLm5hbWVzID0gW107XG5cdFx0Y3JlYXRlRGVidWcuc2tpcHMgPSBbXTtcblxuXHRcdGxldCBpO1xuXHRcdGNvbnN0IHNwbGl0ID0gKHR5cGVvZiBuYW1lc3BhY2VzID09PSAnc3RyaW5nJyA/IG5hbWVzcGFjZXMgOiAnJykuc3BsaXQoL1tcXHMsXSsvKTtcblx0XHRjb25zdCBsZW4gPSBzcGxpdC5sZW5ndGg7XG5cblx0XHRmb3IgKGkgPSAwOyBpIDwgbGVuOyBpKyspIHtcblx0XHRcdGlmICghc3BsaXRbaV0pIHtcblx0XHRcdFx0Ly8gaWdub3JlIGVtcHR5IHN0cmluZ3Ncblx0XHRcdFx0Y29udGludWU7XG5cdFx0XHR9XG5cblx0XHRcdG5hbWVzcGFjZXMgPSBzcGxpdFtpXS5yZXBsYWNlKC9cXCovZywgJy4qPycpO1xuXG5cdFx0XHRpZiAobmFtZXNwYWNlc1swXSA9PT0gJy0nKSB7XG5cdFx0XHRcdGNyZWF0ZURlYnVnLnNraXBzLnB1c2gobmV3IFJlZ0V4cCgnXicgKyBuYW1lc3BhY2VzLnNsaWNlKDEpICsgJyQnKSk7XG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRjcmVhdGVEZWJ1Zy5uYW1lcy5wdXNoKG5ldyBSZWdFeHAoJ14nICsgbmFtZXNwYWNlcyArICckJykpO1xuXHRcdFx0fVxuXHRcdH1cblx0fVxuXG5cdC8qKlxuXHQqIERpc2FibGUgZGVidWcgb3V0cHV0LlxuXHQqXG5cdCogQHJldHVybiB7U3RyaW5nfSBuYW1lc3BhY2VzXG5cdCogQGFwaSBwdWJsaWNcblx0Ki9cblx0ZnVuY3Rpb24gZGlzYWJsZSgpIHtcblx0XHRjb25zdCBuYW1lc3BhY2VzID0gW1xuXHRcdFx0Li4uY3JlYXRlRGVidWcubmFtZXMubWFwKHRvTmFtZXNwYWNlKSxcblx0XHRcdC4uLmNyZWF0ZURlYnVnLnNraXBzLm1hcCh0b05hbWVzcGFjZSkubWFwKG5hbWVzcGFjZSA9PiAnLScgKyBuYW1lc3BhY2UpXG5cdFx0XS5qb2luKCcsJyk7XG5cdFx0Y3JlYXRlRGVidWcuZW5hYmxlKCcnKTtcblx0XHRyZXR1cm4gbmFtZXNwYWNlcztcblx0fVxuXG5cdC8qKlxuXHQqIFJldHVybnMgdHJ1ZSBpZiB0aGUgZ2l2ZW4gbW9kZSBuYW1lIGlzIGVuYWJsZWQsIGZhbHNlIG90aGVyd2lzZS5cblx0KlxuXHQqIEBwYXJhbSB7U3RyaW5nfSBuYW1lXG5cdCogQHJldHVybiB7Qm9vbGVhbn1cblx0KiBAYXBpIHB1YmxpY1xuXHQqL1xuXHRmdW5jdGlvbiBlbmFibGVkKG5hbWUpIHtcblx0XHRpZiAobmFtZVtuYW1lLmxlbmd0aCAtIDFdID09PSAnKicpIHtcblx0XHRcdHJldHVybiB0cnVlO1xuXHRcdH1cblxuXHRcdGxldCBpO1xuXHRcdGxldCBsZW47XG5cblx0XHRmb3IgKGkgPSAwLCBsZW4gPSBjcmVhdGVEZWJ1Zy5za2lwcy5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuXHRcdFx0aWYgKGNyZWF0ZURlYnVnLnNraXBzW2ldLnRlc3QobmFtZSkpIHtcblx0XHRcdFx0cmV0dXJuIGZhbHNlO1xuXHRcdFx0fVxuXHRcdH1cblxuXHRcdGZvciAoaSA9IDAsIGxlbiA9IGNyZWF0ZURlYnVnLm5hbWVzLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG5cdFx0XHRpZiAoY3JlYXRlRGVidWcubmFtZXNbaV0udGVzdChuYW1lKSkge1xuXHRcdFx0XHRyZXR1cm4gdHJ1ZTtcblx0XHRcdH1cblx0XHR9XG5cblx0XHRyZXR1cm4gZmFsc2U7XG5cdH1cblxuXHQvKipcblx0KiBDb252ZXJ0IHJlZ2V4cCB0byBuYW1lc3BhY2Vcblx0KlxuXHQqIEBwYXJhbSB7UmVnRXhwfSByZWd4ZXBcblx0KiBAcmV0dXJuIHtTdHJpbmd9IG5hbWVzcGFjZVxuXHQqIEBhcGkgcHJpdmF0ZVxuXHQqL1xuXHRmdW5jdGlvbiB0b05hbWVzcGFjZShyZWdleHApIHtcblx0XHRyZXR1cm4gcmVnZXhwLnRvU3RyaW5nKClcblx0XHRcdC5zdWJzdHJpbmcoMiwgcmVnZXhwLnRvU3RyaW5nKCkubGVuZ3RoIC0gMilcblx0XHRcdC5yZXBsYWNlKC9cXC5cXCpcXD8kLywgJyonKTtcblx0fVxuXG5cdC8qKlxuXHQqIENvZXJjZSBgdmFsYC5cblx0KlxuXHQqIEBwYXJhbSB7TWl4ZWR9IHZhbFxuXHQqIEByZXR1cm4ge01peGVkfVxuXHQqIEBhcGkgcHJpdmF0ZVxuXHQqL1xuXHRmdW5jdGlvbiBjb2VyY2UodmFsKSB7XG5cdFx0aWYgKHZhbCBpbnN0YW5jZW9mIEVycm9yKSB7XG5cdFx0XHRyZXR1cm4gdmFsLnN0YWNrIHx8IHZhbC5tZXNzYWdlO1xuXHRcdH1cblx0XHRyZXR1cm4gdmFsO1xuXHR9XG5cblx0LyoqXG5cdCogWFhYIERPIE5PVCBVU0UuIFRoaXMgaXMgYSB0ZW1wb3Jhcnkgc3R1YiBmdW5jdGlvbi5cblx0KiBYWFggSXQgV0lMTCBiZSByZW1vdmVkIGluIHRoZSBuZXh0IG1ham9yIHJlbGVhc2UuXG5cdCovXG5cdGZ1bmN0aW9uIGRlc3Ryb3koKSB7XG5cdFx0Y29uc29sZS53YXJuKCdJbnN0YW5jZSBtZXRob2QgYGRlYnVnLmRlc3Ryb3koKWAgaXMgZGVwcmVjYXRlZCBhbmQgbm8gbG9uZ2VyIGRvZXMgYW55dGhpbmcuIEl0IHdpbGwgYmUgcmVtb3ZlZCBpbiB0aGUgbmV4dCBtYWpvciB2ZXJzaW9uIG9mIGBkZWJ1Z2AuJyk7XG5cdH1cblxuXHRjcmVhdGVEZWJ1Zy5lbmFibGUoY3JlYXRlRGVidWcubG9hZCgpKTtcblxuXHRyZXR1cm4gY3JlYXRlRGVidWc7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gc2V0dXA7XG4iLCIvKipcbiAqIEhlbHBlcnMuXG4gKi9cblxudmFyIHMgPSAxMDAwO1xudmFyIG0gPSBzICogNjA7XG52YXIgaCA9IG0gKiA2MDtcbnZhciBkID0gaCAqIDI0O1xudmFyIHcgPSBkICogNztcbnZhciB5ID0gZCAqIDM2NS4yNTtcblxuLyoqXG4gKiBQYXJzZSBvciBmb3JtYXQgdGhlIGdpdmVuIGB2YWxgLlxuICpcbiAqIE9wdGlvbnM6XG4gKlxuICogIC0gYGxvbmdgIHZlcmJvc2UgZm9ybWF0dGluZyBbZmFsc2VdXG4gKlxuICogQHBhcmFtIHtTdHJpbmd8TnVtYmVyfSB2YWxcbiAqIEBwYXJhbSB7T2JqZWN0fSBbb3B0aW9uc11cbiAqIEB0aHJvd3Mge0Vycm9yfSB0aHJvdyBhbiBlcnJvciBpZiB2YWwgaXMgbm90IGEgbm9uLWVtcHR5IHN0cmluZyBvciBhIG51bWJlclxuICogQHJldHVybiB7U3RyaW5nfE51bWJlcn1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbih2YWwsIG9wdGlvbnMpIHtcbiAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG4gIHZhciB0eXBlID0gdHlwZW9mIHZhbDtcbiAgaWYgKHR5cGUgPT09ICdzdHJpbmcnICYmIHZhbC5sZW5ndGggPiAwKSB7XG4gICAgcmV0dXJuIHBhcnNlKHZhbCk7XG4gIH0gZWxzZSBpZiAodHlwZSA9PT0gJ251bWJlcicgJiYgaXNGaW5pdGUodmFsKSkge1xuICAgIHJldHVybiBvcHRpb25zLmxvbmcgPyBmbXRMb25nKHZhbCkgOiBmbXRTaG9ydCh2YWwpO1xuICB9XG4gIHRocm93IG5ldyBFcnJvcihcbiAgICAndmFsIGlzIG5vdCBhIG5vbi1lbXB0eSBzdHJpbmcgb3IgYSB2YWxpZCBudW1iZXIuIHZhbD0nICtcbiAgICAgIEpTT04uc3RyaW5naWZ5KHZhbClcbiAgKTtcbn07XG5cbi8qKlxuICogUGFyc2UgdGhlIGdpdmVuIGBzdHJgIGFuZCByZXR1cm4gbWlsbGlzZWNvbmRzLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBzdHJcbiAqIEByZXR1cm4ge051bWJlcn1cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIHBhcnNlKHN0cikge1xuICBzdHIgPSBTdHJpbmcoc3RyKTtcbiAgaWYgKHN0ci5sZW5ndGggPiAxMDApIHtcbiAgICByZXR1cm47XG4gIH1cbiAgdmFyIG1hdGNoID0gL14oLT8oPzpcXGQrKT9cXC4/XFxkKykgKihtaWxsaXNlY29uZHM/fG1zZWNzP3xtc3xzZWNvbmRzP3xzZWNzP3xzfG1pbnV0ZXM/fG1pbnM/fG18aG91cnM/fGhycz98aHxkYXlzP3xkfHdlZWtzP3x3fHllYXJzP3x5cnM/fHkpPyQvaS5leGVjKFxuICAgIHN0clxuICApO1xuICBpZiAoIW1hdGNoKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIHZhciBuID0gcGFyc2VGbG9hdChtYXRjaFsxXSk7XG4gIHZhciB0eXBlID0gKG1hdGNoWzJdIHx8ICdtcycpLnRvTG93ZXJDYXNlKCk7XG4gIHN3aXRjaCAodHlwZSkge1xuICAgIGNhc2UgJ3llYXJzJzpcbiAgICBjYXNlICd5ZWFyJzpcbiAgICBjYXNlICd5cnMnOlxuICAgIGNhc2UgJ3lyJzpcbiAgICBjYXNlICd5JzpcbiAgICAgIHJldHVybiBuICogeTtcbiAgICBjYXNlICd3ZWVrcyc6XG4gICAgY2FzZSAnd2Vlayc6XG4gICAgY2FzZSAndyc6XG4gICAgICByZXR1cm4gbiAqIHc7XG4gICAgY2FzZSAnZGF5cyc6XG4gICAgY2FzZSAnZGF5JzpcbiAgICBjYXNlICdkJzpcbiAgICAgIHJldHVybiBuICogZDtcbiAgICBjYXNlICdob3Vycyc6XG4gICAgY2FzZSAnaG91cic6XG4gICAgY2FzZSAnaHJzJzpcbiAgICBjYXNlICdocic6XG4gICAgY2FzZSAnaCc6XG4gICAgICByZXR1cm4gbiAqIGg7XG4gICAgY2FzZSAnbWludXRlcyc6XG4gICAgY2FzZSAnbWludXRlJzpcbiAgICBjYXNlICdtaW5zJzpcbiAgICBjYXNlICdtaW4nOlxuICAgIGNhc2UgJ20nOlxuICAgICAgcmV0dXJuIG4gKiBtO1xuICAgIGNhc2UgJ3NlY29uZHMnOlxuICAgIGNhc2UgJ3NlY29uZCc6XG4gICAgY2FzZSAnc2Vjcyc6XG4gICAgY2FzZSAnc2VjJzpcbiAgICBjYXNlICdzJzpcbiAgICAgIHJldHVybiBuICogcztcbiAgICBjYXNlICdtaWxsaXNlY29uZHMnOlxuICAgIGNhc2UgJ21pbGxpc2Vjb25kJzpcbiAgICBjYXNlICdtc2Vjcyc6XG4gICAgY2FzZSAnbXNlYyc6XG4gICAgY2FzZSAnbXMnOlxuICAgICAgcmV0dXJuIG47XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbn1cblxuLyoqXG4gKiBTaG9ydCBmb3JtYXQgZm9yIGBtc2AuXG4gKlxuICogQHBhcmFtIHtOdW1iZXJ9IG1zXG4gKiBAcmV0dXJuIHtTdHJpbmd9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBmbXRTaG9ydChtcykge1xuICB2YXIgbXNBYnMgPSBNYXRoLmFicyhtcyk7XG4gIGlmIChtc0FicyA+PSBkKSB7XG4gICAgcmV0dXJuIE1hdGgucm91bmQobXMgLyBkKSArICdkJztcbiAgfVxuICBpZiAobXNBYnMgPj0gaCkge1xuICAgIHJldHVybiBNYXRoLnJvdW5kKG1zIC8gaCkgKyAnaCc7XG4gIH1cbiAgaWYgKG1zQWJzID49IG0pIHtcbiAgICByZXR1cm4gTWF0aC5yb3VuZChtcyAvIG0pICsgJ20nO1xuICB9XG4gIGlmIChtc0FicyA+PSBzKSB7XG4gICAgcmV0dXJuIE1hdGgucm91bmQobXMgLyBzKSArICdzJztcbiAgfVxuICByZXR1cm4gbXMgKyAnbXMnO1xufVxuXG4vKipcbiAqIExvbmcgZm9ybWF0IGZvciBgbXNgLlxuICpcbiAqIEBwYXJhbSB7TnVtYmVyfSBtc1xuICogQHJldHVybiB7U3RyaW5nfVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gZm10TG9uZyhtcykge1xuICB2YXIgbXNBYnMgPSBNYXRoLmFicyhtcyk7XG4gIGlmIChtc0FicyA+PSBkKSB7XG4gICAgcmV0dXJuIHBsdXJhbChtcywgbXNBYnMsIGQsICdkYXknKTtcbiAgfVxuICBpZiAobXNBYnMgPj0gaCkge1xuICAgIHJldHVybiBwbHVyYWwobXMsIG1zQWJzLCBoLCAnaG91cicpO1xuICB9XG4gIGlmIChtc0FicyA+PSBtKSB7XG4gICAgcmV0dXJuIHBsdXJhbChtcywgbXNBYnMsIG0sICdtaW51dGUnKTtcbiAgfVxuICBpZiAobXNBYnMgPj0gcykge1xuICAgIHJldHVybiBwbHVyYWwobXMsIG1zQWJzLCBzLCAnc2Vjb25kJyk7XG4gIH1cbiAgcmV0dXJuIG1zICsgJyBtcyc7XG59XG5cbi8qKlxuICogUGx1cmFsaXphdGlvbiBoZWxwZXIuXG4gKi9cblxuZnVuY3Rpb24gcGx1cmFsKG1zLCBtc0FicywgbiwgbmFtZSkge1xuICB2YXIgaXNQbHVyYWwgPSBtc0FicyA+PSBuICogMS41O1xuICByZXR1cm4gTWF0aC5yb3VuZChtcyAvIG4pICsgJyAnICsgbmFtZSArIChpc1BsdXJhbCA/ICdzJyA6ICcnKTtcbn1cbiIsIi8qIGVzbGludC1lbnYgbm9kZSAqL1xuJ3VzZSBzdHJpY3QnO1xuXG4vLyBTRFAgaGVscGVycy5cbmNvbnN0IFNEUFV0aWxzID0ge307XG5cbi8vIEdlbmVyYXRlIGFuIGFscGhhbnVtZXJpYyBpZGVudGlmaWVyIGZvciBjbmFtZSBvciBtaWRzLlxuLy8gVE9ETzogdXNlIFVVSURzIGluc3RlYWQ/IGh0dHBzOi8vZ2lzdC5naXRodWIuY29tL2plZC85ODI4ODNcblNEUFV0aWxzLmdlbmVyYXRlSWRlbnRpZmllciA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gTWF0aC5yYW5kb20oKS50b1N0cmluZygzNikuc3Vic3RyaW5nKDIsIDEyKTtcbn07XG5cbi8vIFRoZSBSVENQIENOQU1FIHVzZWQgYnkgYWxsIHBlZXJjb25uZWN0aW9ucyBmcm9tIHRoZSBzYW1lIEpTLlxuU0RQVXRpbHMubG9jYWxDTmFtZSA9IFNEUFV0aWxzLmdlbmVyYXRlSWRlbnRpZmllcigpO1xuXG4vLyBTcGxpdHMgU0RQIGludG8gbGluZXMsIGRlYWxpbmcgd2l0aCBib3RoIENSTEYgYW5kIExGLlxuU0RQVXRpbHMuc3BsaXRMaW5lcyA9IGZ1bmN0aW9uKGJsb2IpIHtcbiAgcmV0dXJuIGJsb2IudHJpbSgpLnNwbGl0KCdcXG4nKS5tYXAobGluZSA9PiBsaW5lLnRyaW0oKSk7XG59O1xuLy8gU3BsaXRzIFNEUCBpbnRvIHNlc3Npb25wYXJ0IGFuZCBtZWRpYXNlY3Rpb25zLiBFbnN1cmVzIENSTEYuXG5TRFBVdGlscy5zcGxpdFNlY3Rpb25zID0gZnVuY3Rpb24oYmxvYikge1xuICBjb25zdCBwYXJ0cyA9IGJsb2Iuc3BsaXQoJ1xcbm09Jyk7XG4gIHJldHVybiBwYXJ0cy5tYXAoKHBhcnQsIGluZGV4KSA9PiAoaW5kZXggPiAwID9cbiAgICAnbT0nICsgcGFydCA6IHBhcnQpLnRyaW0oKSArICdcXHJcXG4nKTtcbn07XG5cbi8vIFJldHVybnMgdGhlIHNlc3Npb24gZGVzY3JpcHRpb24uXG5TRFBVdGlscy5nZXREZXNjcmlwdGlvbiA9IGZ1bmN0aW9uKGJsb2IpIHtcbiAgY29uc3Qgc2VjdGlvbnMgPSBTRFBVdGlscy5zcGxpdFNlY3Rpb25zKGJsb2IpO1xuICByZXR1cm4gc2VjdGlvbnMgJiYgc2VjdGlvbnNbMF07XG59O1xuXG4vLyBSZXR1cm5zIHRoZSBpbmRpdmlkdWFsIG1lZGlhIHNlY3Rpb25zLlxuU0RQVXRpbHMuZ2V0TWVkaWFTZWN0aW9ucyA9IGZ1bmN0aW9uKGJsb2IpIHtcbiAgY29uc3Qgc2VjdGlvbnMgPSBTRFBVdGlscy5zcGxpdFNlY3Rpb25zKGJsb2IpO1xuICBzZWN0aW9ucy5zaGlmdCgpO1xuICByZXR1cm4gc2VjdGlvbnM7XG59O1xuXG4vLyBSZXR1cm5zIGxpbmVzIHRoYXQgc3RhcnQgd2l0aCBhIGNlcnRhaW4gcHJlZml4LlxuU0RQVXRpbHMubWF0Y2hQcmVmaXggPSBmdW5jdGlvbihibG9iLCBwcmVmaXgpIHtcbiAgcmV0dXJuIFNEUFV0aWxzLnNwbGl0TGluZXMoYmxvYikuZmlsdGVyKGxpbmUgPT4gbGluZS5pbmRleE9mKHByZWZpeCkgPT09IDApO1xufTtcblxuLy8gUGFyc2VzIGFuIElDRSBjYW5kaWRhdGUgbGluZS4gU2FtcGxlIGlucHV0OlxuLy8gY2FuZGlkYXRlOjcwMjc4NjM1MCAyIHVkcCA0MTgxOTkwMiA4LjguOC44IDYwNzY5IHR5cCByZWxheSByYWRkciA4LjguOC44XG4vLyBycG9ydCA1NTk5NlwiXG4vLyBJbnB1dCBjYW4gYmUgcHJlZml4ZWQgd2l0aCBhPS5cblNEUFV0aWxzLnBhcnNlQ2FuZGlkYXRlID0gZnVuY3Rpb24obGluZSkge1xuICBsZXQgcGFydHM7XG4gIC8vIFBhcnNlIGJvdGggdmFyaWFudHMuXG4gIGlmIChsaW5lLmluZGV4T2YoJ2E9Y2FuZGlkYXRlOicpID09PSAwKSB7XG4gICAgcGFydHMgPSBsaW5lLnN1YnN0cmluZygxMikuc3BsaXQoJyAnKTtcbiAgfSBlbHNlIHtcbiAgICBwYXJ0cyA9IGxpbmUuc3Vic3RyaW5nKDEwKS5zcGxpdCgnICcpO1xuICB9XG5cbiAgY29uc3QgY2FuZGlkYXRlID0ge1xuICAgIGZvdW5kYXRpb246IHBhcnRzWzBdLFxuICAgIGNvbXBvbmVudDogezE6ICdydHAnLCAyOiAncnRjcCd9W3BhcnRzWzFdXSB8fCBwYXJ0c1sxXSxcbiAgICBwcm90b2NvbDogcGFydHNbMl0udG9Mb3dlckNhc2UoKSxcbiAgICBwcmlvcml0eTogcGFyc2VJbnQocGFydHNbM10sIDEwKSxcbiAgICBpcDogcGFydHNbNF0sXG4gICAgYWRkcmVzczogcGFydHNbNF0sIC8vIGFkZHJlc3MgaXMgYW4gYWxpYXMgZm9yIGlwLlxuICAgIHBvcnQ6IHBhcnNlSW50KHBhcnRzWzVdLCAxMCksXG4gICAgLy8gc2tpcCBwYXJ0c1s2XSA9PSAndHlwJ1xuICAgIHR5cGU6IHBhcnRzWzddLFxuICB9O1xuXG4gIGZvciAobGV0IGkgPSA4OyBpIDwgcGFydHMubGVuZ3RoOyBpICs9IDIpIHtcbiAgICBzd2l0Y2ggKHBhcnRzW2ldKSB7XG4gICAgICBjYXNlICdyYWRkcic6XG4gICAgICAgIGNhbmRpZGF0ZS5yZWxhdGVkQWRkcmVzcyA9IHBhcnRzW2kgKyAxXTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdycG9ydCc6XG4gICAgICAgIGNhbmRpZGF0ZS5yZWxhdGVkUG9ydCA9IHBhcnNlSW50KHBhcnRzW2kgKyAxXSwgMTApO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3RjcHR5cGUnOlxuICAgICAgICBjYW5kaWRhdGUudGNwVHlwZSA9IHBhcnRzW2kgKyAxXTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICd1ZnJhZyc6XG4gICAgICAgIGNhbmRpZGF0ZS51ZnJhZyA9IHBhcnRzW2kgKyAxXTsgLy8gZm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHkuXG4gICAgICAgIGNhbmRpZGF0ZS51c2VybmFtZUZyYWdtZW50ID0gcGFydHNbaSArIDFdO1xuICAgICAgICBicmVhaztcbiAgICAgIGRlZmF1bHQ6IC8vIGV4dGVuc2lvbiBoYW5kbGluZywgaW4gcGFydGljdWxhciB1ZnJhZy4gRG9uJ3Qgb3ZlcndyaXRlLlxuICAgICAgICBpZiAoY2FuZGlkYXRlW3BhcnRzW2ldXSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgY2FuZGlkYXRlW3BhcnRzW2ldXSA9IHBhcnRzW2kgKyAxXTtcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGNhbmRpZGF0ZTtcbn07XG5cbi8vIFRyYW5zbGF0ZXMgYSBjYW5kaWRhdGUgb2JqZWN0IGludG8gU0RQIGNhbmRpZGF0ZSBhdHRyaWJ1dGUuXG4vLyBUaGlzIGRvZXMgbm90IGluY2x1ZGUgdGhlIGE9IHByZWZpeCFcblNEUFV0aWxzLndyaXRlQ2FuZGlkYXRlID0gZnVuY3Rpb24oY2FuZGlkYXRlKSB7XG4gIGNvbnN0IHNkcCA9IFtdO1xuICBzZHAucHVzaChjYW5kaWRhdGUuZm91bmRhdGlvbik7XG5cbiAgY29uc3QgY29tcG9uZW50ID0gY2FuZGlkYXRlLmNvbXBvbmVudDtcbiAgaWYgKGNvbXBvbmVudCA9PT0gJ3J0cCcpIHtcbiAgICBzZHAucHVzaCgxKTtcbiAgfSBlbHNlIGlmIChjb21wb25lbnQgPT09ICdydGNwJykge1xuICAgIHNkcC5wdXNoKDIpO1xuICB9IGVsc2Uge1xuICAgIHNkcC5wdXNoKGNvbXBvbmVudCk7XG4gIH1cbiAgc2RwLnB1c2goY2FuZGlkYXRlLnByb3RvY29sLnRvVXBwZXJDYXNlKCkpO1xuICBzZHAucHVzaChjYW5kaWRhdGUucHJpb3JpdHkpO1xuICBzZHAucHVzaChjYW5kaWRhdGUuYWRkcmVzcyB8fCBjYW5kaWRhdGUuaXApO1xuICBzZHAucHVzaChjYW5kaWRhdGUucG9ydCk7XG5cbiAgY29uc3QgdHlwZSA9IGNhbmRpZGF0ZS50eXBlO1xuICBzZHAucHVzaCgndHlwJyk7XG4gIHNkcC5wdXNoKHR5cGUpO1xuICBpZiAodHlwZSAhPT0gJ2hvc3QnICYmIGNhbmRpZGF0ZS5yZWxhdGVkQWRkcmVzcyAmJlxuICAgICAgY2FuZGlkYXRlLnJlbGF0ZWRQb3J0KSB7XG4gICAgc2RwLnB1c2goJ3JhZGRyJyk7XG4gICAgc2RwLnB1c2goY2FuZGlkYXRlLnJlbGF0ZWRBZGRyZXNzKTtcbiAgICBzZHAucHVzaCgncnBvcnQnKTtcbiAgICBzZHAucHVzaChjYW5kaWRhdGUucmVsYXRlZFBvcnQpO1xuICB9XG4gIGlmIChjYW5kaWRhdGUudGNwVHlwZSAmJiBjYW5kaWRhdGUucHJvdG9jb2wudG9Mb3dlckNhc2UoKSA9PT0gJ3RjcCcpIHtcbiAgICBzZHAucHVzaCgndGNwdHlwZScpO1xuICAgIHNkcC5wdXNoKGNhbmRpZGF0ZS50Y3BUeXBlKTtcbiAgfVxuICBpZiAoY2FuZGlkYXRlLnVzZXJuYW1lRnJhZ21lbnQgfHwgY2FuZGlkYXRlLnVmcmFnKSB7XG4gICAgc2RwLnB1c2goJ3VmcmFnJyk7XG4gICAgc2RwLnB1c2goY2FuZGlkYXRlLnVzZXJuYW1lRnJhZ21lbnQgfHwgY2FuZGlkYXRlLnVmcmFnKTtcbiAgfVxuICByZXR1cm4gJ2NhbmRpZGF0ZTonICsgc2RwLmpvaW4oJyAnKTtcbn07XG5cbi8vIFBhcnNlcyBhbiBpY2Utb3B0aW9ucyBsaW5lLCByZXR1cm5zIGFuIGFycmF5IG9mIG9wdGlvbiB0YWdzLlxuLy8gU2FtcGxlIGlucHV0OlxuLy8gYT1pY2Utb3B0aW9uczpmb28gYmFyXG5TRFBVdGlscy5wYXJzZUljZU9wdGlvbnMgPSBmdW5jdGlvbihsaW5lKSB7XG4gIHJldHVybiBsaW5lLnN1YnN0cmluZygxNCkuc3BsaXQoJyAnKTtcbn07XG5cbi8vIFBhcnNlcyBhIHJ0cG1hcCBsaW5lLCByZXR1cm5zIFJUQ1J0cENvZGRlY1BhcmFtZXRlcnMuIFNhbXBsZSBpbnB1dDpcbi8vIGE9cnRwbWFwOjExMSBvcHVzLzQ4MDAwLzJcblNEUFV0aWxzLnBhcnNlUnRwTWFwID0gZnVuY3Rpb24obGluZSkge1xuICBsZXQgcGFydHMgPSBsaW5lLnN1YnN0cmluZyg5KS5zcGxpdCgnICcpO1xuICBjb25zdCBwYXJzZWQgPSB7XG4gICAgcGF5bG9hZFR5cGU6IHBhcnNlSW50KHBhcnRzLnNoaWZ0KCksIDEwKSwgLy8gd2FzOiBpZFxuICB9O1xuXG4gIHBhcnRzID0gcGFydHNbMF0uc3BsaXQoJy8nKTtcblxuICBwYXJzZWQubmFtZSA9IHBhcnRzWzBdO1xuICBwYXJzZWQuY2xvY2tSYXRlID0gcGFyc2VJbnQocGFydHNbMV0sIDEwKTsgLy8gd2FzOiBjbG9ja3JhdGVcbiAgcGFyc2VkLmNoYW5uZWxzID0gcGFydHMubGVuZ3RoID09PSAzID8gcGFyc2VJbnQocGFydHNbMl0sIDEwKSA6IDE7XG4gIC8vIGxlZ2FjeSBhbGlhcywgZ290IHJlbmFtZWQgYmFjayB0byBjaGFubmVscyBpbiBPUlRDLlxuICBwYXJzZWQubnVtQ2hhbm5lbHMgPSBwYXJzZWQuY2hhbm5lbHM7XG4gIHJldHVybiBwYXJzZWQ7XG59O1xuXG4vLyBHZW5lcmF0ZXMgYSBydHBtYXAgbGluZSBmcm9tIFJUQ1J0cENvZGVjQ2FwYWJpbGl0eSBvclxuLy8gUlRDUnRwQ29kZWNQYXJhbWV0ZXJzLlxuU0RQVXRpbHMud3JpdGVSdHBNYXAgPSBmdW5jdGlvbihjb2RlYykge1xuICBsZXQgcHQgPSBjb2RlYy5wYXlsb2FkVHlwZTtcbiAgaWYgKGNvZGVjLnByZWZlcnJlZFBheWxvYWRUeXBlICE9PSB1bmRlZmluZWQpIHtcbiAgICBwdCA9IGNvZGVjLnByZWZlcnJlZFBheWxvYWRUeXBlO1xuICB9XG4gIGNvbnN0IGNoYW5uZWxzID0gY29kZWMuY2hhbm5lbHMgfHwgY29kZWMubnVtQ2hhbm5lbHMgfHwgMTtcbiAgcmV0dXJuICdhPXJ0cG1hcDonICsgcHQgKyAnICcgKyBjb2RlYy5uYW1lICsgJy8nICsgY29kZWMuY2xvY2tSYXRlICtcbiAgICAgIChjaGFubmVscyAhPT0gMSA/ICcvJyArIGNoYW5uZWxzIDogJycpICsgJ1xcclxcbic7XG59O1xuXG4vLyBQYXJzZXMgYSBleHRtYXAgbGluZSAoaGVhZGVyZXh0ZW5zaW9uIGZyb20gUkZDIDUyODUpLiBTYW1wbGUgaW5wdXQ6XG4vLyBhPWV4dG1hcDoyIHVybjppZXRmOnBhcmFtczpydHAtaGRyZXh0OnRvZmZzZXRcbi8vIGE9ZXh0bWFwOjIvc2VuZG9ubHkgdXJuOmlldGY6cGFyYW1zOnJ0cC1oZHJleHQ6dG9mZnNldFxuU0RQVXRpbHMucGFyc2VFeHRtYXAgPSBmdW5jdGlvbihsaW5lKSB7XG4gIGNvbnN0IHBhcnRzID0gbGluZS5zdWJzdHJpbmcoOSkuc3BsaXQoJyAnKTtcbiAgcmV0dXJuIHtcbiAgICBpZDogcGFyc2VJbnQocGFydHNbMF0sIDEwKSxcbiAgICBkaXJlY3Rpb246IHBhcnRzWzBdLmluZGV4T2YoJy8nKSA+IDAgPyBwYXJ0c1swXS5zcGxpdCgnLycpWzFdIDogJ3NlbmRyZWN2JyxcbiAgICB1cmk6IHBhcnRzWzFdLFxuICAgIGF0dHJpYnV0ZXM6IHBhcnRzLnNsaWNlKDIpLmpvaW4oJyAnKSxcbiAgfTtcbn07XG5cbi8vIEdlbmVyYXRlcyBhbiBleHRtYXAgbGluZSBmcm9tIFJUQ1J0cEhlYWRlckV4dGVuc2lvblBhcmFtZXRlcnMgb3Jcbi8vIFJUQ1J0cEhlYWRlckV4dGVuc2lvbi5cblNEUFV0aWxzLndyaXRlRXh0bWFwID0gZnVuY3Rpb24oaGVhZGVyRXh0ZW5zaW9uKSB7XG4gIHJldHVybiAnYT1leHRtYXA6JyArIChoZWFkZXJFeHRlbnNpb24uaWQgfHwgaGVhZGVyRXh0ZW5zaW9uLnByZWZlcnJlZElkKSArXG4gICAgICAoaGVhZGVyRXh0ZW5zaW9uLmRpcmVjdGlvbiAmJiBoZWFkZXJFeHRlbnNpb24uZGlyZWN0aW9uICE9PSAnc2VuZHJlY3YnXG4gICAgICAgID8gJy8nICsgaGVhZGVyRXh0ZW5zaW9uLmRpcmVjdGlvblxuICAgICAgICA6ICcnKSArXG4gICAgICAnICcgKyBoZWFkZXJFeHRlbnNpb24udXJpICtcbiAgICAgIChoZWFkZXJFeHRlbnNpb24uYXR0cmlidXRlcyA/ICcgJyArIGhlYWRlckV4dGVuc2lvbi5hdHRyaWJ1dGVzIDogJycpICtcbiAgICAgICdcXHJcXG4nO1xufTtcblxuLy8gUGFyc2VzIGEgZm10cCBsaW5lLCByZXR1cm5zIGRpY3Rpb25hcnkuIFNhbXBsZSBpbnB1dDpcbi8vIGE9Zm10cDo5NiB2YnI9b247Y25nPW9uXG4vLyBBbHNvIGRlYWxzIHdpdGggdmJyPW9uOyBjbmc9b25cblNEUFV0aWxzLnBhcnNlRm10cCA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgY29uc3QgcGFyc2VkID0ge307XG4gIGxldCBrdjtcbiAgY29uc3QgcGFydHMgPSBsaW5lLnN1YnN0cmluZyhsaW5lLmluZGV4T2YoJyAnKSArIDEpLnNwbGl0KCc7Jyk7XG4gIGZvciAobGV0IGogPSAwOyBqIDwgcGFydHMubGVuZ3RoOyBqKyspIHtcbiAgICBrdiA9IHBhcnRzW2pdLnRyaW0oKS5zcGxpdCgnPScpO1xuICAgIHBhcnNlZFtrdlswXS50cmltKCldID0ga3ZbMV07XG4gIH1cbiAgcmV0dXJuIHBhcnNlZDtcbn07XG5cbi8vIEdlbmVyYXRlcyBhIGZtdHAgbGluZSBmcm9tIFJUQ1J0cENvZGVjQ2FwYWJpbGl0eSBvciBSVENSdHBDb2RlY1BhcmFtZXRlcnMuXG5TRFBVdGlscy53cml0ZUZtdHAgPSBmdW5jdGlvbihjb2RlYykge1xuICBsZXQgbGluZSA9ICcnO1xuICBsZXQgcHQgPSBjb2RlYy5wYXlsb2FkVHlwZTtcbiAgaWYgKGNvZGVjLnByZWZlcnJlZFBheWxvYWRUeXBlICE9PSB1bmRlZmluZWQpIHtcbiAgICBwdCA9IGNvZGVjLnByZWZlcnJlZFBheWxvYWRUeXBlO1xuICB9XG4gIGlmIChjb2RlYy5wYXJhbWV0ZXJzICYmIE9iamVjdC5rZXlzKGNvZGVjLnBhcmFtZXRlcnMpLmxlbmd0aCkge1xuICAgIGNvbnN0IHBhcmFtcyA9IFtdO1xuICAgIE9iamVjdC5rZXlzKGNvZGVjLnBhcmFtZXRlcnMpLmZvckVhY2gocGFyYW0gPT4ge1xuICAgICAgaWYgKGNvZGVjLnBhcmFtZXRlcnNbcGFyYW1dICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcGFyYW1zLnB1c2gocGFyYW0gKyAnPScgKyBjb2RlYy5wYXJhbWV0ZXJzW3BhcmFtXSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwYXJhbXMucHVzaChwYXJhbSk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgbGluZSArPSAnYT1mbXRwOicgKyBwdCArICcgJyArIHBhcmFtcy5qb2luKCc7JykgKyAnXFxyXFxuJztcbiAgfVxuICByZXR1cm4gbGluZTtcbn07XG5cbi8vIFBhcnNlcyBhIHJ0Y3AtZmIgbGluZSwgcmV0dXJucyBSVENQUnRjcEZlZWRiYWNrIG9iamVjdC4gU2FtcGxlIGlucHV0OlxuLy8gYT1ydGNwLWZiOjk4IG5hY2sgcnBzaVxuU0RQVXRpbHMucGFyc2VSdGNwRmIgPSBmdW5jdGlvbihsaW5lKSB7XG4gIGNvbnN0IHBhcnRzID0gbGluZS5zdWJzdHJpbmcobGluZS5pbmRleE9mKCcgJykgKyAxKS5zcGxpdCgnICcpO1xuICByZXR1cm4ge1xuICAgIHR5cGU6IHBhcnRzLnNoaWZ0KCksXG4gICAgcGFyYW1ldGVyOiBwYXJ0cy5qb2luKCcgJyksXG4gIH07XG59O1xuXG4vLyBHZW5lcmF0ZSBhPXJ0Y3AtZmIgbGluZXMgZnJvbSBSVENSdHBDb2RlY0NhcGFiaWxpdHkgb3IgUlRDUnRwQ29kZWNQYXJhbWV0ZXJzLlxuU0RQVXRpbHMud3JpdGVSdGNwRmIgPSBmdW5jdGlvbihjb2RlYykge1xuICBsZXQgbGluZXMgPSAnJztcbiAgbGV0IHB0ID0gY29kZWMucGF5bG9hZFR5cGU7XG4gIGlmIChjb2RlYy5wcmVmZXJyZWRQYXlsb2FkVHlwZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgcHQgPSBjb2RlYy5wcmVmZXJyZWRQYXlsb2FkVHlwZTtcbiAgfVxuICBpZiAoY29kZWMucnRjcEZlZWRiYWNrICYmIGNvZGVjLnJ0Y3BGZWVkYmFjay5sZW5ndGgpIHtcbiAgICAvLyBGSVhNRTogc3BlY2lhbCBoYW5kbGluZyBmb3IgdHJyLWludD9cbiAgICBjb2RlYy5ydGNwRmVlZGJhY2suZm9yRWFjaChmYiA9PiB7XG4gICAgICBsaW5lcyArPSAnYT1ydGNwLWZiOicgKyBwdCArICcgJyArIGZiLnR5cGUgK1xuICAgICAgKGZiLnBhcmFtZXRlciAmJiBmYi5wYXJhbWV0ZXIubGVuZ3RoID8gJyAnICsgZmIucGFyYW1ldGVyIDogJycpICtcbiAgICAgICAgICAnXFxyXFxuJztcbiAgICB9KTtcbiAgfVxuICByZXR1cm4gbGluZXM7XG59O1xuXG4vLyBQYXJzZXMgYSBSRkMgNTU3NiBzc3JjIG1lZGlhIGF0dHJpYnV0ZS4gU2FtcGxlIGlucHV0OlxuLy8gYT1zc3JjOjM3MzU5Mjg1NTkgY25hbWU6c29tZXRoaW5nXG5TRFBVdGlscy5wYXJzZVNzcmNNZWRpYSA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgY29uc3Qgc3AgPSBsaW5lLmluZGV4T2YoJyAnKTtcbiAgY29uc3QgcGFydHMgPSB7XG4gICAgc3NyYzogcGFyc2VJbnQobGluZS5zdWJzdHJpbmcoNywgc3ApLCAxMCksXG4gIH07XG4gIGNvbnN0IGNvbG9uID0gbGluZS5pbmRleE9mKCc6Jywgc3ApO1xuICBpZiAoY29sb24gPiAtMSkge1xuICAgIHBhcnRzLmF0dHJpYnV0ZSA9IGxpbmUuc3Vic3RyaW5nKHNwICsgMSwgY29sb24pO1xuICAgIHBhcnRzLnZhbHVlID0gbGluZS5zdWJzdHJpbmcoY29sb24gKyAxKTtcbiAgfSBlbHNlIHtcbiAgICBwYXJ0cy5hdHRyaWJ1dGUgPSBsaW5lLnN1YnN0cmluZyhzcCArIDEpO1xuICB9XG4gIHJldHVybiBwYXJ0cztcbn07XG5cbi8vIFBhcnNlIGEgc3NyYy1ncm91cCBsaW5lIChzZWUgUkZDIDU1NzYpLiBTYW1wbGUgaW5wdXQ6XG4vLyBhPXNzcmMtZ3JvdXA6c2VtYW50aWNzIDEyIDM0XG5TRFBVdGlscy5wYXJzZVNzcmNHcm91cCA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgY29uc3QgcGFydHMgPSBsaW5lLnN1YnN0cmluZygxMykuc3BsaXQoJyAnKTtcbiAgcmV0dXJuIHtcbiAgICBzZW1hbnRpY3M6IHBhcnRzLnNoaWZ0KCksXG4gICAgc3NyY3M6IHBhcnRzLm1hcChzc3JjID0+IHBhcnNlSW50KHNzcmMsIDEwKSksXG4gIH07XG59O1xuXG4vLyBFeHRyYWN0cyB0aGUgTUlEIChSRkMgNTg4OCkgZnJvbSBhIG1lZGlhIHNlY3Rpb24uXG4vLyBSZXR1cm5zIHRoZSBNSUQgb3IgdW5kZWZpbmVkIGlmIG5vIG1pZCBsaW5lIHdhcyBmb3VuZC5cblNEUFV0aWxzLmdldE1pZCA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbikge1xuICBjb25zdCBtaWQgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPW1pZDonKVswXTtcbiAgaWYgKG1pZCkge1xuICAgIHJldHVybiBtaWQuc3Vic3RyaW5nKDYpO1xuICB9XG59O1xuXG4vLyBQYXJzZXMgYSBmaW5nZXJwcmludCBsaW5lIGZvciBEVExTLVNSVFAuXG5TRFBVdGlscy5wYXJzZUZpbmdlcnByaW50ID0gZnVuY3Rpb24obGluZSkge1xuICBjb25zdCBwYXJ0cyA9IGxpbmUuc3Vic3RyaW5nKDE0KS5zcGxpdCgnICcpO1xuICByZXR1cm4ge1xuICAgIGFsZ29yaXRobTogcGFydHNbMF0udG9Mb3dlckNhc2UoKSwgLy8gYWxnb3JpdGhtIGlzIGNhc2Utc2Vuc2l0aXZlIGluIEVkZ2UuXG4gICAgdmFsdWU6IHBhcnRzWzFdLnRvVXBwZXJDYXNlKCksIC8vIHRoZSBkZWZpbml0aW9uIGlzIHVwcGVyLWNhc2UgaW4gUkZDIDQ1NzIuXG4gIH07XG59O1xuXG4vLyBFeHRyYWN0cyBEVExTIHBhcmFtZXRlcnMgZnJvbSBTRFAgbWVkaWEgc2VjdGlvbiBvciBzZXNzaW9ucGFydC5cbi8vIEZJWE1FOiBmb3IgY29uc2lzdGVuY3kgd2l0aCBvdGhlciBmdW5jdGlvbnMgdGhpcyBzaG91bGQgb25seVxuLy8gICBnZXQgdGhlIGZpbmdlcnByaW50IGxpbmUgYXMgaW5wdXQuIFNlZSBhbHNvIGdldEljZVBhcmFtZXRlcnMuXG5TRFBVdGlscy5nZXREdGxzUGFyYW1ldGVycyA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbiwgc2Vzc2lvbnBhcnQpIHtcbiAgY29uc3QgbGluZXMgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24gKyBzZXNzaW9ucGFydCxcbiAgICAnYT1maW5nZXJwcmludDonKTtcbiAgLy8gTm90ZTogYT1zZXR1cCBsaW5lIGlzIGlnbm9yZWQgc2luY2Ugd2UgdXNlIHRoZSAnYXV0bycgcm9sZSBpbiBFZGdlLlxuICByZXR1cm4ge1xuICAgIHJvbGU6ICdhdXRvJyxcbiAgICBmaW5nZXJwcmludHM6IGxpbmVzLm1hcChTRFBVdGlscy5wYXJzZUZpbmdlcnByaW50KSxcbiAgfTtcbn07XG5cbi8vIFNlcmlhbGl6ZXMgRFRMUyBwYXJhbWV0ZXJzIHRvIFNEUC5cblNEUFV0aWxzLndyaXRlRHRsc1BhcmFtZXRlcnMgPSBmdW5jdGlvbihwYXJhbXMsIHNldHVwVHlwZSkge1xuICBsZXQgc2RwID0gJ2E9c2V0dXA6JyArIHNldHVwVHlwZSArICdcXHJcXG4nO1xuICBwYXJhbXMuZmluZ2VycHJpbnRzLmZvckVhY2goZnAgPT4ge1xuICAgIHNkcCArPSAnYT1maW5nZXJwcmludDonICsgZnAuYWxnb3JpdGhtICsgJyAnICsgZnAudmFsdWUgKyAnXFxyXFxuJztcbiAgfSk7XG4gIHJldHVybiBzZHA7XG59O1xuXG4vLyBQYXJzZXMgYT1jcnlwdG8gbGluZXMgaW50b1xuLy8gICBodHRwczovL3Jhd2dpdC5jb20vYWJvYmEvZWRnZXJ0Yy9tYXN0ZXIvbXNvcnRjLXJzNC5odG1sI2RpY3Rpb25hcnktcnRjc3J0cHNkZXNwYXJhbWV0ZXJzLW1lbWJlcnNcblNEUFV0aWxzLnBhcnNlQ3J5cHRvTGluZSA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgY29uc3QgcGFydHMgPSBsaW5lLnN1YnN0cmluZyg5KS5zcGxpdCgnICcpO1xuICByZXR1cm4ge1xuICAgIHRhZzogcGFyc2VJbnQocGFydHNbMF0sIDEwKSxcbiAgICBjcnlwdG9TdWl0ZTogcGFydHNbMV0sXG4gICAga2V5UGFyYW1zOiBwYXJ0c1syXSxcbiAgICBzZXNzaW9uUGFyYW1zOiBwYXJ0cy5zbGljZSgzKSxcbiAgfTtcbn07XG5cblNEUFV0aWxzLndyaXRlQ3J5cHRvTGluZSA9IGZ1bmN0aW9uKHBhcmFtZXRlcnMpIHtcbiAgcmV0dXJuICdhPWNyeXB0bzonICsgcGFyYW1ldGVycy50YWcgKyAnICcgK1xuICAgIHBhcmFtZXRlcnMuY3J5cHRvU3VpdGUgKyAnICcgK1xuICAgICh0eXBlb2YgcGFyYW1ldGVycy5rZXlQYXJhbXMgPT09ICdvYmplY3QnXG4gICAgICA/IFNEUFV0aWxzLndyaXRlQ3J5cHRvS2V5UGFyYW1zKHBhcmFtZXRlcnMua2V5UGFyYW1zKVxuICAgICAgOiBwYXJhbWV0ZXJzLmtleVBhcmFtcykgK1xuICAgIChwYXJhbWV0ZXJzLnNlc3Npb25QYXJhbXMgPyAnICcgKyBwYXJhbWV0ZXJzLnNlc3Npb25QYXJhbXMuam9pbignICcpIDogJycpICtcbiAgICAnXFxyXFxuJztcbn07XG5cbi8vIFBhcnNlcyB0aGUgY3J5cHRvIGtleSBwYXJhbWV0ZXJzIGludG9cbi8vICAgaHR0cHM6Ly9yYXdnaXQuY29tL2Fib2JhL2VkZ2VydGMvbWFzdGVyL21zb3J0Yy1yczQuaHRtbCNydGNzcnRwa2V5cGFyYW0qXG5TRFBVdGlscy5wYXJzZUNyeXB0b0tleVBhcmFtcyA9IGZ1bmN0aW9uKGtleVBhcmFtcykge1xuICBpZiAoa2V5UGFyYW1zLmluZGV4T2YoJ2lubGluZTonKSAhPT0gMCkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIGNvbnN0IHBhcnRzID0ga2V5UGFyYW1zLnN1YnN0cmluZyg3KS5zcGxpdCgnfCcpO1xuICByZXR1cm4ge1xuICAgIGtleU1ldGhvZDogJ2lubGluZScsXG4gICAga2V5U2FsdDogcGFydHNbMF0sXG4gICAgbGlmZVRpbWU6IHBhcnRzWzFdLFxuICAgIG1raVZhbHVlOiBwYXJ0c1syXSA/IHBhcnRzWzJdLnNwbGl0KCc6JylbMF0gOiB1bmRlZmluZWQsXG4gICAgbWtpTGVuZ3RoOiBwYXJ0c1syXSA/IHBhcnRzWzJdLnNwbGl0KCc6JylbMV0gOiB1bmRlZmluZWQsXG4gIH07XG59O1xuXG5TRFBVdGlscy53cml0ZUNyeXB0b0tleVBhcmFtcyA9IGZ1bmN0aW9uKGtleVBhcmFtcykge1xuICByZXR1cm4ga2V5UGFyYW1zLmtleU1ldGhvZCArICc6J1xuICAgICsga2V5UGFyYW1zLmtleVNhbHQgK1xuICAgIChrZXlQYXJhbXMubGlmZVRpbWUgPyAnfCcgKyBrZXlQYXJhbXMubGlmZVRpbWUgOiAnJykgK1xuICAgIChrZXlQYXJhbXMubWtpVmFsdWUgJiYga2V5UGFyYW1zLm1raUxlbmd0aFxuICAgICAgPyAnfCcgKyBrZXlQYXJhbXMubWtpVmFsdWUgKyAnOicgKyBrZXlQYXJhbXMubWtpTGVuZ3RoXG4gICAgICA6ICcnKTtcbn07XG5cbi8vIEV4dHJhY3RzIGFsbCBTREVTIHBhcmFtZXRlcnMuXG5TRFBVdGlscy5nZXRDcnlwdG9QYXJhbWV0ZXJzID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uLCBzZXNzaW9ucGFydCkge1xuICBjb25zdCBsaW5lcyA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiArIHNlc3Npb25wYXJ0LFxuICAgICdhPWNyeXB0bzonKTtcbiAgcmV0dXJuIGxpbmVzLm1hcChTRFBVdGlscy5wYXJzZUNyeXB0b0xpbmUpO1xufTtcblxuLy8gUGFyc2VzIElDRSBpbmZvcm1hdGlvbiBmcm9tIFNEUCBtZWRpYSBzZWN0aW9uIG9yIHNlc3Npb25wYXJ0LlxuLy8gRklYTUU6IGZvciBjb25zaXN0ZW5jeSB3aXRoIG90aGVyIGZ1bmN0aW9ucyB0aGlzIHNob3VsZCBvbmx5XG4vLyAgIGdldCB0aGUgaWNlLXVmcmFnIGFuZCBpY2UtcHdkIGxpbmVzIGFzIGlucHV0LlxuU0RQVXRpbHMuZ2V0SWNlUGFyYW1ldGVycyA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbiwgc2Vzc2lvbnBhcnQpIHtcbiAgY29uc3QgdWZyYWcgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24gKyBzZXNzaW9ucGFydCxcbiAgICAnYT1pY2UtdWZyYWc6JylbMF07XG4gIGNvbnN0IHB3ZCA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiArIHNlc3Npb25wYXJ0LFxuICAgICdhPWljZS1wd2Q6JylbMF07XG4gIGlmICghKHVmcmFnICYmIHB3ZCkpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICByZXR1cm4ge1xuICAgIHVzZXJuYW1lRnJhZ21lbnQ6IHVmcmFnLnN1YnN0cmluZygxMiksXG4gICAgcGFzc3dvcmQ6IHB3ZC5zdWJzdHJpbmcoMTApLFxuICB9O1xufTtcblxuLy8gU2VyaWFsaXplcyBJQ0UgcGFyYW1ldGVycyB0byBTRFAuXG5TRFBVdGlscy53cml0ZUljZVBhcmFtZXRlcnMgPSBmdW5jdGlvbihwYXJhbXMpIHtcbiAgbGV0IHNkcCA9ICdhPWljZS11ZnJhZzonICsgcGFyYW1zLnVzZXJuYW1lRnJhZ21lbnQgKyAnXFxyXFxuJyArXG4gICAgICAnYT1pY2UtcHdkOicgKyBwYXJhbXMucGFzc3dvcmQgKyAnXFxyXFxuJztcbiAgaWYgKHBhcmFtcy5pY2VMaXRlKSB7XG4gICAgc2RwICs9ICdhPWljZS1saXRlXFxyXFxuJztcbiAgfVxuICByZXR1cm4gc2RwO1xufTtcblxuLy8gUGFyc2VzIHRoZSBTRFAgbWVkaWEgc2VjdGlvbiBhbmQgcmV0dXJucyBSVENSdHBQYXJhbWV0ZXJzLlxuU0RQVXRpbHMucGFyc2VSdHBQYXJhbWV0ZXJzID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIGNvbnN0IGRlc2NyaXB0aW9uID0ge1xuICAgIGNvZGVjczogW10sXG4gICAgaGVhZGVyRXh0ZW5zaW9uczogW10sXG4gICAgZmVjTWVjaGFuaXNtczogW10sXG4gICAgcnRjcDogW10sXG4gIH07XG4gIGNvbnN0IGxpbmVzID0gU0RQVXRpbHMuc3BsaXRMaW5lcyhtZWRpYVNlY3Rpb24pO1xuICBjb25zdCBtbGluZSA9IGxpbmVzWzBdLnNwbGl0KCcgJyk7XG4gIGRlc2NyaXB0aW9uLnByb2ZpbGUgPSBtbGluZVsyXTtcbiAgZm9yIChsZXQgaSA9IDM7IGkgPCBtbGluZS5sZW5ndGg7IGkrKykgeyAvLyBmaW5kIGFsbCBjb2RlY3MgZnJvbSBtbGluZVszLi5dXG4gICAgY29uc3QgcHQgPSBtbGluZVtpXTtcbiAgICBjb25zdCBydHBtYXBsaW5lID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgoXG4gICAgICBtZWRpYVNlY3Rpb24sICdhPXJ0cG1hcDonICsgcHQgKyAnICcpWzBdO1xuICAgIGlmIChydHBtYXBsaW5lKSB7XG4gICAgICBjb25zdCBjb2RlYyA9IFNEUFV0aWxzLnBhcnNlUnRwTWFwKHJ0cG1hcGxpbmUpO1xuICAgICAgY29uc3QgZm10cHMgPSBTRFBVdGlscy5tYXRjaFByZWZpeChcbiAgICAgICAgbWVkaWFTZWN0aW9uLCAnYT1mbXRwOicgKyBwdCArICcgJyk7XG4gICAgICAvLyBPbmx5IHRoZSBmaXJzdCBhPWZtdHA6PHB0PiBpcyBjb25zaWRlcmVkLlxuICAgICAgY29kZWMucGFyYW1ldGVycyA9IGZtdHBzLmxlbmd0aCA/IFNEUFV0aWxzLnBhcnNlRm10cChmbXRwc1swXSkgOiB7fTtcbiAgICAgIGNvZGVjLnJ0Y3BGZWVkYmFjayA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KFxuICAgICAgICBtZWRpYVNlY3Rpb24sICdhPXJ0Y3AtZmI6JyArIHB0ICsgJyAnKVxuICAgICAgICAubWFwKFNEUFV0aWxzLnBhcnNlUnRjcEZiKTtcbiAgICAgIGRlc2NyaXB0aW9uLmNvZGVjcy5wdXNoKGNvZGVjKTtcbiAgICAgIC8vIHBhcnNlIEZFQyBtZWNoYW5pc21zIGZyb20gcnRwbWFwIGxpbmVzLlxuICAgICAgc3dpdGNoIChjb2RlYy5uYW1lLnRvVXBwZXJDYXNlKCkpIHtcbiAgICAgICAgY2FzZSAnUkVEJzpcbiAgICAgICAgY2FzZSAnVUxQRkVDJzpcbiAgICAgICAgICBkZXNjcmlwdGlvbi5mZWNNZWNoYW5pc21zLnB1c2goY29kZWMubmFtZS50b1VwcGVyQ2FzZSgpKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgZGVmYXVsdDogLy8gb25seSBSRUQgYW5kIFVMUEZFQyBhcmUgcmVjb2duaXplZCBhcyBGRUMgbWVjaGFuaXNtcy5cbiAgICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1leHRtYXA6JykuZm9yRWFjaChsaW5lID0+IHtcbiAgICBkZXNjcmlwdGlvbi5oZWFkZXJFeHRlbnNpb25zLnB1c2goU0RQVXRpbHMucGFyc2VFeHRtYXAobGluZSkpO1xuICB9KTtcbiAgY29uc3Qgd2lsZGNhcmRSdGNwRmIgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPXJ0Y3AtZmI6KiAnKVxuICAgIC5tYXAoU0RQVXRpbHMucGFyc2VSdGNwRmIpO1xuICBkZXNjcmlwdGlvbi5jb2RlY3MuZm9yRWFjaChjb2RlYyA9PiB7XG4gICAgd2lsZGNhcmRSdGNwRmIuZm9yRWFjaChmYj0+IHtcbiAgICAgIGNvbnN0IGR1cGxpY2F0ZSA9IGNvZGVjLnJ0Y3BGZWVkYmFjay5maW5kKGV4aXN0aW5nRmVlZGJhY2sgPT4ge1xuICAgICAgICByZXR1cm4gZXhpc3RpbmdGZWVkYmFjay50eXBlID09PSBmYi50eXBlICYmXG4gICAgICAgICAgZXhpc3RpbmdGZWVkYmFjay5wYXJhbWV0ZXIgPT09IGZiLnBhcmFtZXRlcjtcbiAgICAgIH0pO1xuICAgICAgaWYgKCFkdXBsaWNhdGUpIHtcbiAgICAgICAgY29kZWMucnRjcEZlZWRiYWNrLnB1c2goZmIpO1xuICAgICAgfVxuICAgIH0pO1xuICB9KTtcbiAgLy8gRklYTUU6IHBhcnNlIHJ0Y3AuXG4gIHJldHVybiBkZXNjcmlwdGlvbjtcbn07XG5cbi8vIEdlbmVyYXRlcyBwYXJ0cyBvZiB0aGUgU0RQIG1lZGlhIHNlY3Rpb24gZGVzY3JpYmluZyB0aGUgY2FwYWJpbGl0aWVzIC9cbi8vIHBhcmFtZXRlcnMuXG5TRFBVdGlscy53cml0ZVJ0cERlc2NyaXB0aW9uID0gZnVuY3Rpb24oa2luZCwgY2Fwcykge1xuICBsZXQgc2RwID0gJyc7XG5cbiAgLy8gQnVpbGQgdGhlIG1saW5lLlxuICBzZHAgKz0gJ209JyArIGtpbmQgKyAnICc7XG4gIHNkcCArPSBjYXBzLmNvZGVjcy5sZW5ndGggPiAwID8gJzknIDogJzAnOyAvLyByZWplY3QgaWYgbm8gY29kZWNzLlxuICBzZHAgKz0gJyAnICsgKGNhcHMucHJvZmlsZSB8fCAnVURQL1RMUy9SVFAvU0FWUEYnKSArICcgJztcbiAgc2RwICs9IGNhcHMuY29kZWNzLm1hcChjb2RlYyA9PiB7XG4gICAgaWYgKGNvZGVjLnByZWZlcnJlZFBheWxvYWRUeXBlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybiBjb2RlYy5wcmVmZXJyZWRQYXlsb2FkVHlwZTtcbiAgICB9XG4gICAgcmV0dXJuIGNvZGVjLnBheWxvYWRUeXBlO1xuICB9KS5qb2luKCcgJykgKyAnXFxyXFxuJztcblxuICBzZHAgKz0gJ2M9SU4gSVA0IDAuMC4wLjBcXHJcXG4nO1xuICBzZHAgKz0gJ2E9cnRjcDo5IElOIElQNCAwLjAuMC4wXFxyXFxuJztcblxuICAvLyBBZGQgYT1ydHBtYXAgbGluZXMgZm9yIGVhY2ggY29kZWMuIEFsc28gZm10cCBhbmQgcnRjcC1mYi5cbiAgY2Fwcy5jb2RlY3MuZm9yRWFjaChjb2RlYyA9PiB7XG4gICAgc2RwICs9IFNEUFV0aWxzLndyaXRlUnRwTWFwKGNvZGVjKTtcbiAgICBzZHAgKz0gU0RQVXRpbHMud3JpdGVGbXRwKGNvZGVjKTtcbiAgICBzZHAgKz0gU0RQVXRpbHMud3JpdGVSdGNwRmIoY29kZWMpO1xuICB9KTtcbiAgbGV0IG1heHB0aW1lID0gMDtcbiAgY2Fwcy5jb2RlY3MuZm9yRWFjaChjb2RlYyA9PiB7XG4gICAgaWYgKGNvZGVjLm1heHB0aW1lID4gbWF4cHRpbWUpIHtcbiAgICAgIG1heHB0aW1lID0gY29kZWMubWF4cHRpbWU7XG4gICAgfVxuICB9KTtcbiAgaWYgKG1heHB0aW1lID4gMCkge1xuICAgIHNkcCArPSAnYT1tYXhwdGltZTonICsgbWF4cHRpbWUgKyAnXFxyXFxuJztcbiAgfVxuXG4gIGlmIChjYXBzLmhlYWRlckV4dGVuc2lvbnMpIHtcbiAgICBjYXBzLmhlYWRlckV4dGVuc2lvbnMuZm9yRWFjaChleHRlbnNpb24gPT4ge1xuICAgICAgc2RwICs9IFNEUFV0aWxzLndyaXRlRXh0bWFwKGV4dGVuc2lvbik7XG4gICAgfSk7XG4gIH1cbiAgLy8gRklYTUU6IHdyaXRlIGZlY01lY2hhbmlzbXMuXG4gIHJldHVybiBzZHA7XG59O1xuXG4vLyBQYXJzZXMgdGhlIFNEUCBtZWRpYSBzZWN0aW9uIGFuZCByZXR1cm5zIGFuIGFycmF5IG9mXG4vLyBSVENSdHBFbmNvZGluZ1BhcmFtZXRlcnMuXG5TRFBVdGlscy5wYXJzZVJ0cEVuY29kaW5nUGFyYW1ldGVycyA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbikge1xuICBjb25zdCBlbmNvZGluZ1BhcmFtZXRlcnMgPSBbXTtcbiAgY29uc3QgZGVzY3JpcHRpb24gPSBTRFBVdGlscy5wYXJzZVJ0cFBhcmFtZXRlcnMobWVkaWFTZWN0aW9uKTtcbiAgY29uc3QgaGFzUmVkID0gZGVzY3JpcHRpb24uZmVjTWVjaGFuaXNtcy5pbmRleE9mKCdSRUQnKSAhPT0gLTE7XG4gIGNvbnN0IGhhc1VscGZlYyA9IGRlc2NyaXB0aW9uLmZlY01lY2hhbmlzbXMuaW5kZXhPZignVUxQRkVDJykgIT09IC0xO1xuXG4gIC8vIGZpbHRlciBhPXNzcmM6Li4uIGNuYW1lOiwgaWdub3JlIFBsYW5CLW1zaWRcbiAgY29uc3Qgc3NyY3MgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPXNzcmM6JylcbiAgICAubWFwKGxpbmUgPT4gU0RQVXRpbHMucGFyc2VTc3JjTWVkaWEobGluZSkpXG4gICAgLmZpbHRlcihwYXJ0cyA9PiBwYXJ0cy5hdHRyaWJ1dGUgPT09ICdjbmFtZScpO1xuICBjb25zdCBwcmltYXJ5U3NyYyA9IHNzcmNzLmxlbmd0aCA+IDAgJiYgc3NyY3NbMF0uc3NyYztcbiAgbGV0IHNlY29uZGFyeVNzcmM7XG5cbiAgY29uc3QgZmxvd3MgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPXNzcmMtZ3JvdXA6RklEJylcbiAgICAubWFwKGxpbmUgPT4ge1xuICAgICAgY29uc3QgcGFydHMgPSBsaW5lLnN1YnN0cmluZygxNykuc3BsaXQoJyAnKTtcbiAgICAgIHJldHVybiBwYXJ0cy5tYXAocGFydCA9PiBwYXJzZUludChwYXJ0LCAxMCkpO1xuICAgIH0pO1xuICBpZiAoZmxvd3MubGVuZ3RoID4gMCAmJiBmbG93c1swXS5sZW5ndGggPiAxICYmIGZsb3dzWzBdWzBdID09PSBwcmltYXJ5U3NyYykge1xuICAgIHNlY29uZGFyeVNzcmMgPSBmbG93c1swXVsxXTtcbiAgfVxuXG4gIGRlc2NyaXB0aW9uLmNvZGVjcy5mb3JFYWNoKGNvZGVjID0+IHtcbiAgICBpZiAoY29kZWMubmFtZS50b1VwcGVyQ2FzZSgpID09PSAnUlRYJyAmJiBjb2RlYy5wYXJhbWV0ZXJzLmFwdCkge1xuICAgICAgbGV0IGVuY1BhcmFtID0ge1xuICAgICAgICBzc3JjOiBwcmltYXJ5U3NyYyxcbiAgICAgICAgY29kZWNQYXlsb2FkVHlwZTogcGFyc2VJbnQoY29kZWMucGFyYW1ldGVycy5hcHQsIDEwKSxcbiAgICAgIH07XG4gICAgICBpZiAocHJpbWFyeVNzcmMgJiYgc2Vjb25kYXJ5U3NyYykge1xuICAgICAgICBlbmNQYXJhbS5ydHggPSB7c3NyYzogc2Vjb25kYXJ5U3NyY307XG4gICAgICB9XG4gICAgICBlbmNvZGluZ1BhcmFtZXRlcnMucHVzaChlbmNQYXJhbSk7XG4gICAgICBpZiAoaGFzUmVkKSB7XG4gICAgICAgIGVuY1BhcmFtID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShlbmNQYXJhbSkpO1xuICAgICAgICBlbmNQYXJhbS5mZWMgPSB7XG4gICAgICAgICAgc3NyYzogcHJpbWFyeVNzcmMsXG4gICAgICAgICAgbWVjaGFuaXNtOiBoYXNVbHBmZWMgPyAncmVkK3VscGZlYycgOiAncmVkJyxcbiAgICAgICAgfTtcbiAgICAgICAgZW5jb2RpbmdQYXJhbWV0ZXJzLnB1c2goZW5jUGFyYW0pO1xuICAgICAgfVxuICAgIH1cbiAgfSk7XG4gIGlmIChlbmNvZGluZ1BhcmFtZXRlcnMubGVuZ3RoID09PSAwICYmIHByaW1hcnlTc3JjKSB7XG4gICAgZW5jb2RpbmdQYXJhbWV0ZXJzLnB1c2goe1xuICAgICAgc3NyYzogcHJpbWFyeVNzcmMsXG4gICAgfSk7XG4gIH1cblxuICAvLyB3ZSBzdXBwb3J0IGJvdGggYj1BUyBhbmQgYj1USUFTIGJ1dCBpbnRlcnByZXQgQVMgYXMgVElBUy5cbiAgbGV0IGJhbmR3aWR0aCA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2I9Jyk7XG4gIGlmIChiYW5kd2lkdGgubGVuZ3RoKSB7XG4gICAgaWYgKGJhbmR3aWR0aFswXS5pbmRleE9mKCdiPVRJQVM6JykgPT09IDApIHtcbiAgICAgIGJhbmR3aWR0aCA9IHBhcnNlSW50KGJhbmR3aWR0aFswXS5zdWJzdHJpbmcoNyksIDEwKTtcbiAgICB9IGVsc2UgaWYgKGJhbmR3aWR0aFswXS5pbmRleE9mKCdiPUFTOicpID09PSAwKSB7XG4gICAgICAvLyB1c2UgZm9ybXVsYSBmcm9tIEpTRVAgdG8gY29udmVydCBiPUFTIHRvIFRJQVMgdmFsdWUuXG4gICAgICBiYW5kd2lkdGggPSBwYXJzZUludChiYW5kd2lkdGhbMF0uc3Vic3RyaW5nKDUpLCAxMCkgKiAxMDAwICogMC45NVxuICAgICAgICAgIC0gKDUwICogNDAgKiA4KTtcbiAgICB9IGVsc2Uge1xuICAgICAgYmFuZHdpZHRoID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBlbmNvZGluZ1BhcmFtZXRlcnMuZm9yRWFjaChwYXJhbXMgPT4ge1xuICAgICAgcGFyYW1zLm1heEJpdHJhdGUgPSBiYW5kd2lkdGg7XG4gICAgfSk7XG4gIH1cbiAgcmV0dXJuIGVuY29kaW5nUGFyYW1ldGVycztcbn07XG5cbi8vIHBhcnNlcyBodHRwOi8vZHJhZnQub3J0Yy5vcmcvI3J0Y3J0Y3BwYXJhbWV0ZXJzKlxuU0RQVXRpbHMucGFyc2VSdGNwUGFyYW1ldGVycyA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbikge1xuICBjb25zdCBydGNwUGFyYW1ldGVycyA9IHt9O1xuXG4gIC8vIEdldHMgdGhlIGZpcnN0IFNTUkMuIE5vdGUgdGhhdCB3aXRoIFJUWCB0aGVyZSBtaWdodCBiZSBtdWx0aXBsZVxuICAvLyBTU1JDcy5cbiAgY29uc3QgcmVtb3RlU3NyYyA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9c3NyYzonKVxuICAgIC5tYXAobGluZSA9PiBTRFBVdGlscy5wYXJzZVNzcmNNZWRpYShsaW5lKSlcbiAgICAuZmlsdGVyKG9iaiA9PiBvYmouYXR0cmlidXRlID09PSAnY25hbWUnKVswXTtcbiAgaWYgKHJlbW90ZVNzcmMpIHtcbiAgICBydGNwUGFyYW1ldGVycy5jbmFtZSA9IHJlbW90ZVNzcmMudmFsdWU7XG4gICAgcnRjcFBhcmFtZXRlcnMuc3NyYyA9IHJlbW90ZVNzcmMuc3NyYztcbiAgfVxuXG4gIC8vIEVkZ2UgdXNlcyB0aGUgY29tcG91bmQgYXR0cmlidXRlIGluc3RlYWQgb2YgcmVkdWNlZFNpemVcbiAgLy8gY29tcG91bmQgaXMgIXJlZHVjZWRTaXplXG4gIGNvbnN0IHJzaXplID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1ydGNwLXJzaXplJyk7XG4gIHJ0Y3BQYXJhbWV0ZXJzLnJlZHVjZWRTaXplID0gcnNpemUubGVuZ3RoID4gMDtcbiAgcnRjcFBhcmFtZXRlcnMuY29tcG91bmQgPSByc2l6ZS5sZW5ndGggPT09IDA7XG5cbiAgLy8gcGFyc2VzIHRoZSBydGNwLW11eCBhdHRy0ZZidXRlLlxuICAvLyBOb3RlIHRoYXQgRWRnZSBkb2VzIG5vdCBzdXBwb3J0IHVubXV4ZWQgUlRDUC5cbiAgY29uc3QgbXV4ID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1ydGNwLW11eCcpO1xuICBydGNwUGFyYW1ldGVycy5tdXggPSBtdXgubGVuZ3RoID4gMDtcblxuICByZXR1cm4gcnRjcFBhcmFtZXRlcnM7XG59O1xuXG5TRFBVdGlscy53cml0ZVJ0Y3BQYXJhbWV0ZXJzID0gZnVuY3Rpb24ocnRjcFBhcmFtZXRlcnMpIHtcbiAgbGV0IHNkcCA9ICcnO1xuICBpZiAocnRjcFBhcmFtZXRlcnMucmVkdWNlZFNpemUpIHtcbiAgICBzZHAgKz0gJ2E9cnRjcC1yc2l6ZVxcclxcbic7XG4gIH1cbiAgaWYgKHJ0Y3BQYXJhbWV0ZXJzLm11eCkge1xuICAgIHNkcCArPSAnYT1ydGNwLW11eFxcclxcbic7XG4gIH1cbiAgaWYgKHJ0Y3BQYXJhbWV0ZXJzLnNzcmMgIT09IHVuZGVmaW5lZCAmJiBydGNwUGFyYW1ldGVycy5jbmFtZSkge1xuICAgIHNkcCArPSAnYT1zc3JjOicgKyBydGNwUGFyYW1ldGVycy5zc3JjICtcbiAgICAgICcgY25hbWU6JyArIHJ0Y3BQYXJhbWV0ZXJzLmNuYW1lICsgJ1xcclxcbic7XG4gIH1cbiAgcmV0dXJuIHNkcDtcbn07XG5cblxuLy8gcGFyc2VzIGVpdGhlciBhPW1zaWQ6IG9yIGE9c3NyYzouLi4gbXNpZCBsaW5lcyBhbmQgcmV0dXJuc1xuLy8gdGhlIGlkIG9mIHRoZSBNZWRpYVN0cmVhbSBhbmQgTWVkaWFTdHJlYW1UcmFjay5cblNEUFV0aWxzLnBhcnNlTXNpZCA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbikge1xuICBsZXQgcGFydHM7XG4gIGNvbnN0IHNwZWMgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPW1zaWQ6Jyk7XG4gIGlmIChzcGVjLmxlbmd0aCA9PT0gMSkge1xuICAgIHBhcnRzID0gc3BlY1swXS5zdWJzdHJpbmcoNykuc3BsaXQoJyAnKTtcbiAgICByZXR1cm4ge3N0cmVhbTogcGFydHNbMF0sIHRyYWNrOiBwYXJ0c1sxXX07XG4gIH1cbiAgY29uc3QgcGxhbkIgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPXNzcmM6JylcbiAgICAubWFwKGxpbmUgPT4gU0RQVXRpbHMucGFyc2VTc3JjTWVkaWEobGluZSkpXG4gICAgLmZpbHRlcihtc2lkUGFydHMgPT4gbXNpZFBhcnRzLmF0dHJpYnV0ZSA9PT0gJ21zaWQnKTtcbiAgaWYgKHBsYW5CLmxlbmd0aCA+IDApIHtcbiAgICBwYXJ0cyA9IHBsYW5CWzBdLnZhbHVlLnNwbGl0KCcgJyk7XG4gICAgcmV0dXJuIHtzdHJlYW06IHBhcnRzWzBdLCB0cmFjazogcGFydHNbMV19O1xuICB9XG59O1xuXG4vLyBTQ1RQXG4vLyBwYXJzZXMgZHJhZnQtaWV0Zi1tbXVzaWMtc2N0cC1zZHAtMjYgZmlyc3QgYW5kIGZhbGxzIGJhY2tcbi8vIHRvIGRyYWZ0LWlldGYtbW11c2ljLXNjdHAtc2RwLTA1XG5TRFBVdGlscy5wYXJzZVNjdHBEZXNjcmlwdGlvbiA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbikge1xuICBjb25zdCBtbGluZSA9IFNEUFV0aWxzLnBhcnNlTUxpbmUobWVkaWFTZWN0aW9uKTtcbiAgY29uc3QgbWF4U2l6ZUxpbmUgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPW1heC1tZXNzYWdlLXNpemU6Jyk7XG4gIGxldCBtYXhNZXNzYWdlU2l6ZTtcbiAgaWYgKG1heFNpemVMaW5lLmxlbmd0aCA+IDApIHtcbiAgICBtYXhNZXNzYWdlU2l6ZSA9IHBhcnNlSW50KG1heFNpemVMaW5lWzBdLnN1YnN0cmluZygxOSksIDEwKTtcbiAgfVxuICBpZiAoaXNOYU4obWF4TWVzc2FnZVNpemUpKSB7XG4gICAgbWF4TWVzc2FnZVNpemUgPSA2NTUzNjtcbiAgfVxuICBjb25zdCBzY3RwUG9ydCA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9c2N0cC1wb3J0OicpO1xuICBpZiAoc2N0cFBvcnQubGVuZ3RoID4gMCkge1xuICAgIHJldHVybiB7XG4gICAgICBwb3J0OiBwYXJzZUludChzY3RwUG9ydFswXS5zdWJzdHJpbmcoMTIpLCAxMCksXG4gICAgICBwcm90b2NvbDogbWxpbmUuZm10LFxuICAgICAgbWF4TWVzc2FnZVNpemUsXG4gICAgfTtcbiAgfVxuICBjb25zdCBzY3RwTWFwTGluZXMgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPXNjdHBtYXA6Jyk7XG4gIGlmIChzY3RwTWFwTGluZXMubGVuZ3RoID4gMCkge1xuICAgIGNvbnN0IHBhcnRzID0gc2N0cE1hcExpbmVzWzBdXG4gICAgICAuc3Vic3RyaW5nKDEwKVxuICAgICAgLnNwbGl0KCcgJyk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHBvcnQ6IHBhcnNlSW50KHBhcnRzWzBdLCAxMCksXG4gICAgICBwcm90b2NvbDogcGFydHNbMV0sXG4gICAgICBtYXhNZXNzYWdlU2l6ZSxcbiAgICB9O1xuICB9XG59O1xuXG4vLyBTQ1RQXG4vLyBvdXRwdXRzIHRoZSBkcmFmdC1pZXRmLW1tdXNpYy1zY3RwLXNkcC0yNiB2ZXJzaW9uIHRoYXQgYWxsIGJyb3dzZXJzXG4vLyBzdXBwb3J0IGJ5IG5vdyByZWNlaXZpbmcgaW4gdGhpcyBmb3JtYXQsIHVubGVzcyB3ZSBvcmlnaW5hbGx5IHBhcnNlZFxuLy8gYXMgdGhlIGRyYWZ0LWlldGYtbW11c2ljLXNjdHAtc2RwLTA1IGZvcm1hdCAoaW5kaWNhdGVkIGJ5IHRoZSBtLWxpbmVcbi8vIHByb3RvY29sIG9mIERUTFMvU0NUUCAtLSB3aXRob3V0IFVEUC8gb3IgVENQLylcblNEUFV0aWxzLndyaXRlU2N0cERlc2NyaXB0aW9uID0gZnVuY3Rpb24obWVkaWEsIHNjdHApIHtcbiAgbGV0IG91dHB1dCA9IFtdO1xuICBpZiAobWVkaWEucHJvdG9jb2wgIT09ICdEVExTL1NDVFAnKSB7XG4gICAgb3V0cHV0ID0gW1xuICAgICAgJ209JyArIG1lZGlhLmtpbmQgKyAnIDkgJyArIG1lZGlhLnByb3RvY29sICsgJyAnICsgc2N0cC5wcm90b2NvbCArICdcXHJcXG4nLFxuICAgICAgJ2M9SU4gSVA0IDAuMC4wLjBcXHJcXG4nLFxuICAgICAgJ2E9c2N0cC1wb3J0OicgKyBzY3RwLnBvcnQgKyAnXFxyXFxuJyxcbiAgICBdO1xuICB9IGVsc2Uge1xuICAgIG91dHB1dCA9IFtcbiAgICAgICdtPScgKyBtZWRpYS5raW5kICsgJyA5ICcgKyBtZWRpYS5wcm90b2NvbCArICcgJyArIHNjdHAucG9ydCArICdcXHJcXG4nLFxuICAgICAgJ2M9SU4gSVA0IDAuMC4wLjBcXHJcXG4nLFxuICAgICAgJ2E9c2N0cG1hcDonICsgc2N0cC5wb3J0ICsgJyAnICsgc2N0cC5wcm90b2NvbCArICcgNjU1MzVcXHJcXG4nLFxuICAgIF07XG4gIH1cbiAgaWYgKHNjdHAubWF4TWVzc2FnZVNpemUgIT09IHVuZGVmaW5lZCkge1xuICAgIG91dHB1dC5wdXNoKCdhPW1heC1tZXNzYWdlLXNpemU6JyArIHNjdHAubWF4TWVzc2FnZVNpemUgKyAnXFxyXFxuJyk7XG4gIH1cbiAgcmV0dXJuIG91dHB1dC5qb2luKCcnKTtcbn07XG5cbi8vIEdlbmVyYXRlIGEgc2Vzc2lvbiBJRCBmb3IgU0RQLlxuLy8gaHR0cHM6Ly90b29scy5pZXRmLm9yZy9odG1sL2RyYWZ0LWlldGYtcnRjd2ViLWpzZXAtMjAjc2VjdGlvbi01LjIuMVxuLy8gcmVjb21tZW5kcyB1c2luZyBhIGNyeXB0b2dyYXBoaWNhbGx5IHJhbmRvbSArdmUgNjQtYml0IHZhbHVlXG4vLyBidXQgcmlnaHQgbm93IHRoaXMgc2hvdWxkIGJlIGFjY2VwdGFibGUgYW5kIHdpdGhpbiB0aGUgcmlnaHQgcmFuZ2VcblNEUFV0aWxzLmdlbmVyYXRlU2Vzc2lvbklkID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKCkuc3Vic3RyKDIsIDIyKTtcbn07XG5cbi8vIFdyaXRlIGJvaWxlciBwbGF0ZSBmb3Igc3RhcnQgb2YgU0RQXG4vLyBzZXNzSWQgYXJndW1lbnQgaXMgb3B0aW9uYWwgLSBpZiBub3Qgc3VwcGxpZWQgaXQgd2lsbFxuLy8gYmUgZ2VuZXJhdGVkIHJhbmRvbWx5XG4vLyBzZXNzVmVyc2lvbiBpcyBvcHRpb25hbCBhbmQgZGVmYXVsdHMgdG8gMlxuLy8gc2Vzc1VzZXIgaXMgb3B0aW9uYWwgYW5kIGRlZmF1bHRzIHRvICd0aGlzaXNhZGFwdGVyb3J0YydcblNEUFV0aWxzLndyaXRlU2Vzc2lvbkJvaWxlcnBsYXRlID0gZnVuY3Rpb24oc2Vzc0lkLCBzZXNzVmVyLCBzZXNzVXNlcikge1xuICBsZXQgc2Vzc2lvbklkO1xuICBjb25zdCB2ZXJzaW9uID0gc2Vzc1ZlciAhPT0gdW5kZWZpbmVkID8gc2Vzc1ZlciA6IDI7XG4gIGlmIChzZXNzSWQpIHtcbiAgICBzZXNzaW9uSWQgPSBzZXNzSWQ7XG4gIH0gZWxzZSB7XG4gICAgc2Vzc2lvbklkID0gU0RQVXRpbHMuZ2VuZXJhdGVTZXNzaW9uSWQoKTtcbiAgfVxuICBjb25zdCB1c2VyID0gc2Vzc1VzZXIgfHwgJ3RoaXNpc2FkYXB0ZXJvcnRjJztcbiAgLy8gRklYTUU6IHNlc3MtaWQgc2hvdWxkIGJlIGFuIE5UUCB0aW1lc3RhbXAuXG4gIHJldHVybiAndj0wXFxyXFxuJyArXG4gICAgICAnbz0nICsgdXNlciArICcgJyArIHNlc3Npb25JZCArICcgJyArIHZlcnNpb24gK1xuICAgICAgICAnIElOIElQNCAxMjcuMC4wLjFcXHJcXG4nICtcbiAgICAgICdzPS1cXHJcXG4nICtcbiAgICAgICd0PTAgMFxcclxcbic7XG59O1xuXG4vLyBHZXRzIHRoZSBkaXJlY3Rpb24gZnJvbSB0aGUgbWVkaWFTZWN0aW9uIG9yIHRoZSBzZXNzaW9ucGFydC5cblNEUFV0aWxzLmdldERpcmVjdGlvbiA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbiwgc2Vzc2lvbnBhcnQpIHtcbiAgLy8gTG9vayBmb3Igc2VuZHJlY3YsIHNlbmRvbmx5LCByZWN2b25seSwgaW5hY3RpdmUsIGRlZmF1bHQgdG8gc2VuZHJlY3YuXG4gIGNvbnN0IGxpbmVzID0gU0RQVXRpbHMuc3BsaXRMaW5lcyhtZWRpYVNlY3Rpb24pO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGxpbmVzLmxlbmd0aDsgaSsrKSB7XG4gICAgc3dpdGNoIChsaW5lc1tpXSkge1xuICAgICAgY2FzZSAnYT1zZW5kcmVjdic6XG4gICAgICBjYXNlICdhPXNlbmRvbmx5JzpcbiAgICAgIGNhc2UgJ2E9cmVjdm9ubHknOlxuICAgICAgY2FzZSAnYT1pbmFjdGl2ZSc6XG4gICAgICAgIHJldHVybiBsaW5lc1tpXS5zdWJzdHJpbmcoMik7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICAvLyBGSVhNRTogV2hhdCBzaG91bGQgaGFwcGVuIGhlcmU/XG4gICAgfVxuICB9XG4gIGlmIChzZXNzaW9ucGFydCkge1xuICAgIHJldHVybiBTRFBVdGlscy5nZXREaXJlY3Rpb24oc2Vzc2lvbnBhcnQpO1xuICB9XG4gIHJldHVybiAnc2VuZHJlY3YnO1xufTtcblxuU0RQVXRpbHMuZ2V0S2luZCA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbikge1xuICBjb25zdCBsaW5lcyA9IFNEUFV0aWxzLnNwbGl0TGluZXMobWVkaWFTZWN0aW9uKTtcbiAgY29uc3QgbWxpbmUgPSBsaW5lc1swXS5zcGxpdCgnICcpO1xuICByZXR1cm4gbWxpbmVbMF0uc3Vic3RyaW5nKDIpO1xufTtcblxuU0RQVXRpbHMuaXNSZWplY3RlZCA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbikge1xuICByZXR1cm4gbWVkaWFTZWN0aW9uLnNwbGl0KCcgJywgMilbMV0gPT09ICcwJztcbn07XG5cblNEUFV0aWxzLnBhcnNlTUxpbmUgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgY29uc3QgbGluZXMgPSBTRFBVdGlscy5zcGxpdExpbmVzKG1lZGlhU2VjdGlvbik7XG4gIGNvbnN0IHBhcnRzID0gbGluZXNbMF0uc3Vic3RyaW5nKDIpLnNwbGl0KCcgJyk7XG4gIHJldHVybiB7XG4gICAga2luZDogcGFydHNbMF0sXG4gICAgcG9ydDogcGFyc2VJbnQocGFydHNbMV0sIDEwKSxcbiAgICBwcm90b2NvbDogcGFydHNbMl0sXG4gICAgZm10OiBwYXJ0cy5zbGljZSgzKS5qb2luKCcgJyksXG4gIH07XG59O1xuXG5TRFBVdGlscy5wYXJzZU9MaW5lID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIGNvbnN0IGxpbmUgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdvPScpWzBdO1xuICBjb25zdCBwYXJ0cyA9IGxpbmUuc3Vic3RyaW5nKDIpLnNwbGl0KCcgJyk7XG4gIHJldHVybiB7XG4gICAgdXNlcm5hbWU6IHBhcnRzWzBdLFxuICAgIHNlc3Npb25JZDogcGFydHNbMV0sXG4gICAgc2Vzc2lvblZlcnNpb246IHBhcnNlSW50KHBhcnRzWzJdLCAxMCksXG4gICAgbmV0VHlwZTogcGFydHNbM10sXG4gICAgYWRkcmVzc1R5cGU6IHBhcnRzWzRdLFxuICAgIGFkZHJlc3M6IHBhcnRzWzVdLFxuICB9O1xufTtcblxuLy8gYSB2ZXJ5IG5haXZlIGludGVycHJldGF0aW9uIG9mIGEgdmFsaWQgU0RQLlxuU0RQVXRpbHMuaXNWYWxpZFNEUCA9IGZ1bmN0aW9uKGJsb2IpIHtcbiAgaWYgKHR5cGVvZiBibG9iICE9PSAnc3RyaW5nJyB8fCBibG9iLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBjb25zdCBsaW5lcyA9IFNEUFV0aWxzLnNwbGl0TGluZXMoYmxvYik7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgbGluZXMubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAobGluZXNbaV0ubGVuZ3RoIDwgMiB8fCBsaW5lc1tpXS5jaGFyQXQoMSkgIT09ICc9Jykge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICAvLyBUT0RPOiBjaGVjayB0aGUgbW9kaWZpZXIgYSBiaXQgbW9yZS5cbiAgfVxuICByZXR1cm4gdHJ1ZTtcbn07XG5cbi8vIEV4cG9zZSBwdWJsaWMgbWV0aG9kcy5cbmlmICh0eXBlb2YgbW9kdWxlID09PSAnb2JqZWN0Jykge1xuICBtb2R1bGUuZXhwb3J0cyA9IFNEUFV0aWxzO1xufVxuIiwiLy8gVGhlIG1vZHVsZSBjYWNoZVxudmFyIF9fd2VicGFja19tb2R1bGVfY2FjaGVfXyA9IHt9O1xuXG4vLyBUaGUgcmVxdWlyZSBmdW5jdGlvblxuZnVuY3Rpb24gX193ZWJwYWNrX3JlcXVpcmVfXyhtb2R1bGVJZCkge1xuXHQvLyBDaGVjayBpZiBtb2R1bGUgaXMgaW4gY2FjaGVcblx0dmFyIGNhY2hlZE1vZHVsZSA9IF9fd2VicGFja19tb2R1bGVfY2FjaGVfX1ttb2R1bGVJZF07XG5cdGlmIChjYWNoZWRNb2R1bGUgIT09IHVuZGVmaW5lZCkge1xuXHRcdHJldHVybiBjYWNoZWRNb2R1bGUuZXhwb3J0cztcblx0fVxuXHQvLyBDcmVhdGUgYSBuZXcgbW9kdWxlIChhbmQgcHV0IGl0IGludG8gdGhlIGNhY2hlKVxuXHR2YXIgbW9kdWxlID0gX193ZWJwYWNrX21vZHVsZV9jYWNoZV9fW21vZHVsZUlkXSA9IHtcblx0XHQvLyBubyBtb2R1bGUuaWQgbmVlZGVkXG5cdFx0Ly8gbm8gbW9kdWxlLmxvYWRlZCBuZWVkZWRcblx0XHRleHBvcnRzOiB7fVxuXHR9O1xuXG5cdC8vIEV4ZWN1dGUgdGhlIG1vZHVsZSBmdW5jdGlvblxuXHRfX3dlYnBhY2tfbW9kdWxlc19fW21vZHVsZUlkXShtb2R1bGUsIG1vZHVsZS5leHBvcnRzLCBfX3dlYnBhY2tfcmVxdWlyZV9fKTtcblxuXHQvLyBSZXR1cm4gdGhlIGV4cG9ydHMgb2YgdGhlIG1vZHVsZVxuXHRyZXR1cm4gbW9kdWxlLmV4cG9ydHM7XG59XG5cbiIsIiIsIi8vIHN0YXJ0dXBcbi8vIExvYWQgZW50cnkgbW9kdWxlIGFuZCByZXR1cm4gZXhwb3J0c1xuLy8gVGhpcyBlbnRyeSBtb2R1bGUgaXMgcmVmZXJlbmNlZCBieSBvdGhlciBtb2R1bGVzIHNvIGl0IGNhbid0IGJlIGlubGluZWRcbnZhciBfX3dlYnBhY2tfZXhwb3J0c19fID0gX193ZWJwYWNrX3JlcXVpcmVfXyhcIi4vc3JjL2luZGV4LmpzXCIpO1xuIiwiIl0sIm5hbWVzIjpbIl9yZWdlbmVyYXRvclJ1bnRpbWUiLCJleHBvcnRzIiwiT3AiLCJPYmplY3QiLCJwcm90b3R5cGUiLCJoYXNPd24iLCJoYXNPd25Qcm9wZXJ0eSIsImRlZmluZVByb3BlcnR5Iiwib2JqIiwia2V5IiwiZGVzYyIsInZhbHVlIiwiJFN5bWJvbCIsIlN5bWJvbCIsIml0ZXJhdG9yU3ltYm9sIiwiaXRlcmF0b3IiLCJhc3luY0l0ZXJhdG9yU3ltYm9sIiwiYXN5bmNJdGVyYXRvciIsInRvU3RyaW5nVGFnU3ltYm9sIiwidG9TdHJpbmdUYWciLCJkZWZpbmUiLCJlbnVtZXJhYmxlIiwiY29uZmlndXJhYmxlIiwid3JpdGFibGUiLCJlcnIiLCJ3cmFwIiwiaW5uZXJGbiIsIm91dGVyRm4iLCJzZWxmIiwidHJ5TG9jc0xpc3QiLCJwcm90b0dlbmVyYXRvciIsIkdlbmVyYXRvciIsImdlbmVyYXRvciIsImNyZWF0ZSIsImNvbnRleHQiLCJDb250ZXh0IiwibWFrZUludm9rZU1ldGhvZCIsInRyeUNhdGNoIiwiZm4iLCJhcmciLCJ0eXBlIiwiY2FsbCIsIkNvbnRpbnVlU2VudGluZWwiLCJHZW5lcmF0b3JGdW5jdGlvbiIsIkdlbmVyYXRvckZ1bmN0aW9uUHJvdG90eXBlIiwiSXRlcmF0b3JQcm90b3R5cGUiLCJnZXRQcm90byIsImdldFByb3RvdHlwZU9mIiwiTmF0aXZlSXRlcmF0b3JQcm90b3R5cGUiLCJ2YWx1ZXMiLCJHcCIsImRlZmluZUl0ZXJhdG9yTWV0aG9kcyIsImZvckVhY2giLCJtZXRob2QiLCJfaW52b2tlIiwiQXN5bmNJdGVyYXRvciIsIlByb21pc2VJbXBsIiwiaW52b2tlIiwicmVzb2x2ZSIsInJlamVjdCIsInJlY29yZCIsInJlc3VsdCIsIl90eXBlb2YiLCJfX2F3YWl0IiwidGhlbiIsInVud3JhcHBlZCIsImVycm9yIiwicHJldmlvdXNQcm9taXNlIiwiY2FsbEludm9rZVdpdGhNZXRob2RBbmRBcmciLCJzdGF0ZSIsIkVycm9yIiwiZG9uZVJlc3VsdCIsImRlbGVnYXRlIiwiZGVsZWdhdGVSZXN1bHQiLCJtYXliZUludm9rZURlbGVnYXRlIiwic2VudCIsIl9zZW50IiwiZGlzcGF0Y2hFeGNlcHRpb24iLCJhYnJ1cHQiLCJkb25lIiwibWV0aG9kTmFtZSIsInVuZGVmaW5lZCIsIlR5cGVFcnJvciIsImluZm8iLCJyZXN1bHROYW1lIiwibmV4dCIsIm5leHRMb2MiLCJwdXNoVHJ5RW50cnkiLCJsb2NzIiwiZW50cnkiLCJ0cnlMb2MiLCJjYXRjaExvYyIsImZpbmFsbHlMb2MiLCJhZnRlckxvYyIsInRyeUVudHJpZXMiLCJwdXNoIiwicmVzZXRUcnlFbnRyeSIsImNvbXBsZXRpb24iLCJyZXNldCIsIml0ZXJhYmxlIiwiaXRlcmF0b3JNZXRob2QiLCJpc05hTiIsImxlbmd0aCIsImkiLCJkaXNwbGF5TmFtZSIsImlzR2VuZXJhdG9yRnVuY3Rpb24iLCJnZW5GdW4iLCJjdG9yIiwiY29uc3RydWN0b3IiLCJuYW1lIiwibWFyayIsInNldFByb3RvdHlwZU9mIiwiX19wcm90b19fIiwiYXdyYXAiLCJhc3luYyIsIlByb21pc2UiLCJpdGVyIiwia2V5cyIsInZhbCIsIm9iamVjdCIsInJldmVyc2UiLCJwb3AiLCJza2lwVGVtcFJlc2V0IiwicHJldiIsImNoYXJBdCIsInNsaWNlIiwic3RvcCIsInJvb3RSZWNvcmQiLCJydmFsIiwiZXhjZXB0aW9uIiwiaGFuZGxlIiwibG9jIiwiY2F1Z2h0IiwiaGFzQ2F0Y2giLCJoYXNGaW5hbGx5IiwiZmluYWxseUVudHJ5IiwiY29tcGxldGUiLCJmaW5pc2giLCJfY2F0Y2giLCJ0aHJvd24iLCJkZWxlZ2F0ZVlpZWxkIiwiYXN5bmNHZW5lcmF0b3JTdGVwIiwiZ2VuIiwiX25leHQiLCJfdGhyb3ciLCJfYXN5bmNUb0dlbmVyYXRvciIsImFyZ3MiLCJhcmd1bWVudHMiLCJhcHBseSIsIl9jbGFzc0NhbGxDaGVjayIsImluc3RhbmNlIiwiQ29uc3RydWN0b3IiLCJfZGVmaW5lUHJvcGVydGllcyIsInRhcmdldCIsInByb3BzIiwiZGVzY3JpcHRvciIsIl90b1Byb3BlcnR5S2V5IiwiX2NyZWF0ZUNsYXNzIiwicHJvdG9Qcm9wcyIsInN0YXRpY1Byb3BzIiwiX3RvUHJpbWl0aXZlIiwiU3RyaW5nIiwiaW5wdXQiLCJoaW50IiwicHJpbSIsInRvUHJpbWl0aXZlIiwicmVzIiwiTnVtYmVyIiwibWoiLCJyZXF1aXJlIiwiSmFudXNTZXNzaW9uIiwic2VuZE9yaWdpbmFsIiwic2VuZCIsInNpZ25hbCIsImUiLCJtZXNzYWdlIiwiaW5kZXhPZiIsImNvbnNvbGUiLCJOQUYiLCJjb25uZWN0aW9uIiwiYWRhcHRlciIsInJlY29ubmVjdCIsInNkcFV0aWxzIiwiZGVidWciLCJ3YXJuIiwiaXNTYWZhcmkiLCJ0ZXN0IiwibmF2aWdhdG9yIiwidXNlckFnZW50IiwiU1VCU0NSSUJFX1RJTUVPVVRfTVMiLCJBVkFJTEFCTEVfT0NDVVBBTlRTX1RIUkVTSE9MRCIsIk1BWF9TVUJTQ1JJQkVfREVMQVkiLCJyYW5kb21EZWxheSIsIm1pbiIsIm1heCIsImRlbGF5IiwiTWF0aCIsInJhbmRvbSIsInNldFRpbWVvdXQiLCJkZWJvdW5jZSIsImN1cnIiLCJfdGhpcyIsIkFycmF5IiwiXyIsInJhbmRvbVVpbnQiLCJmbG9vciIsIk1BWF9TQUZFX0lOVEVHRVIiLCJ1bnRpbERhdGFDaGFubmVsT3BlbiIsImRhdGFDaGFubmVsIiwicmVhZHlTdGF0ZSIsInJlc29sdmVyIiwicmVqZWN0b3IiLCJjbGVhciIsInJlbW92ZUV2ZW50TGlzdGVuZXIiLCJhZGRFdmVudExpc3RlbmVyIiwiaXNIMjY0VmlkZW9TdXBwb3J0ZWQiLCJ2aWRlbyIsImRvY3VtZW50IiwiY3JlYXRlRWxlbWVudCIsImNhblBsYXlUeXBlIiwiT1BVU19QQVJBTUVURVJTIiwidXNlZHR4Iiwic3RlcmVvIiwiREVGQVVMVF9QRUVSX0NPTk5FQ1RJT05fQ09ORklHIiwiaWNlU2VydmVycyIsInVybHMiLCJXU19OT1JNQUxfQ0xPU1VSRSIsIkphbnVzQWRhcHRlciIsInJvb20iLCJjbGllbnRJZCIsImpvaW5Ub2tlbiIsInNlcnZlclVybCIsIndlYlJ0Y09wdGlvbnMiLCJwZWVyQ29ubmVjdGlvbkNvbmZpZyIsIndzIiwic2Vzc2lvbiIsInJlbGlhYmxlVHJhbnNwb3J0IiwidW5yZWxpYWJsZVRyYW5zcG9ydCIsImluaXRpYWxSZWNvbm5lY3Rpb25EZWxheSIsInJlY29ubmVjdGlvbkRlbGF5IiwicmVjb25uZWN0aW9uVGltZW91dCIsIm1heFJlY29ubmVjdGlvbkF0dGVtcHRzIiwicmVjb25uZWN0aW9uQXR0ZW1wdHMiLCJwdWJsaXNoZXIiLCJvY2N1cGFudElkcyIsIm9jY3VwYW50cyIsIm1lZGlhU3RyZWFtcyIsImxvY2FsTWVkaWFTdHJlYW0iLCJwZW5kaW5nTWVkaWFSZXF1ZXN0cyIsIk1hcCIsInBlbmRpbmdPY2N1cGFudHMiLCJTZXQiLCJhdmFpbGFibGVPY2N1cGFudHMiLCJyZXF1ZXN0ZWRPY2N1cGFudHMiLCJibG9ja2VkQ2xpZW50cyIsImZyb3plblVwZGF0ZXMiLCJ0aW1lT2Zmc2V0cyIsInNlcnZlclRpbWVSZXF1ZXN0cyIsImF2Z1RpbWVPZmZzZXQiLCJvbldlYnNvY2tldE9wZW4iLCJiaW5kIiwib25XZWJzb2NrZXRDbG9zZSIsIm9uV2Vic29ja2V0TWVzc2FnZSIsIm9uRGF0YUNoYW5uZWxNZXNzYWdlIiwib25EYXRhIiwic2V0U2VydmVyVXJsIiwidXJsIiwic2V0QXBwIiwiYXBwIiwic2V0Um9vbSIsInJvb21OYW1lIiwic2V0Sm9pblRva2VuIiwic2V0Q2xpZW50SWQiLCJzZXRXZWJSdGNPcHRpb25zIiwib3B0aW9ucyIsInNldFBlZXJDb25uZWN0aW9uQ29uZmlnIiwic2V0U2VydmVyQ29ubmVjdExpc3RlbmVycyIsInN1Y2Nlc3NMaXN0ZW5lciIsImZhaWx1cmVMaXN0ZW5lciIsImNvbm5lY3RTdWNjZXNzIiwiY29ubmVjdEZhaWx1cmUiLCJzZXRSb29tT2NjdXBhbnRMaXN0ZW5lciIsIm9jY3VwYW50TGlzdGVuZXIiLCJvbk9jY3VwYW50c0NoYW5nZWQiLCJzZXREYXRhQ2hhbm5lbExpc3RlbmVycyIsIm9wZW5MaXN0ZW5lciIsImNsb3NlZExpc3RlbmVyIiwibWVzc2FnZUxpc3RlbmVyIiwib25PY2N1cGFudENvbm5lY3RlZCIsIm9uT2NjdXBhbnREaXNjb25uZWN0ZWQiLCJvbk9jY3VwYW50TWVzc2FnZSIsInNldFJlY29ubmVjdGlvbkxpc3RlbmVycyIsInJlY29ubmVjdGluZ0xpc3RlbmVyIiwicmVjb25uZWN0ZWRMaXN0ZW5lciIsInJlY29ubmVjdGlvbkVycm9yTGlzdGVuZXIiLCJvblJlY29ubmVjdGluZyIsIm9uUmVjb25uZWN0ZWQiLCJvblJlY29ubmVjdGlvbkVycm9yIiwic2V0RXZlbnRMb29wcyIsImxvb3BzIiwiY29ubmVjdCIsIl90aGlzMiIsImNvbmNhdCIsIndlYnNvY2tldENvbm5lY3Rpb24iLCJXZWJTb2NrZXQiLCJ0aW1lb3V0TXMiLCJ3c09uT3BlbiIsImFsbCIsInVwZGF0ZVRpbWVPZmZzZXQiLCJkaXNjb25uZWN0IiwiY2xlYXJUaW1lb3V0IiwicmVtb3ZlQWxsT2NjdXBhbnRzIiwiY29ubiIsImNsb3NlIiwiZGlzcG9zZSIsImRlbGF5ZWRSZWNvbm5lY3RUaW1lb3V0IiwiaXNEaXNjb25uZWN0ZWQiLCJfb25XZWJzb2NrZXRPcGVuIiwiX2NhbGxlZSIsIm9jY3VwYW50SWQiLCJfY2FsbGVlJCIsIl9jb250ZXh0IiwiY3JlYXRlUHVibGlzaGVyIiwiaW5pdGlhbE9jY3VwYW50cyIsImFkZEF2YWlsYWJsZU9jY3VwYW50Iiwic3luY09jY3VwYW50cyIsImV2ZW50IiwiX3RoaXMzIiwiY29kZSIsIl90aGlzNCIsInBlcmZvcm1EZWxheWVkUmVjb25uZWN0IiwiX3RoaXM1IiwicmVjZWl2ZSIsIkpTT04iLCJwYXJzZSIsImRhdGEiLCJyZW1vdmVBdmFpbGFibGVPY2N1cGFudCIsImlkeCIsInNwbGljZSIsImhhcyIsImFkZE9jY3VwYW50IiwiaiIsInJlbW92ZU9jY3VwYW50IiwiX2FkZE9jY3VwYW50IiwiX2NhbGxlZTIiLCJhdmFpbGFibGVPY2N1cGFudHNDb3VudCIsInN1YnNjcmliZXIiLCJfY2FsbGVlMiQiLCJfY29udGV4dDIiLCJhZGQiLCJjcmVhdGVTdWJzY3JpYmVyIiwic2V0TWVkaWFTdHJlYW0iLCJtZWRpYVN0cmVhbSIsIl94IiwibXNnIiwiZ2V0IiwiYXVkaW8iLCJhc3NvY2lhdGUiLCJfdGhpczYiLCJldiIsInNlbmRUcmlja2xlIiwiY2FuZGlkYXRlIiwiaWNlQ29ubmVjdGlvblN0YXRlIiwibG9nIiwib2ZmZXIiLCJjcmVhdGVPZmZlciIsImNvbmZpZ3VyZVB1Ymxpc2hlclNkcCIsImZpeFNhZmFyaUljZVVGcmFnIiwibG9jYWwiLCJvIiwic2V0TG9jYWxEZXNjcmlwdGlvbiIsInJlbW90ZSIsInNlbmRKc2VwIiwiciIsInNldFJlbW90ZURlc2NyaXB0aW9uIiwianNlcCIsIm9uIiwiYW5zd2VyIiwiY29uZmlndXJlU3Vic2NyaWJlclNkcCIsImNyZWF0ZUFuc3dlciIsImEiLCJfY3JlYXRlUHVibGlzaGVyIiwiX2NhbGxlZTMiLCJfdGhpczciLCJ3ZWJydGN1cCIsInJlbGlhYmxlQ2hhbm5lbCIsInVucmVsaWFibGVDaGFubmVsIiwiX2NhbGxlZTMkIiwiX2NvbnRleHQzIiwiSmFudXNQbHVnaW5IYW5kbGUiLCJSVENQZWVyQ29ubmVjdGlvbiIsImF0dGFjaCIsInBhcnNlSW50IiwiY3JlYXRlRGF0YUNoYW5uZWwiLCJvcmRlcmVkIiwibWF4UmV0cmFuc21pdHMiLCJnZXRUcmFja3MiLCJ0cmFjayIsImFkZFRyYWNrIiwicGx1Z2luZGF0YSIsInJvb21faWQiLCJ1c2VyX2lkIiwiYm9keSIsImRpc3BhdGNoRXZlbnQiLCJDdXN0b21FdmVudCIsImRldGFpbCIsImJ5Iiwic2VuZEpvaW4iLCJub3RpZmljYXRpb25zIiwic3VjY2VzcyIsInJlc3BvbnNlIiwidXNlcnMiLCJpbmNsdWRlcyIsInNkcCIsInJlcGxhY2UiLCJsaW5lIiwicHQiLCJwYXJhbWV0ZXJzIiwiYXNzaWduIiwicGFyc2VGbXRwIiwid3JpdGVGbXRwIiwicGF5bG9hZFR5cGUiLCJfZml4U2FmYXJpSWNlVUZyYWciLCJfY2FsbGVlNCIsIl9jYWxsZWU0JCIsIl9jb250ZXh0NCIsIl94MiIsIl9jcmVhdGVTdWJzY3JpYmVyIiwiX2NhbGxlZTUiLCJfdGhpczgiLCJtYXhSZXRyaWVzIiwid2VicnRjRmFpbGVkIiwicmVjZWl2ZXJzIiwiX2FyZ3M1IiwiX2NhbGxlZTUkIiwiX2NvbnRleHQ1IiwibGVmdEludGVydmFsIiwic2V0SW50ZXJ2YWwiLCJjbGVhckludGVydmFsIiwidGltZW91dCIsIm1lZGlhIiwiX2lPU0hhY2tEZWxheWVkSW5pdGlhbFBlZXIiLCJNZWRpYVN0cmVhbSIsImdldFJlY2VpdmVycyIsInJlY2VpdmVyIiwiX3gzIiwic3Vic2NyaWJlIiwic2VuZE1lc3NhZ2UiLCJraW5kIiwidG9rZW4iLCJ0b2dnbGVGcmVlemUiLCJmcm96ZW4iLCJ1bmZyZWV6ZSIsImZyZWV6ZSIsImZsdXNoUGVuZGluZ1VwZGF0ZXMiLCJkYXRhRm9yVXBkYXRlTXVsdGlNZXNzYWdlIiwibmV0d29ya0lkIiwibCIsImQiLCJnZXRQZW5kaW5nRGF0YSIsImRhdGFUeXBlIiwib3duZXIiLCJnZXRQZW5kaW5nRGF0YUZvck5ldHdvcmtJZCIsIl9pdGVyYXRvciIsIl9jcmVhdGVGb3JPZkl0ZXJhdG9ySGVscGVyIiwiX3N0ZXAiLCJzIiwibiIsIl9zdGVwJHZhbHVlIiwiX3NsaWNlZFRvQXJyYXkiLCJzb3VyY2UiLCJmIiwic3RvcmVNZXNzYWdlIiwic3RvcmVTaW5nbGVNZXNzYWdlIiwiaW5kZXgiLCJzZXQiLCJzdG9yZWRNZXNzYWdlIiwic3RvcmVkRGF0YSIsImlzT3V0ZGF0ZWRNZXNzYWdlIiwibGFzdE93bmVyVGltZSIsImlzQ29udGVtcG9yYW5lb3VzTWVzc2FnZSIsImNyZWF0ZWRXaGlsZUZyb3plbiIsImlzRmlyc3RTeW5jIiwiY29tcG9uZW50cyIsImVuYWJsZWQiLCJzaG91bGRTdGFydENvbm5lY3Rpb25UbyIsImNsaWVudCIsInN0YXJ0U3RyZWFtQ29ubmVjdGlvbiIsImNsb3NlU3RyZWFtQ29ubmVjdGlvbiIsImdldENvbm5lY3RTdGF0dXMiLCJhZGFwdGVycyIsIklTX0NPTk5FQ1RFRCIsIk5PVF9DT05ORUNURUQiLCJfdXBkYXRlVGltZU9mZnNldCIsIl9jYWxsZWU2IiwiX3RoaXM5IiwiY2xpZW50U2VudFRpbWUiLCJwcmVjaXNpb24iLCJzZXJ2ZXJSZWNlaXZlZFRpbWUiLCJjbGllbnRSZWNlaXZlZFRpbWUiLCJzZXJ2ZXJUaW1lIiwidGltZU9mZnNldCIsIl9jYWxsZWU2JCIsIl9jb250ZXh0NiIsIkRhdGUiLCJub3ciLCJmZXRjaCIsImxvY2F0aW9uIiwiaHJlZiIsImNhY2hlIiwiaGVhZGVycyIsImdldFRpbWUiLCJyZWR1Y2UiLCJhY2MiLCJvZmZzZXQiLCJnZXRTZXJ2ZXJUaW1lIiwiZ2V0TWVkaWFTdHJlYW0iLCJfdGhpczEwIiwiYXVkaW9Qcm9taXNlIiwidmlkZW9Qcm9taXNlIiwicHJvbWlzZSIsInN0cmVhbSIsImF1ZGlvU3RyZWFtIiwiZ2V0QXVkaW9UcmFja3MiLCJ2aWRlb1N0cmVhbSIsImdldFZpZGVvVHJhY2tzIiwiX3NldExvY2FsTWVkaWFTdHJlYW0iLCJfY2FsbGVlNyIsIl90aGlzMTEiLCJleGlzdGluZ1NlbmRlcnMiLCJuZXdTZW5kZXJzIiwidHJhY2tzIiwiX2xvb3AiLCJfY2FsbGVlNyQiLCJfY29udGV4dDgiLCJnZXRTZW5kZXJzIiwidCIsInNlbmRlciIsIl9sb29wJCIsIl9jb250ZXh0NyIsImZpbmQiLCJyZXBsYWNlVHJhY2siLCJ0b0xvd2VyQ2FzZSIsInJlbW92ZVRyYWNrIiwic2V0TG9jYWxNZWRpYVN0cmVhbSIsIl94NCIsImVuYWJsZU1pY3JvcGhvbmUiLCJzZW5kRGF0YSIsInN0cmluZ2lmeSIsIndob20iLCJzZW5kRGF0YUd1YXJhbnRlZWQiLCJicm9hZGNhc3REYXRhIiwiYnJvYWRjYXN0RGF0YUd1YXJhbnRlZWQiLCJraWNrIiwicGVybXNUb2tlbiIsImJsb2NrIiwiX3RoaXMxMiIsInVuYmxvY2siLCJfdGhpczEzIiwicmVnaXN0ZXIiLCJtb2R1bGUiXSwic291cmNlUm9vdCI6IiJ9