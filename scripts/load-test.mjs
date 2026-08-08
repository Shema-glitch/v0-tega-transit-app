#!/usr/bin/env node
/**
 * Local load test — measures real per-endpoint latency/throughput for this
 * codebase, independent of Render's hardware ceiling.
 *
 * NOT for pointing at the deployed Render URL: the free tier is ~0.1 vCPU /
 * 512MB with no autoscaling, so a real load test against it IS a DoS against
 * production. Run this against a locally running server only
 * (`pnpm build && pnpm start`, or `pnpm dev`) unless BASE_URL is explicitly
 * overridden and you understand the risk.
 *
 * Usage:
 *   node scripts/load-test.mjs                    # default: 20 conns, 15s per endpoint
 *   node scripts/load-test.mjs --connections=50 --duration=20
 *   BASE_URL=http://localhost:3000 node scripts/load-test.mjs
 */

import autocannon from 'autocannon'

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
const isProdLike = !/localhost|127\.0\.0\.1/.test(BASE_URL)

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  })
)
const connections = Number(args.connections) || 20
const duration = Number(args.duration) || 15

if (isProdLike) {
  console.error(
    `\nRefusing to run: BASE_URL (${BASE_URL}) doesn't look like localhost.\n` +
    `Running this at ${connections} connections against a live Render free-tier\n` +
    `instance will degrade or take down the service for real users. If you\n` +
    `really mean to do a tiny, deliberate smoke test against prod, edit this\n` +
    `guard directly rather than routing around it blind.\n`
  )
  process.exit(1)
}

async function pickSampleIds() {
  let stopId = null
  let routeId = null
  try {
    const stopsRes = await fetch(`${BASE_URL}/api/stops?limit=1`)
    const stops = await stopsRes.json()
    stopId = stops?.[0]?.id ?? null
  } catch {
    // fall through — arrivals test will be skipped
  }
  try {
    const routesRes = await fetch(`${BASE_URL}/api/routes`)
    const routes = await routesRes.json()
    routeId = routes?.[0]?.id ?? null
  } catch {
    // fall through — shape test will be skipped
  }
  return { stopId, routeId }
}

function buildTargets({ stopId, routeId }) {
  const targets = [
    { name: 'GET /api/status', path: '/api/status' },
    { name: 'GET /api/health', path: '/api/health' },
    { name: 'GET /api/routes', path: '/api/routes' },
    { name: 'GET /api/stops', path: '/api/stops?lat=-1.9536&lng=30.0605&radius=2000' },
  ]
  if (stopId) {
    targets.push({ name: 'GET /api/stops/{id}/arrivals', path: `/api/stops/${encodeURIComponent(stopId)}/arrivals` })
  }
  if (routeId) {
    targets.push({ name: 'GET /api/routes/{id}/shape', path: `/api/routes/${encodeURIComponent(routeId)}/shape` })
  }
  return targets
}

function runOne(target) {
  return new Promise((resolve, reject) => {
    const instance = autocannon(
      {
        url: `${BASE_URL}${target.path}`,
        connections,
        duration,
      },
      (err, result) => {
        if (err) return reject(err)
        resolve(result)
      }
    )
    autocannon.track(instance, { renderProgressBar: false })
  })
}

function summarize(name, result) {
  const { latency, requests, errors, non2xx, throughput } = result
  return {
    endpoint: name,
    'req/sec (avg)': requests.average,
    'p50 ms': latency.p50,
    'p95 ms': latency.p95,
    'p99 ms': latency.p99,
    'max ms': latency.max,
    errors,
    non2xx,
    'bytes/sec': throughput.average,
  }
}

async function main() {
  console.log(`Load testing ${BASE_URL} — ${connections} connections, ${duration}s per endpoint\n`)
  const ids = await pickSampleIds()
  const targets = buildTargets(ids)
  if (!ids.stopId) console.warn('No stop found via /api/stops — skipping arrivals endpoint (seed the DB first).')
  if (!ids.routeId) console.warn('No route found via /api/routes — skipping shape endpoint (seed the DB first).')

  const rows = []
  for (const target of targets) {
    console.log(`\n--- ${target.name} ---`)
    const result = await runOne(target)
    rows.push(summarize(target.name, result))
  }

  console.log('\n\n=== Summary ===')
  console.table(rows)
}

main().catch((err) => {
  console.error('Load test failed:', err)
  process.exit(1)
})
