import { describe, expect, it } from 'vitest';
import {
  bucketOf,
  localDateString,
  localParts,
  nextOccurrence,
  zonedTimeToUtc,
} from '../src/time.js';

const TORONTO = 'America/Toronto';

describe('localParts', () => {
  it('reads wall-clock components in the given tz (EDT, summer)', () => {
    // 2026-08-17T15:30:00Z = 11:30 EDT (UTC-4)
    const parts = localParts(new Date('2026-08-17T15:30:00Z'), TORONTO);
    expect(parts).toEqual({
      year: 2026,
      month: 8,
      day: 17,
      dow: 0, // Monday (2026-08-17 is a Monday)
      minuteOfDay: 11 * 60 + 30,
      hour: 11,
      minute: 30,
    });
  });

  it('reads wall-clock components in the given tz (EST, winter)', () => {
    // 2026-01-15T15:30:00Z = 10:30 EST (UTC-5)
    const parts = localParts(new Date('2026-01-15T15:30:00Z'), TORONTO);
    expect(parts.hour).toBe(10);
    expect(parts.minute).toBe(30);
  });

  it('dow is 0=Monday..6=Sunday', () => {
    // 2026-08-16 is a Sunday in Toronto (well within the day, no boundary risk).
    const sunday = localParts(new Date('2026-08-16T18:00:00Z'), TORONTO);
    expect(sunday.dow).toBe(6);
    // 2026-08-17 is a Monday.
    const monday = localParts(new Date('2026-08-17T18:00:00Z'), TORONTO);
    expect(monday.dow).toBe(0);
  });
});

describe('bucketOf', () => {
  it('maps minute-of-day to a 15-minute bucket 0..95', () => {
    expect(bucketOf(0)).toBe(0);
    expect(bucketOf(14)).toBe(0);
    expect(bucketOf(15)).toBe(1);
    expect(bucketOf(1439)).toBe(95);
  });
});

describe('localDateString', () => {
  it('formats YYYY-MM-DD in the given tz', () => {
    // 2026-08-17T02:30:00Z = 2026-08-16 22:30 EDT (previous local day)
    expect(localDateString(new Date('2026-08-17T02:30:00Z'), TORONTO)).toBe('2026-08-16');
    expect(localDateString(new Date('2026-08-17T15:30:00Z'), TORONTO)).toBe('2026-08-17');
  });
});

describe('zonedTimeToUtc', () => {
  it('converts a local wall time to the correct UTC instant (EDT)', () => {
    const utc = zonedTimeToUtc({ year: 2026, month: 8, day: 17 }, '08:15', TORONTO);
    expect(utc.toISOString()).toBe('2026-08-17T12:15:00.000Z');
  });

  it('converts a local wall time to the correct UTC instant (EST)', () => {
    const utc = zonedTimeToUtc({ year: 2026, month: 1, day: 15 }, '08:15', TORONTO);
    expect(utc.toISOString()).toBe('2026-01-15T13:15:00.000Z');
  });
});

