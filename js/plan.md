I started developing 2 phase commit demo tha twill look a bit better. I have certain requirements and some draft of "a bit functional" code. Main achievement: the code is more concise and performs sending messages on different ticks for better visuals on the diagram. What I would like to do is finishing implementation to correspond to 2 phase commit requirements (below). What else would be great: as i see code tends to be state machine, maybe this can be used to advantage and simplify some things.

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

# current coordinator

function onUp() {
  dumpState({
    phase: "idle",
    wait: 10,
    recipients: [1, 2, 3],
    ack: [],
    data: {msg: "prepare", data: "some data"}
  });
}

function onTimer(tick) {
  let s = loadState();
  s.tick = tick;
  s.wait -= 1;

  // 1. Start Phase 1
  if (s.phase === "idle" && s.wait <= 0) {
    s.phase = "notify";
  }

  // 2. Phase 1: Send Prepare Messages
  if (s.phase === "notify") {
    if (s.recipients.length > 0) {
      sendMessage(s.recipients.pop(), s.data);
    }
    
    // Once all sent, switch to waiting
    if (s.recipients.length === 0) {
      s.phase = "collect_ack";
      s.wait = 20; 
      s.recipients = [1, 2, 3]; // Reset targets for Phase 2
    }
  }

  // 3. Evaluate Phase 1 Results
  if (s.phase === "collect_ack") {
    if (s.ack.length === 3) {
      s.phase = "commit"; // Eager commit: all acks received
    } else if (s.wait <= 0) {
      s.phase = "abort";  // Timeout: missing acks
    }
  }

  // 4. Phase 2: Send Commit
  if (s.phase === "commit" && s.recipients.length > 0) {
    sendMessage(s.recipients.pop(), {msg: "commit"});
  }

  // 4 (Alt). Phase 2: Send Abort
  if (s.phase === "abort" && s.recipients.length > 0) {
    sendMessage(s.recipients.pop(), {msg: "abort"});
  }
  
  dumpState(s);
}

function onMessage(message) {
  let s = loadState();
  const m = message.payload;
  
  // Accept acks during both the sending and waiting phases
  if ((s.phase === 'notify' || s.phase === 'collect_ack') && m.approved === "OK") {
    // Prevent duplicate ACKs from the same recipient
    if (!s.ack.includes(message.from)) { 
      s.ack.push(message.from);
    }
  }
  
  dumpState(s);
}

# current Node

function onUp() {
  dumpState({
    status: "idle", 
    pendingData: null,
    data: null,
    wait: 0 // New timer for the participant
  });
}

function onTimer(tick) {
  let s = loadState();
  s.tick = tick;
  
  // If we are waiting for the coordinator's final verdict, count down
  if (s.status === 'prepared') {
    s.wait -= 1;
    
    // The coordinator died or the message was dropped! 
    if (s.wait <= 0) {
      s.status = 'blocked'; 
      // The node is now frozen. It cannot commit, and it cannot abort.
    }
  }
  
  dumpState(s);
}

function onMessage(message) {
  let s = loadState();
  const m = message.payload;

  // Phase 1: Receive Prepare and Vote
  if (m.msg === 'prepare' && s.status === 'idle') {
    s.pendingData = m.data;
    s.status = 'prepared'; 
    s.wait = 30; // Start the doomsday clock waiting for Phase 2
    sendMessage(message.from, {approved: 'OK'});
  }

  // Phase 2: Receive Commit
  if (m.msg === 'commit' && (s.status === 'prepared' || s.status === 'blocked')) {
    s.data = s.pendingData; 
    s.pendingData = null;   
    s.status = 'idle';      
    s.wait = 0;
  }

  // Phase 2: Receive Abort
  if (m.msg === 'abort' && (s.status === 'prepared' || s.status === 'blocked')) {
    s.pendingData = null;   
    s.status = 'idle';      
    s.wait = 0;
  }

  dumpState(s);
}