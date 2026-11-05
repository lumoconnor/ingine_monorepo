// Combat phase 1 regression check: hit zones, resistances, dummies, fire, falls,
// death and respawn, healing, saves. Start `npm run dev` first, then: node scripts/combat-check.cjs
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
  page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
  await page.goto(process.env.URL || 'http://localhost:5173/');
  await page.waitForFunction(() => window.game && window.game.world.find('player'), null, { timeout: 30000 });
  await page.evaluate(() => localStorage.clear());
  const out = await page.evaluate(() => {
    game.stop();
    combat.reseed(7);
    const player = game.world.find('player');
    const comp = (e, n) => e.getAll().find((c) => c.constructor.name === n);
    const C = comp(player, 'PlayerController');
    const HP = comp(player, 'Damageable');
    const IA = comp(player, 'PlayerInteractor');
    const S = game.state;
    const T = player.object3d.position.constructor;
    let elapsed = 0;
    const frame = () => { elapsed += 1 / 60; const t = { delta: 1 / 60, elapsed, alpha: 1 }; game.world.update(t); game.getSystem('hud').update(t); };
    const step = (n) => { for (let i = 0; i < n; i++) { game.fixedStep(1 / 60); frame(); } };
    const down = (c) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c }));
    const up = (c) => window.dispatchEvent(new KeyboardEvent('keyup', { code: c }));
    const press = (c) => { down(c); step(1); up(c); step(1); };
    game.input._locked = true; // mouse buttons only count while playing
    const click = () => { document.dispatchEvent(new MouseEvent('mousedown', { button: 0 })); step(1); document.dispatchEvent(new MouseEvent('mouseup', { button: 0 })); step(30); };
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
    game.events.on('combat:hit', (e) => e.hit.delivery !== 'status' && hits.push({ target: e.target.name, zone: e.hit.zone, dmg: e.result.damage, source: e.hit.source }));
    const lastHit = () => hits[hits.length - 1] || {};
    const dummy = (id) => game.world.find(id);
    const dHP = (id) => comp(dummy(id), 'Damageable');
    const at = (id) => dummy(id).object3d.position;

    // 0. Nothing else overlaps the yard.
    const R = game.physics.world;
    const names = new Set();
    R.collidersWithAabbIntersectingAabb({ x: 38, y: 1.5, z: 34 }, { x: 7, y: 1.4, z: 6 }, (c) => { names.add(game.physics.ownerOf(c)?.name ?? '?'); return true; });
    const foreign = [...names].filter((n) => !/^(dummy|range-|yard-|terrain|player|pickup:|\?)/.test(n));
    check('training yard is clear of other things', foreign.length === 0, foreign.join(','));

    // 1. Zones: torso, head, limbs.
    const d1 = at('dummy-1');
    tp(d1.x, 0.05, d1.z - 1.1, Math.PI);
    aim(d1.x, 1.12, d1.z);
    click();
    check('punch torso: 15', lastHit().target === 'dummy-1' && lastHit().zone === 'torso' && dHP('dummy-1').health === 85, JSON.stringify(lastHit()));
    aim(d1.x, 1.64, d1.z);
    click();
    check('punch head: x2 = 30', lastHit().zone === 'head' && dHP('dummy-1').health === 55, JSON.stringify(lastHit()));
    aim(d1.x + 0.42, 1.38, d1.z);
    click();
    check('punch arm: x0.6 = 9', lastHit().zone === 'limbs' && Math.abs(dHP('dummy-1').health - 46) < 1e-6, JSON.stringify(lastHit()));

    // 2. Clicks during a punch queue one more punch (not more).
    const n0 = hits.length;
    aim(d1.x, 1.12, d1.z);
    document.dispatchEvent(new MouseEvent('mousedown', { button: 0 })); step(3); document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    step(2);
    document.dispatchEvent(new MouseEvent('mousedown', { button: 0 })); step(1); document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    step(3);
    document.dispatchEvent(new MouseEvent('mousedown', { button: 0 })); step(1); document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    step(60);
    check('clicks during a punch queue exactly one more', hits.length === n0 + 2, `hits=${hits.length - n0}`);

    // 3. Knock it down; it gets back up.
    aim(d1.x, 1.64, d1.z);
    for (let i = 0; i < 3 && !dHP('dummy-1').dead; i++) click();
    check('dummy goes down, kill flag set', dHP('dummy-1').dead && S.hasFlag('killed.dummy-1'));
    const before = hits.length; click();
    check('a downed dummy takes no hits', hits.length === before);
    step(60 * 4);
    check('stands back up at full health', !dHP('dummy-1').dead && dHP('dummy-1').health === 100);

    // 4. Armour.
    const da = at('dummy-armoured');
    tp(da.x, 0.05, da.z - 1.1, Math.PI);
    aim(da.x, 1.12, da.z);
    click();
    check('armoured dummy: blunt 60% resisted = 6', Math.abs(dHP('dummy-armoured').health - 94) < 1e-6, String(dHP('dummy-armoured').health));

    // 5. Out of reach, and missing.
    tp(da.x, 0.05, da.z - 2.6, Math.PI);
    aim(da.x, 1.12, da.z);
    const h2 = hits.length; click();
    check('out of reach: no hit', hits.length === h2);
    tp(d1.x, 0.05, d1.z - 1.1, Math.PI); aim(d1.x + 1.5, 1.2, d1.z);
    const h3 = hits.length; click();
    check('swing at air: no hit', hits.length === h3);

    // 5b. Something in front blocks: a hitscan at dummy-2 through dummy-1 stops at dummy-1.
    const d2 = at('dummy-2');
    const o = new T(d1.x - 1.5, 1.12, d1.z), dir = new T(d2.x - o.x, 0, d2.z - o.z);
    const tr = combat.trace(o, dir, 10);
    check('nearer target blocks the one behind it', tr && tr.entity.name === 'dummy-1', tr && tr.entity.name);
    const tr2 = combat.trace(new T(d1.x, 0.3, d1.z - 3), new T(0, -1, 0.2), 5);
    check('the ground stops a trace', tr2 && !tr2.target, tr2 && tr2.entity && tr2.entity.name);

    // 6. Fire pit.
    const fire = game.world.find('fire pit').object3d.position;
    tp(fire.x - 3, 0.05, fire.z);
    HP.health = 100;
    C.placeAt(new T(fire.x, 0.05, fire.z), 0, 0);
    step(60);
    const burnt = 100 - HP.health;
    check('fire pit burns about 25/s (and sets you alight)', burnt >= 25 && burnt <= 40 && HP.hasStatus('burning'), burnt.toFixed(1));
    tp(fire.x - 3, 0.05, fire.z);
    const hp0 = HP.health; step(60 * 3);
    const after = hp0 - HP.health;
    check('out of the fire: you burn on for a moment, then it goes out', after > 8 && after < 25 && !HP.hasStatus('burning'), after.toFixed(1));
    const hp1 = HP.health; step(60);
    check('then no more damage, no regen', HP.health === hp1);

    // 7. Falls.
    HP.health = 100;
    tp(38, 3.2, 28); step(90);
    check('3 m drop: no damage', HP.health === 100, String(HP.health));
    C.placeAt(new T(38, 12.05, 28), 0, 0); step(150);
    const fallDmg = 100 - HP.health;
    check('12 m drop hurts badly (about 67)', fallDmg > 55 && fallDmg < 80 && lastHit().source === 'fall', fallDmg.toFixed(1));

    // 8. Death and respawn.
    HP.health = 5;
    tp(fire.x, 0.05, fire.z);
    step(2);
    const deathEl = document.querySelector('.death');
    check('dies in the fire', HP.dead && game.input.gameplayBlocked && !deathEl.classList.contains('hidden') && /fire pit/.test(deathEl.textContent));
    step(60 * 3);
    const f = C.feetPosition;
    check('wakes up at spawn with full health', !HP.dead && HP.health === 100 && Math.hypot(f.x - 0, f.z - 8) < 0.5 && !game.input.gameplayBlocked && deathEl.classList.contains('hidden'), `${f.x.toFixed(1)},${f.z.toFixed(1)}`);

    // 9. Healing draughts on the yard table.
    HP.health = 30;
    const draught = game.world.findByTag('pickup').find((e) => comp(e, 'ItemPickup').spec.item === 'healing_draught').object3d.position;
    tp(draught.x, 0.05, draught.z - 1, Math.PI);
    aim(draught.x, draught.y + 0.04, draught.z);
    const prompt = IA.target ? IA.target.prompt : null;
    press('KeyE');
    check('pick up a healing draught', S.itemCount('healing_draught') === 1, `prompt=${prompt}`);
    inventory.use('healing_draught');
    check('drinking it heals 50', HP.health === 80 && S.itemCount('healing_draught') === 0, String(HP.health));
    S.addItem('apple'); inventory.use('apple');
    check('apples heal 5', HP.health === 85);

    // 10. Save / load keeps health.
    HP.health = 42;
    saves.save(false);
    HP.health = 100;
    saves.load();
    check('save/load keeps health', HP.health === 42, String(HP.health));
    return r;
  });
  console.log(out.join('\n'));
  const fails = out.filter((l) => l.startsWith('FAIL')).length;
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
