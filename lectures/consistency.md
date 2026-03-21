# Sequential Consistency

Because achieving pure physical Linearizability is often violently expensive in high-performance distributed systems, engineers frequently relax the model while still maintaining incredibly strong mathematical correctness.

**Sequential Consistency** allows a system to mathematically order overlapping operations as if they were executed in some clean sequential order, while strictly requiring that operations originating from the *same* individual process are executed in the exact programmatic order they were submitted.

Crucially, under Sequential Consistency, the absolute order of execution *between different processes* is formally undefined, because there is no physically shared concept of a global clock!

---

# The Rules of Observation

Formal Sequential Consistency is defined by three strict rules of observation:

1. **Local Order:** All write operations propagating from the same process must appear in the exact order they were submitted by that specific process. 
2. **Global Agreement:** Operations propagating from *different* sources may initially be ordered arbitrarily by the network... but ***all* active processes must universally *observe* the final operations in the exact same chronological order.**
3. **Stale Reads:** Processes can safely observe operations executed by other participants in an order strictly consistent with their own history, but this viewpoint is allowed to be arbitrarily mathematically *stale* from the global perspective. *(e.g. Even if writes propagate to different replicas in identical order, they are legally allowed to arrive at drastically different times).*

---

# Sequential Consistency Example

Observe the following asynchronous timeline: $W_1$ and $W_2$ overlap, meaning their true physical global execution order is technically undefined.

However, under strict Sequential Consistency, both $R_1$ and $R_2$ legally must observe the resultant states occurring in the **exact same logical execution order**—even though $R_2$'s reads are arbitrarily delayed!

```static-timeline
{
  "zoom": 0.85,
  "ticks": 58,
  "trackHeight": 50,
  "stateBandOffset": 10,
  "servers": ["W1", "W2", "R1", "R2"],
  "states": [
    { "server": "W1", "start": 5, "end": 15, "state": "write(x=1)", "color": "#ffb74d" },
    { "server": "W2", "start": 10, "end": 20, "state": "write(x=2)", "color": "#ffb74d" },
    { "server": "R1", "start": 25, "end": 32, "state": "read(x)->1", "color": "#81c784" },
    { "server": "R1", "start": 35, "end": 42, "state": "read(x)->2", "color": "#81c784" },
    { "server": "R2", "start": 40, "end": 47, "state": "read(x)->1", "color": "#81c784" },
    { "server": "R2", "start": 50, "end": 57, "state": "read(x)->2", "color": "#81c784" }
  ]
}
```

---

# Sequential Consistency vs Linearizability

The primary mathematical difference between Linearizability and Sequential Consistency is the explicit absence of **globally enforced wall-clock time bounds**.

* **Under Linearizability:** By the exact geometric instant a write structurally completes, its results physically physically *have* to be universally applied, and absolutely *every* reader in the entire cluster should legally be able to see that value immediately.
* **Under Sequential Consistency:** This rigorous physical time requirement is relaxed. An operation’s results are legally allowed to become physically visible *long after* its actual completion, as long as the logical programmatic order remains perfectly consistent across all active observers!

*(Note: Just like Linearizability, modern CPU architectures do not guarantee Sequential Consistency natively by default either! Programmers must explicitly inject memory barriers—or "fences"—to forcefully guarantee simultaneous multi-threaded visibility).*

---

# Causal Consistency

Even though ruthlessly enforcing a global physical operation order is often unnecessary (and computationally expensive), it is frequently structurally necessary to establish a strict order between **some natively dependent** operations. 

Under the **Causal Consistency** model, all distributed processes fundamentally *have* to natively observe causally related operations in the exact same chronological order! 

*(Concurrent writes with absolutely *no* causal relationship can still be safely observed in different physical chronological orders by different processors).*

---

# The Causal Anomaly

