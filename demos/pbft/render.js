if (!timeline || !engine || !engine.history || engine.history.length === 0) return;

ctx.save();
ctx.font = '10px monospace';

// Get all server IDs except the Client
const serverIds = Object.keys(engine.history[0].serverStates).filter(id => id != 0);

for (const sid of serverIds) {
    let lastLogSnapshot = "";

    for (let t = 0; t < engine.history.length; t++) {
        const state = engine.history[t].serverStates[sid];
        if (!state || !state.log) continue;

        // Map the dictionary to a string so we can detect when an entry is added OR deleted
        const logEntries = Object.keys(state.log).map(seq => `[Seq ${seq}] ${state.log[seq].value || '...'}`);
        const currentLogSnapshot = logEntries.join('|');

        if (currentLogSnapshot !== lastLogSnapshot) {
            lastLogSnapshot = currentLogSnapshot;

            const x = timeline.tickToX(t);
            let y = timeline.serverToY(sid) - 25;

            // Draw the current log entries
            for (let i = logEntries.length - 1; i >= 0; i--) {
                const text = logEntries[i];
                const textWidth = ctx.measureText(text).width;
                ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
                ctx.fillRect(x - 1, y - 9, textWidth + 2, 11);

                ctx.fillStyle = '#2e7d32'; // Green
                ctx.fillText(text, x, y);
                y -= 12;
            }

            // THE NICETY: If the log is empty but the Stable Checkpoint advanced, display the GC marker!
            if (logEntries.length === 0 && state.stableCheckpoint > 0) {
                const text = `[GC] Cleared \u2264 Seq ${state.stableCheckpoint}`;
                const textWidth = ctx.measureText(text).width;
                ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
                ctx.fillRect(x - 1, y - 9, textWidth + 2, 11);

                ctx.fillStyle = '#ab47bc'; // Purple
                ctx.fillText(text, x, y);
            }
        }
    }
}
ctx.restore();