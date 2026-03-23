// Percolator — Data Shard (Bigtable-like)
// Stores three logical columns per cell: data, lock, and write metadata.
//
// Cell structure: cells[key][ts] = { data, lock, writeMeta }
//
// Messages handled:
//   PREWRITE  — acquire lock and buffer data; reject if conflict
//   COMMIT    — release primary lock, write metadata, make data visible
//   ABORT     — release lock, discard buffered data
//   READ      — return latest committed value (snapshot read by timestamp)

function onUp() {
    let s = loadState();
    if (Object.keys(s).length !== 0) return;

    const fsm = new Automat({
        initial: 'clean',
        states: {
            clean: { on: { LOCK: 'locked' }, color: '#a5d6a7' },
            locked: { on: { COMMIT: 'committed', ABORT: 'clean' }, color: '#ef9a9a' },
            committed: { on: { LOCK: 'locked', CLEAN: 'clean' }, color: '#4fc3f7' },
        }
    });
    // Initial account balances (serverId 2 = Shard-A holds account A, serverId 3 = Shard-B holds account B)
    const key = serverId === 2 ? 'A' : 'B';
    dumpState({
        fsm: fsm.serialize(),
        key,
        balance: 200,       // initial committed balance ($200 in both accounts)
        lock: null,         // { txId, primary } — which transaction holds the lock
        pending: null,      // { txId, newBalance } — buffered write
        committed: [],      // [ { ts, balance } ] — version history
        outbox: [],
    });
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
    processOutbox(s);
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    const m = message.payload;

    if (m.type === 'READ') {
        // Return latest committed balance at or before m.ts (snapshot read)
        s.outbox.push({
            to: message.from,
            payload: {
                type: 'READ_RESULT', key: s.key, balance: s.balance,
                txId: m.txId, shard: serverId
            }
        });
    }

    if (m.type === 'PREWRITE') {
        if (s.lock !== null) {
            // Conflict — another transaction holds the lock
            s.outbox.push({
                to: message.from,
                payload: {
                    type: 'PREWRITE_FAIL', key: s.key, txId: m.txId,
                    reason: `locked by TX${s.lock.txId}`
                }
            });
        } else {
            // Acquire lock and buffer the write
            s.lock = { txId: m.txId, primary: m.primary };
            s.pending = { txId: m.txId, newBalance: m.newBalance };
            if (fsm.can('LOCK')) fsm.transition('LOCK');
            s.outbox.push({
                to: message.from,
                payload: { type: 'PREWRITE_OK', key: s.key, txId: m.txId, shard: serverId }
            });
        }
    }

    if (m.type === 'COMMIT' && s.lock && s.lock.txId === m.txId) {
        // Release lock, write data at commit timestamp, update balance
        s.committed.push({ ts: m.commitTs, balance: s.pending.newBalance });
        s.balance = s.pending.newBalance;
        s.lock = null;
        s.pending = null;
        if (fsm.can('COMMIT')) fsm.transition('COMMIT');
        s.outbox.push({
            to: message.from,
            payload: { type: 'COMMIT_OK', key: s.key, txId: m.txId, shard: serverId }
        });
    }

    if (m.type === 'ABORT' && s.lock && s.lock.txId === m.txId) {
        s.lock = null;
        s.pending = null;
        if (fsm.can('ABORT')) fsm.transition('ABORT');
        s.outbox.push({
            to: message.from,
            payload: { type: 'ABORT_OK', key: s.key, txId: m.txId }
        });
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}
