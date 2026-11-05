// Headless movement regression check. Start `npm run dev` first, then: node scripts/movement-check.cjs
// Steps the simulation deterministically and prints where the player ends up for each test area.
// Deterministic tests: stop the RAF loop and step the simulation manually.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(process.env.URL || 'http://localhost:5173/');
  await page.waitForFunction(() => window.game && window.game.world.find('player'), null, { timeout: 30000 });
  await page.evaluate(() => {
    game.stop();
    window.C = () => game.world.find('player').getAll()[1];
    window.RB = () => game.world.find('player').getAll()[0];
    window.down = (c) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c }));
    window.up = (c) => window.dispatchEvent(new KeyboardEvent('keyup', { code: c }));
    window.step = (n) => { for (let i = 0; i < n; i++) game.fixedStep(1/60); };
    window.tp = (x,y,z,yaw=0) => { const T = RB().entity.object3d.position.constructor; RB().teleport(new T(x,y,z)); C().velocity.set(0,0,0); C().yaw = yaw; C().pitch = 0; C().groundCarrier = null; step(20); };
    window.pos = () => { const p = C().feetPosition; return [ +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2) ]; };
    window.walk = (keys, secs) => { keys.forEach(down); step(Math.round(secs*60)); keys.forEach(up); step(10); return pos(); };
    window.bodyPos = (name) => { const t = game.world.find(name).getAll()[0].body.translation(); return [t.x, t.y, t.z]; };
  });
  const R = {};
  const ev = (k, f, ...a) => page.evaluate(f, ...a).then((v) => (R[k] = v));
  await ev('spawn', () => pos());
  await ev('walk2s', () => { tp(0, 0.1, 8); return walk(['KeyW'], 2); });
  await ev('sprint', () => { tp(0, 0.1, 8); down('KeyW'); down('ShiftLeft'); step(30); const s = C().horizontalSpeed.toFixed(2) + ' ' + C().state; up('KeyW'); up('ShiftLeft'); step(30); return s; });
  for (const [i, a] of [15, 25, 35, 45, 50, 60].entries()) await ev('ramp' + a, (x) => { tp(x, 0.1, -9); return walk(['KeyW'], 5); }, (i - 2.5) * 7);
  for (const [i, r] of [0.15, 0.25, 0.35, 0.5].entries()) await ev('stairs' + r, (z) => { tp(12, 0.1, z, -Math.PI / 2); return walk(['KeyW'], 4); }, i * 5);
  await ev('jumpPeak', () => { tp(0, 0.1, 8); down('Space'); let pk = 0; for (let i = 0; i < 90; i++) { step(1); pk = Math.max(pk, C().feetPosition.y); } up('Space'); step(30); return pk.toFixed(2); });
  await ev('tapPeak', () => { tp(0, 0.1, 8); down('Space'); step(2); up('Space'); let pk = 0; for (let i = 0; i < 90; i++) { step(1); pk = Math.max(pk, C().feetPosition.y); } return pk.toFixed(2); });
  for (const [i, h] of [0.5, 0.75, 1.0, 1.25, 1.5, 2.0].entries()) await ev('ledge' + h, (z) => { tp(-12, 0.1, z, Math.PI / 2); down('KeyW'); step(20); down('Space'); step(20); up('Space'); step(60); up('KeyW'); step(20); return pos(); }, 14 - i * 4);
  await ev('tunnelStand', () => { tp(-8, 0.1, 25.5, 0); return walk(['KeyW'], 3); });
  await ev('tunnelCrouch', () => { tp(-8, 0.1, 25.5, 0); down('KeyC'); const p = walk(['KeyW'], 3); const c1 = C().crouched; up('KeyC'); step(10); return [p, c1, 'after release still crouched (blocked):', C().crouched]; });
  await ev('tunnelExit', () => { down('KeyW'); step(180); up('KeyW'); step(20); return [pos(), C().crouched]; });
  await ev('ceilingBump', () => { tp(0, 0.1, 20); down('Space'); let pk = 0; for (let i = 0; i < 60; i++) { step(1); pk = Math.max(pk, C().feetPosition.y); } up('Space'); step(30); return pk.toFixed(2) + ' (roof underside 2.5, so max feet ≈0.7)'; });
  // Platforms: ride for N seconds, record offset from platform body.
  const ride = (name, secs, yOff) => page.evaluate(([name, secs, yOff]) => {
    const b = bodyPos(name); tp(b[0], b[1] + yOff, b[2], 0);
    const out = [];
    for (let s = 0; s < secs * 4; s++) { step(15); const p = C().feetPosition; const q = bodyPos(name); out.push([+(p.x - q[0]).toFixed(2), +(p.y - q[1]).toFixed(2), +(p.z - q[2]).toFixed(2), C().grounded ? 'G' : 'A', C().groundCarrier ? 'P' : '-']); }
    return out.filter((_, i) => i % 2 === 1).map((r) => r.join(' ')).join(' | ');
  }, [name, secs, yOff]);
  for (const n of ['platform-horizontal', 'platform-elevator', 'platform-diagonal', 'platform-orbit', 'platform-loop']) R[n] = await ride(n, 8, 0.3);
  R.spinner = await page.evaluate(() => { tp(6.5, 0.5, 45, 0); const out = []; for (let s = 0; s < 8; s++) { step(30); const p = C().feetPosition; out.push([Math.hypot(p.x - 4, p.z - 45).toFixed(2), C().yaw.toFixed(2), C().groundCarrier ? 'P' : '-'].join(' ')); } return out.join(' | '); });
  await ev('elevatorToTower', () => { const b = bodyPos('platform-elevator'); tp(b[0], b[1] + 0.3, b[2], -Math.PI/2); for (let i = 0; i < 1200; i++) { step(1); if (bodyPos('platform-elevator')[1] > 5.99) break; } step(30); return walk(['KeyW'], 1.5); });
  await ev('crate', () => { const c = game.world.find('crate'); const b0 = c.getAll()[0].body.translation(); tp(6, 0.1, 9.5, Math.PI); walk(['KeyW'], 2); const b1 = c.getAll()[0].body.translation(); return [[b0.x, b0.z].map((v) => v.toFixed(2)), [b1.x, b1.z].map((v) => v.toFixed(2))]; });
  await ev('hill', () => { tp(-24, 3, 34, Math.PI / 2); return walk(['KeyW'], 4); });
  for (const [k, v] of Object.entries(R)) console.log(k.padEnd(20), JSON.stringify(v));
  console.log('ERRORS', errors);
  await browser.close();
})();
