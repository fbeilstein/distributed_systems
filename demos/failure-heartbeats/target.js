// Failure Detection — Heartbeats (Slave)
// Proactive push model: targets send heartbeats on a timer.

const MONITOR_ID = 0;
const HEARTBEAT_INTERVAL = 20;

function onUp() {
    dumpState({
        ui_state: 'Active (Pushing)',
        ui_color: '#81c784',
        status: 'Active'
    });
}

function onTimer(t) {
    // Proactively push a heartbeat to the monitor every 20 ticks
    if (t % HEARTBEAT_INTERVAL === 0)
        sendMessage(MONITOR_ID, { type: 'HEARTBEAT' }, 'green');
}
