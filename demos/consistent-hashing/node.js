// Consistent Hashing — Key Distribution on a Logical Ring
// Nodes are placed on a 0–999 integer ring by hashing their IDs.
// Each key is assigned to the first node clockwise from hash(key).
// Demo:
//   - Tick 0: 4 nodes are on the ring, each owns a range of keys.
//   - Tick 30: A 5th virtual node "joins" (simulated via messages).
//   - Tick 70: The virtual node "leaves" — keys shift back to neighbors.
//
// Node 4 is a special "observer" that triggers join/leave events.
// All other nodes maintain the full ring topology and track their owned key ranges.

const RING_SIZE = 1000;

// Deterministic hash: node ID → ring position
function nodeHash(id) {
    let h = (id * 2654435761) >>> 0;  // Knuth multiplicative hash
    return h % RING_SIZE;
}

// Find which node owns the given ring position (first clockwise)
function findOwner(ringNodes, pos) {
    // ringNodes: [{id, pos}] sorted by pos
    if (ringNodes.length === 0) return -1;
    const sorted = [...ringNodes].sort((a, b) => a.pos - b.pos);
    for (const n of sorted) {
        if (n.pos >= pos) return n.id;
    }
    return sorted[0].id; // wrap around
}

// Compute key ranges owned by each node
function computeRanges(ringNodes) {
    if (ringNodes.length === 0) return {};
    const sorted = [...ringNodes].sort((a, b) => a.pos - b.pos);
    const ranges = {};
    for (let i = 0; i < sorted.length; i++) {
        const curr = sorted[i];
        const prev = sorted[(i - 1 + sorted.length) % sorted.length];
        const start = (prev.pos + 1) % RING_SIZE;
        const end = curr.pos;
        ranges[curr.id] = { start, end, pos: curr.pos };
    }
    return ranges;
}

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        if (serverId === 4) {
            // Observer/controller node
            dumpState({ role: 'observer', ringNodes: [], event: 'idle', outbox: [] });
        } else {
            // Regular node: compute own ring position
            const pos = nodeHash(serverId);
            dumpState({
                role: 'node',
                pos,
                ringNodes: [],  // will be populated via gossip
                myRange: null,
                keys: [],
                outbox: [],
            });
        }
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

    if (serverId === 4) {
        // Observer triggers join/leave events
        if (tick === 5) {
            // Broadcast ring topology: nodes 0-3 form the initial ring
            const initialRing = [0, 1, 2, 3].map(id => ({ id, pos: nodeHash(id) }));
            s.ringNodes = initialRing;
            s.event = 'initial_ring';
            for (const id of [0, 1, 2, 3]) {
                s.outbox.push({ to: id, payload: { type: 'RING_UPDATE', nodes: initialRing } });
            }
        }

        if (tick === 30) {
            // Simulate a new node (virtual node at position 500) joining
            const newNode = { id: 99, pos: 500 };
            const updatedRing = [...s.ringNodes.filter(n => n.id !== 99), newNode];
            s.ringNodes = updatedRing;
            s.event = 'node_99_joined';
            for (const id of [0, 1, 2, 3]) {
                s.outbox.push({ to: id, payload: { type: 'RING_UPDATE', nodes: updatedRing } });
            }
        }

        if (tick === 70) {
            // Simulate node 99 leaving
            const updatedRing = s.ringNodes.filter(n => n.id !== 99);
            s.ringNodes = updatedRing;
            s.event = 'node_99_left';
            for (const id of [0, 1, 2, 3]) {
                s.outbox.push({ to: id, payload: { type: 'RING_UPDATE', nodes: updatedRing } });
            }
        }

        processOutbox(s);
        dumpState(s);
        return;
    }

    // Regular node: announce self at tick 5
    if (tick === 5) {
        s.outbox.push({ to: 4, payload: { type: 'JOIN_ANNOUNCE', id: serverId, pos: s.pos } });
    }

    processOutbox(s);
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const m = message.payload;

    if (m.type === 'RING_UPDATE') {
        s.ringNodes = m.nodes;

        // Compute our owned key range
        const ranges = computeRanges(m.nodes);
        const myRange = ranges[serverId];
        s.myRange = myRange || null;

        // Determine which representative keys we "own"
        if (myRange) {
            const sampleKeys = [];
            for (let k = 0; k <= 9; k++) {
                const keyPos = (k * 97 + 13) % RING_SIZE; // 10 representative keys spread around ring
                const owner = findOwner(m.nodes, keyPos);
                if (owner === serverId) {
                    sampleKeys.push({ key: 'k' + k, pos: keyPos });
                }
            }
            s.keys = sampleKeys;
        }
    }

    dumpState(s);
}
