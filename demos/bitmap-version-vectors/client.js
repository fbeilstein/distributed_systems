function onUp() { }

function onTimer(tick) {
    if (tick % 5 === 0 && tick < 180) {
        const target = 1 + prng.nextInt(0, 2);
        sendMessage(target, { type: 'WRITE_REQ' });
    }
}

function onMessage(message) { }
