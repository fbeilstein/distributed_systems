// Paxos — Dueling Proposers with Random Backoff 
//
// This demo highlights the livelock vulnerability of classic Paxos
// when two proposers continuously outbid each other's PREPARE phases.
// To resolve this, proposers enter a randomized backoff state before retrying.

const QUORUM = 3;

// Helper for random backoff
function getRandomTimeout(min, max) {
    if (typeof getRandom === 'function') return getRandom(min, max);
    return Math.floor(Math.random() * (max - min + 1) + min);
}

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        const fsm = new Automat({
            initial: 'idle',
            states: {
                idle: { on: { START_PROPOSAL: 'preparing', LEARNED_DECISION: 'decided' }, color: '#cfd8dc' },
                preparing: { on: { GOT_QUORUM_PROMISES: 'accepting', NACK_RECEIVED: 'backoff', LEARNED_DECISION: 'decided' }, color: '#ffb74d' },
                accepting: { on: { GOT_QUORUM_ACCEPTED: 'decided', NACK_RECEIVED: 'backoff', LEARNED_DECISION: 'decided' }, color: '#64b5f6' },
                backoff: { on: { BACKOFF_COMPLETE: 'preparing', LEARNED_DECISION: 'decided' }, color: '#e57373' },
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
            ballotRound: 0,        // We generate ballot as: (round * 10) + serverId
            promises: {},          // { from: { ballot, value } }
            accepteds: {},         // { from: true }
            proposedValue: null,
            backoffUntil: 0,

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

function startProposal(s, fsm, value) {
    s.ballotRound++;
    const ballot = (s.ballotRound * 10) + serverId; // Unique ballot generation

    s.proposedValue = value;
    if (fsm.can('START_PROPOSAL')) fsm.transition('START_PROPOSAL');
    else if (fsm.can('BACKOFF_COMPLETE')) fsm.transition('BACKOFF_COMPLETE');

    // Implicit self-promise
    if (ballot > s.promisedBallot) {
        s.promisedBallot = ballot;
    }
    s.promises = {};
    s.promises[serverId] = { ballot: s.acceptedBallot, value: s.acceptedValue };
    s.accepteds = {};

    for (const id of allServerIds) {
        if (id !== serverId) s.outbox.push({ to: id, payload: { type: 'PREPARE', ballot: ballot, from: serverId } });
    }
}

function onTimer(tick) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    s.tick = tick;

    // Node 0 and Node 1 propose simultaneously at tick 10 to intentionally cause collision
    if (tick === 10 && fsm.state === 'idle' && s.decided === null) {
        if (serverId === 0) {
            startProposal(s, fsm, 'A');
        } else if (serverId === 1) {
            startProposal(s, fsm, 'B');
        }
    }

    // Process backoff expiration
    if (fsm.state === 'backoff' && tick >= s.backoffUntil && s.decided === null) {
        startProposal(s, fsm, s.proposedValue);
    }

    s.fsm = fsm.serialize();
    processOutbox(s);
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    const m = message.payload;

    if (m.type === 'DECIDED') {
        s.decided = m.value;
        if (fsm.can('LEARNED_DECISION')) fsm.transition('LEARNED_DECISION');
        s.fsm = fsm.serialize();
        dumpState(s);
        return;
    }

    // --- ACCEPTOR logic ---

    if (m.type === 'PREPARE') {
        if (s.decided !== null) {
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
            // NACK: already promised a higher ballot
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


    // --- PROPOSER logic ---

    else if (m.type === 'PROMISE' && fsm.state === 'preparing') {
        const myBallot = (s.ballotRound * 10) + serverId;
        if (m.ballot === myBallot) {
            s.promises[message.from] = { ballot: m.acceptedBallot, value: m.acceptedValue };

            if (Object.keys(s.promises).length >= QUORUM) {
                // Quorum of promises -> adopt highest accepted value or use own
                let highestBallot = 0;
                let valueToPropose = s.proposedValue;
                for (const p of Object.values(s.promises)) {
                    if (p.ballot > highestBallot && p.value !== null) {
                        highestBallot = p.ballot;
                        valueToPropose = p.value;
                    }
                }

                if (fsm.can('GOT_QUORUM_PROMISES')) fsm.transition('GOT_QUORUM_PROMISES');

                // Self-accept
                if (myBallot >= s.promisedBallot) {
                    s.promisedBallot = myBallot;
                    s.acceptedBallot = myBallot;
                    s.acceptedValue = valueToPropose;
                    s.accepteds[serverId] = true;
                }

                // Broadcast Accept
                for (const id of allServerIds) {
                    if (id !== serverId) s.outbox.push({ to: id, payload: { type: 'ACCEPT', ballot: myBallot, value: valueToPropose } });
                }
            }
        }
    }

    else if (m.type === 'NACK' && (fsm.state === 'preparing' || fsm.state === 'accepting')) {
        const myBallot = (s.ballotRound * 10) + serverId;
        if (m.ballot === myBallot) {
            // Only backoff once per ballot attempt
            if (fsm.can('NACK_RECEIVED')) {
                fsm.transition('NACK_RECEIVED');
                // Random backoff between 15 and 45 ticks
                s.backoffUntil = s.tick + getRandomTimeout(15, 45);

                // Fast-forward our ballot round to be competitive when we wake up
                while ((s.ballotRound * 10) + serverId <= m.promisedBallot) {
                    s.ballotRound++;
                }
            }
        }
    }

    else if (m.type === 'ACCEPTED' && fsm.state === 'accepting') {
        const myBallot = (s.ballotRound * 10) + serverId;
        if (m.ballot === myBallot) {
            s.accepteds[message.from] = true;

            if (Object.keys(s.accepteds).length >= QUORUM) {
                s.decided = m.value;
                if (fsm.can('GOT_QUORUM_ACCEPTED')) fsm.transition('GOT_QUORUM_ACCEPTED');
                // Broadcast Decision
                for (const id of allServerIds) {
                    if (id !== serverId) s.outbox.push({ to: id, payload: { type: 'DECIDED', value: m.value } });
                }
            }
        }
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}
