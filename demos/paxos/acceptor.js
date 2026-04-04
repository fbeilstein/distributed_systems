// Paxos (Single Degree) — Acceptor Role

function processPrepare(msg) {
    const { ballot } = msg.payload;
    const m = this.machine;
    if (ballot > m.promised) {
        m.promised = ballot;
        sendMessage(msg.from, {
            type: 'PROMISE',
            prevBallot: m.acceptedBallot,
            prevVal: m.acceptedVal
        }, 'green');
    } else {
        sendMessage(msg.from, { type: 'NACK', ballot: m.promised }, 'red');
    }
}

function processAccept(msg) {
    const { ballot, val } = msg.payload;
    const m = this.machine;
    if (ballot >= m.promised) {
        m.promised = ballot;
        m.acceptedBallot = ballot;
        m.acceptedVal = val;
        sendMessage(msg.from, { type: 'ACCEPTED', ballot, val }, 'green');
        this.transition('accepted');
    } else {
        sendMessage(msg.from, { type: 'NACK', ballot: m.promised }, 'red');
    }
}

class Ready extends State {
    getState() { return ['ready', '#cfd8dc']; }
    canTransition() { return ['accepted']; }
    registerMessageTypes() {
        return {
            'PREPARE': processPrepare,
            'ACCEPT': processAccept
        };
    }
}

class Accepted extends State {
    getState() { return ['accepted', '#81c784']; }
    registerMessageTypes() {
        return {
            'PREPARE': processPrepare,
            'ACCEPT': processAccept
        };
    }
}

class AcceptorMachine extends Machine {
    constructor() {
        super();
        this.promised = 0;
        this.acceptedBallot = 0;
        this.acceptedVal = null;
        this.states = [new Ready(), new Accepted()];
    }
}

const MACHINE = new AcceptorMachine();

function onUp() { MACHINE.onUp(); }
function onTimer(t) { MACHINE.onTimer(t); }
function onMessage(m) { MACHINE.onMessage(m); }
