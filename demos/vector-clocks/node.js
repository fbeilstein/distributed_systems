// Vector Clocks — Causality Tracking
// Each node maintains a vector clock (array of logical counters, one per node).
// On every send, increment own counter and attach the full vector.
// On every receive, merge by taking element-wise max, then increment own counter.
// This precisely captures happens-before relationships.
//
// Demo: Nodes 0, 1, 2 exchange messages freely. The vector clock in the state
//       inspector shows exactly which events "happened before" others.
//       Node 0 writes at tick 5, sends to Node 1.
//       Node 1 responds at tick ~10, sends to Node 2.
//       Node 0 sends independently at tick 15. Clear concurrency visible in clocks.

const N = 3; // number of nodes

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        const vc = new Array(N).fill(0);
        dumpState({
            vc,              // vector clock [c0, c1, c2]
            log: [],         // [{vc, event, tick}]
            data: null,
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

function onTimer(tick) {
    let s = loadState();
    s.tick = tick;

    // Node 0: write at tick 5, send to Node 1
    if (serverId === 0 && tick === 5) {
        s.vc = tick_vc(s.vc, serverId);
        s.data = 'x=1';
        s.log.push({ vc: [...s.vc], event: 'write x=1', tick });
        sendMessage(1, { type: 'UPDATE', data: s.data, vc: s.vc });
    }

    // Node 0: independent write at tick 20, send to Node 2
    if (serverId === 0 && tick === 20) {
        s.vc = tick_vc(s.vc, serverId);
        s.data = 'x=3';
        s.log.push({ vc: [...s.vc], event: 'write x=3', tick });
        sendMessage(2, { type: 'UPDATE', data: s.data, vc: s.vc });
    }

    // Node 1: write at tick 15, send to Node 2
    if (serverId === 1 && tick === 15) {
        s.vc = tick_vc(s.vc, serverId);
        s.data = 'y=2';
        s.log.push({ vc: [...s.vc], event: 'write y=2', tick });
        sendMessage(2, { type: 'UPDATE', data: s.data, vc: s.vc });
    }

    // Node 2: send a summary back to Node 0 at tick 50
    if (serverId === 2 && tick === 50) {
        s.vc = tick_vc(s.vc, serverId);
        s.log.push({ vc: [...s.vc], event: 'sync to Node-0', tick });
        sendMessage(0, { type: 'SYNC', vc: s.vc });
    }

    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const m = message.payload;

    if (m.type === 'UPDATE' || m.type === 'SYNC') {
        // Merge remote vector clock, then increment own
        s.vc = merge_vc(s.vc, m.vc);
        s.vc = tick_vc(s.vc, serverId);

        if (m.type === 'UPDATE') {
            s.data = m.data;
            s.log.push({ vc: [...s.vc], event: 'recv ' + m.data + ' from ' + message.from, tick: s.tick });
            // Reply with ACK carrying our updated VC
            sendMessage(message.from, { type: 'ACK_VC', vc: s.vc });
        } else {
            s.log.push({ vc: [...s.vc], event: 'recv sync from ' + message.from, tick: s.tick });
        }
    }

    else if (m.type === 'ACK_VC') {
        // Merge the acknowledgement VC into ours
        s.vc = merge_vc(s.vc, m.vc);
        s.vc = tick_vc(s.vc, serverId);
        s.log.push({ vc: [...s.vc], event: 'recv ack from ' + message.from, tick: s.tick });
    }

    dumpState(s);
}
