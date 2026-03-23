// 3PC Cohort FSM
function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        const fsm = new Automat({
            initial: 'idle',
            states: {
                idle: { on: { VOTE_COMMIT: 'voted_commit', VOTE_ABORT: 'voted_abort' }, color: '#b2dfdb' },
                voted_commit: { on: { PREPARE: 'prepared', COMMIT: 'idle', ABORT: 'idle' }, color: '#4db6ac' },
                voted_abort: { on: { ABORT: 'idle' }, color: '#ef9a9a' },
                prepared: { on: { COMMIT: 'idle', ABORT: 'idle' }, color: '#fdd835' }
            }
        });
        dumpState({ fsm: fsm.serialize(), data: null, pendingTx: null, pendingData: null, history: [] });
    }
    // Recovery is handled in onTimer() by detecting tick gaps — more reliable than dumpState here.
}

function onTimer(tick) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);

    // Crash-recovery detection: if the saved tick jumped (we were offline for ≥1 tick)
    // and there is an in-flight transaction, rewind voteTick so the timeout fires immediately.
    const prevTick = s.tick;
    s.tick = tick;
    if (
        s.pendingTx !== null &&
        prevTick !== undefined &&
        tick > prevTick + 1 &&
        (fsm.state === 'voted_commit' || fsm.state === 'voted_abort' || fsm.state === 'prepared')
    ) {
        s.voteTick = tick - 30; // guarantees tick - voteTick > 25 on this very tick
    }

    // If blocked waiting for coordinator, poll peers instead of hard-forcing Split Brain.
    // Use 25 ticks to give the Coordinator's 18-tick abort timeout priority.
    if ((fsm.state === 'voted_commit' || fsm.state === 'voted_abort' || fsm.state === 'prepared') && s.voteTick !== undefined && (tick - s.voteTick > 25)) {
        s.voteTick = tick; // Reset to avoid spam
        const peers = allServerIds.filter(id => id !== serverId);
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

    if (m.type === 'PROPOSE' && fsm.state === 'idle') {
        s.pendingTx = m.txId;
        s.pendingData = m.data;
        s.voteTick = s.tick;

        if (serverId === 2 && typeof m.data === 'number' && m.data % 2 === 0) {
            if (fsm.can('VOTE_ABORT')) fsm.transition('VOTE_ABORT');
            sendMessage(message.from, { type: 'VOTE_ABORT', txId: m.txId });
        } else {
            if (fsm.can('VOTE_COMMIT')) fsm.transition('VOTE_COMMIT');
            sendMessage(message.from, { type: 'VOTE_COMMIT', txId: m.txId });
        }
    }

    if (m.type === 'PREPARE' && fsm.state === 'voted_commit' && m.txId === s.pendingTx) {
        if (fsm.can('PREPARE')) {
            fsm.transition('PREPARE');
            s.voteTick = s.tick;
            sendMessage(message.from, { type: 'ACK_PREPARE', txId: m.txId });
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
    }

    if (m.type === 'ABORT' && s.pendingTx === m.txId) {
        if (fsm.can('ABORT')) fsm.transition('ABORT');
        s.history.push('TX' + m.txId + ':abort');
        s.pendingTx = null;
        s.pendingData = null;
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}
