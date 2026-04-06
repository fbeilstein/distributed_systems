# Consensus: ZAB, Raft, and PBFT
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

# Virtual Synchrony

Most protocols assume a fixed group of processes. **Virtual synchrony** delivers totally ordered messages to a *dynamic* group of peers.

* Messages are associated with a specific **group view**.
* A group view changes when a node joins, leaves, or fails.
* The view change acts as a **barrier**: a message sent in one view is delivered *only* in that view.

While technically sound, virtual synchrony has largely been superseded in modern systems by replicated state machines using Paxos or Raft.

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

> *ZAB's broadcast is highly efficient, requiring only two rounds of messages. It behaves like Two-Phase Commit without aborts.*

<div class="callout-box">
    <h4>What to watch</h4>
    <p>Watch the prospective leader drive the cluster through Discovery (CEPOCH / ACK-E) to establish the highest Zxid, then Synchronization (NEWLEADER / ACK-LD) to align everyone's history. Only after a quorum is synced does it broadcast UPTODATE and begin sequencing regular proposals.</p>
</div>

<div style="text-align: center; margin-top: 40px; margin-bottom: 40px;">
    <button class="demo-btn" onclick="showDemo('demos/zab/demo.json')" style="font-size: 1.5rem; padding: 15px 30px; background: #e65100; color: white; border: none; border-radius: 6px; cursor: pointer;">
        Launch ZAB Epoch Sync Demo
    </button>
</div>

---

# Raft: Understandable Consensus

