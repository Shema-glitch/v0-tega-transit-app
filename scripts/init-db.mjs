import pkg from 'pg'
const { Client } = pkg
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.join(__dirname, '..', '.env') })

const connectionString = process.env.NEXT_SUPABASE_CONNECTION_STRING

if (!connectionString) {
  console.error('Missing NEXT_SUPABASE_CONNECTION_STRING in .env file')
  process.exit(1)
}

async function main() {
  // Fix URL if password contains unencoded slashes
  let safeConnectionString = connectionString
  try {
    const parsed = new URL(connectionString)
  } catch(e) {
    // If it fails to parse, it's likely an unencoded special character in the password
    const matches = connectionString.match(/postgresql:\/\/([^:]+):([^@]+)@(.*)/)
    if (matches) {
      safeConnectionString = `postgresql://${matches[1]}:${encodeURIComponent(matches[2])}@${matches[3]}`
    }
  }

  const client = new Client({
    connectionString: safeConnectionString,
  })

  try {
    await client.connect()
    console.log('Connected to database')

    const schemaPath = path.join(__dirname, '..', 'supabase', 'schema.sql')
    const schemaSql = fs.readFileSync(schemaPath, 'utf8')

    console.log('Executing schema.sql...')
    await client.query(schemaSql)
    console.log('Schema executed successfully!')
  } catch (err) {
    console.error('Error executing schema:', err)
  } finally {
    await client.end()
  }
}

main()
