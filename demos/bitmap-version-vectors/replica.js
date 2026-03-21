function onUp() {
    let s = loadState();
    s.localSeq = 0;
    s.vectorMatrix = { 1: [], 2: [], 3: [] };
    dumpState(s);
}

function onTimer(tick) {
}

function onMessage(message) {
    let s = loadState();
    if (!s.vectorMatrix) s.vectorMatrix = { 1: [], 2: [], 3: [] };
    if (s.localSeq === undefined) s.localSeq = 0;

    if (message.payload.type === 'WRITE_REQ') {
        s.localSeq++;
        s.vectorMatrix[serverId].push(s.localSeq);

        for (let target of [1, 2, 3]) {
            if (target !== serverId) {
                sendMessage(target, {
                    type: 'REPLICATE',
                    origin: serverId,
                    seq: s.localSeq
                });
            }
        }
    } else if (message.payload.type === 'REPLICATE') {
        const o = message.payload.origin;
        const seq = message.payload.seq;
        if (!s.vectorMatrix[o]) s.vectorMatrix[o] = [];
        if (!s.vectorMatrix[o].includes(seq)) {
            s.vectorMatrix[o].push(seq);
            s.vectorMatrix[o].sort((a, b) => a - b);
        }
    } else if (message.payload.type === 'SYNC_CHAIN') {
        sendMessage(2, { type: 'SYNC_DATA_CHAIN', dataParams: s.vectorMatrix, step: 1 });
    } else if (message.payload.type === 'SYNC_DATA_CHAIN') {
        const peerVectors = message.payload.dataParams;

        Object.keys(peerVectors).forEach(o => {
            if (!s.vectorMatrix[o]) s.vectorMatrix[o] = [];
            peerVectors[o].forEach(seq => {
                if (!s.vectorMatrix[o].includes(seq)) {
                    s.vectorMatrix[o].push(seq);
                    s.vectorMatrix[o].sort((a, b) => a - b);
                }
            });
        });

        // Pass the baton down the ring timeline generically: 3->2, 2->1, 1->3
        const step = message.payload.step;
        if (step < 3) {
            let nextTarget = serverId - 1;
            if (nextTarget < 1) nextTarget = 3;
            sendMessage(nextTarget, { type: 'SYNC_DATA_CHAIN', dataParams: s.vectorMatrix, step: step + 1 });
        }
    }

    // Add FSM visual colors for standard bands (independent of the custom render matrix visualizer)
    if (message.payload.type === 'WRITE_REQ' || message.payload.type === 'REPLICATE') {
        s.fsm = { state: 'Processing', colors: { Processing: '#333' } };
    } else {
        s.fsm = { state: 'Syncing', colors: { Syncing: '#7e57c2' } };
    }

    dumpState(s);
}
