// Paxos (Single Degree) — Proposer Role

const ACCEPTORS = [1, 2, 3];
const QUORUM = 2;

class BaseProposerState extends State {
    // Helper to start Phase 1 (Prepare)
    startPrepare() {
        this.machine.round++;
        // Generate unique monotonic ballot: e.g., Round 1, Server 0 -> Ballot 10
        this.machine.ballot = (this.machine.round * 10) + serverId;

        this.machine.promises = [];
        this.machine.nacks = 0;

        broadcast(ACCEPTORS, { type: 'PREPARE', ballot: this.machine.ballot }, 'orange');
        this.transition('preparing');
    }

    // Helper to start Phase 2 (Accept)
    startAccept() {
        this.machine.accepts = [];
        this.machine.nacks = 0;

        broadcast(ACCEPTORS, {
            type: 'ACCEPT',
            ballot: this.machine.ballot,
            val: this.machine.val
        }, 'blue');
        this.transition('accepting');
    }

    // Retry logic with random jitter to prevent livelock
    scheduleRetry() {
        const jitter = getRandom(5, 20);
        this.transition('failed'); // Briefly flash red

        // Use the stale-reference safe method to set a timer on the NEW 'failed' state
        this.automat.current.setTimeout(jitter, 'onRetry', 'retry_timer');
    }
}

class Idle extends BaseProposerState {
    getState() { return ['idle', '#cfd8dc']; }
    canTransition() { return ['preparing']; }

    registerMessageTypes() {
        return {
            'CLIENT_REQUEST': (msg) => {
                this.machine.val = msg.payload.val;
                this.startPrepare();
            }
        };
    }
}

class Preparing extends BaseProposerState {
    getState() { return ['preparing', '#ffb74d']; }
    canTransition() { return ['accepting', 'failed']; }

    onEnter() {
        // If we don't get a quorum of promises in 25 ticks, retry
        this.setTimeout(25, 'scheduleRetry', 'prep_timeout');
    }

    registerMessageTypes() {
        return {
            'PROMISE': (msg) => {
                const { prevBallot, prevVal } = msg.payload;

                if (!this.machine.promises.includes(msg.from)) {
                    this.machine.promises.push(msg.from);
                }

                // Adopt the highest accepted value seen so far
                if (prevBallot > this.machine.highestBallot && prevVal !== null) {
                    this.machine.highestBallot = prevBallot;
                    this.machine.val = prevVal;
                }

                if (this.machine.promises.length >= QUORUM) {
                    this.startAccept();
                }
            },
            'NACK': (msg) => {
                this.machine.nacks++;
                if (this.machine.nacks >= QUORUM) this.scheduleRetry();
            }
        };
    }
}

class Accepting extends BaseProposerState {
    getState() { return ['accepting', '#64b5f6']; }
    canTransition() { return ['success', 'failed']; }

    onEnter() {
        // If we don't get a quorum of accepts in 25 ticks, start completely over
        this.setTimeout(25, 'scheduleRetry', 'acc_timeout');
    }

    registerMessageTypes() {
        return {
            'ACCEPTED': (msg) => {
                if (!this.machine.accepts.includes(msg.from)) {
                    this.machine.accepts.push(msg.from);
                }

                // Consensus is ACTUALLY reached here!
                if (this.machine.accepts.length >= QUORUM) {
                    this.transition('success');
                }
            },
            'NACK': (msg) => {
                this.machine.nacks++;
                if (this.machine.nacks >= QUORUM) this.scheduleRetry();
            }
        };
    }
}

class Failed extends BaseProposerState {
    getState() { return ['failed', '#e57373']; }
    canTransition() { return ['preparing']; }

    onRetry() {
        this.startPrepare();
    }
}

class Success extends BaseProposerState {
    getState() { return ['success', '#81c784']; }
}

class ProposerMachine extends Machine {
    constructor() {
        super();
        this.round = 0;
        this.ballot = 0;
        this.val = null;
        this.highestBallot = 0;

        // UI Arrays
        this.promises = [];
        this.accepts = [];
        this.nacks = 0;

        this.states = [new Idle(), new Preparing(), new Accepting(), new Failed(), new Success()];
    }
}

const MACHINE = new ProposerMachine();
function onUp() { MACHINE.onUp(); }
function onTimer(t) { MACHINE.onTimer(t); }
function onMessage(m) { MACHINE.onMessage(m); }