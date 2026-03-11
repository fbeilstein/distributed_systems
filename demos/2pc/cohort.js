// Cohort FSM
function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        const fsm = new Automat({
            initial: 'ready',
            states: {
                ready: { on: { VOTE_COMMIT: 'voted_commit', VOTE_ABORT: 'voted_abort' }, color: '#b2dfdb' },
                voted_commit: { on: { COMMIT: 'ready', ABORT: 'ready' }, color: '#4db6ac' },
                voted_abort: { on: { ABORT: 'ready' }, color: '#ef9a9a' },
            }
        });
        dumpState({ fsm: fsm.serialize(), data: null, pendingTx: null, history: [] });
    }
}

function onTimer(tick) {
    let s = loadState();
    s.tick = tick;

    // Check if we are blocked waiting for the coordinator's decision
    const fsm = Automat.deserialize(s.fsm);
    if ((fsm.state === 'voted_commit' || fsm.state === 'voted_abort') && s.voteTick && (tick - s.voteTick > 15)) {
        s.voteTick = tick; // Reset to avoid spamming
        const peers = allServerIds.filter(id => id !== serverId); // Ask everyone, including coordinator
        for (const peer of peers) {
            sendMessage(peer, { type: 'DECISION_REQUEST', txId: s.pendingTx });
        }
    }

    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    const m = message.payload;

    if (m.type === 'PREPARE') {
        s.pendingTx = m.txId;
        s.pendingData = m.data;
        s.voteTick = s.tick;

        // DB-2 (serverId 2) rejects even data values for demo purposes
        if (serverId === 2 && typeof m.data === 'number' && m.data % 2 === 0) {
            if (fsm.can('VOTE_ABORT')) fsm.transition('VOTE_ABORT');
            sendMessage(message.from, { type: 'VOTE_ABORT', txId: m.txId });
        } else {
            if (fsm.can('VOTE_COMMIT')) fsm.transition('VOTE_COMMIT');
            sendMessage(message.from, { type: 'VOTE_COMMIT', txId: m.txId });
        }
    }

    if (m.type === 'DECISION_REQUEST') {
        if (s.history.includes('TX' + m.txId + ':commit')) {
            sendMessage(message.from, { type: 'COMMIT', txId: m.txId, peer: true });
        } else if (s.history.includes('TX' + m.txId + ':abort')) {
            sendMessage(message.from, { type: 'ABORT', txId: m.txId, peer: true });
        }
    }

    if (m.type === 'COMMIT' && s.pendingTx === m.txId && fsm.can('COMMIT')) {
        fsm.transition('COMMIT');
        s.data = s.pendingData;
        s.history.push('TX' + m.txId + ':commit');
        s.pendingTx = null;
        s.pendingData = null;
        sendMessage(message.from, { type: 'ACK', txId: m.txId });
    }

    if (m.type === 'ABORT' && s.pendingTx === m.txId && fsm.can('ABORT')) {
        fsm.transition('ABORT');
        s.history.push('TX' + m.txId + ':abort');
        s.pendingTx = null;
        s.pendingData = null;
        sendMessage(message.from, { type: 'ACK', txId: m.txId });
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}
