# Anti-Entropy & Dissemination

Most of the communication patterns we’ve explored so far operate as either **peer-to-peer** (between two nodes) or **one-to-many** (a coordinator to a fixed replica set). 

To reliably propagate data records throughout an entire system, the propagating node must be actively available and able to reach all other nodes. Even in the best conditions, the throughput is bottle-necked by that single machine.

This makes rapid, cluster-wide propagation critical for **Metadata**, such as:
* Cluster Membership (nodes joining and leaving)
* Node health states and failure events
* Schema changes

These metadata messages are generally infrequent and small, but must be propagated as quickly and reliably as network conditions allow.

---

# Propagation Strategies

To rapidly broadcast updates to all nodes in a massive cluster, systems generally choose from three algorithmic approaches:

1. **Notification Broadcast:** A single process sequentially sends the payload to every other node.
2. **Periodic P2P Exchange:** Peers connect pairwise and dynamically exchange known messages over time.
3. **Cooperative Broadcast:** Message recipients immediately become broadcasters themselves, multiplying the spread of information to ensure it arrives exponentially faster and more reliably.

---

# The limits of Broadcasting

**Notification Broadcasting** is the most intuitive approach, but it breaks down catastrophically at scale.

* <span style="color: #4caf50;">(+)</span> It is the most straightforward approach to implement.
* <span style="color: #4caf50;">(+)</span> It works effectively for a small number of nodes.
* <span style="color: #f44336;">(-)</span> In large clusters, the network traffic gets exponentially expensive.
* <span style="color: #f44336;">(-)</span> Overdependence on a single bottleneck process.
* <span style="color: #f44336;">(-)</span> Individual processes may not actively know about the existence of all other processes (network churn).
* <span style="color: #f44336;">(-)</span> There must be an overlap in uptime during which *both* the broadcasting process and each of its recipients are healthy simultaneously.

---

# Cooperative Broadcast Visualized

*(A timeline comparing standard Notification Broadcast to **Cooperative Broadcast**. Notice how the Cooperative approach rapidly infects the cluster infinitely faster by empowering receiving nodes to share the network bandwidth burden!)*

```static-timeline
{
  "zoom": 0.85,
  "ticks": 50,
  "trackHeight": 40,
  "stateBandOffset": 10,
  "servers": ["Source", "Node 1", "Node 2", "Node 3", "Node 4"],
  "states": [
    { "server": "Source", "start": 0, "end": 50, "state": "Broadcasting", "color": "#ffb74d" },
    { "server": "Node 1", "start": 0, "end": 14, "state": "Unaware", "color": "#e0e0e0" },
    { "server": "Node 1", "start": 15, "end": 50, "state": "Infected", "color": "#81c784" },
    { "server": "Node 2", "start": 0, "end": 14, "state": "Unaware", "color": "#e0e0e0" },
    { "server": "Node 2", "start": 15, "end": 50, "state": "Infected", "color": "#81c784" },
    { "server": "Node 3", "start": 0, "end": 26, "state": "Unaware", "color": "#e0e0e0" },
    { "server": "Node 3", "start": 27, "end": 50, "state": "Infected", "color": "#81c784" },
    { "server": "Node 4", "start": 0, "end": 26, "state": "Unaware", "color": "#e0e0e0" },
    { "server": "Node 4", "start": 27, "end": 50, "state": "Infected", "color": "#81c784" }
  ],
  "messages": [
    {"from": "Source", "to": "Node 1", "sendTick": 5, "recvTick": 15},
    {"from": "Source", "to": "Node 2", "sendTick": 5, "recvTick": 15},
    {"from": "Node 1", "to": "Node 3", "sendTick": 17, "recvTick": 27},
    {"from": "Node 2", "to": "Node 4", "sendTick": 17, "recvTick": 27}
  ]
}
```
*(By Tick 27, all nodes are correctly infected. If the single Source had to actively sequential-broadcast to all four nodes by itself, the total network latency and bandwidth bottleneck would skyrocket linearly!)*

---

# The Two-Phase Solution

To solve the massive limitations of dropped packets and crashed nodes, distributed systems split the communication protocol into two distinct layers:

<center>
<h3>Primary Delivery + Periodic Sync</h3>
</center>

