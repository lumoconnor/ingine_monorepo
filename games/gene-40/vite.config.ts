import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the build works from any folder (e.g. GitHub Pages at /<repo>/).
  base: './',
  // 5175 so it can run next to the sandbox (5173) and the office (5174).
  server: { port: 5175 },
  // Rapier's WASM is inlined into the JS bundle, so the main chunk is large by design.
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 6000 },
});
