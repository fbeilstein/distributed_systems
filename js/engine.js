/**
 * engine.js
 * Discrete-event simulation engine. Stores complete state history for scrubber access.
 * Deterministic: same inputs (code, crashes, message overrides, seed) → same output.
 */

import { PRNG } from './prng.js';
import { StatefulRuntime } from './server-runtime.js';

/** Default timeline length */
export const DEFAULT_MAX_TICKS = 100;

/**
 * Create a new server object.
 */
export function createServer(id, name) {
    return {
        id,
        name: name || `S${id}`,
        code: `function onUp() {}\nfunction onTimer(tick) {}\nfunction onMessage(message) {}`,
        crashIntervals: [],
    };
}

/**
 * Check if a server is up at a given tick.
 */
function isServerUp(server, tick) {
    for (const [down, up] of server.crashIntervals) {
        if (tick >= down && (up === null || tick < up)) {
            return false;
        }
    }
    return true;
}

/**
 * Toggle crash at a specific tick on a server.
 * If server is up at tick → starts a crash.
 * If server is down at tick → ends the crash at that tick.
 */
export function toggleCrash(server, tick) {
    // Check if there's an interval where server is down at this tick
    for (let i = 0; i < server.crashIntervals.length; i++) {
        const [down, up] = server.crashIntervals[i];
        if (tick >= down && (up === null || tick < up)) {
            // Server is down here → split: end this interval at tick (recover)
            if (tick === down) {
                // Clicking exactly at the start of a crash → remove it
                server.crashIntervals.splice(i, 1);
            } else {
                server.crashIntervals[i] = [down, tick];
            }
            return;
        }
    }
    // Server is up here → create a new crash interval starting at tick
    server.crashIntervals.push([tick, null]);
    // Sort intervals by start
    server.crashIntervals.sort((a, b) => a[0] - b[0]);
    // Merge overlapping/adjacent
    mergeIntervals(server);
}

function mergeIntervals(server) {
    const intervals = server.crashIntervals;
    if (intervals.length <= 1) return;
    const merged = [intervals[0]];
    for (let i = 1; i < intervals.length; i++) {
        const prev = merged[merged.length - 1];
        const curr = intervals[i];
        if (prev[1] === null || curr[0] <= prev[1]) {
            prev[1] = prev[1] === null ? null : (curr[1] === null ? null : Math.max(prev[1], curr[1]));
        } else {
            merged.push(curr);
        }
    }
    server.crashIntervals = merged;
}


export class Engine {
    constructor(seed = 42, maxTicks = DEFAULT_MAX_TICKS) {
        this.seed = seed;
        this.maxTicks = maxTicks;
        this.servers = [];
        this.messages = [];          // All messages (user overrides preserved)
        this.history = [];           // SimState[] indexed by tick
        this.userOverrides = new Map(); // key → { arrivalTick, lost }
        this.onChange = null;        // callback when recomputation is done
        this.config = {};
    }

    /**
     * Message key for matching across recomputations.
     */
    static messageKey(from, to, sendTick, type = "") {
        return `${from}→${to}@${sendTick}:${type}`;
    }

    /**
     * Add a server, returns its id.
     */
    addServer(name) {
        const id = this.servers.length;
        this.servers.push(createServer(id, name));
        return id;
    }

    /**
     * Remove the last server.
     */
    removeServer() {
        if (this.servers.length <= 1) return;
        const removed = this.servers.pop();
        // Remove any overrides for messages involving the removed server
        for (const [key] of this.userOverrides) {
            if (key.startsWith(`${removed.id}→`) || key.includes(`→${removed.id}@`)) {
                this.userOverrides.delete(key);
            }
        }
    }

    /**
     * Set a user override for a message's arrival tick.
     */
    setArrivalOverride(messageId, arrivalTick) {
        const msg = this.messages.find(m => m.id === messageId);
        if (!msg) return;
        const key = Engine.messageKey(msg.from, msg.to, msg.sendTick, msg.payload ? msg.payload.type : "");
        const existing = this.userOverrides.get(key) || {};
        existing.arrivalTick = arrivalTick;
        this.userOverrides.set(key, existing);
    }

    /**
     * Toggle the lost state of a message.
     */
    toggleMessageLost(messageId) {
        const msg = this.messages.find(m => m.id === messageId);
        if (!msg) return;
        const key = Engine.messageKey(msg.from, msg.to, msg.sendTick, msg.payload ? msg.payload.type : "");
        const existing = this.userOverrides.get(key) || {};
        existing.lost = !existing.lost;
        this.userOverrides.set(key, existing);
    }

