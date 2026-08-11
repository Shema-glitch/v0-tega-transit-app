# Login + Welcome Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add purposeful, finite motion (via the `motion` npm package) to the admin sign-in flow — an idle-state entrance on the login page, small interaction feedback while actually signing in, and a one-time "welcome" overlay on the dashboard right after a fresh sign-in.

**Architecture:** `motion/react`'s declarative `motion.*` components and `AnimatePresence` are layered onto existing JSX in `app/goToAdminAuth/page.tsx` and `components/admin/otp-slots.tsx` (no structural rewrites), plus one new component (`components/admin/welcome-overlay.tsx`) rendered from `app/admin/page.tsx`, triggered by a `?welcome=1` query param set by both sign-in success paths (typed-code verify, and the magic-link server redirect).

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Tailwind v4, `motion` (new dependency, `motion/react` import path).

## Global Constraints

- No pulsing/breathing loops, no gradient shimmer, no glow effects. Every animation plays once and settles, or is a direct response to a real state change. Nothing loops indefinitely in the background.
- Reuse the existing `CircleNotch` spin (`@phosphor-icons/react`, `animate-spin`) for any loading indicator — do not invent a skeleton/shimmer loader.
- Every purely-decorative animation must be skipped under `prefers-reduced-motion` (via `motion`'s `useReducedMotion()` hook); functional transitions (step change, error appearing, the welcome overlay) degrade to opacity-only instead of vanishing.
- No new automated test infrastructure — this codebase has no component-test convention (only API routes have `.test.ts`). Verification is `npx tsc --noEmit -p tsconfig.json`, `npx eslint <file>`, and a manual check via the Chrome extension against a running `npm run dev` server.
- Match existing durations already established in `globals.css` (`rise-in` 280ms, `panel-pop` 160ms) — new transitions should sit in the same 120–300ms range, not feel slower/heavier than what's already there.

---

## File Structure

- **Modify** `app/goToAdminAuth/page.tsx` — idle entrance sequence, step transition, input focus, error/success banner motion, the `?welcome=1` redirect change on successful verify.
- **Modify** `components/admin/otp-slots.tsx` — digit pop-in, invalid-code shake.
- **Create** `components/admin/welcome-overlay.tsx` — the full-screen post-login overlay.
- **Modify** `app/admin/page.tsx` — reads `?welcome=1`, owns the show/hide timing (gated on the real `loading` state plus an 800ms floor), renders `<WelcomeOverlay>`.
- **Modify** `app/api/auth/callback/route.ts` — one-line change so the magic-link success redirect also carries `?welcome=1`.
- **Modify** `package.json` / `package-lock.json` — adds the `motion` dependency (via `npm install`, not hand-edited).

---

### Task 1: Install the `motion` dependency

**Files:**
- Modify: `package.json`, `package-lock.json` (via `npm install`, not by hand)

**Interfaces:**
- Produces: the `motion/react` module, importable as `import { motion, AnimatePresence, useReducedMotion } from 'motion/react'` in every later task.

- [ ] **Step 1: Install**

Run from the repo root:

```bash
npm install motion
```

- [ ] **Step 2: Verify it resolves**

```bash
node -e "require.resolve('motion/react')" 
```

Expected: no output (success — `require.resolve` prints nothing and exits 0 when the module is found; it throws if not found).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add motion for the login/welcome animation work"
```

---

### Task 2: Idle-state entrance sequence on the login page

**Files:**
- Modify: `app/goToAdminAuth/page.tsx`

**Interfaces:**
- Consumes: `motion/react`'s `motion.h1`, `motion.p`, `motion.ul`, `motion.li` (Task 1).
- Produces: no new exports — internal to this file. Introduces a `hasInteracted` state variable local to `GoToAdminAuthPage`.

The brand panel currently renders a static headline, a static paragraph, and a static 3-item `<ul>` (lines 301–323 in the current file). This task makes that block play a one-time staggered entrance when the page mounts on the `email` step, and never animate again once the visitor touches the email input.

- [ ] **Step 1: Add the `hasInteracted` state, a `reduceMotion` flag, and the `motion/react` import**

In `app/goToAdminAuth/page.tsx`, add the import alongside the existing ones. This same import is reused by Tasks 3 and 4 in this file, so it's written with everything all four tasks in this file need already included — don't re-add it in later tasks:

```tsx
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
```

Add this state declaration right after the existing `const [step, setStep] = useState<Step>('email')` line:

```tsx
  // Drives the brand-panel entrance sequence below — once true (the visitor
  // has focused the email field), the brand panel never animates again so
  // motion doesn't compete with someone actually filling in the form.
  const [hasInteracted, setHasInteracted] = useState(false)
  // Gates every purely-decorative animation in this file (idle entrance,
  // focus scale) to skip entirely under prefers-reduced-motion; functional
  // transitions (step swap, error/success banners) stay but drop their
  // slide offset to opacity-only — see how each is used below.
  const reduceMotion = useReducedMotion()
```

- [ ] **Step 2: Replace the static brand-panel block with the animated version**

Find this block (the brand panel's headline/paragraph/list, currently plain HTML elements):

```tsx
          <div className="relative max-w-md">
            <h1 className="text-4xl font-semibold tracking-tight text-balance xl:text-5xl">
              The control room for BusGo Track.
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Flip endpoints off, triage incidents, and review stop suggestions — gated behind a code
              sent to your inbox.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <Pulse className="size-4 shrink-0 text-brand/90" />
                Live health checks on every API route
              </li>
              <li className="flex items-center gap-2">
                <ShieldCheck className="size-4 shrink-0 text-brand/90" />
                Signed-in sessions only — no shared secrets in the browser
              </li>
              <li className="flex items-center gap-2">
                <MapPin className="size-4 shrink-0 text-brand/90" />
                Approve stop-suggestion edits for the Kigali network
              </li>
            </ul>
          </div>
```

Replace it with:

```tsx
          <div className="relative max-w-md">
            <motion.h1
              initial={hasInteracted || reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.32, ease: [0.23, 1, 0.32, 1] }}
              className="text-4xl font-semibold tracking-tight text-balance xl:text-5xl"
            >
              The control room for BusGo Track.
            </motion.h1>
            <motion.p
              initial={hasInteracted || reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.32, delay: 0.06, ease: [0.23, 1, 0.32, 1] }}
              className="mt-2 text-sm leading-relaxed text-muted-foreground"
            >
              Flip endpoints off, triage incidents, and review stop suggestions — gated behind a code
              sent to your inbox.
            </motion.p>
            <ul className="mt-6 space-y-3 text-sm text-muted-foreground">
              {[
                { icon: Pulse, text: 'Live health checks on every API route' },
                { icon: ShieldCheck, text: 'Signed-in sessions only — no shared secrets in the browser' },
                { icon: MapPin, text: 'Approve stop-suggestion edits for the Kigali network' },
              ].map(({ icon: Icon, text }, i) => (
                <motion.li
                  key={text}
                  initial={hasInteracted || reduceMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, delay: 0.16 + i * 0.06, ease: [0.23, 1, 0.32, 1] }}
                  className="flex items-center gap-2"
                >
                  <Icon className="size-4 shrink-0 text-brand/90" />
                  {text}
                </motion.li>
              ))}
            </ul>
          </div>
