// Bully Algorithm with Next-In-Line Failover
// Optimization: when the leader is elected, it assigns a priority-ordered failover list.
// When the leader crashes, the FIRST alive node in the failover list self-promotes
// immediately — no re-election needed.

const HEARTBEAT_INTERVAL = 8;
const LEADER_TIMEOUT = 22;
const ELECTION_TIMEOUT = 10;

const NO_LEADER = -1;

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        const fsm = new Automat({
            initial: serverId === 4 ? 'leader' : 'follower',
            states: {
                follower: { on: { START_ELECTION: 'electing', BECOME_LEADER: 'leader' }, color: '#cfd8dc' },
                electing: { on: { BECOME_FOLLOWER: 'follower', WON_ELECTION: 'leader' }, color: '#ffb74d' },
                leader: { on: { BECOME_FOLLOWER: 'follower' }, color: '#81c784' }
            }
        });
        dumpState({
            fsm: fsm.serialize(),
            leader: serverId === 4 ? 4 : NO_LEADER,
            failoverList: [],      // Ordered list of backup IDs (set by leader)
            lastLeaderSeen: 0,
            permutation: [2, 4, 1, 3, 0], // Randomness for leader timeout
            electing: false,
            bullyFallback: false,
            electionStartTick: null,
        });
    } else {
        // On recovery, check if we're the head of the failover list
        const s2 = loadState();
        const fsm = Automat.deserialize(s2.fsm);
        if (fsm.can('BECOME_FOLLOWER')) fsm.transition('BECOME_FOLLOWER');
        s2.fsm = fsm.serialize();
        s2.leader = NO_LEADER;
        s2.lastLeaderSeen = 0;
        s2.electing = false;
        s2.bullyFallback = false;
        s2.electionStartTick = null;
        s2.failoverList = []; // Clear stale list so recovering node properly asserts itself
        if (!s2.permutation) s2.permutation = [2, 4, 1, 3, 0];
        dumpState(s2);
    }
}

