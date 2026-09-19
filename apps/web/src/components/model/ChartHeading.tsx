/**
 * Title row for the /model charts, with the "scored through <day>" note a chart carries
 * when its window is behind the newest day in `metrics` (ui-spec.md §4.5).
 *
 * `chartCaption` builds the same text for the `ChartTable` twin: that caption is the
 * table's accessible name (ui-spec.md §2.5), so it cannot drop a note the heading shows.
 */
import { COPY } from '../../lib/constants.js';
import { fmtWindowThroughShort } from '../../lib/time.js';

function note(asOf: string): string {
  return COPY.model.charts.asOf(fmtWindowThroughShort(asOf));
}

export function chartCaption(title: string, asOf: string | null): string {
  return asOf === null ? title : `${title} · ${note(asOf)}`;
}

export interface ChartHeadingProps {
  title: string;
  /** `staleDay(...)` for the chart's rows: the day they cover, or null when current. */
  asOf: string | null;
}

export function ChartHeading({ title, asOf }: ChartHeadingProps) {
  return (
    <h3 className="text-[length:var(--fs-md)] font-medium">
      {title}
      {asOf !== null && (
        <span className="ml-1 font-normal text-[length:var(--fs-sm)] text-ink-2">
          · {note(asOf)}
        </span>
      )}
    </h3>
  );
}
