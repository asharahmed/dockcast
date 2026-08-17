-- DockCast schema v1. Applied by @dockcast/db migrator (idempotent per file; tracked in schema_migrations).
-- Requires: Postgres 16 with timescaledb + postgis available (image timescale/timescaledb-ha:pg16).
-- All timestamps are timestamptz (UTC). Local-time logic lives in application code using cities.tz.

CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------------------
-- Reference / static
-- ---------------------------------------------------------------------------
CREATE TABLE cities (
  id                    serial PRIMARY KEY,
  slug                  text NOT NULL UNIQUE,                 -- 'toronto'
  name                  text NOT NULL,                        -- 'Bike Share Toronto'
  gbfs_url              text NOT NULL,                        -- auto-discovery gbfs.json URL
  tz                    text NOT NULL,                        -- IANA, e.g. 'America/Toronto'
  lat                   double precision NOT NULL,            -- centroid for weather
  lon                   double precision NOT NULL,
  country_code          char(2) NOT NULL,
  holiday_country       text NOT NULL,                        -- python-holidays country code, e.g. 'CA'
  holiday_subdiv        text,                                 -- e.g. 'ON'
  is_active             boolean NOT NULL DEFAULT true,        -- collector polls it
  forecasting_enabled   boolean NOT NULL DEFAULT false,       -- predictor/trainer run for it (needs rates)
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stations (
  id                    serial PRIMARY KEY,                   -- internal key used everywhere (URLs, hot tables)
  city_id               integer NOT NULL REFERENCES cities(id),
  station_id            text NOT NULL,                        -- GBFS station_id (string)
  name                  text NOT NULL,
  lat                   double precision NOT NULL,
  lon                   double precision NOT NULL,
  geom                  geography(Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography) STORED,
  capacity              integer,                              -- static GBFS capacity (may be null)
  is_active             boolean NOT NULL DEFAULT true,        -- present in latest station_information
  first_seen_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (city_id, station_id)
);
CREATE INDEX stations_city_active_idx ON stations (city_id) WHERE is_active;
CREATE INDEX stations_geom_idx ON stations USING gist (geom);

-- k-nearest neighbours (k=3) by geodesic distance, active stations only; rebuilt by worker `profile`/`bootstrap`.
CREATE TABLE station_neighbors (
  station_pk            integer NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  neighbor_pk           integer NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  rank                  smallint NOT NULL CHECK (rank BETWEEN 1 AND 3),
  distance_m            real NOT NULL,
  PRIMARY KEY (station_pk, rank)
);

-- ---------------------------------------------------------------------------
-- Collection
-- ---------------------------------------------------------------------------
-- Full current state of every station, overwritten every successful poll (even if unchanged).
CREATE TABLE station_current (
  station_pk            integer PRIMARY KEY REFERENCES stations(id) ON DELETE CASCADE,
  ts                    timestamptz NOT NULL,                 -- poll instant
  bikes                 smallint NOT NULL,
  docks                 smallint NOT NULL,
  ebikes                smallint,                             -- null if feed lacks vehicle types
  bikes_disabled        smallint,
  docks_disabled        smallint,
  is_installed          boolean NOT NULL,
  is_renting            boolean NOT NULL,
  is_returning          boolean NOT NULL,
  last_reported         timestamptz NOT NULL
);

-- Change-only history (a row is written only when any non-ts column differs from the previous row for that station).
CREATE TABLE station_snapshots (
  station_pk            integer NOT NULL,
  ts                    timestamptz NOT NULL,
  bikes                 smallint NOT NULL,
  docks                 smallint NOT NULL,
  ebikes                smallint,
  bikes_disabled        smallint,
  docks_disabled        smallint,
  is_installed          boolean NOT NULL,
  is_renting            boolean NOT NULL,
  is_returning          boolean NOT NULL,
  last_reported         timestamptz NOT NULL
);
SELECT create_hypertable('station_snapshots', 'ts', chunk_time_interval => INTERVAL '1 day');
CREATE UNIQUE INDEX station_snapshots_pk_ts_idx ON station_snapshots (station_pk, ts DESC);
ALTER TABLE station_snapshots SET (timescaledb.compress, timescaledb.compress_segmentby = 'station_pk', timescaledb.compress_orderby = 'ts DESC');
SELECT add_compression_policy('station_snapshots', INTERVAL '7 days');
SELECT add_retention_policy('station_snapshots', INTERVAL '120 days');

-- One row per poll attempt per feed. feed ∈ ('station_status','station_information','weather').
CREATE TABLE poll_log (
  city_id               integer NOT NULL,
  polled_at             timestamptz NOT NULL,
  feed                  text NOT NULL,
  ok                    boolean NOT NULL,
  n_items               integer,
  latency_ms            integer,
  error                 text
);
SELECT create_hypertable('poll_log', 'polled_at', chunk_time_interval => INTERVAL '7 days');
CREATE INDEX poll_log_city_feed_idx ON poll_log (city_id, feed, polled_at DESC);
SELECT add_retention_policy('poll_log', INTERVAL '120 days');

-- Latest attempt/success per city+feed (cheap freshness lookups). Upserted by collector every attempt.
CREATE TABLE feed_state (
  city_id               integer NOT NULL REFERENCES cities(id),
  feed                  text NOT NULL,
  last_attempt_at       timestamptz,
  last_ok_at            timestamptz,
  last_error            text,
  PRIMARY KEY (city_id, feed)
);

-- Weather forecasts as fetched (train == serve). One fetch = up to 72 hourly rows.
CREATE TABLE weather_forecasts (
  city_id               integer NOT NULL REFERENCES cities(id),
  fetched_at            timestamptz NOT NULL,
  valid_hour            timestamptz NOT NULL,                 -- start of the hour (UTC)
  temp_c                real,
  precip_mm             real,
  precip_prob           smallint,
  wind_kmh              real,
  weather_code          smallint,
  PRIMARY KEY (city_id, fetched_at, valid_hour)
);
CREATE INDEX weather_forecasts_lookup_idx ON weather_forecasts (city_id, valid_hour, fetched_at DESC);

-- Historical actual weather (Open-Meteo archive) for the trip-history window; used only to fit weather multipliers.
CREATE TABLE weather_history (
  city_id               integer NOT NULL REFERENCES cities(id),
  hour                  timestamptz NOT NULL,
  temp_c                real,
  precip_mm             real,
  wind_kmh              real,
  PRIMARY KEY (city_id, hour)
);

-- ---------------------------------------------------------------------------
-- Trip-history aggregates (bootstrap). Keyed by GBFS string ids (CSV ids may not all exist in `stations`).
-- day_type: 0=WD, 1=SAT, 2=SUN(+holiday). bucket: 0..95 (15-min of local day).
-- ---------------------------------------------------------------------------
CREATE TABLE trip_bucket_counts (
  city_id               integer NOT NULL REFERENCES cities(id),
  station_id            text NOT NULL,
  day_type              smallint NOT NULL CHECK (day_type BETWEEN 0 AND 2),
  bucket                smallint NOT NULL CHECK (bucket BETWEEN 0 AND 95),
  n_start               integer NOT NULL DEFAULT 0,
  n_end                 integer NOT NULL DEFAULT 0,
  PRIMARY KEY (city_id, station_id, day_type, bucket)
);
CREATE TABLE trip_station_span (
  city_id               integer NOT NULL REFERENCES cities(id),
  station_id            text NOT NULL,
  first_seen            date NOT NULL,
  last_seen             date NOT NULL,
  PRIMARY KEY (city_id, station_id)
);
CREATE TABLE system_hourly_trips (
  city_id               integer NOT NULL REFERENCES cities(id),
  hour                  timestamptz NOT NULL,                 -- UTC hour start
  n_start               integer NOT NULL,
  PRIMARY KEY (city_id, hour)
);
CREATE TABLE bootstrap_runs (
  id                    serial PRIMARY KEY,
  city_id               integer NOT NULL REFERENCES cities(id),
  window_start          date NOT NULL,
  window_end            date NOT NULL,
  n_trips               bigint NOT NULL,
  n_dropped             bigint NOT NULL,
  ran_at                timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Model parameters (bd tier) and derived profiles
-- ---------------------------------------------------------------------------
CREATE TABLE station_flow_rates (
  station_pk            integer NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  day_type              smallint NOT NULL CHECK (day_type BETWEEN 0 AND 2),
  bucket                smallint NOT NULL CHECK (bucket BETWEEN 0 AND 95),
  lam_in_per_min        real NOT NULL,
  lam_out_per_min       real NOT NULL,
  source                text NOT NULL CHECK (source IN ('trips','fallback')),
  fitted_at             timestamptz NOT NULL,
  PRIMARY KEY (station_pk, day_type, bucket)
);
CREATE TABLE weather_multipliers (
  city_id               integer NOT NULL REFERENCES cities(id),
  temp_bin              smallint NOT NULL CHECK (temp_bin BETWEEN 0 AND 4),
  precip_bin            smallint NOT NULL CHECK (precip_bin BETWEEN 0 AND 3),
  m                     real NOT NULL,
  fitted_at             timestamptz NOT NULL,
  PRIMARY KEY (city_id, temp_bin, precip_bin)
);
-- Recent climatology from snapshots (last 28 days), rebuilt nightly; used as GBM features and UI "typical" fallback.
CREATE TABLE station_tod_profile (
  station_pk            integer NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  day_type              smallint NOT NULL,
  bucket                smallint NOT NULL,
  mean_fill             real,
  p_bike                real,
  p_dock                real,
  n                     integer NOT NULL,
  built_for             date NOT NULL,                        -- local date the profile is valid for (built the night before)
  PRIMARY KEY (station_pk, day_type, bucket)
);

-- ---------------------------------------------------------------------------
-- Models & evaluation
-- ---------------------------------------------------------------------------
CREATE TABLE model_versions (
  id                    serial PRIMARY KEY,
  city_id               integer NOT NULL REFERENCES cities(id),
  tier                  text NOT NULL CHECK (tier IN ('bd','gbm')),
  status                text NOT NULL CHECK (status IN ('active','shadow','rejected','superseded','insufficient_data','failed')),
  feature_schema_version integer NOT NULL,
  trained_for_date      date NOT NULL,                        -- local date T
  train_window          tstzrange,
  git_sha               text,
  hyperparams           jsonb,
  metrics_val           jsonb,                                -- summary; full detail in model_eval
  gate                  jsonb,                                -- {passed:bool, checks:[{name, value, threshold, ok}]}
  artifact              bytea,                                -- pickled bundle (see ml-spec §3.5); null for insufficient_data/failed
  created_at            timestamptz NOT NULL DEFAULT now(),
  activated_at          timestamptz,
  deactivated_at        timestamptz,
  UNIQUE (city_id, tier, trained_for_date)
);
CREATE INDEX model_versions_active_idx ON model_versions (city_id, tier) WHERE status = 'active';

CREATE TABLE model_eval (
  model_version_id      integer NOT NULL REFERENCES model_versions(id) ON DELETE CASCADE,
  split                 text NOT NULL,                        -- 'val' | 'es'
  target                text NOT NULL,                        -- 'bike' | 'dock' | 'cnt'
  horizon               smallint NOT NULL,                    -- 0 = pooled over horizons
  slice                 text NOT NULL,                        -- 'all' | 'at_risk'
  metric                text NOT NULL,                        -- 'brier','logloss','auc','ece','mae','rmse','n', 'rel_bin_<b>_mean_pred', 'rel_bin_<b>_frac_pos', 'rel_bin_<b>_n'
  value                 double precision,
  PRIMARY KEY (model_version_id, split, target, horizon, slice, metric)
);

-- Serving table: one row per station × horizon, overwritten every predictor cycle.
CREATE TABLE forecasts_latest (
  station_pk            integer NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  horizon               smallint NOT NULL,
  t0                    timestamptz NOT NULL,
  valid_at              timestamptz NOT NULL,
  p_bike                real,                                 -- null => no forecast; see reason
  p_dock                real,
  exp_bikes             real,
  q10                   smallint,                             -- from bd distribution
  q90                   smallint,
  tier                  text NOT NULL,                        -- 'gbm' | 'bd_cal' | 'bd_raw' | 'none'
  model_version_id      integer,
  reason                text,                                 -- 'not_fresh' | 'zero_capacity' | 'no_rates' | null
  PRIMARY KEY (station_pk, horizon)
);

-- Forecast history for online evaluation; only 15-min-grid origins; all tiers.
CREATE TABLE forecast_history (
  station_pk            integer NOT NULL,
  t0                    timestamptz NOT NULL,
  horizon               smallint NOT NULL,
  tier                  text NOT NULL,                        -- 'bd_raw' | 'bd_cal' | 'gbm_active' | 'gbm_shadow'
  p_bike                real NOT NULL,
  p_dock                real NOT NULL,
  exp_bikes             real NOT NULL,
  model_version_id      integer,
  bd_a                  real,                                 -- bd_raw rows only: expected arrivals over horizon
  bd_d                  real,                                 -- bd_raw rows only: expected departures over horizon
  lam_in                real,                                 -- bd_raw rows only: per-minute rate at t0 (weather-adjusted)
  lam_out               real
);
SELECT create_hypertable('forecast_history', 't0', chunk_time_interval => INTERVAL '1 day');
CREATE UNIQUE INDEX forecast_history_uq ON forecast_history (station_pk, t0, horizon, tier);
ALTER TABLE forecast_history SET (timescaledb.compress, timescaledb.compress_segmentby = 'station_pk', timescaledb.compress_orderby = 't0 DESC');
SELECT add_compression_policy('forecast_history', INTERVAL '7 days');
SELECT add_retention_policy('forecast_history', INTERVAL '180 days');

-- Realised labels for forecast_history rows (materialised nightly once t0+h has passed).
CREATE TABLE forecast_labels (
  station_pk            integer NOT NULL,
  t0                    timestamptz NOT NULL,
  horizon               smallint NOT NULL,
  bikes0                smallint NOT NULL,
  docks0                smallint NOT NULL,
  y_bike                boolean NOT NULL,
  y_dock                boolean NOT NULL,
  y_cnt                 smallint NOT NULL
);
SELECT create_hypertable('forecast_labels', 't0', chunk_time_interval => INTERVAL '1 day');
CREATE UNIQUE INDEX forecast_labels_uq ON forecast_labels (station_pk, t0, horizon);
SELECT add_retention_policy('forecast_labels', INTERVAL '180 days');

-- Rolling online metrics powering /model. horizon 0 = pooled. tier includes 'persistence'.
CREATE TABLE model_metrics_daily (
  city_id               integer NOT NULL REFERENCES cities(id),
  day                   date NOT NULL,                        -- local date the window ends on (inclusive)
  window_days           smallint NOT NULL CHECK (window_days IN (1,7)),
  tier                  text NOT NULL,                        -- 'persistence' | 'bd_raw' | 'bd_cal' | 'gbm_active' | 'gbm_shadow'
  target                text NOT NULL,
  horizon               smallint NOT NULL,
  slice                 text NOT NULL,
  metric                text NOT NULL,
  value                 double precision,
  n                     integer NOT NULL,
  PRIMARY KEY (city_id, day, window_days, tier, target, horizon, slice, metric)
);

-- Predictor/trainer heartbeat for /health and /model.
CREATE TABLE worker_runs (
  id                    bigserial PRIMARY KEY,
  city_id               integer REFERENCES cities(id),
  kind                  text NOT NULL,                        -- 'predict' | 'train' | 'bootstrap' | 'profile'
  started_at            timestamptz NOT NULL,
  finished_at           timestamptz,
  ok                    boolean,
  summary               jsonb,
  error                 text
);
CREATE INDEX worker_runs_kind_idx ON worker_runs (kind, started_at DESC);

-- ---------------------------------------------------------------------------
-- Users, sessions, commutes, push
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 text NOT NULL,
  password_hash         text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  last_login_at         timestamptz
);
CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));

