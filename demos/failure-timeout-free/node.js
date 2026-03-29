// Timeout-Free Failure Detector (Aguilera, Chen, Toueg 1997)
// Comparison of counters across heartbeat chains to detect failures.

const DELAY_BETWEEN_PINGS = 15;
const NUM_NODES = config.nodes || 4;
const INITIATION_INTERVAL = DELAY_BETWEEN_PINGS * NUM_NODES;
const SUSPICION_THRESHOLD = 2;
const PEERS = allServerIds.filter(id => id !== serverId);
const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#1abc9c', '#e67e22'];

/** ---------------- ALGORITHM HELPERS ---------------- **/

const getPathColor = (seq, idx) => COLORS[(serverId + seq + idx) % COLORS.length];

function startGossipWave(s) {
    s.seqNum++;
    const chainId = `${serverId}:${s.seqNum}`;
    s.seenInChain[chainId] = [serverId];
    s.ui_state = 'Initiating Wave';
    s.ui_color = 'green';

    PEERS.forEach((target, i) => {
        const color = getPathColor(s.seqNum, i);
        sendMessage(target, { type: 'HB', chainId, path: [serverId], color }, color);
    });
}

function detectFailures(s) {
    const maxVal = Math.max(0, ...Object.values(s.counters));
    for (const id of PEERS) {
        const lag = maxVal - (s.counters[id] || 0);
        s.alive[id] = lag < SUSPICION_THRESHOLD;
        s[`S${id}`] = `${s.alive[id] ? '✅ OK' : '⚠️ SUSPECT'} (lag: ${lag})`;
    }
}

function processHB(s, m) {
    if (!s.seenInChain[m.chainId]) s.seenInChain[m.chainId] = [];
    const participants = s.seenInChain[m.chainId];

    let learnedSomething = false;
    for (const pid of m.path) {
        if (!participants.includes(pid)) {
            participants.push(pid);
            if (pid !== serverId) s.counters[pid] = (s.counters[pid] || 0) + 1;
            learnedSomething = true;
        }
    }
    return learnedSomething;
}

function forwardHB(s, m) {
    let nextPath = [...m.path];
    if (!nextPath.includes(serverId)) {
        nextPath.push(serverId);
        if (!s.seenInChain[m.chainId].includes(serverId)) s.seenInChain[m.chainId].push(serverId);
    }

    const targets = PEERS.filter(id => !nextPath.includes(id));
    if (targets.length > 0) broadcast(targets, { ...m, path: nextPath }, m.color, true);
}

/** ---------------- ENGINE HOOKS ---------------- **/

function onUp() {
    const s = loadState();
    if (Object.keys(s).length === 0) {
        const counters = {}, alive = {};
        PEERS.forEach(id => { counters[id] = 0; alive[id] = true; });
        dumpState({ counters, alive, seenInChain: {}, seqNum: 0, ui_state: 'Idle', ui_color: '#3182bd' });
    } else {
        dumpState(s);
    }
}

function onTimer(t) {
    const s = loadState();
    s.tick = t;

    // 1. INITIATION: Staggered turns for each node to start a new gossip wave.
    const isOurTurn = (t % INITIATION_INTERVAL === (serverId * DELAY_BETWEEN_PINGS) % INITIATION_INTERVAL);
    if (isOurTurn) startGossipWave(s);
    else { s.ui_state = 'Idle'; s.ui_color = '#3182bd'; }

    // 2. DETECTION: Suspect peers whose counters lag behind the global maximum activity.
    detectFailures(s);
    dumpState(s);
}

function onMessage(msg) {
    if (msg.payload.type !== 'HB') return;
    const s = loadState();

    // 3. UPDATE: Track new participants in this heartbeat chain.
    const learned = processHB(s, msg.payload);

    // 4. GOSSIP: forward to remaining peers if we learned something new.
    if (learned) forwardHB(s, msg.payload);

    dumpState(s);
}