import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The QA Tool serves the built wizard itself, and the page calls the API on its own address. In
// contributor dev mode (pnpm dev:wizard) Vite passes those calls on to the QA Tool
// (VITE_RUNNER_URL, default http://localhost:3001).
const proxy = { '/api': { target: process.env.VITE_RUNNER_URL || 'http://localhost:3001', changeOrigin: true } };

// VITE_BASE puts the build under a path, as on a host that serves it from a sub-path. The QA Tool serves it at the root.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  // Packages go to their own file, so an app change does not invalidate the cached vendor code.
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => (/[\\/]node_modules[\\/]/.test(id) ? 'vendor' : undefined),
      },
    },
  },
  server: { port: 3002, strictPort: true, proxy },
  preview: { port: 3002, strictPort: true, proxy },
});
