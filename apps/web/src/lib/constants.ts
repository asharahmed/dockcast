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

/** "1 bike", "2 bikes", "0 docks": a count with its noun in the right number. */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export const COPY = {
  errors: {
    generic: 'Something went wrong. Try again.',
    network: "Can't reach DockCast. Check your connection.",
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
    footerTagline: 'Bike-share forecasts from open data.',
    privacy: 'Privacy',
    status: 'Status',
  },
  offline: "You're offline. Showing the last data we had.",
  pwa: {
    updateReady: 'A new version of DockCast is ready.',
    updateReload: 'Reload',
    updateLater: 'Later',
    install: {
      heading: 'Get the app',
      body: 'Install DockCast for a full-screen app on your home screen that opens straight to the map and keeps working with the last data it had when you lose signal.',
      button: 'Install DockCast',
      iosLead: 'On iPhone or iPad, in Safari:',
      iosSteps: ['Tap the Share button', 'Choose “Add to Home Screen”', 'Tap Add'],
      installed: 'DockCast is installed on this device.',
    },
    // iOS only delivers web push to apps added to the Home Screen (Safari 16.4+).
    iosPushHint: 'To get alerts on iPhone, add DockCast to your Home Screen first, then open it from there.',
    iosPushHowTo: 'How to install',
  },
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
    updated: (rel: string, n: number) => `Updated ${rel} · ${count(n, 'station')}`,
    legendTitle: {
      bikes: (when: string) => `Chance of a bike ${when}`,
      docks: (when: string) => `Chance of an empty dock ${when}`,
    },
    legendNoForecast: 'No forecast',
    legendShow: 'Show legend',
    legendHide: 'Hide legend',
    legendLive: 'Live availability',
    legendLiveHas: (target: 'bike' | 'dock') => (target === 'bike' ? 'Has bikes' : 'Has docks'),
    legendLiveEmpty: 'Empty',
    liveOnlyBanner: (city: string) => `Live data only. No forecasts for ${city} yet.`,
    targetSub: {
      bikes: 'Chance of finding a bike',
      docks: 'Chance of finding an empty dock',
    },
    stale: (n: number) => `Forecasts are ${n} min old. The predictor may be catching up.`,
    cityLabel: 'City',
    searchPlaceholder: 'Find a station…',
    searchLabel: 'Search stations',
    noMatch: (q: string) => `No station matches "${q}"`,
    stationCounts: (b: number, d: number) => `${count(b, 'bike')} · ${count(d, 'dock')}`,
    stationCountsWithCapacity: (b: number, d: number, c: number) =>
      `${count(b, 'bike')} · ${count(d, 'dock')} · ${c} capacity`,
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
  },
  horizon: {
    now: 'Now',
    in: (label: string) => `In ${label}`,
  },
  station: {
    showOnMap: 'Show on map',
    bikesNow: 'bikes now',
    docksNow: 'empty docks now',
    ebikes: (n: number) => count(n, 'e-bike'),
    liveReported: (rel: string) => `Live · reported ${rel}`,
    notReportingLastSeen: (rel: string) => `Not reporting · last seen ${rel}`,
    noCurrentData: "We haven't seen this station report yet.",
    forecastCaption: 'Forecast by horizon',
    // Phone layout of the forecast table (ui-spec.md §6: tables stack below 768 px).
    forecastCard: {
      bike: 'Bike',
      dock: 'Dock',
      expected: (n: number, range: string | null) =>
        range ? `About ${count(n, 'bike')} expected (range ${range})` : `About ${count(n, 'bike')} expected`,
    },
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
      tooltipActual: (n: number) => `Actual: ${count(n, 'bike')}`,
      tooltipForecast: (exp: number, lo: number, hi: number) =>
        `Forecast: ~${exp} (${lo}–${hi})`,
      empty: 'No history yet. The chart fills in as the collector runs.',
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
    privacyNote: 'What DockCast stores about you and how to delete it:',
    signInTitle: 'Sign in',
    registerTitle: 'Create account',
    subtitle: 'Save commutes and get alerts before you leave.',
    signInButton: 'Sign in',
    registerButton: 'Create account',
    toRegister: 'New here? Create an account',
    toSignIn: 'Have an account? Sign in',
    passwordHint: 'At least 10 characters',
    orDivider: 'or',
    continueWithGoogle: 'Continue with Google',
    continueWithApple: 'Continue with Apple',
    errors: {
      badCredentials: "That email and password don't match.",
      emailTaken: 'That email is already registered. Sign in instead.',
      rateLimited: 'Too many attempts. Try again in a few minutes.',
      oauthFailed: "Sign-in didn't complete. Try again.",
    },
  },
  account: {
    title: 'Account',
    methodsHeading: 'Sign-in methods',
    password: 'Password',
    passwordSet: 'set',
    passwordNotSet: 'none',
    connect: 'Connect',
    disconnect: 'Disconnect',
    disconnectConfirm: (provider: string) => `Disconnect ${provider}?`,
    onlyMethodNote: 'Your only sign-in method — set nothing else, disconnect nothing.',
    linkOk: 'Connected.',
    linkConflict: 'That account already signs into a different DockCast account.',
    providerName: { google: 'Google', apple: 'Apple' } as Record<'google' | 'apple', string>,
    deleteHeading: 'Delete account',
    deleteBody:
      'Removes your account, saved commutes, alert history, alert devices and linked sign-ins, and signs you out everywhere. This cannot be undone.',
    deleteButton: 'Delete my account',
    deleteConfirm: 'Delete your account and everything in it?',
    deleteConfirmLabel: 'Delete',
    deletedToast: 'Your account has been deleted.',
    deleteErrorToast: "Couldn't delete your account. Try again.",
  },
  about: {
    title: 'About DockCast',
  },
  trip: {
    title: 'Trip check',
    fields: {
      from: 'From',
      to: 'To',
      leave: 'Leave',
      rideTime: 'Ride time',
    },
    leaveMode: { now: 'Now', at: 'At…' },
    leaveInPastHelper: "That's earlier than now, so we'll use now.",
    rideAutoHelper: 'Estimated at 12 km/h',
    rideReset: 'Reset',
    rideUnit: 'min',
    // Shown in the empty box before stations are picked (the estimate needs both ends).
    ridePlaceholder: 'auto',
    swapAriaLabel: 'Swap stations',
    validation: {
      chooseStation: 'Choose a station',
      sameStation: 'Pick two different stations',
      rideRange: '1–180 minutes',
    },
    submit: 'Check my trip',
    submitting: 'Checking…',
    editSummary: (from: string, to: string, leave: string, ride: number) =>
      `From ${from} to ${to} · leaving ${leave} · ${ride} min ride`,
    edit: 'Edit',
    errors: {
      tooManyChecks: 'Too many checks. Try again in a moment.',
      generic: "Couldn't check that trip. Try again.",
    },
    computedLine: (computedAt: string, forecastT0: string | null) =>
      forecastT0 ? `Computed ${computedAt} · forecasts from ${forecastT0}` : `Computed ${computedAt}`,
    eyebrow: { origin: 'LEAVE FROM', dest: 'ARRIVE AT' },
    heroObject: {
      origin: (time: string) => `a bike at ${time}`,
      dest: (time: string) => `an empty dock at ${time}`,
    },
    nowMeta: (bikes: number, docks: number) => `Now: ${count(bikes, 'bike')} · ${count(docks, 'dock')}`,
    notReporting: 'not reporting',
    expectedThenBikes: (n: number) => `Expected then: ~${count(n, 'bike')}`,
    expectedThenDocks: (n: number) => `Expected then: ~${count(n, 'dock')}`,
    typicalLabel: (maxLead: number) => `Typical for this time · forecasts start ${maxLead} min ahead`,
    unavailableLabel: 'No forecast right now',
    alternatives: {
      heading: { origin: 'Nearby with better odds for a bike', dest: 'Nearby with better odds for a dock' },
      toggle: 'Other nearby stations',
      safeBet: 'Safe bet',
      walkLine: (min: number, m: number) => `${min} min walk · ${m} m`,
      empty: 'No nearby stations with a forecast.',
    },
    share: 'Share',
    shareCopied: 'Link copied',
    saveAsCommute: 'Save as commute',
    fromUrlPrompt: 'Pick two stations to check a trip.',
    openOnMap: 'Open on the map',
  },
  commutes: {
    title: 'My commutes',
    newCommute: 'New commute',
    push: {
      unsupported: 'Alerts need a browser with push notifications (Safari 16.4+, Chrome, Firefox).',
      denied: 'Notifications are blocked for this site. Allow them in your browser settings to get alerts.',
      defaultBody: 'Get a push before you leave if the odds drop.',
      enable: 'Enable alerts',
      enabledToast: 'Alerts on for this device',
      enableErrorToast: "Couldn't enable alerts on this device.",
      subscribedBody: 'Alerts are on for this device.',
      sendTest: 'Send a test',
      testSentToast: 'Test sent. Check your notifications.',
      testNoneToast: 'No devices to send to',
      turnOff: 'Turn off on this device',
      // The strip is device-scoped and covers every commute (each with its own
      // lead/threshold), so the note stays generic rather than naming one
      // commute's lead.
      note: 'At most one alert per commute per day, sent before you leave and only if the odds fall under your threshold.',
    },
    empty: {
      title: 'No commutes yet',
      body: "Save your regular ride and we'll tell you before you leave whether there'll be a bike, and a dock at the other end.",
    },
    days: {
      weekdays: 'Mon–Fri',
      everyDay: 'Every day',
    },
    schedule: (days: string, leave: string, ride: number) => `${days} · leaves ${leave} · ${ride} min ride`,
    alertsLine: (on: boolean, lead: number, thresholdPct: number) =>
      `Alerts ${on ? 'on' : 'off'} · ${lead} min before · under ${thresholdPct}%`,
    edit: 'Edit',
    delete: 'Delete',
    deleteConfirm: (name: string) => `Delete "${name}"?`,
    cancel: 'Cancel',
    outlook: {
      todayAt: (time: string) => `Next: today ${time}`,
      tomorrowAt: (time: string) => `Next: tomorrow ${time}`,
      otherAt: (time: string) => `Next: ${time}`,
      typicalSuffix: '(typical)',
      none: 'No upcoming departure',
      tooltip: (bikePct: string, dockPct: string) => `Bike ${bikePct} · Dock ${dockPct}`,
    },
    form: {
      nameLabel: 'Name',
      nameDefault: 'Commute to work',
      fromLabel: 'From',
      toLabel: 'To',
      leaveAtLabel: 'Leave at',
      daysLabel: 'Days',
      daysWeekdays: 'Weekdays',
      daysEveryDay: 'Every day',
      rideLabel: 'Ride time',
      alertsLabel: 'Alerts',
      alertLeadLabel: 'Alert lead',
      thresholdLabel: 'Alert me when the odds drop under',
      saveNew: 'Save commute',
      saveEdit: 'Save changes',
      cancel: 'Cancel',
      validation: {
        name: 'Give it a name',
        station: 'Choose a station',
        sameStation: 'Pick two different stations',
        days: 'Pick at least one day',
        ride: '1–180 minutes',
      },
      savedToast: 'Commute saved',
    },
    couldntLoad: "Couldn't load your commutes.",
  },
  model: {
    title: 'How good are the forecasts?',
    intro:
      'Every forecast DockCast shows is scored against what actually happened. This page is generated from those scores. Nothing is hand-picked.',
    summary: {
      servingNow: 'Serving now',
      activeLearnedModel: 'Active learned model',
      dataSince: 'Data since',
      collectorUptime: 'Collector uptime (7 d)',
      lastForecastRun: 'Last forecast run',
      stations: 'Stations',
      noneYet: 'none yet',
      activeModelLine: (id: number, trainedFor: string) => `#${id} · trained for ${trainedFor}`,
    },
    explainer: {
      heading: 'Three tiers, always compared',
      persistence: { name: 'Persistence', body: 'assumes nothing changes' },
      flow: { name: 'Flow model', body: 'a queue model fed by a year of trip history and the weather' },
      learned: {
        name: 'Learned model',
        body: 'a gradient-boosted model trained on our own snapshots; serves only if it beats the flow model on held-out days',
      },
      // SPEC-GAP: ui-spec.md §4.5 item 3 asks for "a 'Shadow' note" without
      // quoting exact text; written to match the doc's plain, factual tone.
      shadow:
        'Shadow: a candidate learned model scored alongside the active one. It takes over only if its scores are better.',
    },
    sliceToggle: { all: 'All stations', atRisk: 'At-risk stations' },
    charts: {
      brierTitle: 'Brier score by horizon (lower is better) · last 7 days',
      brierExplainer:
        'Brier = mean squared error of the probability. 0 is perfect; predicting 50% everywhere scores 0.25.',
      maeTitle: 'Expected-count error (MAE, bikes) by horizon · last 7 days',
      reliabilityTitle: 'Calibration · last 7 days',
      reliabilityExplainer:
        'If we say 80%, it should happen about 80% of the time. Points on the line are calibrated. ECE summarises the gap.',
      reliabilityTooltip: (predPct: string, obsPct: string, n: number) =>
        `Predicted ${predPct} → happened ${obsPct} (n ${n.toLocaleString()})`,
      perfectLabel: 'perfect',
      empty: 'No scored forecasts yet. Scores appear after the first full day of forecasts.',
      // SPEC-GAP: ui-spec.md §4.5 assumes every window is scored for the same day. The API
      // serves each window its own latest day, so a chart can be behind the rest of the page.
      asOf: (day: string) => `scored through ${day}`,
      nSuffix: (n: number) => `n ${n.toLocaleString()}`,
    },
    tierNames: {
      persistence: 'persistence',
      bd_raw: 'flow (uncalibrated)',
      bd_cal: 'flow',
      gbm_active: 'gbm',
      gbm_shadow: 'shadow',
    },
    eceLine: (parts: string) => `ECE: ${parts}`,
    versions: {
      heading: 'Model versions',
      columns: {
        id: '#',
        tier: 'Tier',
        trainedFor: 'Trained for',
        status: 'Status',
        valBrier: 'Val Brier (bike / dock)',
        gate: 'Gate',
        created: 'Created',
      },
      gatePassed: 'passed',
      gateFailed: 'failed',
      empty: 'No model versions yet.',
    },
    footnote:
      'Metrics are computed nightly over forecasts made at :00/:15/:30/:45 and the state observed at their target time. Definitions:',
    footnoteLinkLabel: 'docs/ml-spec.md',
    couldntLoad: "Couldn't load model metrics.",
    // Public view (ui-spec.md §4.5): what a visitor who is not the operator sees.
    public: {
      summary: {
        learnedModel: 'Learned model',
        activeSince: (date: string) => `active since ${date}`,
        notYet: 'not yet (flow model serving)',
        scoredThrough: 'Scored through',
      },
      current: {
        heading: "What's forecasting right now",
        gbm: 'Forecasts come from the learned model: gradient-boosted models trained every night on DockCast’s own forecast history, with the flow model’s output as one of their inputs. It serves because it beat the flow model on held-out days. A new version trains nightly and replaces it only if it scores better; otherwise the current one keeps serving.',
        bd_cal:
          'Forecasts come from the calibrated flow model: each station is a queue whose arrival and departure rates come from a year of trip history and the weather, with its probabilities corrected against recent outcomes. A learned challenger trains every night and takes over once it beats this model on held-out days.',
        bd_raw:
          'Forecasts come from the flow model: each station is a queue whose arrival and departure rates come from a year of trip history and the weather. Calibration against real outcomes switches on after two weeks of scored forecasts; a learned challenger then trains nightly and takes over once it beats this model on held-out days.',
        none: 'No forecasts yet for this city. The map shows live availability only until a trip-history bootstrap has run.',
      },
      accuracy: {
        heading: 'How accurate it has been (last 7 days)',
        intro: 'Measured an hour ahead, across all stations, on forecasts scored against what actually happened.',
        errorPhrase: (pct: number) => (pct >= 0 ? `${pct}% less error` : `${-pct}% more error`),
        vsPersistence: (bikes: string, docks: string) =>
          `The chance-of-a-bike forecast has ${bikes} than assuming nothing changes; the chance-of-a-dock forecast, ${docks}.`,
        calibration: (bikePts: string, dockPts: string) =>
          `Calibration gap: ${bikePts} points for bikes, ${dockPts} for docks. A gap of 0 would mean an 80% forecast comes true exactly 80% of the time.`,
        mae: (bikes: string) => `Expected bike counts are off by ${bikes} bikes on average.`,
        empty: 'No scored forecasts yet for the model that is serving. Scores appear after the first full day of forecasts.',
      },
    },
  },
} as const;