-- connect-pg-simple default schema
CREATE TABLE "session" (
  "sid"                 varchar NOT NULL COLLATE "default" PRIMARY KEY,
  "sess"                json NOT NULL,
  "expire"              timestamp(6) NOT NULL
);
CREATE INDEX "IDX_session_expire" ON "session" ("expire");

CREATE TABLE commutes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  city_id               integer NOT NULL REFERENCES cities(id),
  name                  text NOT NULL,
  origin_station_pk     integer NOT NULL REFERENCES stations(id),
  dest_station_pk       integer NOT NULL REFERENCES stations(id),
  depart_local_time     time NOT NULL,                        -- in cities.tz
  ride_minutes          smallint NOT NULL CHECK (ride_minutes BETWEEN 1 AND 180),
  days_of_week          smallint[] NOT NULL,                  -- 0=Mon..6=Sun, non-empty, unique values
  alert_enabled         boolean NOT NULL DEFAULT true,
  alert_lead_minutes    smallint NOT NULL DEFAULT 20 CHECK (alert_lead_minutes BETWEEN 5 AND 120),
  threshold             real NOT NULL DEFAULT 0.7 CHECK (threshold > 0 AND threshold < 1),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (origin_station_pk <> dest_station_pk),
  CHECK (cardinality(days_of_week) BETWEEN 1 AND 7)
);
CREATE INDEX commutes_user_idx ON commutes (user_id);
CREATE INDEX commutes_alert_idx ON commutes (city_id, depart_local_time) WHERE alert_enabled;

