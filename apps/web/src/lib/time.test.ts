import { describe, expect, it } from 'vitest';
import {
  fmtLocalTime,
  parseHHMM,
  fmtRelative,
  horizonTickLabel,
  horizonDurationLabel,
  HORIZON_STOPS,
  nextDepart,
  minutesBetween,
} from './time.js';

describe('fmtLocalTime', () => {
  it('formats an instant in the given IANA zone', () => {
    // 2026-08-17T12:41:00Z is 08:41 EDT in America/Toronto.
    expect(fmtLocalTime(new Date('2026-08-17T12:41:00Z'), 'America/Toronto')).toBe('8:41 AM');
  });
});

describe('parseHHMM', () => {
  it('parses a valid HH:MM', () => {
    expect(parseHHMM('08:15')).toEqual({ hour: 8, minute: 15 });
    expect(parseHHMM('23:59')).toEqual({ hour: 23, minute: 59 });
  });

  it('throws on malformed input', () => {
    expect(() => parseHHMM('25:00')).toThrow();
    expect(() => parseHHMM('8:15')).toThrow();
  });
});

describe('fmtRelative', () => {
  it('formats an elapsed duration with an injected now (no Date.now())', () => {
    const now = new Date('2026-08-17T12:02:00Z');
    const then = new Date('2026-08-17T12:00:00Z');
    expect(fmtRelative(then, now)).toBe('2 minutes ago');
  });
});

describe('HORIZON_STOPS', () => {
  it('has exactly 7 stops: now + the 6 HORIZONS', () => {
    expect(HORIZON_STOPS).toEqual([0, 15, 30, 45, 60, 90, 120]);
  });
});

describe('horizonTickLabel', () => {
  it.each([
    [0, 'Now'],
    [15, '15m'],
    [30, '30m'],
    [45, '45m'],
    [60, '1h'],
    [90, '1h30'],
    [120, '2h'],
  ])('horizonTickLabel(%s) -> %s', (minutes, expected) => {
    expect(horizonTickLabel(minutes)).toBe(expected);
  });
});

describe('horizonDurationLabel', () => {
  it.each([
    [15, '15 min'],
    [45, '45 min'],
    [60, '1 h'],
    [90, '1 h 30'],
    [120, '2 h'],
  ])('horizonDurationLabel(%s) -> %s', (minutes, expected) => {
    expect(horizonDurationLabel(minutes)).toBe(expected);
  });
});

describe('nextDepart', () => {
  // 2026-08-17T12:00:00Z is 08:00 EDT in America/Toronto.
  const now = new Date('2026-08-17T12:00:00Z');

  it("returns today's instant for an HH:MM later than now", () => {
    const result = nextDepart(now, 'America/Toronto', '08:15');
    expect(result.toISOString()).toBe('2026-08-17T12:15:00.000Z');
  });

  it("still returns today's (now-past) instant for an HH:MM earlier than now — caller decides the fallback", () => {
    const result = nextDepart(now, 'America/Toronto', '07:00');
    expect(result.toISOString()).toBe('2026-08-17T11:00:00.000Z');
    expect(result.getTime()).toBeLessThan(now.getTime());
  });

  it('is DST-safe across the America/Toronto spring-forward boundary (2026-03-08)', () => {
    // 2026-03-08T06:00:00Z is 01:00 EST (pre-transition) in America/Toronto.
    const beforeSpringForward = new Date('2026-03-08T06:00:00Z');
    // 03:30 local on the transition day is 07:30 UTC (EDT, UTC-4).
    const result = nextDepart(beforeSpringForward, 'America/Toronto', '03:30');
    expect(result.toISOString()).toBe('2026-03-08T07:30:00.000Z');
  });

  it('is DST-safe across the America/Toronto fall-back boundary (2026-11-01)', () => {
    // 2026-11-01T04:00:00Z is 00:00 EDT (pre-transition, unambiguous) in
    // America/Toronto; clocks fall back from 2:00 EDT to 1:00 EST that day.
    const beforeFallBack = new Date('2026-11-01T04:00:00Z');
    // 03:30 local is unambiguously post-transition (EST, UTC-5) -> 08:30 UTC.
    const result = nextDepart(beforeFallBack, 'America/Toronto', '03:30');
    expect(result.toISOString()).toBe('2026-11-01T08:30:00.000Z');
  });
});

describe('minutesBetween', () => {
  it('is (b - a) in minutes, fractional', () => {
    const a = new Date('2026-08-17T12:00:00Z');
    const b = new Date('2026-08-17T12:01:30Z');
    expect(minutesBetween(a, b)).toBe(1.5);
  });

  it('is negative when b is before a', () => {
    const a = new Date('2026-08-17T12:05:00Z');
    const b = new Date('2026-08-17T12:00:00Z');
    expect(minutesBetween(a, b)).toBe(-5);
  });
});
