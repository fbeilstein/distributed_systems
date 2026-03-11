// Raft Client FSM
function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        const fsm = new Automat({
            initial: 'idle',
            states: {
                idle: { on: { SEND: 'requesting' }, color: '#cfd8dc' },
                requesting: { on: { SENT: 'waiting' }, color: '#ffb74d' },
                waiting: { on: { SUCCESS: 'success', RETRY: 'requesting' }, color: '#fff59d' },
                success: { on: { RESET: 'idle' }, color: '#81c784' }
            }
        });
        dumpState({
            fsm: fsm.serialize(),
            txId: 0,
            retryTick: 0,
            targetNode: 0 // Who to send it to initially
        });
    }
}

function onTimer(tick) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    s.tick = tick;

    // Trigger request 1 at tick 40 (giving cluster 40 ticks to elect a leader)
    if (fsm.state === 'idle' && tick === 40) {
        s.txId++;
        fsm.transition('SEND');
        s.targetNode = 0; // guess node 0 is leader
    }

    // Trigger request 2 at tick 120 (after a leader is recovering from a crash)
    if ((fsm.state === 'idle' || fsm.state === 'success') && tick === 120) {
        s.txId++;
        if (fsm.can('RESET')) fsm.transition('RESET');
        fsm.transition('SEND');
    }

    if (fsm.state === 'requesting') {
        sendMessage(s.targetNode, { type: 'CLIENT_REQUEST', txId: s.txId, data: 'req: x=' + (s.txId * 25) });
        s.retryTick = tick;
        fsm.transition('SENT');
    }

    // Timeout waiting for cluster consensus
    if (fsm.state === 'waiting' && tick - s.retryTick > 25) {
        // Did not get a response, guess a new active node and try again
        s.targetNode = (s.targetNode + 1) % 5;
        fsm.transition('RETRY');
    }

    // Clear success state after a while for UI cleanliness
    if (fsm.state === 'success' && tick - s.retryTick > 10) {
        fsm.transition('RESET');
    }

    s.fsm = fsm.serialize();
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
            fsm.transition('RETRY');
        } else if (m.type === 'CLIENT_RESPONSE') {
            s.retryTick = s.tick; // mark success time
            fsm.transition('SUCCESS');
        }
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}
