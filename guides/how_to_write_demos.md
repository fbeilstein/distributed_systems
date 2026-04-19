# Distributed Systems Simulation: Developer Guide

A complete reference for building demos on this engine. Read this, and you can build anything.

---

## 1. File Organization

Every demo lives in `demos/<name>/` and needs at minimum two files:

```
demos/my-demo/
├── demo.json          # Required: simulation configuration
├── node.js            # Required: node behavior script (can have multiple, e.g. coordinator.js, participant.js)
└── render.js          # Optional: custom canvas drawing on the timeline
```

The engine core lives in `js/`:
| File | Role |
| :--- | :--- |
| `engine.js` | Tick loop, recomputation, message routing, crash intervals |
| `server-runtime.js` | Sandbox that executes your `node.js` inside a `new Function()` |
| `automat-source.js` | `State`, `Automat`, and `Machine` classes (injected as source text) |
| `timeline.js` | Canvas renderer: tracks, state bands, message arrows, scrubber |
| `state-inspector.js` | Bottom panel: server cards, state badges, Mermaid FSM graphs |
| `interactions.js` | Mouse handlers: drag arrows, drag scrubber, double-click crash/lose |
| `main.js` | Bootstrap: loads `demo.json`, creates engine, wires components |
| `prng.js` | Mulberry32 seeded PRNG for deterministic randomness |

---

## 2. `demo.json` — All Parameters

### Simulation
| Key | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `nodes` | Number | 3 | Number of servers |
| `ticks` | Number | 100 | Simulation duration |
| `seed` | Number | 42 | PRNG seed for deterministic results |
| `demoName` | String | - | Title displayed in the UI next to "Distributed Systems Sandbox" |

### Layout
| Key | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `labelWidth` | Number | 60 | Width of the left label column (px). Use 80-100 for long names like "Coordinator" |
| `trackHeight` | Number | 80 | Vertical space per server track (px) |
| `trackPaddingTop` | Number | 50 | Vertical space above the first track (px). Increase to make room for `render.js` overlays |
| `trackPaddingBottom` | Number | 40 | Vertical space below the last track (px). |
| `minLatency` | Number | 1 | Minimum message delay (ticks). |
| `latencyJitter` | Number | 5 | Range of random delay added (ticks). Delay is `minLatency + (hash % jitter)`. |
| `stateBandOffset` | Number | 22 | Vertical offset of the colored state band below the track line (px) |
| `stateBandHeight` | Number | 8 | Height of the state band rectangle (px) |
| `hideStateLabels` | Boolean | false | Hide text labels inside state bands |

### Custom Rendering
| Key | Type | Description |
| :--- | :--- | :--- |
| `customRenderFile` | String | Relative path to a JS file for custom canvas drawing (e.g., `"render.js"`) |

### Servers
Each entry in the `servers` array:
| Key | Type | Description |
| :--- | :--- | :--- |
| `name` | String | Display name on the timeline tracks (e.g., "Coordinator") |
| `codeFile` | String | Relative path to the behavior script for this node |
| `color` | String | Custom color for this server's track label and line |

### Pre-configured Events
The `events` array lets you pre-program crashes and recoveries:
```json
{
  "events": [
    { "type": "crash", "server": 2, "tick": 30 },
    { "type": "recover", "server": 2, "tick": 50 }
  ]
}
```

### Custom Data
Any other keys in `demo.json` are passed through to your node scripts as the global `config` object. For example, `"phiThreshold": 13` becomes accessible as `config.phiThreshold` in your `node.js`.

### Complete Example
```json
{
    "demoName": "Target Monitoring",
    "nodes": 5,
    "seed": 99,
    "ticks": 160,
    "labelWidth": 80,
    "trackPaddingTop": 200,
    "trackHeight": 70,
    "phiThreshold": 13,
    "customRenderFile": "render.js",
    "servers": [
        { "name": "Monitor", "codeFile": "monitor.js" },
        { "name": "Target 1", "codeFile": "target.js", "color": "#ffb74d" },
        { "name": "Target 2", "codeFile": "target.js", "color": "#81c784" },
        { "name": "Target 3", "codeFile": "target.js", "color": "#64b5f6" },
        { "name": "Target 4", "codeFile": "target.js", "color": "#ba68c8" }
    ]
}
```

---

## 3. Global Scope — What's Available in Your `node.js`

These are injected into your script's sandbox by `server-runtime.js`:

