// SIR Gossip Dissemination (Clean OOP Architecture - EXACT ORIGINAL LOGIC)
class GossipMachine extends Machine {
    constructor() {
        super();
        this.states = [new Susceptible(), new Infected(), new Removed()];
        this.redundantCount = 0;
        this.rounds = 0;
        this.rumorSeen = false;
    }
    syncUI() {
        this.rounds_completed = this.rounds;
        this.redundancy_seen = this.redundantCount;
    }
}

class BaseGossipState extends State {
    onMessage(m) {
        if (m.payload.type === 'RUMOR') {
            if (this.machine.rumorSeen) {
                this.machine.redundantCount++;
                if (this.machine.redundantCount >= 3) this.transition('Removed');
            } else {
                this.machine.rumorSeen = true;
                this.transition('Infected');
            }
        }
    }
}

class Susceptible extends BaseGossipState {
    getUI() { return ['SUSCEPTIBLE', '#cfd8dc']; }
    canTransition() { return ['Infected']; }
    onUp() { this.transition('Susceptible'); }
}

class Infected extends BaseGossipState {
    getUI() { return ['INFECTED', '#ffb74d']; }
    canTransition() { return ['Removed']; }

    onEnter() {
        this.machine.rumorSeen = true;
    }

    onTimer(t) {
        super.onTimer(t);
        const GOSSIP_INTERVAL = 15;
        // EXACT ORIGINAL OFFSET: for 10 servers, indices are 1-10
        // Offset logic: (relativeId / numServers) * 15
        const offset = Math.floor(((serverId - 1) / 10) * GOSSIP_INTERVAL);

        if (t % GOSSIP_INTERVAL === offset) {
            this.machine.rounds++;
            if (this.machine.rounds > 5) {
                this.transition('Removed');
            } else {
                this.doGossip();
            }
        }
    }

    doGossip() {
        let targets = [];
        let attempts = 0;
        while (targets.length < 2 && attempts < 50) {
            attempts++;
            // Randomly select 2 peers from the server pool (indices 1-10)
            let t = getRandom(1, 10);
            if (t !== serverId && !targets.includes(t)) {
                targets.push(t);
            }
        }
        broadcast(targets, { type: 'RUMOR', msgId: 'r1' }, '#ffb74d');
    }
}

class Removed extends State {
    getUI() { return ['REMOVED', '#37474f']; }
    canTransition() { return []; }
}

const M = new GossipMachine();
function onUp() { M.onUp(); }
function onTimer(t) { M.onTimer(t); }
function onMessage(m) { M.onMessage(m); }
