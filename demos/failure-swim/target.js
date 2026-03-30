// Failure Detection — SWIM (Target)
// Responds to direct or indirect PINGs.

function onUp() {
    dumpState({
        ui_state: 'Target: Ready',
        ui_color: '#4db6ac'
    });
}

function onMessage(msg) {
    const m = msg.payload;

    if (m.type === 'PING') {
        // Send PONG back to whoever pinged us (monitor or witness)
        // Include the original requester ID if this was an indirect ping
        sendMessage(msg.from, { type: 'PONG', requester: m.requester }, 'green');
    }
}
