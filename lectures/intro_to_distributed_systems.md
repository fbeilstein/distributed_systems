# Introduction to Distributed Systems
Understanding Concurrency, Time, and Failures

---

# Concurrency vs. Parallelism

Consider a simple multiplier and adder operating on shared state:
```python
i += 2
i *= 2
```
*Depending on the execution history, the outcome changes.*

<div style="display: flex; gap: 20px; align-items: stretch; margin-top: 30px;">
    <div style="flex: 1; background: var(--secondary-bg); padding: 20px; border-left: 4px solid var(--accent-color);">
        <h3>Concurrent</h3>
        <p>Both are in progress, but only one executes at any moment. Operations overlap in time. Often involves <b>shared memory</b>.</p>
    </div>
    <div style="flex: 1; background: var(--secondary-bg); padding: 20px; border-left: 4px solid var(--accent-color);">
        <h3>Parallel</h3>
        <p>Steps are executed simultaneously by multiple processors. <b>No shared memory</b>.</p>
    </div>
</div>

<div style="margin-top: 20px; font-style: italic; text-align: center;">
    "Concurrent execution is like having two queues to a single coffee machine.<br>Parallel execution is like having two queues to two coffee machines." <br>— Joe Armstrong
</div>

---

# The Fallacies of Distributed Computing

When designing systems, we often falsely assume:

1. The network is reliable.
2. A successful initial connection guarantees the link is stable.
3. Latency is zero.
4. Execution is instantaneous.
5. Bandwidth is infinite.
6. Queue capacity is infinite.
7. We will always get a positive response from the server.

**Reality:** Failures are inevitable. We must build systems with **fault tolerance** and **redundancy**.

---

# Handling Load: Queues & Backpressure

**Process-local queues** help manage variable system load:
* **Decoupling:** Receipt and processing are separated in time.
* **Pipelining:** Requests are processed in stages without blocking.
* **Absorbing Bursts:** Hides request inter-arrival times from the processor.

<div style="background: var(--secondary-bg); padding: 20px; margin-top: 20px; border: 1px solid var(--accent-color);">
    <h3>Dealing with Queue Overflow (Backpressure)</h3>
    <ul>
        <li><b>Control the Producer:</b> Consumer dictates speed.</li>
        <li><b>Buffer:</b> Accumulate incoming data spikes temporarily.</li>
        <li><b>Drop:</b> Sample or discard a percentage of incoming data.</li>
    </ul>
</div>

---

# Clocks and Time

In distributed systems, participants have different perceptions of time. 

* **Time Drift:** You cannot rely purely on source timestamps for synchronization or ordering due to clock drift between servers.
* **Synchrony:** Systems use local clocks for timeouts, but true global time is a myth.

**Google Spanner's Solution:**
Spanner uses a special API (`TrueTime`) that returns a timestamp alongside **uncertainty bounds** (e.g., $earliest$ and $latest$) to impose a strict transaction order.

---

# State Consistency & Hiding Complexity

Distributed algorithms do not always guarantee **strict state consistency**.
* Loose constraints allow replicas to diverge.
* Systems rely on **conflict resolution** and **read-time data repair** to fix state.

**The Danger of the "Local" API Illusion:**
Simply hiding remote calls behind a local-looking interface is dangerous. 
* Remote invocations cost orders of magnitude more (network transport, serialization).
* Interleaving local and remote calls without distinction leads to performance degradation.

---

# Failures & Network Partitions

When a remote server doesn't respond, we rarely know why. Is it a crash? A slow network? A slow process?

<div style="display: flex; gap: 20px; margin-top: 20px;">
    <div style="flex: 1;">
        <h3>Network Partitions</h3>
        <p>When two or more servers cannot communicate. Independent groups may proceed with execution and produce conflicting results.</p>
    </div>
    <div style="flex: 1;">
        <h3>Partial & Asymmetric Failures</h3>
        <p>Messages might deliver A &rarr; B, but not B &rarr; A. Systems must continue operating even if a part is unavailable.</p>
    </div>
</div>

*Testing Tools: Toxiproxy (network), Chaos Monkey (services), CharybdeFS (filesystem).*

---

# Cascading Failures

A process tipping over under high load increases the load on the rest of the cluster, causing a domino effect.

