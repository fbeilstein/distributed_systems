// Calvin — Worker
// Receives an EXECUTE message from the Scheduler containing an ordered
// list of transactions to run against local storage.
//
// Key insight: because the Sequencer established the global order upfront,
// this worker executes each transaction locally — no locks, no cross-worker
// coordination, no distributed commit protocol needed.
//
// Worker-A (serverId 2) owns keys A, B.
// Worker-B (serverId 3) owns keys C, D.
//
// For transactions that READ keys owned by the other worker, this demo
// simply resolves them symbolically (e.g., "A+10") rather than cross-fetching,
// keeping the message count manageable while preserving the core insight.

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
            idle: { on: { EXEC: 'executing' }, color: '#81c784' },
            executing: { on: { DONE: 'idle' }, color: '#2e7d32' },
        }
    });
    dumpState({ fsm: fsm.serialize(), store: {}, executedTxs: [], outbox: [] });
}

function onTimer(tick) {
    let s = loadState();
    s.tick = tick;
    const fsm = Automat.deserialize(s.fsm);
    if (fsm.state === 'executing' && s.outbox.length === 0)
        if (fsm.can('DONE')) fsm.transition('DONE');
    processOutbox(s);
    s.fsm = fsm.serialize();
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    const m = message.payload;

    if (m.type === 'EXECUTE') {
        if (fsm.can('EXEC')) fsm.transition('EXEC');

        for (const tx of m.transactions) {
            const record = { txId: tx.id, epoch: m.epochNum, wrote: {} };

            for (const [key, expr] of Object.entries(tx.ops)) {
                if (typeof expr === 'number') {
                    // Direct write
                    s.store[key] = expr;
                    record.wrote[key] = expr;
                } else {
                    // Derived value (e.g. "A+10", "B+5", "C*2")
                    // Resolve using local store if possible; otherwise keep symbolic
                    const match = expr.match(/^([A-Z])([+\-*])(\d+)$/);
                    if (match) {
                        const [, srcKey, op, numStr] = match;
                        const num = parseInt(numStr);
                        const src = s.store[srcKey] !== undefined ? s.store[srcKey] : null;
                        const val = src !== null
                            ? (op === '+' ? src + num : op === '-' ? src - num : src * num)
                            : expr; // symbolic fallback if cross-worker key
                        s.store[key] = val;
                        record.wrote[key] = val;
                    }
                }
            }
            s.executedTxs.push(record);
        }
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}
