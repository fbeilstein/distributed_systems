const COORDINATOR_ID = 0;

function onUp() {
    dumpState({
        ui_state: 'Client Generator',
        ui_color: '#eceff1'
    });
}

function onTimer(t) {
    if (t === 10) {
        sendMessage(COORDINATOR_ID, { type: 'CLIENT_TX_START', txId: 1, val: 1 }, 'black');
    } else if (t === 70) {
        sendMessage(COORDINATOR_ID, { type: 'CLIENT_TX_START', txId: 2, val: 2 }, 'black');
    }
}

function onMessage(m) { }
