/**
 * interactions.js
 * Registers mouse event handlers on the timeline canvas for:
 * - Scrubber dragging
 * - Arrow arrowhead dragging (latency manipulation)
 * - Double-click arrow body (toggle lost)
 * - Double-click server track (toggle crash)
 */

import { toggleCrash } from './engine.js';

export class Interactions {
    constructor(timeline, engine, onScrubberChange) {
        this.timeline = timeline;
        this.engine = engine;
        this.onScrubberChange = onScrubberChange;
        this.canvas = timeline.canvas;

        this.dragging = null; // { type: 'scrubber' | 'arrow', message? }

        this._onMouseDown = this._onMouseDown.bind(this);
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onMouseUp = this._onMouseUp.bind(this);
        this._onDblClick = this._onDblClick.bind(this);

        this.canvas.addEventListener('mousedown', this._onMouseDown);
        this.canvas.addEventListener('mousemove', this._onMouseMove);
        this.canvas.addEventListener('mouseup', this._onMouseUp);
        this.canvas.addEventListener('dblclick', this._onDblClick);
    }

    _getCanvasPos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
        };
    }

    _onMouseDown(e) {
        const { x, y } = this._getCanvasPos(e);

        // Check arrowhead first (higher priority)
        const msg = this.timeline.hitTestArrowhead(x, y);
        if (msg) {
            this.dragging = { type: 'arrow', message: msg };
            this.canvas.style.cursor = 'ew-resize';
            e.preventDefault();
            return;
        }

        // Check scrubber
        if (this.timeline.hitTestScrubber(x, y)) {
            this.dragging = { type: 'scrubber' };
            this.canvas.style.cursor = 'ew-resize';
            e.preventDefault();
            return;
        }
    }

    _onMouseMove(e) {
        const { x, y } = this._getCanvasPos(e);

        if (this.dragging) {
            if (this.dragging.type === 'scrubber') {
                let tick = this.timeline.xToTick(x);
                tick = Math.max(0, Math.min(this.engine.maxTicks, tick));
                this.timeline.scrubberTick = tick;
                this.timeline.draw();
                this.onScrubberChange(tick);
            } else if (this.dragging.type === 'arrow') {
                let tick = this.timeline.xToTick(x);
                const msg = this.dragging.message;
                // Constrain: arrival >= send + 1
                tick = Math.max(msg.sendTick + 1, tick);
                tick = Math.min(this.engine.maxTicks, tick);
                this.engine.setArrivalOverride(msg.id, tick);
                this.engine.recompute();
                this.timeline.resize();
                this.timeline.draw();
                // Re-find the message after recomputation (id may change)
                const newMsg = this.engine.messages.find(
                    m => m.from === msg.from && m.to === msg.to && m.sendTick === msg.sendTick
                );
                if (newMsg) this.dragging.message = newMsg;
                this.onScrubberChange(this.timeline.scrubberTick);
            }
            return;
        }

        // Hover detection for tooltip
        const msg = this.timeline.hitTestArrowBody(x, y)
            || this.timeline.hitTestArrowhead(x, y);
        if (msg) {
            this.timeline.hoveredMessage = msg;
            this.timeline.showTooltip(msg, e.pageX, e.pageY);
            this.canvas.style.cursor = 'pointer';
        } else {
            this.timeline.hoveredMessage = null;
            this.timeline.hideTooltip();
            // Check if near scrubber
            if (this.timeline.hitTestScrubber(x, y)) {
                this.canvas.style.cursor = 'ew-resize';
            } else {
                this.canvas.style.cursor = 'default';
            }
        }
        this.timeline.draw();
    }

    _onMouseUp(e) {
        if (this.dragging) {
            this.dragging = null;
            this.canvas.style.cursor = 'default';
        }
    }

    _onDblClick(e) {
        const { x, y } = this._getCanvasPos(e);

        // Double-click on arrow body → toggle lost
        const msg = this.timeline.hitTestArrowBody(x, y)
            || this.timeline.hitTestArrowhead(x, y);
        if (msg) {
            this.engine.toggleMessageLost(msg.id);
            this.engine.recompute();
            this.timeline.resize();
            this.timeline.draw();
            this.timeline.hideTooltip();
            this.onScrubberChange(this.timeline.scrubberTick);
            return;
        }

        // Double-click on server track → toggle crash
        const serverId = this.timeline.yToServer(y);
        if (serverId >= 0) {
            const tick = this.timeline.xToTick(x);
            if (tick >= 0 && tick <= this.engine.maxTicks) {
                toggleCrash(this.engine.servers[serverId], tick);
                this.engine.recompute();
                this.timeline.resize();
                this.timeline.draw();
                this.onScrubberChange(this.timeline.scrubberTick);
            }
        }
    }

    destroy() {
        this.canvas.removeEventListener('mousedown', this._onMouseDown);
        this.canvas.removeEventListener('mousemove', this._onMouseMove);
        this.canvas.removeEventListener('mouseup', this._onMouseUp);
        this.canvas.removeEventListener('dblclick', this._onDblClick);
    }
}
