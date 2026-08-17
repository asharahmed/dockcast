/** `pino` instance (JSON lines) — `docs/architecture.md` §5 "Logging". */
import pino from 'pino';
import type { LogLevel } from './config.js';

export type Logger = pino.Logger;

export function createLogger(level: LogLevel): Logger {
  return pino({ level });
}
