// Paxos (Single Degree) — Proposer Role

const ACCEPTORS = [2, 3, 4];
const QUORUM = 2; // Majority of 3 acceptors

class Idle extends State {
    getState() { return ['idle', '#cfd8dc']; }
    canTransition() { return ['preparing']; }
    registerMessageTypes() {
        return {
            'CLIENT_REQUEST': (msg) => {
                const { val } = msg.payload;
                // Generate a globally unique, strictly increasing ballot
                const baseBallot = (msg.arrivalTick || 1) * 10;
                this.machine.ballot = baseBallot + serverId;
                this.machine.val = val;

                broadcast(ACCEPTORS, { type: 'PREPARE', ballot: this.machine.ballot }, 'orange');
                this.transition('preparing');
            }
        };
    }
}

class Preparing extends State {
    getState() { return ['preparing', '#ffb74d']; }
    canTransition() { return ['success', 'failed']; }
    registerMessageTypes() {
        return {
            'PROMISE': (msg) => {
                const { prevBallot, prevVal } = msg.payload;

                // Set logic inside arrays because Set isn't natively serialized beautifully in the inspector out-of-the-box
                if (!this.machine.promises.includes(msg.from)) {
                    this.machine.promises.push(msg.from);
                }

                // Adopt highest accepted value provided by acceptors
                if (prevBallot > this.machine.highestBallot && prevVal !== null) {
                    this.machine.highestBallot = prevBallot;
                    this.machine.val = prevVal;
                }

                if (this.machine.promises.length >= QUORUM) {
                    broadcast(ACCEPTORS, { type: 'ACCEPT', ballot: this.machine.ballot, val: this.machine.val }, 'blue');
                    this.transition('success');
                }
            },
            'NACK': (msg) => {
                this.machine.nacks++;
                if (this.machine.nacks >= QUORUM) {
                    this.transition('failed');
                }
            }
        };
    }
}

class Success extends State {
    getState() { return ['success', '#81c784']; }
}

class Failed extends State {
    getState() { return ['failed', '#e57373']; }
}

class ProposerMachine extends Machine {
    constructor() {
        super();
        this.promises = [];
        this.nacks = 0;
        this.highestBallot = 0;
        this.ballot = 0;
        this.val = null;
        this.states = [new Idle(), new Preparing(), new Success(), new Failed()];
    }
}

const MACHINE = new ProposerMachine();

function onUp() { MACHINE.onUp(); }
function onTimer(t) { MACHINE.onTimer(t); }
function onMessage(m) { MACHINE.onMessage(m); }
