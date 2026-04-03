// Three-Phase Commit (3PC) — Coordinator Role
const CLIENT = 4;
const COHORTS = allServerIds.filter(id => id !== serverId && id !== CLIENT);

class Idle extends State {
    getState() { return ['idle', '#cfd8dc']; }
    canTransition() { return ['voting']; }
    registerMessageTypes() {
        return {
            'CLIENT_TX_START': (msg) => {
                const { txId, val } = msg.payload;
                this.machine.txId = txId;
                this.machine.val = val;
                this.machine.votes = [];
                this.machine.acks = [];
                broadcast(COHORTS, { type: 'CAN_COMMIT', txId, val }, 'orange', true);
                this.transition('voting');
            }
        };
    }
}

class Voting extends State {
    getState() { return ['voting', '#ffe082']; }
    canTransition() { return ['pre-committing', 'abort']; }
    onEnter() {
        this.setTimeout(18, 'onVoteTimeout');
    }
    onVoteTimeout() {
        const txId = this.machine.txId;
        broadcast(COHORTS, { type: 'DO_ABORT', txId }, 'red', true);
        this.machine.history.push(`TX${txId}:abort`); // Trigger render.js
        this.transition('abort');
    }
    registerMessageTypes() {
        return {
            'VOTE_YES': (msg) => {
                const { txId } = msg.payload;
                if (txId !== this.machine.txId) return;

                if (!this.machine.votes.includes(msg.from)) {
                    this.machine.votes.push(msg.from);
                }

                if (this.machine.votes.length === COHORTS.length) {
                    broadcast(COHORTS, { type: 'PRE_COMMIT', txId }, 'blue', true);
                    this.transition('pre-committing');
                }
            },
            'VOTE_NO': (msg) => {
                const { txId } = msg.payload;
                if (txId !== this.machine.txId) return;

                broadcast(COHORTS, { type: 'DO_ABORT', txId }, 'red', true);
                this.machine.history.push(`TX${txId}:abort`); // Trigger render.js
                this.transition('abort');
            }
        };
    }
}

class PreCommitting extends State {
    get name() { return 'pre-committing'; }
    getState() { return ['pre-committing', '#90caf9']; }
    canTransition() { return ['commit']; }
    onEnter() {
        this.setTimeout(18, 'onAckTimeout');
    }
    onAckTimeout() {
        const txId = this.machine.txId;
        broadcast(COHORTS, { type: 'DO_COMMIT', txId }, 'green', true);
        this.machine.history.push(`TX${txId}:commit`); // Trigger render.js
        this.transition('commit');
    }
    registerMessageTypes() {
        return {
            'ACK_PRE_COMMIT': (msg) => {
                const { txId } = msg.payload;
                if (txId !== this.machine.txId) return;

                if (!this.machine.acks.includes(msg.from)) {
                    this.machine.acks.push(msg.from);
                }

                if (this.machine.acks.length === COHORTS.length) {
                    broadcast(COHORTS, { type: 'DO_COMMIT', txId }, 'green', true);
                    this.machine.history.push(`TX${txId}:commit`); // Trigger render.js
                    this.transition('commit');
                }
            }
        };
    }
}

class Commit extends State {
    getState() { return ['commit', '#81c784']; }
    canTransition() { return ['idle']; }
    onEnter() {
        this.setTimeout(5, 'onCleanup');
    }
    onCleanup() {
        this.transition('idle');
    }
}

class Abort extends State {
    getState() { return ['abort', '#e57373']; }
    canTransition() { return ['idle']; }
    onEnter() {
        this.setTimeout(5, 'onCleanup');
    }
    onCleanup() {
        this.transition('idle');
    }
}

class CoordinatorMachine extends Machine {
    constructor() {
        super();
        this.states = [new Idle(), new Voting(), new PreCommitting(), new Commit(), new Abort()];
        this.txId = null;
        this.val = null;
        this.votes = [];
        this.acks = [];
        this.history = [];
    }
    onUp() {
        super.onUp();
        // Coordinator recovered while in-flight transaction existed
        if (['voting', 'pre-committing'].includes(this._automat.stateName)) {
            // Coordinator recovery immediately triggers timeout to safely fallback
            if (this._automat.current && typeof this._automat.current.onAckTimeout === 'function') {
                this._automat.current.onAckTimeout();
            } else if (this._automat.current && typeof this._automat.current.onVoteTimeout === 'function') {
                this._automat.current.onVoteTimeout();
            }
        }
    }
}

const MACHINE = new CoordinatorMachine();

function onUp() { MACHINE.onUp(); }
function onTimer(t) { MACHINE.onTimer(t); }
function onMessage(m) { MACHINE.onMessage(m); }
