import type { Metadata } from 'next'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'Page not found — BusGo Track',
  robots: { index: false, follow: false },
}

/**
 * Custom 404 — every unknown route lands here instead of the bare Next.js
 * default. Branded like the public status page, with a clear way back and
 * no dead ends (no broken links, no "Oops!" copy).
 */
export default function NotFound() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      {/* Header — same treatment as the status page */}
      <header className="mb-14">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/busgo-logo-light-sm.png" alt="BusGo Track" className="h-14 w-auto" />
          <h1 className="text-xl font-bold tracking-tight">BusGo Track</h1>
        </div>
      </header>

      <Card className="rise-in relative gap-0 overflow-hidden p-10 sm:p-14">
        {/* Ghost numeral — presence without noise */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-8 -right-4 select-none text-[11rem] leading-none font-black tracking-tighter text-foreground/[0.045] sm:-right-8 sm:text-[14rem]"
        >
          404
        </span>

        <p className="relative text-xs font-semibold tracking-[0.22em] text-emerald-600 uppercase">
          Error 404
        </p>
        <h2 className="relative mt-4 max-w-md text-3xl font-bold tracking-tight text-balance sm:text-4xl">
          This page doesn&apos;t exist.
        </h2>
        <p className="relative mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
          The link may be broken, or the page may have moved. If you typed the address, double-check
          the spelling — otherwise head back to the status page for live service information.
        </p>

        <div className="relative mt-9 flex flex-wrap items-center gap-3">
          <Link href="/" className={cn(buttonVariants({ variant: 'default' }), 'h-11 px-6')}>
            Back to the status page
          </Link>
        </div>
      </Card>

      <footer className="mt-12 text-center text-xs text-muted-foreground">
        BusGo Track · Live transit data for Kigali, Rwanda
      </footer>
    </main>
  )
}
