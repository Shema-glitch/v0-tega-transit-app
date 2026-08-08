/**
 * lib/api/maintenance-store.ts — durable maintenance flags.
 *
 * The admin dashboard's "disable endpoint" toggle used to live only in this
 * process's memory, so a Render restart silently re-enabled every endpoint
 * that was disabled mid-incident. Flags now write through to the
 * `maintenance_flags` Supabase table (supabase/migrations/0010) and are
 * hydrated back on boot, so a maintenance window outlives a redeploy.
 *
 * Access model:
 *   - The in-memory map is the always-available fast path. Middleware reads it
 *     synchronously on every request.
 *   - `ensureHydrated()` loads the durable rows once at startup (fast after
 *     the first call) and is awaited by middleware before any request is
 *     judged against the flags — so the first request after a restart already
 *     sees the persisted flags, closing the "silently re-enabled" window.
 *   - `set()`/`clear()` update the map immediately (instant enforcement) and
 *     fire-and-forget the same change to Supabase. If the DB write fails the
 *     flag still works in-memory for this process — exactly the old behavior.
 *   - Reads/writes use the service-role client; the table has no anon grants.
 *
 * globalThis singleton — same reasoning as lib/api/live-store.ts: pins one
 * shared store per process so the admin toggle, middleware, and the
 * SSE/status readers never see different instances.
 */

import { getSupabaseAdmin } from '../supabase-server'

export interface MaintenanceFlag {
  feature: string
  reason: string
  since: number // epoch ms
}

interface FlagRow {
  feature: string
  reason: string
  since: string
}

/** Back off after a failed hydration so a Supabase outage doesn't slow every request. */
const HYDRATE_RETRY_MS = 30_000

class Store {
  private flags: Map<string, MaintenanceFlag> = new Map()
  private hydrated = false
  private hydrating: Promise<void> | null = null
  private retryAt = 0
  private lastHydratedAt: number | null = null

  /**
   * Ensures the durable flags are loaded. Resolves immediately after the
   * first successful load; after a failed load it backs off HYDRATE_RETRY_MS
   * before trying again. Never throws.
   */
  async ensureHydrated(): Promise<void> {
    if (this.hydrated) return
    if (Date.now() < this.retryAt) return // recent failure — retry later
    if (this.hydrating) return this.hydrating
    this.hydrating = this.hydrate()
    return this.hydrating
  }

  private async hydrate(): Promise<void> {
    try {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('maintenance_flags')
        .select('feature, reason, since')
      if (error || !data) throw new Error(error?.message ?? 'no data')
      const next = new Map<string, MaintenanceFlag>()
      for (const row of data as unknown as FlagRow[]) {
        const since = Date.parse(row.since)
        if (Number.isNaN(since)) continue
        next.set(row.feature, { feature: row.feature, reason: row.reason, since })
      }
      this.flags = next
      this.hydrated = true
      this.lastHydratedAt = Date.now()
    } catch {
      // Supabase down, table not migrated yet, or bad creds — keep whatever
      // this process already knows in memory and retry after the backoff.
      this.retryAt = Date.now() + HYDRATE_RETRY_MS
    } finally {
      this.hydrating = null
    }
  }

  set(feature: string, reason: string) {
    const flag: MaintenanceFlag = { feature, reason, since: Date.now() }
    this.flags.set(feature, flag)
    void this.persist(flag)
  }

  clear(feature: string) {
    this.flags.delete(feature)
    void this.remove(feature)
  }

  getAll(): MaintenanceFlag[] {
    return Array.from(this.flags.values())
  }

  /**
   * Whether flags are backed by Supabase (durable across restarts) and when
   * they were last confirmed against it. `durable: false` means flags are
   * in-memory only — they will NOT survive a restart.
   */
  getDurability(): { durable: boolean; lastHydratedAt: number | null } {
    return { durable: this.hydrated, lastHydratedAt: this.lastHydratedAt }
  }

  /** Best-effort durable write of one flag. Swallows every failure by design. */
  private async persist(flag: MaintenanceFlag): Promise<void> {
    try {
      const supabase = getSupabaseAdmin()
      await supabase.from('maintenance_flags').upsert(
        {
          feature: flag.feature,
          reason: flag.reason,
          since: new Date(flag.since).toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'feature' }
      )
    } catch {
      // In-memory flag still enforces this process; lost on restart only.
    }
  }

  /** Best-effort durable removal of one flag. */
  private async remove(feature: string): Promise<void> {
    try {
      const supabase = getSupabaseAdmin()
      await supabase.from('maintenance_flags').delete().eq('feature', feature)
    } catch {
      /* best-effort */
    }
  }

  /** Test-only: reset the singleton so each unit test starts from a clean state. */
  resetForTests(): void {
    this.flags = new Map()
    this.hydrated = false
    this.hydrating = null
    this.retryAt = 0
    this.lastHydratedAt = null
  }
}

const STORE_KEY = Symbol.for('tega.maintenance-store')
type GlobalWithStore = typeof globalThis & { [STORE_KEY]?: Store }

const g = globalThis as GlobalWithStore
if (!g[STORE_KEY]) {
  g[STORE_KEY] = new Store()
}

export const MaintenanceStore: Store = g[STORE_KEY]!

/** Test-only: reset the singleton so each unit test starts from a clean state. */
export function __resetMaintenanceStoreForTests(): void {
  g[STORE_KEY]!.resetForTests()
}
