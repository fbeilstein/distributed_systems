// Raft Client FSM
function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        const fsm = new Automat({
            initial: 'idle',
            states: {
                idle: { on: { SEND: 'waiting' }, color: '#cfd8dc' },
                waiting: { on: { SUCCESS: 'success', RETRY: 'waiting' }, color: '#fff59d' },
                success: { on: { RESET: 'idle' }, color: '#81c784' }
            }
        });
        dumpState({
            fsm: fsm.serialize(),
            txId: 0,
            retryTick: 0,
            targetNode: 0,
            outbox: []
        });
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
    const fsm = Automat.deserialize(s.fsm);
    s.tick = tick;

    // Trigger request 1 at tick 40 (giving cluster 40 ticks to elect a leader)
    if (fsm.state === 'idle' && tick === 40) {
        s.txId++;
        s.targetNode = 0; // guess node 0 is leader
        s.retryTick = tick;
        s.outbox.push({ to: s.targetNode, payload: { type: 'CLIENT_REQUEST', txId: s.txId, data: 'req: x=' + (s.txId * 25) } });
        if (fsm.can('SEND')) fsm.transition('SEND');
    }

    // Timeout waiting for cluster consensus
    if (fsm.state === 'waiting' && tick - s.retryTick > 40) {
        // Did not get a response, guess a new active node and try again
        s.targetNode = (s.targetNode + 1) % 5;
        s.retryTick = tick;
        s.outbox.push({ to: s.targetNode, payload: { type: 'CLIENT_REQUEST', txId: s.txId, data: 'req: x=' + (s.txId * 25) } });
        if (fsm.can('RETRY')) fsm.transition('RETRY');
    }

    // Clear success state after a while for UI cleanliness
    if (fsm.state === 'success' && tick - s.retryTick > 10) {
        if (fsm.can('RESET')) fsm.transition('RESET');
    }

    s.fsm = fsm.serialize();
    processOutbox(s);
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    const m = message.payload;

    if (fsm.state === 'waiting') {
        if (m.type === 'REDIRECT') {
            // Re-target the request to a different node
            s.targetNode = (s.targetNode + 1) % 5;
            s.retryTick = s.tick !== undefined ? s.tick : 0;
            s.outbox.push({ to: s.targetNode, payload: { type: 'CLIENT_REQUEST', txId: s.txId, data: 'req: x=' + (s.txId * 25) } });
            if (fsm.can('RETRY')) fsm.transition('RETRY');
        } else if (m.type === 'CLIENT_RESPONSE') {
            s.retryTick = s.tick !== undefined ? s.tick : 0; // mark success time
            if (fsm.can('SUCCESS')) fsm.transition('SUCCESS');
        }
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}
