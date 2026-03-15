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
        let fsm;
        if (serverId === CLIENT_ID) {
            fsm = new Automat({
                initial: 'idle',
                states: {
                    idle: { on: { SEND_REQUEST: 'requesting' }, color: '#cfd8dc' },
                    requesting: { on: { GOT_REPLY: 'success' }, color: '#ffb74d' },
                    success: { on: {}, color: '#81c784' }
                }
            });
            dumpState({ fsm: fsm.serialize(), role: 'client', requestSent: false, reply: null, outbox: [] });
        } else if (serverId === PRIMARY_ID) {
            fsm = new Automat({
                initial: 'primary_idle',
                states: {
                    primary_idle: { on: { CLIENT_REQUEST: 'pre_prepared' }, color: '#cfd8dc' },
                    pre_prepared: { on: { PREPARE_QUORUM: 'prepared' }, color: '#ffb74d' },
                    prepared: { on: { COMMIT_QUORUM: 'committed' }, color: '#64b5f6' },
                    committed: { on: {}, color: '#81c784' }
                }
            });
            dumpState({
                fsm: fsm.serialize(),
                role: 'primary',
                view: 0,
                seq: 0,
                log: {},        // seq → { value, prepares: {}, commits: {}, committed: bool }
                outbox: [],
            });
        } else if (serverId === TRAITOR_ID) {
            fsm = new Automat({ initial: 'traitor', states: { traitor: { on: {}, color: '#e57373' } } });
            dumpState({
                fsm: fsm.serialize(),
                role: 'traitor',
                view: 0,
                log: {},
                outbox: [],
            });
        } else {
            fsm = new Automat({
                initial: 'idle',
                states: {
                    idle: { on: { PRE_PREPARED: 'pre_prepared' }, color: '#cfd8dc' },
                    pre_prepared: { on: { PREPARE_QUORUM: 'prepared' }, color: '#ffb74d' },
                    prepared: { on: { COMMIT_QUORUM: 'committed' }, color: '#64b5f6' },
                    committed: { on: {}, color: '#81c784' }
                }
            });
            dumpState({
                fsm: fsm.serialize(),
                role: 'replica',
                view: 0,
                log: {},        // seq → { value, prepares: {}, commits: {}, committed: bool }
                outbox: [],
            });
        }
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

    // Client sends a request at tick 10
    if (serverId === CLIENT_ID && tick === 10 && !s.requestSent) {
        s.requestSent = true;
        if (fsm.can('SEND_REQUEST')) fsm.transition('SEND_REQUEST');
        s.outbox.push({ to: PRIMARY_ID, payload: { type: 'CLIENT_REQUEST', value: 'write(x=42)', clientId: CLIENT_ID } });
    }

    s.fsm = fsm.serialize();
    processOutbox(s);
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    const m = message.payload;

    // --- CLIENT ---
    if (serverId === CLIENT_ID) {
        if (m.type === 'REPLY') {
            if (!s.reply) s.reply = m.value;
            if (fsm.can('GOT_REPLY')) fsm.transition('GOT_REPLY');
        }
        s.fsm = fsm.serialize();
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
                    s.outbox.push({
                        to: id, payload: {
                            type: 'PREPARE',
                            view: m.view,
                            seq: m.seq,
                            value: corruptValue,  // <-- lies!
                            from: TRAITOR_ID,
                        }
                    });
                }
            }
            // Also send the honest PREPARE to some nodes so it's not immediately filtered
            s.outbox.push({ to: 0, payload: { type: 'PREPARE', view: m.view, seq: m.seq, value: m.value, from: TRAITOR_ID } });
        }
        if (m.type === 'PREPARE' || m.type === 'COMMIT') {
            // Traitor just ignores these — no valid COMMIT contribution
        }
        s.fsm = fsm.serialize();
        dumpState(s);
        return;
    }

    // --- PRIMARY ---
    if (serverId === PRIMARY_ID) {
        if (m.type === 'CLIENT_REQUEST') {
            s.seq++;
            const entry = { value: m.value, prepares: {}, commits: {}, committed: false };
            s.log[s.seq] = entry;

            if (fsm.can('CLIENT_REQUEST')) fsm.transition('CLIENT_REQUEST');

            // Broadcast PRE_PREPARE to all replicas (including traitor)
            for (const id of allServerIds) {
                if (id !== PRIMARY_ID && id !== CLIENT_ID) {
                    s.outbox.push({ to: id, payload: { type: 'PRE_PREPARE', view: s.view, seq: s.seq, value: m.value } });
                }
            }
            // Primary also acts as a replica — self-prepare
            entry.prepares[PRIMARY_ID] = m.value;
        }

        if (m.type === 'PREPARE') {
            const entry = s.log[m.seq];
            if (entry && m.view === s.view && m.value === entry.value) {
                entry.prepares[message.from] = m.value;
                const matchingPrepares = Object.values(entry.prepares).filter(v => v === entry.value).length;
                if (matchingPrepares >= PREPARE_QUORUM + 1 && fsm.state === 'pre_prepared') {
                    if (fsm.can('PREPARE_QUORUM')) fsm.transition('PREPARE_QUORUM');
                }
            }
        }

        if (m.type === 'COMMIT') {
            const entry = s.log[m.seq];
            if (entry && m.view === s.view) {
                entry.commits[message.from] = true;
                if (!entry.committed && Object.keys(entry.commits).length >= COMMIT_QUORUM) {
                    entry.committed = true;
                    if (fsm.can('COMMIT_QUORUM')) fsm.transition('COMMIT_QUORUM');
                    // Reply to client
                    s.outbox.push({ to: CLIENT_ID, payload: { type: 'REPLY', value: entry.value, seq: m.seq } });
                }
            }
        }

        s.fsm = fsm.serialize();
        dumpState(s);
        return;
    }

    // --- HONEST REPLICA ---
    if (m.type === 'PRE_PREPARE') {
        if (!s.log[m.seq]) {
            s.log[m.seq] = { value: m.value, prepares: {}, commits: {}, committed: false };
        }
        if (fsm.can('PRE_PREPARED')) fsm.transition('PRE_PREPARED');
        // Broadcast PREPARE with the authentic value
        for (const id of allServerIds) {
            if (id !== serverId && id !== CLIENT_ID) {
                s.outbox.push({ to: id, payload: { type: 'PREPARE', view: m.view, seq: m.seq, value: m.value, from: serverId } });
            }
        }
        // Count primary's implicit prepare
        s.log[m.seq].prepares[PRIMARY_ID] = m.value;
        s.log[m.seq].prepares[serverId] = m.value;
    }

    else if (m.type === 'PREPARE') {
        const entry = s.log[m.seq];

        // Only count this PREPARE if it matches the authenticated value
        if (m.value === entry.value) {
            entry.prepares[message.from] = m.value;
        }

        // Prepared? After 2f+1 matching prepares (including our own)
        const matchingPrepares = Object.values(entry.prepares).filter(v => v === entry.value).length;
        if (matchingPrepares >= PREPARE_QUORUM + 1 && !entry.sentCommit) {
            entry.sentCommit = true;
            if (fsm.can('PREPARE_QUORUM')) fsm.transition('PREPARE_QUORUM');
            // Broadcast COMMIT
            for (const id of allServerIds) {
                if (id !== serverId && id !== CLIENT_ID) {
                    s.outbox.push({ to: id, payload: { type: 'COMMIT', view: s.view, seq: m.seq, from: serverId } });
                }
            }
            entry.commits[serverId] = true;
        }
    }

    else if (m.type === 'COMMIT') {
        const entry = s.log[m.seq];

        entry.commits[message.from] = true;
        const commitCount = Object.keys(entry.commits).length;
        if (!entry.committed && commitCount >= COMMIT_QUORUM) {
            entry.committed = true;
            if (fsm.can('COMMIT_QUORUM')) fsm.transition('COMMIT_QUORUM');
            // Replica confirms to client too
            s.outbox.push({ to: CLIENT_ID, payload: { type: 'REPLY', value: entry.value, seq: m.seq } });
        }
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}
