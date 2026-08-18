/**
 * `express-session`'s `Session#regenerate`/`Session#destroy` are
 * callback-based; thin promise wrappers so route handlers can `await` them.
 * `docs/api.md` §5: sessions regenerate on login/register.
 */
import type { Request } from 'express';

/** Regenerates `req.session` (new sid, empty data) in place. */
export function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) reject(err instanceof Error ? err : new Error(String(err)));
      else resolve();
    });
  });
}

/** Destroys `req.session` (used by `/auth/logout`). */
export function destroySession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.destroy((err) => {
      if (err) reject(err instanceof Error ? err : new Error(String(err)));
      else resolve();
    });
  });
}