### Variables
| Name | Type | Description |
| :--- | :--- | :--- |
| `serverId` | Number | This node's integer ID (0-based) |
| `allServerIds` | Number[] | Array of all node IDs in the simulation |
| `config` | Object | The entire `demo.json` object (use for custom parameters) |

### Functions
| Signature | Description |
| :--- | :--- |
| `sendMessage(target, payload, color)` | Send a message to server `target` (Number). `payload` is any JSON object. `color` (String, default `'black'`) sets the arrow color on the timeline. |
| `broadcast(targets, payload, color, at_once)` | Send to multiple targets. `at_once` (Boolean, default `true`): if `false`, arrival is staggered by index. |
| `getRandom(min, max)` | Deterministic random integer in `[min, max]`. Same seed+tick+serverId → same result. |
| `loadState()` | Returns a deep clone of the node's persisted state object. |
| `dumpState(state)` | Saves the state object to simulation history. Deep-cloned via `JSON.parse(JSON.stringify())`. |

### Message Latency
Messages have a default latency of **1-5 ticks**, computed deterministically from a hash of `(sendTick, from, to, type, seed)`. Users can drag arrow endpoints on the timeline to override this.

### Message Object (received in `onMessage`)
```javascript
{
    from: 2,            // sender server ID
    sendTick: 10,       // tick when sent
    arrivalTick: 13,    // tick when delivered
    payload: {          // the object you passed to sendMessage
        type: 'ELECTION',
        leader: 4
    }
}
```

---

## 4. Coding Pattern A: Raw (No Machine)

The simplest approach. You define the three global hooks directly and manage persistence manually with `loadState()`/`dumpState()`.

```javascript
function onUp() {
    const s = loadState();
    s.counter = 0;
    s.role = 'follower';
    dumpState(s);
}

function onTimer(tick) {
    const s = loadState();
    s.counter++;
    if (s.counter % 10 === 0) {
        broadcast(allServerIds.filter(id => id !== serverId),
            { type: 'HEARTBEAT', from: serverId }, 'green');
    }
    // You MUST set ui_state and ui_color manually for visualization!
    s.ui_state = s.role;
    s.ui_color = s.role === 'leader' ? '#81c784' : '#cfd8dc';
    dumpState(s);
}

function onMessage(msg) {
    const s = loadState();
    if (msg.payload.type === 'HEARTBEAT') {
        s.role = 'follower';
        s.lastLeader = msg.from;
    }
    s.ui_state = s.role;
    s.ui_color = s.role === 'leader' ? '#81c784' : '#cfd8dc';
    dumpState(s);
}
```

**Key points:**
- You must call `loadState()` at the start and `dumpState(s)` at the end of every hook.
- You must manually set `s.ui_state` and `s.ui_color` if you want the timeline to show state bands.
- Global `let` / `const` variables outside your hooks are **ephemeral** — they get wiped on every `onUp` (sandbox reboot). Only `loadState()`/`dumpState()` data survives.

---

## 5. Coding Pattern B: Machine (OOP)

The idiomatic approach using `Machine`, `State`, and `Automat` from `automat.js`. The framework handles hydration, persistence, and UI fields automatically.

### 5.1 The `State` Class

Every state is a class inheriting from `State`. Key methods to override:

| Method | When Called | Typical Use |
| :--- | :--- | :--- |
| `getUI()` | On serialization | Return `[displayName, color]`. Used for labeling the state band in the UI. Defaults to `this.name`. |
| `canTransition()` | On construction | Return array of valid target Class Names (for graph visualization). |
| `onEnter()` | After transitioning INTO this state | Start timers, send initial messages |
| `onExit()` | Before transitioning OUT of this state | Cleanup (timers are auto-cleared) |
| `onUp()` | When node reboots | Force transition to a safe state (e.g., `this.transition('Follower')`) |
| `onDown()` | When node crashes | Cleanup (e.g., set an error status in `this.machine`) |
| `onTimer(tick)` | Every tick | Periodic logic (rarely needed if using `setTimeout`) |
| `onMessage(msg)` | Generic message handler | Fallback if no typed handler matches |
| `on<TYPE>(msg)` | When `msg.payload.type === 'TYPE'` | **Preferred**: Naming-convention message dispatch |

#### State-Scoped Timers & Properties

| Property / Method | Description |
| :--- | :--- |
| `this.name` | The internal identity of the state. Defaults to the **PascalCase Class Name**. |
| `this.activeTimers` | Getter: returns `{ name: ticksLeft, ... }` for all active timers. |
| `this.setTimeout(ticks, cb, name)` | Register a timer. |
| `this.clearTimeout(name)` | Clear a specific timer. |
| `this.clearAllTimeouts()` | Clear all timers. |

