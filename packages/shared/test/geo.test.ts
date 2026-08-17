import { describe, expect, it } from 'vitest';
import { haversineKm, rideMinutesDefault } from '../src/geo.js';

// Toronto Union Station -> CN Tower, docs/plan.md WP-2 test spec: ~0.6 km (+/- 0.05).
const UNION_STATION = { lat: 43.6453, lon: -79.3806 };
const CN_TOWER = { lat: 43.6426, lon: -79.3871 };

describe('haversineKm', () => {
  it('matches the known Union Station -> CN Tower distance', () => {
    const km = haversineKm(UNION_STATION, CN_TOWER);
    expect(km).toBeGreaterThanOrEqual(0.55);
    expect(km).toBeLessThanOrEqual(0.65);
  });

  it('is symmetric', () => {
    expect(haversineKm(UNION_STATION, CN_TOWER)).toBeCloseTo(haversineKm(CN_TOWER, UNION_STATION));
  });

  it('is zero for identical points', () => {
    expect(haversineKm(UNION_STATION, UNION_STATION)).toBeCloseTo(0);
  });
});

describe('rideMinutesDefault', () => {
  it('enforces a minimum of 5 minutes for very close stations', () => {
    const a = { lat: 43.6453, lon: -79.3806 };
    const b = { lat: 43.6453001, lon: -79.3806001 }; // a few metres away
    expect(rideMinutesDefault(a, b)).toBe(5);
  });

  it('matches max(5, round(km/12*60+3)) for a longer ride', () => {
    const km = haversineKm(UNION_STATION, CN_TOWER);
    const expected = Math.max(5, Math.round((km / 12) * 60 + 3));
    expect(rideMinutesDefault(UNION_STATION, CN_TOWER)).toBe(expected);
  });
});
