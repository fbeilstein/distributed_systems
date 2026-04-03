// Anti-Entropy (Hinted Handoff) — Replica
// Responds to coordinator requests and reports recovery for Hint Handoff.

class ReplicaMachine extends Machine {
    constructor() {
        super();
        this.states = [new V0(), new V1(), new V2()];
        this.v = 0;
        this.val = null;
    }

    onUp() {
        super.onUp();
        if (this.v > 0) {
            // Report recovery to coordinator (Node-0) to trigger Hint Handoff
            sendMessage(0, { type: 'RECOVERY_NOTICE', replicaId: serverId }, '#9c27b0');
        }
    }

    syncUI() {
        this.database = this.v > 0 ? `val:${this.val}(v${this.v})` : 'Empty';
    }
}

class ReplicaState extends State {
    onWRITE(msg) { this.update(msg); }
    onREPAIR(msg) { this.update(msg); }

    onREAD_REQ(msg) {
        sendMessage(msg.from, { type: 'READ_REPLY', v: this.machine.v, val: this.machine.val }, '#4fc3f7');
    }

    update(msg) {
        const p = msg.payload;
        if (p.v > this.machine.v) {
            this.machine.v = p.v;
            this.machine.val = p.val;
            this.transition('V' + p.v, false);
        }
        sendMessage(msg.from, { type: 'WRITE_ACK' }, '#81c784');
    }
}

class V0 extends ReplicaState {
    getState() { return ['V0', '#cfd8dc']; }
    canTransition() { return ['V1', 'V2']; }
}

class V1 extends ReplicaState {
    getState() { return ['V1', '#81c784']; }
    canTransition() { return ['V2']; }
}

class V2 extends ReplicaState {
    getState() { return ['V2', '#2e7d32']; }
    canTransition() { return []; }
}

const M = new ReplicaMachine();
function onUp() { M.onUp(); }
function onTimer(t) { M.onTimer(t); }
function onMessage(m) { M.onMessage(m); }
