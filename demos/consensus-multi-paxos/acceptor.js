// Multi-Paxos — Acceptor Role

class AcceptorState extends State {
    // Shared message handlers for all states
    registerMessageTypes() {
        return {
            'PREPARE': (msg) => {
                const { ballot } = msg.payload;
                if (ballot > this.machine.promised) {
                    this.machine.promised = ballot;
                    // Return the entire log of accepted values so the new leader can catch up
                    sendMessage(msg.from, {
                        type: 'PROMISE',
                        log: this.machine.log
                    }, 'green');
                    this.transition('Active');
                } else {
                    sendMessage(msg.from, { type: 'NACK', ballot: this.machine.promised }, 'red');
                }
            },
            'ACCEPT': (msg) => {
                const { slot, ballot, val } = msg.payload;
                if (ballot >= this.machine.promised) {
                    this.machine.promised = ballot; // Implicit promise extension

                    // Save to the specific slot in the log
                    if (!this.machine.log[slot]) {
                        this.machine.log[slot] = {};
                    }
                    this.machine.log[slot].acceptedBallot = ballot;
                    this.machine.log[slot].acceptedVal = val;

                    sendMessage(msg.from, { type: 'ACCEPTED', slot, ballot, val }, 'green');
                    this.transition('Active', false);
                } else {
                    sendMessage(msg.from, { type: 'NACK', ballot: this.machine.promised }, 'red');
                }
            }
        };
    }
}

class Ready extends AcceptorState {
    getUI() { return ['ready', '#cfd8dc']; }
    canTransition() { return ['Active']; }
}

class Active extends AcceptorState {
    getUI() {
        const numEntries = Object.keys(this.machine.log).length;
        return [`P:${this.machine.promised} | log:${numEntries}`, '#81c784'];
    }
    canTransition() { return ['Active']; }
}

class AcceptorMachine extends Machine {
    constructor() {
        super();
        this.promised = 0;
        this.log = {}; // format: { 1: { acceptedBallot: 10, acceptedVal: 'CMD' } }
        this.states = [new Ready(), new Active()];
    }
}

const MACHINE = new AcceptorMachine();
function onUp() { MACHINE.onUp(); }
function onTimer(t) { MACHINE.onTimer(t); }
function onMessage(m) { MACHINE.onMessage(m); }