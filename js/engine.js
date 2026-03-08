/**
 * engine.js
 * Discrete-event simulation engine. Stores complete state history for scrubber access.
 * Deterministic: same inputs (code, crashes, message overrides, seed) → same output.
 */

import { PRNG } from './prng.js';
import { executeHandler } from './server-runtime.js';

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
    }

    /**
     * Message key for matching across recomputations.
     */
    static messageKey(from, to, sendTick) {
        return `${from}→${to}@${sendTick}`;
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
        const key = Engine.messageKey(msg.from, msg.to, msg.sendTick);
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
        const key = Engine.messageKey(msg.from, msg.to, msg.sendTick);
        const existing = this.userOverrides.get(key) || {};
        existing.lost = !existing.lost;
        this.userOverrides.set(key, existing);
    }

    /**
     * Main simulation: recompute the entire timeline from scratch.
     */
    recompute() {
        const prng = new PRNG(this.seed);
        const allServerIds = this.servers.map(s => s.id);
        const messages = [];
        const history = [];

        // Server states: persistent across ticks, preserved across crashes
        const serverStates = new Map();
        const serverWasUp = new Map();
        for (const s of this.servers) {
            serverStates.set(s.id, {});
            serverWasUp.set(s.id, false);
        }

        for (let tick = 0; tick <= this.maxTicks; tick++) {
            for (const server of this.servers) {
                const up = isServerUp(server, tick);
                const wasUp = serverWasUp.get(server.id);

                if (!up) {
                    serverWasUp.set(server.id, false);
                    continue;
                }

                const currentState = serverStates.get(server.id);

                // If just became up (first tick or recovery), call onUp
                if (!wasUp) {
                    const result = executeHandler('onUp', server.code, {
                        serverId: server.id,
                        tick,
                        state: currentState,
                        allServerIds,
                    });
                    serverStates.set(server.id, result.state);
                    if (result.error) {
                        serverStates.set(server.id, { ...result.state, __error__: result.error });
                    }
                    // Process outbox
                    for (const out of result.outbox) {
                        this._addMessage(messages, out, prng);
                    }
                    serverWasUp.set(server.id, true);
                }

                // Call onTimer
                {
                    const result = executeHandler('onTimer', server.code, {
                        serverId: server.id,
                        tick,
                        state: serverStates.get(server.id),
                        allServerIds,
                    }, tick);
                    serverStates.set(server.id, result.state);
                    if (result.error) {
                        serverStates.set(server.id, { ...result.state, __error__: result.error });
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
                    const result = executeHandler('onMessage', server.code, {
                        serverId: server.id,
                        tick,
                        state: serverStates.get(server.id),
                        allServerIds,
                    }, { from: msg.from, payload: msg.payload });
                    serverStates.set(server.id, result.state);
                    if (result.error) {
                        serverStates.set(server.id, { ...result.state, __error__: result.error });
                    }
                    for (const out of result.outbox) {
                        this._addMessage(messages, out, prng);
                    }
                }

                serverWasUp.set(server.id, true);
            }

            // Snapshot the state at this tick
            const snapshot = {};
            for (const s of this.servers) {
                snapshot[s.id] = JSON.parse(JSON.stringify(serverStates.get(s.id)));
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

        const key = Engine.messageKey(outgoing.from, outgoing.to, outgoing.sendTick);

        // Check if this message already exists (duplicate send in same tick)
        const existing = messages.find(
            m => m.from === outgoing.from && m.to === outgoing.to && m.sendTick === outgoing.sendTick
        );
        if (existing) return; // Skip duplicates

        // Default latency: 1-5 ticks
        let arrivalTick = outgoing.sendTick + prng.nextInt(1, 5);
        let lost = false;

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
