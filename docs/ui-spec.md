# DockCast — Frontend Specification (`apps/web`) v1

Status: PLANNING DRAFT for approval. Normative once approved. Companion docs:
`api.md` (every DTO name below is defined there — do not invent fields),
`architecture.md` (stack pins), `ml-spec.md` §6 (serving/interpolation semantics).
Implementers make **no** design decisions: every token, colour, string, state and
layout is specified here. When something is genuinely unspecified, choose the
plainest option that matches an existing pattern in this doc and leave a
`// SPEC-GAP:` comment.

---------------------------------------------------------------------------

## 0. Design context & direction

| | |
|---|---|
| **Audience** | (a) daily bike-share commuters in Toronto (phone, outdoors, glancing, one thumb); (b) engineers / hiring managers evaluating the project on desktop, who will go straight to `/model`. |
| **Jobs** | "Will there be a bike when I leave / a dock when I arrive?" → check in <10 s; save a commute and get an alert before leaving; understand and trust the forecast (station page, model page). |
| **Tone** | **Transit wayfinding**: the calm authority of good signage. Warm paper neutrals, one deep "signal" ink, generous type, hairline rules, no cards-in-cards, no glow, no gradients. Light theme is the default; dark theme is a designed equivalent, not an inversion. |
| **Signature** | The **horizon slider** — a single control that recolours the whole city as you drag from *now* to *+2 h*. Everything else is quiet so that this reads. |
| **Never** | Inter/Roboto/system-default typography, purple-blue gradients, glassmorphism, icon-above-every-heading, native dialogs (`alert/confirm/prompt`), modals (use inline panels/sheets), placeholder-only forms, dual-axis charts. |

---------------------------------------------------------------------------

## 1. Stack, tooling, layout

Pinned (see `architecture.md`): React 19, Vite 6, TypeScript `strict`, `react-router@7`
(declarative `<BrowserRouter>`), `@tanstack/react-query@5`, `maplibre-gl@5`,
`recharts@3`, `tailwindcss@4` via `@tailwindcss/vite`, `date-fns@4` + `@date-fns/tz`,
`zod` + DTO schemas from `@dockcast/shared`. Fonts self-hosted through npm:
`@fontsource-variable/bricolage-grotesque`, `@fontsource-variable/instrument-sans`
(no external font/CDN requests anywhere; CSP-safe).

Dev: `vite` on :5173 with proxy `/api` → `http://localhost:3000` (and `/sw.js` served from `public/`). Build output `apps/web/dist` (served by `api`).

```
apps/web/
├── index.html                      # <div id="root">, theme bootstrap inline script (§2.1), <title>DockCast</title>
├── public/
│   ├── sw.js                       # push service worker (§8)
│   ├── favicon.svg                 # the "D" mark on signal ink (§2.6)
│   └── icons/icon-192.png, icon-512.png   # notification icon
├── src/
│   ├── main.tsx                    # createRoot, QueryClientProvider, BrowserRouter, <App/>, SW registration
│   ├── App.tsx                     # <Routes> (§4), <Shell> layout, global toasts, offline banner
│   ├── styles/
│   │   ├── tokens.css              # ALL CSS custom properties (§2) — the only place hex values live
│   │   ├── base.css                # @import "tailwindcss"; @theme mapping tokens → Tailwind; resets; font-face imports
│   │   └── charts.css              # recharts overrides (fonts, hairlines) (§2.5)
│   ├── api/
│   │   ├── client.ts               # fetch wrapper → apiGet/apiPost/apiPatch/apiDelete, ApiError (§7)
│   │   ├── queries.ts              # every useQuery/useMutation hook + query keys (§3)
│   │   └── types.ts                # re-exports of @dockcast/shared DTO types (no local DTOs)
│   ├── lib/
│   │   ├── prob.ts                 # fmtPct, probStep(p) → 0..4, verdictOf(...) mirrors server (display only)
│   │   ├── time.ts                 # city-tz helpers: fmtLocalTime, nextDepart, parseHHMM, minutesBetween
│   │   ├── geo.ts                  # haversineKm, walkMinutes, rideMinutesDefault (mirrors api.md constants)
│   │   ├── constants.ts            # HORIZONS, thresholds, ALT_GOOD_P, copy strings object COPY (§9)
│   │   ├── push.ts                 # subscribeToPush(), unsubscribe(), pushSupportState()
│   │   └── theme.ts                # getTheme/setTheme (localStorage 'dockcast.theme': 'light'|'dark'|'system')
│   ├── components/
│   │   ├── shell/  Header.tsx, Nav.tsx, Footer.tsx, OfflineBanner.tsx, Toasts.tsx (+ useToast), NotFound.tsx
│   │   ├── ui/     Button.tsx, IconButton.tsx, Field.tsx (label+input+error), Select.tsx, Toggle.tsx, Chip.tsx,
│   │   │           Skeleton.tsx, EmptyState.tsx, InlineConfirm.tsx, Sheet.tsx (mobile bottom sheet / desktop side panel),
│   │   │           SegmentedControl.tsx, TimeInput.tsx, DayPicker.tsx, Tabs.tsx, VisuallyHidden.tsx, Icon.tsx (§2.6)
│   │   ├── forecast/ ProbBadge.tsx (p + step colour swatch + label), VerdictChip.tsx, HorizonSlider.tsx,
│   │   │           TargetToggle.tsx (bikes|docks), LegendProb.tsx, ForecastRow.tsx (one horizon), FreshnessNote.tsx
│   │   ├── map/    CityMap.tsx (MapLibre wrapper), StationLayer.tsx (GeoJSON source + circle layer + selection),
│   │   │           StationSearch.tsx, StationPanel.tsx (mini detail on click), MapLegend.tsx, StationListView.tsx (a11y list)
│   │   ├── trip/   TripPlanner.tsx (form), TripResult.tsx (card), TripLeg.tsx, AlternativesList.tsx, ShareButton.tsx,
│   │   │           SaveAsCommuteButton.tsx
│   │   ├── station/ StationHeader.tsx, CurrentState.tsx, ForecastTable.tsx, StationChart.tsx (24 h + forecast),
│   │   │           TypicalDay.tsx (small multiple), NeighborsList.tsx
│   │   ├── commutes/ CommuteList.tsx, CommuteRow.tsx, CommuteForm.tsx, OutlookChip.tsx, PushSetup.tsx
│   │   └── model/  ModelSummary.tsx, BrierChart.tsx, MaeChart.tsx, ReliabilityChart.tsx, VersionsTable.tsx,
│   │               ChartTable.tsx (table-view twin), Explainer.tsx
│   ├── routes/     MapPage.tsx, StationPage.tsx, TripPage.tsx, CommutesPage.tsx, ModelPage.tsx,
│   │               LoginPage.tsx, RegisterPage.tsx, AboutPage.tsx
│   ├── hooks/      useCity.ts (selected city slug in URL ?city= / localStorage), useAuth.ts (me query + login/logout),
│   │               useOnline.ts, useMediaQuery.ts, useDocumentTitle.ts, useTheme.ts
│   └── test/       setup.ts (jsdom, matchMedia/ResizeObserver mocks), fixtures/*.json (TripResponse, StationDetailResponse, ModelResponse, MapResponse), *.test.tsx (§11)
├── vite.config.ts, tsconfig.json, vitest.config.ts, package.json
```

