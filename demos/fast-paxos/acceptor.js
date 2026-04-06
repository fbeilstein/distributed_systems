// Fast Paxos — Acceptor Role

class BaseAcceptorState extends State {
    registerMessageTypes() {
        return {
            'FAST_ACCEPT': (msg) => {
                const { val } = msg.payload;

                if (this.machine.promised > 0) {
                    sendMessage(msg.from, { type: 'NACK', reason: 'classic_active' }, 'red');
                    return;
                }

                if (this.machine.acceptedVal === null || this.machine.acceptedVal === val) {
                    this.machine.acceptedVal = val;
                    this.machine.acceptedBallot = 0; // 0 designates Fast Round
                    sendMessage(msg.from, { type: 'ACCEPTED', ballot: 0, val }, 'green');
                    this.transition('accepted', false);
                } else {
                    // COLLISION! Return an explicit NACK.
                    sendMessage(msg.from, { type: 'NACK', reason: 'collision' }, 'orange');
                }
            },
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

class Ready extends BaseAcceptorState {
    getState() { return ['ready', '#cfd8dc']; }
    canTransition() { return ['promised', 'accepted']; }
}

class Promised extends BaseAcceptorState {
    getState() {
        let label = `P:${this.machine.promised}`;
        if (this.machine.acceptedVal !== null) label += ` (v:${this.machine.acceptedVal})`;
        return [label, '#ffe082'];
    }
    canTransition() { return ['promised', 'accepted']; }
}

class Accepted extends BaseAcceptorState {
    getState() {
        const val = this.machine.acceptedVal !== null ? this.machine.acceptedVal : '-';
        const bal = this.machine.acceptedBallot === 0 ? 'FAST' : this.machine.acceptedBallot;
        return [`A:${bal}:${val}`, '#81c784'];
    }
    canTransition() { return ['promised', 'accepted']; }
}

class AcceptorMachine extends Machine {
    constructor() {
        super();
        this.promised = 0;
        this.acceptedBallot = -1;
        this.acceptedVal = null;
        this.states = [new Ready(), new Promised(), new Accepted()];
    }
}

const MACHINE = new AcceptorMachine();
function onUp() { MACHINE.onUp(); }
function onTimer(t) { MACHINE.onTimer(t); }
function onMessage(m) { MACHINE.onMessage(m); }