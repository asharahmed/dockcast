/**
 * `/status`. ui-spec.md §4.10. Public, terminal-styled view of the nightly training run and
 * service health, fed by `GET /status`.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { StatusResponse, StatusTrainCurrent } from '../api/types.js';
import { useStatus } from '../api/queries.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import {
  SPINNER_FRAMES,
  fmtAge,
  fmtDuration,
  fmtMem,
  nextRun,
  phaseWords,
  progressBar,
  runsTable,
  sparkline,
} from '../lib/statusFormat.js';
import '../styles/status.css';

type Tone = 'green' | 'red' | 'amber' | 'dim';

function Dot({ tone }: { tone: Tone }) {
  return (
    <span className={`t-${tone}`} aria-hidden="true">
      ●
    </span>
  );
}

function maxPeak(current: StatusTrainCurrent): number | null {
  const peaks = current.phases.map((p) => p.peak_rss_mib).filter((p): p is number => p !== null);
  return peaks.length ? Math.max(...peaks) : null;
}

/** Re-renders every `ms` while `active`; the page uses it to tick elapsed/ETA between polls. */
function useTick(active: boolean, ms: number): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setN((v) => v + 1), ms);
    return () => window.clearInterval(id);
  }, [active, ms]);
  return n;
}

function Training({
  data,
  sinceFetchS,
  reduceMotion,
  barWidth,
}: {
  data: StatusResponse;
  sinceFetchS: number;
  reduceMotion: boolean;
  barWidth: number;
}) {
  const cur = data.train.current;
  const spin = useTick(!!cur && cur.state === 'running' && !reduceMotion, 100);

  if (!cur) {
    const next = nextRun(new Date());
    const last = data.train.history.find((r) => r.ok !== null);
    return (
      <>
        <p className="t-block">
          <Dot tone="dim" /> idle · next run {next.label}{' '}
          <span className="t-dim">(in {fmtDuration(next.in_s)})</span>
        </p>
        {last && (
          <p className="t-block t-dim">
            last run {last.ok ? '✔' : '✘'} {fmtAge(data.train.last_finished_age_s)}
            {last.duration_s !== null && <>, took {fmtDuration(last.duration_s)}</>}
            {last.peak_rss_mib !== null && <>, peak {fmtMem(last.peak_rss_mib)}</>}
          </p>
        )}
      </>
    );
  }

  const running = cur.state === 'running';
  // Between polls, tick the clock forward; a stalled run is frozen at its last sign of life.
  const elapsed = cur.elapsed_s + (running ? sinceFetchS : 0);
  const eta = cur.eta_s === null ? null : Math.max(0, cur.eta_s - (running ? sinceFetchS : 0));
  const pct = cur.percent;
  const glyph = !running ? '✘' : reduceMotion ? '*' : SPINNER_FRAMES[spin % SPINNER_FRAMES.length];

  return (
    <>
      <p className="t-block">
        <span className={`t-bar${running ? '' : ' t-stalled'}`} aria-hidden="true">
          {pct === null ? '░'.repeat(barWidth) : progressBar(pct, barWidth)}
        </span>{' '}
        <span>{pct === null ? '  --%' : `${pct.toFixed(1).padStart(5)}%`}</span>
      </p>
      <p className="t-block">
        <span className={running ? 't-cyan' : 't-red'} aria-hidden="true">
          {glyph}
        </span>{' '}
        {running ? phaseWords(cur.phase) : 'stalled: no progress update for over 10 minutes'}
      </p>
      <p className="t-block t-dim">
        elapsed {fmtDuration(elapsed)} · eta {eta === null ? '--' : `~${fmtDuration(eta)}`} · peak{' '}
        {fmtMem(maxPeak(cur))} · attempt {cur.attempt ?? '?'}/{cur.max_attempts ?? '?'}
      </p>
      {!running && (
        <p className="t-block t-amber">the trainer process was probably OOM-killed or crashed</p>
      )}
    </>
  );
}

interface Unit {
  tone: Tone;
  name: string;
  state: string;
  detail: string;
}

