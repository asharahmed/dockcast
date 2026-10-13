/**
 * Site-level links. Build-time overrides (`VITE_REPO_URL`, `VITE_CONTACT_EMAIL`) are
 * optional; production images are built without them, so the defaults are what ships.
 */
export const REPO_URL = (import.meta.env.VITE_REPO_URL as string | undefined) || 'https://github.com/asharahmed/dockcast';

export const ISSUES_URL = `${REPO_URL}/issues`;

/** Shown on /privacy when set; otherwise the page points to GitHub issues only. */
export const CONTACT_EMAIL = (import.meta.env.VITE_CONTACT_EMAIL as string | undefined) || null;
