/******/ (function(modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};
/******/
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/
/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId]) {
/******/ 			return installedModules[moduleId].exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			i: moduleId,
/******/ 			l: false,
/******/ 			exports: {}
/******/ 		};
/******/
/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/
/******/ 		// Flag the module as loaded
/******/ 		module.l = true;
/******/
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/
/******/
/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;
/******/
/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;
/******/
/******/ 	// define getter function for harmony exports
/******/ 	__webpack_require__.d = function(exports, name, getter) {
/******/ 		if(!__webpack_require__.o(exports, name)) {
/******/ 			Object.defineProperty(exports, name, { enumerable: true, get: getter });
/******/ 		}
/******/ 	};
/******/
/******/ 	// define __esModule on exports
/******/ 	__webpack_require__.r = function(exports) {
/******/ 		if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 			Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 		}
/******/ 		Object.defineProperty(exports, '__esModule', { value: true });
/******/ 	};
/******/
/******/ 	// create a fake namespace object
/******/ 	// mode & 1: value is a module id, require it
/******/ 	// mode & 2: merge all properties of value into the ns
/******/ 	// mode & 4: return value when already ns object
/******/ 	// mode & 8|1: behave like require
/******/ 	__webpack_require__.t = function(value, mode) {
/******/ 		if(mode & 1) value = __webpack_require__(value);
/******/ 		if(mode & 8) return value;
/******/ 		if((mode & 4) && typeof value === 'object' && value && value.__esModule) return value;
/******/ 		var ns = Object.create(null);
/******/ 		__webpack_require__.r(ns);
/******/ 		Object.defineProperty(ns, 'default', { enumerable: true, value: value });
/******/ 		if(mode & 2 && typeof value != 'string') for(var key in value) __webpack_require__.d(ns, key, function(key) { return value[key]; }.bind(null, key));
/******/ 		return ns;
/******/ 	};
/******/
/******/ 	// getDefaultExport function for compatibility with non-harmony modules
/******/ 	__webpack_require__.n = function(module) {
/******/ 		var getter = module && module.__esModule ?
/******/ 			function getDefault() { return module['default']; } :
/******/ 			function getModuleExports() { return module; };
/******/ 		__webpack_require__.d(getter, 'a', getter);
/******/ 		return getter;
/******/ 	};
/******/
/******/ 	// Object.prototype.hasOwnProperty.call
/******/ 	__webpack_require__.o = function(object, property) { return Object.prototype.hasOwnProperty.call(object, property); };
/******/
/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "";
/******/
/******/
/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(__webpack_require__.s = "./src/index.js");
/******/ })
/************************************************************************/
/******/ ({

/***/ "./node_modules/debug/src/browser.js":
/*!*******************************************!*\
  !*** ./node_modules/debug/src/browser.js ***!
  \*******************************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

"use strict";
/* WEBPACK VAR INJECTION */(function(process) {

function _typeof(obj) { if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") { _typeof = function _typeof(obj) { return typeof obj; }; } else { _typeof = function _typeof(obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }; } return _typeof(obj); }

/* eslint-env browser */

/**
 * This is the web browser implementation of `debug()`.
 */
exports.log = log;
exports.formatArgs = formatArgs;
exports.save = save;
exports.load = load;
exports.useColors = useColors;
exports.storage = localstorage();
/**
 * Colors.
 */

exports.colors = ['#0000CC', '#0000FF', '#0033CC', '#0033FF', '#0066CC', '#0066FF', '#0099CC', '#0099FF', '#00CC00', '#00CC33', '#00CC66', '#00CC99', '#00CCCC', '#00CCFF', '#3300CC', '#3300FF', '#3333CC', '#3333FF', '#3366CC', '#3366FF', '#3399CC', '#3399FF', '#33CC00', '#33CC33', '#33CC66', '#33CC99', '#33CCCC', '#33CCFF', '#6600CC', '#6600FF', '#6633CC', '#6633FF', '#66CC00', '#66CC33', '#9900CC', '#9900FF', '#9933CC', '#9933FF', '#99CC00', '#99CC33', '#CC0000', '#CC0033', '#CC0066', '#CC0099', '#CC00CC', '#CC00FF', '#CC3300', '#CC3333', '#CC3366', '#CC3399', '#CC33CC', '#CC33FF', '#CC6600', '#CC6633', '#CC9900', '#CC9933', '#CCCC00', '#CCCC33', '#FF0000', '#FF0033', '#FF0066', '#FF0099', '#FF00CC', '#FF00FF', '#FF3300', '#FF3333', '#FF3366', '#FF3399', '#FF33CC', '#FF33FF', '#FF6600', '#FF6633', '#FF9900', '#FF9933', '#FFCC00', '#FFCC33'];
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
  } // Internet Explorer and Edge do not support colors.


  if (typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/)) {
    return false;
  } // Is webkit? http://stackoverflow.com/a/16459606/376773
  // document is undefined in react-native: https://github.com/facebook/react-native/pull/1632


  return typeof document !== 'undefined' && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance || // Is firebug? http://stackoverflow.com/a/398120/376773
  typeof window !== 'undefined' && window.console && (window.console.firebug || window.console.exception && window.console.table) || // Is firefox >= v31?
  // https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
  typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/) && parseInt(RegExp.$1, 10) >= 31 || // Double check webkit in userAgent just in case we are in a worker
  typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/);
}
/**
 * Colorize log arguments if enabled.
 *
 * @api public
 */


function formatArgs(args) {
  args[0] = (this.useColors ? '%c' : '') + this.namespace + (this.useColors ? ' %c' : ' ') + args[0] + (this.useColors ? '%c ' : ' ') + '+' + module.exports.humanize(this.diff);

  if (!this.useColors) {
    return;
  }

  var c = 'color: ' + this.color;
  args.splice(1, 0, c, 'color: inherit'); // The final "%c" is somewhat tricky, because there could be other
  // arguments passed either before or after the %c, so we need to
  // figure out the correct index to insert the CSS into

  var index = 0;
  var lastC = 0;
  args[0].replace(/%[a-zA-Z%]/g, function (match) {
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
 * Invokes `console.log()` when available.
 * No-op when `console.log` is not a "function".
 *
 * @api public
 */


function log() {
  var _console;

  // This hackery is required for IE8/9, where
  // the `console.log` function doesn't have 'apply'
  return (typeof console === "undefined" ? "undefined" : _typeof(console)) === 'object' && console.log && (_console = console).log.apply(_console, arguments);
}
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
  } catch (error) {// Swallow
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
  var r;

  try {
    r = exports.storage.getItem('debug');
  } catch (error) {} // Swallow
  // XXX (@Qix-) should we be logging these?
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
  } catch (error) {// Swallow
    // XXX (@Qix-) should we be logging these?
  }
}

module.exports = __webpack_require__(/*! ./common */ "./node_modules/debug/src/common.js")(exports);
var formatters = module.exports.formatters;
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


/* WEBPACK VAR INJECTION */}.call(this, __webpack_require__(/*! ./../../process/browser.js */ "./node_modules/process/browser.js")))

/***/ }),

/***/ "./node_modules/debug/src/common.js":
/*!******************************************!*\
  !*** ./node_modules/debug/src/common.js ***!
  \******************************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

"use strict";


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
  Object.keys(env).forEach(function (key) {
    createDebug[key] = env[key];
  });
  /**
  * Active `debug` instances.
  */

  createDebug.instances = [];
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
  * @param {String} namespace The namespace string for the for the debug instance to be colored
  * @return {Number|String} An ANSI color code for the given namespace
  * @api private
  */

  function selectColor(namespace) {
    var hash = 0;

    for (var i = 0; i < namespace.length; i++) {
      hash = (hash << 5) - hash + namespace.charCodeAt(i);
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
    var prevTime;

    function debug() {
      // Disabled?
      if (!debug.enabled) {
        return;
      }

      for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
        args[_key] = arguments[_key];
      }

      var self = debug; // Set `diff` timestamp

      var curr = Number(new Date());
      var ms = curr - (prevTime || curr);
      self.diff = ms;
      self.prev = prevTime;
      self.curr = curr;
      prevTime = curr;
      args[0] = createDebug.coerce(args[0]);

      if (typeof args[0] !== 'string') {
        // Anything else let's inspect with %O
        args.unshift('%O');
      } // Apply any `formatters` transformations


      var index = 0;
      args[0] = args[0].replace(/%([a-zA-Z%])/g, function (match, format) {
        // If we encounter an escaped % then don't increase the array index
        if (match === '%%') {
          return match;
        }

        index++;
        var formatter = createDebug.formatters[format];

        if (typeof formatter === 'function') {
          var val = args[index];
          match = formatter.call(self, val); // Now we need to remove `args[index]` since it's inlined in the `format`

          args.splice(index, 1);
          index--;
        }

        return match;
      }); // Apply env-specific formatting (colors, etc.)

      createDebug.formatArgs.call(self, args);
      var logFn = self.log || createDebug.log;
      logFn.apply(self, args);
    }

    debug.namespace = namespace;
    debug.enabled = createDebug.enabled(namespace);
    debug.useColors = createDebug.useColors();
    debug.color = selectColor(namespace);
    debug.destroy = destroy;
    debug.extend = extend; // Debug.formatArgs = formatArgs;
    // debug.rawLog = rawLog;
    // env-specific initialization logic for debug instances

    if (typeof createDebug.init === 'function') {
      createDebug.init(debug);
    }

    createDebug.instances.push(debug);
    return debug;
  }

  function destroy() {
    var index = createDebug.instances.indexOf(this);

    if (index !== -1) {
      createDebug.instances.splice(index, 1);
      return true;
    }

    return false;
  }

  function extend(namespace, delimiter) {
    return createDebug(this.namespace + (typeof delimiter === 'undefined' ? ':' : delimiter) + namespace);
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
    createDebug.names = [];
    createDebug.skips = [];
    var i;
    var split = (typeof namespaces === 'string' ? namespaces : '').split(/[\s,]+/);
    var len = split.length;

    for (i = 0; i < len; i++) {
      if (!split[i]) {
        // ignore empty strings
        continue;
      }

      namespaces = split[i].replace(/\*/g, '.*?');

      if (namespaces[0] === '-') {
        createDebug.skips.push(new RegExp('^' + namespaces.substr(1) + '$'));
      } else {
        createDebug.names.push(new RegExp('^' + namespaces + '$'));
      }
    }

    for (i = 0; i < createDebug.instances.length; i++) {
      var instance = createDebug.instances[i];
      instance.enabled = createDebug.enabled(instance.namespace);
    }
  }
  /**
  * Disable debug output.
  *
  * @api public
  */


  function disable() {
    createDebug.enable('');
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

    var i;
    var len;

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

  createDebug.enable(createDebug.load());
  return createDebug;
}

module.exports = setup;



/***/ }),

/***/ "./node_modules/minijanus/minijanus.js":
/*!*********************************************!*\
  !*** ./node_modules/minijanus/minijanus.js ***!
  \*********************************************/
/*! no static exports found */
/***/ (function(module, exports) {

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
JanusPluginHandle.prototype.attach = function(plugin) {
  var payload = { plugin: plugin, "force-bundle": true, "force-rtcp-mux": true };
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

/***/ "./node_modules/ms/index.js":
/*!**********************************!*\
  !*** ./node_modules/ms/index.js ***!
  \**********************************/
/*! no static exports found */
/***/ (function(module, exports) {

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

module.exports = function (val, options) {
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

/***/ "./node_modules/process/browser.js":
/*!*****************************************!*\
  !*** ./node_modules/process/browser.js ***!
  \*****************************************/
/*! no static exports found */
/***/ (function(module, exports) {

// shim for using process in browser
var process = module.exports = {};

// cached from whatever global is present so that test runners that stub it
// don't break things.  But we need to wrap it in a try catch in case it is
// wrapped in strict mode code which doesn't define any globals.  It's inside a
// function because try/catches deoptimize in certain engines.

var cachedSetTimeout;
var cachedClearTimeout;

function defaultSetTimout() {
    throw new Error('setTimeout has not been defined');
}
function defaultClearTimeout () {
    throw new Error('clearTimeout has not been defined');
}
(function () {
    try {
        if (typeof setTimeout === 'function') {
            cachedSetTimeout = setTimeout;
        } else {
            cachedSetTimeout = defaultSetTimout;
        }
    } catch (e) {
        cachedSetTimeout = defaultSetTimout;
    }
    try {
        if (typeof clearTimeout === 'function') {
            cachedClearTimeout = clearTimeout;
        } else {
            cachedClearTimeout = defaultClearTimeout;
        }
    } catch (e) {
        cachedClearTimeout = defaultClearTimeout;
    }
} ())
function runTimeout(fun) {
    if (cachedSetTimeout === setTimeout) {
        //normal enviroments in sane situations
        return setTimeout(fun, 0);
    }
    // if setTimeout wasn't available but was latter defined
    if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
        cachedSetTimeout = setTimeout;
        return setTimeout(fun, 0);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedSetTimeout(fun, 0);
    } catch(e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
            return cachedSetTimeout.call(null, fun, 0);
        } catch(e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
            return cachedSetTimeout.call(this, fun, 0);
        }
    }


}
function runClearTimeout(marker) {
    if (cachedClearTimeout === clearTimeout) {
        //normal enviroments in sane situations
        return clearTimeout(marker);
    }
    // if clearTimeout wasn't available but was latter defined
    if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
        cachedClearTimeout = clearTimeout;
        return clearTimeout(marker);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedClearTimeout(marker);
    } catch (e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
            return cachedClearTimeout.call(null, marker);
        } catch (e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
            // Some versions of I.E. have different rules for clearTimeout vs setTimeout
            return cachedClearTimeout.call(this, marker);
        }
    }



}
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    if (!draining || !currentQueue) {
        return;
    }
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = runTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    runClearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        runTimeout(drainQueue);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;
process.prependListener = noop;
process.prependOnceListener = noop;

process.listeners = function (name) { return [] }

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };


/***/ }),

/***/ "./node_modules/sdp/sdp.js":
/*!*********************************!*\
  !*** ./node_modules/sdp/sdp.js ***!
  \*********************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

"use strict";
/* eslint-env node */


// SDP helpers.
const SDPUtils = {};

// Generate an alphanumeric identifier for cname or mids.
// TODO: use UUIDs instead? https://gist.github.com/jed/982883
SDPUtils.generateIdentifier = function() {
  return Math.random().toString(36).substr(2, 10);
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
  return line.substr(14).split(' ');
};

// Parses a rtpmap line, returns RTCRtpCoddecParameters. Sample input:
// a=rtpmap:111 opus/48000/2
SDPUtils.parseRtpMap = function(line) {
  let parts = line.substr(9).split(' ');
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
  const parts = line.substr(9).split(' ');
  return {
    id: parseInt(parts[0], 10),
    direction: parts[0].indexOf('/') > 0 ? parts[0].split('/')[1] : 'sendrecv',
    uri: parts[1],
  };
};

// Generates an extmap line from RTCRtpHeaderExtensionParameters or
// RTCRtpHeaderExtension.
SDPUtils.writeExtmap = function(headerExtension) {
  return 'a=extmap:' + (headerExtension.id || headerExtension.preferredId) +
      (headerExtension.direction && headerExtension.direction !== 'sendrecv'
        ? '/' + headerExtension.direction
        : '') +
      ' ' + headerExtension.uri + '\r\n';
};

// Parses a fmtp line, returns dictionary. Sample input:
// a=fmtp:96 vbr=on;cng=on
// Also deals with vbr=on; cng=on
SDPUtils.parseFmtp = function(line) {
  const parsed = {};
  let kv;
  const parts = line.substr(line.indexOf(' ') + 1).split(';');
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
  const parts = line.substr(line.indexOf(' ') + 1).split(' ');
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
    ssrc: parseInt(line.substr(7, sp - 7), 10),
  };
  const colon = line.indexOf(':', sp);
  if (colon > -1) {
    parts.attribute = line.substr(sp + 1, colon - sp - 1);
    parts.value = line.substr(colon + 1);
  } else {
    parts.attribute = line.substr(sp + 1);
  }
  return parts;
};

// Parse a ssrc-group line (see RFC 5576). Sample input:
// a=ssrc-group:semantics 12 34
SDPUtils.parseSsrcGroup = function(line) {
  const parts = line.substr(13).split(' ');
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
    return mid.substr(6);
  }
};

// Parses a fingerprint line for DTLS-SRTP.
SDPUtils.parseFingerprint = function(line) {
  const parts = line.substr(14).split(' ');
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
  const parts = line.substr(9).split(' ');
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
  const parts = keyParams.substr(7).split('|');
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
    usernameFragment: ufrag.substr(12),
    password: pwd.substr(10),
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
  sdp += ' UDP/TLS/RTP/SAVPF ';
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
      const parts = line.substr(17).split(' ');
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
      bandwidth = parseInt(bandwidth[0].substr(7), 10);
    } else if (bandwidth[0].indexOf('b=AS:') === 0) {
      // use formula from JSEP to convert b=AS to TIAS value.
      bandwidth = parseInt(bandwidth[0].substr(5), 10) * 1000 * 0.95
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
    parts = spec[0].substr(7).split(' ');
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
    maxMessageSize = parseInt(maxSizeLine[0].substr(19), 10);
  }
  if (isNaN(maxMessageSize)) {
    maxMessageSize = 65536;
  }
  const sctpPort = SDPUtils.matchPrefix(mediaSection, 'a=sctp-port:');
  if (sctpPort.length > 0) {
    return {
      port: parseInt(sctpPort[0].substr(12), 10),
      protocol: mline.fmt,
      maxMessageSize,
    };
  }
  const sctpMapLines = SDPUtils.matchPrefix(mediaSection, 'a=sctpmap:');
  if (sctpMapLines.length > 0) {
    const parts = sctpMapLines[0]
      .substr(10)
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
  return Math.random().toString().substr(2, 21);
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
        return lines[i].substr(2);
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
  return mline[0].substr(2);
};

SDPUtils.isRejected = function(mediaSection) {
  return mediaSection.split(' ', 2)[1] === '0';
};

SDPUtils.parseMLine = function(mediaSection) {
  const lines = SDPUtils.splitLines(mediaSection);
  const parts = lines[0].substr(2).split(' ');
  return {
    kind: parts[0],
    port: parseInt(parts[1], 10),
    protocol: parts[2],
    fmt: parts.slice(3).join(' '),
  };
};

SDPUtils.parseOLine = function(mediaSection) {
  const line = SDPUtils.matchPrefix(mediaSection, 'o=')[0];
  const parts = line.substr(2).split(' ');
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


/***/ }),

/***/ "./src/index.js":
/*!**********************!*\
  !*** ./src/index.js ***!
  \**********************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

var mj = __webpack_require__(/*! minijanus */ "./node_modules/minijanus/minijanus.js");
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
  iceServers: [{ urls: "stun:stun1.l.google.com:19302" }, { urls: "stun:stun2.l.google.com:19302" }]
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

  connect() {
    debug(`connecting to ${this.serverUrl}`);

    const websocketConnection = new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.serverUrl, "janus-protocol");

      this.session = new mj.JanusSession(this.ws.send.bind(this.ws), { timeoutMs: 40000 });

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

  onWebsocketOpen() {
    var _this = this;

    return _asyncToGenerator(function* () {
      // Create the Janus Session
      yield _this.session.create();

      // Attach the SFU Plugin and create a RTCPeerConnection for the publisher.
      // The publisher sends audio and opens two bidirectional data channels.
      // One reliable datachannel and one unreliable.
      _this.publisher = yield _this.createPublisher();

      // Call the naf connectSuccess callback before we start receiving WebRTC messages.
      _this.connectSuccess(_this.clientId);

      for (let i = 0; i < _this.publisher.initialOccupants.length; i++) {
        const occupantId = _this.publisher.initialOccupants[i];
        if (occupantId === _this.clientId) continue; // Happens during non-graceful reconnects due to zombie sessions
        _this.addAvailableOccupant(occupantId);
      }

      _this.syncOccupants();
    })();
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

  addOccupant(occupantId) {
    var _this2 = this;

    return _asyncToGenerator(function* () {
      _this2.pendingOccupants.add(occupantId);

      const availableOccupantsCount = _this2.availableOccupants.length;
      if (availableOccupantsCount > AVAILABLE_OCCUPANTS_THRESHOLD) {
        yield randomDelay(0, MAX_SUBSCRIBE_DELAY);
      }

      const subscriber = yield _this2.createSubscriber(occupantId);
      if (subscriber) {
        if (!_this2.pendingOccupants.has(occupantId)) {
          subscriber.conn.close();
        } else {
          _this2.pendingOccupants.delete(occupantId);
          _this2.occupantIds.push(occupantId);
          _this2.occupants[occupantId] = subscriber;

          _this2.setMediaStream(occupantId, subscriber.mediaStream);

          // Call the Networked AFrame callbacks for the new occupant.
          _this2.onOccupantConnected(occupantId);
        }
      }
    })();
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

  createPublisher() {
    var _this3 = this;

    return _asyncToGenerator(function* () {
      var handle = new mj.JanusPluginHandle(_this3.session);
      var conn = new RTCPeerConnection(_this3.peerConnectionConfig || DEFAULT_PEER_CONNECTION_CONFIG);

      debug("pub waiting for sfu");
      yield handle.attach("janus.plugin.sfu");

      _this3.associate(conn, handle);

      debug("pub waiting for data channels & webrtcup");
      var webrtcup = new Promise(function (resolve) {
        return handle.on("webrtcup", resolve);
      });

      // Unreliable datachannel: sending and receiving component updates.
      // Reliable datachannel: sending and recieving entity instantiations.
      var reliableChannel = conn.createDataChannel("reliable", { ordered: true });
      var unreliableChannel = conn.createDataChannel("unreliable", {
        ordered: false,
        maxRetransmits: 0
      });

      reliableChannel.addEventListener("message", function (e) {
        return _this3.onDataChannelMessage(e, "janus-reliable");
      });
      unreliableChannel.addEventListener("message", function (e) {
        return _this3.onDataChannelMessage(e, "janus-unreliable");
      });

      yield webrtcup;
      yield untilDataChannelOpen(reliableChannel);
      yield untilDataChannelOpen(unreliableChannel);

      // doing this here is sort of a hack around chrome renegotiation weirdness --
      // if we do it prior to webrtcup, chrome on gear VR will sometimes put a
      // renegotiation offer in flight while the first offer was still being
      // processed by janus. we should find some more principled way to figure out
      // when janus is done in the future.
      if (_this3.localMediaStream) {
        _this3.localMediaStream.getTracks().forEach(function (track) {
          conn.addTrack(track, _this3.localMediaStream);
        });
      }

      // Handle all of the join and leave events.
      handle.on("event", function (ev) {
        var data = ev.plugindata.data;
        if (data.event == "join" && data.room_id == _this3.room) {
          if (_this3.delayedReconnectTimeout) {
            // Don't create a new RTCPeerConnection, all RTCPeerConnection will be closed in less than 10s.
            return;
          }
          _this3.addAvailableOccupant(data.user_id);
          _this3.syncOccupants();
        } else if (data.event == "leave" && data.room_id == _this3.room) {
          _this3.removeAvailableOccupant(data.user_id);
          _this3.removeOccupant(data.user_id);
        } else if (data.event == "blocked") {
          document.body.dispatchEvent(new CustomEvent("blocked", { detail: { clientId: data.by } }));
        } else if (data.event == "unblocked") {
          document.body.dispatchEvent(new CustomEvent("unblocked", { detail: { clientId: data.by } }));
        } else if (data.event === "data") {
          _this3.onData(JSON.parse(data.body), "janus-event");
        }
      });

      debug("pub waiting for join");

      // Send join message to janus. Listen for join/leave messages. Automatically subscribe to all users' WebRTC data.
      var message = yield _this3.sendJoin(handle, {
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

      var initialOccupants = message.plugindata.data.response.users[_this3.room] || [];

      if (initialOccupants.includes(_this3.clientId)) {
        console.warn("Janus still has previous session for this client. Reconnecting in 10s.");
        _this3.performDelayedReconnect();
      }

      debug("publisher ready");
      return {
        handle,
        initialOccupants,
        reliableChannel,
        unreliableChannel,
        conn
      };
    })();
  }

  configurePublisherSdp(jsep) {
    jsep.sdp = jsep.sdp.replace(/a=fmtp:(109|111).*\r\n/g, (line, pt) => {
      const parameters = Object.assign(sdpUtils.parseFmtp(line), OPUS_PARAMETERS);
      return sdpUtils.writeFmtp({ payloadType: pt, parameters: parameters });
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

  fixSafariIceUFrag(jsep) {
    return _asyncToGenerator(function* () {
      // Safari produces a \n instead of an \r\n for the ice-ufrag. See https://github.com/meetecho/janus-gateway/issues/1818
      jsep.sdp = jsep.sdp.replace(/[^\r]\na=ice-ufrag/g, "\r\na=ice-ufrag");
      return jsep;
    })();
  }

  createSubscriber(occupantId, maxRetries = 5) {
    var _this4 = this;

    return _asyncToGenerator(function* () {
      if (_this4.availableOccupants.indexOf(occupantId) === -1) {
        console.warn(occupantId + ": cancelled occupant connection, occupant left before subscription negotation.");
        return null;
      }

      var handle = new mj.JanusPluginHandle(_this4.session);
      var conn = new RTCPeerConnection(_this4.peerConnectionConfig || DEFAULT_PEER_CONNECTION_CONFIG);

      debug(occupantId + ": sub waiting for sfu");
      yield handle.attach("janus.plugin.sfu");

      _this4.associate(conn, handle);

      debug(occupantId + ": sub waiting for join");

      if (_this4.availableOccupants.indexOf(occupantId) === -1) {
        conn.close();
        console.warn(occupantId + ": cancelled occupant connection, occupant left after attach");
        return null;
      }

      let webrtcFailed = false;

      const webrtcup = new Promise(function (resolve) {
        const leftInterval = setInterval(function () {
          if (_this4.availableOccupants.indexOf(occupantId) === -1) {
            clearInterval(leftInterval);
            resolve();
          }
        }, 1000);

        const timeout = setTimeout(function () {
          clearInterval(leftInterval);
          webrtcFailed = true;
          resolve();
        }, SUBSCRIBE_TIMEOUT_MS);

        handle.on("webrtcup", function () {
          clearTimeout(timeout);
          clearInterval(leftInterval);
          resolve();
        });
      });

      // Send join message to janus. Don't listen for join/leave messages. Subscribe to the occupant's media.
      // Janus should send us an offer for this occupant's media in response to this.
      yield _this4.sendJoin(handle, { media: occupantId });

      if (_this4.availableOccupants.indexOf(occupantId) === -1) {
        conn.close();
        console.warn(occupantId + ": cancelled occupant connection, occupant left after join");
        return null;
      }

      debug(occupantId + ": sub waiting for webrtcup");
      yield webrtcup;

      if (_this4.availableOccupants.indexOf(occupantId) === -1) {
        conn.close();
        console.warn(occupantId + ": cancel occupant connection, occupant left during or after webrtcup");
        return null;
      }

      if (webrtcFailed) {
        conn.close();
        if (maxRetries > 0) {
          console.warn(occupantId + ": webrtc up timed out, retrying");
          return _this4.createSubscriber(occupantId, maxRetries - 1);
        } else {
          console.warn(occupantId + ": webrtc up timed out");
          return null;
        }
      }

      if (isSafari && !_this4._iOSHackDelayedInitialPeer) {
        // HACK: the first peer on Safari during page load can fail to work if we don't
        // wait some time before continuing here. See: https://github.com/mozilla/hubs/pull/1692
        yield new Promise(function (resolve) {
          return setTimeout(resolve, 3000);
        });
        _this4._iOSHackDelayedInitialPeer = true;
      }

      var mediaStream = new MediaStream();
      var receivers = conn.getReceivers();
      receivers.forEach(function (receiver) {
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
    })();
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

  updateTimeOffset() {
    var _this5 = this;

    return _asyncToGenerator(function* () {
      if (_this5.isDisconnected()) return;

      const clientSentTime = Date.now();

      const res = yield fetch(document.location.href, {
        method: "HEAD",
        cache: "no-cache"
      });

      const precision = 1000;
      const serverReceivedTime = new Date(res.headers.get("Date")).getTime() + precision / 2;
      const clientReceivedTime = Date.now();
      const serverTime = serverReceivedTime + (clientReceivedTime - clientSentTime) / 2;
      const timeOffset = serverTime - clientReceivedTime;

      _this5.serverTimeRequests++;

      if (_this5.serverTimeRequests <= 10) {
        _this5.timeOffsets.push(timeOffset);
      } else {
        _this5.timeOffsets[_this5.serverTimeRequests % 10] = timeOffset;
      }

      _this5.avgTimeOffset = _this5.timeOffsets.reduce(function (acc, offset) {
        return acc += offset;
      }, 0) / _this5.timeOffsets.length;

      if (_this5.serverTimeRequests > 10) {
        debug(`new server time offset: ${_this5.avgTimeOffset}ms`);
        setTimeout(function () {
          return _this5.updateTimeOffset();
        }, 5 * 60 * 1000); // Sync clock every 5 minutes.
      } else {
        _this5.updateTimeOffset();
      }
    })();
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
          this.pendingMediaRequests.get(clientId).audio = { resolve, reject };
        });
        const videoPromise = new Promise((resolve, reject) => {
          this.pendingMediaRequests.get(clientId).video = { resolve, reject };
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

    this.mediaStreams[clientId] = { audio: audioStream, video: videoStream };

    // Resolve the promise for the user's media stream if it exists.
    if (this.pendingMediaRequests.has(clientId)) {
      this.pendingMediaRequests.get(clientId).audio.resolve(audioStream);
      this.pendingMediaRequests.get(clientId).video.resolve(videoStream);
    }
  }

  setLocalMediaStream(stream) {
    var _this6 = this;

    return _asyncToGenerator(function* () {
      // our job here is to make sure the connection winds up with RTP senders sending the stuff in this stream,
      // and not the stuff that isn't in this stream. strategy is to replace existing tracks if we can, add tracks
      // that we can't replace, and disable tracks that don't exist anymore.

      // note that we don't ever remove a track from the stream -- since Janus doesn't support Unified Plan, we absolutely
      // can't wind up with a SDP that has >1 audio or >1 video tracks, even if one of them is inactive (what you get if
      // you remove a track from an existing stream.)
      if (_this6.publisher && _this6.publisher.conn) {
        const existingSenders = _this6.publisher.conn.getSenders();
        const newSenders = [];
        const tracks = stream.getTracks();

        for (let i = 0; i < tracks.length; i++) {
          const t = tracks[i];
          const sender = existingSenders.find(function (s) {
            return s.track != null && s.track.kind == t.kind;
          });

          if (sender != null) {
            if (sender.replaceTrack) {
              yield sender.replaceTrack(t);

              // Workaround https://bugzilla.mozilla.org/show_bug.cgi?id=1576771
              if (t.kind === "video" && t.enabled && navigator.userAgent.toLowerCase().indexOf('firefox') > -1) {
                t.enabled = false;
                setTimeout(function () {
                  return t.enabled = true;
                }, 1000);
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
            newSenders.push(_this6.publisher.conn.addTrack(t, stream));
          }
        }
        existingSenders.forEach(function (s) {
          if (!newSenders.includes(s)) {
            s.track.enabled = false;
          }
        });
      }
      _this6.localMediaStream = stream;
      _this6.setMediaStream(_this6.clientId, stream);
    })();
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
          this.publisher.handle.sendMessage({ kind: "data", body: JSON.stringify({ dataType, data }), whom: clientId });
          break;
        case "datachannel":
          this.publisher.unreliableChannel.send(JSON.stringify({ clientId, dataType, data }));
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
          this.publisher.handle.sendMessage({ kind: "data", body: JSON.stringify({ dataType, data }), whom: clientId });
          break;
        case "datachannel":
          this.publisher.reliableChannel.send(JSON.stringify({ clientId, dataType, data }));
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
          this.publisher.handle.sendMessage({ kind: "data", body: JSON.stringify({ dataType, data }) });
          break;
        case "datachannel":
          this.publisher.unreliableChannel.send(JSON.stringify({ dataType, data }));
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
          this.publisher.handle.sendMessage({ kind: "data", body: JSON.stringify({ dataType, data }) });
          break;
        case "datachannel":
          this.publisher.reliableChannel.send(JSON.stringify({ dataType, data }));
          break;
        default:
          this.reliableTransport(undefined, dataType, data);
          break;
      }
    }
  }

  kick(clientId, permsToken) {
    return this.publisher.handle.sendMessage({ kind: "kick", room_id: this.room, user_id: clientId, token: permsToken }).then(() => {
      document.body.dispatchEvent(new CustomEvent("kicked", { detail: { clientId: clientId } }));
    });
  }

  block(clientId) {
    return this.publisher.handle.sendMessage({ kind: "block", whom: clientId }).then(() => {
      this.blockedClients.set(clientId, true);
      document.body.dispatchEvent(new CustomEvent("blocked", { detail: { clientId: clientId } }));
    });
  }

  unblock(clientId) {
    return this.publisher.handle.sendMessage({ kind: "unblock", whom: clientId }).then(() => {
      this.blockedClients.delete(clientId);
      document.body.dispatchEvent(new CustomEvent("unblocked", { detail: { clientId: clientId } }));
    });
  }
}

NAF.adapters.register("janus", JanusAdapter);

module.exports = JanusAdapter;

/***/ })

/******/ });
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIndlYnBhY2s6Ly8vd2VicGFjay9ib290c3RyYXAiLCJ3ZWJwYWNrOi8vLy4vbm9kZV9tb2R1bGVzL2RlYnVnL3NyYy9icm93c2VyLmpzIiwid2VicGFjazovLy8uL25vZGVfbW9kdWxlcy9kZWJ1Zy9zcmMvY29tbW9uLmpzIiwid2VicGFjazovLy8uL25vZGVfbW9kdWxlcy9taW5pamFudXMvbWluaWphbnVzLmpzIiwid2VicGFjazovLy8uL25vZGVfbW9kdWxlcy9tcy9pbmRleC5qcyIsIndlYnBhY2s6Ly8vLi9ub2RlX21vZHVsZXMvcHJvY2Vzcy9icm93c2VyLmpzIiwid2VicGFjazovLy8uL25vZGVfbW9kdWxlcy9zZHAvc2RwLmpzIiwid2VicGFjazovLy8uL3NyYy9pbmRleC5qcyJdLCJuYW1lcyI6WyJtaiIsInJlcXVpcmUiLCJKYW51c1Nlc3Npb24iLCJwcm90b3R5cGUiLCJzZW5kT3JpZ2luYWwiLCJzZW5kIiwidHlwZSIsInNpZ25hbCIsImNhdGNoIiwiZSIsIm1lc3NhZ2UiLCJpbmRleE9mIiwiY29uc29sZSIsImVycm9yIiwiTkFGIiwiY29ubmVjdGlvbiIsImFkYXB0ZXIiLCJyZWNvbm5lY3QiLCJzZHBVdGlscyIsImRlYnVnIiwid2FybiIsImlzU2FmYXJpIiwidGVzdCIsIm5hdmlnYXRvciIsInVzZXJBZ2VudCIsIlNVQlNDUklCRV9USU1FT1VUX01TIiwiQVZBSUxBQkxFX09DQ1VQQU5UU19USFJFU0hPTEQiLCJNQVhfU1VCU0NSSUJFX0RFTEFZIiwicmFuZG9tRGVsYXkiLCJtaW4iLCJtYXgiLCJQcm9taXNlIiwicmVzb2x2ZSIsImRlbGF5IiwiTWF0aCIsInJhbmRvbSIsInNldFRpbWVvdXQiLCJkZWJvdW5jZSIsImZuIiwiY3VyciIsImFyZ3MiLCJBcnJheSIsInNsaWNlIiwiY2FsbCIsImFyZ3VtZW50cyIsInRoZW4iLCJfIiwiYXBwbHkiLCJyYW5kb21VaW50IiwiZmxvb3IiLCJOdW1iZXIiLCJNQVhfU0FGRV9JTlRFR0VSIiwidW50aWxEYXRhQ2hhbm5lbE9wZW4iLCJkYXRhQ2hhbm5lbCIsInJlamVjdCIsInJlYWR5U3RhdGUiLCJyZXNvbHZlciIsInJlamVjdG9yIiwiY2xlYXIiLCJyZW1vdmVFdmVudExpc3RlbmVyIiwiYWRkRXZlbnRMaXN0ZW5lciIsImlzSDI2NFZpZGVvU3VwcG9ydGVkIiwidmlkZW8iLCJkb2N1bWVudCIsImNyZWF0ZUVsZW1lbnQiLCJjYW5QbGF5VHlwZSIsIk9QVVNfUEFSQU1FVEVSUyIsInVzZWR0eCIsInN0ZXJlbyIsIkRFRkFVTFRfUEVFUl9DT05ORUNUSU9OX0NPTkZJRyIsImljZVNlcnZlcnMiLCJ1cmxzIiwiV1NfTk9STUFMX0NMT1NVUkUiLCJKYW51c0FkYXB0ZXIiLCJjb25zdHJ1Y3RvciIsInJvb20iLCJjbGllbnRJZCIsImpvaW5Ub2tlbiIsInNlcnZlclVybCIsIndlYlJ0Y09wdGlvbnMiLCJwZWVyQ29ubmVjdGlvbkNvbmZpZyIsIndzIiwic2Vzc2lvbiIsInJlbGlhYmxlVHJhbnNwb3J0IiwidW5yZWxpYWJsZVRyYW5zcG9ydCIsImluaXRpYWxSZWNvbm5lY3Rpb25EZWxheSIsInJlY29ubmVjdGlvbkRlbGF5IiwicmVjb25uZWN0aW9uVGltZW91dCIsIm1heFJlY29ubmVjdGlvbkF0dGVtcHRzIiwicmVjb25uZWN0aW9uQXR0ZW1wdHMiLCJwdWJsaXNoZXIiLCJvY2N1cGFudElkcyIsIm9jY3VwYW50cyIsIm1lZGlhU3RyZWFtcyIsImxvY2FsTWVkaWFTdHJlYW0iLCJwZW5kaW5nTWVkaWFSZXF1ZXN0cyIsIk1hcCIsInBlbmRpbmdPY2N1cGFudHMiLCJTZXQiLCJhdmFpbGFibGVPY2N1cGFudHMiLCJyZXF1ZXN0ZWRPY2N1cGFudHMiLCJibG9ja2VkQ2xpZW50cyIsImZyb3plblVwZGF0ZXMiLCJ0aW1lT2Zmc2V0cyIsInNlcnZlclRpbWVSZXF1ZXN0cyIsImF2Z1RpbWVPZmZzZXQiLCJvbldlYnNvY2tldE9wZW4iLCJiaW5kIiwib25XZWJzb2NrZXRDbG9zZSIsIm9uV2Vic29ja2V0TWVzc2FnZSIsIm9uRGF0YUNoYW5uZWxNZXNzYWdlIiwib25EYXRhIiwic2V0U2VydmVyVXJsIiwidXJsIiwic2V0QXBwIiwiYXBwIiwic2V0Um9vbSIsInJvb21OYW1lIiwic2V0Sm9pblRva2VuIiwic2V0Q2xpZW50SWQiLCJzZXRXZWJSdGNPcHRpb25zIiwib3B0aW9ucyIsInNldFBlZXJDb25uZWN0aW9uQ29uZmlnIiwic2V0U2VydmVyQ29ubmVjdExpc3RlbmVycyIsInN1Y2Nlc3NMaXN0ZW5lciIsImZhaWx1cmVMaXN0ZW5lciIsImNvbm5lY3RTdWNjZXNzIiwiY29ubmVjdEZhaWx1cmUiLCJzZXRSb29tT2NjdXBhbnRMaXN0ZW5lciIsIm9jY3VwYW50TGlzdGVuZXIiLCJvbk9jY3VwYW50c0NoYW5nZWQiLCJzZXREYXRhQ2hhbm5lbExpc3RlbmVycyIsIm9wZW5MaXN0ZW5lciIsImNsb3NlZExpc3RlbmVyIiwibWVzc2FnZUxpc3RlbmVyIiwib25PY2N1cGFudENvbm5lY3RlZCIsIm9uT2NjdXBhbnREaXNjb25uZWN0ZWQiLCJvbk9jY3VwYW50TWVzc2FnZSIsInNldFJlY29ubmVjdGlvbkxpc3RlbmVycyIsInJlY29ubmVjdGluZ0xpc3RlbmVyIiwicmVjb25uZWN0ZWRMaXN0ZW5lciIsInJlY29ubmVjdGlvbkVycm9yTGlzdGVuZXIiLCJvblJlY29ubmVjdGluZyIsIm9uUmVjb25uZWN0ZWQiLCJvblJlY29ubmVjdGlvbkVycm9yIiwiY29ubmVjdCIsIndlYnNvY2tldENvbm5lY3Rpb24iLCJXZWJTb2NrZXQiLCJ0aW1lb3V0TXMiLCJ3c09uT3BlbiIsImFsbCIsInVwZGF0ZVRpbWVPZmZzZXQiLCJkaXNjb25uZWN0IiwiY2xlYXJUaW1lb3V0IiwicmVtb3ZlQWxsT2NjdXBhbnRzIiwiY29ubiIsImNsb3NlIiwiZGlzcG9zZSIsImRlbGF5ZWRSZWNvbm5lY3RUaW1lb3V0IiwiaXNEaXNjb25uZWN0ZWQiLCJjcmVhdGUiLCJjcmVhdGVQdWJsaXNoZXIiLCJpIiwiaW5pdGlhbE9jY3VwYW50cyIsImxlbmd0aCIsIm9jY3VwYW50SWQiLCJhZGRBdmFpbGFibGVPY2N1cGFudCIsInN5bmNPY2N1cGFudHMiLCJldmVudCIsImNvZGUiLCJFcnJvciIsInBlcmZvcm1EZWxheWVkUmVjb25uZWN0IiwicmVjZWl2ZSIsIkpTT04iLCJwYXJzZSIsImRhdGEiLCJwdXNoIiwicmVtb3ZlQXZhaWxhYmxlT2NjdXBhbnQiLCJpZHgiLCJzcGxpY2UiLCJoYXMiLCJhZGRPY2N1cGFudCIsImoiLCJyZW1vdmVPY2N1cGFudCIsImFkZCIsImF2YWlsYWJsZU9jY3VwYW50c0NvdW50Iiwic3Vic2NyaWJlciIsImNyZWF0ZVN1YnNjcmliZXIiLCJkZWxldGUiLCJzZXRNZWRpYVN0cmVhbSIsIm1lZGlhU3RyZWFtIiwibXNnIiwiZ2V0IiwiYXVkaW8iLCJhc3NvY2lhdGUiLCJoYW5kbGUiLCJldiIsInNlbmRUcmlja2xlIiwiY2FuZGlkYXRlIiwiaWNlQ29ubmVjdGlvblN0YXRlIiwibG9nIiwib2ZmZXIiLCJjcmVhdGVPZmZlciIsImNvbmZpZ3VyZVB1Ymxpc2hlclNkcCIsImZpeFNhZmFyaUljZVVGcmFnIiwibG9jYWwiLCJvIiwic2V0TG9jYWxEZXNjcmlwdGlvbiIsInJlbW90ZSIsInNlbmRKc2VwIiwiciIsInNldFJlbW90ZURlc2NyaXB0aW9uIiwianNlcCIsIm9uIiwiYW5zd2VyIiwiY29uZmlndXJlU3Vic2NyaWJlclNkcCIsImNyZWF0ZUFuc3dlciIsImEiLCJKYW51c1BsdWdpbkhhbmRsZSIsIlJUQ1BlZXJDb25uZWN0aW9uIiwiYXR0YWNoIiwid2VicnRjdXAiLCJyZWxpYWJsZUNoYW5uZWwiLCJjcmVhdGVEYXRhQ2hhbm5lbCIsIm9yZGVyZWQiLCJ1bnJlbGlhYmxlQ2hhbm5lbCIsIm1heFJldHJhbnNtaXRzIiwiZ2V0VHJhY2tzIiwiZm9yRWFjaCIsImFkZFRyYWNrIiwidHJhY2siLCJwbHVnaW5kYXRhIiwicm9vbV9pZCIsInVzZXJfaWQiLCJib2R5IiwiZGlzcGF0Y2hFdmVudCIsIkN1c3RvbUV2ZW50IiwiZGV0YWlsIiwiYnkiLCJzZW5kSm9pbiIsIm5vdGlmaWNhdGlvbnMiLCJzdWNjZXNzIiwiZXJyIiwicmVzcG9uc2UiLCJ1c2VycyIsImluY2x1ZGVzIiwic2RwIiwicmVwbGFjZSIsImxpbmUiLCJwdCIsInBhcmFtZXRlcnMiLCJPYmplY3QiLCJhc3NpZ24iLCJwYXJzZUZtdHAiLCJ3cml0ZUZtdHAiLCJwYXlsb2FkVHlwZSIsIm1heFJldHJpZXMiLCJ3ZWJydGNGYWlsZWQiLCJsZWZ0SW50ZXJ2YWwiLCJzZXRJbnRlcnZhbCIsImNsZWFySW50ZXJ2YWwiLCJ0aW1lb3V0IiwibWVkaWEiLCJfaU9TSGFja0RlbGF5ZWRJbml0aWFsUGVlciIsIk1lZGlhU3RyZWFtIiwicmVjZWl2ZXJzIiwiZ2V0UmVjZWl2ZXJzIiwicmVjZWl2ZXIiLCJzdWJzY3JpYmUiLCJzZW5kTWVzc2FnZSIsImtpbmQiLCJ0b2tlbiIsInRvZ2dsZUZyZWV6ZSIsImZyb3plbiIsInVuZnJlZXplIiwiZnJlZXplIiwiZmx1c2hQZW5kaW5nVXBkYXRlcyIsImRhdGFGb3JVcGRhdGVNdWx0aU1lc3NhZ2UiLCJuZXR3b3JrSWQiLCJsIiwiZCIsImdldFBlbmRpbmdEYXRhIiwiZGF0YVR5cGUiLCJvd25lciIsImdldFBlbmRpbmdEYXRhRm9yTmV0d29ya0lkIiwic291cmNlIiwic3RvcmVNZXNzYWdlIiwic3RvcmVTaW5nbGVNZXNzYWdlIiwiaW5kZXgiLCJ1bmRlZmluZWQiLCJzZXQiLCJzdG9yZWRNZXNzYWdlIiwic3RvcmVkRGF0YSIsImlzT3V0ZGF0ZWRNZXNzYWdlIiwibGFzdE93bmVyVGltZSIsImlzQ29udGVtcG9yYW5lb3VzTWVzc2FnZSIsImNyZWF0ZWRXaGlsZUZyb3plbiIsImlzRmlyc3RTeW5jIiwiY29tcG9uZW50cyIsImVuYWJsZWQiLCJzaG91bGRTdGFydENvbm5lY3Rpb25UbyIsImNsaWVudCIsInN0YXJ0U3RyZWFtQ29ubmVjdGlvbiIsImNsb3NlU3RyZWFtQ29ubmVjdGlvbiIsImdldENvbm5lY3RTdGF0dXMiLCJhZGFwdGVycyIsIklTX0NPTk5FQ1RFRCIsIk5PVF9DT05ORUNURUQiLCJjbGllbnRTZW50VGltZSIsIkRhdGUiLCJub3ciLCJyZXMiLCJmZXRjaCIsImxvY2F0aW9uIiwiaHJlZiIsIm1ldGhvZCIsImNhY2hlIiwicHJlY2lzaW9uIiwic2VydmVyUmVjZWl2ZWRUaW1lIiwiaGVhZGVycyIsImdldFRpbWUiLCJjbGllbnRSZWNlaXZlZFRpbWUiLCJzZXJ2ZXJUaW1lIiwidGltZU9mZnNldCIsInJlZHVjZSIsImFjYyIsIm9mZnNldCIsImdldFNlcnZlclRpbWUiLCJnZXRNZWRpYVN0cmVhbSIsImF1ZGlvUHJvbWlzZSIsInZpZGVvUHJvbWlzZSIsInByb21pc2UiLCJzdHJlYW0iLCJhdWRpb1N0cmVhbSIsImdldEF1ZGlvVHJhY2tzIiwidmlkZW9TdHJlYW0iLCJnZXRWaWRlb1RyYWNrcyIsInNldExvY2FsTWVkaWFTdHJlYW0iLCJleGlzdGluZ1NlbmRlcnMiLCJnZXRTZW5kZXJzIiwibmV3U2VuZGVycyIsInRyYWNrcyIsInQiLCJzZW5kZXIiLCJmaW5kIiwicyIsInJlcGxhY2VUcmFjayIsInRvTG93ZXJDYXNlIiwicmVtb3ZlVHJhY2siLCJlbmFibGVNaWNyb3Bob25lIiwic2VuZERhdGEiLCJzdHJpbmdpZnkiLCJ3aG9tIiwic2VuZERhdGFHdWFyYW50ZWVkIiwiYnJvYWRjYXN0RGF0YSIsImJyb2FkY2FzdERhdGFHdWFyYW50ZWVkIiwia2ljayIsInBlcm1zVG9rZW4iLCJibG9jayIsInVuYmxvY2siLCJyZWdpc3RlciIsIm1vZHVsZSIsImV4cG9ydHMiXSwibWFwcGluZ3MiOiI7UUFBQTtRQUNBOztRQUVBO1FBQ0E7O1FBRUE7UUFDQTtRQUNBO1FBQ0E7UUFDQTtRQUNBO1FBQ0E7UUFDQTtRQUNBO1FBQ0E7O1FBRUE7UUFDQTs7UUFFQTtRQUNBOztRQUVBO1FBQ0E7UUFDQTs7O1FBR0E7UUFDQTs7UUFFQTtRQUNBOztRQUVBO1FBQ0E7UUFDQTtRQUNBLDBDQUEwQyxnQ0FBZ0M7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QUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQSxXQUFXLE9BQU87QUFDbEIsWUFBWTtBQUNaO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0EsV0FBVyxPQUFPO0FBQ2xCLFlBQVk7QUFDWjtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTs7Ozs7Ozs7Ozs7O0FDaktBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLFNBQVM7QUFDVDtBQUNBO0FBQ0EsS0FBSztBQUNMO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxTQUFTO0FBQ1Q7QUFDQTtBQUNBLEtBQUs7QUFDTDtBQUNBO0FBQ0EsQ0FBQztBQUNEO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsS0FBSztBQUNMO0FBQ0E7QUFDQTtBQUNBLFNBQVM7QUFDVDtBQUNBO0FBQ0E7QUFDQTs7O0FBR0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEtBQUs7QUFDTDtBQUNBO0FBQ0E7QUFDQSxTQUFTO0FBQ1Q7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQUlBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxLQUFLO0FBQ0w7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztB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O0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxHQUFHO0FBQ0g7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsaUJBQWlCLGtCQUFrQixPQUFPO0FBQzFDO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxHQUFHO0FBQ0g7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQSw0Q0FBNEM7QUFDNUM7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsR0FBRzs7QUFFSDtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxHQUFHO0FBQ0g7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEdBQUc7QUFDSDtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0EsS0FBSztBQUNMO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEtBQUs7QUFDTDtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSx3QkFBd0I7QUFDeEI7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEdBQUc7QUFDSDtBQUNBO0FBQ0E7QUFDQSxLQUFLO0FBQ0w7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEtBQUs7QUFDTDtBQUNBO0FBQ0E7QUFDQSxLQUFLO0FBQ0w7QUFDQTtBQUNBO0FBQ0E7QUFDQSxLQUFLO0FBQ0w7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQUdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsWUFBWTtBQUNaO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLFlBQVk7QUFDWjtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FB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dXJjZXNDb250ZW50IjpbIiBcdC8vIFRoZSBtb2R1bGUgY2FjaGVcbiBcdHZhciBpbnN0YWxsZWRNb2R1bGVzID0ge307XG5cbiBcdC8vIFRoZSByZXF1aXJlIGZ1bmN0aW9uXG4gXHRmdW5jdGlvbiBfX3dlYnBhY2tfcmVxdWlyZV9fKG1vZHVsZUlkKSB7XG5cbiBcdFx0Ly8gQ2hlY2sgaWYgbW9kdWxlIGlzIGluIGNhY2hlXG4gXHRcdGlmKGluc3RhbGxlZE1vZHVsZXNbbW9kdWxlSWRdKSB7XG4gXHRcdFx0cmV0dXJuIGluc3RhbGxlZE1vZHVsZXNbbW9kdWxlSWRdLmV4cG9ydHM7XG4gXHRcdH1cbiBcdFx0Ly8gQ3JlYXRlIGEgbmV3IG1vZHVsZSAoYW5kIHB1dCBpdCBpbnRvIHRoZSBjYWNoZSlcbiBcdFx0dmFyIG1vZHVsZSA9IGluc3RhbGxlZE1vZHVsZXNbbW9kdWxlSWRdID0ge1xuIFx0XHRcdGk6IG1vZHVsZUlkLFxuIFx0XHRcdGw6IGZhbHNlLFxuIFx0XHRcdGV4cG9ydHM6IHt9XG4gXHRcdH07XG5cbiBcdFx0Ly8gRXhlY3V0ZSB0aGUgbW9kdWxlIGZ1bmN0aW9uXG4gXHRcdG1vZHVsZXNbbW9kdWxlSWRdLmNhbGwobW9kdWxlLmV4cG9ydHMsIG1vZHVsZSwgbW9kdWxlLmV4cG9ydHMsIF9fd2VicGFja19yZXF1aXJlX18pO1xuXG4gXHRcdC8vIEZsYWcgdGhlIG1vZHVsZSBhcyBsb2FkZWRcbiBcdFx0bW9kdWxlLmwgPSB0cnVlO1xuXG4gXHRcdC8vIFJldHVybiB0aGUgZXhwb3J0cyBvZiB0aGUgbW9kdWxlXG4gXHRcdHJldHVybiBtb2R1bGUuZXhwb3J0cztcbiBcdH1cblxuXG4gXHQvLyBleHBvc2UgdGhlIG1vZHVsZXMgb2JqZWN0IChfX3dlYnBhY2tfbW9kdWxlc19fKVxuIFx0X193ZWJwYWNrX3JlcXVpcmVfXy5tID0gbW9kdWxlcztcblxuIFx0Ly8gZXhwb3NlIHRoZSBtb2R1bGUgY2FjaGVcbiBcdF9fd2VicGFja19yZXF1aXJlX18uYyA9IGluc3RhbGxlZE1vZHVsZXM7XG5cbiBcdC8vIGRlZmluZSBnZXR0ZXIgZnVuY3Rpb24gZm9yIGhhcm1vbnkgZXhwb3J0c1xuIFx0X193ZWJwYWNrX3JlcXVpcmVfXy5kID0gZnVuY3Rpb24oZXhwb3J0cywgbmFtZSwgZ2V0dGVyKSB7XG4gXHRcdGlmKCFfX3dlYnBhY2tfcmVxdWlyZV9fLm8oZXhwb3J0cywgbmFtZSkpIHtcbiBcdFx0XHRPYmplY3QuZGVmaW5lUHJvcGVydHkoZXhwb3J0cywgbmFtZSwgeyBlbnVtZXJhYmxlOiB0cnVlLCBnZXQ6IGdldHRlciB9KTtcbiBcdFx0fVxuIFx0fTtcblxuIFx0Ly8gZGVmaW5lIF9fZXNNb2R1bGUgb24gZXhwb3J0c1xuIFx0X193ZWJwYWNrX3JlcXVpcmVfXy5yID0gZnVuY3Rpb24oZXhwb3J0cykge1xuIFx0XHRpZih0eXBlb2YgU3ltYm9sICE9PSAndW5kZWZpbmVkJyAmJiBTeW1ib2wudG9TdHJpbmdUYWcpIHtcbiBcdFx0XHRPYmplY3QuZGVmaW5lUHJvcGVydHkoZXhwb3J0cywgU3ltYm9sLnRvU3RyaW5nVGFnLCB7IHZhbHVlOiAnTW9kdWxlJyB9KTtcbiBcdFx0fVxuIFx0XHRPYmplY3QuZGVmaW5lUHJvcGVydHkoZXhwb3J0cywgJ19fZXNNb2R1bGUnLCB7IHZhbHVlOiB0cnVlIH0pO1xuIFx0fTtcblxuIFx0Ly8gY3JlYXRlIGEgZmFrZSBuYW1lc3BhY2Ugb2JqZWN0XG4gXHQvLyBtb2RlICYgMTogdmFsdWUgaXMgYSBtb2R1bGUgaWQsIHJlcXVpcmUgaXRcbiBcdC8vIG1vZGUgJiAyOiBtZXJnZSBhbGwgcHJvcGVydGllcyBvZiB2YWx1ZSBpbnRvIHRoZSBuc1xuIFx0Ly8gbW9kZSAmIDQ6IHJldHVybiB2YWx1ZSB3aGVuIGFscmVhZHkgbnMgb2JqZWN0XG4gXHQvLyBtb2RlICYgOHwxOiBiZWhhdmUgbGlrZSByZXF1aXJlXG4gXHRfX3dlYnBhY2tfcmVxdWlyZV9fLnQgPSBmdW5jdGlvbih2YWx1ZSwgbW9kZSkge1xuIFx0XHRpZihtb2RlICYgMSkgdmFsdWUgPSBfX3dlYnBhY2tfcmVxdWlyZV9fKHZhbHVlKTtcbiBcdFx0aWYobW9kZSAmIDgpIHJldHVybiB2YWx1ZTtcbiBcdFx0aWYoKG1vZGUgJiA0KSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHZhbHVlICYmIHZhbHVlLl9fZXNNb2R1bGUpIHJldHVybiB2YWx1ZTtcbiBcdFx0dmFyIG5zID0gT2JqZWN0LmNyZWF0ZShudWxsKTtcbiBcdFx0X193ZWJwYWNrX3JlcXVpcmVfXy5yKG5zKTtcbiBcdFx0T2JqZWN0LmRlZmluZVByb3BlcnR5KG5zLCAnZGVmYXVsdCcsIHsgZW51bWVyYWJsZTogdHJ1ZSwgdmFsdWU6IHZhbHVlIH0pO1xuIFx0XHRpZihtb2RlICYgMiAmJiB0eXBlb2YgdmFsdWUgIT0gJ3N0cmluZycpIGZvcih2YXIga2V5IGluIHZhbHVlKSBfX3dlYnBhY2tfcmVxdWlyZV9fLmQobnMsIGtleSwgZnVuY3Rpb24oa2V5KSB7IHJldHVybiB2YWx1ZVtrZXldOyB9LmJpbmQobnVsbCwga2V5KSk7XG4gXHRcdHJldHVybiBucztcbiBcdH07XG5cbiBcdC8vIGdldERlZmF1bHRFeHBvcnQgZnVuY3Rpb24gZm9yIGNvbXBhdGliaWxpdHkgd2l0aCBub24taGFybW9ueSBtb2R1bGVzXG4gXHRfX3dlYnBhY2tfcmVxdWlyZV9fLm4gPSBmdW5jdGlvbihtb2R1bGUpIHtcbiBcdFx0dmFyIGdldHRlciA9IG1vZHVsZSAmJiBtb2R1bGUuX19lc01vZHVsZSA/XG4gXHRcdFx0ZnVuY3Rpb24gZ2V0RGVmYXVsdCgpIHsgcmV0dXJuIG1vZHVsZVsnZGVmYXVsdCddOyB9IDpcbiBcdFx0XHRmdW5jdGlvbiBnZXRNb2R1bGVFeHBvcnRzKCkgeyByZXR1cm4gbW9kdWxlOyB9O1xuIFx0XHRfX3dlYnBhY2tfcmVxdWlyZV9fLmQoZ2V0dGVyLCAnYScsIGdldHRlcik7XG4gXHRcdHJldHVybiBnZXR0ZXI7XG4gXHR9O1xuXG4gXHQvLyBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGxcbiBcdF9fd2VicGFja19yZXF1aXJlX18ubyA9IGZ1bmN0aW9uKG9iamVjdCwgcHJvcGVydHkpIHsgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChvYmplY3QsIHByb3BlcnR5KTsgfTtcblxuIFx0Ly8gX193ZWJwYWNrX3B1YmxpY19wYXRoX19cbiBcdF9fd2VicGFja19yZXF1aXJlX18ucCA9IFwiXCI7XG5cblxuIFx0Ly8gTG9hZCBlbnRyeSBtb2R1bGUgYW5kIHJldHVybiBleHBvcnRzXG4gXHRyZXR1cm4gX193ZWJwYWNrX3JlcXVpcmVfXyhfX3dlYnBhY2tfcmVxdWlyZV9fLnMgPSBcIi4vc3JjL2luZGV4LmpzXCIpO1xuIiwiXCJ1c2Ugc3RyaWN0XCI7XG5cbmZ1bmN0aW9uIF90eXBlb2Yob2JqKSB7IGlmICh0eXBlb2YgU3ltYm9sID09PSBcImZ1bmN0aW9uXCIgJiYgdHlwZW9mIFN5bWJvbC5pdGVyYXRvciA9PT0gXCJzeW1ib2xcIikgeyBfdHlwZW9mID0gZnVuY3Rpb24gX3R5cGVvZihvYmopIHsgcmV0dXJuIHR5cGVvZiBvYmo7IH07IH0gZWxzZSB7IF90eXBlb2YgPSBmdW5jdGlvbiBfdHlwZW9mKG9iaikgeyByZXR1cm4gb2JqICYmIHR5cGVvZiBTeW1ib2wgPT09IFwiZnVuY3Rpb25cIiAmJiBvYmouY29uc3RydWN0b3IgPT09IFN5bWJvbCAmJiBvYmogIT09IFN5bWJvbC5wcm90b3R5cGUgPyBcInN5bWJvbFwiIDogdHlwZW9mIG9iajsgfTsgfSByZXR1cm4gX3R5cGVvZihvYmopOyB9XG5cbi8qIGVzbGludC1lbnYgYnJvd3NlciAqL1xuXG4vKipcbiAqIFRoaXMgaXMgdGhlIHdlYiBicm93c2VyIGltcGxlbWVudGF0aW9uIG9mIGBkZWJ1ZygpYC5cbiAqL1xuZXhwb3J0cy5sb2cgPSBsb2c7XG5leHBvcnRzLmZvcm1hdEFyZ3MgPSBmb3JtYXRBcmdzO1xuZXhwb3J0cy5zYXZlID0gc2F2ZTtcbmV4cG9ydHMubG9hZCA9IGxvYWQ7XG5leHBvcnRzLnVzZUNvbG9ycyA9IHVzZUNvbG9ycztcbmV4cG9ydHMuc3RvcmFnZSA9IGxvY2Fsc3RvcmFnZSgpO1xuLyoqXG4gKiBDb2xvcnMuXG4gKi9cblxuZXhwb3J0cy5jb2xvcnMgPSBbJyMwMDAwQ0MnLCAnIzAwMDBGRicsICcjMDAzM0NDJywgJyMwMDMzRkYnLCAnIzAwNjZDQycsICcjMDA2NkZGJywgJyMwMDk5Q0MnLCAnIzAwOTlGRicsICcjMDBDQzAwJywgJyMwMENDMzMnLCAnIzAwQ0M2NicsICcjMDBDQzk5JywgJyMwMENDQ0MnLCAnIzAwQ0NGRicsICcjMzMwMENDJywgJyMzMzAwRkYnLCAnIzMzMzNDQycsICcjMzMzM0ZGJywgJyMzMzY2Q0MnLCAnIzMzNjZGRicsICcjMzM5OUNDJywgJyMzMzk5RkYnLCAnIzMzQ0MwMCcsICcjMzNDQzMzJywgJyMzM0NDNjYnLCAnIzMzQ0M5OScsICcjMzNDQ0NDJywgJyMzM0NDRkYnLCAnIzY2MDBDQycsICcjNjYwMEZGJywgJyM2NjMzQ0MnLCAnIzY2MzNGRicsICcjNjZDQzAwJywgJyM2NkNDMzMnLCAnIzk5MDBDQycsICcjOTkwMEZGJywgJyM5OTMzQ0MnLCAnIzk5MzNGRicsICcjOTlDQzAwJywgJyM5OUNDMzMnLCAnI0NDMDAwMCcsICcjQ0MwMDMzJywgJyNDQzAwNjYnLCAnI0NDMDA5OScsICcjQ0MwMENDJywgJyNDQzAwRkYnLCAnI0NDMzMwMCcsICcjQ0MzMzMzJywgJyNDQzMzNjYnLCAnI0NDMzM5OScsICcjQ0MzM0NDJywgJyNDQzMzRkYnLCAnI0NDNjYwMCcsICcjQ0M2NjMzJywgJyNDQzk5MDAnLCAnI0NDOTkzMycsICcjQ0NDQzAwJywgJyNDQ0NDMzMnLCAnI0ZGMDAwMCcsICcjRkYwMDMzJywgJyNGRjAwNjYnLCAnI0ZGMDA5OScsICcjRkYwMENDJywgJyNGRjAwRkYnLCAnI0ZGMzMwMCcsICcjRkYzMzMzJywgJyNGRjMzNjYnLCAnI0ZGMzM5OScsICcjRkYzM0NDJywgJyNGRjMzRkYnLCAnI0ZGNjYwMCcsICcjRkY2NjMzJywgJyNGRjk5MDAnLCAnI0ZGOTkzMycsICcjRkZDQzAwJywgJyNGRkNDMzMnXTtcbi8qKlxuICogQ3VycmVudGx5IG9ubHkgV2ViS2l0LWJhc2VkIFdlYiBJbnNwZWN0b3JzLCBGaXJlZm94ID49IHYzMSxcbiAqIGFuZCB0aGUgRmlyZWJ1ZyBleHRlbnNpb24gKGFueSBGaXJlZm94IHZlcnNpb24pIGFyZSBrbm93blxuICogdG8gc3VwcG9ydCBcIiVjXCIgQ1NTIGN1c3RvbWl6YXRpb25zLlxuICpcbiAqIFRPRE86IGFkZCBhIGBsb2NhbFN0b3JhZ2VgIHZhcmlhYmxlIHRvIGV4cGxpY2l0bHkgZW5hYmxlL2Rpc2FibGUgY29sb3JzXG4gKi9cbi8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBjb21wbGV4aXR5XG5cbmZ1bmN0aW9uIHVzZUNvbG9ycygpIHtcbiAgLy8gTkI6IEluIGFuIEVsZWN0cm9uIHByZWxvYWQgc2NyaXB0LCBkb2N1bWVudCB3aWxsIGJlIGRlZmluZWQgYnV0IG5vdCBmdWxseVxuICAvLyBpbml0aWFsaXplZC4gU2luY2Ugd2Uga25vdyB3ZSdyZSBpbiBDaHJvbWUsIHdlJ2xsIGp1c3QgZGV0ZWN0IHRoaXMgY2FzZVxuICAvLyBleHBsaWNpdGx5XG4gIGlmICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyAmJiB3aW5kb3cucHJvY2VzcyAmJiAod2luZG93LnByb2Nlc3MudHlwZSA9PT0gJ3JlbmRlcmVyJyB8fCB3aW5kb3cucHJvY2Vzcy5fX253anMpKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0gLy8gSW50ZXJuZXQgRXhwbG9yZXIgYW5kIEVkZ2UgZG8gbm90IHN1cHBvcnQgY29sb3JzLlxuXG5cbiAgaWYgKHR5cGVvZiBuYXZpZ2F0b3IgIT09ICd1bmRlZmluZWQnICYmIG5hdmlnYXRvci51c2VyQWdlbnQgJiYgbmF2aWdhdG9yLnVzZXJBZ2VudC50b0xvd2VyQ2FzZSgpLm1hdGNoKC8oZWRnZXx0cmlkZW50KVxcLyhcXGQrKS8pKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9IC8vIElzIHdlYmtpdD8gaHR0cDovL3N0YWNrb3ZlcmZsb3cuY29tL2EvMTY0NTk2MDYvMzc2NzczXG4gIC8vIGRvY3VtZW50IGlzIHVuZGVmaW5lZCBpbiByZWFjdC1uYXRpdmU6IGh0dHBzOi8vZ2l0aHViLmNvbS9mYWNlYm9vay9yZWFjdC1uYXRpdmUvcHVsbC8xNjMyXG5cblxuICByZXR1cm4gdHlwZW9mIGRvY3VtZW50ICE9PSAndW5kZWZpbmVkJyAmJiBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQgJiYgZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LnN0eWxlICYmIGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5zdHlsZS5XZWJraXRBcHBlYXJhbmNlIHx8IC8vIElzIGZpcmVidWc/IGh0dHA6Ly9zdGFja292ZXJmbG93LmNvbS9hLzM5ODEyMC8zNzY3NzNcbiAgdHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgJiYgd2luZG93LmNvbnNvbGUgJiYgKHdpbmRvdy5jb25zb2xlLmZpcmVidWcgfHwgd2luZG93LmNvbnNvbGUuZXhjZXB0aW9uICYmIHdpbmRvdy5jb25zb2xlLnRhYmxlKSB8fCAvLyBJcyBmaXJlZm94ID49IHYzMT9cbiAgLy8gaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4tVVMvZG9jcy9Ub29scy9XZWJfQ29uc29sZSNTdHlsaW5nX21lc3NhZ2VzXG4gIHR5cGVvZiBuYXZpZ2F0b3IgIT09ICd1bmRlZmluZWQnICYmIG5hdmlnYXRvci51c2VyQWdlbnQgJiYgbmF2aWdhdG9yLnVzZXJBZ2VudC50b0xvd2VyQ2FzZSgpLm1hdGNoKC9maXJlZm94XFwvKFxcZCspLykgJiYgcGFyc2VJbnQoUmVnRXhwLiQxLCAxMCkgPj0gMzEgfHwgLy8gRG91YmxlIGNoZWNrIHdlYmtpdCBpbiB1c2VyQWdlbnQganVzdCBpbiBjYXNlIHdlIGFyZSBpbiBhIHdvcmtlclxuICB0eXBlb2YgbmF2aWdhdG9yICE9PSAndW5kZWZpbmVkJyAmJiBuYXZpZ2F0b3IudXNlckFnZW50ICYmIG5hdmlnYXRvci51c2VyQWdlbnQudG9Mb3dlckNhc2UoKS5tYXRjaCgvYXBwbGV3ZWJraXRcXC8oXFxkKykvKTtcbn1cbi8qKlxuICogQ29sb3JpemUgbG9nIGFyZ3VtZW50cyBpZiBlbmFibGVkLlxuICpcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuXG5mdW5jdGlvbiBmb3JtYXRBcmdzKGFyZ3MpIHtcbiAgYXJnc1swXSA9ICh0aGlzLnVzZUNvbG9ycyA/ICclYycgOiAnJykgKyB0aGlzLm5hbWVzcGFjZSArICh0aGlzLnVzZUNvbG9ycyA/ICcgJWMnIDogJyAnKSArIGFyZ3NbMF0gKyAodGhpcy51c2VDb2xvcnMgPyAnJWMgJyA6ICcgJykgKyAnKycgKyBtb2R1bGUuZXhwb3J0cy5odW1hbml6ZSh0aGlzLmRpZmYpO1xuXG4gIGlmICghdGhpcy51c2VDb2xvcnMpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICB2YXIgYyA9ICdjb2xvcjogJyArIHRoaXMuY29sb3I7XG4gIGFyZ3Muc3BsaWNlKDEsIDAsIGMsICdjb2xvcjogaW5oZXJpdCcpOyAvLyBUaGUgZmluYWwgXCIlY1wiIGlzIHNvbWV3aGF0IHRyaWNreSwgYmVjYXVzZSB0aGVyZSBjb3VsZCBiZSBvdGhlclxuICAvLyBhcmd1bWVudHMgcGFzc2VkIGVpdGhlciBiZWZvcmUgb3IgYWZ0ZXIgdGhlICVjLCBzbyB3ZSBuZWVkIHRvXG4gIC8vIGZpZ3VyZSBvdXQgdGhlIGNvcnJlY3QgaW5kZXggdG8gaW5zZXJ0IHRoZSBDU1MgaW50b1xuXG4gIHZhciBpbmRleCA9IDA7XG4gIHZhciBsYXN0QyA9IDA7XG4gIGFyZ3NbMF0ucmVwbGFjZSgvJVthLXpBLVolXS9nLCBmdW5jdGlvbiAobWF0Y2gpIHtcbiAgICBpZiAobWF0Y2ggPT09ICclJScpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpbmRleCsrO1xuXG4gICAgaWYgKG1hdGNoID09PSAnJWMnKSB7XG4gICAgICAvLyBXZSBvbmx5IGFyZSBpbnRlcmVzdGVkIGluIHRoZSAqbGFzdCogJWNcbiAgICAgIC8vICh0aGUgdXNlciBtYXkgaGF2ZSBwcm92aWRlZCB0aGVpciBvd24pXG4gICAgICBsYXN0QyA9IGluZGV4O1xuICAgIH1cbiAgfSk7XG4gIGFyZ3Muc3BsaWNlKGxhc3RDLCAwLCBjKTtcbn1cbi8qKlxuICogSW52b2tlcyBgY29uc29sZS5sb2coKWAgd2hlbiBhdmFpbGFibGUuXG4gKiBOby1vcCB3aGVuIGBjb25zb2xlLmxvZ2AgaXMgbm90IGEgXCJmdW5jdGlvblwiLlxuICpcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuXG5mdW5jdGlvbiBsb2coKSB7XG4gIHZhciBfY29uc29sZTtcblxuICAvLyBUaGlzIGhhY2tlcnkgaXMgcmVxdWlyZWQgZm9yIElFOC85LCB3aGVyZVxuICAvLyB0aGUgYGNvbnNvbGUubG9nYCBmdW5jdGlvbiBkb2Vzbid0IGhhdmUgJ2FwcGx5J1xuICByZXR1cm4gKHR5cGVvZiBjb25zb2xlID09PSBcInVuZGVmaW5lZFwiID8gXCJ1bmRlZmluZWRcIiA6IF90eXBlb2YoY29uc29sZSkpID09PSAnb2JqZWN0JyAmJiBjb25zb2xlLmxvZyAmJiAoX2NvbnNvbGUgPSBjb25zb2xlKS5sb2cuYXBwbHkoX2NvbnNvbGUsIGFyZ3VtZW50cyk7XG59XG4vKipcbiAqIFNhdmUgYG5hbWVzcGFjZXNgLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lc3BhY2VzXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5cbmZ1bmN0aW9uIHNhdmUobmFtZXNwYWNlcykge1xuICB0cnkge1xuICAgIGlmIChuYW1lc3BhY2VzKSB7XG4gICAgICBleHBvcnRzLnN0b3JhZ2Uuc2V0SXRlbSgnZGVidWcnLCBuYW1lc3BhY2VzKTtcbiAgICB9IGVsc2Uge1xuICAgICAgZXhwb3J0cy5zdG9yYWdlLnJlbW92ZUl0ZW0oJ2RlYnVnJyk7XG4gICAgfVxuICB9IGNhdGNoIChlcnJvcikgey8vIFN3YWxsb3dcbiAgICAvLyBYWFggKEBRaXgtKSBzaG91bGQgd2UgYmUgbG9nZ2luZyB0aGVzZT9cbiAgfVxufVxuLyoqXG4gKiBMb2FkIGBuYW1lc3BhY2VzYC5cbiAqXG4gKiBAcmV0dXJuIHtTdHJpbmd9IHJldHVybnMgdGhlIHByZXZpb3VzbHkgcGVyc2lzdGVkIGRlYnVnIG1vZGVzXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5cbmZ1bmN0aW9uIGxvYWQoKSB7XG4gIHZhciByO1xuXG4gIHRyeSB7XG4gICAgciA9IGV4cG9ydHMuc3RvcmFnZS5nZXRJdGVtKCdkZWJ1ZycpO1xuICB9IGNhdGNoIChlcnJvcikge30gLy8gU3dhbGxvd1xuICAvLyBYWFggKEBRaXgtKSBzaG91bGQgd2UgYmUgbG9nZ2luZyB0aGVzZT9cbiAgLy8gSWYgZGVidWcgaXNuJ3Qgc2V0IGluIExTLCBhbmQgd2UncmUgaW4gRWxlY3Ryb24sIHRyeSB0byBsb2FkICRERUJVR1xuXG5cbiAgaWYgKCFyICYmIHR5cGVvZiBwcm9jZXNzICE9PSAndW5kZWZpbmVkJyAmJiAnZW52JyBpbiBwcm9jZXNzKSB7XG4gICAgciA9IHByb2Nlc3MuZW52LkRFQlVHO1xuICB9XG5cbiAgcmV0dXJuIHI7XG59XG4vKipcbiAqIExvY2Fsc3RvcmFnZSBhdHRlbXB0cyB0byByZXR1cm4gdGhlIGxvY2Fsc3RvcmFnZS5cbiAqXG4gKiBUaGlzIGlzIG5lY2Vzc2FyeSBiZWNhdXNlIHNhZmFyaSB0aHJvd3NcbiAqIHdoZW4gYSB1c2VyIGRpc2FibGVzIGNvb2tpZXMvbG9jYWxzdG9yYWdlXG4gKiBhbmQgeW91IGF0dGVtcHQgdG8gYWNjZXNzIGl0LlxuICpcbiAqIEByZXR1cm4ge0xvY2FsU3RvcmFnZX1cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cblxuZnVuY3Rpb24gbG9jYWxzdG9yYWdlKCkge1xuICB0cnkge1xuICAgIC8vIFRWTUxLaXQgKEFwcGxlIFRWIEpTIFJ1bnRpbWUpIGRvZXMgbm90IGhhdmUgYSB3aW5kb3cgb2JqZWN0LCBqdXN0IGxvY2FsU3RvcmFnZSBpbiB0aGUgZ2xvYmFsIGNvbnRleHRcbiAgICAvLyBUaGUgQnJvd3NlciBhbHNvIGhhcyBsb2NhbFN0b3JhZ2UgaW4gdGhlIGdsb2JhbCBjb250ZXh0LlxuICAgIHJldHVybiBsb2NhbFN0b3JhZ2U7XG4gIH0gY2F0Y2ggKGVycm9yKSB7Ly8gU3dhbGxvd1xuICAgIC8vIFhYWCAoQFFpeC0pIHNob3VsZCB3ZSBiZSBsb2dnaW5nIHRoZXNlP1xuICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9jb21tb24nKShleHBvcnRzKTtcbnZhciBmb3JtYXR0ZXJzID0gbW9kdWxlLmV4cG9ydHMuZm9ybWF0dGVycztcbi8qKlxuICogTWFwICVqIHRvIGBKU09OLnN0cmluZ2lmeSgpYCwgc2luY2Ugbm8gV2ViIEluc3BlY3RvcnMgZG8gdGhhdCBieSBkZWZhdWx0LlxuICovXG5cbmZvcm1hdHRlcnMuaiA9IGZ1bmN0aW9uICh2KSB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHYpO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHJldHVybiAnW1VuZXhwZWN0ZWRKU09OUGFyc2VFcnJvcl06ICcgKyBlcnJvci5tZXNzYWdlO1xuICB9XG59O1xuXG4iLCJcInVzZSBzdHJpY3RcIjtcblxuLyoqXG4gKiBUaGlzIGlzIHRoZSBjb21tb24gbG9naWMgZm9yIGJvdGggdGhlIE5vZGUuanMgYW5kIHdlYiBicm93c2VyXG4gKiBpbXBsZW1lbnRhdGlvbnMgb2YgYGRlYnVnKClgLlxuICovXG5mdW5jdGlvbiBzZXR1cChlbnYpIHtcbiAgY3JlYXRlRGVidWcuZGVidWcgPSBjcmVhdGVEZWJ1ZztcbiAgY3JlYXRlRGVidWcuZGVmYXVsdCA9IGNyZWF0ZURlYnVnO1xuICBjcmVhdGVEZWJ1Zy5jb2VyY2UgPSBjb2VyY2U7XG4gIGNyZWF0ZURlYnVnLmRpc2FibGUgPSBkaXNhYmxlO1xuICBjcmVhdGVEZWJ1Zy5lbmFibGUgPSBlbmFibGU7XG4gIGNyZWF0ZURlYnVnLmVuYWJsZWQgPSBlbmFibGVkO1xuICBjcmVhdGVEZWJ1Zy5odW1hbml6ZSA9IHJlcXVpcmUoJ21zJyk7XG4gIE9iamVjdC5rZXlzKGVudikuZm9yRWFjaChmdW5jdGlvbiAoa2V5KSB7XG4gICAgY3JlYXRlRGVidWdba2V5XSA9IGVudltrZXldO1xuICB9KTtcbiAgLyoqXG4gICogQWN0aXZlIGBkZWJ1Z2AgaW5zdGFuY2VzLlxuICAqL1xuXG4gIGNyZWF0ZURlYnVnLmluc3RhbmNlcyA9IFtdO1xuICAvKipcbiAgKiBUaGUgY3VycmVudGx5IGFjdGl2ZSBkZWJ1ZyBtb2RlIG5hbWVzLCBhbmQgbmFtZXMgdG8gc2tpcC5cbiAgKi9cblxuICBjcmVhdGVEZWJ1Zy5uYW1lcyA9IFtdO1xuICBjcmVhdGVEZWJ1Zy5za2lwcyA9IFtdO1xuICAvKipcbiAgKiBNYXAgb2Ygc3BlY2lhbCBcIiVuXCIgaGFuZGxpbmcgZnVuY3Rpb25zLCBmb3IgdGhlIGRlYnVnIFwiZm9ybWF0XCIgYXJndW1lbnQuXG4gICpcbiAgKiBWYWxpZCBrZXkgbmFtZXMgYXJlIGEgc2luZ2xlLCBsb3dlciBvciB1cHBlci1jYXNlIGxldHRlciwgaS5lLiBcIm5cIiBhbmQgXCJOXCIuXG4gICovXG5cbiAgY3JlYXRlRGVidWcuZm9ybWF0dGVycyA9IHt9O1xuICAvKipcbiAgKiBTZWxlY3RzIGEgY29sb3IgZm9yIGEgZGVidWcgbmFtZXNwYWNlXG4gICogQHBhcmFtIHtTdHJpbmd9IG5hbWVzcGFjZSBUaGUgbmFtZXNwYWNlIHN0cmluZyBmb3IgdGhlIGZvciB0aGUgZGVidWcgaW5zdGFuY2UgdG8gYmUgY29sb3JlZFxuICAqIEByZXR1cm4ge051bWJlcnxTdHJpbmd9IEFuIEFOU0kgY29sb3IgY29kZSBmb3IgdGhlIGdpdmVuIG5hbWVzcGFjZVxuICAqIEBhcGkgcHJpdmF0ZVxuICAqL1xuXG4gIGZ1bmN0aW9uIHNlbGVjdENvbG9yKG5hbWVzcGFjZSkge1xuICAgIHZhciBoYXNoID0gMDtcblxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbmFtZXNwYWNlLmxlbmd0aDsgaSsrKSB7XG4gICAgICBoYXNoID0gKGhhc2ggPDwgNSkgLSBoYXNoICsgbmFtZXNwYWNlLmNoYXJDb2RlQXQoaSk7XG4gICAgICBoYXNoIHw9IDA7IC8vIENvbnZlcnQgdG8gMzJiaXQgaW50ZWdlclxuICAgIH1cblxuICAgIHJldHVybiBjcmVhdGVEZWJ1Zy5jb2xvcnNbTWF0aC5hYnMoaGFzaCkgJSBjcmVhdGVEZWJ1Zy5jb2xvcnMubGVuZ3RoXTtcbiAgfVxuXG4gIGNyZWF0ZURlYnVnLnNlbGVjdENvbG9yID0gc2VsZWN0Q29sb3I7XG4gIC8qKlxuICAqIENyZWF0ZSBhIGRlYnVnZ2VyIHdpdGggdGhlIGdpdmVuIGBuYW1lc3BhY2VgLlxuICAqXG4gICogQHBhcmFtIHtTdHJpbmd9IG5hbWVzcGFjZVxuICAqIEByZXR1cm4ge0Z1bmN0aW9ufVxuICAqIEBhcGkgcHVibGljXG4gICovXG5cbiAgZnVuY3Rpb24gY3JlYXRlRGVidWcobmFtZXNwYWNlKSB7XG4gICAgdmFyIHByZXZUaW1lO1xuXG4gICAgZnVuY3Rpb24gZGVidWcoKSB7XG4gICAgICAvLyBEaXNhYmxlZD9cbiAgICAgIGlmICghZGVidWcuZW5hYmxlZCkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGZvciAodmFyIF9sZW4gPSBhcmd1bWVudHMubGVuZ3RoLCBhcmdzID0gbmV3IEFycmF5KF9sZW4pLCBfa2V5ID0gMDsgX2tleSA8IF9sZW47IF9rZXkrKykge1xuICAgICAgICBhcmdzW19rZXldID0gYXJndW1lbnRzW19rZXldO1xuICAgICAgfVxuXG4gICAgICB2YXIgc2VsZiA9IGRlYnVnOyAvLyBTZXQgYGRpZmZgIHRpbWVzdGFtcFxuXG4gICAgICB2YXIgY3VyciA9IE51bWJlcihuZXcgRGF0ZSgpKTtcbiAgICAgIHZhciBtcyA9IGN1cnIgLSAocHJldlRpbWUgfHwgY3Vycik7XG4gICAgICBzZWxmLmRpZmYgPSBtcztcbiAgICAgIHNlbGYucHJldiA9IHByZXZUaW1lO1xuICAgICAgc2VsZi5jdXJyID0gY3VycjtcbiAgICAgIHByZXZUaW1lID0gY3VycjtcbiAgICAgIGFyZ3NbMF0gPSBjcmVhdGVEZWJ1Zy5jb2VyY2UoYXJnc1swXSk7XG5cbiAgICAgIGlmICh0eXBlb2YgYXJnc1swXSAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgLy8gQW55dGhpbmcgZWxzZSBsZXQncyBpbnNwZWN0IHdpdGggJU9cbiAgICAgICAgYXJncy51bnNoaWZ0KCclTycpO1xuICAgICAgfSAvLyBBcHBseSBhbnkgYGZvcm1hdHRlcnNgIHRyYW5zZm9ybWF0aW9uc1xuXG5cbiAgICAgIHZhciBpbmRleCA9IDA7XG4gICAgICBhcmdzWzBdID0gYXJnc1swXS5yZXBsYWNlKC8lKFthLXpBLVolXSkvZywgZnVuY3Rpb24gKG1hdGNoLCBmb3JtYXQpIHtcbiAgICAgICAgLy8gSWYgd2UgZW5jb3VudGVyIGFuIGVzY2FwZWQgJSB0aGVuIGRvbid0IGluY3JlYXNlIHRoZSBhcnJheSBpbmRleFxuICAgICAgICBpZiAobWF0Y2ggPT09ICclJScpIHtcbiAgICAgICAgICByZXR1cm4gbWF0Y2g7XG4gICAgICAgIH1cblxuICAgICAgICBpbmRleCsrO1xuICAgICAgICB2YXIgZm9ybWF0dGVyID0gY3JlYXRlRGVidWcuZm9ybWF0dGVyc1tmb3JtYXRdO1xuXG4gICAgICAgIGlmICh0eXBlb2YgZm9ybWF0dGVyID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgdmFyIHZhbCA9IGFyZ3NbaW5kZXhdO1xuICAgICAgICAgIG1hdGNoID0gZm9ybWF0dGVyLmNhbGwoc2VsZiwgdmFsKTsgLy8gTm93IHdlIG5lZWQgdG8gcmVtb3ZlIGBhcmdzW2luZGV4XWAgc2luY2UgaXQncyBpbmxpbmVkIGluIHRoZSBgZm9ybWF0YFxuXG4gICAgICAgICAgYXJncy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgICAgICAgIGluZGV4LS07XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gbWF0Y2g7XG4gICAgICB9KTsgLy8gQXBwbHkgZW52LXNwZWNpZmljIGZvcm1hdHRpbmcgKGNvbG9ycywgZXRjLilcblxuICAgICAgY3JlYXRlRGVidWcuZm9ybWF0QXJncy5jYWxsKHNlbGYsIGFyZ3MpO1xuICAgICAgdmFyIGxvZ0ZuID0gc2VsZi5sb2cgfHwgY3JlYXRlRGVidWcubG9nO1xuICAgICAgbG9nRm4uYXBwbHkoc2VsZiwgYXJncyk7XG4gICAgfVxuXG4gICAgZGVidWcubmFtZXNwYWNlID0gbmFtZXNwYWNlO1xuICAgIGRlYnVnLmVuYWJsZWQgPSBjcmVhdGVEZWJ1Zy5lbmFibGVkKG5hbWVzcGFjZSk7XG4gICAgZGVidWcudXNlQ29sb3JzID0gY3JlYXRlRGVidWcudXNlQ29sb3JzKCk7XG4gICAgZGVidWcuY29sb3IgPSBzZWxlY3RDb2xvcihuYW1lc3BhY2UpO1xuICAgIGRlYnVnLmRlc3Ryb3kgPSBkZXN0cm95O1xuICAgIGRlYnVnLmV4dGVuZCA9IGV4dGVuZDsgLy8gRGVidWcuZm9ybWF0QXJncyA9IGZvcm1hdEFyZ3M7XG4gICAgLy8gZGVidWcucmF3TG9nID0gcmF3TG9nO1xuICAgIC8vIGVudi1zcGVjaWZpYyBpbml0aWFsaXphdGlvbiBsb2dpYyBmb3IgZGVidWcgaW5zdGFuY2VzXG5cbiAgICBpZiAodHlwZW9mIGNyZWF0ZURlYnVnLmluaXQgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGNyZWF0ZURlYnVnLmluaXQoZGVidWcpO1xuICAgIH1cblxuICAgIGNyZWF0ZURlYnVnLmluc3RhbmNlcy5wdXNoKGRlYnVnKTtcbiAgICByZXR1cm4gZGVidWc7XG4gIH1cblxuICBmdW5jdGlvbiBkZXN0cm95KCkge1xuICAgIHZhciBpbmRleCA9IGNyZWF0ZURlYnVnLmluc3RhbmNlcy5pbmRleE9mKHRoaXMpO1xuXG4gICAgaWYgKGluZGV4ICE9PSAtMSkge1xuICAgICAgY3JlYXRlRGVidWcuaW5zdGFuY2VzLnNwbGljZShpbmRleCwgMSk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBmdW5jdGlvbiBleHRlbmQobmFtZXNwYWNlLCBkZWxpbWl0ZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlRGVidWcodGhpcy5uYW1lc3BhY2UgKyAodHlwZW9mIGRlbGltaXRlciA9PT0gJ3VuZGVmaW5lZCcgPyAnOicgOiBkZWxpbWl0ZXIpICsgbmFtZXNwYWNlKTtcbiAgfVxuICAvKipcbiAgKiBFbmFibGVzIGEgZGVidWcgbW9kZSBieSBuYW1lc3BhY2VzLiBUaGlzIGNhbiBpbmNsdWRlIG1vZGVzXG4gICogc2VwYXJhdGVkIGJ5IGEgY29sb24gYW5kIHdpbGRjYXJkcy5cbiAgKlxuICAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lc3BhY2VzXG4gICogQGFwaSBwdWJsaWNcbiAgKi9cblxuXG4gIGZ1bmN0aW9uIGVuYWJsZShuYW1lc3BhY2VzKSB7XG4gICAgY3JlYXRlRGVidWcuc2F2ZShuYW1lc3BhY2VzKTtcbiAgICBjcmVhdGVEZWJ1Zy5uYW1lcyA9IFtdO1xuICAgIGNyZWF0ZURlYnVnLnNraXBzID0gW107XG4gICAgdmFyIGk7XG4gICAgdmFyIHNwbGl0ID0gKHR5cGVvZiBuYW1lc3BhY2VzID09PSAnc3RyaW5nJyA/IG5hbWVzcGFjZXMgOiAnJykuc3BsaXQoL1tcXHMsXSsvKTtcbiAgICB2YXIgbGVuID0gc3BsaXQubGVuZ3RoO1xuXG4gICAgZm9yIChpID0gMDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICBpZiAoIXNwbGl0W2ldKSB7XG4gICAgICAgIC8vIGlnbm9yZSBlbXB0eSBzdHJpbmdzXG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBuYW1lc3BhY2VzID0gc3BsaXRbaV0ucmVwbGFjZSgvXFwqL2csICcuKj8nKTtcblxuICAgICAgaWYgKG5hbWVzcGFjZXNbMF0gPT09ICctJykge1xuICAgICAgICBjcmVhdGVEZWJ1Zy5za2lwcy5wdXNoKG5ldyBSZWdFeHAoJ14nICsgbmFtZXNwYWNlcy5zdWJzdHIoMSkgKyAnJCcpKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNyZWF0ZURlYnVnLm5hbWVzLnB1c2gobmV3IFJlZ0V4cCgnXicgKyBuYW1lc3BhY2VzICsgJyQnKSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgZm9yIChpID0gMDsgaSA8IGNyZWF0ZURlYnVnLmluc3RhbmNlcy5sZW5ndGg7IGkrKykge1xuICAgICAgdmFyIGluc3RhbmNlID0gY3JlYXRlRGVidWcuaW5zdGFuY2VzW2ldO1xuICAgICAgaW5zdGFuY2UuZW5hYmxlZCA9IGNyZWF0ZURlYnVnLmVuYWJsZWQoaW5zdGFuY2UubmFtZXNwYWNlKTtcbiAgICB9XG4gIH1cbiAgLyoqXG4gICogRGlzYWJsZSBkZWJ1ZyBvdXRwdXQuXG4gICpcbiAgKiBAYXBpIHB1YmxpY1xuICAqL1xuXG5cbiAgZnVuY3Rpb24gZGlzYWJsZSgpIHtcbiAgICBjcmVhdGVEZWJ1Zy5lbmFibGUoJycpO1xuICB9XG4gIC8qKlxuICAqIFJldHVybnMgdHJ1ZSBpZiB0aGUgZ2l2ZW4gbW9kZSBuYW1lIGlzIGVuYWJsZWQsIGZhbHNlIG90aGVyd2lzZS5cbiAgKlxuICAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lXG4gICogQHJldHVybiB7Qm9vbGVhbn1cbiAgKiBAYXBpIHB1YmxpY1xuICAqL1xuXG5cbiAgZnVuY3Rpb24gZW5hYmxlZChuYW1lKSB7XG4gICAgaWYgKG5hbWVbbmFtZS5sZW5ndGggLSAxXSA9PT0gJyonKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICB2YXIgaTtcbiAgICB2YXIgbGVuO1xuXG4gICAgZm9yIChpID0gMCwgbGVuID0gY3JlYXRlRGVidWcuc2tpcHMubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgIGlmIChjcmVhdGVEZWJ1Zy5za2lwc1tpXS50ZXN0KG5hbWUpKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGkgPSAwLCBsZW4gPSBjcmVhdGVEZWJ1Zy5uYW1lcy5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgICAgaWYgKGNyZWF0ZURlYnVnLm5hbWVzW2ldLnRlc3QobmFtZSkpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIC8qKlxuICAqIENvZXJjZSBgdmFsYC5cbiAgKlxuICAqIEBwYXJhbSB7TWl4ZWR9IHZhbFxuICAqIEByZXR1cm4ge01peGVkfVxuICAqIEBhcGkgcHJpdmF0ZVxuICAqL1xuXG5cbiAgZnVuY3Rpb24gY29lcmNlKHZhbCkge1xuICAgIGlmICh2YWwgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgcmV0dXJuIHZhbC5zdGFjayB8fCB2YWwubWVzc2FnZTtcbiAgICB9XG5cbiAgICByZXR1cm4gdmFsO1xuICB9XG5cbiAgY3JlYXRlRGVidWcuZW5hYmxlKGNyZWF0ZURlYnVnLmxvYWQoKSk7XG4gIHJldHVybiBjcmVhdGVEZWJ1Zztcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBzZXR1cDtcblxuIiwiLyoqXG4gKiBSZXByZXNlbnRzIGEgaGFuZGxlIHRvIGEgc2luZ2xlIEphbnVzIHBsdWdpbiBvbiBhIEphbnVzIHNlc3Npb24uIEVhY2ggV2ViUlRDIGNvbm5lY3Rpb24gdG8gdGhlIEphbnVzIHNlcnZlciB3aWxsIGJlXG4gKiBhc3NvY2lhdGVkIHdpdGggYSBzaW5nbGUgaGFuZGxlLiBPbmNlIGF0dGFjaGVkIHRvIHRoZSBzZXJ2ZXIsIHRoaXMgaGFuZGxlIHdpbGwgYmUgZ2l2ZW4gYSB1bmlxdWUgSUQgd2hpY2ggc2hvdWxkIGJlXG4gKiB1c2VkIHRvIGFzc29jaWF0ZSBpdCB3aXRoIGZ1dHVyZSBzaWduYWxsaW5nIG1lc3NhZ2VzLlxuICpcbiAqIFNlZSBodHRwczovL2phbnVzLmNvbmYubWVldGVjaG8uY29tL2RvY3MvcmVzdC5odG1sI2hhbmRsZXMuXG4gKiovXG5mdW5jdGlvbiBKYW51c1BsdWdpbkhhbmRsZShzZXNzaW9uKSB7XG4gIHRoaXMuc2Vzc2lvbiA9IHNlc3Npb247XG4gIHRoaXMuaWQgPSB1bmRlZmluZWQ7XG59XG5cbi8qKiBBdHRhY2hlcyB0aGlzIGhhbmRsZSB0byB0aGUgSmFudXMgc2VydmVyIGFuZCBzZXRzIGl0cyBJRC4gKiovXG5KYW51c1BsdWdpbkhhbmRsZS5wcm90b3R5cGUuYXR0YWNoID0gZnVuY3Rpb24ocGx1Z2luKSB7XG4gIHZhciBwYXlsb2FkID0geyBwbHVnaW46IHBsdWdpbiwgXCJmb3JjZS1idW5kbGVcIjogdHJ1ZSwgXCJmb3JjZS1ydGNwLW11eFwiOiB0cnVlIH07XG4gIHJldHVybiB0aGlzLnNlc3Npb24uc2VuZChcImF0dGFjaFwiLCBwYXlsb2FkKS50aGVuKHJlc3AgPT4ge1xuICAgIHRoaXMuaWQgPSByZXNwLmRhdGEuaWQ7XG4gICAgcmV0dXJuIHJlc3A7XG4gIH0pO1xufTtcblxuLyoqIERldGFjaGVzIHRoaXMgaGFuZGxlLiAqKi9cbkphbnVzUGx1Z2luSGFuZGxlLnByb3RvdHlwZS5kZXRhY2ggPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuc2VuZChcImRldGFjaFwiKTtcbn07XG5cbi8qKiBSZWdpc3RlcnMgYSBjYWxsYmFjayB0byBiZSBmaXJlZCB1cG9uIHRoZSByZWNlcHRpb24gb2YgYW55IGluY29taW5nIEphbnVzIHNpZ25hbHMgZm9yIHRoaXMgcGx1Z2luIGhhbmRsZSB3aXRoIHRoZVxuICogYGphbnVzYCBhdHRyaWJ1dGUgZXF1YWwgdG8gYGV2YC5cbiAqKi9cbkphbnVzUGx1Z2luSGFuZGxlLnByb3RvdHlwZS5vbiA9IGZ1bmN0aW9uKGV2LCBjYWxsYmFjaykge1xuICByZXR1cm4gdGhpcy5zZXNzaW9uLm9uKGV2LCBzaWduYWwgPT4ge1xuICAgIGlmIChzaWduYWwuc2VuZGVyID09IHRoaXMuaWQpIHtcbiAgICAgIGNhbGxiYWNrKHNpZ25hbCk7XG4gICAgfVxuICB9KTtcbn07XG5cbi8qKlxuICogU2VuZHMgYSBzaWduYWwgYXNzb2NpYXRlZCB3aXRoIHRoaXMgaGFuZGxlLiBTaWduYWxzIHNob3VsZCBiZSBKU09OLXNlcmlhbGl6YWJsZSBvYmplY3RzLiBSZXR1cm5zIGEgcHJvbWlzZSB0aGF0IHdpbGxcbiAqIGJlIHJlc29sdmVkIG9yIHJlamVjdGVkIHdoZW4gYSByZXNwb25zZSB0byB0aGlzIHNpZ25hbCBpcyByZWNlaXZlZCwgb3Igd2hlbiBubyByZXNwb25zZSBpcyByZWNlaXZlZCB3aXRoaW4gdGhlXG4gKiBzZXNzaW9uIHRpbWVvdXQuXG4gKiovXG5KYW51c1BsdWdpbkhhbmRsZS5wcm90b3R5cGUuc2VuZCA9IGZ1bmN0aW9uKHR5cGUsIHNpZ25hbCkge1xuICByZXR1cm4gdGhpcy5zZXNzaW9uLnNlbmQodHlwZSwgT2JqZWN0LmFzc2lnbih7IGhhbmRsZV9pZDogdGhpcy5pZCB9LCBzaWduYWwpKTtcbn07XG5cbi8qKiBTZW5kcyBhIHBsdWdpbi1zcGVjaWZpYyBtZXNzYWdlIGFzc29jaWF0ZWQgd2l0aCB0aGlzIGhhbmRsZS4gKiovXG5KYW51c1BsdWdpbkhhbmRsZS5wcm90b3R5cGUuc2VuZE1lc3NhZ2UgPSBmdW5jdGlvbihib2R5KSB7XG4gIHJldHVybiB0aGlzLnNlbmQoXCJtZXNzYWdlXCIsIHsgYm9keTogYm9keSB9KTtcbn07XG5cbi8qKiBTZW5kcyBhIEpTRVAgb2ZmZXIgb3IgYW5zd2VyIGFzc29jaWF0ZWQgd2l0aCB0aGlzIGhhbmRsZS4gKiovXG5KYW51c1BsdWdpbkhhbmRsZS5wcm90b3R5cGUuc2VuZEpzZXAgPSBmdW5jdGlvbihqc2VwKSB7XG4gIHJldHVybiB0aGlzLnNlbmQoXCJtZXNzYWdlXCIsIHsgYm9keToge30sIGpzZXA6IGpzZXAgfSk7XG59O1xuXG4vKiogU2VuZHMgYW4gSUNFIHRyaWNrbGUgY2FuZGlkYXRlIGFzc29jaWF0ZWQgd2l0aCB0aGlzIGhhbmRsZS4gKiovXG5KYW51c1BsdWdpbkhhbmRsZS5wcm90b3R5cGUuc2VuZFRyaWNrbGUgPSBmdW5jdGlvbihjYW5kaWRhdGUpIHtcbiAgcmV0dXJuIHRoaXMuc2VuZChcInRyaWNrbGVcIiwgeyBjYW5kaWRhdGU6IGNhbmRpZGF0ZSB9KTtcbn07XG5cbi8qKlxuICogUmVwcmVzZW50cyBhIEphbnVzIHNlc3Npb24gLS0gYSBKYW51cyBjb250ZXh0IGZyb20gd2l0aGluIHdoaWNoIHlvdSBjYW4gb3BlbiBtdWx0aXBsZSBoYW5kbGVzIGFuZCBjb25uZWN0aW9ucy4gT25jZVxuICogY3JlYXRlZCwgdGhpcyBzZXNzaW9uIHdpbGwgYmUgZ2l2ZW4gYSB1bmlxdWUgSUQgd2hpY2ggc2hvdWxkIGJlIHVzZWQgdG8gYXNzb2NpYXRlIGl0IHdpdGggZnV0dXJlIHNpZ25hbGxpbmcgbWVzc2FnZXMuXG4gKlxuICogU2VlIGh0dHBzOi8vamFudXMuY29uZi5tZWV0ZWNoby5jb20vZG9jcy9yZXN0Lmh0bWwjc2Vzc2lvbnMuXG4gKiovXG5mdW5jdGlvbiBKYW51c1Nlc3Npb24ob3V0cHV0LCBvcHRpb25zKSB7XG4gIHRoaXMub3V0cHV0ID0gb3V0cHV0O1xuICB0aGlzLmlkID0gdW5kZWZpbmVkO1xuICB0aGlzLm5leHRUeElkID0gMDtcbiAgdGhpcy50eG5zID0ge307XG4gIHRoaXMuZXZlbnRIYW5kbGVycyA9IHt9O1xuICB0aGlzLm9wdGlvbnMgPSBPYmplY3QuYXNzaWduKHtcbiAgICB2ZXJib3NlOiBmYWxzZSxcbiAgICB0aW1lb3V0TXM6IDEwMDAwLFxuICAgIGtlZXBhbGl2ZU1zOiAzMDAwMFxuICB9LCBvcHRpb25zKTtcbn1cblxuLyoqIENyZWF0ZXMgdGhpcyBzZXNzaW9uIG9uIHRoZSBKYW51cyBzZXJ2ZXIgYW5kIHNldHMgaXRzIElELiAqKi9cbkphbnVzU2Vzc2lvbi5wcm90b3R5cGUuY3JlYXRlID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLnNlbmQoXCJjcmVhdGVcIikudGhlbihyZXNwID0+IHtcbiAgICB0aGlzLmlkID0gcmVzcC5kYXRhLmlkO1xuICAgIHJldHVybiByZXNwO1xuICB9KTtcbn07XG5cbi8qKlxuICogRGVzdHJveXMgdGhpcyBzZXNzaW9uLiBOb3RlIHRoYXQgdXBvbiBkZXN0cnVjdGlvbiwgSmFudXMgd2lsbCBhbHNvIGNsb3NlIHRoZSBzaWduYWxsaW5nIHRyYW5zcG9ydCAoaWYgYXBwbGljYWJsZSkgYW5kXG4gKiBhbnkgb3BlbiBXZWJSVEMgY29ubmVjdGlvbnMuXG4gKiovXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLmRlc3Ryb3kgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuc2VuZChcImRlc3Ryb3lcIikudGhlbigocmVzcCkgPT4ge1xuICAgIHRoaXMuZGlzcG9zZSgpO1xuICAgIHJldHVybiByZXNwO1xuICB9KTtcbn07XG5cbi8qKlxuICogRGlzcG9zZXMgb2YgdGhpcyBzZXNzaW9uIGluIGEgd2F5IHN1Y2ggdGhhdCBubyBmdXJ0aGVyIGluY29taW5nIHNpZ25hbGxpbmcgbWVzc2FnZXMgd2lsbCBiZSBwcm9jZXNzZWQuXG4gKiBPdXRzdGFuZGluZyB0cmFuc2FjdGlvbnMgd2lsbCBiZSByZWplY3RlZC5cbiAqKi9cbkphbnVzU2Vzc2lvbi5wcm90b3R5cGUuZGlzcG9zZSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLl9raWxsS2VlcGFsaXZlKCk7XG4gIHRoaXMuZXZlbnRIYW5kbGVycyA9IHt9O1xuICBmb3IgKHZhciB0eElkIGluIHRoaXMudHhucykge1xuICAgIGlmICh0aGlzLnR4bnMuaGFzT3duUHJvcGVydHkodHhJZCkpIHtcbiAgICAgIHZhciB0eG4gPSB0aGlzLnR4bnNbdHhJZF07XG4gICAgICBjbGVhclRpbWVvdXQodHhuLnRpbWVvdXQpO1xuICAgICAgdHhuLnJlamVjdChuZXcgRXJyb3IoXCJKYW51cyBzZXNzaW9uIHdhcyBkaXNwb3NlZC5cIikpO1xuICAgICAgZGVsZXRlIHRoaXMudHhuc1t0eElkXTtcbiAgICB9XG4gIH1cbn07XG5cbi8qKlxuICogV2hldGhlciB0aGlzIHNpZ25hbCByZXByZXNlbnRzIGFuIGVycm9yLCBhbmQgdGhlIGFzc29jaWF0ZWQgcHJvbWlzZSAoaWYgYW55KSBzaG91bGQgYmUgcmVqZWN0ZWQuXG4gKiBVc2VycyBzaG91bGQgb3ZlcnJpZGUgdGhpcyB0byBoYW5kbGUgYW55IGN1c3RvbSBwbHVnaW4tc3BlY2lmaWMgZXJyb3IgY29udmVudGlvbnMuXG4gKiovXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLmlzRXJyb3IgPSBmdW5jdGlvbihzaWduYWwpIHtcbiAgcmV0dXJuIHNpZ25hbC5qYW51cyA9PT0gXCJlcnJvclwiO1xufTtcblxuLyoqIFJlZ2lzdGVycyBhIGNhbGxiYWNrIHRvIGJlIGZpcmVkIHVwb24gdGhlIHJlY2VwdGlvbiBvZiBhbnkgaW5jb21pbmcgSmFudXMgc2lnbmFscyBmb3IgdGhpcyBzZXNzaW9uIHdpdGggdGhlXG4gKiBgamFudXNgIGF0dHJpYnV0ZSBlcXVhbCB0byBgZXZgLlxuICoqL1xuSmFudXNTZXNzaW9uLnByb3RvdHlwZS5vbiA9IGZ1bmN0aW9uKGV2LCBjYWxsYmFjaykge1xuICB2YXIgaGFuZGxlcnMgPSB0aGlzLmV2ZW50SGFuZGxlcnNbZXZdO1xuICBpZiAoaGFuZGxlcnMgPT0gbnVsbCkge1xuICAgIGhhbmRsZXJzID0gdGhpcy5ldmVudEhhbmRsZXJzW2V2XSA9IFtdO1xuICB9XG4gIGhhbmRsZXJzLnB1c2goY2FsbGJhY2spO1xufTtcblxuLyoqXG4gKiBDYWxsYmFjayBmb3IgcmVjZWl2aW5nIEpTT04gc2lnbmFsbGluZyBtZXNzYWdlcyBwZXJ0aW5lbnQgdG8gdGhpcyBzZXNzaW9uLiBJZiB0aGUgc2lnbmFscyBhcmUgcmVzcG9uc2VzIHRvIHByZXZpb3VzbHlcbiAqIHNlbnQgc2lnbmFscywgdGhlIHByb21pc2VzIGZvciB0aGUgb3V0Z29pbmcgc2lnbmFscyB3aWxsIGJlIHJlc29sdmVkIG9yIHJlamVjdGVkIGFwcHJvcHJpYXRlbHkgd2l0aCB0aGlzIHNpZ25hbCBhcyBhblxuICogYXJndW1lbnQuXG4gKlxuICogRXh0ZXJuYWwgY2FsbGVycyBzaG91bGQgY2FsbCB0aGlzIGZ1bmN0aW9uIGV2ZXJ5IHRpbWUgYSBuZXcgc2lnbmFsIGFycml2ZXMgb24gdGhlIHRyYW5zcG9ydDsgZm9yIGV4YW1wbGUsIGluIGFcbiAqIFdlYlNvY2tldCdzIGBtZXNzYWdlYCBldmVudCwgb3Igd2hlbiBhIG5ldyBkYXR1bSBzaG93cyB1cCBpbiBhbiBIVFRQIGxvbmctcG9sbGluZyByZXNwb25zZS5cbiAqKi9cbkphbnVzU2Vzc2lvbi5wcm90b3R5cGUucmVjZWl2ZSA9IGZ1bmN0aW9uKHNpZ25hbCkge1xuICBpZiAodGhpcy5vcHRpb25zLnZlcmJvc2UpIHtcbiAgICB0aGlzLl9sb2dJbmNvbWluZyhzaWduYWwpO1xuICB9XG4gIGlmIChzaWduYWwuc2Vzc2lvbl9pZCAhPSB0aGlzLmlkKSB7XG4gICAgY29uc29sZS53YXJuKFwiSW5jb3JyZWN0IHNlc3Npb24gSUQgcmVjZWl2ZWQgaW4gSmFudXMgc2lnbmFsbGluZyBtZXNzYWdlOiB3YXMgXCIgKyBzaWduYWwuc2Vzc2lvbl9pZCArIFwiLCBleHBlY3RlZCBcIiArIHRoaXMuaWQgKyBcIi5cIik7XG4gIH1cblxuICB2YXIgcmVzcG9uc2VUeXBlID0gc2lnbmFsLmphbnVzO1xuICB2YXIgaGFuZGxlcnMgPSB0aGlzLmV2ZW50SGFuZGxlcnNbcmVzcG9uc2VUeXBlXTtcbiAgaWYgKGhhbmRsZXJzICE9IG51bGwpIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGhhbmRsZXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBoYW5kbGVyc1tpXShzaWduYWwpO1xuICAgIH1cbiAgfVxuXG4gIGlmIChzaWduYWwudHJhbnNhY3Rpb24gIT0gbnVsbCkge1xuICAgIHZhciB0eG4gPSB0aGlzLnR4bnNbc2lnbmFsLnRyYW5zYWN0aW9uXTtcbiAgICBpZiAodHhuID09IG51bGwpIHtcbiAgICAgIC8vIHRoaXMgaXMgYSByZXNwb25zZSB0byBhIHRyYW5zYWN0aW9uIHRoYXQgd2Fzbid0IGNhdXNlZCB2aWEgSmFudXNTZXNzaW9uLnNlbmQsIG9yIGEgcGx1Z2luIHJlcGxpZWQgdHdpY2UgdG8gYVxuICAgICAgLy8gc2luZ2xlIHJlcXVlc3QsIG9yIHRoZSBzZXNzaW9uIHdhcyBkaXNwb3NlZCwgb3Igc29tZXRoaW5nIGVsc2UgdGhhdCBpc24ndCB1bmRlciBvdXIgcHVydmlldzsgdGhhdCdzIGZpbmVcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAocmVzcG9uc2VUeXBlID09PSBcImFja1wiICYmIHR4bi50eXBlID09IFwibWVzc2FnZVwiKSB7XG4gICAgICAvLyB0aGlzIGlzIGFuIGFjayBvZiBhbiBhc3luY2hyb25vdXNseS1wcm9jZXNzZWQgcGx1Z2luIHJlcXVlc3QsIHdlIHNob3VsZCB3YWl0IHRvIHJlc29sdmUgdGhlIHByb21pc2UgdW50aWwgdGhlXG4gICAgICAvLyBhY3R1YWwgcmVzcG9uc2UgY29tZXMgaW5cbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjbGVhclRpbWVvdXQodHhuLnRpbWVvdXQpO1xuXG4gICAgZGVsZXRlIHRoaXMudHhuc1tzaWduYWwudHJhbnNhY3Rpb25dO1xuICAgICh0aGlzLmlzRXJyb3Ioc2lnbmFsKSA/IHR4bi5yZWplY3QgOiB0eG4ucmVzb2x2ZSkoc2lnbmFsKTtcbiAgfVxufTtcblxuLyoqXG4gKiBTZW5kcyBhIHNpZ25hbCBhc3NvY2lhdGVkIHdpdGggdGhpcyBzZXNzaW9uLCBiZWdpbm5pbmcgYSBuZXcgdHJhbnNhY3Rpb24uIFJldHVybnMgYSBwcm9taXNlIHRoYXQgd2lsbCBiZSByZXNvbHZlZCBvclxuICogcmVqZWN0ZWQgd2hlbiBhIHJlc3BvbnNlIGlzIHJlY2VpdmVkIGluIHRoZSBzYW1lIHRyYW5zYWN0aW9uLCBvciB3aGVuIG5vIHJlc3BvbnNlIGlzIHJlY2VpdmVkIHdpdGhpbiB0aGUgc2Vzc2lvblxuICogdGltZW91dC5cbiAqKi9cbkphbnVzU2Vzc2lvbi5wcm90b3R5cGUuc2VuZCA9IGZ1bmN0aW9uKHR5cGUsIHNpZ25hbCkge1xuICBzaWduYWwgPSBPYmplY3QuYXNzaWduKHsgdHJhbnNhY3Rpb246ICh0aGlzLm5leHRUeElkKyspLnRvU3RyaW5nKCkgfSwgc2lnbmFsKTtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICB2YXIgdGltZW91dCA9IG51bGw7XG4gICAgaWYgKHRoaXMub3B0aW9ucy50aW1lb3V0TXMpIHtcbiAgICAgIHRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgZGVsZXRlIHRoaXMudHhuc1tzaWduYWwudHJhbnNhY3Rpb25dO1xuICAgICAgICByZWplY3QobmV3IEVycm9yKFwiU2lnbmFsbGluZyB0cmFuc2FjdGlvbiB3aXRoIHR4aWQgXCIgKyBzaWduYWwudHJhbnNhY3Rpb24gKyBcIiB0aW1lZCBvdXQuXCIpKTtcbiAgICAgIH0sIHRoaXMub3B0aW9ucy50aW1lb3V0TXMpO1xuICAgIH1cbiAgICB0aGlzLnR4bnNbc2lnbmFsLnRyYW5zYWN0aW9uXSA9IHsgcmVzb2x2ZTogcmVzb2x2ZSwgcmVqZWN0OiByZWplY3QsIHRpbWVvdXQ6IHRpbWVvdXQsIHR5cGU6IHR5cGUgfTtcbiAgICB0aGlzLl90cmFuc21pdCh0eXBlLCBzaWduYWwpO1xuICB9KTtcbn07XG5cbkphbnVzU2Vzc2lvbi5wcm90b3R5cGUuX3RyYW5zbWl0ID0gZnVuY3Rpb24odHlwZSwgc2lnbmFsKSB7XG4gIHNpZ25hbCA9IE9iamVjdC5hc3NpZ24oeyBqYW51czogdHlwZSB9LCBzaWduYWwpO1xuXG4gIGlmICh0aGlzLmlkICE9IG51bGwpIHsgLy8gdGhpcy5pZCBpcyB1bmRlZmluZWQgaW4gdGhlIHNwZWNpYWwgY2FzZSB3aGVuIHdlJ3JlIHNlbmRpbmcgdGhlIHNlc3Npb24gY3JlYXRlIG1lc3NhZ2VcbiAgICBzaWduYWwgPSBPYmplY3QuYXNzaWduKHsgc2Vzc2lvbl9pZDogdGhpcy5pZCB9LCBzaWduYWwpO1xuICB9XG5cbiAgaWYgKHRoaXMub3B0aW9ucy52ZXJib3NlKSB7XG4gICAgdGhpcy5fbG9nT3V0Z29pbmcoc2lnbmFsKTtcbiAgfVxuXG4gIHRoaXMub3V0cHV0KEpTT04uc3RyaW5naWZ5KHNpZ25hbCkpO1xuICB0aGlzLl9yZXNldEtlZXBhbGl2ZSgpO1xufTtcblxuSmFudXNTZXNzaW9uLnByb3RvdHlwZS5fbG9nT3V0Z29pbmcgPSBmdW5jdGlvbihzaWduYWwpIHtcbiAgdmFyIGtpbmQgPSBzaWduYWwuamFudXM7XG4gIGlmIChraW5kID09PSBcIm1lc3NhZ2VcIiAmJiBzaWduYWwuanNlcCkge1xuICAgIGtpbmQgPSBzaWduYWwuanNlcC50eXBlO1xuICB9XG4gIHZhciBtZXNzYWdlID0gXCI+IE91dGdvaW5nIEphbnVzIFwiICsgKGtpbmQgfHwgXCJzaWduYWxcIikgKyBcIiAoI1wiICsgc2lnbmFsLnRyYW5zYWN0aW9uICsgXCIpOiBcIjtcbiAgY29uc29sZS5kZWJ1ZyhcIiVjXCIgKyBtZXNzYWdlLCBcImNvbG9yOiAjMDQwXCIsIHNpZ25hbCk7XG59O1xuXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLl9sb2dJbmNvbWluZyA9IGZ1bmN0aW9uKHNpZ25hbCkge1xuICB2YXIga2luZCA9IHNpZ25hbC5qYW51cztcbiAgdmFyIG1lc3NhZ2UgPSBzaWduYWwudHJhbnNhY3Rpb24gP1xuICAgICAgXCI8IEluY29taW5nIEphbnVzIFwiICsgKGtpbmQgfHwgXCJzaWduYWxcIikgKyBcIiAoI1wiICsgc2lnbmFsLnRyYW5zYWN0aW9uICsgXCIpOiBcIiA6XG4gICAgICBcIjwgSW5jb21pbmcgSmFudXMgXCIgKyAoa2luZCB8fCBcInNpZ25hbFwiKSArIFwiOiBcIjtcbiAgY29uc29sZS5kZWJ1ZyhcIiVjXCIgKyBtZXNzYWdlLCBcImNvbG9yOiAjMDA0XCIsIHNpZ25hbCk7XG59O1xuXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLl9zZW5kS2VlcGFsaXZlID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLnNlbmQoXCJrZWVwYWxpdmVcIik7XG59O1xuXG5KYW51c1Nlc3Npb24ucHJvdG90eXBlLl9raWxsS2VlcGFsaXZlID0gZnVuY3Rpb24oKSB7XG4gIGNsZWFyVGltZW91dCh0aGlzLmtlZXBhbGl2ZVRpbWVvdXQpO1xufTtcblxuSmFudXNTZXNzaW9uLnByb3RvdHlwZS5fcmVzZXRLZWVwYWxpdmUgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5fa2lsbEtlZXBhbGl2ZSgpO1xuICBpZiAodGhpcy5vcHRpb25zLmtlZXBhbGl2ZU1zKSB7XG4gICAgdGhpcy5rZWVwYWxpdmVUaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0aGlzLl9zZW5kS2VlcGFsaXZlKCkuY2F0Y2goZSA9PiBjb25zb2xlLmVycm9yKFwiRXJyb3IgcmVjZWl2ZWQgZnJvbSBrZWVwYWxpdmU6IFwiLCBlKSk7XG4gICAgfSwgdGhpcy5vcHRpb25zLmtlZXBhbGl2ZU1zKTtcbiAgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIEphbnVzUGx1Z2luSGFuZGxlLFxuICBKYW51c1Nlc3Npb25cbn07XG4iLCIvKipcbiAqIEhlbHBlcnMuXG4gKi9cblxudmFyIHMgPSAxMDAwO1xudmFyIG0gPSBzICogNjA7XG52YXIgaCA9IG0gKiA2MDtcbnZhciBkID0gaCAqIDI0O1xudmFyIHcgPSBkICogNztcbnZhciB5ID0gZCAqIDM2NS4yNTtcblxuLyoqXG4gKiBQYXJzZSBvciBmb3JtYXQgdGhlIGdpdmVuIGB2YWxgLlxuICpcbiAqIE9wdGlvbnM6XG4gKlxuICogIC0gYGxvbmdgIHZlcmJvc2UgZm9ybWF0dGluZyBbZmFsc2VdXG4gKlxuICogQHBhcmFtIHtTdHJpbmd8TnVtYmVyfSB2YWxcbiAqIEBwYXJhbSB7T2JqZWN0fSBbb3B0aW9uc11cbiAqIEB0aHJvd3Mge0Vycm9yfSB0aHJvdyBhbiBlcnJvciBpZiB2YWwgaXMgbm90IGEgbm9uLWVtcHR5IHN0cmluZyBvciBhIG51bWJlclxuICogQHJldHVybiB7U3RyaW5nfE51bWJlcn1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAodmFsLCBvcHRpb25zKSB7XG4gIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xuICB2YXIgdHlwZSA9IHR5cGVvZiB2YWw7XG4gIGlmICh0eXBlID09PSAnc3RyaW5nJyAmJiB2YWwubGVuZ3RoID4gMCkge1xuICAgIHJldHVybiBwYXJzZSh2YWwpO1xuICB9IGVsc2UgaWYgKHR5cGUgPT09ICdudW1iZXInICYmIGlzRmluaXRlKHZhbCkpIHtcbiAgICByZXR1cm4gb3B0aW9ucy5sb25nID8gZm10TG9uZyh2YWwpIDogZm10U2hvcnQodmFsKTtcbiAgfVxuICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgJ3ZhbCBpcyBub3QgYSBub24tZW1wdHkgc3RyaW5nIG9yIGEgdmFsaWQgbnVtYmVyLiB2YWw9JyArXG4gICAgICBKU09OLnN0cmluZ2lmeSh2YWwpXG4gICk7XG59O1xuXG4vKipcbiAqIFBhcnNlIHRoZSBnaXZlbiBgc3RyYCBhbmQgcmV0dXJuIG1pbGxpc2Vjb25kcy5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gc3RyXG4gKiBAcmV0dXJuIHtOdW1iZXJ9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBwYXJzZShzdHIpIHtcbiAgc3RyID0gU3RyaW5nKHN0cik7XG4gIGlmIChzdHIubGVuZ3RoID4gMTAwKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIHZhciBtYXRjaCA9IC9eKC0/KD86XFxkKyk/XFwuP1xcZCspICoobWlsbGlzZWNvbmRzP3xtc2Vjcz98bXN8c2Vjb25kcz98c2Vjcz98c3xtaW51dGVzP3xtaW5zP3xtfGhvdXJzP3xocnM/fGh8ZGF5cz98ZHx3ZWVrcz98d3x5ZWFycz98eXJzP3x5KT8kL2kuZXhlYyhcbiAgICBzdHJcbiAgKTtcbiAgaWYgKCFtYXRjaCkge1xuICAgIHJldHVybjtcbiAgfVxuICB2YXIgbiA9IHBhcnNlRmxvYXQobWF0Y2hbMV0pO1xuICB2YXIgdHlwZSA9IChtYXRjaFsyXSB8fCAnbXMnKS50b0xvd2VyQ2FzZSgpO1xuICBzd2l0Y2ggKHR5cGUpIHtcbiAgICBjYXNlICd5ZWFycyc6XG4gICAgY2FzZSAneWVhcic6XG4gICAgY2FzZSAneXJzJzpcbiAgICBjYXNlICd5cic6XG4gICAgY2FzZSAneSc6XG4gICAgICByZXR1cm4gbiAqIHk7XG4gICAgY2FzZSAnd2Vla3MnOlxuICAgIGNhc2UgJ3dlZWsnOlxuICAgIGNhc2UgJ3cnOlxuICAgICAgcmV0dXJuIG4gKiB3O1xuICAgIGNhc2UgJ2RheXMnOlxuICAgIGNhc2UgJ2RheSc6XG4gICAgY2FzZSAnZCc6XG4gICAgICByZXR1cm4gbiAqIGQ7XG4gICAgY2FzZSAnaG91cnMnOlxuICAgIGNhc2UgJ2hvdXInOlxuICAgIGNhc2UgJ2hycyc6XG4gICAgY2FzZSAnaHInOlxuICAgIGNhc2UgJ2gnOlxuICAgICAgcmV0dXJuIG4gKiBoO1xuICAgIGNhc2UgJ21pbnV0ZXMnOlxuICAgIGNhc2UgJ21pbnV0ZSc6XG4gICAgY2FzZSAnbWlucyc6XG4gICAgY2FzZSAnbWluJzpcbiAgICBjYXNlICdtJzpcbiAgICAgIHJldHVybiBuICogbTtcbiAgICBjYXNlICdzZWNvbmRzJzpcbiAgICBjYXNlICdzZWNvbmQnOlxuICAgIGNhc2UgJ3NlY3MnOlxuICAgIGNhc2UgJ3NlYyc6XG4gICAgY2FzZSAncyc6XG4gICAgICByZXR1cm4gbiAqIHM7XG4gICAgY2FzZSAnbWlsbGlzZWNvbmRzJzpcbiAgICBjYXNlICdtaWxsaXNlY29uZCc6XG4gICAgY2FzZSAnbXNlY3MnOlxuICAgIGNhc2UgJ21zZWMnOlxuICAgIGNhc2UgJ21zJzpcbiAgICAgIHJldHVybiBuO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG59XG5cbi8qKlxuICogU2hvcnQgZm9ybWF0IGZvciBgbXNgLlxuICpcbiAqIEBwYXJhbSB7TnVtYmVyfSBtc1xuICogQHJldHVybiB7U3RyaW5nfVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gZm10U2hvcnQobXMpIHtcbiAgdmFyIG1zQWJzID0gTWF0aC5hYnMobXMpO1xuICBpZiAobXNBYnMgPj0gZCkge1xuICAgIHJldHVybiBNYXRoLnJvdW5kKG1zIC8gZCkgKyAnZCc7XG4gIH1cbiAgaWYgKG1zQWJzID49IGgpIHtcbiAgICByZXR1cm4gTWF0aC5yb3VuZChtcyAvIGgpICsgJ2gnO1xuICB9XG4gIGlmIChtc0FicyA+PSBtKSB7XG4gICAgcmV0dXJuIE1hdGgucm91bmQobXMgLyBtKSArICdtJztcbiAgfVxuICBpZiAobXNBYnMgPj0gcykge1xuICAgIHJldHVybiBNYXRoLnJvdW5kKG1zIC8gcykgKyAncyc7XG4gIH1cbiAgcmV0dXJuIG1zICsgJ21zJztcbn1cblxuLyoqXG4gKiBMb25nIGZvcm1hdCBmb3IgYG1zYC5cbiAqXG4gKiBAcGFyYW0ge051bWJlcn0gbXNcbiAqIEByZXR1cm4ge1N0cmluZ31cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIGZtdExvbmcobXMpIHtcbiAgdmFyIG1zQWJzID0gTWF0aC5hYnMobXMpO1xuICBpZiAobXNBYnMgPj0gZCkge1xuICAgIHJldHVybiBwbHVyYWwobXMsIG1zQWJzLCBkLCAnZGF5Jyk7XG4gIH1cbiAgaWYgKG1zQWJzID49IGgpIHtcbiAgICByZXR1cm4gcGx1cmFsKG1zLCBtc0FicywgaCwgJ2hvdXInKTtcbiAgfVxuICBpZiAobXNBYnMgPj0gbSkge1xuICAgIHJldHVybiBwbHVyYWwobXMsIG1zQWJzLCBtLCAnbWludXRlJyk7XG4gIH1cbiAgaWYgKG1zQWJzID49IHMpIHtcbiAgICByZXR1cm4gcGx1cmFsKG1zLCBtc0FicywgcywgJ3NlY29uZCcpO1xuICB9XG4gIHJldHVybiBtcyArICcgbXMnO1xufVxuXG4vKipcbiAqIFBsdXJhbGl6YXRpb24gaGVscGVyLlxuICovXG5cbmZ1bmN0aW9uIHBsdXJhbChtcywgbXNBYnMsIG4sIG5hbWUpIHtcbiAgdmFyIGlzUGx1cmFsID0gbXNBYnMgPj0gbiAqIDEuNTtcbiAgcmV0dXJuIE1hdGgucm91bmQobXMgLyBuKSArICcgJyArIG5hbWUgKyAoaXNQbHVyYWwgPyAncycgOiAnJyk7XG59XG4iLCIvLyBzaGltIGZvciB1c2luZyBwcm9jZXNzIGluIGJyb3dzZXJcbnZhciBwcm9jZXNzID0gbW9kdWxlLmV4cG9ydHMgPSB7fTtcblxuLy8gY2FjaGVkIGZyb20gd2hhdGV2ZXIgZ2xvYmFsIGlzIHByZXNlbnQgc28gdGhhdCB0ZXN0IHJ1bm5lcnMgdGhhdCBzdHViIGl0XG4vLyBkb24ndCBicmVhayB0aGluZ3MuICBCdXQgd2UgbmVlZCB0byB3cmFwIGl0IGluIGEgdHJ5IGNhdGNoIGluIGNhc2UgaXQgaXNcbi8vIHdyYXBwZWQgaW4gc3RyaWN0IG1vZGUgY29kZSB3aGljaCBkb2Vzbid0IGRlZmluZSBhbnkgZ2xvYmFscy4gIEl0J3MgaW5zaWRlIGFcbi8vIGZ1bmN0aW9uIGJlY2F1c2UgdHJ5L2NhdGNoZXMgZGVvcHRpbWl6ZSBpbiBjZXJ0YWluIGVuZ2luZXMuXG5cbnZhciBjYWNoZWRTZXRUaW1lb3V0O1xudmFyIGNhY2hlZENsZWFyVGltZW91dDtcblxuZnVuY3Rpb24gZGVmYXVsdFNldFRpbW91dCgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3NldFRpbWVvdXQgaGFzIG5vdCBiZWVuIGRlZmluZWQnKTtcbn1cbmZ1bmN0aW9uIGRlZmF1bHRDbGVhclRpbWVvdXQgKCkge1xuICAgIHRocm93IG5ldyBFcnJvcignY2xlYXJUaW1lb3V0IGhhcyBub3QgYmVlbiBkZWZpbmVkJyk7XG59XG4oZnVuY3Rpb24gKCkge1xuICAgIHRyeSB7XG4gICAgICAgIGlmICh0eXBlb2Ygc2V0VGltZW91dCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgY2FjaGVkU2V0VGltZW91dCA9IHNldFRpbWVvdXQ7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjYWNoZWRTZXRUaW1lb3V0ID0gZGVmYXVsdFNldFRpbW91dDtcbiAgICAgICAgfVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY2FjaGVkU2V0VGltZW91dCA9IGRlZmF1bHRTZXRUaW1vdXQ7XG4gICAgfVxuICAgIHRyeSB7XG4gICAgICAgIGlmICh0eXBlb2YgY2xlYXJUaW1lb3V0ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICBjYWNoZWRDbGVhclRpbWVvdXQgPSBjbGVhclRpbWVvdXQ7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjYWNoZWRDbGVhclRpbWVvdXQgPSBkZWZhdWx0Q2xlYXJUaW1lb3V0O1xuICAgICAgICB9XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjYWNoZWRDbGVhclRpbWVvdXQgPSBkZWZhdWx0Q2xlYXJUaW1lb3V0O1xuICAgIH1cbn0gKCkpXG5mdW5jdGlvbiBydW5UaW1lb3V0KGZ1bikge1xuICAgIGlmIChjYWNoZWRTZXRUaW1lb3V0ID09PSBzZXRUaW1lb3V0KSB7XG4gICAgICAgIC8vbm9ybWFsIGVudmlyb21lbnRzIGluIHNhbmUgc2l0dWF0aW9uc1xuICAgICAgICByZXR1cm4gc2V0VGltZW91dChmdW4sIDApO1xuICAgIH1cbiAgICAvLyBpZiBzZXRUaW1lb3V0IHdhc24ndCBhdmFpbGFibGUgYnV0IHdhcyBsYXR0ZXIgZGVmaW5lZFxuICAgIGlmICgoY2FjaGVkU2V0VGltZW91dCA9PT0gZGVmYXVsdFNldFRpbW91dCB8fCAhY2FjaGVkU2V0VGltZW91dCkgJiYgc2V0VGltZW91dCkge1xuICAgICAgICBjYWNoZWRTZXRUaW1lb3V0ID0gc2V0VGltZW91dDtcbiAgICAgICAgcmV0dXJuIHNldFRpbWVvdXQoZnVuLCAwKTtcbiAgICB9XG4gICAgdHJ5IHtcbiAgICAgICAgLy8gd2hlbiB3aGVuIHNvbWVib2R5IGhhcyBzY3Jld2VkIHdpdGggc2V0VGltZW91dCBidXQgbm8gSS5FLiBtYWRkbmVzc1xuICAgICAgICByZXR1cm4gY2FjaGVkU2V0VGltZW91dChmdW4sIDApO1xuICAgIH0gY2F0Y2goZSl7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICAvLyBXaGVuIHdlIGFyZSBpbiBJLkUuIGJ1dCB0aGUgc2NyaXB0IGhhcyBiZWVuIGV2YWxlZCBzbyBJLkUuIGRvZXNuJ3QgdHJ1c3QgdGhlIGdsb2JhbCBvYmplY3Qgd2hlbiBjYWxsZWQgbm9ybWFsbHlcbiAgICAgICAgICAgIHJldHVybiBjYWNoZWRTZXRUaW1lb3V0LmNhbGwobnVsbCwgZnVuLCAwKTtcbiAgICAgICAgfSBjYXRjaChlKXtcbiAgICAgICAgICAgIC8vIHNhbWUgYXMgYWJvdmUgYnV0IHdoZW4gaXQncyBhIHZlcnNpb24gb2YgSS5FLiB0aGF0IG11c3QgaGF2ZSB0aGUgZ2xvYmFsIG9iamVjdCBmb3IgJ3RoaXMnLCBob3BmdWxseSBvdXIgY29udGV4dCBjb3JyZWN0IG90aGVyd2lzZSBpdCB3aWxsIHRocm93IGEgZ2xvYmFsIGVycm9yXG4gICAgICAgICAgICByZXR1cm4gY2FjaGVkU2V0VGltZW91dC5jYWxsKHRoaXMsIGZ1biwgMCk7XG4gICAgICAgIH1cbiAgICB9XG5cblxufVxuZnVuY3Rpb24gcnVuQ2xlYXJUaW1lb3V0KG1hcmtlcikge1xuICAgIGlmIChjYWNoZWRDbGVhclRpbWVvdXQgPT09IGNsZWFyVGltZW91dCkge1xuICAgICAgICAvL25vcm1hbCBlbnZpcm9tZW50cyBpbiBzYW5lIHNpdHVhdGlvbnNcbiAgICAgICAgcmV0dXJuIGNsZWFyVGltZW91dChtYXJrZXIpO1xuICAgIH1cbiAgICAvLyBpZiBjbGVhclRpbWVvdXQgd2Fzbid0IGF2YWlsYWJsZSBidXQgd2FzIGxhdHRlciBkZWZpbmVkXG4gICAgaWYgKChjYWNoZWRDbGVhclRpbWVvdXQgPT09IGRlZmF1bHRDbGVhclRpbWVvdXQgfHwgIWNhY2hlZENsZWFyVGltZW91dCkgJiYgY2xlYXJUaW1lb3V0KSB7XG4gICAgICAgIGNhY2hlZENsZWFyVGltZW91dCA9IGNsZWFyVGltZW91dDtcbiAgICAgICAgcmV0dXJuIGNsZWFyVGltZW91dChtYXJrZXIpO1xuICAgIH1cbiAgICB0cnkge1xuICAgICAgICAvLyB3aGVuIHdoZW4gc29tZWJvZHkgaGFzIHNjcmV3ZWQgd2l0aCBzZXRUaW1lb3V0IGJ1dCBubyBJLkUuIG1hZGRuZXNzXG4gICAgICAgIHJldHVybiBjYWNoZWRDbGVhclRpbWVvdXQobWFya2VyKTtcbiAgICB9IGNhdGNoIChlKXtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIC8vIFdoZW4gd2UgYXJlIGluIEkuRS4gYnV0IHRoZSBzY3JpcHQgaGFzIGJlZW4gZXZhbGVkIHNvIEkuRS4gZG9lc24ndCAgdHJ1c3QgdGhlIGdsb2JhbCBvYmplY3Qgd2hlbiBjYWxsZWQgbm9ybWFsbHlcbiAgICAgICAgICAgIHJldHVybiBjYWNoZWRDbGVhclRpbWVvdXQuY2FsbChudWxsLCBtYXJrZXIpO1xuICAgICAgICB9IGNhdGNoIChlKXtcbiAgICAgICAgICAgIC8vIHNhbWUgYXMgYWJvdmUgYnV0IHdoZW4gaXQncyBhIHZlcnNpb24gb2YgSS5FLiB0aGF0IG11c3QgaGF2ZSB0aGUgZ2xvYmFsIG9iamVjdCBmb3IgJ3RoaXMnLCBob3BmdWxseSBvdXIgY29udGV4dCBjb3JyZWN0IG90aGVyd2lzZSBpdCB3aWxsIHRocm93IGEgZ2xvYmFsIGVycm9yLlxuICAgICAgICAgICAgLy8gU29tZSB2ZXJzaW9ucyBvZiBJLkUuIGhhdmUgZGlmZmVyZW50IHJ1bGVzIGZvciBjbGVhclRpbWVvdXQgdnMgc2V0VGltZW91dFxuICAgICAgICAgICAgcmV0dXJuIGNhY2hlZENsZWFyVGltZW91dC5jYWxsKHRoaXMsIG1hcmtlcik7XG4gICAgICAgIH1cbiAgICB9XG5cblxuXG59XG52YXIgcXVldWUgPSBbXTtcbnZhciBkcmFpbmluZyA9IGZhbHNlO1xudmFyIGN1cnJlbnRRdWV1ZTtcbnZhciBxdWV1ZUluZGV4ID0gLTE7XG5cbmZ1bmN0aW9uIGNsZWFuVXBOZXh0VGljaygpIHtcbiAgICBpZiAoIWRyYWluaW5nIHx8ICFjdXJyZW50UXVldWUpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBkcmFpbmluZyA9IGZhbHNlO1xuICAgIGlmIChjdXJyZW50UXVldWUubGVuZ3RoKSB7XG4gICAgICAgIHF1ZXVlID0gY3VycmVudFF1ZXVlLmNvbmNhdChxdWV1ZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgcXVldWVJbmRleCA9IC0xO1xuICAgIH1cbiAgICBpZiAocXVldWUubGVuZ3RoKSB7XG4gICAgICAgIGRyYWluUXVldWUoKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGRyYWluUXVldWUoKSB7XG4gICAgaWYgKGRyYWluaW5nKSB7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdmFyIHRpbWVvdXQgPSBydW5UaW1lb3V0KGNsZWFuVXBOZXh0VGljayk7XG4gICAgZHJhaW5pbmcgPSB0cnVlO1xuXG4gICAgdmFyIGxlbiA9IHF1ZXVlLmxlbmd0aDtcbiAgICB3aGlsZShsZW4pIHtcbiAgICAgICAgY3VycmVudFF1ZXVlID0gcXVldWU7XG4gICAgICAgIHF1ZXVlID0gW107XG4gICAgICAgIHdoaWxlICgrK3F1ZXVlSW5kZXggPCBsZW4pIHtcbiAgICAgICAgICAgIGlmIChjdXJyZW50UXVldWUpIHtcbiAgICAgICAgICAgICAgICBjdXJyZW50UXVldWVbcXVldWVJbmRleF0ucnVuKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcXVldWVJbmRleCA9IC0xO1xuICAgICAgICBsZW4gPSBxdWV1ZS5sZW5ndGg7XG4gICAgfVxuICAgIGN1cnJlbnRRdWV1ZSA9IG51bGw7XG4gICAgZHJhaW5pbmcgPSBmYWxzZTtcbiAgICBydW5DbGVhclRpbWVvdXQodGltZW91dCk7XG59XG5cbnByb2Nlc3MubmV4dFRpY2sgPSBmdW5jdGlvbiAoZnVuKSB7XG4gICAgdmFyIGFyZ3MgPSBuZXcgQXJyYXkoYXJndW1lbnRzLmxlbmd0aCAtIDEpO1xuICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID4gMSkge1xuICAgICAgICBmb3IgKHZhciBpID0gMTsgaSA8IGFyZ3VtZW50cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgYXJnc1tpIC0gMV0gPSBhcmd1bWVudHNbaV07XG4gICAgICAgIH1cbiAgICB9XG4gICAgcXVldWUucHVzaChuZXcgSXRlbShmdW4sIGFyZ3MpKTtcbiAgICBpZiAocXVldWUubGVuZ3RoID09PSAxICYmICFkcmFpbmluZykge1xuICAgICAgICBydW5UaW1lb3V0KGRyYWluUXVldWUpO1xuICAgIH1cbn07XG5cbi8vIHY4IGxpa2VzIHByZWRpY3RpYmxlIG9iamVjdHNcbmZ1bmN0aW9uIEl0ZW0oZnVuLCBhcnJheSkge1xuICAgIHRoaXMuZnVuID0gZnVuO1xuICAgIHRoaXMuYXJyYXkgPSBhcnJheTtcbn1cbkl0ZW0ucHJvdG90eXBlLnJ1biA9IGZ1bmN0aW9uICgpIHtcbiAgICB0aGlzLmZ1bi5hcHBseShudWxsLCB0aGlzLmFycmF5KTtcbn07XG5wcm9jZXNzLnRpdGxlID0gJ2Jyb3dzZXInO1xucHJvY2Vzcy5icm93c2VyID0gdHJ1ZTtcbnByb2Nlc3MuZW52ID0ge307XG5wcm9jZXNzLmFyZ3YgPSBbXTtcbnByb2Nlc3MudmVyc2lvbiA9ICcnOyAvLyBlbXB0eSBzdHJpbmcgdG8gYXZvaWQgcmVnZXhwIGlzc3Vlc1xucHJvY2Vzcy52ZXJzaW9ucyA9IHt9O1xuXG5mdW5jdGlvbiBub29wKCkge31cblxucHJvY2Vzcy5vbiA9IG5vb3A7XG5wcm9jZXNzLmFkZExpc3RlbmVyID0gbm9vcDtcbnByb2Nlc3Mub25jZSA9IG5vb3A7XG5wcm9jZXNzLm9mZiA9IG5vb3A7XG5wcm9jZXNzLnJlbW92ZUxpc3RlbmVyID0gbm9vcDtcbnByb2Nlc3MucmVtb3ZlQWxsTGlzdGVuZXJzID0gbm9vcDtcbnByb2Nlc3MuZW1pdCA9IG5vb3A7XG5wcm9jZXNzLnByZXBlbmRMaXN0ZW5lciA9IG5vb3A7XG5wcm9jZXNzLnByZXBlbmRPbmNlTGlzdGVuZXIgPSBub29wO1xuXG5wcm9jZXNzLmxpc3RlbmVycyA9IGZ1bmN0aW9uIChuYW1lKSB7IHJldHVybiBbXSB9XG5cbnByb2Nlc3MuYmluZGluZyA9IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwcm9jZXNzLmJpbmRpbmcgaXMgbm90IHN1cHBvcnRlZCcpO1xufTtcblxucHJvY2Vzcy5jd2QgPSBmdW5jdGlvbiAoKSB7IHJldHVybiAnLycgfTtcbnByb2Nlc3MuY2hkaXIgPSBmdW5jdGlvbiAoZGlyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwcm9jZXNzLmNoZGlyIGlzIG5vdCBzdXBwb3J0ZWQnKTtcbn07XG5wcm9jZXNzLnVtYXNrID0gZnVuY3Rpb24oKSB7IHJldHVybiAwOyB9O1xuIiwiLyogZXNsaW50LWVudiBub2RlICovXG4ndXNlIHN0cmljdCc7XG5cbi8vIFNEUCBoZWxwZXJzLlxuY29uc3QgU0RQVXRpbHMgPSB7fTtcblxuLy8gR2VuZXJhdGUgYW4gYWxwaGFudW1lcmljIGlkZW50aWZpZXIgZm9yIGNuYW1lIG9yIG1pZHMuXG4vLyBUT0RPOiB1c2UgVVVJRHMgaW5zdGVhZD8gaHR0cHM6Ly9naXN0LmdpdGh1Yi5jb20vamVkLzk4Mjg4M1xuU0RQVXRpbHMuZ2VuZXJhdGVJZGVudGlmaWVyID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zdWJzdHIoMiwgMTApO1xufTtcblxuLy8gVGhlIFJUQ1AgQ05BTUUgdXNlZCBieSBhbGwgcGVlcmNvbm5lY3Rpb25zIGZyb20gdGhlIHNhbWUgSlMuXG5TRFBVdGlscy5sb2NhbENOYW1lID0gU0RQVXRpbHMuZ2VuZXJhdGVJZGVudGlmaWVyKCk7XG5cbi8vIFNwbGl0cyBTRFAgaW50byBsaW5lcywgZGVhbGluZyB3aXRoIGJvdGggQ1JMRiBhbmQgTEYuXG5TRFBVdGlscy5zcGxpdExpbmVzID0gZnVuY3Rpb24oYmxvYikge1xuICByZXR1cm4gYmxvYi50cmltKCkuc3BsaXQoJ1xcbicpLm1hcChsaW5lID0+IGxpbmUudHJpbSgpKTtcbn07XG4vLyBTcGxpdHMgU0RQIGludG8gc2Vzc2lvbnBhcnQgYW5kIG1lZGlhc2VjdGlvbnMuIEVuc3VyZXMgQ1JMRi5cblNEUFV0aWxzLnNwbGl0U2VjdGlvbnMgPSBmdW5jdGlvbihibG9iKSB7XG4gIGNvbnN0IHBhcnRzID0gYmxvYi5zcGxpdCgnXFxubT0nKTtcbiAgcmV0dXJuIHBhcnRzLm1hcCgocGFydCwgaW5kZXgpID0+IChpbmRleCA+IDAgP1xuICAgICdtPScgKyBwYXJ0IDogcGFydCkudHJpbSgpICsgJ1xcclxcbicpO1xufTtcblxuLy8gUmV0dXJucyB0aGUgc2Vzc2lvbiBkZXNjcmlwdGlvbi5cblNEUFV0aWxzLmdldERlc2NyaXB0aW9uID0gZnVuY3Rpb24oYmxvYikge1xuICBjb25zdCBzZWN0aW9ucyA9IFNEUFV0aWxzLnNwbGl0U2VjdGlvbnMoYmxvYik7XG4gIHJldHVybiBzZWN0aW9ucyAmJiBzZWN0aW9uc1swXTtcbn07XG5cbi8vIFJldHVybnMgdGhlIGluZGl2aWR1YWwgbWVkaWEgc2VjdGlvbnMuXG5TRFBVdGlscy5nZXRNZWRpYVNlY3Rpb25zID0gZnVuY3Rpb24oYmxvYikge1xuICBjb25zdCBzZWN0aW9ucyA9IFNEUFV0aWxzLnNwbGl0U2VjdGlvbnMoYmxvYik7XG4gIHNlY3Rpb25zLnNoaWZ0KCk7XG4gIHJldHVybiBzZWN0aW9ucztcbn07XG5cbi8vIFJldHVybnMgbGluZXMgdGhhdCBzdGFydCB3aXRoIGEgY2VydGFpbiBwcmVmaXguXG5TRFBVdGlscy5tYXRjaFByZWZpeCA9IGZ1bmN0aW9uKGJsb2IsIHByZWZpeCkge1xuICByZXR1cm4gU0RQVXRpbHMuc3BsaXRMaW5lcyhibG9iKS5maWx0ZXIobGluZSA9PiBsaW5lLmluZGV4T2YocHJlZml4KSA9PT0gMCk7XG59O1xuXG4vLyBQYXJzZXMgYW4gSUNFIGNhbmRpZGF0ZSBsaW5lLiBTYW1wbGUgaW5wdXQ6XG4vLyBjYW5kaWRhdGU6NzAyNzg2MzUwIDIgdWRwIDQxODE5OTAyIDguOC44LjggNjA3NjkgdHlwIHJlbGF5IHJhZGRyIDguOC44Ljhcbi8vIHJwb3J0IDU1OTk2XCJcbi8vIElucHV0IGNhbiBiZSBwcmVmaXhlZCB3aXRoIGE9LlxuU0RQVXRpbHMucGFyc2VDYW5kaWRhdGUgPSBmdW5jdGlvbihsaW5lKSB7XG4gIGxldCBwYXJ0cztcbiAgLy8gUGFyc2UgYm90aCB2YXJpYW50cy5cbiAgaWYgKGxpbmUuaW5kZXhPZignYT1jYW5kaWRhdGU6JykgPT09IDApIHtcbiAgICBwYXJ0cyA9IGxpbmUuc3Vic3RyaW5nKDEyKS5zcGxpdCgnICcpO1xuICB9IGVsc2Uge1xuICAgIHBhcnRzID0gbGluZS5zdWJzdHJpbmcoMTApLnNwbGl0KCcgJyk7XG4gIH1cblxuICBjb25zdCBjYW5kaWRhdGUgPSB7XG4gICAgZm91bmRhdGlvbjogcGFydHNbMF0sXG4gICAgY29tcG9uZW50OiB7MTogJ3J0cCcsIDI6ICdydGNwJ31bcGFydHNbMV1dIHx8IHBhcnRzWzFdLFxuICAgIHByb3RvY29sOiBwYXJ0c1syXS50b0xvd2VyQ2FzZSgpLFxuICAgIHByaW9yaXR5OiBwYXJzZUludChwYXJ0c1szXSwgMTApLFxuICAgIGlwOiBwYXJ0c1s0XSxcbiAgICBhZGRyZXNzOiBwYXJ0c1s0XSwgLy8gYWRkcmVzcyBpcyBhbiBhbGlhcyBmb3IgaXAuXG4gICAgcG9ydDogcGFyc2VJbnQocGFydHNbNV0sIDEwKSxcbiAgICAvLyBza2lwIHBhcnRzWzZdID09ICd0eXAnXG4gICAgdHlwZTogcGFydHNbN10sXG4gIH07XG5cbiAgZm9yIChsZXQgaSA9IDg7IGkgPCBwYXJ0cy5sZW5ndGg7IGkgKz0gMikge1xuICAgIHN3aXRjaCAocGFydHNbaV0pIHtcbiAgICAgIGNhc2UgJ3JhZGRyJzpcbiAgICAgICAgY2FuZGlkYXRlLnJlbGF0ZWRBZGRyZXNzID0gcGFydHNbaSArIDFdO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3Jwb3J0JzpcbiAgICAgICAgY2FuZGlkYXRlLnJlbGF0ZWRQb3J0ID0gcGFyc2VJbnQocGFydHNbaSArIDFdLCAxMCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAndGNwdHlwZSc6XG4gICAgICAgIGNhbmRpZGF0ZS50Y3BUeXBlID0gcGFydHNbaSArIDFdO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3VmcmFnJzpcbiAgICAgICAgY2FuZGlkYXRlLnVmcmFnID0gcGFydHNbaSArIDFdOyAvLyBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eS5cbiAgICAgICAgY2FuZGlkYXRlLnVzZXJuYW1lRnJhZ21lbnQgPSBwYXJ0c1tpICsgMV07XG4gICAgICAgIGJyZWFrO1xuICAgICAgZGVmYXVsdDogLy8gZXh0ZW5zaW9uIGhhbmRsaW5nLCBpbiBwYXJ0aWN1bGFyIHVmcmFnLiBEb24ndCBvdmVyd3JpdGUuXG4gICAgICAgIGlmIChjYW5kaWRhdGVbcGFydHNbaV1dID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBjYW5kaWRhdGVbcGFydHNbaV1dID0gcGFydHNbaSArIDFdO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuICByZXR1cm4gY2FuZGlkYXRlO1xufTtcblxuLy8gVHJhbnNsYXRlcyBhIGNhbmRpZGF0ZSBvYmplY3QgaW50byBTRFAgY2FuZGlkYXRlIGF0dHJpYnV0ZS5cbi8vIFRoaXMgZG9lcyBub3QgaW5jbHVkZSB0aGUgYT0gcHJlZml4IVxuU0RQVXRpbHMud3JpdGVDYW5kaWRhdGUgPSBmdW5jdGlvbihjYW5kaWRhdGUpIHtcbiAgY29uc3Qgc2RwID0gW107XG4gIHNkcC5wdXNoKGNhbmRpZGF0ZS5mb3VuZGF0aW9uKTtcblxuICBjb25zdCBjb21wb25lbnQgPSBjYW5kaWRhdGUuY29tcG9uZW50O1xuICBpZiAoY29tcG9uZW50ID09PSAncnRwJykge1xuICAgIHNkcC5wdXNoKDEpO1xuICB9IGVsc2UgaWYgKGNvbXBvbmVudCA9PT0gJ3J0Y3AnKSB7XG4gICAgc2RwLnB1c2goMik7XG4gIH0gZWxzZSB7XG4gICAgc2RwLnB1c2goY29tcG9uZW50KTtcbiAgfVxuICBzZHAucHVzaChjYW5kaWRhdGUucHJvdG9jb2wudG9VcHBlckNhc2UoKSk7XG4gIHNkcC5wdXNoKGNhbmRpZGF0ZS5wcmlvcml0eSk7XG4gIHNkcC5wdXNoKGNhbmRpZGF0ZS5hZGRyZXNzIHx8IGNhbmRpZGF0ZS5pcCk7XG4gIHNkcC5wdXNoKGNhbmRpZGF0ZS5wb3J0KTtcblxuICBjb25zdCB0eXBlID0gY2FuZGlkYXRlLnR5cGU7XG4gIHNkcC5wdXNoKCd0eXAnKTtcbiAgc2RwLnB1c2godHlwZSk7XG4gIGlmICh0eXBlICE9PSAnaG9zdCcgJiYgY2FuZGlkYXRlLnJlbGF0ZWRBZGRyZXNzICYmXG4gICAgICBjYW5kaWRhdGUucmVsYXRlZFBvcnQpIHtcbiAgICBzZHAucHVzaCgncmFkZHInKTtcbiAgICBzZHAucHVzaChjYW5kaWRhdGUucmVsYXRlZEFkZHJlc3MpO1xuICAgIHNkcC5wdXNoKCdycG9ydCcpO1xuICAgIHNkcC5wdXNoKGNhbmRpZGF0ZS5yZWxhdGVkUG9ydCk7XG4gIH1cbiAgaWYgKGNhbmRpZGF0ZS50Y3BUeXBlICYmIGNhbmRpZGF0ZS5wcm90b2NvbC50b0xvd2VyQ2FzZSgpID09PSAndGNwJykge1xuICAgIHNkcC5wdXNoKCd0Y3B0eXBlJyk7XG4gICAgc2RwLnB1c2goY2FuZGlkYXRlLnRjcFR5cGUpO1xuICB9XG4gIGlmIChjYW5kaWRhdGUudXNlcm5hbWVGcmFnbWVudCB8fCBjYW5kaWRhdGUudWZyYWcpIHtcbiAgICBzZHAucHVzaCgndWZyYWcnKTtcbiAgICBzZHAucHVzaChjYW5kaWRhdGUudXNlcm5hbWVGcmFnbWVudCB8fCBjYW5kaWRhdGUudWZyYWcpO1xuICB9XG4gIHJldHVybiAnY2FuZGlkYXRlOicgKyBzZHAuam9pbignICcpO1xufTtcblxuLy8gUGFyc2VzIGFuIGljZS1vcHRpb25zIGxpbmUsIHJldHVybnMgYW4gYXJyYXkgb2Ygb3B0aW9uIHRhZ3MuXG4vLyBTYW1wbGUgaW5wdXQ6XG4vLyBhPWljZS1vcHRpb25zOmZvbyBiYXJcblNEUFV0aWxzLnBhcnNlSWNlT3B0aW9ucyA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgcmV0dXJuIGxpbmUuc3Vic3RyKDE0KS5zcGxpdCgnICcpO1xufTtcblxuLy8gUGFyc2VzIGEgcnRwbWFwIGxpbmUsIHJldHVybnMgUlRDUnRwQ29kZGVjUGFyYW1ldGVycy4gU2FtcGxlIGlucHV0OlxuLy8gYT1ydHBtYXA6MTExIG9wdXMvNDgwMDAvMlxuU0RQVXRpbHMucGFyc2VSdHBNYXAgPSBmdW5jdGlvbihsaW5lKSB7XG4gIGxldCBwYXJ0cyA9IGxpbmUuc3Vic3RyKDkpLnNwbGl0KCcgJyk7XG4gIGNvbnN0IHBhcnNlZCA9IHtcbiAgICBwYXlsb2FkVHlwZTogcGFyc2VJbnQocGFydHMuc2hpZnQoKSwgMTApLCAvLyB3YXM6IGlkXG4gIH07XG5cbiAgcGFydHMgPSBwYXJ0c1swXS5zcGxpdCgnLycpO1xuXG4gIHBhcnNlZC5uYW1lID0gcGFydHNbMF07XG4gIHBhcnNlZC5jbG9ja1JhdGUgPSBwYXJzZUludChwYXJ0c1sxXSwgMTApOyAvLyB3YXM6IGNsb2NrcmF0ZVxuICBwYXJzZWQuY2hhbm5lbHMgPSBwYXJ0cy5sZW5ndGggPT09IDMgPyBwYXJzZUludChwYXJ0c1syXSwgMTApIDogMTtcbiAgLy8gbGVnYWN5IGFsaWFzLCBnb3QgcmVuYW1lZCBiYWNrIHRvIGNoYW5uZWxzIGluIE9SVEMuXG4gIHBhcnNlZC5udW1DaGFubmVscyA9IHBhcnNlZC5jaGFubmVscztcbiAgcmV0dXJuIHBhcnNlZDtcbn07XG5cbi8vIEdlbmVyYXRlcyBhIHJ0cG1hcCBsaW5lIGZyb20gUlRDUnRwQ29kZWNDYXBhYmlsaXR5IG9yXG4vLyBSVENSdHBDb2RlY1BhcmFtZXRlcnMuXG5TRFBVdGlscy53cml0ZVJ0cE1hcCA9IGZ1bmN0aW9uKGNvZGVjKSB7XG4gIGxldCBwdCA9IGNvZGVjLnBheWxvYWRUeXBlO1xuICBpZiAoY29kZWMucHJlZmVycmVkUGF5bG9hZFR5cGUgIT09IHVuZGVmaW5lZCkge1xuICAgIHB0ID0gY29kZWMucHJlZmVycmVkUGF5bG9hZFR5cGU7XG4gIH1cbiAgY29uc3QgY2hhbm5lbHMgPSBjb2RlYy5jaGFubmVscyB8fCBjb2RlYy5udW1DaGFubmVscyB8fCAxO1xuICByZXR1cm4gJ2E9cnRwbWFwOicgKyBwdCArICcgJyArIGNvZGVjLm5hbWUgKyAnLycgKyBjb2RlYy5jbG9ja1JhdGUgK1xuICAgICAgKGNoYW5uZWxzICE9PSAxID8gJy8nICsgY2hhbm5lbHMgOiAnJykgKyAnXFxyXFxuJztcbn07XG5cbi8vIFBhcnNlcyBhIGV4dG1hcCBsaW5lIChoZWFkZXJleHRlbnNpb24gZnJvbSBSRkMgNTI4NSkuIFNhbXBsZSBpbnB1dDpcbi8vIGE9ZXh0bWFwOjIgdXJuOmlldGY6cGFyYW1zOnJ0cC1oZHJleHQ6dG9mZnNldFxuLy8gYT1leHRtYXA6Mi9zZW5kb25seSB1cm46aWV0ZjpwYXJhbXM6cnRwLWhkcmV4dDp0b2Zmc2V0XG5TRFBVdGlscy5wYXJzZUV4dG1hcCA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgY29uc3QgcGFydHMgPSBsaW5lLnN1YnN0cig5KS5zcGxpdCgnICcpO1xuICByZXR1cm4ge1xuICAgIGlkOiBwYXJzZUludChwYXJ0c1swXSwgMTApLFxuICAgIGRpcmVjdGlvbjogcGFydHNbMF0uaW5kZXhPZignLycpID4gMCA/IHBhcnRzWzBdLnNwbGl0KCcvJylbMV0gOiAnc2VuZHJlY3YnLFxuICAgIHVyaTogcGFydHNbMV0sXG4gIH07XG59O1xuXG4vLyBHZW5lcmF0ZXMgYW4gZXh0bWFwIGxpbmUgZnJvbSBSVENSdHBIZWFkZXJFeHRlbnNpb25QYXJhbWV0ZXJzIG9yXG4vLyBSVENSdHBIZWFkZXJFeHRlbnNpb24uXG5TRFBVdGlscy53cml0ZUV4dG1hcCA9IGZ1bmN0aW9uKGhlYWRlckV4dGVuc2lvbikge1xuICByZXR1cm4gJ2E9ZXh0bWFwOicgKyAoaGVhZGVyRXh0ZW5zaW9uLmlkIHx8IGhlYWRlckV4dGVuc2lvbi5wcmVmZXJyZWRJZCkgK1xuICAgICAgKGhlYWRlckV4dGVuc2lvbi5kaXJlY3Rpb24gJiYgaGVhZGVyRXh0ZW5zaW9uLmRpcmVjdGlvbiAhPT0gJ3NlbmRyZWN2J1xuICAgICAgICA/ICcvJyArIGhlYWRlckV4dGVuc2lvbi5kaXJlY3Rpb25cbiAgICAgICAgOiAnJykgK1xuICAgICAgJyAnICsgaGVhZGVyRXh0ZW5zaW9uLnVyaSArICdcXHJcXG4nO1xufTtcblxuLy8gUGFyc2VzIGEgZm10cCBsaW5lLCByZXR1cm5zIGRpY3Rpb25hcnkuIFNhbXBsZSBpbnB1dDpcbi8vIGE9Zm10cDo5NiB2YnI9b247Y25nPW9uXG4vLyBBbHNvIGRlYWxzIHdpdGggdmJyPW9uOyBjbmc9b25cblNEUFV0aWxzLnBhcnNlRm10cCA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgY29uc3QgcGFyc2VkID0ge307XG4gIGxldCBrdjtcbiAgY29uc3QgcGFydHMgPSBsaW5lLnN1YnN0cihsaW5lLmluZGV4T2YoJyAnKSArIDEpLnNwbGl0KCc7Jyk7XG4gIGZvciAobGV0IGogPSAwOyBqIDwgcGFydHMubGVuZ3RoOyBqKyspIHtcbiAgICBrdiA9IHBhcnRzW2pdLnRyaW0oKS5zcGxpdCgnPScpO1xuICAgIHBhcnNlZFtrdlswXS50cmltKCldID0ga3ZbMV07XG4gIH1cbiAgcmV0dXJuIHBhcnNlZDtcbn07XG5cbi8vIEdlbmVyYXRlcyBhIGZtdHAgbGluZSBmcm9tIFJUQ1J0cENvZGVjQ2FwYWJpbGl0eSBvciBSVENSdHBDb2RlY1BhcmFtZXRlcnMuXG5TRFBVdGlscy53cml0ZUZtdHAgPSBmdW5jdGlvbihjb2RlYykge1xuICBsZXQgbGluZSA9ICcnO1xuICBsZXQgcHQgPSBjb2RlYy5wYXlsb2FkVHlwZTtcbiAgaWYgKGNvZGVjLnByZWZlcnJlZFBheWxvYWRUeXBlICE9PSB1bmRlZmluZWQpIHtcbiAgICBwdCA9IGNvZGVjLnByZWZlcnJlZFBheWxvYWRUeXBlO1xuICB9XG4gIGlmIChjb2RlYy5wYXJhbWV0ZXJzICYmIE9iamVjdC5rZXlzKGNvZGVjLnBhcmFtZXRlcnMpLmxlbmd0aCkge1xuICAgIGNvbnN0IHBhcmFtcyA9IFtdO1xuICAgIE9iamVjdC5rZXlzKGNvZGVjLnBhcmFtZXRlcnMpLmZvckVhY2gocGFyYW0gPT4ge1xuICAgICAgaWYgKGNvZGVjLnBhcmFtZXRlcnNbcGFyYW1dICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcGFyYW1zLnB1c2gocGFyYW0gKyAnPScgKyBjb2RlYy5wYXJhbWV0ZXJzW3BhcmFtXSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwYXJhbXMucHVzaChwYXJhbSk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgbGluZSArPSAnYT1mbXRwOicgKyBwdCArICcgJyArIHBhcmFtcy5qb2luKCc7JykgKyAnXFxyXFxuJztcbiAgfVxuICByZXR1cm4gbGluZTtcbn07XG5cbi8vIFBhcnNlcyBhIHJ0Y3AtZmIgbGluZSwgcmV0dXJucyBSVENQUnRjcEZlZWRiYWNrIG9iamVjdC4gU2FtcGxlIGlucHV0OlxuLy8gYT1ydGNwLWZiOjk4IG5hY2sgcnBzaVxuU0RQVXRpbHMucGFyc2VSdGNwRmIgPSBmdW5jdGlvbihsaW5lKSB7XG4gIGNvbnN0IHBhcnRzID0gbGluZS5zdWJzdHIobGluZS5pbmRleE9mKCcgJykgKyAxKS5zcGxpdCgnICcpO1xuICByZXR1cm4ge1xuICAgIHR5cGU6IHBhcnRzLnNoaWZ0KCksXG4gICAgcGFyYW1ldGVyOiBwYXJ0cy5qb2luKCcgJyksXG4gIH07XG59O1xuXG4vLyBHZW5lcmF0ZSBhPXJ0Y3AtZmIgbGluZXMgZnJvbSBSVENSdHBDb2RlY0NhcGFiaWxpdHkgb3IgUlRDUnRwQ29kZWNQYXJhbWV0ZXJzLlxuU0RQVXRpbHMud3JpdGVSdGNwRmIgPSBmdW5jdGlvbihjb2RlYykge1xuICBsZXQgbGluZXMgPSAnJztcbiAgbGV0IHB0ID0gY29kZWMucGF5bG9hZFR5cGU7XG4gIGlmIChjb2RlYy5wcmVmZXJyZWRQYXlsb2FkVHlwZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgcHQgPSBjb2RlYy5wcmVmZXJyZWRQYXlsb2FkVHlwZTtcbiAgfVxuICBpZiAoY29kZWMucnRjcEZlZWRiYWNrICYmIGNvZGVjLnJ0Y3BGZWVkYmFjay5sZW5ndGgpIHtcbiAgICAvLyBGSVhNRTogc3BlY2lhbCBoYW5kbGluZyBmb3IgdHJyLWludD9cbiAgICBjb2RlYy5ydGNwRmVlZGJhY2suZm9yRWFjaChmYiA9PiB7XG4gICAgICBsaW5lcyArPSAnYT1ydGNwLWZiOicgKyBwdCArICcgJyArIGZiLnR5cGUgK1xuICAgICAgKGZiLnBhcmFtZXRlciAmJiBmYi5wYXJhbWV0ZXIubGVuZ3RoID8gJyAnICsgZmIucGFyYW1ldGVyIDogJycpICtcbiAgICAgICAgICAnXFxyXFxuJztcbiAgICB9KTtcbiAgfVxuICByZXR1cm4gbGluZXM7XG59O1xuXG4vLyBQYXJzZXMgYSBSRkMgNTU3NiBzc3JjIG1lZGlhIGF0dHJpYnV0ZS4gU2FtcGxlIGlucHV0OlxuLy8gYT1zc3JjOjM3MzU5Mjg1NTkgY25hbWU6c29tZXRoaW5nXG5TRFBVdGlscy5wYXJzZVNzcmNNZWRpYSA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgY29uc3Qgc3AgPSBsaW5lLmluZGV4T2YoJyAnKTtcbiAgY29uc3QgcGFydHMgPSB7XG4gICAgc3NyYzogcGFyc2VJbnQobGluZS5zdWJzdHIoNywgc3AgLSA3KSwgMTApLFxuICB9O1xuICBjb25zdCBjb2xvbiA9IGxpbmUuaW5kZXhPZignOicsIHNwKTtcbiAgaWYgKGNvbG9uID4gLTEpIHtcbiAgICBwYXJ0cy5hdHRyaWJ1dGUgPSBsaW5lLnN1YnN0cihzcCArIDEsIGNvbG9uIC0gc3AgLSAxKTtcbiAgICBwYXJ0cy52YWx1ZSA9IGxpbmUuc3Vic3RyKGNvbG9uICsgMSk7XG4gIH0gZWxzZSB7XG4gICAgcGFydHMuYXR0cmlidXRlID0gbGluZS5zdWJzdHIoc3AgKyAxKTtcbiAgfVxuICByZXR1cm4gcGFydHM7XG59O1xuXG4vLyBQYXJzZSBhIHNzcmMtZ3JvdXAgbGluZSAoc2VlIFJGQyA1NTc2KS4gU2FtcGxlIGlucHV0OlxuLy8gYT1zc3JjLWdyb3VwOnNlbWFudGljcyAxMiAzNFxuU0RQVXRpbHMucGFyc2VTc3JjR3JvdXAgPSBmdW5jdGlvbihsaW5lKSB7XG4gIGNvbnN0IHBhcnRzID0gbGluZS5zdWJzdHIoMTMpLnNwbGl0KCcgJyk7XG4gIHJldHVybiB7XG4gICAgc2VtYW50aWNzOiBwYXJ0cy5zaGlmdCgpLFxuICAgIHNzcmNzOiBwYXJ0cy5tYXAoc3NyYyA9PiBwYXJzZUludChzc3JjLCAxMCkpLFxuICB9O1xufTtcblxuLy8gRXh0cmFjdHMgdGhlIE1JRCAoUkZDIDU4ODgpIGZyb20gYSBtZWRpYSBzZWN0aW9uLlxuLy8gUmV0dXJucyB0aGUgTUlEIG9yIHVuZGVmaW5lZCBpZiBubyBtaWQgbGluZSB3YXMgZm91bmQuXG5TRFBVdGlscy5nZXRNaWQgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgY29uc3QgbWlkID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1taWQ6JylbMF07XG4gIGlmIChtaWQpIHtcbiAgICByZXR1cm4gbWlkLnN1YnN0cig2KTtcbiAgfVxufTtcblxuLy8gUGFyc2VzIGEgZmluZ2VycHJpbnQgbGluZSBmb3IgRFRMUy1TUlRQLlxuU0RQVXRpbHMucGFyc2VGaW5nZXJwcmludCA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgY29uc3QgcGFydHMgPSBsaW5lLnN1YnN0cigxNCkuc3BsaXQoJyAnKTtcbiAgcmV0dXJuIHtcbiAgICBhbGdvcml0aG06IHBhcnRzWzBdLnRvTG93ZXJDYXNlKCksIC8vIGFsZ29yaXRobSBpcyBjYXNlLXNlbnNpdGl2ZSBpbiBFZGdlLlxuICAgIHZhbHVlOiBwYXJ0c1sxXS50b1VwcGVyQ2FzZSgpLCAvLyB0aGUgZGVmaW5pdGlvbiBpcyB1cHBlci1jYXNlIGluIFJGQyA0NTcyLlxuICB9O1xufTtcblxuLy8gRXh0cmFjdHMgRFRMUyBwYXJhbWV0ZXJzIGZyb20gU0RQIG1lZGlhIHNlY3Rpb24gb3Igc2Vzc2lvbnBhcnQuXG4vLyBGSVhNRTogZm9yIGNvbnNpc3RlbmN5IHdpdGggb3RoZXIgZnVuY3Rpb25zIHRoaXMgc2hvdWxkIG9ubHlcbi8vICAgZ2V0IHRoZSBmaW5nZXJwcmludCBsaW5lIGFzIGlucHV0LiBTZWUgYWxzbyBnZXRJY2VQYXJhbWV0ZXJzLlxuU0RQVXRpbHMuZ2V0RHRsc1BhcmFtZXRlcnMgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24sIHNlc3Npb25wYXJ0KSB7XG4gIGNvbnN0IGxpbmVzID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uICsgc2Vzc2lvbnBhcnQsXG4gICAgJ2E9ZmluZ2VycHJpbnQ6Jyk7XG4gIC8vIE5vdGU6IGE9c2V0dXAgbGluZSBpcyBpZ25vcmVkIHNpbmNlIHdlIHVzZSB0aGUgJ2F1dG8nIHJvbGUgaW4gRWRnZS5cbiAgcmV0dXJuIHtcbiAgICByb2xlOiAnYXV0bycsXG4gICAgZmluZ2VycHJpbnRzOiBsaW5lcy5tYXAoU0RQVXRpbHMucGFyc2VGaW5nZXJwcmludCksXG4gIH07XG59O1xuXG4vLyBTZXJpYWxpemVzIERUTFMgcGFyYW1ldGVycyB0byBTRFAuXG5TRFBVdGlscy53cml0ZUR0bHNQYXJhbWV0ZXJzID0gZnVuY3Rpb24ocGFyYW1zLCBzZXR1cFR5cGUpIHtcbiAgbGV0IHNkcCA9ICdhPXNldHVwOicgKyBzZXR1cFR5cGUgKyAnXFxyXFxuJztcbiAgcGFyYW1zLmZpbmdlcnByaW50cy5mb3JFYWNoKGZwID0+IHtcbiAgICBzZHAgKz0gJ2E9ZmluZ2VycHJpbnQ6JyArIGZwLmFsZ29yaXRobSArICcgJyArIGZwLnZhbHVlICsgJ1xcclxcbic7XG4gIH0pO1xuICByZXR1cm4gc2RwO1xufTtcblxuLy8gUGFyc2VzIGE9Y3J5cHRvIGxpbmVzIGludG9cbi8vICAgaHR0cHM6Ly9yYXdnaXQuY29tL2Fib2JhL2VkZ2VydGMvbWFzdGVyL21zb3J0Yy1yczQuaHRtbCNkaWN0aW9uYXJ5LXJ0Y3NydHBzZGVzcGFyYW1ldGVycy1tZW1iZXJzXG5TRFBVdGlscy5wYXJzZUNyeXB0b0xpbmUgPSBmdW5jdGlvbihsaW5lKSB7XG4gIGNvbnN0IHBhcnRzID0gbGluZS5zdWJzdHIoOSkuc3BsaXQoJyAnKTtcbiAgcmV0dXJuIHtcbiAgICB0YWc6IHBhcnNlSW50KHBhcnRzWzBdLCAxMCksXG4gICAgY3J5cHRvU3VpdGU6IHBhcnRzWzFdLFxuICAgIGtleVBhcmFtczogcGFydHNbMl0sXG4gICAgc2Vzc2lvblBhcmFtczogcGFydHMuc2xpY2UoMyksXG4gIH07XG59O1xuXG5TRFBVdGlscy53cml0ZUNyeXB0b0xpbmUgPSBmdW5jdGlvbihwYXJhbWV0ZXJzKSB7XG4gIHJldHVybiAnYT1jcnlwdG86JyArIHBhcmFtZXRlcnMudGFnICsgJyAnICtcbiAgICBwYXJhbWV0ZXJzLmNyeXB0b1N1aXRlICsgJyAnICtcbiAgICAodHlwZW9mIHBhcmFtZXRlcnMua2V5UGFyYW1zID09PSAnb2JqZWN0J1xuICAgICAgPyBTRFBVdGlscy53cml0ZUNyeXB0b0tleVBhcmFtcyhwYXJhbWV0ZXJzLmtleVBhcmFtcylcbiAgICAgIDogcGFyYW1ldGVycy5rZXlQYXJhbXMpICtcbiAgICAocGFyYW1ldGVycy5zZXNzaW9uUGFyYW1zID8gJyAnICsgcGFyYW1ldGVycy5zZXNzaW9uUGFyYW1zLmpvaW4oJyAnKSA6ICcnKSArXG4gICAgJ1xcclxcbic7XG59O1xuXG4vLyBQYXJzZXMgdGhlIGNyeXB0byBrZXkgcGFyYW1ldGVycyBpbnRvXG4vLyAgIGh0dHBzOi8vcmF3Z2l0LmNvbS9hYm9iYS9lZGdlcnRjL21hc3Rlci9tc29ydGMtcnM0Lmh0bWwjcnRjc3J0cGtleXBhcmFtKlxuU0RQVXRpbHMucGFyc2VDcnlwdG9LZXlQYXJhbXMgPSBmdW5jdGlvbihrZXlQYXJhbXMpIHtcbiAgaWYgKGtleVBhcmFtcy5pbmRleE9mKCdpbmxpbmU6JykgIT09IDApIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICBjb25zdCBwYXJ0cyA9IGtleVBhcmFtcy5zdWJzdHIoNykuc3BsaXQoJ3wnKTtcbiAgcmV0dXJuIHtcbiAgICBrZXlNZXRob2Q6ICdpbmxpbmUnLFxuICAgIGtleVNhbHQ6IHBhcnRzWzBdLFxuICAgIGxpZmVUaW1lOiBwYXJ0c1sxXSxcbiAgICBta2lWYWx1ZTogcGFydHNbMl0gPyBwYXJ0c1syXS5zcGxpdCgnOicpWzBdIDogdW5kZWZpbmVkLFxuICAgIG1raUxlbmd0aDogcGFydHNbMl0gPyBwYXJ0c1syXS5zcGxpdCgnOicpWzFdIDogdW5kZWZpbmVkLFxuICB9O1xufTtcblxuU0RQVXRpbHMud3JpdGVDcnlwdG9LZXlQYXJhbXMgPSBmdW5jdGlvbihrZXlQYXJhbXMpIHtcbiAgcmV0dXJuIGtleVBhcmFtcy5rZXlNZXRob2QgKyAnOidcbiAgICArIGtleVBhcmFtcy5rZXlTYWx0ICtcbiAgICAoa2V5UGFyYW1zLmxpZmVUaW1lID8gJ3wnICsga2V5UGFyYW1zLmxpZmVUaW1lIDogJycpICtcbiAgICAoa2V5UGFyYW1zLm1raVZhbHVlICYmIGtleVBhcmFtcy5ta2lMZW5ndGhcbiAgICAgID8gJ3wnICsga2V5UGFyYW1zLm1raVZhbHVlICsgJzonICsga2V5UGFyYW1zLm1raUxlbmd0aFxuICAgICAgOiAnJyk7XG59O1xuXG4vLyBFeHRyYWN0cyBhbGwgU0RFUyBwYXJhbWV0ZXJzLlxuU0RQVXRpbHMuZ2V0Q3J5cHRvUGFyYW1ldGVycyA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbiwgc2Vzc2lvbnBhcnQpIHtcbiAgY29uc3QgbGluZXMgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24gKyBzZXNzaW9ucGFydCxcbiAgICAnYT1jcnlwdG86Jyk7XG4gIHJldHVybiBsaW5lcy5tYXAoU0RQVXRpbHMucGFyc2VDcnlwdG9MaW5lKTtcbn07XG5cbi8vIFBhcnNlcyBJQ0UgaW5mb3JtYXRpb24gZnJvbSBTRFAgbWVkaWEgc2VjdGlvbiBvciBzZXNzaW9ucGFydC5cbi8vIEZJWE1FOiBmb3IgY29uc2lzdGVuY3kgd2l0aCBvdGhlciBmdW5jdGlvbnMgdGhpcyBzaG91bGQgb25seVxuLy8gICBnZXQgdGhlIGljZS11ZnJhZyBhbmQgaWNlLXB3ZCBsaW5lcyBhcyBpbnB1dC5cblNEUFV0aWxzLmdldEljZVBhcmFtZXRlcnMgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24sIHNlc3Npb25wYXJ0KSB7XG4gIGNvbnN0IHVmcmFnID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uICsgc2Vzc2lvbnBhcnQsXG4gICAgJ2E9aWNlLXVmcmFnOicpWzBdO1xuICBjb25zdCBwd2QgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24gKyBzZXNzaW9ucGFydCxcbiAgICAnYT1pY2UtcHdkOicpWzBdO1xuICBpZiAoISh1ZnJhZyAmJiBwd2QpKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgcmV0dXJuIHtcbiAgICB1c2VybmFtZUZyYWdtZW50OiB1ZnJhZy5zdWJzdHIoMTIpLFxuICAgIHBhc3N3b3JkOiBwd2Quc3Vic3RyKDEwKSxcbiAgfTtcbn07XG5cbi8vIFNlcmlhbGl6ZXMgSUNFIHBhcmFtZXRlcnMgdG8gU0RQLlxuU0RQVXRpbHMud3JpdGVJY2VQYXJhbWV0ZXJzID0gZnVuY3Rpb24ocGFyYW1zKSB7XG4gIGxldCBzZHAgPSAnYT1pY2UtdWZyYWc6JyArIHBhcmFtcy51c2VybmFtZUZyYWdtZW50ICsgJ1xcclxcbicgK1xuICAgICAgJ2E9aWNlLXB3ZDonICsgcGFyYW1zLnBhc3N3b3JkICsgJ1xcclxcbic7XG4gIGlmIChwYXJhbXMuaWNlTGl0ZSkge1xuICAgIHNkcCArPSAnYT1pY2UtbGl0ZVxcclxcbic7XG4gIH1cbiAgcmV0dXJuIHNkcDtcbn07XG5cbi8vIFBhcnNlcyB0aGUgU0RQIG1lZGlhIHNlY3Rpb24gYW5kIHJldHVybnMgUlRDUnRwUGFyYW1ldGVycy5cblNEUFV0aWxzLnBhcnNlUnRwUGFyYW1ldGVycyA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbikge1xuICBjb25zdCBkZXNjcmlwdGlvbiA9IHtcbiAgICBjb2RlY3M6IFtdLFxuICAgIGhlYWRlckV4dGVuc2lvbnM6IFtdLFxuICAgIGZlY01lY2hhbmlzbXM6IFtdLFxuICAgIHJ0Y3A6IFtdLFxuICB9O1xuICBjb25zdCBsaW5lcyA9IFNEUFV0aWxzLnNwbGl0TGluZXMobWVkaWFTZWN0aW9uKTtcbiAgY29uc3QgbWxpbmUgPSBsaW5lc1swXS5zcGxpdCgnICcpO1xuICBmb3IgKGxldCBpID0gMzsgaSA8IG1saW5lLmxlbmd0aDsgaSsrKSB7IC8vIGZpbmQgYWxsIGNvZGVjcyBmcm9tIG1saW5lWzMuLl1cbiAgICBjb25zdCBwdCA9IG1saW5lW2ldO1xuICAgIGNvbnN0IHJ0cG1hcGxpbmUgPSBTRFBVdGlscy5tYXRjaFByZWZpeChcbiAgICAgIG1lZGlhU2VjdGlvbiwgJ2E9cnRwbWFwOicgKyBwdCArICcgJylbMF07XG4gICAgaWYgKHJ0cG1hcGxpbmUpIHtcbiAgICAgIGNvbnN0IGNvZGVjID0gU0RQVXRpbHMucGFyc2VSdHBNYXAocnRwbWFwbGluZSk7XG4gICAgICBjb25zdCBmbXRwcyA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KFxuICAgICAgICBtZWRpYVNlY3Rpb24sICdhPWZtdHA6JyArIHB0ICsgJyAnKTtcbiAgICAgIC8vIE9ubHkgdGhlIGZpcnN0IGE9Zm10cDo8cHQ+IGlzIGNvbnNpZGVyZWQuXG4gICAgICBjb2RlYy5wYXJhbWV0ZXJzID0gZm10cHMubGVuZ3RoID8gU0RQVXRpbHMucGFyc2VGbXRwKGZtdHBzWzBdKSA6IHt9O1xuICAgICAgY29kZWMucnRjcEZlZWRiYWNrID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgoXG4gICAgICAgIG1lZGlhU2VjdGlvbiwgJ2E9cnRjcC1mYjonICsgcHQgKyAnICcpXG4gICAgICAgIC5tYXAoU0RQVXRpbHMucGFyc2VSdGNwRmIpO1xuICAgICAgZGVzY3JpcHRpb24uY29kZWNzLnB1c2goY29kZWMpO1xuICAgICAgLy8gcGFyc2UgRkVDIG1lY2hhbmlzbXMgZnJvbSBydHBtYXAgbGluZXMuXG4gICAgICBzd2l0Y2ggKGNvZGVjLm5hbWUudG9VcHBlckNhc2UoKSkge1xuICAgICAgICBjYXNlICdSRUQnOlxuICAgICAgICBjYXNlICdVTFBGRUMnOlxuICAgICAgICAgIGRlc2NyaXB0aW9uLmZlY01lY2hhbmlzbXMucHVzaChjb2RlYy5uYW1lLnRvVXBwZXJDYXNlKCkpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OiAvLyBvbmx5IFJFRCBhbmQgVUxQRkVDIGFyZSByZWNvZ25pemVkIGFzIEZFQyBtZWNoYW5pc21zLlxuICAgICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPWV4dG1hcDonKS5mb3JFYWNoKGxpbmUgPT4ge1xuICAgIGRlc2NyaXB0aW9uLmhlYWRlckV4dGVuc2lvbnMucHVzaChTRFBVdGlscy5wYXJzZUV4dG1hcChsaW5lKSk7XG4gIH0pO1xuICAvLyBGSVhNRTogcGFyc2UgcnRjcC5cbiAgcmV0dXJuIGRlc2NyaXB0aW9uO1xufTtcblxuLy8gR2VuZXJhdGVzIHBhcnRzIG9mIHRoZSBTRFAgbWVkaWEgc2VjdGlvbiBkZXNjcmliaW5nIHRoZSBjYXBhYmlsaXRpZXMgL1xuLy8gcGFyYW1ldGVycy5cblNEUFV0aWxzLndyaXRlUnRwRGVzY3JpcHRpb24gPSBmdW5jdGlvbihraW5kLCBjYXBzKSB7XG4gIGxldCBzZHAgPSAnJztcblxuICAvLyBCdWlsZCB0aGUgbWxpbmUuXG4gIHNkcCArPSAnbT0nICsga2luZCArICcgJztcbiAgc2RwICs9IGNhcHMuY29kZWNzLmxlbmd0aCA+IDAgPyAnOScgOiAnMCc7IC8vIHJlamVjdCBpZiBubyBjb2RlY3MuXG4gIHNkcCArPSAnIFVEUC9UTFMvUlRQL1NBVlBGICc7XG4gIHNkcCArPSBjYXBzLmNvZGVjcy5tYXAoY29kZWMgPT4ge1xuICAgIGlmIChjb2RlYy5wcmVmZXJyZWRQYXlsb2FkVHlwZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXR1cm4gY29kZWMucHJlZmVycmVkUGF5bG9hZFR5cGU7XG4gICAgfVxuICAgIHJldHVybiBjb2RlYy5wYXlsb2FkVHlwZTtcbiAgfSkuam9pbignICcpICsgJ1xcclxcbic7XG5cbiAgc2RwICs9ICdjPUlOIElQNCAwLjAuMC4wXFxyXFxuJztcbiAgc2RwICs9ICdhPXJ0Y3A6OSBJTiBJUDQgMC4wLjAuMFxcclxcbic7XG5cbiAgLy8gQWRkIGE9cnRwbWFwIGxpbmVzIGZvciBlYWNoIGNvZGVjLiBBbHNvIGZtdHAgYW5kIHJ0Y3AtZmIuXG4gIGNhcHMuY29kZWNzLmZvckVhY2goY29kZWMgPT4ge1xuICAgIHNkcCArPSBTRFBVdGlscy53cml0ZVJ0cE1hcChjb2RlYyk7XG4gICAgc2RwICs9IFNEUFV0aWxzLndyaXRlRm10cChjb2RlYyk7XG4gICAgc2RwICs9IFNEUFV0aWxzLndyaXRlUnRjcEZiKGNvZGVjKTtcbiAgfSk7XG4gIGxldCBtYXhwdGltZSA9IDA7XG4gIGNhcHMuY29kZWNzLmZvckVhY2goY29kZWMgPT4ge1xuICAgIGlmIChjb2RlYy5tYXhwdGltZSA+IG1heHB0aW1lKSB7XG4gICAgICBtYXhwdGltZSA9IGNvZGVjLm1heHB0aW1lO1xuICAgIH1cbiAgfSk7XG4gIGlmIChtYXhwdGltZSA+IDApIHtcbiAgICBzZHAgKz0gJ2E9bWF4cHRpbWU6JyArIG1heHB0aW1lICsgJ1xcclxcbic7XG4gIH1cblxuICBpZiAoY2Fwcy5oZWFkZXJFeHRlbnNpb25zKSB7XG4gICAgY2Fwcy5oZWFkZXJFeHRlbnNpb25zLmZvckVhY2goZXh0ZW5zaW9uID0+IHtcbiAgICAgIHNkcCArPSBTRFBVdGlscy53cml0ZUV4dG1hcChleHRlbnNpb24pO1xuICAgIH0pO1xuICB9XG4gIC8vIEZJWE1FOiB3cml0ZSBmZWNNZWNoYW5pc21zLlxuICByZXR1cm4gc2RwO1xufTtcblxuLy8gUGFyc2VzIHRoZSBTRFAgbWVkaWEgc2VjdGlvbiBhbmQgcmV0dXJucyBhbiBhcnJheSBvZlxuLy8gUlRDUnRwRW5jb2RpbmdQYXJhbWV0ZXJzLlxuU0RQVXRpbHMucGFyc2VSdHBFbmNvZGluZ1BhcmFtZXRlcnMgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgY29uc3QgZW5jb2RpbmdQYXJhbWV0ZXJzID0gW107XG4gIGNvbnN0IGRlc2NyaXB0aW9uID0gU0RQVXRpbHMucGFyc2VSdHBQYXJhbWV0ZXJzKG1lZGlhU2VjdGlvbik7XG4gIGNvbnN0IGhhc1JlZCA9IGRlc2NyaXB0aW9uLmZlY01lY2hhbmlzbXMuaW5kZXhPZignUkVEJykgIT09IC0xO1xuICBjb25zdCBoYXNVbHBmZWMgPSBkZXNjcmlwdGlvbi5mZWNNZWNoYW5pc21zLmluZGV4T2YoJ1VMUEZFQycpICE9PSAtMTtcblxuICAvLyBmaWx0ZXIgYT1zc3JjOi4uLiBjbmFtZTosIGlnbm9yZSBQbGFuQi1tc2lkXG4gIGNvbnN0IHNzcmNzID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1zc3JjOicpXG4gICAgLm1hcChsaW5lID0+IFNEUFV0aWxzLnBhcnNlU3NyY01lZGlhKGxpbmUpKVxuICAgIC5maWx0ZXIocGFydHMgPT4gcGFydHMuYXR0cmlidXRlID09PSAnY25hbWUnKTtcbiAgY29uc3QgcHJpbWFyeVNzcmMgPSBzc3Jjcy5sZW5ndGggPiAwICYmIHNzcmNzWzBdLnNzcmM7XG4gIGxldCBzZWNvbmRhcnlTc3JjO1xuXG4gIGNvbnN0IGZsb3dzID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1zc3JjLWdyb3VwOkZJRCcpXG4gICAgLm1hcChsaW5lID0+IHtcbiAgICAgIGNvbnN0IHBhcnRzID0gbGluZS5zdWJzdHIoMTcpLnNwbGl0KCcgJyk7XG4gICAgICByZXR1cm4gcGFydHMubWFwKHBhcnQgPT4gcGFyc2VJbnQocGFydCwgMTApKTtcbiAgICB9KTtcbiAgaWYgKGZsb3dzLmxlbmd0aCA+IDAgJiYgZmxvd3NbMF0ubGVuZ3RoID4gMSAmJiBmbG93c1swXVswXSA9PT0gcHJpbWFyeVNzcmMpIHtcbiAgICBzZWNvbmRhcnlTc3JjID0gZmxvd3NbMF1bMV07XG4gIH1cblxuICBkZXNjcmlwdGlvbi5jb2RlY3MuZm9yRWFjaChjb2RlYyA9PiB7XG4gICAgaWYgKGNvZGVjLm5hbWUudG9VcHBlckNhc2UoKSA9PT0gJ1JUWCcgJiYgY29kZWMucGFyYW1ldGVycy5hcHQpIHtcbiAgICAgIGxldCBlbmNQYXJhbSA9IHtcbiAgICAgICAgc3NyYzogcHJpbWFyeVNzcmMsXG4gICAgICAgIGNvZGVjUGF5bG9hZFR5cGU6IHBhcnNlSW50KGNvZGVjLnBhcmFtZXRlcnMuYXB0LCAxMCksXG4gICAgICB9O1xuICAgICAgaWYgKHByaW1hcnlTc3JjICYmIHNlY29uZGFyeVNzcmMpIHtcbiAgICAgICAgZW5jUGFyYW0ucnR4ID0ge3NzcmM6IHNlY29uZGFyeVNzcmN9O1xuICAgICAgfVxuICAgICAgZW5jb2RpbmdQYXJhbWV0ZXJzLnB1c2goZW5jUGFyYW0pO1xuICAgICAgaWYgKGhhc1JlZCkge1xuICAgICAgICBlbmNQYXJhbSA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoZW5jUGFyYW0pKTtcbiAgICAgICAgZW5jUGFyYW0uZmVjID0ge1xuICAgICAgICAgIHNzcmM6IHByaW1hcnlTc3JjLFxuICAgICAgICAgIG1lY2hhbmlzbTogaGFzVWxwZmVjID8gJ3JlZCt1bHBmZWMnIDogJ3JlZCcsXG4gICAgICAgIH07XG4gICAgICAgIGVuY29kaW5nUGFyYW1ldGVycy5wdXNoKGVuY1BhcmFtKTtcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xuICBpZiAoZW5jb2RpbmdQYXJhbWV0ZXJzLmxlbmd0aCA9PT0gMCAmJiBwcmltYXJ5U3NyYykge1xuICAgIGVuY29kaW5nUGFyYW1ldGVycy5wdXNoKHtcbiAgICAgIHNzcmM6IHByaW1hcnlTc3JjLFxuICAgIH0pO1xuICB9XG5cbiAgLy8gd2Ugc3VwcG9ydCBib3RoIGI9QVMgYW5kIGI9VElBUyBidXQgaW50ZXJwcmV0IEFTIGFzIFRJQVMuXG4gIGxldCBiYW5kd2lkdGggPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdiPScpO1xuICBpZiAoYmFuZHdpZHRoLmxlbmd0aCkge1xuICAgIGlmIChiYW5kd2lkdGhbMF0uaW5kZXhPZignYj1USUFTOicpID09PSAwKSB7XG4gICAgICBiYW5kd2lkdGggPSBwYXJzZUludChiYW5kd2lkdGhbMF0uc3Vic3RyKDcpLCAxMCk7XG4gICAgfSBlbHNlIGlmIChiYW5kd2lkdGhbMF0uaW5kZXhPZignYj1BUzonKSA9PT0gMCkge1xuICAgICAgLy8gdXNlIGZvcm11bGEgZnJvbSBKU0VQIHRvIGNvbnZlcnQgYj1BUyB0byBUSUFTIHZhbHVlLlxuICAgICAgYmFuZHdpZHRoID0gcGFyc2VJbnQoYmFuZHdpZHRoWzBdLnN1YnN0cig1KSwgMTApICogMTAwMCAqIDAuOTVcbiAgICAgICAgICAtICg1MCAqIDQwICogOCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGJhbmR3aWR0aCA9IHVuZGVmaW5lZDtcbiAgICB9XG4gICAgZW5jb2RpbmdQYXJhbWV0ZXJzLmZvckVhY2gocGFyYW1zID0+IHtcbiAgICAgIHBhcmFtcy5tYXhCaXRyYXRlID0gYmFuZHdpZHRoO1xuICAgIH0pO1xuICB9XG4gIHJldHVybiBlbmNvZGluZ1BhcmFtZXRlcnM7XG59O1xuXG4vLyBwYXJzZXMgaHR0cDovL2RyYWZ0Lm9ydGMub3JnLyNydGNydGNwcGFyYW1ldGVycypcblNEUFV0aWxzLnBhcnNlUnRjcFBhcmFtZXRlcnMgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgY29uc3QgcnRjcFBhcmFtZXRlcnMgPSB7fTtcblxuICAvLyBHZXRzIHRoZSBmaXJzdCBTU1JDLiBOb3RlIHRoYXQgd2l0aCBSVFggdGhlcmUgbWlnaHQgYmUgbXVsdGlwbGVcbiAgLy8gU1NSQ3MuXG4gIGNvbnN0IHJlbW90ZVNzcmMgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPXNzcmM6JylcbiAgICAubWFwKGxpbmUgPT4gU0RQVXRpbHMucGFyc2VTc3JjTWVkaWEobGluZSkpXG4gICAgLmZpbHRlcihvYmogPT4gb2JqLmF0dHJpYnV0ZSA9PT0gJ2NuYW1lJylbMF07XG4gIGlmIChyZW1vdGVTc3JjKSB7XG4gICAgcnRjcFBhcmFtZXRlcnMuY25hbWUgPSByZW1vdGVTc3JjLnZhbHVlO1xuICAgIHJ0Y3BQYXJhbWV0ZXJzLnNzcmMgPSByZW1vdGVTc3JjLnNzcmM7XG4gIH1cblxuICAvLyBFZGdlIHVzZXMgdGhlIGNvbXBvdW5kIGF0dHJpYnV0ZSBpbnN0ZWFkIG9mIHJlZHVjZWRTaXplXG4gIC8vIGNvbXBvdW5kIGlzICFyZWR1Y2VkU2l6ZVxuICBjb25zdCByc2l6ZSA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9cnRjcC1yc2l6ZScpO1xuICBydGNwUGFyYW1ldGVycy5yZWR1Y2VkU2l6ZSA9IHJzaXplLmxlbmd0aCA+IDA7XG4gIHJ0Y3BQYXJhbWV0ZXJzLmNvbXBvdW5kID0gcnNpemUubGVuZ3RoID09PSAwO1xuXG4gIC8vIHBhcnNlcyB0aGUgcnRjcC1tdXggYXR0ctGWYnV0ZS5cbiAgLy8gTm90ZSB0aGF0IEVkZ2UgZG9lcyBub3Qgc3VwcG9ydCB1bm11eGVkIFJUQ1AuXG4gIGNvbnN0IG11eCA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9cnRjcC1tdXgnKTtcbiAgcnRjcFBhcmFtZXRlcnMubXV4ID0gbXV4Lmxlbmd0aCA+IDA7XG5cbiAgcmV0dXJuIHJ0Y3BQYXJhbWV0ZXJzO1xufTtcblxuU0RQVXRpbHMud3JpdGVSdGNwUGFyYW1ldGVycyA9IGZ1bmN0aW9uKHJ0Y3BQYXJhbWV0ZXJzKSB7XG4gIGxldCBzZHAgPSAnJztcbiAgaWYgKHJ0Y3BQYXJhbWV0ZXJzLnJlZHVjZWRTaXplKSB7XG4gICAgc2RwICs9ICdhPXJ0Y3AtcnNpemVcXHJcXG4nO1xuICB9XG4gIGlmIChydGNwUGFyYW1ldGVycy5tdXgpIHtcbiAgICBzZHAgKz0gJ2E9cnRjcC1tdXhcXHJcXG4nO1xuICB9XG4gIGlmIChydGNwUGFyYW1ldGVycy5zc3JjICE9PSB1bmRlZmluZWQgJiYgcnRjcFBhcmFtZXRlcnMuY25hbWUpIHtcbiAgICBzZHAgKz0gJ2E9c3NyYzonICsgcnRjcFBhcmFtZXRlcnMuc3NyYyArXG4gICAgICAnIGNuYW1lOicgKyBydGNwUGFyYW1ldGVycy5jbmFtZSArICdcXHJcXG4nO1xuICB9XG4gIHJldHVybiBzZHA7XG59O1xuXG5cbi8vIHBhcnNlcyBlaXRoZXIgYT1tc2lkOiBvciBhPXNzcmM6Li4uIG1zaWQgbGluZXMgYW5kIHJldHVybnNcbi8vIHRoZSBpZCBvZiB0aGUgTWVkaWFTdHJlYW0gYW5kIE1lZGlhU3RyZWFtVHJhY2suXG5TRFBVdGlscy5wYXJzZU1zaWQgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgbGV0IHBhcnRzO1xuICBjb25zdCBzcGVjID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1tc2lkOicpO1xuICBpZiAoc3BlYy5sZW5ndGggPT09IDEpIHtcbiAgICBwYXJ0cyA9IHNwZWNbMF0uc3Vic3RyKDcpLnNwbGl0KCcgJyk7XG4gICAgcmV0dXJuIHtzdHJlYW06IHBhcnRzWzBdLCB0cmFjazogcGFydHNbMV19O1xuICB9XG4gIGNvbnN0IHBsYW5CID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1zc3JjOicpXG4gICAgLm1hcChsaW5lID0+IFNEUFV0aWxzLnBhcnNlU3NyY01lZGlhKGxpbmUpKVxuICAgIC5maWx0ZXIobXNpZFBhcnRzID0+IG1zaWRQYXJ0cy5hdHRyaWJ1dGUgPT09ICdtc2lkJyk7XG4gIGlmIChwbGFuQi5sZW5ndGggPiAwKSB7XG4gICAgcGFydHMgPSBwbGFuQlswXS52YWx1ZS5zcGxpdCgnICcpO1xuICAgIHJldHVybiB7c3RyZWFtOiBwYXJ0c1swXSwgdHJhY2s6IHBhcnRzWzFdfTtcbiAgfVxufTtcblxuLy8gU0NUUFxuLy8gcGFyc2VzIGRyYWZ0LWlldGYtbW11c2ljLXNjdHAtc2RwLTI2IGZpcnN0IGFuZCBmYWxscyBiYWNrXG4vLyB0byBkcmFmdC1pZXRmLW1tdXNpYy1zY3RwLXNkcC0wNVxuU0RQVXRpbHMucGFyc2VTY3RwRGVzY3JpcHRpb24gPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgY29uc3QgbWxpbmUgPSBTRFBVdGlscy5wYXJzZU1MaW5lKG1lZGlhU2VjdGlvbik7XG4gIGNvbnN0IG1heFNpemVMaW5lID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1tYXgtbWVzc2FnZS1zaXplOicpO1xuICBsZXQgbWF4TWVzc2FnZVNpemU7XG4gIGlmIChtYXhTaXplTGluZS5sZW5ndGggPiAwKSB7XG4gICAgbWF4TWVzc2FnZVNpemUgPSBwYXJzZUludChtYXhTaXplTGluZVswXS5zdWJzdHIoMTkpLCAxMCk7XG4gIH1cbiAgaWYgKGlzTmFOKG1heE1lc3NhZ2VTaXplKSkge1xuICAgIG1heE1lc3NhZ2VTaXplID0gNjU1MzY7XG4gIH1cbiAgY29uc3Qgc2N0cFBvcnQgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPXNjdHAtcG9ydDonKTtcbiAgaWYgKHNjdHBQb3J0Lmxlbmd0aCA+IDApIHtcbiAgICByZXR1cm4ge1xuICAgICAgcG9ydDogcGFyc2VJbnQoc2N0cFBvcnRbMF0uc3Vic3RyKDEyKSwgMTApLFxuICAgICAgcHJvdG9jb2w6IG1saW5lLmZtdCxcbiAgICAgIG1heE1lc3NhZ2VTaXplLFxuICAgIH07XG4gIH1cbiAgY29uc3Qgc2N0cE1hcExpbmVzID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1zY3RwbWFwOicpO1xuICBpZiAoc2N0cE1hcExpbmVzLmxlbmd0aCA+IDApIHtcbiAgICBjb25zdCBwYXJ0cyA9IHNjdHBNYXBMaW5lc1swXVxuICAgICAgLnN1YnN0cigxMClcbiAgICAgIC5zcGxpdCgnICcpO1xuICAgIHJldHVybiB7XG4gICAgICBwb3J0OiBwYXJzZUludChwYXJ0c1swXSwgMTApLFxuICAgICAgcHJvdG9jb2w6IHBhcnRzWzFdLFxuICAgICAgbWF4TWVzc2FnZVNpemUsXG4gICAgfTtcbiAgfVxufTtcblxuLy8gU0NUUFxuLy8gb3V0cHV0cyB0aGUgZHJhZnQtaWV0Zi1tbXVzaWMtc2N0cC1zZHAtMjYgdmVyc2lvbiB0aGF0IGFsbCBicm93c2Vyc1xuLy8gc3VwcG9ydCBieSBub3cgcmVjZWl2aW5nIGluIHRoaXMgZm9ybWF0LCB1bmxlc3Mgd2Ugb3JpZ2luYWxseSBwYXJzZWRcbi8vIGFzIHRoZSBkcmFmdC1pZXRmLW1tdXNpYy1zY3RwLXNkcC0wNSBmb3JtYXQgKGluZGljYXRlZCBieSB0aGUgbS1saW5lXG4vLyBwcm90b2NvbCBvZiBEVExTL1NDVFAgLS0gd2l0aG91dCBVRFAvIG9yIFRDUC8pXG5TRFBVdGlscy53cml0ZVNjdHBEZXNjcmlwdGlvbiA9IGZ1bmN0aW9uKG1lZGlhLCBzY3RwKSB7XG4gIGxldCBvdXRwdXQgPSBbXTtcbiAgaWYgKG1lZGlhLnByb3RvY29sICE9PSAnRFRMUy9TQ1RQJykge1xuICAgIG91dHB1dCA9IFtcbiAgICAgICdtPScgKyBtZWRpYS5raW5kICsgJyA5ICcgKyBtZWRpYS5wcm90b2NvbCArICcgJyArIHNjdHAucHJvdG9jb2wgKyAnXFxyXFxuJyxcbiAgICAgICdjPUlOIElQNCAwLjAuMC4wXFxyXFxuJyxcbiAgICAgICdhPXNjdHAtcG9ydDonICsgc2N0cC5wb3J0ICsgJ1xcclxcbicsXG4gICAgXTtcbiAgfSBlbHNlIHtcbiAgICBvdXRwdXQgPSBbXG4gICAgICAnbT0nICsgbWVkaWEua2luZCArICcgOSAnICsgbWVkaWEucHJvdG9jb2wgKyAnICcgKyBzY3RwLnBvcnQgKyAnXFxyXFxuJyxcbiAgICAgICdjPUlOIElQNCAwLjAuMC4wXFxyXFxuJyxcbiAgICAgICdhPXNjdHBtYXA6JyArIHNjdHAucG9ydCArICcgJyArIHNjdHAucHJvdG9jb2wgKyAnIDY1NTM1XFxyXFxuJyxcbiAgICBdO1xuICB9XG4gIGlmIChzY3RwLm1heE1lc3NhZ2VTaXplICE9PSB1bmRlZmluZWQpIHtcbiAgICBvdXRwdXQucHVzaCgnYT1tYXgtbWVzc2FnZS1zaXplOicgKyBzY3RwLm1heE1lc3NhZ2VTaXplICsgJ1xcclxcbicpO1xuICB9XG4gIHJldHVybiBvdXRwdXQuam9pbignJyk7XG59O1xuXG4vLyBHZW5lcmF0ZSBhIHNlc3Npb24gSUQgZm9yIFNEUC5cbi8vIGh0dHBzOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9kcmFmdC1pZXRmLXJ0Y3dlYi1qc2VwLTIwI3NlY3Rpb24tNS4yLjFcbi8vIHJlY29tbWVuZHMgdXNpbmcgYSBjcnlwdG9ncmFwaGljYWxseSByYW5kb20gK3ZlIDY0LWJpdCB2YWx1ZVxuLy8gYnV0IHJpZ2h0IG5vdyB0aGlzIHNob3VsZCBiZSBhY2NlcHRhYmxlIGFuZCB3aXRoaW4gdGhlIHJpZ2h0IHJhbmdlXG5TRFBVdGlscy5nZW5lcmF0ZVNlc3Npb25JZCA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gTWF0aC5yYW5kb20oKS50b1N0cmluZygpLnN1YnN0cigyLCAyMSk7XG59O1xuXG4vLyBXcml0ZSBib2lsZXIgcGxhdGUgZm9yIHN0YXJ0IG9mIFNEUFxuLy8gc2Vzc0lkIGFyZ3VtZW50IGlzIG9wdGlvbmFsIC0gaWYgbm90IHN1cHBsaWVkIGl0IHdpbGxcbi8vIGJlIGdlbmVyYXRlZCByYW5kb21seVxuLy8gc2Vzc1ZlcnNpb24gaXMgb3B0aW9uYWwgYW5kIGRlZmF1bHRzIHRvIDJcbi8vIHNlc3NVc2VyIGlzIG9wdGlvbmFsIGFuZCBkZWZhdWx0cyB0byAndGhpc2lzYWRhcHRlcm9ydGMnXG5TRFBVdGlscy53cml0ZVNlc3Npb25Cb2lsZXJwbGF0ZSA9IGZ1bmN0aW9uKHNlc3NJZCwgc2Vzc1Zlciwgc2Vzc1VzZXIpIHtcbiAgbGV0IHNlc3Npb25JZDtcbiAgY29uc3QgdmVyc2lvbiA9IHNlc3NWZXIgIT09IHVuZGVmaW5lZCA/IHNlc3NWZXIgOiAyO1xuICBpZiAoc2Vzc0lkKSB7XG4gICAgc2Vzc2lvbklkID0gc2Vzc0lkO1xuICB9IGVsc2Uge1xuICAgIHNlc3Npb25JZCA9IFNEUFV0aWxzLmdlbmVyYXRlU2Vzc2lvbklkKCk7XG4gIH1cbiAgY29uc3QgdXNlciA9IHNlc3NVc2VyIHx8ICd0aGlzaXNhZGFwdGVyb3J0Yyc7XG4gIC8vIEZJWE1FOiBzZXNzLWlkIHNob3VsZCBiZSBhbiBOVFAgdGltZXN0YW1wLlxuICByZXR1cm4gJ3Y9MFxcclxcbicgK1xuICAgICAgJ289JyArIHVzZXIgKyAnICcgKyBzZXNzaW9uSWQgKyAnICcgKyB2ZXJzaW9uICtcbiAgICAgICAgJyBJTiBJUDQgMTI3LjAuMC4xXFxyXFxuJyArXG4gICAgICAncz0tXFxyXFxuJyArXG4gICAgICAndD0wIDBcXHJcXG4nO1xufTtcblxuLy8gR2V0cyB0aGUgZGlyZWN0aW9uIGZyb20gdGhlIG1lZGlhU2VjdGlvbiBvciB0aGUgc2Vzc2lvbnBhcnQuXG5TRFBVdGlscy5nZXREaXJlY3Rpb24gPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24sIHNlc3Npb25wYXJ0KSB7XG4gIC8vIExvb2sgZm9yIHNlbmRyZWN2LCBzZW5kb25seSwgcmVjdm9ubHksIGluYWN0aXZlLCBkZWZhdWx0IHRvIHNlbmRyZWN2LlxuICBjb25zdCBsaW5lcyA9IFNEUFV0aWxzLnNwbGl0TGluZXMobWVkaWFTZWN0aW9uKTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBsaW5lcy5sZW5ndGg7IGkrKykge1xuICAgIHN3aXRjaCAobGluZXNbaV0pIHtcbiAgICAgIGNhc2UgJ2E9c2VuZHJlY3YnOlxuICAgICAgY2FzZSAnYT1zZW5kb25seSc6XG4gICAgICBjYXNlICdhPXJlY3Zvbmx5JzpcbiAgICAgIGNhc2UgJ2E9aW5hY3RpdmUnOlxuICAgICAgICByZXR1cm4gbGluZXNbaV0uc3Vic3RyKDIpO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgLy8gRklYTUU6IFdoYXQgc2hvdWxkIGhhcHBlbiBoZXJlP1xuICAgIH1cbiAgfVxuICBpZiAoc2Vzc2lvbnBhcnQpIHtcbiAgICByZXR1cm4gU0RQVXRpbHMuZ2V0RGlyZWN0aW9uKHNlc3Npb25wYXJ0KTtcbiAgfVxuICByZXR1cm4gJ3NlbmRyZWN2Jztcbn07XG5cblNEUFV0aWxzLmdldEtpbmQgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgY29uc3QgbGluZXMgPSBTRFBVdGlscy5zcGxpdExpbmVzKG1lZGlhU2VjdGlvbik7XG4gIGNvbnN0IG1saW5lID0gbGluZXNbMF0uc3BsaXQoJyAnKTtcbiAgcmV0dXJuIG1saW5lWzBdLnN1YnN0cigyKTtcbn07XG5cblNEUFV0aWxzLmlzUmVqZWN0ZWQgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgcmV0dXJuIG1lZGlhU2VjdGlvbi5zcGxpdCgnICcsIDIpWzFdID09PSAnMCc7XG59O1xuXG5TRFBVdGlscy5wYXJzZU1MaW5lID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIGNvbnN0IGxpbmVzID0gU0RQVXRpbHMuc3BsaXRMaW5lcyhtZWRpYVNlY3Rpb24pO1xuICBjb25zdCBwYXJ0cyA9IGxpbmVzWzBdLnN1YnN0cigyKS5zcGxpdCgnICcpO1xuICByZXR1cm4ge1xuICAgIGtpbmQ6IHBhcnRzWzBdLFxuICAgIHBvcnQ6IHBhcnNlSW50KHBhcnRzWzFdLCAxMCksXG4gICAgcHJvdG9jb2w6IHBhcnRzWzJdLFxuICAgIGZtdDogcGFydHMuc2xpY2UoMykuam9pbignICcpLFxuICB9O1xufTtcblxuU0RQVXRpbHMucGFyc2VPTGluZSA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbikge1xuICBjb25zdCBsaW5lID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnbz0nKVswXTtcbiAgY29uc3QgcGFydHMgPSBsaW5lLnN1YnN0cigyKS5zcGxpdCgnICcpO1xuICByZXR1cm4ge1xuICAgIHVzZXJuYW1lOiBwYXJ0c1swXSxcbiAgICBzZXNzaW9uSWQ6IHBhcnRzWzFdLFxuICAgIHNlc3Npb25WZXJzaW9uOiBwYXJzZUludChwYXJ0c1syXSwgMTApLFxuICAgIG5ldFR5cGU6IHBhcnRzWzNdLFxuICAgIGFkZHJlc3NUeXBlOiBwYXJ0c1s0XSxcbiAgICBhZGRyZXNzOiBwYXJ0c1s1XSxcbiAgfTtcbn07XG5cbi8vIGEgdmVyeSBuYWl2ZSBpbnRlcnByZXRhdGlvbiBvZiBhIHZhbGlkIFNEUC5cblNEUFV0aWxzLmlzVmFsaWRTRFAgPSBmdW5jdGlvbihibG9iKSB7XG4gIGlmICh0eXBlb2YgYmxvYiAhPT0gJ3N0cmluZycgfHwgYmxvYi5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgY29uc3QgbGluZXMgPSBTRFBVdGlscy5zcGxpdExpbmVzKGJsb2IpO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGxpbmVzLmxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKGxpbmVzW2ldLmxlbmd0aCA8IDIgfHwgbGluZXNbaV0uY2hhckF0KDEpICE9PSAnPScpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgLy8gVE9ETzogY2hlY2sgdGhlIG1vZGlmaWVyIGEgYml0IG1vcmUuXG4gIH1cbiAgcmV0dXJuIHRydWU7XG59O1xuXG4vLyBFeHBvc2UgcHVibGljIG1ldGhvZHMuXG5pZiAodHlwZW9mIG1vZHVsZSA9PT0gJ29iamVjdCcpIHtcbiAgbW9kdWxlLmV4cG9ydHMgPSBTRFBVdGlscztcbn1cbiIsInZhciBtaiA9IHJlcXVpcmUoXCJtaW5pamFudXNcIik7XG5tai5KYW51c1Nlc3Npb24ucHJvdG90eXBlLnNlbmRPcmlnaW5hbCA9IG1qLkphbnVzU2Vzc2lvbi5wcm90b3R5cGUuc2VuZDtcbm1qLkphbnVzU2Vzc2lvbi5wcm90b3R5cGUuc2VuZCA9IGZ1bmN0aW9uKHR5cGUsIHNpZ25hbCkge1xuICByZXR1cm4gdGhpcy5zZW5kT3JpZ2luYWwodHlwZSwgc2lnbmFsKS5jYXRjaCgoZSkgPT4ge1xuICAgIGlmIChlLm1lc3NhZ2UgJiYgZS5tZXNzYWdlLmluZGV4T2YoXCJ0aW1lZCBvdXRcIikgPiAtMSkge1xuICAgICAgY29uc29sZS5lcnJvcihcIndlYiBzb2NrZXQgdGltZWQgb3V0XCIpO1xuICAgICAgTkFGLmNvbm5lY3Rpb24uYWRhcHRlci5yZWNvbm5lY3QoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3coZSk7XG4gICAgfVxuICB9KTtcbn1cblxudmFyIHNkcFV0aWxzID0gcmVxdWlyZShcInNkcFwiKTtcbnZhciBkZWJ1ZyA9IHJlcXVpcmUoXCJkZWJ1Z1wiKShcIm5hZi1qYW51cy1hZGFwdGVyOmRlYnVnXCIpO1xudmFyIHdhcm4gPSByZXF1aXJlKFwiZGVidWdcIikoXCJuYWYtamFudXMtYWRhcHRlcjp3YXJuXCIpO1xudmFyIGVycm9yID0gcmVxdWlyZShcImRlYnVnXCIpKFwibmFmLWphbnVzLWFkYXB0ZXI6ZXJyb3JcIik7XG52YXIgaXNTYWZhcmkgPSAvXigoPyFjaHJvbWV8YW5kcm9pZCkuKSpzYWZhcmkvaS50ZXN0KG5hdmlnYXRvci51c2VyQWdlbnQpO1xuXG5jb25zdCBTVUJTQ1JJQkVfVElNRU9VVF9NUyA9IDE1MDAwO1xuXG5jb25zdCBBVkFJTEFCTEVfT0NDVVBBTlRTX1RIUkVTSE9MRCA9IDU7XG5jb25zdCBNQVhfU1VCU0NSSUJFX0RFTEFZID0gNTAwMDtcblxuZnVuY3Rpb24gcmFuZG9tRGVsYXkobWluLCBtYXgpIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKHJlc29sdmUgPT4ge1xuICAgIGNvbnN0IGRlbGF5ID0gTWF0aC5yYW5kb20oKSAqIChtYXggLSBtaW4pICsgbWluO1xuICAgIHNldFRpbWVvdXQocmVzb2x2ZSwgZGVsYXkpO1xuICB9KTtcbn1cblxuZnVuY3Rpb24gZGVib3VuY2UoZm4pIHtcbiAgdmFyIGN1cnIgPSBQcm9taXNlLnJlc29sdmUoKTtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciBhcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzKTtcbiAgICBjdXJyID0gY3Vyci50aGVuKF8gPT4gZm4uYXBwbHkodGhpcywgYXJncykpO1xuICB9O1xufVxuXG5mdW5jdGlvbiByYW5kb21VaW50KCkge1xuICByZXR1cm4gTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogTnVtYmVyLk1BWF9TQUZFX0lOVEVHRVIpO1xufVxuXG5mdW5jdGlvbiB1bnRpbERhdGFDaGFubmVsT3BlbihkYXRhQ2hhbm5lbCkge1xuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIGlmIChkYXRhQ2hhbm5lbC5yZWFkeVN0YXRlID09PSBcIm9wZW5cIikge1xuICAgICAgcmVzb2x2ZSgpO1xuICAgIH0gZWxzZSB7XG4gICAgICBsZXQgcmVzb2x2ZXIsIHJlamVjdG9yO1xuXG4gICAgICBjb25zdCBjbGVhciA9ICgpID0+IHtcbiAgICAgICAgZGF0YUNoYW5uZWwucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm9wZW5cIiwgcmVzb2x2ZXIpO1xuICAgICAgICBkYXRhQ2hhbm5lbC5yZW1vdmVFdmVudExpc3RlbmVyKFwiZXJyb3JcIiwgcmVqZWN0b3IpO1xuICAgICAgfTtcblxuICAgICAgcmVzb2x2ZXIgPSAoKSA9PiB7XG4gICAgICAgIGNsZWFyKCk7XG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH07XG4gICAgICByZWplY3RvciA9ICgpID0+IHtcbiAgICAgICAgY2xlYXIoKTtcbiAgICAgICAgcmVqZWN0KCk7XG4gICAgICB9O1xuXG4gICAgICBkYXRhQ2hhbm5lbC5hZGRFdmVudExpc3RlbmVyKFwib3BlblwiLCByZXNvbHZlcik7XG4gICAgICBkYXRhQ2hhbm5lbC5hZGRFdmVudExpc3RlbmVyKFwiZXJyb3JcIiwgcmVqZWN0b3IpO1xuICAgIH1cbiAgfSk7XG59XG5cbmNvbnN0IGlzSDI2NFZpZGVvU3VwcG9ydGVkID0gKCgpID0+IHtcbiAgY29uc3QgdmlkZW8gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwidmlkZW9cIik7XG4gIHJldHVybiB2aWRlby5jYW5QbGF5VHlwZSgndmlkZW8vbXA0OyBjb2RlY3M9XCJhdmMxLjQyRTAxRSwgbXA0YS40MC4yXCInKSAhPT0gXCJcIjtcbn0pKCk7XG5cbmNvbnN0IE9QVVNfUEFSQU1FVEVSUyA9IHtcbiAgLy8gaW5kaWNhdGVzIHRoYXQgd2Ugd2FudCB0byBlbmFibGUgRFRYIHRvIGVsaWRlIHNpbGVuY2UgcGFja2V0c1xuICB1c2VkdHg6IDEsXG4gIC8vIGluZGljYXRlcyB0aGF0IHdlIHByZWZlciB0byByZWNlaXZlIG1vbm8gYXVkaW8gKGltcG9ydGFudCBmb3Igdm9pcCBwcm9maWxlKVxuICBzdGVyZW86IDAsXG4gIC8vIGluZGljYXRlcyB0aGF0IHdlIHByZWZlciB0byBzZW5kIG1vbm8gYXVkaW8gKGltcG9ydGFudCBmb3Igdm9pcCBwcm9maWxlKVxuICBcInNwcm9wLXN0ZXJlb1wiOiAwXG59O1xuXG5jb25zdCBERUZBVUxUX1BFRVJfQ09OTkVDVElPTl9DT05GSUcgPSB7XG4gIGljZVNlcnZlcnM6IFt7IHVybHM6IFwic3R1bjpzdHVuMS5sLmdvb2dsZS5jb206MTkzMDJcIiB9LCB7IHVybHM6IFwic3R1bjpzdHVuMi5sLmdvb2dsZS5jb206MTkzMDJcIiB9XVxufTtcblxuY29uc3QgV1NfTk9STUFMX0NMT1NVUkUgPSAxMDAwO1xuXG5jbGFzcyBKYW51c0FkYXB0ZXIge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICB0aGlzLnJvb20gPSBudWxsO1xuICAgIC8vIFdlIGV4cGVjdCB0aGUgY29uc3VtZXIgdG8gc2V0IGEgY2xpZW50IGlkIGJlZm9yZSBjb25uZWN0aW5nLlxuICAgIHRoaXMuY2xpZW50SWQgPSBudWxsO1xuICAgIHRoaXMuam9pblRva2VuID0gbnVsbDtcblxuICAgIHRoaXMuc2VydmVyVXJsID0gbnVsbDtcbiAgICB0aGlzLndlYlJ0Y09wdGlvbnMgPSB7fTtcbiAgICB0aGlzLnBlZXJDb25uZWN0aW9uQ29uZmlnID0gbnVsbDtcbiAgICB0aGlzLndzID0gbnVsbDtcbiAgICB0aGlzLnNlc3Npb24gPSBudWxsO1xuICAgIHRoaXMucmVsaWFibGVUcmFuc3BvcnQgPSBcImRhdGFjaGFubmVsXCI7XG4gICAgdGhpcy51bnJlbGlhYmxlVHJhbnNwb3J0ID0gXCJkYXRhY2hhbm5lbFwiO1xuXG4gICAgLy8gSW4gdGhlIGV2ZW50IHRoZSBzZXJ2ZXIgcmVzdGFydHMgYW5kIGFsbCBjbGllbnRzIGxvc2UgY29ubmVjdGlvbiwgcmVjb25uZWN0IHdpdGhcbiAgICAvLyBzb21lIHJhbmRvbSBqaXR0ZXIgYWRkZWQgdG8gcHJldmVudCBzaW11bHRhbmVvdXMgcmVjb25uZWN0aW9uIHJlcXVlc3RzLlxuICAgIHRoaXMuaW5pdGlhbFJlY29ubmVjdGlvbkRlbGF5ID0gMTAwMCAqIE1hdGgucmFuZG9tKCk7XG4gICAgdGhpcy5yZWNvbm5lY3Rpb25EZWxheSA9IHRoaXMuaW5pdGlhbFJlY29ubmVjdGlvbkRlbGF5O1xuICAgIHRoaXMucmVjb25uZWN0aW9uVGltZW91dCA9IG51bGw7XG4gICAgdGhpcy5tYXhSZWNvbm5lY3Rpb25BdHRlbXB0cyA9IDEwO1xuICAgIHRoaXMucmVjb25uZWN0aW9uQXR0ZW1wdHMgPSAwO1xuXG4gICAgdGhpcy5wdWJsaXNoZXIgPSBudWxsO1xuICAgIHRoaXMub2NjdXBhbnRJZHMgPSBbXTtcbiAgICB0aGlzLm9jY3VwYW50cyA9IHt9O1xuICAgIHRoaXMubWVkaWFTdHJlYW1zID0ge307XG4gICAgdGhpcy5sb2NhbE1lZGlhU3RyZWFtID0gbnVsbDtcbiAgICB0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzID0gbmV3IE1hcCgpO1xuXG4gICAgdGhpcy5wZW5kaW5nT2NjdXBhbnRzID0gbmV3IFNldCgpO1xuICAgIHRoaXMuYXZhaWxhYmxlT2NjdXBhbnRzID0gW107XG4gICAgdGhpcy5yZXF1ZXN0ZWRPY2N1cGFudHMgPSBudWxsO1xuXG4gICAgdGhpcy5ibG9ja2VkQ2xpZW50cyA9IG5ldyBNYXAoKTtcbiAgICB0aGlzLmZyb3plblVwZGF0ZXMgPSBuZXcgTWFwKCk7XG5cbiAgICB0aGlzLnRpbWVPZmZzZXRzID0gW107XG4gICAgdGhpcy5zZXJ2ZXJUaW1lUmVxdWVzdHMgPSAwO1xuICAgIHRoaXMuYXZnVGltZU9mZnNldCA9IDA7XG5cbiAgICB0aGlzLm9uV2Vic29ja2V0T3BlbiA9IHRoaXMub25XZWJzb2NrZXRPcGVuLmJpbmQodGhpcyk7XG4gICAgdGhpcy5vbldlYnNvY2tldENsb3NlID0gdGhpcy5vbldlYnNvY2tldENsb3NlLmJpbmQodGhpcyk7XG4gICAgdGhpcy5vbldlYnNvY2tldE1lc3NhZ2UgPSB0aGlzLm9uV2Vic29ja2V0TWVzc2FnZS5iaW5kKHRoaXMpO1xuICAgIHRoaXMub25EYXRhQ2hhbm5lbE1lc3NhZ2UgPSB0aGlzLm9uRGF0YUNoYW5uZWxNZXNzYWdlLmJpbmQodGhpcyk7XG4gICAgdGhpcy5vbkRhdGEgPSB0aGlzLm9uRGF0YS5iaW5kKHRoaXMpO1xuICB9XG5cbiAgc2V0U2VydmVyVXJsKHVybCkge1xuICAgIHRoaXMuc2VydmVyVXJsID0gdXJsO1xuICB9XG5cbiAgc2V0QXBwKGFwcCkge31cblxuICBzZXRSb29tKHJvb21OYW1lKSB7XG4gICAgdGhpcy5yb29tID0gcm9vbU5hbWU7XG4gIH1cblxuICBzZXRKb2luVG9rZW4oam9pblRva2VuKSB7XG4gICAgdGhpcy5qb2luVG9rZW4gPSBqb2luVG9rZW47XG4gIH1cblxuICBzZXRDbGllbnRJZChjbGllbnRJZCkge1xuICAgIHRoaXMuY2xpZW50SWQgPSBjbGllbnRJZDtcbiAgfVxuXG4gIHNldFdlYlJ0Y09wdGlvbnMob3B0aW9ucykge1xuICAgIHRoaXMud2ViUnRjT3B0aW9ucyA9IG9wdGlvbnM7XG4gIH1cblxuICBzZXRQZWVyQ29ubmVjdGlvbkNvbmZpZyhwZWVyQ29ubmVjdGlvbkNvbmZpZykge1xuICAgIHRoaXMucGVlckNvbm5lY3Rpb25Db25maWcgPSBwZWVyQ29ubmVjdGlvbkNvbmZpZztcbiAgfVxuXG4gIHNldFNlcnZlckNvbm5lY3RMaXN0ZW5lcnMoc3VjY2Vzc0xpc3RlbmVyLCBmYWlsdXJlTGlzdGVuZXIpIHtcbiAgICB0aGlzLmNvbm5lY3RTdWNjZXNzID0gc3VjY2Vzc0xpc3RlbmVyO1xuICAgIHRoaXMuY29ubmVjdEZhaWx1cmUgPSBmYWlsdXJlTGlzdGVuZXI7XG4gIH1cblxuICBzZXRSb29tT2NjdXBhbnRMaXN0ZW5lcihvY2N1cGFudExpc3RlbmVyKSB7XG4gICAgdGhpcy5vbk9jY3VwYW50c0NoYW5nZWQgPSBvY2N1cGFudExpc3RlbmVyO1xuICB9XG5cbiAgc2V0RGF0YUNoYW5uZWxMaXN0ZW5lcnMob3Blbkxpc3RlbmVyLCBjbG9zZWRMaXN0ZW5lciwgbWVzc2FnZUxpc3RlbmVyKSB7XG4gICAgdGhpcy5vbk9jY3VwYW50Q29ubmVjdGVkID0gb3Blbkxpc3RlbmVyO1xuICAgIHRoaXMub25PY2N1cGFudERpc2Nvbm5lY3RlZCA9IGNsb3NlZExpc3RlbmVyO1xuICAgIHRoaXMub25PY2N1cGFudE1lc3NhZ2UgPSBtZXNzYWdlTGlzdGVuZXI7XG4gIH1cblxuICBzZXRSZWNvbm5lY3Rpb25MaXN0ZW5lcnMocmVjb25uZWN0aW5nTGlzdGVuZXIsIHJlY29ubmVjdGVkTGlzdGVuZXIsIHJlY29ubmVjdGlvbkVycm9yTGlzdGVuZXIpIHtcbiAgICAvLyBvblJlY29ubmVjdGluZyBpcyBjYWxsZWQgd2l0aCB0aGUgbnVtYmVyIG9mIG1pbGxpc2Vjb25kcyB1bnRpbCB0aGUgbmV4dCByZWNvbm5lY3Rpb24gYXR0ZW1wdFxuICAgIHRoaXMub25SZWNvbm5lY3RpbmcgPSByZWNvbm5lY3RpbmdMaXN0ZW5lcjtcbiAgICAvLyBvblJlY29ubmVjdGVkIGlzIGNhbGxlZCB3aGVuIHRoZSBjb25uZWN0aW9uIGhhcyBiZWVuIHJlZXN0YWJsaXNoZWRcbiAgICB0aGlzLm9uUmVjb25uZWN0ZWQgPSByZWNvbm5lY3RlZExpc3RlbmVyO1xuICAgIC8vIG9uUmVjb25uZWN0aW9uRXJyb3IgaXMgY2FsbGVkIHdpdGggYW4gZXJyb3Igd2hlbiBtYXhSZWNvbm5lY3Rpb25BdHRlbXB0cyBoYXMgYmVlbiByZWFjaGVkXG4gICAgdGhpcy5vblJlY29ubmVjdGlvbkVycm9yID0gcmVjb25uZWN0aW9uRXJyb3JMaXN0ZW5lcjtcbiAgfVxuXG4gIGNvbm5lY3QoKSB7XG4gICAgZGVidWcoYGNvbm5lY3RpbmcgdG8gJHt0aGlzLnNlcnZlclVybH1gKTtcblxuICAgIGNvbnN0IHdlYnNvY2tldENvbm5lY3Rpb24gPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICB0aGlzLndzID0gbmV3IFdlYlNvY2tldCh0aGlzLnNlcnZlclVybCwgXCJqYW51cy1wcm90b2NvbFwiKTtcblxuICAgICAgdGhpcy5zZXNzaW9uID0gbmV3IG1qLkphbnVzU2Vzc2lvbih0aGlzLndzLnNlbmQuYmluZCh0aGlzLndzKSwgeyB0aW1lb3V0TXM6IDQwMDAwIH0pO1xuXG4gICAgICB0aGlzLndzLmFkZEV2ZW50TGlzdGVuZXIoXCJjbG9zZVwiLCB0aGlzLm9uV2Vic29ja2V0Q2xvc2UpO1xuICAgICAgdGhpcy53cy5hZGRFdmVudExpc3RlbmVyKFwibWVzc2FnZVwiLCB0aGlzLm9uV2Vic29ja2V0TWVzc2FnZSk7XG5cbiAgICAgIHRoaXMud3NPbk9wZW4gPSAoKSA9PiB7XG4gICAgICAgIHRoaXMud3MucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm9wZW5cIiwgdGhpcy53c09uT3Blbik7XG4gICAgICAgIHRoaXMub25XZWJzb2NrZXRPcGVuKClcbiAgICAgICAgICAudGhlbihyZXNvbHZlKVxuICAgICAgICAgIC5jYXRjaChyZWplY3QpO1xuICAgICAgfTtcblxuICAgICAgdGhpcy53cy5hZGRFdmVudExpc3RlbmVyKFwib3BlblwiLCB0aGlzLndzT25PcGVuKTtcbiAgICB9KTtcblxuICAgIHJldHVybiBQcm9taXNlLmFsbChbd2Vic29ja2V0Q29ubmVjdGlvbiwgdGhpcy51cGRhdGVUaW1lT2Zmc2V0KCldKTtcbiAgfVxuXG4gIGRpc2Nvbm5lY3QoKSB7XG4gICAgZGVidWcoYGRpc2Nvbm5lY3RpbmdgKTtcblxuICAgIGNsZWFyVGltZW91dCh0aGlzLnJlY29ubmVjdGlvblRpbWVvdXQpO1xuXG4gICAgdGhpcy5yZW1vdmVBbGxPY2N1cGFudHMoKTtcblxuICAgIGlmICh0aGlzLnB1Ymxpc2hlcikge1xuICAgICAgLy8gQ2xvc2UgdGhlIHB1Ymxpc2hlciBwZWVyIGNvbm5lY3Rpb24uIFdoaWNoIGFsc28gZGV0YWNoZXMgdGhlIHBsdWdpbiBoYW5kbGUuXG4gICAgICB0aGlzLnB1Ymxpc2hlci5jb25uLmNsb3NlKCk7XG4gICAgICB0aGlzLnB1Ymxpc2hlciA9IG51bGw7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuc2Vzc2lvbikge1xuICAgICAgdGhpcy5zZXNzaW9uLmRpc3Bvc2UoKTtcbiAgICAgIHRoaXMuc2Vzc2lvbiA9IG51bGw7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMud3MpIHtcbiAgICAgIHRoaXMud3MucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm9wZW5cIiwgdGhpcy53c09uT3Blbik7XG4gICAgICB0aGlzLndzLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJjbG9zZVwiLCB0aGlzLm9uV2Vic29ja2V0Q2xvc2UpO1xuICAgICAgdGhpcy53cy5yZW1vdmVFdmVudExpc3RlbmVyKFwibWVzc2FnZVwiLCB0aGlzLm9uV2Vic29ja2V0TWVzc2FnZSk7XG4gICAgICB0aGlzLndzLmNsb3NlKCk7XG4gICAgICB0aGlzLndzID0gbnVsbDtcbiAgICB9XG5cbiAgICAvLyBOb3cgdGhhdCBhbGwgUlRDUGVlckNvbm5lY3Rpb24gY2xvc2VkLCBiZSBzdXJlIHRvIG5vdCBjYWxsXG4gICAgLy8gcmVjb25uZWN0KCkgYWdhaW4gdmlhIHBlcmZvcm1EZWxheWVkUmVjb25uZWN0IGlmIHByZXZpb3VzXG4gICAgLy8gUlRDUGVlckNvbm5lY3Rpb24gd2FzIGluIHRoZSBmYWlsZWQgc3RhdGUuXG4gICAgaWYgKHRoaXMuZGVsYXllZFJlY29ubmVjdFRpbWVvdXQpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLmRlbGF5ZWRSZWNvbm5lY3RUaW1lb3V0KTtcbiAgICAgIHRoaXMuZGVsYXllZFJlY29ubmVjdFRpbWVvdXQgPSBudWxsO1xuICAgIH1cbiAgfVxuXG4gIGlzRGlzY29ubmVjdGVkKCkge1xuICAgIHJldHVybiB0aGlzLndzID09PSBudWxsO1xuICB9XG5cbiAgYXN5bmMgb25XZWJzb2NrZXRPcGVuKCkge1xuICAgIC8vIENyZWF0ZSB0aGUgSmFudXMgU2Vzc2lvblxuICAgIGF3YWl0IHRoaXMuc2Vzc2lvbi5jcmVhdGUoKTtcblxuICAgIC8vIEF0dGFjaCB0aGUgU0ZVIFBsdWdpbiBhbmQgY3JlYXRlIGEgUlRDUGVlckNvbm5lY3Rpb24gZm9yIHRoZSBwdWJsaXNoZXIuXG4gICAgLy8gVGhlIHB1Ymxpc2hlciBzZW5kcyBhdWRpbyBhbmQgb3BlbnMgdHdvIGJpZGlyZWN0aW9uYWwgZGF0YSBjaGFubmVscy5cbiAgICAvLyBPbmUgcmVsaWFibGUgZGF0YWNoYW5uZWwgYW5kIG9uZSB1bnJlbGlhYmxlLlxuICAgIHRoaXMucHVibGlzaGVyID0gYXdhaXQgdGhpcy5jcmVhdGVQdWJsaXNoZXIoKTtcblxuICAgIC8vIENhbGwgdGhlIG5hZiBjb25uZWN0U3VjY2VzcyBjYWxsYmFjayBiZWZvcmUgd2Ugc3RhcnQgcmVjZWl2aW5nIFdlYlJUQyBtZXNzYWdlcy5cbiAgICB0aGlzLmNvbm5lY3RTdWNjZXNzKHRoaXMuY2xpZW50SWQpO1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aGlzLnB1Ymxpc2hlci5pbml0aWFsT2NjdXBhbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBjb25zdCBvY2N1cGFudElkID0gdGhpcy5wdWJsaXNoZXIuaW5pdGlhbE9jY3VwYW50c1tpXTtcbiAgICAgIGlmIChvY2N1cGFudElkID09PSB0aGlzLmNsaWVudElkKSBjb250aW51ZTsgLy8gSGFwcGVucyBkdXJpbmcgbm9uLWdyYWNlZnVsIHJlY29ubmVjdHMgZHVlIHRvIHpvbWJpZSBzZXNzaW9uc1xuICAgICAgdGhpcy5hZGRBdmFpbGFibGVPY2N1cGFudChvY2N1cGFudElkKTtcbiAgICB9XG5cbiAgICB0aGlzLnN5bmNPY2N1cGFudHMoKTtcbiAgfVxuXG4gIG9uV2Vic29ja2V0Q2xvc2UoZXZlbnQpIHtcbiAgICAvLyBUaGUgY29ubmVjdGlvbiB3YXMgY2xvc2VkIHN1Y2Nlc3NmdWxseS4gRG9uJ3QgdHJ5IHRvIHJlY29ubmVjdC5cbiAgICBpZiAoZXZlbnQuY29kZSA9PT0gV1NfTk9STUFMX0NMT1NVUkUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zb2xlLndhcm4oXCJKYW51cyB3ZWJzb2NrZXQgY2xvc2VkIHVuZXhwZWN0ZWRseS5cIik7XG4gICAgaWYgKHRoaXMub25SZWNvbm5lY3RpbmcpIHtcbiAgICAgIHRoaXMub25SZWNvbm5lY3RpbmcodGhpcy5yZWNvbm5lY3Rpb25EZWxheSk7XG4gICAgfVxuXG4gICAgdGhpcy5yZWNvbm5lY3Rpb25UaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB0aGlzLnJlY29ubmVjdCgpLCB0aGlzLnJlY29ubmVjdGlvbkRlbGF5KTtcbiAgfVxuXG4gIHJlY29ubmVjdCgpIHtcbiAgICAvLyBEaXNwb3NlIG9mIGFsbCBuZXR3b3JrZWQgZW50aXRpZXMgYW5kIG90aGVyIHJlc291cmNlcyB0aWVkIHRvIHRoZSBzZXNzaW9uLlxuICAgIHRoaXMuZGlzY29ubmVjdCgpO1xuXG4gICAgdGhpcy5jb25uZWN0KClcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgdGhpcy5yZWNvbm5lY3Rpb25EZWxheSA9IHRoaXMuaW5pdGlhbFJlY29ubmVjdGlvbkRlbGF5O1xuICAgICAgICB0aGlzLnJlY29ubmVjdGlvbkF0dGVtcHRzID0gMDtcblxuICAgICAgICBpZiAodGhpcy5vblJlY29ubmVjdGVkKSB7XG4gICAgICAgICAgdGhpcy5vblJlY29ubmVjdGVkKCk7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICB0aGlzLnJlY29ubmVjdGlvbkRlbGF5ICs9IDEwMDA7XG4gICAgICAgIHRoaXMucmVjb25uZWN0aW9uQXR0ZW1wdHMrKztcblxuICAgICAgICBpZiAodGhpcy5yZWNvbm5lY3Rpb25BdHRlbXB0cyA+IHRoaXMubWF4UmVjb25uZWN0aW9uQXR0ZW1wdHMgJiYgdGhpcy5vblJlY29ubmVjdGlvbkVycm9yKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMub25SZWNvbm5lY3Rpb25FcnJvcihcbiAgICAgICAgICAgIG5ldyBFcnJvcihcIkNvbm5lY3Rpb24gY291bGQgbm90IGJlIHJlZXN0YWJsaXNoZWQsIGV4Y2VlZGVkIG1heGltdW0gbnVtYmVyIG9mIHJlY29ubmVjdGlvbiBhdHRlbXB0cy5cIilcbiAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc29sZS53YXJuKFwiRXJyb3IgZHVyaW5nIHJlY29ubmVjdCwgcmV0cnlpbmcuXCIpO1xuICAgICAgICBjb25zb2xlLndhcm4oZXJyb3IpO1xuXG4gICAgICAgIGlmICh0aGlzLm9uUmVjb25uZWN0aW5nKSB7XG4gICAgICAgICAgdGhpcy5vblJlY29ubmVjdGluZyh0aGlzLnJlY29ubmVjdGlvbkRlbGF5KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMucmVjb25uZWN0aW9uVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4gdGhpcy5yZWNvbm5lY3QoKSwgdGhpcy5yZWNvbm5lY3Rpb25EZWxheSk7XG4gICAgICB9KTtcbiAgfVxuXG4gIHBlcmZvcm1EZWxheWVkUmVjb25uZWN0KCkge1xuICAgIGlmICh0aGlzLmRlbGF5ZWRSZWNvbm5lY3RUaW1lb3V0KSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5kZWxheWVkUmVjb25uZWN0VGltZW91dCk7XG4gICAgfVxuXG4gICAgdGhpcy5kZWxheWVkUmVjb25uZWN0VGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy5kZWxheWVkUmVjb25uZWN0VGltZW91dCA9IG51bGw7XG4gICAgICB0aGlzLnJlY29ubmVjdCgpO1xuICAgIH0sIDEwMDAwKTtcbiAgfVxuXG4gIG9uV2Vic29ja2V0TWVzc2FnZShldmVudCkge1xuICAgIHRoaXMuc2Vzc2lvbi5yZWNlaXZlKEpTT04ucGFyc2UoZXZlbnQuZGF0YSkpO1xuICB9XG5cbiAgYWRkQXZhaWxhYmxlT2NjdXBhbnQob2NjdXBhbnRJZCkge1xuICAgIGlmICh0aGlzLmF2YWlsYWJsZU9jY3VwYW50cy5pbmRleE9mKG9jY3VwYW50SWQpID09PSAtMSkge1xuICAgICAgdGhpcy5hdmFpbGFibGVPY2N1cGFudHMucHVzaChvY2N1cGFudElkKTtcbiAgICB9XG4gIH1cblxuICByZW1vdmVBdmFpbGFibGVPY2N1cGFudChvY2N1cGFudElkKSB7XG4gICAgY29uc3QgaWR4ID0gdGhpcy5hdmFpbGFibGVPY2N1cGFudHMuaW5kZXhPZihvY2N1cGFudElkKTtcbiAgICBpZiAoaWR4ICE9PSAtMSkge1xuICAgICAgdGhpcy5hdmFpbGFibGVPY2N1cGFudHMuc3BsaWNlKGlkeCwgMSk7XG4gICAgfVxuICB9XG5cbiAgc3luY09jY3VwYW50cyhyZXF1ZXN0ZWRPY2N1cGFudHMpIHtcbiAgICBpZiAocmVxdWVzdGVkT2NjdXBhbnRzKSB7XG4gICAgICB0aGlzLnJlcXVlc3RlZE9jY3VwYW50cyA9IHJlcXVlc3RlZE9jY3VwYW50cztcbiAgICB9XG5cbiAgICBpZiAoIXRoaXMucmVxdWVzdGVkT2NjdXBhbnRzKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gQWRkIGFueSByZXF1ZXN0ZWQsIGF2YWlsYWJsZSwgYW5kIG5vbi1wZW5kaW5nIG9jY3VwYW50cy5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRoaXMucmVxdWVzdGVkT2NjdXBhbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBjb25zdCBvY2N1cGFudElkID0gdGhpcy5yZXF1ZXN0ZWRPY2N1cGFudHNbaV07XG4gICAgICBpZiAoIXRoaXMub2NjdXBhbnRzW29jY3VwYW50SWRdICYmIHRoaXMuYXZhaWxhYmxlT2NjdXBhbnRzLmluZGV4T2Yob2NjdXBhbnRJZCkgIT09IC0xICYmICF0aGlzLnBlbmRpbmdPY2N1cGFudHMuaGFzKG9jY3VwYW50SWQpKSB7XG4gICAgICAgIHRoaXMuYWRkT2NjdXBhbnQob2NjdXBhbnRJZCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gUmVtb3ZlIGFueSB1bnJlcXVlc3RlZCBhbmQgY3VycmVudGx5IGFkZGVkIG9jY3VwYW50cy5cbiAgICBmb3IgKGxldCBqID0gMDsgaiA8IHRoaXMuYXZhaWxhYmxlT2NjdXBhbnRzLmxlbmd0aDsgaisrKSB7XG4gICAgICBjb25zdCBvY2N1cGFudElkID0gdGhpcy5hdmFpbGFibGVPY2N1cGFudHNbal07XG4gICAgICBpZiAodGhpcy5vY2N1cGFudHNbb2NjdXBhbnRJZF0gJiYgdGhpcy5yZXF1ZXN0ZWRPY2N1cGFudHMuaW5kZXhPZihvY2N1cGFudElkKSA9PT0gLTEpIHtcbiAgICAgICAgdGhpcy5yZW1vdmVPY2N1cGFudChvY2N1cGFudElkKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBDYWxsIHRoZSBOZXR3b3JrZWQgQUZyYW1lIGNhbGxiYWNrcyBmb3IgdGhlIHVwZGF0ZWQgb2NjdXBhbnRzIGxpc3QuXG4gICAgdGhpcy5vbk9jY3VwYW50c0NoYW5nZWQodGhpcy5vY2N1cGFudHMpO1xuICB9XG5cbiAgYXN5bmMgYWRkT2NjdXBhbnQob2NjdXBhbnRJZCkge1xuICAgIHRoaXMucGVuZGluZ09jY3VwYW50cy5hZGQob2NjdXBhbnRJZCk7XG4gICAgXG4gICAgY29uc3QgYXZhaWxhYmxlT2NjdXBhbnRzQ291bnQgPSB0aGlzLmF2YWlsYWJsZU9jY3VwYW50cy5sZW5ndGg7XG4gICAgaWYgKGF2YWlsYWJsZU9jY3VwYW50c0NvdW50ID4gQVZBSUxBQkxFX09DQ1VQQU5UU19USFJFU0hPTEQpIHtcbiAgICAgIGF3YWl0IHJhbmRvbURlbGF5KDAsIE1BWF9TVUJTQ1JJQkVfREVMQVkpO1xuICAgIH1cbiAgXG4gICAgY29uc3Qgc3Vic2NyaWJlciA9IGF3YWl0IHRoaXMuY3JlYXRlU3Vic2NyaWJlcihvY2N1cGFudElkKTtcbiAgICBpZiAoc3Vic2NyaWJlcikge1xuICAgICAgaWYoIXRoaXMucGVuZGluZ09jY3VwYW50cy5oYXMob2NjdXBhbnRJZCkpIHtcbiAgICAgICAgc3Vic2NyaWJlci5jb25uLmNsb3NlKCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnBlbmRpbmdPY2N1cGFudHMuZGVsZXRlKG9jY3VwYW50SWQpO1xuICAgICAgICB0aGlzLm9jY3VwYW50SWRzLnB1c2gob2NjdXBhbnRJZCk7XG4gICAgICAgIHRoaXMub2NjdXBhbnRzW29jY3VwYW50SWRdID0gc3Vic2NyaWJlcjtcblxuICAgICAgICB0aGlzLnNldE1lZGlhU3RyZWFtKG9jY3VwYW50SWQsIHN1YnNjcmliZXIubWVkaWFTdHJlYW0pO1xuXG4gICAgICAgIC8vIENhbGwgdGhlIE5ldHdvcmtlZCBBRnJhbWUgY2FsbGJhY2tzIGZvciB0aGUgbmV3IG9jY3VwYW50LlxuICAgICAgICB0aGlzLm9uT2NjdXBhbnRDb25uZWN0ZWQob2NjdXBhbnRJZCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmVtb3ZlQWxsT2NjdXBhbnRzKCkge1xuICAgIHRoaXMucGVuZGluZ09jY3VwYW50cy5jbGVhcigpO1xuICAgIGZvciAobGV0IGkgPSB0aGlzLm9jY3VwYW50SWRzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICB0aGlzLnJlbW92ZU9jY3VwYW50KHRoaXMub2NjdXBhbnRJZHNbaV0pO1xuICAgIH1cbiAgfVxuXG4gIHJlbW92ZU9jY3VwYW50KG9jY3VwYW50SWQpIHtcbiAgICB0aGlzLnBlbmRpbmdPY2N1cGFudHMuZGVsZXRlKG9jY3VwYW50SWQpO1xuICAgIFxuICAgIGlmICh0aGlzLm9jY3VwYW50c1tvY2N1cGFudElkXSkge1xuICAgICAgLy8gQ2xvc2UgdGhlIHN1YnNjcmliZXIgcGVlciBjb25uZWN0aW9uLiBXaGljaCBhbHNvIGRldGFjaGVzIHRoZSBwbHVnaW4gaGFuZGxlLlxuICAgICAgdGhpcy5vY2N1cGFudHNbb2NjdXBhbnRJZF0uY29ubi5jbG9zZSgpO1xuICAgICAgZGVsZXRlIHRoaXMub2NjdXBhbnRzW29jY3VwYW50SWRdO1xuICAgICAgXG4gICAgICB0aGlzLm9jY3VwYW50SWRzLnNwbGljZSh0aGlzLm9jY3VwYW50SWRzLmluZGV4T2Yob2NjdXBhbnRJZCksIDEpO1xuICAgIH1cblxuICAgIGlmICh0aGlzLm1lZGlhU3RyZWFtc1tvY2N1cGFudElkXSkge1xuICAgICAgZGVsZXRlIHRoaXMubWVkaWFTdHJlYW1zW29jY3VwYW50SWRdO1xuICAgIH1cblxuICAgIGlmICh0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmhhcyhvY2N1cGFudElkKSkge1xuICAgICAgY29uc3QgbXNnID0gXCJUaGUgdXNlciBkaXNjb25uZWN0ZWQgYmVmb3JlIHRoZSBtZWRpYSBzdHJlYW0gd2FzIHJlc29sdmVkLlwiO1xuICAgICAgdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5nZXQob2NjdXBhbnRJZCkuYXVkaW8ucmVqZWN0KG1zZyk7XG4gICAgICB0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmdldChvY2N1cGFudElkKS52aWRlby5yZWplY3QobXNnKTtcbiAgICAgIHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuZGVsZXRlKG9jY3VwYW50SWQpO1xuICAgIH1cblxuICAgIC8vIENhbGwgdGhlIE5ldHdvcmtlZCBBRnJhbWUgY2FsbGJhY2tzIGZvciB0aGUgcmVtb3ZlZCBvY2N1cGFudC5cbiAgICB0aGlzLm9uT2NjdXBhbnREaXNjb25uZWN0ZWQob2NjdXBhbnRJZCk7XG4gIH1cblxuICBhc3NvY2lhdGUoY29ubiwgaGFuZGxlKSB7XG4gICAgY29ubi5hZGRFdmVudExpc3RlbmVyKFwiaWNlY2FuZGlkYXRlXCIsIGV2ID0+IHtcbiAgICAgIGhhbmRsZS5zZW5kVHJpY2tsZShldi5jYW5kaWRhdGUgfHwgbnVsbCkuY2F0Y2goZSA9PiBlcnJvcihcIkVycm9yIHRyaWNrbGluZyBJQ0U6ICVvXCIsIGUpKTtcbiAgICB9KTtcbiAgICBjb25uLmFkZEV2ZW50TGlzdGVuZXIoXCJpY2Vjb25uZWN0aW9uc3RhdGVjaGFuZ2VcIiwgZXYgPT4ge1xuICAgICAgaWYgKGNvbm4uaWNlQ29ubmVjdGlvblN0YXRlID09PSBcImNvbm5lY3RlZFwiKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKFwiSUNFIHN0YXRlIGNoYW5nZWQgdG8gY29ubmVjdGVkXCIpO1xuICAgICAgfVxuICAgICAgaWYgKGNvbm4uaWNlQ29ubmVjdGlvblN0YXRlID09PSBcImRpc2Nvbm5lY3RlZFwiKSB7XG4gICAgICAgIGNvbnNvbGUud2FybihcIklDRSBzdGF0ZSBjaGFuZ2VkIHRvIGRpc2Nvbm5lY3RlZFwiKTtcbiAgICAgIH1cbiAgICAgIGlmIChjb25uLmljZUNvbm5lY3Rpb25TdGF0ZSA9PT0gXCJmYWlsZWRcIikge1xuICAgICAgICBjb25zb2xlLndhcm4oXCJJQ0UgZmFpbHVyZSBkZXRlY3RlZC4gUmVjb25uZWN0aW5nIGluIDEwcy5cIik7XG4gICAgICAgIHRoaXMucGVyZm9ybURlbGF5ZWRSZWNvbm5lY3QoKTtcbiAgICAgIH1cbiAgICB9KVxuXG4gICAgLy8gd2UgaGF2ZSB0byBkZWJvdW5jZSB0aGVzZSBiZWNhdXNlIGphbnVzIGdldHMgYW5ncnkgaWYgeW91IHNlbmQgaXQgYSBuZXcgU0RQIGJlZm9yZVxuICAgIC8vIGl0J3MgZmluaXNoZWQgcHJvY2Vzc2luZyBhbiBleGlzdGluZyBTRFAuIGluIGFjdHVhbGl0eSwgaXQgc2VlbXMgbGlrZSB0aGlzIGlzIG1heWJlXG4gICAgLy8gdG9vIGxpYmVyYWwgYW5kIHdlIG5lZWQgdG8gd2FpdCBzb21lIGFtb3VudCBvZiB0aW1lIGFmdGVyIGFuIG9mZmVyIGJlZm9yZSBzZW5kaW5nIGFub3RoZXIsXG4gICAgLy8gYnV0IHdlIGRvbid0IGN1cnJlbnRseSBrbm93IGFueSBnb29kIHdheSBvZiBkZXRlY3RpbmcgZXhhY3RseSBob3cgbG9uZyA6KFxuICAgIGNvbm4uYWRkRXZlbnRMaXN0ZW5lcihcbiAgICAgIFwibmVnb3RpYXRpb25uZWVkZWRcIixcbiAgICAgIGRlYm91bmNlKGV2ID0+IHtcbiAgICAgICAgZGVidWcoXCJTZW5kaW5nIG5ldyBvZmZlciBmb3IgaGFuZGxlOiAlb1wiLCBoYW5kbGUpO1xuICAgICAgICB2YXIgb2ZmZXIgPSBjb25uLmNyZWF0ZU9mZmVyKCkudGhlbih0aGlzLmNvbmZpZ3VyZVB1Ymxpc2hlclNkcCkudGhlbih0aGlzLmZpeFNhZmFyaUljZVVGcmFnKTtcbiAgICAgICAgdmFyIGxvY2FsID0gb2ZmZXIudGhlbihvID0+IGNvbm4uc2V0TG9jYWxEZXNjcmlwdGlvbihvKSk7XG4gICAgICAgIHZhciByZW1vdGUgPSBvZmZlcjtcblxuICAgICAgICByZW1vdGUgPSByZW1vdGVcbiAgICAgICAgICAudGhlbih0aGlzLmZpeFNhZmFyaUljZVVGcmFnKVxuICAgICAgICAgIC50aGVuKGogPT4gaGFuZGxlLnNlbmRKc2VwKGopKVxuICAgICAgICAgIC50aGVuKHIgPT4gY29ubi5zZXRSZW1vdGVEZXNjcmlwdGlvbihyLmpzZXApKTtcbiAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKFtsb2NhbCwgcmVtb3RlXSkuY2F0Y2goZSA9PiBlcnJvcihcIkVycm9yIG5lZ290aWF0aW5nIG9mZmVyOiAlb1wiLCBlKSk7XG4gICAgICB9KVxuICAgICk7XG4gICAgaGFuZGxlLm9uKFxuICAgICAgXCJldmVudFwiLFxuICAgICAgZGVib3VuY2UoZXYgPT4ge1xuICAgICAgICB2YXIganNlcCA9IGV2LmpzZXA7XG4gICAgICAgIGlmIChqc2VwICYmIGpzZXAudHlwZSA9PSBcIm9mZmVyXCIpIHtcbiAgICAgICAgICBkZWJ1ZyhcIkFjY2VwdGluZyBuZXcgb2ZmZXIgZm9yIGhhbmRsZTogJW9cIiwgaGFuZGxlKTtcbiAgICAgICAgICB2YXIgYW5zd2VyID0gY29ublxuICAgICAgICAgICAgLnNldFJlbW90ZURlc2NyaXB0aW9uKHRoaXMuY29uZmlndXJlU3Vic2NyaWJlclNkcChqc2VwKSlcbiAgICAgICAgICAgIC50aGVuKF8gPT4gY29ubi5jcmVhdGVBbnN3ZXIoKSlcbiAgICAgICAgICAgIC50aGVuKHRoaXMuZml4U2FmYXJpSWNlVUZyYWcpO1xuICAgICAgICAgIHZhciBsb2NhbCA9IGFuc3dlci50aGVuKGEgPT4gY29ubi5zZXRMb2NhbERlc2NyaXB0aW9uKGEpKTtcbiAgICAgICAgICB2YXIgcmVtb3RlID0gYW5zd2VyLnRoZW4oaiA9PiBoYW5kbGUuc2VuZEpzZXAoaikpO1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLmFsbChbbG9jYWwsIHJlbW90ZV0pLmNhdGNoKGUgPT4gZXJyb3IoXCJFcnJvciBuZWdvdGlhdGluZyBhbnN3ZXI6ICVvXCIsIGUpKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBzb21lIG90aGVyIGtpbmQgb2YgZXZlbnQsIG5vdGhpbmcgdG8gZG9cbiAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICApO1xuICB9XG5cbiAgYXN5bmMgY3JlYXRlUHVibGlzaGVyKCkge1xuICAgIHZhciBoYW5kbGUgPSBuZXcgbWouSmFudXNQbHVnaW5IYW5kbGUodGhpcy5zZXNzaW9uKTtcbiAgICB2YXIgY29ubiA9IG5ldyBSVENQZWVyQ29ubmVjdGlvbih0aGlzLnBlZXJDb25uZWN0aW9uQ29uZmlnIHx8IERFRkFVTFRfUEVFUl9DT05ORUNUSU9OX0NPTkZJRyk7XG5cbiAgICBkZWJ1ZyhcInB1YiB3YWl0aW5nIGZvciBzZnVcIik7XG4gICAgYXdhaXQgaGFuZGxlLmF0dGFjaChcImphbnVzLnBsdWdpbi5zZnVcIik7XG5cbiAgICB0aGlzLmFzc29jaWF0ZShjb25uLCBoYW5kbGUpO1xuXG4gICAgZGVidWcoXCJwdWIgd2FpdGluZyBmb3IgZGF0YSBjaGFubmVscyAmIHdlYnJ0Y3VwXCIpO1xuICAgIHZhciB3ZWJydGN1cCA9IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gaGFuZGxlLm9uKFwid2VicnRjdXBcIiwgcmVzb2x2ZSkpO1xuXG4gICAgLy8gVW5yZWxpYWJsZSBkYXRhY2hhbm5lbDogc2VuZGluZyBhbmQgcmVjZWl2aW5nIGNvbXBvbmVudCB1cGRhdGVzLlxuICAgIC8vIFJlbGlhYmxlIGRhdGFjaGFubmVsOiBzZW5kaW5nIGFuZCByZWNpZXZpbmcgZW50aXR5IGluc3RhbnRpYXRpb25zLlxuICAgIHZhciByZWxpYWJsZUNoYW5uZWwgPSBjb25uLmNyZWF0ZURhdGFDaGFubmVsKFwicmVsaWFibGVcIiwgeyBvcmRlcmVkOiB0cnVlIH0pO1xuICAgIHZhciB1bnJlbGlhYmxlQ2hhbm5lbCA9IGNvbm4uY3JlYXRlRGF0YUNoYW5uZWwoXCJ1bnJlbGlhYmxlXCIsIHtcbiAgICAgIG9yZGVyZWQ6IGZhbHNlLFxuICAgICAgbWF4UmV0cmFuc21pdHM6IDBcbiAgICB9KTtcblxuICAgIHJlbGlhYmxlQ2hhbm5lbC5hZGRFdmVudExpc3RlbmVyKFwibWVzc2FnZVwiLCBlID0+IHRoaXMub25EYXRhQ2hhbm5lbE1lc3NhZ2UoZSwgXCJqYW51cy1yZWxpYWJsZVwiKSk7XG4gICAgdW5yZWxpYWJsZUNoYW5uZWwuYWRkRXZlbnRMaXN0ZW5lcihcIm1lc3NhZ2VcIiwgZSA9PiB0aGlzLm9uRGF0YUNoYW5uZWxNZXNzYWdlKGUsIFwiamFudXMtdW5yZWxpYWJsZVwiKSk7XG5cbiAgICBhd2FpdCB3ZWJydGN1cDtcbiAgICBhd2FpdCB1bnRpbERhdGFDaGFubmVsT3BlbihyZWxpYWJsZUNoYW5uZWwpO1xuICAgIGF3YWl0IHVudGlsRGF0YUNoYW5uZWxPcGVuKHVucmVsaWFibGVDaGFubmVsKTtcblxuICAgIC8vIGRvaW5nIHRoaXMgaGVyZSBpcyBzb3J0IG9mIGEgaGFjayBhcm91bmQgY2hyb21lIHJlbmVnb3RpYXRpb24gd2VpcmRuZXNzIC0tXG4gICAgLy8gaWYgd2UgZG8gaXQgcHJpb3IgdG8gd2VicnRjdXAsIGNocm9tZSBvbiBnZWFyIFZSIHdpbGwgc29tZXRpbWVzIHB1dCBhXG4gICAgLy8gcmVuZWdvdGlhdGlvbiBvZmZlciBpbiBmbGlnaHQgd2hpbGUgdGhlIGZpcnN0IG9mZmVyIHdhcyBzdGlsbCBiZWluZ1xuICAgIC8vIHByb2Nlc3NlZCBieSBqYW51cy4gd2Ugc2hvdWxkIGZpbmQgc29tZSBtb3JlIHByaW5jaXBsZWQgd2F5IHRvIGZpZ3VyZSBvdXRcbiAgICAvLyB3aGVuIGphbnVzIGlzIGRvbmUgaW4gdGhlIGZ1dHVyZS5cbiAgICBpZiAodGhpcy5sb2NhbE1lZGlhU3RyZWFtKSB7XG4gICAgICB0aGlzLmxvY2FsTWVkaWFTdHJlYW0uZ2V0VHJhY2tzKCkuZm9yRWFjaCh0cmFjayA9PiB7XG4gICAgICAgIGNvbm4uYWRkVHJhY2sodHJhY2ssIHRoaXMubG9jYWxNZWRpYVN0cmVhbSk7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBIYW5kbGUgYWxsIG9mIHRoZSBqb2luIGFuZCBsZWF2ZSBldmVudHMuXG4gICAgaGFuZGxlLm9uKFwiZXZlbnRcIiwgZXYgPT4ge1xuICAgICAgdmFyIGRhdGEgPSBldi5wbHVnaW5kYXRhLmRhdGE7XG4gICAgICBpZiAoZGF0YS5ldmVudCA9PSBcImpvaW5cIiAmJiBkYXRhLnJvb21faWQgPT0gdGhpcy5yb29tKSB7XG4gICAgICAgIGlmICh0aGlzLmRlbGF5ZWRSZWNvbm5lY3RUaW1lb3V0KSB7XG4gICAgICAgICAgLy8gRG9uJ3QgY3JlYXRlIGEgbmV3IFJUQ1BlZXJDb25uZWN0aW9uLCBhbGwgUlRDUGVlckNvbm5lY3Rpb24gd2lsbCBiZSBjbG9zZWQgaW4gbGVzcyB0aGFuIDEwcy5cbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5hZGRBdmFpbGFibGVPY2N1cGFudChkYXRhLnVzZXJfaWQpO1xuICAgICAgICB0aGlzLnN5bmNPY2N1cGFudHMoKTtcbiAgICAgIH0gZWxzZSBpZiAoZGF0YS5ldmVudCA9PSBcImxlYXZlXCIgJiYgZGF0YS5yb29tX2lkID09IHRoaXMucm9vbSkge1xuICAgICAgICB0aGlzLnJlbW92ZUF2YWlsYWJsZU9jY3VwYW50KGRhdGEudXNlcl9pZCk7XG4gICAgICAgIHRoaXMucmVtb3ZlT2NjdXBhbnQoZGF0YS51c2VyX2lkKTtcbiAgICAgIH0gZWxzZSBpZiAoZGF0YS5ldmVudCA9PSBcImJsb2NrZWRcIikge1xuICAgICAgICBkb2N1bWVudC5ib2R5LmRpc3BhdGNoRXZlbnQobmV3IEN1c3RvbUV2ZW50KFwiYmxvY2tlZFwiLCB7IGRldGFpbDogeyBjbGllbnRJZDogZGF0YS5ieSB9IH0pKTtcbiAgICAgIH0gZWxzZSBpZiAoZGF0YS5ldmVudCA9PSBcInVuYmxvY2tlZFwiKSB7XG4gICAgICAgIGRvY3VtZW50LmJvZHkuZGlzcGF0Y2hFdmVudChuZXcgQ3VzdG9tRXZlbnQoXCJ1bmJsb2NrZWRcIiwgeyBkZXRhaWw6IHsgY2xpZW50SWQ6IGRhdGEuYnkgfSB9KSk7XG4gICAgICB9IGVsc2UgaWYgKGRhdGEuZXZlbnQgPT09IFwiZGF0YVwiKSB7XG4gICAgICAgIHRoaXMub25EYXRhKEpTT04ucGFyc2UoZGF0YS5ib2R5KSwgXCJqYW51cy1ldmVudFwiKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGRlYnVnKFwicHViIHdhaXRpbmcgZm9yIGpvaW5cIik7XG5cbiAgICAvLyBTZW5kIGpvaW4gbWVzc2FnZSB0byBqYW51cy4gTGlzdGVuIGZvciBqb2luL2xlYXZlIG1lc3NhZ2VzLiBBdXRvbWF0aWNhbGx5IHN1YnNjcmliZSB0byBhbGwgdXNlcnMnIFdlYlJUQyBkYXRhLlxuICAgIHZhciBtZXNzYWdlID0gYXdhaXQgdGhpcy5zZW5kSm9pbihoYW5kbGUsIHtcbiAgICAgIG5vdGlmaWNhdGlvbnM6IHRydWUsXG4gICAgICBkYXRhOiB0cnVlXG4gICAgfSk7XG5cbiAgICBpZiAoIW1lc3NhZ2UucGx1Z2luZGF0YS5kYXRhLnN1Y2Nlc3MpIHtcbiAgICAgIGNvbnN0IGVyciA9IG1lc3NhZ2UucGx1Z2luZGF0YS5kYXRhLmVycm9yO1xuICAgICAgY29uc29sZS5lcnJvcihlcnIpO1xuICAgICAgLy8gV2UgbWF5IGdldCBoZXJlIGJlY2F1c2Ugb2YgYW4gZXhwaXJlZCBKV1QuXG4gICAgICAvLyBDbG9zZSB0aGUgY29ubmVjdGlvbiBvdXJzZWxmIG90aGVyd2lzZSBqYW51cyB3aWxsIGNsb3NlIGl0IGFmdGVyXG4gICAgICAvLyBzZXNzaW9uX3RpbWVvdXQgYmVjYXVzZSB3ZSBkaWRuJ3Qgc2VuZCBhbnkga2VlcGFsaXZlIGFuZCB0aGlzIHdpbGxcbiAgICAgIC8vIHRyaWdnZXIgYSBkZWxheWVkIHJlY29ubmVjdCBiZWNhdXNlIG9mIHRoZSBpY2Vjb25uZWN0aW9uc3RhdGVjaGFuZ2VcbiAgICAgIC8vIGxpc3RlbmVyIGZvciBmYWlsdXJlIHN0YXRlLlxuICAgICAgLy8gRXZlbiBpZiB0aGUgYXBwIGNvZGUgY2FsbHMgZGlzY29ubmVjdCBpbiBjYXNlIG9mIGVycm9yLCBkaXNjb25uZWN0XG4gICAgICAvLyB3b24ndCBjbG9zZSB0aGUgcGVlciBjb25uZWN0aW9uIGJlY2F1c2UgdGhpcy5wdWJsaXNoZXIgaXMgbm90IHNldC5cbiAgICAgIGNvbm4uY2xvc2UoKTtcbiAgICAgIHRocm93IGVycjtcbiAgICB9XG5cbiAgICB2YXIgaW5pdGlhbE9jY3VwYW50cyA9IG1lc3NhZ2UucGx1Z2luZGF0YS5kYXRhLnJlc3BvbnNlLnVzZXJzW3RoaXMucm9vbV0gfHwgW107XG5cbiAgICBpZiAoaW5pdGlhbE9jY3VwYW50cy5pbmNsdWRlcyh0aGlzLmNsaWVudElkKSkge1xuICAgICAgY29uc29sZS53YXJuKFwiSmFudXMgc3RpbGwgaGFzIHByZXZpb3VzIHNlc3Npb24gZm9yIHRoaXMgY2xpZW50LiBSZWNvbm5lY3RpbmcgaW4gMTBzLlwiKTtcbiAgICAgIHRoaXMucGVyZm9ybURlbGF5ZWRSZWNvbm5lY3QoKTtcbiAgICB9XG5cbiAgICBkZWJ1ZyhcInB1Ymxpc2hlciByZWFkeVwiKTtcbiAgICByZXR1cm4ge1xuICAgICAgaGFuZGxlLFxuICAgICAgaW5pdGlhbE9jY3VwYW50cyxcbiAgICAgIHJlbGlhYmxlQ2hhbm5lbCxcbiAgICAgIHVucmVsaWFibGVDaGFubmVsLFxuICAgICAgY29ublxuICAgIH07XG4gIH1cblxuICBjb25maWd1cmVQdWJsaXNoZXJTZHAoanNlcCkge1xuICAgIGpzZXAuc2RwID0ganNlcC5zZHAucmVwbGFjZSgvYT1mbXRwOigxMDl8MTExKS4qXFxyXFxuL2csIChsaW5lLCBwdCkgPT4ge1xuICAgICAgY29uc3QgcGFyYW1ldGVycyA9IE9iamVjdC5hc3NpZ24oc2RwVXRpbHMucGFyc2VGbXRwKGxpbmUpLCBPUFVTX1BBUkFNRVRFUlMpO1xuICAgICAgcmV0dXJuIHNkcFV0aWxzLndyaXRlRm10cCh7IHBheWxvYWRUeXBlOiBwdCwgcGFyYW1ldGVyczogcGFyYW1ldGVycyB9KTtcbiAgICB9KTtcbiAgICByZXR1cm4ganNlcDtcbiAgfVxuXG4gIGNvbmZpZ3VyZVN1YnNjcmliZXJTZHAoanNlcCkge1xuICAgIC8vIHRvZG86IGNvbnNpZGVyIGNsZWFuaW5nIHVwIHRoZXNlIGhhY2tzIHRvIHVzZSBzZHB1dGlsc1xuICAgIGlmICghaXNIMjY0VmlkZW9TdXBwb3J0ZWQpIHtcbiAgICAgIGlmIChuYXZpZ2F0b3IudXNlckFnZW50LmluZGV4T2YoXCJIZWFkbGVzc0Nocm9tZVwiKSAhPT0gLTEpIHtcbiAgICAgICAgLy8gSGVhZGxlc3NDaHJvbWUgKGUuZy4gcHVwcGV0ZWVyKSBkb2Vzbid0IHN1cHBvcnQgd2VicnRjIHZpZGVvIHN0cmVhbXMsIHNvIHdlIHJlbW92ZSB0aG9zZSBsaW5lcyBmcm9tIHRoZSBTRFAuXG4gICAgICAgIGpzZXAuc2RwID0ganNlcC5zZHAucmVwbGFjZSgvbT12aWRlb1teXSptPS8sIFwibT1cIik7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gVE9ETzogSGFjayB0byBnZXQgdmlkZW8gd29ya2luZyBvbiBDaHJvbWUgZm9yIEFuZHJvaWQuIGh0dHBzOi8vZ3JvdXBzLmdvb2dsZS5jb20vZm9ydW0vIyF0b3BpYy9tb3ppbGxhLmRldi5tZWRpYS9ZZTI5dnVNVHBvOFxuICAgIGlmIChuYXZpZ2F0b3IudXNlckFnZW50LmluZGV4T2YoXCJBbmRyb2lkXCIpID09PSAtMSkge1xuICAgICAganNlcC5zZHAgPSBqc2VwLnNkcC5yZXBsYWNlKFxuICAgICAgICBcImE9cnRjcC1mYjoxMDcgZ29vZy1yZW1iXFxyXFxuXCIsXG4gICAgICAgIFwiYT1ydGNwLWZiOjEwNyBnb29nLXJlbWJcXHJcXG5hPXJ0Y3AtZmI6MTA3IHRyYW5zcG9ydC1jY1xcclxcbmE9Zm10cDoxMDcgbGV2ZWwtYXN5bW1ldHJ5LWFsbG93ZWQ9MTtwYWNrZXRpemF0aW9uLW1vZGU9MTtwcm9maWxlLWxldmVsLWlkPTQyZTAxZlxcclxcblwiXG4gICAgICApO1xuICAgIH0gZWxzZSB7XG4gICAgICBqc2VwLnNkcCA9IGpzZXAuc2RwLnJlcGxhY2UoXG4gICAgICAgIFwiYT1ydGNwLWZiOjEwNyBnb29nLXJlbWJcXHJcXG5cIixcbiAgICAgICAgXCJhPXJ0Y3AtZmI6MTA3IGdvb2ctcmVtYlxcclxcbmE9cnRjcC1mYjoxMDcgdHJhbnNwb3J0LWNjXFxyXFxuYT1mbXRwOjEwNyBsZXZlbC1hc3ltbWV0cnktYWxsb3dlZD0xO3BhY2tldGl6YXRpb24tbW9kZT0xO3Byb2ZpbGUtbGV2ZWwtaWQ9NDIwMDFmXFxyXFxuXCJcbiAgICAgICk7XG4gICAgfVxuICAgIHJldHVybiBqc2VwO1xuICB9XG5cbiAgYXN5bmMgZml4U2FmYXJpSWNlVUZyYWcoanNlcCkge1xuICAgIC8vIFNhZmFyaSBwcm9kdWNlcyBhIFxcbiBpbnN0ZWFkIG9mIGFuIFxcclxcbiBmb3IgdGhlIGljZS11ZnJhZy4gU2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9tZWV0ZWNoby9qYW51cy1nYXRld2F5L2lzc3Vlcy8xODE4XG4gICAganNlcC5zZHAgPSBqc2VwLnNkcC5yZXBsYWNlKC9bXlxccl1cXG5hPWljZS11ZnJhZy9nLCBcIlxcclxcbmE9aWNlLXVmcmFnXCIpO1xuICAgIHJldHVybiBqc2VwXG4gIH1cblxuICBhc3luYyBjcmVhdGVTdWJzY3JpYmVyKG9jY3VwYW50SWQsIG1heFJldHJpZXMgPSA1KSB7XG4gICAgaWYgKHRoaXMuYXZhaWxhYmxlT2NjdXBhbnRzLmluZGV4T2Yob2NjdXBhbnRJZCkgPT09IC0xKSB7XG4gICAgICBjb25zb2xlLndhcm4ob2NjdXBhbnRJZCArIFwiOiBjYW5jZWxsZWQgb2NjdXBhbnQgY29ubmVjdGlvbiwgb2NjdXBhbnQgbGVmdCBiZWZvcmUgc3Vic2NyaXB0aW9uIG5lZ290YXRpb24uXCIpO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgdmFyIGhhbmRsZSA9IG5ldyBtai5KYW51c1BsdWdpbkhhbmRsZSh0aGlzLnNlc3Npb24pO1xuICAgIHZhciBjb25uID0gbmV3IFJUQ1BlZXJDb25uZWN0aW9uKHRoaXMucGVlckNvbm5lY3Rpb25Db25maWcgfHwgREVGQVVMVF9QRUVSX0NPTk5FQ1RJT05fQ09ORklHKTtcblxuICAgIGRlYnVnKG9jY3VwYW50SWQgKyBcIjogc3ViIHdhaXRpbmcgZm9yIHNmdVwiKTtcbiAgICBhd2FpdCBoYW5kbGUuYXR0YWNoKFwiamFudXMucGx1Z2luLnNmdVwiKTtcblxuICAgIHRoaXMuYXNzb2NpYXRlKGNvbm4sIGhhbmRsZSk7XG5cbiAgICBkZWJ1ZyhvY2N1cGFudElkICsgXCI6IHN1YiB3YWl0aW5nIGZvciBqb2luXCIpO1xuXG4gICAgaWYgKHRoaXMuYXZhaWxhYmxlT2NjdXBhbnRzLmluZGV4T2Yob2NjdXBhbnRJZCkgPT09IC0xKSB7XG4gICAgICBjb25uLmNsb3NlKCk7XG4gICAgICBjb25zb2xlLndhcm4ob2NjdXBhbnRJZCArIFwiOiBjYW5jZWxsZWQgb2NjdXBhbnQgY29ubmVjdGlvbiwgb2NjdXBhbnQgbGVmdCBhZnRlciBhdHRhY2hcIik7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBsZXQgd2VicnRjRmFpbGVkID0gZmFsc2U7XG5cbiAgICBjb25zdCB3ZWJydGN1cCA9IG5ldyBQcm9taXNlKHJlc29sdmUgPT4ge1xuICAgICAgY29uc3QgbGVmdEludGVydmFsID0gc2V0SW50ZXJ2YWwoKCkgPT4ge1xuICAgICAgICBpZiAodGhpcy5hdmFpbGFibGVPY2N1cGFudHMuaW5kZXhPZihvY2N1cGFudElkKSA9PT0gLTEpIHtcbiAgICAgICAgICBjbGVhckludGVydmFsKGxlZnRJbnRlcnZhbCk7XG4gICAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgICB9XG4gICAgICB9LCAxMDAwKTtcblxuICAgICAgY29uc3QgdGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICBjbGVhckludGVydmFsKGxlZnRJbnRlcnZhbCk7XG4gICAgICAgIHdlYnJ0Y0ZhaWxlZCA9IHRydWU7XG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH0sIFNVQlNDUklCRV9USU1FT1VUX01TKTtcblxuICAgICAgaGFuZGxlLm9uKFwid2VicnRjdXBcIiwgKCkgPT4ge1xuICAgICAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XG4gICAgICAgIGNsZWFySW50ZXJ2YWwobGVmdEludGVydmFsKTtcbiAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICAvLyBTZW5kIGpvaW4gbWVzc2FnZSB0byBqYW51cy4gRG9uJ3QgbGlzdGVuIGZvciBqb2luL2xlYXZlIG1lc3NhZ2VzLiBTdWJzY3JpYmUgdG8gdGhlIG9jY3VwYW50J3MgbWVkaWEuXG4gICAgLy8gSmFudXMgc2hvdWxkIHNlbmQgdXMgYW4gb2ZmZXIgZm9yIHRoaXMgb2NjdXBhbnQncyBtZWRpYSBpbiByZXNwb25zZSB0byB0aGlzLlxuICAgIGF3YWl0IHRoaXMuc2VuZEpvaW4oaGFuZGxlLCB7IG1lZGlhOiBvY2N1cGFudElkIH0pO1xuXG4gICAgaWYgKHRoaXMuYXZhaWxhYmxlT2NjdXBhbnRzLmluZGV4T2Yob2NjdXBhbnRJZCkgPT09IC0xKSB7XG4gICAgICBjb25uLmNsb3NlKCk7XG4gICAgICBjb25zb2xlLndhcm4ob2NjdXBhbnRJZCArIFwiOiBjYW5jZWxsZWQgb2NjdXBhbnQgY29ubmVjdGlvbiwgb2NjdXBhbnQgbGVmdCBhZnRlciBqb2luXCIpO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgZGVidWcob2NjdXBhbnRJZCArIFwiOiBzdWIgd2FpdGluZyBmb3Igd2VicnRjdXBcIik7XG4gICAgYXdhaXQgd2VicnRjdXA7XG5cbiAgICBpZiAodGhpcy5hdmFpbGFibGVPY2N1cGFudHMuaW5kZXhPZihvY2N1cGFudElkKSA9PT0gLTEpIHtcbiAgICAgIGNvbm4uY2xvc2UoKTtcbiAgICAgIGNvbnNvbGUud2FybihvY2N1cGFudElkICsgXCI6IGNhbmNlbCBvY2N1cGFudCBjb25uZWN0aW9uLCBvY2N1cGFudCBsZWZ0IGR1cmluZyBvciBhZnRlciB3ZWJydGN1cFwiKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGlmICh3ZWJydGNGYWlsZWQpIHtcbiAgICAgIGNvbm4uY2xvc2UoKTtcbiAgICAgIGlmIChtYXhSZXRyaWVzID4gMCkge1xuICAgICAgICBjb25zb2xlLndhcm4ob2NjdXBhbnRJZCArIFwiOiB3ZWJydGMgdXAgdGltZWQgb3V0LCByZXRyeWluZ1wiKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlU3Vic2NyaWJlcihvY2N1cGFudElkLCBtYXhSZXRyaWVzIC0gMSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zb2xlLndhcm4ob2NjdXBhbnRJZCArIFwiOiB3ZWJydGMgdXAgdGltZWQgb3V0XCIpO1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoaXNTYWZhcmkgJiYgIXRoaXMuX2lPU0hhY2tEZWxheWVkSW5pdGlhbFBlZXIpIHtcbiAgICAgIC8vIEhBQ0s6IHRoZSBmaXJzdCBwZWVyIG9uIFNhZmFyaSBkdXJpbmcgcGFnZSBsb2FkIGNhbiBmYWlsIHRvIHdvcmsgaWYgd2UgZG9uJ3RcbiAgICAgIC8vIHdhaXQgc29tZSB0aW1lIGJlZm9yZSBjb250aW51aW5nIGhlcmUuIFNlZTogaHR0cHM6Ly9naXRodWIuY29tL21vemlsbGEvaHVicy9wdWxsLzE2OTJcbiAgICAgIGF3YWl0IChuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gc2V0VGltZW91dChyZXNvbHZlLCAzMDAwKSkpO1xuICAgICAgdGhpcy5faU9TSGFja0RlbGF5ZWRJbml0aWFsUGVlciA9IHRydWU7XG4gICAgfVxuXG4gICAgdmFyIG1lZGlhU3RyZWFtID0gbmV3IE1lZGlhU3RyZWFtKCk7XG4gICAgdmFyIHJlY2VpdmVycyA9IGNvbm4uZ2V0UmVjZWl2ZXJzKCk7XG4gICAgcmVjZWl2ZXJzLmZvckVhY2gocmVjZWl2ZXIgPT4ge1xuICAgICAgaWYgKHJlY2VpdmVyLnRyYWNrKSB7XG4gICAgICAgIG1lZGlhU3RyZWFtLmFkZFRyYWNrKHJlY2VpdmVyLnRyYWNrKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBpZiAobWVkaWFTdHJlYW0uZ2V0VHJhY2tzKCkubGVuZ3RoID09PSAwKSB7XG4gICAgICBtZWRpYVN0cmVhbSA9IG51bGw7XG4gICAgfVxuXG4gICAgZGVidWcob2NjdXBhbnRJZCArIFwiOiBzdWJzY3JpYmVyIHJlYWR5XCIpO1xuICAgIHJldHVybiB7XG4gICAgICBoYW5kbGUsXG4gICAgICBtZWRpYVN0cmVhbSxcbiAgICAgIGNvbm5cbiAgICB9O1xuICB9XG5cbiAgc2VuZEpvaW4oaGFuZGxlLCBzdWJzY3JpYmUpIHtcbiAgICByZXR1cm4gaGFuZGxlLnNlbmRNZXNzYWdlKHtcbiAgICAgIGtpbmQ6IFwiam9pblwiLFxuICAgICAgcm9vbV9pZDogdGhpcy5yb29tLFxuICAgICAgdXNlcl9pZDogdGhpcy5jbGllbnRJZCxcbiAgICAgIHN1YnNjcmliZSxcbiAgICAgIHRva2VuOiB0aGlzLmpvaW5Ub2tlblxuICAgIH0pO1xuICB9XG5cbiAgdG9nZ2xlRnJlZXplKCkge1xuICAgIGlmICh0aGlzLmZyb3plbikge1xuICAgICAgdGhpcy51bmZyZWV6ZSgpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmZyZWV6ZSgpO1xuICAgIH1cbiAgfVxuXG4gIGZyZWV6ZSgpIHtcbiAgICB0aGlzLmZyb3plbiA9IHRydWU7XG4gIH1cblxuICB1bmZyZWV6ZSgpIHtcbiAgICB0aGlzLmZyb3plbiA9IGZhbHNlO1xuICAgIHRoaXMuZmx1c2hQZW5kaW5nVXBkYXRlcygpO1xuICB9XG5cbiAgZGF0YUZvclVwZGF0ZU11bHRpTWVzc2FnZShuZXR3b3JrSWQsIG1lc3NhZ2UpIHtcbiAgICAvLyBcImRcIiBpcyBhbiBhcnJheSBvZiBlbnRpdHkgZGF0YXMsIHdoZXJlIGVhY2ggaXRlbSBpbiB0aGUgYXJyYXkgcmVwcmVzZW50cyBhIHVuaXF1ZSBlbnRpdHkgYW5kIGNvbnRhaW5zXG4gICAgLy8gbWV0YWRhdGEgZm9yIHRoZSBlbnRpdHksIGFuZCBhbiBhcnJheSBvZiBjb21wb25lbnRzIHRoYXQgaGF2ZSBiZWVuIHVwZGF0ZWQgb24gdGhlIGVudGl0eS5cbiAgICAvLyBUaGlzIG1ldGhvZCBmaW5kcyB0aGUgZGF0YSBjb3JyZXNwb25kaW5nIHRvIHRoZSBnaXZlbiBuZXR3b3JrSWQuXG4gICAgZm9yIChsZXQgaSA9IDAsIGwgPSBtZXNzYWdlLmRhdGEuZC5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAgIGNvbnN0IGRhdGEgPSBtZXNzYWdlLmRhdGEuZFtpXTtcblxuICAgICAgaWYgKGRhdGEubmV0d29ya0lkID09PSBuZXR3b3JrSWQpIHtcbiAgICAgICAgcmV0dXJuIGRhdGE7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBnZXRQZW5kaW5nRGF0YShuZXR3b3JrSWQsIG1lc3NhZ2UpIHtcbiAgICBpZiAoIW1lc3NhZ2UpIHJldHVybiBudWxsO1xuXG4gICAgbGV0IGRhdGEgPSBtZXNzYWdlLmRhdGFUeXBlID09PSBcInVtXCIgPyB0aGlzLmRhdGFGb3JVcGRhdGVNdWx0aU1lc3NhZ2UobmV0d29ya0lkLCBtZXNzYWdlKSA6IG1lc3NhZ2UuZGF0YTtcblxuICAgIC8vIElnbm9yZSBtZXNzYWdlcyByZWxhdGluZyB0byB1c2VycyB3aG8gaGF2ZSBkaXNjb25uZWN0ZWQgc2luY2UgZnJlZXppbmcsIHRoZWlyIGVudGl0aWVzXG4gICAgLy8gd2lsbCBoYXZlIGFsZWFkeSBiZWVuIHJlbW92ZWQgYnkgTkFGLlxuICAgIC8vIE5vdGUgdGhhdCBkZWxldGUgbWVzc2FnZXMgaGF2ZSBubyBcIm93bmVyXCIgc28gd2UgaGF2ZSB0byBjaGVjayBmb3IgdGhhdCBhcyB3ZWxsLlxuICAgIGlmIChkYXRhLm93bmVyICYmICF0aGlzLm9jY3VwYW50c1tkYXRhLm93bmVyXSkgcmV0dXJuIG51bGw7XG5cbiAgICAvLyBJZ25vcmUgbWVzc2FnZXMgZnJvbSB1c2VycyB0aGF0IHdlIG1heSBoYXZlIGJsb2NrZWQgd2hpbGUgZnJvemVuLlxuICAgIGlmIChkYXRhLm93bmVyICYmIHRoaXMuYmxvY2tlZENsaWVudHMuaGFzKGRhdGEub3duZXIpKSByZXR1cm4gbnVsbDtcblxuICAgIHJldHVybiBkYXRhXG4gIH1cblxuICAvLyBVc2VkIGV4dGVybmFsbHlcbiAgZ2V0UGVuZGluZ0RhdGFGb3JOZXR3b3JrSWQobmV0d29ya0lkKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0UGVuZGluZ0RhdGEobmV0d29ya0lkLCB0aGlzLmZyb3plblVwZGF0ZXMuZ2V0KG5ldHdvcmtJZCkpO1xuICB9XG5cbiAgZmx1c2hQZW5kaW5nVXBkYXRlcygpIHtcbiAgICBmb3IgKGNvbnN0IFtuZXR3b3JrSWQsIG1lc3NhZ2VdIG9mIHRoaXMuZnJvemVuVXBkYXRlcykge1xuICAgICAgbGV0IGRhdGEgPSB0aGlzLmdldFBlbmRpbmdEYXRhKG5ldHdvcmtJZCwgbWVzc2FnZSk7XG4gICAgICBpZiAoIWRhdGEpIGNvbnRpbnVlO1xuXG4gICAgICAvLyBPdmVycmlkZSB0aGUgZGF0YSB0eXBlIG9uIFwidW1cIiBtZXNzYWdlcyB0eXBlcywgc2luY2Ugd2UgZXh0cmFjdCBlbnRpdHkgdXBkYXRlcyBmcm9tIFwidW1cIiBtZXNzYWdlcyBpbnRvXG4gICAgICAvLyBpbmRpdmlkdWFsIGZyb3plblVwZGF0ZXMgaW4gc3RvcmVTaW5nbGVNZXNzYWdlLlxuICAgICAgY29uc3QgZGF0YVR5cGUgPSBtZXNzYWdlLmRhdGFUeXBlID09PSBcInVtXCIgPyBcInVcIiA6IG1lc3NhZ2UuZGF0YVR5cGU7XG5cbiAgICAgIHRoaXMub25PY2N1cGFudE1lc3NhZ2UobnVsbCwgZGF0YVR5cGUsIGRhdGEsIG1lc3NhZ2Uuc291cmNlKTtcbiAgICB9XG4gICAgdGhpcy5mcm96ZW5VcGRhdGVzLmNsZWFyKCk7XG4gIH1cblxuICBzdG9yZU1lc3NhZ2UobWVzc2FnZSkge1xuICAgIGlmIChtZXNzYWdlLmRhdGFUeXBlID09PSBcInVtXCIpIHsgLy8gVXBkYXRlTXVsdGlcbiAgICAgIGZvciAobGV0IGkgPSAwLCBsID0gbWVzc2FnZS5kYXRhLmQubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICAgIHRoaXMuc3RvcmVTaW5nbGVNZXNzYWdlKG1lc3NhZ2UsIGkpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnN0b3JlU2luZ2xlTWVzc2FnZShtZXNzYWdlKTtcbiAgICB9XG4gIH1cblxuICBzdG9yZVNpbmdsZU1lc3NhZ2UobWVzc2FnZSwgaW5kZXgpIHtcbiAgICBjb25zdCBkYXRhID0gaW5kZXggIT09IHVuZGVmaW5lZCA/IG1lc3NhZ2UuZGF0YS5kW2luZGV4XSA6IG1lc3NhZ2UuZGF0YTtcbiAgICBjb25zdCBkYXRhVHlwZSA9IG1lc3NhZ2UuZGF0YVR5cGU7XG4gICAgY29uc3Qgc291cmNlID0gbWVzc2FnZS5zb3VyY2U7XG5cbiAgICBjb25zdCBuZXR3b3JrSWQgPSBkYXRhLm5ldHdvcmtJZDtcblxuICAgIGlmICghdGhpcy5mcm96ZW5VcGRhdGVzLmhhcyhuZXR3b3JrSWQpKSB7XG4gICAgICB0aGlzLmZyb3plblVwZGF0ZXMuc2V0KG5ldHdvcmtJZCwgbWVzc2FnZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IHN0b3JlZE1lc3NhZ2UgPSB0aGlzLmZyb3plblVwZGF0ZXMuZ2V0KG5ldHdvcmtJZCk7XG4gICAgICBjb25zdCBzdG9yZWREYXRhID0gc3RvcmVkTWVzc2FnZS5kYXRhVHlwZSA9PT0gXCJ1bVwiID8gdGhpcy5kYXRhRm9yVXBkYXRlTXVsdGlNZXNzYWdlKG5ldHdvcmtJZCwgc3RvcmVkTWVzc2FnZSkgOiBzdG9yZWRNZXNzYWdlLmRhdGE7XG5cbiAgICAgIC8vIEF2b2lkIHVwZGF0aW5nIGNvbXBvbmVudHMgaWYgdGhlIGVudGl0eSBkYXRhIHJlY2VpdmVkIGRpZCBub3QgY29tZSBmcm9tIHRoZSBjdXJyZW50IG93bmVyLlxuICAgICAgY29uc3QgaXNPdXRkYXRlZE1lc3NhZ2UgPSBkYXRhLmxhc3RPd25lclRpbWUgPCBzdG9yZWREYXRhLmxhc3RPd25lclRpbWU7XG4gICAgICBjb25zdCBpc0NvbnRlbXBvcmFuZW91c01lc3NhZ2UgPSBkYXRhLmxhc3RPd25lclRpbWUgPT09IHN0b3JlZERhdGEubGFzdE93bmVyVGltZTtcbiAgICAgIGlmIChpc091dGRhdGVkTWVzc2FnZSB8fCAoaXNDb250ZW1wb3JhbmVvdXNNZXNzYWdlICYmIHN0b3JlZERhdGEub3duZXIgPiBkYXRhLm93bmVyKSkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmIChkYXRhVHlwZSA9PT0gXCJyXCIpIHtcbiAgICAgICAgY29uc3QgY3JlYXRlZFdoaWxlRnJvemVuID0gc3RvcmVkRGF0YSAmJiBzdG9yZWREYXRhLmlzRmlyc3RTeW5jO1xuICAgICAgICBpZiAoY3JlYXRlZFdoaWxlRnJvemVuKSB7XG4gICAgICAgICAgLy8gSWYgdGhlIGVudGl0eSB3YXMgY3JlYXRlZCBhbmQgZGVsZXRlZCB3aGlsZSBmcm96ZW4sIGRvbid0IGJvdGhlciBjb252ZXlpbmcgYW55dGhpbmcgdG8gdGhlIGNvbnN1bWVyLlxuICAgICAgICAgIHRoaXMuZnJvemVuVXBkYXRlcy5kZWxldGUobmV0d29ya0lkKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBEZWxldGUgbWVzc2FnZXMgb3ZlcnJpZGUgYW55IG90aGVyIG1lc3NhZ2VzIGZvciB0aGlzIGVudGl0eVxuICAgICAgICAgIHRoaXMuZnJvemVuVXBkYXRlcy5zZXQobmV0d29ya0lkLCBtZXNzYWdlKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gbWVyZ2UgaW4gY29tcG9uZW50IHVwZGF0ZXNcbiAgICAgICAgaWYgKHN0b3JlZERhdGEuY29tcG9uZW50cyAmJiBkYXRhLmNvbXBvbmVudHMpIHtcbiAgICAgICAgICBPYmplY3QuYXNzaWduKHN0b3JlZERhdGEuY29tcG9uZW50cywgZGF0YS5jb21wb25lbnRzKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIG9uRGF0YUNoYW5uZWxNZXNzYWdlKGUsIHNvdXJjZSkge1xuICAgIHRoaXMub25EYXRhKEpTT04ucGFyc2UoZS5kYXRhKSwgc291cmNlKTtcbiAgfVxuXG4gIG9uRGF0YShtZXNzYWdlLCBzb3VyY2UpIHtcbiAgICBpZiAoZGVidWcuZW5hYmxlZCkge1xuICAgICAgZGVidWcoYERDIGluOiAke21lc3NhZ2V9YCk7XG4gICAgfVxuXG4gICAgaWYgKCFtZXNzYWdlLmRhdGFUeXBlKSByZXR1cm47XG5cbiAgICBtZXNzYWdlLnNvdXJjZSA9IHNvdXJjZTtcblxuICAgIGlmICh0aGlzLmZyb3plbikge1xuICAgICAgdGhpcy5zdG9yZU1lc3NhZ2UobWVzc2FnZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMub25PY2N1cGFudE1lc3NhZ2UobnVsbCwgbWVzc2FnZS5kYXRhVHlwZSwgbWVzc2FnZS5kYXRhLCBtZXNzYWdlLnNvdXJjZSk7XG4gICAgfVxuICB9XG5cbiAgc2hvdWxkU3RhcnRDb25uZWN0aW9uVG8oY2xpZW50KSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICBzdGFydFN0cmVhbUNvbm5lY3Rpb24oY2xpZW50KSB7fVxuXG4gIGNsb3NlU3RyZWFtQ29ubmVjdGlvbihjbGllbnQpIHt9XG5cbiAgZ2V0Q29ubmVjdFN0YXR1cyhjbGllbnRJZCkge1xuICAgIHJldHVybiB0aGlzLm9jY3VwYW50c1tjbGllbnRJZF0gPyBOQUYuYWRhcHRlcnMuSVNfQ09OTkVDVEVEIDogTkFGLmFkYXB0ZXJzLk5PVF9DT05ORUNURUQ7XG4gIH1cblxuICBhc3luYyB1cGRhdGVUaW1lT2Zmc2V0KCkge1xuICAgIGlmICh0aGlzLmlzRGlzY29ubmVjdGVkKCkpIHJldHVybjtcblxuICAgIGNvbnN0IGNsaWVudFNlbnRUaW1lID0gRGF0ZS5ub3coKTtcblxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoKGRvY3VtZW50LmxvY2F0aW9uLmhyZWYsIHtcbiAgICAgIG1ldGhvZDogXCJIRUFEXCIsXG4gICAgICBjYWNoZTogXCJuby1jYWNoZVwiXG4gICAgfSk7XG5cbiAgICBjb25zdCBwcmVjaXNpb24gPSAxMDAwO1xuICAgIGNvbnN0IHNlcnZlclJlY2VpdmVkVGltZSA9IG5ldyBEYXRlKHJlcy5oZWFkZXJzLmdldChcIkRhdGVcIikpLmdldFRpbWUoKSArIHByZWNpc2lvbiAvIDI7XG4gICAgY29uc3QgY2xpZW50UmVjZWl2ZWRUaW1lID0gRGF0ZS5ub3coKTtcbiAgICBjb25zdCBzZXJ2ZXJUaW1lID0gc2VydmVyUmVjZWl2ZWRUaW1lICsgKGNsaWVudFJlY2VpdmVkVGltZSAtIGNsaWVudFNlbnRUaW1lKSAvIDI7XG4gICAgY29uc3QgdGltZU9mZnNldCA9IHNlcnZlclRpbWUgLSBjbGllbnRSZWNlaXZlZFRpbWU7XG5cbiAgICB0aGlzLnNlcnZlclRpbWVSZXF1ZXN0cysrO1xuXG4gICAgaWYgKHRoaXMuc2VydmVyVGltZVJlcXVlc3RzIDw9IDEwKSB7XG4gICAgICB0aGlzLnRpbWVPZmZzZXRzLnB1c2godGltZU9mZnNldCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMudGltZU9mZnNldHNbdGhpcy5zZXJ2ZXJUaW1lUmVxdWVzdHMgJSAxMF0gPSB0aW1lT2Zmc2V0O1xuICAgIH1cblxuICAgIHRoaXMuYXZnVGltZU9mZnNldCA9IHRoaXMudGltZU9mZnNldHMucmVkdWNlKChhY2MsIG9mZnNldCkgPT4gKGFjYyArPSBvZmZzZXQpLCAwKSAvIHRoaXMudGltZU9mZnNldHMubGVuZ3RoO1xuXG4gICAgaWYgKHRoaXMuc2VydmVyVGltZVJlcXVlc3RzID4gMTApIHtcbiAgICAgIGRlYnVnKGBuZXcgc2VydmVyIHRpbWUgb2Zmc2V0OiAke3RoaXMuYXZnVGltZU9mZnNldH1tc2ApO1xuICAgICAgc2V0VGltZW91dCgoKSA9PiB0aGlzLnVwZGF0ZVRpbWVPZmZzZXQoKSwgNSAqIDYwICogMTAwMCk7IC8vIFN5bmMgY2xvY2sgZXZlcnkgNSBtaW51dGVzLlxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnVwZGF0ZVRpbWVPZmZzZXQoKTtcbiAgICB9XG4gIH1cblxuICBnZXRTZXJ2ZXJUaW1lKCkge1xuICAgIHJldHVybiBEYXRlLm5vdygpICsgdGhpcy5hdmdUaW1lT2Zmc2V0O1xuICB9XG5cbiAgZ2V0TWVkaWFTdHJlYW0oY2xpZW50SWQsIHR5cGUgPSBcImF1ZGlvXCIpIHtcbiAgICBpZiAodGhpcy5tZWRpYVN0cmVhbXNbY2xpZW50SWRdKSB7XG4gICAgICBkZWJ1ZyhgQWxyZWFkeSBoYWQgJHt0eXBlfSBmb3IgJHtjbGllbnRJZH1gKTtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodGhpcy5tZWRpYVN0cmVhbXNbY2xpZW50SWRdW3R5cGVdKTtcbiAgICB9IGVsc2Uge1xuICAgICAgZGVidWcoYFdhaXRpbmcgb24gJHt0eXBlfSBmb3IgJHtjbGllbnRJZH1gKTtcbiAgICAgIGlmICghdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5oYXMoY2xpZW50SWQpKSB7XG4gICAgICAgIHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuc2V0KGNsaWVudElkLCB7fSk7XG5cbiAgICAgICAgY29uc3QgYXVkaW9Qcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICAgIHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuZ2V0KGNsaWVudElkKS5hdWRpbyA9IHsgcmVzb2x2ZSwgcmVqZWN0IH07XG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCB2aWRlb1Byb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgICAgdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5nZXQoY2xpZW50SWQpLnZpZGVvID0geyByZXNvbHZlLCByZWplY3QgfTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5nZXQoY2xpZW50SWQpLmF1ZGlvLnByb21pc2UgPSBhdWRpb1Byb21pc2U7XG4gICAgICAgIHRoaXMucGVuZGluZ01lZGlhUmVxdWVzdHMuZ2V0KGNsaWVudElkKS52aWRlby5wcm9taXNlID0gdmlkZW9Qcm9taXNlO1xuXG4gICAgICAgIGF1ZGlvUHJvbWlzZS5jYXRjaChlID0+IGNvbnNvbGUud2FybihgJHtjbGllbnRJZH0gZ2V0TWVkaWFTdHJlYW0gQXVkaW8gRXJyb3JgLCBlKSk7XG4gICAgICAgIHZpZGVvUHJvbWlzZS5jYXRjaChlID0+IGNvbnNvbGUud2FybihgJHtjbGllbnRJZH0gZ2V0TWVkaWFTdHJlYW0gVmlkZW8gRXJyb3JgLCBlKSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gdGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5nZXQoY2xpZW50SWQpW3R5cGVdLnByb21pc2U7XG4gICAgfVxuICB9XG5cbiAgc2V0TWVkaWFTdHJlYW0oY2xpZW50SWQsIHN0cmVhbSkge1xuICAgIC8vIFNhZmFyaSBkb2Vzbid0IGxpa2UgaXQgd2hlbiB5b3UgdXNlIHNpbmdsZSBhIG1peGVkIG1lZGlhIHN0cmVhbSB3aGVyZSBvbmUgb2YgdGhlIHRyYWNrcyBpcyBpbmFjdGl2ZSwgc28gd2VcbiAgICAvLyBzcGxpdCB0aGUgdHJhY2tzIGludG8gdHdvIHN0cmVhbXMuXG4gICAgY29uc3QgYXVkaW9TdHJlYW0gPSBuZXcgTWVkaWFTdHJlYW0oKTtcbiAgICB0cnkge1xuICAgIHN0cmVhbS5nZXRBdWRpb1RyYWNrcygpLmZvckVhY2godHJhY2sgPT4gYXVkaW9TdHJlYW0uYWRkVHJhY2sodHJhY2spKTtcblxuICAgIH0gY2F0Y2goZSkge1xuICAgICAgY29uc29sZS53YXJuKGAke2NsaWVudElkfSBzZXRNZWRpYVN0cmVhbSBBdWRpbyBFcnJvcmAsIGUpO1xuICAgIH1cbiAgICBjb25zdCB2aWRlb1N0cmVhbSA9IG5ldyBNZWRpYVN0cmVhbSgpO1xuICAgIHRyeSB7XG4gICAgc3RyZWFtLmdldFZpZGVvVHJhY2tzKCkuZm9yRWFjaCh0cmFjayA9PiB2aWRlb1N0cmVhbS5hZGRUcmFjayh0cmFjaykpO1xuXG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc29sZS53YXJuKGAke2NsaWVudElkfSBzZXRNZWRpYVN0cmVhbSBWaWRlbyBFcnJvcmAsIGUpO1xuICAgIH1cblxuICAgIHRoaXMubWVkaWFTdHJlYW1zW2NsaWVudElkXSA9IHsgYXVkaW86IGF1ZGlvU3RyZWFtLCB2aWRlbzogdmlkZW9TdHJlYW0gfTtcblxuICAgIC8vIFJlc29sdmUgdGhlIHByb21pc2UgZm9yIHRoZSB1c2VyJ3MgbWVkaWEgc3RyZWFtIGlmIGl0IGV4aXN0cy5cbiAgICBpZiAodGhpcy5wZW5kaW5nTWVkaWFSZXF1ZXN0cy5oYXMoY2xpZW50SWQpKSB7XG4gICAgICB0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmdldChjbGllbnRJZCkuYXVkaW8ucmVzb2x2ZShhdWRpb1N0cmVhbSk7XG4gICAgICB0aGlzLnBlbmRpbmdNZWRpYVJlcXVlc3RzLmdldChjbGllbnRJZCkudmlkZW8ucmVzb2x2ZSh2aWRlb1N0cmVhbSk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgc2V0TG9jYWxNZWRpYVN0cmVhbShzdHJlYW0pIHtcbiAgICAvLyBvdXIgam9iIGhlcmUgaXMgdG8gbWFrZSBzdXJlIHRoZSBjb25uZWN0aW9uIHdpbmRzIHVwIHdpdGggUlRQIHNlbmRlcnMgc2VuZGluZyB0aGUgc3R1ZmYgaW4gdGhpcyBzdHJlYW0sXG4gICAgLy8gYW5kIG5vdCB0aGUgc3R1ZmYgdGhhdCBpc24ndCBpbiB0aGlzIHN0cmVhbS4gc3RyYXRlZ3kgaXMgdG8gcmVwbGFjZSBleGlzdGluZyB0cmFja3MgaWYgd2UgY2FuLCBhZGQgdHJhY2tzXG4gICAgLy8gdGhhdCB3ZSBjYW4ndCByZXBsYWNlLCBhbmQgZGlzYWJsZSB0cmFja3MgdGhhdCBkb24ndCBleGlzdCBhbnltb3JlLlxuXG4gICAgLy8gbm90ZSB0aGF0IHdlIGRvbid0IGV2ZXIgcmVtb3ZlIGEgdHJhY2sgZnJvbSB0aGUgc3RyZWFtIC0tIHNpbmNlIEphbnVzIGRvZXNuJ3Qgc3VwcG9ydCBVbmlmaWVkIFBsYW4sIHdlIGFic29sdXRlbHlcbiAgICAvLyBjYW4ndCB3aW5kIHVwIHdpdGggYSBTRFAgdGhhdCBoYXMgPjEgYXVkaW8gb3IgPjEgdmlkZW8gdHJhY2tzLCBldmVuIGlmIG9uZSBvZiB0aGVtIGlzIGluYWN0aXZlICh3aGF0IHlvdSBnZXQgaWZcbiAgICAvLyB5b3UgcmVtb3ZlIGEgdHJhY2sgZnJvbSBhbiBleGlzdGluZyBzdHJlYW0uKVxuICAgIGlmICh0aGlzLnB1Ymxpc2hlciAmJiB0aGlzLnB1Ymxpc2hlci5jb25uKSB7XG4gICAgICBjb25zdCBleGlzdGluZ1NlbmRlcnMgPSB0aGlzLnB1Ymxpc2hlci5jb25uLmdldFNlbmRlcnMoKTtcbiAgICAgIGNvbnN0IG5ld1NlbmRlcnMgPSBbXTtcbiAgICAgIGNvbnN0IHRyYWNrcyA9IHN0cmVhbS5nZXRUcmFja3MoKTtcblxuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0cmFja3MubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgY29uc3QgdCA9IHRyYWNrc1tpXTtcbiAgICAgICAgY29uc3Qgc2VuZGVyID0gZXhpc3RpbmdTZW5kZXJzLmZpbmQocyA9PiBzLnRyYWNrICE9IG51bGwgJiYgcy50cmFjay5raW5kID09IHQua2luZCk7XG5cbiAgICAgICAgaWYgKHNlbmRlciAhPSBudWxsKSB7XG4gICAgICAgICAgaWYgKHNlbmRlci5yZXBsYWNlVHJhY2spIHtcbiAgICAgICAgICAgIGF3YWl0IHNlbmRlci5yZXBsYWNlVHJhY2sodCk7XG5cbiAgICAgICAgICAgIC8vIFdvcmthcm91bmQgaHR0cHM6Ly9idWd6aWxsYS5tb3ppbGxhLm9yZy9zaG93X2J1Zy5jZ2k/aWQ9MTU3Njc3MVxuICAgICAgICAgICAgaWYgKHQua2luZCA9PT0gXCJ2aWRlb1wiICYmIHQuZW5hYmxlZCAmJiBuYXZpZ2F0b3IudXNlckFnZW50LnRvTG93ZXJDYXNlKCkuaW5kZXhPZignZmlyZWZveCcpID4gLTEpIHtcbiAgICAgICAgICAgICAgdC5lbmFibGVkID0gZmFsc2U7XG4gICAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4gdC5lbmFibGVkID0gdHJ1ZSwgMTAwMCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIEZhbGxiYWNrIGZvciBicm93c2VycyB0aGF0IGRvbid0IHN1cHBvcnQgcmVwbGFjZVRyYWNrLiBBdCB0aGlzIHRpbWUgb2YgdGhpcyB3cml0aW5nXG4gICAgICAgICAgICAvLyBtb3N0IGJyb3dzZXJzIHN1cHBvcnQgaXQsIGFuZCB0ZXN0aW5nIHRoaXMgY29kZSBwYXRoIHNlZW1zIHRvIG5vdCB3b3JrIHByb3Blcmx5XG4gICAgICAgICAgICAvLyBpbiBDaHJvbWUgYW55bW9yZS5cbiAgICAgICAgICAgIHN0cmVhbS5yZW1vdmVUcmFjayhzZW5kZXIudHJhY2spO1xuICAgICAgICAgICAgc3RyZWFtLmFkZFRyYWNrKHQpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBuZXdTZW5kZXJzLnB1c2goc2VuZGVyKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBuZXdTZW5kZXJzLnB1c2godGhpcy5wdWJsaXNoZXIuY29ubi5hZGRUcmFjayh0LCBzdHJlYW0pKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgZXhpc3RpbmdTZW5kZXJzLmZvckVhY2gocyA9PiB7XG4gICAgICAgIGlmICghbmV3U2VuZGVycy5pbmNsdWRlcyhzKSkge1xuICAgICAgICAgIHMudHJhY2suZW5hYmxlZCA9IGZhbHNlO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gICAgdGhpcy5sb2NhbE1lZGlhU3RyZWFtID0gc3RyZWFtO1xuICAgIHRoaXMuc2V0TWVkaWFTdHJlYW0odGhpcy5jbGllbnRJZCwgc3RyZWFtKTtcbiAgfVxuXG4gIGVuYWJsZU1pY3JvcGhvbmUoZW5hYmxlZCkge1xuICAgIGlmICh0aGlzLnB1Ymxpc2hlciAmJiB0aGlzLnB1Ymxpc2hlci5jb25uKSB7XG4gICAgICB0aGlzLnB1Ymxpc2hlci5jb25uLmdldFNlbmRlcnMoKS5mb3JFYWNoKHMgPT4ge1xuICAgICAgICBpZiAocy50cmFjay5raW5kID09IFwiYXVkaW9cIikge1xuICAgICAgICAgIHMudHJhY2suZW5hYmxlZCA9IGVuYWJsZWQ7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIHNlbmREYXRhKGNsaWVudElkLCBkYXRhVHlwZSwgZGF0YSkge1xuICAgIGlmICghdGhpcy5wdWJsaXNoZXIpIHtcbiAgICAgIGNvbnNvbGUud2FybihcInNlbmREYXRhIGNhbGxlZCB3aXRob3V0IGEgcHVibGlzaGVyXCIpO1xuICAgIH0gZWxzZSB7XG4gICAgICBzd2l0Y2ggKHRoaXMudW5yZWxpYWJsZVRyYW5zcG9ydCkge1xuICAgICAgICBjYXNlIFwid2Vic29ja2V0XCI6XG4gICAgICAgICAgdGhpcy5wdWJsaXNoZXIuaGFuZGxlLnNlbmRNZXNzYWdlKHsga2luZDogXCJkYXRhXCIsIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZGF0YVR5cGUsIGRhdGEgfSksIHdob206IGNsaWVudElkIH0pO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIFwiZGF0YWNoYW5uZWxcIjpcbiAgICAgICAgICB0aGlzLnB1Ymxpc2hlci51bnJlbGlhYmxlQ2hhbm5lbC5zZW5kKEpTT04uc3RyaW5naWZ5KHsgY2xpZW50SWQsIGRhdGFUeXBlLCBkYXRhIH0pKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICB0aGlzLnVucmVsaWFibGVUcmFuc3BvcnQoY2xpZW50SWQsIGRhdGFUeXBlLCBkYXRhKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBzZW5kRGF0YUd1YXJhbnRlZWQoY2xpZW50SWQsIGRhdGFUeXBlLCBkYXRhKSB7XG4gICAgaWYgKCF0aGlzLnB1Ymxpc2hlcikge1xuICAgICAgY29uc29sZS53YXJuKFwic2VuZERhdGFHdWFyYW50ZWVkIGNhbGxlZCB3aXRob3V0IGEgcHVibGlzaGVyXCIpO1xuICAgIH0gZWxzZSB7XG4gICAgICBzd2l0Y2ggKHRoaXMucmVsaWFibGVUcmFuc3BvcnQpIHtcbiAgICAgICAgY2FzZSBcIndlYnNvY2tldFwiOlxuICAgICAgICAgIHRoaXMucHVibGlzaGVyLmhhbmRsZS5zZW5kTWVzc2FnZSh7IGtpbmQ6IFwiZGF0YVwiLCBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGRhdGFUeXBlLCBkYXRhIH0pLCB3aG9tOiBjbGllbnRJZCB9KTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSBcImRhdGFjaGFubmVsXCI6XG4gICAgICAgICAgdGhpcy5wdWJsaXNoZXIucmVsaWFibGVDaGFubmVsLnNlbmQoSlNPTi5zdHJpbmdpZnkoeyBjbGllbnRJZCwgZGF0YVR5cGUsIGRhdGEgfSkpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHRoaXMucmVsaWFibGVUcmFuc3BvcnQoY2xpZW50SWQsIGRhdGFUeXBlLCBkYXRhKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBicm9hZGNhc3REYXRhKGRhdGFUeXBlLCBkYXRhKSB7XG4gICAgaWYgKCF0aGlzLnB1Ymxpc2hlcikge1xuICAgICAgY29uc29sZS53YXJuKFwiYnJvYWRjYXN0RGF0YSBjYWxsZWQgd2l0aG91dCBhIHB1Ymxpc2hlclwiKTtcbiAgICB9IGVsc2Uge1xuICAgICAgc3dpdGNoICh0aGlzLnVucmVsaWFibGVUcmFuc3BvcnQpIHtcbiAgICAgICAgY2FzZSBcIndlYnNvY2tldFwiOlxuICAgICAgICAgIHRoaXMucHVibGlzaGVyLmhhbmRsZS5zZW5kTWVzc2FnZSh7IGtpbmQ6IFwiZGF0YVwiLCBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGRhdGFUeXBlLCBkYXRhIH0pIH0pO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIFwiZGF0YWNoYW5uZWxcIjpcbiAgICAgICAgICB0aGlzLnB1Ymxpc2hlci51bnJlbGlhYmxlQ2hhbm5lbC5zZW5kKEpTT04uc3RyaW5naWZ5KHsgZGF0YVR5cGUsIGRhdGEgfSkpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHRoaXMudW5yZWxpYWJsZVRyYW5zcG9ydCh1bmRlZmluZWQsIGRhdGFUeXBlLCBkYXRhKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBicm9hZGNhc3REYXRhR3VhcmFudGVlZChkYXRhVHlwZSwgZGF0YSkge1xuICAgIGlmICghdGhpcy5wdWJsaXNoZXIpIHtcbiAgICAgIGNvbnNvbGUud2FybihcImJyb2FkY2FzdERhdGFHdWFyYW50ZWVkIGNhbGxlZCB3aXRob3V0IGEgcHVibGlzaGVyXCIpO1xuICAgIH0gZWxzZSB7XG4gICAgICBzd2l0Y2ggKHRoaXMucmVsaWFibGVUcmFuc3BvcnQpIHtcbiAgICAgICAgY2FzZSBcIndlYnNvY2tldFwiOlxuICAgICAgICAgIHRoaXMucHVibGlzaGVyLmhhbmRsZS5zZW5kTWVzc2FnZSh7IGtpbmQ6IFwiZGF0YVwiLCBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGRhdGFUeXBlLCBkYXRhIH0pIH0pO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIFwiZGF0YWNoYW5uZWxcIjpcbiAgICAgICAgICB0aGlzLnB1Ymxpc2hlci5yZWxpYWJsZUNoYW5uZWwuc2VuZChKU09OLnN0cmluZ2lmeSh7IGRhdGFUeXBlLCBkYXRhIH0pKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICB0aGlzLnJlbGlhYmxlVHJhbnNwb3J0KHVuZGVmaW5lZCwgZGF0YVR5cGUsIGRhdGEpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGtpY2soY2xpZW50SWQsIHBlcm1zVG9rZW4pIHtcbiAgICByZXR1cm4gdGhpcy5wdWJsaXNoZXIuaGFuZGxlLnNlbmRNZXNzYWdlKHsga2luZDogXCJraWNrXCIsIHJvb21faWQ6IHRoaXMucm9vbSwgdXNlcl9pZDogY2xpZW50SWQsIHRva2VuOiBwZXJtc1Rva2VuIH0pLnRoZW4oKCkgPT4ge1xuICAgICAgZG9jdW1lbnQuYm9keS5kaXNwYXRjaEV2ZW50KG5ldyBDdXN0b21FdmVudChcImtpY2tlZFwiLCB7IGRldGFpbDogeyBjbGllbnRJZDogY2xpZW50SWQgfSB9KSk7XG4gICAgfSk7XG4gIH1cblxuICBibG9jayhjbGllbnRJZCkge1xuICAgIHJldHVybiB0aGlzLnB1Ymxpc2hlci5oYW5kbGUuc2VuZE1lc3NhZ2UoeyBraW5kOiBcImJsb2NrXCIsIHdob206IGNsaWVudElkIH0pLnRoZW4oKCkgPT4ge1xuICAgICAgdGhpcy5ibG9ja2VkQ2xpZW50cy5zZXQoY2xpZW50SWQsIHRydWUpO1xuICAgICAgZG9jdW1lbnQuYm9keS5kaXNwYXRjaEV2ZW50KG5ldyBDdXN0b21FdmVudChcImJsb2NrZWRcIiwgeyBkZXRhaWw6IHsgY2xpZW50SWQ6IGNsaWVudElkIH0gfSkpO1xuICAgIH0pO1xuICB9XG5cbiAgdW5ibG9jayhjbGllbnRJZCkge1xuICAgIHJldHVybiB0aGlzLnB1Ymxpc2hlci5oYW5kbGUuc2VuZE1lc3NhZ2UoeyBraW5kOiBcInVuYmxvY2tcIiwgd2hvbTogY2xpZW50SWQgfSkudGhlbigoKSA9PiB7XG4gICAgICB0aGlzLmJsb2NrZWRDbGllbnRzLmRlbGV0ZShjbGllbnRJZCk7XG4gICAgICBkb2N1bWVudC5ib2R5LmRpc3BhdGNoRXZlbnQobmV3IEN1c3RvbUV2ZW50KFwidW5ibG9ja2VkXCIsIHsgZGV0YWlsOiB7IGNsaWVudElkOiBjbGllbnRJZCB9IH0pKTtcbiAgICB9KTtcbiAgfVxufVxuXG5OQUYuYWRhcHRlcnMucmVnaXN0ZXIoXCJqYW51c1wiLCBKYW51c0FkYXB0ZXIpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEphbnVzQWRhcHRlcjtcbiJdLCJzb3VyY2VSb290IjoiIn0=