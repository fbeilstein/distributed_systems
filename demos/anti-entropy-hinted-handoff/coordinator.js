// Anti-Entropy (Hinted Handoff) — Coordinator
// Implements Hinted Handoff and Read Repair for eventual consistency.

class CoordinatorMachine extends Machine {
    constructor() {
        super();
        this.states = [new Idle(), new Writing(), new Reading(), new Repairing(), new HasHints()];
        this.db = { x: { val: 10, v: 1 }, y: { val: 20, v: 1 } };
        this.pendingHints = {}; // replicaId -> { val, v }
        this.waitingAcks = {};
        this.readReplies = {};
    }

    syncUI() {
        this.database = Object.entries(this.db).map(([k, o]) => `${k}:${o.val}(v${o.v})`).join(', ');
        const hints = Object.keys(this.pendingHints);
        this.hints = hints.length > 0 ? `To: ${hints.map(id => 'Node-' + id).join(', ')}` : 'None';
    }

    // Common recovery logic for all states (naming convention)
    onRECOVERY_NOTICE(msg) {
        const rid = msg.payload.replicaId;
        const hint = this.pendingHints[rid];
        if (hint) {
            sendMessage(rid, { type: 'WRITE', ...hint, hinted: true }, '#f44336');
            delete this.pendingHints[rid];
            if (Object.keys(this.pendingHints).length === 0 && this.automat.state === 'HasHints') {
                this.transition('Idle');
            }
        }
    }
}

class CoordinatorState extends State {
    onUp() { this.transition('Idle'); }

    onTimer(tick) {
        if (tick === 10) this.transition('Writing');
        if (tick === 40) this.transition('Reading');
        if (tick === 65) {
            this.machine.db.x = { val: 15, v: 2 }; // Update V2
            this.transition('Writing');
        }
    }

    finish() {
        if (Object.keys(this.machine.pendingHints).length > 0) this.transition('HasHints');
        else this.transition('Idle');
    }
}

class Idle extends CoordinatorState {
    getUI() { return ['Idle', '#cfd8dc']; }
    canTransition() { return ['Writing', 'Reading', 'HasHints']; }
}

class Writing extends CoordinatorState {
    getUI() { return ['Writing', '#ffb74d']; }
    canTransition() { return ['HasHints', 'Idle']; }

    onEnter() {
        const replicas = allServerIds.filter(id => id !== serverId);
        this.machine.waitingAcks = {};
        for (const id of replicas) {
            this.machine.waitingAcks[id] = true;
            sendMessage(id, { type: 'WRITE', ...this.machine.db.x }, '#ffb74d');
        }
        this.setTimeout(15, 'onAckTimeout', 'ack');
    }

    onWRITE_ACK(msg) {
        delete this.machine.waitingAcks[msg.from];
        if (Object.keys(this.machine.waitingAcks).length === 0) this.finish();
    }

    onAckTimeout() {
        for (const id in this.machine.waitingAcks) {
            this.machine.pendingHints[id] = { ...this.machine.db.x };
        }
        this.machine.waitingAcks = {};
        this.finish();
    }
}

class Reading extends CoordinatorState {
    getUI() { return ['Reading', '#4fc3f7']; }
    canTransition() { return ['Repairing', 'HasHints', 'Idle']; }

    onEnter() {
        const replicas = allServerIds.filter(id => id !== serverId);
        this.machine.readReplies = {};
        for (const id of replicas) {
            sendMessage(id, { type: 'READ_REQ' }, '#4fc3f7');
        }
        this.setTimeout(10, 'onReadTimeout', 'read');
    }

    onREAD_REPLY(msg) {
        this.machine.readReplies[msg.from] = msg.payload;
        // Optimization: if we saw a fresh version, we can clear the hint!
        if (msg.payload.v >= this.machine.db.x.v) {
            delete this.machine.pendingHints[msg.from];
        }
    }

    onReadTimeout() {
        const stalers = Object.keys(this.machine.readReplies).filter(id => {
            return this.machine.readReplies[id].v < this.machine.db.x.v;
        });

        if (stalers.length > 0) {
            this.machine.stalers = stalers;
            this.transition('Repairing');
        } else {
            this.finish();
        }
    }
}

class Repairing extends CoordinatorState {
    getUI() { return ['Repairing', '#ab47bc']; }
    canTransition() { return ['HasHints', 'Idle']; }

    onEnter() {
        this.machine.waitingAcks = {};
        for (const id of this.machine.stalers) {
            this.machine.waitingAcks[parseInt(id)] = true;
        }
        this.sendRepairs();
    }

    sendRepairs() {
        for (const id in this.machine.waitingAcks) {
            sendMessage(parseInt(id), { type: 'REPAIR', ...this.machine.db.x }, '#ab47bc');
            delete this.machine.pendingHints[id];
        }
        // Retry every 10 ticks until all ACKed
        this.setTimeout(10, 'onRepairTimeout', 'repair');
    }

    onWRITE_ACK(msg) {
        delete this.machine.waitingAcks[msg.from];
        if (Object.keys(this.machine.waitingAcks).length === 0) {
            this.clearTimeout('repair');
            this.finish();
        }
    }

    onRepairTimeout() {
        this.sendRepairs(); // Still waiting for some ACKs? Retry.
    }
}

class HasHints extends CoordinatorState {
    getUI() { return ['HasHints', '#ef5350']; }
    canTransition() { return ['Idle', 'Writing', 'Reading']; }
}

const M = new CoordinatorMachine();
function onUp() { M.onUp(); }
function onTimer(t) { M.onTimer(t); }
function onMessage(m) { M.onMessage(m); }
