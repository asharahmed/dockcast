/**
 * `/about`. ui-spec.md §4.7.
 *
 * SPEC-GAP: "What this is" (2 paragraphs) and "How the forecast works"
 * (3 short paragraphs) are specified by outline only, not verbatim copy;
 * the text below follows the outline and reuses language already used
 * elsewhere in the specs (architecture.md §1, ml-spec.md pipeline). Every
 * other section here is the spec's exact quoted text.
 */
import { Link } from 'react-router';
import { COPY } from '../lib/constants.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { InstallCard } from '../components/shell/InstallCard.js';

const REPO_URL = (import.meta.env.VITE_REPO_URL as string | undefined) ?? '';

export default function AboutPage() {
  useDocumentTitle('About · DockCast');

  return (
    <div className="mx-auto flex max-w-[68ch] flex-col gap-[var(--sp-7)] px-[var(--gutter)] py-[var(--sp-8)]">
      <h1 className="text-[length:var(--fs-2xl)]">{COPY.about.title}</h1>

      <InstallCard />

      <section className="flex flex-col gap-3">
        <h2 className="text-[length:var(--fs-lg)]">What this is</h2>
        <p className="text-ink-2">
          DockCast forecasts bike-share availability for when you'll actually be at the station,
          not just what it looks like right now. Check the map before you ride, or save a commute
          and get an alert before you leave.
        </p>
        <p className="text-ink-2">
          It's built on open GBFS station data and each city's own ridership history, with a
          public page tracking how accurate the forecasts have been.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[length:var(--fs-lg)]">How the forecast works</h2>
        <p className="text-ink-2">
          Every station reports its live state (bikes, docks, e-bikes) every 60 seconds. That's
          the ground truth behind the "now" you see on the map and station pages.
        </p>
        <p className="text-ink-2">
          Further out, a flow model trained on a year of trip history and the weather estimates
          how each station fills and empties.
        </p>
        <p className="text-ink-2">
          Once there's enough data, a learned model trained on our own snapshots takes over. It
          has to beat the flow model on days it hasn't seen before it's allowed to serve. See{' '}
          <Link to="/model" className="text-signal underline underline-offset-4">
            how good the forecasts are
          </Link>
          .
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[length:var(--fs-lg)]">What it&rsquo;s not</h2>
        <p className="text-ink-2">
          No large language models are involved anywhere. Forecasts are computed by our own models
          from open data. They will be wrong for parades, breakdowns and rebalancing vans.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[length:var(--fs-lg)]">Data &amp; licences</h2>
        <ul className="list-disc pl-5 text-ink-2">
          <li>Bike Share Toronto GBFS via PBSC/Toronto Parking Authority</li>
          <li>Toronto Open Data ridership (Open Government Licence – Toronto)</li>
          <li>Open-Meteo (CC BY 4.0)</li>
          <li>OpenFreeMap / OpenMapTiles / © OpenStreetMap contributors</li>
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[length:var(--fs-lg)]">Privacy</h2>
        <p className="text-ink-2">
          We store your email, password hash, commutes and push subscriptions. Nothing else. No
          analytics.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[length:var(--fs-lg)]">Source</h2>
        {REPO_URL ? (
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-signal underline underline-offset-4"
          >
            View source on GitHub
          </a>
        ) : (
          <p className="text-ink-3">Source link not configured.</p>
        )}
      </section>
    </div>
  );
}
