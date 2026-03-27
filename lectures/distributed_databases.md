# Distributed Databases: Global Consenus & Determinism

After understanding **Paxos** and **Raft**, we can now explore how global-scale databases use these consensus engines as building blocks for ACID transactions across the planet.

---

# Deterministic Transactions: Calvin

**Calvin** (used in FaunaDB) takes a unique approach: it removes the need for distributed locks and 2PC by pre-calculating a deterministic execution plan.

### System Architecture: The Sequencer/Scheduler Split

```static-diagram
{
  "width": 600,
  "height": 280,
  "nodes": [
    { "id": "client", "x": 225, "y": 5, "label": "Client App", "type": "pill", "width": 150, "fill": "#f5f5f5" },
    
    { "id": "seq1", "x": 75, "y": 50, "label": "Sequencer", "width": 100, "fontSize": "11px" },
    { "id": "seq2", "x": 425, "y": 50, "label": "Sequencer", "width": 100, "fontSize": "11px" },
    
    { "id": "sch1", "x": 75, "y": 100, "label": "Scheduler", "width": 100, "fontSize": "11px" },
    { "id": "sch2", "x": 425, "y": 100, "label": "Scheduler", "width": 100, "fontSize": "11px" },
    
    { "id": "w1a", "x": 70, "y": 150, "label": "W1", "width": 50, "type": "pill", "fontSize": "9px" },
    { "id": "w1b", "x": 130, "y": 150, "label": "W2", "width": 50, "type": "pill", "fontSize": "9px" },
    { "id": "w2a", "x": 420, "y": 150, "label": "W1", "width": 50, "type": "pill", "fontSize": "9px" },
    { "id": "w2b", "x": 480, "y": 150, "label": "W2", "width": 50, "type": "pill", "fontSize": "9px" },
    
    { "id": "st1", "x": 60, "y": 200, "label": "Storage A", "width": 130, "type": "cylinder", "fill": "#e3f2fd", "fontSize": "10px" },
    { "id": "st2", "x": 410, "y": 200, "label": "Storage B", "width": 130, "type": "cylinder", "fill": "#e3f2fd", "fontSize": "10px" }
  ],
  "links": [
    { "from": "client", "to": "seq1", "label": "TX" },
    { "from": "client", "to": "seq2", "label": "TX" },
    { "from": "seq1", "to": "seq2", "label": "Replication", "color": "#f06292" },
    { "from": "seq1", "to": "sch1" },
    { "from": "seq2", "to": "sch2" },
    { "from": "sch1", "to": "w1a" },
    { "from": "sch1", "to": "w1b" },
    { "from": "sch2", "to": "w2a" },
    { "from": "sch2", "to": "w2b" },
    { "from": "w1a", "to": "st1" },
    { "from": "w1b", "to": "st1" },
    { "from": "w2a", "to": "st2" },
    { "from": "w2b", "to": "st2" }
  ],
  "groups": [
    { "x": 50, "y": 45, "width": 150, "height": 195, "label": "Partition 1", "dashed": true },
    { "x": 400, "y": 45, "width": 150, "height": 195, "label": "Partition 2", "dashed": true }
  ]
}
```

### Calvin Phase Trace

```static-timeline
{
  "ticks": 60,
  "labelWidth": 120,
  "servers": [
    { "id": "cl", "name": "Client 1" },
    { "id": "sq", "name": "Sequencer" },
    { "id": "sc", "name": "Scheduler" },
    { "id": "w1", "name": "Worker 1" },
    { "id": "w2", "name": "Worker 2" }
  ],
  "states": [
    { "server": "cl", "start": 5, "end": 10, "label": "Write D", "color": "#ffcdd2" },
    { "server": "cl", "start": 12, "end": 17, "label": "Read A", "color": "#c8e6c9" },
    { "server": "sq", "start": 20, "end": 28, "label": "Batched", "color": "#fff9c4" },
    { "server": "sc", "start": 30, "end": 35, "label": "Locked", "color": "#ffccbc" },
    { "server": "sc", "start": 37, "end": 42, "label": "Planned", "color": "#d1c4e9" },
    { "server": "w1", "start": 44, "end": 50, "label": "Execute", "color": "#b3e5fc" },
    { "server": "w2", "start": 46, "end": 52, "label": "Execute", "color": "#b3e5fc" }
  ],
  "arrows": [
    { "from": "cl", "to": "sq", "time": 10 },
    { "from": "cl", "to": "sq", "time": 17 },
    { "from": "sq", "to": "sc", "time": 28 },
    { "from": "sc", "to": "w1", "time": 42 },
    { "from": "sc", "to": "w2", "time": 42 }
  ]
}
```

---

# Global Scale: Google Spanner

Google **Spanner** takes a contrasting approach: **per-shard Paxos groups with 2PC across shards**. 

### System Hierarchy: The Universe View

