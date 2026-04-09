// Flexible Paxos — Proposer Role

// We will expand the demo to 5 Acceptors to make the math interesting
const ACCEPTORS = [1, 2, 3, 4, 5];

// THE FLEXIBLE PAXOS RULE: P + A > N
// N = 5 Acceptors. 
// Standard Paxos would be P=3, A=3.
// We will optimize for fast writes: P=4, A=2. (4 + 2 > 5)
const PHASE_1_QUORUM = 4;
const PHASE_2_QUORUM = 2;

class BaseProposerState extends State {
    // Helper to start Phase 1 (Prepare)
    startPrepare() {
        this.machine.round++;
        // Generate unique monotonic ballot: e.g., Round 1, Server 0 -> Ballot 10
        this.machine.ballot = (this.machine.round * 10) + serverId;

        this.machine.promises = [];
        this.machine.nacks = 0;

        broadcast(ACCEPTORS, { type: 'PREPARE', ballot: this.machine.ballot }, 'orange');
        this.transition('Preparing');
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
        this.transition('Accepting');
    }

    // Retry logic with random jitter to prevent livelock
    scheduleRetry() {
        const jitter = getRandom(5, 20);
        this.transition('Failed'); // Briefly flash red

        // Use the stale-reference safe method to set a timer on the NEW 'failed' state
        this.automat.current.setTimeout(jitter, 'onRetry', 'retry_timer');
    }
}

class Idle extends BaseProposerState {
    getUI() { return ['idle', '#cfd8dc']; }
    canTransition() { return ['Preparing']; }

    registerMessageTypes() {
        return {
            'CLIENT_REQUEST': (msg) => {
                this.machine.val = msg.payload.val;
                this.machine.valueSource = 'original';
                this.startPrepare();
            }
        };
    }
}

class Preparing extends BaseProposerState {
    getUI() {
        const source = this.machine.valueSource === 'original' ? '' : ' (adopted)';
        return [`preparing${source}`, '#ffb74d'];
    }
    canTransition() { return ['Accepting', 'Failed']; }

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
                    this.machine.valueSource = `from B:${prevBallot}`;
                }

                if (this.machine.promises.length >= PHASE_1_QUORUM) {
                    this.startAccept();
                }
            },
            'NACK': (msg) => {
                this.machine.nacks++;
                if (this.machine.nacks >= PHASE_1_QUORUM) this.scheduleRetry();
            }
        };
    }
}

class Accepting extends BaseProposerState {
    getUI() { return ['accepting', '#64b5f6']; }
    canTransition() { return ['Success', 'Failed']; }

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
                if (this.machine.accepts.length >= PHASE_2_QUORUM) {
                    this.transition('Success');
                }
            },
            'NACK': (msg) => {
                this.machine.nacks++;
                if (this.machine.nacks >= PHASE_2_QUORUM) this.scheduleRetry();
            }
        };
    }
}

class Failed extends BaseProposerState {
    getUI() { return ['failed', '#e57373']; }
    canTransition() { return ['Preparing']; }

    onRetry() {
        this.startPrepare();
    }
}

class Success extends BaseProposerState {
    getUI() { return ['success', '#81c784']; }
}

class ProposerMachine extends Machine {
    constructor() {
        super();
        this.round = 0;
        this.ballot = 0;
        this.val = null;
        this.valueSource = 'none';
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