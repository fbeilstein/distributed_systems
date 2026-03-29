/**
 * state-inspector.js
 * Renders server state cards in the bottom half as key-value tables.
 */

export class StateInspector {
    constructor(containerEl, engine, onEditCode) {
        this.container = containerEl;
        this.engine = engine;
        this.onEditCode = onEditCode;
        this.currentTick = 0;
        this.svgCache = new Map(); // serverId -> { graphString, svgElement }
        this.expandedPaths = new Set(); // Track expanded <details> paths
    }

    update(tick) {
        this.currentTick = tick;
        this.render();
    }

    render() {
        const simState = this.engine.getStateAtTick(this.currentTick);

        // Preserve user-resized widths
        const savedWidths = {};
        for (const card of this.container.querySelectorAll('.state-card')) {
            if (card.style.width) {
                savedWidths[card.dataset.serverId] = card.style.width;
            }
        }

        this.container.innerHTML = '';

        for (const server of this.engine.servers) {
            const card = document.createElement('div');
            card.className = 'state-card';
            card.dataset.serverId = server.id;
            if (savedWidths[server.id]) {
                card.style.width = savedWidths[server.id];
            }

            // Header with editable name
            const header = document.createElement('div');
            header.className = 'state-card-header';

            const headerInfo = document.createElement('div');
            headerInfo.className = 'state-card-header-info';
            headerInfo.style.display = 'flex';
            headerInfo.style.flexDirection = 'column';
            headerInfo.style.alignItems = 'flex-start';
            headerInfo.style.justifyContent = 'center';
            headerInfo.style.gap = '4px';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'state-card-name';
            nameSpan.textContent = server.name;
            nameSpan.title = 'Click to rename';
            nameSpan.addEventListener('click', (e) => {
                e.stopPropagation();
                this._startRename(nameSpan, server);
            });
            headerInfo.appendChild(nameSpan);

            // State badge (decoupled)
            const serverState = simState ? simState.serverStates[server.id] : {};
            const uiState = (serverState && serverState.ui_state !== undefined) ? serverState.ui_state : (serverState && serverState.fsm ? serverState.fsm.state : null);
            const uiColor = (serverState && serverState.ui_color !== undefined) ? serverState.ui_color : (serverState && serverState.fsm ? serverState.fsm.color : null);

            if (uiState !== null) {
                const badge = document.createElement('span');
                badge.className = 'state-badge';
                badge.textContent = String(uiState);
                const badgeColor = uiColor || '#78909c';
                badge.style.backgroundColor = badgeColor;
                badge.style.color = this._contrastColor(badgeColor);
                headerInfo.appendChild(badge);
            }

            header.appendChild(headerInfo);

            // Render Graph directly into the header if available
            const uiGraph = (serverState && serverState.ui_graph) ? serverState.ui_graph : (serverState && serverState.fsm ? serverState.fsm.graph : null);
            const uiColors = (serverState && serverState.ui_colors !== undefined) ? serverState.ui_colors : (serverState && serverState.fsm ? serverState.fsm.colors : null);
            if (uiGraph) {
                this._renderFsmGraphToCard(server.id, uiState, uiGraph, uiColors, header);
            }

            card.appendChild(header);

            const body = document.createElement('div');
            body.className = 'state-card-body';

            const entries = Object.entries(serverState || {}).filter(
                ([k]) => k !== '__error__' && k !== 'fsm' && !k.startsWith('ui_')
            );

            if (uiState !== null) {
                entries.unshift(['state', String(uiState)]);
            }

            if (entries.length === 0) {
                const empty = document.createElement('span');
                empty.className = 'state-empty';
                empty.textContent = '(empty)';
                body.appendChild(empty);
            } else {
                const table = document.createElement('table');
                table.className = 'state-table';
                for (const [key, value] of entries) {
                    const tr = document.createElement('tr');

                    const tdKey = document.createElement('td');
                    tdKey.className = 'state-key';
                    tdKey.textContent = key;

                    const tdVal = document.createElement('td');
                    tdVal.className = 'state-val';
                    tdVal.appendChild(this._formatValue(value, `${server.id}.${key}`));

                    tr.appendChild(tdKey);
                    tr.appendChild(tdVal);
                    table.appendChild(tr);
                }
                body.appendChild(table);
            }

            // Show error if present
            if (serverState && serverState.__error__) {
                const errEl = document.createElement('div');
                errEl.className = 'state-error';
                errEl.textContent = serverState.__error__;
                body.appendChild(errEl);
            }

            card.appendChild(body);

            // Double-click body → open code editor
            body.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                this.onEditCode(server.id);
            });

