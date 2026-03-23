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

A history is **serializable** if it is equivalent to some **sequential** history — one where transactions execute one after another, without overlap.

```static-timeline
{
  "zoom": 0.85,
  "ticks": 58,
  "trackHeight": 50,
  "stateBandOffset": 10,
  "servers": ["T1: Transfer", "T2: Report"],
  "states": [
    { "server": "T1: Transfer", "start": 3, "end": 28, "state": "read A, write A, write B", "color": "#ffb74d" },
    { "server": "T2: Report",   "start": 10, "end": 45, "state": "read A, read B, compute sum", "color": "#81c784" }
  ],
  "messages": [
    {"from": "T1: Transfer", "to": "T2: Report", "sendTick": 15, "recvTick": 22, "label": "conflict?"}
  ]
}
```

*(T1 and T2 overlap. A serializable history means the result must be equivalent to either T1→T2 or T2→T1 executing fully before the other.)*

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
1. Coordinator sends a **PROPOSE** message to all cohorts.
2. Each cohort decides if it can commit its local portion of the transaction.
3. Cohorts reply with `VOTE_COMMIT` or `VOTE_ABORT`.

**Phase 2 — Commit or Abort**
- If **all** cohorts vote commit → coordinator sends `COMMIT` to all.
- If **any** cohort votes abort → coordinator sends `ABORT` to all.

```static-timeline
{
  "zoom": 0.85,
  "ticks": 70,
  "trackHeight": 50,
  "stateBandOffset": 10,
  "servers": ["Coordinator", "DB-1", "DB-2", "DB-3"],
  "states": [
    { "server": "Coordinator", "start": 0,  "end": 9,  "state": "idle",        "color": "#8bc34a" },
    { "server": "Coordinator", "start": 10, "end": 24, "state": "collecting",  "color": "#ff9800" },
    { "server": "Coordinator", "start": 25, "end": 35, "state": "committing",  "color": "#2196f3" },
    { "server": "Coordinator", "start": 36, "end": 70, "state": "idle",        "color": "#8bc34a" },
    { "server": "DB-1",        "start": 0,  "end": 14, "state": "ready",       "color": "#b2dfdb" },
    { "server": "DB-1",        "start": 15, "end": 28, "state": "voted_commit","color": "#4db6ac" },
    { "server": "DB-1",        "start": 29, "end": 70, "state": "ready",       "color": "#b2dfdb" },
    { "server": "DB-2",        "start": 0,  "end": 17, "state": "ready",       "color": "#b2dfdb" },
    { "server": "DB-2",        "start": 18, "end": 30, "state": "voted_commit","color": "#4db6ac" },
    { "server": "DB-2",        "start": 31, "end": 70, "state": "ready",       "color": "#b2dfdb" },
    { "server": "DB-3",        "start": 0,  "end": 19, "state": "ready",       "color": "#b2dfdb" },
    { "server": "DB-3",        "start": 20, "end": 33, "state": "voted_commit","color": "#4db6ac" },
    { "server": "DB-3",        "start": 34, "end": 70, "state": "ready",       "color": "#b2dfdb" }
  ],
  "messages": [
    {"from": "Coordinator", "to": "DB-1", "sendTick": 10, "recvTick": 15},
    {"from": "Coordinator", "to": "DB-2", "sendTick": 11, "recvTick": 17},
    {"from": "Coordinator", "to": "DB-3", "sendTick": 12, "recvTick": 19},
    {"from": "DB-1", "to": "Coordinator", "sendTick": 16, "recvTick": 21},
    {"from": "DB-2", "to": "Coordinator", "sendTick": 18, "recvTick": 23},
    {"from": "DB-3", "to": "Coordinator", "sendTick": 20, "recvTick": 24},
    {"from": "Coordinator", "to": "DB-1", "sendTick": 25, "recvTick": 29},
    {"from": "Coordinator", "to": "DB-2", "sendTick": 26, "recvTick": 31},
    {"from": "Coordinator", "to": "DB-3", "sendTick": 27, "recvTick": 34}
  ]
}
```

