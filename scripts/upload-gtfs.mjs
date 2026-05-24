import { createClient } from '@supabase/supabase-js'
import { parse } from 'csv-parse'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env file')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)
const gtfsDir = path.join(__dirname, '..', 'kigali_gtfs')

async function uploadFile(filename, tableName, batchSize = 500) {
  const filePath = path.join(gtfsDir, filename)
  if (!fs.existsSync(filePath)) {
    console.log(`Skipping ${filename} - file not found.`)
    return
  }

  console.log(`Uploading ${filename} to table '${tableName}'...`)
  
  return new Promise((resolve, reject) => {
    const records = []
    
    fs.createReadStream(filePath)
      .pipe(parse({
        columns: true,
        skip_empty_lines: true,
        trim: true
      }))
      .on('data', (data) => {
        // Clean empty string values to null for integers/floats
        for (const key in data) {
          if (data[key] === '') data[key] = null
        }
        records.push(data)
      })
      .on('error', (err) => {
        console.error(`Error parsing ${filename}:`, err)
        reject(err)
      })
      .on('end', async () => {
        console.log(`Parsed ${records.length} records from ${filename}. Batch inserting...`)
        
        let successCount = 0
        let errorCount = 0

        for (let i = 0; i < records.length; i += batchSize) {
          const batch = records.slice(i, i + batchSize)
          const { error } = await supabase.from(tableName).upsert(batch, { ignoreDuplicates: false })
          
          if (error) {
            console.error(`Error inserting batch ${i / batchSize + 1}:`, error.message)
            errorCount += batch.length
            // Keep going with other batches
          } else {
            successCount += batch.length
            process.stdout.write(`\rInserted ${successCount}/${records.length} records...`)
          }
        }
        
        console.log(`\nFinished ${filename}: ${successCount} successful, ${errorCount} failed.`)
        resolve()
      })
  })
}

async function main() {
  console.log('Starting GTFS to Supabase migration...')
  console.log(`Connecting to: ${supabaseUrl}`)

  try {
    // Check connection / table existence by selecting 1 row
    const { error: checkError } = await supabase.from('stops').select('stop_id').limit(1)
    if (checkError) {
      console.error('\nERROR: Cannot access the "stops" table.')
      console.error('Message:', checkError.message)
      console.error('\nDid you run the supabase/schema.sql file in your Supabase SQL Editor?')
      console.error('You MUST execute the schema to create the tables before running this script.')
      process.exit(1)
    }

    // Upload files in dependency order
    await uploadFile('agency.txt', 'agency')
    await uploadFile('stops.txt', 'stops')
    await uploadFile('routes.txt', 'routes')
    await uploadFile('trips.txt', 'trips')
    await uploadFile('stop_times.txt', 'stop_times', 1000) // These can be large, use bigger batch if safe
    // Note: shapes.txt is huge (4.5MB). We use a larger batch or it will take very long.
    await uploadFile('shapes.txt', 'shapes', 2000)

    console.log('\nMigration complete!')
  } catch (err) {
    console.error('\nMigration failed:', err)
  }
}

main()
