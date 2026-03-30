if (!timeline || !engine || !engine.history || engine.history.length === 0) return;

ctx.save();
const maxTick = engine.history.length - 1;

// Use a scale of 6 and a small offset from the monitor's track (SID 0)
const SCALE = 15;
const BASE_OFFSET = 0; // Pixels above the track line
const monitorY = timeline.serverToY(0) + BASE_OFFSET;

const colors = {
    1: '#ffb74d',
    2: '#81c784',
    3: '#64b5f6',
    4: '#ba68c8'
};

// 1. Draw a threshold line at configured Phi
const phiThreshold = (engine.config && engine.config.phiThreshold) || 8;
ctx.beginPath();
ctx.setLineDash([5, 5]);
ctx.strokeStyle = 'rgba(255, 0, 0, 0.4)';
ctx.lineWidth = 1;
const thresholdY = monitorY - (phiThreshold * SCALE);
ctx.moveTo(timeline.tickToX(0), thresholdY);
ctx.lineTo(timeline.tickToX(maxTick), thresholdY);
ctx.stroke();
ctx.setLineDash([]);

// 2. Plot Phi curves for each target
for (let sid = 1; sid <= 4; sid++) {
    ctx.beginPath();
    ctx.strokeStyle = colors[sid];
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';

    let first = true;
    for (let t = 0; t <= maxTick; t++) {
        const frame = engine.history[t];
        if (!frame || !frame.serverStates) continue;

        const monitorState = frame.serverStates[0];
        if (!monitorState || !monitorState.phis) continue;

        const phi = parseFloat(monitorState.phis[sid]) || 0;
        const x = timeline.tickToX(t);
        const y = monitorY - (phi * SCALE);

        if (first) {
            ctx.moveTo(x, y);
            first = false;
        } else {
            ctx.lineTo(x, y);
        }
    }
    ctx.stroke();

    // 2.5 Fill the area under the curve for better visibility
    ctx.lineTo(timeline.tickToX(maxTick), monitorY);
    ctx.lineTo(timeline.tickToX(0), monitorY);
    ctx.fillStyle = colors[sid] + '33'; // 20% alpha
    ctx.fill();

    // 3. Label the end of the line if it's the last frame
    if (maxTick >= 0) {
        const lastFrame = engine.history[maxTick];
        if (lastFrame && lastFrame.serverStates && lastFrame.serverStates[0]) {
            const lastPhi = parseFloat(lastFrame.serverStates[0].phis[sid]) || 0;
            ctx.fillStyle = colors[sid];
            ctx.font = 'bold 10px sans-serif';
            ctx.fillText(sid, timeline.tickToX(maxTick) + 4, monitorY - (lastPhi * SCALE) + 3);
        }
    }
}

ctx.restore();
