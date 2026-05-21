/**
 * render-editor.js
 * Modal code editor for custom render code, using CodeMirror 5.
 */

export class RenderEditor {
    constructor(modalEl, onSaved) {
        this.modal = modalEl;
        this.onSaved = onSaved;     // (newCode) => void
        this.currentCode = '';

        this.overlay = modalEl.querySelector('.modal-overlay');
        this.editorWrap = modalEl.querySelector('#cm-render-editor');
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

    open(code) {
        this.currentCode = code || '';
        this.errorEl.textContent = '';
        this.modal.classList.add('open');

        // Set value and refresh after modal is visible
        setTimeout(() => {
            this.cm.setValue(this.currentCode);
            this.cm.refresh();
            this.cm.focus();
        }, 50);
    }

    close() {
        this.modal.classList.remove('open');
    }

    _save() {
        const code = this.cm.getValue();

        // Basic syntax check — the render function takes (ctx, timeline, engine)
        try {
            new Function('ctx', 'timeline', 'engine', code);
        } catch (e) {
            this.errorEl.textContent = `Syntax error: ${e.message}`;
            return;
        }

        this.close();
        this.onSaved(code);
    }
}
