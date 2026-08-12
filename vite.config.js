import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Renderer only. The main process, both preloads, and the audio worker are
// plain CommonJS loaded directly by Electron and are deliberately not bundled:
// the worker resolves its VAD assets by relative file:// URL and the sidecar
// resolves from the project root, both of which a bundler would break.
export default defineConfig({
  root: resolve(import.meta.dirname, 'src/renderer'),
  // Relative asset URLs, so the built page works under file:// via loadFile.
  base: './',
  build: {
    outDir: resolve(import.meta.dirname, 'src/renderer/dist'),
    emptyOutDir: true,
    // The overlay is read in peripheral vision at 13-15px; a sourcemap costs
    // nothing at runtime and makes a production stack trace legible.
    sourcemap: true,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'src/renderer/index.html'),
        settings: resolve(import.meta.dirname, 'src/renderer/settings.html'),
      },
    },
  },
  plugins: [react()],
});
