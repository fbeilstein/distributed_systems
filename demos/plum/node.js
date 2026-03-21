const fsmDef = {
    initial: 'WAIT',
    states: {
        'WAIT': { on: { 'GET_MSG': 'GOT_MSG', 'LAZY_ID': 'SYNC' }, color: '#cfd8dc' },
        'SYNC': { on: { 'GET_MSG': 'GOT_MSG' }, color: '#ffb74d' },
        'GOT_MSG': { on: {}, color: '#2e7d32' }
    }
};

function onUp() {
    let s = loadState();
    if (!s.fsm) {
        s.fsm = new Automat(fsmDef).serialize();
        s.seenMessages = {};
        s.missingTimers = {};
        s.messagesToLazyPush = [];

        // Manual 7-Node symmetric tree hierarchy from Root(3)
        const eagerMap = {
            0: [1],
            1: [0, 2, 3], // Parent 3, Children 0, 2
            2: [1],
            3: [1, 5],    // Root
            4: [5],
            5: [3, 4, 6], // Parent 3, Children 4, 6
            6: [5]
        };
        // Background cross-link mesh overlay
        const lazyMap = {
            0: [2],
            1: [],
            2: [0, 4], // The structural bridge from Left to Right
            3: [],
            4: [2, 6], // The structural bridge from Right to Left
            5: [],
            6: [4]
        };

        s.eagerPeers = eagerMap[serverId] || [];
        s.lazyPeers = lazyMap[serverId] || [];

        dumpState(s);
    }
}

function onTimer(tick) {
    let s = loadState();
    if (!s.fsm) return;

    let fsm = Automat.deserialize(s.fsm);

    // Root initiates the single eager payload multicast on tick 10
    if (serverId === 3 && tick === 10 && fsm.state === 'WAIT') {
        const msgId = 'm1';
        s.seenMessages[msgId] = true;
        fsm.transition('GET_MSG');
        s.fsm = fsm.serialize();

        for (let p of s.eagerPeers) {
            sendMessage(p, { type: 'EAGER_PUSH', msgId: msgId, payload: 'Plumtree Payload' });
        }
        s.messagesToLazyPush.push(msgId);
    }

    // Immediate-reaction lazy pushes for newly seen messages (staggered)
    if (tick > 0 && tick % 15 === serverId % 15) {
        for (let msgId of s.messagesToLazyPush) {
            for (let p of s.lazyPeers) {
                sendMessage(p, { type: 'LAZY_ID', msgId: msgId });
            }
        }
        s.messagesToLazyPush = [];
    }

    // Persistent Anti-Entropy Loop for Late Recovery
    // Actively broadcasts known message IDs to all peers to catch up nodes booting from deep crashes
    if (tick > 0 && tick % 30 === serverId % 30) {
        for (let msgId of Object.keys(s.seenMessages)) {
            // Push to both active and inactive trees to ensure comprehensive saturation
            for (let p of s.lazyPeers.concat(s.eagerPeers)) {
                sendMessage(p, { type: 'LAZY_ID', msgId: msgId });
            }
        }
    }

    // Check GRAFT timers to dynamically repair the network
    for (const msgId in s.missingTimers) {
        let info = s.missingTimers[msgId];
        if (!s.seenMessages[msgId] && tick >= info.tickBound) {
            sendMessage(info.target, { type: 'GRAFT', msgId: msgId });

            // Re-promote the passive link into the active spanning tree loop
            s.lazyPeers = s.lazyPeers.filter(p => p !== info.target);
            if (!s.eagerPeers.includes(info.target)) s.eagerPeers.push(info.target);

            delete s.missingTimers[msgId];
        }
    }

    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    let fsm = Automat.deserialize(s.fsm);
    let m = message.payload;
    const currentTick = message.arrivalTick;

    if (m.type === 'EAGER_PUSH') {
        if (!s.seenMessages[m.msgId]) {
            s.seenMessages[m.msgId] = true;
            delete s.missingTimers[m.msgId];
            fsm.transition('GET_MSG');
            s.fsm = fsm.serialize();

            // Relocate down the spanning tree branches
            for (let p of s.eagerPeers) {
                if (p !== message.from) {
                    sendMessage(p, { type: 'EAGER_PUSH', msgId: m.msgId, payload: m.payload });
                }
            }
            if (!s.messagesToLazyPush.includes(m.msgId)) s.messagesToLazyPush.push(m.msgId);
        } else {
            // Already seen! Found a cycle returning to center overlay loop
            sendMessage(message.from, { type: 'PRUNE' });
            s.eagerPeers = s.eagerPeers.filter(p => p !== message.from);
            if (!s.lazyPeers.includes(message.from)) s.lazyPeers.push(message.from);
        }
    } else if (m.type === 'LAZY_ID') {
        if (!s.seenMessages[m.msgId]) {
            if (!s.missingTimers[m.msgId]) {
                // Buffer to grant spanning cascades time to route inherently
                s.missingTimers[m.msgId] = { tickBound: currentTick + 15, target: message.from };

                // Visually display discrepancy detected
                if (fsm.state === 'WAIT') {
                    fsm.transition('LAZY_ID');
                    s.fsm = fsm.serialize();
                }
            }
        }
    } else if (m.type === 'GRAFT') {
        s.lazyPeers = s.lazyPeers.filter(p => p !== message.from);
        if (!s.eagerPeers.includes(message.from)) s.eagerPeers.push(message.from);

        sendMessage(message.from, { type: 'EAGER_PUSH', msgId: m.msgId, payload: 'Plumtree Payload' });
    } else if (m.type === 'PRUNE') {
        s.eagerPeers = s.eagerPeers.filter(p => p !== message.from);
        if (!s.lazyPeers.includes(message.from)) s.lazyPeers.push(message.from);
    }

    dumpState(s);
}
