'use client'

import { motion } from 'framer-motion'
import { Bus, MapPin, Wifi, WifiOff, RefreshCw, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Skeleton, ETACardSkeleton, NearbyStopRowSkeleton } from './skeletons'

// Loading state - calm and reassuring
interface LoadingStateProps {
  message?: string
  className?: string
}

export function LoadingState({ 
  message = 'Finding nearby buses...', 
  className 
}: LoadingStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={cn('px-4 py-8', className)}
    >
      {/* Animated bus icon */}
      <div className="flex flex-col items-center justify-center py-8">
        <motion.div
          animate={{ 
            y: [0, -8, 0],
            scale: [1, 1.05, 1],
          }}
          transition={{ 
            duration: 2, 
            repeat: Infinity,
            ease: 'easeInOut'
          }}
          className="relative"
        >
          <div className="h-16 w-16 rounded-2xl bg-primary/20 flex items-center justify-center">
            <Bus className="h-8 w-8 text-primary" />
          </div>
          <motion.div
            initial={{ scale: 1, opacity: 0.3 }}
            animate={{ scale: 1.8, opacity: 0 }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="absolute inset-0 rounded-2xl bg-primary/30"
          />
        </motion.div>
        <p className="text-muted-foreground text-sm mt-4 text-center">{message}</p>
      </div>

      {/* Skeleton content */}
      <div className="space-y-4 mt-4">
        <div className="space-y-3">
          <Skeleton className="h-5 w-32" />
          <ETACardSkeleton />
          <ETACardSkeleton />
        </div>
        <div className="space-y-3 pt-4">
          <Skeleton className="h-5 w-28" />
          <NearbyStopRowSkeleton />
          <NearbyStopRowSkeleton />
        </div>
      </div>
    </motion.div>
  )
}

// Empty state - helpful and calm
interface EmptyStateProps {
  title?: string
  message?: string
  icon?: 'bus' | 'stop' | 'route'
  className?: string
}

export function EmptyState({ 
  title = 'No buses nearby',
  message = 'Checking for nearby arrivals...',
  icon = 'bus',
  className 
}: EmptyStateProps) {
  const IconComponent = {
    bus: Bus,
    stop: MapPin,
    route: AlertCircle,
  }[icon]

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        'flex flex-col items-center justify-center py-8 px-4 text-center',
        className
      )}
    >
      <motion.div
        animate={{ 
          y: [0, -4, 0],
        }}
        transition={{ 
          duration: 3, 
          repeat: Infinity,
          ease: 'easeInOut'
        }}
        className="h-14 w-14 rounded-2xl bg-muted flex items-center justify-center mb-4"
      >
        <IconComponent className="h-7 w-7 text-muted-foreground" />
      </motion.div>
      <h3 className="font-semibold text-foreground text-lg">{title}</h3>
      <p className="text-muted-foreground text-sm mt-1 max-w-[240px]">{message}</p>
    </motion.div>
  )
}

// Refreshing indicator - subtle overlay
interface RefreshingIndicatorProps {
  isRefreshing: boolean
}

export function RefreshingIndicator({ isRefreshing }: RefreshingIndicatorProps) {
  if (!isRefreshing) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="fixed top-4 left-1/2 -translate-x-1/2 z-50"
    >
      <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-card/90 backdrop-blur-sm shadow-lg border border-border/50">
        <RefreshCw className="h-4 w-4 text-primary animate-spin" />
        <span className="text-sm text-foreground">Updating nearby buses...</span>
      </div>
    </motion.div>
  )
}

// Weak connectivity state
interface ConnectivityStateProps {
  isOnline: boolean
  isReconnecting?: boolean
  className?: string
}

export function ConnectivityState({ 
  isOnline, 
  isReconnecting = false,
  className 
}: ConnectivityStateProps) {
  if (isOnline && !isReconnecting) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className={cn(
        'fixed top-4 left-4 right-4 z-50',
        className
      )}
    >
      <div className={cn(
        'flex items-center gap-3 px-4 py-3 rounded-xl backdrop-blur-sm shadow-lg border',
        isOnline 
          ? 'bg-card/90 border-border/50'
          : 'bg-confidence-low/20 border-confidence-low/30'
      )}>
        {isReconnecting ? (
          <>
            <Wifi className="h-5 w-5 text-primary animate-pulse" />
            <div>
              <p className="text-sm font-medium text-foreground">Reconnecting to transit updates...</p>
              <p className="text-xs text-muted-foreground">Using cached nearby stops</p>
            </div>
          </>
        ) : (
          <>
            <WifiOff className="h-5 w-5 text-confidence-low" />
            <div>
              <p className="text-sm font-medium text-foreground">Offline mode</p>
              <p className="text-xs text-muted-foreground">Showing last known arrivals</p>
            </div>
          </>
        )}
      </div>
    </motion.div>
  )
}

// Delayed route indicator
interface DelayedIndicatorProps {
  message?: string
  className?: string
}

export function DelayedIndicator({ 
  message = 'This route is experiencing delays',
  className 
}: DelayedIndicatorProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-lg bg-confidence-low/20 border border-confidence-low/30',
        className
      )}
    >
      <AlertCircle className="h-4 w-4 text-confidence-low shrink-0" />
      <p className="text-sm text-confidence-low">{message}</p>
    </motion.div>
  )
}

// Splash screen
export function SplashScreen() {
  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-background flex flex-col items-center justify-center"
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="text-center"
      >
        <motion.div
          animate={{ 
            y: [0, -8, 0],
          }}
          transition={{ 
            duration: 2, 
            repeat: Infinity,
            ease: 'easeInOut'
          }}
          className="h-20 w-20 rounded-2xl bg-primary mx-auto flex items-center justify-center mb-4"
        >
          <Bus className="h-10 w-10 text-primary-foreground" />
        </motion.div>
        <h1 className="text-3xl font-bold text-foreground">Tega</h1>
        <p className="text-muted-foreground mt-1">Bus tracking for Kigali</p>
      </motion.div>

      {/* Loading dots */}
      <div className="flex items-center gap-1.5 mt-8">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0.3, scale: 0.8 }}
            animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1, 0.8] }}
            transition={{ 
              duration: 1.2, 
              repeat: Infinity,
              delay: i * 0.2,
            }}
            className="h-2 w-2 rounded-full bg-primary"
          />
        ))}
      </div>
    </motion.div>
  )
}
