'use client'

import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { Skeleton, ETACardSkeleton, NearbyStopRowSkeleton } from './skeletons'
import {
  Bus,
  MapPin,
  WifiHigh,
  WifiSlash,
  ArrowClockwise,
  Warning,
} from '@phosphor-icons/react'

// ── Loading State ────────────────────────────────────────────
interface LoadingStateProps {
  message?: string
  className?: string
}

export function LoadingState({
  message = 'Finding nearby buses…',
  className,
}: LoadingStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={cn('px-4 py-6 bg-background', className)}
    >
      <div className="flex flex-col items-center justify-center py-8">
        <motion.div
          animate={{ y: [0, -7, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          className="relative"
        >
          {/* Icon card */}
          <div className="h-16 w-16 rounded-2xl bg-muted border border-border flex items-center justify-center">
            <Bus size={32} weight="fill" className="text-primary" />
          </div>
        </motion.div>
        <p className="text-foreground text-sm font-semibold mt-4">{message}</p>
        <p className="text-muted-foreground text-xs mt-0.5">Using real-time data</p>
      </div>

      <div className="space-y-3 mt-2">
        <div className="space-y-2.5">
          <Skeleton className="h-4 w-28 rounded-md" />
          <ETACardSkeleton />
          <ETACardSkeleton />
        </div>
        <div className="space-y-2.5 pt-2">
          <Skeleton className="h-4 w-24 rounded-md" />
          <NearbyStopRowSkeleton />
          <NearbyStopRowSkeleton />
        </div>
      </div>
    </motion.div>
  )
}

// ── Empty State ──────────────────────────────────────────────
interface EmptyStateProps {
  title?: string
  message?: string
  icon?: 'bus' | 'stop' | 'route'
  className?: string
}

export function EmptyState({
  title = 'No buses nearby',
  message = 'Checking for nearby arrivals…',
  icon = 'bus',
  className,
}: EmptyStateProps) {
  const icons = { bus: Bus, stop: MapPin, route: Warning }
  const Icon = icons[icon]

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn('flex flex-col items-center justify-center py-10 px-4 text-center', className)}
    >
      <motion.div
        animate={{ y: [0, -4, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        className="h-14 w-14 rounded-2xl bg-muted border border-border flex items-center justify-center mb-4"
      >
        <Icon size={26} weight="duotone" className="text-muted-foreground" />
      </motion.div>
      <h3 className="font-bold text-foreground text-lg">{title}</h3>
      <p className="text-muted-foreground text-sm font-medium mt-1 max-w-[200px] leading-relaxed">{message}</p>
    </motion.div>
  )
}

// ── Refreshing Indicator ─────────────────────────────────────
interface RefreshingIndicatorProps {
  isRefreshing: boolean
}

export function RefreshingIndicator({ isRefreshing }: RefreshingIndicatorProps) {
  if (!isRefreshing) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: -16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      className="fixed top-4 left-1/2 -translate-x-1/2 z-50"
    >
      {/* Uber-style: white pill, black text, solid border */}
      <div className="flex items-center gap-2.5 px-4 py-2 rounded-full bg-white border-2 border-black shadow-[0_4px_16px_rgba(0,0,0,0.16)]">
        <ArrowClockwise size={14} weight="bold" className="text-black animate-spin" />
        <span className="text-xs font-bold text-black">Updating…</span>
      </div>
    </motion.div>
  )
}

// ── Connectivity State ───────────────────────────────────────
interface ConnectivityStateProps {
  isOnline: boolean
  isReconnecting?: boolean
  className?: string
}

export function ConnectivityState({
  isOnline,
  isReconnecting = false,
  className,
}: ConnectivityStateProps) {
  if (isOnline && !isReconnecting) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: -16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      className={cn('fixed top-4 left-4 right-4 z-50', className)}
    >
      <div className={cn(
        'flex items-center gap-3 px-4 py-3 rounded-xl border-2 bg-white shadow-[0_4px_16px_rgba(0,0,0,0.16)]',
        isReconnecting ? 'border-[#d97706]' : 'border-[#dc2626]'
      )}>
        {isReconnecting ? (
          <>
            <WifiHigh size={20} weight="fill" className="text-[#d97706] shrink-0" />
            <div>
              <p className="text-sm font-bold text-foreground">Reconnecting…</p>
              <p className="text-xs text-muted-foreground font-medium">Using cached nearby stops</p>
            </div>
          </>
        ) : (
          <>
            <WifiSlash size={20} weight="fill" className="text-[#dc2626] shrink-0" />
            <div>
              <p className="text-sm font-bold text-foreground">No connection</p>
              <p className="text-xs text-muted-foreground font-medium">Showing last known arrivals</p>
            </div>
          </>
        )}
      </div>
    </motion.div>
  )
}

// ── Delayed Indicator ────────────────────────────────────────
interface DelayedIndicatorProps {
  message?: string
  className?: string
}

export function DelayedIndicator({
  message = 'This route is experiencing delays',
  className,
}: DelayedIndicatorProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        'flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white border border-[#dc2626]/40',
        className
      )}
    >
      <Warning size={16} weight="fill" className="text-confidence-low shrink-0" />
      <p className="text-sm font-bold text-confidence-low">{message}</p>
    </motion.div>
  )
}

// ── Splash Screen — THE BRAND MOMENT ────────────────────────
// Must be unmistakable from far away. White bg, massive black wordmark.
export function SplashScreen() {
  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      className="fixed inset-0 z-[100] bg-background flex flex-col items-center justify-center"
    >
      {/* Brand block */}
      <motion.div
        initial={{ scale: 0.88, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="text-center"
      >
        {/* Teal bus icon — bouncing */}
        <motion.div
          animate={{ y: [0, -8, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          className="h-24 w-24 rounded-3xl bg-primary mx-auto flex items-center justify-center mb-6 shadow-[0_8px_32px_rgba(0,168,150,0.35)]"
        >
          <Bus size={48} weight="fill" className="text-white" />
        </motion.div>

        {/* Wordmark — must be readable from meters away */}
        <h1
          className="text-foreground leading-none"
          style={{
            fontSize: 'clamp(3rem, 10vw, 5rem)',
            fontWeight: 900,
            letterSpacing: '-0.04em',
          }}
        >
          Tega
        </h1>

        {/* Tagline */}
        <p className="text-muted-foreground font-semibold text-base mt-2 tracking-wide">
          Bus tracking · Kigali
        </p>
      </motion.div>

      {/* Teal progress bar at bottom */}
      <motion.div
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 1.5, ease: 'easeInOut' }}
        className="absolute bottom-0 left-0 right-0 h-1 bg-primary origin-left"
      />
    </motion.div>
  )
}
