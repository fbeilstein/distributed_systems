// SIR Gossip Dissemination (Susceptible-Infected-Recovered)
const GOSSIP_INTERVAL = 15;
const FANOUT = 2; // Fixed number of random peers to broadcast towards during a target block
const REDUNDANT_THRESHOLD = 3; // Transmissions to track prior to assuming total system saturation

const fsmDef = {
    initial: 'SUSCEPTIBLE',
    states: {
        'SUSCEPTIBLE': { on: { 'INFECT': 'INFECTED' }, color: '#cfd8dc' },
        'INFECTED': { on: { 'RECOVER': 'REMOVED' }, color: '#ffb74d' },
        'REMOVED': { on: {}, color: '#333333' }
    }
};

function onUp() {
    let s = loadState();
    if (!s.fsm) {
        const fsm = new Automat(fsmDef);
        s.fsm = fsm.serialize();
        s.redundantCount = 0;
        dumpState(s);
    }
}

function onTimer(tick) {
    let s = loadState();
    if (!s.fsm) return;

    const fsm = Automat.deserialize(s.fsm);

    // Patient Zero drops the rumor
    if (serverId === 0 && tick === 5 && fsm.state === 'SUSCEPTIBLE') {
        fsm.transition('INFECT');
        s.fsm = fsm.serialize();
    }

    if (fsm.state === 'INFECTED') {
        // Proportional stagger intervals evenly across the exact network size
        const offset = Math.floor((serverId / allServerIds.length) * GOSSIP_INTERVAL);
        if (tick % GOSSIP_INTERVAL === offset) {
            s.rounds = (s.rounds || 0) + 1;
            if (s.rounds > 5) {
                fsm.transition('RECOVER');
                s.fsm = fsm.serialize();
            } else {
                let targets = [];

                // Loop until we map FANOUT distinct peers
                let attempts = 0;
                while (targets.length < FANOUT && attempts < 20) {
                    attempts++;
                    let t = prng.nextInt(0, allServerIds.length - 1);
                    if (t !== serverId && !targets.includes(t)) {
                        targets.push(t);
                    }
                }

                for (let t of targets) {
                    sendMessage(t, { type: 'RUMOR' });
                }
            }
        }
    }

    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);

    if (message.payload.type === 'RUMOR') {
        if (fsm.state === 'SUSCEPTIBLE') {
            fsm.transition('INFECT');
            s.fsm = fsm.serialize();
        } else if (fsm.state === 'INFECTED') {
            s.redundantCount++;
            if (s.redundantCount >= REDUNDANT_THRESHOLD) {
                fsm.transition('RECOVER');
                s.fsm = fsm.serialize();
            }
        }
    }

    dumpState(s);
}
