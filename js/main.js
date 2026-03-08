/**
 * main.js
 * Bootstrap: parse URL params, initialize engine, wire up all components.
 */

import { Engine } from './engine.js';
import { Timeline } from './timeline.js';
import { Interactions } from './interactions.js';
import { StateInspector } from './state-inspector.js';
import { CodeEditor, DEFAULT_CODE } from './code-editor.js';

// --- Parse URL Parameters ---
const params = new URLSearchParams(window.location.search);
const SEED = parseInt(params.get('seed') || '42', 10);
const NUM_NODES = parseInt(params.get('nodes') || '3', 10);
const MAX_TICKS = parseInt(params.get('ticks') || '100', 10);
const CODE_URL = params.get('code') || null;

// --- Initialize Engine ---
const engine = new Engine(SEED, MAX_TICKS);
for (let i = 0; i < NUM_NODES; i++) {
    engine.addServer();
}

// --- DOM Elements ---
const canvas = document.getElementById('timeline-canvas');
const tooltipEl = document.getElementById('tooltip');
const inspectorEl = document.getElementById('state-inspector');
const modalEl = document.getElementById('code-editor-modal');
const addBtn = document.getElementById('btn-add-server');
const removeBtn = document.getElementById('btn-remove-server');
const seedDisplay = document.getElementById('seed-display');
const tickDisplay = document.getElementById('tick-display');

if (seedDisplay) seedDisplay.textContent = `Seed: ${SEED}`;

// --- Initialize Components ---
const timeline = new Timeline(canvas, tooltipEl);
timeline.setEngine(engine);

const stateInspector = new StateInspector(inspectorEl, engine, (serverId) => {
    codeEditor.open(serverId);
});

const codeEditor = new CodeEditor(modalEl, engine, () => {
    engine.recompute();
    timeline.resize();
    timeline.draw();
    stateInspector.update(timeline.scrubberTick);
});

const interactions = new Interactions(timeline, engine, (tick) => {
    stateInspector.update(tick);
    if (tickDisplay) tickDisplay.textContent = `Tick: ${tick}`;
});

// --- Toolbar Actions ---
addBtn.addEventListener('click', () => {
    engine.addServer();
    engine.recompute();
    timeline.resize();
    timeline.draw();
    stateInspector.update(timeline.scrubberTick);
});

removeBtn.addEventListener('click', () => {
    engine.removeServer();
    engine.recompute();
    timeline.resize();
    timeline.draw();
    stateInspector.update(timeline.scrubberTick);
});

// --- Load Code from URL ---
async function loadCodeFromURL(url) {
    try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const text = await resp.text();
        const config = JSON.parse(text);

        // Apply node count if specified
        if (config.nodes && typeof config.nodes === 'number') {
            while (engine.servers.length < config.nodes) engine.addServer();
            while (engine.servers.length > config.nodes && engine.servers.length > 1) engine.removeServer();
        }

        // Apply per-server code
        if (config.servers && Array.isArray(config.servers)) {
            for (let i = 0; i < config.servers.length && i < engine.servers.length; i++) {
                const sc = config.servers[i];
                let code = '';
                if (sc.onUp) code += sc.onUp + '\n\n';
                else code += 'function onUp() {}\n\n';
                if (sc.onTimer) code += sc.onTimer + '\n\n';
                else code += 'function onTimer(tick) {}\n\n';
                if (sc.onMessage) code += sc.onMessage + '\n\n';
                else code += 'function onMessage(message) {}\n\n';
                engine.servers[i].code = code;
            }
        }

        // Apply pre-configured events
        if (config.events && Array.isArray(config.events)) {
            for (const evt of config.events) {
                if (evt.type === 'crash' && evt.server < engine.servers.length) {
                    const s = engine.servers[evt.server];
                    s.crashIntervals.push([evt.tick, null]);
                } else if (evt.type === 'recover' && evt.server < engine.servers.length) {
                    const s = engine.servers[evt.server];
                    // Find the crash interval that's open and set its end
                    for (const interval of s.crashIntervals) {
                        if (interval[1] === null && interval[0] < evt.tick) {
                            interval[1] = evt.tick;
                            break;
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.error('Failed to load code from URL:', e);
    }
}

// --- Startup ---
async function init() {
    if (CODE_URL) {
        await loadCodeFromURL(CODE_URL);
    }
    engine.recompute();
    timeline.resize();
    timeline.draw();
    stateInspector.update(0);
    if (tickDisplay) tickDisplay.textContent = 'Tick: 0';
}

init();