```

This plays once on mount (`initial` only applies on the component's first render for each element — since `hasInteracted` starts `false`, the entrance plays; setting `hasInteracted` to `true` later doesn't replay it because `initial` is only read once, not on every render). Passing `initial={false}` when `hasInteracted` is already `true` on mount (relevant if this component ever remounts after interaction) skips the animation entirely and renders in the final state immediately.

- [ ] **Step 3: Wire `hasInteracted` from the email input's focus**

Find the email `<Input>` in the `step === 'email'` branch:

```tsx
                  <Input
                    id="admin-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value)
                      setConfirmFirst(false)
                      if (send.kind !== 'sending') setSend({ kind: 'idle' })
                    }}
                    placeholder="you@example.com"
                    className="h-11 pr-10 text-sm"
                    autoFocus
                  />
```

Add an `onFocus` handler:

```tsx
                  <Input
                    id="admin-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value)
                      setConfirmFirst(false)
                      if (send.kind !== 'sending') setSend({ kind: 'idle' })
                    }}
                    onFocus={() => setHasInteracted(true)}
                    placeholder="you@example.com"
                    className="h-11 pr-10 text-sm"
                    autoFocus
                  />
```

Also set it immediately when the page mounts already past the email step (covers the case where `verifyCode`'s auto-submit or a direct code-step render means the brand panel should never play its entrance against the code step). Add this effect right after the existing `hasInteracted` state declaration:

```tsx
  useEffect(() => {
    if (step === 'code') setHasInteracted(true)
  }, [step])
```

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit -p tsconfig.json
npx eslint app/goToAdminAuth/page.tsx
```

Both must produce no output/errors.

