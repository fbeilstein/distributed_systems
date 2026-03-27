# Distributed Transactions
## Achieving Atomicity Across Distributed Systems

---

# Why Transactions?

In a distributed system, enforcing **consistency** requires more than single-operation guarantees.

Most real-world workflows require **multiple operations to succeed or fail as a single unit**:

- Debit account A **and** credit account B
- Reserve a seat **and** charge a card
- Update a user record **and** publish an event

Each individual operation is itself not atomic under the hood — it involves a network request, a disk read, a computation, a write, and an acknowledgment. A crash at any step leaves partial state.

---

# What Is a Transaction?

A **transaction** is a set of operations treated as a single atomic unit of execution.

**Atomicity** means: **all results become visible, or none do.**

If a transaction cannot complete, is aborted, or times out, its effects must be **rolled back completely**. A partially executed, non-recoverable transaction leaves the database in an inconsistent state.

> *The database state must revert to its state before the transaction — as if it was never attempted.*

---

# The Distributed Complication

In a single-node database, atomicity is hard enough. In a distributed system, we add:

* **Independent failures**: nodes crash and recover independently while their states must stay consistent.
* **Network partitions**: messages get lost or delayed, leaving nodes uncertain about each other's progress.
* **Cross-partition writes**: a single transaction may touch data owned by completely separate servers.

This means atomicity must hold not just for local operations, but for **operations across all participating nodes**.

---

# Transaction Serializability

Transactions run concurrently. The **history** of a system is all the operations executed in order, representing a dependency graph of which transactions preceded others.

A history is **serializable** if its final result is functionally equivalent to some **sequential** history — one where transactions execute one after another, without any overlap.

---

# Transaction Serializability

<small>
Tx 1 completes entirely before Tx 2 begins --- Trivially Serializable.
</small>

```static-timeline
{
  "zoom": 0.85,
  "ticks": 58,
  "trackHeight": 50,
  "stateBandOffset": 10,
  "servers": ["Tx 1", "Tx 2"],
  "states": [
    { "server": "Tx 1", "start": 5,  "end": 26, "state": "read A, write A, write B", "color": "#ffb74d" },
    { "server": "Tx 2", "start": 30, "end": 55, "state": "read A, read B, compute sum", "color": "#81c784" }
  ]
}
```

<small>
When Tx 1 and Tx 2 overlap in time, their database operations interleave. This concurrent execution is <b>only serializable if</b> the final state of the database is exactly the same as the sequential execution Tx 1 → Tx 2 or Tx 2 → Tx 1.
</small>

```static-timeline
{
  "zoom": 0.85,
  "ticks": 58,
  "trackHeight": 50,
  "stateBandOffset": 10,
  "servers": ["Tx 1", "Tx 2"],
  "states": [
    { "server": "Tx 1", "start": 5,  "end": 38, "state": "read A, write A, write B", "color": "#ffb74d" },
    { "server": "Tx 2", "start": 18, "end": 52, "state": "read A, read B (overlapping)", "color": "#ef5350" }
  ]
}
```

---

# Single-Partition vs. Multi-Partition

**Single-partition transactions** use local concurrency control:
- **Pessimistic**: lock-based (2PL) or tracking-based
- **Optimistic**: execute speculatively, validate before commit

Neither approach alone solves **multi-partition transactions**, which require:
- **Coordination** between different servers
- **Distributed commit** protocols
- **Rollback** protocols that span partitions

---

# Making Operations Appear Atomic

To make multi-node operations appear atomic, we use a class of algorithms called **atomic commitment**.

Atomic commitment requires **consensus between all participants**: a transaction will not commit if even *one* participant votes against it.

Key implications:
- Failed nodes must reach the **same conclusion** as surviving cohorts before serving data.
- Atomic commitment does **not work with Byzantine failures** — if a node lies about its state, the unanimity requirement is broken.

> *The core problem: to commit or to abort — and the transaction itself cannot be modified.*

The **transaction manager** is the subsystem responsible for scheduling, coordinating, and tracking transactions. In a distributed system, it ensures every partition reaches the same verdict.

---

# Two-Phase Commit (2PC)