During each step, coordinator and cohorts **write results to durable storage** to enable crash recovery.

---

# 2PC Live Demo

The sandbox below shows a coordinator running two sequential 2PC rounds. Notice that:
- **TX 1** (odd txId): all three cohorts vote commit → full commit.
- **TX 2** (even txId): DB-2 is configured to reject even-numbered transactions → abort path fires, and all cohorts roll back.

<div style="background: #222; padding: 20px; border-radius: 8px; margin-top: 20px;">
    <h4 style="margin-top: 0; color: #ff9800;">What to watch</h4>
    <p style="font-size: 1.1rem;">Observe the Coordinator FSM cycling <b>idle → prepare → collecting → committing/aborting → idle</b>. When DB-2 sends VOTE_ABORT, the coordinator immediately broadcasts ABORT to all cohorts — even those that voted commit. That is the core atomicity guarantee of 2PC.</p>
</div>

<div style="text-align: center; margin-top: 40px; margin-bottom: 40px;">
    <button class="demo-btn" onclick="showDemo('demos/2pc/demo.json')" style="font-size: 1.5rem; padding: 15px 30px; background: #2196f3; color: white; border: none; border-radius: 6px; cursor: pointer;">
        Launch 2PC Demo
    </button>
</div>

---

# 2PC: Cohort Failures

**Scenario**: A cohort crashes before or after voting.

- **Crash before voting** → Coordinator times out waiting for a vote → sends `ABORT` to all.
- **Crash after voting commit** → Cohort recovers and must learn the coordinator's decision before serving data. It sends a `DECISION_REQUEST` to the coordinator (or peers) and replays the commit or abort.

