/**
 * Google OpenID Connect authorization-code flow with PKCE (`docs/api.md` §5).
 *
 * Deliberately dependency-free: build the authorization URL, exchange the
 * code at Google's token endpoint, and validate the returned `id_token`
 * claims. The id_token's signature is NOT verified — it is received directly
 * from Google's token endpoint over TLS with client authentication, where the
 * OIDC spec (§3.1.3.7 note) permits relying on TLS server validation instead.
 * Never accept an id_token from any other source through this module.
 */
import { createHash, randomBytes } from 'node:crypto';

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

const b64url = (buf: Buffer): string => buf.toString('base64url');

/** Random URL-safe secrets for the handshake (state / nonce / PKCE verifier). */
export function randomToken(): string {
  return b64url(randomBytes(32));
}

export function codeChallengeS256(verifier: string): string {
  return b64url(createHash('sha256').update(verifier).digest());
}

export function buildGoogleAuthUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  verifier: string;
}): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set('client_id', args.clientId);
  url.searchParams.set('redirect_uri', args.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email');
  url.searchParams.set('state', args.state);
  url.searchParams.set('nonce', args.nonce);
  url.searchParams.set('code_challenge', codeChallengeS256(args.verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export interface GoogleIdentity {
  /** Google's stable per-user id (`sub`). */
  subject: string;
  email: string;
}

export class OAuthError extends Error {}

interface IdTokenClaims {
  iss?: string;
  aud?: string;
  sub?: string;
  exp?: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean;
}

function decodeIdTokenClaims(idToken: string): IdTokenClaims {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new OAuthError('id_token is not a JWT');
  try {
    return JSON.parse(Buffer.from(parts[1] as string, 'base64url').toString('utf8')) as IdTokenClaims;
  } catch {
    throw new OAuthError('id_token payload is not valid JSON');
  }
}

/**
 * Exchange the authorization code and return the validated identity.
 * Throws {@link OAuthError} on any exchange or claim-validation failure.
 */
export async function exchangeGoogleCode(args: {
  code: string;
  verifier: string;
  nonce: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  now: Date;
  fetchImpl: typeof fetch;
}): Promise<GoogleIdentity> {
  const res = await args.fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: args.code,
      client_id: args.clientId,
      client_secret: args.clientSecret,
      redirect_uri: args.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: args.verifier,
    }),
  });
  if (!res.ok) throw new OAuthError(`token endpoint returned ${res.status}`);

  const body = (await res.json()) as { id_token?: string };
  if (!body.id_token) throw new OAuthError('token response has no id_token');

  const claims = decodeIdTokenClaims(body.id_token);
  if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') {
    throw new OAuthError('id_token iss mismatch');
  }
  if (claims.aud !== args.clientId) throw new OAuthError('id_token aud mismatch');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= args.now.getTime()) {
    throw new OAuthError('id_token expired');
  }
  if (claims.nonce !== args.nonce) throw new OAuthError('id_token nonce mismatch');
  if (!claims.sub) throw new OAuthError('id_token has no sub');
  // Only link/provision accounts on addresses Google itself asserts as
  // verified — an unverified email could hijack an existing local account.
  if (!claims.email || claims.email_verified !== true) {
    throw new OAuthError('id_token email missing or unverified');
  }
  return { subject: claims.sub, email: claims.email };
}
