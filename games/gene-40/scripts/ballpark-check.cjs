// Ballpark check: arrive and walk through the backstop to the plate, grab a
// bat (it's equipped), stand in the box and the machine pitches; a real click
// at the right moment hits it (well-timed = a long fly, early = pulled left,
// late = pushed right), not swinging is a strike, and a perfect swing looking
// up a little clears the wall for a home run (called with its distance). Ten pitches end the round and
// keep the best. SHOTS=dir saves screenshots.
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
    try { localStorage.removeItem('gene40.ballpark.best'); } catch {}
    const player = game.world.find('player');
    const comp = (e, n) => e.getAll().find((c) => c.constructor.name === n);
    const C = comp(player, 'PlayerController');
    const T = player.object3d.position.constructor;
    let elapsed = 0;
    const park = game.getSystem('ballpark');
    const frame = () => { elapsed += 1 / 60; const t = { delta: 1 / 60, elapsed, alpha: 1 }; game.world.update(t); park.update(t); };
    const step = (n) => { for (let i = 0; i < n; i++) { game.fixedStep(1 / 60); frame(); } };
    const input = game.input;
    input._locked = true;
    const click = () => { document.dispatchEvent(new MouseEvent('mousedown', { button: 0 })); step(2); document.dispatchEvent(new MouseEvent('mouseup', { button: 0 })); };
    const aim = (tx, ty, tz) => { for (let k = 0; k < 3; k++) { const cam = game.renderer.camera.getWorldPosition(new T()); const dx = tx - cam.x, dy = ty - cam.y, dz = tz - cam.z; C.yaw = Math.atan2(-dx, -dz); C.pitch = Math.atan2(dy, Math.hypot(dx, dz)); step(1); } };
    window.X = { comp, C, T, step, aim, park };
    const r = [];
    const check = (label, ok, extra = '') => r.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
    const ox = 4800;
    const feet = player.object3d.position;
    const f = (v) => v.toFixed(1);
    const where = () => [feet.x - ox, feet.y, feet.z].map(f).join(',');
    const P = (x, y, z) => new T(ox + x, y, z);

    const pad = teleports.pads.find((p) => p.sceneId === 'ballpark');
    C.placeAt(new T(pad.position[0], 0.14, pad.position[2] + 2.2), 0, 0);
    step(5);
    C.placeAt(new T(pad.position[0], 0.14, pad.position[2]), 0, 0);
    step(30);
    check('the portal brings you to the ballpark', teleports.current === 'ballpark');
    // Walk through the gap in the backstop to the plate.
    C.yaw = 0;
    input.down.add('KeyW');
    step(110);
    input.down.delete('KeyW');
    step(10);
    check('you can walk through the backstop to home plate', feet.z < -1, where());

    // Grab a bat.
    const rack = game.world.find('bat-rack');
    C.placeAt(P(-4, 0.05, 0.6), 0, 0);
    step(3);
    comp(rack, 'Interactable').interact(player);
    step(3);
    const cb = comp(player, 'Combatant');
    check('the rack gives you a bat in hand', game.state.itemCount('baseball_bat') === 1 && cb.itemId === 'baseball_bat', `${cb.itemId}`);
    check('and starts a round', park.roundOn && park.results.length === 0);

    // In the box, facing the pitcher.
    const box = park.boxCentre;
    const stand = (pitchDeg = 0) => { C.placeAt(new T(box.x, 0.05, box.z), 0, 0); step(2); C.yaw = 0; C.pitch = (pitchDeg * Math.PI) / 180; step(1); };
    stand();
    let tries = 0;
    while (!park.ball && tries++ < 400) step(1);
    check('the machine pitches once you are in the box', !!park.ball && park.ball.phase === 'pitch');
    // Don't swing: a strike.
    let res = [];
    const off = game.events.on('ballpark:result', (e) => res.push(e.result));
    tries = 0;
    while (res.length === 0 && tries++ < 300) step(1);
    check('taking a pitch is a strike', res[0] === 'strike', res.join(','));

    // Swing when the ball is `lead` metres from the plate (the swing's wind-up is ~0.06 s).
    const swingAt = (lead, pitchDeg = 0) => {
      stand(pitchDeg);
      res = [];
      let t = 0;
      while ((!park.ball || park.ball.phase !== 'pitch') && t++ < 400) step(1);
      t = 0;
      while (park.ball && park.ball.phase === 'pitch' && park.plate.z - park.ball.pos.z > lead && t++ < 300) step(1);
      click();
      t = 0;
      while (res.length === 0 && t++ < 600) step(1);
      return { result: res[0], hit: park.lastHit ? { ...park.lastHit } : null };
    };
    park.lastHit = null;
    const good = swingAt(1.2, 8);
    check('a well-timed swing makes contact and flies far', !!good.hit && good.hit.speed > 27 && ['double', 'triple', 'homer'].includes(good.result), `${good.result} ${JSON.stringify(good.hit && { speed: good.hit.speed.toFixed(1), launch: good.hit.launch.toFixed(0), spray: good.hit.spray.toFixed(0), dist: good.hit.dist.toFixed(0) })}`);
    park.lastHit = null;
    const early = swingAt(2.0);
    check('an early swing pulls it to left field', !!early.hit && early.hit.spray < -5, `${early.result} spray ${early.hit?.spray.toFixed(0)}`);
    park.lastHit = null;
    const late = swingAt(0.6);
    check('a late swing pushes it to right field', !!late.hit && late.hit.spray > 3, `${late.result} spray ${late.hit?.spray.toFixed(0)}`);
    park.lastHit = null;
    const homer = swingAt(1.25, 14);
    check('a perfect swing, looking up a little, is a home run', homer.result === 'homer' && homer.hit.dist > 62, `${homer.result} ${JSON.stringify(homer.hit && { dist: homer.hit.dist.toFixed(0), speed: homer.hit.speed.toFixed(1), launch: homer.hit.launch.toFixed(0), spray: homer.hit.spray.toFixed(0) })}`);
    park.lastHit = null;
    const miss = swingAt(6);
    check('swinging far too early misses: strike', miss.result === 'strike' && !miss.hit, `${miss.result}`);
    // Finish the round (5 more pitches).
    for (let k = 0; k < 4; k++) swingAt(1.2, 8);
    const before = park.results.length;
    swingAt(1.25, 14);
    off();
    check('ten pitches end the round', park.results.length === 10 && !park.roundOn, `${park.results.length}: ${park.results.join(',')}`);
    check('the best round is kept', park.best === park.score && park.score > 0 && Number(localStorage.getItem('gene40.ballpark.best')) === park.score, `best ${park.best}, score ${park.score}`);
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
    const aimFrom = `(x, y, z, tx, ty, tz) => { const { C, T, step, aim } = X; C.placeAt(new T(4800 + x, y, z), 0, 0); step(5); aim(4800 + tx, ty, tz); }`;
    await shot('ballpark-arrival', `(${aimFrom})(0, 0.05, 6, 0, 3, -40)`);
    await shot('ballpark-box', `(${aimFrom})(-0.95, 0.05, -4, 0, 1.3, -22)`);
    await shot('ballpark-overview', `(${aimFrom})(-30, 30, 20, 0, 0, -40)`);
    await shot('ballpark-outfield', `(${aimFrom})(0, 0.05, -40, 0, 15, -90)`);
  }

  r.push(`${errors.length ? 'FAIL' : 'PASS'}  no errors  ${errors.slice(0, 3).join(' | ')}`);
  console.log(r.join('\n'));
  await browser.close();
  process.exit(r.some((l) => l.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => {
  console.log('FAIL  crashed: ' + e.message);
  process.exit(1);
});
