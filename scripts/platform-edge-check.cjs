// Platform edge/side regression check. Start `npm run dev` first, then: node scripts/platform-edge-check.cjs
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
  page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
  await page.goto('http://localhost:5173/');
  await page.waitForFunction(() => window.game && window.game.world.find('player'), null, { timeout: 30000 });
  const out = await page.evaluate(() => {
    game.stop();
    const C = game.world.find('player').getAll()[1];
    const RB = game.world.find('player').getAll()[0];
    const T = RB.entity.object3d.position.constructor;
    const step = (n) => { for (let i = 0; i < n; i++) game.fixedStep(1/60); };
    const down = (c) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c }));
    const up = (c) => window.dispatchEvent(new KeyboardEvent('keyup', { code: c }));
    const bp = (n) => game.world.find(n).getAll()[0].body.translation();
    const tp = (x,y,z,yaw=0) => { RB.teleport(new T(x,y,z)); C.velocity.set(0,0,0); C.yaw = yaw; C.groundCarrier = null; };
    const pcol = () => RB.colliders[0];
    const minDist = (n) => { const c = pcol().contactCollider(game.world.find(n).getAll()[0].colliders[0], 2); return c ? c.distance : 9; };
    const res = [];
    const plats = ['platform-horizontal','platform-elevator','platform-diagonal','platform-orbit','platform-loop','platform-spinner'];
    // A. walk off each platform in 4 directions, at several phases
    for (const n of plats) {
      let line = n + ': ';
      for (const [k, yaw] of [0, Math.PI/2, Math.PI, -Math.PI/2].entries()) {
        for (const phase of [0, 97, 211]) {
          step(phase);
          const b = bp(n); tp(b.x, b.y + 0.3, b.z, yaw); step(60);
          down('KeyW'); let minD = 9; for (let i = 0; i < 90; i++) { step(1); minD = Math.min(minD, minDist(n)); } up('KeyW'); step(60);
          const p = C.feetPosition, q = bp(n);
          const rel = Math.hypot(p.x - q.x, p.z - q.z);
          const ok = rel > 2.2 && !C.groundCarrier;
          line += (ok ? '.' : `X(rel=${rel.toFixed(2)},y=${p.y.toFixed(2)},car=${!!C.groundCarrier},minD=${minD.toFixed(3)})`);
        }
      }
      res.push(line);
    }
    // B. stand in the path of the horizontal shuttle
    tp(-15, 0.1, 31, 0); let worst = 9; const xs = [];
    for (let i = 0; i < 600; i++) { step(1); worst = Math.min(worst, minDist('platform-horizontal')); if (i % 60 === 0) xs.push(C.feetPosition.x.toFixed(1) + '/' + C.feetPosition.y.toFixed(2)); }
    res.push('in shuttle path: min distance ' + worst.toFixed(3) + ' positions ' + xs.join(' '));
    // C. lean into elevator side while it moves, then walk away
    tp(0, 0.1, 33.6, 0); down('KeyW'); let w2 = 9; for (let i = 0; i < 400; i++) { step(1); w2 = Math.min(w2, minDist('platform-elevator')); } up('KeyW'); step(5);
    const before = C.feetPosition.clone(); down('KeyS'); step(60); up('KeyS'); step(10);
    res.push('elevator side: min dist ' + w2.toFixed(3) + ' backed away ' + before.distanceTo(C.feetPosition).toFixed(2) + 'm, y=' + C.feetPosition.y.toFixed(2));
    // D. jump onto edges of the loop platform repeatedly
    return res.join('\n');
  });
  console.log(out);
  await browser.close();
})();
