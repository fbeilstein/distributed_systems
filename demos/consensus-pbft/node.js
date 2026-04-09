// PBFT — Practical Byzantine Fault Tolerance
// Phases: Request → Pre-Prepare → Prepare → Commit → Reply → Checkpoint

const F = 1;
const QUORUM = 2 * F + 1; // 3 nodes required to commit
const PRIMARY_ID = 1;
const CLIENT_ID = 0;
// FIX: The consensus group is EVERYONE except the client.
const REPLICAS = allServerIds.filter(id => id !== CLIENT_ID);

class PBFTBase extends State {
    onUp() {
        this.transition('Idle', false);
    }

    getEntry(seq) {
        if (!this.machine.log[seq]) {
            this.machine.log[seq] = { value: null, prepares: {}, commits: {}, commitSent: false, replied: false };
        }
        return this.machine.log[seq];
    }

    onMessage(msg) {
        if (msg.payload.type === 'REQUEST') this.handleRequest(msg);
        if (msg.payload.type === 'PRE-PREPARE') this.handlePrePrepare(msg);
        if (msg.payload.type === 'PREPARE') this.handlePrepare(msg);
        if (msg.payload.type === 'COMMIT') this.handleCommit(msg);
        if (msg.payload.type === 'CHECKPOINT') this.handleCheckpoint(msg);
    }

    handleRequest(msg) {
        if (serverId === PRIMARY_ID) {
            this.machine.seq++;
            const seq = this.machine.seq;
            const entry = this.getEntry(seq);
            entry.value = msg.payload.cmd;

            broadcast(REPLICAS.filter(id => id !== serverId), {
                type: 'PRE-PREPARE', view: this.machine.view, seq: seq, value: entry.value
            }, 'orange');

            this.transition('PrePrepared', false);
        }
    }

    handlePrePrepare(msg) {
        if (msg.from !== PRIMARY_ID) return;
        const { view, seq, value } = msg.payload;

        const entry = this.getEntry(seq);
        if (!entry.value) {
            entry.value = value;
            this.transition('PrePrepared', false);

            broadcast(REPLICAS.filter(id => id !== serverId), { type: 'PREPARE', view, seq, value }, 'blue');
        }
    }

    handlePrepare(msg) {
        const { view, seq, value } = msg.payload;
        const entry = this.getEntry(seq);
        entry.prepares[msg.from] = value;

        if (entry.value && !entry.commitSent) {
            let matchCount = 0;
            for (let sender in entry.prepares) {
                if (entry.prepares[sender] === entry.value) matchCount++;
            }

            if (matchCount >= 2 * F) {
                entry.commitSent = true;
                this.transition('Prepared', false);
                broadcast(REPLICAS.filter(id => id !== serverId), { type: 'COMMIT', view, seq, value: entry.value }, 'purple');
                entry.commits[serverId] = entry.value;
                this.checkCommit(seq);
            }
        }
    }

    handleCommit(msg) {
        const { view, seq, value } = msg.payload;
        const entry = this.getEntry(seq);
        entry.commits[msg.from] = value;
        this.checkCommit(seq);
    }

    checkCommit(seq) {
        const entry = this.getEntry(seq);

        if (entry.value && !entry.replied) {
            let matchCount = 0;
            for (let sender in entry.commits) {
                if (entry.commits[sender] === entry.value) matchCount++;
            }

            if (matchCount >= QUORUM) {
                entry.replied = true;
                this.transition('Committed', false);

                // Only reply if we are the Primary (to keep UI clean, though real PBFT all reply)
                if (serverId === PRIMARY_ID) {
                    sendMessage(CLIENT_ID, { type: 'REPLY', seq, result: entry.value }, 'green');
                }

                // ==========================================
                // THE CHECKPOINT TRIGGER (Every 3 Sequences)
                // ==========================================
                if (seq % 3 === 0) {
                    const digest = `hash_${seq}`; // Simulated cryptography
                    this.transition('Checkpointing', false);
                    broadcast(REPLICAS.filter(id => id !== serverId), { type: 'CHECKPOINT', seq, digest }, '#ab47bc');
                    this.tallyCheckpoint(serverId, seq, digest);
                } else {
                    this.setTimeout(10, 'resetIdle', 'idle_timer');
                }
            }
        }
    }

    handleCheckpoint(msg) {
        this.tallyCheckpoint(msg.from, msg.payload.seq, msg.payload.digest);
    }

    tallyCheckpoint(from, seq, digest) {
        if (!this.machine.checkpoints[seq]) this.machine.checkpoints[seq] = {};
        if (!this.machine.checkpoints[seq][digest]) this.machine.checkpoints[seq][digest] = 0;

        this.machine.checkpoints[seq][digest]++;

        // Once 3 nodes agree on the exact hash, Garbage Collect the memory!
        if (this.machine.checkpoints[seq][digest] >= QUORUM && this.machine.stableCheckpoint < seq) {
            this.machine.stableCheckpoint = seq;

            // GARBAGE COLLECTION
            Object.keys(this.machine.log).forEach(s => {
                if (parseInt(s) <= seq) delete this.machine.log[s];
            });
            Object.keys(this.machine.checkpoints).forEach(s => {
                if (parseInt(s) < seq) delete this.machine.checkpoints[s];
            });

            this.transition('Idle', false);
        }
    }

    resetIdle() { this.transition('Idle', false); }
}

class Idle extends PBFTBase {
    getUI() { return ['Idle', '#cfd8dc']; }
    canTransition() { return ['Idle', 'PrePrepared', 'Prepared', 'Committed', 'Checkpointing']; }
}
class PrePrepared extends PBFTBase {
    getUI() { return ['PrePrepared', '#4fc3f7']; }
    canTransition() { return ['Idle', 'PrePrepared', 'Prepared', 'Committed', 'Checkpointing']; }
}
class Prepared extends PBFTBase {
    getUI() { return ['Prepared', '#ce93d8']; }
    canTransition() { return ['Idle', 'PrePrepared', 'Prepared', 'Committed', 'Checkpointing']; }
}
class Committed extends PBFTBase {
    getUI() { return ['Committed', '#81c784']; }
    canTransition() { return ['Idle', 'PrePrepared', 'Prepared', 'Committed', 'Checkpointing']; }
}
class Checkpointing extends PBFTBase {
    getUI() { return ['Checkpointing', '#ab47bc']; } // Purple
    canTransition() { return ['Idle']; }
}

class PBFTMachine extends Machine {
    constructor() {
        super();
        this.states = [new Idle(), new PrePrepared(), new Prepared(), new Committed(), new Checkpointing()];
        this.view = 0;
        this.seq = 0;
        this.log = {};
        this.checkpoints = {};
        this.stableCheckpoint = 0;
    }
}

const MACHINE = new PBFTMachine();
function onUp() { MACHINE.onUp(); }
function onTimer(t) { MACHINE.onTimer(t); }
function onMessage(m) { MACHINE.onMessage(m); }