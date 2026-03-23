// Calvin — Scheduler
// Receives an epoch (ordered batch of transactions) from the Sequencer.
// Splits transactions between workers by their write sets so workers
// can execute in parallel without coordinating with each other.
//
// Routing rule:
//   Keys A, B → Worker-A (serverId 2)
//   Keys C, D → Worker-B (serverId 3)
// If a transaction writes to both groups, it's sent to both workers.
// Read-set data is forwarded to the worker that needs it.

const WORKER_A = 2;
const WORKER_B = 3;

const KEY_TO_WORKER = { A: WORKER_A, B: WORKER_A, C: WORKER_B, D: WORKER_B };

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
        initial: 'idle',
        states: {
            idle: { on: { EPOCH: 'planning' }, color: '#80cbc4' },
            planning: { on: { DONE: 'idle' }, color: '#00796b' },
        }
    });
    dumpState({ fsm: fsm.serialize(), epochsProcessed: 0, lastPlan: null, outbox: [] });
}

function onTimer(tick) {
    let s = loadState();
    s.tick = tick;
    const fsm = Automat.deserialize(s.fsm);
    if (fsm.state === 'planning' && s.outbox.length === 0)
        if (fsm.can('DONE')) fsm.transition('DONE');
    processOutbox(s);
    s.fsm = fsm.serialize();
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    const m = message.payload;

    if (m.type === 'EPOCH') {
        s.epochsProcessed++;
        if (fsm.can('EPOCH')) fsm.transition('EPOCH');

        // Partition transactions by write-set worker affinity
        const planA = [], planB = [];
        for (const tx of m.transactions) {
            const toA = tx.writes.some(k => KEY_TO_WORKER[k] === WORKER_A);
            const toB = tx.writes.some(k => KEY_TO_WORKER[k] === WORKER_B);
            if (toA) planA.push(tx);
            if (toB) planB.push(tx);
        }

        s.lastPlan = {
            epoch: m.epochNum,
            workerA: planA.map(t => `TX${t.id}`),
            workerB: planB.map(t => `TX${t.id}`),
        };

        // Send each worker its assignment (preserving the sequencer's global order)
        if (planA.length > 0)
            s.outbox.push({
                to: WORKER_A,
                payload: { type: 'EXECUTE', epochNum: m.epochNum, transactions: planA }
            });
        if (planB.length > 0)
            s.outbox.push({
                to: WORKER_B,
                payload: { type: 'EXECUTE', epochNum: m.epochNum, transactions: planB }
            });
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}
