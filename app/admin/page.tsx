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
 * in at 11pm mid-incident" tool, not a bright daytime page.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ENDPOINT_REGISTRY } from '@/lib/api/endpoint-registry'

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

// The visible switch stays small (28x48) so it doesn't look oversized next
// to the endpoint label, but the actual tap target is padded out to the
// 44x44 minimum (ui-ux-pro-max touch-target-size) via -m-2 p-2 so the extra
// hit area doesn't shift layout.
function Toggle({ checked, onChange, danger }: { checked: boolean; onChange: () => void; danger?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className="relative -m-2 shrink-0 cursor-pointer rounded-full p-2 focus-visible:outline-none focus-visible:ring-2"
      style={{ '--tw-ring-color': STATUS_COLOR.accent } as React.CSSProperties}
    >
      <span
        className="relative block h-7 w-12 rounded-full transition-colors"
        style={{ background: checked ? (danger ? STATUS_COLOR.err : STATUS_COLOR.good) : 'var(--color-border-medium)' }}
      >
        <span
          className="absolute top-0.5 h-6 w-6 rounded-full transition-transform"
          style={{ background: 'var(--color-bg-canvas)', transform: checked ? 'translateX(22px)' : 'translateX(2px)' }}
        />
      </span>
    </button>
  )
}

