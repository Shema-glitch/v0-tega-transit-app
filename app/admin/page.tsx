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
 * Styling uses shadcn/ui's own default components and dark theme (see
 * app/globals.css) — no bespoke design-token system. Forced into dark mode
 * via the `.dark` class since this is a "checking in at 11pm mid-incident"
 * tool, not a bright daytime page.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Share2 } from 'lucide-react'
import { ENDPOINT_REGISTRY } from '@/lib/api/endpoint-registry'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

// shadcn's own theme doesn't ship semantic success/warning colors (only
// primary/destructive/muted/accent), so those two route through Tailwind's
// stock green/amber scale. Everything else uses shadcn's own tokens directly
// via className (text-primary, text-destructive, text-muted-foreground, …).
const STATUS_COLOR = {
  good: 'text-green-500 dark:text-green-400',
  warn: 'text-amber-500 dark:text-amber-400',
  err: 'text-destructive',
  accent: 'text-primary',
  dim: 'text-muted-foreground',
} as const

const STATUS_BADGE = {
  good: 'text-green-500 dark:text-green-400 bg-green-500/15 border-transparent',
  warn: 'text-amber-500 dark:text-amber-400 bg-amber-500/15 border-transparent',
  err: 'text-destructive bg-destructive/15 border-transparent',
  accent: 'text-primary bg-primary/15 border-transparent',
  dim: 'text-muted-foreground bg-muted border-transparent',
} as const

// Restarts reset every in-memory maintenance flag with no trace (they don't
// persist — see lib/api/maintenance-store.ts). A process younger than this
// gets a one-time nudge so that's a visible surprise, not a silent one.
const RECENT_RESTART_MS = 10 * 60 * 1000
const LAST_SEEN_KEY = 'admin-last-seen'

// The one link this dashboard hands out for sharing — a static, riders-only
// guide with no admin surface at all (see frontend/public/guide.html in the
// BusGo_Track repo). Deliberately NOT the same origin/path pattern as
// anything under /admin, so there's no way to fat-finger sharing the wrong
// link. Hardcoded rather than reading FRONTEND_ORIGIN: this points at the
// deployed frontend regardless of which origin the CORS allowlist is
// currently configured for, and middleware.ts's own fallback constant has a
// stray hyphen bug (bus-go-track vs the real busgo-track) that this avoids
// depending on.
const COMMUNITY_GUIDE_URL = 'https://busgo-track.vercel.app/guide.html'

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

// Mirrors lib/api/stop-suggestions.ts StopSuggestion.
interface StopSuggestionEntry {
  id: number
  type: 'add' | 'rename' | 'delete'
  stop_id: string | null
  proposed_name: string | null
  proposed_lat: number | null
  proposed_lon: number | null
  reason: string | null
  client_id: string | null
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
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
      className={`underline underline-offset-2 hover:opacity-80 ${STATUS_COLOR.accent}`}
    >
      {url}
    </a>
  )
}

