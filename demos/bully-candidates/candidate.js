// Bully Algorithm — Candidate/Ordinary Optimization
// Only "candidate" nodes (high IDs: 3, 4) participate in elections.
// "Ordinary" nodes (0, 1, 2) never run for leader — they just forward ELECTION
// messages to the known candidates and wait for a COORDINATOR announcement.
// This drastically reduces election message overhead.

const HEARTBEAT_INTERVAL = 10;
const LEADER_TIMEOUT = 25;
const ELECTION_TIMEOUT = 20;

// This file is for CANDIDATE nodes (IDs 3 and 4)
const CANDIDATE_IDS = [3, 4];

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        dumpState({
            leader: serverId === 4 ? 4 : -1,
            status: serverId === 4 ? 'leader' : 'candidate',
            electing: false,
            electionStartTick: null,
            lastLeaderSeen: 0,
        });
    } else {
        const s2 = loadState();
        s2.leader = -1;
        s2.status = 'candidate';
        s2.electing = false;
        s2.electionStartTick = null;
        s2.lastLeaderSeen = 0;
        dumpState(s2);
    }
}

function onTimer(tick) {
    let s = loadState();
    s.tick = tick;

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

    // Candidate: check election timeout (won by default if no higher responds)
    if (s.electing && s.electionStartTick !== null && tick - s.electionStartTick > ELECTION_TIMEOUT) {
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

    // Candidate: leader timeout
    if (!s.electing && tick - s.lastLeaderSeen > LEADER_TIMEOUT && tick > 5) {
        s.electing = true;
        s.electionStartTick = tick;
        s.status = 'electing';
        s.leader = -1;
        const higherCandidates = CANDIDATE_IDS.filter(id => id > serverId);
        if (higherCandidates.length === 0) {
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
            for (const id of higherCandidates) {
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
        s.status = 'candidate';  // Candidate is idle when there's a leader
        s.electing = false;
        s.electionStartTick = null;
    }

    else if (m.type === 'ELECTION') {
        // Bully the sender
        sendMessage(message.from, { type: 'OK', from: serverId });

        if (!s.electing) {
            s.electing = true;
            s.electionStartTick = s.tick !== undefined ? s.tick : 0;
            s.status = 'electing';
            const higherCandidates = CANDIDATE_IDS.filter(id => id > serverId);
            if (higherCandidates.length === 0) {
                s.leader = serverId;
                s.status = 'leader';
                s.electing = false;
                for (const id of allServerIds) {
                    if (id !== serverId) {
                        sendMessage(id, { type: 'COORDINATOR', leader: serverId });
                    }
                }
            } else {
                for (const id of higherCandidates) sendMessage(id, { type: 'ELECTION', from: serverId });
            }
        }
    }

    else if (m.type === 'OK') {
        // A higher candidate responded — step back
        s.electing = false;
        s.electionStartTick = null;
        s.status = 'waiting';
    }

    else if (m.type === 'COORDINATOR') {
        s.leader = m.leader;
        s.lastLeaderSeen = s.tick !== undefined ? s.tick : 0;
        s.status = 'candidate';
        s.electing = false;
        s.electionStartTick = null;
    }

    dumpState(s);
}
