# Static Timelines: Author Guide

Embed non-interactive, illustrative timelines directly inside lecture Markdown slides. No `demo.json` or `node.js` required — just a JSON code block.

---

## How It Works

The file `js/addons/static-timeline.js` registers a custom Markdown code-block renderer via `js/slides-addons.js`. When the slide engine encounters a fenced block tagged `` ```static-timeline ``, it:

1. Parses the JSON inside the block.
2. Builds a mock `Engine` object (servers, history, messages, crashes).
3. Creates a `<canvas>` and renders a native `Timeline` on it (the same renderer used by interactive demos).
4. Replaces the raw code block with the rendered canvas.

The slides engine (`js/slides.js`) calls `SlideAddons.renderAll()` after Markdown is parsed.

---

## Minimal Example

````markdown
```static-timeline
{
  "ticks": 40,
  "servers": ["Client", "Server A", "Server B"],
  "messages": [
    {"from": "Client", "to": "Server A", "sendTick": 5, "recvTick": 12},
    {"from": "Server A", "to": "Server B", "sendTick": 14, "recvTick": 22},
    {"from": "Server B", "to": "Client", "sendTick": 24, "recvTick": 32}
  ]
}
```
````

This renders a 3-track timeline with three message arrows and no state bands.

---

## Full JSON Schema

### Top-Level Keys

| Key | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `ticks` | Number | 100 | Duration of the timeline (horizontal axis) |
| `servers` | String[] | *required* | Ordered list of server/track names, top to bottom |
| `states` | Object[] | `[]` | Colored state bands drawn below each track |
| `messages` | Object[] | `[]` | Message arrows between tracks |
| `crashes` | Object[] | `[]` | Crash intervals (grayed-out/dashed track segments) |
| `scale` | Number | 20 | Horizontal pixels per tick |
| `zoom` | Number | 1.0 | Overall zoom multiplier |

### Layout Overrides

These fine-tune vertical spacing (same names as `demo.json`):

| Key | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `labelWidth` | Number | 60 | Width of the left label column (px). |
| `trackPaddingTop` | Number | 50 | Vertical space above the first track (px). |
| `trackPaddingBottom`| Number | 40 | Vertical space below the last track (px). |
| `trackHeight` | Number | 80 | Vertical space per server track (px). |
| `stateBandOffset` | Number | 22 | Vertical offset of state band below the track line (px). |
| `stateBandHeight` | Number | 8 | Height of the state band rectangle (px). |

### Container Formatting

| Key | Type | Description |
| :--- | :--- | :--- |
| `float` | String | CSS float value (`"left"`, `"right"`) for inline diagrams alongside text |
| `width` | String | CSS width (e.g., `"50%"`, `"400px"`) |

---

## States

Each entry paints a colored rectangle under a track for a tick range.

```json
{
  "server": "Server A",
  "start": 10,
  "end": 30,
  "state": "Preparing",
  "color": "#ffb74d"
}
```

| Field | Type | Description |
| :--- | :--- | :--- |
| `server` | String | Must exactly match a name from the `servers` array |
| `start` | Number | First tick of the band (inclusive) |
| `end` | Number | Last tick of the band (inclusive) |
| `state` | String | Text label displayed inside the band |
| `color` | String | CSS color for the band fill |

Multiple states can overlap on the same track (later entries paint over earlier ones).

---

## Messages

Each entry draws an arrow from one track to another.

```json
{
  "from": "Client",
  "to": "Server A",
  "sendTick": 5,
  "recvTick": 12
}
```

| Field | Type | Description |
| :--- | :--- | :--- |
| `from` | String | Sender name (must match `servers`) |
| `to` | String | Receiver name (must match `servers`) |
| `sendTick` | Number | Tick at which the arrow starts |
| `recvTick` | Number | Tick at which the arrow ends |
| `lost` | Boolean | If `true`, renders as a dashed red "lost" arrow |

---

## Crashes

Each entry marks a server as crashed (dashed track line, grayed out) for a tick range.

```json
{
  "server": "Server B",
  "start": 20,
  "end": 40
}
```

| Field | Type | Description |
| :--- | :--- | :--- |
| `server` | String | Must match a name from `servers` |
| `start` | Number | First tick of the crash |
| `end` | Number | Last tick of the crash |

---

## Common Recipes

### Compact Layout (for slides with limited space)

```json
{
  "zoom": 1.0,
  "ticks": 19,
  "labelWidth": 80,
  "trackPaddingTop": 20,
  "trackPaddingBottom": 20,
  "servers": ["W1", "W2", "R1", "R2"]
}
```

### Inline Float (diagram next to text)

```json
{
  "float": "right",
  "width": "55%",
  "ticks": 40,
  ...
}
```

### Lost Message

```json
{
  "messages": [
    {"from": "Client", "to": "Server A", "sendTick": 5, "recvTick": 12, "lost": true}
  ]
}
```

---

## Real-World Example (2PC Prepare/Commit)

````markdown
```static-timeline
{
  "zoom": 0.85,
  "ticks": 58,
  "trackHeight": 50,
  "stateBandOffset": 10,
  "servers": ["Coordinator", "P1", "P2", "P3"],
  "states": [
    { "server": "Coordinator", "start": 2, "end": 10, "state": "Prepare", "color": "#ffb74d" },
    { "server": "Coordinator", "start": 25, "end": 35, "state": "Commit", "color": "#81c784" },
    { "server": "P1", "start": 12, "end": 20, "state": "Ready", "color": "#ffe0b2" },
    { "server": "P2", "start": 14, "end": 22, "state": "Ready", "color": "#ffe0b2" },
    { "server": "P3", "start": 16, "end": 24, "state": "Ready", "color": "#ffe0b2" },
    { "server": "P1", "start": 38, "end": 50, "state": "Committed", "color": "#81c784" },
    { "server": "P2", "start": 40, "end": 50, "state": "Committed", "color": "#81c784" },
    { "server": "P3", "start": 42, "end": 50, "state": "Committed", "color": "#81c784" }
  ],
  "messages": [
    {"from": "Coordinator", "to": "P1", "sendTick": 5, "recvTick": 12},
    {"from": "Coordinator", "to": "P2", "sendTick": 5, "recvTick": 14},
    {"from": "Coordinator", "to": "P3", "sendTick": 5, "recvTick": 16},
    {"from": "P1", "to": "Coordinator", "sendTick": 18, "recvTick": 25},
    {"from": "P2", "to": "Coordinator", "sendTick": 20, "recvTick": 27},
    {"from": "P3", "to": "Coordinator", "sendTick": 22, "recvTick": 29},
    {"from": "Coordinator", "to": "P1", "sendTick": 30, "recvTick": 38},
    {"from": "Coordinator", "to": "P2", "sendTick": 30, "recvTick": 40},
    {"from": "Coordinator", "to": "P3", "sendTick": 30, "recvTick": 42}
  ]
}
```
````

---

## The `static-diagram` Addon

A sibling addon (`js/addons/static-diagram.js`) renders SVG node/link diagrams from JSON blocks tagged `` ```static-diagram ``. It supports `nodes`, `links`, and `groups` with shapes like `rect`, `pill`, and `cylinder`. See the source file for the full schema.

---

## Architecture Notes

- **Registration**: `js/slides-addons.js` exports a `SlideAddons` registry. Addons call `SlideAddons.register('language-tag', renderFn)`.
- **Rendering**: `SlideAddons.renderAll()` scans for `code.language-<tag>` DOM elements and calls the registered function with the `<code>` node.
- **Theme**: Static timelines listen for `window.theme-change` events and automatically redraw.
- **Adding new addons**: Create `js/addons/my-addon.js`, call `SlideAddons.register(...)`, and import it in `slides.html`.
