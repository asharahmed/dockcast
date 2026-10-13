/**
 * `/account`. ui-spec.md §4.8 — the signed-in user's sign-in methods:
 * connect/disconnect OAuth providers, see whether a password exists.
 * Connect is a full-page navigation into the OAuth start with `link=1`
 * (the server carries the session user in the handshake); the callback
 * bounces back here with `?link=ok|conflict` (or `/login?oauth=failed`
 * for exchange errors).
 */
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Icon } from '../components/ui/Icon.js';
import { InlineConfirm } from '../components/ui/InlineConfirm.js';
import {
  useMe,
  useAuthProviders,
  useAuthIdentities,
  useUnlinkIdentity,
  useDeleteAccount,
} from '../api/queries.js';
import { Button } from '../components/ui/Button.js';
import { useToast } from '../components/shell/Toasts.js';
import { COPY } from '../lib/constants.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';

const PROVIDERS = ['google', 'apple'] as const;
type ProviderKey = (typeof PROVIDERS)[number];

export default function AccountPage() {
  useDocumentTitle('Account · DockCast');
  const [searchParams] = useSearchParams();
  const { data: me } = useMe();
  const { data: providers } = useAuthProviders();
  const { data: identities } = useAuthIdentities();
  const unlink = useUnlinkIdentity();
  const deleteAccount = useDeleteAccount();
  const navigate = useNavigate();
  const addToast = useToast();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const [confirming, setConfirming] = useState<ProviderKey | null>(null);
  const link = searchParams.get('link');
  const connected = new Map((identities?.identities ?? []).map((row) => [row.provider, row]));
  const methodCount = (identities?.has_password ? 1 : 0) + connected.size;

  function row(provider: ProviderKey) {
    const identity = connected.get(provider);
    const enabled = providers?.[provider] ?? false;
    if (!identity && !enabled) return null;
    return (
      <li key={provider} className="flex min-h-11 items-center justify-between gap-4 py-2">
        <div className="flex flex-col">
          <span className="font-medium">{COPY.account.providerName[provider]}</span>
          {identity && (
            <span className="text-[length:var(--fs-sm)] text-ink-2">{identity.email ?? '—'}</span>
          )}
        </div>
        {identity ? (
          methodCount > 1 ? (
            confirming === provider ? (
              <InlineConfirm
                message={COPY.account.disconnectConfirm(COPY.account.providerName[provider])}
                confirmLabel={COPY.account.disconnect}
                onConfirm={() => {
                  unlink.mutate(provider);
                  setConfirming(null);
                }}
                onCancel={() => setConfirming(null)}
                danger
              />
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(provider)}
                className="text-[length:var(--fs-sm)] text-signal underline underline-offset-4"
              >
                {COPY.account.disconnect}
              </button>
            )
          ) : (
            <span className="text-[length:var(--fs-sm)] text-ink-3">{COPY.account.onlyMethodNote}</span>
          )
        ) : (
          <a
            href={`/api/v1/auth/${provider}?link=1&next=%2Faccount`}
            className="text-[length:var(--fs-sm)] text-signal underline underline-offset-4"
          >
            {COPY.account.connect}
          </a>
        )}
      </li>
    );
  }

  return (
    <div className="mx-auto flex max-w-[560px] flex-col gap-6 px-[var(--gutter)] py-[var(--sp-8)]">
      <div className="flex flex-col gap-2">
        <h1 className="text-[length:var(--fs-2xl)]">{COPY.account.title}</h1>
        {me && <p className="text-ink-2">{me.user.email}</p>}
      </div>

      {link === 'ok' && (
        <p className="wash-good flex items-center gap-2 rounded-[var(--r-1)] px-3 py-2 text-[length:var(--fs-sm)] text-[color:var(--st-good-text)]">
          <Icon name="check" size={16} />
          {COPY.account.linkOk}
        </p>
      )}
      {link === 'conflict' && (
        <p className="wash-critical flex items-center gap-2 rounded-[var(--r-1)] px-3 py-2 text-[length:var(--fs-sm)] text-[color:var(--st-critical-text)]">
          <Icon name="alert" size={16} />
          {COPY.account.linkConflict}
        </p>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-[length:var(--fs-lg)]">{COPY.account.methodsHeading}</h2>
        <ul className="divide-y divide-rule">
          <li className="flex min-h-11 items-center justify-between gap-4 py-2">
            <span className="font-medium">{COPY.account.password}</span>
            <span className="text-[length:var(--fs-sm)] text-ink-2">
              {identities?.has_password ? COPY.account.passwordSet : COPY.account.passwordNotSet}
            </span>
          </li>
          {PROVIDERS.map(row)}
        </ul>
      </section>

      <section className="flex flex-col gap-3 border-t border-rule pt-[var(--sp-6)]">
        <h2 className="text-[length:var(--fs-lg)]">{COPY.account.deleteHeading}</h2>
        <p className="text-[length:var(--fs-sm)] text-ink-2">{COPY.account.deleteBody}</p>
        {confirmingDelete ? (
          <InlineConfirm
            message={COPY.account.deleteConfirm}
            confirmLabel={COPY.account.deleteConfirmLabel}
            danger
            onCancel={() => setConfirmingDelete(false)}
            onConfirm={() => {
              deleteAccount.mutate(undefined, {
                onSuccess: () => {
                  addToast(COPY.account.deletedToast, 'good');
                  navigate('/', { replace: true });
                },
                onError: () => {
                  setConfirmingDelete(false);
                  addToast(COPY.account.deleteErrorToast, 'critical');
                },
              });
            }}
          />
        ) : (
          <div>
            <Button type="button" variant="secondary" onClick={() => setConfirmingDelete(true)}>
              {COPY.account.deleteButton}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
