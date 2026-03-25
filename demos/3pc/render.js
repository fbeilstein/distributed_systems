if (!timeline || !engine || !engine.history || engine.history.length === 0) return;

ctx.save();
ctx.font = '16px monospace';
ctx.textAlign = 'left';
ctx.textBaseline = 'middle';

const maxTick = engine.history.length - 1;

// Loop through the 3 cohorts (DB-1=1, DB-2=2, DB-3=3)
for (let sid = 1; sid <= 3; sid++) {
    let prevCount = 0;

    // Scan time forward over the entire known history
    for (let t = 0; t <= maxTick; t++) {
        const frame = engine.history[t];
        if (!frame) continue;

        const states = frame.serverStates || {};
        const state = states[sid] || states[String(sid)];
        if (!state) continue;

        const historyArr = state.history || [];
        const currCount = historyArr.length;

        // If history array grew, a transaction outcome was finalized at tick `t`.
        if (currCount > prevCount) {
            const newEntry = historyArr[currCount - 1] || "";

            const x = timeline.tickToX(t);
            const y = timeline.serverToY(sid);

            // Draw ABOVE the track line to avoid overlapping the state band (which is below the line)
            const targetY = y - 12;

            if (typeof newEntry === 'string') {
                if (newEntry.includes(':commit')) {
                    ctx.fillStyle = '#4CAF50'; // Green Check
                    ctx.fillText('✅', x + 5, targetY);
                } else if (newEntry.includes(':abort')) {
                    ctx.fillStyle = '#F44336'; // Red Cross
                    ctx.fillText('❌', x + 5, targetY);
                }
            }
            prevCount = currCount;
        }
    }
}

ctx.restore();
