// Bully Candidates — Ordinary Role (MURSHED12 Strict)
// The ordinary process initiates election by contacting candidate nodes, collecting
// responses from them, picking the highest-ranked alive candidate as a new leader, 
// and then notifying the rest of the nodes about the election results.

const LEADER_TIMEOUT = 25;
const ELECTION_DURATION = 10;
const CANDIDATE_IDS = [2, 3, 4];

class Monitor extends State {
    getState() { return ['ordinary', '#cfd8dc']; }
    canTransition() { return ['waiting_election']; }

    onEnter() {
        this.resetTimer();
    }

    resetTimer() {
        // Tiebreaker variable δ: Delay varying significantly between nodes.
        // Nodes with higher priorities (higher serverId) have a lower δ.
        const offset = (2 - serverId) * 15;
        this.setTimeout(LEADER_TIMEOUT + offset, 'onLeaderTimeout', 'timeout');
    }

    onLeaderTimeout() {
        broadcast(CANDIDATE_IDS, { type: 'ELECTION' }, 'orange');
        this.transition('waiting_election');
    }

    onHEARTBEAT(msg) {
        this.machine.leaderId = msg.payload.leader || msg.from;
        this.resetTimer();
    }

    onCOORDINATOR(msg) {
        this.machine.leaderId = msg.payload.leader || msg.from;
        this.resetTimer();
    }
}

class WaitingElection extends State {
    getState() { return ['waiting_election', '#fff59d']; }
    canTransition() { return ['ordinary']; }

    onEnter() {
        this.machine.aliveCandidates = [];
        this.setTimeout(ELECTION_DURATION, 'onElectionTimeout', 'election');
    }

    onALIVE(msg) {
        if (!this.machine.aliveCandidates.includes(msg.from)) {
            this.machine.aliveCandidates.push(msg.from);
        }
    }

    onElectionTimeout() {
        if (this.machine.aliveCandidates.length > 0) {
            const newLeader = Math.max(...this.machine.aliveCandidates);
            this.machine.leaderId = newLeader;
            // Notify the rest of the nodes about the election results
            broadcast(allServerIds, { type: 'COORDINATOR', leader: newLeader }, 'red');
        }

        // Returning to ordinary will inherently call Monitor's onEnter()
        // which cleanly and natively resets the leader timeout clock!
        this.transition('ordinary');
    }

    onHEARTBEAT(msg) {
        this.machine.leaderId = msg.payload.leader || msg.from;
        this.transition('ordinary');
    }

    onCOORDINATOR(msg) {
        this.machine.leaderId = msg.payload.leader || msg.from;
        this.transition('ordinary');
    }
}

class OrdinaryMachine extends Machine {
    constructor() {
        super({ initial: 'ordinary' });
        this.states = [new Monitor(), new WaitingElection()];
        this.leaderId = -1;
    }
    syncUI() {
        this.current_leader = this.leaderId === -1 ? 'None' : `Node-${this.leaderId}`;
    }
}

const M = new OrdinaryMachine();
function onUp() { M.onUp(); }
function onTimer(t) { M.onTimer(t); }
function onMessage(m) { M.onMessage(m); }
