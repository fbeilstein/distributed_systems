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
        const sName = this.getState()[0];
        if (this.machine.history.includes(`TX${txId}:commit`)) {
            sendMessage(m.from, { type: 'STATE_COMMIT', txId: txId });
        } else if (this.machine.history.some(h => h.startsWith(`TX${txId}:abort`))) {
            sendMessage(m.from, { type: 'STATE_ABORT', txId: txId });
        } else if (sName === 'voted_abort') {
            sendMessage(m.from, { type: 'STATE_ABORT', txId: txId });
        } else if (sName === 'ready') {
            this.machine.history.push(`TX${txId}:abort`);
            sendMessage(m.from, { type: 'STATE_ABORT', txId: txId });
        } else {
            sendMessage(m.from, { type: 'STATE_VOTED_COMMIT', txId: txId });
        }
    }
}

class Ready extends BaseParticipantState {
    getState() { return ['ready', '#b2dfdb']; }
    canTransition() { return ['voted_commit', 'voted_abort']; }
    onPREPARE(m) {
        this.machine.pendingTx = m.payload.txId;
        this.machine.pendingData = m.payload.data;
        if (serverId === 2 && typeof m.payload.data === 'number' && m.payload.data % 2 === 0) {
            sendMessage(m.from, { type: 'VOTE_ABORT', txId: m.payload.txId }, 'red');
            this.transition('voted_abort');
        } else {
            sendMessage(m.from, { type: 'VOTE_COMMIT', txId: m.payload.txId }, 'green');
            this.transition('voted_commit');
        }
    }
}

class PVotedCommit extends BaseParticipantState {
    getState() { return ['voted_commit', '#4db6ac']; }
    canTransition() { return ['ready', 'fallback']; }
    onEnter() { this.setTimeout(30, 'onTimeout', 't'); }
    onCOMMIT(m) {
        if (m.payload.txId !== this.machine.pendingTx) return;
        this.machine.data = this.machine.pendingData;
        this.machine.history.push(`TX${m.payload.txId}:commit`);
        this.machine.pendingTx = null;
        this.transition('ready');
    }
    onABORT(m) {
        if (m.payload.txId !== this.machine.pendingTx) return;
        this.machine.history.push(`TX${m.payload.txId}:abort`);
        this.machine.pendingTx = null;
        this.transition('ready');
    }
    onTimeout() { this.transition('fallback'); }
}

class PVotedAbort extends BaseParticipantState {
    getState() { return ['voted_abort', '#ef9a9a']; }
    canTransition() { return ['ready']; }
    onEnter() {
        this.machine.history.push(`TX${this.machine.pendingTx}:abort`);
        this.setTimeout(10, 'cleanup', 'c');
    }
    cleanup() { this.machine.pendingTx = null; this.transition('ready'); }
    onABORT(m) { this.machine.pendingTx = null; this.transition('ready'); }
}

class PFallback extends BaseParticipantState {
    getState() { return ['fallback', '#ffb74d']; }
    canTransition() { return ['ready', 'permanently_blocked']; }
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
        this.transition('ready');
    }
    onSTATE_ABORT(m) {
        this.machine.history.push(`TX${this.machine.pendingTx}:abort`);
        this.machine.pendingTx = null;
        this.transition('ready');
    }
    onSTATE_VOTED_COMMIT(m) {
        this.machine.peerStates[m.from] = 'voted_commit';
        const otherCohorts = allServerIds.filter(id => id !== serverId && id !== 0 && id !== 4);
        if (otherCohorts.length > 0 && otherCohorts.every(p => this.machine.peerStates[p] === 'voted_commit')) {
            this.transition('permanently_blocked');
        }
    }
    onCOMMIT(m) { this.onSTATE_COMMIT(m); }
    onABORT(m) { this.onSTATE_ABORT(m); }
}

class PPermanentlyBlocked extends BaseParticipantState {
    getState() { return ['permanently_blocked', '#9e9e9e']; }
    canTransition() { return ['ready']; }
    onCOMMIT(m) {
        this.machine.data = this.machine.pendingData;
        this.machine.history.push(`TX${m.payload.txId}:commit`);
        this.machine.pendingTx = null;
        this.transition('ready');
    }
    onABORT(m) {
        this.machine.history.push(`TX${m.payload.txId}:abort`);
        this.machine.pendingTx = null;
        this.transition('ready');
    }
}

// --- BOOTSTRAP ---
const M = new ParticipantMachine();
function onUp() { M.onUp(); }
function onTimer(t) { M.onTimer(t); }
function onMessage(m) { M.onMessage(m); }
