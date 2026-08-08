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
  ExternalLink,
  LogOut,
  MapPin,
  ScrollText,
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

export type ConsoleSection = 'issues' | 'endpoints' | 'suggestions' | 'admins' | 'audit' | 'guide'

const NAV: Array<{
  id: ConsoleSection
  label: string
  icon: typeof Bug
  badge?: 'issues' | 'suggestions'
}> = [
  { id: 'issues', label: 'Issues', icon: Bug, badge: 'issues' },
  { id: 'endpoints', label: 'Endpoints', icon: Activity },
  { id: 'suggestions', label: 'Suggestions', icon: MapPin, badge: 'suggestions' },
  { id: 'admins', label: 'Admins', icon: ShieldCheck },
  { id: 'audit', label: 'Audit', icon: ScrollText },
  { id: 'guide', label: 'Maintenance Guide', icon: BookOpen },
]

export function AppSidebar({
  active,
  counts,
  onNavigate,
  onLogout,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  active: ConsoleSection
  counts: { issues: number; suggestions: number }
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
                <p className="text-[10px] font-semibold tracking-[0.16em] text-emerald-400 uppercase">
                  BusGo Track
                </p>
                <p className="text-sm font-bold tracking-tight">Console</p>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Operations</SidebarGroupLabel>
          <SidebarMenu>
            {NAV.map((item) => {
              const count = item.badge ? counts[item.badge] : 0
              return (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    isActive={active === item.id}
                    onClick={() => onNavigate(item.id)}
                    tooltip={item.label}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                    {count > 0 && (
                      <SidebarMenuBadge className="bg-amber-500/15 text-amber-500 group-data-[collapsible=icon]:hidden">
                        {count}
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroup>
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
