// Axe throwing check: walk through the portal, grab axes at the rack, throw a
// round of five with the real weapon system, and check each lands where it was
// aimed and scores by its ring. SHOTS=dir saves screenshots.
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
  await page.evaluate(() => {
    try { localStorage.removeItem('gene40.axes.best'); } catch {}
    game.stop();
    const player = game.world.find('player');
    const comp = (e, n) => e.getAll().find((c) => c.constructor.name === n);
    const C = comp(player, 'PlayerController');
    const F = comp(player, 'Combatant');
    const T = player.object3d.position.constructor;
    let elapsed = 0;
    const frame = () => { elapsed += 1 / 60; const t = { delta: 1 / 60, elapsed, alpha: 1 }; game.world.update(t); game.getSystem('hud').update(t); };
    const step = (n) => { for (let i = 0; i < n; i++) { game.fixedStep(1 / 60); frame(); } };
    game.input._locked = true;
    const mdown = () => document.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    const mup = () => document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    const aim = (x, y, z) => {
      for (let k = 0; k < 3; k++) {
        const cam = game.renderer.camera.getWorldPosition(new T());
        const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
        C.yaw = Math.atan2(-dx, -dz);
        C.pitch = Math.atan2(dy, Math.hypot(dx, dz));
        frame();
      }
    };
    window.X = { player, comp, C, F, T, step, frame, mdown, mup, aim, render: () => game.renderer.render?.() };
  });
  const r = await page.evaluate(() => {
    const { player, comp, C, F, T, step, mdown, mup, aim } = X;
    const r = [];
    const check = (label, ok, extra = '') => r.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
    const range = game.getSystem('axe-range');
    check('the axe range is built', !!range && range.boards.length === 3);

    // Through the hub portal.
    const pad = teleports.pads.find((p) => p.sceneId === 'axes');
    C.placeAt(new T(pad.position[0], pad.position[1] + 0.02, pad.position[2] + 2.2), 0, 0);
    step(5);
    C.placeAt(new T(pad.position[0], pad.position[1] + 0.02, pad.position[2]), 0, 0);
    step(10);
    check('the hub portal takes you to the axe hall', teleports.current === 'axes');

    // Rack in lane 2 (middle).
    const board = range.boards[1].center;
    const rack = game.world.findByTag ? game.world.all().filter((e) => e.name === 'axe-rack').sort((a, b) => Math.abs(a.object3d.position.x - board.x) - Math.abs(b.object3d.position.x - board.x))[0] : null;
    C.placeAt(new T(board.x, 0.05, board.z + 4.3 + 0.5), 0, 0);
    step(30);
    comp(rack, 'Interactable').interact(player);
    step(40);
    check('the rack gives five axes', game.state.itemCount('throwing_axe') === 5, `${game.state.itemCount('throwing_axe')}`);
    check('an axe is in hand', F.itemId === 'throwing_axe', String(F.itemId));

    // Five throws: aim (allowing for the drop) at points worth 6, 4, 8 (killshot), 2 and a miss.
    const targets = [
      [0, 0, 6],
      [0.14, 0, 4],
      [0.47, 0.5, 8],
      [-0.38, 0, 2],
      [0, 1.4, 0],
    ];
    const landed = [];
    const off = game.events.on('axes:scored', (e) => landed.push(e.points));
    const where = [];
    const off2 = game.events.on('combat:impact', (e) => e.delivery === 'projectile' && where.push(e.point));
    for (const [dx, dy] of targets) {
      // Full wind-up throws at 13 m/s with half gravity: aim a little high.
      const cam = game.renderer.camera.getWorldPosition(new T());
      const dist = Math.abs(board.z - cam.z);
      const t = dist / 13;
      const drop = 0.5 * 9.81 * 0.5 * t * t;
      aim(board.x + dx, board.y + dy + drop, board.z);
      mdown();
      step(40);
      mup();
      step(90);
    }
    off();
    off2();
    check('five throws were counted', range.throws.length === 5 && !range.throws.includes(null), JSON.stringify(range.throws));
    targets.forEach(([dx, dy, want], k) => {
      const p = where[k];
      const miss = p ? Math.hypot(p.x - (board.x + dx), p.y - (board.y + dy)).toFixed(3) : '?';
      check(`throw ${k + 1} aimed at a ${want} scores ${want}`, landed[k] === want, `got ${landed[k]}, landed ${miss} m from the aim point (dx ${p ? (p.x - board.x - dx).toFixed(3) : "?"}, dy ${p ? (p.y - board.y - dy).toFixed(3) : "?"})`);
    });
    const total = targets.reduce((a, t) => a + t[2], 0);
    check('the round adds up', range.roundScore === total, `${range.roundScore} vs ${total}`);
    check('the best score is remembered', range.best === total && localStorage.getItem('gene40.axes.best') === String(total));
    check('no axes left in hand', game.state.itemCount('throwing_axe') === 0);
    const stuck = game.world.findByTag('stuck-projectile').length;
    check('the axes stay stuck where they landed', stuck === 5, `${stuck}`);

    // New round pulls them out.
    comp(rack, 'Interactable').interact(player);
    step(5);
    check('a new round clears the boards and refills', game.world.findByTag('stuck-projectile').length === 0 && game.state.itemCount('throwing_axe') === 5 && range.throws.length === 0);
    return r;
  });

  if (shots) {
    // A round in the board, viewed from the line.
    await page.evaluate(() => {
      const { C, T, step, mdown, mup, aim } = X;
      const range = game.getSystem('axe-range');
      const board = range.boards[1].center;
      for (const [dx, dy] of [[0.02, 0.03], [-0.15, 0.1], [0.2, -0.18], [0.47, 0.5], [-0.05, -0.32]]) {
        const cam = game.renderer.camera.getWorldPosition(new T());
        const t = Math.abs(board.z - cam.z) / 13;
        aim(board.x + dx, board.y + dy + 0.5 * 9.81 * 0.5 * t * t, board.z);
        mdown(); step(40); mup(); step(90);
      }
      C.placeAt(new T(board.x - 0.5, 0.05, board.z + 3.0), 0, 0);
      step(20);
      aim(board.x, board.y - 0.15, board.z);
      game.start();
      document.querySelector('.mp-lobby')?.remove();
      document.querySelectorAll('.hud .overlay, .hud .debug').forEach((e) => (e.style.display = 'none'));
    });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${shots}/axes-board.png` });
    await page.evaluate(() => {
      const { C, T, aim } = X;
      const o = teleports.pads.find((p) => p.sceneId === 'axes').to;
      game.stop();
      C.placeAt(new T(o[0], o[1], o[2] + 1), 0, 0);
      X.step(20);
      aim(o[0], 1.4, o[2] - 10);
      game.start();
    });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${shots}/axes-hall.png` });
  }

  r.push(`${errors.length ? 'FAIL' : 'PASS'}  no errors  ${errors.slice(0, 3).join(' | ')}`);
  console.log(r.join('\n'));
  await browser.close();
  process.exit(r.some((l) => l.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => {
  console.log('FAIL  crashed: ' + e.message);
  process.exit(1);
});
