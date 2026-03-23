// Egalitarian Paxos (EPaxos) Dependency Resolution Demo
//
// Shows how EPaxos achieves consensus without a distinguished leader
// by building a dependency graph of commands to dynamically establish order.
//
// Scenario:
// Leader-1 (Node 0) pre-accepts set_x=5 with no dependencies.
// Leader-2 (Node 1) pre-accepts inc_x=1 with no dependencies simultaneously.
// Replicas detect the conflict on 'x', returning modified dependencies to Leader-2.
// Leader-1 commits on the Fast Path (1 round trip).
// Leader-2 is forced onto the Slow Path (2 round trips) due to conflicting responses.
// Both commit, but execute in dependency order: set_x then inc_x.

const QUORUM_FAST = 4; // Out of 5 (includes leader)
const QUORUM_SLOW = 3; // Out of 5

function onUp() {
    let s = loadState();
    if (Object.keys(s).length === 0) {

        const fsmStates = {
            idle: { on: { START: 'pre_accept', RECEIVED: 'follower' }, color: '#cfd8dc' },
            follower: { on: {}, color: '#b0bec5' },
            pre_accept: { on: { FAST_PATH: 'fast_commit', SLOW_PATH: 'accepting' }, color: '#ffb74d' },
            fast_commit: { on: {}, color: '#4caf50' },
            accepting: { on: { COMMIT: 'slow_commit' }, color: '#e57373' }, // Slow path is red/pink to highlight
            slow_commit: { on: {}, color: '#81c784' }
        };

        const fsm = new Automat({ initial: 'idle', states: fsmStates });

        dumpState({
            fsm: fsm.serialize(),

            // Leader state
            cmd: null,
            myDeps: [],
            preAcceptReplies: [],
            acceptReplies: 0,

            // Shared Replica storage
            log: {},     // cmdId -> { cmd, deps, status: 'pre-accepted' | 'accepted' | 'committed' | 'executed' }
            executed: [], // History of executed commands

            outbox: []
        });
    }
}

function processOutbox(s) {
    if (s.outbox && s.outbox.length > 0) {
        const msg = s.outbox.shift();
        sendMessage(msg.to, msg.payload);
    }
}

function tryExecute(s) {
    // A command can execute if it is 'committed' and ALL its dependencies are 'executed'.
    let madeProgress = true;
    while (madeProgress) {
        madeProgress = false;
        for (let cmdId of Object.keys(s.log)) {
            let entry = s.log[cmdId];
            if (entry.status === 'committed') {
                let depsMet = true;
                for (let dep of entry.deps) {
                    if (!s.log[dep] || s.log[dep].status !== 'executed') {
                        depsMet = false; break;
                    }
                }
                if (depsMet) {
                    entry.status = 'executed';
                    s.executed.push(entry.cmd);
                    madeProgress = true;
                }
            }
        }
    }
}

function conflicts(cmd1, cmd2) {
    // In our simplified demo, set_x and inc_x always conflict on the key 'x'
    return (cmd1.indexOf('_x') !== -1 && cmd2.indexOf('_x') !== -1);
}

function getDependencies(s, incomingCmd) {
    let deps = [];
    for (let cmdId of Object.keys(s.log)) {
        if (conflicts(s.log[cmdId].cmd, incomingCmd)) {
            deps.push(cmdId);
        }
    }
    return deps;
}