By explicitly **relaxing the constraints** (accepting that live updates will inevitably fail to propagate perfectly the first time), the system relies on a background process called **Anti-Entropy** to automatically detect missing data and continuously bring degraded nodes back into sync after a failure!

---

# The Entropy Problem

In a distributed system, **Entropy** represents the degree of state divergence between the nodes. Since this property is universally undesired, the total amount of entropy must be kept to an absolute minimum.

**Anti-entropy** is the background protocol used specifically to drastically lower the convergence time bounds in eventually consistent systems. 

*(However, performing a simple pairwise comparison of millions of database records is far too costly across the network... we must engineer something better!)*

---

# Read Repair

The easiest and most opportunistic time to detect divergence between replicas is during an active read query. 

At the exact moment a client requests data, the **Coordinator** must contact multiple replicas anyway. It can request the queried state from each of them, and observe whether or not their returned payload versions match. 

*(Note that in this scenario, the Coordinator does not query the entire massive dataset stored on each replica—it limits the analysis exclusively to the specific record keys requested by the client).*

---

# The Read Repair Flow

The basic opportunistic repair protocol works as follows:

1. `Coordinator` $\leftarrow \text{Read} \leftarrow$ `Replica 1, 2, 3`
2. `Coordinator` logically compares the returned timestamp versions.
3. `Coordinator` detects that Replica 2 holds stale data.
4. `Coordinator` fires an $\rightarrow \text{Update(v}_{\text{latest}}\text{)} \rightarrow$ to `Replica 2`.

**The Dynamo Optimization:**
Contacting *all* replicas is far too slow for low-latency databases. In Dynamo-style architectures, the system only actively contacts the number of nodes that satisfies the chosen **consistency level ($R$)**. If we successfully execute Quorum reads/writes, we guarantee consistent client results, even though the remaining $N - R$ background replicas might remain dangerously stale for an extended period.

---

# Two Repair Strategies

When the Coordinator triggers a Read Repair, the architect must choose exactly when the client receives their response:

* **Blocking:** The client explicitly waits. The Coordinator successfully "repairs" the stale replicas and waits for their network ACKs *before* actively returning the final requested result to the user. (This safely solves the Incomplete Write Anomaly we explored earlier and guarantees Read Monotonicity for Quorum geometries).
* **Asynchronous:** The system simply schedules a background task to repair the lagging replicas *after* instantly returning the latest known result back to the user.

To actively detect exactly which bytes differ between the network responses, databases (like Apache Cassandra) natively utilize specialized runtime iterators equipped with *merge listeners* to specifically reconstruct and isolate the exact payload diffs.

---

# Blocking Read Repair Visualized

*(A timeline explicitly demonstrating the safety of Blocking Read Repair. The Client queries the Coordinator ($R=3$). Node B is lagging entirely out of sync with `v0`. The Coordinator logically stalls the Client, repairs Node B to `v1`, and ONLY returns the final answer tight after the cluster is healed!)*

```static-timeline
{
  "zoom": 0.85,
  "ticks": 70,
  "trackHeight": 40,
  "stateBandOffset": 10,
  "servers": ["Client", "Coordinator", "Node A", "Node B", "Node C"],
  "states": [
    { "server": "Client", "start": 5, "end": 64, "state": "Waiting...", "color": "#ffe0b2" },
    { "server": "Client", "start": 65, "end": 70, "state": "Reads v1", "color": "#81c784" },
    { "server": "Coordinator", "start": 0, "end": 14, "state": "Idle", "color": "#e0e0e0" },
    { "server": "Coordinator", "start": 15, "end": 35, "state": "Querying R=3", "color": "#ffb74d" },
    { "server": "Coordinator", "start": 36, "end": 55, "state": "Blocking Repair", "color": "#ef5350" },
    { "server": "Node A", "start": 0, "end": 70, "state": "v1", "color": "#81c784" },
    { "server": "Node B", "start": 0, "end": 47, "state": "v0 (Stale)", "color": "#e0e0e0" },
    { "server": "Node B", "start": 48, "end": 70, "state": "v1 (Repaired)", "color": "#81c784" },
    { "server": "Node C", "start": 0, "end": 70, "state": "v1", "color": "#81c784" }
  ],
  "messages": [
    {"from": "Client", "to": "Coordinator", "sendTick": 8, "recvTick": 15},
    {"from": "Coordinator", "to": "Node A", "sendTick": 18, "recvTick": 25},
    {"from": "Coordinator", "to": "Node B", "sendTick": 18, "recvTick": 23},
    {"from": "Coordinator", "to": "Node C", "sendTick": 18, "recvTick": 24},
    {"from": "Node B", "to": "Coordinator", "sendTick": 26, "recvTick": 32},
    {"from": "Node C", "to": "Coordinator", "sendTick": 27, "recvTick": 34},
    {"from": "Node A", "to": "Coordinator", "sendTick": 28, "recvTick": 35},
    {"from": "Coordinator", "to": "Node B", "sendTick": 40, "recvTick": 48},
    {"from": "Node B", "to": "Coordinator", "sendTick": 50, "recvTick": 55},
    {"from": "Coordinator", "to": "Client", "sendTick": 57, "recvTick": 65}
  ]
}
```

