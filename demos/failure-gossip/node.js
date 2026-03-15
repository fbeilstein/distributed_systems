// Gossip-Based Failure Detection
// Each node maintains a membership list. Every GOSSIP_INTERVAL ticks, it picks
// a random peer and sends its full membership list (heartbeat counters).
// If a node's counter hasn't increased in FAILURE_THRESHOLD gossip rounds, mark failed.

const GOSSIP_INTERVAL = 8;
const FAILURE_THRESHOLD = 4;  // rounds without counter increase = failed
const CLEANUP_THRESHOLD = 8;  // rounds after failed = removed from list

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        const members = {};
        for (const id of allServerIds) {
            members[id] = {
                heartbeat: 0,
                localTime: 0,   // local tick when we last saw this counter increase
                status: 'alive' // 'alive' | 'suspect' | 'failed'
            };
        }
        dumpState({
            members,
            round: 0,
            outbox: [],
        });
    }
}

function processOutbox(s) {
    if (s.outbox && s.outbox.length > 0) {
        const msg = s.outbox.shift();
        sendMessage(msg.to, msg.payload);
    }
}

function onTimer(tick) {
    let s = loadState();
    s.tick = tick;

    // Increment our own heartbeat counter each tick
    s.members[serverId].heartbeat++;
    s.members[serverId].localTime = tick;
    s.members[serverId].status = 'alive';

    // Gossip periodically
    if (tick % GOSSIP_INTERVAL === serverId % GOSSIP_INTERVAL) {
        s.round++;

        // Pick a random peer to gossip with
        const alive = allServerIds.filter(id => id !== serverId && s.members[id] && s.members[id].status !== 'failed');
        if (alive.length > 0) {
            const target = alive[getRandom(0, alive.length - 1)];
            s.outbox.push({ to: target, payload: { type: 'GOSSIP', members: s.members } });
        }

        // Check for failures: anyone whose heartbeat hasn't moved in enough rounds
        for (const [idStr, m] of Object.entries(s.members)) {
            const id = parseInt(idStr);
            if (id === serverId) continue;
            const roundsSinceSeen = (tick - m.localTime) / GOSSIP_INTERVAL;
            if (roundsSinceSeen > CLEANUP_THRESHOLD) {
                // Remove from active list
                m.status = 'failed';
            } else if (roundsSinceSeen > FAILURE_THRESHOLD) {
                m.status = 'suspect';
            } else if (m.status !== 'failed') {
                m.status = 'alive';
            }
        }
    }

    processOutbox(s);
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const m = message.payload;

    if (m.type === 'GOSSIP') {
        // Merge: take max heartbeat counter for each member
        for (const [idStr, remote] of Object.entries(m.members)) {
            const id = parseInt(idStr);
            if (!s.members[id]) {
                s.members[id] = { ...remote };
            } else {
                const local = s.members[id];
                if (remote.heartbeat > local.heartbeat) {
                    local.heartbeat = remote.heartbeat;
                    local.localTime = s.tick;  // We just learned about a new value
                    if (local.status !== 'failed') local.status = 'alive';
                }
            }
        }
        // Respond with our own gossip (anti-entropy exchange)
        s.outbox.push({ to: message.from, payload: { type: 'GOSSIP_REPLY', members: s.members } });
    }

    if (m.type === 'GOSSIP_REPLY') {
        for (const [idStr, remote] of Object.entries(m.members)) {
            const id = parseInt(idStr);
            if (!s.members[id]) {
                s.members[id] = { ...remote };
            } else {
                const local = s.members[id];
                if (remote.heartbeat > local.heartbeat) {
                    local.heartbeat = remote.heartbeat;
                    local.localTime = s.tick;
                    if (local.status !== 'failed') local.status = 'alive';
                }
            }
        }
    }

    dumpState(s);
}
