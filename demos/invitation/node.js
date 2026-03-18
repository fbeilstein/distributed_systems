// Invitation Algorithm — Leader Election
// Multiple leaders of small groups "invite" peers to join their group.
// Protocol:
//   1. Each node starts as a single-node group with itself as leader.
//   2. Group leader periodically sends INVITE to nodes not in its group.
//   3. A node receiving INVITE joins the larger group (or stays if theirs is bigger).
//   4. Eventually all nodes merge into one group.
//
// Demo: 5 nodes start as individual groups → merge via invitations.

// Demo: 5 nodes start as individual groups → merge via invitations.

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        const fsm = new Automat({
            initial: 'leader',
            states: {
                leader: { on: { JOIN_GROUP: 'follower' }, color: '#81c784' },
                follower: { on: { BECOME_LEADER: 'leader' }, color: '#cfd8dc' }
            }
        });
        dumpState({
            fsm: fsm.serialize(),
            groupId: serverId,         // Group identified by leader's ID
            leader: serverId,          // Who we follow
            members: [serverId],       // Known members of our group
            nextInviteTick: serverId * 5 + 5, // Stagger initial invites
            outbox: [],
        });
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

    if (fsm.state === 'leader' && tick >= (s.nextInviteTick || 0)) {
        // Schedule the next invite dynamically between 20 and 40 ticks
        const delay = 20 + ((tick * 11 + serverId * 3) % 20);
        s.nextInviteTick = tick + delay;

        // Send INVITE to one pseudo-random node not in our group
        const outsiders = allServerIds.filter(id => !s.members.includes(id));
        if (outsiders.length > 0) {
            const randomIndex = (tick * 7 + serverId) % outsiders.length;
            const targetId = outsiders[randomIndex];

            s.outbox.push({
                to: targetId, payload: {
                    type: 'INVITE',
                    groupId: s.groupId,
                    leader: serverId,
                    members: s.members,
                }
            });
        }
    }

    processOutbox(s);
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    const m = message.payload;

    if (m.type === 'INVITE' || m.type === 'FORWARD') {
        if (m.leader === s.leader) {
            // Ignore own group
        } else if (fsm.state !== 'leader') {
            // Followers don't negotiate; forward to their leader
            s.outbox.push({ to: s.leader, payload: { ...m, type: 'FORWARD' } });
        } else {
            // We are the leader, evaluate the invite
            const ourSize = s.members.length;
            const theirSize = m.members.length;
            const shouldJoin = theirSize > ourSize || (theirSize === ourSize && m.leader > s.leader);

            if (shouldJoin) {
                // Join the other group
                s.groupId = m.groupId;
                s.leader = m.leader;

                // Keep track of our old members before we overwrite our state, we need to notify them
                const oldMembers = s.members.filter(id => id !== serverId && !m.members.includes(id));

                s.members = [...new Set([...m.members, ...s.members])]; // merge member lists
                if (fsm.can('JOIN_GROUP')) fsm.transition('JOIN_GROUP');

                // Notify our new leader that we joined
                s.outbox.push({ to: m.leader, payload: { type: 'JOIN_ACK', from: serverId, members: s.members } });

                // Notify our old members to also transition
                for (const id of oldMembers) {
                    s.outbox.push({ to: id, payload: { type: 'MERGE', newLeader: m.leader, groupId: m.groupId, members: s.members } });
                }
            } else {
                // Our group wins — counter-invite
                s.outbox.push({
                    to: m.leader, payload: {
                        type: 'INVITE',
                        groupId: s.groupId,
                        leader: serverId,
                        members: s.members,
                    }
                });
            }
        }
    }

    else if (m.type === 'JOIN_ACK') {
        if (fsm.state === 'leader') {
            // Add new member to our group
            if (!s.members.includes(m.from)) {
                s.members.push(m.from);
            }
            // Merge all their known members too
            for (const id of (m.members || [])) {
                if (!s.members.includes(id)) s.members.push(id);
            }
        } else {
            // We stepped down while they were joining us. Forward to our new leader!
            s.outbox.push({ to: s.leader, payload: m });
            // And proactively tell the stranded follower that we moved!
            s.outbox.push({ to: m.from, payload: { type: 'MERGE', newLeader: s.leader, groupId: s.groupId, members: s.members } });
        }
    }

    else if (m.type === 'MERGE') {
        // Our old group leader is merging us into a new group
        s.leader = m.newLeader;
        s.groupId = m.groupId;
        if (serverId === m.newLeader) {
            if (fsm.can('BECOME_LEADER')) fsm.transition('BECOME_LEADER');
        } else {
            if (fsm.can('JOIN_GROUP')) fsm.transition('JOIN_GROUP');
        }
        s.members = m.members || s.members;
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}
