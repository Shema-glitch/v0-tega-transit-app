'use client'

/**
 * components/admin/command-palette.tsx — Cmd+K / Ctrl+K command palette.
 *
 * The one navigation tool both UI reviews asked for, in one place: fast
 * jumps across the console's sections plus one-key access to the heavy
 * actions that otherwise live inside the Endpoints section. The palette is
 * a dumb view — the admin page owns every handler (and the role, so
 * admin-only sections are hidden from curators exactly like the sidebar).
 */

import { useEffect, useState } from 'react'
import { RefreshCw, RotateCw, Zap } from 'lucide-react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'
import { NAV_GROUPS, type AdminRole, type ConsoleSection } from '@/components/app-sidebar'

interface CommandPaletteProps {
  role: AdminRole | null
  onNavigate: (section: ConsoleSection) => void
  onRunChecks: () => void
  onStartSse: () => void
  onRefresh: () => void
}

export function CommandPalette({
  role,
  onNavigate,
  onRunChecks,
  onStartSse,
  onRefresh,
}: CommandPaletteProps) {
  const [open, setOpen] = useState(false)

  // Global Cmd+K / Ctrl+K — toggle from anywhere in the console. The dialog
  // swallows Escape (first press clears the query, second closes) so there's
  // no clash with the shortcut itself.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const groups = NAV_GROUPS.map((group) => ({
    label: group.label,
    items: group.items.filter((item) => !(item.adminOnly && role !== 'admin')),
  })).filter((group) => group.items.length > 0)

  const run = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Admin command menu">
      <CommandInput placeholder="Jump to a section or run an action…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {groups.map((group) => (
          <CommandGroup key={group.label} heading={group.label}>
            {group.items.map((item) => (
              <CommandItem
                key={item.id}
                value={`${group.label.toLowerCase()}:${item.label.toLowerCase()}`}
                onSelect={run(() => onNavigate(item.id))}
              >
                <item.icon />
                <span>{item.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem
            value="actions:re-run all checks"
            onSelect={run(onRunChecks)}
          >
            <RefreshCw />
            <span>Re-run all checks</span>
            <CommandShortcut>endpoints</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="actions:start live sse monitor"
            onSelect={run(onStartSse)}
          >
            <Zap />
            <span>Start live SSE monitor</span>
            <CommandShortcut>endpoints</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="actions:refresh dashboard"
            onSelect={run(onRefresh)}
          >
            <RotateCw />
            <span>Refresh dashboard</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