Imagine an online forum: $W_1$ aggressively posts a question. $W_2$ sees the question and natively posts a brilliantly sarcastic answer. Their operations are logically **causally related** ($W_2$'s interaction relies entirely on the prior existence of $W_1$).

If a system lacks Causal Consistency, $R_2$ might physically receive the packets out-of-order, experiencing a bizarre timeline where the sarcastic answer graphically formally loads *before* the original question ever technically exists!

```static-timeline
{
  "zoom": 0.85,
  "ticks": 56,
  "trackHeight": 50,
  "stateBandOffset": 10,
  "servers": ["W1", "W2", "R1", "R2"],
  "states": [
    { "server": "W1", "start": 5, "end": 20, "state": "write(x=1)", "color": "#ffb74d" },
    { "server": "W2", "start": 10, "end": 25, "state": "write(x=2)", "color": "#ffb74d" },
    { "server": "R1", "start": 30, "end": 40, "state": "read()->1", "color": "#81c784" },
    { "server": "R1", "start": 45, "end": 55, "state": "read()->2", "color": "#81c784" },
    { "server": "R2", "start": 30, "end": 40, "state": "read()->2", "color": "#e57373" },
    { "server": "R2", "start": 45, "end": 55, "state": "read()->1", "color": "#e57373" }
  ]
}
```

---

# Establishing Causality

To definitively avoid this structural anomaly, we must natively bundle a **Logical Clock Timestamp** alongside the written value to explicitly mathematically track and communicate causality! 

Even if the latter write ($W_2$) physically traverses the network much faster than the former write ($W_1$), the local receptor algorithm *will maliciously buffer it* and aggressively refuse to make it physically visible until all of its explicit logical dependencies actually physically arrive.

```static-timeline
{
  "zoom": 0.85,
  "ticks": 56,
  "trackHeight": 50,
  "stateBandOffset": 10,
  "servers": ["W1", "W2", "R1", "R2"],
  "states": [
    { "server": "W1", "start": 5, "end": 20, "state": "write(x=1), t1", "color": "#ffb74d" },
    { "server": "W2", "start": 10, "end": 25, "state": "write(x=2), t2", "color": "#ffb74d" },
    { "server": "R1", "start": 30, "end": 40, "state": "read()->1", "color": "#81c784" },
    { "server": "R1", "start": 45, "end": 55, "state": "read()->2", "color": "#81c784" },
    { "server": "R2", "start": 30, "end": 40, "state": "read()->1", "color": "#81c784" },
    { "server": "R2", "start": 45, "end": 55, "state": "read()->2", "color": "#81c784" }
  ]
}
```
*(By explicitly packaging logical timestamps $t_1$ and $t_2$, $R_2$ successfully buffers the anomaly and natively reconstructs the physical causal timeline!)*

---

# Session Guarantees & Implementation

In a truly **Causally Consistent** system, we inherently generate formal **Session Guarantees** for the client application. This explicitly mathematically ensures that the app's view of the database is permanently logically consistent with its *own logical actions*, even if it natively executes read and write requests against entirely different, asynchronously inconsistent distributed backend servers!

<small>

1. **Monotonic Reads**
2. **Monotonic Writes**
3. **Read-Your-Writes**
4. **Writes-Follow-Reads**

</small>

**(Real World Applications):**
Many production deployments natively implement causality through a specialized frontend library that natively calculates contexts and tracks complex dependency trees:
* **[COPS (Clusters of Order-Preserving Servers)](https://www.cs.cmu.edu/~dga/papers/cops-sosp2011.pdf):** Tracks dependencies structurally through internal Key Versions.
* **[Eiger](https://www.cs.cmu.edu/~dga/papers/eiger-nsdi2013.pdf):** Explicitly establishes wide-area operation dependencies. *(Uses standard Last-Write-Wins conflict resolution, heavily drawing from Apache Cassandra).*

---

# Vector Clocks

Establishing **causal order** mathematically allows a distributed system to organically reconstruct the sequence of events even if physical network messages are brutally delivered out of order! 

It allows databases to intelligently fill the gaps between the messages, and explicitly avoid publishing operation results globally in case some critical causal dependencies are still actively missing.

Many highly scalable databases, such as **[Dynamo](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf)** and **[Riak](https://riak.com/posts/technical/why-vector-clocks-are-hard/)**, fundamentally rely on **Vector Clocks** for establishing this causal order natively across the cluster.

---

# The Vector Architecture

A **Vector Clock** is a mathematical data structure designed for:
1. Establishing a strict **partial order** between asynchronous events.
2. Detecting and algorithmically resolving mathematical divergence between branching event chains. 

By natively utilizing Vectors, we can simulate common time, map global state, and represent fundamentally asynchronous events as mathematically synchronous ones!

**The Method:**
Every single process maintains an ongoing *vector* (an array) of logical clocks, containing exactly one integer counter dedicated exclusively per participant mathematically known to the system:

<small>

| Process | Clock Value |
|---|---|
| P1 (this local node) | 3 |
| P2 (backend replica) | 1 |
| P3 (foreign client node) | 12 |

</small>

---

# Vector Clock Rules

To dynamically establish causal relationships between operations without a wall-clock, the vector array must strictly adhere to three lifecycle rules:

1. **Initialization:** Every single clock in the vector formally starts at `0` (or its initial baseline value).
2. **Internal Advancement:** Every time a new local event natively occurs on a process, that process strictly increments its *own* dedicated physical clock inside its local vector by `1`.
3. **Merge Resolution:** Whenever a process ultimately happens to theoretically receive a network message containing another process's clock vector, it legally must systematically update its own local vector by comparing the two arrays and extracting the **mathematically highest** clock values per-process across *both* vectors.

*(By constantly natively piggybacking these updated arrays onto every message, causality explicitly propagates mathematically like a virus!)*

---

# Tracking Causal History

<center>
<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/Vector_Clock.svg/960px-Vector_Clock.svg.png" style="background-color: white; padding: 20px; border-radius: 10px; max-width: 80%;">
</center>

---

# Resolution and Conflict

To successfully implement Causal Consistency explicitly natively using Vectors, a database absolutely has to store massive amounts of causal history, implement heavy garbage collection pipelines to forcefully clean up dead clocks, and actively officially ask the underlying application (or user) to forcefully mathematically reconcile physically divergent histories in case of a mathematically unresolvable conflict. 

Vector clocks definitively physically mathematically tell you that a conflict *has strictly occurred*, but they absolutely **do not** structurally propose exactly *how* to logically definitively resolve it (since conflict resolution semantics are virtually always business-specific). 

Because of this intense structural overhead across the wire, some famously *eventually consistent* databases (like **Apache Cassandra**) explicitly *do not* structurally mechanically theoretically formally order operations causally natively, and unapologetically forcefully use a beautifully simple **Last-Write-Wins (LWW)** wall-clock rule for mathematically conflict resolution instead!

---

# Interactive Vector Clocks Sandbox


* The mathematical arrays physically displayed natively on the graphical front of each Node explicitly represent its internal `[ Node 0, Node 1, Node 2 ]` Vector Clock sequence!
* Notice how whenever any Node organically randomly decides to logically execute an internal event, it temporarily flashes **ORANGE** and natively increments its own array counter before officially passing its array payload to a target via a physical network message.
* When the target receives it, it uniquely executes the **Merge Resolution** rule! It mathematically absorbs the highest numerical values across both arrays, cleanly structurally increments its own array index natively, and flashes **BLUE** to physically indicate a merge!
* Because events fire completely asynchronously and randomly in this simulation, you can visually track the explicit causal history of exactly who has talked to who simply by reading the mathematical arrays organically floating on the screen!

<div style="text-align: center; margin-top: 40px; margin-bottom: 40px;">
    <button class="demo-btn" onclick="showDemo('demos/vector-clocks/demo.json')" style="font-size: 1.5rem; padding: 15px 30px; background: #2196f3; color: white; border: none; border-radius: 6px; cursor: pointer;">
        Launch Vector Clocks Demo
    </button>
</div>

---

# Eventual Consistency

Synchronization is expensive, both in multiprocessor programming and in massive distributed systems. To scale, we can relax consistency guarantees and use models that explicitly allow temporary divergence between nodes. 

While **Sequential Consistency** allows reads to be propagated at different speeds, under **Eventual Consistency**, updates propagate through the system asynchronously. 

Formally, the model states: *If there are no additional updates performed against a specific data item, eventually all accesses across all nodes will return the latest written value.* 

In case of a conflicting concurrent write, the definition of the "latest value" might change, as the values from diverged replicas are reconciled using a conflict resolution strategy (such as **Last-Write-Wins** or tracking matrices using **Vector Clocks**).

---

# The "Eventually" Guarantee

"Eventually" is a fascinating term to describe value propagation in computer science, because it specifies **no hard time bound** in which the reconciliation actually has to occur! 

The delivery service guarantees nothing more than an open-ended "eventually." 

However, in massive-scale industrial practice, this relaxed asynchronous model works incredibly well. Countless highly performant modern databases routinely running extreme transaction loads are explicitly described as eventually consistent (most notably, **Apache Cassandra**).

---

# Session Models

Thinking about consistency in terms of raw network *value propagation* is incredibly useful for backend database developers to impose strict invariants. However, system behavior is often much easier to explain from the **Client Perspective**. 

**Session Models** help us reason about the state of a massive dataset exclusively through the eyes of a single client: how that specific process observes the cluster state while actively issuing independent read and write operations sequentially.

* Session models make **no assumptions** about simultaneous operations executed by completely different processes.
* BUT these single-client guarantees have to successfully hold true for **every individual process** communicating with the system!

In a massive decentralized cluster, a client might unexpectedly round-robin connect to completely different physical replicas! If the results of a recent write on Replica A haven't finished propagating to Replica B, a blind client hitting Replica B might suddenly suffer a regression and fail to observe the very state change it just made!

---

# Session Anomaly Visualized

*(A timeline where the Client breaks **Read-Own-Writes** and **Monotonic Reads** by bouncing between asynchronously replicating storage nodes.)*

```static-timeline
{
  "zoom": 0.85,
  "ticks": 58,
  "trackHeight": 40,
  "stateBandOffset": 10,
  "servers": ["Client", "Replica A", "Replica B"],
  "states": [
    { "server": "Client", "start": 5, "end": 22, "state": "write v1", "color": "#ffe0b2" },
    { "server": "Client", "start": 25, "end": 42, "state": "reads v0", "color": "#ef5350" },
    { "server": "Replica A", "start": 0, "end": 14, "state": "v0", "color": "#e0e0e0" },
    { "server": "Replica A", "start": 15, "end": 60, "state": "v1", "color": "#ffb74d" },
    { "server": "Replica B", "start": 0, "end": 39, "state": "v0", "color": "#e0e0e0" },
    { "server": "Replica B", "start": 40, "end": 60, "state": "v1", "color": "#ffb74d" }
  ],
  "messages": [
    {"from": "Client", "to": "Replica A", "sendTick": 8, "recvTick": 15},
    {"from": "Replica A", "to": "Client", "sendTick": 15, "recvTick": 22},
    {"from": "Client", "to": "Replica B", "sendTick": 25, "recvTick": 32},
    {"from": "Replica A", "to": "Replica B", "sendTick": 16, "recvTick": 40},
    {"from": "Replica B", "to": "Client", "sendTick": 35, "recvTick": 42}
  ]
}
```
*(The Client successfully writes $v1$ to Replica A, receiving a green ACK. But due to load balancer round-robin logic, its subsequent read hits Replica B a few ticks before the background-sync arrives! The Client reads a stale $v0$, shattering the Read-Own-Writes illusion!)*

---

# Session Consistency Guarantees

To prevent structural logic failures when users unexpectedly bounce between out-of-sync replicas, engineers construct formal **Session Guarantees**:

* **Read-Own-Writes:** Crucial! Every read operation following a write (no matter if the read miraculously hits a completely different replica node) *MUST* physically observe the updated value.
* **Monotonic Reads:** If `read(x)` successfully observes the value `V`, all subsequent `read(x)` calls are strictly forbidden from ever returning an older value than `V`.
* **Monotonic Writes:** Values originating from the exact same client definitively appear across the entire cluster exactly in the order that the client executed them.
* **Writes-Follow-Reads (Session Causality):** Writes are strictly logically ordered *after* any writes that were formally observed by a previous read operation in that session!

---

# Pipelined RAM (PRAM) Consistency

When a powerful database architecture successfully provides **Monotonic Reads**, **Monotonic Writes**, AND **Read-Own-Writes** simultaneously, we classify that engine as supporting **Pipelined RAM (PRAM) Consistency**!

PRAM mathematically guarantees that write operations propagating from an active process will legally flow across the entire cluster exactly in the order they were locally executed. 

*(**Note:** This is categorically different than formal Sequential Consistency! While PRAM protects a single user's internal sequence, simultaneous writes rushing in from two completely different processes can still be cleanly observed in totally random chaotic orders by other external clients!)*

---

# Tunable Consistency

Most highly-available NoSQL systems embrace Eventual Consistency. In CAP theorem terms, they allow developers to trade availability for consistency, or vice versa. 

From the backend server perspective, this is implemented as **Tunable Consistency**, where cluster data is replicated, read, and written using three core variables:

* **Replication Factor (N):** The total number of replica nodes that will store a copy of the data.
* **Write Quorum (W):** The number of nodes that must acknowledge a write before the cluster returns "Success" to the user.
* **Read Quorum (R):** The number of nodes that must respond to a read query before the system resolves the final dataset back to the user.

---

# The Quorum Overlap ($R + W > N$)

By choosing consistency levels where $R + W > N$, the system guarantees returning the most recently written value! 

This is simply the **Pigeonhole Principle** in action: if the Read Node Set and the Write Node Set combined are larger than the total node count, there must be an overlap of at least one node in *both* sets!

**(Critical Engine Requirement):** To make this intersection work across a network, the distributed database *must* store ascending **Version Numbers** (or Logical Timestamps) alongside the actual byte data. Without a unique Version identifier, the Coordinator orchestrating the Read query has no way to determine which returned payload is the most recent!

---

# Quorum Overlap Visualized

*(A timeline mapping $N=5$. Client A targets $W=3$ [Nodes 1, 2, 3]. Client B then targets $R=3$ [Nodes 2, 4, 5]. Node 2 is the geometric intersection guaranteeing the latest data extraction!)*

```static-timeline
{
  "zoom": 0.85,
  "ticks": 58,
  "trackHeight": 40,
  "stateBandOffset": 10,
  "servers": ["Client A", "Client B", "1", "2", "3", "4", "5"],
  "states": [
    { "server": "1", "start": 0, "end": 11, "state": "v0,t=0", "color": "#e0e0e0" },
    { "server": "1", "start": 12, "end": 58, "state": "v1,t=12", "color": "#ffb74d" },
    { "server": "2", "start": 0, "end": 17, "state": "v0,t=0", "color": "#e0e0e0" },
    { "server": "2", "start": 20, "end": 58, "state": "v1,t=20", "color": "#ffb74d" },
    { "server": "3", "start": 0, "end": 21, "state": "v0,t=0", "color": "#e0e0e0" },
    { "server": "3", "start": 22, "end": 58, "state": "v1,t=22", "color": "#ffb74d" },
    { "server": "4", "start": 0, "end": 58, "state": "v0,t=0", "color": "#e0e0e0" },
    { "server": "5", "start": 0, "end": 58, "state": "v0,t=0", "color": "#e0e0e0" },
    { "server": "Client B", "start": 46, "end": 49, "state": "reads v0", "color": "#e0e0e0" },
    { "server": "Client B", "start": 50, "end": 58, "state": "resolves v1", "color": "#81c784" }
  ],
  "messages": [
    {"from": "Client A", "to": "1", "sendTick": 5, "recvTick": 12},
    {"from": "Client A", "to": "2", "sendTick": 5, "recvTick": 20},
    {"from": "Client A", "to": "3", "sendTick": 5, "recvTick": 22},
    {"from": "Client B", "to": "2", "sendTick": 26, "recvTick": 36},
    {"from": "Client B", "to": "4", "sendTick": 26, "recvTick": 34},
    {"from": "Client B", "to": "5", "sendTick": 26, "recvTick": 39},
    {"from": "2", "to": "Client B", "sendTick": 37, "recvTick": 50},
    {"from": "4", "to": "Client B", "sendTick": 35, "recvTick": 46},
    {"from": "5", "to": "Client B", "sendTick": 40, "recvTick": 54}
  ]
}
```

---

# Tuning Performance

**(Summary):** Tuning variables $R$ and $W$ forces the system latency onto either the read path or the write path.

### **Heavy-Read Workloads (E.g. Profile Pages, Caches)**
* **The Goal:** Reads must be phenomenally fast. Write latency doesn't matter because updates are rare.
* **The Configuration:** Set $R = 1$ and $W = N$. 
* **The Effect:** Any single node can natively satisfy read queries locally with zero internal network chatter! However, the burden is moved to the write path: writes now must synchronously copy across every single node before returning.

---

# Heavy-Write vs Balanced

### **Heavy-Write Workloads (E.g. Telemetry / IoT Logging)**
* **The Goal:** The database must aggressively absorb mass streams of incoming data with absolutely minimum latency. Reads are rare batch-processing evaluations.
* **The Configuration:** Set $W = 1$ and $R = N$.
* **The Effect:** Writes are instantly successfully acknowledged the second they hit *any* single database node! The latency penalty is entirely shifted to the read path, which now must slowly query every single node in the cluster to logically aggregate the truest sequence!

### **Balanced Workloads**
* **The Goal:** A safe, consistent medium.
* **The Configuration:** $W = \lfloor N/2 \rfloor + 1$ and $R = \lfloor N/2 \rfloor + 1$. (A classic internal Quorum).

---

# Quorum Tolerance

A consistency level that consists of $\lfloor N/2 \rfloor + 1$ nodes is called a **quorum**, which mathematically signifies a strict majority of nodes. 

In the case of a network partition or node failures in a system with $2f + 1$ nodes, the live nodes can continue accepting writes or reads safely even if up to $f$ nodes are unavailable, until the rest of the cluster physically recovers. 

In other words, such a quorum system can guarantee structural availability while tolerating at most $f$ simultaneous node failures.

---

# The Incomplete Write Anomaly

Reading and writing using strict quorums **does not guarantee monotonicity** in cases of an incomplete write! 

If a write operation fails after partially writing a value to only *one* replica out of three before crashing, a subsequent quorum read can randomly return either the result of the incomplete operation *or* the old value, depending entirely on which geometric subset of nodes successfully answers the read query fastest!

Since subsequent reads are not permanently required to contact the exact same physical replicas, the values they return to the client can alternate backwards and forwards in time. To achieve formal read monotonicity (at the cost of availability), databases must implement blocking **read-repair** logic.

---

# Incomplete Quorum Visualized

*(A timeline where $N=3, W=2, R=2$. Client A attempts a Write but completely crashes after only updating Node 1! The write fails and rolls back for Client A. However, Client B now suffers a terrifying anomaly: a sequence of perfectly valid $R=2$ reads forcefully causes it to mathematically move backwards in time!)*

```static-timeline
{
  "zoom": 0.85,
  "ticks": 58,
  "trackHeight": 40,
  "stateBandOffset": 10,
  "servers": ["Client A", "Client B", "1", "2", "3"],
  "states": [
    { "server": "1", "start": 0, "end": 14, "state": "v0,t=0", "color": "#e0e0e0" },
    { "server": "1", "start": 15, "end": 58, "state": "v1,t=15", "color": "#ffb74d" },
    { "server": "2", "start": 0, "end": 58, "state": "v0,t=0", "color": "#e0e0e0" },
    { "server": "3", "start": 0, "end": 58, "state": "v0,t=0", "color": "#e0e0e0" },
    { "server": "Client A", "start": 4, "end": 22, "state": "write v1", "color": "#ffe0b2" },
    { "server": "Client A", "start": 23, "end": 58, "state": "crash / timeout", "color": "#ef5350" },
    { "server": "Client B", "start": 32, "end": 44, "state": "reads v1", "color": "#81c784" },
    { "server": "Client B", "start": 54, "end": 58, "state": "reads v0", "color": "#e57373" }
  ],
  "messages": [
    {"from": "Client A", "to": "1", "sendTick": 8, "recvTick": 15},
    {"from": "Client B", "to": "1", "sendTick": 20, "recvTick": 26},
    {"from": "Client B", "to": "2", "sendTick": 20, "recvTick": 25},
    {"from": "1", "to": "Client B", "sendTick": 27, "recvTick": 32},
    {"from": "2", "to": "Client B", "sendTick": 26, "recvTick": 34},
    {"from": "Client B", "to": "2", "sendTick": 42, "recvTick": 48},
    {"from": "Client B", "to": "3", "sendTick": 42, "recvTick": 46},
    {"from": "2", "to": "Client B", "sendTick": 49, "recvTick": 55},
    {"from": "3", "to": "Client B", "sendTick": 47, "recvTick": 54}
  ]
}
```
*(Client B queries Node 1 & 2 $\rightarrow$ Returns the isolated `v1` and updates its state. Then Client B queries Node 2 & 3 $\rightarrow$ Both return `v0`. Monotonicity is broken!)*

---

# Witness Replicas

Storing many full copies of a dataset across replicas can be costly. We can improve storage economics by using **[Witness Replicas](http://www2.cs.uh.edu/~paris/MYPAPERS/Icdcs86.pdf)**.

A **Witness**:
* Stores *only* the data version to participate in a quorum.
* Does not eagerly store the primary payload data.
* May be **temporarily** upgraded to actively store data if the cluster falls into a degraded state.

There are several implementations of this approach; for example, **[Cloud Spanner](https://cloud.google.com/blog/topics/developers-practitioners/demystifying-cloud-spanner-multi-region-configurations)** and **Apache Cassandra**.

---

# Surviving Partitions

Consider an $N=5$ cluster experiencing heavy failures:

| Node | Data Version | Status |
|---|---|---|
| **P1** | 12 | <span style="color: #4caf50;">OK</span> |
| **P2** | 15 | <span style="color: #4caf50;">OK</span> |
| **P3** | 12 | <span style="color: #f44336;">FAIL</span> |
| **P4** | 15 | <span style="color: #f44336;">FAIL</span> |
| **P5** | 15 | <span style="color: #f44336;">FAIL</span> |

* We actively **have the data**: Node P2 survived with the latest `v15` payload.
* We **do not have a Quorum**: Only 2 nodes are alive, falling short of a majority ($3$). The cluster is read-only.

If we supplemented the cluster with *Witnesses* stationed across lightweight servers in other regions, we could safely expand the node count and reliably achieve a Quorum vote without significantly increasing our payload storage overhead!

---

# Strong Eventual Consistency

**Strong Eventual Consistency (SEC)** strikes a middle ground between standard eventual consistency and strict linearizability. 

Under this model, updates are allowed to propagate to servers asynchronously (late or out-of-order). However, it guarantees that when all updates finally arrive at the target nodes, any conflicts between them can be resolved and merged to produce the exact same valid state across the cluster.

---

# Conflict-Free Replicated Data Types

One of the most prominent implementations of Strong Eventual Consistency is **Conflict-Free Replicated Data Types (CRDTs)** (famously implemented in systems like Redis).

This makes CRDTs incredibly useful in eventually consistent systems, since replica states are allowed to temporarily diverge. 
* Replicas can execute operations locally with zero prior synchronization or locking with other nodes.
* Operations propagate to all other replicas in the background, potentially out of order. 
* The structure of the CRDT allows the system to reconstruct the correct global state simply by merging the local operation sequences.

---

# Commutative Replicated Data Types (CmRDTs)

The simplest example of this is operation-based **Commutative Replicated Data Types (CmRDTs)**. To guarantee conflict-free convergence, the underlying data operations must strictly exhibit three properties:

1. **Side-Effect Free:** The application of the merge does not fundamentally change the system state.
2. **Commutative:** The argument order does not matter: $x \bullet y = y \bullet x$. It doesn't matter whether $x$ is merged with $y$, or $y$ is merged with $x$.
3. **Causally Ordered:** Their successful delivery gracefully depends on the precondition, ensuring that the distributed system has cleanly reached the prerequisite state the operation can be applied to.

---

# G-Counters (Grow-Only)

We can reliably implement a distributed counter that only goes up: 
* Each server uniquely holds a state vector consisting of the last known counter updates from all other participants in the cluster.
* Each server is *only* allowed to modify its own dedicated value in the vector array. 
* When updates propagate, the `merge(state1, state2)` function simply compares the arrays and extracts the *maximum* value for each server index.

```static-timeline
{
  "zoom": 0.85,
  "ticks": 58,
  "trackHeight": 40,
  "stateBandOffset": 10,
  "servers": ["User", "Node A", "Node B", "Node C"],
  "states": [
    { "server": "User", "start": 3, "end": 10, "state": "clicks Like (A)", "color": "#ffe0b2" },
    { "server": "User", "start": 12, "end": 19, "state": "clicks Like (B)", "color": "#ffe0b2" },
    { "server": "User", "start": 44, "end": 51, "state": "reads total (C)", "color": "#e1bee7" },
    { "server": "User", "start": 52, "end": 58, "state": "displays 2", "color": "#ab47bc" },
    { "server": "Node A", "start": 0, "end": 9, "state": "[0, 0, 0]", "color": "#e0e0e0" },
    { "server": "Node A", "start": 10, "end": 26, "state": "[1, 0, 0]", "color": "#ffb74d" },
    { "server": "Node A", "start": 27, "end": 58, "state": "[1, 1, 0]", "color": "#81c784" },
    { "server": "Node B", "start": 0, "end": 18, "state": "[0, 0, 0]", "color": "#e0e0e0" },
    { "server": "Node B", "start": 19, "end": 24, "state": "[0, 1, 0]", "color": "#ffb74d" },
    { "server": "Node B", "start": 25, "end": 58, "state": "[1, 1, 0]", "color": "#81c784" },
    { "server": "Node C", "start": 0, "end": 26, "state": "[0, 0, 0]", "color": "#e0e0e0" },
    { "server": "Node C", "start": 27, "end": 31, "state": "[1, 0, 0]", "color": "#ffb74d" },
    { "server": "Node C", "start": 32, "end": 58, "state": "[1, 1, 0]", "color": "#81c784" }
  ],
  "messages": [
    {"from": "User", "to": "Node A", "sendTick": 5, "recvTick": 10},
    {"from": "User", "to": "Node B", "sendTick": 14, "recvTick": 19},
    {"from": "Node A", "to": "Node B", "sendTick": 15, "recvTick": 25},
    {"from": "Node A", "to": "Node C", "sendTick": 15, "recvTick": 27},
    {"from": "Node B", "to": "Node A", "sendTick": 23, "recvTick": 27},
    {"from": "Node B", "to": "Node C", "sendTick": 23, "recvTick": 32},
    {"from": "User", "to": "Node C", "sendTick": 46, "recvTick": 48},
    {"from": "Node C", "to": "User", "sendTick": 49, "recvTick": 52}
  ]
}
```
*(A User clicks "Like" on Node A, and then later hits Node B. Node A and B independently increment their internal vectors without any locking. Instead of a centralized aggregator, they organically gossip their vectors completely **peer-to-peer** to everyone! By tick 32, every single node in the cluster has independently geometrically merged its way to the identical `[1, 1, 0]` conclusion! When the User finally queries Node C, the database adds the array values and returns `2`.)*

---

# PN-Counters (Positive-Negative)

It is possible to construct a counter that supports both increments and decrements by fusing two distinct vectors: a **P-Vector** (used for increments), and an **N-Vector** (used for decrements). 

To calculate the true final value of the database, the system simply extracts the mathematical sum of the $P$ array, and logically subtracts the total sum of the $N$ array!

---

# CRDT Sets & Registers

### Registers (LWW)
To safely replicate independent scalar values, we can use an underlying **Last-Write-Wins (LWW) Register**. The simplest version stores a globally unique timestamp attached to each written value to resolve conflicts. In case of a conflicting write, the database preserves the payload with the larger timestamp.

### Grow-Only Sets (G-Set)
An unordered dataset where each isolated node maintains its own local state and can append new elements. Adding elements produces a valid set, and merging two divergent sets via a *Union* operation is entirely commutative.

### Two-Phase Sets (2P-Set)
Similar to the PN-Counter, we use two overlapping sets to support both additions and removals. 
We must preserve one architectural invariant: only values contained in the addition set can be legally placed into the removal set (the tombstone layer). To dynamically reconstruct the current state of the database, all deleted elements stored within the removal set are subtracted from the addition set!

---

# The Distributed Arsenal

There are quite a few fascinating possibilities CRDTs provide us with, and we can observe more major global data stores adopting this concept to seamlessly provide **Strong Eventual Consistency (SEC)**. 

This is a powerful concept that we can decisively add to our arsenal of tools for building fault-tolerant distributed systems!

---

# Conclusion: Embracing Chaos

When we intentionally choose to abandon the heavy bottleneck of **Linearizability**, an entirely new universe of highly-available distributed scaling opens up.

Through **Sequential** and **Causal Consistency**, we learned how to logically order operations geographically using abstract concepts like **Vector Clocks** instead of fragile wall-time structures. 

By tuning **Read and Write Quorums**, we discovered how to bend network latency to our will—trading strict consistency for operational availability to match our specific client workloads.

Finally, with **Strong Eventual Consistency (SEC)** and **CRDTs**, we proved that we can embrace chaos. By relying on the elegant mathematics of pure commutativity, we can allow massive global replicas to temporarily diverge, safely knowing they will inherently converge back into a single identical state without ever utilizing a centralized lock!