Rules: no default exports except route components; one component per file; no `any`;
no inline hex — only `var(--…)` or Tailwind theme classes derived from tokens; every
user-visible string comes from `lib/constants.ts` `COPY` (so tests can assert on it).

---------------------------------------------------------------------------

## 2. Design system

### 2.1 Theming mechanics
- `index.html` inline script (before CSS): read `localStorage['dockcast.theme']`; if `'light'|'dark'` set `document.documentElement.dataset.theme`; else remove the attribute (system). Prevents flash.
- `tokens.css` defines light values on `:root`; dark values under BOTH
  `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {…} }` and `:root[data-theme="dark"] {…}`.
- `color-scheme: light dark` on `:root`; body always paints `background: var(--bg)`.
- Theme switch: 3-state segmented control in Footer (System / Light / Dark). MapLibre style swaps with theme (§5.1).

### 2.2 Colour tokens (exact values; light → dark)

Neutrals are warm-tinted paper (no pure black/white). Signal ink is a deep blue-slate.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#f7f5f0` | `#141412` | page plane |
| `--surface` | `#fdfcfa` | `#1c1c1a` | panels, sheets, chart surface |
| `--surface-2` | `#f0ede6` | `#262624` | inset areas, table header, skeleton base |
| `--ink` | `#17171a` | `#f4f2ec` | primary text |
| `--ink-2` | `#55544f` | `#c6c4ba` | secondary text |
| `--ink-3` | `#8a8880` | `#8a8880` | muted (axis labels, meta) |
| `--rule` | `#e3e0d8` | `#2e2e2b` | hairlines, gridlines |
| `--rule-strong` | `#c5c2b8` | `#3c3c38` | baselines, input borders |
| `--signal` | `#1c4f8f` | `#6ea6ea` | brand ink: primary buttons, links, active nav, focus ring, selected station ring |
| `--signal-ink` | `#fdfcfa` | `#141412` | text on `--signal` |
| `--signal-wash` | `#e4edf9` | `#1d2c42` | selected row / active chip background |
| `--focus` | `#1c4f8f` | `#6ea6ea` | 2 px outline + 2 px offset |
| `--overlay` | `rgba(23,23,26,.32)` | `rgba(0,0,0,.55)` | sheet backdrop |

Status (fixed, from the dataviz reference palette; **always icon + label, never colour alone**):

| Token | Value (both modes) | Text-on-light variant | Meaning |
|---|---|---|---|
| `--st-good` | `#0ca30c` | text: `#006300` light / `#0ca30c` dark | verdict `good`, "fresh", gate passed |
| `--st-warn` | `#fab219` | text: `--ink` | verdict `risky`, stale-but-usable, shadow |
| `--st-serious` | `#ec835a` | text: `--ink` | not fresh / unavailable |
| `--st-critical` | `#d03b3b` | text: `#a12727` light / `#e66767` dark | verdict `bad`, errors, gate failed |
| Wash rule | `color-mix(in oklab, <status> 14%, var(--surface))` background + 1 px `<status>` hairline border | | chips/banners |

**Probability ordinal ramp** (one hue, five monotone steps — dataviz "ordinal" rule; validated steps of the reference blue ramp). Higher probability = darker/more saturated. Same direction in both themes.

| Step | p range | Light hex (positron basemap / light surface) | Dark hex (dark basemap / dark surface) | Legend label |
|---|---|---|---|---|
| 0 | `p < 0.50` | `#86b6ef` (ramp 250) | `#9ec5f4` (ramp 200) | "Unlikely" |
| 1 | `0.50 ≤ p < 0.70` | `#5598e7` (350) | `#6da7ec` (300) | "Coin flip" |
| 2 | `0.70 ≤ p < 0.85` | `#2a78d6` (450) | `#3987e5` (400) | "Likely" |
| 3 | `0.85 ≤ p < 0.95` | `#1c5cab` (550) | `#256abf` (500) | "Very likely" |
| 4 | `p ≥ 0.95` | `#104281` (650) | `#184f95` (600) | "Near certain" |
| — | unavailable / not fresh / `null` | fill `none`, 1.5 px ring `#8a8880` | same | "No forecast" |

Validated 2026-08-17 with the dataviz `validate_palette.js --ordinal` (light on `#fdfcfa`, dark on `#1c1c1a`): all checks pass. Tokens: `--p0…--p4`, `--p-none`. `probStep(p)` in `lib/prob.ts` implements the thresholds with `p` in `[0,1]`; `null → -1`. Map circles get a 2 px ring in `--map-ring` (`#fdfcfa` light / `#141412` dark) so adjacent circles never touch (marks rule).

Chart series tokens (fixed slot assignment; never re-ordered when a series is missing):

| Token | Entity | Light | Dark | Notes |
|---|---|---|---|---|
| `--s1` | actual bikes (station chart) · `gbm_active` (model charts) | `#2a78d6` | `#3987e5` | slot 1 |
| `--s2` | forecast expected (station chart) · `bd_cal` (model) | `#eb6834` | `#d95926` | slot 2 |
| `--s3` | `persistence` (model) | `#1baf7a` | `#199e70` | slot 3 |
| `--s1-lite` | `gbm_shadow` (model) — same hue family as `gbm_active`, dashed 2 px `4 3` | `#86b6ef` | `#6da7ec` | not a 4th hue: shadow is a *state* of gbm |
| | *(validated all-pairs both modes: worst CVD ΔE 9.2 light / 9.4 dark; `--s3` is 2.75:1 on the light surface → the mandatory legend + table twin are its relief)* | | | |
| `--band` | q10–q90 band | `color-mix(in oklab, var(--s2) 18%, transparent)` | same | |
| `--ref` | capacity line, reliability diagonal | `--ink-3` | `--ink-3` | solid 1 px |

### 2.3 Typography (self-hosted, variable)
- `--font-display: "Bricolage Grotesque Variable", "Instrument Sans Variable", ui-sans-serif, sans-serif` — page titles, station names in headers, hero probability. Weight 600–700, `letter-spacing: -0.01em`, optical size auto.
- `--font-ui: "Instrument Sans Variable", ui-sans-serif, system-ui, sans-serif` — everything else including chart text and all numbers (dataviz: hero figures use the UI sans). `font-variant-numeric: tabular-nums` **only** in tables, forecast rows, axis ticks; proportional elsewhere.
- Scale (fluid): `--fs-xs: .75rem; --fs-sm: .875rem; --fs-md: 1rem; --fs-lg: 1.125rem; --fs-xl: clamp(1.375rem, 1.1rem + 1vw, 1.75rem); --fs-2xl: clamp(1.75rem, 1.2rem + 2vw, 2.5rem); --fs-hero: clamp(2.75rem, 2rem + 4vw, 4.5rem)`. Line-heights: body 1.5, headings 1.15, hero 1.
- Body base 16 px, `--ink`; secondary `--ink-2`; never `--ink-3` for text under 14 px on `--surface-2`.

