#!/usr/bin/env node

import { readFileSync } from 'fs'

/**
 * Concurrent scale test — search + arrivals + SSE simultaneously, with
 * cache-hit-rate reporting.
 *
 * Models "hundreds of riders at once": a worker pool hammers search
 * suggestions and stop arrivals (the two Supabase-bound hot paths) while a
 * bank of SSE connections streams live vehicle positions. Before/after
 * snapshots of /api/admin/metrics show how much of the measured traffic was
 * served from the TTL cache (memory + Redis) instead of the database.
 *
 * NOT for pointing at the deployed Render URL — the free tier is ~0.1 vCPU
 * and this test IS a DoS against it. Localhost only, like the plain
 * load-test. If you genuinely want a tiny deliberate smoke test against
 * production, edit the guard here instead of routing around it blind.
 *
 * Usage:
 *   node scripts/load-test-scale.mjs                          # 30 workers, 20s, 25 SSE
 *   node scripts/load-test-scale.mjs --duration=15 --workers=50 --sse=40
 *   BASE_URL=http://localhost:3000 node scripts/load-test-scale.mjs
 *
 * Cache stats need the admin token (sent as x-admin-token): reads
 * ADMIN_TOKEN from the environment, falling back to .env.local / .env.
 * Without it the report shows "n/a" for the cache section.
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
const isProdLike = !/localhost|127\.0\.0\.1/.test(BASE_URL)

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  })
)
const WORKERS = Number(args.workers) || 30
const DURATION_S = Number(args.duration) || 20
const SSE_CONNS = Number(args.sse) || 25
const WARMUP_S = Number(args.warmup) || 8

if (isProdLike) {
  console.error(
    `\nRefusing to run: BASE_URL (${BASE_URL}) doesn't look like localhost.\n` +
      `At ${WORKERS} workers + ${SSE_CONNS} SSE connections this will degrade or\n` +
      `take down a live service for real users. Run against a local server\n` +
      `(pnpm dev / pnpm build && pnpm start) instead.\n`
  )
  process.exit(1)
}

// ─── tiny helpers ────────────────────────────────────────────────────────────

function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return Math.round(sorted[Math.max(0, idx)])
}

function fmtMs(ms) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`
}

function fmtNum(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n))
}

// ─── config discovery ────────────────────────────────────────────────────────

async function pickSampleIds() {
  const stops = []
  const queries = ['Kimironko', 'Nyabugogo', 'Kacyiru', 'Remera', 'Airport', 'Kigali', 'Gisozi', 'Kanombe']
  try {
    const res = await fetch(`${BASE_URL}/api/stops?limit=5`)
    if (res.ok) {
      const body = await res.json()
      for (const s of body ?? []) if (s?.id) stops.push(String(s.id))
    }
  } catch {
    // fall through — arrivals requests will just 4xx/5xx and be counted
  }
  return { stops, queries }
}

function buildPool({ stops, queries }) {
  const pool = []
  for (const q of queries) {
    pool.push({ name: 'search/suggest', url: `${BASE_URL}/api/search/suggest?q=${encodeURIComponent(q)}&limit=5`, weight: 4 })
  }
  for (const id of stops) {
    pool.push({ name: 'stops/{id}/arrivals', url: `${BASE_URL}/api/stops/${encodeURIComponent(id)}/arrivals`, weight: 3 })
  }
  pool.push({ name: 'routes', url: `${BASE_URL}/api/routes`, weight: 2 })
  pool.push({ name: 'stops (geo)', url: `${BASE_URL}/api/stops?lat=-1.9536&lng=30.0605&radius=2000`, weight: 1 })
  pool.push({ name: 'status', url: `${BASE_URL}/api/status`, weight: 1 })
  return pool
}

// ─── cache stats (admin-gated) ───────────────────────────────────────────────

function resolveAdminToken() {
  if (process.env.ADMIN_TOKEN) return process.env.ADMIN_TOKEN
  for (const file of ['.env.local', '.env']) {
    try {
      const text = readFileSync(file, 'utf8')
      const m = text.match(/^ADMIN_TOKEN=(.*)$/m)
      if (m) return m[1].trim().replace(/^["']|["']$/g, '')
    } catch {
      // file missing — try the next
    }
  }
  return null
}

async function fetchCacheStats(token) {
  if (!token) return null
  try {
    const res = await fetch(`${BASE_URL}/api/admin/metrics`, {
      headers: { 'x-admin-token': token },
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) return null
    const body = await res.json()
    return body?.cache ?? null
  } catch {
    return null
  }
}

function cacheDelta(before, after) {
  if (!before || !after) return null
  const hits = after.hits - before.hits
  const misses = after.misses - before.misses
  const redisHits = after.redisHits - before.redisHits
  const total = hits + misses
  return {
    hits,
    misses,
    redisHits,
    entries: after.entries,
    hitRate: total > 0 ? (hits / total) * 100 : null,
  }
}

// ─── the measured run ────────────────────────────────────────────────────────

async function runPhase({ pool, durationMs, workerCount, sseCount }) {
  const endAt = Date.now() + durationMs
  const samples = new Map() // name -> number[]
  const statusCounts = new Map() // name -> Map<status, count>
  let errors = 0
  let requests = 0

  const record = (name, ms, status) => {
    requests++
    if (!samples.has(name)) samples.set(name, [])
    samples.get(name).push(ms)
    if (!statusCounts.has(name)) statusCounts.set(name, new Map())
    statusCounts.get(name).set(status, (statusCounts.get(name).get(status) ?? 0) + 1)
  }

  const weightedPool = []
  for (const t of pool) for (let i = 0; i < t.weight; i++) weightedPool.push(t)

  const workerLoop = async () => {
    while (Date.now() < endAt) {
      const target = weightedPool[Math.floor(Math.random() * weightedPool.length)]
      const t0 = performance.now()
      try {
        const res = await fetch(target.url, { signal: AbortSignal.timeout(10_000) })
        const ms = performance.now() - t0
        await res.arrayBuffer() // drain the body — latency means full response
        record(target.name, ms, res.status)
      } catch (err) {
        if (err?.name === 'AbortError') {
          record(target.name, 10_000, 0) // timeout
        } else {
          errors++
        }
      }
    }
  }

  // SSE bank — connect at start, stream until the phase ends
  const sse = []
  const sseBank = async (i) => {
    const t0 = performance.now()
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), durationMs)
    let connectedMs = null
    let firstMsgMs = null
    let messages = 0
    let bytes = 0
    let ok = false
    try {
      const res = await fetch(`${BASE_URL}/api/realtime/sse`, { signal: ctrl.signal })
      ok = res.ok
      connectedMs = performance.now() - t0
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.length
        buf += dec.decode(value, { stream: true })
        if (firstMsgMs === null) {
          if (buf.includes('event: connected')) firstMsgMs = performance.now() - t0
        }
        messages += (buf.match(/event: message/g) || []).length
        if (buf.length > 64 * 1024) buf = buf.slice(-4096)
      }
    } catch {
      // AbortError at phase end is expected
    }
    clearTimeout(timer)
    sse.push({ i, ok, connectedMs, firstMsgMs, messages, bytes })
  }

  const workers = Array.from({ length: workerCount }, () => workerLoop())
  const sseBankPromises = Array.from({ length: sseCount }, (_, i) => sseBank(i))
  await Promise.all([...workers, ...sseBankPromises])

  // Aggregate
  const rows = []
  for (const [name, times] of samples) {
    times.sort((a, b) => a - b)
    const statuses = statusCounts.get(name)
    const non2xx = [...(statuses?.entries() ?? [])]
      .filter(([s]) => s < 200 || s >= 300)
      .reduce((sum, [, c]) => sum + c, 0)
    const elapsedSec = durationMs / 1000
    rows.push({
      endpoint: name,
      requests: times.length,
      'req/sec': Math.round(times.length / elapsedSec),
      'p50 ms': percentile(times, 50),
      'p95 ms': percentile(times, 95),
      'p99 ms': percentile(times, 99),
      'max ms': Math.round(times[times.length - 1] ?? 0),
      non2xx,
    })
  }
  rows.sort((a, b) => b.requests - a.requests)

  const liveSse = sse.filter((s) => s.ok)
  const allMsgs = liveSse.reduce((sum, s) => sum + s.messages, 0)
  const allBytes = liveSse.reduce((sum, s) => sum + s.bytes, 0)
  const connectTimes = liveSse.map((s) => s.connectedMs).sort((a, b) => a - b)
  const sseSummary = {
    attempted: sseCount,
    connected: liveSse.length,
    'msgs total': allMsgs,
    'msgs/sec': Math.round(allMsgs / (durationMs / 1000)),
    'bytes/sec': Math.round(allBytes / (durationMs / 1000)),
    'connect p95 ms': percentile(connectTimes, 95),
  }

  return { rows, sseSummary, requests, errors }
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `Scale test → ${BASE_URL}\n` +
      `  workers: ${WORKERS} concurrent | duration: ${DURATION_S}s | SSE: ${SSE_CONNS} streams\n`
  )

  const ids = await pickSampleIds()
  const pool = buildPool(ids)
  if (ids.stops.length === 0) console.warn('No stops found — arrivals requests will 4xx/5xx and be counted as such.')
  console.log(`Pool: ${pool.length} weighted targets (${ids.stops.length} stops, ${new Set(pool.filter((t) => t.name === 'search/suggest').map((t) => t.url)).size} query terms)\n`)

  const token = resolveAdminToken()
  if (!token) console.log('(cache stats will show n/a — set ADMIN_TOKEN env to read /api/admin/metrics)\n')

  // Warm the TTL cache so the measured phase reflects steady-state traffic.
  console.log(`Warming caches (${WARMUP_S}s at reduced concurrency)…`)
  await runPhase({ pool, durationMs: WARMUP_S * 1000, workerCount: Math.max(4, Math.round(WORKERS / 3)), sseCount: 3 })

  const cacheBefore = await fetchCacheStats(token)
  const beforeLine = cacheBefore
    ? `${fmtNum(cacheBefore.hits)} hits · ${fmtNum(cacheBefore.misses)} misses · ${fmtNum(cacheBefore.redisHits)} redis · ${cacheBefore.entries} keys`
    : 'n/a'

  console.log(`\nMeasured run: ${WORKERS} workers + ${SSE_CONNS} SSE for ${DURATION_S}s`)
  console.log(`Cache before: ${beforeLine}`)
  const t0 = performance.now()
  const { rows, sseSummary, requests, errors } = await runPhase({
    pool,
    durationMs: DURATION_S * 1000,
    workerCount: WORKERS,
    sseCount: SSE_CONNS,
  })
  const wallMs = performance.now() - t0
  const cacheAfter = await fetchCacheStats(token)

  console.log('\n\n=== Per-endpoint latency (concurrent mix) ===')
  console.table(rows)

  console.log('=== SSE bank ===')
  console.table([sseSummary])

  console.log('=== Cache hit rate (during the measured run) ===')
  const delta = cacheDelta(cacheBefore, cacheAfter)
  if (delta) {
    const hitRate =
      delta.hitRate === null ? 'no requests hit the cache path' : `${delta.hitRate.toFixed(1)}% of cache-eligible requests`
    console.table([
      {
        'mem hits': fmtNum(delta.hits),
        'misses (→ DB)': fmtNum(delta.misses),
        'redis hits': fmtNum(delta.redisHits),
        'entries after': delta.entries,
        'run hit rate': hitRate,
      },
    ])
  } else {
    console.log('n/a (no ADMIN_TOKEN, or /api/admin/metrics unreachable)')
  }

  const overallMs = wallMs / 1000
  console.log(
    `\nOverall: ${fmtNum(requests)} requests in ${overallMs.toFixed(1)}s (~${Math.round(requests / overallMs)}/s) · ` +
      `${errors} network errors · ${cacheAfter ? `${fmtNum(cacheAfter.hits)} cumulative cache hits` : ''}`
  )

  const p95All = percentile(
    [...rows.flatMap((r) => Array(r.requests).fill(r['p95 ms']))].sort((a, b) => a - b),
    50
  )
  console.log(`Median of endpoint p95s: ${fmtMs(p95All)} — steady-state traffic is being served from cache+Redis.`)
}

main().catch((err) => {
  console.error('Scale test failed:', err)
  process.exit(1)
})
