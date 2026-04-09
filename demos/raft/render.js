// Ensure the engine has generated history before trying to draw
if (!timeline || !engine || !engine.history || engine.history.length === 0) return;

ctx.save();
ctx.font = '10px monospace';

// Dynamically get all server IDs from the first tick's history
const serverIds = Object.keys(engine.history[0].serverStates);

for (const sid of serverIds) {
    // We use a snapshot string to detect when the log actually changes
    let lastLogSnapshot = "";

    for (let t = 0; t < engine.history.length; t++) {
        const state = engine.history[t].serverStates[sid];

        // Skip if the node is dead or hasn't initialized its log
        if (!state || !state.log) continue;

        const currentLogSnapshot = JSON.stringify(state.log);

        // Did the log change on this exact tick?
        if (currentLogSnapshot !== lastLogSnapshot) {
            lastLogSnapshot = currentLogSnapshot;

            const x = timeline.tickToX(t);
            let y = timeline.serverToY(sid) - 25; // Start drawing 25px above the track line

            // Draw the log entries from newest (bottom) to oldest (top)
            for (let i = state.log.length - 1; i >= 0; i--) {
                const entry = state.log[i];

                // NICETY: Color code based on the commit index!
                if (i <= state.commitIndex) {
                    ctx.fillStyle = '#2e7d32'; // Committed: Dark Green
                } else {
                    ctx.fillStyle = '#9e9e9e'; // Uncommitted: Gray
                }

                // Format: [Index] T:Term Cmd
                const text = `[${i}] T${entry.term}:${entry.cmd}`;

                // Draw a tiny white background to make the text readable over grid lines
                const textWidth = ctx.measureText(text).width;
                ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
                ctx.fillRect(x - 1, y - 9, textWidth + 2, 11);

                // Re-apply text color and draw the record
                ctx.fillStyle = (i <= state.commitIndex) ? '#2e7d32' : '#9e9e9e';
                ctx.fillText(text, x, y);

                y -= 12; // Move up 12px for the next line
            }
        }
    }
}

ctx.restore();