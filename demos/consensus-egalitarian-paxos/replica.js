// Egalitarian Paxos (EPaxos) — Symmetric Replica

const REPLICAS = [0, 1, 2, 3, 4];
const FAST_QUORUM = 4; // F = 3f + 1 (for 5 nodes, f=1, F=4)
const SLOW_QUORUM = 3; // Standard majority

class BaseReplicaState extends State {

    // Explicit background handlers
    handlePreAccept(msg) {
        const { inst, key } = msg.payload;
        const localDep = this.machine.keyDeps[key] || null;

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

    handleCommit(msg) {
        const { key, val, inst } = msg.payload;
        if (key && val) {
            // DETERMINISTIC TIE-BREAKER: 
            // Only overwrite if this instance ID is "higher" than the last one that wrote to this key.
            // This forces all nodes to apply conflicting commits in the exact same order!
            if (!this.machine.db_inst[key] || inst > this.machine.db_inst[key]) {
                this.machine.db[key] = val;
                this.machine.db_inst[key] = inst;
            }
        }
    }

    getBackgroundHandlers() {
        return {
            'PRE-ACCEPT': (msg) => this.handlePreAccept(msg),
            'ACCEPT': (msg) => this.handleAccept(msg),
            'COMMIT': (msg) => this.handleCommit(msg)
        };
    }
}

class Idle extends BaseReplicaState {
    getUI() {
        // Dynamically show the contents of the database while idle
        const keys = Object.keys(this.machine.db);
        if (keys.length === 0) return ['idle', '#cfd8dc'];

        const dbState = keys.map(k => `${k}:${this.machine.db[k]}`).join(', ');
        return [`idle [${dbState}]`, '#b0bec5']; // Slightly darker gray to indicate it holds data
    }

    canTransition() { return ['Preaccepting']; }

    registerMessageTypes() {
        return Object.assign(this.getBackgroundHandlers(), {
            'CLIENT_REQUEST': (msg) => {
                const { key, val } = msg.payload;

                this.machine.activeInst = `${serverId}-${++this.machine.localSeq}`;
                this.machine.activeKey = key;
                this.machine.activeVal = val;

                this.machine.initialDep = this.machine.keyDeps[key] || null;
                this.machine.keyDeps[key] = this.machine.activeInst;

                this.machine.preAcceptReplies = [serverId];
                this.machine.depsMatch = true;

                const peers = REPLICAS.filter(r => r !== serverId);
                broadcast(peers, {
                    type: 'PRE-ACCEPT',
                    inst: this.machine.activeInst,
                    key: key
                }, 'orange');

                this.transition('Preaccepting');
            }
        });
    }
}

class Preaccepting extends BaseReplicaState {
    getUI() { return [`Pre-Accept (${this.machine.activeKey})`, '#ffb74d']; }
    canTransition() { return ['Accepting', 'Committed', 'Idle']; }

    registerMessageTypes() {
        return Object.assign(this.getBackgroundHandlers(), {
            'PRE-ACCEPT-OK': (msg) => {
                const { inst, dep } = msg.payload;
                if (inst !== this.machine.activeInst) return;

                if (!this.machine.preAcceptReplies.includes(msg.from)) {
                    this.machine.preAcceptReplies.push(msg.from);
                }

                if (dep !== this.machine.initialDep) {
                    this.machine.depsMatch = false;
                }

                if (this.machine.preAcceptReplies.length >= FAST_QUORUM) {
                    const peers = REPLICAS.filter(r => r !== serverId);

                    if (this.machine.depsMatch) {
                        // FAST PATH! Broadcast the value so background nodes can save it
                        broadcast(peers, {
                            type: 'COMMIT',
                            inst: this.machine.activeInst,
                            key: this.machine.activeKey,
                            val: this.machine.activeVal
                        }, 'purple');
                        this.transition('Committed');
                    } else {
                        // SLOW PATH!
                        this.machine.acceptReplies = [serverId];
                        broadcast(peers, { type: 'ACCEPT', inst: this.machine.activeInst, key: this.machine.activeKey }, 'blue');
                        this.transition('Accepting');
                    }
                }
            }
        });
    }
}

class Accepting extends BaseReplicaState {
    getUI() { return [`Slow Accept (${this.machine.activeKey})`, '#64b5f6']; }
    canTransition() { return ['Committed', 'Idle']; }

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
                    // SLOW COMMIT! Broadcast the value so background nodes can save it
                    broadcast(peers, {
                        type: 'COMMIT',
                        inst: this.machine.activeInst,
                        key: this.machine.activeKey,
                        val: this.machine.activeVal
                    }, 'purple');
                    this.transition('Committed');
                }
            }
        });
    }
}

class Committed extends BaseReplicaState {
    getUI() { return [`FAST Commit (${this.machine.activeVal})`, '#81c784']; }

    onEnter() {
        // Save to the Command Leader's local database
        this.machine.db[this.machine.activeKey] = this.machine.activeVal;

        if (!this.machine.depsMatch) {
            this.getState = () => [`SLOW Commit (${this.machine.activeVal})`, '#4db6ac'];
        }

        // Timeout reduced to 10 ticks!
        this.setTimeout(10, 'reset', 'commit_timer');
    }

    reset() { this.transition('Idle'); }

    registerMessageTypes() {
        return this.getBackgroundHandlers();
    }
}

class ReplicaMachine extends Machine {
    constructor() {
        super();
        this.localSeq = 0;
        this.keyDeps = {};

        this.db = {};
        this.db_inst = {};

        this.activeInst = null;
        this.activeKey = null;
        this.activeVal = null;
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