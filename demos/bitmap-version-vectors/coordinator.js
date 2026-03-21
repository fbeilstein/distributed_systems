function onUp() { }

function onTimer(tick) {
    if (tick > 0 && tick % 40 === 0) {
        // Kick off a round-trip sequential chain: Coord -> C -> B -> A -> C
        sendMessage(3, { type: 'SYNC_CHAIN' });
    }
}

function onMessage(message) { }
