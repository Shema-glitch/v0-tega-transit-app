import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN

if (!SUPABASE_URL || !SUPABASE_KEY || !MAPBOX_TOKEN) {
  console.error('Missing environment variables. Please provide NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, and NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function reverseGeocode(lat, lng) {
  try {
    // Mapbox Geocoding API v5
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&types=neighborhood,locality,place,poi&limit=1`
    const response = await fetch(url)
    
    if (!response.ok) {
      return null
    }

    const data = await response.json()
    if (data.features && data.features.length > 0) {
      return data.features[0].text
    }
    return null
  } catch (error) {
    console.error(`Geocoding error for ${lat},${lng}:`, error)
    return null
  }
}

async function main() {
  console.log('Fetching Unknown stops from Supabase...')
  const { data: stops, error } = await supabase
    .from('stops')
    .select('stop_id, stop_lat, stop_lon')
    .eq('stop_name', 'Unknown')

  if (error) {
    console.error('Error fetching stops:', error.message)
    return
  }

  if (!stops || stops.length === 0) {
    console.log('No Unknown stops found. Database is clean!')
    return
  }

  console.log(`Found ${stops.length} Unknown stops. Starting reverse geocoding...`)
  let updatedCount = 0

  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i]
    
    // Add artificial delay to avoid hitting Mapbox rate limits (600 requests / minute)
    await new Promise(resolve => setTimeout(resolve, 150))
    
    const newName = await reverseGeocode(stop.stop_lat, stop.stop_lon)
    
    if (newName) {
      console.log(`[${i + 1}/${stops.length}] Geocoded: ${stop.stop_id} -> ${newName}`)
      const { error: updateError } = await supabase
        .from('stops')
        .update({ stop_name: newName })
        .eq('stop_id', stop.stop_id)

      if (updateError) {
        console.error(`  Failed to update DB for ${stop.stop_id}:`, updateError.message)
      } else {
        updatedCount++
      }
    } else {
      console.log(`[${i + 1}/${stops.length}] Failed to resolve name for ${stop.stop_id} (${stop.stop_lat}, ${stop.stop_lon})`)
    }
  }

  console.log(`\nFinished! Successfully updated ${updatedCount}/${stops.length} stops.`)
}

main()
