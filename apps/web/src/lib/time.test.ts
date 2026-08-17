import { describe, expect, it } from 'vitest';
import { fmtLocalTime, parseHHMM, fmtRelative, horizonTickLabel, horizonDurationLabel, HORIZON_STOPS } from './time.js';

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
