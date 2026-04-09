const COORDINATOR_ID = 0;
const CLIENT_ID = 4;
const DB_IDS = allServerIds.filter(id => id !== COORDINATOR_ID && id !== CLIENT_ID);


class CoordinatorMachine extends Machine {
    constructor() {
        super();
        this.states = [new Idle(), new Prepare(), new Collecting(), new Committing(), new Aborting()];
        this.txId = 0;
        this.votes = {};
        this.history = [];
        this.outbox = [];
        this.cohorts = DB_IDS;
        this.currentTick = 0;
    }
    onTimer(t) { this.currentTick = t; super.onTimer(t); }
}

class BaseCoordinatorState extends State {
    onMessage(m) {
        const handler = `on${m.payload.type}`;
        if (typeof this[handler] === 'function') this[handler](m);
    }
    onDECISION_REQUEST(m) {
        const txId = m.payload.txId;
        if (this.machine.history.includes(`TX${txId}:commit`)) {
            sendMessage(m.from, { type: 'COMMIT', txId: txId }, 'green');
        } else if (this.machine.history.includes(`TX${txId}:abort`)) {
            sendMessage(m.from, { type: 'ABORT', txId: txId }, 'red');
        }
    }
}

class Idle extends BaseCoordinatorState {
    getUI() { return ['idle', '#8bc34a']; }
    canTransition() { return ['Prepare']; }
    onCLIENT_TX_START(m) { this.startTx(m.payload.txId, m.payload.val); }
    startTx(txId, data) {
        this.machine.txId = txId;
        this.machine.votes = {};
        this.machine.outbox = this.machine.cohorts.map(id => ({
            to: id,
            msg: { type: 'PREPARE', txId: txId, data: data }
        }));
        this.transition('Prepare');
    }
}

class Prepare extends BaseCoordinatorState {
    getUI() { return ['prepare', '#ffc107']; }
    canTransition() { return ['Collecting']; }
    onEnter() { this.setTimeout(2, 'sendNext', 'p'); }
    sendNext() {
        if (this.machine.outbox.length > 0) {
            const next = this.machine.outbox.pop();
            sendMessage(next.to, next.msg, 'orange');
            this.setTimeout(2, 'sendNext', 'p');
        } else {
            this.transition('Collecting');
        }
    }
}

class Collecting extends BaseCoordinatorState {
    getUI() { return ['collecting', '#ff9800']; }
    canTransition() { return ['Committing', 'Aborting']; }
    onEnter() { this.setTimeout(15, 'onTimeout', 't'); }
    onVOTE_COMMIT(m) {
        if (m.payload.txId !== this.machine.txId) return;
        this.machine.votes[m.from] = 'commit';
        this.checkVotes();
    }
    onVOTE_ABORT(m) {
        if (m.payload.txId !== this.machine.txId) return;
        this.machine.history.push(`TX${this.machine.txId}:abort`);
        this.machine.outbox = this.machine.cohorts.map(id => ({ to: id, msg: { type: 'ABORT', txId: this.machine.txId } }));
        this.transition('Aborting');
    }
    onTimeout() {
        this.machine.history.push(`TX${this.machine.txId}:abort`);
        this.machine.outbox = this.machine.cohorts.map(id => ({ to: id, msg: { type: 'ABORT', txId: this.machine.txId } }));
        this.transition('Aborting');
    }
    checkVotes() {
        const allVoted = this.machine.cohorts.every(id => this.machine.votes[id] === 'commit');
        if (allVoted) {
            this.machine.history.push(`TX${this.machine.txId}:commit`);
            this.machine.outbox = this.machine.cohorts.map(id => ({ to: id, msg: { type: 'COMMIT', txId: this.machine.txId } }));
            this.transition('Committing');
        }
    }
}

class Committing extends BaseCoordinatorState {
    getUI() { return ['committing', '#2196f3']; }
    canTransition() { return ['Idle']; }
    onEnter() { this.setTimeout(2, 'sendNext', 'c'); }
    sendNext() {
        if (this.machine.outbox.length > 0) {
            const next = this.machine.outbox.pop();
            sendMessage(next.to, next.msg, 'green');
            this.setTimeout(2, 'sendNext', 'c');
        } else {
            this.transition('Idle');
        }
    }
}

class Aborting extends BaseCoordinatorState {
    getUI() { return ['aborting', '#f44336']; }
    canTransition() { return ['Idle']; }
    onEnter() { this.setTimeout(2, 'sendNext', 'a'); }
    sendNext() {
        if (this.machine.outbox.length > 0) {
            const next = this.machine.outbox.pop();
            sendMessage(next.to, next.msg, 'red');
            this.setTimeout(2, 'sendNext', 'a');
        } else {
            this.transition('Idle');
        }
    }
}


// --- BOOTSTRAP ---
const M = new CoordinatorMachine();
function onUp() { M.onUp(); }
function onTimer(t) { M.onTimer(t); }
function onMessage(m) { M.onMessage(m); }
