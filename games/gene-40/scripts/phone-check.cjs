// Phone check: an emulated iPhone in landscape. The on-screen controls show
// once you tap to play, nothing covers them, the stick moves you, and the
// party's own buttons work: Home away from the plaza, Dash and Grapple in hero
// city, pause. SHOTS=dir saves screenshots.
const { chromium, devices } = require('playwright');

const URL = process.env.URL || 'http://localhost:5175/';
const SIGNAL = process.env.SIGNAL || '127.0.0.1:9000';
const shots = process.env.SHOTS;
const r = [];
const check = (label, ok, extra = '') => r.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'], ...(shots ? {} : { deviceScaleFactor: 1 }) });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(`${URL}?signal=${SIGNAL}`);
  await page.waitForFunction(() => window.game && window.game.world.find('player'), null, { timeout: 60000 });
  const wait = (ms) => page.waitForTimeout(ms);
  const shot = async (name) => shots && (await page.screenshot({ path: `${shots}/${name}.png` }));
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  /** A finger press on an element's centre, held for `ms`. */
  const press = async (sel, ms = 120) => {
    const b = await page.locator(sel).first().boundingBox();
    await touch('touchStart', [[b.x + b.width / 2, b.y + b.height / 2]]);
    await wait(ms);
    await touch('touchEnd', []);
  };
  const ticks = async (n) => {
    const t0 = await page.evaluate(() => teleports.ticks);
    await page.waitForFunction(([t0, n]) => teleports.ticks >= t0 + n, [t0, n], { timeout: 20000 }).catch(() => {});
  };
  /** Is the centre of this element the topmost thing there (nothing covering it)? */
  const uncovered = (sel) =>
    page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el || el.offsetParent === null) return false;
      const b = el.getBoundingClientRect();
      const top = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return !!top && (top === el || el.contains(top));
    }, sel);

  await wait(1000);
  await page.fill('input[name=name]', 'Gene');
  await page.tap('.mp-host');
  await page.waitForSelector('.overlay .play', { state: 'visible', timeout: 15000 });
  check('the start button says "Tap to play"', (await page.textContent('.overlay .play')) === 'Tap to play');
  await page.tap('.overlay .play');
  await wait(800);
  const st = await page.evaluate(() => ({ touch: game.input.touch, shown: !document.querySelector('.touch-layer').classList.contains('hidden') }));
  check('tapping play shows the on-screen controls', st.touch && st.shown, JSON.stringify(st));
  await shot('phone-plaza');

  const covered = [];
  for (const sel of ['.t-pause', '.t-fs', '.t-bag', '.b-attack', '.b-jump', '.b-use', '.b-crouch', '.b-alt']) if (!(await uncovered(sel))) covered.push(sel);
  check('nothing covers the buttons (room panel, mic label)', covered.length === 0, covered.join(' '));
  const vis = (sel) => page.evaluate((sel) => !!document.querySelector(sel) && document.querySelector(sel).offsetParent !== null, sel);
  const extras = () => page.evaluate(() => [...document.querySelectorAll('.t-extra')].filter((e) => e.offsetParent !== null).map((e) => e.textContent));
  check('at the plaza: no Home, Dash or Grapple button', (await extras()).length === 0, JSON.stringify(await extras()));

  // The stick: hold it forward and you walk.
  const p0 = await page.evaluate(() => game.world.find('player').object3d.position.toArray());
  const vp = page.viewportSize();
  const sx = vp.width * 0.18, sy = vp.height * 0.7;
  await touch('touchStart', [[sx, sy]]);
  for (let k = 1; k <= 5; k++) {
    await touch('touchMove', [[sx, sy - k * 10]]);
    await wait(30);
  }
  await ticks(60);
  await touch('touchEnd', []);
  const p1 = await page.evaluate(() => game.world.find('player').object3d.position.toArray());
  check('pushing the stick forward walks you forward', p0[2] - p1[2] > 1, `moved ${(p0[2] - p1[2]).toFixed(2)} m`);

  // Hero city: Dash and Grapple appear once you have them and work; Home takes you back.
  await page.evaluate(() => { const p = teleports.pads.find((q) => q.sceneId === 'heroes'); teleports.go(p.to, p.toYaw, p.sceneId); });
  await ticks(4);
  check('in hero city before any power: just Home', JSON.stringify(await extras()) === '["Home"]', JSON.stringify(await extras()));
  await page.evaluate(() => {
    const hp = game.getSystem('hero-powers');
    for (const id of ['dash', 'grapple']) { hp.owned.add(id); game.events.emit('heroes:power', { power: id }); }
  });
  check('with the powers: Home, Dash and Grapple buttons', JSON.stringify((await extras()).sort()) === JSON.stringify(['Dash', 'Grapple', 'Home']), JSON.stringify(await extras()));
  await shot('phone-heroes');
  const d0 = await page.evaluate(() => game.world.find('player').object3d.position.toArray());
  await press('.t-extra:text("Dash")');
  await ticks(20);
  const d1 = await page.evaluate(() => game.world.find('player').object3d.position.toArray());
  check('Dash bursts you forward', Math.hypot(d1[0] - d0[0], d1[2] - d0[2]) > 2, `${Math.hypot(d1[0] - d0[0], d1[2] - d0[2]).toFixed(2)} m`);
  const n0 = await page.evaluate(() => teleports.count);
  await press('.t-extra:text("Home")');
  await page.waitForFunction((n) => teleports.count > n, n0, { timeout: 20000 }).catch(() => {});
  check('Home takes you back to the plaza', (await page.evaluate(() => teleports.current)) === 'hub');

  // Pause, then play again.
  await press('.t-pause');
  await wait(400);
  check('the pause button opens the menu', await vis('.overlay .play'));
  await shot('phone-menu');
  check('  which has the sound switches', (await vis('.sfx-btn')) && (await vis('.music-btn')));

  check('no errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(r.join('\n'));
  await browser.close();
  process.exit(r.some((l) => l.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => {
  console.log('FAIL  crashed: ' + e.message);
  process.exit(1);
});
