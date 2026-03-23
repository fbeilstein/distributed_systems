// PBFT Checkpointing & Garbage Collection Demo
//
// Shows how PBFT safely truncates infinite logs.
// Protocol (3-phase) runs repeatedly.
// Every K=3 requests, nodes broadcast CHECKPOINT(seq, digest).
// After collecting 2f+1 matching CHECKPOINT messages, a node
// marks the checkpoint as "stable" and drops older log entries.
//
// f=1 (so 3f+1=4 honest replicas + 1 Traitor = 5 replicas total + 1 client)

const F = 1;
const QUORUM = 2 * F + 1;  // 3
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
                    success: { on: { SEND_REQUEST: 'requesting' }, color: '#81c784' }
                }
            });
            dumpState({ fsm: fsm.serialize(), role: 'client', reqSeq: 0, pendingReplies: {}, outbox: [] });
        } else if (serverId === TRAITOR_ID) {
            fsm = new Automat({ initial: 'traitor', states: { traitor: { on: {}, color: '#e57373' } } });
            dumpState({ fsm: fsm.serialize(), role: 'traitor', view: 0, log: {}, outbox: [] });
        } else {
            fsm = new Automat({
                initial: 'sync',
                states: {
                    sync: { on: { OP_START: 'working', CHECKPOINTING: 'checkpointing' }, color: '#cfd8dc' },
                    working: { on: { OP_START: 'working', CHECKPOINTING: 'checkpointing' }, color: '#64b5f6' },
                    checkpointing: { on: { STABLE_CHECKPOINT: 'sync', OP_START: 'working' }, color: '#ab47bc' }
                }
            });
            dumpState({
                fsm: fsm.serialize(),
                role: serverId === PRIMARY_ID ? 'primary' : 'replica',
                view: 0,
                seq: 0,               // Primary only
                log: {},              // seq → { value, prepares:{}, commits:{}, committed:bool }
                checkpoints: {},      // seq → { fromId → digest }
                stableCheckpoint: 0,
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

    // Client loops every 40 ticks
    if (serverId === CLIENT_ID && tick % 40 === 10) {
        s.reqSeq++;
        if (fsm.can('SEND_REQUEST')) fsm.transition('SEND_REQUEST');
        s.outbox.push({ to: PRIMARY_ID, payload: { type: 'CLIENT_REQUEST', value: 'write(x=' + s.reqSeq + ')', reqSeq: s.reqSeq } });
    }

    s.fsm = fsm.serialize();
    processOutbox(s);
    dumpState(s);
}

function tryCheckpoint(s, fsm, seqToCp) {
    if (!s.checkpoints[seqToCp]) s.checkpoints[seqToCp] = {};
    const digestGroups = {};
    for (const d of Object.values(s.checkpoints[seqToCp])) {
        digestGroups[d] = (digestGroups[d] || 0) + 1;
        if (digestGroups[d] >= QUORUM && s.stableCheckpoint < seqToCp) {
            s.stableCheckpoint = seqToCp;
            if (fsm.can('STABLE_CHECKPOINT')) fsm.transition('STABLE_CHECKPOINT');

            // Garbage Collection! Delete all logs <= stableCheckpoint
            for (const sq of Object.keys(s.log)) {
                if (parseInt(sq, 10) <= s.stableCheckpoint) {
                    delete s.log[sq];
                }
            }
        }
    }
}

function onMessage(message) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    const m = message.payload;

    if (serverId === CLIENT_ID) {
        if (m.type === 'REPLY') {
            if (!s.pendingReplies[m.seq]) s.pendingReplies[m.seq] = {};
            s.pendingReplies[m.seq][message.from] = true;
            if (Object.keys(s.pendingReplies[m.seq]).length >= F + 1) {
                if (fsm.can('GOT_REPLY')) fsm.transition('GOT_REPLY');
            }
        }
        s.fsm = fsm.serialize();
        dumpState(s);
        return;
    }

    if (serverId === TRAITOR_ID) {
        if (m.type === 'PRE_PREPARE') {
            for (const id of allServerIds) {
                if (id !== TRAITOR_ID && id !== CLIENT_ID) {
                    s.outbox.push({ to: id, payload: { type: 'PREPARE', view: m.view, seq: m.seq, value: m.value + '_LIES', from: TRAITOR_ID } });
                }
            }
            s.outbox.push({ to: PRIMARY_ID, payload: { type: 'PREPARE', view: m.view, seq: m.seq, value: m.value, from: TRAITOR_ID } });
        } else if (m.type === 'CHECKPOINT') {
            // Traitor poisons the checkpoint pool!
            s.outbox.push({ to: message.from, payload: { type: 'CHECKPOINT', seq: m.seq, digest: 'fake-hash', from: TRAITOR_ID } });
        }
        s.fsm = fsm.serialize();
        processOutbox(s);
        dumpState(s);
        return;
    }

    if (s.role === 'primary' && m.type === 'CLIENT_REQUEST') {
        s.seq++;
        const entry = { value: m.value, prepares: {}, commits: {}, committed: false };
        s.log[s.seq] = entry;
        if (fsm.can('OP_START')) fsm.transition('OP_START');

        for (const id of allServerIds) {
            if (id !== PRIMARY_ID && id !== CLIENT_ID) {
                s.outbox.push({ to: id, payload: { type: 'PRE_PREPARE', view: s.view, seq: s.seq, value: m.value } });
            }
        }
        entry.prepares[PRIMARY_ID] = m.value;
    }

    if (m.type === 'PRE_PREPARE' && s.role === 'replica') {
        if (!s.log[m.seq]) {
            s.log[m.seq] = { value: m.value, prepares: {}, commits: {}, committed: false };
        }
        if (fsm.can('OP_START')) fsm.transition('OP_START');
        for (const id of allServerIds) {
            if (id !== serverId && id !== CLIENT_ID) {
                s.outbox.push({ to: id, payload: { type: 'PREPARE', view: m.view, seq: m.seq, value: m.value, from: serverId } });
            }
        }
        s.log[m.seq].prepares[PRIMARY_ID] = m.value;
        s.log[m.seq].prepares[serverId] = m.value;
    }

    else if (m.type === 'PREPARE') {
        const entry = s.log[m.seq];
        if (entry && m.value === entry.value) {
            entry.prepares[message.from] = m.value;
            const matches = Object.values(entry.prepares).filter(v => v === entry.value).length;
            if (matches >= QUORUM && !entry.sentCommit) {
                entry.sentCommit = true;
                for (const id of allServerIds) {
                    if (id !== serverId && id !== CLIENT_ID) {
                        s.outbox.push({ to: id, payload: { type: 'COMMIT', view: s.view, seq: m.seq, from: serverId } });
                    }
                }
                entry.commits[serverId] = true;
            }
        }
    }

    else if (m.type === 'COMMIT') {
        const entry = s.log[m.seq];
        if (entry) {
            entry.commits[message.from] = true;
            const matches = Object.keys(entry.commits).length;
            if (!entry.committed && matches >= QUORUM) {
                entry.committed = true;
                s.outbox.push({ to: CLIENT_ID, payload: { type: 'REPLY', value: entry.value, seq: m.seq } });

                // --- CORE CHECKPOINT LOGIC ---
                // Trigger checkpoint every 3 items
                if (m.seq % 3 === 0 && m.seq > 0 && m.seq > s.stableCheckpoint) {
                    if (fsm.can('CHECKPOINTING')) fsm.transition('CHECKPOINTING');
                    const digest = "hash-" + m.seq; // In reality: Hash(state)
                    for (const id of allServerIds) {
                        if (id !== CLIENT_ID) {
                            s.outbox.push({ to: id, payload: { type: 'CHECKPOINT', seq: m.seq, digest: digest, from: serverId } });
                        }
                    }
                    if (!s.checkpoints[m.seq]) s.checkpoints[m.seq] = {};
                    s.checkpoints[m.seq][serverId] = digest;
                    tryCheckpoint(s, fsm, m.seq);
                }
            }
        }
    }

    else if (m.type === 'CHECKPOINT') {
        if (!s.checkpoints[m.seq]) s.checkpoints[m.seq] = {};
        s.checkpoints[m.seq][message.from] = m.digest;
        tryCheckpoint(s, fsm, m.seq);
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}
