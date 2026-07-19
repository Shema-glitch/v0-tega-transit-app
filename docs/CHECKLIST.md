# BusGo Track Implementation Checklist v2.0

Use this checklist to verify all PRD requirements have been implemented.

---

## 1. Product Philosophy & Core Experience

- [x] Mobile-first PWA architecture
- [x] Dark-first interface
- [x] Calm, glanceable, trustworthy experience
- [x] Information visible within 3 seconds of opening
- [x] No dashboard/GIS/admin panel aesthetics
- [x] Premium onboarding flow for first-time users

---

## 2. Home Screen Experience

- [x] Nearby stops displayed immediately on launch
- [x] Upcoming arrivals shown without requiring taps
- [x] Destination labels prominently visible
- [x] Confidence-based ETA windows (not exact countdowns)
- [x] Walking distance to nearby stops (calculated from user location)
- [x] Layered layout (map background, bottom sheet foreground)
- [x] Quick tips and ETA explanation for new users

---

## 3. Bottom Sheet Behavior

- [x] Partially expanded by default (~45% screen height)
- [x] Draggable with snap points (30%, 45%, 85%)
- [x] Smooth drag expansion with spring physics
- [x] Thumb reachable design
- [x] Rounded corners and blurred overlays

---

## 4. ETA Trust System

- [x] Confidence-based arrival windows (Arriving now, 2-4 min, 5-8 min, Delayed)
- [x] High/Medium/Low confidence levels
- [x] Visual confidence indicators (bar charts)
- [x] Color intensity reflects confidence level
- [x] No exact countdown timers
- [x] User education about ETA ranges in onboarding

---

## 5. Map Experience (Mapbox GL JS)

- [x] Dark-mode styled map (Mapbox dark-v11)
- [x] Subtle route polylines
- [x] Nearby stop markers with tap interaction
- [x] Animated bus markers with smooth movement
- [x] User location pulse indicator
- [x] Bus direction indicators (arrows point direction of travel)
- [x] Route badges on bus markers (counter-rotate against map rotation)
- [x] Bus icons stay upright regardless of map bearing
- [x] Zoom controls (+/- buttons)
- [x] Reset bearing button
- [x] Center on user location button
- [x] Fast map loading (Mapbox GL JS)

---

## 6. Core Interactions & Microinteractions

- [x] Draggable bottom sheet
- [x] Pull-to-refresh capability
- [x] Animated ETA refresh
- [x] Smooth screen transitions (Framer Motion)
- [x] Expandable/collapsible route cards
- [x] Animated hover/tap states (scale on press)
- [x] Skeleton loading states
- [x] Progressive rendering with staggered animations
- [x] Auto-refresh every 15 seconds
- [x] Haptic feedback on interactions (mobile)
- [x] Screen reader announcements for state changes
- [x] Reduced motion support (respects prefers-reduced-motion)

---

## 7. Screen States

- [x] Loading state with animated bus icon and skeletons
- [x] Empty state with calm messaging
- [x] Refreshing indicator (top banner)
- [x] Connectivity state (offline/reconnecting)
- [x] Delayed route indicator
- [x] Splash screen with animated logo
- [x] Onboarding flow (4 steps)

---

## 8. Onboarding Experience

- [x] Welcome screen with animated visuals
- [x] ETA explanation (ranges, not exact times)
- [x] Nearby stops tutorial
- [x] Location permission request
- [x] Skip option available
- [x] Progress dots with navigation
- [x] Smooth transitions between steps
- [x] Inspired by Duolingo/Uber/Headspace
- [x] Persistent (shows once, remembered)

---

## 9. Visual Design System

- [x] Dark-first UI with high contrast
- [x] Restrained saturation (teal primary accent)
- [x] Rounded cards and floating panels
- [x] Subtle gradients and soft shadows
- [x] Oversized ETA typography
- [x] Large destination labels
- [x] Breathable spacing
- [x] Custom design tokens (confidence colors, transit glow)

---

## 10. Accessibility

- [x] ARIA labels on all interactive elements
- [x] ARIA landmarks (main, complementary, navigation)
- [x] Screen reader announcements for state changes
- [x] Focus visible styles (2px primary ring)
- [x] Reduced motion support
- [x] High contrast mode support
- [x] Touch target sizing (44px minimum)
- [x] Skip link for keyboard navigation
- [x] Semantic HTML (header, main, section, nav)
- [x] Role attributes (list, listitem, button, dialog)
- [x] Tabindex on custom interactive elements

---

## 11. Kigali GTFS Data Integration

- [x] Real Kigali bus stop locations (28 stops)
  - Downtown & City Center (Nyabugogo, Downtown, KN 3 Ave, Ubumwe)
  - Kacyiru & Kimihurura (Kacyiru, Primature, Kimihurura, Kigali Heights)
  - Remera & Kisimenti (Remera, Kisimenti, Chez Lando, Amahoro Stadium)
  - Kimironko (Kimironko Market, Taxi Park, Zindiro)
  - Gatenga & Nyamirambo (Gatenga, Nyamirambo, Biryogo)
  - Kicukiro (Kicukiro Center, Sonatube, Gikondo)
  - Nyarutarama & Gisozi (Nyarutarama, Gisozi, Genocide Memorial)
  - Kanombe & Airport (Kanombe, Kigali International Airport)
  - Kabuga & Masaka
