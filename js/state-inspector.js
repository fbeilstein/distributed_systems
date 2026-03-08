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

            const header = document.createElement('div');
            header.className = 'state-card-header';
            header.textContent = server.name;
            card.appendChild(header);

            const body = document.createElement('div');
            body.className = 'state-card-body';

            const serverState = simState ? simState.serverStates[server.id] : {};
            const entries = Object.entries(serverState || {}).filter(
                ([k]) => k !== '__error__'
            );

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

            // Double-click → open code editor
            card.addEventListener('dblclick', () => {
                this.onEditCode(server.id);
            });

            this.container.appendChild(card);
        }
    }
}
