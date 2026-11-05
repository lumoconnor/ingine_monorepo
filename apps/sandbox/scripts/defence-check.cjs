// Combat phase 4 check: stamina, guarding and parrying, guard breaks, armour, bleeding and
// burning (and what cures them). Start `npm run dev` first, then: node scripts/defence-check.cjs
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



    // The live class (the dev server may have reloaded the module under another URL).
    const Combatant = F.constructor;
    const Items = (await import(window.__engineSrc + '/inventory/catalog.ts')).Items;
    const steps = [];
    game.events.on('combat:attack', (e) => e.attacker === player && steps.push(1));
    const HP = comp(player, 'Damageable');
    const AR = comp(player, 'Armour');
    const results = [];
    game.events.on('combat:hit', (e) => e.target === player && results.push(e.result));
    const pp = () => player.object3d.position.clone();
    // A blow from `from` (an entity) at the player.
    const blow = (from, packets, opts = {}) => {
      const fp = from.object3d.position.clone();
      const dir = pp().sub(fp).setY(0).normalize();
      return HP.applyHit({ attacker: from, packets, zone: opts.zone ?? 'torso', source: 'test', direction: dir, delivery: opts.delivery ?? 'sweep', status: opts.status });
    };
    const d2 = game.world.find('dummy-2');
    const foe = d2.add(new Combatant({ faction: 'test' }));
    const faceFoe = () => { const p = d2.object3d.position; aim(p.x, 1.4, p.z); };
    const standBy = () => { const p = d2.object3d.position; tp(p.x, 0.05, p.z - 1.6, Math.PI); faceFoe(); };

    // 1. Stamina.
    take('longsword'); step(30);
    standBy();
    const s0 = F.stamina;
    click(30);
    check('a sword swing costs 12 stamina', Math.abs(s0 - F.stamina - 12) < 0.5, (s0 - F.stamina).toFixed(1));
    F.spendStamina(50);
    step(30);
    const sRest = F.stamina;
    step(60);
    check('it comes back after a breather', F.stamina > sRest + 10, `${sRest.toFixed(0)} -> ${F.stamina.toFixed(0)}`);
    dHP('dummy-2').revive();
    step(60 * 4);
    F.stamina = 30; F.staminaRegen = 0; step(1);
    mdown(); step(70); mup(); step(60);
    check('a charged heavy costs more (~15+)', 30 - F.stamina >= 15, (30 - F.stamina).toFixed(1));
    F.staminaRegen = 30;
    F.spendStamina(1000);
    const atk0 = steps.length;
    click(20);
    check('out of stamina: no swing, "winded"', steps.length === atk0 && notes.includes('Too winded to swing.'));
    step(60 * 5);
    check('rested back to full', F.stamina === F.maxStamina);
    dHP('dummy-2').revive();

    // 2. Guarding with the sword.
    standBy();
    mdown(2); step(20);
    check('right mouse with a sword: guard', F.state === 'blocking');
    let res = blow(d2, [{ type: 'slash', amount: 40 }]);
    check('a cut from in front: 85% stopped', res.tags.includes('blocked') && Math.abs(res.damage - 6) < 0.2, `${res.damage.toFixed(1)} ${res.tags}`);
    check('...and it costs stamina (10 + a third of it)', Math.abs(F.maxStamina - F.stamina - (10 + 34 / 3)) < 1, (F.maxStamina - F.stamina).toFixed(1));
    res = blow(d2, [{ type: 'ballistic', amount: 34 }], { delivery: 'hitscan' });
    check('a bullet goes straight through a sword guard', !res.tags.includes('blocked') && Math.abs(res.damage - 34) < 0.2, res.damage.toFixed(1));
    C.yaw += Math.PI; step(2);
    res = blow(d2, [{ type: 'slash', amount: 40 }]);
    check('from behind: not blocked', !res.tags.includes('blocked') && Math.abs(res.damage - 40) < 0.2, res.damage.toFixed(1));
    faceFoe();
    mup(2); step(2);
    check('let go: guard drops', F.state === 'idle');
    HP.revive(); F.stamina = F.maxStamina;

    // 3. Parry.
    step(40);
    mdown(2); step(4);
    check('the first moment of a guard is a parry', F.parrying);
    res = blow(d2, [{ type: 'slash', amount: 40 }]);
    check('parried: no damage, no stamina', res.damage === 0 && res.tags.includes('parried') && F.stamina === F.maxStamina, `${res.damage} ${res.tags}`);
    check('the attacker staggers', foe.state === 'staggered');
    step(20);
    res = blow(d2, [{ type: 'slash', amount: 40 }]);
    check('later in the guard: a plain block', res.tags.includes('blocked') && !res.tags.includes('parried'));
    mup(2); step(3); mdown(2); step(3);
    res = blow(d2, [{ type: 'slash', amount: 40 }]);
    check('re-raising at once is no parry (no spamming)', res.tags.includes('blocked') && !res.tags.includes('parried'), String(res.tags));
    mup(2); step(30); mdown(2); step(3);
    res = blow(d2, [{ type: 'pierce', amount: 20 }], { delivery: 'projectile' });
    check('an arrow can be blocked but never parried', res.tags.includes('blocked') && !res.tags.includes('parried'), String(res.tags));
    mup(2); step(30);

    // 4. Guard break.
    HP.revive(); F.stamina = 8;
    mdown(2); step(20);
    res = blow(d2, [{ type: 'slash', amount: 40 }]);
    check('blocking with no stamina left breaks your guard', res.tags.includes('guardbreak') && F.state === 'staggered', `${res.tags} ${F.state}`);
    const a1 = steps.length; click(5);
    check('staggered: can\'t swing', steps.length === a1);
    mup(2); step(80);
    check('steady again after a moment', F.state === 'idle');

    // 5. Fists guard too; the pistol aims instead.
    F.equip(null); step(30); HP.revive(); F.stamina = F.maxStamina;
    mdown(2); step(20);
    res = blow(d2, [{ type: 'blunt', amount: 20 }]);
    check('fists guard against punches (50%)', F.state === 'blocking' && Math.abs(res.damage - 10) < 0.2, res.damage.toFixed(1));
    mup(2); step(10);
    take('pistol'); F.equip(S.instancesOf('pistol')[0].uid); step(30); standBy();
    mdown(2); step(10);
    check('with a pistol right mouse aims, no guard', F.aiming && F.state !== 'blocking');
    mup(2); step(10);
    F.equip(S.instancesOf('longsword')[0].uid); step(30);
    // A guard comes straight up out of a swing's follow-through.
    F.stamina = F.maxStamina;
    click(0); let n = 0; while (F.state !== 'recovery' && n < 60) { step(1); n++; }
    mdown(2); step(2);
    check('guard straight out of a swing', F.state === 'blocking', F.state);
    mup(2); step(30);

    // 6. Armour.
    take('steel_helm'); take('mail_hauberk'); take('ballistic_vest');
    inventory.open();
    const wearBtn = (item) => {
      const slot = [...document.querySelectorAll('.inv-slot')].find((b) => b.title === Items[item].name);
      slot.click();
      return [...document.querySelectorAll('.inv-actions button')].find((b) => /Wear|Take off/.test(b.textContent));
    };
    wearBtn('steel_helm').click();
    wearBtn('mail_hauberk').click();
    const label = wearBtn('mail_hauberk').textContent;
    inventory.close(true); step(5);
    check('Wear from the inventory', AR.isWorn('steel_helm') && AR.isWorn('mail_hauberk') && label === 'Take off');
    HP.revive();
    res = blow(d2, [{ type: 'slash', amount: 40 }], { zone: 'head' });
    check('steel helm: a head cut 80 -> 12', Math.abs(res.damage - 12) < 0.2 && res.tags.includes('armour'), res.damage.toFixed(1));
    res = blow(d2, [{ type: 'slash', amount: 40 }], { zone: 'limbs' });
    check('mail covers the arms and legs too (24 -> 6)', Math.abs(res.damage - 6) < 0.2, res.damage.toFixed(1));
    res = blow(d2, [{ type: 'ballistic', amount: 34 }], { zone: 'torso', delivery: 'hitscan' });
    check('mail does little against a bullet (34 -> 28.9)', Math.abs(res.damage - 28.9) < 0.2, res.damage.toFixed(1));
    check('mail slows you a little', Math.abs(C.speedScale - 0.95 * 0.93) < 0.01, C.speedScale.toFixed(3));
    AR.wear('ballistic_vest'); step(2); HP.revive();
    check('one body piece at a time: the vest replaces the mail', AR.isWorn('ballistic_vest') && !AR.isWorn('mail_hauberk'));
    res = blow(d2, [{ type: 'ballistic', amount: 34 }], { zone: 'torso', delivery: 'hitscan' });
    check('the vest stops most of a pistol round (34 -> 13.6)', Math.abs(res.damage - 13.6) < 0.2, res.damage.toFixed(1));
    res = blow(d2, [{ type: 'slash', amount: 40 }], { zone: 'limbs' });
    check('...but not on the arms', Math.abs(res.damage - 24) < 0.2, res.damage.toFixed(1));
    saves.save(false);
    AR.takeOff('ballistic_vest'); AR.takeOff('steel_helm');
    saves.load(); step(5);
    check('what you wear is saved', AR.isWorn('ballistic_vest') && AR.isWorn('steel_helm'));
    inventory.open(); inventory.drop('ballistic_vest'); inventory.close(true); step(3);
    check('dropping it takes it off', !AR.isWorn('ballistic_vest'));

    // 7. Bleeding.
    AR.takeOff('steel_helm');
    HP.revive();
    res = blow(d2, [{ type: 'slash', amount: 20 }], { status: [{ id: 'bleeding', seconds: 6 }] });
    check('a cut can start bleeding', HP.hasStatus('bleeding') && res.statuses.includes('bleeding'));
    const hb = HP.health; step(60 * 2);
    check('bleeding: about 2.5 a second', Math.abs(hb - HP.health - 5) < 1.3, (hb - HP.health).toFixed(1));
    check('HUD shows it', !!document.querySelector('.health .st.bleeding'));
    blow(d2, [{ type: 'slash', amount: 5 }], { status: [{ id: 'bleeding', seconds: 6 }] });
    check('a second cut adds time (4 + 6)', Math.abs(HP.statuses.get('bleeding').remaining - 10) < 0.2, HP.statuses.get('bleeding').remaining.toFixed(1));
    S.addItem('bandage', 1);
    inventory.open(); inventory.use('bandage'); inventory.close(true); step(2);
    check('a bandage stops it', !HP.hasStatus('bleeding') && notes.includes('The bleeding stops.'));
    // Armour makes bleeding rarer: the chance scales with what got through.
    combat.reseed(5);
    let bare = 0, mailed = 0;
    for (let k = 0; k < 40; k++) { HP.revive(); blow(d2, [{ type: 'slash', amount: 10 }], { status: [{ id: 'bleeding', seconds: 1, chance: 0.8 }] }); bare += HP.hasStatus('bleeding') ? 1 : 0; }
    AR.wear('mail_hauberk');
    for (let k = 0; k < 40; k++) { HP.revive(); blow(d2, [{ type: 'slash', amount: 10 }], { status: [{ id: 'bleeding', seconds: 1, chance: 0.8 }] }); mailed += HP.hasStatus('bleeding') ? 1 : 0; }
    check('mail turns most cuts that would bleed', bare >= 25 && mailed <= bare / 2.2, `${bare}/40 bare, ${mailed}/40 in mail`);
    AR.takeOff('mail_hauberk');
    HP.revive(); HP.health = 4;
    blow(d2, [{ type: 'slash', amount: 1 }], { status: [{ id: 'bleeding', seconds: 10 }] });
    step(60 * 2);
    check('you can bleed out', HP.dead && document.querySelector('.death small').textContent === 'You bled out.');
    step(60 * 3);
    check('and come to without it', !HP.dead && !HP.hasStatus('bleeding'));

    // 8. Burning: fire arrows, and water puts you out.
    take('longbow'); take('fire_arrows');
    F.equip(S.instancesOf('longbow')[0].uid); step(30);
    const r10 = at('range-10');
    dHP('range-10').revive();
    tp(32, 0.05, r10.z, Math.PI / 2); aim(r10.x, 1.2, r10.z);
    key('KeyR', 40);
    check('no ordinary arrows: it nocks a fire arrow', F.loadedAmmo() === 'fire_arrows' && F.loaded() === 1, `${F.loadedAmmo()} ${F.loaded()}`);
    aim(r10.x, 1.2, r10.z);
    const h0 = hits.length;
    mdown(); step(75); mup(); step(1);
    for (let k = 0; k < 120 && combat.inFlight.length; k++) step(1);
    const fh = hits.slice(h0).find((h) => h.t === 'range-10');
    check('a fire arrow hits and sets the dummy alight', fh && dHP('range-10').hasStatus('burning'), JSON.stringify(hits.slice(h0)));
    const db = dHP('range-10').health; step(120);
    check('it burns (~7 a second)', db - dHP('range-10').health > 10, (db - dHP('range-10').health).toFixed(1));
    S.addItem('arrows', 3); F.cancel();
    const nx = F.cycleAmmo();
    check('T switches arrows', nx === 'arrows' || nx === 'fire_arrows', String(nx));
    HP.revive();
    HP.addStatus({ id: 'burning', seconds: 8 });
    tp(36, 4.5, 16); step(240);
    check('jump in the water: the flames go out', C.swimming && !HP.hasStatus('burning'), `swimming=${C.swimming}`);
    HP.addStatus({ id: 'burning', seconds: 8 });
    check('and you can\'t catch fire in it', !HP.hasStatus('burning'));
    return r;
  });
  console.log(out.join('\n'));
  const fails = out.filter((l) => l.startsWith('FAIL')).length;
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
