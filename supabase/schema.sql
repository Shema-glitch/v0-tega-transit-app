-- Drop existing tables if they exist to allow clean recreations
DROP TABLE IF EXISTS stop_times;
DROP TABLE IF EXISTS trips;
DROP TABLE IF EXISTS routes;
DROP TABLE IF EXISTS stops;
DROP TABLE IF EXISTS shapes;
DROP TABLE IF EXISTS agency;

-- Agency table
CREATE TABLE agency (
  agency_id TEXT PRIMARY KEY,
  agency_name TEXT,
  agency_url TEXT,
  agency_timezone TEXT,
  agency_lang TEXT,
  agency_phone TEXT,
  agency_fare_url TEXT,
  agency_email TEXT
);

-- Stops table
CREATE TABLE stops (
  stop_id TEXT PRIMARY KEY,
  stop_code TEXT,
  stop_name TEXT,
  stop_desc TEXT,
  stop_lat DOUBLE PRECISION,
  stop_lon DOUBLE PRECISION,
  zone_id TEXT,
  stop_url TEXT,
  location_type INTEGER,
  parent_station TEXT,
  stop_timezone TEXT,
  wheelchair_boarding INTEGER
);

-- Routes table
CREATE TABLE routes (
  route_id TEXT PRIMARY KEY,
  agency_id TEXT,
  route_short_name TEXT,
  route_long_name TEXT,
  route_desc TEXT,
  route_type INTEGER,
  route_url TEXT,
  route_color TEXT,
  route_text_color TEXT,
  route_sort_order INTEGER,
  continuous_pickup INTEGER,
  continuous_drop_off INTEGER
);

-- Shapes table (can be very large, composite primary key)
CREATE TABLE shapes (
  shape_id TEXT,
  shape_pt_lat DOUBLE PRECISION,
  shape_pt_lon DOUBLE PRECISION,
  shape_pt_sequence INTEGER,
  shape_dist_traveled DOUBLE PRECISION,
  PRIMARY KEY (shape_id, shape_pt_sequence)
);

-- Trips table
CREATE TABLE trips (
  trip_id TEXT PRIMARY KEY,
  route_id TEXT,
  service_id TEXT,
  trip_headsign TEXT,
  trip_short_name TEXT,
  direction_id INTEGER,
  block_id TEXT,
  shape_id TEXT,
  wheelchair_accessible INTEGER,
  bikes_allowed INTEGER
);

-- Stop Times table (can be very large, composite primary key)
CREATE TABLE stop_times (
  trip_id TEXT,
  arrival_time TEXT,
  departure_time TEXT,
  stop_id TEXT,
  stop_sequence INTEGER,
  stop_headsign TEXT,
  pickup_type INTEGER,
  drop_off_type INTEGER,
  shape_dist_traveled DOUBLE PRECISION,
  timepoint INTEGER,
  PRIMARY KEY (trip_id, stop_sequence)
);

-- Add foreign key constraints (optional, disabled by default for faster bulk inserts)
-- ALTER TABLE routes ADD CONSTRAINT fk_agency FOREIGN KEY (agency_id) REFERENCES agency(agency_id);
-- ALTER TABLE trips ADD CONSTRAINT fk_routes FOREIGN KEY (route_id) REFERENCES routes(route_id);
-- ALTER TABLE stop_times ADD CONSTRAINT fk_trips FOREIGN KEY (trip_id) REFERENCES trips(trip_id);
-- ALTER TABLE stop_times ADD CONSTRAINT fk_stops FOREIGN KEY (stop_id) REFERENCES stops(stop_id);

-- Disable Row Level Security temporarily for data loading (or keep it disabled if you only query)
ALTER TABLE agency DISABLE ROW LEVEL SECURITY;
ALTER TABLE stops DISABLE ROW LEVEL SECURITY;
ALTER TABLE routes DISABLE ROW LEVEL SECURITY;
ALTER TABLE trips DISABLE ROW LEVEL SECURITY;
ALTER TABLE stop_times DISABLE ROW LEVEL SECURITY;
ALTER TABLE shapes DISABLE ROW LEVEL SECURITY;
