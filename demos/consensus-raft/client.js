// Raft Client (Exactly-Once Retry Logic)
const SERVERS = allServerIds.filter(id => id !== 5);
const COMMANDS = ['SET X=1', 'BUY AAPL', 'POST HELLO', 'LOG OUT']
let cur_msg_id = 0;

function onTimer(t) {
    if (t % 30 === 0 && cur_msg_id < COMMANDS.length && t > 25) {
        const s = loadState();
        const target = s.leaderId !== undefined ? s.leaderId : 0;
        const cmd = COMMANDS[cur_msg_id];
        sendMessage(target, { type: 'ClientRequest', cmd }, 'blue');
    }
}

function onMessage(m) {
    // Learn leader from heartbeats
    if (m.payload.leaderId !== undefined) {
        const s = loadState();
        s.leaderId = m.payload.leaderId;

        if (m.payload.leaderLog && cur_msg_id < COMMANDS.length) {
            const committedLogs = m.payload.leaderLog.slice(0, m.payload.commitIndex + 1);
            if (committedLogs.some(l => l.cmd === COMMANDS[cur_msg_id])) {
                cur_msg_id++;
            }
        }

        dumpState(s);
    }
}

function onUp() {
    dumpState({ ...loadState(), state: 'Client-Active' });
}
