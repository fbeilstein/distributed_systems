// PBFT — Practical Byzantine Fault Tolerance
// Primary + Replica nodes. One node is a TRAITOR that sends conflicting messages.
//
// Protocol (3-phase):
//   Phase 1 — Pre-Prepare: Primary receives a CLIENT_REQUEST, assigns sequence number,
//              broadcasts PRE_PREPARE(view, seq, value) to all replicas.
//   Phase 2 — Prepare: Each replica broadcasts PREPARE(view, seq, digest) to all peers.
//              After 2f PREPARE messages, a replica is "prepared".
//   Phase 3 — Commit: Each prepared replica broadcasts COMMIT(view, seq).
//              After 2f+1 COMMIT messages, execute and reply to client.
//
// f = 1 (one traitor), so we need n >= 3f+1 = 4 nodes total.
// We use 6 nodes: 1 Primary, 4 honest Replicas, 1 Traitor (sends garbage).
// Quorum = 2f+1 = 3 for PREPARE; 2f+1 = 3 for COMMIT (honest threshold).
//
// NOTE: serverId mapping in the demo:
//   0 = Primary, 1-4 = Replicas (honest), 5 = Client
//   The traitor is Replica-3 (serverId 3) — sends conflicting PREPARE values.

const F = 1;
const PREPARE_QUORUM = 2 * F + 1;  // 3
const COMMIT_QUORUM = 2 * F + 1;  // 3
const PRIMARY_ID = 0;
const CLIENT_ID = 5;
const TRAITOR_ID = 3;

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        if (serverId === CLIENT_ID) {
            dumpState({ role: 'client', requestSent: false, reply: null });
        } else if (serverId === PRIMARY_ID) {
            dumpState({
                role: 'primary',
                view: 0,
                seq: 0,
                log: {},        // seq → { value, prepares: {}, commits: {}, committed: bool }
            });
        } else {
            dumpState({
                role: serverId === TRAITOR_ID ? 'traitor' : 'replica',
                view: 0,
                log: {},        // seq → { value, prepares: {}, commits: {}, committed: bool }
            });
        }
    }
}

function onTimer(tick) {
    let s = loadState();
    s.tick = tick;

    // Client sends a request at tick 10
    if (serverId === CLIENT_ID && tick === 10 && !s.requestSent) {
        s.requestSent = true;
        sendMessage(PRIMARY_ID, { type: 'CLIENT_REQUEST', value: 'write(x=42)', clientId: CLIENT_ID });
    }

    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const m = message.payload;

    // --- CLIENT ---
    if (serverId === CLIENT_ID) {
        if (m.type === 'REPLY') {
            if (!s.reply) s.reply = m.value;
        }
        dumpState(s);
        return;
    }

    // --- TRAITOR: sends conflicting PRE_PREPARE / PREPARE messages ---
    if (serverId === TRAITOR_ID) {
        if (m.type === 'PRE_PREPARE') {
            // Acknowledge pre-prepare but broadcast a DIFFERENT value in PREPARE
            const corruptValue = m.value + '_CORRUPTED';
            for (const id of allServerIds) {
                if (id !== TRAITOR_ID && id !== CLIENT_ID) {
                    sendMessage(id, {
                        type: 'PREPARE',
                        view: m.view,
                        seq: m.seq,
                        value: corruptValue,  // <-- lies!
                        from: TRAITOR_ID,
                    });
                }
            }
            // Also send the honest PREPARE to some nodes so it's not immediately filtered
            sendMessage(0, { type: 'PREPARE', view: m.view, seq: m.seq, value: m.value, from: TRAITOR_ID });
        }
        if (m.type === 'PREPARE' || m.type === 'COMMIT') {
            // Traitor just ignores these — no valid COMMIT contribution
        }
        dumpState(s);
        return;
    }

    // --- PRIMARY ---
    if (serverId === PRIMARY_ID) {
        if (m.type === 'CLIENT_REQUEST') {
            s.seq++;
            const entry = { value: m.value, prepares: {}, commits: {}, committed: false };
            s.log[s.seq] = entry;

            // Broadcast PRE_PREPARE to all replicas (including traitor)
            for (const id of allServerIds) {
                if (id !== PRIMARY_ID && id !== CLIENT_ID) {
                    sendMessage(id, { type: 'PRE_PREPARE', view: s.view, seq: s.seq, value: m.value });
                }
            }
            // Primary also acts as a replica — self-prepare
            entry.prepares[PRIMARY_ID] = m.value;
        }

        if (m.type === 'PREPARE') {
            const entry = s.log[m.seq];
            if (entry && m.view === s.view && m.value === entry.value) {
                entry.prepares[message.from] = m.value;
            }
        }

        if (m.type === 'COMMIT') {
            const entry = s.log[m.seq];
            if (entry && m.view === s.view) {
                entry.commits[message.from] = true;
                if (!entry.committed && Object.keys(entry.commits).length >= COMMIT_QUORUM) {
                    entry.committed = true;
                    // Reply to client
                    sendMessage(CLIENT_ID, { type: 'REPLY', value: entry.value, seq: m.seq });
                }
            }
        }

        dumpState(s);
        return;
    }

    // --- HONEST REPLICA ---
    if (m.type === 'PRE_PREPARE') {
        if (!s.log[m.seq]) {
            s.log[m.seq] = { value: m.value, prepares: {}, commits: {}, committed: false };
        }
        // Broadcast PREPARE with the authentic value
        for (const id of allServerIds) {
            if (id !== serverId && id !== CLIENT_ID) {
                sendMessage(id, { type: 'PREPARE', view: m.view, seq: m.seq, value: m.value, from: serverId });
            }
        }
        // Count primary's implicit prepare
        s.log[m.seq].prepares[PRIMARY_ID] = m.value;
        s.log[m.seq].prepares[serverId] = m.value;
    }

    else if (m.type === 'PREPARE') {
        const entry = s.log[m.seq];
        if (!entry) { dumpState(s); return; }

        // Only count this PREPARE if it matches the authenticated value
        if (m.value === entry.value) {
            entry.prepares[message.from] = m.value;
        }

        // Prepared? After 2f+1 matching prepares (including our own)
        const matchingPrepares = Object.values(entry.prepares).filter(v => v === entry.value).length;
        if (matchingPrepares >= PREPARE_QUORUM + 1 && !entry.sentCommit) {
            entry.sentCommit = true;
            // Broadcast COMMIT
            for (const id of allServerIds) {
                if (id !== serverId && id !== CLIENT_ID) {
                    sendMessage(id, { type: 'COMMIT', view: s.view, seq: m.seq, from: serverId });
                }
            }
            entry.commits[serverId] = true;
        }
    }

    else if (m.type === 'COMMIT') {
        const entry = s.log[m.seq];
        if (!entry) { dumpState(s); return; }

        entry.commits[message.from] = true;
        const commitCount = Object.keys(entry.commits).length;
        if (!entry.committed && commitCount >= COMMIT_QUORUM) {
            entry.committed = true;
            // Replica confirms to client too
            sendMessage(CLIENT_ID, { type: 'REPLY', value: entry.value, seq: m.seq });
        }
    }

    dumpState(s);
}
