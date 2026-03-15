// Bully Algorithm — Ordinary (Non-Candidate) Node
// Ordinary nodes do NOT run for leader. When they suspect the leader is dead,
// they forward an ELECTION message to the known candidate nodes and wait.

const LEADER_TIMEOUT = 25;
const CANDIDATE_IDS = [3, 4];

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
            outbox: [],
        });
    } else {
        const s2 = loadState();
        const fsm = Automat.deserialize(s2.fsm);
        if (fsm.can('NEW_COORD')) fsm.transition('NEW_COORD');
        s2.fsm = fsm.serialize();
        s2.leader = -1;
        s2.lastLeaderSeen = 0;
        s2.electionForwarded = false;
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

    // Detect leader timeout and forward to candidates
    if (!s.electionForwarded && tick - s.lastLeaderSeen > LEADER_TIMEOUT && tick > 5) {
        s.electionForwarded = true;
        s.leader = -1;
        if (fsm.can('FORWARD_ELECTION')) fsm.transition('FORWARD_ELECTION');
        for (const id of CANDIDATE_IDS) {
            s.outbox.push({ to: id, payload: { type: 'ELECTION', from: serverId } });
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

    if (m.type === 'HEARTBEAT' || m.type === 'COORDINATOR') {
        s.leader = m.leader;
        s.lastLeaderSeen = s.tick !== undefined ? s.tick : 0;
        if (fsm.can('NEW_COORD')) fsm.transition('NEW_COORD');
        s.electionForwarded = false;
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}
