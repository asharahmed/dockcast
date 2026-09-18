# DockCast — Python Worker (`dockcast_ml`) Implementation Specification (v1)

Status: PLANNING DRAFT for approval. Normative inputs: `docs/ml-spec.md` (math — never
change it), `db/migrations/0001_init.sql` (schema — never change it), `docs/api.md` §0
(constants that must match), `docs/architecture.md`. This document turns those into
code-level instructions. Where this doc gives an *operational* order or a concrete
choice the ml-spec left open, it says so explicitly with **[decision]**.

Directory: `/ml`. Package: `dockcast_ml`. Runtime: two containers from the same image —
`worker-predict` (`python -m dockcast_ml predict --loop`) and `worker-train` (cron →
`python -m dockcast_ml train`).

---------------------------------------------------------------------------

## 1. Project setup

### 1.1 `ml/pyproject.toml`
```toml
[project]
name = "dockcast-ml"
version = "0.1.0"
requires-python = ">=3.12,<3.13"
dependencies = [
  "pandas>=2.2,<3", "numpy>=2.0,<3", "scipy>=1.14,<2", "lightgbm>=4.5,<5",
  "scikit-learn>=1.5,<2", "statsmodels>=0.14,<0.15", "psycopg[binary]>=3.2,<4",
  "holidays>=0.50", "httpx>=0.27,<1",
]
[project.optional-dependencies]
dev = ["pytest>=8", "pytest-cov>=5", "ruff>=0.5", "hypothesis>=6"]
[tool.ruff]
line-length = 100
target-version = "py312"
[tool.ruff.lint]
select = ["E","F","I","B","UP","NPY","PD"]
ignore = ["PD901","E501"]
[tool.pytest.ini_options]
testpaths = ["tests"]
markers = ["db: needs DATABASE_URL_TEST", "slow: > 30 s"]
addopts = "-m 'not slow'"
```
Commands: `uv sync --extra dev`, `uv run pytest`, `uv run pytest -m slow`, `uv run ruff check .`,
`uv run python -m dockcast_ml --help`. `uv.lock` is committed. Dockerfile: `python:3.12-slim`,
`libgomp1` installed (LightGBM needs it), `uv sync --frozen --no-dev`, entrypoint
`python -m dockcast_ml`.

### 1.2 Environment (`config.py`)
| var | required | default | use |
|---|---|---|---|
| `DATABASE_URL` | yes | – | psycopg conninfo |
| `LOG_LEVEL` | no | `INFO` | |
| `PREDICT_INTERVAL_SEC` | no | `300` | must divide 3600 |
| `TRIPS_CACHE_DIR` | no | `/data/trips` | zip cache for bootstrap |
| `HEALTHCHECKS_TRAINER_URL` | no | – | pinged (GET) after a successful `train` |
| `GIT_SHA` | no | `unknown` | stored in `model_versions.git_sha` |
| `DATABASE_URL_TEST` | tests only | – | integration tests |

`Config` is a frozen dataclass built by `config.load()`; missing required → `SystemExit(2)` with message.

### 1.3 CLI (`__main__.py`, argparse, sub-commands)
```
bootstrap  --city SLUG [--from YYYY-MM] [--to YYYY-MM] [--cache-dir DIR] [--skip-download]
           # default window 2025-04 .. 2026-03. Runs: trips → weather_history → rates → weather_glm → neighbors
predict    [--city SLUG] (--loop | --once [--t0 ISO8601])      # default --loop; --once for tests/ops
train      [--city SLUG] [--date YYYY-MM-DD]                    # T defaults to today's local date in city tz
profile    [--city SLUG] [--date YYYY-MM-DD]                    # station_tod_profile for date (default: today local)
labels     [--city SLUG]                                        # materialise forecast_labels
metrics    [--city SLUG] [--date YYYY-MM-DD]                    # model_metrics_daily for date (default: today local)
neighbors  [--city SLUG]
add-city   --slug SLUG --gbfs-url URL --country-code CC --holiday-country CC
           [--holiday-subdiv SUBDIV] [--name NAME] [--tz TZ]
           [--trip-adapter NAME] [--trip-config JSON]
           # registers a city from its GBFS feed (docs/add-a-city.md): name/tz/centroid
           # read from system_information + station_information; inserts with
           # forecasting_enabled=false; refreshes holiday_calendar for the region
```
No `--city` ⇒ all cities with `forecasting_enabled` (predict/train/profile/labels/metrics/neighbors) —
`bootstrap` requires `--city`. Exit code 0 on success, 1 on failure (exception logged as one JSON line).
`bootstrap` flips `forecasting_enabled=true` on success; `train` refreshes `holiday_calendar` nightly.

---------------------------------------------------------------------------

## 2. Package layout

```
ml/dockcast_ml/
  __init__.py  __main__.py  config.py  logging_setup.py  db.py  timeutil.py  horizons.py
  gbfs_ids.py  grid.py  weather_asof.py  segments.py  bd.py  rates.py  weather_glm.py
  neighbors.py  profile.py  features.py  labels.py  metrics_online.py  evaluate.py  gate.py
  predict.py  train.py
  bootstrap/__init__.py  bootstrap/trips.py  bootstrap/weather_history.py  bootstrap/run.py
  models/__init__.py  models/gbm.py  models/calibration.py  models/artifact.py
ml/tests/  (see §9)   ml/tests/fixtures/  ml/Dockerfile
```

### 2.1 `horizons.py`
```python
HORIZONS: tuple[int, ...] = (15, 30, 45, 60, 90, 120)   # MUST equal packages/shared/src/time.ts HORIZONS
MAX_HORIZON = 120
```
Test asserts equality with the TS constant by reading `packages/shared/src/time.ts` with a regex.

### 2.2 `timeutil.py`
```python
def tz_of(city_tz: str) -> ZoneInfo
def to_local(ts_utc: datetime, tz: ZoneInfo) -> datetime
def local_date(ts_utc, tz) -> date
def local_midnight(d: date, tz) -> datetime          # aware UTC instant of local 00:00 on d
def minute_of_day(local_dt) -> int                    # 0..1439
def bucket(local_dt) -> int                           # minute_of_day // 15
def holiday_set(country: str, subdiv: str|None, years: Iterable[int]) -> set[date]
      # holidays.country_holidays(country, subdiv=subdiv, years=list(years)).keys()
def day_type(d: date, hol: set[date]) -> int          # 1 if d.weekday()==5; 2 if d.weekday()==6 or d in hol; else 0
def floor_to(ts_utc, seconds: int) -> datetime        # epoch floor
def ceil_to(ts_utc, seconds: int) -> datetime
```
All datetimes aware. Never call `datetime.now()` inside algorithms — pass `now` in (testability).

### 2.3 `db.py`
```python
def connect(cfg, autocommit=False) -> psycopg.Connection      # row_factory=dict_row, application_name='dockcast_ml'
def copy_rows(cur, table: str, cols: list[str], rows: Iterable[tuple]) -> int
      # with cur.copy(f"COPY {table} ({','.join(cols)}) FROM STDIN") as cp: for r in rows: cp.write_row(r)
def copy_df(cur, table, df: pd.DataFrame) -> int               # columns == df.columns; NaN -> NULL
def upsert_rows(cur, table, cols, conflict_cols, update_cols, rows)  # INSERT ... ON CONFLICT (...) DO UPDATE SET c=EXCLUDED.c
def fetch_df(conn, sql, params) -> pd.DataFrame                 # buffers the whole result; small reads only
def fetch_df_chunked(conn, sql, params, *, dtypes=None, chunk_rows=250_000) -> pd.DataFrame
      # server-side cursor inside an explicit transaction; casts each chunk to `dtypes` before concat
@contextmanager
def worker_run(cfg, kind: str, city_id: int|None) -> Iterator[dict]:
      # uses its OWN autocommit connection:
      # INSERT INTO worker_runs (city_id, kind, started_at) VALUES (%s,%s,now()) RETURNING id
      # yield summary(dict); on normal exit: UPDATE worker_runs SET finished_at=now(), ok=true, summary=%s::jsonb WHERE id=%s
      # on exception: UPDATE ... ok=false, error=%s (str(exc)[:2000]), summary=%s ; re-raise
```
`copy_df` writes bool as `t/f`, timestamps as ISO with tz, floats with `repr`.

