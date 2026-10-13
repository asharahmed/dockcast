/**
 * Who is looking: the operator view of `/model` (`docs/api.md` §4) is for
 * signed-in users whose email is in `ADMIN_EMAILS`; everyone else, signed in
 * or not, gets the public view. Decided server-side so the detailed data never
 * leaves the api for a non-admin.
 */
import type { Request } from 'express';
import type { Config } from '../config.js';
import type { RouteDeps } from '../deps.js';
import { findUserById } from '../services/users.queries.js';

export function isAdminEmail(config: Config, email: string): boolean {
  return config.adminEmails.includes(email.toLowerCase());
}

export async function isAdminRequest(deps: RouteDeps, req: Request): Promise<boolean> {
  const userId = req.session?.userId;
  if (!userId || deps.config.adminEmails.length === 0) return false;
  const user = await findUserById(deps.pool, userId);
  return user !== null && isAdminEmail(deps.config, user.email);
}
