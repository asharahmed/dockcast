/**
 * vitest + jsdom global setup. ui-spec.md §11: "matchMedia, ResizeObserver,
 * maplibre-gl (mock module exporting a `Map` class with no-op methods; map
 * components are not unit-tested), `navigator.clipboard`."
 */
import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { server } from '../mocks/server.js';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// `@testing-library/react`'s auto-cleanup only self-registers when it finds
// a global `afterEach`; vitest.config.ts doesn't set `test.globals: true`,
// so it's wired up explicitly here instead.
afterEach(() => cleanup());

class NoopMaplibreMap {
  on() {
    return this;
  }
  off() {
    return this;
  }
  once() {
    return this;
  }
  addControl() {
    return this;
  }
  addSource() {
    return this;
  }
  addLayer() {
    return this;
  }
  getSource() {
    return undefined;
  }
  getLayer() {
    return undefined;
  }
  setFilter() {
    return this;
  }
  setStyle() {
    return this;
  }
  isStyleLoaded() {
    return true;
  }
  fitBounds() {
    return this;
  }
  flyTo() {
    return this;
  }
  queryRenderedFeatures() {
    return [];
  }
  getCanvas() {
    return { style: {}, setAttribute() {}, removeAttribute() {} } as unknown as HTMLCanvasElement;
  }
  remove() {}
}

vi.mock('maplibre-gl', () => ({
  default: {
    Map: NoopMaplibreMap,
    NavigationControl: class {},
    GeolocateControl: class {},
    AttributionControl: class {},
    LngLatBounds: class {
      extend() {
        return this;
      }
    },
  },
}));

vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));

if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!window.ResizeObserver) {
  window.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver;
}

if (!navigator.clipboard) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
}
