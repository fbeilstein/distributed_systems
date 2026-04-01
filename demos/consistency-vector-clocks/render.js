if (!engine.history || engine.history.length === 0) return;

ctx.save();
ctx.textAlign = 'left';
ctx.font = 'bold 9px monospace';
ctx.fillStyle = '#222';

for (const server of engine.servers) {
    const y = timeline.serverToY(server.id) + timeline.stateBandOffset;

    let currentRunStart = null;
    let currentVcStr = null;
    let currentVc = null;

    for (let t = 0; t <= engine.maxTicks; t++) {
        const snap = engine.history[t];
        if (!snap) continue;
        const sState = snap.serverStates[server.id];

        // If the node crashed or has no state, we skip drawing the vector
        if (!sState || !sState.vc) {
            if (currentVcStr !== null) {
                drawVerticalVc(ctx, timeline, currentRunStart, t, y, currentVc);
                currentVcStr = null;
                currentRunStart = null;
            }
            continue;
        }

        const vcStr = sState.vc.join(',');
        if (vcStr !== currentVcStr) {
            if (currentVcStr !== null) {
                drawVerticalVc(ctx, timeline, currentRunStart, t, y, currentVc);
            }
            currentRunStart = t;
            currentVcStr = vcStr;
            currentVc = sState.vc;
        }
    }

    if (currentVcStr !== null) {
        drawVerticalVc(ctx, timeline, currentRunStart, engine.maxTicks + 1, y, currentVc);
    }
}

ctx.restore();

function drawVerticalVc(ctx, timeline, startTick, endTick, y, vc) {
    const x1 = timeline.tickToX(startTick);
    const x2 = timeline.tickToX(endTick);
    const spanPx = x2 - x1;

    if (spanPx > 10) {
        // Drop the array column right against the start-tick edge natively to emphasize transition geometry
        const cx = x1 + 3;

        ctx.globalAlpha = 0.90;

        const gap = 36 / Math.max(1, vc.length);
        for (let i = 0; i < vc.length; i++) {
            ctx.fillText(vc[i], cx, y + gap * (i + 1));
        }
    }
}
