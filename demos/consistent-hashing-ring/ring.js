/**
 * Consistent Hashing Engine & Visualizer
 * Ported from test_cycle.py logic
 */

class RingEngine {
    constructor() {
        this.nodes = []; // Servers currently in the cluster
        this.vnodeMap = []; // { pos, nodeId }
        this.totalKeys = 1000;
        this.keys = [];
        this.vnodesPerNode = 1;
        this.colors = ['#2196f3', '#4caf50', '#ff9800', '#f44336', '#9c27b0', '#00bcd4', '#e91ed8'];
    }

    /**
     * test_cycle.py: on_slider logic
     * Divides the ring into equal segments, adds jitter, and randomly 
     * assigns exactly `vnodes_per_server` segments to each server.
     */
    recomputeVNodes() {
        const N = this.nodes.length;
        const V = this.vnodesPerNode;
        const totalVNodes = N * V;

        if (totalVNodes === 0) {
            this.vnodeMap = [];
            return;
        }

        const sliceWidth = 1.0 / totalVNodes;
        const maxJitter = sliceWidth * 0.2;

        this.vnodeMap = [];
        let assignments = [];

        // Prepare list of assignments (exactly V per server)
        for (let s = 0; s < N; s++) {
            for (let v = 0; v < V; v++) {
                assignments.push(this.nodes[s].id);
            }
        }

        // Shuffle assignments randomly (Fisher-Yates)
        for (let i = assignments.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [assignments[i], assignments[j]] = [assignments[j], assignments[i]];
        }

        // Generate jittered equal segments
        for (let i = 0; i < totalVNodes; i++) {
            const baseAngle = i * sliceWidth;
            const jitter = (Math.random() * 2 - 1) * maxJitter;
            const angle = (baseAngle + jitter + 1.0) % 1.0;
            this.vnodeMap.push({ pos: angle, nodeId: assignments[i] });
        }

        // Sort by position for efficient owner finding
        this.vnodeMap.sort((a, b) => a.pos - b.pos);
    }

    /**
     * test_cycle.py: on_plus logic
     * Chooses random angles and assigns them to the new server.
     */
    addServer() {
        const nextId = this.nodes.length + 1;
        const color = this.colors[(nextId - 1) % this.colors.length];
        const newServerId = `Server ${nextId}`;

        this.nodes.push({ id: newServerId, color });

        // If it's the first servers, we might want a full equal recompute
        // But test_cycle.py says on_plus adds random angles.
        // I'll stick to the "Bite" behavior for consistency if nodes already exist.
        if (this.nodes.length === 1) {
            this.recomputeVNodes();
        } else {
            // Greedy Gap Splitting for balance
            for (let i = 0; i < this.vnodesPerNode; i++) {
                let largestGap = -1;
                let insertPos = Math.random();

                if (this.vnodeMap.length === 0) {
                    insertPos = Math.random();
                } else {
                    for (let j = 0; j < this.vnodeMap.length; j++) {
                        const curr = this.vnodeMap[j].pos;
                        const next = this.vnodeMap[(j + 1) % this.vnodeMap.length].pos;
                        let gap = (next - curr + 1.0) % 1.0;
                        if (gap === 0 && this.vnodeMap.length === 1) gap = 1.0;

                        if (gap > largestGap) {
                            largestGap = gap;
                            // Add a tiny bit of jitter to avoid perfect symmetry if desired, 
                            // but middle of the gap is best for balance.
                            insertPos = (curr + gap / 2.0) % 1.0;
                        }
                    }
                }

                this.vnodeMap.push({ pos: insertPos, nodeId: newServerId });
                this.vnodeMap.sort((a, b) => a.pos - b.pos);
            }
        }

        if (this.keys.length === 0) this.generateKeys();
        else this.recomputeKeys();
    }

