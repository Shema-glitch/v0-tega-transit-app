import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'BusGo Track API — Status',
  description:
    'Developer status page for the BusGo Track API: GTFS stops, routes, arrivals, and realtime vehicle streaming for Kigali.',
  icons: {
    icon: '/icon.svg',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
