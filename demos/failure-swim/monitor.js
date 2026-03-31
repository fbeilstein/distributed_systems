// Failure Detection — SWIM (Monitor)
// Node 0: Periodically pings the Target. If it fails, asks Witnesses for indirect pings.

const TARGET_ID = 4;
const MONITOR_ID = 0;
const WITNESS_IDS = allServerIds.filter(id => id !== MONITOR_ID && id !== TARGET_ID);

const PING_AFTER_UP = 10;
const SYNC_INTERVAL = 30;
const DIRECT_TIMEOUT = 15;
const INDIRECT_TIMEOUT = 25;

/** ---------------- STATES ---------------- **/

class SwimState extends State {
    getState() { return [this.name, this.color]; }
}

class Monitoring extends SwimState {
    constructor() { super(); this.color = '#8bc34a'; }
    onEnter() { this.setTimeout(SYNC_INTERVAL, 'startPing'); }
    startPing() {
        sendMessage(TARGET_ID, { type: 'PING' }, 'blue');
        this.transition('pingpending');
    }
    canTransition() { return ['pingpending']; }
}

class PingPending extends SwimState {
    constructor() { super(); this.color = '#3498db'; }
    onEnter() { this.setTimeout(DIRECT_TIMEOUT, 'onDirectTimeout'); }
    onDirectTimeout() { this.transition('indirectpolling'); }
    onMessage(msg) {
        if (msg.payload.type === 'PONG' && msg.from === TARGET_ID)
            this.transition('monitoring');
    }
    canTransition() { return ['monitoring', 'indirectpolling']; }
}

class IndirectPolling extends SwimState {
    constructor() { super(); this.color = '#ffb74d'; }
    onEnter() {
        broadcast(WITNESS_IDS, { type: 'PING_REQ', target: TARGET_ID }, 'orange');
        this.setTimeout(INDIRECT_TIMEOUT, 'onIndirectTimeout');
    }
    onIndirectTimeout() { this.transition('failed'); }
    onMessage(msg) {
        const isPong = (msg.payload.type === 'PONG' && msg.from === TARGET_ID);
        const isIndirectPong = (msg.payload.type === 'INDIRECT_PONG');
        if (isPong || isIndirectPong)
            this.transition('monitoring');
    }
    canTransition() { return ['monitoring', 'failed']; }
}

class Failed extends SwimState {
    constructor() { super(); this.color = '#e57373'; }
    onEnter() { this.machine.isDead = true; }
    canTransition() { return []; }
}

/** ---------------- MACHINE ---------------- **/

class SwimMonitor extends Machine {
    constructor() {
        super();
        this.isDead = false;
        this.states = [new Monitoring(), new PingPending(), new IndirectPolling(), new Failed()];
    }
    onUp() {
        this._hydrate();
        this._automat.current.setTimeout(PING_AFTER_UP, 'startPing');
        this._persist();
    }
    syncUI(s) {
        s.Target = this.isDead ? '❌ DEAD' : '✅ ONLINE';
    }
}

const MONITOR = new SwimMonitor();

function onUp() { MONITOR.onUp(); }
function onTimer(t) { MONITOR.onTimer(t); }
function onMessage(m) { MONITOR.onMessage(m); }