Then manually check in the browser: run `npm run dev`, open `http://localhost:3000/goToAdminAuth`. The headline, subtext, and three list items should fade/rise in with a short stagger on load. Click into the email field — reload the page and confirm the sequence plays again on a fresh load (it should, since each load is a fresh mount with `hasInteracted` starting `false`). Then enable Chrome DevTools' reduced-motion emulation (Rendering tab → "Emulate CSS media feature prefers-reduced-motion" → reduce) and reload again — the headline and list should appear immediately in their final position with no stagger or movement.

- [ ] **Step 5: Commit**

```bash
git add app/goToAdminAuth/page.tsx
git commit -m "feat(admin auth): staggered entrance for the login brand panel"
```

---

### Task 3: Step transition (email step ↔ code step)

**Files:**
- Modify: `app/goToAdminAuth/page.tsx`

**Interfaces:**
- Consumes: `AnimatePresence`, `motion.div` from `motion/react` (Task 1). Builds on Task 2's edits to this file.

The `step === 'email' ? (...) : (...)` conditional currently swaps between the email form and the code form instantly. This task wraps both branches in `AnimatePresence` so the swap animates.

- [ ] **Step 1: Wrap the two step branches**

(`AnimatePresence` and `reduceMotion` are already available from Task 2's import/state changes to this same file — no additional import needed here.)

Find:

```tsx
            {step === 'email' ? (
              <form
                className="rise-in mt-6"
                style={{ '--rise-index': 1 } as CSSProperties}
                onSubmit={(e) => {
                  e.preventDefault()
                  requestCode()
                }}
              >
```

Change the outer form's wrapper: remove `rise-in`/`--rise-index` from this element (the whole conditional block now gets its own motion treatment instead) and wrap the entire ternary in `<AnimatePresence mode="wait">`. The full replacement, from the `{step === 'email' ? (` line through the closing `)}` of the ternary, becomes:

```tsx
            <AnimatePresence mode="wait">
              {step === 'email' ? (
                <motion.form
                  key="email-step"
                  initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -12 }}
                  transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                  className="mt-6"
                  onSubmit={(e) => {
                    e.preventDefault()
                    requestCode()
                  }}
                >
                  <label htmlFor="admin-email" className="mb-2 block text-xs font-semibold">
                    Email
                  </label>
                  <div className="relative">
                    <Input
                      id="admin-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value)
                        setConfirmFirst(false)
                        if (send.kind !== 'sending') setSend({ kind: 'idle' })
                      }}
                      onFocus={() => setHasInteracted(true)}
                      placeholder="you@example.com"
                      className="h-11 pr-10 text-sm"
                      autoFocus
                    />
                    <Envelope className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  </div>

                  {confirmFirst && send.kind === 'sent' && (
                    <div className="mt-2 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2.5">
                      <p className="flex items-center gap-1 text-xs font-medium text-amber-300">
                        <EnvelopeOpen className="size-3.5" /> One-time confirmation sent to {maskEmail(email)}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        This address is new — click the confirmation link in the email once (it lands you
                        back on this sign-in page), then send the code again. After that, codes come
                        straight to your inbox.
                      </p>
                    </div>
                  )}
                  {send.kind === 'sent' && !confirmFirst && (
                    <p className="mt-2 flex items-center gap-1 text-xs font-medium text-success">
                      <CheckCircle className="size-3.5" /> Code sent — check your inbox.
                    </p>
                  )}
                  {sendError && (
                    <p className="mt-2 flex items-start gap-1 text-xs text-destructive">
                      <Triangle className="mt-px size-3.5 shrink-0" />
                      <span>{sendError.message}</span>
                    </p>
                  )}
                  {send.kind === 'error' && send.hint && (
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{send.hint}</p>
                  )}

                  <Button
                    type="submit"
                    disabled={send.kind === 'sending' || !email.trim()}
                    className="mt-4 h-11 w-full justify-center text-sm"
                  >
                    {send.kind === 'sending' ? (
                      <>
                        <CircleNotch className="size-4 animate-spin" /> Sending…
                      </>
                    ) : (
                      'Send code'
                    )}
                  </Button>

                  <p className="mt-6 flex justify-center">
                    <a
                      href="/"
                      className="group inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" />
                      Back to the public status page
                    </a>
                  </p>
                </motion.form>
              ) : (
                <motion.div
                  key="code-step"
                  initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 12 }}
                  transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                  className="mt-6"
                >
                  {send.kind === 'sent' && (
                    <p className="mb-2 flex items-center gap-1 text-xs font-medium text-success">
                      <CheckCircle className="size-3.5" /> Code sent to {maskEmail(email)} — check your
                      inbox.
                    </p>
                  )}

                  <label htmlFor="admin-code" className="mb-2 block text-xs font-semibold">
                    One-time code
                  </label>
                  <OtpSlots
                    id="admin-code"
                    value={code}
                    onChange={onCodeChange}
                    disabled={verify.kind === 'verifying'}
                    invalid={!!verifyError}
                  />

                  {verifyError && (
                    <p className="mt-2 flex items-start gap-1 text-xs text-destructive">
                      <Triangle className="mt-px size-3.5 shrink-0" />
                      <span>{verifyError.message}</span>
                    </p>
                  )}
                  {send.kind === 'error' && sendError && (
                    <p className="mt-2 flex items-start gap-1 text-xs text-destructive">
                      <Triangle className="mt-px size-3.5 shrink-0" />
                      <span>{sendError.message}</span>
                    </p>
                  )}

                  <div className="mt-4 grid grid-cols-[auto_1fr] gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setStep('email')
                        setVerify({ kind: 'idle' })
                        setCode('')
                      }}
                      disabled={busy}
                      className="h-11 px-3 text-xs"
                    >
                      <ArrowLeft className="size-3.5" /> Back
                    </Button>
                    <Button
                      type="button"
                      onClick={() => verifyCode()}
                      disabled={verify.kind === 'verifying' || !/^\d{6,10}$/.test(code)}
                      className="h-11 text-sm"
                    >
                      {verify.kind === 'verifying' ? (
                        <>
                          <CircleNotch className="size-4 animate-spin" /> Signing in…
                        </>
                      ) : (
                        'Sign in'
                      )}
                    </Button>
                  </div>

                  <div className="mt-4 flex items-center justify-between text-xs">
                    <button
                      type="button"
                      onClick={requestCode}
                      disabled={!resendEnabled}
                      className="font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:pointer-events-none disabled:opacity-50"
                    >
                      {send.kind === 'sending'
                        ? 'Sending…'
                        : resendIn > 0
                          ? `Resend code in ${fmtCountdown(resendIn)}`
                          : 'Resend code'}
                    </button>
                    <a
                      href="/"
                      className="font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      public status page
                    </a>
                  </div>

                  <Alert className="mt-4 border-muted/40 bg-muted/20">
                    <AlertDescription className="text-xs text-muted-foreground">
                      No email? Check spam, wait a minute, then resend. You can also click the link in
                      the email instead of typing the code.
                    </AlertDescription>
                  </Alert>
                </motion.div>
              )}
            </AnimatePresence>
```

Note this also folds in Task 2's `onFocus={() => setHasInteracted(true)}` on the email `Input` (already present if Task 2 ran first — if doing this task standalone, add it as shown above).

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit -p tsconfig.json
npx eslint app/goToAdminAuth/page.tsx
```

Manually: submit a valid-looking email (any allowlisted admin address you have) and confirm the email form slides/fades out to the left while the code form slides/fades in from the right. Click "Back" and confirm the reverse. Then enable Chrome DevTools' reduced-motion emulation and repeat — the transition should still happen but as a plain crossfade with no horizontal movement.

- [ ] **Step 3: Commit**

```bash
git add app/goToAdminAuth/page.tsx
git commit -m "feat(admin auth): animate the email/code step transition"
```

---

### Task 4: Input focus motion + error/success banner motion

**Files:**
- Modify: `app/goToAdminAuth/page.tsx`

**Interfaces:**
- Consumes: `AnimatePresence`, `motion.div`, `motion.p` from `motion/react` (Task 1). Builds on Tasks 2–3's edits to this file.

- [ ] **Step 1: Wrap the email input in a focus-scale `motion.div`**

Find (inside the `motion.form` from Task 3):

```tsx
                  <div className="relative">
                    <Input
                      id="admin-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value)
                        setConfirmFirst(false)
                        if (send.kind !== 'sending') setSend({ kind: 'idle' })
                      }}
                      onFocus={() => setHasInteracted(true)}
                      placeholder="you@example.com"
                      className="h-11 pr-10 text-sm"
                      autoFocus
                    />
                    <Envelope className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  </div>
