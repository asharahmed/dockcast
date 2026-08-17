/**
 * The horizon slider — DockCast's signature control. ui-spec.md §0, §4.1, §5.
 *
 * Handles ArrowLeft/Right/Up/Down/Home/End itself (rather than relying on
 * the browser's native `<input type=range>` keyboard stepping) so behaviour
 * is identical across browsers and unit-testable in jsdom.
 */
import type { CSSProperties, KeyboardEvent } from 'react';
import { HORIZON_STOPS, horizonTickLabel, horizonDurationLabel, fmtLocalTime } from '../../lib/time.js';
import { COPY } from '../../lib/constants.js';

export interface HorizonSliderProps {
  /** Index into `HORIZON_STOPS`, 0..6. */
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  cityTz: string;
  now: Date;
}

const MAX_INDEX = HORIZON_STOPS.length - 1;

export function readoutFor(value: number): string {
  const minutes = HORIZON_STOPS[value] ?? 0;
  return value === 0 ? COPY.horizon.now : COPY.horizon.in(horizonDurationLabel(minutes));
}

export function HorizonSlider({ value, onChange, disabled = false, cityTz, now }: HorizonSliderProps) {
  const minutes = HORIZON_STOPS[value] ?? 0;
  const readout = readoutFor(value);
  const target = new Date(now.getTime() + minutes * 60_000);
  const absolute = fmtLocalTime(target, cityTz);
  const pct = (value / MAX_INDEX) * 100;

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      onChange(Math.min(MAX_INDEX, value + 1));
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      onChange(Math.max(0, value - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      onChange(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      onChange(MAX_INDEX);
    }
  }

  const fillStyle: CSSProperties = { width: `${pct}%` };

  return (
    <div className="flex flex-col gap-2">
      <span className="font-[var(--font-display)] text-[length:var(--fs-xl)] font-semibold text-ink">
        {readout}
      </span>
      <p className="text-[length:var(--fs-sm)] text-ink-3">{`= ${absolute}`}</p>

      <div className="relative flex h-5 items-center">
        <div className="pointer-events-none absolute inset-x-0 h-1 rounded-[var(--r-pill)] bg-rule-strong" />
        <div
          className="pointer-events-none absolute h-1 rounded-[var(--r-pill)] bg-signal"
          style={fillStyle}
        />
        <input
          type="range"
          min={0}
          max={MAX_INDEX}
          step={1}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
          onKeyDown={onKeyDown}
          aria-label="Forecast horizon"
          aria-valuetext={readout}
          className="relative z-10 w-full appearance-none bg-transparent [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-signal [&::-moz-range-thumb]:bg-surface [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-signal [&::-webkit-slider-thumb]:bg-surface"
        />
      </div>

      <div className="flex justify-between text-[length:var(--fs-xs)] text-ink-3" aria-hidden="true">
        {HORIZON_STOPS.map((m) => (
          <span key={m}>{horizonTickLabel(m)}</span>
        ))}
      </div>
    </div>
  );
}
