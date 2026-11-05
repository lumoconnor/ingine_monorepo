// River current check. Start `npm run dev` first, then: node scripts/river-check.cjs
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
    const tp = (x, y, z, yaw = 0) => { RB.teleport(new T(x, y, z)); C.velocity.set(0, 0, 0); C.yaw = yaw; C.pitch = 0; C.ladder = null; C.mantling = false; step(2); };
    const pos = () => C.feetPosition.toArray().map((v) => +v.toFixed(2));
    const r = [];
    const check = (label, ok, extra = '') => r.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
    const UP = Math.PI / 2; // facing -X (upstream)

    tp(-20, 0.9, -48); step(60);
    let x0 = C.feetPosition.x; step(180);
    check('idle in slow stretch drifts downstream ~1.5 m/s', C.state === 'swim' && C.feetPosition.x - x0 > 3.5 && C.feetPosition.x - x0 < 5, `moved ${(C.feetPosition.x - x0).toFixed(2)}m in 3s`);
    tp(-15, 0.9, -48, UP); step(60); x0 = C.feetPosition.x; down('KeyW'); step(180); up('KeyW');
    check('can swim upstream in slow stretch', x0 - C.feetPosition.x > 3, `moved ${(x0 - C.feetPosition.x).toFixed(2)}m upstream in 3s`);
    tp(2, 0.9, -48, UP); step(30); x0 = C.feetPosition.x; down('KeyW'); step(120); up('KeyW');
    const plain = x0 - C.feetPosition.x;
    tp(2, 0.9, -48, UP); step(30); x0 = C.feetPosition.x; down('KeyW'); down('ShiftLeft'); step(120); up('KeyW'); up('ShiftLeft');
    const sprint = x0 - C.feetPosition.x;
    check('rapids: normal swim loses ground, sprint-swim gains', plain < 0 && sprint > 0.8, `normal ${plain.toFixed(2)}m, sprint ${sprint.toFixed(2)}m upstream in 2s`);
    tp(-24, 0.9, -48); let maxX = -99, stuck = 0, last = -99;
    for (let i = 0; i < 60 * 30; i++) { step(1); if (i % 60 === 0) { if (Math.abs(C.feetPosition.x - last) < 0.05 && C.state === 'swim') stuck++; last = C.feetPosition.x; } maxX = Math.max(maxX, C.feetPosition.x); }
    check('float the whole river: washed up on the beach', C.feetPosition.x > 19.5 && C.grounded, `end=${JSON.stringify(pos())} state=${C.state} stuckSeconds=${stuck}`);
    tp(21, 1.6, -48, -Math.PI / 2); step(30); down('KeyW'); let topY = 0; for (let i = 0; i < 150; i++) { step(1); if (C.grounded) topY = Math.max(topY, C.feetPosition.y); } up('KeyW'); step(20);
    check('walk up the beach and out of the river', topY > 2.4, `highest ground ${topY.toFixed(2)} end=${JSON.stringify(pos())}`);
    // Wading upstream on the beach is slower than downstream
    tp(20.5, 1.2, -48, UP); step(30); x0 = C.feetPosition.x; down('KeyW'); step(60); up('KeyW'); const upW = x0 - C.feetPosition.x;
    tp(20.5, 1.2, -48, -UP); step(30); x0 = C.feetPosition.x; down('KeyW'); step(60); up('KeyW'); const dnW = C.feetPosition.x - x0;
    check('wading: current helps downstream, hinders upstream', dnW > upW + 0.4, `up ${upW.toFixed(2)} / down ${dnW.toFixed(2)} m in 1s`);
    // Climb out over the bank
    tp(-18, 0.9, -46.5, Math.PI); step(30); down('KeyW'); step(90); up('KeyW'); step(30);
    check('climb out onto the bank', C.feetPosition.y > 2.45 && C.grounded && C.feetPosition.z > -45, `end=${JSON.stringify(pos())}`);
    return r;
  });
  console.log(out.join('\n'));
  await browser.close();
})();