```static-timeline
{
  "zoom": 0.85,
  "ticks": 70,
  "trackHeight": 50,
  "stateBandOffset": 10,
  "servers": ["Coordinator", "DB-1", "DB-2 (crash)"],
  "states": [
    { "server": "Coordinator",  "start": 0,  "end": 9,  "state": "idle",       "color": "#8bc34a" },
    { "server": "Coordinator",  "start": 10, "end": 28, "state": "collecting", "color": "#ff9800" },
    { "server": "Coordinator",  "start": 29, "end": 40, "state": "aborting",   "color": "#f44336" },
    { "server": "Coordinator",  "start": 41, "end": 70, "state": "idle",       "color": "#8bc34a" },
    { "server": "DB-1",         "start": 0,  "end": 14, "state": "ready",      "color": "#b2dfdb" },
    { "server": "DB-1",         "start": 15, "end": 32, "state": "voted",      "color": "#4db6ac" },
    { "server": "DB-1",         "start": 33, "end": 70, "state": "aborted",    "color": "#b2dfdb" },
    { "server": "DB-2 (crash)", "start": 0,  "end": 19, "state": "ready",      "color": "#b2dfdb" },
    { "server": "DB-2 (crash)", "start": 20, "end": 34, "state": "CRASHED",    "color": "#f44336" },
    { "server": "DB-2 (crash)", "start": 35, "end": 44, "state": "recovering", "color": "#fff176" },
    { "server": "DB-2 (crash)", "start": 45, "end": 70, "state": "aborted",    "color": "#b2dfdb" }
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

> This requirement hurts **availability**: Spanner and CockroachDB mitigate this by running 2PC over **Paxos groups** rather than individual nodes, so the protocol survives individual node failures within a group.

---

# 2PC: Coordinator Failures

**Scenario A**: Coordinator decides, but the link to one cohort fails.
- The cohort requests the decision from its **peers** (other cohorts). Replicating commit decisions is safe — if one cohort committed, all others must also commit.

**Scenario B**: Coordinator crashes ***while collecting votes***.
- Cohorts are stuck waiting indefinitely.
- Resolution: wait for coordinator recovery **or** elect a new coordinator and re-run the vote from scratch.

### 2PC Pros & Cons

| ✅ Advantages | ❌ Disadvantages |
|---|---|
| Simple to reason about, implement, debug | Requires proper coordinator crash-recovery mechanisms |
| Low message complexity (2 round-trips) | Cohorts block if coordinator crashes while collecting |
| Widely deployed (MySQL, PostgreSQL, MongoDB) | Cannot recover if **both** coordinator AND a cohort crash during commit phase |

> *If both crash simultaneously, the fate of the transaction becomes permanently unknown.*

---

# Three-Phase Commit (3PC)

3PC adds an **extra intermediate phase** between voting and committing, plus **timeouts on both sides** that allow cohorts to proceed autonomously if the coordinator fails.

**Key assumption**: 3PC requires a synchronous model and assumes no message loss (communication failures aren't possible). This means it is primarily used in controlled LAN environments.

| Phase | Who Acts | What Happens |
|---|---|---|
| **Propose** | Coordinator | Sends proposed value, collects votes |
| **Prepare** | Coordinator | If all commit: sends PREPARE. If any abort: sends ABORT immediately. |
| **Commit** | Coordinator | Sends COMMIT after all cohorts ACK the PREPARE |

### Timeout Rules

| Phase of Failure | Action |
|---|---|
| Propose phase (coordinator or cohort timeout) | **Abort** |
| Prepare phase (coordinator or cohort timeout) | **Abort** |
| Commit phase (coordinator or cohort timeout) | **Commit** |

> *The key insight: once a cohort enters the **prepared** state, it knows that all other cohorts have voted commit. It is now safe to commit unilaterally after a timeout — no cohort that voted abort can ever be in the prepared state.*

---

# 3PC Live Demo

The sandbox shows the three-phase handshake: `PROPOSE → VOTE → PREPARE → ACK → COMMIT`. Notice the extra round-trip compared to 2PC.

<div style="background: #222; padding: 20px; border-radius: 8px; margin-top: 20px;">
    <h4 style="margin-top: 0; color: #ff9800;">What to watch</h4>
    <p style="font-size: 1.1rem;">Compare the FSM states to the 2PC demo. The coordinator passes through <b>propose → collect_votes → prepare → wait_acks → committing</b>. Cohorts pass through an extra <b>prepared</b> state between voted_commit and idle. This prepared state is what enables cohorts to commit autonomously after a timeout — the key non-blocking property.</p>
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

### 3PC Pros & Cons

| ✅ Advantages | ❌ Disadvantages |
|---|---|
| Solves 2PC coordinator-crash blocking | Larger message overhead (3 round-trips) |
| Cohorts can commit autonomously after timeout | Dangerous under network partitions (split-brain) |
| — | Not widely used in practice for this reason |

---

# Distributed Transactions: Calvin

**Problem**: Minimize the total time transactions hold locks by agreeing on execution order *before* acquiring locks.

Calvin uses a **deterministic transaction order**: all replicas receive the same input sequence and produce identical outputs — eliminating the need for distributed locking or cross-replica coordination during execution.

```static-timeline
{
  "zoom": 0.85,
  "ticks": 72,
  "trackHeight": 48,
  "stateBandOffset": 10,
  "servers": ["Sequencer", "Scheduler", "Worker", "Storage"],
  "states": [
    { "server": "Sequencer",  "start": 2,  "end": 18, "state": "epoch: batch TXs", "color": "#ce93d8" },
    { "server": "Sequencer",  "start": 19, "end": 32, "state": "replicate batch",   "color": "#ab47bc" },
    { "server": "Scheduler",  "start": 25, "end": 42, "state": "deterministic plan","color": "#4fc3f7" },
    { "server": "Worker",     "start": 38, "end": 58, "state": "collect read sets", "color": "#ffb74d" },
    { "server": "Worker",     "start": 59, "end": 70, "state": "execute & persist", "color": "#81c784" },
    { "server": "Storage",    "start": 62, "end": 72, "state": "committed",         "color": "#a5d6a7" }
  ],
  "messages": [
    {"from": "Sequencer",  "to": "Scheduler", "sendTick": 20, "recvTick": 25},
    {"from": "Scheduler",  "to": "Worker",    "sendTick": 39, "recvTick": 43},
    {"from": "Worker",     "to": "Storage",   "sendTick": 60, "recvTick": 62}
  ]
}
```

| Component | Responsibility |
|---|---|
| **Sequencer** | Establishes global transaction order; batches into time-window epochs and replicates them |
| **Scheduler** | Executes parts of transactions in parallel, preserving the serial order from the sequencer |
| **Worker** | Analyzes read/write sets; collects needed data records from remote nodes; executes locally |

> *Because all replicas receive the same inputs, they don't need to forward results to each other — they compute identical outputs independently.*

**Used by**: FaunaDB | **Constraint**: Read and write sets must be known upfront; dynamic queries require workarounds.

<div style="background: #222; padding: 20px; border-radius: 8px; margin-top: 20px;">
    <h4 style="margin-top: 0; color: #ff9800;">What to watch</h4>
    <p style="font-size: 1.1rem;">The Sequencer batches transactions into epochs every 25 ticks and broadcasts them to the Scheduler. The Scheduler splits each epoch between <b>Worker-A</b> (keys A, B) and <b>Worker-B</b> (keys C, D) by write-set. Both workers execute in parallel — observe that they never send messages to each other. This is the core Calvin insight: deterministic order removes the need for distributed coordination during execution.</p>
</div>

<div style="text-align: center; margin-top: 30px; margin-bottom: 40px;">
    <button class="demo-btn" onclick="showDemo('demos/calvin-sequencer/demo.json')" style="font-size: 1.5rem; padding: 15px 30px; background: #7b1fa2; color: white; border: none; border-radius: 6px; cursor: pointer;">
        Launch Calvin Demo
    </button>
</div>

---

# Distributed Transactions: Spanner

Google **Spanner** (also CockroachDB, YugaByte DB) takes a contrasting approach: **per-shard consensus with 2PC across shards**.

**Key Ingredients**:
- **Paxos groups** per partition (shard). Each group has a long-lived leader.
- **TrueTime** — a high-precision wall-clock API exposing an uncertainty bound. Allows introducing controlled delays so timestamps are guaranteed to be globally ordered.
- **2PC across group leaders** for multi-shard transactions.

### Spanner Operation Types

| Type | Locks? | Leader Required? |
|---|---|---|
| Read-write transaction | Yes (2PL) | Yes |
| Read-only transaction | No | No — any up-to-date replica |
| Snapshot read | No | Only for latest timestamp |

> *Each data record carries a commit timestamp. Multiple timestamped versions can coexist, making snapshot reads lock-free.*

**External consistency**: If transaction T1 commits before T2 starts, T1's timestamp is strictly less than T2's — even across shards.

---

# Calvin vs. Spanner

| Property | Calvin | Spanner |
|---|---|---|
| Consensus scope | Global (single sequencer) | Per-shard (decentralized) |
| Distributed commit | Deterministic ordering | Two-phase commit |
| Query model | NoSQL only (pre-declared read/write sets) | Full SQL |
| Real-world systems | FaunaDB | CockroachDB, YugaByte DB |
| **Read performance** | High latency / lower throughput | Low latency / high throughput |
| **Write — distributed TX** | Low latency / high throughput for contended data | Low latency only for single-shard TX |
| **Fault tolerance** | Leader failure impacts all data | Failure impacts subset of data |
| Clock skew | No problem | Requires TrueTime |
| License | Proprietary | Open-source |

---

# Database Partitioning

Storing all records on a single node is unrealistic for most modern applications. **Partitioning** divides data into smaller, manageable segments.

**Sharding**: each replica set acts as the sole authoritative source for a **subset** of data. Clients or query coordinators route requests using a **routing key** to the correct shard.

To use partitions effectively:
- Size partitions based on **load and value distribution**.
- When nodes are added/removed, the database must **repartition** — ideally relocating data *before* updating routing metadata.
- Some databases perform **auto-sharding**: dynamic placement algorithms using read/write load and data volume metrics.

### The Hash-Mod Problem

A naive strategy: `node = hash(key) mod N`

When `N` changes (a node is added or removed):
- Most keys map to a **different** node.
- A massive data migration is required — proportional to the entire dataset.

---

# Consistent Hashing

**Consistent hashing** solves the hash-mod problem with minimal key migration when the cluster size changes.

**The idea**: map both keys and nodes onto the same large virtual ring of size $M \gg N$.

$$\text{owner} = \text{first node clockwise from } \text{hash}(\text{key}) \mod M$$

When a node is **added**: only the keys between its predecessor and its new position migrate — a fraction of $1/N$ of all keys.

When a node is **removed**: only its keys move to its successor — again, roughly $1/N$.

<center>
<img src="https://miro.medium.com/max/828/1*YUc0c0oOM-OzQDLHj48yYg.png" style="background-color: white; padding: 16px; border-radius: 10px; max-width: 70%; margin-top: 16px;">
</center>

---

# Consistent Hashing Live Demo

The sandbox visualizes a 4-node consistent hashing ring. At tick 30, a **virtual node joins** at ring position 500. At tick 70, it **leaves** and key ownership shifts back.

<div style="background: #222; padding: 20px; border-radius: 8px; margin-top: 20px;">
    <h4 style="margin-top: 0; color: #ff9800;">What to watch</h4>
    <p style="font-size: 1.1rem;">Observe the <b>myRange</b> field on each node as the virtual node joins and leaves. Only nodes adjacent to the newcomer on the ring need to update their ranges. The other nodes are completely unaffected — this is the minimal-disruption guarantee of consistent hashing.</p>
</div>

<div style="text-align: center; margin-top: 40px; margin-bottom: 40px;">
    <button class="demo-btn" onclick="showDemo('demos/consistent-hashing/demo.json')" style="font-size: 1.5rem; padding: 15px 30px; background: #2196f3; color: white; border: none; border-radius: 6px; cursor: pointer;">
        Launch Consistent Hashing Demo
    </button>
</div>

---

# Snapshot Isolation

When **serializability is not required**, applications can avoid write anomalies by using **Snapshot Isolation (SI)**.

Under SI, all reads within a transaction see a **consistent snapshot** taken at the transaction's start timestamp. Committed values from that snapshot cannot change. For write conflicts, **first committer wins**.

✅ SI prevents **read skew** and ensures repeatable reads of committed data.

### Read Skew (prevented by SI)

```static-timeline
{
  "zoom": 0.85,
  "ticks": 64,
  "trackHeight": 48,
  "stateBandOffset": 10,
  "servers": ["T1: Auditor", "T2: Transfer", "A1 (50$)", "A2 (50$)"],
  "states": [
    { "server": "A1 (50$)",     "start": 0,  "end": 35, "state": "50$",            "color": "#e0e0e0" },
    { "server": "A1 (50$)",     "start": 36, "end": 64, "state": "30$",            "color": "#ffb74d" },
    { "server": "A2 (50$)",     "start": 0,  "end": 44, "state": "50$",            "color": "#e0e0e0" },
    { "server": "A2 (50$)",     "start": 45, "end": 64, "state": "70$",            "color": "#ffb74d" },
    { "server": "T1: Auditor",  "start": 3,  "end": 20, "state": "read A1=50$",    "color": "#81c784" },
    { "server": "T1: Auditor",  "start": 46, "end": 60, "state": "read A2=70$ ❌", "color": "#ef5350" },
    { "server": "T2: Transfer", "start": 25, "end": 46, "state": "move 20$: A1→A2","color": "#4fc3f7" }
  ],
  "messages": [
    {"from": "T2: Transfer", "to": "A1 (50$)", "sendTick": 28, "recvTick": 36},
    {"from": "T2: Transfer", "to": "A2 (50$)", "sendTick": 38, "recvTick": 45}
  ]
}
```

*(T1 reads A1=50 before the transfer, then reads A2=70 after T2 committed. It now sees A1+A2=120 — the invariant is violated. SI prevents this by fixing T1's snapshot at start.)*

---

# Write Skew

SI does **not** prevent **write skew**: a situation where each transaction individually respects invariants, but their combined effect does not.

```static-timeline
{
  "zoom": 0.85,
  "ticks": 64,
  "trackHeight": 48,
  "stateBandOffset": 10,
  "servers": ["T1: Withdraw A1", "T2: Withdraw A2", "A1 (100$)", "A2 (150$)"],
  "states": [
    { "server": "A1 (100$)",       "start": 0,  "end": 44, "state": "100$",             "color": "#e0e0e0" },
    { "server": "A1 (100$)",       "start": 45, "end": 64, "state": "-100$",            "color": "#ef5350" },
    { "server": "A2 (150$)",       "start": 0,  "end": 50, "state": "150$",             "color": "#e0e0e0" },
    { "server": "A2 (150$)",       "start": 51, "end": 64, "state": "-50$",             "color": "#ef5350" },
    { "server": "T1: Withdraw A1", "start": 5,  "end": 20, "state": "read sum=250 ✅",  "color": "#81c784" },
    { "server": "T1: Withdraw A1", "start": 24, "end": 45, "state": "write A1=-100$",   "color": "#ffb74d" },
    { "server": "T2: Withdraw A2", "start": 8,  "end": 22, "state": "read sum=250 ✅",  "color": "#81c784" },
    { "server": "T2: Withdraw A2", "start": 30, "end": 51, "state": "write A2=-50$",    "color": "#ffb74d" }
  ]
}
```

*(Both T1 and T2 read a valid sum at snapshot time. Each writes only its own account. Individually, both find the invariant satisfied. Combined: A1+A2 = -150$ < 0 — constraint violated.)*

---

# Percolator: Transactional API on Bigtable

**Percolator** implements snapshot isolation on top of **Bigtable** using a client-driven two-phase commit. Each transaction consults a **timestamp oracle** (globally monotonic clock) twice: once at start, once at commit.

| Column | Purpose |
|---|---|
| **Data** | Actual record payload |
| **Locks** | Tracks lock holder (one is designated *primary*) |
| **Write metadata** | Points to the latest committed data timestamp |

### Percolator Commit Flow

**Phase 1 — Prewrite**: Acquire locks on all cells to be written. The primary lock is set first. If any conflict is detected → abort.

**Phase 2 — Commit**: Starting with the primary lock, replace locks with write records. Publish changes by updating write metadata to point at the new data timestamp.

> *Only one transaction can hold a lock at a time, and all state transitions use conditional mutations (atomic read-modify-write in a single RPC). This eliminates race conditions without a distributed lock manager.*

**Used by**: TiDB (Titanium DB — MySQL-compatible, strongly consistent, horizontally scalable)

---

# Percolator: State Walk-Through

**Initial state** (after previous transaction at timestamp 0):

| Account | Timestamp | Data | Lock | Write Metadata |
|---|---|---|---|---|
| A1 | 1 | 100$ | — | latest @ t=0 |
| A2 | 1 | 200$ | — | latest @ t=0 |

**After Prewrite** (new transaction, start timestamp = 1):

| Account | Timestamp | Data | Lock | Write Metadata |
|---|---|---|---|---|
| A1 | 1 | 100$ | **primary** | latest @ t=0 |
| A2 | 1 | 200$ | primary @ A1 | latest @ t=0 |

**After Commit** (commit timestamp = 2):

| Account | Timestamp | Data | Lock | Write Metadata |
|---|---|---|---|---|
| A1 | 2 | 150$ | — | latest @ t=1 |
| A2 | 2 | 150$ | — | latest @ t=1 |

*Locks are released starting from the primary. Readers that observe uncommitted locks can consult the primary lock to determine if the transaction succeeded and proceed accordingly.*

<div style="background: #222; padding: 20px; border-radius: 8px; margin-top: 20px;">
    <h4 style="margin-top: 0; color: #ff9800;">What to watch</h4>
    <p style="font-size: 1.1rem;">The Coordinator runs three sequential transactions. Watch the <b>Shard-A</b> and <b>Shard-B</b> inspector: their <b>lock</b> field fills during Prewrite and clears on Commit. The Oracle's <b>ts</b> counter increments twice per transaction (start + commit). The coordinator's <b>log</b> field narrates each step. Try crashing the Oracle mid-transaction to see the coordinator stall waiting for a timestamp.</p>
</div>

<div style="text-align: center; margin-top: 30px; margin-bottom: 40px;">
    <button class="demo-btn" onclick="showDemo('demos/percolator/demo.json')" style="font-size: 1.5rem; padding: 15px 30px; background: #00695c; color: white; border: none; border-radius: 6px; cursor: pointer;">
        Launch Percolator Demo
    </button>
</div>

---

# Coordination Avoidance

The need for **coordination** can be completely eliminated when the operations that transactions perform are **invariant confluent** (I-Confluent).

**Invariant Confluence**: Two invariant-valid but diverged database states **can always be merged** into a single, valid final state — no coordination required.

Because any two valid states can be safely merged, **I-Confluent** operations improve scalability dramatically by removing cross-partition synchronization.

### Requirements for Coordination-Free Systems

<small>

| Property | Description |
|---|---|
| **Global Validity** | Invariants are satisfied for both merged and divergent committed states |
| **Availability** | Transactions reach a commit or abort decision if all holding nodes are reachable |
| **Convergence** | Without new transactions or permanent partitions, all nodes reach the same state |
| **Coordination Freedom** | Local execution is independent of concurrent operations on other nodes |

</small>

---

# RAMP Transactions

**Read-Atomic Multi-Partition (RAMP)** transactions implement coordination avoidance using multiversion concurrency control and in-flight write metadata.

**The key problem RAMP solves**: *fractured reads* — when a transaction observes only a *subset* of updates made by another concurrent transaction.

RAMP provides:
- **Synchronization independence**: one client's transaction will never stall or abort another's.
- **Partition independence**: clients only contact partitions whose data is relevant to their transaction.

RAMP introduces the **read-atomic isolation level**: all or none of a transaction's updates are visible to concurrent readers.

---

# RAMP Transactions

### How It Works

1. Writes are **buffered** and installed using two-phase commit.
2. RAMP distributes **transaction metadata** alongside writes — a reader can detect concurrent in-flight writes by inspecting metadata.
3. If a reader finds that the latest version it observed is part of a larger atomic write, it fetches the remaining parts from other partitions using the metadata, ensuring it sees a complete snapshot.

> *RAMP offers atomic write visibility **without** mutual exclusion. Transactions proceed in parallel, never blocking each other.*

---

# Lecture Summary

We traced the full landscape of distributed transaction protocols — from foundational primitives to production-grade database architectures.

| Protocol / System | Key Idea | Main Trade-off |
|---|---|---|
| **2PC** | Coordinator-driven two-round commit | Blocks if coordinator crashes mid-vote |
| **3PC** | Extra prepare phase with timeouts | Split-brain under network partitions |
| **Calvin** | Deterministic global ordering | Pre-declared read/write sets only |
| **Spanner** | Per-shard Paxos + 2PC + TrueTime | Higher cost for multi-shard transactions |
| **Percolator** | SI + client-driven 2PC on Bigtable | Timestamp oracle is a potential bottleneck |
| **RAMP** | Coordination-free via metadata | Read-atomic isolation only (not serializable) |

---

# Concluding Thoughts

Every distributed transaction protocol is a **trade-off negotiation** between:

- **Consistency** — how precisely do all nodes agree on the outcome?
- **Availability** — can the system proceed when participants crash or partitions form?
- **Performance** — how many round-trips, locks, and disk syncs does the protocol require?

> **Ask yourself**: does your application actually need *serializable* distributed transactions, or can it tolerate a relaxed model like snapshot isolation or read-atomic? The further you can relax the consistency requirement, the less coordination — and less performance cost — your system demands.

Modern databases don't pick one model and stop. Google Spanner, CockroachDB, and TiDB all layer multiple mechanisms: **Paxos for log replication**, **2PC for cross-shard coordination**, and **MVCC for lock-free reads** — each operating at its appropriate granularity.