2PC is the foundational distributed atomic commitment protocol. It executes in **two phases**:

1. **Prepare Phase** — Distribute the proposed transaction value and collect votes.
2. **Commit Phase** — Flip the switch: make the results of Phase 1 visible everywhere.

2PC assumes a **coordinator** (leader) that holds the transaction state, collects votes, and drives the protocol. The other nodes are **cohorts** — usually partitions operating over disjoint datasets.

The coordinator can be:
- The node that received the client request
- Chosen by leader election
- Fixed or transferred for reliability

---

# 2PC Execution

**Phase 1 — Prepare**

<div class="small-text">

1. Coordinator sends a **PROPOSE** message to all cohorts.
2. Each cohort decides if it can commit its local portion of the transaction.
3. Cohorts reply with `VOTE_COMMIT` or `VOTE_ABORT`.

</div>

**Phase 2 — Commit or Abort**

<div class="small-text">

- If **all** cohorts vote commit → coordinator sends `COMMIT` to all.

</div>

```static-timeline
{
  "zoom": 0.85,
  "ticks": 58,
  "trackHeight": 50,
  "stateBandOffset": 10,
  "servers": ["Coordinator", "DB-1", "DB-2", "DB-3"],
  "states": [
    { "server": "Coordinator", "start": 0,  "end": 8,  "state": "idle",        "color": "#8bc34a" },
    { "server": "Coordinator", "start": 9, "end": 20, "state": "collecting",  "color": "#ff9800" },
    { "server": "Coordinator", "start": 21, "end": 35, "state": "committing",  "color": "#2196f3" },
    { "server": "Coordinator", "start": 36, "end": 57, "state": "idle",        "color": "#8bc34a" },
    { "server": "DB-1",        "start": 0,  "end": 12, "state": "ready",       "color": "#b2dfdb" },
    { "server": "DB-1",        "start": 13, "end": 22, "state": "voted_commit","color": "#4db6ac" },
    { "server": "DB-1",        "start": 23, "end": 57, "state": "ready",       "color": "#b2dfdb" },
    { "server": "DB-2",        "start": 0,  "end": 14, "state": "ready",       "color": "#b2dfdb" },
    { "server": "DB-2",        "start": 15, "end": 24, "state": "voted_commit","color": "#4db6ac" },
    { "server": "DB-2",        "start": 25, "end": 57, "state": "ready",       "color": "#b2dfdb" },
    { "server": "DB-3",        "start": 0,  "end": 16, "state": "ready",       "color": "#b2dfdb" },
    { "server": "DB-3",        "start": 17, "end": 26, "state": "voted_commit","color": "#4db6ac" },
    { "server": "DB-3",        "start": 27, "end": 57, "state": "ready",       "color": "#b2dfdb" }
  ],
  "messages": [
    {"from": "Coordinator", "to": "DB-1", "sendTick": 9, "recvTick": 13},
    {"from": "Coordinator", "to": "DB-2", "sendTick": 10, "recvTick": 15},
    {"from": "Coordinator", "to": "DB-3", "sendTick": 11, "recvTick": 17},
    {"from": "DB-1", "to": "Coordinator", "sendTick": 14, "recvTick": 18},
    {"from": "DB-2", "to": "Coordinator", "sendTick": 16, "recvTick": 19},
    {"from": "DB-3", "to": "Coordinator", "sendTick": 18, "recvTick": 20},
    {"from": "Coordinator", "to": "DB-1", "sendTick": 21, "recvTick": 23},
    {"from": "Coordinator", "to": "DB-2", "sendTick": 22, "recvTick": 25},
    {"from": "Coordinator", "to": "DB-3", "sendTick": 23, "recvTick": 27}
  ]
}
```

---

# 2PC Execution


**Phase 2 — Commit or Abort**

