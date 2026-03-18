// Ring Algorithm — Leader Election (Live Node Set Variant)
// Nodes form a logical ring (ID 0 → 1 → ...).
// Protocol:
//   1. Node detecting failure starts election, sends ELECTION with its ID in a live set.
//   2. Each node adds itself to the live set and forwards to the next node.
//   3. If next node is dead (no ACK), it skips to the next-next node.
//   4. When initiator receives the token back, it picks the max ID from the live set as leader.
//   5. Initiator circulates an ELECTED message holding the new leader.
//   6. Leader sends heartbeats.

const RING_MSG_TIMEOUT = 25;
const HEARTBEAT_INTERVAL = 10;
const ACK_TIMEOUT = 15;

function nextNode(id, offset = 1) {
    const n = allServerIds.length;
    return (id + offset) % n;
}

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        const highestId = Math.max(...allServerIds);
        const fsm = new Automat({
            initial: serverId === highestId ? 'leader' : 'follower',
            states: {
                follower: { on: { START_ELECTION: 'candidate', NEW_COORD: 'follower', WON_ELECTION: 'leader' }, color: '#cfd8dc' },
                candidate: { on: { WON_ELECTION: 'leader', NEW_COORD: 'follower' }, color: '#ffb74d' },
                leader: { on: { BECOME_FOLLOWER: 'follower' }, color: '#81c784' }
            }
        });
        dumpState({
            fsm: fsm.serialize(),
            leader: highestId,
            electing: false,
            lastLeaderSeen: 0,
            pendingAckType: null,
        });
    } else {
        const s2 = loadState();
        const fsm = Automat.deserialize(s2.fsm);
        if (fsm.can('NEW_COORD')) fsm.transition('NEW_COORD');
        else if (fsm.can('BECOME_FOLLOWER')) fsm.transition('BECOME_FOLLOWER');
        s2.fsm = fsm.serialize();
        s2.leader = -1;
        s2.electing = false;
        s2.lastLeaderSeen = 0;
        s2.pendingAckType = null;
        dumpState(s2);
    }
}

function sendRingMessage(s, type, payload, tick) {
    s.currentTargetOffset = 1;
    s.pendingAckType = type;
    payload.type = type;
    payload.from = serverId;
    s.pendingPayload = payload;
    s.ackTimeoutTick = tick + ACK_TIMEOUT;

    let next = nextNode(serverId, s.currentTargetOffset);
    sendMessage(next, payload);
}

