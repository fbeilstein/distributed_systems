// Coordinator FSM
function onUp() {
    const fsm = new Automat({
        initial: 'idle',
        states: {
            idle: { on: { START: 'prepare' }, color: '#8bc34a' },
            prepare: { on: { ALL_SENT: 'collecting' }, color: '#ffc107' },
            collecting: { on: { ALL_VOTED: 'committing', TIMEOUT: 'aborting', ANY_ABORT: 'aborting' }, color: '#ff9800' },
            committing: { on: { DONE: 'idle' }, color: '#2196f3' },
            aborting: { on: { DONE: 'idle' }, color: '#f44336' },
        }
    });
    dumpState({ fsm: fsm.serialize(), txId: 0, outbox: [], votes: {} });
}

function onTimer(tick) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    s.tick = tick;

    // 1. idle -> prepare (ticks 10 and 65)
    if (fsm.state === 'idle' && (tick === 10 || tick === 65)) {
        s.txId++;
        fsm.transition('START');
        const targets = allServerIds.filter(id => id !== serverId);
        s.outbox = targets.map(id => ({ to: id, msg: { type: 'PREPARE', txId: s.txId, data: s.txId } }));
        s.votes = {};
        s.phaseStart = tick;
    }

    // 2. prepare -> collecting
    if (fsm.state === 'prepare') {
        if (s.outbox.length > 0) {
            const t = s.outbox.pop();
            sendMessage(t.to, t.msg);
        }
        if (s.outbox.length === 0) {
            fsm.transition('ALL_SENT');
        }
    }

    // 3. collecting timeouts
    if (fsm.state === 'collecting' && tick - s.phaseStart > 18) {
        fsm.transition('TIMEOUT');
        const targets = allServerIds.filter(id => id !== serverId);
        s.outbox = targets.map(id => ({ to: id, msg: { type: 'ABORT', txId: s.txId } }));
    }

    // 4. committing / aborting -> idle
    if ((fsm.state === 'committing' || fsm.state === 'aborting') && s.outbox.length > 0) {
        const t = s.outbox.pop();
        sendMessage(t.to, t.msg);
    }
    if ((fsm.state === 'committing' || fsm.state === 'aborting') && s.outbox.length === 0) {
        fsm.transition('DONE');
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    const m = message.payload;

    if (fsm.state === 'collecting' && m.txId === s.txId) {
        if (m.type === 'VOTE_COMMIT') s.votes[message.from] = 'commit';
        if (m.type === 'VOTE_ABORT') s.votes[message.from] = 'abort';

        const expected = allServerIds.filter(id => id !== serverId);

        if (m.type === 'VOTE_ABORT') {
            fsm.transition('ANY_ABORT');
            s.outbox = expected.map(id => ({ to: id, msg: { type: 'ABORT', txId: s.txId } }));
        } else {
            const allVoted = expected.every(id => s.votes[id] !== undefined);
            if (allVoted) {
                const allCommit = expected.every(id => s.votes[id] === 'commit');
                if (allCommit) {
                    fsm.transition('ALL_VOTED');
                    s.outbox = expected.map(id => ({ to: id, msg: { type: 'COMMIT', txId: s.txId } }));
                }
            }
        }
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}