function CopyGuideLinkButton() {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(COMMUNITY_GUIDE_URL)
    } catch {
      // Clipboard API can fail (permissions, insecure context) — the link
      // is still visible/clickable via the button's title, so this is a
      // degraded-but-not-broken outcome, not worth surfacing an error for.
      return
    }
    setCopied(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), 1800)
  }, [])

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  return (
    <Button
      onClick={copy}
      variant="outline"
      size="sm"
      className="h-9 gap-1.5 text-xs"
      title={COMMUNITY_GUIDE_URL}
    >
      <Share2 className="size-3.5" />
      {copied ? 'Copied!' : 'Copy community guide link'}
    </Button>
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
  const [stopSuggestions, setStopSuggestions] = useState<StopSuggestionEntry[]>([])
  const [processStartedAt, setProcessStartedAt] = useState<number | null>(null)
  const [source, setSource] = useState<{ errors: 'supabase' | 'memory'; bugs: 'supabase' | 'memory' }>({
    errors: 'memory',
    bugs: 'memory',
  })

  const [tab, setTab] = useState<'issues' | 'endpoints' | 'suggestions'>('issues')
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
      const [errRes, bugRes, maintRes, suggRes] = await Promise.all([
        fetch('/api/errors', { cache: 'no-store' }),
        fetch('/api/feedback', { cache: 'no-store', headers }),
        fetch('/api/admin/maintenance', { cache: 'no-store' }),
        fetch('/api/admin/stop-suggestions', { cache: 'no-store', headers }),
      ])
      if (bugRes.status === 401) {
        sessionStorage.removeItem('admin-token')
        setAuthState('out')
        return
      }
      const errData = await errRes.json()
      const bugData = await bugRes.json()
      const maintData = await maintRes.json()
      const suggData = await suggRes.json().catch(() => ({}))
      setErrors(errData.errors ?? [])
      setBugReports(bugData.reports ?? [])
      setMaintenance(maintData.flags ?? [])
      setStopSuggestions(suggData.suggestions ?? [])
      if (typeof maintData.processStartedAt === 'number') setProcessStartedAt(maintData.processStartedAt)
      setSource({
        errors: errData.source === 'supabase' ? 'supabase' : 'memory',
        bugs: bugData.source === 'supabase' ? 'supabase' : 'memory',
      })
    } catch { /* transient network hiccup — next 15s poll will retry */ }
  }, [authHeaders])

  const resolveStopSuggestion = useCallback(async (id: number, decision: 'approve' | 'reject') => {
    await fetch(`/api/admin/stop-suggestions/${id}`, {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    })
    refreshAll()
  }, [authHeaders, refreshAll])

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
      <div className="dark flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
        <Card className="w-full max-w-sm p-6">
          <div className="mb-1 flex items-center gap-2">
            <span className={`text-lg ${STATUS_COLOR.accent}`}>▍</span>
            <h1 className="text-lg font-bold font-heading">BusGo Track — Admin</h1>
          </div>
          <p className="mb-5 text-xs text-muted-foreground">
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
          {loginError && <p className={`mb-3 text-xs ${STATUS_COLOR.err}`}>{loginError}</p>}
          <Button onClick={login} className="h-11 w-full justify-center text-sm">
            Sign in
          </Button>
          <p className="mt-4 text-xs text-muted-foreground">
            <a href="/" className={STATUS_COLOR.accent}>← back to the public status page</a>
          </p>
        </Card>
      </div>
    )
  }

  // ─── Dashboard ─────────────────────────────────────────────────────────────
  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <span className={`text-xl ${STATUS_COLOR.accent}`}>▍</span>
            <h1 className="text-base font-bold font-heading sm:text-lg">BusGo Track — Admin</h1>
            <Badge
              variant="outline"
              className={`font-semibold ${overallStatus.variant === 'good' ? STATUS_BADGE.good : STATUS_BADGE.warn}`}
            >
              {overallStatus.label}
            </Badge>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <a href="/">public status page</a>
            <CopyGuideLinkButton />
            <Button onClick={logout} variant="outline" size="lg" className="h-11 text-xs">
              Log out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        {showRestartNudge && (
          <Alert className="mb-4 border-amber-500/40 bg-amber-500/10">
            <AlertTriangle className="size-4 text-amber-500 dark:text-amber-400" />
            <AlertTitle>Process restarted recently</AlertTitle>
            <AlertDescription>
              This process started {timeAgo(processStartedAt!, now)} — maintenance flags live in memory only, so a
              restart silently re-enables everything that was disabled before it. Double-check the Endpoints tab if
              you were mid-incident.
            </AlertDescription>
          </Alert>
        )}

        {/* Stat bar */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card className="p-4">
            <div className={`text-2xl font-bold ${openCount > 0 ? STATUS_COLOR.warn : STATUS_COLOR.good}`}>{openCount}</div>
            <div className="text-xs text-muted-foreground">Open issues</div>
          </Card>
          <Card className="p-4">
            <div className={`text-2xl font-bold ${disabledCount > 0 ? STATUS_COLOR.warn : ''}`}>{disabledCount}</div>
            <div className="text-xs text-muted-foreground">Endpoints disabled</div>
          </Card>
          <Card className="p-4">
            <div className="text-2xl font-bold">{bugReports.length}</div>
            <div className="text-xs text-muted-foreground">Total bug reports</div>
          </Card>
          <Card className="p-4">
            <div className={`text-2xl font-bold ${stopSuggestions.length > 0 ? STATUS_COLOR.accent : ''}`}>{stopSuggestions.length}</div>
            <div className="text-xs text-muted-foreground">Pending stop suggestions</div>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'issues' | 'endpoints' | 'suggestions')}>
          <TabsList variant="line" className="mb-4 h-auto w-full justify-start gap-1 border-b border-border p-0">
            <TabsTrigger value="issues" className="h-11 rounded-none px-4 text-sm font-semibold capitalize data-active:after:bg-primary">
              Issues
            </TabsTrigger>
            <TabsTrigger value="endpoints" className="h-11 rounded-none px-4 text-sm font-semibold capitalize data-active:after:bg-primary">
              Endpoints
            </TabsTrigger>
            <TabsTrigger value="suggestions" className="h-11 rounded-none px-4 text-sm font-semibold capitalize data-active:after:bg-primary">
              Stop Suggestions{stopSuggestions.length > 0 ? ` (${stopSuggestions.length})` : ''}
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
                  className="flex-wrap overflow-x-auto rounded-lg border border-border p-1"
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
                  <CheckCircle2 className={`size-10 ${STATUS_COLOR.good}`} />
                  <p className="text-sm font-semibold">All clear</p>
                  <p className="text-xs text-muted-foreground">
                    No open errors or bug reports. This is what a routine check should look like.
                  </p>
                </div>
              )}
              {filteredIssues.length === 0 && !isAllClear && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Nothing matches this filter.
                </p>
              )}

              <div className="space-y-2">
                {filteredIssues.map((item) => {
                  const isNew = lastSeenAtRef.current !== null && item.timestamp > lastSeenAtRef.current
                  return (
                    <Card
                      key={item.id}
                      className={`p-3 ${item.resolved ? 'opacity-55' : ''}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className={`font-semibold ${item.kind === 'error' ? STATUS_BADGE.err : STATUS_BADGE.accent}`}>
                          {item.kind === 'error' ? 'ERROR' : 'BUG'}
                        </Badge>
                        {isNew && (
                          <Badge className={`font-semibold ${STATUS_BADGE.accent}`}>
                            since you last looked
                          </Badge>
                        )}
                        <span className="font-mono text-xs font-semibold">{item.title}</span>
                        <span className="text-xs text-muted-foreground">{timeAgo(item.timestamp, now)}</span>
                        {item.count && item.count > 1 && (
                          <Badge className={`font-semibold ${STATUS_BADGE.warn}`}>
                            ×{item.count}
                          </Badge>
                        )}
                        {item.resolved && (
                          <Badge className={`font-semibold ${STATUS_BADGE.dim}`}>
                            resolved
                          </Badge>
                        )}
                        {item.onResolve && !item.resolved && (
                          <Button
                            onClick={item.onResolve}
                            variant="outline"
                            size="sm"
                            className={`ml-auto h-9 text-xs ${STATUS_COLOR.good}`}
                          >
                            Mark resolved
                          </Button>
                        )}
                      </div>
                      <div className="mt-1.5 whitespace-pre-wrap text-xs">{item.detail}</div>
                      {item.meta && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          from: <PageUrlLink url={item.meta} />
                        </div>
                      )}
                    </Card>
                  )
                })}
              </div>

              <p className="mt-3 text-xs text-muted-foreground">
                Errors: {source.errors === 'supabase' ? 'durable' : 'in-memory only'} · Bug reports: {source.bugs === 'supabase' ? 'durable' : 'in-memory only'} · auto-refreshes every 15s.
              </p>
            </section>
          </TabsContent>

          <TabsContent value="endpoints">
            <section>
              <p className="mb-4 text-xs text-muted-foreground">
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
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">{group}</h3>
                  <Card className="overflow-hidden gap-0 py-0">
                    {endpoints.map((ep, i) => {
                      const flag = maintenance.find((f) => f.feature === ep.id)
                      const disabled = !!flag
                      return (
                        <div
                          key={ep.id}
                          className={`flex items-center gap-3 px-3 py-3 ${i < endpoints.length - 1 ? 'border-b border-border' : ''}`}
                        >
                          {/* The visible switch stays small, but the tap target is
                              padded to the 44x44 minimum via the wrapping span so
                              the extra hit area doesn't shift layout. */}
                          <span className="-m-2 flex shrink-0 items-center rounded-full p-2">
                            <Switch
                              checked={!disabled}
                              onCheckedChange={() => toggleEndpoint(ep.id, disabled)}
                              className="data-checked:bg-green-600 data-unchecked:bg-destructive"
                            />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
                                {ep.method}
                              </span>
                              <span className="truncate font-mono text-xs">{ep.label}</span>
                            </div>
                            {flag && (
                              <div className={`mt-0.5 text-xs ${STATUS_COLOR.warn}`}>
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

          <TabsContent value="suggestions">
            <section>
              <p className="mb-4 text-xs text-muted-foreground">
                Rider-submitted stop corrections. Nothing here has touched the live map yet — approving replays the
                same write the debug/admin stop editor uses; rejecting just drops it.
              </p>
              {stopSuggestions.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-16 text-center">
                  <CheckCircle2 className={`size-10 ${STATUS_COLOR.good}`} />
                  <p className="text-sm font-semibold">Queue is empty</p>
                  <p className="text-xs text-muted-foreground">No pending stop suggestions right now.</p>
                </div>
              )}
              <div className="space-y-2">
                {stopSuggestions.map((s) => (
                  <Card key={s.id} className="p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={`font-semibold ${STATUS_BADGE.accent}`}>{s.type.toUpperCase()}</Badge>
                      <span className="font-mono text-xs font-semibold">
                        {s.type === 'add' && `"${s.proposed_name}" @ ${s.proposed_lat?.toFixed(5)}, ${s.proposed_lon?.toFixed(5)}`}
                        {s.type === 'rename' && `stop ${s.stop_id} → "${s.proposed_name}"`}
                        {s.type === 'delete' && `delete stop ${s.stop_id}`}
                      </span>
                      <span className="text-xs text-muted-foreground">{timeAgo(new Date(s.created_at).getTime(), now)}</span>
                      <div className="ml-auto flex gap-2">
                        <Button
                          onClick={() => resolveStopSuggestion(s.id, 'approve')}
                          variant="outline"
                          size="sm"
                          className={`h-9 text-xs ${STATUS_COLOR.good}`}
                        >
                          Approve
                        </Button>
                        <Button
                          onClick={() => resolveStopSuggestion(s.id, 'reject')}
                          variant="outline"
                          size="sm"
                          className={`h-9 text-xs ${STATUS_COLOR.err}`}
                        >
                          Reject
                        </Button>
                      </div>
                    </div>
                    {s.reason && <div className="mt-1.5 text-xs text-muted-foreground">Reason: {s.reason}</div>}
                  </Card>
                ))}
              </div>
            </section>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
