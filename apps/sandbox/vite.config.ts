import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  server: { port: 5173 },
  // Rapier's WASM is inlined into the JS bundle, so the main chunk is large by design.
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        characters: resolve(import.meta.dirname, 'characters.html'),
      },
    },
  },
});
