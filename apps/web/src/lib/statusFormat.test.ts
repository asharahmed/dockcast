import { describe, expect, it } from 'vitest';
import { fmtAge, fmtDuration, nextRun, progressBar, runsTable, sparkline } from './statusFormat.js';
import { statusResponseFixture } from '../mocks/fixtures.js';

describe('progressBar', () => {
  it('fills whole cells and an eighth-block tail', () => {
    expect(progressBar(0, 10)).toBe('░'.repeat(10));
    expect(progressBar(100, 10)).toBe('█'.repeat(10));
    // 45% of 10 cells = 4.5 cells = 4 full + a half block
    expect(progressBar(45, 10)).toBe('████▌░░░░░');
    expect(progressBar(45, 10)).toHaveLength(10);
    expect(progressBar(50 + 1 / 16, 10)).toHaveLength(10);
  });
  it('clamps out-of-range input', () => {
    expect(progressBar(150, 4)).toBe('████');
    expect(progressBar(-5, 4)).toBe('░░░░');
  });
});

describe('formatters', () => {
  it('formats durations and ages', () => {
    expect(fmtDuration(42)).toBe('42s');
    expect(fmtDuration(754)).toBe('12m34s');
    expect(fmtDuration(3700)).toBe('1h01m');
    expect(fmtAge(null)).toBe('never');
    expect(fmtAge(41)).toBe('41s ago');
    expect(fmtAge(600)).toBe('10m ago');
    expect(fmtAge(7200)).toBe('2h ago');
  });
  it('draws a sparkline scaled to the range, blank for gaps', () => {
    expect(sparkline([1, 8])).toBe('▁█');
    expect(sparkline([5, null, 5])).toBe('▄ ▄');
    expect(sparkline([null])).toBe('');
  });
  it('computes the next 03:30 run in Toronto time', () => {
    const summer = nextRun(new Date('2026-08-17T12:00:00Z')); // 08:00 EDT, next run in 19.5 h
    expect(summer.label).toBe('03:30 EDT');
    expect(summer.in_s).toBe(19.5 * 3600);
    expect(nextRun(new Date('2026-12-17T12:00:00Z')).label).toBe('03:30 EST');
  });
});

describe('runsTable', () => {
  it('renders aligned rows with result glyphs', () => {
    const lines = runsTable(statusResponseFixture.train.history);
    expect(new Set(lines.map((l) => l.length)).size).toBe(1);
    expect(lines.join('\n')).toContain('✔');
    expect(lines.join('\n')).toContain('✘');
    expect(lines.join('\n')).toContain('0.081');
  });
});
