/**
 * Upload Cleaned GTFS Stops to Supabase via direct PostgreSQL connection.
 *
 * Requires NEXT_SUPABASE_CONNECTION_STRING (or SUPABASE_DB_PASSWORD, used to
 * build the pooler/direct variants below) in your environment — see .env.local.
 * The DB password used to be hardcoded here; it has since been rotated in
 * Supabase and must never be committed again.
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

// Read cleaned stops
const stopsPath = path.join(__dirname, '..', 'kigali_gtfs', 'stops.txt');
const content = fs.readFileSync(stopsPath, 'utf-8');
const lines = content.trim().split('\n').slice(1);

const stops = lines.map((line) => {
  const [stop_id, stop_name, stop_lat, stop_lon] = line.split(',');
  return {
    stop_id: stop_id.trim(),
    stop_name: stop_name.trim(),
    stop_lat: parseFloat(stop_lat),
    stop_lon: parseFloat(stop_lon),
  };
}).filter(s => s.stop_id && !isNaN(s.stop_lat) && !isNaN(s.stop_lon));

// Try multiple connection strategies, built from environment — never hardcode
// the DB password here again (see git history for why).
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'yhaswnumfjbjkxyhekrg';
const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;

const CONNECTIONS = [];
if (process.env.NEXT_SUPABASE_CONNECTION_STRING) {
  CONNECTIONS.push(process.env.NEXT_SUPABASE_CONNECTION_STRING);
}
if (DB_PASSWORD) {
  const pw = encodeURIComponent(DB_PASSWORD);
  CONNECTIONS.push(
    // Direct connection (port 5432)
    `postgresql://postgres:${pw}@db.${PROJECT_REF}.supabase.co:5432/postgres`,
    // Connection pooler (port 6543)
    `postgresql://postgres:${pw}@db.${PROJECT_REF}.supabase.co:6543/postgres`,
    // Supabase pooler format
    `postgresql://postgres.${PROJECT_REF}:${pw}@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`
  );
}

if (CONNECTIONS.length === 0) {
  console.error('❌ Set NEXT_SUPABASE_CONNECTION_STRING or SUPABASE_DB_PASSWORD in your environment first.');
  process.exit(1);
}

async function tryConnect(connStr) {
  const client = new Client({ connectionString: connStr, connectionTimeoutMillis: 10000 });
  await client.connect();
  return client;
}

async function main() {
  console.log('📤 Uploading cleaned stops to Supabase...\n');
  console.log(`   Read ${stops.length} cleaned stops\n`);

  let client = null;
  for (const connStr of CONNECTIONS) {
    const host = connStr.match(/@([^:/]+)/)?.[1] || 'unknown';
    const port = connStr.match(/:(\d+)\//)?.[1] || '5432';
    console.log(`   Trying ${host}:${port}...`);
    try {
      client = await tryConnect(connStr);
      console.log('   ✅ Connected!\n');
      break;
    } catch (err) {
      console.log(`   ❌ ${err.message}\n`);
    }
  }

  if (!client) {
    console.error('❌ Could not connect to any Supabase database.');
    console.log('\n💡 Manual fix: Run this SQL in the Supabase SQL Editor:');
    console.log('   1. Go to https://supabase.com/dashboard/project/yhaswnumfjbjkxyhekrg/sql');
    console.log('   2. Run: DELETE FROM stops;');
    console.log('   3. Then paste the INSERT statements from scripts/stops-insert.sql');
    process.exit(1);
  }

  // Truncate
  console.log('   Truncating stops table...');
  await client.query('DELETE FROM stops');
  const { rows: countAfterDelete } = await client.query('SELECT COUNT(*) FROM stops');
  console.log(`   ✅ Truncated (${countAfterDelete[0].count} rows remaining)\n`);

  // Insert in batches
  const BATCH_SIZE = 100;
  let inserted = 0;

  for (let i = 0; i < stops.length; i += BATCH_SIZE) {
    const batch = stops.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(stops.length / BATCH_SIZE);

    const values = [];
    const params = [];
    let paramIdx = 1;

    for (const stop of batch) {
      values.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3})`);
      params.push(stop.stop_id, stop.stop_name, stop.stop_lat, stop.stop_lon);
      paramIdx += 4;
    }

    const sql = `INSERT INTO stops (stop_id, stop_name, stop_lat, stop_lon) VALUES ${values.join(', ')} ON CONFLICT (stop_id) DO UPDATE SET stop_name = EXCLUDED.stop_name, stop_lat = EXCLUDED.stop_lat, stop_lon = EXCLUDED.stop_lon`;

    try {
      await client.query(sql, params);
      inserted += batch.length;
      process.stdout.write(`   ✅ Batch ${batchNum}/${totalBatches}\n`);
    } catch (err) {
      console.error(`   ❌ Batch ${batchNum}: ${err.message}`);
    }
  }

  // Verify
  const { rows: finalCount } = await client.query('SELECT COUNT(*) FROM stops');
  console.log(`\n   ✅ Supabase stops table now has ${finalCount[0].count} rows`);

  const { rows: sample } = await client.query('SELECT stop_id, stop_name FROM stops LIMIT 10');
  console.log('\n   📋 Sample:');
  for (const s of sample) {
    console.log(`      ${s.stop_id}: ${s.stop_name}`);
  }

  await client.end();
  console.log('\n═══════════════════════════════════════');
  console.log(`✅ Done! Uploaded ${inserted} stops.`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
