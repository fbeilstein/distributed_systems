// Three-Phase Commit — Client Requests
const COORDINATOR = 0;

function onUp() {
    dumpState({
        ui_state: 'Client Generator',
        ui_color: '#eceff1'
    });
}

function onTimer(t) {
    if (t === 10) {
        // Successful Transaction
        sendMessage(COORDINATOR, { type: 'CLIENT_TX_START', txId: 1, val: 'WRITE A' }, 'black');
    } else if (t === 70) {
        // Transaction 2 will intentionally fail because DB-2 aborts even transactions
        sendMessage(COORDINATOR, { type: 'CLIENT_TX_START', txId: 2, val: 'WRITE B' }, 'black');
    }
}
