// Slave periodically sends HEARTBEAT to the Master (Node 0).

const HEARTBEAT_INTERVAL = 10;
const MASTER_ID = 0;

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        dumpState({ role: 'slave', status: 'alive', outbox: [] });
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

    if (tick % HEARTBEAT_INTERVAL === 0) {
        s.outbox.push({ to: MASTER_ID, payload: { type: 'HEARTBEAT', from: serverId } });
    }

    processOutbox(s);
    dumpState(s);
}

function onMessage(message) {
    // Slaves don't receive messages in this demo
}
