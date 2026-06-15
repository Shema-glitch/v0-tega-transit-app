import { NextResponse } from 'next/server'
import { CacheService } from '@/lib/api/cache.service'

// Grouped transit hubs for simplified frontend UI rendering
const HUBS = [
  {
    id: 'hub-nyabugogo',
    name: 'Nyabugogo Transit Hub',
    latitude: -1.9367,
    longitude: 30.0485,
    stops: ['stop-nyabugogo']
  },
  {
    id: 'hub-downtown',
    name: 'Downtown City Center',
    latitude: -1.9450,
    longitude: 30.0590,
    stops: ['stop-downtown', 'stop-kn3', 'stop-ubumwe']
  },
  {
    id: 'hub-remera',
    name: 'Remera Bus Park',
    latitude: -1.9520,
    longitude: 30.0920,
    stops: ['stop-remera', 'stop-kisimenti']
  },
  {
    id: 'hub-kimironko',
    name: 'Kimironko Market Hub',
    latitude: -1.9320,
    longitude: 30.1050,
    stops: ['stop-kimironko', 'stop-kimironko-taxi']
  }
]

export async function GET() {
  try {
    return NextResponse.json(
      { hubs: HUBS, metadata: { source: 'static_hubs', total: HUBS.length } },
      { headers: CacheService.staticHeaders() }
    )
  } catch (error) {
    console.error('Hubs API Error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