### 2.4 Space, shape, elevation, motion
- Space scale `--sp-1: 4px … --sp-2: 8 · --sp-3: 12 · --sp-4: 16 · --sp-5: 24 · --sp-6: 32 · --sp-7: 48 · --sp-8: 64`; page gutter `clamp(16px, 4vw, 40px)`; content max-width 1200 px (map page is full-bleed).
- Rhythm rule: within a group use `--sp-2/3`; between groups `--sp-5/6`; between sections `--sp-7/8`. Do not wrap groups in bordered boxes unless they are a Sheet/panel; separate with a hairline `--rule` or space.
- Radii `--r-1: 4px` (inputs, chips), `--r-2: 8px` (buttons, panels), `--r-pill: 999px` (verdict chip, ProbBadge). No larger.
- Elevation: sheets/panels only: `box-shadow: 0 1px 0 var(--rule), 0 8px 24px -12px rgba(23,23,26,.25)`; nothing else has a shadow.
- Motion: `--ease-out: cubic-bezier(.16,1,.3,1)`; durations 120 ms (state), 200 ms (panel), 320 ms (page-enter stagger). Only `transform`/`opacity` animate; map circle recolour uses MapLibre `circle-color-transition {duration:200}`. `@media (prefers-reduced-motion: reduce)` → all durations 0 and no stagger.
- Focus: `:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px }` everywhere; never `outline: none` without replacement.

### 2.5 Charts (recharts) — global rules
- Surface `--surface`; gridlines horizontal only, solid 1 px `--rule`; axis lines `--rule-strong`; tick text `--ink-3` 12 px `--font-ui` tabular; no vertical gridlines; no dashed grid.
- Lines 2 px, `type="monotone"`, `dot={false}`, `activeDot r=5` with 2 px `--surface` stroke; markers on scatter 8 px; areas ≤ 20 % opacity.
- Legend always present for ≥ 2 series (custom `<ChartLegend>` under the chart title, swatch + label, using entity tokens); single series → no legend, the title names it.
- Tooltip: custom component, `--surface` bg, hairline border, tabular numbers, format defined per chart. Hover layer on every chart (`<Tooltip cursor={{stroke:'var(--rule-strong)'}}>`).
- Every chart has a **table-view twin**: `<ChartTable>` toggle ("Table") that renders the same data as a `<table>` (WCAG twin); keyboard users can tab to it.
- Container: `ResponsiveContainer width="100%" height={H}` where `H` includes the x-axis band (`H = plotHeight + 36`); no fixed-height overflow.
- Refetch: hold previous render at `opacity: .6` (`isFetching`) — never re-skeleton.

### 2.6 Iconography & mark
- Icons: inline SVG components in `Icon.tsx` (24 px grid, 1.75 px stroke, `currentColor`): `bike, dock, clock, walk, check, alert, cross, question, search, locate, share, save, bell, bell-off, sun, moon, monitor, chevron, close, external, list, map`. No icon libraries.
- Logo/favicon: a rounded-square in `--signal` with a white "D" whose bowl is a dock outline (simple SVG path; keep under 1 KB).

---------------------------------------------------------------------------

## 3. Data layer (TanStack Query)

`QueryClient` defaults: `staleTime: 10_000`, `retry: 1`, `refetchOnWindowFocus: true`.

| Hook | Endpoint | Key | refetchInterval | Notes |
|---|---|---|---|---|
| `useCities()` | `GET /cities` | `['cities']` | — | staleTime 5 min |
| `useStations(slug)` | `GET /cities/:slug/stations` | `['stations', slug]` | — | staleTime 1 h; feeds search + map statics |
| `useMap(slug)` | `GET /cities/:slug/map` | `['map', slug]` | 30 000 | `keepPreviousData` |
| `useStation(id)` | `GET /stations/:id` | `['station', id]` | 30 000 | |
| `useStationHistory(id, hours)` | `GET /stations/:id/history` | `['station-history', id, hours]` | 60 000 | |
| `useTrip(params)` | `GET /trip?…` | `['trip', origin, dest, departAtMinute, rideMinutes]` | 60 000 (only when result panel open) | `departAtMinute` = ISO truncated to the minute so the key is stable; `enabled` only when origin && dest |
| `useModel(slug)` | `GET /model?city=` | `['model', slug]` | — | staleTime 5 min |
| `useModelVersion(id)` | `GET /model/versions/:id` | `['model-version', id]` | — | |
| `useMe()` | `GET /auth/me` | `['me']` | — | 401 → `null` (not error) |
| `useLogin/useRegister/useLogout` | `POST /auth/*` | — | — | on success `invalidate(['me'])`, `['commutes']` |
| `useCommutes()` | `GET /commutes` | `['commutes']` | 60 000 | `enabled: !!me` |
| `useCreateCommute/useUpdateCommute/useDeleteCommute` | `POST/PATCH/DELETE /commutes` | — | — | optimistic update on delete/patch; invalidate on settle |
| `useVapidKey()` | `GET /push/vapid-public-key` | `['vapid']` | — | staleTime ∞ |
| `useSubscribePush/useUnsubscribePush/useTestPush` | `POST/DELETE /push/subscriptions`, `POST /push/test` | — | — | |
| `useHealth()` | `GET /health` | `['health']` | 60 000 | footer status dot only |

Error handling: `ApiError` (§7) → toasts for mutations (`COPY.errors.generic` unless `code` mapped); queries render inline error states (§4). 401 on a protected page → redirect to `/login?next=<path>`.

---------------------------------------------------------------------------

## 4. Routes & pages

Routes (all client-side, `<BrowserRouter>`): `/`, `/station/:id`, `/trip`, `/commutes` (auth), `/model`, `/login`, `/register`, `/about`, `*` → NotFound.
Auth guard: `<RequireAuth>` wraps `/commutes`; while `useMe` is loading show page skeleton; if `null` redirect to `/login?next=`.
Document titles: `DockCast`, `<Station name> · DockCast`, `Trip check · DockCast`, `My commutes · DockCast`, `Model quality · DockCast`, `Sign in · DockCast`, `Create account · DockCast`, `About · DockCast`, `Not found · DockCast`.

### 4.0 Shell (all pages)
- **Header** (56 px, `--surface`, bottom hairline): left = logo + wordmark "DockCast" (display font 600, links to `/`); centre (desktop) = nav links `Map · Commutes · Model · About` (active = `--signal` text + 2 px underline offset 6 px); right = city name chip (only when >1 city; opens a small popover list — not a modal) and auth: `Sign in` link or the user's email (truncated 24 ch) with a `Sign out` text button. Mobile (<768): nav collapses into a bottom tab bar (Map, Commutes, Model, More→About/Sign in) 56 px, `--surface`, top hairline; header keeps logo + auth.
- **OfflineBanner**: when `navigator.onLine === false` → full-width strip under header, `--st-serious` wash: icon `alert` + "You're offline. Showing the last data we had." Hides on `online`.
- **Toasts**: bottom-centre (mobile: above tab bar), max 3, auto-dismiss 5 s, `role="status"`, ink text on `--surface` with a 3 px left rule in status colour (this is the one place a coloured edge is allowed, because it *is* status) + icon.
- **Footer** (non-map pages): hairline; left "DockCast — forecasts from open GBFS data. No LLMs involved."; right theme segmented control + tiny health dot (`--st-good` if `/health` ok else `--st-critical`) with tooltip "API healthy / API unreachable".
- **NotFound**: display heading "Nothing docked here." body "That page doesn't exist." link "Back to the map".
- Page enter: content fades/rises 8 px, 320 ms, staggered 40 ms across the first 4 blocks (reduced-motion: none).

### 4.1 `/` — Map (the product)

**Purpose**: see the whole city's odds at any horizon; check a trip; jump to a station.

