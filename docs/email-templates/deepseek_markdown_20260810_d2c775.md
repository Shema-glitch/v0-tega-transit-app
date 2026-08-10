# BusGo Track - Frontend Implementation Guide (Simplified & Actionable)

**Target Audience:** Frontend Developers & UI/UX Engineers
**Goal:** Turn the generic admin panel into a practical, developer-friendly transit console. Avoid over-engineering. Prioritize simple, visual, and useful features.

---

## 1. Foundation (Keep it Simple)

- **Tech Stack:** Use `shadcn/ui` + `Tailwind CSS`. It provides accessible, highly standardized components (Buttons, Dialogs, Sheets, Badges) that kill custom styling debt.
- **Charts:** Use `Recharts` (built into ShadCN). Do not build custom SVG graphs. Keep it standard: line charts for latency, bars for status mixes.
- **State:** Use `TanStack Query` for all API fetching. It handles caching, background refetching, and retries automatically.

---

## 2. Core UI Cleanup (P0 - Must Have)

**Problem:** The UI is full of cryptic data (e.g., `0.00%` on an endpoint) without a real-world meaning. 

**Simple Fixes:**
- **Add Clear Status Tags:** Replace raw percentages with a `StatusBadge` component. Every endpoint should show: `🟢 Healthy`, `🟡 Degraded`, or `🔴 Down`.
- **Explain the Status on Hover:** Add a `shadcn/ui Tooltip` to the badge. If it says "Degraded", the tooltip should explain: *"5/5 recent requests failed (500 Error)"*.
- **Endpoint Toggle Explainer:** When an admin toggles an endpoint "Off", add a tooltip explaining *why* (e.g., *"Disabled by Admin: System maintenance"* or *"Auto-disabled after 3 consecutive timeouts"*).

---

## 3. Live Load & Performance (P1 - Should Have)

**Problem:** The "Load" page is a static snapshot. Developers can't see if a sudden latency spike is a temporary blip or a long-term trend.

**Simple Fixes:**
- **Historical Sparkline Charts:** Next to the `Requests/min` column in the endpoint table, add a tiny, single-line graph (sparkline) showing the trend over the last 15 minutes. 
- **Expandable Latency Details:** When a dev clicks an endpoint row in the table, open a `shadcn/ui Sheet` (side drawer). Inside, show a simple line chart comparing `p50` vs `p95` latency over the last 30 minutes.
- **SSE Visual Pulse:** While the "Live SSE Monitor" is active, add a blinking green notification dot in the top navigation bar to inform the user that the connection is actively pushing data. 

---

## 4. Easy Debugging & Issue Resolution (P0 - Must Have)

**Problem:** The Issues page just shows a 500 error. The dev has to copy-paste the message, open a separate logging tool (like Sentry), and hunt for the stack trace.

**Simple Fixes:**
- **One-Click Stack Trace:** Clicking an "ERROR" row should instantly slide open a drawer showing the full backend JSON payload and stack trace. No page refresh, no complex navigation.
- **Copy-to-Clipboard Buttons:** Add a simple `[Copy Error]` and `[Copy cURL Request]` button next to every logged issue. This allows the developer to instantly replicate the exact API call in their local environment.
- **Destructive Confirmations:** When clicking "Clear errors" or "Disable endpoint", trigger a `shadcn/ui AlertDialog` ("Are you sure you want to clear all errors?"). One click should not be destructive.

---

## 5. Map & Stop Management (P1 - Should Have)

**Problem:** The "Stops" page is empty and passive. There is no geographic context for merging stops, and no way to view a specific stop's details.

**Simple Fixes:**
- **Actionable Empty States:** In the current empty "No stops" area, place a large, clickable **"Import GTFS Dataset"** button. This allows admins to initiate the import directly from the UI rather than opening an SSH terminal.
- **Stop Detail Sheet:** Make the "Stops" table interactive. Clicking a stop name should open a side panel (Sheet) showing: 
  - The Coordinates (with a `Copy Lat/Long` button).
  - A simple card listing which `Routes` service this stop.
- **Mini-Map in Merge Tool:** When an admin is using the "Merge stops" tool, add a tiny map view right next to the dropdowns. Visually plot the two stops' GPS points with a red line connecting them, so they can physically see they are the same location before clicking "Merge".

---

## 6. Admin & Settings (P0 - Must Have)

**Problem:** You have basic user management and 2FA, but no transparency on who changed what.

**Simple Fixes:**
- **Simple Audit Trail:** In the `Admins` table, add a "History" button. Clicking it opens a modal showing a simple chronological list: *"Admin X disabled /api/stops at 14:03"*.
- **Security Progress Bar:** In the `Overview`, add one simple progress bar or circular metric showing: *"2FA Adoption: 2/3 Admins enabled"*. This quickly tells you if your admin panel is vulnerable.

---

## 7. Global Navigation (P0 - Must Have)

**Problem:** As the sidebar grows, navigating between 10+ pages becomes slow.

**Simple Fixes:**
- **Global Command Palette (Cmd+K):** Implement a `shadcn/ui Command` component triggered by `Ctrl+K` or `Cmd+K`. When typing, it should instantly jump to pages (e.g., type "merge" to jump to Map & Stops, or "load" to jump to Load).
- **Notification Dropdown:** Move the `2 Open Issues` badge from the sidebar to a bell icon in the top-header. Clicking it should show a dropdown with the most recent 3 errors. This lets devs see if a new error just popped up without leaving their current page.

---

## 8. Development Implementation Guidelines

- **Module Lazy Loading:** The map and charting libraries are huge. Use `React.lazy()` to load the `/map-stops` and `/load` routes *only* when the user navigates to them. This keeps the initial dashboard load lightning-fast.
- **Polling vs. SSE:** For the Load page, do not create a massive WebSocket hammer. Use `TanStack Query`'s built-in `refetchInterval` (e.g., every 5 seconds) to poll the metrics endpoint. It’s far easier to code and harder to break.
- **Responsive Sidebar:** Use a standard collapsible sidebar (`shadcn/ui Sidebar`). When collapsed, show only icons with Tooltips. Do not build a completely different mobile layout; just make it stack vertically on very small screens.

---

## 9. Simplified Implementation Roadmap

| Priority | Scope | What to build |
| :--- | :--- | :--- |
| **Sprint 1 (P0)** | Foundation & Debugging | ShadCN/UI migration. Status badges with tooltips. Issue stack-trace drawers. Alert dialogs for destructive actions. `Cmd+K` global search. Actionable "Import GTFS" button. |
| **Sprint 2 (P1)** | Data Visualization & Admin | Historical latency sparklines. Expandable endpoint side-sheets. Admin audit trail modal. 2FA health widget. Map mini-view in Merge tool. Stop detail sheet. |
| **Sprint 3 (P2)** | Polish & Performance | SSE live pulse indicator. Lazy-loading map/chart modules. Notification bell dropdown. Pagination/virtualization for large stop tables. |

---

**Key Takeaway for the Dev Team:** Your job is not to replace Datadog, Sentry, or Postman. Your job is to give the team enough context *within* this dashboard to know which external tool to open. **Keep the UI simple, the interactions obvious, and avoid building massive, complex internal frameworks.**