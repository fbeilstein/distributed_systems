import { SlideAddons } from './slides-addons.js';
import './addons/static-timeline.js';

// Core Slide Engine State
let currentSlideIndex = 0;
let slides = [];

// Configuration
const SLIDE_SEPARATOR = '\n---\n';

// Configure marked to allow raw HTML inputs (Dangerous in public apps, safe for personal lectures)
marked.setOptions({
    gfm: true,
    breaks: false,
    pedantic: false,
    sanitize: false, // DEPRECATED implicitly allowed. Allows raw inline HTML.
    smartLists: true,
    smartypants: true
});

/**
 * Initialization on DOM Load
 */
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Get the target markdown file from the URL Query ?file=....
    const urlParams = new URLSearchParams(window.location.search);
    const fileUrl = urlParams.get('file');

    if (!fileUrl) {
        document.getElementById('presentation-container').innerHTML = `
            <div class="slide active">
                <h1>Error</h1>
                <p>No lecture file specified. Please use <code>?file=lectures/01_example.md</code></p>
                <div style="margin-top:20px;">
                    <button class="demo-btn" onclick="window.location.href='?file=lectures/01_example.md'">Load Example Lecture</button>
                </div>
            </div>
        `;
        return;
    }

    try {
        // 2. Fetch the Markdown content and recursively resolve includes
        const lastSlash = fileUrl.lastIndexOf('/');
        const basePath = lastSlash !== -1 ? fileUrl.substring(0, lastSlash) : '';
        const fileName = lastSlash !== -1 ? fileUrl.substring(lastSlash + 1) : fileUrl;

        const markdown = await fetchAndResolveIncludes(basePath, fileName);

        // 3. Parse and Inject Slides
        parseAndInjectSlides(markdown);

        // 4. Trigger MathJax to render all the newly injected LaTeX formulas
        if (window.MathJax && typeof MathJax.typesetPromise === 'function') {
            MathJax.typesetPromise().catch(err => console.error("MathJax error:", err));
        }

        // 5. Setup Keyboard Navigation Listeners
        setupKeyboardNav();

    } catch (e) {
        document.getElementById('presentation-container').innerHTML = `
            <div class="slide active">
                <h1 style="color: #e53935;">Failed to load lecture</h1>
                <p>Could not load <code>${fileUrl}</code>.</p>
                <pre>${e.message}</pre>
            </div>
        `;
    }
});

/**
 * Recursively fetches markdown files and resolves !include(filename.md) syntax.
 */
async function fetchAndResolveIncludes(basePath, fileUrl, visited = new Set()) {
    const fullUrl = basePath ? `${basePath}/${fileUrl}` : fileUrl;

    if (visited.has(fullUrl)) {
        return `\n> **Error**: Circular inclusion detected for \`${fullUrl}\`\n`;
    }
    visited.add(fullUrl);

    try {
        const response = await fetch(fullUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const content = await response.text();

        const newBasePath = fullUrl.substring(0, fullUrl.lastIndexOf('/'));

        const lines = content.split('\n');
        const resolvedLines = [];

        for (const line of lines) {
            const includeMatch = line.match(/^\s*!include\((.+)\)\s*$/);
            if (includeMatch) {
                const includeFile = includeMatch[1].trim();
                const includedContent = await fetchAndResolveIncludes(newBasePath, includeFile, visited);
                resolvedLines.push(includedContent);
            } else {
                resolvedLines.push(line);
            }
        }
        return resolvedLines.join('\n');
    } catch (e) {
        return `\n> **Error** including \`${fullUrl}\`: ${e.message}\n`;
    }
}

/**
 * Splits raw markdown into individual slides and renders them to HTML via Marked.js
 */
function parseAndInjectSlides(markdownContent) {
    const rawSlides = markdownContent.split(SLIDE_SEPARATOR);
    const container = document.getElementById('presentation-container');
    container.innerHTML = ''; // Clear exactly

    rawSlides.forEach((rawMd, index) => {
        const slideDiv = document.createElement('div');
        slideDiv.className = 'slide';
        if (index === 0) slideDiv.classList.add('active'); // First slide visible

        // Convert Markdown (including raw HTML like flexboxes) to browser HTML
        slideDiv.innerHTML = marked.parse(rawMd);
        container.appendChild(slideDiv);

        // Browsers block <script> tags injected via innerHTML from executing automatically.
        // To allow the user to embed custom JS in their slides, we must manually clone and replace them.
        const scripts = slideDiv.querySelectorAll('script');
        scripts.forEach(oldScript => {
            const newScript = document.createElement('script');
            // Copy attributes (src, type, etc)
            Array.from(oldScript.attributes).forEach(attr => {
                newScript.setAttribute(attr.name, attr.value);
            });
            // Copy inline code
            newScript.appendChild(document.createTextNode(oldScript.innerHTML));
            oldScript.parentNode.replaceChild(newScript, oldScript);
        });
    });

    // Update global reference array
    slides = document.querySelectorAll('.slide');
    updateCounter();

    SlideAddons.renderAll();
}

/**
 * Navigation Logic
 */
function showSlide(index) {
    if (index < 0 || index >= slides.length) return;

    // Hide current
    slides[currentSlideIndex].classList.remove('active');

    // Show new
    currentSlideIndex = index;
    slides[currentSlideIndex].classList.add('active');

    updateCounter();
}

window.nextSlide = function () {
    showSlide(currentSlideIndex + 1);
}

window.prevSlide = function () {
    showSlide(currentSlideIndex - 1);
}

function updateCounter() {
    const counter = document.getElementById('slide-counter');
    if (counter && slides.length > 0) {
        counter.textContent = `${currentSlideIndex + 1} / ${slides.length}`;
    }
}

/**
 * Global Keyboard Listeners for Presentation Flow
 */
function setupKeyboardNav() {
    document.addEventListener('keydown', (e) => {
        // Prevent slides from switching if the user is typing inside an inline input field (like the Merkle demo)
        const tag = e.target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea') return;

        // Don't trigger if they are somehow typing in an input inside a demo (though iframe should catch it)
        if (document.getElementById('demo-overlay').classList.contains('hidden') === false) {
            // Only allow escape key to exit demo
            if (e.key === 'Escape') hideDemo();
            return;
        }

        switch (e.key) {
            case 'ArrowRight':
            case 'Spacebar':
            case ' ':
            case 'Enter':
                e.preventDefault();
                window.nextSlide();
                break;
            case 'ArrowLeft':
            case 'Backspace':
                e.preventDefault();
                window.prevSlide();
                break;
        }
    });
}

/**
 * Demo Overlay Logic
 * Allows a markdown slide to contain: <button class="demo-btn" onclick="showDemo('failure-phi')">Open Demo</button>
 */
window.showDemo = function (demoName) {
    const overlay = document.getElementById('demo-overlay');
    const iframe = document.getElementById('demo-iframe');
    const title = document.getElementById('demo-title');

    // The main engine index.html runs the sandboxes. We load it into the iframe, requesting a specific demo.
    iframe.src = `index.html?code=${demoName}`;
    title.textContent = `Demo: ${demoName}`;

    overlay.classList.remove('hidden');
};

window.hideDemo = function () {
    const overlay = document.getElementById('demo-overlay');
    const iframe = document.getElementById('demo-iframe');

    // Wipe the SRC so the simulation physically stops computing in the background
    iframe.src = '';
    overlay.classList.add('hidden');
};


