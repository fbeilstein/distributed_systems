// Failure Detection — Phi Accrual Target
// Sends periodic heartbeats to the monitor (node 0).

function onUp() {
    dumpState({
        ui_state: 'Active',
        ui_color: '#81c784'
    });
}

function onTimer(t) {
    // Send heartbeats every 10 ticks (approx)
    if (t % 10 === serverId % 10) {
        sendMessage(0, { type: 'HEARTBEAT' }, 'green');
    }
}