**Data**: `useCities`, `useStations(slug)`, `useMap(slug)`, `useTrip` (when planner active), `useMe` (for Save-as-commute).

**Layout**
- Desktop ≥1024: full-bleed map under the header (height `100dvh − 56px`). Left floating column (360 px, `--sp-4` from edges): **Control panel** = Sheet (docked, no backdrop) containing top→bottom: `StationSearch`, `TargetToggle` + `HorizonSlider`, and either `StationPanel` (when a station is selected) or `TripPlanner`. Bottom-right: `MapLegend` + zoom/locate controls (MapLibre `NavigationControl` restyled + `GeolocateControl`). Bottom-left: attribution (required by OpenFreeMap/OSM: "© OpenFreeMap © OpenMapTiles Data from OpenStreetMap").
- Tablet 768–1023: same but panel width 320 px.
- Mobile <768: map fills viewport minus header and tab bar; **bottom sheet** with three snap points (peek 96 px = search + slider; half 50 %; full 92 %); slider stays visible at peek. Legend collapses to a single "Legend" chip that expands.

**Map (`CityMap` + `StationLayer`)**
- Style URL: light `https://tiles.openfreemap.org/styles/positron`, dark `https://tiles.openfreemap.org/styles/dark` (swap via `map.setStyle` on theme change; re-add sources/layers on `style.load`). Initial view: city `lat/lon`, zoom 12.5, maxZoom 18, minZoom 10. `attributionControl: {compact: true}`.
- Source: GeoJSON `FeatureCollection` built from `stations` ⋈ `map.stations` by `id`; properties `{ id, name, b, d, c, fresh, p: number|-1, exp: number|null }` where `p` = value for the selected target at the selected horizon (see slider). Rebuild the source data (`source.setData`) on every change of target/horizon/map refetch — do NOT recreate layers.
- Circle layer `stations`: `circle-radius` by zoom `["interpolate",["linear"],["zoom"],10,3,13,6,16,10]`; `circle-color` `["match",["get","step"],0,var(--p0),1,var(--p1),2,var(--p2),3,var(--p3),4,var(--p4), "transparent"]` (resolve CSS vars in JS from `getComputedStyle` at style load and on theme change); `circle-stroke-width` 2 (ring `--map-ring`), for `step=-1` stroke 1.5 `--p-none` and `circle-color` transparent; selected station: extra layer `stations-selected` (filter by id) with radius +4 and stroke 3 `--signal`.
- Symbol layer `stations-labels` (zoom ≥ 15): station name, `--font-ui` 11 px, `--ink-2` halo `--surface` 1.2 px, `text-optional`.
- Cursor pointer on hover; hover tooltip (HTML div, not MapLibre popup): `<name>` + `"<b> bikes · <d> docks"` + (`step≥0` ? `"<pct> chance of a <bike|dock> at <horizonLabel>"` : `"No forecast"`). Click → select (URL `?station=<id>` search param; deep-linkable) → `StationPanel`. `Esc` or panel close → deselect.
- Fit: on city change `fitBounds` of stations with padding `{top:24,left: panelWidth+24,…}` on desktop.

**`TargetToggle`** (SegmentedControl, `role="radiogroup"`): `Bikes` (icon bike) | `Docks` (icon dock). Copy under it changes: "Chance of finding a **bike**" / "Chance of finding an **empty dock**". Persist in `?target=bikes|docks` (default bikes).

**`HorizonSlider`**: `<input type="range" min=0 max=6 step=1>` mapped to stops `[now,15,30,45,60,90,120]`; visible tick labels `Now · 15m · 30m · 45m · 1h · 1h30 · 2h`; large value readout on the left in display font: `Now` | `In 45 min` | `In 1 h 30`; and the absolute local time under it (`h:mm a`, city tz): `"= 8:41 AM"`. Keyboard: arrows/Home/End; `aria-valuetext` = readout. Track: `--rule-strong` with filled portion `--signal`; thumb 20 px `--surface` with 2 px `--signal` ring. Persist in `?h=<index>`. Semantics: index 0 (**now**) → `p = b ≥ 1 ? 1 : 0` (bikes) / `d ≥ 1 ? 1 : 0` (docks) for fresh stations, `-1` if `!fresh`; index k≥1 → `f[k-1]` entry: `null → -1`, else `p_bike`/`p_dock`. When `map.t0` is older than 15 min, show `FreshnessNote` inline under slider: icon `alert` + "Forecasts are <n> min old. The predictor may be catching up." (`--st-warn` wash).

**`MapLegend`**: title = "Chance of a bike at <readout>" / "…an empty dock…"; five swatches (filled circles 12 px in `--p0..4`) with the step labels from §2.2 and their ranges (`<50% · 50–70% · 70–85% · 85–95% · ≥95%`); sixth: hollow ring "No forecast"; footer line: `"Updated <relative> · <n> stations"` from `map.as_of`. If the city has `forecasting_enabled=false`: legend switches to "Live availability" with 2 swatches (`--p4` "Has bikes/docks", `--p0` "Empty") + a banner at the top of the panel: "Live data only. No forecasts for <city name> yet." and the slider is disabled at `Now`.

**`StationSearch`**: input with icon `search`, placeholder "Find a station…" (label visually hidden "Search stations"), client-side filter over `stations` (case/diacritic-insensitive `includes` on `name` and `station_id`), listbox of ≤ 8 results (`role="listbox"`, arrow keys), each row `name` + secondary `"<b> bikes · <d> docks"`. Enter/click → select station and `flyTo` zoom 15. Empty query shows nothing; no results → "No station matches “<q>”".

**`StationPanel`** (selected station; replaces planner in the panel; mobile → sheet at half): 
header row: name (display, `--fs-lg`) + close `IconButton` (aria-label "Close station"). Sub: `"<b> bikes · <d> docks · <c> capacity"` and freshness: fresh → `"Live · updated <rel>"` (`--ink-3`) else `--st-serious` chip icon `alert` "Not reporting". Then a 6-row `ForecastRow` list (horizon label, `ProbBadge` for bikes, `ProbBadge` for docks) using `map.stations[id].f` (compact data — no extra fetch); a row with `null` shows "—" and the row is `--ink-3`. Actions: `Button` "Station details →" (`/station/:id`), and two ghost buttons "Trip from here" / "Trip to here" which open `TripPlanner` with that field prefilled (and keep the other). 

**`TripPlanner`** (`<form>` no page reload):
- Fields (each `Field` with visible label): **From** (station combobox: same search widget, value = station; icon bike), **To** (combobox; icon dock), **Leave** = `TimeInput` (`<input type="time">` + a `SegmentedControl` `Now | At…`; default `Now`; when `At…` the time is today in city tz; if that instant is in the past, show helper "That's earlier than now, so we'll use now."), **Ride time** (numeric minutes, auto-filled with `rideMinutesDefault` and helper text "Estimated at 12 km/h" until the user edits; a small "reset" text button restores auto). Swap button (icon with `aria-label="Swap stations"`) between From/To.
- Validation (inline, on submit): both stations required ("Choose a station"); same station → "Pick two different stations"; ride 1–180 → "1–180 minutes".
- Submit `Button` primary "Check my trip"; while fetching → button shows spinner text "Checking…" (disabled). Debounce: rate limit is 60/min/IP — disable the button for 1.5 s after each submit; auto-refresh via `useTrip` 60 s while result is shown.
- Sync form → URL search params `?from=&to=&at=&ride=` (so reload restores). If URL has `from&to` on load, auto-run.
- On success → render `TripResult` **below the form** (form collapses to a one-line summary "From X to Y · leaving 8:15 AM · 14 min ride" with an "Edit" text button; expanding re-shows fields).

