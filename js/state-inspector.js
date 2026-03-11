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
    }

    update(tick) {
        this.currentTick = tick;
        this.render();
    }

    render() {
        const simState = this.engine.getStateAtTick(this.currentTick);
        this.container.innerHTML = '';

        for (const server of this.engine.servers) {
            const card = document.createElement('div');
            card.className = 'state-card';
            card.dataset.serverId = server.id;

            // Header with editable name
            const header = document.createElement('div');
            header.className = 'state-card-header';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'state-card-name';
            nameSpan.textContent = server.name;
            nameSpan.title = 'Click to rename';
            nameSpan.addEventListener('click', (e) => {
                e.stopPropagation();
                this._startRename(nameSpan, server);
            });
            header.appendChild(nameSpan);

            // FSM state badge (if Automat is used)
            const serverState = simState ? simState.serverStates[server.id] : {};
            if (serverState && serverState.fsm && serverState.fsm.state) {
                const badge = document.createElement('span');
                badge.className = 'state-badge';
                badge.textContent = serverState.fsm.state;
                const badgeColor = (serverState.fsm.colors && serverState.fsm.colors[serverState.fsm.state])
                    || '#78909c';
                badge.style.backgroundColor = badgeColor;
                // Use dark text on light backgrounds, light text on dark
                badge.style.color = this._contrastColor(badgeColor);
                header.appendChild(badge);
            }

            card.appendChild(header);

            const body = document.createElement('div');
            body.className = 'state-card-body';

            const entries = Object.entries(serverState || {}).filter(
                ([k]) => k !== '__error__' && k !== 'fsm'
            );

            // Show fsm.state as a readable entry (the badge shows it too, but
            // keep it in the table for scrubber context)
            if (serverState && serverState.fsm) {
                entries.unshift(['state', serverState.fsm.state]);
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
                    tdVal.textContent = typeof value === 'object'
                        ? JSON.stringify(value)
                        : String(value);

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
