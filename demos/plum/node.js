// Symmetric Plumtree (Final Stabilization)
class PlumMachine extends Machine {
    constructor() {
        super();
        this.states = [new Waiting(), new Syncing(), new GotMsg()];
        this.seen = {}; this.children = []; this.lazy = []; this.targets = [];
        this.gId = null; this.init = false;
    }
    syncUI() {
        this.active_links = this.children.length > 0 ? `[${this.children.join(', ')}]` : 'None';
        this.backup_links = this.lazy.length > 0 ? `[${this.lazy.join(', ')}]` : 'None';
        this.seen_count = Object.keys(this.seen).length;
    }
    onUp() {
        if (!this.init) {
            // Strictly Hierarchical: Root -> Branches -> Leafs
            const initial = { 0: [], 1: [0, 2], 2: [], 3: [1, 5], 4: [], 5: [4, 6], 6: [] };
            this.children = initial[serverId] || [];
            this.lazy = allServerIds.filter(id => id < 7 && id !== serverId && !this.children.includes(id));
            this.init = true;
        }
        super.onUp();
    }
    moveToLazy(p) {
        this.children = this.children.filter(x => x !== p);
        if (!this.lazy.includes(p)) this.lazy.push(p);
    }
}

class BaseState extends State {
    clutter(t) { return !(t < 30 || (t >= 280 && t <= 300) || (t >= 150 && t <= 165)); }

    onTimer(t) {
        super.onTimer(t);
        if (this.clutter(t) && (t % 70) === (serverId * 10) && Object.keys(this.machine.seen).length > 0) {
            broadcast(this.machine.lazy, { type: 'LAZY_ID', msgIds: Object.keys(this.machine.seen) }, '#9e9e9e', true);
        }
    }

    onGRAFT(m) {
        this.machine.lazy = this.machine.lazy.filter(x => x !== m.from);
        if (!this.machine.children.includes(m.from)) this.machine.children.push(m.from);
        sendMessage(m.from, { type: 'EAGER_PUSH', msgId: m.payload.msgId }, 'green');
    }
    onPRUNE(m) { this.machine.moveToLazy(m.from); }
    onLAZY_ID(m) {
        const ids = m.payload.msgIds || [m.payload.msgId];
        ids.forEach(id => {
            if (!this.machine.seen[id]) {
                if (!this.machine.targets.includes(m.from)) this.machine.targets.push(m.from);
                this.machine.gId = id;
                this.transition('SYNC', false);
            }
        });
    }

    process(m, isForwarding) {
        const id = m.payload.msgId;
        if (this.machine.seen[id]) {
            if (m.from < 7) {
                sendMessage(m.from, { type: 'PRUNE' }, 'red');
                this.machine.moveToLazy(m.from);
            }
        } else {
            this.machine.seen[id] = true;
            if (isForwarding) {
                broadcast(this.machine.children, { type: 'EAGER_PUSH', msgId: id }, 'green');
            }
            if (this.getState()[0] === 'SYNC') this.clearTimeout('g');
            this.transition('GOT_MSG');
        }

        if (this.getState()[0] === 'GOT_MSG') {
            this.clearTimeout('flash');
            this.setTimeout(6, 'revertToWait', 'flash');
        }
    }
}

class Waiting extends BaseState {
    getState() { return ['WAIT', '#cfd8dc']; }
    canTransition() { return ['SYNC', 'GOT_MSG']; }
    onUp() { this.transition('WAIT'); }
    onCLIENT_REQ(m) { this.process(m, true); }
    onEAGER_PUSH(m) { this.process(m, true); }
}

class Syncing extends BaseState {
    getState() { return ['SYNC', '#ffb74d']; }
    canTransition() { return ['GOT_MSG']; }
    onUp() { this.transition('WAIT'); }
    onEnter() { this.doGraft(); }
    onEAGER_PUSH(m) { this.process(m, false); } // Silent repair
    doGraft() {
        if (this.machine.targets.length > 0) {
            const t = this.machine.targets.shift();
            this.machine.targets.push(t);
            sendMessage(t, { type: 'GRAFT', msgId: this.machine.gId }, 'orange');
        }
        this.setTimeout(15, 'doGraft', 'g');
    }
}

class GotMsg extends BaseState {
    getState() { return ['GOT_MSG', '#81c784']; }
    canTransition() { return ['WAIT']; }
    onUp() { this.transition('WAIT', false); }
    onEnter() { this.setTimeout(6, 'revertToWait', 'flash'); }
    revertToWait() { this.transition('WAIT'); }
    onCLIENT_REQ(m) { this.process(m, true); }
    onEAGER_PUSH(m) { this.process(m, true); }
}

const M = new PlumMachine();
function onUp() { M.onUp(); }
function onTimer(t) { M.onTimer(t); }
function onMessage(m) { M.onMessage(m); }