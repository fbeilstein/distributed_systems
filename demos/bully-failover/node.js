// --- TUNING PARAMETERS ---
const HEARTBEAT_INTERVAL = 10;   // How often the leader sends a pulse
const ELECTION_THRESHOLD = 20;   // Wait this long since last pulse before electing
const PROBE_TIMEOUT = 10;        // Wait this long for probe response before full election
const COLLECTION_TIMEOUT = 12;   // Wait this long for ALIVE responses before victory
// -------------------------

const PEERS = allServerIds.filter(id => id !== serverId);
const HIGHER_PRIORITY_NODES = allServerIds.filter(id => id > serverId);

function election_timeout() {
    return ELECTION_THRESHOLD + (serverId * 5) - getRandom(0, 10);
}

/** BULLY STATE: Shared handlers and protocol constants */
class BullyState extends State {
    wait_leader() { this.setTimeout(election_timeout(), 'onLeaderTimeout', 'leader'); }

    onLEADER_HEARTBEAT(msg) {
        this.machine.leaderId = msg.payload.leader;
        this.machine.failoverNode = msg.payload.failoverNode;
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

/** FOLLOWER: Waiting for heartbeats or probe signals */
class Follower extends BullyState {
    getState() { return ['Follower', '#cfd8dc']; }
    canTransition() { return ['Probing', 'Electing', 'Leader']; }
    onEnter() { this.wait_leader(); }
    onLeaderTimeout() {
        if (this.machine.failoverNode !== undefined && this.machine.failoverNode !== null) {
            this.transition('Probing');
        } else {
            this.transition('Electing');
        }
    }
}

/** PROBING: Fast handover attempt before falling back to full election */
class Probing extends BullyState {
    getState() { return ['Probing', '#fff59d']; }
    canTransition() { return ['Electing', 'Follower', 'Leader']; }

    onEnter() {
        // Direct invitation to the designated successor to take over
        sendMessage(this.machine.failoverNode, { type: 'PROCEED' }, 'red');
        this.setTimeout(PROBE_TIMEOUT, 'onProbeTimeout', 'probe');
    }

    // Handled by base class: if heartbeats start, we go back to Follower
    onProbeTimeout() { this.transition('Electing'); }
}

/** ELECTING: Standard Bully fallback storm */
class Electing extends BullyState {
    getState() { return ['Electing', '#ffb74d']; }
    canTransition() { return ['Leader', 'Follower']; }

    onEnter() {
        this.machine.highestResponder = serverId;
        if (HIGHER_PRIORITY_NODES.length === 0) {
            this.victory();
        } else {
            broadcast(HIGHER_PRIORITY_NODES, { type: 'ELECTION' }, 'orange');
            this.setTimeout(COLLECTION_TIMEOUT, 'onElectionTimeout', 'election');
        }
    }

    onElectionTimeout() {
        if (this.machine.highestResponder === serverId) {
            this.victory();
        } else {
            sendMessage(this.machine.highestResponder, { type: 'PROCEED' }, 'red');
            this.transition('Follower');
        }
    }

    onALIVE(msg) {
        if (msg.from > this.machine.highestResponder)
            this.machine.highestResponder = msg.from;
    }

    victory() {
        this.machine.leaderId = serverId;
        broadcast(PEERS, { type: 'LEADER_HEARTBEAT', leader: serverId }, 'green');
        this.transition('Leader');
    }
}

/** LEADER: Established authority designating a successor */
class Leader extends BullyState {
    getState() { return ['Leader', '#81c784']; }
    canTransition() { return ['Follower']; }

    onEnter() {
        this.machine.leaderId = serverId;
        this.onHeartbeatTick();
    }

    onHeartbeatTick() {
        // Designate the highest peer as the successor in every heartbeat
        const failoverNode = PEERS.sort((a, b) => b - a)[0];
        broadcast(PEERS, { type: 'LEADER_HEARTBEAT', leader: serverId, failoverNode }, 'green');
        this.setTimeout(HEARTBEAT_INTERVAL, 'onHeartbeatTick');
    }

    onELECTION(msg) { sendMessage(msg.from, { type: 'ALIVE' }, 'blue'); }
}

class FailoverMachine extends Machine {
    constructor() {
        super();
        this.states = [new Follower(), new Probing(), new Electing(), new Leader()];
        this.leaderId = null;
        this.failoverNode = null;
    }

    syncUI() {
        this.current_leader = this.leaderId === null ? 'None' : `Node-${this.leaderId}`;
    }
}

const M = new FailoverMachine();

function onUp() { M.onUp(); }
function onTimer(t) { M.onTimer(t); }
function onMessage(m) { M.onMessage(m); }