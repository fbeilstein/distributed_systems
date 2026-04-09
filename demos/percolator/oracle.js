// Percolator TSO (Timestamp Oracle)
function onUp() {
    const s = loadState();
    if (!s.nextTS) s.nextTS = 100;

    s.ui_state = 'ONLINE';
    s.ui_color = '#b3e5fc'; // Light Blue
    s.Current_TS = s.nextTS;
    dumpState(s);
}

function onTimer(t) {
    const s = loadState();
    s.tick = t;
    dumpState(s);
}

function onMessage(m) {
    const s = loadState();
    if (m.payload.type === 'GET_TS') {
        sendMessage(m.from, { type: 'TS_REPLY', ts: s.nextTS++ }, 'green');
        s.Current_TS = s.nextTS; // Update UI Inspector with new TS
    }
    dumpState(s);
}