```static-diagram
{
  "width": 600,
  "height": 380,
  "nodes": [
    { "id": "client", "x": 250, "y": 5, "label": "Client App", "type": "pill", "width": 100, "fill": "#f5f5f5" },
    { "id": "tt", "x": 10, "y": 5, "label": "TrueTime Master", "type": "pill", "width": 130, "fill": "#fff9c4", "fontSize": "10px" },
    
    { "id": "s1", "x": 50, "y": 80, "label": "Spanserver", "width": 100, "fontSize": "11px" },
    { "id": "s2", "x": 250, "y": 80, "label": "Spanserver", "width": 100, "fontSize": "11px" },
    { "id": "s3", "x": 450, "y": 80, "label": "Spanserver", "width": 100, "fontSize": "11px" },
    
    { "id": "p1", "x": 60, "y": 140, "label": "Paxos Leader", "width": 80, "type": "pill", "fill": "#c8e6c9", "fontSize": "10px" },
    { "id": "p2", "x": 260, "y": 140, "label": "Follower", "width": 80, "type": "pill", "fontSize": "10px" },
    { "id": "p3", "x": 460, "y": 140, "label": "Follower", "width": 80, "type": "pill", "fontSize": "10px" },
    
    { "id": "db1", "x": 55, "y": 200, "label": "Tablet (Replica)", "width": 90, "type": "cylinder", "fill": "#e3f2fd", "fontSize": "9px" },
    { "id": "db2", "x": 255, "y": 200, "label": "Tablet (Replica)", "width": 90, "type": "cylinder", "fill": "#e3f2fd", "fontSize": "9px" },
    { "id": "db3", "x": 455, "y": 200, "label": "Tablet (Replica)", "width": 90, "type": "cylinder", "fill": "#e3f2fd", "fontSize": "9px" }
  ],
  "links": [
    { "from": "tt", "to": "s1", "dashed": true, "color": "#fbc02d" },
    { "from": "client", "to": "p1", "label": "RW Request" },
    { "from": "s1", "to": "p1" },
    { "from": "s2", "to": "p2" },
    { "from": "s3", "to": "p3" },
    { "from": "p1", "to": "db1" },
    { "from": "p2", "to": "db2" },
    { "from": "p3", "to": "db3" },
    { "from": "p1", "to": "p2", "color": "#2196f3", "width": 1 },
    { "from": "p2", "to": "p3", "color": "#2196f3", "width": 1 },
    { "from": "p1", "to": "p3", "label": "Paxos Group (1 per shard)", "color": "#2196f3", "width": 1 }
  ],
  "groups": [
    { "x": 40, "y": 70, "width": 120, "height": 220, "label": "Zone: US-East-1", "dashed": true },
    { "x": 240, "y": 70, "width": 120, "height": 220, "label": "Zone: EU-West-1", "dashed": true },
    { "x": 440, "y": 70, "width": 120, "height": 220, "label": "Zone: US-West-2", "dashed": true }
  ]
}
```

### TrueTime & External Consistency

TrueTime explicitly represents clock uncertainty. `TT.now()` returns an interval $[earliest, latest]$ that is guaranteed to contain the absolute real time.

**The Commit Wait Rule**:
1. **Pick Timestamp**: The coordinator picks $s = TT.now().latest$.
2. **Commit Wait**: The coordinator must not commit (reply to client) until $TT.now().earliest > s$.

---

# Distributed Transactions: Percolator

**Percolator** (Google) provided a way to layer multi-row transactions on top of Bigtable (which only supports single-row atomicity).

- **Client-driven 2PC**: The client acts as the coordinator, managing locks stored directly in Bigtable columns.
- **Timestamp Oracle**: Relies on a centralized service (Oracle) to provide monotonically increasing timestamps for Snapshot Isolation.
- **Primary vs. Secondary**: Uses a "Primary Lock" to handle recovery. If the client crashes, the node that finds the lock checks the primary to decide whether to roll forward or back.

### Percolator State Walk-Through

**Initial state** (after previous transaction at $t=0$):

| Account | Timestamp | Data | Lock | Write Metadata |
|---|---|---|---|---|
| A1 | 1 | 100$ | — | latest @ t=0 |
| A2 | 1 | 200$ | — | latest @ t=0 |

**After Prewrite** (new transaction, start timestamp $t=1$):

| Account | Timestamp | Data | Lock | Write Metadata |
|---|---|---|---|---|
| A1 | 1 | 100$ | **primary** | latest @ t=0 |
| A2 | 1 | 200$ | primary @ A1 | latest @ t=0 |

**After Commit** (commit timestamp $t=2$):

| Account | Timestamp | Data | Lock | Write Metadata |
|---|---|---|---|---|
| A1 | 2 | 150$ | — | latest @ t=1 |
| A2 | 2 | 150$ | — | latest @ t=1 |