**Defense Mechanisms:**
* **Circuit Breakers:** Steer traffic away from a failing service to give it time to recover.
* **Backoff Strategy:** Clients wait an exponentially increasing amount of time before reconnecting.
* **Jitter:** Adding random time variations to backoff periods to prevent a "thundering herd" of clients retrying at the exact same millisecond.

---

# Link Models: Fair-Loss vs. Stubborn

Any communication medium is imperfect. 

### Fair-Loss Link (Think: UDP)
* **Fair Loss:** If sender retransmits infinitely, it will eventually deliver.
* **Finite Duplication:** Messages won't deliver infinitely many times.
* **No Creation:** Will never deliver a message that wasn't sent.
* *Problem:* The sender has no way to know if the message arrived.

### Stubborn Link
* Uses **Message Acknowledgments**.
* Sender loops: Send &rarr; Wait &rarr; Send Again until an ACK is received.

---

# The Message Duplicate Problem

Retransmitting messages guarantees delivery, but introduces duplicates.

**Solution 1: Idempotence**
An operation that can be executed multiple times while yielding the same result without side effects (e.g., `x = 5`).

**Solution 2: Deduplication Buffers**
If operations aren't idempotent (e.g., `x += 5`), the receiver must track sequence numbers:
* $n_{consecutive}$: Highest sequence number where all previous messages are seen.
* $n_{processed}$: Highest sequence number processed.
* Discard any message with a sequence number $\le n_{consecutive}$.

---

# Delivery Guarantees

### The Perfect Link (Think: TCP Session)
1. **Reliable Delivery:** Every message sent by a correct process will eventually be delivered.
2. **No Duplication:** Delivered exactly once in the session.
3. **No Creation:** No phantom messages.

### The Myth of "Exactly-Once" Delivery
*"There are only two hard problems in distributed systems: 2. Exactly-once delivery, 1. Guaranteed order of messages, 2. Exactly-once delivery."*

Most systems use **At-Least-Once** delivery. We create the *illusion* of exactly-once delivery via **exactly-once processing** (deduplication at the application layer).

---

# Impossibility Results

### 1. The Two Generals' Problem
Proves it is **impossible** to achieve perfect agreement between two parties over an asynchronous, unreliable link. (Messengers can always be captured).

### 2. The FLP Impossibility Theorem
In a fully asynchronous system, no consensus protocol can guarantee completion in bounded time if even a single node can fail.
Requires three properties:
* **Agreement:** All non-faulty nodes decide on the same value.
* **Validity:** The agreed value was actually proposed by a node.
* **Termination:** Every non-faulty node eventually decides.

*Takeaway: Real-world systems require some degree of **synchrony** (timeouts).*

---

# Failure Models

Algorithms must be designed against specific assumptions of how nodes fail:

1. **Crash Faults:** A process halts and remains halted. It does not participate in the current round again.
2. **Crash-Recovery:** A process halts but can reboot. Requires writing state to durable storage so it can resume the algorithm safely.
3. **Omission Faults:** A process skips steps or drops messages (captures network partitions and heavy congestion).
4. **Byzantine (Arbitrary) Faults:** A process actively executes incorrect steps, returns corrupted data, or lies maliciously. (Common in aerospace and decentralized blockchains).

---

# The CAP Theorem

In the presence of a **Network Partition (P)**, a distributed system must choose between:

<div style="display: flex; gap: 20px; align-items: center; margin-top: 30px;">
    <div style="flex: 1; text-align: center; background: var(--secondary-bg); padding: 30px; border-radius: 8px;">
        <h2 style="color: #e57373;">Consistency (CP)</h2>
        <p>Reject requests rather than serving potentially stale or diverged data.</p>
    </div>
    <div style="flex: 1; text-align: center; background: var(--secondary-bg); padding: 30px; border-radius: 8px;">
        <h2 style="color: #81c784;">Availability (AP)</h2>
        <p>Always return a response, even if the data might not be the absolute latest.</p>
    </div>
</div>

<div style="margin-top: 30px;">
    <b>Linearizability (Strong Consistency):</b><br>
    Operations appear to execute instantaneously at a specific <b>linearization point</b>. Once a write is complete, no participant can ever read an older value (no "time travel").
</div>

---

# Beyond CAP: Harvest and Yield

CAP is binary. Real systems degrade gracefully.

* **Harvest:** How complete the query is. (e.g., Fetching 99 out of 100 rows is better than failing the entire request).
* **Yield:** The percentage of requests completed successfully over total attempted requests. (Different from uptime—a busy, alive server can still fail requests).
