// Anti-Entropy — Read Repair & Hinted Handoff
// Coordinator receives writes and replicates to all replicas.
// On read, coordinator queries replicas, detects stale values using version numbers,
// and triggers read repair (sends the latest value to stale replicas).
//
// Demo:
//   - Tick 10: Coordinator writes v1 to all replicas.
//   - Replica-2 is down during write → gets a "hinted handoff" queued.
//   - Tick 45: Replica-2 comes back → coordinator detects staleness on next read,
//     triggers repair by re-sending the value.
//   - Tick 65: Coordinator does a second write (v2) → full replication.

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {
        if (serverId === 0) {
            // Coordinator
            dumpState({
                role: 'coordinator',
                version: 0,
                data: null,
                pendingWrites: {},  // { replicaId: {data, version} } — hinted handoff queue
                quorum: 0,
                readReplies: {},
                outbox: [],
            });
        } else {
            // Replica
            dumpState({
                role: 'replica',
                version: 0,
                data: null,
                outbox: [],
            });
        }
    } else if (serverId !== 0) {
        // Replica recovered — signal coordinator
        // We'll queue this on the next timer tick or manual if outbox initialized
        let outbox = s.outbox || [];
        outbox.push({ to: 0, payload: { type: 'RECOVERY_NOTICE', replicaId: serverId } });
        s.outbox = outbox;
        dumpState(s);
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
    s.tick = tick;

    if (serverId === 0) {
        // Write 1 at tick 10
        if (tick === 10) {
            s.version++;
            s.data = 'value_v' + s.version;
            s.pendingWrites = {};
            const replicas = allServerIds.filter(id => id !== 0);
            for (const r of replicas) {
                s.outbox.push({ to: r, payload: { type: 'WRITE', data: s.data, version: s.version } });
            }
        }

        // Read (anti-entropy check) at tick 40
        if (tick === 40) {
            s.readReplies = {};
            const replicas = allServerIds.filter(id => id !== 0);
            for (const r of replicas) {
                s.outbox.push({ to: r, payload: { type: 'READ_REQUEST' } });
            }
        }

        // Write 2 at tick 65
        if (tick === 65) {
            s.version++;
            s.data = 'value_v' + s.version;
            s.pendingWrites = {};
            const replicas = allServerIds.filter(id => id !== 0);
            for (const r of replicas) {
                s.outbox.push({ to: r, payload: { type: 'WRITE', data: s.data, version: s.version } });
            }
        }

        // Retry hinted handoff periodically
        if (tick % 15 === 0 && Object.keys(s.pendingWrites).length > 0) {
            for (const [rid, pending] of Object.entries(s.pendingWrites)) {
                s.outbox.push({ to: parseInt(rid), payload: { type: 'WRITE', data: pending.data, version: pending.version, hinted: true } });
            }
        }
    }

    processOutbox(s);
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const m = message.payload;

    if (serverId === 0) {
        // Coordinator message handling
        if (m.type === 'WRITE_ACK') {
            // Remove from hinted handoff queue if present
            delete s.pendingWrites[message.from];
        }

        else if (m.type === 'WRITE_NACK') {
            // Replica was down — queue hinted handoff
            s.pendingWrites[message.from] = { data: m.data, version: m.version };
        }

        else if (m.type === 'READ_REPLY') {
            s.readReplies[message.from] = { version: m.version, data: m.data };

            // Check if all replied
            const replicas = allServerIds.filter(id => id !== 0);
            const replied = replicas.filter(id => s.readReplies[id] !== undefined);
            if (replied.length === replicas.length) {
                // Find the latest version
                let latestVersion = s.version;
                let latestData = s.data;
                for (const [rid, reply] of Object.entries(s.readReplies)) {
                    if (reply.version > latestVersion) {
                        latestVersion = reply.version;
                        latestData = reply.data;
                    }
                }
                // Read repair: fix stale replicas
                for (const [rid, reply] of Object.entries(s.readReplies)) {
                    if (reply.version < latestVersion) {
                        s.outbox.push({ to: parseInt(rid), payload: { type: 'REPAIR', data: latestData, version: latestVersion } });
                    }
                }
            }
        }

        else if (m.type === 'RECOVERY_NOTICE') {
            // Replica came back — deliver any pending hinted handoff
            if (s.pendingWrites[m.replicaId]) {
                const pending = s.pendingWrites[m.replicaId];
                s.outbox.push({ to: m.replicaId, payload: { type: 'WRITE', data: pending.data, version: pending.version, hinted: true } });
            }
        }
    }

    else {
        // Replica message handling
        if (m.type === 'WRITE' || m.type === 'REPAIR') {
            if (m.version > s.version) {
                s.version = m.version;
                s.data = m.data;
            }
            s.outbox.push({ to: 0, payload: { type: 'WRITE_ACK', version: s.version } });
        }

        else if (m.type === 'READ_REQUEST') {
            s.outbox.push({ to: 0, payload: { type: 'READ_REPLY', version: s.version, data: s.data } });
        }
    }

    dumpState(s);
}
