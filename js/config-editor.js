/**
 * config-editor.js
 * Modal editor for demo.json, allowing live simulation parameter tuning.
 */

export class ConfigEditor {
    constructor(modalEl, engine, callbacks) {
        this.modal = modalEl;
        this.engine = engine;
        this.onConfigSaved = callbacks.onConfigSaved;     // (newConfig) => void
        this.onReloadJs = callbacks.onReloadJs;           // (newConfig) => void

        this.overlay = modalEl.querySelector('.modal-overlay');
        this.editorWrap = modalEl.querySelector('#cm-config-editor');
        this.errorEl = modalEl.querySelector('.modal-error');
        this.saveBtn = modalEl.querySelector('.modal-save');
        this.reloadBtn = modalEl.querySelector('.modal-reload-js');
        this.cancelBtn = modalEl.querySelector('.modal-cancel');

        // Initialize CodeMirror (JSON is basically JS subset)
        this.cm = CodeMirror(this.editorWrap, {
            mode: { name: "javascript", json: true },
            lineNumbers: true,
            tabSize: 2,
            indentWithTabs: false,
            lineWrapping: true,
            viewportMargin: Infinity,
            theme: document.body.classList.contains('dark-theme') ? 'default' : 'default' // Add better theme support if needed
        });

        this.saveBtn.addEventListener('click', () => this._save());
        this.reloadBtn.addEventListener('click', () => this._reloadJs());
        this.cancelBtn.addEventListener('click', () => this.close());
        this.overlay.addEventListener('click', () => this.close());
    }

    open(config) {
        this.errorEl.textContent = '';
        this.modal.classList.add('open');

        // Set value and refresh after modal is visible
        setTimeout(() => {
            this.cm.setValue(JSON.stringify(config, null, 2));
            this.cm.refresh();
            this.cm.focus();
        }, 50);
    }

    close() {
        this.modal.classList.remove('open');
    }

    _parse() {
        try {
            const config = JSON.parse(this.cm.getValue());
            return config;
        } catch (e) {
            this.errorEl.textContent = `Invalid JSON: ${e.message}`;
            return null;
        }
    }

    _save() {
        const config = this._parse();
        if (!config) return;

        this.onConfigSaved(config);
        this.close();
    }

    _reloadJs() {
        const config = this._parse();
        if (!config) return;

        this.onReloadJs(config);
        this.close();
    }
}