### 2.4 `gbfs_ids.py`
```python
@dataclass class StationIndex:  pks: np.ndarray(int32) ; gbfs_ids: list[str]; pos: dict[int,int]  # pk -> row index
def load_stations(conn, city_id, active_only=True) -> pd.DataFrame
   # SELECT id, station_id, name, lat, lon, capacity, is_active FROM stations WHERE city_id=%s [AND is_active] ORDER BY id
def station_index(df) -> StationIndex
```

### 2.5 `logging_setup.py`
stdlib `logging` with a `JsonFormatter` (`{"ts","level","logger","msg", **extra}`) to stdout; `setup(level)`.

---------------------------------------------------------------------------

## 3. Data-access primitives

### 3.1 `grid.py` — the 1-minute as-of grid (ml-spec §1.3)
```python
@dataclass
class GridArrays:
    station_pks: np.ndarray            # (S,) int32, sorted
    pos: dict[int, int]
    t_index: pd.DatetimeIndex          # (M,) UTC, freq 1min, [t_start floor, t_end floor]
    bikes: np.ndarray                  # (S,M) int16, -1 = unknown
    docks: np.ndarray                  # (S,M) int16, -1
    ebikes: np.ndarray                 # (S,M) int16, -1
    fresh: np.ndarray                  # (S,M) bool  (ml-spec §1.2 conditions 1-3; NOT stations.is_active — history has no activity log)
    def col(self, ts_utc) -> int       # index of floor(ts) in t_index; raises if outside

def load_city_grid(conn, city_id: int, station_pks: np.ndarray, t_start, t_end) -> GridArrays
```
Algorithm:
1. Seed rows (last row strictly before `t_start` per station, bounded 30 days for chunk exclusion):
```sql
SELECT s.pk AS station_pk, x.ts, x.bikes, x.docks, x.ebikes, x.is_installed, x.is_renting, x.is_returning, x.last_reported
FROM unnest(%(pks)s::int[]) AS s(pk)
CROSS JOIN LATERAL (SELECT ts,bikes,docks,ebikes,is_installed,is_renting,is_returning,last_reported
                    FROM station_snapshots WHERE station_pk = s.pk AND ts < %(t_start)s AND ts >= %(t_start)s - interval '30 days'
                    ORDER BY ts DESC LIMIT 1) x
```
2. Range rows: `SELECT station_pk, ts, ... FROM station_snapshots WHERE station_pk = ANY(%(pks)s) AND ts >= %(t_start)s AND ts <= %(t_end)s ORDER BY station_pk, ts`.
3. Poll times: `SELECT polled_at FROM poll_log WHERE city_id=%s AND feed='station_status' AND ok AND polled_at >= %(t_start)s - interval '90 seconds' AND polled_at <= %(t_end)s ORDER BY polled_at` → `polls` (int64 ns array).
4. Build `t_index = pd.date_range(floor_min(t_start), floor_min(t_end), freq='1min', tz='UTC')`; `M=len`.
5. For each station (group of concat(seed, range) sorted by ts): `pos = np.searchsorted(row_ts, t_index_ns, side='right') - 1`; `valid = pos >= 0`; gather columns; unknown → -1 / False. Vectorise across stations by looping stations in Python (≤1,100 iterations, each pure numpy) — fine.
6. Freshness per cell: `flags = is_installed & is_renting & is_returning` (gathered); `lr_ok = (t_ns - last_reported_ns) <= 10*60e9`; poll: `pi = np.searchsorted(polls, t_ns, side='right')-1; poll_ok = (pi>=0) & (t_ns - polls[pi.clip(0)] <= 90e9)`; `fresh = valid & flags & lr_ok & poll_ok`.
Memory: one day + padding for 1,100 stations = 1,100×1,620×(2+2+2+1) B ≈ 12 MB.

### 3.2 `weather_asof.py` (ml-spec §1.4)
```python
@dataclass class WeatherRow: temp_c, precip_mm, precip_prob, wind_kmh, weather_code   # floats, NaN allowed
class WeatherAsOf:
    def __init__(self, df: pd.DataFrame)              # columns fetched_at, valid_hour, temp_c, precip_mm, precip_prob, wind_kmh, weather_code
    def at(self, t0: datetime, valid_hours: list[datetime]) -> pd.DataFrame   # index valid_hour; row = greatest fetched_at <= t0; missing → NaN row
def load_weather_window(conn, city_id, t_from, t_to) -> WeatherAsOf
   # SELECT fetched_at, valid_hour, temp_c, precip_mm, precip_prob, wind_kmh, weather_code FROM weather_forecasts
   # WHERE city_id=%s AND fetched_at <= %(t_to)s AND fetched_at >= %(t_from)s - interval '48 hours'
   #   AND valid_hour >= %(t_from)s - interval '1 hour' AND valid_hour <= %(t_to)s + interval '3 hours'
```
`at()` implementation: `sub = df[df.fetched_at <= t0]`; `sub.sort_values('fetched_at').drop_duplicates('valid_hour', keep='last').set_index('valid_hour').reindex(valid_hours)`. Cache per t0 (dict).
Weather multiplier lookup: `temp_bin(t)`: NaN→None; `<0→0, <10→1, <20→2, <30→3, else 4`. `precip_bin(p)`: NaN→None; `<0.1→0, <1→1, <3→2, else 3`. `m = multipliers[(tb,pb)]` if both not None else `1.0`.

### 3.3 `segments.py` (station-independent piece of ml-spec §2.3)
```python
@dataclass class Segment: dt_min: float; day_type: int; bucket: int; m: float; cum_end: float   # cum_end = minutes since t0 at segment end
def build_segments(t0: datetime, tz, hol: set[date], weather: WeatherAsOf, multipliers: dict[tuple[int,int],float]) -> list[Segment]
```
Boundaries in `(t0, t0+120]`: `{t0 + h for h in HORIZONS}` ∪ local 15-min bucket boundaries ∪ UTC hour boundaries. Sort, dedupe (µs). Segment `i` spans `[b_{i-1}, b_i)` with `b_{-1}=t0`; `day_type`/`bucket` from local time of segment **start**; `m` from weather row of the UTC hour containing the segment start (`weather.at(t0, hours)`) → bins → multiplier (missing → 1.0). Invariant: `cum_end` of some segment equals every `h ∈ HORIZONS` exactly (floats built as `(b_i - t0).total_seconds()/60`; horizons are integers so equality holds).

---------------------------------------------------------------------------

## 4. Bootstrap (`bootstrap/*`, `rates.py`, `weather_glm.py`, `neighbors.py`)

### 4.0 `bootstrap/trip_sources/` — per-city trip-history adapters

Which adapter a city uses comes from `cities.trip_source` (jsonb, migration
0004): `{"adapter": "<name>", ...adapter config}`. An adapter is
`fetch_chunks(city, source_cfg, month_from, month_to, cache_dir, skip_download)`
yielding normalized pandas chunks (`start_id`/`end_id` str matching GBFS
`stations.station_id`; `start_ts`/`end_ts` naive local datetimes; ml-spec §1.5
drop rules already applied; `attrs` n_in/n_dropped). Registered adapters:
`toronto_ckan` (CKAN discovery + PBSC CSV schema — the §4.1 parser) and
`generic_csv` (config-driven columns/format/tz — docs/add-a-city.md §3).
`trips.run` dispatches; its `csv_sources` test seam bypasses adapters with the
Toronto-schema parser.

