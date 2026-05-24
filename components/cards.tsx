'use client'

import { motion } from 'framer-motion'
import { ChevronRight, MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Arrival, BusStop } from '@/lib/types'
import { RoutePill, DestinationLabel, ETADisplay, ConfidenceIndicator, WalkingDistance } from './transit-ui'

interface ETACardProps {
  arrival: Arrival
  onPress?: () => void
  compact?: boolean
}

export function ETACard({ arrival, onPress, compact = false }: ETACardProps) {
  const { bus, stop, route, eta } = arrival

  return (
    <motion.button
      onClick={onPress}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'w-full text-left bg-card hover:bg-accent/50 rounded-2xl transition-colors',
        compact ? 'p-3' : 'p-4'
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <DestinationLabel 
            destination={bus.destination} 
            size={compact ? 'md' : 'lg'} 
          />
          <div className="flex items-center gap-2 mt-1.5">
            <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-sm text-muted-foreground truncate">{stop.name}</span>
          </div>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          <ETADisplay 
            label={eta.label} 
            confidence={eta.confidence} 
            size={compact ? 'sm' : 'md'} 
          />
          <ConfidenceIndicator level={eta.confidence} size="sm" />
        </div>
      </div>
      
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50">
        <div className="flex items-center gap-2">
          <RoutePill routeName={route.name} color={route.color} size="sm" />
          <WalkingDistance 
            minutes={stop.walkingDistance} 
            meters={stop.walkingMeters} 
            compact 
          />
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </div>
    </motion.button>
  )
}

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
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.98 }}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full text-left bg-card hover:bg-accent/50 rounded-xl p-4 transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-foreground truncate">{stop.name}</h4>
          <WalkingDistance 
            minutes={stop.walkingDistance} 
            meters={stop.walkingMeters} 
          />
        </div>
        {nextArrival && (
          <div className="shrink-0 text-right">
            <p className="text-sm font-medium text-primary">
              {nextArrival.eta.label}
            </p>
            <p className="text-xs text-muted-foreground">
              Route {nextArrival.route.name}
            </p>
          </div>
        )}
      </div>
    </motion.button>
  )
}

interface NearbyStopRowProps {
  stop: BusStop
  onPress?: () => void
}

export function NearbyStopRow({ stop, onPress }: NearbyStopRowProps) {
  return (
    <motion.button
      onClick={onPress}
      whileHover={{ x: 4 }}
      whileTap={{ scale: 0.98 }}
      className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-accent/30 transition-colors"
    >
      <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
        <MapPin className="h-5 w-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0 text-left">
        <p className="font-medium text-foreground truncate">{stop.name}</p>
        <p className="text-sm text-muted-foreground">{stop.walkingDistance} min walk</p>
      </div>
      <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
    </motion.button>
  )
}

interface RouteCardProps {
  routeName: string
  color: string
  destinations: string[]
  onPress?: () => void
  expanded?: boolean
}

export function RouteCard({ routeName, color, destinations, onPress, expanded = false }: RouteCardProps) {
  return (
    <motion.button
      onClick={onPress}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.98 }}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full text-left bg-card hover:bg-accent/50 rounded-xl p-4 transition-colors"
    >
      <div className="flex items-center gap-3">
        <div 
          className="h-10 w-10 rounded-lg flex items-center justify-center font-bold text-lg"
          style={{ backgroundColor: color, color: '#1a1a2e' }}
        >
          {routeName}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-foreground">Route {routeName}</p>
          <p className="text-sm text-muted-foreground truncate">
            {destinations.join(' → ')}
          </p>
        </div>
        <ChevronRight className={cn(
          'h-5 w-5 text-muted-foreground transition-transform',
          expanded && 'rotate-90'
        )} />
      </div>
    </motion.button>
  )
}
