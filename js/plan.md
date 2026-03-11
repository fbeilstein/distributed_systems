**Two-Phase Commit**

2PC executes in two phases. During the first phase, the decided value is distributed, and votes are collected. During the second phase, nodes just flip the switch, making the results of the first phase visible.


2PC assumes the presence of a **leader** (coordinator) that holds the state, collects votes, and is a primary point of reference for the agreement round. The rest of the nodes are called **cohorts** -- usually partitions that operate over disjoint datasets. 


The coordinator can be 
* node that received a request to execute the transaction
* picked at random
* by leader-election algorithm
* assigned manually
* fixed throughout the lifetime of the system
* transferred to another participant for reliability or performance


**Execution**
* **Prepare** The coordinator notifies cohorts about the new transaction by sending a **propose message**. Cohorts make a decision on whether or not they can commit the part of the transaction that applies to them. Then they send coordinator the vote "commit/abort".
* **Commit/abort** Operations within a transaction can change state across different partitions (each represented by a cohort). If even 1 votes for abort -> abort all message. If all commit -> commit all message.


During each step the coordinator and cohorts have to write the results of each operation to durable storage to be able to reconstruct the state and recover in case of local failures, and be able to forward and replay results for other participants.


In the context of database systems, each 2PC round is usually responsible for a single transaction. During the prepare phase, transaction contents (operations, identifiers, and other metadata) are transferred from the coordinator to the cohorts. The transaction is executed by the cohorts locally and is left in a **partially committed state** (sometimes called **precommitted**), making it ready for the coordinator to finalize execution during the next phase by either committing or aborting it. By the time the transaction commits, its contents are already stored durably on all other nodes.


**Coordinator Failures in 2PC**


* coordinator made decision, but link to particular node failed -> node requests decision from peers. Replicating commit decisions is safe since it’s always unanimous: the whole point of 2PC is to either commit or abort on all sites, and commit on one cohort implies that all other cohorts have to commit.
* coordinator collects votes and fails -> wait for coordinator recovery or choose new coordinator and revote

Many databases use 2PC: MySQL, PostgreSQL, MongoDB, etc. 


(+) simple (easy to reason about, implement, and debug)

(+) low overhead (message complexity and the number of round-trips of the protocol are low)

(-) needs proper recovery mechanisms

(-) A two-phase commit protocol cannot dependably recover from a failure of **both** the coordinator and a cohort member during the Commit phase. If both the coordinator and a cohort member failed, it is possible that the failed cohort member was the first to be notified, and had actually done the commit.
