import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The QA Tool serves the built wizard itself, and the page calls the API on its own address. In
// contributor dev mode (pnpm dev:wizard) Vite passes those calls on to the QA Tool
// (VITE_RUNNER_URL, default http://localhost:3001).
const proxy = { '/api': { target: process.env.VITE_RUNNER_URL || 'http://localhost:3001', changeOrigin: true } };

// The commit this build comes from (the deploy sets it); the generated workflow pins the tool to it. Full SHA only.
const sha = process.env.QA_TOOL_SHA || process.env.GITHUB_SHA || '';
const toolSha = /^[0-9a-f]{40}$/i.test(sha) ? sha : '';

// VITE_BASE puts the build under a path, as on a host that serves it from a sub-path. The QA Tool serves it at the root.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  define: { __QA_TOOL_SHA__: JSON.stringify(toolSha) },
  server: { port: 3002, strictPort: true, proxy },
  preview: { port: 3002, strictPort: true, proxy },
});
