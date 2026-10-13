/**
 * `docs/api.md` §5 — /auth/register, /auth/login, /auth/me.
 */
import { z } from 'zod';

export const registerRequestSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(10).max(200),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(10).max(200),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const userResponseSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    created_at: z.string().datetime({ offset: true }),
    /** The email is in the deployment's `ADMIN_EMAILS`: the operator view of `/model` (docs/api.md §4). */
    is_admin: z.boolean(),
  }),
});
export type UserResponse = z.infer<typeof userResponseSchema>;

/** `GET /auth/providers` — which OAuth sign-in options this deployment has configured. */
export const authProvidersResponseSchema = z.object({
  google: z.boolean(),
  apple: z.boolean(),
});
export type AuthProvidersResponse = z.infer<typeof authProvidersResponseSchema>;

/** `GET /auth/identities` — the signed-in user's sign-in methods (docs/api.md §5). */
export const authIdentitiesResponseSchema = z.object({
  has_password: z.boolean(),
  identities: z.array(
    z.object({
      provider: z.enum(['google', 'apple']),
      email: z.string().nullable(),
      created_at: z.string().datetime({ offset: true }),
    }),
  ),
});
export type AuthIdentitiesResponse = z.infer<typeof authIdentitiesResponseSchema>;
