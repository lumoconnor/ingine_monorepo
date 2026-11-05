// Inventory + save/load regression check. Start `npm run dev` first, then: node scripts/inventory-check.cjs
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
  const url = process.env.URL || 'http://localhost:5173/';
  await page.goto(url);
  await page.waitForFunction(() => window.game && window.game.world.find('player'), null, { timeout: 30000 });
  await page.evaluate(() => localStorage.clear());
  const out = await page.evaluate(() => {
    game.stop();
    const player = game.world.find('player');
    const comp = (e, n) => e.getAll().find((c) => c.constructor.name === n);
    const RB = comp(player, 'RigidBodyComponent');
    const C = comp(player, 'PlayerController');
    const IA = comp(player, 'PlayerInteractor');
    const S = game.state;
    const T = player.object3d.position.constructor;
    let elapsed = 0;
    const frame = () => { elapsed += 1 / 60; game.world.update({ delta: 1 / 60, elapsed, alpha: 1 }); };
    const step = (n) => { for (let i = 0; i < n; i++) { game.fixedStep(1 / 60); frame(); } };
    const down = (c) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c }));
    const up = (c) => window.dispatchEvent(new KeyboardEvent('keyup', { code: c }));
    const press = (c) => { down(c); step(1); up(c); step(1); };
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
    const prompt = () => (IA.target ? IA.target.prompt : null);
    const pickups = () => game.world.findByTag('pickup');
    const pickupAt = (item) => pickups().filter((e) => comp(e, 'ItemPickup').spec.item === item);
    const notes = [];
    game.events.on('notify', (n) => notes.push(n.text));
    const r = [];
    const check = (label, ok, extra = '') => r.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
    const take = (from, target) => { tp(from[0], from[1], from[2]); aim(...target); const p = prompt(); press('KeyE'); return p; };
    // Pretend the mouse is captured (headless has no pointer lock).
    game.input._locked = true;

    // 0. Validation: item-only effects are rejected in dialogue.
    let err = '';
    try { dialogue.register({ id: 'bad2', speaker: 'X', start: 'a', nodes: { a: { text: 'x', do: [{ do: 'consume' }] } } }); } catch (e) { err = e.message; }
    check('"consume" rejected outside items', /only works in an item/.test(err), err.split('\n')[1]);

    // 1. Pick things up.
    const pa = take([-4.65, 0.05, 5.6], [-4.85, 0.6, 4.05]);
    take([-4.65, 0.05, 5.6], [-4.6, 0.6, 4.2]);
    take([-4.65, 0.05, 5.6], [-4.5, 0.6, 3.97]);
    check('apples picked from crate', pa === 'Pick up Apple' && S.itemCount('apple') === 3 && pickupAt('apple').length === 0, `prompt=${pa} n=${S.itemCount('apple')}`);
    const pn = take([-36.9, 0.05, 16.4], [-36.9, 0.82, 17.66]);
    check('note picked from table', pn === "Pick up Bram's list" && S.itemCount('note_storeroom') === 1, `prompt=${pn}`);
    const pc = take([0, 10.05, -39.6], [0.9, 10.02, -40.9]);
    check('coins on tower top', pc === 'Pick up 5 gold' && S.itemCount('gold') === 5, `prompt=${pc}`);
    check('level pickups marked taken', S.hasFlag('world.taken.tower-coins') && S.hasFlag('world.taken.crate-apple-2'));

    // 2. Inventory screen.
    tp(10, 0.05, 10, 0);
    const opened = inventory.open();
    const ui = document.querySelector('.inventory');
    check('Tab opens inventory, pauses, blocks input', opened && game.paused && game.input.gameplayBlocked && !ui.classList.contains('hidden'));
    const slots = inventory.slots().map((s) => `${s.item}:${s.count}`).join(' ');
    check('slots exclude currency', slots === 'apple:3 note_storeroom:1', slots);
    const icon = document.querySelector('.inv-slot img');
    check('icons rendered from 3D models', icon && icon.src.startsWith('data:image/png') && icon.src.length > 2000, `${icon && icon.src.length} chars`);
    check('gold shown as total', document.querySelector('.inv-money').textContent.includes('5 gold'));
    const btn = (label) => [...document.querySelectorAll('.inv-actions button')].find((b) => b.textContent === label);
    check('apple selected first, Eat + Drop', !!btn('Eat') && !!btn('Drop'));
    btn('Eat').click();
    check('Eat uses one apple', S.itemCount('apple') === 2 && notes.includes('Crunchy.') && document.querySelector('.inv-slot .count').textContent === '2');
    document.querySelectorAll('.inv-slot')[1].click();
    btn('Read').click();
    const note = document.querySelector('.inv-note');
    check('Read shows the note', !note.classList.contains('hidden') && /Storeroom/.test(note.textContent));
    check('note has no Use', !btn('Use') && !btn('Eat') && !!btn('Drop'));
    document.querySelectorAll('.inv-slot')[0].click();
    btn('Drop').click();
    const dropped = pickupAt('apple');
    const dp = dropped[0] && dropped[0].object3d.position;
    check('Drop, looking straight ahead: on the ground at arm\'s reach', S.itemCount('apple') === 1 && dropped.length === 1 && Math.abs(dp.y) < 0.05 && dp.z < 8.2 && dp.z > 7, dp && dp.toArray().map((v) => v.toFixed(2)).join(','));
    check('quest items not droppable', (S.addItem('key_rusty'), !inventory.drop('key_rusty')) && S.itemCount('key_rusty') === 1);
    S.removeItem('key_rusty');
    check('dialogue blocked while open', !dialogue.start('mira', game.world.find('npc-mira'), comp(game.world.find('npc-mira'), 'Npc')));
    inventory.close(true);
    check('Tab closes, unpauses', !game.paused && !game.input.gameplayBlocked && ui.classList.contains('hidden'));
    // Drink nothing yet: cider comes from Tess.

    // 3. Drop where you're looking.
    S.addItem('apple', 6);
    const made = [];
    const dropLooking = (from, target) => {
      tp(...from); aim(...target);
      inventory.open(); const before = pickups().length; inventory.drop('apple'); inventory.close(true);
      const e = pickups().slice(before)[0];
      made.push(e);
      return e.object3d.position.clone();
    };
    const onTable = dropLooking([-36.3, 0.05, 16.3], [-36.15, 0.8, 17.85]);
    check('look at the table: lands on the table top', Math.abs(onTable.y - 0.8) < 0.01 && Math.hypot(onTable.x + 36.15, onTable.z - 17.85) < 0.05, onTable.toArray().map((v) => v.toFixed(2)).join(','));
    const onCrate = dropLooking([-4.7, 0.05, 5.4], [-4.75, 0.55, 4.15]);
    check('look at the crate: lands on the crate', Math.abs(onCrate.y - 0.55) < 0.01, onCrate.toArray().map((v) => v.toFixed(2)).join(','));
    const onGround = dropLooking([12, 0.05, 10], [12, 0, 8.6]);
    check('look at the ground: lands where you look', Math.abs(onGround.y) < 0.02 && Math.abs(onGround.z - 8.6) < 0.05, onGround.toArray().map((v) => v.toFixed(2)).join(','));
    const under = dropLooking([-36.3, 0.05, 15.6], [-36.3, 0.4, 17.35]);
    check('look under the table: lands on the floor, not the top', under.y < 0.2, under.toArray().map((v) => v.toFixed(2)).join(','));
    const wallLook = dropLooking([-36, 0.05, 11], [-36, 1.5, 9.15]);
    check('look at a wall: lands at its foot, inside', wallLook.y < 0.2 && wallLook.z > 9.15 && wallLook.z < 9.6, wallLook.toArray().map((v) => v.toFixed(2)).join(','));
    const far = dropLooking([-20, 0.05, 0], [-20, 0.0, -30]);
    check('look far away: lands within reach', Math.hypot(far.x + 20, far.z) < 2.6 && far.y < 0.2, far.toArray().map((v) => v.toFixed(2)).join(','));
    const lift = game.world.findByTag('lift').map((e) => comp(e, 'Lift'))[0];
    for (const e of made) game.world.destroy(e);
    S.removeItem('apple', 6 - made.length);

    // 4. Drop facing a wall: at its foot, never through it.
    tp(-37.3, 0.05, 13, Math.PI / 2); // facing -X toward the west wall at x=-38
    inventory.open(); inventory.drop('apple'); inventory.close(true);
    const wallApple = pickupAt('apple').map((e) => e.object3d.position).find((p) => p.x < -36);
    check('drop against a wall stays inside', wallApple && wallApple.x > -37.85, wallApple && wallApple.x.toFixed(2));
    tp(-37.3, 0.05, 13, Math.PI / 2); aim(wallApple.x, wallApple.y + 0.04, wallApple.z); press('KeyE');
    check('dropped item can be picked back up', S.itemCount('apple') === 1 && pickupAt('apple').length === 1);

    // 5. Save, change the world, load.
    const wood = comp(game.world.findByTag('door').find((e) => e.name === 'door-wood'), 'Door');
    wood.activate('on', player); lift.call(1); step(600);
    check('setup: door open, lift up', wood.openness === 1 && lift.progress === 1, `${wood.openness} ${lift.progress}`);
    tp(5, 0.05, 12, 1.0);
    const saved = saves.save(false);
    check('save to localStorage', saved && !!localStorage.getItem('owrpg.save.v1') && notes.includes('Game saved'));
    // Change everything.
    tp(9.1, 0.05, 8.8); aim(dp.x, dp.y + 0.04, dp.z); press('KeyE');
    wood.activate('off'); lift.call(0); step(600);
    S.setFlag('junk');
    tp(-10, 0.05, -10, 2);
    check('setup: world changed', S.itemCount('apple') === 2 && wood.openness === 0 && lift.progress === 0 && pickupAt('apple').length === 0);
    saves.load(); step(5);
    const fp = C.feetPosition;
    check('load: player back', Math.hypot(fp.x - 5, fp.z - 12) < 0.05 && Math.abs(C.yaw - 1) < 1e-6, fp.toArray().map((v) => v.toFixed(2)).join(','));
    check('load: items back', S.itemCount('apple') === 1 && S.itemCount('gold') === 5 && !S.hasFlag('junk'));
    check('load: dropped apple back on the ground', pickupAt('apple').length === 1 && Math.abs(pickupAt('apple')[0].object3d.position.z - dp.z) < 1e-6);
    check('load: taken items stay taken', pickupAt('gold').length === 0 && pickupAt('note_storeroom').length === 0 && pickupAt('key_rusty').length === 1);
    check('load: door and lift restored', wood.openness === 1 && lift.progress === 1, `${wood.openness} ${lift.progress}`);
    step(120);
    check('load: still standing after 2s', Math.abs(C.feetPosition.y) < 0.1 && C.grounded);

    // 6. New game resets everything and clears the save.
    saves.newGame(); step(5);
    check('new game: fresh world', S.inventory().length === 0 && pickupAt('apple').length === 3 && pickupAt('gold').length === 1 && wood.openness === 0 && lift.progress === 0);
    check('new game: save cleared', !saves.hasSave());
    saves.save(true);
    return r;
  });
  // 7. Start screen offers Continue when a save exists.
  await page.goto(url);
  await page.waitForFunction(() => !document.querySelector('.play').disabled, null, { timeout: 30000 });
  const startUi = await page.evaluate(() => [document.querySelector('.play').textContent, !document.querySelector('.newgame').classList.contains('hidden')]);
  out.push(`${startUi[0] === 'Continue' && startUi[1] ? 'PASS' : 'FAIL'}  start screen offers Continue + New game  ${startUi.join(' ')}`);
  await page.evaluate(() => localStorage.clear());
  console.log(out.join('\n'));
  const fails = out.filter((l) => l.startsWith('FAIL')).length;
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
