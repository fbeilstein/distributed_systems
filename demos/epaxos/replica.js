// Egalitarian Paxos (EPaxos) — Symmetric Replica

const REPLICAS = [0, 1, 2, 3, 4];
const FAST_QUORUM = 4; // F = 3f + 1 (for 5 nodes, f=1, F=4)
const SLOW_QUORUM = 3; // Standard majority

class BaseReplicaState extends State {

    // Explicit background handlers (Fixes the broken switch statement)
    handlePreAccept(msg) {
        const { inst, key } = msg.payload;
        const localDep = this.machine.keyDeps[key] || null;

        // Update local dependency tracking
        this.machine.keyDeps[key] = inst;

        sendMessage(msg.from, {
            type: 'PRE-ACCEPT-OK',
            inst: inst,
            dep: localDep
        }, 'green');
    }

    handleAccept(msg) {
        const { inst } = msg.payload;
        sendMessage(msg.from, { type: 'ACCEPT-OK', inst: inst }, 'blue');
    }

    getBackgroundHandlers() {
        return {
            'PRE-ACCEPT': (msg) => this.handlePreAccept(msg),
            'ACCEPT': (msg) => this.handleAccept(msg),
            'COMMIT': (msg) => { /* Finalize commit locally */ }
        };
    }
}

class Idle extends BaseReplicaState {
    getState() { return ['idle', '#cfd8dc']; }
    canTransition() { return ['preaccepting']; }

    registerMessageTypes() {
        return Object.assign(this.getBackgroundHandlers(), {
            'CLIENT_REQUEST': (msg) => {
                const { key, val } = msg.payload;

                this.machine.activeInst = `${serverId}-${++this.machine.localSeq}`;
                this.machine.activeKey = key;
                this.machine.activeVal = val;

                this.machine.initialDep = this.machine.keyDeps[key] || null;
                this.machine.keyDeps[key] = this.machine.activeInst;

                // IMPLICIT SELF-VOTE: We instantly approve our own command!
                this.machine.preAcceptReplies = [serverId];
                this.machine.depsMatch = true;

                // Only broadcast to PEERS (Fixes the "sending message to itself" bug)
                const peers = REPLICAS.filter(r => r !== serverId);
                broadcast(peers, {
                    type: 'PRE-ACCEPT',
                    inst: this.machine.activeInst,
                    key: key
                }, 'orange');

                this.transition('preaccepting');
            }
        });
    }
}

class Preaccepting extends BaseReplicaState {
    getState() { return [`Pre-Accept (${this.machine.activeKey})`, '#ffb74d']; }
    canTransition() { return ['accepting', 'committed', 'idle']; }

    registerMessageTypes() {
        return Object.assign(this.getBackgroundHandlers(), {
            'PRE-ACCEPT-OK': (msg) => {
                const { inst, dep } = msg.payload;
                if (inst !== this.machine.activeInst) return;

                // Track peer votes
                if (!this.machine.preAcceptReplies.includes(msg.from)) {
                    this.machine.preAcceptReplies.push(msg.from);
                }

                // If any replica reports a different dependency, the Fast Path is broken!
                if (dep !== this.machine.initialDep) {
                    this.machine.depsMatch = false;
                }

                // Check for Quorum
                if (this.machine.preAcceptReplies.length >= FAST_QUORUM) {
                    const peers = REPLICAS.filter(r => r !== serverId);

                    if (this.machine.depsMatch) {
                        // FAST PATH! Unanimous agreement
                        broadcast(peers, { type: 'COMMIT', inst: this.machine.activeInst }, 'purple');
                        this.transition('committed');
                    } else {
                        // SLOW PATH! Dependencies mismatched. Fallback to Accept Phase.
                        this.machine.acceptReplies = [serverId]; // Implicit self-vote
                        broadcast(peers, { type: 'ACCEPT', inst: this.machine.activeInst, key: this.machine.activeKey }, 'blue');
                        this.transition('accepting');
                    }
                }
            }
        });
    }
}

class Accepting extends BaseReplicaState {
    getState() { return [`Slow Accept (${this.machine.activeKey})`, '#64b5f6']; }
    canTransition() { return ['committed', 'idle']; }

    registerMessageTypes() {
        return Object.assign(this.getBackgroundHandlers(), {
            'ACCEPT-OK': (msg) => {
                const { inst } = msg.payload;
                if (inst !== this.machine.activeInst) return;

                if (!this.machine.acceptReplies.includes(msg.from)) {
                    this.machine.acceptReplies.push(msg.from);
                }

                if (this.machine.acceptReplies.length >= SLOW_QUORUM) {
                    const peers = REPLICAS.filter(r => r !== serverId);
                    broadcast(peers, { type: 'COMMIT', inst: this.machine.activeInst }, 'purple');
                    this.transition('committed');
                }
            }
        });
    }
}

class Committed extends BaseReplicaState {
    getState() { return [`FAST Commit (${this.machine.activeKey})`, '#81c784']; }

    onEnter() {
        if (!this.machine.depsMatch) {
            this.getState = () => [`SLOW Commit (${this.machine.activeKey})`, '#4db6ac'];
        }
        // Let the state linger visually, then return to idle to accept new commands
        this.setTimeout(25, 'reset', 'commit_timer');
    }

    reset() { this.transition('idle'); }

    registerMessageTypes() {
        return this.getBackgroundHandlers();
    }
}

class ReplicaMachine extends Machine {
    constructor() {
        super();
        this.localSeq = 0;
        this.keyDeps = {};

        this.activeInst = null;
        this.activeKey = null;
        this.initialDep = null;
        this.depsMatch = true;
        this.preAcceptReplies = [];
        this.acceptReplies = [];

        this.states = [new Idle(), new Preaccepting(), new Accepting(), new Committed()];
    }
}

const MACHINE = new ReplicaMachine();
function onUp() { MACHINE.onUp(); }
function onTimer(t) { MACHINE.onTimer(t); }
function onMessage(m) { MACHINE.onMessage(m); }