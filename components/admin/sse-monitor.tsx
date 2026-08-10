'use client'

/**
 * components/admin/sse-monitor.tsx — live SSE diagnostic, admin-only.
 *
 * Moved out of the public status page: opening a long-lived SSE connection
 * from every visitor's browser is wasteful, and the "inject test ping" button
 * writes real events into the shared stream. This component is a self-
 * contained leaf so its 1-second staleness tick re-renders ONLY this card,
 * never the whole dashboard (which auto-polls every 15s anyway).
 *
 * Answers the classic "the app feels dead" questions live: is the socket even
 * open, which event types are actually arriving, and how long since the last
 * frame (a live stream should never go quiet for long).
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

// The event types the SSE route emits (see app/api/realtime/sse/route.ts).
const SSE_EVENT_TYPES = [
  'connected',
  'vehicle:update',
  'viewer:counts',
  'incident:alert',
  'system:maintenance',
] as const

interface SseDiag {
  running: boolean
  state: string
  connectedAt: number | null
  reconnects: number
  errors: number
  total: number
  byType: Record<string, number>
  lastMessageAt: number | null
  lastPayload: string
}

const EMPTY_SSE_DIAG: SseDiag = {
  running: false,
  state: 'idle',
  connectedAt: null,
  reconnects: 0,
  errors: 0,
  total: 0,
  byType: {},
  lastMessageAt: null,
  lastPayload: '',
}

export interface SseMonitorHandle {
  start: () => void
  stop: () => void
}

const SseMonitor = forwardRef<SseMonitorHandle>(function SseMonitor(_, ref) {
  const [sse, setSse] = useState<SseDiag>(EMPTY_SSE_DIAG)
  const [now, setNow] = useState(() => Date.now())
  const [injecting, setInjecting] = useState(false)
  const esRef = useRef<EventSource | null>(null)
  const openCountRef = useRef(0)

  const stopSse = useCallback(() => {
    esRef.current?.close()
    esRef.current = null
    setSse((s) => ({ ...s, running: false, state: 'stopped' }))
  }, [])

  const startSse = useCallback(() => {
    esRef.current?.close() // never leak a prior connection
    openCountRef.current = 0
    setSse({ ...EMPTY_SSE_DIAG, running: true, state: 'connecting' })

    const es = new EventSource('/api/realtime/sse?lat=-1.9403&lng=30.0618&radius=5000')
    esRef.current = es

    es.addEventListener('connected', () => {
      setSse((s) => ({
        ...s,
        state: 'streaming',
        byType: { ...s.byType, connected: (s.byType.connected ?? 0) + 1 },
      }))
    })

    es.onopen = () => {
      openCountRef.current += 1
      const isReconnect = openCountRef.current > 1
      setSse((s) => ({
        ...s,
        state: 'streaming',
        connectedAt: s.connectedAt ?? Date.now(),
        reconnects: isReconnect ? s.reconnects + 1 : s.reconnects,
      }))
    }

    es.addEventListener('message', (e) => {
      let type = 'unknown'
      try { type = (JSON.parse(e.data)?.type as string) ?? 'unknown' } catch { /* keep 'unknown' */ }
      const last = e.data.length > 400 ? e.data.slice(0, 400) + ' …' : e.data
      setSse((s) => ({
        ...s,
        state: 'streaming',
        total: s.total + 1,
        byType: { ...s.byType, [type]: (s.byType[type] ?? 0) + 1 },
        lastMessageAt: Date.now(),
        lastPayload: last,
      }))
    })

    // EventSource auto-reconnects on transient errors; we deliberately do NOT
    // close here, so the tool surfaces flapping (rising reconnect count) rather
    // than hiding it. readyState tells us whether it's retrying or truly dead.
    es.onerror = () => {
      const dead = es.readyState === EventSource.CLOSED
      setSse((s) => ({
        ...s,
        errors: s.errors + 1,
        state: dead ? 'connection closed by server' : 'reconnecting…',
      }))
    }
  }, [])

  // Fire a real vehicle ping + incident report so they round-trip back through
  // the SSE stream — proves the whole ingest→broadcast→client path end to end.
  const injectTestData = useCallback(async () => {
    setInjecting(true)
    try {
      await Promise.all([
        fetch('/api/realtime/broadcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vehicle_id: 'admin-sse-test',
            route_id: '101',
            client_id: 'admin-dashboard',
            latitude: -1.9403,
            longitude: 30.0618,
            speed_kmh: 25,
            heading: 90,
          }),
          cache: 'no-store',
        }),
        fetch('/api/incidents/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vehicle_id: 'admin-sse-test',
            route_id: '101',
            client_id: 'admin-dashboard',
            incident_type: 'traffic_delay',
            latitude: -1.9403,
            longitude: 30.0618,
          }),
          cache: 'no-store',
        }),
      ])
    } catch { /* the SSE panel will simply show nothing new arrived */ }
    finally { setInjecting(false) }
  }, [])

  // Live staleness clock + cleanup. Only ticks while a stream is active.
  useEffect(() => {
    if (!sse.running) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [sse.running])

  useEffect(() => () => { esRef.current?.close() }, []) // close on unmount

  // Expose start/stop so the Cmd+K palette can fire the monitor from anywhere.
  useImperativeHandle(ref, () => ({ start: startSse, stop: stopSse }), [startSse, stopSse])

  const staleSec = sse.lastMessageAt ? Math.floor((now - sse.lastMessageAt) / 1000) : null
  const upSec = sse.connectedAt ? Math.floor((now - sse.connectedAt) / 1000) : null
  const staleClass =
    staleSec === null ? 'text-muted-foreground'
    : staleSec > 10 ? 'text-destructive'
    : staleSec > 4 ? 'text-warning'
    : 'text-success'

  return (
    <div className="space-y-2">
      <Button
        onClick={sse.running ? stopSse : startSse}
        variant="outline"
        size="sm"
        className={sse.running ? 'h-9 gap-1 text-xs text-destructive border-destructive/40 hover:bg-destructive/10' : 'h-9 gap-1 text-xs'}
      >
        {sse.running ? '■ Stop SSE stream' : '⚡ Start live SSE monitor'}
      </Button>
      {sse.running && (
        <Button onClick={injectTestData} disabled={injecting} variant="outline" size="sm" className="h-9 gap-1 text-xs">
          {injecting ? 'injecting…' : '💉 Inject test ping + incident'}
        </Button>
      )}
      {sse.state !== 'idle' && (
        <Card className="gap-2 p-3 text-xs">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>
              SSE: <span className="text-primary">{sse.state}</span>
            </span>
            <span>{sse.total} frames</span>
            {upSec !== null && <span>up {upSec}s</span>}
            {staleSec !== null && <span className={staleClass}>last frame {staleSec}s ago</span>}
            {sse.reconnects > 0 && (
              <span className="text-warning">{sse.reconnects} reconnect{sse.reconnects > 1 ? 's' : ''}</span>
            )}
            {sse.errors > 0 && (
              <span className="text-muted-foreground">{sse.errors} error{sse.errors > 1 ? 's' : ''}</span>
            )}
          </div>
          {/* Per-type breakdown — a stream that's "connected" but with a whole
              event type stuck at 0 is the real bug most of the time. */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
            {SSE_EVENT_TYPES.map((t) => {
              const n = sse.byType[t] ?? 0
              return (
                <span key={t}>
                  {t}: <span className={n > 0 ? 'text-success' : 'text-muted-foreground'}>{n}</span>
                </span>
              )
            })}
          </div>
          {sse.lastPayload && (
            <pre className="overflow-x-auto whitespace-pre-wrap break-all text-muted-foreground">
              {sse.lastPayload}
            </pre>
          )}
        </Card>
      )}
    </div>
  )
})

export default SseMonitor
