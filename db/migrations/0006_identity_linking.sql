-- Account linking (docs/api.md §5): an OAuth start made while signed in may
-- carry the session user in the handshake, turning the callback into "attach
-- this provider identity to that user" instead of sign-in. Lives in the
-- handshake (not the session) because Apple's form_post callback carries no
-- SameSite=Lax cookie.

ALTER TABLE oauth_handshakes
  ADD COLUMN link_user_id uuid REFERENCES users(id) ON DELETE CASCADE;
