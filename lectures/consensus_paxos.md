# Consensus: Paxos Algorithm
## Reaching agreement in the face of failures

---

# Why Consensus?

In massive, geographically distributed networks, processes must often agree on a **single value** — a log entry, a configuration change, a leader's identity.

If every step requires peer-to-peer negotiation with *every* participant, the communication overhead becomes prohibitive. Yet simply delegating the decision to one node creates a **single point of failure**.

**Consensus** is the formal problem of making a group of processes agree on one value, even when messages are delayed, lost, or nodes crash.

---

# Consensus Is Everywhere

Consensus is not just a theoretical curiosity. It underpins:

* **Total-order broadcast** — delivering messages to all nodes in the same order.
* **Replicated state machines** — keeping database replicas identical.
* **Leader election** — picking one coordinator without a split-brain.
* **Distributed locks and configuration stores** — etcd, ZooKeeper, Consul.

> *An **atomic broadcast** (total-order multicast) is provably equivalent to consensus in asynchronous systems with crash failures.*

---

# What Consensus Guarantees

A correct consensus algorithm must satisfy:

| Property | Meaning |
|---|---|
| **Agreement** | No two correct processes decide different values |
| **Validity** | The decided value was proposed by some process |
| **Termination** | Every correct process eventually decides |

Agreement and validity together guarantee **safety** — the system never reaches a bad state. Termination guarantees **liveness** — the system eventually makes progress.

---

# The Consensus Properties in Plain Words

* **Agreement**: disagreement is forever impossible — once a majority agrees, it stays agreed.
* **Once a majority agrees** this is consensus — no need for every node.
* **Eventually known by everyone** — the decided value disseminates to all learners.
* Involved parties want to agree on **any** result — the value itself doesn't matter, agreement does.
* **Messages can get lost** — the protocol must survive network unreliability.

---

# Enter Paxos