function Pill({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
      style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, color }}
    >
      {children}
    </span>
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
    ? { label: 'Endpoints disabled', color: STATUS_COLOR.warn }
    : openCount > 0
      ? { label: 'Open issues', color: STATUS_COLOR.warn }
      : { label: 'All clear', color: STATUS_COLOR.good }

  const processUptimeMs = processStartedAt ? now - processStartedAt : null
  const showRestartNudge = processUptimeMs !== null && processUptimeMs < RECENT_RESTART_MS

  // ─── Login screen ─────────────────────────────────────────────────────────
  if (authState !== 'in') {
    return (
      <div
        className="dark flex min-h-screen items-center justify-center px-4"
        style={{ background: 'var(--color-bg-canvas)', color: 'var(--color-text-primary)' }}
      >
        <div className="clay-card w-full max-w-sm p-6">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-lg" style={{ color: STATUS_COLOR.accent }}>▍</span>
            <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>BusGo Track — Admin</h1>
          </div>
          <p className="mb-5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            {authState === 'checking' ? 'Checking for a saved session…' : 'Enter the ADMIN_TOKEN configured on Render.'}
          </p>
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') login() }}
            placeholder="Admin token"
            className="mb-3 w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus-visible:ring-2"
            style={{
              background: 'var(--color-bg-canvas)',
              borderColor: 'var(--color-border-medium)',
              color: 'var(--color-text-primary)',
              '--tw-ring-color': STATUS_COLOR.accent,
            } as React.CSSProperties}
            autoFocus
          />
          {loginError && <p className="mb-3 text-xs" style={{ color: STATUS_COLOR.err }}>{loginError}</p>}
          <button
            onClick={login}
            className="btn-primary w-full justify-center focus-visible:outline-none focus-visible:ring-2"
            style={{ '--tw-ring-color': STATUS_COLOR.accent } as React.CSSProperties}
          >
            Sign in
          </button>
          <p className="mt-4 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            <a href="/" style={{ color: STATUS_COLOR.accent }}>← back to the public status page</a>
          </p>
        </div>
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
            <Pill color={overallStatus.color}>{overallStatus.label}</Pill>
          </div>
          <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            <a href="/" style={{ color: 'var(--color-text-secondary)' }}>public status page</a>
            <button
              onClick={logout}
              className="min-h-11 cursor-pointer rounded border px-3 py-1.5 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2"
              style={{ borderColor: 'var(--color-border-subtle)', '--tw-ring-color': STATUS_COLOR.accent } as React.CSSProperties}
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        {showRestartNudge && (
          <div
            className="mb-4 rounded-xl border px-4 py-3 text-xs"
            style={{ borderColor: STATUS_COLOR.warn, background: `color-mix(in srgb, ${STATUS_COLOR.warn} 10%, transparent)`, color: 'var(--color-text-primary)' }}
          >
            ⚠ This process started {timeAgo(processStartedAt!, now)} — maintenance flags live in memory only, so a
            restart silently re-enables everything that was disabled before it. Double-check the Endpoints tab if
            you were mid-incident.
          </div>
        )}

        {/* Stat bar */}
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="clay-surface p-4">
            <div className="text-2xl font-bold" style={{ color: openCount > 0 ? STATUS_COLOR.warn : STATUS_COLOR.good }}>{openCount}</div>
            <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Open issues</div>
          </div>
          <div className="clay-surface p-4">
            <div className="text-2xl font-bold" style={{ color: disabledCount > 0 ? STATUS_COLOR.warn : 'var(--color-text-primary)' }}>{disabledCount}</div>
            <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Endpoints disabled</div>
          </div>
          <div className="clay-surface p-4">
            <div className="text-2xl font-bold">{bugReports.length}</div>
            <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Total bug reports</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-4 flex gap-1 overflow-x-auto border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
          {(['issues', 'endpoints'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="min-h-11 cursor-pointer whitespace-nowrap px-4 py-2.5 text-sm font-semibold capitalize focus-visible:outline-none focus-visible:ring-2"
              style={{
                color: tab === t ? STATUS_COLOR.accent : 'var(--color-text-secondary)',
                borderBottom: tab === t ? `2px solid ${STATUS_COLOR.accent}` : '2px solid transparent',
                '--tw-ring-color': STATUS_COLOR.accent,
              } as React.CSSProperties}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'issues' && (
          <section>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap gap-2 overflow-x-auto rounded-lg border p-1" style={{ borderColor: 'var(--color-border-subtle)' }}>
                {(['open', 'all', 'errors', 'bugs'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setIssueFilter(f)}
                    className="min-h-9 cursor-pointer whitespace-nowrap rounded px-2.5 py-1.5 text-xs font-semibold capitalize focus-visible:outline-none focus-visible:ring-2"
                    style={{
                      background: issueFilter === f ? 'var(--color-primary-dim)' : 'transparent',
                      color: issueFilter === f ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                      '--tw-ring-color': STATUS_COLOR.accent,
                    } as React.CSSProperties}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search path, message, subject…"
                className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-xs outline-none focus-visible:ring-2"
                style={{
                  background: 'var(--color-bg-surface)',
                  borderColor: 'var(--color-border-subtle)',
                  color: 'var(--color-text-primary)',
                  '--tw-ring-color': STATUS_COLOR.accent,
                } as React.CSSProperties}
              />
              <button onClick={clearErrors} className="btn-secondary min-h-9! px-2.5! py-1.5! text-xs! focus-visible:ring-2!">
                Clear errors
              </button>
              <button onClick={clearBugReports} className="btn-secondary min-h-9! px-2.5! py-1.5! text-xs! focus-visible:ring-2!">
                Clear bug reports
              </button>
            </div>

            {filteredIssues.length === 0 && isAllClear && (
              <div className="flex flex-col items-center gap-2 py-16 text-center">
                <span className="text-4xl" style={{ color: STATUS_COLOR.good }}>✓</span>
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
                  <div
                    key={item.id}
                    className="clay-surface p-3"
                    style={{ opacity: item.resolved ? 0.55 : 1 }}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill color={item.kind === 'error' ? STATUS_COLOR.err : STATUS_COLOR.accent}>
                        {item.kind === 'error' ? 'ERROR' : 'BUG'}
                      </Pill>
                      {isNew && <Pill color={STATUS_COLOR.accent}>since you last looked</Pill>}
                      <span className="font-mono text-xs font-semibold">{item.title}</span>
                      <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{timeAgo(item.timestamp, now)}</span>
                      {item.count && item.count > 1 && <Pill color={STATUS_COLOR.warn}>×{item.count}</Pill>}
                      {item.resolved && <Pill color={STATUS_COLOR.dim}>resolved</Pill>}
                      {item.onResolve && !item.resolved && (
                        <button
                          onClick={item.onResolve}
                          className="ml-auto min-h-9 cursor-pointer rounded border px-2.5 py-1 text-xs hover:opacity-80 focus-visible:outline-none focus-visible:ring-2"
                          style={{ borderColor: 'var(--color-border-subtle)', color: STATUS_COLOR.good, '--tw-ring-color': STATUS_COLOR.good } as React.CSSProperties}
                        >
                          Mark resolved
                        </button>
                      )}
                    </div>
                    <div className="mt-1.5 whitespace-pre-wrap text-xs" style={{ color: 'var(--color-text-primary)' }}>{item.detail}</div>
                    {item.meta && (
                      <div className="mt-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                        from: <PageUrlLink url={item.meta} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <p className="mt-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              Errors: {source.errors === 'supabase' ? 'durable' : 'in-memory only'} · Bug reports: {source.bugs === 'supabase' ? 'durable' : 'in-memory only'} · auto-refreshes every 15s.
            </p>
          </section>
        )}

        {tab === 'endpoints' && (
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
                <div className="clay-surface overflow-hidden">
                  {endpoints.map((ep, i) => {
                    const flag = maintenance.find((f) => f.feature === ep.id)
                    const disabled = !!flag
                    return (
                      <div
                        key={ep.id}
                        className="flex items-center gap-3 px-3 py-3"
                        style={{ borderBottom: i < endpoints.length - 1 ? '1px solid var(--color-border-subtle)' : undefined }}
                      >
                        <Toggle checked={!disabled} onChange={() => toggleEndpoint(ep.id, disabled)} danger={disabled} />
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
                </div>
              </div>
            ))}
          </section>
        )}
      </main>
    </div>
  )
}
