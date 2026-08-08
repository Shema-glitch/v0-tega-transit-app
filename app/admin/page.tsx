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

import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  Copy,
  MapPin,
  RefreshCw,
  ShieldAlert,
  Share2,
  Wrench,
  X,
} from 'lucide-react'
import { ENDPOINT_REGISTRY, type EndpointRegistryEntry } from '@/lib/api/endpoint-registry'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from '@/components/ui/dialog'
import { MAINTENANCE_GUIDE_HTML } from '@/lib/admin/maintenance-guide-html'

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

// ─── shared clock ──────────────────────────────────────────────────────────────
// The dashboard used to re-render the whole tree every second just to keep
// "Xs ago" labels fresh. One module-level clock + useSyncExternalStore means a
// single 15s interval and only the components that actually read time re-render.
let clockNow = Date.now()
let clockStarted = false
const clockListeners = new Set<() => void>()

function subscribeClock(listener: () => void) {
  clockListeners.add(listener)
  if (!clockStarted) {
    clockStarted = true
    setInterval(() => {
      clockNow = Date.now()
      clockListeners.forEach((l) => l())
    }, 15_000)
  }
  return () => {
    clockListeners.delete(listener)
  }
}

function useSharedNow(): number {
  return useSyncExternalStore(subscribeClock, () => clockNow, () => clockNow)
}

/** Self-refreshing "Xs ago" label — never re-renders its parents. */
function TimeAgo({ ts }: { ts: number }) {
  const now = useSharedNow()
  return <>{timeAgo(ts, now)}</>
}

// ─── toast (lightweight, zero dependency) ─────────────────────────────────────
interface ToastItem {
  id: number
  message: string
  kind: 'success' | 'error'
}

function ToastStack({ toasts }: { toasts: ToastItem[] }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-4 bottom-4 z-50 flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`rise-in pointer-events-auto flex items-start gap-2 rounded-lg border bg-card px-3 py-2.5 text-sm shadow-lg ${
            t.kind === 'success' ? 'border-green-500/40' : 'border-destructive/40'
          }`}
        >
          {t.kind === 'success' ? (
            <CheckCircle2 className={`mt-0.5 size-4 shrink-0 ${STATUS_COLOR.good}`} />
          ) : (
            <AlertTriangle className={`mt-0.5 size-4 shrink-0 ${STATUS_COLOR.err}`} />
          )}
          <span className="min-w-0 break-words">{t.message}</span>
        </div>
      ))}
    </div>
  )
}

// ─── skeleton / stat primitives ───────────────────────────────────────────────
function SkeletonBox({ className }: { className?: string }) {
  return <span className={`inline-block animate-pulse rounded bg-muted ${className ?? ''}`} />
}

