/**
 * Trip planner form: origin/destination pickers (reusing `StationSearch`),
 * depart-time picker, ride-minutes override, URL param sync
 * (`?from=&to=&at=&ride=`), auto-run when both stations are present, and a
 * collapsed one-line summary once submitted. Renders `TripResult` below
 * itself. ui-spec.md §4.1 `TripPlanner`, §4.3 `/trip`.
 *
 * Used both embedded in the map's control panel and on `/trip` — in both
 * places the same collapse-to-summary + inline result behaviour applies
 * (ui-spec.md §4.1 "render TripResult below the form"; §4.3 "renders
 * TripPlanner (prefilled, collapsed summary) + TripResult"), so it's kept
 * self-contained rather than split between two call sites.
 */
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { StationSearch } from '../map/StationSearch.js';
import { TimeInput } from '../ui/TimeInput.js';
import { RideMinutesInput } from '../ui/RideMinutesInput.js';
import { Field } from '../ui/Field.js';
import { Button } from '../ui/Button.js';
import { IconButton } from '../ui/IconButton.js';
import { TripResult } from './TripResult.js';
import { useTrip } from '../../api/queries.js';
import { ApiError } from '../../api/client.js';
import { rideMinutesDefault } from '../../lib/geo.js';
import { fmtLocalTime, nextDepart, minutesBetween } from '../../lib/time.js';
import { COPY } from '../../lib/constants.js';
import type { StationListItem, MapStation } from '../../api/types.js';

export interface TripParsedParams {
  origin: number | null;
  dest: number | null;
  departAt: Date | null;
  rideMinutes: number | null;
}

/** Parses `?from=&to=&at=&ride=` into typed values. Exported so pages that render alongside `TripPlanner` (e.g. `/trip`'s "Open on the map" link) can read the same URL state. */
export function parseTripSearchParams(searchParams: URLSearchParams): TripParsedParams {
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const at = searchParams.get('at');
  const ride = searchParams.get('ride');
  const departAt = at ? new Date(at) : null;
  return {
    origin: from ? Number(from) : null,
    dest: to ? Number(to) : null,
    departAt: departAt && !Number.isNaN(departAt.getTime()) ? departAt : null,
    rideMinutes: ride ? Number(ride) : null,
  };
}

interface Draft {
  originId: number | null;
  destId: number | null;
  mode: 'now' | 'at';
  hhmm: string | null;
  rideValue: number | null;
  rideAuto: boolean;
}

function draftFromUrl(params: TripParsedParams, cityTz: string): Draft {
  return {
    originId: params.origin,
    destId: params.dest,
    mode: params.departAt ? 'at' : 'now',
    hhmm: params.departAt ? fmtLocalTime(params.departAt, cityTz, 'HH:mm') : null,
    rideValue: params.rideMinutes,
    rideAuto: params.rideMinutes === null,
  };
}

export interface TripPlannerProps {
  stations: StationListItem[];
  mapStations: MapStation[];
  cityTz: string;
  now: Date;
  /** Shown above the form while nothing has been submitted yet (ui-spec.md §4.3's "Pick two stations to check a trip."). Omitted by the map's embedded planner. */
  emptyHint?: string;
}

