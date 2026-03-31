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
    this._timeouts = {}; // { name: { ticks, callback } }
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
  setTimeout(ticks, callbackMethodName, name = 'default') {
    this._timeouts[name] = { ticks: ticks, callback: callbackMethodName };
  }

  clearTimeout(name = 'default') {
    delete this._timeouts[name];
  }

  clearAllTimeouts() {
    this._timeouts = {};
  }

  /** Future API: Get list of active timer names */
  get activeTimers() {
     return Object.keys(this._timeouts);
  }

  transition(targetName, reenter = true) { if (this.automat) this.automat.transition(targetName, reenter); }
}

class Automat {
  constructor(...args) {
    let defStates, initialArg;
    const isConfig = (args.length === 1 && (args[0].states || args[0].initial));
    if (isConfig) {
      defStates = Array.isArray(args[0].states) ? args[0].states : (args[0].states ? Object.values(args[0].states) : []);
      initialArg = args[0].initial;
      this._graph = args[0].graph || {};
      this._colors = args[0].colors || {};
      this.skipInitialEnter = !!args[0].skipInitialEnter;
    } else {
      defStates = args;
      initialArg = null;
      this._graph = {};
      this._colors = {};
      this.skipInitialEnter = false;
    }

    this._pendingTimeouts = [];
    this.states = {};
    let resolvedInitialName = initialArg;

    for (const s of defStates) {
      if (s instanceof State) {
        s.automat = this;
        const [displayName, color] = s.getState();
        const name = displayName || s.name || 'unknown';
        this.states[name] = s;
        if (!this._colors[name]) this._colors[name] = color;
        if (!resolvedInitialName) resolvedInitialName = name;

        // Discovery
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
        const name = s.name || (typeof defStates === 'object' && Object.keys(defStates).find(k => defStates[k] === s)) || 'unknown';
        const ls = new State(); ls.automat = this;
        this.states[name] = ls;
        this._graph[name] = s.on || {};
        if (s.color) this._colors[name] = s.color;
        if (!resolvedInitialName) resolvedInitialName = name;
      }
    }

    this.stateName = resolvedInitialName;
    this.current = this.states[this.stateName];
    
    // Trigger onEnter for the initial state if this is a fresh start (not deserialized)
    if (!this.skipInitialEnter && this.current && this.current.onEnter) {
       this.current.onEnter();
    }
  }

  onUp() { if (this.current) this.current.onUp(); }
  
  onTimer(tick) {
    if (!this.current) return;
    const timers = this.current._timeouts;
    for (const name in timers) {
      const t = timers[name];
      if (--t.ticks <= 0) {
        const cbName = t.callback;
        const cb = this.current[cbName];
        delete timers[name];
        if (typeof cb === 'function') {
           cb.call(this.current);
        }
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

  transition(targetName, reenter = true) {
    const next = (this._graph[this.stateName] && this._graph[this.stateName][targetName]) || targetName;
    if (!this.states[next]) return false;
    
    // Idempotency Guard: If we are already here and don't want to re-enter, do nothing.
    if (next === this.stateName && !reenter) return true;

    // Track transition for graph visualizer if not already there (avoid self-links)
    if (!this._isLegacy && next !== this.stateName) {
      if (!this._graph[this.stateName]) this._graph[this.stateName] = {};
      this._graph[this.stateName][next] = next;
    }

    if (this.current) {
      if (this.current.onExit) this.current.onExit();
      this.current.clearAllTimeouts();
    }
    this.stateName = next;
    this.current = this.states[next];
    if (this.current && this.current.onEnter) this.current.onEnter();
    return true;
  }

  serialize() {
    const stateData = {};
    for (const [n, s] of Object.entries(this.states)) {
      stateData[n] = { _timeouts: s._timeouts };
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
    const a = new Automat({ initial: s.stateName, states: states, skipInitialEnter: !!s.stateName });
    if (typeof a[handlerName] === 'function') a[handlerName](arg);
    const res = a.serialize();
    s.stateName = res.stateName;
    dumpState(s);
  }

  static deserialize(obj, stateInstances) {
    const a = new Automat({ 
        initial: obj.stateName, 
        states: stateInstances, 
        graph: obj.graph, 
        colors: obj.colors,
        skipInitialEnter: true 
    });
    a._pendingTimeouts = obj.pendingTimeouts || [];
    if (obj.stateData) {
        for (const [name, data] of Object.entries(obj.stateData)) {
            if (a.states[name]) {
                a.states[name]._timeouts = data._timeouts || {};
            }
        }
    }
    return a;
  }
  can(e) { return !!(this._graph[this.stateName] && this._graph[this.stateName][e]); }
}

class Machine {
  constructor() {
    this.states = [];
    this._automat = null;
  }

  _hydrate() {
    const s = loadState();
    if (s.machineData) Object.assign(this, s.machineData);
    
    this._automat = s.fsm ? Automat.deserialize(s.fsm, this.states) : new Automat({ states: this.states });
    for (const key in this._automat.states) {
        this._automat.states[key].machine = this;
    }
  }

  _persist() {
    const s = loadState();
    if (this._automat) {
        s.fsm = this._automat.serialize();
        s.ui_state = s.fsm.state;
        s.ui_color = s.fsm.color;
        s.ui_graph = s.fsm.graph;
        s.ui_colors = s.fsm.colors;
    }
    const data = {};
    for (const key of Object.keys(this)) {
        if (key !== 'states' && key !== '_automat') {
            data[key] = this[key];
            s[key] = this[key]; // Expose to state inspector visually
        }
    }
    s.machineData = data;
    if (typeof this.syncUI === 'function') this.syncUI(s);
    dumpState(s);
  }

  onUp() {
    this._hydrate();
    if (this._automat && this._automat.current && typeof this._automat.current.onUp === 'function') {
        this._automat.current.onUp();
    }
    this._persist();
  }

  onTimer(t) {
    this._hydrate();
    if (this._automat) this._automat.onTimer(t);
    this._persist();
  }

  onMessage(msg) {
    this._hydrate();
    if (this._automat) this._automat.onMessage(msg);
    this._persist();
  }
}
`;

