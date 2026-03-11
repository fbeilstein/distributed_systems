**Raft**


It was first presented in a paper titled [“In Search of an Understandable Consensus Algorithm”](https://web.stanford.edu/~ouster/cgi-bin/papers/raft-atc14) (implementation **LogCabin**).


Locally, participants store a log containing the sequence of commands executed by the state machine. Since inputs that processes receive are identical and logs contain the same commands in the same order, applying these commands to the state machine guarantees the same output. 

Raft simplifies consensus by making the concept of leader a first-class citizen. A leader is used to coordinate state machine manipulation and replication. 

There are many similarities between Raft and atomic broadcast algorithms, as well as Multi-Paxos: a single leader emerges from replicas, makes atomic decisions, and establishes the message order.


Each participant in Raft can take one of three roles:
* **Candidate**
Leadership is a temporary condition, and any participant can take this role. To
become a leader, the node first has to transition into a candidate state, and
attempt to collect a majority of votes. If a candidate neither wins nor loses the election (the vote is split between multiple candidates and none of them has a majority of votes), the new term is slated and election restarts.
* **Leader**
A current, temporary cluster leader that handles client requests and interacts
with a replicated state machine. The leader is elected for a period called a **term**. Each term is identified by a monotonically increasing number and may continue for an arbitrary time period. A new leader is elected if the current one crashes, becomes unresponsive, or is suspected by other processes to have failed, which can happen because of network partitions and message delays.
* **Follower**
A passive participant that persists log entries and responds to requests from the leader and candidates. Follower in Raft is a role similar to acceptor and learner from Paxos. Every process begins as a follower.


It may happen that different participants disagree on which term is current, since they can find out about the new term at different times, or could have missed the leader election for one or multiple terms. Since each message contains a term identifier, if one of the participants discovers that its term is out-of-date, it updates the term to the higher-numbered one. 

This means that there may be several terms in flight at any given point in time, but the higher-numbered one wins in case of a conflict. A node updates the term only if it starts a new election process or finds out that its term is out-of-date.

On startup, or whenever a follower doesn’t receive messages from the leader and suspects that it has crashed, it starts the leader election process. A participant attempts to become a leader by transitioning into the candidate state and collecting votes from the majority of nodes.

The main components of the Raft algorithm:
* **Leader election**
Candidate P1 sends a RequestVote message to the other processes. This message
includes the candidate’s term, the last term known by it, and the ID of the last log entry it has observed. After collecting a majority of votes, the candidate is successfully elected as a leader for the term. Each process can give its vote to at most one candidate.
* **Periodic heartbeats**
The protocol uses a heartbeat mechanism to ensure the liveness of participants.
The leader periodically sends heartbeats to all followers to maintain its term. If a follower doesn’t receive new heartbeats for a period called an election timeout, it assumes that the leader has failed and starts a new election.
* **Log replication / broadcast**
The leader can repeatedly append new values to the replicated log by sending
AppendEntries messages. The message includes the leader’s term, index, and
term of the log entry that immediately precedes the ones it’s currently sending,
and one or more entries to store.


**Leader Role in Raft**


A leader can be elected **only from the nodes holding all committed entries**: if during the election, the follower’s log information is more up-to-date (in other words, has a higher term ID, or a longer log entry sequence, if terms are equal) than the candidate’s, its vote is denied. To win the vote, a candidate has to collect a majority of votes.

Once elected, the leader has to accept client requests (which can also be forwarded to it from other nodes) and replicate them to the followers. This is done by appending the entry to its log and sending it to all the followers in parallel.

When a follower receives an AppendEntries message, it appends the entries from the message to the local log, and acknowledges the message, letting the leader know that it was persisted. As soon as enough replicas send their acknowledgments, the entry is considered committed and is marked correspondingly in the leader log.


Since only the most up-to-date candidates can become a leader, followers never have to bring the leader up-to-date, and log entries are only flowing from leader to follower and not vice versa.

client | leader | replica 1 | replica 2 | replica 3 
---|---|---|---|---
idle | [x=1, y=7, x=2] | [x=1, y=7, x=2] | [x=1, y=7, x=2] | [x=1, y=7, x=2]
request x = 25 -> | [x=1, y=7, x=2], req: x = 25 | [x=1, y=7, x=2] | [x=1, y=7, x=2] | [x=1, y=7, x=2]
idle | [x=1, y=7, x=2], req: x = 25, notify on req -> | [x=1, y=7, x=2], req: x = 25 | [x=1, y=7, x=2], req: x = 25 | [x=1, y=7, x=2], req: x = 25 
idle | [x=1, y=7, x=2], req: x = 25| <- ack, [x=1, y=7, x=2], req: x = 25 | <- ack, [x=1, y=7, x=2], req: x = 25 | <- ack, [x=1, y=7, x=2], req: x = 25 
idle | [x=1, y=7, x=2, x=25], commit ->| [x=1, y=7, x=2,x=25] | [x=1, y=7, x=2, x=25] | [x=1, y=7, x=2, x=25] 
idle | [x=1, y=7, x=2, x=25] | <- ack, [x=1, y=7, x=2,x=25] | <- ack, [x=1, y=7, x=2, x=25] | <- ack, [x=1, y=7, x=2, x=25] 
req OK | <- ack, [x=1, y=7, x=2, x=25] | [x=1, y=7, x=2,x=25] | [x=1, y=7, x=2, x=25] | [x=1, y=7, x=2, x=25] 

* Leader has the most recent view of the events. The leader proceeds by replicating the entries to the followers, and committing them after collecting acknowledgments. 
* Committing an entry also commits all entries preceding it in the log. 
* Only the leader can make a decision on whether or not the entry can be committed. 
* Each log entry is marked with a term ID and a log index, identifying its position in the log. 
* Committed entries are guaranteed to be replicated to the quorum of participants and are safe to be applied to the state machine in the order they appear in the log



**Failure Scenarios**


When multiple followers decide to become candidates, and no candidate can collect a majority of votes, the situation is called a **split vote**. Raft uses randomized timers to reduce the probability of multiple subsequent elections ending up in a split vote. One of the candidates can start the next election round earlier and collect enough votes, while the others sleep and give way to it. This approach speeds up the election without requiring any additional coordination between candidates.

Followers may be down or slow to respond, and the leader has to make the best effort to ensure message delivery. It can try sending messages again if it doesn’t receive an acknowledgment within the expected time bounds. As a performance optimization, it can send multiple messages in parallel.



**Raft guarantees**


* Since entries replicated by the leader are uniquely identified, repeated message delivery is guaranteed not to break the log order. Followers deduplicate messages using their sequence IDs, ensuring that double delivery has no undesired side effects. Sequence IDs are also used to ensure the log ordering. 

* If entries in two logs on different replicas have the same term and the same index, they store the same command and all entries that precede them are the same.

* Raft guarantees to never show an uncommitted message as a committed one but not vice versa. Already committed messages can still be seen as in progress, which is a rather harmless property and can be worked around by retrying a client command until it is finally committed.

* For failure detection, the leader has to send heartbeats to the followers. This way, the leader maintains its term. When one of the nodes notices that the current leader is down, it attempts to initiate the election. 

* The newly elected leader has to restore the state of the cluster to the last known up-to-date log entry. 
 - It does so by finding a **common ground** (the highest log entry on which both the leader and follower agree), 
 - ordering followers to discard all (uncommitted) entries appended after this point
 - then sends the most recent entries from its log, overwriting the followers’ history. 
 
* The leader’s own log records are never removed or overwritten: it can only append entries to its own log.

* Only one leader can be elected at a time for a given term; no two leaders can be active during the same term.

* Committed log entries are guaranteed to be present in logs for subsequent leaders and cannot get reverted, since before the entry is committed it is known to be replicated by the leader.

* All messages are identified uniquely by the message and term IDs; neither current nor subsequent leaders can reuse the same identifier for the different entry.

Since its appearance, Raft has become very popular and is currently used in many
databases and other distributed systems, including CockroachDB, Etcd, and Consul. This can be attributed to its simplicity, but also may mean that Raft lives up to the promise of being a reliable consensus algorithm.