# Distributed Systems (draft)


## Lectures

* Lecture 1. Introduction to Distributed Systems
  - [Lecture Slides](https://fbeilstein.github.io/distributed_systems/slides.html?file=lectures/intro_to_distributed_systems.md)
* Lecture 2. Failure Detection Mechanisms
  - [Lecture Slides](https://fbeilstein.github.io/distributed_systems/slides.html?file=lectures/failure_detection.md)
  - <details> <summary>Demos</summary>
    
    * [Pings](https://fbeilstein.github.io/distributed_systems/js/distributed_systems/index.html?code=../../demos/failure-pings/demo.json)
    * [Heartbeats](https://fbeilstein.github.io/distributed_systems/js/distributed_systems/index.html?code=../../demos/failure-heartbeats/demo.json)
    * [Timeout-Free Failure Detector](https://fbeilstein.github.io/distributed_systems/js/distributed_systems/index.html?code=../../demos/failure-timeout-free/demo.json)
    * [Outsourced Heartbeats](https://fbeilstein.github.io/distributed_systems/js/distributed_systems/index.html?code=../../demos/failure-swim/demo.json)
    * [Phi-Accrual Failure Detector](https://fbeilstein.github.io/distributed_systems/js/distributed_systems/index.html?code=../../demos/failure-phi/demo.json)
    * [Gossip Failure Detection](https://fbeilstein.github.io/distributed_systems/js/distributed_systems/index.html?code=../../demos/failure-gossip/demo.json)
    * [FUSE (failure notification service)](https://fbeilstein.github.io/distributed_systems/js/distributed_systems/index.html?code=../../demos/failure-fuse/demo.json)
    </details>
* Lecture 3. Leader Election
  - [Lecture Slides](https://fbeilstein.github.io/distributed_systems/slides.html?file=lectures/leader_election.md)
  - <details> <summary>Demos</summary>
    
    * [Bully Algorithm](https://fbeilstein.github.io/distributed_systems/js/distributed_systems/index.html?code=../../demos/election-bully/demo.json)
    * [Next-In-Line Failover](https://fbeilstein.github.io/distributed_systems/js/distributed_systems/index.html?code=../../demos/election-failover/demo.json)
    * [Candidate/Ordinary Optimization](https://fbeilstein.github.io/distributed_systems/js/distributed_systems/index.html?code=../../demos/election-candidates/demo.json)
    * [Invitation Algorithm](https://fbeilstein.github.io/distributed_systems/js/distributed_systems/index.html?code=../../demos/election-invitation/demo.json)
    * [Ring Algorithm](https://fbeilstein.github.io/distributed_systems/js/distributed_systems/index.html?code=../../demos/election-ring/demo.json)
    </details>
* Lecture 4. Replication
  - [Lecture Slides](https://fbeilstein.github.io/distributed_systems/slides.html?file=lectures/replication.md)
  - <details> <summary>Demos</summary>
    
    * [Reusable Infrastructure for Linearizability](https://fbeilstein.github.io/distributed_systems/js/distributed_systems/index.html?code=../../demos/replication-rifl/demo.json)
    </details>
* Lecture 5. Consistency
  - [Lecture Slides](https://fbeilstein.github.io/distributed_systems/slides.html?file=lectures/consistency.md)
  - <details> <summary>Demos</summary>
    
    * [Vector Clocks](https://fbeilstein.github.io/distributed_systems/js/distributed_systems/index.html?code=../../demos/consistency-vector-clocks/demo.json)
    </details>
* Lecture 6. Anti-Entropy and Dissemination
  - [Lecture Slides](https://fbeilstein.github.io/distributed_systems/slides.html?file=lectures/anti_entropy.md)
  - <details> <summary>Demos</summary>
    
    * [Read Repair & Hinted Handoff](https://fbeilstein.github.io/distributed_systems/js/distributed_systems/index.html?code=../../demos/anti-entropy-hinted-handoff/demo.json)
    * [Merkle Tree](https://fbeilstein.github.io/distributed_systems/demos/anti-entropy-merkle-tree/index.html)
    * [Bitmap Version Vectors](https://fbeilstein.github.io/distributed_systems/js/distributed_systems/index.html?code=../../demos/anti-entropy-version-vectors/demo.json)
    * [Gossip Dissemination](https://fbeilstein.github.io/distributed_systems/js/distributed_systems/index.html?code=../../demos/anti-entropy-gossip/demo.json)
    * [Plumtree](https://fbeilstein.github.io/distributed_systems/js/distributed_systems/index.html?code=../../demos/anti-entropy-plumtree/demo.json)
    </details>
* Lecture 7. Distributed Transactions
  - [Lecture Slides](https://fbeilstein.github.io/distributed_systems/slides.html?file=lectures/distributed_transactions.md)
  - <details> <summary>Demos</summary>
    
    * [2 Phase Commit](https://fbeilstein.github.io/distributed_systems/js/distributed_systems/index.html?code=../../demos/transactions-two-phase-commit/demo.json)
    * [3 Phase Commit](https://fbeilstein.github.io/distributed_systems/js/distributed_systems/index.html?code=../../demos/transactions-three-phase-commit/demo.json)
    * [Consistent Hashing](https://fbeilstein.github.io/distributed_systems/demos/transactions-consistent-hashing/index.html)
    </details>
* Lecture 8. Consensus: Paxos
  - [Lecture Slides](https://fbeilstein.github.io/distributed_systems/slides.html?file=lectures/consensus_paxos.md)
  - <details> <summary>Demos</summary>
    
    * [Paxos](https://fbeilstein.github.io/distributed_systems/js/distributed_systems/index.html?code=../../demos/consensus-paxos/demo.json)
    * [Multi-Paxos](https://fbeilstein.github.io/distributed_systems/js/distributed_systems/index.html?code=../../demos/consensus-multi-paxos/demo.json)
    * [Fast Paxos](https://fbeilstein.github.io/distributed_systems/js/distributed_systems/index.html?code=../../demos/consensus-fast-paxos/demo.json)
    * [Egalitarian Paxos](https://fbeilstein.github.io/distributed_systems/js/distributed_systems/index.html?code=../../demos/consensus-egalitarian-paxos/demo.json)
    * [Flexible Paxos](https://fbeilstein.github.io/distributed_systems/js/distributed_systems/index.html?code=../../demos/consensus-flexible-paxos/demo.json)
    * [Generalized Paxos](https://fbeilstein.github.io/distributed_systems/js/distributed_systems/index.html?code=../../demos/consensus-generalized-paxos/demo.json)
    </details>
* Lecture 9. Consensus: ZAB, Raft, and PBFT
  - [Lecture Slides](https://fbeilstein.github.io/distributed_systems/slides.html?file=lectures/consensus_zab_raft_pbft.md)
  - <details> <summary>Demos</summary>
    
    * [ZAB](https://fbeilstein.github.io/distributed_systems/js/distributed_systems/index.html?code=../../demos/consensus-zab/demo.json)
    * [Raft](https://fbeilstein.github.io/distributed_systems/js/distributed_systems/index.html?code=../../demos/consensus-raft/demo.json)
    * [PBFT](https://fbeilstein.github.io/distributed_systems/js/distributed_systems/index.html?code=../../demos/consensus-pbft/demo.json)
    </details>



## Sandbox

* [Distributed Systems Visualization Playground](https://fbeilstein.github.io/distributed_systems/js/distributed_systems/index.html)

## Guides

* [How to write slides](./guides/how_to_write_slides.md)
* [How to write demos](./guides/how_to_write_demos.md)
* [How to create static timelines](./guides/how_to_write_timelines.md)

