'use client'

/**
 * components/admin/load-panel.tsx — the "Load" section of the admin console.
 *
 * Polls /api/admin/metrics (admin-gated, in-memory RequestMetrics ring) every
 * 10 s and renders the live picture: overall request rate, latency
 * percentiles, rate-limit trips, SSE connections, and the TTL-cache hit rate,
 * plus a per-endpoint breakdown sorted by request count.
 *
 * Isolated as its own client component (same reason as SseMonitor) so its
 * polling tick never re-renders the rest of the dashboard.
 */

import { useEffect, useState } from 'react'
import { Activity, Database, Gauge, Radio, RefreshCw, ShieldAlert, Timer } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

interface LoadAlert {
  kind: 'requests_per_min' | 'rate_limited'
  severity: 'warn' | 'critical'
  value: number
  threshold: number
  state: 'triggered' | 'resolved'
  at: number
}

interface MetricsGroup {
  group: string
  requests: number
  requestsPerMin: number
  status2xx: number
  status3xx: number
  status4xx: number
  status5xx: number
  rateLimited: number
  p50Ms: number
  p95Ms: number
  avgMs: number
  lastSeen: number
}

interface LoadMetrics {
  windowSeconds: number
  generatedAt: string
  uptimeSeconds: number
  totals: {
    requests: number
    requestsPerMin: number
    status2xx: number
    status3xx: number
    status4xx: number
    status5xx: number
    rateLimited: number
    p50Ms: number
    p95Ms: number
    avgMs: number
  }
  sse: { active: number; max: number }
  cache: { hits: number; misses: number; entries: number; redisHits: number; hitRate: number }
  redis: { connected: boolean; pubsub?: { attached: boolean; channels: string[] } }
  alerts: { active: LoadAlert[]; recent: LoadAlert[] }
  groups: MetricsGroup[]
}

const POLL_MS = 10_000

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(Math.round(n))
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function alertLabel(a: LoadAlert): string {
  const name = a.kind === 'requests_per_min' ? 'Request rate' : 'Rate-limit trips'
  return `${name} at ${fmt(a.value)} (threshold ${fmt(a.threshold)})`
}

function fmtUptime(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function SummaryTile({
  icon,
  label,
  value,
  sub,
  tone = 'default',
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  sub?: string
  tone?: 'default' | 'warn' | 'good'
}) {
  const toneCls =
    tone === 'warn'
      ? 'text-amber-500 dark:text-amber-400'
      : tone === 'good'
        ? 'text-green-500 dark:text-green-400'
        : 'text-foreground'
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
        <p className={`font-mono text-lg leading-tight tabular-nums tracking-tight ${toneCls}`}>{value}</p>
        {sub ? <p className="mt-0.5 truncate text-[11px] text-muted-foreground/80">{sub}</p> : null}
      </div>
    </div>
  )
}