function onTimer(tick) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    s.tick = tick;

    // Leader 1 proposing set_x
    if (serverId === 0 && tick === 10 && fsm.state === 'idle') {
        if (fsm.can('START')) fsm.transition('START');
        s.cmd = 'set_x';
        s.myDeps = [];

        s.log[s.cmd] = { cmd: s.cmd, deps: s.myDeps, status: 'pre-accepted' };
        s.preAcceptReplies.push({ from: 0, deps: [] }); // Self pre-accept

        for (const id of allServerIds) {
            if (id !== 0) s.outbox.push({ to: id, payload: { type: 'PRE_ACCEPT', cmdId: s.cmd, deps: s.myDeps } });
        }
    }

    // Leader 2 proposing inc_x (slightly later)
    if (serverId === 1 && tick === 12 && fsm.state === 'idle') {
        if (fsm.can('START')) fsm.transition('START');
        s.cmd = 'inc_x';
        s.myDeps = []; // Leader 2 thinks there are no deps!

        s.log[s.cmd] = { cmd: s.cmd, deps: s.myDeps, status: 'pre-accepted' };
        s.preAcceptReplies.push({ from: 1, deps: [] }); // Self pre-accept

        for (const id of allServerIds) {
            if (id !== 1) s.outbox.push({ to: id, payload: { type: 'PRE_ACCEPT', cmdId: s.cmd, deps: s.myDeps } });
        }
    }

    s.fsm = fsm.serialize();
    processOutbox(s);
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const fsm = Automat.deserialize(s.fsm);
    const m = message.payload;

    if (fsm.state === 'idle' && fsm.can('RECEIVED')) fsm.transition('RECEIVED');

    // --- REPLICA PATH ---

    if (m.type === 'PRE_ACCEPT') {
        // Calculate dynamic dependencies based on local uncommitted/committed log
        let localDeps = getDependencies(s, m.cmdId);

        // Merge leader's deps with local discovered deps
        let finalDeps = [...new Set([...m.deps, ...localDeps])];

        s.log[m.cmdId] = { cmd: m.cmdId, deps: finalDeps, status: 'pre-accepted' };
        s.outbox.push({ to: message.from, payload: { type: 'PRE_ACCEPT_OK', cmdId: m.cmdId, deps: finalDeps } });
    }

    else if (m.type === 'ACCEPT') {
        // Force adoption of leader's decided dependencies
        if (!s.log[m.cmdId]) s.log[m.cmdId] = { cmd: m.cmdId, deps: m.deps, status: 'accepted' };
        else {
            s.log[m.cmdId].deps = m.deps;
            s.log[m.cmdId].status = 'accepted';
        }
        s.outbox.push({ to: message.from, payload: { type: 'ACCEPT_OK', cmdId: m.cmdId } });
    }

    else if (m.type === 'COMMIT') {
        if (!s.log[m.cmdId]) s.log[m.cmdId] = { cmd: m.cmdId, deps: m.deps, status: 'committed' };
        else {
            s.log[m.cmdId].deps = m.deps;
            s.log[m.cmdId].status = 'committed';
        }
        tryExecute(s);
    }

    // --- LEADER PATH ---

    else if (m.type === 'PRE_ACCEPT_OK' && fsm.state === 'pre_accept' && m.cmdId === s.cmd) {
        s.preAcceptReplies.push({ from: message.from, deps: m.deps });

        if (s.preAcceptReplies.length >= QUORUM_FAST) {
            // Check if all replies had identically empty dependencies (Fast Path!)
            // Or identical dependencies to our original proposal.
            let identical = true;
            for (let reply of s.preAcceptReplies) {
                if (reply.deps.length !== s.myDeps.length) identical = false;
                for (let d of reply.deps) if (!s.myDeps.includes(d)) identical = false;
            }

            if (identical) {
                // FAST PATH
                if (fsm.can('FAST_PATH')) fsm.transition('FAST_PATH');
                s.log[s.cmd].status = 'committed';
                for (const id of allServerIds) {
                    if (id !== serverId) s.outbox.push({ to: id, payload: { type: 'COMMIT', cmdId: s.cmd, deps: s.myDeps } });
                }
                tryExecute(s);
            } else {
                // SLOW PATH - merge dependencies
                let mergedDeps = new Set(s.myDeps);
                for (let reply of s.preAcceptReplies) {
                    for (let d of reply.deps) mergedDeps.add(d);
                }
                s.myDeps = Array.from(mergedDeps);

                if (fsm.can('SLOW_PATH')) fsm.transition('SLOW_PATH');
                s.acceptReplies = 1; // Self accept
                s.log[s.cmd].deps = s.myDeps;
                s.log[s.cmd].status = 'accepted';

                for (const id of allServerIds) {
                    if (id !== serverId) s.outbox.push({ to: id, payload: { type: 'ACCEPT', cmdId: s.cmd, deps: s.myDeps } });
                }
            }
        }
    }

    else if (m.type === 'ACCEPT_OK' && fsm.state === 'accepting' && m.cmdId === s.cmd) {
        s.acceptReplies++;
        if (s.acceptReplies >= QUORUM_SLOW) {
            if (fsm.can('COMMIT')) fsm.transition('COMMIT');
            s.log[s.cmd].status = 'committed';
            for (const id of allServerIds) {
                if (id !== serverId) s.outbox.push({ to: id, payload: { type: 'COMMIT', cmdId: s.cmd, deps: s.myDeps } });
            }
            tryExecute(s);
        }
    }

    s.fsm = fsm.serialize();
    dumpState(s);
}
