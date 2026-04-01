// RIFL — Reusable Infrastructure for Linearizability (Server Node)
// Deduplicates client requests using completion records.

const CLIENT_IDS = [1, 2];

class LinearizableServer extends State {
    get name() { return 'server: ready'; }
    getState() { return ['server: ready', '#cfd8dc']; }
    registerMessageTypes() {
        return {
            'WRITE_RPC': (msg) => {
                const { cid, seq, val } = msg.payload;
                if (!this.machine.completions[cid]) this.machine.completions[cid] = 0;

                if (seq <= this.machine.completions[cid]) {
                    // Duplicate!
                    sendMessage(cid, { type: 'ACK', seq, status: 'CACHED' }, 'orange');
                } else {
                    this.machine.data = val;
                    this.machine.completions[cid] = seq;
                    sendMessage(cid, { type: 'ACK', seq, status: 'SUCCESS' }, 'green');
                    this.transition(val === 'A' ? 'state: A' : 'state: B');
                }
            }
        };
    }
}

class StateA extends State {
    get name() { return 'state: A'; }
    getState() { return ['state: A', '#81c784']; }
    registerMessageTypes() {
        return {
            'WRITE_RPC': (msg) => {
                const { cid, seq, val } = msg.payload;
                if (!this.machine.completions[cid]) this.machine.completions[cid] = 0;
                if (seq <= this.machine.completions[cid]) {
                    sendMessage(cid, { type: 'ACK', seq, status: 'CACHED' }, 'orange');
                } else {
                    this.machine.data = val;
                    this.machine.completions[cid] = seq;
                    sendMessage(cid, { type: 'ACK', seq, status: 'SUCCESS' }, 'green');
                    this.transition(val === 'A' ? 'state: A' : 'state: B');
                }
            }
        };
    }
}

class StateB extends State {
    get name() { return 'state: B'; }
    getState() { return ['state: B', '#ffb74d']; }
    registerMessageTypes() {
        return {
            'WRITE_RPC': (msg) => {
                const { cid, seq, val } = msg.payload;
                if (!this.machine.completions[cid]) this.machine.completions[cid] = 0;
                if (seq <= this.machine.completions[cid]) {
                    sendMessage(cid, { type: 'ACK', seq, status: 'CACHED' }, 'orange');
                } else {
                    this.machine.data = val;
                    this.machine.completions[cid] = seq;
                    sendMessage(cid, { type: 'ACK', seq, status: 'SUCCESS' }, 'green');
                    this.transition(val === 'A' ? 'state: A' : 'state: B');
                }
            }
        };
    }
}

class RIFLMachine extends Machine {
    constructor() {
        super();
        this.states = [new LinearizableServer(), new StateA(), new StateB()];
        this.completions = {};
        this.data = null;
    }
}

const MACHINE = new RIFLMachine();

function onUp() { MACHINE.onUp(); }
function onTimer(t) { MACHINE.onTimer(t); }
function onMessage(m) { MACHINE.onMessage(m); }
