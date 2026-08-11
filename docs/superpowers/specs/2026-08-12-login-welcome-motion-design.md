# Login + welcome motion — design

Date: 2026-08-12
Status: approved, pending write-up review

## Goal

Add purposeful, finite motion to the admin sign-in experience using **Motion**
(formerly Framer Motion) — the project's first JS animation dependency.
Scope: the `/goToAdminAuth` login page (idle-state text, and the login
interaction itself), plus a "welcome" overlay shown once on the dashboard
right after a fresh sign-in.

**Explicit non-goals / constraints:**
- No pulsing/breathing loops, no gradient shimmer, no glow effects. Every
  animation plays once and settles, or is a direct response to a real state
  change (focus, error, digit entry, step change). Nothing loops
  indefinitely in the background.
- No new animation vocabulary for "loading" — reuse the existing
  `CircleNotch` spin already used everywhere else in the console rather than
  inventing a skeleton/shimmer loader.
- Respect `prefers-reduced-motion` throughout, consistent with the existing
  `globals.css` discipline (functional motion degrades to instant/opacity-only
  rather than vanishing; purely decorative motion is skipped entirely).

## Dependency

`npm install motion`, imported from `motion/react`. React 19 / Next 16
compatible. No other libraries changed.

## 1. Idle-state text animation (`app/goToAdminAuth/page.tsx`)

A new `hasInteracted` boolean state, flipped to `true` the moment the email
`<Input>` receives focus, or immediately if the page mounts already on the
`code` step (a fresh page load never needs the idle sequence to play against
the code step).

While the component is still on the `email` step and `hasInteracted` is
`false`:
- The headline ("The control room for BusGo Track.") plays a one-time
  staggered word reveal on mount (opacity 0→1 + `y: 6px→0`, matching the
  existing `rise-in`/`--rise-index` stagger convention already in
  `globals.css`).
- Immediately after, the 3-item feature list plays its own staggered
  entrance (same treatment, one item after another).

Both sequences play exactly once, on mount, and do not loop. Once
`hasInteracted` is `true`, the brand panel makes no further motion — nothing
animates there while someone is actually filling in the form. This is a
one-time entrance, not an idle/ambient loop, so it satisfies "animate when
idle" without introducing a background loop that could read as decorative
noise.

