-- Indexes for the two GTFS query patterns that were missing one:
--
-- 1. /api/stops/{id}/arrivals filters stop_times by stop_id (see
--    app/api/stops/[id]/arrivals/route.ts), but stop_times' only index is
--    its composite primary key (trip_id, stop_sequence) — stop_id lookups
--    were a full sequential scan over what the schema itself calls a
--    potentially very large table.
--
-- 2. /api/search/suggest does an ILIKE '%query%' scan over stops.stop_name
--    (lib/api/spatial.service.ts searchStops) — pg_trgm + a GIN index lets
--    Postgres use an index for that pattern instead of scanning every row.

CREATE INDEX IF NOT EXISTS stop_times_stop_id_idx ON stop_times (stop_id);

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS stops_stop_name_trgm_idx ON stops USING GIN (stop_name gin_trgm_ops);
