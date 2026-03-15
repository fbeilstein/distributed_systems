// Bully Algorithm with Next-In-Line Failover
// Optimization: when the leader is elected, it assigns a priority-ordered failover list.
// When the leader crashes, the FIRST alive node in the failover list self-promotes
// immediately — no re-election needed.

const HEARTBEAT_INTERVAL = 8;
const LEADER_TIMEOUT = 22;

const NO_LEADER = -1;

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        const fsm = new Automat({
            initial: serverId === 4 ? 'leader' : 'follower',
            states: {
                follower: { on: { START_ELECTION: 'electing', BECOME_LEADER: 'leader' }, color: '#cfd8dc' },
                electing: { on: { HIGHER_ID_ANSWERED: 'waiting', WON_ELECTION: 'leader', NEW_COORD: 'follower' }, color: '#ffb74d' },
                waiting: { on: { NEW_COORD: 'follower', START_ELECTION: 'electing' }, color: '#fff59d' },
                leader: { on: { BECOME_FOLLOWER: 'follower' }, color: '#81c784' }
            }
        });
        dumpState({
            fsm: fsm.serialize(),
            leader: serverId === 4 ? 4 : NO_LEADER,
            failoverList: [],      // Ordered list of backup IDs (set by leader)
            lastLeaderSeen: 0,
            outbox: [],
        });
    } else {
        // On recovery, check if we're the head of the failover list
        const s2 = loadState();
        const fsm = Automat.deserialize(s2.fsm);
        if (fsm.can('NEW_COORD')) fsm.transition('NEW_COORD');
        else if (fsm.can('BECOME_FOLLOWER')) fsm.transition('BECOME_FOLLOWER');
        s2.fsm = fsm.serialize();
        s2.leader = NO_LEADER;
        s2.lastLeaderSeen = 0;
        dumpState(s2);
    }
}

function processOutbox(s) {
    if (s.outbox && s.outbox.length > 0) {
        const msg = s.outbox.shift();
        sendMessage(msg.to, msg.payload);
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
                    s.outbox.push({ to: id, payload: { type: 'HEARTBEAT', leader: serverId, failoverList: failover } });
                }
            }
        }
        processOutbox(s);
        dumpState(s);
        return;
    }

    // Follower/Backup: timeout detected
    if (tick - s.lastLeaderSeen > LEADER_TIMEOUT && tick > 5) {
        // Check if I am the first in the failover list
        if (s.failoverList.length > 0 && s.failoverList[0] === serverId) {
            // I am next-in-line — self-promote immediately!
            if (fsm.can('WON_ELECTION')) fsm.transition('WON_ELECTION');
            else if (fsm.can('BECOME_LEADER')) fsm.transition('BECOME_LEADER');

            s.leader = serverId;
            const failover = allServerIds.filter(id => id !== serverId).sort((a, b) => b - a);
            s.failoverList = failover;
            for (const id of allServerIds) {
                if (id !== serverId) {
                    s.outbox.push({ to: id, payload: { type: 'COORDINATOR', leader: serverId, failoverList: failover } });
                }
            }
        } else if (s.failoverList.length === 0) {
            // No list — fall back to bully
            if (fsm.can('START_ELECTION')) fsm.transition('START_ELECTION');
            const higher = allServerIds.filter(id => id > serverId);
            if (higher.length === 0) {
                if (fsm.can('WON_ELECTION')) fsm.transition('WON_ELECTION');
                else fsm.transition('BECOME_LEADER'); // from follower directly if no lower ID sent msg before
                s.leader = serverId;
                for (const id of allServerIds) {
                    if (id !== serverId) s.outbox.push({ to: id, payload: { type: 'COORDINATOR', leader: serverId, failoverList: [] } });
                }
            } else {
                for (const id of higher) {
                    s.outbox.push({ to: id, payload: { type: 'ELECTION' } });
                }
            }
        }
        // else: not first in failover list — wait, the one before me should promote
    }

    s.fsm = fsm.serialize();
    processOutbox(s);
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    const m = message.payload;

    if (m.type === 'HEARTBEAT') {
        s.leader = m.leader;
        s.lastLeaderSeen = s.tick !== undefined ? s.tick : 0;
        if (fsm.state !== 'follower') {
            if (fsm.can('NEW_COORD')) fsm.transition('NEW_COORD');
            else if (fsm.can('BECOME_FOLLOWER')) fsm.transition('BECOME_FOLLOWER');
        }
        if (m.failoverList) s.failoverList = m.failoverList;
    }

    else if (m.type === 'COORDINATOR') {
        s.leader = m.leader;
        s.lastLeaderSeen = s.tick !== undefined ? s.tick : 0;
        if (fsm.state !== 'follower') {
            if (fsm.can('NEW_COORD')) fsm.transition('NEW_COORD');
            else if (fsm.can('BECOME_FOLLOWER')) fsm.transition('BECOME_FOLLOWER');
        }
        if (m.failoverList) s.failoverList = m.failoverList;
    }

    else if (m.type === 'ELECTION') {
        // Bully fallback
        s.outbox.push({ to: message.from, payload: { type: 'OK' } });
        if (fsm.state !== 'leader' && fsm.state !== 'electing') {
            if (fsm.can('START_ELECTION')) fsm.transition('START_ELECTION');
            const higher = allServerIds.filter(id => id > serverId);
            if (higher.length === 0) {
                if (fsm.can('WON_ELECTION')) fsm.transition('WON_ELECTION');
                s.leader = serverId;
                const failover = allServerIds.filter(id => id !== serverId).sort((a, b) => b - a);
                s.failoverList = failover;
                for (const id of allServerIds) {
                    if (id !== serverId) s.outbox.push({ to: id, payload: { type: 'COORDINATOR', leader: serverId, failoverList: failover } });
                }
            } else {
                for (const id of higher) s.outbox.push({ to: id, payload: { type: 'ELECTION' } });
            }
        }
    }

    else if (m.type === 'OK') {
        if (fsm.state === 'electing') {
            if (fsm.can('HIGHER_ID_ANSWERED')) fsm.transition('HIGHER_ID_ANSWERED');
        }
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}
