'use client'

import { useRef, useEffect, useState, useCallback, ReactNode } from 'react'
import { motion, useMotionValue, useTransform, animate, PanInfo } from 'framer-motion'
import { cn } from '@/lib/utils'

interface BottomSheetProps {
  children: ReactNode
  defaultHeight?: number // percentage of screen
  minHeight?: number // percentage
  maxHeight?: number // percentage
  onHeightChange?: (height: number) => void
  className?: string
}

const SNAP_POINTS = [0.3, 0.45, 0.85] // 30%, 45%, 85% of screen

export function BottomSheet({
  children,
  defaultHeight = 45,
  minHeight = 30,
  maxHeight = 85,
  onHeightChange,
  className,
}: BottomSheetProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [screenHeight, setScreenHeight] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  
  // Motion values
  const y = useMotionValue(0)
  const sheetHeight = useMotionValue(defaultHeight)
  
  // Calculate the actual pixel values
  const minY = useTransform(sheetHeight, (h) => screenHeight * (1 - maxHeight / 100))
  const maxY = useTransform(sheetHeight, (h) => screenHeight * (1 - minHeight / 100))

  useEffect(() => {
    const updateHeight = () => {
      setScreenHeight(window.innerHeight)
    }
    updateHeight()
    window.addEventListener('resize', updateHeight)
    return () => window.removeEventListener('resize', updateHeight)
  }, [])

  useEffect(() => {
    // Set initial position
    const initialY = screenHeight * (1 - defaultHeight / 100)
    y.set(initialY)
  }, [screenHeight, defaultHeight, y])

  const snapToNearestPoint = useCallback((currentY: number) => {
    const currentPercent = 1 - currentY / screenHeight
    
    // Find nearest snap point
    let nearestSnap = SNAP_POINTS[0]
    let minDiff = Math.abs(currentPercent - SNAP_POINTS[0])
    
    SNAP_POINTS.forEach((snap) => {
      const diff = Math.abs(currentPercent - snap)
      if (diff < minDiff) {
        minDiff = diff
        nearestSnap = snap
      }
    })

    const targetY = screenHeight * (1 - nearestSnap)
    animate(y, targetY, {
      type: 'spring',
      stiffness: 400,
      damping: 40,
    })
    
    onHeightChange?.(nearestSnap * 100)
  }, [screenHeight, y, onHeightChange])

  const handleDragEnd = useCallback((_: unknown, info: PanInfo) => {
    setIsDragging(false)
    const currentY = y.get()
    const velocity = info.velocity.y
    
    // If fast swipe, determine direction
    if (Math.abs(velocity) > 500) {
      const targetSnap = velocity < 0 
        ? SNAP_POINTS[SNAP_POINTS.length - 1] // swipe up = max height
        : SNAP_POINTS[0] // swipe down = min height
      
      const targetY = screenHeight * (1 - targetSnap)
      animate(y, targetY, {
        type: 'spring',
        stiffness: 400,
        damping: 40,
      })
      onHeightChange?.(targetSnap * 100)
    } else {
      snapToNearestPoint(currentY)
    }
  }, [screenHeight, y, snapToNearestPoint, onHeightChange])

  const handleDrag = useCallback((_: unknown, info: PanInfo) => {
    const newY = y.get() + info.delta.y
    const clampedY = Math.max(
      screenHeight * (1 - maxHeight / 100),
      Math.min(screenHeight * (1 - minHeight / 100), newY)
    )
    y.set(clampedY)
  }, [screenHeight, y, minHeight, maxHeight])

  if (screenHeight === 0) return null

  return (
    <motion.div
      ref={containerRef}
      style={{ y, top: 0, bottom: 'auto', height: `${maxHeight}vh` }}
      className={cn(
        'fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border/50 shadow-[0_-8px_32px_rgba(0,0,0,0.12)]',
        'rounded-t-modal',
        'touch-none flex flex-col',
        className
      )}
    >
      {/* Drag handle */}
      <motion.div
        onPanStart={() => setIsDragging(true)}
        onPan={handleDrag}
        onPanEnd={handleDragEnd}
        className="absolute top-0 left-0 right-0 h-8 flex items-center justify-center cursor-grab active:cursor-grabbing"
      >
        <div className={cn(
          'w-12 h-1.5 rounded-full transition-colors',
          isDragging ? 'bg-black/60' : 'bg-black/20'
        )} />
      </motion.div>

      {/* Content */}
      <div className="h-full pt-6 overflow-hidden">
        <div className="h-full overflow-y-auto custom-scrollbar overscroll-contain">
          {children}
        </div>
      </div>
    </motion.div>
  )
}

// Pull to refresh component
interface PullToRefreshProps {
  onRefresh: () => Promise<void>
  children: ReactNode
  isRefreshing?: boolean
}

export function PullToRefresh({ onRefresh, children, isRefreshing = false }: PullToRefreshProps) {
  const [pulling, setPulling] = useState(false)
  const pullY = useMotionValue(0)
  const pullProgress = useTransform(pullY, [0, 80], [0, 1])

  const handlePan = useCallback((_: unknown, info: PanInfo) => {
    if (info.delta.y > 0) {
      setPulling(true)
      pullY.set(Math.min(info.offset.y, 100))
    }
  }, [pullY])

  const handlePanEnd = useCallback(async () => {
    const currentPull = pullY.get()
    if (currentPull > 60) {
      await onRefresh()
    }
    animate(pullY, 0, { type: 'spring', stiffness: 400, damping: 40 })
    setPulling(false)
  }, [pullY, onRefresh])

  return (
    <div className="relative">
      {/* Refresh indicator */}
      <motion.div
        style={{ 
          opacity: pullProgress,
          y: useTransform(pullY, [0, 100], [-40, 0])
        }}
        className="absolute top-0 left-0 right-0 flex justify-center py-4"
      >
        <motion.div
          animate={{ rotate: isRefreshing ? 360 : 0 }}
          transition={{ duration: 1, repeat: isRefreshing ? Infinity : 0, ease: 'linear' }}
          className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full"
        />
      </motion.div>

      <motion.div
        style={{ y: pulling || isRefreshing ? pullY : 0 }}
        onPan={handlePan}
        onPanEnd={handlePanEnd}
      >
        {children}
      </motion.div>
    </div>
  )
}