*Locks are released starting from the primary. Readers that observe uncommitted locks can consult the primary lock to determine if the transaction succeeded and proceed accordingly.*

<div class="callout-box">
    <h4>What to watch in the Demo</h4>
    <p>The Coordinator runs sequential transactions. Watch the <b>Shard-A</b> and <b>Shard-B</b> inspector: their <b>lock</b> field fills during Prewrite and clears on Commit. The Oracle's <b>ts</b> counter increments twice per transaction. Try crashing the Oracle mid-transaction to see the coordinator stall waiting for a timestamp.</p>
</div>

<div style="text-align: center; margin-top: 30px; margin-bottom: 40px;">
    <button class="demo-btn" onclick="showDemo('demos/percolator/demo.json')" style="font-size: 1.5rem; padding: 15px 30px; background: #00695c; color: white; border: none; border-radius: 6px; cursor: pointer;">
        Launch Percolator Demo
    </button>
</div>

---

# Pillar 2: High Availability (AP / BASE)

While Spanner and Calvin fight for ACID properties, many systems choose the **Dynamo Path**: prioritizing availability even at the cost of temporary divergence.

### The Dynamo Legacy (DynamoDB, Riak)
- **Vector Clocks**: Used to detect causal conflicts. Every mutation carries a vector $[node_1: c_1, node_2: c_2, \dots]$. If two vectors are incomparable, a conflict has occurred (divergent branch).
- **Sloppy Quorums**: If the designated $N$ nodes are down, the system writes to *handoff* nodes to ensure availability, which are then cleaned up via **Hinted Handoff**.
- **Merkle Trees**: Used in the background to detect differences between replicas (Anti-Entropy).

### Large Scale: Apache Cassandra
Cassandra borrows the Dynamo architecture but optimizes for simpler conflict resolution:
- **Last-Write-Wins (LWW)**: Instead of complex vector clock merges, it uses the server's microsecond wall-clock timestamp to resolve conflicts.
- **Tunable Consistency**:
  - **CL.ONE**: Acknowledgement from 1 node.
  - **CL.QUORUM**: Acknowledgement from $\lfloor N/2 \rfloor + 1$.
  - **CL.ALL**: Acknowledgement from every node.

### Conflict-Free: Redis CRDTs
For **Strong Eventual Consistency (SEC)**, Redis uses CRDTs (Conflict-Free Replicated Data Types):
- **G-Counter**: Increments only, uses vectors to track contributions and merges by taking the maximum of each index.
- **PN-Counter**: Supports increments and decrements by fusing two vectors.

---

# Pillar 3: Coordination Services

Beyond storing data, many distributed systems require a **Control Plane**: a central, highly-consistent authority to manage configuration, leadership, and locks.

### etcd and HashiCorp Consul
These systems provide a simple Key-Value API but are backed by a strict **Raft** consensus group.
- **Leases**: Clients maintain a TTL-based lease. If the client heartbeats fail, its associated keys (like leader-locks) are automatically deleted.
- **Watches**: Clients can subscribe to changes in a key-prefix, allowing for real-time configuration updates without polling.

### Apache ZooKeeper (ZAB Protocol)
ZooKeeper uses the **ZAB (ZooKeeper Atomic Broadcast)** protocol, which is similar to Paxos but optimized for high-throughput primary-order broadcasting.
- **ZNodes**: Data is stored in a hierarchical file-system-like structure.
- **Ephemeral Nodes**: Automatically deleted when the client session ends (perfect for failure detection).

---

# RAMP Transactions

**Read-Atomic Multi-Partition (RAMP)** transactions implement coordination avoidance using multiversion concurrency control and in-flight write metadata.

**The key problem RAMP solves**: *fractured reads* — when a transaction observes only a *subset* of updates made by another concurrent transaction.

RAMP introduces the **read-atomic isolation level**: all or none of a transaction's updates are visible to concurrent readers using metadata to "detect" and "fetch" missing pieces of a snapshot.

---

# Lecture Summary: Advanced Architectures

| Protocol / System | Key Idea | Main Trade-off |
|---|---|---|
| **Calvin** | Deterministic global ordering | Pre-declared read/write sets only |
| **Spanner** | Per-shard Paxos + 2PC + TrueTime | Higher cost for multi-shard transactions |
| **Percolator** | SI + client-driven 2PC on Bigtable | Timestamp oracle is a potential bottleneck |
| **Dynamo / Riak** | Vector Clocks + Sloppy Quorums | Conflict resolution required (Vector merges) |
| **Cassandra** | Tunable Consistency (N,R,W) + LWW | Risk of data loss with CL.ONE + LWW |
| **Redis CRDTs** | Commutative operations (SEC) | Limited to commutative data types (Sets/Counters) |
| **etcd / Consul** | Raft-backed KV + Leases / Watches | Small data sets (Configuration/Coordination) |
| **RAMP** | Coordination-free via metadata | Read-atomic isolation only (not serializable) |
