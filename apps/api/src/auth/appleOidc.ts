/**
 * Sign in with Apple — OIDC authorization-code flow (`docs/api.md` §5).
 *
 * Differences from Google that shape this module:
 * - `response_mode=form_post`: the callback is a cross-site POST (handshake
 *   therefore lives in `oauth_handshakes`, not the session).
 * - The client secret is not a static string but a short-lived ES256 JWT
 *   signed with the Apple-issued .p8 private key (Team ID + Key ID +
 *   Services ID) — built per exchange with node:crypto, no dependencies.
 * - No PKCE (Apple ignores it).
 * - The id_token's email may be a private-relay address; `email_verified`
 *   arrives as a boolean or the string "true" depending on the account.
 *
 * As with Google, the id_token signature is NOT verified: it comes directly
 * from Apple's token endpoint over TLS with client authentication (OIDC
 * §3.1.3.7 note). Never feed this module an id_token from any other source.
 */
import { createSign, randomUUID } from 'node:crypto';
import { OAuthError } from './googleOidc.js';

export const APPLE_AUTH_URL = 'https://appleid.apple.com/auth/authorize';
export const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
const APPLE_ISS = 'https://appleid.apple.com';

const b64urlJson = (obj: unknown): string => Buffer.from(JSON.stringify(obj)).toString('base64url');

export function buildAppleAuthUrl(args: {
  servicesId: string;
  redirectUri: string;
  state: string;
  nonce: string;
}): string {
  const url = new URL(APPLE_AUTH_URL);
  url.searchParams.set('client_id', args.servicesId);
  url.searchParams.set('redirect_uri', args.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('response_mode', 'form_post');
  url.searchParams.set('scope', 'email');
  url.searchParams.set('state', args.state);
  url.searchParams.set('nonce', args.nonce);
  return url.toString();
}

/** The ES256 client-secret JWT Apple requires (valid 5 min; built per exchange). */
export function appleClientSecret(args: {
  teamId: string;
  keyId: string;
  servicesId: string;
  privateKeyPem: string;
  now: Date;
}): string {
  const iat = Math.floor(args.now.getTime() / 1000);
  const header = b64urlJson({ alg: 'ES256', kid: args.keyId, typ: 'JWT' });
  const payload = b64urlJson({
    iss: args.teamId,
    iat,
    exp: iat + 300,
    aud: APPLE_ISS,
    sub: args.servicesId,
    jti: randomUUID(),
  });
  const signer = createSign('SHA256');
  signer.update(`${header}.${payload}`);
  const signature = signer
    .sign({ key: args.privateKeyPem, dsaEncoding: 'ieee-p1363' })
    .toString('base64url');
  return `${header}.${payload}.${signature}`;
}

export interface AppleIdentity {
  subject: string;
  email: string;
}

interface IdTokenClaims {
  iss?: string;
  aud?: string;
  sub?: string;
  exp?: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
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

export async function exchangeAppleCode(args: {
  code: string;
  nonce: string;
  servicesId: string;
  teamId: string;
  keyId: string;
  privateKeyPem: string;
  redirectUri: string;
  now: Date;
  fetchImpl: typeof fetch;
}): Promise<AppleIdentity> {
  const res = await args.fetchImpl(APPLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: args.code,
      client_id: args.servicesId,
      client_secret: appleClientSecret(args),
      redirect_uri: args.redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new OAuthError(`token endpoint returned ${res.status}`);

  const body = (await res.json()) as { id_token?: string };
  if (!body.id_token) throw new OAuthError('token response has no id_token');

  const claims = decodeIdTokenClaims(body.id_token);
  if (claims.iss !== APPLE_ISS) throw new OAuthError('id_token iss mismatch');
  if (claims.aud !== args.servicesId) throw new OAuthError('id_token aud mismatch');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= args.now.getTime()) {
    throw new OAuthError('id_token expired');
  }
  if (claims.nonce !== args.nonce) throw new OAuthError('id_token nonce mismatch');
  if (!claims.sub) throw new OAuthError('id_token has no sub');
  // Apple asserts verified emails (often a private relay); the claim is a
  // bool or the string "true" depending on account vintage.
  const verified = claims.email_verified === true || claims.email_verified === 'true';
  if (!claims.email || !verified) throw new OAuthError('id_token email missing or unverified');
  return { subject: claims.sub, email: claims.email };
}
