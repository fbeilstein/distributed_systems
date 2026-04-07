// Generalized Paxos — Client

const ACCEPTORS = [0, 1, 2];
const QUORUM = 2;

class ClientMachine extends Machine {
    constructor() {
        super();
        this.targetReg = 2; // We are trying to write to Register index 2
        this.val = 'X';

        this.p1b_responses = 0;
        this.p2b_responses = 0;

        this.states = [new Idle(), new Phase1(), new Phase2(), new Success()];
    }
}

class Idle extends State {
    getState() { return ['Idle', '#cfd8dc']; }
    canTransition() { return ['Phase1']; }

    onEnter() {
        this.setTimeout(10, 'startP1', 'p1_timer');
    }

    startP1() {
        broadcast(ACCEPTORS, { type: 'P1A', regIndex: this.machine.targetReg }, 'orange');
        this.transition('Phase1');
    }
}

class Phase1 extends State {
    getState() { return [`P1A (Reg ${this.machine.targetReg})`, '#ffb74d']; }
    canTransition() { return ['Phase2']; }

    registerMessageTypes() {
        return {
            'P1B': (msg) => {
                this.machine.p1b_responses++;
                if (this.machine.p1b_responses >= QUORUM) {
                    broadcast(ACCEPTORS, { type: 'P2A', regIndex: this.machine.targetReg, val: this.machine.val }, 'blue');
                    this.transition('Phase2');
                }
            }
        };
    }
}

class Phase2 extends State {
    getState() { return [`P2A ('${this.machine.val}')`, '#4fc3f7']; }
    canTransition() { return ['Success']; }

    registerMessageTypes() {
        return {
            'P2B_OK': (msg) => {
                this.machine.p2b_responses++;
                if (this.machine.p2b_responses >= QUORUM) {
                    this.transition('Success');
                }
            }
        };
    }
}

class Success extends State {
    getState() { return ['Decided!', '#81c784']; }
}

const MACHINE = new ClientMachine();
function onUp() { MACHINE.onUp(); }
function onTimer(t) { MACHINE.onTimer(t); }
function onMessage(m) { MACHINE.onMessage(m); }