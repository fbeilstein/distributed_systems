// Failure Detection — Heartbeats (Master)
// Passive monitor: listens for arriving heartbeats. If a slave hasn't been seen in TIMEOUT ticks, it's marked OFFLINE.

const MONITOR_ID = 0
const TARGETS = allServerIds.filter(id => id !== MONITOR_ID);
const TIMEOUT = 45;

function syncUI(s, t) {
    let allOnline = true;
    TARGETS.forEach(id => {
        const lastSeen = s.lastSeen[id];
        const isDead = (t - (lastSeen || 0)) > TIMEOUT;
        if (isDead) allOnline = false;
        s[`S${id}`] = isDead ? '❌ OFFLINE' : '✅ ONLINE';
    });
    s.ui_state = allOnline ? 'Monitoring OK' : 'Failure Detected';
    s.ui_color = allOnline ? '#fff59d' : '#e57373';
    dumpState(s);
}

function onUp() {
    const s = loadState();
    // Initialize lastSeen to 0 so they are considered online until TIMEOUT hits
    s.lastSeen = { 1: 0, 2: 0, 3: 0 };
    syncUI(s, 0);
}

function onTimer(t) {
    const s = loadState();
    if (!s.lastSeen) s.lastSeen = { 1: t, 2: t, 3: t };
    syncUI(s, t);
}

function onMessage(m) {
    if (m.payload.type === 'HEARTBEAT') {
        const s = loadState();
        if (!s.lastSeen) s.lastSeen = {};
        // Record the exact tick the heartbeat arrived
        s.lastSeen[m.from] = m.arrivalTick;
        dumpState(s);
    }
}
