// Buddies park check: arrive, the five pups and their parents are there and
// talk, every lost ball rests on a surface and can be reached (the snow hill
// and pyramid are climbed with real jumps, the spooky house walked into and
// its ghost says BOO), picking up a ball brings its pup running, giving each
// back works, fetch works (throw, chase, bring back), the pups wander, Buddy
// cheers, and the rocket launches the pups to space and lands again.
// SHOTS=dir saves screenshots.
const { chromium } = require('playwright');

const URL = process.env.URL || 'http://localhost:5175/';
const SIGNAL = process.env.SIGNAL || '127.0.0.1:9000';
const shots = process.env.SHOTS;

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: shots ? { width: 1280, height: 720 } : { width: 480, height: 300 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(`${URL}?signal=${SIGNAL}`);
  await page.waitForFunction(() => window.game && window.game.world.find('player'), null, { timeout: 30000 });
  const r = await page.evaluate(() => {
    game.stop();
    const player = game.world.find('player');
    const comp = (e, n) => e.getAll().find((c) => c.constructor.name === n);
    const C = comp(player, 'PlayerController');
    const T = player.object3d.position.constructor;
    let elapsed = 0;
    const frame = () => { elapsed += 1 / 60; game.world.update({ delta: 1 / 60, elapsed, alpha: 1 }); };
    const step = (n) => { for (let i = 0; i < n; i++) { game.fixedStep(1 / 60); frame(); } };
    const input = game.input;
    const aim = (tx, ty, tz) => { for (let k = 0; k < 3; k++) { const cam = game.renderer.camera.getWorldPosition(new T()); const dx = tx - cam.x, dy = ty - cam.y, dz = tz - cam.z; C.yaw = Math.atan2(-dx, -dz); C.pitch = Math.atan2(dy, Math.hypot(dx, dz)); step(1); } };
    window.X = { comp, C, T, step, aim };
    const r = [];
    const check = (label, ok, extra = '') => r.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
    const ox = 3600;
    const feet = player.object3d.position;
    const f = (v) => v.toFixed(1);
    const where = () => [feet.x - ox, feet.y, feet.z].map(f).join(',');
    const P = (x, y, z) => new T(ox + x, y, z);

    const pad = teleports.pads.find((p) => p.sceneId === 'buddies');
    C.placeAt(new T(pad.position[0], 0.14, pad.position[2] + 2.2), 0, 0);
    step(5);
    C.placeAt(new T(pad.position[0], 0.14, pad.position[2]), 0, 0);
    step(30);
    check('the portal brings you to Buddies park', teleports.current === 'buddies');
    check('you land on the grass', Math.abs(feet.y) < 0.2 && Math.abs(feet.x - ox) < 1, where());

    const q = game.getSystem('ball-quest');
    const dogs = game.world.findByTag('dog').map((d) => d.name);
    check('five pups plus Buddy and Molly', dogs.length === 7 && ['budderball', 'rosebud', 'mudbud', 'buddha', 'b_dawg', 'buddy', 'molly'].every((n) => dogs.includes(n)), dogs.join(','));

    // Every lost ball rests on a surface: a ray from just above its bottom hits right under it.
    const world = game.physics.world;
    const floating = [];
    for (const p of q.pups) {
      const b = p.lostAt;
      const hit = world.castRay(new RAPIER.Ray({ x: b.x, y: b.y + 0.05, z: b.z }, { x: 0, y: -1, z: 0 }), 3, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
      if (!hit || Math.abs(hit.timeOfImpact - 0.05) > 0.03) floating.push(`${p.def.sport} ${hit ? hit.timeOfImpact.toFixed(2) : 'none'}`);
    }
    check('every lost ball rests on a surface', floating.length === 0, floating.join(' | '));

    // Talk to everyone.
    const lines = [];
    const off = game.events.on('dialogue:line', (l) => lines.push(l));
    const dlg = game.getSystem('dialogue');
    const talk = (id) => {
      lines.length = 0;
      const e = game.world.find(id);
      const p = e.object3d.position;
      C.placeAt(new T(p.x + 1.4, p.y + 0.05, p.z + 1.4), 0, 0);
      step(2);
      comp(e, 'Interactable').interact(player);
      step(2);
      const first = lines[0];
      dlg.end();
      step(2);
      return first;
    };
    for (const id of ['budderball', 'rosebud', 'mudbud', 'buddha', 'b_dawg', 'buddy', 'molly']) {
      const l = talk(id);
      check(`  ${id} talks`, !!l && l.text.length > 20, l ? l.text.slice(0, 50) : 'nothing');
    }

    // Pups wander.
    const pups = q.pups.map((p) => p.dog);
    const before = pups.map((d) => d.object3d.position.clone());
    C.placeAt(P(0, 0.05, 4), 0, 0);
    step(480);
    const moved = pups.filter((d, i) => d.object3d.position.distanceTo(before[i]) > 1).length;
    check('the pups trot round the field', moved >= 3, `${moved} of 5 moved`);

    // Real climbs: jump up the snow hill tiers and the pyramid tiers.
    const climb = (label, startAt, target, n) => {
      C.placeAt(startAt, 0, 0);
      step(5);
      C.yaw = Math.atan2(-(target.x - startAt.x), -(target.z - startAt.z));
      input.down.add('KeyW');
      for (let k = 0; k < n; k++) {
        input.pressed.add('jump');
        input.down.add('Space');
        let there = false;
        for (let i = 0; i < 45 && !there; i++) {
          if (i === 40) input.down.delete('Space');
          step(1);
          there = Math.hypot(feet.x - target.x, feet.z - target.z) < 0.6;
        }
        input.down.delete('Space');
        if (there) break;
      }
      input.down.delete('KeyW');
      step(30);
      const ok = Math.abs(feet.y - target.y) < 0.15;
      check(label, ok, where());
    };
    climb('you can jump up the snow hill to the top', P(-38, 0.05, -5), P(-38, 2.2, -15), 12);
    climb('you can climb the pyramid to the top', P(0, 0.05, -61), P(0, 3.2, -70), 12);
    // Walk into the spooky house through its door.
    C.placeAt(P(30, 0.05, -51), -Math.PI / 2, 0);
    input.down.add('KeyW');
    step(150);
    input.down.delete('KeyW');
    step(10);
    check('you can walk into the spooky house', feet.x - ox > 35 && feet.x - ox < 42 && Math.abs(feet.z + 51) < 1.5, where());
    step(30);
    check('the ghost swoops at you: BOO!', q.ghost.boos === 1 && q.ghost.phase !== 'idle', `${q.ghost.boos} boos, ${q.ghost.phase}`);
    step(240);
    check('  and floats back to its corner', q.ghost.phase === 'idle' && q.ghost.boos === 1, q.ghost.phase);

    // Before the balls are home, the rocket won't go.
    const desk = game.world.find('launch-console');
    comp(desk, 'Interactable').interact(player);
    step(2);
    check('the rocket waits for every ball', !q.rocket.active);

    // Pick every ball up and give it back. Picking one up brings its pup running.
    const bud = q.pups[0];
    C.placeAt(new T(bud.lostAt.x + 0.3, bud.lostAt.y + 0.05, bud.lostAt.z), 0, 0);
    step(4);
    const far = bud.dog.object3d.position.distanceTo(feet);
    step(120);
    const near = bud.dog.object3d.position.distanceTo(feet);
    check('picking up a ball brings its pup running', near < far - 6, `${f(far)} m -> ${f(near)} m`);
    for (const p of q.pups) {
      C.placeAt(new T(p.lostAt.x + 0.3, p.lostAt.y + 0.05, p.lostAt.z), 0, 0);
      step(4);
    }
    check('walking over a ball picks it up', q.pups.every((p) => p.state === 'carried'), q.pups.map((p) => p.state).join(','));
    for (const p of q.pups) {
      const d = p.dog.object3d.position;
      C.placeAt(new T(d.x + 1.5, d.y + 0.05, d.z + 0.5), 0, 0);
      step(4);
    }
    check('walking up to a pup gives the ball back', q.returned === 5 && q.pups.every((p) => p.state === 'home'), `${q.returned} / 5`);
    check('each pup drops its ball at your feet to play', q.pups.every((p) => p.play === 'offered' || p.play === 'idle'), q.pups.map((p) => p.play).join(','));
    check('all five returned sets the flag', game.state.hasFlag('buddies.all'));

    // Fetch: walk onto the ball, throw it across the field, and the pup brings it back.
    const rb = q.pups[1];
    C.placeAt(P(0, 0.05, 2), 0, 0);
    step(10);
    const fake = rb.play;
    for (const p of q.pups) if (p.play === 'offered') { p.ball.removeFromParent(); p.ball.scale.setScalar(1); }
    q.pups.forEach((p) => { if (p.play === 'offered') { p.play = 'idle'; p.dog.object3d.add(p.ball); p.ball.position.set(0.35, 0, 0.45); p.brain.resume(); } });
    step(10);
    // Walk up to Rosebud empty-handed: she drops her ball for you.
    const rp = rb.dog.object3d.position;
    rb.cooldown = 0;
    C.placeAt(new T(rp.x + 1.6, rp.y + 0.05, rp.z), 0, 0);
    step(3);
    check('walk up to a pup and it drops its ball for you', rb.play === 'offered', `${fake} -> ${rb.play}`);
    const bp = rb.ball.position;
    C.placeAt(new T(bp.x, bp.y + 0.05, bp.z), 0, 0);
    step(3);
    const cb = comp(player, 'Combatant');
    check('walk onto the ball and it is in your hand', rb.play === 'held' && cb.itemId === 'pup_soccer', `${rb.play} ${cb.itemId}`);
    // Throw it for real: hold the attack button and let go, looking down the field.
    C.placeAt(P(0, 0.05, -2), 0, 0);
    step(3);
    aim(ox, 4, -30);
    for (let t = 0; cb.state !== 'idle' && t < 120; t++) step(1);
    input._locked = true;
    document.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    step(45);
    document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    step(3);
    check('hold and let go: the ball flies', rb.play === 'flying' && !!q.flying, rb.play);
    let caught = false;
    for (let i = 0; i < 1200 && rb.play !== 'offered'; i++) {
      step(1);
      if (rb.play === 'returning') caught = true;
    }
    check('the pup chases it down and picks it up', caught);
    check('  and brings it back to your feet', rb.play === 'offered' && rb.dog.object3d.position.distanceTo(feet) < 2.5, `${rb.play} ${f(rb.dog.object3d.position.distanceTo(feet))} m`);
    check('  the throw is measured', q.fetches === 1 && q.lastThrow && q.lastThrow.metres > 10, q.lastThrow ? `${f(q.lastThrow.metres)} m` : 'none');
    const bb = talk('budderball');
    check('Budderball thanks you', !!bb && /MY FOOTBALL/.test(bb.text), bb ? bb.text.slice(0, 40) : 'nothing');
    const b = talk('buddy');
    check('Buddy welcomes you to the pack', !!b && /part of the pack/.test(b.text), b ? b.text.slice(0, 50) : 'nothing');

    // Space Buddies: the big red button.
    C.placeAt(P(28.4, 0.05, -15), -Math.PI / 2, 0);
    step(3);
    comp(desk, 'Interactable').interact(player);
    let boarded = false;
    let top = 0;
    for (let i = 0; i < 60 * 50 && (q.rocket.active || i < 5); i++) {
      step(1);
      if (q.pups.every((p) => !p.dog.object3d.visible)) boarded = true;
      top = Math.max(top, q.rocket.height);
    }
    check('the pups run aboard the rocket', boarded);
    check('  it lifts off and flies out of sight', top > 100, `${f(top)} m`);
    check('  and lands back on its pad', !q.rocket.active && q.rocket.launches === 1 && q.rocket.height === 0 && game.state.hasFlag('buddies.space'));
    check('  the pups hop out and play on', q.pups.every((p) => p.dog.object3d.visible));
    off();
    return r;
  });

  if (shots) {
    const shot = async (name, setup) => {
      await page.evaluate(setup);
      await page.evaluate(() => {
        game.start();
        document.querySelector('.mp-lobby')?.remove();
        document.querySelectorAll('.hud .overlay, .hud .debug').forEach((e) => (e.style.display = 'none'));
      });
      await page.waitForTimeout(1600);
      await page.screenshot({ path: `${shots}/${name}.png` });
      await page.evaluate(() => game.stop());
    };
    const aimFrom = `(x, y, z, tx, ty, tz) => { const { C, T, step, aim } = X; C.placeAt(new T(3600 + x, y, z), 0, 0); step(5); aim(3600 + tx, ty, tz); }`;
    const atDog = (id, dx, dz) => `(() => { const { C, T, step, aim } = X; const p = game.world.find('${id}').object3d.position; C.placeAt(new T(p.x + ${dx}, 0.05, p.z + ${dz}), 0, 0); step(3); aim(p.x, 0.4, p.z); })()`;
    await shot('buddies-arrival', `(${aimFrom})(0, 0.05, 6, 0, 1.5, -25)`);
    await shot('buddies-parents', `(${aimFrom})(-3.6, 0.05, 2.6, -5.3, 0.6, -0.7)`);
    await shot('buddies-pups', `(${aimFrom})(0, 0.05, -10, 0, 0.3, -27)`);
    await shot('buddies-budderball', atDog('budderball', 1.4, 1.0));
    await shot('buddies-rosebud', atDog('rosebud', 1.4, 1.0));
    await shot('buddies-rocket', `(${aimFrom})(28, 0.05, -4, 38, 5, -15)`);
    await shot('buddies-spooky', `(${aimFrom})(27, 0.05, -45, 38, 2.5, -51)`);
    await shot('buddies-pyramid', `(${aimFrom})(-6, 0.05, -56, 0, 2, -70)`);
    // Fetch: Budderball racing back with the ball in his mouth.
    await shot('buddies-fetch', `(() => { const { C, T, step, aim } = X; const q = game.getSystem('ball-quest'); const p = q.pups[0]; C.placeAt(new T(3600, 0.05, -2), 0, 0); step(3); q.pups.forEach((r) => r.play === 'offered' && (r.play = 'idle')); p.play = 'idle'; p.ball.removeFromParent(); p.ball.position.set(3600, 0, -3.1); game.renderer.scene.add(p.ball); p.play = 'offered'; step(1); C.placeAt(new T(3600, 0.05, -3.1), 0, 0); step(3); C.placeAt(new T(3600, 0.05, -2), 0, 0); step(2); aim(3600, 3, -30); q.throwBall(p, 0.5); for (let i = 0; i < 900 && p.play !== 'returning'; i++) step(1); step(60); const d = p.dog.object3d.position; C.placeAt(new T(d.x + 2.5, 0.05, d.z - 5), 0, 0); step(2); aim(d.x, 0.4, d.z); })()`);
    // Liftoff, from mission control.
    await shot('buddies-liftoff', `(() => { const { C, T, step, aim } = X; const q = game.getSystem('ball-quest'); C.placeAt(new T(3600 + 8, 0.05, -10), -Math.PI / 2, 0); step(3); q.rocket.press(); for (let i = 0; i < 60 * 30 && q.rocket.phase !== 'lift'; i++) step(1); step(130); aim(3600 + 38, 4 + q.rocket.height, -15); })()`);
    // BOO!
    await shot('buddies-boo', `(() => { const { C, T, step, aim } = X; const q = game.getSystem('ball-quest'); for (let i = 0; i < 60 * 40 && q.rocket.active; i++) step(1); C.placeAt(new T(3600 + 30, 0.05, -51), -Math.PI / 2, 0); step(30); C.placeAt(new T(3600 + 36.5, 0.05, -51), -Math.PI / 2, 0); step(32); })()`);
  }

  r.push(`${errors.length ? 'FAIL' : 'PASS'}  no errors  ${errors.slice(0, 3).join(' | ')}`);
  console.log(r.join('\n'));
  await browser.close();
  process.exit(r.some((l) => l.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => {
  console.log('FAIL  crashed: ' + e.message);
  process.exit(1);
});
