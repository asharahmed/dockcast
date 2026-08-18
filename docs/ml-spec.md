# DockCast — Forecasting Model Specification (v0.2)

Status: APPROVED 2026-08-17 (v0.1 draft approved; v0.2 folds in data-probe results, no semantic changes). Everything here is normative once approved: implementers
follow it literally; deviations require a spec change first.

Scope: how DockCast turns raw GBFS snapshots + trip history + weather into
calibrated probabilities `P(≥1 bike)` / `P(≥1 dock)` and an expected count, for
each station × horizon; how those models are trained, validated, calibrated,
compared, promoted, and continuously scored in production.

---------------------------------------------------------------------------

## 0. Definitions and notation

| Symbol | Meaning |
|---|---|
| `s` | a station (GBFS `station_id`, string) |
| `t` | a UTC instant. All storage is `timestamptz`. All *calendar* logic (day-type, hour-of-day, day boundaries, validation windows) is in the city's IANA tz (`cities.tz`, Toronto = `America/Toronto`). |
| `b_s(t)` | `num_bikes_available` for `s` as-of `t` (see §1.3 for "as-of") |
| `d_s(t)` | `num_docks_available` for `s` as-of `t` |
| `C_s(t)` | **effective capacity** `= b_s(t) + d_s(t)`. NOT the static GBFS `capacity` field (which ignores disabled docks). |
| `t0` | forecast origin (the instant the forecast is made / the "current" state used) |
| `h` | horizon in minutes, `h ∈ H = {15, 30, 45, 60, 90, 120}` |
| `Y^bike_{s,t0,h}` | `1[ b_s(t0+h) ≥ 1 ]` |
| `Y^dock_{s,t0,h}` | `1[ d_s(t0+h) ≥ 1 ]` |
| `Y^cnt_{s,t0,h}` | `b_s(t0+h)` (integer count) |
| `p̂^bike, p̂^dock` | predicted probabilities in `[0,1]` |
| `ŷ^cnt` | predicted expected count, real-valued, clipped to `[0, C_s(t0)]` |
| tier | one of `persistence`, `bd` (birth–death baseline), `gbm` (LightGBM) |
| day-type `k` | `WD` (Mon–Fri non-holiday), `SAT`, `SUN` (Sunday **or** Ontario statutory holiday). Holidays from `holidays.CA(subdiv="ON")`. |
| bucket `j` | 15-minute-of-local-day index `j ∈ {0..95}`, `j = floor(local_minute_of_day / 15)` |

**Invariant L0 (no leakage):** every quantity used to produce a forecast for
origin `t0` must be computable from rows with `observed_at ≤ t0` (snapshots,
poll log, weather forecasts *fetched* at or before `t0`, and profile tables
built strictly from prior days). The training feature builder and the online
feature builder are **the same function** (`features.build_features`) so this
holds by construction; a unit test enforces it (§8).

---------------------------------------------------------------------------

## 1. Data the models see

### 1.1 Station snapshots (change-only) + poll log

Collector polls `station_status.json` every 60 s per city.

- Table `station_snapshots(station_id, ts, bikes, docks, ebikes, is_installed,
  is_renting, is_returning, last_reported)`; `ts` = collector poll instant.
  A row is written only if any of the fields (except `ts`) differs from the
  last row written for that station in this process's memory (or on cold start,
  from the DB's latest row). Partitioned by month on `ts`.
- Table `poll_log(city_id, polled_at, feed, ok, n_items, latency_ms, error)` — one
  row per poll attempt per feed, success or failure. This is what makes change-only storage
  unambiguous: absence of a row means "no change" only if a successful poll
  exists in the window.

### 1.2 Freshness

