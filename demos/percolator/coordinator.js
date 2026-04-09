// Percolator Coordinator (Transaction Manager)
const ORACLE_ID = 0;

function syncUI(s) {
    s.ui_state = s.phase || 'IDLE';

    // Group UI colors by overarching phase
    if (s.phase === 'GET_START_TS' || s.phase === 'GET_COMMIT_TS') s.ui_color = '#cfd8dc';
    else if (s.phase && s.phase.startsWith('PREWRITE')) s.ui_color = '#fff9c4';
    else if (s.phase && s.phase.startsWith('COMMIT')) s.ui_color = '#e8f5e9';
    else if (s.phase === 'DONE') s.ui_color = '#81c784';
    else s.ui_color = '#ffffff';

    s.Start_Timestamp = s.startTs || 'Pending';
    s.Commit_Timestamp = s.commitTs || 'Pending';

    dumpState(s);
}

function onUp() { syncUI(loadState()); }

function onTimer(t) {
    const s = loadState(); s.tick = t;

    // Kick off the transaction early!
    if (t === 5) {
        s.phase = 'GET_START_TS';
        sendMessage(ORACLE_ID, { type: 'GET_TS' }, 'blue');
    }
    syncUI(s);
}

function onMessage(m) {
    const s = loadState();

    // --- 1. GET START TS -> PREWRITE PRIMARY (Shard-A: 2) ---
    if (m.payload.type === 'TS_REPLY' && s.phase === 'GET_START_TS') {
        s.startTs = m.payload.ts;
        s.phase = 'PREWRITE_PRIMARY';
        sendMessage(2, { type: 'PREWRITE', key: 'A', val: 10, startTs: s.startTs, isPrimary: true, primaryKey: 'A' }, 'orange');
    }

    // --- 2. PRIMARY ACK -> PREWRITE SEC 1 (Shard-B: 3) ---
    else if (m.payload.type === 'PREWRITE_REPLY' && s.phase === 'PREWRITE_PRIMARY') {
        s.phase = 'PREWRITE_SEC_1';
        sendMessage(3, { type: 'PREWRITE', key: 'B', val: 20, startTs: s.startTs, isPrimary: false, primaryKey: 'A' }, 'orange');
    }

    // --- 3. SEC 1 ACK -> PREWRITE SEC 2 (Shard-C: 4) ---
    else if (m.payload.type === 'PREWRITE_REPLY' && s.phase === 'PREWRITE_SEC_1') {
        s.phase = 'PREWRITE_SEC_2';
        sendMessage(4, { type: 'PREWRITE', key: 'C', val: 30, startTs: s.startTs, isPrimary: false, primaryKey: 'A' }, 'orange');
    }

    // --- 4. SEC 2 ACK -> GET COMMIT TS ---
    else if (m.payload.type === 'PREWRITE_REPLY' && s.phase === 'PREWRITE_SEC_2') {
        s.phase = 'GET_COMMIT_TS';
        sendMessage(ORACLE_ID, { type: 'GET_TS' }, 'blue');
    }

    // --- 5. GET COMMIT TS -> COMMIT PRIMARY ---
    else if (m.payload.type === 'TS_REPLY' && s.phase === 'GET_COMMIT_TS') {
        s.commitTs = m.payload.ts;
        s.phase = 'COMMIT_PRIMARY';
        sendMessage(2, { type: 'COMMIT', key: 'A', startTs: s.startTs, commitTs: s.commitTs }, 'green');
    }

    // --- 6. PRIMARY COMMIT ACK -> COMMIT SEC 1 ---
    else if (m.payload.type === 'COMMIT_REPLY' && s.phase === 'COMMIT_PRIMARY') {
        s.phase = 'COMMIT_SEC_1';
        sendMessage(3, { type: 'COMMIT', key: 'B', startTs: s.startTs, commitTs: s.commitTs }, 'green');
    }

    // --- 7. SEC 1 COMMIT ACK -> COMMIT SEC 2 ---
    else if (m.payload.type === 'COMMIT_REPLY' && s.phase === 'COMMIT_SEC_1') {
        s.phase = 'COMMIT_SEC_2';
        sendMessage(4, { type: 'COMMIT', key: 'C', startTs: s.startTs, commitTs: s.commitTs }, 'green');
    }

    // --- 8. DONE ---
    else if (m.payload.type === 'COMMIT_REPLY' && s.phase === 'COMMIT_SEC_2') {
        s.phase = 'DONE';
    }

    syncUI(s);
}