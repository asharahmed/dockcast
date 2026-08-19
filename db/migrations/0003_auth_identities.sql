-- OAuth sign-in (docs/api.md §5): provider identities linked to users.
-- password_hash becomes nullable — a user created via OAuth has no password
-- (password login for such users is rejected, same message as bad credentials).

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE auth_identities (
  provider    text NOT NULL,                                          -- 'google' | 'apple'
  subject     text NOT NULL,                                          -- provider's stable user id (OIDC `sub`)
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email       text,                                                   -- email asserted by the provider at link time
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject)
);

CREATE INDEX auth_identities_user_idx ON auth_identities (user_id);
