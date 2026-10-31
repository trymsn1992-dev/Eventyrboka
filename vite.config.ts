import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GEMINI_API_KEY is deliberately NOT exposed to the client bundle.
// All Gemini calls go through serverless functions in /api which read
// process.env.GEMINI_API_KEY at runtime on the server.
export default defineConfig(() => {
    return {
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
