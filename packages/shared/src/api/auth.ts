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
  }),
});
export type UserResponse = z.infer<typeof userResponseSchema>;
