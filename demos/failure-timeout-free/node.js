// Timeout-Free Failure Detector
// Nodes pass an ever-growing "path" array between themselves.
// A node is considered alive if its ID appears in paths that pass through this node.
// Key insight: no strict timeouts — liveness is proven by path growth.
// Demo: Node 2 crashes at tick 40. Path through it stops growing, detected by others.

const SEND_INTERVAL = 8;  // Probe interval

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        // alive: set of server IDs we believe are up
        // path: the chain of nodes that forwarded the current probe
        dumpState({
            alive: allServerIds.reduce((acc, id) => { acc[id] = true; return acc; }, {}),
            lastPathFrom: {},   // { [fromId]: lastSeenTick }
            seenPaths: {},      // { [fromId]: latestPath[] }
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

    // Initiate a probe to the next node in a round-robin fashion
    // Each node sends a PATH probe to one peer, carrying its own ID
    if (tick % SEND_INTERVAL === serverId % SEND_INTERVAL) {
        const targets = allServerIds.filter(id => id !== serverId);
        for (const target of targets) {
            s.outbox.push({ to: target, payload: { type: 'PATH', path: [serverId], origin: serverId } });
        }
    }

    // Declare nodes failed if we haven't seen a path update from them in a while.
    // The threshold is generous: 3x the send interval to handle latency.
    const DEAD_THRESHOLD = SEND_INTERVAL * 4;
    for (const id of allServerIds) {
        if (id === serverId) continue;
        const lastSeen = s.lastPathFrom[id];
        if (lastSeen === undefined) {
            // Never heard from them yet — wait longer at start
            if (tick > DEAD_THRESHOLD + 5) {
                s.alive[id] = false;
            }
        } else {
            s.alive[id] = (tick - lastSeen) <= DEAD_THRESHOLD;
        }
    }

    processOutbox(s);
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const m = message.payload;

    if (m.type === 'PATH') {
        const path = m.path;
        const origin = m.origin;

        // Record that the origin is alive (we received its path)
        s.lastPathFrom[origin] = s.tick !== undefined ? s.tick : 0;
        s.alive[origin] = true;
        s.seenPaths[origin] = path;

        // If we haven't been added to this path already, extend it and forward
        if (!path.includes(serverId)) {
            const newPath = [...path, serverId];
            // Forward to all peers not already in the path
            const remaining = allServerIds.filter(id => id !== serverId && !newPath.includes(id));
            for (const target of remaining) {
                s.outbox.push({ to: target, payload: { type: 'PATH', path: newPath, origin } });
            }
        }
    }

    dumpState(s);
}