Probably the most widely known consensus algorithm is **Paxos**, first introduced by Leslie Lamport in [*"The Part-Time Parliament"*](https://lamport.azurewebsites.net/pubs/lamport-paxos.pdf) (1989, published 1998).

In 2001, Lamport released [*"Paxos Made Simple"*](https://lamport.azurewebsites.net/pubs/paxos-simple.pdf), introducing cleaner terminology now universally used to explain the algorithm.

> *"The Paxos algorithm for implementing a fault-tolerant distributed service was presented in ["The Part-Time Parliament"]. Although given as a concise description of an algorithm, it is probably the most important result in the theory of distributed systems."*
> — Butler Lampson

---

# Paxos Roles

Participants in Paxos can take one of three roles:

* **Proposers** — Receive values from clients, create proposals, and attempt to collect votes from acceptors.
* **Acceptors** — Vote to accept or reject proposed values. Fault tolerance requires multiple acceptors; liveness only requires a **quorum (majority)**.
* **Learners** — Replicas that store the outcome of accepted proposals.

Any participant can take any role. Most real implementations **colocate** all three: a single process is simultaneously proposer, acceptor, and learner.

---

# Proposals

Every proposal consists of:

1. **A value** — proposed by the client.
2. **A unique, monotonically increasing proposal number** — used to establish a total order among proposals and determine happened-before/after relationships.

The proposal number is the core mechanism Paxos uses to prevent stale, conflicting proposals from overriding newer ones.

---

# The Two Phases of Paxos

The Paxos algorithm splits cleanly into two phases:

| Phase | Purpose |
|---|---|
| **Phase 1 — Prepare (Voting)** | Proposers compete to establish leadership |
| **Phase 2 — Accept (Replication)** | The winning proposer distributes the value |

During the **Prepare** phase, a proposer broadcasts a ballot number and collects *promises* from a majority of acceptors.

During the **Accept** phase, the proposer commits the value by sending it to acceptors, who notify learners.

---

# Phase 1 — Prepare

The proposer sends `PREPARE(N)` to a majority of acceptors.

When an acceptor receives a `PREPARE(N)`, it responds based on its current state:

| Message from Proposer | Acceptor State | Response | New Acceptor State |
|---|---|---|---|
| `PREPARE N` | not prepared | promise to accept N | prepared for N |
| `PREPARE N` | prepared for M < N | promise to accept N | prepared for N |
| `PREPARE N` | prepared for M > N | reject: promise to accept M | unchanged |
| `PREPARE N` | accepted M, value v | notify: M accepted with value v | unchanged |

> **Key insight**: the proposer picks as `v` the value with the highest-numbered promise received — or its own value if no acceptor has accepted anything yet.

---

# Phase 1 — Prepare Timeline

```static-timeline
{
  "zoom": 0.85,
  "ticks": 60,
  "trackHeight": 50,
  "stateBandOffset": 10,
  "servers": ["Proposer", "Acceptor-1", "Acceptor-2", "Acceptor-3"],
  "states": [
    { "server": "Proposer",   "start": 0,  "end": 9,  "state": "idle",            "color": "#b0bec5" },
    { "server": "Proposer",   "start": 10, "end": 30, "state": "PREPARE(N=5)",    "color": "#ffb74d" },
    { "server": "Proposer",   "start": 31, "end": 60, "state": "quorum reached",  "color": "#81c784" },
    { "server": "Acceptor-1", "start": 0,  "end": 15, "state": "not prepared",    "color": "#b0bec5" },
    { "server": "Acceptor-1", "start": 16, "end": 60, "state": "promised N=5",    "color": "#4fc3f7" },
    { "server": "Acceptor-2", "start": 0,  "end": 17, "state": "not prepared",    "color": "#b0bec5" },
    { "server": "Acceptor-2", "start": 18, "end": 60, "state": "promised N=5",    "color": "#4fc3f7" },
    { "server": "Acceptor-3", "start": 0,  "end": 19, "state": "not prepared",    "color": "#b0bec5" },
    { "server": "Acceptor-3", "start": 20, "end": 60, "state": "promised N=5",    "color": "#4fc3f7" }
  ],
  "messages": [
    { "from": "Proposer",   "to": "Acceptor-1", "sendTick": 10, "recvTick": 15, "label": "PREPARE(5)" },
    { "from": "Proposer",   "to": "Acceptor-2", "sendTick": 10, "recvTick": 17 },
    { "from": "Proposer",   "to": "Acceptor-3", "sendTick": 10, "recvTick": 19 },
    { "from": "Acceptor-1", "to": "Proposer",   "sendTick": 16, "recvTick": 23, "label": "PROMISE(5)" },
    { "from": "Acceptor-2", "to": "Proposer",   "sendTick": 18, "recvTick": 26 },
    { "from": "Acceptor-3", "to": "Proposer",   "sendTick": 20, "recvTick": 30 }
  ]
}
```

Once the proposer collects **PROMISE** from a majority, it may proceed to Phase 2.

---

# Phase 2 — Accept

After collecting a quorum of promises, the proposer sends `ACCEPT(N, v)` to acceptors.

* `v` is the value with the highest accepted ballot among the PROMISE responses, **or** the proposer's own value if no acceptor had previously accepted anything.

When an acceptor receives `ACCEPT(N, v)`:

| Message | Acceptor State | Response | New State |
|---|---|---|---|
| `ACCEPT N, v` | prepared/accepted M ≤ N | notify proposer and learners | accepted N, value v |
| `ACCEPT N, v` | prepared/accepted M > N | **ignore** (already promised higher) | unchanged |

An acceptor can respond to more than one `PREPARE` as long as each later one has a higher sequence number.

---

# Phase 2 — Accept Timeline

```static-timeline
{
  "zoom": 0.85,
  "ticks": 65,
  "trackHeight": 50,
  "stateBandOffset": 10,
  "servers": ["Proposer", "Acceptor-1", "Acceptor-2", "Acceptor-3", "Learner"],
  "states": [
    { "server": "Proposer",   "start": 0,  "end": 9,  "state": "has quorum",     "color": "#81c784" },
    { "server": "Proposer",   "start": 10, "end": 30, "state": "ACCEPT(5,'X')",  "color": "#ffb74d" },
    { "server": "Proposer",   "start": 31, "end": 65, "state": "decided 'X'",    "color": "#4caf50" },
    { "server": "Acceptor-1", "start": 0,  "end": 14, "state": "promised N=5",   "color": "#4fc3f7" },
    { "server": "Acceptor-1", "start": 15, "end": 65, "state": "accepted 'X'",   "color": "#81c784" },
    { "server": "Acceptor-2", "start": 0,  "end": 16, "state": "promised N=5",   "color": "#4fc3f7" },
    { "server": "Acceptor-2", "start": 17, "end": 65, "state": "accepted 'X'",   "color": "#81c784" },
    { "server": "Acceptor-3", "start": 0,  "end": 18, "state": "promised N=5",   "color": "#4fc3f7" },
    { "server": "Acceptor-3", "start": 19, "end": 65, "state": "accepted 'X'",   "color": "#81c784" },
    { "server": "Learner",    "start": 0,  "end": 32, "state": "waiting",        "color": "#b0bec5" },
    { "server": "Learner",    "start": 33, "end": 65, "state": "learned 'X'",    "color": "#4caf50" }
  ],
  "messages": [
    { "from": "Proposer",   "to": "Acceptor-1", "sendTick": 10, "recvTick": 15, "label": "ACCEPT(5,'X')" },
    { "from": "Proposer",   "to": "Acceptor-2", "sendTick": 10, "recvTick": 17 },
    { "from": "Proposer",   "to": "Acceptor-3", "sendTick": 10, "recvTick": 19 },
    { "from": "Acceptor-1", "to": "Proposer",   "sendTick": 16, "recvTick": 22, "label": "ACCEPTED" },
    { "from": "Acceptor-2", "to": "Proposer",   "sendTick": 18, "recvTick": 24 },
    { "from": "Acceptor-1", "to": "Learner",    "sendTick": 16, "recvTick": 23 },
    { "from": "Acceptor-2", "to": "Learner",    "sendTick": 18, "recvTick": 27 },
    { "from": "Acceptor-3", "to": "Learner",    "sendTick": 20, "recvTick": 32 }
  ]
}
```

Once a quorum of `ACCEPTED` responses arrive, **consensus is reached**. The decided value is broadcast to learners.

---

# The Classic Paxos Demo

This simulation demonstrates the complete Paxos flow — **two proposers start simultaneously** with different values. Their ballots collide, one gets NACKed and re-bids with a higher ballot, until eventually one wins the election and commits.

<div class="callout-box">
    <h4>What to watch</h4>
    <p>Observe the FSM states flipping: <b>idle → preparing → accepting → decided</b>. Watch Node-0 (ballot 1, value "A") and Node-1 (ballot 2, value "B") collide. Node-0 receives a NACK and bumps its ballot to outbid Node-1 — but Node-1 has already gathered promises, so Node-0's higher ballot forces Node-1 to restart. Eventually the higher ballot wins and broadcasts DECIDED to all.</p>
</div>

<div style="text-align: center; margin-top: 40px; margin-bottom: 40px;">
    <button class="demo-btn" onclick="showDemo('demos/paxos/demo.json')" style="font-size: 1.5rem; padding: 15px 30px; background: #2196f3; color: white; border: none; border-radius: 6px; cursor: pointer;">
        Launch Classic Paxos Demo
    </button>
</div>

---

# Quorums in Paxos

A **quorum** is the minimum number of votes required to proceed. In Paxos, a quorum is a **majority** of acceptors.

**Why majority?** Any two majorities of a set of `N` nodes always share at least one common node. That shared node acts as the *arbiter* — it cannot promise conflicting things to two different proposers simultaneously.

> *This is the **pigeonhole principle** applied to distributed consensus.*

---

# Quorum: Safety and Liveness

| Goal | Requirement |
|---|---|
| **Safety** | Wait for responses from at least a quorum before proceeding |
| **Liveness** | Proceed as soon as a quorum responds — don't wait for stragglers |

To tolerate **f** failed processes, the protocol requires **2f + 1** total acceptors:
* f can fail, and f + 1 survivors still form a majority.
* We can submit proposals to *more* nodes than needed — we just don't wait for all of them.

---

# Quorum Intersection Illustrated

```static-timeline
{
  "zoom": 0.85,
  "ticks": 65,
  "trackHeight": 44,
  "stateBandOffset": 10,
  "servers": ["Proposer-A", "Proposer-B", "Node-1", "Node-2", "Node-3", "Node-4", "Node-5"],
  "states": [
    { "server": "Proposer-A", "start": 5,  "end": 35, "state": "quorum: N1,N2,N3",  "color": "#4fc3f7" },
    { "server": "Proposer-B", "start": 5,  "end": 35, "state": "quorum: N3,N4,N5",  "color": "#ffb74d" },
    { "server": "Node-1",     "start": 0,  "end": 65, "state": "in A's quorum",      "color": "#4fc3f7" },
    { "server": "Node-2",     "start": 0,  "end": 65, "state": "in A's quorum",      "color": "#4fc3f7" },
    { "server": "Node-3",     "start": 0,  "end": 65, "state": "overlap — arbiter",  "color": "#ab47bc" },
    { "server": "Node-4",     "start": 0,  "end": 65, "state": "in B's quorum",      "color": "#ffb74d" },
    { "server": "Node-5",     "start": 0,  "end": 65, "state": "in B's quorum",      "color": "#ffb74d" }
  ]
}
```

Node-3 cannot simultaneously promise two different proposers — this guarantees that at most one value can ever be decided.

---

# Failure Scenarios

Paxos is designed to survive various failure patterns. Let's trace the most important ones.

---

# Failure: Proposer Fails in Phase 1

If the proposer crashes before it collects a quorum of PROMISE responses, nothing has been decided yet.

**Resolution**: Simply ignored. A new proposer will start a fresh Paxos round with a higher ballot number. The failed round leaves no trace.

```static-timeline
{
  "zoom": 0.85,
  "ticks": 70,
  "trackHeight": 50,
  "stateBandOffset": 10,
  "servers": ["Proposer-1", "Proposer-2", "Acceptor-1", "Acceptor-2", "Acceptor-3"],
  "states": [
    { "server": "Proposer-1", "start": 0,  "end": 15, "state": "PREPARE(1,'X')", "color": "#ffb74d" },
    { "server": "Proposer-1", "start": 16, "end": 30, "state": "CRASHED",         "color": "#ef5350" },
    { "server": "Proposer-2", "start": 30, "end": 45, "state": "PREPARE(2,'Y')", "color": "#81c784" },
    { "server": "Proposer-2", "start": 46, "end": 70, "state": "commit 'Y'",      "color": "#4caf50" },
    { "server": "Acceptor-1", "start": 0,  "end": 70, "state": "waiting",         "color": "#b0bec5" },
    { "server": "Acceptor-2", "start": 0,  "end": 70, "state": "waiting",         "color": "#b0bec5" },
    { "server": "Acceptor-3", "start": 0,  "end": 70, "state": "waiting",         "color": "#b0bec5" }
  ],
  "messages": [
    { "from": "Proposer-1", "to": "Acceptor-1", "sendTick": 5,  "recvTick": 10 },
    { "from": "Proposer-2", "to": "Acceptor-1", "sendTick": 32, "recvTick": 37, "label": "PREPARE(2)" },
    { "from": "Proposer-2", "to": "Acceptor-2", "sendTick": 32, "recvTick": 38 },
    { "from": "Proposer-2", "to": "Acceptor-3", "sendTick": 32, "recvTick": 39 },
    { "from": "Acceptor-1", "to": "Proposer-2", "sendTick": 38, "recvTick": 43, "label": "PROMISE(2)" },
    { "from": "Acceptor-2", "to": "Proposer-2", "sendTick": 39, "recvTick": 44 },
    { "from": "Acceptor-3", "to": "Proposer-2", "sendTick": 40, "recvTick": 45 }
  ]
}
```

---

# Failure: Proposer Fails in Phase 2 — Value Adopted

The proposer committed value `'X'` to Acceptor-1, then crashed before reaching the others. A new proposer sees that `'X'` was already accepted by Acceptor-1 and **must adopt it**.

```static-timeline
{
  "zoom": 0.85,
  "ticks": 80,
  "trackHeight": 44,
  "stateBandOffset": 10,
  "servers": ["Proposer-1", "Proposer-2", "Acceptor-1", "Acceptor-2", "Acceptor-3"],
  "states": [
    { "server": "Proposer-1", "start": 0,  "end": 20, "state": "commit 'X', id=1",  "color": "#ffb74d" },
    { "server": "Proposer-1", "start": 21, "end": 40, "state": "CRASHED",            "color": "#ef5350" },
    { "server": "Proposer-2", "start": 40, "end": 55, "state": "PREPARE(2,'Y')",     "color": "#81c784" },
    { "server": "Proposer-2", "start": 56, "end": 70, "state": "commit 'X' (id=2)", "color": "#4caf50" },
    { "server": "Acceptor-1", "start": 0,  "end": 18, "state": "accept 1",           "color": "#b0bec5" },
    { "server": "Acceptor-1", "start": 19, "end": 80, "state": "accepted 'X', id=1","color": "#4fc3f7" },
    { "server": "Acceptor-2", "start": 0,  "end": 80, "state": "accept 1",           "color": "#b0bec5" },
    { "server": "Acceptor-3", "start": 0,  "end": 80, "state": "accept 1",           "color": "#b0bec5" }
  ],
  "messages": [
    { "from": "Proposer-1", "to": "Acceptor-1", "sendTick": 10, "recvTick": 18, "label": "ACCEPT(1,'X')" },
    { "from": "Proposer-2", "to": "Acceptor-1", "sendTick": 42, "recvTick": 48, "label": "PREPARE(2)" },
    { "from": "Proposer-2", "to": "Acceptor-2", "sendTick": 42, "recvTick": 49 },
    { "from": "Acceptor-1", "to": "Proposer-2", "sendTick": 49, "recvTick": 55, "label": "PROMISE: 'X' seen!" },
    { "from": "Acceptor-2", "to": "Proposer-2", "sendTick": 50, "recvTick": 55 },
    { "from": "Proposer-2", "to": "Acceptor-1", "sendTick": 56, "recvTick": 62, "label": "ACCEPT(2,'X')" },
    { "from": "Proposer-2", "to": "Acceptor-2", "sendTick": 56, "recvTick": 63 },
    { "from": "Proposer-2", "to": "Acceptor-3", "sendTick": 56, "recvTick": 64 }
  ]
}
```

> **Note**: all of this can happen without the original proposer knowing. If the client is connected only to Proposer-1, it may never learn the result of the Paxos round.

<div class="callout-box">
    <h4>What to watch</h4>
    <p>In this demo, Proposer-1 crashes right after sending an ACCEPT to Acceptor-1. Watch Proposer-2 wake up, discover the partially-committed value during its PREPARE phase, and safely adopt it rather than overwriting it.</p>
</div>

<div style="text-align: center; margin-top: 40px; margin-bottom: 40px;">
    <button class="demo-btn" onclick="showDemo('demos/paxos-recovery/demo.json')" style="font-size: 1.5rem; padding: 15px 30px; background: #e53935; color: white; border: none; border-radius: 6px; cursor: pointer;">
        Launch Recovery Demo
    </button>
</div>

---

# Failure: Dueling Proposers (Livelock)

Two proposers repeatedly outbid each other, preventing either from completing. Neither can collect a majority before the other bumps the ballot.

```static-timeline
{
  "zoom": 0.85,
  "ticks": 90,
  "trackHeight": 44,
  "stateBandOffset": 10,
  "servers": ["Proposer-1", "Proposer-2", "Acceptor-1", "Acceptor-2", "Acceptor-3"],
  "states": [
    { "server": "Proposer-1", "start": 0,  "end": 14, "state": "PREPARE(1,'X')",  "color": "#4fc3f7" },
    { "server": "Proposer-1", "start": 25, "end": 39, "state": "PREPARE(3,'X')",  "color": "#4fc3f7" },
    { "server": "Proposer-1", "start": 50, "end": 64, "state": "PREPARE(5,'X')",  "color": "#4fc3f7" },
    { "server": "Proposer-2", "start": 10, "end": 24, "state": "PREPARE(2,'Y')",  "color": "#ffb74d" },
    { "server": "Proposer-2", "start": 35, "end": 49, "state": "PREPARE(4,'Y')",  "color": "#ffb74d" },
    { "server": "Proposer-2", "start": 60, "end": 74, "state": "PREPARE(6,'Y')",  "color": "#ffb74d" },
    { "server": "Acceptor-1", "start": 0,  "end": 90, "state": "never settles",   "color": "#b0bec5" },
    { "server": "Acceptor-2", "start": 0,  "end": 90, "state": "never settles",   "color": "#b0bec5" },
    { "server": "Acceptor-3", "start": 0,  "end": 90, "state": "never settles",   "color": "#b0bec5" }
  ]
}
```

**Resolution**: **Random exponential backoff** — the proposer that lost the ballot waits a random amount of time before retrying, giving the other time to complete.

<div class="callout-box">
    <h4>What to watch</h4>
    <p>Watch two proposers intentionally collide. When they receive a NACK, they enter a randomized backoff state before retrying. One will eventually out-wait the other and secure the quorum!</p>
</div>

<div style="text-align: center; margin-top: 40px; margin-bottom: 40px;">
    <button class="demo-btn" onclick="showDemo('demos/paxos-livelock/demo.json')" style="font-size: 1.5rem; padding: 15px 30px; background: #fb8c00; color: white; border: none; border-radius: 6px; cursor: pointer;">
        Launch Livelock Backoff Demo
    </button>
</div>

---

# Multi-Paxos

**Single-decree Paxos** is a write-once register: once a value is decided, no modification is possible.

**Multi-Paxos** is an append-only log of such registers — each slot holds one consensus round.

| Variant | Analogy |
|---|---|
| Single-decree Paxos | A write-once register |
| Multi-Paxos | An append-only log of registers |

Running a full two-phase Paxos for every log entry is expensive. Multi-Paxos introduces an optimization: **skip the Prepare phase** once a distinguished leader is established.

---

# Multi-Paxos: Why the Prepare Phase?

The Prepare phase exists to **establish an arbitrary proposer** for the round. Once a majority of acceptors have promised, only that proposer can commit.

**The problem**: requiring a fresh Prepare for every replication round wastes two round-trips per entry.

**The optimization**: once a stable **distinguished proposer** (leader) is established, acceptors already know who the leader is — they don't need to be asked again. The leader can skip straight to `ACCEPT`.

---

# Multi-Paxos: Leader and Leases

Some Multi-Paxos implementations use **leases**:

1. The leader periodically contacts participants, effectively **prolonging its lease**.
2. Participants promise not to accept proposals from other leaders for the lease period.
3. The leader can then commit values with a **single round-trip**.

> ⚠️ **Leases are a performance optimization, not a correctness guarantee.** They rely on **bounded clock synchrony** between participants. If clocks drift too far, linearizability cannot be guaranteed.

---

# Multi-Paxos Timeline

```static-timeline
{
  "zoom": 0.85,
  "ticks": 100,
  "trackHeight": 44,
  "stateBandOffset": 10,
  "servers": ["Leader", "Acceptor-1", "Acceptor-2", "Acceptor-3"],
  "states": [
    { "server": "Leader",     "start": 0,  "end": 9,  "state": "idle",             "color": "#b0bec5" },
    { "server": "Leader",     "start": 10, "end": 28, "state": "PREPARE (round 1)","color": "#ffb74d" },
    { "server": "Leader",     "start": 29, "end": 49, "state": "ACCEPT cmd_1",     "color": "#4fc3f7" },
    { "server": "Leader",     "start": 50, "end": 69, "state": "ACCEPT cmd_2 ✂️",  "color": "#4fc3f7" },
    { "server": "Leader",     "start": 70, "end": 89, "state": "ACCEPT cmd_3 ✂️",  "color": "#4fc3f7" },
    { "server": "Leader",     "start": 90, "end": 100,"state": "decided",          "color": "#81c784" },
    { "server": "Acceptor-1", "start": 0,  "end": 14, "state": "ready",            "color": "#b0bec5" },
    { "server": "Acceptor-1", "start": 15, "end": 28, "state": "promised",         "color": "#ce93d8" },
    { "server": "Acceptor-1", "start": 29, "end": 100,"state": "accepting",        "color": "#81c784" },
    { "server": "Acceptor-2", "start": 0,  "end": 16, "state": "ready",            "color": "#b0bec5" },
    { "server": "Acceptor-2", "start": 17, "end": 28, "state": "promised",         "color": "#ce93d8" },
    { "server": "Acceptor-2", "start": 29, "end": 100,"state": "accepting",        "color": "#81c784" },
    { "server": "Acceptor-3", "start": 0,  "end": 18, "state": "ready",            "color": "#b0bec5" },
    { "server": "Acceptor-3", "start": 19, "end": 28, "state": "promised",         "color": "#ce93d8" },
    { "server": "Acceptor-3", "start": 29, "end": 100,"state": "accepting",        "color": "#81c784" }
  ],
  "messages": [
    { "from": "Leader",     "to": "Acceptor-1", "sendTick": 10, "recvTick": 15, "label": "PREPARE" },
    { "from": "Leader",     "to": "Acceptor-2", "sendTick": 10, "recvTick": 17 },
    { "from": "Leader",     "to": "Acceptor-3", "sendTick": 10, "recvTick": 19 },
    { "from": "Acceptor-1", "to": "Leader",     "sendTick": 16, "recvTick": 22, "label": "PROMISE" },
    { "from": "Acceptor-2", "to": "Leader",     "sendTick": 18, "recvTick": 26 },
    { "from": "Acceptor-3", "to": "Leader",     "sendTick": 20, "recvTick": 28 },
    { "from": "Leader",     "to": "Acceptor-1", "sendTick": 30, "recvTick": 35, "label": "ACCEPT cmd_1" },
    { "from": "Leader",     "to": "Acceptor-1", "sendTick": 51, "recvTick": 56, "label": "ACCEPT cmd_2 ✂️" },
    { "from": "Leader",     "to": "Acceptor-1", "sendTick": 71, "recvTick": 76, "label": "ACCEPT cmd_3 ✂️" }
  ]
}
```

✂️ indicates rounds where the Prepare phase was **skipped** entirely.

---

# Multi-Paxos Demo

This simulation shows the optimization in action. The first round is a full Paxos (Prepare → Promise → Accept → Accepted → Decided). Subsequent rounds **skip the Prepare phase** — the leader sends ACCEPT directly, cutting latency in half.

<div class="callout-box">
    <h4>What to watch</h4>
    <p>Compare the number of message round-trips in round 1 vs. rounds 2 and 3. Round 1 has <b>two</b> round-trips (Prepare → Accept). Rounds 2 and 3 have <b>one</b> round-trip each (Accept only). The FSM shows the leader staying in `leader` state after the first win, transitioning back to `accepting` for each subsequent commit without going through `preparing`.</p>
</div>

<div style="text-align: center; margin-top: 40px; margin-bottom: 40px;">
    <button class="demo-btn" onclick="showDemo('demos/multi-paxos/demo.json')" style="font-size: 1.5rem; padding: 15px 30px; background: #7b1fa2; color: white; border: none; border-radius: 6px; cursor: pointer;">
        Launch Multi-Paxos Demo
    </button>
</div>

---

# Fast Paxos

Classic Paxos uses two round-trips: Prepare → Accept. **Fast Paxos** reduces this to **one round-trip in the common case** by letting proposers contact acceptors directly.

Two types of rounds exist:
* **Classic round** — same as standard Paxos (used for recovery).
* **Fast round** — proposer skips the Prepare phase entirely; acceptors accept values directly.

> **Collision risk**: if two proposers both attempt a fast round and send different values, acceptors receive conflicting values. The system must detect this and fall back to a classic recovery round.

---

# Fast Paxos Timeline

```static-timeline
{
  "zoom": 0.85,
  "ticks": 70,
  "trackHeight": 48,
  "stateBandOffset": 10,
  "servers": ["Coordinator", "Proposer-1", "Acceptor-1", "Acceptor-2", "Acceptor-3"],
  "states": [
    { "server": "Coordinator",  "start": 0,  "end": 15, "state": "accept any (fast)",  "color": "#81c784" },
    { "server": "Coordinator",  "start": 16, "end": 70, "state": "waiting for result", "color": "#4fc3f7" },
    { "server": "Proposer-1",   "start": 0,  "end": 14, "state": "idle",               "color": "#b0bec5" },
    { "server": "Proposer-1",   "start": 15, "end": 30, "state": "commit 'Y' direct",  "color": "#ffb74d" },
    { "server": "Proposer-1",   "start": 31, "end": 70, "state": "decided",            "color": "#4caf50" },
    { "server": "Acceptor-1",   "start": 0,  "end": 14, "state": "ready for any",      "color": "#b0bec5" },
    { "server": "Acceptor-1",   "start": 15, "end": 70, "state": "accepted 'Y'",       "color": "#81c784" },
    { "server": "Acceptor-2",   "start": 0,  "end": 16, "state": "ready for any",      "color": "#b0bec5" },
    { "server": "Acceptor-2",   "start": 17, "end": 70, "state": "accepted 'Y'",       "color": "#81c784" },
    { "server": "Acceptor-3",   "start": 0,  "end": 18, "state": "ready for any",      "color": "#b0bec5" },
    { "server": "Acceptor-3",   "start": 19, "end": 70, "state": "accepted 'Y'",       "color": "#81c784" }
  ],
  "messages": [
    { "from": "Coordinator", "to": "Acceptor-1", "sendTick": 5,  "recvTick": 10, "label": "accept any" },
    { "from": "Coordinator", "to": "Acceptor-2", "sendTick": 5,  "recvTick": 11 },
    { "from": "Coordinator", "to": "Acceptor-3", "sendTick": 5,  "recvTick": 12 },
    { "from": "Proposer-1",  "to": "Acceptor-1", "sendTick": 15, "recvTick": 20, "label": "ACCEPT 'Y'" },
    { "from": "Proposer-1",  "to": "Acceptor-2", "sendTick": 15, "recvTick": 22 },
    { "from": "Proposer-1",  "to": "Acceptor-3", "sendTick": 15, "recvTick": 24 },
    { "from": "Acceptor-1",  "to": "Coordinator","sendTick": 21, "recvTick": 28, "label": "ACCEPTED 'Y'" },
    { "from": "Acceptor-2",  "to": "Coordinator","sendTick": 23, "recvTick": 30 },
    { "from": "Acceptor-3",  "to": "Coordinator","sendTick": 25, "recvTick": 32 }
  ]
}
```

> **Quorum increase required**: to survive collisions, Fast Paxos needs **3f + 1** total acceptors (vs. **2f + 1** in classic) and a fast quorum of **2f + 1** (vs. **f + 1**).

<div class="callout-box">
    <h4>What to watch</h4>
    <p>Watch the Coordinator open a fast round, and two proposers bypass it to send conflicting ACCEPT messages simultaneously. The Coordinator detects the collision from the split votes and successfully falls back to a Classic Paxos round to resolve it.</p>
</div>

<div style="text-align: center; margin-top: 40px; margin-bottom: 40px;">
    <button class="demo-btn" onclick="showDemo('demos/fast-paxos/demo.json')" style="font-size: 1.5rem; padding: 15px 30px; background: #43a047; color: white; border: none; border-radius: 6px; cursor: pointer;">
        Launch Fast Paxos Demo
    </button>
</div>

---

# Egalitarian Paxos (EPaxos)

Classic Paxos and Multi-Paxos rely on a **single leader** — a bottleneck and point of failure.

**EPaxos** (Egalitarian Paxos) allows **any replica to act as leader** for its own proposals. Order is established not by voting sequence, but by tracking **dependencies**: two commands that potentially conflict must be ordered relative to each other via a dependency graph.

Each proposal includes:
* **A dependency set** — all potentially interfering commands not yet committed.
* **A sequence number** — breaks cycles in the dependency graph.

---

# EPaxos Paths

EPaxos has two execution paths:

| Path | When | Round-trips |
|---|---|---|
| **Fast path** | All replicas agree on dependencies | 1 |
| **Slow path** | Dependency conflict detected | 2 |

Commands are executed **after all their dependencies** (and their dependencies' dependencies) are committed and executed. Non-conflicting commands can execute in parallel.

> *The key insight: sharing data between acceptors isn't the problem — the problem is applying operations in a consistent order without corrupting local storage.*

---

# EPaxos Timeline

```static-timeline
{
  "zoom": 0.85,
  "ticks": 85,
  "trackHeight": 44,
  "stateBandOffset": 10,
  "servers": ["Leader-1 (cmd X)", "Leader-2 (cmd Y)", "Replica-1", "Replica-2", "Replica-3"],
  "states": [
    { "server": "Leader-1 (cmd X)", "start": 0,  "end": 18, "state": "pre-accept(X,{})",   "color": "#4fc3f7" },
    { "server": "Leader-1 (cmd X)", "start": 19, "end": 40, "state": "commit X",            "color": "#4caf50" },
    { "server": "Leader-2 (cmd Y)", "start": 20, "end": 38, "state": "pre-accept(Y,{})",   "color": "#ffb74d" },
    { "server": "Leader-2 (cmd Y)", "start": 39, "end": 55, "state": "slow path: dep={X}", "color": "#ef5350" },
    { "server": "Leader-2 (cmd Y)", "start": 56, "end": 85, "state": "commit Y after X",   "color": "#4caf50" },
    { "server": "Replica-1",        "start": 0,  "end": 85, "state": "log: [X, Y]",        "color": "#b0bec5" },
    { "server": "Replica-2",        "start": 0,  "end": 85, "state": "log: [X, Y]",        "color": "#b0bec5" },
    { "server": "Replica-3",        "start": 0,  "end": 85, "state": "log: [X, Y]",        "color": "#b0bec5" }
  ],
  "messages": [
    { "from": "Leader-1 (cmd X)", "to": "Replica-1",        "sendTick": 5,  "recvTick": 10, "label": "pre-accept X" },
    { "from": "Leader-1 (cmd X)", "to": "Replica-2",        "sendTick": 5,  "recvTick": 11 },
    { "from": "Replica-1",        "to": "Leader-1 (cmd X)", "sendTick": 11, "recvTick": 17, "label": "ok, no deps" },
    { "from": "Replica-2",        "to": "Leader-1 (cmd X)", "sendTick": 12, "recvTick": 18 },
    { "from": "Leader-2 (cmd Y)", "to": "Replica-2",        "sendTick": 22, "recvTick": 28, "label": "pre-accept Y" },
    { "from": "Leader-2 (cmd Y)", "to": "Replica-3",        "sendTick": 22, "recvTick": 29 },
    { "from": "Replica-2",        "to": "Leader-2 (cmd Y)", "sendTick": 29, "recvTick": 35, "label": "dep={X} conflict!" },
    { "from": "Replica-3",        "to": "Leader-2 (cmd Y)", "sendTick": 30, "recvTick": 38 }
  ]
}
```

<div class="callout-box">
    <h4>What to watch</h4>
    <p>Watch two leaders propose conflicting commands (set_x and inc_x) simultaneously. Leader-1 commits immediately via the Fast Path, while Leader-2's replicas detect the conflict, forcing Leader-2 into the Slow Path to merge dependencies. Both execute sequentially in correct dependency order.</p>
</div>

<div style="text-align: center; margin-top: 40px; margin-bottom: 40px;">
    <button class="demo-btn" onclick="showDemo('demos/epaxos/demo.json')" style="font-size: 1.5rem; padding: 15px 30px; background: #8e24aa; color: white; border: none; border-radius: 6px; cursor: pointer;">
        Launch EPaxos Demo
    </button>
</div>

---

# Flexible Paxos

Classic Paxos defines quorums as strict majorities. **Flexible Paxos** relaxes this constraint.

**Key observation**: We only require that the **Phase 1 quorum** (election) and **Phase 2 quorum** (acceptance) **intersect** — not that either be a majority.

If the total number of participants is `N`, Phase 1 quorum size is `P`, and Phase 2 quorum size is `A`, we only need:

$$A + P > N$$

Since Phase 2 (replication) runs far more often than Phase 1 (leader election), we can make `A` much smaller than `P`.

---

# Flexible Paxos: The Trade-off

| Configuration (`N=5`) | Phase 1 (P) | Phase 2 (A) | Benefit |
|---|---|---|---|
| Classic majority | 3 | 3 | Balanced |
| Flexible (latency-optimized) | 4 | 2 | Faster writes |
| Flexible (election-heavy) | 5 | 1 | Single-node accepts |

```static-timeline
{
  "zoom": 0.85,
  "ticks": 70,
  "trackHeight": 44,
  "stateBandOffset": 10,
  "servers": ["Phase-1 (P=4)", "Phase-2 (A=2)", "Node-1", "Node-2", "Node-3", "Node-4", "Node-5"],
  "states": [
    { "server": "Phase-1 (P=4)","start": 5,  "end": 30, "state": "contacts N1,N2,N3,N4",  "color": "#4fc3f7" },
    { "server": "Phase-2 (A=2)","start": 35, "end": 60, "state": "contacts N1,N2 only",   "color": "#ffb74d" },
    { "server": "Node-1", "start": 0,  "end": 70, "state": "elected + accepted", "color": "#81c784" },
    { "server": "Node-2", "start": 0,  "end": 70, "state": "elected + accepted", "color": "#81c784" },
    { "server": "Node-3", "start": 0,  "end": 33, "state": "elected",            "color": "#4fc3f7" },
    { "server": "Node-3", "start": 34, "end": 70, "state": "idle (not covered)", "color": "#b0bec5" },
    { "server": "Node-4", "start": 0,  "end": 33, "state": "elected",            "color": "#4fc3f7" },
    { "server": "Node-4", "start": 34, "end": 70, "state": "idle (not covered)", "color": "#b0bec5" },
    { "server": "Node-5", "start": 0,  "end": 70, "state": "idle (not covered)", "color": "#b0bec5" }
  ]
}
```

> *Nodes 1 and 2 are the intersection — they participated in both phases, ensuring a new leader in Phase 1 will always overlap with at least one node that saw the committed value.*

**Vertical Paxos** applies the same idea to read/write quorums: read quorums and write quorums must intersect, allowing smaller write quorums.

---

# Generalized Solution to Consensus

A more recent reformulation simplifies Paxos to a few core concepts, removing the distinction between roles and rounds. See: [*"A Generalized Solution to Consensus"*](https://arxiv.org/pdf/1902.06776.pdf).

**Model**:
* A **client** and a set of **servers**, each with multiple **registers**.
* Each register has an index, is **write-once**, and can be:
  * Unwritten
  * Containing a value
  * Containing **nil** (explicitly empty)

**Register sets**: registers with the same index across servers form a **register set**. Each has one or more quorums, each in one of four states:

| State | Meaning |
|---|---|
| **Any** | Can still decide on any value |
| **Maybe v** | If decided, must be v |
| **None** | Cannot decide any value |
| **Decided v** | Has decided on v |

---

# Generalized Algorithm Phases

**Phase 1 — P1A**

1. Client sends `P1A(register)` to all servers.
2. If the register is unwritten, the server sets all lower registers to **nil** (preventing writes to previous slots) and responds with its known register set.
3. If a majority responds, the client picks the nonempty value with the largest index — or its own value if all registers are unwritten.
4. Otherwise, restart Phase 1.

**Phase 2 — P2A**

1. Client broadcasts `P2A(register, value)` to all servers.
2. If a majority responds, the decision is output.
3. Otherwise, restart from Phase 1.

> *This generalizes single-decree Paxos: the ballot number maps to the register index, and the promise/accept mechanism maps to the nil/value write rules.*

---

# Paxos in Practice

Paxos is more of a **family of algorithms** than a single protocol. Production systems typically use Paxos as a *foundation layer* rather than implementing the textbook version:

| System | Paxos Variant Used |
|---|---|
| **Google Spanner** | Multi-Paxos per shard; 2PC across shards |
| **Google Chubby** | Multi-Paxos for lock service |
| **Apache Zookeeper** | ZAB (Zookeeper Atomic Broadcast — Paxos-like) |
| **etcd / Kubernetes** | Raft (simplified Multi-Paxos) |
| **CockroachDB** | Multi-Raft (Raft groups per range) |

> *Most systems that claim to use "Paxos" actually implement a Paxos **variant** optimized for their specific workload and deployment topology.*

---

# Paxos vs. Raft

[**Raft**](https://raft.github.io/) was designed explicitly to be a more **understandable** alternative to Paxos. Both achieve Multi-Paxos semantics, but differ in design philosophy:

| Property | Paxos (Multi) | Raft |
|---|---|---|
| Leader election | Ballot-based, any node | Term-based, log-completeness check |
| Log replication | Proposer-driven | Leader strictly append-only |
| Membership changes | Ad-hoc per implementation | Joint-consensus protocol |
| Understandability | Complex (many papers needed) | Single, complete paper |
| Performance | Comparable | Comparable |

> *Raft is Paxos made explicit: it trades some flexibility for clarity and a reference implementation.*

---

# Durability and Log Compaction

To survive crashes, participants keep a **durable log** of all received messages.

Over time, logs grow indefinitely. To prevent this:
1. The log is periodically synchronized with a **primary structure**, creating a **snapshot**.
2. After a consistent snapshot is taken, the corresponding log segment can be **truncated**.

> Log and snapshot **must be mutually consistent** — snapshot changes must be applied atomically with log truncation.

---

# Lecture Summary

Paxos is the cornerstone of modern distributed consensus:

| Concept | Key Insight |
|---|---|
| **Roles** | Proposers, Acceptors, Learners — often colocated |
| **Phase 1 (Prepare)** | Establish a unique ballot; collect promises |
| **Phase 2 (Accept)** | Distribute the value; collect confirmations |
| **Quorum** | Majority intersection guarantees safety |
| **Multi-Paxos** | Skip Phase 1 for stable leaders |
| **Fast Paxos** | One round-trip in the common case |
| **EPaxos** | Any node can lead; order via dependency graph |
| **Flexible Paxos** | Different quorum sizes per phase |

---

# Lecture Takeaways

1. **Consensus is not optional.** Any replicated system that claims to be consistent must solve it — either explicitly or by hiding it behind a library.
2. **Safety first, liveness second.** Paxos can stall (dueling proposers), but it never corrupts. A stalled, safe system can recover; a corrupt one, often cannot.
3. **The Prepare phase is a lease.** It establishes a ballot that prevents stale proposals from succeeding. Once you have a stable leader, skip it.
4. **Quorums are the magic.** Any two majorities intersect — that overlap node prevents conflicting decisions from coexisting.


