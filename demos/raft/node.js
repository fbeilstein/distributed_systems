// Raft Node FSM (Follower, Candidate, Leader)

function getRandomTimeout(min, max) {
    if (typeof getRandom === 'function') return getRandom(min, max);
    return Math.floor(Math.random() * (max - min + 1) + min);
}

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        const fsm = new Automat({
            initial: 'follower',
            states: {
                follower: { on: { TIMEOUT: 'candidate' }, color: '#b2dfdb' },
                candidate: { on: { WIN_ELECTION: 'leader', STEP_DOWN: 'follower', TIMEOUT: 'candidate' }, color: '#ffb74d' },
                leader: { on: { STEP_DOWN: 'follower' }, color: '#90caf9' }
            }
        });

        dumpState({
            fsm: fsm.serialize(),

            // Persistent state on all servers
            currentTerm: 0,
            votedFor: null,
            log: [], // [{ term, data }]

            // Volatile state on all servers
            commitIndex: 0,
            lastApplied: 0,
            outbox: [], // Used for throttling messages to 1 per tick

            // Role-specific volatile state
            electionTick: 0,
            electionTimeout: serverId === 0 ? 5 : getRandomTimeout(30, 50), // Node 0 starts first!
            votesReceived: 0,

            // Leader volatile state
            nextIndex: {},
            matchIndex: {}
        });
    }
}

function becomeFollower(s, fsm, newTerm) {
    if (newTerm !== undefined) s.currentTerm = newTerm;
    s.votedFor = null;

    // Only reset election timeout if we were a leader tracking hearbeats, 
    // or if we explicitly stepped down from candidate.
    // If we're already a follower, keep our existing countdown going!
    if (fsm.state !== 'follower') {
        s.electionTick = s.tick;
        s.electionTimeout = getRandomTimeout(30, 50);
        if (fsm.can('STEP_DOWN')) fsm.transition('STEP_DOWN');
        fsm.state = 'follower';
    }
}

