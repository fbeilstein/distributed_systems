/**
 * server-runtime.js
 * Executes user-provided JS functions (onUp, onTimer, onMessage) in a controlled scope.
 * Provides the API: loadState(), dumpState(state), sendMessage(target, payload).
 * Also injects the Automat FSM class for demos that use state machines.
 */

import { AUTOMAT_SOURCE } from './automat.js';

/**
 * Run a server handler function in a sandboxed scope.
 * @param {string} handlerName - 'onUp', 'onTimer', or 'onMessage'
 * @param {string} code - The user-provided function body string
 * @param {object} context - { serverId, tick, state, outbox, allServerIds, prng }
 * @param {*} arg - argument passed to the handler (tick for onTimer, message for onMessage)
 * @returns {{ state: object, outbox: Array, error: string|null }}
 */
export function executeHandler(handlerName, code, context, arg) {
    let currentState = JSON.parse(JSON.stringify(context.state));
    const outbox = [];
    let error = null;

    // Build the API functions
    const loadState = () => JSON.parse(JSON.stringify(currentState));
    const dumpState = (state) => {
        currentState = JSON.parse(JSON.stringify(state));
    };
    const sendMessage = (target, payload, timeout, callback) => {
        outbox.push({
            from: context.serverId,
            to: target,
            payload: JSON.parse(JSON.stringify(payload || {})),
            sendTick: context.tick,
            timeout: timeout,
            callback: callback
        });
    };
    // Stateless deterministic hash based on tick and serverId
    const getRandom = (min, max) => {
        const seedBase = context.prng ? context.prng.seed : 42;
        // Create a unique deterministic pseudo-seed for this exact moment
        let h = seedBase ^ context.tick ^ (context.serverId * 0x9E3779B9);

        // Simple Mulberry32 hash to scramble the bits
        h = Math.imul(h ^ (h >>> 15), 1 | h);
        h ^= h + Math.imul(h ^ (h >>> 7), 61 | h);
        const floatVal = ((h ^ (h >>> 14)) >>> 0) / 4294967296;

        return Math.floor(floatVal * (max - min + 1) + min);
    };

    try {
        // Wrap user code: inject Automat class, then user functions, then call handler
        const wrappedCode = `
      const __currentTick__ = ${context.tick};
      ${AUTOMAT_SOURCE}
      ${code}
      if (typeof ${handlerName} === 'function') {
        ${handlerName}(${arg !== undefined ? '__arg__' : ''});
      }
    `;

        const fn = new Function(
            'loadState', 'dumpState', 'sendMessage', 'getRandom', 'prng',
            'serverId', 'allServerIds', '__arg__',
            wrappedCode
        );

        fn(loadState, dumpState, sendMessage, getRandom, context.prng, context.serverId, context.allServerIds, arg);
    } catch (e) {
        error = e.message || String(e);
    }

    return { state: currentState, outbox, error };
}

