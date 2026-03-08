/**
 * state-inspector.js
 * Renders server state cards in the bottom half of the UI.
 */

export class StateInspector {
    constructor(containerEl, engine, onEditCode) {
        this.container = containerEl;
        this.engine = engine;
        this.onEditCode = onEditCode; // callback(serverId)
        this.currentTick = 0;
    }

    update(tick) {
        this.currentTick = tick;
        this.render();
    }

    render() {
        const state = this.engine.getStateAtTick(this.currentTick);
        this.container.innerHTML = '';

        for (const server of this.engine.servers) {
            const card = document.createElement('div');
            card.className = 'state-card';
            card.dataset.serverId = server.id;

            const header = document.createElement('div');
            header.className = 'state-card-header';
            header.textContent = server.name;
            card.appendChild(header);

            const body = document.createElement('pre');
            body.className = 'state-card-body';
            const serverState = state ? state.serverStates[server.id] : {};
            body.textContent = JSON.stringify(serverState || {}, null, 2);

            // Highlight errors
            if (serverState && serverState.__error__) {
                body.classList.add('has-error');
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
