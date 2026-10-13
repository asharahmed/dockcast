/**
 * Inline create/edit panel (not a modal). Fields exactly `CommuteCreateRequest`.
 * ui-spec.md §4.4 `CommuteForm`.
 *
 * SPEC-GAP: ui-spec.md's Name field says "default 'Commute to work' for
 * new". Read literally as a committed initial value, an empty "submit
 * empty → 4 validation messages" test (name/origin/dest/days) couldn't
 * exist — the name would already be valid. Implemented as a *placeholder*
 * (still a real empty controlled value + visible `Field` label, so this
 * isn't the spec's forbidden "placeholder-only form" — the label stays) so
 * both the plain UX reading and the mandated test behaviour hold.
 */
import { useState, type FormEvent } from 'react';
import { StationSearch } from '../map/StationSearch.js';
import { Field } from '../ui/Field.js';
import { Button } from '../ui/Button.js';
import { DayPicker } from '../ui/DayPicker.js';
import { Toggle } from '../ui/Toggle.js';
import { Select } from '../ui/Select.js';
import { rideMinutesDefault } from '../../lib/geo.js';
import { COPY } from '../../lib/constants.js';
import type { StationListItem, MapStation, CommuteCreateRequest } from '../../api/types.js';

const ALERT_LEAD_OPTIONS = [10, 15, 20, 30, 45, 60];
const THRESHOLD_OPTIONS = [0.5, 0.6, 0.7, 0.8, 0.9];

export interface CommuteFormInitial {
  name: string;
  originId: number | null;
  destId: number | null;
  departLocalTime: string;
  rideMinutes: number | null;
  daysOfWeek: number[];
  alertEnabled: boolean;
  alertLeadMinutes: number;
  threshold: number;
}

export const COMMUTE_FORM_DEFAULTS: CommuteFormInitial = {
  name: '',
  originId: null,
  destId: null,
  departLocalTime: '',
  rideMinutes: null,
  daysOfWeek: [],
  alertEnabled: true,
  alertLeadMinutes: 20,
  threshold: 0.7,
};

export interface CommuteFormProps {
  stations: StationListItem[];
  mapStations: MapStation[];
  mode: 'create' | 'edit';
  initial?: CommuteFormInitial;
  onSubmit: (body: CommuteCreateRequest) => void;
  onCancel: () => void;
  submitting?: boolean;
  serverError?: string | null;
}

interface FormErrors {
  name?: string;
  origin?: string;
  dest?: string;
  days?: string;
  ride?: string;
}