- If **any** cohort votes abort → coordinator sends `ABORT` to all.
```static-timeline
{
  "zoom": 0.85,
  "ticks": 58,
  "trackHeight": 50,
  "stateBandOffset": 10,
  "servers": ["Coordinator", "DB-1", "DB-2", "DB-3"],
  "states": [
    { "server": "Coordinator", "start": 0,  "end": 8,  "state": "idle",        "color": "#8bc34a" },
    { "server": "Coordinator", "start": 9, "end": 20, "state": "collecting",  "color": "#ff9800" },
    { "server": "Coordinator", "start": 21, "end": 35, "state": "aborting",    "color": "#f44336" },
    { "server": "Coordinator", "start": 36, "end": 58, "state": "idle",        "color": "#8bc34a" },
    { "server": "DB-1",        "start": 0,  "end": 12, "state": "ready",       "color": "#b2dfdb" },
    { "server": "DB-1",        "start": 13, "end": 22, "state": "voted_commit","color": "#4db6ac" },
    { "server": "DB-1",        "start": 23, "end": 58, "state": "aborted",     "color": "#e0e0e0" },
    { "server": "DB-2",        "start": 0,  "end": 14, "state": "ready",       "color": "#b2dfdb" },
    { "server": "DB-2",        "start": 15, "end": 24, "state": "voted_abort", "color": "#ef5350" },
    { "server": "DB-2",        "start": 25, "end": 58, "state": "aborted",     "color": "#e0e0e0" },
    { "server": "DB-3",        "start": 0,  "end": 16, "state": "ready",       "color": "#b2dfdb" },
    { "server": "DB-3",        "start": 17, "end": 26, "state": "voted_commit","color": "#4db6ac" },
    { "server": "DB-3",        "start": 27, "end": 58, "state": "aborted",     "color": "#e0e0e0" }
  ],
  "messages": [
    {"from": "Coordinator", "to": "DB-1", "sendTick": 9, "recvTick": 13, "label": "PROPOSE"},
    {"from": "Coordinator", "to": "DB-2", "sendTick": 10, "recvTick": 15, "label": "PROPOSE"},
    {"from": "Coordinator", "to": "DB-3", "sendTick": 11, "recvTick": 17, "label": "PROPOSE"},
    {"from": "DB-1", "to": "Coordinator", "sendTick": 14, "recvTick": 18, "label": "VOTE_COMMIT"},
    {"from": "DB-2", "to": "Coordinator", "sendTick": 16, "recvTick": 19, "label": "VOTE_ABORT"},
    {"from": "DB-3", "to": "Coordinator", "sendTick": 18, "recvTick": 20, "label": "VOTE_COMMIT"},
    {"from": "Coordinator", "to": "DB-1", "sendTick": 21, "recvTick": 23, "label": "ABORT"},
    {"from": "Coordinator", "to": "DB-2", "sendTick": 22, "recvTick": 25, "label": "ABORT"},
    {"from": "Coordinator", "to": "DB-3", "sendTick": 23, "recvTick": 27, "label": "ABORT"}
  ]
}
```

- During each step, coordinator and cohorts **write results to durable storage** to enable crash recovery.

---

# 2PC Live Demo

The sandbox below shows a coordinator running two sequential 2PC rounds. Notice that:
- **TX 1** (odd txId): all three cohorts vote commit → full commit.
- **TX 2** (even txId): DB-2 is configured to reject even-numbered transactions → abort path fires, and all cohorts roll back.

<div class="callout-box">
    <h4>What to watch</h4>
    <p>Observe the Coordinator FSM cycling <b>idle → prepare → collecting → committing/aborting → idle</b>. When DB-2 sends VOTE_ABORT, the coordinator immediately broadcasts ABORT to all cohorts — even those that voted commit. That is the core atomicity guarantee of 2PC.</p>
</div>

<div style="text-align: center; margin-top: 40px; margin-bottom: 40px;">
    <button class="demo-btn" onclick="showDemo('demos/2pc/demo.json')" style="font-size: 1.5rem; padding: 15px 30px; background: #2196f3; color: white; border: none; border-radius: 6px; cursor: pointer;">
        Launch 2PC Demo
    </button>
</div>

---

# 2PC: Cohort Failures

**Scenario**: A cohort crashes before or after voting.

<div class="small-text">

- **Crash before voting** → Coordinator times out waiting for a vote → sends `ABORT` to all.
- **Crash after voting commit** → Cohort recovers and must learn the coordinator's decision before serving data. It sends a `DECISION_REQUEST` to the coordinator (or peers) and replays the commit or abort.

