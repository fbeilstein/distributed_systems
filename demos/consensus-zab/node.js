const SERVERS = allServerIds.filter(id => id !== 0);
const MAJORITY = Math.floor(SERVERS.length / 2) + 1;
const PEERS = SERVERS.filter(id => id !== serverId);

// ======================================
// Helpers
// ======================================

function lastZxid(log) {
    if (log.length === 0) return 0;
    return log[log.length - 1].zxid;
}

function better(a, b) {
    if (!b) return true;
    if (a.epoch !== b.epoch) return a.epoch > b.epoch;
    if (a.zxid !== b.zxid) return a.zxid > b.zxid;
    return a.id > b.id;
}

// ======================================
// BASE STATE
// ======================================

class ZabState extends State {
    onUp() {
        // The 'false' flag prevents the framework from throwing an error if it reboots while already in LOOKING
        this.transition('Looking', false);
    }

    hasMajority(n) {
        return n >= MAJORITY;
    }
}

// ======================================
// LOOKING (ELECTION)
// ======================================

class Looking extends ZabState {
    getUI() { return ['LOOKING', '#ffb74d']; }
    canTransition() { return ['LeadingSync', 'FollowingSync', 'Looking']; }

    onEnter() {
        this.machine.candidates = {};

        // include self
        this.machine.candidates[serverId] = {
            id: serverId,
            epoch: this.machine.epoch,
            zxid: lastZxid(this.machine.log)
        };

        this.setTimeout(5 + serverId * 5, 'broadcastVote', 'start');
        this.setTimeout(40, 'decide', 'decide'); // 🔥 hard decision point
    }

    broadcastVote() {
        const vote = {
            id: serverId,
            epoch: this.machine.epoch,
            zxid: lastZxid(this.machine.log)
        };

        broadcast(PEERS, { type: 'VOTE', vote }, 'orange');

        // keep gossiping a bit
        this.setTimeout(10, 'broadcastVote', 'retry');
    }

    onMessage(msg) {
        if (msg.payload.type !== 'VOTE') return;
        //console.log("Received vote from " + msg.from + " with payload " + JSON.stringify(msg.payload));
        const v = msg.payload.vote;
        this.machine.candidates[v.id] = v;
    }

    decide() {
        // pick best candidate deterministically
        let best = null;
        console.log("Candidates: " + JSON.stringify(this.machine.candidates));

        for (const v of Object.values(this.machine.candidates)) {
            if (better(v, best)) best = v;
        }

        if (!best) {
            console.log("No best candidate found, using self!!!!!!!!!!!!!");
            // fallback (should not happen)
            best = {
                id: serverId,
                epoch: this.machine.epoch,
                zxid: lastZxid(this.machine.log)
            };
        }

        this.machine.leaderId = best.id;
        console.log("Leader selected: " + this.machine.leaderId);

        if (best.id === serverId) {
            console.log("Transitioning to LEADING_SYNC");
            this.transition('LeadingSync', false);
        } else {
            console.log("Transitioning to FOLLOWING_SYNC");
            this.transition('FollowingSync', false);
        }
    }
}

// ======================================
// LEADER SYNC
// ======================================

class LeadingSync extends ZabState {
    getUI() { return ['LEADING_SYNC', '#64b5f6']; }
    canTransition() { return ['Broadcast', 'Looking']; }

    onEnter() {
        this.machine.epoch++;
        this.machine.syncAcks = 1;

        broadcast(PEERS, {
            type: 'SYNC',
            epoch: this.machine.epoch,
            log: this.machine.log
        }, 'blue');
    }

    onMessage(msg) {
        if (msg.payload.type === 'ACK_SYNC') {
            this.machine.syncAcks++;

            if (this.hasMajority(this.machine.syncAcks)) {
                broadcast(PEERS, {
                    type: 'UPTODATE',
                    epoch: this.machine.epoch
                }, 'green');

                this.transition('Broadcast', false);
            }
        }
    }
}

// ======================================
// FOLLOWER SYNC
// ======================================

class FollowingSync extends ZabState {
    getUI() { return ['FOLLOWING_SYNC', '#4dd0e1']; }
    canTransition() { return ['Follower', 'Looking']; }

    onEnter() {
        this.setTimeout(50, 'timeout', 'sync_timeout');
    }

    timeout() {
        this.transition('Looking', false);
    }

