// Multi-Paxos — Proposer Role

const ACCEPTORS = [1, 2, 3];
const QUORUM = 2;

class BaseProposerState extends State {
    startPrepare() {
        this.machine.round++;
        this.machine.ballot = (this.machine.round * 10) + serverId;
        this.machine.promises = [];
        this.machine.nacks = 0;

        broadcast(ACCEPTORS, { type: 'PREPARE', ballot: this.machine.ballot }, 'orange');
        this.transition('preparing');
    }

    startAccept(slot, val) {
        // Track accepts per slot now
        if (!this.machine.accepts[slot]) {
            this.machine.accepts[slot] = [];
        }

        broadcast(ACCEPTORS, {
            type: 'ACCEPT',
            slot: slot,
            ballot: this.machine.ballot,
            val: val
        }, 'blue');
        this.transition('leader');
    }

    handleNack() {
        this.machine.nacks++;
        if (this.machine.nacks >= QUORUM) {
            // We lost leadership!
            this.machine.isLeader = false;
            const jitter = getRandom(5, 20);
            this.transition('failed');
            this.automat.current.setTimeout(jitter, 'onRetry', 'retry_timer');
        }
    }
}

class Idle extends BaseProposerState {
    getState() { return ['idle', '#cfd8dc']; }
    canTransition() { return ['preparing', 'leader']; }

    registerMessageTypes() {
        return {
            'CLIENT_REQUEST': (msg) => {
                const cmd = msg.payload.val;

                if (this.machine.isLeader) {
                    // Fast path: skip Phase 1!
                    const slot = this.machine.nextSlot++;
                    this.startAccept(slot, cmd);
                } else {
                    // Slow path: queue it and gain leadership first
                    this.machine.commandQueue.push(cmd);
                    this.startPrepare();
                }
            }
        };
    }
}

class Preparing extends BaseProposerState {
    getState() { return ['preparing', '#ffb74d']; }
    canTransition() { return ['leader', 'failed']; }

    onEnter() {
        this.setTimeout(25, 'handleNack', 'prep_timeout'); // Treat timeout like a NACK
    }

    registerMessageTypes() {
        return {
            'PROMISE': (msg) => {
                if (!this.machine.promises.includes(msg.from)) {
                    this.machine.promises.push(msg.from);
                }

                if (this.machine.promises.length >= QUORUM) {
                    this.machine.isLeader = true;

                    // In a full implementation, we would merge the Acceptors' logs here.
                    // For this demo, we just flush our queued commands.
                    while (this.machine.commandQueue.length > 0) {
                        const cmd = this.machine.commandQueue.shift();
                        const slot = this.machine.nextSlot++;
                        this.startAccept(slot, cmd);
                    }
                    this.transition('leader');
                }
            },
            'NACK': () => this.handleNack()
        };
    }
}

class Leader extends BaseProposerState {
    getState() { return ['LEADER', '#4fc3f7']; }
    canTransition() { return ['failed', 'leader']; }

    registerMessageTypes() {
        return {
            'CLIENT_REQUEST': (msg) => {
                // Pipeline new commands immediately
                const cmd = msg.payload.val;
                const slot = this.machine.nextSlot++;
                this.startAccept(slot, cmd);
            },
            'ACCEPTED': (msg) => {
                const { slot } = msg.payload;
                if (!this.machine.accepts[slot].includes(msg.from)) {
                    this.machine.accepts[slot].push(msg.from);
                }

                if (this.machine.accepts[slot].length >= QUORUM) {
                    // Slot is committed! (Could notify client here)
                    // console.log(`Slot ${slot} committed!`);
                }
            },
            'NACK': () => this.handleNack()
        };
    }
}

class Failed extends BaseProposerState {
    getState() { return ['failed', '#e57373']; }
    canTransition() { return ['preparing']; }
    onRetry() { this.startPrepare(); }
}

class ProposerMachine extends Machine {
    constructor() {
        super();
        this.round = 0;
        this.ballot = 0;
        this.isLeader = false;

        this.nextSlot = 1;
        this.commandQueue = []; // Commands waiting for Phase 1 to finish

        // UI / Consensus state
        this.promises = [];
        this.accepts = {}; // keyed by slot
        this.nacks = 0;

        this.states = [new Idle(), new Preparing(), new Leader(), new Failed()];
    }
}

const MACHINE = new ProposerMachine();
function onUp() { MACHINE.onUp(); }
function onTimer(t) { MACHINE.onTimer(t); }
function onMessage(m) { MACHINE.onMessage(m); }