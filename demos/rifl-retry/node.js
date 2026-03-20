const SERVER_ID = 0;
const RETRY_TIMEOUT = 35;

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        if (serverId === SERVER_ID) {
            // Server FSM visualizes strictly the internal database State, plus a bright Blue flash if RIFL intercepts a duplicate.
            const fsm = new Automat({
                initial: 'V_NULL',
                states: {
                    'V_NULL': { on: { WRITE_1: 'V_1', WRITE_2: 'V_2' }, color: '#cfd8dc' },
                    'V_1': { on: { WRITE_2: 'V_2', RIFL_HIT: 'RIFL_CACHE_1' }, color: '#81c784' },
                    'V_2': { on: { WRITE_1: 'V_1', RIFL_HIT: 'RIFL_CACHE_2' }, color: '#ffb74d' },
                    'RIFL_CACHE_1': { on: { WRITE_2: 'V_2', RESTORE: 'V_1' }, color: '#4fc3f7' },
                    'RIFL_CACHE_2': { on: { WRITE_1: 'V_1', RESTORE: 'V_2' }, color: '#4fc3f7' }
                }
            });
            dumpState({
                fsm: fsm.serialize(),
                data: null,
                completions: {} // Map of clientId -> last sequence ID safely committed
            });
        } else {
            // Client simply tracks whether its request successfully bridged the network safely.
            const fsm = new Automat({
                initial: 'IDLE',
                states: {
                    IDLE: { on: { START: 'SENDING' }, color: '#cfd8dc' },
                    SENDING: { on: { ACK: 'DONE' }, color: '#fff59d' },
                    DONE: { color: '#81c784' }
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
    } else {
        // Reset the bright visual flash after explicitly proving the Completion Object successfully blocked the payload.
        if ((fsm.state === 'RIFL_CACHE_1' || fsm.state === 'RIFL_CACHE_2') && tick - (s.cacheTick || 0) > 15) {
            if (fsm.can('RESTORE')) fsm.transition('RESTORE');
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
                // It cleanly intercepts the message and forces a fake cache ACK rather than applying a destructive physical mutation!
                if (fsm.can('RIFL_HIT')) fsm.transition('RIFL_HIT');

                s.cacheTick = s.tick !== undefined ? s.tick : 0;
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
            if (fsm.can('ACK')) fsm.transition('ACK');
            s.lastSendTick = null;
        }
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}
