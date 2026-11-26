// Tattoo check: arrive on the street, walk in through the shop door (the
// windows stop you), talk to Annie, pick a design off the flash wall, sit in
// the chair and get inked: it's on your forearm (seen when you raise your
// fists), kept in this browser, and a new design goes over the old one.
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
    try { localStorage.removeItem('gene40.tattoo'); } catch {}
    const player = game.world.find('player');
    const comp = (e, n) => e.getAll().find((c) => c.constructor.name === n);
    const C = comp(player, 'PlayerController');
    const T = player.object3d.position.constructor;
    let elapsed = 0;
    const frame = () => { elapsed += 1 / 60; game.world.update({ delta: 1 / 60, elapsed, alpha: 1 }); };
    const step = (n) => { for (let i = 0; i < n; i++) { game.fixedStep(1 / 60); frame(); } };
    const input = game.input;
    input._locked = true;
    const aim = (tx, ty, tz) => { for (let k = 0; k < 3; k++) { const cam = game.renderer.camera.getWorldPosition(new T()); const dx = tx - cam.x, dy = ty - cam.y, dz = tz - cam.z; C.yaw = Math.atan2(-dx, -dz); C.pitch = Math.atan2(dy, Math.hypot(dx, dz)); step(1); } };
    window.X = { comp, C, T, step, aim };
    const r = [];
    const check = (label, ok, extra = '') => r.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
    const ox = 4200;
    const feet = player.object3d.position;
    const f = (v) => v.toFixed(1);
    const where = () => [feet.x - ox, feet.y, feet.z].map(f).join(',');
    const P = (x, y, z) => new T(ox + x, y, z);
    const shop = game.getSystem('tattoo');

    const pad = teleports.pads.find((p) => p.sceneId === 'tattoo');
    C.placeAt(new T(pad.position[0], 0.14, pad.position[2] + 2.2), 0, 0);
    step(5);
    C.placeAt(new T(pad.position[0], 0.14, pad.position[2]), 0, 0);
    step(30);
    check('the portal brings you to the tattoo parlour', teleports.current === 'tattoo');
    check('you land on the street outside', Math.abs(feet.y) < 0.2 && feet.z > 4, where());
    // The windows stop you.
    C.placeAt(P(-4, 0.05, 4), 0, 0);
    step(3);
    C.yaw = 0;
    input.down.add('KeyW');
    step(90);
    input.down.delete('KeyW');
    check('the shop windows stop you', feet.z > 2.2, where());
    // Through the door.
    C.placeAt(P(0, 0.05, 6), 0, 0);
    step(3);
    C.yaw = 0;
    input.down.add('KeyW');
    step(110);
    input.down.delete('KeyW');
    step(10);
    check('you can walk in through the door', feet.z < -2 && feet.z > -14, where());

    // Annie talks (she only says one thing).
    const lines = [];
    const offL = game.events.on('dialogue:line', (l) => lines.push(l));
    const talk = () => {
      lines.length = 0;
      const annie = game.world.find('annie');
      const p = annie.object3d.position;
      C.placeAt(new T(p.x - 1.4, 0.05, p.z), 0, 0);
      step(2);
      comp(annie, 'Interactable').interact(player);
      step(2);
      game.getSystem('dialogue').end();
      step(2);
      return lines[0];
    };
    const hi = talk();
    check('Annie the artist talks', !!hi && hi.text === 'I NEED A SNACK', hi ? hi.text.slice(0, 50) : 'nothing');

    // The chair wants a design first.
    const chairBack = game.world.find('tattoo-chair');
    const sit = () => { C.placeAt(P(1.8, 0.05, -8.4), -Math.PI / 2, 0); step(2); comp(chairBack, 'Interactable').interact(player); step(2); };
    sit();
    check('the chair asks you to pick a design first', shop.inking === 0 && !shop.inked);
    // Pick the heart off the flash wall.
    const pick = (id) => {
      const e = game.world.find(`flash:${id}`);
      const p = e.object3d.position;
      C.placeAt(new T(p.x, 0.05, p.z + 1.5), 0, 0);
      step(2);
      comp(e, 'Interactable').interact(player);
      step(2);
    };
    pick('heart');
    check('E on the flash wall picks a design', shop.chosen === 'heart');
    sit();
    check('sitting in the chair starts the ink', shop.inking > 2, `${shop.inking.toFixed(1)} s`);
    // Try to walk away: you stay put.
    C.yaw = 0;
    input.down.add('KeyW');
    step(60);
    input.down.delete('KeyW');
    check('you stay in the chair while inked', shop.inking > 0 && Math.hypot(feet.x - ox - 3.6, feet.z + 8.2) < 0.7, where());
    step(150);
    check('the tattoo is done', shop.inking === 0 && shop.inked === 'heart' && game.state.hasFlag('tattoo.inked'));
    check('it is kept in this browser', localStorage.getItem('gene40.tattoo') === 'heart');
    const arm = comp(player, 'FistViewmodel').fistModel;
    const decal = arm.getObjectByName('tattoo');
    check('it is on your forearm', !!decal && decal.parent === arm);
    // Raise your fists (hold the guard button) and there it is.
    input.down.add('Mouse2');
    step(30);
    check('raising your fists shows it', arm.visible, `${arm.visible}`);
    input.down.delete('Mouse2');
    step(30);
    // A new design goes over the old one.
    pick('cat');
    sit();
    step(200);
    const decals = [];
    arm.traverse((o) => o.name === 'tattoo' && decals.push(o));
    check('a new design replaces the old one', shop.inked === 'cat' && decals.length === 1, `${shop.inked}, ${decals.length} on the arm`);
    const after = talk();
    check('Annie still needs a snack', !!after && after.text === 'I NEED A SNACK', after ? after.text.slice(0, 40) : 'nothing');
    offL();
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
    const aimFrom = `(x, y, z, tx, ty, tz) => { const { C, T, step, aim } = X; game.input.down.delete('Mouse2'); C.placeAt(new T(4200 + x, y, z), 0, 0); step(5); aim(4200 + tx, ty, tz); }`;
    await shot('tattoo-street', `(${aimFrom})(0, 0.05, 9, 0, 2.6, 0)`);
    await shot('tattoo-flash-wall', `(${aimFrom})(0, 0.05, -9.5, 0, 1.9, -14)`);
    await shot('tattoo-inside', `(${aimFrom})(-5.5, 0.05, -1, 4, 1.0, -9)`);
    await shot('tattoo-annie', `(${aimFrom})(3.4, 0.05, -10.6, 5.2, 0.85, -9.4)`);
    await shot('tattoo-arm', `(() => { const { C, T, step, aim } = X; C.placeAt(new T(4200, 0.05, -6), 0, 0); step(3); aim(4200, 0.6, -9); game.input.down.add('Mouse2'); })()`);
  }

  r.push(`${errors.length ? 'FAIL' : 'PASS'}  no errors  ${errors.slice(0, 3).join(' | ')}`);
  console.log(r.join('\n'));
  await browser.close();
  process.exit(r.some((l) => l.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => {
  console.log('FAIL  crashed: ' + e.message);
  process.exit(1);
});
