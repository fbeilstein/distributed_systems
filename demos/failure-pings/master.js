// Master (Node 0) sends PINGs to all Slaves. 
// Slaves reply with ACK. If a Slave stops ACKing, it's declared SUSPECT then FAILED.

const PING_INTERVAL = 10;
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

    // Periodically send PINGs to all slaves
    if (tick % PING_INTERVAL === 0) {
        for (const id of Object.keys(s.slaves)) {
            s.outbox.push({ to: Number(id), payload: { type: 'PING', from: serverId } });
        }
    }

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

    if (m.type === 'ACK') {
        const p = s.slaves[message.from];
        if (p) {
            p.lastSeen = s.tick !== undefined ? s.tick : 0;
            p.status = 'alive';
        }
    }

    dumpState(s);
}
