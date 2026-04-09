const CLUSTER = [1, 2, 3, 4];

class ClientState extends State {
    getUI() { return ['CLIENT', '#ce93d8']; }

    onEnter() {
        this.reqVal = 0;
        this.setTimeout(15, 'sendReq');
    }

    sendReq() {
        this.reqVal++;
        // The client connects to any random node in the cluster
        const target = CLUSTER[getRandom(0, CLUSTER.length - 1)];
        sendMessage(target, { type: 'CLIENT_REQ', val: `DATA_${this.reqVal}` }, 'blue');

        this.setTimeout(40, 'sendReq');
    }
}

class ClientMachine extends Machine {
    constructor() {
        super();
        this.states = [new ClientState()];
    }
}

const M = new ClientMachine();
function onUp() { M.onUp(); }
function onTimer(t) { M.onTimer(t); }
function onMessage(m) { M.onMessage(m); }