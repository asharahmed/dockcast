import { describe, expect, it } from 'vitest';
import { rideMinutesDefault, walkMinutes } from './geo.js';

// Known station pair from packages/shared fixtures: Union Station -> Yonge/Wellesley.
const unionStation = { lat: 43.6453, lon: -79.3806 };
const yongeWellesley = { lat: 43.6659, lon: -79.3835 };
const bayCollege = { lat: 43.6598, lon: -79.3894 };

describe('rideMinutesDefault', () => {
  it('is max(5, round(km/12*60+3)) for Union Station -> Yonge/Wellesley', () => {
    expect(rideMinutesDefault(unionStation, yongeWellesley)).toBe(15);
  });

  it('is max(5, round(km/12*60+3)) for Union Station -> Bay/College', () => {
    expect(rideMinutesDefault(unionStation, bayCollege)).toBe(12);
  });

  it('floors at 5 minutes for very close stations', () => {
    expect(rideMinutesDefault(unionStation, unionStation)).toBe(5);
  });
});

describe('walkMinutes', () => {
  it('is ceil(m / 80)', () => {
    expect(walkMinutes(240)).toBe(3);
    expect(walkMinutes(241)).toBe(4);
    expect(walkMinutes(80)).toBe(1);
  });
});
