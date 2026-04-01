// Vector Clocks — Functional Refactor
// Rule: On any event (send/recv), increment own clock component. 
// On receive: merge by element-wise max before incrementing.

const N = allServerIds.length;

const inc = (vc) => { vc[serverId]++; return vc; };
const merge = (a, b) => a.map((v, i) => Math.max(v, b[i] || 0));

function syncUI(s) {
    s.ui_state = `[${s.vc.join(',')}]`;
    const last = s.log[s.log.length - 1];
    if (last && s.tick - last.tick < 12) {
        if (last.event.includes('sent')) s.ui_color = '#ffb74d';
        else if (last.event.includes('recv')) s.ui_color = '#4fc3f7';
        else if (last.event.includes('ack')) s.ui_color = '#81c784';
    } else {
        s.ui_color = '#cfd8dc';
    }
}

function onUp() {
    let s = loadState();
    if (!s.vc) {
        s.vc = new Array(N).fill(0);
        s.log = [];
        s.nextTick = 5 + getRandom(0, 15);
    }
    syncUI(s);
    dumpState(s);
}

function onTimer(tick) {
    let s = loadState();
    s.tick = tick;

    if (tick >= s.nextTick) {
        const target = (serverId + 1 + getRandom(0, N - 2)) % N;
        s.vc = inc(s.vc);
        const data = `val_${getRandom(10, 99)}`;

        s.log.push({ tick, vc: [...s.vc], event: `sent ${data} to ${target}` });
        sendMessage(target, { type: 'WRITE', vc: s.vc, data }, '#ffb74d');

        s.nextTick = tick + 20 + getRandom(0, 30);
    }
    syncUI(s);
    dumpState(s);
}

function onMessage(msg) {
    let s = loadState();
    const p = msg.payload;
    s.tick = msg.arrivalTick;

    if (p.type === 'WRITE') {
        s.vc = inc(merge(s.vc, p.vc));
        s.log.push({ tick: s.tick, vc: [...s.vc], event: `recv ${p.data} from ${msg.from}` });
        sendMessage(msg.from, { type: 'ACK', vc: s.vc }, '#4fc3f7');
    }
    else if (p.type === 'ACK') {
        s.vc = inc(merge(s.vc, p.vc));
        s.log.push({ tick: s.tick, vc: [...s.vc], event: `ack from ${msg.from}` });
    }
    syncUI(s);
    dumpState(s);
}
