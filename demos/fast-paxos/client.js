// Fast Paxos — Client Requests

const PROPOSER_A = 0;
const PROPOSER_B = 6;

function onUp() {
    dumpState({ ui_state: 'Client Generator', ui_color: '#eceff1' });
}

function onTimer(t) {
    if (serverId !== 7) return;

    if (t === 10) {
        sendMessage(PROPOSER_A, { type: 'CLIENT_REQUEST', val: 'CMD_A' }, 'black');
    }
    // Fire just 2 ticks later to intentionally cause a Fast Paxos collision!
    else if (t === 12) {
        sendMessage(PROPOSER_B, { type: 'CLIENT_REQUEST', val: 'CMD_B' }, 'black');
    }
}