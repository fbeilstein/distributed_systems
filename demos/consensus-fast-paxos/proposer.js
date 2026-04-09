// Fast Paxos — Proposer Role

const N_ACCEPTORS = 5;
const ACCEPTORS = [1, 2, 3, 4, 5];
const CLASSIC_QUORUM = 3;
const FAST_QUORUM = 4;

class BaseProposerState extends State {
    startFastAccept() {
        this.machine.fastAccepts = [];
        broadcast(ACCEPTORS, { type: 'FAST_ACCEPT', val: this.machine.val }, 'purple');
        this.transition('Fastaccepting'); // FIXED: Matches class name
    }

    startPrepare() {
        this.machine.round++;
        this.machine.ballot = (this.machine.round * 10) + serverId;
        this.machine.promises = [];
        this.machine.fastValuesSeen = [];
        this.machine.nacks = 0;
        broadcast(ACCEPTORS, { type: 'PREPARE', ballot: this.machine.ballot }, 'orange');
        this.transition('Preparing');
    }

    startAccept() {
        this.machine.accepts = [];
        this.machine.nacks = 0;
        broadcast(ACCEPTORS, { type: 'ACCEPT', ballot: this.machine.ballot, val: this.machine.val }, 'blue');
        this.transition('Accepting');
    }

    scheduleRetry() {
        const jitter = getRandom(5, 20);
        this.transition('Failed');
        this.automat.current.setTimeout(jitter, 'onRetry', 'retry_timer');
    }
}

class Idle extends BaseProposerState {
    getUI() { return ['idle', '#cfd8dc']; }
    canTransition() { return ['Fastaccepting']; } // FIXED: Permit transition

    registerMessageTypes() {
        return {
            'CLIENT_REQUEST': (msg) => {
                this.machine.val = msg.payload.val;
                this.machine.valueSource = 'fast path';
                this.startFastAccept();
            }
        };
    }
}

class Fastaccepting extends BaseProposerState {
    getUI() { return ['fast accept', '#ce93d8']; }
    canTransition() { return ['Success', 'Collision']; }

    onEnter() {
        this.setTimeout(25, 'fallback', 'fast_timeout');
    }

    fallback() { this.transition('Collision'); }

    registerMessageTypes() {
        return {
            'ACCEPTED': (msg) => {
                if (!this.machine.fastAccepts.includes(msg.from)) {
                    this.machine.fastAccepts.push(msg.from);
                }
                if (this.machine.fastAccepts.length >= FAST_QUORUM) {
                    this.transition('Success');
                }
            },
            'NACK': () => {
                // Instantly detect the collision!
                this.transition('Collision');
            }
        };
    }
}

class Collision extends BaseProposerState {
    getUI() { return ['COLLISION!', '#ff9800']; }
    canTransition() { return ['Preparing']; }

    onEnter() {
        // Pause so the audience can see the collision detected
        this.setTimeout(15, 'recover', 'col_timeout');
    }
    recover() {
        this.startPrepare();
    }
}

class Preparing extends BaseProposerState {
    getUI() { return [`recovering...`, '#ffb74d']; }
    canTransition() { return ['Accepting', 'Failed']; }

    onEnter() { this.setTimeout(30, 'scheduleRetry', 'prep_timeout'); }

    registerMessageTypes() {
        return {
            'PROMISE': (msg) => {
                const { prevBallot, prevVal } = msg.payload;

                if (!this.machine.promises.includes(msg.from)) {
                    this.machine.promises.push(msg.from);

                    // FIXED: Properly lock in ballot 0 to trigger mathematical recovery
                    if (prevBallot === 0 && prevVal !== null) {
                        this.machine.fastValuesSeen.push(prevVal);
                        if (this.machine.highestBallot < 0) this.machine.highestBallot = 0;
                    } else if (prevBallot > this.machine.highestBallot && prevVal !== null) {
                        this.machine.highestBallot = prevBallot;
                        this.machine.val = prevVal;
                    }
                }

                if (this.machine.promises.length >= CLASSIC_QUORUM) {
                    // FAST PAXOS MATHEMATICAL COLLISION RESOLUTION
                    if (this.machine.highestBallot === 0) {
                        let seenVotes = {};
                        for (let val of this.machine.fastValuesSeen) {
                            seenVotes[val] = (seenVotes[val] || 0) + 1;
                        }

                        let unseenNodes = N_ACCEPTORS - this.machine.promises.length;
                        let safeValue = null;

                        // Check if any value could have possibly reached Fast Quorum
                        for (let val in seenVotes) {
                            if (seenVotes[val] + unseenNodes >= FAST_QUORUM) {
                                safeValue = val;
                                break;
                            }
                        }

                        this.machine.val = safeValue !== null ? safeValue : Object.keys(seenVotes)[0];
                    }
                    this.startAccept();
                }
            },
            'NACK': () => {
                this.machine.nacks++;
                if (this.machine.nacks >= CLASSIC_QUORUM) this.scheduleRetry();
            }
        };
    }
}

class Accepting extends BaseProposerState {
    getUI() { return ['accepting (classic)', '#64b5f6']; }
    canTransition() { return ['Success', 'Failed']; }

    onEnter() { this.setTimeout(25, 'scheduleRetry', 'acc_timeout'); }

    registerMessageTypes() {
        return {
            'ACCEPTED': (msg) => {
                if (!this.machine.accepts.includes(msg.from)) {
                    this.machine.accepts.push(msg.from);
                }
                if (this.machine.accepts.length >= CLASSIC_QUORUM) {
                    this.transition('Success');
                }
            },
            'NACK': () => {
                this.machine.nacks++;
                if (this.machine.nacks >= CLASSIC_QUORUM) this.scheduleRetry();
            }
        };
    }
}

class Failed extends BaseProposerState {
    getUI() { return ['failed', '#e57373']; }
    canTransition() { return ['Preparing']; }
    onRetry() { this.startPrepare(); }
}

class Success extends BaseProposerState {
    getUI() { return [`success (${this.machine.val})`, '#81c784']; }
}

class ProposerMachine extends Machine {
    constructor() {
        super();
        this.round = 0;
        this.ballot = 0;
        this.val = null;
        this.valueSource = 'none';
        this.highestBallot = -1;

        this.fastAccepts = [];
        this.fastValuesSeen = [];
        this.promises = [];
        this.accepts = [];
        this.nacks = 0;

        this.states = [
            new Idle(), new Fastaccepting(), new Collision(),
            new Preparing(), new Accepting(),
            new Failed(), new Success()
        ];
    }
}

const MACHINE = new ProposerMachine();
function onUp() { MACHINE.onUp(); }
function onTimer(t) { MACHINE.onTimer(t); }
function onMessage(m) { MACHINE.onMessage(m); }