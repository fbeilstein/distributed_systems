// Generalized Paxos — Custom Matrix Renderer

if (!timeline.engine.history || timeline.engine.history.length === 0) return;

const scrubberX = timeline.tickToX(timeline.scrubberTick);
const historyState = engine.history[timeline.scrubberTick].serverStates;

const acceptors = [0, 1, 2];
const labels = { 0: 'A1', 1: 'A2', 2: 'A3' };

const boxWidth = 30;
const boxHeight = 15;
const padding = 2;
const numRegisters = 5;
const matrixWidth = 30 + numRegisters * (boxWidth + padding);

let xOffset = scrubberX + 35;
if (xOffset + matrixWidth > timeline.canvas.width) {
    xOffset = scrubberX - matrixWidth - 5;
}

ctx.save();
ctx.font = '10px sans-serif';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';

acceptors.forEach(sid => {
    const st = historyState[sid];
    if (st && st.ui_registers) {
        const startY = timeline.serverToY(sid) + 12;

        // Draw Background Panel
        ctx.fillStyle = 'rgba(240, 245, 250, 0.9)';
        ctx.strokeStyle = '#90a4ae';
        ctx.lineWidth = 1;
        ctx.fillRect(xOffset - 30, startY - 5, matrixWidth + 10, 25);
        ctx.strokeRect(xOffset - 30, startY - 5, matrixWidth + 10, 25);

        // Draw Row Label
        ctx.fillStyle = '#455a64';
        ctx.fillText(labels[sid], xOffset - 15, startY + 7);

        // Draw the 5 Registers
        st.ui_registers.forEach((regState, idx) => {
            const boxX = xOffset + idx * (boxWidth + padding);
            const boxY = startY - 2;

            if (regState === 'unwritten') {
                ctx.fillStyle = '#eceff1'; // Empty/Gray
                ctx.strokeStyle = '#b0bec5';
                ctx.setLineDash([2, 2]);
            } else if (regState === 'nil') {
                ctx.fillStyle = '#ffcdd2'; // Red-ish for 'nil'
                ctx.strokeStyle = '#ef5350';
                ctx.setLineDash([]);
            } else {
                ctx.fillStyle = '#c8e6c9'; // Green-ish for a decided Value
                ctx.strokeStyle = '#66bb6a';
                ctx.setLineDash([]);
            }

            ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
            ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);

            // Draw text inside the register
            ctx.fillStyle = '#37474f';
            let displayText = regState === 'unwritten' ? '' : regState;
            ctx.fillText(displayText, boxX + boxWidth / 2, boxY + boxHeight / 2);
        });
    }
});

ctx.restore();