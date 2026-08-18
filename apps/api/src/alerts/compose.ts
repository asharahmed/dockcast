/**
 * `docs/api.md` §8 point 5 — alert push notification body copy, e.g.
 * `"Only 41% chance of a dock at Bay / Wellesley at 8:40. Best nearby: Yonge
 * / Wellesley (2 min walk, 93%)."`. Local times are rendered `h:mm a`,
 * matching the web client's own time formatting (`ui-spec.md`'s
 * `OutlookChip`).
 */
import { localParts } from '@dockcast/shared';
import type { AlternativeResult } from '../forecast/alternatives.js';

export type AlertKind = 'origin_low' | 'dest_low' | 'both_low';

export interface AlertLeg {
  stationName: string;
  p: number;
  at: Date;
  alternatives: readonly AlternativeResult[];
}

function formatLocalTime(date: Date, tzName: string): string {
  const { hour, minute } = localParts(date, tzName);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour < 12 ? 'AM' : 'PM';
  return `${h12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

function bestAlternativeClause(alternatives: readonly AlternativeResult[]): string {
  const best = alternatives[0];
  if (!best || best.p === null) return '';
  return ` Best nearby: ${best.station.name} (${best.walk_minutes} min walk, ${pct(best.p)}).`;
}

function legSentence(what: 'bike' | 'dock', leg: AlertLeg, tzName: string): string {
  return (
    `Only ${pct(leg.p)} chance of a ${what} at ${leg.stationName} at ${formatLocalTime(leg.at, tzName)}.` +
    bestAlternativeClause(leg.alternatives)
  );
}

/** `title` shown in the browser notification. */
export function titleForKind(kind: AlertKind): string {
  switch (kind) {
    case 'origin_low':
      return 'Low bike availability';
    case 'dest_low':
      return 'Low dock availability';
    case 'both_low':
      return 'Low bike & dock availability';
  }
}

export function composeAlertBody(args: {
  kind: AlertKind;
  tzName: string;
  origin?: AlertLeg;
  dest?: AlertLeg;
}): string {
  const sentences: string[] = [];
  if ((args.kind === 'origin_low' || args.kind === 'both_low') && args.origin) {
    sentences.push(legSentence('bike', args.origin, args.tzName));
  }
  if ((args.kind === 'dest_low' || args.kind === 'both_low') && args.dest) {
    sentences.push(legSentence('dock', args.dest, args.tzName));
  }
  return sentences.join(' ');
}
