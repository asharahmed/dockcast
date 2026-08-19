/**
 * OAuth sign-in options under the login/register forms. ui-spec.md §4.6.
 * Renders nothing unless the API reports a configured provider, so
 * deployments without OAuth credentials show the plain email form only.
 * Navigation is a full-page redirect: the OAuth handshake is a server-side
 * redirect chain, not an XHR.
 */
import { COPY } from '../../lib/constants.js';
import { useAuthProviders } from '../../api/queries.js';

/** Official Google "G" (brand colours are required by Google's guidelines). */
function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}

export function OAuthButtons({ next }: { next: string }) {
  const { data: providers } = useAuthProviders();
  if (!providers?.google) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 text-[length:var(--fs-sm)] text-ink-3">
        <span className="h-px flex-1 bg-rule" />
        {COPY.auth_pages.orDivider}
        <span className="h-px flex-1 bg-rule" />
      </div>
      <a
        href={`/api/v1/auth/google?next=${encodeURIComponent(next)}`}
        className="flex items-center justify-center gap-3 rounded-[var(--r-1)] border border-rule-strong bg-surface px-3 py-2 font-medium text-ink hover:bg-surface-2"
      >
        <GoogleG />
        {COPY.auth_pages.continueWithGoogle}
      </a>
    </div>
  );
}
