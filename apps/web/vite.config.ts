import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
/**
 * Absolute origin for the social-preview tags in index.html (og:url, og:image must be
 * absolute). Build-time: `VITE_PUBLIC_BASE_URL`, defaulting to the reference deployment.
 */
const publicBaseUrl = (process.env.VITE_PUBLIC_BASE_URL ?? 'https://dockcast.aahmed.ca').replace(/\/$/, '');

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'dockcast-public-base-url',
      transformIndexHtml: (html) => html.replaceAll('__PUBLIC_BASE_URL__', publicBaseUrl),
    },
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  build: {
    sourcemap: true,
  },
});
