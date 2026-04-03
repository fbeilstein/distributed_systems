


// Symmetric Plumtree with Multi-Request Support
class PlumMachine extends Machine {
    constructor() {
        super();
        this.states = [new Waiting(), new Syncing(), new GotMsg()];

        // These are our simple, local, automatically serialized lists
        this.seen = {};
        this.eager = [];
        this.lazy = [];
        this.targets = [];

        this.graftId = null;
        this.origParent = null;
        this.initializedTree = false;
    }

    // NEW: Expose the local knowledge to the UI Inspector
    syncUI() {
        this.active_links = this.eager.length > 0 ? `[${this.eager.join(', ')}]` : 'None';
        this.backup_links = this.lazy.length > 0 ? `[${this.lazy.join(', ')}]` : 'None';

        // Count how many messages this node has successfully stored
        this.messages_seen = Object.keys(this.seen).length;
    }

    onUp() {
        if (!this.initializedTree) {
            // The tick 0 bootstrap. Once initialized, the node only trusts its local lists.
            const initialEagerTargets = { 0: [1], 1: [0, 2, 3], 2: [1], 3: [1, 5], 4: [5], 5: [3, 4, 6], 6: [5] };

            // Extract ONLY the children/parents relevant to this specific node
            this.eager = initialEagerTargets[serverId] || [];
            this.lazy = allServerIds.filter(id => id < 7 && id !== serverId && !this.eager.includes(id));

            this.origParent = { 0: 1, 1: 3, 2: 1, 3: null, 4: 5, 5: 3, 6: 5 }[serverId];
            this.initializedTree = true;
        }
        super.onUp();
    }

    moveToEager(p) {
        this.lazy = this.lazy.filter(x => x !== p);
        if (!this.eager.includes(p)) this.eager.push(p);
    }

    moveToLazy(p) {
        this.eager = this.eager.filter(x => x !== p);
        if (!this.lazy.includes(p)) this.lazy.push(p);
    }
}

class BaseState extends State {
    onTimer(t) {
        super.onTimer(t);
        // Delay initial gossip to prevent clutter, and check seen messages
        if (t > 30 && t % 25 === serverId % 5 && Object.keys(this.machine.seen).length > 0) {
            Object.keys(this.machine.seen).forEach(msgId => {
                if (this.machine.lazy.length === 0) return;
                const subset = this.machine.lazy.splice(0, 3);
                this.machine.lazy = this.machine.lazy.concat(subset);
                broadcast(subset, { type: 'LAZY_ID', msgId }, '#9e9e9e', true);
            });
        }
    }

    // Explicitly catching both payload types to ensure the framework routes them
    onCLIENT_REQ(m) { this.handleMessage(m); }
    onEAGER_PUSH(m) { this.handleMessage(m); }

    onGRAFT(m) {
        this.machine.moveToEager(m.from);
        sendMessage(m.from, { type: 'EAGER_PUSH', msgId: m.payload.msgId }, 'green');
    }

    onPRUNE(m) {
        this.machine.moveToLazy(m.from);
    }

    onLAZY_ID(m) {
        if (!this.machine.seen[m.payload.msgId]) {
            if (!this.machine.targets.includes(m.from)) this.machine.targets.push(m.from);
            this.machine.graftId = m.payload.msgId;
            this.transition('SYNC', false);
        }
    }

    handleMessage(m) {
        const msgId = m.payload.msgId;

        if (this.machine.seen[msgId]) {
            if (m.from < 7) {
                sendMessage(m.from, { type: 'PRUNE' }, 'red');
                this.machine.moveToLazy(m.from);
            }
        } else {
            this.machine.seen[msgId] = true;

            const targets = this.machine.eager.filter(p => p !== m.from && p !== this.machine.origParent);
            if (targets.length > 0) {
                // BUG 2 FIX: Always wrap the broadcast in an EAGER_PUSH type.
                broadcast(targets, { type: 'EAGER_PUSH', msgId: msgId }, 'green');
            }

            if (String(msgId) === String(this.machine.graftId)) {
                this.clearTimeout('g');
                this.transition('GOT_MSG');
            } else if (this.getState()[0] !== 'SYNC') {
                this.transition('GOT_MSG');

                // BUG 2 FIX: If the node was ALREADY in GOT_MSG, manually restart 
                // the flash timer so the UI registers the consecutive hits.
                if (this.automat.current.getState()[0] === 'GOT_MSG') {
                    this.automat.current.clearTimeout('flash');
                    this.automat.current.setTimeout(6, 'revertToWait', 'flash');
                }
            }
        }
    }
}

class Waiting extends BaseState {
    getState() { return ['WAIT', '#cfd8dc']; }
    onUp() { this.transition('WAIT'); }
}

class Syncing extends BaseState {
    getState() { return ['SYNC', '#ffb74d']; }
    onUp() { this.transition('WAIT'); }

    onEnter() {
        this.doGraft();
    }

    doGraft() {
        if (this.machine.targets.length > 0) {
            const t = this.machine.targets.shift();
            this.machine.targets.push(t);
            this.machine.moveToEager(t);
            sendMessage(t, { type: 'GRAFT', msgId: this.machine.graftId }, 'orange');
        }
        this.setTimeout(15, 'doGraft', 'g');
    }
}

class GotMsg extends BaseState {
    getState() { return ['GOT_MSG', '#81c784']; }

    onEnter() {
        this.setTimeout(6, 'revertToWait', 'flash');
    }

    revertToWait() {
        this.transition('WAIT');
    }

    onUp() { this.transition('WAIT', false); }
}

const M = new PlumMachine();
function onUp() { M.onUp(); }
function onTimer(t) { M.onTimer(t); }
function onMessage(m) { M.onMessage(m); }