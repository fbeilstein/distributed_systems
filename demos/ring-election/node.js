// Ring Algorithm — Leader Election (Live Node Set Variant)
// Nodes pass an ELECTION token around a logical ring.
// Unresponsive nodes are skipped dynamically. The highest ID in the live set wins.

const HEARTBEAT_INTERVAL = 10;
const LEADER_TIMEOUT = 30;
const RING_ACK_TIMEOUT = 12;
const PEERS = allServerIds.filter(id => id !== serverId);


class RingState extends State {

    // --- Outbox: reliable ring delivery with automatic skip-retry ---

    ringFlush() {
        const ob = this.machine.outbox;
        if (!ob) return;

        const target = (serverId + ob.offset) % allServerIds.length;
        if (target === serverId) {
            // Exhausted entire ring. Evaluate from what we collected.
            this.machine.outbox = null;
            this.machine.leader = ob.payload.list
                ? Math.max(...ob.payload.list)
                : serverId;
            broadcast(PEERS, { type: 'LEADER', leader: this.machine.leader }, 'red');
            this.transition(this.machine.leader === serverId ? 'Leader' : 'Follower');
            return;
        }

        sendMessage(target, ob.payload, 'orange');
        this.setTimeout(RING_ACK_TIMEOUT, 'onRingRetry', 'ring_retry');
    }

    onRingRetry() {
        if (!this.machine.outbox) return;
        this.machine.outbox.offset++;  // Skip unresponsive node
        this.ringFlush();
    }

    onACK(msg) {
        if (!this.machine.outbox) return;
        const expected = (serverId + this.machine.outbox.offset) % allServerIds.length;
        if (msg.from === expected) {
            this.machine.outbox = null;  // Delivered successfully
            this.clearTimeout('ring_retry');
        }
    }

    // --- Election Protocol ---

    onELECTION(msg) {
        sendMessage(msg.from, { type: 'ACK' }, 'gray');
        const list = msg.payload.list;

        if (list.includes(serverId)) {
            // Full round trip! We are already in the list, so the token has visited everyone alive.
            this.machine.leader = Math.max(...list);
            broadcast(PEERS, { type: 'LEADER', leader: this.machine.leader }, 'red');
            this.transition(this.machine.leader === serverId ? 'Leader' : 'Follower');
        } else {
            // Add ourselves to the live set and forward along the ring
            this.machine.outbox = {
                payload: { type: 'ELECTION', list: [...list, serverId] },
                offset: 1
            };
            this.transition('Candidate', false);
            this.automat.current.ringFlush();
        }
    }

    onLEADER(msg) {
        this.machine.outbox = null;
        this.machine.leader = msg.payload.leader;
        this.transition(this.machine.leader === serverId ? 'Leader' : 'Follower');
    }
}


class Follower extends RingState {
    getState() { return ['Follower', '#cfd8dc']; }

    onEnter() {
        this.setTimeout(LEADER_TIMEOUT + (serverId * 5), 'onLeaderTimeout', 'leader_wait');
    }

    onHEARTBEAT(msg) {
        this.machine.leader = msg.payload.leader;
        this.onEnter();
    }

    onLeaderTimeout() {
        // Put the initial token in the outbox, Candidate.onEnter will flush it
        this.machine.outbox = {
            payload: { type: 'ELECTION', list: [serverId] },
            offset: 1
        };
        this.transition('Candidate');
    }
}


class Candidate extends RingState {
    getState() { return ['Candidate', '#ffb74d']; }

    onEnter() {
        // Flush the outbox (set by Follower.onLeaderTimeout)
        if (this.machine.outbox) this.ringFlush();

        // Safety: if election is stuck, drop back to Follower and try again
        this.setTimeout(60, 'onElectionJammed', 'jam');
    }

    onElectionJammed() {
        this.machine.outbox = null;
        this.transition('Follower');
    }

    onHEARTBEAT(msg) {
        this.machine.outbox = null;
        this.machine.leader = msg.payload.leader;
        this.transition('Follower');
    }
}


class Leader extends RingState {
    getState() { return ['Leader', '#4caf50']; }

    onEnter() {
        this.machine.leader = serverId;
        this.sendHeartbeat();
    }

    sendHeartbeat() {
        broadcast(PEERS, { type: 'HEARTBEAT', leader: serverId }, 'green');
        this.setTimeout(HEARTBEAT_INTERVAL, 'sendHeartbeat', 'hb');
    }
}


class RingMachine extends Machine {
    constructor() {
        const initialLeader = Math.max(...allServerIds);
        super({ initial: serverId === initialLeader ? 'Leader' : 'Follower' });
        this.states = [new Leader(), new Follower(), new Candidate()];
        this.leader = initialLeader;
        this.outbox = null;
    }

    syncUI() {
        this.current_leader = this.leader === -1 ? 'None' : `Node-${this.leader}`;
    }
}

const M = new RingMachine();
function onUp() { M.onUp(); }
function onTimer(t) { M.onTimer(t); }
function onMessage(m) { M.onMessage(m); }
