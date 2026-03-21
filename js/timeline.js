/**
 * timeline.js
 * Renders the space-time diagram on an HTML5 Canvas.
 * Server tracks, message arrows, crash zones, tick grid, and tooltip.
 */

export const DEFAULT_PIXELS_PER_TICK = 16;
export const TRACK_HEIGHT = 80;
export const TRACK_PADDING_TOP = 50;
export const LABEL_WIDTH = 60;
const INTERACTION_RADIUS = 8;
const STATE_BAND_OFFSET = 22; // below the track line
const ARROWHEAD_SIZE = 7;
const HANDLE_RADIUS = 5;
const MIN_SCALE = 4;
const MAX_SCALE = 64;

export class Timeline {
    constructor(canvas, tooltipEl) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.tooltipEl = tooltipEl;
        this.engine = null;
        this.maxTicks = 100;
        this.scrubberTick = 0;
        this.hoveredMessage = null;
        this.scale = DEFAULT_PIXELS_PER_TICK;

        // Configurable Layout Properties
        this.trackHeight = TRACK_HEIGHT;
        this.trackPaddingTop = TRACK_PADDING_TOP;
        this.stateBandOffset = STATE_BAND_OFFSET;

        // Shift+scroll to zoom
        this.canvas.addEventListener('wheel', (e) => {
            if (!e.shiftKey) return;
            e.preventDefault();
            const container = this.canvas.parentElement;
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            // Tick under cursor before zoom
            const tickUnderCursor = (mouseX + container.scrollLeft - LABEL_WIDTH) / this.scale;

            const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
            this.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.scale * factor));

            this.resize();
            this.draw();

