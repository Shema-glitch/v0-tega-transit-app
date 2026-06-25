/**
 * GTFS Stops Cleanup Script — v2
 *
 * Cleans kigali_gtfs/stops.txt by:
 * 1. Removing "Unknown" stops and numeric-only names
 * 2. Normalizing stop names (title case, clean prefixes/suffixes)
 * 3. Deduplicating by coordinates (50m threshold)
 * 4. Inferring names for unnamed stops from nearby named stops
 * 5. Updating stop_times.txt to reference primary stop IDs
 */

const fs = require('fs');
const path = require('path');

const GTFS_DIR = path.join(__dirname, '..', 'kigali_gtfs');
const STOPS_FILE = path.join(GTFS_DIR, 'stops.txt');
const STOP_TIMES_FILE = path.join(GTFS_DIR, 'stop_times.txt');
const BACKUP_DIR = path.join(GTFS_DIR, 'backups');

// ── Helpers ──────────────────────────────────────────────────────────────────

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseCsv(content) {
  const lines = content.trim().split('\n');
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const values = line.split(',');
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = values[i]?.trim().replace(/\r$/, '') || '';
    });
    return obj;
  });
  return { headers, rows };
}

function toCsv(headers, rows) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => row[h] ?? '').join(','));
  }
  return lines.join('\n') + '\n';
}

// ── Name Normalization ───────────────────────────────────────────────────────

const KNOWN_LOCATIONS = {
  'nyabugogo': 'Nyabugogo',
  'remera': 'Remera',
  'kimironko': 'Kimironko',
  'sonatube': 'Sonatube',
  'rwandex': 'Rwandex',
  'kinamba': 'Kinamba',
  'kacyiru': 'Kacyiru',
  'kabuga': 'Kabuga',
  'nyamirambo': 'Nyamirambo',
  'kimihurura': 'Kimihurura',
  'nyarutarama': 'Nyarutarama',
  'kibagabaga': 'Kibagabaga',
  'gisozi': 'Gisozi',
  'muhima': 'Muhima',
  'kanombe': 'Kanombe',
  'kicukiro': 'Kicukiro',
  'gikondo': 'Gikondo',
  'kumagare': 'Kumagare',
  'kumazi': 'Kumazi',
  'camp kigali': 'Camp Kigali',
  'campkigali': 'Camp Kigali',
  'chuk': 'CHUK',
  'city market': 'City Market',
  'city plaza': 'City Plaza',
  'downtown': 'Downtown',
  'down town': 'Downtown',
  'plaza': 'City Plaza',
  'payage': 'Payage',
  'rubangura': 'Rubangura',
  'gacingiro': 'Gacingiro',
  'meteo': 'Meteo',
  'kanzayire': 'Kanzayire',
  'prince house': 'Prince House',
  'goodyear': 'Goodyear',
  'good year': 'Goodyear',
  'notre dame': 'Notre Dame',
  'st paul': 'St Paul',
  'shell': 'Shell Station',
  'free zone': 'Free Zone',
  'murindi': 'Murindi',
  'kumasezerano': 'Kumasezerano',
  'amasezerano': 'Amasezerano',
  'rubirizi': 'Rubirizi',
  'bambino': 'Bambino',
  'riviera': 'Riviera',
  'kumurindi': 'Kumurindi',
  'nyanza': 'Nyanza',
  'masaka': 'Masaka',
  'bugesera': 'Bugesera',
  'nkurunziza': 'Nkurunziza',
  'kukinamba': 'Kukinamba',
  'kumushumba mwiza': 'Kumushumba Mwiza',
  'magerwa': 'Magerwa',
  'gereza': 'Gereza',
  'kami': 'Kami',
  'berwa': 'Berwa',
  'beretoire': 'Beretoire',
  'adepr': 'ADEPR',
  'kwisoko': 'Kwisoko',
  'rafiki': 'Rafiki',
  'muhima': 'Muhima',
  'gatsata': 'Gatsata',
  'jabana': 'Jabana',
  'jali': 'Jali',
  'bumbogo': 'Bumbogo',
  'ndera': 'Ndera',
  'rusororo': 'Rusororo',
  'masoro': 'Masoro',
  'nyarugunga': 'Nyarugunga',
  'kanazi': 'Kanazi',
  'busanza': 'Busanza',
  'gahanga': 'Gahanga',
  'nyamata': 'Nyamata',
  'bugarama': 'Bugarama',
  'mageragere': 'Mageragere',
  'gasanze': 'Gasanze',
  'miduha': 'Miduha',
  'batsinda': 'Batsinda',
  'mugishaga': 'Mugishaga',
  'kimironko': 'Kimironko',
  'kabuye': 'Kabuye',
  'rebero': 'Rebero',
};

