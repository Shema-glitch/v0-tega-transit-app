'use client'

/**
 * The real admin dashboard — see docs/ADMIN_DASHBOARD_PRD.md.
 *
 * Separate from the public status page (/) on purpose: this one requires
 * the admin token to even load, and does things that actually change
 * production behavior (disabling an endpoint returns real 503s — see
 * middleware.ts + lib/api/endpoint-registry.ts). The public page stays a
 * lightweight, unauthenticated "is it up" view for anyone.
 *
 * Styling reuses BusGo Track's own claymorphism tokens (app/tega-clay-tokens.css,
 * loaded globally via globals.css) instead of a second bespoke palette — same
 * look, forced into dark mode via the `.dark` class since this is a "checking
 * in at 11pm mid-incident" tool, not a bright daytime page. shadcn/ui
 * components (components/ui/*) are wired onto those same tokens (see
 * app/globals.css) so there's one design system, not two.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { ENDPOINT_REGISTRY } from '@/lib/api/endpoint-registry'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const STATUS_COLOR = {
  good: 'var(--color-success)',
  warn: 'var(--color-warning)',
  err: 'var(--color-error)',
  accent: 'var(--clay-teal)',
  dim: 'var(--color-text-muted)',
} as const

// Restarts reset every in-memory maintenance flag with no trace (they don't
// persist — see lib/api/maintenance-store.ts). A process younger than this
// gets a one-time nudge so that's a visible surprise, not a silent one.
const RECENT_RESTART_MS = 10 * 60 * 1000
const LAST_SEEN_KEY = 'admin-last-seen'

// Mirrors lib/api/error-log.ts ErrorEntry.
interface ErrorEntry {
  path: string
  method: string
  status: number
  message: string
  details?: string
  count: number
  firstAt: number
  lastAt: number
}

// Mirrors lib/api/bug-reports.ts BugReport.
interface BugReportEntry {
  id: string
  subject: string
  message: string
  pageUrl?: string
  userAgent?: string
  status: 'open' | 'resolved'
  createdAt: number
}

// Mirrors lib/api/maintenance-store.ts MaintenanceFlag.
interface MaintenanceFlag {
  feature: string
  reason: string
  since: number
}

type IssueKind = 'error' | 'bug'

interface IssueItem {
  kind: IssueKind
  id: string
  title: string
  detail: string
  meta?: string
  count?: number
  resolved: boolean
  timestamp: number
  onResolve?: () => void
}

function timeAgo(ms: number, now: number): string {
  const sec = Math.floor((now - ms) / 1000)
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

/** Renders as a clickable link if it looks like a URL, plain text otherwise. */
function PageUrlLink({ url }: { url: string }) {
  let isUrl = false
  try {
    isUrl = /^https?:\/\//i.test(url)
  } catch { /* not a url */ }

  if (!isUrl) return <span>{url}</span>
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2 hover:opacity-80"
      style={{ color: STATUS_COLOR.accent }}
    >
      {url}
    </a>
  )
}

