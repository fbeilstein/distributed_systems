class ParticipantMachine extends Machine {
    constructor() {
        super();
        this.states = [new Ready(), new PVotedCommit(), new PVotedAbort(), new PFallback(), new PPermanentlyBlocked()];
        this.data = null;
        this.pendingTx = null;
        this.pendingData = null;
        this.history = [];
        this.peerStates = {};
        this.currentTick = 0;
    }
    onTimer(t) { this.currentTick = t; super.onTimer(t); }
}

class BaseParticipantState extends State {
    onMessage(m) {
        const handler = `on${m.payload.type}`;
        if (typeof this[handler] === 'function') this[handler](m);
    }
    onSTATE_REQUEST(m) {
        const txId = m.payload.txId;
        const sName = this.name;
        if (this.machine.history.includes(`TX${txId}:commit`)) {
            sendMessage(m.from, { type: 'STATE_COMMIT', txId: txId });
        } else if (this.machine.history.some(h => h.startsWith(`TX${txId}:abort`))) {
            sendMessage(m.from, { type: 'STATE_ABORT', txId: txId });
        } else if (sName === 'PVotedAbort') {
            sendMessage(m.from, { type: 'STATE_ABORT', txId: txId });
        } else if (sName === 'Ready') {
            this.machine.history.push(`TX${txId}:abort`);
            sendMessage(m.from, { type: 'STATE_ABORT', txId: txId });
        } else {
            sendMessage(m.from, { type: 'STATE_VOTED_COMMIT', txId: txId });
        }
    }
}

class Ready extends BaseParticipantState {
    getUI() { return ['ready', '#b2dfdb']; }
    canTransition() { return ['PVotedCommit', 'PVotedAbort']; }
    onPREPARE(m) {
        this.machine.pendingTx = m.payload.txId;
        this.machine.pendingData = m.payload.data;
        if (serverId === 2 && typeof m.payload.data === 'number' && m.payload.data % 2 === 0) {
            sendMessage(m.from, { type: 'VOTE_ABORT', txId: m.payload.txId }, 'red');
            this.transition('PVotedAbort');
        } else {
            sendMessage(m.from, { type: 'VOTE_COMMIT', txId: m.payload.txId }, 'green');
            this.transition('PVotedCommit');
        }
    }
}

class PVotedCommit extends BaseParticipantState {
    getUI() { return ['voted_commit', '#4db6ac']; }
    canTransition() { return ['Ready', 'PFallback']; }
    onEnter() { this.setTimeout(30, 'onTimeout', 't'); }
    onCOMMIT(m) {
        if (m.payload.txId !== this.machine.pendingTx) return;
        this.machine.data = this.machine.pendingData;
        this.machine.history.push(`TX${m.payload.txId}:commit`);
        this.machine.pendingTx = null;
        this.transition('Ready');
    }
    onABORT(m) {
        if (m.payload.txId !== this.machine.pendingTx) return;
        this.machine.history.push(`TX${m.payload.txId}:abort`);
        this.machine.pendingTx = null;
        this.transition('Ready');
    }
    onTimeout() { this.transition('PFallback'); }
}

class PVotedAbort extends BaseParticipantState {
    getUI() { return ['voted_abort', '#ef9a9a']; }
    canTransition() { return ['Ready']; }
    onEnter() {
        this.machine.history.push(`TX${this.machine.pendingTx}:abort`);
        this.setTimeout(10, 'cleanup', 'c');
    }
    cleanup() { this.machine.pendingTx = null; this.transition('Ready'); }
    onABORT(m) { this.machine.pendingTx = null; this.transition('Ready'); }
}

class PFallback extends BaseParticipantState {
    getUI() { return ['fallback', '#ffb74d']; }
    canTransition() { return ['Ready', 'PPermanentlyBlocked']; }
    onEnter() { this.pollPeers(); }
    pollPeers() {
        this.machine.peerStates = {};
        const peers = allServerIds.filter(id => id !== serverId && id !== 0 && id !== 4);
        peers.forEach(p => sendMessage(p, { type: 'STATE_REQUEST', txId: this.machine.pendingTx }, 'orange'));
        this.setTimeout(15, 'pollPeers', 'p');
    }
    onSTATE_COMMIT(m) {
        this.machine.data = this.machine.pendingData;
        this.machine.history.push(`TX${this.machine.pendingTx}:commit`);
        this.machine.pendingTx = null;
        this.transition('Ready');
    }
    onSTATE_ABORT(m) {
        this.machine.history.push(`TX${this.machine.pendingTx}:abort`);
        this.machine.pendingTx = null;
        this.transition('Ready');
    }
    onSTATE_VOTED_COMMIT(m) {
        this.machine.peerStates[m.from] = 'voted_commit';
        const otherCohorts = allServerIds.filter(id => id !== serverId && id !== 0 && id !== 4);
        if (otherCohorts.length > 0 && otherCohorts.every(p => this.machine.peerStates[p] === 'voted_commit')) {
            this.transition('PPermanentlyBlocked');
        }
    }
    onCOMMIT(m) { this.onSTATE_COMMIT(m); }
    onABORT(m) { this.onSTATE_ABORT(m); }
}

class PPermanentlyBlocked extends BaseParticipantState {
    getUI() { return ['permanently_blocked', '#9e9e9e']; }
    canTransition() { return ['Ready']; }
    onCOMMIT(m) {
        this.machine.data = this.machine.pendingData;
        this.machine.history.push(`TX${m.payload.txId}:commit`);
        this.machine.pendingTx = null;
        this.transition('Ready');
    }
    onABORT(m) {
        this.machine.history.push(`TX${m.payload.txId}:abort`);
        this.machine.pendingTx = null;
        this.transition('Ready');
    }
}

// --- BOOTSTRAP ---
const M = new ParticipantMachine();
function onUp() { M.onUp(); }
function onTimer(t) { M.onTimer(t); }
function onMessage(m) { M.onMessage(m); }
