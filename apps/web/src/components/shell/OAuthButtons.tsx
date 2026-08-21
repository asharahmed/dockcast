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

/** Apple mark (monochrome, follows the current ink colour per Apple HIG's plain style). */
function AppleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 814 1000" aria-hidden="true" fill="currentColor">
      <path d="M788 341c-6 4-107 61-107 187 0 146 128 198 132 199-1 3-20 71-67 141-42 61-86 122-152 122s-83-38-159-38c-74 0-101 39-161 39s-102-57-150-126C69 785 24 664 24 549c0-184 120-282 238-282 63 0 115 41 154 41 37 0 95-43 166-43 27 0 123 2 186 76zM549 179c30-36 52-86 52-135 0-7-1-14-2-19-49 2-108 33-143 74-28 32-54 82-54 132 0 8 1 15 2 18 3 1 8 1 13 1 44 0 100-30 132-71z" />
    </svg>
  );
}

const BUTTON_CLASS =
  'flex items-center justify-center gap-3 rounded-[var(--r-1)] border border-rule-strong bg-surface px-3 py-2 font-medium text-ink hover:bg-surface-2';

export function OAuthButtons({ next }: { next: string }) {
  const { data: providers } = useAuthProviders();
  if (!providers?.google && !providers?.apple) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 text-[length:var(--fs-sm)] text-ink-3">
        <span className="h-px flex-1 bg-rule" />
        {COPY.auth_pages.orDivider}
        <span className="h-px flex-1 bg-rule" />
      </div>
      {providers.google && (
        <a href={`/api/v1/auth/google?next=${encodeURIComponent(next)}`} className={BUTTON_CLASS}>
          <GoogleG />
          {COPY.auth_pages.continueWithGoogle}
        </a>
      )}
      {providers.apple && (
        <a href={`/api/v1/auth/apple?next=${encodeURIComponent(next)}`} className={BUTTON_CLASS}>
          <AppleMark />
          {COPY.auth_pages.continueWithApple}
        </a>
      )}
    </div>
  );
}
