// Runs the birthday game's headless checks: `npm run check -w @ingine/gene-40`.
// Starts the game's dev server (5175) and a local signalling broker (9000), so
// the checks need no internet: browsers find each other through the local
// broker and talk over WebRTC on this machine.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const dir = __dirname;
const only = process.argv.slice(2);
const checks = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('-check.cjs'))
  .filter((f) => !only.length || only.some((o) => f.startsWith(o)))
  .sort();

(async () => {
  const { createServer } = await import('vite');
  const { ExpressPeerServer } = require('peer');
  const express = require('express');
  const server = await createServer({ root: path.join(dir, '..'), server: { port: 5175, strictPort: true }, logLevel: 'warn' });
  await server.listen();
  const app = express();
  const broker = await new Promise((resolve) => {
    const srv = app.listen(9000, '127.0.0.1', () => resolve(srv));
    app.use('/', ExpressPeerServer(srv, { path: '/' }));
  });
  const failed = [];
  try {
    for (const f of checks) {
      const t0 = Date.now();
      const { code, out } = await new Promise((resolve) => {
        const p = spawn(process.execPath, [path.join(dir, f)], { env: { ...process.env, URL: 'http://localhost:5175/', SIGNAL: '127.0.0.1:9000' } });
        let out = '';
        p.stdout.on('data', (d) => (out += d));
        p.stderr.on('data', (d) => (out += d));
        p.on('close', (code) => resolve({ code, out }));
      });
      const bad = code !== 0 || /^\s*FAIL\b/m.test(out);
      if (bad) failed.push(f);
      console.log(`${bad ? 'FAIL' : 'ok  '}  ${f.replace('.cjs', '')}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      if (bad || process.env.VERBOSE) console.log(out.replace(/^/gm, '      '));
    }
  } finally {
    await server.close();
    broker.closeAllConnections?.();
    broker.close();
  }
  console.log(failed.length ? `\n${failed.length} of ${checks.length} checks failed` : `\nall ${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})();
