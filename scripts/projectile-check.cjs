// Combat phase 3 check: the longbow (load, charge, arrows that fly, drop and stick),
// pulling arrows back out, grenades (stack, throw, bounce, fuse, blast falloff, cover,
// cooking in hand). Start `npm run dev` first, then: node scripts/projectile-check.cjs
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


    const flyAll = (max = 600) => { let n = 0; while (combat.inFlight.length && n < max) { step(1); n++; } return n; };
    const booms = [];
    game.events.on('combat:explosion', (e) => booms.push({ ...e.point, t: elapsed }));

    // 1. Pick up the bow, arrows and grenades.
    take('longbow'); take('arrows'); take('grenade');
    step(30);
    check('longbow drawn, 12 arrows, 3 grenades', F.itemId === 'longbow' && S.itemCount('arrows') === 12 && S.itemCount('grenade') === 3, `${F.itemId} ${S.itemCount('arrows')} ${S.itemCount('grenade')}`);
    const slots = comp(player, 'PlayerCombat').weaponSlots();
    check('grenades take a slot as a stack', slots.length === 2 && slots[1] === 'stack:grenade', slots.join(','));

    // 2. Nock an arrow, draw, loose at the 10 m dummy.
    const line = { x: 32, z: 39 };
    const r10 = at('range-10');
    tp(line.x, 0.05, r10.z, Math.PI / 2); aim(r10.x, 1.2, r10.z);
    click(5);
    check('a bow you find is unstrung: first click nocks an arrow', F.state === 'reloading' && F.loaded() === 0, F.state);
    step(40);
    check('nocked: 1 loaded, 11 in the quiver', F.loaded() === 1 && S.itemCount('arrows') === 11, `${F.loaded()} / ${S.itemCount('arrows')}`);
    aim(r10.x, 1.2, r10.z);
    const h0 = hits.length;
    mdown(); step(75); const drawn = F.state === 'charging' && F.charge > 0.95; mup(); step(1);
    check('holding draws the bow fully', drawn);
    check('the arrow is in flight', combat.inFlight.length === 1);
    flyAll();
    const full = hits.slice(h0).find((h) => h.t === 'range-10');
    check('full draw hits the 10 m dummy as pierce', !!full && full.type === 'pierce', JSON.stringify(hits.slice(h0)));
    check('full draw is a heavy hit (30+)', full && full.dmg >= 30, full && String(full.dmg));
    check('arrow stays in the dummy', !game.world.findByTag('stuck-projectile').length);

    // 3. A weak draw does less.
    step(60 * 5);
    dHP('range-10').revive();
    aim(r10.x, 1.2, r10.z);
    if (F.loaded() < 1) click(40); // nock (a loaded bow would loose on a tap)
    aim(r10.x, 1.4, r10.z);
    const h1 = hits.length;
    mdown(); step(10); mup(); step(1);
    flyAll();
    const weak = hits.slice(h1).find((h) => h.t === 'range-10');
    check('a short draw hits for much less', !!weak && full && weak.dmg < full.dmg * 0.5, weak ? `${weak.dmg} vs ${full.dmg}` : 'missed: ' + JSON.stringify(hits.slice(h1)));

    // 3b. Holds respond like clicks: a quick tap still looses an arrow, and
    // holding through the nock goes straight into the draw.
    aim(line.x - 6, 0, line.z + 3);
    if (F.loaded() < 1) click(40);
    click(1); step(12);
    check('a quick tap looses an arrow', F.loaded() === 0, `${F.state} loaded=${F.loaded()}`);
    mdown(); step(60);
    check('holding through the nock goes straight into the draw', F.state === 'charging', F.state);
    mup(); step(1); flyAll(); step(60);
    for (const s of game.world.findByTag('stuck-projectile')) game.world.destroy(s);

    // 4. Shoot the ground: it sticks, and can be pulled out again.
    if (F.loaded() < 1) click(40);
    const count = S.itemCount('arrows');
    aim(line.x - 6, 0, line.z + 3);
    mdown(); step(40); mup(); step(1);
    flyAll();
    const stuck = game.world.findByTag('stuck-projectile');
    check('an arrow that misses sticks in the ground', stuck.length === 1, String(stuck.length));
    const sp = stuck[0].object3d.localToWorld(new T(0, 0, -0.25));
    tp(sp.x + 1.2, 0.05, sp.z, Math.PI / 2); aim(sp.x, sp.y, sp.z);
    const prompt = IA.target?.prompt ?? IA.target?.constructor?.name ?? null;
    key('KeyE');
    check('E pulls it out and back into the quiver', S.itemCount('arrows') === count + 1 && !game.world.findByTag('stuck-projectile').length, `${prompt}, ${S.itemCount('arrows')} vs ${count}`);

    // 5. Grenade: throw it, it bounces and goes off on its fuse.
    key('Digit2', 30);
    check('slot 2 draws the grenades', F.itemId === 'grenade' && F.state === 'idle', `${F.itemId} ${F.state}`);
    tp(line.x, 0.05, line.z, Math.PI / 2); aim(line.x - 8, 1.6, line.z + 6);
    const b0 = booms.length;
    mdown(); step(30); mup(); const thrownAt = elapsed; step(1);
    check('throwing uses one grenade', S.itemCount('grenade') === 2);
    const g = combat.inFlight[0];
    let bounced = false, lastVy = 0;
    for (let i = 0; i < 400 && combat.inFlight.length; i++) {
      if (g && lastVy < -0.5 && g.vel.y > 0.2) bounced = true;
      lastVy = g ? g.vel.y : 0;
      step(1);
    }
    const boom = booms[b0];
    check('it bounces off the ground', bounced);
    check('and explodes ~3.5 s after the pin', boom && Math.abs(boom.t - thrownAt - 3.5) < 0.15, boom && (boom.t - thrownAt).toFixed(2));
    check('away from the thrower', boom && Math.hypot(boom.x - line.x, boom.z - line.z) > 4, boom && Math.hypot(boom.x - line.x, boom.z - line.z).toFixed(1));
    check('player unhurt by a distant blast', comp(player, 'Damageable').health === 100);

    // 6. Falloff and cover, from a blast placed by hand.
    step(60 * 5);
    for (const id of ['dummy-1', 'dummy-2']) dHP(id).revive();
    tp(40, 0.05, 28, 0);
    const blast = (x, y, z) => {
      const before = hits.length;
      combat.deliver(Items_grenade_then(), { origin: new T(x, y, z), dir: new T(0, 1, 0), spreadDeg: 0, charge: 0, cooked: 0, attack: { attacker: player, source: 'test', packets: [{ type: 'blast', amount: 100 }], impulse: 0 } });
      step(1);
      return hits.slice(before);
    };
    function Items_grenade_then() { return { kind: 'area', radius: 6, falloff: 'linear', lineOfSight: true }; }
    const d1 = at('dummy-1'), d2 = at('dummy-2');
    const nearHit = blast(d1.x, 1.0, d1.z + 1.5).find((h) => h.t === 'dummy-1');
    dHP('dummy-1').revive(); dHP('dummy-2').revive();
    const farHit = blast(d1.x, 1.0, d1.z + 4).find((h) => h.t === 'dummy-1');
    check('blast falls off with distance', nearHit && farHit && Math.abs(nearHit.dmg - 75) < 3 && Math.abs(farHit.dmg - 33.3) < 3, `${nearHit?.dmg} / ${farHit?.dmg}`);
    dHP('dummy-1').revive(); dHP('dummy-2').revive();
    // Behind dummy-1 from the blast's point of view, dummy-2 is sheltered.
    const dx = d2.x - d1.x, dz = d2.z - d1.z, L = Math.hypot(dx, dz);
    const cover = blast(d1.x - (dx / L) * 1.2, 1.0, d1.z - (dz / L) * 1.2);
    check('something solid in between shelters you', cover.some((h) => h.t === 'dummy-1') && !cover.some((h) => h.t === 'dummy-2'), JSON.stringify(cover.map((h) => h.t)));
    const outside = blast(d1.x, 1.0, d1.z + 7);
    check('nothing past the radius', !outside.length);

    // 7. Cook it too long and it goes off in your hand.
    tp(line.x, 0.05, line.z, Math.PI / 2);
    const b1 = booms.length;
    mdown(); step(Math.ceil(3.5 * 60) + 5);
    check('held past the fuse: it goes off in hand', booms.length === b1 + 1 && S.itemCount('grenade') === 1);
    check('and that kills you', comp(player, 'Damageable').dead, String(comp(player, 'Damageable').health));
    mup(); step(60 * 3);
    check('you come to at the spawn point', !comp(player, 'Damageable').dead);

    // 8. Last grenade: once thrown, the slot goes and you're bare-handed.
    if (F.itemId !== 'grenade') key('Digit2', 30);
    const cam = game.renderer.camera.getWorldPosition(new T());
    aim(cam.x - 3, 0, cam.z);
    mdown(); step(5); mup(); step(30);
    check('last grenade thrown: none left, hands empty', S.itemCount('grenade') === 0 && F.itemId === null && comp(player, 'PlayerCombat').weaponSlots().length === 1, `${S.itemCount('grenade')} ${F.itemId} ${F.equipped}`);
    step(60 * 5);
    return r;
  });
  console.log(out.join('\n'));
  const fails = out.filter((l) => l.startsWith('FAIL')).length;
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
