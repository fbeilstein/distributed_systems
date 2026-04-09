// PBFT Client Role (Simplified Request/Reply)
const PRIMARY_ID = 1;
const CLIENT_ID = 0;
const REPLICAS = allServerIds.filter(id => id !== CLIENT_ID && id !== PRIMARY_ID);

function onTimer(t) {
    // Periodically send a client request to the primary
    if (t % 40 === 0) {
        const cmd = 'TX-' + getRandom(100, 999);
        sendMessage(PRIMARY_ID, { type: 'REQUEST', cmd, cid: serverId }, 'blue');
    }
}

function onMessage(m) {
    if (m.payload.type === 'REPLY') {
        const s = loadState();
        s.state = 'REPLY RECEIVED';
        s.last_tx = m.payload.result;
        dumpState(s);
    }
}

function onUp() {
    dumpState({ ...loadState(), state: 'READY' });
}
