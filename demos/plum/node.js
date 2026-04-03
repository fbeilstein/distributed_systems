// Directed Plumtree with Hierarchical Children and Multi-Request Support
class PlumMachine extends Machine {
    constructor() {
        super();
        this.states = [new Waiting(), new Syncing(), new GotMsg()];
        this.seen = {}; this.children = []; this.lazy = []; this.targets = [];
        this.graftId = null; this.initializedTree = false;
    }

    syncUI() {
        this.active_children = this.children.length > 0 ? `[${this.children.join(', ')}]` : 'None';
        this.backup_links = this.lazy.length > 0 ? `[${this.lazy.join(', ')}]` : 'None';
        this.messages_seen = Object.keys(this.seen).length;
    }

    onUp() {
        if (!this.initializedTree) {
            // DIRECTED: Only track nodes we are RESPONSIBLE for pushing to
            const initialChildren = { 0: [], 1: [0, 2], 2: [], 3: [1, 5], 4: [], 5: [4, 6], 6: [] };
            this.children = initialChildren[serverId] || [];

            // Lazy Mesh: All nodes except our children
            this.lazy = allServerIds.filter(id => id < 7 && id !== serverId && !this.children.includes(id));
            this.initializedTree = true;
        }
        super.onUp();
    }
}

class BaseState extends State {
    unclutter_firing(t) {
        if (t < 30) return false;
        if (t >= 280 && t <= 300) return false;
        if (t >= 150 && t <= 165) return false;
        return true;
    }

    onTimer(t) {
        super.onTimer(t);
        // Staggered round-robin lazy firing
        if (this.unclutter_firing(t) && (t % 70) === (serverId * 10) && Object.keys(this.machine.seen).length > 0) {
            const msgIds = Object.keys(this.machine.seen);
            broadcast(this.machine.lazy, { type: 'LAZY_ID', msgIds }, '#9e9e9e', true);
        }
    }

    onCLIENT_REQ(m) { this.handleMessage(m); }
    onEAGER_PUSH(m) { this.handleMessage(m); }

    onGRAFT(m) {
        // Explicitly add the requester to our Children list
        this.machine.lazy = this.machine.lazy.filter(x => x !== m.from);
        if (!this.machine.children.includes(m.from)) {
            this.machine.children.push(m.from);
        }
        sendMessage(m.from, { type: 'EAGER_PUSH', msgId: m.payload.msgId }, 'green');
    }

    onPRUNE(m) {
        // Move them back to Lazy
        this.machine.children = this.machine.children.filter(x => x !== m.from);
        if (!this.machine.lazy.includes(m.from)) {
            this.machine.lazy.push(m.from);
        }
    }

    onLAZY_ID(m) {
        const ids = m.payload.msgIds || [m.payload.msgId];
        ids.forEach(msgId => {
            if (!this.machine.seen[msgId]) {
                if (!this.machine.targets.includes(m.from)) this.machine.targets.push(m.from);
                this.machine.graftId = msgId;
                this.transition('SYNC', false);
            }
        });
    }

    handleMessage(m) {
        const msgId = m.payload.msgId;
        if (this.machine.seen[msgId]) {
            // Redundant! If this came from someone who thinks we are their child, PRUNE them.
            if (m.from < 7) {
                sendMessage(m.from, { type: 'PRUNE' }, 'red');
            }
        } else {
            this.machine.seen[msgId] = true;

            // Forward ONLY to children
            if (this.machine.children.length > 0) {
                broadcast(this.machine.children, { type: 'EAGER_PUSH', msgId: msgId }, 'green');
            }

            if (this.getState()[0] === 'SYNC') {
                this.clearTimeout('g');
                this.transition('GOT_MSG');
            } else {
                const wasGotMsg = this.getState()[0] === 'GOT_MSG';
                this.transition('GOT_MSG');
                if (wasGotMsg) {
                    this.clearTimeout('flash');
                    this.setTimeout(6, 'revertToWait', 'flash');
                }
            }
        }
    }
}

class Waiting extends BaseState {
    getState() { return ['WAIT', '#cfd8dc']; }
    canTransition() { return ['SYNC', 'GOT_MSG']; }
    onUp() { this.transition('WAIT'); }
}

class Syncing extends BaseState {
    getState() { return ['SYNC', '#ffb74d']; }
    canTransition() { return ['GOT_MSG']; }
    onUp() { this.transition('WAIT'); }
    onEnter() { this.doGraft(); }
    doGraft() {
        if (this.machine.targets.length > 0) {
            const t = this.machine.targets.shift();
            this.machine.targets.push(t);
            // We DON'T add them to our children. We are THEIR child.
            sendMessage(t, { type: 'GRAFT', msgId: this.machine.graftId }, 'orange');
        }
        this.setTimeout(15, 'doGraft', 'g');
    }
}

class GotMsg extends BaseState {
    getState() { return ['GOT_MSG', '#81c784']; }
    canTransition() { return ['WAIT']; }
    onEnter() { this.setTimeout(6, 'revertToWait', 'flash'); }
    revertToWait() { this.transition('WAIT'); }
    onUp() { this.transition('WAIT', false); }
}

const M = new PlumMachine();
function onUp() { M.onUp(); }
function onTimer(t) { M.onTimer(t); }
function onMessage(m) { M.onMessage(m); }