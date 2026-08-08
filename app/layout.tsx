import type { Metadata } from 'next'
import './globals.css'
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: 'BusGo Track API — Status',
  description:
    'Developer status page for the BusGo Track API: GTFS stops, routes, arrivals, and realtime vehicle streaming for Kigali.',
  icons: {
    icon: '/assets/busgo-favicon-dark.ico',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body>{children}</body>
    </html>
  )
}