export function CommuteForm({
  stations,
  mapStations,
  mode,
  initial = COMMUTE_FORM_DEFAULTS,
  onSubmit,
  onCancel,
  submitting = false,
  serverError = null,
}: CommuteFormProps) {
  const [name, setName] = useState(initial.name);
  const [originId, setOriginId] = useState<number | null>(initial.originId);
  const [destId, setDestId] = useState<number | null>(initial.destId);
  const [departLocalTime, setDepartLocalTime] = useState(initial.departLocalTime);
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(initial.daysOfWeek);
  const [rideAuto, setRideAuto] = useState(initial.rideMinutes === null);
  const [rideValue, setRideValue] = useState<number | null>(initial.rideMinutes);
  const [alertEnabled, setAlertEnabled] = useState(initial.alertEnabled);
  const [alertLeadMinutes, setAlertLeadMinutes] = useState(initial.alertLeadMinutes);
  const [threshold, setThreshold] = useState(initial.threshold);
  const [errors, setErrors] = useState<FormErrors>({});

  const originStation = stations.find((s) => s.id === originId) ?? null;
  const destStation = stations.find((s) => s.id === destId) ?? null;
  const autoRide =
    originStation && destStation ? rideMinutesDefault(originStation, destStation) : null;
  const effectiveRide = rideAuto ? autoRide : rideValue;

  function onSubmitForm(event: FormEvent) {
    event.preventDefault();
    const nextErrors: FormErrors = {};

    if (name.trim() === '') nextErrors.name = COPY.commutes.form.validation.name;
    if (originId === null) nextErrors.origin = COPY.commutes.form.validation.station;
    if (destId === null) nextErrors.dest = COPY.commutes.form.validation.station;
    if (originId !== null && destId !== null && originId === destId) {
      nextErrors.dest = COPY.commutes.form.validation.sameStation;
    }
    if (daysOfWeek.length === 0) nextErrors.days = COPY.commutes.form.validation.days;
    if (
      originId !== null &&
      destId !== null &&
      originId !== destId &&
      (effectiveRide === null || effectiveRide < 1 || effectiveRide > 180)
    ) {
      nextErrors.ride = COPY.commutes.form.validation.ride;
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || originId === null || destId === null) return;

    onSubmit({
      name: name.trim(),
      origin_station_id: originId,
      dest_station_id: destId,
      depart_local_time: departLocalTime,
      ride_minutes: effectiveRide ?? undefined,
      days_of_week: [...daysOfWeek].sort((a, b) => a - b),
      alert_enabled: alertEnabled,
      alert_lead_minutes: alertLeadMinutes,
      threshold,
    });
  }

  return (
    <form onSubmit={onSubmitForm} noValidate className="flex flex-col gap-4 rounded-[var(--r-2)] border border-rule bg-surface p-[var(--sp-5)]">
      {serverError && (
        <p className="wash-critical flex items-center gap-2 rounded-[var(--r-1)] px-3 py-2 text-[length:var(--fs-sm)] text-[color:var(--st-critical-text)]">
          {serverError}
        </p>
      )}

      <Field label={COPY.commutes.form.nameLabel} error={errors.name}>
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={COPY.commutes.form.nameDefault}
          maxLength={60}
          className="min-h-11 w-full rounded-[var(--r-1)] border border-rule-strong bg-surface px-3 py-2 text-ink"
        />
      </Field>

      <StationSearch
        stations={stations}
        mapStations={mapStations}
        onSelect={setOriginId}
        label={COPY.commutes.form.fromLabel}
        hiddenLabel={false}
        icon="bike"
        selectedName={originStation?.name ?? null}
        error={errors.origin}
      />

      <StationSearch
        stations={stations}
        mapStations={mapStations}
        onSelect={setDestId}
        label={COPY.commutes.form.toLabel}
        hiddenLabel={false}
        icon="dock"
        selectedName={destStation?.name ?? null}
        error={errors.dest}
      />

      <Field label={COPY.commutes.form.leaveAtLabel}>
        <input
          type="time"
          required
          value={departLocalTime}
          onChange={(event) => setDepartLocalTime(event.target.value)}
          className="min-h-11 w-full rounded-[var(--r-1)] border border-rule-strong bg-surface px-3 py-2 text-ink"
        />
      </Field>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[length:var(--fs-sm)] font-medium text-ink">
            {COPY.commutes.form.daysLabel}
          </span>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setDaysOfWeek([0, 1, 2, 3, 4])}
              className="text-[length:var(--fs-sm)] text-signal underline underline-offset-4"
            >
              {COPY.commutes.form.daysWeekdays}
            </button>
            <button
              type="button"
              onClick={() => setDaysOfWeek([0, 1, 2, 3, 4, 5, 6])}
              className="text-[length:var(--fs-sm)] text-signal underline underline-offset-4"
            >
              {COPY.commutes.form.daysEveryDay}
            </button>
          </div>
        </div>
        <DayPicker value={daysOfWeek} onChange={setDaysOfWeek} />
        {errors.days && (
          <p className="text-[length:var(--fs-xs)] text-st-critical">{errors.days}</p>
        )}
      </div>

      <Field
        label={COPY.commutes.form.rideLabel}
        hint={rideAuto ? COPY.trip.rideAutoHelper : undefined}
        error={errors.ride}
      >
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={180}
            value={rideAuto ? (autoRide ?? '') : (rideValue ?? '')}
            onChange={(event) => {
              setRideAuto(false);
              setRideValue(event.target.value === '' ? null : Number(event.target.value));
            }}
            className="min-h-11 w-24 rounded-[var(--r-1)] border border-rule-strong bg-surface px-3 py-2 text-ink"
          />
          {!rideAuto && (
            <button
              type="button"
              onClick={() => {
                setRideAuto(true);
                setRideValue(null);
              }}
              className="text-[length:var(--fs-sm)] text-signal underline underline-offset-4"
            >
              {COPY.trip.rideReset}
            </button>
          )}
        </div>
      </Field>

      <Toggle checked={alertEnabled} onChange={setAlertEnabled} label={COPY.commutes.form.alertsLabel} />

      <Field label={COPY.commutes.form.alertLeadLabel}>
        <Select
          value={String(alertLeadMinutes)}
          onChange={(value) => setAlertLeadMinutes(Number(value))}
          options={ALERT_LEAD_OPTIONS.map((n) => ({ value: String(n), label: `${n} min` }))}
        />
      </Field>

      <Field label={COPY.commutes.form.thresholdLabel}>
        <Select
          value={String(threshold)}
          onChange={(value) => setThreshold(Number(value))}
          options={THRESHOLD_OPTIONS.map((t) => ({
            value: String(t),
            label: `${Math.round(t * 100)}%`,
          }))}
        />
      </Field>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={submitting}>
          {mode === 'create' ? COPY.commutes.form.saveNew : COPY.commutes.form.saveEdit}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {COPY.commutes.form.cancel}
        </Button>
      </div>
    </form>
  );
}
