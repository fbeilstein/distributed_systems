// Timeout-Free Failure Detector (Aguilera, Chen, Toueg 1997)
// Corrected: multi-hop propagation + balanced counter logic.

const DELAY_BETWEEN_PINGS = 15;
const NUM_NODES = 4;
const INITIATION_INTERVAL = DELAY_BETWEEN_PINGS * NUM_NODES;
const SUSPICION_THRESHOLD = 2;

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        const initialCounters = {};
        for (const id of allServerIds) {
            // We only track progress of PEERS. Tracking s.counters[serverId] 
            // is biased (we see ourselves more often than peers).
            if (parseInt(id) !== serverId) {
                initialCounters[id] = 0;
            }
        }
        dumpState({
            alive: allServerIds.reduce((acc, id) => { acc[id] = true; return acc; }, {}),
            counters: initialCounters,
            seenParticipants: {},    // [msgId]: array of node IDs already processed for this msg
            outbox: [],
            seqNum: 0
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

    // 1. Staggered Initiation (0, 15, 30, 45...)
    const isOurTurn = (tick % INITIATION_INTERVAL === (serverId * DELAY_BETWEEN_PINGS) % INITIATION_INTERVAL);

    if (isOurTurn) {
        s.seqNum++;
        const msgId = `${serverId}-${s.seqNum}`;

        // Track the participants we've processed for this heartbeat
        if (!s.seenParticipants) s.seenParticipants = {};
        s.seenParticipants[msgId] = [serverId];

        // We do NOT increment a counter for ourselves here because 
        // we use peer-to-peer comparison for suspicion.

        const path = [serverId];
        const targets = allServerIds.filter(id => id !== serverId);
        for (const target of targets) {
            s.outbox.push({ to: target, payload: { type: 'HB', id: msgId, path: path } });
        }
    }

    // 2. Balanced Failure Detection
    // Suspect a peer if their counter lags significantly behind the MOST ACTIVE PEER.
    let maxPeerCounter = 0;
    for (const id in s.counters) {
        if (s.counters[id] > maxPeerCounter) maxPeerCounter = s.counters[id];
    }

    for (const idStr in s.counters) {
        const id = parseInt(idStr);
        // We only judge peers against other peers.
        if (maxPeerCounter - s.counters[id] >= SUSPICION_THRESHOLD) {
            s.alive[id] = false;
        } else {
            s.alive[id] = true;
        }
    }

    processOutbox(s);
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const m = message.payload;
    if (m.type !== 'HB') return;

    if (!s.seenParticipants) s.seenParticipants = {};
    if (!s.seenParticipants[m.id]) s.seenParticipants[m.id] = [];

    let hasNewInfo = false;
    for (const pid of m.path) {
        // Increment counter if we see a "new" participant (or new heartbeat)
        if (!s.seenParticipants[m.id].includes(pid)) {
            s.seenParticipants[m.id].push(pid);
            // We only maintain counters for PEERS.
            if (pid !== serverId) {
                s.counters[pid] = (s.counters[pid] || 0) + 1;
            }
            hasNewInfo = true;
        }
    }

    if (hasNewInfo) {
        // Determine the extended path to forward
        let newPath = [...m.path];
        if (!newPath.includes(serverId)) {
            newPath.push(serverId);
            if (!s.seenParticipants[m.id].includes(serverId)) {
                s.seenParticipants[m.id].push(serverId);
            }
        }

        // Forward to the neighbors that haven't appeared in the path yet.
        const targets = allServerIds.filter(id => !newPath.includes(id));
        for (const target of targets) {
            s.outbox.push({ to: target, payload: { type: 'HB', id: m.id, path: newPath } });
        }
    }

    dumpState(s);
}
