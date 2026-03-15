// FUSE — Reversing Failure Detection
// Protocol:
//   1. Nodes monitor their peers with heartbeats (like basic pings).
//   2. KEY DIFFERENCE: When a node detects ANY failure, it stops responding to
//      ALL peers — effectively "failing itself" on purpose.
//   3. This cascades: every other node now also detects a failure and stops.
//   4. Result: the entire cluster reaches a consistent "failure detected" state
//      without any explicit broadcast needed — it's self-reinforcing.
//
// Demo: Node 4 crashes at tick 30. Node 0 detects it, stops responding,
//       which cascades to Node 1, 2, 3 — all stop by ~tick 75.

const PING_INTERVAL = 8;
const TIMEOUT = 20;

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        const peers = {};
        for (const id of allServerIds) {
            if (id !== serverId) {
                peers[id] = { lastSeen: 0, status: 'alive' };
            }
        }
        dumpState({
            peers,
            fuseBlown: false,   // true = we detected a failure, stop responding
        });
    }
}

function onTimer(tick) {
    let s = loadState();
    s.tick = tick;

    // If fuse is blown, we are "silent" — don't send anything
    if (s.fuseBlown) {
        dumpState(s);
        return;
    }

    // Send pings to all peers
    if (tick % PING_INTERVAL === serverId % PING_INTERVAL) {
        for (const id of allServerIds) {
            if (id !== serverId) {
                sendMessage(id, { type: 'PING' });
            }
        }
    }

    // Check for failures
    for (const [idStr, p] of Object.entries(s.peers)) {
        const gap = tick - p.lastSeen;
        const wasFailed = p.status === 'failed';
        if (gap > TIMEOUT * 2) {
            p.status = 'failed';
        } else if (gap > TIMEOUT) {
            p.status = 'suspect';
        } else {
            p.status = 'alive';
        }

        // FUSE: if we just detected a new failure, blow the fuse
        if (p.status === 'failed' && !wasFailed) {
            s.fuseBlown = true;
            // No more messages from us
            break;
        }
    }

    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const m = message.payload;

    // If fuse is blown, ignore all messages (we are "silent")
    if (s.fuseBlown) {
        dumpState(s);
        return;
    }

    if (m.type === 'PING') {
        // Reply with ACK only if fuse is not blown
        sendMessage(message.from, { type: 'ACK' });
    }

    if (m.type === 'ACK') {
        if (s.peers[message.from]) {
            s.peers[message.from].lastSeen = s.tick !== undefined ? s.tick : 0;
            s.peers[message.from].status = 'alive';
        }
    }

    dumpState(s);
}
