// ZAB — Zookeeper Atomic Broadcast
// Leader proposes. When quorum ACKs a proposal, leader commits.
// Node 0: Leader, Nodes 1-4: Followers, Node 5: Client.

const CLIENT_ID = 5;
const LEADER_ID = 0;
const FOLLOWERS = [1, 2, 3, 4];
const QUORUM = 3;

class ZAB_Client extends State {
    get name() { return 'client: active'; }
    getState() { return ['client: active', '#ce93d8']; }
    onEnter() { this.setTimeout(30, 'sendReq'); }
    sendReq() {
        this.reqVal = (this.reqVal || 0) + 1;
        sendMessage(LEADER_ID, { type: 'CLIENT_REQ', val: `DATA_${this.reqVal}` }, 'blue');
        this.setTimeout(40, 'sendReq');
    }
}

class ZAB_Leader extends State {
    get name() { return 'LEADER'; }
    getState() { return ['LEADER', '#8bc34a']; }
    registerMessageTypes() {
        return {
            'CLIENT_REQ': (msg) => {
                this.machine.counter++;
                const zxid = `${this.machine.epoch}-${this.machine.counter}`;
                this.machine.log.push({ zxid, val: msg.payload.val, ackCount: 1, committed: false });
                broadcast(FOLLOWERS, { type: 'PROPOSAL', zxid, val: msg.payload.val }, 'orange');
            },
            'ACK': (msg) => {
                const entry = this.machine.log.find(e => e.zxid === msg.payload.zxid);
                if (entry) {
                    entry.ackCount++;
                    if (entry.ackCount >= QUORUM && !entry.committed) {
                        entry.committed = true;
                        broadcast(FOLLOWERS, { type: 'COMMIT', zxid: entry.zxid }, 'green');
                    }
                }
            }
        };
    }
}

class ZAB_Follower extends State {
    get name() { return 'follower'; }
    getState() { return ['follower', '#4db6ac']; }
    registerMessageTypes() {
        return {
            'PROPOSAL': (msg) => {
                const { zxid, val } = msg.payload;
                this.machine.log.push({ zxid, val, committed: false });
                sendMessage(LEADER_ID, { type: 'ACK', zxid }, 'green');
            },
            'COMMIT': (msg) => {
                const entry = this.machine.log.find(e => e.zxid === msg.payload.zxid);
                if (entry) entry.committed = true;
            }
        };
    }
}

class ZABMachine extends Machine {
    constructor() {
        super();
        this.states = [new ZAB_Client(), new ZAB_Leader(), new ZAB_Follower()];
        this.epoch = 1;
        this.counter = 0;
        this.log = [];
        if (serverId === CLIENT_ID) this._initialState = 'client: active';
        else if (serverId === LEADER_ID) this._initialState = 'LEADER';
        else this._initialState = 'follower';
    }
}

const MACHINE = new ZABMachine();

function onUp() { MACHINE.onUp(); }
function onTimer(t) { MACHINE.onTimer(t); }
function onMessage(m) { MACHINE.onMessage(m); }
