import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173 },
  // Rapier's WASM is inlined into the JS bundle, so the main chunk is large by design.
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 6000 },
});
