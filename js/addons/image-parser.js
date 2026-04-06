import { SlideAddons } from '../slides-addons.js';

export function parseImages(markdown) {
    // Match extended markdown images: ![alt](url){config}
    const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)\s*\{([^}]+)\}/g;

    return markdown.replace(imgRegex, (match, alt, src, configStr) => {
        // Skip youtube blocks since they have their own parser
        if (alt === 'youtube') return match;

        const config = {};
        const configMatches = configStr.matchAll(/([a-zA-Z0-9_-]+)(?:=(?:"([^"]+)"|([^\s}]+)))?/g);
        for (const m of configMatches) {
            config[m[1]] = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : true);
        }

        const parseDim = (val) => {
            if (!val || val === true) return '';
            return !isNaN(val) ? val + '%' : val;
        };

        let style = '';
        if (config.left || config.top || config.pos || config.absolute) {
            style += 'position: absolute; ';
            if (config.left && config.left !== true) style += `left: ${parseDim(config.left)}; `;
            if (config.top && config.top !== true) style += `top: ${parseDim(config.top)}; `;
            if (config.width && config.width !== true) style += `width: ${parseDim(config.width)}; `;
            if (config.height && config.height !== true) style += `height: ${parseDim(config.height)}; `;
        } else {
            if (config.width && config.width !== true) style += `width: ${parseDim(config.width)}; `;
            if (config.height && config.height !== true) style += `height: ${parseDim(config.height)}; `;

            if (config.center) {
                style += 'display: block; margin-left: auto; margin-right: auto; ';
            } else if (config.right) {
                style += 'display: block; margin-left: auto; margin-right: 0; ';
            }
        }

        if (config.aspect) style += `aspect-ratio: ${config.aspect}; `;

        // Add object-fit natively so manually styled images look crisp
        style += 'object-fit: contain;';

        return `<img src="${src}" alt="${alt}" style="${style.trim()}">`;
    });
}

SlideAddons.registerPreProcessor(parseImages);