</div>

```static-timeline
{
  "zoom": 0.85,
  "ticks": 58,
  "trackHeight": 50,
  "stateBandOffset": 10,
  "servers": ["Coordinator", "DB-1", "DB-2 (crash)"],
  "states": [
    { "server": "Coordinator",  "start": 0,  "end": 9,  "state": "idle",       "color": "#8bc34a" },
    { "server": "Coordinator",  "start": 10, "end": 28, "state": "collecting", "color": "#ff9800" },
    { "server": "Coordinator",  "start": 29, "end": 40, "state": "aborting",   "color": "#f44336" },
    { "server": "Coordinator",  "start": 41, "end": 57, "state": "idle",       "color": "#8bc34a" },
    { "server": "DB-1",         "start": 0,  "end": 14, "state": "ready",      "color": "#b2dfdb" },
    { "server": "DB-1",         "start": 15, "end": 32, "state": "voted",      "color": "#4db6ac" },
    { "server": "DB-1",         "start": 33, "end": 57, "state": "aborted",    "color": "#b2dfdb" },
    { "server": "DB-2 (crash)", "start": 0,  "end": 19, "state": "ready",      "color": "#b2dfdb" },
    { "server": "DB-2 (crash)", "start": 20, "end": 34, "state": "CRASHED",    "color": "#f44336" },
    { "server": "DB-2 (crash)", "start": 35, "end": 44, "state": "recovering", "color": "#fff176" },
    { "server": "DB-2 (crash)", "start": 45, "end": 57, "state": "aborted",    "color": "#b2dfdb" }
  ],
  "messages": [
    {"from": "Coordinator",  "to": "DB-1",         "sendTick": 10, "recvTick": 15},
    {"from": "Coordinator",  "to": "DB-2 (crash)", "sendTick": 11, "recvTick": 20},
    {"from": "DB-1",         "to": "Coordinator",  "sendTick": 16, "recvTick": 21},
    {"from": "Coordinator",  "to": "DB-1",         "sendTick": 29, "recvTick": 33},
    {"from": "DB-2 (crash)", "to": "Coordinator",  "sendTick": 37, "recvTick": 41, "label": "DECISION_REQUEST"},
    {"from": "Coordinator",  "to": "DB-2 (crash)", "sendTick": 42, "recvTick": 45, "label": "ABORT"}
  ]
}
```

> This strict requirement—that **all participating nodes must be alive to commit a transaction**—hurts **availability**: Spanner and CockroachDB mitigate this by running 2PC over **Paxos groups** rather than individual nodes, so the protocol survives individual node failures within a group.

---

# 2PC: Coordinator Failures

**Scenario A**: Coordinator decides, but the link to one cohort fails.
- The cohort requests the decision from its **peers** (other cohorts). Replicating commit decisions is safe — if one cohort committed, all others must also commit.

**Scenario B**: Coordinator crashes ***while collecting votes***.
- Cohorts are stuck waiting indefinitely.
- Resolution: wait for coordinator recovery **or** elect a new coordinator and re-run the vote from scratch.

---

# 2PC Pros & Cons

| ✅ Advantages | ❌ Disadvantages |
|---|---|
| Simple to reason about, implement, debug | Requires proper coordinator crash-recovery mechanisms |
| Low message complexity (2 round-trips) | Cohorts block if coordinator crashes while collecting |
| Widely deployed (MySQL, PostgreSQL, MongoDB) | Cannot recover if **both** coordinator AND a cohort crash during commit phase |

> *If the coordinator crashes, cohorts run a **cooperative termination protocol**. If any cohort already received a decision, the others can safely adopt it. However, if **every** cohort is stuck in the 'voted' state—or if a cohort has also crashed, masking its state—the survivors are completely paralyzed. They cannot rule out the possibility that the dead coordinator durably committed before failing, so they must block indefinitely.*

---

# 2PC Recovery: Cooperative Termination

If the **Coordinator crashes** while cohorts are waiting in the `voted` state, cohorts can run a fallback polling protocol:

