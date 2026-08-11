'use client'

/**
 * components/admin/stops-panel.tsx — the "Map & Stops" section (curator tier).
 *
 * A list-first curator tool (the Mapbox map view is a follow-up):
 *   - full stop list with soft-state badges (active / merged→ / hidden, hub)
 *   - edit dialog: rename, move (lat/lon), toggle hub
 *   - merge flow: pick a survivor + victim checkboxes → dry-run preview
 *     (exact affected stop_times + pending suggestions) → confirm
 *   - undo any recent merge (one-shot, from its snapshot)
 *   - hide / restore / hard-delete (admin-only)
 *   - "Suggested merges" from server-side duplicate detection, promotable
 *     straight into merge mode
 *
 * Writes go through the page's `onTotpFetch` so a 403 'totp-required' opens
 * the authenticator dialog and retries once (see app/admin/page.tsx).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  ArrowCounterClockwise,
  ArrowDown,
  ArrowUp,
  ArrowsClockwise,
  Check,
  CheckCircle,
  CircleNotch,
  GitMerge,
  MagnifyingGlass,
  MapPin,
  PencilSimple,
  Scan,
  ShieldSlash,
  Terminal,
  Triangle,
  X,
} from '@phosphor-icons/react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

interface StopEntry {
  id: string
  name: string
  lat: number | null
  lon: number | null
  status: 'active' | 'merged' | 'hidden'
  mergedIntoId: string | null
  isHub: boolean
  editedBy: string | null
  editedAt: number | null
}

interface MergePayload {
  ok: boolean
  error?: string
  dryRun?: boolean
  mergeId?: string
  survivorId?: string
  victims?: string[]
  affectedStopTimes?: number
  stopTimesRewritten?: number
  collisionsSkipped?: number
  pendingSuggestions?: number
  suggestionsRetargeted?: number
}

interface RecentMerge {
  id: string
  survivorId: string
  victimIds: string[]
  actorId: string
  reason: string | null
  createdAt: number
}

interface DuplicateCluster {
  anchor: { id: string; name: string; stopTimesCount: number }
  stops: Array<{ id: string; name: string; stopTimesCount: number }>
  maxSpanMeters: number
}

const STATUS_BADGE: Record<StopEntry['status'], string> = {
  active: 'bg-brand/15 text-brand',
  merged: 'bg-muted text-muted-foreground',
  hidden: 'bg-warning/10 text-warning',
}

/** Display order for status sorting (active → merged → hidden). */
const STATUS_ORDER: Record<StopEntry['status'], number> = { active: 0, merged: 1, hidden: 2 }

const PAGE_SIZES = [25, 50, 100]

type SortKey = 'name' | 'id' | 'status' | 'edited'

const STATUS_FILTERS: Array<{ v: 'all' | StopEntry['status']; l: string }> = [
  { v: 'all', l: 'All' },
  { v: 'active', l: 'Active' },
  { v: 'merged', l: 'Merged' },
  { v: 'hidden', l: 'Hidden' },
]

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

