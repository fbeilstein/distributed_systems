// Bully Candidates — Candidate Role (MURSHED12 Strict)
// Candidates just wait for polling requests from ordinary nodes, and respond ALIVE.

const HEARTBEAT_INTERVAL = 10;
const PEERS = allServerIds.filter(id => id !== serverId);

class Follower extends State {
    getState() { return ['candidate', '#cfd8dc']; }
    canTransition() { return ['electing', 'leader']; }

    onELECTION(msg) {
        // The ordinary process initiates election by contacting candidate nodes.
        // We just respond ALIVE and visually enter the "electing" phase to show we are participating.
        sendMessage(msg.from, { type: 'ALIVE' }, 'blue');
        this.transition('electing');
    }

    onHEARTBEAT(msg) {
        this.machine.leaderId = msg.payload.leader || msg.from;
    }

    onCOORDINATOR(msg) {
        this.machine.leaderId = msg.payload.leader || msg.from;
        if (this.machine.leaderId === serverId) this.transition('leader');
    }
}

class Electing extends State {
    getState() { return ['electing', '#ffb74d']; }
    canTransition() { return ['leader', 'candidate']; }

    onELECTION(msg) {
        sendMessage(msg.from, { type: 'ALIVE' }, 'blue');
    }

    onHEARTBEAT(msg) {
        this.machine.leaderId = msg.payload.leader || msg.from;
        this.transition('candidate');
    }

    onCOORDINATOR(msg) {
        this.machine.leaderId = msg.payload.leader || msg.from;
        if (this.machine.leaderId === serverId) this.transition('leader');
        else this.transition('candidate');
    }
}

class Leader extends State {
    getState() { return ['leader', '#8bc34a']; }
    canTransition() { return ['candidate']; }

    onEnter() {
        this.machine.leaderId = serverId;
        this.sendHeartbeats();
    }

    sendHeartbeats() {
        broadcast(PEERS, { type: 'HEARTBEAT', leader: serverId }, 'green');
        this.setTimeout(HEARTBEAT_INTERVAL, 'sendHeartbeats', 'hb');
    }

    onELECTION(msg) {
        sendMessage(msg.from, { type: 'ALIVE' }, 'blue');
    }

    onHEARTBEAT(msg) {
        this.machine.leaderId = msg.payload.leader || msg.from;
        this.transition('candidate');
    }

    onCOORDINATOR(msg) {
        this.machine.leaderId = msg.payload.leader || msg.from;
        if (this.machine.leaderId !== serverId) this.transition('candidate');
    }
}

class CandidateMachine extends Machine {
    constructor() {
        super({ initial: 'candidate' });
        this.states = [new Follower(), new Electing(), new Leader()];
        this.leaderId = -1;
    }
    syncUI() {
        this.current_leader = this.leaderId === -1 ? 'None' : `Node-${this.leaderId}`;
    }
}

const M = new CandidateMachine();
function onUp() { M.onUp(); }
function onTimer(t) { M.onTimer(t); }
function onMessage(m) { M.onMessage(m); }
