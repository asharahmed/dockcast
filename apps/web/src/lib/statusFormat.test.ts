import { describe, expect, it } from 'vitest';
import {
  fmtDate,
  fmtDeployed,
  fmtMinAgo,
  fmtMinutes,
  fmtPct,
  overallLabel,
  progressBar,
  stripGlyphs,
  stripSummary,
  updatesTable,
} from './statusFormat.js';
import { statusResponseFixture } from '../mocks/fixtures.js';

describe('progressBar', () => {
  it('fills whole cells and an eighth-block tail', () => {
    expect(progressBar(0, 10)).toBe('░'.repeat(10));
    expect(progressBar(100, 10)).toBe('█'.repeat(10));
    expect(progressBar(45, 10)).toBe('████▌░░░░░');
    expect(progressBar(45, 10)).toHaveLength(10);
  });
  it('clamps out-of-range input', () => {
    expect(progressBar(150, 4)).toBe('████');
    expect(progressBar(-5, 4)).toBe('░░░░');
  });
});

describe('formatters', () => {
  it('formats ages', () => {
    expect(fmtMinAgo(null)).toBe('never');
    expect(fmtMinAgo(0)).toBe('just now');
    expect(fmtMinAgo(5)).toBe('5 min ago');
    expect(fmtMinAgo(180)).toBe('3 h ago');
    expect(fmtMinAgo(3 * 1440)).toBe('3 d ago');
  });
  it('formats the deployed age', () => {
    expect(fmtDeployed({ value: 3, unit: 'days' })).toBe('3 days ago');
    expect(fmtDeployed({ value: 1, unit: 'hours' })).toBe('1 hour ago');
    expect(fmtDeployed({ value: 0, unit: 'minutes' })).toBe('just now');
  });
  it('formats dates without a time or zone shift', () => {
    expect(fmtDate('2026-10-27')).toBe('Oct 27');
    expect(fmtDate('2026-01-01')).toBe('Jan 1');
    expect(fmtDate('garbage')).toBe('--');
  });
  it('formats durations in whole minutes and percentages to one decimal', () => {
    expect(fmtMinutes(41)).toBe('41 min');
    expect(fmtMinutes(65)).toBe('1 h 05 min');
    expect(fmtMinutes(null)).toBe('--');
    expect(fmtPct(99.9)).toBe('99.9%');
    expect(fmtPct(100)).toBe('100.0%');
    expect(fmtPct(null)).toBe('--');
  });
  it('labels the overall state', () => {
    expect(overallLabel('operational')).toBe('all systems operational');
    expect(overallLabel('degraded')).toBe('degraded performance');
    expect(overallLabel('down')).toBe('service disruption');
  });
});

describe('day strips', () => {
  it('maps cells to glyphs and summarises them for screen readers', () => {
    expect(stripGlyphs(['ok', 'down', 'none'])).toEqual(['✔', '✘', '·']);
    expect(stripSummary(['ok', 'ok', 'down', 'none'])).toBe('2 days up, 1 days with downtime, 1 days without data');
  });
});

describe('updatesTable', () => {
  it('renders aligned rows with result glyphs', () => {
    const lines = updatesTable(statusResponseFixture.model_updates);
    expect(new Set(lines.map((l) => l.length)).size).toBe(1);
    const text = lines.join('\n');
    expect(text).toContain('✔');
    expect(text).toContain('✘');
    expect(text).toContain('Aug 16');
    expect(text).toContain('28 min');
  });
});
