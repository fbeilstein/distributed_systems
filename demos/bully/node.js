// --- TUNING PARAMETERS ---
const HEARTBEAT_INTERVAL = 10;   // How often the leader sends a pulse
const ELECTION_THRESHOLD = 20;   // Wait this long since last pulse before electing
const COLLECTION_TIMEOUT = 12;   // Wait this long for ALIVE responses before victory
// -------------------------

const PEERS = allServerIds.filter(id => id !== serverId);
const HIGHER_PRIORITY_NODES = allServerIds.filter(id => id > serverId);

// for visuals only make first nodes more probable to start elections
function election_timeout() {
    return ELECTION_THRESHOLD + (serverId * 5) - getRandom(0, 10);
}

/** BULLY STATE: Base class for shared handlers */
class BullyState extends State {
    wait_leader() { this.setTimeout(election_timeout(), 'onLeaderTimeout', 'leader'); }

    onLEADER_HEARTBEAT(msg) {
        const leader = msg.payload.leader;
        this.machine.leaderId = leader;
        this.transition('Follower', false);
        this.wait_leader();
    }

    onELECTION(msg) {
        sendMessage(msg.from, { type: 'ALIVE' }, 'blue');
        this.wait_leader();
    }

    onPROCEED() { this.transition('Leader'); }
    onUp() { this.transition('Follower'); }
}

/** FOLLOWER: Waiting for heartbeats or delegations */
class Follower extends BullyState {
    getState() { return ['Follower', '#cfd8dc']; }
    canTransition() { return ['Electing', 'Leader']; }
    onEnter() { this.wait_leader(); }
    onLeaderTimeout() { this.transition('Electing'); }
}

/** ELECTING: The Handover Phase */
class Electing extends BullyState {
    getState() { return ['Electing', '#ffb74d']; }
    canTransition() { return ['Leader', 'Follower']; }

    onEnter() {
        this.machine.highestResponder = serverId;
        if (HIGHER_PRIORITY_NODES.length === 0) {
            this.transition('Leader');
        } else {
            broadcast(HIGHER_PRIORITY_NODES, { type: 'ELECTION' }, 'orange');
            this.setTimeout(COLLECTION_TIMEOUT, 'onElectionTimeout', 'election');
        }
    }

    onElectionTimeout() {
        if (this.machine.highestResponder === serverId) {
            this.transition('Leader');
        } else {
            sendMessage(this.machine.highestResponder, { type: 'PROCEED' }, 'red');
            this.transition('Follower');
        }
    }

    onALIVE(msg) {
        if (msg.from > this.machine.highestResponder)
            this.machine.highestResponder = msg.from;
    }
}

/** LEADER: Victory and Heartbeats */
class Leader extends BullyState {
    getState() { return ['Leader', '#81c784']; }
    canTransition() { return ['Follower']; }

    onEnter() {
        this.machine.leaderId = serverId;
        this.onHeartbeatTick();
    }

    onHeartbeatTick() {
        broadcast(PEERS, { type: 'LEADER_HEARTBEAT', leader: serverId }, 'green');
        this.setTimeout(HEARTBEAT_INTERVAL, 'onHeartbeatTick');
    }

    onELECTION(msg) { sendMessage(msg.from, { type: 'ALIVE' }, 'blue'); }
}

class BullyMachine extends Machine {
    constructor() {
        super();
        this.states = [new Follower(), new Electing(), new Leader()];
        this.leaderId = null;
        this.highestResponder = null;
    }

    syncUI() {
        this.current_leader = this.leaderId === null ? 'None' : `Node-${this.leaderId}`;
    }
}

const M = new BullyMachine();

function onUp() { M.onUp(); }
function onTimer(t) { M.onTimer(t); }
function onMessage(m) { M.onMessage(m); }