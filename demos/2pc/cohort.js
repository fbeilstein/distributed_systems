// Cohort FSM
function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        const fsm = new Automat({
            initial: 'ready',
            states: {
                ready: { on: { VOTE_COMMIT: 'voted_commit', VOTE_ABORT: 'voted_abort' }, color: '#b2dfdb' },
                voted_commit: { on: { COMMIT: 'ready', ABORT: 'ready', TIMEOUT: 'fallback' }, color: '#4db6ac' },
                voted_abort: { on: { ABORT: 'ready' }, color: '#ef9a9a' },
                fallback: { on: { COMMIT: 'ready', ABORT: 'ready', BLOCKED: 'permanently_blocked' }, color: '#ffb74d' },
                permanently_blocked: { on: { COMMIT: 'ready', ABORT: 'ready' }, color: '#9e9e9e' }
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
    if ((fsm.state === 'voted_commit' || fsm.state === 'voted_abort' || fsm.state === 'fallback') && s.voteTick && (tick - s.voteTick > 15)) {
        s.voteTick = tick; // Reset to avoid spamming

        if (fsm.state === 'voted_abort') {
            // We voted NO, the transaction is doomed globally. Unilaterally abort!
            if (fsm.can('ABORT')) fsm.transition('ABORT');
            s.history.push('TX' + s.pendingTx + ':abort (unilateral)');
            s.pendingTx = null;
            s.fsm = fsm.serialize();
            dumpState(s);
            return;
        }

        s.peerStates = {}; // Track responses from peers

        if (fsm.state === 'voted_commit' && fsm.can('TIMEOUT')) {
            fsm.transition('TIMEOUT');
        }

        const peers = allServerIds.filter(id => id !== serverId && id !== 0); // Ask only cohorts (coordinator is 0)
        for (const peer of peers) {
            sendMessage(peer, { type: 'STATE_REQUEST', txId: s.pendingTx });
        }
    }

    s.fsm = fsm.serialize();
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

    if (m.type === 'STATE_REQUEST') {
        if (s.history.includes('TX' + m.txId + ':commit')) {
            sendMessage(message.from, { type: 'STATE_COMMIT', txId: m.txId });
        } else if (s.history.some(h => h.startsWith('TX' + m.txId + ':abort'))) {
            sendMessage(message.from, { type: 'STATE_ABORT', txId: m.txId });
        } else if (fsm.state === 'voted_abort') {
            sendMessage(message.from, { type: 'STATE_ABORT', txId: m.txId });
        } else if (fsm.state === 'ready') {
            // Safety: if we haven't voted yet, and someone is recovering, we MUST abort
            // to ensure we don't later vote commit if the late coordinator wakes up.
            if (fsm.can('VOTE_ABORT')) fsm.transition('VOTE_ABORT');
            s.history.push('TX' + m.txId + ':abort');
            sendMessage(message.from, { type: 'STATE_ABORT', txId: m.txId });
        } else if (fsm.state === 'voted_commit' || fsm.state === 'fallback' || fsm.state === 'permanently_blocked') {
            sendMessage(message.from, { type: 'STATE_VOTED_COMMIT', txId: m.txId });
        }
    }

    if ((m.type === 'STATE_COMMIT' || m.type === 'STATE_ABORT' || m.type === 'STATE_VOTED_COMMIT') && s.pendingTx === m.txId) {
        if (m.type === 'STATE_COMMIT' && fsm.can('COMMIT')) {
            fsm.transition('COMMIT');
            s.data = s.pendingData;
            s.history.push('TX' + m.txId + ':commit');
            s.pendingTx = null;
        } else if (m.type === 'STATE_ABORT' && fsm.can('ABORT')) {
            fsm.transition('ABORT');
            s.history.push('TX' + m.txId + ':abort');
            s.pendingTx = null;
        } else if (m.type === 'STATE_VOTED_COMMIT' && (fsm.state === 'voted_commit' || fsm.state === 'fallback')) {
            if (!s.peerStates) s.peerStates = {};
            s.peerStates[message.from] = 'voted_commit';

            // DANGER! We cannot safely abort even if EVERY cohort is in 'voted_commit'.
            // Why? The dead coordinator might have already written 'COMMIT' to its local durable
            // log, told the user the transaction succeeded, and THEN crashed before sending the 
            // COMMIT messages to us. If we collaboratively abort here, we cause a split-brain 
            // fatal data corruption when the coordinator wakes up.
            // 
            // Therefore, in standard 2PC, if everyone is 'voted_commit', we are PERMANENTLY BLOCKED 
            // until the coordinator comes back online.
            const otherCohorts = allServerIds.filter(id => id !== serverId && id !== 0);
            if (otherCohorts.every(id => s.peerStates[id] === 'voted_commit')) {
                // Visually loop back from 'fallback' to 'voted_commit' to show we are forever stuck polling
                if (fsm.can('BLOCKED')) {
                    fsm.transition('BLOCKED');
                }
            }
        }
    }

    if (m.type === 'COMMIT' && s.pendingTx === m.txId && fsm.can('COMMIT')) {
        fsm.transition('COMMIT');
        s.data = s.pendingData;
        s.history.push('TX' + m.txId + ':commit');
        s.pendingTx = null;
        s.pendingData = null;
    }

    if (m.type === 'ABORT' && s.pendingTx === m.txId && fsm.can('ABORT')) {
        fsm.transition('ABORT');
        s.history.push('TX' + m.txId + ':abort');
        s.pendingTx = null;
        s.pendingData = null;
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}