function units(data: StatusResponse): Unit[] {
  const { train, services } = data;
  const cur = train.current;
  const lastDone = train.history.find((r) => r.ok !== null);

  let trainer: Unit;
  if (cur) {
    trainer =
      cur.state === 'running'
        ? { tone: 'green', name: 'dockcast-train', state: 'active (running)', detail: phaseWords(cur.phase) }
        : { tone: 'red', name: 'dockcast-train', state: 'failed (stalled)', detail: 'no progress for 10m+' };
  } else if (!lastDone) {
    trainer = { tone: 'dim', name: 'dockcast-train', state: 'inactive (dead)', detail: 'no runs yet' };
  } else if (lastDone.ok === false) {
    trainer = {
      tone: 'red',
      name: 'dockcast-train',
      state: 'failed',
      detail: `last run ${fmtAge(train.last_finished_age_s)}`,
    };
  } else if ((train.last_finished_age_s ?? 0) > 36 * 3600) {
    trainer = {
      tone: 'amber',
      name: 'dockcast-train',
      state: 'active (waiting)',
      detail: `overdue, last run ${fmtAge(train.last_finished_age_s)}`,
    };
  } else {
    trainer = {
      tone: 'green',
      name: 'dockcast-train',
      state: 'active (waiting)',
      detail: `last run ${fmtAge(train.last_finished_age_s)}`,
    };
  }

  const svc = (name: string, s: { age_s: number | null; ok: boolean | null }, what: string): Unit => ({
    tone: s.ok === null ? 'dim' : s.ok ? 'green' : s.age_s !== null && s.age_s < 3600 ? 'amber' : 'red',
    name,
    state: s.ok === null ? 'unknown' : s.ok ? 'active (running)' : 'stale',
    detail: `${what} ${fmtAge(s.age_s)}`,
  });

  return [
    trainer,
    svc('dockcast-predict', services.predict, 'last cycle'),
    svc('dockcast-collector', services.collector, 'last poll'),
    {
      tone: services.db.ok ? 'green' : 'red',
      name: 'postgres',
      state: services.db.ok ? 'active (accepting connections)' : 'unreachable',
      detail: '',
    },
  ];
}

function Units({ data }: { data: StatusResponse }) {
  const list = units(data);
  const w = Math.max(...list.map((u) => u.name.length));
  return (
    <>
      {list.map((u) => (
        <p key={u.name} className="t-block">
          <Dot tone={u.tone} /> {u.name.padEnd(w)} {u.state}
          {u.detail && <span className="t-dim"> · {u.detail}</span>}
        </p>
      ))}
      <p className="t-block t-dim">
        api {data.services.api.version}
        {data.services.api.git_sha ? ` (${data.services.api.git_sha})` : ''}
      </p>
    </>
  );
}

/** Phrase announced to screen readers; changes only on phase/state transitions, never per tick. */
function announcement(data: StatusResponse | undefined): string {
  if (!data) return '';
  const cur = data.train.current;
  if (!cur) return 'Training is idle.';
  if (cur.state === 'stalled') return 'Training has stalled.';
  return `Training: ${phaseWords(cur.phase)}.`;
}

export default function StatusPage() {
  useDocumentTitle('Status · DockCast');
  const { data, isError, dataUpdatedAt } = useStatus();
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const narrow = useMediaQuery('(max-width: 520px)');
  const active = !!data?.train.current;
  useTick(active, 1000);
  const sinceFetchS = dataUpdatedAt ? Math.max(0, Math.round((Date.now() - dataUpdatedAt) / 1000)) : 0;

  const [live, setLive] = useState('');
  const lastSpoken = useRef('');
  const next = announcement(data);
  useEffect(() => {
    if (next && next !== lastSpoken.current) {
      lastSpoken.current = next;
      setLive(next);
    }
  }, [next]);

  const table = data ? runsTable(data.train.history) : [];
  const peaks = data ? [...data.train.history].reverse().map((r) => r.peak_rss_mib) : [];

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
            <Dot tone="red" /> cannot reach the api
          </p>
        )}
        {data && (
          <>
            {isError && (
              <p className="t-block t-amber">
                <Dot tone="amber" /> refresh failed, showing data from {fmtAge(sinceFetchS)}
              </p>
            )}
            <h2>training</h2>
            <Training
              data={data}
              sinceFetchS={sinceFetchS}
              reduceMotion={reduceMotion}
              barWidth={narrow ? 24 : 40}
            />

            <h2>services</h2>
            <Units data={data} />

            <h2>recent runs</h2>
            {table.length > 0 && data.train.history.length > 0 ? (
              <>
                <div className="t-scroll" tabIndex={0} role="region" aria-label="Recent training runs">
                  <pre>{table.join('\n')}</pre>
                </div>
                <p className="t-block t-dim">peak mem {sparkline(peaks)} (oldest to newest)</p>
              </>
            ) : (
              <p className="t-block t-dim">no training runs recorded yet</p>
            )}

            <p className="t-block t-dim" style={{ marginTop: 'var(--sp-5)' }}>
              updated {new Date(data.generated_at).toISOString().slice(11, 19)}Z · polling every{' '}
              {active ? '5s' : '60s'} ·{' '}
              <Link to="/model">model quality</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
