// PBFT Traitor Role (Byzantine Malice)

function onMessage(m) {
    // When the primary sends a proposal, we lie to split the quorum.
    if (m.payload.type === 'PRE-PREPARE') {
        const { view, seq, value } = m.payload;

        // Send a valid-looking but contradictory PREPARE message to Replica 1
        sendMessage(3, { type: 'PREPARE', view, seq, value: value + '_FORK_A' }, 'red');

        // Send a different contradictory PREPARE message to Replica 2
        sendMessage(4, { type: 'PREPARE', view, seq, value: value + '_FORK_B' }, 'red');
    }
}

function onUp() {
    dumpState({ ...loadState(), state: 'BYZANTINE_ACTIVE' });
}
