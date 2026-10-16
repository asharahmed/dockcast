import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
/**
 * Absolute origin for the social-preview tags in index.html (og:url, og:image must be
 * absolute). Build-time: `VITE_PUBLIC_BASE_URL`, defaulting to the reference deployment.
 */
const publicBaseUrl = (process.env.VITE_PUBLIC_BASE_URL ?? 'https://dockcast.aahmed.ca').replace(/\/$/, '');

/** Files from public/ the service worker precaches alongside the build output. */
// Icons and the manifest are deliberately absent: the worker leaves them to the browser
// (sw.template.js IS_ICON_OR_MANIFEST). The notification badge is fetched by the worker
// itself when showing a push, so it stays.
const PUBLIC_PRECACHE = ['/icons/badge-96.png'];

/**
 * Emits dist/sw.js from sw/sw.template.js (ui-spec.md §8): the precache list is every
 * emitted file except source maps plus {@link PUBLIC_PRECACHE}, and the version is a hash
 * of that list and the template, so any change to the build yields a new worker.
 */
function serviceWorker(): Plugin {
  const templatePath = fileURLToPath(new URL('./sw/sw.template.js', import.meta.url));
  return {
    name: 'dockcast-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const template = readFileSync(templatePath, 'utf8');
      const built = Object.keys(bundle)
        .filter((file) => !file.endsWith('.map'))
        .map((file) => `/${file}`)
        .sort();
      const precache = [...built, ...PUBLIC_PRECACHE];
      const version = createHash('sha256')
        .update(template)
        .update(precache.join('\n'))
        .digest('hex')
        .slice(0, 12);
      const versionLine = "const VERSION = '__VERSION__';";
      const precacheLine = 'const PRECACHE = __PRECACHE__;';
      if (!template.includes(versionLine) || !template.includes(precacheLine)) {
        this.error(`sw.template.js must contain the lines \`${versionLine}\` and \`${precacheLine}\``);
      }
      const source = template
        .replace(versionLine, `const VERSION = ${JSON.stringify(version)};`)
        .replace(precacheLine, `const PRECACHE = ${JSON.stringify(precache, null, 2)};`);
      // The placeholder words may still appear in comments; never in code.
      if (/^\s*const \w+ = __\w+__;/m.test(source)) this.error('sw.js still has an unreplaced placeholder');
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'dockcast-public-base-url',
      transformIndexHtml: (html) => html.replaceAll('__PUBLIC_BASE_URL__', publicBaseUrl),
    },
    serviceWorker(),
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  // `vite preview` against any running api, e.g. the live one:
  //   VITE_PREVIEW_API=https://dockcast.aahmed.ca pnpm --filter @dockcast/web exec vite preview
  preview: {
    proxy: {
      '/api': {
        target: process.env.VITE_PREVIEW_API ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    sourcemap: true,
  },
});
