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
    const p1 = player.object3d.position.clone();
    let slowed = false, kicked = 0;
    mdown(); step(1); mup(); for (let k = 0; k < 55; k++) { step(1); if (F.paused) stopped = true; if (game.timeScale < 1) slowed = true; kicked = Math.max(kicked, feel.kick.length()); }
    check('a landed blow hangs the blade for a moment (hit-stop)', stopped);
    check('...the world itself never slows', !slowed && game.timeScale === 1);
    check('...and lets go again', !F.paused && F.state === 'idle', F.state);
    check('the view kicks along the cut', kicked > 0.004, kicked.toFixed(4));
    void p1; void wait;
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

    // 7. Responsiveness: swings start on press; presses made a moment early still count.
    HP.revive(); HP.invulnerable = true;
    tp(32, 0.05, 39, Math.PI / 2);
    F.equip(S.instancesOf('longsword')[0].uid); step(40);
    mdown(); step(1);
    check('a sword click starts its swing on press, not release', F.state === 'windup' && F.mode === 'primary', `${F.state} ${F.mode}`);
    mup(); step(200);
    const st7 = F.stamina;
    mdown(); step(14);
    check('still holding when the wind-up ends: it becomes the heavy', F.state === 'charging' && F.mode === 'heavy', `${F.state} ${F.mode}`);
    check('...and the light swing that never happened costs nothing', Math.abs(F.stamina - st7) < 0.5, (st7 - F.stamina).toFixed(1));
    mup(); step(90);
    F.equip(S.instancesOf('pistol')[0].uid); step(40);
    let shots = 0;
    game.events.on('combat:fired', () => shots++);
    mdown(); step(1); mup(); step(3);
    const inRecovery = F.state === 'recovery';
    mdown(); step(1); mup(); step(20);
    check('a click during the recovery fires as soon as it can', inRecovery && shots === 2, `${inRecovery} ${shots}`);

    // 8. Impact: a struck bandit is driven back and rocked; bullets leave a streak and a mark; walls turn a blade.
    const b2 = game.world.find('bandit-sword');
    const B = comp(b2, 'NpcBody'), BH = comp(b2, 'Damageable'), R2 = comp(b2, 'NpcRig');
    BH.revive(); step(5);
    const bp = B.position.clone();
    const away = new T(0, 0, 1).applyQuaternion(b2.object3d.quaternion).negate();
    BH.applyHit({ attacker: player, packets: [{ type: 'slash', amount: 30 }], zone: 'torso', source: 'test', delivery: 'sweep', point: bp.clone().setY(1.2), direction: away.clone() });
    const rocked = R2.flinch > 0.3;
    const shove = B.knock.clone();
    check('a struck bandit is knocked back, away from the blow', shove.length() > 1.5 && shove.clone().normalize().dot(away) > 0.9, shove.length().toFixed(2));
    step(30);
    check('...and the shove dies away', B.knock.length() < 0.2, B.knock.length().toFixed(2));
    check('...and recoils from it', rocked);
    BH.applyHit({ attacker: player, packets: [{ type: 'slash', amount: 500 }], zone: 'torso', source: 'test', delivery: 'sweep', point: B.position.clone().setY(1.2), direction: new T(1, 0, 0).applyQuaternion(b2.object3d.quaternion) });
    for (let k = 0; k < 60; k++) frame();
    const top = new T(0, 1, 0).applyQuaternion(R2.figure.quaternion);
    check('killed, it falls the way it was struck', top.x > 0.7, `${top.x.toFixed(2)} ${top.z.toFixed(2)}`);
    tp(32, 0.05, 39, Math.PI / 2);
    F.equip(S.instancesOf('pistol')[0].uid); step(40);
    C.pitch = -0.5; frame();
    const im = [];
    game.events.on('combat:impact', (e) => im.push(e));
    const cf0 = audio.played.confirm ?? 0;
    for (let k = 0; k < 30; k++) fx.update({ delta: 0.016, elapsed, alpha: 1 });
    const mk0 = fx.marksLeft;
    click(1);
    check('a bullet leaves a streak in the air', fx.tracersLive === 1, String(fx.tracersLive));
    check('...strikes the ground as dirt, and leaves a mark', im.length === 1 && im[0].surface === 'dirt' && fx.marksLeft === mk0 + 1, JSON.stringify(im[0]));
    for (let k = 0; k < 30; k++) fx.update({ delta: 0.016, elapsed, alpha: 1 });
    check('...the streak is gone in a moment', fx.tracersLive === 0);
    const d3 = at('dummy-1');
    dHP('dummy-1').revive();
    tp(d3.x, 0.05, d3.z - 6, Math.PI); aim(d3.x, 1.15, d3.z);
    click(20);
    check('your shot finding its mark is heard at your ear', (audio.played.confirm ?? 0) + (audio.played.confirm_head ?? 0) > cf0, JSON.stringify(audio.played));

    // 9. Depth: combos flow and finish hard, you step into swings, moving spoils your aim, a held bow tires you,
    //    grenades tick and clink, blasts throw you, near misses crack.
    HP.revive(); HP.invulnerable = true; step(60 * 3);
    tp(32, 0.05, 39, Math.PI / 2); C.pitch = 0;
    F.equip(S.instancesOf('longsword')[0].uid); step(40);
    const starts = [];
    let tick9 = 0;
    game.events.on('combat:swing', () => starts.push(tick9));
    const x0 = player.object3d.position.x;
    mdown(); step(1); mup(); tick9++;
    for (let k = 0; k < 120; k++) { if (k === 20 || k === 50) { mdown(); step(1); mup(); } else step(1); tick9++; }
    const gaps = [starts[1] - starts[0], starts[2] - starts[1]];
    check('a queued swing cuts the follow-through short (under 0.62 s between cuts)', starts.length === 3 && gaps.every((g) => g < 37 && g > 20), JSON.stringify(gaps));
    check('you step into your swings', Math.abs(player.object3d.position.x - x0) > 0.5, Math.abs(player.object3d.position.x - x0).toFixed(2));
    const d9 = at('dummy-1');
    dHP('dummy-1').revive();
    tp(d9.x, 0.05, d9.z - 1.9, Math.PI); aim(d9.x, 1.15, d9.z);
    const dm = [];
    game.events.on('combat:hit', (e) => e.target.name === 'dummy-1' && dm.push(e.result.damage));
    mdown(); step(1); mup();
    for (let k = 0; k < 150; k++) { if (k === 20 || k === 50) { mdown(); step(1); mup(); } else step(1); }
    check('the last swing of the combo hits hardest', dm.length === 3 && dm[2] > dm[0] * 1.2 && dm[2] > dm[1] * 1.2, JSON.stringify(dm));

    F.equip(S.instancesOf('pistol')[0].uid); step(40);
    tp(32, 0.05, 39, Math.PI / 2); step(30);
    const still = F.spreadDeg();
    game.input._locked = true;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' })); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft' }));
    step(40);
    const running = F.spreadDeg();
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ShiftLeft' }));
    step(40);
    check('running opens your spread, standing closes it again', running > still * 1.4 && Math.abs(F.spreadDeg() - still) < 0.05, `${still.toFixed(2)} -> ${running.toFixed(2)} -> ${F.spreadDeg().toFixed(2)}`);

    if (!S.instancesOf('longbow').length) { take('longbow'); take('arrows'); }
    F.equip(S.instancesOf('longbow')[0].uid); step(80);
    tp(32, 0.05, 39, Math.PI / 2); C.pitch = 0.3; step(60 * 3);
    const cr0 = audio.played.creak ?? 0, rd0 = audio.played.ready ?? 0;
    const sb = F.stamina;
    mdown(); step(60 * 3);
    check('drawing a bow creaks, and full draw is signalled', (audio.played.creak ?? 0) > cr0 && (audio.played.ready ?? 0) > rd0, JSON.stringify(audio.played));
    check('holding a full draw drains stamina', F.state === 'charging' && sb - F.stamina > 10, (sb - F.stamina).toFixed(1));
    mup(); step(30);

    const tk0 = audio.played.tick ?? 0, cl0 = audio.played.clink ?? 0;
    if (!S.itemCount('grenade')) take('grenade');
    F.equip('grenade'); step(40);
    tp(32, 0.05, 39, Math.PI / 2); C.pitch = 0.2; frame();
    HP.invulnerable = true;
    mdown(); step(50);
    const bar = document.querySelector('.weapon .wbar');
    check('a cooking grenade ticks and shows its fuse', (audio.played.tick ?? 0) > tk0 && bar.classList.contains('fuse'));
    mup(); step(60 * 4);
    check('...and clinks as it bounces', (audio.played.clink ?? 0) > cl0, JSON.stringify(audio.played));

    tp(32, 0.05, 39, Math.PI / 2); step(10);
    HP.invulnerable = false; HP.revive();
    const pb = player.object3d.position.clone();
    combat.deliver({ kind: 'area', radius: 6, falloff: 'linear', lineOfSight: false }, { origin: new T(pb.x + 2.5, 0.3, pb.z), dir: new T(0, 1, 0), spreadDeg: 0, charge: 0, cooked: 0, attack: { attacker: null, source: 'test', packets: [{ type: 'blast', amount: 40 }] } });
    frame();
    const white = Number(document.querySelector('.blast-flash').style.opacity);
    step(30);
    const thrown = player.object3d.position.x - pb.x;
    check('a blast beside you throws you away from it', thrown < -0.4, thrown.toFixed(2));
    check('...whites out the view and dulls your hearing', white > 0.1 && audio.deafened > 0.3, `${white} ${audio.deafened.toFixed(2)}`);
    HP.revive();

    const ck0 = audio.played.crack ?? 0;
    const eye = game.renderer.camera.position;
    game.events.emit('combat:tracer', { attacker: b2, from: { x: eye.x - 20, y: eye.y + 0.5, z: eye.z }, to: { x: eye.x + 20, y: eye.y + 0.5, z: eye.z } });
    game.events.emit('combat:tracer', { attacker: b2, from: { x: eye.x - 20, y: eye.y + 6, z: eye.z }, to: { x: eye.x + 20, y: eye.y + 6, z: eye.z } });
    check('a shot passing close cracks past your ear; one well wide does not', (audio.played.crack ?? 0) === ck0 + 1);

    return r;
  });
  console.log(out.join('\n'));
  const fails = out.filter((l) => l.startsWith('FAIL')).length;
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
