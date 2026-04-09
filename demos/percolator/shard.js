// Percolator Shard (Storage Node)
function syncUI(s) {
    // Visually warn when the shard is locked!
    if (Object.keys(s.lock).length > 0) {
        s.ui_state = 'LOCKED';
        s.ui_color = '#ffe0b2'; // Orange
    } else if (Object.keys(s.write).length > 0) {
        s.ui_state = 'COMMITTED';
        s.ui_color = '#c8e6c9'; // Green
    } else {
        s.ui_state = 'READY';
        s.ui_color = '#e3f2fd'; // Blue
    }

    // Expose memory dictionaries to the Inspector card
    s.Current_Data = JSON.stringify(s.data);
    s.Active_Locks = JSON.stringify(s.lock);

    dumpState(s);
}

function onUp() {
    const s = loadState();
    if (!s.data) s.data = {};
    if (!s.lock) s.lock = {};
    if (!s.write) s.write = {};
    syncUI(s);
}

function onTimer(t) {
    const s = loadState(); s.tick = t; syncUI(s);
}

function onMessage(m) {
    const s = loadState();
    const p = m.payload;
    if (p.type === 'PREWRITE') {
        s.lock[p.key] = { startTs: p.startTs, isPrimary: p.isPrimary, primaryKey: p.primaryKey };
        s.data[p.key + '@' + p.startTs] = p.val;
        sendMessage(m.from, { type: 'PREWRITE_REPLY' }, 'orange');
    } else if (p.type === 'COMMIT') {
        delete s.lock[p.key];
        s.write[p.key + '@' + p.commitTs] = p.startTs;
        sendMessage(m.from, { type: 'COMMIT_REPLY' }, 'green');
    }
    syncUI(s);
}