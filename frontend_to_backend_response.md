# Frontend Engineering Response: API Integration & Alignment

**To: Backend Engineering Team**
**From: Frontend Engineering**

We have reviewed your incredibly thorough *API Evolution & Frontend Integration Analysis*. The architectural vision for a "Human-Anchored Transit Mesh Engine" is brilliant, and we are fully aligned on the implementation strategies. 

This document outlines what we have already built to support your architecture, the next steps we are taking on the frontend, and a few minor requests for API clarification so we can work together seamlessly.

---

## 1. What We Have Already Completed
* **Progressive Initialization:** We have successfully implemented the `fetch('/health')` "Wake-Up Ping" directly inside our `main.jsx` bundle. It fires the instant the JS loads to spin up the Render instance before React even mounts.
* **Isolated Node-Channels:** Our `TransitContext` now dynamically connects to the SSE stream passing `lat`, `lng`, and `radius` parameters, ensuring we only pull localized data streams.
* **The Crowdsourcing Toggle:** We built the "I'm on this Bus" UI and the underlying `useCrowdsource.js` hook that actively converts raw `navigator.geolocation` data into strict km/h and generates a session ID for tracking.

## 2. Our Next Frontend Action Items
Based on your excellent analysis, we will immediately begin implementing the following resilience and UX features:
* **Broadcast Throttling:** We will throttle the `POST /api/realtime/broadcast` payload inside our geolocation hook to fire only once every 10-15 seconds to prevent backend flooding and save user battery.
* **The 5-Second Warning Gate:** We will add a timeout trigger when the app mounts. If the initial API response takes longer than 5 seconds, we will display a non-blocking toast: *"☕ Waking up the server... gathering live transit data."*
* **Graceful SSE Degradation:** We will build a fallback mechanism where if the SSE connection drops or returns a 503, the frontend will automatically revert to polling `GET /api/vehicles/live` every 10 seconds.
* **Intent Capture UI:** We will begin designing the onboarding/search sequence to capture the critical question: *"Where are you going today?"* to support your Pinger routing logic.

## 3. Requests for API Clarification
To ensure we can build the UI to match your backend perfectly, could you provide the following payload schemas?

1. **Incident Reporting Schema:** For the new Pinger Incident System, what is the exact JSON payload you expect when a user taps "Route Changed" or "Traffic Delay"? 
   * *Proposed Endpoint:* `POST /api/incidents/report`
   * *Required Fields:* Do you need `vehicle_id`, `route_id`, `client_id`, and `incident_type`?

2. **Incident Delivery Mechanism:** How will the backend push these targeted incident alerts down to the waiting users? Will these be injected directly into the existing `GET /api/realtime/sse` stream payload, or will there be a separate endpoint?

3. **Dynamic ETA Confidence Scores:** You mentioned the ETA engine now returns a confidence score alongside the arrival window. Could you provide a sample JSON response for `GET /api/stops/:id/arrivals` so we can map the `confidence` field (e.g., `high`, `medium`, `low`) to our Green/Amber/Grey UI color system?

---
We are incredibly excited about this stack. Once we get those payload schemas, we can finalize the UI components and begin full end-to-end testing!
