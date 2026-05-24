const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const { createClient } = require('@supabase/supabase-js');

// Must be run with: node --env-file=.env scripts/push-gtfs.js

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY in environment");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const GTFS_DIR = path.join(__dirname, '..', 'kigali_gtfs');

// Order matters for foreign keys (if enabled). Here we just insert what's available.
const TABLES_TO_SYNC = [
  'agency',
  'stops',
  'routes',
  'shapes',
  'trips',
  'stop_times'
];

async function insertBatch(table, records) {
  // Convert empty strings to null and stringify numbers where necessary (Supabase handles type casting mostly well)
  const cleanedRecords = records.map(record => {
    const clean = {};
    for (const [key, value] of Object.entries(record)) {
      clean[key] = value === '' ? null : value;
    }
    return clean;
  });

  const { error } = await supabase.from(table).upsert(cleanedRecords);
  if (error) {
    console.error(`Error inserting batch into ${table}:`, error.message);
  }
}

async function processFile(table) {
  const filePath = path.join(GTFS_DIR, `${table}.txt`);
  if (!fs.existsSync(filePath)) {
    console.log(`Skipping ${table}: file not found.`);
    return;
  }

  console.log(`Processing ${table}...`);
  
  return new Promise((resolve, reject) => {
    let batch = [];
    let count = 0;
    const BATCH_SIZE = 1000;

    const parser = fs.createReadStream(filePath)
      .pipe(parse({ columns: true, skip_empty_lines: true }));

    parser.on('data', async (record) => {
      batch.push(record);
      if (batch.length >= BATCH_SIZE) {
        parser.pause();
        await insertBatch(table, batch);
        count += batch.length;
        console.log(`  Inserted ${count} rows into ${table}...`);
        batch = [];
        parser.resume();
      }
    });

    parser.on('end', async () => {
      if (batch.length > 0) {
        await insertBatch(table, batch);
        count += batch.length;
      }
      console.log(`Finished ${table}. Total rows: ${count}`);
      resolve();
    });

    parser.on('error', (err) => {
      console.error(`Error parsing ${table}:`, err);
      reject(err);
    });
  });
}

async function main() {
  console.log("Starting GTFS sync to Supabase...");
  for (const table of TABLES_TO_SYNC) {
    await processFile(table);
  }
  console.log("Sync complete.");
}

main().catch(console.error);
