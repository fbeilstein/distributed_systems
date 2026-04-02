class State {
  constructor() {
    this.automat = null;
    this.machine = null;
    this._timeouts = {}; // { name: { ticks, callback } }
  }

  /** Subclasses should return [displayName, color] */
  getState() { return [this.name || 'unknown', '#ccc']; }

  // Transition name (internal ID) - defaults to class name ( intuitive, case-sensitive )
  get name() { return this.constructor.name; }

  onEnter() { }
  onExit() { }
  onUp() { }
  onTimer(tick) { }
  onMessage(msg) { }

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

  /** Get active timers with remaining ticks: { name: ticksLeft, ... } */
  get activeTimers() {
    const result = {};
    for (const [name, t] of Object.entries(this._timeouts)) {
      result[name] = t.ticks;
    }
    return result;
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

    // Trigger onEnter for the initial state if NOT handled by Machine
    if (!this.skipInitialEnter && this.current && this.current.onEnter) {
      this.current.onEnter();
    }
  }

  onUp() { if (this.current) this.current.onUp(); }

  onTimer(tick) {
    if (!this.current) return;
    const cur = this.current;
    const timers = cur._timeouts;
    for (const name in timers) {
      const t = timers[name];
      if (--t.ticks <= 0) {
        const cbName = t.callback;
        const cb = cur[cbName];
        delete timers[name];
        if (typeof cb === 'function') {
          cb.call(cur);
        }
      }
    }
    if (this.current === cur) this.current.onTimer(tick);
  }

  onMessage(msg) {
    if (!this.current) return;
    const cur = this.current;
    const type = msg.payload && msg.payload.type;
    const conventionName = type ? 'on' + type : null;

    // 1. Explicit Registration
    if (typeof cur.registerMessageTypes === 'function') {
      const map = cur.registerMessageTypes();
      if (map && type in map) {
        const handler = map[type];
        if (typeof handler === 'function') return handler.call(cur, msg);
        if (typeof handler === 'string' && typeof cur[handler] === 'function') {
          return cur[handler](msg);
        }
      }
    }

    // 2. Naming Convention (State-level)
    if (conventionName && typeof cur[conventionName] === 'function') {
      return cur[conventionName](msg);
    }

    // 3. Naming Convention (Machine-level fallback)
    if (conventionName && cur.machine && typeof cur.machine[conventionName] === 'function') {
      return cur.machine[conventionName](msg);
    }

    // 4. General Fallback
    if (this.current === cur) cur.onMessage(msg);
  }

  transition(targetName, reenter = true) {
    const next = (this._graph[this.stateName] && this._graph[this.stateName][targetName]) || targetName;
    if (!this.states[next]) return false;

    // Warn on undeclared transitions (helps catch typos and missing canTransition entries)
    if (this._graph[this.stateName] && Object.keys(this._graph[this.stateName]).length > 0 && !this._graph[this.stateName][targetName]) {
      console.warn('[Automat] Undeclared transition: ' + this.stateName + ' → ' + targetName);
    }

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
      colors: this._colors
    };
  }

  static deserialize(obj, stateInstances) {
    const a = new Automat({
      initial: obj.stateName,
      states: stateInstances,
      graph: obj.graph,
      colors: obj.colors,
      skipInitialEnter: true
    });
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
  constructor(config = {}) {
    this._config = config;
    this.states = [];
    this._automat = null;
  }

  _hydrate() {
    const s = loadState();
    if (s.machineData) {
      for (const key in s.machineData) {
        if (key !== 'states') this[key] = s.machineData[key];
      }
    }

    // Truly fresh if no serialized FSM or no valid state name
    const isFresh = !s.fsm || !s.fsm.stateName;
    if (isFresh) {
      const automatConfig = Object.assign({ states: this.states, skipInitialEnter: true }, this._config);
      this._automat = new Automat(automatConfig);
    } else {
      this._automat = Automat.deserialize(s.fsm, this.states);
    }

    for (const key in this._automat.states) {
      const stateObj = this._automat.states[key];
      stateObj.machine = this;
    }

    // Trigger initial onEnter ONLY on a fresh start AND after links are settled
    if (isFresh && this._automat.current && this._automat.current.onEnter) {
      this._automat.current.onEnter();
    }
  }

  _persist() {
    const s = loadState();
    if (typeof this.syncUI === 'function') this.syncUI();
    if (this._automat) {
      s.fsm = this._automat.serialize();
      s.ui_state = s.fsm.state;
      s.ui_color = s.fsm.color;
      s.ui_graph = s.fsm.graph;
      s.ui_colors = s.fsm.colors;
    }
    const data = {};
    for (const key of Object.keys(this)) {
      if (key !== 'states' && key !== '_automat' && key !== '_config') {
        data[key] = this[key];
        s[key] = this[key]; // Expose to state inspector visually
      }
    }
    s.machineData = data;
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

  onDown() {
    this._hydrate();
    if (this._automat && this._automat.current && typeof this._automat.current.onDown === 'function') {
      this._automat.current.onDown();
    }
    this._persist();
  }
}