    onMessage(msg) {
        if (msg.payload.type === 'SYNC') {
            this.machine.leaderId = msg.from;
            this.machine.epoch = msg.payload.epoch;
            this.machine.log = msg.payload.log;

            sendMessage(msg.from, { type: 'ACK_SYNC' }, 'blue');
        }

        if (msg.payload.type === 'UPTODATE') {
            this.transition('Follower', false);
        }
    }
}

// ======================================
// BROADCAST (LEADER)
// ======================================

class Broadcast extends ZabState {
    getUI() { return ['BROADCAST', '#8bc34a']; }
    canTransition() { return ['Looking']; }

    onEnter() {
        this.setTimeout(20, 'heartbeat', 'hb');
    }

    heartbeat() {
        broadcast(PEERS, {
            type: 'HEARTBEAT',
            epoch: this.machine.epoch
        }, 'gray');

        this.setTimeout(20, 'heartbeat', 'hb');
    }

    onMessage(msg) {
        if (msg.payload.epoch && msg.payload.epoch < this.machine.epoch) return;

        if (msg.payload.type === 'CLIENT_REQ') {
            this.machine.counter++;
            const zxid = this.machine.counter;

            this.machine.log.push({
                zxid,
                val: msg.payload.val,
                ack: 1,
                committed: false
            });

            broadcast(PEERS, {
                type: 'PROPOSAL',
                zxid,
                val: msg.payload.val,
                epoch: this.machine.epoch
            }, 'orange');
        }

        if (msg.payload.type === 'ACK') {
            const entry = this.machine.log.find(e => e.zxid === msg.payload.zxid);
            if (!entry || entry.committed) return;

            entry.ack++;

            // prefix commit rule
            for (const e of this.machine.log) {
                if (!e.committed && e.ack >= MAJORITY) {
                    e.committed = true;

                    broadcast(PEERS, {
                        type: 'COMMIT',
                        zxid: e.zxid,
                        epoch: this.machine.epoch
                    }, 'green');
                } else if (!e.committed) {
                    break;
                }
            }
        }
    }
}

// ======================================
// FOLLOWER
// ======================================

class Follower extends ZabState {
    getUI() { return ['FOLLOWER', '#4db6ac']; }
    canTransition() { return ['Looking']; }

    onEnter() {
        this.resetTimeout();
    }

    resetTimeout() {
        this.setTimeout(60, 'timeout', 'hb_timeout');
    }

    timeout() {
        this.transition('Looking', false);
    }

    onMessage(msg) {
        if (msg.payload.epoch && msg.payload.epoch < this.machine.epoch) return;

        if (msg.payload.type === 'HEARTBEAT') {
            this.resetTimeout();
        }

        if (msg.payload.type === 'CLIENT_REQ') {
            sendMessage(this.machine.leaderId, msg.payload, 'gray');
        }

        if (msg.payload.type === 'PROPOSAL') {
            this.resetTimeout();
            const last = lastZxid(this.machine.log);
            if (msg.payload.zxid <= last) return;

            this.machine.log.push({
                zxid: msg.payload.zxid,
                val: msg.payload.val,
                committed: false
            });

            sendMessage(this.machine.leaderId, {
                type: 'ACK',
                zxid: msg.payload.zxid,
                epoch: this.machine.epoch
            }, 'green');
        }

        if (msg.payload.type === 'COMMIT') {
            const entry = this.machine.log.find(e => e.zxid === msg.payload.zxid);
            if (entry) entry.committed = true;
        }
    }
}

// ======================================
// MACHINE
// ======================================

class ZabMachine extends Machine {
    constructor() {
        super();
        this.states = [
            new Looking(),
            new LeadingSync(),
            new FollowingSync(),
            new Broadcast(),
            new Follower()
        ];
        this.epoch = 0;
        this.counter = 0;
        this.log = [];
        this.leaderId = null;
    }

    syncUI() {
        this.current_leader = this.leaderId ?? 'None';
        this.log_view = this.log.map(e =>
            `${e.zxid}:${e.val}${e.committed ? '✓' : ''}`
        ).join(', ') || '∅';
    }
}

// ======================================
// BOOT
// ======================================

const M = new ZabMachine();
function onUp() { M.onUp(); }
function onTimer(t) { M.onTimer(t); }
function onMessage(m) { M.onMessage(m); }