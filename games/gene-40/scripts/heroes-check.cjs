// Hero city check: arrive in the hero suit (super jump), earn swing, flight and
// super strength in order and each works (swing arcs, flight and dive, ground
// slam throws cars, lift and throw a car), every kitten sits on a
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
    const kd = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    const ku = (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code }));
    const hspeed = () => Math.hypot(C.velocity.x, C.velocity.z);
    check('three power stations', hp.stations.length === 3);
    check('no powers to start with', hp.owned.size === 0);
    check('only the swing beacon is lit', hp.stations.map((s) => s.beacon.visible).join() === 'true,false,false');
    C.placeAt(new T(o[0], 0.05, 4), 0, 0);
    step(20);
    jump();
    hold(true);
    const big = peak(150) - 0.04;
    hold(false);
    check('the hero suit: a super jump from the start', big > 6.5 && big < 9, `${big.toFixed(2)} m`);
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

    const station = (id) => hp.stations.find((s) => s.id === id);
    const visit = (id) => { const st = station(id); C.placeAt(new T(st.pos.x, st.pos.y + 0.05, st.pos.z + 1.1), 0, 0); step(4); return hp.owned.has(id); };
    check('flight is locked until you can swing', !visit('fly') && !visit('strength'));
    check('the plaza station gives swing', visit('swing'));
    check('  and lights the flight beacon', station('fly').beacon.visible && !station('swing').beacon.visible);
    check('the flight station is out of jumping reach', station('fly').pos.y - 0 > 20, `roof at ${f(station('fly').pos.y)} m`);

    // Swing down the avenue: hold G, ride the arc, let go.
    C.placeAt(new T(o[0] + 3, 0.05, -14), 0, 0);
    step(10);
    aim(o[0] + 3, 6, -40);
    const start = feet.clone();
    kd('KeyG');
    step(2);
    check('G hooks a line high on a building ahead', !!hp.swing && hp.swing.anchor.y > 12, hp.swing ? hp.swing.anchor.toArray().map(f).join(',') : 'missed');
    let top = 0;
    for (let i = 0; i < 120 && hp.swing; i++) { step(1); top = Math.max(top, hspeed()); }
    ku('KeyG');
    step(1);
    const travelled = Math.hypot(feet.x - start.x, feet.z - start.z);
    check('the swing builds real speed', top > 16, `${top.toFixed(1)} m/s`);
    check('letting go flings you on', !hp.swing && travelled > 12 && !C.grounded, `${travelled.toFixed(1)} m, y ${f(feet.y)}`);
    step(240);
    // Aim assist: look straight ahead along the avenue (not at a wall), still hooks.
    C.placeAt(new T(o[0], 0.05, -20), 0, 0);
    step(10);
    C.pitch = 0;
    kd('KeyG');
    step(2);
    check('with no wall in your sights, it finds one up ahead', !!hp.swing, hp.swing ? hp.swing.anchor.toArray().map(f).join(',') : 'missed');
    ku('KeyG');
    step(200);

    check('the rooftop station gives flight', visit('fly'));
    // Fly: jump, Space again in the air, W.
    C.placeAt(new T(o[0], 0.05, -20), 0, 0);
    step(10);
    jump();
    step(12);
    jump();
    step(2);
    check('Space in the air takes off', hp.flying);
    // Up above the rooftops, heading out over the plaza.
    C.placeAt(new T(o[0], 100, -20), Math.PI, 0);
    hp.fly();
    step(30);
    const y0 = feet.y;
    input.down.add('KeyW');
    step(120);
    check('W flies you where you look, and you stay up', hspeed() > 14 && Math.abs(feet.y - y0) < 2, `${hspeed().toFixed(1)} m/s, y ${f(y0)} -> ${f(feet.y)}`);
    input.down.add('ShiftLeft');
    step(90);
    check('Shift boosts', hspeed() > 27, `${hspeed().toFixed(1)} m/s`);
    input.down.delete('ShiftLeft');
    input.down.add('KeyW');
    C.placeAt(new T(o[0], 100, -20), Math.PI, 0);
    hp.fly();
    C.pitch = -0.6;
    step(90);
    check('diving is faster still', C.velocity.length() > 32, `${C.velocity.length().toFixed(1)} m/s`);
    input.down.delete('KeyW');
    C.pitch = 0;
    step(60);
    check('let go of W and you hover', hp.flying && C.velocity.length() < 4, `${C.velocity.length().toFixed(1)} m/s`);

    // Ground slam next to a parked car.
    const cars = hp.throwables.filter((t) => t.kind === 'car');
    check('cars parked around the city', cars.length >= 12, `${cars.length}`);
    const car = cars.find((t) => Math.abs(t.entity.object3d.position.x - (o[0] - 26)) < 0.5);
    const carBody = comp(car.entity, 'RigidBodyComponent').body;
    C.placeAt(new T(o[0] - 22, 18, -10), 0, 0);
    hp.fly();
    step(2);
    input.pressed.add('crouch');
    let carUp = 0;
    for (let i = 0; i < 120; i++) { step(1); carUp = Math.max(carUp, carBody.linvel().y); }
    check('C in the air slams you down', hp.slams === 1 && !hp.flying && C.grounded, `slams ${hp.slams}`);
    check('  and the shockwave throws the car', carUp > 3, `car vy ${carUp.toFixed(1)}`);
    step(120);

    check('Hero HQ roof gives super strength', visit('strength'));
    // Lift the car by the plaza and throw it.
    const car2 = cars.find((t) => Math.abs(t.entity.object3d.position.x - (o[0] + 26)) < 0.5);
    const c2 = car2.entity.object3d.position;
    C.placeAt(new T(c2.x - 4, 0.05, c2.z), 0, 0);
    step(10);
    aim(c2.x, c2.y, c2.z);
    kd('KeyE');
    step(30);
    check('E lifts a car over your head', hp.held === car2 && c2.y > feet.y + 2.5, `car y ${f(c2.y)}`);
    const from = c2.clone();
    C.pitch = 0.15;
    input.pressed.add('attack');
    step(40);
    check('click throws it', !hp.held && hp.throws === 1 && c2.distanceTo(from) > 15, `${c2.distanceTo(from).toFixed(1)} m`);
    step(60);
    // No fall damage: drop off a tall roof.
    const health = comp(player, 'Damageable') ?? comp(player, 'Health');
    const before = health?.health;
    C.placeAt(new T(o[0] + 36, 60, -84), 0, 0);
    step(200);
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
    const pc = comp(player, 'PlayerCombat');
    check('powers switch off outside Hero city, fists back on', C.cfg.jumpHeight === 1.25 && C.cfg.gravity === 24 && pc.enabled && teleports.current === 'hub');
    C.placeAt(new T(pad.position[0], 0.14, pad.position[2] + 2.2), 0, 0);
    step(5);
    C.placeAt(new T(pad.position[0], 0.14, pad.position[2]), 0, 0);
    step(30);
    check('and come back when you return', teleports.current === 'heroes' && C.cfg.jumpHeight === 8 && !pc.enabled, `jumpHeight ${C.cfg.jumpHeight}`);
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
    await shot('heroes-swing', `(() => { const { C, T, step, aim } = X; const hp = game.getSystem('hero-powers'); C.placeAt(new T(3000 + 3, 0.05, -14), 0, 0); step(5); aim(3000 + 3, 8, -40); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG' })); hp.swingFrom(C, hp.findAnchor(C)); step(25); })()`);
    await shot('heroes-fly', `(() => { const { C, T, step } = X; window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyG' })); const hp = game.getSystem('hero-powers'); C.placeAt(new T(3000 + 30, 75, 30), 0.3, 0); hp.fly(); C.pitch = -0.3; game.input.down.add('KeyW'); game.input.down.add('ShiftLeft'); step(60); })()`);
    await shot('heroes-lift', `(() => { const { C, T, step, aim } = X; const hp = game.getSystem('hero-powers'); game.input.down.clear(); const car = hp.throwables.find((t) => t.kind === 'car' && !hp.held); C.placeAt(new T(3000 + 16, 0.05, -24), 0, 0); step(5); hp.pickUp(car); step(20); C.pitch = 0.05; step(2); })()`);
  }

  r.push(`${errors.length ? 'FAIL' : 'PASS'}  no errors  ${errors.slice(0, 3).join(' | ')}`);
  console.log(r.join('\n'));
  await browser.close();
  process.exit(r.some((l) => l.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => {
  console.log('FAIL  crashed: ' + e.message);
  process.exit(1);
});
