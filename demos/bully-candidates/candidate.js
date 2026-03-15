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
        const fsm = new Automat({
            initial: serverId === 4 ? 'leader' : 'candidate',
            states: {
                candidate: { on: { START_ELECTION: 'electing', BECOME_LEADER: 'leader' }, color: '#cfd8dc' },
                electing: { on: { HIGHER_ID_ANSWERED: 'waiting', WON_ELECTION: 'leader', NEW_COORD: 'candidate' }, color: '#ffb74d' },
                waiting: { on: { NEW_COORD: 'candidate', START_ELECTION: 'electing' }, color: '#fff59d' },
                leader: { on: { BECOME_FOLLOWER: 'candidate' }, color: '#81c784' }
            }
        });
        dumpState({
            fsm: fsm.serialize(),
            leader: serverId === 4 ? 4 : -1,
            electing: false,
            electionStartTick: null,
            lastLeaderSeen: 0,
            outbox: [],
        });
    } else {
        const s2 = loadState();
        const fsm = Automat.deserialize(s2.fsm);
        if (fsm.can('NEW_COORD')) fsm.transition('NEW_COORD');
        else if (fsm.can('BECOME_FOLLOWER')) fsm.transition('BECOME_FOLLOWER');
        s2.fsm = fsm.serialize();
        s2.leader = -1;
        s2.electing = false;
        s2.electionStartTick = null;
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

    // Candidate: check election timeout (won by default if no higher responds)
    if (s.electing && s.electionStartTick !== null && tick - s.electionStartTick > ELECTION_TIMEOUT) {
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

    // Candidate: leader timeout
    if (!s.electing && tick - s.lastLeaderSeen > LEADER_TIMEOUT && tick > 5) {
        s.electing = true;
        s.electionStartTick = tick;
        if (fsm.can('START_ELECTION')) fsm.transition('START_ELECTION');
        s.leader = -1;
        const higherCandidates = CANDIDATE_IDS.filter(id => id > serverId);
        if (higherCandidates.length === 0) {
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
            for (const id of higherCandidates) {
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
        // Bully the sender
        s.outbox.push({ to: message.from, payload: { type: 'OK', from: serverId } });

        if (!s.electing) {
            s.electing = true;
            s.electionStartTick = s.tick !== undefined ? s.tick : 0;
            if (fsm.can('START_ELECTION')) fsm.transition('START_ELECTION');
            const higherCandidates = CANDIDATE_IDS.filter(id => id > serverId);
            if (higherCandidates.length === 0) {
                s.leader = serverId;
                if (fsm.can('WON_ELECTION')) fsm.transition('WON_ELECTION');
                s.electing = false;
                for (const id of allServerIds) {
                    if (id !== serverId) {
                        s.outbox.push({ to: id, payload: { type: 'COORDINATOR', leader: serverId } });
                    }
                }
            } else {
                for (const id of higherCandidates) s.outbox.push({ to: id, payload: { type: 'ELECTION', from: serverId } });
            }
        }
    }

    else if (m.type === 'OK') {
        // A higher candidate responded — step back
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
