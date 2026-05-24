'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { useSettings, AppSettings } from '@/hooks/use-settings'
import { CaretLeft, Moon, Sun, PersonSimpleWalk, Eye, WifiHigh, MapPin, Clock, ShieldCheck, Info, Heartbeat } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

// ─── Health Checker Component ───
function SystemHealth() {
  const [health, setHealth] = useState<{ status: string, uptime: number, database: string } | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then(res => res.json())
      .then(data => setHealth(data))
      .catch(() => setHealth({ status: 'down', uptime: 0, database: 'disconnected' }))
  }, [])

  return (
    <div className="mt-8 mb-6 bg-card border border-border/40 rounded-surface overflow-hidden shadow-sm p-4">
      <div className="flex items-center gap-3.5 mb-3">
        <div className="h-9 w-9 rounded-input bg-muted border border-border/40 flex items-center justify-center shrink-0">
          <Heartbeat size={18} weight="duotone" className="text-foreground" />
        </div>
        <p className="font-bold text-sm text-foreground">System Health</p>
      </div>
      
      {!health ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="h-2 w-2 rounded-chip bg-muted-foreground animate-pulse" />
          Checking systems...
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium">API & Database</span>
            <div className="flex items-center gap-1.5">
              <div className={cn("h-2 w-2 rounded-chip", 
                health.status === 'healthy' ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" : 
                health.status === 'degraded' ? "bg-yellow-500" : "bg-red-500"
              )} />
              <span className="text-xs font-bold capitalize">{health.status}</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium">Server Uptime</span>
            <span className="text-xs font-bold font-mono">
              {Math.floor(health.uptime / 3600)}h {Math.floor((health.uptime % 3600) / 60)}m
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

function SettingsCard({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3 px-1">{title}</h3>
      <div className="bg-card border border-border/40 rounded-surface overflow-hidden shadow-sm">
        {children}
      </div>
    </div>
  )
}

function SettingsToggle({ 
  icon: Icon, 
  label, 
  description, 
  isActive, 
  onToggle, 
  isLast = false 
}: { 
  icon: any, 
  label: string, 
  description?: string, 
  isActive: boolean, 
  onToggle: () => void,
  isLast?: boolean
}) {
  return (
    <div className={cn("p-4 flex items-center justify-between cursor-pointer hover:bg-muted/30 transition-colors", !isLast && "border-b border-border/40")} onClick={onToggle}>
      <div className="flex items-center gap-3.5">
        <div className="h-9 w-9 rounded-input bg-muted border border-border/40 flex items-center justify-center shrink-0">
          <Icon size={18} weight="duotone" className="text-foreground" />
        </div>
        <div>
          <p className="font-bold text-sm text-foreground leading-tight">{label}</p>
          {description && <p className="text-xs text-muted-foreground mt-1 max-w-[240px] leading-relaxed">{description}</p>}
        </div>
      </div>
      {/* Custom Switch for Premium Style */}
      <div className={cn("w-12 h-6 rounded-chip p-1 transition-colors flex shrink-0 ml-4", isActive ? "bg-primary" : "bg-muted-foreground/30")}>
        <motion.div 
          className="w-4 h-4 rounded-chip bg-white shadow-sm"
          animate={{ x: isActive ? 24 : 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
        />
      </div>
    </div>
  )
}

function SettingsSelect({
  icon: Icon,
  label,
  value,
  options,
  onChange,
  isLast = false
}: {
  icon: any,
  label: string,
  value: string,
  options: { value: string, label: string }[],
  onChange: (val: any) => void,
  isLast?: boolean
}) {
  return (
    <div className={cn("p-4 flex flex-col gap-3.5", !isLast && "border-b border-border/40")}>
      <div className="flex items-center gap-3.5">
        <div className="h-9 w-9 rounded-input bg-muted border border-border/40 flex items-center justify-center shrink-0">
          <Icon size={18} weight="duotone" className="text-foreground" />
        </div>
        <p className="font-bold text-sm text-foreground">{label}</p>
      </div>
      <div className="flex bg-muted p-1 rounded-input">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex-1 py-1.5 text-xs font-bold rounded-input transition-colors",
              value === opt.value ? "bg-background text-foreground shadow-sm border border-border/40" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const router = useRouter()
  const { settings, updateSetting, isLoaded } = useSettings()

  if (!isLoaded) return null // Or a skeleton

  return (
    <div className="min-h-screen bg-background text-foreground pb-20">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-card/80 backdrop-blur-md border-b border-border/40 px-4 py-4 flex items-center gap-4 shadow-sm">
        <button 
          onClick={() => router.back()}
          className="h-10 w-10 rounded-chip bg-muted flex items-center justify-center hover:bg-muted/80 transition-colors border border-border/40"
          aria-label="Go back"
        >
          <CaretLeft size={20} weight="bold" />
        </button>
        <h1 className="text-xl font-black tracking-tight">Preferences</h1>
      </header>

      <main className="max-w-md mx-auto p-4 pt-8">
        
        <SettingsCard title="Appearance & Motion">
          <SettingsSelect 
            icon={Sun} 
            label="Theme" 
            value={settings.theme}
            onChange={(val) => updateSetting('theme', val)}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'system', label: 'System' }
            ]}
          />
          <SettingsToggle 
            icon={Eye} 
            label="High Contrast" 
            description="Increases border visibility and text weight"
            isActive={settings.highContrast}
            onToggle={() => updateSetting('highContrast', !settings.highContrast)}
          />
          <SettingsToggle 
            icon={PersonSimpleWalk} 
            label="Reduce Animations" 
            description="Saves battery and reduces motion"
            isActive={settings.reduceMotion}
            onToggle={() => updateSetting('reduceMotion', !settings.reduceMotion)}
            isLast
          />
        </SettingsCard>

        <SettingsCard title="Connectivity & Data">
          <SettingsToggle 
            icon={WifiHigh} 
            label="Low Data Mode" 
            description="Reduces map detail and auto-refresh frequency"
            isActive={settings.lowDataMode}
            onToggle={() => updateSetting('lowDataMode', !settings.lowDataMode)}
            isLast
          />
        </SettingsCard>

        <SettingsCard title="ETA & Trust Preferences">
          <SettingsSelect 
            icon={Clock} 
            label="ETA Display Style" 
            value={settings.etaPreference}
            onChange={(val) => updateSetting('etaPreference', val)}
            options={[
              { value: 'confidence', label: 'Show Confidence' },
              { value: 'precision', label: 'Exact Minutes' },
              { value: 'simple', label: 'Simple Window' }
            ]}
            isLast
          />
        </SettingsCard>

        <SettingsCard title="Transit Preferences">
          <div className="p-4 flex items-center justify-between border-b border-border/40 cursor-pointer hover:bg-muted/30">
            <div className="flex items-center gap-3.5">
              <div className="h-9 w-9 rounded-input bg-muted border border-border/40 flex items-center justify-center shrink-0">
                <MapPin size={18} weight="fill" className="text-primary" />
              </div>
              <p className="font-bold text-sm text-foreground">Favorite Stops</p>
            </div>
            <span className="text-xs font-bold bg-muted border border-border/40 px-2 py-1 rounded-input text-muted-foreground">Soon</span>
          </div>
          <div className="p-4 flex items-center justify-between cursor-pointer hover:bg-muted/30">
            <div className="flex items-center gap-3.5">
              <div className="h-9 w-9 rounded-input bg-muted border border-border/40 flex items-center justify-center shrink-0">
                <MapPin size={18} weight="duotone" className="text-foreground" />
              </div>
              <p className="font-bold text-sm text-foreground">Favorite Destinations</p>
            </div>
            <span className="text-xs font-bold bg-muted border border-border/40 px-2 py-1 rounded-input text-muted-foreground">Soon</span>
          </div>
        </SettingsCard>

        <SettingsCard title="About Tega">
          <div className="p-4 space-y-3">
            <div className="flex items-start gap-3">
              <ShieldCheck size={20} weight="fill" className="text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-sm">Honest Uncertainty</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  We show confidence levels instead of exact minutes because Kigali traffic is unpredictable. We'd rather tell you we're unsure than lie with false precision.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 mt-4">
              <Info size={20} weight="fill" className="text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-sm">Privacy First</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  Your location and preferences never leave this device. We don't require an account to use the core features of Tega.
                </p>
              </div>
            </div>
          </div>
        </SettingsCard>

        <SystemHealth />

        <p className="text-center text-xs font-bold text-muted-foreground/30 mt-4 mb-4 tracking-widest uppercase">Tega Transit v0.1.0</p>
      </main>
    </div>
  )
}