1. **Ask peers for their state**: A timed-out cohort broadcasts a state request to all other cohorts.
2. **If anyone aborted**: The transaction is globally doomed (requires unanimity). The panicked cohort safely aborts.
3. **If anyone committed**: The coordinator must have finalized the commit across the board before dying. The panicked cohort safely commits.
4. **If everyone is blocked**: If all surviving cohorts respond `voted`, **they are permanently paralyzed.** They cannot guess the dead coordinator's final durable decision (which could be commit *or* abort). 

> *In our 2PC demo, you can watch this visually! If the coordinator dies, cohorts flash orange **(`fallback` state)** as they frantically ask peers for help. If all cohorts are alive and blocked, they transition to grey **(`permanently_blocked`)** and silently wait forever. If a cohort is also dead, the survivors endlessly flash orange as they infinitely retry to communicate with the dead node!*

---

# Three-Phase Commit (3PC)

Even under **strong assumptions** about the network (synchronicity, no message loss), **2PC remains blocking**. Why? Because of the **State Ambiguity** problem:

In 2PC, the state `VOTED_YES` is ambiguous. If the coordinator crashes while you are waiting in that state, you have no way to know if it logged a `COMMIT` or an `ABORT` onto its private disk before dying. If the survivors erroneously "autonomous-abort" while the coordinator actually committed, **atomicity is broken**.

3PC solves this by splitting that one ambiguous state into two, inserting a **replicated decision buffer**.

| Phase | Coordinator Action | Cohort Knowledge | Safe Autonomous Action |
|---|---|---|---|
| **1. Propose** | Broadcasts `PROPOSE` | "I am voting `YES`" | **Abort** (Nobody committed) |
| **2. Prepare** | Broadcasts `PREPARE` | "**Everyone** voted `YES`" | **Abort** (Nobody committed yet) |
| **3. Commit** | Broadcasts `COMMIT` | "**Everyone** is prepared" | **Commit** (Nobody can abort now) |

---

# Why 3PC? The Decision Paradox

### ❌ The 2PC Dilemma
You voted `YES`. The Coordinator crashed. You ask your peers: they also voted `YES`. 
**Can you commit?** No. The Coordinator might have crashed *after* deciding `ABORT` locally.
**Can you abort?** No. The Coordinator might have crashed *after* deciding `COMMIT` locally.
Result: **Paralysis.**

### ✅ The 3PC Solution
By adding the `PREPARE` round-trip, we ensure that:
1.  **No node commits** unless *every* node has received a `PREPARE` message.
2.  **No node receives a `PREPARE`** if *any* node voted `NO`.

This means if you time out while in the `PREPARED` state, you possess **proof** that every other cohort is at least in the `VOTED` state and none of them could have voted `NO`. It is now mathematically safe to autonomous-commit.

---

# 3PC Live Demo

The sandbox shows the three-phase handshake: `PROPOSE → VOTE → PREPARE → ACK → COMMIT`. Notice the extra round-trip compared to 2PC.

<div class="callout-box">
    <h4>What to watch</h4>
    <p>Compare the FSM states to the 2PC demo. The coordinator passes through <b>propose → collect_votes → prepare → wait_acks → committing</b>. Cohorts pass through an extra <b>prepared</b> state between voted_commit and idle. This prepared state is what enables cohorts to commit autonomously after a timeout — the key non-blocking property.</p>
</div>

<div style="text-align: center; margin-top: 40px; margin-bottom: 40px;">
    <button class="demo-btn" onclick="showDemo('demos/3pc/demo.json')" style="font-size: 1.5rem; padding: 15px 30px; background: #2196f3; color: white; border: none; border-radius: 6px; cursor: pointer;">
        Launch 3PC Demo
    </button>
</div>

---

# 3PC: Coordinator Failures & The Split-Brain Problem

**The advantage over 2PC**: Cohorts are never permanently blocked. If the coordinator fails during the commit phase, cohorts in the `prepared` state know every participant voted commit, so they can safely auto-commit after a timeout.

**The critical design flaw — network partitions**:

If a network partition splits the cluster during the prepare phase:
- Nodes that received PREPARE → time out → **commit**.
- Nodes that never received PREPARE → time out → **abort**.

This results in a **split-brain**: some nodes committed while others aborted, leaving the system in an irreconcilable, contradictory state — all according to the protocol.

