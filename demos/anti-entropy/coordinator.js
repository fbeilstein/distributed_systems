const fsmDef = {
    initial: 'IDLE',
    states: {
        'IDLE': { on: { 'WRITE': 'WRITING', 'READ': 'READING', 'HINTS': 'HAS_HINTS' }, color: '#cfd8dc' },
        'WRITING': { on: { 'DONE': 'IDLE', 'HINTS': 'HAS_HINTS' }, color: '#ffb74d' },
        'READING': { on: { 'DONE': 'IDLE', 'REPAIR': 'REPAIRING', 'HINTS': 'HAS_HINTS' }, color: '#4fc3f7' },
        'HAS_HINTS': { on: { 'WRITE': 'WRITING', 'READ': 'READING', 'DONE': 'IDLE', 'FLUSHED': 'IDLE' }, color: '#ef5350' },
        'REPAIRING': { on: { 'DONE': 'IDLE', 'HINTS': 'HAS_HINTS' }, color: '#ab47bc' }
    }
};

function onUp() {
    let s = loadState();
    if (!s.fsm) {
        s.fsm = new Automat(fsmDef).serialize();
        s.role = 'coordinator';
        s.version = 0;
        s.data = null;
        s.pendingWrites = {};
        s.waitingAcks = {};
        s.ackTimer = 0;
        s.outbox = [];
        dumpState(s);
    }
}

function processOutbox(s) {
    if (s.outbox && s.outbox.length > 0) {
        while (s.outbox.length > 0) {
            const msg = s.outbox.shift();
            sendMessage(msg.to, msg.payload);
        }
    }
}

function returnToIdleOrHint(s) {
    let fsm = Automat.deserialize(s.fsm);
    if (Object.keys(s.pendingWrites).length > 0) {
        if (fsm.state !== 'HAS_HINTS') fsm.transition('HINTS');
    } else {
        fsm.transition('DONE');
    }
    s.fsm = fsm.serialize();
}

function onTimer(tick) {
    let s = loadState();
    if (!s.fsm) return;

    let fsm = Automat.deserialize(s.fsm);

    // Write v1 at tick 10
    if (tick === 10) {
        s.version = 1;
        s.data = 'value_v1';
        fsm.transition('WRITE');
        s.fsm = fsm.serialize();

        s.waitingAcks = { 1: true, 2: true, 3: true };
        s.ackTimer = tick + 15;

        const replicas = allServerIds.filter(id => id !== 0);
        for (const r of replicas) {
            s.outbox.push({ to: r, payload: { type: 'WRITE', data: s.data, version: s.version } });
        }
    }

    // Write 1 Timeout Check -> Queues Hints
    if (tick === s.ackTimer && Object.keys(s.waitingAcks).length > 0) {
        for (const rid in s.waitingAcks) {
            s.pendingWrites[rid] = { data: s.data, version: s.version };
        }
        s.waitingAcks = {};
        returnToIdleOrHint(s);
    }

    // Read Request at tick 40 -> Validates Versions
    if (tick === 40) {
        if (fsm.state !== 'READING') fsm.transition('READ');
        s.fsm = fsm.serialize();
        s.readReplies = {};
        s.readTimer = tick + 10;

        const replicas = allServerIds.filter(id => id !== 0);
        for (const r of replicas) {
            s.outbox.push({ to: r, payload: { type: 'READ_REQUEST' } });
        }
    }

    if (tick === s.readTimer && fsm.state === 'READING') {
        // Processing read results -> Evaluates disparities
        let latestVersion = s.version;
        let latestData = s.data;
        let needsRepair = [];

        for (const rid in s.readReplies) {
            const reply = s.readReplies[rid];
            if (reply.version < latestVersion) {
                needsRepair.push(rid);
            } else if (reply.version >= latestVersion) {
                // If it successfully replied with the fresh payload natively...
                // We can dynamically clear any pending Hints that were trapped due to dropped WRITE ACK packets!
                if (s.pendingWrites[rid]) delete s.pendingWrites[rid];
            }
        }

        if (needsRepair.length > 0) {
            fsm.transition('REPAIR');
            s.fsm = fsm.serialize();
            for (let r of needsRepair) {
                s.outbox.push({ to: parseInt(r), payload: { type: 'REPAIR', data: latestData, version: latestVersion } });

                // Discard the stored Hint since we dynamically read repaired it!
                if (s.pendingWrites[r]) delete s.pendingWrites[r];
            }
            // Return to idle in 5 ticks
            s.repairDoneTimer = tick + 5;
        } else {
            returnToIdleOrHint(s);
        }
    }

    if (tick === s.repairDoneTimer && fsm.state === 'REPAIRING') {
        returnToIdleOrHint(s);
    }

    // Write v2 at tick 65
    if (tick === 65) {
        s.version = 2;
        s.data = 'value_v2';

        // Dynamically reset back sequentially prior to next WRITING phase avoiding overlaps
        if (fsm.state !== 'IDLE') {
            returnToIdleOrHint(s);
            fsm = Automat.deserialize(s.fsm);
        }
        fsm.transition('WRITE');
        s.fsm = fsm.serialize();

        s.waitingAcks = { 1: true, 2: true, 3: true };
        s.ackTimer = tick + 15;

        const replicas = allServerIds.filter(id => id !== 0);
        for (const r of replicas) {
            s.outbox.push({ to: r, payload: { type: 'WRITE', data: s.data, version: s.version } });
        }
    }

    processOutbox(s);
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    if (!s.fsm) return;

    let fsm = Automat.deserialize(s.fsm);
    const m = message.payload;

    if (m.type === 'WRITE_ACK') {
        delete s.waitingAcks[message.from];
        delete s.pendingWrites[message.from];

        if (Object.keys(s.waitingAcks).length === 0) {
            returnToIdleOrHint(s);
        }
    }
    else if (m.type === 'READ_REPLY') {
        if (!s.readReplies) s.readReplies = {};
        s.readReplies[message.from] = { version: m.version, data: m.data };
    }
    else if (m.type === 'RECOVERY_NOTICE') {
        // Evaluates pending Hinton Handoff requests!
        if (s.pendingWrites && s.pendingWrites[m.replicaId]) {
            const pending = s.pendingWrites[m.replicaId];
            s.outbox.push({ to: m.replicaId, payload: { type: 'WRITE', data: pending.data, version: pending.version, hinted: true } });
            delete s.pendingWrites[m.replicaId];

            if (Object.keys(s.pendingWrites).length === 0) {
                if (fsm.state === 'HAS_HINTS') fsm.transition('FLUSHED');
                s.fsm = fsm.serialize();
            }
        }
    }

    processOutbox(s);
    dumpState(s);
}
