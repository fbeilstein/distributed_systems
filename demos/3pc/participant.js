// Three-Phase Commit (3PC) — Participant (Cohort) Role
const COORDINATOR = 0;
const CLIENT = 4;
const PEERS = allServerIds.filter(id => id !== COORDINATOR && id !== serverId && id !== CLIENT);

class Idle extends State {
    getState() { return ['idle', '#cfd8dc']; }
    canTransition() { return ['ready', 'abort']; }
    registerMessageTypes() {
        return {
            'CAN_COMMIT': (msg) => {
                const { txId, val } = msg.payload;
                this.machine.txId = txId;
                this.machine.val = val;

                // DB-2 conditionally aborts even transactions to exercise the abort flow
                if (serverId === 2 && txId % 2 === 0) {
                    sendMessage(COORDINATOR, { type: 'VOTE_NO', txId }, 'red');
                    this.machine.history.push(`TX${txId}:abort`); // Trigger render.js ❌
                    this.transition('abort');
                } else {
                    sendMessage(COORDINATOR, { type: 'VOTE_YES', txId }, 'green');
                    this.transition('ready');
                }
            }
        };
    }
}

class Ready extends State {
    getState() { return ['ready', '#fff59d']; }
    canTransition() { return ['pre-committed', 'commit', 'abort']; }
    onEnter() {
        this.setTimeout(25, 'onCoordinatorTimeout');
    }
    onCoordinatorTimeout() {
        // Autonomous Auto-Abort! Timed out before PRE_COMMIT.
        this.machine.history.push(`TX${this.machine.txId}:abort (autonomous)`);
        this.transition('abort');
    }
    registerMessageTypes() {
        return {
            'PRE_COMMIT': (msg) => {
                sendMessage(COORDINATOR, { type: 'ACK_PRE_COMMIT', txId: this.machine.txId }, 'blue');
                this.transition('pre-committed');
            },
            'DO_COMMIT': (msg) => {
                this.machine.history.push(`TX${this.machine.txId}:commit`);
                this.transition('commit');
            },
            'DO_ABORT': (msg) => {
                this.machine.history.push(`TX${this.machine.txId}:abort`);
                this.transition('abort');
            }
        };
    }
}

class PreCommitted extends State {
    get name() { return 'pre-committed'; }
    getState() { return ['pre-committed', '#90caf9']; }
    canTransition() { return ['commit', 'abort']; }
    onEnter() {
        this.setTimeout(25, 'onCoordinatorTimeout');
    }
    onCoordinatorTimeout() {
        // Autonomous Auto-Commit! At least one node reached prepared.
        this.machine.history.push(`TX${this.machine.txId}:commit (autonomous)`);
        this.transition('commit');
    }
    registerMessageTypes() {
        return {
            'DO_COMMIT': (msg) => {
                this.machine.history.push(`TX${this.machine.txId}:commit`);
                this.transition('commit');
            },
            'DO_ABORT': (msg) => {
                this.machine.history.push(`TX${this.machine.txId}:abort`);
                this.transition('abort');
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

class ParticipantMachine extends Machine {
    constructor() {
        super();
        this.states = [new Idle(), new Ready(), new PreCommitted(), new Commit(), new Abort()];
        this.txId = null;
        this.val = null;
        this.history = [];
    }
}

const MACHINE = new ParticipantMachine();

function onUp() { MACHINE.onUp(); }
function onTimer(t) { MACHINE.onTimer(t); }
function onMessage(m) { MACHINE.onMessage(m); }
