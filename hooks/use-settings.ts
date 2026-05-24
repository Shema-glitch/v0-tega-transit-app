import { useState, useEffect } from 'react'

export interface AppSettings {
  theme: 'light' | 'dark' | 'system'
  reduceMotion: boolean
  highContrast: boolean
  textSize: 'normal' | 'large'
  lowDataMode: boolean
  etaPreference: 'confidence' | 'precision' | 'simple'
}

const defaultSettings: AppSettings = {
  theme: 'light', // We just overhauled to a hardcoded light theme per Uber design
  reduceMotion: false,
  highContrast: false,
  textSize: 'normal',
  lowDataMode: false,
  etaPreference: 'confidence',
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [isLoaded, setIsLoaded] = useState(false)

  // Load settings on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('tega_settings')
      if (saved) {
        setSettings({ ...defaultSettings, ...JSON.parse(saved) })
      }
    } catch (e) {
      console.error('Failed to load settings', e)
    }
    setIsLoaded(true)
  }, [])

  // Save settings whenever they change (if loaded)
  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem('tega_settings', JSON.stringify(settings))
      
      // Apply side effects
      if (settings.reduceMotion) {
        document.documentElement.classList.add('reduce-motion')
      } else {
        document.documentElement.classList.remove('reduce-motion')
      }

      if (settings.highContrast) {
        document.documentElement.classList.add('high-contrast')
      } else {
        document.documentElement.classList.remove('high-contrast')
      }
    }
  }, [settings, isLoaded])

  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  return { settings, updateSetting, isLoaded }
}
