// Paxos (Single Degree) — Acceptor Role

class Ready extends State {
    getState() { return ['ready', '#cfd8dc']; }
    canTransition() { return ['promised', 'accepted']; }
    registerMessageTypes() {
        return {
            'PREPARE': (msg) => {
                const { ballot } = msg.payload;
                if (ballot > this.machine.promised) {
                    this.machine.promised = ballot;
                    sendMessage(msg.from, {
                        type: 'PROMISE',
                        prevBallot: this.machine.acceptedBallot,
                        prevVal: this.machine.acceptedVal
                    }, 'green');
                    this.transition('promised');
                } else {
                    sendMessage(msg.from, { type: 'NACK', ballot: this.machine.promised }, 'red');
                }
            },
            'ACCEPT': (msg) => {
                const { ballot, val } = msg.payload;
                if (ballot >= this.machine.promised) {
                    this.machine.promised = ballot;
                    this.machine.acceptedBallot = ballot;
                    this.machine.acceptedVal = val;
                    sendMessage(msg.from, { type: 'ACCEPTED', ballot, val }, 'green');
                    this.transition('accepted');
                } else {
                    sendMessage(msg.from, { type: 'NACK', ballot: this.machine.promised }, 'red');
                }
            }
        };
    }
}

class Promised extends State {
    getState() {
        let label = `P:${this.machine.promised}`;
        if (this.machine.acceptedVal !== null) {
            label += ` (v:${this.machine.acceptedVal})`;
        }
        return [label, '#ffe082'];
    }
    canTransition() { return ['promised', 'accepted']; }
    registerMessageTypes() {
        return {
            'PREPARE': (msg) => {
                const { ballot } = msg.payload;
                if (ballot > this.machine.promised) {
                    this.machine.promised = ballot;
                    sendMessage(msg.from, {
                        type: 'PROMISE',
                        prevBallot: this.machine.acceptedBallot,
                        prevVal: this.machine.acceptedVal
                    }, 'green');
                    this.transition('promised', false); // stay/re-enter Promised
                } else {
                    sendMessage(msg.from, { type: 'NACK', ballot: this.machine.promised }, 'red');
                }
            },
            'ACCEPT': (msg) => {
                const { ballot, val } = msg.payload;
                if (ballot >= this.machine.promised) {
                    this.machine.promised = ballot;
                    this.machine.acceptedBallot = ballot;
                    this.machine.acceptedVal = val;
                    sendMessage(msg.from, { type: 'ACCEPTED', ballot, val }, 'green');
                    this.transition('accepted');
                } else {
                    sendMessage(msg.from, { type: 'NACK', ballot: this.machine.promised }, 'red');
                }
            }
        };
    }
}

class Accepted extends State {
    getState() {
        const val = this.machine.acceptedVal !== null ? this.machine.acceptedVal : '-';
        return [`A:${this.machine.acceptedBallot}:${val}`, '#81c784'];
    }
    canTransition() { return ['promised', 'accepted']; }
    registerMessageTypes() {
        return {
            'PREPARE': (msg) => {
                const { ballot } = msg.payload;
                if (ballot > this.machine.promised) {
                    this.machine.promised = ballot;
                    sendMessage(msg.from, {
                        type: 'PROMISE',
                        prevBallot: this.machine.acceptedBallot,
                        prevVal: this.machine.acceptedVal
                    }, 'green');
                    this.transition('promised');
                } else {
                    sendMessage(msg.from, { type: 'NACK', ballot: this.machine.promised }, 'red');
                }
            },
            'ACCEPT': (msg) => {
                const { ballot, val } = msg.payload;
                if (ballot >= this.machine.promised) {
                    this.machine.promised = ballot;
                    this.machine.acceptedBallot = ballot;
                    this.machine.acceptedVal = val;
                    sendMessage(msg.from, { type: 'ACCEPTED', ballot, val }, 'green');
                    this.transition('accepted', false); // stay/re-enter Accepted
                } else {
                    sendMessage(msg.from, { type: 'NACK', ballot: this.machine.promised }, 'red');
                }
            }
        };
    }
}

class AcceptorMachine extends Machine {
    constructor() {
        super();
        this.promised = 0;
        this.acceptedBallot = 0;
        this.acceptedVal = null;
        this.states = [new Ready(), new Promised(), new Accepted()];
    }
}

const MACHINE = new AcceptorMachine();

function onUp() { MACHINE.onUp(); }
function onTimer(t) { MACHINE.onTimer(t); }
function onMessage(m) { MACHINE.onMessage(m); }
