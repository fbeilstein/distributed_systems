**Three-Phase Commit**

In a situation where coordinator fails, remaining sites are bound to first select new coordinator. This new coordinator checks status of the protocol from the remaining sites. If the coordinator had decided to commit, at least one of other ‘k’ sites that it informed will be up and will ensure that commit decision is respected. The new coordinator restarts third phase of protocol if any of rest sites knew that old coordinator intended to commit transaction. Otherwise, new coordinator aborts the transaction.


The three-phase commit (3PC) protocol adds an extra step, and timeouts on both sides that can allow cohorts to proceed with either commit or abort in the event of coordinator failure, depending on the system state. 

3PC assumes a synchronous model and that communication failures are not possible.


* **Propose** The coordinator sends out a proposed value and collects the votes.
* **Prepare** The coordinator notifies cohorts about the vote results. If the vote has passed and all cohorts have decided to commit, the coordinator sends a Prepare message, instructing them to prepare to commit. Otherwise, an Abort message is sent and the round completes.
* **Commit** Cohorts are notified by the coordinator to commit the transaction.


Propose phase crash or timeout (coordinator or cohort) -> abort transaction.

Prepare phase crash or timeout (coordinator or cohort) -> abort transaction.

Commit phase crash or timeout (coordinator or cohort) -> commit transaction.


**Coordinator Failures in 3PC**


All state transitions are coordinated, and cohorts can’t move on to the next phase until everyone is done with the previous one: the coordinator has to wait for the replicas to continue. Cohorts can eventually abort the transaction if they do not hear from the coordinator before the timeout, if they didn’t move past the prepare phase.


As we discussed previously, 2PC cannot recover from coordinator failures, and
cohorts may get stuck in a nondeterministic state until the coordinator comes back. 3PC avoids blocking the processes in this case and allows cohorts to proceed with a deterministic decision.

**Problem:** new coordinator does not know the state of the DB on failed node and must wait for its recovery before proceeding commit or not. In 3PC **no** node changes its DB until **every** node is notified on expected commit.

The worst-case scenario for the 3PC is a network partition: some nodes successfully move to the prepared state, and now can proceed with commit after the timeout. Some can’t communicate with the coordinator, and will abort
after the timeout. This results in a split brain: some nodes proceed with a commit and some abort, all according to the protocol, leaving participants in an inconsistent and contradictory state

(+) particularly solves the problem with 2PC blocking

(-) larger message overhead

(-) introduces potential contradictions

(-) does not work well in the presence of network partitions. This might be the primary reason 3PC is not widely used in practice.