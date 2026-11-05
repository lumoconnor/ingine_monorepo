// Touch controls check: emulates a phone in landscape and drives the on-screen controls
// with real (CDP) multi-touch events. Start `npm run dev` first, then: node scripts/touch-check.cjs
// Set SHOTS=dir to save screenshots.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({
    viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id]) => ({ x, y, id })) });
  const shots = process.env.SHOTS;
  const shot = async (n) => shots && page.screenshot({ path: `${shots}/${n}.png` });

  await page.goto((process.env.URL || 'http://localhost:5173/') + '?nosave');
  await page.waitForFunction(() => window.game && !document.querySelector('.play').disabled, null, { timeout: 30000 });
  await page.evaluate(() => localStorage.clear());
  const R = {};
  R.touchUi = await page.evaluate(() => document.body.classList.contains('touch-ui') && game.input.preferTouch);
  await shot('touch-start');

  // Tap "Click to play".
  const play = await page.locator('.play').boundingBox();
  await page.touchscreen.tap(play.x + play.width / 2, play.y + play.height / 2);
  await page.waitForTimeout(200);
  R.playing = await page.evaluate(() => ({ locked: game.input.locked, touch: game.input.touch, layer: !document.querySelector('.touch-layer').classList.contains('hidden') }));

  await page.evaluate(() => {
    game.stop();
    window.C = () => game.world.find('player').getAll()[1];
    window.RB = () => game.world.find('player').getAll()[0];
    window.step = (n) => { for (let i = 0; i < n; i++) game.fixedStep(1 / 60); };
    window.tp = (x, y, z, yaw = 0) => { const T = RB().entity.object3d.position.constructor; RB().teleport(new T(x, y, z)); C().velocity.set(0, 0, 0); C().yaw = yaw; C().pitch = 0; C().groundCarrier = null; step(20); };
    window.pos = () => { const p = C().feetPosition; return [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)]; };
  });
  const step = (n) => page.evaluate((n) => { step(n); for (let i = 0; i < 1; i++) game.renderer.render?.(); }, n);
  const ev = (f, ...a) => page.evaluate(f, ...a);

  // 1. Stick: thumb down at (150, 280), push up 50px -> walk forward.
  await ev(() => tp(0, 0.1, 8));
  await touch('touchStart', [[150, 280, 1]]);
  await touch('touchMove', [[150, 230, 1]]);
  await step(60);
  R.stickAxis = await ev(() => game.input.moveAxis());
  R.walk1s = await ev(() => [pos(), C().horizontalSpeed.toFixed(2), C().sprinting]);
  await shot('touch-stick');
  // Push well past the rim -> sprint.
  await touch('touchMove', [[150, 190, 1]]);
  await step(40);
  R.sprint = await ev(() => [C().horizontalSpeed.toFixed(2), C().sprinting, document.querySelector('.stick').classList.contains('sprint')]);

  // 2. Second finger looks while the first keeps moving: drag right 100px on the right half.
  await ev(() => game.input.consumeLook());
  await touch('touchMove', [[150, 190, 1], [560, 200, 2]]);
  for (let i = 1; i <= 5; i++) { await touch('touchMove', [[150, 190, 1], [560 + i * 20, 200, 2]]); await step(1); }
  await step(2);
  R.lookYaw = await ev(() => +game.input.consumeLook().yaw.toFixed(3)); // expect -0.52 (100px right = turn right)
  R.stillMoving = await ev(() => C().horizontalSpeed > 1);
  await touch('touchEnd', []);
  await step(30);
  R.released = await ev(() => [game.input.moveAxis(), C().horizontalSpeed.toFixed(2), game.input.isDown('sprint')]);

  const center = async (sel) => { const b = await page.locator(sel).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  // 3. Jump: hold -> higher than tap.
  const [jx, jy] = await center('.b-jump');
  await ev(() => tp(0, 0.1, 8));
  await touch('touchStart', [[jx, jy, 3]]);
  R.jumpDownSameFrame = await ev(() => [game.input.isDown('jump'), game.input.peekPressed('jump')]);
  R.holdPeak = await ev(() => { let pk = 0; for (let i = 0; i < 60; i++) { step(1); pk = Math.max(pk, C().feetPosition.y); } return pk.toFixed(2); });
  await touch('touchEnd', []);
  await step(60);
  await touch('touchStart', [[jx, jy, 3]]); await step(2); await touch('touchEnd', []);
  R.tapPeak = await ev(() => { let pk = 0; for (let i = 0; i < 60; i++) { step(1); pk = Math.max(pk, C().feetPosition.y); } return pk.toFixed(2); });
  await step(30);

  // 4. Crouch: tap toggles on, tap again toggles off; hold = momentary.
  const [cx, cy] = await center('.b-crouch');
  await touch('touchStart', [[cx, cy, 4]]); await step(3); await touch('touchEnd', []); await step(30);
  R.crouchTapOn = await ev(() => C().crouched);
  await touch('touchStart', [[cx, cy, 4]]); await step(3); await touch('touchEnd', []); await step(30);
  R.crouchTapOff = await ev(() => C().crouched);
  await touch('touchStart', [[cx, cy, 4]]); await page.waitForTimeout(350); await step(20);
  const held = await ev(() => C().crouched);
  await touch('touchEnd', []); await step(30);
  R.crouchHold = [held, await ev(() => C().crouched)];

  // 5. Attack: press is seen on the same frame; hold + drag on it also turns the camera.
  const [ax, ay] = await center('.b-attack');
  await ev(() => game.input.consumeLook());
  await touch('touchStart', [[ax, ay, 5]]);
  R.attackDownSameFrame = await ev(() => [game.input.isDown('attack'), game.input.peekPressed('attack')]);
  for (let i = 1; i <= 4; i++) { await touch('touchMove', [[ax - i * 10, ay, 5]]); await step(1); }
  R.attackLook = await ev(() => +game.input.consumeLook().yaw.toFixed(3)); // expect +0.21 (40px left)
  await touch('touchEnd', []);
  R.attackReleased = await ev(() => game.input.isDown('attack'));
  await step(60);

  // 6. Use button glows near a usable thing (Bram's door/levers); checked loosely.
  R.useBtnExists = await ev(() => !!document.querySelector('.b-use'));

  // 7. Inventory via Bag, close via the X.
  await page.evaluate(() => game.start());
  const [bx, by] = await center('.t-bag');
  await touch('touchStart', [[bx, by, 6]]); await touch('touchEnd', []);
  await page.waitForTimeout(300);
  R.invOpen = await ev(() => [inventory.isOpen, document.querySelector('.touch-layer').classList.contains('hidden')]);
  await shot('touch-inventory');
  const close = await center('.inv-close');
  await page.touchscreen.tap(close[0], close[1]);
  await page.waitForTimeout(300);
  R.invClosed = await ev(() => [inventory.isOpen, game.input.locked, !document.querySelector('.touch-layer').classList.contains('hidden')]);
  await page.waitForTimeout(400);
  await shot('touch-play');

  // 8. Pause and resume.
  const [px, py] = await center('.t-pause');
  await touch('touchStart', [[px, py, 7]]); await touch('touchEnd', []);
  await page.waitForTimeout(200);
  R.paused = await ev(() => [game.input.locked, !document.querySelector('.overlay').classList.contains('hidden')]);
  await shot('touch-paused');
  const res = await page.locator('.play').boundingBox();
  await page.touchscreen.tap(res.x + res.width / 2, res.y + res.height / 2);
  await page.waitForTimeout(200);
  R.resumed = await ev(() => [game.input.locked, game.input.touch]);

  // 9. Fullscreen button (top bar).
  const [fx, fy] = await center('.t-fs');
  await touch('touchStart', [[fx, fy, 8]]); await touch('touchEnd', []);
  await page.waitForTimeout(500);
  R.fullscreen = await ev(() => !!document.fullscreenElement);

  console.log(JSON.stringify(R, null, 1));
  console.log(errors.length ? errors.join('\n') : 'no errors');
  await browser.close();
})();