function normalizeStopName(name) {
  if (!name) return '';

  let clean = name.trim().toLowerCase();

  // Remove common prefixes: "q ", "ku ", "k "
  clean = clean.replace(/^[qku]{1,2}\s+/i, '');

  // Remove "stop" / "bus stop" / "bus park" / "bus station" suffix for matching
  const forMatching = clean
    .replace(/\s+(bus\s+)?(stop|park|station|terminal|gare)$/i, '')
    .replace(/\s+stop$/i, '')
    .trim();

  // Check known locations
  if (KNOWN_LOCATIONS[forMatching]) {
    return KNOWN_LOCATIONS[forMatching];
  }
  if (KNOWN_LOCATIONS[clean]) {
    return KNOWN_LOCATIONS[clean];
  }

  // Title case the name
  const titleCased = clean
    .split(/[\s_-]+/)
    .map((word) => {
      if (/^(chuk|kbs|kie|bk|rdb|cbd|brd)$/i.test(word)) {
        return word.toUpperCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');

  return titleCased;
}

function isBadName(name) {
  if (!name) return true;
  const lower = name.toLowerCase().trim();
  if (lower === 'unknown' || lower === '') return true;
  if (/^\d+$/.test(lower)) return true;
  if (lower.length <= 2) return true;
  return false;
}

function nameQualityScore(name) {
  if (!name) return 0;
  const lower = name.toLowerCase().trim();
  if (lower === 'unknown' || lower === '') return 0;
  if (/^\d+$/.test(lower)) return 1;
  if (lower.length <= 2) return 1;
  if (lower.includes('stop') && lower.length < 8) return 2;
  if (KNOWN_LOCATIONS[lower]) return 10;
  if (lower.length > 4) return 5;
  return 3;
}

// ── Direction Suffix Inference ───────────────────────────────────────────────
// When multiple unnamed stops are near the same named stop, add directional
// suffixes like "North", "South", "East", "West" based on relative position.

function inferDirection(baseLat, baseLon, stopLat, stopLon) {
  const dLat = stopLat - baseLat;
  const dLon = stopLon - baseLon;

  // Use the axis with the larger difference
  if (Math.abs(dLat) > Math.abs(dLon)) {
    return dLat > 0 ? 'South' : 'North'; // In Southern hemisphere, higher lat = more south
  } else {
    return dLon > 0 ? 'East' : 'West';
  }
}

// ── Main Cleanup ─────────────────────────────────────────────────────────────

function cleanStops() {
  console.log('🔄 Reading stops.txt...');
  const content = fs.readFileSync(STOPS_FILE, 'utf-8');
  const { headers, rows } = parseCsv(content);

  console.log(`   Found ${rows.length} raw stops`);

  // Step 1: Parse and validate coordinates
  const stops = rows
    .map((r) => ({
      ...r,
      _lat: parseFloat(r.stop_lat),
      _lon: parseFloat(r.stop_lon),
      _name: r.stop_name || '',
    }))
    .filter((s) => {
      if (isNaN(s._lat) || isNaN(s._lon)) return false;
      if (s._lat === 0 && s._lon === 0) return false;
      if (s._lat < -2.9 || s._lat > -1.0) return false;
      if (s._lon < 28.8 || s._lon > 30.9) return false;
      return true;
    });

  console.log(`   ${stops.length} stops with valid coordinates`);

  // Step 2: Group by proximity (50m clusters)
  const clusters = [];
  const assigned = new Set();

  for (let i = 0; i < stops.length; i++) {
    if (assigned.has(i)) continue;

    const cluster = [stops[i]];
    assigned.add(i);

    for (let j = i + 1; j < stops.length; j++) {
      if (assigned.has(j)) continue;
      const dist = haversineMeters(
        stops[i]._lat, stops[i]._lon,
        stops[j]._lat, stops[j]._lon
      );
      if (dist < 50) {
        cluster.push(stops[j]);
        assigned.add(j);
      }
    }

    clusters.push(cluster);
  }

  console.log(`   ${clusters.length} unique stop locations (after 50m clustering)`);

  // Step 3: Pick primary stop from each cluster
  const primaryStops = [];
  const idRemap = {};

  for (const cluster of clusters) {
    // Sort by name quality (best first)
    cluster.sort((a, b) => nameQualityScore(b._name) - nameQualityScore(a._name));

    const primary = cluster[0];
    const normalizedName = normalizeStopName(primary._name);

    // Skip clusters where ALL members have bad names
    const allBad = cluster.every((s) => isBadName(normalizeStopName(s._name)));
    if (allBad) {
      // Keep it but we'll try to infer a name later
      const cleanStop = {
        stop_id: primary.stop_id,
        stop_name: `__UNNAMED__${primary.stop_id}`,
        stop_lat: primary._lat,
        stop_lon: primary._lon,
        _needsName: true,
      };
      primaryStops.push(cleanStop);
      for (const member of cluster) {
        idRemap[member.stop_id] = primary.stop_id;
      }
      continue;
    }

    const cleanStop = {
      stop_id: primary.stop_id,
      stop_name: normalizedName,
      stop_lat: primary._lat,
      stop_lon: primary._lon,
    };
    primaryStops.push(cleanStop);

    for (const member of cluster) {
      idRemap[member.stop_id] = primary.stop_id;
    }
  }

  console.log(`   ${primaryStops.length} stops after deduplication`);

  // Step 4: Infer names for unnamed stops from nearby named stops (multiple passes)
  let unnamedStops = primaryStops.filter((s) => s._needsName);
  const namedStops = primaryStops.filter((s) => !s._needsName);

  console.log(`   ${unnamedStops.length} stops need name inference`);

  // Multiple passes: each pass names some stops, making them available for the next pass
  const SEARCH_RADIUS = 500; // metres
  let pass = 0;
  let prevUnnamed = unnamedStops.length + 1;

  while (unnamedStops.length > 0 && unnamedStops.length < prevUnnamed && pass < 5) {
    prevUnnamed = unnamedStops.length;
    pass++;

    const stillUnnamed = [];

    for (const unnamed of unnamedStops) {
      let nearest = null;
      let nearestDist = Infinity;

      for (const named of namedStops) {
        const dist = haversineMeters(
          unnamed.stop_lat, unnamed.stop_lon,
          named.stop_lat, named.stop_lon
        );
        if (dist < nearestDist && dist < SEARCH_RADIUS) {
          nearest = named;
          nearestDist = dist;
        }
      }

      if (nearest) {
        // Strip any existing direction suffix from the base name
        const baseName = nearest.stop_name
          .replace(/\s+(North|South|East|West)$/i, '')
          .replace(/^Near\s+/i, '')
          .trim();

        // Check if there are other stops near the same base-named stop
        const siblings = primaryStops.filter(
          (s) =>
            s !== unnamed &&
            !s._needsName &&
            s.stop_name.replace(/\s+(North|South|East|West)$/i, '').replace(/^Near\s+/i, '').trim() === baseName &&
            haversineMeters(s.stop_lat, s.stop_lon, nearest.stop_lat, nearest.stop_lon) < SEARCH_RADIUS
        );

        if (siblings.length > 0) {
          const dir = inferDirection(
            nearest.stop_lat, nearest.stop_lon,
            unnamed.stop_lat, unnamed.stop_lon
          );
          unnamed.stop_name = `${baseName} ${dir}`;
        } else {
          unnamed.stop_name = `Near ${baseName}`;
        }

        delete unnamed._needsName;
        namedStops.push(unnamed); // Make available for next pass
      } else {
        stillUnnamed.push(unnamed);
      }
    }

    unnamedStops = stillUnnamed;
    console.log(`   Pass ${pass}: named ${prevUnnamed - unnamedStops.length} stops, ${unnamedStops.length} remaining`);
  }

  // Final fallback for truly isolated stops
  for (const unnamed of unnamedStops) {
    unnamed.stop_name = `Stop ${unnamed.stop_id.slice(-4)}`;
    delete unnamed._needsName;
  }

  // Step 5: Final formatting
  const finalStops = primaryStops.map((s) => ({
    stop_id: s.stop_id,
    stop_name: s.stop_name,
    stop_lat: String(Math.round(s.stop_lat * 1000000) / 1000000),
    stop_lon: String(Math.round(s.stop_lon * 1000000) / 1000000),
  }));

  // Sort by stop_id
  finalStops.sort((a, b) => a.stop_id.localeCompare(b.stop_id));

  return { primaryStops: finalStops, idRemap };
}

function updateStopTimes(idRemap) {
  console.log('\n🔄 Updating stop_times.txt...');

  if (!fs.existsSync(STOP_TIMES_FILE)) {
    console.log('   ⚠️  stop_times.txt not found, skipping');
    return null;
  }

  const content = fs.readFileSync(STOP_TIMES_FILE, 'utf-8');
  const { headers, rows } = parseCsv(content);

  let remappedCount = 0;
  let removedCount = 0;

  const updatedRows = rows
    .map((r) => {
      const newId = idRemap[r.stop_id];
      if (newId && newId !== r.stop_id) {
        remappedCount++;
        return { ...r, stop_id: newId };
      }
      if (!newId) {
        removedCount++;
        return null;
      }
      return r;
    })
    .filter(Boolean);

  // Remove duplicate stop_times (same trip + same stop after remapping)
  const dedupedRows = [];
  const seen = new Set();

  for (const r of updatedRows) {
    const key = `${r.trip_id}-${r.stop_id}-${r.stop_sequence}`;
    if (!seen.has(key)) {
      seen.add(key);
      dedupedRows.push(r);
    }
  }

  console.log(`   Remapped ${remappedCount} stop references`);
  console.log(`   Removed ${removedCount} references to deleted stops`);
  console.log(`   Removed ${updatedRows.length - dedupedRows.length} duplicate entries`);

  return { headers, rows: dedupedRows };
}

// ── Execute ──────────────────────────────────────────────────────────────────

function main() {
  console.log('🧹 GTFS Stops Cleanup Script v2');
  console.log('═══════════════════════════════════════\n');

  // Create backup
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(STOPS_FILE, path.join(BACKUP_DIR, `stops-${timestamp}.txt`));
  if (fs.existsSync(STOP_TIMES_FILE)) {
    fs.copyFileSync(STOP_TIMES_FILE, path.join(BACKUP_DIR, `stop_times-${timestamp}.txt`));
  }
  console.log(`📁 Backups saved to ${BACKUP_DIR}\n`);

  // Clean stops
  const { primaryStops, idRemap } = cleanStops();

  // Write cleaned stops
  const stopsCsv = toCsv(
    ['stop_id', 'stop_name', 'stop_lat', 'stop_lon'],
    primaryStops
  );
  fs.writeFileSync(STOPS_FILE, stopsCsv, 'utf-8');
  console.log(`\n✅ Wrote ${primaryStops.length} cleaned stops to stops.txt`);

  // Update stop_times
  const updatedStopTimes = updateStopTimes(idRemap);
  if (updatedStopTimes) {
    const stopTimesCsv = toCsv(updatedStopTimes.headers, updatedStopTimes.rows);
    fs.writeFileSync(STOP_TIMES_FILE, stopTimesCsv, 'utf-8');
    console.log(`✅ Updated stop_times.txt`);
  }

  // Summary
  console.log('\n═══════════════════════════════════════');
  console.log('📊 Cleanup Summary:');
  console.log(`   Final stops: ${primaryStops.length}`);

  // Show named stops
  const named = primaryStops.filter((s) => !s.stop_name.startsWith('Stop '));
  const inferred = primaryStops.filter(
    (s) => s.stop_name.startsWith('Near ') || s.stop_name.includes(' North') || s.stop_name.includes(' South') || s.stop_name.includes(' East') || s.stop_name.includes(' West')
  );
  const placeholder = primaryStops.filter(
    (s) => s.stop_name.startsWith('Stop ') && !s.stop_name.includes('Near')
  );

  console.log(`   Named stops: ${named.length}`);
  console.log(`   Inferred names: ${inferred.length}`);
  console.log(`   Placeholder names: ${placeholder.length}`);

  console.log('\n📋 Sample cleaned stops:');
  const samples = primaryStops.filter((s) => !s.stop_name.startsWith('Stop ')).slice(0, 20);
  for (const s of samples) {
    console.log(`   ${s.stop_id}: ${s.stop_name} (${s.stop_lat}, ${s.stop_lon})`);
  }

  if (placeholder.length > 0) {
    console.log(`\n⚠️  ${placeholder.length} stops still have placeholder names:`);
    for (const s of placeholder.slice(0, 10)) {
      console.log(`   ${s.stop_id}: ${s.stop_name} (${s.stop_lat}, ${s.stop_lon})`);
    }
    if (placeholder.length > 10) {
      console.log(`   ... and ${placeholder.length - 10} more`);
    }
  }
}

main();
