// Zipline check. Start `npm run dev` first, then: node scripts/zipline-check.cjs
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
    const RB = comp('RigidBodyComponent'), C = comp('PlayerController'), IA = comp('PlayerInteractor');
    const T = player.object3d.position.constructor;
    let el = 0;
    const step = (n) => { for (let i = 0; i < n; i++) { game.fixedStep(1 / 60); el += 1 / 60; game.world.update({ delta: 1 / 60, elapsed: el, alpha: 1 }); } };
    const down = (c) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c }));
    const up = (c) => window.dispatchEvent(new KeyboardEvent('keyup', { code: c }));
    const press = (c) => { down(c); step(1); up(c); step(1); };
    const tp = (x, y, z, yaw = 0, pitch = 0) => { RB.teleport(new T(x, y, z)); C.velocity.set(0, 0, 0); C.yaw = yaw; C.pitch = pitch; C.ladder = null; C.mantling = false; C.zipline = null; step(20); };
    const aim = (x, y, z) => { for (let k = 0; k < 3; k++) { const cam = game.renderer.camera.getWorldPosition(new T()); const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z; C.yaw = Math.atan2(-dx, -dz); C.pitch = Math.atan2(dy, Math.hypot(dx, dz)); step(1); } };
    const pos = () => C.feetPosition.toArray().map((v) => +v.toFixed(2));
    const r = [];
    const check = (label, ok, extra = '') => r.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
    const ride = (frames) => { let maxS = 0, minY = 99, rode = 0, exitV = null, lastS = 0; for (let i = 0; i < frames; i++) { step(1); if (C.zipline) { rode++; lastS = Math.abs(C.zipSpeed); maxS = Math.max(maxS, lastS); } else if (rode && exitV === null) exitV = C.velocity.length(); minY = Math.min(minY, C.feetPosition.y); if (rode && !C.zipline && (C.grounded || C.swimming)) break; } return { maxS, minY, rode, exitV: exitV ?? 0, lastS }; };

    // 1. Tower -> slide tower: grab with E.
    tp(-0.5, 10.1, -40, Math.PI / 2);
    aim(-3, 12.2, -39.9); const p1 = IA.target ? IA.target.prompt : null;
    press('KeyE'); const grabbed = !!C.zipline;
    const r1 = ride(60 * 8);
    check('E grabs the zipline', p1 === 'Grab zipline' && grabbed, `prompt=${p1}`);
    check('tower -> slide tower: full speed to the end, popped off with it', r1.rode > 60 && r1.lastS > r1.maxS - 0.3 && r1.exitV > r1.lastS - 0.5, `maxSpeed=${r1.maxS.toFixed(1)} speedAtEnd=${r1.lastS.toFixed(1)} exitSpeed=${r1.exitV.toFixed(1)} landed=${JSON.stringify(pos())} ${C.state}`);
    // 2. Flat cable: jump into it and pull hand over hand.
    tp(-23.6, 6.05, -38, Math.PI / 2); step(30); down('Space'); step(3); up('Space'); step(20);
    const grabJump = !!C.zipline;
    const t0 = C.zipT; step(120); const idleT = C.zipT;
    down('KeyW'); const r2 = ride(60 * 12); up('KeyW');
    check('jumping into a cable grabs it', grabJump, `state=${C.state}`);
    check('flat cable: no drift without input', Math.abs(idleT - t0) * 11.8 < 0.3, `drift=${((idleT - t0) * 11.8).toFixed(2)}m`);
    check('hand over hand to the pillar', C.grounded && C.feetPosition.x < -34 && Math.abs(C.feetPosition.y - 6.02) < 0.08, `end=${JSON.stringify(pos())}`);
    // 3. Let go mid-ride with Space keeps momentum.
    tp(-0.5, 10.1, -40, Math.PI / 2); aim(-3, 12.2, -39.9); press('KeyE'); step(60);
    const sp = C.zipSpeed; down('Space'); step(1); up('Space');
    check('Space lets go with momentum', !C.zipline && C.velocity.x < -0.5 * sp + 0.1 && C.velocity.y > 0, `speed=${sp.toFixed(1)} v=${C.velocity.toArray().map((v) => v.toFixed(1))}`);
    step(240);
    // 4. Lift deck -> pool
    tp(34.5, 8.35, -9.0, Math.PI); aim(35.52, 10.35, -7.8); press('KeyE');
    const r4 = ride(60 * 8);
    check('lift deck -> pool: popped off at speed', r4.rode > 60 && r4.exitV > r4.lastS - 0.5 && r4.lastS > 8, `maxSpeed=${r4.maxS.toFixed(1)} exitSpeed=${r4.exitV.toFixed(1)} landed=${JSON.stringify(pos())} ${C.state}`);
    // 5. Walking under a cable doesn't grab it
    tp(-10, 0.05, -39.1, Math.PI / 2); down('KeyW'); step(60); up('KeyW');
    check('walking under a cable does nothing', !C.zipline, `state=${C.state}`);
    return r;
  });
  console.log(out.join('\n'));
  await browser.close();
})();