CREATE TABLE push_subscriptions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint              text NOT NULL UNIQUE,
  p256dh                text NOT NULL,
  auth                  text NOT NULL,
  user_agent            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  last_used_at          timestamptz,
  failed_count          smallint NOT NULL DEFAULT 0
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);

CREATE TABLE alert_events (
  id                    bigserial PRIMARY KEY,
  commute_id            uuid NOT NULL REFERENCES commutes(id) ON DELETE CASCADE,
  local_date            date NOT NULL,                        -- dedupe key: one alert per commute per local day
  sent_at               timestamptz NOT NULL DEFAULT now(),
  kind                  text NOT NULL,                        -- 'origin_low' | 'dest_low' | 'both_low'
  payload               jsonb NOT NULL,                       -- what was sent (probabilities, alternatives)
  delivered             integer NOT NULL DEFAULT 0,           -- number of subscriptions successfully pushed
  UNIQUE (commute_id, local_date)
);

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------
-- Single definition of "fresh" (ml-spec §1.2) for *current* state; used by api and predictor.
CREATE VIEW station_state_fresh AS
SELECT
  s.id            AS station_pk,
  s.city_id,
  sc.ts,
  sc.bikes, sc.docks, sc.ebikes, sc.bikes_disabled, sc.docks_disabled,
  sc.is_installed, sc.is_renting, sc.is_returning, sc.last_reported,
  (sc.bikes + sc.docks)::integer AS cap_eff,
  (
    s.is_active
    AND sc.is_installed AND sc.is_renting AND sc.is_returning
    AND sc.last_reported >= now() - INTERVAL '10 minutes'
    AND fs.last_ok_at   >= now() - INTERVAL '90 seconds'
  ) AS is_fresh
FROM stations s
JOIN station_current sc ON sc.station_pk = s.id
LEFT JOIN feed_state fs ON fs.city_id = s.city_id AND fs.feed = 'station_status';

-- ---------------------------------------------------------------------------
-- Seed
-- ---------------------------------------------------------------------------
INSERT INTO cities (slug, name, gbfs_url, tz, lat, lon, country_code, holiday_country, holiday_subdiv, is_active, forecasting_enabled)
VALUES ('toronto', 'Bike Share Toronto', 'https://toronto.publicbikesystem.net/customer/gbfs/v3.0/gbfs.json',
        'America/Toronto', 43.6532, -79.3832, 'CA', 'CA', 'ON', true, true);
