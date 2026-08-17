import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseOpenMeteoForecast } from '../src/weather.js';

function loadFixture(relPath: string): unknown {
  const url = new URL(`../../../fixtures/${relPath}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
}

const forecastFixture = loadFixture('weather/openmeteo_forecast_sample.json');

describe('parseOpenMeteoForecast (§5, §8.3)', () => {
  it('parses the fixture into 72 rows', () => {
    const rows = parseOpenMeteoForecast(forecastFixture);
    expect(rows).toHaveLength(72);
  });

  it('parses valid_hour[0] as 2026-08-17T00:00:00Z', () => {
    const rows = parseOpenMeteoForecast(forecastFixture);
    expect(rows[0]?.valid_hour).toEqual(new Date('2026-08-17T00:00:00Z'));
  });

  it('preserves nulls in the numeric fields', () => {
    const doc = {
      hourly: {
        time: ['2026-08-17T00:00', '2026-08-17T01:00'],
        temperature_2m: [21.8, null],
        precipitation: [0, null],
        precipitation_probability: [17, null],
        wind_speed_10m: [6.6, null],
        weather_code: [0, null],
      },
    };
    const rows = parseOpenMeteoForecast(doc);
    expect(rows[1]).toEqual({
      valid_hour: new Date('2026-08-17T01:00:00Z'),
      temp_c: null,
      precip_mm: null,
      precip_prob: null,
      wind_kmh: null,
      weather_code: null,
    });
  });

  it('throws when the hourly arrays have unequal lengths', () => {
    const doc = {
      hourly: {
        time: ['2026-08-17T00:00', '2026-08-17T01:00'],
        temperature_2m: [21.8],
        precipitation: [0, 0],
        precipitation_probability: [17, 20],
        wind_speed_10m: [6.6, 3.6],
        weather_code: [0, 0],
      },
    };
    expect(() => parseOpenMeteoForecast(doc)).toThrow();
  });

  it('throws when hourly is missing', () => {
    expect(() => parseOpenMeteoForecast({})).toThrow();
  });
});
