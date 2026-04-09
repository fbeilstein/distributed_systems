// PBFT Traitor Role (Byzantine Malice)
function onUp() {
    const s = loadState();
    s.ui_state = 'TRAITOR';
    s.ui_color = '#e57373';
    dumpState(s);
}

function onTimer(t) { dumpState(loadState()); }

function onMessage(m) {
    const s = loadState();

    if (m.payload.type === 'PRE-PREPARE') {
        const { view, seq, value } = m.payload;
        sendMessage(2, { type: 'PREPARE', view, seq, value: value + '_FORK_A' }, 'red');
        sendMessage(4, { type: 'PREPARE', view, seq, value: value + '_FORK_B' }, 'red');
    }

    // THE NEW SABOTAGE: Lie about the checkpoint hash!
    if (m.payload.type === 'CHECKPOINT') {
        const { seq } = m.payload;
        // Broadcast a corrupt digest to prevent log cleanup
        sendMessage(1, { type: 'CHECKPOINT', seq, digest: 'fake-hash' }, 'red');
        sendMessage(2, { type: 'CHECKPOINT', seq, digest: 'fake-hash' }, 'red');
        sendMessage(4, { type: 'CHECKPOINT', seq, digest: 'fake-hash' }, 'red');
    }

    dumpState(s);
}