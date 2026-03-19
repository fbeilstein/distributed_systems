# Replication and Consistency

**Consistency** is structurally required to understand modern consensus and atomic commitment algorithms. 

**Consistency models** conceptually explain the visibility semantics and the exact behavior of a distributed system when multiple physical copies of the same data exist simultaneously across the network.

---

# Fault Tolerance

**Fault tolerance** is the strict mathematical property of a distributed system that physically allows it to continue operating completely correctly in the presence of localized component failures. 

Making a system fault-tolerant is notoriously difficult. 
* The primary architectural goal is to eliminate any **Single Point of Failure (SPOF)**.
* We must mathematically guarantee that we have robust redundancy spanning across all mission-critical components.
* Ideally, to the end-user, this complex redundancy is entirely **transparent** (invisible).

---

# Dealing with Failures

When a node inevitably dies, systems can recover in different ways depending on their topology:

* **Primary/Replica Topologies:** Failover is typically done explicitly, by forcibly promoting a healthy replica node to immediately become the new master.
* **Masterless / Quorum Systems:** These systems do not require any explicit structural reconfiguration at all. Instead, they dynamically ensure data consistency simply by collecting responses from a mathematical *majority* of participants during read and write queries.

---

# Data Replication

**Data replication** is the primary method of physically introducing redundancy into a cluster by actively maintaining multiple separate copies of the exact same data. 

Replication is absolutely critical for modern global scale:
* **Multidatacenter deployments**
* **Georeplication** (surviving entire regional zone outages)

---

# The Cost of Atomic Updates

Updating multiple global copies of data atomically (all at once perfectly) is a logic problem mathematically equivalent to achieving absolute *consensus*. 

As expected, it can be extremely expensive and slow to enforce absolute consensus on every single database operation. 

However, in many real-world systems, it is perfectly acceptable if the data merely **looks** consistent from the end-user’s perspective, allowing for a temporary, calculated degree of physical divergence between the replica participants behind the scenes.

---

# The Triangle of Events

In replication environments, we inherently care most about three timeline events:
1. **Write** (The client submitting new data)
2. **Replica Update** (The data propagating across nodes)
3. **Read** (The client requesting the data)

These operations trigger a sequential cascade of events initiated by the client. In some cases, updating the background replicas can safely happen *after* the initial write has officially "finished" from the client's perspective, but this does not change the strict rule that the client must be able to observably read their operations back in a logical, expected order.

---

# Availability

Intermittent hardware and network failures are an absolute mathematical certainty. They should **not** impact the availability of the application. 

From the user’s perspective, the system as a whole must continue seamlessly operating as if nothing has ever happened.

---

# The Paradox of High Availability

To make an architecture truly **highly available**, we must design it in a way that allows us to absorb and handle the sudden unavailability of one or more participants gracefully. 

* To achieve this, we must introduce widespread **redundancy and replication**. 
* **However**, the paradox is that as soon as we add redundancy to solve availability, we instantly introduce the brutal new problem of keeping those multiple copies of data perfectly in sync, forcing us to build complex state recovery mechanisms!