[**Raft**](https://raft.github.io/) was designed explicitly to be a more understandable alternative to Paxos, while providing the same safety and performance.

Locally, participants store a **log** of commands. By applying identical logs in the same order, state machines arrive at identical results.

Raft simplifies consensus by making the concept of a **strong leader** a first-class citizen. Most of the time, the cluster simply accepts appends from the stable leader.

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

```static-timeline
{
  "zoom": 0.85,
  "ticks": 70,
  "trackHeight": 44,
  "stateBandOffset": 10,
  "servers": ["Node-1", "Node-2", "Node-3", "Node-4", "Node-5"],
  "states": [
    { "server": "Node-1", "start": 0,  "end": 20, "state": "follower (timeout!)","color": "#b2dfdb" },
    { "server": "Node-1", "start": 21, "end": 40, "state": "candidate (term 2)",   "color": "#ffb74d" },
    { "server": "Node-1", "start": 41, "end": 70, "state": "leader (term 2)",      "color": "#90caf9" },
    { "server": "Node-2", "start": 0,  "end": 25, "state": "follower",             "color": "#b2dfdb" },
    { "server": "Node-2", "start": 26, "end": 70, "state": "follower (voted N1)",  "color": "#80cbc4" },
    { "server": "Node-3", "start": 0,  "end": 27, "state": "follower",             "color": "#b2dfdb" },
    { "server": "Node-3", "start": 28, "end": 70, "state": "follower (voted N1)",  "color": "#80cbc4" },
    { "server": "Node-4", "start": 0,  "end": 70, "state": "follower (offline)",   "color": "#cfd8dc" },
    { "server": "Node-5", "start": 0,  "end": 70, "state": "follower (offline)",   "color": "#cfd8dc" }
  ],
  "messages": [
    { "from": "Node-1", "to": "Node-2", "sendTick": 21, "recvTick": 26, "label": "RequestVote" },
    { "from": "Node-1", "to": "Node-3", "sendTick": 21, "recvTick": 28 },
    { "from": "Node-2", "to": "Node-1", "sendTick": 27, "recvTick": 35, "label": "VoteGranted" },
    { "from": "Node-3", "to": "Node-1", "sendTick": 29, "recvTick": 38 },
    { "from": "Node-1", "to": "Node-2", "sendTick": 42, "recvTick": 47, "label": "Heartbeat" },
    { "from": "Node-1", "to": "Node-3", "sendTick": 42, "recvTick": 48 }
  ]
}
```

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

```static-timeline
{
  "zoom": 0.85,
  "ticks": 65,
  "trackHeight": 44,
  "stateBandOffset": 10,
  "servers": ["Client", "Leader", "Replica-1", "Replica-2", "Replica-3"],
  "states": [
    { "server": "Leader",    "start": 0,  "end": 14, "state": "idle",                 "color": "#cfd8dc" },
    { "server": "Leader",    "start": 15, "end": 44, "state": "replicating entry 5",  "color": "#ffb74d" },
    { "server": "Leader",    "start": 45, "end": 65, "state": "committed entry 5",    "color": "#81c784" },
    { "server": "Replica-1", "start": 0,  "end": 24, "state": "log length 4",         "color": "#b2dfdb" },
    { "server": "Replica-1", "start": 25, "end": 65, "state": "log length 5 (uc)",    "color": "#80cbc4" },
    { "server": "Replica-2", "start": 0,  "end": 26, "state": "log length 4",         "color": "#b2dfdb" },
    { "server": "Replica-2", "start": 27, "end": 65, "state": "log length 5 (uc)",    "color": "#80cbc4" },
    { "server": "Replica-3", "start": 0,  "end": 65, "state": "offline / delayed",    "color": "#cfd8dc" }
  ],
  "messages": [
    { "from": "Client",    "to": "Leader",    "sendTick": 5,  "recvTick": 14, "label": "x = 25" },
    { "from": "Leader",    "to": "Replica-1", "sendTick": 16, "recvTick": 24, "label": "AppendEntries" },
    { "from": "Leader",    "to": "Replica-2", "sendTick": 16, "recvTick": 26 },
    { "from": "Replica-1", "to": "Leader",    "sendTick": 26, "recvTick": 35, "label": "ACK" },
    { "from": "Replica-2", "to": "Leader",    "sendTick": 28, "recvTick": 38 },
    { "from": "Leader",    "to": "Client",    "sendTick": 46, "recvTick": 55, "label": "OK" }
  ]
}
```

---

# Raft: Consistency Guarantees

Raft's `AppendEntries` implements a powerful consistency check:

When a leader sends an entry, it includes the index and term of the **immediately preceding** entry in its log. If a follower does not find an entry in its log with the same index and term, it **refuses** the new entries.

If the logs diverge, the leader systematically decrements its local `nextIndex` for that follower and retries until they find the point where the logs match. The leader then overwrites the follower's history from that point forward.

> *The leader’s log is sacred. It is never overwritten or deleted, only appended to.*

<div class="callout-box">
    <h4>What to watch</h4>
    <p>This demo starts with a hardcoded, severe partition state: the Follower's log has entirely diverged from the Leader's in an older term. Watch the Leader's `AppendEntries` get rejected, forcing the Leader to iteratively step backwards until the logs align, at which point the follower's corrupt history is truncated and rewritten.</p>
</div>

<div style="text-align: center; margin-top: 40px; margin-bottom: 40px;">
    <button class="demo-btn" onclick="showDemo('demos/raft-divergence/demo.json')" style="font-size: 1.5rem; padding: 15px 30px; background: #004d40; color: white; border: none; border-radius: 6px; cursor: pointer;">
        Launch Raft Log Divergence Demo
    </button>
</div>

---

# The Raft Demo

Observe the entire Raft life cycle: Follower timeouts, split votes, leader election, heartbeats, and client request replication.

<div class="callout-box">
    <h4>What to watch</h4>
    <p>Notice how Node-0 starts with a short election timeout, quickly becoming Candidate and then Leader. Watch the periodic heartbeats holding the followers back from starting new elections. If you inject a client request, observe the Leader appending it and rolling it out via outbox messages, waiting for ACKs to hit the commit threshold.</p>
</div>

<div style="text-align: center; margin-top: 40px; margin-bottom: 40px;">
    <button class="demo-btn" onclick="showDemo('demos/raft/demo.json')" style="font-size: 1.5rem; padding: 15px 30px; background: #00796b; color: white; border: none; border-radius: 6px; cursor: pointer;">
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
| Membership changes | Ad-hoc per implementation | Joint-consensus protocol |
| Understandability | Complex (many papers needed) | Single, complete paper |
| Performance | Comparable | Comparable |

> *Raft is Paxos made explicit: it trades some flexibility for clarity and a reference implementation.*

---

# Transition: Enter the Adversary

Until now, we assumed **crash failures**. Nodes stop, but they don't lie. They execute algorithms in "good faith."

What if the system is deployed over public, adversarial networks? What if nodes suffer from targeted intrusions, severe data corruption, or malicious operators?

A node might send 'X' to one replica and 'Y' to another, intentionally trying to split the network.

Consensus in the presence of malicious actors is known as **Byzantine Fault Tolerance (BFT)**.

---

# Byzantine Quorums

Most Byzantine consensus algorithms require $O(N^2)$ messages to complete a step. Because you cannot trust the leader, **every node must cross-validate everything with every other node** using cryptographic signatures.

To tolerate $f$ Byzantine (malicious) nodes, a system requires **$3f + 1$** total nodes.

**Why $3f+1$?**
Suppose $f$ nodes are malicious and $f$ nodes are just honest-but-offline (network partition). We must be able to make a decision using the remaining $N - 2f$ nodes.
For the remaining nodes to safely outvote the $f$ malicious ones, we need:
$(N - 2f) > f \implies N > 3f$
Since $N$ is an integer, $N \ge 3f + 1$.

*To survive 1 malicious node, you need 4 nodes total.*

---

# PBFT: Practical Byzantine Fault Tolerance

**PBFT** operates in views, with one primary and all others as backups. If the primary goes rogue, the view changes.

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
Backups accept the pre-prepare if signatures are valid. They then broadcast a `PREPARE` to *all* other replicas. A node becomes "prepared" only when it sees matching `PREPARE` messages from **$2f$** different backups.

**Phase 3: Commit**
Once prepared, the node broadcasts a `COMMIT`. It waits to collect **$2f + 1$** matching `COMMIT` messages. Only then is the operation finally executed and the reply sent to the client.

> *The heavy cross-validation ($N^2$ communication) guarantees that malicious nodes cannot trick subsets of the cluster into committing divergent values.*

---

# PBFT Timeline

```static-timeline
{
  "zoom": 0.85,
  "ticks": 85,
  "trackHeight": 44,
  "stateBandOffset": 10,
  "servers": ["Primary", "Replica-1", "Replica-2", "Replica-3"],
  "states": [
    { "server": "Primary",   "start": 0,  "end": 14, "state": "idle",             "color": "#cfd8dc" },
    { "server": "Primary",   "start": 15, "end": 44, "state": "pre-prepared",     "color": "#ffb74d" },
    { "server": "Primary",   "start": 45, "end": 64, "state": "prepared",         "color": "#64b5f6" },
    { "server": "Primary",   "start": 65, "end": 85, "state": "committed",        "color": "#81c784" },
    { "server": "Replica-1", "start": 0,  "end": 24, "state": "idle",             "color": "#cfd8dc" },
    { "server": "Replica-1", "start": 25, "end": 49, "state": "pre-prepared",     "color": "#ffb74d" },
    { "server": "Replica-1", "start": 50, "end": 69, "state": "prepared",         "color": "#64b5f6" },
    { "server": "Replica-1", "start": 70, "end": 85, "state": "committed",        "color": "#81c784" },
    { "server": "Replica-2", "start": 0,  "end": 26, "state": "idle",             "color": "#cfd8dc" },
    { "server": "Replica-2", "start": 27, "end": 52, "state": "pre-prepared",     "color": "#ffb74d" },
    { "server": "Replica-2", "start": 53, "end": 74, "state": "prepared",         "color": "#64b5f6" },
    { "server": "Replica-2", "start": 75, "end": 85, "state": "committed",        "color": "#81c784" },
    { "server": "Replica-3", "start": 0,  "end": 85, "state": "TRAITOR (lying)",  "color": "#e57373" }
  ],
  "messages": [
    { "from": "Primary",   "to": "Replica-1", "sendTick": 15, "recvTick": 25, "label": "PRE_PREPARE" },
    { "from": "Primary",   "to": "Replica-2", "sendTick": 15, "recvTick": 27 },
    { "from": "Replica-1", "to": "Primary",   "sendTick": 26, "recvTick": 36, "label": "PREPARE" },
    { "from": "Replica-1", "to": "Replica-2", "sendTick": 26, "recvTick": 38 },
    { "from": "Replica-2", "to": "Primary",   "sendTick": 28, "recvTick": 40 },
    { "from": "Replica-2", "to": "Replica-1", "sendTick": 28, "recvTick": 42 },
    { "from": "Primary",   "to": "Replica-1", "sendTick": 46, "recvTick": 56, "label": "COMMIT" },
    { "from": "Primary",   "to": "Replica-2", "sendTick": 46, "recvTick": 58 },
    { "from": "Replica-1", "to": "Primary",   "sendTick": 51, "recvTick": 61 },
    { "from": "Replica-2", "to": "Primary",   "sendTick": 54, "recvTick": 64 }
  ]
}
```

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
    <button class="demo-btn" onclick="showDemo('demos/pbft-checkpointing/demo.json')" style="font-size: 1.5rem; padding: 15px 30px; background: #c62828; color: white; border: none; border-radius: 6px; cursor: pointer;">
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
    <button class="demo-btn" onclick="showDemo('demos/pbft/demo.json')" style="font-size: 1.5rem; padding: 15px 30px; background: #e53935; color: white; border: none; border-radius: 6px; cursor: pointer;">
        Launch PBFT Demo
    </button>
</div>

---

# Lecture Summary

By moving from crash failures to fully Byzantine environments, the rules of coordination change drastically.

| Feature | Raft (Crash-Tolerance) | PBFT (Byzantine-Tolerance) |
|---|---|---|
| **Adversaries** | None. Nodes can crash/partition | Active. Nodes can lie/forge |
| **Required Quorum** | Majority ($> N/2$) | Supermajority ($> 2N/3$) |
| **Minimum Nodes** | $2f + 1$ (e.g., 3 for 1 failure) | $3f + 1$ (e.g., 4 for 1 failure) |
| **Message Complexity** | $O(N)$ leader to followers | $O(N^2)$ all-to-all cross-check |
| **Target Usecase** | Datacenter infrastructure (etcd) | Permissioned Blockchains |


