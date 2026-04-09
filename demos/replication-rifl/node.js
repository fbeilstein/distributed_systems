// RIFL — Reusable Infrastructure for Linearizability (Server Node)
// Deduplicates client requests using completion records.

const CLIENT_IDS = [1, 2];

class LinearizableServer extends State {
    getUI() { return ['server: ready', '#cfd8dc']; }
    canTransition() { return ['StateA', 'StateB']; }
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
                    this.transition(val === 'A' ? 'StateA' : 'StateB');
                }
            }
        };
    }
}

class StateA extends State {
    getUI() { return ['state: A', '#81c784']; }
    canTransition() { return ['StateA', 'StateB']; }
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
                    this.transition(val === 'A' ? 'StateA' : 'StateB');
                }
            }
        };
    }
}

class StateB extends State {
    getUI() { return ['state: B', '#ffb74d']; }
    canTransition() { return ['StateA', 'StateB']; }
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
                    this.transition(val === 'A' ? 'StateA' : 'StateB');
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
