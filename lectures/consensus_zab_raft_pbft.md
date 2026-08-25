:::titlepage
[[title]]
Consensus: ZAB, Raft, and PBFT
[[right]]
Tymchyshyn V.B.
:::

---

# Introduction

## From Crash Failures to Byzantine Adversaries

---

# Consensus Recap

In distributed systems, **consensus algorithms** allow multiple processes to reach an agreement on a value.

Despite the **FLP impossibility** (which proves deterministic consensus is impossible in purely asynchronous systems if even one node might crash), practical systems rely on timeouts and failure detectors to make progress.

Consensus guarantees:
* **Agreement**: All correct processes decide the same value.
* **Validity**: The decided value was proposed by some process.
* **Termination**: All correct processes eventually decide.

---

# Reliable Broadcast

Before consensus, we need reliable communication. A **broadcast** algorithm disseminates information to a set of processes.

**Best Effort Broadcast**
The sender attempts to send the message to all targets. If the sender fails halfway, the message fails silently.

**Flooding / Reliable Broadcast**
Every node forwards the message to every other node it knows.
* (+) Highly reliable even if the original sender crashes.
* (-) Requires $O(N^2)$ messages, flooding the network.

*Reliable broadcast ensures everyone gets the message, but it does NOT guarantee they get messages in the **same order**.*

---

# Atomic Broadcast

If we need to deliver messages **in order**, we use **atomic broadcast** (sometimes called total order multicast).

An atomic broadcast guarantees two essential properties:
1. **Atomicity**: Either all non-faulty processes deliver the message, or none do.
2. **Order**: All non-faulty processes deliver the messages in the exact same sequence.

> *Atomic broadcast is provably equivalent to distributed consensus. If you have one, you can build the other.*

---

# Zookeeper Atomic Broadcast (ZAB)

