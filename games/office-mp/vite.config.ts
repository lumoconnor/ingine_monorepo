import { defineConfig } from 'vite';

export default defineConfig({
  // 5174 so it can run next to the sandbox (5173).
  server: { port: 5174 },
  // Rapier's WASM is inlined into the JS bundle, so the main chunk is large by design.
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 6000 },
});
