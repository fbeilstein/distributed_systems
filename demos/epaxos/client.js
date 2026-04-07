// EPaxos — Client Requests

const REPLICA_1 = 0;
const REPLICA_2 = 1;
const REPLICA_5 = 4;

function onUp() {
    dumpState({ ui_state: 'Client Generator', ui_color: '#eceff1' });
}

function onTimer(t) {
    if (serverId !== 5) return;

    // 1. Independent command. Will easily take the FAST PATH.
    if (t === 10) {
        sendMessage(REPLICA_1, { type: 'CLIENT_REQUEST', key: 'X', val: 'Cmd_X1' }, 'black');
    }

    // 2. Conflicting commands to different replicas simultaneously!
    // This causes a dependency mismatch -> SLOW PATH recovery.
    else if (t === 50) {
        sendMessage(REPLICA_2, { type: 'CLIENT_REQUEST', key: 'Y', val: 'Cmd_Y1' }, 'black');
        sendMessage(REPLICA_5, { type: 'CLIENT_REQUEST', key: 'Y', val: 'Cmd_Y2' }, 'black');
    }
}