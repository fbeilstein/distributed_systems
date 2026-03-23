// Consistent Hashing — Ring Node (KV Store with Replication)
// Ring size 64 · Replication factor 2 (primary + successor)
//
// Positions (Knuth hash % 64):
//   Node-0 @ 0 · Node-3 @ 19 · Node-2 @ 34 · Node-1 @ 49
//
// Each node stores:
//   • Keys it is the PRIMARY owner for  (from SET messages)
//   • Keys it is the REPLICA  successor for (from REPLICATE messages)
// On GET: serve if key is in local store; otherwise forward clockwise (1 hop).
//
// What to try:
//   • Crash the primary node for a key → observer retries next node → served from replica
//   • Crash both primary + replica → MISS

const RING_SIZE = 64;

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
    if (idx === -1) return -1;
    return sorted[(idx + 1) % sorted.length].id;
}

function computeMyRange(ringNodes, id) {
    if (ringNodes.length === 0) return null;
    const sorted = [...ringNodes].sort((a, b) => a.pos - b.pos);
    const idx = sorted.findIndex(n => n.id === id);
    if (idx === -1) return null;
    const curr = sorted[idx];
    const prev = sorted[(idx - 1 + sorted.length) % sorted.length];
    const start = (prev.pos + 1) % RING_SIZE;
    const end = curr.pos;
    const size = start <= end ? end - start + 1 : (RING_SIZE - start) + end + 1;
    const label = start <= end ? `${start}–${end}` : `${start}–${RING_SIZE - 1}, 0–${end} (wrap)`;
    return { start, end, size, label };
}

function processOutbox(s) {
    if (s.outbox && s.outbox.length > 0) {
        const msg = s.outbox.shift();
        sendMessage(msg.to, msg.payload);
    }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

function onUp() {
    let s = loadState();
    if (Object.keys(s).length !== 0) return;

    const fsm = new Automat({
        initial: 'ready',
        states: {
            ready: { on: { STORE: 'storing', SERVE: 'serving', FWD: 'forwarding' }, color: '#81c784' },
            storing: { on: { DONE: 'ready' }, color: '#4fc3f7' },
            serving: { on: { DONE: 'ready' }, color: '#a5d6a7' },
            forwarding: { on: { DONE: 'ready' }, color: '#ffb74d' },
        }
    });

    dumpState({
        fsm: fsm.serialize(),
        pos: nodeHash(serverId),
        ringNodes: [],
        myRange: null, rangeLabel: 'none', rangeSize: 0,
        store: {},        // key → value (primary-owned data)
        replicas: {},     // key → value (replica copies from predecessor)
        successor: null,
        outbox: [],
    });
}

function onTimer(tick) {
    let s = loadState();
    s.tick = tick;
    const fsm = Automat.deserialize(s.fsm);

    if (s.outbox.length === 0 &&
        (fsm.state === 'storing' || fsm.state === 'serving' || fsm.state === 'forwarding')) {
        if (fsm.can('DONE')) fsm.transition('DONE');
    }

    processOutbox(s);
    s.fsm = fsm.serialize();
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    const m = message.payload;

    if (m.type === 'RING_UPDATE') {
        s.ringNodes = m.nodes;
        s.myRange = computeMyRange(m.nodes, serverId);
        s.rangeSize = s.myRange ? s.myRange.size : 0;
        s.rangeLabel = s.myRange ? s.myRange.label : 'none';
        s.successor = findSuccessor(m.nodes, serverId);
    }

    if (m.type === 'SET') {
        // Store locally and replicate to successor
        s.store[m.key] = m.value;
        if (fsm.can('STORE')) fsm.transition('STORE');
        // Acknowledge to sender
        s.outbox.push({ to: m.from, payload: { type: 'STORED', key: m.key, storedBy: serverId } });
        // Replicate to successor
        if (s.successor !== null && s.successor !== -1) {
            s.outbox.push({
                to: s.successor,
                payload: { type: 'REPLICATE', key: m.key, value: m.value }
            });
        }
    }

    if (m.type === 'REPLICATE') {
        s.replicas[m.key] = m.value;
    }

    if (m.type === 'GET') {
        const hop = m.hop || 0;
        // Check own store first (primary), then replicas
        const value = s.store[m.key] !== undefined ? s.store[m.key]
            : s.replicas[m.key] !== undefined ? s.replicas[m.key]
                : undefined;

        if (value !== undefined) {
            if (fsm.can('SERVE')) fsm.transition('SERVE');
            s.outbox.push({
                to: m.from,
                payload: {
                    type: 'HIT', key: m.key, value, servedBy: serverId,
                    fromReplica: s.store[m.key] === undefined
                }
            });
        } else if (hop < 3 && s.successor !== null && s.successor !== -1) {
            // Forward clockwise — key might be on successor
            if (fsm.can('FWD')) fsm.transition('FWD');
            s.outbox.push({
                to: s.successor,
                payload: { type: 'GET', key: m.key, from: m.from, hop: hop + 1 }
            });
        } else {
            s.outbox.push({
                to: m.from,
                payload: { type: 'MISS', key: m.key }
            });
        }
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}