    /**
     * Main simulation: recompute the entire timeline from scratch.
     */
    recompute(config) {
        if (config) this.config = config;
        const prng = new PRNG(this.seed);
        const allServerIds = this.servers.map(s => s.id);
        const messages = [];
        const history = [];

        // Initialize StatefulRuntimes for all servers
        const runtimes = new Map();
        for (const server of this.servers) {
            // Isolate PRNG per server to prevent cross-node butterfly effect timeline divergence
            const serverPRNG = new PRNG(this.seed + server.id * 31337);
            runtimes.set(server.id, new StatefulRuntime(server.id, allServerIds, server.code, serverPRNG, this.config));
        }

        const serverWasUp = new Map();
        for (const s of this.servers) {
            serverWasUp.set(s.id, false);
        }

        for (let tick = 0; tick <= this.maxTicks; tick++) {
            for (const server of this.servers) {
                const up = isServerUp(server, tick);
                const wasUp = serverWasUp.get(server.id);
                const rt = runtimes.get(server.id);

                if (!up) {
                    serverWasUp.set(server.id, false);
                    continue;
                }

                // If just became up (first tick or recovery), call onUp
                if (!wasUp) {
                    const result = rt.execute('onUp', tick);
                    if (result.error) {
                        rt.currentState = { ...rt.currentState, __error__: result.error };
                    }
                    // Process outbox
                    for (const out of result.outbox) {
                        this._addMessage(messages, out, prng);
                    }
                    serverWasUp.set(server.id, true);
                }

                // Call onTimer
                {
                    const result = rt.execute('onTimer', tick, tick);
                    if (result.error) {
                        rt.currentState = { ...rt.currentState, __error__: result.error };
                    }
                    for (const out of result.outbox) {
                        this._addMessage(messages, out, prng);
                    }
                }

                // Process arriving messages
                const arriving = messages.filter(
                    m => m.to === server.id && m.arrivalTick === tick && !m.lost
                );
                for (const msg of arriving) {
                    const result = rt.execute('onMessage', tick, {
                        from: msg.from,
                        sendTick: msg.sendTick,
                        arrivalTick: msg.arrivalTick,
                        payload: msg.payload
                    });
                    if (result.error) {
                        rt.currentState = { ...rt.currentState, __error__: result.error };
                    }
                    for (const out of result.outbox) {
                        this._addMessage(messages, out, prng);
                    }
                }

                serverWasUp.set(server.id, true);
            }

            // Snapshot the state at this tick for visualization
            const snapshot = {};
            for (const server of this.servers) {
                snapshot[server.id] = JSON.parse(JSON.stringify(runtimes.get(server.id).currentState));
            }
            history.push({
                tick,
                serverStates: snapshot,
            });
        }

        this.messages = messages;
        this.history = history;

        if (this.onChange) this.onChange();
    }

    /**
     * Add a message, applying any user overrides.
     */
    _addMessage(messages, outgoing, prng) {
        // Ignore messages to non-existent servers
        if (!this.servers.find(s => s.id === outgoing.to)) return;

        // Extract payload type to differentiate simultaneous packets
        const typeStr = outgoing.payload ? outgoing.payload.type : "";

        // Check if this message already exists (duplicate send of the exact same type in the same tick)
        const existing = messages.find(
            m => m.from === outgoing.from && m.to === outgoing.to && m.sendTick === outgoing.sendTick && (m.payload ? m.payload.type : "") === typeStr
        );
        // We do NOT want to skip if the types are DIFFERENT (e.g. REPLICATE vs SYNC_DATA_CHAIN)
        if (existing) return;

        // Use a deterministic hash for latency to prevent crash events on one node
        // from advancing the PRNG and shifting latencies for unrelated nodes.
        const typeHash = typeStr.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
        const msgHash = (outgoing.sendTick * 31 + outgoing.from * 17 + outgoing.to * 7 + typeHash + this.seed);
        let arrivalTick = outgoing.sendTick + 1 + (msgHash % 5); // Default latency: 1-5 ticks
        let lost = false;

        const key = Engine.messageKey(outgoing.from, outgoing.to, outgoing.sendTick, typeStr);

        // Apply user overrides
        const override = this.userOverrides.get(key);
        if (override) {
            if (override.arrivalTick !== undefined) arrivalTick = override.arrivalTick;
            if (override.lost !== undefined) lost = override.lost;
        }

        // Clamp arrival to be >= sendTick + 1 and <= maxTicks
        arrivalTick = Math.max(outgoing.sendTick + 1, arrivalTick);
        arrivalTick = Math.min(arrivalTick, this.maxTicks);

        messages.push({
            id: messages.length,
            from: outgoing.from,
            to: outgoing.to,
            sendTick: outgoing.sendTick,
            arrivalTick,
            payload: outgoing.payload,
            lost,
            color: outgoing.color || 'black',
        });
    }

    /**
     * Get the state at a specific tick.
     */
    getStateAtTick(tick) {
        if (tick < 0 || tick >= this.history.length) return null;
        return this.history[tick];
    }
}