### 4.1 `bootstrap/trips.py` (ml-spec §1.5)
```python
COLS = ["Start_Station_Id","Start_Time","End_Station_Id","End_Time"]   # Toronto/PBSC CSV schema
def iter_trip_chunks(csv_sources, month_from: date, month_to: date, tz) -> Iterator[pd.DataFrame]
def iter_trip_chunks_from_zip(zip_path: Path, month_from: date, month_to: date, tz) -> Iterator[pd.DataFrame]
def aggregate(chunks, tz, hol) -> TripAgg
def write_agg(conn, city_id, agg: TripAgg, window: tuple[date,date], tz) -> None
def run(cfg, conn, city, month_from: date, month_to: date, cache_dir: Path, skip_download=False, csv_sources=None) -> dict
# CKAN discovery + `download` moved to trip_sources/toronto_ckan.py (§4.0);
# run() dispatches on cities.trip_source.adapter unless the csv_sources test seam is given.
```
`iter_trip_chunks`: for every `*.csv` member of the zip: `pd.read_csv(fh, usecols=COLS, dtype=str, chunksize=200_000, encoding='utf-8', encoding_errors='replace')`. Missing column ⇒ `ValueError("unexpected header ...")` (fail loudly). Per chunk:
1. `n_in = len(chunk)`; strip; empty → NaN.
2. ids: `pd.to_numeric(col, errors='coerce')` → drop NaN → `astype('int64').astype(str)` (this normalises `"7037.0"` → `"7037"`).
3. times: `pd.to_datetime(col, format='%Y-%m-%d %H:%M:%S', errors='coerce')` (naive local). Drop NaT.
4. Drop `end_naive < start_naive` or `(end - start) > 24h`.
5. Keep `start_naive.dt.date` in `[month_from, month_to_end]`.
6. `start_utc = start_naive.dt.tz_localize(tz, ambiguous=np.ones(len, bool), nonexistent='shift_forward')` (only needed for hourly UTC counts).
7. `n_dropped += n_in - len(kept)`.
`TripAgg`: `bucket_counts: Counter[(sid, day_type, bucket)] -> [n_start, n_end]` (two Counters), `span: dict[sid] -> [min_date, max_date]` (updated from both start and end station/local dates), `hourly: Counter[hour_utc(floor 'h')]`, `n_trips`, `n_dropped`. day_type via `day_type(local_date, hol)`, bucket via `(hour*60+minute)//15` on the naive local time. Use vectorised `groupby([...]).size()` per chunk and `Counter.update(dict)`.
`write_agg` (one transaction): `DELETE FROM trip_bucket_counts WHERE city_id=%s; DELETE FROM trip_station_span WHERE city_id=%s; DELETE FROM system_hourly_trips WHERE city_id=%s;` then COPY the three tables. `system_hourly_trips` must contain **every** UTC hour from `local_midnight(month_from)` to `local_midnight(month_to_end+1)` (zeros filled). Then `INSERT INTO bootstrap_runs (city_id, window_start, window_end, n_trips, n_dropped) VALUES (...)`.

### 4.2 `bootstrap/weather_history.py`
`fetch(lat, lon, start: date, end: date) -> pd.DataFrame` in pages of ≤ 92 days: `GET https://archive-api.open-meteo.com/v1/archive?latitude=&longitude=&start_date=&end_date=&hourly=temperature_2m,precipitation,wind_speed_10m&timezone=UTC` (httpx, timeout 60, 3 retries with backoff 2/4/8 s). Parse `hourly.time` (`YYYY-MM-DDTHH:MM`, UTC) → `hour`. Write: `DELETE FROM weather_history WHERE city_id=%s AND hour BETWEEN %s AND %s` then COPY. Window = `[local_midnight(month_from) - 1 day, local_midnight(month_to_end + 1) + 1 day]` (UTC dates).

### 4.3 `rates.py` (ml-spec §2.1)
```python
def compute_rates(counts: pd.DataFrame, span: pd.DataFrame, stations: pd.DataFrame, hol: set[date]) -> pd.DataFrame
   # returns station_pk, day_type, bucket, lam_in_per_min, lam_out_per_min, source
def write_rates(conn, city_id, df, fitted_at) -> None
   # DELETE FROM station_flow_rates WHERE station_pk IN (SELECT id FROM stations WHERE city_id=%s); COPY
```
Steps (numpy, arrays indexed `[sid_idx, k, j]` shape `(n_sid, 3, 96)`):
1. `n_out, n_in` from `trip_bucket_counts` (missing cells 0).
2. `N[sid, k]` = number of dates `d` in `[first_seen, last_seen]` with `day_type(d, hol)==k` (loop over dates once, cumulative counts by day_type; O(days)).
3. `r = n / N[:,:,None]` where `N>0`; cells with `N==0` are marked `no_data[sid,k]=True`.
4. Kernel: `r_s = 0.25*np.roll(r,1,axis=2) + 0.5*r + 0.25*np.roll(r,-1,axis=2)` (circular).
5. `mu[sid,k] = n.sum(axis=2) / (96*N[sid,k])`; `lam = (N[:,:,None]*r_s + 5*mu[:,:,None]) / (N[:,:,None] + 5)`.
6. Fallback: `fb[k,j] = np.median(lam[has_data[:,k], k, j], axis=0)` (stations with `N[sid,k]>0` and `source='trips'`); if no station has data for a `k` → `fb[k,:]=0`.
7. Map GBFS `station_id` → `station_pk` (`stations`, active only). For each station_pk and `k`: if sid in counts and `N[sid,k]>0` → `lam[sid,k,:]`, `source='trips'`; else `fb[k,:]`, `source='fallback'`.
8. Per-minute: `/15`. Output 288 rows/station, float32. Log: `n_trips_stations, n_fallback_stations`.

### 4.4 `weather_glm.py` (ml-spec §2.2)
```python
TEMP_EDGES = [0,10,20,30]; PRECIP_EDGES = [0.1,1,3]; REF_TEMP=2; REF_PRECIP=0
def fit_multipliers(hourly: pd.DataFrame, weather: pd.DataFrame, tz, hol) -> tuple[pd.DataFrame, dict]   # (20 rows, diagnostics)
def write_multipliers(conn, city_id, df, fitted_at)      # DELETE ... WHERE city_id=%s; INSERT 20 rows
```
1. `df = hourly.merge(weather, on='hour', how='inner')` (hours lacking weather dropped; log count). Local `hod`, `k=day_type(local_date)`.
2. `tb = np.digitize(temp_c, TEMP_EDGES)`, `pb = np.digitize(precip_mm, PRECIP_EDGES)`.
3. Design: `X = [onehot(k*24+hod, 72) | onehot(tb,5) drop col REF_TEMP | onehot(pb,4) drop col REF_PRECIP]` → 72+4+3 = 79 columns, no intercept. `y = n_start`.
4. `res = sm.GLM(y, X, family=sm.families.Poisson()).fit(maxiter=100)`; if not converged → still use params, log warning.
5. `beta_t = [0]*5; beta_t[non-ref] = params[72:76]` in bin order; `beta_p` likewise.
6. `m_raw(tb,pb) = exp(beta_t[tb] + beta_p[pb])`; `Z = mean(m_raw(tb_hour, pb_hour))` over all merged hours; `m = clip(m_raw/Z, 0.1, 3.0)`.
7. Diagnostics: `{n_hours, converged, deviance, Z, beta_t, beta_p}` → logged and returned.

