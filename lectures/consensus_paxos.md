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
  "ticks": 56,
  "trackHeight": 50,
  "stateBandOffset": 10,
  "labelWidth": 100,
  "servers": ["Proposer", "Acceptor-1", "Acceptor-2", "Acceptor-3"],
  "states": [
    { "server": "Proposer",   "start": 0,  "end": 9,  "state": "idle",            "color": "#b0bec5" },
    { "server": "Proposer",   "start": 10, "end": 23, "state": "PREPARE(5)",       "color": "#ffb74d" },
    { "server": "Proposer",   "start": 24, "end": 56, "state": "quorum reached",  "color": "#81c784" },
    { "server": "Acceptor-1", "start": 0,  "end": 14, "state": "not prepared",    "color": "#b0bec5" },
    { "server": "Acceptor-1", "start": 15, "end": 56, "state": "promised N=5",    "color": "#4fc3f7" },
    { "server": "Acceptor-2", "start": 0,  "end": 16, "state": "not prepared",    "color": "#b0bec5" },
    { "server": "Acceptor-2", "start": 17, "end": 56, "state": "promised N=5",    "color": "#4fc3f7" },
    { "server": "Acceptor-3", "start": 0,  "end": 18, "state": "not prepared",    "color": "#b0bec5" },
    { "server": "Acceptor-3", "start": 19, "end": 56, "state": "promised N=5",    "color": "#4fc3f7" }
  ],
  "messages": [
    { "from": "Proposer",   "to": "Acceptor-1", "sendTick": 10, "recvTick": 15},
    { "from": "Proposer",   "to": "Acceptor-2", "sendTick": 10, "recvTick": 17},
    { "from": "Proposer",   "to": "Acceptor-3", "sendTick": 10, "recvTick": 19},
    { "from": "Acceptor-1", "to": "Proposer",   "sendTick": 16, "recvTick": 21},
    { "from": "Acceptor-2", "to": "Proposer",   "sendTick": 18, "recvTick": 24},
    { "from": "Acceptor-3", "to": "Proposer",   "sendTick": 20, "recvTick": 26}
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
  "ticks": 56,
  "trackHeight": 50,
  "stateBandOffset": 10,
  "labelWidth": 100,
  "servers": ["Proposer", "Acceptor-1", "Acceptor-2", "Acceptor-3", "Learner"],
  "states": [
    { "server": "Proposer",   "start": 0,  "end": 9,  "state": "has quorum",     "color": "#81c784" },
    { "server": "Proposer",   "start": 10, "end": 23, "state": "ACCEPT(5,'X')",  "color": "#ffb74d" },
    { "server": "Proposer",   "start": 24, "end": 56, "state": "decided 'X'",    "color": "#4caf50" },
    { "server": "Acceptor-1", "start": 0,  "end": 14, "state": "promised N=5",   "color": "#4fc3f7" },
    { "server": "Acceptor-1", "start": 15, "end": 56, "state": "accepted 'X'",   "color": "#81c784" },
    { "server": "Acceptor-2", "start": 0,  "end": 16, "state": "promised N=5",   "color": "#4fc3f7" },
    { "server": "Acceptor-2", "start": 17, "end": 56, "state": "accepted 'X'",   "color": "#81c784" },
    { "server": "Acceptor-3", "start": 0,  "end": 18, "state": "promised N=5",   "color": "#4fc3f7" },
    { "server": "Acceptor-3", "start": 19, "end": 56, "state": "accepted 'X'",   "color": "#81c784" },
    { "server": "Learner",    "start": 0,  "end": 24, "state": "waiting",        "color": "#b0bec5" },
    { "server": "Learner",    "start": 25, "end": 56, "state": "learned 'X'",    "color": "#4caf50" }
  ],
  "messages": [
    { "from": "Proposer",   "to": "Acceptor-1", "sendTick": 10, "recvTick": 15},
    { "from": "Proposer",   "to": "Acceptor-2", "sendTick": 10, "recvTick": 17},
    { "from": "Proposer",   "to": "Acceptor-3", "sendTick": 10, "recvTick": 19},
    { "from": "Acceptor-1", "to": "Proposer",   "sendTick": 16, "recvTick": 22},
    { "from": "Acceptor-2", "to": "Proposer",   "sendTick": 18, "recvTick": 24},
    { "from": "Acceptor-1", "to": "Learner",    "sendTick": 16, "recvTick": 23},
    { "from": "Acceptor-2", "to": "Learner",    "sendTick": 18, "recvTick": 25},
    { "from": "Acceptor-3", "to": "Proposer",   "sendTick": 20, "recvTick": 26},
    { "from": "Acceptor-3", "to": "Learner",    "sendTick": 20, "recvTick": 27}
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
    <button class="demo-btn" onclick="showDemo('demos/consensus-paxos/demo.json')" style="font-size: 1.5rem; padding: 15px 30px; background: #2196f3; color: white; border: none; border-radius: 6px; cursor: pointer;">
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
  "ticks": 56,
  "trackHeight": 44,
  "stateBandOffset": 10,
  "labelWidth": 100,
  "servers": ["Proposer-A", "Proposer-B", "Node-1", "Node-2", "Node-3", "Node-4", "Node-5"],
  "states": [
    { "server": "Proposer-A", "start": 5,  "end": 35, "state": "quorum: N1,N2,N3",  "color": "#4fc3f7" },
    { "server": "Proposer-B", "start": 5,  "end": 35, "state": "quorum: N3,N4,N5",  "color": "#ffb74d" },
    { "server": "Node-1",     "start": 0,  "end": 56, "state": "in A's quorum",      "color": "#4fc3f7" },
    { "server": "Node-2",     "start": 0,  "end": 56, "state": "in A's quorum",      "color": "#4fc3f7" },
    { "server": "Node-3",     "start": 0,  "end": 56, "state": "overlap — arbiter",  "color": "#ab47bc" },
    { "server": "Node-4",     "start": 0,  "end": 56, "state": "in B's quorum",      "color": "#ffb74d" },
    { "server": "Node-5",     "start": 0,  "end": 56, "state": "in B's quorum",      "color": "#ffb74d" }
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
  "ticks": 56,
  "trackHeight": 50,
  "stateBandOffset": 10,
  "labelWidth": 100,
  "servers": ["Proposer-1", "Proposer-2", "Acceptor-1", "Acceptor-2", "Acceptor-3"],
  "states": [
    { "server": "Proposer-1", "start": 0,  "end": 6,  "state": "PREPARE(1)",      "color": "#ffb74d" },
    { "server": "Proposer-1", "start": 7,  "end": 56, "state": "CRASHED",         "color": "#ef5350" },
    { "server": "Acceptor-1", "start": 0,  "end": 9,  "state": "waiting",         "color": "#b0bec5" },
    { "server": "Acceptor-1", "start": 10, "end": 26, "state": "promised N=1",    "color": "#90caf9" },
    { "server": "Acceptor-1", "start": 27, "end": 56, "state": "promised N=2",    "color": "#4fc3f7" },
    { "server": "Proposer-2", "start": 17, "end": 33, "state": "PREPARE(2)",      "color": "#81c784" },
    { "server": "Proposer-2", "start": 34, "end": 56, "state": "commit 'Y'",      "color": "#4caf50" },
    { "server": "Acceptor-2", "start": 0,  "end": 27, "state": "waiting",         "color": "#b0bec5" },
    { "server": "Acceptor-2", "start": 28, "end": 56, "state": "promised N=2",    "color": "#4fc3f7" },
    { "server": "Acceptor-3", "start": 0,  "end": 28, "state": "waiting",         "color": "#b0bec5" },
    { "server": "Acceptor-3", "start": 29, "end": 56, "state": "promised N=2",    "color": "#4fc3f7" }
  ],
  "messages": [
    { "from": "Proposer-1", "to": "Acceptor-1", "sendTick": 5,  "recvTick": 10 },
    { "from": "Acceptor-1", "to": "Proposer-1", "sendTick": 11, "recvTick": 16 },
    { "from": "Proposer-2", "to": "Acceptor-1", "sendTick": 22, "recvTick": 27 },
    { "from": "Proposer-2", "to": "Acceptor-2", "sendTick": 22, "recvTick": 28 },
    { "from": "Proposer-2", "to": "Acceptor-3", "sendTick": 22, "recvTick": 29 },
    { "from": "Acceptor-1", "to": "Proposer-2", "sendTick": 28, "recvTick": 32 },
    { "from": "Acceptor-2", "to": "Proposer-2", "sendTick": 29, "recvTick": 34 },
    { "from": "Acceptor-3", "to": "Proposer-2", "sendTick": 30, "recvTick": 35 }
  ]
}
```

---

# Failure: Proposer Fails in Phase 2

The proposer committed value `'X'` to Acceptor-1, then crashed before reaching the others. A new proposer sees that `'X'` was already accepted by Acceptor-1 and **must adopt it**.

```static-timeline
{
  "zoom": 0.85,
  "ticks": 56,
  "trackHeight": 44,
  "stateBandOffset": 10,
  "labelWidth": 100,
  "servers": ["Proposer-1", "Proposer-2", "Acceptor-1", "Acceptor-2", "Acceptor-3"],
  "states": [
    { "server": "Proposer-1", "start": 0,  "end": 9,  "state": "ACCEPT(1,'X')",     "color": "#ffb74d" },
    { "server": "Proposer-1", "start": 10, "end": 56, "state": "CRASHED",            "color": "#ef5350" },
    { "server": "Acceptor-1", "start": 0,  "end": 13, "state": "idle",               "color": "#b0bec5" },
    { "server": "Acceptor-1", "start": 14, "end": 27, "state": "accepted 'X', id=1","color": "#81c784" },
    { "server": "Acceptor-1", "start": 28, "end": 56, "state": "promised N=2 (saw X)", "color": "#ce93d8" },
    { "server": "Proposer-2", "start": 17, "end": 36, "state": "PREPARE(2)",         "color": "#81c784" },
    { "server": "Proposer-2", "start": 37, "end": 56, "state": "commit 'X' (id=2)", "color": "#4caf50" },
    { "server": "Acceptor-2", "start": 0,  "end": 28, "state": "idle",               "color": "#b0bec5" },
    { "server": "Acceptor-2", "start": 29, "end": 56, "state": "promised N=2",       "color": "#90caf9" },
    { "server": "Acceptor-3", "start": 0,  "end": 29, "state": "idle",               "color": "#b0bec5" },
    { "server": "Acceptor-3", "start": 30, "end": 56, "state": "promised N=2",       "color": "#90caf9" }
  ],
  "messages": [
    { "from": "Proposer-1", "to": "Acceptor-1", "sendTick": 8,  "recvTick": 14},
    { "from": "Acceptor-1", "to": "Proposer-1", "sendTick": 15, "recvTick": 20},
    { "from": "Proposer-2", "to": "Acceptor-1", "sendTick": 23, "recvTick": 28},
    { "from": "Proposer-2", "to": "Acceptor-2", "sendTick": 24, "recvTick": 29},
    { "from": "Proposer-2", "to": "Acceptor-3", "sendTick": 25, "recvTick": 30},
    { "from": "Acceptor-1", "to": "Proposer-2", "sendTick": 29, "recvTick": 36},
    { "from": "Acceptor-2", "to": "Proposer-2", "sendTick": 30, "recvTick": 37},
    { "from": "Acceptor-3", "to": "Proposer-2", "sendTick": 31, "recvTick": 38}
  ]
}
```

> **Note**: all of this can happen without the original proposer knowing. If the client is connected only to Proposer-1, it may never learn the result of the Paxos round.


---

# Failure: Dueling Proposers (Livelock)

Two proposers repeatedly outbid each other, preventing either from completing. Neither can collect a majority before the other bumps the ballot.

```static-timeline
{
  "zoom": 0.85,
  "ticks": 48,
  "trackHeight": 44,
  "stateBandOffset": 10,
  "labelWidth": 100,
  "servers": ["Proposer-1", "Proposer-2", "Acceptor-1"],
  "states": [
    { "server": "Proposer-1", "start": 0,  "end": 8,   "state": "PREPARE(1)",      "color": "#bbdefb" },
    { "server": "Proposer-1", "start": 9,  "end": 17,  "state": "ACCEPT(1,'X')",   "color": "#4fc3f7" },
    { "server": "Proposer-1", "start": 17, "end": 20,  "state": "WAIT (REJECTED)", "color": "#ef5350" },
    { "server": "Proposer-1", "start": 21, "end": 26,  "state": "PREPARE(3)",      "color": "#1565c0" },
    { "server": "Proposer-1", "start": 27, "end": 41,  "state": "ACCEPT(3,'X')",   "color": "#0d47a1" },
    { "server": "Proposer-1", "start": 41, "end": 48,  "state": "WAIT (REJECTED)", "color": "#ef5350" },
    
    { "server": "Proposer-2", "start": 0,  "end": 13,  "state": "PREPARE(2)",      "color": "#ffe082" },
    { "server": "Proposer-2", "start": 14, "end": 29,  "state": "ACCEPT(2,'Y')",   "color": "#ffb74d" },
    { "server": "Proposer-2", "start": 29, "end": 32,  "state": "WAIT (REJECTED)", "color": "#ef5350" },
    { "server": "Proposer-2", "start": 33, "end": 38,  "state": "PREPARE(4)",      "color": "#fbc02d" },
    { "server": "Proposer-2", "start": 39, "end": 48,  "state": "ACCEPT(4,'Y')",   "color": "#f9a825" },
    
    { "server": "Acceptor-1", "start": 0,  "end": 4,   "state": "idle",            "color": "#b0bec5" },
    { "server": "Acceptor-1", "start": 5,  "end": 9,   "state": "promised N=1",    "color": "#bbdefb" },
    { "server": "Acceptor-1", "start": 10, "end": 22,  "state": "promised N=2",    "color": "#ffe082" },
    { "server": "Acceptor-1", "start": 23, "end": 34,  "state": "promised N=3",    "color": "#1565c0" },
    { "server": "Acceptor-1", "start": 35, "end": 48,  "state": "promised N=4",    "color": "#fbc02d" }
  ],
  "messages": [
    { "from": "Proposer-1", "to": "Acceptor-1", "sendTick": 2,  "recvTick": 5},
    { "from": "Acceptor-1", "to": "Proposer-1", "sendTick": 5,  "recvTick": 8},
    
    { "from": "Proposer-2", "to": "Acceptor-1", "sendTick": 7,  "recvTick": 10},
    { "from": "Acceptor-1", "to": "Proposer-2", "sendTick": 10, "recvTick": 13},
    
    { "from": "Proposer-1", "to": "Acceptor-1", "sendTick": 10, "recvTick": 14},
    { "from": "Acceptor-1", "to": "Proposer-1", "sendTick": 14, "recvTick": 17},
    
    { "from": "Proposer-1", "to": "Acceptor-1", "sendTick": 22, "recvTick": 23},
    { "from": "Acceptor-1", "to": "Proposer-1", "sendTick": 23, "recvTick": 26},
    
    { "from": "Proposer-2", "to": "Acceptor-1", "sendTick": 22, "recvTick": 26},
    { "from": "Acceptor-1", "to": "Proposer-2", "sendTick": 26, "recvTick": 29},
    
    { "from": "Proposer-2", "to": "Acceptor-1", "sendTick": 34, "recvTick": 35},
    { "from": "Acceptor-1", "to": "Proposer-2", "sendTick": 35, "recvTick": 38},
    
    { "from": "Proposer-1", "to": "Acceptor-1", "sendTick": 34, "recvTick": 38},
    { "from": "Acceptor-1", "to": "Proposer-1", "sendTick": 38, "recvTick": 41}
  ]
}
```

**Resolution**: **Random exponential backoff** — the proposer that lost the ballot waits a random amount of time before retrying, giving the other time to complete.


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
  "ticks": 54,
  "trackHeight": 44,
  "stateBandOffset": 10,
  "labelWidth": 100,
  "servers": ["Leader", "Acceptor-1", "Acceptor-2", "Acceptor-3"],
  "states": [
    { "server": "Leader",     "start": 0,  "end": 4,  "state": "idle",             "color": "#b0bec5" },
    { "server": "Leader",     "start": 5,  "end": 14, "state": "PREPARE(N)",         "color": "#ffb74d" },
    { "server": "Leader",     "start": 15, "end": 27, "state": "ACCEPT cmd_1",     "color": "#4fc3f7" },
    { "server": "Leader",     "start": 28, "end": 40, "state": "ACCEPT cmd_2 ✂️",  "color": "#4fc3f7" },
    { "server": "Leader",     "start": 41, "end": 54, "state": "ACCEPT cmd_3 ✂️",  "color": "#4fc3f7" },
    
    { "server": "Acceptor-1", "start": 0,  "end": 7,  "state": "ready",            "color": "#b0bec5" },
    { "server": "Acceptor-1", "start": 8,  "end": 17, "state": "promised",         "color": "#ce93d8" },
    { "server": "Acceptor-1", "start": 18, "end": 54, "state": "accepting stream", "color": "#81c784" },
    
    { "server": "Acceptor-2", "start": 0,  "end": 8,  "state": "ready",            "color": "#b0bec5" },
    { "server": "Acceptor-2", "start": 9,  "end": 18, "state": "promised",         "color": "#ce93d8" },
    { "server": "Acceptor-2", "start": 19, "end": 54, "state": "accepting stream", "color": "#81c784" },
    
    { "server": "Acceptor-3", "start": 0,  "end": 9,  "state": "ready",            "color": "#b0bec5" },
    { "server": "Acceptor-3", "start": 10, "end": 19, "state": "promised",         "color": "#ce93d8" },
    { "server": "Acceptor-3", "start": 20, "end": 54, "state": "accepting stream", "color": "#81c784" }
  ],
  "messages": [
    { "from": "Leader",     "to": "Acceptor-1", "sendTick": 5,  "recvTick": 8 },
    { "from": "Leader",     "to": "Acceptor-2", "sendTick": 5,  "recvTick": 9 },
    { "from": "Leader",     "to": "Acceptor-3", "sendTick": 5,  "recvTick": 10 },
    
    { "from": "Acceptor-1", "to": "Leader",     "sendTick": 9,  "recvTick": 13 },
    { "from": "Acceptor-2", "to": "Leader",     "sendTick": 10, "recvTick": 14 },
    { "from": "Acceptor-3", "to": "Leader",     "sendTick": 11, "recvTick": 15 },
    
    { "from": "Leader",     "to": "Acceptor-1", "sendTick": 15, "recvTick": 18 },
    { "from": "Leader",     "to": "Acceptor-2", "sendTick": 15, "recvTick": 19 },
    { "from": "Leader",     "to": "Acceptor-3", "sendTick": 15, "recvTick": 20 },
    
    { "from": "Acceptor-1", "to": "Leader",     "sendTick": 19, "recvTick": 23 },
    { "from": "Acceptor-2", "to": "Leader",     "sendTick": 20, "recvTick": 24 },
    { "from": "Acceptor-3", "to": "Leader",     "sendTick": 21, "recvTick": 25 },
    
    { "from": "Leader",     "to": "Acceptor-1", "sendTick": 28, "recvTick": 31 },
    { "from": "Leader",     "to": "Acceptor-2", "sendTick": 28, "recvTick": 32 },
    { "from": "Leader",     "to": "Acceptor-3", "sendTick": 28, "recvTick": 33 },
    
    { "from": "Acceptor-1", "to": "Leader",     "sendTick": 32, "recvTick": 36 },
    { "from": "Acceptor-2", "to": "Leader",     "sendTick": 33, "recvTick": 37 },
    { "from": "Acceptor-3", "to": "Leader",     "sendTick": 34, "recvTick": 38 },
    
    { "from": "Leader",     "to": "Acceptor-1", "sendTick": 41, "recvTick": 44 },
    { "from": "Leader",     "to": "Acceptor-2", "sendTick": 41, "recvTick": 45 },
    { "from": "Leader",     "to": "Acceptor-3", "sendTick": 41, "recvTick": 46 },
    
    { "from": "Acceptor-1", "to": "Leader",     "sendTick": 45, "recvTick": 49 },
    { "from": "Acceptor-2", "to": "Leader",     "sendTick": 46, "recvTick": 50 },
    { "from": "Acceptor-3", "to": "Leader",     "sendTick": 47, "recvTick": 51 }
  ]
}
```

✂️ indicates rounds where the Prepare phase was **skipped** entirely.

---

# Leader steal

```static-timeline
{
  "zoom": 0.85,
  "ticks": 56,
  "trackHeight": 44,
  "stateBandOffset": 10,
  "labelWidth": 100,
  "servers": ["Proposer-A", "Proposer-B", "Acceptor-1", "Acceptor-2", "Acceptor-3"],
  "states": [
    { "server": "Proposer-A", "start": 0,  "end": 10,  "state": "PREPARE(1)",      "color": "#ffb74d" },
    { "server": "Proposer-A", "start": 11, "end": 20,  "state": "LEADER (cmd_1)",  "color": "#4fc3f7" },
    { "server": "Proposer-A", "start": 21, "end": 36,  "state": "Phantom Leader",  "color": "#e0e0e0" },
    { "server": "Proposer-A", "start": 37, "end": 42,  "state": "ACCEPT cmd_3 ✂️", "color": "#4fc3f7" },
    { "server": "Proposer-A", "start": 43, "end": 47,  "state": "FAILED (NACK)",   "color": "#e57373" },
    { "server": "Proposer-A", "start": 48, "end": 56,  "state": "PREPARE(3)",      "color": "#ffb74d" },

    { "server": "Proposer-B", "start": 0,  "end": 19,  "state": "idle",            "color": "#b0bec5" },
    { "server": "Proposer-B", "start": 20, "end": 28,  "state": "PREPARE(2)",      "color": "#ffb74d" },
    { "server": "Proposer-B", "start": 29, "end": 56,  "state": "LEADER (cmd_2)",  "color": "#4fc3f7" },

    { "server": "Acceptor-1", "start": 0,  "end": 4,   "state": "ready",           "color": "#b0bec5" },
    { "server": "Acceptor-1", "start": 5,  "end": 22,  "state": "promised N=1",    "color": "#ce93d8" },
    { "server": "Acceptor-1", "start": 23, "end": 56,  "state": "promised N=2",    "color": "#ba68c8" },
    
    { "server": "Acceptor-2", "start": 0,  "end": 5,   "state": "ready",           "color": "#b0bec5" },
    { "server": "Acceptor-2", "start": 6,  "end": 23,  "state": "promised N=1",    "color": "#ce93d8" },
    { "server": "Acceptor-2", "start": 24, "end": 56,  "state": "promised N=2",    "color": "#ba68c8" },

    { "server": "Acceptor-3", "start": 0,  "end": 6,   "state": "ready",           "color": "#b0bec5" },
    { "server": "Acceptor-3", "start": 7,  "end": 24,  "state": "promised N=1",    "color": "#ce93d8" },
    { "server": "Acceptor-3", "start": 25, "end": 56,  "state": "promised N=2",    "color": "#ba68c8" }
  ],
  "messages": [
    { "from": "Proposer-A", "to": "Acceptor-1", "sendTick": 2,  "recvTick": 5},
    { "from": "Proposer-A", "to": "Acceptor-2", "sendTick": 2,  "recvTick": 6 },
    { "from": "Proposer-A", "to": "Acceptor-3", "sendTick": 2,  "recvTick": 7 },
    
    { "from": "Acceptor-1", "to": "Proposer-A", "sendTick": 5,  "recvTick": 8},
    { "from": "Acceptor-2", "to": "Proposer-A", "sendTick": 6,  "recvTick": 9 },
    { "from": "Acceptor-3", "to": "Proposer-A", "sendTick": 7,  "recvTick": 10 },
    
    { "from": "Proposer-A", "to": "Acceptor-1", "sendTick": 11, "recvTick": 14},
    { "from": "Proposer-A", "to": "Acceptor-2", "sendTick": 11, "recvTick": 15 },
    { "from": "Proposer-A", "to": "Acceptor-3", "sendTick": 11, "recvTick": 16 },
    
    { "from": "Acceptor-1", "to": "Proposer-A", "sendTick": 14, "recvTick": 17},
    { "from": "Acceptor-2", "to": "Proposer-A", "sendTick": 15, "recvTick": 18 },
    { "from": "Acceptor-3", "to": "Proposer-A", "sendTick": 16, "recvTick": 19 },
    
    { "from": "Proposer-B", "to": "Acceptor-1", "sendTick": 20, "recvTick": 23},
    { "from": "Proposer-B", "to": "Acceptor-2", "sendTick": 20, "recvTick": 24 },
    { "from": "Proposer-B", "to": "Acceptor-3", "sendTick": 20, "recvTick": 25 },
    
    { "from": "Acceptor-1", "to": "Proposer-B", "sendTick": 23, "recvTick": 26},
    { "from": "Acceptor-2", "to": "Proposer-B", "sendTick": 24, "recvTick": 27 },
    { "from": "Acceptor-3", "to": "Proposer-B", "sendTick": 25, "recvTick": 28 },
    
    { "from": "Proposer-B", "to": "Acceptor-1", "sendTick": 29, "recvTick": 32},
    { "from": "Proposer-B", "to": "Acceptor-2", "sendTick": 29, "recvTick": 33 },
    { "from": "Proposer-B", "to": "Acceptor-3", "sendTick": 29, "recvTick": 34 },
    
    { "from": "Proposer-A", "to": "Acceptor-1", "sendTick": 37, "recvTick": 40},
    { "from": "Proposer-A", "to": "Acceptor-2", "sendTick": 37, "recvTick": 41 },
    { "from": "Proposer-A", "to": "Acceptor-3", "sendTick": 37, "recvTick": 42 },
    
    { "from": "Acceptor-1", "to": "Proposer-A", "sendTick": 40, "recvTick": 43, "lost": true },
    { "from": "Acceptor-2", "to": "Proposer-A", "sendTick": 41, "recvTick": 44, "lost": true },
    { "from": "Acceptor-3", "to": "Proposer-A", "sendTick": 42, "recvTick": 45, "lost": true },

    { "from": "Proposer-A", "to": "Acceptor-1", "sendTick": 48, "recvTick": 51},
    { "from": "Proposer-A", "to": "Acceptor-2", "sendTick": 48, "recvTick": 52 },
    { "from": "Proposer-A", "to": "Acceptor-3", "sendTick": 48, "recvTick": 53 }
  ]
}
```

---

# Multi-Paxos Demo

This simulation shows the optimization in action. The first round is a full Paxos (Prepare → Promise → Accept → Accepted → Decided). Subsequent rounds **skip the Prepare phase** — the leader sends ACCEPT directly, cutting latency in half.

<div class="callout-box">
    <h4>What to watch</h4>
    <p>Compare the number of message round-trips in round 1 vs. rounds 2 and 3. Round 1 has <b>two</b> round-trips (Prepare → Accept). Rounds 2 and 3 have <b>one</b> round-trip each (Accept only). The FSM shows the leader staying in `leader` state after the first win, transitioning back to `accepting` for each subsequent commit without going through `preparing`.</p>
</div>

<div style="text-align: center; margin-top: 40px; margin-bottom: 40px;">
    <button class="demo-btn" onclick="showDemo('demos/consensus-multi-paxos/demo.json')" style="font-size: 1.5rem; padding: 15px 30px; background: #2196f3; color: white; border: none; border-radius: 6px; cursor: pointer;">
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
  "ticks": 56,
  "trackHeight": 44,
  "stateBandOffset": 10,
  "labelWidth": 100,
  "servers": ["Coordinator", "Proposer-1", "Acceptor-1", "Acceptor-2", "Acceptor-3"],
  "states": [
    { "server": "Coordinator",  "start": 0,  "end": 23, "state": "wait for fast quorum", "color": "#b0bec5" },
    { "server": "Coordinator",  "start": 24, "end": 56, "state": "decided 'Y'",          "color": "#4caf50" },

    { "server": "Proposer-1",   "start": 0,  "end": 11, "state": "idle",                 "color": "#cfd8dc" },
    { "server": "Proposer-1",   "start": 12, "end": 28, "state": "propose 'Y' direct",   "color": "#ffb74d" },
    { "server": "Proposer-1",   "start": 29, "end": 56, "state": "learned 'Y'",          "color": "#4caf50" },

    { "server": "Acceptor-1",   "start": 0,  "end": 5,  "state": "idle",                 "color": "#cfd8dc" },
    { "server": "Acceptor-1",   "start": 6,  "end": 15, "state": "accept ANY",           "color": "#ffe082" },
    { "server": "Acceptor-1",   "start": 16, "end": 29, "state": "accepted 'Y'",         "color": "#4fc3f7" },
    { "server": "Acceptor-1",   "start": 30, "end": 56, "state": "learned 'Y'",          "color": "#81c784" },

    { "server": "Acceptor-2",   "start": 0,  "end": 6,  "state": "idle",                 "color": "#cfd8dc" },
    { "server": "Acceptor-2",   "start": 7,  "end": 16, "state": "accept ANY",           "color": "#ffe082" },
    { "server": "Acceptor-2",   "start": 17, "end": 30, "state": "accepted 'Y'",         "color": "#4fc3f7" },
    { "server": "Acceptor-2",   "start": 31, "end": 56, "state": "learned 'Y'",          "color": "#81c784" },

    { "server": "Acceptor-3",   "start": 0,  "end": 7,  "state": "idle",                 "color": "#cfd8dc" },
    { "server": "Acceptor-3",   "start": 8,  "end": 17, "state": "accept ANY",           "color": "#ffe082" },
    { "server": "Acceptor-3",   "start": 18, "end": 31, "state": "accepted 'Y'",         "color": "#4fc3f7" },
    { "server": "Acceptor-3",   "start": 32, "end": 45, "state": "learned 'Y'",          "color": "#81c784" }
  ],
  "messages": [
    { "from": "Coordinator", "to": "Acceptor-1", "sendTick": 2,  "recvTick": 6,  "label": "Any" },
    { "from": "Coordinator", "to": "Acceptor-2", "sendTick": 2,  "recvTick": 7 },
    { "from": "Coordinator", "to": "Acceptor-3", "sendTick": 2,  "recvTick": 8 },

    { "from": "Proposer-1",  "to": "Acceptor-1", "sendTick": 12, "recvTick": 16, "label": "Fast Propose 'Y'" },
    { "from": "Proposer-1",  "to": "Acceptor-2", "sendTick": 12, "recvTick": 17 },
    { "from": "Proposer-1",  "to": "Acceptor-3", "sendTick": 12, "recvTick": 18 },

    { "from": "Acceptor-1",  "to": "Coordinator","sendTick": 17, "recvTick": 21, "label": "Accepted 'Y'" },
    { "from": "Acceptor-2",  "to": "Coordinator","sendTick": 18, "recvTick": 22 },
    { "from": "Acceptor-3",  "to": "Coordinator","sendTick": 19, "recvTick": 23 },

    { "from": "Coordinator", "to": "Proposer-1", "sendTick": 25, "recvTick": 29, "label": "Learn 'Y'" },
    { "from": "Coordinator", "to": "Acceptor-1", "sendTick": 25, "recvTick": 30 },
    { "from": "Coordinator", "to": "Acceptor-2", "sendTick": 25, "recvTick": 31 },
    { "from": "Coordinator", "to": "Acceptor-3", "sendTick": 25, "recvTick": 32 }
  ]
}
```

> **Quorum increase required**: to survive collisions, Fast Paxos needs **3f + 1** total acceptors (vs. **2f + 1** in classic) and a fast quorum of **2f + 1** (vs. **f + 1**).

---

# Fast Paxos Demo

<div class="callout-box">
    <h4>What to watch: Production vs. Academic Fast Paxos</h4>
    <p>This demo illustrates how Fast Paxos is built in <strong>production systems</strong>, which differs from the strict academic model in two key ways:</p>
    <ul>
        <li><strong>Proxy Proposers:</strong> Instead of clients executing the complex Paxos protocol themselves, they send standard requests to dedicated Proposer nodes (acting as secure API Gateways).</li>
        <li><strong>The "Implicit Any":</strong> To save network bandwidth, the Coordinator does not constantly broadcast "Accept Any." The Acceptors boot up already primed to accept fast messages.</li>
    </ul>
    <p><em>The Action:</em> Watch the two Proposers bypass the Coordinator to send conflicting messages simultaneously. When the Acceptors split their votes, notice how the system detects the <strong>Collision</strong> and falls back to a Classic Paxos round to recover.</p>
</div>

<div style="text-align: center; margin-top: 40px; margin-bottom: 40px;">
    <button class="demo-btn" onclick="showDemo('demos/consensus-fast-paxos/demo.json')" style="font-size: 1.5rem; padding: 15px 30px; background: #2196f3; color: white; border: none; border-radius: 6px; cursor: pointer;">
        Launch Fast Paxos Demo
    </button>
</div>

---

# Egalitarian Paxos (EPaxos)

Classic Paxos and Multi-Paxos rely on a **single leader** - a bottleneck and point of failure.

**EPaxos** (Egalitarian Paxos) allows **any replica to act as leader** for its own proposals. Order is established not by voting sequence, but by tracking **dependencies**: two commands that potentially conflict must be ordered relative to each other via a dependency graph.

Each proposal includes:
* **A dependency set** - all potentially interfering commands not yet committed.
* **A sequence number** - breaks cycles in the dependency graph.

---

# EPaxos Paths

EPaxos has two execution paths:

| Path | When | Round-trips |
|---|---|---|
| **Fast path** | All replicas agree on dependencies | 1 |
| **Slow path** | Dependency conflict detected | 2 |

Commands are executed **after all their dependencies** (and their dependencies' dependencies) are committed and executed. Non-conflicting commands can execute in parallel.

> *The key insight: sharing data between acceptors isn't the problem - the problem is applying operations in a consistent order without corrupting local storage.*

---

# EPaxos Timeline

Notice how <strong>R1</strong> receives unanimous agreement that <code>X</code> has no dependencies, allowing it to commit instantly on the Fast Path. Shortly after, <strong>R5</strong> tries to fast-track <code>Y</code>. However, its own local state says <code>Y</code> has no dependencies, while its peers reply that <code>Y</code> depends on <code>X</code>. Because these dependencies mismatch, R5 is mathematically forced into the Slow Path to safely lock in the order.

```static-timeline
{
  "zoom": 0.9,
  "ticks": 30,
  "trackHeight": 44,
  "stateBandOffset": 10,
  "labelWidth": 120,
  "float": "center",
  "width": "65%",
  "servers": ["R1 (Cmd X)", "R2", "R3", "R4", "R5 (Cmd Y)"],
  "states": [
    { "server": "R1 (Cmd X)", "start": 0,  "end": 8,  "state": "Pre-Accept (X)",  "color": "#ffb74d" },
    { "server": "R1 (Cmd X)", "start": 9,  "end": 30, "state": "FAST COMMIT (X)", "color": "#81c784" },
    
    { "server": "R5 (Cmd Y)", "start": 5,  "end": 13, "state": "Pre-Accept (Y)",  "color": "#ffb74d" },
    { "server": "R5 (Cmd Y)", "start": 14, "end": 22, "state": "Slow Accept (Y)", "color": "#64b5f6" },
    { "server": "R5 (Cmd Y)", "start": 23, "end": 30, "state": "SLOW COMMIT (Y)", "color": "#4db6ac" },
    
    { "server": "R2", "start": 0, "end": 30, "state": "idle", "color": "#cfd8dc" },
    { "server": "R3", "start": 0, "end": 30, "state": "idle", "color": "#cfd8dc" },
    { "server": "R4", "start": 0, "end": 30, "state": "idle", "color": "#cfd8dc" }
  ],
  "messages": [
    { "from": "R1 (Cmd X)", "to": "R2", "sendTick": 1, "recvTick": 4, "label": "PreAc(X)" },
    { "from": "R1 (Cmd X)", "to": "R3", "sendTick": 1, "recvTick": 4 },
    { "from": "R1 (Cmd X)", "to": "R4", "sendTick": 1, "recvTick": 4 },
    { "from": "R2", "to": "R1 (Cmd X)", "sendTick": 4, "recvTick": 8, "label": "OK(dep=[])" },
    { "from": "R3", "to": "R1 (Cmd X)", "sendTick": 4, "recvTick": 8 },
    { "from": "R4", "to": "R1 (Cmd X)", "sendTick": 4, "recvTick": 8 },

    { "from": "R5 (Cmd Y)", "to": "R2", "sendTick": 6, "recvTick": 9, "label": "PreAc(Y)" },
    { "from": "R5 (Cmd Y)", "to": "R3", "sendTick": 6, "recvTick": 9 },
    { "from": "R5 (Cmd Y)", "to": "R4", "sendTick": 6, "recvTick": 9 },
    
    { "from": "R2", "to": "R5 (Cmd Y)", "sendTick": 9, "recvTick": 13, "label": "OK(dep=[X])" },
    { "from": "R3", "to": "R5 (Cmd Y)", "sendTick": 9, "recvTick": 13 },
    { "from": "R4", "to": "R5 (Cmd Y)", "sendTick": 9, "recvTick": 13 },

    { "from": "R5 (Cmd Y)", "to": "R2", "sendTick": 14, "recvTick": 18, "label": "Accept(Y, [X])" },
    { "from": "R5 (Cmd Y)", "to": "R3", "sendTick": 14, "recvTick": 18 },
    { "from": "R5 (Cmd Y)", "to": "R4", "sendTick": 14, "recvTick": 18 },
    
    { "from": "R2", "to": "R5 (Cmd Y)", "sendTick": 18, "recvTick": 22, "label": "Accept-OK" },
    { "from": "R3", "to": "R5 (Cmd Y)", "sendTick": 18, "recvTick": 22 },
    { "from": "R4", "to": "R5 (Cmd Y)", "sendTick": 18, "recvTick": 22 }
  ]
}
```


---

# Demo

> Note: In the demo, we use a deterministic tie-breaker to keep the visual simulation readable (highest Instance ID wins). In real EPaxos, replicas do not apply data to the database the moment a COMMIT message arrives. Instead, they write the commit to a pending log, perform a topological sort on the dependency graph, and then execute the commands in the determined order.

<div style="text-align: center; margin-top: 40px; margin-bottom: 40px;">
<button class="demo-btn" onclick="showDemo('demos/consensus-egalitarian-paxos/demo.json')" style="font-size: 1.5rem; padding: 15px 30px; background: #2196f3; color: white; border: none; border-radius: 6px; cursor: pointer;">
Launch Egalitarian Paxos Demo
</button>
</div>

> Replicas in real EPaxos do not apply data to the database the moment a COMMIT message arrives. Instead, they write the commit to a pending log, perform a **topological sort** on the dependency graph, and then execute the commands in the determined order.

---

# Flexible Paxos

Classic Paxos defines quorums as strict majorities. **Flexible Paxos** relaxes this constraint.

**Key observation**: We only require that the **Phase 1 quorum** (election) and **Phase 2 quorum** (acceptance) **intersect** — not that either be a majority.

If the total number of participants is `N`, Phase 1 quorum size is `P`, and Phase 2 quorum size is `A`, we only need:

$$A + P > N$$

Since Phase 2 (replication) runs far more often than Phase 1 (leader election), we can make `A` much smaller than `P`.

<div style="text-align: center; margin-top: 40px; margin-bottom: 40px;">
<button class="demo-btn" onclick="showDemo('demos/consensus-flexible-paxos/demo.json')" style="font-size: 1.5rem; padding: 15px 30px; background: #2196f3; color: white; border: none; border-radius: 6px; cursor: pointer;">
Launch Flexible Paxos Demo
</button>
</div>

---

# Flexible Paxos: The Trade-off

| Configuration (`N=5`) | Phase 1 (P) | Phase 2 (A) | Benefit |
|---|---|---|---|
| Classic majority | 3 | 3 | Balanced |
| Flexible (latency-optimized) | 4 | 2 | Faster writes |
| Flexible (election-heavy) | 5 | 1 | Single-node accepts |


**Vertical Paxos** applies the same idea to read/write quorums: read quorums and write quorums must intersect, allowing smaller write quorums.

---

# Flexible Paxos Timeline

```static-timeline
{
  "zoom": 0.85,
  "ticks": 45,
  "trackHeight": 44,
  "stateBandOffset": 10,
  "labelWidth": 100,
  "servers": ["Leader", "Node-1", "Node-2", "Node-3", "Node-4", "Node-5"],
  "states": [
    { "server": "Leader", "start": 0,  "end": 4,  "state": "idle", "color": "#cfd8dc" },
    { "server": "Leader", "start": 5,  "end": 22, "state": "Phase 1 (P=4)", "color": "#ffb74d" },
    { "server": "Leader", "start": 23, "end": 45, "state": "Phase 2 (A=2)", "color": "#4fc3f7" },
    
    { "server": "Node-1", "start": 0,  "end": 7,  "state": "idle", "color": "#cfd8dc" },
    { "server": "Node-1", "start": 8,  "end": 26, "state": "promised", "color": "#ffe082" },
    { "server": "Node-1", "start": 27, "end": 45, "state": "accepted", "color": "#81c784" },
    
    { "server": "Node-2", "start": 0,  "end": 8,  "state": "idle", "color": "#cfd8dc" },
    { "server": "Node-2", "start": 9,  "end": 27, "state": "promised", "color": "#ffe082" },
    { "server": "Node-2", "start": 28, "end": 45, "state": "accepted", "color": "#81c784" },
    
    { "server": "Node-3", "start": 0,  "end": 9,  "state": "idle", "color": "#cfd8dc" },
    { "server": "Node-3", "start": 10, "end": 45, "state": "promised (excluded from P2)", "color": "#ffe082" },
    
    { "server": "Node-4", "start": 0,  "end": 10, "state": "idle", "color": "#cfd8dc" },
    { "server": "Node-4", "start": 11, "end": 45, "state": "promised (excluded from P2)", "color": "#ffe082" },
    
    { "server": "Node-5", "start": 0,  "end": 45, "state": "idle (excluded entirely)", "color": "#cfd8dc" }
  ],
  "messages": [
    { "from": "Leader", "to": "Node-1", "sendTick": 5, "recvTick": 8, "label": "PREPARE" },
    { "from": "Leader", "to": "Node-2", "sendTick": 5, "recvTick": 9 },
    { "from": "Leader", "to": "Node-3", "sendTick": 5, "recvTick": 10 },
    { "from": "Leader", "to": "Node-4", "sendTick": 5, "recvTick": 11 },
    
    { "from": "Node-1", "to": "Leader", "sendTick": 9,  "recvTick": 13, "label": "PROMISE" },
    { "from": "Node-2", "to": "Leader", "sendTick": 10, "recvTick": 14 },
    { "from": "Node-3", "to": "Leader", "sendTick": 11, "recvTick": 15 },
    { "from": "Node-4", "to": "Leader", "sendTick": 12, "recvTick": 16 },
    
    { "from": "Leader", "to": "Node-1", "sendTick": 23, "recvTick": 27, "label": "ACCEPT" },
    { "from": "Leader", "to": "Node-2", "sendTick": 23, "recvTick": 28 },
    
    { "from": "Node-1", "to": "Leader", "sendTick": 28, "recvTick": 32, "label": "ACCEPTED" },
    { "from": "Node-2", "to": "Leader", "sendTick": 29, "recvTick": 33 }
  ]
}
```

> *Nodes 1 and 2 are the intersection — they participated in both phases, ensuring a new leader in Phase 1 will always overlap with at least one node that saw the committed value.*


---

# Generalized Solution to Consensus

A more recent reformulation simplifies Paxos to a few core concepts, removing the distinction between roles and rounds. See: [*"A Generalized Solution to Consensus"*](https://arxiv.org/pdf/1902.06776.pdf).

**Model**:
* A **client** and a set of **servers**, each with multiple **registers**.
* Each register has an index, is **write-once**, and can be:
  * Unwritten
  * Containing a value
  * Containing **nil** (explicitly empty)

---

# Generalized Solution to Consensus

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

> A register can never be overwritten once it transitions away from the "unwritten" state.

> We set lower registers to nil. In traditional Paxos, this is exactly what a "Promise" is. By promising not to accept older ballots, an acceptor is essentially doing a bulk-write of nil to every register index from $0$ up to $N-1$.

---

# Generalized Algorithm Phases

**Phase 2 — P2A**

1. Client broadcasts `P2A(register, value)` to all servers.
2. If a majority responds, the decision is output.
3. Otherwise, restart from Phase 1.

> *This generalizes single-decree Paxos: the ballot number maps to the register index, and the promise/accept mechanism maps to the nil/value write rules.*

<div style="text-align: center; margin-top: 40px; margin-bottom: 40px;">
<button class="demo-btn" onclick="showDemo('demos/consensus-generalized-paxos/demo.json')" style="font-size: 1.5rem; padding: 15px 30px; background: #2196f3; color: white; border: none; border-radius: 6px; cursor: pointer;">
Launch Generalized Paxos Demo
</button>
</div>

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


