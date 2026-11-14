// Hub + teleport check: one browser, no room needed (the world runs behind the lobby).
// Walks onto every portal, checks you arrive in that world beside its way home,
// takes the way home, and presses H. SHOTS=dir saves screenshots.
const { chromium } = require('playwright');

const URL = process.env.URL || 'http://localhost:5175/';
const SIGNAL = process.env.SIGNAL || '127.0.0.1:9000';
const shots = process.env.SHOTS;
const r = [];
const check = (label, ok, extra = '') => r.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: shots ? { width: 1280, height: 720 } : { width: 480, height: 300 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(`${URL}?signal=${SIGNAL}`);
  await page.waitForFunction(() => window.game && window.game.world.find('player'), null, { timeout: 30000 });
  await page.evaluate(() => {
    const comp = (e, n) => e.getAll().find((c) => c.constructor.name === n);
    const player = () => game.world.find('player');
    window.T = {
      feet: () => player().object3d.position.toArray(),
      place: (x, y, z, yaw = 0) => comp(player(), 'PlayerController').placeAt(new (player().object3d.position.constructor)(x, y, z), yaw, 0),
      pads: () => teleports.pads.map((p) => ({ ...p })),
      hideLobby: () => { document.querySelector('.mp-lobby')?.remove(); document.querySelectorAll('.hud .overlay, .hud .debug, .room-hud, .voice-hud').forEach((e) => (e.style.display = 'none')); },
    };
  });
  const wait = (ms) => page.waitForTimeout(ms);
  /** Wait until the player is in a scene (teleports are applied on the next fixed step). */
  const until = (id) => page.waitForFunction((id) => teleports.current === id, id, { timeout: 5000 }).catch(() => {});
  /** Wait a few fixed steps, however slow the software renderer is. */
  const steps = async (n = 4) => {
    const t0 = await page.evaluate(() => teleports.ticks);
    await page.waitForFunction(([t0, n]) => teleports.ticks >= t0 + n, [t0, n], { timeout: 5000 }).catch(() => wait(600));
  };
  const shot = async (name) => {
    if (!shots) return;
    await page.evaluate(() => T.hideLobby());
    await wait(400);
    await page.screenshot({ path: `${shots}/${name}.png` });
  };

  await wait(800);
  const start = await page.evaluate(() => T.feet());
  check('player starts on the plaza, standing', Math.abs(start[1]) < 0.3 && Math.hypot(start[0], start[2]) < 20, JSON.stringify(start.map((v) => +v.toFixed(2))));
  await shot('hub-spawn');

  const pads = await page.evaluate(() => T.pads());
  const portals = pads.filter((p) => p.sceneId !== 'hub');
  const homes = pads.filter((p) => p.sceneId === 'hub');
  check('a portal for every world, and a way home from each', portals.length === 9 && homes.length === 9, `${portals.length} portals, ${homes.length} home pads`);

  for (const p of portals) {
    // Stand just off the pad, then step onto it.
    await page.evaluate(([x, y, z]) => T.place(x, y + 0.02, z + 2.2), p.position);
    await steps();
    await page.evaluate(([x, y, z]) => T.place(x, y + 0.02, z), p.position);
    await until(p.sceneId);
    await steps();
    const at = await page.evaluate(() => [T.feet(), teleports.current]);
    const d = Math.hypot(at[0][0] - p.to[0], at[0][2] - p.to[2]);
    check(`portal to ${p.sceneId} works`, at[1] === p.sceneId && d < 1.5, `in ${at[1]}, ${d.toFixed(2)} m from arrival`);
    if (p.sceneId === 'axes') await shot('scene-arrival');
    // Not standing on anything there: arrived beside the home pad.
    const home = homes.find((h) => Math.abs(h.position[0] - p.to[0]) < 100);
    check(`  ${p.sceneId} has its home pad nearby`, !!home && Math.hypot(home.position[0] - at[0][0], home.position[2] - at[0][2]) < 8);
    // Walk back on the home pad.
    await steps();
    await page.evaluate(([x, y, z]) => T.place(x, y + 0.02, z), home.position);
    await until('hub');
    await steps();
    const back = await page.evaluate(() => [T.feet(), teleports.current]);
    check(`  home pad from ${p.sceneId} returns to the plaza`, back[1] === 'hub' && Math.hypot(back[0][0], back[0][2]) < 20);
  }

  // H from a world.
  await page.evaluate(([x, y, z]) => T.place(x, y, z), portals[3].to);
  await wait(200);
  await page.keyboard.press('KeyH');
  await wait(300);
  const h = await page.evaluate(() => [T.feet(), teleports.current]);
  check('H brings you back to the plaza', h[1] === 'hub' && Math.hypot(h[0][0], h[0][2]) < 20);

  // A view of the portal ring from behind the cake.
  if (shots) {
    await page.evaluate(() => T.place(0, 0.05, 13, 0));
    await wait(500);
    await page.evaluate(() => {
      const c = game.world.find('player').getAll().find((c) => c.constructor.name === 'PlayerController');
      c.pitch = 0.18;
    });
    await shot('hub-cake');
    await page.evaluate(() => T.place(-3, 0.05, -3, Math.atan2(3, 10)));
    await wait(300);
    await shot('hub-portals');
  }

  check('no errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(r.join('\n'));
  await browser.close();
  process.exit(r.some((l) => l.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => {
  console.log('FAIL  crashed: ' + e.message);
  process.exit(1);
});
