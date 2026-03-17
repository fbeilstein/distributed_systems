# Failure Detection
## Identifying faulty processes in distributed systems

---

# Why Detect Failures?

Failures must be detected in a **timely manner**. 

If a faulty process remains undetected, healthy nodes might routinely try to contact it even though it cannot respond. This leads to:
* Dramatically **increasing latencies** (waiting for timeouts)
* Reducing overall system **availability** and throughput.

---

# The Asynchronous Challenge

Detecting failures in **asynchronous distributed systems** (systems without strict timing bounds) is fundamentally extremely difficult.

It is physically impossible to definitively tell the difference between:
1. A process that has **crashed** completely.
2. A process that is simply **running slowly** and taking an indefinitely long time to respond.

*(Recall the **FLP Impossibility** theorem from the previous lecture.)*

---

# Dead vs. Suspected

Because of the asynchronous challenge, we categorize node states:

* **Dead / Failed / Crashed**:
  A process that has permanently stopped executing its steps and will not recover under current context.

* **Suspected** (may be dead):
  A process that is currently unresponsive, faulty, or just exceedingly slow. We *suspect* it has failed, but cannot mathematically prove it.

---

# Where Failures Occur

When a process appears unresponsive, the underlying failure may exist at two distinct layers:

1. **Link Level**
   Messages between the processes are being dropped, lost, or delivered incredibly slowly over the network.
2. **Process Level**
   The process itself has crashed or is starved of computational resources and running slowly.

---

# The Ultimate Trade-off

Because slowness may not always be distinguishable from true failure, failure detection algorithms face a permanent trade-off:

<div style="display: flex; gap: 40px; margin-top: 40px;">
    <div style="flex: 1; background: #331111; padding: 20px; border-radius: 8px;">
        <h3 style="color: #ff5555; margin-top:0;">False Positives</h3>
        Wrongly suspecting healthy, alive processes as dead (penalizes slow networks).
    </div>
    <div style="flex: 1; background: #113311; padding: 20px; border-radius: 8px;">
        <h3 style="color: #55ff55; margin-top:0;">Detection Latency</h3>
        Delaying marking a truly unresponsive process as dead (penalizes system throughput).
    </div>
</div>

---

# What is a Failure Detector?

A **failure detector** is a local subsystem running within a node responsible for continuously monitoring the environment.

Its job is to identify failed or unreachable processes and explicitly **exclude** them from the core algorithm.

The core goal is to **guarantee liveness** while **preserving safety**.

---

# Liveness vs. Safety

These properties describe an algorithm’s ability to solve a specific problem correctly.

* **Liveness** (Something *good* eventually happens)
  Guarantees that a specific intended event **must** occur. 
  *(e.g., If a process actually fails, the failure detector will eventually detect it).*

* **Safety** (Nothing *bad* ever happens)
  Guarantees that unintended events will **not** occur. 
  *(e.g., If a process is considered dead, it is really dead... which is notoriously hard to guarantee).*

---

# Efficiency and Accuracy

We grade failure detectors on two primary metrics:

1. **Efficiency**: How *fast* does it detect true failures?
2. **Accuracy**: How *precise* is it? Does it avoid false positives?

You can think of the relationship between Efficiency and Accuracy as a **tunable parameter**. 
> A more efficient algorithm might be less precise (aggressive timeouts), and a more accurate algorithm is usually less efficient (patiently waiting).

---

# Practical Assumptions

In the real world, failure detectors accept compromises to continue operating:

1. They are generally allowed to produce **false-positives** (sacrificing perfect *Safety* for *Liveness*).
2. They typically assume the **absence of Byzantine failures** (assuming processes do not intentionally lie, forge heartbeats, or act maliciously).

Robust failure detectors are an essential prerequisite and integral component for advanced distributed systems like **Consensus algorithms** (e.g. Paxos/Raft) and **Atomic Broadcasts**.

---

# Basic Approaches: Heartbeats and Pings

We can natively query the state of remote processes using two primary methods:

