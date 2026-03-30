// Failure Detection — SWIM (Witness)
// Relays PINGs from the Monitor to the Target.

const MONITOR_ID = 0;

function onUp() {
    dumpState({
        ui_state: 'Witness: Ready',
        ui_color: '#ce93d8'
    });
}

function onMessage(msg) {
    const m = msg.payload;

    if (m.type === 'PING_REQ') {
        // Relay ping request to target node
        sendMessage(m.target, { type: 'PING', requester: msg.from }, 'orange');
    }

    if (m.type === 'PONG') {
        // Propagate response back to the original requester (monitor)
        // BUG FIX: Check for !== undefined as requester ID 0 is falsy
        if (m.requester !== undefined) {
            sendMessage(m.requester, { type: 'INDIRECT_PONG', witness: serverId }, 'green');
        }
    }
}
