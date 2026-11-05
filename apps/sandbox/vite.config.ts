import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173 },
  // Rapier's WASM is inlined into the JS bundle, so the main chunk is large by design.
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 6000 },
});
