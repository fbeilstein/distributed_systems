// Bully Algorithm — Ordinary (Non-Candidate) Node
// Ordinary nodes do NOT run for leader. When they suspect the leader is dead,
// they forward an ELECTION message to the known candidate nodes and wait.

const LEADER_TIMEOUT = 25;
const CANDIDATE_IDS = [3, 4];

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        dumpState({
            leader: -1,
            status: 'ordinary',
            lastLeaderSeen: 0,
            electionForwarded: false,
        });
    } else {
        const s2 = loadState();
        s2.leader = -1;
        s2.status = 'ordinary';
        s2.lastLeaderSeen = 0;
        s2.electionForwarded = false;
        dumpState(s2);
    }
}

function onTimer(tick) {
    let s = loadState();
    s.tick = tick;

    // Detect leader timeout and forward to candidates
    if (!s.electionForwarded && tick - s.lastLeaderSeen > LEADER_TIMEOUT && tick > 5) {
        s.electionForwarded = true;
        s.leader = -1;
        s.status = 'waiting_election';
        for (const id of CANDIDATE_IDS) {
            sendMessage(id, { type: 'ELECTION', from: serverId });
        }
    }

    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const m = message.payload;

    if (m.type === 'HEARTBEAT' || m.type === 'COORDINATOR') {
        s.leader = m.leader;
        s.lastLeaderSeen = s.tick !== undefined ? s.tick : 0;
        s.status = 'ordinary';
        s.electionForwarded = false;
    }

    dumpState(s);
}