*(Notice how the Coordinator definitively stops at Tick 36! It detects the `v0` discrepancy from Node B, halts the entire client response, drops a Repair packet to Node B at tick 40, and waits for the ACK at tick 55 before finally responding to the Client. This guarantees true Monotonicity.)*

---

# Digest Reads

While Read Repair guarantees consistency, there is a fundamental network problem: **reading full payloads of data from every single node in the Quorum takes far too long.**

If a Client queries a 10MB record, and the Coordinator requests that exact 10MB record from Node 1, Node 2, and Node 3 to compare them, the network bandwidth becomes immediately saturated with 30MB of redundant data.

To optimize this, most architectures employ **Digest Reads**:
1. `Coordinator` $\dashrightarrow \text{Normal Read} \dashrightarrow$ `Node 1`
2. `Coordinator` $\dashrightarrow \text{Digest Request} \dashrightarrow$ `Node 2, Node 3...`
3. `Coordinator` $\leftarrow \text{10MB Data Payload} \leftarrow$ `Node 1`
4. `Coordinator` $\leftarrow \text{32-byte Hash Digest} \leftarrow$ `Node 2, Node 3...`

The Coordinator locally hashes the 10MB payload from Node 1. If it matches the tiny 32-byte hashes returned by the other nodes, the Coordinator instantly returns the data to the client! It only triggers a heavy "Full Read" from the other nodes if the hashes fiercely disagree.

---

# The Hashing Strategy

Digests are usually computed using a **non-cryptographic** hash function (such as MD5 or MurmurHash). 

The primary requirement here is not security against malicious attackers, but geometric speed. The hash must be computed blisteringly fast to ensure the "Happy Path" (where all replicas agree) remains highly performant. 

*Hash functions can theoretically suffer from mathematical collisions, but their probability is practically negligible for most real-world systems.* 

Because robust databases routinely layer more than just one solitary Anti-Entropy mechanism together, we can safely expect that even in the unlikely event of a raw hash collision, the desync will eventually be caught and gracefully reconciled by a different background subsystem.

---

# Digest Reads Visualized

*(A timeline highlighting the massive bandwidth savings of a Digest Read on a Happy Path. The Coordinator securely routes the heavy full-data read strictly to Node 1, while explicitly requesting lightweight hashes from Nodes 2 and 3. Because `Hash(v1)` beautifully matches the payload from Node 1, the system successfully bypasses transferring duplicate payloads!)*

