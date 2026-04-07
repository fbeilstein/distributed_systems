// Flexible Paxos — Client Requests

const PROPOSER_A = 0;
const PROPOSER_B = 6; // Shifted from 4 to 6

function onUp() {
    dumpState({
        ui_state: 'Client Generator',
        ui_color: '#eceff1'
    });
}

function onTimer(t) {
    // The Client is now node 7 in the expanded 8-node array!
    if (serverId !== 7) return;

    // Send a request to Proposer A
    if (t === 10) {
        sendMessage(PROPOSER_A, { type: 'CLIENT_REQUEST', val: 'CMD_A' }, 'black');
    }
    // Shortly after, conflicting request to Proposer B
    else if (t === 15) {
        sendMessage(PROPOSER_B, { type: 'CLIENT_REQUEST', val: 'CMD_B' }, 'black');
    }
}