// Ring Algorithm — Leader Election (Live Node Set Variant)
// Nodes strictly pass an election token dynamically around a logical ring.
// When the token returns to the initiator, the mathematical max ID from the recorded live set becomes leader.

const HEARTBEAT_INTERVAL = 10;
const LEADER_TIMEOUT = 30; // Base ticks a follower will natively wait for heartbeats before suspecting a crash
const ACK_TIMEOUT = 12;    // Ticks a node will wait for its neighbor to ACK before stepping past it

class RingState extends State {

    // Core Network Protocol: safely pipe payloads mathematically to the sequential next live node 
    forwardRing(type, payload) {
        this.machine.targetOffset = 1;
        this.machine.pendingPayload = payload;
        this.machine.pendingPayload.type = type;

        this.transmit();
    }

    transmit() {
        const nextId = (serverId + this.machine.targetOffset) % allServerIds.length;
        sendMessage(nextId, this.machine.pendingPayload, this.machine.pendingPayload.type === 'ELECTION' ? 'orange' : 'green');

        // Securely listen for ACK from THIS specific jump offset
        this.setTimeout(ACK_TIMEOUT, 'onAckTimeout', 'ack_wait');
    }

    onAckTimeout() {
        this.machine.targetOffset++;
        if (this.machine.targetOffset >= allServerIds.length) {
            // Absolute partition logic: If we traversed the entire numerical array and got no ACKs, we are inherently isolated.
            if (this.machine.pendingPayload.type === 'ELECTION' && this.machine.pendingPayload.initiator === serverId) {
                this.machine.leader = serverId;
                this.transition('Leader');
            }
        } else {
            this.transmit(); // Automatically skip unresponsive nodes natively across the ring
        }
    }

    onACK(msg) {
        // Only clear the timeout if it came from the exact peer we polled
        const currentTarget = (serverId + this.machine.targetOffset) % allServerIds.length;
        if (msg.from === currentTarget) {
            this.clearTimeout('ack_wait');
        }
    }

    onELECTION(msg) {
        sendMessage(msg.from, { type: 'ACK' }, 'gray');
        const m = msg.payload;

        if (m.initiator === serverId) {
            this.machine.leader = Math.max(...m.list);

            this.transition(this.machine.leader === serverId ? 'Leader' : 'Follower');
            this.forwardRing('ELECTED', { initiator: serverId, leader: this.machine.leader });
        } else {
            if (m.list.includes(serverId)) return;

            // Generate an explicitly isolated clone to avoid polluting JS Object references!
            const copyPayload = { initiator: m.initiator, list: [...m.list, serverId] };
            this.transition('Candidate', false);
            this.forwardRing('ELECTION', copyPayload);
        }
    }

    onELECTED(msg) {
        sendMessage(msg.from, { type: 'ACK' }, 'gray');
        const m = msg.payload;

        if (m.initiator === serverId) return;

        this.machine.leader = m.leader;
        this.transition(this.machine.leader === serverId ? 'Leader' : 'Follower');
        this.forwardRing('ELECTED', { initiator: m.initiator, leader: m.leader });
    }

    onUp() { this.transition('Follower'); }
}

class Leader extends RingState {
    getState() { return ['Leader', '#4caf50']; }
    canTransition() { return ['Follower', 'Candidate']; }

    onEnter() {
        this.machine.leader = serverId;
        this.sendHeartbeat();
    }

    sendHeartbeat() {
        const peers = allServerIds.filter(id => id !== serverId);
        if (peers.length > 0) {
            // Distribute heartbeats out
            broadcast(peers, { type: 'HEARTBEAT', leader: serverId }, 'green');
        }
        this.setTimeout(HEARTBEAT_INTERVAL, 'sendHeartbeat', 'hb');
    }
}

class Follower extends RingState {
    getState() { return ['Follower', '#cfd8dc']; }
    canTransition() { return ['Candidate', 'Leader']; }

    onEnter() {
        this.resetLeaderTimeout();
    }

    resetLeaderTimeout() {
        this.setTimeout(LEADER_TIMEOUT + (serverId * 5), 'onLeaderTimeout', 'leader_wait');
    }

    onHEARTBEAT(msg) {
        this.machine.leader = msg.payload.leader;
        this.resetLeaderTimeout();
    }

    onLeaderTimeout() {
        this.transition('Candidate');
        this.forwardRing('ELECTION', { initiator: serverId, list: [serverId] }); // Originates strictly upon actual timeouts!
    }
}

class Candidate extends RingState {
    getState() { return ['Candidate', '#ffb74d']; }
    canTransition() { return ['Leader', 'Follower']; }

    onEnter() {
        this.machine.leader = -1;
        this.setTimeout(80, 'onElectionJammed', 'jam_wait');
    }

    onElectionJammed() {
        this.transition('Follower');
    }

    onHEARTBEAT(msg) {
        // Stale or unjoined distinct leader organically resets our ring!
        this.machine.leader = msg.payload.leader;
        this.transition('Follower');
    }
}

class RingMachine extends Machine {
    constructor() {
        super({ initial: serverId === Math.max(...allServerIds) ? 'Leader' : 'Follower' });
        this.states = [new Leader(), new Follower(), new Candidate()];
        // Initialize cleanly simulating a stable pre-start
        this.leader = Math.max(...allServerIds);
    }

    syncUI() {
        this.current_leader = `Node-${this.leader}`;
    }
}

const M = new RingMachine();
function onUp() { M.onUp(); }
function onTimer(t) { M.onTimer(t); }
function onMessage(m) { M.onMessage(m); }
