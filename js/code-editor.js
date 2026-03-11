/**
 * code-editor.js
 * Modal code editor for per-server code editing, using CodeMirror 5.
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
        this.onCodeSaved = onCodeSaved;
        this.currentServerId = null;

        this.overlay = modalEl.querySelector('.modal-overlay');
        this.titleEl = modalEl.querySelector('.modal-title');
        this.editorWrap = modalEl.querySelector('#cm-editor');
        this.errorEl = modalEl.querySelector('.modal-error');
        this.saveBtn = modalEl.querySelector('.modal-save');
        this.cancelBtn = modalEl.querySelector('.modal-cancel');

        // Initialize CodeMirror
        this.cm = CodeMirror(this.editorWrap, {
            mode: 'javascript',
            lineNumbers: true,
            tabSize: 2,
            indentWithTabs: false,
            lineWrapping: true,
            viewportMargin: Infinity,
        });

        // Ctrl+S / Cmd+S to save
        this.cm.setOption('extraKeys', {
            'Ctrl-S': () => this._save(),
            'Cmd-S': () => this._save(),
        });

        this.saveBtn.addEventListener('click', () => this._save());
        this.cancelBtn.addEventListener('click', () => this.close());
        this.overlay.addEventListener('click', () => this.close());
    }

    open(serverId) {
        this.currentServerId = serverId;
        const server = this.engine.servers[serverId];
        if (!server) return;

        this.titleEl.textContent = `Code Editor — ${server.name}`;
        this.errorEl.textContent = '';
        this.modal.classList.add('open');

        // Set value and refresh after modal is visible
        setTimeout(() => {
            this.cm.setValue(server.code || DEFAULT_CODE);
            this.cm.refresh();
            this.cm.focus();
        }, 50);
    }

    close() {
        this.modal.classList.remove('open');
        this.currentServerId = null;
    }

    _save() {
        if (this.currentServerId === null) return;
        const code = this.cm.getValue();

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
