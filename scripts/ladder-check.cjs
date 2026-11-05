// Ladder regression check. Start `npm run dev` first, then: node scripts/ladder-check.cjs
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
  page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
  await page.goto(process.env.URL || 'http://localhost:5173/');
  await page.waitForFunction(() => window.game && window.game.world.find('player'), null, { timeout: 30000 });
  const out = await page.evaluate(() => {
    game.stop();
    const C = game.world.find('player').getAll()[1];
    const RB = game.world.find('player').getAll()[0];
    const T = RB.entity.object3d.position.constructor;
    const step = (n) => { for (let i = 0; i < n; i++) game.fixedStep(1/60); };
    const down = (c) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c }));
    const up = (c) => window.dispatchEvent(new KeyboardEvent('keyup', { code: c }));
    const tp = (x, y, z, yaw) => { RB.teleport(new T(x, y, z)); C.velocity.set(0,0,0); C.yaw = yaw; C.pitch = 0; C.ladder = null; step(20); };
    const pos = () => C.feetPosition.toArray().map((v) => +v.toFixed(2));
    const r = [];
    const ladders = [
      { name: 'tower 10m', base: [0, 0, -38.5], n: [0, 1], yaw: 0, h: 10 },
      { name: 'elevator tower 6.2m', base: [6.05, 0, 31], n: [1, 0], yaw: Math.PI / 2, h: 6.2 },
      { name: 'perch 5.2m', base: [29.5, 0, 53], n: [1, 0], yaw: Math.PI / 2, h: 5.2 },
      { name: 'ramp block 2.5m', base: [17.5, 0, -12 - 2.5 / Math.tan(Math.PI / 3) - 4], n: [0, -1], yaw: Math.PI, h: 2.5 },
    ];
    for (const L of ladders) {
      const sx = L.base[0] + L.n[0] * 2.5, sz = L.base[2] + L.n[1] * 2.5;
      tp(sx, 1.0, sz, L.yaw);
      down('KeyW');
      let maxY = 0, climbFrames = 0;
      for (let i = 0; i < 60 * (L.h / 3 + 3); i++) { step(1); maxY = Math.max(maxY, C.feetPosition.y); if (C.state === 'climb') climbFrames++; else if (climbFrames > 0 && C.grounded) { step(6); break; } }
      up('KeyW'); step(30);
      const top = pos();
      const onTop = Math.abs(top[1] - (L.h + 0.02)) < 0.05 && C.grounded;
      r.push(`${L.name}: climb up -> ${JSON.stringify(top)} onTop=${onTop} climbTime=${(climbFrames / 60).toFixed(1)}s state=${C.state}`);
      // Descend: walk backwards off the edge toward the ladder, then hold S.
      down('KeyS'); let grabbed = false;
      for (let i = 0; i < 60 * (L.h / 3 + 3); i++) { step(1); if (C.state === 'climb') grabbed = true; }
      up('KeyS'); step(30);
      r.push(`   back off top & hold S -> ${JSON.stringify(pos())} grabbed=${grabbed} grounded=${C.grounded} state=${C.state}`);
    }
    // Idle drift: grab, release all keys, check nothing moves.
    for (const L of ladders) {
      const sx = L.base[0] + L.n[0] * 2.5, sz = L.base[2] + L.n[1] * 2.5;
      tp(sx, 1.0, sz, L.yaw);
      down('KeyW'); let i = 0; while (C.state !== 'climb' && i++ < 200) step(1); up('KeyW'); step(15);
      const a = C.feetPosition.clone(); step(180); const b = C.feetPosition.clone();
      // climb to just below the top and stop
      down('KeyW'); i = 0; while (C.state === 'climb' && C.feetPosition.y < L.h - 0.1 && i++ < 600) step(1); up('KeyW'); step(15);
      const c1 = C.feetPosition.clone(); const s1 = C.state; step(240); const c2 = C.feetPosition.clone();
      r.push(`${L.name}: idle on ladder drift ${a.distanceTo(b).toFixed(3)}m; idle near top (y=${c1.y.toFixed(2)}, ${s1}) drift ${c1.distanceTo(c2).toFixed(3)}m state=${C.state}`);
    }
    // Jump off mid-ladder
    tp(0, 0.1, -36, 0); down('KeyW'); step(90); up('KeyW');
    const midY = C.feetPosition.y; const st = C.state;
    down('Space'); step(2); up('Space'); step(90);
    r.push(`jump off tower ladder at y=${midY.toFixed(2)} (${st}) -> ${JSON.stringify(pos())} state=${C.state}`);
    // Look down + W descends
    tp(0, 0.1, -36, 0); down('KeyW'); step(120); const y1 = C.feetPosition.y; C.pitch = -1.0; step(60); const y2 = C.feetPosition.y; up('KeyW');
    r.push(`look down while holding W: y ${y1.toFixed(2)} -> ${y2.toFixed(2)}`);
    // Walk past the side of a ladder without facing it: should not grab
    tp(-2, 0.1, -37.8, Math.PI / 2); down('KeyD'); step(60); up('KeyD');
    r.push(`strafe past ladder base: state=${C.state} y=${C.feetPosition.y.toFixed(2)}`);
    return r.join('\n');
  });
  console.log(out);
  await browser.close();
})();
