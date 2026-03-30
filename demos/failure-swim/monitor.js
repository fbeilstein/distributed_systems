// Failure Detection — SWIM (Monitor)
// Node 0: Periodically pings the Target. If it fails, asks Witnesses for indirect pings.

const TARGET_ID = 4;
const MONITOR_ID = 0;
const WITNESS_IDS = allServerIds.filter(id => id !== MONITOR_ID && id !== TARGET_ID);

const SYNC_INTERVAL = 30;
const DIRECT_TIMEOUT = 15;
const INDIRECT_TIMEOUT = 25;

/** ---------------- STATES ---------------- **/

class SwimState extends State {
    // Return lowercase name to match the graph keys for UI highlighting
    getState() { return [this.name, this.color]; }
}

class Monitoring extends SwimState {
    constructor() { super(); this.color = '#8bc34a'; }
    onTimer(t) {
        if (t >= this.machine.nextPingTick) {
            this.transition('pingpending');
        }
    }
    canTransition() { return ['pingpending']; }
}

class PingPending extends SwimState {
    constructor() { super(); this.color = '#3498db'; }
    onEnter() {
        this.machine.pingStart = this.machine.tick;
        sendMessage(TARGET_ID, { type: 'PING' }, 'blue');
        this.machine.nextPingTick = this.machine.tick + SYNC_INTERVAL;
    }
    onTimer(t) {
        if (t - this.machine.pingStart > DIRECT_TIMEOUT) {
            this.transition('indirectpolling');
        }
    }
    onMessage(msg) {
        // Direct response from target completes the ping
        if (msg.payload.type === 'PONG' && msg.from === TARGET_ID) {
            this.transition('monitoring');
        }
    }
    canTransition() { return ['monitoring', 'indirectpolling']; }
}

class IndirectPolling extends SwimState {
    constructor() { super(); this.color = '#ffb74d'; }
    onEnter() {
        this.machine.indirectStart = this.machine.tick;
        broadcast(WITNESS_IDS, { type: 'PING_REQ', target: TARGET_ID }, 'orange');
    }
    onTimer(t) {
        if (t - this.machine.indirectStart > INDIRECT_TIMEOUT) {
            this.transition('failed');
        }
    }
    onMessage(msg) {
        // If EITHER a witness relays the pong OR the target's direct delayed pong arrives, we're OK.
        const isPong = (msg.payload.type === 'PONG' && msg.from === TARGET_ID);
        const isIndirectPong = (msg.payload.type === 'INDIRECT_PONG');

        if (isPong || isIndirectPong) {
            this.transition('monitoring');
        }
    }
    canTransition() { return ['monitoring', 'failed']; }
}

class Failed extends SwimState {
    constructor() { super(); this.color = '#e57373'; }
    onEnter() {
        this.machine.isDead = true;
    }
    canTransition() { return []; }
}

/** ---------------- MACHINE ---------------- **/

class SwimMonitor extends Machine {
    constructor() {
        super();
        this.states = [new Monitoring(), new PingPending(), new IndirectPolling(), new Failed()];
        this.nextPingTick = 10;
        this.isDead = false;
        this.tick = 0;
    }
    onTimer(t) {
        this._hydrate();
        this.tick = t;
        if (this._automat) this._automat.onTimer(t);
        this._persist();
    }
    onMessage(msg) {
        this._hydrate();
        if (this._automat) this._automat.onMessage(msg);
        this._persist();
    }
    syncUI(s) {
        s.Target = this.isDead ? '❌ DEAD' : '✅ ONLINE';
        // Automated UI scaling from Machine handles current state name and color
    }
}

const MONITOR = new SwimMonitor();

function onUp() { MONITOR.onUp(); }
function onTimer(t) { MONITOR.onTimer(t); }
function onMessage(m) { MONITOR.onMessage(m); }
