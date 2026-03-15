// Heartbeats & Pings Failure Detector
// Every node pings all peers periodically. If no heartbeat is received within
// TIMEOUT ticks, the peer is declared SUSPECT, then FAILED.
// Demo: Node 2 crashes at tick 50, recovers at tick 90.

const PING_INTERVAL = 10;  // Send ping every N ticks
const TIMEOUT = 25;  // Declare suspect if no heartbeat for N ticks

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        // peers: { [id]: { lastSeen: tick, status: 'alive'|'suspect'|'failed' } }
        const peers = {};
        for (const id of allServerIds) {
            if (id !== serverId) {
                peers[id] = { lastSeen: 0, status: 'alive' };
            }
        }
        dumpState({ peers, status: 'alive', outbox: [] });
    } else {
        // On recovery, reset our own lastSeen so peers accept us again
        const s2 = loadState();
        s2.status = 'alive';
        dumpState(s2);
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

    // Send pings to all peers periodically
    if (tick % PING_INTERVAL === 0) {
        for (const id of allServerIds) {
            if (id !== serverId) {
                s.outbox.push({ to: id, payload: { type: 'PING', from: serverId, tick } });
            }
        }
    }

    // Update liveness status based on last-seen timestamps
    for (const id of Object.keys(s.peers)) {
        const p = s.peers[id];
        const gap = tick - p.lastSeen;
        if (gap > TIMEOUT * 2) {
            p.status = 'failed';
        } else if (gap > TIMEOUT) {
            p.status = 'suspect';
        } else {
            p.status = 'alive';
        }
    }

    processOutbox(s);
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const m = message.payload;

    if (m.type === 'PING') {
        // Reply with an ACK
        s.outbox.push({ to: message.from, payload: { type: 'ACK', from: serverId } });
    }

    if (m.type === 'ACK') {
        // Update the last-seen timestamp for this peer
        if (s.peers[message.from]) {
            s.peers[message.from].lastSeen = s.tick !== undefined ? s.tick : 0;
            s.peers[message.from].status = 'alive';
        }
    }

    dumpState(s);
}
