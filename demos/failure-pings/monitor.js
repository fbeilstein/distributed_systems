// Failure Detection — Ping Monitor
// Active pull model: monitor sends PING periodically, tracks last_seen per target.
// If no PONG for DEAD_THRESHOLD ticks → marked OFFLINE.

const MONITOR_ID = 0
const TARGETS = allServerIds.filter(id => id !== MONITOR_ID);
const PING_INTERVAL = 20;
const DEAD_THRESHOLD = 45;

function syncUI(s, t) {
    let anyDead = false;
    TARGETS.forEach(id => {
        const elapsed = t - (s.lastSeen[id] || 0);
        const dead = elapsed > DEAD_THRESHOLD && t > DEAD_THRESHOLD;
        if (dead) anyDead = true;
        s[`S${id}`] = dead ? '❌ OFFLINE' : '✅ ONLINE';
    });
    s.ui_state = anyDead ? 'Failure Detected' : 'Monitoring';
    s.ui_color = anyDead ? '#e57373' : '#fff59d';
    dumpState(s);
}

function onUp() {
    const lastSeen = {};
    TARGETS.forEach(id => { lastSeen[id] = 0; });
    syncUI({ lastSeen }, 0);
}

function onTimer(t) {
    const s = loadState();

    if (t % PING_INTERVAL === 0)
        broadcast(TARGETS, { type: 'PING' }, 'blue');

    syncUI(s, t);
}

function onMessage(m) {
    if (m.payload.type === 'PONG') {
        const s = loadState();
        s.lastSeen[m.from] = m.arrivalTick;
        dumpState(s);
    }
}
