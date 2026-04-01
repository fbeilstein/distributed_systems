if (!timeline || !engine || !engine.history || engine.history.length === 0) return;

ctx.save();
const maxTick = engine.history.length - 1;
const numServers = engine.servers.length;

const THICK_LINE = 4;
const THIN_LINE = 1.5;
const Y_OFFSET = -12; // Pixels above the server track center block

// Provide distinct colors for distinct clusters (enough to cover numServers)
const CLUSTER_COLORS = [
    '#f44336', '#4caf50', '#9c27b0', '#673ab7', '#3f51b5',
    '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#e91e63',
    '#8bc34a', '#cddc39', '#ffeb3b', '#ffc107', '#ff9800',
    '#ff5722', '#795548', '#607d8b'
];

for (let monitorId = 0; monitorId < numServers; monitorId++) {
    const trackY = timeline.serverToY(monitorId);
    const y = trackY + Y_OFFSET;

    ctx.beginPath();
    let lastX = timeline.tickToX(0);

    let lastLeader = null;
    let lastIsLeader = null;

    for (let t = 0; t <= maxTick; t++) {
        const frame = engine.history[t];
        if (!frame || !frame.serverStates) continue;

        const state = frame.serverStates[monitorId];
        if (!state) continue;

        const currentLeader = state.leader !== undefined ? state.leader : monitorId;
        const currentIsLeader = state.isLeader;

        const stateChanged = currentLeader !== lastLeader || currentIsLeader !== lastIsLeader;

        if (stateChanged && lastLeader !== null) {
            const currentX = timeline.tickToX(t);

            // Draw previous segment
            ctx.strokeStyle = CLUSTER_COLORS[lastLeader % CLUSTER_COLORS.length];
            ctx.lineWidth = lastIsLeader ? THICK_LINE : THIN_LINE;
            ctx.moveTo(lastX, y);
            ctx.lineTo(currentX, y);
            ctx.stroke();

            ctx.beginPath();
            lastX = currentX;
        }

        lastLeader = currentLeader;
        lastIsLeader = currentIsLeader;
    }

    // Draw final segment extending to the end of the simulation timeline
    if (lastLeader !== null) {
        const finalX = timeline.tickToX(maxTick + 1);
        ctx.strokeStyle = CLUSTER_COLORS[lastLeader % CLUSTER_COLORS.length];
        ctx.lineWidth = lastIsLeader ? THICK_LINE : THIN_LINE;
        ctx.moveTo(lastX, y);
        ctx.lineTo(finalX, y);
        ctx.stroke();
    }
}

ctx.restore();
