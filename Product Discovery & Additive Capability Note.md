# Product Discovery & Additive Capability Note: Human-Anchored Transit Mesh Engine

**Prepared for Product Research & Feasibility Evaluation**

This note serves as a fact-finding, additive discovery document detailing a series of newly studied features and architectural patterns for our decoupled tracking platform. Rather than modifying our base objectives, this report outlines the precise engineering logic and technical feasibility for layering a **consent-first, passenger-anchored mesh network** on top of our existing infrastructure.

Implementing these features ensures we maximize real-time tracking fidelity across Kigali while keeping network overhead lightweight and codebase clutter non-existent.

---

## 🚍 1. Smartphone-Anchored Telemetry Ingestion

### Technical Discovery

Instead of relying on hardware GPS units fixed inside physical buses, the system utilizes active passengers’ smartphones as localized "tracking anchors." This turns a hardware problem into a pure software aggregation loop, using the passenger's device to verify if a transit vehicle is actively moving, stopped, or delayed.

```
[Passenger App Session] ──(Broadcast API)──> [Consensus Engine] ──> [Virtual Vehicle State]

```

### Implementation Pathway

* **State Mapping:** When a rider taps a boarding confirmation panel in the user interface, their device opens a short-lived location stream.
* **Consensus Engine:** The backend receives multiple coordinate streams through the ingestion portal. If multiple distinct passenger devices report identical speed variables, directional bearings, and route segments, the system clusters them.
* **Virtual Entity Generation:** The engine merges these scattered tracking samples to compute an aggregated average location, speed, and heading. It presents this on the map as a single high-confidence virtual vehicle marker, filtering out duplicate coordinates.
* **Spoofing Guardrails:** To protect the base data layer from anomalies, input parameters are heavily validated. For instance, any telemetry packet broadcasting speed metrics higher than 120 km/h is flagged as a GPS glitch or malicious spoofing and automatically discarded before it reaches the consensus engine.

---

## 📡 2. Isolated Node-Channel Data Routing

### Technical Discovery

Traditional real-time tracking stacks broadcasting global vehicle position arrays to every active phone screen create a massive performance bottleneck. We have verified an optimized alternative: treating each individual physical bus stop as an isolated network channel or "Node."

### Implementation Pathway

* **Targeted Subscriptions:** When waiting passengers open the application at a specific transit point (like Kacyiru Bus Park or Nyabugogo Hub), the frontend connects exclusively to that specific station identifier's sub-channel.
* **Data Stream Isolation:** Onboard riders tracking towards that destination stream telemetry data solely into that specific station's node room.
* **Bandwidth Preservation:** The backend only calculates and transmits real-time vehicle metrics to the exact group of users waiting at the upcoming affected stops. If a commuter gets curious about transit speeds elsewhere, the application sends a discrete query to poll that external node channel temporarily without flooding global network channels.

---

## 🚨 3. The Pinger Incident System & Targeted Notification Rules

### Technical Discovery

To map unexpected route splits and detours (such as Route 203 separating toward Gatenga versus Katanga directions), the architecture relies on context-aware, human-reported incident points called **Pings**.

| Report Type | Trigger Condition | Automated Response Template |
| --- | --- | --- |
| **Route Changed** | Vehicle path diverges from the structural GTFS shape | "Bus 203 diverted. Not stopping at Gatenga. Next bus in ~12 min." |
| **Traffic Delay** | Clustering engine reports speed drops below 5 km/h | "Bus 203 stuck in traffic near destination. Expect ~8 min delay." |
| **Skip Stop** | Vehicle bypasses stop radius while maintaining velocity | "Bus 203 skipped Gatenga. Please wait for next service." |

## 🚨 3.1 Destination-Driven Pinger Matching & Targeted Alerts

### Technical Discovery
To eliminate the anxiety of a bus unexpectedly veering off its normal route, the platform introduces a human-verified reporting loop (Pings). Rather than guessing which vehicles affect which commuters, the system simplifies classification by capturing user intent at the point of entry.

### Implementation Pathway

