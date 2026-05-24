'use client'

import { useState, useRef, useEffect } from 'react'
import { MagnifyingGlass, MapPin, X } from '@phosphor-icons/react'
import { BusStop } from '@/lib/types'
import { fetchStops } from '@/lib/api'
import { cn } from '@/lib/utils'

interface SearchBarProps {
  onStopSelect: (stop: BusStop) => void
  className?: string
}

export function SearchBar({ onStopSelect, className }: SearchBarProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<BusStop[]>([])
  const [isFocused, setIsFocused] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Click outside to close results
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsFocused(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    const search = async () => {
      if (query.trim().length < 2) {
        setResults([])
        return
      }
      setIsLoading(true)
      const stops = await fetchStops(query)
      setResults(stops)
      setIsLoading(false)
    }

    const debounceId = setTimeout(search, 300)
    return () => clearTimeout(debounceId)
  }, [query])

  return (
    <div ref={wrapperRef} className={cn("relative w-full max-w-sm", className)}>
      <div className={cn(
        "flex items-center gap-2 bg-card border rounded-input px-3 py-2 transition-all",
        isFocused ? "border-primary shadow-sm" : "border-border"
      )}>
        <MagnifyingGlass size={18} className="text-muted-foreground shrink-0" />
        <input 
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsFocused(true)}
          placeholder="Search stops..."
          className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        {query && (
          <button onClick={() => setQuery('')} className="p-1 hover:bg-secondary rounded-md shrink-0">
            <X size={14} className="text-muted-foreground" />
          </button>
        )}
      </div>

      {isFocused && (query.trim().length >= 2) && (
        <div className="absolute top-full mt-2 w-full bg-card border border-border rounded-surface shadow-[0_4px_16px_rgba(0,0,0,0.12)] overflow-hidden z-50">
          {isLoading ? (
            <div className="p-4 text-center text-xs text-muted-foreground">Searching...</div>
          ) : results.length > 0 ? (
            <div className="max-h-60 overflow-y-auto custom-scrollbar">
              {results.map((stop) => (
                <button
                  key={stop.id}
                  onClick={() => {
                    onStopSelect(stop)
                    setIsFocused(false)
                    setQuery('')
                  }}
                  className="w-full text-left p-3 flex items-center gap-3 hover:bg-secondary border-b border-border last:border-0 transition-colors"
                >
                  <div className="h-8 w-8 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                    <MapPin size={16} weight="fill" className="text-primary" />
                  </div>
                  <div>
                    <p className="font-bold text-sm text-foreground">{stop.name}</p>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="p-4 text-center text-xs text-muted-foreground">No stops found</div>
          )}
        </div>
      )}
    </div>
  )
}
