// Combat phase 6 check: feel. Hit-stop, view shake, particles, sounds (counted, since a
// headless browser has no audio), viewmodel sway, the hit direction marker. None of it may
// change the simulation. Start `npm run dev` first, then: node scripts/feel-check.cjs
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
  page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
  await page.goto(process.env.URL || 'http://localhost:5173/');
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




    const feel = comp(player, 'CombatFeel');
    const fx = game.getSystem('combat-fx');
    const audio = game.getSystem('combat-audio');
    const VM = comp(player, 'FistViewmodel');
    const HP = comp(player, 'Damageable');
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));

    // 1. A sword blow that lands: hit-stop, straw from the dummy, a swing and a hit sound.
    take('longsword'); step(30);
    const d1 = at('dummy-1');
    tp(d1.x, 0.05, d1.z - 1.3, Math.PI); aim(d1.x, 1.15, d1.z);
    const sw0 = audio.played.swing ?? 0, st0 = audio.played.straw ?? 0;
    let stopped = false;
    mdown(); step(1); mup(); for (let k = 0; k < 40; k++) { step(1); if (game.timeScale < 1) stopped = true; }
    check('a landed blow freezes time for a moment (hit-stop)', stopped);
    await wait(150); frame();
    check('...and lets go again', game.timeScale === 1);
    check('swing and hit sounds', (audio.played.swing ?? 0) > sw0 && (audio.played.straw ?? 0) > st0, JSON.stringify(audio.played));
    check('straw flies from a dummy', fx.live > 0, String(fx.live));
    // (This check's frame() doesn't run systems, so age the particles by hand.)
    for (let k = 0; k < 30; k++) fx.update({ delta: 0.1, elapsed, alpha: 1 });
    check('particles fade away', fx.live === 0, String(fx.live));

    // 2. A grenade nearby shakes the view; one far away doesn't.
    feel.trauma = 0;
    game.events.emit('combat:explosion', { point: { x: player.object3d.position.x + 60, y: 0, z: player.object3d.position.z }, radius: 6 });
    check('a blast 60 m off: no shake', feel.trauma === 0);
    game.events.emit('combat:explosion', { point: { x: player.object3d.position.x + 5, y: 0, z: player.object3d.position.z }, radius: 6 });
    check('a blast 5 m off: a big shake', feel.trauma > 0.6, feel.trauma.toFixed(2));
    const camQ = game.renderer.camera.quaternion.clone();
    frame();
    check('the camera actually shakes', game.renderer.camera.quaternion.angleTo(camQ) > 1e-4);
    step(60 * 2);
    check('shake dies down in a second or so', feel.trauma === 0);

    // 3. Pistol: a kick, part of which settles back by itself; smoke; a shot sound.
    take('pistol'); F.equip(S.instancesOf('pistol')[0].uid); step(40);
    tp(32, 0.05, 39, Math.PI / 2);
    const p0 = C.pitch;
    const ps0 = audio.played.pistol ?? 0;
    click(3);
    const peak = C.pitch;
    step(40);
    check('recoil kicks the view up', peak - p0 > 0.5 * Math.PI / 180, ((peak - p0) * 180 / Math.PI).toFixed(2));
    check('...and part of it settles back', C.pitch < peak - 0.0005 && C.pitch > p0, `${((C.pitch - p0) * 180 / Math.PI).toFixed(2)} deg left`);
    check('gunshot sound and smoke', (audio.played.pistol ?? 0) > ps0 && fx.live > 0);

    // 4. Weapon sway: turning quickly drags the gun, and it springs back.
    for (let k = 0; k < 6; k++) { C.yaw += 0.08; frame(); }
    const swayed = Math.abs(VM.sway.x);
    for (let k = 0; k < 60; k++) frame();
    check('the weapon lags as you turn', swayed > 0.005, swayed.toFixed(3));
    check('...and settles back', Math.abs(VM.sway.x) < 0.002, VM.sway.x.toFixed(4));

    // 5. A blow from the side: a marker shows where it came from.
    const d2 = game.world.find('dummy-2');
    HP.applyHit({ attacker: d2, packets: [{ type: 'slash', amount: 10 }], zone: 'torso', source: 'test', delivery: 'sweep' });
    frame();
    const mk = document.querySelector('.dmg-dir');
    check('hit direction marker appears', !!mk && mk.style.transform.startsWith('rotate('), mk && mk.style.transform);
    step(100);
    check('...and fades', !document.querySelector('.dmg-dir'));
    HP.revive();

    // 6. Bandit flashes when hit.
    const b = game.world.find('bandit-sword');
    const rig = comp(b, 'NpcRig');
    comp(b, 'Damageable').applyHit({ attacker: player, packets: [{ type: 'slash', amount: 10 }], zone: 'torso', source: 'test', delivery: 'sweep', point: b.object3d.position.clone().setY(1.2) });
    frame();
    check('an enemy flashes when hit', rig.mats.some((m) => m.emissiveIntensity > 0.1));
    for (let k = 0; k < 30; k++) frame();
    check('...briefly', rig.mats.every((m) => m.emissiveIntensity < 0.01));
    return r;
  });
  console.log(out.join('\n'));
  const fails = out.filter((l) => l.startsWith('FAIL')).length;
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
