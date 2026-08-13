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
import { AnimatePresence } from 'motion/react'
import {
  ArrowsClockwise,
  Bug,
  CheckCircle,
  CircleNotch,
  Copy,
  Database,
  DotsThree,
  Key,
  MapPin,
  Moon,
  Scroll,
  ShareNetwork,
  ShieldWarning,
  Sun,
  Triangle,
  UserPlus,
  WarningCircle,
  Wrench,
  X,
} from '@phosphor-icons/react'
import { ENDPOINT_REGISTRY, type EndpointRegistryEntry } from '@/lib/api/endpoint-registry'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogBackdrop,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogPopup,
  AlertDialogPortal,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { MAINTENANCE_GUIDE_HTML } from '@/lib/admin/maintenance-guide-html'
import UptimeBars, { type UptimeDay } from '@/components/uptime-bars'
import SseMonitor, { type SseMonitorHandle } from '@/components/admin/sse-monitor'
import { CommandPalette } from '@/components/admin/command-palette'
import { NotificationCenter, type AdminNotification } from '@/components/admin/notification-center'
import LoadPanel from '@/components/admin/load-panel'
import { SettingsPanel } from '@/components/admin/settings-panel'
import { WelcomeOverlay } from '@/components/admin/welcome-overlay'
import { StopsPanel } from '@/components/admin/stops-panel'
import { OtpSlots } from '@/components/admin/otp-slots'
import {
  AppSidebar,
  NAV_GROUPS,
  type ConsoleSection,
  type AdminRole,
} from '@/components/app-sidebar'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'

// Status colors route through the semantic tokens in globals.css: --brand
// (emerald, the single accent) with --success / --warning / --danger. Everything
// else uses shadcn's own tokens directly (text-primary, text-destructive, …).
const STATUS_COLOR = {
  good: 'text-success',
  warn: 'text-warning',
  err: 'text-danger',
  accent: 'text-primary',
  dim: 'text-muted-foreground',
} as const