    /**
     * test_cycle.py: on_minus logic
     * Filters out the most recently added server.
     */
    removeServer() {
        if (this.nodes.length <= 1) return;
        const serverToRemove = this.nodes.pop().id;
        this.vnodeMap = this.vnodeMap.filter(v => v.nodeId !== serverToRemove);
        this.recomputeKeys();
    }

    findOwner(pos) {
        if (this.vnodeMap.length === 0) return null;
        for (const v of this.vnodeMap) {
            if (v.pos >= pos) return v.nodeId;
        }
        return this.vnodeMap[0].nodeId;
    }

    generateKeys() {
        this.keys = [];
        for (let i = 0; i < this.totalKeys; i++) {
            const pos = Math.random();
            this.keys.push({
                id: i,
                pos,
                owner: this.findOwner(pos),
                prevOwner: null,
                migrationTick: 0
            });
        }
    }

    recomputeKeys(animate = true) {
        this.keys.forEach(key => {
            const newOwner = this.findOwner(key.pos);
            if (newOwner !== key.owner) {
                if (animate) {
                    key.prevOwner = key.owner;
                    key.migrationTick = 60;
                }
                key.owner = newOwner;
            }
        });
    }

    tick() {
        this.keys.forEach(key => {
            if (key.migrationTick > 0) {
                key.migrationTick--;
                if (key.migrationTick === 0) key.prevOwner = null;
            }
        });
    }

    getStats() {
        const moved = this.keys.filter(k => k.prevOwner !== null).length;
        const migrationPercent = (moved / this.totalKeys) * 100;

        if (this.nodes.length === 0) return { migrationPercent: 0, counts: {} };

        const counts = {};
        this.nodes.forEach(n => counts[n.id] = 0);
        this.keys.forEach(k => { if (counts[k.owner] !== undefined) counts[k.owner]++; });

        return { migrationPercent, counts };
    }
}

class Visualizer {
    constructor(canvas, engine) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.engine = engine;

