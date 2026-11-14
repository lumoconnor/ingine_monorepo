// Murph Land check: arrive, every coin rests on something solid, walking over
// coins collects them, the cats talk, a zipline carries you down, and Murphy
// says something special once every coin is found. SHOTS=dir saves screenshots.
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
    const frame = () => { elapsed += 1 / 60; const t = { delta: 1 / 60, elapsed, alpha: 1 }; game.world.update(t); };
    const step = (n) => { for (let i = 0; i < n; i++) { game.fixedStep(1 / 60); frame(); } };
    window.X = { comp, C, T, step, frame };
    const r = [];
    const check = (label, ok, extra = '') => r.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
    const o = [1800, 0, 0];

    const pad = teleports.pads.find((p) => p.sceneId === 'murph');
    C.placeAt(new T(pad.position[0], 0.14, pad.position[2] + 2.2), 0, 0);
    step(5);
    C.placeAt(new T(pad.position[0], 0.14, pad.position[2]), 0, 0);
    step(30);
    check('the portal brings you to Murph Land', teleports.current === 'murph');
    const feet = player.object3d.position;
    check('you land standing on the grass', Math.abs(feet.y) < 0.2 && Math.abs(feet.x - o[0]) < 1, feet.toArray().map((v) => v.toFixed(2)).join(','));

    const coins = game.getSystem('murph-coins');
    check('there are plenty of Murphy coins', coins.total >= 30, `${coins.total}`);
    // Every coin rests on something: a ray from just above its centre down hits a surface right under its bottom face.
    const world = game.physics.world;
    let floating = [];
    for (const c of coins.coins) {
      const bottom = c.pos.y - 0.02;
      const hit = world.castRay(new RAPIER.Ray({ x: c.pos.x, y: c.pos.y, z: c.pos.z }, { x: 0, y: -1, z: 0 }), 3, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
      const gap = hit ? bottom - (c.pos.y - hit.timeOfImpact) : null;
      if (gap === null || Math.abs(gap) > 0.03) floating.push(`${(c.pos.x - 1800).toFixed(1)},${c.pos.y.toFixed(2)},${c.pos.z.toFixed(1)} gap ${gap?.toFixed(3)}`);
    }
    window.__floating = floating;

    // Walk onto every coin.
    let got = 0;
    const off = game.events.on('murph:coin', (e) => (got = e.found));
    for (const c of coins.coins) {
      C.placeAt(new T(c.pos.x + 0.3, c.pos.y + 0.02, c.pos.z), 0, 0);
      step(3);
    }
    off();
    check('walking over coins collects every one', got === coins.total && coins.found === coins.total, `${got} / ${coins.total}`);
    check('collected coins are gone from the world', game.world.findByTag('murphy-coin').length === 0);
    check('finding them all sets the honorary-cat flag', game.state.hasFlag('murph.allCoins'));

    // The cats.
    const lines = [];
    const offL = game.events.on('dialogue:line', (l) => lines.push(l));
    const dlg = game.getSystem('dialogue');
    const talk = (id) => {
      lines.length = 0;
      const e = game.world.find(id);
      const p = e.object3d.position;
      C.placeAt(new T(p.x + 1.2, p.y, p.z + 1.2), 0, 0);
      step(2);
      comp(e, 'Interactable').interact(player);
      step(2);
      const first = lines[0];
      dlg.end();
      step(2);
      return first;
    };
    const cats = game.world.findByTag('cat').filter((c) => Math.abs(c.object3d.position.x - o[0]) < 100); // Murph Land's own (Hero city has a cat too)
    check('seven cats live here', cats.length === 7, `${cats.length}`);
    for (const cat of cats) {
      if (cat.name === 'murphy') continue;
      const first = talk(cat.name);
      check(`  ${cat.name} talks`, !!first && first.text.length > 10, first ? first.text.slice(0, 50) : 'nothing');
    }
    talk('murphy'); // hello first... but the flag is set, so the special line wins
    const m = talk('murphy');
    check('Murphy makes you an honorary cat after every coin', !!m && /honorary cat/.test(m.text), m ? m.text.slice(0, 60) : 'nothing');
    offL();

    // Wandering cats move.
    const wand = cats.filter((c) => comp(c, 'Wander'));
    const before = wand.map((c) => c.object3d.position.clone());
    C.placeAt(new T(o[0], 0.05, 5), 0, 0);
    step(480);
    const moved = wand.filter((c, i) => c.object3d.position.distanceTo(before[i]) > 1).length;
    check('cats wander about', moved >= 2, `${moved} of ${wand.length} moved`);

    // A zipline from the top of the first cat tree.
    const zips = game.world.findByTag('zipline');
    check('four ziplines', zips.length === 4, `${zips.length}`);
    const z = comp(zips[0], 'Zipline');
    const a = z.a ?? z.from ?? null;
    C.placeAt(new T(o[0] - 16.6, 9.4 + 0.02, -13.4), 0, 0);
    step(10);
    const y0 = player.object3d.position.y;
    comp(zips[0], 'Interactable').interact(player);
    step(360);
    const p1 = player.object3d.position;
    check('the zipline carries you across and down', p1.x > o[0] + 5 && p1.y < y0 - 3, `from y ${y0.toFixed(1)} to ${p1.toArray().map((v) => v.toFixed(1)).join(',')}`);
    return r;
  });
  const floating = await page.evaluate(() => window.__floating);
  r.push(`${floating.length ? 'FAIL' : 'PASS'}  every coin rests on a surface  ${floating.slice(0, 4).join(' | ')}`);

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
    const aimFrom = `(x, y, z, tx, ty, tz) => { const { C, T, step } = X; C.placeAt(new T(x, y, z), 0, 0); step(5); for (let k = 0; k < 3; k++) { const cam = game.renderer.camera.getWorldPosition(new T()); const dx = tx - cam.x, dy = ty - cam.y, dz = tz - cam.z; C.yaw = Math.atan2(-dx, -dz); C.pitch = Math.atan2(dy, Math.hypot(dx, dz)); step(1); } }`;
    // Fresh coins for the pictures.
    await page.evaluate(() => {
      const c = game.getSystem('murph-coins');
      const old = c.coins.splice(0);
      for (const k of old) c.add(game, [k.pos.x, k.pos.y - 0.02, k.pos.z]);
      c.found = 0;
    });
    await shot('murph-arrival', `(${aimFrom})(1800, 0.05, 6, 1800, 4, -28)`);
    await shot('murph-statue', `(${aimFrom})(1800 - 7, 0.05, -17, 1800, 4.5, -30)`);
    await shot('murph-tree', `(${aimFrom})(1800 - 9, 0.05, -4, 1800 - 18, 5, -14)`);
    await shot('murph-top', `(${aimFrom})(1800 - 17.2, 9.42, -13.6, 1800 + 10, 3, -20)`);
    await shot('murph-murphy', `(${aimFrom})(1800 + 5.2, 0.05, -21.9, 1800 + 5.6, 0.9, -24.4)`);
    await shot('murph-box', `(${aimFrom})(1800 + 12, 0.05, -29, 1800 + 12, 1.0, -38)`);
  }

  r.push(`${errors.length ? 'FAIL' : 'PASS'}  no errors  ${errors.slice(0, 3).join(' | ')}`);
  console.log(r.join('\n'));
  await browser.close();
  process.exit(r.some((l) => l.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => {
  console.log('FAIL  crashed: ' + e.message);
  process.exit(1);
});
