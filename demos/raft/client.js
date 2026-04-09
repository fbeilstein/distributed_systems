// Raft Client (Exactly-Once Retry Logic)
const SERVERS = allServerIds.filter(id => id !== 5);

function onTimer(t) {
    if (t % 30 === 0) {
        const s = loadState();
        const target = s.leaderId !== undefined ? s.leaderId : 0;
        const cmd = ['SET X=1', 'BUY AAPL', 'POST HELLO', 'LOG OUT'][getRandom(0, 3)];
        sendMessage(target, { type: 'ClientRequest', cmd }, 'blue');
    }
}

function onMessage(m) {
    // Learn leader from heartbeats
    if (m.payload.leaderId !== undefined) {
        const s = loadState();
        s.leaderId = m.payload.leaderId;
        dumpState(s);
    }
}

function onUp() {
    dumpState({ ...loadState(), state: 'Client-Active' });
}
