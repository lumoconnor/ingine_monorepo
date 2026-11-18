// Sound check: footsteps while walking (and the ground they're on), coin and
// star pickups, a different tune in every world, NPC lines typing out with
// talk blips, and the Esc menu's sound and music switches. Counts what the
// game asks the audio system to play, so it works with no sound card.
const { chromium } = require('playwright');

const URL = process.env.URL || 'http://localhost:5175/';
const SIGNAL = process.env.SIGNAL || '127.0.0.1:9000';
const r = [];
const check = (label, ok, extra = '') => r.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 480, height: 300 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(`${URL}?signal=${SIGNAL}`);
  await page.waitForFunction(() => window.game && window.game.world.find('player'), null, { timeout: 30000 });

  const res = await page.evaluate(() => {
    game.stop();
    const player = game.world.find('player');
    const comp = (e, n) => e.getAll().find((c) => c.constructor.name === n);
    const C = comp(player, 'PlayerController');
    const V = player.object3d.position.constructor;
    let elapsed = 0;
    const step = (n) => {
      for (let i = 0; i < n; i++) {
        game.fixedStep(1 / 60);
        elapsed += 1 / 60;
        game.world.update({ delta: 1 / 60, elapsed, alpha: 1 });
      }
    };
    const out = [];
    const ck = (label, ok, extra = '') => out.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
    const input = game.input;
    const feet = game.getSystem('footsteps');
    const played = () => ({ ...audio.played });
    const go = (id) => {
      const p = teleports.pads.find((q) => q.sceneId === id);
      teleports.go(p.to, p.toYaw, p.sceneId);
      step(3);
    };

    // Footsteps at the plaza.
    step(30);
    const s0 = feet.steps;
    input.down.add('KeyW');
    step(180);
    input.down.delete('KeyW');
    const walked = feet.steps - s0;
    ck('walking makes footsteps (two or three a second)', walked >= 5 && walked <= 9, `${walked} steps in 3 s`);
    step(60);
    const s1 = feet.steps;
    step(60);
    ck('standing still is silent', feet.steps === s1);

    // The ground decides the sound.
    const surf = (x, y, z) => feet.surfaceAt({ x, y, z });
    ck('grass in Murph Land, carpet on the cat trees', surf(1800, 0, 0) === 'grass' && surf(1800, 3, 0) === 'carpet');
    ck('wood in the axe hall, carpet in the office', surf(600, 0, 0) === 'wood' && surf(1200, 0, 0) === 'carpet');

    // Jumps and landings.
    const p0 = played();
    C.placeAt(new V(0, 3, 6), 0, 0);
    step(90);
    ck('a drop lands with a thud', (audio.played.land ?? 0) > (p0.land ?? 0));

    // Music: a different track in every world.
    const tracks = {};
    tracks.hub = audio.musicId;
    for (const p of teleports.pads.filter((q) => q.sceneId !== 'hub')) {
      go(p.sceneId);
      tracks[p.sceneId] = audio.musicId;
    }
    const ids = Object.values(tracks);
    ck('every world has its own music', ids.every(Boolean) && new Set(ids).size === ids.length, JSON.stringify(tracks));
    teleports.goHub();
    step(3);
    ck('back at the plaza the plaza tune plays', audio.musicId === tracks.hub);

    // Coins.
    go('murph');
    const coins = game.getSystem('murph-coins');
    const c = coins.coins.find((k) => !k.taken);
    const coin0 = audio.played.coin ?? 0;
    C.placeAt(new V(c.pos.x, c.pos.y + 0.05, c.pos.z), 0, 0);
    step(10);
    ck('picking up a Murphy coin plays the coin sound', (audio.played.coin ?? 0) === coin0 + 1, `found ${coins.found}`);

    // Stars.
    go('stars');
    const sc = game.getSystem('star-course');
    const st = sc.stars.find((k) => !k.taken);
    const wp = st.group.getWorldPosition(new V());
    const star0 = audio.played.star ?? 0;
    C.placeAt(new V(wp.x, wp.y + 0.05, wp.z), 0, 0);
    step(10);
    ck('picking up a star plays the star sound', (audio.played.star ?? 0) === star0 + 1, `found ${sc.found}`);

    // Start a conversation (typing is checked outside, on real frames).
    go('arup');
    window.__lines = [];
    game.events.on('dialogue:line', (l) => window.__lines.push(l));
    comp(game.world.find('aurora'), 'Interactable').interact(player);
    step(2);
    return out;
  });
  r.push(...res);

  // The line types out letter by letter, with blips.
  const early = await page.evaluate(() => [document.querySelector('.dialogue .line').textContent.length, window.__lines[0]?.text.length ?? 0]);
  await page.waitForTimeout(300);
  const mid = await page.evaluate(() => document.querySelector('.dialogue .line').textContent.length);
  check('NPC lines type out letter by letter', early[1] > 20 && mid > 0 && mid < early[1], `${mid} of ${early[1]} letters after 0.3 s`);
  await page.waitForFunction(() => game.getSystem('gene-audio').blips > 3, null, { timeout: 5000 }).catch(() => {});
  const blips = await page.evaluate(() => [game.getSystem('gene-audio').blips, Object.keys(audio.played).filter((k) => k.startsWith('blip_'))]);
  check('talking makes little blips', blips[0] > 3, `${blips[0]} blips (${blips[1].join(', ')})`);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(100);
  const done = await page.evaluate(() => [document.querySelector('.dialogue .line').textContent, window.__lines[0]?.text, window.__lines.length]);
  check('E shows the rest of the line (without picking a reply)', done[0] === done[1] && done[2] === 1);

  // Every sound and every tune plays for real without a hitch.
  const real = await page.evaluate(async () => {
    audio.start();
    if (!audio.ctx) return { ok: false, why: 'no audio context' };
    await audio.ctx.resume();
    const names = audio.soundNames;
    for (const n of names) audio.play(n, { pitch: n.startsWith('blip_') ? 300 : 1 });
    for (const id of ['hub', 'axes', 'arup', 'murph', 'stars', 'heroes', 'buddies', 'tattoo', 'ballpark', 'hoops']) {
      const p = teleports.pads.find((q) => q.sceneId === id) ?? { to: [0, 0.05, 6], toYaw: 0 };
      teleports.go(p.to, p.toYaw, id);
      game.fixedStep(1 / 60);
      await new Promise((r) => setTimeout(r, 400));
    }
    return { ok: true, n: names.length, errors: audio.errors, state: audio.ctx.state };
  });
  check('every sound and every world\'s tune plays without an error', real.ok && real.errors === 0, JSON.stringify(real));

  // Esc menu switches.
  const menu = await page.evaluate(() => {
    const sfx = document.querySelector('.sfx-btn');
    const mus = document.querySelector('.music-btn');
    const before = [sfx?.textContent, mus?.textContent];
    sfx?.click();
    mus?.click();
    const after = [sfx?.textContent, mus?.textContent, audio.sfxOn, audio.musicOn, localStorage.getItem('gene40.audio')];
    sfx?.click();
    mus?.click();
    return { before, after, back: [audio.sfxOn, audio.musicOn] };
  });
  check('the Esc menu has sound and music switches', menu.before[0] === 'Sound: on' && menu.before[1] === 'Music: on', JSON.stringify(menu.before));
  check('  they turn sound and music off and remember it', menu.after[0] === 'Sound: off' && menu.after[1] === 'Music: off' && !menu.after[2] && !menu.after[3] && /"sfx":false/.test(menu.after[4] ?? ''), JSON.stringify(menu.after));
  check('  and back on', menu.back[0] && menu.back[1]);

  check('no errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(r.join('\n'));
  await browser.close();
  process.exit(r.some((l) => l.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => {
  console.log('FAIL  crashed: ' + e.message);
  process.exit(1);
});
