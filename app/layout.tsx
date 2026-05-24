import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { ThemeProvider } from '@/components/theme-provider'
import 'mapbox-gl/dist/mapbox-gl.css'
import './globals.css'

const inter = Inter({ 
  subsets: ['latin'],
  variable: '--font-inter',
})

export const metadata: Metadata = {
  title: 'Tega - Bus Tracking for Kigali',
  description: 'Real-time bus tracking for Kigali commuters. Know when your bus arrives with confidence-based ETAs.',
  generator: 'Tega',
  manifest: '/manifest.json',
  keywords: ['bus', 'transit', 'kigali', 'rwanda', 'public transport', 'ETA', 'tracking'],
  authors: [{ name: 'Tega' }],
  icons: {
    icon: '/icon.svg',
    apple: '/apple-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Tega',
  },
  openGraph: {
    title: 'Tega - Bus Tracking for Kigali',
    description: 'Real-time bus tracking for Kigali commuters',
    type: 'website',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#00a896',
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="bg-background" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased overflow-hidden`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
          {process.env.NODE_ENV === 'production' && <Analytics />}
        </ThemeProvider>
      </body>
    </html>
  )
}
