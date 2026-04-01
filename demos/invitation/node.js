// Invitation Algorithm — Leader Election via Group Merging
// Group leaders actively invite outsiders to join. Groups continuously merge by size 
// until one ultimate leader emerges and maintains the network.

const HEARTBEAT_INTERVAL = 10;
const ULTIMATE_DECLARATION_DELAY = 45;
const INVITATION_MIN_DELAY = 20;
const INVITATION_MAX_DELAY = 39;
const POST_HEARTBEAT_TIMEOUT = 25;
const GRACE_PERIOD_TIMEOUT = 70;

class InvitationState extends State {
    isUltimate() {
        if (!this.machine) return false;
        return this.machine.hasSeenHeartbeat ||
            (this.constructor.name === 'Leader' && (this.machine.members.length === allServerIds.length || this.machine.isStalled));
    }

    // Centralized MERGE handling applies cleanly to both states natively
    onMERGE(msg) {
        const m = msg.payload;
        this.machine.leader = m.newLeader;
        this.machine.groupId = m.groupId;
        this.machine.members = m.members || this.machine.members;

        // Restart the state natively triggers Follower.onEnter() -> kickLeaderTimeout()
        this.transition('Follower', true);
    }

    // Isolated system reboot handles elegantly for both natively
    onUp() { this.transition('Leader'); }
}

class Leader extends InvitationState {
    getState() {
        return ['Leader', this.machine && this.machine.isUltimateLeader ? '#4caf50' : '#81c784'];
    }
    canTransition() { return ['Follower']; }

    onEnter() {
        this.machine.groupId = serverId;
        this.machine.leader = serverId;
        this.machine.members = [serverId];
        this.machine.isStalled = false;
        this.machine.hasSeenHeartbeat = false;
        this.machine.isUltimateLeader = false;

        this.kickInviteTimer();
        this.kickGrowthTimer();
        this.sendHeartbeats();
    }

    kickInviteTimer() {
        this.setTimeout(getRandom(INVITATION_MIN_DELAY, INVITATION_MAX_DELAY), 'onInviteTimer', 'invite');
    }

    kickGrowthTimer() {
        this.setTimeout(ULTIMATE_DECLARATION_DELAY, 'onGrowthTimeout', 'growth');
    }

    onGrowthTimeout() {
        this.machine.isStalled = true;
    }

    onInviteTimer() {
        this.kickInviteTimer();
        // Fully formed networks don't need to waste cycles picking empty PRNG targets
        if (this.machine.members.length >= allServerIds.length) return;

        const outsiders = allServerIds.filter(id => !this.machine.members.includes(id));
        if (outsiders.length > 0) {
            const target = outsiders[getRandom(0, outsiders.length - 1)];
            sendMessage(target, { type: 'INVITE', groupId: this.machine.groupId, leader: serverId, members: this.machine.members }, 'blue');
        }
    }

    sendHeartbeats() {
        this.setTimeout(HEARTBEAT_INTERVAL, 'sendHeartbeats', 'hb');

        if (this.machine.members.length === allServerIds.length || this.machine.isStalled) {
            this.machine.isUltimateLeader = true;
        }

        if (this.machine.isUltimateLeader) {
            const followers = this.machine.members.filter(id => id !== serverId);
            if (followers.length > 0) {
                broadcast(followers, { type: 'HEARTBEAT', leader: serverId, members: this.machine.members }, 'green');
            }
        }
    }

    onINVITE(msg) { this.evalInvite(msg.payload); }
    onFORWARD(msg) { this.evalInvite(msg.payload); }

    evalInvite(m) {
        if (m.leader === this.machine.leader) return;

        // Merge mathematically larger groups, tying on higher leader IDs
        if (m.members.length > this.machine.members.length ||
            (m.members.length === this.machine.members.length && m.leader > this.machine.leader)) {

            const oldFollowers = this.machine.members.filter(id => id !== serverId && !m.members.includes(id));
            this.machine.groupId = m.groupId;
            this.machine.leader = m.leader;
            this.machine.members = [...new Set([...m.members, ...this.machine.members])];

            sendMessage(m.leader, { type: 'JOIN_ACK', from: serverId, members: this.machine.members });
            // Drop old loyalists immediately by piping MERGE vectors to them directly!
            for (const id of oldFollowers) {
                sendMessage(id, { type: 'MERGE', newLeader: m.leader, groupId: m.groupId, members: this.machine.members });
            }
            this.transition('Follower');
        } else {
            sendMessage(m.leader, { type: 'INVITE', groupId: this.machine.groupId, leader: serverId, members: this.machine.members }, 'blue');
        }
    }

    onJOIN_ACK(msg) {
        let grew = false;
        for (const id of [msg.from, ...(msg.payload.members || [])]) {
            if (!this.machine.members.includes(id)) {
                this.machine.members.push(id);
                grew = true;
            }
        }
        if (grew) {
            this.machine.isStalled = false;
            this.kickGrowthTimer();
            this.machine.isUltimateLeader = false; // Reset threshold in case of stall-break
        }
    }
}

class Follower extends InvitationState {
    getState() { return ['Follower', this.machine && this.machine.hasSeenHeartbeat ? '#a5d6a7' : '#cfd8dc']; }
    canTransition() { return ['Leader']; }

    onEnter() {
        this.kickLeaderTimeout();
    }

    kickLeaderTimeout() {
        const limit = this.machine.hasSeenHeartbeat ? POST_HEARTBEAT_TIMEOUT : GRACE_PERIOD_TIMEOUT;
        this.setTimeout(limit + (serverId * 2), 'onLeaderTimeout', 'timeout');
    }

    onLeaderTimeout() {
        this.transition('Leader');
    }

    onINVITE(msg) {
        if (msg.payload.leader !== this.machine.leader) {
            sendMessage(this.machine.leader, { ...msg.payload, type: 'FORWARD' });
        }
    }

    onFORWARD(msg) { this.onINVITE(msg); }

    onJOIN_ACK(msg) {
        // As a follower, we just pipe the ACK directly to our leader
        sendMessage(this.machine.leader, msg.payload);
        // And proactively merge the node that approached us
        sendMessage(msg.from, { type: 'MERGE', newLeader: this.machine.leader, groupId: this.machine.groupId, members: this.machine.members });
    }

    onHEARTBEAT(msg) {
        if (msg.payload.leader === this.machine.leader) {
            this.machine.hasSeenHeartbeat = true;
            if (msg.payload.members && msg.payload.members.length > this.machine.members.length) {
                this.machine.members = msg.payload.members;
            }
            this.kickLeaderTimeout();
        }
    }
}

class InvitationMachine extends Machine {
    constructor() {
        super({ initial: 'Leader' });
        this.states = [new Leader(), new Follower()];
        this.leader = -1;
        this.members = [];
        this.isStalled = false;
        this.hasSeenHeartbeat = false;
        this.isUltimateLeader = false;
    }
}

const M = new InvitationMachine();
function onUp() { M.onUp(); }
function onTimer(t) { M.onTimer(t); }
function onMessage(m) { M.onMessage(m); }