```

Replace the wrapping `<div>` with `motion.div`:

```tsx
                  <motion.div
                    whileFocus={reduceMotion ? undefined : { scale: 1.01 }}
                    transition={{ duration: 0.15 }}
                    className="relative"
                  >
                    <Input
                      id="admin-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value)
                        setConfirmFirst(false)
                        if (send.kind !== 'sending') setSend({ kind: 'idle' })
                      }}
                      onFocus={() => setHasInteracted(true)}
                      placeholder="you@example.com"
                      className="h-11 pr-10 text-sm"
                      autoFocus
                    />
                    <Envelope className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  </motion.div>
```

(`whileFocus` on a `motion.div` applies while any focusable descendant — the `<Input>` — has focus; this is a documented Motion behavior for focus-within-style targeting.)

- [ ] **Step 2: Animate the send-error and success banners in/out**

Find the three conditional blocks right after the input, still inside the email step:

```tsx
                  {confirmFirst && send.kind === 'sent' && (
                    <div className="mt-2 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2.5">
                      <p className="flex items-center gap-1 text-xs font-medium text-amber-300">
                        <EnvelopeOpen className="size-3.5" /> One-time confirmation sent to {maskEmail(email)}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        This address is new — click the confirmation link in the email once (it lands you
                        back on this sign-in page), then send the code again. After that, codes come
                        straight to your inbox.
                      </p>
                    </div>
                  )}
                  {send.kind === 'sent' && !confirmFirst && (
                    <p className="mt-2 flex items-center gap-1 text-xs font-medium text-success">
                      <CheckCircle className="size-3.5" /> Code sent — check your inbox.
                    </p>
                  )}
                  {sendError && (
                    <p className="mt-2 flex items-start gap-1 text-xs text-destructive">
                      <Triangle className="mt-px size-3.5 shrink-0" />
                      <span>{sendError.message}</span>
                    </p>
                  )}
