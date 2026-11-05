// Combat phase 2 check: weapons as item instances, the sword (combo, heavy), the pistol
// (magazine, reloads, aiming, recoil), slots, drop/pick up, saves v2 and v1 migration,
// weapon validation. Start `npm run dev` first, then: node scripts/weapons-check.cjs
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
  page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
  await page.goto(process.env.URL || 'http://localhost:5173/');
  // Engine modules as the dev server serves them to the app (same URL = same module instance).
  await page.evaluate((p) => (window.__engineSrc = p), '/@fs' + require('node:path').resolve(__dirname, '../../../packages/engine/src'));
  await page.waitForFunction(() => window.game && window.game.world.find('player'), null, { timeout: 30000 });
  await page.evaluate(() => localStorage.clear());
  const out = await page.evaluate(async () => {
    game.stop();
    combat.reseed(11);
    const player = game.world.find('player');
    const comp = (e, n) => e.getAll().find((c) => c.constructor.name === n);
    const C = comp(player, 'PlayerController');
    const F = comp(player, 'Combatant');
    const IA = comp(player, 'PlayerInteractor');
    const S = game.state;
    const T = player.object3d.position.constructor;
    let elapsed = 0;
    const frame = () => { elapsed += 1 / 60; const t = { delta: 1 / 60, elapsed, alpha: 1 }; game.world.update(t); game.getSystem('hud').update(t); };
    const step = (n) => { for (let i = 0; i < n; i++) { game.fixedStep(1 / 60); frame(); } };
    const key = (c, n = 1) => { window.dispatchEvent(new KeyboardEvent('keydown', { code: c })); step(n); window.dispatchEvent(new KeyboardEvent('keyup', { code: c })); step(1); };
    game.input._locked = true;
    const mdown = (b = 0) => document.dispatchEvent(new MouseEvent('mousedown', { button: b }));
    const mup = (b = 0) => document.dispatchEvent(new MouseEvent('mouseup', { button: b }));
    const click = (after = 40) => { mdown(); step(1); mup(); step(after); };
    const tp = (x, y, z, yaw = 0) => { C.placeAt(new T(x, y, z), yaw, 0); step(20); };
    const aim = (x, y, z) => {
      for (let k = 0; k < 3; k++) {
        const cam = game.renderer.camera.getWorldPosition(new T());
        const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
        C.yaw = Math.atan2(-dx, -dz);
        C.pitch = Math.atan2(dy, Math.hypot(dx, dz));
        frame();
      }
    };
    const r = [];
    const check = (label, ok, extra = '') => r.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
    const hits = [];
    game.events.on('combat:hit', (e) => e.hit.delivery !== 'status' && hits.push({ t: e.target.name, zone: e.hit.zone, dmg: Math.round(e.result.damage * 10) / 10, src: e.hit.source, type: e.hit.packets[0]?.type }));
    const notes = [];
    game.events.on('notify', (n) => notes.push(n.text));
    const pickups = () => game.world.findByTag('pickup');
    const pickupOf = (item) => pickups().find((e) => comp(e, 'ItemPickup').spec.item === item);
    const take = (item) => {
      const e = pickupOf(item); const p = e.object3d.position;
      tp(p.x - 1, 0.05, p.z, -Math.PI / 2); aim(p.x, p.y + 0.03, p.z); key('KeyE');
    };
    const dHP = (id) => comp(game.world.find(id), 'Damageable');
    const at = (id) => game.world.find(id).object3d.position;

    // 1. Weapons are instances, and the first one is drawn.
    take('longsword');
    const sw = S.instancesOf('longsword');
    check('longsword picked up as an instance', sw.length === 1 && S.itemCount('longsword') === 1 && /^longsword#/.test(sw[0].uid));
    step(30);
    check('first weapon is drawn automatically', F.itemId === 'longsword' && F.state === 'idle' && document.querySelector('.weapon .wname').textContent === 'Longsword');

    // 2. Sword combo: three clicks, three different swings.
    const d1 = at('dummy-1');
    tp(d1.x, 0.05, d1.z - 1.3, Math.PI); aim(d1.x, 1.15, d1.z);
    const steps = [];
    game.events.on('combat:attack', () => steps.push(F.step));
    const h0 = hits.length;
    click(30); click(30); click(70);
    const swings = hits.slice(h0);
    check('combo: three swings in a row', steps.slice(-3).join(',') === 'slash_r,slash_l,thrust', steps.slice(-3).join(','));
    check('each swing hits once, as slash', swings.length === 3 && swings.every((h) => h.t === 'dummy-1' && h.type === 'slash'), JSON.stringify(swings));
    check('three swings deal 72+ (arms first take x0.6)', swings.reduce((a, h) => a + h.dmg, 0) >= 72, String(swings.reduce((a, h) => a + h.dmg, 0)));
    step(60 * 5);

    // 3. Heavy: hold for a charged overhead.
    if (dHP('dummy-1').dead) step(60 * 5);
    dHP('dummy-1').revive();
    tp(d1.x, 0.05, d1.z - 1.3, Math.PI); aim(d1.x, 1.15, d1.z);
    const h1 = hits.length;
    mdown(); step(70); const charged = F.state === 'charging' && F.charge > 0.6; step(10); mup(); step(60);
    const heavy = hits[h1];
    check('holding charges a heavy swing', charged);
    check('full heavy overhead does 88 (55 x 1.6) or more', heavy && heavy.dmg >= 88, JSON.stringify(heavy));
    step(60 * 5);

    // 4. Pistol and ammo; slot keys.
    take('pistol');
    take('pistol_rounds'); take('pistol_rounds');
    check('rounds are a plain stack', S.itemCount('pistol_rounds') === 32 && S.instancesOf('pistol_rounds').length === 0);
    check('still holding the sword after picking up a second weapon', F.itemId === 'longsword');
    key('Digit2'); step(30);
    check('2 draws the pistol, loaded with 8', F.itemId === 'pistol' && F.loaded() === 8 && F.reserve() === 32);
    key('Digit2'); step(30);
    check('2 again puts it away (fists)', F.itemId === null);
    key('Digit2'); step(30);

    // 5. Shooting at the range, aimed.
    const line = game.world.find('yard-firing-line').object3d.position;
    const t10 = at('range-10');
    tp(line.x, 0.05, line.z, Math.PI / 2);
    aim(t10.x, 1.12, t10.z);
    mdown(2); step(20);
    check('right mouse aims: zoom and tighter spread', F.aiming && C.fovScale < 1 && F.spreadDeg() < 1, `spread=${F.spreadDeg().toFixed(2)}`);
    const pitch0 = C.pitch; const h2 = hits.length;
    click(30);
    check('aimed shot hits the 10 m dummy for 34', hits[h2] && hits[h2].t === 'range-10' && hits[h2].dmg === 34 && hits[h2].type === 'ballistic', JSON.stringify(hits[h2]));
    check('recoil kicks the view up', C.pitch > pitch0 + 0.01, `${(C.pitch - pitch0).toFixed(3)} rad`);
    check('one round used', F.loaded() === 7);
    const t20 = at('range-20');
    aim(t20.x, 1.62, t20.z);
    const h3 = hits.length; click(30);
    check('head shot at 20 m: 68', hits[h3] && hits[h3].t === 'range-20' && hits[h3].zone === 'head' && hits[h3].dmg === 68, JSON.stringify(hits[h3]));
    mup(2); step(10);

    // 6. Empty the magazine: it reloads itself, from the reserve.
    aim(t10.x, 1.12, t10.z);
    for (let i = 0; i < 6; i++) click(12);
    check('six more shots, magazine empty', F.loaded() === 0, String(F.loaded()));
    step(2);
    check('empty: reload starts by itself', F.state === 'reloading', F.state);
    step(Math.ceil(1.8 * 60) + 5);
    check('full reload: 8 in, 24 left', F.loaded() === 8 && F.reserve() === 24, `${F.loaded()} / ${F.reserve()}`);
    click(12); click(12); click(12);
    key('KeyR');
    check('R with rounds left: shorter tactical reload', F.state === 'reloading' && Math.abs(F.progress) < 0.1);
    step(Math.ceil(1.4 * 60) + 5);
    check('tactical reload tops up to 8, 21 left', F.loaded() === 8 && F.reserve() === 21, `${F.loaded()} / ${F.reserve()}`);
    const hudAmmo = document.querySelector('.weapon .ammo').textContent;
    check('HUD shows loaded / carried', hudAmmo === '8 / 21', hudAmmo);

    // 7. Drop the pistol with 5 loaded: it keeps them.
    click(12); click(12); click(30);
    const uid = F.equipped;
    tp(line.x + 1, 0.05, line.z, Math.PI);
    inventory.open(); inventory.drop('pistol', uid); inventory.close(true); step(5);
    const dropped = pickupOf('pistol');
    check('dropped pistol keeps its 5 rounds', dropped && comp(dropped, 'ItemPickup').spec.data.loaded === 5 && S.itemCount('pistol') === 0);
    step(5);
    check('dropping the drawn weapon leaves you bare-handed', F.equipped === null);
    const p = dropped.object3d.position;
    tp(p.x, 0.05, p.z + 1, 0); aim(p.x, p.y + 0.03, p.z); key('KeyE');
    const back = S.instancesOf('pistol')[0];
    check('picked back up, still 5 loaded', back && back.data.loaded === 5);

    // 8. Save v2 round trip, then a v1 save migrates.
    F.equip(back.uid); step(30);
    saves.save(false);
    const raw = JSON.parse(localStorage.getItem('owrpg.save.v1'));
    check('save format v2 with instances', raw.version === 2 && raw.state.instances.length === 2);
    F.equip(null); S.setInstanceData(back.uid, 'loaded', 0); step(30);
    saves.load(); step(30);
    check('load restores the drawn weapon and its rounds', F.equipped === back.uid && F.loaded() === 5);
    const v1 = { ...raw, version: 1, state: { flags: raw.state.flags, vars: {}, items: { longsword: 1, apple: 2 } }, machines: {} };
    localStorage.setItem('owrpg.save.v1', JSON.stringify(v1));
    saves.load(); step(5);
    check('v1 save: counted weapons become instances', S.instancesOf('longsword').length === 1 && S.itemCount('apple') === 2 && S.instancesOf('pistol').length === 0);

    // 9. Validation catches bad weapon data.
    const { validateItems } = await import(window.__engineSrc + '/inventory/validate.ts');
    const bad = { blaster: { name: 'B', description: 'd', category: 'weapon', model: 'pistol', weapon: { modes: { primary: { trigger: { kind: 'press' }, delivery: { kind: 'laser' }, payload: { damage: [{ type: 'zap', amount: 5 }] } } } } } };
    let msg = '';
    try { validateItems(bad); } catch (e) { msg = e.message; }
    check('validator names unknown delivery and damage type', /unknown delivery "laser"/.test(msg) && /unknown type "zap"/.test(msg), msg.split('\n').slice(1, 3).join(' | '));
    return r;
  });
  console.log(out.join('\n'));
  const fails = out.filter((l) => l.startsWith('FAIL')).length;
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
