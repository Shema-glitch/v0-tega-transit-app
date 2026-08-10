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
  Database,
  KeyRound,
  Loader2,
  MapPin,
  RefreshCw,
  ShieldAlert,
  Share2,
  TriangleAlert,
  UserPlus,
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
import UptimeBars, { type UptimeDay } from '@/components/uptime-bars'
import SseMonitor from '@/components/admin/sse-monitor'
import LoadPanel from '@/components/admin/load-panel'
import { SettingsPanel } from '@/components/admin/settings-panel'
import { StopsPanel } from '@/components/admin/stops-panel'
import { AppSidebar, type ConsoleSection, type AdminRole } from '@/components/app-sidebar'
import { Separator } from '@/components/ui/separator'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'

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
// "Not in use for ~15 min → kill the session". Background auto-polling is NOT
// user activity, so walking away with the tab open still signs you out; the
// server independently enforces the same window (lib/api/admin-auth.ts).
const IDLE_TIMEOUT_MS = 15 * 60 * 1000
const IDLE_WARN_MS = 14 * 60 * 1000
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

// Mirrors lib/api/admin-emails.ts AdminEmailEntry.
interface AdminEmailEntry {
  email: string
  source: 'env' | 'supabase'
  role: 'admin' | 'curator'
  invitedBy?: string
  createdAt?: number
}

// Mirrors lib/api/auth-log.ts AuthLogEvent.
interface AuthLogEvent {
  at: number
  action: string
  email: string | null
  ip: string
  ok: boolean
  detail?: string
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

function StatPanel({
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
    <div className="relative flex items-center gap-4 px-4 py-4 sm:px-5">
      {/* Status rail — the only per-cell color; everything else is neutral. */}
      <span
        className={`absolute top-4 bottom-4 left-0 w-[2px] rounded-full ${
          pulse ? 'bg-amber-500/70 status-breathe' : 'bg-border'
        }`}
      />
      <div className="min-w-0">
        <div className={`text-2xl leading-none font-bold tracking-tight tabular-nums ${valueClass ?? 'text-foreground'}`}>
          {value}
        </div>
        <div className="mt-1.5 text-[11px] leading-tight font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </div>
      </div>
      <span className="ml-auto shrink-0 rounded-lg border border-border/70 bg-muted/40 p-1.5 text-muted-foreground">
        {icon}
      </span>
    </div>
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
      className={`underline-offset-2 transition-colors hover:underline ${STATUS_COLOR.accent}`}
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

  const [tab, setTab] = useState<ConsoleSection>('stops')
  const [role, setRole] = useState<AdminRole | null>(null)
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

  // TOTP challenge — a sensitive action came back 403 'totp-required'. The
  // dialog verifies a fresh authenticator code (which re-issues the session
  // cookie with a totpAt claim), then the original action is retried once.
  const [totpPrompt, setTotpPrompt] = useState<{ resolve: (ok: boolean) => void } | null>(null)
  const [totpCode, setTotpCode] = useState('')
  const [totpVerifying, setTotpVerifying] = useState(false)
  const [totpError, setTotpError] = useState<string | null>(null)

  // Data freshness
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [pollFailed, setPollFailed] = useState(false)

  // Active load-alert count for the sidebar's red dot. Polled independently
  // of the Load section so a spike surfaces no matter which section is open
  // (the poll also keeps threshold evaluation running while Load is closed).
  const [activeAlerts, setActiveAlerts] = useState(0)
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const res = await fetch('/api/admin/metrics', { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setActiveAlerts(data.alerts?.active?.length ?? 0)
      } catch {
        // Silent — the sidebar dot is best-effort; the Load panel errors loudly.
      }
    }
    check()
    const id = setInterval(check, 20_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  // Admin email allowlist (invite/revoke — see lib/api/admin-emails.ts)
  // Mirrors lib/api/uptime-tracker.ts EndpointUptime.
  interface UptimeEntry {
    id: string
    method: 'GET' | 'POST'
    label: string
    group: string
    uptimePct: number
    samples: number
    last: 'ok' | 'degraded' | 'down' | null
    buckets: UptimeDay[]
  }

  const [admins, setAdmins] = useState<AdminEmailEntry[]>([])
  const [adminsDbOk, setAdminsDbOk] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)

  // Durability + audit trail (see lib/api/maintenance-store.ts / auth-log.ts)
  const [maintDurable, setMaintDurable] = useState(false)
  const [maintLastHydratedAt, setMaintLastHydratedAt] = useState<number | null>(null)
  const [authLog, setAuthLog] = useState<AuthLogEvent[]>([])
  const [authLogSource, setAuthLogSource] = useState<'supabase' | 'memory' | null>(null)

  // Uptime history for the Render-style bars (see lib/api/uptime-tracker.ts)
  const [uptime, setUptime] = useState<Record<string, UptimeEntry>>({})
  const [checksRunning, setChecksRunning] = useState(false)

  // Idle session expiry (client side — see the effect below)
  const [idleWarning, setIdleWarning] = useState(false)
  const [idleLeftSec, setIdleLeftSec] = useState(0)
  const lastActivityRef = useRef(Date.now())

  // Why the user was bounced to login — surfaced on /goToAdminAuth as a banner.
  const [logoutReason, setLogoutReason] = useState<string | null>(null)

  // Captured once on login — "since you last looked" compares against this,
  // not the live-updating localStorage value (which we overwrite right away).
  const lastSeenAtRef = useRef<number | null>(null)

  const pushToast = useCallback((message: string, kind: ToastItem['kind'] = 'success') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, message, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000)
  }, [])