function onTimer(tick) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    s.tick = tick;

    if (fsm.state === 'leader') {
        if (tick % HEARTBEAT_INTERVAL === 0) {
            for (const id of allServerIds) {
                if (id !== serverId) {
                    sendMessage(id, { type: 'HEARTBEAT', leader: serverId });
                }
            }
        }
        dumpState(s);
        return;
    }

    if (s.pendingAckType && tick > s.ackTimeoutTick) {
        // Neighbor did not ACK. Skip them and try the next one.
        s.currentTargetOffset++;
        if (s.currentTargetOffset >= allServerIds.length) {
            s.pendingAckType = null; // Everyone else is dead
            if (s.pendingPayload.type === 'ELECTION' && s.pendingPayload.initiator === serverId) {
                s.leader = serverId;
                if (fsm.can('WON_ELECTION')) fsm.transition('WON_ELECTION');
                s.electing = false;
            }
        } else {
            s.ackTimeoutTick = tick + ACK_TIMEOUT;
            let next = nextNode(serverId, s.currentTargetOffset);
            sendMessage(next, s.pendingPayload);
        }
    } else if (s.electing && !s.pendingAckType && tick - (s.electionStartTick || 0) > 40) {
        // Token was lost deeply in the ring (e.g. a node crashed after ACKing but before forwarding).
        // Safe global timeout to assume election failed and start a brand new one.
        s.electionStartTick = tick;
        sendRingMessage(s, 'ELECTION', { initiator: serverId, list: [serverId] }, tick);
    }

    // Deterministic staggered timeout offset to prevent simultaneous election storms
    const timeoutOffset = serverId * 15;

    // Follower: detect leader timeout and start election
    if (!s.electing && !s.pendingAckType && tick - s.lastLeaderSeen > (RING_MSG_TIMEOUT + timeoutOffset) && tick > 5) {
        s.electing = true;
        s.electionStartTick = tick;
        if (fsm.can('START_ELECTION')) fsm.transition('START_ELECTION');

        sendRingMessage(s, 'ELECTION', { initiator: serverId, list: [serverId] }, tick);
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    const m = message.payload;
    const tick = s.tick || 0;

    if (m.type === 'HEARTBEAT') {
        s.leader = m.leader;
        s.lastLeaderSeen = tick;
        if (fsm.can('NEW_COORD')) fsm.transition('NEW_COORD');
        else if (fsm.can('BECOME_FOLLOWER')) fsm.transition('BECOME_FOLLOWER');
        s.electing = false;
        s.pendingAckType = null;
    }
    else if (m.type === 'ACK') {
        if (s.pendingAckType === m.ackFor) {
            s.pendingAckType = null; // Message successfully received by neighbor!
        }
    }
    else if (m.type === 'ELECTION') {
        sendMessage(m.from, { type: 'ACK', ackFor: 'ELECTION' });

        // If we recently saw a leader heartbeat, this is a redundant/slow token from a concurrent election.
        const hasRecentLeader = s.leader !== -1 && (tick - s.lastLeaderSeen < RING_MSG_TIMEOUT / 2);

        if (!hasRecentLeader) {
            s.electing = true;
        }

        if (m.initiator === serverId) {
            // Token has completed the ring! Pick the max ID from the live set.
            const newLeader = Math.max(...m.list);
            s.leader = newLeader;
            s.lastLeaderSeen = tick; // Refresh timer so we don't immediately timeout again before the new leader can heartbeat
            if (newLeader === serverId) {
                if (fsm.can('WON_ELECTION')) fsm.transition('WON_ELECTION');
            } else {
                if (fsm.can('NEW_COORD')) fsm.transition('NEW_COORD');
            }
            s.electing = false;
            s.pendingAckType = null;

            // Circulate ELECTED message
            sendRingMessage(s, 'ELECTED', { leader: newLeader, initiator: serverId }, tick);
        } else {
            if (!hasRecentLeader && fsm.can('START_ELECTION')) {
                fsm.transition('START_ELECTION');
            }

            if (m.list && m.list.includes(serverId)) {
                // Ghost token detected! The initiator died before receiving its own token back.
                // We securely intercept this immortal token, destroy it, and start a fresh election.
                s.electing = true;
                s.electionStartTick = tick;
                sendRingMessage(s, 'ELECTION', { initiator: serverId, list: [serverId] }, tick);
                s.fsm = fsm.serialize();
                dumpState(s);
                return;
            }

            // Add ourselves to the live set and forward
            s.electionStartTick = tick; // Prevent 40-tick fail-safe from instantaneously triggering upon ACK receipt!
            let newList = m.list ? [...m.list, serverId] : [serverId];
            sendRingMessage(s, 'ELECTION', { initiator: m.initiator, list: newList }, tick);
        }
    }
    else if (m.type === 'ELECTED') {
        sendMessage(m.from, { type: 'ACK', ackFor: 'ELECTED' });

        if (m.initiator !== serverId) {
            s.leader = m.leader;
            if (m.leader === serverId) {
                if (fsm.can('WON_ELECTION')) fsm.transition('WON_ELECTION');
            } else {
                if (fsm.can('NEW_COORD')) fsm.transition('NEW_COORD');
                else if (fsm.can('BECOME_FOLLOWER')) fsm.transition('BECOME_FOLLOWER');
            }
            s.electing = false;
            s.lastLeaderSeen = tick;

            // Forward ELECTED message around the ring
            sendRingMessage(s, 'ELECTED', { leader: m.leader, initiator: m.initiator }, tick);
        } else {
            // The ELECTED message has completed the ring!
            s.pendingAckType = null;
        }
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}