**`TripResult`** (also used by `/trip`):
- Top: `VerdictChip` (§2.2 status wash, pill, icon + text): good → icon `check` "Looks good"; risky → icon `alert` "Risky"; bad → icon `cross` "Don't count on it"; unknown → icon `question` "Can't tell yet". Right of it: `"Computed <h:mm a> · forecasts from <h:mm a>"` (`--ink-3`, `computed_at`, `forecast_t0`; if `forecast_t0` null omit second part).
- Two `TripLeg` blocks separated by a hairline, each: eyebrow (`--ink-3`, uppercase 12 px tracking .04em) `LEAVE FROM` / `ARRIVE AT`; station name (display `--fs-lg`, link to `/station/:id`); the hero line: `ProbBadge` large — percent in `--fs-2xl` display + step swatch + step label ("Very likely") + object text: origin → `"a bike at <depart h:mm a>"`, dest → `"an empty dock at <arrive h:mm a>"`; meta line: `"Now: <bikes> bikes · <docks> docks"` (from `current`; if `!is_fresh` append chip "not reporting"), and `"Expected then: ~<round(exp_bikes)> bikes"` (origin) / `"~<max(0, round(cap_eff − exp_bikes))> docks"` — NOTE `cap_eff` = `current.bikes + current.docks`; omit if `current` null.
  - `kind='typical'`: percent shown normally but swatch is hollow (`--p-none`) and label reads `"Typical for this time · forecasts start <MAX_LEAD> min ahead"`; verdict will be `unknown`.
  - `kind='unavailable'`: percent replaced by "—", label `"No forecast right now"` + reason mapping: `not_fresh` → "station isn't reporting", `zero_capacity` → "station has no usable docks", `no_rates` → "no history for this station yet", other/null → "predictor is catching up".
  - `AlternativesList` (only when `p < ALT_GOOD_P` or kind ≠ forecast; else collapsed behind a text button "Other nearby stations"): heading "Nearby with better odds" (origin: "…for a bike"; dest: "…for a dock"); rows: name (link), `"<walk_minutes> min walk · <distance_m> m"`, `ProbBadge` small; rows with `p ≥ ALT_GOOD_P` get a leading `check` icon in `--st-good` text colour + label "Safe bet". Empty → "No nearby stations with a forecast."
- Footer actions: `ShareButton` (ghost, icon share) → `navigator.clipboard.writeText(<origin>/trip?from=&to=&at=&ride=)` → toast "Link copied"; fallback (no clipboard API) shows the URL in a read-only input. `SaveAsCommuteButton` (secondary, icon save): if `me` → navigate `/commutes?new=1&from=&to=&at=HH:MM&ride=` (form prefilled); else → `/login?next=<that url>`. 

**States**: 
- loading (first `useMap`): map renders with skeleton panel (3 skeleton rows) and grey circles (`step=-1`) — no spinner over the map. 
- `useMap` error: panel shows `EmptyState` icon `alert` "Couldn't load live data." + "Retry" button; map stays. 
- zero stations: "No stations found for <city>". 
- Trip error 400 → inline under form: `error.message`; 429 → "Too many checks. Try again in a moment."; other → "Couldn't check that trip. Try again."

### 4.2 `/station/:id` — Station page
**Data**: `useStation(id)` (30 s), `useStationHistory(id, 24)` only if the user opens the 7-day range (`hours=168`).
**Layout**: max-width 1200; desktop grid `minmax(0,1fr) 360px` (main | aside); mobile single column in the order header → current → forecasts → chart → typical → neighbours.
- `StationHeader`: eyebrow `<city name>` (link `/`), h1 station name (display `--fs-2xl`), sub `"<station_id> · capacity <capacity ?? '—'>"`, right: "Show on map" (ghost, `/?station=<id>`).
- `CurrentState`: two big numbers side by side (display `--fs-hero`, proportional figures): `<bikes>` "bikes now" and `<docks>` "empty docks now"; under: `"<ebikes> e-bikes"` (omit if null), freshness line: fresh → `"Live · reported <rel>"`; not fresh → serious chip "Not reporting · last seen <rel>"; `current` null → EmptyState "We haven't seen this station report yet."
- `ForecastTable` (`<table>` tabular): columns `In`, `At`, `Bike`, `Dock`, `Expected bikes`, `Range` ; rows = 6 forecasts: `In` = `15 min…2 h`, `At` = `valid_at` local `h:mm a`; Bike/Dock = `ProbBadge` (pct + swatch); Expected = `round(exp_bikes)`; Range = `q10–q90` (both null → "—"). Row with `p_* null` → cells "—" and a trailing note (`reason` mapping from §4.1). Caption (visually hidden): "Forecast by horizon". Under the table `--ink-3`: `"Model: <tier label>"` where `gbm` → "learned model", `bd_cal` → "calibrated flow model", `bd_raw` → "flow model (uncalibrated)", `none` → "—"; link "How forecasts work →" `/model`.
- `StationChart` (main column, `H = 280 + 36`): x = time (last 24 h → +2 h), y = bikes (0..`max(capacity, cap_eff, max history)`), left axis only. Series: `history` line `--s1` (label "Bikes (actual)"); forecast expected line `--s2` from `(now, current.bikes)` through the 6 `(valid_at, exp_bikes)` points (label "Forecast (expected)"); band `--band` between `q10` and `q90` on the same points; a solid `--ref` horizontal `ReferenceLine` at `capacity` labelled "capacity" (right end, `--ink-3` 11 px); a vertical `ReferenceLine` at `now` (`--rule-strong`) labelled "now". Legend (3 entries: actual, forecast, 10–90 % range). Tooltip: `"<h:mm a>"` then rows `Actual: 7 bikes` / `Forecast: ~5 (3–8)`. Table twin toggle. Ticks every 4 h `h a`. Gaps in `history` render as line breaks (`connectNulls={false}`). Empty history → EmptyState in the chart area "No history yet. The chart fills in as the collector runs."
- `TypicalDay` (aside, small multiple `H = 120 + 36`): x = 96 buckets (ticks at 0/6/12/18 h), two thin lines `p_bike` (`--s1`) and `p_dock` (`--s2`), y 0–1 with ticks 0/50/100 %; title "Typical <Weekday|Saturday|Sunday> here"; caption "Share of the last 4 weeks with ≥1 bike / ≥1 dock, by time of day." Empty → "Not enough history yet."
- `NeighborsList` (aside): heading "Nearest stations"; rows: name (link), `"<distance_m> m"`, `"<bikes> bikes · <docks> docks"` (null → "—"). 
- Error/404: `useStation` 404 → NotFound variant "We don't know that station." with link to map. Loading: skeleton blocks matching layout.

### 4.3 `/trip` — Shareable trip check
Reads `?from&to&at&ride`; renders `TripPlanner` (prefilled, collapsed summary) + `TripResult` centered (max-width 720). Missing/invalid params → the planner expanded with copy "Pick two stations to check a trip." Title "Trip check". Same refetch/interval as the map planner. Below the result: text link "Open on the map" (`/?from=&to=&at=&ride=`).

