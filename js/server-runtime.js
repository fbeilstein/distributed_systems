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
 * @param {object} context - { serverId, tick, state, outbox, allServerIds }
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
    const sendMessage = (target, payload) => {
        outbox.push({
            from: context.serverId,
            to: target,
            payload: JSON.parse(JSON.stringify(payload || {})),
            sendTick: context.tick,
        });
    };

    try {
        // Wrap user code: inject Automat class, then user functions, then call handler
        const wrappedCode = `
      ${AUTOMAT_SOURCE}
      ${code}
      if (typeof ${handlerName} === 'function') {
        ${handlerName}(${arg !== undefined ? '__arg__' : ''});
      }
    `;

        const fn = new Function(
            'loadState', 'dumpState', 'sendMessage',
            'serverId', 'allServerIds', '__arg__',
            wrappedCode
        );

        fn(loadState, dumpState, sendMessage, context.serverId, context.allServerIds, arg);
    } catch (e) {
        error = e.message || String(e);
    }

    return { state: currentState, outbox, error };
}

