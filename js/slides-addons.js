export const SlideAddons = {
    registry: {},

    /**
     * Registers a new markdown code block renderer.
     * @param {string} language - The markdown language identifier (e.g., 'static-timeline').
     * @param {function} renderFn - The function to call, receives the matching DOM node.
     */
    register(language, renderFn) {
        this.registry[language] = renderFn;
    },

    /**
     * Scans the document for all registered addon code blocks and renders them.
     */
    renderAll() {
        for (const [language, renderFn] of Object.entries(this.registry)) {
            const blocks = document.querySelectorAll(`code.language-${language}`);
            blocks.forEach(block => renderFn(block));
        }
    }
};
