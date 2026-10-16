/**
 * `/privacy` — privacy policy (ui-spec.md §4.9). Every statement here describes what the
 * code does; when data handling changes (new table, log field, third party), update this
 * page and its `PRIVACY_UPDATED` date in the same change.
 *
 * Sources: db/migrations (users, auth_identities, commutes, push_subscriptions,
 * alert_events, session), apps/api middleware/session.ts (cookie), app.ts (request log
 * redaction), auth/googleOidc.ts + appleOidc.ts (scopes), lib/theme.ts + hooks/useCity.ts
 * (local storage), sw/sw.template.js (on-device caches), infra/docker-compose.yml (log
 * rotation).
 */
import { Link } from 'react-router';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { CONTACT_EMAIL, ISSUES_URL, REPO_URL } from '../lib/site.js';

export const PRIVACY_UPDATED = '16 October 2026';

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[length:var(--fs-lg)] text-ink">{children}</h2>;
}

const linkClass = 'text-signal underline underline-offset-4';

export default function PrivacyPage() {
  useDocumentTitle('Privacy · DockCast');

  return (
    <article className="mx-auto flex max-w-[68ch] flex-col gap-[var(--sp-6)] px-[var(--gutter)] py-[var(--sp-8)] text-ink-2">
      <header className="flex flex-col gap-2">
        <h1 className="text-[length:var(--fs-2xl)] text-ink">Privacy policy</h1>
        <p className="text-[length:var(--fs-sm)] text-ink-3">Last updated {PRIVACY_UPDATED}</p>
      </header>

      <section className="flex flex-col gap-3">
        <p>
          DockCast is a non-commercial project that forecasts bike-share availability. Its code is
          public on{' '}
          <a href={REPO_URL} className={linkClass}>
            GitHub
          </a>
          , so anything described here can be checked against what it actually does.
        </p>
        <p className="text-ink">
          The short version: the map, station pages and trip check work without an account. There
          are no ads, no analytics, no tracking cookies, and your data is never sold or shared for
          marketing.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <H2>What DockCast collects</H2>
        <p>
          <strong className="text-ink">Everyone.</strong> Like any website, the server logs each
          request: your IP address (as forwarded by Cloudflare), your browser&rsquo;s user agent,
          the page or data requested, and the time. These logs exist to run the service, stop
          abuse and fix bugs. Sign-in cookies are removed from the logs before they are written.
          IP addresses are also held briefly in memory to rate-limit sign-in attempts and trip
          checks.
        </p>
        <p>
          <strong className="text-ink">If you create an account.</strong> Your email address; your
          password, stored only as an argon2id hash, never in readable form; when the account was
          created and when you last signed in. If you sign in with Google or Apple, DockCast asks
          them only for your email address and receives an account identifier it uses to
          recognise you next time. It does not get your name, contacts or anything else.
        </p>
        <p>
          <strong className="text-ink">Saved commutes.</strong> Each commute&rsquo;s name, start
          and end stations, departure time, days, ride time and alert settings. Together these show
          where and when you usually ride, so they are visible only to you.
        </p>
        <p>
          <strong className="text-ink">Alerts.</strong> If you turn on alerts on a device, the push
          address and keys your browser creates for DockCast, plus that browser&rsquo;s user agent
          so you can tell your devices apart. Each alert sent is recorded with its date and
          contents, so you get at most one per commute per day.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <H2>Cookies and storage on your device</H2>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>
            One cookie, <code className="text-ink">dockcast.sid</code>, set only when you sign in.
            It keeps you signed in, is not readable by scripts, and expires 30 days after you last
            use DockCast.
          </li>
          <li>
            Two local-storage entries: your light/dark theme choice and the city you picked.
          </li>
          <li>
            If your browser runs DockCast as an app or you have visited before, public data (map
            tiles, station data and the app&rsquo;s own files) is cached on your device so it keeps
            working offline. Clearing this site&rsquo;s data in your browser removes all of it.
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <H2>How it is used</H2>
        <p>
          Only to provide DockCast itself: signing you in, saving your commutes, sending the
          alerts you asked for, keeping the service secure, and fixing problems. It is not used
          for advertising or profiling, and it is not sold, rented or traded.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <H2>Services that see some of your data</H2>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>
            <strong className="text-ink">Cloudflare</strong> carries all traffic to
            dockcast.aahmed.ca (encryption and routing), so it handles your IP address and
            requests.
          </li>
          <li>
            <strong className="text-ink">OpenFreeMap</strong> serves the map. Your browser loads map
            tiles from tiles.openfreemap.org directly, which sees your IP address and browser.
          </li>
          <li>
            <strong className="text-ink">Google and Apple</strong>, only if you choose to sign in
            with them. Their own privacy policies cover that sign-in.
          </li>
          <li>
            <strong className="text-ink">Your browser&rsquo;s push service</strong> (run by Google,
            Apple or Mozilla, depending on your browser) delivers alerts to your device. DockCast
            sends it the alert text.
          </li>
        </ul>
        <p>
          Station data from Bike Share Toronto and weather from Open-Meteo are fetched by the
          server. No information about you is sent to them.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <H2>Where it is stored and for how long</H2>
        <p>
          Everything is stored in a database on a server in Canada run by DockCast&rsquo;s
          operator.
        </p>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>Your account, commutes and linked sign-ins: until you delete them or your account.</li>
          <li>Sign-in sessions: 30 days after you last use DockCast.</li>
          <li>
            Alert devices: until you turn alerts off on that device, the push service reports it
            gone, or you delete your account.
          </li>
          <li>Records of sent alerts: as long as the commute they belong to.</li>
          <li>
            Server logs: rotated automatically by size, so older entries are overwritten as new
            ones arrive.
          </li>
        </ul>
        <p>Deleted data can remain in database backups until those backups are replaced.</p>
      </section>

      <section className="flex flex-col gap-3">
        <H2>Your choices</H2>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>Delete any commute, or turn alerts off on any device, at any time.</li>
          <li>
            Disconnect Google or Apple sign-in from your{' '}
            <Link to="/account" className={linkClass}>
              account page
            </Link>
            .
          </li>
          <li>
            Delete your account from the{' '}
            <Link to="/account" className={linkClass}>
              account page
            </Link>
            . This immediately removes your account, commutes, alert history, alert devices and
            linked sign-ins, and signs you out on every device. It cannot be undone.
          </li>
          <li>
            To ask what is stored about you, correct it, or anything else about your data,{' '}
            {CONTACT_EMAIL ? (
              <>
                email{' '}
                <a href={`mailto:${CONTACT_EMAIL}`} className={linkClass}>
                  {CONTACT_EMAIL}
                </a>{' '}
                or{' '}
              </>
            ) : null}
            open an issue on{' '}
            <a href={ISSUES_URL} className={linkClass}>
              GitHub
            </a>
            . Issues are public, so don&rsquo;t include personal details there; a private way to
            reply will be arranged.
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <H2>Security</H2>
        <p>
          All traffic is encrypted with HTTPS. Passwords are stored only as salted hashes, the
          sign-in cookie can&rsquo;t be read by scripts, and session tokens are never written to
          logs.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <H2>Children</H2>
        <p>
          DockCast is not aimed at children under 13, and accounts are not knowingly created for
          them.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <H2>Changes</H2>
        <p>
          Changes to this policy are posted on this page with a new date at the top. The full
          history is in the public repository.
        </p>
      </section>
    </article>
  );
}
