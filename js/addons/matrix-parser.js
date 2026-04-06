import { SlideAddons } from '../slides-addons.js';

/**
 * Markdown Matrix Parser Plugin
 * Pre-processes custom `:::matrix` syntax into standard HTML CSS grids before marked.js parses.
 */

export function parseMatrices(markdown) {
    const matrixRegex = /^:::matrix\s*\{([^}]*)\}\n([\s\S]*?)\n:::/gm;

    return markdown.replace(matrixRegex, (match, configStr, body) => {
        // Parse config map: cols="1/1" rows="auto" gap="2%" or height=100%
        const isDebug = configStr.includes('debug');
        const config = {};
        // Match either key="value" or key=value
        const configMatches = configStr.matchAll(/(\w+)=(?:"([^"]+)"|([^\s}]+))/g);
        for (const m of configMatches) {
            config[m[1]] = m[2] !== undefined ? m[2] : m[3];
        }

        // Convert cols/rows fractions: "50/50" -> "50% 50%"
        const parseGridScale = (val) => {
            if (!val) return '';
            return val.split('/').map(c => {
                const trimmed = c.trim();
                // If it's a plain number, automatically assume Percentage as user prefers
                if (!isNaN(trimmed) && trimmed !== '') return trimmed + '%';
                return trimmed;
            }).join(' ');
        };

        const gridCols = parseGridScale(config.cols) || '1fr 1fr';
        const gridRows = parseGridScale(config.rows) || 'auto';
        const gapStyle = config.gap ? `gap: ${config.gap};` : '';

        // Base matrix styles
        let containerStyle = `display: grid; grid-template-columns: ${gridCols}; grid-template-rows: ${gridRows}; ${gapStyle}`;
        if (isDebug) {
            containerStyle += ` outline: 2px dashed rgba(255, 0, 0, 0.5);`;
        }

        // Optional Absolute Positioning
        const parseDim = (val) => {
            if (!val) return '';
            if (!isNaN(val)) return val + '%';
            return val;
        };

        if (config.left || config.top || config.pos || config.absolute) {
            containerStyle += ` position: absolute;`;
            if (config.left) containerStyle += ` left: ${parseDim(config.left)};`;
            if (config.top) containerStyle += ` top: ${parseDim(config.top)};`;
        }

        if (config.width) containerStyle += ` width: ${parseDim(config.width)};`;
        if (config.height) {
            containerStyle += ` height: ${parseDim(config.height)};`;
            if (config.height === '100%') containerStyle += ` flex-grow: 1;`;
        }

        // Add padding, alignments etc from additional config strings if needed (future proofing)
        if (config.style) containerStyle += ` ${config.style}`;

        let htmlOut = `<div class="matrix-container" style="${containerStyle}">\n\n`;

        // Regex to find grid cells [[row, col]] {.classes style: val;}
        const cellRegex = /^\[\[\s*([^,\]]+)(?:,\s*([^\]]+))?\s*\]\][ \t]*(?:\{([^}]+)\})?[ \t]*\r?\n?([\s\S]*?)(?=(?:^\[\[)|(?![\s\S]))/gm;

        const parseIndices = (idxStr) => {
            if (!idxStr) return '';
            const parts = idxStr.split(':');
            const start = parseInt(parts[0].trim()) + 1;
            if (parts.length > 1) {
                // Python slice mapping (Exclusive End): array[0:2] yields elements 0, 1.
                // In CSS lines, cell 0 uses lines 1 / 2. Cell 1 uses lines 2 / 3. 
                // So end grid-line cleanly maps exactly to index + 1
                const end = parseInt(parts[1].trim()) + 1;
                return `${start} / ${end}`;
            }
            return `${start}`;
        };

        let lastMatchIndex = 0;
        let cellsHtml = "";

        const cellMatches = Array.from(body.matchAll(cellRegex));
        for (const cellMatch of cellMatches) {
            const rowStr = parseIndices(cellMatch[1]);
            const colStr = parseIndices(cellMatch[2]);
            const attrStr = cellMatch[3] || "";
            const content = cellMatch[4].trim();

            // Extract classes and inline styles from the {} block
            const classMatches = attrStr.match(/\.[\w-]+/g) || [];
            const classes = classMatches.map(c => c.substring(1)).join(' ');
            const cssStyle = attrStr.replace(/\.[\w-]+/g, '').trim();

            let cellStyle = `grid-row: ${rowStr};`;
            if (colStr) cellStyle += ` grid-column: ${colStr};`;
            if (cssStyle) cellStyle += ` ${cssStyle}`;
            if (isDebug) cellStyle += ` outline: 1px dashed rgba(0, 255, 0, 0.8); background: rgba(0, 255, 0, 0.05);`;

            // Hard constrain cells avoiding Grid blowout bugs while allowing text to dynamically flow safely out 
            cellStyle += ` min-width: 0; min-height: 0; overflow: visible;`;

            const classAttr = classes ? ` matrix-cell ${classes}` : ` matrix-cell`;

            cellsHtml += `<div class="${classAttr.trim()}" style="${cellStyle}">\n\n${content}\n\n</div>\n\n`;
        }

        // If no cells matched but there is content, just dump it or assume syntax failure
        if (cellMatches.length === 0) {
            cellsHtml = `<div>\n\n${body}\n\n</div>`;
        }

        htmlOut += cellsHtml + `</div>\n`;
        return htmlOut;
    });
}

SlideAddons.registerPreProcessor(parseMatrices);