[Apache ZooKeeper](https://zookeeper.apache.org/) uses a custom atomic broadcast protocol called **ZAB** to keep its replicas consistent.

ZAB splits time into **epochs** (monotonically increasing numbers). During any epoch, there is only one **leader**. All other nodes are **followers**.

Clients connect to any node. If the node isn't the leader, it forwards the write request to the leader.

---

# ZAB's Three Phases

When a new prospective leader emerges, it executes three phases:

1. **Discovery**: The leader proposes a new epoch. Followers reply with their latest known transaction. It prevents older epoch leaders from committing.
2. **Synchronization**: The leader brings followers up to speed, ensuring everyone shares the same history before new messages are accepted.
3. **Broadcast**: The active phase. The leader receives client writes, orders them, broadcasts a proposal, waits for a quorum of acknowledgments, and commits.

**ZooKeeper Transaction ID (Zxid)**
ZAB stamps every transaction with a 64-bit **Zxid**. 
* The higher 32 bits represent the **epoch** (the leader's term).
* The lower 32 bits are a **monotonic counter** for transactions within that epoch.
* *This structure makes it trivial to identify which transaction is "newer" during the Discovery and Synchronization phases.*

> *ZAB's broadcast is highly efficient, requiring only two rounds of messages. It behaves like Two-Phase Commit without aborts.*

---

# ZAB Demo

<div class="callout-box">
    <h4>What to watch</h4>
    <p>Watch the prospective leader drive the cluster through Discovery (CEPOCH / ACK-E) to establish the highest Zxid, then Synchronization (NEWLEADER / ACK-LD) to align everyone's history. Only after a quorum is synced does it broadcast UPTODATE and begin sequencing regular proposals.</p>
</div>

<div style="text-align: center; margin-top: 40px; margin-bottom: 40px;">
    <button class="demo-btn" onclick="showDemo('demos/consensus-zab/demo.json')">
        Launch ZAB Epoch Sync Demo
    </button>
</div>

---

# Virtual Synchrony

Most protocols assume a fixed group of processes. **Virtual synchrony** delivers totally ordered messages to a *dynamic* group of peers.

* Messages are associated with a specific **group view**.
* A group view changes when a node joins, leaves, or fails.
* The view change acts as a **barrier**: a message sent in one view is delivered *only* in that view.

While technically sound, virtual synchrony has largely been superseded in modern systems by replicated state machines using Paxos or Raft.

---


# Raft: Understandable Consensus

* [**Raft**](https://raft.github.io/) was designed explicitly to be a more understandable alternative to Paxos, while providing the same safety and performance.

* Locally, participants store a **log** of commands. By applying identical logs in the same order, state machines arrive at identical results.

* Raft simplifies consensus by making the concept of a **strong leader** a first-class citizen. Most of the time, the cluster simply accepts appends from the stable leader.

---

# Raft Roles

Every Raft participant operates in one of three states:

* **Follower**: Passive. Responds to requests from leaders and candidates. (Every node starts here).
* **Candidate**: An active state used to elect a new leader.
* **Leader**: Handles all client requests and coordinates log replication.

Leaders are elected for a **term** (a monotonically increasing integer). If a leader fails (detected via missing heartbeats), followers transition to candidates and start a new term election.

---

# Raft: Leader Election Timeline

When a follower's randomized election timeout fires, it becomes a candidate, implicitly starting a new term.

:::static-timeline
{
  "zoom": 0.85,
  "ticks": 55,
  "trackHeight": 44,
  "stateBandOffset": 10,
  "servers": ["Node-1", "Node-2", "Node-3", "Node-4", "Node-5"],
  "states": [
    { "server": "Node-1", "start": 0,  "end": 15, "state": "follower (timeout!)","color": "#b2dfdb" },
    { "server": "Node-1", "start": 16, "end": 32, "state": "candidate (term 2)",   "color": "#ffb74d" },
    { "server": "Node-1", "start": 33, "end": 55, "state": "leader (term 2)",      "color": "#90caf9" },
    { "server": "Node-2", "start": 0,  "end": 19, "state": "follower",             "color": "#b2dfdb" },
    { "server": "Node-2", "start": 20, "end": 55, "state": "follower (voted N1)",  "color": "#80cbc4" },
    { "server": "Node-3", "start": 0,  "end": 21, "state": "follower",             "color": "#b2dfdb" },
    { "server": "Node-3", "start": 22, "end": 55, "state": "follower (voted N1)",  "color": "#80cbc4" },
    { "server": "Node-4", "start": 0,  "end": 55, "state": "follower (offline)",   "color": "#cfd8dc" },
    { "server": "Node-5", "start": 0,  "end": 55, "state": "follower (offline)",   "color": "#cfd8dc" }
  ],
  "messages": [
    { "from": "Node-1", "to": "Node-2", "sendTick": 16, "recvTick": 20, "label": "RequestVote" },
    { "from": "Node-1", "to": "Node-3", "sendTick": 16, "recvTick": 22 },
    { "from": "Node-2", "to": "Node-1", "sendTick": 21, "recvTick": 27, "label": "VoteGranted" },
    { "from": "Node-3", "to": "Node-1", "sendTick": 23, "recvTick": 30 },
    { "from": "Node-1", "to": "Node-2", "sendTick": 34, "recvTick": 39, "label": "Heartbeat" },
    { "from": "Node-1", "to": "Node-3", "sendTick": 34, "recvTick": 40 }
  ]
}
:::

Once elected, the leader continually sends periodic empty `AppendEntries` messages (heartbeats) to suppress further elections.

---

# Raft: Split Votes

What happens if multiple followers time out simultaneously? A **split vote**.

If candidates split the votes such that no one achieves a majority, the election times out, a new term begins, and they try again.

Raft solves this elegantly using **randomized election timeouts** (e.g., somewhere between 150ms and 300ms). One node will invariably time out first and collect votes before the others even wake up.

---

# Raft: Log Replication

To replicate data, the leader appends the command to its log and sends `AppendEntries` to followers in parallel.

Once a majority of followers acknowledge writing the entry to their logs, the leader considers the entry **committed**, applies it to its state machine, and replies to the client.

:::static-timeline
{
  "zoom": 0.85,
  "ticks": 55,
  "trackHeight": 44,
  "stateBandOffset": 10,
  "servers": ["Client", "Leader", "Replica-1", "Replica-2", "Replica-3"],
  "states": [
    { "server": "Leader",    "start": 0,  "end": 10, "state": "idle",                 "color": "#cfd8dc" },
    { "server": "Leader",    "start": 11, "end": 32, "state": "replicating entry 5",  "color": "#ffb74d" },
    { "server": "Leader",    "start": 33, "end": 55, "state": "committed entry 5",    "color": "#81c784" },
    { "server": "Replica-1", "start": 0,  "end": 18, "state": "log length 4",         "color": "#b2dfdb" },
    { "server": "Replica-1", "start": 19, "end": 55, "state": "log length 5 (uc)",    "color": "#80cbc4" },
    { "server": "Replica-2", "start": 0,  "end": 20, "state": "log length 4",         "color": "#b2dfdb" },
    { "server": "Replica-2", "start": 21, "end": 55, "state": "log length 5 (uc)",    "color": "#80cbc4" },
    { "server": "Replica-3", "start": 0,  "end": 55, "state": "offline / delayed",    "color": "#cfd8dc" }
  ],
  "messages": [
    { "from": "Client",    "to": "Leader",    "sendTick": 3,  "recvTick": 10, "label": "x = 25" },
    { "from": "Leader",    "to": "Replica-1", "sendTick": 12, "recvTick": 18, "label": "AppendEntries" },
    { "from": "Leader",    "to": "Replica-2", "sendTick": 12, "recvTick": 20 },
    { "from": "Replica-1", "to": "Leader",    "sendTick": 20, "recvTick": 28, "label": "ACK" },
    { "from": "Replica-2", "to": "Leader",    "sendTick": 22, "recvTick": 32 },
    { "from": "Leader",    "to": "Client",    "sendTick": 34, "recvTick": 42, "label": "OK" }
  ]
}
:::

---

# Raft: Consistency Guarantees

Raft's `AppendEntries` implements a powerful consistency check:

When a leader sends an entry, it includes the index and term of the **immediately preceding** entry in its log. If a follower does not find an entry in its log with the same index and term, it **refuses** the new entries.

If the logs diverge, the leader systematically decrements its local `nextIndex` for that follower and retries until they find the point where the logs match. The leader then overwrites the follower's history from that point forward.

> *The leader’s log is sacred. It is never overwritten or deleted, only appended to.*

Observe the entire Raft life cycle: Follower timeouts, split votes, leader election, heartbeats, and client request replication.

<div class="callout-box">
    <h4>What to watch</h4>
    <p>Notice how Node-0 starts with a short election timeout, quickly becoming Candidate and then Leader. Watch the periodic heartbeats holding the followers back from starting new elections. If you inject a client request, observe the Leader appending it and rolling it out via outbox messages, waiting for ACKs to hit the commit threshold.</p>
</div>

<div style="text-align: center; margin-top: 40px; margin-bottom: 40px;">
    <button class="demo-btn" onclick="showDemo('demos/consensus-raft/demo.json')">
        Launch Raft Demo
    </button>
</div>

---

# Paxos vs. Raft

[**Raft**](https://raft.github.io/) was designed explicitly to be a more **understandable** alternative to Paxos. Both achieve Multi-Paxos semantics, but differ in design philosophy:

| Property | Paxos (Multi) | Raft |
|---|---|---|
| Leader election | Ballot-based, any node | Term-based, log-completeness check |
| Log replication | Proposer-driven | Leader strictly append-only |
| **Safety Constraint** | No "newer" ballot known | **Log Completeness**: Candidate must have log $\ge$ majority |
| Membership changes | Ad-hoc per implementation | Joint-consensus protocol |
| Understandability | Complex (many papers needed) | Single, complete paper |
| Performance | Comparable | Comparable |

> *Raft is Paxos made explicit: it trades some flexibility for clarity. Its **Log Completeness** property guarantees that a new leader already possesses all committed entries, so it never needs to pull data "backwards" from followers.*

---

# Transition: Enter the Adversary

Until now, we assumed **crash failures**. Nodes stop, but they don't lie. They execute algorithms in "good faith."

What if the system is deployed over public, adversarial networks? What if nodes suffer from targeted intrusions, severe data corruption, or malicious operators?

A node might send 'X' to one replica and 'Y' to another, intentionally trying to split the network.

Consensus in the presence of malicious actors is known as **Byzantine Fault Tolerance (BFT)**.

---

# Byzantine Quorums

Most Byzantine consensus algorithms require $O(N^2)$ messages to complete a step. Because you cannot trust the leader, **every node must cross-validate everything with every other node** using cryptographic signatures.

To tolerate **$f$** Byzantine (malicious) nodes—where $f$ represents the maximum number of faulty nodes the system can tolerate—a system requires **$3f + 1$** total nodes.

**Why $3f+1$?**
Suppose $f$ nodes are malicious and $f$ nodes are just honest-but-offline (network partition). We must be able to make a decision using the remaining $N - 2f$ nodes.
For the remaining nodes to safely outvote the $f$ malicious ones, we need:
$(N - 2f) > f \implies N > 3f$
Since $N$ is an integer, $N \ge 3f + 1$.

*To survive 1 malicious node, you need 4 nodes total.*

---

# PBFT: Practical Byzantine Fault Tolerance

**PBFT** operates in views, with one primary and all others as backups. If the primary goes rogue or becomes unresponsive, the backups initiate a **View Change** protocol to elect the next primary in sequence.

Clients issue requests to the primary. To succeed, the client must wait for $f + 1$ identical replies from different replicas (proving that at least one honest node executed it).

PBFT executes every request in **three phases**:
1. **Pre-prepare**
2. **Prepare**
3. **Commit**

---

# PBFT Phases

**Phase 1: Pre-prepare**
The primary signs and broadcasts a view, sequence number, and the digest of the client’s request to all backups.

**Phase 2: Prepare**
Backups accept the pre-prepare if signatures are valid. They then broadcast a `PREPARE` to *all* other replicas. A node considers a request **"prepared"** once it has a valid `PRE_PREPARE` and matching `PREPARE` messages from **$2f$** different backups.
* *This combined set of $2f + 1$ messages is known as a **Prepared Certificate**, proving the request is valid and uniquely sequenced.*

**Phase 3: Commit**
Once prepared, the node broadcasts a `COMMIT`. It waits to collect **$2f + 1$** matching `COMMIT` messages. Only then is the operation finally executed and the reply sent to the client.

---

# PBFT: View Change & Recovery

If the backups suspect the primary is faulty (e.g., it fails to broadcast a `PRE-PREPARE` within a timeout), they broadcast a `VIEW-CHANGE` message.

* Once the next primary in the sequence collects **$2f + 1$** valid `VIEW-CHANGE` messages, it broadcasts a `NEW-VIEW` message.
* This protocol ensures that the cluster can make progress even if the leader is malicious or crashes, while guaranteeing that no two honest nodes ever commit different values for the same sequence number across view changes.

> *The heavy cross-validation ($N^2$ communication) and rigorous view changes guarantee that malicious nodes cannot trick subsets of the cluster into committing divergent values.*

---

# PBFT Timeline

:::static-timeline
{
  "zoom": 0.85,
  "ticks": 55,
  "trackHeight": 44,
  "stateBandOffset": 10,
  "servers": ["Primary", "Replica-1", "Replica-2", "Replica-3"],
  "states": [
    { "server": "Primary",   "start": 0,  "end": 4,  "state": "idle",             "color": "#cfd8dc" },
    { "server": "Primary",   "start": 5,  "end": 22, "state": "pre-prepared",     "color": "#ffb74d" },
    { "server": "Primary",   "start": 23, "end": 33, "state": "prepared",         "color": "#64b5f6" },
    { "server": "Primary",   "start": 34, "end": 55, "state": "committed",        "color": "#81c784" },
    { "server": "Replica-1", "start": 0,  "end": 11, "state": "idle",             "color": "#cfd8dc" },
    { "server": "Replica-1", "start": 12, "end": 24, "state": "pre-prepared",     "color": "#ffb74d" },
    { "server": "Replica-1", "start": 25, "end": 33, "state": "prepared",         "color": "#64b5f6" },
    { "server": "Replica-1", "start": 34, "end": 55, "state": "committed",        "color": "#81c784" },
    { "server": "Replica-2", "start": 0,  "end": 13, "state": "idle",             "color": "#cfd8dc" },
    { "server": "Replica-2", "start": 14, "end": 22, "state": "pre-prepared",     "color": "#ffb74d" },
    { "server": "Replica-2", "start": 23, "end": 35, "state": "prepared",         "color": "#64b5f6" },
    { "server": "Replica-2", "start": 36, "end": 55, "state": "committed",        "color": "#81c784" },
    { "server": "Replica-3", "start": 0,  "end": 55, "state": "TRAITOR (lying)",  "color": "#e57373" }
  ],
  "messages": [
    { "from": "Primary",   "to": "Replica-1", "sendTick": 5,  "recvTick": 12, "label": "PRE_PREPARE" },
    { "from": "Primary",   "to": "Replica-2", "sendTick": 5,  "recvTick": 14 },
    { "from": "Replica-1", "to": "Primary",   "sendTick": 13, "recvTick": 20, "label": "PREPARE" },
    { "from": "Replica-1", "to": "Replica-2", "sendTick": 13, "recvTick": 22 },
    { "from": "Replica-2", "to": "Primary",   "sendTick": 15, "recvTick": 22 },
    { "from": "Replica-2", "to": "Replica-1", "sendTick": 15, "recvTick": 24 },
    { "from": "Primary",   "to": "Replica-1", "sendTick": 24, "recvTick": 31, "label": "COMMIT" },
    { "from": "Primary",   "to": "Replica-2", "sendTick": 24, "recvTick": 33 },
    { "from": "Replica-1", "to": "Primary",   "sendTick": 26, "recvTick": 33 },
    { "from": "Replica-1", "to": "Replica-2", "sendTick": 26, "recvTick": 35 },
    { "from": "Replica-2", "to": "Primary",   "sendTick": 24, "recvTick": 31 },
    { "from": "Replica-2", "to": "Replica-1", "sendTick": 24, "recvTick": 33 }
  ]
}
:::

---

# PBFT Recovery & Checkpoints

Replicas keep all accepted messages in a stable log to help disconnected peers catch up.

Since the log grows indefinitely, PBFT periodically generates **stable checkpoints**.
* Every $N$ requests, the primary broadcasts a checkpoint containing the state digest.
* The primary waits for $2f + 1$ matching checkpoint responses from replicas.
* This constitutes proof that the state is correct, allowing logs preceding the checkpoint to be safely truncated.

<div class="callout-box">
    <h4>What to watch</h4>
    <p>A client pumps rapid requests through the 3-phase PBFT pipeline. Every 3 requests, the primary initiates a CHECKPOINT. Watch the replicas exchange hashes and aggressively garbage-collect their bloated logs once a 2f+1 quorum of matching checkpoints is gathered. The traitor node's fake hash is safely ignored!</p>
</div>

<div style="text-align: center; margin-top: 40px; margin-bottom: 40px;">
    <button class="demo-btn" onclick="showDemo('demos/consensus-pbft/demo.json')">
        Launch PBFT Checkpointing Demo
    </button>
</div>

---

# The PBFT Demo

The sandbox includes a BFT demonstration featuring $f=1$ traitors out of a 4-node primary/replica system. The primary issues a valid request, but the traitor sends conflicting `PREPARE` messages to different nodes. The $2f+1$ quorum threshold successfully filters out the Byzantine interference and completes the commit safely.

<div class="callout-box">
    <h4>What to watch</h4>
    <p>Notice how the malicious node (Replica-3, typically marked red in the UI) ignores standard protocol flows and broadcasts falsified PREPARE values. See how the honest nodes (Primary, Replica 1, Replica 2) cross-validate the responses, ignoring the outlier, hitting the threshold of 3 identical signatures, and proceeding through pre-prepared → prepared → committed safely.</p>
</div>

<div style="text-align: center; margin-top: 40px; margin-bottom: 40px;">
    <button class="demo-btn" onclick="showDemo('demos/consensus-pbft/demo.json')">
        Launch PBFT Demo
    </button>
</div>

---

# Consensus Summary

By moving from crash failures to fully Byzantine environments, the rules of coordination change drastically.

| Feature | Raft (Crash-Tolerance) | PBFT (Byzantine-Tolerance) |
|---|---|---|
| **Adversaries** | None. Nodes can crash/partition | Active. Nodes can lie/forge |
| **Required Quorum** | Majority ($> N/2$) | Supermajority ($> 2N/3$) |
| **Minimum Nodes** | $2f + 1$ (e.g., 3 for 1 failure) | $3f + 1$ (e.g., 4 for 1 failure) |
| **Message Complexity** | $O(N)$ leader to followers | $O(N^2)$ all-to-all cross-check |
| **Target Usecase** | Datacenter infrastructure (etcd) | Permissioned Blockchains |

---

# Epilogue: From Theory to Practice

## Distributed Databases: Global Consenus & Determinism

After understanding **Paxos** and **Raft**, we can now explore how global-scale databases use these consensus engines as building blocks for ACID transactions across the planet.

---

# Deterministic Transactions: Calvin

**Calvin** (used in FaunaDB) takes a unique approach: it removes the need for distributed locks and 2PC by pre-calculating a deterministic execution plan.

### System Architecture: The Sequencer/Scheduler Split

:::static-diagram
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
:::

---

# Calvin Phase Trace

:::static-timeline
{
  "ticks": 56,
  "zoom": 0.85,
  "labelWidth": 100,
  "servers": [
    "Client 1",
    "Sequencer",
    "Scheduler",
    "Worker 1",
    "Worker 2"
  ],
  "states": [
    { "server": "Client 1", "start": 5, "end": 10, "state": "Write D", "color": "#ffcdd2" },
    { "server": "Client 1", "start": 12, "end": 17, "state": "Read A", "color": "#c8e6c9" },
    { "server": "Sequencer", "start": 13, "end": 28, "state": "Batched", "color": "#fff9c4" },
    { "server": "Scheduler", "start": 30, "end": 37, "state": "Locked", "color": "#ffccbc" },
    { "server": "Scheduler", "start": 37, "end": 42, "state": "Planned", "color": "#d1c4e9" },
    { "server": "Worker 1", "start": 44, "end": 50, "state": "Execute", "color": "#b3e5fc" },
    { "server": "Worker 2", "start": 50, "end": 54, "state": "Execute", "color": "#b3e5fc" }
  ],
  "messages": [
    { "from": "Client 1", "to": "Sequencer", "sendTick": 10, "recvTick": 13 },
    { "from": "Client 1", "to": "Sequencer", "sendTick": 17, "recvTick": 20 },
    { "from": "Sequencer", "to": "Scheduler", "sendTick": 28, "recvTick": 30 },
    { "from": "Scheduler", "to": "Worker 1", "sendTick": 42, "recvTick": 44 },
    { "from": "Scheduler", "to": "Worker 2", "sendTick": 42, "recvTick": 50 }
  ]
}
:::

---

# Global Scale: Google Spanner

Google **Spanner** takes a contrasting approach: **per-shard Paxos groups with 2PC across shards**. 

### TrueTime & External Consistency

TrueTime explicitly represents clock uncertainty. `TT.now()` returns an interval $[earliest, latest]$ that is guaranteed to contain the absolute real time.

**The Commit Wait Rule**:
1. **Pick Timestamp**: The coordinator picks $s = TT.now().latest$.
2. **Commit Wait**: The coordinator must not commit (reply to client) until $TT.now().earliest > s$.

---

# System Hierarchy: The Universe View

:::static-diagram
{
  "width": 600,
  "height": 340,
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
    { "from": "p1", "to": "p3", "label": "Paxos Group (1 per shard)", "labelOffsetY": -20, "color": "#2196f3", "width": 1 }
  ],
  "groups": [
    { "x": 40, "y": 70, "width": 120, "height": 220, "label": "Zone: US-East-1", "dashed": true },
    { "x": 240, "y": 70, "width": 120, "height": 220, "label": "Zone: EU-West-1", "dashed": true },
    { "x": 440, "y": 70, "width": 120, "height": 220, "label": "Zone: US-West-2", "dashed": true }
  ]
}
:::

---

# Distributed Transactions: Percolator

<small>

**Percolator** (Google) provided a way to layer multi-row transactions on top of Bigtable (which only supports single-row atomicity).

- **Client-driven 2PC**: The client acts as the coordinator, managing locks stored directly in Bigtable columns.
- **Timestamp Oracle**: Relies on a centralized service (Oracle) to provide monotonically increasing timestamps for Snapshot Isolation.
- **Primary vs. Secondary**: Uses a "Primary Lock" to handle recovery. If the client crashes, the node that finds the lock checks the primary to decide whether to roll forward or back.

> Locks are released starting from the primary. Readers that observe uncommitted locks can consult the primary lock to determine if the transaction succeeded and proceed accordingly.

</small>

:::static-timeline
{
  "zoom": 0.8,
  "ticks": 56,
  "labelWidth": 140,
  "trackHeight": 60,
  "servers": [
    "Oracle",
    "Coordinator",
    "Shard-A (row A1)",
    "Shard-B (row B75)",
    "Shard-C (row C13)"
  ],
  "states": [
    { "server": "Oracle", "start": 0, "end": 56, "state": "ONLINE (TSO)", "color": "#b3e5fc" },

    { "server": "Coordinator", "start": 5, "end": 10, "state": "GET_START_TS", "color": "#cfd8dc" },
    { "server": "Coordinator", "start": 11, "end": 28, "state": "PREWRITE (TS=100)", "color": "#fff9c4" },
    { "server": "Coordinator", "start": 29, "end": 34, "state": "GET_COMMIT_TS", "color": "#cfd8dc" },
    { "server": "Coordinator", "start": 35, "end": 52, "state": "COMMIT (TS=101)", "color": "#e8f5e9" },
    { "server": "Coordinator", "start": 53, "end": 56, "state": "DONE", "color": "#81c784" },

    { "server": "Shard-A (row A1)", "start": 0, "end": 12, "state": "READY, $100", "color": "#e3f2fd" },
    { "server": "Shard-A (row A1)", "start": 13, "end": 36, "state": "LOCKED (Primary), $100", "color": "#ffe0b2" },
    { "server": "Shard-A (row A1)", "start": 37, "end": 56, "state": "COMMITTED, $0", "color": "#c8e6c9" },

    { "server": "Shard-B (row B75)", "start": 0, "end": 18, "state": "READY, $10", "color": "#e3f2fd" },
    { "server": "Shard-B (row B75)", "start": 19, "end": 42, "state": "LOCKED (@A), $10", "color": "#ffe0b2" },
    { "server": "Shard-B (row B75)", "start": 43, "end": 56, "state": "COMMITTED, $60", "color": "#c8e6c9" },

    { "server": "Shard-C (row C13)", "start": 0, "end": 24, "state": "READY, $5", "color": "#e3f2fd" },
    { "server": "Shard-C (row C13)", "start": 25, "end": 48, "state": "LOCKED (@A), $5", "color": "#ffe0b2" },
    { "server": "Shard-C (row C13)", "start": 49, "end": 56, "state": "COMMITTED, $55", "color": "#c8e6c9" }
  ],
  "messages": [
    { "from": "Coordinator", "to": "Oracle", "sendTick": 5, "recvTick": 8 },
    { "from": "Oracle", "to": "Coordinator", "sendTick": 9, "recvTick": 10 },

    { "from": "Coordinator", "to": "Shard-A (row A1)", "sendTick": 11, "recvTick": 14 },
    { "from": "Shard-A (row A1)", "to": "Coordinator", "sendTick": 15, "recvTick": 16 },

    { "from": "Coordinator", "to": "Shard-B (row B75)", "sendTick": 17, "recvTick": 20 },
    { "from": "Shard-B (row B75)", "to": "Coordinator", "sendTick": 21, "recvTick": 22 },

    { "from": "Coordinator", "to": "Shard-C (row C13)", "sendTick": 23, "recvTick": 26 },
    { "from": "Shard-C (row C13)", "to": "Coordinator", "sendTick": 27, "recvTick": 28 },

    { "from": "Coordinator", "to": "Oracle", "sendTick": 29, "recvTick": 32 },
    { "from": "Oracle", "to": "Coordinator", "sendTick": 33, "recvTick": 34 },

    { "from": "Coordinator", "to": "Shard-A (row A1)", "sendTick": 35, "recvTick": 38 },
    { "from": "Shard-A (row A1)", "to": "Coordinator", "sendTick": 39, "recvTick": 40 },

    { "from": "Coordinator", "to": "Shard-B (row B75)", "sendTick": 41, "recvTick": 44 },
    { "from": "Shard-B (row B75)", "to": "Coordinator", "sendTick": 45, "recvTick": 46 },

    { "from": "Coordinator", "to": "Shard-C (row C13)", "sendTick": 47, "recvTick": 50 },
    { "from": "Shard-C (row C13)", "to": "Coordinator", "sendTick": 51, "recvTick": 52 }
  ]
}
:::

---

# Percolator: Lazy Crash Recovery

In a traditional 2PC, a crashed coordinator stalls the database. Percolator avoids this by storing locks directly in the data rows and relying entirely on Lazy Recovery.

* **Shards are "Dumb" (No Timeouts):** Storage nodes (Bigtable) never run background timers. If a coordinator dies, the shard will hold its lock forever. Timeouts are guesses, and guessing destroys ACID safety.

* **The Client as Detective:** If a new transaction bumps into an old lock, the new client is forced to investigate. It checks the original coordinator's heartbeat in a coordination service (like Chubby/ZooKeeper).

* **Block and Clean:** If the heartbeat is dead, the new client looks up the Primary Lock to see if the transaction committed before the crash, and then safely rolls the blocked row forward or backward itself.

---

# Pillar 2: High Availability (AP / BASE)

<small>

While Spanner and Calvin fight for ACID properties, many systems choose the **Dynamo Path**: prioritizing availability even at the cost of temporary divergence.

</small>

**The Dynamo Legacy (DynamoDB, Riak)**

<small>

- **Vector Clocks**: Used to detect causal conflicts. Every mutation carries a vector $[node_1: c_1, node_2: c_2, \dots]$. If two vectors are incomparable, a conflict has occurred (divergent branch).
- **Sloppy Quorums**: If the designated $N$ nodes are down, the system writes to *handoff* nodes to ensure availability, which are then cleaned up via **Hinted Handoff**.
- **Merkle Trees**: Used in the background to detect differences between replicas (Anti-Entropy).

</small>

**Large Scale: Apache Cassandra**

<small>

Cassandra borrows the Dynamo architecture but optimizes for simpler conflict resolution:
- **Last-Write-Wins (LWW)**: Instead of complex vector clock merges, it uses the server's microsecond wall-clock timestamp to resolve conflicts.
- **Tunable Consistency**:
  - **CL.ONE**: Acknowledgement from 1 node.
  - **CL.QUORUM**: Acknowledgement from $\lfloor N/2 \rfloor + 1$.
  - **CL.ALL**: Acknowledgement from every node.

</small>

**Conflict-Free: Redis CRDTs**

<small>

For **Strong Eventual Consistency (SEC)**, Redis uses CRDTs (Conflict-Free Replicated Data Types):
- **G-Counter**: Increments only, uses vectors to track contributions and merges by taking the maximum of each index.
- **PN-Counter**: Supports increments and decrements by fusing two vectors.

</small>

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