        window.addEventListener('resize', () => this.resize());
        this.resize();
        this.animate();
    }

    resize() {
        const parent = this.canvas.parentElement;
        this.canvas.width = parent.clientWidth * window.devicePixelRatio;
        this.canvas.height = parent.clientHeight * window.devicePixelRatio;
        this.canvas.style.width = `${parent.clientWidth}px`;
        this.canvas.style.height = `${parent.clientHeight}px`;
    }

    updateLegend(counts) {
        const container = document.getElementById('legend-container');
        if (!container) return;
        container.innerHTML = '';
        this.engine.nodes.forEach(node => {
            const count = counts[node.id] || 0;
            container.innerHTML += `
                <div class="legend-item">
                    <div class="legend-color" style="color: ${node.color}; background-color: ${node.color}"></div>
                    <span class="legend-name">${node.id}</span>
                    <span class="legend-count">${count}</span>
                </div>
            `;
        });
    }

    animate() {
        this.engine.tick();
        this.draw();

        const stats = this.engine.getStats();
        const hasKeys = this.engine.keys.length > 0;
        if (stats.migrationPercent === 0 || (hasKeys && this.engine.keys[0].migrationTick % 5 === 0)) {
            this.updateLegend(stats.counts);
        }

        requestAnimationFrame(() => this.animate());
    }

    draw() {
        const { ctx, canvas, engine } = this;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (engine.vnodeMap.length === 0) return;

        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const radius = Math.min(canvas.width, canvas.height) * 0.40;
        const pieThickness = 45;

        // Guard against negative radius (common during Reveal.js initial layout)
        if (radius < pieThickness / 2 + 5) return;

        const stats = this.engine.getStats();

        // HUD
        if (stats.migrationPercent > 0) {
            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const opacity = Math.min(1, stats.migrationPercent / 5 + 0.3);
            ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
            ctx.font = 'bold 44px Inter';
            ctx.fillText(`${stats.migrationPercent.toFixed(1)}%`, centerX, centerY - 10);
            ctx.font = '500 14px Inter';
            ctx.fillStyle = `rgba(255, 255, 255, ${opacity * 0.6})`;
            ctx.fillText('RELOCATING DATA', centerX, centerY + 25);
            ctx.restore();
        }

        // Segments
        ctx.lineWidth = pieThickness;
        for (let i = 0; i < engine.vnodeMap.length; i++) {
            const curr = engine.vnodeMap[i];
            const prev = engine.vnodeMap[(i - 1 + engine.vnodeMap.length) % engine.vnodeMap.length];
            const node = engine.nodes.find(n => n.id === curr.nodeId);

            let startPos = prev.pos;
            let endPos = curr.pos;

            if (endPos < startPos) startPos -= 1;

            const startAngle = startPos * Math.PI * 2 - Math.PI / 2;
            const endAngle = endPos * Math.PI * 2 - Math.PI / 2;

            // 1. Colored Segment Arc
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, startAngle, endAngle);
            ctx.strokeStyle = node ? node.color : '#333';
            ctx.lineWidth = pieThickness;
            ctx.globalAlpha = 0.6;
            ctx.stroke();

            // 1b. Segment Border (Matching Python's edgecolor)
            ctx.save();
            ctx.lineWidth = 1;
            ctx.strokeStyle = '#0f1115'; // Match background
            ctx.globalAlpha = 1.0;
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius - pieThickness / 2, startAngle, endAngle);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius + pieThickness / 2, startAngle, endAngle);
            ctx.stroke();
            ctx.restore();

            // 2. Partition Line (Radial spoke separating segments)
            const innerR = radius - pieThickness / 2;
            const outerR = radius + pieThickness / 2;
            ctx.beginPath();
            ctx.moveTo(centerX + Math.cos(endAngle) * innerR, centerY + Math.sin(endAngle) * innerR);
            ctx.lineTo(centerX + Math.cos(endAngle) * outerR, centerY + Math.sin(endAngle) * outerR);
            ctx.lineWidth = 3;
            ctx.strokeStyle = '#ffffff';
            ctx.globalAlpha = 1.0;
            ctx.stroke();

            // 3. Small cap at the end for polish
            ctx.beginPath();
            ctx.arc(centerX + Math.cos(endAngle) * outerR, centerY + Math.sin(endAngle) * outerR, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
        }

        // Keys
        ctx.globalAlpha = 1.0;
        engine.keys.forEach(key => {
            const angle = key.pos * Math.PI * 2 - Math.PI / 2;
            const jitter = (key.id % (pieThickness - 10)) - ((pieThickness - 10) / 2);
            const kRadius = radius + jitter;

            ctx.beginPath();
            ctx.arc(centerX + Math.cos(angle) * kRadius, centerY + Math.sin(angle) * kRadius, 2, 0, Math.PI * 2);

            if (key.migrationTick > 0) {
                ctx.fillStyle = '#ffffff';
                ctx.shadowBlur = 10;
                ctx.shadowColor = '#ffffff';
            } else {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
                ctx.shadowBlur = 0;
            }
            ctx.fill();
        });
        ctx.shadowBlur = 0;
    }
}

// UI Binding
let engine;
document.addEventListener('DOMContentLoaded', () => {
    engine = new RingEngine();
    const canvas = document.getElementById('ring-canvas');
    new Visualizer(canvas, engine);

    // Initial 3 servers
    for (let i = 1; i <= 3; i++) {
        engine.nodes.push({ id: `Server ${i}`, color: engine.colors[i - 1] });
    }
    engine.recomputeVNodes(); // Perfect balance for "Day 0"
    engine.generateKeys();
});

function addNode() {
    engine.addServer();
}

function removeNode() {
    engine.removeServer();
}

function updateVNodes(val) {
    engine.vnodesPerNode = parseInt(val);
    document.getElementById('vnode-display').textContent = val;
    engine.recomputeVNodes();
    engine.recomputeKeys(false); // No animation on slider change
}