export function StopsPanel({
  role,
  onNotify,
  onTotpFetch,
}: {
  role: 'admin' | 'curator'
  onNotify: (message: string, kind?: 'success' | 'error') => void
  onTotpFetch: (url: string, init?: RequestInit) => Promise<Response>
}) {
  const isAdmin = role === 'admin'
  const [stops, setStops] = useState<StopEntry[]>([])
  const [merges, setMerges] = useState<RecentMerge[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  // GTFS import is a one-time terminal sync (scripts/push-gtfs.js), not a
  // runtime API — the empty state hands the admin the exact command instead
  // of leaving the dead-end "no stops" message.
  const [cmdCopied, setCmdCopied] = useState(false)
  const cmdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copyImportCommand = useCallback(async () => {
    try {
      await navigator.clipboard.writeText('node --env-file=.env scripts/push-gtfs.js')
    } catch {
      return
    }
    setCmdCopied(true)
    if (cmdTimerRef.current) clearTimeout(cmdTimerRef.current)
    cmdTimerRef.current = setTimeout(() => setCmdCopied(false), 2000)
  }, [])
  useEffect(() => () => { if (cmdTimerRef.current) clearTimeout(cmdTimerRef.current) }, [])

  // List tools — pagination, sorting, filtering
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [statusFilter, setStatusFilter] = useState<'all' | StopEntry['status']>('all')
  const [hubOnly, setHubOnly] = useState(false)

  // Merge tool
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [survivorId, setSurvivorId] = useState('')
  const [reason, setReason] = useState('')
  const [preview, setPreview] = useState<MergePayload | null>(null)
  const [busy, setBusy] = useState(false)

  // Edit dialog
  const [editTarget, setEditTarget] = useState<StopEntry | null>(null)
  const [editName, setEditName] = useState('')
  const [editLat, setEditLat] = useState('')
  const [editLon, setEditLon] = useState('')
  const [editHub, setEditHub] = useState(false)

  // Suggested merges
  const [duplicates, setDuplicates] = useState<DuplicateCluster[] | null>(null)
  const [detecting, setDetecting] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [stopRes, mergeRes] = await Promise.all([
        onTotpFetch('/api/admin/stops?include=merged', { cache: 'no-store' }),
        onTotpFetch('/api/admin/stops/merges', { cache: 'no-store' }),
      ])
      const stopData = await stopRes.json().catch(() => ({}))
      const mergeData = await mergeRes.json().catch(() => ({}))
      if (stopRes.ok) setStops(stopData.stops ?? [])
      if (mergeRes.ok) setMerges(mergeData.merges ?? [])
    } catch {
      // silent — the empty state explains itself
    } finally {
      setLoading(false)
    }
  }, [onTotpFetch])

  useEffect(() => {
    refresh()
  }, [refresh])

  const byId = useMemo(() => new Map(stops.map((s) => [s.id, s])), [stops])

  // Search + status + hub filters.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return stops.filter((s) => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false
      if (hubOnly && !s.isHub) return false
      if (!q) return true
      return (
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        (s.mergedIntoId ?? '').toLowerCase().includes(q)
      )
    })
  }, [stops, query, statusFilter, hubOnly])

  // Sort (stable-ish: tie-break on name).
  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const cmp =
        sortKey === 'name'
          ? a.name.localeCompare(b.name)
          : sortKey === 'id'
            ? a.id.localeCompare(b.id)
            : sortKey === 'status'
              ? STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
              : (a.editedAt ?? 0) - (b.editedAt ?? 0)
      const final = cmp === 0 ? a.name.localeCompare(b.name) : cmp
      return final * dir
    })
  }, [filtered, sortKey, sortDir])

  // Pagination (page is clamped so a shrink never leaves a dead page).
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const pageItems = sorted.slice((safePage - 1) * pageSize, safePage * pageSize)

  // Select-all on the current page (active stops only — the merge victims).
  const visibleActive = useMemo(() => pageItems.filter((s) => s.status === 'active'), [pageItems])
  const allVisibleSelected = visibleActive.length > 0 && visibleActive.every((s) => selected.has(s.id))
  const someVisibleSelected = visibleActive.some((s) => selected.has(s.id))
  const toggleSelectAll = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        for (const s of visibleActive) next.delete(s.id)
      } else {
        for (const s of visibleActive) next.add(s.id)
      }
      return next
    })
    setPreview(null)
  }, [allVisibleSelected, visibleActive])

  const counts = useMemo(() => {
    let active = 0
    let merged = 0
    let hidden = 0
    let hubs = 0
    for (const s of stops) {
      if (s.isHub) hubs++
      if (s.status === 'active') active++
      else if (s.status === 'merged') merged++
      else hidden++
    }
    return { active, merged, hidden, hubs }
  }, [stops])

  const toggleSelected = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setPreview(null)
  }, [])

  const openEdit = useCallback((s: StopEntry) => {
    setEditTarget(s)
    setEditName(s.name)
    setEditLat(s.lat != null ? String(s.lat) : '')
    setEditLon(s.lon != null ? String(s.lon) : '')
    setEditHub(s.isHub)
  }, [])

  const saveEdit = useCallback(async () => {
    if (!editTarget) return
    const lat = editLat.trim() === '' ? undefined : Number(editLat)
    const lon = editLon.trim() === '' ? undefined : Number(editLon)
    if ((lat !== undefined && !Number.isFinite(lat)) || (lon !== undefined && !Number.isFinite(lon))) {
      onNotify('Lat/lon must be numbers', 'error')
      return
    }
    setBusy(true)
    try {
      const res = await onTotpFetch(`/api/admin/stops/${editTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim() || undefined,
          lat,
          lon,
          isHub: editHub,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        onNotify(data?.error ?? 'Could not save the stop', 'error')
        return
      }
      onNotify('Stop updated')
      setEditTarget(null)
      refresh()
    } finally {
      setBusy(false)
    }
  }, [editTarget, editName, editLat, editLon, editHub, onNotify, onTotpFetch, refresh])

  const previewMerge = useCallback(async () => {
    if (!survivorId || selected.size === 0) return
    setBusy(true)
    setPreview(null)
    try {
      const res = await onTotpFetch('/api/admin/stops/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          survivorId,
          victimIds: [...selected],
          reason: reason.trim() || undefined,
          dryRun: true,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        onNotify(data?.error ?? 'Could not preview the merge', 'error')
        return
      }
      setPreview(data)
    } finally {
      setBusy(false)
    }
  }, [survivorId, selected, reason, onNotify, onTotpFetch])

  const confirmMerge = useCallback(async () => {
    if (!survivorId || selected.size === 0 || !preview?.ok) return
    setBusy(true)
    try {
      const res = await onTotpFetch('/api/admin/stops/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          survivorId,
          victimIds: [...selected],
          reason: reason.trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        onNotify(data?.error ?? 'Merge failed', 'error')
        return
      }
      onNotify(
        `Merged ${data.victims?.length ?? 0} stops into ${byId.get(survivorId)?.name ?? survivorId} — ${data.stopTimesRewritten ?? 0} stop_times rewritten`
      )
      setSelected(new Set())
      setSurvivorId('')
      setReason('')
      setPreview(null)
      refresh()
    } finally {
      setBusy(false)
    }
  }, [survivorId, selected, preview, reason, onNotify, onTotpFetch, refresh, byId])

  const undo = useCallback(
    async (mergeId: string) => {
      setBusy(true)
      try {
        const res = await onTotpFetch(`/api/admin/stops/merge/${mergeId}/undo`, { method: 'POST' })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          onNotify(data?.error ?? 'Could not undo the merge', 'error')
          return
        }
        onNotify(`Undid merge — ${data.restoredVictims ?? 0} stops restored`)
        refresh()
      } finally {
        setBusy(false)
      }
    },
    [onNotify, onTotpFetch, refresh]
  )

  const hide = useCallback(
    async (id: string, name: string) => {
      setBusy(true)
      try {
        const res = await onTotpFetch(`/api/admin/stops/${id}/hide`, { method: 'POST' })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          onNotify(data?.error ?? `Could not hide ${name}`, 'error')
          return
        }
        onNotify(`${name} hidden`)
        refresh()
      } finally {
        setBusy(false)
      }
    },
    [onNotify, onTotpFetch, refresh]
  )

  const restore = useCallback(
    async (id: string, name: string) => {
      setBusy(true)
      try {
        const res = await onTotpFetch(`/api/admin/stops/${id}/restore`, { method: 'POST' })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          onNotify(data?.error ?? `Could not restore ${name}`, 'error')
          return
        }
        onNotify(`${name} restored`)
        refresh()
      } finally {
        setBusy(false)
      }
    },
    [onNotify, onTotpFetch, refresh]
  )

  const detect = useCallback(async () => {
    setDetecting(true)
    try {
      const res = await onTotpFetch('/api/admin/stops/detect-duplicates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        onNotify(data?.error ?? 'Could not detect duplicates', 'error')
        return
      }
      setDuplicates(data.clusters ?? [])
      onNotify(`Scanned ${data.scanned ?? 0} stops — ${data.clusters?.length ?? 0} candidate clusters`)
    } finally {
      setDetecting(false)
    }
  }, [onNotify, onTotpFetch])

  const applyCluster = useCallback((cluster: DuplicateCluster) => {
    setSurvivorId(cluster.anchor.id)
    setSelected(new Set(cluster.stops.filter((s) => s.id !== cluster.anchor.id).map((s) => s.id)))
    setPreview(null)
  }, [])

  // Merge survivor options respect the current search so the dropdown stays
  // usable even with a full stop database (thousands of rows).
  const activeOnly = useMemo(() => stops.filter((s) => s.status === 'active'), [stops])
  const survivorOptions = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = activeOnly.filter((s) => !selected.has(s.id))
    if (!q) return base
    return base.filter((s) => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q))
  }, [activeOnly, selected, query])

  const clearSelection = useCallback(() => {
    setSelected(new Set())
    setPreview(null)
  }, [])

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{counts.active}</span> active ·{' '}
          <span className="font-semibold text-foreground">{counts.merged}</span> merged ·{' '}
          <span className="font-semibold text-foreground">{counts.hidden}</span> hidden ·{' '}
          <span className="font-semibold text-brand">{counts.hubs}</span> hubs
        </p>
        <Button variant="outline" size="sm" onClick={detect} disabled={detecting} className="h-9 gap-1.5 text-xs">
          {detecting ? <CircleNotch className="size-3.5 animate-spin" /> : <Scan className="size-3.5" />}
          Detect duplicates
        </Button>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading} className="h-9 gap-1.5 text-xs">
          <ArrowsClockwise className={`size-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      {/* Suggested merges */}
      {duplicates && duplicates.length > 0 && (
        <Card className="p-4">
          <p className="flex items-center gap-2 text-xs font-semibold">
            <Scan className="size-3.5 text-brand" /> Suggested merges
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {duplicates.length} candidate cluster{duplicates.length === 1 ? '' : 's'} within 60 m. “Use” loads the
            cluster into the merge tool below.
          </p>
          <div className="mt-3 space-y-2">
            {duplicates.slice(0, 8).map((c) => (
              <div key={c.anchor.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
                <span className="font-mono text-xs font-semibold">{c.stops.length} stops</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {c.stops.slice(0, 3).map((s) => s.name).join(' · ')}
                  {c.stops.length > 3 ? ` +${c.stops.length - 3}` : ''}
                </span>
                <span className="font-mono text-xs text-muted-foreground">{Math.round(c.maxSpanMeters)} m</span>
                <Button size="sm" variant="outline" className="h-9 text-xs" onClick={() => applyCluster(c)}>
                  Use
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Merge tool */}
      <Card id="merge-tool" className="p-4">
        <p className="flex items-center gap-2 text-xs font-semibold">
          <GitMerge className="size-3.5 text-brand" /> Merge stops
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Check the victim stops below, pick the survivor, preview what changes, then confirm. Merged stops redirect
          to the survivor everywhere — old links keep working.
        </p>
        <div className="mt-3 grid max-w-2xl gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <div>
            <label htmlFor="merge-survivor" className="mb-1 block text-xs font-semibold text-muted-foreground">
              Survivor stop
            </label>
            <Select
              value={survivorId || null}
              onValueChange={(v) => {
                setSurvivorId(v ?? '')
                setPreview(null)
              }}
            >
              <SelectTrigger className="h-10 data-[size=default]:h-10 w-full text-xs" aria-label="Survivor stop">
                <SelectValue placeholder="Pick the stop that survives…" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {survivorOptions.map((s) => (
                  <SelectItem key={s.id} value={s.id} className="text-xs">
                    <span className="truncate">
                      {s.name} — <span className="font-mono text-xs text-muted-foreground">{s.id}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label htmlFor="merge-reason" className="mb-1 block text-xs font-semibold text-muted-foreground">
              Reason (optional, shown in the audit)
            </label>
            <Input
              id="merge-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. same physical stop, duplicate import"
              className="h-10 text-xs"
            />
          </div>
          <div className="flex items-end gap-2">
            <Button
              size="sm"
              onClick={previewMerge}
              disabled={busy || !survivorId || selected.size === 0}
              className="h-10 text-xs"
            >
              {busy ? <CircleNotch className="size-3.5 animate-spin" /> : 'Preview'}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                setSelected(new Set())
                setSurvivorId('')
                setReason('')
                setPreview(null)
              }}
              disabled={busy || (selected.size === 0 && !survivorId)}
              className="h-10 px-2 text-xs"
              aria-label="Clear merge selection"
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </div>

        {preview && !preview.ok && (
          <p className="mt-3 flex items-start gap-1.5 text-xs text-destructive">
            <Triangle className="mt-px size-3.5 shrink-0" />
            {preview.error}
          </p>
        )}
        {preview?.ok && (
          <div className="rise-in mt-3 rounded-lg border border-brand/20 bg-brand/10 px-3 py-2.5">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-brand">
              <span className="font-mono tabular-nums">{preview.victims?.length ?? 0} victims</span>
              <span className="font-mono tabular-nums">{preview.affectedStopTimes ?? 0} stop_times</span>
              <span className="font-mono tabular-nums">{preview.pendingSuggestions ?? 0} pending suggestions</span>
              <span className="font-mono tabular-nums">{preview.collisionsSkipped ?? 0} collisions</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {preview.affectedStopTimes === 0 && preview.pendingSuggestions === 0
                ? 'Nothing references these victims — the merge only cleans up the stop list.'
                : 'This is exactly what will change. Confirm to commit.'}
            </p>
            <Button size="sm" onClick={confirmMerge} disabled={busy} className="mt-2 h-8 text-xs">
              {busy ? <CircleNotch className="size-3.5 animate-spin" /> : 'Confirm merge'}
            </Button>
          </div>
        )}
      </Card>

      {/* Stop list */}
      <Card className="overflow-hidden p-0">
        {/* Search + rows-per-page */}
        <div className="flex items-center gap-2 border-b border-border p-3">
          <MagnifyingGlass className="size-4 shrink-0 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(1)
            }}
            placeholder={`Search ${stops.length} stops by name or id…`}
            aria-label="Search stops"
            className="h-9 max-w-md text-xs"
          />
          <Select
            value={String(pageSize)}
            onValueChange={(v) => {
              if (v) {
                setPageSize(Number(v))
                setPage(1)
              }
            }}
          >
            <SelectTrigger className="h-9 data-[size=default]:h-9 w-[5.5rem] shrink-0 font-mono text-xs" aria-label="Rows per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} / page
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Filters + sort */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-3 py-2">
          <ToggleGroup
            variant="outline"
            size="sm"
            value={statusFilter === 'all' ? [] : [statusFilter]}
            onValueChange={(v) => {
              setStatusFilter((v[0] as StopEntry['status']) ?? 'all')
              setPage(1)
            }}
            className="gap-0.5"
          >
            {STATUS_FILTERS.map((f) => (
              <ToggleGroupItem key={f.v} value={f.v} className="h-7 px-2.5 text-xs">
                {f.l}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Checkbox
              checked={hubOnly}
              onCheckedChange={(c) => {
                setHubOnly(c)
                setPage(1)
              }}
            />
            Hubs only
          </label>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Sort</span>
            <Select value={sortKey} onValueChange={(v) => v && setSortKey(v as SortKey)}>
              <SelectTrigger size="sm" className="h-7 text-xs" aria-label="Sort stops by">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="id">ID</SelectItem>
                <SelectItem value="status">Status</SelectItem>
                <SelectItem value="edited">Last edited</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
              className="h-9 w-9 px-0"
              aria-label={`Sort ${sortDir === 'asc' ? 'descending' : 'ascending'}`}
            >
              {sortDir === 'asc' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />}
            </Button>
          </div>
        </div>

        {/* Bulk bar — appears the moment anything is selected */}
        {selected.size > 0 && (
          <div className="rise-in flex flex-wrap items-center gap-2 border-b border-brand/20 bg-brand/5 px-3 py-2">
            <span className="font-mono text-xs font-semibold text-brand">{selected.size} selected</span>
            <span className="text-xs text-muted-foreground">merge victims — active stops only</span>
            <div className="ml-auto flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-9 text-xs" onClick={clearSelection} disabled={busy}>
                Clear
              </Button>
              <Button
                size="sm"
                className="h-9 text-xs"
                onClick={() => {
                  if (survivorId) void previewMerge()
                  else document.getElementById('merge-tool')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }}
                disabled={busy}
              >
                {survivorId ? 'Preview merge' : 'Choose survivor'}
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-2.5">
                <Skeleton className="size-4 rounded" />
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="ml-auto h-3 w-16" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          query || statusFilter !== 'all' || hubOnly ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <MapPin className="size-6 text-muted-foreground/50" />
              <p className="text-sm font-semibold tracking-tight">No stops</p>
              <p className="max-w-[38ch] text-xs text-muted-foreground">Nothing matches this search or filter.</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-14 text-center">
              <MapPin className="size-6 text-muted-foreground/50" />
              <p className="text-sm font-semibold tracking-tight">No stops yet</p>
              <p className="max-w-[46ch] text-xs leading-relaxed text-muted-foreground">
                The GTFS feed hasn&apos;t been imported. Stops load from <span className="font-mono">kigali_gtfs/</span> via a
                one-time sync to Supabase — run the import script from the repo root (needs{' '}
                <span className="font-mono">NEXT_SUPABASE_CONNECTION_STRING</span>).
              </p>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={copyImportCommand}>
                {cmdCopied ? <Check className="size-3.5" /> : <Terminal className="size-3.5" />}
                {cmdCopied ? 'Command copied' : 'Copy import command'}
              </Button>
            </div>
          )
        ) : (
          <>
            {/* Select-all row */}
            <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
              <Checkbox
                checked={allVisibleSelected}
                indeterminate={someVisibleSelected && !allVisibleSelected}
                onCheckedChange={toggleSelectAll}
                disabled={visibleActive.length === 0 || busy}
                aria-label={
                  allVisibleSelected ? 'Deselect all active stops on this page' : 'Select all active stops on this page'
                }
              />
              <span className="text-xs text-muted-foreground">
                {allVisibleSelected ? 'Deselect all' : 'Select all'} active on this page
                {selected.size > 0 && <span className="font-mono"> · {selected.size} total selected</span>}
              </span>
              <span className="ml-auto font-mono text-xs text-muted-foreground">
                {`Showing ${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, sorted.length)} of ${sorted.length.toLocaleString()}`}
              </span>
            </div>

            <div className="divide-y divide-border">
            {pageItems.map((s, idx) => {
              const isVictim = selected.has(s.id)
              return (
                <div
                  key={s.id}
                  className="rise-in flex flex-wrap items-center gap-2 px-3 py-2.5 pl-4"
                  style={{ '--rise-index': Math.min(idx, 8) } as CSSProperties}
                >
                  <Checkbox
                    checked={isVictim}
                    onCheckedChange={() => toggleSelected(s.id)}
                    disabled={s.status !== 'active' || busy}
                    aria-label={`Select ${s.name} as a merge victim`}
                    className="shrink-0"
                  />
                  <Badge className={`w-16 shrink-0 justify-center font-mono text-xs ${STATUS_BADGE[s.status]}`}>
                    {s.status === 'active' ? 'ACTIVE' : s.status === 'merged' ? 'MERGED' : 'HIDDEN'}
                  </Badge>
                  {s.isHub && (
                    <Badge className="shrink-0 bg-muted/60 font-semibold text-muted-foreground">HUB</Badge>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold tracking-tight">
                      {s.name}
                      {s.status === 'merged' && s.mergedIntoId && (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                          → {byId.get(s.mergedIntoId)?.name ?? s.mergedIntoId}
                        </span>
                      )}
                    </p>
                    <p className="truncate font-mono text-xs text-muted-foreground">{s.id}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {s.status === 'active' && (
                      <Button size="sm" variant="ghost" className="h-9 gap-1 px-2 text-xs" onClick={() => openEdit(s)} disabled={busy}>
                        <PencilSimple className="size-3" /> Edit
                      </Button>
                    )}
                    {isAdmin && s.status === 'active' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-9 gap-1 px-2 text-xs text-warning hover:opacity-80"
                        onClick={() => hide(s.id, s.name)}
                        disabled={busy}
                      >
                        <ShieldSlash className="size-3" /> Hide
                      </Button>
                    )}
                    {isAdmin && s.status !== 'active' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-9 gap-1 px-2 text-xs text-brand hover:text-brand"
                        onClick={() => restore(s.id, s.name)}
                        disabled={busy}
                      >
                        <ArrowCounterClockwise className="size-3" /> Restore
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
            </div>

            {/* Pagination */}
            {pageCount > 1 && (
              <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
                <span className="text-xs text-muted-foreground">
                  {sorted.length.toLocaleString()} stop{sorted.length === 1 ? '' : 's'} total
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-9 px-3 text-xs"
                    onClick={() => setPage(safePage - 1)}
                    disabled={safePage <= 1}
                  >
                    Prev
                  </Button>
                  <span className="min-w-10 text-center font-mono text-xs text-muted-foreground">
                    {safePage} / {pageCount}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-9 px-3 text-xs"
                    onClick={() => setPage(safePage + 1)}
                    disabled={safePage >= pageCount}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {/* Recent merges (undo + curator audit) */}
      <Card className="p-4">
        <p className="flex items-center gap-2 text-xs font-semibold">
          <ArrowCounterClockwise className="size-3.5 text-muted-foreground" /> Recent merges
        </p>
        {merges.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">No merges yet — this is the undo + audit trail.</p>
        ) : (
          <div className="mt-2 divide-y divide-border">
            {merges.slice(0, 10).map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="font-mono text-xs text-muted-foreground">{m.victimIds.length}→</span>
                <span className="min-w-0 flex-1 truncate text-xs">
                  <span className="font-semibold">{byId.get(m.survivorId)?.name ?? m.survivorId}</span>
                  {m.reason && <span className="text-muted-foreground"> — {m.reason}</span>}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {fmtTime(m.createdAt)} · {m.actorId}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 text-xs"
                  onClick={() => undo(m.id)}
                  disabled={busy}
                >
                  Undo
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Edit dialog */}
      {editTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Edit ${editTarget.name}`}
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setEditTarget(null)
          }}
        >
          <div className="rise-in w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-lg">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold tracking-tight">Edit stop</p>
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                disabled={busy}
                aria-label="Close"
                className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">{editTarget.id}</p>
            <div className="mt-4 space-y-3">
              <div>
                <label htmlFor="edit-name" className="mb-1 block text-xs font-semibold text-muted-foreground">
                  Name
                </label>
                <Input id="edit-name" value={editName} onChange={(e) => setEditName(e.target.value)} className="h-10 text-xs" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-lat" className="mb-1 block text-xs font-semibold text-muted-foreground">
                    Lat
                  </label>
                  <Input id="edit-lat" value={editLat} onChange={(e) => setEditLat(e.target.value)} className="h-10 font-mono text-xs" />
                </div>
                <div>
                  <label htmlFor="edit-lon" className="mb-1 block text-xs font-semibold text-muted-foreground">
                    Lon
                  </label>
                  <Input id="edit-lon" value={editLon} onChange={(e) => setEditLon(e.target.value)} className="h-10 font-mono text-xs" />
                </div>
              </div>
              <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                <span>
                  <span className="block text-xs font-semibold">Hub stop</span>
                  <span className="block text-xs text-muted-foreground">Pinned as a terminal / interchange</span>
                </span>
                <Switch checked={editHub} onCheckedChange={setEditHub} />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditTarget(null)} disabled={busy} className="h-9 text-xs">
                Cancel
              </Button>
              <Button size="sm" onClick={saveEdit} disabled={busy} className="h-9 text-xs">
                {busy ? <CircleNotch className="size-3.5 animate-spin" /> : <CheckCircle className="size-3.5" />} Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
