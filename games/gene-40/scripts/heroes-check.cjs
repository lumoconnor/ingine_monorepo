// Hero city check: arrive, each power station gives its power and each power
// works (super jump, flight and glide, dash, grapple), every kitten sits on a
// roof and reaching it rescues it, Captain Whiskers talks, powers switch off
// outside the city and back on when you return, and nothing has fall damage.
// SHOTS=dir saves screenshots.
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
    const frame = () => { elapsed += 1 / 60; const t = { delta: 1 / 60, elapsed, alpha: 1 }; game.world.update(t); game.getSystem('hero-powers').update(t); };
    const step = (n) => { for (let i = 0; i < n; i++) { game.fixedStep(1 / 60); frame(); } };
    const key = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    const input = game.input;
    const hold = (on) => (on ? input.down.add('Space') : input.down.delete('Space'));
    const jump = () => input.pressed.add('jump');
    const aim = (tx, ty, tz) => { for (let k = 0; k < 3; k++) { const cam = game.renderer.camera.getWorldPosition(new T()); const dx = tx - cam.x, dy = ty - cam.y, dz = tz - cam.z; C.yaw = Math.atan2(-dx, -dz); C.pitch = Math.atan2(dy, Math.hypot(dx, dz)); step(1); } };
    window.X = { comp, C, T, step, frame, aim };
    const r = [];
    const check = (label, ok, extra = '') => r.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
    const o = [3000, 0, 0];
    const feet = player.object3d.position;
    const f = (v) => v.toFixed(1);
    const peak = (n = 120) => { let y = -1e9; for (let i = 0; i < n; i++) { step(1); y = Math.max(y, feet.y); } return y; };

    const pad = teleports.pads.find((p) => p.sceneId === 'heroes');
    C.placeAt(new T(pad.position[0], 0.14, pad.position[2] + 2.2), 0, 0);
    step(5);
    C.placeAt(new T(pad.position[0], 0.14, pad.position[2]), 0, 0);
    step(30);
    check('the portal brings you to Hero city', teleports.current === 'heroes');
    check('you land standing on the plaza', Math.abs(feet.y - 0.04) < 0.2 && Math.abs(feet.x - o[0]) < 1, feet.toArray().map(f).join(','));

    const hp = game.getSystem('hero-powers');
    check('four power stations', hp.stations.length === 4);
    check('no powers to start with', hp.owned.size === 0);
    C.placeAt(new T(o[0], 0.05, 4), 0, 0);
    step(20);
    jump();
    hold(true);
    const plain = peak() - 0.04;
    hold(false);
    check('a normal jump is a normal jump', plain > 0.9 && plain < 1.6, `${plain.toFixed(2)} m`);

    const visit = (id) => { const st = hp.stations.find((s) => s.id === id); C.placeAt(new T(st.pos.x, 0.05, st.pos.z + 1.1), 0, 0); step(4); return hp.owned.has(id); };
    check('the jump station gives super jump', visit('jump'));
    C.placeAt(new T(o[0], 0.05, 4), 0, 0);
    step(20);
    jump();
    hold(true);
    const big = peak(150) - 0.04;
    hold(false);
    check('super jump goes sky high', big > 6.5 && big < 9, `${big.toFixed(2)} m`);
    C.placeAt(new T(o[0] - 31, 0.05, 11), 0, 0);
    step(10);
    jump();
    hold(true);
    input.down.add('KeyW');
    step(90);
    input.down.delete('KeyW');
    hold(false);
    step(30);
    check('super jump gets you onto the diner roof', Math.abs(feet.y - 6) < 0.2, feet.toArray().map(f).join(','));
    step(60);

    check('the flight station gives flight', visit('fly'));
    C.placeAt(new T(o[0], 0.05, 4), 0, 0);
    step(20);
    jump();
    hold(true);
    step(150);
    hold(false);
    const flown = feet.y;
    check('holding Space in the air flies you up', flown > 18, `${f(flown)} m up`);
    step(30);
    check('letting go glides you down gently', C.velocity.y > -3.6 && C.velocity.y < 0 && feet.y > flown - 6, `vy ${C.velocity.y.toFixed(2)}`);
    input.down.add('KeyC');
    step(30);
    check('crouch drops you faster', C.velocity.y < -5, `vy ${C.velocity.y.toFixed(2)}`);
    input.down.delete('KeyC');
    // Back down to the street.
    C.placeAt(new T(o[0], 0.05, 4), 0, 0);
    step(20);

    check('the dash station gives dash', visit('dash'));
    C.placeAt(new T(o[0], 0.05, 4), 0, 0);
    step(20);
    const z0 = feet.z;
    key('KeyQ');
    step(20);
    check('Q dashes you forward', z0 - feet.z > 5.5 && hp.dashes === 1, `${(z0 - feet.z).toFixed(1)} m in 1/3 s`);
    key('KeyQ');
    step(1);
    check('dash has a cooldown', hp.dashes === 1);
    step(60);

    check('the grapple station gives the grapple', visit('grapple'));
    // Aim at Hero HQ's face, high up, from the avenue.
    C.placeAt(new T(o[0], 0.05, -20), 0, 0);
    step(10);
    aim(o[0], 40, -51);
    key('KeyG');
    step(1);
    check('G hooks what you aim at', !!hp.grapple && Math.abs(hp.grapple.point.z - -51) < 0.2, hp.grapple ? hp.grapple.point.toArray().map(f).join(',') : 'missed');
    step(150);
    check('the grapple reels you in', !hp.grapple && feet.y > 30 && feet.z < -45, feet.toArray().map(f).join(','));
    C.placeAt(new T(o[0], 0.05, 4), 0, 0);
    step(10);
    aim(o[0], 60, 200); // at the sky
    key('KeyG');
    step(2);
    check('the grapple needs something to hit', !hp.grapple);

    // No fall damage: drop off a tall roof.
    const health = comp(player, 'Damageable') ?? comp(player, 'Health');
    const before = health?.health;
    C.placeAt(new T(o[0] + 36, 60, -84), 0, 0);
    hp.owned.delete('fly'); // fall like a rock
    step(200);
    hp.owned.add('fly');
    check('no fall damage', health && health.health === before && feet.y < 2, `health ${before} -> ${health?.health}, y ${f(feet.y)}`);

    // Kittens.
    check('eight kittens to rescue', hp.total === 8, `${hp.total}`);
    const world = game.physics.world;
    const floating = [];
    for (const k of hp.kittens) {
      const hit = world.castRay(new RAPIER.Ray({ x: k.pos.x, y: k.pos.y + 0.5, z: k.pos.z }, { x: 0, y: -1, z: 0 }), 3, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
      if (!hit || Math.abs(hit.timeOfImpact - 0.5) > 0.03) floating.push(k.pos.toArray().map(f).join(','));
    }
    check('every kitten sits on a roof', floating.length === 0, floating.join(' | '));
    const heights = hp.kittens.map((k) => k.pos.y).sort((a, b) => a - b);
    check('kittens on a spread of heights, one on top of HQ', heights[0] === 6 && heights[7] === 80, heights.map((h) => h.toFixed(0)).join(','));
    for (const k of hp.kittens) {
      C.placeAt(new T(k.pos.x + 1, k.pos.y + 0.05, k.pos.z), 0, 0);
      step(4);
    }
    check('reaching every kitten rescues it', hp.saved === 8 && game.state.hasFlag('heroes.allKittens'), `${hp.saved} / 8`);
    const inBasket = hp.kittens.filter((k) => k.entity.object3d.position.distanceTo(new T(o[0] - 11, 0.1, 4.5)) < 1.2).length;
    check('rescued kittens wait in the basket', inBasket === 8, `${inBasket}`);

    // Captain Whiskers.
    const lines = [];
    const offL = game.events.on('dialogue:line', (l) => lines.push(l));
    const dlg = game.getSystem('dialogue');
    const talk = () => {
      lines.length = 0;
      const e = game.world.find('captain_whiskers');
      const p = e.object3d.position;
      C.placeAt(new T(p.x + 1.4, 0.05, p.z + 1.4), 0, 0);
      step(2);
      comp(e, 'Interactable').interact(player);
      step(2);
      const first = lines[0];
      dlg.end();
      step(2);
      return first;
    };
    talk();
    const cw = talk();
    check('Captain Whiskers thanks you once the city is saved', !!cw && /official hero/.test(cw.text), cw ? cw.text.slice(0, 60) : 'nothing');
    offL();

    // Powers stay in Hero city.
    teleports.goHub();
    step(10);
    check('powers switch off outside Hero city', C.cfg.jumpHeight === 1.25 && teleports.current === 'hub');
    C.placeAt(new T(pad.position[0], 0.14, pad.position[2] + 2.2), 0, 0);
    step(5);
    C.placeAt(new T(pad.position[0], 0.14, pad.position[2]), 0, 0);
    step(30);
    check('and come back when you return', teleports.current === 'heroes' && C.cfg.jumpHeight === 8, `jumpHeight ${C.cfg.jumpHeight}`);
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
    const aimFrom = `(x, y, z, tx, ty, tz) => { const { C, T, step, aim } = X; C.placeAt(new T(x, y, z), 0, 0); step(5); aim(tx, ty, tz); }`;
    await shot('heroes-arrival', `(${aimFrom})(3000, 0.05, 8, 3000, 14, -50)`);
    await shot('heroes-stations', `(${aimFrom})(3000 - 2, 0.05, 4, 3000, 1, -3)`);
    await shot('heroes-captain', `(${aimFrom})(3000 - 11.5, 0.05, 7.5, 3000 - 14, 1.2, 3.5)`);
    await shot('heroes-skyline', `(${aimFrom})(3000 + 20, 45, 20, 3000, 30, -80)`);
    await shot('heroes-hq-top', `(${aimFrom})(3000 + 6, 80.05, -52, 3000 - 30, 0, 10)`);
    await shot('heroes-grapple', `(() => { const { C, T, step, aim } = X; const hp = game.getSystem('hero-powers'); C.placeAt(new T(3000 + 3, 0.05, -18), 0, 0); step(5); aim(3000, 30, -51); hp.grappleAt(new T(3000, 30, -51)); step(14); aim(3000, 30, -51); })()`);
  }

  r.push(`${errors.length ? 'FAIL' : 'PASS'}  no errors  ${errors.slice(0, 3).join(' | ')}`);
  console.log(r.join('\n'));
  await browser.close();
  process.exit(r.some((l) => l.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => {
  console.log('FAIL  crashed: ' + e.message);
  process.exit(1);
});
