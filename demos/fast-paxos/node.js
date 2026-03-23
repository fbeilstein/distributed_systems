// Fast Paxos Collision & Recovery Demo
//
// Nodes:
// 0 = Coordinator
// 1 = Proposer-1
// 2 = Proposer-2
// 3, 4, 5, 6 = Acceptors
//
// Protocol:
// 1. Coordinator sends ANY(ballot=1) to open a Fast Round.
// 2. Proposer-1 and Proposer-2 send conflicting ACCEPT messages bypassing the coordinator.
// 3. Acceptors accept the first thing they see and report to Coordinator.
// 4. Coordinator realizes no value achieved the fast quorum (3 matching votes).
// 5. Coordinator falls back to a Classic Round (Phase 1 then Phase 2) to resolve.

const COORD = 0;
const P1 = 1;
const P2 = 2;
const ACCEPTORS = [3, 4, 5, 6];

const FAST_QUORUM = 3;    // Out of 4 acceptors
const CLASSIC_QUORUM = 3; // Out of 4 acceptors

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        let fsm;
        if (serverId === COORD) {
            fsm = new Automat({
                initial: 'idle',
                states: {
                    idle: { on: { START_FAST: 'fast_round' }, color: '#cfd8dc' },
                    fast_round: { on: { COLLISION: 'recovering', DECIDED: 'decided' }, color: '#81c784' },
                    recovering: { on: { GOT_PROMISES: 'accepting' }, color: '#ffb74d' },
                    accepting: { on: { GOT_ACCEPTED: 'decided' }, color: '#64b5f6' },
                    decided: { on: {}, color: '#4caf50' }
                }
            });
            dumpState({
                fsm: fsm.serialize(),
                role: 'coord',
                fastVotes: {}, // count of votes per value
                voteFrom: {},  // node -> value
                ballot: 1,
                promises: {},
                accepteds: {},
                decided: null,
                outbox: []
            });
        } else if (serverId === P1 || serverId === P2) {
            fsm = new Automat({
                initial: 'idle',
                states: {
                    idle: { on: { SENT_DIRECT: 'done' }, color: '#cfd8dc' },
                    done: { on: {}, color: '#b0bec5' }
                }
            });
            dumpState({ fsm: fsm.serialize(), role: 'proposer', outbox: [] });
        } else {
            // Acceptors
            fsm = new Automat({
                initial: 'idle',
                states: {
                    idle: { on: { ANY_RECEIVED: 'ready_for_any', PREPARE_RECEIVED: 'classic' }, color: '#cfd8dc' },
                    ready_for_any: { on: { ACCEPTED: 'voted', PREPARE_RECEIVED: 'classic' }, color: '#81c784' },
                    voted: { on: { PREPARE_RECEIVED: 'classic' }, color: '#4fc3f7' },
                    classic: { on: { ACCEPTED: 'classic_voted' }, color: '#ab47bc' },
                    classic_voted: { on: {}, color: '#8e24aa' }
                }
            });
            dumpState({
                fsm: fsm.serialize(),
                role: 'acceptor',
                promisedBallot: 0,
                acceptedBallot: 0,
                acceptedValue: null,
                outbox: []
            });
        }
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

    if (serverId === COORD && tick === 10) {
        if (fsm.can('START_FAST')) fsm.transition('START_FAST');
        for (const a of ACCEPTORS) {
            s.outbox.push({ to: a, payload: { type: 'ANY', ballot: 1 } });
        }
    }

    if (tick === 25) {
        if (serverId === P1) {
            if (fsm.can('SENT_DIRECT')) fsm.transition('SENT_DIRECT');
            // P1 hits 3, 4, 5
            s.outbox.push({ to: 3, payload: { type: 'FAST_ACCEPT', ballot: 1, value: 'A' } });
            s.outbox.push({ to: 4, payload: { type: 'FAST_ACCEPT', ballot: 1, value: 'A' } });
            s.outbox.push({ to: 5, payload: { type: 'FAST_ACCEPT', ballot: 1, value: 'A' } });
        } else if (serverId === P2) {
            if (fsm.can('SENT_DIRECT')) fsm.transition('SENT_DIRECT');
            // P2 hits 5, 6
            s.outbox.push({ to: 5, payload: { type: 'FAST_ACCEPT', ballot: 1, value: 'B' } });
            s.outbox.push({ to: 6, payload: { type: 'FAST_ACCEPT', ballot: 1, value: 'B' } });
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

    // --- COORD ---
    if (serverId === COORD) {
        if (m.type === 'FAST_ACCEPTED' && fsm.state === 'fast_round' && m.ballot === 1) {
            s.voteFrom[message.from] = m.value;
            s.fastVotes[m.value] = (s.fastVotes[m.value] || 0) + 1;

            if (s.fastVotes[m.value] >= FAST_QUORUM) {
                // Technically impossible in this demo because we split 2 and 2
                s.decided = m.value;
                if (fsm.can('DECIDED')) fsm.transition('DECIDED');
            } else if (Object.keys(s.voteFrom).length >= CLASSIC_QUORUM) {
                // We got 3 or 4 responses total, but no single value hit 3 -> COLLISION
                let collision = true;
                for (let v in s.fastVotes) {
                    if (s.fastVotes[v] >= FAST_QUORUM) collision = false;
                }

                if (collision) {
                    if (fsm.can('COLLISION')) fsm.transition('COLLISION');
                    // Start Classic Round
                    s.ballot = 2; // Bump ballot
                    s.promises = {};
                    for (const a of ACCEPTORS) {
                        s.outbox.push({ to: a, payload: { type: 'PREPARE', ballot: s.ballot } });
                    }
                }
            }
        }

        else if (m.type === 'PROMISE' && fsm.state === 'recovering' && m.ballot === s.ballot) {
            s.promises[message.from] = { ballot: m.acceptedBallot, value: m.acceptedValue };
            if (Object.keys(s.promises).length >= CLASSIC_QUORUM) {
                if (fsm.can('GOT_PROMISES')) fsm.transition('GOT_PROMISES');

                // Pick the value from the highest accepted ballot
                let bestVal = 'A'; // default or fallback
                let highest = 0;
                for (let p of Object.values(s.promises)) {
                    if (p.ballot > highest && p.value !== null) {
                        highest = p.ballot;
                        bestVal = p.value;
                    }
                }

                s.accepteds = {};
                for (const a of ACCEPTORS) {
                    s.outbox.push({ to: a, payload: { type: 'ACCEPT', ballot: s.ballot, value: bestVal } });
                }
            }
        }

        else if (m.type === 'ACCEPTED' && fsm.state === 'accepting' && m.ballot === s.ballot) {
            s.accepteds[message.from] = true;
            if (Object.keys(s.accepteds).length >= CLASSIC_QUORUM) {
                s.decided = m.value;
                if (fsm.can('GOT_ACCEPTED')) fsm.transition('GOT_ACCEPTED');
                // Inform everyone
                for (const a of ACCEPTORS) {
                    s.outbox.push({ to: a, payload: { type: 'DECIDED', value: m.value } });
                }
            }
        }
    }

    // --- ACCEPTOR ---
    if (s.role === 'acceptor') {
        if (m.type === 'ANY') {
            if (m.ballot > s.promisedBallot) {
                s.promisedBallot = m.ballot;
                if (fsm.can('ANY_RECEIVED')) fsm.transition('ANY_RECEIVED');
            }
        }
        else if (m.type === 'FAST_ACCEPT') {
            // Only accept if we haven't accepted anything for this ballot yet
            if (m.ballot === s.promisedBallot && s.acceptedBallot < m.ballot) {
                s.acceptedBallot = m.ballot;
                s.acceptedValue = m.value;
                if (fsm.can('ACCEPTED')) fsm.transition('ACCEPTED');
                s.outbox.push({ to: COORD, payload: { type: 'FAST_ACCEPTED', ballot: m.ballot, value: m.value } });
            }
        }
        else if (m.type === 'PREPARE') {
            if (m.ballot > s.promisedBallot) {
                s.promisedBallot = m.ballot;
                if (fsm.can('PREPARE_RECEIVED')) fsm.transition('PREPARE_RECEIVED');
                s.outbox.push({ to: COORD, payload: { type: 'PROMISE', ballot: m.ballot, acceptedBallot: s.acceptedBallot, acceptedValue: s.acceptedValue } });
            }
        }
        else if (m.type === 'ACCEPT') {
            if (m.ballot >= s.promisedBallot) {
                s.promisedBallot = m.ballot;
                s.acceptedBallot = m.ballot;
                s.acceptedValue = m.value;
                if (fsm.can('ACCEPTED')) fsm.transition('ACCEPTED');
                s.outbox.push({ to: COORD, payload: { type: 'ACCEPTED', ballot: m.ballot, value: m.value } });
            }
        }
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}
