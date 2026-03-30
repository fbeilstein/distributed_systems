// Failure Detection — SWIM (Monitor)
// Node 0: Periodically pings the Target. If it fails, asks Witnesses for indirect pings.

const TARGET_ID = 4;
const MONITOR_ID = 0
const WITNESS_IDS = allServerIds.filter(id => id !== MONITOR_ID && id !== TARGET_ID);
const SYNC_INTERVAL = 30;
const DIRECT_PING_TIMEOUT = 15;
const INDIRECT_PING_TIMEOUT = 25;

function syncUI(s) {
    const status = s.isDead ? 'DEAD' : (s.indirectPending > 0 ? 'SUSPECT' : (s.pingPending ? 'PINGING' : 'OK'));
    s.ui_state = `Monitor: ${status}`;
    s.ui_color = s.isDead ? '#e57373' : (s.indirectPending > 0 ? '#ffb74d' : '#8bc34a');

    // Status per witness/target
    s.Target = s.isDead ? '❌ DEAD' : '✅ ONLINE';
    dumpState(s);
}

function onUp() {
    dumpState({
        isDead: false,
        pingPending: false,
        indirectPending: 0,
        nextPingTick: 10,
        ui_state: 'Monitor: Monitoring',
        ui_color: '#8bc34a'
    });
}

function onTimer(t) {
    const s = loadState();
    s.tick = t;

    // 1. Direct Ping Cycle
    if (t >= (s.nextPingTick || 10) && !s.pingPending && !s.isDead && s.indirectPending === 0) {
        s.pingPending = t;
        sendMessage(TARGET_ID, { type: 'PING' }, 'blue');
        s.nextPingTick = t + SYNC_INTERVAL; // Cooled down interval
    }

    // 2. Direct Ping Timeout → Request Indirect Pings
    if (s.pingPending && (t - s.pingPending) > DIRECT_PING_TIMEOUT && s.indirectPending === 0) {
        s.pingPending = false;
        s.indirectPending = WITNESS_IDS.length;
        s.indirectStartTick = t;
        broadcast(WITNESS_IDS, { type: 'PING_REQ', target: TARGET_ID }, 'orange');
    }

    // 3. Indirect Ping Timeout → Declare Failure
    if (s.indirectPending > 0 && (t - s.indirectStartTick) > INDIRECT_PING_TIMEOUT) {
        s.isDead = true;
        s.indirectPending = 0;
    }

    syncUI(s);
}

function onMessage(msg) {
    const m = msg.payload;
    const s = loadState();

    if (m.type === 'PONG' && msg.from === TARGET_ID) {
        s.pingPending = false;
        s.indirectPending = 0;
        s.isDead = false;
    }

    if (m.type === 'INDIRECT_PONG') {
        s.indirectPending = 0;
        s.isDead = false;
    }

    syncUI(s);
}