### 4.4 `/commutes` — My commutes (auth)
**Data**: `useCommutes` (60 s), `useStations(slug)` for the form, `useVapidKey`, mutations.
**Layout**: max-width 880; header row: h1 "My commutes" + primary `Button` "New commute" (icon `save`; on mobile a bottom-right FAB 56 px, `--signal`). Below: `PushSetup` strip, then `CommuteList`.
- **`PushSetup`** (hairline-boxed strip, `--surface`): states via `pushSupportState()`:
  - `unsupported` (no `serviceWorker`/`PushManager`/`Notification`): icon `bell-off` "Alerts need a browser with push notifications (Safari 16.4+, Chrome, Firefox)."
  - `denied`: icon `bell-off` "Notifications are blocked for this site. Allow them in your browser settings to get alerts."
  - `default` (not asked): icon `bell` "Get a push before you leave if the odds drop." + `Button` "Enable alerts" → `Notification.requestPermission()` → if granted: `registration.pushManager.subscribe({userVisibleOnly:true, applicationServerKey: urlBase64ToUint8Array(vapid)})` → `POST /push/subscriptions` `{endpoint, keys, user_agent}` → toast "Alerts on for this device". Errors → toast "Couldn't enable alerts on this device."
  - `subscribed` (permission granted AND `pushManager.getSubscription()` non-null): icon `bell` "Alerts are on for this device." + ghost "Send a test" (`POST /push/test` → toast "Test sent. Check your notifications." or "No devices to send to") + text button "Turn off on this device" (unsubscribe locally + `DELETE /push/subscriptions`).
  - Note under strip (`--ink-3`): "At most one alert per commute per day, sent before you leave and only if the odds fall under your threshold."
- **`CommuteList`**: empty → `EmptyState` (icon `bike`): title "No commutes yet", body "Save your regular ride and we'll tell you before you leave whether there'll be a bike, and a dock at the other end.", primary "New commute". Rows (`CommuteRow`, hairline separated, not cards): name (display `--fs-lg`), route line `"<origin.name> → <dest.name>"`, schedule `"<days> · leaves <h:mm a> · <ride_minutes> min ride"` (days = `Mon–Fri` when exactly 0–4, `Every day` when 7, `Sat, Sun` style otherwise), alerts `"Alerts <on|off> · <lead> min before · under <threshold%>"`; right: `OutlookChip` + overflow actions "Edit" (ghost) and "Delete" (ghost, `--st-critical` text) → `InlineConfirm` replaces the row's action area with "Delete “<name>”? [Delete] [Cancel]" (no native dialog).
- **`OutlookChip`** (from `outlook`): `verdict` → VerdictChip small + text: `next_depart_at` today → `"Next: today <h:mm a>"`, tomorrow → `"Next: tomorrow <h:mm a>"`, else `"Next: <EEE h:mm a>"`; if either leg `kind='typical'` add `"(typical)"`; `null` → "No upcoming departure". Tooltip/expanded line: `"Bike <pct> · Dock <pct>"` (— when null). Clicking the chip → `/trip?from=&to=&at=<next_depart_at>&ride=`.
- **`CommuteForm`** (inline panel that opens under the header on "New commute"/"Edit"; not a modal; `?new=1` opens it): fields exactly `CommuteCreateRequest`: Name (text, 1–60, default "Commute to work" for new), From/To (station combobox as in planner, `origin_station_id`/`dest_station_id`), Leave at (`TimeInput` `HH:MM`, required), Days (`DayPicker`: seven toggle chips `Mo Tu We Th Fr Sa Su`, values 0–6, at least one; quick links "Weekdays" / "Every day"), Ride time (minutes, auto-default from stations, 1–180), Alerts (Toggle `alert_enabled` default on), Alert lead (Select 10/15/20/30/45/60 min, default 20; store as `alert_lead_minutes`), Threshold (Select `50% · 60% · 70% · 80% · 90%`, default 70 → `0.7`; label "Alert me when the odds drop under"). Buttons: primary "Save commute" / "Save changes", ghost "Cancel". Validation messages: name required "Give it a name"; stations "Choose a station" / same → "Pick two different stations"; days "Pick at least one day"; ride "1–180 minutes". Server 400 → show `error.message` at top; commute limit → message from server. Success → toast "Commute saved" and the row highlights (`--signal-wash` fade 1.2 s).
- Loading: 3 skeleton rows. Error: EmptyState "Couldn't load your commutes." + Retry.

### 4.5 `/model` — Model quality (public)
**Data**: `useModel(slug)`; drill-down `useModelVersion(id)` when a version row is expanded.
**Layout**: max-width 1100; sections separated by `--sp-8` and a hairline; left-aligned prose column (max 68 ch) for explainers.
1. **Intro** (h1 "How good are the forecasts?", display) + one paragraph: "Every forecast DockCast shows is scored against what actually happened. This page is generated from those scores. Nothing is hand-picked." 
2. **`ModelSummary`** — a 2×3 fact grid (not cards: label over value, hairline rules between cells): `Serving now` → tier label (§4.2 mapping) ; `Active learned model` → `#<id> · trained for <trained_for_date>` or "none yet (flow model serving)"; `Data since` → `data_since` as `d MMM yyyy` or "—"; `Collector uptime (7 d)` → `<uptime_7d_pct>%` or "—"; `Last forecast run` → relative; `Stations` → `n_stations_active`.
3. **Explainer** ("Three tiers, always compared"): three short definitions — Persistence: "assumes nothing changes"; Flow model (`bd_cal`): "a queue model fed by a year of trip history and the weather"; Learned model (`gbm_active`): "a gradient-boosted model trained on our own snapshots; serves only if it beats the flow model on held-out days"; plus "Shadow" note.
4. **Charts row** (small multiples, one filter row above them — `SegmentedControl` slice `All stations | At-risk stations` and target tabs `Bikes | Docks`, both apply to every chart on the page):
   - `BrierChart` ×1 (for selected target): title "Brier score by horizon (lower is better) · last 7 days"; x = horizon (15…120 as categories `15m…2h`), y = brier (0 → auto max, 2 decimals); series in fixed order/tokens: `gbm_active` (`--s1`), `bd_cal` (`--s2`), `persistence` (`--s3`), `gbm_shadow` (`--s1-lite`, dashed); missing tiers simply absent (never re-coloured). Data = `metrics` rows where `window_days=7 ∧ metric='brier' ∧ target=<sel> ∧ slice=<sel> ∧ horizon≠0`. Legend + direct label at the right end of `gbm_active` and `bd_cal` only. Tooltip: `"<horizon>: gbm 0.062 (n 12,340) · flow 0.081 · persistence 0.104"`. Explainer under: "Brier = mean squared error of the probability. 0 is perfect; predicting 50 % everywhere scores 0.25."
   - `MaeChart` (regression, tiers gbm_active/bd_cal/persistence): title "Expected-count error (MAE, bikes) by horizon · last 7 days"; `metric='mae' ∧ target='cnt'`. Same rules.
   - `ReliabilityChart` (for selected target, `horizon=0`, `slice=<sel>`): title "Calibration · last 7 days"; scatter+line per tier from `metric ∈ rel_bin_<b>_mean_pred / rel_bin_<b>_frac_pos / rel_bin_<b>_n` for `b=0..9`; x = mean predicted (0–1), y = observed frequency (0–1), diagonal `--ref` line labelled "perfect"; markers 8 px with 2 px surface ring; tooltip `"Predicted 72 % → happened 69 % (n 3,210)"`. Explainer: "If we say 80 %, it should happen about 80 % of the time. Points on the line are calibrated. ECE summarises the gap."
   - Below charts a compact stat line per tier (text, not tiles): `"ECE: gbm 0.021 · flow 0.034"` from `metric='ece' ∧ horizon=0`.
   - Every chart has the "Table" twin toggle. If `metrics` is empty → one EmptyState replaces the row: "No scored forecasts yet. Scores appear after the first full day of forecasts."
