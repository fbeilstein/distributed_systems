// Timeout-Free Failure Detector (Aguilera, Chen, Toueg 1997)
// Nodes propagate heartbeat chains. Failure is detected by comparing
// counters across peers — no fixed timeout needed.

const DELAY_BETWEEN_PINGS = 15;
const NUM_NODES = config.nodes || 4;
const INITIATION_INTERVAL = DELAY_BETWEEN_PINGS * NUM_NODES;
const SUSPICION_THRESHOLD = 2;
const PEERS = allServerIds.filter(id => id !== serverId);

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        const counters = {};
        const alive = {};
        for (const id of PEERS) {
            counters[id] = 0;
            alive[id] = true;
        }
        s = {
            alive,
            counters,
            seenParticipants: {},
            seqNum: 0,
            ui_state: 'Idle',
            ui_color: '#3182bd'
        };
    }
    dumpState(s);
}

function onTimer(tick) {
    let s = loadState();

    // Staggered initiation
    const isOurTurn = (tick % INITIATION_INTERVAL === (serverId * DELAY_BETWEEN_PINGS) % INITIATION_INTERVAL);

    if (isOurTurn) {
        s.seqNum++;
        const msgId = `${serverId}-${s.seqNum}`;
        if (!s.seenParticipants) s.seenParticipants = {};
        s.seenParticipants[msgId] = [serverId];

        s.ui_state = 'Initiating';
        s.ui_color = '#2ca02c';

        broadcast(PEERS, { type: 'HB', id: msgId, path: [serverId] }, 'black', false);
    } else {
        s.ui_state = 'Idle';
        s.ui_color = '#3182bd';
    }

    // Failure detection: compare counters
    let maxPeerCounter = 0;
    for (const id in s.counters) {
        if (s.counters[id] > maxPeerCounter) maxPeerCounter = s.counters[id];
    }
    for (const idStr in s.counters) {
        const id = parseInt(idStr);
        if (maxPeerCounter - s.counters[id] >= SUSPICION_THRESHOLD) {
            s.alive[id] = false;
        } else {
            s.alive[id] = true;
        }
    }

    for (const id of PEERS)
        s[`S${id}`] = s.alive[id] ? '✅ OK' : '⚠️ SUSPECT';

    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const m = message.payload;
    if (m.type !== 'HB') { dumpState(s); return; }

    if (!s.seenParticipants) s.seenParticipants = {};
    if (!s.seenParticipants[m.id]) s.seenParticipants[m.id] = [];

    let hasNewInfo = false;
    for (const pid of m.path) {
        if (!s.seenParticipants[m.id].includes(pid)) {
            s.seenParticipants[m.id].push(pid);
            if (pid !== serverId) {
                s.counters[pid] = (s.counters[pid] || 0) + 1;
            }
            hasNewInfo = true;
        }
    }

    if (hasNewInfo) {
        let newPath = [...m.path];
        if (!newPath.includes(serverId)) {
            newPath.push(serverId);
            if (!s.seenParticipants[m.id].includes(serverId)) {
                s.seenParticipants[m.id].push(serverId);
            }
        }
        const targets = PEERS.filter(id => !newPath.includes(id));
        broadcast(targets, { type: 'HB', id: m.id, path: newPath }, 'black', false);
    }

    dumpState(s);
}
