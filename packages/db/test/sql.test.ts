import { describe, expect, it } from 'vitest';
import { unnestParams } from '../src/sql.js';

describe('unnestParams', () => {
  it('builds a matching placeholders fragment and column-major values', () => {
    const rowA = { station_pk: 1, ts: new Date('2026-08-17T00:00:00Z'), bikes: 3 };
    const rowB = { station_pk: 2, ts: new Date('2026-08-17T00:01:00Z'), bikes: 5 };

    const { placeholders, values } = unnestParams([rowA, rowB], [
      { name: 'station_pk', type: 'int' },
      { name: 'ts', type: 'timestamptz' },
      { name: 'bikes', type: 'smallint' },
    ]);

    expect(placeholders).toBe('unnest($1::int[], $2::timestamptz[], $3::smallint[])');
    expect(values).toEqual([
      [1, 2],
      [rowA.ts, rowB.ts],
      [3, 5],
    ]);
  });

  it('fills missing properties with null', () => {
    const rows: Record<string, unknown>[] = [{ a: 1 }, {}];
    const { values } = unnestParams(rows, [{ name: 'a', type: 'int' }]);
    expect(values).toEqual([[1, null]]);
  });

  it('handles zero rows', () => {
    const { placeholders, values } = unnestParams([], [{ name: 'a', type: 'int' }]);
    expect(placeholders).toBe('unnest($1::int[])');
    expect(values).toEqual([[]]);
  });
});
