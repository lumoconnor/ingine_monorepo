// Doors / switches / switch-lift regression check. Start `npm run dev` first, then: node scripts/door-check.cjs
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
    const comp = (e, n) => e.getAll().find((c) => c.constructor.name === n);
    const RB = comp(player, 'RigidBodyComponent');
    const C = comp(player, 'PlayerController');
    const CAM = comp(player, 'FirstPersonCamera');
    const IA = comp(player, 'PlayerInteractor');
    const T = player.object3d.position.constructor;
    let elapsed = 0;
    const frame = () => { elapsed += 1 / 60; game.world.update({ delta: 1 / 60, elapsed, alpha: 1 }); };
    const step = (n) => { for (let i = 0; i < n; i++) { game.fixedStep(1 / 60); frame(); } };
    const down = (c) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c }));
    const up = (c) => window.dispatchEvent(new KeyboardEvent('keyup', { code: c }));
    const press = (c) => { down(c); step(1); up(c); step(1); };
    const tp = (x, y, z, yaw = 0) => { RB.teleport(new T(x, y, z)); C.velocity.set(0, 0, 0); C.yaw = yaw; C.pitch = 0; C.ladder = null; step(20); };
    const aim = (x, y, z) => {
      for (let k = 0; k < 3; k++) {
        const cam = game.renderer.camera.getWorldPosition(new T());
        const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
        C.yaw = Math.atan2(-dx, -dz);
        C.pitch = Math.atan2(dy, Math.hypot(dx, dz));
        frame();
      }
    };
    const walk = (key, frames) => { down(key); step(frames); up(key); step(10); };
    const pos = () => C.feetPosition.toArray().map((v) => +v.toFixed(2));
    const prompt = () => (IA.target ? IA.target.prompt : null);
    const find = (name) => game.world.findByTag ? [...game.world.findByTag('door'), ...game.world.findByTag('lift')].find((e) => e.name === name) : null;
    const door = (name) => comp(find(name), 'Door');
    const lift = (name) => comp(find(name), 'Lift');
    const r = [];
    const check = (label, ok, extra = '') => r.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);

    // 1. Wooden swing door (E)
    const wood = door('door-wood');
    tp(-33, 0.05, 21, 0);
    walk('KeyW', 90);
    check('wood door blocks when closed', C.feetPosition.z > 19.1, JSON.stringify(pos()));
    aim(-33, 1.1, 19);
    const p1 = prompt();
    check('looking at wood door shows prompt', p1 === 'Open door', `prompt=${p1}`);
    press('KeyE'); step(70);
    check('E opens wood door', wood.openness === 1, `openness=${wood.openness} sign=${wood.swingSign}`);
    C.pitch = 0; C.yaw = 0;
    walk('KeyW', 120);
    check('walk through open wood door', C.feetPosition.z < 17, JSON.stringify(pos()));
    // Close while standing in the doorway: must wait.
    tp(-33, 0.05, 19, Math.PI);
    aim(-33.68, 1.0, 18.45); // look at the open door (swung inward)
    const p2 = prompt();
    press('KeyE'); step(90);
    check('door waits instead of closing on player', wood.openness > 0.2 && Math.abs(C.feetPosition.z - 19) < 0.3, `prompt=${p2} openness=${wood.openness.toFixed(2)} pos=${JSON.stringify(pos())}`);
    tp(-33, 0.05, 21.5, 0); step(80);
    check('door closes once player leaves', wood.openness === 0, `openness=${wood.openness}`);
    // Open from the inside: should swing outward (away from the player).
    tp(-33, 0.05, 17, Math.PI); aim(-33, 1.1, 19); press('KeyE'); step(70);
    check('opens away from player (inside -> outward)', wood.swingSign === -1 && wood.openness === 1, `sign=${wood.swingSign}`);
    C.pitch = 0; C.yaw = Math.PI; walk('KeyW', 120);
    check('walk out through outward door', C.feetPosition.z > 20.5, JSON.stringify(pos()));
    aim(-32.4, 1.1, 20); press('KeyE'); step(70);

    // 2. Sliding door (E), east wall x=-28
    const slide = door('door-sliding');
    tp(-26, 0.05, 14, Math.PI / 2);
    walk('KeyW', 90);
    check('sliding door blocks when closed', C.feetPosition.x > -27.9, JSON.stringify(pos()));
    aim(-28, 1.1, 14); const p3 = prompt(); press('KeyE'); step(60);
    check('E opens sliding door', slide.openness === 1, `prompt=${p3}`);
    C.pitch = 0; C.yaw = Math.PI / 2; walk('KeyW', 120);
    check('walk through sliding door', C.feetPosition.x < -30, JSON.stringify(pos()));

    // 3. Vault door via lever (north wall z=9), lever outside at (-30.9, 1.3, 8.85)
    const vault = door('door-vault');
    tp(-33, 0.05, 7, Math.PI);
    aim(-33, 1.1, 9); const pv = prompt();
    check('vault door itself is not interactable', pv === null, `prompt=${pv}`);
    tp(-30.9, 0.05, 7.4, Math.PI);
    aim(-30.9, 1.4, 8.85); const p4 = prompt(); press('KeyE'); step(130);
    check('outside lever opens vault', vault.openness === 1, `prompt=${p4} openness=${vault.openness}`);
    tp(-33, 0.05, 7, Math.PI); walk('KeyW', 100);
    check('walk through vault', C.feetPosition.z > 10.5, JSON.stringify(pos()));
    tp(-30.9, 0.05, 10.6, 0); aim(-30.9, 1.4, 9.15); const p5 = prompt(); press('KeyE'); step(130);
    check('inside lever closes vault', vault.openness === 0, `prompt=${p5}`);

    // 4. Gate via buttons (west wall x=-38), outside button at (-39.6, 0, 12.5)
    const gate = door('door-gate');
    tp(-41, 0.05, 12.5, -Math.PI / 2);
    aim(-39.6, 1.1, 12.5); const p6 = prompt(); press('KeyE'); step(100);
    check('outside button opens gate', gate.openness === 1, `prompt=${p6}`);
    tp(-40, 0.05, 14, -Math.PI / 2); walk('KeyW', 100);
    check('walk through gate', C.feetPosition.x > -36.5, JSON.stringify(pos()));

    // 5. Switch lift
    const L = lift('lift-switch');
    tp(31.5, 0.4, -9.5, 0); step(30);
    const panelWorld = new T(32 - 1.2, 0.3 + 1.0, -10 - 1.2);
    aim(panelWorld.x, panelWorld.y, panelWorld.z); const p7 = prompt();
    press('KeyE');
    let n = 0; while (L.progress < 1 && n++ < 600) step(1); step(30);
    check('onboard panel sends lift up, rider carried', L.stop === 1 && Math.abs(C.feetPosition.y - 8.3) < 0.08 && C.grounded, `prompt=${p7} pos=${JSON.stringify(pos())}`);
    C.pitch = 0; C.yaw = -Math.PI / 2; walk('KeyW', 80);
    check('step off onto top deck', C.feetPosition.x > 34 && Math.abs(C.feetPosition.y - 8.3) < 0.05, JSON.stringify(pos()));
    // Ride back down via the panel, then leave lift at top and call from below with player underneath.
    tp(32, 8.5, -9.5, 0); step(20); aim(panelWorld.x, 8.3 + 1.0, panelWorld.z); press('KeyE');
    n = 0; while (L.progress > 0 && n++ < 600) step(1); step(20);
    check('panel sends lift down', L.stop === 0 && Math.abs(C.feetPosition.y - 0.3) < 0.08, JSON.stringify(pos()));
    aim(panelWorld.x, panelWorld.y, panelWorld.z); press('KeyE'); step(10);
    tp(29, 0.05, -10, 0); // step off before it leaves
    n = 0; while (L.progress < 1 && n++ < 600) step(1);
    tp(32, 0.05, -10, 0);
    tp(28.5, 0.05, -12.2, -Math.PI / 2);
    aim(29.6, 1.1, -12.2); const p8 = prompt(); press('KeyE');
    tp(32, 0.05, -10, 0); // stand under it
    step(400);
    const ly = find('lift-switch').object3d.position.y;
    check('lift waits above a player standing underneath', L.blocked && ly > 1.9 && C.feetPosition.y < 0.1, `prompt=${p8} liftY=${ly.toFixed(2)} pos=${JSON.stringify(pos())}`);
    tp(28, 0.05, -10, 0); step(300);
    check('lift continues down once clear', L.stop === 0, `progress=${L.progress.toFixed(2)}`);

    // 6. Ferry
    const F = lift('ferry-switch');
    tp(31, 3.1, -23.5, -Math.PI / 2); step(10);
    C.yaw = -Math.PI / 2; walk('KeyW', 50);
    const onFerry = C.groundCarrier !== null;
    aim(33.55, 2.85 + 0.15 + 1.0, -25.2); const p9 = prompt(); press('KeyE');
    n = 0; while (F.progress < 1 && n++ < 600) step(1); step(20);
    check('ferry carries rider across', onFerry && F.stop === 1 && C.feetPosition.x > 40.5 && C.feetPosition.y > 2.9, `prompt=${p9} pos=${JSON.stringify(pos())}`);
    C.pitch = 0; C.yaw = -Math.PI / 2; walk('KeyW', 25);
    check('step off onto pillar B', C.feetPosition.x > 44.5 && C.feetPosition.y > 2.95, JSON.stringify(pos()));
    aim(44.7, 3.0 + 1.1, -25.2); const p10 = prompt();
    check('pillar B call button prompt', p10 === 'Call ferry', `prompt=${p10}`);
    return r;
  }, null);
  console.log(out.join('\n'));
  await browser.close();
})();
