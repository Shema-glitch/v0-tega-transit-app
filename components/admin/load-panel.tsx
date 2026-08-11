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
import { ArrowsClockwise, Database, Gauge, Pulse, Radio, ShieldWarning, Timer } from '@phosphor-icons/react'
import { Line, LineChart, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface LoadAlert {
  kind: 'requests_per_min' | 'rate_limited'
  severity: 'warn' | 'critical'
  value: number
  threshold: number
  state: 'triggered' | 'resolved'
  at: number
}

interface LatencyHistoryPoint {
  t: number
  count: number
  p50Ms: number | null
  p95Ms: number | null
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
  history: LatencyHistoryPoint[]
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

/** Compact p50/p95 latency sparkline for one endpoint (30-minute window). */
function LatencySparkline({ points }: { points?: LatencyHistoryPoint[] }) {
  // Defensive: a stale server instance (pre-deploy or mid-rollout) may omit
  // the history field — treat it as "no data yet" instead of crashing.
  const series = points ?? []
  const hasData = series.some((p) => p.count > 0)
  if (!hasData) {
    return <p className="text-xs text-muted-foreground/70">no latency data</p>
  }
  return (
    <div className="h-10 w-36">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series} margin={{ top: 3, right: 2, bottom: 3, left: 2 }}>
          <RechartsTooltip
            cursor={{ stroke: 'rgba(148,163,184,0.35)', strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null
              const p = payload[0].payload as LatencyHistoryPoint
              return (
                <div className="rounded-md border bg-popover px-2 py-1.5 text-xs shadow-md">
                  <p className="font-mono text-muted-foreground">{fmtTime(p.t)}</p>
                  <p className="font-mono tabular-nums">
                    p50 <span className="text-success">{p.p50Ms === null ? '—' : `${p.p50Ms} ms`}</span>
                    <span className="text-muted-foreground"> · </span>
                    p95 <span className="text-warning">{p.p95Ms === null ? '—' : `${p.p95Ms} ms`}</span>
                  </p>
                  {p.count === 0 ? <p className="text-muted-foreground">no traffic</p> : null}
                </div>
              )
            }}
          />
          <Line
            type="monotone"
            dataKey="p50Ms"
            stroke="var(--success)"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey="p95Ms"
            stroke="var(--warning)"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
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
      ? 'text-warning'
      : tone === 'good'
        ? 'text-success'
        : 'text-foreground'
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className={`font-mono text-lg leading-tight tabular-nums tracking-tight ${toneCls}`}>{value}</p>
        {sub ? <p className="mt-0.5 truncate text-xs text-muted-foreground/80">{sub}</p> : null}
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
              ? 'border-danger/40 bg-danger/10'
              : 'border-warning/40 bg-warning/10'
          }`}
        >
          {alerts.active.map((a) => (
            <div
              key={a.kind}
              className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 ${
                a.severity === 'critical' ? 'text-danger' : 'text-warning'
              }`}
            >
              <ShieldWarning className="size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold">Load alert — {alertLabel(a)}</p>
                <p className="text-xs opacity-80">
                  {a.severity === 'critical' ? 'Critical' : 'Warning'} · triggered {fmtTime(a.at)} · still over
                  threshold on the last poll
                </p>
              </div>
              <Badge
                className={`font-mono text-xs tabular-nums border-transparent ${
                  a.severity === 'critical'
                    ? 'bg-danger/10 text-danger'
                    : 'bg-warning/10 text-warning'
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
              className={`gap-1.5 font-mono text-xs tabular-nums ${
                redis?.connected ? 'text-success bg-success/10 border-transparent' : 'text-muted-foreground'
              }`}
            >
              <Database className="size-3" />
              redis {redis?.connected ? `shared${redis?.pubsub?.attached ? ' · pub/sub' : ''}` : 'memory-only'}
            </Badge>
            <Badge variant="outline" className="gap-1.5 font-mono text-xs tabular-nums text-muted-foreground">
              <Pulse className="size-3" />
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
                icon={<ShieldWarning className="size-4" />}
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Requests</TableHead>
                  <TableHead className="w-[30%]">Status mix</TableHead>
                  <TableHead className="text-right">Latency p50 / p95</TableHead>
                  <TableHead>30-min trend</TableHead>
                  <TableHead className="text-right">429</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {metrics.groups.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center">
                      <p className="text-sm font-semibold text-muted-foreground">No traffic in this window</p>
                      <p className="mx-auto mt-1 max-w-[45ch] text-xs text-muted-foreground/80">
                        Requests will appear here as riders hit the API. The read-only probe sweep counts too.
                      </p>
                    </TableCell>
                  </TableRow>
                ) : (
                  metrics.groups.map((g) => {
                    const total = g.status2xx + g.status3xx + g.status4xx + g.status5xx
                    const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0)
                    return (
                      <TableRow key={g.group}>
                        <TableCell>
                          <p className="truncate font-mono text-xs tabular-nums">{g.group}</p>
                          <p className="text-xs text-muted-foreground">{g.requestsPerMin} req/min</p>
                        </TableCell>
                        <TableCell className="font-mono text-xs tabular-nums">{fmt(g.requests)}</TableCell>
                        {/* Status mini-bar — 2xx / 4xx / 5xx proportional */}
                        <TableCell>
                          <div className="flex h-1.5 min-w-24 max-w-56 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full bg-success/80 transition-[width]"
                              style={{ width: `${pct(g.status2xx + g.status3xx)}%` }}
                            />
                            <div
                              className="h-full bg-warning/80 transition-[width]"
                              style={{ width: `${pct(g.status4xx)}%` }}
                            />
                            <div
                              className="h-full bg-danger/80 transition-[width]"
                              style={{ width: `${pct(g.status5xx)}%` }}
                            />
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                          {g.p50Ms}/{g.p95Ms} ms
                        </TableCell>
                        <TableCell>
                          <LatencySparkline points={g.history} />
                        </TableCell>
                        <TableCell className="text-right">
                          {g.rateLimited > 0 ? (
                            <Badge className="border-transparent bg-warning/10 font-mono text-xs tabular-nums text-warning">
                              {g.rateLimited}×
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </Card>

          {/* Recent alert episodes — triggered + resolved, newest first */}
          {alerts && alerts.recent.length > 0 ? (
            <Card className="mt-4 overflow-hidden gap-0 py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>State</TableHead>
                    <TableHead>Alert</TableHead>
                    <TableHead className="text-right">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alerts.recent.slice(0, 8).map((a, i) => (
                    <TableRow key={`${a.kind}-${a.at}-${i}`}>
                      <TableCell>
                        {a.state === 'triggered' ? (
                          <ShieldWarning
                            className={`size-3.5 ${
                              a.severity === 'critical' ? 'text-danger' : 'text-warning'
                            }`}
                          />
                        ) : (
                          <span className="ml-1 mr-1 inline-block size-1.5 rounded-full bg-muted-foreground/50" />
                        )}
                      </TableCell>
                      <TableCell className="truncate text-xs">
                        <span className="font-semibold">{a.state === 'triggered' ? 'Triggered' : 'Resolved'}</span>
                        <span className="text-muted-foreground"> · {alertLabel(a)}</span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {fmtTime(a.at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          ) : null}

          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground/80">
            <ArrowsClockwise className="size-3" />
            Live — refreshes every 10 s while this section is open.
          </p>
        </>
      ) : null}
    </section>
  )
}