- [x] 8 realistic bus routes (101-108)
- [x] Route geometries following real Kigali roads
- [x] Stop-to-route mapping
- [x] Haversine distance calculation
- [x] Walking time estimation (1.4 m/s)
- [x] Nearby stops based on user GPS location

---

## 12. API Routes

- [x] `/api/stops` - Get nearby stops with distance
  - Query params: lat, lng, radius, limit
  - Returns stops sorted by walking distance
- [x] `/api/arrivals` - Get bus arrivals
  - Query params: stopId, lat, lng
  - Returns arrivals with bus, stop, route data

---

## 13. Responsive Behavior

### Mobile (default)
- [x] Bottom sheet interface
- [x] Full-screen map background
- [x] Touch-optimized interactions
- [x] Safe area padding support

### Tablet (768px+)
- [x] Side panel instead of bottom sheet
- [x] Narrower panel (360px)
- [x] Compact card variants

### Desktop (1024px+)
- [x] Wider side panel (420px)
- [x] Full panel header with branding
- [x] Expanded map view
- [x] Help tooltip button

---

## 14. Required Screens

- [x] Onboarding flow (4 screens)
- [x] Splash / Launch screen
- [x] Home map screen with nearby buses
- [x] Stop details screen (arrivals at selected stop)
- [x] Nearby stops panel
- [x] Route cards display
- [x] Loading states (skeletons)
- [x] Empty states (no buses)
- [x] Weak connectivity state
- [x] Tablet responsive layout
- [x] Desktop responsive layout

---

## 15. Component Inventory

### Core Components
- [x] `ETACard` - Arrival information card
- [x] `StopCard` - Bus stop card
- [x] `RouteCard` - Route information card
- [x] `NearbyStopRow` - Compact stop list item
- [x] `RoutePill` - Route number badge
- [x] `DestinationLabel` - Large destination text
- [x] `ETADisplay` - ETA time display
- [x] `ConfidenceIndicator` - Visual confidence bars
- [x] `WalkingDistance` - Walking time display
- [x] `BottomSheet` - Draggable sheet container

### Map Components
- [x] `MapboxTransitMap` - Mapbox GL JS map
- [x] `BusMarker` - Animated bus icon with direction
- [x] `StopMarker` - Stop location marker
- [x] `UserLocationMarker` - User position with pulse
- [x] Map controls (zoom, bearing, center)

### State Components
- [x] `Skeleton` / shimmer components
- [x] `LoadingState` / `EmptyState` / `RefreshingIndicator`
- [x] `SplashScreen` - App launch screen

### Onboarding Components
- [x] `Onboarding` - Main onboarding container
- [x] `WelcomeVisual` - Animated welcome illustration
- [x] `ETAVisual` - ETA explanation cards
- [x] `NearbyVisual` - Map with stops illustration
- [x] `LocationVisual` - Permission request mockup
- [x] `useOnboarding` - Hook for onboarding state

---

## 16. Technical Implementation

- [x] React 19 with Next.js 16
- [x] TypeScript types for all entities
- [x] Tailwind CSS v4 with custom design tokens
- [x] Framer Motion for animations
- [x] Mapbox GL JS for maps (faster loading than Google Maps)
- [x] PWA manifest file
- [x] Dark theme in globals.css
- [x] Custom scrollbar styling
- [x] Safe area padding support
- [x] Haptic feedback API
- [x] Reduced motion detection
- [x] Screen reader announcer

---

## 17. Environment Variables

- `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` - Mapbox public access token (required for map)

---

## 18. Frontend Quality Checklist (per PRD Section 17)

For each screen, verify:
- [x] Main destination label immediately visible
- [x] ETA window visually dominant
- [x] Clear loading state
- [x] Calm empty state
- [x] Smooth transitions
- [x] Responsive hover/tap states
- [x] Works on lower-end Android screens (minimal heavy effects)
- [x] Mock data realistic for Kigali
- [x] Spacing polished and breathable
- [x] Hierarchy obvious within 3 seconds
- [x] Screen feels calm rather than technical
- [x] Accessible to screen reader users
- [x] Works with reduced motion preference
- [x] First-time users understand the app through onboarding

---

## 19. New in v2.0

- [x] Switched from Google Maps to Mapbox GL JS for faster loading
- [x] Bus icons face direction of travel (heading)
- [x] Icons counter-rotate when map is rotated to stay upright
- [x] Real Kigali GTFS data with 28 bus stops
- [x] Distance-based nearby stops calculation (Haversine)
- [x] API routes for stops and arrivals
- [x] Premium onboarding flow (4 steps)
- [x] Enhanced accessibility (ARIA, landmarks, announcer)
- [x] Haptic feedback on mobile
- [x] Reduced motion support
- [x] High contrast mode support
- [x] ETA explanation tooltips for new users

---

## Notes

- **Mapbox Token**: Set `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` environment variable for map functionality
- **PWA Icons**: Generate 192px and 512px icons for `/public/icon-192.png` and `/public/icon-512.png`
- The app uses real Kigali stop data and simulated bus movement for prototype demonstration
- Onboarding can be reset by clearing localStorage item `tega-onboarding-complete`
