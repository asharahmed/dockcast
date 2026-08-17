/**
 * Dev-only MSW browser worker, started from `main.tsx` when `VITE_USE_MOCKS=1`.
 */
import { setupWorker } from 'msw/browser';
import { handlers } from './handlers.js';

export const worker = setupWorker(...handlers);
