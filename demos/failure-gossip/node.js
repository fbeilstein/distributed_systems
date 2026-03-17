// Gossip-Based Failure Detection
// Each node maintains a membership list. Every GOSSIP_INTERVAL ticks, it picks
// a random peer and sends its full membership list (heartbeat counters).
// If a node's counter hasn't increased in FAILURE_THRESHOLD gossip rounds, mark failed.

const DELAY_BETWEEN_GOSSIPS = 5;
const FAILURE_THRESHOLD = 2;  // rounds without counter increase = suspect
const CLEANUP_THRESHOLD = 3;  // rounds after suspect = failed logic

// FSM Definition: 'IDLE' for passive listening, 'GOSSIP' for active broadcasting
const fsmDef = {
    initial: 'IDLE',
    states: {
        'IDLE': { on: { 'START_GOSSIP': 'GOSSIP' }, color: '#3182bd' },
        'GOSSIP': { on: { 'DONE_GOSSIP': 'IDLE' }, color: '#ff7f0e' }
    }
};

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

        const fsm = new Automat(fsmDef);

        dumpState({
            members,
            round: 0,
            lastGossipTick: -100,
            fsm: fsm.serialize()
        });
    }
}

function onTimer(tick) {
    let s = loadState();
    if (!s.fsm) return;

    s.tick = tick;
    const fsm = Automat.deserialize(s.fsm);

    // Return to IDLE 1 tick after doing a broadcast
    if (fsm.state === 'GOSSIP' && tick > s.lastGossipTick) {
        fsm.transition('DONE_GOSSIP');
    }

    // Increment our own heartbeat counter each tick
    s.members[serverId].heartbeat++;
    s.members[serverId].localTime = tick;
    s.members[serverId].status = 'alive';

    const numNodes = allServerIds.length;
    const GOSSIP_INTERVAL = DELAY_BETWEEN_GOSSIPS * numNodes;

    // Staggered Round-Robin Turn
    if (tick % GOSSIP_INTERVAL === (serverId * DELAY_BETWEEN_GOSSIPS) % GOSSIP_INTERVAL) {
        s.round++;

        // Transition fsm to GOSSIP during our broadcast turn
        fsm.transition('START_GOSSIP');
        s.lastGossipTick = tick;

        // Broadcast to all other alive peers immediately
        const alive = allServerIds.filter(id => id !== serverId && s.members[id] && s.members[id].status !== 'failed');
        for (const target of alive) {
            sendMessage(target, { type: 'GOSSIP', members: s.members });
        }

        // Check for failures: anyone whose heartbeat hasn't moved in enough global rounds
        for (const [idStr, m] of Object.entries(s.members)) {
            const id = parseInt(idStr);
            if (id === serverId) continue;

            const roundsSinceSeen = (tick - m.localTime) / GOSSIP_INTERVAL;
            if (roundsSinceSeen > CLEANUP_THRESHOLD) {
                m.status = 'failed';
            } else if (roundsSinceSeen > FAILURE_THRESHOLD) {
                m.status = 'suspect';
            } else if (m.status !== 'failed') {
                m.status = 'alive';
            }
        }
    }

    s.fsm = fsm.serialize();
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
                    local.status = 'alive';    // Always resurrect if heartbeat increments!
                }
            }
        }
        // Removed GOSSIP_REPLY to prevent visual starburst clutter.
        // Pure PUSH-based gossip anti-entropy is effective enough.
    }

    dumpState(s);
}
