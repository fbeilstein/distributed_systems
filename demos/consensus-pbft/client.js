// PBFT Client Role (Batching for GC Demo)
const PRIMARY_ID = 1;
const CLIENT_ID = 0;

function onTimer(t) {
    const s = loadState();

    // BATCH 1: Ticks 40, 80, 120 (Seq 1, 2, 3 -> Triggers GC)
    const isBatch1 = (t > 0 && t <= 120 && t % 40 === 0);

    // BATCH 2: Ticks 240, 280, 320 (Seq 4, 5, 6 -> Watch log grow again)
    const isBatch2 = (t >= 240 && t % 40 === 0);

    if (isBatch1 || isBatch2) {
        const cmd = 'TX-' + getRandom(100, 999);
        sendMessage(PRIMARY_ID, { type: 'REQUEST', cmd, cid: serverId }, 'blue');
        s.state = isBatch1 ? 'BATCH 1 (FILLING)' : 'BATCH 2 (FILLING)';
    } else if (t > 120 && t < 240) {
        s.state = 'PAUSED (WAITING FOR GC)';
    }

    dumpState(s);
}

function onMessage(m) {
    if (m.payload.type === 'REPLY') {
        const s = loadState();
        s.last_tx = m.payload.result;
        dumpState(s);
    }
}

function onUp() {
    dumpState({ ...loadState(), state: 'READY' });
}