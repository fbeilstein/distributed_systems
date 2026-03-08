/**
 * code-editor.js
 * Modal code editor for per-server code editing.
 */

const DEFAULT_CODE = `function onUp() {
  // Called on server start or recovery after being down.
  // loadState() returns {} on first boot, or last dumped state after crash.
}

function onTimer(tick) {
  // Called every tick while server is up.
  // Example: dumpState({ count: tick });
}

function onMessage(message) {
  // Called when a message arrives.
  // message = { from: serverId, payload: {...} }
  // Example: sendMessage(0, { echo: message.payload });
}`;

export class CodeEditor {
    constructor(modalEl, engine, onCodeSaved) {
        this.modal = modalEl;
        this.engine = engine;
        this.onCodeSaved = onCodeSaved; // callback()
        this.currentServerId = null;

        this.overlay = modalEl.querySelector('.modal-overlay');
        this.titleEl = modalEl.querySelector('.modal-title');
        this.textarea = modalEl.querySelector('.modal-textarea');
        this.errorEl = modalEl.querySelector('.modal-error');
        this.saveBtn = modalEl.querySelector('.modal-save');
        this.cancelBtn = modalEl.querySelector('.modal-cancel');

        this.saveBtn.addEventListener('click', () => this._save());
        this.cancelBtn.addEventListener('click', () => this.close());
        this.overlay.addEventListener('click', () => this.close());

        // Ctrl+S / Cmd+S to save
        this.textarea.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                this._save();
            }
            // Tab inserts spaces
            if (e.key === 'Tab') {
                e.preventDefault();
                const start = this.textarea.selectionStart;
                const end = this.textarea.selectionEnd;
                this.textarea.value =
                    this.textarea.value.substring(0, start) +
                    '  ' +
                    this.textarea.value.substring(end);
                this.textarea.selectionStart = this.textarea.selectionEnd = start + 2;
            }
        });
    }

    open(serverId) {
        this.currentServerId = serverId;
        const server = this.engine.servers[serverId];
        if (!server) return;

        this.titleEl.textContent = `Code Editor — ${server.name}`;
        this.textarea.value = server.code || DEFAULT_CODE;
        this.errorEl.textContent = '';
        this.modal.classList.add('open');
        this.textarea.focus();
    }

    close() {
        this.modal.classList.remove('open');
        this.currentServerId = null;
    }

    _save() {
        if (this.currentServerId === null) return;
        const code = this.textarea.value;

        // Basic syntax check
        try {
            new Function(
                'loadState', 'dumpState', 'sendMessage',
                'serverId', 'allServerIds', '__arg__',
                code + '\n; if(typeof onUp==="function")onUp();'
            );
        } catch (e) {
            this.errorEl.textContent = `Syntax error: ${e.message}`;
            return;
        }

        this.engine.servers[this.currentServerId].code = code;
        this.close();
        this.onCodeSaved();
    }
}

export { DEFAULT_CODE };
