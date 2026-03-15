// SWIM — Scalable Weakly-consistent Infection-style Membership
// Protocol:
//   1. Every PING_INTERVAL ticks, pick one random peer to ping directly (PING).
//   2. If no ACK within ACK_TIMEOUT ticks, send PING_REQ to K other peers,
//      asking them to ping the suspect on our behalf.
//   3. If still no indirect ACK within IND_TIMEOUT ticks, mark peer as SUSPECT.
//   4. After CONFIRM_TIMEOUT more ticks as suspect, mark as FAILED and gossip it.
//   5. All state changes are piggybacked on every outgoing message (infection-style).

const PING_INTERVAL = 12;
const ACK_TIMEOUT = 8;
const IND_TIMEOUT = 16;
const CONFIRM_TIMEOUT = 20;
const K_INDIRECT = 2;   // number of indirect pingers

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        // member states: 'alive' | 'suspect' | 'failed'
        const members = {};
        for (const id of allServerIds) {
            members[id] = { status: 'alive', incarnation: 0, suspectSince: null };
        }
        dumpState({
            members,
            pendingPing: null,          // { target, sentTick, indirect: bool }
            pingQueue: [...allServerIds.filter(id => id !== serverId)],
        });
    }
}

function piggyback(s) {
    // Collect the top 3 most-recent state changes to attach to messages
    return Object.entries(s.members)
        .filter(([, m]) => m.status !== 'alive')
        .map(([id, m]) => ({ id: parseInt(id), status: m.status }))
        .slice(0, 3);
}

function applyGossip(s, updates) {
    if (!updates) return;
    for (const u of updates) {
        const m = s.members[u.id];
        if (!m) continue;
        if (u.status === 'failed') m.status = 'failed';
        else if (u.status === 'suspect' && m.status === 'alive') {
            m.status = 'suspect';
            m.suspectSince = s.tick;
        }
    }
}

function onTimer(tick) {
    let s = loadState();
    s.tick = tick;

    // Confirm suspects → failed after timeout
    for (const [idStr, m] of Object.entries(s.members)) {
        if (m.status === 'suspect' && m.suspectSince !== null && tick - m.suspectSince > CONFIRM_TIMEOUT) {
            m.status = 'failed';
        }
    }

    // Initiate a new ping cycle every PING_INTERVAL ticks
    if (tick % PING_INTERVAL === serverId % PING_INTERVAL && !s.pendingPing) {
        // Pick next target from queue (skip failed nodes)
        let target = null;
        while (s.pingQueue.length > 0) {
            const candidate = s.pingQueue.shift();
            if (s.members[candidate] && s.members[candidate].status !== 'failed' && candidate !== serverId) {
                target = candidate;
                break;
            }
        }
        if (s.pingQueue.length === 0) {
            // Refill queue
            s.pingQueue = allServerIds.filter(id => id !== serverId && s.members[id] && s.members[id].status !== 'failed');
        }
        if (target !== null) {
            sendMessage(target, { type: 'PING', from: serverId, updates: piggyback(s) });
            s.pendingPing = { target, sentTick: tick, indirect: false };
        }
    }

    // Direct ACK timeout — switch to indirect pings
    if (s.pendingPing && !s.pendingPing.indirect && tick - s.pendingPing.sentTick > ACK_TIMEOUT) {
        s.pendingPing.indirect = true;
        s.pendingPing.sentTick = tick;
        // Send PING_REQ to K random other nodes
        const others = allServerIds.filter(id => id !== serverId && id !== s.pendingPing.target && s.members[id] && s.members[id].status === 'alive');
        const helpers = others.slice(0, K_INDIRECT);
        for (const h of helpers) {
            sendMessage(h, { type: 'PING_REQ', target: s.pendingPing.target, from: serverId, updates: piggyback(s) });
        }
    }

    // Indirect ACK timeout — mark as suspect
    if (s.pendingPing && s.pendingPing.indirect && tick - s.pendingPing.sentTick > IND_TIMEOUT) {
        const target = s.pendingPing.target;
        if (s.members[target] && s.members[target].status === 'alive') {
            s.members[target].status = 'suspect';
            s.members[target].suspectSince = tick;
        }
        s.pendingPing = null;
    }

    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const m = message.payload;

    applyGossip(s, m.updates);

    if (m.type === 'PING') {
        sendMessage(message.from, { type: 'ACK', from: serverId, updates: piggyback(s) });
    }

    else if (m.type === 'PING_REQ') {
        // Try to ping the target on behalf of the requester
        sendMessage(m.target, { type: 'PING_INDIRECT', requester: message.from, from: serverId, updates: piggyback(s) });
    }

    else if (m.type === 'PING_INDIRECT') {
        // Respond both to the actual pinger and propagate back to requester
        sendMessage(message.from, { type: 'ACK_INDIRECT', requester: m.requester, target: serverId, updates: piggyback(s) });
    }

    else if (m.type === 'ACK_INDIRECT') {
        // Forward to original requester
        sendMessage(m.requester, { type: 'ACK', from: m.target, indirect: true, updates: m.updates });
    }

    else if (m.type === 'ACK') {
        const sender = m.from !== undefined ? m.from : message.from;
        if (s.members[sender]) {
            s.members[sender].status = 'alive';
            s.members[sender].suspectSince = null;
        }
        // Clear pending ping if this is for it
        if (s.pendingPing && s.pendingPing.target === sender) {
            s.pendingPing = null;
        }
    }

    dumpState(s);
}
