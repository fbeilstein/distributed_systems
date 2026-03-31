const DELAY_BETWEEN_GOSSIPS = 5;
const FAILURE_THRESHOLD = 2; // rounds
const CLEANUP_THRESHOLD = 3; // rounds

/**
 * DETERMINISTIC FIRING LOGIC
 * Staggered Round-Robin: each node gossips at its own offset.
 * Users can modify this to change dissemination patterns (e.g., probabilistic).
 */
function shouldGossip(tick) {
    const GOSSIP_INTERVAL = DELAY_BETWEEN_GOSSIPS * allServerIds.length;
    return tick % GOSSIP_INTERVAL === (serverId * DELAY_BETWEEN_GOSSIPS) % GOSSIP_INTERVAL;
}

/**
 * MEMBERSHIP MERGING
 * Updates local membership table with newer heartbeats from peers.
 */
function mergeMembership(localMembers, incomingMembers, currentTick) {
    for (const [idStr, remote] of Object.entries(incomingMembers)) {
        const id = parseInt(idStr);
        const local = localMembers[id];
        if (!local || remote.heartbeat > local.heartbeat) {
            localMembers[id] = {
                heartbeat: remote.heartbeat,
                localTime: currentTick,
                status: 'alive'
            };
        }
    }
}

/**
 * FAILURE DETECTION
 * Evaluates node health based on the "freshness" of their local heartbeat.
 */
function updateFailureDetection(s, tick) {
    const GOSSIP_INTERVAL = DELAY_BETWEEN_GOSSIPS * allServerIds.length;

    for (const [idStr, mem] of Object.entries(s.members)) {
        const id = parseInt(idStr);
        if (id === serverId) continue;

        const roundsSinceSeen = (tick - mem.localTime) / GOSSIP_INTERVAL;
        if (roundsSinceSeen > CLEANUP_THRESHOLD) {
            mem.status = 'failed';
        } else if (roundsSinceSeen > FAILURE_THRESHOLD) {
            mem.status = 'suspect';
        } else {
            // Only recover if not marked failed or if logic allows recovery
            if (mem.status !== 'failed') mem.status = 'alive';
        }
    }

    // Build status string for UI
    s.membership = Object.entries(s.members)
        .filter(([id]) => parseInt(id) !== serverId)
        .map(([id, m]) => `S${id}:${m.status}`)
        .join(' <br> ');
}

/** ---------------- HOOKS ---------------- **/

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        const members = {};
        for (const id of allServerIds) {
            members[id] = { heartbeat: 0, localTime: 0, status: 'alive' };
        }
        s = { members, lastGossipTick: -100, ui_state: 'Idle', ui_color: '#3182bd' };
    }
    dumpState(s);
}

function onTimer(tick) {
    let s = loadState();
    if (!s.members) return;

    // 1. Update own activity
    s.members[serverId].heartbeat++;
    s.members[serverId].localTime = tick;
    s.members[serverId].status = 'alive';

    // 2. Scheduled Gossip logic
    if (shouldGossip(tick)) {
        s.lastGossipTick = tick;
        s.ui_state = 'Gossiping';
        s.ui_color = '#ff7f0e';

        // Disseminate to all alive peers
        const alive = allServerIds.filter(id => id !== serverId && s.members[id].status !== 'failed');
        broadcast(alive, { type: 'GOSSIP', members: s.members }, 'black');
    } else if (tick > s.lastGossipTick + 1) {
        s.ui_state = 'Idle';
        s.ui_color = '#3182bd';
    }

    // 3. Independent failure monitoring
    updateFailureDetection(s, tick);
    dumpState(s);
}

function onMessage(message) {
    if (message.payload.type !== 'GOSSIP') return;

    let s = loadState();
    mergeMembership(s.members, message.payload.members, message.arrivalTick);
    dumpState(s);
}
