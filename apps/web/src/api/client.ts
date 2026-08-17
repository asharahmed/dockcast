/**
 * Fetch wrapper for `/api/v1/*`. ui-spec.md §7.
 */
import type { ZodType } from 'zod';
import { COPY } from '../lib/constants.js';
import type { ErrorResponse } from '@dockcast/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

function isErrorResponse(value: unknown): value is ErrorResponse {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const err = (value as { error?: unknown }).error;
  return typeof err === 'object' && err !== null && 'code' in err && 'message' in err;
}

async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
  schema?: ZodType<T>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'fetch',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', COPY.errors.network);
  }

  if (!response.ok) {
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    if (isErrorResponse(parsed)) {
      throw new ApiError(
        response.status,
        parsed.error.code,
        parsed.error.message,
        parsed.error.details,
      );
    }
    throw new ApiError(response.status, 'internal_error', 'Request failed');
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const json: unknown = await response.json();

  if (!schema) return json as T;

  if (import.meta.env.DEV) {
    return schema.parse(json);
  }

  const result = schema.safeParse(json);
  if (result.success) return result.data;
  console.warn('[api] response failed schema validation', path, result.error);
  return json as T;
}

export function apiGet<T>(path: string, schema?: ZodType<T>): Promise<T> {
  return request('GET', path, undefined, schema);
}

export function apiPost<T>(path: string, body?: unknown, schema?: ZodType<T>): Promise<T> {
  return request('POST', path, body, schema);
}

export function apiPatch<T>(path: string, body?: unknown, schema?: ZodType<T>): Promise<T> {
  return request('PATCH', path, body, schema);
}

export function apiDelete<T>(path: string, body?: unknown, schema?: ZodType<T>): Promise<T> {
  return request('DELETE', path, body, schema);
}
