-- Multi-city plug-and-play (docs/worker-spec.md §4.1, docs/add-a-city.md).
--
-- 1. cities.trip_source: which trip-history adapter the bootstrap uses and its
--    config, e.g. {"adapter":"toronto_ckan"} or
--    {"adapter":"generic_csv","urls":[...],"columns":{...},"timestamp_format":"..."}.
-- 2. holiday_calendar: materialized python-holidays dates per (country, subdiv),
--    written by the ML worker (bootstrap / nightly train / add-city) and read by
--    the API for day-typing — replaces the API's hard-coded Ontario table.

ALTER TABLE cities ADD COLUMN trip_source jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE cities SET trip_source = '{"adapter": "toronto_ckan"}'::jsonb WHERE slug = 'toronto';

CREATE TABLE holiday_calendar (
  holiday_country text NOT NULL,           -- python-holidays country code, e.g. 'CA'
  holiday_subdiv  text NOT NULL DEFAULT '',-- subdivision, '' = none
  day             date NOT NULL,
  PRIMARY KEY (holiday_country, holiday_subdiv, day)
);

-- Seed CA/ON so existing deployments keep working before the first worker
-- refresh. Matches holidays.country_holidays('CA', subdiv='ON') for 2026-2027
-- (the set the API previously hard-coded).
INSERT INTO holiday_calendar (holiday_country, holiday_subdiv, day) VALUES
  ('CA', 'ON', '2026-01-01'),
  ('CA', 'ON', '2026-02-16'),
  ('CA', 'ON', '2026-04-03'),
  ('CA', 'ON', '2026-05-18'),
  ('CA', 'ON', '2026-07-01'),
  ('CA', 'ON', '2026-09-07'),
  ('CA', 'ON', '2026-10-12'),
  ('CA', 'ON', '2026-12-25'),
  ('CA', 'ON', '2026-12-26'),
  ('CA', 'ON', '2026-12-28'),
  ('CA', 'ON', '2027-01-01'),
  ('CA', 'ON', '2027-02-15'),
  ('CA', 'ON', '2027-03-26'),
  ('CA', 'ON', '2027-05-24'),
  ('CA', 'ON', '2027-07-01'),
  ('CA', 'ON', '2027-09-06'),
  ('CA', 'ON', '2027-10-11'),
  ('CA', 'ON', '2027-12-25'),
  ('CA', 'ON', '2027-12-26'),
  ('CA', 'ON', '2027-12-27'),
  ('CA', 'ON', '2027-12-28');
