const CLIENT_ID = 0;
const COORD_ID = 4;
const REPLICAS = allServerIds.filter(id => id !== CLIENT_ID && id !== COORD_ID);
const PEERS = REPLICAS.filter(id => id !== serverId);

class BVVMachine extends Machine {
    constructor() {
        super();
        this.states = [new Idle(), new Syncing()];
        this.matrix = {};
        REPLICAS.forEach(id => {
            this.matrix[id] = [];
        });
        this.localSeq = 0;
    }

    syncUI() {
        this.vectorMatrix = this.matrix;
    }
}

class BVVState extends State {
    onUp() { this.transition('Idle'); }

    onWRITE_REQ(msg) {
        this.machine.localSeq++;
        const origin = serverId;
        if (!this.machine.matrix[origin]) this.machine.matrix[origin] = [];
        this.machine.matrix[origin].push(this.machine.localSeq);
        broadcast(PEERS, { type: 'REPLICATE', origin, seq: this.machine.localSeq }, 'orange');
    }

    onREPLICATE(msg) {
        const { origin, seq } = msg.payload;
        if (!this.machine.matrix[origin]) this.machine.matrix[origin] = [];
        if (!this.machine.matrix[origin].includes(seq)) {
            this.machine.matrix[origin].push(seq);
            this.machine.matrix[origin].sort((a, b) => a - b);
        }
    }

    _getNextInChain() {
        const myIndex = REPLICAS.indexOf(serverId);
        const nextIndex = (myIndex + 1) % REPLICAS.length;
        return REPLICAS[nextIndex];
    }

    _merge(peerMatrix) {
        Object.keys(peerMatrix || {}).forEach(origin => {
            if (!this.machine.matrix[origin]) this.machine.matrix[origin] = [];
            peerMatrix[origin].forEach(seq => {
                if (!this.machine.matrix[origin].includes(seq)) {
                    this.machine.matrix[origin].push(seq);
                    this.machine.matrix[origin].sort((a, b) => a - b);
                }
            });
        });
    }
}

class Idle extends BVVState {
    getUI() { return ['Idle', '#4fc3f7']; }
    canTransition() { return ['Syncing']; }

    onSYNC_DATA(msg) {
        const visited = msg.payload.visited || [];
        this._merge(msg.payload.matrix);

        // Add self to visited and propagate
        visited.push(serverId);
        sendMessage(this._getNextInChain(), {
            type: 'SYNC_DATA',
            matrix: this.machine.matrix,
            visited: visited
        }, 'purple');

        this.transition('Syncing');
    }
}

class Syncing extends BVVState {
    getUI() { return ['Syncing', '#9c27b0']; }
    canTransition() { return ['Idle']; }
    onEnter() { this.setTimeout(20, 'returnIdle', 'sync'); }
    returnIdle() { this.transition('Idle'); }

    onSYNC_DATA(msg) {
        const visited = msg.payload.visited || [];
        this._merge(msg.payload.matrix);

        // Add self to visited
        visited.push(serverId);


        // Stop propagation when each node has been visited twice (total 2 * N visits)
        if (visited.length < REPLICAS.length * 2) {
            sendMessage(this._getNextInChain(), {
                type: 'SYNC_DATA',
                matrix: this.machine.matrix,
                visited: visited
            }, 'purple');
        }
        this.returnIdle();
    }
}

const M = new BVVMachine();
function onUp() { M.onUp(); }
function onTimer(t) { M.onTimer(t); }
function onMessage(m) { M.onMessage(m); }
