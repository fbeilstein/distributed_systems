// Raft Client - State Instance Pattern (Decoupled Display)
class Idle extends State {
    getState() { return ['idle', '#cfd8dc']; }
    onTimer(tick) { if (tick === 40) this.sendRequest(); }
    sendRequest() {
        let s = loadState(); s.txId++; s.targetNode = 0; dumpState(s);
        this.transition('waiting');
    }
}
class Waiting extends State {
    getState() { return ['waiting', '#fff59d']; }
    onEnter() { this.addTimeout(15, 'retry'); this.send(); }
    send() {
        let s = loadState();
        sendMessage(s.targetNode, { type: 'CLIENT_REQUEST', txId: s.txId, data: 'req: x=' + (s.txId * 25) });
    }
    retry() {
        let s = loadState(); s.targetNode = (s.targetNode + 1) % 5; dumpState(s);
        this.send();
        this.addTimeout(15, 'retry');
    }
    onMessage(msg) {
        if (msg.payload.type === 'REDIRECT') {
            if (msg.payload.leaderId !== null && msg.payload.leaderId !== undefined) {
                let s = loadState(); s.targetNode = msg.payload.leaderId; dumpState(s);
                this.send(); // Immediate retry to correct node
            } else {
                this.retry(); // Fallback to round-robin
            }
        }
        else if (msg.payload.type === 'CLIENT_RESPONSE') { this.transition('success'); }
    }
}
class Success extends State {
    getState() { return ['success', '#81c784']; }
    onEnter() { this.addTimeout(10, 'done'); }
    done() { this.transition('idle'); }
}

const ROLES = [new Idle(), new Waiting(), new Success()];

function onUp() {
    let s = loadState();
    if (s.txId === undefined) dumpState({ txId: 0, targetNode: 0 });
    Automat.run('onUp', null, ...ROLES);
}
function onTimer(t) { Automat.run('onTimer', t, ...ROLES); }
function onMessage(m) { Automat.run('onMessage', m, ...ROLES); }
