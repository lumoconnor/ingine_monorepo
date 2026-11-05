// Runs every headless check against a fresh dev server: `npm run check` (from the repo root or here).
// Pass names to run a subset: `npm run check -- movement water`.
// Each check prints its own results; a check fails if it exits non-zero or prints FAIL.
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
  const server = await createServer({ root: path.join(dir, '..'), server: { port: 5173, strictPort: true }, logLevel: 'warn' });
  await server.listen();
  const failed = [];
  try {
    for (const f of checks) {
      const t0 = Date.now();
      const { code, out } = await new Promise((resolve) => {
        const p = spawn(process.execPath, [path.join(dir, f)], { env: process.env });
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
  }
  console.log(failed.length ? `\n${failed.length} of ${checks.length} checks failed` : `\nall ${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})();
