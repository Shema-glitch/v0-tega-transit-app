'use client'

/**
 * components/admin/otp-slots.tsx — shared segmented one-time-code entry.
 *
 * A single real <input> (invisible, spanning the whole row) drives
 * everything — keyboard, paste, and autofill all work exactly as they would
 * on a plain input; only the visual changes to per-digit slots. Used by the
 * /goToAdminAuth login code (6, 8, or 10 digits depending on Supabase's
 * config — slotCount grows with what's typed) and every TOTP code entry in
 * the console (settings-panel.tsx, and the mid-action TOTP challenge in
 * app/admin/page.tsx), which are always exactly 6 digits since the caller
 * clamps `value` itself.
 */

import { useRef } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

/**
 * Picks the OTP code out of pasted clipboard text instead of blindly
 * concatenating every digit in it. Two cases:
 *   - The whole clipboard is just digits ("482735") — trust it if its length
 *     is actually a valid code length. This covers the common case (a
 *     password manager or SMS autofill hands over just the code).
 *   - The clipboard has other content (someone selected a whole email body,
 *     "Your code is 482735, expires in 10 min") — look for digit runs
 *     bounded by non-digit characters, and only trust it if EXACTLY ONE run
 *     is a valid code length. A phone number plus a code in the same paste
 *     is genuinely ambiguous, so we bail out rather than guess wrong; the
 *     caller's existing strip-and-truncate onChange still runs as a fallback.
 */
function extractOtpFromPaste(text: string, minSlots: number, maxSlots: number): string | null {
  const validLengths =
    minSlots === maxSlots ? [minSlots] : [6, 8, 10].filter((n) => n >= minSlots && n <= maxSlots)

  const trimmed = text.trim()
  if (/^\d+$/.test(trimmed) && validLengths.includes(trimmed.length)) {
    return trimmed
  }

  const runs = text.match(/\d+/g) ?? []
  const candidates = runs.filter((r) => validLengths.includes(r.length))
  return candidates.length === 1 ? candidates[0] : null
}

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
      <input
        ref={inputRef}
        id={id}
        inputMode="numeric"
        autoComplete="one-time-code"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => {
          const candidate = extractOtpFromPaste(e.clipboardData.getData('text'), minSlots, maxSlots)
          if (candidate) {
            e.preventDefault()
            onChange(candidate)
          }
          // No confident candidate — let the native paste through; the
          // caller's own onChange already strips non-digits and truncates.
        }}
        disabled={disabled}
        autoFocus
        aria-label="One-time code"
        className="absolute inset-0 h-full w-full cursor-default text-transparent caret-transparent outline-none selection:bg-transparent disabled:cursor-not-allowed"
      />
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
              <AnimatePresence initial={false}>
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
