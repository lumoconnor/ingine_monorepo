// Keys, locks and chests regression check. Start `npm run dev` first, then: node scripts/lock-check.cjs
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
    const player = game.world.find('player');
    const comp = (e, n) => e.getAll().find((c) => c.constructor.name === n);
    const C = comp(player, 'PlayerController');
    const IA = comp(player, 'PlayerInteractor');
    const S = game.state;
    const T = player.object3d.position.constructor;
    let elapsed = 0;
    const frame = () => { elapsed += 1 / 60; const t = { delta: 1 / 60, elapsed, alpha: 1 }; game.world.update(t); dialogue.update(t); };
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
    const notes = [];
    game.events.on('notify', (n) => notes.push(n.text));
    const lastNote = () => notes[notes.length - 1];
    const r = [];
    const check = (label, ok, extra = '') => r.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
    const doorE = game.world.findByTag('door').find((e) => e.name === 'door-storeroom');
    const door = comp(doorE, 'Door');
    const chestE = (id) => game.world.findByTag('chest').find((e) => e.name === `chest:${id}`);
    const lidAngle = (id) => { let a = 0; chestE(id).object3d.traverse((o) => { if (o.rotation.x < a) a = o.rotation.x; }); return a; };

    // 1. Locked door, no key.
    tp(-27.6, 0.05, 22, -Math.PI / 2);
    aim(-26, 1.1, 21.8);
    check('locked door prompt', prompt() === 'Locked door', `prompt=${prompt()}`);
    const panel = doorE.object3d.children[0];
    press('KeyE');
    let wiggled = false;
    for (let i = 0; i < 10; i++) { step(1); if (panel.position.lengthSq() > 1e-6) wiggled = true; }
    step(60);
    check('E without key: rattles, stays shut, says why', wiggled && door.openness === 0 && /storeroom/.test(lastNote()) && panel.position.lengthSq() < 1e-9, lastNote());
    C.yaw = -Math.PI / 2; C.pitch = 0; down('KeyW'); step(80); up('KeyW'); step(5);
    check('locked door blocks the way', C.feetPosition.x < -26.2, C.feetPosition.x.toFixed(2));

    // 2. With the key.
    S.addItem('key_rusty');
    tp(-27.6, 0.05, 22, -Math.PI / 2); aim(-26, 1.1, 21.8);
    check('prompt offers unlock with key name', prompt() === 'Unlock door (Rusty key)', `prompt=${prompt()}`);
    press('KeyE'); step(70);
    check('unlocks and opens, keeps the key', S.hasFlag('unlocked.storeroom') && door.openness === 1 && S.itemCount('key_rusty') === 1 && lastNote() === 'Unlocked with Rusty key');
    const doorPrompt = comp(doorE, 'Interactable').prompt;
    check('then it is a normal door', doorPrompt === 'Close door', `prompt=${doorPrompt}`);
    C.yaw = -Math.PI / 2; C.pitch = 0; down('KeyW'); step(90); up('KeyW'); step(5);
    check('walk into the storeroom', C.feetPosition.x > -25.3, C.feetPosition.x.toFixed(2));

    // 3. Unlocked chest.
    tp(-23.7, 0.05, 23.2, -Math.PI / 2);
    aim(-22.5, 0.45, 23.2);
    check('chest prompt', prompt() === 'Open chest', `prompt=${prompt()}`);
    press('KeyE'); step(60);
    check('chest gives its contents', S.itemCount('iron_key') === 1 && S.itemCount('cider') === 2 && notes.includes('Found Iron key') && notes.includes('Found Cider ×2'));
    check('lid open, nothing more to take', lidAngle('storeroom-chest') < -1.5 && prompt() !== 'Open chest', `angle=${lidAngle('storeroom-chest').toFixed(2)} prompt=${prompt()}`);

    // 4. Locked chest on the slide tower.
    S.removeItem('iron_key');
    tp(-21.2, 6.05, -36.8, Math.PI / 2);
    aim(-23.1, 6.45, -36.8);
    check('tower chest locked', prompt() === 'Locked chest', `prompt=${prompt()}`);
    press('KeyE'); step(20);
    check('E without iron key does nothing', S.itemCount('gold') === 0 && /keyhole/.test(lastNote()));
    S.addItem('iron_key');
    aim(-23.1, 6.45, -36.8);
    check('offers unlock with Iron key', prompt() === 'Unlock chest (Iron key)', `prompt=${prompt()}`);
    press('KeyE'); step(60);
    check('opens: key used up, gold + map', S.itemCount('iron_key') === 0 && S.itemCount('gold') === 15 && S.itemCount('old_map') === 1 && notes.some((n) => /stays in the lock/.test(n)));

    // 5. Saves remember locks and chests.
    const snap = JSON.parse(JSON.stringify(saves.capture()));
    saves.newGame(); step(60);
    check('new game: locked and closed again', door.openness === 0 && !S.hasFlag('unlocked.storeroom') && lidAngle('storeroom-chest') > -0.05);
    saves.apply(snap); step(60);
    check('load: unlocked, open, chests emptied', S.hasFlag('unlocked.storeroom') && door.openness === 1 && lidAngle('storeroom-chest') < -1.5 && lidAngle('tower-chest') < -1.5, `${S.hasFlag('unlocked.storeroom')} ${door.openness} ${lidAngle('storeroom-chest').toFixed(2)} ${lidAngle('tower-chest').toFixed(2)}`);

    // 6. Returning the key to Bram unlocks it too.
    saves.newGame(); step(10);
    S.addItem('key_rusty');
    tp(-28.6, 0.05, 20.6); const bram = game.world.find('npc-bram'); aim(bram.object3d.position.x, 1.35, bram.object3d.position.z);
    press('KeyE');
    check('Bram sees the key', dialogue.currentNode === 'has_key', dialogue.currentNode);
    press('Digit1'); press('KeyE');
    check('returning the key unlocks the storeroom', S.itemCount('key_rusty') === 0 && S.hasFlag('unlocked.storeroom'));
    tp(-27.6, 0.05, 22, -Math.PI / 2); aim(-26, 1.1, 21.8);
    check('door now just opens', prompt() === 'Open door', `prompt=${prompt()}`);
    saves.newGame();
    return r;
  });
  await page.evaluate(() => localStorage.clear());
  console.log(out.join('\n'));
  const fails = out.filter((l) => l.startsWith('FAIL')).length;
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
