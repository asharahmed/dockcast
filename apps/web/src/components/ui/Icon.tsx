/**
 * Inline SVG icon set (24 px grid, 1.75 px stroke, `currentColor`). No icon
 * libraries. ui-spec.md §2.6.
 */
import type { ReactNode } from 'react';

export type IconName =
  | 'bike'
  | 'dock'
  | 'clock'
  | 'walk'
  | 'check'
  | 'alert'
  | 'cross'
  | 'question'
  | 'search'
  | 'locate'
  | 'share'
  | 'save'
  | 'bell'
  | 'bell-off'
  | 'sun'
  | 'moon'
  | 'monitor'
  | 'chevron'
  | 'close'
  | 'external'
  | 'list'
  | 'map'
  // SPEC-GAP: ui-spec.md §2.6's icon list doesn't include a swap glyph, but
  // §4.1 calls for one on `TripPlanner`'s From/To swap button ("icon with
  // aria-label='Swap stations'"). Added here, matching the set's existing
  // style (24 px grid, 1.75 px stroke, no icon libraries) rather than
  // repurposing an unrelated icon.
  | 'swap'
  // PWA install UI: iOS's Share glyph (box with an up arrow) and a download-into-tray arrow.
  | 'ios-share'
  | 'install';

export interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

const PATHS: Record<IconName, ReactNode> = {
  bike: (
    <>
      <circle cx="6" cy="17" r="3.5" />
      <circle cx="18" cy="17" r="3.5" />
      <path d="M6 17l4-8h5l3 8M10 9H8m4 0l3 5" />
    </>
  ),
  dock: (
    <>
      <rect x="5" y="4" width="14" height="16" rx="2" />
      <path d="M9 4v16M15 4v16" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  walk: (
    <>
      <circle cx="13" cy="4.5" r="1.75" />
      <path d="M10 21l1.5-6-2.5-2 1-5 4-1 3 3-1.5 3 2.5 2-1 6M8.5 13l-3 2" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  alert: (
    <>
      <path d="M12 3.5l9.5 16.5H2.5z" />
      <path d="M12 10v4.5" />
      <circle cx="12" cy="17.5" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  cross: <path d="M6 6l12 12M18 6L6 18" />,
  question: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.7 2.2c-1 .6-1.2 1-1.2 2.1" />
      <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M19.5 19.5L15 15" />
    </>
  ),
  locate: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
    </>
  ),
  share: (
    <>
      <circle cx="18" cy="5.5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="18.5" r="2.5" />
      <path d="M8.2 10.7l7.6-4.4M8.2 13.3l7.6 4.4" />
    </>
  ),
  save: (
    <>
      <path d="M5 4h11l3 3v13H5z" />
      <path d="M8 4v6h8V4M8 20v-6h8v6" />
    </>
  ),
  bell: <path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2.5h-15zM10 20.5a2 2 0 0 0 4 0" />,
  'bell-off': (
    <>
      <path d="M6 16v-5c0-1.2.28-2.3.78-3.3M9.2 5.4A6 6 0 0 1 18 11v5l1.5 2.5h-6" />
      <path d="M10 20.5a2 2 0 0 0 4 0M3 3l18 18" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2.5v2.5M12 19v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12H5M19 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8" />
    </>
  ),
  moon: <path d="M20 14.2A8.5 8.5 0 1 1 9.8 4a7 7 0 0 0 10.2 10.2z" />,
  monitor: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="1.5" />
      <path d="M9 20.5h6M12 16.5v4" />
    </>
  ),
  chevron: <path d="M8 5l7 7-7 7" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  'ios-share': (
    <>
      <path d="M12 3v12M8 7l4-4 4 4" />
      <path d="M8 10H6v10h12V10h-2" />
    </>
  ),
  install: (
    <>
      <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5" />
      <path d="M5 16v4h14v-4" />
    </>
  ),
  external: (
    <>
      <path d="M9.5 5.5H18.5V14.5" />
      <path d="M18.5 5.5L10 14" />
      <path d="M15 12v6.5H5V8h6.5" />
    </>
  ),
  list: (
    <>
      <path d="M9 6.5h11.5M9 12h11.5M9 17.5h11.5" />
      <circle cx="4" cy="6.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="17.5" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  map: (
    <>
      <path d="M9 4.5L4 6.5v13l5-2 6 2 5-2v-13l-5 2-6-2z" />
      <path d="M9 4.5v13M15 6.5v13" />
    </>
  ),
  swap: (
    <>
      <path d="M4 8.5h13.5M14 4.5l3.5 4-3.5 4" />
      <path d="M20 15.5H6.5M10 19.5l-3.5-4 3.5-4" />
    </>
  ),
};

export function Icon({ name, size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
