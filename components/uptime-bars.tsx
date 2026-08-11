/**
 * components/uptime-bars.tsx — the Render-style 90-day uptime strip.
 *
 * One bar per day; the color is the worst status seen that day (down beats
 * degraded beats ok); no data renders as an empty track. Shared by the public
 * status page (light theme) and the admin dashboard (dark theme) — the
 * dark: variants keep it legible on both without any theming logic here.
 *
 * Pure render, no hooks — safe to import from either a server or a client
 * component.
 */

export interface UptimeDay {
  day: string
  ok: number
  degraded: number
  down: number
}

function dayStatus(b: UptimeDay): 'ok' | 'degraded' | 'down' | null {
  if (b.down > 0) return 'down'
  if (b.degraded > 0) return 'degraded'
  if (b.ok > 0) return 'ok'
  return null
}

const BAR_CLASS: Record<'ok' | 'degraded' | 'down', string> = {
  ok: 'bg-success/80',
  degraded: 'bg-warning/80',
  down: 'bg-danger/80',
}

const STATUS_LABEL: Record<'ok' | 'degraded' | 'down', string> = {
  ok: 'operational',
  degraded: 'degraded',
  down: 'down',
}

export default function UptimeBars({
  buckets,
  uptimePct,
  daysLabel = '90 days',
}: {
  buckets: UptimeDay[]
  uptimePct: number
  daysLabel?: string
}) {
  return (
    <div className="flex w-full items-center gap-2" role="img" aria-label={`Uptime over the past ${daysLabel}: ${uptimePct.toFixed(2)}%`}>
      {/* One bar per day, right-to-left so the newest day sits at the right edge. */}
      <div className="flex min-w-0 flex-1 items-end gap-px">
        {buckets.map((b) => {
          const status = dayStatus(b)
          return (
            <div
              key={b.day}
              title={`${b.day} — ${status ? STATUS_LABEL[status] : 'no data'}`}
              className={`h-6 flex-1 rounded-[1px] ${
                status ? BAR_CLASS[status] : 'bg-foreground/10 dark:bg-foreground/10'
              }`}
            />
          )
        })}
      </div>
      <span className="shrink-0 text-xs font-semibold tabular-nums">{uptimePct.toFixed(2)} %</span>
    </div>
  )
}
