/**
 * main.js
 * Bootstrap: parse URL params, load JSON config, initialize engine, wire up all components.
 * JSON config is the primary source of truth. URL params are only fallbacks.
 */

import { Engine } from './engine.js?v=10';
import { Timeline } from './timeline.js?v=10';
import { Interactions } from './interactions.js?v=10';
import { StateInspector } from './state-inspector.js?v=10';
import { CodeEditor, DEFAULT_CODE } from './code-editor.js?v=10';

// --- Theme Management ---
function applyTheme(theme) {
    if (theme === 'dark') {
        document.body.classList.add('dark-theme');
        document.body.classList.remove('light-theme');
    } else {
        document.body.classList.add('light-theme');
        document.body.classList.remove('dark-theme');
    }
    // Redraw timeline if it exists
    if (window.currentTimeline) {
        window.currentTimeline.draw();
    }
}

window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'theme-change') {
        applyTheme(event.data.theme);
    }
});

// Check if parent already has a theme set (for deep links/refreshes)
if (window.parent !== window) {
    window.parent.postMessage({ type: 'get-theme' }, '*');
}

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
const resizerEl = document.getElementById('resizer');
const modalEl = document.getElementById('code-editor-modal');
const addBtn = document.getElementById('btn-add-server');
const removeBtn = document.getElementById('btn-remove-server');
const seedDisplay = document.getElementById('seed-display');
const tickDisplay = document.getElementById('tick-display');

// --- Load JSON config ---
async function loadConfig(url) {
    try {
        const resp = await fetch(url, { cache: 'no-store' }); // no cache!!!
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const config = JSON.parse(await resp.text());

        // Resolve external codeFiles
        if (config.servers && Array.isArray(config.servers)) {
            const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);

            // Fetch custom render file if present
            if (config.customRenderFile) {
                const renderUrl = baseUrl + config.customRenderFile;
                try {
                    const renderResp = await fetch(renderUrl, { cache: 'no-store' });
                    if (!renderResp.ok) throw new Error(`HTTP ${renderResp.status}`);
                    config.customRenderCode = await renderResp.text();
                } catch (e) {
                    console.error(`Failed to load custom render code from ${renderUrl}:`, e);
                }
            }

            // Fetch all codeFiles in parallel
            const fetchPromises = config.servers.map(async (sc) => {
                if (sc.codeFile) {
                    const codeUrl = baseUrl + sc.codeFile;
                    try {
                        const codeResp = await fetch(codeUrl, { cache: 'no-store' });
                        if (!codeResp.ok) throw new Error(`HTTP ${codeResp.status}`);
                        sc.code = await codeResp.text();
                    } catch (e) {
                        console.error(`Failed to load code from ${codeUrl}:`, e);
                        sc.code = `// Failed to load external code: ${sc.codeFile}\n`;
                    }
                }
            });
            await Promise.all(fetchPromises);
        }

        return config;
    } catch (e) {
        console.error('Failed to load config:', e);
        return null;
    }
}

// --- Horizontal Resizer Splitter Logic ---
let isResizing = false;

resizerEl.addEventListener('mousedown', (e) => {
    isResizing = true;
    resizerEl.classList.add('dragging');
    document.body.style.userSelect = 'none'; // Prevent text selection while dragging
    document.body.style.cursor = 'row-resize';
});

document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    // Calculate new height: from bottom of screen to mouse Y
    // Subtract a little padding so the cursor stays on the bar
    const newHeight = window.innerHeight - e.clientY - 3;

    // Bounds checking
    const minHeight = 120; // Match CSS min-height
    const maxHeight = window.innerHeight * 0.8; // Don't let it consume the entire screen
    const clampedHeight = Math.max(minHeight, Math.min(newHeight, maxHeight));

    inspectorEl.style.height = `${clampedHeight}px`;
});

document.addEventListener('mouseup', () => {
    if (isResizing) {
        isResizing = false;
        resizerEl.classList.remove('dragging');
        document.body.style.userSelect = '';
        document.body.style.cursor = '';

        // Changing flex sizes means the timeline canvas bounds changed.
        // Trigger a redraw on the Timeline component by dispatching a native resize event.
        window.dispatchEvent(new Event('resize'));
    }
});

// --- Apply config to engine ---
function applyConfig(engine, config) {
    // Apply per-server code
    if (config.servers && Array.isArray(config.servers) && config.servers.length > 0) {
        for (let i = 0; i < engine.servers.length; i++) {
            const sc = config.servers[Math.min(i, config.servers.length - 1)];
            let code = '';
            if (sc.code !== undefined) {
                code = sc.code;
            } else {
                if (sc.onUp) code += sc.onUp + '\n\n';
                else code += 'function onUp() {}\n\n';
                if (sc.onTimer) code += sc.onTimer + '\n\n';
                else code += 'function onTimer(tick) {}\n\n';
                if (sc.onMessage) code += sc.onMessage + '\n\n';
                else code += 'function onMessage(message) {}\n\n';
            }
            engine.servers[i].code = code;
            if (sc.color) engine.servers[i].color = sc.color;
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

    // Load the Automat (State/Machine) class source for sandbox injection
    try {
        const automatResp = await fetch('./js/automat-source.js', { cache: 'no-store' });
        if (automatResp.ok) {
            engine.automatSource = await automatResp.text();
        } else {
            console.error('Failed to load automat-source.js:', automatResp.status);
        }
    } catch (e) {
        console.error('Failed to fetch automat-source.js:', e);
    }

    // Apply code and events from config
    if (config) {
        applyConfig(engine, config);
        if (config.hideStateLabels) engine.hideStateLabels = true;
    }

    // Update toolbar display
    if (seedDisplay) seedDisplay.textContent = `Seed: ${seed}`;
    if (tickDisplay) tickDisplay.textContent = 'Tick: 0';

    // Initialize components
    const timeline = new Timeline(canvas, tooltipEl);
    window.currentTimeline = timeline; // Expose for theme switching
    timeline.setEngine(engine);

    if (config && config.customRenderCode) {
        try {
            // Bind the custom canvas drawing function to the timeline instance
            timeline.customRender = new Function('ctx', 'timeline', 'engine', config.customRenderCode);
        } catch (e) {
            console.error('Failed to parse customRenderCode:', e);
        }
    }

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
    engine.recompute(config);
    timeline.resize();
    timeline.draw();
    stateInspector.update(0);
}

init();
