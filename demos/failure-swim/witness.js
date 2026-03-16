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
    if (!s.outbox) s.outbox = [];
    s.tick = tick;
    processOutbox(s);
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    if (!s.outbox) s.outbox = [];
    const m = message.payload;
    const sender = m.from !== undefined ? m.from : message.from;

    if (m.type === 'PING_REQ') {
        s.outbox.push({ to: m.target, payload: { type: 'PING_INDIRECT', requester: sender, from: serverId } });
    }
    else if (m.type === 'ACK_INDIRECT') {
        s.outbox.push({ to: m.requester, payload: { type: 'ACK', from: m.target, indirect: true } });
    }

    processOutbox(s);
    dumpState(s);
}