describe('nextOccurrence', () => {
  it('returns today at hhmm when that time has not passed yet ("today later")', () => {
    // 2026-06-10 10:00 EDT; 2026-06-10 is a Wednesday (dow=2).
    const now = new Date('2026-06-10T14:00:00Z'); // 10:00 EDT
    const result = nextOccurrence(now, TORONTO, '14:30', [2]);
    expect(result).not.toBeNull();
    const parts = localParts(result as Date, TORONTO);
    expect(parts).toMatchObject({ year: 2026, month: 6, day: 10, hour: 14, minute: 30, dow: 2 });
  });

  it('skips to the next allowed day when hhmm has already passed today', () => {
    const now = new Date('2026-06-10T14:00:00Z'); // 10:00 EDT, Wednesday
    const result = nextOccurrence(now, TORONTO, '08:00', [2]); // only Wednesdays
    expect(result).not.toBeNull();
    const parts = localParts(result as Date, TORONTO);
    // next Wednesday is 2026-06-17
    expect(parts).toMatchObject({ year: 2026, month: 6, day: 17, hour: 8, minute: 0, dow: 2 });
  });

  it('returns null when daysOfWeek is empty', () => {
    expect(nextOccurrence(new Date(), TORONTO, '08:00', [])).toBeNull();
  });

  it('finds an occurrence on any allowed day within the week when every day qualifies', () => {
    const now = new Date('2026-06-10T14:00:00Z');
    const result = nextOccurrence(now, TORONTO, '14:30', [0, 1, 2, 3, 4, 5, 6]);
    const parts = localParts(result as Date, TORONTO);
    expect(parts).toMatchObject({ month: 6, day: 10, hour: 14, minute: 30 });
  });

  it('DST spring-forward (2026-03-08): consecutive occurrences are 23h apart in UTC', () => {
    // 2026-03-08 is the "spring forward" Sunday in America/Toronto (EST -05:00 -> EDT -04:00).
    // Saturday 2026-03-07 08:15 EST and Sunday 2026-03-08 08:15 EDT.
    const beforeMarch7 = new Date('2026-03-07T06:00:00-05:00'); // before 08:15 local on the 7th
    const march7 = nextOccurrence(beforeMarch7, TORONTO, '08:15', [0, 1, 2, 3, 4, 5, 6]);
    expect(march7).not.toBeNull();
    expect((march7 as Date).toISOString()).toBe('2026-03-07T13:15:00.000Z'); // 08:15 EST = 13:15Z

    const justAfterMarch7 = new Date((march7 as Date).getTime() + 60_000);
    const march8 = nextOccurrence(justAfterMarch7, TORONTO, '08:15', [0, 1, 2, 3, 4, 5, 6]);
    expect(march8).not.toBeNull();
    expect((march8 as Date).toISOString()).toBe('2026-03-08T12:15:00.000Z'); // 08:15 EDT = 12:15Z

    const gapHours = ((march8 as Date).getTime() - (march7 as Date).getTime()) / 3_600_000;
    expect(gapHours).toBe(23);

    // The local wall time is exactly 08:15 on both sides of the transition.
    expect(localParts(march7 as Date, TORONTO)).toMatchObject({ hour: 8, minute: 15 });
    expect(localParts(march8 as Date, TORONTO)).toMatchObject({ hour: 8, minute: 15 });
  });

  it('DST fall-back (2026-11-01): consecutive occurrences are 25h apart in UTC', () => {
    // 2026-11-01 is the "fall back" Sunday in America/Toronto (EDT -04:00 -> EST -05:00).
    // Saturday 2026-10-31 08:15 EDT and Sunday 2026-11-01 08:15 EST.
    const beforeOct31 = new Date('2026-10-31T06:00:00-04:00');
    const oct31 = nextOccurrence(beforeOct31, TORONTO, '08:15', [0, 1, 2, 3, 4, 5, 6]);
    expect(oct31).not.toBeNull();
    expect((oct31 as Date).toISOString()).toBe('2026-10-31T12:15:00.000Z'); // 08:15 EDT = 12:15Z

    const justAfterOct31 = new Date((oct31 as Date).getTime() + 60_000);
    const nov1 = nextOccurrence(justAfterOct31, TORONTO, '08:15', [0, 1, 2, 3, 4, 5, 6]);
    expect(nov1).not.toBeNull();
    expect((nov1 as Date).toISOString()).toBe('2026-11-01T13:15:00.000Z'); // 08:15 EST = 13:15Z

    const gapHours = ((nov1 as Date).getTime() - (oct31 as Date).getTime()) / 3_600_000;
    expect(gapHours).toBe(25);

    expect(localParts(oct31 as Date, TORONTO)).toMatchObject({ hour: 8, minute: 15 });
    expect(localParts(nov1 as Date, TORONTO)).toMatchObject({ hour: 8, minute: 15 });
  });
});
