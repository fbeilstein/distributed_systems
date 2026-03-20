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

<small>

Even with just a *single* copy of the data, there is no universally simple answer to what `P2` should see. 

</small>

```static-timeline
{
  "zoom": 0.9,
  "ticks": 55,
  "trackHeight": 50,
  "stateBandOffset": 1,
  "servers": ["P1", "case 1", "case 2", "case 3", "case 4"],
  "states": [
    { "server": "P1", "start": 20, "end": 34, "state": "write(x = 25)", "color": "#ffb74d" },
    { "server": "case 1", "start": 0, "end": 4, "state": "read(x)", "color": "#81c784" },
    { "server": "case 1", "start": 10, "end": 14, "state": "read(x)", "color": "#81c784" },
    { "server": "case 2", "start": 40, "end": 44, "state": "read(x)", "color": "#81c784" },
    { "server": "case 2", "start": 50, "end": 54, "state": "read(x)", "color": "#81c784" },
    { "server": "case 3", "start": 10, "end": 14, "state": "read(x)", "color": "#81c784" },
    { "server": "case 3", "start": 40, "end": 44, "state": "read(x)", "color": "#81c784" },
    { "server": "case 4", "start": 20, "end": 24, "state": "read(x)", "color": "#81c784" },
    { "server": "case 4", "start": 30, "end": 34, "state": "read(x)", "color": "#81c784" }
  ]
}
```
<small>

Even with just a *single* copy of the data, there is no universally simple answer to what `P2` should see. 
* Should the first `read()` get `0` or `25`? 
* Should the second `read()` get `0` or `25`? 
* What happens if it's a "Safe Register" and returns absolute garbage during the overlap?

</small>

---

# The Replicated Nightmare

In a biologically simple 1-node database, concurrency is hard enough. But in a **replicated distributed system**, the combinations of possible mathematical states absolutely explode. 

Fundamental difficulties arise immediately:
1. **Physical Overlap:** Client reads and writes overlap on the timeline continuously over high-latency networks.
2. **Invisible Completes:** Even if operations *don't* mathematically overlap (P1 finishes before P2 starts), the physical effects of P1's completed call might simply not be visible to P2 yet due to asynchronous background replication delays!

---

# Consistency Models

Since operations on physical memory registers are inevitably allowed to overlap over wide-area networks, we must define crystal clear semantics: *what exactly happens if multiple clients attempt to read or modify different physical copies of the data simultaneously?*

**Consistency models** provide these strict semantics and mathematical guarantees. You can think of a consistency model as a **legally binding contract** between the network participants:
1. It dictates exactly what each replica *has to do* to satisfy the required semantics.
2. It dictates exactly what users *can mathematically expect* when issuing asynchronous read and write operations.

*(Note: While the terminology between standard multi-threaded "Concurrent Systems" and "Distributed Systems" heavily aligns, we cannot directly copy/paste most local concurrency algorithms across a network due to the brutal differences in physical communication patterns, hardware performance, and network reliability).*

---

# Two Types of Consistency

When we say "Consistency", we are usually referring to two distinct structural concepts:

1. **Consistency (State):** Defines the acceptable invariants and allowable mathematical relationships between divergent physical copies of the data (e.g. how far out of sync replicas are legally allowed to drift).
2. **Consistency (Operation):** Defines strict constraints on the chronological execution order of incoming database operations.

---

# The Cost of Synchronization

Without a supernatural "global clock" perfectly linking every CPU on Earth, it is inherently difficult to give distributed operations a universally precise and deterministic execution order. Attempting to forcefully synchronize state perfectly across a wide-area network is overwhelmingly time-consuming and destroys system availability.

Instead of fighting physics, consistency models allow us to logically limit the number of possible catastrophic execution histories by:
* Intelligently positioning strictly dependent writes serially after one another.
* Explicitly defining a mathematical point in time at which a newly written value is legally "propagated" and visible to all future readers across the cluster.

---

# Strict Consistency

**Strict consistency** represents the absolute Holy Grail of distributed systems. It is the mathematical equivalent of complete and flawless *replication transparency*.

Under Strict Consistency, any write operation performed by any process is **instantly** available for all subsequent reads by any other process anywhere in the cluster.

---

# The Global Clock

Strict Consistency fundamentally relies on the hypothetical existence of an absolutely perfect **global clock**.

It dictates that if there was a `write(x, 1)` completed at an exact universal instant $t_1$, then *any* `read(x)` executed by any node at *any* instant $t_2 > t_1$ will absolutely and undeniably return the newly written value `1`.

---

# The Catch

Unfortunately, due to the speed of light, network latency, and the theory of relativity...

This is just a **theoretical model**, and it is physically **impossible** to implement in the real world.

---

# Linearizability

**Linearizability** is the absolute strongest single-object, single-operation consistency model physically possible. 

Under this model, the effects of a write become visible to all readers exactly *once* at some exact, infinitesimal point in time between its start and its end.

Crucially, no client can ever observe state transitions or side effects of *partial* (unfinished, in-flight) or *incomplete* (interrupted/failed) write operations.

---

# Indeterminism vs Sequential Histories

Under linearizability, concurrent operations are mathematically mapped and represented as *one* of the possible sequential histories for which absolute visibility properties structurally hold. 

However, there is still inherent *indeterminism* in linearizability: if two operations overlap, there may exist more than one mathematically valid way in which the events can be chronologically ordered!

* **If two operations overlap, they may take effect in any order.** 
* But as soon as a single read operation returns a particular new value, all reads that come chronologically *after* it are legally bound to return a value at least as recent.

---

# The Rules of Read and Write

1. **Reads:** Every read of a shared value must return the *latest* value successfully written preceding the read, **or** the value of a write that *overlaps* with the read.
2. **Writes:** Linearizable write access to a shared variable implicitly guarantees **mutual exclusion**: between two concurrent writes targeting the same data, only one can technically "go first" internally.
3. **Atomic Illusion:** Even though physical operations take time, are highly concurrent, and have messy overlaps on the wire, under linearizability their effects become visible in a way that makes them appear **strictly sequential** and instantaneous.

---

# Linearizability Example

Assume a shared register starts at **`x = 0`**. 

```static-timeline
{
  "zoom": 0.85,
  "ticks": 55,
  "trackHeight": 50,
  "stateBandOffset": 1,
  "servers": ["W1", "W2", "R1", "R2", "R3"],
  "states": [
    { "server": "W1", "start": 5, "end": 25, "state": "write(x=1)", "color": "#ffb74d" },
    { "server": "W2", "start": 10, "end": 40, "state": "write(x=2)", "color": "#ffb74d" },
    { "server": "R1", "start": 15, "end": 20, "state": "read()", "color": "#81c784" },
    { "server": "R2", "start": 30, "end": 35, "state": "read()", "color": "#81c784" },
    { "server": "R3", "start": 45, "end": 50, "state": "read()", "color": "#81c784" }
  ]
}
```

<small>

* **$R_1$** safely overlaps both writes. It can legally read `0` (old value), `1` (W1 triggered first), or `2` (W2 triggered first).
* **$R_2$** occurs *after* W1 completes, but overlaps W2. Because it strictly follows W1, it can no longer read 0. It must read `1` (W1), or `2` (if W2 triggered first).
* **$R_3$** occurs strictly *after* both writes complete. Assuming W2 was sequentially assigned after W1 inside the database, R3 will permanently read `2`.

</small>
