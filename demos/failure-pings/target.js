// Failure Detection — Target Node (Pings)
// Responds to PING with PONG.

function onUp() {
    dumpState({
        ui_state: 'Target: Ready',
        ui_color: '#81c784'
    });
}

function onMessage(msg) {
    if (msg.payload.type === 'PING') {
        sendMessage(msg.from, { type: 'PONG' }, 'green');
    }
}
