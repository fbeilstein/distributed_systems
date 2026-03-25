import { SlideAddons } from '../slides-addons.js';

/**
 * Static Diagram Addon
 * Renders SVG diagrams from a JSON specification.
 * Supports nodes, links, and logical groups.
 */
SlideAddons.register('static-diagram', (block) => {
    try {
        const config = JSON.parse(block.textContent);
        const width = config.width || 800;
        const height = config.height || 400;

        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
        svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
        svg.style.width = "100%";
        svg.style.height = "auto";
        svg.style.background = config.background || "transparent";
        svg.style.fontFamily = "'Inter', system-ui, sans-serif";

        // 1. Define Markers (Arrows)
        const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
        const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
        marker.setAttribute("id", "arrowhead");
        marker.setAttribute("markerWidth", "10");
        marker.setAttribute("markerHeight", "7");
        marker.setAttribute("refX", "9");
        marker.setAttribute("refY", "3.5");
        marker.setAttribute("orient", "auto");
        const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        poly.setAttribute("points", "0 0, 10 3.5, 0 7");
        poly.setAttribute("fill", config.linkColor || "#999");
        marker.appendChild(poly);
        defs.appendChild(marker);
        svg.appendChild(defs);

        // 2. Render Groups (Containers)
        if (config.groups) {
            config.groups.forEach(g => {
                const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                rect.setAttribute("x", g.x);
                rect.setAttribute("y", g.y);
                rect.setAttribute("width", g.width);
                rect.setAttribute("height", g.height);
                rect.setAttribute("fill", g.fill || "rgba(0,0,0,0.05)");
                rect.setAttribute("stroke", g.stroke || "#ccc");
                rect.setAttribute("stroke-dasharray", g.dashed ? "5,5" : "none");
                rect.setAttribute("rx", "10");
                svg.appendChild(rect);

                if (g.label) {
                    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
                    text.setAttribute("x", g.x + g.width / 2);
                    text.setAttribute("y", g.y + g.height + 25);
                    text.setAttribute("text-anchor", "middle");
                    text.textContent = g.label;
                    text.setAttribute("fill", g.color || "#444");
                    text.setAttribute("font-size", "13px");
                    text.setAttribute("font-weight", "bold");
                    svg.appendChild(text);
                }
            });
        }

        // 3. Render Links (Edges)
        if (config.links) {
            config.links.forEach(l => {
                const fromNode = config.nodes.find(n => n.id === l.from);
                const toNode = config.nodes.find(n => n.id === l.to);
                if (!fromNode || !toNode) return;

                const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
                // Simple center-to-center for now, improved logic could detect box boundaries
                line.setAttribute("x1", fromNode.x + (fromNode.width || 100) / 2);
                line.setAttribute("y1", fromNode.y + (fromNode.height || 40) / 2);
                line.setAttribute("x2", toNode.x + (toNode.width || 100) / 2);
                line.setAttribute("y2", toNode.y + (toNode.height || 40) / 2);

                line.setAttribute("stroke", l.color || config.linkColor || "#999");
                line.setAttribute("stroke-width", l.width || 2);
                line.setAttribute("marker-end", "url(#arrowhead)");
                svg.appendChild(line);

                if (l.label) {
                    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
                    const mx = (parseFloat(line.getAttribute("x1")) + parseFloat(line.getAttribute("x2"))) / 2;
                    const my = (parseFloat(line.getAttribute("y1")) + parseFloat(line.getAttribute("y2"))) / 2;
                    label.setAttribute("x", mx);
                    label.setAttribute("y", my - 5);
                    label.setAttribute("text-anchor", "middle");
                    label.setAttribute("fill", l.color || "#666");
                    label.setAttribute("font-size", "12px");
                    label.textContent = l.label;
                    svg.appendChild(label);
                }
            });
        }

        // 4. Render Nodes
        if (config.nodes) {
            config.nodes.forEach(n => {
                const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
                const w = n.width || 120;
                const h = n.height || 40;

                let shape;
                if (n.type === 'cylinder') {
                    shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
                    const rx = w / 2;
                    const ry = 10;
                    const d = `M ${n.x} ${n.y + ry} 
                               A ${rx} ${ry} 0 0 1 ${n.x + w} ${n.y + ry} 
                               L ${n.x + w} ${n.y + h - ry} 
                               A ${rx} ${ry} 0 0 1 ${n.x} ${n.y + h - ry} 
                               Z`;
                    shape.setAttribute("d", d);

                    // Add the "lid" ellipse for a proper cylinder look
                    const lid = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
                    lid.setAttribute("cx", n.x + rx);
                    lid.setAttribute("cy", n.y + ry);
                    lid.setAttribute("rx", rx);
                    lid.setAttribute("ry", ry);
                    lid.setAttribute("fill", n.fill || "#fff");
                    lid.setAttribute("stroke", n.stroke || "#333");
                    lid.setAttribute("stroke-width", "2");
                    g.appendChild(lid);
                } else {
                    shape = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                    shape.setAttribute("x", n.x);
                    shape.setAttribute("y", n.y);
                    shape.setAttribute("width", w);
                    shape.setAttribute("height", h);
                    shape.setAttribute("rx", n.type === 'pill' ? h / 2 : 4);
                }

                shape.setAttribute("fill", n.fill || "#fff");
                shape.setAttribute("stroke", n.stroke || "#333");
                shape.setAttribute("stroke-width", "2");
                g.appendChild(shape);

                const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
                text.setAttribute("x", n.x + w / 2);
                text.setAttribute("y", n.y + h / 2 + 5);
                text.setAttribute("text-anchor", "middle");
                text.setAttribute("fill", n.color || "#333");
                text.setAttribute("font-size", n.fontSize || "14px");
                text.setAttribute("font-weight", "500");
                text.textContent = n.label;
                g.appendChild(text);

                svg.appendChild(g);
            });
        }

        // 5. Replace Block
        const container = document.createElement('div');
        container.className = 'static-diagram-wrapper';
        container.style.marginTop = '20px';
        container.appendChild(svg);

        const preNode = block.parentNode;
        preNode.parentNode.replaceChild(container, preNode);

    } catch (err) {
        console.error('Failed to parse static-diagram JSON:', err);
        block.style.color = '#c62828';
        block.textContent = "Error rendering diagram.\n" + err.message;
    }
});
