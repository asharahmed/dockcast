/**
 * `docs/api.md` §0 — the error envelope, and the codes routes throw as.
 */
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function notFound(message: string): ApiError {
  return new ApiError(404, 'not_found', message);
}
export function validationError(message: string, details?: unknown): ApiError {
  return new ApiError(400, 'validation_error', message, details);
}
export function unauthorized(message = 'Authentication required'): ApiError {
  return new ApiError(401, 'unauthorized', message);
}
export function forbidden(message: string): ApiError {
  return new ApiError(403, 'forbidden', message);
}
export function conflict(message: string): ApiError {
  return new ApiError(409, 'conflict', message);
}
export function serviceUnavailable(message: string): ApiError {
  return new ApiError(503, 'service_unavailable', message);
}

function envelope(
  code: string,
  message: string,
  details?: unknown,
): { error: { code: string; message: string; details?: unknown } } {
  return details === undefined
    ? { error: { code, message } }
    : { error: { code, message, details } };
}

/** Terminal 404 for any `/api/*` path not matched by a router (mounted after all `/api/v1` routers). */
export const apiNotFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json(envelope('not_found', `Unknown route: ${req.method} ${req.originalUrl}`));
};

/** Central error handler (mounted last). Converts thrown/forwarded errors into the `docs/api.md` §0 envelope. */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof ApiError) {
    res.status(err.status).json(envelope(err.code, err.message, err.details));
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json(envelope('validation_error', 'Invalid request', err.flatten()));
    return;
  }
  // body-parser failures (malformed JSON, oversized body) are the client's fault; answer with a
  // fixed message, never the parser's text.
  const parseErr = err as { type?: unknown };
  if (parseErr.type === 'entity.parse.failed') {
    res.status(400).json(envelope('validation_error', 'Malformed request body'));
    return;
  }
  if (parseErr.type === 'entity.too.large') {
    res.status(413).json(envelope('payload_too_large', 'Request body too large'));
    return;
  }
  req.log?.error({ err }, 'unhandled error');
  res.status(500).json(envelope('internal_error', 'Internal server error'));
};
