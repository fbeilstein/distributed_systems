// Raft Consensus — Safety and Log Replication
const SERVERS = allServerIds.filter(id => id !== 5); // 5 is the Client
const MAJORITY = Math.floor(SERVERS.length / 2) + 1;
const TIMEOUT_MIN = 15;
const TIMEOUT_JITTER = 30;

class RaftBase extends State {
    onUp() {
        this.transition('Follower', false);
    }

    // Raft Rule: If RPC request or response contains term T > currentTerm: 
    // set currentTerm = T, convert to follower.
    checkTerm(msgTerm) {
        if (msgTerm > this.machine.term) {
            this.machine.term = msgTerm;
            this.machine.votedFor = null;
            this.transition('Follower', false);
            return true;
        }
        return false;
    }
}

/** FOLLOWER ROLE */
class Follower extends RaftBase {
    getUI() { return ['Follower', '#cfd8dc']; }
    canTransition() { return ['Candidate', 'Follower']; }

    onEnter() {
        this.resetTimeout();
    }

    resetTimeout() {
        // WIDER random window to prevent initial ties
        this.setTimeout(TIMEOUT_MIN + getRandom(0, TIMEOUT_JITTER), 'startElection', 'elec');
    }

    startElection() {
        this.transition('Candidate');
    }

    onClientRequest(msg) {
        // If we know who the leader is, forward the client's request to them
        if (this.machine.leaderId) {
            sendMessage(this.machine.leaderId, msg.payload, 'gray');
        }
    }

    onAppendEntries(msg) {
        this.checkTerm(msg.payload.term);
        const m = msg.payload;

        if (m.term >= this.machine.term) {
            this.machine.term = m.term; // Sync term in case of equality
            this.machine.leaderId = msg.from;
            this.resetTimeout(); // We heard from a valid leader!

            // Accept the leader's log
            if (m.leaderLog) {
                this.machine.log = JSON.parse(JSON.stringify(m.leaderLog));
            }
            if (m.commitIndex > this.machine.commitIndex) {
                this.machine.commitIndex = m.commitIndex;
            }

            // ACK the replication back to the leader
            sendMessage(msg.from, {
                type: 'AppendAck',
                term: this.machine.term,
                logLength: this.machine.log.length
            }, 'blue');
        }
    }

    onRequestVote(msg) {
        this.checkTerm(msg.payload.term);
        const m = msg.payload;

        // Grant vote if term is good and we haven't voted for someone else
        if (m.term === this.machine.term && (this.machine.votedFor === null || this.machine.votedFor === msg.from)) {
            this.machine.votedFor = msg.from;
            this.resetTimeout(); // Granting a vote resets the election timer
            sendMessage(msg.from, { type: 'VoteReply', term: this.machine.term, granted: true }, 'green');
        } else {
            sendMessage(msg.from, { type: 'VoteReply', term: this.machine.term, granted: false }, 'red');
        }
    }
}

/** CANDIDATE ROLE */
class Candidate extends RaftBase {
    getUI() { return ['Candidate', '#ffb74d']; }
    canTransition() { return ['Leader', 'Follower', 'Candidate']; }

    onEnter() {
        this.machine.term++;
        this.machine.votedFor = serverId;
        this.machine.voteCount = 1;

        broadcast(SERVERS.filter(id => id !== serverId), {
            type: 'RequestVote',
            term: this.machine.term,
            lastLogIndex: this.machine.log.length - 1,
            lastLogTerm: this.machine.log[this.machine.log.length - 1].term
        }, 'orange');

        // CRITICAL FIX: Candidate timeout MUST be randomized to break split vote ties
        this.setTimeout(TIMEOUT_MIN + getRandom(0, TIMEOUT_JITTER), 'onElectionTimeout', 'elec_to');
    }

    onElectionTimeout() {
        this.transition('Candidate'); // Restart election on split vote
    }

    onVoteReply(msg) {
        if (this.checkTerm(msg.payload.term)) return; // We stepped down

        if (msg.payload.granted && msg.payload.term === this.machine.term) {
            this.machine.voteCount++;
            if (this.machine.voteCount >= MAJORITY) {
                this.transition('Leader');
            }
        }
    }

    onAppendEntries(msg) {
        this.checkTerm(msg.payload.term);
        if (msg.payload.term >= this.machine.term) {
            this.machine.term = msg.payload.term;
            this.transition('Follower');
        }
    }

    onRequestVote(msg) {
        // If they have a higher term, checkTerm stepped us down to Follower.
        if (this.checkTerm(msg.payload.term)) {
            this.machine.votedFor = msg.from;
            sendMessage(msg.from, { type: 'VoteReply', term: this.machine.term, granted: true }, 'green');
        } else {
            sendMessage(msg.from, { type: 'VoteReply', term: this.machine.term, granted: false }, 'red');
        }
    }
}

/** LEADER ROLE */
class Leader extends RaftBase {
    getUI() { return ['Leader', '#81c784']; }
    canTransition() { return ['Follower']; }

    onEnter() {
        this.machine.leaderId = serverId;
        this.machine.matchIndex = {};
        SERVERS.forEach(id => this.machine.matchIndex[id] = 0);

        // CRITICAL FIX: Fire the heartbeat immediately to suppress other candidates!
        this.heartbeat();
    }

    heartbeat() {
        broadcast(allServerIds.filter(id => id !== serverId), {
            type: 'AppendEntries',
            term: this.machine.term,
            leaderId: serverId,
            commitIndex: this.machine.commitIndex,
            leaderLog: this.machine.log
        }, '#ba68c8');

        this.setTimeout(10, 'heartbeat', 'hb');
    }

    onClientRequest(msg) {
        this.machine.log.push({ term: this.machine.term, cmd: msg.payload.cmd });
        this.clearTimeout('hb');
        this.heartbeat();
    }

    onAppendAck(msg) {
        if (this.checkTerm(msg.payload.term)) return;

        this.machine.matchIndex[msg.from] = msg.payload.logLength;

        for (let n = this.machine.log.length; n > this.machine.commitIndex; n--) {
            let count = 1;
            SERVERS.forEach(id => {
                if (id !== serverId && this.machine.matchIndex[id] >= n) count++;
            });

            if (count >= MAJORITY) {
                this.machine.commitIndex = n;
                break;
            }
        }
    }

    onAppendEntries(msg) {
        this.checkTerm(msg.payload.term);
    }

    onRequestVote(msg) {
        if (this.checkTerm(msg.payload.term)) {
            this.machine.votedFor = msg.from;
            sendMessage(msg.from, { type: 'VoteReply', term: this.machine.term, granted: true }, 'green');
        } else {
            sendMessage(msg.from, { type: 'VoteReply', term: this.machine.term, granted: false }, 'red');
        }
    }
}


class RaftMachine extends Machine {
    constructor() {
        super();
        this.states = [new Follower(), new Candidate(), new Leader()];
        this.term = 0;
        this.votedFor = null;
        this.leaderId = null;
        this.log = [{ term: 0, cmd: 'INIT' }];
        this.commitIndex = 0;
        this.voteCount = 0;
    }

    syncUI() {
        this.current_leader = this.leaderId !== null ? `DB-${this.leaderId}` : 'None';
        this.log_view = `[${this.log.length} entries] Commits: ${this.commitIndex}`;
    }
}

const MACHINE = new RaftMachine();

function onUp() { MACHINE.onUp(); }
function onTimer(t) { MACHINE.onTimer(t); }
function onMessage(m) { MACHINE.onMessage(m); }