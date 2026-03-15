// Ring Algorithm — Leader Election
// Nodes form a logical ring (ID 0 → 1 → 2 → ... → N-1 → 0).
// Protocol:
//   1. Any node that hasn't heard from a leader starts an election by generating
//      a token containing its own ID and forwarding it clockwise.
//   2. Each node compares the token's ID to its own:
//      - If token ID > own ID: forward the token (someone better is running).
//      - If token ID < own ID: replace with own ID and forward.
//      - If token ID == own ID: I've made a full loop — I WIN! Broadcast ELECTED.
//   3. ELECTED message propagates around the ring.
//
// Demo: Node 3 crashes at tick 10 to trigger a new election. Ring skips it.

const RING_MSG_TIMEOUT = 35;  // Start election if no leader heartbeat for this long
const HEARTBEAT_INTERVAL = 10;

function nextNode(id) {
    const n = allServerIds.length;
    return (id + 1) % n;
}

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        const fsm = new Automat({
            initial: 'follower',
            states: {
                follower: { on: { START_ELECTION: 'candidate', NEW_COORD: 'follower' }, color: '#cfd8dc' },
                candidate: { on: { WON_ELECTION: 'leader', NEW_COORD: 'follower' }, color: '#ffb74d' },
                leader: { on: { BECOME_FOLLOWER: 'follower' }, color: '#81c784' }
            }
        });
        dumpState({
            fsm: fsm.serialize(),
            leader: -1,
            electing: false,
            lastLeaderSeen: 0,
        });
    } else {
        const s2 = loadState();
        const fsm = Automat.deserialize(s2.fsm);
        if (fsm.can('NEW_COORD')) fsm.transition('NEW_COORD');
        else if (fsm.can('BECOME_FOLLOWER')) fsm.transition('BECOME_FOLLOWER');
        s2.fsm = fsm.serialize();
        s2.leader = -1;
        s2.electing = false;
        s2.lastLeaderSeen = 0;
        dumpState(s2);
    }
}

function onTimer(tick) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    s.tick = tick;

    // Leader sends periodic heartbeats
    if (fsm.state === 'leader') {
        if (tick % HEARTBEAT_INTERVAL === 0) {
            for (const id of allServerIds) {
                if (id !== serverId) {
                    sendMessage(id, { type: 'HEARTBEAT', leader: serverId });
                }
            }
        }
        dumpState(s);
        return;
    }

    // Follower: detect leader timeout and start election
    if (!s.electing && tick - s.lastLeaderSeen > RING_MSG_TIMEOUT && tick > 5) {
        s.electing = true;
        if (fsm.can('START_ELECTION')) fsm.transition('START_ELECTION');
        // Send our ID token to the next node in the ring
        const next = nextNode(serverId);
        sendMessage(next, { type: 'ELECTION', candidateId: serverId, initiator: serverId });
    }

    s.fsm = fsm.serialize();
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
    }

    else if (m.type === 'ELECTION') {
        s.electing = true;
        let candidateId = m.candidateId;
        const initiator = m.initiator;

        if (candidateId === serverId) {
            // Token has made a full loop — we win!
            s.leader = serverId;
            if (fsm.can('WON_ELECTION')) fsm.transition('WON_ELECTION');
            s.electing = false;
            // Broadcast ELECTED around the ring
            const next = nextNode(serverId);
            sendMessage(next, { type: 'ELECTED', leader: serverId });
        } else {
            if (fsm.can('START_ELECTION')) fsm.transition('START_ELECTION');
            // Take the max (higher ID wins)
            if (serverId > candidateId) candidateId = serverId;
            // Forward to next node in ring
            const next = nextNode(serverId);
            sendMessage(next, { type: 'ELECTION', candidateId, initiator });
        }
    }

    else if (m.type === 'ELECTED') {
        const newLeader = m.leader;
        s.leader = newLeader;
        if (newLeader === serverId) {
            if (fsm.can('WON_ELECTION')) fsm.transition('WON_ELECTION');
        } else {
            if (fsm.can('NEW_COORD')) fsm.transition('NEW_COORD');
            else if (fsm.can('BECOME_FOLLOWER')) fsm.transition('BECOME_FOLLOWER');
        }
        s.electing = false;
        s.lastLeaderSeen = s.tick !== undefined ? s.tick : 0;

        // Propagate ELECTED around the ring until it gets back to the leader
        if (newLeader !== serverId) {
            const next = nextNode(serverId);
            sendMessage(next, { type: 'ELECTED', leader: newLeader });
        }
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}
