// Raft Log Divergence Resolution Demo
//
// This demo hardcodes a severely diverged state caused by a simulated network partition.
// Nodes 0, 1, 2 advanced to Term 2 and committed B and C.
// Nodes 3, 4 were partitioned in Term 1 and accepted X/Y/W/Z locally.
//
// When the partition heals (demo start), Node 0 sends AppendEntries to Nodes 3 & 4.
// They reject the entries because the prevLogTerm doesn't match!
// Node 0 systematically decrements nextIndex until it finds the common 
// ancestor (A at index 1), and overwrites their corrupted logs.

function getRandomTimeout(min, max) { return Math.floor(Math.random() * (max - min + 1) + min); }

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {

        const fsmStates = {
            follower: { on: { TIMEOUT: 'candidate' }, color: '#b2dfdb' },
            candidate: { on: { WIN_ELECTION: 'leader', STEP_DOWN: 'follower', TIMEOUT: 'candidate' }, color: '#ffb74d' },
            leader: { on: { STEP_DOWN: 'follower' }, color: '#90caf9' },
            diverged: { on: { SYNCED: 'follower' }, color: '#e57373' }
        };

        let fsm;
        let baseState = {
            outbox: [],
            electionTick: 0,
            electionTimeout: 9999, // Disable timeouts to focus purely on log resolution
            votesReceived: 0,
            nextIndex: {},
            matchIndex: {}
        };

        if (serverId === 0) {
            fsm = new Automat({ initial: 'leader', states: fsmStates });
            Object.assign(baseState, {
                currentTerm: 2, votedFor: 0,
                log: [{ term: 1, data: 'A' }, { term: 2, data: 'B' }, { term: 2, data: 'C' }],
                commitIndex: 3, lastApplied: 3,
                nextIndex: { 1: 4, 2: 4, 3: 4, 4: 4 },
                matchIndex: { 1: 3, 2: 3, 3: 0, 4: 0 }
            });
        } else if (serverId === 1 || serverId === 2) {
            fsm = new Automat({ initial: 'follower', states: fsmStates });
            Object.assign(baseState, {
                currentTerm: 2, votedFor: 0,
                log: [{ term: 1, data: 'A' }, { term: 2, data: 'B' }, { term: 2, data: 'C' }],
                commitIndex: 3, lastApplied: 3
            });
        } else {
            fsm = new Automat({ initial: 'diverged', states: fsmStates });
            Object.assign(baseState, {
                currentTerm: 1, votedFor: null,
                log: [{ term: 1, data: 'A' }, { term: 1, data: (serverId === 3 ? 'X' : 'W') }, { term: 1, data: (serverId === 3 ? 'Y' : 'Z') }],
                commitIndex: 1, lastApplied: 1
            });
        }

        baseState.fsm = fsm.serialize();
        dumpState(baseState);
    }
}

function becomeFollower(s, fsm, newTerm) {
    if (newTerm !== undefined) s.currentTerm = newTerm;
    s.votedFor = null;
    s.electionTick = s.tick;
    // We stay in 'diverged' visually until logs match, though logically we act as a follower
}

function onTimer(tick) {
    let s = loadState();
    s.tick = tick;
    const fsm = Automat.deserialize(s.fsm);

    while (s.commitIndex > s.lastApplied) s.lastApplied++;

    if (!s.outbox) s.outbox = [];
    if (s.outbox.length > 0) {
        const msg = s.outbox.shift();
        sendMessage(msg.to, msg.payload);
    }

    if (fsm.state === 'leader') {
        if (tick % 15 === 0) {
            const clusterIds = allServerIds.filter(id => id !== serverId && id !== 5);
            for (const peer of clusterIds) {
                const nIdx = s.nextIndex[peer] || 1;
                const prevLogIndex = nIdx - 1;
                const prevLogTerm = prevLogIndex > 0 ? s.log[prevLogIndex - 1].term : 0;
                const entries = s.log.slice(prevLogIndex);

                s.outbox.push({
                    to: peer, payload: {
                        type: 'AppendEntries', term: s.currentTerm, leaderId: serverId,
                        prevLogIndex: prevLogIndex, prevLogTerm: prevLogTerm,
                        entries: entries, leaderCommit: s.commitIndex
                    }
                });
            }
        }
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    const m = message.payload;

    if (m.term && m.term > s.currentTerm) {
        becomeFollower(s, fsm, m.term);
    }

    if (m.type === 'AppendEntries') {
        let success = false;
        if (m.term >= s.currentTerm) {
            s.electionTick = s.tick;

            const prevLogValid = (m.prevLogIndex === 0) || (s.log.length >= m.prevLogIndex && s.log[m.prevLogIndex - 1].term === m.prevLogTerm);

            if (prevLogValid) {
                success = true;

                // Visually transition out of diverged state once we align!
                if (fsm.state === 'diverged' && fsm.can('SYNCED')) {
                    fsm.transition('SYNCED');
                }

                let logRewriteIndex = m.prevLogIndex;
                for (const entry of m.entries) {
                    if (logRewriteIndex < s.log.length) {
                        if (s.log[logRewriteIndex].term !== entry.term) {
                            s.log.splice(logRewriteIndex); // truncate divergent history
                            s.log.push(entry);
                        }
                    } else {
                        s.log.push(entry);
                    }
                    logRewriteIndex++;
                }

                if (m.leaderCommit > s.commitIndex) {
                    s.commitIndex = Math.min(m.leaderCommit, s.log.length);
                }
            }
        }

        if (!s.outbox) s.outbox = [];
        s.outbox.push({
            to: message.from, payload: {
                type: 'AppendEntriesReply', term: s.currentTerm, success: success,
                matchIndex: success ? m.prevLogIndex + m.entries.length : 0
            }
        });
    }

    else if (m.type === 'AppendEntriesReply' && fsm.state === 'leader') {
        if (m.term === s.currentTerm) {
            if (m.success) {
                s.matchIndex[message.from] = Math.max(s.matchIndex[message.from] || 0, m.matchIndex);
                s.nextIndex[message.from] = s.matchIndex[message.from] + 1;

                // standard commit index advance rule omitted for brevity since we're not taking new client requests in this demo.
            } else {
                // CORE DIVERGENCE LOGIC: decrement nextIndex and retry!
                s.nextIndex[message.from] = Math.max(1, (s.nextIndex[message.from] || 2) - 1);
            }
        }
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}