```

Replace with:

```tsx
                  <AnimatePresence>
                    {confirmFirst && send.kind === 'sent' && (
                      <motion.div
                        key="confirm-first"
                        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                        transition={{ duration: 0.15 }}
                        className="mt-2 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2.5"
                      >
                        <p className="flex items-center gap-1 text-xs font-medium text-amber-300">
                          <EnvelopeOpen className="size-3.5" /> One-time confirmation sent to {maskEmail(email)}
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          This address is new — click the confirmation link in the email once (it lands you
                          back on this sign-in page), then send the code again. After that, codes come
                          straight to your inbox.
                        </p>
                      </motion.div>
                    )}
                    {send.kind === 'sent' && !confirmFirst && (
                      <motion.p
                        key="sent"
                        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                        transition={{ duration: 0.15 }}
                        className="mt-2 flex items-center gap-1 text-xs font-medium text-success"
                      >
                        <CheckCircle className="size-3.5" /> Code sent — check your inbox.
                      </motion.p>
                    )}
                    {sendError && (
                      <motion.p
                        key="send-error"
                        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                        transition={{ duration: 0.15 }}
                        className="mt-2 flex items-start gap-1 text-xs text-destructive"
                      >
                        <Triangle className="mt-px size-3.5 shrink-0" />
                        <span>{sendError.message}</span>
                      </motion.p>
                    )}
                  </AnimatePresence>
```

- [ ] **Step 3: Same treatment for the code-step's error banner**

Find, inside the code-step `motion.div` (Task 3):

```tsx
                  {verifyError && (
                    <p className="mt-2 flex items-start gap-1 text-xs text-destructive">
                      <Triangle className="mt-px size-3.5 shrink-0" />
                      <span>{verifyError.message}</span>
                    </p>
                  )}
                  {send.kind === 'error' && sendError && (
                    <p className="mt-2 flex items-start gap-1 text-xs text-destructive">
                      <Triangle className="mt-px size-3.5 shrink-0" />
                      <span>{sendError.message}</span>
                    </p>
                  )}
```

Replace with:

```tsx
                  <AnimatePresence>
                    {verifyError && (
                      <motion.p
                        key="verify-error"
                        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                        transition={{ duration: 0.15 }}
                        className="mt-2 flex items-start gap-1 text-xs text-destructive"
                      >
                        <Triangle className="mt-px size-3.5 shrink-0" />
                        <span>{verifyError.message}</span>
                      </motion.p>
                    )}
                    {send.kind === 'error' && sendError && (
                      <motion.p
                        key="resend-error"
                        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                        transition={{ duration: 0.15 }}
                        className="mt-2 flex items-start gap-1 text-xs text-destructive"
                      >
                        <Triangle className="mt-px size-3.5 shrink-0" />
                        <span>{sendError.message}</span>
                      </motion.p>
                    )}
                  </AnimatePresence>