5. **`VersionsTable`**: columns `#`, `Tier`, `Trained for`, `Status` (chip: active `--st-good` wash + check; shadow `--st-warn` wash; rejected/failed `--st-critical` wash + cross; insufficient_data / superseded neutral), `Val Brier (bike / dock)` from `metrics_val` (`metrics_val.brier?.bike` etc; "—" if absent), `Gate` (badge "passed"/"failed" from `gate.passed`; expand row → list `gate.checks` as `name value vs threshold ✓/✗` and `eval` rows grouped by target/horizon from `useModelVersion`), `Created` relative. Newest first, ≤ 30 rows. Empty → "No model versions yet."
6. **Footnote**: "Metrics are computed nightly over forecasts made at :00/:15/:30/:45 and the state observed at their target time. Definitions: `docs/ml-spec.md`." (link to the repo doc URL from `import.meta.env.VITE_REPO_URL`).
Loading: skeleton grid + chart skeletons. Error: EmptyState "Couldn't load model metrics." + Retry.

### 4.6 `/login`, `/register`
Centered narrow column (max 400), h1 "Sign in" / "Create account", one-sentence sub: "Save commutes and get alerts before you leave." Fields: Email (`type=email`, autocomplete `email`), Password (`type=password`, autocomplete `current-password`/`new-password`, min 10 with helper "At least 10 characters"). Primary button "Sign in" / "Create account"; below: text link "New here? Create an account" / "Have an account? Sign in". Errors inline at top (`--st-critical` wash): 401 → "That email and password don't match."; 409 → "That email is already registered. Sign in instead." (link); 429 → "Too many attempts. Try again in a few minutes."; other → generic. Success → navigate to `?next` or `/commutes`. If already signed in → redirect to `/commutes`.

### 4.7 `/about`
Prose page (max 68 ch), sections with h2s: "What this is" (2 paragraphs), "How the forecast works" (3 short paragraphs: live GBFS state → flow model from a year of trips + weather → learned model that must beat it; link `/model`), "What it's not" ("No large language models are involved anywhere. Forecasts are computed by our own models from open data. They will be wrong for parades, breakdowns and rebalancing vans."), "Data & licences" (list: Bike Share Toronto GBFS via PBSC/Toronto Parking Authority; Toronto Open Data ridership (Open Government Licence – Toronto); Open-Meteo (CC BY 4.0); OpenFreeMap / OpenMapTiles / © OpenStreetMap contributors), "Privacy" ("We store your email, password hash, commutes and push subscriptions. Nothing else. No analytics."), "Source" (repo link).

---------------------------------------------------------------------------

## 5. Component contracts (props are exact)

| Component | Props | Behaviour |
|---|---|---|
| `ProbBadge` | `{ p: number|null; kind?: 'forecast'|'typical'|'unavailable'; size?: 'sm'|'md'|'lg'; label?: boolean }` | renders `fmtPct(p)` ("—" if null), a swatch circle in `--p<step>` (hollow when kind≠forecast or null), optional step label. `sm`: 12 px swatch + `--fs-sm`; `md`: 16 px + `--fs-md`; `lg`: 20 px + `--fs-2xl` display. `aria-label`: "<pct> chance, <step label>". |
| `VerdictChip` | `{ verdict: 'good'|'risky'|'bad'|'unknown'; size?: 'sm'|'md' }` | pill, wash + hairline + icon + text per §4.1. `role="status"`. |
| `HorizonSlider` | `{ value: 0..6; onChange; disabled?; cityTz: string; now: Date }` | as §4.1; readout computed with `now + stops[value]`. |
| `TargetToggle` | `{ value: 'bikes'|'docks'; onChange }` | radiogroup. |
| `SegmentedControl` | `{ options: {value,label,icon?}[]; value; onChange; ariaLabel }` | radiogroup, roving tabindex. |
| `Sheet` | `{ open; onClose; snap?: 'peek'|'half'|'full'; title?; children }` | desktop: docked panel (no backdrop); mobile: bottom sheet with drag handle (`role="dialog"` only when `full`; focus not trapped at peek/half). |
| `InlineConfirm` | `{ message; confirmLabel; onConfirm; onCancel; danger? }` | replaces trigger area; focus moves to Cancel; `Esc` cancels. |
| `EmptyState` | `{ icon; title; body?; action?: {label,onClick} }` | left-aligned, `--sp-6` padding, no border. |
| `Field` | `{ label; hint?; error?; children }` | `<label for>` wiring, `aria-describedby` for hint/error, error text `--st-critical` text colour + icon `alert`. |
| `TimeInput` | `{ value: 'HH:MM'|null; onChange; mode: 'now'|'at'; onModeChange? }` | native `<input type=time>` (24 h value), display copy uses `h:mm a`. |
| `DayPicker` | `{ value: number[]; onChange }` | 7 toggle chips (`aria-pressed`), keyboard arrows. |
| `ChartTable` | `{ columns: {key,label,format?}[]; rows: Record<string,unknown>[]; caption }` | `<table>` twin; toggle button "Table"/"Chart" lives in the chart header. |

`fmtPct(p)`: `Math.round(p*100) + '%'` (p 0.995 → "100%"; p<0.005 → "0%"). Relative time: `date-fns formatDistanceToNowStrict` + " ago" (e.g. "2 min ago"), refresh every 30 s via a shared `useNow(30_000)` hook. Local time formatting always uses `@date-fns/tz` `TZDate` with `city.tz` and format `h:mm a` (times) / `EEE h:mm a` / `d MMM yyyy`.

---------------------------------------------------------------------------

## 6. Responsive rules
| Breakpoint | Map page | Other pages |
|---|---|---|
| `< 768` mobile | bottom sheet (§4.1), tab bar nav, legend chip, hero numbers `--fs-2xl`, one-column | one column, gutter 16 px, tables become stacked definition lists (`ForecastTable`, `VersionsTable` collapse to per-row blocks with label:value), FAB for New commute |
| `768–1023` | docked panel 320 px, top nav | two columns where specified become one until 1024 |
| `≥ 1024` | docked panel 360 px | grids as specified; max-width 1200 |
Container queries (`@container`) size `TripResult` internals (hero percent shrinks below 420 px container). Touch targets ≥ 44 px on all interactive elements; the map's hover tooltip is tap-to-select on touch.

---------------------------------------------------------------------------

## 7. API client (`api/client.ts`)
```ts
export class ApiError extends Error { constructor(public status: number, public code: string, message: string, public details?: unknown) {…} }
async function request<T>(method, path, body?, schema?: ZodType<T>): Promise<T>
```
- `fetch(\`/api/v1${path}\`, { method, credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: JSON.stringify(body) })`.
- Non-2xx: parse `{error}` envelope → `throw new ApiError(status, error.code ?? 'internal_error', error.message ?? 'Request failed', error.details)`; network failure → `ApiError(0, 'network', COPY.errors.network)`.
- 204 → `undefined`. In `import.meta.env.DEV`, `schema.parse(json)` (throws loudly on contract drift); in prod `schema.safeParse` → on failure `console.warn` once and return raw json.
- All hooks live in `queries.ts`; components never call `fetch`.