Under `prefers-reduced-motion`, the sequence is skipped — headline and list
appear in their final state immediately (no reduced-duration fallback needed
since it's non-essential decorative motion).

## 2. Login interaction micro-motion

**Step transition** (`goToAdminAuth/page.tsx`): the email-step and code-step
blocks, currently two sibling conditionally-rendered blocks, move under a
single `AnimatePresence mode="wait"`. Exit: fade + slight slide out toward
the direction of travel; enter: fade + slide in from the same direction.
~200ms, matching the existing `panel-pop`/`rise-in` duration range already
established in this codebase (160–280ms).

**OTP slots** (`components/admin/otp-slots.tsx`): each slot's rendered digit
is wrapped in an `AnimatePresence`-driven `motion.span` keyed on the digit
value itself, so a new digit landing pops in (`scale: 0.85→1`, `opacity:
0→1`, ~120ms) instead of appearing instantly. When `invalid` flips to
`true`, the whole slot row plays a single horizontal shake (a short
`x` keyframe sequence, ~300ms total, runs once per invalid transition, not
looping). The active slot's ring stays exactly as it is today — a static
border/ring, no animation added there (avoids the pulsing-glow territory).

**Input focus** (`goToAdminAuth/page.tsx` email input): wrap the `Input` in
a `motion.div` with `whileFocus={{ scale: 1.01 }}`, transition ~150ms.
Subtle, one state to another, no loop.

**Error/success banners** (`goToAdminAuth/page.tsx`, both steps): the
inline error text and the "Code sent — check your inbox" success line move
under `AnimatePresence`, animating in/out with a small vertical
slide+fade (~150ms) instead of appearing/disappearing instantly.

All of the above degrade under `prefers-reduced-motion` to their end state
appearing/disappearing with only an opacity crossfade (no scale, slide, or
shake) — functional, not absent, matching how spinners already behave
elsewhere in this app.

## 3. Welcome overlay (dashboard side)

New file: `components/admin/welcome-overlay.tsx`.

**Content:** full-screen overlay, matching the console's existing dark/ivory
theme tokens (no new colors). Shows:
- A time-of-day greeting — "Good morning/afternoon/evening, `<name>`" (name
  falls back to the email local-part if no display name is set, matching
  the sidebar's existing fallback logic).
- "Loading up your console — one moment."
- The existing `CircleNotch` icon, spinning (reusing the app's established
  loading vocabulary, not a new pattern).

**Timing:** the overlay is controlled by `admin/page.tsx`'s real `loading`
state (already exists — flips `false` once the first `refreshAll()` fetch
resolves), with a minimum floor of 800ms so it never flashes on a fast
connection. It does one entrance (fade+scale in) when mounted and one exit
(fade+scale out) when dismissed — no looping background motion while it's
up besides the spinner's rotation, which is the same functional spin used
elsewhere and already exempted from the "no pulsing" rule the same way
existing spinners are.

**Trigger, covering both sign-in paths:**
- `goToAdminAuth/page.tsx`'s `verifyCode()` success path changes
  `window.location.replace('/admin')` → `window.location.replace('/admin?welcome=1')`.
- `app/api/auth/callback/route.ts`'s success path changes
  `NextResponse.redirect(new URL('/admin', ...))` →
  `NextResponse.redirect(new URL('/admin?welcome=1', ...))`.
- `admin/page.tsx` reads `welcome=1` from the URL on mount (via
  `window.location.search`, matching the existing pattern used for
  `goToAdminAuth`'s `?error=` handling), shows the overlay if present, and
  strips the param via `history.replaceState` immediately — so a later
  manual refresh of `/admin` (now bare, no `?welcome=1`) skips the overlay
  entirely, even mid-session.

A plain page load/refresh of an already-authenticated session — no
`?welcome=1` present — renders the dashboard directly, no overlay, no
change in behavior from today.

## Testing / verification

No new automated test infrastructure introduced (this codebase has no
component-test convention; only API routes have `.test.ts`). Verification
is manual, via the Chrome extension against a live dev server:
- Idle sequence plays once on a fresh `/goToAdminAuth` load, doesn't replay
  on re-render, stops entirely once the email input is focused.
- Step transition animates both directions (email→code via "Send code",
  code→email via "Back").
- OTP slot pop-in and shake are visually confirmed; shake only fires on a
  genuine invalid-code response, not on every keystroke.
- Welcome overlay appears after a simulated fresh sign-in (`?welcome=1`
  present), stays up until `loading` flips false, and does not appear on a
  plain reload of `/admin` afterward.
- `prefers-reduced-motion: reduce` (via Chrome DevTools emulation or OS
  setting) is spot-checked to confirm decorative motion is skipped and
  functional transitions still work.
- `npx tsc --noEmit` and `npx eslint` clean on every touched file, as with
  every other change in this session.

## Implementation split (for parallel agent dispatch)

Four largely-independent surfaces, matching the natural file boundaries:
1. `app/goToAdminAuth/page.tsx` — idle sequence, step transition,
   input focus, error/success banners, the `?welcome=1` redirect change.
2. `components/admin/otp-slots.tsx` — digit pop-in, invalid shake.
3. `components/admin/welcome-overlay.tsx` (new) + its hookup into
   `app/admin/page.tsx` (reading `?welcome=1`, wiring to `loading`).
4. `app/api/auth/callback/route.ts` — the one-line redirect change to add
   `?welcome=1`.

(1) and (2) touch the shared `OtpSlots` import contract only in that (1)
renders `<OtpSlots>` — no prop/behavior change needed there, so they're safe
to parallelize. (3) and (4) are two small, independent changes that could be
done by the same agent or split further if desired.