```

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit -p tsconfig.json
npx eslint app/goToAdminAuth/page.tsx
```

Manually: click into the email field and confirm a subtle scale-up. Submit an invalid email format ("not-an-email") and confirm the error line fades/slides in rather than popping in instantly; fix it and resubmit to see the transition again. With reduced-motion emulation on, confirm the focus scale is gone entirely and the error banner still appears/disappears via a plain fade.

- [ ] **Step 5: Commit**

```bash
git add app/goToAdminAuth/page.tsx
git commit -m "feat(admin auth): animate focus state and error/success banners"
```

---

### Task 5: OTP slot digit pop-in and invalid shake

**Files:**
- Modify: `components/admin/otp-slots.tsx`

**Interfaces:**
- Consumes: `AnimatePresence`, `motion.div`, `motion.span`, `useReducedMotion` from `motion/react` (Task 1).
- Produces: no prop/interface change — `OtpSlots`'s existing props (`id`, `value`, `onChange`, `disabled`, `invalid`, `minSlots`, `maxSlots`) are unchanged, so every call site (`goToAdminAuth/page.tsx`, `settings-panel.tsx`, `app/admin/page.tsx`'s TOTP challenge dialog) needs no changes.

- [ ] **Step 1: Add the `motion/react` import and a reduced-motion check**

Change:

```tsx
import { useRef } from 'react'
```

to:

```tsx
import { useRef } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
```

- [ ] **Step 2: Replace the slot-rendering block**

Find:

```tsx
export function OtpSlots({
  id,
  value,
  onChange,
  disabled,
  invalid,
  minSlots = 6,
  maxSlots = 10,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  invalid?: boolean
  /** Slot count floor/ceiling — grows live with `value.length` in between. */
  minSlots?: number
  maxSlots?: number
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const slotCount = Math.max(minSlots, Math.min(maxSlots, value.length))

  return (
    <div className="relative" onClick={() => inputRef.current?.focus()}>
```

Replace the two `const` lines and the opening `<div>` with:

```tsx
export function OtpSlots({
  id,
  value,
  onChange,
  disabled,
  invalid,
  minSlots = 6,
  maxSlots = 10,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  invalid?: boolean
  /** Slot count floor/ceiling — grows live with `value.length` in between. */
  minSlots?: number
  maxSlots?: number
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const slotCount = Math.max(minSlots, Math.min(maxSlots, value.length))
  const reduceMotion = useReducedMotion()

  return (
    <motion.div
      className="relative"
      onClick={() => inputRef.current?.focus()}
      animate={invalid && !reduceMotion ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }}
      transition={{ duration: 0.3 }}
    >
```

- [ ] **Step 3: Animate each digit popping in**

Find:

```tsx
      <div className="flex gap-1" aria-hidden="true">
        {Array.from({ length: slotCount }).map((_, i) => {
          const digit = value[i]
          const isActive = !disabled && i === value.length
          return (
            <div
              key={i}
              className={`flex h-12 min-w-0 flex-1 items-center justify-center rounded-[min(var(--radius-md),10px)] border font-mono text-lg font-semibold tabular-nums transition-colors ${
                invalid
                  ? 'border-destructive/50'
                  : isActive
                    ? 'border-brand ring-3 ring-brand/25'
                    : 'border-input'
              } ${digit ? 'text-foreground' : 'text-muted-foreground/40'} bg-background`}
            >
              {digit ?? (isActive ? <span className="status-breathe h-4 w-px bg-brand" /> : '·')}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

Replace with (note the closing tag changes from `</div>` to `</motion.div>` to match Step 2's opening tag):

```tsx
      <div className="flex gap-1" aria-hidden="true">
        {Array.from({ length: slotCount }).map((_, i) => {
          const digit = value[i]
          const isActive = !disabled && i === value.length
          return (
            <div
              key={i}
              className={`flex h-12 min-w-0 flex-1 items-center justify-center rounded-[min(var(--radius-md),10px)] border font-mono text-lg font-semibold tabular-nums transition-colors ${
                invalid
                  ? 'border-destructive/50'
                  : isActive
                    ? 'border-brand ring-3 ring-brand/25'
                    : 'border-input'
              } ${digit ? 'text-foreground' : 'text-muted-foreground/40'} bg-background`}
            >
              <AnimatePresence mode="popLayout" initial={false}>
                {digit ? (
                  <motion.span
                    key={`${i}-${digit}`}
                    initial={reduceMotion ? false : { opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.12 }}
                  >
                    {digit}
                  </motion.span>
                ) : isActive ? (
                  <span key="caret" className="status-breathe h-4 w-px bg-brand" />
                ) : (
                  <span key="empty">·</span>
                )}
              </AnimatePresence>
            </div>
          )
        })}
      </div>
    </motion.div>
  )
}
```

(The active slot's blinking caret keeps its existing `status-breathe` class exactly as it was — that's an existing, already-approved pattern for "this control is actively waiting for input," not a new decorative loop, so it's out of scope for the "no pulsing" constraint here.)

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit -p tsconfig.json
npx eslint components/admin/otp-slots.tsx
```