function onTimer(tick) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    s.tick = tick;

    if (fsm.state === 'leader') {
        if (tick % HEARTBEAT_INTERVAL === 0) {
            // Build failover list (descending IDs, excluding self)
            const failover = allServerIds.filter(id => id !== serverId).sort((a, b) => b - a);
            s.failoverList = failover;
            for (const id of allServerIds) {
                if (id !== serverId) {
                    sendMessage(id, { type: 'HEARTBEAT', leader: serverId, failoverList: failover });
                }
            }
        }
        dumpState(s);
        return;
    }

    // Follower/Backup: timeout detected
    // Shift the timeout based on the random permutation
    const offset = s.permutation ? s.permutation.indexOf(serverId) * 5 : 0;///!!!!

    if (!s.electing && tick - s.lastLeaderSeen > LEADER_TIMEOUT + offset && tick > 5) {
        s.electing = true;
        s.electionStartTick = tick;

        if (s.failoverList.length > 0) {
            const highestAlt = s.failoverList[0];
            if (highestAlt === serverId) {
                // I am the highest alive node in the failover list — self-promote!
                if (fsm.can('WON_ELECTION')) fsm.transition('WON_ELECTION');
                else if (fsm.can('BECOME_LEADER')) fsm.transition('BECOME_LEADER');

                s.leader = serverId;
                const failover = allServerIds.filter(id => id !== serverId).sort((a, b) => b - a);
                s.failoverList = failover;
                s.electing = false;
                for (const id of allServerIds) {
                    if (id !== serverId) {
                        sendMessage(id, { type: 'COORDINATOR', leader: serverId, failoverList: failover });
                    }
                }
            } else {
                // Ping the highest ranked alternative as per lecture: `3 -ping-> 5`
                if (fsm.can('START_ELECTION')) fsm.transition('START_ELECTION');
                sendMessage(highestAlt, { type: 'FAILOVER_PING', from: serverId });
            }
        } else {
            // No list or not in list — fall back to bully
            if (fsm.can('START_ELECTION')) fsm.transition('START_ELECTION');
            const higher = allServerIds.filter(id => id > serverId);
            if (higher.length === 0) {
                if (fsm.can('WON_ELECTION')) fsm.transition('WON_ELECTION');
                else fsm.transition('BECOME_LEADER'); // from follower directly if no lower ID sent msg before
                s.leader = serverId;
                s.electing = false;
                s.bullyFallback = false;
                for (const id of allServerIds) {
                    if (id !== serverId) sendMessage(id, { type: 'COORDINATOR', leader: serverId, failoverList: [] });
                }
            } else {
                for (const id of higher) {
                    sendMessage(id, { type: 'ELECTION' });
                }
            }
        }
    }

    // If electing, handle timeouts
    if (s.electing && s.electionStartTick !== null) {
        if (!s.bullyFallback && tick - s.electionStartTick > ELECTION_TIMEOUT) {
            // FAILOVER_PING timed out without ALIVE response. Switch to bully ELECTION.
            s.bullyFallback = true;
            s.electionStartTick = tick;
            const higher = allServerIds.filter(id => id > serverId);
            if (higher.length === 0) {
                s.leader = serverId;
                s.electing = false;
                s.bullyFallback = false;
                if (fsm.can('WON_ELECTION')) fsm.transition('WON_ELECTION');
                const failover = allServerIds.filter(id => id !== serverId).sort((a, b) => b - a);
                s.failoverList = failover;
                for (const id of allServerIds) {
                    if (id !== serverId) sendMessage(id, { type: 'COORDINATOR', leader: serverId, failoverList: failover });
                }
            } else {
                for (const id of higher) {
                    sendMessage(id, { type: 'ELECTION' });
                }
            }
        }
        else if (s.bullyFallback && tick - s.electionStartTick > ELECTION_TIMEOUT) {
            // ELECTION timed out (no OK received from higher nodes). We win!
            if (fsm.can('WON_ELECTION')) fsm.transition('WON_ELECTION');
            s.leader = serverId;
            s.electing = false;
            s.bullyFallback = false;
            const failover = allServerIds.filter(id => id !== serverId).sort((a, b) => b - a);
            s.failoverList = failover;
            for (const id of allServerIds) {
                if (id !== serverId) {
                    sendMessage(id, { type: 'COORDINATOR', leader: serverId, failoverList: failover });
                }
            }
        }
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    const m = message.payload;

    if (m.type === 'HEARTBEAT') {
        s.leader = m.leader;
        s.lastLeaderSeen = s.tick !== undefined ? s.tick : 0;
        s.electing = false;
        s.bullyFallback = false;
        s.electionStartTick = null;
        if (fsm.state !== 'follower') {
            if (fsm.can('NEW_COORD')) fsm.transition('NEW_COORD');
            else if (fsm.can('BECOME_FOLLOWER')) fsm.transition('BECOME_FOLLOWER');
        }
        if (m.failoverList) s.failoverList = m.failoverList;
    }

    else if (m.type === 'COORDINATOR') {
        s.leader = m.leader;
        s.lastLeaderSeen = s.tick !== undefined ? s.tick : 0;
        s.electing = false;
        s.bullyFallback = false;
        s.electionStartTick = null;
        if (fsm.state !== 'follower') {
            if (fsm.can('NEW_COORD')) fsm.transition('NEW_COORD');
            else if (fsm.can('BECOME_FOLLOWER')) fsm.transition('BECOME_FOLLOWER');
        }
        if (m.failoverList) s.failoverList = m.failoverList;
    }

    else if (m.type === 'ELECTION') {
        // Bully fallback
        sendMessage(message.from, { type: 'OK' });
        if (fsm.state !== 'leader' && !s.electing) {
            s.electing = true;
            s.bullyFallback = true;
            s.electionStartTick = tick;
            if (fsm.can('START_ELECTION')) fsm.transition('START_ELECTION');
            const higher = allServerIds.filter(id => id > serverId);
            if (higher.length === 0) {
                if (fsm.can('WON_ELECTION')) fsm.transition('WON_ELECTION');
                s.leader = serverId;
                s.electing = false;
                s.bullyFallback = false;
                const failover = allServerIds.filter(id => id !== serverId).sort((a, b) => b - a);
                s.failoverList = failover;
                for (const id of allServerIds) {
                    if (id !== serverId) sendMessage(id, { type: 'COORDINATOR', leader: serverId, failoverList: failover });
                }
            } else {
                for (const id of higher) sendMessage(id, { type: 'ELECTION' });
            }
        }
    }

    else if (m.type === 'OK') {
        if (s.electing) {
            // Someone higher responded. Back down and reset our timeout so we don't spam.
            s.electing = false;
            s.bullyFallback = false;
            s.electionStartTick = null;
            s.lastLeaderSeen = s.tick !== undefined ? s.tick : 0;
            if (fsm.can('BECOME_FOLLOWER')) fsm.transition('BECOME_FOLLOWER');
        }
    }

    else if (m.type === 'FAILOVER_PING') {
        // Another node thinks leader is dead. Reply alive.
        sendMessage(m.from, { type: 'FAILOVER_ALIVE', from: serverId });
        if (fsm.can('START_ELECTION')) fsm.transition('START_ELECTION');
    }

    else if (m.type === 'FAILOVER_ALIVE') {
        // The highest alternative is alive. Notify them to take over.
        sendMessage(m.from, { type: 'FAILOVER_NOTIFY', from: serverId });
        s.electing = false;
        s.bullyFallback = false;
        s.electionStartTick = null;
        // Reset our timer to give them time to become leader and send heartbeats
        s.lastLeaderSeen = s.tick !== undefined ? s.tick : 0;
        if (fsm.can('BECOME_FOLLOWER')) fsm.transition('BECOME_FOLLOWER');
    }

    else if (m.type === 'FAILOVER_NOTIFY') {
        // We received the formal notification from the detector. Self-promote!
        if (fsm.can('WON_ELECTION')) fsm.transition('WON_ELECTION');
        else if (fsm.can('BECOME_LEADER')) fsm.transition('BECOME_LEADER');

        s.leader = serverId;
        const failover = allServerIds.filter(id => id !== serverId).sort((a, b) => b - a);
        s.failoverList = failover;
        s.electing = false;
        s.bullyFallback = false;

        for (const id of allServerIds) {
            if (id !== serverId) {
                sendMessage(id, { type: 'COORDINATOR', leader: serverId, failoverList: failover });
            }
        }
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}
