// Calvin — Sequencer
// Collects incoming transactions, groups them into fixed-size epochs,
// and broadcasts the deterministic order to the Scheduler.
//
// Key insight: because all replicas receive the SAME input sequence from
// the sequencer, they can execute transactions locally without further
// coordination — no distributed locking required.
//
// Demo transactions (hardcoded):
//   TX1: write account A←100, B←200
//   TX2: read A, write C←A+10
//   TX3: write B←300
//   TX4: read B, write D←B+5
//   TX5: write A←150, C←200
//   TX6: read C, write D←C*2

const SCHEDULER = 1;
const EPOCH_SIZE = 3;   // transactions per epoch
const EPOCH_TICKS = 25; // ticks between epochs

const ALL_TRANSACTIONS = [
    { id: 1, reads: [], writes: ['A', 'B'], ops: { A: 100, B: 200 } },
    { id: 2, reads: ['A'], writes: ['C'], ops: { C: 'A+10' } },
    { id: 3, reads: [], writes: ['B'], ops: { B: 300 } },
    { id: 4, reads: ['B'], writes: ['D'], ops: { D: 'B+5' } },
    { id: 5, reads: [], writes: ['A', 'C'], ops: { A: 150, C: 200 } },
    { id: 6, reads: ['C'], writes: ['D'], ops: { D: 'C*2' } },
];

function processOutbox(s) {
    if (s.outbox && s.outbox.length > 0) {
        const msg = s.outbox.shift();
        sendMessage(msg.to, msg.payload);
    }
}

function onUp() {
    let s = loadState();
    if (Object.keys(s).length !== 0) return;

    const fsm = new Automat({
        initial: 'collecting',
        states: {
            collecting: { on: { BROADCAST: 'broadcasting' }, color: '#ce93d8' },
            broadcasting: { on: { DONE: 'collecting' }, color: '#7b1fa2' },
        }
    });

    dumpState({
        fsm: fsm.serialize(),
        epochNum: 0,
        txCursor: 0,   // index into ALL_TRANSACTIONS
        outbox: [],
    });
}

function onTimer(tick) {
    let s = loadState();
    s.tick = tick;
    const fsm = Automat.deserialize(s.fsm);

    // Return to collecting once outbox drains
    if (fsm.state === 'broadcasting' && s.outbox.length === 0)
        if (fsm.can('DONE')) fsm.transition('DONE');

    // Fire a new epoch every EPOCH_TICKS ticks
    if (fsm.state === 'collecting'
        && tick > 0
        && tick % EPOCH_TICKS === 0
        && s.txCursor < ALL_TRANSACTIONS.length) {
        const batch = ALL_TRANSACTIONS.slice(s.txCursor, s.txCursor + EPOCH_SIZE);
        s.txCursor += batch.length;
        s.epochNum++;
        // Broadcast the epoch to the Scheduler (deterministic global order)
        s.outbox.push({
            to: SCHEDULER,
            payload: { type: 'EPOCH', epochNum: s.epochNum, transactions: batch }
        });
        if (fsm.can('BROADCAST')) fsm.transition('BROADCAST');
    }

    processOutbox(s);
    s.fsm = fsm.serialize();
    dumpState(s);
}

function onMessage(message) {
    // Sequencer doesn't receive messages in this demo
    dumpState(loadState());
}
