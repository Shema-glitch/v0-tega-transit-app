'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MapPin, Clock, NavigationArrow, CaretRight, Check, Bus, Sparkle, ArrowRight } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

// ─── Responsive hook ───────────────────────────────────────────────────────
function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false)
  useEffect(() => {
    const media = window.matchMedia(query)
    setMatches(media.matches)
    const listener = () => setMatches(media.matches)
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [query])
  return matches
}

// ─── Types ─────────────────────────────────────────────────────────────────
interface OnboardingProps {
  onComplete: () => void
}

interface OnboardingStep {
  id: string
  title: string
  description: string
  eyebrow: string
  icon: React.ReactNode
  visual: React.ReactNode
}

// ─── Step definitions ──────────────────────────────────────────────────────
function useSteps(): OnboardingStep[] {
  return [
    {
      id: 'welcome',
      eyebrow: 'Welcome',
      title: 'Navigate Kigali with confidence',
      description: 'Tega gives you real-time visibility into Kigali\'s bus network — so you spend less time waiting and more time moving.',
      icon: <Bus className="h-5 w-5" />,
      visual: <WelcomeVisual />,
    },
    {
      id: 'eta',
      eyebrow: 'Smart ETAs',
      title: 'Honest arrival windows, not false promises',
      description: 'We show confidence-based time ranges instead of precise countdowns that are often wrong. Know when to leave, not just when to hope.',
      icon: <Clock className="h-5 w-5" />,
      visual: <ETAVisual />,
    },
    {
      id: 'nearby',
      eyebrow: 'Nearby Stops',
      title: 'Every stop within reach, mapped',
      description: 'Discover bus stops near you with walking times calculated from your exact position. Tap any stop to see all arriving buses.',
      icon: <MapPin className="h-5 w-5" />,
      visual: <NearbyVisual />,
    },
    {
      id: 'location',
      eyebrow: 'Location Access',
      title: 'Your position makes it personal',
      description: 'Allow location access to automatically surface the closest stops and live bus positions around you.',
      icon: <NavigationArrow className="h-5 w-5" weight="fill" />,
      visual: <LocationVisual />,
    },
  ]
}

// ═══════════════════════════════════════════════════════════════════════════
// ROOT — branches to device-specific onboarding
// ═══════════════════════════════════════════════════════════════════════════
export function Onboarding({ onComplete }: OnboardingProps) {
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const isTablet  = useMediaQuery('(min-width: 768px)')

  const [currentStep, setCurrentStep] = useState(0)
  const [isExiting, setIsExiting] = useState(false)
  const steps = useSteps()

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1)
    } else {
      handleComplete()
    }
  }

  const handleComplete = () => {
    setIsExiting(true)
    localStorage.setItem('tega-onboarding-complete', 'true')
    setTimeout(() => onComplete(), 450)
  }

  const handleSkip = () => {
    localStorage.setItem('tega-onboarding-complete', 'true')
    setIsExiting(true)
    setTimeout(() => onComplete(), 450)
  }

  const isLastStep = currentStep === steps.length - 1

  const shared = {
    steps,
    currentStep,
    setCurrentStep,
    isLastStep,
    isExiting,
    onNext: handleNext,
    onSkip: handleSkip,
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: isExiting ? 0 : 1 }}
      transition={{ duration: 0.45 }}
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Tega onboarding"
    >
      {isDesktop ? (
        <DesktopOnboarding {...shared} />
      ) : isTablet ? (
        <TabletOnboarding {...shared} />
      ) : (
        <MobileOnboarding {...shared} />
      )}
    </motion.div>
  )
}

// ─── Shared props ──────────────────────────────────────────────────────────
interface OnboardingLayoutProps {
  steps: OnboardingStep[]
  currentStep: number
  setCurrentStep: (i: number) => void
  isLastStep: boolean
  isExiting: boolean
  onNext: () => void
  onSkip: () => void
}

