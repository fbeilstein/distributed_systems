if (!timeline || !engine || !engine.history || engine.history.length === 0) return;

ctx.save();
const maxTick = engine.history.length - 1;
const numServers = engine.servers.length;

// Layout constants
const LINE_HEIGHT = 2; // Thickness of each health line
const LINE_GAP = 2;    // Gap between lines
const BASE_Y_OFFSET = -10; // Pixels above the server track center

/** Helper to check server status at a specific tick */
function isServerUp(server, tick) {
    for (const [down, up] of server.crashIntervals) {
        if (tick >= down && (up === null || tick < up)) return false;
    }
    return true;
}

for (let monitorId = 0; monitorId < numServers; monitorId++) {
    const trackY = timeline.serverToY(monitorId);
    const server = engine.servers[monitorId];

    // For each other server being monitored
    for (let targetId = 0; targetId < numServers; targetId++) {
        // Offset each target's line vertically
        // Invert the stack so Node 0 is at the top (lowest canvas Y)
        const y = trackY + BASE_Y_OFFSET - ((numServers - 1 - targetId) * (LINE_HEIGHT + LINE_GAP));

        ctx.beginPath();
        let lastX = timeline.tickToX(0);
        let lastStatus = null;
        let lastWasUp = false;

        for (let t = 0; t <= maxTick; t++) {
            const frame = engine.history[t];
            if (!frame || !frame.serverStates) continue;

            const isUp = isServerUp(server, t);
            const monitorState = frame.serverStates[monitorId];
            const targetMem = (monitorState && monitorState.members) ? monitorState.members[targetId] : null;
            const status = targetMem ? targetMem.status : 'unknown';

            // If visibility or status changed, draw the previous segment
            const visibilityChanged = isUp !== lastWasUp;
            const statusChanged = status !== lastStatus;

            if ((visibilityChanged || statusChanged) && lastStatus !== null) {
                const currentX = timeline.tickToX(t);
                if (lastWasUp) {
                    ctx.strokeStyle = getStatusColor(lastStatus);
                    ctx.lineWidth = LINE_HEIGHT;
                    ctx.moveTo(lastX, y);
                    ctx.lineTo(currentX, y);
                    ctx.stroke();
                    ctx.beginPath();
                }
                lastX = currentX;
            }
            lastStatus = status;
            lastWasUp = isUp;
        }

        // Draw final segment
        if (lastWasUp && lastStatus !== null) {
            const finalX = timeline.tickToX(maxTick + 1);
            ctx.strokeStyle = getStatusColor(lastStatus);
            ctx.lineWidth = LINE_HEIGHT;
            ctx.moveTo(lastX, y);
            ctx.lineTo(finalX, y);
            ctx.stroke();
        }
    }
}

ctx.restore();

function getStatusColor(status) {
    switch (status) {
        case 'alive': return '#4caf50';   // Green
        case 'suspect': return '#fbc02d'; // Yellow/Amber
        case 'failed': return '#f44336';  // Red
        default: return '#9e9e9e';       // Grey
    }
}