A station's snapshot as-of `τ` is **fresh** iff:
1. `∃ poll_log row with city_id = station's city, ok = true, polled_at ∈ [τ − 90s, τ]`, and
2. the as-of row has `is_installed = true`, `is_renting = true`, `is_returning = true`, and
3. `τ − last_reported ≤ 10 min` (GBFS's own staleness marker).

Non-fresh states are never used as `t0` state, never used as labels, and
produce `NULL` forecasts (with `reason`).

### 1.3 As-of / gridding (the one primitive everything uses)

For a station and a time range, build a **1-minute grid** in UTC:
`grid[m] = last snapshot row with ts ≤ m` (forward fill), then set
`grid[m] = NaN` wherever freshness (§1.2) fails at `m`.
Implemented once in `features.station_grid(station_id, t_start, t_end)`
(pandas: `reindex(..., method="ffill")` on the 1-min index, then mask).
`b_s(τ)`, `d_s(τ)` for arbitrary `τ` = grid value at `floor(τ to minute)`.

### 1.4 Weather

Open-Meteo, per city centroid, stored as *fetched forecasts* so train == serve:

- `weather_forecasts(city_id, fetched_at, valid_hour, temp_c, precip_mm,
  precip_prob, wind_kmh, weather_code)`; fetched every 30 min, hourly
  resolution, next 72 h (`forecast_days=3`).
- **Weather as-of `t0` for hour `H`** = the row with the greatest `fetched_at ≤ t0`
  having `valid_hour = H`. Missing → NaN.
- Historical (for fitting the weather multiplier only, §2.2): Open-Meteo
  Archive API hourly `temperature_2m, precipitation, wind_speed_10m` over the
  trip-history window → `weather_history(city_id, hour, temp_c, precip_mm, wind_kmh)`.

### 1.5 Trip history (bootstrap only)

Toronto Open Data "Bike Share Toronto Ridership Data" (CKAN package
`bike-share-toronto-ridership-data`). **Window: 2025-04-01 → 2026-03-31 local**
(files `bikeshare-ridership-2025.zip` → `bikeshare_2025_04.csv … bikeshare_2025_12.csv`,
and `bikeshare-ridership-2026.zip` → `bikeshare-ridership-2026.csv`, which
covers Jan–Mar 2026). Probed 2026-08-17; header is identical across all files:

`Trip_Id,Trip_Duration,Start_Station_Id,Start_Time,Start_Station_Name,End_Station_Id,End_Time,End_Station_Name,Bike_Id,User_Type,Bike_Model`

Parsing rules (normative):
- Timestamps are local (`America/Toronto`) in the form `YYYY-MM-DD HH:MM:SS`.
- Station ids may be rendered as `"7037"` or `"7037.0"`: parse `float → int → str`.
- Drop rows where either station id or either timestamp is empty/unparseable
  (~0.1 % of rows), where `end_ts < start_ts`, or where duration > 24 h.
- Streaming aggregation only (files are up to 160 MB each; never load a whole
  year in memory). Nothing row-level is persisted; only the aggregates
  `trip_bucket_counts(station_id, day_type, bucket, n_start, n_end)`,
  `trip_station_span(station_id, first_seen_date, last_seen_date)` and
  `system_hourly_trips(city_id, hour_local, n_start)`.
- ~93–98 % of CSV station ids exist in the live GBFS feed; ids in the CSV but
  not in GBFS are aggregated anyway (harmless); GBFS stations absent from the
  CSV get the fallback rates (§2.1).

---------------------------------------------------------------------------

## 2. Tier `bd`: finite-capacity birth–death baseline

Purpose: an explainable, parameter-light model that (a) works on day one from
trip history alone, (b) is the bar every learned model must beat, and (c) is a
stacking feature for the GBM.

### 2.1 Rates from trip history

For each station `s`, day-type `k`, bucket `j`:

- `n_out(s,k,j)` = number of trips with `start_station_id = s` whose local
  start time falls in bucket `j` on a day of type `k`.
- `n_in(s,k,j)` = same for `end_station_id`, using local end time.
- `N_k(s)` = number of days of type `k` in `[first_seen_s, last_seen_s]`
  (first/last calendar day the station appears in the trip data as start or
  end). If `N_k(s) = 0` the station has no data → fallback (below).
- Raw rate (trips per 15-min bucket per day):
  `r_out(s,k,j) = n_out(s,k,j) / N_k(s)`, same for `r_in`.
- **Smoothing** (in this order):
  1. Circular kernel over `j` with weights `[0.25, 0.5, 0.25]`
     (`j−1, j, j+1` mod 96).
  2. Shrinkage toward the station×day-type mean:
     `μ(s,k) = Σ_j n(s,k,j) / (96 · N_k(s))`,
     `λ(s,k,j) = (N_k(s)·r_smooth(s,k,j) + β·μ(s,k)) / (N_k(s) + β)`, `β = 5`.
- **Fallback for stations absent from trip data** (new stations):
  `λ(s,k,j) = median over stations s' with data of λ(s',k,j)`.
- Convert to per-minute: `λ_min = λ / 15`.
- Stored in `station_flow_rates(station_id, day_type, bucket, lam_in_per_min,
  lam_out_per_min, source ∈ {'trips','fallback'}, fitted_at)`.

### 2.2 Weather multiplier `m(w)`

Fit a Poisson GLM on **hourly system-wide** trip starts over the trip-history
window, joined to `weather_history`:

`log E[T_hour] = α_{k(hour), hod(hour)} + β_temp[bin_T(temp)] + β_prec[bin_P(precip)]`

- Day-type × hour-of-day fixed effects (`3 × 24 = 72` levels; one-hot).
- Temperature bins (°C): `(-∞,0), [0,10), [10,20), [20,30), [30,∞)`; reference `[10,20)`.
- Precip bins (mm/h): `[0,0.1), [0.1,1), [1,3), [3,∞)`; reference `[0,0.1)`.
- Fitted with `statsmodels.GLM(family=Poisson())`; L2 not required.
- Raw multiplier `m_raw(w) = exp(β_temp[bin_T] + β_prec[bin_P])`.
- **Normalization (required):** the rates λ in §2.1 already average over the
  window's weather mix, so `m` must be mean-one over that mix:
  `Z = (1/N_hours) Σ_hours m_raw(w_hour)` over all hours in the window;
  `m(w) = m_raw(w) / Z`.
- Clip `m(w)` to `[0.1, 3.0]`. Missing weather → `m = 1`.
- Stored in `weather_multipliers(city_id, temp_bin, precip_bin, m, fitted_at)`
  (20 rows per city).

### 2.3 Forecast: transient distribution of a birth–death chain

At origin `t0` for station `s`:

- Initial state `n0 = b_s(t0)`, capacity `C = C_s(t0)`. If `C = 0` or state not
  fresh → no forecast.
- State space `n ∈ {0,…,C}` (bikes at station). Generator `Q` (size `(C+1)²`):
  - `Q[n, n+1] = λ_in·m` for `n < C` (arrival, needs a dock)
  - `Q[n, n−1] = λ_out·m` for `n > 0` (departure, needs a bike)
  - `Q[n, n] = −(row sum)`
- Rates are piecewise-constant over the sub-intervals obtained by splitting
  `(t0, t0+120min]` at every 15-min bucket boundary (local time) and every
  hourly weather boundary. For a sub-interval of length `Δ` minutes with
  bucket `j`, day-type `k` (of the sub-interval's local date), and weather
  `w` (as-of `t0`, for the hour containing the sub-interval start):
  `P_Δ = expm(Q(λ_in(s,k,j)·m(w), λ_out(s,k,j)·m(w)) · Δ)` via `scipy.linalg.expm`.
- Distribution propagation: `p ← p · P_Δ` (row vector), starting from
  `p = e_{n0}`; whenever the running elapsed time hits an `h ∈ H`, record
  `p_h`. Renormalize `p` to sum 1 after each step (guards float drift).
- Outputs at each `h`:
  - `p̂^bike_bd = 1 − p_h[0]`
  - `p̂^dock_bd = 1 − p_h[C]`
  - `ŷ^cnt_bd = Σ_n n · p_h[n]`
  - also `A_h = Σ λ_in·m·Δ`, `D_h = Σ λ_out·m·Δ` (expected arrivals /
    departures, unbounded) — used as GBM features.

Complexity: ≤ 8 bucket segments + ≤ 3 hour boundaries → ≤ ~11 `expm`s of size
≤ ~80² per station per cycle; ~900 stations → a few seconds. Acceptable.

Rebalancing (operator van moves) is **not** modelled by `bd`; that is a known
source of residual the GBM is expected to partially learn (features §3.2).

### 2.4 Calibration of `bd` (once ≥ 14 days of snapshots exist)

Poisson dynamics are over-confident (real counts are over-dispersed). Once
data exists, `bd` probabilities are passed through an isotonic regression
fitted per `(target, h)` on the calibration window `[T−21d, T−7d)` (§5.1).
Uncalibrated `bd` is served before that. Both `bd_raw` and `bd_cal` are scored.

---------------------------------------------------------------------------

## 3. Tier `gbm`: pooled LightGBM models

Three models, pooled across stations and horizons (`h` is a feature):

| Model | Objective | Target | Output post-processing |
|---|---|---|---|
| `M_bike` | `binary` | `Y^bike` | isotonic calibrator (§5.3) |
| `M_dock` | `binary` | `Y^dock` | isotonic calibrator |
| `M_cnt`  | `regression` (L2) | `Y^cnt` | clip to `[0, C_s(t0)]` |

### 3.1 Row universe

A row is `(s, t0, h)`. Origins `t0` are on the **15-minute UTC grid**
(`minute % 15 == 0`) for training/eval; the live predictor runs every 5 min
and stores history only for 15-min-grid origins, so online and offline
scoring populations coincide.

A row is **valid** iff: state at `t0` fresh and `C_s(t0) ≥ 1`; state at `t0+h`
fresh (label defined); `bd` produced a forecast for it.

### 3.2 Features (exact list; order fixed; NaN allowed)

State (at `t0`):
1. `bikes0 = b_s(t0)`  2. `docks0 = d_s(t0)`  3. `cap0 = C_s(t0)`
4. `fill0 = bikes0 / cap0`
5–8. `dbikes_5, dbikes_15, dbikes_30, dbikes_60` = `bikes0 − b_s(t0−k min)` (NaN if not fresh then)
9. `ebikes0`

Time:
10. `mod = local minute of day` (0..1439)  11. `mod_sin, 12. mod_cos` (2π·mod/1440)
13. `dow` (0=Mon..6, categorical)  14. `is_holiday` (0/1)  15. `daytype` (0=WD,1=SAT,2=SUN, categorical)
16. `h` (minutes)

Station:
17. `station_pk` (`stations.id`, LightGBM categorical)
18. `lat` 19. `lon` 20. `cap_static` (GBFS `capacity`, NaN if absent)

Baseline stacking (from §2.3 for the same `(s,t0,h)`):
21. `bd_p_bike` 22. `bd_p_dock` 23. `bd_exp_cnt` 24. `bd_A` 25. `bd_D`
26. `lam_in_now`, 27. `lam_out_now` (per-minute rates for the current bucket)
**Source rule:** online, these come from the `bd` computation of the same
cycle; offline (training), they are read from `forecast_history` rows with
`tier='bd_raw'` (columns `p_bike, p_dock, exp_bikes, bd_a, bd_d, lam_in,
lam_out`) — never recomputed. Hence the training universe is exactly
`forecast_history(bd_raw) ⋈ forecast_labels`, which guarantees the offline
population equals the online one and the stacking features are the very values
that were served. Consequence: training requires predictor history (≥ 14 days).

Weather (as-of `t0`, §1.4):
28–31. `temp_now, precip_now, wind_now, code_now` (hour containing `t0`)
32–34. `temp_h, precip_h, precip_prob_h` (hour containing `t0+h`)

Neighbourhood (3 nearest stations by PostGIS distance, precomputed table
`station_neighbors(station_id, neighbor_id, rank)`):
35. `nn3_mean_fill` (mean of fresh neighbours' fill at `t0`; NaN if none fresh)
36. `nn3_mean_dfill_15` (mean of neighbours' `fill(t0) − fill(t0−15)`)

Recent climatology (28-day rolling profile keyed by `(station_pk, day_type,
bucket)` **evaluated at `t0+h`**; online it is read from `station_tod_profile`
(rebuilt nightly, valid for the local day `built_for`); offline it is
recomputed day-by-day by `RollingProfile` from snapshots strictly before the
row's local date, so it is L0-safe by construction):
37. `clim_fill` (mean fill)  38. `clim_p_bike`  39. `clim_p_dock`

Total 39 features. `feature_schema_version = 1`. Any change bumps the version
and forces retraining; the predictor refuses to run a model whose schema
version ≠ its code's.

### 3.3 Training set

- Window: `[T − 60d, T)` where `T` = today 00:00 **local**, clipped to when data
  starts. Minimum: 14 days of valid rows or training aborts (`status='insufficient_data'`).
- Splits (all boundaries local midnight):
  - `train = [start, T−9d)`
  - `es    = [T−9d, T−7d)` — early stopping **and** GBM calibration
  - `val   = [T−7d, T)`    — gate + reported metrics; **never** used for fitting anything
- Row caps (memory on a 4 GB host): `train` → at most 3,000,000 rows,
  `es` → at most 1,000,000, `val` → at most 2,000,000; each uniformly
  subsampled with `numpy.random.default_rng(42)` when exceeded. The `val`
  subsample is drawn **once per run** and every tier (persistence, bd_raw,
  bd_cal, active gbm, candidate) is scored on exactly those rows.
- Class balance: no reweighting (we want calibrated probabilities).

### 3.4 Hyperparameters (fixed; no search in v1)

```
objective: binary | regression      num_leaves: 63        learning_rate: 0.05
min_data_in_leaf: 200                feature_fraction: 0.8 bagging_fraction: 0.8
bagging_freq: 1                      lambda_l2: 1.0        max_bin: 255
num_boost_round: 3000 with early_stopping_rounds: 50 on `es`
  (metric: binary_logloss for M_bike/M_dock, l2 for M_cnt)
seed: 42, deterministic: true, force_row_wise: true (needed for bit-identical retrains), num_threads: 2, verbosity: -1
categorical_feature: [dow, daytype, station_id]
```

### 3.5 Artifact

A single pickled bundle stored in `model_versions.artifact` (bytea):
`{feature_schema_version, feature_names, boosters: {bike, dock, cnt} (as
model_to_string), calibrators: {bike: {h: IsotonicRegression}, dock: {...}},
train_window, git_sha, hyperparams, metrics_val (JSON), created_at}`.

---------------------------------------------------------------------------

## 4. Tier `persistence` (naive)

`p̂^bike = 1[bikes0 ≥ 1]`, `p̂^dock = 1[docks0 ≥ 1]`, `ŷ^cnt = bikes0`.
Never stored; recomputed at scoring time from snapshots.

---------------------------------------------------------------------------

## 5. Calibration, metrics, gate

### 5.1 Calibration windows
- `bd`: isotonic per `(target,h)` fitted on `[T−21d, T−7d)` (14 days), if that
  window has ≥ 50,000 valid rows per target; else uncalibrated. **A `bd`
  `model_versions` row is written on every trainer run** (status `active`,
  superseding the previous bd version); when uncalibrated its artifact has
  `calibrators = {}` and the served tier is `bd_raw`. Baseline eval rows
  (persistence, bd_raw, bd_cal) attach to that run's bd version.
- `gbm`: isotonic per `(target,h)` fitted on `es` predictions.
- Isotonic: `sklearn.isotonic.IsotonicRegression(y_min=0, y_max=1,
  out_of_bounds="clip", increasing=True)`.

### 5.2 Metrics (computed on `val`, on the identical row set for all tiers)

Probabilistic (per target, per `h`, and pooled over `h`):
- Brier `= mean((p̂ − y)²)`
- log loss with `p̂` clipped to `[1e-6, 1−1e-6]`
- AUC (`sklearn.metrics.roc_auc_score`; NaN if single class)
- ECE: 10 equal-width bins on `p̂`; `ECE = Σ_b (n_b/N)·|mean_pred_b − frac_pos_b|`
- reliability table `(bin, n, mean_pred, frac_pos)`
Regression (per `h`, pooled): MAE, RMSE.

Slices: `all`; `at_risk` = `bikes0 ≤ 3` for the bike and cnt targets,
`docks0 ≤ 3` for the dock target (stored under slice name `at_risk`).

### 5.3 Promotion gate (candidate → `active`)

Let `B(t, tier)` = pooled Brier over `val`, slice `all`, target `t`.
Reference `ref` = `bd_cal` if it exists else `bd_raw`.
Candidate `cand` is promoted iff **all** hold:
1. `B(bike, cand) ≤ 0.95 · B(bike, ref)` and `B(dock, cand) ≤ 0.95 · B(dock, ref)`
2. `ECE(bike, cand) ≤ 0.05` and `ECE(dock, cand) ≤ 0.05` (pooled over `h`)
3. `MAE(cand) ≤ MAE(ref)` (pooled)
4. If an `active` GBM exists, re-score it on the same `val` rows;
   `B(t, cand) ≤ B(t, active)` for both targets.

Else the candidate is stored with `status='shadow'` (single shadow slot: it
replaces the previous shadow). Every run writes `model_versions` +
`model_eval(model_version_id, tier, split='val', target, horizon, slice, metric,
value)` regardless of outcome (`tier` in the key since migration 0002: a gbm
version stores its own rows as `tier='gbm'`; `persistence`/`bd_raw`/`bd_cal`
rows are stored on the run's bd version). `model_versions.metrics_val` (JSON) has the
`MetricsVal` shape and `model_versions.gate` the `Gate` shape defined in
`api.md §4`; the check names are fixed: `brier_bike_vs_ref, brier_dock_vs_ref,
ece_bike, ece_dock, mae_vs_ref, brier_bike_vs_active, brier_dock_vs_active`
(the last two present only when an active GBM exists). Reliability bins are
written to `model_eval` and `model_metrics_daily` as metrics
`rel_bin_<b>_mean_pred`, `rel_bin_<b>_frac_pos`, `rel_bin_<b>_n` for `b ∈ 0..9`
at `horizon = 0`.

### 5.4 Continuous (online) scoring

`forecast_history` stores, for every 15-min-grid origin, one row per tier
∈ {`bd_raw`, `bd_cal` (when a calibrator exists), `gbm_active`, `gbm_shadow`}
per `(s,h)`; GBM rows hold calibrated probabilities. Nightly, labels
for origins whose `t0+h` has passed are materialised
(`forecast_labels`), and rolling 1-day and 7-day metrics per tier/target/h/slice
are written to `model_metrics_daily`. `persistence` is computed on the fly
from the same rows. This table powers the public `/model` page and the
"is the champion degrading?" check (alert if 7-day Brier of `gbm_active` >
`bd_cal` for 3 consecutive days).

---------------------------------------------------------------------------

## 6. Serving

Predictor loop (every 5 min, `t0 = floor(now, 5 min)`):
1. Load fresh state for all stations of the city (§1.2), latest weather, rates.
2. Compute `bd` for all `(s,h)`; build features; run `gbm_active` (+ shadow) if present; calibrate.
3. **Serving tier** `= gbm_active if present else bd_cal if present else bd_raw`.
4. Upsert `forecasts_latest(station_id, h, p_bike, p_dock, exp_cnt,
   model_version_id, tier, t0, valid_at)`. Stations without a fresh state get
   `p_* = NULL, reason`.
5. If `t0.minute % 15 == 0`, insert all tiers into `forecast_history`.
6. Reload `model_versions` where `status='active'` if changed since last cycle.

API-side interpolation for a user's arbitrary lead time `ℓ` minutes:
linear in probability between the two bracketing `h ∈ H`; `ℓ < 15` → use `h=15`;
`ℓ > 120` → no forecast (`available_at = departure − 120min`), UI falls back to
`clim_p_*` labelled as "typical".

---------------------------------------------------------------------------

## 7. Trainer job (nightly, 03:30 local)

1. Rebuild `station_neighbors`.
2. Materialise `forecast_labels` for all `forecast_history` origins whose
   `t0+h` has passed and that have no label yet.
3. Rebuild `station_tod_profile` (last 28 days) for the coming local day.
4. Refit `bd` calibrators (§5.1) → new `model_versions(tier='bd')` row (always).
5. Build rows (`forecast_history(bd_raw) ⋈ forecast_labels` + features) for
   `[T−60d, T)`; if fewer than 14 local days have rows → write
   `model_versions(tier='gbm', status='insufficient_data')` and skip to 7.
6. Train `M_bike, M_dock, M_cnt`; fit calibrators on `es`; score all tiers on
   the same `val` rows; re-score `active` gbm; apply gate; write
   `model_versions`, `model_eval`.
7. Compute `model_metrics_daily` (§5.4) for windows 1 and 7 days.
8. Housekeeping: delete `weather_forecasts` with `fetched_at < now() − 120 days`.
9. Log a one-line summary; ping healthchecks.io (success only).

Idempotent per local date (unique `(tier, trained_for_date)`).

---------------------------------------------------------------------------

## 8. Required tests (the "if the math is wrong, everything is wrong" list)

Birth–death:
- T1 `λ_in = λ_out = 0` ⇒ `p_h = e_{n0}` for all `h`.
- T2 mass conservation `|Σ p_h − 1| < 1e-9`.
- T3 unbounded regime (`C=200`, small rates, `h=15`): `E[n] ≈ n0 + (λ_in−λ_out)·h·m` within 1e-3.
- T4 Monte-Carlo agreement: simulate the chain (Gillespie) 20,000 paths for a
  random `(C=20, n0=7, rates)`; `|p̂_bd − p̂_MC| < 0.02` for both targets at `h=60`.
- T5 boundary: `n0 = C` ⇒ `p̂^dock < 1`; `n0 = 0` ⇒ `p̂^bike < 1` when rates > 0.

Rates & weather:
- T6 synthetic trips at known rates ⇒ recovered `λ` within 5% (before shrinkage) and shrinkage moves toward `μ`.
- T7 `mean_over_window(m(w)) == 1 ± 1e-6`.
- T8 holiday ⇒ day-type `SUN`.

Grid/labels:
- T9 gap in `poll_log` ⇒ grid NaN inside gap, ffill resumes after next ok poll.
- T10 `last_reported` stale ⇒ NaN.
- T11 change-only reconstruction equals dense reconstruction on a synthetic series.

Features (L0):
- T12 perturbing any snapshot/weather row with `ts > t0` leaves `build_features(t0)` unchanged.
- T13 golden row: offline builder == online builder on a fixture (exact equality per feature).
- T14 feature order/name list matches `feature_schema_version` manifest.

Metrics/gate/calibration:
- T15 perfect predictions ⇒ Brier 0, ECE 0; constant 0.5 ⇒ Brier 0.25 on balanced synthetic.
- T16 isotonic output monotone, clipped for out-of-range.
- T17 gate truth table (each condition individually failing ⇒ `shadow`).
- T18 interpolation: `ℓ` on grid returns exact; midpoint returns mean.

---------------------------------------------------------------------------

## 9. Known limitations (documented, not hidden)

- Rebalancing is unmodelled in `bd`; partially learned by `gbm`.
- Trip-history rates are annual averages; the multiplier only corrects for
  weather, not for secular ridership growth. (Future: rescale λ by observed
  recent flow.)
- Poisson over-dispersion is handled by post-hoc calibration, not by the process model.
- Special events (parades, closures) will be wrong; that is inherent.

## 10. Open planning tasks before implementation spec

- P-1 DONE (2026-08-17): CSV format pinned above. GBFS: Toronto's catalogue URL is
  **v3.0** (`num_vehicles_available`, `num_docks_available`, boolean flags,
  RFC3339 `last_reported`, ttl 1 s, 1,058 stations, capacity 4–87 ⇒ birth–death
  matrices ≤ 88×88; 422/1058 stations have `bikes+docks ≠ capacity`, confirming
  the effective-capacity rule). E-bikes = sum of `vehicle_types_available[].count`
  whose `vehicle_type_id` maps to `propulsion_type ∈ {electric, electric_assist}`
  in `vehicle_types`; NULL if the feed lacks it. Fixtures in `/fixtures/gbfs`.
- P-2 DONE: Open-Meteo archive returns hourly `temperature_2m, precipitation,
  wind_speed_10m` for the window; forecast returns 72 h hourly incl.
  `precipitation_probability, weather_code`. Fixtures in `/fixtures/weather`.
- P-3 Decided: the map shows probability + expected count only; `bd` q10/q90
  are returned by the station endpoint and drawn as a band on the station page.
