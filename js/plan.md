# Distributed Systems Sandbox - Implementation Plan

* review the demos in the `demos` directory
* all nodes up/downs should be controlled manually, remove any auto-up/auto-down logic
* check list of demos with plan.md: some demos may be redundant some missing - remove redundant, add missing
* if algorithm allows considering node logic as state machine - use Automat from automat.js
* during test raft client transitions idle -> waiting which is prohibited by graph of states - fix it
* some demos contain acknowledging messages that are not processed - remove them to make graph cleaner.


## Phase 1: Failure Detection Mechanisms
**Focus:** How nodes determine if peers are alive or dead.
1. **Heartbeats and Pings:** The baseline. Nodes periodically send ping messages and wait for ACKs.
2. **Timeout-Free Failure Detector:** Nodes pass an ever-growing path array to each other, avoiding strict timeouts. Will show how indirect reachability helps.
3. **Outsourced Heartbeats (SWIM):** If A can't reach B, A asks C and D to ping B on its behalf.
4. **Gossip Failure Detection:** Nodes randomly share their knowledge of who is alive.
5. **Reversing Failure Detection (FUSE):** If one node detects a failure, it stops responding, cascading the failure to the entire group safely.

## Phase 2: Leader Election Algorithms
**Focus:** How a cluster chooses a coordinator, and how it handles split brains.
1. **The Bully Algorithm:** Node with the highest ID "bullies" everyone else. 
  - *Demo Focus:* Show a cascading failure where Node 5 crashes, Node 3 claims leadership, but Node 4 wakes up and bullies Node 3.
2. **Next-In-Line Failover:** An optimization of Bully. The leader dictates a failover list so the cluster doesn't have to vote again.
  - *Demo Focus:* Show how much faster recovery is compared to base Bully when the leader crashes.
3. **Candidate/Ordinary Optimization:** An optimization where only specific pre-determined "candidate" nodes run for leader, reducing message overhead.
4. **Invitation Algorithm:** Leaders of small groups "invite" other peer groups to merge. Allows multiple leaders initially.
5. **Ring Algorithm:** Nodes form a logical ring and pass an election token around until it makes a full circle.

## Phase 3: Data Dissemination & Consistency
**Focus:** How data spreads and is ordered globally without centralized clocks.
1. **Vector Clocks:** Every node maintains an array of counters (e.g., `[1, 0, 2]`) to track exactly which events "caused" other events.
2. **Anti-Entropy (Read Repair / Hinted Handoff):** Visualizing how databases ensure all replicas eventually agree on the same data by fixing stale data during a read request.
3. **Consistent Hashing:** Animating how data keys are distributed across nodes on a logical ring, and how keys shift gracefully when a node joins or leaves.

## Phase 4: Advanced Consensus & Transactions
**Focus:** Guaranteeing absolute agreement even when failures occur mid-process.
1. **Two-Phase Commit (2PC):** (Already Implemented)
2. **Three-Phase Commit (3PC):** (Already Implemented) Show how the `Pre-Commit` phase guarantees recovery if the coordinator crashes during the collect phase.
3. **Raft:** (Already Implemented) Show randomized election timeouts resolving split votes.
4. **Paxos:** The original, uncompromising consensus algorithm.
  - *Demo Focus:* Two proposers wake up simultaneously and cause a "Dueling Proposers" livelock on the timeline.
5. **Multi-Paxos / Fast Paxos:** Optimizations of Paxos that skip the costly `Prepare` phase once a stable leader is established.
6. **PBFT (Practical Byzantine Fault Tolerance):** Consensus in an environment where nodes might actively lie or send malicious data.
  - *Demo Focus:* Introduce a `traitor.js` node that deliberately sends conflicting data. Watch the Quorum successfully filter it out.