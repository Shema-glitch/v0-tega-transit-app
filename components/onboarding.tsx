'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MapPin, Clock, Navigation, ChevronRight, Check, Bus, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface OnboardingProps {
  onComplete: () => void
}

interface OnboardingStep {
  id: string
  title: string
  description: string
  icon: React.ReactNode
  visual: React.ReactNode
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [isExiting, setIsExiting] = useState(false)

  const steps: OnboardingStep[] = [
    {
      id: 'welcome',
      title: 'Welcome to Tega',
      description: 'Your trusted companion for navigating Kigali\'s bus network with confidence.',
      icon: <Bus className="h-6 w-6" />,
      visual: <WelcomeVisual />,
    },
    {
      id: 'eta',
      title: 'Know When to Leave',
      description: 'See realistic arrival windows, not false countdowns. We show you honest ETAs so you can plan better.',
      icon: <Clock className="h-6 w-6" />,
      visual: <ETAVisual />,
    },
    {
      id: 'nearby',
      title: 'Find Nearby Stops',
      description: 'Discover bus stops around you with walking times. Tap any stop to see all arriving buses.',
      icon: <MapPin className="h-6 w-6" />,
      visual: <NearbyVisual />,
    },
    {
      id: 'location',
      title: 'Enable Location',
      description: 'Allow location access to see the closest stops and real-time bus positions near you.',
      icon: <Navigation className="h-6 w-6" />,
      visual: <LocationVisual />,
    },
  ]

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1)
    } else {
      handleComplete()
    }
  }

  const handleComplete = () => {
    setIsExiting(true)
    // Store that user has completed onboarding
    localStorage.setItem('tega-onboarding-complete', 'true')
    setTimeout(() => {
      onComplete()
    }, 500)
  }

  const handleSkip = () => {
    localStorage.setItem('tega-onboarding-complete', 'true')
    setIsExiting(true)
    setTimeout(() => {
      onComplete()
    }, 500)
  }

  const isLastStep = currentStep === steps.length - 1

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: isExiting ? 0 : 1 }}
      transition={{ duration: 0.5 }}
      className="fixed inset-0 z-50 bg-background flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Tega onboarding"
    >
      {/* Skip button */}
      <div className="absolute top-4 right-4 z-10">
        <button
          onClick={handleSkip}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-2 rounded-lg hover:bg-secondary"
          aria-label="Skip onboarding"
        >
          Skip
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col">
        {/* Visual area */}
        <div className="flex-1 relative overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={steps[currentStep].id}
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              transition={{ duration: 0.4, ease: 'easeInOut' }}
              className="absolute inset-0 flex items-center justify-center p-8"
            >
              {steps[currentStep].visual}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Text content */}
        <div className="px-6 pb-6 pt-4">
          <AnimatePresence mode="wait">
            <motion.div
              key={`text-${currentStep}`}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
              className="text-center mb-8"
            >
              <motion.div
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-primary/10 text-primary mb-4"
              >
                {steps[currentStep].icon}
              </motion.div>
              <h1 className="text-2xl font-bold text-foreground mb-3 text-balance">
                {steps[currentStep].title}
              </h1>
              <p className="text-muted-foreground text-balance max-w-xs mx-auto">
                {steps[currentStep].description}
              </p>
            </motion.div>
          </AnimatePresence>

          {/* Progress dots */}
          <div 
            className="flex items-center justify-center gap-2 mb-6"
            role="tablist"
            aria-label="Onboarding progress"
          >
            {steps.map((step, index) => (
              <button
                key={step.id}
                onClick={() => setCurrentStep(index)}
                className={cn(
                  'h-2 rounded-full transition-all duration-300',
                  index === currentStep
                    ? 'w-8 bg-primary'
                    : index < currentStep
                    ? 'w-2 bg-primary/60'
                    : 'w-2 bg-muted'
                )}
                role="tab"
                aria-selected={index === currentStep}
                aria-label={`Step ${index + 1}: ${step.title}`}
              />
            ))}
          </div>

          {/* Action button */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Button
              onClick={handleNext}
              size="lg"
              className="w-full h-14 text-base font-semibold rounded-2xl"
            >
              {isLastStep ? (
                <>
                  <Check className="h-5 w-5 mr-2" />
                  Get Started
                </>
              ) : (
                <>
                  Continue
                  <ChevronRight className="h-5 w-5 ml-2" />
                </>
              )}
            </Button>
          </motion.div>
        </div>
      </div>
    </motion.div>
  )
}

