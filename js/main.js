/**
 * main.js
 * Bootstrap: parse URL params, load JSON config, initialize engine, wire up all components.
 * JSON config is the primary source of truth. URL params are only fallbacks.
 */

import { Engine } from './engine.js';
import { Timeline } from './timeline.js';
import { Interactions } from './interactions.js';
import { StateInspector } from './state-inspector.js';
import { CodeEditor, DEFAULT_CODE } from './code-editor.js';

// --- Parse URL Parameters (fallbacks only) ---
const params = new URLSearchParams(window.location.search);
const CODE_URL = params.get('code') || null;
const PARAM_SEED = params.has('seed') ? parseInt(params.get('seed'), 10) : null;
const PARAM_NODES = params.has('nodes') ? parseInt(params.get('nodes'), 10) : null;
const PARAM_TICKS = params.has('ticks') ? parseInt(params.get('ticks'), 10) : null;

// --- DOM Elements ---
const canvas = document.getElementById('timeline-canvas');
const tooltipEl = document.getElementById('tooltip');
const inspectorEl = document.getElementById('state-inspector');
const modalEl = document.getElementById('code-editor-modal');
const addBtn = document.getElementById('btn-add-server');
const removeBtn = document.getElementById('btn-remove-server');
const seedDisplay = document.getElementById('seed-display');
const tickDisplay = document.getElementById('tick-display');

// --- Load JSON config ---
async function loadConfig(url) {
    try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return JSON.parse(await resp.text());
    } catch (e) {
        console.error('Failed to load config:', e);
        return null;
    }
}

// --- Apply config to engine ---
function applyConfig(engine, config) {
    // Apply per-server code
    if (config.servers && Array.isArray(config.servers) && config.servers.length > 0) {
        for (let i = 0; i < engine.servers.length; i++) {
            const sc = config.servers[Math.min(i, config.servers.length - 1)];
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
                engine.servers[evt.server].crashIntervals.push([evt.tick, null]);
            } else if (evt.type === 'recover' && evt.server < engine.servers.length) {
                const s = engine.servers[evt.server];
                for (const interval of s.crashIntervals) {
                    if (interval[1] === null && interval[0] < evt.tick) {
                        interval[1] = evt.tick;
                        break;
                    }
                }
            }
        }
    }
}

// --- Main init ---
async function init() {
    // Load JSON config first (if URL provided)
    let config = null;
    if (CODE_URL) {
        config = await loadConfig(CODE_URL);
    }

    // Determine final values: JSON overrides URL params, URL params override defaults
    const seed = (config && config.seed != null) ? config.seed
        : (PARAM_SEED != null) ? PARAM_SEED : 42;
    const maxTicks = (config && config.ticks != null) ? config.ticks
        : (PARAM_TICKS != null) ? PARAM_TICKS : 100;
    const numNodes = (config && config.nodes != null) ? config.nodes
        : (PARAM_NODES != null) ? PARAM_NODES : 3;

    // Server names from config
    const names = (config && Array.isArray(config.names)) ? config.names : [];

    // Create engine with resolved values
    const engine = new Engine(seed, maxTicks);
    for (let i = 0; i < numNodes; i++) {
        engine.addServer(names[i] || undefined);
    }

    // Apply code and events from config
    if (config) {
        applyConfig(engine, config);
    }

    // Update toolbar display
    if (seedDisplay) seedDisplay.textContent = `Seed: ${seed}`;
    if (tickDisplay) tickDisplay.textContent = 'Tick: 0';

    // Initialize components
    const timeline = new Timeline(canvas, tooltipEl);
    timeline.setEngine(engine);

    const stateInspector = new StateInspector(inspectorEl, engine, (serverId) => {
        codeEditor.open(serverId);
    });
    stateInspector.onRedraw = () => { timeline.draw(); };

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

    // Toolbar: add/remove servers
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

    // Run initial simulation
    engine.recompute();
    timeline.resize();
    timeline.draw();
    stateInspector.update(0);
}

init();
