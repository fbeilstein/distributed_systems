const SERVER_ID = 0;
const RETRY_TIMEOUT = 35;

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        if (serverId === SERVER_ID) {
            // Server FSM visualizes strictly the internal database State
            const fsm = new Automat({
                initial: 'V_NULL',
                states: {
                    'V_NULL': { on: { WRITE_1: 'V_1', WRITE_2: 'V_2' }, color: '#cfd8dc' },
                    'V_1': { on: { WRITE_2: 'V_2' }, color: '#81c784' },
                    'V_2': { on: { WRITE_1: 'V_1' }, color: '#ffb74d' }
                }
            });
            dumpState({
                fsm: fsm.serialize(),
                data: null,
                completions: {} // Map of clientId -> last sequence ID safely committed
            });
        } else {
            // Client simply tracks whether its request successfully bridged the network.
            const fsm = new Automat({
                initial: 'IDLE',
                states: {
                    IDLE: { on: { START: 'SENDING' }, color: '#cfd8dc' },
                    SENDING: { on: { ACK: 'DONE', ACK_CACHED: 'DONE_CACHED' }, color: '#fff59d' },
                    DONE: { color: '#81c784' },
                    DONE_CACHED: { color: '#4fc3f7' }  // Distinct BLUE color to proudly display RIFL hit
                }
            });
            dumpState({
                fsm: fsm.serialize(),
                seqId: 1,  // Sequence monotonically identifies exactly what execution attempt this represents
                val: serverId === 1 ? 1 : 2, // Client 1 targets V=1, Client 2 targets V=2
                startTick: serverId === 1 ? 10 : 30, // Client 1 fires cleanly before Client 2
                lastSendTick: null
            });
        }
    }
}

function onTimer(tick) {
    let s = loadState();
    s.tick = tick;
    const fsm = Automat.deserialize(s.fsm);

    if (serverId !== SERVER_ID) {
        // Broadcast the initial payload identically based on start time mapping
        if (fsm.state === 'IDLE' && tick >= s.startTick) {
            sendMessage(SERVER_ID, { type: 'RPC_WRITE', clientId: serverId, seqId: s.seqId, val: s.val });
            s.lastSendTick = tick;
            if (fsm.can('START')) fsm.transition('START');
        }

        // Automatic Timeout Retry if network mathematically fails to acknowledge successfully
        if (fsm.state === 'SENDING' && s.lastSendTick !== null && tick - s.lastSendTick >= RETRY_TIMEOUT) {
            sendMessage(SERVER_ID, { type: 'RPC_WRITE', clientId: serverId, seqId: s.seqId, val: s.val });
            s.lastSendTick = tick;
        }
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    const m = message.payload;

    if (serverId === SERVER_ID) {
        if (m.type === 'RPC_WRITE') {
            const cid = m.clientId;
            const sid = m.seqId;

            if (!s.completions[cid]) {
                s.completions[cid] = 0;
            }

            if (sid <= s.completions[cid]) {
                // RIFL COMPLETION OBJECT CATCHES DUPLICATE!
                // It cleanly intercepts the message and safely routes a fake CACHED ACK rather than physically mutating!
                sendMessage(cid, { type: 'RPC_ACK', seqId: sid, status: 'CACHED' });
            } else {
                // NORMAL NEW WRITE. Validate and officially apply physically.
                s.data = m.val;
                s.completions[cid] = sid; // Explicitly log the Completion Object Sequence

                if (s.data === 1 && fsm.can('WRITE_1')) fsm.transition('WRITE_1');
                if (s.data === 2 && fsm.can('WRITE_2')) fsm.transition('WRITE_2');

                sendMessage(cid, { type: 'RPC_ACK', seqId: sid, status: 'SUCCESS' });
            }
        }
    } else {
        if (m.type === 'RPC_ACK' && m.seqId === s.seqId) {
            // Unblocks the client's pending application timer cleanly
            if (m.status === 'CACHED') {
                if (fsm.can('ACK_CACHED')) fsm.transition('ACK_CACHED');
            } else {
                if (fsm.can('ACK')) fsm.transition('ACK');
            }
            s.lastSendTick = null;
        }
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}
