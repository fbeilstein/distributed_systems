if (!timeline.engine.history || timeline.engine.history.length === 0) return;

const scrubberX = timeline.tickToX(timeline.scrubberTick);
const historyState = engine.history[timeline.scrubberTick].serverStates;

const replicas = [1, 2, 3];
const labels = { 1: 'A', 2: 'B', 3: 'C' };
const colors = { 1: '#4fc3f7', 2: '#81c784', 3: '#ffb74d' };

const boxSize = 8;
const padding = 2;
const numBoxes = 15;
const matrixWidth = 20 + numBoxes * (boxSize + padding);

let xOffset = scrubberX + 35;
if (xOffset + matrixWidth > timeline.canvas.width) {
    xOffset = scrubberX - matrixWidth - 5;
}

const globalMax = { 1: 0, 2: 0, 3: 0 };
replicas.forEach(sid => {
    const st = historyState[sid];
    if (st && st.vectorMatrix) {
        Object.keys(st.vectorMatrix).forEach(originId => {
            const arr = st.vectorMatrix[originId];
            if (arr && arr.length > 0) {
                const m = Math.max(...arr);
                if (m > globalMax[originId]) globalMax[originId] = m;
            }
        });
    }
});

ctx.save();
ctx.font = '10px monospace';

replicas.forEach(sid => {
    const st = historyState[sid];
    if (st && st.vectorMatrix) {
        const startY = timeline.serverToY(sid) + 12;

        ctx.fillStyle = 'rgba(30, 30, 30, 0.35)';
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 1;
        ctx.fillRect(xOffset - 25, startY - 5, matrixWidth + 10, 40);
        ctx.strokeRect(xOffset - 25, startY - 5, matrixWidth + 10, 40);

        Object.keys(st.vectorMatrix).forEach((originId, idx) => {
            const arr = st.vectorMatrix[originId] || [];
            const rowY = startY + idx * (boxSize + padding);

            ctx.fillStyle = colors[originId] || '#fff';
            ctx.fillText(labels[originId] + ':', xOffset - 20, rowY + 8);

            const maxSeq = Math.min(Math.max(globalMax[originId], 1), numBoxes);

            for (let s = 1; s <= maxSeq; s++) {
                const boxX = xOffset + (s - 1) * (boxSize + padding);
                if (arr.includes(s)) {
                    ctx.fillStyle = colors[originId] || '#fff';
                    ctx.fillRect(boxX, rowY, boxSize, boxSize);
                } else {
                    ctx.strokeStyle = '#ef5350';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([2, 1]);
                    ctx.strokeRect(boxX, rowY, boxSize, boxSize);
                    ctx.setLineDash([]);
                }
            }
        });
    }
});
ctx.restore();
