// PBFT — Practical Byzantine Fault Tolerance
// Phases: Request → Pre-Prepare → Prepare → Commit → Reply

const F = 1;
const QUORUM = 2 * F + 1; // 3 nodes required to commit (including self)
const PRIMARY_ID = 1;
const CLIENT_ID = 0;
const SERVERS = allServerIds.filter(id => id !== CLIENT_ID && id !== PRIMARY_ID);

class PBFTBase extends State {
    onUp() {
        this.transition('Idle', false);
    }

    // Helper to initialize log state for a specific sequence number
    getEntry(seq) {
        if (!this.machine.log[seq]) {
            this.machine.log[seq] = {
                value: null,          // The Primary's proposed value
                prepares: {},         // Tally: { senderId: proposedValue }
                commits: {},          // Tally: { senderId: committedValue }
                preparedSent: false,
                commitSent: false,
                replied: false
            };
        }
        return this.machine.log[seq];
    }

    // Master dispatcher: Never drop messages due to visual UI state
    onMessage(msg) {
        if (msg.payload.type === 'REQUEST') this.handleRequest(msg);
        if (msg.payload.type === 'PRE-PREPARE') this.handlePrePrepare(msg);
        if (msg.payload.type === 'PREPARE') this.handlePrepare(msg);
        if (msg.payload.type === 'COMMIT') this.handleCommit(msg);
    }

    // 1. PRIMARY ONLY: Receive request, assign sequence, start consensus
    handleRequest(msg) {
        if (serverId === PRIMARY_ID) {
            this.machine.seq++;
            const seq = this.machine.seq;
            const entry = this.getEntry(seq);
            entry.value = msg.payload.cmd;

            broadcast(SERVERS.filter(id => id !== serverId), {
                type: 'PRE-PREPARE', view: this.machine.view, seq: seq, value: entry.value
            }, 'orange');

            this.transition('PrePrepared', false);
        }
    }

    // 2. BACKUPS: Receive Pre-Prepare from Primary, echo Prepare to all
    handlePrePrepare(msg) {
        if (msg.from !== PRIMARY_ID) return;
        const { view, seq, value } = msg.payload;

        const entry = this.getEntry(seq);
        if (!entry.value) {
            entry.value = value; // Establish the "truth" for this node
            this.transition('PrePrepared', false);

            // Broadcast PREPARE to everyone (including the Primary)
            broadcast(SERVERS.filter(id => id !== serverId), {
                type: 'PREPARE', view, seq, value
            }, 'blue');
        }
    }

    // 3. ALL NODES: Tally Prepare votes. 
    handlePrepare(msg) {
        const { view, seq, value } = msg.payload;
        const entry = this.getEntry(seq);

        // Record exactly what value this sender claims (Defeats the Traitor)
        entry.prepares[msg.from] = value;

        // Only evaluate if we know the Primary's proposed truth
        if (entry.value && !entry.commitSent) {
            let matchCount = 0;
            for (let sender in entry.prepares) {
                // BYZANTINE CHECK: Only count votes that mathematically match the primary!
                // The Traitor's '_FORK_A' will fail this check and be ignored.
                if (entry.prepares[sender] === entry.value) matchCount++;
            }

            // Prepared Certificate requires 2*F PREPAREs from others
            if (matchCount >= 2 * F) {
                entry.commitSent = true;
                this.transition('Prepared', false);

                broadcast(SERVERS.filter(id => id !== serverId), {
                    type: 'COMMIT', view, seq, value: entry.value
                }, 'purple');

                // We implicitly commit our own value
                entry.commits[serverId] = entry.value;
                this.checkCommit(seq);
            }
        }
    }

    // 4. ALL NODES: Tally Commit votes.
    handleCommit(msg) {
        const { view, seq, value } = msg.payload;
        const entry = this.getEntry(seq);

        // Record exactly what value this sender commits
        entry.commits[msg.from] = value;
        this.checkCommit(seq);
    }

    // 5. ALL NODES: Verify Quorum and Reply to Client
    checkCommit(seq) {
        const entry = this.getEntry(seq);

        if (entry.value && !entry.replied) {
            let matchCount = 0;
            for (let sender in entry.commits) {
                // BYZANTINE CHECK: Final safety barrier
                if (entry.commits[sender] === entry.value) matchCount++;
            }

            // Commit Certificate requires 2*F + 1 total votes
            if (matchCount >= QUORUM) {
                entry.replied = true;
                this.transition('Committed', false);

                // Send the final result back to the Client (Node 5)
                sendMessage(5, { type: 'REPLY', seq, result: entry.value }, 'green');

                // Visual nicety: Return to Idle after a short delay
                this.setTimeout(10, 'resetIdle', 'idle_timer');
            }
        }
    }

    resetIdle() {
        this.transition('Idle', false);
    }
}

// ==========================================
// VISUAL UI STATES (Strict FSM Rules)
// ==========================================

class Idle extends PBFTBase {
    getUI() { return ['Idle', '#cfd8dc']; }
    canTransition() { return ['Idle', 'PrePrepared', 'Prepared', 'Committed']; }
}

class PrePrepared extends PBFTBase {
    getUI() { return ['PrePrepared', '#4fc3f7']; }
    canTransition() { return ['Idle', 'PrePrepared', 'Prepared', 'Committed']; }
}

class Prepared extends PBFTBase {
    getUI() { return ['Prepared', '#ce93d8']; }
    canTransition() { return ['Idle', 'PrePrepared', 'Prepared', 'Committed']; }
}

class Committed extends PBFTBase {
    getUI() { return ['Committed', '#81c784']; }
    canTransition() { return ['Idle', 'PrePrepared', 'Prepared', 'Committed']; }
}

// ==========================================
// MACHINE REGISTRATION
// ==========================================

class PBFTMachine extends Machine {
    constructor() {
        super();
        this.states = [new Idle(), new PrePrepared(), new Prepared(), new Committed()];
        this.view = 0;
        this.seq = 0;
        this.log = {};
    }

    syncUI() {
        this.current_view = `View ${this.view}`;
        this.highest_seq = `Seq ${this.seq}`;
    }
}

const MACHINE = new PBFTMachine();

function onUp() { MACHINE.onUp(); }
function onTimer(t) { MACHINE.onTimer(t); }
function onMessage(m) { MACHINE.onMessage(m); }