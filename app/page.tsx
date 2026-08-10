'use client'

/**
 * Public status page for the BusGo Track API.
 *
 * This repo is API-only — the production frontend lives in a separate
 * repository. This page exists so anyone hitting the deployment root can see
 * at a glance whether the API is behaving.
 *
 * Deliberately read-only: probing every endpoint from the browser used to live
 * here ("re-run all checks", per-endpoint run links) and it cost N requests
 * per visitor — a status page every user auto-triggers is a self-inflicted
 * load spike. All of that moved to the admin dashboard (server-side, gated).
 * This page shows passive data only: overall status from /api/status and the
 * Render-style 90-day uptime bars from /api/uptime (one cheap read each).
 *
 * Styling uses shadcn/ui's own default (light) theme and components.
 */

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertTriangle } from 'lucide-react'
import UptimeBars, { type UptimeDay } from '@/components/uptime-bars'

interface UptimeEndpoint {
  id: string
  method: 'GET' | 'POST'
  label: string
  title: string
  description: string
  group: string
  uptimePct: number
  samples: number
  last: 'ok' | 'degraded' | 'down' | null
  buckets: UptimeDay[]
}

interface UptimeResponse {
  days: number
  endpoints: UptimeEndpoint[]
  durable: boolean
}

interface StatusFlag {
  feature: string
  reason: string
  since: number
}

// The public page speaks plain English — internal group ids map to friendly
// section headings, and only user-facing read services are shown (write
// endpoints, system probes, and deprecated paths stay off the public board).
const GROUP_HEADINGS: Record<string, string> = {
  'Stops & Arrivals': 'Stops & arrivals',
  'GTFS Static': 'Routes & schedules',
  Realtime: 'Live updates',
  Community: 'Community',
}

const LAST_BADGE: Record<'ok' | 'degraded' | 'down', { label: string; className: string }> = {
  ok: { label: 'Operational', className: 'text-green-700 bg-green-500/15 border-transparent' },
  degraded: { label: 'Degraded', className: 'text-amber-700 bg-amber-500/15 border-transparent' },
  down: { label: 'Down', className: 'text-destructive bg-destructive/15 border-transparent' },
}

const DAYS = 90

export default function StatusPage() {
  const [uptime, setUptime] = useState<UptimeEndpoint[] | null>(null)
  const [maintenance, setMaintenance] = useState<StatusFlag[]>([])
  const [overall, setOverall] = useState<{ label: string; variant: 'default' | 'secondary' | 'destructive' }>({
    label: 'CHECKING…',
    variant: 'secondary',
  })

  useEffect(() => {
    let cancelled = false

    async function refresh() {
      try {
        const [uptimeRes, statusRes] = await Promise.all([
          fetch('/api/uptime', { cache: 'no-store' }),
          fetch('/api/status', { cache: 'no-store' }),
        ])
        if (cancelled) return
        if (uptimeRes.ok) {
          const data = (await uptimeRes.json()) as UptimeResponse
          setUptime(data.endpoints)
        }
        if (statusRes.ok) {
          const status = (await statusRes.json()) as {
            status: 'healthy' | 'degraded'
            maintenance?: StatusFlag[]
            outages?: string[]
          }
          setMaintenance(status.maintenance ?? [])
          setOverall(
            status.status === 'healthy'
              ? { label: 'OPERATIONAL', variant: 'default' }
              : status.outages?.length
                ? { label: 'DEGRADED', variant: 'secondary' }
                : { label: 'DEGRADED', variant: 'secondary' }
          )
        }
      } catch {
        if (!cancelled) setOverall({ label: 'UNREACHABLE', variant: 'destructive' })
      }
    }

    void refresh()
    // Cheap passive reads — a slow tick is fine, a busy loop is not.
    const id = setInterval(refresh, 60_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  // Only user-facing read services belong on the public board. Write
  // endpoints (broadcast, reports, suggestions), system probes, and
  // deprecated paths are admin-facing — showing them here is jargon for
  // riders and exposes API surface nobody needs to see.
  const visible = uptime
    ? uptime.filter((e) => e.method === 'GET' && e.group !== 'System' && e.group !== 'Deprecated')
    : []
  const groups = Array.from(new Set(visible.map((e) => e.group)))

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/busgo-logo-light-sm.png" alt="BusGo Track" className="h-14 w-auto" />
            <h1 className="text-xl font-bold tracking-tight">BusGo Track</h1>
            <Badge variant={overall.variant} className="font-bold">
              {overall.label}
            </Badge>
          </div>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Live status for BusGo Track — stops, schedules, and live bus updates across Kigali.
        </p>
        {maintenance.length > 0 && (
          <Alert className="mt-3 border-amber-500/40 bg-amber-500/10">
            <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
            <AlertTitle>Some services are temporarily unavailable</AlertTitle>
            <AlertDescription>
              We are carrying out maintenance right now and expect things back to normal shortly.
            </AlertDescription>
          </Alert>
        )}
      </header>

      {/* Uptime history — Render-style bars */}
      {uptime === null ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading uptime history…</Card>
      ) : (
        groups.map((group) => {
          const heading = GROUP_HEADINGS[group] ?? group
          return (
            <section key={group} className="mb-8">
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{heading}</h2>
                <span className="text-[10px] text-muted-foreground">
                  Uptime over the past {DAYS} days · {heading.toLowerCase()}
                </span>
              </div>
              <Card className="overflow-hidden gap-0 py-0">
                {visible
                  .filter((e) => e.group === group)
                  .map((ep, i, arr) => (
                    <div
                      key={ep.id}
                      className={`px-4 py-3 ${i < arr.length - 1 ? 'border-b border-border' : ''}`}
                    >
                      <div className="mb-1.5 flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{ep.title}</p>
                          <p className="truncate text-xs text-muted-foreground">{ep.description}</p>
                        </div>
                        {ep.last && (
                          <Badge className={`shrink-0 text-[10px] font-bold ${LAST_BADGE[ep.last].className}`}>
                            {LAST_BADGE[ep.last].label}
                          </Badge>
                        )}
                      </div>
                      <UptimeBars buckets={ep.buckets} uptimePct={ep.uptimePct} />
                    </div>
                  ))}
              </Card>
              {/* Axis — all rows above share the same window. */}
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                <span>{DAYS} days ago</span>
                <span>Today</span>
              </div>
            </section>
          )
        })
      )}

      <footer className="mt-10 text-center text-xs text-muted-foreground">
        BusGo Track · Live transit data for Kigali, Rwanda
      </footer>
    </main>
  )
}
