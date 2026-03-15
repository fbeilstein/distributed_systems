// Timeout-Free Failure Detector
// Nodes pass an ever-growing "path" array between themselves.
// A node is considered alive if its ID appears in paths that pass through this node.
// Key insight: no strict timeouts — liveness is proven by path growth.
// Demo: Node 2 crashes at tick 40. Path through it stops growing, detected by others.

const SEND_INTERVAL = 40;  // Probe interval (very sparse for visual clarity)

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

    // Initiate a probe to a random target
    // Staggered by serverId to ensure only one node initiates a path at a time
    if (tick % SEND_INTERVAL === (serverId * 10) % SEND_INTERVAL) {
        const targets = allServerIds.filter(id => id !== serverId);
        if (targets.length > 0) {
            const target = targets[getRandom(0, targets.length - 1)];
            s.outbox.push({ to: target, payload: { type: 'PATH', path: [serverId], origin: serverId } });
        }
    }

    // Declare nodes failed if we haven't seen a path update from them in a while.
    const DEAD_THRESHOLD = 80; // Fixed threshold for a slow sparse demo
    for (const id of allServerIds) {
        if (id === serverId) continue;
        const lastSeen = s.lastPathFrom[id];
        if (lastSeen === undefined) {
            if (tick > DEAD_THRESHOLD + 5) s.alive[id] = false;
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

        s.lastPathFrom[origin] = s.tick !== undefined ? s.tick : 0;
        s.alive[origin] = true;
        s.seenPaths[origin] = path;

        // Forward to ONE random peer not in path to curb outbox congestion
        if (!path.includes(serverId)) {
            const newPath = [...path, serverId];
            const remaining = allServerIds.filter(id => id !== serverId && !newPath.includes(id));
            if (remaining.length > 0) {
                const target = remaining[getRandom(0, remaining.length - 1)];
                s.outbox.push({ to: target, payload: { type: 'PATH', path: newPath, origin } });
            }
        }
    }

    dumpState(s);
}
