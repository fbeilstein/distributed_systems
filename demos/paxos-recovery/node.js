// Paxos Proposer Failure & Recovery Demo
//
// Shows how Paxos maintains safety when half-committed states exist.
// 1. Proposer-1 prepares 'X', but crashes immediately after sending ACCEPT to Acceptor-1 only.
// 2. Proposer-2 wakes up later aiming to propose 'Y'.
// 3. Proposer-2's PREPARE discovers that 'X' was already accepted by Acceptor-1.
// 4. Proposer-2 is forced to adopt 'X', ensuring the previously (partially) accepted value is not overwritten.

const QUORUM = 3;

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {

        let fsm;
        if (serverId === 0 || serverId === 1) {
            fsm = new Automat({
                initial: 'idle',
                states: {
                    idle: { on: { START: 'preparing' }, color: '#cfd8dc' },
                    preparing: { on: { GOT_QUORUM: 'accepting', CRASH: 'crashed' }, color: '#ffb74d' },
                    accepting: { on: { DECIDED: 'decided', CRASH: 'crashed' }, color: '#64b5f6' },
                    decided: { on: {}, color: '#4caf50' },
                    crashed: { on: {}, color: '#ef5350' }
                }
            });
            dumpState({
                fsm: fsm.serialize(),
                role: 'proposer',
                ballot: serverId === 0 ? 1 : 2,
                proposedValue: serverId === 0 ? 'X' : 'Y',
                promises: {},
                accepteds: {},
                outbox: []
            });
        } else {
            fsm = new Automat({
                initial: 'ready',
                states: {
                    ready: { on: { PROMISED: 'promised' }, color: '#b0bec5' },
                    promised: { on: { ACCEPTED: 'accepted', PROMISED: 'promised' }, color: '#4fc3f7' },
                    accepted: { on: { PROMISED: 'promised', ACCEPTED: 'accepted' }, color: '#81c784' }
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

    // Proposer-1 starts at tick 5
    if (serverId === 0 && tick === 5 && fsm.state === 'idle') {
        if (fsm.can('START')) fsm.transition('START');
        s.promises[0] = { ballot: 0, value: null }; // self promise
        s.outbox.push({ to: 2, payload: { type: 'PREPARE', ballot: s.ballot } });
        s.outbox.push({ to: 3, payload: { type: 'PREPARE', ballot: s.ballot } });
        s.outbox.push({ to: 4, payload: { type: 'PREPARE', ballot: s.ballot } });
    }

    // Proposer-2 wakes up at tick 45 to propose 'Y'
    if (serverId === 1 && tick === 45 && fsm.state === 'idle') {
        if (fsm.can('START')) fsm.transition('START');
        s.promises[1] = { ballot: 0, value: null }; // self promise
        s.outbox.push({ to: 2, payload: { type: 'PREPARE', ballot: s.ballot } });
        s.outbox.push({ to: 3, payload: { type: 'PREPARE', ballot: s.ballot } });
        s.outbox.push({ to: 4, payload: { type: 'PREPARE', ballot: s.ballot } });
    }

    s.fsm = fsm.serialize();
    processOutbox(s);
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    const m = message.payload;

    if (fsm.state === 'crashed') return; // Ignore everything

    if (s.role === 'proposer') {
        if (m.type === 'PROMISE' && fsm.state === 'preparing' && m.ballot === s.ballot) {
            s.promises[message.from] = { ballot: m.acceptedBallot, value: m.acceptedValue };

            // Check quorum
            let totalPromises = Object.keys(s.promises).length;
            if (totalPromises >= QUORUM) {
                // Determine value to propose
                let valToPropose = s.proposedValue;
                let highest = 0;
                for (let p of Object.values(s.promises)) {
                    if (p.ballot > highest && p.value !== null) {
                        highest = p.ballot;
                        valToPropose = p.value;
                    }
                }

                // If we were forced to change our value, update our state
                if (valToPropose !== s.proposedValue) {
                    s.proposedValue = valToPropose;
                    // This visually demonstrates Proposer-2 dropping 'Y' to adopt 'X'!
                }

                if (fsm.can('GOT_QUORUM')) fsm.transition('GOT_QUORUM');
                s.accepteds[serverId] = true;

                // --- CRASH INJECTION ---
                if (serverId === 0) {
                    // Proposer-1 only sends to Acceptor-1 (node 2) then crashes!
                    s.outbox.push({ to: 2, payload: { type: 'ACCEPT', ballot: s.ballot, value: s.proposedValue } });
                    if (fsm.can('CRASH')) fsm.transition('CRASH');
                } else {
                    // Proposer-2 behaves normally
                    s.outbox.push({ to: 2, payload: { type: 'ACCEPT', ballot: s.ballot, value: s.proposedValue } });
                    s.outbox.push({ to: 3, payload: { type: 'ACCEPT', ballot: s.ballot, value: s.proposedValue } });
                    s.outbox.push({ to: 4, payload: { type: 'ACCEPT', ballot: s.ballot, value: s.proposedValue } });
                }
            }
        }
        else if (m.type === 'ACCEPTED' && fsm.state === 'accepting' && m.ballot === s.ballot) {
            s.accepteds[message.from] = true;
            if (Object.keys(s.accepteds).length >= QUORUM) {
                if (fsm.can('DECIDED')) fsm.transition('DECIDED');
            }
        }
    }
    else if (s.role === 'acceptor') {
        if (m.type === 'PREPARE') {
            if (m.ballot > s.promisedBallot) {
                s.promisedBallot = m.ballot;
                if (fsm.can('PROMISED')) fsm.transition('PROMISED');
                s.outbox.push({
                    to: message.from, payload: {
                        type: 'PROMISE', ballot: m.ballot,
                        acceptedBallot: s.acceptedBallot, acceptedValue: s.acceptedValue
                    }
                });
            }
        }
        else if (m.type === 'ACCEPT') {
            if (m.ballot >= s.promisedBallot) {
                s.promisedBallot = m.ballot;
                s.acceptedBallot = m.ballot;
                s.acceptedValue = m.value;
                if (fsm.can('ACCEPTED')) fsm.transition('ACCEPTED');
                s.outbox.push({ to: message.from, payload: { type: 'ACCEPTED', ballot: m.ballot, value: m.value } });
            }
        }
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}
