/**
 * Site-level links. Build-time overrides (`VITE_REPO_URL`, `VITE_CONTACT_EMAIL`) are
 * optional; production images are built without them, so the defaults are what ships.
 */
export const REPO_URL = (import.meta.env.VITE_REPO_URL as string | undefined) || 'https://github.com/asharahmed/dockcast';

export const ISSUES_URL = `${REPO_URL}/issues`;

/** Contact for privacy and data requests, shown on /privacy. */
export const CONTACT_EMAIL: string | null =
  (import.meta.env.VITE_CONTACT_EMAIL as string | undefined) || 'ashar@aahmed.ca';
