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
class Automat {
  /**
   * @param {object} def
   * @param {string} def.initial - Starting state name
   * @param {object} def.states - Map of stateName → { on: { EVENT: targetState }, color: '#hex' }
   */
  constructor(def) {
    this.state = def.initial;
    this._graph = {};
    this._colors = {};

    for (const [name, cfg] of Object.entries(def.states)) {
      this._graph[name] = cfg.on || {};
      if (cfg.color) this._colors[name] = cfg.color;
    }
  }

  /** Check if event can fire from the current state. */
  can(event) {
    const transitions = this._graph[this.state];
    return !!(transitions && transitions[event]);
  }

  /**
   * Fire an event. If valid from the current state, transition to the target
   * state and return true. Otherwise do nothing and return false.
   */
  transition(event) {
    const transitions = this._graph[this.state];
    if (transitions && transitions[event]) {
      this.state = transitions[event];
      return true;
    }
    return false;
  }

  /** Read-only access to the full transition graph. */
  get graph() {
    return this._graph;
  }

  /** Read-only access to the color map. */
  get colors() {
    return this._colors;
  }

  /** Serialize to a plain object suitable for dumpState(). */
  serialize() {
    return {
      state: this.state,
      graph: this._graph,
      colors: this._colors,
    };
  }

  /**
   * Reconstruct an Automat from a previously serialized plain object.
   * @param {object} obj - { state, graph, colors }
   * @returns {Automat}
   */
  static deserialize(obj) {
    // Rebuild the definition from graph + colors
    const def = { initial: obj.state, states: {} };
    for (const [name, transitions] of Object.entries(obj.graph)) {
      def.states[name] = { on: transitions };
      if (obj.colors && obj.colors[name]) {
        def.states[name].color = obj.colors[name];
      }
    }
    const a = new Automat(def);
    a.state = obj.state;
    return a;
  }
}
`;