* **Upfront Intent Capture (Origin → Destination):** Instead of processing tracking metrics blindly, the application onboarding sequence asks the user a foundational question: *"Where are you going today?"* Capturing their exact starting point and final destination allows the backend to instantly map them to a specific transit corridor sequence.
* **Smart Pinger Classification:** When a riding passenger selects their final destination, the backend classifies them as a potential "Active Anchor/Pinger" for every upcoming stop along their specific path. 
* **The Waiter-Pinger Intersection Rule:** - If an onboard pinger detects a detour or an unexplained route split (such as Route 203 breaking away from Gatenga), they tap a template: `Route Changed`.
  - The system checks the pinger's declared itinerary against active `StopSubscriptions` of waiting users downstream.
  - If a waiting commuter is sitting at a stop that the pinger was scheduled to pass through, but will now bypass due to the detour, the system intersects their paths and pushes a targeted notification instantly: *"Alert — Bus 203 diverted and will not pass your stop. Consider next service."*
* **The Close-Ping Lifecycle Valve:** The reported incident state is dynamic. The pinger who initiated it can manually close the notification if the bus returns to its normal path, or the backend will automatically terminate the alert state the moment the vehicle crosses the pinger's declared final destination node.

### Implementation Pathway

* **One-Tap Reporting:** Onboard anchors are provided with fixed, single-tap reporting templates. Free-form text input is locked out to maximize validation speed and simplify data structures.
* **Algorithmic Path Deviation:** When an incident ping is fired, the backend checks the current coordinates against the standard Mapbox line shapes for that route. If a route deviation threshold is mathematically crossed, the rule engine immediately flags the vehicle state as "Diverted."
* **Targeted Alert Filters:** The system traces downstream stops along the route sequence. It identifies users actively waiting at the upcoming cut-off sectors (e.g., Gatenga) and pushes localized warnings directly to their arrival cards, leaving waiting passengers on unaffected segments completely undisturbed.
* **Automated Lifecycle Termination:** The incident warning remains active in a floating memory store and automatically self-closes the moment oncoming vehicle tracking anchors show that normal street navigation patterns have resumed.

---

## ⚡ 4. Infrastructure Resilience & Loading Lifecycles

### Technical Discovery

Because our standalone server instance runs on a cloud architecture where services spin down during periods of low passenger volume, the app must incorporate robust loading safety valves. This ensures cold-start delays do not present as application freezes or broken interfaces.

### Implementation Pathway

> **The Progressive Initialization Chain**
> 1. **Proactive Handshake Ping:** The moment the user boots the app, the interface launches an immediate fire-and-forget health-check ping to the backend. This initiates the backend warm-up sequence before the user even steps onto the tracking screen.
> 2. **Immediate Offline Fallbacks:** While waiting for the server to reply, the map interface avoids showing a blank canvas by immediately displaying static stop and route arrays cached locally or stored inside a static local snapshot file.
> 3. **The 5-Second Warning Gate:** If the network handshake duration exceeds 5 seconds due to a cold server boot, the application reveals a specific, friendly loading status banner explaining that the transit engine is spinning up.
> 4. **Live Stream Engagement:** Once the base maps and pins settle, the system cleanly triggers the localized real-time tracking stream to drop live data pins smoothly over the cached baseline layout.

---

## 🧪 5. Verification Framework via OpenAPI Schemas

### Technical Discovery

To guarantee that these human-anchored tracking networks function seamlessly across all client interfaces before pushing code changes live, we can leverage full OpenAPI 3.0 specification frameworks inside our automated Apidog testing suites.

### Implementation Pathway

* **Executable Endpoint Layouts:** By mapping the exact paths for our health telemetry, geolocated proximity stops, route traces, and crowdsourced ingestion layers directly into an explicit schema structure, we eliminate configuration mismatches.
* **Multi-Passenger Flight Simulators:** The API incorporates dedicated testing routes to simulate real passenger paths. These simulation pathways ingest a target route ID and automatically step mock passenger location variables sequentially along physical street coordinates.
* **Zero-Friction Debugging:** This allows the product team to model complex passenger routing conditions, track latency behaviors, monitor data validation responses, and review real-time UI timeline rendering profiles safely from the testing dashboard before any field validation tests occur.