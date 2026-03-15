// Invitation Algorithm — Leader Election
// Multiple leaders of small groups "invite" peers to join their group.
// Protocol:
//   1. Each node starts as a single-node group with itself as leader.
//   2. Group leader periodically sends INVITE to nodes not in its group.
//   3. A node receiving INVITE joins the larger group (or stays if theirs is bigger).
//   4. Eventually all nodes merge into one group.
//
// Demo: 5 nodes start as individual groups → merge via invitations.

const INVITE_INTERVAL = 12;

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        dumpState({
            groupId: serverId,         // Group identified by leader's ID
            leader: serverId,          // Who we follow
            members: [serverId],       // Known members of our group
            isLeader: true,
        });
    }
}

function onTimer(tick) {
    let s = loadState();
    s.tick = tick;

    if (s.isLeader && tick % INVITE_INTERVAL === serverId % INVITE_INTERVAL) {
        // Send INVITE to nodes not in our group
        const outsiders = allServerIds.filter(id => !s.members.includes(id));
        for (const id of outsiders) {
            sendMessage(id, {
                type: 'INVITE',
                groupId: s.groupId,
                leader: serverId,
                members: s.members,
            });
        }
    }

    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const m = message.payload;

    if (m.type === 'INVITE') {
        // Accept if inviting group is larger than ours, or same size with higher leader ID
        const ourSize = s.members.length;
        const theirSize = m.members.length;
        const shouldJoin = theirSize > ourSize || (theirSize === ourSize && m.leader > s.leader);

        if (shouldJoin && m.leader !== s.leader) {
            // Join the other group
            const wasLeader = s.isLeader;
            s.groupId = m.groupId;
            s.leader = m.leader;
            s.members = [...new Set([...m.members, ...s.members])]; // merge member lists
            s.isLeader = (serverId === m.leader);

            // Notify our new leader that we joined
            sendMessage(m.leader, { type: 'JOIN_ACK', from: serverId, members: s.members });

            // If we were a leader of our old group, notify our old members
            if (wasLeader) {
                const oldMembers = s.members.filter(id => id !== serverId && !m.members.includes(id));
                for (const id of oldMembers) {
                    sendMessage(id, { type: 'MERGE', newLeader: m.leader, groupId: m.groupId, members: s.members });
                }
            }
        } else if (!shouldJoin && m.leader !== s.leader) {
            // Our group wins — counter-invite
            if (s.isLeader) {
                sendMessage(m.leader, {
                    type: 'INVITE',
                    groupId: s.groupId,
                    leader: serverId,
                    members: s.members,
                });
            }
        }
    }

    else if (m.type === 'JOIN_ACK') {
        if (s.isLeader) {
            // Add new member to our group
            if (!s.members.includes(m.from)) {
                s.members.push(m.from);
            }
            // Merge all their known members too
            for (const id of (m.members || [])) {
                if (!s.members.includes(id)) s.members.push(id);
            }
        }
    }

    else if (m.type === 'MERGE') {
        // Our old group leader is merging us into a new group
        s.leader = m.newLeader;
        s.groupId = m.groupId;
        s.isLeader = (serverId === m.newLeader);
        s.members = m.members || s.members;
    }

    dumpState(s);
}