function StatCard({
  icon,
  label,
  value,
  valueClass,
  pulse = false,
}: {
  icon: ReactNode
  label: string
  value: ReactNode
  valueClass?: string
  pulse?: boolean
}) {
  return (
    <Card className="p-4">
      <span
        className={`inline-flex size-6 items-center justify-center rounded-md bg-muted text-muted-foreground ${
          pulse ? 'status-breathe' : ''
        }`}
      >
        {icon}
      </span>
      <div className={`mt-2 text-2xl font-bold tabular-nums ${valueClass ?? ''}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </Card>
  )
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

// Debug Mode (stop rename/delete/add) used to be a toggle any rider could
// find in the app's own Preferences screen — a real problem, since it
// writes to the live database and only an admin token gated whether those
// writes actually landed. It's no longer discoverable there at all; this
// button (and GET /admin/debug, which it calls) is now the only way in.
// That route redirects to the frontend with the token in a URL FRAGMENT
// (`#admin_debug=...`), never a query param, so it's never sent to any
// server or written to a server access log on the frontend's end — the
// frontend's AppContext reads it client-side on load and strips it
// immediately. Only ever click this on a device you trust with the token.
function LaunchDebugModeButton() {
  const launch = useCallback(() => {
    // The session cookie authenticates the request; the route mints a
    // short-lived token for the frontend (see app/admin/debug/route.ts).
    window.open('/admin/debug', '_blank', 'noopener,noreferrer')
  }, [])

  return (
    <Button onClick={launch} variant="outline" size="sm" className="h-9 gap-1.5 text-xs">
      <Wrench className="size-3.5" />
      Open app in Debug Mode
    </Button>
  )
}

export default function AdminPage() {
  const [authState, setAuthState] = useState<'checking' | 'out' | 'in'>('checking')
  const now = useSharedNow()

  const [errors, setErrors] = useState<ErrorEntry[]>([])
  const [bugReports, setBugReports] = useState<BugReportEntry[]>([])
  const [maintenance, setMaintenance] = useState<MaintenanceFlag[]>([])
  const [stopSuggestions, setStopSuggestions] = useState<StopSuggestionEntry[]>([])
  const [processStartedAt, setProcessStartedAt] = useState<number | null>(null)
  const [source, setSource] = useState<{ errors: 'supabase' | 'memory'; bugs: 'supabase' | 'memory' }>({
    errors: 'memory',
    bugs: 'memory',
  })

  const [tab, setTab] = useState<'issues' | 'endpoints' | 'suggestions' | 'guide'>('issues')
  const [issueFilter, setIssueFilter] = useState<'all' | 'errors' | 'bugs' | 'open'>('open')
  const [query, setQuery] = useState('')

  // Action feedback + dialogs (replaces the old window.prompt flow)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [disableTarget, setDisableTarget] = useState<EndpointRegistryEntry | null>(null)
  const [disableReason, setDisableReason] = useState('Investigating an issue')
  const [disabling, setDisabling] = useState(false)
  const [confirmAction, setConfirmAction] = useState<{
    title: string
    message: string
    onConfirm: () => void
  } | null>(null)

  // Data freshness
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [pollFailed, setPollFailed] = useState(false)

  // Captured once on login — "since you last looked" compares against this,
  // not the live-updating localStorage value (which we overwrite right away).
  const lastSeenAtRef = useRef<number | null>(null)

  const pushToast = useCallback((message: string, kind: ToastItem['kind'] = 'success') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, message, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000)
  }, [])

  const refreshAll = useCallback(async () => {
    try {
      const [errRes, bugRes, maintRes, suggRes] = await Promise.all([
        fetch('/api/errors', { cache: 'no-store' }),
        fetch('/api/feedback', { cache: 'no-store' }),
        fetch('/api/admin/maintenance', { cache: 'no-store' }),
        fetch('/api/admin/stop-suggestions', { cache: 'no-store' }),
      ])
      if (bugRes.status === 401) {
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
      setLastUpdated(Date.now())
      setPollFailed(false)
    } catch {
      // Transient network hiccup — keep showing last known data, but say so.
      setPollFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  const resolveStopSuggestion = useCallback(async (id: number, decision: 'approve' | 'reject') => {
    await fetch(`/api/admin/stop-suggestions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    })
    refreshAll()
    pushToast(decision === 'approve' ? 'Suggestion approved — stop updated' : 'Suggestion rejected')
  }, [pushToast, refreshAll])

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch { /* cookie is cleared by the server response either way */ }
    setAuthState('out')
  }, [])

  const clearErrors = useCallback(() => {
    setConfirmAction({
      title: 'Clear all errors?',
      message:
        source.errors === 'supabase'
          ? 'This permanently deletes the durable error ledger in Supabase. There is no undo.'
          : 'This clears the in-memory error ledger.',
      onConfirm: async () => {
        await fetch('/api/errors', { method: 'DELETE' })
        refreshAll()
        pushToast('Error ledger cleared')
      },
    })
  }, [pushToast, refreshAll, source.errors])

  const clearBugReports = useCallback(() => {
    setConfirmAction({
      title: 'Clear all bug reports?',
      message:
        source.bugs === 'supabase'
          ? 'This permanently deletes the durable bug-report table in Supabase. There is no undo.'
          : 'This clears the in-memory bug-report list.',
      onConfirm: async () => {
        await fetch('/api/feedback', { method: 'DELETE' })
        refreshAll()
        pushToast('Bug reports cleared')
      },
    })
  }, [pushToast, refreshAll, source.bugs])

  const resolveBugReport = useCallback(async (id: string) => {
    await fetch('/api/feedback', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    refreshAll()
    pushToast('Bug report marked resolved')
  }, [pushToast, refreshAll])

  // Enabling is the recovery path and stays instant; disabling goes through the
  // reason dialog so Cancel is always a no-op (the old window.prompt fallback
  // actually disabled the endpoint even when the user cancelled).
  const enableEndpoint = useCallback(async (ep: EndpointRegistryEntry) => {
    await fetch('/api/admin/maintenance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feature: ep.id, reason: '', active: false }),
    })
    refreshAll()
    pushToast(`Re-enabled ${ep.label}`)
  }, [pushToast, refreshAll])

  const submitDisable = useCallback(async () => {
    if (!disableTarget) return
    setDisabling(true)
    try {
      const reason = disableReason.trim() || 'Under maintenance'
      await fetch('/api/admin/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature: disableTarget.id, reason, active: true }),
      })
      refreshAll()
      setDisableTarget(null)
      setDisableReason('Investigating an issue')
      pushToast(`Disabled ${disableTarget.label} — callers now get 503`)
    } catch {
      pushToast('Failed to disable endpoint', 'error')
    } finally {
      setDisabling(false)
    }
  }, [disableReason, disableTarget, pushToast, refreshAll])

  // Check the HttpOnly session cookie on load.
  useEffect(() => {
    fetch('/api/auth/session', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setAuthState(d?.authenticated ? 'in' : 'out'))
      .catch(() => setAuthState('out'))
  }, [])

  // No session → the login page at /goToAdminAuth owns the flow now.
  useEffect(() => {
    if (authState === 'out') window.location.replace('/goToAdminAuth')
  }, [authState])

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

  // ─── Session check screen ────────────────────────────────────────────────
  // 'out' redirects to /goToAdminAuth via the effect above; this just covers
  // the brief 'checking' moment so there's no flash of the dashboard.
  if (authState !== 'in') {
    return (
      <div className="dark flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
        <Card className="flex w-full max-w-sm items-center gap-3 p-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/busgo-logo-dark.png" alt="BusGo Track" className="h-9 w-auto" />
          <p className="text-sm text-muted-foreground">
            {authState === 'checking' ? 'Checking session…' : 'Redirecting to admin login…'}
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/busgo-logo-dark.png" alt="BusGo Track" className="h-8 w-auto" />
            <h1 className="text-base font-bold font-heading sm:text-lg">Admin</h1>
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
            <LaunchDebugModeButton />
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
              This process started <TimeAgo ts={processStartedAt!} /> — maintenance flags live in memory only, so a
              restart silently re-enables everything that was disabled before it. Double-check the Endpoints tab if
              you were mid-incident.
            </AlertDescription>
          </Alert>
        )}

        {/* Stat bar */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            icon={<AlertTriangle className="size-3.5" />}
            label="Open issues"
            pulse={openCount > 0}
            valueClass={openCount > 0 ? STATUS_COLOR.warn : STATUS_COLOR.good}
            value={loading ? <SkeletonBox className="h-7 w-10" /> : openCount}
          />
          <StatCard
            icon={<ShieldAlert className="size-3.5" />}
            label="Endpoints disabled"
            pulse={disabledCount > 0}
            valueClass={disabledCount > 0 ? STATUS_COLOR.warn : undefined}
            value={loading ? <SkeletonBox className="h-7 w-10" /> : disabledCount}
          />
          <StatCard
            icon={<Bug className="size-3.5" />}
            label="Total bug reports"
            value={loading ? <SkeletonBox className="h-7 w-10" /> : bugReports.length}
          />
          <StatCard
            icon={<MapPin className="size-3.5" />}
            label="Pending stop suggestions"
            pulse={stopSuggestions.length > 0}
            valueClass={stopSuggestions.length > 0 ? STATUS_COLOR.accent : undefined}
            value={loading ? <SkeletonBox className="h-7 w-10" /> : stopSuggestions.length}
          />
        </div>

        {/* Data freshness — never let a dead poll look like a healthy dashboard */}
        <div className="mb-3 flex items-center justify-end gap-2 text-xs text-muted-foreground">
          {pollFailed ? (
            <span className={STATUS_COLOR.err}>
              Can&apos;t reach the API — showing data from {lastUpdated ? <TimeAgo ts={lastUpdated} /> : 'earlier'} · retrying…
            </span>
          ) : lastUpdated ? (
            <span>
              Updated <TimeAgo ts={lastUpdated} />
            </span>
          ) : null}
          <Button
            onClick={refreshAll}
            variant="outline"
            size="sm"
            className="h-8 gap-1 text-xs"
            aria-label="Refresh dashboard data"
          >
            <RefreshCw className="size-3.5" /> Refresh
          </Button>
        </div>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'issues' | 'endpoints' | 'suggestions' | 'guide')}>
          <TabsList variant="line" className="mb-4 h-auto w-full justify-start gap-1 border-b border-border p-0">
            <TabsTrigger value="issues" className="h-11 rounded-none px-4 text-sm font-semibold capitalize data-active:after:bg-primary">
              Issues{openCount > 0 ? ` (${openCount})` : ''}
            </TabsTrigger>
            <TabsTrigger value="endpoints" className="h-11 rounded-none px-4 text-sm font-semibold capitalize data-active:after:bg-primary">
              Endpoints
            </TabsTrigger>
            <TabsTrigger value="suggestions" className="h-11 rounded-none px-4 text-sm font-semibold capitalize data-active:after:bg-primary">
              Stop Suggestions{stopSuggestions.length > 0 ? ` (${stopSuggestions.length})` : ''}
            </TabsTrigger>
            <TabsTrigger value="guide" className="h-11 rounded-none px-4 text-sm font-semibold capitalize data-active:after:bg-primary">
              Maintenance Guide
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
                <div className="relative min-w-0 flex-1">
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search path, message, subject…"
                    aria-label="Search issues"
                    className="h-11 w-full pr-9 text-xs"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery('')}
                      aria-label="Clear search"
                      className="absolute top-1/2 right-3 -translate-y-1/2 cursor-pointer rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </div>
                <Button onClick={clearErrors} variant="destructive" size="sm" className="h-11 text-xs">
                  Clear errors
                </Button>
                <Button onClick={clearBugReports} variant="destructive" size="sm" className="h-11 text-xs">
                  Clear bug reports
                </Button>
              </div>

              {!loading && filteredIssues.length === 0 && isAllClear && (
                <div className="flex flex-col items-center gap-2 py-16 text-center">
                  <CheckCircle2 className={`size-10 ${STATUS_COLOR.good}`} />
                  <p className="text-sm font-semibold">All clear</p>
                  <p className="text-xs text-muted-foreground">
                    No open errors or bug reports. This is what a routine check should look like.
                  </p>
                </div>
              )}
              {!loading && filteredIssues.length === 0 && !isAllClear && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Nothing matches this filter.
                </p>
              )}

              {loading ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Card key={i} className="p-3">
                      <SkeletonBox className="h-4 w-1/3" />
                      <SkeletonBox className="mt-2 h-3 w-2/3" />
                    </Card>
                  ))}
                </div>
              ) : (
              <div className="space-y-2">
                {filteredIssues.map((item, idx) => {
                  const isNew = lastSeenAtRef.current !== null && item.timestamp > lastSeenAtRef.current
                  return (
                    <Card
                      key={item.id}
                      className={`p-3 rise-in ${item.resolved ? 'opacity-55' : ''}`}
                      style={{ '--rise-index': Math.min(idx, 10) } as CSSProperties}
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
                        <span className="text-xs text-muted-foreground">
                          <TimeAgo ts={item.timestamp} />
                        </span>
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
                        {item.kind === 'error' && (
                          <Button
                            onClick={() => {
                              void navigator.clipboard.writeText(`${item.title}\n${item.detail}`).catch(() => {})
                              pushToast('Error details copied')
                            }}
                            variant="ghost"
                            size="sm"
                            className="h-9 gap-1 text-xs"
                            title="Copy error details"
                          >
                            <Copy className="size-3.5" /> Copy
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
              )}

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
              {disabledCount === 0 && (
                <div className="mb-4 flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs text-green-600 dark:text-green-400">
                  <CheckCircle2 className="size-4 shrink-0" />
                  All {ENDPOINT_REGISTRY.length} endpoints are live.
                </div>
              )}
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
                              onCheckedChange={() => {
                                if (disabled) {
                                  enableEndpoint(ep)
                                } else {
                                  setDisableReason('Investigating an issue')
                                  setDisableTarget(ep)
                                }
                              }}
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
                                Disabled: {flag.reason} · <TimeAgo ts={flag.since} />
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
              {!loading && stopSuggestions.length === 0 && (
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
                        {s.type === 'add' && (
                          <>
                            &quot;{s.proposed_name}&quot; @{' '}
                            <a
                              href={`https://www.google.com/maps?q=${s.proposed_lat},${s.proposed_lon}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`inline-flex items-center gap-1 underline-offset-2 hover:underline ${STATUS_COLOR.accent}`}
                            >
                              {s.proposed_lat?.toFixed(5)}, {s.proposed_lon?.toFixed(5)}
                              <MapPin className="size-3" />
                            </a>
                          </>
                        )}
                        {s.type === 'rename' && `stop ${s.stop_id} → "${s.proposed_name}"`}
                        {s.type === 'delete' && `delete stop ${s.stop_id}`}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        <TimeAgo ts={new Date(s.created_at).getTime()} />
                      </span>
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

          <TabsContent value="guide">
            <section>
              <p className="mb-3 text-xs text-muted-foreground">
                Dual-repo maintenance &amp; QA reference — frontend (<span className="font-mono">BusGo_Track</span>), backend
                (this repo), and a persistent testing checklist. Only visible to a signed-in admin; not published anywhere public.
              </p>
              <Card className="overflow-hidden p-0">
                <iframe
                  title="Maintenance & QA Guide"
                  srcDoc={MAINTENANCE_GUIDE_HTML}
                  sandbox="allow-scripts allow-same-origin"
                  className="h-[75vh] w-full border-0 bg-background"
                />
              </Card>
            </section>
          </TabsContent>
        </Tabs>
      </main>

      {/* Disable-endpoint dialog — replaces the old window.prompt flow, whose
          Cancel fallback silently disabled the endpoint anyway. Cancel is a
          genuine no-op now. */}
      <Dialog open={disableTarget !== null} onOpenChange={(open) => { if (!open && !disabling) setDisableTarget(null) }}>
        <DialogPortal>
          <DialogBackdrop />
          <DialogPopup>
            <DialogTitle className="text-base font-semibold">Disable {disableTarget?.label}</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Callers will get <code className="rounded bg-muted px-1 py-0.5 text-xs">503</code> until you re-enable
              it. Flags are in-memory only — a redeploy re-enables everything.
            </DialogDescription>
            <div className="mt-4">
              <label htmlFor="disable-reason" className="mb-1.5 block text-xs font-semibold">
                Reason (shown to callers)
              </label>
              <Input
                id="disable-reason"
                value={disableReason}
                onChange={(e) => setDisableReason(e.target.value)}
                placeholder="e.g. Investigating an issue"
                className="h-10 text-sm"
                autoFocus
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDisableTarget(null)} disabled={disabling} className="h-9 text-xs">
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={submitDisable} disabled={disabling} className="h-9 text-xs">
                {disabling ? 'Disabling…' : 'Disable endpoint'}
              </Button>
            </div>
          </DialogPopup>
        </DialogPortal>
      </Dialog>

      {/* Confirm dialog for bulk clears (durable Supabase data has no undo) */}
      <Dialog open={confirmAction !== null} onOpenChange={(open) => { if (!open) setConfirmAction(null) }}>
        <DialogPortal>
          <DialogBackdrop />
          <DialogPopup>
            <DialogTitle className="text-base font-semibold">{confirmAction?.title}</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">{confirmAction?.message}</DialogDescription>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmAction(null)} className="h-9 text-xs">
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="h-9 text-xs"
                onClick={() => {
                  const action = confirmAction
                  setConfirmAction(null)
                  action?.onConfirm()
                }}
              >
                Confirm
              </Button>
            </div>
          </DialogPopup>
        </DialogPortal>
      </Dialog>

      <ToastStack toasts={toasts} />
    </div>
  )
}
