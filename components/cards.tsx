'use client'

import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { Arrival, BusStop } from '@/lib/types'
import { RoutePill, DestinationLabel, ETADisplay, ConfidenceIndicator, WalkingDistance } from './transit-ui'
import { MapPin, CaretRight, ArrowRight } from '@phosphor-icons/react'

// ── ETACard ──────────────────────────────────────────────────
interface ETACardProps {
  arrival: Arrival
  onPress?: () => void
  compact?: boolean
  desktop?: boolean
}

export function ETACard({ arrival, onPress, compact = false, desktop = false }: ETACardProps) {
  const { bus, stop, route, eta } = arrival

  return (
    <motion.button
      onClick={onPress}
      whileTap={{ scale: 0.98 }}
      whileHover={{ scale: 1.015, y: -2 }}
      className={cn(
        // Card background, solid 1px border (like Uber cards)
        'w-full text-left bg-card/90 backdrop-blur-md rounded-surface border border-border/60',
        'transition-all duration-300 focus:outline-none',
        'focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
        'shadow-sm hover:shadow-[0_8px_24px_rgba(0,0,0,0.12)] hover:border-primary/30',
        desktop ? 'eta-card-desktop' : '',
        compact ? 'p-3.5' : 'p-5'
      )}
      role="listitem"
      aria-label={`${bus.destination} via route ${route.name}, arriving ${eta.label}`}
    >
      {/* Top: destination + ETA */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <DestinationLabel
            destination={bus.destination}
            size={compact ? 'lg' : 'xl'}
          />
          {/* Stop name */}
          <div className="flex items-center gap-2 mt-1.5 opacity-80">
            <MapPin size={14} weight="fill" className="text-muted-foreground shrink-0" />
            <span className="text-sm text-muted-foreground font-medium truncate">{stop.name}</span>
          </div>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1.5 bg-background/50 rounded-surface px-3 py-2 border border-border/40">
          <ETADisplay
            label={eta.label}
            confidence={eta.confidence}
            size={compact ? 'md' : 'lg'}
          />
          <ConfidenceIndicator level={eta.confidence} size="sm" showLabel />
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-border mt-3 pt-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RoutePill routeName={route.name} color={route.color} size="sm" />
          <WalkingDistance
            minutes={stop.walkingDistance}
            meters={stop.walkingMeters}
            compact
          />
        </div>
        <CaretRight size={14} weight="bold" className="text-[#767676]" />
      </div>
    </motion.button>
  )
}

// ── StopCard ─────────────────────────────────────────────────
interface StopCardProps {
  stop: BusStop
  arrivals?: Arrival[]
  onPress?: () => void
}

export function StopCard({ stop, arrivals = [], onPress }: StopCardProps) {
  const nextArrival = arrivals[0]

  return (
    <motion.button
      onClick={onPress}
      animate={{ opacity: 1, y: 0 }}
      whileTap={{ scale: 0.98 }}
      whileHover={{ scale: 1.015, y: -2 }}
      className="w-full text-left bg-card/90 backdrop-blur-md rounded-surface p-4 md:p-5 border border-border/60 transition-all duration-300 hover:shadow-[0_8px_24px_rgba(0,0,0,0.12)] hover:border-primary/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h4 className="font-bold text-foreground truncate">{stop.name}</h4>
          <WalkingDistance
            minutes={stop.walkingDistance}
            meters={stop.walkingMeters}
          />
        </div>
        {nextArrival && (
          <div className="shrink-0 text-right">
            <p className="text-base font-black text-foreground leading-none">{nextArrival.eta.label}</p>
            <p className="text-xs text-muted-foreground font-medium mt-0.5">Route {nextArrival.route.name}</p>
          </div>
        )}
      </div>
    </motion.button>
  )
}

// ── NearbyStopRow ────────────────────────────────────────────
interface NearbyStopRowProps {
  stop: BusStop
  onPress?: () => void
}

export function NearbyStopRow({ stop, onPress }: NearbyStopRowProps) {
  return (
    <motion.button
      onClick={onPress}
      whileTap={{ scale: 0.98 }}
      whileHover={{ scale: 1.015 }}
      className="w-full flex items-center gap-3.5 px-3.5 py-3 rounded-surface hover:bg-muted/40 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {/* Stop icon — solid teal square (transit stop aesthetic) */}
      <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center shrink-0">
        <MapPin size={17} weight="fill" className="text-white" />
      </div>
      <div className="flex-1 min-w-0 text-left">
        <p className="text-sm font-bold text-foreground truncate">{stop.name}</p>
        <p className="text-xs text-muted-foreground font-medium">{stop.walkingDistance} min · {stop.walkingMeters}m</p>
      </div>
      <CaretRight size={14} weight="bold" className="text-[#767676] shrink-0" />
    </motion.button>
  )
}

// ── RouteCard ────────────────────────────────────────────────
interface RouteCardProps {
  routeName: string
  color: string
  destinations: string[]
  onPress?: () => void
  expanded?: boolean
  desktop?: boolean
}

export function RouteCard({ routeName, color, destinations, onPress, expanded = false, desktop = false }: RouteCardProps) {
  return (
    <motion.button
      onClick={onPress}
      animate={{ opacity: 1, scale: 1 }}
      className="w-full text-left bg-card rounded-surface p-3.5 border border-border transition-shadow hover:shadow-[0_2px_12px_rgba(0,0,0,0.12)] hover:border-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
    >
      <div className="flex items-center gap-3">
        {/* Route number badge — solid color, white font, rounded (Uber pill style) */}
        <div
          className="h-10 w-10 rounded-full flex items-center justify-center font-black text-sm shrink-0 text-white"
          style={{ backgroundColor: color }}
        >
          {routeName}
        </div>

        <div className="flex-1 min-w-0">
          {desktop ? (
            <div>
              <p className="text-sm font-bold text-foreground">Route {routeName}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-xs text-muted-foreground font-medium truncate">{destinations[0]}</span>
                <ArrowRight size={10} weight="bold" className="text-[#767676] shrink-0" />
                <span className="text-xs text-muted-foreground font-medium truncate">{destinations[destinations.length - 1]}</span>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-sm font-bold text-foreground">Route {routeName}</p>
              <p className="text-xs text-muted-foreground font-medium truncate">{destinations.join(' → ')}</p>
            </div>
          )}
        </div>

        <CaretRight
          size={14}
          weight="bold"
          className={cn('text-[#767676] transition-transform shrink-0', expanded && 'rotate-90')}
        />
      </div>
    </motion.button>
  )
}