  // Wraps a sensitive admin write: on 403 'totp-required' it asks for a fresh
  // authenticator code (which primes the session cookie), then retries once.
  const totpAwareFetch = useCallback(async (url: string, init?: RequestInit): Promise<Response> => {
    const res = await fetch(url, init)
    if (res.status !== 403) return res
    const data = await res.json().catch(() => ({}))
    if (data?.error !== 'totp-required') return res
    const ok = await new Promise<boolean>((resolve) => setTotpPrompt({ resolve }))
    if (!ok) return res
    return fetch(url, init)
  }, [])

  const submitTotpCode = useCallback(async () => {
    if (!/^\d{6}$/.test(totpCode)) {
      setTotpError('Enter the 6-digit code from your authenticator app.')
      return
    }
    setTotpVerifying(true)
    setTotpError(null)
    try {
      const res = await fetch('/api/admin/settings/totp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', code: totpCode }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setTotpError(data?.error ?? 'That code was not accepted.')
        return
      }
      const resolve = totpPrompt?.resolve
      setTotpPrompt(null)
      setTotpCode('')
      resolve?.(true)
      pushToast('Identity confirmed — sensitive actions unlocked')
    } catch {
      setTotpError('Could not reach the API. Try again.')
    } finally {
      setTotpVerifying(false)
    }
  }, [totpCode, totpPrompt, pushToast])

  const refreshAll = useCallback(async () => {
    try {
      const [errRes, bugRes, maintRes, suggRes, adminsRes, authLogRes, uptimeRes, meRes] = await Promise.all([
        fetch('/api/errors', { cache: 'no-store' }),
        fetch('/api/feedback', { cache: 'no-store' }),
        fetch('/api/admin/maintenance', { cache: 'no-store' }),
        fetch('/api/admin/stop-suggestions', { cache: 'no-store' }),
        fetch('/api/admin/admins', { cache: 'no-store' }),
        fetch('/api/admin/auth-log', { cache: 'no-store' }),
        fetch('/api/uptime', { cache: 'no-store' }),
        fetch('/api/admin/me', { cache: 'no-store' }),
      ])
      // Role re-read every refresh — a revoke takes effect immediately.
      const meData = await meRes.json().catch(() => ({}))
      if (meRes.ok && meData?.role) setRole(meData.role)
      if (bugRes.status === 401) {
        // The server killed the session (idle window elapsed, 8h cap, or it
        // was revoked) — say so instead of silently bouncing to login.
        setLogoutReason('Your session expired — sign in again.')
        setAuthState('out')
        return
      }
      const errData = await errRes.json()
      const bugData = await bugRes.json()
      const maintData = await maintRes.json()
      const suggData = await suggRes.json().catch(() => ({}))
      const adminsData = await adminsRes.json().catch(() => ({ admins: [], dbOk: false }))
      const authLogData = await authLogRes.json().catch(() => ({ events: [], source: null }))
      setErrors(errData.errors ?? [])
      setBugReports(bugData.reports ?? [])
      setMaintenance(maintData.flags ?? [])
      setStopSuggestions(suggData.suggestions ?? [])
      setAdmins(adminsData.admins ?? [])
      setAdminsDbOk(adminsData.dbOk !== false)
      setMaintDurable(maintData.durable === true)
      setMaintLastHydratedAt(typeof maintData.lastHydratedAt === 'number' ? maintData.lastHydratedAt : null)
      setAuthLog(authLogData.events ?? [])
      setAuthLogSource(authLogData.source === 'supabase' ? 'supabase' : authLogData.source === 'memory' ? 'memory' : null)
      const uptimeData = await uptimeRes.json().catch(() => ({ endpoints: [] }))
      setUptime(
        Object.fromEntries(
          (uptimeData.endpoints as UptimeEntry[]).map((e) => [e.id, e])
        )
      )
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

  // Server-side "re-run all checks" — probes every endpoint once and records
  // the results into the uptime tracker (see lib/api/uptime-tracker.ts), so
  // the bars update in place. This is why the public page has no such button.
  const runChecks = useCallback(async () => {
    setChecksRunning(true)
    try {
      const res = await fetch('/api/admin/diagnostics/check', { method: 'POST', cache: 'no-store' })
      if (res.status === 401) {
        setLogoutReason('Your session expired — sign in again.')
        setAuthState('out')
        return
      }
      const data = await res.json()
      if (!res.ok) {
        pushToast(data.error ?? 'Check failed', 'error')
        return
      }
      pushToast(`Checked ${data.results?.length ?? 0} endpoints — ${data.ok ?? 0} ok, ${data.degraded ?? 0} degraded, ${data.down ?? 0} down`)
      void refreshAll()
    } catch {
      pushToast('Could not reach the API', 'error')
    } finally {
      setChecksRunning(false)
    }
  }, [pushToast, refreshAll])

  const inviteAdmin = useCallback(async () => {
    const addr = inviteEmail.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
      pushToast('Enter a valid email address', 'error')
      return
    }
    setInviting(true)
    try {
      const res = await totpAwareFetch('/api/admin/admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: addr }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        pushToast(data?.error ?? 'Could not invite that email', 'error')
      } else {
        setInviteEmail('')
        pushToast(`${addr} can now sign in — a code is all they need`)
      }
    } catch {
      pushToast('Could not reach the API', 'error')
    } finally {
      setInviting(false)
      refreshAll()
    }
  }, [inviteEmail, pushToast, refreshAll, totpAwareFetch])

  const toggleCuratorRole = useCallback(
    async (email: string, currentRole: string) => {
      const grant = currentRole !== 'curator'
      const res = await totpAwareFetch(grant ? '/api/admin/curators' : `/api/admin/curators?email=${encodeURIComponent(email)}`, {
        method: grant ? 'POST' : 'DELETE',
        headers: grant ? { 'Content-Type': 'application/json' } : undefined,
        body: grant ? JSON.stringify({ email }) : undefined,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) pushToast(data?.error ?? 'Could not update the role', 'error')
      else pushToast(grant ? `${email} is now a curator` : `${email} is back to full admin`)
      refreshAll()
    },
    [pushToast, refreshAll, totpAwareFetch]
  )

  const revokeAdmin = useCallback(
    (email: string) => {
      setConfirmAction({
        title: `Revoke ${email}?`,
        message:
          'They will no longer be able to sign in to this dashboard. Their Supabase auth account stays — only dashboard access is removed.',
        onConfirm: async () => {
          const res = await totpAwareFetch(`/api/admin/admins?email=${encodeURIComponent(email)}`, { method: 'DELETE' })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) pushToast(data?.error ?? 'Could not revoke that email', 'error')
          else pushToast(`${email} revoked`)
          refreshAll()
        },
      })
    },
    [pushToast, refreshAll, totpAwareFetch]
  )

  const resolveStopSuggestion = useCallback(async (id: number, decision: 'approve' | 'reject') => {
    const res = await totpAwareFetch(`/api/admin/stop-suggestions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      pushToast(data?.error ?? 'Could not update that suggestion', 'error')
      return
    }
    refreshAll()
    pushToast(decision === 'approve' ? 'Suggestion approved — stop updated' : 'Suggestion rejected')
  }, [pushToast, refreshAll, totpAwareFetch])

  const logout = useCallback(async () => {
    setLogoutReason(null) // explicit sign-out needs no reason banner
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
    const res = await totpAwareFetch('/api/admin/maintenance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feature: ep.id, reason: '', active: false }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      pushToast(data?.error ?? 'Failed to re-enable endpoint', 'error')
      return
    }
    refreshAll()
    pushToast(`Re-enabled ${ep.label}`)
  }, [pushToast, refreshAll, totpAwareFetch])

  const submitDisable = useCallback(async () => {
    if (!disableTarget) return
    setDisabling(true)
    try {
      const reason = disableReason.trim() || 'Under maintenance'
      const res = await totpAwareFetch('/api/admin/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature: disableTarget.id, reason, active: true }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        pushToast(data?.error ?? 'Failed to disable endpoint', 'error')
        return
      }
      refreshAll()
      setDisableTarget(null)
      setDisableReason('Investigating an issue')
      pushToast(`Disabled ${disableTarget.label} — callers now get 503`)
    } catch {
      pushToast('Failed to disable endpoint', 'error')
    } finally {
      setDisabling(false)
    }
  }, [disableReason, disableTarget, pushToast, refreshAll, totpAwareFetch])

  // Check the HttpOnly session cookie on load.
  useEffect(() => {
    fetch('/api/auth/session', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setAuthState(d?.authenticated ? 'in' : 'out'))
      .catch(() => setAuthState('out'))
  }, [])

  // Role-gated nav: if a (possibly demoted) curator lands on an admin-only
  // section, fall back to the stops panel — and the first load lands on stops
  // for curators instead of Issues.
  const ADMIN_ONLY_SECTIONS: ConsoleSection[] = ['issues', 'endpoints', 'load', 'admins', 'guide']
  useEffect(() => {
    if (role !== 'curator') return
    if (ADMIN_ONLY_SECTIONS.includes(tab)) setTab('stops')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, tab])

  // No session → the login page at /goToAdminAuth owns the flow now. Carry the
  // reason (if any) so a session killed mid-use explains itself there.
  useEffect(() => {
    if (authState !== 'out') return
    const q = logoutReason ? `?error=${encodeURIComponent(logoutReason)}` : ''
    window.location.replace(`/goToAdminAuth${q}`)
  }, [authState, logoutReason])

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

  // ─── Idle session expiry ────────────────────────────────────────────────────
  // Real user activity (mouse/key/touch) keeps the session alive; anything else
  // — including the 15s auto-poll — does not. 14 min idle → persistent warning
  // banner; 15 min idle → kill the session and land back on the login page.
  // The server enforces the same window as a backstop (see admin-auth.ts), so
  // this is UX, not the security boundary.
  useEffect(() => {
    if (authState !== 'in') return
    lastActivityRef.current = Date.now()
    setIdleWarning(false)
    const EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel', 'scroll']
    const onActivity = () => {
      lastActivityRef.current = Date.now()
    }
    for (const e of EVENTS) window.addEventListener(e, onActivity, { passive: true })
    const id = setInterval(() => {
      const idle = Date.now() - lastActivityRef.current
      if (idle >= IDLE_TIMEOUT_MS) {
        // Kill the session server-side, then hand the user to the login page
        // with the reason surfaced (the page reads ?error= and shows it).
        void fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
        window.location.replace(
          '/goToAdminAuth?error=Your session expired after 15 minutes of inactivity. Sign in again to continue.'
        )
      } else if (idle >= IDLE_WARN_MS) {
        // Live countdown — only touches state during the warning minute, so
        // the 1s tick never re-renders the dashboard the rest of the time.
        setIdleWarning(true)
        setIdleLeftSec(Math.max(0, Math.ceil((IDLE_TIMEOUT_MS - idle) / 1000)))
      } else {
        setIdleWarning(false)
      }
    }, 1000)
    return () => {
      for (const e of EVENTS) window.removeEventListener(e, onActivity)
      clearInterval(id)
    }
  }, [authState])

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
          <img src="/assets/busgo-mark-dark.png" alt="BusGo Track" className="h-10 w-auto" />
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
      {/* Fixed film grain — one paint layer, never intercepts input (see .admin-grain). */}
      <div aria-hidden className="admin-grain" />

      {/* shadcn dashboard-01 shell: sidebar nav + inset content. The sections
          that were top tabs now live in the sidebar (see components/app-sidebar.tsx)
          so the console shows one focused panel at a time. */}
      <SidebarProvider
        style={
          {
            '--sidebar-width': 'calc(var(--spacing) * 72)',
            '--header-height': 'calc(var(--spacing) * 12)',
          } as CSSProperties
        }
      >
        <AppSidebar
          variant="inset"
          active={tab}
          role={role}
          counts={{ issues: openCount, suggestions: stopSuggestions.length, loadAlerts: activeAlerts }}
          onNavigate={(s) => setTab(s)}
          onLogout={logout}
        />
        <SidebarInset className="bg-background">
          <header className="sticky top-0 z-40 flex h-(--header-height) shrink-0 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur-md md:px-6">
            <SidebarTrigger className="-ml-1 md:hidden" />
            <Separator orientation="vertical" className="mr-2 hidden h-4 md:block" />
            <Badge
              variant="outline"
              className={`hidden gap-1.5 font-semibold sm:inline-flex ${
                overallStatus.variant === 'good' ? STATUS_BADGE.good : STATUS_BADGE.warn
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${
                  overallStatus.variant === 'good' ? 'bg-green-500' : 'bg-amber-500 status-breathe'
                }`}
              />
              {overallStatus.label}
            </Badge>
            <span className="text-sm font-semibold tracking-tight capitalize">{tab}</span>
            <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
              {pollFailed ? (
                <span className="hidden font-medium text-destructive sm:inline">Can&apos;t reach the API · retrying…</span>
              ) : lastUpdated ? (
                <span className="hidden font-mono tabular-nums sm:inline">updated <TimeAgo ts={lastUpdated} /></span>
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
              <CopyGuideLinkButton />
              <LaunchDebugModeButton />
            </div>
          </header>

      <main className="@container/main flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
        {idleWarning && (
          <Alert className="mb-4 border-amber-500/40 bg-amber-500/10">
            <AlertTriangle className="size-4 text-amber-500 dark:text-amber-400" />
            <AlertTitle>Session expires soon</AlertTitle>
            <AlertDescription>
              No activity for 14 minutes — you&apos;ll be signed out in{' '}
              <span className="font-mono tabular-nums">
                {Math.floor(idleLeftSec / 60)}:{String(idleLeftSec % 60).padStart(2, '0')}
              </span>
              . Move the mouse or press a key to stay signed in.
            </AlertDescription>
          </Alert>
        )}

        {showRestartNudge && (
          <Alert className="mb-4 border-amber-500/40 bg-amber-500/10">
            <AlertTriangle className="size-4 text-amber-500 dark:text-amber-400" />
            <AlertTitle>Process restarted recently</AlertTitle>
            <AlertDescription>
              This process started <TimeAgo ts={processStartedAt!} />.
              {maintDurable ? (
                <> Maintenance flags are backed by Supabase, so what was disabled before the restart is still
                  disabled — no need to re-check the Endpoints section.</>
              ) : (
                <> Maintenance flags are in-memory only right now, so a restart re-enables everything that was
                  disabled before it. Double-check the Endpoints section if you were mid-incident.</>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Stat bar — one divided panel, cells carry a status rail instead of
            a box each. Numbers are tabular and tracking-tight. */}
        <Card className="mb-6 overflow-hidden gap-0 py-0">
          <div className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-4 sm:divide-y-0">
            <StatPanel
              icon={<AlertTriangle className="size-3.5" />}
              label="Open issues"
              pulse={openCount > 0}
              valueClass={openCount > 0 ? STATUS_COLOR.warn : STATUS_COLOR.good}
              value={loading ? <SkeletonBox className="h-7 w-10" /> : openCount}
            />
            <StatPanel
              icon={<ShieldAlert className="size-3.5" />}
              label="Endpoints disabled"
              pulse={disabledCount > 0}
              valueClass={disabledCount > 0 ? STATUS_COLOR.warn : undefined}
              value={loading ? <SkeletonBox className="h-7 w-10" /> : disabledCount}
            />
            <StatPanel
              icon={<Bug className="size-3.5" />}
              label="Bug reports"
              value={loading ? <SkeletonBox className="h-7 w-10" /> : bugReports.length}
            />
            <StatPanel
              icon={<MapPin className="size-3.5" />}
              label="Suggestions"
              pulse={stopSuggestions.length > 0}
              valueClass={stopSuggestions.length > 0 ? STATUS_COLOR.warn : undefined}
              value={loading ? <SkeletonBox className="h-7 w-10" /> : stopSuggestions.length}
            />
          </div>
        </Card>

        {/* Sections — the sidebar owns navigation now (see AppSidebar). */}
        {tab === 'issues' && (
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
                <div className="flex flex-col items-center gap-3 py-20 text-center">
                  <span className="inline-flex size-12 items-center justify-center rounded-full border border-green-500/20 bg-green-500/10">
                    <CheckCircle2 className={`size-6 ${STATUS_COLOR.good}`} />
                  </span>
                  <p className="text-sm font-semibold tracking-tight">All clear</p>
                  <p className="max-w-[38ch] text-xs leading-relaxed text-muted-foreground">
                    No open errors or bug reports. This is what a routine check should look like.
                  </p>
                </div>
              )}
              {!loading && filteredIssues.length === 0 && !isAllClear && (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Nothing matches this filter.
                </p>
              )}

              {loading ? (
                <div className="overflow-hidden rounded-xl border border-border">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-border' : ''}`}>
                      <SkeletonBox className="h-2 w-2 rounded-full" />
                      <SkeletonBox className="h-4 w-1/3" />
                      <SkeletonBox className="ml-auto h-3 w-16" />
                    </div>
                  ))}
                </div>
              ) : (
              <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                {filteredIssues.map((item, idx) => {
                  const isNew = lastSeenAtRef.current !== null && item.timestamp > lastSeenAtRef.current
                  return (
                    <div
                      key={item.id}
                      className={`row-hover rise-in relative flex flex-col gap-1.5 px-4 py-3 pl-5 ${item.resolved ? 'opacity-55' : ''}`}
                      style={{ '--rise-index': Math.min(idx, 10) } as CSSProperties}
                    >
                      {/* Severity rail — errors red, bugs emerald. */}
                      <span
                        className={`absolute inset-y-0 left-0 w-[2px] ${
                          item.kind === 'error' ? 'bg-destructive/70' : 'bg-emerald-500/70'
                        }`}
                      />
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
                            className={`ml-auto h-8 text-xs ${STATUS_COLOR.good}`}
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
                            className="h-8 gap-1 text-xs"
                            title="Copy error details"
                          >
                            <Copy className="size-3.5" /> Copy
                          </Button>
                        )}
                      </div>
                      <div className="text-xs whitespace-pre-wrap">{item.detail}</div>
                      {item.meta && (
                        <div className="text-xs text-muted-foreground">
                          from: <PageUrlLink url={item.meta} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              )}

              <p className="mt-3 text-xs text-muted-foreground">
                Errors: {source.errors === 'supabase' ? 'durable' : 'in-memory only'} · Bug reports: {source.bugs === 'supabase' ? 'durable' : 'in-memory only'} · auto-refreshes every 15s.
              </p>
            </section>
          )}

        {tab === 'endpoints' && (
            <section>
              {/* Diagnostics — admin-only. These used to sit on the public page
                  where every visitor's browser would self-probe the API; both
                  actions are now server-side and gated. */}
              <Card className="mb-4 gap-3 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    onClick={runChecks}
                    disabled={checksRunning}
                    size="sm"
                    className="h-9 gap-1.5 bg-emerald-500 text-xs font-semibold text-emerald-950 shadow-[0_8px_20px_-8px_oklch(0.696_0.17_162.48/0.6)] transition-all hover:bg-emerald-400 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60"
                  >
                    {checksRunning ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3.5" />
                    )}
                    {checksRunning ? 'Checking…' : 'Re-run all checks'}
                  </Button>
                  <SseMonitor />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Probes every endpoint server-side and records the result into the uptime bars below. The
                  background sweep runs read-only every 5 minutes; this button also exercises the write endpoints
                  (broadcast, incident/bug report, stop suggestion) — expect a test event in Issues afterwards.
                </p>
              </Card>

              <p className="mb-4 text-xs text-muted-foreground">
                Disabling an endpoint here makes it actually return 503 to callers immediately — see docs/ADMIN_DASHBOARD_PRD.md.
                Meta endpoints (health, status, errors, feedback, admin/*) aren&apos;t listed — you can&apos;t disable the tools that turn things back on.
              </p>

              {/* Durability — are these toggles going to survive the next deploy? */}
              <div
                className={`mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
                  maintDurable
                    ? 'border-border bg-muted/30 text-muted-foreground'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                }`}
              >
                {maintDurable ? (
                  <Database className="size-4 shrink-0" />
                ) : (
                  <AlertTriangle className="size-4 shrink-0" />
                )}
                {maintDurable ? (
                  <span>
                    Flags persist in Supabase — a restart won&apos;t re-enable endpoints.
                    {maintLastHydratedAt ? (
                      <>
                        {' '}Synced <TimeAgo ts={maintLastHydratedAt} />.
                      </>
                    ) : null}
                  </span>
                ) : (
                  <span>
                    In-memory only — flags won&apos;t survive a restart. Check the Supabase migration
                    (0010) and the service-role key.
                  </span>
                )}
              </div>

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
              ).map(([group, endpoints]) => {
                const groupDisabled = endpoints.some((ep) => maintenance.some((f) => f.feature === ep.id))
                return (
                <div key={group} className="mb-5">
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className={`size-1.5 rounded-full ${
                        groupDisabled ? 'bg-amber-500 status-breathe' : 'bg-emerald-500/80'
                      }`}
                    />
                    <h3 className="text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase">{group}</h3>
                  </div>
                  <Card className="overflow-hidden gap-0 py-0">
                    {endpoints.map((ep, i) => {
                      const flag = maintenance.find((f) => f.feature === ep.id)
                      const disabled = !!flag
                      return (
                        <div
                          key={ep.id}
                          className={`row-hover flex items-center gap-3 px-4 py-3 ${i < endpoints.length - 1 ? 'border-b border-border' : ''}`}
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
                              <span className="method-chip">{ep.method}</span>
                              <span className="truncate font-mono text-xs">{ep.label}</span>
                            </div>
                            {flag && (
                              <div className={`mt-0.5 text-xs ${STATUS_COLOR.warn}`}>
                                Disabled: {flag.reason} · <TimeAgo ts={flag.since} />
                              </div>
                            )}
                            {/* Render-style uptime bars for this endpoint — filled by
                                the background sweep + "re-run all checks" above. */}
                            {uptime[ep.id] && (
                              <div className="mt-2 max-w-md">
                                <UptimeBars buckets={uptime[ep.id].buckets} uptimePct={uptime[ep.id].uptimePct} />
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </Card>
                </div>
                )
              })}
            </section>
          )}

        {tab === 'suggestions' && (
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
          )}

        {tab === 'admins' && (
            <section>
              <p className="mb-4 text-xs text-muted-foreground">
                Who may sign in to this dashboard. Emails seeded via <span className="font-mono">ADMIN_EMAILS</span>{" "}
                are env-managed; invite anyone else here and they can log in with the emailed code immediately — no
                redeploy needed. The allowlist lives in Supabase (<span className="font-mono">admin_emails</span>),
                so a restart never forgets an invite.
              </p>

              <Card className="p-4">
                <label htmlFor="invite-email" className="mb-1.5 block text-xs font-semibold">
                  Invite an admin
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="invite-email"
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') inviteAdmin()
                    }}
                    placeholder="teammate@example.com"
                    className="h-11 flex-1 text-sm"
                    autoComplete="off"
                  />
                  <Button
                    onClick={inviteAdmin}
                    disabled={inviting || !inviteEmail.trim()}
                    className="h-11 gap-1.5 text-sm"
                  >
                    {inviting ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <UserPlus className="size-4" />
                    )}
                    {inviting ? 'Inviting…' : 'Invite'}
                  </Button>
                </div>
                {!adminsDbOk && (
                  <p className={`mt-2 text-xs ${STATUS_COLOR.err}`}>
                    Couldn&apos;t reach the admin table — showing <span className="font-mono">ADMIN_EMAILS</span>{" "}
                    only. Invites will fail until Supabase is reachable.
                  </p>
                )}
              </Card>

              <div className="mt-4 space-y-2">
                {admins.map((a) => (
                  <Card key={a.email} className="flex flex-wrap items-center gap-3 p-3">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold">{a.email}</span>
                    <Badge
                      className={`font-semibold ${a.source === 'env' ? STATUS_BADGE.dim : STATUS_BADGE.accent}`}
                    >
                      {a.source === 'env' ? 'env · ADMIN_EMAILS' : 'invited'}
                    </Badge>
                    <Badge
                      className={`font-semibold ${
                        a.role === 'curator' ? 'bg-blue-500/15 text-blue-400' : 'bg-emerald-500/15 text-emerald-400'
                      }`}
                    >
                      {a.role === 'curator' ? 'CURATOR' : 'ADMIN'}
                    </Badge>
                    {a.source === 'supabase' && (
                      <span className="text-xs text-muted-foreground">
                        by {a.invitedBy ?? 'unknown'}
                        {a.createdAt ? (
                          <>
                            {' '}· <TimeAgo ts={a.createdAt} />
                          </>
                        ) : null}
                      </span>
                    )}
                    {a.source === 'supabase' && (
                      <>
                        <Button
                          onClick={() => toggleCuratorRole(a.email, a.role)}
                          variant="outline"
                          size="sm"
                          className="h-9 text-xs"
                        >
                          {a.role === 'curator' ? 'Make admin' : 'Make curator'}
                        </Button>
                        <Button
                          onClick={() => revokeAdmin(a.email)}
                          variant="outline"
                          size="sm"
                          className={`h-9 text-xs ${STATUS_COLOR.err}`}
                        >
                          Revoke
                        </Button>
                      </>
                    )}
                  </Card>
                ))}
              </div>
            </section>
          )}

        {tab === 'audit' && (
            <section>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                  Sign-in events (magic-link requests, code verifications, logins). Written to the Supabase{" "}
                  <span className="font-mono">auth_log</span> table so a restart never loses the trail.
                </p>
                <Badge
                  className={`font-semibold ${
                    authLogSource === 'supabase' ? STATUS_BADGE.accent : STATUS_BADGE.dim
                  }`}
                >
                  {authLogSource === 'supabase' ? 'durable · supabase' : 'in-memory only'}
                </Badge>
              </div>

              {authLog.length === 0 ? (
                <Card className="p-8 text-center">
                  <p className="text-sm font-semibold text-muted-foreground">No auth events yet</p>
                  <p className="mx-auto mt-1 max-w-[45ch] text-xs text-muted-foreground/80">
                    Sign-in attempts will appear here as they happen. If this stays empty, the Supabase migration
                    (0011) may not be applied — events still work in-memory.
                  </p>
                </Card>
              ) : (
                <Card className="overflow-hidden gap-0 py-0">
                  {authLog.map((ev, i) => (
                    <div
                      key={`${ev.at}-${i}`}
                      className={`flex items-center gap-3 px-3 py-2.5 ${
                        i < authLog.length - 1 ? 'border-b border-border' : ''
                      }`}
                    >
                      {ev.ok ? (
                        <CheckCircle2 className="size-4 shrink-0 text-green-600 dark:text-green-400" />
                      ) : (
                        <X className="size-4 shrink-0 text-destructive" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-semibold">
                          {ev.action}
                          {ev.email ? <span className="text-muted-foreground"> · {ev.email}</span> : null}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {ev.ip}
                          {ev.detail ? ` · ${ev.detail}` : null}
                        </div>
                      </div>
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        <TimeAgo ts={ev.at} />
                      </span>
                    </div>
                  ))}
                </Card>
              )}
            </section>
          )}

        {tab === 'load' && <LoadPanel />}

        {tab === 'settings' && <SettingsPanel onNotify={pushToast} />}

        {tab === 'stops' && <StopsPanel role={role ?? 'curator'} onNotify={pushToast} onTotpFetch={totpAwareFetch} />}

        {tab === 'guide' && (
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
              <p className="mt-5 mb-3 text-xs text-muted-foreground">
                Version log — what shipped in the latest batch and how the frontend should consume the API at
                scale. Also served at <span className="font-mono">/version-log-2026-08-09.html</span> for the frontend team.
              </p>
              <Card className="overflow-hidden p-0">
                <iframe
                  title="API Version Log 2026-08-09"
                  src="/version-log-2026-08-09.html"
                  sandbox="allow-scripts allow-same-origin"
                  className="h-[75vh] w-full border-0 bg-background"
                />
              </Card>
            </section>
          )}
      </main>
      </SidebarInset>
      </SidebarProvider>

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
              it. Flags persist in Supabase, so a redeploy won&apos;t re-enable it.
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

      {/* TOTP challenge — a sensitive action needs a fresh authenticator code */}
      <Dialog
        open={totpPrompt !== null}
        onOpenChange={(open) => {
          if (!open && !totpVerifying) {
            totpPrompt?.resolve(false)
            setTotpPrompt(null)
            setTotpCode('')
            setTotpError(null)
          }
        }}
      >
        <DialogPortal>
          <DialogBackdrop />
          <DialogPopup>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <KeyRound className="size-4 text-emerald-400" />
              Authenticator code required
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              This action is sensitive and needs a fresh code from Google Authenticator. It unlocks
              sensitive actions for 5 minutes.
            </DialogDescription>
            <div className="mt-4">
              <label htmlFor="totp-challenge-code" className="mb-1.5 block text-xs font-semibold">
                Authenticator code
              </label>
              <Input
                id="totp-challenge-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={totpCode}
                onChange={(e) => {
                  setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                  setTotpError(null)
                }}
                placeholder="000000"
                className="h-11 text-center font-mono text-lg tracking-[0.45em]"
                autoFocus
              />
              {totpError && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
                  <TriangleAlert className="mt-px size-3.5 shrink-0" />
                  {totpError}
                </p>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  totpPrompt?.resolve(false)
                  setTotpPrompt(null)
                  setTotpCode('')
                  setTotpError(null)
                }}
                disabled={totpVerifying}
                className="h-9 text-xs"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={submitTotpCode}
                disabled={totpVerifying || totpCode.length !== 6}
                className="h-9 text-xs"
              >
                {totpVerifying ? <Loader2 className="size-3.5 animate-spin" /> : 'Confirm code'}
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
