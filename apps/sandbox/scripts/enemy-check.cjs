// Combat phase 5 check: the bandit camp. Sight, stealth, hearing and shouts, a sword
// bandit that closes, swings and can be parried, a marksman who aims, fires and reloads,
// loot, and saves. Start `npm run dev` first, then: node scripts/enemy-check.cjs
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




    try {
    const HP = comp(player, 'Damageable');
    const sw = game.world.find('bandit-sword');
    const mk = game.world.find('bandit-musket');
    const B = (e) => comp(e, 'EnemyBrain');
    const P = (e) => comp(e, 'Perception');
    const Fi = (e) => comp(e, 'Combatant');
    const D = (e) => comp(e, 'Damageable');
    const swHome = sw.object3d.position.clone();
    const events = [];
    for (const k of ['combat:fired', 'combat:reload', 'combat:parried', 'combat:attack', 'combat:staggered', 'ai:alert']) {
      game.events.on(k, (e) => events.push({ k, who: (e.attacker ?? e.entity ?? e.from ?? e.defender)?.name, step: e.step, attacker: e.attacker?.name, t: elapsed }));
    }
    const playerHits = [];
    game.events.on('combat:hit', (e) => e.target === player && e.hit.delivery !== 'status' && playerHits.push({ src: e.hit.source, by: e.hit.attacker?.name, dmg: e.result.damage, tags: e.result.tags, zone: e.hit.zone }));
    const keepAlive = () => { if (HP.health < 40 || HP.dead) { HP.revive(); } HP.statuses.clear(); };
    const run = (secs, each) => { for (let k = 0; k < secs * 60; k++) { step(1); keepAlive(); if (each && each()) return true; } return false; };
    const flatDist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

    // 1. Out of sight and far away: they stand their posts.
    step(60);
    check('bandits start unaware, standing guard', !P(sw).target && !P(mk).target && B(sw).activity === 'idle' && B(mk).activity === 'idle', `${B(sw).activity} ${B(mk).activity}`);
    check('their weapons are drawn and the musket is loaded', Fi(sw).itemId === 'longsword' && Fi(mk).itemId === 'musket' && Fi(mk).loaded() === 1, `${Fi(sw).itemId} ${Fi(mk).itemId} ${Fi(mk).loaded()}`);

    // 2. Crouched, behind the sword bandit: it doesn't notice.
    const s0 = sw.object3d.position;
    C.placeAt(new T(s0.x, s0.y + 0.1, s0.z + 5), Math.PI, 0); step(2);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC' }));
    const sneaky = !run(2, () => P(sw).target);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyC' }));
    check('crouched behind it at 5 m: unseen', sneaky && !P(sw).target, `aw=${P(sw).awareness.toFixed(2)}`);

    // 3. In front, standing, 14 m away: it spots you and shouts to its friend.
    C.placeAt(new T(s0.x, s0.y + 0.1, s0.z - 14), 0, 0); step(2);
    const tSpot = elapsed;
    run(4, () => P(sw).target === player);
    check('in plain view at 14 m: spotted within ~2 s', P(sw).target === player && elapsed - tSpot < 2.5, (elapsed - tSpot).toFixed(2));
    step(2);
    check('...and the marksman is told', P(mk).target === player && events.some((e) => e.k === 'ai:alert' && e.who === 'bandit-sword'));

    // 4. It comes for you and swings; the marksman shoots, then reloads.
    const sh0 = playerHits.length;
    run(10, () => playerHits.slice(sh0).some((h) => h.by === 'bandit-sword'));
    const cut = playerHits.slice(sh0).find((h) => h.by === 'bandit-sword');
    check('the sword bandit closes in and cuts you', !!cut && cut.src === 'longsword', JSON.stringify(playerHits.slice(sh0, sh0 + 3)));
    run(8, () => events.some((e) => e.k === 'combat:fired' && e.who === 'bandit-musket'));
    check('the marksman fires', events.some((e) => e.k === 'combat:fired' && e.who === 'bandit-musket'));
    run(4, () => events.some((e) => e.k === 'combat:reload' && e.who === 'bandit-musket'));
    const steps = events.filter((e) => e.k === 'combat:reload' && e.who === 'bandit-musket').map((e) => e.step);
    run(5);
    const steps2 = events.filter((e) => e.k === 'combat:reload' && e.who === 'bandit-musket').map((e) => e.step);
    check('...and reloads step by step', steps2.length >= 3 && steps2[0] === 'Half-cock', steps2.join(' > '));
    check('it never targets its friend', P(sw).target === player && P(mk).target === player);

    // 5. Parry its swing: guard just before the blow lands.
    keepAlive();
    const sp = sw.object3d.position;
    let parried = false;
    for (let tries = 0; tries < 6 && !parried; tries++) {
      // Wait for the start of a swing, then raise the guard as it comes down.
      let started = false;
      run(6, () => { const f = Fi(sw); if (f.state === 'windup') { started = true; return true; } return false; });
      if (!started) continue;
      aim(sp.x, 1.4, sp.z);
      while (Fi(sw).state === 'windup' && Fi(sw).progress < 0.72) step(1);
      mdown(2); step(14); mup(2);
      parried = events.some((e) => e.k === 'combat:parried' && e.attacker === 'bandit-sword');
      step(40);
    }
    check('a well-timed guard parries the bandit', parried);
    check('...which staggers it', events.some((e) => e.k === 'combat:staggered' && e.who === 'bandit-sword'));

    // 6. Kill it: it drops its sword, coins and cap where it falls.
    const before = pickups().length;
    D(sw).applyHit({ attacker: player, packets: [{ type: 'slash', amount: 500 }], zone: 'torso', source: 'test', delivery: 'sweep' });
    step(30);
    const loot = pickups().slice(before).map((e) => comp(e, 'ItemPickup').spec);
    check('dead: it lies there, and its kit drops', B(sw).activity === 'dead' && ['longsword', 'gold', 'leather_cap'].every((i) => loot.some((l) => l.item === i)), loot.map((l) => l.item).join(','));
    check('the body no longer blocks the way', comp(sw, 'RigidBodyComponent').colliders[0].isSensor());
    check('kill flag set', S.hasFlag('killed.bandit-sword'));

    // 7. Save and load: it stays dead and doesn't drop twice.
    saves.save(false);
    saves.load(); step(10);
    const loot2 = pickups().filter((e) => comp(e, 'ItemPickup').spec.item === 'longsword');
    check('after loading: still dead, loot once', D(sw).dead && B(sw).activity === 'dead' && loot2.length === 2, `${D(sw).dead} ${B(sw).activity} swords=${loot2.length}`);

    // 8. Lose the marksman: out of sight long enough, it gives up and goes home.
    P(mk).know(player, player.object3d.position.clone(), true);
    C.placeAt(new T(-20, 0.5, -30), 0, 0);
    run(25, () => !P(mk).target);
    check('out of sight for a while: it loses you', !P(mk).target);
    run(45, () => B(mk).activity === 'idle' && flatDist(mk.object3d.position, B(mk).home) < 3);
    check('...and goes back to its post', flatDist(mk.object3d.position, B(mk).home) < 3, flatDist(mk.object3d.position, B(mk).home).toFixed(1));

    // 9. A pistol shot nearby brings it to look.
    // The table's sword can be in the way of the first try.
    take('pistol'); if (!S.instancesOf('pistol').length) take('pistol');
    F.equip(S.instancesOf('pistol')[0].uid); step(30);
    const hm = B(mk).home;
    C.placeAt(new T(hm.x + 22, 0.5, hm.z + 22), 0, 0); step(5);
    aim(hm.x + 22, 5, hm.z + 40); click(10);
    run(3);
    check('it hears a shot 30 m off and comes to look', B(mk).activity === 'investigate' || !!P(mk).target, `${B(mk).activity} noise=${!!P(mk).noise}`);

    // 10. Kill the marksman and take its musket: a flintlock reload, step by step.
    D(mk).applyHit({ attacker: player, packets: [{ type: 'ballistic', amount: 500 }], zone: 'torso', source: 'test', delivery: 'hitscan' });
    step(20);
    take('musket');
    const musket = S.instancesOf('musket')[0];
    check('you can take its musket', !!musket);
    if (S.itemCount('musket_cartridges') === 0) take('musket_cartridges');
    F.equip(musket.uid); step(30);
    if (F.loaded() > 0) { click(40); }
    key('KeyR', 2);
    const names = [];
    run(6, () => { if (F.reloadStep && names[names.length - 1] !== F.reloadStep) names.push(F.reloadStep); return F.state === 'idle' && F.loaded() === 1; });
    check('reloading a musket: five steps, about 4 s', names.join(' > ') === 'Half-cock > Prime the pan > Powder and ball > Ram it home > Full cock' && F.loaded() === 1, names.join(' > '));
    } catch (e) { r.push('FAIL  exception: ' + e.message + ' ' + e.stack.split('\n')[1]); }
    return r;
  });
  console.log(out.join('\n'));
  const fails = out.filter((l) => l.startsWith('FAIL')).length;
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
