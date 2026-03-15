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
        const fsm = new Automat({
            initial: 'idle',
            states: {
                idle: { on: { START_PROPOSAL: 'preparing', LEARNED_DECISION: 'decided' }, color: '#cfd8dc' },
                preparing: { on: { GOT_QUORUM_PROMISES: 'accepting', RETRY: 'preparing', LEARNED_DECISION: 'decided' }, color: '#ffb74d' },
                accepting: { on: { GOT_QUORUM_ACCEPTED: 'decided', RETRY: 'preparing', LEARNED_DECISION: 'decided' }, color: '#64b5f6' },
                decided: { on: {}, color: '#81c784' }
            }
        });
        dumpState({
            fsm: fsm.serialize(),
            // Acceptor state
            promisedBallot: 0,
            acceptedBallot: 0,
            acceptedValue: null,

            // Proposer state
            ballot: 0,
            promises: {},          // { from: { ballot, value } }
            accepteds: {},         // { from: true }
            proposedValue: null,

            // Learner state
            decided: null,
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

function startProposal(s, fsm, ballot, value) {
    s.ballot = ballot;
    s.proposedValue = value;
    if (fsm.can('START_PROPOSAL')) fsm.transition('START_PROPOSAL');
    else if (fsm.can('RETRY')) fsm.transition('RETRY');

    // Implicit self-promise
    if (ballot > s.promisedBallot) {
        s.promisedBallot = ballot;
    }
    s.promises = {};
    s.promises[serverId] = { ballot: s.acceptedBallot, value: s.acceptedValue };
    s.accepteds = {};
}

function onTimer(tick) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    s.tick = tick;

    // Node 0: propose value "A" with ballot 1 at tick 10
    if (serverId === 0 && tick === 10 && fsm.state === 'idle' && s.decided === null) {
        startProposal(s, fsm, 1, 'A');
        for (const id of allServerIds) {
            if (id !== serverId) s.outbox.push({ to: id, payload: { type: 'PREPARE', ballot: s.ballot, from: serverId } });
        }
    }

    // Node 1: propose value "B" with ballot 2 at tick 10 (simultaneous!)
    if (serverId === 1 && tick === 10 && fsm.state === 'idle' && s.decided === null) {
        startProposal(s, fsm, 2, 'B');
        for (const id of allServerIds) {
            if (id !== serverId) s.outbox.push({ to: id, payload: { type: 'PREPARE', ballot: s.ballot, from: serverId } });
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

    // --- ACCEPTOR logic ---

    if (m.type === 'PREPARE') {
        if (s.decided !== null) {
            // Optimization: if already decided, just tell them the decision so they don't do useless work
            s.outbox.push({ to: message.from, payload: { type: 'DECIDED', value: s.decided } });
        } else if (m.ballot > s.promisedBallot) {
            s.promisedBallot = m.ballot;
            s.outbox.push({
                to: message.from, payload: {
                    type: 'PROMISE',
                    ballot: m.ballot,
                    acceptedBallot: s.acceptedBallot,
                    acceptedValue: s.acceptedValue,
                }
            });
        } else {
            // Reject — already promised a higher ballot
            s.outbox.push({
                to: message.from, payload: {
                    type: 'NACK',
                    ballot: m.ballot,
                    promisedBallot: s.promisedBallot,
                }
            });
        }
    }

    else if (m.type === 'ACCEPT') {
        if (s.decided !== null) {
            s.outbox.push({ to: message.from, payload: { type: 'DECIDED', value: s.decided } });
        } else if (m.ballot >= s.promisedBallot) {
            s.promisedBallot = m.ballot;
            s.acceptedBallot = m.ballot;
            s.acceptedValue = m.value;
            s.outbox.push({ to: message.from, payload: { type: 'ACCEPTED', ballot: m.ballot, value: m.value } });
        } else {
            s.outbox.push({ to: message.from, payload: { type: 'NACK', ballot: m.ballot, promisedBallot: s.promisedBallot } });
        }
    }

    else if (m.type === 'DECIDED') {
        s.decided = m.value;
        if (fsm.can('LEARNED_DECISION')) fsm.transition('LEARNED_DECISION');
    }

    // --- PROPOSER logic ---

    else if (m.type === 'PROMISE' && fsm.state === 'preparing' && m.ballot === s.ballot) {
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

            if (fsm.can('GOT_QUORUM_PROMISES')) fsm.transition('GOT_QUORUM_PROMISES');

            // Implicit self-accept for Phase 2
            if (s.ballot >= s.promisedBallot) {
                s.promisedBallot = s.ballot;
                s.acceptedBallot = s.ballot;
                s.acceptedValue = valueToPropose;
                s.accepteds[serverId] = true;
            }

            // Move to Phase 2
            for (const id of allServerIds) {
                if (id !== serverId) s.outbox.push({ to: id, payload: { type: 'ACCEPT', ballot: s.ballot, value: valueToPropose } });
            }
        }
    }

    else if (m.type === 'NACK' && (fsm.state === 'preparing' || fsm.state === 'accepting')) {
        // We were outbid — bump our ballot and retry (with a stagger to avoid livelock)
        if (m.promisedBallot >= s.ballot) {
            // Use tick-parity stagger: Node 0 adds 2, Node 1 adds 4, etc.
            const newBallot = m.promisedBallot + 1 + (serverId * 2);
            startProposal(s, fsm, newBallot, s.proposedValue);
            for (const id of allServerIds) {
                if (id !== serverId) s.outbox.push({ to: id, payload: { type: 'PREPARE', ballot: s.ballot, from: serverId } });
            }
        }
    }

    else if (m.type === 'ACCEPTED' && fsm.state === 'accepting' && m.ballot === s.ballot) {
        s.accepteds[message.from] = true;

        if (Object.keys(s.accepteds).length >= QUORUM) {
            // Consensus reached!
            s.decided = m.value;
            if (fsm.can('GOT_QUORUM_ACCEPTED')) fsm.transition('GOT_QUORUM_ACCEPTED');
            for (const id of allServerIds) {
                if (id !== serverId) s.outbox.push({ to: id, payload: { type: 'DECIDED', value: m.value } });
            }
        }
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}
