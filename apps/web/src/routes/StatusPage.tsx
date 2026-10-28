/**
 * `/status`. ui-spec.md §4.10. Public, terminal-styled overall status of DockCast, fed by
 * `GET /status`. It renders only what the API sends: coarse states, whole minutes, dates.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { StatusDayCell, StatusState } from '@dockcast/shared';
import type { StatusResponse } from '../api/types.js';
import { useStatus } from '../api/queries.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import {
  SPINNER_FRAMES,
  fmtDate,
  fmtDeployed,
  fmtMinAgo,
  fmtPct,
  overallLabel,
  progressBar,
  stripGlyphs,
  stripSummary,
  updatesTable,
} from '../lib/statusFormat.js';
import '../styles/status.css';

type Tone = 'green' | 'red' | 'amber' | 'dim';

const TONE: Record<StatusState, Tone> = { operational: 'green', degraded: 'amber', down: 'red' };

function Dot({ tone }: { tone: Tone }) {
  return (
    <span className={`t-${tone}`} aria-hidden="true">
      ●
    </span>
  );
}

/** Re-renders every `ms` while `active`; drives the spinner. */
function useTick(active: boolean, ms: number): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setN((v) => v + 1), ms);
    return () => window.clearInterval(id);
  }, [active, ms]);
  return n;
}

function Running({
  running,
  reduceMotion,
  barWidth,
}: {
  running: NonNullable<StatusResponse['models']['running']>;
  reduceMotion: boolean;
  barWidth: number;
}) {
  const spin = useTick(!reduceMotion, 100);
  const pct = running.percent;
  const glyph = reduceMotion ? '*' : SPINNER_FRAMES[spin % SPINNER_FRAMES.length];
  return (
    <>
      <p className="t-block">
        <span className="t-bar" aria-hidden="true">
          {pct === null ? '░'.repeat(barWidth) : progressBar(pct, barWidth)}
        </span>{' '}
        <span>{pct === null ? '  --%' : `${String(pct).padStart(3)}%`}</span>
      </p>
      <p className="t-block">
        <span className="t-cyan" aria-hidden="true">
          {glyph}
        </span>{' '}
        {running.stage}
        <span className="t-dim">
          {running.eta_min === null ? '' : ` · ${running.eta_min < 1 ? 'under a minute' : `about ${running.eta_min} min`} left`}
        </span>
      </p>
    </>
  );
}

interface Unit {
  tone: Tone;
  name: string;
  state: string;
  detail: string;
}

function units(d: StatusResponse): Unit[] {
  const m = d.models;
  return [
    {
      tone: TONE[d.website.state],
      name: 'website',
      state: d.website.state,
      detail: d.website.latency ? `${d.website.latency} responses` : '',
    },
    {
      tone: TONE[d.stations.state],
      name: 'station data',
      state: d.stations.state,
      detail: `updated ${fmtMinAgo(d.stations.updated_min_ago)}`,
    },
    {
      tone: TONE[d.forecasts.state],
      name: 'forecasts',
      state: d.forecasts.state,
      detail: `updated ${fmtMinAgo(d.forecasts.updated_min_ago)}`,
    },
    {
      tone: TONE[m.state],
      name: 'model updates',
      state: m.state,
      detail: m.last_update_date ? `last ${fmtDate(m.last_update_date)}` : 'none yet',
    },
    { tone: TONE[d.database.state], name: 'database', state: d.database.state, detail: '' },
  ];
}

function Strip({ label, cells, width }: { label: string; cells: StatusDayCell[]; width: number }) {
  const glyphs = stripGlyphs(cells);
  return (
    <p className="t-block" role="img" aria-label={`${label}, last 14 days: ${stripSummary(cells)}`}>
      <span aria-hidden="true">
        {label.padEnd(width)}{' '}
        {glyphs.map((g, i) => (
          <span key={i} className={g === '✔' ? 't-green' : g === '✘' ? 't-red' : 't-dim'}>
            {g}
          </span>
        ))}
      </span>
    </p>
  );
}

/** Phrase announced to screen readers; changes only when the overall state or stage does. */
function announcement(d: StatusResponse | undefined): string {
  if (!d) return '';
  const run = d.models.running;
  const label = overallLabel(d.overall);
  return `${label[0]!.toUpperCase()}${label.slice(1)}.${run ? ` Model update: ${run.stage}.` : ''}`;
}

export default function StatusPage() {
  useDocumentTitle('Status · DockCast');
  const { data, isError } = useStatus();
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const narrow = useMediaQuery('(max-width: 520px)');

  const [live, setLive] = useState('');
  const lastSpoken = useRef('');
  const next = announcement(data);
  useEffect(() => {
    if (next && next !== lastSpoken.current) {
      lastSpoken.current = next;
      setLive(next);
    }
  }, [next]);

  const labelW = 14;
  return (
    <div className="term">
      <div className="term-inner">
        <h1>
          $ dockcast status<span className="t-cursor" aria-hidden="true" />
        </h1>
        <div role="status" aria-live="polite" className="visually-hidden">
          {live}
        </div>

        {!data && !isError && <p className="t-block t-dim">loading…</p>}
        {!data && isError && (
          <p className="t-block t-red">
            <Dot tone="red" /> cannot reach the service
          </p>
        )}
        {data && (
          <>
            {isError && (
              <p className="t-block t-amber">
                <Dot tone="amber" /> refresh failed, showing the last data received
              </p>
            )}
            <p className="t-block t-lg">
              <Dot tone={TONE[data.overall]} /> {overallLabel(data.overall)}
            </p>

            <h2>components</h2>
            {units(data).map((u) => (
              <p key={u.name} className="t-block">
                <Dot tone={u.tone} /> {u.name.padEnd(labelW)} {u.state}
                {u.detail && <span className="t-dim"> · {u.detail}</span>}
              </p>
            ))}

            {data.models.running && (
              <>
                <h2>model update</h2>
                <Running running={data.models.running} reduceMotion={reduceMotion} barWidth={narrow ? 24 : 40} />
              </>
            )}

            <h2>production</h2>
            <p className="t-block">release deployed {fmtDeployed(data.release.deployed_ago)}</p>
            <p className="t-block">
              uptime 7 days {fmtPct(data.release.uptime_7d)} · 30 days {fmtPct(data.release.uptime_30d)}
            </p>

            <h2>last 14 days</h2>
            <Strip label="website" cells={data.history.website} width={labelW} />
            <Strip label="station data" cells={data.history.stations} width={labelW} />
            <Strip label="forecasts" cells={data.history.forecasts} width={labelW} />
            <Strip label="database" cells={data.history.database} width={labelW} />
            <p className="t-block t-dim">
              {'✔ up  ✘ downtime  · no data · oldest to newest, UTC days'}
            </p>

            <h2>recent model updates</h2>
            {data.model_updates.length > 0 ? (
              <div className="t-scroll" tabIndex={0} role="region" aria-label="Recent model updates">
                <pre>{updatesTable(data.model_updates).join('\n')}</pre>
              </div>
            ) : (
              <p className="t-block t-dim">no model updates recorded yet</p>
            )}

            <p className="t-block t-dim" style={{ marginTop: 'var(--sp-5)' }}>
              <Link to="/model">model quality</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
