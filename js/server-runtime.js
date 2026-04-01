/**
 * server-runtime.js
 * Executes user-provided JS functions (onUp, onTimer, onMessage) in a controlled scope.
 * Provides the API: loadState(), dumpState(state), sendMessage(target, payload).
 * Supports persistent context for "Live Object" (OOP) simulation.
 */

// AUTOMAT_SOURCE is now passed as a constructor parameter (loaded externally)

export class StatefulRuntime {
    constructor(serverId, allServerIds, code, prng, config, automatSource) {
        this.serverId = serverId;
        this.allServerIds = [...allServerIds];
        this.code = code;
        this.prng = prng;
        this.config = config || {};
        this.automatSource = automatSource || '';
        this.tick = 0;
        this.currentState = {};
        this.outbox = [];
        this.error = null;
        this.randomCallCount = 0;

        // The "Sandbox" - created once per recompute
        this._initSandbox();
    }

    _initSandbox() {
        const loadState = () => JSON.parse(JSON.stringify(this.currentState));
        const dumpState = (state) => { this.currentState = JSON.parse(JSON.stringify(state)); };
        const sendMessage = (target, payload, color = 'black') => {
            this.outbox.push({
                from: this.serverId,
                to: target,
                payload: JSON.parse(JSON.stringify(payload || {})),
                sendTick: this.tick,
                color: color
            });
        };
        const broadcast = (targets, payload, color = 'black', at_once = true) => {
            if (!Array.isArray(targets)) return;
            targets.forEach((to, index) => {
                const sendTick = at_once ? this.tick : this.tick + index;
                this.outbox.push({
                    from: this.serverId,
                    to: to,
                    payload: JSON.parse(JSON.stringify(payload || {})),
                    sendTick: sendTick,
                    color: color
                });
            });
        };
        const self = this;
        const getRandom = (min, max) => {
            const seedBase = self.prng ? self.prng.seed : 42;
            let h = seedBase ^ self.tick ^ (self.serverId * 0x9E3779B9) ^ (++self.randomCallCount * 0x517CC1B7);
            h = Math.imul(h ^ (h >>> 15), 1 | h);
            h ^= h + Math.imul(h ^ (h >>> 7), 61 | h);
            const floatVal = ((h ^ (h >>> 14)) >>> 0) / 4294967296;
            return Math.floor(floatVal * (max - min + 1) + min);
        };

        try {
            // The wrapper returns the compiled handlers and the local scope
            const wrappedCode = `
                ${this.automatSource}
                ${this.code}
                return {
                    onUp: typeof onUp === 'function' ? onUp : null,
                    onTimer: typeof onTimer === 'function' ? onTimer : null,
                    onMessage: typeof onMessage === 'function' ? onMessage : null,
                    onDown: typeof onDown === 'function' ? onDown : null
                };
            `;
            const factory = new Function('loadState', 'dumpState', 'sendMessage', 'broadcast', 'getRandom', 'serverId', 'allServerIds', 'config', wrappedCode);
            try {
                // console.log(`[Runtime ${this.serverId}] Initializing sandbox...`);
                this.handlers = factory(loadState, dumpState, sendMessage, broadcast, getRandom, this.serverId, this.allServerIds, this.config);
                // console.log(`[Runtime ${this.serverId}] Initialized handlers:`, Object.keys(this.handlers).filter(k => !!this.handlers[k]));
            } catch (e) {
                console.error(`[Runtime ${this.serverId}] Factory failed:`, e);
                this.error = e.message || String(e);
            }
        } catch (e) {
            this.error = e.message || String(e);
        }
    }

    execute(handlerName, tick, arg) {
        this.tick = tick;
        this.outbox = [];
        this.randomCallCount = 0;
        if (this.error) return { state: this.currentState, outbox: [], error: this.error };

        // Force a "Hard Reboot" (fresh closure) on onUp to clear transient memory
        if (handlerName === 'onUp') {
            this._initSandbox();
        }

        try {
            const handler = this.handlers[handlerName];
            if (typeof handler === 'function') {
                handler(arg);
            }
        } catch (e) {
            this.error = e.message || String(e);
        }

        return { state: this.currentState, outbox: this.outbox, error: this.error };
    }
}

