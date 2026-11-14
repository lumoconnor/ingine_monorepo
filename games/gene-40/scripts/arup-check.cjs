// Arup office check: arrive by the lift facing the sign, talk to Aurora,
// Chris, Renee and Big Liz (random lines), and see Big Liz walk her laps.
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
    const frame = () => { elapsed += 1 / 60; const t = { delta: 1 / 60, elapsed, alpha: 1 }; game.world.update(t); };
    const step = (n) => { for (let i = 0; i < n; i++) { game.fixedStep(1 / 60); frame(); } };
    window.X = { comp, C, T, step, frame };
    const r = [];
    const check = (label, ok, extra = '') => r.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);

    const pad = teleports.pads.find((p) => p.sceneId === 'arup');
    C.placeAt(new T(pad.position[0], 0.14, pad.position[2] + 2.2), 0, 0);
    step(5);
    C.placeAt(new T(pad.position[0], 0.14, pad.position[2]), 0, 0);
    step(30);
    check('the portal brings you to the Arup office', teleports.current === 'arup');
    const feet = player.object3d.position;
    const o = [1200, 0, 0];
    check('you arrive in the lift lobby, standing on the floor', Math.abs(feet.y - o[1]) < 0.2 && Math.abs(feet.z - (o[2] + 6)) < 0.5, feet.toArray().map((v) => v.toFixed(2)).join(','));
    const sign = game.world.all().find((e) => e.name === 'sign:ARUP');
    const toSign = sign && sign.object3d.position.clone().sub(feet);
    check('the Arup sign is straight ahead as you step out', !!sign && toSign.z < -5 && Math.abs(toSign.x) < 1, toSign && toSign.toArray().map((v) => v.toFixed(1)).join(','));
    const home = teleports.pads.find((p) => p.sceneId === 'hub' && Math.abs(p.position[0] - o[0]) < 50);
    check('the way home is inside the lift behind you', !!home && home.position[2] > feet.z + 3);

    // Talk to everyone.
    const lines = [];
    const off = game.events.on('dialogue:line', (l) => lines.push(l));
    const dlg = game.getSystem('dialogue');
    const talk = (id) => {
      const e = game.world.find(id);
      lines.length = 0;
      comp(e, 'Interactable').interact(player);
      step(2);
      const first = lines[0];
      dlg.end?.() ?? dlg.stop?.();
      step(2);
      return first;
    };
    for (const [id, name] of [['aurora', 'Aurora'], ['chris', 'Chris'], ['renee', 'Renee'], ['big_liz', 'Big Liz']]) {
      const first = talk(id);
      check(`${name} says hello`, first && first.speaker === name && /gene/i.test(first.text), first ? first.text.slice(0, 60) : 'nothing');
    }
    // After hello, lines are random.
    const seen = new Set();
    for (let k = 0; k < 30; k++) seen.add(talk('chris')?.text);
    check('Chris says random things (several different openers)', seen.size >= 4, `${seen.size} different`);
    off();

    // Big Liz walks.
    const liz = game.world.find('big_liz');
    const p0 = liz.object3d.position.clone();
    C.placeAt(new T(o[0] - 15, 0.05, o[2] + 5), 0, 0); // out of her way
    step(600);
    const moved = liz.object3d.position.distanceTo(p0);
    check('Big Liz does laps of the atrium', moved > 2, `${moved.toFixed(1)} m in 10 s`);
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
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${shots}/${name}.png` });
      await page.evaluate(() => game.stop());
    };
    const aimFrom = `(x, y, z, tx, ty, tz) => { const { C, T, step } = X; C.placeAt(new T(x, y, z), 0, 0); step(5); const cam = game.renderer.camera.getWorldPosition(new T()); const dx = tx - cam.x, dy = ty - cam.y, dz = tz - cam.z; C.yaw = Math.atan2(-dx, -dz); C.pitch = Math.atan2(dy, Math.hypot(dx, dz)); step(2); }`;
    await shot('arup-aurora', `(${aimFrom})(1200 + 18.2, 0.05, 1.6, 1200 + 20.4, 1.55, 2.4)`);
    await shot('arup-arrival', `(${aimFrom})(1200, 0.05, 6, 1200, 2.0, -1.2)`);
    await shot('arup-chris', `(${aimFrom})(1200 - 8.6, 0.05, -0.6, 1200 - 10.2, 1.5, -1.5)`);
    await shot('arup-liz', `(() => { const l = game.world.find('big_liz').object3d.position; (${aimFrom})(1200, 0.05, -3, l.x, 2.2, l.z); })()`);
    await shot('arup-kitchen', `(${aimFrom})(1200 + 11, 0.05, -10.5, 1200 + 14, 1.2, -18.5)`);
  }

  r.push(`${errors.length ? 'FAIL' : 'PASS'}  no errors  ${errors.slice(0, 3).join(' | ')}`);
  console.log(r.join('\n'));
  await browser.close();
  process.exit(r.some((l) => l.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => {
  console.log('FAIL  crashed: ' + e.message);
  process.exit(1);
});
