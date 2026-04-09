// Generalized Paxos — Competing Clients

const ACCEPTORS = [1, 2, 3]; // Acceptors are now in the middle slots!
const QUORUM = 2;

class ClientMachine extends Machine {
    constructor() {
        super();

        // Top Client (A) logic
        if (serverId === 0) {
            this.targetReg = 2;
            this.val = 'X';
            this.startTime = 10;
        }
        // Bottom Client (B) logic
        else {
            this.targetReg = 3;
            this.val = 'Y';
            this.startTime = 14; // Wakes up just in time to interrupt A!
        }

        this.p1b_responses = 0;
        this.p2b_responses = 0;

        this.states = [new Idle(), new Phase1(), new Phase2(), new Success(), new Failed()];
    }
}

class Idle extends State {
    getUI() { return ['Idle', '#cfd8dc']; }
    canTransition() { return ['Phase1']; }

    onEnter() {
        this.setTimeout(this.machine.startTime, 'startP1', 'p1_timer');
    }

    startP1() {
        broadcast(ACCEPTORS, { type: 'P1A', regIndex: this.machine.targetReg }, 'orange');
        this.transition('Phase1');
    }
}

class Phase1 extends State {
    getUI() { return [`P1A (Reg ${this.machine.targetReg})`, '#ffb74d']; }
    canTransition() { return ['Phase2']; }

    onEnter() {
        this.machine.highestSeenIndex = -1;
        this.machine.adoptedVal = null;
    }

    registerMessageTypes() {
        return {
            'P1B': (msg) => {
                const { registers } = msg.payload;
                this.machine.p1b_responses++;

                // THE FIX: Scan the returned registers.
                // If we see a real value (not unwritten, not nil), track the highest one.
                for (let i = 0; i < this.machine.targetReg; i++) {
                    if (registers[i] !== 'unwritten' && registers[i] !== 'nil') {
                        if (i > this.machine.highestSeenIndex) {
                            this.machine.highestSeenIndex = i;
                            this.machine.adoptedVal = registers[i];
                        }
                    }
                }

                if (this.machine.p1b_responses === QUORUM) {
                    // Decide whether to propose our own value, or the one we adopted from the network
                    if (this.machine.adoptedVal !== null) {
                        this.machine.val = this.machine.adoptedVal; // Adopt it!
                    }

                    broadcast(ACCEPTORS, { type: 'P2A', regIndex: this.machine.targetReg, val: this.machine.val }, 'blue');
                    this.transition('Phase2');
                }
            }
        };
    }
}

class Phase2 extends State {
    getUI() { return [`P2A ('${this.machine.val}')`, '#4fc3f7']; }
    canTransition() { return ['Success', 'Failed']; }

    registerMessageTypes() {
        return {
            'P2B_OK': (msg) => {
                this.machine.p2b_responses++;
                // FIX: Strict equality here too, for safety
                if (this.machine.p2b_responses === QUORUM) {
                    this.transition('Success');
                }
            },
            'P2B_NACK': (msg) => {
                this.transition('Failed');
            }
        };
    }
}

class Success extends State {
    getUI() { return ['Decided!', '#81c784']; }
}

class Failed extends State {
    getUI() { return ['Failed (Invalidated)', '#e57373']; }
}

const MACHINE = new ClientMachine();
function onUp() { MACHINE.onUp(); }
function onTimer(t) { MACHINE.onTimer(t); }
function onMessage(m) { MACHINE.onMessage(m); }