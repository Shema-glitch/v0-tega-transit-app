'use client'

/**
 * components/admin/notification-center.tsx — live activity feed for the admin
 * header.
 *
 * The dashboard polls every 15s; this component turns *diffs* between polls
 * into notifications — new issues, new pending suggestions, new load alerts.
 * It is a dumb leaf: the page owns the list (detection happens in the poll
 * handler) and passes it in, so this component only handles the bell UI, the
 * unread badge, and the dropdown. Built on the shadcn Popover (Base UI), so
 * focus trapping, outside-click, and Escape handling come from the primitive.
 */

import { useEffect, useState } from 'react'
import { Bell, Bug, Checks, DotOutline, Gauge } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverPortal,
  PopoverPositioner,
  PopoverPopup,
  PopoverTrigger,
} from '@/components/ui/popover'
import type { ConsoleSection } from '@/components/app-sidebar'

export interface AdminNotification {
  id: string
  kind: 'issue' | 'suggestion' | 'alert'
  title: string
  detail: string
  section: ConsoleSection
  ts: number
  read: boolean
}

const KIND_ICON = {
  issue: Bug,
  suggestion: DotOutline,
  alert: Gauge,
} as const

const KIND_COLOR = {
  issue: 'text-destructive',
  suggestion: 'text-warning',
  alert: 'text-danger',
} as const

function timeAgo(ms: number, now: number): string {
  const sec = Math.floor((now - ms) / 1000)
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

export function NotificationCenter({
  notifications,
  onSelect,
  onMarkAllRead,
}: {
  notifications: AdminNotification[]
  onSelect: (section: ConsoleSection) => void
  onMarkAllRead: () => void
}) {
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const unread = notifications.filter((n) => !n.read).length

  // Keep a 15s clock only while open so the relative timestamps stay fresh
  // without re-rendering the whole header. Base UI handles close-on-outside.
  useEffect(() => {
    if (!open) return
    const clock = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(clock)
  }, [open])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="relative h-9 w-9 px-0"
            aria-label={`Notifications${unread > 0 ? ` — ${unread} unread` : ''}`}
          />
        }
      >
        <Bell className="size-3.5" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 font-mono text-xs font-bold text-white shadow-[0_0_0_3px_color-mix(in_oklab,var(--danger)_20%,transparent)]">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </PopoverTrigger>

      <PopoverPortal>
        <PopoverPositioner align="end" sideOffset={8} className="z-50">
          <PopoverPopup className="panel-pop w-[min(92vw,22rem)] gap-0 overflow-hidden p-0">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
              <p className="text-xs font-semibold tracking-tight">Notifications</p>
              {unread > 0 && (
                <span className="rounded-full bg-danger/10 px-1.5 py-0.5 font-mono text-xs font-bold text-danger">
                  {unread} new
                </span>
              )}
              {unread > 0 && (
                <button
                  type="button"
                  onClick={onMarkAllRead}
                  className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Checks className="size-3" /> Mark all read
                </button>
              )}
            </div>

            {notifications.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <Bell className="size-5 text-muted-foreground/50" />
                <p className="text-xs font-semibold tracking-tight">No notifications</p>
                <p className="max-w-[30ch] text-xs text-muted-foreground">
                  New issues, suggestions, and load alerts land here live.
                </p>
              </div>
            ) : (
              <div className="max-h-80 divide-y divide-border overflow-y-auto">
                {notifications.slice(0, 50).map((n) => {
                  const Icon = KIND_ICON[n.kind]
                  return (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => onSelect(n.section)}
                      className="flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
                    >
                      <Icon className={`mt-0.5 size-4 shrink-0 ${KIND_COLOR[n.kind]}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold tracking-tight">{n.title}</span>
                        <span className="mt-1 block truncate text-xs text-muted-foreground">{n.detail}</span>
                      </span>
                      {!n.read && <span className="mt-1 size-1.5 shrink-0 rounded-full bg-brand" />}
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">{timeAgo(n.ts, now)}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </PopoverPopup>
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>
  )
}