---

# 3PC Pros & Cons

| ✅ Advantages | ❌ Disadvantages |
|---|---|
| Solves 2PC coordinator-crash blocking | Larger message overhead (3 round-trips) |
| Cohorts can commit autonomously after timeout | Dangerous under network partitions (split-brain) |
| — | Not widely used in practice for this reason |

---

# Database Partitioning

Storing all records on a single node is unrealistic for most modern applications. **Partitioning** divides data into smaller, manageable segments.

**Sharding**: each replica set acts as the sole authoritative source for a **subset** of data. Clients or query coordinators route requests using a **routing key** to the correct shard.

To use partitions effectively:
- Size partitions based on **load and value distribution**.
- When nodes are added/removed, the database must **repartition** — ideally relocating data *before* updating routing metadata.
- Some databases perform **auto-sharding**: dynamic placement algorithms using read/write load and data volume metrics.

---

# The Hash-Mod Problem

A naive strategy: `node = hash(key) mod N`

When `N` changes (a node is added or removed):
- Most keys map to a **different** node.
- A massive data migration is required — proportional to the entire dataset.

---

# Consistent Hashing

<div style="display: flex; align-items: flex-start; gap: 30px;">
<div style="flex: 1;">

**Consistent hashing** solves the hash-mod problem with minimal key migration when the cluster size changes.

**The idea**: map both keys and nodes onto the same large virtual ring of size $M \gg N$.

$$
  \text{owner} = \text{first node clockwise from } \textbf{hash}(\text{key}) \mod M
$$

When a node is **added**: only the keys between its predecessor and its new position migrate — a fraction of $1/N$ of all keys.

When a node is **removed**: only its keys move to its successor — again, roughly $1/N$.

</div>
<div style="width: 400px; flex-shrink: 0; background: rgba(255,255,255,0.03); padding: 10px; border-radius: 15px; border: 1px solid rgba(255,255,255,0.1);">

<svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
  <!-- The Ring -->
  <circle cx="200" cy="200" r="150" fill="none" stroke="var(--accent-color, rgba(255,0,255,0.8))" stroke-width="2" stroke-dasharray="8,4" />

  <!-- Server Nodes (Primitives) -->
  <!-- Server A -->
  <rect x="170" y="30" width="60" height="30" rx="6" fill="#4caf50" />
  <text x="200" y="50" text-anchor="middle" fill="white" font-size="12" font-weight="bold" font-family="Inter, sans-serif">Node A</text>
  
  <!-- Server B -->
  <rect x="320" y="185" width="60" height="30" rx="6" fill="#2196f3" />
  <text x="350" y="205" text-anchor="middle" fill="white" font-size="12" font-weight="bold" font-family="Inter, sans-serif">Node B</text>
  
  <!-- Server C -->
  <rect x="170" y="340" width="60" height="30" rx="6" fill="#ff9800" />
  <text x="200" y="360" text-anchor="middle" fill="white" font-size="12" font-weight="bold" font-family="Inter, sans-serif">Node C</text>
  
  <!-- Server D -->
  <rect x="20" y="185" width="60" height="30" rx="6" fill="#f44336" />
  <text x="50" y="205" text-anchor="middle" fill="white" font-size="12" font-weight="bold" font-family="Inter, sans-serif">Node D</text>

  <!-- Keys (Hash Results) -->
  <!-- K1 maps to B -->
  <circle cx="290" cy="90" r="6" fill="#fff" stroke="#333" stroke-width="1" />
  <text x="305" y="85" fill="#aaa" font-size="10" font-family="Inter, sans-serif">k1</text>
  <path d="M 295 95 Q 320 120 340 180" fill="none" stroke="rgba(33, 150, 243, 0.5)" stroke-width="2" stroke-dasharray="4,2" marker-end="url(#arrowhead)" />
  
  <!-- K2 maps to C -->
  <circle cx="290" cy="310" r="6" fill="#fff" stroke="#333" stroke-width="1" />
  <text x="305" y="325" fill="#aaa" font-size="10" font-family="Inter, sans-serif">k2</text>
  <path d="M 290 316 Q 270 340 235 350" fill="none" stroke="rgba(255, 152, 0, 0.5)" stroke-width="2" stroke-dasharray="4,2" marker-end="url(#arrowhead)" />

  <!-- K3 maps to A -->
  <circle cx="60" cy="90" r="6" fill="#fff" stroke="#333" stroke-width="1" />
  <text x="45" y="85" fill="#aaa" font-size="10" font-family="Inter, sans-serif">k3</text>
  <path d="M 65 85 Q 100 50 165 45" fill="none" stroke="rgba(76, 175, 80, 0.5)" stroke-width="2" stroke-dasharray="4,2" marker-end="url(#arrowhead)" />

  <!-- Definitions for arrows -->
  <defs>
    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="rgba(255,255,255,0.4)" />
    </marker>
  </defs>