**How timers work internally**: On every tick, `Automat.onTimer()` decrements all active timer counters. When a counter reaches zero, the named callback method is called on the current state. Timers are stored as `{ name: { ticks: N, callback: 'methodName' } }` and are serialized/deserialized across ticks.

**Critical**: All timers are **automatically cleared on transition** (when `onExit()` fires). If you transition and want a timer in the new state, set it in the new state's `onEnter()`.

#### Message Dispatch Chain

When a message arrives, the engine tries **four** levels in order:
1. **Explicit Registration**: `registerMessageTypes()` returns a map of `{ 'TYPE': handler }`.
2. **State Convention**: If the state has a method named `on<TYPE>`, it's called.
3. **Machine Convention**: If the machine has a method named `on<TYPE>`, it's called.
4. **Generic Fallback**: `state.onMessage(msg)` is called.

Example: if `msg.payload.type === 'ELECTION'`, the engine looks for `state.onELECTION(msg)`, then `machine.onELECTION(msg)`, then `state.onMessage(msg)`.

#### Accessing Machine Data

Inside any state method, use `this.machine` to read/write shared data:
```javascript
this.machine.leaderId = serverId;      // Write
const leader = this.machine.leaderId;   // Read
```

#### Transitioning & Stale References

```javascript
this.transition('Follower');         // Transition: calls onExit() → swap → onEnter()
this.transition('Follower', false);  // Skip if already in Follower (idempotent, no re-enter)
```

**CRITICAL: The Stale Reference Pattern.** When you call `this.transition()`, the Automat immediately swaps the active state object. If you have code *following* the transition call that needs to interact with the current state (e.g., calling a protocol method), do NOT use `this`. Instead, use `this.automat.current`:

```javascript
onMessage(msg) {
    if (msg.payload.type === 'HEARTBEAT') {
        this.transition('Follower', false); 
        // 'this' might now point to an object that just ran onExit()!
        // To safely call a method on the NEW state:
        this.automat.current.resetTimer(); 
    }
}
```

**State Identity & Transitions**:
- **Prefer PascalCase Class Names**: Use the class name (e.g., `'Follower'`) in `this.transition()` and `canTransition()`.
- **Identity over Display**: Never compare `getUI()[0]`. Use `this.name === 'Follower'` for logical checks.
- **Optional Aliasing**: If you must use a different ID, override `get name() { return 'my-alias'; }`. The class name will still remain a valid transition target.

### 5.2 The `Machine` Class

The Machine is the persistent container. It holds shared data and the list of states.

| Method | Description |
| :--- | :--- |
| `constructor()` | Set `this.states = [...]` and initialize shared fields |
| `syncUI(s)` | Called during `_persist()`. Use to compute derived display fields (e.g., `this.current_leader`) |
| `onUp()`, `onTimer(t)`, `onMessage(msg)` | Already implemented. Calls `_hydrate()` → delegates to Automat → calls `_persist()` |

**How persistence works (`_persist`):**
- All fields on `this` (except `states`, `_automat`, `_config`) are saved to `machineData`.
- These fields also appear directly in the State Inspector UI.
- The FSM state, color, graph, and colors are saved as `ui_state`, `ui_color`, `ui_graph`, `ui_colors` — the timeline and inspector read these automatically.

```javascript
class BullyMachine extends Machine {
    constructor() {
        super();
        this.states = [new Follower(), new Electing(), new Leader()];
        this.leaderId = null;           // Persisted, visible in inspector
        this.highestResponder = null;   // Persisted, visible in inspector
    }

    syncUI() {
        // Compute derived fields for the inspector display
        this.current_leader = this.leaderId === null ? 'None' : `Node-${this.leaderId}`;
    }
}
```

### 5.3 Wiring It Up

The bottom of your `node.js` must wire the Machine to the global hooks:

```javascript
const M = new BullyMachine();

function onUp() { M.onUp(); }
function onTimer(t) { M.onTimer(t); }
function onMessage(m) { M.onMessage(m); }
```

### 5.4 Using a Base State Class

For shared protocol logic, create a base state:

