/** Hashing Core */
function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h) + s.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h).toString(16).padStart(8, '0').toUpperCase();
}

/** Node Logic */
function updateTree() {
    const l = [1, 2, 3, 4].map(i => document.getElementById(`leaf-${i}`).value);
    const h = l.map(v => hash(v));
    const n = [hash(h[0] + h[1]), hash(h[2] + h[3])];
    const root = hash(n[0] + n[1]);

    setNode('m-h1', h[0]);
    setNode('m-h2', h[1]);
    setNode('m-h3', h[2]);
    setNode('m-h4', h[3]);
    setNode('m-n1', n[0]);
    setNode('m-n2', n[1]);
    setNode('m-root', root);
}

function setNode(id, val) {
    const el = document.getElementById(id);
    if (!el || el.textContent === val) return;
    el.textContent = val;
    el.classList.add('changed');
    setTimeout(() => el.classList.remove('changed'), 400);
}

/** SVG Drawing */
function drawLines() {
    const svg = document.getElementById('merkle-lines');
    if (!svg) return;
    svg.innerHTML = '';
    const connections = [
        ['m-root', 'm-n1'], ['m-root', 'm-n2'],
        ['m-n1', 'm-h1'], ['m-n1', 'm-h2'],
        ['m-n2', 'm-h3'], ['m-n2', 'm-h4'],
        ['m-h1', 'leaf-1'], ['m-h2', 'leaf-2'], ['m-h3', 'leaf-3'], ['m-h4', 'leaf-4']
    ];
    connections.forEach(([id1, id2]) => {
        const el1 = document.getElementById(id1);
        const el2 = document.getElementById(id2);
        if (!el1 || !el2) return;
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", el1.style.left);
        line.setAttribute("y1", el1.style.top);
        line.setAttribute("x2", el2.style.left);
        line.setAttribute("y2", el2.style.top);
        svg.appendChild(line);
    });
}

/** Theme Handshake */
window.addEventListener('message', (e) => {
    if (e.data?.type === 'theme-change') {
        document.body.classList.toggle('light-theme', e.data.theme === 'light');
    }
});
if (window.parent !== window) {
    window.parent.postMessage({ type: 'get-theme' }, '*');
}

/** Initialization */
window.addEventListener('load', () => {
    drawLines();
    updateTree();
});

// Re-draw lines on resize just in case
window.addEventListener('resize', drawLines);
