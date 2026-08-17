/**
 * Re-exported cross-cutting constants (plan.md §1 R5: never re-declared) plus
 * `COPY`, the single source for every user-visible string (ui-spec.md §1, §9).
 */
export {
  HORIZONS,
  MIN_LEAD,
  MAX_LEAD,
  WALK_M_PER_MIN,
  RIDE_KMH,
  RIDE_OVERHEAD_MIN,
  ALT_RADIUS_M,
  ALT_GOOD_P,
  VERDICT_GOOD,
  VERDICT_RISKY,
} from '@dockcast/shared';
import type { Verdict } from '@dockcast/shared';

export const COPY = {
  errors: {
    generic: 'Something went wrong. Try again.',
    network: "Can't reach DockCast — check your connection.",
  },
  auth: {
    required: 'Sign in to save commutes.',
  },
  a11y: {
    skipLink: 'Skip to content',
    navigatedTo: (title: string) => `Navigated to ${title}`,
  },
  shell: {
    wordmark: 'DockCast',
    nav: { map: 'Map', commutes: 'Commutes', model: 'Model', about: 'About', more: 'More' },
    signIn: 'Sign in',
    signOut: 'Sign out',
    theme: { system: 'System', light: 'Light', dark: 'Dark' },
    healthOk: 'API healthy',
    healthDown: 'API unreachable',
    footerTagline: 'DockCast — forecasts from open GBFS data. No LLMs involved.',
  },
  offline: "You're offline — showing the last data we had.",
  notFound: {
    title: 'Nothing docked here.',
    body: "That page doesn't exist.",
    link: 'Back to the map',
  },
  stationNotFound: {
    title: "We don't know that station.",
    link: 'Back to the map',
  },
  map: {
    updated: (rel: string, n: number) => `Updated ${rel} · ${n} stations`,
    legendTitle: {
      bikes: (when: string) => `Chance of a bike ${when}`,
      docks: (when: string) => `Chance of an empty dock ${when}`,
    },
    legendNoForecast: 'No forecast',
    legendLive: 'Live availability',
    legendLiveHas: (target: 'bike' | 'dock') => (target === 'bike' ? 'Has bikes' : 'Has docks'),
    legendLiveEmpty: 'Empty',
    liveOnlyBanner: (city: string) =>
      `Live data only — forecasts aren't available for ${city} yet.`,
    targetSub: {
      bikes: 'Chance of finding a bike',
      docks: 'Chance of finding an empty dock',
    },
    stale: (n: number) => `Forecasts are ${n} min old — the predictor may be catching up.`,
    searchPlaceholder: 'Find a station…',
    searchLabel: 'Search stations',
    noMatch: (q: string) => `No station matches "${q}"`,
    stationCounts: (b: number, d: number) => `${b} bikes · ${d} docks`,
    stationCountsWithCapacity: (b: number, d: number, c: number) =>
      `${b} bikes · ${d} docks · ${c} capacity`,
    liveUpdated: (rel: string) => `Live · updated ${rel}`,
    notReporting: 'Not reporting',
    closeStation: 'Close station',
    stationDetails: 'Station details →',
    tripFromHere: 'Trip from here',
    tripToHere: 'Trip to here',
    couldntLoad: "Couldn't load live data.",
    retry: 'Retry',
    noStations: (city: string) => `No stations found for ${city}`,
    listToggle: 'List',
    mapAriaLabel: (city: string) => `Map of ${city} stations coloured by forecast`,
    attribution: '© OpenFreeMap © OpenMapTiles Data from OpenStreetMap',
    plannerPlaceholderTitle: 'Plan a trip',
    // SPEC-GAP: ui-spec.md §4.1 describes the full TripPlanner form in this
    // panel slot; that component ships in WP-10. This placeholder copy is
    // not specified verbatim, chosen to match the doc's plain, calm tone.
    plannerPlaceholderBody:
      'Trip planning is coming soon. Pick a station on the map, or search above, to see its bike and dock odds.',
  },
  horizon: {
    now: 'Now',
    in: (label: string) => `In ${label}`,
  },
  station: {
    showOnMap: 'Show on map',
    bikesNow: 'bikes now',
    docksNow: 'empty docks now',
    ebikes: (n: number) => `${n} e-bikes`,
    liveReported: (rel: string) => `Live · reported ${rel}`,
    notReportingLastSeen: (rel: string) => `Not reporting — last seen ${rel}`,
    noCurrentData: "We haven't seen this station report yet.",
    forecastCaption: 'Forecast by horizon',
    modelLine: (label: string) => `Model: ${label}`,
    howForecastsWork: 'How forecasts work →',
    tierLabel: {
      gbm: 'learned model',
      bd_cal: 'calibrated flow model',
      bd_raw: 'flow model (uncalibrated)',
      none: '—',
    },
    reason: {
      not_fresh: "station isn't reporting",
      zero_capacity: 'station has no usable docks',
      no_rates: 'no history for this station yet',
      other: 'predictor is catching up',
    },
    chart: {
      actualLabel: 'Bikes (actual)',
      forecastLabel: 'Forecast (expected)',
      bandLabel: '10–90% range',
      capacityLabel: 'capacity',
      nowLabel: 'now',
      tooltipActual: (n: number) => `Actual: ${n} bikes`,
      tooltipForecast: (exp: number, lo: number, hi: number) =>
        `Forecast: ~${exp} (${lo}–${hi})`,
      empty: 'No history yet — data starts once the collector has run for a while.',
      table: 'Table',
      chartToggle: 'Chart',
    },
    typicalTitle: (day: string) => `Typical ${day} here`,
    typicalCaption: 'Share of the last 4 weeks with ≥1 bike / ≥1 dock, by time of day.',
    typicalEmpty: 'Not enough history yet.',
    neighborsHeading: 'Nearest stations',
  },
  verdict: {
    good: 'Looks good',
    risky: 'Risky',
    bad: "Don't count on it",
    unknown: "Can't tell yet",
  } satisfies Record<Verdict, string>,
  auth_pages: {
    signInTitle: 'Sign in',
    registerTitle: 'Create account',
    subtitle: 'Save commutes and get alerts before you leave.',
    signInButton: 'Sign in',
    registerButton: 'Create account',
    toRegister: 'New here? Create an account',
    toSignIn: 'Have an account? Sign in',
    passwordHint: 'At least 10 characters',
    errors: {
      badCredentials: "That email and password don't match.",
      emailTaken: 'That email is already registered — sign in instead.',
      rateLimited: 'Too many attempts — try again in a few minutes.',
    },
  },
  about: {
    title: 'About DockCast',
  },
} as const;
