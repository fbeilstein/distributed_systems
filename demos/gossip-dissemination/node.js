// SIR Gossip Dissemination (Susceptible → Infected → Removed)
// Node 0 starts a rumor at tick 5. Infected nodes spread to FANOUT random peers.
// After enough rounds or redundant receptions, nodes transition to Removed.

const GOSSIP_INTERVAL = 15;
const FANOUT = 2;
const REDUNDANT_THRESHOLD = 3;

function onUp() {
    let s = loadState();
    if (!s.state) {
        s.state = 'SUSCEPTIBLE';
        s.redundantCount = 0;
        s.rounds = 0;
        s.ui_state = 'Susceptible';
        s.ui_color = '#cfd8dc';
    }
    dumpState(s);
}

function onTimer(tick) {
    let s = loadState();

    // Patient Zero drops the rumor
    if (serverId === 0 && tick === 5 && s.state === 'SUSCEPTIBLE') {
        s.state = 'INFECTED';
        s.ui_state = 'Infected (Spreading)';
        s.ui_color = '#ffb74d';
    }

    if (s.state === 'INFECTED') {
        const offset = Math.floor((serverId / allServerIds.length) * GOSSIP_INTERVAL);
        if (tick % GOSSIP_INTERVAL === offset) {
            s.rounds++;
            if (s.rounds > 5) {
                s.state = 'REMOVED';
                s.ui_state = 'Removed';
                s.ui_color = '#333333';
            } else {
                // Pick FANOUT distinct random peers
                let targets = [];
                let attempts = 0;
                while (targets.length < FANOUT && attempts < 20) {
                    attempts++;
                    let t = getRandom(0, allServerIds.length - 1);
                    if (t !== serverId && !targets.includes(t)) {
                        targets.push(t);
                    }
                }
                for (const t of targets) {
                    sendMessage(t, { type: 'RUMOR' });
                }
            }
        }
    }

    dumpState(s);
}

function onMessage(message) {
    let s = loadState();

    if (message.payload.type === 'RUMOR') {
        if (s.state === 'SUSCEPTIBLE') {
            s.state = 'INFECTED';
            s.ui_state = 'Infected (Spreading)';
            s.ui_color = '#ffb74d';
        } else if (s.state === 'INFECTED') {
            s.redundantCount++;
            if (s.redundantCount >= REDUNDANT_THRESHOLD) {
                s.state = 'REMOVED';
                s.ui_state = 'Removed';
                s.ui_color = '#333333';
            }
        }
    }

    dumpState(s);
}
