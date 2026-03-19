# Replication and Consistency

**Consistency** is structurally required to understand modern consensus and atomic commitment algorithms. 

**Consistency models** conceptually explain the visibility semantics and the exact behavior of a distributed system when multiple physical copies of the same data exist simultaneously across the network.

---

# Fault Tolerance

**Fault tolerance** is the strict mathematical property of a distributed system that physically allows it to continue operating completely correctly in the presence of localized component failures. 

Making a system fault-tolerant is notoriously difficult. 
* The primary architectural goal is to eliminate any **Single Point of Failure (SPOF)**.
* We must mathematically guarantee that we have robust redundancy spanning across all mission-critical components.
* Ideally, to the end-user, this complex redundancy is entirely **transparent** (invisible).

---

# Dealing with Failures

When a node inevitably dies, systems can recover in different ways depending on their topology:

* **Primary/Replica Topologies:** Failover is typically done explicitly, by forcibly promoting a healthy replica node to immediately become the new master.
* **Masterless / Quorum Systems:** These systems do not require any explicit structural reconfiguration at all. Instead, they dynamically ensure data consistency simply by collecting responses from a mathematical *majority* of participants during read and write queries.

---

# Data Replication

**Data replication** is the primary method of physically introducing redundancy into a cluster by actively maintaining multiple separate copies of the exact same data. 

Replication is absolutely critical for modern global scale:
* **Multidatacenter deployments**
* **Georeplication** (surviving entire regional zone outages)

---

# The Cost of Atomic Updates

Updating multiple global copies of data atomically (all at once perfectly) is a logic problem mathematically equivalent to achieving absolute *consensus*. 

As expected, it can be extremely expensive and slow to enforce absolute consensus on every single database operation. 

However, in many real-world systems, it is perfectly acceptable if the data merely **looks** consistent from the end-user’s perspective, allowing for a temporary, calculated degree of physical divergence between the replica participants behind the scenes.

---

# The Triangle of Events

In replication environments, we inherently care most about three timeline events:
1. **Write** (The client submitting new data)
2. **Replica Update** (The data propagating across nodes)
3. **Read** (The client requesting the data)

These operations trigger a sequential cascade of events initiated by the client. In some cases, updating the background replicas can safely happen *after* the initial write has officially "finished" from the client's perspective, but this does not change the strict rule that the client must be able to observably read their operations back in a logical, expected order.

---

# Availability

Intermittent hardware and network failures are an absolute mathematical certainty. They should **not** impact the availability of the application. 

From the user’s perspective, the system as a whole must continue seamlessly operating as if nothing has ever happened.

---

# The Paradox of High Availability

To make an architecture truly **highly available**, we must design it in a way that allows us to absorb and handle the sudden unavailability of one or more participants gracefully. 

* To achieve this, we must introduce widespread **redundancy and replication**. 
* **However**, the paradox is that as soon as we add redundancy to solve availability, we instantly introduce the brutal new problem of keeping those multiple copies of data perfectly in sync, forcing us to build complex state recovery mechanisms!

---

# Shared Memory

For a given client, the distributed system storing the data should theoretically act as if it was a single-node system. This illusion is known as **transparency**. 

A single unit of storage—accessible by read or write operations—is usually called a **register**. We can fundamentally view **shared memory** in a distributed database as a massive array of such registers.

---

# Invocation and Completion

We technically identify every mathematical operation by its strict **invocation** and **completion** events. 

* We officially define an operation as **failed** if the process that originally invoked it completely crashes before it records a completion event. 
* If **both** the invocation and completion events for one operation successfully happen entirely before the other operation is even **invoked**, we structurally say that this operation **precedes** the other one, and these two operations are strictly **sequential**. 
* Otherwise, any overlap means we must mathematically say they are **concurrent**.

---

# Concurrency Timelines

```static-timeline
{
  "zoom": 0.85,
  "ticks": 55,
  "servers": ["A", "B", "C", "D"],
  "states": [
    { "server": "A", "start": 5, "end": 20, "state": "operation", "color": "#4fc3f7" },
    { "server": "B", "start": 25, "end": 40, "state": "operation", "color": "#4fc3f7" },
    { "server": "C", "start": 15, "end": 30, "state": "operation", "color": "#ff8a65" },
    { "server": "D", "start": 10, "end": 15, "state": "operation", "color": "#ff8a65" }
  ]
}
```

* **(A) precedes (B)** logically because A completes before B invokes.
* **(A) is concurrent with (C)** because their execution boundaries partially overlap.
* **(A) is also concurrent with (D)** because operation D happens entirely *inside* the execution window of operation A.

