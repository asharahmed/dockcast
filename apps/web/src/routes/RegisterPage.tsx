/**
 * `/register`. ui-spec.md §4.6.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Field } from '../components/ui/Field.js';
import { Button } from '../components/ui/Button.js';
import { Icon } from '../components/ui/Icon.js';
import { useMe, useRegister } from '../api/queries.js';
import { ApiError } from '../api/client.js';
import { COPY } from '../lib/constants.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { OAuthButtons } from '../components/shell/OAuthButtons.js';

export default function RegisterPage() {
  useDocumentTitle('Create account · DockCast');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: me } = useMe();
  const register = useRegister();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const nextPath = searchParams.get('next') ?? '/commutes';

  useEffect(() => {
    if (me) navigate(nextPath, { replace: true });
  }, [me, navigate, nextPath]);

  const isEmailTaken = register.isError && register.error instanceof ApiError && register.error.status === 409;
  const isRateLimited = register.isError && register.error instanceof ApiError && register.error.status === 429;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    register.mutate(
      { email, password },
      { onSuccess: () => navigate(nextPath, { replace: true }) },
    );
  }

  return (
    <div className="mx-auto flex max-w-[400px] flex-col gap-6 px-[var(--gutter)] py-[var(--sp-8)]">
      <div className="flex flex-col gap-2">
        <h1 className="text-[length:var(--fs-2xl)]">{COPY.auth_pages.registerTitle}</h1>
        <p className="text-ink-2">{COPY.auth_pages.subtitle}</p>
      </div>

      {register.isError && (
        <p className="wash-critical flex items-center gap-2 rounded-[var(--r-1)] px-3 py-2 text-[length:var(--fs-sm)] text-[color:var(--st-critical-text)]">
          <Icon name="alert" size={16} />
          {isEmailTaken ? (
            <span>
              {COPY.auth_pages.errors.emailTaken}{' '}
              <Link to="/login" className="underline underline-offset-4">
                Sign in
              </Link>
            </span>
          ) : isRateLimited ? (
            COPY.auth_pages.errors.rateLimited
          ) : (
            COPY.errors.generic
          )}
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
            autoComplete="new-password"
            minLength={10}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="min-h-11 w-full rounded-[var(--r-1)] border border-rule-strong bg-surface px-3 py-2 text-ink"
          />
        </Field>
        <Button type="submit" disabled={register.isPending}>
          {COPY.auth_pages.registerButton}
        </Button>
      </form>

      <OAuthButtons next={nextPath} />

      <Link to="/login" className="inline-flex min-h-11 items-center text-[length:var(--fs-sm)] text-signal underline underline-offset-4">
        {COPY.auth_pages.toSignIn}
      </Link>
      <p className="text-[length:var(--fs-xs)] text-ink-3">
        {COPY.auth_pages.privacyNote}{' '}
        <Link to="/privacy" className="underline underline-offset-4 hover:text-ink-2">
          {COPY.shell.privacy}
        </Link>
      </p>
    </div>
  );
}
