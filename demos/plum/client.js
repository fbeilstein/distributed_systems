// Client triggers 3 Stage Plumtree Requests
function onUp() { }

function onTimer(tick) {
    // Request 1: Tick 20 (demonstrates Grafting if Node 1 is crashed)
    if (tick === 20) {
        sendMessage(3, { type: 'CLIENT_REQ', msgId: 'm1' }, '#7e57c2');
    }
    // Request 2: Tick 150 (demonstrates Pruning after Node 1 recovers)
    if (tick === 150) {
        sendMessage(3, { type: 'CLIENT_REQ', msgId: 'm2' }, '#7e57c2');
    }
    // Request 3: Tick 280 (demonstrates stabilized tree)
    if (tick === 280) {
        sendMessage(3, { type: 'CLIENT_REQ', msgId: 'm3' }, '#7e57c2');
    }
}

function onMessage(msg) { }
