'use client'

import { motion } from 'framer-motion'
import { MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ConfidenceLevel } from '@/lib/types'

interface ConfidenceIndicatorProps {
  level: ConfidenceLevel
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
}

const confidenceConfig = {
  high: {
    color: 'bg-confidence-high',
    textColor: 'text-confidence-high',
    label: 'High confidence',
    bars: 3,
  },
  medium: {
    color: 'bg-confidence-medium',
    textColor: 'text-confidence-medium',
    label: 'Medium confidence',
    bars: 2,
  },
  low: {
    color: 'bg-confidence-low',
    textColor: 'text-confidence-low',
    label: 'Low confidence',
    bars: 1,
  },
}

export function ConfidenceIndicator({ level, size = 'md', showLabel = false }: ConfidenceIndicatorProps) {
  const config = confidenceConfig[level]
  const barHeights = size === 'sm' ? ['h-2', 'h-3', 'h-4'] : size === 'lg' ? ['h-4', 'h-6', 'h-8'] : ['h-3', 'h-4', 'h-5']
  const barWidth = size === 'sm' ? 'w-1' : size === 'lg' ? 'w-2' : 'w-1.5'
  const gap = size === 'sm' ? 'gap-0.5' : 'gap-1'

  return (
    <div className="flex items-center gap-2">
      <div className={cn('flex items-end', gap)}>
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            initial={{ scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{ delay: i * 0.1, duration: 0.2 }}
            className={cn(
              barWidth,
              barHeights[i],
              'rounded-full origin-bottom',
              i < config.bars ? config.color : 'bg-muted'
            )}
          />
        ))}
      </div>
      {showLabel && (
        <span className={cn('text-xs', config.textColor)}>{config.label}</span>
      )}
    </div>
  )
}

interface RoutePillProps {
  routeName: string
  color: string
  size?: 'sm' | 'md' | 'lg'
}

export function RoutePill({ routeName, color, size = 'md' }: RoutePillProps) {
  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-3 py-1',
    lg: 'text-base px-4 py-1.5',
  }

  return (
    <motion.div
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      className={cn(
        'inline-flex items-center font-semibold rounded-full',
        sizeClasses[size]
      )}
      style={{ backgroundColor: color, color: '#1a1a2e' }}
    >
      {routeName}
    </motion.div>
  )
}

interface DestinationLabelProps {
  destination: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

export function DestinationLabel({ destination, size = 'lg', className }: DestinationLabelProps) {
  const sizeClasses = {
    sm: 'text-base font-medium',
    md: 'text-lg font-semibold',
    lg: 'text-xl font-bold',
    xl: 'text-2xl font-bold',
  }

  return (
    <h3 className={cn('text-foreground tracking-tight text-balance', sizeClasses[size], className)}>
      {destination}
    </h3>
  )
}

interface ETADisplayProps {
  label: string
  confidence: ConfidenceLevel
  size?: 'sm' | 'md' | 'lg'
}

export function ETADisplay({ label, confidence, size = 'lg' }: ETADisplayProps) {
  const config = confidenceConfig[confidence]
  const sizeClasses = {
    sm: 'text-lg font-bold',
    md: 'text-2xl font-bold',
    lg: 'text-3xl font-bold',
  }

  const isArriving = label.toLowerCase().includes('arriving')

  return (
    <motion.div
      key={label}
      initial={{ opacity: 0, y: -5 }}
      animate={{ opacity: 1, y: 0 }}
      className="text-right"
    >
      <p className={cn(
        sizeClasses[size],
        'tracking-tight',
        isArriving ? 'text-confidence-high' : config.textColor
      )}>
        {label}
      </p>
    </motion.div>
  )
}

interface WalkingDistanceProps {
  minutes: number
  meters: number
  compact?: boolean
}

export function WalkingDistance({ minutes, meters, compact = false }: WalkingDistanceProps) {
  if (compact) {
    return (
      <span className="text-muted-foreground text-sm">
        {minutes} min walk
      </span>
    )
  }

  return (
    <div className="flex items-center gap-1.5 text-muted-foreground">
      <MapPin className="h-3.5 w-3.5" />
      <span className="text-sm">{minutes} min walk</span>
      <span className="text-xs">({meters}m)</span>
    </div>
  )
}