```static-timeline
{
  "zoom": 0.85,
  "ticks": 50,
  "trackHeight": 40,
  "stateBandOffset": 10,
  "servers": ["Client", "Coordinator", "Node 1", "Node 2", "Node 3"],
  "states": [
    { "server": "Client", "start": 5, "end": 44, "state": "Waiting...", "color": "#ffe0b2" },
    { "server": "Client", "start": 45, "end": 50, "state": "Reads Data", "color": "#81c784" },
    { "server": "Coordinator", "start": 0, "end": 14, "state": "Idle", "color": "#e0e0e0" },
    { "server": "Coordinator", "start": 15, "end": 34, "state": "Validating Hashes", "color": "#ffb74d" },
    { "server": "Node 1", "start": 0, "end": 50, "state": "10MB Data", "color": "#81c784" },
    { "server": "Node 2", "start": 0, "end": 50, "state": "10MB Data", "color": "#81c784" },
    { "server": "Node 3", "start": 0, "end": 50, "state": "10MB Data", "color": "#81c784" }
  ],
  "messages": [
    {"from": "Client", "to": "Coordinator", "sendTick": 8, "recvTick": 15},
    {"from": "Coordinator", "to": "Node 1", "sendTick": 18, "recvTick": 25, "payload": "Read()"},
    {"from": "Coordinator", "to": "Node 2", "sendTick": 18, "recvTick": 23, "payload": "Digest()"},
    {"from": "Coordinator", "to": "Node 3", "sendTick": 18, "recvTick": 24, "payload": "Digest()"},
    {"from": "Node 2", "to": "Coordinator", "sendTick": 26, "recvTick": 32, "payload": "Hash(v1)"},
    {"from": "Node 3", "to": "Coordinator", "sendTick": 27, "recvTick": 34, "payload": "Hash(v1)"},
    {"from": "Node 1", "to": "Coordinator", "sendTick": 28, "recvTick": 35, "payload": "Data v1"},
    {"from": "Coordinator", "to": "Client", "sendTick": 37, "recvTick": 45, "payload": "Data v1"}
  ]
}
```
*(Node 2 and Node 3 cleanly return their tiny 32-byte `Hash(v1)` payloads significantly faster than Node 1 can optimally stream the heavy `Data v1`. The Coordinator successfully validates the hashes at tick 35, saving bandwidth and routing the data to the client at tick 37 without triggering secondary full-reads!)*

---

# Hinted Handoff

Another anti-entropy approach is **Hinted Handoff**, which operates as a **write-side** repair mechanism. 

