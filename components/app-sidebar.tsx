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
  Activity,
  BookOpen,
  Bug,
  CircleDot,
  ExternalLink,
  Gauge,
  LogOut,
  MapPin,
  ScrollText,
  Settings,
  ShieldCheck,
} from 'lucide-react'
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
//   Overview      — what's happening right now
//   Map data      — the curator's working surface
//   Administration — who can act, and how the console is secured
//   System        — deep diagnostics and docs
// Exported so the Cmd+K palette reuses the same structure (no drift).
export const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Overview',
    items: [
      { id: 'endpoints', label: 'Endpoints', icon: Activity, adminOnly: true },
      { id: 'load', label: 'Load', icon: Gauge, dot: 'loadAlerts', adminOnly: true },
    ],
  },
  {
    label: 'Map data',
    items: [
      { id: 'stops', label: 'Map & Stops', icon: MapPin },
      { id: 'suggestions', label: 'Suggestions', icon: CircleDot, badge: 'suggestions' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { id: 'admins', label: 'People', icon: ShieldCheck, adminOnly: true },
      { id: 'settings', label: 'Settings', icon: Settings },
      { id: 'audit', label: 'Audit', icon: ScrollText },
    ],
  },
  {
    label: 'System',
    items: [
      { id: 'issues', label: 'Issues', icon: Bug, badge: 'issues', adminOnly: true },
      { id: 'guide', label: 'Maintenance Guide', icon: BookOpen, adminOnly: true },
    ],
  },
]

export function AppSidebar({
  active,
  counts,
  role,
  onNavigate,
  onLogout,
  ...props
}: Omit<React.ComponentProps<typeof Sidebar>, 'role'> & {
  active: ConsoleSection
  counts: { issues: number; suggestions: number; loadAlerts: number }
  role: AdminRole | null
  onNavigate: (section: ConsoleSection) => void
  onLogout: () => void
}) {
  return (
    <Sidebar collapsible="offcanvas" variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/assets/busgo-mark-dark.png" alt="BusGo Track" className="size-6 shrink-0" />
              <div className="leading-tight">
                <p className="text-xs font-semibold tracking-[0.16em] text-brand uppercase">
                  BusGo Track
                </p>
                <p className="text-sm font-bold tracking-tight">Console</p>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
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
        <SidebarGroup className="mt-auto">
          <SidebarGroupLabel>Links</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton render={<a href="/" />} tooltip="Public status page">
                <ExternalLink />
                <span>Public status page</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={onLogout} className="text-destructive hover:bg-destructive/10 hover:text-destructive">
              <LogOut />
              <span>Log out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
