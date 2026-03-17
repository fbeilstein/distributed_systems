const HEARTBEAT_INTERVAL = 10;
const MONITOR_ID = 0;

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

    if (tick % HEARTBEAT_INTERVAL === 0) {
        s.outbox.push({ to: MONITOR_ID, payload: { type: 'HEARTBEAT', from: serverId } });
    }

    processOutbox(s);
    dumpState(s);
}

function onMessage(message) {
    // Targets just blindly broadcast heartbeats, they don't process responses
}