</svg>

</div>
</div>

---

# Consistent Hashing: Interactive Ring

<p style="font-size: 0.85rem; color: #aaa; margin-bottom: -15px;">Sandbox with 1,000 keys. Click <b>Add Server</b> to observe the <b>minimal-disruption</b> guarantee: only a small fraction of keys (red) migrate to the new server. The <b>Gap-Aware</b> placement algorithm ensures balanced distribution. <i>Note: In production (e.g. Dynamo), these "servers" can be virtual units to balance load.</i></p>

<iframe src="demos/consistent-hashing-ring/index.html" style="width: 100%; height: 500px; border: none; border-radius: 12px; margin-top: 20px;"></iframe>

---

# Snapshot Isolation

When **serializability is not required**, applications can avoid write anomalies by using **Snapshot Isolation (SI)**.

Under SI, all reads within a transaction see a **consistent snapshot** taken at the transaction's start timestamp. Committed values from that snapshot cannot change. For write conflicts, **first committer wins**.

✅ SI prevents **read skew** and ensures repeatable reads of committed data.

---

# Read Skew (prevented by SI)

```static-timeline
{
  "zoom": 0.85,
  "ticks": 58,
  "trackHeight": 64,
  "stateBandOffset": 10,
  "servers": ["Reader", "DB", "Writer"],
  "states": [
    { "server": "DB", "start": 0, "end": 22, "state": "A=100\nB=100", "color": "#e0e0e0" },
    { "server": "DB", "start": 23, "end": 36, "state": "A=80\nB=100", "color": "#ffb74d" },
    { "server": "DB", "start": 37, "end": 49, "state": "A=80\nB=120", "color": "#ffb74d" },
    { "server": "DB", "start": 50, "end": 57, "state": "A+B=200", "color": "#ef5350" },
    { "server": "Reader", "start": 2, "end": 10, "state": "Read A", "color": "#81c784" },
    { "server": "Reader", "start": 11, "end": 40, "state": "A = 100", "color": "#81c784" },
    { "server": "Reader", "start": 41, "end": 49, "state": "A = 100\nRead B", "color": "#81c784" },
    { "server": "Reader", "start": 50, "end": 57, "state": "A + B = 220 ❌", "color": "#ef5350" },
    { "server": "Writer", "start": 15, "end": 26, "state": "write A <- 80", "color": "#4fc3f7" },
    { "server": "Writer", "start": 30, "end": 40, "state": "write B <- 120", "color": "#4fc3f7" }
  ],
  "messages": [
    { "from": "Reader", "to": "DB", "sendTick": 3, "recvTick": 6, "label": "Read A" },
    { "from": "DB", "to": "Reader", "sendTick": 8, "recvTick": 11, "label": "A=100" },
    { "from": "Writer", "to": "DB", "sendTick": 19, "recvTick": 23, "label": "Set A=80" },
    { "from": "Writer", "to": "DB", "sendTick": 33, "recvTick": 37, "label": "Set B=120" },
    { "from": "Reader", "to": "DB", "sendTick": 41, "recvTick": 44, "label": "Read B" },
    { "from": "DB", "to": "Reader", "sendTick": 46, "recvTick": 49, "label": "B=120" }
  ]
}
```

*(T1 reads A=100, then T2 transfers 20 dollars from A to B and commits. Finally, T1 reads B=120. T1 sees a total of 220, violating the invariant that the total must be 200. SI prevents this by ensuring T1 only sees the state at its start time.)*

