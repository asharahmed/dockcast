/**
 * MSW node server for tests (`src/test/setup.ts`).
 */
import { setupServer } from 'msw/node';
import { handlers } from './handlers.js';

export const server = setupServer(...handlers);
