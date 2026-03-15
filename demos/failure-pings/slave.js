// Slave just waits for PINGs from the Master and replies with an ACK.

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
    processOutbox(s);
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const m = message.payload;

    if (m.type === 'PING') {
        s.outbox.push({ to: message.from, payload: { type: 'ACK', from: serverId } });
    }

    dumpState(s);
}
