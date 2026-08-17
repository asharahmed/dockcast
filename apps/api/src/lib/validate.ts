/**
 * Query/param validation helper: parses with a zod schema, throwing the
 * `docs/api.md` §0 `400 validation_error` (with `details = flatten()`) on
 * failure, so route handlers can `parseQuery(schema, req.query)` and trust
 * the result.
 */
import type { ZodType, ZodTypeDef } from 'zod';
import { validationError } from '../middleware/errors.js';

/**
 * Two independent generic params (rather than a single `ZodSchema<T>`, which
 * forces zod's Input type to equal Output) so a schema with `.default()` /
 * `.optional()` fields — where Input and Output legitimately differ — infers
 * the correct (non-widened) Output type.
 */
export function parseQuery<Output, Input = Output>(
  schema: ZodType<Output, ZodTypeDef, Input>,
  input: unknown,
): Output {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw validationError('Invalid query parameters', result.error.flatten());
  }
  return result.data;
}

/** Parse a route param (e.g. `:id`) as a positive integer; `null` if not a valid id. */
export function parseIntParam(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}
