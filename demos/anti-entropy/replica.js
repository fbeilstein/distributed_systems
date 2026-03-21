const fsmDef = {
    initial: 'V0',
    states: {
        'V0': { on: { 'UP_V1': 'V1', 'UP_V2': 'V2' }, color: '#cfd8dc' },
        'V1': { on: { 'UP_V2': 'V2' }, color: '#81c784' },
        'V2': { on: {}, color: '#2e7d32' }
    }
};

function onUp() {
    let s = loadState();
    if (!s.fsm) {
        let fsm = new Automat(fsmDef);
        s.fsm = fsm.serialize();
        s.role = 'replica';
        s.version = 0;
        s.data = null;
        s.outbox = [];
        dumpState(s);
    } else {
        // Recovered from crash!
        let outbox = s.outbox || [];
        outbox.push({ to: 0, payload: { type: 'RECOVERY_NOTICE', replicaId: serverId } });
        s.outbox = outbox;
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

function onTimer(tick) {
    let s = loadState();
    if (!s.fsm) return;
    processOutbox(s);
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    if (!s.fsm) return;

    let fsm = Automat.deserialize(s.fsm);
    const m = message.payload;

    if (m.type === 'WRITE' || m.type === 'REPAIR') {
        if (m.version > s.version) {
            s.version = m.version;
            s.data = m.data;
            if (m.version === 1) fsm.transition('UP_V1');
            if (m.version === 2) {
                if (fsm.state === 'V0') fsm.transition('UP_V1'); // Force transitions sequentially
                fsm.transition('UP_V2');
            }
            s.fsm = fsm.serialize();
        }
        s.outbox.push({ to: 0, payload: { type: 'WRITE_ACK', version: s.version } });
    }
    else if (m.type === 'READ_REQUEST') {
        s.outbox.push({ to: 0, payload: { type: 'READ_REPLY', version: s.version, data: s.data } });
    }

    processOutbox(s);
    dumpState(s);
}
