// Bully Algorithm — Leader Election
// Nodes are numbered 0..N-1. Highest ID wins ("bullies" lower-ID nodes.
// Protocol:
//   1. Any node noticing absence of a heartbeat from the current leader starts ELECTION.
//   2. It sends ELECTION to all nodes with higher IDs.
//   3. If it gets OK (a bully response) from any higher node, it steps back.
//   4. If it gets no OK within ELECTION_TIMEOUT, it declares itself COORDINATOR.
//   5. Coordinator sends COORDINATOR msg to all lower nodes.
//   6. Coordinator sends periodic HEARTBEAT so others detect its liveness.
//
// Demo: Node 4 (highest ID) starts as leader. Crashes at tick 20.
//       Node 0 starts election → cascading bullying → Node 3 wins.
//       Node 4 recovers at tick 80 → immediately reclaims leadership.

const HEARTBEAT_INTERVAL = 10;
const LEADER_TIMEOUT = 25;  // No heartbeat for this long → start election
const ELECTION_TIMEOUT = 20;  // No OK response → declare victory

const NO_LEADER = -1;

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        dumpState({
            leader: serverId === 4 ? 4 : NO_LEADER,  // Node 4 starts as leader
            electionStartTick: null,
            electing: false,
            lastLeaderSeen: 0,
            status: serverId === 4 ? 'leader' : 'follower',
        });
    } else {
        // Recovery: force a new election since we don't know current leader
        const s2 = loadState();
        s2.leader = NO_LEADER;
        s2.electionStartTick = null;
        s2.electing = false;
        s2.lastLeaderSeen = 0;
        s2.status = 'follower';
        dumpState(s2);
    }
}

function onTimer(tick) {
    let s = loadState();
    s.tick = tick;

    // If leader, send periodic heartbeats
    if (s.status === 'leader') {
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

    // If electing and no OK received, declare victory
    if (s.electing && s.electionStartTick !== null && tick - s.electionStartTick > ELECTION_TIMEOUT) {
        // No higher node responded — we win!
        s.leader = serverId;
        s.status = 'leader';
        s.electing = false;
        s.electionStartTick = null;
        for (const id of allServerIds) {
            if (id !== serverId) {
                sendMessage(id, { type: 'COORDINATOR', leader: serverId });
            }
        }
        dumpState(s);
        return;
    }

    // Non-leader: check if leader has been silent too long
    if (!s.electing && tick - s.lastLeaderSeen > LEADER_TIMEOUT && tick > 5) {
        // Start election
        s.electing = true;
        s.electionStartTick = tick;
        s.leader = NO_LEADER;
        s.status = 'electing';

        const higher = allServerIds.filter(id => id > serverId);
        if (higher.length === 0) {
            // We ARE the highest — immediately win
            s.leader = serverId;
            s.status = 'leader';
            s.electing = false;
            for (const id of allServerIds) {
                if (id !== serverId) {
                    sendMessage(id, { type: 'COORDINATOR', leader: serverId });
                }
            }
        } else {
            for (const id of higher) {
                sendMessage(id, { type: 'ELECTION', from: serverId });
            }
        }
    }

    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const m = message.payload;

    if (m.type === 'HEARTBEAT') {
        s.leader = m.leader;
        s.lastLeaderSeen = s.tick !== undefined ? s.tick : 0;
        s.status = 'follower';
        s.electing = false;
        s.electionStartTick = null;
    }

    else if (m.type === 'ELECTION') {
        // Reply OK to the lower-ID node (bully it)
        sendMessage(message.from, { type: 'OK', from: serverId });

        // Start our own election if not already
        if (!s.electing) {
            s.electing = true;
            s.electionStartTick = s.tick !== undefined ? s.tick : 0;
            s.status = 'electing';
            const higher = allServerIds.filter(id => id > serverId);
            if (higher.length === 0) {
                // Immediately win
                s.leader = serverId;
                s.status = 'leader';
                s.electing = false;
                for (const id of allServerIds) {
                    if (id !== serverId) {
                        sendMessage(id, { type: 'COORDINATOR', leader: serverId });
                    }
                }
            } else {
                for (const id of higher) {
                    sendMessage(id, { type: 'ELECTION', from: serverId });
                }
            }
        }
    }

    else if (m.type === 'OK') {
        // Someone higher responded — stop our own election bid
        // (they will handle it)
        s.electing = false;
        s.electionStartTick = null;
        s.status = 'waiting';
    }

    else if (m.type === 'COORDINATOR') {
        s.leader = m.leader;
        s.lastLeaderSeen = s.tick !== undefined ? s.tick : 0;
        s.status = 'follower';
        s.electing = false;
        s.electionStartTick = null;
    }

    dumpState(s);
}
