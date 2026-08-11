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
