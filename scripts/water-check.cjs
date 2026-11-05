// Swimming / water check. Start `npm run dev` first, then: node scripts/water-check.cjs
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
    const RB = comp('RigidBodyComponent'), C = comp('PlayerController'), UW = comp('UnderwaterEffect');
    const T = player.object3d.position.constructor;
    let el = 0;
    const step = (n) => { for (let i = 0; i < n; i++) { game.fixedStep(1 / 60); el += 1 / 60; game.world.update({ delta: 1 / 60, elapsed: el, alpha: 1 }); } };
    const down = (c) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c }));
    const up = (c) => window.dispatchEvent(new KeyboardEvent('keyup', { code: c }));
    const tp = (x, y, z, yaw = 0, pitch = 0) => { RB.teleport(new T(x, y, z)); C.velocity.set(0, 0, 0); C.yaw = yaw; C.pitch = pitch; C.ladder = null; C.mantling = false; step(2); };
    const pos = () => C.feetPosition.toArray().map((v) => +v.toFixed(2));
    const r = [];
    const check = (label, ok, extra = '') => r.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
    const S = 3.6, F = 1.4;

    // Drop into the deep end: should end up treading water at float height.
    tp(36, 4.5, 16); step(300);
    check('jump in -> tread at surface', C.state === 'swim' && Math.abs(C.feetPosition.y - (S - F)) < 0.1 && !UW.underwater, `state=${C.state} y=${C.feetPosition.y.toFixed(2)} uw=${UW.underwater}`);
    const y0 = C.feetPosition.y; step(180);
    check('treading stays put', Math.abs(C.feetPosition.y - y0) < 0.1 && C.velocity.length() < 0.3, `dy=${(C.feetPosition.y - y0).toFixed(3)}`);
    // Dive: look down + W
    C.pitch = -1.0; down('KeyW'); step(60); up('KeyW');
    const dy = C.feetPosition.y;
    check('look down + W dives', dy < 1.2 && UW.underwater, `y=${dy.toFixed(2)} underwater=${UW.underwater}`);
    // Swim down with crouch to the floor
    C.pitch = 0; down('KeyC'); step(90); up('KeyC');
    check('crouch swims down to the floor', C.feetPosition.y < 0.25, `y=${C.feetPosition.y.toFixed(2)}`);
    // Idle underwater drifts up slowly to the surface
    step(60 * 8);
    check('idle underwater floats back up', Math.abs(C.feetPosition.y - (S - F)) < 0.12 && C.state === 'swim', `y=${C.feetPosition.y.toFixed(2)}`);
    // Space swims up but not out of the water
    down('Space'); step(120); up('Space');
    check("Space can't fly out of the water", C.feetPosition.y < S - F + 0.25, `y=${C.feetPosition.y.toFixed(2)}`);
    // Swim through the arch underwater (arch at x=38, opening z 14.7..17.3, below y 2.1)
    tp(35.5, 0.6, 16, -Math.PI / 2); down('KeyW'); down('KeyC'); step(8); up('KeyC'); step(80); up('KeyW');
    check('swim through underwater arch', C.feetPosition.x > 39, `pos=${JSON.stringify(pos())}`);
    // Swim to the shallow end -> wade
    tp(40.5, 2.2, 16, -Math.PI / 2); step(60); down('KeyW'); step(150); up('KeyW'); step(30);
    check('swim into shallow end -> wade', C.state === 'wade' || (C.grounded && C.waterDepth > 0.45), `state=${C.state} pos=${JSON.stringify(pos())} depth=${C.waterDepth.toFixed(2)}`);
    down('KeyW'); step(30); const wadeSpeed = C.horizontalSpeed; up('KeyW');
    check('wading is slower', wadeSpeed < 3.3 && wadeSpeed > 2.0, `speed=${wadeSpeed.toFixed(2)}`);
    // Climb out over the west edge (deck top 4.0 at x<=34)
    tp(35.2, 2.2, 15, Math.PI / 2); step(120); down('KeyW'); step(32); up('KeyW'); step(60);
    check('swim into low edge climbs out', C.feetPosition.y > 3.95 && C.feetPosition.y < 4.1 && C.grounded && !C.mantling && C.feetPosition.x < 34, `pos=${JSON.stringify(pos())} state=${C.state}`);
    // Climb out using the ladder (north wall x=37 z=12)
    tp(37, 2.2, 13.5, 0); step(120); down('KeyW'); let climbed = false;
    let topY = 0; for (let i = 0; i < 300; i++) { step(1); if (C.state === 'climb') climbed = true; if (C.grounded) topY = Math.max(topY, C.feetPosition.y); if (climbed && C.grounded && C.feetPosition.y > 3.9) break; } up('KeyW'); step(30);
    check('ladder out of the deep end', climbed && topY > 3.95, `pos=${JSON.stringify(pos())}`);
    // Dive off the board
    tp(36, 6.1, 20.5, 0); step(20); down('KeyW'); step(60); up('KeyW');
    let minY = 99; for (let i = 0; i < 240; i++) { step(1); minY = Math.min(minY, C.feetPosition.y); }
    check('dive off board: plunge then surface', minY > 0.05 && minY < 2.0 && C.state === 'swim', `minY=${minY.toFixed(2)} y=${C.feetPosition.y.toFixed(2)} state=${C.state}`);
    // Ramp up to the deck
    tp(24, 0.05, 16, -Math.PI / 2); down('KeyW'); step(190); up('KeyW');
    check('ramp to deck', C.feetPosition.y > 3.9, `pos=${JSON.stringify(pos())}`);
    return r;
  });
  console.log(out.join('\n'));
  await browser.close();
})();
