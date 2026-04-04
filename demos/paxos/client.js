// Paxos — Client Requests

const PROPOSER_A = 0;
const PROPOSER_B = 4;

function onUp() {
    dumpState({
        ui_state: 'Client Generator',
        ui_color: '#eceff1'
    });
}

function onTimer(t) {
    // Send a request to Proposer A
    if (t === 10 && serverId === 5) {
        sendMessage(PROPOSER_A, { type: 'CLIENT_REQUEST', val: 'CMD_A' }, 'black');
    }
    // Shortly after, conflicting request to Proposer B
    else if (t === 15 && serverId === 5) {
        sendMessage(PROPOSER_B, { type: 'CLIENT_REQUEST', val: 'CMD_B' }, 'black');
    }
}
