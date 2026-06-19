import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const gtfsDir = 'c:/Users/HP/Documents/v0-tega-transit-app/kigali_gtfs'

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3 // meters
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return R * c
}

function parseCsv(content) {
  const lines = content.trim().split('\n')
  if (lines.length === 0) return []
  const headers = lines[0].split(',').map(h => h.trim())
  
  return lines.slice(1).map(line => {
    const values = line.split(',')
    const obj = {}
    headers.forEach((header, index) => {
      obj[header] = values[index]?.trim().replace(/\r$/, '')
    })
    return obj
  })
}

async function run() {
  const stops = parseCsv(fs.readFileSync(path.join(gtfsDir, 'stops.txt'), 'utf-8'))
  
  // Gatenga coordinates from Google Maps blue dot
  const gatengaLat = -1.976
  const gatengaLon = 30.091
  
  const nearby = stops.map(s => {
    const lat = parseFloat(s.stop_lat)
    const lon = parseFloat(s.stop_lon)
    return {
      ...s,
      distance: calculateDistance(gatengaLat, gatengaLon, lat, lon)
    }
  }).filter(s => s.distance <= 1000) // 1km radius
  
  nearby.sort((a, b) => a.distance - b.distance)
  
  console.log(`Found ${nearby.length} stops in GTFS stops.txt within 1km of Gatenga (-1.976, 30.091):`)
  nearby.forEach(s => {
    console.log(`- ${s.stop_name} (${s.stop_id}): dist=${Math.round(s.distance)}m, coords=(${s.stop_lat}, ${s.stop_lon})`)
  })
}

run()
