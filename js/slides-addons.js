export const SlideAddons = {
    registry: {},
    preProcessors: [],

    /**
     * Registers a new markdown code block renderer.
     * @param {string} language - The markdown language identifier (e.g., 'static-timeline').
     * @param {function} renderFn - The function to call, receives the matching DOM node.
     */
    register(language, renderFn) {
        this.registry[language] = renderFn;
    },

    /**
     * Registers a markdown pre-processor (string-to-string transformation).
     * @param {function} fn - Function that takes markdown string and returns modified string.
     */
    registerPreProcessor(fn) {
        this.preProcessors.push(fn);
    },

    /**
     * Applies all registered pre-processors to the markdown content.
     * @param {string} markdown - The raw markdown content.
     * @returns {string} - The processed markdown.
     */
    preProcess(markdown) {
        let md = markdown;
        this.preProcessors.forEach(fn => {
            md = fn(md);
        });
        return md;
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