export default function LoadPanel() {
  const [metrics, setMetrics] = useState<LoadMetrics | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const res = await fetch('/api/admin/metrics', { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data: LoadMetrics = await res.json()
        if (!cancelled) {
          setMetrics(data)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load metrics')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    const id = setInterval(load, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const totals = metrics?.totals
  const cache = metrics?.cache
  const sse = metrics?.sse
  const redis = metrics?.redis
  const alerts = metrics?.alerts

  return (
    <section>
      {/* Active load alerts — the console's "something is happening" signal */}
      {alerts && alerts.active.length > 0 ? (
        <Card
          className={`mb-4 gap-0 border py-0 ${
            alerts.active.some((a) => a.severity === 'critical')
              ? 'border-red-500/40 bg-red-500/10'
              : 'border-amber-500/40 bg-amber-500/10'
          }`}
        >
          {alerts.active.map((a) => (
            <div
              key={a.kind}
              className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 ${
                a.severity === 'critical' ? 'text-red-500 dark:text-red-400' : 'text-amber-500 dark:text-amber-400'
              }`}
            >
              <ShieldAlert className="size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold">Load alert — {alertLabel(a)}</p>
                <p className="text-[11px] opacity-80">
                  {a.severity === 'critical' ? 'Critical' : 'Warning'} · triggered {fmtTime(a.at)} · still over
                  threshold on the last poll
                </p>
              </div>
              <Badge
                className={`font-mono text-[10px] tabular-nums border-transparent ${
                  a.severity === 'critical'
                    ? 'bg-red-500/15 text-red-500'
                    : 'bg-amber-500/15 text-amber-500'
                }`}
              >
                {a.severity === 'critical' ? 'critical' : 'warn'}
              </Badge>
            </div>
          ))}
        </Card>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          Live request load for the last {metrics ? Math.round(metrics.windowSeconds / 60) : 5} min — requests are
          counted in middleware, statuses and latency by the route handlers. Polls every 10 s.
        </p>
        {metrics ? (
          <>
            <Badge
              className={`gap-1.5 font-mono text-[11px] tabular-nums ${
                redis?.connected ? 'text-green-500 dark:text-green-400 bg-green-500/15 border-transparent' : 'text-muted-foreground'
              }`}
            >
              <Database className="size-3" />
              redis {redis?.connected ? `shared${redis?.pubsub?.attached ? ' · pub/sub' : ''}` : 'memory-only'}
            </Badge>
            <Badge variant="outline" className="gap-1.5 font-mono text-[11px] tabular-nums text-muted-foreground">
              <Activity className="size-3" />
              up {fmtUptime(metrics.uptimeSeconds)}
            </Badge>
          </>
        ) : null}
      </div>

      {error && !metrics ? (
        <Card className="p-8 text-center">
          <p className="text-sm font-semibold text-destructive">Can&apos;t reach /api/admin/metrics</p>
          <p className="mx-auto mt-1 max-w-[45ch] text-xs text-muted-foreground">
            {error} — retrying automatically…
          </p>
        </Card>
      ) : null}

      {loading && !metrics ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : null}

      {metrics ? (
        <>
          {/* Summary — one divided panel, same language as the stat bar */}
          <Card className="mb-4 overflow-hidden gap-0 py-0">
            <div className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0">
              <SummaryTile
                icon={<Gauge className="size-4" />}
                label="Requests / min"
                value={totals!.requestsPerMin}
                sub={`${fmt(totals!.requests)} in window`}
                tone={totals!.requestsPerMin > 50 ? 'warn' : 'good'}
              />
              <SummaryTile
                icon={<Timer className="size-4" />}
                label="Latency p50 / p95"
                value={`${totals!.p50Ms} / ${totals!.p95Ms} ms`}
                sub={`avg ${totals!.avgMs} ms`}
              />
              <SummaryTile
                icon={<ShieldAlert className="size-4" />}
                label="Rate-limited (429)"
                value={fmt(totals!.rateLimited)}
                sub={`${fmt(totals!.status4xx)} 4xx · ${fmt(totals!.status5xx)} 5xx`}
                tone={totals!.rateLimited > 0 ? 'warn' : 'default'}
              />
              <SummaryTile
                icon={<Radio className="size-4" />}
                label="SSE connections"
                value={`${sse!.active} / ${sse!.max}`}
                tone={sse!.active > sse!.max * 0.8 ? 'warn' : 'good'}
              />
              <SummaryTile
                icon={<Database className="size-4" />}
                label="Cache hit rate"
                value={`${Math.round((cache!.hitRate || 0) * 100)}%`}
                sub={`${fmt(cache!.hits)} mem · ${fmt(cache!.redisHits)} redis · ${fmt(cache!.misses)} misses · ${cache!.entries} keys`}
                tone={cache!.hitRate > 0.5 ? 'good' : 'default'}
              />
            </div>
          </Card>

          {/* Per-endpoint breakdown */}
          <Card className="overflow-hidden gap-0 py-0">
            <div className="border-b border-border px-4 py-2.5">
              <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Endpoints by load
              </p>
            </div>
            {metrics.groups.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm font-semibold text-muted-foreground">No traffic in this window</p>
                <p className="mx-auto mt-1 max-w-[45ch] text-xs text-muted-foreground/80">
                  Requests will appear here as riders hit the API. The read-only probe sweep counts too.
                </p>
              </div>
            ) : (
              metrics.groups.map((g, i) => {
                const total = g.status2xx + g.status3xx + g.status4xx + g.status5xx
                const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0)
                return (
                  <div
                    key={g.group}
                    className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 ${
                      i < metrics.groups.length - 1 ? 'border-b border-border' : ''
                    }`}
                  >
                    <div className="min-w-0 w-44 shrink-0">
                      <p className="truncate font-mono text-xs tabular-nums">{g.group}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {g.requestsPerMin} req/min
                      </p>
                    </div>
                    {/* Status mini-bar — 2xx / 4xx / 5xx proportional */}
                    <div className="flex h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-green-500/80 transition-all"
                        style={{ width: `${pct(g.status2xx + g.status3xx)}%` }}
                      />
                      <div
                        className="h-full bg-amber-500/80 transition-all"
                        style={{ width: `${pct(g.status4xx)}%` }}
                      />
                      <div
                        className="h-full bg-red-500/80 transition-all"
                        style={{ width: `${pct(g.status5xx)}%` }}
                      />
                    </div>
                    <span className="w-20 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                      {g.p50Ms}/{g.p95Ms} ms
                    </span>
                    {g.rateLimited > 0 ? (
                      <Badge className="bg-amber-500/15 font-mono text-[10px] tabular-nums text-amber-500 border-transparent">
                        {g.rateLimited}× 429
                      </Badge>
                    ) : (
                      <span className="w-14 shrink-0" />
                    )}
                  </div>
                )
              })
            )}
          </Card>

          {/* Recent alert episodes — triggered + resolved, newest first */}
          {alerts && alerts.recent.length > 0 ? (
            <Card className="mt-4 overflow-hidden gap-0 py-0">
              <div className="border-b border-border px-4 py-2.5">
                <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Recent load alerts
                </p>
              </div>
              {alerts.recent.slice(0, 8).map((a, i) => (
                <div
                  key={`${a.kind}-${a.at}-${i}`}
                  className={`flex items-center gap-3 px-4 py-2 ${
                    i < Math.min(alerts.recent.length, 8) - 1 ? 'border-b border-border' : ''
                  }`}
                >
                  {a.state === 'triggered' ? (
                    <ShieldAlert
                      className={`size-3.5 shrink-0 ${
                        a.severity === 'critical' ? 'text-red-500' : 'text-amber-500'
                      }`}
                    />
                  ) : (
                    <span className="ml-1.5 mr-1 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs">
                      <span className="font-semibold">{a.state === 'triggered' ? 'Triggered' : 'Resolved'}</span>{' '}
                      · {alertLabel(a)}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                    {fmtTime(a.at)}
                  </span>
                </div>
              ))}
            </Card>
          ) : null}

          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
            <RefreshCw className="size-3" />
            Live — refreshes every 10 s while this section is open.
          </p>
        </>
      ) : null}
    </section>
  )
}
