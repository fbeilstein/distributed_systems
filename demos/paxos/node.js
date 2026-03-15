// Paxos — Classic Consensus with Dueling Proposers Demo
//
// Roles: All nodes act as both Proposers AND Acceptors/Learners.
// Protocol:
//   Phase 1 — Prepare:  Proposer picks ballot n, broadcasts PREPARE(n).
//   Phase 1 — Promise:  Acceptors reply PROMISE(n, accepted_n, accepted_v) if n > max_seen.
//   Phase 2 — Accept:   Proposer collects quorum of Promises, sends ACCEPT(n, v).
//   Phase 2 — Accepted: Acceptors reply ACCEPTED(n, v) if n >= promised.
//   Decide: Once quorum of ACCEPTED received, proposer broadcasts DECIDED(v).
//
// Demo Focus — DUELING PROPOSERS:
//   Tick 10: Node 0 proposes ballot 1 with value "A".
//   Tick 10: Node 1 also proposes ballot 2 with value "B" simultaneously.
//   They keep outbidding each other but eventually Node 1's higher ballot wins.
//   After Paxos settles, DECIDED is broadcast.

const QUORUM = 3; // majority of 5 nodes

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        dumpState({
            // Acceptor state
            promisedBallot: 0,
            acceptedBallot: 0,
            acceptedValue: null,

            // Proposer state
            ballot: 0,
            proposing: false,
            promises: {},          // { from: { ballot, value } }
            accepteds: {},         // { from: true }
            proposedValue: null,

            // Learner state
            decided: null,
        });
    }
}

function startProposal(s, ballot, value) {
    s.ballot = ballot;
    s.proposedValue = value;
    s.proposing = true;
    s.promises = {};
    s.accepteds = {};
}

function onTimer(tick) {
    let s = loadState();
    s.tick = tick;

    // Node 0: propose value "A" with ballot 1 at tick 10
    if (serverId === 0 && tick === 10 && !s.proposing && s.decided === null) {
        startProposal(s, 1, 'A');
        for (const id of allServerIds) {
            sendMessage(id, { type: 'PREPARE', ballot: s.ballot, from: serverId });
        }
    }

    // Node 1: propose value "B" with ballot 2 at tick 10 (simultaneous!)
    if (serverId === 1 && tick === 10 && !s.proposing && s.decided === null) {
        startProposal(s, 2, 'B');
        for (const id of allServerIds) {
            sendMessage(id, { type: 'PREPARE', ballot: s.ballot, from: serverId });
        }
    }

    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const m = message.payload;

    // --- ACCEPTOR logic ---

    if (m.type === 'PREPARE') {
        if (m.ballot > s.promisedBallot) {
            s.promisedBallot = m.ballot;
            sendMessage(message.from, {
                type: 'PROMISE',
                ballot: m.ballot,
                acceptedBallot: s.acceptedBallot,
                acceptedValue: s.acceptedValue,
            });
        } else {
            // Reject — already promised a higher ballot
            sendMessage(message.from, {
                type: 'NACK',
                ballot: m.ballot,
                promisedBallot: s.promisedBallot,
            });
        }
    }

    else if (m.type === 'ACCEPT') {
        if (m.ballot >= s.promisedBallot) {
            s.promisedBallot = m.ballot;
            s.acceptedBallot = m.ballot;
            s.acceptedValue = m.value;
            sendMessage(message.from, { type: 'ACCEPTED', ballot: m.ballot, value: m.value });
        } else {
            sendMessage(message.from, { type: 'NACK', ballot: m.ballot, promisedBallot: s.promisedBallot });
        }
    }

    else if (m.type === 'DECIDED') {
        s.decided = m.value;
        s.proposing = false;
    }

    // --- PROPOSER logic ---

    else if (m.type === 'PROMISE' && s.proposing && m.ballot === s.ballot) {
        s.promises[message.from] = { ballot: m.acceptedBallot, value: m.acceptedValue };

        if (Object.keys(s.promises).length >= QUORUM) {
            // Got quorum of promises — pick value (highest accepted ballot wins, or use own)
            let highestBallot = 0;
            let valueToPropose = s.proposedValue;
            for (const p of Object.values(s.promises)) {
                if (p.ballot > highestBallot && p.value !== null) {
                    highestBallot = p.ballot;
                    valueToPropose = p.value;
                }
            }

            // Move to Phase 2
            for (const id of allServerIds) {
                sendMessage(id, { type: 'ACCEPT', ballot: s.ballot, value: valueToPropose });
            }
        }
    }

    else if (m.type === 'NACK' && s.proposing) {
        // We were outbid — bump our ballot and retry (with a stagger to avoid livelock)
        if (m.promisedBallot >= s.ballot) {
            // Use tick-parity stagger: Node 0 adds 2, Node 1 adds 4, etc.
            const newBallot = m.promisedBallot + 1 + (serverId * 2);
            startProposal(s, newBallot, s.proposedValue);
            for (const id of allServerIds) {
                sendMessage(id, { type: 'PREPARE', ballot: s.ballot, from: serverId });
            }
        }
    }

    else if (m.type === 'ACCEPTED' && s.proposing && m.ballot === s.ballot) {
        s.accepteds[message.from] = true;

        if (Object.keys(s.accepteds).length >= QUORUM) {
            // Consensus reached!
            s.decided = m.value;
            s.proposing = false;
            for (const id of allServerIds) {
                sendMessage(id, { type: 'DECIDED', value: m.value });
            }
        }
    }

    dumpState(s);
}
