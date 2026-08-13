'use client'

/**
 * components/app-sidebar.tsx — BusGo Track admin console navigation.
 *
 * Built on the shadcn `dashboard-01` block's Sidebar (components/ui/sidebar.tsx,
 * Base UI primitives). The sections that used to be top tabs (Issues,
 * Endpoints, Suggestions, Admins, Audit, Guide) live here so the dashboard
 * stays uncluttered — the console is the sidebar + one focused panel.
 *
 * Fully prop-driven: the admin page owns the active section, the counts, and
 * the logout handler, so this stays a dumb view.
 */

import {
  ArrowSquareOut,
  Pulse,
  BookOpen,
  Bug,
  DotOutline,
  Gauge,
  Gear,
  MapPin,
  Scroll,
  ShieldCheck,
  SignOut,
} from '@phosphor-icons/react'
import { Badge } from '@/components/ui/badge'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

export type ConsoleSection =
  | 'issues'
  | 'endpoints'
  | 'suggestions'
  | 'stops'
  | 'admins'
  | 'audit'
  | 'guide'
  | 'load'
  | 'settings'

export type AdminRole = 'admin' | 'curator'

interface NavItem {
  id: ConsoleSection
  label: string
  icon: typeof Bug
  badge?: 'issues' | 'suggestions'
  dot?: 'loadAlerts'
  /** Min role that may see this item. Curator-only sections omit this. */
  adminOnly?: boolean
}

// Categorized nav — grouped so the console reads as a tool, not a flat list:
//   Overview        — what's happening right now
//   Map data        — the curator's working surface
//   System          — deep diagnostics and docs
//   Administration  — who can act, and how the console is secured; last, as
//                     admins expect the management section below the surfaces
//                     the dashboard is representing
// Exported so the Cmd+K palette reuses the same structure (no drift).
export const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Overview',
    items: [
      { id: 'endpoints', label: 'Endpoints', icon: Pulse, adminOnly: true },
      { id: 'load', label: 'Load', icon: Gauge, dot: 'loadAlerts', adminOnly: true },
    ],
  },
  {
    label: 'Map data',
    items: [
      { id: 'stops', label: 'Map & Stops', icon: MapPin },
      { id: 'suggestions', label: 'Suggestions', icon: DotOutline, badge: 'suggestions' },
    ],
  },
  {
    label: 'System',
    items: [
      { id: 'issues', label: 'Issues', icon: Bug, badge: 'issues', adminOnly: true },
      { id: 'guide', label: 'Maintenance Guide', icon: BookOpen, adminOnly: true },
    ],
  },
  {
    label: 'Administration',
    items: [
      { id: 'admins', label: 'People', icon: ShieldCheck, adminOnly: true },
      { id: 'settings', label: 'Settings', icon: Gear },
      { id: 'audit', label: 'Audit', icon: Scroll },
    ],
  },
]

export function AppSidebar({
  active,
  counts,
  role,
  user,
  theme = 'dark',
  onNavigate,
  onLogout,
  ...props
}: Omit<React.ComponentProps<typeof Sidebar>, 'role'> & {
  active: ConsoleSection
  counts: { issues: number; suggestions: number; loadAlerts: number }
  role: AdminRole | null
  /** Signed-in identity — shown in the footer so it's obvious who you are. */
  user?: { email: string; displayName: string | null; role: AdminRole | null } | null
  /** Console theme, so the brand mark picks the right contrast variant. */
  theme?: 'dark' | 'light'
  onNavigate: (section: ConsoleSection) => void
  onLogout: () => void
}) {
  return (
    <Sidebar collapsible="offcanvas" variant="inset" {...props}>
      <SidebarHeader>
        {/* Brand lockup — static by design: the logo is not a control, so it
            must not behave like a button (no hover fill, no focus ring). */}
        <div className="flex items-center gap-2 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={theme === 'light' ? '/assets/busgo-mark-light.png' : '/assets/busgo-mark-dark.png'}
            alt="BusGo Track"
            className="size-7 shrink-0"
          />
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold tracking-tight">BusGo Track</p>
            <p className="truncate text-xs text-muted-foreground">Console</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((item) => !(item.adminOnly && role !== 'admin'))
          if (items.length === 0) return null
          return (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarMenu>
                {items.map((item) => {
                  const count = item.badge ? counts[item.badge] : 0
                  const alertCount = item.dot ? counts[item.dot] : 0
                  return (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        isActive={active === item.id}
                        onClick={() => onNavigate(item.id)}
                        tooltip={
                          alertCount > 0
                            ? `${item.label} — ${alertCount} active alert${alertCount === 1 ? '' : 's'}`
                            : item.label
                        }
                      >
                        <item.icon />
                        <span>{item.label}</span>
                        {alertCount > 0 && (
                          <span
                            aria-label={`${alertCount} active load alert${alertCount === 1 ? '' : 's'}`}
                            className="size-2 rounded-full bg-danger shadow-[0_0_0_3px_color-mix(in_oklab,var(--danger)_18%,transparent)] group-data-[collapsible=icon]:hidden"
                          />
                        )}
                        {count > 0 && (
                          <SidebarMenuBadge className="bg-warning/10 text-warning group-data-[collapsible=icon]:hidden">
                            {count}
                          </SidebarMenuBadge>
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroup>
          )
        })}
      </SidebarContent>
      <SidebarFooter className="gap-1 pb-1">
        {/* Links — the console's way out to the public surfaces. */}
        <SidebarGroup>
          <SidebarGroupLabel>Links</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton render={<a href="/" />} tooltip="Public status page">
                <ArrowSquareOut />
                <span>Public status page</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        {/* Account — who's signed in, with their tier. */}
        {user && (
          <SidebarGroup>
            <SidebarGroupLabel>Account</SidebarGroupLabel>
            <div className="flex items-start gap-2 px-3 py-1" title={user.email}>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand/15 text-xs font-bold text-brand">
                {(user.displayName || user.email).trim().charAt(0).toUpperCase() || '?'}
              </span>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="flex items-start justify-between gap-1.5">
                  <p className="break-words text-xs font-semibold">{user.displayName || user.email}</p>
                  {user.role && (
                    <Badge
                      className={`shrink-0 font-semibold ${user.role === 'admin' ? 'bg-brand/15 text-brand' : 'bg-warning/10 text-warning'}`}
                    >
                      {user.role === 'admin' ? 'Admin' : 'Curator'}
                    </Badge>
                  )}
                </div>
                {user.displayName && (
                  <p className="mt-0.5 break-words text-xs text-muted-foreground">{user.email}</p>
                )}
              </div>
            </div>
          </SidebarGroup>
        )}

        <SidebarMenu className="p-1">
          <SidebarMenuItem>
            <SidebarMenuButton onClick={onLogout} className="text-destructive hover:bg-destructive/10 hover:text-destructive">
              <SignOut />
              <span>Log out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