const STATUS_BADGE = {
  good: 'text-success bg-success/10 border-transparent',
  warn: 'text-warning bg-warning/10 border-transparent',
  err: 'text-danger bg-danger/10 border-transparent',
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
// Floor time the post-login welcome overlay stays up, so it never flashes
// instantly on a fast connection even if the first data fetch is quick.
const WELCOME_MIN_MS = 800
const LAST_SEEN_KEY = 'admin-last-seen'
// Console theme — dark is the deliberate default ("checking in at 11pm
// mid-incident" tool); the ivory light mode is the daytime option.
const THEME_KEY = 'busgo-admin-theme'
type ConsoleTheme = 'dark' | 'light'
// Suggestions queue — fixed page size keeps the footer chrome minimal.
const SUGG_PAGE_SIZE = 10

// The one link this dashboard hands out for sharing — a static, riders-only
// guide with no admin surface at all (see frontend/public/guide.html in the
// BusGo_Track repo). Deliberately NOT the same origin/path pattern as
// anything under /admin, so there's no way to fat-finger sharing the wrong
// link. Hardcoded rather than reading FRONTEND_ORIGIN: this points at the
// deployed frontend regardless of which origin the CORS allowlist is
// currently configured for, and middleware.ts's own fallback constant has a
// stray hyphen bug (bus-go-track vs the real busgo-track) that this avoids
// depending on.
// Human labels for the sidebar sections, reused by the header breadcrumb so
// the two never drift (the Cmd+K palette already reuses NAV_GROUPS directly).
const SECTION_LABEL = Object.fromEntries(
  NAV_GROUPS.flatMap((g) => g.items).map((i) => [i.id, i.label])
) as Record<ConsoleSection, string>

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
  totp?: { enabled: boolean; pending: boolean; dbOk: boolean }
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

// ─── skeleton / stat primitives ───────────────────────────────────────────────
function SkeletonBox({ className }: { className?: string }) {
  return <span className={`inline-block animate-pulse rounded bg-muted ${className ?? ''}`} />
}

interface StatDef {
  icon: ReactNode
  label: string
  value: ReactNode
  valueClass?: string
  pulse?: boolean
}

function StatPanel({ icon, label, value, valueClass, pulse = false }: StatDef) {
  return (
    <div className="relative flex items-center gap-4 px-4 py-4 sm:px-5">
      {/* Status rail — the only per-cell color; everything else is neutral. */}
      <span
        className={`absolute top-4 bottom-4 left-0 w-[2px] rounded-full ${
          pulse ? 'bg-warning/70 status-breathe' : 'bg-border'
        }`}
      />
      <div className="min-w-0">
        <div className={`text-2xl leading-none font-bold tracking-tight tabular-nums ${valueClass ?? 'text-foreground'}`}>
          {value}
        </div>
        <div className="mt-1 text-xs leading-tight font-medium tracking-wide text-muted-foreground uppercase">
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

// Secondary header actions live behind a kebab menu so the header stays to a
// single line. The community guide link (shareable, riders-only) and Debug
// Mode are rare actions — they don't each earn a permanent button.
function HeaderActionsMenu() {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const copyGuide = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(COMMUNITY_GUIDE_URL)
    } catch {
      // Clipboard API can fail (permissions, insecure context) — the link
      // is still visible via the item's title, so this is a
      // degraded-but-not-broken outcome, not worth surfacing an error for.
      return
    }
    setCopied(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), 1800)
  }, [])

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  // Debug Mode (stop rename/delete/add) used to be a toggle any rider could
  // find in the app's own Preferences screen — a real problem, since it
  // writes to the live database and only an admin token gated whether those
  // writes actually landed. It's no longer discoverable there at all; this
  // menu item (and GET /admin/debug, which it calls) is now the only way in.
  // That route redirects to the frontend with the token in a URL FRAGMENT
  // (`#admin_debug=...`), never a query param, so it's never sent to any
  // server or written to a server access log on the frontend's end — the
  // frontend's AppContext reads it client-side on load and strips it
  // immediately. Only ever click this on a device you trust with the token.
  const launchDebug = useCallback(() => {
    // The session cookie authenticates the request; the route mints a
    // short-lived token for the frontend (see app/admin/debug/route.ts).
    window.open('/admin/debug', '_blank', 'noopener,noreferrer')
  }, [])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" className="h-9 w-9 px-0" aria-label="More actions" />
        }
      >
        <DotsThree className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onClick={copyGuide} title={COMMUNITY_GUIDE_URL} className="gap-2">
          <ShareNetwork className="size-4" />
          {copied ? 'Copied!' : 'Copy community guide link'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={launchDebug} className="gap-2">
          <Wrench className="size-4" />
          Open app in Debug Mode
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
  // Signed-in identity for the sidebar footer + settings Profile card. The
  // email is load-bearing for “am I even signed in?” — showing it answers the
  // question that a bare nav can't (which links appear depends on role).
  const [me, setMe] = useState<{ email: string; displayName: string | null } | null>(null)
  // Theme: an explicit toggle choice (stored in localStorage) wins; otherwise
  // follow the OS preference live, defaulting to dark when it's unavailable.
  const [theme, setTheme] = useState<ConsoleTheme>('dark')
  useEffect(() => {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'light' || saved === 'dark') {
      setTheme(saved)
      return
    }
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const apply = () => {
      // The toggle writes THEME_KEY — once the user chooses, stop tracking.
      if (!localStorage.getItem(THEME_KEY)) setTheme(mq.matches ? 'light' : 'dark')
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  // Radix portals (menus, selects, dialogs, the command palette, toasts) render
  // on document.body — outside the theme wrapper div — so they'd otherwise fall
  // back to the light :root tokens and flash a white popover in dark mode.
  // Mirror the theme class onto <html> so every overlay inherits the console
  // tokens; remove it on unmount so the public page stays untouched.
  useEffect(() => {
    const el = document.documentElement
    el.classList.toggle('dark', theme === 'dark')
    el.classList.toggle('admin-light', theme === 'light')
    return () => el.classList.remove('dark', 'admin-light')
  }, [theme])
  // Imperative handle to the SSE card — lets the Cmd+K palette start the
  // live monitor without the palette knowing anything about EventSource.
  const sseRef = useRef<SseMonitorHandle>(null)
  const [issueFilter, setIssueFilter] = useState<'all' | 'errors' | 'bugs' | 'open'>('open')
  const [query, setQuery] = useState('')
  // Suggestions pagination — the queue can grow past a screenful.
  const [suggPage, setSuggPage] = useState(1)
  // Reference docs — one iframe, tabbed, instead of two stacked 75vh frames.
  const [guideTab, setGuideTab] = useState<'guide' | 'version'>('guide')

  // Action feedback + dialogs (replaces the old window.prompt flow)
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

  // Data freshness. lastUpdated is also the "first successful load happened"
  // signal for notification seeding — it's tracked but no longer shown in the
  // header (the per-second "updated Xs ago" text was the P1 clutter).
  const [loading, setLoading] = useState(true)
  // Post-login welcome overlay — shown once, only right after a fresh sign-in
  // (both the typed-code and magic-link paths redirect here with ?welcome=1).
  // A plain refresh of an already-active session has no ?welcome= param, so
  // it skips straight to the dashboard.
  const [showWelcome, setShowWelcome] = useState(false)
  const welcomeShownAtRef = useRef<number | null>(null)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('welcome') === '1') {
      setShowWelcome(true)
      window.history.replaceState({}, '', '/admin')
    }
  }, [])
  // The floor timer can only start once the overlay is actually reachable —
  // it can't render before authState === 'in' (the "Checking session…" card
  // occupies the screen until then), so starting the clock any earlier would
  // let that screen eat into the floor and defeat its whole purpose.
  useEffect(() => {
    if (!showWelcome || authState !== 'in' || welcomeShownAtRef.current !== null) return
    welcomeShownAtRef.current = Date.now()
  }, [showWelcome, authState])
  // Stays up until the real first data load finishes, with a minimum floor
  // so it's never just a flash on a fast connection.
  useEffect(() => {
    if (!showWelcome || loading) return
    const elapsed = Date.now() - (welcomeShownAtRef.current ?? Date.now())
    const remaining = Math.max(0, WELCOME_MIN_MS - elapsed)
    const t = setTimeout(() => setShowWelcome(false), remaining)
    return () => clearTimeout(t)
  }, [showWelcome, loading])
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [pollFailed, setPollFailed] = useState(false)

  // Active load-alert count for the sidebar's red dot. Polled independently
  // of the Load section so a spike surfaces no matter which section is open
  // (the poll also keeps threshold evaluation running while Load is closed).
  const [activeAlerts, setActiveAlerts] = useState(0)
  // Full alert items — the notification feed diffs these for new episodes.
  const [activeAlertItems, setActiveAlertItems] = useState<
    Array<{ kind: string; severity: string; value: number; threshold: number; state: string; at: number }>
  >([])
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const res = await fetch('/api/admin/metrics', { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) {
          setActiveAlerts(data.alerts?.active?.length ?? 0)
          setActiveAlertItems(data.alerts?.active ?? [])
        }
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
  // Per-row busy tracking so a fast double-click can't fire the same mutating
  // request twice — each Set holds the id/email/endpoint currently in flight.
  const [suggPending, setSuggPending] = useState<Map<number, 'approve' | 'reject'>>(new Map())
  const [bugPending, setBugPending] = useState<Set<string>>(new Set())
  const [adminPending, setAdminPending] = useState<Set<string>>(new Set())
  const [endpointPending, setEndpointPending] = useState<Set<string>>(new Set())

  // Durability + audit trail (see lib/api/maintenance-store.ts / auth-log.ts)
  const [maintDurable, setMaintDurable] = useState(false)
  const [maintLastHydratedAt, setMaintLastHydratedAt] = useState<number | null>(null)
  const [authLog, setAuthLog] = useState<AuthLogEvent[]>([])
  const [authLogSource, setAuthLogSource] = useState<'supabase' | 'memory' | null>(null)

  // People page — who's actually using the console, derived from the audit
  // log the dashboard already polls. An admin is "active" once a login event
  // lands; last-active is their most recent ok auth event of any kind.
  const adminActivity = useMemo(() => {
    const lastLogin = new Map<string, number>()
    const lastActive = new Map<string, number>()
    for (const ev of authLog) {
      if (!ev.email) continue
      if (ev.ok && (ev.action === 'login' || ev.action === 'magic-link-login')) {
        lastLogin.set(ev.email, Math.max(lastLogin.get(ev.email) ?? 0, ev.at))
      }
      if (ev.ok) {
        lastActive.set(ev.email, Math.max(lastActive.get(ev.email) ?? 0, ev.at))
      }
    }
    return { lastLogin, lastActive }
  }, [authLog])

  // 2FA coverage line above the People table (best-effort — only when the
  // TOTP store answered).
  const totpSummary = useMemo(() => {
    const known = admins.filter((a) => a.totp)
    return { known: known.length, enabled: known.filter((a) => a.totp?.enabled).length }
  }, [admins])

  // Per-admin activity drill-down (Sheet) — same audit log, filtered to one email.
  const [activityEmail, setActivityEmail] = useState<string | null>(null)
  const activityEvents = useMemo(
    () => (activityEmail ? authLog.filter((ev) => ev.email === activityEmail) : []),
    [activityEmail, authLog]
  )

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

  // Toast via shadcn Sonner — keeps the exact same call-site interface, so
  // every onNotify/pushToast consumer works unchanged.
  const pushToast = useCallback((message: string, kind: 'success' | 'error' = 'success') => {
    if (kind === 'error') toast.error(message)
    else toast.success(message)
  }, [])

  // ─── Live notification feed ───────────────────────────────────────────────
  // Diffs errors/bugs/suggestions/load-alerts between polls and surfaces NEW
  // items as notifications (bell badge + toast). The first real data load
  // seeds the seen-set silently so a fresh login isn't greeted by a wall of
  // notifications for everything already in the system.
  const [notifications, setNotifications] = useState<AdminNotification[]>([])
  const notifiedKeysRef = useRef<Set<string>>(new Set())
  const seededRef = useRef(false)
  useEffect(() => {
    // Seed only after the first successful data load — a failed initial poll
    // (loading → false, no data) must not count as the seed, or the next
    // successful poll would flood notifications for everything already known.
    if (authState !== 'in' || loading || lastUpdated === null) return
    const fresh: AdminNotification[] = []
    const seen = notifiedKeysRef.current

    for (const e of errors) {
      const key = `err:${e.path}:${e.status}:${e.message}`
      if (seen.has(key)) continue
      seen.add(key)
      if (seededRef.current) {
        fresh.push({
          id: key,
          kind: 'issue',
          title: `${e.status} · ${e.method} ${e.path}`,
          detail: e.message,
          section: 'issues',
          ts: e.lastAt,
          read: false,
        })
      }
    }
    for (const r of bugReports) {
      if (r.status !== 'open') continue
      const key = `bug:${r.id}`
      if (seen.has(key)) continue
      seen.add(key)
      if (seededRef.current) {
        fresh.push({
          id: key,
          kind: 'issue',
          title: 'New bug report',
          detail: r.subject,
          section: 'issues',
          ts: r.createdAt,
          read: false,
        })
      }
    }
    for (const s of stopSuggestions) {
      if (s.status !== 'pending') continue
      const key = `sug:${s.id}`
      if (seen.has(key)) continue
      seen.add(key)
      if (seededRef.current) {
        const what = s.type === 'add' ? 'New stop' : s.type === 'rename' ? 'Rename' : 'Delete'
        fresh.push({
          id: key,
          kind: 'suggestion',
          title: `${what} suggestion`, // "New stop suggestion" / "Rename suggestion"
          detail: s.proposed_name ?? s.stop_id ?? '',
          section: 'suggestions',
          ts: new Date(s.created_at).getTime(),
          read: false,
        })
      }
    }
    for (const a of activeAlertItems) {
      if (a.state !== 'triggered') continue
      const key = `alert:${a.kind}:triggered`
      if (seen.has(key)) continue
      seen.add(key)
      if (seededRef.current) {
        fresh.push({
          id: key,
          kind: 'alert',
          title: a.kind === 'requests_per_min' ? 'Request rate high' : 'Rate-limit trips',
          detail: `${a.value} vs threshold ${a.threshold}`,
          section: 'load',
          ts: a.at || Date.now(),
          read: false,
        })
      }
    }

    seededRef.current = true
    if (fresh.length === 0) return

    const batch = fresh.slice(0, 8)
    setNotifications((prev) => [...batch, ...prev].slice(0, 50))
    const hasAlert = batch.some((n) => n.kind === 'alert')
    const hasIssue = batch.some((n) => n.kind === 'issue')
    pushToast(
      `${batch.length} new notification${batch.length === 1 ? '' : 's'}`,
      hasAlert || hasIssue ? 'error' : 'success'
    )
  }, [authState, loading, lastUpdated, errors, bugReports, stopSuggestions, activeAlertItems, pushToast])

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
      // Role re-read every refresh — a revoke takes effect immediately. The
      // display name follows so the sidebar identity stays fresh.
      const meData = await meRes.json().catch(() => ({}))
      if (meRes.ok && meData?.role) setRole(meData.role)
      if (meRes.ok && meData?.email) setMe({ email: meData.email, displayName: meData.displayName ?? null })
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

  // Cmd+K palette "Start live SSE monitor": hop to the Endpoints section
  // (where the card mounts) and fire its handle once the tab has rendered.
  const startSseFromPalette = useCallback(() => {
    setTab('endpoints')
    requestAnimationFrame(() => sseRef.current?.start())
  }, [])

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
      setAdminPending((prev) => new Set(prev).add(email))
      try {
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
      } finally {
        setAdminPending((prev) => {
          const next = new Set(prev)
          next.delete(email)
          return next
        })
      }
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
          setAdminPending((prev) => new Set(prev).add(email))
          try {
            const res = await totpAwareFetch(`/api/admin/admins?email=${encodeURIComponent(email)}`, { method: 'DELETE' })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) pushToast(data?.error ?? 'Could not revoke that email', 'error')
            else pushToast(`${email} revoked`)
            refreshAll()
          } finally {
            setAdminPending((prev) => {
              const next = new Set(prev)
              next.delete(email)
              return next
            })
          }
        },
      })
    },
    [pushToast, refreshAll, totpAwareFetch]
  )

  const resolveStopSuggestion = useCallback(async (id: number, decision: 'approve' | 'reject') => {
    setSuggPending((prev) => new Map(prev).set(id, decision))
    try {
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
    } finally {
      setSuggPending((prev) => {
        const next = new Map(prev)
        next.delete(id)
        return next
      })
    }
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
        try {
          const res = await fetch('/api/errors', { method: 'DELETE' })
          if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            pushToast(data?.error ?? 'Could not clear the error ledger', 'error')
            return
          }
          pushToast('Error ledger cleared')
        } catch {
          pushToast('Could not reach the API', 'error')
        } finally {
          refreshAll()
        }
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
        try {
          const res = await fetch('/api/feedback', { method: 'DELETE' })
          if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            pushToast(data?.error ?? 'Could not clear bug reports', 'error')
            return
          }
          pushToast('Bug reports cleared')
        } catch {
          pushToast('Could not reach the API', 'error')
        } finally {
          refreshAll()
        }
      },
    })
  }, [pushToast, refreshAll, source.bugs])

  const resolveBugReport = useCallback(async (id: string) => {
    setBugPending((prev) => new Set(prev).add(id))
    try {
      const res = await fetch('/api/feedback', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        pushToast(data?.error ?? 'Could not resolve that report', 'error')
        return
      }
      refreshAll()
      pushToast('Bug report marked resolved')
    } finally {
      setBugPending((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }, [pushToast, refreshAll])

  // Enabling is the recovery path and stays instant; disabling goes through the
  // reason dialog so Cancel is always a no-op (the old window.prompt fallback
  // actually disabled the endpoint even when the user cancelled).
  const enableEndpoint = useCallback(async (ep: EndpointRegistryEntry) => {
    setEndpointPending((prev) => new Set(prev).add(ep.id))
    try {
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
    } finally {
      setEndpointPending((prev) => {
        const next = new Set(prev)
        next.delete(ep.id)
        return next
      })
    }
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

  // Resolve `me` as early as possible, independent of the main refreshAll
  // polling cycle — it drives the welcome overlay's greeting name, and
  // waiting on the full Promise.all batch in refreshAll meant `me` was still
  // null for essentially the overlay's whole visible life. refreshAll keeps
  // re-fetching this on every poll too; this is just a faster first read.
  useEffect(() => {
    if (authState !== 'in') return
    let cancelled = false
    fetch('/api/admin/me', { cache: 'no-store' })
      .then((res) => res.json().catch(() => ({})))
      .then((meData) => {
        if (!cancelled && meData?.email) {
          setMe({ email: meData.email, displayName: meData.displayName ?? null })
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
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

  // Suggestions queue — paginated so it stays a tool, not an endless scroll.
  const suggPageCount = Math.max(1, Math.ceil(stopSuggestions.length / SUGG_PAGE_SIZE))
  const safeSuggPage = Math.min(suggPage, suggPageCount)
  const suggVisible = stopSuggestions.slice((safeSuggPage - 1) * SUGG_PAGE_SIZE, safeSuggPage * SUGG_PAGE_SIZE)

  const overallStatus = disabledCount > 0
    ? { label: 'Endpoints disabled', variant: 'warn' as const }
    : openCount > 0
      ? { label: 'Open issues', variant: 'warn' as const }
      : { label: 'All clear', variant: 'good' as const }

  const processUptimeMs = processStartedAt ? now - processStartedAt : null
  const showRestartNudge = processUptimeMs !== null && processUptimeMs < RECENT_RESTART_MS

  // The stat bar only appears where its numbers are actionable — Issues
  // (open issues, bug reports), Endpoints (disabled count), Suggestions —
  // instead of repeating the same four cells on every panel.
  const statsByTab: Record<string, StatDef[]> = {
    issues: [
      {
        icon: <Triangle className="size-3.5" />,
        label: 'Open issues',
        pulse: openCount > 0,
        valueClass: openCount > 0 ? STATUS_COLOR.warn : STATUS_COLOR.good,
        value: loading ? <SkeletonBox className="h-7 w-10" /> : openCount,
      },
      {
        icon: <Bug className="size-3.5" />,
        label: 'Bug reports',
        value: loading ? <SkeletonBox className="h-7 w-10" /> : bugReports.length,
      },
    ],
    endpoints: [
      {
        icon: <ShieldWarning className="size-3.5" />,
        label: 'Endpoints disabled',
        pulse: disabledCount > 0,
        valueClass: disabledCount > 0 ? STATUS_COLOR.warn : undefined,
        value: loading ? <SkeletonBox className="h-7 w-10" /> : disabledCount,
      },
    ],
    suggestions: [
      {
        icon: <MapPin className="size-3.5" />,
        label: 'Suggestions',
        pulse: stopSuggestions.length > 0,
        valueClass: stopSuggestions.length > 0 ? STATUS_COLOR.warn : undefined,
        value: loading ? <SkeletonBox className="h-7 w-10" /> : stopSuggestions.length,
      },
    ],
  }
  const activeStats = statsByTab[tab] ?? []

  // ─── Session check screen ────────────────────────────────────────────────
  // 'out' redirects to /goToAdminAuth via the effect above; this just covers
  // the brief 'checking' moment so there's no flash of the dashboard.
  if (authState !== 'in') {
    return (
      <div className="dark flex min-h-[100dvh] items-center justify-center bg-background px-4 text-foreground">
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
    <div className={`${theme === 'dark' ? 'dark' : 'admin-light'} min-h-[100dvh] bg-background text-foreground`}>
      {/* Fixed film grain — one paint layer, never intercepts input (see .admin-grain). */}
      <div aria-hidden className="admin-grain" />
      {/* shadcn Sonner toasts — follows the console theme, bottom-right like the old stack. */}
      <Toaster theme={theme} position="bottom-right" richColors />
      <AnimatePresence>
        {showWelcome && (
          <WelcomeOverlay name={me?.displayName || me?.email?.split('@')[0] || 'there'} />
        )}
      </AnimatePresence>

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
          theme={theme}
          counts={{ issues: openCount, suggestions: stopSuggestions.length, loadAlerts: activeAlerts }}
          onNavigate={(s) => setTab(s)}
          onLogout={logout}
          user={me ? { ...me, role } : null}
        />
        <SidebarInset className="bg-background">
          <header className="sticky top-0 z-40 flex h-(--header-height) shrink-0 items-center gap-2 border-b border-border bg-background px-4 md:px-6">
            <SidebarTrigger className="-ml-1 md:hidden" />
            <Badge
              variant="outline"
              className={`hidden gap-1 font-semibold sm:inline-flex ${
                overallStatus.variant === 'good' ? STATUS_BADGE.good : STATUS_BADGE.warn
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${
                  overallStatus.variant === 'good' ? 'bg-success' : 'bg-warning status-breathe'
                }`}
              />
              {overallStatus.label}
            </Badge>
            <Breadcrumb className="min-w-0">
              <BreadcrumbList className="gap-1">
                <BreadcrumbItem>
                  <span className="text-xs font-medium text-muted-foreground">Console</span>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="text-muted-foreground/60" />
                <BreadcrumbItem>
                  <BreadcrumbPage className="truncate text-sm font-semibold tracking-tight">
                    {SECTION_LABEL[tab]}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              {pollFailed && (
                <span className="hidden font-medium text-destructive sm:inline">Can&apos;t reach the API · retrying…</span>
              )}
              <NotificationCenter
                notifications={notifications}
                onSelect={(section) => {
                  setTab(section)
                  setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
                }}
                onMarkAllRead={() => setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))}
              />
              <Button
                onClick={() => {
                  const next: ConsoleTheme = theme === 'dark' ? 'light' : 'dark'
                  setTheme(next)
                  localStorage.setItem(THEME_KEY, next)
                }}
                variant="outline"
                size="sm"
                className="h-9 w-9 px-0"
                aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                title={theme === 'dark' ? 'Switch to the ivory light mode' : 'Switch back to dark mode'}
              >
                {theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
              </Button>
              <Button
                onClick={refreshAll}
                variant="outline"
                size="sm"
                className="h-9 gap-1 text-xs"
                aria-label="Refresh dashboard data"
              >
                <ArrowsClockwise className="size-3.5" /> Refresh
              </Button>
              <HeaderActionsMenu />
            </div>
          </header>

      <main className="@container/main flex flex-1 flex-col gap-4 p-4 md:p-6">
        {idleWarning && (
          <Alert className="mb-4 border-warning/40 bg-warning/10">
            <Triangle className="size-4 text-warning" />
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

        {/* Stat bar — scoped to the panels whose numbers it summarizes
            (see statsByTab above), with cells carrying a status rail instead
            of a box each. Numbers are tabular and tracking-tight. */}
        {activeStats.length > 0 && (
          activeStats.length === 1 ? (
            <Card className="mb-6 overflow-hidden gap-0 py-0 sm:max-w-md">
              <StatPanel {...activeStats[0]} />
            </Card>
          ) : (
            <Card className="mb-6 overflow-hidden gap-0 py-0">
              <div className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-4 sm:divide-y-0">
                {activeStats.map((s) => (
                  <StatPanel key={s.label} {...s} />
                ))}
              </div>
            </Card>
          )
        )}

        {/* Sections — the sidebar owns navigation now (see AppSidebar). */}
        {tab === 'issues' && (
            <section>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <Tabs value={issueFilter} onValueChange={(v) => setIssueFilter(v as typeof issueFilter)}>
                  <TabsList variant="line" className="h-9">
                    {(['open', 'all', 'errors', 'bugs'] as const).map((f) => (
                      <TabsTrigger key={f} value={f} className="h-8 px-3 text-xs font-semibold capitalize">
                        {f}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
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
                  <span className="inline-flex size-12 items-center justify-center rounded-full border border-success/20 bg-success/10">
                    <CheckCircle className={`size-6 ${STATUS_COLOR.good}`} />
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
                <div className="overflow-hidden rounded-2xl border border-border">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-border' : ''}`}>
                      <SkeletonBox className="h-2 w-2 rounded-full" />
                      <SkeletonBox className="h-4 w-1/3" />
                      <SkeletonBox className="ml-auto h-3 w-16" />
                    </div>
                  ))}
                </div>
              ) : (
              <Card className="overflow-hidden p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Kind</TableHead>
                      <TableHead>Issue</TableHead>
                      <TableHead className="text-right">Occurrences</TableHead>
                      <TableHead>Last seen</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredIssues.map((item) => {
                      const isNew = lastSeenAtRef.current !== null && item.timestamp > lastSeenAtRef.current
                      return (
                        <TableRow key={item.id} className={item.resolved ? 'opacity-55' : ''}>
                          <TableCell>
                            <Badge
                              className={`font-semibold ${item.kind === 'error' ? STATUS_BADGE.err : STATUS_BADGE.accent}`}
                            >
                              {item.kind === 'error' ? 'ERROR' : 'BUG'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-xs font-semibold">{item.title}</span>
                              {isNew && (
                                <Badge className={`font-semibold ${STATUS_BADGE.accent}`}>
                                  since you last looked
                                </Badge>
                              )}
                            </div>
                            <div className="mt-1 text-xs whitespace-pre-wrap">{item.detail}</div>
                            {item.meta && (
                              <div className="text-xs text-muted-foreground">
                                from: <PageUrlLink url={item.meta} />
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {item.count && item.count > 1 ? (
                              <Badge className={`font-semibold ${STATUS_BADGE.warn}`}>×{item.count}</Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">{item.count ?? 1}</span>
                            )}
                            {item.resolved && (
                              <Badge className={`ml-1.5 font-semibold ${STATUS_BADGE.dim}`}>resolved</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            <TimeAgo ts={item.timestamp} />
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              {item.onResolve && !item.resolved && (
                                <Button
                                  onClick={item.onResolve}
                                  variant="outline"
                                  size="sm"
                                  disabled={bugPending.has(item.id.slice(4))}
                                  className={`h-9 text-xs ${STATUS_COLOR.good}`}
                                >
                                  {bugPending.has(item.id.slice(4)) ? (
                                    <CircleNotch className="size-3.5 animate-spin" />
                                  ) : null}
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
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </Card>
              )}

              <p className="mt-4 text-xs text-muted-foreground">
                Errors: {source.errors === 'supabase' ? 'durable' : 'in-memory only'} · Bug reports: {source.bugs === 'supabase' ? 'durable' : 'in-memory only'}.
              </p>
            </section>
          )}

        {tab === 'endpoints' && (
            <section>
              {showRestartNudge && (
                <Alert className="mb-4 border-warning/40 bg-warning/10">
                  <Triangle className="size-4 text-warning" />
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
              {/* Diagnostics — admin-only. These used to sit on the public page
                  where every visitor's browser would self-probe the API; both
                  actions are now server-side and gated. */}
              <Card className="mb-4 gap-3 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    onClick={runChecks}
                    disabled={checksRunning}
                    size="sm"
                    className="h-9 gap-1 bg-brand text-xs font-semibold text-brand-foreground shadow-brand transition-[transform,background-color] hover:bg-brand active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60"
                  >
                    {checksRunning ? (
                      <CircleNotch className="size-3.5 animate-spin" />
                    ) : (
                      <ArrowsClockwise className="size-3.5" />
                    )}
                    {checksRunning ? 'Checking…' : 'Re-run all checks'}
                  </Button>
                  <SseMonitor ref={sseRef} />
                </div>
                <p className="text-xs text-muted-foreground">
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
                    : 'border-warning/30 bg-warning/10 text-warning'
                }`}
              >
                {maintDurable ? (
                  <Database className="size-4 shrink-0" />
                ) : (
                  <Triangle className="size-4 shrink-0" />
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
                <div className="mb-4 flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
                  <CheckCircle className="size-4 shrink-0" />
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
                <div key={group} className="mb-4">
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className={`size-1.5 rounded-full ${
                        groupDisabled ? 'bg-warning status-breathe' : 'bg-brand/80'
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
                              disabled={endpointPending.has(ep.id)}
                              onCheckedChange={() => {
                                if (disabled) {
                                  enableEndpoint(ep)
                                } else {
                                  setDisableReason('Investigating an issue')
                                  setDisableTarget(ep)
                                }
                              }}
                              className="data-checked:bg-success data-unchecked:bg-destructive"
                            />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="method-chip">{ep.method}</span>
                              <span className="truncate font-mono text-xs">{ep.label}</span>
                            </div>
                            {flag && (
                              <div className={`mt-1 text-xs ${STATUS_COLOR.warn}`}>
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
                  <CheckCircle className={`size-10 ${STATUS_COLOR.good}`} />
                  <p className="text-sm font-semibold">Queue is empty</p>
                  <p className="text-xs text-muted-foreground">No pending stop suggestions right now.</p>
                </div>
              )}
              <div className="space-y-2">
                {suggVisible.map((s) => (
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
                          disabled={suggPending.has(s.id)}
                          className={`h-9 gap-1 text-xs ${STATUS_COLOR.good}`}
                          title="Apply this change to the live map (same write the stop editor uses)"
                        >
                          {suggPending.get(s.id) === 'approve' ? (
                            <CircleNotch className="size-3.5 animate-spin" />
                          ) : (
                            <CheckCircle className="size-3.5" />
                          )}
                          Approve
                        </Button>
                        <Button
                          onClick={() => resolveStopSuggestion(s.id, 'reject')}
                          variant="outline"
                          size="sm"
                          disabled={suggPending.has(s.id)}
                          className={`h-9 gap-1 text-xs ${STATUS_COLOR.err}`}
                          title="Drop this suggestion without touching the map"
                        >
                          {suggPending.get(s.id) === 'reject' ? (
                            <CircleNotch className="size-3.5 animate-spin" />
                          ) : (
                            <X className="size-3.5" />
                          )}
                          Reject
                        </Button>
                      </div>
                    </div>
                    {s.reason && <div className="mt-2 text-xs text-muted-foreground">Reason: {s.reason}</div>}
                  </Card>
                ))}
              </div>
              {suggPageCount > 1 && (
                <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                  <span className="text-xs text-muted-foreground">
                    {stopSuggestions.length.toLocaleString()} suggestion{stopSuggestions.length === 1 ? '' : 's'} total
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-9 px-3 text-xs"
                      onClick={() => setSuggPage(safeSuggPage - 1)}
                      disabled={safeSuggPage <= 1}
                    >
                      Prev
                    </Button>
                    <span className="min-w-10 text-center font-mono text-xs text-muted-foreground">
                      {safeSuggPage} / {suggPageCount}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-9 px-3 text-xs"
                      onClick={() => setSuggPage(safeSuggPage + 1)}
                      disabled={safeSuggPage >= suggPageCount}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
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
                <label htmlFor="invite-email" className="mb-2 block text-xs font-semibold">
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
                    className="h-11 gap-1 text-sm"
                  >
                    {inviting ? (
                      <CircleNotch className="size-4 animate-spin" />
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

              {totpSummary.known > 0 ? (
                <p className="mb-2 text-xs text-muted-foreground">
                  <Key className="mr-1 inline size-3" />
                  2FA: {totpSummary.enabled} of {totpSummary.known} admins enrolled
                </p>
              ) : null}

              <Card className="mt-2 overflow-hidden p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>2FA</TableHead>
                      <TableHead>Last active</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {admins.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center text-xs text-muted-foreground">
                          No admins yet — invite the first one above.
                        </TableCell>
                      </TableRow>
                    ) : (
                      admins.map((a) => {
                        const lastActiveTs = adminActivity.lastActive.get(a.email)
                        const hasLoggedIn = adminActivity.lastLogin.has(a.email)
                        const status =
                          a.source === 'env'
                            ? { label: 'env', cls: STATUS_BADGE.dim }
                            : hasLoggedIn
                              ? { label: 'Active', cls: 'bg-success/10 text-success' }
                              : { label: 'Invited · awaiting login', cls: 'bg-warning/10 text-warning' }
                        return (
                          <TableRow key={a.email}>
                            <TableCell>
                              <div className="font-mono text-xs font-semibold">{a.email}</div>
                              <div className="text-xs text-muted-foreground">
                                {a.source === 'supabase' ? (
                                  <>
                                    invited by {a.invitedBy ?? 'unknown'}
                                    {a.createdAt ? (
                                      <>
                                        {' '}· <TimeAgo ts={a.createdAt} />
                                      </>
                                    ) : null}
                                  </>
                                ) : (
                                  'seeded via ADMIN_EMAILS'
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge className={`font-semibold ${status.cls}`}>{status.label}</Badge>
                            </TableCell>
                            <TableCell>
                              {a.totp ? (
                                a.totp.enabled ? (
                                  <Badge className="gap-1 border-transparent bg-success/10 font-semibold text-success">
                                    <Key className="size-3" />
                                    on
                                  </Badge>
                                ) : (
                                  <span className="text-xs font-semibold text-warning">
                                    no 2FA
                                  </span>
                                )
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {lastActiveTs ? <TimeAgo ts={lastActiveTs} /> : '—'}
                            </TableCell>
                            <TableCell>
                              <Badge
                                className={`font-semibold ${
                                  a.role === 'curator'
                                    ? 'bg-brand/15 text-brand'
                                    : 'bg-brand/15 text-brand'
                                }`}
                              >
                                {a.role === 'curator' ? 'CURATOR' : 'ADMIN'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button
                                  onClick={() => setActivityEmail(a.email)}
                                  variant="outline"
                                  size="sm"
                                  className="h-9 text-xs"
                                >
                                  Activity
                                </Button>
                                {a.source === 'supabase' && (
                                  <>
                                    <Button
                                      onClick={() => toggleCuratorRole(a.email, a.role)}
                                      variant="outline"
                                      size="sm"
                                      disabled={adminPending.has(a.email)}
                                      className="h-9 gap-1 text-xs"
                                    >
                                      {adminPending.has(a.email) && <CircleNotch className="size-3.5 animate-spin" />}
                                      {a.role === 'curator' ? 'Make admin' : 'Make curator'}
                                    </Button>
                                    <Button
                                      onClick={() => revokeAdmin(a.email)}
                                      variant="outline"
                                      size="sm"
                                      disabled={adminPending.has(a.email)}
                                      className={`h-9 gap-1 text-xs ${STATUS_COLOR.err}`}
                                    >
                                      {adminPending.has(a.email) && <CircleNotch className="size-3.5 animate-spin" />}
                                      Revoke
                                    </Button>
                                  </>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </Card>
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
                <Card className="overflow-hidden p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Status</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>IP</TableHead>
                        <TableHead className="text-right">When</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {authLog.map((ev, i) => (
                        <TableRow key={`${ev.at}-${i}`}>
                          <TableCell>
                            {ev.ok ? (
                              <CheckCircle className="size-4 text-success" />
                            ) : (
                              <X className="size-4 text-destructive" />
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="text-xs font-semibold">{ev.action}</div>
                            {ev.detail && <div className="text-xs text-muted-foreground">{ev.detail}</div>}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{ev.email ?? '—'}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{ev.ip}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                            <TimeAgo ts={ev.at} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              )}
            </section>
          )}

        {tab === 'load' && <LoadPanel />}

        {tab === 'settings' && (
          <SettingsPanel
            onNotify={pushToast}
            user={me ? { ...me, role } : null}
            theme={theme}
            onThemeChange={(next) => {
              setTheme(next)
              localStorage.setItem(THEME_KEY, next)
            }}
          />
        )}

        {tab === 'stops' && <StopsPanel role={role ?? 'curator'} onNotify={pushToast} onTotpFetch={totpAwareFetch} />}

        {tab === 'guide' && (
            <section>
              <p className="mb-4 text-xs text-muted-foreground">
                Dual-repo maintenance &amp; QA reference — frontend (<span className="font-mono">BusGo_Track</span>), backend
                (this repo), and a persistent testing checklist. Only visible to a signed-in admin; not published anywhere public.
              </p>
              <Tabs value={guideTab} onValueChange={(v) => setGuideTab(v as 'guide' | 'version')}>
                <TabsList variant="line" className="mb-4 h-9">
                  <TabsTrigger value="guide" className="h-8 px-3 text-xs font-semibold">
                    Maintenance guide
                  </TabsTrigger>
                  <TabsTrigger value="version" className="h-8 px-3 text-xs font-semibold">
                    Version log
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <Card className="overflow-hidden p-0">
                {guideTab === 'guide' ? (
                  <iframe
                    title="Maintenance & QA Guide"
                    srcDoc={MAINTENANCE_GUIDE_HTML}
                    sandbox="allow-scripts allow-same-origin"
                    className="h-[72vh] w-full border-0 bg-background"
                  />
                ) : (
                  <iframe
                    title="API Version Log 2026-08-11"
                    src="/version-log-2026-08-11.html"
                    sandbox="allow-scripts allow-same-origin"
                    className="h-[72vh] w-full border-0 bg-background"
                  />
                )}
              </Card>
              {guideTab === 'version' && (
                <p className="mt-4 text-xs text-muted-foreground">
                  What shipped in the latest batch and how the frontend should consume the API at scale. Also
                  served at <span className="font-mono">/version-log-2026-08-11.html</span> for the frontend team.
                </p>
              )}
            </section>
          )}
      </main>
      </SidebarInset>
      </SidebarProvider>

      {/* Disable-endpoint dialog — replaces the old window.prompt flow, whose
          Cancel fallback silently disabled the endpoint anyway. Now an
          AlertDialog: modal, no backdrop dismissal, Cancel is a genuine no-op. */}
      <AlertDialog
        open={disableTarget !== null}
        onOpenChange={(open) => { if (!open && !disabling) setDisableTarget(null) }}
      >
        <AlertDialogPortal>
          <AlertDialogBackdrop />
          <AlertDialogPopup>
            <AlertDialogTitle className="text-base font-semibold">Disable {disableTarget?.label}</AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground">
              Callers will get <code className="rounded bg-muted px-1 py-0.5 text-xs">503</code> until you re-enable
              it. Flags persist in Supabase, so a redeploy won&apos;t re-enable it.
            </AlertDialogDescription>
            <div className="mt-4">
              <label htmlFor="disable-reason" className="mb-2 block text-xs font-semibold">
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
            <div className="mt-4 flex justify-end gap-2">
              <AlertDialogCancel onClick={() => setDisableTarget(null)} disabled={disabling}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction onClick={submitDisable} disabled={disabling}>
                {disabling ? 'Disabling…' : 'Disable endpoint'}
              </AlertDialogAction>
            </div>
          </AlertDialogPopup>
        </AlertDialogPortal>
      </AlertDialog>

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
              <Key className="size-4 text-brand" />
              Authenticator code required
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              This action is sensitive and needs a fresh code from Google Authenticator. It unlocks
              sensitive actions for 5 minutes.
            </DialogDescription>
            <div className="mt-4">
              <label htmlFor="totp-challenge-code" className="mb-2 block text-xs font-semibold">
                Authenticator code
              </label>
              <OtpSlots
                id="totp-challenge-code"
                value={totpCode}
                onChange={(v) => {
                  setTotpCode(v.replace(/\D/g, '').slice(0, 6))
                  setTotpError(null)
                }}
                minSlots={6}
                maxSlots={6}
                invalid={!!totpError}
              />
              {totpError && (
                <p className="mt-2 flex items-start gap-1 text-xs text-destructive">
                  <WarningCircle className="mt-px size-3.5 shrink-0" />
                  {totpError}
                </p>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
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
                {totpVerifying ? <CircleNotch className="size-3.5 animate-spin" /> : 'Confirm code'}
              </Button>
            </div>
          </DialogPopup>
        </DialogPortal>
      </Dialog>

      {/* Destructive confirmations — revoke admin, clear errors, clear bug
          reports (durable Supabase data has no undo). AlertDialog semantics:
          modal, no backdrop dismissal, explicit Cancel / destructive Confirm. */}
      <AlertDialog
        open={confirmAction !== null}
        onOpenChange={(open) => { if (!open) setConfirmAction(null) }}
      >
        <AlertDialogPortal>
          <AlertDialogBackdrop />
          <AlertDialogPopup>
            <AlertDialogTitle className="text-base font-semibold">{confirmAction?.title}</AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground">
              {confirmAction?.message}
            </AlertDialogDescription>
            <div className="mt-4 flex justify-end gap-2">
              <AlertDialogCancel onClick={() => setConfirmAction(null)}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const action = confirmAction
                  setConfirmAction(null)
                  action?.onConfirm()
                }}
              >
                Confirm
              </AlertDialogAction>
            </div>
          </AlertDialogPopup>
        </AlertDialogPortal>
      </AlertDialog>

      {/* Per-admin recent-activity drill-down — the Audit feed filtered to
          one email, opened from the People table. */}
      <Sheet open={activityEmail !== null} onOpenChange={(open) => { if (!open) setActivityEmail(null) }}>
        <SheetContent side="right" className="w-[min(92vw,28rem)] gap-0 sm:max-w-md">
          <SheetHeader className="border-b">
            <SheetTitle className="flex items-center gap-2 text-base font-semibold">
              <Scroll className="size-4 text-muted-foreground" />
              Recent activity
            </SheetTitle>
            <SheetDescription className="break-all font-mono text-xs">{activityEmail}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-1 overflow-y-auto p-3">
            {activityEvents.length === 0 ? (
              <p className="py-12 text-center text-xs text-muted-foreground">
                No auth events for this email yet — the first sign-in will land here.
              </p>
            ) : (
              activityEvents.map((ev, i) => (
                <div key={`${ev.at}-${i}`} className="flex items-start gap-2 rounded-lg px-2 py-2 hover:bg-muted/40">
                  {ev.ok ? (
                    <CheckCircle className="mt-1 size-3.5 shrink-0 text-success" />
                  ) : (
                    <X className="mt-1 size-3.5 shrink-0 text-destructive" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-xs font-semibold">{ev.action}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        <TimeAgo ts={ev.at} />
                      </span>
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {ev.ip}
                      {ev.detail ? ` · ${ev.detail}` : ''}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Cmd+K palette — section jumps + one-key actions, mounted once so the
          shortcut works from every section. */}
      <CommandPalette
        role={role}
        onNavigate={(s) => setTab(s)}
        onRunChecks={() => void runChecks()}
        onStartSse={startSseFromPalette}
        onRefresh={() => void refreshAll()}
      />
    </div>
  )
}
