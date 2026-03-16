function onUp() {
    let s = loadState();
    if (!s.outbox) {
        dumpState({ outbox: [] });
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
    if (!s.outbox) s.outbox = [];
    const m = message.payload;
    const sender = m.from !== undefined ? m.from : message.from;

    if (m.type === 'PING') {
        s.outbox.push({ to: sender, payload: { type: 'ACK', from: serverId } });
    }
    else if (m.type === 'PING_INDIRECT') {
        s.outbox.push({ to: sender, payload: { type: 'ACK_INDIRECT', requester: m.requester, target: serverId } });
    }

    processOutbox(s);
    dumpState(s);
}
