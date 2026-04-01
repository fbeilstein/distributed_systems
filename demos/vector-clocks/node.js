// Vector Clocks — Causality Tracking
// Each node maintains a vector clock. On send: increment own counter.
// On receive: merge by element-wise max, then increment own counter.

const N = allServerIds.length;

function tick_vc(vc, id) {
    const v = [...vc];
    v[id]++;
    return v;
}

function merge_vc(local, remote) {
    return local.map((c, i) => Math.max(c, remote[i] !== undefined ? remote[i] : 0));
}

function update_display(s, color) {
    if (color && s.tick !== undefined) {
        s.flashColor = color;
        s.flashTick = s.tick;
    }
    let activeColor = '#cfd8dc';
    if (s.flashTick !== undefined && s.tick !== undefined && s.tick - s.flashTick < 10) {
        activeColor = s.flashColor;
    }
    const stateName = `[${s.vc.join(', ')}]`;
    s.ui_state = stateName;
    s.ui_color = activeColor;
}

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        s.vc = new Array(N).fill(0);
        s.log = [];
        s.data = null;
        s.flashTick = null;
        s.flashColor = null;
        update_display(s);
    }
    dumpState(s);
}

function onTimer(tick) {
    let s = loadState();
    s.tick = tick;
    let didUpdate = false;

    // ~4% chance per tick to send a message to a random peer
    if (tick > 2 && getRandom(0, 24) === 0) {
        let target = getRandom(0, N - 1);
        if (target === serverId) target = (target + 1) % N;

        s.vc = tick_vc(s.vc, serverId);
        s.data = `d_${serverId}_${getRandom(0, 99)}`;
        s.log.push({ vc: [...s.vc], event: `write ${s.data}`, tick });

        // 70% UPDATE, 30% SYNC
        if (getRandom(0, 9) > 2) {
            sendMessage(target, { type: 'UPDATE', data: s.data, vc: s.vc });
        } else {
            sendMessage(target, { type: 'SYNC', vc: s.vc });
        }

        update_display(s, '#ffb74d');
        didUpdate = true;
    }

    if (!didUpdate) update_display(s);
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const m = message.payload;
    s.tick = message.arrivalTick || s.tick;

    if (m.type === 'UPDATE' || m.type === 'SYNC') {
        s.vc = merge_vc(s.vc, m.vc);
        s.vc = tick_vc(s.vc, serverId);

        if (m.type === 'UPDATE') {
            s.data = m.data;
            s.log.push({ vc: [...s.vc], event: 'recv ' + m.data + ' from ' + message.from, tick: s.tick });
            sendMessage(message.from, { type: 'ACK_VC', vc: s.vc });
        } else {
            s.log.push({ vc: [...s.vc], event: 'recv sync from ' + message.from, tick: s.tick });
        }
        update_display(s, '#4fc3f7');
    }

    else if (m.type === 'ACK_VC') {
        s.vc = merge_vc(s.vc, m.vc);
        s.vc = tick_vc(s.vc, serverId);
        s.log.push({ vc: [...s.vc], event: 'recv ack from ' + message.from, tick: s.tick });
        update_display(s, '#4fc3f7');
    }

    dumpState(s);
}