export default function AdminPage() {
  const [authState, setAuthState] = useState<'checking' | 'out' | 'in'>('checking')
  const [tokenInput, setTokenInput] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const [errors, setErrors] = useState<ErrorEntry[]>([])
  const [bugReports, setBugReports] = useState<BugReportEntry[]>([])
  const [maintenance, setMaintenance] = useState<MaintenanceFlag[]>([])
  const [processStartedAt, setProcessStartedAt] = useState<number | null>(null)
  const [source, setSource] = useState<{ errors: 'supabase' | 'memory'; bugs: 'supabase' | 'memory' }>({
    errors: 'memory',
    bugs: 'memory',
  })

  const [tab, setTab] = useState<'issues' | 'endpoints'>('issues')
  const [issueFilter, setIssueFilter] = useState<'all' | 'errors' | 'bugs' | 'open'>('open')
  const [query, setQuery] = useState('')

  // Captured once on login — "since you last looked" compares against this,
  // not the live-updating localStorage value (which we overwrite right away).
  const lastSeenAtRef = useRef<number | null>(null)

  const authHeaders = useCallback((): Record<string, string> => {
    const token = sessionStorage.getItem('admin-token') || ''
    return { 'x-admin-token': token }
  }, [])

  const refreshAll = useCallback(async () => {
    const headers = authHeaders()
    try {
      const [errRes, bugRes, maintRes] = await Promise.all([
        fetch('/api/errors', { cache: 'no-store' }),
        fetch('/api/feedback', { cache: 'no-store', headers }),
        fetch('/api/admin/maintenance', { cache: 'no-store' }),
      ])
      if (bugRes.status === 401) {
        sessionStorage.removeItem('admin-token')
        setAuthState('out')
        return
      }
      const errData = await errRes.json()
      const bugData = await bugRes.json()
      const maintData = await maintRes.json()
      setErrors(errData.errors ?? [])
      setBugReports(bugData.reports ?? [])
      setMaintenance(maintData.flags ?? [])
      if (typeof maintData.processStartedAt === 'number') setProcessStartedAt(maintData.processStartedAt)
      setSource({
        errors: errData.source === 'supabase' ? 'supabase' : 'memory',
        bugs: bugData.source === 'supabase' ? 'supabase' : 'memory',
      })
    } catch { /* transient network hiccup — next 15s poll will retry */ }
  }, [authHeaders])

  const login = useCallback(async () => {
    if (!tokenInput.trim()) return
    setLoginError(null)
    try {
      const res = await fetch('/api/admin/verify', { headers: { 'x-admin-token': tokenInput.trim() } })
      if (!res.ok) {
        setLoginError('Wrong admin token.')
        return
      }
      sessionStorage.setItem('admin-token', tokenInput.trim())
      setAuthState('in')
    } catch {
      setLoginError('Could not reach the API — try again.')
    }
  }, [tokenInput])

  const logout = useCallback(() => {
    sessionStorage.removeItem('admin-token')
    setAuthState('out')
    setTokenInput('')
  }, [])

  const clearErrors = useCallback(async () => {
    await fetch('/api/errors', { method: 'DELETE', headers: authHeaders() })
    refreshAll()
  }, [authHeaders, refreshAll])

  const clearBugReports = useCallback(async () => {
    await fetch('/api/feedback', { method: 'DELETE', headers: authHeaders() })
    refreshAll()
  }, [authHeaders, refreshAll])

  const resolveBugReport = useCallback(async (id: string) => {
    await fetch('/api/feedback', {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    refreshAll()
  }, [authHeaders, refreshAll])

  const toggleEndpoint = useCallback(async (id: string, currentlyDisabled: boolean) => {
    let reason = 'Under maintenance'
    if (!currentlyDisabled) {
      reason = window.prompt(`Reason for disabling ${id}:`, 'Investigating an issue') || 'Under maintenance'
    }
    await fetch('/api/admin/maintenance', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ feature: id, reason, active: !currentlyDisabled }),
    })
    refreshAll()
  }, [authHeaders, refreshAll])

  // Check for a stored token on load.
  useEffect(() => {
    const stored = sessionStorage.getItem('admin-token')
    if (!stored) {
      setAuthState('out')
      return
    }
    fetch('/api/admin/verify', { headers: { 'x-admin-token': stored } })
      .then((res) => {
        if (res.ok) setAuthState('in')
        else {
          sessionStorage.removeItem('admin-token')
          setAuthState('out')
        }
      })
      .catch(() => setAuthState('out'))
  }, [])

  // Capture "last seen" once per login, before overwriting it — everything
  // after this point compares against the moment THIS visit started.
  useEffect(() => {
    if (authState !== 'in') return
    const prev = localStorage.getItem(LAST_SEEN_KEY)
    lastSeenAtRef.current = prev ? Number(prev) : null
    localStorage.setItem(LAST_SEEN_KEY, String(Date.now()))
  }, [authState])

  useEffect(() => {
    if (authState !== 'in') return
    refreshAll()
    const id = setInterval(refreshAll, 15_000)
    return () => clearInterval(id)
  }, [authState, refreshAll])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const issues: IssueItem[] = useMemo(() => {
    const errorItems: IssueItem[] = errors.map((e) => ({
      kind: 'error',
      id: `err-${e.path}-${e.status}-${e.message}`,
      title: `${e.status} · ${e.method} ${e.path}`,
      detail: e.message + (e.details ? `\n${e.details}` : ''),
      count: e.count,
      resolved: false,
      timestamp: e.lastAt,
    }))
    const bugItems: IssueItem[] = bugReports.map((r) => ({
      kind: 'bug',
      id: `bug-${r.id}`,
      title: r.subject,
      detail: r.message,
      meta: r.pageUrl,
      resolved: r.status === 'resolved',
      timestamp: r.createdAt,
      onResolve: () => resolveBugReport(r.id),
    }))
    return [...errorItems, ...bugItems].sort((a, b) => b.timestamp - a.timestamp)
  }, [errors, bugReports, resolveBugReport])

  const filteredIssues = useMemo(() => {
    let list = issues
    if (issueFilter === 'errors') list = list.filter((i) => i.kind === 'error')
    else if (issueFilter === 'bugs') list = list.filter((i) => i.kind === 'bug')
    else if (issueFilter === 'open') list = list.filter((i) => !i.resolved)

    if (query.trim()) {
      const q = query.trim().toLowerCase()
      list = list.filter((i) => i.title.toLowerCase().includes(q) || i.detail.toLowerCase().includes(q))
    }
    return list
  }, [issues, issueFilter, query])

  const openCount = issues.filter((i) => !i.resolved).length
  const disabledIds = new Set(maintenance.map((f) => f.feature))
  const disabledCount = ENDPOINT_REGISTRY.filter((e) => disabledIds.has(e.id)).length
  const isAllClear = issueFilter === 'open' && !query.trim() && openCount === 0

  const overallStatus = disabledCount > 0
    ? { label: 'Endpoints disabled', variant: 'warn' as const }
    : openCount > 0
      ? { label: 'Open issues', variant: 'warn' as const }
      : { label: 'All clear', variant: 'good' as const }

  const processUptimeMs = processStartedAt ? now - processStartedAt : null
  const showRestartNudge = processUptimeMs !== null && processUptimeMs < RECENT_RESTART_MS

  // ─── Login screen ─────────────────────────────────────────────────────────
  if (authState !== 'in') {
    return (
      <div
        className="dark flex min-h-screen items-center justify-center px-4"
        style={{ background: 'var(--color-bg-canvas)', color: 'var(--color-text-primary)' }}
      >
        <Card className="w-full max-w-sm p-6">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-lg" style={{ color: STATUS_COLOR.accent }}>▍</span>
            <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>BusGo Track — Admin</h1>
          </div>
          <p className="mb-5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            {authState === 'checking' ? 'Checking for a saved session…' : 'Enter the ADMIN_TOKEN configured on Render.'}
          </p>
          <Input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') login() }}
            placeholder="Admin token"
            className="mb-3 h-11 text-sm"
            autoFocus
          />
          {loginError && <p className="mb-3 text-xs" style={{ color: STATUS_COLOR.err }}>{loginError}</p>}
          <Button onClick={login} className="h-11 w-full justify-center text-sm">
            Sign in
          </Button>
          <p className="mt-4 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            <a href="/" style={{ color: STATUS_COLOR.accent }}>← back to the public status page</a>
          </p>
        </Card>
      </div>
    )
  }

  // ─── Dashboard ─────────────────────────────────────────────────────────────
  return (
    <div className="dark min-h-screen" style={{ background: 'var(--color-bg-canvas)', color: 'var(--color-text-primary)' }}>
      <header className="border-b px-4 py-4 sm:px-6" style={{ borderColor: 'var(--color-border-subtle)', background: 'var(--color-bg-surface)' }}>
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <span className="text-xl" style={{ color: STATUS_COLOR.accent }}>▍</span>
            <h1 className="text-base font-bold sm:text-lg" style={{ fontFamily: 'var(--font-display)' }}>BusGo Track — Admin</h1>
            <Badge
              variant="outline"
              className="font-semibold"
              style={{
                color: overallStatus.variant === 'good' ? STATUS_COLOR.good : STATUS_COLOR.warn,
                borderColor: 'transparent',
                background: `color-mix(in srgb, ${overallStatus.variant === 'good' ? STATUS_COLOR.good : STATUS_COLOR.warn} 18%, transparent)`,
              }}
            >
              {overallStatus.label}
            </Badge>
          </div>
          <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            <a href="/" style={{ color: 'var(--color-text-secondary)' }}>public status page</a>
            <Button onClick={logout} variant="outline" size="lg" className="h-11 text-xs">
              Log out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        {showRestartNudge && (
          <Alert className="mb-4" style={{ borderColor: STATUS_COLOR.warn, background: `color-mix(in srgb, ${STATUS_COLOR.warn} 10%, transparent)` }}>
            <AlertTriangle className="size-4" style={{ color: STATUS_COLOR.warn }} />
            <AlertTitle style={{ color: 'var(--color-text-primary)' }}>Process restarted recently</AlertTitle>
            <AlertDescription style={{ color: 'var(--color-text-primary)' }}>
              This process started {timeAgo(processStartedAt!, now)} — maintenance flags live in memory only, so a
              restart silently re-enables everything that was disabled before it. Double-check the Endpoints tab if
              you were mid-incident.
            </AlertDescription>
          </Alert>
        )}

        {/* Stat bar */}
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card className="p-4">
            <div className="text-2xl font-bold" style={{ color: openCount > 0 ? STATUS_COLOR.warn : STATUS_COLOR.good }}>{openCount}</div>
            <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Open issues</div>
          </Card>
          <Card className="p-4">
            <div className="text-2xl font-bold" style={{ color: disabledCount > 0 ? STATUS_COLOR.warn : 'var(--color-text-primary)' }}>{disabledCount}</div>
            <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Endpoints disabled</div>
          </Card>
          <Card className="p-4">
            <div className="text-2xl font-bold">{bugReports.length}</div>
            <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Total bug reports</div>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'issues' | 'endpoints')}>
          <TabsList variant="line" className="mb-4 h-auto w-full justify-start gap-1 border-b p-0" style={{ borderColor: 'var(--color-border-subtle)' }}>
            <TabsTrigger value="issues" className="h-11 rounded-none px-4 text-sm font-semibold capitalize data-active:after:bg-(--clay-teal)">
              Issues
            </TabsTrigger>
            <TabsTrigger value="endpoints" className="h-11 rounded-none px-4 text-sm font-semibold capitalize data-active:after:bg-(--clay-teal)">
              Endpoints
            </TabsTrigger>
          </TabsList>

          <TabsContent value="issues">
            <section>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <ToggleGroup
                  value={[issueFilter]}
                  onValueChange={(vals) => {
                    const next = vals[0] as typeof issueFilter | undefined
                    if (next) setIssueFilter(next)
                  }}
                  variant="outline"
                  className="flex-wrap overflow-x-auto rounded-lg border p-1"
                  style={{ borderColor: 'var(--color-border-subtle)' }}
                >
                  {(['open', 'all', 'errors', 'bugs'] as const).map((f) => (
                    <ToggleGroupItem
                      key={f}
                      value={f}
                      className="h-9 min-h-9 whitespace-nowrap rounded px-2.5 text-xs font-semibold capitalize"
                    >
                      {f}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search path, message, subject…"
                  className="h-11 min-w-0 flex-1 text-xs"
                />
                <Button onClick={clearErrors} variant="destructive" size="sm" className="h-11 text-xs">
                  Clear errors
                </Button>
                <Button onClick={clearBugReports} variant="destructive" size="sm" className="h-11 text-xs">
                  Clear bug reports
                </Button>
              </div>

              {filteredIssues.length === 0 && isAllClear && (
                <div className="flex flex-col items-center gap-2 py-16 text-center">
                  <CheckCircle2 className="size-10" style={{ color: STATUS_COLOR.good }} />
                  <p className="text-sm font-semibold">All clear</p>
                  <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    No open errors or bug reports. This is what a routine check should look like.
                  </p>
                </div>
              )}
              {filteredIssues.length === 0 && !isAllClear && (
                <p className="py-8 text-center text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  Nothing matches this filter.
                </p>
              )}

              <div className="space-y-2">
                {filteredIssues.map((item) => {
                  const isNew = lastSeenAtRef.current !== null && item.timestamp > lastSeenAtRef.current
                  return (
                    <Card
                      key={item.id}
                      className="p-3"
                      style={{ opacity: item.resolved ? 0.55 : 1 }}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          className="font-semibold"
                          style={{
                            color: item.kind === 'error' ? STATUS_COLOR.err : STATUS_COLOR.accent,
                            background: `color-mix(in srgb, ${item.kind === 'error' ? STATUS_COLOR.err : STATUS_COLOR.accent} 18%, transparent)`,
                          }}
                        >
                          {item.kind === 'error' ? 'ERROR' : 'BUG'}
                        </Badge>
                        {isNew && (
                          <Badge
                            className="font-semibold"
                            style={{ color: STATUS_COLOR.accent, background: `color-mix(in srgb, ${STATUS_COLOR.accent} 18%, transparent)` }}
                          >
                            since you last looked
                          </Badge>
                        )}
                        <span className="font-mono text-xs font-semibold">{item.title}</span>
                        <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{timeAgo(item.timestamp, now)}</span>
                        {item.count && item.count > 1 && (
                          <Badge
                            className="font-semibold"
                            style={{ color: STATUS_COLOR.warn, background: `color-mix(in srgb, ${STATUS_COLOR.warn} 18%, transparent)` }}
                          >
                            ×{item.count}
                          </Badge>
                        )}
                        {item.resolved && (
                          <Badge
                            className="font-semibold"
                            style={{ color: STATUS_COLOR.dim, background: `color-mix(in srgb, ${STATUS_COLOR.dim} 18%, transparent)` }}
                          >
                            resolved
                          </Badge>
                        )}
                        {item.onResolve && !item.resolved && (
                          <Button
                            onClick={item.onResolve}
                            variant="outline"
                            size="sm"
                            className="ml-auto h-9 text-xs"
                            style={{ color: STATUS_COLOR.good }}
                          >
                            Mark resolved
                          </Button>
                        )}
                      </div>
                      <div className="mt-1.5 whitespace-pre-wrap text-xs" style={{ color: 'var(--color-text-primary)' }}>{item.detail}</div>
                      {item.meta && (
                        <div className="mt-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                          from: <PageUrlLink url={item.meta} />
                        </div>
                      )}
                    </Card>
                  )
                })}
              </div>

              <p className="mt-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                Errors: {source.errors === 'supabase' ? 'durable' : 'in-memory only'} · Bug reports: {source.bugs === 'supabase' ? 'durable' : 'in-memory only'} · auto-refreshes every 15s.
              </p>
            </section>
          </TabsContent>

          <TabsContent value="endpoints">
            <section>
              <p className="mb-4 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                Disabling an endpoint here makes it actually return 503 to callers immediately — see docs/ADMIN_DASHBOARD_PRD.md.
                Meta endpoints (health, status, errors, feedback, admin/*) aren&apos;t listed — you can&apos;t disable the tools that turn things back on.
              </p>
              {Object.entries(
                ENDPOINT_REGISTRY.reduce<Record<string, typeof ENDPOINT_REGISTRY>>((acc, ep) => {
                  (acc[ep.group] ??= []).push(ep)
                  return acc
                }, {})
              ).map(([group, endpoints]) => (
                <div key={group} className="mb-5">
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-secondary)' }}>{group}</h3>
                  <Card className="overflow-hidden py-0">
                    {endpoints.map((ep, i) => {
                      const flag = maintenance.find((f) => f.feature === ep.id)
                      const disabled = !!flag
                      return (
                        <div
                          key={ep.id}
                          className="flex items-center gap-3 px-3 py-3"
                          style={{ borderBottom: i < endpoints.length - 1 ? '1px solid var(--color-border-subtle)' : undefined }}
                        >
                          {/* The visible switch stays small, but the tap target is
                              padded to the 44x44 minimum via the wrapping span so
                              the extra hit area doesn't shift layout. */}
                          <span className="-m-2 flex shrink-0 items-center rounded-full p-2">
                            <Switch
                              checked={!disabled}
                              onCheckedChange={() => toggleEndpoint(ep.id, disabled)}
                              className="data-checked:bg-(--color-success) data-unchecked:bg-(--color-error)"
                            />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className="rounded px-1.5 py-0.5 text-[10px] font-bold"
                                style={{ background: 'var(--color-border-medium)', color: 'var(--color-text-secondary)' }}
                              >
                                {ep.method}
                              </span>
                              <span className="truncate font-mono text-xs">{ep.label}</span>
                            </div>
                            {flag && (
                              <div className="mt-0.5 text-xs" style={{ color: STATUS_COLOR.warn }}>
                                Disabled: {flag.reason} · {timeAgo(flag.since, now)}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </Card>
                </div>
              ))}
            </section>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