function onTimer(tick) {
    let s = loadState();
    s.tick = tick;
    const fsm = Automat.deserialize(s.fsm);

    // Apply committed entries to "state machine" (just a console log equivalent in UI history)
    while (s.commitIndex > s.lastApplied) {
        s.lastApplied++;
    }

    // Process outbox to avoid request bursts (1 per tick)
    if (!s.outbox) s.outbox = [];
    if (s.outbox.length > 0) {
        const msg = s.outbox.shift();
        sendMessage(msg.to, msg.payload);
    }

    if (fsm.state === 'follower' || fsm.state === 'candidate') {
        if (tick - s.electionTick >= s.electionTimeout) {
            // Election Timeout -> Become Candidate / Start new Election
            // IMPORTANT: If already a candidate, this correctly starts a *new* election term
            if (fsm.can('TIMEOUT')) {
                fsm.transition('TIMEOUT');
            }

            // clear old outbox so we don't spam outdated votes
            s.outbox = [];

            s.currentTerm++;
            s.votedFor = serverId;
            s.votesReceived = 1; // Vote for self
            s.electionTick = tick;
            s.electionTimeout = getRandomTimeout(30, 50); // Reset timer for split votes

            const lastLogIndex = s.log.length;
            const lastLogTerm = lastLogIndex > 0 ? s.log[lastLogIndex - 1].term : 0;

            const clusterIds = allServerIds.filter(id => id !== serverId && id !== 5); // 5 is Client
            for (const peer of clusterIds) {
                s.outbox.push({
                    to: peer, payload: {
                        type: 'RequestVote',
                        term: s.currentTerm,
                        candidateId: serverId,
                        lastLogIndex: lastLogIndex,
                        lastLogTerm: lastLogTerm
                    }
                });
            }
        }
    } else if (fsm.state === 'leader') {
        // Send Heartbeats / AppendEntries
        // Doing this every 15 ticks to reliably suppress follower timeouts (30-50) and allow outbox queueing
        if (tick % 15 === 0) {
            const clusterIds = allServerIds.filter(id => id !== serverId && id !== 5);
            for (const peer of clusterIds) {
                const nIdx = s.nextIndex[peer] || 1;
                const prevLogIndex = nIdx - 1;
                const prevLogTerm = prevLogIndex > 0 ? s.log[prevLogIndex - 1].term : 0;

                // Send heartbeat empty array if caught up, or actual log subset if pending
                const entries = s.log.slice(prevLogIndex);

                s.outbox.push({
                    to: peer, payload: {
                        type: 'AppendEntries',
                        term: s.currentTerm,
                        leaderId: serverId,
                        prevLogIndex: prevLogIndex,
                        prevLogTerm: prevLogTerm,
                        entries: entries,
                        leaderCommit: s.commitIndex
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

    // Rule for all servers: If RPC request or response contains term T > currentTerm
    if (m.term && m.term > s.currentTerm) {
        becomeFollower(s, fsm, m.term);
    }

    if (m.type === 'RequestVote') {
        let voteGranted = false;

        // 1. Reply false if term < currentTerm
        // 2. If votedFor is null or candidateId, and candidate's log is at least as up-to-date
        if (m.term >= s.currentTerm) {
            const lastLogIndex = s.log.length;
            const lastLogTerm = lastLogIndex > 0 ? s.log[lastLogIndex - 1].term : 0;

            const logOk = (m.lastLogTerm > lastLogTerm) || (m.lastLogTerm === lastLogTerm && m.lastLogIndex >= lastLogIndex);

            if ((s.votedFor === null || s.votedFor === m.candidateId) && logOk) {
                voteGranted = true;
                s.votedFor = m.candidateId;
                s.electionTick = s.tick; // Reset election timer upon granting vote
            }
        }

        if (!s.outbox) s.outbox = [];
        s.outbox.push({
            to: message.from, payload: {
                type: 'RequestVoteReply',
                term: s.currentTerm,
                voteGranted: voteGranted
            }
        });
    }

    else if (m.type === 'RequestVoteReply' && fsm.state === 'candidate') {
        if (m.term === s.currentTerm && m.voteGranted) {
            s.votesReceived++;
            const clusterSize = 5; // Servers 0-4
            if (s.votesReceived > Math.floor(clusterSize / 2)) {
                // WON ELECTION
                if (fsm.can('WIN_ELECTION')) fsm.transition('WIN_ELECTION');

                const clusterIds = allServerIds.filter(id => id !== serverId && id !== 5);
                s.nextIndex = {};
                s.matchIndex = {};
                for (const peer of clusterIds) {
                    s.nextIndex[peer] = s.log.length + 1;
                    s.matchIndex[peer] = 0;
                }

                // Immediately queue initial empty AppendEntries (heartbeat) to assert authority
                for (const peer of clusterIds) {
                    const prevLogIndex = s.nextIndex[peer] - 1;
                    const prevLogTerm = prevLogIndex > 0 ? s.log[prevLogIndex - 1].term : 0;
                    s.outbox.push({
                        to: peer, payload: {
                            type: 'AppendEntries',
                            term: s.currentTerm,
                            leaderId: serverId,
                            prevLogIndex: prevLogIndex,
                            prevLogTerm: prevLogTerm,
                            entries: [],
                            leaderCommit: s.commitIndex
                        }
                    });
                }
            }
        }
    }

    else if (m.type === 'AppendEntries') {
        let success = false;

        // 1. Reply false if term < currentTerm
        if (m.term >= s.currentTerm) {
            // If we are a candidate and we discover a valid leader for our term or higher, step down
            if (fsm.state !== 'follower') {
                becomeFollower(s, fsm, m.term);
            }

            s.electionTick = s.tick; // Valid Leader found, reset election timeout

            // 2. Reply false if log doesn't contain an entry at prevLogIndex whose term matches prevLogTerm
            const prevLogValid = (m.prevLogIndex === 0) || (s.log.length >= m.prevLogIndex && s.log[m.prevLogIndex - 1].term === m.prevLogTerm);

            if (prevLogValid) {
                success = true;

                // 3. If an existing entry conflicts with a new one (same index but different terms), delete the existing entry and all that follow it
                // 4. Append any new entries not already in the log
                let logRewriteIndex = m.prevLogIndex;
                for (const entry of m.entries) {
                    if (logRewriteIndex < s.log.length) {
                        if (s.log[logRewriteIndex].term !== entry.term) {
                            s.log.splice(logRewriteIndex); // truncate
                            s.log.push(entry);
                        }
                    } else {
                        s.log.push(entry);
                    }
                    logRewriteIndex++;
                }

                // 5. If leaderCommit > commitIndex, set commitIndex = min(leaderCommit, index of last new entry)
                if (m.leaderCommit > s.commitIndex) {
                    s.commitIndex = Math.min(m.leaderCommit, s.log.length);
                }
            }
        }

        if (!s.outbox) s.outbox = [];
        s.outbox.push({
            to: message.from, payload: {
                type: 'AppendEntriesReply',
                term: s.currentTerm,
                success: success,
                matchIndex: success ? m.prevLogIndex + m.entries.length : 0 // If failed, we don't care about true matchIndex here, actual Raft decrements nextIndex
            }
        });
    }

    else if (m.type === 'AppendEntriesReply' && fsm.state === 'leader') {
        if (m.term === s.currentTerm) {
            if (m.success) {
                // Update matchIndex and nextIndex for follower
                s.matchIndex[message.from] = Math.max(s.matchIndex[message.from] || 0, m.matchIndex);
                s.nextIndex[message.from] = s.matchIndex[message.from] + 1;

                // If there exists an N such that N > commitIndex, a majority of matchIndex[i] >= N, and log[N].term == currentTerm => commitIndex = N
                for (let n = s.log.length; n > s.commitIndex; n--) {
                    if (s.log[n - 1].term === s.currentTerm) {
                        let matchCount = 1; // Self
                        const clusterIds = allServerIds.filter(id => id !== serverId && id !== 5);
                        for (const peer of clusterIds) {
                            if ((s.matchIndex[peer] || 0) >= n) matchCount++;
                        }

                        if (matchCount > Math.floor(5 / 2)) {
                            s.commitIndex = n;

                            // Check if this was a client request we need to respond to!
                            // Look for any pending requests matching this data
                            if (s.pendingClientReq && s.pendingClientReq.logIndex === n) {
                                if (!s.outbox) s.outbox = [];
                                s.outbox.push({ to: 5, payload: { type: 'CLIENT_RESPONSE', txId: s.pendingClientReq.txId, success: true } });
                                s.pendingClientReq = null;
                            }
                            break;
                        }
                    }
                }
            } else {
                // Decrement nextIndex and retry (done on next heartbeat in our simple loop)
                s.nextIndex[message.from] = Math.max(1, (s.nextIndex[message.from] || 2) - 1);
            }
        }
    }

    // Client Interactions
    else if (m.type === 'CLIENT_REQUEST') {
        if (fsm.state === 'leader') {
            const entry = { term: s.currentTerm, data: m.data };
            s.log.push(entry);
            s.pendingClientReq = { txId: m.txId, logIndex: s.log.length };
        } else {
            // Not the leader, redirect if we know one, otherwise just fail
            // In a real system we might track recent leader appending, but here we can just reject
            if (!s.outbox) s.outbox = [];
            s.outbox.push({ to: message.from, payload: { type: 'REDIRECT' } });
        }
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}
