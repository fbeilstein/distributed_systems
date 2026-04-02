// Bitmap Version Vectors — Coordinator (Sync Manager)
// Periodically triggers chain synchronization across replicas.

const INIT_SYNC_REPLICA_ID = 1;

function onUp() {
    dumpState({
        ui_state: 'Coordinator',
        ui_color: '#8d6e63'
    });
}

function onTimer(t) {
    if (t > 10 && t % 50 === 0) {
        sendMessage(INIT_SYNC_REPLICA_ID, { type: 'SYNC_DATA', matrix: {}, step: 1 }, 'purple');
    }
}