```javascript
class BullyState extends State {
    // Shared helper
    wait_leader() {
        this.setTimeout(election_timeout(), 'onLeaderTimeout', 'leader');
    }

    // Shared message handlers (naming convention dispatch)
    onLEADER_HEARTBEAT(msg) {
        this.machine.leaderId = msg.payload.leader;
        this.transition('Follower', false);  // Idempotent
        this.wait_leader();
    }

    onELECTION(msg) {
        sendMessage(msg.from, { type: 'ALIVE' }, 'blue');
        this.wait_leader();
    }

    // Reboot: always go to Follower
    onUp() { this.transition('Follower'); }
}

class Follower extends BullyState {
    getState() { return ['Follower', '#cfd8dc']; }
    canTransition() { return ['Electing', 'Leader']; }
    onEnter() { this.wait_leader(); }
    onLeaderTimeout() { this.transition('Electing'); }
}
```

---

## 6. Custom Rendering (`render.js`)

The `customRenderFile` in `demo.json` points to a JS file that draws directly on the Canvas2D context. The code runs as a function body with three arguments: `ctx`, `timeline`, `engine`.

### Available Objects
| Name | Type | Key Methods / Properties |
| :--- | :--- | :--- |
| `ctx` | CanvasRenderingContext2D | Standard canvas drawing API |
| `timeline` | Timeline instance | `tickToX(tick)`, `serverToY(serverId)` — converts simulation coordinates to pixel positions |
| `engine` | Engine instance | `engine.history[tick].serverStates[serverId]` — access any node's data at any tick |

### Example: Drawing Commit/Abort Markers (2PC)
```javascript
if (!timeline || !engine || !engine.history || engine.history.length === 0) return;
ctx.save();
ctx.font = '16px monospace';

for (let sid = 1; sid <= 3; sid++) {
    for (let t = 0; t < engine.history.length; t++) {
        const state = engine.history[t].serverStates[sid];
        if (!state || !state.history) continue;
        const entry = state.history[state.history.length - 1];
        if (entry && entry.includes(':commit')) {
            ctx.fillText('✅', timeline.tickToX(t), timeline.serverToY(sid) - 12);
        }
    }
}
ctx.restore();
```

### Example: Drawing Phi Curves (Failure Detection)
```javascript
ctx.beginPath();
ctx.strokeStyle = '#ffb74d';
ctx.lineWidth = 2;
for (let t = 0; t <= maxTick; t++) {
    const phi = engine.history[t].serverStates[0].phis[1] || 0;
    const x = timeline.tickToX(t);
    const y = timeline.serverToY(0) - (phi * 15);  // Scale and offset
    t === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
}
ctx.stroke();
```

---

## 7. UI & Visualization — What Gets Displayed

### Timeline State Bands
The colored rectangles below each track line. The timeline reads:
- `ui_state` → text label in the band
- `ui_color` → fill color of the band

With the Machine pattern, these are set **automatically** by `_persist()`. Without Machine, you must set them manually on the state object before `dumpState()`.

### State Inspector (Bottom Panel)
Each server gets a card showing:
- **Header Badge**: state name and color (from `ui_state`/`ui_color`)
- **Data Table**: every field stored on your machine (e.g., `leaderId`, `current_leader`)
- **FSM Graph** (Mermaid diagram): rendered live if `ui_graph` contains a transition map. With Machine, this is auto-generated from `canTransition()`. The current state node is highlighted, others are dimmed.

Fields starting with `ui_` and `fsm` are hidden from the data table.

### Interactive Controls
- **Drag scrubber**: Move through time
- **Drag arrow endpoint**: Change message arrival tick (re-runs simulation)
- **Double-click arrow**: Toggle message as "lost" (dashed red line)
- **Double-click track**: Toggle crash at that tick
- **Click server name**: Rename the server
- **Double-click card body**: Open inline code editor
- **Shift+scroll on timeline**: Zoom in/out

---

## 8. Determinism & Performance

1. **Full Recompute**: Every scrubber drag or code change re-runs the simulation from tick 0. Keep your state objects small — they're `JSON.parse(JSON.stringify())`-cloned every tick for every server.
2. **Per-Server PRNG**: Each server gets seed `baseSeed + id * 31337`, so crashing one server doesn't shift another's random sequence.
3. **Hard Reboot on `onUp`**: When a server recovers, `server-runtime.js` calls `_initSandbox()` which re-evaluates the entire script. This clears all `let`/`const`/`class` definitions. Only `loadState()`/`dumpState()` data survives.
4. **Avoid circular references**: `JSON.stringify` will throw. Keep state objects flat.
5. **Timer Jitter**: Always add server-specific offset to election timeouts to avoid all nodes electing simultaneously:
   ```javascript
   const timeout = BASE + (serverId * 5) - getRandom(0, 10);
   ```
