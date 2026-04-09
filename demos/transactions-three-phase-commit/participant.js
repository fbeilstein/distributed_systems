const COORDINATOR_ID = 0;
const CLIENT_ID = 4;
const PEERS = allServerIds.filter(id => id !== COORDINATOR_ID && id !== serverId && id !== CLIENT_ID);

class Idle extends State {
    getUI() { return ['idle', '#cfd8dc']; }
    canTransition() { return ['Ready', 'Abort']; }
    registerMessageTypes() {
        return {
            'CAN_COMMIT': (msg) => {
                const { txId, val } = msg.payload;
                this.machine.txId = txId;
                this.machine.val = val;

                // DB-2 conditionally aborts even transactions to exercise the abort flow
                if (serverId === 2 && txId % 2 === 0) {
                    sendMessage(COORDINATOR_ID, { type: 'VOTE_NO', txId }, 'red');
                    this.machine.history.push(`TX${txId}:abort`); // Trigger render.js ❌
                    this.transition('Abort');
                } else {
                    sendMessage(COORDINATOR_ID, { type: 'VOTE_YES', txId }, 'green');
                    this.transition('Ready');
                }
            }
        };
    }
}

class Ready extends State {
    getUI() { return ['ready', '#fff59d']; }
    canTransition() { return ['Prepared', 'Commit', 'Abort']; }
    onEnter() {
        this.setTimeout(25, 'onCoordinatorTimeout');
    }
    onCoordinatorTimeout() {
        // Autonomous Auto-Abort! Timed out before PRE_COMMIT.
        this.machine.history.push(`TX${this.machine.txId}:abort (autonomous)`);
        this.transition('Abort');
    }
    registerMessageTypes() {
        return {
            'PREPARE': (msg) => {
                sendMessage(COORDINATOR_ID, { type: 'ACK_PREPARE', txId: this.machine.txId }, 'blue');
                this.transition('Prepared');
            },
            'DO_COMMIT': (msg) => {
                this.machine.history.push(`TX${this.machine.txId}:commit`);
                this.transition('Commit');
            },
            'DO_ABORT': (msg) => {
                this.machine.history.push(`TX${this.machine.txId}:abort`);
                this.transition('Abort');
            }
        };
    }
}

class Prepared extends State {
    getUI() { return ['prepared', '#90caf9']; }
    canTransition() { return ['Commit', 'Abort']; }
    onEnter() {
        this.setTimeout(25, 'onCoordinatorTimeout');
    }
    onCoordinatorTimeout() {
        // Autonomous Auto-Commit! At least one node reached prepared.
        this.machine.history.push(`TX${this.machine.txId}:commit (autonomous)`);
        this.transition('Commit');
    }
    registerMessageTypes() {
        return {
            'DO_COMMIT': (msg) => {
                this.machine.history.push(`TX${this.machine.txId}:commit`);
                this.transition('Commit');
            },
            'DO_ABORT': (msg) => {
                this.machine.history.push(`TX${this.machine.txId}:abort`);
                this.transition('Abort');
            }
        };
    }
}

class Commit extends State {
    getUI() { return ['commit', '#81c784']; }
    canTransition() { return ['Idle']; }
    onEnter() {
        this.setTimeout(5, 'onCleanup');
    }
    onCleanup() {
        this.transition('Idle');
    }
}

class Abort extends State {
    getUI() { return ['abort', '#e57373']; }
    canTransition() { return ['Idle']; }
    onEnter() {
        this.setTimeout(5, 'onCleanup');
    }
    onCleanup() {
        this.transition('Idle');
    }
}

class ParticipantMachine extends Machine {
    constructor() {
        super();
        this.states = [new Idle(), new Ready(), new Prepared(), new Commit(), new Abort()];
        this.txId = null;
        this.val = null;
        this.history = [];
    }
}

const MACHINE = new ParticipantMachine();

function onUp() { MACHINE.onUp(); }
function onTimer(t) { MACHINE.onTimer(t); }
function onMessage(m) { MACHINE.onMessage(m); }
