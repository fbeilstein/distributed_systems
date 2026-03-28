// Raft Node - Config-Driven "Speaking" Pattern
const allIds = Array.from({ length: config.nodes }, (_, i) => i);
const peers = allIds.filter(id => id !== serverId && id !== config.clientId);
const majority = Math.ceil((config.nodes - 1) / 2); // E.g., 3 out of 5 servers

const raft = {
    term: 0,
    votedFor: null,
    log: [],
    leaderId: null,
    votesReceived: 0,

    updateTerm(newTerm) {
        this.term = newTerm;
        this.votedFor = null;
        dumpState(this); // Persist term changes
    },

    syncUI() {
        // Expose all protocol data to the StateInspector
        dumpState({
            fsm: automat.serialize(),
            term: this.term,
            votedFor: this.votedFor,
            votesReceived: this.votesReceived,
            leaderId: this.leaderId,
            log: this.log
        });
    }
};

class Follower extends State {
    getState() { return ['follower', '#b2dfdb']; }
    canTransition() { return ['candidate']; }
    onEnter() { this.resetTimeout(); raft.syncUI(); }

    /** (Section 5.2) Reset election timeout on AppendEntries or granting vote */
    resetTimeout() { this.addTimeout(getRandom(17, 31), 'becomeCandidate'); }
    becomeCandidate() { this.transition('candidate'); }

    registerMessageTypes() {
        return {
            'AppendEntries': this.onAppendEntries,
            'RequestVote': 'onRequestVote',
            'CLIENT_REQUEST': 'onClientRequest'
        };
    }

    onAppendEntries(msg) {
        this.resetTimeout();
        raft.leaderId = msg.payload.leaderId;
        raft.syncUI();
    }

    onRequestVote(msg) {
        const m = msg.payload;
        // (Section 5.2, 5.4) Basic safety: check term and log (omitted log check for simplicity)
        const ok = (m.term >= raft.term && (raft.votedFor === null || raft.votedFor === m.candidateId));
        if (ok) { raft.votedFor = m.candidateId; this.resetTimeout(); }
        sendMessage(msg.from, { type: 'RequestVoteReply', term: raft.term, voteGranted: ok }, 'gray');
        raft.syncUI();
    }

    onClientRequest(msg) {
        sendMessage(msg.from, { type: 'REDIRECT', leaderId: raft.leaderId });
    }
}

class Candidate extends State {
    getState() { return [`candidate (${raft.votesReceived}/${majority})`, '#ffb74d']; }
    canTransition() { return ['leader', 'follower']; }
    onEnter() { this.startElection(); }

    /** (Section 5.2) Start election: increment term, vote for self, request votes */
    startElection() {
        raft.term++;
        raft.votedFor = serverId;
        raft.votesReceived = 1;
        this.addTimeout(getRandom(12, 18), 'startElection');
        broadcast(peers, { type: 'RequestVote', term: raft.term, candidateId: serverId }, true, 'black');
        raft.syncUI();
    }

    registerMessageTypes() {
        return {
            'RequestVoteReply': this.onVoteReply,
            'AppendEntries': this.onAppendEntries
        };
    }

    onVoteReply(msg) {
        const m = msg.payload;
        if (m.voteGranted && m.term === raft.term) {
            raft.votesReceived++;
            if (raft.votesReceived >= majority) this.transition('leader');
            raft.syncUI();
        }
    }

    onAppendEntries(msg) {
        if (msg.payload.term >= raft.term) {
            raft.leaderId = msg.payload.leaderId;
            this.transition('follower');
        }
    }
}

class Leader extends State {
    getState() { return ['leader', '#90caf9']; }
    canTransition() { return ['follower']; }
    onEnter() { this.heartbeat(); }

    /** (Section 5.2) Send periodic heartbeats to maintain leadership */
    heartbeat() {
        this.addTimeout(10, 'heartbeat');
        broadcast(peers, { type: 'AppendEntries', term: raft.term, leaderId: serverId }, true, 'gray');
        raft.syncUI();
    }

    registerMessageTypes() {
        return { 'CLIENT_REQUEST': this.onClientRequest };
    }

    onClientRequest(msg) {
        raft.log.push({ term: raft.term, data: msg.payload.data });
        sendMessage(msg.from, { type: 'CLIENT_RESPONSE', success: true });
        raft.syncUI();
    }
}

const ROLES = [new Follower(), new Candidate(), new Leader()];
const automat = new Automat({ states: ROLES, initial: 'follower' });

function onUp() {
    // Load persistent state (if any) back into the live raft object
    const saved = loadState();
    if (saved.term !== undefined) {
        raft.term = saved.term;
        raft.votedFor = saved.votedFor;
        raft.log = saved.log || [];
        raft.leaderId = saved.leaderId;
    }

    automat.transition('follower');
    raft.syncUI();
}

function onTimer(t) { automat.onTimer(t); }

function onMessage(m) {
    // (Section 5.1) If RPC request/response contains term T > currentTerm, update term and revert to follower
    if (m.payload.term && m.payload.term > raft.term) {
        raft.updateTerm(m.payload.term);
        automat.transition('follower');
    }
    automat.onMessage(m);
}
