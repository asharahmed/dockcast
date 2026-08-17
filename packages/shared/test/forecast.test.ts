import { describe, expect, it } from 'vitest';
import { HORIZONS } from '../src/constants.js';
import { clampLead, interpolate, verdict } from '../src/forecast.js';

describe('interpolate', () => {
  const values = [0.5, 0.6, 0.7, 0.8, 0.85, 0.9];

  it('returns the exact value on-grid', () => {
    for (let i = 0; i < HORIZONS.length; i++) {
      expect(interpolate(HORIZONS, values, HORIZONS[i] as number)).toBeCloseTo(values[i] as number);
    }
  });

  it('returns the mean at the midpoint between two horizons', () => {
    // midpoint of 30 and 45 = 37.5; values there are 0.6 and 0.7 -> mean 0.65
    expect(interpolate(HORIZONS, values, 37.5)).toBeCloseTo(0.65);
  });

  it('clamps a lead below MIN_LEAD to the h=15 value', () => {
    expect(interpolate(HORIZONS, values, 5)).toBeCloseTo(0.5);
  });

  it('returns null for a lead beyond MAX_LEAD', () => {
    expect(interpolate(HORIZONS, values, 121)).toBeNull();
  });

  it('returns null when a bracketing value is null (lower bracket, h=30)', () => {
    // lead=37.5 brackets [30,45]; h=30's value is null.
    const withNull = [0.5, null, 0.7, 0.8, 0.85, 0.9];
    expect(interpolate(HORIZONS, withNull, 37.5)).toBeNull();
  });

  it('returns null when a bracketing value is null (upper bracket, h=45)', () => {
    // lead=37.5 brackets [30,45]; h=45's value is null.
    const withNull = [0.5, 0.6, null, 0.8, 0.85, 0.9];
    expect(interpolate(HORIZONS, withNull, 37.5)).toBeNull();
  });

  it('returns the exact value even when the exact horizon value is null', () => {
    const withNull = [0.5, null, 0.7, 0.8, 0.85, 0.9];
    expect(interpolate(HORIZONS, withNull, 30)).toBeNull();
  });

  it('interpolates at an arbitrary non-midpoint lead', () => {
    // between 60 (0.8) and 90 (0.85), lead=70 -> 0.8 + (0.85-0.8)*(10/30)
    expect(interpolate(HORIZONS, values, 70)).toBeCloseTo(0.8 + (0.05 * 10) / 30);
  });
});

describe('clampLead', () => {
  it('clamps below MIN_LEAD up to MIN_LEAD', () => {
    expect(clampLead(0)).toBe(15);
  });
  it('clamps above MAX_LEAD down to MAX_LEAD', () => {
    expect(clampLead(999)).toBe(120);
  });
  it('leaves an in-range lead unchanged', () => {
    expect(clampLead(45)).toBe(45);
  });
});

describe('verdict', () => {
  it('good: both legs forecast, min(p) >= 0.8', () => {
    expect(verdict(0.9, 0.85, 'forecast', 'forecast')).toBe('good');
  });

  it('risky: both legs forecast, 0.5 <= min(p) < 0.8', () => {
    expect(verdict(0.9, 0.6, 'forecast', 'forecast')).toBe('risky');
  });

  it('bad: both legs forecast, min(p) < 0.5', () => {
    expect(verdict(0.9, 0.3, 'forecast', 'forecast')).toBe('bad');
  });

  it('unknown: origin leg is not a forecast', () => {
    expect(verdict(0.9, 0.9, 'typical', 'forecast')).toBe('unknown');
  });

  it('unknown: dest leg is not a forecast', () => {
    expect(verdict(0.9, 0.9, 'forecast', 'unavailable')).toBe('unknown');
  });

  it('unknown: both legs not forecast', () => {
    expect(verdict(null, null, 'unavailable', 'typical')).toBe('unknown');
  });

  it('unknown: kind is forecast but probability is null', () => {
    expect(verdict(null, 0.9, 'forecast', 'forecast')).toBe('unknown');
  });

  it('boundary: exactly VERDICT_GOOD is good', () => {
    expect(verdict(0.8, 0.99, 'forecast', 'forecast')).toBe('good');
  });

  it('boundary: exactly VERDICT_RISKY is risky', () => {
    expect(verdict(0.5, 0.99, 'forecast', 'forecast')).toBe('risky');
  });

  it('boundary: just under VERDICT_RISKY is bad', () => {
    expect(verdict(0.4999, 0.99, 'forecast', 'forecast')).toBe('bad');
  });
});
