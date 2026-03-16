const PING_INTERVAL = 15;
const ACK_TIMEOUT = 10;
const IND_TIMEOUT = 16;
const CONFIRM_TIMEOUT = 20;

const MASTER_ID = 0;
const SLAVE_ID = 4;

function onUp() {
    let s = loadState();
    // Only need to keep track of the slave!
    if (!s.slaveState || !s.outbox) {
        dumpState({
            slaveState: { status: 'alive', suspectSince: null },
            pendingPing: null,
            outbox: [],
        });
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
    s.tick = tick;

    // Confirm suspects → failed after timeout
    if (s.slaveState.status === 'suspect' && s.slaveState.suspectSince !== null && tick - s.slaveState.suspectSince > CONFIRM_TIMEOUT) {
        s.slaveState.status = 'failed';
    }

    // Initiate a new ping cycle every PING_INTERVAL ticks
    if (tick % PING_INTERVAL === 0 && !s.pendingPing) {
        s.outbox.push({ to: SLAVE_ID, payload: { type: 'PING', from: serverId } });
        s.pendingPing = { target: SLAVE_ID, sentTick: tick, indirect: false };
    }

    // Direct ACK timeout — switch to indirect pings via Witnesses
    if (s.pendingPing && !s.pendingPing.indirect && tick - s.pendingPing.sentTick > ACK_TIMEOUT) {
        s.pendingPing.indirect = true;
        s.pendingPing.sentTick = tick;

        // We know nodes 1, 2, 3 are witnesses. We don't need a list of alive witnesses, 
        // we can just blindly cast the PING_REQ to them.
        const witnesses = [1, 2, 3];
        for (const w of witnesses) {
            s.outbox.push({ to: w, payload: { type: 'PING_REQ', target: s.pendingPing.target, from: serverId } });
        }
    }

    // Indirect ACK timeout — mark as suspect
    if (s.pendingPing && s.pendingPing.indirect && tick - s.pendingPing.sentTick > IND_TIMEOUT) {
        if (s.slaveState.status === 'alive') {
            s.slaveState.status = 'suspect';
            s.slaveState.suspectSince = tick;
        }
        s.pendingPing = null;
    }

    processOutbox(s);
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const m = message.payload;

    if (m.type === 'ACK') {
        const sender = m.from !== undefined ? m.from : message.from;
        if (sender === SLAVE_ID) {
            s.slaveState.status = 'alive';
            s.slaveState.suspectSince = null;
        }
        // Clear pending ping if this is for it
        if (s.pendingPing && s.pendingPing.target === sender) {
            s.pendingPing = null;
        }
    }

    processOutbox(s);
    dumpState(s);
}
