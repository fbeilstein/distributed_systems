// Timeout-Free Failure Detector (Aguilera, Chen, Toueg 1997)
// Enhanced with Automat FSM for visual segmentation.
// IDLE (Blue): Passive listening or forwarding heartbeats.
// INIT (Green): Specifically initiating a new heartbeat chain.

const DELAY_BETWEEN_PINGS = 15;
const NUM_NODES = 4;
const INITIATION_INTERVAL = DELAY_BETWEEN_PINGS * NUM_NODES;
const SUSPICION_THRESHOLD = 2;

// FSM Definition: 'IDLE' for passive/forwarding, 'INIT' for active initiation
const fsmDef = {
    initial: 'IDLE',
    states: {
        'IDLE': { on: { 'START_INIT': 'INIT' }, color: '#3182bd' },
        'INIT': { on: { 'DONE_INIT': 'IDLE' }, color: '#2ca02c' }
    }
};

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        const initialCounters = {};
        for (const id of allServerIds) {
            if (parseInt(id) !== serverId) initialCounters[id] = 0;
        }

        const fsm = new Automat(fsmDef);

        dumpState({
            alive: allServerIds.reduce((acc, id) => { acc[id] = true; return acc; }, {}),
            counters: initialCounters,
            seenParticipants: {},
            outbox: [],
            seqNum: 0,
            fsm: fsm.serialize()
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
    if (!s.fsm) return;

    const fsm = Automat.deserialize(s.fsm);

    // 1. Staggered Initiation (Staggered every 15 ticks)
    const isOurTurn = (tick % INITIATION_INTERVAL === (serverId * DELAY_BETWEEN_PINGS) % INITIATION_INTERVAL);

    if (isOurTurn) {
        s.seqNum++;
        const msgId = `${serverId}-${s.seqNum}`;
        if (!s.seenParticipants) s.seenParticipants = {};
        s.seenParticipants[msgId] = [serverId];

        // Transition to INIT state only when we are the SOURCE of the chain
        fsm.transition('START_INIT');

        const path = [serverId];
        const targets = allServerIds.filter(id => id !== serverId);
        for (const target of targets) {
            s.outbox.push({ to: target, payload: { type: 'HB', id: msgId, path: path } });
        }
    }

    // 2. FSM Maintenance
    // Return to IDLE after we finish flushing the INITIATION outbox
    if (fsm.state === 'INIT' && s.outbox.length === 0) {
        fsm.transition('DONE_INIT');
    }

    // 3. Balanced Failure Detection
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

    s.fsm = fsm.serialize();
    processOutbox(s);
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const m = message.payload;
    if (m.type !== 'HB') return;

    // Note: Forwarding does NOT trigger INIT state now.
    // Forwarding occurs in the IDLE state to distinguish it from initiation.

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

        const targets = allServerIds.filter(id => !newPath.includes(id));
        for (const target of targets) {
            s.outbox.push({ to: target, payload: { type: 'HB', id: m.id, path: newPath } });
        }
    }

    dumpState(s);
}
