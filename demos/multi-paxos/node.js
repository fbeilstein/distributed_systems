// Multi-Paxos — Skipping Prepare Once a Stable Leader Exists
//
// Optimization over classic Paxos:
//   - First round is full Paxos (Prepare → Promise → Accept → Accepted → Decided).
//   - Once a stable leader is known, subsequent rounds SKIP the Prepare phase
//     entirely — the leader just sends ACCEPT directly (Phase 2 only).
//   - This is the key insight behind Raft, ZAB (Zookeeper), and most real systems.
//
// Demo:
//   Tick 5:  Node 0 wins the first full Paxos round (ballot 1) → value "cmd:set_x=1".
//   Tick 40: Node 0 (now stable leader) skips Prepare and sends ACCEPT directly → value "cmd:set_x=2".
//   Tick 75: Node 0 sends another fast ACCEPT → value "cmd:set_x=3".
//   The timeline visibly shows: first round has 2 round-trips, later rounds have only 1.

const QUORUM = 3;

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        let fsm;
        if (serverId === 0) {
            fsm = new Automat({
                initial: 'follower',
                states: {
                    follower: { on: { START_PREPARE: 'preparing' }, color: '#cfd8dc' },
                    preparing: { on: { GOT_QUORUM_PROMISES: 'accepting' }, color: '#ffb74d' },
                    accepting: { on: { GOT_QUORUM_ACCEPTED: 'leader' }, color: '#64b5f6' },
                    leader: { on: { START_ACCEPT: 'accepting' }, color: '#81c784' }
                }
            });
        } else {
            fsm = new Automat({
                initial: 'follower',
                states: {
                    follower: { on: {}, color: '#cfd8dc' }
                }
            });
        }
        dumpState({
            fsm: fsm.serialize(),
            // Acceptor state
            promisedBallot: 0,
            acceptedBallot: 0,
            acceptedValue: null,

            // Proposer / Leader state (node 0 only)
            ballot: 0,
            stableLeader: -1,     // ID of the known stable leader (-1 = unknown)
            promises: {},
            accepteds: {},
            proposedValue: null,
            round: 0,             // Which multi-paxos round we're in
            log: [],              // Committed values

            decided: [],
            outbox: [],
        });
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

    if (serverId !== 0) {
        s.fsm = fsm.serialize();
        processOutbox(s);
        dumpState(s);
        return;
    }  // Only Node 0 proposes in this demo

    // Round 1: Full Paxos at tick 5
    if (tick === 5 && s.round === 0) {
        s.round = 1;
        s.ballot = 1;
        s.proposedValue = 'cmd:set_x=1';
        s.promises = {};
        s.accepteds = {};
        if (fsm.can('START_PREPARE')) fsm.transition('START_PREPARE');
        // Full Phase 1
        for (const id of allServerIds) {
            s.outbox.push({ to: id, payload: { type: 'PREPARE', ballot: s.ballot, round: s.round } });
        }
    }

    // Rounds 2 & 3: Fast Paxos (skip Prepare) at ticks 40 and 75
    if (tick === 40 && fsm.state === 'leader' && s.round === 1) {
        s.round = 2;
        s.proposedValue = 'cmd:set_x=2';
        s.accepteds = {};
        if (fsm.can('START_ACCEPT')) fsm.transition('START_ACCEPT');
        // Skip straight to Phase 2
        for (const id of allServerIds) {
            s.outbox.push({ to: id, payload: { type: 'ACCEPT', ballot: s.ballot, value: s.proposedValue, round: s.round } });
        }
    }

    if (tick === 75 && fsm.state === 'leader' && s.round === 2) {
        s.round = 3;
        s.proposedValue = 'cmd:set_x=3';
        s.accepteds = {};
        if (fsm.can('START_ACCEPT')) fsm.transition('START_ACCEPT');
        for (const id of allServerIds) {
            s.outbox.push({ to: id, payload: { type: 'ACCEPT', ballot: s.ballot, value: s.proposedValue, round: s.round } });
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

    // --- ACCEPTOR ---

    if (m.type === 'PREPARE') {
        if (m.ballot > s.promisedBallot) {
            s.promisedBallot = m.ballot;
            s.stableLeader = message.from;
            s.outbox.push({
                to: message.from, payload: {
                    type: 'PROMISE',
                    ballot: m.ballot,
                    acceptedBallot: s.acceptedBallot,
                    acceptedValue: s.acceptedValue,
                    round: m.round,
                }
            });
        } else {
            s.outbox.push({ to: message.from, payload: { type: 'NACK', ballot: m.ballot, promisedBallot: s.promisedBallot } });
        }
    }

    else if (m.type === 'ACCEPT') {
        if (m.ballot >= s.promisedBallot) {
            s.promisedBallot = m.ballot;
            s.acceptedBallot = m.ballot;
            s.acceptedValue = m.value;
            s.stableLeader = message.from;
            s.outbox.push({ to: message.from, payload: { type: 'ACCEPTED', ballot: m.ballot, value: m.value, round: m.round } });
        } else {
            s.outbox.push({ to: message.from, payload: { type: 'NACK', ballot: m.ballot, promisedBallot: s.promisedBallot } });
        }
    }

    else if (m.type === 'DECIDED') {
        if (!s.decided.includes(m.value)) s.decided.push(m.value);
        s.stableLeader = message.from;
    }

    // --- PROPOSER (Node 0 only) ---

    else if (m.type === 'PROMISE' && serverId === 0 && m.ballot === s.ballot) {
        s.promises[message.from] = { ballot: m.acceptedBallot, value: m.acceptedValue };

        if (Object.keys(s.promises).length >= QUORUM && fsm.state === 'preparing') {
            // Got quorum — check if we need to adopt a previously accepted value
            let valueToUse = s.proposedValue;
            let highestBallot = 0;
            for (const p of Object.values(s.promises)) {
                if (p.ballot > highestBallot && p.value !== null) {
                    highestBallot = p.ballot;
                    valueToUse = p.value;
                }
            }
            if (fsm.can('GOT_QUORUM_PROMISES')) fsm.transition('GOT_QUORUM_PROMISES');
            s.accepteds = {};
            // Phase 2
            for (const id of allServerIds) {
                s.outbox.push({ to: id, payload: { type: 'ACCEPT', ballot: s.ballot, value: valueToUse, round: s.round } });
            }
        }
    }

    else if (m.type === 'ACCEPTED' && serverId === 0 && m.ballot === s.ballot) {
        s.accepteds[message.from] = true;

        if (Object.keys(s.accepteds).length >= QUORUM && fsm.state === 'accepting') {
            if (!s.decided.includes(m.value)) s.decided.push(m.value);
            if (fsm.can('GOT_QUORUM_ACCEPTED')) fsm.transition('GOT_QUORUM_ACCEPTED');
            for (const id of allServerIds) {
                s.outbox.push({ to: id, payload: { type: 'DECIDED', value: m.value, round: m.round } });
            }
        }
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}