Manually, on `/goToAdminAuth`'s code step (or any TOTP entry in Settings): type digits and confirm each one pops in with a small scale animation. Trigger an invalid code (type a wrong 6-digit code fully so it auto-submits and fails) and confirm the whole row shakes once.

- [ ] **Step 5: Commit**

```bash
git add components/admin/otp-slots.tsx
git commit -m "feat(admin auth): animate OTP digit entry and invalid-code shake"
```

---

### Task 6: Welcome overlay component

**Files:**
- Create: `components/admin/welcome-overlay.tsx`

**Interfaces:**
- Consumes: `motion.div`, `useReducedMotion` from `motion/react` (Task 1); `CircleNotch` from `@phosphor-icons/react` (already a project dependency, used elsewhere in this codebase for spinners).
- Produces: `export function WelcomeOverlay({ name }: { name: string })` — a single required `name` prop (the greeting name, already resolved by the caller). No internal data fetching, no internal show/hide logic — the caller (Task 7) owns visibility and unmount timing entirely; this component only renders its own entrance/exit animation.

- [ ] **Step 1: Create the file**

```tsx
'use client'

/**
 * components/admin/welcome-overlay.tsx — full-screen post-login greeting.
 *
 * Rendered by app/admin/page.tsx inside an <AnimatePresence>, gated on the
 * ?welcome=1 redirect param both sign-in paths (typed code, magic link) now
 * carry. This component owns only its own entrance/exit animation — the
 * caller decides when it mounts and unmounts (tied to real data loading,
 * not a fixed timer; see app/admin/page.tsx).
 */

import { motion, useReducedMotion } from 'motion/react'
import { CircleNotch } from '@phosphor-icons/react'

function timeOfDayGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function WelcomeOverlay({ name }: { name: string }) {
  const reduceMotion = useReducedMotion()

  return (
    <motion.div
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 1.02 }}
      transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-background text-foreground"
    >
      <p className="text-2xl font-semibold tracking-tight">
        {timeOfDayGreeting()}, {name}
      </p>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CircleNotch className="size-4 animate-spin" />
        Loading up your console — one moment.
      </p>
    </motion.div>
  )
}
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit -p tsconfig.json
npx eslint components/admin/welcome-overlay.tsx
```

No manual browser check yet — this component isn't rendered from anywhere until Task 7 wires it in.

- [ ] **Step 3: Commit**

```bash
git add components/admin/welcome-overlay.tsx
git commit -m "feat(admin): add the WelcomeOverlay component"
```

---

### Task 7: Wire the welcome trigger through both sign-in paths

**Files:**
- Modify: `app/goToAdminAuth/page.tsx` (the `verifyCode` success redirect)
- Modify: `app/api/auth/callback/route.ts` (the magic-link success redirect)
- Modify: `app/admin/page.tsx` (reads `?welcome=1`, owns timing, renders `<WelcomeOverlay>`)

**Interfaces:**
- Consumes: `WelcomeOverlay` from `components/admin/welcome-overlay.tsx` (Task 6); `AnimatePresence` from `motion/react` (Task 1).

- [ ] **Step 1: Typed-code success path**

In `app/goToAdminAuth/page.tsx`, find (inside `verifyCode`):

```tsx
      window.location.replace('/admin')
```

Change to:

```tsx
      window.location.replace('/admin?welcome=1')
```

- [ ] **Step 2: Magic-link success path**

In `app/api/auth/callback/route.ts`, find:

```tsx
    const res = NextResponse.redirect(new URL('/admin', publicBaseUrl(url.origin)))
```

Change to:

```tsx
    const res = NextResponse.redirect(new URL('/admin?welcome=1', publicBaseUrl(url.origin)))
```

- [ ] **Step 3: Add the trigger state and timing effect to `app/admin/page.tsx`**

Add the import alongside the other component imports (find `import { SettingsPanel } from '@/components/admin/settings-panel'` and add after it):

