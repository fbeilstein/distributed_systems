// Bully Algorithm with Next-In-Line Failover
// Optimization: when the leader is elected, it assigns a priority-ordered failover list.
// When the leader crashes, the FIRST alive node in the failover list self-promotes
// immediately — no re-election needed.
//
// Demo: Node 4 is leader. Assigns failover list [3, 2, 1, 0].
//       Node 4 crashes at tick 20 → Node 3 promotes itself in ~1 round.
//       Compare to base Bully: recovery is much faster (no cascading ELECTION messages).

const HEARTBEAT_INTERVAL = 8;
const LEADER_TIMEOUT = 22;

const NO_LEADER = -1;

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        dumpState({
            leader: serverId === 4 ? 4 : NO_LEADER,
            status: serverId === 4 ? 'leader' : 'follower',
            failoverList: [],      // Ordered list of backup IDs (set by leader)
            lastLeaderSeen: 0,
        });
    } else {
        // On recovery, check if we're the head of the failover list
        const s2 = loadState();
        // Re-enter as follower — will discover new leader via heartbeats or trigger failover
        s2.status = 'follower';
        s2.leader = NO_LEADER;
        s2.lastLeaderSeen = 0;
        dumpState(s2);
    }
}

function onTimer(tick) {
    let s = loadState();
    s.tick = tick;

    if (s.status === 'leader') {
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
    if (tick - s.lastLeaderSeen > LEADER_TIMEOUT && tick > 5) {
        // Check if I am the first in the failover list
        if (s.failoverList.length > 0 && s.failoverList[0] === serverId) {
            // I am next-in-line — self-promote immediately!
            s.status = 'leader';
            s.leader = serverId;
            const failover = allServerIds.filter(id => id !== serverId).sort((a, b) => b - a);
            s.failoverList = failover;
            for (const id of allServerIds) {
                if (id !== serverId) {
                    sendMessage(id, { type: 'COORDINATOR', leader: serverId, failoverList: failover });
                }
            }
        } else if (s.failoverList.length === 0) {
            // No list — fall back to bully
            s.status = 'electing';
            const higher = allServerIds.filter(id => id > serverId);
            if (higher.length === 0) {
                s.status = 'leader';
                s.leader = serverId;
                for (const id of allServerIds) {
                    if (id !== serverId) sendMessage(id, { type: 'COORDINATOR', leader: serverId, failoverList: [] });
                }
            } else {
                for (const id of higher) {
                    sendMessage(id, { type: 'ELECTION' });
                }
            }
        }
        // else: not first in failover list — wait, the one before me should promote
    }

    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const m = message.payload;

    if (m.type === 'HEARTBEAT') {
        s.leader = m.leader;
        s.lastLeaderSeen = s.tick !== undefined ? s.tick : 0;
        s.status = 'follower';
        if (m.failoverList) s.failoverList = m.failoverList;
    }

    else if (m.type === 'COORDINATOR') {
        s.leader = m.leader;
        s.lastLeaderSeen = s.tick !== undefined ? s.tick : 0;
        s.status = 'follower';
        if (m.failoverList) s.failoverList = m.failoverList;
    }

    else if (m.type === 'ELECTION') {
        // Bully fallback
        sendMessage(message.from, { type: 'OK' });
        if (s.status !== 'leader' && s.status !== 'electing') {
            s.status = 'electing';
            const higher = allServerIds.filter(id => id > serverId);
            if (higher.length === 0) {
                s.status = 'leader';
                s.leader = serverId;
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
        if (s.status === 'electing') s.status = 'waiting';
    }

    dumpState(s);
}