export function TripPlanner({ stations, mapStations, cityTz, now, emptyHint }: TripPlannerProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlParams = parseTripSearchParams(searchParams);
  const submitted = urlParams.origin !== null && urlParams.dest !== null;

  const [draft, setDraft] = useState<Draft>(() => draftFromUrl(urlParams, cityTz));
  const [expanded, setExpanded] = useState(!submitted);
  const [errors, setErrors] = useState<{ station?: string; ride?: string }>({});
  const [submitCooldown, setSubmitCooldown] = useState(false);

  const originStation = stations.find((s) => s.id === draft.originId) ?? null;
  const destStation = stations.find((s) => s.id === draft.destId) ?? null;
  const autoRide =
    originStation && destStation ? rideMinutesDefault(originStation, destStation) : null;

  const trip = useTrip({
    origin: urlParams.origin ?? undefined,
    dest: urlParams.dest ?? undefined,
    departAt: urlParams.departAt ?? undefined,
    rideMinutes: urlParams.rideMinutes ?? undefined,
    enabled: submitted,
  });

  function startEdit() {
    setDraft(draftFromUrl(urlParams, cityTz));
    setErrors({});
    setExpanded(true);
  }

  function swap() {
    setDraft((d) => ({ ...d, originId: d.destId, destId: d.originId }));
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const nextErrors: { station?: string; ride?: string } = {};
    if (draft.originId === null || draft.destId === null) {
      nextErrors.station = COPY.trip.validation.chooseStation;
    } else if (draft.originId === draft.destId) {
      nextErrors.station = COPY.trip.validation.sameStation;
    }
    const rideToUse = draft.rideAuto ? autoRide : draft.rideValue;
    if (rideToUse === null || rideToUse < 1 || rideToUse > 180) {
      nextErrors.ride = COPY.trip.validation.rideRange;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || draft.originId === null || draft.destId === null) {
      return;
    }

    let departAt = now;
    if (draft.mode === 'at' && draft.hhmm) {
      const candidate = nextDepart(now, cityTz, draft.hhmm);
      departAt = minutesBetween(now, candidate) >= 0 ? candidate : now;
    }

    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set('from', String(draft.originId));
        params.set('to', String(draft.destId));
        params.set('at', departAt.toISOString());
        params.set('ride', String(rideToUse));
        return params;
      },
      { replace: true },
    );
    setExpanded(false);
    setSubmitCooldown(true);
    window.setTimeout(() => setSubmitCooldown(false), 1500);
  }

  const showPastHelper =
    draft.mode === 'at' &&
    !!draft.hhmm &&
    minutesBetween(now, nextDepart(now, cityTz, draft.hhmm)) < 0;

  const summaryFrom = originStation?.name ?? stations.find((s) => s.id === urlParams.origin)?.name;
  const summaryTo = destStation?.name ?? stations.find((s) => s.id === urlParams.dest)?.name;
  const shareUrl =
    submitted && urlParams.departAt
      ? `${window.location.origin}/trip?from=${urlParams.origin}&to=${urlParams.dest}&at=${encodeURIComponent(
          urlParams.departAt.toISOString(),
        )}&ride=${urlParams.rideMinutes ?? ''}`
      : '';

  return (
    <div className="flex flex-col gap-4">
      {!expanded && submitted ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[length:var(--fs-sm)] text-ink">
            {COPY.trip.editSummary(
              summaryFrom ?? '—',
              summaryTo ?? '—',
              urlParams.departAt ? fmtLocalTime(urlParams.departAt, cityTz) : fmtLocalTime(now, cityTz),
              urlParams.rideMinutes ?? autoRide ?? 0,
            )}
          </p>
          <button
            type="button"
            onClick={startEdit}
            className="text-[length:var(--fs-sm)] font-medium text-signal underline underline-offset-4"
          >
            {COPY.trip.edit}
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {emptyHint && !submitted && (
            <p className="text-[length:var(--fs-sm)] text-ink-2">{emptyHint}</p>
          )}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <StationSearch
                stations={stations}
                mapStations={mapStations}
                onSelect={(id) => setDraft((d) => ({ ...d, originId: id }))}
                label={COPY.trip.fields.from}
                hiddenLabel={false}
                icon="bike"
                selectedName={originStation?.name ?? null}
                error={errors.station}
              />
            </div>
            <IconButton icon="swap" aria-label={COPY.trip.swapAriaLabel} onClick={swap} />
          </div>

          <StationSearch
            stations={stations}
            mapStations={mapStations}
            onSelect={(id) => setDraft((d) => ({ ...d, destId: id }))}
            label={COPY.trip.fields.to}
            hiddenLabel={false}
            icon="dock"
            selectedName={destStation?.name ?? null}
          />

          <Field
            label={COPY.trip.fields.leave}
            hint={showPastHelper ? COPY.trip.leaveInPastHelper : undefined}
          >
            <TimeInput
              value={draft.hhmm}
              onChange={(hhmm) => setDraft((d) => ({ ...d, hhmm }))}
              mode={draft.mode}
              onModeChange={(mode) => setDraft((d) => ({ ...d, mode }))}
            />
          </Field>

          <Field
            label={COPY.trip.fields.rideTime}
            hint={draft.rideAuto ? COPY.trip.rideAutoHelper : undefined}
            error={errors.ride}
          >
            <RideMinutesInput
              auto={draft.rideAuto}
              autoValue={autoRide}
              value={draft.rideValue}
              onChange={(rideValue) => setDraft((d) => ({ ...d, rideAuto: false, rideValue }))}
              onReset={() => setDraft((d) => ({ ...d, rideAuto: true, rideValue: null }))}
            />
          </Field>

          <Button type="submit" disabled={submitCooldown}>
            {trip.isFetching && submitted ? COPY.trip.submitting : COPY.trip.submit}
          </Button>
        </form>
      )}

      {submitted &&
        (trip.isError ? (
          <p className="text-[length:var(--fs-sm)] text-st-critical">
            {trip.error instanceof ApiError && trip.error.status === 429
              ? COPY.trip.errors.tooManyChecks
              : trip.error instanceof ApiError && trip.error.status === 400
                ? trip.error.message
                : COPY.trip.errors.generic}
          </p>
        ) : (
          trip.data && <TripResult trip={trip.data} cityTz={cityTz} shareUrl={shareUrl} />
        ))}
    </div>
  );
}
