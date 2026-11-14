// Hoops check: arrive in the arena, grab a ball at the rack (it's in hand and
// a 60-second shootout starts), then shoot with real mouse holds: a free throw
// at the right power drops through the rim at both ends, a three from beyond
// the arc counts 3, a weak tap is an air ball, a hard shot bounces off the
// glass, the rebound comes back to your hand, the buzzer ends the round and
// the best is kept. A few hold lengths either side of perfect still go in.
// Rex the mascot talks. SHOTS=dir saves screenshots.
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
    try { localStorage.removeItem('gene40.hoops.best'); } catch {}
    const player = game.world.find('player');
    const comp = (e, n) => e.getAll().find((c) => c.constructor.name === n);
    const C = comp(player, 'PlayerController');
    const T = player.object3d.position.constructor;
    let elapsed = 0;
    const hoops = game.getSystem('hoops');
    const frame = () => { elapsed += 1 / 60; game.world.update({ delta: 1 / 60, elapsed, alpha: 1 }); };
    const step = (n) => { for (let i = 0; i < n; i++) { game.fixedStep(1 / 60); frame(); } };
    const input = game.input;
    input._locked = true;
    const aim = (tx, ty, tz) => { for (let k = 0; k < 3; k++) { const cam = game.renderer.camera.getWorldPosition(new T()); const dx = tx - cam.x, dy = ty - cam.y, dz = tz - cam.z; C.yaw = Math.atan2(-dx, -dz); C.pitch = Math.atan2(dy, Math.hypot(dx, dz)); step(1); } };
    window.X = { comp, C, T, step, aim, hoops };
    const r = [];
    const check = (label, ok, extra = '') => r.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
    const ox = 5400;
    const feet = player.object3d.position;
    const f = (v) => v.toFixed(1);
    const where = () => [feet.x - ox, feet.y, feet.z].map(f).join(',');
    const P = (x, y, z) => new T(ox + x, y, z);
    const cb = comp(player, 'Combatant');

    const pad = teleports.pads.find((p) => p.sceneId === 'hoops');
    C.placeAt(new T(pad.position[0], 0.14, pad.position[2] + 2.2), 0, 0);
    step(5);
    C.placeAt(new T(pad.position[0], 0.14, pad.position[2]), 0, 0);
    step(30);
    check('the portal brings you to the hoops court', teleports.current === 'hoops');
    check('you land on the arena floor', Math.abs(feet.y) < 0.2 && Math.abs(feet.x - ox) < 1, where());
    // Walk out of the tunnel onto the court (past the hoop's stanchion).
    C.placeAt(P(2.5, 0.05, 6), 0, 0);
    step(3);
    C.yaw = 0;
    input.down.add('KeyW');
    step(200);
    input.down.delete('KeyW');
    step(10);
    check('you can walk onto the court', feet.z < -6, where());

    // Grab a ball.
    const rack = game.world.find('ball-rack');
    const rp = rack.object3d.position;
    C.placeAt(new T(rp.x + 1.2, 0.05, rp.z), 0, 0);
    step(3);
    comp(rack, 'Interactable').interact(player);
    step(20);
    check('the rack puts a ball in your hand', game.state.itemCount('basketball') === 1 && cb.itemId === 'basketball', `${cb.itemId}`);
    check('and starts a 60-second shootout', hoops.roundOn && hoops.timeLeft > 59 && hoops.points === 0);

    const far = hoops.hoops.find((h) => h.out === 1);
    const near = hoops.hoops.find((h) => h.out === -1);
    // How long to hold for a swish from here: the throw's own physics, solved for speed.
    const holdFor = (rim) => {
      const cam = game.renderer.camera;
      const eye = cam.getWorldPosition(new T());
      const look = cam.getWorldDirection(new T());
      const flat = new T(look.x, 0, look.z).normalize();
      const th = Math.min(Math.asin(look.y) + (38 * Math.PI) / 180, (80 * Math.PI) / 180);
      const start = eye.clone().addScaledVector(flat, 0.45);
      start.y -= 0.12;
      const D = Math.hypot(rim.x - start.x, rim.z - start.z);
      const H = rim.y + 0.06 - start.y;
      const v = Math.sqrt((9.8 * D * D) / (2 * Math.cos(th) ** 2 * (D * Math.tan(th) - H)));
      return Math.round(((v - 6.5) / 4) * 1.6 * 60);
    };
    // One real shot: hold the button for n frames, let go, and follow the ball until it comes back.
    const shoot = (n) => {
      let t = 0;
      while ((cb.itemId !== 'basketball' || cb.state !== 'idle') && t++ < 120) step(1);
      const made = [];
      const off = game.events.on('hoops:score', (e) => made.push(e.points));
      document.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
      step(Math.max(1, n));
      document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
      step(2);
      const thrown = !!hoops.ball;
      let minFront = Infinity;
      t = 0;
      while (hoops.ball && t++ < 600) {
        step(1);
        if (hoops.ball) for (const h of hoops.hoops) {
          const b = hoops.ball.pos;
          if (Math.abs(b.x - h.rim.x) < 0.9 && b.y > 2.9 && b.y < 4) minFront = Math.min(minFront, (b.z - h.boardZ) * h.out);
        }
      }
      step(25);
      off();
      return { thrown, made: made.length > 0, points: made[0] ?? 0, back: cb.itemId === 'basketball', minFront, shot: hoops.lastShot && { ...hoops.lastShot } };
    };
    // Stand at a spot facing a hoop, look at the front of the rim, and try holds around the predicted one.
    const tryFrom = (x, z, h) => {
      C.placeAt(P(x, 0.05, z), 0, 0);
      step(3);
      aim(h.rim.x, h.rim.y, h.rim.z + h.out * 0.1);
      const n0 = holdFor(h.rim);
      const tried = [];
      for (const d of [0, 1, 2, -1, 3, -2, 4, -3, 5, -4, 6]) {
        C.placeAt(P(x, 0.05, z), 0, 0);
        step(2);
        aim(h.rim.x, h.rim.y, h.rim.z + h.out * 0.1);
        const s = shoot(n0 + d);
        tried.push(`${n0 + d}:${s.made ? s.points : 'x'}`);
        if (s.made) return { ...s, tried };
      }
      return { made: false, tried };
    };
    const ftZ = far.rim.z + 4.6; // just behind the free-throw line
    const ft = tryFrom(0, ftZ, far);
    check('a free throw at the right power drops through the rim', ft.made && ft.points === 2, ft.tried.join(' '));
    check('the rebound comes back to your hand', ft.back);
    // A little forgiveness: a few hold lengths either side of perfect still go in.
    const n0 = Number(ft.tried[ft.tried.length - 1].split(':')[0]);
    const spread = [];
    for (let d = -5; d <= 5; d++) {
      C.placeAt(P(0, 0.05, ftZ), 0, 0);
      step(2);
      aim(far.rim.x, far.rim.y, far.rim.z + 0.1);
      spread.push(shoot(n0 + d).made ? 'o' : '.');
    }
    check('free throws forgive a little timing', spread.filter((c) => c === 'o').length >= 3, spread.join(''));
    const nearFt = tryFrom(0.3, near.rim.z - 4.6, near);
    check('the hoop at the other end scores too', nearFt.made, nearFt.tried.join(' '));
    const three = tryFrom(-1.5, far.rim.z + 7.4, far);
    check('a shot from beyond the arc is worth three', three.made && three.points === 3, three.tried.join(' '));
    // A weak tap from downtown falls short.
    C.placeAt(P(0, 0.05, far.rim.z + 7.4), 0, 0);
    step(3);
    aim(far.rim.x, far.rim.y, far.rim.z);
    const tap = shoot(1);
    check('a weak tap is an air ball', tap.thrown && !tap.made, JSON.stringify(tap.shot));
    // A full-power shot straight at the glass from close in bounces off it.
    C.placeAt(P(0, 0.05, far.rim.z + 2.5), 0, 0);
    step(3);
    aim(far.rim.x, 3.6, far.boardZ);
    C.pitch -= 0.35;
    step(1);
    const hard = shoot(80);
    check('a hard shot bounces off the backboard, not through it', hard.thrown && hard.minFront > 0.05, `closest ${hard.minFront.toFixed(2)} m`);
    const pts = hoops.points;
    check('made shots score in the shootout', pts >= 7 && hoops.makes >= 3, `${pts} points, ${hoops.makes} of ${hoops.shots}`);

    // The buzzer.
    let t = 0;
    while (hoops.roundOn && t++ < 4000) step(1);
    check('the buzzer ends the shootout', !hoops.roundOn && hoops.timeLeft === 0);
    check('the best is kept', hoops.best === pts && Number(localStorage.getItem('gene40.hoops.best')) === pts, `best ${hoops.best}`);

    // Rex talks.
    const lines = [];
    const offL = game.events.on('dialogue:line', (l) => lines.push(l));
    const rex = game.world.find('rex');
    const rpos = rex.object3d.position;
    C.placeAt(new T(rpos.x - 1.4, 0.05, rpos.z), 0, 0);
    step(2);
    comp(rex, 'Interactable').interact(player);
    step(2);
    check('Rex the mascot talks', !!lines[0] && (hoops.points >= 15 ? /FIFTEEN/ : /Rex/).test(lines[0].text), lines[0] ? lines[0].text.slice(0, 50) : 'nothing');
    game.getSystem('dialogue').end();
    offL();
    // Rex prowls the sideline.
    const before = rpos.clone();
    step(400);
    check('Rex prowls the sideline', rpos.distanceTo(before) > 1, `${rpos.distanceTo(before).toFixed(1)} m`);
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
    const aimFrom = `(x, y, z, tx, ty, tz) => { const { C, T, step, aim } = X; C.placeAt(new T(5400 + x, y, z), 0, 0); step(5); aim(5400 + tx, ty, tz); }`;
    await shot('hoops-arrival', `(${aimFrom})(0, 0.05, 6, 0, 3, -30)`);
    await shot('hoops-freethrow', `(${aimFrom})(0, 0.05, -25.8, 0, 3.05, -30.4)`);
    await shot('hoops-overview', `(${aimFrom})(-17, 5.2, -12, 0, 1, -22)`);
    await shot('hoops-jumbotron', `(${aimFrom})(5, 0.05, -10, 0, 10.5, -18)`);
    await shot('hoops-rex', `(() => { const { C, T, step, aim } = X; const p = game.world.find('rex').object3d.position; C.placeAt(new T(p.x - 2.6, 0.05, p.z + 1.2), 0, 0); step(3); aim(p.x, 1.4, p.z); })()`);
  }

  r.push(`${errors.length ? 'FAIL' : 'PASS'}  no errors  ${errors.slice(0, 3).join(' | ')}`);
  console.log(r.join('\n'));
  await browser.close();
  process.exit(r.some((l) => l.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => {
  console.log('FAIL  crashed: ' + e.message);
  process.exit(1);
});
