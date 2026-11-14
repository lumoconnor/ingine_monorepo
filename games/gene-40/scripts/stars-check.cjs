// Star islands check: arrive, every star rests on something, the course can
// actually be played (real jumps between stones, the shuttle, the lift, the
// bounce pad, the orbiting platform, the cloud stair), falling in the sea
// takes you back to the last flag, all ten stars can be collected, and Nimbus
// cheers once you have them. SHOTS=dir saves screenshots.
const { chromium } = require('playwright');

const URL = process.env.URL || 'http://localhost:5175/';
const SIGNAL = process.env.SIGNAL || '127.0.0.1:9000';
const shots = process.env.SHOTS;

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: shots ? { width: 1280, height: 720 } : { width: 480, height: 300 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(`${URL}?signal=${SIGNAL}`);
  await page.waitForFunction(() => window.game && window.game.world.find('player'), null, { timeout: 30000 });
  const r = await page.evaluate(() => {
    game.stop();
    const player = game.world.find('player');
    const comp = (e, n) => e.getAll().find((c) => c.constructor.name === n);
    const C = comp(player, 'PlayerController');
    const T = player.object3d.position.constructor;
    let elapsed = 0;
    const frame = () => { elapsed += 1 / 60; game.world.update({ delta: 1 / 60, elapsed, alpha: 1 }); };
    const step = (n) => { for (let i = 0; i < n; i++) { game.fixedStep(1 / 60); frame(); } };
    const input = game.input;
    const aim = (tx, ty, tz) => { for (let k = 0; k < 3; k++) { const cam = game.renderer.camera.getWorldPosition(new T()); const dx = tx - cam.x, dy = ty - cam.y, dz = tz - cam.z; C.yaw = Math.atan2(-dx, -dz); C.pitch = Math.atan2(dy, Math.hypot(dx, dz)); step(1); } };
    window.X = { comp, C, T, step, aim };
    const r = [];
    const check = (label, ok, extra = '') => r.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
    const ox = 2400;
    const feet = player.object3d.position;
    const f = (v) => v.toFixed(1);
    const where = () => [feet.x - ox, feet.y, feet.z].map(f).join(',');
    const P = (x, y, z) => new T(ox + x, y, z);

    const pad = teleports.pads.find((p) => p.sceneId === 'stars');
    C.placeAt(new T(pad.position[0], 0.14, pad.position[2] + 2.2), 0, 0);
    step(5);
    C.placeAt(new T(pad.position[0], 0.14, pad.position[2]), 0, 0);
    step(30);
    check('the portal brings you to Star islands', teleports.current === 'stars');
    check('you land on the start island', Math.abs(feet.y) < 0.2 && Math.abs(feet.x - ox) < 1, where());

    const sc = game.getSystem('star-course');
    check('ten stars', sc.total === 10, `${sc.total}`);
    // Every star's stand rests on a surface.
    const world = game.physics.world;
    const floating = [];
    for (const s of sc.stars) {
      const p = sc.starPos(s);
      const hit = world.castRay(new RAPIER.Ray({ x: p.x, y: p.y + 0.05, z: p.z }, { x: 0, y: -1, z: 0 }), 3, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
      if (!hit || Math.abs(hit.timeOfImpact - 0.05) > 0.03) floating.push(`${f(p.x - ox)},${f(p.y)},${f(p.z)} ${hit ? hit.timeOfImpact.toFixed(2) : 'none'}`);
    }
    check('every star stands on something', floating.length === 0, floating.join(' | '));

    // A real jump: stand at `from` facing `to`, hold W (and sprint), jump, and see where you land.
    const hop = (label, from, to, radius, sprint, dy = 0.2) => {
      if (sprint === undefined) sprint = Math.hypot(to.x - from.x, to.z - from.z) - radius > 3;
      C.placeAt(from, 0, 0);
      step(6);
      C.yaw = Math.atan2(-(to.x - from.x), -(to.z - from.z));
      input.down.add('KeyW');
      if (sprint) input.down.add('ShiftLeft');
      step(4);
      input.pressed.add('jump');
      input.down.add('Space');
      for (let i = 0; i < 90; i++) {
        step(1);
        // Let go of W once over the target, like a player would.
        if (Math.hypot(feet.x - to.x, feet.z - to.z) < radius * 0.5) input.down.delete('KeyW');
      }
      ['KeyW', 'ShiftLeft', 'Space'].forEach((k) => input.down.delete(k));
      step(30);
      const ok = Math.abs(feet.y - to.y) < dy && Math.hypot(feet.x - to.x, feet.z - to.z) < radius;
      check(`  jump: ${label}`, ok, ok ? '' : `ended at ${where()}`);
      return ok;
    };
    const s0 = sc.splashes;
    // Stepping stones from the start island to the meadow.
    const stones = [0.4, 0.9, 1.4, 1.9, 2.4, 2.8].map((top, i) => P(i % 2 ? 1.5 : -1.5, top, -17 - i * 3.5));
    hop('start island to the first stone', P(-1.5, 0.05, -11.5), stones[0], 1.1);
    for (let i = 0; i < stones.length - 1; i++) hop(`stone ${i + 1} to ${i + 2}`, stones[i].clone().setY(stones[i].y + 0.05), stones[i + 1], 1.1);
    hop('last stone to the meadow', stones[5].clone().setY(2.85), P(1, 3, -41), 3);
    check('the meadow flag is now your checkpoint', sc.current?.id === 'meadow', sc.current?.id);

    // Fall in the sea: back to the meadow flag.
    C.placeAt(P(0, -4.6, -30), 0, 0);
    step(3);
    step(20);
    check('falling in the sea takes you back to the last flag', sc.splashes > s0 && Math.abs(feet.y - 3) < 0.2 && Math.hypot(feet.x - ox - 3, feet.z + 41) < 3, where());

    // Shuttle east: step on at the meadow end, ride to the bounce island.
    const shuttle = game.world.find('shuttle');
    let tries = 0;
    while (Math.abs(shuttle.object3d.position.x - ox - 11.5) > 0.05 && tries++ < 1500) step(1);
    C.placeAt(P(11.5, 3.1, -46), 0, 0);
    tries = 0;
    while (Math.abs(shuttle.object3d.position.x - ox - 24.5) > 0.05 && tries++ < 1500) step(1);
    check('the shuttle carries you across', feet.x - ox > 22 && Math.abs(feet.y - 3.0) < 0.2, where());
    hop('shuttle to the bounce island', feet.clone(), P(30, 3, -45), 3);

    // Bounce pad up to the high island.
    C.placeAt(P(34, 3.35, -50), Math.PI, 0);
    const b0 = sc.bounces;
    step(150);
    check('the bounce pad launches you onto the high island', sc.bounces === b0 + 1 && Math.abs(feet.y - 13) < 0.2 && Math.hypot(feet.x - ox - 34, feet.z + 66) < 6, where());

    // High island to the stone, then onto the spinning disc.
    hop('high island to the stone', P(29.5, 13.05, -67), P(24.5, 13, -68), 1.0);
    hop('stone onto the spinning disc', P(24.5, 13.05, -68), P(19.5, 13, -69.5), 3.3, true);
    const onDisc = feet.clone();
    step(120);
    check('the disc turns you round with it', feet.distanceTo(onDisc) > 1 && Math.abs(feet.y - 13) < 0.2, where());
    hop('disc to the next stone', P(15.2, 13.05, -71.5), P(12.5, 13.2, -73), 1.05);
    hop('stone to stone', P(12.5, 13.25, -73), P(8.8, 13.4, -75.2), 0.95);
    hop('stone to the cloud stair island (or its first step)', P(8.8, 13.45, -75.2), P(4, 13, -77), 5.5, undefined, 0.8);

    // West route: the lift and the beam.
    const lift = game.world.find('lift');
    tries = 0;
    while (Math.abs(lift.object3d.position.y - 2.8) > 0.05 && tries++ < 1500) step(1);
    C.placeAt(P(-12, 3.1, -46), 0, 0);
    tries = 0;
    while (Math.abs(lift.object3d.position.y - 14.8) > 0.05 && tries++ < 1500) step(1);
    check('the lift takes you up', Math.abs(feet.y - 15) < 0.2, where());
    hop('lift to the tower island', feet.clone(), P(-18, 15, -46), 3);
    C.placeAt(P(-20, 15.05, -52), 0, 0);
    C.yaw = 0;
    input.down.add('KeyW');
    step(5 * 60);
    input.down.delete('KeyW');
    step(20);
    check('walking the beam gets you to the beam island', Math.abs(feet.y - 15) < 0.2 && feet.z < -71, where());
    hop('beam island to the first stone', P(-15.8, 15.05, -76.5), P(-12.5, 14.3, -77), 0.95);
    hop('stone to stone', P(-12.5, 14.35, -77), P(-8.6, 13.7, -77.5), 0.95);
    hop('stone to the cloud stair island (or its first step)', P(-8.6, 13.75, -77.5), P(-4, 13, -78), 5.5, undefined, 0.8);

    // Orbiting platform up to the pillar.
    const orb = game.world.find('orbit-platform');
    tries = 0;
    let low = 1e9;
    while (tries++ < 900) { step(1); const p = orb.object3d.position; low = Math.min(low, p.y); if (p.y < 0.75 && Math.hypot(p.x - ox, p.z) < 18) break; }
    const op = orb.object3d.position;
    C.placeAt(new T(op.x, op.y + 0.25, op.z), 0, 0);
    let high = 0;
    for (let i = 0; i < 360; i++) { step(1); high = Math.max(high, feet.y); if (op.y > 7.9) break; }
    check('the orbiting platform lifts you up', high > 7, `rode up to ${high.toFixed(1)}`);
    const pil = P(-19, 8, -4);
    hop('orbiting platform onto the pillar', feet.clone(), pil, 1.4, false);

    // The cloud stair, a few steps.
    const stair = game.world.findByTag('cloud-step').slice(0, 25).map((e) => e.object3d.position.clone().setY(e.object3d.position.y + 0.25));
    for (const k of [0, 5, 11, 12, 23]) hop(`cloud step ${k + 1} to ${k + 2}`, stair[k].clone().setY(stair[k].y + 0.05), stair[k + 1], 0.9, false);
    hop('top step onto the cloud bridge', stair[24].clone().setY(stair[24].y + 0.05), P(0, 30.5, -85), 1.2, false);
    C.placeAt(P(0, 30.55, -85), 0, 0);
    C.yaw = 0;
    input.down.add('KeyW');
    step(150);
    input.down.delete('KeyW');
    step(20);
    check('the cloud bridge leads to the castle', Math.abs(feet.y - 30.5) < 0.2 && feet.z < -92, where());

    // Collect every star.
    for (const s of sc.stars) {
      if (s.taken) continue;
      const p = sc.starPos(s);
      C.placeAt(new T(p.x + 0.5, p.y + 0.15, p.z), 0, 0);
      step(3);
    }
    check('all ten stars collected', sc.found === 10 && game.state.hasFlag('stars.all'), `${sc.found}`);

    // Nimbus.
    const lines = [];
    const off = game.events.on('dialogue:line', (l) => lines.push(l));
    const dlg = game.getSystem('dialogue');
    const talk = () => {
      lines.length = 0;
      const e = game.world.find('nimbus');
      const p = e.object3d.position;
      C.placeAt(new T(p.x + 1.8, 0.05, p.z + 1.8), 0, 0);
      step(2);
      comp(e, 'Interactable').interact(player);
      step(2);
      const first = lines[0];
      dlg.end();
      step(2);
      return first;
    };
    talk();
    const n = talk();
    check('Nimbus cheers once you have every star', !!n && /champion/.test(n.text), n ? n.text.slice(0, 50) : 'nothing');
    off();
    return r;
  });

  if (shots) {
    const shot = async (name, setup) => {
      await page.evaluate(setup);
      await page.evaluate(() => {
        game.start();
        document.querySelector('.mp-lobby')?.remove();
        document.querySelectorAll('.hud .overlay, .hud .debug').forEach((e) => (e.style.display = 'none'));
      });
      await page.waitForTimeout(1600);
      await page.screenshot({ path: `${shots}/${name}.png` });
      await page.evaluate(() => game.stop());
    };
    // Put the stars back for the pictures.
    await page.evaluate(() => {
      const sc = game.getSystem('star-course');
      for (const s of sc.stars) s.taken = false;
      sc.found = 0;
      const disc = game.world.find('spin-disc');
      sc.stars.forEach((s, i) => { if (!s.group.parent) (i === 5 ? disc.object3d : game.renderer.scene).add(s.group); });
    });
    const aimFrom = `(x, y, z, tx, ty, tz) => { const { C, T, step, aim } = X; C.placeAt(new T(2400 + x, y, z), 0, 0); step(5); aim(2400 + tx, ty, tz); }`;
    await shot('stars-arrival', `(${aimFrom})(0, 0.05, 6, 0, 4, -40)`);
    await shot('stars-nimbus', `(${aimFrom})(2.5, 0.05, 7.5, 4.5, 1.3, 4)`);
    await shot('stars-star', `(${aimFrom})(6.5, 2.05, -4.5, 8.5, 2.5, -6.5)`);
    await shot('stars-overview', `(${aimFrom})(-30, 35, 10, 5, 10, -60)`);
    await shot('stars-stair', `(${aimFrom})(2, 13.05, -73, -1, 20, -80)`);
    await shot('stars-castle', `(${aimFrom})(0, 30.55, -88.6, 0, 33, -104)`);
  }

  r.push(`${errors.length ? 'FAIL' : 'PASS'}  no errors  ${errors.slice(0, 3).join(' | ')}`);
  console.log(r.join('\n'));
  await browser.close();
  process.exit(r.some((l) => l.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => {
  console.log('FAIL  crashed: ' + e.message);
  process.exit(1);
});
