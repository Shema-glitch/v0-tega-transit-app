'use client'

/**
 * The real admin dashboard — see docs/ADMIN_DASHBOARD_PRD.md.
 *
 * Separate from the public status page (/) on purpose: this one requires
 * the admin token to even load, and does things that actually change
 * production behavior (disabling an endpoint returns real 503s — see
 * middleware.ts + lib/api/endpoint-registry.ts). The public page stays a
 * lightweight, unauthenticated "is it up" view for anyone.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ENDPOINT_REGISTRY } from '@/lib/api/endpoint-registry'

// ─── shared color tokens (this page's own dark theme, independent of the
// public dashboard's light claymorphism look) ──────────────────────────────
const C = {
  bg: '#0a0d14',
  surface: '#12161f',
  surfaceRaised: '#171c28',
  border: '#232a38',
  borderBright: '#2f3849',
  text: '#e6e9f0',
  textDim: '#8b93a7',
  accent: '#22d3ee',
  accentDim: '#0e7490',
  good: '#34d399',
  warn: '#fbbf24',
  err: '#fb7185',
}

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

function Toggle({ checked, onChange, danger }: { checked: boolean; onChange: () => void; danger?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className="relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors"
      style={{ background: checked ? (danger ? C.err : C.good) : C.border }}
    >
      <span
        className="absolute top-0.5 h-5 w-5 rounded-full transition-transform"
        style={{ background: C.bg, transform: checked ? 'translateX(22px)' : 'translateX(2px)' }}
      />
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
  const [source, setSource] = useState<{ errors: 'supabase' | 'memory'; bugs: 'supabase' | 'memory' }>({
    errors: 'memory',
    bugs: 'memory',
  })

  const [tab, setTab] = useState<'issues' | 'endpoints'>('issues')
  const [issueFilter, setIssueFilter] = useState<'all' | 'errors' | 'bugs' | 'open'>('open')
  const [query, setQuery] = useState('')

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

  const overallStatus = disabledCount > 0
    ? { label: 'Endpoints disabled', color: C.warn }
    : openCount > 0
      ? { label: 'Open issues', color: C.warn }
      : { label: 'All clear', color: C.good }

  // ─── Login screen ─────────────────────────────────────────────────────────
  if (authState !== 'in') {
    return (
      <div className="flex min-h-screen items-center justify-center px-4" style={{ background: C.bg, color: C.text }}>
        <div className="w-full max-w-sm rounded-2xl border p-6" style={{ background: C.surface, borderColor: C.border }}>
          <div className="mb-1 flex items-center gap-2">
            <span className="text-lg" style={{ color: C.accent }}>▍</span>
            <h1 className="text-lg font-bold">BusGo Track — Admin</h1>
          </div>
          <p className="mb-5 text-xs" style={{ color: C.textDim }}>
            {authState === 'checking' ? 'Checking for a saved session…' : 'Enter the ADMIN_TOKEN configured on Render.'}
          </p>
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') login() }}
            placeholder="Admin token"
            className="mb-3 w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ background: C.bg, borderColor: C.borderBright, color: C.text }}
            autoFocus
          />
          {loginError && <p className="mb-3 text-xs" style={{ color: C.err }}>{loginError}</p>}
          <button
            onClick={login}
            className="w-full cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold"
            style={{ background: C.accent, color: C.bg }}
          >
            Sign in
          </button>
          <p className="mt-4 text-xs" style={{ color: C.textDim }}>
            <a href="/" style={{ color: C.accent }}>← back to the public status page</a>
          </p>
        </div>
      </div>
    )
  }

  // ─── Dashboard ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ background: C.bg, color: C.text }}>
      <header className="border-b px-6 py-4" style={{ borderColor: C.border, background: C.surface }}>
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl" style={{ color: C.accent }}>▍</span>
            <h1 className="text-lg font-bold">BusGo Track — Admin</h1>
            <Pill color={overallStatus.color}>{overallStatus.label}</Pill>
          </div>
          <div className="flex items-center gap-4 text-xs" style={{ color: C.textDim }}>
            <a href="/" style={{ color: C.textDim }}>public status page</a>
            <button onClick={logout} className="cursor-pointer rounded border px-2 py-1 hover:opacity-80" style={{ borderColor: C.border }}>
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-6">
        {/* Stat bar */}
        <div className="mb-6 grid grid-cols-3 gap-3">
          <div className="rounded-xl border p-4" style={{ background: C.surface, borderColor: C.border }}>
            <div className="text-2xl font-bold" style={{ color: openCount > 0 ? C.warn : C.good }}>{openCount}</div>
            <div className="text-xs" style={{ color: C.textDim }}>Open issues</div>
          </div>
          <div className="rounded-xl border p-4" style={{ background: C.surface, borderColor: C.border }}>
            <div className="text-2xl font-bold" style={{ color: disabledCount > 0 ? C.warn : C.text }}>{disabledCount}</div>
            <div className="text-xs" style={{ color: C.textDim }}>Endpoints disabled</div>
          </div>
          <div className="rounded-xl border p-4" style={{ background: C.surface, borderColor: C.border }}>
            <div className="text-2xl font-bold">{bugReports.length}</div>
            <div className="text-xs" style={{ color: C.textDim }}>Total bug reports</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-4 flex gap-1 border-b" style={{ borderColor: C.border }}>
          {(['issues', 'endpoints'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="cursor-pointer px-4 py-2 text-sm font-semibold capitalize"
              style={{
                color: tab === t ? C.accent : C.textDim,
                borderBottom: tab === t ? `2px solid ${C.accent}` : '2px solid transparent',
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'issues' && (
          <section>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="flex gap-1 rounded-lg border p-1" style={{ borderColor: C.border }}>
                {(['open', 'all', 'errors', 'bugs'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setIssueFilter(f)}
                    className="cursor-pointer rounded px-2.5 py-1 text-xs font-semibold capitalize"
                    style={{ background: issueFilter === f ? C.accentDim : 'transparent', color: issueFilter === f ? C.text : C.textDim }}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search path, message, subject…"
                className="min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-xs outline-none"
                style={{ background: C.surface, borderColor: C.border, color: C.text }}
              />
              <button
                onClick={clearErrors}
                className="cursor-pointer rounded-lg border px-2.5 py-1.5 text-xs hover:opacity-80"
                style={{ borderColor: C.border, color: C.textDim }}
              >
                Clear errors
              </button>
              <button
                onClick={clearBugReports}
                className="cursor-pointer rounded-lg border px-2.5 py-1.5 text-xs hover:opacity-80"
                style={{ borderColor: C.border, color: C.textDim }}
              >
                Clear bug reports
              </button>
            </div>

            {filteredIssues.length === 0 && (
              <p className="py-8 text-center text-sm" style={{ color: C.textDim }}>Nothing here. 🎉</p>
            )}

            <div className="space-y-2">
              {filteredIssues.map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border p-3"
                  style={{
                    background: C.surface,
                    borderColor: C.border,
                    opacity: item.resolved ? 0.55 : 1,
                  }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill color={item.kind === 'error' ? C.err : C.accent}>{item.kind === 'error' ? 'ERROR' : 'BUG'}</Pill>
                    <span className="font-mono text-xs font-semibold">{item.title}</span>
                    <span className="text-xs" style={{ color: C.textDim }}>{timeAgo(item.timestamp, now)}</span>
                    {item.count && item.count > 1 && <Pill color={C.warn}>×{item.count}</Pill>}
                    {item.resolved && <Pill color={C.textDim}>resolved</Pill>}
                    {item.onResolve && !item.resolved && (
                      <button
                        onClick={item.onResolve}
                        className="ml-auto cursor-pointer rounded border px-2 py-0.5 text-xs hover:opacity-80"
                        style={{ borderColor: C.border, color: C.good }}
                      >
                        Mark resolved
                      </button>
                    )}
                  </div>
                  <div className="mt-1.5 whitespace-pre-wrap text-xs" style={{ color: C.text }}>{item.detail}</div>
                  {item.meta && <div className="mt-1 text-xs" style={{ color: C.textDim }}>from: {item.meta}</div>}
                </div>
              ))}
            </div>

            <p className="mt-3 text-xs" style={{ color: C.textDim }}>
              Errors: {source.errors === 'supabase' ? 'durable' : 'in-memory only'} · Bug reports: {source.bugs === 'supabase' ? 'durable' : 'in-memory only'} · auto-refreshes every 15s.
            </p>
          </section>
        )}

        {tab === 'endpoints' && (
          <section>
            <p className="mb-4 text-xs" style={{ color: C.textDim }}>
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
                <h3 className="mb-2 text-xs font-bold uppercase tracking-widest" style={{ color: C.textDim }}>{group}</h3>
                <div className="overflow-hidden rounded-xl border" style={{ borderColor: C.border }}>
                  {endpoints.map((ep, i) => {
                    const flag = maintenance.find((f) => f.feature === ep.id)
                    const disabled = !!flag
                    return (
                      <div
                        key={ep.id}
                        className="flex items-center gap-3 px-3 py-2.5"
                        style={{ background: C.surface, borderBottom: i < endpoints.length - 1 ? `1px solid ${C.border}` : undefined }}
                      >
                        <Toggle checked={!disabled} onChange={() => toggleEndpoint(ep.id, disabled)} danger={disabled} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: C.borderBright, color: C.textDim }}>{ep.method}</span>
                            <span className="truncate font-mono text-xs">{ep.label}</span>
                          </div>
                          {flag && (
                            <div className="mt-0.5 text-xs" style={{ color: C.warn }}>
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