// ═══════════════════════════════════════════════════════════════════════════
// DESKTOP ONBOARDING — Cinematic split-pane, map-native
// Left: immersive animated visual with map-grid backdrop
// Right: structured content panel with constrained CTA
// ═══════════════════════════════════════════════════════════════════════════
function DesktopOnboarding({ steps, currentStep, setCurrentStep, isLastStep, onNext, onSkip }: OnboardingLayoutProps) {
  const step = steps[currentStep]

  return (
    <div className="h-full w-full flex onboarding-bg-desktop">

      {/* ── LEFT: Immersive visual panel ── */}
      <div className="relative flex-1 flex items-center justify-center overflow-hidden">
        {/* Map-grid texture */}
        <div className="absolute inset-0 onboarding-map-grid opacity-60" />

        {/* Radial ambient glow that shifts per step */}
        <motion.div
          key={`glow-${currentStep}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8 }}
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse 70% 60% at 50% 50%, oklch(0.75 0.14 180 / 0.07) 0%, transparent 70%)`,
          }}
        />

        {/* Corner decoration — step number */}
        <div className="absolute top-8 left-8 flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-surface bg-primary flex items-center justify-center shadow-lg shadow-primary/30">
            <Bus className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-xl font-bold text-foreground tracking-tight">Tega</span>
        </div>

        {/* Skip — top right of visual panel */}
        <button
          onClick={onSkip}
          className="absolute top-8 right-8 text-sm text-muted-foreground/70 hover:text-foreground transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5"
          aria-label="Skip onboarding"
        >
          Skip
        </button>

        {/* Step progress — bottom left */}
        <div className="absolute bottom-8 left-8 flex items-center gap-1.5">
          {steps.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setCurrentStep(i)}
              aria-label={`Go to step ${i + 1}: ${s.title}`}
              className={cn(
                'h-1 rounded-full transition-all duration-400',
                i === currentStep ? 'w-8 bg-primary' : i < currentStep ? 'w-4 bg-primary/50' : 'w-4 bg-white/15'
              )}
            />
          ))}
        </div>

        {/* ── Large visual ── */}
        <AnimatePresence mode="wait">
          <motion.div
            key={step.id}
            initial={{ opacity: 0, scale: 0.92, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 1.04, y: -16 }}
            transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
            className="relative z-10 flex items-center justify-center"
            style={{ transform: 'scale(1.35)' }}
          >
            {step.visual}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── RIGHT: Content panel ── */}
      <div
        className="flex flex-col justify-center shrink-0 h-full overflow-y-auto"
        style={{
          width: '420px',
          background: 'oklch(0.13 0.01 250)',
          borderLeft: '1px solid oklch(0.22 0.01 250 / 0.8)',
        }}
      >
        <div className="px-10 py-12 flex flex-col gap-8 h-full justify-center">

          {/* Eyebrow + icon */}
          <AnimatePresence mode="wait">
            <motion.div
              key={`header-${currentStep}`}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              transition={{ duration: 0.35 }}
              className="space-y-5"
            >
              {/* Step badge */}
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-primary/12 border border-primary/20 flex items-center justify-center text-primary">
                  {step.icon}
                </div>
                <span className="text-xs font-semibold uppercase tracking-widest text-primary/80">
                  {step.eyebrow}
                </span>
              </div>

              {/* Title */}
              <h1 className="text-3xl font-bold text-foreground leading-tight text-balance">
                {step.title}
              </h1>

              {/* Description */}
              <p className="text-base text-muted-foreground leading-relaxed">
                {step.description}
              </p>
            </motion.div>
          </AnimatePresence>

          {/* ── CTA area ── */}
          <div className="space-y-4">
            {/* Step counter */}
            <p className="text-xs text-muted-foreground/50 font-medium">
              {currentStep + 1} / {steps.length}
            </p>

            {/* Primary CTA — contained, NOT full-width */}
            <motion.button
              whileHover={{ scale: 1.02, y: -1 }}
              whileTap={{ scale: 0.98 }}
              onClick={onNext}
              className="flex items-center gap-2.5 px-8 py-3.5 rounded-surface bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
              aria-label={isLastStep ? 'Get started' : 'Continue to next step'}
            >
              {isLastStep ? (
                <>
                  <Check className="h-4 w-4" />
                  Get Started
                </>
              ) : (
                <>
                  Continue
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </motion.button>

            {/* Skip link */}
            {!isLastStep && (
              <button
                onClick={onSkip}
                className="text-sm text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              >
                Skip introduction
              </button>
            )}
          </div>

          {/* Bottom tagline */}
          <p className="text-xs text-muted-foreground/30 mt-auto pt-8">
            Real-time Kigali transit · 8 routes · 28 stops
          </p>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TABLET ONBOARDING — Spacious, immersive, centered
// Visual takes generous top space, content below with breathing room
// Button constrained — not full-width
// ═══════════════════════════════════════════════════════════════════════════
function TabletOnboarding({ steps, currentStep, setCurrentStep, isLastStep, onNext, onSkip }: OnboardingLayoutProps) {
  const step = steps[currentStep]

  return (
    <div className="h-full w-full flex flex-col bg-background">

      {/* Skip */}
      <div className="absolute top-6 right-6 z-10">
        <button
          onClick={onSkip}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-2 rounded-lg hover:bg-secondary"
          aria-label="Skip onboarding"
        >
          Skip
        </button>
      </div>

      {/* Visual area — top 55% */}
      <div
        className="relative overflow-hidden flex items-center justify-center onboarding-visual-gradient"
        style={{ flex: '0 0 55%' }}
      >
        {/* Subtle grid */}
        <div className="absolute inset-0 onboarding-map-grid opacity-40" />

        <AnimatePresence mode="wait">
          <motion.div
            key={step.id}
            initial={{ opacity: 0, y: 20, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.96 }}
            transition={{ duration: 0.45, ease: [0.25, 0.1, 0.25, 1] }}
            className="relative z-10 flex items-center justify-center p-10"
            style={{ transform: 'scale(1.1)' }}
          >
            {step.visual}
          </motion.div>
        </AnimatePresence>

        {/* Bottom fade */}
        <div
          className="absolute bottom-0 left-0 right-0 pointer-events-none"
          style={{
            height: '80px',
            background: 'linear-gradient(to bottom, transparent, oklch(0.12 0.01 250))',
          }}
        />
      </div>

      {/* Content area — bottom 45%, centered */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 pb-8 pt-6">
        <div className="w-full max-w-lg space-y-6">

          {/* Step badge */}
          <AnimatePresence mode="wait">
            <motion.div
              key={`content-${currentStep}`}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.35 }}
              className="space-y-3 text-center"
            >
              {/* Icon badge */}
              <motion.div
                initial={{ scale: 0.85 }}
                animate={{ scale: 1 }}
                className="inline-flex items-center justify-center h-12 w-12 rounded-2xl bg-primary/10 border border-primary/20 text-primary mx-auto"
              >
                {step.icon}
              </motion.div>

              <h1 className="text-2xl font-bold text-foreground text-balance leading-snug">
                {step.title}
              </h1>
              <p className="text-muted-foreground text-balance max-w-sm mx-auto leading-relaxed">
                {step.description}
              </p>
            </motion.div>
          </AnimatePresence>

          {/* Progress dots */}
          <div
            className="flex items-center justify-center gap-2"
            role="tablist"
            aria-label="Onboarding progress"
          >
            {steps.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setCurrentStep(i)}
                className={cn(
                  'h-2 rounded-full transition-all duration-300',
                  i === currentStep ? 'w-8 bg-primary' : i < currentStep ? 'w-2 bg-primary/50' : 'w-2 bg-muted'
                )}
                role="tab"
                aria-selected={i === currentStep}
                aria-label={`Step ${i + 1}: ${s.title}`}
              />
            ))}
          </div>

          {/* CTA — NOT full-width on tablet */}
          <div className="flex flex-col items-center gap-3">
            <motion.button
              whileHover={{ scale: 1.03, y: -1 }}
              whileTap={{ scale: 0.97 }}
              onClick={onNext}
              className="inline-flex items-center gap-2.5 px-10 py-3.5 rounded-surface bg-primary text-primary-foreground font-semibold text-base hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20 focus:outline-none focus:ring-2 focus:ring-primary"
              aria-label={isLastStep ? 'Get started' : 'Continue'}
            >
              {isLastStep ? (
                <>
                  <Check className="h-5 w-5" />
                  Get Started
                </>
              ) : (
                <>
                  Continue
                  <CaretRight className="h-5 w-5" weight="bold" />
                </>
              )}
            </motion.button>

            {!isLastStep && (
              <button
                onClick={onSkip}
                className="text-sm text-muted-foreground/60 hover:text-muted-foreground transition-colors"
              >
                Skip
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MOBILE ONBOARDING — Thumb-first, full-width CTA, commuter-optimized
// ═══════════════════════════════════════════════════════════════════════════
function MobileOnboarding({ steps, currentStep, setCurrentStep, isLastStep, onNext, onSkip }: OnboardingLayoutProps) {
  const step = steps[currentStep]

  return (
    <div className="h-full w-full flex flex-col bg-background">

      {/* Skip */}
      <div className="absolute top-4 right-4 z-10">
        <button
          onClick={onSkip}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-2 rounded-lg hover:bg-secondary"
          aria-label="Skip onboarding"
        >
          Skip
        </button>
      </div>

      {/* Visual — flexible top area */}
      <div className="flex-1 relative overflow-hidden flex items-center justify-center p-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={step.id}
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -50 }}
            transition={{ duration: 0.4, ease: 'easeInOut' }}
            className="absolute inset-0 flex items-center justify-center p-8"
          >
            {step.visual}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Text + controls — bottom */}
      <div className="px-6 pb-6 pt-4 shrink-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={`text-${currentStep}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            className="text-center mb-7"
          >
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20 text-primary mb-4"
            >
              {step.icon}
            </motion.div>
            <h1 className="text-2xl font-bold text-foreground mb-3 text-balance">
              {step.title}
            </h1>
            <p className="text-muted-foreground text-balance max-w-xs mx-auto text-sm leading-relaxed">
              {step.description}
            </p>
          </motion.div>
        </AnimatePresence>

        {/* Progress dots */}
        <div
          className="flex items-center justify-center gap-2 mb-6"
          role="tablist"
          aria-label="Onboarding progress"
        >
          {steps.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setCurrentStep(i)}
              className={cn(
                'h-2 rounded-full transition-all duration-300',
                i === currentStep ? 'w-8 bg-primary' : i < currentStep ? 'w-2 bg-primary/60' : 'w-2 bg-muted'
              )}
              role="tab"
              aria-selected={i === currentStep}
              aria-label={`Step ${i + 1}: ${s.title}`}
            />
          ))}
        </div>

        {/* Full-width CTA — thumb reachable, feels native */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Button
            onClick={onNext}
            size="lg"
            className="w-full h-14 text-base font-semibold rounded-surface"
          >
            {isLastStep ? (
              <>
                <Check className="h-5 w-5 mr-2" />
                Get Started
              </>
            ) : (
              <>
                Continue
                <CaretRight className="h-5 w-5 ml-2" weight="bold" />
              </>
            )}
          </Button>
        </motion.div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// VISUAL COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

function WelcomeVisual() {
  return (
    <div className="relative w-full max-w-sm mx-auto aspect-square">
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
        <div className="h-24 w-24 rounded-modal bg-primary shadow-lg shadow-primary/40 flex items-center justify-center">
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
    <div className="w-full max-w-sm mx-auto">
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
            className="bg-card rounded-surface p-4 border border-border shadow-sm"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm">
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

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8 }}
        className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground"
      >
        <Sparkle className="h-4 w-4 text-primary" weight="fill" />
        <span>Realistic time ranges, not false promises</span>
      </motion.div>
    </div>
  )
}

function NearbyVisual() {
  return (
    <div className="relative w-full max-w-sm mx-auto aspect-square">
      {/* Map-like background */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 rounded-modal bg-muted/30 overflow-hidden"
      >
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
          style={{ left: `calc(50% + ${stop.x}px)`, top: `calc(50% + ${stop.y}px)` }}
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

      {/* Distance circle */}
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
        <div className="relative mx-auto w-48 h-96 bg-card rounded-modal border-4 border-border shadow-xl overflow-hidden">
          <div className="absolute inset-4 rounded-surface bg-background overflow-hidden">
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

          <AnimatePresence>
            {!isGranted && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="absolute bottom-0 left-0 right-0 p-3"
              >
                <div className="bg-card rounded-surface p-3 shadow-lg border border-border">
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

// ─── Onboarding hook ───────────────────────────────────────────────────────
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