---

# The Complexity of Registers

Multiple readers or writers can attempt to access the exact same register simultaneously. 

Because Read and Write operations on registers are physical processes, they are not immediate and take measurable time. Concurrent read/write operations performed by different processes are inherently **not serial**: depending exactly on how the registers physically behave when those operations overlap, they might be mathematically ordered differently during resolution and may produce terrifyingly different results.

Depending on exactly how the register behaves under the extreme stress of concurrent operations, we technically distinguish among **three strict types of registers**.

---

# 1. Safe Registers

Despite the reassuring name, **Safe Registers** offer the weakest guarantees. 

If a concurrent Write operation is currently "on its way" during a Read, a Safe Register is technically allowed to return basically a **"random value"** anywhere within the allowed data range of the register. Functionally, during concurrent writes, values read from a Safe Register may appear completely corrupted or rapidly "flickering" to the client.

---

# 2. Regular Registers

A **Regular Register** provides stronger guarantees: a Read operation is strictly bound and can *only* return the specific value written by the most recently completed Write, **or** the value being written by the Write operation that currently overlaps with the Read. 

In this case, the system actually has some fundamental notion of order, but write results are simply not guaranteed to be visible to all external readers simultaneously (for example, this easily happens in an asynchronous replicated database, where the master accepts writes but requires varying network time to replicate them to the workers actively serving the reads).

---

# 3. Atomic Registers

**Atomic Registers** provide the absolute holy grail of database modeling: **Linearizability**. 

Every Write operation mathematically has a single infinitesimal moment in true time where it perfectly triggers. Before that exact fraction of a millisecond, *every* concurrent Read operation returns the old value, and after that exact moment, *every* Read operation natively returns the new value. 

Atomicity is a brutal, expensive, yet mathematically foundational property that massively simplifies reasoning about global system state.

---

# Ordering

When we look at a sequence of events, we naturally have an intuition about their chronological execution order. 

However, in a distributed system, establishing an absolute linear timeline is nearly impossible. It is fundamentally hard to know *when* exactly something has happened and to have that identical time-aligned information physically available **instantly** across the entire cluster. 

Because each isolated participant can literally have a completely different view of the shared state, we are forced to explicitly define every single operation mathematically in terms of its raw **invocation** and **completion** events (its bounding box).

---

# The Concurrency Problem

Operations don't happen instantly; they take physical time on the wire. This means **Reads and Writes can overlap**.

Consider a system with a single shared variable (`register_1`) starting at `0`.
* **Process 1** executes: `write(register_1 = 25)`
* **Process 2** executes: `read(register_1)` followed instantly by a second `read(register_1)`

If Process 1 and Process 2 are executing across a network simultaneously, we are forced to consider drastically different outcomes depending on precisely how the bounding boxes of the internal events align!

---

# Overlapping Operations

```static-timeline
{
  "zoom": 0.85,
  "ticks": 55,
  "servers": ["P1", "P2"],
  "states": [
    { "server": "P1", "start": 30, "end": 70, "state": "write(25)", "color": "#ffb74d" },
    { "server": "P2", "start": 10, "end": 40, "state": "read()", "color": "#81c784" },
    { "server": "P2", "start": 50, "end": 80, "state": "read()", "color": "#81c784" }
  ]
}
```

Even with just a *single* copy of the data, there is no universally simple answer to what `P2` should see. 
* Should the first `read()` get `0` or `25`? 
* Should the second `read()` get `0` or `25`? 
* What happens if it's a "Safe Register" and returns absolute garbage during the overlap?

---

# The Replicated Nightmare

In a biologically simple 1-node database, concurrency is hard enough. But in a **replicated distributed system**, the combinations of possible mathematical states absolutely explode. 

Fundamental difficulties arise immediately:
1. **Physical Overlap:** Client reads and writes overlap on the timeline continuously over high-latency networks.
2. **Invisible Completes:** Even if operations *don't* mathematically overlap (P1 finishes before P2 starts), the physical effects of P1's completed call might simply not be visible to P2 yet due to asynchronous background replication delays!

---

# Consistency Models

To regain our sanity, reason definitively about operational order, and provide developers with absolute, non-ambiguous descriptions of their database's potential outcomes, distributed systems engineers are forced to formally define strict **Consistency Models**. 

*(Note: While the terminology between standard multi-threaded "Concurrent Systems" and "Distributed Systems" heavily aligns, we cannot directly copy/paste most local concurrency algorithms across a network due to the brutal differences in physical communication patterns, hardware performance, and network reliability).*
