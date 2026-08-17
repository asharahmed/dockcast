import { describe, expect, it } from 'vitest';
import { diffChanged, equal, type ChangeCandidate } from '../src/status.js';
import type { LastState } from '../src/gbfs/types.js';

function state(overrides: Partial<LastState> = {}): LastState {
  return {
    bikes: 3,
    docks: 5,
    ebikes: 1,
    bikes_disabled: 0,
    docks_disabled: 0,
    is_installed: true,
    is_renting: true,
    is_returning: true,
    last_reported: 1_700_000_000_000,
    ...overrides,
  };
}

describe('equal', () => {
  it('is true for two identical states', () => {
    expect(equal(state(), state())).toBe(true);
  });

  it('is false when bikes differs', () => {
    expect(equal(state(), state({ bikes: 4 }))).toBe(false);
  });

  it('is false when only last_reported differs', () => {
    expect(equal(state(), state({ last_reported: 1_700_000_060_000 }))).toBe(false);
  });

  it('treats ebikes null vs null as unchanged', () => {
    expect(equal(state({ ebikes: null }), state({ ebikes: null }))).toBe(true);
  });

  it('is false when prev is undefined (station absent from the map)', () => {
    expect(equal(undefined, state())).toBe(false);
  });
});

describe('diffChanged', () => {
  function candidate(station_pk: number, overrides: Partial<LastState> = {}): ChangeCandidate {
    return { station_pk, state: state(overrides) };
  }

  it('reports 0 changed when every row matches the map', () => {
    const lastMap = new Map([[1, state()], [2, state()]]);
    const rows = [candidate(1), candidate(2)];
    expect(diffChanged(lastMap, rows)).toHaveLength(0);
  });

  it('reports 1 changed when a single field (bikes) differs', () => {
    const lastMap = new Map([[1, state()], [2, state()]]);
    const rows = [candidate(1), candidate(2, { bikes: 4 })];
    const changed = diffChanged(lastMap, rows);
    expect(changed).toHaveLength(1);
    expect(changed[0]?.station_pk).toBe(2);
  });

  it('reports 1 changed when only last_reported differs', () => {
    const lastMap = new Map([[1, state()]]);
    const rows = [candidate(1, { last_reported: 1_700_000_060_000 })];
    expect(diffChanged(lastMap, rows)).toHaveLength(1);
  });

  it('treats a station absent from the map as changed', () => {
    const lastMap = new Map<number, LastState>();
    const rows = [candidate(1)];
    expect(diffChanged(lastMap, rows)).toHaveLength(1);
  });
});
