// Percolator — Timestamp Oracle
// Provides globally monotonically increasing timestamps to coordinators.
// Every GET_TIMESTAMP request returns the next integer, atomically.

function onUp() {
    let s = loadState();
    if (Object.keys(s).length !== 0) return;

    const fsm = new Automat({
        initial: 'idle',
        states: {
            idle: { on: { TICK: 'ticking' }, color: '#b0bec5' },
            ticking: { on: { DONE: 'idle' }, color: '#fff176' },
        }
    });
    dumpState({ fsm: fsm.serialize(), ts: 0, outbox: [] });
}

function processOutbox(s) {
    if (s.outbox && s.outbox.length > 0) {
        const msg = s.outbox.shift();
        sendMessage(msg.to, msg.payload);
    }
}

function onTimer(tick) {
    let s = loadState();
    s.tick = tick;
    const fsm = Automat.deserialize(s.fsm);
    if (fsm.state === 'ticking' && s.outbox.length === 0)
        if (fsm.can('DONE')) fsm.transition('DONE');
    processOutbox(s);
    s.fsm = fsm.serialize();
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    const m = message.payload;

    if (m.type === 'GET_TIMESTAMP') {
        s.ts++;
        if (fsm.can('TICK')) fsm.transition('TICK');
        s.outbox.push({
            to: message.from,
            payload: { type: 'TIMESTAMP', ts: s.ts, txId: m.txId }
        });
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}
