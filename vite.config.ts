import fs from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { DEFAULT_PORT } from './server/port.ts';

// `npm run dev`: Vite serves the dashboard on the default port and proxies /api (and the agents' llms.txt files) to
// the daemon on the next one up. HALLWAY_WEB_PORT / HALLWAY_API_PORT override both (e.g. to run a second dev
// instance next to an installed Hallway).
const webPort = Number(process.env.HALLWAY_WEB_PORT ?? DEFAULT_PORT);
const apiPort = Number(process.env.HALLWAY_API_PORT ?? DEFAULT_PORT + 1);

// The design tokens, as a file of their own in dist/web: the static fallback page Caddy serves when the daemon is down
// (server/proxy/fallback.ts) inlines them, so it looks like the dashboard. src/theme/tokens.css stays the one source.
const tokensAsset = (): Plugin => ({
  name: 'hallway-tokens-asset',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'tokens.css', source: fs.readFileSync('src/theme/tokens.css', 'utf8') });
  },
});

export default defineConfig({
  plugins: [react(), tokensAsset()],
  server: {
    port: webPort,
    host: '127.0.0.1',
    strictPort: true,
    proxy: Object.fromEntries(
      ['/api', '/llms.txt', '/llms-full.txt', '/agent-guide.md'].map((p) => [p, { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false }]),
    ),
  },
  // the built dashboard, served by the compiled daemon (dist/server, from `npm run build:server`)
  build: { outDir: 'dist/web', emptyOutDir: true },
});