---------------------------------------------------------------------------

## 8. Service worker (`public/sw.js`, plain JS, no bundler)
```js
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => { const d = e.data ? e.data.json() : {};
  e.waitUntil(self.registration.showNotification(d.title || 'DockCast', { body: d.body || '', tag: d.tag, data: { url: d.url || '/' }, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', renotify: !!d.tag })); });
self.addEventListener('notificationclick', e => { e.notification.close(); const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => { const c = cs.find(x => 'focus' in x); if (c) { c.navigate(url); return c.focus(); } return self.clients.openWindow(url); })); });
```
No caching/precaching. Registration in `main.tsx`: `if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js')` after first paint (`requestIdleCallback` fallback `setTimeout 0`). `lib/push.ts` uses `navigator.serviceWorker.ready`.

---------------------------------------------------------------------------

## 9. Copy (single source: `lib/constants.ts` `COPY`)
All strings quoted in §4 are normative; additionally: `errors.generic` "Something went wrong. Try again."; `errors.network` "Can't reach DockCast. Check your connection."; `auth.required` "Sign in to save commutes."; `map.updated` "Updated {rel} · {n} stations"; `stale.predictor` "Forecasts are {n} min old. The predictor may be catching up."; `legend.title.bikes` "Chance of a bike {when}"; `legend.title.docks` "Chance of an empty dock {when}"; `horizon.now` "Now"; `horizon.in` "In {label}"; verdict labels as §4.1; step labels as §2.2. Sentence case everywhere; no exclamation marks; no "Oops".

---------------------------------------------------------------------------

## 10. Accessibility (must-pass)
- Every page has one `h1`; landmark roles (`header/nav/main/footer`); skip link "Skip to content" first in DOM.
- Map: `StationListView` — a "List" toggle (icon `list`) in the control panel swaps the map for a scrollable table (`name · bikes · docks · P(bike) · P(dock)` at the current horizon) with a filter input; sorted by name; the map canvas gets `aria-hidden` when list is shown; MapLibre canvas has `role="img"` `aria-label="Map of <city> stations coloured by forecast"`. All map interactions have a keyboard path via search/list/panel.
- Colour never alone: `ProbBadge` always shows the number; verdict/status chips always have icon + text; map has legend + list view.
- Contrast: all text ≥ 4.5:1 on its surface (tokens chosen accordingly; `--ink-3` only ≥ 14 px on `--surface`/`--bg`); UI components ≥ 3:1.
- Focus management: opening a Sheet/panel moves focus to its heading; closing returns focus to the trigger; route change moves focus to `h1` (`tabIndex=-1`) and announces via a `role="status"` live region "Navigated to <title>".
- Slider `aria-valuetext`; combobox pattern (`role=combobox` + `listbox` + `aria-activedescendant`); `aria-live="polite"` region for trip result verdict.
- Reduced motion honoured (§2.4). Zoom to 200 % must not break layout; no horizontal scroll at 320 px.

---------------------------------------------------------------------------

## 11. Tests (vitest + @testing-library/react + jsdom)
Setup mocks: `matchMedia`, `ResizeObserver`, `maplibre-gl` (mock module exporting a `Map` class with no-op methods; map components are not unit-tested), `navigator.clipboard`.
| Test file | Asserts |
|---|---|
| `lib/prob.test.ts` | `probStep`: 0.49→0, 0.5→1, 0.69→1, 0.7→2, 0.84→2, 0.85→3, 0.949→3, 0.95→4, 1→4, null→-1; `fmtPct` rounding (0.995→"100%", 0.004→"0%", 0.415→"42%"). |
| `lib/time.test.ts` | `nextDepart` for days/time across tz + DST (fixed `now` in `America/Toronto`); readout labels for slider indices; `parseHHMM`. |
| `lib/geo.test.ts` | `rideMinutesDefault` = `max(5, round(km/12*60+3))` on 2 known station pairs; `walkMinutes` = `ceil(m/80)`. |
| `components/forecast/HorizonSlider.test.tsx` | 7 stops; keyboard ArrowRight increments; `aria-valuetext` "In 45 min"; disabled state. |
| `components/trip/TripResult.test.tsx` | renders fixture `TripResponse` (good): verdict text "Looks good", both percents, alternatives collapsed; fixture (bad, dest unavailable `not_fresh`): "Don't count on it", "station isn't reporting", alternatives expanded with "Safe bet" on p≥0.9; fixture (typical): "Can't tell yet" + typical label; Share click copies URL and toasts "Link copied". |
| `components/commutes/CommuteForm.test.tsx` | submit empty → 4 validation messages; same station → "Pick two different stations"; valid submit calls mutation with exact `CommuteCreateRequest` body (`threshold` 0.7, `days_of_week` [0,1,2,3,4], `depart_local_time` "08:15"). |
| `components/model/BrierChart.test.tsx` | given fixture metrics with tiers [persistence, gbm_active] renders 2 legend entries with tokens `--s3` and `--s1` (order fixed, no re-colour); table twin renders 6 rows. |
| `api/client.test.ts` | error envelope → `ApiError(code)`; network failure → code `network`; 204 → undefined; header `X-Requested-With` present. |
| `routes/*.test.tsx` (smoke) | each route renders its `h1` with mocked queries; `/commutes` unauthenticated redirects to `/login?next=/commutes`. |
Coverage target: `lib/` 100 %, components listed ≥ 80 %. `pnpm --filter @dockcast/web test` runs in CI.

---------------------------------------------------------------------------

## 12. Definition of done
- [ ] All routes in §4 implemented with every listed state (loading/empty/error/stale/unavailable/typical) and exact copy from `COPY`.
- [ ] Only tokens from `tokens.css` used; light + dark verified by toggling `data-theme` and via `prefers-color-scheme`; no hardcoded hex outside `tokens.css`; no external network requests except `/api/*`, OpenFreeMap tiles/styles/glyphs/sprites.
- [ ] Map: circles recolour with slider/target within 200 ms; selected ring; hover tooltip; deep links `?station=`, `?h=`, `?target=`, `?from&to&at&ride` restore state; list view works keyboard-only.
- [ ] Trip planner: validation, debounce, share, save-as-commute redirect flow, 60 s refresh.
- [ ] Commutes: CRUD with optimistic delete; push flow states (unsupported/denied/default/subscribed) each visible with mocked APIs; test push.
- [ ] Station page chart follows §2.5 (legend, hairlines, band, capacity line, table twin); typical day; neighbours.
- [ ] Model page: filter row applies to all charts; fixed series tokens; reliability diagram; versions table with gate drill-down; empty states.
- [ ] Service worker registered; notification click opens `url`.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass; bundle: main chunk < 250 kB gz excluding maplibre (maplibre + recharts code-split by route via `React.lazy`).
- [ ] Axe (`@axe-core/react` in dev) reports no serious/critical violations on each route; keyboard walk-through of the map page completed (search → select → panner → result → share).
- [ ] Lighthouse mobile: Performance ≥ 85, Accessibility ≥ 95 on `/` and `/model` against a local build.
