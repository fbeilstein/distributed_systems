// Raft Node - State Instance Pattern (Decoupled Display)
class RaftState extends State {
    onMessage(msg) {
        let s = loadState();
        if (msg.payload.term && msg.payload.term > s.currentTerm) {
            s.currentTerm = msg.payload.term; s.votedFor = null; dumpState(s);
            this.transition('follower');
            // Recursive re-dispatch: Let the NEW state (Follower) process this same message immediately
            this.automat.onMessage(msg);
            return true; // We handled it (by switching and re-dispatching)
        }
        return false;
    }
}

class Follower extends RaftState {
    getState() { return ['follower', '#b2dfdb']; }
    onUp() {
        let s = loadState();
        if (s.currentTerm === undefined) dumpState({ currentTerm: 0, votedFor: null, log: [], commitIndex: 0, lastApplied: 0 });
    }
    onEnter() { this.resetTimeout(); }
    resetTimeout() { this.addTimeout(getRandom(15, 21), 'becomeCandidate'); }
    becomeCandidate() { this.transition('candidate'); }
    onMessage(msg) {
        if (super.onMessage(msg)) return true;
        let s = loadState(), m = msg.payload;
        if (m.type === 'AppendEntries') {
            this.resetTimeout();
            if (s.leaderId !== m.leaderId) { s.leaderId = m.leaderId; dumpState(s); }
        } else if (m.type === 'RequestVote') {
            const ok = (m.term >= s.currentTerm && (s.votedFor === null || s.votedFor === m.candidateId));
            if (ok) { s.votedFor = m.candidateId; this.resetTimeout(); dumpState(s); }
            sendMessage(msg.from, { type: 'RequestVoteReply', term: s.currentTerm, voteGranted: ok });
        } else if (m.type === 'CLIENT_REQUEST') {
            // Redirect to leader if known
            sendMessage(msg.from, { type: 'REDIRECT', leaderId: s.leaderId });
        }
    }
}

class Candidate extends RaftState {
    getState() {
        let s = loadState();
        return [`candidate (${s.votesReceived}/5)`, '#ffb74d'];
    }
    onEnter() { this.startElection(); }
    startElection() {
        let s = loadState(); s.currentTerm++; s.votedFor = serverId; s.votesReceived = 1; dumpState(s);
        this.addTimeout(getRandom(12, 18), 'startElection');
        allServerIds.filter(id => id !== serverId && id !== 5).forEach(peer => {
            sendMessage(peer, { type: 'RequestVote', term: s.currentTerm, candidateId: serverId });
        });
    }
    onMessage(msg) {
        if (super.onMessage(msg)) return true;
        let s = loadState(), m = msg.payload;
        if (m.type === 'RequestVoteReply' && m.voteGranted && m.term === s.currentTerm) {
            s.votesReceived++; dumpState(s);
            if (s.votesReceived > Math.floor(5 / 2)) this.transition('leader');
        } else if (m.type === 'AppendEntries' && m.term >= s.currentTerm) {
            this.transition('follower');
            this.automat.onMessage(msg); // Immediate Follower processing
            return true;
        }
    }
}

class Leader extends RaftState {
    getState() { return ['leader', '#90caf9']; }
    onEnter() { this.heartbeat(); }
    heartbeat() {
        this.addTimeout(10, 'heartbeat');
        let s = loadState();
        allServerIds.filter(id => id !== serverId && id !== 5).forEach(peer => {
            sendMessage(peer, { type: 'AppendEntries', term: s.currentTerm, leaderId: serverId });
        });
    }
    onMessage(msg) {
        if (super.onMessage(msg)) return true;
        if (msg.payload.type === 'CLIENT_REQUEST') {
            let s = loadState(); s.log.push({ term: s.currentTerm, data: msg.payload.data }); dumpState(s);
            sendMessage(msg.from, { type: 'CLIENT_RESPONSE', success: true });
        }
    }
}

const ROLES = [new Follower(), new Candidate(), new Leader()];

function onUp() { Automat.run('onUp', null, ...ROLES); }
function onTimer(t) { Automat.run('onTimer', t, ...ROLES); }
function onMessage(m) { Automat.run('onMessage', m, ...ROLES); }
