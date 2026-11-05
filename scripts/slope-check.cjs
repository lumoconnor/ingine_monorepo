// Steep-slope sliding check. Start `npm run dev` first, then: node scripts/slope-check.cjs
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
  page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
  await page.goto(process.env.URL || 'http://localhost:5173/');
  await page.waitForFunction(() => window.game && window.game.world.find('player'), null, { timeout: 30000 });
  const out = await page.evaluate(() => {
    game.stop();
    const player = game.world.find('player');
    const comp = (n) => player.getAll().find((c) => c.constructor.name === n);
    const RB = comp('RigidBodyComponent'), C = comp('PlayerController');
    const T = player.object3d.position.constructor;
    const step = (n) => { for (let i = 0; i < n; i++) game.fixedStep(1 / 60); };
    const down = (c) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c }));
    const up = (c) => window.dispatchEvent(new KeyboardEvent('keyup', { code: c }));
    const tp = (x, y, z, yaw = 0) => { RB.teleport(new T(x, y, z)); C.velocity.set(0, 0, 0); C.yaw = yaw; C.pitch = 0; C.ladder = null; C.sliding = false; step(2); };
    const pos = () => C.feetPosition.toArray().map((v) => +v.toFixed(2));
    const r = [];
    const check = (label, ok, extra = '') => r.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
    const h = 6, tx = -22, tz = -38;
    const run = (d) => h / Math.tan(d * Math.PI / 180);
    // Drop onto the middle of each slide and let go: we should end up at the bottom, moving away.
    const slides = [
      { deg: 50, at: (s) => [tx, 3.5, tz + 2 + run(50) * s], dir: [0, 1] },
      { deg: 60, at: (s) => [tx - 2 - run(60) * s, 3.5, tz], dir: [-1, 0] },
      { deg: 70, at: (s) => [tx, 3.5, tz - 2 - run(70) * s], dir: [0, -1] },
    ];
    for (const S of slides) {
      const p = S.at(0.45);
      tp(p[0], p[1] + 0.8, p[2]);
      let slid = 0, maxSpeed = 0;
      for (let i = 0; i < 240; i++) { step(1); if (C.state === 'slide') slid++; maxSpeed = Math.max(maxSpeed, C.velocity.length()); }
      const f = pos();
      check(`${S.deg}° slope: slides to the bottom`, slid > 10 && f[1] < 0.1 && C.grounded, `slideFrames=${slid} maxSpeed=${maxSpeed.toFixed(1)} end=${JSON.stringify(f)}`);
      // Try to walk up it from the bottom (W into the slope + spam jump).
      const b = S.at(1.0);
      tp(b[0] + S.dir[0] * 0.6, 0.05, b[2] + S.dir[1] * 0.6, Math.atan2(S.dir[0], S.dir[1]));
      down('KeyW'); let maxY = 0;
      const states = new Set(); let jumps = 0; const offJ = game.events.on('player:jumped', () => jumps++);
      for (let i = 0; i < 300; i++) { if (i % 20 === 0) down('Space'); if (i % 20 === 2) up('Space'); step(1); states.add(C.state); maxY = Math.max(maxY, C.feetPosition.y); }
      offJ();
      up('KeyW'); step(60);
      check(`${S.deg}° slope: can't climb by walking/jumping`, jumps > 5 && maxY < 2.6 && C.feetPosition.y < 0.5, `maxY=${maxY.toFixed(2)} jumps=${jumps} states=${[...states]} end=${JSON.stringify(pos())}`);
    }
    // Stand on tower top and walk off onto the 50° slide.
    tp(tx, h + 0.1, tz, Math.PI); step(20); down('KeyW'); step(45); up('KeyW');
    let slid = 0; for (let i = 0; i < 240; i++) { step(1); if (C.state === 'slide') slid++; }
    check('walk off tower top onto slide', slid > 10 && C.feetPosition.y < 0.1, `end=${JSON.stringify(pos())}`);
    // Steer sideways while sliding
    const p = slides[0].at(0.2); tp(p[0], p[1] + 2.2, p[2]); down('KeyD'); step(80); up('KeyD');
    check('steer while sliding', Math.abs(C.feetPosition.x - tx) > 0.4, `x=${C.feetPosition.x.toFixed(2)}`);
    // Jump off a slide: pushes away
    const q = slides[1].at(0.3); tp(q[0], q[1] + 2.5, q[2] + 1.2, Math.PI / 2); step(30); const st = C.state;
    down('Space'); step(2); up('Space'); step(5);
    check('jump hops away from the slope', st === 'slide' && C.velocity.x < -2 && C.velocity.y > 0, `state=${st} v=${C.velocity.toArray().map((v) => v.toFixed(1))}`);
    // Ledge edges are not slopes
    tp(-16 + 1.1, 1.1, 6, 0); step(60);
    check('standing on a box edge is not sliding', C.state !== 'slide' && C.grounded, `state=${C.state} pos=${JSON.stringify(pos())}`);
    return r;
  });
  console.log(out.join('\n'));
  await browser.close();
})();
