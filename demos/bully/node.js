// Bully Algorithm — Leader Election
// Nodes are numbered 0..N-1. Highest ID wins ("bullies" lower-ID nodes.
// Protocol:
//   1. Any node noticing absence of a heartbeat from the current leader starts ELECTION.
//   2. It sends ELECTION to all nodes with higher IDs.
//   3. If it gets OK (a bully response) from any higher node, it steps back.
//   4. If it gets no OK within ELECTION_TIMEOUT, it declares itself COORDINATOR.
//   5. Coordinator sends COORDINATOR msg to all lower nodes.
//   6. Coordinator sends periodic HEARTBEAT so others detect its liveness.

const HEARTBEAT_INTERVAL = 10;
const LEADER_TIMEOUT = 25;  // No heartbeat for this long → start election
const ELECTION_TIMEOUT = 20;  // No OK response → declare victory

const NO_LEADER = -1;

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        const fsm = new Automat({
            initial: serverId === 4 ? 'leader' : 'follower',
            states: {
                follower: { on: { START_ELECTION: 'electing', BECOME_LEADER: 'leader' }, color: '#cfd8dc' },
                electing: { on: { HIGHER_ID_ANSWERED: 'waiting', WON_ELECTION: 'leader', NEW_COORD: 'follower' }, color: '#ffb74d' },
                waiting: { on: { NEW_COORD: 'follower', START_ELECTION: 'electing' }, color: '#fff59d' },
                leader: { on: { BECOME_FOLLOWER: 'follower' }, color: '#81c784' }
            }
        });
        dumpState({
            fsm: fsm.serialize(),
            leader: serverId === 4 ? 4 : NO_LEADER,  // Node 4 starts as leader
            electionStartTick: null,
            electing: false,
            lastLeaderSeen: 0,
            outbox: [],
        });
    } else {
        // Recovery: force a new election since we don't know current leader
        const s2 = loadState();
        const fsm = Automat.deserialize(s2.fsm);
        if (fsm.can('NEW_COORD')) fsm.transition('NEW_COORD');
        else if (fsm.can('BECOME_FOLLOWER')) fsm.transition('BECOME_FOLLOWER');
        s2.fsm = fsm.serialize();
        s2.leader = NO_LEADER;
        s2.electionStartTick = null;
        s2.electing = false;
        s2.lastLeaderSeen = 0;
        dumpState(s2);
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

    // If leader, send periodic heartbeats
    if (fsm.state === 'leader') {
        if (tick % HEARTBEAT_INTERVAL === 0) {
            for (const id of allServerIds) {
                if (id !== serverId) {
                    s.outbox.push({ to: id, payload: { type: 'HEARTBEAT', leader: serverId } });
                }
            }
        }
        processOutbox(s);
        dumpState(s);
        return;
    }

    // If electing and no OK received, declare victory
    if (s.electing && s.electionStartTick !== null && tick - s.electionStartTick > ELECTION_TIMEOUT) {
        // No higher node responded — we win!
        s.leader = serverId;
        if (fsm.can('WON_ELECTION')) fsm.transition('WON_ELECTION');
        s.electing = false;
        s.electionStartTick = null;
        for (const id of allServerIds) {
            if (id !== serverId) {
                s.outbox.push({ to: id, payload: { type: 'COORDINATOR', leader: serverId } });
            }
        }
        s.fsm = fsm.serialize();
        processOutbox(s);
        dumpState(s);
        return;
    }

    // Non-leader: check if leader has been silent too long
    if (!s.electing && tick - s.lastLeaderSeen > LEADER_TIMEOUT && tick > 5) {
        // Start election
        s.electing = true;
        s.electionStartTick = tick;
        s.leader = NO_LEADER;
        if (fsm.can('START_ELECTION')) fsm.transition('START_ELECTION');

        const higher = allServerIds.filter(id => id > serverId);
        if (higher.length === 0) {
            // We ARE the highest — immediately win
            s.leader = serverId;
            if (fsm.can('WON_ELECTION')) fsm.transition('WON_ELECTION');
            s.electing = false;
            for (const id of allServerIds) {
                if (id !== serverId) {
                    s.outbox.push({ to: id, payload: { type: 'COORDINATOR', leader: serverId } });
                }
            }
        } else {
            for (const id of higher) {
                s.outbox.push({ to: id, payload: { type: 'ELECTION', from: serverId } });
            }
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

    if (m.type === 'HEARTBEAT') {
        s.leader = m.leader;
        s.lastLeaderSeen = s.tick !== undefined ? s.tick : 0;
        if (fsm.can('NEW_COORD')) fsm.transition('NEW_COORD');
        else if (fsm.can('BECOME_FOLLOWER')) fsm.transition('BECOME_FOLLOWER');
        s.electing = false;
        s.electionStartTick = null;
    }

    else if (m.type === 'ELECTION') {
        // Reply OK to the lower-ID node (bully it)
        s.outbox.push({ to: message.from, payload: { type: 'OK', from: serverId } });

        // Start our own election if not already
        if (!s.electing) {
            s.electing = true;
            s.electionStartTick = s.tick !== undefined ? s.tick : 0;
            if (fsm.can('START_ELECTION')) fsm.transition('START_ELECTION');
            const higher = allServerIds.filter(id => id > serverId);
            if (higher.length === 0) {
                // Immediately win
                s.leader = serverId;
                if (fsm.can('WON_ELECTION')) fsm.transition('WON_ELECTION');
                s.electing = false;
                for (const id of allServerIds) {
                    if (id !== serverId) {
                        s.outbox.push({ to: id, payload: { type: 'COORDINATOR', leader: serverId } });
                    }
                }
            } else {
                for (const id of higher) {
                    s.outbox.push({ to: id, payload: { type: 'ELECTION', from: serverId } });
                }
            }
        }
    }

    else if (m.type === 'OK') {
        // Someone higher responded — stop our own election bid
        // (they will handle it)
        s.electing = false;
        s.electionStartTick = null;
        if (fsm.can('HIGHER_ID_ANSWERED')) fsm.transition('HIGHER_ID_ANSWERED');
    }

    else if (m.type === 'COORDINATOR') {
        s.leader = m.leader;
        s.lastLeaderSeen = s.tick !== undefined ? s.tick : 0;
        if (fsm.can('NEW_COORD')) fsm.transition('NEW_COORD');
        else if (fsm.can('BECOME_FOLLOWER')) fsm.transition('BECOME_FOLLOWER');
        s.electing = false;
        s.electionStartTick = null;
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}
