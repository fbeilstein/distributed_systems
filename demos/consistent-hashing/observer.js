// Consistent Hashing Observer — Drives SET and GET operations
// Ring size 64
//
// Timeline:
//   Tick  5: Broadcast initial ring (4 nodes).
//   Tick 10–38: SET all 5 demo keys (one per 7 ticks) to their primary owners.
//   Tick 45+:  Periodic GET requests. On timeout → retry next clockwise node.
//
// What to try:
//   • Crash a node during GETs → observer times out → retries replica → ✓ HIT from replica
//   • Crash both primary and replica → ✗ MISS after two retries

const RING_SIZE = 64;
const SET_START = 10;
const GET_START = 48;
const OP_EVERY = 7;
const TIMEOUT = 15;

const DEMO_KEYS = [
    { name: 'k:10', pos: 10 },   // primary: Node-3 (1–19),   replica: Node-2
    { name: 'k:28', pos: 28 },   // primary: Node-2 (20–34),  replica: Node-1
    { name: 'k:38', pos: 38 },   // primary: Node-1 (35–49),  replica: Node-0
    { name: 'k:46', pos: 46 },   // primary: Node-1 (35–49),  replica: Node-0
    { name: 'k:55', pos: 55 },   // primary: Node-0 (50–0 wrap), replica: Node-3
];

function nodeHash(id) {
    return ((id * 2654435761) >>> 0) % RING_SIZE;
}

function findOwner(ringNodes, pos) {
    if (ringNodes.length === 0) return -1;
    const sorted = [...ringNodes].sort((a, b) => a.pos - b.pos);
    for (const n of sorted) { if (n.pos >= pos) return n.id; }
    return sorted[0].id;
}

function findSuccessor(ringNodes, id) {
    if (ringNodes.length < 2) return -1;
    const sorted = [...ringNodes].sort((a, b) => a.pos - b.pos);
    const idx = sorted.findIndex(n => n.id === id);
    return idx === -1 ? -1 : sorted[(idx + 1) % sorted.length].id;
}

function processOutbox(s) {
    if (s.outbox && s.outbox.length > 0) {
        const msg = s.outbox.shift();
        sendMessage(msg.to, msg.payload);
    }
}

function onUp() {
    let s = loadState();
    if (Object.keys(s).length !== 0) return;

    const fsm = new Automat({
        initial: 'idle',
        states: {
            idle: { on: { SEND: 'active' }, color: '#90a4ae' },
            active: { on: { DONE: 'idle' }, color: '#ce93d8' },
        }
    });

    dumpState({
        fsm: fsm.serialize(),
        ringNodes: [],
        setIndex: 0, getIndex: 0,
        pending: null, waitSince: null,
        lastOp: null, lastResult: null,
        outbox: [],
    });
}

function onTimer(tick) {
    let s = loadState();
    s.tick = tick;
    const fsm = Automat.deserialize(s.fsm);

    // ── Topology ──────────────────────────────────────────────────────────────
    if (tick === 5) {
        const ring = [0, 1, 2, 3].map(id => ({ id, pos: nodeHash(id) }));
        s.ringNodes = ring;
        for (const id of [0, 1, 2, 3])
            s.outbox.push({ to: id, payload: { type: 'RING_UPDATE', nodes: ring } });
        if (fsm.can('SEND')) fsm.transition('SEND');
    }

    // Return to idle when broadcast drains
    if (fsm.state === 'active' && s.outbox.length === 0 && s.pending === null)
        if (fsm.can('DONE')) fsm.transition('DONE');

    // ── Timeout → retry next node ──────────────────────────────────────────────
    if (s.pending && s.waitSince !== null && tick - s.waitSince > TIMEOUT) {
        const { key, pos, attempt, lastTarget } = s.pending;
        if (attempt < 2) {
            const next = findSuccessor(s.ringNodes, lastTarget);
            s.lastResult = `⏱ timeout → retry "${key}" on Node-${next} (attempt ${attempt + 2})`;
            s.outbox.push({
                to: next,
                payload: { type: 'GET', key, pos, from: serverId, hop: 0 }
            });
            s.pending = { key, pos, attempt: attempt + 1, lastTarget: next };
            s.waitSince = tick;
        } else {
            s.lastResult = `✗ MISS "${key}" — not found after ${attempt + 1} attempts`;
            s.pending = null;
            s.waitSince = null;
            if (fsm.can('DONE')) fsm.transition('DONE');
        }
    }

    // ── Periodic SET ──────────────────────────────────────────────────────────
    if (fsm.state === 'idle' && s.pending === null
        && tick >= SET_START && s.setIndex < DEMO_KEYS.length
        && (tick - SET_START) % OP_EVERY === 0) {
        const k = DEMO_KEYS[s.setIndex];
        const target = findOwner(s.ringNodes, k.pos);
        s.setIndex++;
        const value = `val-${k.name}-${tick}`;
        s.outbox.push({
            to: target,
            payload: { type: 'SET', key: k.name, pos: k.pos, value, from: serverId }
        });
        s.pending = { key: k.name, pos: k.pos, attempt: 0, lastTarget: target, isSet: true };
        s.waitSince = tick;
        s.lastOp = `SET "${k.name}"=${value} → Node-${target}`;
        if (fsm.can('SEND')) fsm.transition('SEND');
    }

    // ── Periodic GET ──────────────────────────────────────────────────────────
    if (fsm.state === 'idle' && s.pending === null
        && tick >= GET_START && s.setIndex >= DEMO_KEYS.length
        && (tick - GET_START) % OP_EVERY === 0) {
        const k = DEMO_KEYS[s.getIndex % DEMO_KEYS.length];
        s.getIndex++;
        const target = findOwner(s.ringNodes, k.pos);
        s.outbox.push({
            to: target,
            payload: { type: 'GET', key: k.name, pos: k.pos, from: serverId, hop: 0 }
        });
        s.pending = { key: k.name, pos: k.pos, attempt: 0, lastTarget: target };
        s.waitSince = tick;
        s.lastOp = `GET "${k.name}" → Node-${target}`;
        if (fsm.can('SEND')) fsm.transition('SEND');
    }

    processOutbox(s);
    s.fsm = fsm.serialize();
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    const m = message.payload;

    if (m.type === 'STORED' && s.pending && s.pending.key === m.key && s.pending.isSet) {
        s.lastResult = `✓ SET "${m.key}" stored on Node-${m.storedBy}`;
        s.pending = null;
        s.waitSince = null;
        if (fsm.can('DONE')) fsm.transition('DONE');
    }

    if (m.type === 'HIT' && s.pending && s.pending.key === m.key) {
        s.lastResult = `✓ GET "${m.key}" = "${m.value}"` +
            ` from Node-${m.servedBy}${m.fromReplica ? ' (replica)' : ''}`;
        s.pending = null;
        s.waitSince = null;
        if (fsm.can('DONE')) fsm.transition('DONE');
    }

    if (m.type === 'MISS' && s.pending && s.pending.key === m.key) {
        s.lastResult = `✗ MISS "${m.key}" — key not found`;
        s.pending = null;
        s.waitSince = null;
        if (fsm.can('DONE')) fsm.transition('DONE');
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}
