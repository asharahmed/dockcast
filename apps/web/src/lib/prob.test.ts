import { describe, expect, it } from 'vitest';
import { probStep, fmtPct, mapProbAt } from './prob.js';
import type { MapStation } from '../api/types.js';

describe('probStep', () => {
  it.each([
    [0.49, 0],
    [0.5, 1],
    [0.69, 1],
    [0.7, 2],
    [0.84, 2],
    [0.85, 3],
    [0.949, 3],
    [0.95, 4],
    [1, 4],
    [null, -1],
  ] as const)('probStep(%s) -> %s', (p, expected) => {
    expect(probStep(p)).toBe(expected);
  });
});

describe('fmtPct', () => {
  it.each([
    [0.995, '100%'],
    [0.004, '0%'],
    [0.415, '42%'],
  ])('fmtPct(%s) -> %s', (p, expected) => {
    expect(fmtPct(p)).toBe(expected);
  });
});

describe('mapProbAt', () => {
  const fresh: MapStation = {
    id: 1,
    b: 3,
    d: 5,
    c: 8,
    fresh: true,
    f: [
      [0.8, 0.2, 4],
      [0.7, 0.3, 3.5],
      null,
      [0.5, 0.5, 2],
      [0.4, 0.6, 1.5],
      [0.3, 0.7, 1],
    ],
  };
  const notFresh: MapStation = { ...fresh, fresh: false, b: 0, d: 0 };

  it('index 0 (now), fresh, has a bike/dock -> p=1', () => {
    expect(mapProbAt(fresh, 'bikes', 0)).toEqual({ p: 1, exp: null });
    expect(mapProbAt(fresh, 'docks', 0)).toEqual({ p: 1, exp: null });
  });

  it('index 0, fresh, zero bikes/docks -> p=0', () => {
    const zeroBikes: MapStation = { ...fresh, b: 0 };
    expect(mapProbAt(zeroBikes, 'bikes', 0)).toEqual({ p: 0, exp: null });
  });

  it('index 0, not fresh -> p=-1', () => {
    expect(mapProbAt(notFresh, 'bikes', 0)).toEqual({ p: -1, exp: null });
  });

  it('index >=1 reads the f[index-1] tuple', () => {
    expect(mapProbAt(fresh, 'bikes', 1)).toEqual({ p: 0.8, exp: 4 });
    expect(mapProbAt(fresh, 'docks', 2)).toEqual({ p: 0.3, exp: 3.5 });
  });

  it('index >=1, null entry -> p=-1', () => {
    expect(mapProbAt(fresh, 'bikes', 3)).toEqual({ p: -1, exp: null });
  });
});