### 4.5 `neighbors.py`
```sql
DELETE FROM station_neighbors WHERE station_pk IN (SELECT id FROM stations WHERE city_id = %(c)s);
INSERT INTO station_neighbors (station_pk, neighbor_pk, rank, distance_m)
SELECT a.id, b.id, b.rn, b.d
FROM stations a
CROSS JOIN LATERAL (
  SELECT s2.id, ST_Distance(a.geom, s2.geom) AS d, row_number() OVER (ORDER BY a.geom <-> s2.geom) AS rn
  FROM stations s2 WHERE s2.city_id = a.city_id AND s2.is_active AND s2.id <> a.id
  ORDER BY a.geom <-> s2.geom LIMIT 3) b
WHERE a.city_id = %(c)s AND a.is_active;
```
### 4.6 `bootstrap/run.py`
Order: assert `stations` non-empty for city (else exit 1: "run the collector first"); trips → weather_history → rates → weather_glm → neighbors, all under one `worker_run(kind='bootstrap')`. Summary: `{n_trips, n_dropped, n_stations_rates, n_fallback, glm: diagnostics}`.

---------------------------------------------------------------------------

## 5. Birth–death baseline (`bd.py`, ml-spec §2.3)

```python
def transient_distributions(n0: int, C: int, segments: list[tuple[float,float,float]], record_at: list[float],
                            cache: dict | None = None) -> dict[float, np.ndarray]
    """segments: (dt_min, lam_in_per_min_eff, lam_out_per_min_eff) already multiplied by m.
       record_at: cumulative minutes; each must coincide (|Δ|<1e-9) with a segment end.
       Returns {h: p_h} with p_h shape (C+1,), sums to 1."""
def generator(C: int, lin: float, lout: float) -> np.ndarray      # (C+1,C+1) float64: Q[n,n+1]=lin (n<C), Q[n,n-1]=lout (n>0), diag = -rowsum
def transition(C, lin, lout, dt, cache) -> np.ndarray             # key=(C, round(lin*dt,9), round(lout*dt,9)); scipy.linalg.expm(generator(C,lin,lout)*dt)
@dataclass class BdOut: p_bike: float; p_dock: float; exp: float; q10: int; q90: int; A: float; D: float
def summarise(p: np.ndarray, C: int, A: float, D: float) -> BdOut
    # p_bike = 1 - p[0]; p_dock = 1 - p[C]; exp = (np.arange(C+1)*p).sum(); cdf=np.cumsum(p); q10 = int(np.searchsorted(cdf, 0.10)); q90 = int(np.searchsorted(cdf, 0.90))
def forecast_station(n0: int, C: int, rates_k_j: np.ndarray, segments: list[Segment], horizons=HORIZONS, cache=None) -> dict[int, BdOut]
    # rates_k_j: (3,96,2) per-minute [lam_in, lam_out] for this station; effective rates per segment = rates[k,j]*m
    # A_h / D_h = cumulative sums of lin*dt / lout*dt over segments with cum_end <= h
```
Propagation: `p = np.zeros(C+1); p[min(n0,C)] = 1.0`; for each segment: `p = p @ P; p = np.clip(p, 0, None); p /= p.sum()`; `elapsed += dt`; record when `abs(elapsed - h) < 1e-9`. Precondition `C >= 1` (caller skips `C==0` with `reason='zero_capacity'`). Cost: ≤ 11 `expm` per station per cycle, size ≤ 88; the `cache` dict (cleared per cycle) de-duplicates identical `(C, lin·dt, lout·dt)` — all fallback-rate stations with equal capacity share entries. Budget: ≤ 20 s for 1,100 stations on 2 vCPU (measure in T-perf test; if exceeded, uniformisation is the sanctioned optimisation, but expm is the reference implementation and T4 must still pass).

---------------------------------------------------------------------------

## 6. Profiles, features, labels

### 6.1 `profile.py` — climatology (ml-spec §3.2 items 37–39)
```python
class RollingProfile:
    """Per-(station, day_type, bucket) means over a rolling set of prior days. Same object used by the
    nightly job (28 days ending yesterday) and by train (rolling window advanced day by day) ⇒ train == serve."""
    def __init__(self, S: int, max_days: int = 28)
    def add_day(self, d: date, day_type: int, grid: GridArrays, day_cols: slice)   # push daily aggregates, evict > max_days old
    def lookup(self, day_type: np.ndarray, bucket: np.ndarray, station_row: np.ndarray) -> tuple[fill, p_bike, p_dock]  # NaN where n==0
    def to_frame(self, built_for: date) -> pd.DataFrame     # station_pk, day_type, bucket, mean_fill, p_bike, p_dock, n, built_for
```
Daily aggregate for day `d` (local): for each station and bucket `j`, over the 15 grid minutes of `j` on `d` (local) where `fresh & cap>0`: `sum_fill += bikes/(bikes+docks)`, `sum_bike += bikes>=1`, `sum_dock += docks>=1`, `n += 1`. Rolling arrays shape `(3, S, 96)` for sums and n, plus a deque of `(d, day_type, per-day arrays)` for eviction. `profile` command: for `D` (default today local): load grid day by day for `[D-28, D-1]`, `add_day`, then `DELETE FROM station_tod_profile WHERE station_pk IN (SELECT id FROM stations WHERE city_id=%s)` + COPY `to_frame(D)` (rows with `n>0` only). One transaction.