            this.container.appendChild(card);
        }
    }

    _startRename(nameSpan, server) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'state-card-name-input';
        input.value = server.name;
        nameSpan.replaceWith(input);
        input.focus();
        input.select();

        const commit = () => {
            const newName = input.value.trim() || server.name;
            server.name = newName;
            const span = document.createElement('span');
            span.className = 'state-card-name';
            span.textContent = newName;
            span.title = 'Click to rename';
            span.addEventListener('click', (e) => {
                e.stopPropagation();
                this._startRename(span, server);
            });
            input.replaceWith(span);
            // Redraw timeline to update track labels
            if (this.onRedraw) this.onRedraw();
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { input.value = server.name; commit(); }
        });
        input.addEventListener('blur', commit);
    }

    async _renderFsmGraphToCard(serverId, activeState, graph, colors, bodyElement) {
        if (!graph) return;

        // Generate the Mermaid definition entirely in the inspector
        let graphDefinition = 'stateDiagram-v2\n';
        graphDefinition += '  direction LR\n';

        const sanitize = (id) => id.replace(/[^a-zA-Z0-9]/g, '_');
        const quote = (label) => `"${label.replace(/"/g, "'")}"`;

        const drawnEdges = new Set();
        for (const [fromState, transitions] of Object.entries(graph)) {
            const fromId = sanitize(fromState);
            graphDefinition += `  state ${quote(fromState)} as ${fromId}\n`;

            if (Object.keys(transitions).length === 0) {
                graphDefinition += `  ${fromId}\n`;
            }
            for (const [event, targetState] of Object.entries(transitions)) {
                const targetId = sanitize(targetState);
                const edgeKey = `${fromId}->${targetId}`;
                if (!drawnEdges.has(edgeKey)) {
                    graphDefinition += `  ${fromId} --> ${targetId}\n`;
                    drawnEdges.add(edgeKey);
                }
            }
        }

        if (colors) {
            for (const [state, color] of Object.entries(colors)) {
                const stateId = sanitize(state);
                const textColor = this._contrastColor(color);
                graphDefinition += `  classDef cls_${stateId} fill:${color},color:${textColor},stroke:#333,stroke-width:2px\n`;
                graphDefinition += `  class ${stateId} cls_${stateId}\n`;
            }
        }

        const graphContainer = document.createElement('div');
        graphContainer.className = 'fsm-graph-container';
        // Add minimal compact styling for the embedded graph container in the header
        graphContainer.style.flexGrow = '1';
        graphContainer.style.flexShrink = '1';
        graphContainer.style.minWidth = '0';
        graphContainer.style.overflow = 'hidden';
        graphContainer.style.marginLeft = '10px';
        graphContainer.style.height = '64px'; // Increased height to fill the 72px header
        graphContainer.style.display = 'flex';
        graphContainer.style.justifyContent = 'flex-end';
        graphContainer.style.alignItems = 'center';

        try {
            let svgContent = '';

            // Check cache to avoid re-rendering the same graph definition every tick
            const cached = this.svgCache.get(serverId);
            if (cached && cached.graphString === graphDefinition) {
                // Return a clone to avoid detaching from previous tick's discarded DOM
                svgContent = cached.svgString;
            } else {
                // Generate new SVG via Mermaid
                const id = `mermaid-${serverId}-${Date.now()}`;
                const { svg } = await mermaid.render(id, graphDefinition);
                svgContent = svg;
                this.svgCache.set(serverId, { graphString: graphDefinition, svgString: svg });
            }

            // Inject the SVG
            graphContainer.innerHTML = svgContent;

            // The SVG now exists in the DOM container. We want to highlight the CURRENT state.
            // Mermaid adds CSS classes corresponding to the class definitions we generated.
            // We can highlight the active node by darkening/muting the non-active nodes.
            const svgEl = graphContainer.querySelector('svg');
            if (svgEl) {
                // Override default mermaid absolute sizing
                svgEl.removeAttribute('height');
                svgEl.removeAttribute('width');
                svgEl.style.maxWidth = '100%';
                svgEl.style.maxHeight = '100%';
                svgEl.style.width = 'auto';
                svgEl.style.height = 'auto';

                // Mute non-active nodes
                const nodes = svgEl.querySelectorAll('.node');
                const activeId = activeState ? sanitize(String(activeState)) : null;
                nodes.forEach(node => {
                    const isCurrentState = node.id.includes(activeId); // Mermaid IDs often have prefixes
                    if (!isCurrentState) {
                        node.style.opacity = '0.3'; // Dim inactive nodes significantly
                    } else {
                        node.style.opacity = '1.0';
                        // Add a thick border stroke to pop the active state
                        const rect = node.querySelector('rect, circle, polygon, path');
                        if (rect) {
                            rect.style.strokeWidth = '4px';
                            rect.style.stroke = '#fff';
                        }
                    }
                });

                // Mute arrows
                const edges = svgEl.querySelectorAll('.edgePath');
                edges.forEach(edge => {
                    edge.style.opacity = '0.3';
                });
            }

            bodyElement.appendChild(graphContainer);
        } catch (err) {
            console.error('Failed to render FSM graph:', err);
            // Ignore render failures visually so as not to break the inspector
        }
    }

    /**
     * Recursively formats a value into a DOM node.
     * Objects/Arrays become collapsible <details> blocks.
     */
    _formatValue(val, path = '') {
        if (val === null) return document.createTextNode('null');
        if (typeof val !== 'object') return document.createTextNode(String(val));

        const isArray = Array.isArray(val);
        const keys = Object.keys(val);
        if (keys.length === 0) {
            return document.createTextNode(isArray ? '[]' : '{}');
        }

        const details = document.createElement('details');

        // Restore open state
        if (this.expandedPaths.has(path)) {
            details.open = true;
        }

        // Listen for toggle to save open state
        details.addEventListener('toggle', () => {
            if (details.open) {
                this.expandedPaths.add(path);
            } else {
                this.expandedPaths.delete(path);
            }
        });

        const summary = document.createElement('summary');
        summary.style.cursor = 'pointer';
        summary.style.userSelect = 'none';
        summary.style.color = '#64b5f6';

        let preview = isArray ? `Array(${keys.length})` : `Object {${keys.length}}`;
        summary.textContent = preview;
        details.appendChild(summary);

        const container = document.createElement('div');
        container.style.paddingLeft = '12px';
        container.style.borderLeft = '1px dashed #555';
        container.style.marginTop = '2px';
        container.style.marginBottom = '2px';

        for (const k of keys) {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.alignItems = 'flex-start';
            row.style.gap = '4px';

            const keySpan = document.createElement('span');
            keySpan.style.color = '#ffb74d';
            keySpan.textContent = isArray ? `[${k}]:` : `${k}:`;

            const childPath = path ? `${path}.${k}` : k;
            const valNode = this._formatValue(val[k], childPath);

            row.appendChild(keySpan);
            row.appendChild(valNode);
            container.appendChild(row);
        }

        details.appendChild(container);
        return details;
    }

    /** Pick white or dark text based on background luminance. */
    _contrastColor(hex) {
        const c = hex.replace('#', '');
        const r = parseInt(c.substring(0, 2), 16);
        const g = parseInt(c.substring(2, 4), 16);
        const b = parseInt(c.substring(4, 6), 16);
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance > 0.55 ? '#222' : '#fff';
    }
}
