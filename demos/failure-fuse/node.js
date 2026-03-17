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

const PING_INTERVAL = 20;
const TIMEOUT = PING_INTERVAL + 10;

// FSM Definition: 'listen' for passive listening, 'ping' for active broadcasting, 'inactive' for blown fuse
const fsmDef = {
    initial: 'listen',
    states: {
        'listen': { on: { 'START_PING': 'ping', 'BLOW_FUSE': 'inactive' }, color: '#3182bd' }, // blue
        'ping': { on: { 'DONE_PING': 'listen', 'BLOW_FUSE': 'inactive' }, color: '#ff7f0e' },  // orange
        'inactive': { color: '#e57373' }                                                       // red
    }
};

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        const fsm = new Automat(fsmDef);
        const peers = {};
        for (const id of allServerIds) {
            if (id !== serverId) {
                peers[id] = { lastSeen: 0, status: 'alive' };
            }
        }
        dumpState({
            fsm: fsm.serialize(),
            peers,
            lastPingTick: -100
        });
    }
}

function onTimer(tick) {
    let s = loadState();
    if (!s.fsm) return;

    const fsm = Automat.deserialize(s.fsm);
    s.tick = tick;

    // If fuse is blown, we are "inactive" — don't send anything
    if (fsm.state === 'inactive') {
        dumpState(s);
        return;
    }

    // Return to listen 1 tick after doing a ping broadcast
    if (fsm.state === 'ping' && tick > s.lastPingTick) {
        fsm.transition('DONE_PING');
    }

    // Send pings to all peers evenly staggered across the interval
    const spacing = Math.floor(PING_INTERVAL / allServerIds.length);
    if (tick % PING_INTERVAL === (serverId * spacing) % PING_INTERVAL) {
        fsm.transition('START_PING');
        s.lastPingTick = tick;

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
        if (gap > TIMEOUT) {
            p.status = 'failed';
        } else {
            p.status = 'alive';
        }

        // FUSE: if we just detected a new failure, blow the fuse
        if (p.status === 'failed' && !wasFailed) {
            fsm.transition('BLOW_FUSE');
            break;
        }
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    if (!s.fsm) return;

    const fsm = Automat.deserialize(s.fsm);
    const m = message.payload;

    // If fuse is blown, ignore all messages (we are "inactive")
    if (fsm.state === 'inactive') {
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
