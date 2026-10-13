/**
 * `/login`. ui-spec.md §4.6.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Field } from '../components/ui/Field.js';
import { Button } from '../components/ui/Button.js';
import { Icon } from '../components/ui/Icon.js';
import { useMe, useLogin } from '../api/queries.js';
import { ApiError } from '../api/client.js';
import { COPY } from '../lib/constants.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { OAuthButtons } from '../components/shell/OAuthButtons.js';

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return COPY.auth_pages.errors.badCredentials;
    if (err.status === 429) return COPY.auth_pages.errors.rateLimited;
  }
  return COPY.errors.generic;
}

export default function LoginPage() {
  useDocumentTitle('Sign in · DockCast');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: me } = useMe();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const nextPath = searchParams.get('next') ?? '/commutes';
  const oauthFailed = searchParams.get('oauth') === 'failed';

  useEffect(() => {
    if (me) navigate(nextPath, { replace: true });
  }, [me, navigate, nextPath]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    login.mutate(
      { email, password },
      { onSuccess: () => navigate(nextPath, { replace: true }) },
    );
  }

  return (
    <div className="mx-auto flex max-w-[400px] flex-col gap-6 px-[var(--gutter)] py-[var(--sp-8)]">
      <div className="flex flex-col gap-2">
        <h1 className="text-[length:var(--fs-2xl)]">{COPY.auth_pages.signInTitle}</h1>
        <p className="text-ink-2">{COPY.auth_pages.subtitle}</p>
      </div>

      {(login.isError || oauthFailed) && (
        <p className="wash-critical flex items-center gap-2 rounded-[var(--r-1)] px-3 py-2 text-[length:var(--fs-sm)] text-[color:var(--st-critical-text)]">
          <Icon name="alert" size={16} />
          {login.isError ? errorMessage(login.error) : COPY.auth_pages.errors.oauthFailed}
        </p>
      )}

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="Email">
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="min-h-11 w-full rounded-[var(--r-1)] border border-rule-strong bg-surface px-3 py-2 text-ink"
          />
        </Field>
        <Field label="Password" hint={COPY.auth_pages.passwordHint}>
          <input
            type="password"
            autoComplete="current-password"
            minLength={10}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="min-h-11 w-full rounded-[var(--r-1)] border border-rule-strong bg-surface px-3 py-2 text-ink"
          />
        </Field>
        <Button type="submit" disabled={login.isPending}>
          {COPY.auth_pages.signInButton}
        </Button>
      </form>

      <OAuthButtons next={nextPath} />

      <Link to="/register" className="inline-flex min-h-11 items-center text-[length:var(--fs-sm)] text-signal underline underline-offset-4">
        {COPY.auth_pages.toRegister}
      </Link>
    </div>
  );
}