<div style="display: flex; gap: 40px; margin-top: 20px;">
    <div style="flex: 1; background: #222; padding: 20px; border-radius: 8px;">
        <h3 style="color: #4CAF50; margin-top:0;">Heartbeats</h3>
        A process actively pushes messages notifying its peers that it is still running.
    </div>
    <div style="flex: 1; background: #222; padding: 20px; border-radius: 8px;">
        <h3 style="color: #2196F3; margin-top:0;">Pings</h3>
        A process actively pulls state by sending messages to a remote process, expecting a response within a specified timeout.
    </div>
</div>

In both cases, each process maintains a list of other nodes, updating the last interaction time. If a process fails to respond or misses a heartbeat deadline, it is marked as suspected.

---

# Heartbeat & Ping Implementations

Many classical failure-detection algorithms are based on these simple timeout mechanisms.
*(e.g., [Akka](https://akka.io/), a massive framework for building distributed systems, uses a basic heartbeat deadline failure detector at its core).*

However, there are massive downsides to this approach:

1. **Precision limits**: Success entirely relies on carefully hardcoding the precise *ping frequency* and the *timeout cutoff*.
2. **Tunnel Vision**: It fails to capture visibility of a process from the perspective of the broader network (A node might just be partitioned from *you*, but not the rest of the cluster).

---

# The Ping Sandbox Demo

In this demonstration, **Node 0** explicitly reaches out to nodes 1-4 with a `PING` payload. The targets then reply with an `ACK`.

<div style="background: #222; padding: 20px; border-radius: 8px; margin-top: 20px;">
    <h4 style="margin-top: 0; color: #ff9800;">Real World vs. Sandbox Architecture</h4>
    <p style="font-size: 1.2rem;">In a real P2P system, every node typically acts as both a monitor <i>and</i> a target, checking every other node simultaneously. To make our visualizer easier to read, our demo uses <b>Asymmetric Roles</b>: Node 0 acts as a dedicated Master/Monitor, while Nodes 1-4 act as Slaves that only respond to queries.</p>
</div>

<div style="text-align: center; margin-top: 40px;">
    <button class="demo-btn" onclick="showDemo('demos/failure-pings/demo.json')" style="font-size: 1.5rem; padding: 15px 30px;">
        Launch Pings Demo
    </button>
</div>

---

# The Heartbeat Sandbox Demo

Alternatively, in this demonstration, **Node 0** is completely silent. Nodes 1-4 unilaterally broadcast `HEARTBEAT` payloads at a fixed interval to Node 0. Node 0 just maintains a list of the last seen timestamps.

If the gap between timestamps exceeds the strict `TIMEOUT` bounds configured, Node 0 marks the target as `suspect`, and eventually `failed`.

<div style="background: #222; padding: 20px; border-radius: 8px; margin-top: 20px;">
    <h4 style="margin-top: 0; color: #ff9800;">Real World vs. Sandbox Architecture</h4>
    <p style="font-size: 1.2rem;">Just like the pings demo, real-world heartbeats are <b>completely symmetric</b>. Every node broadcasts heartbeats to everyone else, and every node drops peers if they miss a heartbeat timeout. The demo restricts this visually to a dedicated Monitor purely to reduce visual noise on the timeline.</p>
</div>

<div style="text-align: center; margin-top: 40px;">
    <button class="demo-btn" onclick="showDemo('demos/failure-heartbeats/demo.json')" style="font-size: 1.5rem; padding: 15px 30px;">
        Launch Heartbeats Demo
    </button>
</div>

---

# Timeout-Free Failure Detectors

Some algorithms purposefully avoid relying on strict timeouts for detecting failures to eliminate false-positives caused by unexpected networking latency.

A legendary example is:  
[Aguilera, Chen, and Toueg. **1997**. *“Heartbeat: a Timeout-Free Failure Detector for Quiescent Reliable Communication.”*](https://www.microsoft.com/en-us/research/uploads/prod/1997/09/wdag97_hb.pdf)

---

# Crucial Assumptions

To operate without timeouts, the algorithm makes two environmental assumptions:

1. **Path Fairness**: Any two correct processes are connected to each other via a *fair path* containing only *fair links*. (If a message is sent over this link infinitely often, it is also guaranteed to be received infinitely often).
2. **Global Awareness**: Each process is aware of the existence of *all* other processes in the entire network.

---

# The Timeout-Free Algorithm

Each process maintains a list of neighbors and an integer counter for each.

1. **Initiation**: A node periodically sends an initial heartbeat message containing a unique identifier and itself as the "first sender" in the path.
2. **Propagation**: If a node receives a new heartbeat message, it:
   - Appends itself to the message's path.
   - Forwards the heartbeat *only* to nodes not already present in the path. (Propagation naturally stops when all known processes have received it).
   - Increments its local counters for **all** participants actively listed in the path.

Healthy processes will have constantly growing, unbounded counters. Faulty processes will have stuck, bounded counters.

---

# Bypassing Faulty Links

Because messages are propagated and bounced between different processes, the heartbeat paths contain aggregated information received recursively from neighbors.

This means we can (correctly) mark an unreachable process as definitively **alive**, even when our direct physical link to them has been completely severed, because we are receiving updates about their counter from a mutual peer!

---

# Interpreting the Counters

These heartbeat counters represent a **global and normalized view** of the system. 

It captures exactly how heartbeats are systematically propagated relative to one another, allowing us to mathematically compare processes.

However, interpreting these counters can be incredibly tricky: we have to pick a sliding threshold difference that yields reliable results. Unless we tune that gap perfectly, the algorithm runs the risk of falsely marking active processes as suspected when network topologies shift.

---

# The Timeout-Free Sandbox Demo

<div style="background: #222; padding: 20px; border-radius: 8px; margin-top: 20px;">
    <h4 style="margin-top: 0; color: #ff9800;">Real World vs. Sandbox Architecture</h4>
    <p style="font-size: 1.2rem;">Unlike our previous demos, the Timeout-Free demo runs in <b>True Symmetry</b>. Every single node runs the exact same <code>node.js</code> logic, acts identically, and manages its own independent counters. <br><br>The only visual "cheat" in the sandbox is that we globally stagger the initiation intervals so that only one node starts a gossip chain at a time, preventing the timeline UI from becoming a completely illegible spiderweb of crossing lines!</p>
</div>

<div style="text-align: center; margin-top: 40px;">
    <button class="demo-btn" onclick="showDemo('demos/failure-timeout-free/demo.json')" style="font-size: 1.5rem; padding: 15px 30px;">
        Launch Timeout-Free Demo
    </button>
</div>

---

# Outsourced Heartbeats (SWIM)

An alternative approach to improve reliability is to **outsource** the failure detection to the rest of the network.

A famous architecture using this is the **Scalable Weakly Consistent Infection-style Process Group Membership Protocol ([SWIM](https://dl.acm.org/doi/pdf/10.1145/3361525.3361556))**.

Instead of assuming a process is dead because *you* can't reach it, we ask our peers to try reaching it for us! This drastically reduces false-positives caused by local network link failures.

---

# How SWIM Works

1. $P_1$ sends a direct `PING` to $P_B$.
2. If $P_B$ responds with an `ACK`, $P_1$ marks it as alive.
3. If the timeout expires, $P_1$ selects a random subset of peers (e.g. $P_2, P_3$).
4. $P_1$ sends an indirect `PING_REQ` (*ping request*) to $P_2$ and $P_3$.
5. $P_2$ and $P_3$ then try to `PING` $P_B$.
6. If $P_B$ answers $P_2$, $P_2$ forwards the `ACK` back to $P_1$.
7. $P_1$ marks $P_B$ as alive!

If *none* of the indirect pings receive a response, only then is $P_B$ marked Suspect.

---

# Why Outsource?

Outsourced heartbeats distribute the responsibility for checking process liveness across the active group of members instead of relying on a single network link.

* **Scalability**: It does not require broadcasting messages to the entire peer group (you only choose a few random witnesses).
* **Speed**: Indirect `PING_REQ`s can be triggered in parallel.
* **Accuracy**: We account for both *direct* and *indirect* reachability, completely bypassing local packet-drops or bad routing tables before falsely accusing a node of dying.

---

# The SWIM Sandbox Demo

<div style="background: #222; padding: 20px; border-radius: 8px; margin-top: 20px;">
    <h4 style="margin-top: 0; color: #ff9800;">Real World vs. Sandbox Architecture</h4>
    <p style="font-size: 1.2rem;">In a real SWIM cluster, every node executes the full protocol concurrently (selecting random targets and random witnesses constantly).<br><br>To make this comprehensible on a visual timeline, our Sandbox uses <b>Asymmetric Roles</b>: Node 0 is the dedicated Master, Node 4 is the dedicated Target, and Nodes 1-3 act as dedicated Witnesses to forward indirect pings when Node 0's direct timeout expires.</p>
</div>

<div style="text-align: center; margin-top: 40px;">
    <button class="demo-btn" onclick="showDemo('demos/failure-swim/demo.json')" style="font-size: 1.5rem; padding: 15px 30px;">
        Launch SWIM Demo
    </button>
</div>

---

# The Phi-Accrual Failure Detector

Instead of treating node failure as a binary problem (where the node is rigidly either `UP` or `DOWN`), a **$\Phi$-Accrual Failure Detector** outputs a continuous scale. 

It calculates the mathematical *probability* that a monitored process has crashed given current network conditions.

This algorithm is famously battle-tested and used at the core of massive modern distributed systems like **[Cassandra](https://cassandra.apache.org/)** and **[Akka](https://akka.io/)**. 

*(Original Paper: [The φ Accrual Failure Detector, Hayashibara et al. 2004](https://oneofus.la/have-emacs-will-hack/files/HDY04.pdf))*

---

# Dynamic Adaptation

It works by maintaining a **Sliding Window**. 

The monitor collects the arrival times of the most recent heartbeats. Rather than enforcing a hardcoded `TIMEOUT = 10ms` rule, the failure detector uses the historical window to approximate the expected arrival time of the *next* heartbeat.

If the network suddenly gets congested, the detector dynamically adapts its own suspicion threshold to the changing conditions, vastly reducing false positives while maintaining aggressive bounds on fast networks.

---

# The Three Subsystems

From an architectural perspective, a $\Phi$-accrual failure detector is built as a pipeline of three distinct subsystems:

1. **Monitoring**  
   Collecting liveness information through pings, heartbeats, or sampling.
2. **Interpretation**  
   Applying mathematical formulas to the historical window to calculate the suspicion *Probability*.
3. **Action**  
   Executing a callback (e.g. `mark_as_failed()`, `trigger_leader_election()`) only when the calculated $\Phi$ Probability breaches an configured aggression threshold.

---

# Mathematics: The Sliding Window

The interpreted distribution parameters are extracted from the sliding sampling window by calculating the **Mean** ($\mu$) and **Variance** ($\sigma^2$) of the heartbeat intervals.

Suppose we capture a history of heartbeat intervals $H = \{h_1, h_2, ..., h_n\}$ inside a window of size $n$:

$$ \mu \approx \frac{1}{n}\sum_{i=1}^{n} h_i $$

$$ \sigma^2 \approx \frac{1}{n-1}\sum_{i=1}^{n} (h_i - \mu)^2 $$

We assume these samples follow a standard **Normal Distribution**.

---

# Mathematics: The Suspicion Level $\Phi$

Using the Mean and Variance, we compute $P_{late}(t)$, which is the probability that a heartbeat will arrive *more than* $t$ time units after the previous one. 

In statistics, this is the area under the tail of the Normal probability density function curve.

$$ P_{late}(t) = \int_{t}^{\infty} \frac{1}{\sigma\sqrt{2\pi}} e^{-\frac{(x-\mu)^2}{2\sigma^2}} dx $$

Finally, we calculate the suspicion level $\Phi$ (Phi). This represents how likely it is we will make a *mistake* by incorrectly marking the node dead (Wait long enough, and $\Phi$ approaches infinity).

$$ \Phi = -\log_{10}(P_{late}) $$

If $\Phi$ crosses an arbitrary threshold (e.g. $\Phi > 8$), we mark the node as DOWN.

---

# The Phi-Accrual Sandbox Demo

<div style="background: #222; padding: 20px; border-radius: 8px; margin-top: 20px;">
    <h4 style="margin-top: 0; color: #ff9800;">Real World vs. Sandbox Architecture</h4>
    <p style="font-size: 1.2rem;">Like the Pings and basic Heartbeats demos, real-world Phi-Accrual is <b>completely symmetric</b> (Every Cassandra node calculates a $\Phi$ matrix against every other Cassandra node). <br><br>The Sandbox visualization again uses <b>Asymmetric Roles</b>: Node 0 acts as the dedicated Monitoring Brain (running <code>monitor.js</code> and calculating the math), while Nodes 1-4 act as dumb Targets (running <code>target.js</code>) that simply broadcast heartbeats for Node 0 to analyze.</p>
</div>

<div style="text-align: center; margin-top: 40px;">
    <button class="demo-btn" onclick="showDemo('demos/failure-phi/demo.json')" style="font-size: 1.5rem; padding: 15px 30px;">
        Launch Phi-Accrual Demo
    </button>
</div>

---

# Gossip and Failure Detection

Another approach that avoids relying on a single-node view to make a decision is a **Gossip-Style Failure Detection Service**. Using gossip (think about *virus spreading*), nodes can collect and distribute states of neighboring processes.

*(Reference: van Renesse, Minsky, Hayden. 1998. "A Gossip-Style Failure Detection Service.")*

Each process maintains a heartbeat table:

| Neighbor | Last Heartbeat Timestamp |
| :--- | :--- |
| **$P_1$ (self)** | $t_1$ |
| **$P_2$** | $t_2$ |
| **$P_3$** | $t_3$ |

---

# The Gossip Algorithm

* **Broadcasting**: Periodically, each member increments its own heartbeat counter and distributes its entire table list to a random neighbor.
* **Merging**: Upon message receipt, the neighboring node merges the list with its own, updating heartbeat counters to the maximum known values.
* **Detection**: If any node in the list did not dynamically update its counter for long enough, it is considered failed.

Using gossip for propagating system states increases the total number of messages in the system, but allows information to spread much more reliably.

*Note: Bandwidth is logically capped, and can grow at most linearly with the number of processes in the system.*

---

# Case Study: 3 Processes

Consider 3 processes $P_1$, $P_2$, and $P_3$ where all three can initially communicate and update their timestamps.

**Scenario A: Direct Link Failure**
The physical network link $P_1 \iff P_3$ is severed. 
* $P_1$ and $P_3$ cannot speak directly, but $P_3$'s incrementing heartbeat state is still propagated to $P_1$ *through* $P_2$. The cluster correctly knows $P_3$ is alive!

**Scenario B: True Crash Failure**
$P_3$ physically crashes and its CPU halts.
* Since it doesn’t send updates anymore, its heartbeat counter permanently freezes. It is definitively detected as failed by the *entire* cluster simultaneously.

---

# The Gossip Sandbox Demo

<div style="background: #222; padding: 20px; border-radius: 8px; margin-top: 20px;">
    <h4 style="margin-top: 0; color: #ff9800;">Real World vs. Sandbox Architecture</h4>
    <p style="font-size: 1.2rem;">In a true scalable Gossip implementation (like the paper), a node picks <b>one random neighbor</b> to exchange state with.<br><br>For illustrative purposes, our Sandbox demo runs a <b>Staggered Broadcast Gossip</b> --- distributes state to all active peers in a round-robin fashion. </p>
</div>

<div style="text-align: center; margin-top: 40px;">
    <button class="demo-btn" onclick="showDemo('demos/failure-gossip/demo.json')" style="font-size: 1.5rem; padding: 15px 30px;">
        Launch Gossip Demo
    </button>
</div>
