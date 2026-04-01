// Invitation Algorithm — Leader Election via Group Merging
// Each node starts as a single-node group with itself as leader.
// Leaders periodically invite outsiders to join. Groups merge by size.

function onUp() {
    dumpState({
        isLeader: true,
        groupId: serverId,
        leader: serverId,
        members: [serverId],
        nextInviteTick: serverId * 5 + 5
    });
}

function syncUI(s) {
    s.group_view = `Leader:${s.leader} Members:[${s.members.join(',')}]`;
    s.current_state = s.isLeader ? ['Leader', '#81c784'] : ['Follower', '#cfd8dc'];
}

function onMessage(m) {
    let s = loadState();
    const payload = m.payload;

    if (payload.type === 'INVITE' || payload.type === 'FORWARD') {
        if (!s.isLeader) {
            // Follower forwards to its leader
            if (payload.leader !== s.leader) {
                sendMessage(s.leader, { ...payload, type: 'FORWARD' });
            }
        } else {
            // Leader evaluates the invitation
            if (payload.leader === s.leader) {
                // Same group, do nothing
            } else {
                const shouldJoin = payload.members.length > s.members.length ||
                    (payload.members.length === s.members.length && payload.leader > s.leader);

                if (shouldJoin) {
                    const oldMembers = s.members.filter(id => id !== serverId && !payload.members.includes(id));
                    s.groupId = payload.groupId;
                    s.leader = payload.leader;
                    s.members = [...new Set([...payload.members, ...s.members])];
                    s.isLeader = false;

                    sendMessage(payload.leader, { type: 'JOIN_ACK', from: serverId, members: s.members });
                    for (const id of oldMembers) {
                        sendMessage(id, { type: 'MERGE', newLeader: payload.leader, groupId: payload.groupId, members: s.members });
                    }
                } else {
                    // Counter-invite
                    sendMessage(payload.leader, {
                        type: 'INVITE',
                        groupId: s.groupId,
                        leader: serverId,
                        members: s.members
                    }, 'blue');
                }
            }
        }
    }
    else if (payload.type === 'JOIN_ACK') {
        if (s.isLeader) {
            if (!s.members.includes(payload.from)) s.members.push(payload.from);
            for (const id of (payload.members || [])) {
                if (!s.members.includes(id)) s.members.push(id);
            }
        } else {
            sendMessage(s.leader, payload);
            sendMessage(payload.from, { type: 'MERGE', newLeader: s.leader, groupId: s.groupId, members: s.members });
        }
    }
    else if (payload.type === 'MERGE') {
        s.leader = payload.newLeader;
        s.groupId = payload.groupId;
        s.members = payload.members || s.members;
        s.isLeader = (serverId === payload.newLeader);
    }

    syncUI(s);
    dumpState(s);
}

function onTimer(tick) {
    let s = loadState();

    if (s.isLeader && tick >= s.nextInviteTick) {
        const delay = 20 + ((tick * 11 + serverId * 3) % 20);
        s.nextInviteTick = tick + delay;

        const outsiders = allServerIds.filter(id => !s.members.includes(id));
        if (outsiders.length > 0) {
            const target = outsiders[getRandom(0, outsiders.length - 1)];
            sendMessage(target, {
                type: 'INVITE',
                groupId: s.groupId,
                leader: serverId,
                members: s.members
            }, 'blue');
        }
    }

    syncUI(s);
    dumpState(s);
}
