// RIFL Client Role — Exactly-Once Semantics Retry
const SERVER_ID = 0;
const RETRY_TIMEOUT = 30;

class RIFL_Client extends State {
    get name() { return 'client: idle'; }
    getState() { return ['client: idle', '#cfd8dc']; }
    onEnter() {
        this.machine.started = false;
        this.machine.seq = 1;
        this.machine.val = (serverId === 1 ? 'A' : 'B');
    }
    onTimer(t) {
        if (!this.machine.started && t >= (serverId === 1 ? 10 : 35)) {
            this.machine.started = true;
            this.sendRequest(t);
        }
        if (this.machine.pendingAt && t - this.machine.pendingAt >= RETRY_TIMEOUT) {
            this.sendRequest(t);
        }
    }
    sendRequest(t) {
        sendMessage(SERVER_ID, { type: 'WRITE_RPC', cid: serverId, seq: this.machine.seq, val: this.machine.val }, 'blue');
        this.machine.pendingAt = t;
        this.transition('client: waiting');
    }
    registerMessageTypes() {
        return {
            'ACK': (msg) => {
                if (msg.payload.seq === this.machine.seq) {
                    this.machine.pendingAt = null;
                    this.transition(msg.payload.status === 'CACHED' ? 'client: DONE (CACHED)' : 'client: DONE');
                }
            }
        };
    }
}

class Waiting extends State {
    get name() { return 'client: waiting'; }
    getState() { return ['client: waiting', '#fff59d']; }
    onTimer(t) {
        if (this.machine.pendingAt && t - this.machine.pendingAt >= RETRY_TIMEOUT) {
            sendMessage(SERVER_ID, { type: 'WRITE_RPC', cid: serverId, seq: this.machine.seq, val: this.machine.val }, 'blue');
            this.machine.pendingAt = t;
        }
    }
    registerMessageTypes() {
        return {
            'ACK': (msg) => {
                if (msg.payload.seq === this.machine.seq) {
                    this.machine.pendingAt = null;
                    this.transition(msg.payload.status === 'CACHED' ? 'client: DONE (CACHED)' : 'client: DONE');
                }
            }
        };
    }
}

class Done extends State {
    get name() { return 'client: DONE'; }
    getState() { return ['client: DONE', '#4caf50']; }
}

class DoneCached extends State {
    get name() { return 'client: DONE (CACHED)'; }
    getState() { return ['client: DONE (CACHED)', '#4fc3f7']; }
}

class RIFLClientMachine extends Machine {
    constructor() {
        super();
        this.states = [new RIFL_Client(), new Waiting(), new Done(), new DoneCached()];
        this.started = false;
        this.seq = 1;
        this.val = (serverId === 1 ? 'A' : 'B');
        this.pendingAt = null;
    }
}

const MACHINE = new RIFLClientMachine();

function onUp() { MACHINE.onUp(); }
function onTimer(t) { MACHINE.onTimer(t); }
function onMessage(m) { MACHINE.onMessage(m); }