            // Restore scroll so tick under cursor stays in place
            const newX = tickUnderCursor * this.scale + LABEL_WIDTH;
            container.scrollLeft = newX - mouseX;
        }, { passive: false });
    }

    setEngine(engine) {
        this.engine = engine;
        this.maxTicks = engine.maxTicks;
        this.resize();
    }

    resize() {
        if (!this.engine) return;
        const numServers = this.engine.servers.length;
        const width = LABEL_WIDTH + (this.maxTicks + 2) * this.scale;
        const height = this.trackPaddingTop + numServers * this.trackHeight + 40;
        this.canvas.width = width;
        this.canvas.height = height;
        this.canvas.style.width = width + 'px';
        this.canvas.style.height = height + 'px';
    }

    tickToX(tick) {
        return LABEL_WIDTH + tick * this.scale;
    }

    xToTick(x) {
        return Math.round((x - LABEL_WIDTH) / this.scale);
    }

    serverToY(serverId) {
        return this.trackPaddingTop + serverId * this.trackHeight + this.trackHeight / 2;
    }

    yToServer(y) {
        const idx = Math.round((y - this.trackPaddingTop - this.trackHeight / 2) / this.trackHeight);
        if (idx < 0 || idx >= this.engine.servers.length) return -1;
        return idx;
    }

    draw() {
        if (!this.engine) return;
        const ctx = this.ctx;
        const { servers, messages } = this.engine;

        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        this._drawTickGrid(ctx);
        this._drawTracks(ctx, servers);
        this._drawStateBands(ctx, servers);
        this._drawMessages(ctx, messages);

        // Invoke custom render callback if injected via demo configuration
        if (typeof this.customRender === 'function') {
            try {
                this.customRender(ctx, this, this.engine);
            } catch (e) {
                console.error("Custom render error:", e);
            }
        }

        if (!this.hideScrubber) {
            this._drawScrubber(ctx);
        }
    }

    _drawTickGrid(ctx) {
        ctx.save();
        ctx.strokeStyle = '#e0e0e0';
        ctx.lineWidth = 0.5;
        ctx.fillStyle = '#999';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';

        for (let t = 0; t <= this.maxTicks; t += 5) {
            const x = this.tickToX(t);
            ctx.beginPath();
            ctx.moveTo(x, this.trackPaddingTop - 15);
            ctx.lineTo(x, this.canvas.height);
            ctx.stroke();
            ctx.fillText(t.toString(), x, this.trackPaddingTop - 20);
        }
        ctx.restore();
    }

    _drawTracks(ctx, servers) {
        ctx.save();
        for (const server of servers) {
            const y = this.serverToY(server.id);

            // Label
            ctx.fillStyle = server.color || '#333';
            ctx.font = 'bold 12px monospace';
            ctx.textAlign = 'right';
            ctx.fillText(server.name, LABEL_WIDTH - 10, y + 4);

            // Track line — draw per-segment to handle crash zones
            let lastTick = 0;
            const intervals = [...server.crashIntervals].sort((a, b) => a[0] - b[0]);

            for (const [down, up] of intervals) {
                // Draw normal segment before crash
                if (lastTick < down) {
                    this._drawTrackSegment(ctx, lastTick, down, y, false, server.color || '#888');
                }
                // Draw crash segment
                const end = up !== null ? up : this.maxTicks + 1;
                this._drawTrackSegment(ctx, down, end, y, true, server.color || '#888');
                lastTick = end;
            }
            // Draw remaining normal segment
            if (lastTick <= this.maxTicks) {
                this._drawTrackSegment(ctx, lastTick, this.maxTicks + 1, y, false, server.color || '#888');
            }
        }
        ctx.restore();
    }

    _drawTrackSegment(ctx, fromTick, toTick, y, isCrashed, color) {
        const x1 = this.tickToX(fromTick);
        const x2 = this.tickToX(toTick);

        if (isCrashed) {
            // Crashed zone background
            ctx.fillStyle = 'rgba(200, 200, 200, 0.15)';
            ctx.fillRect(x1, y - this.trackHeight / 2 + 5, x2 - x1, this.trackHeight - 10);

            ctx.strokeStyle = '#bbb';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
        } else {
            ctx.strokeStyle = color;
            ctx.lineWidth = 2.0;
            ctx.setLineDash([]);
        }

        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    _drawStateBands(ctx, servers) {
        if (!this.engine || this.engine.history.length === 0) return;
        ctx.save();

        const fallbackPalette = [
            '#90a4ae', '#78909c', '#607d8b', '#546e7a',
            '#b0bec5', '#8d99ae', '#6b7b8d',
        ];

        for (const server of servers) {
            const y = this.serverToY(server.id) + this.stateBandOffset;

            // Collect runs of the same FSM state
            const runs = [];
            let currentRun = null;

            for (let tick = 0; tick < this.engine.history.length; tick++) {
                const snapshot = this.engine.history[tick];
                const sState = snapshot.serverStates[server.id];
                const fsmData = sState && sState.fsm;
                const fsmState = fsmData ? fsmData.state : null;

                if (fsmState === null) {
                    // No FSM state at this tick — close current run
                    if (currentRun) {
                        runs.push(currentRun);
                        currentRun = null;
                    }
                    continue;
                }

                if (currentRun && currentRun.state === fsmState) {
                    currentRun.endTick = tick;
                } else {
                    if (currentRun) runs.push(currentRun);
                    currentRun = {
                        state: fsmState,
                        startTick: tick,
                        endTick: tick,
                        colors: fsmData.colors || {},
                    };
                }
            }
            if (currentRun) runs.push(currentRun);

            // Draw each run
            let fallbackIdx = 0;
            const assignedFallbacks = {};

            for (const run of runs) {
                const x1 = this.tickToX(run.startTick);
                const x2 = this.tickToX(run.endTick + 1);

                // Get color: author-defined or fallback
                let color = run.colors[run.state];
                if (!color) {
                    if (!assignedFallbacks[run.state]) {
                        assignedFallbacks[run.state] = fallbackPalette[fallbackIdx % fallbackPalette.length];
                        fallbackIdx++;
                    }
                    color = assignedFallbacks[run.state];
                }

                // Band rectangle
                ctx.fillStyle = color;
                ctx.globalAlpha = 0.35;
                ctx.fillRect(x1, y, x2 - x1, this.stateBandHeight);

                // Border
                ctx.globalAlpha = 0.6;
                ctx.strokeStyle = color;
                ctx.lineWidth = 1;
                ctx.strokeRect(x1, y, x2 - x1, this.stateBandHeight);

                // Label (only if run spans enough pixels)
                const spanPx = x2 - x1;
                if (spanPx > 24 && (!this.engine || !this.engine.hideStateLabels)) {
                    ctx.globalAlpha = 0.85;
                    ctx.fillStyle = '#333';
                    ctx.font = '9px monospace';
                    ctx.textAlign = 'left';
                    const label = run.state;
                    const maxChars = Math.floor(spanPx / 6) - 1;
                    const clipped = label.length > maxChars
                        ? label.slice(0, Math.max(1, maxChars - 1)) + '…'
                        : label;
                    ctx.fillText(clipped, x1 + 3, y + this.stateBandHeight - 3);
                }
            }
        }

        ctx.globalAlpha = 1;
        ctx.restore();
    }

    _drawMessages(ctx, messages) {
        ctx.save();
        for (const msg of messages) {
            const x1 = this.tickToX(msg.sendTick);
            const y1 = this.serverToY(msg.from);
            const x2 = this.tickToX(msg.arrivalTick);
            const y2 = this.serverToY(msg.to);

            const isHovered = this.hoveredMessage && this.hoveredMessage.id === msg.id;

            if (msg.lost) {
                ctx.strokeStyle = '#cc4444';
                ctx.fillStyle = '#cc4444';
                ctx.lineWidth = isHovered ? 2 : 1;
                ctx.setLineDash([4, 3]);
                ctx.globalAlpha = 0.5;
            } else {
                ctx.strokeStyle = '#444';
                ctx.fillStyle = '#444';
                ctx.lineWidth = isHovered ? 2.5 : 1.5;
                ctx.setLineDash([]);
                ctx.globalAlpha = 1;
            }

            // Arrow line
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();

            // Arrowhead
            if (!msg.lost) {
                const angle = Math.atan2(y2 - y1, x2 - x1);
                ctx.beginPath();
                ctx.moveTo(x2, y2);
                ctx.lineTo(
                    x2 - ARROWHEAD_SIZE * Math.cos(angle - Math.PI / 6),
                    y2 - ARROWHEAD_SIZE * Math.sin(angle - Math.PI / 6)
                );
                ctx.lineTo(
                    x2 - ARROWHEAD_SIZE * Math.cos(angle + Math.PI / 6),
                    y2 - ARROWHEAD_SIZE * Math.sin(angle + Math.PI / 6)
                );
                ctx.closePath();
                ctx.fill();
            }

            // Draggable handle (circle at arrowhead)
            ctx.globalAlpha = isHovered ? 0.9 : 0.5;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.arc(x2, y2, HANDLE_RADIUS, 0, Math.PI * 2);
            ctx.fill();

            ctx.globalAlpha = 1;
            ctx.setLineDash([]);
        }
        ctx.restore();
    }

    _drawScrubber(ctx) {
        const x = this.tickToX(this.scrubberTick);
        ctx.save();
        ctx.strokeStyle = '#2a7a8a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, this.trackPaddingTop - 15);
        ctx.lineTo(x, this.canvas.height);
        ctx.stroke();

        // Scrubber handle (triangle at top)
        ctx.fillStyle = '#2a7a8a';
        ctx.beginPath();
        ctx.moveTo(x - 8, this.trackPaddingTop - 20);
        ctx.lineTo(x + 8, this.trackPaddingTop - 20);
        ctx.lineTo(x, this.trackPaddingTop - 10);
        ctx.closePath();
        ctx.fill();

        // Tick label
        ctx.fillStyle = '#2a7a8a';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`t=${this.scrubberTick}`, x, this.trackPaddingTop - 25);
        ctx.restore();
    }

    /**
     * Hit-test: which message's arrowhead is near (x, y)?
     */
    hitTestArrowhead(x, y) {
        if (!this.engine) return null;
        for (const msg of this.engine.messages) {
            const ax = this.tickToX(msg.arrivalTick);
            const ay = this.serverToY(msg.to);
            const dx = x - ax;
            const dy = y - ay;
            if (dx * dx + dy * dy <= (HANDLE_RADIUS + 4) ** 2) {
                return msg;
            }
        }
        return null;
    }

    /**
     * Hit-test: which message's body line is near (x, y)?
     */
    hitTestArrowBody(x, y) {
        if (!this.engine) return null;
        for (const msg of this.engine.messages) {
            const x1 = this.tickToX(msg.sendTick);
            const y1 = this.serverToY(msg.from);
            const x2 = this.tickToX(msg.arrivalTick);
            const y2 = this.serverToY(msg.to);
            const dist = pointToSegmentDist(x, y, x1, y1, x2, y2);
            if (dist < 6) return msg;
        }
        return null;
    }

    /**
     * Is the scrubber handle near (x, y)?
     */
    hitTestScrubber(x, y) {
        const sx = this.tickToX(this.scrubberTick);
        return Math.abs(x - sx) < 12;
    }

    /**
     * Show tooltip for a message near (pageX, pageY).
     */
    showTooltip(msg, pageX, pageY) {
        if (!this.tooltipEl) return;
        this.tooltipEl.style.display = 'block';
        this.tooltipEl.style.left = (pageX + 12) + 'px';
        this.tooltipEl.style.top = (pageY - 10) + 'px';
        this.tooltipEl.innerHTML = `
      <strong>${this.engine.servers[msg.from]?.name} → ${this.engine.servers[msg.to]?.name}</strong><br>
      Send: t=${msg.sendTick} &nbsp; Arrive: t=${msg.arrivalTick}<br>
      ${msg.lost ? '<span style="color:#c44">LOST</span><br>' : ''}
      <code>${JSON.stringify(msg.payload)}</code>
    `;
    }

    hideTooltip() {
        if (this.tooltipEl) this.tooltipEl.style.display = 'none';
    }
}

/** Point-to-line-segment distance */
function pointToSegmentDist(px, py, x1, y1, x2, y2) {
    const A = px - x1, B = py - y1, C = x2 - x1, D = y2 - y1;
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let t = lenSq > 0 ? dot / lenSq : -1;
    t = Math.max(0, Math.min(1, t));
    const nx = x1 + t * C, ny = y1 + t * D;
    return Math.sqrt((px - nx) ** 2 + (py - ny) ** 2);
}
