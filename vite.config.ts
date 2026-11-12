import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GEMINI_API_KEY is deliberately NOT exposed to the client bundle.
// All Gemini calls go through serverless functions in /api which read
// process.env.GEMINI_API_KEY at runtime on the server.
// Shown at the bottom of the front page, so it's easy to see whether the
// site has picked up the latest deploy: build time (Norwegian time) and the
// short git commit. Vercel sets VERCEL_GIT_COMMIT_SHA during its builds.
const buildTime = new Intl.DateTimeFormat('nb-NO', {
  timeZone: 'Europe/Oslo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
}).format(new Date());
const commit = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7);
const appVersion = commit ? `${buildTime} · ${commit}` : `${buildTime} · lokal`;

export default defineConfig(() => {
    return {
      define: {
        __APP_VERSION__: JSON.stringify(appVersion),
      },
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