// Visual components for each step

function WelcomeVisual() {
  return (
    <div className="relative w-full max-w-[280px] aspect-square">
      {/* Animated rings */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="absolute inset-0"
      >
        <motion.div
          animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.1, 0.3] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute inset-0 rounded-full border-2 border-primary/30"
        />
        <motion.div
          animate={{ scale: [1, 1.15, 1], opacity: [0.4, 0.15, 0.4] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
          className="absolute inset-4 rounded-full border-2 border-primary/40"
        />
        <motion.div
          animate={{ scale: [1, 1.1, 1], opacity: [0.5, 0.2, 0.5] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
          className="absolute inset-8 rounded-full border-2 border-primary/50"
        />
      </motion.div>

      {/* Center bus icon */}
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, delay: 0.3 }}
        className="absolute inset-0 flex items-center justify-center"
      >
        <div className="h-24 w-24 rounded-3xl bg-primary shadow-lg shadow-primary/40 flex items-center justify-center">
          <Bus className="h-12 w-12 text-primary-foreground" />
        </div>
      </motion.div>

      {/* Floating stop indicators */}
      {[
        { x: -80, y: -60, delay: 0.5 },
        { x: 90, y: -40, delay: 0.7 },
        { x: -70, y: 70, delay: 0.9 },
        { x: 80, y: 60, delay: 1.1 },
      ].map((pos, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: pos.delay, type: 'spring' }}
          style={{ left: `calc(50% + ${pos.x}px)`, top: `calc(50% + ${pos.y}px)` }}
          className="absolute -translate-x-1/2 -translate-y-1/2"
        >
          <div className="h-8 w-8 rounded-full bg-card border-2 border-primary/50 flex items-center justify-center shadow-md">
            <MapPin className="h-4 w-4 text-primary" />
          </div>
        </motion.div>
      ))}
    </div>
  )
}

function ETAVisual() {
  return (
    <div className="w-full max-w-[300px]">
      {/* Mock ETA cards */}
      <div className="space-y-3">
        {[
          { route: '101', eta: '2–4 min', confidence: 'high', destination: 'Kimironko' },
          { route: '103', eta: '5–8 min', confidence: 'medium', destination: 'Downtown' },
          { route: '105', eta: '10–15 min', confidence: 'low', destination: 'Nyabugogo' },
        ].map((bus, index) => (
          <motion.div
            key={bus.route}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 + index * 0.15, type: 'spring', stiffness: 100 }}
            className="bg-card rounded-2xl p-4 border border-border shadow-sm"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center text-primary-foreground font-bold">
                  {bus.route}
                </div>
                <div>
                  <p className="font-medium text-foreground">{bus.destination}</p>
                  <p className="text-sm text-muted-foreground">Route {bus.route}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-semibold text-foreground">{bus.eta}</p>
                <div className="flex items-center gap-1 justify-end mt-1">
                  <div className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    bus.confidence === 'high' ? 'bg-green-500' :
                    bus.confidence === 'medium' ? 'bg-yellow-500' : 'bg-orange-500'
                  )} />
                  <span className="text-xs text-muted-foreground capitalize">{bus.confidence}</span>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Highlight annotation */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8 }}
        className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground"
      >
        <Sparkles className="h-4 w-4 text-primary" />
        <span>Realistic time ranges, not false promises</span>
      </motion.div>
    </div>
  )
}

