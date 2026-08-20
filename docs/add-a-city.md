# Adding a city

DockCast is city-generic: everything keys off the `cities` table, and the only
per-city artefact that may need code is the trip-history adapter. A city with
a GBFS feed gets a live map with one command; forecasts need one bootstrap run
on top of that.

## 1. Register the city

```sh
uv run python -m dockcast_ml add-city \
  --slug montreal \
  --gbfs-url https://gbfs.velobixi.com/gbfs/gbfs.json \
  --country-code CA --holiday-country CA --holiday-subdiv QC \
  --trip-adapter generic_csv \
  --trip-config '{"urls":["https://.../trips-2025.zip"],"columns":{"start_id":"...","end_id":"...","start_time":"...","end_time":"..."}}'
```

Name, timezone, and the map centroid are read from the feed itself
(`system_information`, `station_information`); override with `--name`/`--tz`
if the feed's values are wrong. `--holiday-country`/`--holiday-subdiv` are
python-holidays codes — they drive day-typing (WD/SAT/SUN+holiday) on both the
worker and the API, via the `holiday_calendar` table this command also fills.

The city is inserted with `forecasting_enabled=false`: the collector picks it
up on its next cycle and the map serves **live availability only** (banner:
"Live data only. No forecasts for <city> yet."). This state is fine to ship —
forecasting can come later. The web app shows a city picker automatically once
a second city exists.

## 2. Let the collector observe it

Stations must exist before a bootstrap (`stations` rows come from the
collector). One poll cycle (~1 min) is enough.

## 3. Configure the trip source

The bootstrap needs ~a year of trip history to estimate flow rates. Which
source it reads comes from `cities.trip_source` (jsonb), set via
`--trip-adapter`/`--trip-config` above or by updating the row later.

Adapters (`ml/dockcast_ml/bootstrap/trip_sources/`):

- **`generic_csv`** — no code needed. Point it at CSV/zip URLs (downloaded to
  the cache dir) and/or `files` globs (already in the cache dir), map the four
  column names, and declare timestamp semantics. Full config reference in the
  module docstring. The contract: station ids must match GBFS
  `stations.station_id` after normalization; timestamps declared `"utc"` are
  converted to the city's local clock.
- **`toronto_ckan`** — Toronto's CKAN portal discovery (the original
  hard-wired path, now just one adapter).
- A city with a bespoke publishing scheme gets its own module registered in
  `trip_sources/__init__.py` — implement `fetch_chunks(...)` yielding the
  normalized chunks described there.

No trip data published at all? The city stays live-only. (The queue-model
baseline can't exist without trips, and the learned-model gate currently
requires beating it — deriving rates from our own snapshots is a known open
design question, docs/ml-spec.md.)

## 4. Bootstrap

```sh
uv run python -m dockcast_ml bootstrap --city montreal --from 2025-04 --to 2026-03
```

Runs trips → weather history → rates → weather GLM → neighbors, then flips
`forecasting_enabled=true` itself. The predictor picks the city up on its next
5-minute cycle; the nightly trainer includes it automatically. Sanity-check
`/model?city=montreal` and a few stations against reality before telling
anyone.

## Per-city checklist

- [ ] `add-city` run; city visible in `GET /cities`
- [ ] collector polling (map shows live dots)
- [ ] `trip_source` configured; bootstrap succeeded (`worker_runs` summary: rates + GLM sane)
- [ ] map shows forecast colours; station pages show typical-day panels
- [ ] About-page data credits updated (`apps/web/src/routes/AboutPage.tsx` — manual)
