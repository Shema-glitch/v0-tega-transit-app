import { Client } from 'pg'
import dotenv from 'dotenv'

dotenv.config({ path: '.env' })
dotenv.config({ path: '.env.local' })

async function migrate() {
  const connectionString = process.env.NEXT_SUPABASE_CONNECTION_STRING
  
  if (!connectionString) {
    console.error('Missing NEXT_SUPABASE_CONNECTION_STRING in environment.')
    process.exit(1)
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  })

  try {
    console.log('Connecting to Supabase PostgreSQL...')
    await client.connect()
    
    console.log('Enabling PostGIS extension...')
    await client.query('CREATE EXTENSION IF NOT EXISTS postgis;')

    console.log('Adding geometry column to stops table...')
    await client.query(`
      ALTER TABLE stops 
      ADD COLUMN IF NOT EXISTS location geometry(Point, 4326);
    `)

    console.log('Migrating existing lat/lon to geometry column...')
    await client.query(`
      UPDATE stops 
      SET location = ST_SetSRID(ST_MakePoint(stop_lon, stop_lat), 4326)
      WHERE stop_lon IS NOT NULL AND stop_lat IS NOT NULL;
    `)

    console.log('Creating spatial GIST index for rapid spatial queries...')
    await client.query(`
      CREATE INDEX IF NOT EXISTS stops_location_gix 
      ON stops USING GIST (location);
    `)

    console.log('PostGIS Migration Complete!')
  } catch (error) {
    console.error('Migration failed:', error)
  } finally {
    await client.end()
  }
}

migrate()
