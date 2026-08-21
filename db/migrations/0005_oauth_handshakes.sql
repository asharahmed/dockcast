-- OAuth handshake state (docs/api.md §5). Apple's form_post callback is a
-- cross-site POST, where the SameSite=Lax session cookie is not sent — so the
-- in-flight handshake (state/nonce/PKCE verifier/next) lives server-side,
-- keyed by the unguessable single-use `state`, instead of in the session.
-- Google uses the same mechanism.

CREATE TABLE oauth_handshakes (
  state       text PRIMARY KEY,              -- 256-bit random, single-use
  provider    text NOT NULL,                 -- 'google' | 'apple'
  nonce       text NOT NULL,
  verifier    text,                          -- PKCE (Google; Apple has none)
  next        text NOT NULL,                 -- same-origin path to land on
  created_at  timestamptz NOT NULL DEFAULT now()
);