```tsx
import { WelcomeOverlay } from '@/components/admin/welcome-overlay'
```

Add `AnimatePresence` to the imports — find the existing React import line:

```tsx
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
```

Add right after it:

```tsx
import { AnimatePresence } from 'motion/react'
```

Add a `WELCOME_MIN_MS` constant near the file's other top-level constants (find `const IDLE_TIMEOUT_MS = 15 * 60 * 1000` and add nearby):

```tsx
// Floor time the post-login welcome overlay stays up, so it never flashes
// instantly on a fast connection even if the first data fetch is quick.
const WELCOME_MIN_MS = 800
```

Add the state and effects right after the existing `const [loading, setLoading] = useState(true)` declaration:

```tsx
  // Post-login welcome overlay — shown once, only right after a fresh sign-in
  // (both the typed-code and magic-link paths redirect here with ?welcome=1).
  // A plain refresh of an already-active session has no ?welcome= param, so
  // it skips straight to the dashboard.
  const [showWelcome, setShowWelcome] = useState(false)
  const welcomeShownAtRef = useRef<number | null>(null)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('welcome') === '1') {
      setShowWelcome(true)
      welcomeShownAtRef.current = Date.now()
      window.history.replaceState({}, '', '/admin')
    }
  }, [])
  // Stays up until the real first data load finishes, with a minimum floor
  // so it's never just a flash on a fast connection.
  useEffect(() => {
    if (!showWelcome || loading) return
    const elapsed = Date.now() - (welcomeShownAtRef.current ?? Date.now())
    const remaining = Math.max(0, WELCOME_MIN_MS - elapsed)
    const t = setTimeout(() => setShowWelcome(false), remaining)
    return () => clearTimeout(t)
  }, [showWelcome, loading])
```

- [ ] **Step 4: Render the overlay**

Find, in the "Dashboard" return block:

```tsx
      {/* Fixed film grain — one paint layer, never intercepts input (see .admin-grain). */}
      <div aria-hidden className="admin-grain" />
      {/* shadcn Sonner toasts — follows the console theme, bottom-right like the old stack. */}
      <Toaster theme={theme} position="bottom-right" richColors />
```

Add right after the `<Toaster>` line:

```tsx
      <AnimatePresence>
        {showWelcome && (
          <WelcomeOverlay name={me?.displayName || me?.email?.split('@')[0] || 'there'} />
        )}
      </AnimatePresence>
```

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit -p tsconfig.json
npx eslint app/admin/page.tsx app/goToAdminAuth/page.tsx app/api/auth/callback/route.ts
```

Manually (no need for a real login — the trigger is just a URL param): with `npm run dev` running and an existing valid admin session cookie already in the browser (from earlier work in this project, the Chrome extension's session against `localhost:3000` may not have one — if not, this can be checked once against `https://tega-transit-api.onrender.com/admin?welcome=1` directly, since that session is already authenticated), navigate to `/admin?welcome=1` and confirm:
- The welcome overlay appears with the correct time-of-day greeting and a name.
- The URL immediately becomes `/admin` (no `?welcome=1` lingering).
- The overlay animates away once data loads (at least 800ms, even if the fetch is instant).
- Reloading `/admin` afterward (no `?welcome=1`) shows the dashboard directly, no overlay.

- [ ] **Step 6: Commit**

```bash
git add app/goToAdminAuth/page.tsx app/api/auth/callback/route.ts app/admin/page.tsx
git commit -m "feat(admin): wire the post-login welcome overlay through both sign-in paths"
```

---

## Final check (after all 7 tasks)

- [ ] Run the full verification sweep once more across every touched file:

```bash
npx tsc --noEmit -p tsconfig.json
npx eslint app/goToAdminAuth/page.tsx app/admin/page.tsx app/api/auth/callback/route.ts components/admin/otp-slots.tsx components/admin/welcome-overlay.tsx
```

- [ ] Manually re-walk the whole flow once end-to-end in the browser: load `/goToAdminAuth` fresh (idle entrance plays), focus the email field (entrance stops replaying on subsequent renders), submit to reach the code step (step transition animates), type/paste a code (digit pop-in; an invalid code shakes), and confirm `?welcome=1` on `/admin` shows the overlay and clears itself.
- [ ] Confirm `prefers-reduced-motion: reduce` (Chrome DevTools → Rendering tab → "Emulate CSS media feature prefers-reduced-motion") skips the idle stagger, focus scale, and digit pop/shake scaling, while the step transition, error banners, and welcome overlay still function (opacity-only).