function NearbyVisual() {
  return (
    <div className="relative w-full max-w-[280px] aspect-square">
      {/* Map-like background */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 rounded-3xl bg-muted/30 overflow-hidden"
      >
        {/* Grid lines */}
        <svg className="absolute inset-0 w-full h-full opacity-20">
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="0.5" className="text-muted-foreground" />
          </pattern>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </motion.div>

      {/* User location */}
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.3, type: 'spring' }}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      >
        <div className="relative">
          <motion.div
            animate={{ scale: [1, 1.5, 1], opacity: [0.6, 0, 0.6] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="absolute inset-0 h-6 w-6 rounded-full bg-blue-500/30"
          />
          <div className="h-6 w-6 rounded-full bg-blue-500 border-2 border-white shadow-lg" />
        </div>
      </motion.div>

      {/* Nearby stops */}
      {[
        { x: -70, y: -50, name: 'Downtown', mins: 3 },
        { x: 60, y: -70, name: 'Kacyiru', mins: 5 },
        { x: -60, y: 60, name: 'Remera', mins: 7 },
        { x: 70, y: 50, name: 'Kimironko', mins: 12 },
      ].map((stop, i) => (
        <motion.div
          key={stop.name}
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.5 + i * 0.1, type: 'spring' }}
          style={{ 
            left: `calc(50% + ${stop.x}px)`, 
            top: `calc(50% + ${stop.y}px)` 
          }}
          className="absolute -translate-x-1/2 -translate-y-1/2"
        >
          <div className="flex flex-col items-center">
            <div className="h-10 w-10 rounded-full bg-primary/90 flex items-center justify-center shadow-md">
              <MapPin className="h-5 w-5 text-primary-foreground" />
            </div>
            <div className="mt-1.5 px-2 py-0.5 rounded-full bg-card text-xs font-medium border border-border shadow-sm">
              {stop.mins} min
            </div>
          </div>
        </motion.div>
      ))}

      {/* Distance circles */}
      <motion.div
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 0.15, scale: 1 }}
        transition={{ delay: 0.4 }}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[200px] h-[200px] rounded-full border-2 border-dashed border-primary"
      />
    </div>
  )
}

function LocationVisual() {
  const [isGranted, setIsGranted] = useState(false)

  return (
    <div className="w-full max-w-[280px]">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="relative"
      >
        {/* Phone mockup */}
        <div className="relative mx-auto w-48 h-96 bg-card rounded-[2.5rem] border-4 border-border shadow-xl overflow-hidden">
          {/* Screen content */}
          <div className="absolute inset-4 rounded-[1.5rem] bg-background overflow-hidden">
            {/* Map-like background */}
            <div className="absolute inset-0 bg-muted/30">
              <div className="absolute inset-0 opacity-30">
                {[...Array(6)].map((_, i) => (
                  <div
                    key={i}
                    className="absolute h-px bg-muted-foreground/20"
                    style={{ 
                      top: `${20 + i * 15}%`, 
                      left: '10%', 
                      right: '10%',
                      transform: `rotate(${i % 2 ? 30 : -30}deg)`,
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Center marker */}
            <motion.div
              animate={{ y: isGranted ? 0 : [0, -10, 0] }}
              transition={{ duration: 1.5, repeat: isGranted ? 0 : Infinity }}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            >
              <div className="relative">
                {isGranted && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: [1, 2, 1], opacity: [0.5, 0, 0.5] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="absolute inset-0 h-8 w-8 -translate-x-1 -translate-y-1 rounded-full bg-blue-500/30"
                  />
                )}
                <div className={cn(
                  'h-6 w-6 rounded-full border-2 border-white shadow-lg transition-colors duration-300',
                  isGranted ? 'bg-blue-500' : 'bg-muted-foreground'
                )} />
              </div>
            </motion.div>
          </div>

          {/* Permission dialog */}
          <AnimatePresence>
            {!isGranted && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="absolute bottom-0 left-0 right-0 p-3"
              >
                <div className="bg-card rounded-2xl p-3 shadow-lg border border-border">
                  <p className="text-xs text-center text-muted-foreground mb-2">
                    Allow Tega to access your location?
                  </p>
                  <button
                    onClick={() => setIsGranted(true)}
                    className="w-full py-2 bg-primary text-primary-foreground text-xs font-medium rounded-lg"
                  >
                    Allow
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Success state */}
          <AnimatePresence>
            {isGranted && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="absolute bottom-4 left-3 right-3"
              >
                <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-2 flex items-center gap-2">
                  <div className="h-6 w-6 rounded-full bg-green-500 flex items-center justify-center">
                    <Check className="h-3.5 w-3.5 text-white" />
                  </div>
                  <span className="text-xs text-green-400 font-medium">Location enabled</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  )
}

// Hook to check if user needs onboarding
export function useOnboarding() {
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [isChecked, setIsChecked] = useState(false)

  useEffect(() => {
    const hasCompletedOnboarding = localStorage.getItem('tega-onboarding-complete')
    setShowOnboarding(!hasCompletedOnboarding)
    setIsChecked(true)
  }, [])

  const completeOnboarding = () => {
    setShowOnboarding(false)
  }

  const resetOnboarding = () => {
    localStorage.removeItem('tega-onboarding-complete')
    setShowOnboarding(true)
  }

  return { showOnboarding, isChecked, completeOnboarding, resetOnboarding }
}

export default Onboarding