### 6.2 `features.py` (ml-spec §3.2)
```python
FEATURE_SCHEMA_VERSION = 1
FEATURE_NAMES = ["bikes0","docks0","cap0","fill0","dbikes_5","dbikes_15","dbikes_30","dbikes_60","ebikes0",
  "mod","mod_sin","mod_cos","dow","is_holiday","daytype","h","station_pk","lat","lon","cap_static",
  "bd_p_bike","bd_p_dock","bd_exp_cnt","bd_A","bd_D","lam_in_now","lam_out_now",
  "temp_now","precip_now","wind_now","code_now","temp_h","precip_h","precip_prob_h",
  "nn3_mean_fill","nn3_mean_dfill_15","clim_fill","clim_p_bike","clim_p_dock"]      # len == 39
CATEGORICAL = ["dow","daytype","station_pk"]
@dataclass
class FeatureContext:
    tz; hol; stations: pd.DataFrame (id, lat, lon, capacity; ordered as grid.station_pks); grid: GridArrays
    rates: np.ndarray (S,3,96,2) float32, rates_ok: np.ndarray (S,) bool
    weather: WeatherAsOf; multipliers: dict; neighbors: np.ndarray (S,3) int (row idx, -1 if none); profile: RollingProfile
def build_features(ctx, rows: pd.DataFrame) -> pd.DataFrame
    """rows: station_pk, t0 (UTC), horizon, bd_p_bike, bd_p_dock, bd_exp_cnt  (bd values from the chain online, from
       forecast_history tier='bd_raw' offline). Returns rows + FEATURE_NAMES in that order, dtypes float32 except
       dow/daytype/station_pk/h/mod/is_holiday int32. Rows are grouped by t0 internally (segments/weather are per t0)."""
def build_labels(grid: GridArrays, rows: pd.DataFrame) -> pd.DataFrame
    """adds bikes0, docks0, y_bike, y_dock, y_cnt, label_ok (fresh at t0 and t0+h and cap0>=1)"""
```
Definitions (all "at t0" values are `grid` cells at `grid.col(t0)`; unknown (-1 / not fresh at t0) rows are dropped by the caller since such rows never get bd values):
| # | name | definition |
|---|---|---|
| 1–3 | bikes0, docks0, cap0 | grid; `cap0 = bikes0+docks0` |
| 4 | fill0 | `bikes0/cap0` |
| 5–8 | dbikes_k | `bikes0 - bikes[t0-k]` if `fresh[t0-k]` else NaN |
| 9 | ebikes0 | grid ebikes, -1 → NaN |
| 10–12 | mod, mod_sin, mod_cos | local minute of day of t0; `sin/cos(2π·mod/1440)` |
| 13 | dow | `local(t0).weekday()` 0=Mon |
| 14 | is_holiday | `local_date(t0) in hol` |
| 15 | daytype | `day_type(local_date(t0), hol)` |
| 16 | h | horizon minutes |
| 17 | station_pk | **[decision]** `stations.id` itself is the categorical code (ml-spec's "station_code table" does not exist in the schema; `stations.id` is a small stable int) |
| 18–20 | lat, lon, cap_static | `stations`; capacity NULL → NaN |
| 21–23 | bd_* | passed in via `rows` (online: this cycle's `bd` output; offline: `forecast_history.p_bike/p_dock/exp_bikes` of the `bd_raw` row) |
| 24–25 | bd_A, bd_D | online: `Σ_seg rates[s,k_seg,j_seg,in/out]·m_seg·dt_seg` over segments with `cum_end <= h` (`segments.build_segments(t0)`), vectorised over stations per t0; offline: `forecast_history.bd_a/bd_d` of the `bd_raw` row (**ratified**: never recomputed offline) |
| 26–27 | lam_in_now, lam_out_now | online: `rates[s, daytype(t0), bucket(t0)]·m(w_t0)` (weather-adjusted per-minute rates at t0); offline: `forecast_history.lam_in/lam_out` of the `bd_raw` row |
| 28–31 | *_now | weather row for UTC hour containing t0 (as-of t0) |
| 32–34 | *_h | weather row for UTC hour containing `t0+h` (as-of t0) |
| 35 | nn3_mean_fill | mean of `fill` at t0 over neighbours that are fresh at t0 with cap>0; NaN if none |
| 36 | nn3_mean_dfill_15 | mean over neighbours fresh at t0 and t0−15 of `fill(t0)−fill(t0−15)` |
| 37–39 | clim_* | `profile.lookup(day_type(local_date(t0+h)), bucket(local(t0+h)), s)` — **[decision]** keyed by the *target* time `t0+h` (ml-spec is silent; this matches api.md §0.1 "typical" semantics) |
Implementation: for each unique `t0` in `rows`: `c = grid.col(t0)`; compute per-station vectors once (S,), then take rows' station indices; per-horizon items (`bd_A/D`, `*_h`, `clim_*`) computed per `(t0,h)` pair (≤ 6). Assemble with `np.column_stack` → DataFrame with `FEATURE_NAMES`. Assert `list(out.columns[-39:]) == FEATURE_NAMES`.

### 6.3 `labels.py` (ml-spec §5.4)
```python
def materialise_labels(conn, city, now: datetime) -> dict   # {'n_rows', 'days'}
```
1. `SELECT max(t0) FROM forecast_labels l JOIN stations s ON s.id=l.station_pk WHERE s.city_id=%s` → `last` (None → min forecast_history t0 for the city).
2. Candidate range `[last - 1 day, now - 125 min]`, processed per local day `D` (chunk = `[local_midnight(D), local_midnight(D+1))`):
   `SELECT DISTINCT h.station_pk, h.t0, h.horizon FROM forecast_history h WHERE h.tier='bd_raw' AND h.t0 >= %s AND h.t0 < %s AND h.station_pk = ANY(%s) AND h.t0 + (h.horizon||' minutes')::interval <= %(now)s - interval '5 minutes' EXCEPT SELECT station_pk, t0, horizon FROM forecast_labels WHERE t0 >= %s AND t0 < %s`
3. `grid = load_city_grid(conn, city_id, pks, day_start, day_end + 120 min)`; `build_labels`; keep `label_ok`.
4. Write via temp table: `CREATE TEMP TABLE tmp_labels (LIKE forecast_labels) ON COMMIT DROP; COPY tmp_labels ...; INSERT INTO forecast_labels SELECT * FROM tmp_labels ON CONFLICT (station_pk, t0, horizon) DO NOTHING;` (unique index exists → ON CONFLICT with the index columns is valid).

---------------------------------------------------------------------------

## 7. Models, evaluation, gate

### 7.1 `models/calibration.py`
```python
def fit_calibrators(p: np.ndarray, y: np.ndarray, horizons: np.ndarray, min_rows: int = 1000) -> dict[int, IsotonicRegression]
   # per h in HORIZONS: if count>=min_rows: IsotonicRegression(y_min=0,y_max=1,out_of_bounds='clip',increasing=True).fit(p_h, y_h)
def apply_calibrators(cal: dict, p, horizons) -> np.ndarray     # identity for h without a calibrator; output clipped [0,1]
```
### 7.2 `models/gbm.py` (ml-spec §3.4)
```python
PARAMS_BASE = dict(num_leaves=63, learning_rate=0.05, min_data_in_leaf=200, feature_fraction=0.8, bagging_fraction=0.8,
                   bagging_freq=1, lambda_l2=1.0, max_bin=255, seed=42, deterministic=True, num_threads=2, verbosity=-1)
def train_boosters(X_tr: pd.DataFrame, Y_tr: dict[str,np.ndarray], X_es: pd.DataFrame, Y_es: dict[str,np.ndarray]) -> dict[str, lgb.Booster]
    # for target in ('bike','dock'): params={**PARAMS_BASE,'objective':'binary','metric':'binary_logloss'}
    # for 'cnt': params={**PARAMS_BASE,'objective':'regression','metric':'l2'}
    # dtr=lgb.Dataset(X_tr[FEATURE_NAMES], label=Y_tr[t], categorical_feature=CATEGORICAL, free_raw_data=False)
    # des=lgb.Dataset(X_es[FEATURE_NAMES], label=Y_es[t], reference=dtr, categorical_feature=CATEGORICAL)
    # lgb.train(params, dtr, num_boost_round=3000, valid_sets=[des], callbacks=[lgb.early_stopping(50, verbose=False)])
def predict_raw(boosters, X) -> dict[str, np.ndarray]     # booster.predict(X[FEATURE_NAMES], num_iteration=booster.best_iteration)
```
Categorical columns must be int32 with no NaN (station_pk/dow/daytype are never NaN). Labels: `y_bike/y_dock` as `int8`, `y_cnt` as `float32`. `X_tr`, `X_es` are DataFrames of `FEATURE_NAMES` (float32/int32).

### 7.3 `models/artifact.py` (ml-spec §3.5)
```python
@dataclass class GbmBundle: tier='gbm'; feature_schema_version:int; feature_names:list[str]; boosters:dict[str,str] (model_to_string());
                            calibrators: dict[str, dict[int, IsotonicRegression]]; train_window: tuple[str,str]; git_sha; hyperparams; metrics_val: dict; created_at
@dataclass class BdBundle:  tier='bd'; calibrators: dict[str, dict[int, IsotonicRegression]]; fit_window: tuple[str,str]; created_at
def dumps(bundle) -> bytes            # pickle.dumps(dataclasses.asdict(...) + {'kind': tier}, protocol=5)
def loads(b: bytes) -> GbmBundle|BdBundle
def boosters_of(bundle: GbmBundle) -> dict[str, lgb.Booster]     # lgb.Booster(model_str=s); cached on the bundle
```
### 7.4 `evaluate.py` (ml-spec §5.2)
```python
@dataclass class Preds: p_bike, p_dock, y_cnt_hat: np.ndarray|None
def brier(p,y); logloss(p,y) (clip 1e-6); auc(p,y) (roc_auc_score; NaN if one class); ece(p,y,bins=10); reliability(p,y,bins=10) -> list[(b,n,mean_pred,frac_pos)]
def metric_rows(tier: str, preds: Preds, y_bike, y_dock, y_cnt, bikes0, docks0, horizons) -> list[dict]
    # rows: {tier,target,horizon,slice,metric,value,n}; horizon in HORIZONS + [0 pooled]; slices: 'all', 'at_risk'
    # at_risk: bike & cnt → bikes0<=3 ; dock → docks0<=3      [decision: cnt uses bikes0<=3]
    # bike/dock metrics: brier, logloss, auc, ece, n ; plus reliability rows ONLY for horizon 0: rel_bin_{b}_mean_pred / _frac_pos / _n, b=0..9
    # cnt metrics: mae, rmse, n
```
ECE: `b = np.minimum((p*10).astype(int), 9)`; `ece = Σ_b (n_b/N)·|mean(p_b) − mean(y_b)|`.
Callers guarantee identical row sets across tiers by computing all tiers on the same arrays.

### 7.5 `gate.py` (ml-spec §5.3)
```python
@dataclass class Check: name:str; value:float; threshold:float; ok:bool
@dataclass class GateResult: passed:bool; reference_tier:str; checks:list[Check]; def to_json(self)->dict
def evaluate_gate(cand: dict, ref: dict, active: dict|None) -> GateResult
   # dicts: {'brier_bike','brier_dock','ece_bike','ece_dock','mae'} pooled over horizons, slice 'all', on val
   # checks: brier_bike_vs_ref = cand/ref ≤ 0.95 ; brier_dock_vs_ref ≤ 0.95 ; ece_bike ≤ 0.05 ; ece_dock ≤ 0.05 ; mae_vs_ref = cand/ref ≤ 1.0 ;
   #         if active: brier_bike_vs_active ≤ 1.0 ; brier_dock_vs_active ≤ 1.0. passed = all ok.
```
JSON: `{"passed": true, "reference_tier": "bd_cal", "checks": [{"name":"brier_bike_vs_ref","value":0.91,"threshold":0.95,"ok":true}, ...]}`.

---------------------------------------------------------------------------

## 8. Jobs

### 8.1 `predict.py` (ml-spec §6)
```python
def predict_once(cfg, conn, city: dict, t0: datetime, state: PredictState) -> dict   # summary
def loop(cfg): while True: t0 = ceil_to(now, PREDICT_INTERVAL_SEC); sleep until t0; for city in cities(forecasting_enabled): with worker_run('predict', city_id) as s: s.update(predict_once(...))
```
`PredictState` (per city, in-process): `active: GbmBundle|None`, `active_id`, `shadow`, `shadow_id`, `bd_cal: BdBundle|None`, `bd_id`, `max_seen_version_id`, `rates` cache (reloaded hourly), `multipliers`, `neighbors`, `profile` (`RollingProfile` loaded from `station_tod_profile` — `profile.from_table(conn, city_id)` reading `n>0` rows; the predictor does not recompute it).
Steps of `predict_once`:
1. `stations = load_stations(active_only=True)`; `SELECT * FROM station_state_fresh WHERE city_id=%s` → `cur` (DataFrame indexed by station_pk). Stations with no `station_current` row: skipped entirely.
2. Reload models if `SELECT max(id) FROM model_versions WHERE city_id=%s` > `max_seen_version_id`: `SELECT id, tier, status, feature_schema_version, artifact FROM model_versions WHERE city_id=%s AND status IN ('active','shadow') AND artifact IS NOT NULL` → set active/shadow/bd_cal; a gbm bundle whose `feature_schema_version != FEATURE_SCHEMA_VERSION` is ignored with an error log.
3. Rates: `SELECT station_pk, day_type, bucket, lam_in_per_min, lam_out_per_min FROM station_flow_rates WHERE station_pk = ANY(%s)` → `(S,3,96,2)`, `rates_ok[s]` = all 288 rows present. Multipliers: `SELECT temp_bin, precip_bin, m FROM weather_multipliers WHERE city_id=%s` (empty → all 1.0, warn). Neighbors: `SELECT station_pk, neighbor_pk, rank FROM station_neighbors WHERE station_pk = ANY(%s)`.
4. `weather = load_weather_window(conn, city_id, t0, t0)`; `segs = build_segments(t0, ...)`.
5. Grid for lookbacks: `grid = load_city_grid(conn, city_id, pks, t0 - 61 min, t0)`; **[decision]** `bikes0/docks0` for the chain and features are taken from the grid cell at `t0` (as-of), which for a fresh station equals `station_current` (`ts ≤ t0`); freshness = `station_state_fresh.is_fresh` (adds `stations.is_active`).
6. For each station: `if not fresh → reason='not_fresh'`; `elif cap0==0 → 'zero_capacity'`; `elif not rates_ok → 'no_rates'`; else `bd = forecast_station(...)`.
7. `rows` (station_pk,t0,h,bd_*) for forecasted stations → `X = build_features(ctx, rows)`; if active: `raw = predict_raw`; `p = apply_calibrators`; `cnt = clip(y_cnt_hat, 0, cap0)`; same for shadow. bd_cal: `apply_calibrators(bd_cal.calibrators[...], bd_p, h)`.
8. Serving tier per ml-spec §6.3. Upsert `forecasts_latest` for **all** stations with a `station_current` row:
```sql
INSERT INTO forecasts_latest (station_pk,horizon,t0,valid_at,p_bike,p_dock,exp_bikes,q10,q90,tier,model_version_id,reason)
VALUES (...) ON CONFLICT (station_pk,horizon) DO UPDATE SET t0=EXCLUDED.t0, valid_at=EXCLUDED.valid_at, p_bike=EXCLUDED.p_bike, p_dock=EXCLUDED.p_dock,
  exp_bikes=EXCLUDED.exp_bikes, q10=EXCLUDED.q10, q90=EXCLUDED.q90, tier=EXCLUDED.tier, model_version_id=EXCLUDED.model_version_id, reason=EXCLUDED.reason
```
(`executemany`, one transaction). Non-forecast rows: `p_*=NULL, exp_bikes=NULL, q10/q90=NULL, tier='none', model_version_id=NULL, reason=<reason>`. `valid_at = t0 + h`. `q10/q90` always from bd (also when serving gbm).
9. If `t0.minute % 15 == 0`: COPY into `forecast_history` rows for tiers `bd_raw`, `bd_cal` (if calibrators loaded), `gbm_active` (if active), `gbm_shadow` (if shadow); `model_version_id` = respective id (NULL for bd_raw). `bd_raw` rows also carry `bd_a, bd_d, lam_in, lam_out` (features 24–27 as computed this cycle); other tiers leave them NULL. Idempotency: wrap in `INSERT ... SELECT FROM tmp ON CONFLICT DO NOTHING` via temp table (unique index `forecast_history_uq`).
10. Summary: `{t0, n_stations, n_forecast, n_not_fresh, n_zero_capacity, n_no_rates, serving_tier, active_id, shadow_id, bd_cal_id, ms_bd, ms_features, ms_total}`.
Timing budget for 1,100 stations: grid ≤ 2 s, chain ≤ 20 s, features+gbm ≤ 3 s, writes ≤ 3 s. Total < 60 s (assert `< PREDICT_INTERVAL_SEC/2`, else log warning).

### 8.2 `train.py` (ml-spec §7 + §3.3 + §5)
```python
def train_city(cfg, conn, city: dict, T: date, now: datetime) -> dict
```
**Operational order [decision — labels must precede row building; ml-spec §7 lists them after, which is a listing not a dependency order]:**
1. `neighbors.rebuild(city)`.
2. `labels.materialise_labels(city, now)`.
3. `profile`: build `RollingProfile` for `[T-28, T-1]` and write `station_tod_profile` (built_for=T).
4. **bd calibration** (ml-spec §5.1): rows = `SELECT h.station_pk, h.t0, h.horizon, h.p_bike, h.p_dock, l.y_bike, l.y_dock FROM forecast_history h JOIN forecast_labels l USING (station_pk,t0,horizon) JOIN stations s ON s.id=h.station_pk WHERE s.city_id=%s AND h.tier='bd_raw' AND h.t0 >= %(a)s AND h.t0 < %(b)s` with `a=local_midnight(T-21)`, `b=local_midnight(T-7)`. If `n ≥ 50,000` per target → `fit_calibrators` per target → `BdBundle`; else `BdBundle(calibrators={})` (log `bd_uncalibrated`). **A bd version is written on every run** (ratified, ml-spec §5.1): `model_versions(tier='bd', status='active', trained_for_date=T, train_window=[a,b), artifact)` using §8.4 activation SQL. `ref_tier = 'bd_cal'` if this run's bd bundle has calibrators else `'bd_raw'`.
5. **Row universe & splits**: `data_days = SELECT DISTINCT (t0 AT TIME ZONE tz)::date FROM forecast_history h JOIN stations s ... WHERE h.tier='bd_raw' AND t0 >= local_midnight(T-60) AND t0 < local_midnight(T)`; if `len(data_days) < 14` → insert `model_versions(tier='gbm', status='insufficient_data', trained_for_date=T, artifact NULL, metrics_val={'n_days':…})` and **skip to step 9**. `start = max(T-60, min(data_days))`; `train=[start,T-9)`, `es=[T-9,T-7)`, `val=[T-7,T)` (local dates; UTC via `local_midnight`).
6. **Per-day row build** (memory-safe): for each local day `D` in `train ∪ es ∪ val`:
   - `rows_D` = history⋈labels SQL (§6.3 pattern, tier='bd_raw', add `l.bikes0,l.docks0,l.y_bike,l.y_dock,l.y_cnt`).
   - `grid_D = load_city_grid(city, pks, local_midnight(D) - 61 min, local_midnight(D+1) + 120 min)`; `weather_D = load_weather_window(city, local_midnight(D), local_midnight(D+1))`; `profile.add_day(D-1)` beforehand (the profile passed to features for day `D` contains days `≤ D-1`; the profile is warmed with the 28 days before `start`).
   - `X_D = build_features(ctx_D, rows_D)`.
   - Subsampling (ratified caps: train 3,000,000 / es 1,000,000 / val 2,000,000): before the loop, `counts = {D: n_rows_D}` via `SELECT count(*)` per day, per split; per split with `N = Σ > cap`: `n_D = round(cap · counts[D]/N)`; `rng = np.random.default_rng(42)`; per day in date order: `keep = rng.choice(n_rows_D, n_D, replace=False)` (rows sorted by (station_pk,t0,horizon) first, so deterministic). The `val` subsample is drawn once and is the row set on which **every** tier is scored.
   - Train/es: append `X_D[FEATURE_NAMES]` (float32/int32) and labels to lists → `pd.concat` after loop. Val: append only `(station_pk,t0,horizon,bikes0,docks0,y_bike,y_dock,y_cnt,bd_p_bike,bd_p_dock,bd_exp_cnt)` **plus** predictions of the *active* model if present (`predict_raw` per day, then calibrated) — the candidate is not trained yet, so also stash `X_D` for val **to disk**: `np.save(f"{tmpdir}/val_{D}.npy", X_D[FEATURE_NAMES].to_numpy(np.float32))` and reload per day after training (keeps RAM ≤ ~1 GB).
7. **Train**: `boosters = train_boosters(X_tr, Y_tr, X_es, Y_es)`; calibrators on `es`: `fit_calibrators(predict_raw(boosters, X_es)[t], Y_es[t], X_es.h)` for bike/dock.
8. **Score val** per day (reload `val_D.npy`): candidate raw → calibrated; `cnt = clip(y_cnt_hat, 0, cap0)`; bd_cal = calibrators applied to `bd_p_*` from history; persistence from `bikes0/docks0`. `metric_rows` for tiers `persistence, bd_raw, bd_cal(if any), gbm_cand, gbm_active(if any and schema matches)` on the identical row arrays. Gate: `evaluate_gate(cand_summary, ref_summary, active_summary)`. Write `model_versions(tier='gbm', status='active'|'shadow', trained_for_date=T, train_window=[start,T-9), feature_schema_version, git_sha, hyperparams=PARAMS_BASE+best_iterations, metrics_val=MetricsVal (api.md §4 shape: n_val, brier{bike,dock}, logloss{}, auc{}, ece{}, mae, rmse, brier_at_risk{}, ref{tier,brier{},mae}) plus `best_iter:{bike,dock,cnt}`, gate=Gate (api.md §4: `{passed, checks:[{name,value,threshold,ok}]}` with names `brier_bike_vs_ref, brier_dock_vs_ref, ece_bike, ece_dock, mae_vs_ref, brier_bike_vs_active, brier_dock_vs_active`), artifact)` (§8.4). The bd version's `metrics_val` uses the same MetricsVal shape with `ref=null`. `model_eval` rows (split 'val') for the candidate; also split 'val' rows for `bd_raw`/`bd_cal`/`persistence` are attached to the **bd** version created in step 4 (or the existing active bd) — model_eval requires a version id.
9. `metrics_online.compute(city, T)` for windows 1 and 7 (§8.3).
10. Cleanup `weather_forecasts` older than 120 days: `DELETE FROM weather_forecasts WHERE city_id=%s AND fetched_at < now() - interval '120 days'`.
11. Log one summary line; on success `httpx.get(HEALTHCHECKS_TRAINER_URL, timeout=10)` (ignore errors).
Idempotency: at the start of steps 4 and 8: `DELETE FROM model_versions WHERE city_id=%s AND tier=%s AND trained_for_date=%s` (cascades `model_eval`); if the deleted row was `active`, the newly written one takes over (activation SQL below), so a re-run of the same date is safe.

### 8.3 `metrics_online.py` (ml-spec §5.4)
`compute(conn, city, T, windows=(1,7))`: for `w`: rows for `t0 ∈ [local_midnight(T-w), local_midnight(T))`:
```sql
SELECT h.station_pk, h.t0, h.horizon, h.tier, h.p_bike, h.p_dock, h.exp_bikes, l.bikes0, l.docks0, l.y_bike, l.y_dock, l.y_cnt
FROM forecast_history h JOIN forecast_labels l USING (station_pk,t0,horizon) JOIN stations s ON s.id=h.station_pk
WHERE s.city_id=%s AND h.t0 >= %s AND h.t0 < %s
```
The window is read with `fetch_df_chunked` and cast to the DB's own column widths (`real` -> float32, `smallint` -> int16, `tier` -> category), which is lossless: the 7-day window passed 12M rows in Sept 2026 and buffering it as psycopg dicts OOM-killed the trainer. Pivot by tier. Base rows = `bd_raw` rows; `persistence` computed on base rows (`p_bike=(bikes0>=1)`, `p_dock=(docks0>=1)`, `cnt=bikes0`); each other tier on its own rows (inner-joined to base). `metric_rows` per tier → upsert `model_metrics_daily (city_id, day=T, window_days=w, tier, target, horizon, slice, metric, value, n)` `ON CONFLICT (...) DO UPDATE SET value=EXCLUDED.value, n=EXCLUDED.n`. Also `collector uptime` is **not** computed here (api computes from `poll_log`).

### 8.4 `model_versions` write (single active per (city,tier))
```sql
BEGIN;
DELETE FROM model_versions WHERE city_id=%(c)s AND tier=%(t)s AND trained_for_date=%(d)s;
-- if new status = 'active':
UPDATE model_versions SET status='superseded', deactivated_at=now() WHERE city_id=%(c)s AND tier=%(t)s AND status='active';
-- if new status = 'shadow' (gbm only):
UPDATE model_versions SET status='superseded', deactivated_at=now() WHERE city_id=%(c)s AND tier='gbm' AND status='shadow';
INSERT INTO model_versions (city_id,tier,status,feature_schema_version,trained_for_date,train_window,git_sha,hyperparams,metrics_val,gate,artifact,activated_at)
VALUES (%(c)s,%(t)s,%(status)s,%(fsv)s,%(d)s,tstzrange(%(a)s,%(b)s,'[)'),%(sha)s,%(hp)s::jsonb,%(mv)s::jsonb,%(gate)s::jsonb,%(art)s, CASE WHEN %(status)s='active' THEN now() END)
RETURNING id;
INSERT INTO model_eval (model_version_id,split,target,horizon,slice,metric,value) VALUES ... ;  -- COPY
COMMIT;
```
Reading the serving set (predictor): `SELECT id,tier,status,feature_schema_version,artifact FROM model_versions WHERE city_id=%s AND status IN ('active','shadow') AND artifact IS NOT NULL ORDER BY id`.

---------------------------------------------------------------------------

## 9. Tests (`ml/tests`)

Fixtures dir: `ml/tests/fixtures/` (golden features parquet + tiny synthetic CSV/JSON). Real data fixtures: `/fixtures/**` (repo root; path via `pathlib.Path(__file__).parents[2] / 'fixtures'`).

| ID | file :: test | assertion |
|---|---|---|
| T1 | `test_bd.py::test_zero_rates_identity` | rates 0 ⇒ `p_h == e_{n0}` for all h (exact) |
| T2 | `test_bd.py::test_mass_conservation` | random (C≤88, rates≤2/min) ⇒ `abs(p.sum()-1) < 1e-9` for all h |
| T3 | `test_bd.py::test_unbounded_mean` | C=200, n0=100, lin=0.05, lout=0.03, h=15 ⇒ `abs(E[n] − (100+0.3)) < 1e-3` |
| T4 | `test_bd.py::test_monte_carlo_agreement` (`slow`) | Gillespie 20,000 paths (seed 0), C=20,n0=7,lin=0.4,lout=0.3,h=60 ⇒ `|p_bike−mc| < 0.02`, `|p_dock−mc| < 0.02` |
| T5 | `test_bd.py::test_boundaries` | n0=C, rates>0 ⇒ `p_dock<1`; n0=0 ⇒ `p_bike<1` |
| T6 | `test_rates.py::test_recover_known_rates` | synthetic counts from λ=[0.2..3]/bucket over N=40 days ⇒ pre-shrinkage `r` within 5 %; post-shrinkage moves toward μ (`|λ−μ| ≤ |r_s−μ|`) |
| T7 | `test_weather_glm.py::test_multiplier_mean_one` | synthetic hourly data ⇒ `abs(mean(m_raw/Z over hours) − 1) < 1e-6` (before clip) |
| T8 | `test_timeutil.py::test_holiday_is_sun` | `day_type(date(2026,7,1), hol_ON) == 2`; Sat==1; Tue==0 |
| T9 | `test_grid.py::test_poll_gap_masks` | synthetic snapshots + polls with a 10-min gap ⇒ `fresh` False inside `(gap_start+90s, next_poll)`, True after |
| T10 | `test_grid.py::test_stale_last_reported` | `last_reported` 11 min old ⇒ `fresh` False |
| T11 | `test_grid.py::test_change_only_equals_dense` | dense series vs its change-only compression ⇒ identical `bikes/docks` grids |
| T12 | `test_features.py::test_no_leakage` | perturb every snapshot/weather row with `ts > t0` ⇒ `build_features` output equal (`pd.testing.assert_frame_equal`) |
| T13 | `test_features_golden.py::test_golden_rows` | frozen `ml/tests/fixtures/golden_features.parquet` (built once from `ml/tests/fixtures/golden_input.json`) ⇒ exact equality per column (`check_exact=True` for ints, `atol=1e-6` floats) |
| T14 | `test_features.py::test_schema_manifest` | `len(FEATURE_NAMES)==39`, order equals the ml-spec list (hard-coded copy in test), `FEATURE_SCHEMA_VERSION==1` |
| T15 | `test_evaluate.py::test_perfect_and_constant` | perfect ⇒ brier 0, ece 0; constant 0.5 on balanced ⇒ brier 0.25 |
| T16 | `test_calibration.py::test_isotonic_monotone_clip` | outputs non-decreasing in p; `apply(−0.1)==apply(0)`, `apply(1.1)==apply(1)` |
| T17 | `test_gate.py::test_truth_table` | each of the 7 checks failing alone ⇒ `passed=False`; all ok ⇒ True; JSON shape |
| T18 | `test_horizons.py::test_constants_match_ts` | `HORIZONS == (15,30,45,60,90,120)` and equals regex-extracted TS constant |
| – | `test_segments.py::test_segment_invariants` | segments tile `(t0,t0+120]` exactly; every `h` equals some `cum_end`; bucket boundaries respected across DST day (2026-11-01 America/Toronto) |
| – | `test_trips_parse.py` | fixture `bikeshare_2025_08_head2000.csv`: 2000 rows in, `n_dropped == 0`; `bikeshare-ridership-2026_head2000.csv`: ids like `7037.0` → `'7037'`, all rows kept; synthetic rows with empty End_Station_Id / end<start / 25 h duration are dropped |
| – | `test_weather_history.py` | parse `openmeteo_archive_sample.json` ⇒ 48 rows, UTC hours, values match |
| – | `test_profile.py` | RollingProfile: 29 days added ⇒ oldest evicted; means correct on synthetic |
| – | `test_labels.py` | `build_labels` on synthetic grid ⇒ y_* correct; not-fresh at t0+h ⇒ `label_ok False` |
| – | `test_bd_perf.py::test_cycle_budget` (`slow`) | 1,100 random stations (C 4..88) × segments ⇒ `< 25 s` |
| db | `test_db_predict_once.py` (`db`) | apply migrations to `DATABASE_URL_TEST` (fresh schema: `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` then run `db/migrations/*.sql` in order); insert synthetic city+stations+current+poll_log+rates+multipliers+weather; `predict_once(t0)` ⇒ `forecasts_latest` has 6 rows/station, `p_bike∈[0,1]`, reasons for a not-fresh and a zero-cap station, history rows written when `t0.minute%15==0` and not otherwise |
| db | `test_db_train_synthetic.py` (`db`,`slow`) | 20 stations, capacities 10–30, 17 days simulated birth–death (per-minute Poisson thinning, known rates by bucket, no rebalancing) → snapshots (change-only) + poll_log every 60 s + constant weather; run `predict_once` at every :00/:30 t0 (`bd_raw` history); `materialise_labels`; `train_city(T)` ⇒ `model_versions` has a `gbm` row with status ∈ {active,shadow}, `model_eval` rows exist, `model_metrics_daily` rows exist, candidate `brier_bike ≤ persistence brier_bike` on val |

`conftest.py`: `db_conn` fixture (skips if `DATABASE_URL_TEST` unset), `synthetic_city` fixture, deterministic seeds.

---------------------------------------------------------------------------

## 10. Definition of done
- [ ] `uv run ruff check .` clean; `uv run pytest` green; `uv run pytest -m "slow or db"` green against a `timescaledb-ha` container.
- [ ] Every function in §2–§8 exists with the stated signature; no additional modelling choices were made (any ambiguity ⇒ recorded in the final report, not resolved silently).
- [ ] `python -m dockcast_ml bootstrap --city toronto` completes on the real data (≥ 9 M trips, ≥ 900 stations with `source='trips'`), `weather_multipliers` has 20 rows with `0.1 ≤ m ≤ 3`.
- [ ] `predict --once` on real Toronto data writes 6 × (#stations with current) `forecasts_latest` rows in < 60 s.
- [ ] `train` on < 14 days writes an `insufficient_data` version and exits 0; on ≥ 14 days writes bd + gbm versions, `model_eval`, `model_metrics_daily`.
- [ ] Logs are single JSON lines; `worker_runs` rows written for every command.
