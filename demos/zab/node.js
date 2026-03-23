// Zookeeper Atomic Broadcast (ZAB) Epoch Discovery & Sync Demo
//
// Highlights the 3 distinct phases of ZAB leader establishment.
// 1. Discovery: Leader proposes new epoch, gathers highest Zxid from quorum.
// 2. Synchronization: Leader broadcasts the unified history to bring followers up to speed.
// 3. Broadcast: Active phase where client requests are sequenced.
//
// In this demo, Node 0 is the Prospective Leader with history [A, B, C].
// Node 1, 2 have [A, B]. Node 3 has [A]. Node 4 has [].
// Watch them all sync up to [A, B, C] before Broadcast phase begins!

const QUORUM = 3;

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {

        let fsm;
        let baseState = { outbox: [] };

        if (serverId === 0) {
            fsm = new Automat({
                initial: 'discovery',
                states: {
                    discovery: { on: { QUORUM_ACK_E: 'sync' }, color: '#ffb74d' },
                    sync: { on: { QUORUM_ACK_LD: 'broadcast' }, color: '#64b5f6' },
                    broadcast: { on: {}, color: '#81c784' }
                }
            });
            Object.assign(baseState, {
                role: 'leader',
                epoch: 2,
                history: ['A', 'B', 'C'],
                ackECount: 1, // Self
                ackLdCount: 1, // Self
                highestSeenHistory: ['A', 'B', 'C']
            });
        } else {
            fsm = new Automat({
                initial: 'discovery',
                states: {
                    discovery: { on: { RECEIVED_NEWLEADER: 'sync' }, color: '#ffb74d' },
                    sync: { on: { RECEIVED_UPTODATE: 'broadcast' }, color: '#64b5f6' },
                    broadcast: { on: {}, color: '#81c784' }
                }
            });
            let initialHistory = [];
            if (serverId === 1 || serverId === 2) initialHistory = ['A', 'B'];
            else if (serverId === 3) initialHistory = ['A'];
            else if (serverId === 4) initialHistory = [];

            Object.assign(baseState, {
                role: 'follower',
                epoch: 1,
                history: initialHistory
            });
        }

        baseState.fsm = fsm.serialize();
        dumpState(baseState);
    }
}

function processOutbox(s) {
    if (s.outbox && s.outbox.length > 0) {
        let maxPerTick = 2; // Allow sending a couple msgs per tick to speed demo up
        while (s.outbox.length > 0 && maxPerTick > 0) {
            const msg = s.outbox.shift();
            sendMessage(msg.to, msg.payload);
            maxPerTick--;
        }
    }
}

function onTimer(tick) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    s.tick = tick;

    // Leader kicks off Discovery phase at tick 10
    if (serverId === 0 && tick === 10) {
        for (const id of allServerIds) {
            if (id !== 0) s.outbox.push({ to: id, payload: { type: 'CEPOCH', epoch: s.epoch } });
        }
    }

    // Leader acts in broadcast phase (sends a heartbeat/ping just to show activity)
    if (serverId === 0 && fsm.state === 'broadcast' && tick % 20 === 0) {
        // ZAB broadcasts "PROPOSAL" and "COMMIT"
        s.history.push('D');
        for (const id of allServerIds) {
            if (id !== 0) s.outbox.push({ to: id, payload: { type: 'PROPOSAL', data: 'D' } });
        }
    }

    s.fsm = fsm.serialize();
    processOutbox(s);
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    const m = message.payload;

    if (s.role === 'leader') {
        if (m.type === 'ACK-E' && fsm.state === 'discovery') {
            s.ackECount++;
            if (m.history.length > s.highestSeenHistory.length) {
                s.highestSeenHistory = m.history;
            }

            if (s.ackECount >= QUORUM) {
                s.history = s.highestSeenHistory; // Adopt best history
                if (fsm.can('QUORUM_ACK_E')) fsm.transition('QUORUM_ACK_E');

                // Start Synchronization Phase
                for (const id of allServerIds) {
                    if (id !== 0) s.outbox.push({ to: id, payload: { type: 'NEWLEADER', epoch: s.epoch, history: s.history } });
                }
            }
        }
        else if (m.type === 'ACK-LD' && fsm.state === 'sync') {
            s.ackLdCount++;
            if (s.ackLdCount >= QUORUM) {
                if (fsm.can('QUORUM_ACK_LD')) fsm.transition('QUORUM_ACK_LD');

                // Start Broadcast Phase
                for (const id of allServerIds) {
                    if (id !== 0) s.outbox.push({ to: id, payload: { type: 'UPTODATE' } });
                }
            }
        }
        // Followers blindly acking active broadcast proposals
        else if (m.type === 'ACK' && fsm.state === 'broadcast') {
            // Commit logic omitted for brevity, just demoing state transitions!
        }
    }
    else if (s.role === 'follower') {
        if (m.type === 'CEPOCH') {
            s.epoch = m.epoch;
            s.outbox.push({ to: message.from, payload: { type: 'ACK-E', history: s.history } });
        }
        else if (m.type === 'NEWLEADER') {
            if (fsm.can('RECEIVED_NEWLEADER')) fsm.transition('RECEIVED_NEWLEADER');
            s.epoch = m.epoch;
            s.history = m.history; // Overwrite history to sync with leader
            s.outbox.push({ to: message.from, payload: { type: 'ACK-LD' } });
        }
        else if (m.type === 'UPTODATE') {
            if (fsm.can('RECEIVED_UPTODATE')) fsm.transition('RECEIVED_UPTODATE');
        }
        else if (m.type === 'PROPOSAL') {
            if (fsm.state === 'broadcast') {
                s.history.push(m.data);
                s.outbox.push({ to: message.from, payload: { type: 'ACK' } });
            }
        }
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}