---

# Write Skew

SI does **not** prevent **write skew**: a situation where each transaction individually respects invariants, but their combined effect does not.

```static-timeline
{
  "zoom": 0.85,
  "ticks": 50,
  "trackHeight": 64,
  "stateBandOffset": 10,
  "servers": ["Doctors Status", "D1", "D2"],
  "states": [
    { "server": "Doctors Status", "start": 0, "end": 25, "state": "D1: On\nD2: On", "color": "#e0e0e0" },
    { "server": "Doctors Status", "start": 26, "end": 38, "state": "D1: Off\nD2: On", "color": "#ffb74d" },
    { "server": "Doctors Status", "start": 39, "end": 50, "state": "D1: Off\nD2: Off", "color": "#ef5350" },
    { "server": "D1", "start": 5, "end": 18, "state": "Read D2 Status", "color": "#81c784" },
    { "server": "D1", "start": 21, "end": 26, "state": "D1 → Off", "color": "#ffb74d" },
    { "server": "D2", "start": 6, "end": 20, "state": "Read D1 Status", "color": "#4fc3f7" },
    { "server": "D2", "start": 34, "end": 39, "state": "D2 → Off", "color": "#ffb74d" }
  ],
  "messages": [
    { "from": "D1", "to": "Doctors Status", "sendTick": 7, "recvTick": 11 },
    { "from": "Doctors Status", "to": "D1", "sendTick": 14, "recvTick": 18 },
    { "from": "D2", "to": "Doctors Status", "sendTick": 8, "recvTick": 12 },
    { "from": "Doctors Status", "to": "D2", "sendTick": 16, "recvTick": 20 },
    { "from": "D1", "to": "Doctors Status", "sendTick": 21, "recvTick": 26 },
    { "from": "D2", "to": "Doctors Status", "sendTick": 34, "recvTick": 39 }
  ]
}
```

*(**Invariant**: At least one doctor is on call at any time. Both transactions read a valid snapshot seeing the other doctor 'On Call', so they can go home. But after they write 'Off', the combined result is [Off, Off] — zero doctors are on call, a violation of the global invariant. This is **Write Skew**.)*

---

# Coordination Avoidance

The need for **coordination** can be completely eliminated when the operations that transactions perform are **invariant confluent** (I-Confluent).

**Invariant Confluence**: Two invariant-valid but diverged database states **can always be merged** into a single, valid final state — no coordination required.

Because any two valid states can be safely merged, **I-Confluent** operations improve scalability dramatically by removing cross-partition synchronization.

---

# Requirements for Coordination-Free Systems

<small>

| Property | Description |
|---|---|
| **Global Validity** | Invariants are satisfied for both merged and divergent committed states |
| **Availability** | Transactions reach a commit or abort decision if all holding nodes are reachable |
| **Convergence** | Without new transactions or permanent partitions, all nodes reach the same state |
| **Coordination Freedom** | Local execution is independent of concurrent operations on other nodes |

</small>

# Summary: Transaction Foundations

<small>

| Protocol | Key Idea | Main Trade-off |
|---|---|---|
| **2PC** | Coordinator-driven two-round commit | Blocks if coordinator crashes mid-vote |
| **3PC** | Extra prepare phase with timeouts | Split-brain under network partitions |

</small>

---

# Concluding Thoughts

Every distributed transaction protocol is a **trade-off negotiation** between:

- **Consistency** — how precisely do all nodes agree on the outcome?
- **Availability** — can the system proceed when participants crash or partitions form?
- **Performance** — how many round-trips, locks, and disk syncs does the protocol require?

> **Ask yourself**: does your application actually need *serializable* distributed transactions, or can it tolerate a relaxed model like snapshot isolation or read-atomic? The further you can relax the consistency requirement, the less coordination — and less performance cost — your system demands.

Modern databases don't pick one model and stop. Google Spanner, CockroachDB, and TiDB all layer multiple mechanisms: **Paxos for log replication**, **2PC for cross-shard coordination**, and **MVCC for lock-free reads** — each operating at its appropriate granularity.
