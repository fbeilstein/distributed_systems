// FUSE — Cascading Failure Detection
// When a node detects ANY peer failure, it stops responding (blows its fuse).
// This cascades through the cluster, creating consistent failure awareness.

const PING_INTERVAL = 20;
const TIMEOUT = PING_INTERVAL + 10;
const SPACING = Math.floor(PING_INTERVAL / allServerIds.length);
const PEERS = allServerIds.filter(id => id !== serverId);

function shouldPing(tick) {
    return tick % PING_INTERVAL === (serverId * SPACING) % PING_INTERVAL;
}

/** LISTEN: Normal operation, pinging and listening */
class Listen extends State {
    getUI() { return ['Listen', '#3182bd']; }
    canTransition() { return ['Blown']; }

    onTimer(tick) {
        this.machine.tick = tick;
        // 1. Staggered Ping logic
        if (shouldPing(tick))
            broadcast(PEERS, { type: 'PING' }, 'black');

        // 2. Failure Detection
        for (const [idStr, p] of Object.entries(this.machine.peers)) {
            const gap = tick - (p.lastSeen || 0);
            if (gap > TIMEOUT) {
                p.status = 'failed';
                this.transition('Blown');
                break;
            }
        }
    }

    registerMessageTypes() {
        return {
            'PING': (msg) => {
                sendMessage(msg.from, { type: 'ACK' }, 'orange');
            },
            'ACK': (msg) => {
                const p = this.machine.peers[msg.from];
                if (p) {
                    p.lastSeen = msg.arrivalTick;
                    p.status = 'alive';
                }
            }
        };
    }
}

/** BLOWN: Final state, totally inactive */
class Blown extends State {
    getUI() { return ['Fuse Blown', '#e57373']; }
    // No message handlers or timers in this state
}

/** FUSE MACHINE */
class FuseMachine extends Machine {
    constructor() {
        super();
        this.states = [new Listen(), new Blown()];
        this.peers = {};
        for (const id of allServerIds) {
            if (id !== serverId) {
                this.peers[id] = { lastSeen: 0, status: 'alive' };
            }
        }
    }

    // Custom syncUI to show peer statuses in the State Inspector if needed
    syncUI() {
        const parts = Object.entries(this.peers).map(([id, p]) => `S${id}:${p.status}`);
        this.membership = parts.join(' <br> ');
    }
}

const M = new FuseMachine();

function onUp() { M.onUp(); }
function onTimer(t) { M.onTimer(t); }
function onMessage(m) { M.onMessage(m); }
