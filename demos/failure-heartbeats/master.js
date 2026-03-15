// Master (Node 0) passively listens for HEARTBEATs from Slaves.
// If a Slave stops sending heartbeats, it's declared SUSPECT then FAILED.

const TIMEOUT = 25;

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        const slaves = {};
        for (const id of allServerIds) {
            if (id !== serverId) {
                slaves[id] = { lastSeen: 0, status: 'alive' };
            }
        }
        dumpState({ role: 'master', slaves, outbox: [] });
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

    // Check timeouts
    for (const id of Object.keys(s.slaves)) {
        const p = s.slaves[id];
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

    if (m.type === 'HEARTBEAT') {
        const p = s.slaves[message.from];
        if (p) {
            p.lastSeen = s.tick !== undefined ? s.tick : 0;
            p.status = 'alive';
        }
    }

    dumpState(s);
}
