/**
 * main.js
 * Bootstrap: parse URL params, load JSON config, initialize engine, wire up all components.
 * JSON config is the primary source of truth. URL params are only fallbacks.
 */

import { Engine, DEFAULT_CODE } from './engine.js?v=10';
import { Timeline } from './timeline.js?v=10';
import { Interactions } from './interactions.js?v=10';
import { StateInspector } from './state-inspector.js?v=10';
import { CodeEditor } from './code-editor.js?v=10';
import { ConfigEditor } from './config-editor.js?v=10';
import { RenderEditor } from './render-editor.js?v=10';

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
const configBtn = document.getElementById('btn-open-config');
const configModalEl = document.getElementById('config-editor-modal');
const renderBtn = document.getElementById('btn-open-render');
const renderModalEl = document.getElementById('render-editor-modal');
const seedDisplay = document.getElementById('seed-display');
const tickDisplay = document.getElementById('tick-display');

// --- Fetch resources for config ---
async function fetchResources(config, baseUrl) {
    if (!config.servers || !Array.isArray(config.servers)) return config;

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
    return config;
}

// --- Load JSON config ---
async function loadConfig(url) {
    try {
        const resp = await fetch(url, { cache: 'no-store' }); // no cache!!!
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const config = JSON.parse(await resp.text());

        const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
        await fetchResources(config, baseUrl);

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
function applyConfig(engine, config, skipCodeUpdate = false) {
    // Sync node count
    const numNodes = config.nodes || 0;
    while (engine.servers.length < numNodes) {
        engine.addServer();
    }
    while (engine.servers.length > numNodes && numNodes > 0) {
        engine.removeServer();
    }

    // Apply per-server code and metadata
    if (config.servers && Array.isArray(config.servers)) {
        for (let i = 0; i < engine.servers.length; i++) {
            const sc = config.servers[i] || {};
            const engineServer = engine.servers[i];

            engineServer.name = sc.name || `S${engineServer.id}`;

            if (skipCodeUpdate) {
                if (sc.color) engineServer.color = sc.color;
                continue;
            }

            let code = '';
            if (sc.code !== undefined) {
                code = sc.code;
            } else if (sc.onUp || sc.onTimer || sc.onMessage) {
                code += (sc.onUp || 'function onUp() {}') + '\n\n';
                code += (sc.onTimer || 'function onTimer(tick) {}') + '\n\n';
                code += (sc.onMessage || 'function onMessage(message) {}') + '\n\n';
            } else {
                // If no specific code path, it implies the code configuration was removed
                engineServer.code = DEFAULT_CODE;
                // Also clear the reference so the exporter doesn't persist the old filename
                delete engineServer.codeFile;
                continue;
            }
            engineServer.code = code;
            engineServer.codeFile = sc.codeFile;
            if (sc.color) engineServer.color = sc.color;
        }
    }

    // Update simulation parameters
    if (config.seed !== undefined) engine.seed = config.seed;
    if (config.ticks !== undefined) engine.maxTicks = config.ticks;
    engine.config = config; // for latency jitter etc.
    if (config.hideStateLabels) engine.hideStateLabels = true;

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

// --- Toolbar Updater ---
function updateToolbar(config, engine) {
    const seedDisplay = document.getElementById('seed-display');
    if (seedDisplay) seedDisplay.textContent = `Seed: ${engine.seed}`;

    const demoNameDisplay = document.getElementById('demo-name-display');
    if (demoNameDisplay) {
        demoNameDisplay.textContent = (config && config.demoName) ? ` — ${config.demoName}` : '';
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

    // Create engine with resolved values
    const engine = new Engine(seed, maxTicks);
    for (let i = 0; i < numNodes; i++) {
        engine.addServer();
    }

    // Load the Automat (State/Machine) class source for sandbox injection
    try {
        const automatResp = await fetch('./automat-source.js', { cache: 'no-store' });
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
    if (tickDisplay) tickDisplay.textContent = 'Tick: 0';
    updateToolbar(config, engine);

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

    const baseUrl = CODE_URL ? CODE_URL.substring(0, CODE_URL.lastIndexOf('/') + 1) : './';

    const configEditor = new ConfigEditor(configModalEl, engine, {
        onConfigSaved: (newConfig) => {
            // Restore stripped code properties if the file reference didn't change
            if (config) {
                if (newConfig.customRenderFile === config.customRenderFile) {
                    newConfig.customRenderCode = config.customRenderCode;
                }
                if (newConfig.servers && config.servers) {
                    for (let i = 0; i < Math.min(newConfig.servers.length, config.servers.length); i++) {
                        if (newConfig.servers[i].codeFile === config.servers[i].codeFile) {
                            newConfig.servers[i].code = config.servers[i].code;
                        }
                    }
                }
            }

            config = newConfig;
            applyConfig(engine, config, true); // true = skip code update

            updateToolbar(config, engine);
            updateRenderBtn();

            // Clear custom render if it was removed
            if (!config.customRenderCode && !config.customRenderFile) {
                timeline.customRender = null;
            }

            engine.recompute();
            timeline.resize();
            timeline.draw();
            stateInspector.update(timeline.scrubberTick);
        },
        onReloadJs: async (newConfig) => {
            config = newConfig;
            await fetchResources(config, baseUrl);
            applyConfig(engine, config, false); // false = apply code update

            updateToolbar(config, engine);
            updateRenderBtn();

            if (config.customRenderCode) {
                try {
                    timeline.customRender = new Function('ctx', 'timeline', 'engine', config.customRenderCode);
                } catch (e) {
                    console.error('Failed to parse customRenderCode:', e);
                }
            } else {
                timeline.customRender = null;
            }

            engine.recompute();
            timeline.resize();
            timeline.draw();
            stateInspector.update(timeline.scrubberTick);
        }
    });

    // --- Render Code Editor ---
    const renderEditor = new RenderEditor(renderModalEl, (newCode) => {
        if (!config) config = {};
        config.customRenderCode = newCode;
        try {
            timeline.customRender = new Function('ctx', 'timeline', 'engine', newCode);
        } catch (e) {
            console.error('Failed to parse customRenderCode:', e);
        }
        engine.recompute();
        timeline.resize();
        timeline.draw();
        stateInspector.update(timeline.scrubberTick);
    });

    // Show/hide render button based on whether render code exists
    function updateRenderBtn() {
        renderBtn.style.display = (config && (config.customRenderCode || config.customRenderFile)) ? '' : 'none';
    }
    updateRenderBtn();

    renderBtn.addEventListener('click', () => {
        renderEditor.open(config ? config.customRenderCode || '' : '');
    });

    configBtn.addEventListener('click', () => {
        // Strip raw 'code' and 'customRenderCode' from the config we show in the editor
        // to keep it focused on filenames and parameters as requested.
        const editorConfig = JSON.parse(JSON.stringify(config || {
            nodes: engine.servers.length,
            ticks: engine.maxTicks,
            seed: engine.seed,
            servers: engine.servers.map(s => ({ name: s.name }))
        }));
        if (editorConfig.servers) {
            editorConfig.servers.forEach(s => delete s.code);
        }
        delete editorConfig.customRenderCode;
        configEditor.open(editorConfig);
    });

    // Toolbar: add/remove servers
    addBtn.addEventListener('click', () => {
        engine.addServer();
        if (config) config.nodes = engine.servers.length;
        engine.recompute();
        timeline.resize();
        timeline.draw();
        stateInspector.update(timeline.scrubberTick);
    });

    removeBtn.addEventListener('click', () => {
        engine.removeServer();
        if (config) config.nodes = engine.servers.length;
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
