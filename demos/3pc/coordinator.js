// 3PC Coordinator FSM
function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        const fsm = new Automat({
            initial: 'idle',
            states: {
                idle: { on: { START: 'propose' }, color: '#8bc34a' },
                propose: { on: { ALL_SENT: 'collect_votes', TIMEOUT: 'aborting' }, color: '#cddc39' },
                collect_votes: { on: { ALL_VOTED: 'prepare', TIMEOUT: 'aborting', ANY_ABORT: 'aborting' }, color: '#ffb74d' },
                prepare: { on: { ALL_SENT: 'wait_acks', TIMEOUT: 'aborting' }, color: '#ffeb3b' },
                wait_acks: { on: { ALL_ACK: 'committing', TIMEOUT: 'committing' }, color: '#ffc107' },
                committing: { on: { DONE: 'idle' }, color: '#2196f3' },
                aborting: { on: { DONE: 'idle' }, color: '#f44336' },
            }
        });
        dumpState({ fsm: fsm.serialize(), txId: 0, outbox: [], votes: {}, history: [] });
    }
}

function onTimer(tick) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    const prevTick = s.tick;
    s.tick = tick;
    s.fsm = fsm.serialize(); // Sync before checks

    // Recovery Detection: if we were offline and an in-flight transaction is risky
    if (prevTick !== undefined && tick > prevTick + 1) {
        if (fsm.state === 'propose' || fsm.state === 'collect_votes' || fsm.state === 'prepare') {
            fsm.transition('TIMEOUT'); // Transitions specifically to 'aborting' from these states
            s.history.push('TX' + s.txId + ':abort (recovery)');
            const targets = allServerIds.filter(id => id !== serverId);
            s.outbox = targets.map(id => ({ to: id, msg: { type: 'ABORT', txId: s.txId } }));
        }
        else if (fsm.state === 'wait_acks') {
            fsm.transition('TIMEOUT'); // Transition specifically to 'committing' (as per previous fix)
            s.history.push('TX' + s.txId + ':commit (recovery)');
            const targets = allServerIds.filter(id => id !== serverId);
            s.outbox = targets.map(id => ({ to: id, msg: { type: 'COMMIT', txId: s.txId } }));
        }
        s.fsm = fsm.serialize();
        dumpState(s);
        return;
    }

    // 1. idle -> propose (ticks 10 and 65, exactly like 2PC)
    if (fsm.state === 'idle' && (tick === 10 || tick === 65)) {
        s.txId++;
        fsm.transition('START');
        const targets = allServerIds.filter(id => id !== serverId);
        s.outbox = targets.map(id => ({ to: id, msg: { type: 'PROPOSE', txId: s.txId, data: s.txId } }));
        s.votes = {};
        s.phaseStart = tick;
    }

    // 2. State classes that simply drain the outbox ALL AT ONCE (broadcast)
    if (fsm.state === 'propose' || fsm.state === 'prepare' || fsm.state === 'committing' || fsm.state === 'aborting') {
        while (s.outbox.length > 0) {
            const t = s.outbox.pop();
            sendMessage(t.to, t.msg);
        }
        // Emptied the outbox, transition to next respective state
        if (fsm.state === 'propose') {
            fsm.transition('ALL_SENT');
            s.phaseStart = tick; // reset timeout timer
        }
        else if (fsm.state === 'prepare') {
            fsm.transition('ALL_SENT');
            s.phaseStart = tick;
        }
        else if (fsm.state === 'committing' || fsm.state === 'aborting') {
            fsm.transition('DONE');
        }
    }

    // 3. Timeouts for waiting phases
    if (fsm.state === 'collect_votes' && tick - s.phaseStart > 18) {
        fsm.transition('TIMEOUT');
        s.history.push('TX' + s.txId + ':abort');
        const targets = allServerIds.filter(id => id !== serverId);
        s.outbox = targets.map(id => ({ to: id, msg: { type: 'ABORT', txId: s.txId } }));
    }

    if (fsm.state === 'wait_acks' && tick - s.phaseStart > 18) {
        fsm.transition('TIMEOUT');
        s.history.push('TX' + s.txId + ':commit');
        const targets = allServerIds.filter(id => id !== serverId);
        s.outbox = targets.map(id => ({ to: id, msg: { type: 'COMMIT', txId: s.txId } }));
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    const m = message.payload;

    const expected = allServerIds.filter(id => id !== serverId);

    if (fsm.state === 'collect_votes' && m.txId === s.txId) {
        if (m.type === 'VOTE_COMMIT') s.votes[message.from] = 'commit';
        if (m.type === 'VOTE_ABORT') s.votes[message.from] = 'abort';

        if (m.type === 'VOTE_ABORT') {
            fsm.transition('ANY_ABORT');
            s.history.push('TX' + s.txId + ':abort');
            s.outbox = expected.map(id => ({ to: id, msg: { type: 'ABORT', txId: s.txId } }));
        } else {
            const allVoted = expected.every(id => s.votes[id] !== undefined);
            if (allVoted) {
                const allCommit = expected.every(id => s.votes[id] === 'commit');
                if (allCommit) {
                    fsm.transition('ALL_VOTED');
                    s.votes = {}; // Reset votes for next phase
                    s.outbox = expected.map(id => ({ to: id, msg: { type: 'PREPARE', txId: s.txId } }));
                }
            }
        }
    }

    else if (fsm.state === 'wait_acks' && m.txId === s.txId) {
        if (m.type === 'ACK_PREPARE') s.votes[message.from] = 'ack';

        const allAcked = expected.every(id => s.votes[id] === 'ack');
        if (allAcked) {
            fsm.transition('ALL_ACK');
            s.history.push('TX' + s.txId + ':commit');
            s.outbox = expected.map(id => ({ to: id, msg: { type: 'COMMIT', txId: s.txId } }));
        }
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}
