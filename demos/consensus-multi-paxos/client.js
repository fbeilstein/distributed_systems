const PROPOSER_A = 0;

function onUp() {
    dumpState({ ui_state: 'Client Generator', ui_color: '#eceff1' });
}

function onTimer(t) {
    if (serverId !== 5) return;

    // Send first command. Proposer A must run Phase 1 (PREPARE)
    if (t === 10) {
        sendMessage(PROPOSER_A, { type: 'CLIENT_REQUEST', val: 'CMD_1' }, 'black');
    }
    // Send second command. Proposer A is now Leader, skips Phase 1!
    else if (t === 40) {
        sendMessage(PROPOSER_A, { type: 'CLIENT_REQUEST', val: 'CMD_2' }, 'black');
    }
    // Send third command. Still Leader, pipelines immediately!
    else if (t === 55) {
        sendMessage(PROPOSER_A, { type: 'CLIENT_REQUEST', val: 'CMD_3' }, 'black');
    }
}