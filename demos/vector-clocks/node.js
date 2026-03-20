// Vector Clocks — Causality Tracking
// Each node maintains a vector clock (array of logical counters, one per node).
// On every send, increment own counter and attach the full vector (Flashes ORANGE internally).
// On every receive, merge by taking element-wise max, then increment own counter (Flashes BLUE).
// This precisely captures happens-before relationships visually!

const N = 3; // number of nodes

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        const vc = new Array(N).fill(0);
        const stateName = `[${vc.join(', ')}]`;
        dumpState({
            vc,              // vector clock [c0, c1, c2]
            fsm: { state: stateName, colors: { [stateName]: '#cfd8dc' } }, // Starts Grey
            log: [],         // [{vc, event, tick}]
            data: null,
            flashTick: null,
            flashColor: null
        });
    }
}

function tick_vc(vc, id) {
    const v = [...vc];
    v[id]++;
    return v;
}

function merge_vc(local, remote) {
    return local.map((c, i) => Math.max(c, remote[i] !== undefined ? remote[i] : 0));
}

// Bypasses the sandbox engine entirely to natively render text variables!
function update_fsm(s, color) {
    if (color && s.tick !== undefined) {
        s.flashColor = color;
        s.flashTick = s.tick;
    }

    let activeColor = '#cfd8dc'; // Restores to default Grey if no recent flash
    if (s.flashTick !== undefined && s.tick !== undefined && s.tick - s.flashTick < 10) {
        activeColor = s.flashColor;
    }

    const stateName = `[${s.vc.join(', ')}]`;
    s.fsm = { state: stateName, colors: { [stateName]: activeColor } };
}

function onTimer(tick) {
    let s = loadState();
    s.tick = tick;
    let didUpdate = false;

    // We can casually natively access the `prng` state object magically injected natively from the physics Engine!
    // Because it is mathematically stateful, we can call it infinitely sequentially and mathematically preserve determinism beautifully:

    // Roughly 4% chance per physical tick to organically generate a local physics event
    if (tick > 2 && prng.next() < 0.04) {

        // Pick a random valid target
        let target = prng.nextInt(0, N - 1);
        if (target === serverId) target = (target + 1) % N;

        s.vc = tick_vc(s.vc, serverId);
        s.data = `d_${serverId}_${prng.nextInt(0, 99)}`;
        s.log.push({ vc: [...s.vc], event: `write ${s.data}`, tick });

        // Randomly decide (70:30) between a heavy UPDATE payload or a lightweight SYNC
        if (prng.next() > 0.3) {
            sendMessage(target, { type: 'UPDATE', data: s.data, vc: s.vc });
        } else {
            sendMessage(target, { type: 'SYNC', vc: s.vc });
        }

        update_fsm(s, '#ffb74d'); // Internal mathematically flashes Orange
        didUpdate = true;
    }

    // Update graphical renderer dynamically
    if (!didUpdate) {
        update_fsm(s);
    }

    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const m = message.payload;
    s.tick = message.arrivalTick || s.tick; // In case the engine passes it implicitly

    if (m.type === 'UPDATE' || m.type === 'SYNC') {
        // Merge remote vector clock, then increment own
        s.vc = merge_vc(s.vc, m.vc);
        s.vc = tick_vc(s.vc, serverId);

        if (m.type === 'UPDATE') {
            s.data = m.data;
            s.log.push({ vc: [...s.vc], event: 'recv ' + m.data + ' from ' + message.from, tick: s.tick });
            sendMessage(message.from, { type: 'ACK_VC', vc: s.vc });
        } else {
            s.log.push({ vc: [...s.vc], event: 'recv sync from ' + message.from, tick: s.tick });
        }
        update_fsm(s, '#4fc3f7'); // Merge tick -> Blue
    }

    else if (m.type === 'ACK_VC') {
        // Merge the acknowledgement VC into ours
        s.vc = merge_vc(s.vc, m.vc);
        s.vc = tick_vc(s.vc, serverId);
        s.log.push({ vc: [...s.vc], event: 'recv ack from ' + message.from, tick: s.tick });
        update_fsm(s, '#4fc3f7'); // Merge tick -> Blue
    }

    dumpState(s);
}
