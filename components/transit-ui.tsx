'use client'

import { motion } from 'framer-motion'
import { MapPin, Footprints } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { ConfidenceLevel } from '@/lib/types'

// ── Confidence system ────────────────────────────────────────
const confidenceConfig = {
  high: {
    color:     'bg-confidence-high',
    textColor: 'text-confidence-high',
    label:     'On time',
    bars: 3,
  },
  medium: {
    color:     'bg-confidence-medium',
    textColor: 'text-confidence-medium',
    label:     'Approximate',
    bars: 2,
  },
  low: {
    color:     'bg-confidence-low',
    textColor: 'text-confidence-low',
    label:     'Estimated',
    bars: 1,
  },
}

// ── ConfidenceIndicator ──────────────────────────────────────
interface ConfidenceIndicatorProps {
  level: ConfidenceLevel
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
}

export function ConfidenceIndicator({ level, size = 'md', showLabel = false }: ConfidenceIndicatorProps) {
  const config = confidenceConfig[level]

  // Taller bars for better sunlight visibility
  const barHeights =
    size === 'sm'
      ? ['h-2.5', 'h-3.5', 'h-4.5']
      : size === 'lg'
      ? ['h-4', 'h-6', 'h-8']
      : ['h-3', 'h-4', 'h-5']

  const barWidth = size === 'sm' ? 'w-1' : size === 'lg' ? 'w-2' : 'w-1.5'
  const gap = size === 'sm' ? 'gap-0.5' : 'gap-1'

  return (
    <div className="flex items-center gap-2">
      <div className={cn('flex items-end', gap)} aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            initial={{ scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{ delay: i * 0.08, duration: 0.18 }}
            className={cn(
              barWidth,
              barHeights[i],
              'rounded-full origin-bottom',
              i < config.bars
                ? config.color
                : 'bg-[#e5e5e5]'   /* unfilled bar — clear on white */
            )}
          />
        ))}
      </div>
      {showLabel && (
        <span className={cn('text-xs font-semibold', config.textColor)}>
          {config.label}
        </span>
      )}
    </div>
  )
}

// ── RoutePill ────────────────────────────────────────────────
interface RoutePillProps {
  routeName: string
  color: string
  size?: 'sm' | 'md' | 'lg'
}

export function RoutePill({ routeName, color, size = 'md' }: RoutePillProps) {
  const sizeClasses = {
    sm: 'text-xs px-2.5 py-0.5 font-black',
    md: 'text-sm px-3 py-1 font-black',
    lg: 'text-base px-4 py-1.5 font-black',
  }

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full',   /* Uber radius.lg = 9999px */
        sizeClasses[size]
      )}
      style={{
        backgroundColor: color,
        color: '#ffffff',
        letterSpacing: '-0.01em',
      }}
    >
      {routeName}
    </div>
  )
}

// ── DestinationLabel ─────────────────────────────────────────
interface DestinationLabelProps {
  destination: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

export function DestinationLabel({ destination, size = 'lg', className }: DestinationLabelProps) {
  // Sizes tuned for 3-second glance readability
  const sizeClasses = {
    sm: 'text-base font-semibold',
    md: 'text-lg font-bold',
    lg: 'text-xl font-bold tracking-tight',
    xl: 'text-2xl font-black tracking-tight',
  }

  return (
    <h3 className={cn('text-foreground text-balance leading-tight', sizeClasses[size], className)}>
      {destination}
    </h3>
  )
}

// ── ETADisplay ───────────────────────────────────────────────
interface ETADisplayProps {
  label: string
  confidence: ConfidenceLevel
  size?: 'sm' | 'md' | 'lg'
}

export function ETADisplay({ label, confidence, size = 'lg' }: ETADisplayProps) {
  const config = confidenceConfig[confidence]
  const isArriving = label.toLowerCase().includes('arriving')

  // Uber-inspired large ETA typography — visible at arm's length
  const sizeClasses = {
    sm: 'text-xl font-black',
    md: 'text-3xl font-black',
    lg: 'text-4xl font-black',   /* was text-3xl font-bold — now bolder */
  }

  return (
    <motion.div
      key={label}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="text-right"
    >
      <p
        className={cn(
          sizeClasses[size],
          'leading-none tracking-tight',
          isArriving ? 'text-confidence-high' : config.textColor
        )}
      >
        {label}
      </p>
    </motion.div>
  )
}

// ── WalkingDistance ──────────────────────────────────────────
interface WalkingDistanceProps {
  minutes: number
  meters: number
  compact?: boolean
}

export function WalkingDistance({ minutes, meters, compact = false }: WalkingDistanceProps) {
  if (compact) {
    return (
      <span className="text-sm text-muted-foreground font-medium">
        {minutes} min walk
      </span>
    )
  }

  return (
    <div className="flex items-center gap-1.5 text-muted-foreground">
      <Footprints size={14} weight="duotone" className="shrink-0" />
      <span className="text-sm font-medium">{minutes} min walk</span>
      <span className="text-xs opacity-60">({meters}m)</span>
    </div>
  )
}
