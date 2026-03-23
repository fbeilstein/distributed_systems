// Percolator — Transaction Coordinator
// Runs two sequential transactions to demonstrate snapshot isolation and conflict detection.
//
// SHARD_A = serverId 2 (account A, starts at $200)
// SHARD_B = serverId 3 (account B, starts at $200)
// ORACLE  = serverId 1
//
// TX1 (tick 10): Transfer $50 from A → B  (A: 200→150, B: 200→250)  [succeeds]
// TX2 (tick 80): Transfer $30 from A → B  (A: 150→120, B: 250→280)  [succeeds]
// TX3 (tick 140): Concurrent conflict demo — tries to lock A while TX is in flight
//   (In a multi-coordinator scenario this would abort; here we show the read path)
//
// Protocol per transaction:
//   1. GET start timestamp from oracle
//   2. READ current balances from shards (snapshot read at start ts)
//   3. PREWRITE: lock primary shard (A), then secondary (B); buffer new values
//   4. If any PREWRITE_FAIL → ABORT all locks
//   5. GET commit timestamp from oracle
//   6. COMMIT primary (A), then secondary (B)

const ORACLE = 1;
const SHARD_A = 2;
const SHARD_B = 3;

const TX_SCHEDULE = [
    { startTick: 10, txId: 1, deltaA: -50, deltaB: +50, label: 'TX1: transfer $50 A→B' },
    { startTick: 85, txId: 2, deltaA: -30, deltaB: +30, label: 'TX2: transfer $30 A→B' },
    { startTick: 155, txId: 3, deltaA: +20, deltaB: -20, label: 'TX3: transfer $20 B→A' },
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
        initial: 'idle',
        states: {
            idle: { on: { START: 'reading' }, color: '#b0bec5' },
            reading: { on: { PREWRITE: 'prewrting' }, color: '#e1bee7' },
            prewrting: {
                on: {
                    ALL_LOCKED: 'get_commit_ts',
                    CONFLICT: 'aborting'
                }, color: '#ef9a9a'
            },
            get_commit_ts: { on: { TS: 'committing' }, color: '#fff176' },
            committing: { on: { DONE: 'idle' }, color: '#4fc3f7' },
            aborting: { on: { DONE: 'idle' }, color: '#f44336' },
        }
    });

    dumpState({
        fsm: fsm.serialize(),
        txIndex: 0,
        currentTx: null,
        reads: {},        // { A: balance, B: balance } from snapshot reads
        prewriteAcks: 0,
        commitAcks: 0,
        abortAcks: 0,
        log: [],
        outbox: [],
    });
}