*(For a production example, refer to [Hinted Handoff in Cassandra](https://docs.datastax.com/en/cassandra-oss/2.1/cassandra/dml/dml_about_hh_c.html)).*

If a target node crashes or fails to acknowledge an incoming write packet, the Write Coordinator (or one of the healthy replicas) proactively stores a special temporary record called a **hint**. 

This hint waits in the background until the target node finally comes back online, at which point the Coordinator replays the hint packet to the target to bring it back into sync.

---

# Hint Constraints

In databases like Apache Cassandra, it is important to note that hinted writes **aren't counted toward the replication factor** (unless the lowest `ANY` consistency level is in use). 

This is because the data inside the hint log of the Coordinator is structurally inaccessible for regular client read queries. The hint log exists *only* to help lagging participants catch up once they boot back up.

---

# Sloppy Quorums

Some databases, such as Riak, pair Hinted Handoffs directly with **Sloppy Quorums** to prioritize extreme availability. 

In a Strict Quorum, a write is rejected if $W$ replicas are not physically reachable. With Sloppy Quorums, if a primary target replica fails the database automatically recruits "additional healthy nodes" from the cluster to absorb the payload. These recruited nodes do not ordinarily hold this data, they just step in to help. 

* `Coordinator` $\dashrightarrow \text{Write}$ to `Nodes A, B, C` *(Discovers Node B is down!)*
* `Coordinator` writes to `A` and `C`.
* `Coordinator` recruits `Node D` and stores a **Hint** there. 
* *[Later, Node B wakes up]*
* `Node D` forwards the Hint back to `Node B` and deletes its temporary copy.

---

# The Cost of Sloppy Quorums

While Sloppy Quorums drastically improve write availability during network outages, they come at the cost of strict consistency.

Consider a scenario where `Nodes B and C` are briefly separated from the rest of the cluster by a network partition.
If a client executes a Sloppy Quorum write to the surviving partition, the write succeeds by updating `Nodes A, D, and E`. 

However, if another client executes a read querying the isolated `Nodes B and C` immediately following this new write, they will return stale data! Because the temporary Hint hasn't successfully resolved back to B and C yet, the illusion of Strict Quorum Read Monotonicity is broken.

---

# Sloppy Quorum Visualized

*(A timeline highlighting the exact flow of a Sloppy Quorum Hint. The Coordinator originally targets A, B, and C. Node B is dead. Rather than failing the write, the Coordinator strictly recruits Node D to temporarily hold Node B's hint!)*

```static-timeline
{
  "zoom": 0.85,
  "ticks": 70,
  "trackHeight": 40,
  "stateBandOffset": 10,
  "servers": ["Coordinator", "Node A", "Node B", "Node C", "Node D"],
  "states": [
    { "server": "Coordinator", "start": 0, "end": 14, "state": "Idle", "color": "#e0e0e0" },
    { "server": "Coordinator", "start": 15, "end": 28, "state": "Writes R=3", "color": "#ffb74d" },
    { "server": "Coordinator", "start": 33, "end": 42, "state": "Writes Hint", "color": "#ef5350" },
    { "server": "Node A", "start": 0, "end": 26, "state": "v0", "color": "#e0e0e0" },
    { "server": "Node A", "start": 27, "end": 70, "state": "v1", "color": "#81c784" },
    { "server": "Node B", "start": 0, "end": 47, "state": "CRASHED", "color": "#ef5350" },
    { "server": "Node B", "start": 48, "end": 62, "state": "Rebooted (v0)", "color": "#ffb74d" },
    { "server": "Node B", "start": 63, "end": 70, "state": "v1 (Healed)", "color": "#81c784" },
    { "server": "Node C", "start": 0, "end": 26, "state": "v0", "color": "#e0e0e0" },
    { "server": "Node C", "start": 27, "end": 70, "state": "v1", "color": "#81c784" },
    { "server": "Node D", "start": 0, "end": 39, "state": "Idle", "color": "#e0e0e0" },
    { "server": "Node D", "start": 40, "end": 57, "state": "Holding Hint", "color": "#ffb74d" },
    { "server": "Node D", "start": 58, "end": 70, "state": "Hint Deleted", "color": "#e0e0e0" }
  ],
  "messages": [
    {"from": "Coordinator", "to": "Node A", "sendTick": 18, "recvTick": 25, "payload": "Write()"},
    {"from": "Coordinator", "to": "Node C", "sendTick": 18, "recvTick": 24, "payload": "Write()"},
    {"from": "Node A", "to": "Coordinator", "sendTick": 26, "recvTick": 32, "payload": "ACK"},
    {"from": "Node C", "to": "Coordinator", "sendTick": 25, "recvTick": 31, "payload": "ACK"},
    {"from": "Coordinator", "to": "Node D", "sendTick": 34, "recvTick": 39, "payload": "Hint for B"},
    {"from": "Node D", "to": "Coordinator", "sendTick": 40, "recvTick": 43, "payload": "Hint ACK"},
    {"from": "Node D", "to": "Node B", "sendTick": 51, "recvTick": 60, "payload": "Handoff v1"},
    {"from": "Node B", "to": "Node D", "sendTick": 62, "recvTick": 68, "payload": "Handoff ACK"}
  ]
}
```
*(Notice how the Coordinator successfully saves the state in Node D. The moment Node B reboots at tick 48, Node D routes the Hint directly to Node B, decisively healing the dataset and cleaning up its own temporary logs!)*

---

# The Need for Background Repair

While Read Repair guarantees consistency for active clients, it has a significant limitation: **it only fixes inconsistencies on data that is actively being queried.**

In petabyte-scale databases, the vast majority of data records might sit archived and unread for years. If a hard drive suffers silent data corruption or a partition blocked an older write, the system needs a background mechanism to scan and repair dormant inconsistencies before they compound.

*Finding exactly which records have diverged requires exchanging massive datasets between nodes pairwise... which is far too slow and consumes too much bandwidth to do over a network.*

---

# Merkle Trees

Instead of sending millions of raw rows of data over the wire, modern asynchronous repair systems utilize **Hash Trees**, known as **[Merkle Trees](https://en.wikipedia.org/wiki/Merkle_tree)**. This approach is famously implemented in systems like Git, DynamoDB, Cassandra, IPFS, and Bitcoin!

* The lowest level of this tree is built by scanning the entire database table and computing hashes of sequential record ranges (the leaves).
* Higher tree levels contain hashes of the lower-level hashes nested below them.
* This builds a hierarchical representation that allows us to detect network inconsistencies by solely comparing tiny hashes.

---

# Merkle Trees

<!-- Custom Embedded Interactive Merkle Demo -->
<iframe src="demos/merkle-tree/index.html" style="width: 100%; height: 350px; border: none; border-radius: 10px; margin: 25px 0;"></iframe>

---

# Traversing the Branches

How do we actually repair a database using this tree?

**1. Root Comparison:** To determine whether two physical replicas are identical, they exchange their single **Root-Level Hash** over the network. If the root hashes match, the databases are perfectly synchronized. (We just validated millions of rows of data using only 32 bytes of bandwidth).

**2. Surgical Traversal:** If the roots disagree, the nodes exchange the hashes of their children. By comparing the hashes pairwise from the top of the tree down to the bottom, the system can locate the exact sub-range holding the differences, and trigger a lightweight Anti-Entropy data replication specifically for those divergent rows!

---

# Merkle Branches in Bitcoin

The elegance of Merkle Trees stretches far beyond database Anti-Entropy. 

In **Bitcoin**, every block contains a Merkle Root representing all confirmed transactions packaged inside it. 

Because of this tree architecture, "Simplified Payment Verification" (SPV) mobile wallets DO NOT have to download the massive 600+ GB blockchain to use the network! By simply storing the tiny 80-byte block headers, a mobile phone can verify that a specific financial payment exists inside a block just by requesting an $\mathcal{O}(\log N)$ Merkle branch proof from a full node.

---

# The Cost of Hash Trees

While Hash Trees offer massive network bandwidth savings, they require certain engineering tradeoffs:

* <span style="color: #f44336;">(-)</span> **Bottom-Up Ripples:** Since Merkle trees are calculated from the bottom to the top, changing a single byte of data triggers the recomputation of that entire subtree branch all the way back up to the root.
* <span style="color: #ffb74d;">(~)</span> **Size vs Precision:** Architects face a core tradeoff between the physical byte-size of a tree (how many hashes exist to exchange), and its precision (how small the individual data ranges at the bottom are).

---

# Bitmap Version Vectors

Recent research introduces **Bitmap Version Vectors** to resolve data conflicts based on recency. 

*(See [Article](https://haslab.uminho.pt/tome/files/global_logical_clocks.pdf) and [Explanation](https://hazm.at/mox/distributed-system/algorithm/consistency/version-vector/index.html)).*

Each node keeps a per-peer log of operations that have occurred local to the node or were replicated. To track replica states, the system uses node-local logical clocks. 

Each clock acts as a set of **dots**. A dot denotes a write this node has seen. This includes writes coordinated by the node itself, or writes coordinated by and replicated from other nodes.

---

# Dots and Sequence Numbers

During anti-entropy, nodes compare logs to determine what data must be replicated to the target node. 

Each write coordinated by a node is tracked by a dot `(i,n)`: an event with a node-local sequence number `i` coordinated by the node `n`. The sequence number `i` starts with 1 and increases each time the node executes a write operation.

<center>
  <img src="https://hazm.at/mox/distributed-system/algorithm/consistency/version-vector/bitmapped-version-vector.png" alt="Bitmap Version Vector" width="60%" style="border-radius: 8px; margin-top: 15px;">
</center>

---

# Identifying Gaps

Because sequence numbers increment with each write, we can trace the state of a node:

* In the node logical clock, events coordinated by the node itself will have no gaps. 
* If some writes are missing from other nodes, the clock will contain gaps. 

To get two nodes back in sync, they exchange logical clocks, identify the gaps represented by the missing dots, and then replicate data records associated with those missing numbers.

---

<!-- Custom Embedded Interactive Bitmap Version Vector Demo -->
<iframe src="demos/bitmap-version-vectors/index.html" style="width: 100%; height: 600px; border: none; border-radius: 10px; margin: 25px 0;"></iframe>

---

# Truncation and Downsides

Because these vectors grow over time, the system needs a robust cleanup mechanism:

* As soon as all nodes in the system have seen consecutive values up to the index `i`, the database can truncate the version vector up to this index to save space.

**Downsides:**
A notable downside is that if a node is down for an extended time period, peer nodes cannot truncate the log. The data still has to be replicated to the lagging node once it comes back up, which forces the other nodes to retain full untruncated bitmaps in the meantime.
