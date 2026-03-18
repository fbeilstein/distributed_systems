// Bully Algorithm — Ordinary (Non-Candidate) Node
// Ordinary nodes do NOT run for leader. When they suspect the leader is dead,
// they forward an ELECTION message to the known candidate nodes and wait.

const LEADER_TIMEOUT = 25;
const CANDIDATE_IDS = [2, 3, 4];

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        const fsm = new Automat({
            initial: 'ordinary',
            states: {
                ordinary: { on: { FORWARD_ELECTION: 'waiting_election' }, color: '#cfd8dc' },
                waiting_election: { on: { NEW_COORD: 'ordinary' }, color: '#fff59d' }
            }
        });
        dumpState({
            fsm: fsm.serialize(),
            leader: -1,
            lastLeaderSeen: 0,
            electionForwarded: false,
            electing: false,
            electionStartTick: null,
            permutation: [2, 4, 1, 3, 0]
        });
    } else {
        const s2 = loadState();
        const fsm = Automat.deserialize(s2.fsm);
        if (fsm.can('NEW_COORD')) fsm.transition('NEW_COORD');
        s2.fsm = fsm.serialize();
        s2.leader = -1;
        s2.lastLeaderSeen = 0;
        s2.electionForwarded = false;
        s2.electing = false;
        s2.electionStartTick = null;
        if (!s2.permutation) s2.permutation = [2, 4, 1, 3, 0];
        dumpState(s2);
    }
}

function onTimer(tick) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    s.tick = tick;

    const offset = s.permutation ? s.permutation.indexOf(serverId) * 5 : serverId * 5;

    // Detect leader timeout and forward to candidates
    if (!s.electionForwarded && tick - s.lastLeaderSeen > LEADER_TIMEOUT + offset && tick > 5) {
        s.electionForwarded = true;
        s.leader = -1;
        if (fsm.can('FORWARD_ELECTION')) fsm.transition('FORWARD_ELECTION');
        for (const id of CANDIDATE_IDS) {
            sendMessage(id, { type: 'ELECTION', from: serverId });
        }
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    const m = message.payload;

    if (m.type === 'HEARTBEAT' || m.type === 'COORDINATOR') {
        s.leader = m.leader;
        s.lastLeaderSeen = s.tick !== undefined ? s.tick : 0;
        if (fsm.can('NEW_COORD')) fsm.transition('NEW_COORD');
        s.electionForwarded = false;
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}