function onTimer(tick) {
    let s = loadState();
    s.tick = tick;
    const fsm = Automat.deserialize(s.fsm);

    // ── Start next scheduled transaction ──────────────────────────────────────
    if (fsm.state === 'idle' && s.txIndex < TX_SCHEDULE.length) {
        const sched = TX_SCHEDULE[s.txIndex];
        if (tick === sched.startTick) {
            s.txIndex++;
            s.currentTx = { ...sched, startTs: null, commitTs: null, balA: null, balB: null };
            s.prewriteAcks = 0;
            s.commitAcks = 0;
            s.reads = {};
            s.log.push(`→ ${sched.label}: requesting start timestamp`);
            // Step 1: get start timestamp
            s.outbox.push({
                to: ORACLE,
                payload: { type: 'GET_TIMESTAMP', txId: sched.txId, phase: 'start' }
            });
            if (fsm.can('START')) fsm.transition('START');
        }
    }

    // ── Drain outbox ──────────────────────────────────────────────────────────
    processOutbox(s);
    s.fsm = fsm.serialize();
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    const m = message.payload;
    const tx = s.currentTx;

    // ── Start timestamp → issue snapshot reads ────────────────────────────────
    if (m.type === 'TIMESTAMP' && tx && tx.txId === m.txId && tx.startTs === null) {
        tx.startTs = m.ts;
        s.log.push(`  startTs=${m.ts} — reading balances`);
        s.outbox.push({ to: SHARD_A, payload: { type: 'READ', txId: tx.txId, ts: tx.startTs } });
        s.outbox.push({ to: SHARD_B, payload: { type: 'READ', txId: tx.txId, ts: tx.startTs } });
    }

    // ── Snapshot reads → prewrite ─────────────────────────────────────────────
    if (m.type === 'READ_RESULT' && tx && tx.txId === m.txId) {
        s.reads[m.key] = m.balance;
        s.log.push(`  read ${m.key}=$${m.balance} from Shard-${m.shard === SHARD_A ? 'A' : 'B'}`);
        if (s.reads['A'] !== undefined && s.reads['B'] !== undefined) {
            // Compute new balances
            tx.balA = s.reads['A'] + tx.deltaA;
            tx.balB = s.reads['B'] + tx.deltaB;
            s.log.push(`  prewrite: A $${s.reads['A']}→$${tx.balA}, B $${s.reads['B']}→$${tx.balB}`);
            // Lock primary (A) first, then secondary (B)
            s.outbox.push({
                to: SHARD_A,
                payload: {
                    type: 'PREWRITE', txId: tx.txId,
                    newBalance: tx.balA, primary: SHARD_A
                }
            });
            s.outbox.push({
                to: SHARD_B,
                payload: {
                    type: 'PREWRITE', txId: tx.txId,
                    newBalance: tx.balB, primary: SHARD_A
                }
            });
            s.prewriteAcks = 0;
            if (fsm.can('PREWRITE')) fsm.transition('PREWRITE');
        }
    }

    // ── Prewrite results ──────────────────────────────────────────────────────
    if (m.type === 'PREWRITE_OK' && tx && tx.txId === m.txId) {
        s.prewriteAcks++;
        s.log.push(`  locked key ${m.key} on Shard-${m.shard === SHARD_A ? 'A' : 'B'}`);
        if (s.prewriteAcks === 2) {
            // All locked — get commit timestamp
            s.log.push(`  all locks acquired — requesting commit timestamp`);
            s.outbox.push({
                to: ORACLE,
                payload: { type: 'GET_TIMESTAMP', txId: tx.txId, phase: 'commit' }
            });
            if (fsm.can('ALL_LOCKED')) fsm.transition('ALL_LOCKED');
        }
    }

    if (m.type === 'PREWRITE_FAIL' && tx && tx.txId === m.txId) {
        s.log.push(`  ✗ CONFLICT on ${m.key}: ${m.reason} — aborting TX${tx.txId}`);
        s.outbox.push({ to: SHARD_A, payload: { type: 'ABORT', txId: tx.txId } });
        s.outbox.push({ to: SHARD_B, payload: { type: 'ABORT', txId: tx.txId } });
        if (fsm.can('CONFLICT')) fsm.transition('CONFLICT');
    }

    // ── Commit timestamp → commit both shards ────────────────────────────────
    if (m.type === 'TIMESTAMP' && tx && tx.txId === m.txId && tx.startTs !== null && tx.commitTs === null) {
        tx.commitTs = m.ts;
        s.log.push(`  commitTs=${m.ts} — committing`);
        s.outbox.push({
            to: SHARD_A,
            payload: { type: 'COMMIT', txId: tx.txId, commitTs: tx.commitTs }
        });
        s.outbox.push({
            to: SHARD_B,
            payload: { type: 'COMMIT', txId: tx.txId, commitTs: tx.commitTs }
        });
        s.commitAcks = 0;
        if (fsm.can('TS')) fsm.transition('TS');
    }

    // ── Commit acks ───────────────────────────────────────────────────────────
    if ((m.type === 'COMMIT_OK' || m.type === 'ABORT_OK') && tx && tx.txId === m.txId) {
        s.commitAcks++;
        if (s.commitAcks === 2) {
            const outcome = m.type === 'COMMIT_OK' ? `✓ TX${tx.txId} committed` : `✗ TX${tx.txId} aborted`;
            s.log.push(outcome);
            s.currentTx = null;
            if (fsm.can('DONE')) fsm.transition('DONE');
        }
    }

    s.currentTx = tx;
    s.fsm = fsm.serialize();
    dumpState(s);
}
