import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const gtfsDir = 'c:/Users/HP/Documents/v0-tega-transit-app/kigali_gtfs'

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
  const trips = parseCsv(fs.readFileSync(path.join(gtfsDir, 'trips.txt'), 'utf-8'))
  const stopTimes = parseCsv(fs.readFileSync(path.join(gtfsDir, 'stop_times.txt'), 'utf-8'))
  const stops = parseCsv(fs.readFileSync(path.join(gtfsDir, 'stops.txt'), 'utf-8'))
  
  const stopsMap = new Map(stops.map(s => [s.stop_id, s]))
  
  // Find a trip for route 102
  const trip102 = trips.find(t => t.route_id === '102')
  if (!trip102) {
    console.log('No trip for route 102')
    return
  }
  
  console.log('Found Trip for Route 102:', trip102.trip_id)
  
  const tripStops = stopTimes.filter(st => st.trip_id === trip102.trip_id)
  tripStops.sort((a, b) => parseInt(a.stop_sequence) - parseInt(b.stop_sequence))
  
  console.log('\nStops along Route 102:')
  tripStops.forEach(ts => {
    const stop = stopsMap.get(ts.stop_id)
    console.log(`${ts.stop_sequence}: ${stop?.stop_name} (${stop?.stop_lat}, ${stop?.stop_lon})`)
  })
}

run()
