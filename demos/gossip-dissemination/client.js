// Client starts the Gossip Infection
function onUp() { }

function onTimer(tick) {
    if (tick === 5) {
        // ALWAYS infect the first server (Index 1) to match original "Patient Zero" placement
        sendMessage(1, { type: 'RUMOR', msgId: 'r1' }, '#7e57c2');
    }
}

function onMessage(m) { }
