/**
 * automat.js
 * Lightweight FSM class for use in demo server scripts.
 * Provides state management, transition validation, and exports graph/color
 * metadata for visualization.
 *
 * This file is NOT imported as an ES module by user code. Instead,
 * server-runtime.js injects the class source into the sandbox scope.
 */

/**
 * Source code of the Automat class, as a string to be injected into the
 * sandboxed Function scope. Kept as a template literal for readability.
 */
export const AUTOMAT_SOURCE = `
class State {
  constructor() {
    this.automat = null;
    this._timeout = null;
    this._timeoutCallback = null;
  }
  
  /** Subclasses should return [displayName, color] */
  getState() { return [this.name || 'unknown', '#ccc']; }

  // Transition name (internal ID) - defaults to lowercase class name
  get name() { return this.constructor.name.toLowerCase(); }

  onEnter() {}
  onExit() {}
  onUp() {}
  onTimer(tick) {}
  onMessage(msg) {}

  // --- Timeout Helpers ---
  addTimeout(ticks, callbackMethodName) {
    this._timeout = ticks;
    this._timeoutCallback = callbackMethodName;
  }
  clearTimeouts() { this._timeout = null; this._timeoutCallback = null; }
  transition(targetName) { if (this.automat) this.automat.transition(targetName); }
}

class Automat {
  constructor(...args) {
    let def;
    const isConfig = (args.length === 1 && (args[0].states || args[0].initial));
    if (isConfig) {
      def = args[0];
      const stateList = Array.isArray(def.states) ? def.states : Object.values(def.states);
      if (!def.initial && stateList.length > 0) def.initial = stateList[0].name;
    } else {
      def = { states: args, initial: (args[0] && args[0].name) || 'unknown' };
    }

    this.stateName = def.initial;
    this._graph = def.graph || {};
    this._colors = def.colors || {};
    this._pendingTimeouts = [];

    // Map states
    this.states = {};
    const stateList = Array.isArray(def.states) ? def.states : (def.states ? Object.values(def.states) : []);
    for (const s of stateList) {
      if (s instanceof State) {
        const name = s.name;
        this.states[name] = s;
        s.automat = this;
        // Seed initial color from getState() if not already defined
        const [_, color] = s.getState();
        if (!this._colors[name]) this._colors[name] = color;

        // Static Graph Discovery (Optional)
        if (typeof s.canTransition === 'function') {
           const targets = s.canTransition();
           if (Array.isArray(targets)) {
              if (!this._graph[name]) this._graph[name] = {};
              targets.forEach(t => { this._graph[name][t] = t; });
           }
        }
      } else {
        // Compatibility for raw objects
        this._isLegacy = true; 
        const name = s.name || Object.keys(def.states).find(k => def.states[k] === s);
        const ls = new State(); ls.automat = this;
        this.states[name] = ls;
        this._graph[name] = s.on || {};
        if (s.color) this._colors[name] = s.color;
      }
    }
    this.current = this.states[this.stateName];
  }

  onUp() { if (this.current) this.current.onUp(); }
  
  onTimer(tick) {
    if (!this.current) return;
    if (this.current._timeout !== null) {
      if (--this.current._timeout <= 0) {
        const cbName = this.current._timeoutCallback;
        const cb = this.current[cbName];
        this.current._timeout = null;
        if (typeof cb === 'function') cb.call(this.current);
      }
    }
    const rem = [];
    for (const t of this._pendingTimeouts) {
      if (tick >= t.fireAt) t.callback(); else rem.push(t);
    }
    this._pendingTimeouts = rem;
    this.current.onTimer(tick);
  }

  onMessage(msg) { 
    if (!this.current) return;
    const type = msg.payload && msg.payload.type;
    
    // 1. Explicit Registration
    if (typeof this.current.registerMessageTypes === 'function') {
      const map = this.current.registerMessageTypes();
      if (map && type in map) {
        const handler = map[type];
        if (typeof handler === 'function') return handler.call(this.current, msg);
        if (typeof handler === 'string' && typeof this.current[handler] === 'function') {
          return this.current[handler](msg);
        }
      }
    }

    // 2. Naming Convention (Optional / If not handled above)
    const conventionName = type ? \`on\${type}\` : null;
    if (conventionName && typeof this.current[conventionName] === 'function') {
      return this.current[conventionName](msg);
    }

    // 3. General Fallback
    this.current.onMessage(msg); 
  }

  transition(targetName) {
    const next = (this._graph[this.stateName] && this._graph[this.stateName][targetName]) || targetName;
    if (!this.states[next]) return false;
    
    // Track transition for graph visualizer if not already there (avoid self-links)
    if (!this._isLegacy && next !== this.stateName) {
      if (!this._graph[this.stateName]) this._graph[this.stateName] = {};
      this._graph[this.stateName][next] = next;
    }

    if (this.current && this.current.onExit) this.current.onExit();
    this.stateName = next;
    this.current = this.states[next];
    if (this.current && this.current.onEnter) this.current.onEnter();
    return true;
  }

  serialize() {
    const stateData = {};
    for (const [n, s] of Object.entries(this.states)) {
      stateData[n] = { _timeout: s._timeout, _timeoutCallback: s._timeoutCallback };
    }
    const [display, color] = this.current ? this.current.getState() : [this.stateName, '#ccc'];
    if (this.stateName) this._colors[this.stateName] = color;

    return {
      state: display, 
      color: color,
      stateName: this.stateName,
      stateData: stateData,
      graph: this._graph,
      colors: this._colors,
      pendingTimeouts: this._pendingTimeouts
    };
  }

  static run(handlerName, arg, ...states) {
    const s = loadState();
    const a = new Automat({ initial: s.stateName, states: states });
    if (typeof a[handlerName] === 'function') a[handlerName](arg);
    const res = a.serialize();
    s.stateName = res.stateName;
    dumpState(s);
  }

  static deserialize(obj, stateInstances) {
    const a = new Automat({ initial: obj.stateName, states: stateInstances, graph: obj.graph, colors: obj.colors });
    a._pendingTimeouts = obj.pendingTimeouts || [];
    return a;
  }
  can(e) { return !!(this._graph[this.stateName] && this._graph[this.stateName][e]); }
}
`;
