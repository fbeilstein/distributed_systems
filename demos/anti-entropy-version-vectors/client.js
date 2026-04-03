// Bitmap Version Vectors — Client
// Sends write requests to random replicas.

const CLIENT_ID = 0;
const COORD_ID = 4;
const REPLICAS = allServerIds.filter(id => id !== CLIENT_ID && id !== COORD_ID);

function onUp() {
    dumpState({
        ui_state: 'Client',
        ui_color: '#7e57c2'
    });
}

function onTimer(t) {
    if (t > 5 && t % 5 === 0) {
        const target = REPLICAS[getRandom(0, REPLICAS.length - 1)];
        sendMessage(target, { type: 'WRITE_REQ' }, 'blue');
    }
}
