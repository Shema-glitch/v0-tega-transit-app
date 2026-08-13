### **Developer Design & Layout Cleanup Prompt**

> **Role:** Senior Frontend Engineer / UI Design Engineer
> **Task:** Refactor the UI layout, component hierarchy, border radii, color contrast, and component consistency across the Console admin app.
> Please implement the following design system updates and page-specific layout fixes.
> ---
> 
> 
> ### **1. Global Design System & Layout Refactoring**
> 
> 
> 1. **Sidebar Navigation & User Profile Footer:**
> * Fix premature truncation of user email addresses in the bottom sidebar card (e.g., `sonyxperiame1@g...`). Allow text to wrap, shrink smoothly, or use a hover tooltip while utilizing the available horizontal space next to the `Admin` badge.
> 
> 
> 2. **Global Top Navigation & Breadcrumbs:**
> * Normalize breadcrumb rendering across all views. Remove floating breadcrumb pills (e.g., `Open Issues > Console > [Page]`) from the inner page content container margin and integrate them into a standardized top navigation bar shell.
> * Eliminate redundant inline `[Refresh]` buttons inside inner page headers. Keep only the single primary global `Refresh` button in the top right header strip.
> 
> 
> 3. **Border Radii & Elevation Hierarchy:**
> * Standardize container border-radius scales:
> * Outer main section cards: `12px` or `16px`.
> * Inner nested controls, input fields, tables, and buttons: `6px` or `8px`.
> 
> 
> * Add subtle border contrast (`1px solid rgba(255, 255, 255, 0.08)`) to dark cards to distinctly separate them from the background canvas.
> 
> 
> 4. **Color & Button States:**
> * High-contrast primary buttons should have clear active states rather than matching standard input backgrounds.
> * Destructive action buttons (e.g., `Clear`, `Revoke`, `Disable`) must maintain legible high-contrast text against their red fills/outlines.
> 
> 
> 
> 
> ---
> 
> 
> ### **2. Screen-Specific Layout & Component Fixes**
> 
> 
> #### **A. Endpoints Page**
> 
> 
> * **Control Height & Icon Alignment:** Standardize line-heights, padding, and icon sizes between primary action buttons (`Re-run all checks` and `Start live SSE monitor`).
> * **Banner Density:** Separate notice banners (*Disabling an endpoint...*) and sync status bars into distinct cards with proper vertical spacing and typography hierarchy.
> * **Endpoint List Density:** Convert the 17-item single-column list into collapsible accordion groups (e.g., *GTFS Static*, *Realtime*, *Stops & Arrivals*) or a 2-column grid.
> * **Toggle Affordance:** Add explicit text labels (`Enabled` / `Disabled`) next to the endpoint toggle switches.
> 
> 
> #### **B. Load Page**
> 
> 
> * **KPI Card Overflow:** Fix text truncation inside the *Cache hit rate* card subtext (`40 mem · 5 redis...`). Enable dynamic text wrapping or increase card flex widths.
> * **Table Data Presentation:**
> * Replace repeated `"no latency data"` text in sparklines with a clean dash (`—`) or empty sparkline placeholder.
> * Hide empty columns like `429` unless rate limits are triggered, or show as inline warning badges.
> 
> 
> * **Route Naming Normalization:** Standardize endpoint path styles in the table (resolve mixing of `/api/health` and `stops.arrivals`).
> 
> 
> #### **C. Map & Stops Page**
> 
> 
> * **Header & Search Controls:**
> * Remove redundant secondary `Refresh` buttons adjacent to `Detect duplicates`.
> * Update the search input placeholder to dynamic counts rather than hardcoded string text (*"Search 1000 stops..."*).
> 
> 
> * **Selection & Terminology:**
> * Align top "Select all" checkbox cleanly with item row checkboxes.
> * Add a floating bulk-action toolbar when items are checked.
> * Rename non-standard UI copy like *"victim stops"* to clear software terminology like *"Source stops"* or *"Stops to merge"*.
> 
> 
> * **Footer Pagination:** Fix typo/spacing bug in the total count footer (`"1,000 stop s total"` $\rightarrow$ `"1,000 stops total"`).
> 
> 
> #### **D. Issues Page**
> 
> 
> * **Destructive Action Safety:** Relocate bulk destructive buttons (`Clear errors`, `Clear bug reports`) away from top search/filter inputs and place them behind secondary confirmation dropdowns.
> * **Stack Trace & Formatting:** Render stack traces and error payloads inside dedicated monospace code blocks with constrained max-height and scrolling.
> * **Quick Actions:** Add inline resolution toggles (`Resolve`, `Acknowledge`) to table rows next to `Copy`.
> 
> 
> #### **E. People Page**
> 
> 
> * **Button Contrast:** Increase visual weight and contrast for the primary `Invite` button (currently low-contrast gray outline).
> * **KPI Placement:** Re-style floating unstyled text lines (e.g., `2FA: 1 of 1 admins enrolled`) into standard KPI summary cards above the table.
> * **Row Metadata Density:** Reduce font weight and contrast for row metadata subtext (`invited by bootstrap · 1d ago`) to keep user email lines clean.
> 
> 
> #### **F. Settings Page**
> 
> 
> * **Form Grid Layout:** Re-align asymmetric grid columns in *Profile* settings to eliminate awkward vertical whitespace under `Save` buttons.
> * **2FA Card Heights:** Fix height discrepancies between side-by-side 2FA action cards (*Confirm identity* vs *Disable two-factor*) caused by uneven helper text length.
> * **Theme Control Deduplication:** Remove duplicate appearance section options if top-nav already includes active theme switching toggles.
> 
> 
> #### **G. Audit Page**
> 
> 
> * **Row Spacing & Badges:** Increase vertical padding in table rows for two-line action/error entries. Render error messages inside light red callout badges or monospace containers.
> * **Floating Badges:** Dock orphaned status badges (e.g., `durable · supabase`) neatly into the page header layout.
> * **Table Features:** Replace blank dashes (`—`) for missing emails with explicit placeholders (`N/A`), and add basic table header filters (Status, Action, IP) and sticky column headers for long lists.
> 
>