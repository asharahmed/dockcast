/**
 * `docs/api.md` §0 — every response is built as the shared TS type and, in
 * dev/test, validated with the shared zod schema before sending
 * (`docs/plan.md` WP-7 contract).
 */
import type { Response } from 'express';
import type { ZodType, ZodTypeDef } from 'zod';
import type { Config } from '../config.js';

export function sendJson<T, Input = T>(
  res: Response,
  status: number,
  schema: ZodType<T, ZodTypeDef, Input>,
  body: T,
  config: Config,
  cacheControl?: string,
): void {
  if (config.nodeEnv !== 'production') {
    const result = schema.safeParse(body);
    if (!result.success) {
      throw new Error(
        `Response failed schema validation: ${JSON.stringify(result.error.flatten())}`,
      );
    }
  }
  if (cacheControl) res.setHeader('Cache-Control', cacheControl);
  res.status(status).json(body);
}
