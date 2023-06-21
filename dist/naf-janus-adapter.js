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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibmFmLWphbnVzLWFkYXB0ZXIuanMiLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0Esa0JBQWtCO0FBQ2xCO0FBQ0E7QUFDQTtBQUNBLEdBQUc7QUFDSDs7QUFFQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsR0FBRztBQUNIOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLGlEQUFpRCxvQkFBb0I7QUFDckU7O0FBRUE7QUFDQTtBQUNBLGdDQUFnQyxZQUFZO0FBQzVDOztBQUVBO0FBQ0E7QUFDQSxnQ0FBZ0MsUUFBUSxjQUFjO0FBQ3REOztBQUVBO0FBQ0E7QUFDQSxnQ0FBZ0Msc0JBQXNCO0FBQ3REOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsR0FBRztBQUNIOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxHQUFHO0FBQ0g7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEdBQUc7QUFDSDs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsZ0dBQWdHO0FBQ2hHO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQSxvQkFBb0IscUJBQXFCO0FBQ3pDO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLHNHQUFzRztBQUN0RztBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsMkJBQTJCLDJDQUEyQztBQUN0RTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxPQUFPO0FBQ1A7QUFDQSxzQ0FBc0M7QUFDdEM7QUFDQSxHQUFHO0FBQ0g7O0FBRUE7QUFDQSwyQkFBMkIsYUFBYTs7QUFFeEMseUJBQXlCO0FBQ3pCLDZCQUE2QixxQkFBcUI7QUFDbEQ7O0FBRUE7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEtBQUs7QUFDTDtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7OytDQzNQQSxxSkFBQUEsbUJBQUEsWUFBQUEsb0JBQUEsV0FBQUMsT0FBQSxTQUFBQSxPQUFBLE9BQUFDLEVBQUEsR0FBQUMsTUFBQSxDQUFBQyxTQUFBLEVBQUFDLE1BQUEsR0FBQUgsRUFBQSxDQUFBSSxjQUFBLEVBQUFDLGNBQUEsR0FBQUosTUFBQSxDQUFBSSxjQUFBLGNBQUFDLEdBQUEsRUFBQUMsR0FBQSxFQUFBQyxJQUFBLElBQUFGLEdBQUEsQ0FBQUMsR0FBQSxJQUFBQyxJQUFBLENBQUFDLEtBQUEsS0FBQUMsT0FBQSx3QkFBQUMsTUFBQSxHQUFBQSxNQUFBLE9BQUFDLGNBQUEsR0FBQUYsT0FBQSxDQUFBRyxRQUFBLGtCQUFBQyxtQkFBQSxHQUFBSixPQUFBLENBQUFLLGFBQUEsdUJBQUFDLGlCQUFBLEdBQUFOLE9BQUEsQ0FBQU8sV0FBQSw4QkFBQUMsT0FBQVosR0FBQSxFQUFBQyxHQUFBLEVBQUFFLEtBQUEsV0FBQVIsTUFBQSxDQUFBSSxjQUFBLENBQUFDLEdBQUEsRUFBQUMsR0FBQSxJQUFBRSxLQUFBLEVBQUFBLEtBQUEsRUFBQVUsVUFBQSxNQUFBQyxZQUFBLE1BQUFDLFFBQUEsU0FBQWYsR0FBQSxDQUFBQyxHQUFBLFdBQUFXLE1BQUEsbUJBQUFJLEdBQUEsSUFBQUosTUFBQSxZQUFBQSxPQUFBWixHQUFBLEVBQUFDLEdBQUEsRUFBQUUsS0FBQSxXQUFBSCxHQUFBLENBQUFDLEdBQUEsSUFBQUUsS0FBQSxnQkFBQWMsS0FBQUMsT0FBQSxFQUFBQyxPQUFBLEVBQUFDLElBQUEsRUFBQUMsV0FBQSxRQUFBQyxjQUFBLEdBQUFILE9BQUEsSUFBQUEsT0FBQSxDQUFBdkIsU0FBQSxZQUFBMkIsU0FBQSxHQUFBSixPQUFBLEdBQUFJLFNBQUEsRUFBQUMsU0FBQSxHQUFBN0IsTUFBQSxDQUFBOEIsTUFBQSxDQUFBSCxjQUFBLENBQUExQixTQUFBLEdBQUE4QixPQUFBLE9BQUFDLE9BQUEsQ0FBQU4sV0FBQSxnQkFBQXRCLGNBQUEsQ0FBQXlCLFNBQUEsZUFBQXJCLEtBQUEsRUFBQXlCLGdCQUFBLENBQUFWLE9BQUEsRUFBQUUsSUFBQSxFQUFBTSxPQUFBLE1BQUFGLFNBQUEsYUFBQUssU0FBQUMsRUFBQSxFQUFBOUIsR0FBQSxFQUFBK0IsR0FBQSxtQkFBQUMsSUFBQSxZQUFBRCxHQUFBLEVBQUFELEVBQUEsQ0FBQUcsSUFBQSxDQUFBakMsR0FBQSxFQUFBK0IsR0FBQSxjQUFBZixHQUFBLGFBQUFnQixJQUFBLFdBQUFELEdBQUEsRUFBQWYsR0FBQSxRQUFBdkIsT0FBQSxDQUFBd0IsSUFBQSxHQUFBQSxJQUFBLE1BQUFpQixnQkFBQSxnQkFBQVgsVUFBQSxjQUFBWSxrQkFBQSxjQUFBQywyQkFBQSxTQUFBQyxpQkFBQSxPQUFBekIsTUFBQSxDQUFBeUIsaUJBQUEsRUFBQS9CLGNBQUEscUNBQUFnQyxRQUFBLEdBQUEzQyxNQUFBLENBQUE0QyxjQUFBLEVBQUFDLHVCQUFBLEdBQUFGLFFBQUEsSUFBQUEsUUFBQSxDQUFBQSxRQUFBLENBQUFHLE1BQUEsUUFBQUQsdUJBQUEsSUFBQUEsdUJBQUEsS0FBQTlDLEVBQUEsSUFBQUcsTUFBQSxDQUFBb0MsSUFBQSxDQUFBTyx1QkFBQSxFQUFBbEMsY0FBQSxNQUFBK0IsaUJBQUEsR0FBQUcsdUJBQUEsT0FBQUUsRUFBQSxHQUFBTiwwQkFBQSxDQUFBeEMsU0FBQSxHQUFBMkIsU0FBQSxDQUFBM0IsU0FBQSxHQUFBRCxNQUFBLENBQUE4QixNQUFBLENBQUFZLGlCQUFBLFlBQUFNLHNCQUFBL0MsU0FBQSxnQ0FBQWdELE9BQUEsV0FBQUMsTUFBQSxJQUFBakMsTUFBQSxDQUFBaEIsU0FBQSxFQUFBaUQsTUFBQSxZQUFBZCxHQUFBLGdCQUFBZSxPQUFBLENBQUFELE1BQUEsRUFBQWQsR0FBQSxzQkFBQWdCLGNBQUF2QixTQUFBLEVBQUF3QixXQUFBLGFBQUFDLE9BQUFKLE1BQUEsRUFBQWQsR0FBQSxFQUFBbUIsT0FBQSxFQUFBQyxNQUFBLFFBQUFDLE1BQUEsR0FBQXZCLFFBQUEsQ0FBQUwsU0FBQSxDQUFBcUIsTUFBQSxHQUFBckIsU0FBQSxFQUFBTyxHQUFBLG1CQUFBcUIsTUFBQSxDQUFBcEIsSUFBQSxRQUFBcUIsTUFBQSxHQUFBRCxNQUFBLENBQUFyQixHQUFBLEVBQUE1QixLQUFBLEdBQUFrRCxNQUFBLENBQUFsRCxLQUFBLFNBQUFBLEtBQUEsZ0JBQUFtRCxPQUFBLENBQUFuRCxLQUFBLEtBQUFOLE1BQUEsQ0FBQW9DLElBQUEsQ0FBQTlCLEtBQUEsZUFBQTZDLFdBQUEsQ0FBQUUsT0FBQSxDQUFBL0MsS0FBQSxDQUFBb0QsT0FBQSxFQUFBQyxJQUFBLFdBQUFyRCxLQUFBLElBQUE4QyxNQUFBLFNBQUE5QyxLQUFBLEVBQUErQyxPQUFBLEVBQUFDLE1BQUEsZ0JBQUFuQyxHQUFBLElBQUFpQyxNQUFBLFVBQUFqQyxHQUFBLEVBQUFrQyxPQUFBLEVBQUFDLE1BQUEsUUFBQUgsV0FBQSxDQUFBRSxPQUFBLENBQUEvQyxLQUFBLEVBQUFxRCxJQUFBLFdBQUFDLFNBQUEsSUFBQUosTUFBQSxDQUFBbEQsS0FBQSxHQUFBc0QsU0FBQSxFQUFBUCxPQUFBLENBQUFHLE1BQUEsZ0JBQUFLLEtBQUEsV0FBQVQsTUFBQSxVQUFBUyxLQUFBLEVBQUFSLE9BQUEsRUFBQUMsTUFBQSxTQUFBQSxNQUFBLENBQUFDLE1BQUEsQ0FBQXJCLEdBQUEsU0FBQTRCLGVBQUEsRUFBQTVELGNBQUEsb0JBQUFJLEtBQUEsV0FBQUEsTUFBQTBDLE1BQUEsRUFBQWQsR0FBQSxhQUFBNkIsMkJBQUEsZUFBQVosV0FBQSxXQUFBRSxPQUFBLEVBQUFDLE1BQUEsSUFBQUYsTUFBQSxDQUFBSixNQUFBLEVBQUFkLEdBQUEsRUFBQW1CLE9BQUEsRUFBQUMsTUFBQSxnQkFBQVEsZUFBQSxHQUFBQSxlQUFBLEdBQUFBLGVBQUEsQ0FBQUgsSUFBQSxDQUFBSSwwQkFBQSxFQUFBQSwwQkFBQSxJQUFBQSwwQkFBQSxxQkFBQWhDLGlCQUFBVixPQUFBLEVBQUFFLElBQUEsRUFBQU0sT0FBQSxRQUFBbUMsS0FBQSxzQ0FBQWhCLE1BQUEsRUFBQWQsR0FBQSx3QkFBQThCLEtBQUEsWUFBQUMsS0FBQSxzREFBQUQsS0FBQSxvQkFBQWhCLE1BQUEsUUFBQWQsR0FBQSxTQUFBZ0MsVUFBQSxXQUFBckMsT0FBQSxDQUFBbUIsTUFBQSxHQUFBQSxNQUFBLEVBQUFuQixPQUFBLENBQUFLLEdBQUEsR0FBQUEsR0FBQSxVQUFBaUMsUUFBQSxHQUFBdEMsT0FBQSxDQUFBc0MsUUFBQSxNQUFBQSxRQUFBLFFBQUFDLGNBQUEsR0FBQUMsbUJBQUEsQ0FBQUYsUUFBQSxFQUFBdEMsT0FBQSxPQUFBdUMsY0FBQSxRQUFBQSxjQUFBLEtBQUEvQixnQkFBQSxtQkFBQStCLGNBQUEscUJBQUF2QyxPQUFBLENBQUFtQixNQUFBLEVBQUFuQixPQUFBLENBQUF5QyxJQUFBLEdBQUF6QyxPQUFBLENBQUEwQyxLQUFBLEdBQUExQyxPQUFBLENBQUFLLEdBQUEsc0JBQUFMLE9BQUEsQ0FBQW1CLE1BQUEsNkJBQUFnQixLQUFBLFFBQUFBLEtBQUEsZ0JBQUFuQyxPQUFBLENBQUFLLEdBQUEsRUFBQUwsT0FBQSxDQUFBMkMsaUJBQUEsQ0FBQTNDLE9BQUEsQ0FBQUssR0FBQSx1QkFBQUwsT0FBQSxDQUFBbUIsTUFBQSxJQUFBbkIsT0FBQSxDQUFBNEMsTUFBQSxXQUFBNUMsT0FBQSxDQUFBSyxHQUFBLEdBQUE4QixLQUFBLG9CQUFBVCxNQUFBLEdBQUF2QixRQUFBLENBQUFYLE9BQUEsRUFBQUUsSUFBQSxFQUFBTSxPQUFBLG9CQUFBMEIsTUFBQSxDQUFBcEIsSUFBQSxRQUFBNkIsS0FBQSxHQUFBbkMsT0FBQSxDQUFBNkMsSUFBQSxtQ0FBQW5CLE1BQUEsQ0FBQXJCLEdBQUEsS0FBQUcsZ0JBQUEscUJBQUEvQixLQUFBLEVBQUFpRCxNQUFBLENBQUFyQixHQUFBLEVBQUF3QyxJQUFBLEVBQUE3QyxPQUFBLENBQUE2QyxJQUFBLGtCQUFBbkIsTUFBQSxDQUFBcEIsSUFBQSxLQUFBNkIsS0FBQSxnQkFBQW5DLE9BQUEsQ0FBQW1CLE1BQUEsWUFBQW5CLE9BQUEsQ0FBQUssR0FBQSxHQUFBcUIsTUFBQSxDQUFBckIsR0FBQSxtQkFBQW1DLG9CQUFBRixRQUFBLEVBQUF0QyxPQUFBLFFBQUE4QyxVQUFBLEdBQUE5QyxPQUFBLENBQUFtQixNQUFBLEVBQUFBLE1BQUEsR0FBQW1CLFFBQUEsQ0FBQXpELFFBQUEsQ0FBQWlFLFVBQUEsT0FBQUMsU0FBQSxLQUFBNUIsTUFBQSxTQUFBbkIsT0FBQSxDQUFBc0MsUUFBQSxxQkFBQVEsVUFBQSxJQUFBUixRQUFBLENBQUF6RCxRQUFBLGVBQUFtQixPQUFBLENBQUFtQixNQUFBLGFBQUFuQixPQUFBLENBQUFLLEdBQUEsR0FBQTBDLFNBQUEsRUFBQVAsbUJBQUEsQ0FBQUYsUUFBQSxFQUFBdEMsT0FBQSxlQUFBQSxPQUFBLENBQUFtQixNQUFBLGtCQUFBMkIsVUFBQSxLQUFBOUMsT0FBQSxDQUFBbUIsTUFBQSxZQUFBbkIsT0FBQSxDQUFBSyxHQUFBLE9BQUEyQyxTQUFBLHVDQUFBRixVQUFBLGlCQUFBdEMsZ0JBQUEsTUFBQWtCLE1BQUEsR0FBQXZCLFFBQUEsQ0FBQWdCLE1BQUEsRUFBQW1CLFFBQUEsQ0FBQXpELFFBQUEsRUFBQW1CLE9BQUEsQ0FBQUssR0FBQSxtQkFBQXFCLE1BQUEsQ0FBQXBCLElBQUEsU0FBQU4sT0FBQSxDQUFBbUIsTUFBQSxZQUFBbkIsT0FBQSxDQUFBSyxHQUFBLEdBQUFxQixNQUFBLENBQUFyQixHQUFBLEVBQUFMLE9BQUEsQ0FBQXNDLFFBQUEsU0FBQTlCLGdCQUFBLE1BQUF5QyxJQUFBLEdBQUF2QixNQUFBLENBQUFyQixHQUFBLFNBQUE0QyxJQUFBLEdBQUFBLElBQUEsQ0FBQUosSUFBQSxJQUFBN0MsT0FBQSxDQUFBc0MsUUFBQSxDQUFBWSxVQUFBLElBQUFELElBQUEsQ0FBQXhFLEtBQUEsRUFBQXVCLE9BQUEsQ0FBQW1ELElBQUEsR0FBQWIsUUFBQSxDQUFBYyxPQUFBLGVBQUFwRCxPQUFBLENBQUFtQixNQUFBLEtBQUFuQixPQUFBLENBQUFtQixNQUFBLFdBQUFuQixPQUFBLENBQUFLLEdBQUEsR0FBQTBDLFNBQUEsR0FBQS9DLE9BQUEsQ0FBQXNDLFFBQUEsU0FBQTlCLGdCQUFBLElBQUF5QyxJQUFBLElBQUFqRCxPQUFBLENBQUFtQixNQUFBLFlBQUFuQixPQUFBLENBQUFLLEdBQUEsT0FBQTJDLFNBQUEsc0NBQUFoRCxPQUFBLENBQUFzQyxRQUFBLFNBQUE5QixnQkFBQSxjQUFBNkMsYUFBQUMsSUFBQSxRQUFBQyxLQUFBLEtBQUFDLE1BQUEsRUFBQUYsSUFBQSxZQUFBQSxJQUFBLEtBQUFDLEtBQUEsQ0FBQUUsUUFBQSxHQUFBSCxJQUFBLFdBQUFBLElBQUEsS0FBQUMsS0FBQSxDQUFBRyxVQUFBLEdBQUFKLElBQUEsS0FBQUMsS0FBQSxDQUFBSSxRQUFBLEdBQUFMLElBQUEsV0FBQU0sVUFBQSxDQUFBQyxJQUFBLENBQUFOLEtBQUEsY0FBQU8sY0FBQVAsS0FBQSxRQUFBN0IsTUFBQSxHQUFBNkIsS0FBQSxDQUFBUSxVQUFBLFFBQUFyQyxNQUFBLENBQUFwQixJQUFBLG9CQUFBb0IsTUFBQSxDQUFBckIsR0FBQSxFQUFBa0QsS0FBQSxDQUFBUSxVQUFBLEdBQUFyQyxNQUFBLGFBQUF6QixRQUFBTixXQUFBLFNBQUFpRSxVQUFBLE1BQUFKLE1BQUEsYUFBQTdELFdBQUEsQ0FBQXVCLE9BQUEsQ0FBQW1DLFlBQUEsY0FBQVcsS0FBQSxpQkFBQWpELE9BQUFrRCxRQUFBLFFBQUFBLFFBQUEsUUFBQUMsY0FBQSxHQUFBRCxRQUFBLENBQUFyRixjQUFBLE9BQUFzRixjQUFBLFNBQUFBLGNBQUEsQ0FBQTNELElBQUEsQ0FBQTBELFFBQUEsNEJBQUFBLFFBQUEsQ0FBQWQsSUFBQSxTQUFBYyxRQUFBLE9BQUFFLEtBQUEsQ0FBQUYsUUFBQSxDQUFBRyxNQUFBLFNBQUFDLENBQUEsT0FBQWxCLElBQUEsWUFBQUEsS0FBQSxhQUFBa0IsQ0FBQSxHQUFBSixRQUFBLENBQUFHLE1BQUEsT0FBQWpHLE1BQUEsQ0FBQW9DLElBQUEsQ0FBQTBELFFBQUEsRUFBQUksQ0FBQSxVQUFBbEIsSUFBQSxDQUFBMUUsS0FBQSxHQUFBd0YsUUFBQSxDQUFBSSxDQUFBLEdBQUFsQixJQUFBLENBQUFOLElBQUEsT0FBQU0sSUFBQSxTQUFBQSxJQUFBLENBQUExRSxLQUFBLEdBQUFzRSxTQUFBLEVBQUFJLElBQUEsQ0FBQU4sSUFBQSxPQUFBTSxJQUFBLFlBQUFBLElBQUEsQ0FBQUEsSUFBQSxHQUFBQSxJQUFBLGVBQUFBLElBQUEsRUFBQWQsVUFBQSxlQUFBQSxXQUFBLGFBQUE1RCxLQUFBLEVBQUFzRSxTQUFBLEVBQUFGLElBQUEsaUJBQUFwQyxpQkFBQSxDQUFBdkMsU0FBQSxHQUFBd0MsMEJBQUEsRUFBQXJDLGNBQUEsQ0FBQTJDLEVBQUEsbUJBQUF2QyxLQUFBLEVBQUFpQywwQkFBQSxFQUFBdEIsWUFBQSxTQUFBZixjQUFBLENBQUFxQywwQkFBQSxtQkFBQWpDLEtBQUEsRUFBQWdDLGlCQUFBLEVBQUFyQixZQUFBLFNBQUFxQixpQkFBQSxDQUFBNkQsV0FBQSxHQUFBcEYsTUFBQSxDQUFBd0IsMEJBQUEsRUFBQTFCLGlCQUFBLHdCQUFBakIsT0FBQSxDQUFBd0csbUJBQUEsYUFBQUMsTUFBQSxRQUFBQyxJQUFBLHdCQUFBRCxNQUFBLElBQUFBLE1BQUEsQ0FBQUUsV0FBQSxXQUFBRCxJQUFBLEtBQUFBLElBQUEsS0FBQWhFLGlCQUFBLDZCQUFBZ0UsSUFBQSxDQUFBSCxXQUFBLElBQUFHLElBQUEsQ0FBQUUsSUFBQSxPQUFBNUcsT0FBQSxDQUFBNkcsSUFBQSxhQUFBSixNQUFBLFdBQUF2RyxNQUFBLENBQUE0RyxjQUFBLEdBQUE1RyxNQUFBLENBQUE0RyxjQUFBLENBQUFMLE1BQUEsRUFBQTlELDBCQUFBLEtBQUE4RCxNQUFBLENBQUFNLFNBQUEsR0FBQXBFLDBCQUFBLEVBQUF4QixNQUFBLENBQUFzRixNQUFBLEVBQUF4RixpQkFBQSx5QkFBQXdGLE1BQUEsQ0FBQXRHLFNBQUEsR0FBQUQsTUFBQSxDQUFBOEIsTUFBQSxDQUFBaUIsRUFBQSxHQUFBd0QsTUFBQSxLQUFBekcsT0FBQSxDQUFBZ0gsS0FBQSxhQUFBMUUsR0FBQSxhQUFBd0IsT0FBQSxFQUFBeEIsR0FBQSxPQUFBWSxxQkFBQSxDQUFBSSxhQUFBLENBQUFuRCxTQUFBLEdBQUFnQixNQUFBLENBQUFtQyxhQUFBLENBQUFuRCxTQUFBLEVBQUFZLG1CQUFBLGlDQUFBZixPQUFBLENBQUFzRCxhQUFBLEdBQUFBLGFBQUEsRUFBQXRELE9BQUEsQ0FBQWlILEtBQUEsYUFBQXhGLE9BQUEsRUFBQUMsT0FBQSxFQUFBQyxJQUFBLEVBQUFDLFdBQUEsRUFBQTJCLFdBQUEsZUFBQUEsV0FBQSxLQUFBQSxXQUFBLEdBQUEyRCxPQUFBLE9BQUFDLElBQUEsT0FBQTdELGFBQUEsQ0FBQTlCLElBQUEsQ0FBQUMsT0FBQSxFQUFBQyxPQUFBLEVBQUFDLElBQUEsRUFBQUMsV0FBQSxHQUFBMkIsV0FBQSxVQUFBdkQsT0FBQSxDQUFBd0csbUJBQUEsQ0FBQTlFLE9BQUEsSUFBQXlGLElBQUEsR0FBQUEsSUFBQSxDQUFBL0IsSUFBQSxHQUFBckIsSUFBQSxXQUFBSCxNQUFBLFdBQUFBLE1BQUEsQ0FBQWtCLElBQUEsR0FBQWxCLE1BQUEsQ0FBQWxELEtBQUEsR0FBQXlHLElBQUEsQ0FBQS9CLElBQUEsV0FBQWxDLHFCQUFBLENBQUFELEVBQUEsR0FBQTlCLE1BQUEsQ0FBQThCLEVBQUEsRUFBQWhDLGlCQUFBLGdCQUFBRSxNQUFBLENBQUE4QixFQUFBLEVBQUFwQyxjQUFBLGlDQUFBTSxNQUFBLENBQUE4QixFQUFBLDZEQUFBakQsT0FBQSxDQUFBb0gsSUFBQSxhQUFBQyxHQUFBLFFBQUFDLE1BQUEsR0FBQXBILE1BQUEsQ0FBQW1ILEdBQUEsR0FBQUQsSUFBQSxnQkFBQTVHLEdBQUEsSUFBQThHLE1BQUEsRUFBQUYsSUFBQSxDQUFBdEIsSUFBQSxDQUFBdEYsR0FBQSxVQUFBNEcsSUFBQSxDQUFBRyxPQUFBLGFBQUFuQyxLQUFBLFdBQUFnQyxJQUFBLENBQUFmLE1BQUEsU0FBQTdGLEdBQUEsR0FBQTRHLElBQUEsQ0FBQUksR0FBQSxRQUFBaEgsR0FBQSxJQUFBOEcsTUFBQSxTQUFBbEMsSUFBQSxDQUFBMUUsS0FBQSxHQUFBRixHQUFBLEVBQUE0RSxJQUFBLENBQUFOLElBQUEsT0FBQU0sSUFBQSxXQUFBQSxJQUFBLENBQUFOLElBQUEsT0FBQU0sSUFBQSxRQUFBcEYsT0FBQSxDQUFBZ0QsTUFBQSxHQUFBQSxNQUFBLEVBQUFkLE9BQUEsQ0FBQS9CLFNBQUEsS0FBQXdHLFdBQUEsRUFBQXpFLE9BQUEsRUFBQStELEtBQUEsV0FBQUEsTUFBQXdCLGFBQUEsYUFBQUMsSUFBQSxXQUFBdEMsSUFBQSxXQUFBVixJQUFBLFFBQUFDLEtBQUEsR0FBQUssU0FBQSxPQUFBRixJQUFBLFlBQUFQLFFBQUEsY0FBQW5CLE1BQUEsZ0JBQUFkLEdBQUEsR0FBQTBDLFNBQUEsT0FBQWEsVUFBQSxDQUFBMUMsT0FBQSxDQUFBNEMsYUFBQSxJQUFBMEIsYUFBQSxXQUFBYixJQUFBLGtCQUFBQSxJQUFBLENBQUFlLE1BQUEsT0FBQXZILE1BQUEsQ0FBQW9DLElBQUEsT0FBQW9FLElBQUEsTUFBQVIsS0FBQSxFQUFBUSxJQUFBLENBQUFnQixLQUFBLGNBQUFoQixJQUFBLElBQUE1QixTQUFBLE1BQUE2QyxJQUFBLFdBQUFBLEtBQUEsU0FBQS9DLElBQUEsV0FBQWdELFVBQUEsUUFBQWpDLFVBQUEsSUFBQUcsVUFBQSxrQkFBQThCLFVBQUEsQ0FBQXZGLElBQUEsUUFBQXVGLFVBQUEsQ0FBQXhGLEdBQUEsY0FBQXlGLElBQUEsS0FBQW5ELGlCQUFBLFdBQUFBLGtCQUFBb0QsU0FBQSxhQUFBbEQsSUFBQSxRQUFBa0QsU0FBQSxNQUFBL0YsT0FBQSxrQkFBQWdHLE9BQUFDLEdBQUEsRUFBQUMsTUFBQSxXQUFBeEUsTUFBQSxDQUFBcEIsSUFBQSxZQUFBb0IsTUFBQSxDQUFBckIsR0FBQSxHQUFBMEYsU0FBQSxFQUFBL0YsT0FBQSxDQUFBbUQsSUFBQSxHQUFBOEMsR0FBQSxFQUFBQyxNQUFBLEtBQUFsRyxPQUFBLENBQUFtQixNQUFBLFdBQUFuQixPQUFBLENBQUFLLEdBQUEsR0FBQTBDLFNBQUEsS0FBQW1ELE1BQUEsYUFBQTdCLENBQUEsUUFBQVQsVUFBQSxDQUFBUSxNQUFBLE1BQUFDLENBQUEsU0FBQUEsQ0FBQSxRQUFBZCxLQUFBLFFBQUFLLFVBQUEsQ0FBQVMsQ0FBQSxHQUFBM0MsTUFBQSxHQUFBNkIsS0FBQSxDQUFBUSxVQUFBLGlCQUFBUixLQUFBLENBQUFDLE1BQUEsU0FBQXdDLE1BQUEsYUFBQXpDLEtBQUEsQ0FBQUMsTUFBQSxTQUFBaUMsSUFBQSxRQUFBVSxRQUFBLEdBQUFoSSxNQUFBLENBQUFvQyxJQUFBLENBQUFnRCxLQUFBLGVBQUE2QyxVQUFBLEdBQUFqSSxNQUFBLENBQUFvQyxJQUFBLENBQUFnRCxLQUFBLHFCQUFBNEMsUUFBQSxJQUFBQyxVQUFBLGFBQUFYLElBQUEsR0FBQWxDLEtBQUEsQ0FBQUUsUUFBQSxTQUFBdUMsTUFBQSxDQUFBekMsS0FBQSxDQUFBRSxRQUFBLGdCQUFBZ0MsSUFBQSxHQUFBbEMsS0FBQSxDQUFBRyxVQUFBLFNBQUFzQyxNQUFBLENBQUF6QyxLQUFBLENBQUFHLFVBQUEsY0FBQXlDLFFBQUEsYUFBQVYsSUFBQSxHQUFBbEMsS0FBQSxDQUFBRSxRQUFBLFNBQUF1QyxNQUFBLENBQUF6QyxLQUFBLENBQUFFLFFBQUEscUJBQUEyQyxVQUFBLFlBQUFoRSxLQUFBLHFEQUFBcUQsSUFBQSxHQUFBbEMsS0FBQSxDQUFBRyxVQUFBLFNBQUFzQyxNQUFBLENBQUF6QyxLQUFBLENBQUFHLFVBQUEsWUFBQWQsTUFBQSxXQUFBQSxPQUFBdEMsSUFBQSxFQUFBRCxHQUFBLGFBQUFnRSxDQUFBLFFBQUFULFVBQUEsQ0FBQVEsTUFBQSxNQUFBQyxDQUFBLFNBQUFBLENBQUEsUUFBQWQsS0FBQSxRQUFBSyxVQUFBLENBQUFTLENBQUEsT0FBQWQsS0FBQSxDQUFBQyxNQUFBLFNBQUFpQyxJQUFBLElBQUF0SCxNQUFBLENBQUFvQyxJQUFBLENBQUFnRCxLQUFBLHdCQUFBa0MsSUFBQSxHQUFBbEMsS0FBQSxDQUFBRyxVQUFBLFFBQUEyQyxZQUFBLEdBQUE5QyxLQUFBLGFBQUE4QyxZQUFBLGlCQUFBL0YsSUFBQSxtQkFBQUEsSUFBQSxLQUFBK0YsWUFBQSxDQUFBN0MsTUFBQSxJQUFBbkQsR0FBQSxJQUFBQSxHQUFBLElBQUFnRyxZQUFBLENBQUEzQyxVQUFBLEtBQUEyQyxZQUFBLGNBQUEzRSxNQUFBLEdBQUEyRSxZQUFBLEdBQUFBLFlBQUEsQ0FBQXRDLFVBQUEsY0FBQXJDLE1BQUEsQ0FBQXBCLElBQUEsR0FBQUEsSUFBQSxFQUFBb0IsTUFBQSxDQUFBckIsR0FBQSxHQUFBQSxHQUFBLEVBQUFnRyxZQUFBLFNBQUFsRixNQUFBLGdCQUFBZ0MsSUFBQSxHQUFBa0QsWUFBQSxDQUFBM0MsVUFBQSxFQUFBbEQsZ0JBQUEsU0FBQThGLFFBQUEsQ0FBQTVFLE1BQUEsTUFBQTRFLFFBQUEsV0FBQUEsU0FBQTVFLE1BQUEsRUFBQWlDLFFBQUEsb0JBQUFqQyxNQUFBLENBQUFwQixJQUFBLFFBQUFvQixNQUFBLENBQUFyQixHQUFBLHFCQUFBcUIsTUFBQSxDQUFBcEIsSUFBQSxtQkFBQW9CLE1BQUEsQ0FBQXBCLElBQUEsUUFBQTZDLElBQUEsR0FBQXpCLE1BQUEsQ0FBQXJCLEdBQUEsZ0JBQUFxQixNQUFBLENBQUFwQixJQUFBLFNBQUF3RixJQUFBLFFBQUF6RixHQUFBLEdBQUFxQixNQUFBLENBQUFyQixHQUFBLE9BQUFjLE1BQUEsa0JBQUFnQyxJQUFBLHlCQUFBekIsTUFBQSxDQUFBcEIsSUFBQSxJQUFBcUQsUUFBQSxVQUFBUixJQUFBLEdBQUFRLFFBQUEsR0FBQW5ELGdCQUFBLEtBQUErRixNQUFBLFdBQUFBLE9BQUE3QyxVQUFBLGFBQUFXLENBQUEsUUFBQVQsVUFBQSxDQUFBUSxNQUFBLE1BQUFDLENBQUEsU0FBQUEsQ0FBQSxRQUFBZCxLQUFBLFFBQUFLLFVBQUEsQ0FBQVMsQ0FBQSxPQUFBZCxLQUFBLENBQUFHLFVBQUEsS0FBQUEsVUFBQSxjQUFBNEMsUUFBQSxDQUFBL0MsS0FBQSxDQUFBUSxVQUFBLEVBQUFSLEtBQUEsQ0FBQUksUUFBQSxHQUFBRyxhQUFBLENBQUFQLEtBQUEsR0FBQS9DLGdCQUFBLHlCQUFBZ0csT0FBQWhELE1BQUEsYUFBQWEsQ0FBQSxRQUFBVCxVQUFBLENBQUFRLE1BQUEsTUFBQUMsQ0FBQSxTQUFBQSxDQUFBLFFBQUFkLEtBQUEsUUFBQUssVUFBQSxDQUFBUyxDQUFBLE9BQUFkLEtBQUEsQ0FBQUMsTUFBQSxLQUFBQSxNQUFBLFFBQUE5QixNQUFBLEdBQUE2QixLQUFBLENBQUFRLFVBQUEsa0JBQUFyQyxNQUFBLENBQUFwQixJQUFBLFFBQUFtRyxNQUFBLEdBQUEvRSxNQUFBLENBQUFyQixHQUFBLEVBQUF5RCxhQUFBLENBQUFQLEtBQUEsWUFBQWtELE1BQUEsZ0JBQUFyRSxLQUFBLDhCQUFBc0UsYUFBQSxXQUFBQSxjQUFBekMsUUFBQSxFQUFBZixVQUFBLEVBQUFFLE9BQUEsZ0JBQUFkLFFBQUEsS0FBQXpELFFBQUEsRUFBQWtDLE1BQUEsQ0FBQWtELFFBQUEsR0FBQWYsVUFBQSxFQUFBQSxVQUFBLEVBQUFFLE9BQUEsRUFBQUEsT0FBQSxvQkFBQWpDLE1BQUEsVUFBQWQsR0FBQSxHQUFBMEMsU0FBQSxHQUFBdkMsZ0JBQUEsT0FBQXpDLE9BQUE7QUFBQSxTQUFBNEksbUJBQUFDLEdBQUEsRUFBQXBGLE9BQUEsRUFBQUMsTUFBQSxFQUFBb0YsS0FBQSxFQUFBQyxNQUFBLEVBQUF2SSxHQUFBLEVBQUE4QixHQUFBLGNBQUE0QyxJQUFBLEdBQUEyRCxHQUFBLENBQUFySSxHQUFBLEVBQUE4QixHQUFBLE9BQUE1QixLQUFBLEdBQUF3RSxJQUFBLENBQUF4RSxLQUFBLFdBQUF1RCxLQUFBLElBQUFQLE1BQUEsQ0FBQU8sS0FBQSxpQkFBQWlCLElBQUEsQ0FBQUosSUFBQSxJQUFBckIsT0FBQSxDQUFBL0MsS0FBQSxZQUFBd0csT0FBQSxDQUFBekQsT0FBQSxDQUFBL0MsS0FBQSxFQUFBcUQsSUFBQSxDQUFBK0UsS0FBQSxFQUFBQyxNQUFBO0FBQUEsU0FBQUMsa0JBQUEzRyxFQUFBLDZCQUFBVixJQUFBLFNBQUFzSCxJQUFBLEdBQUFDLFNBQUEsYUFBQWhDLE9BQUEsV0FBQXpELE9BQUEsRUFBQUMsTUFBQSxRQUFBbUYsR0FBQSxHQUFBeEcsRUFBQSxDQUFBOEcsS0FBQSxDQUFBeEgsSUFBQSxFQUFBc0gsSUFBQSxZQUFBSCxNQUFBcEksS0FBQSxJQUFBa0ksa0JBQUEsQ0FBQUMsR0FBQSxFQUFBcEYsT0FBQSxFQUFBQyxNQUFBLEVBQUFvRixLQUFBLEVBQUFDLE1BQUEsVUFBQXJJLEtBQUEsY0FBQXFJLE9BQUF4SCxHQUFBLElBQUFxSCxrQkFBQSxDQUFBQyxHQUFBLEVBQUFwRixPQUFBLEVBQUFDLE1BQUEsRUFBQW9GLEtBQUEsRUFBQUMsTUFBQSxXQUFBeEgsR0FBQSxLQUFBdUgsS0FBQSxDQUFBOUQsU0FBQTtBQUFBLFNBQUFvRSxnQkFBQUMsUUFBQSxFQUFBQyxXQUFBLFVBQUFELFFBQUEsWUFBQUMsV0FBQSxlQUFBckUsU0FBQTtBQUFBLFNBQUFzRSxrQkFBQUMsTUFBQSxFQUFBQyxLQUFBLGFBQUFuRCxDQUFBLE1BQUFBLENBQUEsR0FBQW1ELEtBQUEsQ0FBQXBELE1BQUEsRUFBQUMsQ0FBQSxVQUFBb0QsVUFBQSxHQUFBRCxLQUFBLENBQUFuRCxDQUFBLEdBQUFvRCxVQUFBLENBQUF0SSxVQUFBLEdBQUFzSSxVQUFBLENBQUF0SSxVQUFBLFdBQUFzSSxVQUFBLENBQUFySSxZQUFBLHdCQUFBcUksVUFBQSxFQUFBQSxVQUFBLENBQUFwSSxRQUFBLFNBQUFwQixNQUFBLENBQUFJLGNBQUEsQ0FBQWtKLE1BQUEsRUFBQUcsY0FBQSxDQUFBRCxVQUFBLENBQUFsSixHQUFBLEdBQUFrSixVQUFBO0FBQUEsU0FBQUUsYUFBQU4sV0FBQSxFQUFBTyxVQUFBLEVBQUFDLFdBQUEsUUFBQUQsVUFBQSxFQUFBTixpQkFBQSxDQUFBRCxXQUFBLENBQUFuSixTQUFBLEVBQUEwSixVQUFBLE9BQUFDLFdBQUEsRUFBQVAsaUJBQUEsQ0FBQUQsV0FBQSxFQUFBUSxXQUFBLEdBQUE1SixNQUFBLENBQUFJLGNBQUEsQ0FBQWdKLFdBQUEsaUJBQUFoSSxRQUFBLG1CQUFBZ0ksV0FBQTtBQUFBLFNBQUFLLGVBQUFySCxHQUFBLFFBQUE5QixHQUFBLEdBQUF1SixZQUFBLENBQUF6SCxHQUFBLG9CQUFBdUIsT0FBQSxDQUFBckQsR0FBQSxpQkFBQUEsR0FBQSxHQUFBd0osTUFBQSxDQUFBeEosR0FBQTtBQUFBLFNBQUF1SixhQUFBRSxLQUFBLEVBQUFDLElBQUEsUUFBQXJHLE9BQUEsQ0FBQW9HLEtBQUEsa0JBQUFBLEtBQUEsa0JBQUFBLEtBQUEsTUFBQUUsSUFBQSxHQUFBRixLQUFBLENBQUFySixNQUFBLENBQUF3SixXQUFBLE9BQUFELElBQUEsS0FBQW5GLFNBQUEsUUFBQXFGLEdBQUEsR0FBQUYsSUFBQSxDQUFBM0gsSUFBQSxDQUFBeUgsS0FBQSxFQUFBQyxJQUFBLG9CQUFBckcsT0FBQSxDQUFBd0csR0FBQSx1QkFBQUEsR0FBQSxZQUFBcEYsU0FBQSw0REFBQWlGLElBQUEsZ0JBQUFGLE1BQUEsR0FBQU0sTUFBQSxFQUFBTCxLQUFBO0FBREE7QUFDQSxJQUFJTSxFQUFFLEdBQUdDLG1CQUFPLENBQUMsNEZBQTZCLENBQUM7QUFDL0NELEVBQUUsQ0FBQ0UsWUFBWSxDQUFDdEssU0FBUyxDQUFDdUssWUFBWSxHQUFHSCxFQUFFLENBQUNFLFlBQVksQ0FBQ3RLLFNBQVMsQ0FBQ3dLLElBQUk7QUFDdkVKLEVBQUUsQ0FBQ0UsWUFBWSxDQUFDdEssU0FBUyxDQUFDd0ssSUFBSSxHQUFHLFVBQVNwSSxJQUFJLEVBQUVxSSxNQUFNLEVBQUU7RUFDdEQsT0FBTyxJQUFJLENBQUNGLFlBQVksQ0FBQ25JLElBQUksRUFBRXFJLE1BQU0sQ0FBQyxTQUFNLENBQUMsVUFBQ0MsQ0FBQyxFQUFLO0lBQ2xELElBQUlBLENBQUMsQ0FBQ0MsT0FBTyxJQUFJRCxDQUFDLENBQUNDLE9BQU8sQ0FBQ0MsT0FBTyxDQUFDLFdBQVcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFO01BQ3BEQyxPQUFPLENBQUMvRyxLQUFLLENBQUMsc0JBQXNCLENBQUM7TUFDckNnSCxHQUFHLENBQUNDLFVBQVUsQ0FBQ0MsT0FBTyxDQUFDQyxTQUFTLENBQUMsQ0FBQztJQUNwQyxDQUFDLE1BQU07TUFDTCxNQUFNUCxDQUFDO0lBQ1Q7RUFDRixDQUFDLENBQUM7QUFDSixDQUFDO0FBRUQsSUFBSVEsUUFBUSxHQUFHYixtQkFBTyxDQUFDLHNDQUFLLENBQUM7QUFDN0I7QUFDQTtBQUNBO0FBQ0EsSUFBSWMsS0FBSyxHQUFHTixPQUFPLENBQUNPLEdBQUc7QUFDdkIsSUFBSUMsSUFBSSxHQUFHUixPQUFPLENBQUNRLElBQUk7QUFDdkIsSUFBSXZILEtBQUssR0FBRytHLE9BQU8sQ0FBQy9HLEtBQUs7QUFDekIsSUFBSXdILFFBQVEsR0FBRyxnQ0FBZ0MsQ0FBQ0MsSUFBSSxDQUFDQyxTQUFTLENBQUNDLFNBQVMsQ0FBQztBQUV6RSxJQUFNQyxvQkFBb0IsR0FBRyxLQUFLO0FBRWxDLFNBQVNDLFFBQVFBLENBQUN6SixFQUFFLEVBQUU7RUFDcEIsSUFBSTBKLElBQUksR0FBRzdFLE9BQU8sQ0FBQ3pELE9BQU8sQ0FBQyxDQUFDO0VBQzVCLE9BQU8sWUFBVztJQUFBLElBQUF1SSxLQUFBO0lBQ2hCLElBQUkvQyxJQUFJLEdBQUdnRCxLQUFLLENBQUM5TCxTQUFTLENBQUN5SCxLQUFLLENBQUNwRixJQUFJLENBQUMwRyxTQUFTLENBQUM7SUFDaEQ2QyxJQUFJLEdBQUdBLElBQUksQ0FBQ2hJLElBQUksQ0FBQyxVQUFBbUksQ0FBQztNQUFBLE9BQUk3SixFQUFFLENBQUM4RyxLQUFLLENBQUM2QyxLQUFJLEVBQUUvQyxJQUFJLENBQUM7SUFBQSxFQUFDO0VBQzdDLENBQUM7QUFDSDtBQUVBLFNBQVNrRCxVQUFVQSxDQUFBLEVBQUc7RUFDcEIsT0FBT0MsSUFBSSxDQUFDQyxLQUFLLENBQUNELElBQUksQ0FBQ0UsTUFBTSxDQUFDLENBQUMsR0FBR2hDLE1BQU0sQ0FBQ2lDLGdCQUFnQixDQUFDO0FBQzVEO0FBRUEsU0FBU0Msb0JBQW9CQSxDQUFDQyxXQUFXLEVBQUU7RUFDekMsT0FBTyxJQUFJdkYsT0FBTyxDQUFDLFVBQUN6RCxPQUFPLEVBQUVDLE1BQU0sRUFBSztJQUN0QyxJQUFJK0ksV0FBVyxDQUFDQyxVQUFVLEtBQUssTUFBTSxFQUFFO01BQ3JDakosT0FBTyxDQUFDLENBQUM7SUFDWCxDQUFDLE1BQU07TUFDTCxJQUFJa0osUUFBUSxFQUFFQyxRQUFRO01BRXRCLElBQU1DLEtBQUssR0FBRyxTQUFSQSxLQUFLQSxDQUFBLEVBQVM7UUFDbEJKLFdBQVcsQ0FBQ0ssbUJBQW1CLENBQUMsTUFBTSxFQUFFSCxRQUFRLENBQUM7UUFDakRGLFdBQVcsQ0FBQ0ssbUJBQW1CLENBQUMsT0FBTyxFQUFFRixRQUFRLENBQUM7TUFDcEQsQ0FBQztNQUVERCxRQUFRLEdBQUcsU0FBQUEsU0FBQSxFQUFNO1FBQ2ZFLEtBQUssQ0FBQyxDQUFDO1FBQ1BwSixPQUFPLENBQUMsQ0FBQztNQUNYLENBQUM7TUFDRG1KLFFBQVEsR0FBRyxTQUFBQSxTQUFBLEVBQU07UUFDZkMsS0FBSyxDQUFDLENBQUM7UUFDUG5KLE1BQU0sQ0FBQyxDQUFDO01BQ1YsQ0FBQztNQUVEK0ksV0FBVyxDQUFDTSxnQkFBZ0IsQ0FBQyxNQUFNLEVBQUVKLFFBQVEsQ0FBQztNQUM5Q0YsV0FBVyxDQUFDTSxnQkFBZ0IsQ0FBQyxPQUFPLEVBQUVILFFBQVEsQ0FBQztJQUNqRDtFQUNGLENBQUMsQ0FBQztBQUNKO0FBRUEsSUFBTUksb0JBQW9CLEdBQUksWUFBTTtFQUNsQyxJQUFNQyxLQUFLLEdBQUdDLFFBQVEsQ0FBQ0MsYUFBYSxDQUFDLE9BQU8sQ0FBQztFQUM3QyxPQUFPRixLQUFLLENBQUNHLFdBQVcsQ0FBQyw0Q0FBNEMsQ0FBQyxLQUFLLEVBQUU7QUFDL0UsQ0FBQyxDQUFFLENBQUM7QUFFSixJQUFNQyxlQUFlLEdBQUc7RUFDdEI7RUFDQUMsTUFBTSxFQUFFLENBQUM7RUFDVDtFQUNBQyxNQUFNLEVBQUUsQ0FBQztFQUNUO0VBQ0EsY0FBYyxFQUFFO0FBQ2xCLENBQUM7QUFFRCxJQUFNQyw4QkFBOEIsR0FBRztFQUNyQ0MsVUFBVSxFQUFFLENBQUM7SUFBRUMsSUFBSSxFQUFFO0VBQWdDLENBQUMsRUFBRTtJQUFFQSxJQUFJLEVBQUU7RUFBZ0MsQ0FBQztBQUNuRyxDQUFDO0FBRUQsSUFBTUMsaUJBQWlCLEdBQUcsSUFBSTtBQUFDLElBRXpCQyxZQUFZO0VBQ2hCLFNBQUFBLGFBQUEsRUFBYztJQUFBeEUsZUFBQSxPQUFBd0UsWUFBQTtJQUNaLElBQUksQ0FBQ0MsSUFBSSxHQUFHLElBQUk7SUFDaEI7SUFDQSxJQUFJLENBQUNDLFFBQVEsR0FBRyxJQUFJO0lBQ3BCLElBQUksQ0FBQ0MsU0FBUyxHQUFHLElBQUk7SUFFckIsSUFBSSxDQUFDQyxTQUFTLEdBQUcsSUFBSTtJQUNyQixJQUFJLENBQUNDLGFBQWEsR0FBRyxDQUFDLENBQUM7SUFDdkIsSUFBSSxDQUFDQyxvQkFBb0IsR0FBRyxJQUFJO0lBQ2hDLElBQUksQ0FBQ0MsRUFBRSxHQUFHLElBQUk7SUFDZCxJQUFJLENBQUNDLE9BQU8sR0FBRyxJQUFJO0lBQ25CLElBQUksQ0FBQ0MsaUJBQWlCLEdBQUcsYUFBYTtJQUN0QyxJQUFJLENBQUNDLG1CQUFtQixHQUFHLGFBQWE7O0lBRXhDO0lBQ0E7SUFDQSxJQUFJLENBQUNDLHdCQUF3QixHQUFHLElBQUksR0FBR25DLElBQUksQ0FBQ0UsTUFBTSxDQUFDLENBQUM7SUFDcEQsSUFBSSxDQUFDa0MsaUJBQWlCLEdBQUcsSUFBSSxDQUFDRCx3QkFBd0I7SUFDdEQsSUFBSSxDQUFDRSxtQkFBbUIsR0FBRyxJQUFJO0lBQy9CLElBQUksQ0FBQ0MsdUJBQXVCLEdBQUcsRUFBRTtJQUNqQyxJQUFJLENBQUNDLG9CQUFvQixHQUFHLENBQUM7SUFFN0IsSUFBSSxDQUFDQyxTQUFTLEdBQUcsSUFBSTtJQUNyQixJQUFJLENBQUNDLFNBQVMsR0FBRyxDQUFDLENBQUM7SUFDbkIsSUFBSSxDQUFDQyxhQUFhLEdBQUcsSUFBSUMsR0FBRyxDQUFDLENBQUM7SUFDOUIsSUFBSSxDQUFDQyxZQUFZLEdBQUcsQ0FBQyxDQUFDO0lBQ3RCLElBQUksQ0FBQ0MsZ0JBQWdCLEdBQUcsSUFBSTtJQUM1QixJQUFJLENBQUNDLG9CQUFvQixHQUFHLElBQUlDLEdBQUcsQ0FBQyxDQUFDO0lBRXJDLElBQUksQ0FBQ0MsY0FBYyxHQUFHLElBQUlELEdBQUcsQ0FBQyxDQUFDO0lBQy9CLElBQUksQ0FBQ0UsYUFBYSxHQUFHLElBQUlGLEdBQUcsQ0FBQyxDQUFDO0lBRTlCLElBQUksQ0FBQ0csV0FBVyxHQUFHLEVBQUU7SUFDckIsSUFBSSxDQUFDQyxrQkFBa0IsR0FBRyxDQUFDO0lBQzNCLElBQUksQ0FBQ0MsYUFBYSxHQUFHLENBQUM7SUFFdEIsSUFBSSxDQUFDQyxlQUFlLEdBQUcsSUFBSSxDQUFDQSxlQUFlLENBQUNDLElBQUksQ0FBQyxJQUFJLENBQUM7SUFDdEQsSUFBSSxDQUFDQyxnQkFBZ0IsR0FBRyxJQUFJLENBQUNBLGdCQUFnQixDQUFDRCxJQUFJLENBQUMsSUFBSSxDQUFDO0lBQ3hELElBQUksQ0FBQ0Usa0JBQWtCLEdBQUcsSUFBSSxDQUFDQSxrQkFBa0IsQ0FBQ0YsSUFBSSxDQUFDLElBQUksQ0FBQztJQUM1RCxJQUFJLENBQUNHLG9CQUFvQixHQUFHLElBQUksQ0FBQ0Esb0JBQW9CLENBQUNILElBQUksQ0FBQyxJQUFJLENBQUM7SUFDaEUsSUFBSSxDQUFDSSxNQUFNLEdBQUcsSUFBSSxDQUFDQSxNQUFNLENBQUNKLElBQUksQ0FBQyxJQUFJLENBQUM7RUFDdEM7RUFBQzlGLFlBQUEsQ0FBQWdFLFlBQUE7SUFBQXBOLEdBQUE7SUFBQUUsS0FBQSxFQUVELFNBQUFxUCxhQUFhQyxHQUFHLEVBQUU7TUFDaEIsSUFBSSxDQUFDaEMsU0FBUyxHQUFHZ0MsR0FBRztJQUN0QjtFQUFDO0lBQUF4UCxHQUFBO0lBQUFFLEtBQUEsRUFFRCxTQUFBdVAsT0FBT0MsR0FBRyxFQUFFLENBQUM7RUFBQztJQUFBMVAsR0FBQTtJQUFBRSxLQUFBLEVBRWQsU0FBQXlQLFFBQVFDLFFBQVEsRUFBRTtNQUNoQixJQUFJLENBQUN2QyxJQUFJLEdBQUd1QyxRQUFRO0lBQ3RCO0VBQUM7SUFBQTVQLEdBQUE7SUFBQUUsS0FBQSxFQUVELFNBQUEyUCxhQUFhdEMsU0FBUyxFQUFFO01BQ3RCLElBQUksQ0FBQ0EsU0FBUyxHQUFHQSxTQUFTO0lBQzVCO0VBQUM7SUFBQXZOLEdBQUE7SUFBQUUsS0FBQSxFQUVELFNBQUE0UCxZQUFZeEMsUUFBUSxFQUFFO01BQ3BCLElBQUksQ0FBQ0EsUUFBUSxHQUFHQSxRQUFRO0lBQzFCO0VBQUM7SUFBQXROLEdBQUE7SUFBQUUsS0FBQSxFQUVELFNBQUE2UCxpQkFBaUJDLE9BQU8sRUFBRTtNQUN4QixJQUFJLENBQUN2QyxhQUFhLEdBQUd1QyxPQUFPO0lBQzlCO0VBQUM7SUFBQWhRLEdBQUE7SUFBQUUsS0FBQSxFQUVELFNBQUErUCx3QkFBd0J2QyxvQkFBb0IsRUFBRTtNQUM1QyxJQUFJLENBQUNBLG9CQUFvQixHQUFHQSxvQkFBb0I7SUFDbEQ7RUFBQztJQUFBMU4sR0FBQTtJQUFBRSxLQUFBLEVBRUQsU0FBQWdRLDBCQUEwQkMsZUFBZSxFQUFFQyxlQUFlLEVBQUU7TUFDMUQsSUFBSSxDQUFDQyxjQUFjLEdBQUdGLGVBQWU7TUFDckMsSUFBSSxDQUFDRyxjQUFjLEdBQUdGLGVBQWU7SUFDdkM7RUFBQztJQUFBcFEsR0FBQTtJQUFBRSxLQUFBLEVBRUQsU0FBQXFRLHdCQUF3QkMsZ0JBQWdCLEVBQUU7TUFDeEMsSUFBSSxDQUFDQyxrQkFBa0IsR0FBR0QsZ0JBQWdCO0lBQzVDO0VBQUM7SUFBQXhRLEdBQUE7SUFBQUUsS0FBQSxFQUVELFNBQUF3USx3QkFBd0JDLFlBQVksRUFBRUMsY0FBYyxFQUFFQyxlQUFlLEVBQUU7TUFDckUsSUFBSSxDQUFDQyxtQkFBbUIsR0FBR0gsWUFBWTtNQUN2QyxJQUFJLENBQUNJLHNCQUFzQixHQUFHSCxjQUFjO01BQzVDLElBQUksQ0FBQ0ksaUJBQWlCLEdBQUdILGVBQWU7SUFDMUM7RUFBQztJQUFBN1EsR0FBQTtJQUFBRSxLQUFBLEVBRUQsU0FBQStRLHlCQUF5QkMsb0JBQW9CLEVBQUVDLG1CQUFtQixFQUFFQyx5QkFBeUIsRUFBRTtNQUM3RjtNQUNBLElBQUksQ0FBQ0MsY0FBYyxHQUFHSCxvQkFBb0I7TUFDMUM7TUFDQSxJQUFJLENBQUNJLGFBQWEsR0FBR0gsbUJBQW1CO01BQ3hDO01BQ0EsSUFBSSxDQUFDSSxtQkFBbUIsR0FBR0gseUJBQXlCO0lBQ3REO0VBQUM7SUFBQXBSLEdBQUE7SUFBQUUsS0FBQSxFQUVELFNBQUFzUixjQUFjQyxLQUFLLEVBQUU7TUFDbkIsSUFBSSxDQUFDQSxLQUFLLEdBQUdBLEtBQUs7SUFDcEI7RUFBQztJQUFBelIsR0FBQTtJQUFBRSxLQUFBLEVBRUQsU0FBQXdSLFFBQUEsRUFBVTtNQUFBLElBQUFDLE1BQUE7TUFDUjdHLEtBQUssa0JBQUE4RyxNQUFBLENBQWtCLElBQUksQ0FBQ3BFLFNBQVMsQ0FBRSxDQUFDO01BRXhDLElBQU1xRSxtQkFBbUIsR0FBRyxJQUFJbkwsT0FBTyxDQUFDLFVBQUN6RCxPQUFPLEVBQUVDLE1BQU0sRUFBSztRQUMzRHlPLE1BQUksQ0FBQ2hFLEVBQUUsR0FBRyxJQUFJbUUsU0FBUyxDQUFDSCxNQUFJLENBQUNuRSxTQUFTLEVBQUUsZ0JBQWdCLENBQUM7UUFFekRtRSxNQUFJLENBQUMvRCxPQUFPLEdBQUcsSUFBSTdELEVBQUUsQ0FBQ0UsWUFBWSxDQUFDMEgsTUFBSSxDQUFDaEUsRUFBRSxDQUFDeEQsSUFBSSxDQUFDK0UsSUFBSSxDQUFDeUMsTUFBSSxDQUFDaEUsRUFBRSxDQUFDLEVBQUU7VUFBRW9FLFNBQVMsRUFBRTtRQUFNLENBQUMsQ0FBQztRQUVwRkosTUFBSSxDQUFDaEUsRUFBRSxDQUFDcEIsZ0JBQWdCLENBQUMsT0FBTyxFQUFFb0YsTUFBSSxDQUFDeEMsZ0JBQWdCLENBQUM7UUFDeER3QyxNQUFJLENBQUNoRSxFQUFFLENBQUNwQixnQkFBZ0IsQ0FBQyxTQUFTLEVBQUVvRixNQUFJLENBQUN2QyxrQkFBa0IsQ0FBQztRQUU1RHVDLE1BQUksQ0FBQ0ssUUFBUSxHQUFHLFlBQU07VUFDcEJMLE1BQUksQ0FBQ2hFLEVBQUUsQ0FBQ3JCLG1CQUFtQixDQUFDLE1BQU0sRUFBRXFGLE1BQUksQ0FBQ0ssUUFBUSxDQUFDO1VBQ2xETCxNQUFJLENBQUMxQyxlQUFlLENBQUMsQ0FBQyxDQUNuQjFMLElBQUksQ0FBQ04sT0FBTyxDQUFDLFNBQ1IsQ0FBQ0MsTUFBTSxDQUFDO1FBQ2xCLENBQUM7UUFFRHlPLE1BQUksQ0FBQ2hFLEVBQUUsQ0FBQ3BCLGdCQUFnQixDQUFDLE1BQU0sRUFBRW9GLE1BQUksQ0FBQ0ssUUFBUSxDQUFDO01BQ2pELENBQUMsQ0FBQztNQUVGLE9BQU90TCxPQUFPLENBQUN1TCxHQUFHLENBQUMsQ0FBQ0osbUJBQW1CLEVBQUUsSUFBSSxDQUFDSyxnQkFBZ0IsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUNwRTtFQUFDO0lBQUFsUyxHQUFBO0lBQUFFLEtBQUEsRUFFRCxTQUFBaVMsV0FBQSxFQUFhO01BQ1hySCxLQUFLLGdCQUFnQixDQUFDO01BRXRCc0gsWUFBWSxDQUFDLElBQUksQ0FBQ25FLG1CQUFtQixDQUFDO01BRXRDLElBQUksQ0FBQ29FLGtCQUFrQixDQUFDLENBQUM7TUFDekIsSUFBSSxDQUFDL0QsYUFBYSxHQUFHLElBQUlDLEdBQUcsQ0FBQyxDQUFDO01BRTlCLElBQUksSUFBSSxDQUFDSCxTQUFTLEVBQUU7UUFDbEI7UUFDQSxJQUFJLENBQUNBLFNBQVMsQ0FBQ2tFLElBQUksQ0FBQ0MsS0FBSyxDQUFDLENBQUM7UUFDM0IsSUFBSSxDQUFDbkUsU0FBUyxHQUFHLElBQUk7TUFDdkI7TUFFQSxJQUFJLElBQUksQ0FBQ1IsT0FBTyxFQUFFO1FBQ2hCLElBQUksQ0FBQ0EsT0FBTyxDQUFDNEUsT0FBTyxDQUFDLENBQUM7UUFDdEIsSUFBSSxDQUFDNUUsT0FBTyxHQUFHLElBQUk7TUFDckI7TUFFQSxJQUFJLElBQUksQ0FBQ0QsRUFBRSxFQUFFO1FBQ1gsSUFBSSxDQUFDQSxFQUFFLENBQUNyQixtQkFBbUIsQ0FBQyxNQUFNLEVBQUUsSUFBSSxDQUFDMEYsUUFBUSxDQUFDO1FBQ2xELElBQUksQ0FBQ3JFLEVBQUUsQ0FBQ3JCLG1CQUFtQixDQUFDLE9BQU8sRUFBRSxJQUFJLENBQUM2QyxnQkFBZ0IsQ0FBQztRQUMzRCxJQUFJLENBQUN4QixFQUFFLENBQUNyQixtQkFBbUIsQ0FBQyxTQUFTLEVBQUUsSUFBSSxDQUFDOEMsa0JBQWtCLENBQUM7UUFDL0QsSUFBSSxDQUFDekIsRUFBRSxDQUFDNEUsS0FBSyxDQUFDLENBQUM7UUFDZixJQUFJLENBQUM1RSxFQUFFLEdBQUcsSUFBSTtNQUNoQjs7TUFFQTtNQUNBO01BQ0E7TUFDQSxJQUFJLElBQUksQ0FBQzhFLHVCQUF1QixFQUFFO1FBQ2hDTCxZQUFZLENBQUMsSUFBSSxDQUFDSyx1QkFBdUIsQ0FBQztRQUMxQyxJQUFJLENBQUNBLHVCQUF1QixHQUFHLElBQUk7TUFDckM7SUFDRjtFQUFDO0lBQUF6UyxHQUFBO0lBQUFFLEtBQUEsRUFFRCxTQUFBd1MsZUFBQSxFQUFpQjtNQUNmLE9BQU8sSUFBSSxDQUFDL0UsRUFBRSxLQUFLLElBQUk7SUFDekI7RUFBQztJQUFBM04sR0FBQTtJQUFBRSxLQUFBO01BQUEsSUFBQXlTLGdCQUFBLEdBQUFuSyxpQkFBQSxlQUFBakosbUJBQUEsR0FBQThHLElBQUEsQ0FFRCxTQUFBdU0sUUFBQTtRQUFBLElBQUFDLG1CQUFBLEVBQUEvTSxDQUFBLEVBQUFnTixVQUFBO1FBQUEsT0FBQXZULG1CQUFBLEdBQUF5QixJQUFBLFVBQUErUixTQUFBQyxRQUFBO1VBQUEsa0JBQUFBLFFBQUEsQ0FBQTlMLElBQUEsR0FBQThMLFFBQUEsQ0FBQXBPLElBQUE7WUFBQTtjQUFBb08sUUFBQSxDQUFBcE8sSUFBQTtjQUFBLE9BRVEsSUFBSSxDQUFDZ0osT0FBTyxDQUFDcE0sTUFBTSxDQUFDLENBQUM7WUFBQTtjQUFBd1IsUUFBQSxDQUFBcE8sSUFBQTtjQUFBLE9BS0osSUFBSSxDQUFDcU8sZUFBZSxDQUFDLENBQUM7WUFBQTtjQUE3QyxJQUFJLENBQUM3RSxTQUFTLEdBQUE0RSxRQUFBLENBQUE5TyxJQUFBO2NBRWQ7Y0FDQSxJQUFJLENBQUNtTSxjQUFjLENBQUMsSUFBSSxDQUFDL0MsUUFBUSxDQUFDO2NBRTVCdUYsbUJBQW1CLEdBQUcsRUFBRTtjQUVyQi9NLENBQUMsR0FBRyxDQUFDO1lBQUE7Y0FBQSxNQUFFQSxDQUFDLEdBQUcsSUFBSSxDQUFDc0ksU0FBUyxDQUFDOEUsZ0JBQWdCLENBQUNyTixNQUFNO2dCQUFBbU4sUUFBQSxDQUFBcE8sSUFBQTtnQkFBQTtjQUFBO2NBQ2xEa08sVUFBVSxHQUFHLElBQUksQ0FBQzFFLFNBQVMsQ0FBQzhFLGdCQUFnQixDQUFDcE4sQ0FBQyxDQUFDO2NBQUEsTUFDakRnTixVQUFVLEtBQUssSUFBSSxDQUFDeEYsUUFBUTtnQkFBQTBGLFFBQUEsQ0FBQXBPLElBQUE7Z0JBQUE7Y0FBQTtjQUFBLE9BQUFvTyxRQUFBLENBQUEzTyxNQUFBO1lBQUE7Y0FBWTtjQUM1Q3dPLG1CQUFtQixDQUFDdk4sSUFBSSxDQUFDLElBQUksQ0FBQzZOLFdBQVcsQ0FBQ0wsVUFBVSxDQUFDLENBQUM7WUFBQztjQUhHaE4sQ0FBQyxFQUFFO2NBQUFrTixRQUFBLENBQUFwTyxJQUFBO2NBQUE7WUFBQTtjQUFBb08sUUFBQSxDQUFBcE8sSUFBQTtjQUFBLE9BTXpEOEIsT0FBTyxDQUFDdUwsR0FBRyxDQUFDWSxtQkFBbUIsQ0FBQztZQUFBO1lBQUE7Y0FBQSxPQUFBRyxRQUFBLENBQUEzTCxJQUFBO1VBQUE7UUFBQSxHQUFBdUwsT0FBQTtNQUFBLENBQ3ZDO01BQUEsU0FBQTNELGdCQUFBO1FBQUEsT0FBQTBELGdCQUFBLENBQUFoSyxLQUFBLE9BQUFELFNBQUE7TUFBQTtNQUFBLE9BQUF1RyxlQUFBO0lBQUE7RUFBQTtJQUFBalAsR0FBQTtJQUFBRSxLQUFBLEVBRUQsU0FBQWlQLGlCQUFpQmlFLEtBQUssRUFBRTtNQUFBLElBQUFDLE1BQUE7TUFDdEI7TUFDQSxJQUFJRCxLQUFLLENBQUNFLElBQUksS0FBS25HLGlCQUFpQixFQUFFO1FBQ3BDO01BQ0Y7TUFFQTNDLE9BQU8sQ0FBQ1EsSUFBSSxDQUFDLHNDQUFzQyxDQUFDO01BQ3BELElBQUksSUFBSSxDQUFDcUcsY0FBYyxFQUFFO1FBQ3ZCLElBQUksQ0FBQ0EsY0FBYyxDQUFDLElBQUksQ0FBQ3JELGlCQUFpQixDQUFDO01BQzdDO01BRUEsSUFBSSxDQUFDQyxtQkFBbUIsR0FBR3NGLFVBQVUsQ0FBQztRQUFBLE9BQU1GLE1BQUksQ0FBQ3pJLFNBQVMsQ0FBQyxDQUFDO01BQUEsR0FBRSxJQUFJLENBQUNvRCxpQkFBaUIsQ0FBQztJQUN2RjtFQUFDO0lBQUFoTyxHQUFBO0lBQUFFLEtBQUEsRUFFRCxTQUFBMEssVUFBQSxFQUFZO01BQUEsSUFBQTRJLE1BQUE7TUFDVjtNQUNBLElBQUksQ0FBQ3JCLFVBQVUsQ0FBQyxDQUFDO01BRWpCLElBQUksQ0FBQ1QsT0FBTyxDQUFDLENBQUMsQ0FDWG5PLElBQUksQ0FBQyxZQUFNO1FBQ1ZpUSxNQUFJLENBQUN4RixpQkFBaUIsR0FBR3dGLE1BQUksQ0FBQ3pGLHdCQUF3QjtRQUN0RHlGLE1BQUksQ0FBQ3JGLG9CQUFvQixHQUFHLENBQUM7UUFFN0IsSUFBSXFGLE1BQUksQ0FBQ2xDLGFBQWEsRUFBRTtVQUN0QmtDLE1BQUksQ0FBQ2xDLGFBQWEsQ0FBQyxDQUFDO1FBQ3RCO01BQ0YsQ0FBQyxDQUFDLFNBQ0ksQ0FBQyxVQUFBN04sS0FBSyxFQUFJO1FBQ2QrUCxNQUFJLENBQUN4RixpQkFBaUIsSUFBSSxJQUFJO1FBQzlCd0YsTUFBSSxDQUFDckYsb0JBQW9CLEVBQUU7UUFFM0IsSUFBSXFGLE1BQUksQ0FBQ3JGLG9CQUFvQixHQUFHcUYsTUFBSSxDQUFDdEYsdUJBQXVCLElBQUlzRixNQUFJLENBQUNqQyxtQkFBbUIsRUFBRTtVQUN4RixPQUFPaUMsTUFBSSxDQUFDakMsbUJBQW1CLENBQzdCLElBQUkxTixLQUFLLENBQUMsMEZBQTBGLENBQ3RHLENBQUM7UUFDSDtRQUVBMkcsT0FBTyxDQUFDUSxJQUFJLENBQUMsbUNBQW1DLENBQUM7UUFDakRSLE9BQU8sQ0FBQ1EsSUFBSSxDQUFDdkgsS0FBSyxDQUFDO1FBRW5CLElBQUkrUCxNQUFJLENBQUNuQyxjQUFjLEVBQUU7VUFDdkJtQyxNQUFJLENBQUNuQyxjQUFjLENBQUNtQyxNQUFJLENBQUN4RixpQkFBaUIsQ0FBQztRQUM3QztRQUVBd0YsTUFBSSxDQUFDdkYsbUJBQW1CLEdBQUdzRixVQUFVLENBQUM7VUFBQSxPQUFNQyxNQUFJLENBQUM1SSxTQUFTLENBQUMsQ0FBQztRQUFBLEdBQUU0SSxNQUFJLENBQUN4RixpQkFBaUIsQ0FBQztNQUN2RixDQUFDLENBQUM7SUFDTjtFQUFDO0lBQUFoTyxHQUFBO0lBQUFFLEtBQUEsRUFFRCxTQUFBdVQsd0JBQUEsRUFBMEI7TUFBQSxJQUFBQyxNQUFBO01BQ3hCLElBQUksSUFBSSxDQUFDakIsdUJBQXVCLEVBQUU7UUFDaENMLFlBQVksQ0FBQyxJQUFJLENBQUNLLHVCQUF1QixDQUFDO01BQzVDO01BRUEsSUFBSSxDQUFDQSx1QkFBdUIsR0FBR2MsVUFBVSxDQUFDLFlBQU07UUFDOUNHLE1BQUksQ0FBQ2pCLHVCQUF1QixHQUFHLElBQUk7UUFDbkNpQixNQUFJLENBQUM5SSxTQUFTLENBQUMsQ0FBQztNQUNsQixDQUFDLEVBQUUsS0FBSyxDQUFDO0lBQ1g7RUFBQztJQUFBNUssR0FBQTtJQUFBRSxLQUFBLEVBRUQsU0FBQWtQLG1CQUFtQmdFLEtBQUssRUFBRTtNQUN4QixJQUFJLENBQUN4RixPQUFPLENBQUMrRixPQUFPLENBQUNDLElBQUksQ0FBQ0MsS0FBSyxDQUFDVCxLQUFLLENBQUNVLElBQUksQ0FBQyxDQUFDO0lBQzlDO0VBQUM7SUFBQTlULEdBQUE7SUFBQUUsS0FBQTtNQUFBLElBQUE2VCxZQUFBLEdBQUF2TCxpQkFBQSxlQUFBakosbUJBQUEsR0FBQThHLElBQUEsQ0FFRCxTQUFBMk4sU0FBa0JsQixVQUFVO1FBQUEsSUFBQW1CLFVBQUE7UUFBQSxPQUFBMVUsbUJBQUEsR0FBQXlCLElBQUEsVUFBQWtULFVBQUFDLFNBQUE7VUFBQSxrQkFBQUEsU0FBQSxDQUFBak4sSUFBQSxHQUFBaU4sU0FBQSxDQUFBdlAsSUFBQTtZQUFBO2NBQzFCLElBQUksSUFBSSxDQUFDeUosU0FBUyxDQUFDeUUsVUFBVSxDQUFDLEVBQUU7Z0JBQzlCLElBQUksQ0FBQ3NCLGNBQWMsQ0FBQ3RCLFVBQVUsQ0FBQztjQUNqQztjQUVBLElBQUksQ0FBQ3hFLGFBQWEsVUFBTyxDQUFDd0UsVUFBVSxDQUFDO2NBQUNxQixTQUFBLENBQUF2UCxJQUFBO2NBQUEsT0FFZixJQUFJLENBQUN5UCxnQkFBZ0IsQ0FBQ3ZCLFVBQVUsQ0FBQztZQUFBO2NBQXBEbUIsVUFBVSxHQUFBRSxTQUFBLENBQUFqUSxJQUFBO2NBQUEsSUFFVCtQLFVBQVU7Z0JBQUFFLFNBQUEsQ0FBQXZQLElBQUE7Z0JBQUE7Y0FBQTtjQUFBLE9BQUF1UCxTQUFBLENBQUE5UCxNQUFBO1lBQUE7Y0FFZixJQUFJLENBQUNnSyxTQUFTLENBQUN5RSxVQUFVLENBQUMsR0FBR21CLFVBQVU7Y0FFdkMsSUFBSSxDQUFDSyxjQUFjLENBQUN4QixVQUFVLEVBQUVtQixVQUFVLENBQUNNLFdBQVcsQ0FBQzs7Y0FFdkQ7Y0FDQSxJQUFJLENBQUN6RCxtQkFBbUIsQ0FBQ2dDLFVBQVUsQ0FBQztjQUNwQyxJQUFJLENBQUNyQyxrQkFBa0IsQ0FBQyxJQUFJLENBQUNwQyxTQUFTLENBQUM7Y0FBQyxPQUFBOEYsU0FBQSxDQUFBOVAsTUFBQSxXQUVqQzRQLFVBQVU7WUFBQTtZQUFBO2NBQUEsT0FBQUUsU0FBQSxDQUFBOU0sSUFBQTtVQUFBO1FBQUEsR0FBQTJNLFFBQUE7TUFBQSxDQUNsQjtNQUFBLFNBQUFiLFlBQUFxQixFQUFBO1FBQUEsT0FBQVQsWUFBQSxDQUFBcEwsS0FBQSxPQUFBRCxTQUFBO01BQUE7TUFBQSxPQUFBeUssV0FBQTtJQUFBO0VBQUE7SUFBQW5ULEdBQUE7SUFBQUUsS0FBQSxFQUVELFNBQUFtUyxtQkFBQSxFQUFxQjtNQUFBLElBQUFvQyxTQUFBLEdBQUFDLDBCQUFBLENBQ01oVixNQUFNLENBQUNpVixtQkFBbUIsQ0FBQyxJQUFJLENBQUN0RyxTQUFTLENBQUM7UUFBQXVHLEtBQUE7TUFBQTtRQUFuRSxLQUFBSCxTQUFBLENBQUFJLENBQUEsTUFBQUQsS0FBQSxHQUFBSCxTQUFBLENBQUFLLENBQUEsSUFBQXhRLElBQUEsR0FBcUU7VUFBQSxJQUExRHdPLFVBQVUsR0FBQThCLEtBQUEsQ0FBQTFVLEtBQUE7VUFDbkIsSUFBSSxDQUFDa1UsY0FBYyxDQUFDdEIsVUFBVSxDQUFDO1FBQ2pDO01BQUMsU0FBQS9SLEdBQUE7UUFBQTBULFNBQUEsQ0FBQXBLLENBQUEsQ0FBQXRKLEdBQUE7TUFBQTtRQUFBMFQsU0FBQSxDQUFBTSxDQUFBO01BQUE7SUFDSDtFQUFDO0lBQUEvVSxHQUFBO0lBQUFFLEtBQUEsRUFFRCxTQUFBa1UsZUFBZXRCLFVBQVUsRUFBRTtNQUN6QixJQUFJLENBQUN4RSxhQUFhLENBQUMwRyxHQUFHLENBQUNsQyxVQUFVLENBQUM7TUFFbEMsSUFBSSxJQUFJLENBQUN6RSxTQUFTLENBQUN5RSxVQUFVLENBQUMsRUFBRTtRQUM5QjtRQUNBLElBQUksQ0FBQ3pFLFNBQVMsQ0FBQ3lFLFVBQVUsQ0FBQyxDQUFDUixJQUFJLENBQUNDLEtBQUssQ0FBQyxDQUFDO1FBQ3ZDLE9BQU8sSUFBSSxDQUFDbEUsU0FBUyxDQUFDeUUsVUFBVSxDQUFDO01BQ25DO01BRUEsSUFBSSxJQUFJLENBQUN0RSxZQUFZLENBQUNzRSxVQUFVLENBQUMsRUFBRTtRQUNqQyxPQUFPLElBQUksQ0FBQ3RFLFlBQVksQ0FBQ3NFLFVBQVUsQ0FBQztNQUN0QztNQUVBLElBQUksSUFBSSxDQUFDcEUsb0JBQW9CLENBQUN1RyxHQUFHLENBQUNuQyxVQUFVLENBQUMsRUFBRTtRQUM3QyxJQUFNb0MsR0FBRyxHQUFHLDZEQUE2RDtRQUN6RSxJQUFJLENBQUN4RyxvQkFBb0IsQ0FBQ3lHLEdBQUcsQ0FBQ3JDLFVBQVUsQ0FBQyxDQUFDc0MsS0FBSyxDQUFDbFMsTUFBTSxDQUFDZ1MsR0FBRyxDQUFDO1FBQzNELElBQUksQ0FBQ3hHLG9CQUFvQixDQUFDeUcsR0FBRyxDQUFDckMsVUFBVSxDQUFDLENBQUNyRyxLQUFLLENBQUN2SixNQUFNLENBQUNnUyxHQUFHLENBQUM7UUFDM0QsSUFBSSxDQUFDeEcsb0JBQW9CLFVBQU8sQ0FBQ29FLFVBQVUsQ0FBQztNQUM5Qzs7TUFFQTtNQUNBLElBQUksQ0FBQy9CLHNCQUFzQixDQUFDK0IsVUFBVSxDQUFDO01BQ3ZDLElBQUksQ0FBQ3JDLGtCQUFrQixDQUFDLElBQUksQ0FBQ3BDLFNBQVMsQ0FBQztJQUN6QztFQUFDO0lBQUFyTyxHQUFBO0lBQUFFLEtBQUEsRUFFRCxTQUFBbVYsVUFBVS9DLElBQUksRUFBRTdLLE1BQU0sRUFBRTtNQUFBLElBQUE2TixNQUFBO01BQ3RCaEQsSUFBSSxDQUFDL0YsZ0JBQWdCLENBQUMsY0FBYyxFQUFFLFVBQUFnSixFQUFFLEVBQUk7UUFDMUM5TixNQUFNLENBQUMrTixXQUFXLENBQUNELEVBQUUsQ0FBQ0UsU0FBUyxJQUFJLElBQUksQ0FBQyxTQUFNLENBQUMsVUFBQXBMLENBQUM7VUFBQSxPQUFJNUcsS0FBSyxDQUFDLHlCQUF5QixFQUFFNEcsQ0FBQyxDQUFDO1FBQUEsRUFBQztNQUMxRixDQUFDLENBQUM7TUFDRmlJLElBQUksQ0FBQy9GLGdCQUFnQixDQUFDLDBCQUEwQixFQUFFLFVBQUFnSixFQUFFLEVBQUk7UUFDdEQsSUFBSWpELElBQUksQ0FBQ29ELGtCQUFrQixLQUFLLFdBQVcsRUFBRTtVQUMzQ2xMLE9BQU8sQ0FBQ08sR0FBRyxDQUFDLGdDQUFnQyxDQUFDO1FBQy9DO1FBQ0EsSUFBSXVILElBQUksQ0FBQ29ELGtCQUFrQixLQUFLLGNBQWMsRUFBRTtVQUM5Q2xMLE9BQU8sQ0FBQ1EsSUFBSSxDQUFDLG1DQUFtQyxDQUFDO1FBQ25EO1FBQ0EsSUFBSXNILElBQUksQ0FBQ29ELGtCQUFrQixLQUFLLFFBQVEsRUFBRTtVQUN4Q2xMLE9BQU8sQ0FBQ1EsSUFBSSxDQUFDLDRDQUE0QyxDQUFDO1VBQzFEc0ssTUFBSSxDQUFDN0IsdUJBQXVCLENBQUMsQ0FBQztRQUNoQztNQUNGLENBQUMsQ0FBQzs7TUFFRjtNQUNBO01BQ0E7TUFDQTtNQUNBbkIsSUFBSSxDQUFDL0YsZ0JBQWdCLENBQ25CLG1CQUFtQixFQUNuQmpCLFFBQVEsQ0FBQyxVQUFBaUssRUFBRSxFQUFJO1FBQ2J6SyxLQUFLLENBQUMsa0NBQWtDLEVBQUVyRCxNQUFNLENBQUM7UUFDakQsSUFBSWtPLEtBQUssR0FBR3JELElBQUksQ0FBQ3NELFdBQVcsQ0FBQyxDQUFDLENBQUNyUyxJQUFJLENBQUMrUixNQUFJLENBQUNPLHFCQUFxQixDQUFDLENBQUN0UyxJQUFJLENBQUMrUixNQUFJLENBQUNRLGlCQUFpQixDQUFDO1FBQzVGLElBQUlDLEtBQUssR0FBR0osS0FBSyxDQUFDcFMsSUFBSSxDQUFDLFVBQUF5UyxDQUFDO1VBQUEsT0FBSTFELElBQUksQ0FBQzJELG1CQUFtQixDQUFDRCxDQUFDLENBQUM7UUFBQSxFQUFDO1FBQ3hELElBQUlFLE1BQU0sR0FBR1AsS0FBSztRQUVsQk8sTUFBTSxHQUFHQSxNQUFNLENBQ1ozUyxJQUFJLENBQUMrUixNQUFJLENBQUNRLGlCQUFpQixDQUFDLENBQzVCdlMsSUFBSSxDQUFDLFVBQUE0UyxDQUFDO1VBQUEsT0FBSTFPLE1BQU0sQ0FBQzJPLFFBQVEsQ0FBQ0QsQ0FBQyxDQUFDO1FBQUEsRUFBQyxDQUM3QjVTLElBQUksQ0FBQyxVQUFBOFMsQ0FBQztVQUFBLE9BQUkvRCxJQUFJLENBQUNnRSxvQkFBb0IsQ0FBQ0QsQ0FBQyxDQUFDRSxJQUFJLENBQUM7UUFBQSxFQUFDO1FBQy9DLE9BQU83UCxPQUFPLENBQUN1TCxHQUFHLENBQUMsQ0FBQzhELEtBQUssRUFBRUcsTUFBTSxDQUFDLENBQUMsU0FBTSxDQUFDLFVBQUE3TCxDQUFDO1VBQUEsT0FBSTVHLEtBQUssQ0FBQyw2QkFBNkIsRUFBRTRHLENBQUMsQ0FBQztRQUFBLEVBQUM7TUFDekYsQ0FBQyxDQUNILENBQUM7TUFDRDVDLE1BQU0sQ0FBQytPLEVBQUUsQ0FDUCxPQUFPLEVBQ1BsTCxRQUFRLENBQUMsVUFBQWlLLEVBQUUsRUFBSTtRQUNiLElBQUlnQixJQUFJLEdBQUdoQixFQUFFLENBQUNnQixJQUFJO1FBQ2xCLElBQUlBLElBQUksSUFBSUEsSUFBSSxDQUFDeFUsSUFBSSxJQUFJLE9BQU8sRUFBRTtVQUNoQytJLEtBQUssQ0FBQyxvQ0FBb0MsRUFBRXJELE1BQU0sQ0FBQztVQUNuRCxJQUFJZ1AsTUFBTSxHQUFHbkUsSUFBSSxDQUNkZ0Usb0JBQW9CLENBQUNoQixNQUFJLENBQUNvQixzQkFBc0IsQ0FBQ0gsSUFBSSxDQUFDLENBQUMsQ0FDdkRoVCxJQUFJLENBQUMsVUFBQW1JLENBQUM7WUFBQSxPQUFJNEcsSUFBSSxDQUFDcUUsWUFBWSxDQUFDLENBQUM7VUFBQSxFQUFDLENBQzlCcFQsSUFBSSxDQUFDK1IsTUFBSSxDQUFDUSxpQkFBaUIsQ0FBQztVQUMvQixJQUFJQyxLQUFLLEdBQUdVLE1BQU0sQ0FBQ2xULElBQUksQ0FBQyxVQUFBcVQsQ0FBQztZQUFBLE9BQUl0RSxJQUFJLENBQUMyRCxtQkFBbUIsQ0FBQ1csQ0FBQyxDQUFDO1VBQUEsRUFBQztVQUN6RCxJQUFJVixNQUFNLEdBQUdPLE1BQU0sQ0FBQ2xULElBQUksQ0FBQyxVQUFBNFMsQ0FBQztZQUFBLE9BQUkxTyxNQUFNLENBQUMyTyxRQUFRLENBQUNELENBQUMsQ0FBQztVQUFBLEVBQUM7VUFDakQsT0FBT3pQLE9BQU8sQ0FBQ3VMLEdBQUcsQ0FBQyxDQUFDOEQsS0FBSyxFQUFFRyxNQUFNLENBQUMsQ0FBQyxTQUFNLENBQUMsVUFBQTdMLENBQUM7WUFBQSxPQUFJNUcsS0FBSyxDQUFDLDhCQUE4QixFQUFFNEcsQ0FBQyxDQUFDO1VBQUEsRUFBQztRQUMxRixDQUFDLE1BQU07VUFDTDtVQUNBLE9BQU8sSUFBSTtRQUNiO01BQ0YsQ0FBQyxDQUNILENBQUM7SUFDSDtFQUFDO0lBQUFySyxHQUFBO0lBQUFFLEtBQUE7TUFBQSxJQUFBMlcsZ0JBQUEsR0FBQXJPLGlCQUFBLGVBQUFqSixtQkFBQSxHQUFBOEcsSUFBQSxDQUVELFNBQUF5USxTQUFBO1FBQUEsSUFBQUMsTUFBQTtRQUFBLElBQUF0UCxNQUFBLEVBQUE2SyxJQUFBLEVBQUEwRSxRQUFBLEVBQUFDLGVBQUEsRUFBQUMsaUJBQUEsRUFBQTVNLE9BQUEsRUFBQXZKLEdBQUEsRUFBQW1TLGdCQUFBO1FBQUEsT0FBQTNULG1CQUFBLEdBQUF5QixJQUFBLFVBQUFtVyxVQUFBQyxTQUFBO1VBQUEsa0JBQUFBLFNBQUEsQ0FBQWxRLElBQUEsR0FBQWtRLFNBQUEsQ0FBQXhTLElBQUE7WUFBQTtjQUNNNkMsTUFBTSxHQUFHLElBQUlzQyxFQUFFLENBQUNzTixpQkFBaUIsQ0FBQyxJQUFJLENBQUN6SixPQUFPLENBQUM7Y0FDL0MwRSxJQUFJLEdBQUcsSUFBSWdGLGlCQUFpQixDQUFDLElBQUksQ0FBQzVKLG9CQUFvQixJQUFJViw4QkFBOEIsQ0FBQztjQUU3RmxDLEtBQUssQ0FBQyxxQkFBcUIsQ0FBQztjQUFDc00sU0FBQSxDQUFBeFMsSUFBQTtjQUFBLE9BQ3ZCNkMsTUFBTSxDQUFDOFAsTUFBTSxDQUFDLGtCQUFrQixFQUFFLElBQUksQ0FBQzlGLEtBQUssSUFBSSxJQUFJLENBQUNuRSxRQUFRLEdBQUdrSyxRQUFRLENBQUMsSUFBSSxDQUFDbEssUUFBUSxDQUFDLEdBQUcsSUFBSSxDQUFDbUUsS0FBSyxHQUFHak4sU0FBUyxDQUFDO1lBQUE7Y0FFdkgsSUFBSSxDQUFDNlEsU0FBUyxDQUFDL0MsSUFBSSxFQUFFN0ssTUFBTSxDQUFDO2NBRTVCcUQsS0FBSyxDQUFDLDBDQUEwQyxDQUFDO2NBQzdDa00sUUFBUSxHQUFHLElBQUl0USxPQUFPLENBQUMsVUFBQXpELE9BQU87Z0JBQUEsT0FBSXdFLE1BQU0sQ0FBQytPLEVBQUUsQ0FBQyxVQUFVLEVBQUV2VCxPQUFPLENBQUM7Y0FBQSxFQUFDLEVBRXJFO2NBQ0E7Y0FDSWdVLGVBQWUsR0FBRzNFLElBQUksQ0FBQ21GLGlCQUFpQixDQUFDLFVBQVUsRUFBRTtnQkFBRUMsT0FBTyxFQUFFO2NBQUssQ0FBQyxDQUFDO2NBQ3ZFUixpQkFBaUIsR0FBRzVFLElBQUksQ0FBQ21GLGlCQUFpQixDQUFDLFlBQVksRUFBRTtnQkFDM0RDLE9BQU8sRUFBRSxLQUFLO2dCQUNkQyxjQUFjLEVBQUU7Y0FDbEIsQ0FBQyxDQUFDO2NBRUZWLGVBQWUsQ0FBQzFLLGdCQUFnQixDQUFDLFNBQVMsRUFBRSxVQUFBbEMsQ0FBQztnQkFBQSxPQUFJME0sTUFBSSxDQUFDMUgsb0JBQW9CLENBQUNoRixDQUFDLEVBQUUsZ0JBQWdCLENBQUM7Y0FBQSxFQUFDO2NBQ2hHNk0saUJBQWlCLENBQUMzSyxnQkFBZ0IsQ0FBQyxTQUFTLEVBQUUsVUFBQWxDLENBQUM7Z0JBQUEsT0FBSTBNLE1BQUksQ0FBQzFILG9CQUFvQixDQUFDaEYsQ0FBQyxFQUFFLGtCQUFrQixDQUFDO2NBQUEsRUFBQztjQUFDK00sU0FBQSxDQUFBeFMsSUFBQTtjQUFBLE9BRS9Gb1MsUUFBUTtZQUFBO2NBQUFJLFNBQUEsQ0FBQXhTLElBQUE7Y0FBQSxPQUNSb0gsb0JBQW9CLENBQUNpTCxlQUFlLENBQUM7WUFBQTtjQUFBRyxTQUFBLENBQUF4UyxJQUFBO2NBQUEsT0FDckNvSCxvQkFBb0IsQ0FBQ2tMLGlCQUFpQixDQUFDO1lBQUE7Y0FFN0M7Y0FDQTtjQUNBO2NBQ0E7Y0FDQTtjQUNBLElBQUksSUFBSSxDQUFDekksZ0JBQWdCLEVBQUU7Z0JBQ3pCLElBQUksQ0FBQ0EsZ0JBQWdCLENBQUNtSixTQUFTLENBQUMsQ0FBQyxDQUFDalYsT0FBTyxDQUFDLFVBQUFrVixLQUFLLEVBQUk7a0JBQ2pEdkYsSUFBSSxDQUFDd0YsUUFBUSxDQUFDRCxLQUFLLEVBQUVkLE1BQUksQ0FBQ3RJLGdCQUFnQixDQUFDO2dCQUM3QyxDQUFDLENBQUM7Y0FDSjs7Y0FFQTtjQUNBaEgsTUFBTSxDQUFDK08sRUFBRSxDQUFDLE9BQU8sRUFBRSxVQUFBakIsRUFBRSxFQUFJO2dCQUN2QixJQUFJekIsSUFBSSxHQUFHeUIsRUFBRSxDQUFDd0MsVUFBVSxDQUFDakUsSUFBSTtnQkFDN0IsSUFBSUEsSUFBSSxDQUFDVixLQUFLLElBQUksTUFBTSxJQUFJVSxJQUFJLENBQUNrRSxPQUFPLElBQUlqQixNQUFJLENBQUMxSixJQUFJLEVBQUU7a0JBQ3JELElBQUkwSixNQUFJLENBQUN0RSx1QkFBdUIsRUFBRTtvQkFDaEM7b0JBQ0E7a0JBQ0Y7a0JBQ0FzRSxNQUFJLENBQUM1RCxXQUFXLENBQUNXLElBQUksQ0FBQ21FLE9BQU8sQ0FBQztnQkFDaEMsQ0FBQyxNQUFNLElBQUluRSxJQUFJLENBQUNWLEtBQUssSUFBSSxPQUFPLElBQUlVLElBQUksQ0FBQ2tFLE9BQU8sSUFBSWpCLE1BQUksQ0FBQzFKLElBQUksRUFBRTtrQkFDN0QwSixNQUFJLENBQUMzQyxjQUFjLENBQUNOLElBQUksQ0FBQ21FLE9BQU8sQ0FBQztnQkFDbkMsQ0FBQyxNQUFNLElBQUluRSxJQUFJLENBQUNWLEtBQUssSUFBSSxTQUFTLEVBQUU7a0JBQ2xDMUcsUUFBUSxDQUFDd0wsSUFBSSxDQUFDQyxhQUFhLENBQUMsSUFBSUMsV0FBVyxDQUFDLFNBQVMsRUFBRTtvQkFBRUMsTUFBTSxFQUFFO3NCQUFFL0ssUUFBUSxFQUFFd0csSUFBSSxDQUFDd0U7b0JBQUc7a0JBQUUsQ0FBQyxDQUFDLENBQUM7Z0JBQzVGLENBQUMsTUFBTSxJQUFJeEUsSUFBSSxDQUFDVixLQUFLLElBQUksV0FBVyxFQUFFO2tCQUNwQzFHLFFBQVEsQ0FBQ3dMLElBQUksQ0FBQ0MsYUFBYSxDQUFDLElBQUlDLFdBQVcsQ0FBQyxXQUFXLEVBQUU7b0JBQUVDLE1BQU0sRUFBRTtzQkFBRS9LLFFBQVEsRUFBRXdHLElBQUksQ0FBQ3dFO29CQUFHO2tCQUFFLENBQUMsQ0FBQyxDQUFDO2dCQUM5RixDQUFDLE1BQU0sSUFBSXhFLElBQUksQ0FBQ1YsS0FBSyxLQUFLLE1BQU0sRUFBRTtrQkFDaEMyRCxNQUFJLENBQUN6SCxNQUFNLENBQUNzRSxJQUFJLENBQUNDLEtBQUssQ0FBQ0MsSUFBSSxDQUFDb0UsSUFBSSxDQUFDLEVBQUUsYUFBYSxDQUFDO2dCQUNuRDtjQUNGLENBQUMsQ0FBQztjQUVGcE4sS0FBSyxDQUFDLHNCQUFzQixDQUFDOztjQUU3QjtjQUFBc00sU0FBQSxDQUFBeFMsSUFBQTtjQUFBLE9BQ29CLElBQUksQ0FBQzJULFFBQVEsQ0FBQzlRLE1BQU0sRUFBRTtnQkFDeEMrUSxhQUFhLEVBQUUsSUFBSTtnQkFDbkIxRSxJQUFJLEVBQUU7Y0FDUixDQUFDLENBQUM7WUFBQTtjQUhFeEosT0FBTyxHQUFBOE0sU0FBQSxDQUFBbFQsSUFBQTtjQUFBLElBS05vRyxPQUFPLENBQUN5TixVQUFVLENBQUNqRSxJQUFJLENBQUMyRSxPQUFPO2dCQUFBckIsU0FBQSxDQUFBeFMsSUFBQTtnQkFBQTtjQUFBO2NBQzVCN0QsR0FBRyxHQUFHdUosT0FBTyxDQUFDeU4sVUFBVSxDQUFDakUsSUFBSSxDQUFDclEsS0FBSztjQUN6QytHLE9BQU8sQ0FBQy9HLEtBQUssQ0FBQzFDLEdBQUcsQ0FBQztjQUNsQjtjQUNBO2NBQ0E7Y0FDQTtjQUNBO2NBQ0E7Y0FDQTtjQUNBdVIsSUFBSSxDQUFDQyxLQUFLLENBQUMsQ0FBQztjQUFDLE1BQ1B4UixHQUFHO1lBQUE7Y0FHUG1TLGdCQUFnQixHQUFHNUksT0FBTyxDQUFDeU4sVUFBVSxDQUFDakUsSUFBSSxDQUFDNEUsUUFBUSxDQUFDQyxLQUFLLENBQUMsSUFBSSxDQUFDdEwsSUFBSSxDQUFDLElBQUksRUFBRTtjQUU5RSxJQUFJNkYsZ0JBQWdCLENBQUMwRixRQUFRLENBQUMsSUFBSSxDQUFDdEwsUUFBUSxDQUFDLEVBQUU7Z0JBQzVDOUMsT0FBTyxDQUFDUSxJQUFJLENBQUMsd0VBQXdFLENBQUM7Z0JBQ3RGLElBQUksQ0FBQ3lJLHVCQUF1QixDQUFDLENBQUM7Y0FDaEM7Y0FFQTNJLEtBQUssQ0FBQyxpQkFBaUIsQ0FBQztjQUFDLE9BQUFzTSxTQUFBLENBQUEvUyxNQUFBLFdBQ2xCO2dCQUNMb0QsTUFBTSxFQUFOQSxNQUFNO2dCQUNOeUwsZ0JBQWdCLEVBQWhCQSxnQkFBZ0I7Z0JBQ2hCK0QsZUFBZSxFQUFmQSxlQUFlO2dCQUNmQyxpQkFBaUIsRUFBakJBLGlCQUFpQjtnQkFDakI1RSxJQUFJLEVBQUpBO2NBQ0YsQ0FBQztZQUFBO1lBQUE7Y0FBQSxPQUFBOEUsU0FBQSxDQUFBL1AsSUFBQTtVQUFBO1FBQUEsR0FBQXlQLFFBQUE7TUFBQSxDQUNGO01BQUEsU0FBQTdELGdCQUFBO1FBQUEsT0FBQTRELGdCQUFBLENBQUFsTyxLQUFBLE9BQUFELFNBQUE7TUFBQTtNQUFBLE9BQUF1SyxlQUFBO0lBQUE7RUFBQTtJQUFBalQsR0FBQTtJQUFBRSxLQUFBLEVBRUQsU0FBQTJWLHNCQUFzQlUsSUFBSSxFQUFFO01BQzFCQSxJQUFJLENBQUNzQyxHQUFHLEdBQUd0QyxJQUFJLENBQUNzQyxHQUFHLENBQUNDLE9BQU8sQ0FBQyx5QkFBeUIsRUFBRSxVQUFDQyxJQUFJLEVBQUVDLEVBQUUsRUFBSztRQUNuRSxJQUFNQyxVQUFVLEdBQUd2WixNQUFNLENBQUN3WixNQUFNLENBQUNyTyxRQUFRLENBQUNzTyxTQUFTLENBQUNKLElBQUksQ0FBQyxFQUFFbE0sZUFBZSxDQUFDO1FBQzNFLE9BQU9oQyxRQUFRLENBQUN1TyxTQUFTLENBQUM7VUFBRUMsV0FBVyxFQUFFTCxFQUFFO1VBQUVDLFVBQVUsRUFBRUE7UUFBVyxDQUFDLENBQUM7TUFDeEUsQ0FBQyxDQUFDO01BQ0YsT0FBTzFDLElBQUk7SUFDYjtFQUFDO0lBQUF2VyxHQUFBO0lBQUFFLEtBQUEsRUFFRCxTQUFBd1csdUJBQXVCSCxJQUFJLEVBQUU7TUFDM0I7TUFDQSxJQUFJLENBQUMvSixvQkFBb0IsRUFBRTtRQUN6QixJQUFJckIsU0FBUyxDQUFDQyxTQUFTLENBQUNiLE9BQU8sQ0FBQyxnQkFBZ0IsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFO1VBQ3hEO1VBQ0FnTSxJQUFJLENBQUNzQyxHQUFHLEdBQUd0QyxJQUFJLENBQUNzQyxHQUFHLENBQUNDLE9BQU8sQ0FBQyxlQUFlLEVBQUUsSUFBSSxDQUFDO1FBQ3BEO01BQ0Y7O01BRUE7TUFDQSxJQUFJM04sU0FBUyxDQUFDQyxTQUFTLENBQUNiLE9BQU8sQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRTtRQUNqRGdNLElBQUksQ0FBQ3NDLEdBQUcsR0FBR3RDLElBQUksQ0FBQ3NDLEdBQUcsQ0FBQ0MsT0FBTyxDQUN6Qiw2QkFBNkIsRUFDN0IsZ0pBQ0YsQ0FBQztNQUNILENBQUMsTUFBTTtRQUNMdkMsSUFBSSxDQUFDc0MsR0FBRyxHQUFHdEMsSUFBSSxDQUFDc0MsR0FBRyxDQUFDQyxPQUFPLENBQ3pCLDZCQUE2QixFQUM3QixnSkFDRixDQUFDO01BQ0g7TUFDQSxPQUFPdkMsSUFBSTtJQUNiO0VBQUM7SUFBQXZXLEdBQUE7SUFBQUUsS0FBQTtNQUFBLElBQUFvWixrQkFBQSxHQUFBOVEsaUJBQUEsZUFBQWpKLG1CQUFBLEdBQUE4RyxJQUFBLENBRUQsU0FBQWtULFNBQXdCaEQsSUFBSTtRQUFBLE9BQUFoWCxtQkFBQSxHQUFBeUIsSUFBQSxVQUFBd1ksVUFBQUMsU0FBQTtVQUFBLGtCQUFBQSxTQUFBLENBQUF2UyxJQUFBLEdBQUF1UyxTQUFBLENBQUE3VSxJQUFBO1lBQUE7Y0FDMUI7Y0FDQTJSLElBQUksQ0FBQ3NDLEdBQUcsR0FBR3RDLElBQUksQ0FBQ3NDLEdBQUcsQ0FBQ0MsT0FBTyxDQUFDLHFCQUFxQixFQUFFLGlCQUFpQixDQUFDO2NBQUMsT0FBQVcsU0FBQSxDQUFBcFYsTUFBQSxXQUMvRGtTLElBQUk7WUFBQTtZQUFBO2NBQUEsT0FBQWtELFNBQUEsQ0FBQXBTLElBQUE7VUFBQTtRQUFBLEdBQUFrUyxRQUFBO01BQUEsQ0FDWjtNQUFBLFNBQUF6RCxrQkFBQTRELEdBQUE7UUFBQSxPQUFBSixrQkFBQSxDQUFBM1EsS0FBQSxPQUFBRCxTQUFBO01BQUE7TUFBQSxPQUFBb04saUJBQUE7SUFBQTtFQUFBO0lBQUE5VixHQUFBO0lBQUFFLEtBQUE7TUFBQSxJQUFBeVosaUJBQUEsR0FBQW5SLGlCQUFBLGVBQUFqSixtQkFBQSxHQUFBOEcsSUFBQSxDQUVELFNBQUF1VCxTQUF1QjlHLFVBQVU7UUFBQSxJQUFBK0csTUFBQTtRQUFBLElBQUFDLFVBQUE7VUFBQXJTLE1BQUE7VUFBQTZLLElBQUE7VUFBQXlILFlBQUE7VUFBQS9DLFFBQUE7VUFBQXpDLFdBQUE7VUFBQXlGLFNBQUE7VUFBQUMsTUFBQSxHQUFBdlIsU0FBQTtRQUFBLE9BQUFuSixtQkFBQSxHQUFBeUIsSUFBQSxVQUFBa1osVUFBQUMsU0FBQTtVQUFBLGtCQUFBQSxTQUFBLENBQUFqVCxJQUFBLEdBQUFpVCxTQUFBLENBQUF2VixJQUFBO1lBQUE7Y0FBRWtWLFVBQVUsR0FBQUcsTUFBQSxDQUFBcFUsTUFBQSxRQUFBb1UsTUFBQSxRQUFBelYsU0FBQSxHQUFBeVYsTUFBQSxNQUFHLENBQUM7Y0FBQSxLQUMzQyxJQUFJLENBQUMzTCxhQUFhLENBQUMyRyxHQUFHLENBQUNuQyxVQUFVLENBQUM7Z0JBQUFxSCxTQUFBLENBQUF2VixJQUFBO2dCQUFBO2NBQUE7Y0FDcEM0RixPQUFPLENBQUNRLElBQUksQ0FBQzhILFVBQVUsR0FBRyxnRkFBZ0YsQ0FBQztjQUFDLE9BQUFxSCxTQUFBLENBQUE5VixNQUFBLFdBQ3JHLElBQUk7WUFBQTtjQUdUb0QsTUFBTSxHQUFHLElBQUlzQyxFQUFFLENBQUNzTixpQkFBaUIsQ0FBQyxJQUFJLENBQUN6SixPQUFPLENBQUM7Y0FDL0MwRSxJQUFJLEdBQUcsSUFBSWdGLGlCQUFpQixDQUFDLElBQUksQ0FBQzVKLG9CQUFvQixJQUFJViw4QkFBOEIsQ0FBQztjQUU3RmxDLEtBQUssQ0FBQ2dJLFVBQVUsR0FBRyx1QkFBdUIsQ0FBQztjQUFDcUgsU0FBQSxDQUFBdlYsSUFBQTtjQUFBLE9BQ3RDNkMsTUFBTSxDQUFDOFAsTUFBTSxDQUFDLGtCQUFrQixFQUFFLElBQUksQ0FBQzlGLEtBQUssR0FBRytGLFFBQVEsQ0FBQzFFLFVBQVUsQ0FBQyxHQUFHLElBQUksQ0FBQ3JCLEtBQUssR0FBR2pOLFNBQVMsQ0FBQztZQUFBO2NBRW5HLElBQUksQ0FBQzZRLFNBQVMsQ0FBQy9DLElBQUksRUFBRTdLLE1BQU0sQ0FBQztjQUU1QnFELEtBQUssQ0FBQ2dJLFVBQVUsR0FBRyx3QkFBd0IsQ0FBQztjQUFDLEtBRXpDLElBQUksQ0FBQ3hFLGFBQWEsQ0FBQzJHLEdBQUcsQ0FBQ25DLFVBQVUsQ0FBQztnQkFBQXFILFNBQUEsQ0FBQXZWLElBQUE7Z0JBQUE7Y0FBQTtjQUNwQzBOLElBQUksQ0FBQ0MsS0FBSyxDQUFDLENBQUM7Y0FDWi9ILE9BQU8sQ0FBQ1EsSUFBSSxDQUFDOEgsVUFBVSxHQUFHLDZEQUE2RCxDQUFDO2NBQUMsT0FBQXFILFNBQUEsQ0FBQTlWLE1BQUEsV0FDbEYsSUFBSTtZQUFBO2NBR1QwVixZQUFZLEdBQUcsS0FBSztjQUVsQi9DLFFBQVEsR0FBRyxJQUFJdFEsT0FBTyxDQUFDLFVBQUF6RCxPQUFPLEVBQUk7Z0JBQ3RDLElBQU1tWCxZQUFZLEdBQUdDLFdBQVcsQ0FBQyxZQUFNO2tCQUNyQyxJQUFJUixNQUFJLENBQUN2TCxhQUFhLENBQUMyRyxHQUFHLENBQUNuQyxVQUFVLENBQUMsRUFBRTtvQkFDdEN3SCxhQUFhLENBQUNGLFlBQVksQ0FBQztvQkFDM0JuWCxPQUFPLENBQUMsQ0FBQztrQkFDWDtnQkFDRixDQUFDLEVBQUUsSUFBSSxDQUFDO2dCQUVSLElBQU1zWCxPQUFPLEdBQUdoSCxVQUFVLENBQUMsWUFBTTtrQkFDL0IrRyxhQUFhLENBQUNGLFlBQVksQ0FBQztrQkFDM0JMLFlBQVksR0FBRyxJQUFJO2tCQUNuQjlXLE9BQU8sQ0FBQyxDQUFDO2dCQUNYLENBQUMsRUFBRW9JLG9CQUFvQixDQUFDO2dCQUV4QjVELE1BQU0sQ0FBQytPLEVBQUUsQ0FBQyxVQUFVLEVBQUUsWUFBTTtrQkFDMUJwRSxZQUFZLENBQUNtSSxPQUFPLENBQUM7a0JBQ3JCRCxhQUFhLENBQUNGLFlBQVksQ0FBQztrQkFDM0JuWCxPQUFPLENBQUMsQ0FBQztnQkFDWCxDQUFDLENBQUM7Y0FDSixDQUFDLENBQUMsRUFFRjtjQUNBO2NBQUFrWCxTQUFBLENBQUF2VixJQUFBO2NBQUEsT0FDTSxJQUFJLENBQUMyVCxRQUFRLENBQUM5USxNQUFNLEVBQUU7Z0JBQUUrUyxLQUFLLEVBQUUxSDtjQUFXLENBQUMsQ0FBQztZQUFBO2NBQUEsS0FFOUMsSUFBSSxDQUFDeEUsYUFBYSxDQUFDMkcsR0FBRyxDQUFDbkMsVUFBVSxDQUFDO2dCQUFBcUgsU0FBQSxDQUFBdlYsSUFBQTtnQkFBQTtjQUFBO2NBQ3BDME4sSUFBSSxDQUFDQyxLQUFLLENBQUMsQ0FBQztjQUNaL0gsT0FBTyxDQUFDUSxJQUFJLENBQUM4SCxVQUFVLEdBQUcsMkRBQTJELENBQUM7Y0FBQyxPQUFBcUgsU0FBQSxDQUFBOVYsTUFBQSxXQUNoRixJQUFJO1lBQUE7Y0FHYnlHLEtBQUssQ0FBQ2dJLFVBQVUsR0FBRyw0QkFBNEIsQ0FBQztjQUFDcUgsU0FBQSxDQUFBdlYsSUFBQTtjQUFBLE9BQzNDb1MsUUFBUTtZQUFBO2NBQUEsS0FFVixJQUFJLENBQUMxSSxhQUFhLENBQUMyRyxHQUFHLENBQUNuQyxVQUFVLENBQUM7Z0JBQUFxSCxTQUFBLENBQUF2VixJQUFBO2dCQUFBO2NBQUE7Y0FDcEMwTixJQUFJLENBQUNDLEtBQUssQ0FBQyxDQUFDO2NBQ1ovSCxPQUFPLENBQUNRLElBQUksQ0FBQzhILFVBQVUsR0FBRyxzRUFBc0UsQ0FBQztjQUFDLE9BQUFxSCxTQUFBLENBQUE5VixNQUFBLFdBQzNGLElBQUk7WUFBQTtjQUFBLEtBR1QwVixZQUFZO2dCQUFBSSxTQUFBLENBQUF2VixJQUFBO2dCQUFBO2NBQUE7Y0FDZDBOLElBQUksQ0FBQ0MsS0FBSyxDQUFDLENBQUM7Y0FBQyxNQUNUdUgsVUFBVSxHQUFHLENBQUM7Z0JBQUFLLFNBQUEsQ0FBQXZWLElBQUE7Z0JBQUE7Y0FBQTtjQUNoQjRGLE9BQU8sQ0FBQ1EsSUFBSSxDQUFDOEgsVUFBVSxHQUFHLGlDQUFpQyxDQUFDO2NBQUMsT0FBQXFILFNBQUEsQ0FBQTlWLE1BQUEsV0FDdEQsSUFBSSxDQUFDZ1EsZ0JBQWdCLENBQUN2QixVQUFVLEVBQUVnSCxVQUFVLEdBQUcsQ0FBQyxDQUFDO1lBQUE7Y0FFeER0UCxPQUFPLENBQUNRLElBQUksQ0FBQzhILFVBQVUsR0FBRyx1QkFBdUIsQ0FBQztjQUFDLE9BQUFxSCxTQUFBLENBQUE5VixNQUFBLFdBQzVDLElBQUk7WUFBQTtjQUFBLE1BSVg0RyxRQUFRLElBQUksQ0FBQyxJQUFJLENBQUN3UCwwQkFBMEI7Z0JBQUFOLFNBQUEsQ0FBQXZWLElBQUE7Z0JBQUE7Y0FBQTtjQUFBdVYsU0FBQSxDQUFBdlYsSUFBQTtjQUFBLE9BR3ZDLElBQUk4QixPQUFPLENBQUMsVUFBQ3pELE9BQU87Z0JBQUEsT0FBS3NRLFVBQVUsQ0FBQ3RRLE9BQU8sRUFBRSxJQUFJLENBQUM7Y0FBQSxFQUFDO1lBQUE7Y0FDMUQsSUFBSSxDQUFDd1gsMEJBQTBCLEdBQUcsSUFBSTtZQUFDO2NBR3JDbEcsV0FBVyxHQUFHLElBQUltRyxXQUFXLENBQUMsQ0FBQztjQUMvQlYsU0FBUyxHQUFHMUgsSUFBSSxDQUFDcUksWUFBWSxDQUFDLENBQUM7Y0FDbkNYLFNBQVMsQ0FBQ3JYLE9BQU8sQ0FBQyxVQUFBaVksUUFBUSxFQUFJO2dCQUM1QixJQUFJQSxRQUFRLENBQUMvQyxLQUFLLEVBQUU7a0JBQ2xCdEQsV0FBVyxDQUFDdUQsUUFBUSxDQUFDOEMsUUFBUSxDQUFDL0MsS0FBSyxDQUFDO2dCQUN0QztjQUNGLENBQUMsQ0FBQztjQUNGLElBQUl0RCxXQUFXLENBQUNxRCxTQUFTLENBQUMsQ0FBQyxDQUFDL1IsTUFBTSxLQUFLLENBQUMsRUFBRTtnQkFDeEMwTyxXQUFXLEdBQUcsSUFBSTtjQUNwQjtjQUVBekosS0FBSyxDQUFDZ0ksVUFBVSxHQUFHLG9CQUFvQixDQUFDO2NBQUMsT0FBQXFILFNBQUEsQ0FBQTlWLE1BQUEsV0FDbEM7Z0JBQ0xvRCxNQUFNLEVBQU5BLE1BQU07Z0JBQ044TSxXQUFXLEVBQVhBLFdBQVc7Z0JBQ1hqQyxJQUFJLEVBQUpBO2NBQ0YsQ0FBQztZQUFBO1lBQUE7Y0FBQSxPQUFBNkgsU0FBQSxDQUFBOVMsSUFBQTtVQUFBO1FBQUEsR0FBQXVTLFFBQUE7TUFBQSxDQUNGO01BQUEsU0FBQXZGLGlCQUFBd0csR0FBQTtRQUFBLE9BQUFsQixpQkFBQSxDQUFBaFIsS0FBQSxPQUFBRCxTQUFBO01BQUE7TUFBQSxPQUFBMkwsZ0JBQUE7SUFBQTtFQUFBO0lBQUFyVSxHQUFBO0lBQUFFLEtBQUEsRUFFRCxTQUFBcVksU0FBUzlRLE1BQU0sRUFBRXFULFNBQVMsRUFBRTtNQUMxQixPQUFPclQsTUFBTSxDQUFDc1QsV0FBVyxDQUFDO1FBQ3hCQyxJQUFJLEVBQUUsTUFBTTtRQUNaaEQsT0FBTyxFQUFFLElBQUksQ0FBQzNLLElBQUk7UUFDbEI0SyxPQUFPLEVBQUUsSUFBSSxDQUFDM0ssUUFBUTtRQUN0QndOLFNBQVMsRUFBVEEsU0FBUztRQUNURyxLQUFLLEVBQUUsSUFBSSxDQUFDMU47TUFDZCxDQUFDLENBQUM7SUFDSjtFQUFDO0lBQUF2TixHQUFBO0lBQUFFLEtBQUEsRUFFRCxTQUFBZ2IsYUFBQSxFQUFlO01BQ2IsSUFBSSxJQUFJLENBQUNDLE1BQU0sRUFBRTtRQUNmLElBQUksQ0FBQ0MsUUFBUSxDQUFDLENBQUM7TUFDakIsQ0FBQyxNQUFNO1FBQ0wsSUFBSSxDQUFDQyxNQUFNLENBQUMsQ0FBQztNQUNmO0lBQ0Y7RUFBQztJQUFBcmIsR0FBQTtJQUFBRSxLQUFBLEVBRUQsU0FBQW1iLE9BQUEsRUFBUztNQUNQLElBQUksQ0FBQ0YsTUFBTSxHQUFHLElBQUk7SUFDcEI7RUFBQztJQUFBbmIsR0FBQTtJQUFBRSxLQUFBLEVBRUQsU0FBQWtiLFNBQUEsRUFBVztNQUNULElBQUksQ0FBQ0QsTUFBTSxHQUFHLEtBQUs7TUFDbkIsSUFBSSxDQUFDRyxtQkFBbUIsQ0FBQyxDQUFDO0lBQzVCO0VBQUM7SUFBQXRiLEdBQUE7SUFBQUUsS0FBQSxFQUVELFNBQUFxYiwwQkFBMEJDLFNBQVMsRUFBRWxSLE9BQU8sRUFBRTtNQUM1QztNQUNBO01BQ0E7TUFDQSxLQUFLLElBQUl4RSxDQUFDLEdBQUcsQ0FBQyxFQUFFMlYsQ0FBQyxHQUFHblIsT0FBTyxDQUFDd0osSUFBSSxDQUFDNEgsQ0FBQyxDQUFDN1YsTUFBTSxFQUFFQyxDQUFDLEdBQUcyVixDQUFDLEVBQUUzVixDQUFDLEVBQUUsRUFBRTtRQUNyRCxJQUFNZ08sSUFBSSxHQUFHeEosT0FBTyxDQUFDd0osSUFBSSxDQUFDNEgsQ0FBQyxDQUFDNVYsQ0FBQyxDQUFDO1FBRTlCLElBQUlnTyxJQUFJLENBQUMwSCxTQUFTLEtBQUtBLFNBQVMsRUFBRTtVQUNoQyxPQUFPMUgsSUFBSTtRQUNiO01BQ0Y7TUFFQSxPQUFPLElBQUk7SUFDYjtFQUFDO0lBQUE5VCxHQUFBO0lBQUFFLEtBQUEsRUFFRCxTQUFBeWIsZUFBZUgsU0FBUyxFQUFFbFIsT0FBTyxFQUFFO01BQ2pDLElBQUksQ0FBQ0EsT0FBTyxFQUFFLE9BQU8sSUFBSTtNQUV6QixJQUFJd0osSUFBSSxHQUFHeEosT0FBTyxDQUFDc1IsUUFBUSxLQUFLLElBQUksR0FBRyxJQUFJLENBQUNMLHlCQUF5QixDQUFDQyxTQUFTLEVBQUVsUixPQUFPLENBQUMsR0FBR0EsT0FBTyxDQUFDd0osSUFBSTs7TUFFeEc7TUFDQTtNQUNBO01BQ0EsSUFBSUEsSUFBSSxDQUFDK0gsS0FBSyxJQUFJLENBQUMsSUFBSSxDQUFDeE4sU0FBUyxDQUFDeUYsSUFBSSxDQUFDK0gsS0FBSyxDQUFDLEVBQUUsT0FBTyxJQUFJOztNQUUxRDtNQUNBLElBQUkvSCxJQUFJLENBQUMrSCxLQUFLLElBQUksSUFBSSxDQUFDak4sY0FBYyxDQUFDcUcsR0FBRyxDQUFDbkIsSUFBSSxDQUFDK0gsS0FBSyxDQUFDLEVBQUUsT0FBTyxJQUFJO01BRWxFLE9BQU8vSCxJQUFJO0lBQ2I7O0lBRUE7RUFBQTtJQUFBOVQsR0FBQTtJQUFBRSxLQUFBLEVBQ0EsU0FBQTRiLDJCQUEyQk4sU0FBUyxFQUFFO01BQ3BDLE9BQU8sSUFBSSxDQUFDRyxjQUFjLENBQUNILFNBQVMsRUFBRSxJQUFJLENBQUMzTSxhQUFhLENBQUNzRyxHQUFHLENBQUNxRyxTQUFTLENBQUMsQ0FBQztJQUMxRTtFQUFDO0lBQUF4YixHQUFBO0lBQUFFLEtBQUEsRUFFRCxTQUFBb2Isb0JBQUEsRUFBc0I7TUFBQSxJQUFBUyxVQUFBLEdBQUFySCwwQkFBQSxDQUNlLElBQUksQ0FBQzdGLGFBQWE7UUFBQW1OLE1BQUE7TUFBQTtRQUFyRCxLQUFBRCxVQUFBLENBQUFsSCxDQUFBLE1BQUFtSCxNQUFBLEdBQUFELFVBQUEsQ0FBQWpILENBQUEsSUFBQXhRLElBQUEsR0FBdUQ7VUFBQSxJQUFBMlgsWUFBQSxHQUFBQyxjQUFBLENBQUFGLE1BQUEsQ0FBQTliLEtBQUE7WUFBM0NzYixTQUFTLEdBQUFTLFlBQUE7WUFBRTNSLE9BQU8sR0FBQTJSLFlBQUE7VUFDNUIsSUFBSW5JLElBQUksR0FBRyxJQUFJLENBQUM2SCxjQUFjLENBQUNILFNBQVMsRUFBRWxSLE9BQU8sQ0FBQztVQUNsRCxJQUFJLENBQUN3SixJQUFJLEVBQUU7O1VBRVg7VUFDQTtVQUNBLElBQU04SCxRQUFRLEdBQUd0UixPQUFPLENBQUNzUixRQUFRLEtBQUssSUFBSSxHQUFHLEdBQUcsR0FBR3RSLE9BQU8sQ0FBQ3NSLFFBQVE7VUFFbkUsSUFBSSxDQUFDNUssaUJBQWlCLENBQUMsSUFBSSxFQUFFNEssUUFBUSxFQUFFOUgsSUFBSSxFQUFFeEosT0FBTyxDQUFDNlIsTUFBTSxDQUFDO1FBQzlEO01BQUMsU0FBQXBiLEdBQUE7UUFBQWdiLFVBQUEsQ0FBQTFSLENBQUEsQ0FBQXRKLEdBQUE7TUFBQTtRQUFBZ2IsVUFBQSxDQUFBaEgsQ0FBQTtNQUFBO01BQ0QsSUFBSSxDQUFDbEcsYUFBYSxDQUFDeEMsS0FBSyxDQUFDLENBQUM7SUFDNUI7RUFBQztJQUFBck0sR0FBQTtJQUFBRSxLQUFBLEVBRUQsU0FBQWtjLGFBQWE5UixPQUFPLEVBQUU7TUFDcEIsSUFBSUEsT0FBTyxDQUFDc1IsUUFBUSxLQUFLLElBQUksRUFBRTtRQUFFO1FBQy9CLEtBQUssSUFBSTlWLENBQUMsR0FBRyxDQUFDLEVBQUUyVixDQUFDLEdBQUduUixPQUFPLENBQUN3SixJQUFJLENBQUM0SCxDQUFDLENBQUM3VixNQUFNLEVBQUVDLENBQUMsR0FBRzJWLENBQUMsRUFBRTNWLENBQUMsRUFBRSxFQUFFO1VBQ3JELElBQUksQ0FBQ3VXLGtCQUFrQixDQUFDL1IsT0FBTyxFQUFFeEUsQ0FBQyxDQUFDO1FBQ3JDO01BQ0YsQ0FBQyxNQUFNO1FBQ0wsSUFBSSxDQUFDdVcsa0JBQWtCLENBQUMvUixPQUFPLENBQUM7TUFDbEM7SUFDRjtFQUFDO0lBQUF0SyxHQUFBO0lBQUFFLEtBQUEsRUFFRCxTQUFBbWMsbUJBQW1CL1IsT0FBTyxFQUFFZ1MsS0FBSyxFQUFFO01BQ2pDLElBQU14SSxJQUFJLEdBQUd3SSxLQUFLLEtBQUs5WCxTQUFTLEdBQUc4RixPQUFPLENBQUN3SixJQUFJLENBQUM0SCxDQUFDLENBQUNZLEtBQUssQ0FBQyxHQUFHaFMsT0FBTyxDQUFDd0osSUFBSTtNQUN2RSxJQUFNOEgsUUFBUSxHQUFHdFIsT0FBTyxDQUFDc1IsUUFBUTtNQUNqQyxJQUFNTyxNQUFNLEdBQUc3UixPQUFPLENBQUM2UixNQUFNO01BRTdCLElBQU1YLFNBQVMsR0FBRzFILElBQUksQ0FBQzBILFNBQVM7TUFFaEMsSUFBSSxDQUFDLElBQUksQ0FBQzNNLGFBQWEsQ0FBQ29HLEdBQUcsQ0FBQ3VHLFNBQVMsQ0FBQyxFQUFFO1FBQ3RDLElBQUksQ0FBQzNNLGFBQWEsQ0FBQzBOLEdBQUcsQ0FBQ2YsU0FBUyxFQUFFbFIsT0FBTyxDQUFDO01BQzVDLENBQUMsTUFBTTtRQUNMLElBQU1rUyxhQUFhLEdBQUcsSUFBSSxDQUFDM04sYUFBYSxDQUFDc0csR0FBRyxDQUFDcUcsU0FBUyxDQUFDO1FBQ3ZELElBQU1pQixVQUFVLEdBQUdELGFBQWEsQ0FBQ1osUUFBUSxLQUFLLElBQUksR0FBRyxJQUFJLENBQUNMLHlCQUF5QixDQUFDQyxTQUFTLEVBQUVnQixhQUFhLENBQUMsR0FBR0EsYUFBYSxDQUFDMUksSUFBSTs7UUFFbEk7UUFDQSxJQUFNNEksaUJBQWlCLEdBQUc1SSxJQUFJLENBQUM2SSxhQUFhLEdBQUdGLFVBQVUsQ0FBQ0UsYUFBYTtRQUN2RSxJQUFNQyx3QkFBd0IsR0FBRzlJLElBQUksQ0FBQzZJLGFBQWEsS0FBS0YsVUFBVSxDQUFDRSxhQUFhO1FBQ2hGLElBQUlELGlCQUFpQixJQUFLRSx3QkFBd0IsSUFBSUgsVUFBVSxDQUFDWixLQUFLLEdBQUcvSCxJQUFJLENBQUMrSCxLQUFNLEVBQUU7VUFDcEY7UUFDRjtRQUVBLElBQUlELFFBQVEsS0FBSyxHQUFHLEVBQUU7VUFDcEIsSUFBTWlCLGtCQUFrQixHQUFHSixVQUFVLElBQUlBLFVBQVUsQ0FBQ0ssV0FBVztVQUMvRCxJQUFJRCxrQkFBa0IsRUFBRTtZQUN0QjtZQUNBLElBQUksQ0FBQ2hPLGFBQWEsVUFBTyxDQUFDMk0sU0FBUyxDQUFDO1VBQ3RDLENBQUMsTUFBTTtZQUNMO1lBQ0EsSUFBSSxDQUFDM00sYUFBYSxDQUFDME4sR0FBRyxDQUFDZixTQUFTLEVBQUVsUixPQUFPLENBQUM7VUFDNUM7UUFDRixDQUFDLE1BQU07VUFDTDtVQUNBLElBQUltUyxVQUFVLENBQUNNLFVBQVUsSUFBSWpKLElBQUksQ0FBQ2lKLFVBQVUsRUFBRTtZQUM1Q3JkLE1BQU0sQ0FBQ3daLE1BQU0sQ0FBQ3VELFVBQVUsQ0FBQ00sVUFBVSxFQUFFakosSUFBSSxDQUFDaUosVUFBVSxDQUFDO1VBQ3ZEO1FBQ0Y7TUFDRjtJQUNGO0VBQUM7SUFBQS9jLEdBQUE7SUFBQUUsS0FBQSxFQUVELFNBQUFtUCxxQkFBcUJoRixDQUFDLEVBQUU4UixNQUFNLEVBQUU7TUFDOUIsSUFBSSxDQUFDN00sTUFBTSxDQUFDc0UsSUFBSSxDQUFDQyxLQUFLLENBQUN4SixDQUFDLENBQUN5SixJQUFJLENBQUMsRUFBRXFJLE1BQU0sQ0FBQztJQUN6QztFQUFDO0lBQUFuYyxHQUFBO0lBQUFFLEtBQUEsRUFFRCxTQUFBb1AsT0FBT2hGLE9BQU8sRUFBRTZSLE1BQU0sRUFBRTtNQUN0QixJQUFJclIsS0FBSyxDQUFDa1MsT0FBTyxFQUFFO1FBQ2pCbFMsS0FBSyxXQUFBOEcsTUFBQSxDQUFXdEgsT0FBTyxDQUFFLENBQUM7TUFDNUI7TUFFQSxJQUFJLENBQUNBLE9BQU8sQ0FBQ3NSLFFBQVEsRUFBRTtNQUV2QnRSLE9BQU8sQ0FBQzZSLE1BQU0sR0FBR0EsTUFBTTtNQUV2QixJQUFJLElBQUksQ0FBQ2hCLE1BQU0sRUFBRTtRQUNmLElBQUksQ0FBQ2lCLFlBQVksQ0FBQzlSLE9BQU8sQ0FBQztNQUM1QixDQUFDLE1BQU07UUFDTCxJQUFJLENBQUMwRyxpQkFBaUIsQ0FBQyxJQUFJLEVBQUUxRyxPQUFPLENBQUNzUixRQUFRLEVBQUV0UixPQUFPLENBQUN3SixJQUFJLEVBQUV4SixPQUFPLENBQUM2UixNQUFNLENBQUM7TUFDOUU7SUFDRjtFQUFDO0lBQUFuYyxHQUFBO0lBQUFFLEtBQUEsRUFFRCxTQUFBK2Msd0JBQXdCQyxNQUFNLEVBQUU7TUFDOUIsT0FBTyxJQUFJO0lBQ2I7RUFBQztJQUFBbGQsR0FBQTtJQUFBRSxLQUFBLEVBRUQsU0FBQWlkLHNCQUFzQkQsTUFBTSxFQUFFLENBQUM7RUFBQztJQUFBbGQsR0FBQTtJQUFBRSxLQUFBLEVBRWhDLFNBQUFrZCxzQkFBc0JGLE1BQU0sRUFBRSxDQUFDO0VBQUM7SUFBQWxkLEdBQUE7SUFBQUUsS0FBQSxFQUVoQyxTQUFBbWQsaUJBQWlCL1AsUUFBUSxFQUFFO01BQ3pCLE9BQU8sSUFBSSxDQUFDZSxTQUFTLENBQUNmLFFBQVEsQ0FBQyxHQUFHN0MsR0FBRyxDQUFDNlMsUUFBUSxDQUFDQyxZQUFZLEdBQUc5UyxHQUFHLENBQUM2UyxRQUFRLENBQUNFLGFBQWE7SUFDMUY7RUFBQztJQUFBeGQsR0FBQTtJQUFBRSxLQUFBO01BQUEsSUFBQXVkLGlCQUFBLEdBQUFqVixpQkFBQSxlQUFBakosbUJBQUEsR0FBQThHLElBQUEsQ0FFRCxTQUFBcVgsU0FBQTtRQUFBLElBQUFDLE1BQUE7UUFBQSxJQUFBQyxjQUFBLEVBQUEvVCxHQUFBLEVBQUFnVSxTQUFBLEVBQUFDLGtCQUFBLEVBQUFDLGtCQUFBLEVBQUFDLFVBQUEsRUFBQUMsVUFBQTtRQUFBLE9BQUExZSxtQkFBQSxHQUFBeUIsSUFBQSxVQUFBa2QsVUFBQUMsU0FBQTtVQUFBLGtCQUFBQSxTQUFBLENBQUFqWCxJQUFBLEdBQUFpWCxTQUFBLENBQUF2WixJQUFBO1lBQUE7Y0FBQSxLQUNNLElBQUksQ0FBQzhOLGNBQWMsQ0FBQyxDQUFDO2dCQUFBeUwsU0FBQSxDQUFBdlosSUFBQTtnQkFBQTtjQUFBO2NBQUEsT0FBQXVaLFNBQUEsQ0FBQTlaLE1BQUE7WUFBQTtjQUVuQnVaLGNBQWMsR0FBR1EsSUFBSSxDQUFDQyxHQUFHLENBQUMsQ0FBQztjQUFBRixTQUFBLENBQUF2WixJQUFBO2NBQUEsT0FFZjBaLEtBQUssQ0FBQzVSLFFBQVEsQ0FBQzZSLFFBQVEsQ0FBQ0MsSUFBSSxFQUFFO2dCQUM5QzViLE1BQU0sRUFBRSxNQUFNO2dCQUNkNmIsS0FBSyxFQUFFO2NBQ1QsQ0FBQyxDQUFDO1lBQUE7Y0FISTVVLEdBQUcsR0FBQXNVLFNBQUEsQ0FBQWphLElBQUE7Y0FLSDJaLFNBQVMsR0FBRyxJQUFJO2NBQ2hCQyxrQkFBa0IsR0FBRyxJQUFJTSxJQUFJLENBQUN2VSxHQUFHLENBQUM2VSxPQUFPLENBQUN2SixHQUFHLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQ3dKLE9BQU8sQ0FBQyxDQUFDLEdBQUdkLFNBQVMsR0FBRyxDQUFDO2NBQ2hGRSxrQkFBa0IsR0FBR0ssSUFBSSxDQUFDQyxHQUFHLENBQUMsQ0FBQztjQUMvQkwsVUFBVSxHQUFHRixrQkFBa0IsR0FBRyxDQUFDQyxrQkFBa0IsR0FBR0gsY0FBYyxJQUFJLENBQUM7Y0FDM0VLLFVBQVUsR0FBR0QsVUFBVSxHQUFHRCxrQkFBa0I7Y0FFbEQsSUFBSSxDQUFDaFAsa0JBQWtCLEVBQUU7Y0FFekIsSUFBSSxJQUFJLENBQUNBLGtCQUFrQixJQUFJLEVBQUUsRUFBRTtnQkFDakMsSUFBSSxDQUFDRCxXQUFXLENBQUN4SixJQUFJLENBQUMyWSxVQUFVLENBQUM7Y0FDbkMsQ0FBQyxNQUFNO2dCQUNMLElBQUksQ0FBQ25QLFdBQVcsQ0FBQyxJQUFJLENBQUNDLGtCQUFrQixHQUFHLEVBQUUsQ0FBQyxHQUFHa1AsVUFBVTtjQUM3RDtjQUVBLElBQUksQ0FBQ2pQLGFBQWEsR0FBRyxJQUFJLENBQUNGLFdBQVcsQ0FBQzhQLE1BQU0sQ0FBQyxVQUFDQyxHQUFHLEVBQUVDLE1BQU07Z0JBQUEsT0FBTUQsR0FBRyxJQUFJQyxNQUFNO2NBQUEsQ0FBQyxFQUFFLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQ2hRLFdBQVcsQ0FBQ2pKLE1BQU07Y0FFM0csSUFBSSxJQUFJLENBQUNrSixrQkFBa0IsR0FBRyxFQUFFLEVBQUU7Z0JBQ2hDakUsS0FBSyw0QkFBQThHLE1BQUEsQ0FBNEIsSUFBSSxDQUFDNUMsYUFBYSxPQUFJLENBQUM7Z0JBQ3hEdUUsVUFBVSxDQUFDO2tCQUFBLE9BQU1vSyxNQUFJLENBQUN6TCxnQkFBZ0IsQ0FBQyxDQUFDO2dCQUFBLEdBQUUsQ0FBQyxHQUFHLEVBQUUsR0FBRyxJQUFJLENBQUMsQ0FBQyxDQUFDO2NBQzVELENBQUMsTUFBTTtnQkFDTCxJQUFJLENBQUNBLGdCQUFnQixDQUFDLENBQUM7Y0FDekI7WUFBQztZQUFBO2NBQUEsT0FBQWlNLFNBQUEsQ0FBQTlXLElBQUE7VUFBQTtRQUFBLEdBQUFxVyxRQUFBO01BQUEsQ0FDRjtNQUFBLFNBQUF4TCxpQkFBQTtRQUFBLE9BQUF1TCxpQkFBQSxDQUFBOVUsS0FBQSxPQUFBRCxTQUFBO01BQUE7TUFBQSxPQUFBd0osZ0JBQUE7SUFBQTtFQUFBO0lBQUFsUyxHQUFBO0lBQUFFLEtBQUEsRUFFRCxTQUFBNmUsY0FBQSxFQUFnQjtNQUNkLE9BQU9YLElBQUksQ0FBQ0MsR0FBRyxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUNyUCxhQUFhO0lBQ3hDO0VBQUM7SUFBQWhQLEdBQUE7SUFBQUUsS0FBQSxFQUVELFNBQUE4ZSxlQUFlMVIsUUFBUSxFQUFrQjtNQUFBLElBQUEyUixPQUFBO01BQUEsSUFBaEJsZCxJQUFJLEdBQUEyRyxTQUFBLENBQUE3QyxNQUFBLFFBQUE2QyxTQUFBLFFBQUFsRSxTQUFBLEdBQUFrRSxTQUFBLE1BQUcsT0FBTztNQUNyQyxJQUFJLElBQUksQ0FBQzhGLFlBQVksQ0FBQ2xCLFFBQVEsQ0FBQyxFQUFFO1FBQy9CeEMsS0FBSyxnQkFBQThHLE1BQUEsQ0FBZ0I3UCxJQUFJLFdBQUE2UCxNQUFBLENBQVF0RSxRQUFRLENBQUUsQ0FBQztRQUM1QyxPQUFPNUcsT0FBTyxDQUFDekQsT0FBTyxDQUFDLElBQUksQ0FBQ3VMLFlBQVksQ0FBQ2xCLFFBQVEsQ0FBQyxDQUFDdkwsSUFBSSxDQUFDLENBQUM7TUFDM0QsQ0FBQyxNQUFNO1FBQ0wrSSxLQUFLLGVBQUE4RyxNQUFBLENBQWU3UCxJQUFJLFdBQUE2UCxNQUFBLENBQVF0RSxRQUFRLENBQUUsQ0FBQztRQUMzQyxJQUFJLENBQUMsSUFBSSxDQUFDb0Isb0JBQW9CLENBQUN1RyxHQUFHLENBQUMzSCxRQUFRLENBQUMsRUFBRTtVQUM1QyxJQUFJLENBQUNvQixvQkFBb0IsQ0FBQzZOLEdBQUcsQ0FBQ2pQLFFBQVEsRUFBRSxDQUFDLENBQUMsQ0FBQztVQUUzQyxJQUFNNFIsWUFBWSxHQUFHLElBQUl4WSxPQUFPLENBQUMsVUFBQ3pELE9BQU8sRUFBRUMsTUFBTSxFQUFLO1lBQ3BEK2IsT0FBSSxDQUFDdlEsb0JBQW9CLENBQUN5RyxHQUFHLENBQUM3SCxRQUFRLENBQUMsQ0FBQzhILEtBQUssR0FBRztjQUFFblMsT0FBTyxFQUFQQSxPQUFPO2NBQUVDLE1BQU0sRUFBTkE7WUFBTyxDQUFDO1VBQ3JFLENBQUMsQ0FBQztVQUNGLElBQU1pYyxZQUFZLEdBQUcsSUFBSXpZLE9BQU8sQ0FBQyxVQUFDekQsT0FBTyxFQUFFQyxNQUFNLEVBQUs7WUFDcEQrYixPQUFJLENBQUN2USxvQkFBb0IsQ0FBQ3lHLEdBQUcsQ0FBQzdILFFBQVEsQ0FBQyxDQUFDYixLQUFLLEdBQUc7Y0FBRXhKLE9BQU8sRUFBUEEsT0FBTztjQUFFQyxNQUFNLEVBQU5BO1lBQU8sQ0FBQztVQUNyRSxDQUFDLENBQUM7VUFFRixJQUFJLENBQUN3TCxvQkFBb0IsQ0FBQ3lHLEdBQUcsQ0FBQzdILFFBQVEsQ0FBQyxDQUFDOEgsS0FBSyxDQUFDZ0ssT0FBTyxHQUFHRixZQUFZO1VBQ3BFLElBQUksQ0FBQ3hRLG9CQUFvQixDQUFDeUcsR0FBRyxDQUFDN0gsUUFBUSxDQUFDLENBQUNiLEtBQUssQ0FBQzJTLE9BQU8sR0FBR0QsWUFBWTtVQUVwRUQsWUFBWSxTQUFNLENBQUMsVUFBQTdVLENBQUM7WUFBQSxPQUFJRyxPQUFPLENBQUNRLElBQUksSUFBQTRHLE1BQUEsQ0FBSXRFLFFBQVEsa0NBQStCakQsQ0FBQyxDQUFDO1VBQUEsRUFBQztVQUNsRjhVLFlBQVksU0FBTSxDQUFDLFVBQUE5VSxDQUFDO1lBQUEsT0FBSUcsT0FBTyxDQUFDUSxJQUFJLElBQUE0RyxNQUFBLENBQUl0RSxRQUFRLGtDQUErQmpELENBQUMsQ0FBQztVQUFBLEVBQUM7UUFDcEY7UUFDQSxPQUFPLElBQUksQ0FBQ3FFLG9CQUFvQixDQUFDeUcsR0FBRyxDQUFDN0gsUUFBUSxDQUFDLENBQUN2TCxJQUFJLENBQUMsQ0FBQ3FkLE9BQU87TUFDOUQ7SUFDRjtFQUFDO0lBQUFwZixHQUFBO0lBQUFFLEtBQUEsRUFFRCxTQUFBb1UsZUFBZWhILFFBQVEsRUFBRStSLE1BQU0sRUFBRTtNQUMvQjtNQUNBO01BQ0EsSUFBTUMsV0FBVyxHQUFHLElBQUk1RSxXQUFXLENBQUMsQ0FBQztNQUNyQyxJQUFJO1FBQ0oyRSxNQUFNLENBQUNFLGNBQWMsQ0FBQyxDQUFDLENBQUM1YyxPQUFPLENBQUMsVUFBQWtWLEtBQUs7VUFBQSxPQUFJeUgsV0FBVyxDQUFDeEgsUUFBUSxDQUFDRCxLQUFLLENBQUM7UUFBQSxFQUFDO01BRXJFLENBQUMsQ0FBQyxPQUFNeE4sQ0FBQyxFQUFFO1FBQ1RHLE9BQU8sQ0FBQ1EsSUFBSSxJQUFBNEcsTUFBQSxDQUFJdEUsUUFBUSxrQ0FBK0JqRCxDQUFDLENBQUM7TUFDM0Q7TUFDQSxJQUFNbVYsV0FBVyxHQUFHLElBQUk5RSxXQUFXLENBQUMsQ0FBQztNQUNyQyxJQUFJO1FBQ0oyRSxNQUFNLENBQUNJLGNBQWMsQ0FBQyxDQUFDLENBQUM5YyxPQUFPLENBQUMsVUFBQWtWLEtBQUs7VUFBQSxPQUFJMkgsV0FBVyxDQUFDMUgsUUFBUSxDQUFDRCxLQUFLLENBQUM7UUFBQSxFQUFDO01BRXJFLENBQUMsQ0FBQyxPQUFPeE4sQ0FBQyxFQUFFO1FBQ1ZHLE9BQU8sQ0FBQ1EsSUFBSSxJQUFBNEcsTUFBQSxDQUFJdEUsUUFBUSxrQ0FBK0JqRCxDQUFDLENBQUM7TUFDM0Q7TUFFQSxJQUFJLENBQUNtRSxZQUFZLENBQUNsQixRQUFRLENBQUMsR0FBRztRQUFFOEgsS0FBSyxFQUFFa0ssV0FBVztRQUFFN1MsS0FBSyxFQUFFK1M7TUFBWSxDQUFDOztNQUV4RTtNQUNBLElBQUksSUFBSSxDQUFDOVEsb0JBQW9CLENBQUN1RyxHQUFHLENBQUMzSCxRQUFRLENBQUMsRUFBRTtRQUMzQyxJQUFJLENBQUNvQixvQkFBb0IsQ0FBQ3lHLEdBQUcsQ0FBQzdILFFBQVEsQ0FBQyxDQUFDOEgsS0FBSyxDQUFDblMsT0FBTyxDQUFDcWMsV0FBVyxDQUFDO1FBQ2xFLElBQUksQ0FBQzVRLG9CQUFvQixDQUFDeUcsR0FBRyxDQUFDN0gsUUFBUSxDQUFDLENBQUNiLEtBQUssQ0FBQ3hKLE9BQU8sQ0FBQ3VjLFdBQVcsQ0FBQztNQUNwRTtJQUNGO0VBQUM7SUFBQXhmLEdBQUE7SUFBQUUsS0FBQTtNQUFBLElBQUF3ZixvQkFBQSxHQUFBbFgsaUJBQUEsZUFBQWpKLG1CQUFBLEdBQUE4RyxJQUFBLENBRUQsU0FBQXNaLFNBQTBCTixNQUFNO1FBQUEsSUFBQU8sT0FBQTtRQUFBLElBQUFDLGVBQUEsRUFBQUMsVUFBQSxFQUFBQyxNQUFBLEVBQUFDLEtBQUEsRUFBQWxhLENBQUE7UUFBQSxPQUFBdkcsbUJBQUEsR0FBQXlCLElBQUEsVUFBQWlmLFVBQUFDLFNBQUE7VUFBQSxrQkFBQUEsU0FBQSxDQUFBaFosSUFBQSxHQUFBZ1osU0FBQSxDQUFBdGIsSUFBQTtZQUFBO2NBQUEsTUFRMUIsSUFBSSxDQUFDd0osU0FBUyxJQUFJLElBQUksQ0FBQ0EsU0FBUyxDQUFDa0UsSUFBSTtnQkFBQTROLFNBQUEsQ0FBQXRiLElBQUE7Z0JBQUE7Y0FBQTtjQUNqQ2liLGVBQWUsR0FBRyxJQUFJLENBQUN6UixTQUFTLENBQUNrRSxJQUFJLENBQUM2TixVQUFVLENBQUMsQ0FBQztjQUNsREwsVUFBVSxHQUFHLEVBQUU7Y0FDZkMsTUFBTSxHQUFHVixNQUFNLENBQUN6SCxTQUFTLENBQUMsQ0FBQztjQUFBb0ksS0FBQSxnQkFBQXpnQixtQkFBQSxHQUFBOEcsSUFBQSxVQUFBMlosTUFBQTtnQkFBQSxJQUFBSSxDQUFBLEVBQUFDLE1BQUE7Z0JBQUEsT0FBQTlnQixtQkFBQSxHQUFBeUIsSUFBQSxVQUFBc2YsT0FBQUMsU0FBQTtrQkFBQSxrQkFBQUEsU0FBQSxDQUFBclosSUFBQSxHQUFBcVosU0FBQSxDQUFBM2IsSUFBQTtvQkFBQTtzQkFHekJ3YixDQUFDLEdBQUdMLE1BQU0sQ0FBQ2phLENBQUMsQ0FBQztzQkFDYnVhLE1BQU0sR0FBR1IsZUFBZSxDQUFDVyxJQUFJLENBQUMsVUFBQTNMLENBQUM7d0JBQUEsT0FBSUEsQ0FBQyxDQUFDZ0QsS0FBSyxJQUFJLElBQUksSUFBSWhELENBQUMsQ0FBQ2dELEtBQUssQ0FBQ21ELElBQUksSUFBSW9GLENBQUMsQ0FBQ3BGLElBQUk7c0JBQUEsRUFBQztzQkFBQSxNQUUvRXFGLE1BQU0sSUFBSSxJQUFJO3dCQUFBRSxTQUFBLENBQUEzYixJQUFBO3dCQUFBO3NCQUFBO3NCQUFBLEtBQ1p5YixNQUFNLENBQUNJLFlBQVk7d0JBQUFGLFNBQUEsQ0FBQTNiLElBQUE7d0JBQUE7c0JBQUE7c0JBQUEyYixTQUFBLENBQUEzYixJQUFBO3NCQUFBLE9BQ2Z5YixNQUFNLENBQUNJLFlBQVksQ0FBQ0wsQ0FBQyxDQUFDO29CQUFBO3NCQUU1QjtzQkFDQSxJQUFJQSxDQUFDLENBQUNwRixJQUFJLEtBQUssT0FBTyxJQUFJb0YsQ0FBQyxDQUFDcEQsT0FBTyxJQUFJN1IsU0FBUyxDQUFDQyxTQUFTLENBQUNzVixXQUFXLENBQUMsQ0FBQyxDQUFDblcsT0FBTyxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFO3dCQUNoRzZWLENBQUMsQ0FBQ3BELE9BQU8sR0FBRyxLQUFLO3dCQUNqQnpKLFVBQVUsQ0FBQzswQkFBQSxPQUFNNk0sQ0FBQyxDQUFDcEQsT0FBTyxHQUFHLElBQUk7d0JBQUEsR0FBRSxJQUFJLENBQUM7c0JBQzFDO3NCQUFDdUQsU0FBQSxDQUFBM2IsSUFBQTtzQkFBQTtvQkFBQTtzQkFFRDtzQkFDQTtzQkFDQTtzQkFDQXlhLE1BQU0sQ0FBQ3NCLFdBQVcsQ0FBQ04sTUFBTSxDQUFDeEksS0FBSyxDQUFDO3NCQUNoQ3dILE1BQU0sQ0FBQ3ZILFFBQVEsQ0FBQ3NJLENBQUMsQ0FBQztvQkFBQztzQkFFckJOLFVBQVUsQ0FBQ3hhLElBQUksQ0FBQythLE1BQU0sQ0FBQztzQkFBQ0UsU0FBQSxDQUFBM2IsSUFBQTtzQkFBQTtvQkFBQTtzQkFFeEJrYixVQUFVLENBQUN4YSxJQUFJLENBQUNzYSxPQUFJLENBQUN4UixTQUFTLENBQUNrRSxJQUFJLENBQUN3RixRQUFRLENBQUNzSSxDQUFDLEVBQUVmLE1BQU0sQ0FBQyxDQUFDO29CQUFDO29CQUFBO3NCQUFBLE9BQUFrQixTQUFBLENBQUFsWixJQUFBO2tCQUFBO2dCQUFBLEdBQUEyWSxLQUFBO2NBQUE7Y0F0QnBEbGEsQ0FBQyxHQUFHLENBQUM7WUFBQTtjQUFBLE1BQUVBLENBQUMsR0FBR2lhLE1BQU0sQ0FBQ2xhLE1BQU07Z0JBQUFxYSxTQUFBLENBQUF0YixJQUFBO2dCQUFBO2NBQUE7Y0FBQSxPQUFBc2IsU0FBQSxDQUFBL1gsYUFBQSxDQUFBNlgsS0FBQTtZQUFBO2NBQUVsYSxDQUFDLEVBQUU7Y0FBQW9hLFNBQUEsQ0FBQXRiLElBQUE7Y0FBQTtZQUFBO2NBeUJ0Q2liLGVBQWUsQ0FBQ2xkLE9BQU8sQ0FBQyxVQUFBa1MsQ0FBQyxFQUFJO2dCQUMzQixJQUFJLENBQUNpTCxVQUFVLENBQUNsSCxRQUFRLENBQUMvRCxDQUFDLENBQUMsRUFBRTtrQkFDM0JBLENBQUMsQ0FBQ2dELEtBQUssQ0FBQ21GLE9BQU8sR0FBRyxLQUFLO2dCQUN6QjtjQUNGLENBQUMsQ0FBQztZQUFDO2NBRUwsSUFBSSxDQUFDdk8sZ0JBQWdCLEdBQUc0USxNQUFNO2NBQzlCLElBQUksQ0FBQy9LLGNBQWMsQ0FBQyxJQUFJLENBQUNoSCxRQUFRLEVBQUUrUixNQUFNLENBQUM7WUFBQztZQUFBO2NBQUEsT0FBQWEsU0FBQSxDQUFBN1ksSUFBQTtVQUFBO1FBQUEsR0FBQXNZLFFBQUE7TUFBQSxDQUM1QztNQUFBLFNBQUFpQixvQkFBQUMsR0FBQTtRQUFBLE9BQUFuQixvQkFBQSxDQUFBL1csS0FBQSxPQUFBRCxTQUFBO01BQUE7TUFBQSxPQUFBa1ksbUJBQUE7SUFBQTtFQUFBO0lBQUE1Z0IsR0FBQTtJQUFBRSxLQUFBLEVBRUQsU0FBQTRnQixpQkFBaUI5RCxPQUFPLEVBQUU7TUFDeEIsSUFBSSxJQUFJLENBQUM1TyxTQUFTLElBQUksSUFBSSxDQUFDQSxTQUFTLENBQUNrRSxJQUFJLEVBQUU7UUFDekMsSUFBSSxDQUFDbEUsU0FBUyxDQUFDa0UsSUFBSSxDQUFDNk4sVUFBVSxDQUFDLENBQUMsQ0FBQ3hkLE9BQU8sQ0FBQyxVQUFBa1MsQ0FBQyxFQUFJO1VBQzVDLElBQUlBLENBQUMsQ0FBQ2dELEtBQUssQ0FBQ21ELElBQUksSUFBSSxPQUFPLEVBQUU7WUFDM0JuRyxDQUFDLENBQUNnRCxLQUFLLENBQUNtRixPQUFPLEdBQUdBLE9BQU87VUFDM0I7UUFDRixDQUFDLENBQUM7TUFDSjtJQUNGO0VBQUM7SUFBQWhkLEdBQUE7SUFBQUUsS0FBQSxFQUVELFNBQUE2Z0IsU0FBU3pULFFBQVEsRUFBRXNPLFFBQVEsRUFBRTlILElBQUksRUFBRTtNQUNqQyxJQUFJLENBQUMsSUFBSSxDQUFDMUYsU0FBUyxFQUFFO1FBQ25CNUQsT0FBTyxDQUFDUSxJQUFJLENBQUMscUNBQXFDLENBQUM7TUFDckQsQ0FBQyxNQUFNO1FBQ0wsUUFBUSxJQUFJLENBQUM4QyxtQkFBbUI7VUFDOUIsS0FBSyxXQUFXO1lBQ2QsSUFBSSxDQUFDTSxTQUFTLENBQUMzRyxNQUFNLENBQUNzVCxXQUFXLENBQUM7Y0FBRUMsSUFBSSxFQUFFLE1BQU07Y0FBRTlDLElBQUksRUFBRXRFLElBQUksQ0FBQ29OLFNBQVMsQ0FBQztnQkFBRXBGLFFBQVEsRUFBUkEsUUFBUTtnQkFBRTlILElBQUksRUFBSkE7Y0FBSyxDQUFDLENBQUM7Y0FBRW1OLElBQUksRUFBRTNUO1lBQVMsQ0FBQyxDQUFDO1lBQzdHO1VBQ0YsS0FBSyxhQUFhO1lBQ2hCLElBQUksQ0FBQ2MsU0FBUyxDQUFDOEksaUJBQWlCLENBQUMvTSxJQUFJLENBQUN5SixJQUFJLENBQUNvTixTQUFTLENBQUM7Y0FBRTFULFFBQVEsRUFBUkEsUUFBUTtjQUFFc08sUUFBUSxFQUFSQSxRQUFRO2NBQUU5SCxJQUFJLEVBQUpBO1lBQUssQ0FBQyxDQUFDLENBQUM7WUFDbkY7VUFDRjtZQUNFLElBQUksQ0FBQ2hHLG1CQUFtQixDQUFDUixRQUFRLEVBQUVzTyxRQUFRLEVBQUU5SCxJQUFJLENBQUM7WUFDbEQ7UUFDSjtNQUNGO0lBQ0Y7RUFBQztJQUFBOVQsR0FBQTtJQUFBRSxLQUFBLEVBRUQsU0FBQWdoQixtQkFBbUI1VCxRQUFRLEVBQUVzTyxRQUFRLEVBQUU5SCxJQUFJLEVBQUU7TUFDM0MsSUFBSSxDQUFDLElBQUksQ0FBQzFGLFNBQVMsRUFBRTtRQUNuQjVELE9BQU8sQ0FBQ1EsSUFBSSxDQUFDLCtDQUErQyxDQUFDO01BQy9ELENBQUMsTUFBTTtRQUNMLFFBQVEsSUFBSSxDQUFDNkMsaUJBQWlCO1VBQzVCLEtBQUssV0FBVztZQUNkLElBQUksQ0FBQ08sU0FBUyxDQUFDM0csTUFBTSxDQUFDc1QsV0FBVyxDQUFDO2NBQUVDLElBQUksRUFBRSxNQUFNO2NBQUU5QyxJQUFJLEVBQUV0RSxJQUFJLENBQUNvTixTQUFTLENBQUM7Z0JBQUVwRixRQUFRLEVBQVJBLFFBQVE7Z0JBQUU5SCxJQUFJLEVBQUpBO2NBQUssQ0FBQyxDQUFDO2NBQUVtTixJQUFJLEVBQUUzVDtZQUFTLENBQUMsQ0FBQztZQUM3RztVQUNGLEtBQUssYUFBYTtZQUNoQixJQUFJLENBQUNjLFNBQVMsQ0FBQzZJLGVBQWUsQ0FBQzlNLElBQUksQ0FBQ3lKLElBQUksQ0FBQ29OLFNBQVMsQ0FBQztjQUFFMVQsUUFBUSxFQUFSQSxRQUFRO2NBQUVzTyxRQUFRLEVBQVJBLFFBQVE7Y0FBRTlILElBQUksRUFBSkE7WUFBSyxDQUFDLENBQUMsQ0FBQztZQUNqRjtVQUNGO1lBQ0UsSUFBSSxDQUFDakcsaUJBQWlCLENBQUNQLFFBQVEsRUFBRXNPLFFBQVEsRUFBRTlILElBQUksQ0FBQztZQUNoRDtRQUNKO01BQ0Y7SUFDRjtFQUFDO0lBQUE5VCxHQUFBO0lBQUFFLEtBQUEsRUFFRCxTQUFBaWhCLGNBQWN2RixRQUFRLEVBQUU5SCxJQUFJLEVBQUU7TUFDNUIsSUFBSSxDQUFDLElBQUksQ0FBQzFGLFNBQVMsRUFBRTtRQUNuQjVELE9BQU8sQ0FBQ1EsSUFBSSxDQUFDLDBDQUEwQyxDQUFDO01BQzFELENBQUMsTUFBTTtRQUNMLFFBQVEsSUFBSSxDQUFDOEMsbUJBQW1CO1VBQzlCLEtBQUssV0FBVztZQUNkLElBQUksQ0FBQ00sU0FBUyxDQUFDM0csTUFBTSxDQUFDc1QsV0FBVyxDQUFDO2NBQUVDLElBQUksRUFBRSxNQUFNO2NBQUU5QyxJQUFJLEVBQUV0RSxJQUFJLENBQUNvTixTQUFTLENBQUM7Z0JBQUVwRixRQUFRLEVBQVJBLFFBQVE7Z0JBQUU5SCxJQUFJLEVBQUpBO2NBQUssQ0FBQztZQUFFLENBQUMsQ0FBQztZQUM3RjtVQUNGLEtBQUssYUFBYTtZQUNoQixJQUFJLENBQUMxRixTQUFTLENBQUM4SSxpQkFBaUIsQ0FBQy9NLElBQUksQ0FBQ3lKLElBQUksQ0FBQ29OLFNBQVMsQ0FBQztjQUFFcEYsUUFBUSxFQUFSQSxRQUFRO2NBQUU5SCxJQUFJLEVBQUpBO1lBQUssQ0FBQyxDQUFDLENBQUM7WUFDekU7VUFDRjtZQUNFLElBQUksQ0FBQ2hHLG1CQUFtQixDQUFDdEosU0FBUyxFQUFFb1gsUUFBUSxFQUFFOUgsSUFBSSxDQUFDO1lBQ25EO1FBQ0o7TUFDRjtJQUNGO0VBQUM7SUFBQTlULEdBQUE7SUFBQUUsS0FBQSxFQUVELFNBQUFraEIsd0JBQXdCeEYsUUFBUSxFQUFFOUgsSUFBSSxFQUFFO01BQ3RDLElBQUksQ0FBQyxJQUFJLENBQUMxRixTQUFTLEVBQUU7UUFDbkI1RCxPQUFPLENBQUNRLElBQUksQ0FBQyxvREFBb0QsQ0FBQztNQUNwRSxDQUFDLE1BQU07UUFDTCxRQUFRLElBQUksQ0FBQzZDLGlCQUFpQjtVQUM1QixLQUFLLFdBQVc7WUFDZCxJQUFJLENBQUNPLFNBQVMsQ0FBQzNHLE1BQU0sQ0FBQ3NULFdBQVcsQ0FBQztjQUFFQyxJQUFJLEVBQUUsTUFBTTtjQUFFOUMsSUFBSSxFQUFFdEUsSUFBSSxDQUFDb04sU0FBUyxDQUFDO2dCQUFFcEYsUUFBUSxFQUFSQSxRQUFRO2dCQUFFOUgsSUFBSSxFQUFKQTtjQUFLLENBQUM7WUFBRSxDQUFDLENBQUM7WUFDN0Y7VUFDRixLQUFLLGFBQWE7WUFDaEIsSUFBSSxDQUFDMUYsU0FBUyxDQUFDNkksZUFBZSxDQUFDOU0sSUFBSSxDQUFDeUosSUFBSSxDQUFDb04sU0FBUyxDQUFDO2NBQUVwRixRQUFRLEVBQVJBLFFBQVE7Y0FBRTlILElBQUksRUFBSkE7WUFBSyxDQUFDLENBQUMsQ0FBQztZQUN2RTtVQUNGO1lBQ0UsSUFBSSxDQUFDakcsaUJBQWlCLENBQUNySixTQUFTLEVBQUVvWCxRQUFRLEVBQUU5SCxJQUFJLENBQUM7WUFDakQ7UUFDSjtNQUNGO0lBQ0Y7RUFBQztJQUFBOVQsR0FBQTtJQUFBRSxLQUFBLEVBRUQsU0FBQW1oQixLQUFLL1QsUUFBUSxFQUFFZ1UsVUFBVSxFQUFFO01BQ3pCLE9BQU8sSUFBSSxDQUFDbFQsU0FBUyxDQUFDM0csTUFBTSxDQUFDc1QsV0FBVyxDQUFDO1FBQUVDLElBQUksRUFBRSxNQUFNO1FBQUVoRCxPQUFPLEVBQUUsSUFBSSxDQUFDM0ssSUFBSTtRQUFFNEssT0FBTyxFQUFFM0ssUUFBUTtRQUFFMk4sS0FBSyxFQUFFcUc7TUFBVyxDQUFDLENBQUMsQ0FBQy9kLElBQUksQ0FBQyxZQUFNO1FBQzlIbUosUUFBUSxDQUFDd0wsSUFBSSxDQUFDQyxhQUFhLENBQUMsSUFBSUMsV0FBVyxDQUFDLFFBQVEsRUFBRTtVQUFFQyxNQUFNLEVBQUU7WUFBRS9LLFFBQVEsRUFBRUE7VUFBUztRQUFFLENBQUMsQ0FBQyxDQUFDO01BQzVGLENBQUMsQ0FBQztJQUNKO0VBQUM7SUFBQXROLEdBQUE7SUFBQUUsS0FBQSxFQUVELFNBQUFxaEIsTUFBTWpVLFFBQVEsRUFBRTtNQUFBLElBQUFrVSxPQUFBO01BQ2QsT0FBTyxJQUFJLENBQUNwVCxTQUFTLENBQUMzRyxNQUFNLENBQUNzVCxXQUFXLENBQUM7UUFBRUMsSUFBSSxFQUFFLE9BQU87UUFBRWlHLElBQUksRUFBRTNUO01BQVMsQ0FBQyxDQUFDLENBQUMvSixJQUFJLENBQUMsWUFBTTtRQUNyRmllLE9BQUksQ0FBQzVTLGNBQWMsQ0FBQzJOLEdBQUcsQ0FBQ2pQLFFBQVEsRUFBRSxJQUFJLENBQUM7UUFDdkNaLFFBQVEsQ0FBQ3dMLElBQUksQ0FBQ0MsYUFBYSxDQUFDLElBQUlDLFdBQVcsQ0FBQyxTQUFTLEVBQUU7VUFBRUMsTUFBTSxFQUFFO1lBQUUvSyxRQUFRLEVBQUVBO1VBQVM7UUFBRSxDQUFDLENBQUMsQ0FBQztNQUM3RixDQUFDLENBQUM7SUFDSjtFQUFDO0lBQUF0TixHQUFBO0lBQUFFLEtBQUEsRUFFRCxTQUFBdWhCLFFBQVFuVSxRQUFRLEVBQUU7TUFBQSxJQUFBb1UsT0FBQTtNQUNoQixPQUFPLElBQUksQ0FBQ3RULFNBQVMsQ0FBQzNHLE1BQU0sQ0FBQ3NULFdBQVcsQ0FBQztRQUFFQyxJQUFJLEVBQUUsU0FBUztRQUFFaUcsSUFBSSxFQUFFM1Q7TUFBUyxDQUFDLENBQUMsQ0FBQy9KLElBQUksQ0FBQyxZQUFNO1FBQ3ZGbWUsT0FBSSxDQUFDOVMsY0FBYyxVQUFPLENBQUN0QixRQUFRLENBQUM7UUFDcENaLFFBQVEsQ0FBQ3dMLElBQUksQ0FBQ0MsYUFBYSxDQUFDLElBQUlDLFdBQVcsQ0FBQyxXQUFXLEVBQUU7VUFBRUMsTUFBTSxFQUFFO1lBQUUvSyxRQUFRLEVBQUVBO1VBQVM7UUFBRSxDQUFDLENBQUMsQ0FBQztNQUMvRixDQUFDLENBQUM7SUFDSjtFQUFDO0VBQUEsT0FBQUYsWUFBQTtBQUFBO0FBR0gzQyxHQUFHLENBQUM2UyxRQUFRLENBQUNxRSxRQUFRLENBQUMsT0FBTyxFQUFFdlUsWUFBWSxDQUFDO0FBRTVDd1UsTUFBTSxDQUFDcGlCLE9BQU8sR0FBRzROLFlBQVk7Ozs7Ozs7Ozs7O0FDdmpDN0I7QUFDYTs7QUFFYjtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxJQUFJO0FBQ0o7QUFDQTs7QUFFQTtBQUNBO0FBQ0EsZ0JBQWdCLG9CQUFvQjtBQUNwQztBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLGtCQUFrQixrQkFBa0I7QUFDcEM7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLHdDQUF3QztBQUN4QztBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0EsSUFBSTtBQUNKO0FBQ0EsSUFBSTtBQUNKO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTs7QUFFQTtBQUNBLDZDQUE2QztBQUM3QztBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQSxvQkFBb0I7QUFDcEIsMkJBQTJCO0FBQzNCO0FBQ0E7QUFDQTtBQUNBLDhEQUE4RDtBQUM5RCxrQkFBa0Isa0JBQWtCO0FBQ3BDO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsUUFBUTtBQUNSO0FBQ0E7QUFDQSxLQUFLO0FBQ0wsaURBQWlEO0FBQ2pEO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxLQUFLO0FBQ0w7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxJQUFJO0FBQ0o7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEdBQUc7QUFDSDtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLGtCQUFrQixrQkFBa0IsT0FBTztBQUMzQztBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsR0FBRztBQUNIO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsT0FBTztBQUNQO0FBQ0E7QUFDQTtBQUNBLEtBQUs7QUFDTCxHQUFHO0FBQ0g7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQSw2Q0FBNkM7QUFDN0M7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsR0FBRzs7QUFFSDtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxHQUFHO0FBQ0g7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEdBQUc7QUFDSDtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0EsS0FBSztBQUNMO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEtBQUs7QUFDTDtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSx3QkFBd0I7QUFDeEI7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEdBQUc7QUFDSDtBQUNBO0FBQ0E7QUFDQSxLQUFLO0FBQ0w7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLE1BQU07QUFDTjtBQUNBO0FBQ0E7QUFDQSxNQUFNO0FBQ047QUFDQTtBQUNBO0FBQ0E7QUFDQSxLQUFLO0FBQ0w7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQUdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsWUFBWTtBQUNaO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLFlBQVk7QUFDWjtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLElBQUk7QUFDSjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsSUFBSTtBQUNKO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0Esa0JBQWtCLGtCQUFrQjtBQUNwQztBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLGtCQUFrQixrQkFBa0I7QUFDcEM7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQSxJQUFJLElBQTBCO0FBQzlCO0FBQ0E7Ozs7Ozs7VUNqeUJBO1VBQ0E7O1VBRUE7VUFDQTtVQUNBO1VBQ0E7VUFDQTtVQUNBO1VBQ0E7VUFDQTtVQUNBO1VBQ0E7VUFDQTtVQUNBO1VBQ0E7O1VBRUE7VUFDQTs7VUFFQTtVQUNBO1VBQ0E7Ozs7VUV0QkE7VUFDQTtVQUNBO1VBQ0EiLCJzb3VyY2VzIjpbIndlYnBhY2s6Ly9AbmV0d29ya2VkLWFmcmFtZS9uYWYtamFudXMtYWRhcHRlci8uL25vZGVfbW9kdWxlcy9AbmV0d29ya2VkLWFmcmFtZS9taW5pamFudXMvbWluaWphbnVzLmpzIiwid2VicGFjazovL0BuZXR3b3JrZWQtYWZyYW1lL25hZi1qYW51cy1hZGFwdGVyLy4vc3JjL2luZGV4LmpzIiwid2VicGFjazovL0BuZXR3b3JrZWQtYWZyYW1lL25hZi1qYW51cy1hZGFwdGVyLy4vbm9kZV9tb2R1bGVzL3NkcC9zZHAuanMiLCJ3ZWJwYWNrOi8vQG5ldHdvcmtlZC1hZnJhbWUvbmFmLWphbnVzLWFkYXB0ZXIvd2VicGFjay9ib290c3RyYXAiLCJ3ZWJwYWNrOi8vQG5ldHdvcmtlZC1hZnJhbWUvbmFmLWphbnVzLWFkYXB0ZXIvd2VicGFjay9iZWZvcmUtc3RhcnR1cCIsIndlYnBhY2s6Ly9AbmV0d29ya2VkLWFmcmFtZS9uYWYtamFudXMtYWRhcHRlci93ZWJwYWNrL3N0YXJ0dXAiLCJ3ZWJwYWNrOi8vQG5ldHdvcmtlZC1hZnJhbWUvbmFmLWphbnVzLWFkYXB0ZXIvd2VicGFjay9hZnRlci1zdGFydHVwIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogUmVwcmVzZW50cyBhIGhhbmRsZSB0byBhIHNpbmdsZSBKYW51cyBwbHVnaW4gb24gYSBKYW51cyBzZXNzaW9uLiBFYWNoIFdlYlJUQyBjb25uZWN0aW9uIHRvIHRoZSBKYW51cyBzZXJ2ZXIgd2lsbCBiZVxuICogYXNzb2NpYXRlZCB3aXRoIGEgc2luZ2xlIGhhbmRsZS4gT25jZSBhdHRhY2hlZCB0byB0aGUgc2VydmVyLCB0aGlzIGhhbmRsZSB3aWxsIGJlIGdpdmVuIGEgdW5pcXVlIElEIHdoaWNoIHNob3VsZCBiZVxuICogdXNlZCB0byBhc3NvY2lhdGUgaXQgd2l0aCBmdXR1cmUgc2lnbmFsbGluZyBtZXNzYWdlcy5cbiAqXG4gKiBTZWUgaHR0cHM6Ly9qYW51cy5jb25mLm1lZXRlY2hvLmNvbS9kb2NzL3Jlc3QuaHRtbCNoYW5kbGVzLlxuICoqL1xuZnVuY3Rpb24gSmFudXNQbHVnaW5IYW5kbGUoc2Vzc2lvbikge1xuICB0aGlzLnNlc3Npb24gPSBzZXNzaW9uO1xuICB0aGlzLmlkID0gdW5kZWZpbmVkO1xufVxuXG4vKiogQXR0YWNoZXMgdGhpcyBoYW5kbGUgdG8gdGhlIEphbnVzIHNlcnZlciBhbmQgc2V0cyBpdHMgSUQuICoqL1xuSmFudXNQbHVnaW5IYW5kbGUucHJvdG90eXBlLmF0dGFjaCA9IGZ1bmN0aW9uKHBsdWdpbiwgbG9vcF9pbmRleCkge1xuICB2YXIgcGF5bG9hZCA9IHsgcGx1Z2luOiBwbHVnaW4sIGxvb3BfaW5kZXg6IGxvb3BfaW5kZXgsIFwiZm9yY2UtYnVuZGxlXCI6IHRydWUsIFwiZm9yY2UtcnRjcC1tdXhcIjogdHJ1ZSB9O1xuICByZXR1cm4gdGhpcy5zZXNzaW9uLnNlbmQoXCJhdHRhY2hcIiwgcGF5bG9hZCkudGhlbihyZXNwID0+IHtcbiAgICB0aGlzLmlkID0gcmVzcC5kYXRhLmlkO1xuICAgIHJldHVybiByZXNwO1xuICB9KTtcbn07XG5cbi8qKiBEZXRhY2hlcyB0aGlzIGhhbmRsZS4gKiovXG5KYW51c1BsdWdpbkhhbmRsZS5wcm90b3R5cGUuZGV0YWNoID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLnNlbmQoXCJkZXRhY2hcIik7XG59O1xuXG4vKiogUmVnaXN0ZXJzIGEgY2FsbGJhY2sgdG8gYmUgZmlyZWQgdXBvbiB0aGUgcmVjZXB0aW9uIG9mIGFueSBpbmNvbWluZyBKYW51cyBzaWduYWxzIGZvciB0aGlzIHBsdWdpbiBoYW5kbGUgd2l0aCB0aGVcbiAqIGBqYW51c2AgYXR0cmlidXRlIGVxdWFsIHRvIGBldmAuXG4gKiovXG5KYW51c1BsdWdpbkhhbmRsZS5wcm90b3R5cGUub24gPSBmdW5jdGlvbihldiwgY2FsbGJhY2spIHtcbiAgcmV0dXJuIHRoaXMuc2Vzc2lvbi5vbihldiwgc2lnbmFsID0+IHtcbiAgICBpZiAoc2lnbmFsLnNlbmRlciA9PSB0aGlzLmlkKSB7XG4gICAgICBjYWxsYmFjayhzaWduYWwpO1xuICAgIH1cbiAgfSk7XG59O1xuXG4vKipcbiAqIFNlbmRzIGEgc2lnbmFsIGFzc29jaWF0ZWQgd2l0aCB0aGlzIGhhbmRsZS4gU2lnbmFscyBzaG91bGQgYmUgSlNPTi1zZXJpYWxpemFibGUgb2JqZWN0cy4gUmV0dXJucyBhIHByb21pc2UgdGhhdCB3aWxsXG4gKiBiZSByZXNvbHZlZCBvciByZWplY3RlZCB3aGVuIGEgcmVzcG9uc2UgdG8gdGhpcyBzaWduYWwgaXMgcmVjZWl2ZWQsIG9yIHdoZW4gbm8gcmVzcG9uc2UgaXMgcmVjZWl2ZWQgd2l0aGluIHRoZVxuICogc2Vzc2lvbiB0aW1lb3V0LlxuICoqL1xuSmFudXNQbHVnaW5IYW5kbGUucHJvdG90eXBlLnNlbmQgPSBmdW5jdGlvbih0eXBlLCBzaWduYWwpIHtcbiAgcmV0dXJuIHRoaXMuc2Vzc2lvbi5zZW5kKHR5cGUsIE9iamVjdC5hc3NpZ24oeyBoYW5kbGVfaWQ6IHRoaXMuaWQgfSwgc2lnbmFsKSk7XG59O1xuXG4vKiogU2VuZHMgYSBwbHVnaW4tc3BlY2lmaWMgbWVzc2FnZSBhc3NvY2lhdGVkIHdpdGggdGhpcyBoYW5kbGUuICoqL1xuSmFudXNQbHVnaW5IYW5kbGUucHJvdG90eXBlLnNlbmRNZXNzYWdlID0gZnVuY3Rpb24oYm9keSkge1xuICByZXR1cm4gdGhpcy5zZW5kKFwibWVzc2FnZVwiLCB7IGJvZHk6IGJvZHkgfSk7XG59O1xuXG4vKiogU2VuZHMgYSBKU0VQIG9mZmVyIG9yIGFuc3dlciBhc3NvY2lhdGVkIHdpdGggdGhpcyBoYW5kbGUuICoqL1xuSmFudXNQbHVnaW5IYW5kbGUucHJvdG90eXBlLnNlbmRKc2VwID0gZnVuY3Rpb24oanNlcCkge1xuICByZXR1cm4gdGhpcy5zZW5kKFwibWVzc2FnZVwiLCB7IGJvZHk6IHt9LCBqc2VwOiBqc2VwIH0pO1xufTtcblxuLyoqIFNlbmRzIGFuIElDRSB0cmlja2xlIGNhbmRpZGF0ZSBhc3NvY2lhdGVkIHdpdGggdGhpcyBoYW5kbGUuICoqL1xuSmFudXNQbHVnaW5IYW5kbGUucHJvdG90eXBlLnNlbmRUcmlja2xlID0gZnVuY3Rpb24oY2FuZGlkYXRlKSB7XG4gIHJldHVybiB0aGlzLnNlbmQoXCJ0cmlja2xlXCIsIHsgY2FuZGlkYXRlOiBjYW5kaWRhdGUgfSk7XG59O1xuXG4vKipcbiAqIFJlcHJlc2VudHMgYSBKYW51cyBzZXNzaW9uIC0tIGEgSmFudXMgY29udGV4dCBmcm9tIHdpdGhpbiB3aGljaCB5b3UgY2FuIG9wZW4gbXVsdGlwbGUgaGFuZGxlcyBhbmQgY29ubmVjdGlvbnMuIE9uY2VcbiAqIGNyZWF0ZWQsIHRoaXMgc2Vzc2lvbiB3aWxsIGJlIGdpdmVuIGEgdW5pcXVlIElEIHdoaWNoIHNob3VsZCBiZSB1c2VkIHRvIGFzc29jaWF0ZSBpdCB3aXRoIGZ1dHVyZSBzaWduYWxsaW5nIG1lc3NhZ2VzLlxuICpcbiAqIFNlZSBodHRwczovL2phbnVzLmNvbmYubWVldGVjaG8uY29tL2RvY3MvcmVzdC5odG1sI3Nlc3Npb25zLlxuICoqL1xuZnVuY3Rpb24gSmFudXNTZXNzaW9uKG91dHB1dCwgb3B0aW9ucykge1xuICB0aGlzLm91dHB1dCA9IG91dHB1dDtcbiAgdGhpcy5pZCA9IHVuZGVmaW5lZDtcbiAgdGhpcy5uZXh0VHhJZCA9IDA7XG4gIHRoaXMudHhucyA9IHt9O1xuICB0aGlzLmV2ZW50SGFuZGxlcnMgPSB7fTtcbiAgdGhpcy5vcHRpb25zID0gT2JqZWN0LmFzc2lnbih7XG4gICAgdmVyYm9zZTogZmFsc2UsXG4gICAgdGltZW91dE1zOiAxMDAwMCxcbiAgICBrZWVwYWxpdmVNczogMzAwMDBcbiAgfSwgb3B0aW9ucyk7XG59XG5cbi8qKiBDcmVhdGVzIHRoaXMgc2Vzc2lvbiBvbiB0aGUgSmFudXMgc2VydmVyIGFuZCBzZXRzIGl0cyBJRC4gKiovXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLmNyZWF0ZSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5zZW5kKFwiY3JlYXRlXCIpLnRoZW4ocmVzcCA9PiB7XG4gICAgdGhpcy5pZCA9IHJlc3AuZGF0YS5pZDtcbiAgICByZXR1cm4gcmVzcDtcbiAgfSk7XG59O1xuXG4vKipcbiAqIERlc3Ryb3lzIHRoaXMgc2Vzc2lvbi4gTm90ZSB0aGF0IHVwb24gZGVzdHJ1Y3Rpb24sIEphbnVzIHdpbGwgYWxzbyBjbG9zZSB0aGUgc2lnbmFsbGluZyB0cmFuc3BvcnQgKGlmIGFwcGxpY2FibGUpIGFuZFxuICogYW55IG9wZW4gV2ViUlRDIGNvbm5lY3Rpb25zLlxuICoqL1xuSmFudXNTZXNzaW9uLnByb3RvdHlwZS5kZXN0cm95ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLnNlbmQoXCJkZXN0cm95XCIpLnRoZW4oKHJlc3ApID0+IHtcbiAgICB0aGlzLmRpc3Bvc2UoKTtcbiAgICByZXR1cm4gcmVzcDtcbiAgfSk7XG59O1xuXG4vKipcbiAqIERpc3Bvc2VzIG9mIHRoaXMgc2Vzc2lvbiBpbiBhIHdheSBzdWNoIHRoYXQgbm8gZnVydGhlciBpbmNvbWluZyBzaWduYWxsaW5nIG1lc3NhZ2VzIHdpbGwgYmUgcHJvY2Vzc2VkLlxuICogT3V0c3RhbmRpbmcgdHJhbnNhY3Rpb25zIHdpbGwgYmUgcmVqZWN0ZWQuXG4gKiovXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLmRpc3Bvc2UgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5fa2lsbEtlZXBhbGl2ZSgpO1xuICB0aGlzLmV2ZW50SGFuZGxlcnMgPSB7fTtcbiAgZm9yICh2YXIgdHhJZCBpbiB0aGlzLnR4bnMpIHtcbiAgICBpZiAodGhpcy50eG5zLmhhc093blByb3BlcnR5KHR4SWQpKSB7XG4gICAgICB2YXIgdHhuID0gdGhpcy50eG5zW3R4SWRdO1xuICAgICAgY2xlYXJUaW1lb3V0KHR4bi50aW1lb3V0KTtcbiAgICAgIHR4bi5yZWplY3QobmV3IEVycm9yKFwiSmFudXMgc2Vzc2lvbiB3YXMgZGlzcG9zZWQuXCIpKTtcbiAgICAgIGRlbGV0ZSB0aGlzLnR4bnNbdHhJZF07XG4gICAgfVxuICB9XG59O1xuXG4vKipcbiAqIFdoZXRoZXIgdGhpcyBzaWduYWwgcmVwcmVzZW50cyBhbiBlcnJvciwgYW5kIHRoZSBhc3NvY2lhdGVkIHByb21pc2UgKGlmIGFueSkgc2hvdWxkIGJlIHJlamVjdGVkLlxuICogVXNlcnMgc2hvdWxkIG92ZXJyaWRlIHRoaXMgdG8gaGFuZGxlIGFueSBjdXN0b20gcGx1Z2luLXNwZWNpZmljIGVycm9yIGNvbnZlbnRpb25zLlxuICoqL1xuSmFudXNTZXNzaW9uLnByb3RvdHlwZS5pc0Vycm9yID0gZnVuY3Rpb24oc2lnbmFsKSB7XG4gIHJldHVybiBzaWduYWwuamFudXMgPT09IFwiZXJyb3JcIjtcbn07XG5cbi8qKiBSZWdpc3RlcnMgYSBjYWxsYmFjayB0byBiZSBmaXJlZCB1cG9uIHRoZSByZWNlcHRpb24gb2YgYW55IGluY29taW5nIEphbnVzIHNpZ25hbHMgZm9yIHRoaXMgc2Vzc2lvbiB3aXRoIHRoZVxuICogYGphbnVzYCBhdHRyaWJ1dGUgZXF1YWwgdG8gYGV2YC5cbiAqKi9cbkphbnVzU2Vzc2lvbi5wcm90b3R5cGUub24gPSBmdW5jdGlvbihldiwgY2FsbGJhY2spIHtcbiAgdmFyIGhhbmRsZXJzID0gdGhpcy5ldmVudEhhbmRsZXJzW2V2XTtcbiAgaWYgKGhhbmRsZXJzID09IG51bGwpIHtcbiAgICBoYW5kbGVycyA9IHRoaXMuZXZlbnRIYW5kbGVyc1tldl0gPSBbXTtcbiAgfVxuICBoYW5kbGVycy5wdXNoKGNhbGxiYWNrKTtcbn07XG5cbi8qKlxuICogQ2FsbGJhY2sgZm9yIHJlY2VpdmluZyBKU09OIHNpZ25hbGxpbmcgbWVzc2FnZXMgcGVydGluZW50IHRvIHRoaXMgc2Vzc2lvbi4gSWYgdGhlIHNpZ25hbHMgYXJlIHJlc3BvbnNlcyB0byBwcmV2aW91c2x5XG4gKiBzZW50IHNpZ25hbHMsIHRoZSBwcm9taXNlcyBmb3IgdGhlIG91dGdvaW5nIHNpZ25hbHMgd2lsbCBiZSByZXNvbHZlZCBvciByZWplY3RlZCBhcHByb3ByaWF0ZWx5IHdpdGggdGhpcyBzaWduYWwgYXMgYW5cbiAqIGFyZ3VtZW50LlxuICpcbiAqIEV4dGVybmFsIGNhbGxlcnMgc2hvdWxkIGNhbGwgdGhpcyBmdW5jdGlvbiBldmVyeSB0aW1lIGEgbmV3IHNpZ25hbCBhcnJpdmVzIG9uIHRoZSB0cmFuc3BvcnQ7IGZvciBleGFtcGxlLCBpbiBhXG4gKiBXZWJTb2NrZXQncyBgbWVzc2FnZWAgZXZlbnQsIG9yIHdoZW4gYSBuZXcgZGF0dW0gc2hvd3MgdXAgaW4gYW4gSFRUUCBsb25nLXBvbGxpbmcgcmVzcG9uc2UuXG4gKiovXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLnJlY2VpdmUgPSBmdW5jdGlvbihzaWduYWwpIHtcbiAgaWYgKHRoaXMub3B0aW9ucy52ZXJib3NlKSB7XG4gICAgdGhpcy5fbG9nSW5jb21pbmcoc2lnbmFsKTtcbiAgfVxuICBpZiAoc2lnbmFsLnNlc3Npb25faWQgIT0gdGhpcy5pZCkge1xuICAgIGNvbnNvbGUud2FybihcIkluY29ycmVjdCBzZXNzaW9uIElEIHJlY2VpdmVkIGluIEphbnVzIHNpZ25hbGxpbmcgbWVzc2FnZTogd2FzIFwiICsgc2lnbmFsLnNlc3Npb25faWQgKyBcIiwgZXhwZWN0ZWQgXCIgKyB0aGlzLmlkICsgXCIuXCIpO1xuICB9XG5cbiAgdmFyIHJlc3BvbnNlVHlwZSA9IHNpZ25hbC5qYW51cztcbiAgdmFyIGhhbmRsZXJzID0gdGhpcy5ldmVudEhhbmRsZXJzW3Jlc3BvbnNlVHlwZV07XG4gIGlmIChoYW5kbGVycyAhPSBudWxsKSB7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBoYW5kbGVycy5sZW5ndGg7IGkrKykge1xuICAgICAgaGFuZGxlcnNbaV0oc2lnbmFsKTtcbiAgICB9XG4gIH1cblxuICBpZiAoc2lnbmFsLnRyYW5zYWN0aW9uICE9IG51bGwpIHtcbiAgICB2YXIgdHhuID0gdGhpcy50eG5zW3NpZ25hbC50cmFuc2FjdGlvbl07XG4gICAgaWYgKHR4biA9PSBudWxsKSB7XG4gICAgICAvLyB0aGlzIGlzIGEgcmVzcG9uc2UgdG8gYSB0cmFuc2FjdGlvbiB0aGF0IHdhc24ndCBjYXVzZWQgdmlhIEphbnVzU2Vzc2lvbi5zZW5kLCBvciBhIHBsdWdpbiByZXBsaWVkIHR3aWNlIHRvIGFcbiAgICAgIC8vIHNpbmdsZSByZXF1ZXN0LCBvciB0aGUgc2Vzc2lvbiB3YXMgZGlzcG9zZWQsIG9yIHNvbWV0aGluZyBlbHNlIHRoYXQgaXNuJ3QgdW5kZXIgb3VyIHB1cnZpZXc7IHRoYXQncyBmaW5lXG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKHJlc3BvbnNlVHlwZSA9PT0gXCJhY2tcIiAmJiB0eG4udHlwZSA9PSBcIm1lc3NhZ2VcIikge1xuICAgICAgLy8gdGhpcyBpcyBhbiBhY2sgb2YgYW4gYXN5bmNocm9ub3VzbHktcHJvY2Vzc2VkIHBsdWdpbiByZXF1ZXN0LCB3ZSBzaG91bGQgd2FpdCB0byByZXNvbHZlIHRoZSBwcm9taXNlIHVudGlsIHRoZVxuICAgICAgLy8gYWN0dWFsIHJlc3BvbnNlIGNvbWVzIGluXG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY2xlYXJUaW1lb3V0KHR4bi50aW1lb3V0KTtcblxuICAgIGRlbGV0ZSB0aGlzLnR4bnNbc2lnbmFsLnRyYW5zYWN0aW9uXTtcbiAgICAodGhpcy5pc0Vycm9yKHNpZ25hbCkgPyB0eG4ucmVqZWN0IDogdHhuLnJlc29sdmUpKHNpZ25hbCk7XG4gIH1cbn07XG5cbi8qKlxuICogU2VuZHMgYSBzaWduYWwgYXNzb2NpYXRlZCB3aXRoIHRoaXMgc2Vzc2lvbiwgYmVnaW5uaW5nIGEgbmV3IHRyYW5zYWN0aW9uLiBSZXR1cm5zIGEgcHJvbWlzZSB0aGF0IHdpbGwgYmUgcmVzb2x2ZWQgb3JcbiAqIHJlamVjdGVkIHdoZW4gYSByZXNwb25zZSBpcyByZWNlaXZlZCBpbiB0aGUgc2FtZSB0cmFuc2FjdGlvbiwgb3Igd2hlbiBubyByZXNwb25zZSBpcyByZWNlaXZlZCB3aXRoaW4gdGhlIHNlc3Npb25cbiAqIHRpbWVvdXQuXG4gKiovXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLnNlbmQgPSBmdW5jdGlvbih0eXBlLCBzaWduYWwpIHtcbiAgc2lnbmFsID0gT2JqZWN0LmFzc2lnbih7IHRyYW5zYWN0aW9uOiAodGhpcy5uZXh0VHhJZCsrKS50b1N0cmluZygpIH0sIHNpZ25hbCk7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgdmFyIHRpbWVvdXQgPSBudWxsO1xuICAgIGlmICh0aGlzLm9wdGlvbnMudGltZW91dE1zKSB7XG4gICAgICB0aW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIGRlbGV0ZSB0aGlzLnR4bnNbc2lnbmFsLnRyYW5zYWN0aW9uXTtcbiAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihcIlNpZ25hbGxpbmcgdHJhbnNhY3Rpb24gd2l0aCB0eGlkIFwiICsgc2lnbmFsLnRyYW5zYWN0aW9uICsgXCIgdGltZWQgb3V0LlwiKSk7XG4gICAgICB9LCB0aGlzLm9wdGlvbnMudGltZW91dE1zKTtcbiAgICB9XG4gICAgdGhpcy50eG5zW3NpZ25hbC50cmFuc2FjdGlvbl0gPSB7IHJlc29sdmU6IHJlc29sdmUsIHJlamVjdDogcmVqZWN0LCB0aW1lb3V0OiB0aW1lb3V0LCB0eXBlOiB0eXBlIH07XG4gICAgdGhpcy5fdHJhbnNtaXQodHlwZSwgc2lnbmFsKTtcbiAgfSk7XG59O1xuXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLl90cmFuc21pdCA9IGZ1bmN0aW9uKHR5cGUsIHNpZ25hbCkge1xuICBzaWduYWwgPSBPYmplY3QuYXNzaWduKHsgamFudXM6IHR5cGUgfSwgc2lnbmFsKTtcblxuICBpZiAodGhpcy5pZCAhPSBudWxsKSB7IC8vIHRoaXMuaWQgaXMgdW5kZWZpbmVkIGluIHRoZSBzcGVjaWFsIGNhc2Ugd2hlbiB3ZSdyZSBzZW5kaW5nIHRoZSBzZXNzaW9uIGNyZWF0ZSBtZXNzYWdlXG4gICAgc2lnbmFsID0gT2JqZWN0LmFzc2lnbih7IHNlc3Npb25faWQ6IHRoaXMuaWQgfSwgc2lnbmFsKTtcbiAgfVxuXG4gIGlmICh0aGlzLm9wdGlvbnMudmVyYm9zZSkge1xuICAgIHRoaXMuX2xvZ091dGdvaW5nKHNpZ25hbCk7XG4gIH1cblxuICB0aGlzLm91dHB1dChKU09OLnN0cmluZ2lmeShzaWduYWwpKTtcbiAgdGhpcy5fcmVzZXRLZWVwYWxpdmUoKTtcbn07XG5cbkphbnVzU2Vzc2lvbi5wcm90b3R5cGUuX2xvZ091dGdvaW5nID0gZnVuY3Rpb24oc2lnbmFsKSB7XG4gIHZhciBraW5kID0gc2lnbmFsLmphbnVzO1xuICBpZiAoa2luZCA9PT0gXCJtZXNzYWdlXCIgJiYgc2lnbmFsLmpzZXApIHtcbiAgICBraW5kID0gc2lnbmFsLmpzZXAudHlwZTtcbiAgfVxuICB2YXIgbWVzc2FnZSA9IFwiPiBPdXRnb2luZyBKYW51cyBcIiArIChraW5kIHx8IFwic2lnbmFsXCIpICsgXCIgKCNcIiArIHNpZ25hbC50cmFuc2FjdGlvbiArIFwiKTogXCI7XG4gIGNvbnNvbGUuZGVidWcoXCIlY1wiICsgbWVzc2FnZSwgXCJjb2xvcjogIzA0MFwiLCBzaWduYWwpO1xufTtcblxuSmFudXNTZXNzaW9uLnByb3RvdHlwZS5fbG9nSW5jb21pbmcgPSBmdW5jdGlvbihzaWduYWwpIHtcbiAgdmFyIGtpbmQgPSBzaWduYWwuamFudXM7XG4gIHZhciBtZXNzYWdlID0gc2lnbmFsLnRyYW5zYWN0aW9uID9cbiAgICAgIFwiPCBJbmNvbWluZyBKYW51cyBcIiArIChraW5kIHx8IFwic2lnbmFsXCIpICsgXCIgKCNcIiArIHNpZ25hbC50cmFuc2FjdGlvbiArIFwiKTogXCIgOlxuICAgICAgXCI8IEluY29taW5nIEphbnVzIFwiICsgKGtpbmQgfHwgXCJzaWduYWxcIikgKyBcIjogXCI7XG4gIGNvbnNvbGUuZGVidWcoXCIlY1wiICsgbWVzc2FnZSwgXCJjb2xvcjogIzAwNFwiLCBzaWduYWwpO1xufTtcblxuSmFudXNTZXNzaW9uLnByb3RvdHlwZS5fc2VuZEtlZXBhbGl2ZSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5zZW5kKFwia2VlcGFsaXZlXCIpO1xufTtcblxuSmFudXNTZXNzaW9uLnByb3RvdHlwZS5fa2lsbEtlZXBhbGl2ZSA9IGZ1bmN0aW9uKCkge1xuICBjbGVhclRpbWVvdXQodGhpcy5rZWVwYWxpdmVUaW1lb3V0KTtcbn07XG5cbkphbnVzU2Vzc2lvbi5wcm90b3R5cGUuX3Jlc2V0S2VlcGFsaXZlID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuX2tpbGxLZWVwYWxpdmUoKTtcbiAgaWYgKHRoaXMub3B0aW9ucy5rZWVwYWxpdmVNcykge1xuICAgIHRoaXMua2VlcGFsaXZlVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy5fc2VuZEtlZXBhbGl2ZSgpLmNhdGNoKGUgPT4gY29uc29sZS5lcnJvcihcIkVycm9yIHJlY2VpdmVkIGZyb20ga2VlcGFsaXZlOiBcIiwgZSkpO1xuICAgIH0sIHRoaXMub3B0aW9ucy5rZWVwYWxpdmVNcyk7XG4gIH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBKYW51c1BsdWdpbkhhbmRsZSxcbiAgSmFudXNTZXNzaW9uXG59O1xuIiwiLyogZ2xvYmFsIE5BRiAqL1xudmFyIG1qID0gcmVxdWlyZShcIkBuZXR3b3JrZWQtYWZyYW1lL21pbmlqYW51c1wiKTtcbm1qLkphbnVzU2Vzc2lvbi5wcm90b3R5cGUuc2VuZE9yaWdpbmFsID0gbWouSmFudXNTZXNzaW9uLnByb3RvdHlwZS5zZW5kO1xubWouSmFudXNTZXNzaW9uLnByb3RvdHlwZS5zZW5kID0gZnVuY3Rpb24odHlwZSwgc2lnbmFsKSB7XG4gIHJldHVybiB0aGlzLnNlbmRPcmlnaW5hbCh0eXBlLCBzaWduYWwpLmNhdGNoKChlKSA9PiB7XG4gICAgaWYgKGUubWVzc2FnZSAmJiBlLm1lc3NhZ2UuaW5kZXhPZihcInRpbWVkIG91dFwiKSA+IC0xKSB7XG4gICAgICBjb25zb2xlLmVycm9yKFwid2ViIHNvY2tldCB0aW1lZCBvdXRcIik7XG4gICAgICBOQUYuY29ubmVjdGlvbi5hZGFwdGVyLnJlY29ubmVjdCgpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyhlKTtcbiAgICB9XG4gIH0pO1xufVxuXG52YXIgc2RwVXRpbHMgPSByZXF1aXJlKFwic2RwXCIpO1xuLy92YXIgZGVidWcgPSByZXF1aXJlKFwiZGVidWdcIikoXCJuYWYtamFudXMtYWRhcHRlcjpkZWJ1Z1wiKTtcbi8vdmFyIHdhcm4gPSByZXF1aXJlKFwiZGVidWdcIikoXCJuYWYtamFudXMtYWRhcHRlcjp3YXJuXCIpO1xuLy92YXIgZXJyb3IgPSByZXF1aXJlKFwiZGVidWdcIikoXCJuYWYtamFudXMtYWRhcHRlcjplcnJvclwiKTtcbnZhciBkZWJ1ZyA9IGNvbnNvbGUubG9nO1xudmFyIHdhcm4gPSBjb25zb2xlLndhcm47XG52YXIgZXJyb3IgPSBjb25zb2xlLmVycm9yO1xudmFyIGlzU2FmYXJpID0gL14oKD8hY2hyb21lfGFuZHJvaWQpLikqc2FmYXJpL2kudGVzdChuYXZpZ2F0b3IudXNlckFnZW50KTtcblxuY29uc3QgU1VCU0NSSUJFX1RJTUVPVVRfTVMgPSAxNTAwMDtcblxuZnVuY3Rpb24gZGVib3VuY2UoZm4pIHtcbiAgdmFyIGN1cnIgPSBQcm9taXNlLnJlc29sdmUoKTtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciBhcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzKTtcbiAgICBjdXJyID0gY3Vyci50aGVuKF8gPT4gZm4uYXBwbHkodGhpcywgYXJncykpO1xuICB9O1xufVxuXG5mdW5jdGlvbiByYW5kb21VaW50KCkge1xuICByZXR1cm4gTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogTnVtYmVyLk1BWF9TQUZFX0lOVEVHRVIpO1xufVxuXG5mdW5jdGlvbiB1bnRpbERhdGFDaGFubmVsT3BlbihkYXRhQ2hhbm5lbCkge1xuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIGlmIChkYXRhQ2hhbm5lbC5yZWFkeVN0YXRlID09PSBcIm9wZW5cIikge1xuICAgICAgcmVzb2x2ZSgpO1xuICAgIH0gZWxzZSB7XG4gICAgICBsZXQgcmVzb2x2ZXIsIHJlamVjdG9yO1xuXG4gICAgICBjb25zdCBjbGVhciA9ICgpID0+IHtcbiAgICAgICAgZGF0YUNoYW5uZWwucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm9wZW5cIiwgcmVzb2x2ZXIpO1xuICAgICAgICBkYXRhQ2hhbm5lbC5yZW1vdmVFdmVudExpc3RlbmVyKFwiZXJyb3JcIiwgcmVqZWN0b3IpO1xuICAgICAgfTtcblxuICAgICAgcmVzb2x2ZXIgPSAoKSA9PiB7XG4gICAgICAgIGNsZWFyKCk7XG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH07XG4gICAgICByZWplY3RvciA9ICgpID0+IHtcbiAgICAgICAgY2xlYXIoKTtcbiAgICAgICAgcmVqZWN0KCk7XG4gICAgICB9O1xuXG4gICAgICBkYXRhQ2hhbm5lbC5hZGRFdmVudExpc3RlbmVyKFwib3BlblwiLCByZXNvbHZlcik7XG4gICAgICBkYXRhQ2hhbm5lbC5hZGRFdmVudExpc3RlbmVyKFwiZXJyb3JcIiwgcmVqZWN0b3IpO1xuICAgIH1cbiAgfSk7XG59XG5cbmNvbnN0IGlzSDI2NFZpZGVvU3VwcG9ydGVkID0gKCgpID0+IHtcbiAgY29uc3QgdmlkZW8gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwidmlkZW9cIik7XG4gIHJldHVybiB2aWRlby5jYW5QbGF5VHlwZSgndmlkZW8vbXA0OyBjb2RlY3M9XCJhdmMxLjQyRTAxRSwgbXA0YS40MC4yXCInKSAhPT0gXCJcIjtcbn0pKCk7XG5cbmNvbnN0IE9QVVNfUEFSQU1FVEVSUyA9IHtcbiAgLy8gaW5kaWNhdGVzIHRoYXQgd2Ugd2FudCB0byBlbmFibGUgRFRYIHRvIGVsaWRlIHNpbGVuY2UgcGFja2V0c1xuICB1c2VkdHg6IDEsXG4gIC8vIGluZGljYXRlcyB0aGF0IHdlIHByZWZlciB0byByZWNlaXZlIG1vbm8gYXVkaW8gKGltcG9ydGFudCBmb3Igdm9pcCBwcm9maWxlKVxuICBzdGVyZW86IDAsXG4gIC8vIGluZGljYXRlcyB0aGF0IHdlIHByZWZlciB0byBzZW5kIG1vbm8gYXVkaW8gKGltcG9ydGFudCBmb3Igdm9pcCBwcm9maWxlKVxuICBcInNwcm9wLXN0ZXJlb1wiOiAwXG59O1xuXG5jb25zdCBERUZBVUxUX1BFRVJfQ09OTkVDVElPTl9DT05GSUcgPSB7XG4gIGljZVNlcnZlcnM6IFt7IHVybHM6IFwic3R1bjpzdHVuMS5sLmdvb2dsZS5jb206MTkzMDJcIiB9LCB7IHVybHM6IFwic3R1bjpzdHVuMi5sLmdvb2dsZS5jb206MTkzMDJcIiB9XVxufTtcblxuY29uc3QgV1NfTk9STUFMX0NMT1NVUkUgPSAxMDAwO1xuXG5jbGFzcyBKYW51c0FkYXB0ZXIge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICB0aGlzLnJvb20gPSBudWxsO1xuICAgIC8vIFdlIGV4cGVjdCB0aGUgY29uc3VtZXIgdG8gc2V0IGEgY2xpZW50IGlkIGJlZm9yZSBjb25uZWN0aW5nLlxuICAgIHRoaXMuY2xpZW50SWQgPSBudWxsO1xuICAgIHRoaXMuam9pblRva2VuID0gbnVsbDtcblxuICAgIHRoaXMuc2VydmVyVXJsID0gbnVsbDtcbiAgICB0aGlzLndlYlJ0Y09wdGlvbnMgPSB7fTtcbiAgICB0aGlzLnBlZXJDb25uZWN0aW9uQ29uZmlnID0gbnVsbDtcbiAgICB0aGlzLndzID0gbnVsbDtcbiAgICB0aGlzLnNlc3Npb24gPSBudWxsO1xuICAgIHRoaXMucmVsaWFibGVUcmFuc3BvcnQgPSBcImRhdGFjaGFubmVsXCI7XG4gICAgdGhpcy51bnJlbGlhYmxlVHJhbnNwb3J0ID0gXCJkYXRhY2hhbm5lbFwiO1xuXG4gICAgLy8gSW4gdGhlIGV2ZW50IHRoZSBzZXJ2ZXIgcmVzdGFydHMgYW5kIGFsbCBjbGllbnRzIGxvc2UgY29ubmVjdGlvbiwgcmVjb25uZWN0IHdpdGhcbiAgICAvLyBzb21lIHJhbmRvbSBqaXR0ZXIgYWRkZWQgdG8gcHJldmVudCBzaW11bHRhbmVvdXMgcmVjb25uZWN0aW9uIHJlcXVlc3RzLlxuICAgIHRoaXMuaW5pdGlhbFJlY29ubmVjdGlvbkRlbGF5ID0gMTAwMCAqIE1hdGgucmFuZG9tKCk7XG4gICAgdGhpcy5yZWNvbm5lY3Rpb25EZWxheSA9IHRoaXMuaW5pdGlhbFJlY29ubmVjdGlvbkRlbGF5O1xuICAgIHRoaXMucmVjb25uZWN0aW9uVGltZW91dCA9IG51bGw7XG4gICAgdGhpcy5tYXhSZWNvbm5lY3Rpb25BdHRlbXB0cyA9IDEwO1xuICAgIHRoaXMucmVjb25uZWN0aW9uQXR0ZW1wdHMgPSAwO1xuXG4gICAgdGhpcy5wdWJsaXNoZXIgPSBudWxsO1xuICAgIHRoaXMub2NjdXBhbnRzID0ge307XG4gICAgdGhpcy5sZWZ0T2NjdXBhbnRzID0gbmV3IFNldCgpO1xuICAgIHRoaXMubWVkaWFTdHJlYW1zID0ge307XG4gICAgdGhpcy5sb2NhbE1lZGlhU3RyZWFtID0gbnVsbDtcbiAgICB0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzID0gbmV3IE1hcCgpO1xuXG4gICAgdGhpcy5ibG9ja2VkQ2xpZW50cyA9IG5ldyBNYXAoKTtcbiAgICB0aGlzLmZyb3plblVwZGF0ZXMgPSBuZXcgTWFwKCk7XG5cbiAgICB0aGlzLnRpbWVPZmZzZXRzID0gW107XG4gICAgdGhpcy5zZXJ2ZXJUaW1lUmVxdWVzdHMgPSAwO1xuICAgIHRoaXMuYXZnVGltZU9mZnNldCA9IDA7XG5cbiAgICB0aGlzLm9uV2Vic29ja2V0T3BlbiA9IHRoaXMub25XZWJzb2NrZXRPcGVuLmJpbmQodGhpcyk7XG4gICAgdGhpcy5vbldlYnNvY2tldENsb3NlID0gdGhpcy5vbldlYnNvY2tldENsb3NlLmJpbmQodGhpcyk7XG4gICAgdGhpcy5vbldlYnNvY2tldE1lc3NhZ2UgPSB0aGlzLm9uV2Vic29ja2V0TWVzc2FnZS5iaW5kKHRoaXMpO1xuICAgIHRoaXMub25EYXRhQ2hhbm5lbE1lc3NhZ2UgPSB0aGlzLm9uRGF0YUNoYW5uZWxNZXNzYWdlLmJpbmQodGhpcyk7XG4gICAgdGhpcy5vbkRhdGEgPSB0aGlzLm9uRGF0YS5iaW5kKHRoaXMpO1xuICB9XG5cbiAgc2V0U2VydmVyVXJsKHVybCkge1xuICAgIHRoaXMuc2VydmVyVXJsID0gdXJsO1xuICB9XG5cbiAgc2V0QXBwKGFwcCkge31cblxuICBzZXRSb29tKHJvb21OYW1lKSB7XG4gICAgdGhpcy5yb29tID0gcm9vbU5hbWU7XG4gIH1cblxuICBzZXRKb2luVG9rZW4oam9pblRva2VuKSB7XG4gICAgdGhpcy5qb2luVG9rZW4gPSBqb2luVG9rZW47XG4gIH1cblxuICBzZXRDbGllbnRJZChjbGllbnRJZCkge1xuICAgIHRoaXMuY2xpZW50SWQgPSBjbGllbnRJZDtcbiAgfVxuXG4gIHNldFdlYlJ0Y09wdGlvbnMob3B0aW9ucykge1xuICAgIHRoaXMud2ViUnRjT3B0aW9ucyA9IG9wdGlvbnM7XG4gIH1cblxuICBzZXRQZWVyQ29ubmVjdGlvbkNvbmZpZyhwZWVyQ29ubmVjdGlvbkNvbmZpZykge1xuICAgIHRoaXMucGVlckNvbm5lY3Rpb25Db25maWcgPSBwZWVyQ29ubmVjdGlvbkNvbmZpZztcbiAgfVxuXG4gIHNldFNlcnZlckNvbm5lY3RMaXN0ZW5lcnMoc3VjY2Vzc0xpc3RlbmVyLCBmYWlsdXJlTGlzdGVuZXIpIHtcbiAgICB0aGlzLmNvbm5lY3RTdWNjZXNzID0gc3VjY2Vzc0xpc3RlbmVyO1xuICAgIHRoaXMuY29ubmVjdEZhaWx1cmUgPSBmYWlsdXJlTGlzdGVuZXI7XG4gIH1cblxuICBzZXRSb29tT2NjdXBhbnRMaXN0ZW5lcihvY2N1cGFudExpc3RlbmVyKSB7XG4gICAgdGhpcy5vbk9jY3VwYW50c0NoYW5nZWQgPSBvY2N1cGFudExpc3RlbmVyO1xuICB9XG5cbiAgc2V0RGF0YUNoYW5uZWxMaXN0ZW5lcnMob3Blbkxpc3RlbmVyLCBjbG9zZWRMaXN0ZW5lciwgbWVzc2FnZUxpc3RlbmVyKSB7XG4gICAgdGhpcy5vbk9jY3VwYW50Q29ubmVjdGVkID0gb3Blbkxpc3RlbmVyO1xuICAgIHRoaXMub25PY2N1cGFudERpc2Nvbm5lY3RlZCA9IGNsb3NlZExpc3RlbmVyO1xuICAgIHRoaXMub25PY2N1cGFudE1lc3NhZ2UgPSBtZXNzYWdlTGlzdGVuZXI7XG4gIH1cblxuICBzZXRSZWNvbm5lY3Rpb25MaXN0ZW5lcnMocmVjb25uZWN0aW5nTGlzdGVuZXIsIHJlY29ubmVjdGVkTGlzdGVuZXIsIHJlY29ubmVjdGlvbkVycm9yTGlzdGVuZXIpIHtcbiAgICAvLyBvblJlY29ubmVjdGluZyBpcyBjYWxsZWQgd2l0aCB0aGUgbnVtYmVyIG9mIG1pbGxpc2Vjb25kcyB1bnRpbCB0aGUgbmV4dCByZWNvbm5lY3Rpb24gYXR0ZW1wdFxuICAgIHRoaXMub25SZWNvbm5lY3RpbmcgPSByZWNvbm5lY3RpbmdMaXN0ZW5lcjtcbiAgICAvLyBvblJlY29ubmVjdGVkIGlzIGNhbGxlZCB3aGVuIHRoZSBjb25uZWN0aW9uIGhhcyBiZWVuIHJlZXN0YWJsaXNoZWRcbiAgICB0aGlzLm9uUmVjb25uZWN0ZWQgPSByZWNvbm5lY3RlZExpc3RlbmVyO1xuICAgIC8vIG9uUmVjb25uZWN0aW9uRXJyb3IgaXMgY2FsbGVkIHdpdGggYW4gZXJyb3Igd2hlbiBtYXhSZWNvbm5lY3Rpb25BdHRlbXB0cyBoYXMgYmVlbiByZWFjaGVkXG4gICAgdGhpcy5vblJlY29ubmVjdGlvbkVycm9yID0gcmVjb25uZWN0aW9uRXJyb3JMaXN0ZW5lcjtcbiAgfVxuXG4gIHNldEV2ZW50TG9vcHMobG9vcHMpIHtcbiAgICB0aGlzLmxvb3BzID0gbG9vcHM7XG4gIH1cblxuICBjb25uZWN0KCkge1xuICAgIGRlYnVnKGBjb25uZWN0aW5nIHRvICR7dGhpcy5zZXJ2ZXJVcmx9YCk7XG5cbiAgICBjb25zdCB3ZWJzb2NrZXRDb25uZWN0aW9uID0gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgdGhpcy53cyA9IG5ldyBXZWJTb2NrZXQodGhpcy5zZXJ2ZXJVcmwsIFwiamFudXMtcHJvdG9jb2xcIik7XG5cbiAgICAgIHRoaXMuc2Vzc2lvbiA9IG5ldyBtai5KYW51c1Nlc3Npb24odGhpcy53cy5zZW5kLmJpbmQodGhpcy53cyksIHsgdGltZW91dE1zOiA0MDAwMCB9KTtcblxuICAgICAgdGhpcy53cy5hZGRFdmVudExpc3RlbmVyKFwiY2xvc2VcIiwgdGhpcy5vbldlYnNvY2tldENsb3NlKTtcbiAgICAgIHRoaXMud3MuYWRkRXZlbnRMaXN0ZW5lcihcIm1lc3NhZ2VcIiwgdGhpcy5vbldlYnNvY2tldE1lc3NhZ2UpO1xuXG4gICAgICB0aGlzLndzT25PcGVuID0gKCkgPT4ge1xuICAgICAgICB0aGlzLndzLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJvcGVuXCIsIHRoaXMud3NPbk9wZW4pO1xuICAgICAgICB0aGlzLm9uV2Vic29ja2V0T3BlbigpXG4gICAgICAgICAgLnRoZW4ocmVzb2x2ZSlcbiAgICAgICAgICAuY2F0Y2gocmVqZWN0KTtcbiAgICAgIH07XG5cbiAgICAgIHRoaXMud3MuYWRkRXZlbnRMaXN0ZW5lcihcIm9wZW5cIiwgdGhpcy53c09uT3Blbik7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gUHJvbWlzZS5hbGwoW3dlYnNvY2tldENvbm5lY3Rpb24sIHRoaXMudXBkYXRlVGltZU9mZnNldCgpXSk7XG4gIH1cblxuICBkaXNjb25uZWN0KCkge1xuICAgIGRlYnVnKGBkaXNjb25uZWN0aW5nYCk7XG5cbiAgICBjbGVhclRpbWVvdXQodGhpcy5yZWNvbm5lY3Rpb25UaW1lb3V0KTtcblxuICAgIHRoaXMucmVtb3ZlQWxsT2NjdXBhbnRzKCk7XG4gICAgdGhpcy5sZWZ0T2NjdXBhbnRzID0gbmV3IFNldCgpO1xuXG4gICAgaWYgKHRoaXMucHVibGlzaGVyKSB7XG4gICAgICAvLyBDbG9zZSB0aGUgcHVibGlzaGVyIHBlZXIgY29ubmVjdGlvbi4gV2hpY2ggYWxzbyBkZXRhY2hlcyB0aGUgcGx1Z2luIGhhbmRsZS5cbiAgICAgIHRoaXMucHVibGlzaGVyLmNvbm4uY2xvc2UoKTtcbiAgICAgIHRoaXMucHVibGlzaGVyID0gbnVsbDtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5zZXNzaW9uKSB7XG4gICAgICB0aGlzLnNlc3Npb24uZGlzcG9zZSgpO1xuICAgICAgdGhpcy5zZXNzaW9uID0gbnVsbDtcbiAgICB9XG5cbiAgICBpZiAodGhpcy53cykge1xuICAgICAgdGhpcy53cy5yZW1vdmVFdmVudExpc3RlbmVyKFwib3BlblwiLCB0aGlzLndzT25PcGVuKTtcbiAgICAgIHRoaXMud3MucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImNsb3NlXCIsIHRoaXMub25XZWJzb2NrZXRDbG9zZSk7XG4gICAgICB0aGlzLndzLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJtZXNzYWdlXCIsIHRoaXMub25XZWJzb2NrZXRNZXNzYWdlKTtcbiAgICAgIHRoaXMud3MuY2xvc2UoKTtcbiAgICAgIHRoaXMud3MgPSBudWxsO1xuICAgIH1cblxuICAgIC8vIE5vdyB0aGF0IGFsbCBSVENQZWVyQ29ubmVjdGlvbiBjbG9zZWQsIGJlIHN1cmUgdG8gbm90IGNhbGxcbiAgICAvLyByZWNvbm5lY3QoKSBhZ2FpbiB2aWEgcGVyZm9ybURlbGF5ZWRSZWNvbm5lY3QgaWYgcHJldmlvdXNcbiAgICAvLyBSVENQZWVyQ29ubmVjdGlvbiB3YXMgaW4gdGhlIGZhaWxlZCBzdGF0ZS5cbiAgICBpZiAodGhpcy5kZWxheWVkUmVjb25uZWN0VGltZW91dCkge1xuICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuZGVsYXllZFJlY29ubmVjdFRpbWVvdXQpO1xuICAgICAgdGhpcy5kZWxheWVkUmVjb25uZWN0VGltZW91dCA9IG51bGw7XG4gICAgfVxuICB9XG5cbiAgaXNEaXNjb25uZWN0ZWQoKSB7XG4gICAgcmV0dXJuIHRoaXMud3MgPT09IG51bGw7XG4gIH1cblxuICBhc3luYyBvbldlYnNvY2tldE9wZW4oKSB7XG4gICAgLy8gQ3JlYXRlIHRoZSBKYW51cyBTZXNzaW9uXG4gICAgYXdhaXQgdGhpcy5zZXNzaW9uLmNyZWF0ZSgpO1xuXG4gICAgLy8gQXR0YWNoIHRoZSBTRlUgUGx1Z2luIGFuZCBjcmVhdGUgYSBSVENQZWVyQ29ubmVjdGlvbiBmb3IgdGhlIHB1Ymxpc2hlci5cbiAgICAvLyBUaGUgcHVibGlzaGVyIHNlbmRzIGF1ZGlvIGFuZCBvcGVucyB0d28gYmlkaXJlY3Rpb25hbCBkYXRhIGNoYW5uZWxzLlxuICAgIC8vIE9uZSByZWxpYWJsZSBkYXRhY2hhbm5lbCBhbmQgb25lIHVucmVsaWFibGUuXG4gICAgdGhpcy5wdWJsaXNoZXIgPSBhd2FpdCB0aGlzLmNyZWF0ZVB1Ymxpc2hlcigpO1xuXG4gICAgLy8gQ2FsbCB0aGUgbmFmIGNvbm5lY3RTdWNjZXNzIGNhbGxiYWNrIGJlZm9yZSB3ZSBzdGFydCByZWNlaXZpbmcgV2ViUlRDIG1lc3NhZ2VzLlxuICAgIHRoaXMuY29ubmVjdFN1Y2Nlc3ModGhpcy5jbGllbnRJZCk7XG5cbiAgICBjb25zdCBhZGRPY2N1cGFudFByb21pc2VzID0gW107XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRoaXMucHVibGlzaGVyLmluaXRpYWxPY2N1cGFudHMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGNvbnN0IG9jY3VwYW50SWQgPSB0aGlzLnB1Ymxpc2hlci5pbml0aWFsT2NjdXBhbnRzW2ldO1xuICAgICAgaWYgKG9jY3VwYW50SWQgPT09IHRoaXMuY2xpZW50SWQpIGNvbnRpbnVlOyAvLyBIYXBwZW5zIGR1cmluZyBub24tZ3JhY2VmdWwgcmVjb25uZWN0cyBkdWUgdG8gem9tYmllIHNlc3Npb25zXG4gICAgICBhZGRPY2N1cGFudFByb21pc2VzLnB1c2godGhpcy5hZGRPY2N1cGFudChvY2N1cGFudElkKSk7XG4gICAgfVxuXG4gICAgYXdhaXQgUHJvbWlzZS5hbGwoYWRkT2NjdXBhbnRQcm9taXNlcyk7XG4gIH1cblxuICBvbldlYnNvY2tldENsb3NlKGV2ZW50KSB7XG4gICAgLy8gVGhlIGNvbm5lY3Rpb24gd2FzIGNsb3NlZCBzdWNjZXNzZnVsbHkuIERvbid0IHRyeSB0byByZWNvbm5lY3QuXG4gICAgaWYgKGV2ZW50LmNvZGUgPT09IFdTX05PUk1BTF9DTE9TVVJFKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc29sZS53YXJuKFwiSmFudXMgd2Vic29ja2V0IGNsb3NlZCB1bmV4cGVjdGVkbHkuXCIpO1xuICAgIGlmICh0aGlzLm9uUmVjb25uZWN0aW5nKSB7XG4gICAgICB0aGlzLm9uUmVjb25uZWN0aW5nKHRoaXMucmVjb25uZWN0aW9uRGVsYXkpO1xuICAgIH1cblxuICAgIHRoaXMucmVjb25uZWN0aW9uVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4gdGhpcy5yZWNvbm5lY3QoKSwgdGhpcy5yZWNvbm5lY3Rpb25EZWxheSk7XG4gIH1cblxuICByZWNvbm5lY3QoKSB7XG4gICAgLy8gRGlzcG9zZSBvZiBhbGwgbmV0d29ya2VkIGVudGl0aWVzIGFuZCBvdGhlciByZXNvdXJjZXMgdGllZCB0byB0aGUgc2Vzc2lvbi5cbiAgICB0aGlzLmRpc2Nvbm5lY3QoKTtcblxuICAgIHRoaXMuY29ubmVjdCgpXG4gICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgIHRoaXMucmVjb25uZWN0aW9uRGVsYXkgPSB0aGlzLmluaXRpYWxSZWNvbm5lY3Rpb25EZWxheTtcbiAgICAgICAgdGhpcy5yZWNvbm5lY3Rpb25BdHRlbXB0cyA9IDA7XG5cbiAgICAgICAgaWYgKHRoaXMub25SZWNvbm5lY3RlZCkge1xuICAgICAgICAgIHRoaXMub25SZWNvbm5lY3RlZCgpO1xuICAgICAgICB9XG4gICAgICB9KVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgdGhpcy5yZWNvbm5lY3Rpb25EZWxheSArPSAxMDAwO1xuICAgICAgICB0aGlzLnJlY29ubmVjdGlvbkF0dGVtcHRzKys7XG5cbiAgICAgICAgaWYgKHRoaXMucmVjb25uZWN0aW9uQXR0ZW1wdHMgPiB0aGlzLm1heFJlY29ubmVjdGlvbkF0dGVtcHRzICYmIHRoaXMub25SZWNvbm5lY3Rpb25FcnJvcikge1xuICAgICAgICAgIHJldHVybiB0aGlzLm9uUmVjb25uZWN0aW9uRXJyb3IoXG4gICAgICAgICAgICBuZXcgRXJyb3IoXCJDb25uZWN0aW9uIGNvdWxkIG5vdCBiZSByZWVzdGFibGlzaGVkLCBleGNlZWRlZCBtYXhpbXVtIG51bWJlciBvZiByZWNvbm5lY3Rpb24gYXR0ZW1wdHMuXCIpXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnNvbGUud2FybihcIkVycm9yIGR1cmluZyByZWNvbm5lY3QsIHJldHJ5aW5nLlwiKTtcbiAgICAgICAgY29uc29sZS53YXJuKGVycm9yKTtcblxuICAgICAgICBpZiAodGhpcy5vblJlY29ubmVjdGluZykge1xuICAgICAgICAgIHRoaXMub25SZWNvbm5lY3RpbmcodGhpcy5yZWNvbm5lY3Rpb25EZWxheSk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLnJlY29ubmVjdGlvblRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHRoaXMucmVjb25uZWN0KCksIHRoaXMucmVjb25uZWN0aW9uRGVsYXkpO1xuICAgICAgfSk7XG4gIH1cblxuICBwZXJmb3JtRGVsYXllZFJlY29ubmVjdCgpIHtcbiAgICBpZiAodGhpcy5kZWxheWVkUmVjb25uZWN0VGltZW91dCkge1xuICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuZGVsYXllZFJlY29ubmVjdFRpbWVvdXQpO1xuICAgIH1cblxuICAgIHRoaXMuZGVsYXllZFJlY29ubmVjdFRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMuZGVsYXllZFJlY29ubmVjdFRpbWVvdXQgPSBudWxsO1xuICAgICAgdGhpcy5yZWNvbm5lY3QoKTtcbiAgICB9LCAxMDAwMCk7XG4gIH1cblxuICBvbldlYnNvY2tldE1lc3NhZ2UoZXZlbnQpIHtcbiAgICB0aGlzLnNlc3Npb24ucmVjZWl2ZShKU09OLnBhcnNlKGV2ZW50LmRhdGEpKTtcbiAgfVxuXG4gIGFzeW5jIGFkZE9jY3VwYW50KG9jY3VwYW50SWQpIHtcbiAgICBpZiAodGhpcy5vY2N1cGFudHNbb2NjdXBhbnRJZF0pIHtcbiAgICAgIHRoaXMucmVtb3ZlT2NjdXBhbnQob2NjdXBhbnRJZCk7XG4gICAgfVxuXG4gICAgdGhpcy5sZWZ0T2NjdXBhbnRzLmRlbGV0ZShvY2N1cGFudElkKTtcblxuICAgIHZhciBzdWJzY3JpYmVyID0gYXdhaXQgdGhpcy5jcmVhdGVTdWJzY3JpYmVyKG9jY3VwYW50SWQpO1xuXG4gICAgaWYgKCFzdWJzY3JpYmVyKSByZXR1cm47XG5cbiAgICB0aGlzLm9jY3VwYW50c1tvY2N1cGFudElkXSA9IHN1YnNjcmliZXI7XG5cbiAgICB0aGlzLnNldE1lZGlhU3RyZWFtKG9jY3VwYW50SWQsIHN1YnNjcmliZXIubWVkaWFTdHJlYW0pO1xuXG4gICAgLy8gQ2FsbCB0aGUgTmV0d29ya2VkIEFGcmFtZSBjYWxsYmFja3MgZm9yIHRoZSBuZXcgb2NjdXBhbnQuXG4gICAgdGhpcy5vbk9jY3VwYW50Q29ubmVjdGVkKG9jY3VwYW50SWQpO1xuICAgIHRoaXMub25PY2N1cGFudHNDaGFuZ2VkKHRoaXMub2NjdXBhbnRzKTtcblxuICAgIHJldHVybiBzdWJzY3JpYmVyO1xuICB9XG5cbiAgcmVtb3ZlQWxsT2NjdXBhbnRzKCkge1xuICAgIGZvciAoY29uc3Qgb2NjdXBhbnRJZCBvZiBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyh0aGlzLm9jY3VwYW50cykpIHtcbiAgICAgIHRoaXMucmVtb3ZlT2NjdXBhbnQob2NjdXBhbnRJZCk7XG4gICAgfVxuICB9XG5cbiAgcmVtb3ZlT2NjdXBhbnQob2NjdXBhbnRJZCkge1xuICAgIHRoaXMubGVmdE9jY3VwYW50cy5hZGQob2NjdXBhbnRJZCk7XG5cbiAgICBpZiAodGhpcy5vY2N1cGFudHNbb2NjdXBhbnRJZF0pIHtcbiAgICAgIC8vIENsb3NlIHRoZSBzdWJzY3JpYmVyIHBlZXIgY29ubmVjdGlvbi4gV2hpY2ggYWxzbyBkZXRhY2hlcyB0aGUgcGx1Z2luIGhhbmRsZS5cbiAgICAgIHRoaXMub2NjdXBhbnRzW29jY3VwYW50SWRdLmNvbm4uY2xvc2UoKTtcbiAgICAgIGRlbGV0ZSB0aGlzLm9jY3VwYW50c1tvY2N1cGFudElkXTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5tZWRpYVN0cmVhbXNbb2NjdXBhbnRJZF0pIHtcbiAgICAgIGRlbGV0ZSB0aGlzLm1lZGlhU3RyZWFtc1tvY2N1cGFudElkXTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5oYXMob2NjdXBhbnRJZCkpIHtcbiAgICAgIGNvbnN0IG1zZyA9IFwiVGhlIHVzZXIgZGlzY29ubmVjdGVkIGJlZm9yZSB0aGUgbWVkaWEgc3RyZWFtIHdhcyByZXNvbHZlZC5cIjtcbiAgICAgIHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuZ2V0KG9jY3VwYW50SWQpLmF1ZGlvLnJlamVjdChtc2cpO1xuICAgICAgdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5nZXQob2NjdXBhbnRJZCkudmlkZW8ucmVqZWN0KG1zZyk7XG4gICAgICB0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmRlbGV0ZShvY2N1cGFudElkKTtcbiAgICB9XG5cbiAgICAvLyBDYWxsIHRoZSBOZXR3b3JrZWQgQUZyYW1lIGNhbGxiYWNrcyBmb3IgdGhlIHJlbW92ZWQgb2NjdXBhbnQuXG4gICAgdGhpcy5vbk9jY3VwYW50RGlzY29ubmVjdGVkKG9jY3VwYW50SWQpO1xuICAgIHRoaXMub25PY2N1cGFudHNDaGFuZ2VkKHRoaXMub2NjdXBhbnRzKTtcbiAgfVxuXG4gIGFzc29jaWF0ZShjb25uLCBoYW5kbGUpIHtcbiAgICBjb25uLmFkZEV2ZW50TGlzdGVuZXIoXCJpY2VjYW5kaWRhdGVcIiwgZXYgPT4ge1xuICAgICAgaGFuZGxlLnNlbmRUcmlja2xlKGV2LmNhbmRpZGF0ZSB8fCBudWxsKS5jYXRjaChlID0+IGVycm9yKFwiRXJyb3IgdHJpY2tsaW5nIElDRTogJW9cIiwgZSkpO1xuICAgIH0pO1xuICAgIGNvbm4uYWRkRXZlbnRMaXN0ZW5lcihcImljZWNvbm5lY3Rpb25zdGF0ZWNoYW5nZVwiLCBldiA9PiB7XG4gICAgICBpZiAoY29ubi5pY2VDb25uZWN0aW9uU3RhdGUgPT09IFwiY29ubmVjdGVkXCIpIHtcbiAgICAgICAgY29uc29sZS5sb2coXCJJQ0Ugc3RhdGUgY2hhbmdlZCB0byBjb25uZWN0ZWRcIik7XG4gICAgICB9XG4gICAgICBpZiAoY29ubi5pY2VDb25uZWN0aW9uU3RhdGUgPT09IFwiZGlzY29ubmVjdGVkXCIpIHtcbiAgICAgICAgY29uc29sZS53YXJuKFwiSUNFIHN0YXRlIGNoYW5nZWQgdG8gZGlzY29ubmVjdGVkXCIpO1xuICAgICAgfVxuICAgICAgaWYgKGNvbm4uaWNlQ29ubmVjdGlvblN0YXRlID09PSBcImZhaWxlZFwiKSB7XG4gICAgICAgIGNvbnNvbGUud2FybihcIklDRSBmYWlsdXJlIGRldGVjdGVkLiBSZWNvbm5lY3RpbmcgaW4gMTBzLlwiKTtcbiAgICAgICAgdGhpcy5wZXJmb3JtRGVsYXllZFJlY29ubmVjdCgpO1xuICAgICAgfVxuICAgIH0pXG5cbiAgICAvLyB3ZSBoYXZlIHRvIGRlYm91bmNlIHRoZXNlIGJlY2F1c2UgamFudXMgZ2V0cyBhbmdyeSBpZiB5b3Ugc2VuZCBpdCBhIG5ldyBTRFAgYmVmb3JlXG4gICAgLy8gaXQncyBmaW5pc2hlZCBwcm9jZXNzaW5nIGFuIGV4aXN0aW5nIFNEUC4gaW4gYWN0dWFsaXR5LCBpdCBzZWVtcyBsaWtlIHRoaXMgaXMgbWF5YmVcbiAgICAvLyB0b28gbGliZXJhbCBhbmQgd2UgbmVlZCB0byB3YWl0IHNvbWUgYW1vdW50IG9mIHRpbWUgYWZ0ZXIgYW4gb2ZmZXIgYmVmb3JlIHNlbmRpbmcgYW5vdGhlcixcbiAgICAvLyBidXQgd2UgZG9uJ3QgY3VycmVudGx5IGtub3cgYW55IGdvb2Qgd2F5IG9mIGRldGVjdGluZyBleGFjdGx5IGhvdyBsb25nIDooXG4gICAgY29ubi5hZGRFdmVudExpc3RlbmVyKFxuICAgICAgXCJuZWdvdGlhdGlvbm5lZWRlZFwiLFxuICAgICAgZGVib3VuY2UoZXYgPT4ge1xuICAgICAgICBkZWJ1ZyhcIlNlbmRpbmcgbmV3IG9mZmVyIGZvciBoYW5kbGU6ICVvXCIsIGhhbmRsZSk7XG4gICAgICAgIHZhciBvZmZlciA9IGNvbm4uY3JlYXRlT2ZmZXIoKS50aGVuKHRoaXMuY29uZmlndXJlUHVibGlzaGVyU2RwKS50aGVuKHRoaXMuZml4U2FmYXJpSWNlVUZyYWcpO1xuICAgICAgICB2YXIgbG9jYWwgPSBvZmZlci50aGVuKG8gPT4gY29ubi5zZXRMb2NhbERlc2NyaXB0aW9uKG8pKTtcbiAgICAgICAgdmFyIHJlbW90ZSA9IG9mZmVyO1xuXG4gICAgICAgIHJlbW90ZSA9IHJlbW90ZVxuICAgICAgICAgIC50aGVuKHRoaXMuZml4U2FmYXJpSWNlVUZyYWcpXG4gICAgICAgICAgLnRoZW4oaiA9PiBoYW5kbGUuc2VuZEpzZXAoaikpXG4gICAgICAgICAgLnRoZW4ociA9PiBjb25uLnNldFJlbW90ZURlc2NyaXB0aW9uKHIuanNlcCkpO1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5hbGwoW2xvY2FsLCByZW1vdGVdKS5jYXRjaChlID0+IGVycm9yKFwiRXJyb3IgbmVnb3RpYXRpbmcgb2ZmZXI6ICVvXCIsIGUpKTtcbiAgICAgIH0pXG4gICAgKTtcbiAgICBoYW5kbGUub24oXG4gICAgICBcImV2ZW50XCIsXG4gICAgICBkZWJvdW5jZShldiA9PiB7XG4gICAgICAgIHZhciBqc2VwID0gZXYuanNlcDtcbiAgICAgICAgaWYgKGpzZXAgJiYganNlcC50eXBlID09IFwib2ZmZXJcIikge1xuICAgICAgICAgIGRlYnVnKFwiQWNjZXB0aW5nIG5ldyBvZmZlciBmb3IgaGFuZGxlOiAlb1wiLCBoYW5kbGUpO1xuICAgICAgICAgIHZhciBhbnN3ZXIgPSBjb25uXG4gICAgICAgICAgICAuc2V0UmVtb3RlRGVzY3JpcHRpb24odGhpcy5jb25maWd1cmVTdWJzY3JpYmVyU2RwKGpzZXApKVxuICAgICAgICAgICAgLnRoZW4oXyA9PiBjb25uLmNyZWF0ZUFuc3dlcigpKVxuICAgICAgICAgICAgLnRoZW4odGhpcy5maXhTYWZhcmlJY2VVRnJhZyk7XG4gICAgICAgICAgdmFyIGxvY2FsID0gYW5zd2VyLnRoZW4oYSA9PiBjb25uLnNldExvY2FsRGVzY3JpcHRpb24oYSkpO1xuICAgICAgICAgIHZhciByZW1vdGUgPSBhbnN3ZXIudGhlbihqID0+IGhhbmRsZS5zZW5kSnNlcChqKSk7XG4gICAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKFtsb2NhbCwgcmVtb3RlXSkuY2F0Y2goZSA9PiBlcnJvcihcIkVycm9yIG5lZ290aWF0aW5nIGFuc3dlcjogJW9cIiwgZSkpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIHNvbWUgb3RoZXIga2luZCBvZiBldmVudCwgbm90aGluZyB0byBkb1xuICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG4gICAgICB9KVxuICAgICk7XG4gIH1cblxuICBhc3luYyBjcmVhdGVQdWJsaXNoZXIoKSB7XG4gICAgdmFyIGhhbmRsZSA9IG5ldyBtai5KYW51c1BsdWdpbkhhbmRsZSh0aGlzLnNlc3Npb24pO1xuICAgIHZhciBjb25uID0gbmV3IFJUQ1BlZXJDb25uZWN0aW9uKHRoaXMucGVlckNvbm5lY3Rpb25Db25maWcgfHwgREVGQVVMVF9QRUVSX0NPTk5FQ1RJT05fQ09ORklHKTtcblxuICAgIGRlYnVnKFwicHViIHdhaXRpbmcgZm9yIHNmdVwiKTtcbiAgICBhd2FpdCBoYW5kbGUuYXR0YWNoKFwiamFudXMucGx1Z2luLnNmdVwiLCB0aGlzLmxvb3BzICYmIHRoaXMuY2xpZW50SWQgPyBwYXJzZUludCh0aGlzLmNsaWVudElkKSAlIHRoaXMubG9vcHMgOiB1bmRlZmluZWQpO1xuXG4gICAgdGhpcy5hc3NvY2lhdGUoY29ubiwgaGFuZGxlKTtcblxuICAgIGRlYnVnKFwicHViIHdhaXRpbmcgZm9yIGRhdGEgY2hhbm5lbHMgJiB3ZWJydGN1cFwiKTtcbiAgICB2YXIgd2VicnRjdXAgPSBuZXcgUHJvbWlzZShyZXNvbHZlID0+IGhhbmRsZS5vbihcIndlYnJ0Y3VwXCIsIHJlc29sdmUpKTtcblxuICAgIC8vIFVucmVsaWFibGUgZGF0YWNoYW5uZWw6IHNlbmRpbmcgYW5kIHJlY2VpdmluZyBjb21wb25lbnQgdXBkYXRlcy5cbiAgICAvLyBSZWxpYWJsZSBkYXRhY2hhbm5lbDogc2VuZGluZyBhbmQgcmVjaWV2aW5nIGVudGl0eSBpbnN0YW50aWF0aW9ucy5cbiAgICB2YXIgcmVsaWFibGVDaGFubmVsID0gY29ubi5jcmVhdGVEYXRhQ2hhbm5lbChcInJlbGlhYmxlXCIsIHsgb3JkZXJlZDogdHJ1ZSB9KTtcbiAgICB2YXIgdW5yZWxpYWJsZUNoYW5uZWwgPSBjb25uLmNyZWF0ZURhdGFDaGFubmVsKFwidW5yZWxpYWJsZVwiLCB7XG4gICAgICBvcmRlcmVkOiBmYWxzZSxcbiAgICAgIG1heFJldHJhbnNtaXRzOiAwXG4gICAgfSk7XG5cbiAgICByZWxpYWJsZUNoYW5uZWwuYWRkRXZlbnRMaXN0ZW5lcihcIm1lc3NhZ2VcIiwgZSA9PiB0aGlzLm9uRGF0YUNoYW5uZWxNZXNzYWdlKGUsIFwiamFudXMtcmVsaWFibGVcIikpO1xuICAgIHVucmVsaWFibGVDaGFubmVsLmFkZEV2ZW50TGlzdGVuZXIoXCJtZXNzYWdlXCIsIGUgPT4gdGhpcy5vbkRhdGFDaGFubmVsTWVzc2FnZShlLCBcImphbnVzLXVucmVsaWFibGVcIikpO1xuXG4gICAgYXdhaXQgd2VicnRjdXA7XG4gICAgYXdhaXQgdW50aWxEYXRhQ2hhbm5lbE9wZW4ocmVsaWFibGVDaGFubmVsKTtcbiAgICBhd2FpdCB1bnRpbERhdGFDaGFubmVsT3Blbih1bnJlbGlhYmxlQ2hhbm5lbCk7XG5cbiAgICAvLyBkb2luZyB0aGlzIGhlcmUgaXMgc29ydCBvZiBhIGhhY2sgYXJvdW5kIGNocm9tZSByZW5lZ290aWF0aW9uIHdlaXJkbmVzcyAtLVxuICAgIC8vIGlmIHdlIGRvIGl0IHByaW9yIHRvIHdlYnJ0Y3VwLCBjaHJvbWUgb24gZ2VhciBWUiB3aWxsIHNvbWV0aW1lcyBwdXQgYVxuICAgIC8vIHJlbmVnb3RpYXRpb24gb2ZmZXIgaW4gZmxpZ2h0IHdoaWxlIHRoZSBmaXJzdCBvZmZlciB3YXMgc3RpbGwgYmVpbmdcbiAgICAvLyBwcm9jZXNzZWQgYnkgamFudXMuIHdlIHNob3VsZCBmaW5kIHNvbWUgbW9yZSBwcmluY2lwbGVkIHdheSB0byBmaWd1cmUgb3V0XG4gICAgLy8gd2hlbiBqYW51cyBpcyBkb25lIGluIHRoZSBmdXR1cmUuXG4gICAgaWYgKHRoaXMubG9jYWxNZWRpYVN0cmVhbSkge1xuICAgICAgdGhpcy5sb2NhbE1lZGlhU3RyZWFtLmdldFRyYWNrcygpLmZvckVhY2godHJhY2sgPT4ge1xuICAgICAgICBjb25uLmFkZFRyYWNrKHRyYWNrLCB0aGlzLmxvY2FsTWVkaWFTdHJlYW0pO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gSGFuZGxlIGFsbCBvZiB0aGUgam9pbiBhbmQgbGVhdmUgZXZlbnRzLlxuICAgIGhhbmRsZS5vbihcImV2ZW50XCIsIGV2ID0+IHtcbiAgICAgIHZhciBkYXRhID0gZXYucGx1Z2luZGF0YS5kYXRhO1xuICAgICAgaWYgKGRhdGEuZXZlbnQgPT0gXCJqb2luXCIgJiYgZGF0YS5yb29tX2lkID09IHRoaXMucm9vbSkge1xuICAgICAgICBpZiAodGhpcy5kZWxheWVkUmVjb25uZWN0VGltZW91dCkge1xuICAgICAgICAgIC8vIERvbid0IGNyZWF0ZSBhIG5ldyBSVENQZWVyQ29ubmVjdGlvbiwgYWxsIFJUQ1BlZXJDb25uZWN0aW9uIHdpbGwgYmUgY2xvc2VkIGluIGxlc3MgdGhhbiAxMHMuXG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuYWRkT2NjdXBhbnQoZGF0YS51c2VyX2lkKTtcbiAgICAgIH0gZWxzZSBpZiAoZGF0YS5ldmVudCA9PSBcImxlYXZlXCIgJiYgZGF0YS5yb29tX2lkID09IHRoaXMucm9vbSkge1xuICAgICAgICB0aGlzLnJlbW92ZU9jY3VwYW50KGRhdGEudXNlcl9pZCk7XG4gICAgICB9IGVsc2UgaWYgKGRhdGEuZXZlbnQgPT0gXCJibG9ja2VkXCIpIHtcbiAgICAgICAgZG9jdW1lbnQuYm9keS5kaXNwYXRjaEV2ZW50KG5ldyBDdXN0b21FdmVudChcImJsb2NrZWRcIiwgeyBkZXRhaWw6IHsgY2xpZW50SWQ6IGRhdGEuYnkgfSB9KSk7XG4gICAgICB9IGVsc2UgaWYgKGRhdGEuZXZlbnQgPT0gXCJ1bmJsb2NrZWRcIikge1xuICAgICAgICBkb2N1bWVudC5ib2R5LmRpc3BhdGNoRXZlbnQobmV3IEN1c3RvbUV2ZW50KFwidW5ibG9ja2VkXCIsIHsgZGV0YWlsOiB7IGNsaWVudElkOiBkYXRhLmJ5IH0gfSkpO1xuICAgICAgfSBlbHNlIGlmIChkYXRhLmV2ZW50ID09PSBcImRhdGFcIikge1xuICAgICAgICB0aGlzLm9uRGF0YShKU09OLnBhcnNlKGRhdGEuYm9keSksIFwiamFudXMtZXZlbnRcIik7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBkZWJ1ZyhcInB1YiB3YWl0aW5nIGZvciBqb2luXCIpO1xuXG4gICAgLy8gU2VuZCBqb2luIG1lc3NhZ2UgdG8gamFudXMuIExpc3RlbiBmb3Igam9pbi9sZWF2ZSBtZXNzYWdlcy4gQXV0b21hdGljYWxseSBzdWJzY3JpYmUgdG8gYWxsIHVzZXJzJyBXZWJSVEMgZGF0YS5cbiAgICB2YXIgbWVzc2FnZSA9IGF3YWl0IHRoaXMuc2VuZEpvaW4oaGFuZGxlLCB7XG4gICAgICBub3RpZmljYXRpb25zOiB0cnVlLFxuICAgICAgZGF0YTogdHJ1ZVxuICAgIH0pO1xuXG4gICAgaWYgKCFtZXNzYWdlLnBsdWdpbmRhdGEuZGF0YS5zdWNjZXNzKSB7XG4gICAgICBjb25zdCBlcnIgPSBtZXNzYWdlLnBsdWdpbmRhdGEuZGF0YS5lcnJvcjtcbiAgICAgIGNvbnNvbGUuZXJyb3IoZXJyKTtcbiAgICAgIC8vIFdlIG1heSBnZXQgaGVyZSBiZWNhdXNlIG9mIGFuIGV4cGlyZWQgSldULlxuICAgICAgLy8gQ2xvc2UgdGhlIGNvbm5lY3Rpb24gb3Vyc2VsZiBvdGhlcndpc2UgamFudXMgd2lsbCBjbG9zZSBpdCBhZnRlclxuICAgICAgLy8gc2Vzc2lvbl90aW1lb3V0IGJlY2F1c2Ugd2UgZGlkbid0IHNlbmQgYW55IGtlZXBhbGl2ZSBhbmQgdGhpcyB3aWxsXG4gICAgICAvLyB0cmlnZ2VyIGEgZGVsYXllZCByZWNvbm5lY3QgYmVjYXVzZSBvZiB0aGUgaWNlY29ubmVjdGlvbnN0YXRlY2hhbmdlXG4gICAgICAvLyBsaXN0ZW5lciBmb3IgZmFpbHVyZSBzdGF0ZS5cbiAgICAgIC8vIEV2ZW4gaWYgdGhlIGFwcCBjb2RlIGNhbGxzIGRpc2Nvbm5lY3QgaW4gY2FzZSBvZiBlcnJvciwgZGlzY29ubmVjdFxuICAgICAgLy8gd29uJ3QgY2xvc2UgdGhlIHBlZXIgY29ubmVjdGlvbiBiZWNhdXNlIHRoaXMucHVibGlzaGVyIGlzIG5vdCBzZXQuXG4gICAgICBjb25uLmNsb3NlKCk7XG4gICAgICB0aHJvdyBlcnI7XG4gICAgfVxuXG4gICAgdmFyIGluaXRpYWxPY2N1cGFudHMgPSBtZXNzYWdlLnBsdWdpbmRhdGEuZGF0YS5yZXNwb25zZS51c2Vyc1t0aGlzLnJvb21dIHx8IFtdO1xuXG4gICAgaWYgKGluaXRpYWxPY2N1cGFudHMuaW5jbHVkZXModGhpcy5jbGllbnRJZCkpIHtcbiAgICAgIGNvbnNvbGUud2FybihcIkphbnVzIHN0aWxsIGhhcyBwcmV2aW91cyBzZXNzaW9uIGZvciB0aGlzIGNsaWVudC4gUmVjb25uZWN0aW5nIGluIDEwcy5cIik7XG4gICAgICB0aGlzLnBlcmZvcm1EZWxheWVkUmVjb25uZWN0KCk7XG4gICAgfVxuXG4gICAgZGVidWcoXCJwdWJsaXNoZXIgcmVhZHlcIik7XG4gICAgcmV0dXJuIHtcbiAgICAgIGhhbmRsZSxcbiAgICAgIGluaXRpYWxPY2N1cGFudHMsXG4gICAgICByZWxpYWJsZUNoYW5uZWwsXG4gICAgICB1bnJlbGlhYmxlQ2hhbm5lbCxcbiAgICAgIGNvbm5cbiAgICB9O1xuICB9XG5cbiAgY29uZmlndXJlUHVibGlzaGVyU2RwKGpzZXApIHtcbiAgICBqc2VwLnNkcCA9IGpzZXAuc2RwLnJlcGxhY2UoL2E9Zm10cDooMTA5fDExMSkuKlxcclxcbi9nLCAobGluZSwgcHQpID0+IHtcbiAgICAgIGNvbnN0IHBhcmFtZXRlcnMgPSBPYmplY3QuYXNzaWduKHNkcFV0aWxzLnBhcnNlRm10cChsaW5lKSwgT1BVU19QQVJBTUVURVJTKTtcbiAgICAgIHJldHVybiBzZHBVdGlscy53cml0ZUZtdHAoeyBwYXlsb2FkVHlwZTogcHQsIHBhcmFtZXRlcnM6IHBhcmFtZXRlcnMgfSk7XG4gICAgfSk7XG4gICAgcmV0dXJuIGpzZXA7XG4gIH1cblxuICBjb25maWd1cmVTdWJzY3JpYmVyU2RwKGpzZXApIHtcbiAgICAvLyB0b2RvOiBjb25zaWRlciBjbGVhbmluZyB1cCB0aGVzZSBoYWNrcyB0byB1c2Ugc2RwdXRpbHNcbiAgICBpZiAoIWlzSDI2NFZpZGVvU3VwcG9ydGVkKSB7XG4gICAgICBpZiAobmF2aWdhdG9yLnVzZXJBZ2VudC5pbmRleE9mKFwiSGVhZGxlc3NDaHJvbWVcIikgIT09IC0xKSB7XG4gICAgICAgIC8vIEhlYWRsZXNzQ2hyb21lIChlLmcuIHB1cHBldGVlcikgZG9lc24ndCBzdXBwb3J0IHdlYnJ0YyB2aWRlbyBzdHJlYW1zLCBzbyB3ZSByZW1vdmUgdGhvc2UgbGluZXMgZnJvbSB0aGUgU0RQLlxuICAgICAgICBqc2VwLnNkcCA9IGpzZXAuc2RwLnJlcGxhY2UoL209dmlkZW9bXl0qbT0vLCBcIm09XCIpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFRPRE86IEhhY2sgdG8gZ2V0IHZpZGVvIHdvcmtpbmcgb24gQ2hyb21lIGZvciBBbmRyb2lkLiBodHRwczovL2dyb3Vwcy5nb29nbGUuY29tL2ZvcnVtLyMhdG9waWMvbW96aWxsYS5kZXYubWVkaWEvWWUyOXZ1TVRwbzhcbiAgICBpZiAobmF2aWdhdG9yLnVzZXJBZ2VudC5pbmRleE9mKFwiQW5kcm9pZFwiKSA9PT0gLTEpIHtcbiAgICAgIGpzZXAuc2RwID0ganNlcC5zZHAucmVwbGFjZShcbiAgICAgICAgXCJhPXJ0Y3AtZmI6MTA3IGdvb2ctcmVtYlxcclxcblwiLFxuICAgICAgICBcImE9cnRjcC1mYjoxMDcgZ29vZy1yZW1iXFxyXFxuYT1ydGNwLWZiOjEwNyB0cmFuc3BvcnQtY2NcXHJcXG5hPWZtdHA6MTA3IGxldmVsLWFzeW1tZXRyeS1hbGxvd2VkPTE7cGFja2V0aXphdGlvbi1tb2RlPTE7cHJvZmlsZS1sZXZlbC1pZD00MmUwMWZcXHJcXG5cIlxuICAgICAgKTtcbiAgICB9IGVsc2Uge1xuICAgICAganNlcC5zZHAgPSBqc2VwLnNkcC5yZXBsYWNlKFxuICAgICAgICBcImE9cnRjcC1mYjoxMDcgZ29vZy1yZW1iXFxyXFxuXCIsXG4gICAgICAgIFwiYT1ydGNwLWZiOjEwNyBnb29nLXJlbWJcXHJcXG5hPXJ0Y3AtZmI6MTA3IHRyYW5zcG9ydC1jY1xcclxcbmE9Zm10cDoxMDcgbGV2ZWwtYXN5bW1ldHJ5LWFsbG93ZWQ9MTtwYWNrZXRpemF0aW9uLW1vZGU9MTtwcm9maWxlLWxldmVsLWlkPTQyMDAxZlxcclxcblwiXG4gICAgICApO1xuICAgIH1cbiAgICByZXR1cm4ganNlcDtcbiAgfVxuXG4gIGFzeW5jIGZpeFNhZmFyaUljZVVGcmFnKGpzZXApIHtcbiAgICAvLyBTYWZhcmkgcHJvZHVjZXMgYSBcXG4gaW5zdGVhZCBvZiBhbiBcXHJcXG4gZm9yIHRoZSBpY2UtdWZyYWcuIFNlZSBodHRwczovL2dpdGh1Yi5jb20vbWVldGVjaG8vamFudXMtZ2F0ZXdheS9pc3N1ZXMvMTgxOFxuICAgIGpzZXAuc2RwID0ganNlcC5zZHAucmVwbGFjZSgvW15cXHJdXFxuYT1pY2UtdWZyYWcvZywgXCJcXHJcXG5hPWljZS11ZnJhZ1wiKTtcbiAgICByZXR1cm4ganNlcFxuICB9XG5cbiAgYXN5bmMgY3JlYXRlU3Vic2NyaWJlcihvY2N1cGFudElkLCBtYXhSZXRyaWVzID0gNSkge1xuICAgIGlmICh0aGlzLmxlZnRPY2N1cGFudHMuaGFzKG9jY3VwYW50SWQpKSB7XG4gICAgICBjb25zb2xlLndhcm4ob2NjdXBhbnRJZCArIFwiOiBjYW5jZWxsZWQgb2NjdXBhbnQgY29ubmVjdGlvbiwgb2NjdXBhbnQgbGVmdCBiZWZvcmUgc3Vic2NyaXB0aW9uIG5lZ290YXRpb24uXCIpO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgdmFyIGhhbmRsZSA9IG5ldyBtai5KYW51c1BsdWdpbkhhbmRsZSh0aGlzLnNlc3Npb24pO1xuICAgIHZhciBjb25uID0gbmV3IFJUQ1BlZXJDb25uZWN0aW9uKHRoaXMucGVlckNvbm5lY3Rpb25Db25maWcgfHwgREVGQVVMVF9QRUVSX0NPTk5FQ1RJT05fQ09ORklHKTtcblxuICAgIGRlYnVnKG9jY3VwYW50SWQgKyBcIjogc3ViIHdhaXRpbmcgZm9yIHNmdVwiKTtcbiAgICBhd2FpdCBoYW5kbGUuYXR0YWNoKFwiamFudXMucGx1Z2luLnNmdVwiLCB0aGlzLmxvb3BzID8gcGFyc2VJbnQob2NjdXBhbnRJZCkgJSB0aGlzLmxvb3BzIDogdW5kZWZpbmVkKTtcblxuICAgIHRoaXMuYXNzb2NpYXRlKGNvbm4sIGhhbmRsZSk7XG5cbiAgICBkZWJ1ZyhvY2N1cGFudElkICsgXCI6IHN1YiB3YWl0aW5nIGZvciBqb2luXCIpO1xuXG4gICAgaWYgKHRoaXMubGVmdE9jY3VwYW50cy5oYXMob2NjdXBhbnRJZCkpIHtcbiAgICAgIGNvbm4uY2xvc2UoKTtcbiAgICAgIGNvbnNvbGUud2FybihvY2N1cGFudElkICsgXCI6IGNhbmNlbGxlZCBvY2N1cGFudCBjb25uZWN0aW9uLCBvY2N1cGFudCBsZWZ0IGFmdGVyIGF0dGFjaFwiKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGxldCB3ZWJydGNGYWlsZWQgPSBmYWxzZTtcblxuICAgIGNvbnN0IHdlYnJ0Y3VwID0gbmV3IFByb21pc2UocmVzb2x2ZSA9PiB7XG4gICAgICBjb25zdCBsZWZ0SW50ZXJ2YWwgPSBzZXRJbnRlcnZhbCgoKSA9PiB7XG4gICAgICAgIGlmICh0aGlzLmxlZnRPY2N1cGFudHMuaGFzKG9jY3VwYW50SWQpKSB7XG4gICAgICAgICAgY2xlYXJJbnRlcnZhbChsZWZ0SW50ZXJ2YWwpO1xuICAgICAgICAgIHJlc29sdmUoKTtcbiAgICAgICAgfVxuICAgICAgfSwgMTAwMCk7XG5cbiAgICAgIGNvbnN0IHRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgY2xlYXJJbnRlcnZhbChsZWZ0SW50ZXJ2YWwpO1xuICAgICAgICB3ZWJydGNGYWlsZWQgPSB0cnVlO1xuICAgICAgICByZXNvbHZlKCk7XG4gICAgICB9LCBTVUJTQ1JJQkVfVElNRU9VVF9NUyk7XG5cbiAgICAgIGhhbmRsZS5vbihcIndlYnJ0Y3VwXCIsICgpID0+IHtcbiAgICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xuICAgICAgICBjbGVhckludGVydmFsKGxlZnRJbnRlcnZhbCk7XG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgLy8gU2VuZCBqb2luIG1lc3NhZ2UgdG8gamFudXMuIERvbid0IGxpc3RlbiBmb3Igam9pbi9sZWF2ZSBtZXNzYWdlcy4gU3Vic2NyaWJlIHRvIHRoZSBvY2N1cGFudCdzIG1lZGlhLlxuICAgIC8vIEphbnVzIHNob3VsZCBzZW5kIHVzIGFuIG9mZmVyIGZvciB0aGlzIG9jY3VwYW50J3MgbWVkaWEgaW4gcmVzcG9uc2UgdG8gdGhpcy5cbiAgICBhd2FpdCB0aGlzLnNlbmRKb2luKGhhbmRsZSwgeyBtZWRpYTogb2NjdXBhbnRJZCB9KTtcblxuICAgIGlmICh0aGlzLmxlZnRPY2N1cGFudHMuaGFzKG9jY3VwYW50SWQpKSB7XG4gICAgICBjb25uLmNsb3NlKCk7XG4gICAgICBjb25zb2xlLndhcm4ob2NjdXBhbnRJZCArIFwiOiBjYW5jZWxsZWQgb2NjdXBhbnQgY29ubmVjdGlvbiwgb2NjdXBhbnQgbGVmdCBhZnRlciBqb2luXCIpO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgZGVidWcob2NjdXBhbnRJZCArIFwiOiBzdWIgd2FpdGluZyBmb3Igd2VicnRjdXBcIik7XG4gICAgYXdhaXQgd2VicnRjdXA7XG5cbiAgICBpZiAodGhpcy5sZWZ0T2NjdXBhbnRzLmhhcyhvY2N1cGFudElkKSkge1xuICAgICAgY29ubi5jbG9zZSgpO1xuICAgICAgY29uc29sZS53YXJuKG9jY3VwYW50SWQgKyBcIjogY2FuY2VsIG9jY3VwYW50IGNvbm5lY3Rpb24sIG9jY3VwYW50IGxlZnQgZHVyaW5nIG9yIGFmdGVyIHdlYnJ0Y3VwXCIpO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgaWYgKHdlYnJ0Y0ZhaWxlZCkge1xuICAgICAgY29ubi5jbG9zZSgpO1xuICAgICAgaWYgKG1heFJldHJpZXMgPiAwKSB7XG4gICAgICAgIGNvbnNvbGUud2FybihvY2N1cGFudElkICsgXCI6IHdlYnJ0YyB1cCB0aW1lZCBvdXQsIHJldHJ5aW5nXCIpO1xuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVTdWJzY3JpYmVyKG9jY3VwYW50SWQsIG1heFJldHJpZXMgLSAxKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnNvbGUud2FybihvY2N1cGFudElkICsgXCI6IHdlYnJ0YyB1cCB0aW1lZCBvdXRcIik7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChpc1NhZmFyaSAmJiAhdGhpcy5faU9TSGFja0RlbGF5ZWRJbml0aWFsUGVlcikge1xuICAgICAgLy8gSEFDSzogdGhlIGZpcnN0IHBlZXIgb24gU2FmYXJpIGR1cmluZyBwYWdlIGxvYWQgY2FuIGZhaWwgdG8gd29yayBpZiB3ZSBkb24ndFxuICAgICAgLy8gd2FpdCBzb21lIHRpbWUgYmVmb3JlIGNvbnRpbnVpbmcgaGVyZS4gU2VlOiBodHRwczovL2dpdGh1Yi5jb20vbW96aWxsYS9odWJzL3B1bGwvMTY5MlxuICAgICAgYXdhaXQgKG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDMwMDApKSk7XG4gICAgICB0aGlzLl9pT1NIYWNrRGVsYXllZEluaXRpYWxQZWVyID0gdHJ1ZTtcbiAgICB9XG5cbiAgICB2YXIgbWVkaWFTdHJlYW0gPSBuZXcgTWVkaWFTdHJlYW0oKTtcbiAgICB2YXIgcmVjZWl2ZXJzID0gY29ubi5nZXRSZWNlaXZlcnMoKTtcbiAgICByZWNlaXZlcnMuZm9yRWFjaChyZWNlaXZlciA9PiB7XG4gICAgICBpZiAocmVjZWl2ZXIudHJhY2spIHtcbiAgICAgICAgbWVkaWFTdHJlYW0uYWRkVHJhY2socmVjZWl2ZXIudHJhY2spO1xuICAgICAgfVxuICAgIH0pO1xuICAgIGlmIChtZWRpYVN0cmVhbS5nZXRUcmFja3MoKS5sZW5ndGggPT09IDApIHtcbiAgICAgIG1lZGlhU3RyZWFtID0gbnVsbDtcbiAgICB9XG5cbiAgICBkZWJ1ZyhvY2N1cGFudElkICsgXCI6IHN1YnNjcmliZXIgcmVhZHlcIik7XG4gICAgcmV0dXJuIHtcbiAgICAgIGhhbmRsZSxcbiAgICAgIG1lZGlhU3RyZWFtLFxuICAgICAgY29ublxuICAgIH07XG4gIH1cblxuICBzZW5kSm9pbihoYW5kbGUsIHN1YnNjcmliZSkge1xuICAgIHJldHVybiBoYW5kbGUuc2VuZE1lc3NhZ2Uoe1xuICAgICAga2luZDogXCJqb2luXCIsXG4gICAgICByb29tX2lkOiB0aGlzLnJvb20sXG4gICAgICB1c2VyX2lkOiB0aGlzLmNsaWVudElkLFxuICAgICAgc3Vic2NyaWJlLFxuICAgICAgdG9rZW46IHRoaXMuam9pblRva2VuXG4gICAgfSk7XG4gIH1cblxuICB0b2dnbGVGcmVlemUoKSB7XG4gICAgaWYgKHRoaXMuZnJvemVuKSB7XG4gICAgICB0aGlzLnVuZnJlZXplKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuZnJlZXplKCk7XG4gICAgfVxuICB9XG5cbiAgZnJlZXplKCkge1xuICAgIHRoaXMuZnJvemVuID0gdHJ1ZTtcbiAgfVxuXG4gIHVuZnJlZXplKCkge1xuICAgIHRoaXMuZnJvemVuID0gZmFsc2U7XG4gICAgdGhpcy5mbHVzaFBlbmRpbmdVcGRhdGVzKCk7XG4gIH1cblxuICBkYXRhRm9yVXBkYXRlTXVsdGlNZXNzYWdlKG5ldHdvcmtJZCwgbWVzc2FnZSkge1xuICAgIC8vIFwiZFwiIGlzIGFuIGFycmF5IG9mIGVudGl0eSBkYXRhcywgd2hlcmUgZWFjaCBpdGVtIGluIHRoZSBhcnJheSByZXByZXNlbnRzIGEgdW5pcXVlIGVudGl0eSBhbmQgY29udGFpbnNcbiAgICAvLyBtZXRhZGF0YSBmb3IgdGhlIGVudGl0eSwgYW5kIGFuIGFycmF5IG9mIGNvbXBvbmVudHMgdGhhdCBoYXZlIGJlZW4gdXBkYXRlZCBvbiB0aGUgZW50aXR5LlxuICAgIC8vIFRoaXMgbWV0aG9kIGZpbmRzIHRoZSBkYXRhIGNvcnJlc3BvbmRpbmcgdG8gdGhlIGdpdmVuIG5ldHdvcmtJZC5cbiAgICBmb3IgKGxldCBpID0gMCwgbCA9IG1lc3NhZ2UuZGF0YS5kLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgY29uc3QgZGF0YSA9IG1lc3NhZ2UuZGF0YS5kW2ldO1xuXG4gICAgICBpZiAoZGF0YS5uZXR3b3JrSWQgPT09IG5ldHdvcmtJZCkge1xuICAgICAgICByZXR1cm4gZGF0YTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGdldFBlbmRpbmdEYXRhKG5ldHdvcmtJZCwgbWVzc2FnZSkge1xuICAgIGlmICghbWVzc2FnZSkgcmV0dXJuIG51bGw7XG5cbiAgICBsZXQgZGF0YSA9IG1lc3NhZ2UuZGF0YVR5cGUgPT09IFwidW1cIiA/IHRoaXMuZGF0YUZvclVwZGF0ZU11bHRpTWVzc2FnZShuZXR3b3JrSWQsIG1lc3NhZ2UpIDogbWVzc2FnZS5kYXRhO1xuXG4gICAgLy8gSWdub3JlIG1lc3NhZ2VzIHJlbGF0aW5nIHRvIHVzZXJzIHdobyBoYXZlIGRpc2Nvbm5lY3RlZCBzaW5jZSBmcmVlemluZywgdGhlaXIgZW50aXRpZXNcbiAgICAvLyB3aWxsIGhhdmUgYWxlYWR5IGJlZW4gcmVtb3ZlZCBieSBOQUYuXG4gICAgLy8gTm90ZSB0aGF0IGRlbGV0ZSBtZXNzYWdlcyBoYXZlIG5vIFwib3duZXJcIiBzbyB3ZSBoYXZlIHRvIGNoZWNrIGZvciB0aGF0IGFzIHdlbGwuXG4gICAgaWYgKGRhdGEub3duZXIgJiYgIXRoaXMub2NjdXBhbnRzW2RhdGEub3duZXJdKSByZXR1cm4gbnVsbDtcblxuICAgIC8vIElnbm9yZSBtZXNzYWdlcyBmcm9tIHVzZXJzIHRoYXQgd2UgbWF5IGhhdmUgYmxvY2tlZCB3aGlsZSBmcm96ZW4uXG4gICAgaWYgKGRhdGEub3duZXIgJiYgdGhpcy5ibG9ja2VkQ2xpZW50cy5oYXMoZGF0YS5vd25lcikpIHJldHVybiBudWxsO1xuXG4gICAgcmV0dXJuIGRhdGFcbiAgfVxuXG4gIC8vIFVzZWQgZXh0ZXJuYWxseVxuICBnZXRQZW5kaW5nRGF0YUZvck5ldHdvcmtJZChuZXR3b3JrSWQpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRQZW5kaW5nRGF0YShuZXR3b3JrSWQsIHRoaXMuZnJvemVuVXBkYXRlcy5nZXQobmV0d29ya0lkKSk7XG4gIH1cblxuICBmbHVzaFBlbmRpbmdVcGRhdGVzKCkge1xuICAgIGZvciAoY29uc3QgW25ldHdvcmtJZCwgbWVzc2FnZV0gb2YgdGhpcy5mcm96ZW5VcGRhdGVzKSB7XG4gICAgICBsZXQgZGF0YSA9IHRoaXMuZ2V0UGVuZGluZ0RhdGEobmV0d29ya0lkLCBtZXNzYWdlKTtcbiAgICAgIGlmICghZGF0YSkgY29udGludWU7XG5cbiAgICAgIC8vIE92ZXJyaWRlIHRoZSBkYXRhIHR5cGUgb24gXCJ1bVwiIG1lc3NhZ2VzIHR5cGVzLCBzaW5jZSB3ZSBleHRyYWN0IGVudGl0eSB1cGRhdGVzIGZyb20gXCJ1bVwiIG1lc3NhZ2VzIGludG9cbiAgICAgIC8vIGluZGl2aWR1YWwgZnJvemVuVXBkYXRlcyBpbiBzdG9yZVNpbmdsZU1lc3NhZ2UuXG4gICAgICBjb25zdCBkYXRhVHlwZSA9IG1lc3NhZ2UuZGF0YVR5cGUgPT09IFwidW1cIiA/IFwidVwiIDogbWVzc2FnZS5kYXRhVHlwZTtcblxuICAgICAgdGhpcy5vbk9jY3VwYW50TWVzc2FnZShudWxsLCBkYXRhVHlwZSwgZGF0YSwgbWVzc2FnZS5zb3VyY2UpO1xuICAgIH1cbiAgICB0aGlzLmZyb3plblVwZGF0ZXMuY2xlYXIoKTtcbiAgfVxuXG4gIHN0b3JlTWVzc2FnZShtZXNzYWdlKSB7XG4gICAgaWYgKG1lc3NhZ2UuZGF0YVR5cGUgPT09IFwidW1cIikgeyAvLyBVcGRhdGVNdWx0aVxuICAgICAgZm9yIChsZXQgaSA9IDAsIGwgPSBtZXNzYWdlLmRhdGEuZC5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAgICAgdGhpcy5zdG9yZVNpbmdsZU1lc3NhZ2UobWVzc2FnZSwgaSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuc3RvcmVTaW5nbGVNZXNzYWdlKG1lc3NhZ2UpO1xuICAgIH1cbiAgfVxuXG4gIHN0b3JlU2luZ2xlTWVzc2FnZShtZXNzYWdlLCBpbmRleCkge1xuICAgIGNvbnN0IGRhdGEgPSBpbmRleCAhPT0gdW5kZWZpbmVkID8gbWVzc2FnZS5kYXRhLmRbaW5kZXhdIDogbWVzc2FnZS5kYXRhO1xuICAgIGNvbnN0IGRhdGFUeXBlID0gbWVzc2FnZS5kYXRhVHlwZTtcbiAgICBjb25zdCBzb3VyY2UgPSBtZXNzYWdlLnNvdXJjZTtcblxuICAgIGNvbnN0IG5ldHdvcmtJZCA9IGRhdGEubmV0d29ya0lkO1xuXG4gICAgaWYgKCF0aGlzLmZyb3plblVwZGF0ZXMuaGFzKG5ldHdvcmtJZCkpIHtcbiAgICAgIHRoaXMuZnJvemVuVXBkYXRlcy5zZXQobmV0d29ya0lkLCBtZXNzYWdlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3Qgc3RvcmVkTWVzc2FnZSA9IHRoaXMuZnJvemVuVXBkYXRlcy5nZXQobmV0d29ya0lkKTtcbiAgICAgIGNvbnN0IHN0b3JlZERhdGEgPSBzdG9yZWRNZXNzYWdlLmRhdGFUeXBlID09PSBcInVtXCIgPyB0aGlzLmRhdGFGb3JVcGRhdGVNdWx0aU1lc3NhZ2UobmV0d29ya0lkLCBzdG9yZWRNZXNzYWdlKSA6IHN0b3JlZE1lc3NhZ2UuZGF0YTtcblxuICAgICAgLy8gQXZvaWQgdXBkYXRpbmcgY29tcG9uZW50cyBpZiB0aGUgZW50aXR5IGRhdGEgcmVjZWl2ZWQgZGlkIG5vdCBjb21lIGZyb20gdGhlIGN1cnJlbnQgb3duZXIuXG4gICAgICBjb25zdCBpc091dGRhdGVkTWVzc2FnZSA9IGRhdGEubGFzdE93bmVyVGltZSA8IHN0b3JlZERhdGEubGFzdE93bmVyVGltZTtcbiAgICAgIGNvbnN0IGlzQ29udGVtcG9yYW5lb3VzTWVzc2FnZSA9IGRhdGEubGFzdE93bmVyVGltZSA9PT0gc3RvcmVkRGF0YS5sYXN0T3duZXJUaW1lO1xuICAgICAgaWYgKGlzT3V0ZGF0ZWRNZXNzYWdlIHx8IChpc0NvbnRlbXBvcmFuZW91c01lc3NhZ2UgJiYgc3RvcmVkRGF0YS5vd25lciA+IGRhdGEub3duZXIpKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKGRhdGFUeXBlID09PSBcInJcIikge1xuICAgICAgICBjb25zdCBjcmVhdGVkV2hpbGVGcm96ZW4gPSBzdG9yZWREYXRhICYmIHN0b3JlZERhdGEuaXNGaXJzdFN5bmM7XG4gICAgICAgIGlmIChjcmVhdGVkV2hpbGVGcm96ZW4pIHtcbiAgICAgICAgICAvLyBJZiB0aGUgZW50aXR5IHdhcyBjcmVhdGVkIGFuZCBkZWxldGVkIHdoaWxlIGZyb3plbiwgZG9uJ3QgYm90aGVyIGNvbnZleWluZyBhbnl0aGluZyB0byB0aGUgY29uc3VtZXIuXG4gICAgICAgICAgdGhpcy5mcm96ZW5VcGRhdGVzLmRlbGV0ZShuZXR3b3JrSWQpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIERlbGV0ZSBtZXNzYWdlcyBvdmVycmlkZSBhbnkgb3RoZXIgbWVzc2FnZXMgZm9yIHRoaXMgZW50aXR5XG4gICAgICAgICAgdGhpcy5mcm96ZW5VcGRhdGVzLnNldChuZXR3b3JrSWQsIG1lc3NhZ2UpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBtZXJnZSBpbiBjb21wb25lbnQgdXBkYXRlc1xuICAgICAgICBpZiAoc3RvcmVkRGF0YS5jb21wb25lbnRzICYmIGRhdGEuY29tcG9uZW50cykge1xuICAgICAgICAgIE9iamVjdC5hc3NpZ24oc3RvcmVkRGF0YS5jb21wb25lbnRzLCBkYXRhLmNvbXBvbmVudHMpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgb25EYXRhQ2hhbm5lbE1lc3NhZ2UoZSwgc291cmNlKSB7XG4gICAgdGhpcy5vbkRhdGEoSlNPTi5wYXJzZShlLmRhdGEpLCBzb3VyY2UpO1xuICB9XG5cbiAgb25EYXRhKG1lc3NhZ2UsIHNvdXJjZSkge1xuICAgIGlmIChkZWJ1Zy5lbmFibGVkKSB7XG4gICAgICBkZWJ1ZyhgREMgaW46ICR7bWVzc2FnZX1gKTtcbiAgICB9XG5cbiAgICBpZiAoIW1lc3NhZ2UuZGF0YVR5cGUpIHJldHVybjtcblxuICAgIG1lc3NhZ2Uuc291cmNlID0gc291cmNlO1xuXG4gICAgaWYgKHRoaXMuZnJvemVuKSB7XG4gICAgICB0aGlzLnN0b3JlTWVzc2FnZShtZXNzYWdlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5vbk9jY3VwYW50TWVzc2FnZShudWxsLCBtZXNzYWdlLmRhdGFUeXBlLCBtZXNzYWdlLmRhdGEsIG1lc3NhZ2Uuc291cmNlKTtcbiAgICB9XG4gIH1cblxuICBzaG91bGRTdGFydENvbm5lY3Rpb25UbyhjbGllbnQpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIHN0YXJ0U3RyZWFtQ29ubmVjdGlvbihjbGllbnQpIHt9XG5cbiAgY2xvc2VTdHJlYW1Db25uZWN0aW9uKGNsaWVudCkge31cblxuICBnZXRDb25uZWN0U3RhdHVzKGNsaWVudElkKSB7XG4gICAgcmV0dXJuIHRoaXMub2NjdXBhbnRzW2NsaWVudElkXSA/IE5BRi5hZGFwdGVycy5JU19DT05ORUNURUQgOiBOQUYuYWRhcHRlcnMuTk9UX0NPTk5FQ1RFRDtcbiAgfVxuXG4gIGFzeW5jIHVwZGF0ZVRpbWVPZmZzZXQoKSB7XG4gICAgaWYgKHRoaXMuaXNEaXNjb25uZWN0ZWQoKSkgcmV0dXJuO1xuXG4gICAgY29uc3QgY2xpZW50U2VudFRpbWUgPSBEYXRlLm5vdygpO1xuXG4gICAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2goZG9jdW1lbnQubG9jYXRpb24uaHJlZiwge1xuICAgICAgbWV0aG9kOiBcIkhFQURcIixcbiAgICAgIGNhY2hlOiBcIm5vLWNhY2hlXCJcbiAgICB9KTtcblxuICAgIGNvbnN0IHByZWNpc2lvbiA9IDEwMDA7XG4gICAgY29uc3Qgc2VydmVyUmVjZWl2ZWRUaW1lID0gbmV3IERhdGUocmVzLmhlYWRlcnMuZ2V0KFwiRGF0ZVwiKSkuZ2V0VGltZSgpICsgcHJlY2lzaW9uIC8gMjtcbiAgICBjb25zdCBjbGllbnRSZWNlaXZlZFRpbWUgPSBEYXRlLm5vdygpO1xuICAgIGNvbnN0IHNlcnZlclRpbWUgPSBzZXJ2ZXJSZWNlaXZlZFRpbWUgKyAoY2xpZW50UmVjZWl2ZWRUaW1lIC0gY2xpZW50U2VudFRpbWUpIC8gMjtcbiAgICBjb25zdCB0aW1lT2Zmc2V0ID0gc2VydmVyVGltZSAtIGNsaWVudFJlY2VpdmVkVGltZTtcblxuICAgIHRoaXMuc2VydmVyVGltZVJlcXVlc3RzKys7XG5cbiAgICBpZiAodGhpcy5zZXJ2ZXJUaW1lUmVxdWVzdHMgPD0gMTApIHtcbiAgICAgIHRoaXMudGltZU9mZnNldHMucHVzaCh0aW1lT2Zmc2V0KTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy50aW1lT2Zmc2V0c1t0aGlzLnNlcnZlclRpbWVSZXF1ZXN0cyAlIDEwXSA9IHRpbWVPZmZzZXQ7XG4gICAgfVxuXG4gICAgdGhpcy5hdmdUaW1lT2Zmc2V0ID0gdGhpcy50aW1lT2Zmc2V0cy5yZWR1Y2UoKGFjYywgb2Zmc2V0KSA9PiAoYWNjICs9IG9mZnNldCksIDApIC8gdGhpcy50aW1lT2Zmc2V0cy5sZW5ndGg7XG5cbiAgICBpZiAodGhpcy5zZXJ2ZXJUaW1lUmVxdWVzdHMgPiAxMCkge1xuICAgICAgZGVidWcoYG5ldyBzZXJ2ZXIgdGltZSBvZmZzZXQ6ICR7dGhpcy5hdmdUaW1lT2Zmc2V0fW1zYCk7XG4gICAgICBzZXRUaW1lb3V0KCgpID0+IHRoaXMudXBkYXRlVGltZU9mZnNldCgpLCA1ICogNjAgKiAxMDAwKTsgLy8gU3luYyBjbG9jayBldmVyeSA1IG1pbnV0ZXMuXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMudXBkYXRlVGltZU9mZnNldCgpO1xuICAgIH1cbiAgfVxuXG4gIGdldFNlcnZlclRpbWUoKSB7XG4gICAgcmV0dXJuIERhdGUubm93KCkgKyB0aGlzLmF2Z1RpbWVPZmZzZXQ7XG4gIH1cblxuICBnZXRNZWRpYVN0cmVhbShjbGllbnRJZCwgdHlwZSA9IFwiYXVkaW9cIikge1xuICAgIGlmICh0aGlzLm1lZGlhU3RyZWFtc1tjbGllbnRJZF0pIHtcbiAgICAgIGRlYnVnKGBBbHJlYWR5IGhhZCAke3R5cGV9IGZvciAke2NsaWVudElkfWApO1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh0aGlzLm1lZGlhU3RyZWFtc1tjbGllbnRJZF1bdHlwZV0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBkZWJ1ZyhgV2FpdGluZyBvbiAke3R5cGV9IGZvciAke2NsaWVudElkfWApO1xuICAgICAgaWYgKCF0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmhhcyhjbGllbnRJZCkpIHtcbiAgICAgICAgdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5zZXQoY2xpZW50SWQsIHt9KTtcblxuICAgICAgICBjb25zdCBhdWRpb1Byb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgICAgdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5nZXQoY2xpZW50SWQpLmF1ZGlvID0geyByZXNvbHZlLCByZWplY3QgfTtcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IHZpZGVvUHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgICB0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmdldChjbGllbnRJZCkudmlkZW8gPSB7IHJlc29sdmUsIHJlamVjdCB9O1xuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmdldChjbGllbnRJZCkuYXVkaW8ucHJvbWlzZSA9IGF1ZGlvUHJvbWlzZTtcbiAgICAgICAgdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5nZXQoY2xpZW50SWQpLnZpZGVvLnByb21pc2UgPSB2aWRlb1Byb21pc2U7XG5cbiAgICAgICAgYXVkaW9Qcm9taXNlLmNhdGNoKGUgPT4gY29uc29sZS53YXJuKGAke2NsaWVudElkfSBnZXRNZWRpYVN0cmVhbSBBdWRpbyBFcnJvcmAsIGUpKTtcbiAgICAgICAgdmlkZW9Qcm9taXNlLmNhdGNoKGUgPT4gY29uc29sZS53YXJuKGAke2NsaWVudElkfSBnZXRNZWRpYVN0cmVhbSBWaWRlbyBFcnJvcmAsIGUpKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmdldChjbGllbnRJZClbdHlwZV0ucHJvbWlzZTtcbiAgICB9XG4gIH1cblxuICBzZXRNZWRpYVN0cmVhbShjbGllbnRJZCwgc3RyZWFtKSB7XG4gICAgLy8gU2FmYXJpIGRvZXNuJ3QgbGlrZSBpdCB3aGVuIHlvdSB1c2Ugc2luZ2xlIGEgbWl4ZWQgbWVkaWEgc3RyZWFtIHdoZXJlIG9uZSBvZiB0aGUgdHJhY2tzIGlzIGluYWN0aXZlLCBzbyB3ZVxuICAgIC8vIHNwbGl0IHRoZSB0cmFja3MgaW50byB0d28gc3RyZWFtcy5cbiAgICBjb25zdCBhdWRpb1N0cmVhbSA9IG5ldyBNZWRpYVN0cmVhbSgpO1xuICAgIHRyeSB7XG4gICAgc3RyZWFtLmdldEF1ZGlvVHJhY2tzKCkuZm9yRWFjaCh0cmFjayA9PiBhdWRpb1N0cmVhbS5hZGRUcmFjayh0cmFjaykpO1xuXG4gICAgfSBjYXRjaChlKSB7XG4gICAgICBjb25zb2xlLndhcm4oYCR7Y2xpZW50SWR9IHNldE1lZGlhU3RyZWFtIEF1ZGlvIEVycm9yYCwgZSk7XG4gICAgfVxuICAgIGNvbnN0IHZpZGVvU3RyZWFtID0gbmV3IE1lZGlhU3RyZWFtKCk7XG4gICAgdHJ5IHtcbiAgICBzdHJlYW0uZ2V0VmlkZW9UcmFja3MoKS5mb3JFYWNoKHRyYWNrID0+IHZpZGVvU3RyZWFtLmFkZFRyYWNrKHRyYWNrKSk7XG5cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjb25zb2xlLndhcm4oYCR7Y2xpZW50SWR9IHNldE1lZGlhU3RyZWFtIFZpZGVvIEVycm9yYCwgZSk7XG4gICAgfVxuXG4gICAgdGhpcy5tZWRpYVN0cmVhbXNbY2xpZW50SWRdID0geyBhdWRpbzogYXVkaW9TdHJlYW0sIHZpZGVvOiB2aWRlb1N0cmVhbSB9O1xuXG4gICAgLy8gUmVzb2x2ZSB0aGUgcHJvbWlzZSBmb3IgdGhlIHVzZXIncyBtZWRpYSBzdHJlYW0gaWYgaXQgZXhpc3RzLlxuICAgIGlmICh0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmhhcyhjbGllbnRJZCkpIHtcbiAgICAgIHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuZ2V0KGNsaWVudElkKS5hdWRpby5yZXNvbHZlKGF1ZGlvU3RyZWFtKTtcbiAgICAgIHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuZ2V0KGNsaWVudElkKS52aWRlby5yZXNvbHZlKHZpZGVvU3RyZWFtKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBzZXRMb2NhbE1lZGlhU3RyZWFtKHN0cmVhbSkge1xuICAgIC8vIG91ciBqb2IgaGVyZSBpcyB0byBtYWtlIHN1cmUgdGhlIGNvbm5lY3Rpb24gd2luZHMgdXAgd2l0aCBSVFAgc2VuZGVycyBzZW5kaW5nIHRoZSBzdHVmZiBpbiB0aGlzIHN0cmVhbSxcbiAgICAvLyBhbmQgbm90IHRoZSBzdHVmZiB0aGF0IGlzbid0IGluIHRoaXMgc3RyZWFtLiBzdHJhdGVneSBpcyB0byByZXBsYWNlIGV4aXN0aW5nIHRyYWNrcyBpZiB3ZSBjYW4sIGFkZCB0cmFja3NcbiAgICAvLyB0aGF0IHdlIGNhbid0IHJlcGxhY2UsIGFuZCBkaXNhYmxlIHRyYWNrcyB0aGF0IGRvbid0IGV4aXN0IGFueW1vcmUuXG5cbiAgICAvLyBub3RlIHRoYXQgd2UgZG9uJ3QgZXZlciByZW1vdmUgYSB0cmFjayBmcm9tIHRoZSBzdHJlYW0gLS0gc2luY2UgSmFudXMgZG9lc24ndCBzdXBwb3J0IFVuaWZpZWQgUGxhbiwgd2UgYWJzb2x1dGVseVxuICAgIC8vIGNhbid0IHdpbmQgdXAgd2l0aCBhIFNEUCB0aGF0IGhhcyA+MSBhdWRpbyBvciA+MSB2aWRlbyB0cmFja3MsIGV2ZW4gaWYgb25lIG9mIHRoZW0gaXMgaW5hY3RpdmUgKHdoYXQgeW91IGdldCBpZlxuICAgIC8vIHlvdSByZW1vdmUgYSB0cmFjayBmcm9tIGFuIGV4aXN0aW5nIHN0cmVhbS4pXG4gICAgaWYgKHRoaXMucHVibGlzaGVyICYmIHRoaXMucHVibGlzaGVyLmNvbm4pIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nU2VuZGVycyA9IHRoaXMucHVibGlzaGVyLmNvbm4uZ2V0U2VuZGVycygpO1xuICAgICAgY29uc3QgbmV3U2VuZGVycyA9IFtdO1xuICAgICAgY29uc3QgdHJhY2tzID0gc3RyZWFtLmdldFRyYWNrcygpO1xuXG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRyYWNrcy5sZW5ndGg7IGkrKykge1xuICAgICAgICBjb25zdCB0ID0gdHJhY2tzW2ldO1xuICAgICAgICBjb25zdCBzZW5kZXIgPSBleGlzdGluZ1NlbmRlcnMuZmluZChzID0+IHMudHJhY2sgIT0gbnVsbCAmJiBzLnRyYWNrLmtpbmQgPT0gdC5raW5kKTtcblxuICAgICAgICBpZiAoc2VuZGVyICE9IG51bGwpIHtcbiAgICAgICAgICBpZiAoc2VuZGVyLnJlcGxhY2VUcmFjaykge1xuICAgICAgICAgICAgYXdhaXQgc2VuZGVyLnJlcGxhY2VUcmFjayh0KTtcblxuICAgICAgICAgICAgLy8gV29ya2Fyb3VuZCBodHRwczovL2J1Z3ppbGxhLm1vemlsbGEub3JnL3Nob3dfYnVnLmNnaT9pZD0xNTc2NzcxXG4gICAgICAgICAgICBpZiAodC5raW5kID09PSBcInZpZGVvXCIgJiYgdC5lbmFibGVkICYmIG5hdmlnYXRvci51c2VyQWdlbnQudG9Mb3dlckNhc2UoKS5pbmRleE9mKCdmaXJlZm94JykgPiAtMSkge1xuICAgICAgICAgICAgICB0LmVuYWJsZWQgPSBmYWxzZTtcbiAgICAgICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB0LmVuYWJsZWQgPSB0cnVlLCAxMDAwKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gRmFsbGJhY2sgZm9yIGJyb3dzZXJzIHRoYXQgZG9uJ3Qgc3VwcG9ydCByZXBsYWNlVHJhY2suIEF0IHRoaXMgdGltZSBvZiB0aGlzIHdyaXRpbmdcbiAgICAgICAgICAgIC8vIG1vc3QgYnJvd3NlcnMgc3VwcG9ydCBpdCwgYW5kIHRlc3RpbmcgdGhpcyBjb2RlIHBhdGggc2VlbXMgdG8gbm90IHdvcmsgcHJvcGVybHlcbiAgICAgICAgICAgIC8vIGluIENocm9tZSBhbnltb3JlLlxuICAgICAgICAgICAgc3RyZWFtLnJlbW92ZVRyYWNrKHNlbmRlci50cmFjayk7XG4gICAgICAgICAgICBzdHJlYW0uYWRkVHJhY2sodCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIG5ld1NlbmRlcnMucHVzaChzZW5kZXIpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIG5ld1NlbmRlcnMucHVzaCh0aGlzLnB1Ymxpc2hlci5jb25uLmFkZFRyYWNrKHQsIHN0cmVhbSkpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBleGlzdGluZ1NlbmRlcnMuZm9yRWFjaChzID0+IHtcbiAgICAgICAgaWYgKCFuZXdTZW5kZXJzLmluY2x1ZGVzKHMpKSB7XG4gICAgICAgICAgcy50cmFjay5lbmFibGVkID0gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgICB0aGlzLmxvY2FsTWVkaWFTdHJlYW0gPSBzdHJlYW07XG4gICAgdGhpcy5zZXRNZWRpYVN0cmVhbSh0aGlzLmNsaWVudElkLCBzdHJlYW0pO1xuICB9XG5cbiAgZW5hYmxlTWljcm9waG9uZShlbmFibGVkKSB7XG4gICAgaWYgKHRoaXMucHVibGlzaGVyICYmIHRoaXMucHVibGlzaGVyLmNvbm4pIHtcbiAgICAgIHRoaXMucHVibGlzaGVyLmNvbm4uZ2V0U2VuZGVycygpLmZvckVhY2gocyA9PiB7XG4gICAgICAgIGlmIChzLnRyYWNrLmtpbmQgPT0gXCJhdWRpb1wiKSB7XG4gICAgICAgICAgcy50cmFjay5lbmFibGVkID0gZW5hYmxlZDtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgc2VuZERhdGEoY2xpZW50SWQsIGRhdGFUeXBlLCBkYXRhKSB7XG4gICAgaWYgKCF0aGlzLnB1Ymxpc2hlcikge1xuICAgICAgY29uc29sZS53YXJuKFwic2VuZERhdGEgY2FsbGVkIHdpdGhvdXQgYSBwdWJsaXNoZXJcIik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHN3aXRjaCAodGhpcy51bnJlbGlhYmxlVHJhbnNwb3J0KSB7XG4gICAgICAgIGNhc2UgXCJ3ZWJzb2NrZXRcIjpcbiAgICAgICAgICB0aGlzLnB1Ymxpc2hlci5oYW5kbGUuc2VuZE1lc3NhZ2UoeyBraW5kOiBcImRhdGFcIiwgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBkYXRhVHlwZSwgZGF0YSB9KSwgd2hvbTogY2xpZW50SWQgfSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgXCJkYXRhY2hhbm5lbFwiOlxuICAgICAgICAgIHRoaXMucHVibGlzaGVyLnVucmVsaWFibGVDaGFubmVsLnNlbmQoSlNPTi5zdHJpbmdpZnkoeyBjbGllbnRJZCwgZGF0YVR5cGUsIGRhdGEgfSkpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHRoaXMudW5yZWxpYWJsZVRyYW5zcG9ydChjbGllbnRJZCwgZGF0YVR5cGUsIGRhdGEpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHNlbmREYXRhR3VhcmFudGVlZChjbGllbnRJZCwgZGF0YVR5cGUsIGRhdGEpIHtcbiAgICBpZiAoIXRoaXMucHVibGlzaGVyKSB7XG4gICAgICBjb25zb2xlLndhcm4oXCJzZW5kRGF0YUd1YXJhbnRlZWQgY2FsbGVkIHdpdGhvdXQgYSBwdWJsaXNoZXJcIik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHN3aXRjaCAodGhpcy5yZWxpYWJsZVRyYW5zcG9ydCkge1xuICAgICAgICBjYXNlIFwid2Vic29ja2V0XCI6XG4gICAgICAgICAgdGhpcy5wdWJsaXNoZXIuaGFuZGxlLnNlbmRNZXNzYWdlKHsga2luZDogXCJkYXRhXCIsIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZGF0YVR5cGUsIGRhdGEgfSksIHdob206IGNsaWVudElkIH0pO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIFwiZGF0YWNoYW5uZWxcIjpcbiAgICAgICAgICB0aGlzLnB1Ymxpc2hlci5yZWxpYWJsZUNoYW5uZWwuc2VuZChKU09OLnN0cmluZ2lmeSh7IGNsaWVudElkLCBkYXRhVHlwZSwgZGF0YSB9KSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgdGhpcy5yZWxpYWJsZVRyYW5zcG9ydChjbGllbnRJZCwgZGF0YVR5cGUsIGRhdGEpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGJyb2FkY2FzdERhdGEoZGF0YVR5cGUsIGRhdGEpIHtcbiAgICBpZiAoIXRoaXMucHVibGlzaGVyKSB7XG4gICAgICBjb25zb2xlLndhcm4oXCJicm9hZGNhc3REYXRhIGNhbGxlZCB3aXRob3V0IGEgcHVibGlzaGVyXCIpO1xuICAgIH0gZWxzZSB7XG4gICAgICBzd2l0Y2ggKHRoaXMudW5yZWxpYWJsZVRyYW5zcG9ydCkge1xuICAgICAgICBjYXNlIFwid2Vic29ja2V0XCI6XG4gICAgICAgICAgdGhpcy5wdWJsaXNoZXIuaGFuZGxlLnNlbmRNZXNzYWdlKHsga2luZDogXCJkYXRhXCIsIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZGF0YVR5cGUsIGRhdGEgfSkgfSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgXCJkYXRhY2hhbm5lbFwiOlxuICAgICAgICAgIHRoaXMucHVibGlzaGVyLnVucmVsaWFibGVDaGFubmVsLnNlbmQoSlNPTi5zdHJpbmdpZnkoeyBkYXRhVHlwZSwgZGF0YSB9KSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgdGhpcy51bnJlbGlhYmxlVHJhbnNwb3J0KHVuZGVmaW5lZCwgZGF0YVR5cGUsIGRhdGEpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGJyb2FkY2FzdERhdGFHdWFyYW50ZWVkKGRhdGFUeXBlLCBkYXRhKSB7XG4gICAgaWYgKCF0aGlzLnB1Ymxpc2hlcikge1xuICAgICAgY29uc29sZS53YXJuKFwiYnJvYWRjYXN0RGF0YUd1YXJhbnRlZWQgY2FsbGVkIHdpdGhvdXQgYSBwdWJsaXNoZXJcIik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHN3aXRjaCAodGhpcy5yZWxpYWJsZVRyYW5zcG9ydCkge1xuICAgICAgICBjYXNlIFwid2Vic29ja2V0XCI6XG4gICAgICAgICAgdGhpcy5wdWJsaXNoZXIuaGFuZGxlLnNlbmRNZXNzYWdlKHsga2luZDogXCJkYXRhXCIsIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZGF0YVR5cGUsIGRhdGEgfSkgfSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgXCJkYXRhY2hhbm5lbFwiOlxuICAgICAgICAgIHRoaXMucHVibGlzaGVyLnJlbGlhYmxlQ2hhbm5lbC5zZW5kKEpTT04uc3RyaW5naWZ5KHsgZGF0YVR5cGUsIGRhdGEgfSkpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHRoaXMucmVsaWFibGVUcmFuc3BvcnQodW5kZWZpbmVkLCBkYXRhVHlwZSwgZGF0YSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAga2ljayhjbGllbnRJZCwgcGVybXNUb2tlbikge1xuICAgIHJldHVybiB0aGlzLnB1Ymxpc2hlci5oYW5kbGUuc2VuZE1lc3NhZ2UoeyBraW5kOiBcImtpY2tcIiwgcm9vbV9pZDogdGhpcy5yb29tLCB1c2VyX2lkOiBjbGllbnRJZCwgdG9rZW46IHBlcm1zVG9rZW4gfSkudGhlbigoKSA9PiB7XG4gICAgICBkb2N1bWVudC5ib2R5LmRpc3BhdGNoRXZlbnQobmV3IEN1c3RvbUV2ZW50KFwia2lja2VkXCIsIHsgZGV0YWlsOiB7IGNsaWVudElkOiBjbGllbnRJZCB9IH0pKTtcbiAgICB9KTtcbiAgfVxuXG4gIGJsb2NrKGNsaWVudElkKSB7XG4gICAgcmV0dXJuIHRoaXMucHVibGlzaGVyLmhhbmRsZS5zZW5kTWVzc2FnZSh7IGtpbmQ6IFwiYmxvY2tcIiwgd2hvbTogY2xpZW50SWQgfSkudGhlbigoKSA9PiB7XG4gICAgICB0aGlzLmJsb2NrZWRDbGllbnRzLnNldChjbGllbnRJZCwgdHJ1ZSk7XG4gICAgICBkb2N1bWVudC5ib2R5LmRpc3BhdGNoRXZlbnQobmV3IEN1c3RvbUV2ZW50KFwiYmxvY2tlZFwiLCB7IGRldGFpbDogeyBjbGllbnRJZDogY2xpZW50SWQgfSB9KSk7XG4gICAgfSk7XG4gIH1cblxuICB1bmJsb2NrKGNsaWVudElkKSB7XG4gICAgcmV0dXJuIHRoaXMucHVibGlzaGVyLmhhbmRsZS5zZW5kTWVzc2FnZSh7IGtpbmQ6IFwidW5ibG9ja1wiLCB3aG9tOiBjbGllbnRJZCB9KS50aGVuKCgpID0+IHtcbiAgICAgIHRoaXMuYmxvY2tlZENsaWVudHMuZGVsZXRlKGNsaWVudElkKTtcbiAgICAgIGRvY3VtZW50LmJvZHkuZGlzcGF0Y2hFdmVudChuZXcgQ3VzdG9tRXZlbnQoXCJ1bmJsb2NrZWRcIiwgeyBkZXRhaWw6IHsgY2xpZW50SWQ6IGNsaWVudElkIH0gfSkpO1xuICAgIH0pO1xuICB9XG59XG5cbk5BRi5hZGFwdGVycy5yZWdpc3RlcihcImphbnVzXCIsIEphbnVzQWRhcHRlcik7XG5cbm1vZHVsZS5leHBvcnRzID0gSmFudXNBZGFwdGVyO1xuIiwiLyogZXNsaW50LWVudiBub2RlICovXG4ndXNlIHN0cmljdCc7XG5cbi8vIFNEUCBoZWxwZXJzLlxuY29uc3QgU0RQVXRpbHMgPSB7fTtcblxuLy8gR2VuZXJhdGUgYW4gYWxwaGFudW1lcmljIGlkZW50aWZpZXIgZm9yIGNuYW1lIG9yIG1pZHMuXG4vLyBUT0RPOiB1c2UgVVVJRHMgaW5zdGVhZD8gaHR0cHM6Ly9naXN0LmdpdGh1Yi5jb20vamVkLzk4Mjg4M1xuU0RQVXRpbHMuZ2VuZXJhdGVJZGVudGlmaWVyID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zdWJzdHJpbmcoMiwgMTIpO1xufTtcblxuLy8gVGhlIFJUQ1AgQ05BTUUgdXNlZCBieSBhbGwgcGVlcmNvbm5lY3Rpb25zIGZyb20gdGhlIHNhbWUgSlMuXG5TRFBVdGlscy5sb2NhbENOYW1lID0gU0RQVXRpbHMuZ2VuZXJhdGVJZGVudGlmaWVyKCk7XG5cbi8vIFNwbGl0cyBTRFAgaW50byBsaW5lcywgZGVhbGluZyB3aXRoIGJvdGggQ1JMRiBhbmQgTEYuXG5TRFBVdGlscy5zcGxpdExpbmVzID0gZnVuY3Rpb24oYmxvYikge1xuICByZXR1cm4gYmxvYi50cmltKCkuc3BsaXQoJ1xcbicpLm1hcChsaW5lID0+IGxpbmUudHJpbSgpKTtcbn07XG4vLyBTcGxpdHMgU0RQIGludG8gc2Vzc2lvbnBhcnQgYW5kIG1lZGlhc2VjdGlvbnMuIEVuc3VyZXMgQ1JMRi5cblNEUFV0aWxzLnNwbGl0U2VjdGlvbnMgPSBmdW5jdGlvbihibG9iKSB7XG4gIGNvbnN0IHBhcnRzID0gYmxvYi5zcGxpdCgnXFxubT0nKTtcbiAgcmV0dXJuIHBhcnRzLm1hcCgocGFydCwgaW5kZXgpID0+IChpbmRleCA+IDAgP1xuICAgICdtPScgKyBwYXJ0IDogcGFydCkudHJpbSgpICsgJ1xcclxcbicpO1xufTtcblxuLy8gUmV0dXJucyB0aGUgc2Vzc2lvbiBkZXNjcmlwdGlvbi5cblNEUFV0aWxzLmdldERlc2NyaXB0aW9uID0gZnVuY3Rpb24oYmxvYikge1xuICBjb25zdCBzZWN0aW9ucyA9IFNEUFV0aWxzLnNwbGl0U2VjdGlvbnMoYmxvYik7XG4gIHJldHVybiBzZWN0aW9ucyAmJiBzZWN0aW9uc1swXTtcbn07XG5cbi8vIFJldHVybnMgdGhlIGluZGl2aWR1YWwgbWVkaWEgc2VjdGlvbnMuXG5TRFBVdGlscy5nZXRNZWRpYVNlY3Rpb25zID0gZnVuY3Rpb24oYmxvYikge1xuICBjb25zdCBzZWN0aW9ucyA9IFNEUFV0aWxzLnNwbGl0U2VjdGlvbnMoYmxvYik7XG4gIHNlY3Rpb25zLnNoaWZ0KCk7XG4gIHJldHVybiBzZWN0aW9ucztcbn07XG5cbi8vIFJldHVybnMgbGluZXMgdGhhdCBzdGFydCB3aXRoIGEgY2VydGFpbiBwcmVmaXguXG5TRFBVdGlscy5tYXRjaFByZWZpeCA9IGZ1bmN0aW9uKGJsb2IsIHByZWZpeCkge1xuICByZXR1cm4gU0RQVXRpbHMuc3BsaXRMaW5lcyhibG9iKS5maWx0ZXIobGluZSA9PiBsaW5lLmluZGV4T2YocHJlZml4KSA9PT0gMCk7XG59O1xuXG4vLyBQYXJzZXMgYW4gSUNFIGNhbmRpZGF0ZSBsaW5lLiBTYW1wbGUgaW5wdXQ6XG4vLyBjYW5kaWRhdGU6NzAyNzg2MzUwIDIgdWRwIDQxODE5OTAyIDguOC44LjggNjA3NjkgdHlwIHJlbGF5IHJhZGRyIDguOC44Ljhcbi8vIHJwb3J0IDU1OTk2XCJcbi8vIElucHV0IGNhbiBiZSBwcmVmaXhlZCB3aXRoIGE9LlxuU0RQVXRpbHMucGFyc2VDYW5kaWRhdGUgPSBmdW5jdGlvbihsaW5lKSB7XG4gIGxldCBwYXJ0cztcbiAgLy8gUGFyc2UgYm90aCB2YXJpYW50cy5cbiAgaWYgKGxpbmUuaW5kZXhPZignYT1jYW5kaWRhdGU6JykgPT09IDApIHtcbiAgICBwYXJ0cyA9IGxpbmUuc3Vic3RyaW5nKDEyKS5zcGxpdCgnICcpO1xuICB9IGVsc2Uge1xuICAgIHBhcnRzID0gbGluZS5zdWJzdHJpbmcoMTApLnNwbGl0KCcgJyk7XG4gIH1cblxuICBjb25zdCBjYW5kaWRhdGUgPSB7XG4gICAgZm91bmRhdGlvbjogcGFydHNbMF0sXG4gICAgY29tcG9uZW50OiB7MTogJ3J0cCcsIDI6ICdydGNwJ31bcGFydHNbMV1dIHx8IHBhcnRzWzFdLFxuICAgIHByb3RvY29sOiBwYXJ0c1syXS50b0xvd2VyQ2FzZSgpLFxuICAgIHByaW9yaXR5OiBwYXJzZUludChwYXJ0c1szXSwgMTApLFxuICAgIGlwOiBwYXJ0c1s0XSxcbiAgICBhZGRyZXNzOiBwYXJ0c1s0XSwgLy8gYWRkcmVzcyBpcyBhbiBhbGlhcyBmb3IgaXAuXG4gICAgcG9ydDogcGFyc2VJbnQocGFydHNbNV0sIDEwKSxcbiAgICAvLyBza2lwIHBhcnRzWzZdID09ICd0eXAnXG4gICAgdHlwZTogcGFydHNbN10sXG4gIH07XG5cbiAgZm9yIChsZXQgaSA9IDg7IGkgPCBwYXJ0cy5sZW5ndGg7IGkgKz0gMikge1xuICAgIHN3aXRjaCAocGFydHNbaV0pIHtcbiAgICAgIGNhc2UgJ3JhZGRyJzpcbiAgICAgICAgY2FuZGlkYXRlLnJlbGF0ZWRBZGRyZXNzID0gcGFydHNbaSArIDFdO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3Jwb3J0JzpcbiAgICAgICAgY2FuZGlkYXRlLnJlbGF0ZWRQb3J0ID0gcGFyc2VJbnQocGFydHNbaSArIDFdLCAxMCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAndGNwdHlwZSc6XG4gICAgICAgIGNhbmRpZGF0ZS50Y3BUeXBlID0gcGFydHNbaSArIDFdO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3VmcmFnJzpcbiAgICAgICAgY2FuZGlkYXRlLnVmcmFnID0gcGFydHNbaSArIDFdOyAvLyBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eS5cbiAgICAgICAgY2FuZGlkYXRlLnVzZXJuYW1lRnJhZ21lbnQgPSBwYXJ0c1tpICsgMV07XG4gICAgICAgIGJyZWFrO1xuICAgICAgZGVmYXVsdDogLy8gZXh0ZW5zaW9uIGhhbmRsaW5nLCBpbiBwYXJ0aWN1bGFyIHVmcmFnLiBEb24ndCBvdmVyd3JpdGUuXG4gICAgICAgIGlmIChjYW5kaWRhdGVbcGFydHNbaV1dID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBjYW5kaWRhdGVbcGFydHNbaV1dID0gcGFydHNbaSArIDFdO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuICByZXR1cm4gY2FuZGlkYXRlO1xufTtcblxuLy8gVHJhbnNsYXRlcyBhIGNhbmRpZGF0ZSBvYmplY3QgaW50byBTRFAgY2FuZGlkYXRlIGF0dHJpYnV0ZS5cbi8vIFRoaXMgZG9lcyBub3QgaW5jbHVkZSB0aGUgYT0gcHJlZml4IVxuU0RQVXRpbHMud3JpdGVDYW5kaWRhdGUgPSBmdW5jdGlvbihjYW5kaWRhdGUpIHtcbiAgY29uc3Qgc2RwID0gW107XG4gIHNkcC5wdXNoKGNhbmRpZGF0ZS5mb3VuZGF0aW9uKTtcblxuICBjb25zdCBjb21wb25lbnQgPSBjYW5kaWRhdGUuY29tcG9uZW50O1xuICBpZiAoY29tcG9uZW50ID09PSAncnRwJykge1xuICAgIHNkcC5wdXNoKDEpO1xuICB9IGVsc2UgaWYgKGNvbXBvbmVudCA9PT0gJ3J0Y3AnKSB7XG4gICAgc2RwLnB1c2goMik7XG4gIH0gZWxzZSB7XG4gICAgc2RwLnB1c2goY29tcG9uZW50KTtcbiAgfVxuICBzZHAucHVzaChjYW5kaWRhdGUucHJvdG9jb2wudG9VcHBlckNhc2UoKSk7XG4gIHNkcC5wdXNoKGNhbmRpZGF0ZS5wcmlvcml0eSk7XG4gIHNkcC5wdXNoKGNhbmRpZGF0ZS5hZGRyZXNzIHx8IGNhbmRpZGF0ZS5pcCk7XG4gIHNkcC5wdXNoKGNhbmRpZGF0ZS5wb3J0KTtcblxuICBjb25zdCB0eXBlID0gY2FuZGlkYXRlLnR5cGU7XG4gIHNkcC5wdXNoKCd0eXAnKTtcbiAgc2RwLnB1c2godHlwZSk7XG4gIGlmICh0eXBlICE9PSAnaG9zdCcgJiYgY2FuZGlkYXRlLnJlbGF0ZWRBZGRyZXNzICYmXG4gICAgICBjYW5kaWRhdGUucmVsYXRlZFBvcnQpIHtcbiAgICBzZHAucHVzaCgncmFkZHInKTtcbiAgICBzZHAucHVzaChjYW5kaWRhdGUucmVsYXRlZEFkZHJlc3MpO1xuICAgIHNkcC5wdXNoKCdycG9ydCcpO1xuICAgIHNkcC5wdXNoKGNhbmRpZGF0ZS5yZWxhdGVkUG9ydCk7XG4gIH1cbiAgaWYgKGNhbmRpZGF0ZS50Y3BUeXBlICYmIGNhbmRpZGF0ZS5wcm90b2NvbC50b0xvd2VyQ2FzZSgpID09PSAndGNwJykge1xuICAgIHNkcC5wdXNoKCd0Y3B0eXBlJyk7XG4gICAgc2RwLnB1c2goY2FuZGlkYXRlLnRjcFR5cGUpO1xuICB9XG4gIGlmIChjYW5kaWRhdGUudXNlcm5hbWVGcmFnbWVudCB8fCBjYW5kaWRhdGUudWZyYWcpIHtcbiAgICBzZHAucHVzaCgndWZyYWcnKTtcbiAgICBzZHAucHVzaChjYW5kaWRhdGUudXNlcm5hbWVGcmFnbWVudCB8fCBjYW5kaWRhdGUudWZyYWcpO1xuICB9XG4gIHJldHVybiAnY2FuZGlkYXRlOicgKyBzZHAuam9pbignICcpO1xufTtcblxuLy8gUGFyc2VzIGFuIGljZS1vcHRpb25zIGxpbmUsIHJldHVybnMgYW4gYXJyYXkgb2Ygb3B0aW9uIHRhZ3MuXG4vLyBTYW1wbGUgaW5wdXQ6XG4vLyBhPWljZS1vcHRpb25zOmZvbyBiYXJcblNEUFV0aWxzLnBhcnNlSWNlT3B0aW9ucyA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgcmV0dXJuIGxpbmUuc3Vic3RyaW5nKDE0KS5zcGxpdCgnICcpO1xufTtcblxuLy8gUGFyc2VzIGEgcnRwbWFwIGxpbmUsIHJldHVybnMgUlRDUnRwQ29kZGVjUGFyYW1ldGVycy4gU2FtcGxlIGlucHV0OlxuLy8gYT1ydHBtYXA6MTExIG9wdXMvNDgwMDAvMlxuU0RQVXRpbHMucGFyc2VSdHBNYXAgPSBmdW5jdGlvbihsaW5lKSB7XG4gIGxldCBwYXJ0cyA9IGxpbmUuc3Vic3RyaW5nKDkpLnNwbGl0KCcgJyk7XG4gIGNvbnN0IHBhcnNlZCA9IHtcbiAgICBwYXlsb2FkVHlwZTogcGFyc2VJbnQocGFydHMuc2hpZnQoKSwgMTApLCAvLyB3YXM6IGlkXG4gIH07XG5cbiAgcGFydHMgPSBwYXJ0c1swXS5zcGxpdCgnLycpO1xuXG4gIHBhcnNlZC5uYW1lID0gcGFydHNbMF07XG4gIHBhcnNlZC5jbG9ja1JhdGUgPSBwYXJzZUludChwYXJ0c1sxXSwgMTApOyAvLyB3YXM6IGNsb2NrcmF0ZVxuICBwYXJzZWQuY2hhbm5lbHMgPSBwYXJ0cy5sZW5ndGggPT09IDMgPyBwYXJzZUludChwYXJ0c1syXSwgMTApIDogMTtcbiAgLy8gbGVnYWN5IGFsaWFzLCBnb3QgcmVuYW1lZCBiYWNrIHRvIGNoYW5uZWxzIGluIE9SVEMuXG4gIHBhcnNlZC5udW1DaGFubmVscyA9IHBhcnNlZC5jaGFubmVscztcbiAgcmV0dXJuIHBhcnNlZDtcbn07XG5cbi8vIEdlbmVyYXRlcyBhIHJ0cG1hcCBsaW5lIGZyb20gUlRDUnRwQ29kZWNDYXBhYmlsaXR5IG9yXG4vLyBSVENSdHBDb2RlY1BhcmFtZXRlcnMuXG5TRFBVdGlscy53cml0ZVJ0cE1hcCA9IGZ1bmN0aW9uKGNvZGVjKSB7XG4gIGxldCBwdCA9IGNvZGVjLnBheWxvYWRUeXBlO1xuICBpZiAoY29kZWMucHJlZmVycmVkUGF5bG9hZFR5cGUgIT09IHVuZGVmaW5lZCkge1xuICAgIHB0ID0gY29kZWMucHJlZmVycmVkUGF5bG9hZFR5cGU7XG4gIH1cbiAgY29uc3QgY2hhbm5lbHMgPSBjb2RlYy5jaGFubmVscyB8fCBjb2RlYy5udW1DaGFubmVscyB8fCAxO1xuICByZXR1cm4gJ2E9cnRwbWFwOicgKyBwdCArICcgJyArIGNvZGVjLm5hbWUgKyAnLycgKyBjb2RlYy5jbG9ja1JhdGUgK1xuICAgICAgKGNoYW5uZWxzICE9PSAxID8gJy8nICsgY2hhbm5lbHMgOiAnJykgKyAnXFxyXFxuJztcbn07XG5cbi8vIFBhcnNlcyBhIGV4dG1hcCBsaW5lIChoZWFkZXJleHRlbnNpb24gZnJvbSBSRkMgNTI4NSkuIFNhbXBsZSBpbnB1dDpcbi8vIGE9ZXh0bWFwOjIgdXJuOmlldGY6cGFyYW1zOnJ0cC1oZHJleHQ6dG9mZnNldFxuLy8gYT1leHRtYXA6Mi9zZW5kb25seSB1cm46aWV0ZjpwYXJhbXM6cnRwLWhkcmV4dDp0b2Zmc2V0XG5TRFBVdGlscy5wYXJzZUV4dG1hcCA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgY29uc3QgcGFydHMgPSBsaW5lLnN1YnN0cmluZyg5KS5zcGxpdCgnICcpO1xuICByZXR1cm4ge1xuICAgIGlkOiBwYXJzZUludChwYXJ0c1swXSwgMTApLFxuICAgIGRpcmVjdGlvbjogcGFydHNbMF0uaW5kZXhPZignLycpID4gMCA/IHBhcnRzWzBdLnNwbGl0KCcvJylbMV0gOiAnc2VuZHJlY3YnLFxuICAgIHVyaTogcGFydHNbMV0sXG4gICAgYXR0cmlidXRlczogcGFydHMuc2xpY2UoMikuam9pbignICcpLFxuICB9O1xufTtcblxuLy8gR2VuZXJhdGVzIGFuIGV4dG1hcCBsaW5lIGZyb20gUlRDUnRwSGVhZGVyRXh0ZW5zaW9uUGFyYW1ldGVycyBvclxuLy8gUlRDUnRwSGVhZGVyRXh0ZW5zaW9uLlxuU0RQVXRpbHMud3JpdGVFeHRtYXAgPSBmdW5jdGlvbihoZWFkZXJFeHRlbnNpb24pIHtcbiAgcmV0dXJuICdhPWV4dG1hcDonICsgKGhlYWRlckV4dGVuc2lvbi5pZCB8fCBoZWFkZXJFeHRlbnNpb24ucHJlZmVycmVkSWQpICtcbiAgICAgIChoZWFkZXJFeHRlbnNpb24uZGlyZWN0aW9uICYmIGhlYWRlckV4dGVuc2lvbi5kaXJlY3Rpb24gIT09ICdzZW5kcmVjdidcbiAgICAgICAgPyAnLycgKyBoZWFkZXJFeHRlbnNpb24uZGlyZWN0aW9uXG4gICAgICAgIDogJycpICtcbiAgICAgICcgJyArIGhlYWRlckV4dGVuc2lvbi51cmkgK1xuICAgICAgKGhlYWRlckV4dGVuc2lvbi5hdHRyaWJ1dGVzID8gJyAnICsgaGVhZGVyRXh0ZW5zaW9uLmF0dHJpYnV0ZXMgOiAnJykgK1xuICAgICAgJ1xcclxcbic7XG59O1xuXG4vLyBQYXJzZXMgYSBmbXRwIGxpbmUsIHJldHVybnMgZGljdGlvbmFyeS4gU2FtcGxlIGlucHV0OlxuLy8gYT1mbXRwOjk2IHZicj1vbjtjbmc9b25cbi8vIEFsc28gZGVhbHMgd2l0aCB2YnI9b247IGNuZz1vblxuU0RQVXRpbHMucGFyc2VGbXRwID0gZnVuY3Rpb24obGluZSkge1xuICBjb25zdCBwYXJzZWQgPSB7fTtcbiAgbGV0IGt2O1xuICBjb25zdCBwYXJ0cyA9IGxpbmUuc3Vic3RyaW5nKGxpbmUuaW5kZXhPZignICcpICsgMSkuc3BsaXQoJzsnKTtcbiAgZm9yIChsZXQgaiA9IDA7IGogPCBwYXJ0cy5sZW5ndGg7IGorKykge1xuICAgIGt2ID0gcGFydHNbal0udHJpbSgpLnNwbGl0KCc9Jyk7XG4gICAgcGFyc2VkW2t2WzBdLnRyaW0oKV0gPSBrdlsxXTtcbiAgfVxuICByZXR1cm4gcGFyc2VkO1xufTtcblxuLy8gR2VuZXJhdGVzIGEgZm10cCBsaW5lIGZyb20gUlRDUnRwQ29kZWNDYXBhYmlsaXR5IG9yIFJUQ1J0cENvZGVjUGFyYW1ldGVycy5cblNEUFV0aWxzLndyaXRlRm10cCA9IGZ1bmN0aW9uKGNvZGVjKSB7XG4gIGxldCBsaW5lID0gJyc7XG4gIGxldCBwdCA9IGNvZGVjLnBheWxvYWRUeXBlO1xuICBpZiAoY29kZWMucHJlZmVycmVkUGF5bG9hZFR5cGUgIT09IHVuZGVmaW5lZCkge1xuICAgIHB0ID0gY29kZWMucHJlZmVycmVkUGF5bG9hZFR5cGU7XG4gIH1cbiAgaWYgKGNvZGVjLnBhcmFtZXRlcnMgJiYgT2JqZWN0LmtleXMoY29kZWMucGFyYW1ldGVycykubGVuZ3RoKSB7XG4gICAgY29uc3QgcGFyYW1zID0gW107XG4gICAgT2JqZWN0LmtleXMoY29kZWMucGFyYW1ldGVycykuZm9yRWFjaChwYXJhbSA9PiB7XG4gICAgICBpZiAoY29kZWMucGFyYW1ldGVyc1twYXJhbV0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBwYXJhbXMucHVzaChwYXJhbSArICc9JyArIGNvZGVjLnBhcmFtZXRlcnNbcGFyYW1dKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHBhcmFtcy5wdXNoKHBhcmFtKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBsaW5lICs9ICdhPWZtdHA6JyArIHB0ICsgJyAnICsgcGFyYW1zLmpvaW4oJzsnKSArICdcXHJcXG4nO1xuICB9XG4gIHJldHVybiBsaW5lO1xufTtcblxuLy8gUGFyc2VzIGEgcnRjcC1mYiBsaW5lLCByZXR1cm5zIFJUQ1BSdGNwRmVlZGJhY2sgb2JqZWN0LiBTYW1wbGUgaW5wdXQ6XG4vLyBhPXJ0Y3AtZmI6OTggbmFjayBycHNpXG5TRFBVdGlscy5wYXJzZVJ0Y3BGYiA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgY29uc3QgcGFydHMgPSBsaW5lLnN1YnN0cmluZyhsaW5lLmluZGV4T2YoJyAnKSArIDEpLnNwbGl0KCcgJyk7XG4gIHJldHVybiB7XG4gICAgdHlwZTogcGFydHMuc2hpZnQoKSxcbiAgICBwYXJhbWV0ZXI6IHBhcnRzLmpvaW4oJyAnKSxcbiAgfTtcbn07XG5cbi8vIEdlbmVyYXRlIGE9cnRjcC1mYiBsaW5lcyBmcm9tIFJUQ1J0cENvZGVjQ2FwYWJpbGl0eSBvciBSVENSdHBDb2RlY1BhcmFtZXRlcnMuXG5TRFBVdGlscy53cml0ZVJ0Y3BGYiA9IGZ1bmN0aW9uKGNvZGVjKSB7XG4gIGxldCBsaW5lcyA9ICcnO1xuICBsZXQgcHQgPSBjb2RlYy5wYXlsb2FkVHlwZTtcbiAgaWYgKGNvZGVjLnByZWZlcnJlZFBheWxvYWRUeXBlICE9PSB1bmRlZmluZWQpIHtcbiAgICBwdCA9IGNvZGVjLnByZWZlcnJlZFBheWxvYWRUeXBlO1xuICB9XG4gIGlmIChjb2RlYy5ydGNwRmVlZGJhY2sgJiYgY29kZWMucnRjcEZlZWRiYWNrLmxlbmd0aCkge1xuICAgIC8vIEZJWE1FOiBzcGVjaWFsIGhhbmRsaW5nIGZvciB0cnItaW50P1xuICAgIGNvZGVjLnJ0Y3BGZWVkYmFjay5mb3JFYWNoKGZiID0+IHtcbiAgICAgIGxpbmVzICs9ICdhPXJ0Y3AtZmI6JyArIHB0ICsgJyAnICsgZmIudHlwZSArXG4gICAgICAoZmIucGFyYW1ldGVyICYmIGZiLnBhcmFtZXRlci5sZW5ndGggPyAnICcgKyBmYi5wYXJhbWV0ZXIgOiAnJykgK1xuICAgICAgICAgICdcXHJcXG4nO1xuICAgIH0pO1xuICB9XG4gIHJldHVybiBsaW5lcztcbn07XG5cbi8vIFBhcnNlcyBhIFJGQyA1NTc2IHNzcmMgbWVkaWEgYXR0cmlidXRlLiBTYW1wbGUgaW5wdXQ6XG4vLyBhPXNzcmM6MzczNTkyODU1OSBjbmFtZTpzb21ldGhpbmdcblNEUFV0aWxzLnBhcnNlU3NyY01lZGlhID0gZnVuY3Rpb24obGluZSkge1xuICBjb25zdCBzcCA9IGxpbmUuaW5kZXhPZignICcpO1xuICBjb25zdCBwYXJ0cyA9IHtcbiAgICBzc3JjOiBwYXJzZUludChsaW5lLnN1YnN0cmluZyg3LCBzcCksIDEwKSxcbiAgfTtcbiAgY29uc3QgY29sb24gPSBsaW5lLmluZGV4T2YoJzonLCBzcCk7XG4gIGlmIChjb2xvbiA+IC0xKSB7XG4gICAgcGFydHMuYXR0cmlidXRlID0gbGluZS5zdWJzdHJpbmcoc3AgKyAxLCBjb2xvbik7XG4gICAgcGFydHMudmFsdWUgPSBsaW5lLnN1YnN0cmluZyhjb2xvbiArIDEpO1xuICB9IGVsc2Uge1xuICAgIHBhcnRzLmF0dHJpYnV0ZSA9IGxpbmUuc3Vic3RyaW5nKHNwICsgMSk7XG4gIH1cbiAgcmV0dXJuIHBhcnRzO1xufTtcblxuLy8gUGFyc2UgYSBzc3JjLWdyb3VwIGxpbmUgKHNlZSBSRkMgNTU3NikuIFNhbXBsZSBpbnB1dDpcbi8vIGE9c3NyYy1ncm91cDpzZW1hbnRpY3MgMTIgMzRcblNEUFV0aWxzLnBhcnNlU3NyY0dyb3VwID0gZnVuY3Rpb24obGluZSkge1xuICBjb25zdCBwYXJ0cyA9IGxpbmUuc3Vic3RyaW5nKDEzKS5zcGxpdCgnICcpO1xuICByZXR1cm4ge1xuICAgIHNlbWFudGljczogcGFydHMuc2hpZnQoKSxcbiAgICBzc3JjczogcGFydHMubWFwKHNzcmMgPT4gcGFyc2VJbnQoc3NyYywgMTApKSxcbiAgfTtcbn07XG5cbi8vIEV4dHJhY3RzIHRoZSBNSUQgKFJGQyA1ODg4KSBmcm9tIGEgbWVkaWEgc2VjdGlvbi5cbi8vIFJldHVybnMgdGhlIE1JRCBvciB1bmRlZmluZWQgaWYgbm8gbWlkIGxpbmUgd2FzIGZvdW5kLlxuU0RQVXRpbHMuZ2V0TWlkID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIGNvbnN0IG1pZCA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9bWlkOicpWzBdO1xuICBpZiAobWlkKSB7XG4gICAgcmV0dXJuIG1pZC5zdWJzdHJpbmcoNik7XG4gIH1cbn07XG5cbi8vIFBhcnNlcyBhIGZpbmdlcnByaW50IGxpbmUgZm9yIERUTFMtU1JUUC5cblNEUFV0aWxzLnBhcnNlRmluZ2VycHJpbnQgPSBmdW5jdGlvbihsaW5lKSB7XG4gIGNvbnN0IHBhcnRzID0gbGluZS5zdWJzdHJpbmcoMTQpLnNwbGl0KCcgJyk7XG4gIHJldHVybiB7XG4gICAgYWxnb3JpdGhtOiBwYXJ0c1swXS50b0xvd2VyQ2FzZSgpLCAvLyBhbGdvcml0aG0gaXMgY2FzZS1zZW5zaXRpdmUgaW4gRWRnZS5cbiAgICB2YWx1ZTogcGFydHNbMV0udG9VcHBlckNhc2UoKSwgLy8gdGhlIGRlZmluaXRpb24gaXMgdXBwZXItY2FzZSBpbiBSRkMgNDU3Mi5cbiAgfTtcbn07XG5cbi8vIEV4dHJhY3RzIERUTFMgcGFyYW1ldGVycyBmcm9tIFNEUCBtZWRpYSBzZWN0aW9uIG9yIHNlc3Npb25wYXJ0LlxuLy8gRklYTUU6IGZvciBjb25zaXN0ZW5jeSB3aXRoIG90aGVyIGZ1bmN0aW9ucyB0aGlzIHNob3VsZCBvbmx5XG4vLyAgIGdldCB0aGUgZmluZ2VycHJpbnQgbGluZSBhcyBpbnB1dC4gU2VlIGFsc28gZ2V0SWNlUGFyYW1ldGVycy5cblNEUFV0aWxzLmdldER0bHNQYXJhbWV0ZXJzID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uLCBzZXNzaW9ucGFydCkge1xuICBjb25zdCBsaW5lcyA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiArIHNlc3Npb25wYXJ0LFxuICAgICdhPWZpbmdlcnByaW50OicpO1xuICAvLyBOb3RlOiBhPXNldHVwIGxpbmUgaXMgaWdub3JlZCBzaW5jZSB3ZSB1c2UgdGhlICdhdXRvJyByb2xlIGluIEVkZ2UuXG4gIHJldHVybiB7XG4gICAgcm9sZTogJ2F1dG8nLFxuICAgIGZpbmdlcnByaW50czogbGluZXMubWFwKFNEUFV0aWxzLnBhcnNlRmluZ2VycHJpbnQpLFxuICB9O1xufTtcblxuLy8gU2VyaWFsaXplcyBEVExTIHBhcmFtZXRlcnMgdG8gU0RQLlxuU0RQVXRpbHMud3JpdGVEdGxzUGFyYW1ldGVycyA9IGZ1bmN0aW9uKHBhcmFtcywgc2V0dXBUeXBlKSB7XG4gIGxldCBzZHAgPSAnYT1zZXR1cDonICsgc2V0dXBUeXBlICsgJ1xcclxcbic7XG4gIHBhcmFtcy5maW5nZXJwcmludHMuZm9yRWFjaChmcCA9PiB7XG4gICAgc2RwICs9ICdhPWZpbmdlcnByaW50OicgKyBmcC5hbGdvcml0aG0gKyAnICcgKyBmcC52YWx1ZSArICdcXHJcXG4nO1xuICB9KTtcbiAgcmV0dXJuIHNkcDtcbn07XG5cbi8vIFBhcnNlcyBhPWNyeXB0byBsaW5lcyBpbnRvXG4vLyAgIGh0dHBzOi8vcmF3Z2l0LmNvbS9hYm9iYS9lZGdlcnRjL21hc3Rlci9tc29ydGMtcnM0Lmh0bWwjZGljdGlvbmFyeS1ydGNzcnRwc2Rlc3BhcmFtZXRlcnMtbWVtYmVyc1xuU0RQVXRpbHMucGFyc2VDcnlwdG9MaW5lID0gZnVuY3Rpb24obGluZSkge1xuICBjb25zdCBwYXJ0cyA9IGxpbmUuc3Vic3RyaW5nKDkpLnNwbGl0KCcgJyk7XG4gIHJldHVybiB7XG4gICAgdGFnOiBwYXJzZUludChwYXJ0c1swXSwgMTApLFxuICAgIGNyeXB0b1N1aXRlOiBwYXJ0c1sxXSxcbiAgICBrZXlQYXJhbXM6IHBhcnRzWzJdLFxuICAgIHNlc3Npb25QYXJhbXM6IHBhcnRzLnNsaWNlKDMpLFxuICB9O1xufTtcblxuU0RQVXRpbHMud3JpdGVDcnlwdG9MaW5lID0gZnVuY3Rpb24ocGFyYW1ldGVycykge1xuICByZXR1cm4gJ2E9Y3J5cHRvOicgKyBwYXJhbWV0ZXJzLnRhZyArICcgJyArXG4gICAgcGFyYW1ldGVycy5jcnlwdG9TdWl0ZSArICcgJyArXG4gICAgKHR5cGVvZiBwYXJhbWV0ZXJzLmtleVBhcmFtcyA9PT0gJ29iamVjdCdcbiAgICAgID8gU0RQVXRpbHMud3JpdGVDcnlwdG9LZXlQYXJhbXMocGFyYW1ldGVycy5rZXlQYXJhbXMpXG4gICAgICA6IHBhcmFtZXRlcnMua2V5UGFyYW1zKSArXG4gICAgKHBhcmFtZXRlcnMuc2Vzc2lvblBhcmFtcyA/ICcgJyArIHBhcmFtZXRlcnMuc2Vzc2lvblBhcmFtcy5qb2luKCcgJykgOiAnJykgK1xuICAgICdcXHJcXG4nO1xufTtcblxuLy8gUGFyc2VzIHRoZSBjcnlwdG8ga2V5IHBhcmFtZXRlcnMgaW50b1xuLy8gICBodHRwczovL3Jhd2dpdC5jb20vYWJvYmEvZWRnZXJ0Yy9tYXN0ZXIvbXNvcnRjLXJzNC5odG1sI3J0Y3NydHBrZXlwYXJhbSpcblNEUFV0aWxzLnBhcnNlQ3J5cHRvS2V5UGFyYW1zID0gZnVuY3Rpb24oa2V5UGFyYW1zKSB7XG4gIGlmIChrZXlQYXJhbXMuaW5kZXhPZignaW5saW5lOicpICE9PSAwKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgY29uc3QgcGFydHMgPSBrZXlQYXJhbXMuc3Vic3RyaW5nKDcpLnNwbGl0KCd8Jyk7XG4gIHJldHVybiB7XG4gICAga2V5TWV0aG9kOiAnaW5saW5lJyxcbiAgICBrZXlTYWx0OiBwYXJ0c1swXSxcbiAgICBsaWZlVGltZTogcGFydHNbMV0sXG4gICAgbWtpVmFsdWU6IHBhcnRzWzJdID8gcGFydHNbMl0uc3BsaXQoJzonKVswXSA6IHVuZGVmaW5lZCxcbiAgICBta2lMZW5ndGg6IHBhcnRzWzJdID8gcGFydHNbMl0uc3BsaXQoJzonKVsxXSA6IHVuZGVmaW5lZCxcbiAgfTtcbn07XG5cblNEUFV0aWxzLndyaXRlQ3J5cHRvS2V5UGFyYW1zID0gZnVuY3Rpb24oa2V5UGFyYW1zKSB7XG4gIHJldHVybiBrZXlQYXJhbXMua2V5TWV0aG9kICsgJzonXG4gICAgKyBrZXlQYXJhbXMua2V5U2FsdCArXG4gICAgKGtleVBhcmFtcy5saWZlVGltZSA/ICd8JyArIGtleVBhcmFtcy5saWZlVGltZSA6ICcnKSArXG4gICAgKGtleVBhcmFtcy5ta2lWYWx1ZSAmJiBrZXlQYXJhbXMubWtpTGVuZ3RoXG4gICAgICA/ICd8JyArIGtleVBhcmFtcy5ta2lWYWx1ZSArICc6JyArIGtleVBhcmFtcy5ta2lMZW5ndGhcbiAgICAgIDogJycpO1xufTtcblxuLy8gRXh0cmFjdHMgYWxsIFNERVMgcGFyYW1ldGVycy5cblNEUFV0aWxzLmdldENyeXB0b1BhcmFtZXRlcnMgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24sIHNlc3Npb25wYXJ0KSB7XG4gIGNvbnN0IGxpbmVzID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uICsgc2Vzc2lvbnBhcnQsXG4gICAgJ2E9Y3J5cHRvOicpO1xuICByZXR1cm4gbGluZXMubWFwKFNEUFV0aWxzLnBhcnNlQ3J5cHRvTGluZSk7XG59O1xuXG4vLyBQYXJzZXMgSUNFIGluZm9ybWF0aW9uIGZyb20gU0RQIG1lZGlhIHNlY3Rpb24gb3Igc2Vzc2lvbnBhcnQuXG4vLyBGSVhNRTogZm9yIGNvbnNpc3RlbmN5IHdpdGggb3RoZXIgZnVuY3Rpb25zIHRoaXMgc2hvdWxkIG9ubHlcbi8vICAgZ2V0IHRoZSBpY2UtdWZyYWcgYW5kIGljZS1wd2QgbGluZXMgYXMgaW5wdXQuXG5TRFBVdGlscy5nZXRJY2VQYXJhbWV0ZXJzID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uLCBzZXNzaW9ucGFydCkge1xuICBjb25zdCB1ZnJhZyA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiArIHNlc3Npb25wYXJ0LFxuICAgICdhPWljZS11ZnJhZzonKVswXTtcbiAgY29uc3QgcHdkID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uICsgc2Vzc2lvbnBhcnQsXG4gICAgJ2E9aWNlLXB3ZDonKVswXTtcbiAgaWYgKCEodWZyYWcgJiYgcHdkKSkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIHJldHVybiB7XG4gICAgdXNlcm5hbWVGcmFnbWVudDogdWZyYWcuc3Vic3RyaW5nKDEyKSxcbiAgICBwYXNzd29yZDogcHdkLnN1YnN0cmluZygxMCksXG4gIH07XG59O1xuXG4vLyBTZXJpYWxpemVzIElDRSBwYXJhbWV0ZXJzIHRvIFNEUC5cblNEUFV0aWxzLndyaXRlSWNlUGFyYW1ldGVycyA9IGZ1bmN0aW9uKHBhcmFtcykge1xuICBsZXQgc2RwID0gJ2E9aWNlLXVmcmFnOicgKyBwYXJhbXMudXNlcm5hbWVGcmFnbWVudCArICdcXHJcXG4nICtcbiAgICAgICdhPWljZS1wd2Q6JyArIHBhcmFtcy5wYXNzd29yZCArICdcXHJcXG4nO1xuICBpZiAocGFyYW1zLmljZUxpdGUpIHtcbiAgICBzZHAgKz0gJ2E9aWNlLWxpdGVcXHJcXG4nO1xuICB9XG4gIHJldHVybiBzZHA7XG59O1xuXG4vLyBQYXJzZXMgdGhlIFNEUCBtZWRpYSBzZWN0aW9uIGFuZCByZXR1cm5zIFJUQ1J0cFBhcmFtZXRlcnMuXG5TRFBVdGlscy5wYXJzZVJ0cFBhcmFtZXRlcnMgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgY29uc3QgZGVzY3JpcHRpb24gPSB7XG4gICAgY29kZWNzOiBbXSxcbiAgICBoZWFkZXJFeHRlbnNpb25zOiBbXSxcbiAgICBmZWNNZWNoYW5pc21zOiBbXSxcbiAgICBydGNwOiBbXSxcbiAgfTtcbiAgY29uc3QgbGluZXMgPSBTRFBVdGlscy5zcGxpdExpbmVzKG1lZGlhU2VjdGlvbik7XG4gIGNvbnN0IG1saW5lID0gbGluZXNbMF0uc3BsaXQoJyAnKTtcbiAgZGVzY3JpcHRpb24ucHJvZmlsZSA9IG1saW5lWzJdO1xuICBmb3IgKGxldCBpID0gMzsgaSA8IG1saW5lLmxlbmd0aDsgaSsrKSB7IC8vIGZpbmQgYWxsIGNvZGVjcyBmcm9tIG1saW5lWzMuLl1cbiAgICBjb25zdCBwdCA9IG1saW5lW2ldO1xuICAgIGNvbnN0IHJ0cG1hcGxpbmUgPSBTRFBVdGlscy5tYXRjaFByZWZpeChcbiAgICAgIG1lZGlhU2VjdGlvbiwgJ2E9cnRwbWFwOicgKyBwdCArICcgJylbMF07XG4gICAgaWYgKHJ0cG1hcGxpbmUpIHtcbiAgICAgIGNvbnN0IGNvZGVjID0gU0RQVXRpbHMucGFyc2VSdHBNYXAocnRwbWFwbGluZSk7XG4gICAgICBjb25zdCBmbXRwcyA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KFxuICAgICAgICBtZWRpYVNlY3Rpb24sICdhPWZtdHA6JyArIHB0ICsgJyAnKTtcbiAgICAgIC8vIE9ubHkgdGhlIGZpcnN0IGE9Zm10cDo8cHQ+IGlzIGNvbnNpZGVyZWQuXG4gICAgICBjb2RlYy5wYXJhbWV0ZXJzID0gZm10cHMubGVuZ3RoID8gU0RQVXRpbHMucGFyc2VGbXRwKGZtdHBzWzBdKSA6IHt9O1xuICAgICAgY29kZWMucnRjcEZlZWRiYWNrID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgoXG4gICAgICAgIG1lZGlhU2VjdGlvbiwgJ2E9cnRjcC1mYjonICsgcHQgKyAnICcpXG4gICAgICAgIC5tYXAoU0RQVXRpbHMucGFyc2VSdGNwRmIpO1xuICAgICAgZGVzY3JpcHRpb24uY29kZWNzLnB1c2goY29kZWMpO1xuICAgICAgLy8gcGFyc2UgRkVDIG1lY2hhbmlzbXMgZnJvbSBydHBtYXAgbGluZXMuXG4gICAgICBzd2l0Y2ggKGNvZGVjLm5hbWUudG9VcHBlckNhc2UoKSkge1xuICAgICAgICBjYXNlICdSRUQnOlxuICAgICAgICBjYXNlICdVTFBGRUMnOlxuICAgICAgICAgIGRlc2NyaXB0aW9uLmZlY01lY2hhbmlzbXMucHVzaChjb2RlYy5uYW1lLnRvVXBwZXJDYXNlKCkpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OiAvLyBvbmx5IFJFRCBhbmQgVUxQRkVDIGFyZSByZWNvZ25pemVkIGFzIEZFQyBtZWNoYW5pc21zLlxuICAgICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPWV4dG1hcDonKS5mb3JFYWNoKGxpbmUgPT4ge1xuICAgIGRlc2NyaXB0aW9uLmhlYWRlckV4dGVuc2lvbnMucHVzaChTRFBVdGlscy5wYXJzZUV4dG1hcChsaW5lKSk7XG4gIH0pO1xuICBjb25zdCB3aWxkY2FyZFJ0Y3BGYiA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9cnRjcC1mYjoqICcpXG4gICAgLm1hcChTRFBVdGlscy5wYXJzZVJ0Y3BGYik7XG4gIGRlc2NyaXB0aW9uLmNvZGVjcy5mb3JFYWNoKGNvZGVjID0+IHtcbiAgICB3aWxkY2FyZFJ0Y3BGYi5mb3JFYWNoKGZiPT4ge1xuICAgICAgY29uc3QgZHVwbGljYXRlID0gY29kZWMucnRjcEZlZWRiYWNrLmZpbmQoZXhpc3RpbmdGZWVkYmFjayA9PiB7XG4gICAgICAgIHJldHVybiBleGlzdGluZ0ZlZWRiYWNrLnR5cGUgPT09IGZiLnR5cGUgJiZcbiAgICAgICAgICBleGlzdGluZ0ZlZWRiYWNrLnBhcmFtZXRlciA9PT0gZmIucGFyYW1ldGVyO1xuICAgICAgfSk7XG4gICAgICBpZiAoIWR1cGxpY2F0ZSkge1xuICAgICAgICBjb2RlYy5ydGNwRmVlZGJhY2sucHVzaChmYik7XG4gICAgICB9XG4gICAgfSk7XG4gIH0pO1xuICAvLyBGSVhNRTogcGFyc2UgcnRjcC5cbiAgcmV0dXJuIGRlc2NyaXB0aW9uO1xufTtcblxuLy8gR2VuZXJhdGVzIHBhcnRzIG9mIHRoZSBTRFAgbWVkaWEgc2VjdGlvbiBkZXNjcmliaW5nIHRoZSBjYXBhYmlsaXRpZXMgL1xuLy8gcGFyYW1ldGVycy5cblNEUFV0aWxzLndyaXRlUnRwRGVzY3JpcHRpb24gPSBmdW5jdGlvbihraW5kLCBjYXBzKSB7XG4gIGxldCBzZHAgPSAnJztcblxuICAvLyBCdWlsZCB0aGUgbWxpbmUuXG4gIHNkcCArPSAnbT0nICsga2luZCArICcgJztcbiAgc2RwICs9IGNhcHMuY29kZWNzLmxlbmd0aCA+IDAgPyAnOScgOiAnMCc7IC8vIHJlamVjdCBpZiBubyBjb2RlY3MuXG4gIHNkcCArPSAnICcgKyAoY2Fwcy5wcm9maWxlIHx8ICdVRFAvVExTL1JUUC9TQVZQRicpICsgJyAnO1xuICBzZHAgKz0gY2Fwcy5jb2RlY3MubWFwKGNvZGVjID0+IHtcbiAgICBpZiAoY29kZWMucHJlZmVycmVkUGF5bG9hZFR5cGUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIGNvZGVjLnByZWZlcnJlZFBheWxvYWRUeXBlO1xuICAgIH1cbiAgICByZXR1cm4gY29kZWMucGF5bG9hZFR5cGU7XG4gIH0pLmpvaW4oJyAnKSArICdcXHJcXG4nO1xuXG4gIHNkcCArPSAnYz1JTiBJUDQgMC4wLjAuMFxcclxcbic7XG4gIHNkcCArPSAnYT1ydGNwOjkgSU4gSVA0IDAuMC4wLjBcXHJcXG4nO1xuXG4gIC8vIEFkZCBhPXJ0cG1hcCBsaW5lcyBmb3IgZWFjaCBjb2RlYy4gQWxzbyBmbXRwIGFuZCBydGNwLWZiLlxuICBjYXBzLmNvZGVjcy5mb3JFYWNoKGNvZGVjID0+IHtcbiAgICBzZHAgKz0gU0RQVXRpbHMud3JpdGVSdHBNYXAoY29kZWMpO1xuICAgIHNkcCArPSBTRFBVdGlscy53cml0ZUZtdHAoY29kZWMpO1xuICAgIHNkcCArPSBTRFBVdGlscy53cml0ZVJ0Y3BGYihjb2RlYyk7XG4gIH0pO1xuICBsZXQgbWF4cHRpbWUgPSAwO1xuICBjYXBzLmNvZGVjcy5mb3JFYWNoKGNvZGVjID0+IHtcbiAgICBpZiAoY29kZWMubWF4cHRpbWUgPiBtYXhwdGltZSkge1xuICAgICAgbWF4cHRpbWUgPSBjb2RlYy5tYXhwdGltZTtcbiAgICB9XG4gIH0pO1xuICBpZiAobWF4cHRpbWUgPiAwKSB7XG4gICAgc2RwICs9ICdhPW1heHB0aW1lOicgKyBtYXhwdGltZSArICdcXHJcXG4nO1xuICB9XG5cbiAgaWYgKGNhcHMuaGVhZGVyRXh0ZW5zaW9ucykge1xuICAgIGNhcHMuaGVhZGVyRXh0ZW5zaW9ucy5mb3JFYWNoKGV4dGVuc2lvbiA9PiB7XG4gICAgICBzZHAgKz0gU0RQVXRpbHMud3JpdGVFeHRtYXAoZXh0ZW5zaW9uKTtcbiAgICB9KTtcbiAgfVxuICAvLyBGSVhNRTogd3JpdGUgZmVjTWVjaGFuaXNtcy5cbiAgcmV0dXJuIHNkcDtcbn07XG5cbi8vIFBhcnNlcyB0aGUgU0RQIG1lZGlhIHNlY3Rpb24gYW5kIHJldHVybnMgYW4gYXJyYXkgb2Zcbi8vIFJUQ1J0cEVuY29kaW5nUGFyYW1ldGVycy5cblNEUFV0aWxzLnBhcnNlUnRwRW5jb2RpbmdQYXJhbWV0ZXJzID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIGNvbnN0IGVuY29kaW5nUGFyYW1ldGVycyA9IFtdO1xuICBjb25zdCBkZXNjcmlwdGlvbiA9IFNEUFV0aWxzLnBhcnNlUnRwUGFyYW1ldGVycyhtZWRpYVNlY3Rpb24pO1xuICBjb25zdCBoYXNSZWQgPSBkZXNjcmlwdGlvbi5mZWNNZWNoYW5pc21zLmluZGV4T2YoJ1JFRCcpICE9PSAtMTtcbiAgY29uc3QgaGFzVWxwZmVjID0gZGVzY3JpcHRpb24uZmVjTWVjaGFuaXNtcy5pbmRleE9mKCdVTFBGRUMnKSAhPT0gLTE7XG5cbiAgLy8gZmlsdGVyIGE9c3NyYzouLi4gY25hbWU6LCBpZ25vcmUgUGxhbkItbXNpZFxuICBjb25zdCBzc3JjcyA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9c3NyYzonKVxuICAgIC5tYXAobGluZSA9PiBTRFBVdGlscy5wYXJzZVNzcmNNZWRpYShsaW5lKSlcbiAgICAuZmlsdGVyKHBhcnRzID0+IHBhcnRzLmF0dHJpYnV0ZSA9PT0gJ2NuYW1lJyk7XG4gIGNvbnN0IHByaW1hcnlTc3JjID0gc3NyY3MubGVuZ3RoID4gMCAmJiBzc3Jjc1swXS5zc3JjO1xuICBsZXQgc2Vjb25kYXJ5U3NyYztcblxuICBjb25zdCBmbG93cyA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9c3NyYy1ncm91cDpGSUQnKVxuICAgIC5tYXAobGluZSA9PiB7XG4gICAgICBjb25zdCBwYXJ0cyA9IGxpbmUuc3Vic3RyaW5nKDE3KS5zcGxpdCgnICcpO1xuICAgICAgcmV0dXJuIHBhcnRzLm1hcChwYXJ0ID0+IHBhcnNlSW50KHBhcnQsIDEwKSk7XG4gICAgfSk7XG4gIGlmIChmbG93cy5sZW5ndGggPiAwICYmIGZsb3dzWzBdLmxlbmd0aCA+IDEgJiYgZmxvd3NbMF1bMF0gPT09IHByaW1hcnlTc3JjKSB7XG4gICAgc2Vjb25kYXJ5U3NyYyA9IGZsb3dzWzBdWzFdO1xuICB9XG5cbiAgZGVzY3JpcHRpb24uY29kZWNzLmZvckVhY2goY29kZWMgPT4ge1xuICAgIGlmIChjb2RlYy5uYW1lLnRvVXBwZXJDYXNlKCkgPT09ICdSVFgnICYmIGNvZGVjLnBhcmFtZXRlcnMuYXB0KSB7XG4gICAgICBsZXQgZW5jUGFyYW0gPSB7XG4gICAgICAgIHNzcmM6IHByaW1hcnlTc3JjLFxuICAgICAgICBjb2RlY1BheWxvYWRUeXBlOiBwYXJzZUludChjb2RlYy5wYXJhbWV0ZXJzLmFwdCwgMTApLFxuICAgICAgfTtcbiAgICAgIGlmIChwcmltYXJ5U3NyYyAmJiBzZWNvbmRhcnlTc3JjKSB7XG4gICAgICAgIGVuY1BhcmFtLnJ0eCA9IHtzc3JjOiBzZWNvbmRhcnlTc3JjfTtcbiAgICAgIH1cbiAgICAgIGVuY29kaW5nUGFyYW1ldGVycy5wdXNoKGVuY1BhcmFtKTtcbiAgICAgIGlmIChoYXNSZWQpIHtcbiAgICAgICAgZW5jUGFyYW0gPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KGVuY1BhcmFtKSk7XG4gICAgICAgIGVuY1BhcmFtLmZlYyA9IHtcbiAgICAgICAgICBzc3JjOiBwcmltYXJ5U3NyYyxcbiAgICAgICAgICBtZWNoYW5pc206IGhhc1VscGZlYyA/ICdyZWQrdWxwZmVjJyA6ICdyZWQnLFxuICAgICAgICB9O1xuICAgICAgICBlbmNvZGluZ1BhcmFtZXRlcnMucHVzaChlbmNQYXJhbSk7XG4gICAgICB9XG4gICAgfVxuICB9KTtcbiAgaWYgKGVuY29kaW5nUGFyYW1ldGVycy5sZW5ndGggPT09IDAgJiYgcHJpbWFyeVNzcmMpIHtcbiAgICBlbmNvZGluZ1BhcmFtZXRlcnMucHVzaCh7XG4gICAgICBzc3JjOiBwcmltYXJ5U3NyYyxcbiAgICB9KTtcbiAgfVxuXG4gIC8vIHdlIHN1cHBvcnQgYm90aCBiPUFTIGFuZCBiPVRJQVMgYnV0IGludGVycHJldCBBUyBhcyBUSUFTLlxuICBsZXQgYmFuZHdpZHRoID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYj0nKTtcbiAgaWYgKGJhbmR3aWR0aC5sZW5ndGgpIHtcbiAgICBpZiAoYmFuZHdpZHRoWzBdLmluZGV4T2YoJ2I9VElBUzonKSA9PT0gMCkge1xuICAgICAgYmFuZHdpZHRoID0gcGFyc2VJbnQoYmFuZHdpZHRoWzBdLnN1YnN0cmluZyg3KSwgMTApO1xuICAgIH0gZWxzZSBpZiAoYmFuZHdpZHRoWzBdLmluZGV4T2YoJ2I9QVM6JykgPT09IDApIHtcbiAgICAgIC8vIHVzZSBmb3JtdWxhIGZyb20gSlNFUCB0byBjb252ZXJ0IGI9QVMgdG8gVElBUyB2YWx1ZS5cbiAgICAgIGJhbmR3aWR0aCA9IHBhcnNlSW50KGJhbmR3aWR0aFswXS5zdWJzdHJpbmcoNSksIDEwKSAqIDEwMDAgKiAwLjk1XG4gICAgICAgICAgLSAoNTAgKiA0MCAqIDgpO1xuICAgIH0gZWxzZSB7XG4gICAgICBiYW5kd2lkdGggPSB1bmRlZmluZWQ7XG4gICAgfVxuICAgIGVuY29kaW5nUGFyYW1ldGVycy5mb3JFYWNoKHBhcmFtcyA9PiB7XG4gICAgICBwYXJhbXMubWF4Qml0cmF0ZSA9IGJhbmR3aWR0aDtcbiAgICB9KTtcbiAgfVxuICByZXR1cm4gZW5jb2RpbmdQYXJhbWV0ZXJzO1xufTtcblxuLy8gcGFyc2VzIGh0dHA6Ly9kcmFmdC5vcnRjLm9yZy8jcnRjcnRjcHBhcmFtZXRlcnMqXG5TRFBVdGlscy5wYXJzZVJ0Y3BQYXJhbWV0ZXJzID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIGNvbnN0IHJ0Y3BQYXJhbWV0ZXJzID0ge307XG5cbiAgLy8gR2V0cyB0aGUgZmlyc3QgU1NSQy4gTm90ZSB0aGF0IHdpdGggUlRYIHRoZXJlIG1pZ2h0IGJlIG11bHRpcGxlXG4gIC8vIFNTUkNzLlxuICBjb25zdCByZW1vdGVTc3JjID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1zc3JjOicpXG4gICAgLm1hcChsaW5lID0+IFNEUFV0aWxzLnBhcnNlU3NyY01lZGlhKGxpbmUpKVxuICAgIC5maWx0ZXIob2JqID0+IG9iai5hdHRyaWJ1dGUgPT09ICdjbmFtZScpWzBdO1xuICBpZiAocmVtb3RlU3NyYykge1xuICAgIHJ0Y3BQYXJhbWV0ZXJzLmNuYW1lID0gcmVtb3RlU3NyYy52YWx1ZTtcbiAgICBydGNwUGFyYW1ldGVycy5zc3JjID0gcmVtb3RlU3NyYy5zc3JjO1xuICB9XG5cbiAgLy8gRWRnZSB1c2VzIHRoZSBjb21wb3VuZCBhdHRyaWJ1dGUgaW5zdGVhZCBvZiByZWR1Y2VkU2l6ZVxuICAvLyBjb21wb3VuZCBpcyAhcmVkdWNlZFNpemVcbiAgY29uc3QgcnNpemUgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPXJ0Y3AtcnNpemUnKTtcbiAgcnRjcFBhcmFtZXRlcnMucmVkdWNlZFNpemUgPSByc2l6ZS5sZW5ndGggPiAwO1xuICBydGNwUGFyYW1ldGVycy5jb21wb3VuZCA9IHJzaXplLmxlbmd0aCA9PT0gMDtcblxuICAvLyBwYXJzZXMgdGhlIHJ0Y3AtbXV4IGF0dHLRlmJ1dGUuXG4gIC8vIE5vdGUgdGhhdCBFZGdlIGRvZXMgbm90IHN1cHBvcnQgdW5tdXhlZCBSVENQLlxuICBjb25zdCBtdXggPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPXJ0Y3AtbXV4Jyk7XG4gIHJ0Y3BQYXJhbWV0ZXJzLm11eCA9IG11eC5sZW5ndGggPiAwO1xuXG4gIHJldHVybiBydGNwUGFyYW1ldGVycztcbn07XG5cblNEUFV0aWxzLndyaXRlUnRjcFBhcmFtZXRlcnMgPSBmdW5jdGlvbihydGNwUGFyYW1ldGVycykge1xuICBsZXQgc2RwID0gJyc7XG4gIGlmIChydGNwUGFyYW1ldGVycy5yZWR1Y2VkU2l6ZSkge1xuICAgIHNkcCArPSAnYT1ydGNwLXJzaXplXFxyXFxuJztcbiAgfVxuICBpZiAocnRjcFBhcmFtZXRlcnMubXV4KSB7XG4gICAgc2RwICs9ICdhPXJ0Y3AtbXV4XFxyXFxuJztcbiAgfVxuICBpZiAocnRjcFBhcmFtZXRlcnMuc3NyYyAhPT0gdW5kZWZpbmVkICYmIHJ0Y3BQYXJhbWV0ZXJzLmNuYW1lKSB7XG4gICAgc2RwICs9ICdhPXNzcmM6JyArIHJ0Y3BQYXJhbWV0ZXJzLnNzcmMgK1xuICAgICAgJyBjbmFtZTonICsgcnRjcFBhcmFtZXRlcnMuY25hbWUgKyAnXFxyXFxuJztcbiAgfVxuICByZXR1cm4gc2RwO1xufTtcblxuXG4vLyBwYXJzZXMgZWl0aGVyIGE9bXNpZDogb3IgYT1zc3JjOi4uLiBtc2lkIGxpbmVzIGFuZCByZXR1cm5zXG4vLyB0aGUgaWQgb2YgdGhlIE1lZGlhU3RyZWFtIGFuZCBNZWRpYVN0cmVhbVRyYWNrLlxuU0RQVXRpbHMucGFyc2VNc2lkID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIGxldCBwYXJ0cztcbiAgY29uc3Qgc3BlYyA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9bXNpZDonKTtcbiAgaWYgKHNwZWMubGVuZ3RoID09PSAxKSB7XG4gICAgcGFydHMgPSBzcGVjWzBdLnN1YnN0cmluZyg3KS5zcGxpdCgnICcpO1xuICAgIHJldHVybiB7c3RyZWFtOiBwYXJ0c1swXSwgdHJhY2s6IHBhcnRzWzFdfTtcbiAgfVxuICBjb25zdCBwbGFuQiA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9c3NyYzonKVxuICAgIC5tYXAobGluZSA9PiBTRFBVdGlscy5wYXJzZVNzcmNNZWRpYShsaW5lKSlcbiAgICAuZmlsdGVyKG1zaWRQYXJ0cyA9PiBtc2lkUGFydHMuYXR0cmlidXRlID09PSAnbXNpZCcpO1xuICBpZiAocGxhbkIubGVuZ3RoID4gMCkge1xuICAgIHBhcnRzID0gcGxhbkJbMF0udmFsdWUuc3BsaXQoJyAnKTtcbiAgICByZXR1cm4ge3N0cmVhbTogcGFydHNbMF0sIHRyYWNrOiBwYXJ0c1sxXX07XG4gIH1cbn07XG5cbi8vIFNDVFBcbi8vIHBhcnNlcyBkcmFmdC1pZXRmLW1tdXNpYy1zY3RwLXNkcC0yNiBmaXJzdCBhbmQgZmFsbHMgYmFja1xuLy8gdG8gZHJhZnQtaWV0Zi1tbXVzaWMtc2N0cC1zZHAtMDVcblNEUFV0aWxzLnBhcnNlU2N0cERlc2NyaXB0aW9uID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIGNvbnN0IG1saW5lID0gU0RQVXRpbHMucGFyc2VNTGluZShtZWRpYVNlY3Rpb24pO1xuICBjb25zdCBtYXhTaXplTGluZSA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9bWF4LW1lc3NhZ2Utc2l6ZTonKTtcbiAgbGV0IG1heE1lc3NhZ2VTaXplO1xuICBpZiAobWF4U2l6ZUxpbmUubGVuZ3RoID4gMCkge1xuICAgIG1heE1lc3NhZ2VTaXplID0gcGFyc2VJbnQobWF4U2l6ZUxpbmVbMF0uc3Vic3RyaW5nKDE5KSwgMTApO1xuICB9XG4gIGlmIChpc05hTihtYXhNZXNzYWdlU2l6ZSkpIHtcbiAgICBtYXhNZXNzYWdlU2l6ZSA9IDY1NTM2O1xuICB9XG4gIGNvbnN0IHNjdHBQb3J0ID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1zY3RwLXBvcnQ6Jyk7XG4gIGlmIChzY3RwUG9ydC5sZW5ndGggPiAwKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHBvcnQ6IHBhcnNlSW50KHNjdHBQb3J0WzBdLnN1YnN0cmluZygxMiksIDEwKSxcbiAgICAgIHByb3RvY29sOiBtbGluZS5mbXQsXG4gICAgICBtYXhNZXNzYWdlU2l6ZSxcbiAgICB9O1xuICB9XG4gIGNvbnN0IHNjdHBNYXBMaW5lcyA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9c2N0cG1hcDonKTtcbiAgaWYgKHNjdHBNYXBMaW5lcy5sZW5ndGggPiAwKSB7XG4gICAgY29uc3QgcGFydHMgPSBzY3RwTWFwTGluZXNbMF1cbiAgICAgIC5zdWJzdHJpbmcoMTApXG4gICAgICAuc3BsaXQoJyAnKTtcbiAgICByZXR1cm4ge1xuICAgICAgcG9ydDogcGFyc2VJbnQocGFydHNbMF0sIDEwKSxcbiAgICAgIHByb3RvY29sOiBwYXJ0c1sxXSxcbiAgICAgIG1heE1lc3NhZ2VTaXplLFxuICAgIH07XG4gIH1cbn07XG5cbi8vIFNDVFBcbi8vIG91dHB1dHMgdGhlIGRyYWZ0LWlldGYtbW11c2ljLXNjdHAtc2RwLTI2IHZlcnNpb24gdGhhdCBhbGwgYnJvd3NlcnNcbi8vIHN1cHBvcnQgYnkgbm93IHJlY2VpdmluZyBpbiB0aGlzIGZvcm1hdCwgdW5sZXNzIHdlIG9yaWdpbmFsbHkgcGFyc2VkXG4vLyBhcyB0aGUgZHJhZnQtaWV0Zi1tbXVzaWMtc2N0cC1zZHAtMDUgZm9ybWF0IChpbmRpY2F0ZWQgYnkgdGhlIG0tbGluZVxuLy8gcHJvdG9jb2wgb2YgRFRMUy9TQ1RQIC0tIHdpdGhvdXQgVURQLyBvciBUQ1AvKVxuU0RQVXRpbHMud3JpdGVTY3RwRGVzY3JpcHRpb24gPSBmdW5jdGlvbihtZWRpYSwgc2N0cCkge1xuICBsZXQgb3V0cHV0ID0gW107XG4gIGlmIChtZWRpYS5wcm90b2NvbCAhPT0gJ0RUTFMvU0NUUCcpIHtcbiAgICBvdXRwdXQgPSBbXG4gICAgICAnbT0nICsgbWVkaWEua2luZCArICcgOSAnICsgbWVkaWEucHJvdG9jb2wgKyAnICcgKyBzY3RwLnByb3RvY29sICsgJ1xcclxcbicsXG4gICAgICAnYz1JTiBJUDQgMC4wLjAuMFxcclxcbicsXG4gICAgICAnYT1zY3RwLXBvcnQ6JyArIHNjdHAucG9ydCArICdcXHJcXG4nLFxuICAgIF07XG4gIH0gZWxzZSB7XG4gICAgb3V0cHV0ID0gW1xuICAgICAgJ209JyArIG1lZGlhLmtpbmQgKyAnIDkgJyArIG1lZGlhLnByb3RvY29sICsgJyAnICsgc2N0cC5wb3J0ICsgJ1xcclxcbicsXG4gICAgICAnYz1JTiBJUDQgMC4wLjAuMFxcclxcbicsXG4gICAgICAnYT1zY3RwbWFwOicgKyBzY3RwLnBvcnQgKyAnICcgKyBzY3RwLnByb3RvY29sICsgJyA2NTUzNVxcclxcbicsXG4gICAgXTtcbiAgfVxuICBpZiAoc2N0cC5tYXhNZXNzYWdlU2l6ZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgb3V0cHV0LnB1c2goJ2E9bWF4LW1lc3NhZ2Utc2l6ZTonICsgc2N0cC5tYXhNZXNzYWdlU2l6ZSArICdcXHJcXG4nKTtcbiAgfVxuICByZXR1cm4gb3V0cHV0LmpvaW4oJycpO1xufTtcblxuLy8gR2VuZXJhdGUgYSBzZXNzaW9uIElEIGZvciBTRFAuXG4vLyBodHRwczovL3Rvb2xzLmlldGYub3JnL2h0bWwvZHJhZnQtaWV0Zi1ydGN3ZWItanNlcC0yMCNzZWN0aW9uLTUuMi4xXG4vLyByZWNvbW1lbmRzIHVzaW5nIGEgY3J5cHRvZ3JhcGhpY2FsbHkgcmFuZG9tICt2ZSA2NC1iaXQgdmFsdWVcbi8vIGJ1dCByaWdodCBub3cgdGhpcyBzaG91bGQgYmUgYWNjZXB0YWJsZSBhbmQgd2l0aGluIHRoZSByaWdodCByYW5nZVxuU0RQVXRpbHMuZ2VuZXJhdGVTZXNzaW9uSWQgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIE1hdGgucmFuZG9tKCkudG9TdHJpbmcoKS5zdWJzdHIoMiwgMjIpO1xufTtcblxuLy8gV3JpdGUgYm9pbGVyIHBsYXRlIGZvciBzdGFydCBvZiBTRFBcbi8vIHNlc3NJZCBhcmd1bWVudCBpcyBvcHRpb25hbCAtIGlmIG5vdCBzdXBwbGllZCBpdCB3aWxsXG4vLyBiZSBnZW5lcmF0ZWQgcmFuZG9tbHlcbi8vIHNlc3NWZXJzaW9uIGlzIG9wdGlvbmFsIGFuZCBkZWZhdWx0cyB0byAyXG4vLyBzZXNzVXNlciBpcyBvcHRpb25hbCBhbmQgZGVmYXVsdHMgdG8gJ3RoaXNpc2FkYXB0ZXJvcnRjJ1xuU0RQVXRpbHMud3JpdGVTZXNzaW9uQm9pbGVycGxhdGUgPSBmdW5jdGlvbihzZXNzSWQsIHNlc3NWZXIsIHNlc3NVc2VyKSB7XG4gIGxldCBzZXNzaW9uSWQ7XG4gIGNvbnN0IHZlcnNpb24gPSBzZXNzVmVyICE9PSB1bmRlZmluZWQgPyBzZXNzVmVyIDogMjtcbiAgaWYgKHNlc3NJZCkge1xuICAgIHNlc3Npb25JZCA9IHNlc3NJZDtcbiAgfSBlbHNlIHtcbiAgICBzZXNzaW9uSWQgPSBTRFBVdGlscy5nZW5lcmF0ZVNlc3Npb25JZCgpO1xuICB9XG4gIGNvbnN0IHVzZXIgPSBzZXNzVXNlciB8fCAndGhpc2lzYWRhcHRlcm9ydGMnO1xuICAvLyBGSVhNRTogc2Vzcy1pZCBzaG91bGQgYmUgYW4gTlRQIHRpbWVzdGFtcC5cbiAgcmV0dXJuICd2PTBcXHJcXG4nICtcbiAgICAgICdvPScgKyB1c2VyICsgJyAnICsgc2Vzc2lvbklkICsgJyAnICsgdmVyc2lvbiArXG4gICAgICAgICcgSU4gSVA0IDEyNy4wLjAuMVxcclxcbicgK1xuICAgICAgJ3M9LVxcclxcbicgK1xuICAgICAgJ3Q9MCAwXFxyXFxuJztcbn07XG5cbi8vIEdldHMgdGhlIGRpcmVjdGlvbiBmcm9tIHRoZSBtZWRpYVNlY3Rpb24gb3IgdGhlIHNlc3Npb25wYXJ0LlxuU0RQVXRpbHMuZ2V0RGlyZWN0aW9uID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uLCBzZXNzaW9ucGFydCkge1xuICAvLyBMb29rIGZvciBzZW5kcmVjdiwgc2VuZG9ubHksIHJlY3Zvbmx5LCBpbmFjdGl2ZSwgZGVmYXVsdCB0byBzZW5kcmVjdi5cbiAgY29uc3QgbGluZXMgPSBTRFBVdGlscy5zcGxpdExpbmVzKG1lZGlhU2VjdGlvbik7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgbGluZXMubGVuZ3RoOyBpKyspIHtcbiAgICBzd2l0Y2ggKGxpbmVzW2ldKSB7XG4gICAgICBjYXNlICdhPXNlbmRyZWN2JzpcbiAgICAgIGNhc2UgJ2E9c2VuZG9ubHknOlxuICAgICAgY2FzZSAnYT1yZWN2b25seSc6XG4gICAgICBjYXNlICdhPWluYWN0aXZlJzpcbiAgICAgICAgcmV0dXJuIGxpbmVzW2ldLnN1YnN0cmluZygyKTtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIC8vIEZJWE1FOiBXaGF0IHNob3VsZCBoYXBwZW4gaGVyZT9cbiAgICB9XG4gIH1cbiAgaWYgKHNlc3Npb25wYXJ0KSB7XG4gICAgcmV0dXJuIFNEUFV0aWxzLmdldERpcmVjdGlvbihzZXNzaW9ucGFydCk7XG4gIH1cbiAgcmV0dXJuICdzZW5kcmVjdic7XG59O1xuXG5TRFBVdGlscy5nZXRLaW5kID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIGNvbnN0IGxpbmVzID0gU0RQVXRpbHMuc3BsaXRMaW5lcyhtZWRpYVNlY3Rpb24pO1xuICBjb25zdCBtbGluZSA9IGxpbmVzWzBdLnNwbGl0KCcgJyk7XG4gIHJldHVybiBtbGluZVswXS5zdWJzdHJpbmcoMik7XG59O1xuXG5TRFBVdGlscy5pc1JlamVjdGVkID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIHJldHVybiBtZWRpYVNlY3Rpb24uc3BsaXQoJyAnLCAyKVsxXSA9PT0gJzAnO1xufTtcblxuU0RQVXRpbHMucGFyc2VNTGluZSA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbikge1xuICBjb25zdCBsaW5lcyA9IFNEUFV0aWxzLnNwbGl0TGluZXMobWVkaWFTZWN0aW9uKTtcbiAgY29uc3QgcGFydHMgPSBsaW5lc1swXS5zdWJzdHJpbmcoMikuc3BsaXQoJyAnKTtcbiAgcmV0dXJuIHtcbiAgICBraW5kOiBwYXJ0c1swXSxcbiAgICBwb3J0OiBwYXJzZUludChwYXJ0c1sxXSwgMTApLFxuICAgIHByb3RvY29sOiBwYXJ0c1syXSxcbiAgICBmbXQ6IHBhcnRzLnNsaWNlKDMpLmpvaW4oJyAnKSxcbiAgfTtcbn07XG5cblNEUFV0aWxzLnBhcnNlT0xpbmUgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgY29uc3QgbGluZSA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ289JylbMF07XG4gIGNvbnN0IHBhcnRzID0gbGluZS5zdWJzdHJpbmcoMikuc3BsaXQoJyAnKTtcbiAgcmV0dXJuIHtcbiAgICB1c2VybmFtZTogcGFydHNbMF0sXG4gICAgc2Vzc2lvbklkOiBwYXJ0c1sxXSxcbiAgICBzZXNzaW9uVmVyc2lvbjogcGFyc2VJbnQocGFydHNbMl0sIDEwKSxcbiAgICBuZXRUeXBlOiBwYXJ0c1szXSxcbiAgICBhZGRyZXNzVHlwZTogcGFydHNbNF0sXG4gICAgYWRkcmVzczogcGFydHNbNV0sXG4gIH07XG59O1xuXG4vLyBhIHZlcnkgbmFpdmUgaW50ZXJwcmV0YXRpb24gb2YgYSB2YWxpZCBTRFAuXG5TRFBVdGlscy5pc1ZhbGlkU0RQID0gZnVuY3Rpb24oYmxvYikge1xuICBpZiAodHlwZW9mIGJsb2IgIT09ICdzdHJpbmcnIHx8IGJsb2IubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGNvbnN0IGxpbmVzID0gU0RQVXRpbHMuc3BsaXRMaW5lcyhibG9iKTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBsaW5lcy5sZW5ndGg7IGkrKykge1xuICAgIGlmIChsaW5lc1tpXS5sZW5ndGggPCAyIHx8IGxpbmVzW2ldLmNoYXJBdCgxKSAhPT0gJz0nKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIC8vIFRPRE86IGNoZWNrIHRoZSBtb2RpZmllciBhIGJpdCBtb3JlLlxuICB9XG4gIHJldHVybiB0cnVlO1xufTtcblxuLy8gRXhwb3NlIHB1YmxpYyBtZXRob2RzLlxuaWYgKHR5cGVvZiBtb2R1bGUgPT09ICdvYmplY3QnKSB7XG4gIG1vZHVsZS5leHBvcnRzID0gU0RQVXRpbHM7XG59XG4iLCIvLyBUaGUgbW9kdWxlIGNhY2hlXG52YXIgX193ZWJwYWNrX21vZHVsZV9jYWNoZV9fID0ge307XG5cbi8vIFRoZSByZXF1aXJlIGZ1bmN0aW9uXG5mdW5jdGlvbiBfX3dlYnBhY2tfcmVxdWlyZV9fKG1vZHVsZUlkKSB7XG5cdC8vIENoZWNrIGlmIG1vZHVsZSBpcyBpbiBjYWNoZVxuXHR2YXIgY2FjaGVkTW9kdWxlID0gX193ZWJwYWNrX21vZHVsZV9jYWNoZV9fW21vZHVsZUlkXTtcblx0aWYgKGNhY2hlZE1vZHVsZSAhPT0gdW5kZWZpbmVkKSB7XG5cdFx0cmV0dXJuIGNhY2hlZE1vZHVsZS5leHBvcnRzO1xuXHR9XG5cdC8vIENyZWF0ZSBhIG5ldyBtb2R1bGUgKGFuZCBwdXQgaXQgaW50byB0aGUgY2FjaGUpXG5cdHZhciBtb2R1bGUgPSBfX3dlYnBhY2tfbW9kdWxlX2NhY2hlX19bbW9kdWxlSWRdID0ge1xuXHRcdC8vIG5vIG1vZHVsZS5pZCBuZWVkZWRcblx0XHQvLyBubyBtb2R1bGUubG9hZGVkIG5lZWRlZFxuXHRcdGV4cG9ydHM6IHt9XG5cdH07XG5cblx0Ly8gRXhlY3V0ZSB0aGUgbW9kdWxlIGZ1bmN0aW9uXG5cdF9fd2VicGFja19tb2R1bGVzX19bbW9kdWxlSWRdKG1vZHVsZSwgbW9kdWxlLmV4cG9ydHMsIF9fd2VicGFja19yZXF1aXJlX18pO1xuXG5cdC8vIFJldHVybiB0aGUgZXhwb3J0cyBvZiB0aGUgbW9kdWxlXG5cdHJldHVybiBtb2R1bGUuZXhwb3J0cztcbn1cblxuIiwiIiwiLy8gc3RhcnR1cFxuLy8gTG9hZCBlbnRyeSBtb2R1bGUgYW5kIHJldHVybiBleHBvcnRzXG4vLyBUaGlzIGVudHJ5IG1vZHVsZSBpcyByZWZlcmVuY2VkIGJ5IG90aGVyIG1vZHVsZXMgc28gaXQgY2FuJ3QgYmUgaW5saW5lZFxudmFyIF9fd2VicGFja19leHBvcnRzX18gPSBfX3dlYnBhY2tfcmVxdWlyZV9fKFwiLi9zcmMvaW5kZXguanNcIik7XG4iLCIiXSwibmFtZXMiOlsiX3JlZ2VuZXJhdG9yUnVudGltZSIsImV4cG9ydHMiLCJPcCIsIk9iamVjdCIsInByb3RvdHlwZSIsImhhc093biIsImhhc093blByb3BlcnR5IiwiZGVmaW5lUHJvcGVydHkiLCJvYmoiLCJrZXkiLCJkZXNjIiwidmFsdWUiLCIkU3ltYm9sIiwiU3ltYm9sIiwiaXRlcmF0b3JTeW1ib2wiLCJpdGVyYXRvciIsImFzeW5jSXRlcmF0b3JTeW1ib2wiLCJhc3luY0l0ZXJhdG9yIiwidG9TdHJpbmdUYWdTeW1ib2wiLCJ0b1N0cmluZ1RhZyIsImRlZmluZSIsImVudW1lcmFibGUiLCJjb25maWd1cmFibGUiLCJ3cml0YWJsZSIsImVyciIsIndyYXAiLCJpbm5lckZuIiwib3V0ZXJGbiIsInNlbGYiLCJ0cnlMb2NzTGlzdCIsInByb3RvR2VuZXJhdG9yIiwiR2VuZXJhdG9yIiwiZ2VuZXJhdG9yIiwiY3JlYXRlIiwiY29udGV4dCIsIkNvbnRleHQiLCJtYWtlSW52b2tlTWV0aG9kIiwidHJ5Q2F0Y2giLCJmbiIsImFyZyIsInR5cGUiLCJjYWxsIiwiQ29udGludWVTZW50aW5lbCIsIkdlbmVyYXRvckZ1bmN0aW9uIiwiR2VuZXJhdG9yRnVuY3Rpb25Qcm90b3R5cGUiLCJJdGVyYXRvclByb3RvdHlwZSIsImdldFByb3RvIiwiZ2V0UHJvdG90eXBlT2YiLCJOYXRpdmVJdGVyYXRvclByb3RvdHlwZSIsInZhbHVlcyIsIkdwIiwiZGVmaW5lSXRlcmF0b3JNZXRob2RzIiwiZm9yRWFjaCIsIm1ldGhvZCIsIl9pbnZva2UiLCJBc3luY0l0ZXJhdG9yIiwiUHJvbWlzZUltcGwiLCJpbnZva2UiLCJyZXNvbHZlIiwicmVqZWN0IiwicmVjb3JkIiwicmVzdWx0IiwiX3R5cGVvZiIsIl9fYXdhaXQiLCJ0aGVuIiwidW53cmFwcGVkIiwiZXJyb3IiLCJwcmV2aW91c1Byb21pc2UiLCJjYWxsSW52b2tlV2l0aE1ldGhvZEFuZEFyZyIsInN0YXRlIiwiRXJyb3IiLCJkb25lUmVzdWx0IiwiZGVsZWdhdGUiLCJkZWxlZ2F0ZVJlc3VsdCIsIm1heWJlSW52b2tlRGVsZWdhdGUiLCJzZW50IiwiX3NlbnQiLCJkaXNwYXRjaEV4Y2VwdGlvbiIsImFicnVwdCIsImRvbmUiLCJtZXRob2ROYW1lIiwidW5kZWZpbmVkIiwiVHlwZUVycm9yIiwiaW5mbyIsInJlc3VsdE5hbWUiLCJuZXh0IiwibmV4dExvYyIsInB1c2hUcnlFbnRyeSIsImxvY3MiLCJlbnRyeSIsInRyeUxvYyIsImNhdGNoTG9jIiwiZmluYWxseUxvYyIsImFmdGVyTG9jIiwidHJ5RW50cmllcyIsInB1c2giLCJyZXNldFRyeUVudHJ5IiwiY29tcGxldGlvbiIsInJlc2V0IiwiaXRlcmFibGUiLCJpdGVyYXRvck1ldGhvZCIsImlzTmFOIiwibGVuZ3RoIiwiaSIsImRpc3BsYXlOYW1lIiwiaXNHZW5lcmF0b3JGdW5jdGlvbiIsImdlbkZ1biIsImN0b3IiLCJjb25zdHJ1Y3RvciIsIm5hbWUiLCJtYXJrIiwic2V0UHJvdG90eXBlT2YiLCJfX3Byb3RvX18iLCJhd3JhcCIsImFzeW5jIiwiUHJvbWlzZSIsIml0ZXIiLCJrZXlzIiwidmFsIiwib2JqZWN0IiwicmV2ZXJzZSIsInBvcCIsInNraXBUZW1wUmVzZXQiLCJwcmV2IiwiY2hhckF0Iiwic2xpY2UiLCJzdG9wIiwicm9vdFJlY29yZCIsInJ2YWwiLCJleGNlcHRpb24iLCJoYW5kbGUiLCJsb2MiLCJjYXVnaHQiLCJoYXNDYXRjaCIsImhhc0ZpbmFsbHkiLCJmaW5hbGx5RW50cnkiLCJjb21wbGV0ZSIsImZpbmlzaCIsIl9jYXRjaCIsInRocm93biIsImRlbGVnYXRlWWllbGQiLCJhc3luY0dlbmVyYXRvclN0ZXAiLCJnZW4iLCJfbmV4dCIsIl90aHJvdyIsIl9hc3luY1RvR2VuZXJhdG9yIiwiYXJncyIsImFyZ3VtZW50cyIsImFwcGx5IiwiX2NsYXNzQ2FsbENoZWNrIiwiaW5zdGFuY2UiLCJDb25zdHJ1Y3RvciIsIl9kZWZpbmVQcm9wZXJ0aWVzIiwidGFyZ2V0IiwicHJvcHMiLCJkZXNjcmlwdG9yIiwiX3RvUHJvcGVydHlLZXkiLCJfY3JlYXRlQ2xhc3MiLCJwcm90b1Byb3BzIiwic3RhdGljUHJvcHMiLCJfdG9QcmltaXRpdmUiLCJTdHJpbmciLCJpbnB1dCIsImhpbnQiLCJwcmltIiwidG9QcmltaXRpdmUiLCJyZXMiLCJOdW1iZXIiLCJtaiIsInJlcXVpcmUiLCJKYW51c1Nlc3Npb24iLCJzZW5kT3JpZ2luYWwiLCJzZW5kIiwic2lnbmFsIiwiZSIsIm1lc3NhZ2UiLCJpbmRleE9mIiwiY29uc29sZSIsIk5BRiIsImNvbm5lY3Rpb24iLCJhZGFwdGVyIiwicmVjb25uZWN0Iiwic2RwVXRpbHMiLCJkZWJ1ZyIsImxvZyIsIndhcm4iLCJpc1NhZmFyaSIsInRlc3QiLCJuYXZpZ2F0b3IiLCJ1c2VyQWdlbnQiLCJTVUJTQ1JJQkVfVElNRU9VVF9NUyIsImRlYm91bmNlIiwiY3VyciIsIl90aGlzIiwiQXJyYXkiLCJfIiwicmFuZG9tVWludCIsIk1hdGgiLCJmbG9vciIsInJhbmRvbSIsIk1BWF9TQUZFX0lOVEVHRVIiLCJ1bnRpbERhdGFDaGFubmVsT3BlbiIsImRhdGFDaGFubmVsIiwicmVhZHlTdGF0ZSIsInJlc29sdmVyIiwicmVqZWN0b3IiLCJjbGVhciIsInJlbW92ZUV2ZW50TGlzdGVuZXIiLCJhZGRFdmVudExpc3RlbmVyIiwiaXNIMjY0VmlkZW9TdXBwb3J0ZWQiLCJ2aWRlbyIsImRvY3VtZW50IiwiY3JlYXRlRWxlbWVudCIsImNhblBsYXlUeXBlIiwiT1BVU19QQVJBTUVURVJTIiwidXNlZHR4Iiwic3RlcmVvIiwiREVGQVVMVF9QRUVSX0NPTk5FQ1RJT05fQ09ORklHIiwiaWNlU2VydmVycyIsInVybHMiLCJXU19OT1JNQUxfQ0xPU1VSRSIsIkphbnVzQWRhcHRlciIsInJvb20iLCJjbGllbnRJZCIsImpvaW5Ub2tlbiIsInNlcnZlclVybCIsIndlYlJ0Y09wdGlvbnMiLCJwZWVyQ29ubmVjdGlvbkNvbmZpZyIsIndzIiwic2Vzc2lvbiIsInJlbGlhYmxlVHJhbnNwb3J0IiwidW5yZWxpYWJsZVRyYW5zcG9ydCIsImluaXRpYWxSZWNvbm5lY3Rpb25EZWxheSIsInJlY29ubmVjdGlvbkRlbGF5IiwicmVjb25uZWN0aW9uVGltZW91dCIsIm1heFJlY29ubmVjdGlvbkF0dGVtcHRzIiwicmVjb25uZWN0aW9uQXR0ZW1wdHMiLCJwdWJsaXNoZXIiLCJvY2N1cGFudHMiLCJsZWZ0T2NjdXBhbnRzIiwiU2V0IiwibWVkaWFTdHJlYW1zIiwibG9jYWxNZWRpYVN0cmVhbSIsInBlbmRpbmdNZWRpYVJlcXVlc3RzIiwiTWFwIiwiYmxvY2tlZENsaWVudHMiLCJmcm96ZW5VcGRhdGVzIiwidGltZU9mZnNldHMiLCJzZXJ2ZXJUaW1lUmVxdWVzdHMiLCJhdmdUaW1lT2Zmc2V0Iiwib25XZWJzb2NrZXRPcGVuIiwiYmluZCIsIm9uV2Vic29ja2V0Q2xvc2UiLCJvbldlYnNvY2tldE1lc3NhZ2UiLCJvbkRhdGFDaGFubmVsTWVzc2FnZSIsIm9uRGF0YSIsInNldFNlcnZlclVybCIsInVybCIsInNldEFwcCIsImFwcCIsInNldFJvb20iLCJyb29tTmFtZSIsInNldEpvaW5Ub2tlbiIsInNldENsaWVudElkIiwic2V0V2ViUnRjT3B0aW9ucyIsIm9wdGlvbnMiLCJzZXRQZWVyQ29ubmVjdGlvbkNvbmZpZyIsInNldFNlcnZlckNvbm5lY3RMaXN0ZW5lcnMiLCJzdWNjZXNzTGlzdGVuZXIiLCJmYWlsdXJlTGlzdGVuZXIiLCJjb25uZWN0U3VjY2VzcyIsImNvbm5lY3RGYWlsdXJlIiwic2V0Um9vbU9jY3VwYW50TGlzdGVuZXIiLCJvY2N1cGFudExpc3RlbmVyIiwib25PY2N1cGFudHNDaGFuZ2VkIiwic2V0RGF0YUNoYW5uZWxMaXN0ZW5lcnMiLCJvcGVuTGlzdGVuZXIiLCJjbG9zZWRMaXN0ZW5lciIsIm1lc3NhZ2VMaXN0ZW5lciIsIm9uT2NjdXBhbnRDb25uZWN0ZWQiLCJvbk9jY3VwYW50RGlzY29ubmVjdGVkIiwib25PY2N1cGFudE1lc3NhZ2UiLCJzZXRSZWNvbm5lY3Rpb25MaXN0ZW5lcnMiLCJyZWNvbm5lY3RpbmdMaXN0ZW5lciIsInJlY29ubmVjdGVkTGlzdGVuZXIiLCJyZWNvbm5lY3Rpb25FcnJvckxpc3RlbmVyIiwib25SZWNvbm5lY3RpbmciLCJvblJlY29ubmVjdGVkIiwib25SZWNvbm5lY3Rpb25FcnJvciIsInNldEV2ZW50TG9vcHMiLCJsb29wcyIsImNvbm5lY3QiLCJfdGhpczIiLCJjb25jYXQiLCJ3ZWJzb2NrZXRDb25uZWN0aW9uIiwiV2ViU29ja2V0IiwidGltZW91dE1zIiwid3NPbk9wZW4iLCJhbGwiLCJ1cGRhdGVUaW1lT2Zmc2V0IiwiZGlzY29ubmVjdCIsImNsZWFyVGltZW91dCIsInJlbW92ZUFsbE9jY3VwYW50cyIsImNvbm4iLCJjbG9zZSIsImRpc3Bvc2UiLCJkZWxheWVkUmVjb25uZWN0VGltZW91dCIsImlzRGlzY29ubmVjdGVkIiwiX29uV2Vic29ja2V0T3BlbiIsIl9jYWxsZWUiLCJhZGRPY2N1cGFudFByb21pc2VzIiwib2NjdXBhbnRJZCIsIl9jYWxsZWUkIiwiX2NvbnRleHQiLCJjcmVhdGVQdWJsaXNoZXIiLCJpbml0aWFsT2NjdXBhbnRzIiwiYWRkT2NjdXBhbnQiLCJldmVudCIsIl90aGlzMyIsImNvZGUiLCJzZXRUaW1lb3V0IiwiX3RoaXM0IiwicGVyZm9ybURlbGF5ZWRSZWNvbm5lY3QiLCJfdGhpczUiLCJyZWNlaXZlIiwiSlNPTiIsInBhcnNlIiwiZGF0YSIsIl9hZGRPY2N1cGFudCIsIl9jYWxsZWUyIiwic3Vic2NyaWJlciIsIl9jYWxsZWUyJCIsIl9jb250ZXh0MiIsInJlbW92ZU9jY3VwYW50IiwiY3JlYXRlU3Vic2NyaWJlciIsInNldE1lZGlhU3RyZWFtIiwibWVkaWFTdHJlYW0iLCJfeCIsIl9pdGVyYXRvciIsIl9jcmVhdGVGb3JPZkl0ZXJhdG9ySGVscGVyIiwiZ2V0T3duUHJvcGVydHlOYW1lcyIsIl9zdGVwIiwicyIsIm4iLCJmIiwiYWRkIiwiaGFzIiwibXNnIiwiZ2V0IiwiYXVkaW8iLCJhc3NvY2lhdGUiLCJfdGhpczYiLCJldiIsInNlbmRUcmlja2xlIiwiY2FuZGlkYXRlIiwiaWNlQ29ubmVjdGlvblN0YXRlIiwib2ZmZXIiLCJjcmVhdGVPZmZlciIsImNvbmZpZ3VyZVB1Ymxpc2hlclNkcCIsImZpeFNhZmFyaUljZVVGcmFnIiwibG9jYWwiLCJvIiwic2V0TG9jYWxEZXNjcmlwdGlvbiIsInJlbW90ZSIsImoiLCJzZW5kSnNlcCIsInIiLCJzZXRSZW1vdGVEZXNjcmlwdGlvbiIsImpzZXAiLCJvbiIsImFuc3dlciIsImNvbmZpZ3VyZVN1YnNjcmliZXJTZHAiLCJjcmVhdGVBbnN3ZXIiLCJhIiwiX2NyZWF0ZVB1Ymxpc2hlciIsIl9jYWxsZWUzIiwiX3RoaXM3Iiwid2VicnRjdXAiLCJyZWxpYWJsZUNoYW5uZWwiLCJ1bnJlbGlhYmxlQ2hhbm5lbCIsIl9jYWxsZWUzJCIsIl9jb250ZXh0MyIsIkphbnVzUGx1Z2luSGFuZGxlIiwiUlRDUGVlckNvbm5lY3Rpb24iLCJhdHRhY2giLCJwYXJzZUludCIsImNyZWF0ZURhdGFDaGFubmVsIiwib3JkZXJlZCIsIm1heFJldHJhbnNtaXRzIiwiZ2V0VHJhY2tzIiwidHJhY2siLCJhZGRUcmFjayIsInBsdWdpbmRhdGEiLCJyb29tX2lkIiwidXNlcl9pZCIsImJvZHkiLCJkaXNwYXRjaEV2ZW50IiwiQ3VzdG9tRXZlbnQiLCJkZXRhaWwiLCJieSIsInNlbmRKb2luIiwibm90aWZpY2F0aW9ucyIsInN1Y2Nlc3MiLCJyZXNwb25zZSIsInVzZXJzIiwiaW5jbHVkZXMiLCJzZHAiLCJyZXBsYWNlIiwibGluZSIsInB0IiwicGFyYW1ldGVycyIsImFzc2lnbiIsInBhcnNlRm10cCIsIndyaXRlRm10cCIsInBheWxvYWRUeXBlIiwiX2ZpeFNhZmFyaUljZVVGcmFnIiwiX2NhbGxlZTQiLCJfY2FsbGVlNCQiLCJfY29udGV4dDQiLCJfeDIiLCJfY3JlYXRlU3Vic2NyaWJlciIsIl9jYWxsZWU1IiwiX3RoaXM4IiwibWF4UmV0cmllcyIsIndlYnJ0Y0ZhaWxlZCIsInJlY2VpdmVycyIsIl9hcmdzNSIsIl9jYWxsZWU1JCIsIl9jb250ZXh0NSIsImxlZnRJbnRlcnZhbCIsInNldEludGVydmFsIiwiY2xlYXJJbnRlcnZhbCIsInRpbWVvdXQiLCJtZWRpYSIsIl9pT1NIYWNrRGVsYXllZEluaXRpYWxQZWVyIiwiTWVkaWFTdHJlYW0iLCJnZXRSZWNlaXZlcnMiLCJyZWNlaXZlciIsIl94MyIsInN1YnNjcmliZSIsInNlbmRNZXNzYWdlIiwia2luZCIsInRva2VuIiwidG9nZ2xlRnJlZXplIiwiZnJvemVuIiwidW5mcmVlemUiLCJmcmVlemUiLCJmbHVzaFBlbmRpbmdVcGRhdGVzIiwiZGF0YUZvclVwZGF0ZU11bHRpTWVzc2FnZSIsIm5ldHdvcmtJZCIsImwiLCJkIiwiZ2V0UGVuZGluZ0RhdGEiLCJkYXRhVHlwZSIsIm93bmVyIiwiZ2V0UGVuZGluZ0RhdGFGb3JOZXR3b3JrSWQiLCJfaXRlcmF0b3IyIiwiX3N0ZXAyIiwiX3N0ZXAyJHZhbHVlIiwiX3NsaWNlZFRvQXJyYXkiLCJzb3VyY2UiLCJzdG9yZU1lc3NhZ2UiLCJzdG9yZVNpbmdsZU1lc3NhZ2UiLCJpbmRleCIsInNldCIsInN0b3JlZE1lc3NhZ2UiLCJzdG9yZWREYXRhIiwiaXNPdXRkYXRlZE1lc3NhZ2UiLCJsYXN0T3duZXJUaW1lIiwiaXNDb250ZW1wb3JhbmVvdXNNZXNzYWdlIiwiY3JlYXRlZFdoaWxlRnJvemVuIiwiaXNGaXJzdFN5bmMiLCJjb21wb25lbnRzIiwiZW5hYmxlZCIsInNob3VsZFN0YXJ0Q29ubmVjdGlvblRvIiwiY2xpZW50Iiwic3RhcnRTdHJlYW1Db25uZWN0aW9uIiwiY2xvc2VTdHJlYW1Db25uZWN0aW9uIiwiZ2V0Q29ubmVjdFN0YXR1cyIsImFkYXB0ZXJzIiwiSVNfQ09OTkVDVEVEIiwiTk9UX0NPTk5FQ1RFRCIsIl91cGRhdGVUaW1lT2Zmc2V0IiwiX2NhbGxlZTYiLCJfdGhpczkiLCJjbGllbnRTZW50VGltZSIsInByZWNpc2lvbiIsInNlcnZlclJlY2VpdmVkVGltZSIsImNsaWVudFJlY2VpdmVkVGltZSIsInNlcnZlclRpbWUiLCJ0aW1lT2Zmc2V0IiwiX2NhbGxlZTYkIiwiX2NvbnRleHQ2IiwiRGF0ZSIsIm5vdyIsImZldGNoIiwibG9jYXRpb24iLCJocmVmIiwiY2FjaGUiLCJoZWFkZXJzIiwiZ2V0VGltZSIsInJlZHVjZSIsImFjYyIsIm9mZnNldCIsImdldFNlcnZlclRpbWUiLCJnZXRNZWRpYVN0cmVhbSIsIl90aGlzMTAiLCJhdWRpb1Byb21pc2UiLCJ2aWRlb1Byb21pc2UiLCJwcm9taXNlIiwic3RyZWFtIiwiYXVkaW9TdHJlYW0iLCJnZXRBdWRpb1RyYWNrcyIsInZpZGVvU3RyZWFtIiwiZ2V0VmlkZW9UcmFja3MiLCJfc2V0TG9jYWxNZWRpYVN0cmVhbSIsIl9jYWxsZWU3IiwiX3RoaXMxMSIsImV4aXN0aW5nU2VuZGVycyIsIm5ld1NlbmRlcnMiLCJ0cmFja3MiLCJfbG9vcCIsIl9jYWxsZWU3JCIsIl9jb250ZXh0OCIsImdldFNlbmRlcnMiLCJ0Iiwic2VuZGVyIiwiX2xvb3AkIiwiX2NvbnRleHQ3IiwiZmluZCIsInJlcGxhY2VUcmFjayIsInRvTG93ZXJDYXNlIiwicmVtb3ZlVHJhY2siLCJzZXRMb2NhbE1lZGlhU3RyZWFtIiwiX3g0IiwiZW5hYmxlTWljcm9waG9uZSIsInNlbmREYXRhIiwic3RyaW5naWZ5Iiwid2hvbSIsInNlbmREYXRhR3VhcmFudGVlZCIsImJyb2FkY2FzdERhdGEiLCJicm9hZGNhc3REYXRhR3VhcmFudGVlZCIsImtpY2siLCJwZXJtc1Rva2VuIiwiYmxvY2siLCJfdGhpczEyIiwidW5ibG9jayIsIl90aGlzMTMiLCJyZWdpc3RlciIsIm1vZHVsZSJdLCJzb3VyY2VSb290IjoiIn0=