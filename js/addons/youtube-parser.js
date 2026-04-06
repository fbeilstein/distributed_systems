import { SlideAddons } from '../slides-addons.js';

export function parseYoutube(markdown) {
    const ytRegex = /!\[youtube\]\(([^)]+)\)(?:\s*\{([^}]*)\})?/g;

    return markdown.replace(ytRegex, (match, src, configStr) => {
        const config = {};
        if (configStr) {
            for (const m of configStr.matchAll(/(\w+)="([^"]+)"/g)) {
                config[m[1]] = m[2];
            }
        }

        const parseDim = (val) => {
            if (!val) return '';
            return !isNaN(val) ? val + '%' : val;
        };

        let style = 'border: none; aspect-ratio: 16 / 9;';

        if (config.left || config.top || config.absolute || config.pos) {
            style += ' position: absolute;';
            if (config.left) style += ` left: ${parseDim(config.left)};`;
            if (config.top) style += ` top: ${parseDim(config.top)};`;
            if (config.width) style += ` width: ${parseDim(config.width)};`;
            if (config.height) style += ` height: ${parseDim(config.height)};`;
        } else {
            style += ` width: ${parseDim(config.width) || '100%'};`;
            if (config.height) style += ` height: ${parseDim(config.height)};`;
        }

        if (config.aspect) style += ` aspect-ratio: ${config.aspect};`;

        const url = src.includes('youtube.com') ? src : `https://www.youtube.com/embed/${src}`;

        return `<iframe style="${style}" src="${url}" title="YouTube video player" allowfullscreen></iframe>`;
    });
}

export function parseGDrive(markdown) {
    // Looks for ![gdrive](url) {config}
    const driveRegex = /!\[gdrive\]\(([^)]+)\)(?:\s*\{([^}]*)\})?/g;

    return markdown.replace(driveRegex, (match, src, configStr) => {
        const config = {};
        if (configStr) {
            // Same flexible regex as image-parser: supports quoted and unquoted values
            for (const m of configStr.matchAll(/([a-zA-Z0-9_-]+)(?:=(?:"([^"]+)"|([^\s}]+)))?/g)) {
                config[m[1]] = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : true);
            }
        }

        const parseDim = (val) => {
            if (!val || val === true) return '';
            return !isNaN(val) ? val + '%' : val;
        };

        // Only apply aspect-ratio as fallback when no explicit height is given
        let style = 'border: none;';
        if (!config.height) style += ' aspect-ratio: 16 / 9;';

        if (config.left || config.top || config.absolute || config.pos) {
            style += ' position: absolute;';
            if (config.left && config.left !== true) style += ` left: ${parseDim(config.left)};`;
            if (config.top && config.top !== true) style += ` top: ${parseDim(config.top)};`;
            if (config.width && config.width !== true) style += ` width: ${parseDim(config.width)};`;
            if (config.height && config.height !== true) style += ` height: ${parseDim(config.height)};`;
        } else {
            style += ` width: ${parseDim(config.width) || '100%'};`;
            if (config.height && config.height !== true) style += ` height: ${parseDim(config.height)};`;
        }

        if (config.aspect) style += ` aspect-ratio: ${config.aspect};`;

        // Extract the unique File ID from the Google Drive link
        const idMatch = src.match(/\/d\/([a-zA-Z0-9_-]+)/);

        // If the regex finds an ID, use it. If not, assume the user just pasted the raw ID into the markdown.
        const fileId = idMatch ? idMatch[1] : src;
        const url = `https://drive.google.com/file/d/${fileId}/preview`;

        return `<iframe style="${style}" src="${url}" allow="autoplay" allowfullscreen></iframe>`;
    });
}

SlideAddons.registerPreProcessor(parseYoutube);
SlideAddons.registerPreProcessor(parseGDrive);