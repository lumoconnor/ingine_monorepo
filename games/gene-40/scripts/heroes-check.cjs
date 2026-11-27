// Hero city check: arrive in the hero suit (super jump), earn swing, flight and
// super strength in order and each works (swing arcs, flight and dive, ground
// slam throws cars, lift and throw a car), one chain of steps to SAVE HERO
// CITY (powers gated behind the emergencies, one beam at a time, the panel
// says what's next), each emergency, Captain Whiskers talks, powers switch off
// outside the city and back on when you return, and nothing has fall damage.
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
    const frame = () => { elapsed += 1 / 60; const t = { delta: 1 / 60, elapsed, alpha: 1 }; game.world.update(t); game.getSystem('hero-powers').update(t); game.getSystem('hero-emergencies').update(t); };
    const step = (n) => { for (let i = 0; i < n; i++) { game.fixedStep(1 / 60); frame(); } };
    const key = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    const input = game.input;
    const hold = (on) => (on ? input.down.add('Space') : input.down.delete('Space'));
    const jump = () => input.pressed.add('jump');
    const aim = (tx, ty, tz) => { for (let k = 0; k < 3; k++) { const cam = game.renderer.camera.getWorldPosition(new T()); const dx = tx - cam.x, dy = ty - cam.y, dz = tz - cam.z; C.yaw = Math.atan2(-dx, -dz); C.pitch = Math.atan2(dy, Math.hypot(dx, dz)); step(1); } };
    window.X = { comp, C, T, step, frame, aim };
    const r = [];
    const check = (label, ok, extra = '') => r.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
    const o = [3000, 0, 0];
    const feet = player.object3d.position;
    const f = (v) => v.toFixed(1);
    const peak = (n = 120) => { let y = -1e9; for (let i = 0; i < n; i++) { step(1); y = Math.max(y, feet.y); } return y; };

    const pad = teleports.pads.find((p) => p.sceneId === 'heroes');
    C.placeAt(new T(pad.position[0], 0.14, pad.position[2] + 2.2), 0, 0);
    step(5);
    C.placeAt(new T(pad.position[0], 0.14, pad.position[2]), 0, 0);
    step(30);
    check('the portal brings you to Hero city', teleports.current === 'heroes');
    check('you land standing on the plaza', Math.abs(feet.y - 0.04) < 0.2 && Math.abs(feet.x - o[0]) < 1, feet.toArray().map(f).join(','));

    const hp = game.getSystem('hero-powers');
    const em = game.getSystem('hero-emergencies');
    em.auto = false;
    const kd = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    const ku = (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code }));
    const hspeed = () => Math.hypot(C.velocity.x, C.velocity.z);
    // The top-centre column: panel first, then messages, newest few only; no debug readout.
    for (let i = 0; i < 6; i++) game.events.emit('notify', { text: `message ${i}` });
    const topCol = document.querySelector('.gene-top');
    const shown = [...topCol.querySelectorAll('.toast')].filter((t) => getComputedStyle(t).display !== 'none').map((t) => t.textContent);
    check('top-centre: the panel and messages stack in one column', topCol.contains(hp.panel) && !!topCol.querySelector('.toasts') && hp.panel.getBoundingClientRect().bottom <= topCol.querySelector('.toasts').getBoundingClientRect().top + 0.5);
    check('  only the newest three messages show', shown.join() === 'message 3,message 4,message 5', shown.join());
    check('the debug readout is hidden', document.querySelector('.hud .debug').classList.contains('hidden'));
    check('three power stations', hp.stations.length === 3);
    check('no powers to start with', hp.owned.size === 0);
    check('only the swing beacon is lit', hp.stations.map((s) => s.beacon.visible).join() === 'true,false,false');
    C.placeAt(new T(o[0], 0.05, 4), 0, 0);
    step(20);
    jump();
    hold(true);
    const big = peak(150) - 0.04;
    hold(false);
    check('the hero suit: a super jump from the start', big > 6.5 && big < 9, `${big.toFixed(2)} m`);
    C.placeAt(new T(o[0] - 31, 0.05, 11), 0, 0);
    step(10);
    jump();
    hold(true);
    input.down.add('KeyW');
    step(90);
    input.down.delete('KeyW');
    hold(false);
    step(30);
    check('super jump gets you onto the diner roof', Math.abs(feet.y - 6) < 0.2, feet.toArray().map(f).join(','));
    step(60);

    const station = (id) => hp.stations.find((s) => s.id === id);
    const visit = (id) => { const st = station(id); C.placeAt(new T(st.pos.x, st.pos.y + 0.05, st.pos.z + 1.1), 0, 0); step(4); return hp.owned.has(id); };
    check('flight and strength are locked at the start', !visit('fly') && !visit('strength'));
    check('the plaza station gives swing', visit('swing'));
        check('the flight station is out of jumping reach', station('fly').pos.y - 0 > 20, `roof at ${f(station('fly').pos.y)} m`);

    // Swing down the avenue: hold G, ride the arc, let go.
    C.placeAt(new T(o[0] + 3, 0.05, -14), 0, 0);
    step(10);
    aim(o[0] + 3, 6, -40);
    const start = feet.clone();
    kd('KeyG');
    step(2);
    check('G hooks a line high on a building ahead', !!hp.swing && hp.swing.anchor.y > 12, hp.swing ? hp.swing.anchor.toArray().map(f).join(',') : 'missed');
    let top = 0;
    for (let i = 0; i < 120 && hp.swing; i++) { step(1); top = Math.max(top, hspeed()); }
    ku('KeyG');
    step(1);
    const travelled = Math.hypot(feet.x - start.x, feet.z - start.z);
    check('the swing builds real speed', top > 16, `${top.toFixed(1)} m/s`);
    check('letting go flings you on', !hp.swing && travelled > 12 && !C.grounded, `${travelled.toFixed(1)} m, y ${f(feet.y)}`);
    step(240);
    // Aim assist: look straight ahead along the avenue (not at a wall), still hooks.
    C.placeAt(new T(o[0], 0.05, -20), 0, 0);
    step(10);
    C.pitch = 0;
    kd('KeyG');
    step(2);
    check('with no wall in your sights, it finds one up ahead', !!hp.swing, hp.swing ? hp.swing.anchor.toArray().map(f).join(',') : 'missed');
    ku('KeyG');
    step(200);

    check('flight waits until the kitten is safe: no beam on it yet', !station('fly').beacon.visible && !visit('fly'));
    check('the panel says what to do next', /SAVE HERO CITY\s+1 \/ 8/.test(hp.panel.textContent) && /Next: catch the kitten/.test(hp.panel.textContent), hp.panel.textContent);
    // 1. The falling kitten: let it fall once, then catch it.
    check('the city calls in the falling kitten first', em.callNext() === 'kitten' && em.current === 'kitten');
    const kit = em.kitten.root.position;
    const ledge = kit.clone();
    C.placeAt(new T(ledge.x - 80, 0.05, ledge.z), 0, 0);
    step(30);
    check('  it waits on its ledge until you come near', !em.kitten.falling && Math.abs(kit.y - ledge.y) < 0.01, `kitten y ${f(kit.y)}`);
    C.placeAt(new T(ledge.x - 30, 0.05, ledge.z + 15), 0, 0);
    step(2);
    check('  it slips as you come close', em.kitten.falling);
    step(60 * 8);
    check('  miss it and it lands on its feet, and you get another go', em.fails === 1 && em.current === 'kitten', `fails ${em.fails}`);
    C.placeAt(new T(ledge.x - 80, 0.05, ledge.z), 0, 0);
    step(60 * 4);
    check('  it is back on the ledge', Math.abs(kit.y - ledge.y) < 0.01 && !em.kitten.falling);
    C.placeAt(new T(ledge.x - 30, 0.05, ledge.z + 15), 0, 0);
    step(60 * 2);
    check('  and slips again once you are ready', em.kitten.falling && kit.y < ledge.y - 2, `kitten y ${f(kit.y)}`);
    // Swoop in and grab it mid-air.
    C.placeAt(new T(kit.x, kit.y - 1.6, kit.z), 0, 0);
    hp.fly();
    step(2);
    check('  catch it in mid-air and it is saved', em.state.kitten === 'done' && !em.current, `state ${em.state.kitten}`);
    check('  then the flight beam lights up, and nothing else', station('fly').beacon.visible && !station('strength').beacon.visible && !em.beacon.visible);
    check('  and the panel sends you there', /Next: swing up to the blue beam/.test(hp.panel.textContent), hp.panel.textContent);
    check('the rooftop station gives flight', visit('fly'));
    // Fly: jump, Space again in the air, W.
    C.placeAt(new T(o[0], 0.05, -20), 0, 0);
    step(10);
    jump();
    step(12);
    jump();
    step(2);
    check('Space in the air takes off', hp.flying);
    // Up above the rooftops, heading out over the plaza.
    C.placeAt(new T(o[0], 100, -20), Math.PI, 0);
    hp.fly();
    step(30);
    const y0 = feet.y;
    input.down.add('KeyW');
    step(120);
    check('W flies you where you look, and you stay up', hspeed() > 14 && Math.abs(feet.y - y0) < 2, `${hspeed().toFixed(1)} m/s, y ${f(y0)} -> ${f(feet.y)}`);
    input.down.add('ShiftLeft');
    step(90);
    check('Shift boosts', hspeed() > 27, `${hspeed().toFixed(1)} m/s`);
    input.down.delete('ShiftLeft');
    input.down.add('KeyW');
    C.placeAt(new T(o[0], 100, -20), Math.PI, 0);
    hp.fly();
    C.pitch = -0.6;
    step(90);
    check('diving is faster still', C.velocity.length() > 32, `${C.velocity.length().toFixed(1)} m/s`);
    input.down.delete('KeyW');
    C.pitch = 0;
    step(60);
    check('let go of W and you hover', hp.flying && C.velocity.length() < 4, `${C.velocity.length().toFixed(1)} m/s`);

    // Ground slam next to a parked car.
    const cars = hp.throwables.filter((t) => t.kind === 'car');
    check('cars parked around the city', cars.length >= 12, `${cars.length}`);
    const car = cars.find((t) => Math.abs(t.entity.object3d.position.x - (o[0] - 26)) < 0.5);
    const carBody = comp(car.entity, 'RigidBodyComponent').body;
    C.placeAt(new T(o[0] - 22, 18, -10), 0, 0);
    hp.fly();
    step(2);
    input.pressed.add('crouch');
    let carUp = 0;
    for (let i = 0; i < 120; i++) { step(1); carUp = Math.max(carUp, carBody.linvel().y); }
    check('C in the air slams you down', hp.slams === 1 && !hp.flying && C.grounded, `slams ${hp.slams}`);
    check('  and the shockwave throws the car', carUp > 3, `car vy ${carUp.toFixed(1)}`);
    step(120);

    check('super strength waits until the fire and the race are done', !visit('strength') && !station('strength').beacon.visible);
    // 2. The burning building: three cats at the windows.
    check('then the burning building', em.callNext() === 'fire');
    step(1);
    for (const c of em.fire.cats) {
      check('  a cat sits on a burning window sill', c.root.visible);
      C.placeAt(new T(c.at.x + 0.3, c.at.y - 1.1, c.at.z), 0, 0);
      hp.fly();
      step(3);
    }
    check('  fly to each cat and the fire goes out', em.state.fire === 'done' && !em.fire.flames[0].visible, `state ${em.state.fire}`);
    // 3. The ring race.
    check('then the ring race', em.callNext() === 'race' && em.race.rings.length === 10);
    const ringClear = em.race.rings.every((m) => {
      const hit = game.physics.world.castShape({ x: m.position.x, y: m.position.y, z: m.position.z }, { x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: 0, z: 0 }, new RAPIER.Ball(4), 1, 0, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS | RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
      return !hit;
    });
    check('  no ring is inside a building', ringClear);
    for (const m of em.race.rings) {
      C.placeAt(new T(m.position.x, m.position.y - 1.1, m.position.z), 0, 0);
      hp.fly();
      step(30);
    }
    check('  fly every ring in time and you beat the Captain', em.state.race === 'done' && em.raceBest < 30, `${em.raceBest.toFixed(1)} s`);
    check('  then the HQ beam lights up for super strength', station('strength').beacon.visible && /Next: fly to the green beam/.test(hp.panel.textContent), hp.panel.textContent);
    check('Hero HQ roof gives super strength', visit('strength'));
    // Lift the car by the plaza and throw it.
    const car2 = cars.find((t) => Math.abs(t.entity.object3d.position.x - (o[0] + 26)) < 0.5);
    const c2 = car2.entity.object3d.position;
    C.placeAt(new T(c2.x - 4, 0.05, c2.z), 0, 0);
    step(10);
    aim(c2.x, c2.y, c2.z);
    kd('KeyE');
    step(30);
    check('E lifts a car over your head', hp.held === car2 && c2.y > feet.y + 2.5, `car y ${f(c2.y)}`);
    const from = c2.clone();
    C.pitch = 0.15;
    input.pressed.add('attack');
    step(40);
    check('click throws it', !hp.held && hp.throws === 1 && c2.distanceTo(from) > 15, `${c2.distanceTo(from).toFixed(1)} m`);
    step(60);
    // 4. The runaway bus: let it through once, then stop it.
    // Settle anything still tumbling from the throws (a flying car would stop the bus early).
    for (const t of hp.throwables) if (t !== hp.held) { const tb = comp(t.entity, 'RigidBodyComponent').body; tb.setLinvel({ x: 0, y: 0, z: 0 }, true); tb.setAngvel({ x: 0, y: 0, z: 0 }, true); }
    check('then the runaway bus', em.callNext() === 'bus');
    const busAt = () => em.bus.pos.clone();
    const b0 = busAt();
    C.placeAt(new T(o[0] - 14, 0.05, -50), 0, 0);
    step(2);
    check('  it rolls once you are near', em.bus.moving);
    step(60 * 14);
    check('  let it reach the plaza and it goes back for another try', em.fails === 2 && em.current === 'bus', `fails ${em.fails}, bus z ${f(em.bus.pos.z)}`);
    step(60 * 3);
    check('  it is back at the top of the avenue, and waits a moment', em.bus.pos.distanceTo(b0) < 0.1 && !em.bus.moving);
    C.placeAt(new T(o[0] + 10.8, 0.05, -60), Math.PI, 0);
    let stoppedAt = null;
    for (let i = 0; i < 60 * 12 && em.current === 'bus'; i++) step(1);
    stoppedAt = em.bus.pos.z;
    check('  stand in its way and you stop it with your bare hands', em.state.bus === 'done' && stoppedAt < -60 && stoppedAt > -70, `bus stopped at z ${f(stoppedAt)}`);
    // Once more, to check a thrown car stops it too.
    em.state.bus = 'waiting';
    em.bus.stopped = false;
    em.callNext();
    em.bus.pos.copy(b0);
    em.bus.wait = 0;
    C.placeAt(new T(o[0] - 10, 0.05, -60), 0, 0);
    step(60 * 2);
    const missile = cars.find((t) => t !== car2 && Math.abs(t.entity.object3d.position.z - (-24)) > 5);
    const mb = comp(missile.entity, 'RigidBodyComponent').body;
    const bp = em.bus.pos;
    mb.setTranslation({ x: bp.x, y: bp.y + 6, z: bp.z + 14 }, true);
    mb.setLinvel({ x: 0, y: -4, z: -25 }, true);
    for (let i = 0; i < 90 && em.current === 'bus'; i++) step(1);
    check('  a thrown car stops it too', em.state.bus === 'done' && !em.bus.moving, `state ${em.state.bus}`);
    check('the bus is not the end: Big Liz is next', em.step && em.step.emergency === 'liz' && !game.state.hasFlag('heroes.saved') && /SAVE HERO CITY\s+7 \/ 8/.test(hp.panel.textContent) && /Big Liz/.test(hp.panel.textContent), hp.panel.textContent);

    // 5. The finale: a storm, then a giant Big Liz up the avenue behind HQ.
    const scene = game.renderer.scene;
    const sunClear = game.renderer.sun.intensity;
    const storms = [];
    const offS = game.events.on('heroes:storm', ({ on }) => storms.push(on));
    check('then the finale: Big Liz', em.callNext() === 'liz');
    C.placeAt(new T(o[0] - 4, 0.05, -76), Math.PI, 0);
    step(60);
    check('  a storm rolls in first (and the music changes)', em.storm.on && storms.join() === 'true' && !em.kaiju.awake);
    step(60 * 4);
    check('  the sky fades to dark cloud, with rain', em.storm.level > 0.99 && scene.fog.far < 200 && game.renderer.sun.intensity < sunClear * 0.3 && em.storm.rain.visible, `level ${em.storm.level.toFixed(2)}, fog ${f(scene.fog.far)}, sun ${game.renderer.sun.intensity.toFixed(2)}`);
    const liz = em.kaiju;
    check('  Big Liz wakes up, giant, with the red beam on her', liz.awake && liz.entity.object3d.visible && liz.model.scale.x === 6 && em.beacon.visible);
    const z0 = liz.pos.z;
    step(60 * 3);
    check('  she stomps up the avenue towards you', liz.pos.z > z0 + 5, `z ${f(z0)} -> ${f(liz.pos.z)}`);
    // Too close when she stomps: thrown back.
    C.placeAt(new T(liz.pos.x + 5, 0.05, liz.pos.z + 9), 0, 0);
    step(2);
    const d0 = liz.reach(feet);
    liz.stompIn = 0.01;
    step(40);
    check('  a stomp throws you back', liz.reach(feet) > d0 + 2, `${f(d0)} -> ${f(liz.reach(feet))} m`);
    // Throw cars at her (each one is a hit).
    C.placeAt(new T(liz.pos.x - 6, 0.05, liz.pos.z + 24), 0, 0);
    let hits = 0;
    const offH = game.events.on('heroes:lizHit', () => hits++);
    const spare = cars.filter((t) => t !== hp.held).slice(0, 4);
    const miss = [];
    for (const [n, car] of spare.entries()) {
      const cb = comp(car.entity, 'RigidBodyComponent').body;
      const lp = liz.pos;
      cb.setTranslation({ x: lp.x + (n - 1.5) * 2, y: lp.y + 10, z: lp.z + 12 }, true);
      cb.setAngvel({ x: 0, y: 0, z: 0 }, true);
      cb.setLinvel({ x: 0, y: 0, z: -30 }, true);
      for (let i = 0; i < 40 && hits < n + 1; i++) step(1);
      if (hits < n + 1) miss.push(`car ${n} at ${[cb.translation().x - lp.x, cb.translation().y, cb.translation().z - lp.z].map(f).join(',')}`);
      // Out of the way of the next one.
      cb.setTranslation({ x: lp.x + 30, y: 1, z: lp.z + 40 + n * 5 }, true);
      cb.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
    check('  four thrown cars, four hits', hits === 4 && liz.hp === 20 && liz.awake, `hits ${hits}, hp ${liz.hp} ${miss.join(' ')}`);
    check('  her grumpiness bar goes down', /grumpiness/.test(em.panel.textContent), em.panel.textContent);
    // A slam by her feet finishes it... after one more car.
    C.placeAt(new T(liz.pos.x + 9, 0.05, liz.pos.z + 6), 0, 0);
    step(2);
    hp.slam(1);
    step(1);
    check('  a slam by her feet is a hit too', hits === 5 && liz.hp === 5, `hp ${liz.hp}`);
    const last = cars.find((t) => !spare.includes(t) && t !== hp.held);
    const lb = comp(last.entity, 'RigidBodyComponent').body;
    lb.setTranslation({ x: liz.pos.x, y: liz.pos.y + 9, z: liz.pos.z + 12 }, true);
    lb.setLinvel({ x: 0, y: 0, z: -30 }, true);
    for (let i = 0; i < 40 && !liz.calmed; i++) step(1);
    check('  she calms down', liz.calmed && em.state.liz === 'done' && storms.join() === 'true,false', `hp ${liz.hp}`);
    step(60 * 5);
    check('  and shrinks back to her normal size', liz.model.scale.x === 1, `${liz.model.scale.x.toFixed(2)}`);
    check('  the storm clears and the sun comes back', em.storm.level === 0 && Math.abs(game.renderer.sun.intensity - sunClear) < 0.01 && !em.storm.rain.visible && scene.fog.far > 400);
    offS();
    offH();
    check('every step done: Hero city is saved', em.done === 5 && em.step === null && game.state.hasFlag('heroes.saved') && /HERO CITY SAVED/.test(hp.panel.textContent), hp.panel.textContent);
    check('the rescued cats wait in the basket', hp.saved === 4, `${hp.saved}`);

    // No fall damage: drop off a tall roof.
    const health = comp(player, 'Damageable') ?? comp(player, 'Health');
    const before = health?.health;
    C.placeAt(new T(o[0] + 36, 60, -84), 0, 0);
    step(200);
    check('no fall damage', health && health.health === before && feet.y < 2, `health ${before} -> ${health?.health}, y ${f(feet.y)}`);

    // Captain Whiskers.
    const lines = [];
    const offL = game.events.on('dialogue:line', (l) => lines.push(l));
    const dlg = game.getSystem('dialogue');
    const talk = () => {
      lines.length = 0;
      const e = game.world.find('captain_whiskers');
      const p = e.object3d.position;
      C.placeAt(new T(p.x + 1.4, 0.05, p.z + 1.4), 0, 0);
      step(2);
      comp(e, 'Interactable').interact(player);
      step(2);
      const first = lines[0];
      dlg.end();
      step(2);
      return first;
    };
    talk();
    const cw = talk();
    check('Captain Whiskers thanks you once the city is saved', !!cw && /official hero/.test(cw.text), cw ? cw.text.slice(0, 60) : 'nothing');
    offL();

    // Powers stay in Hero city.
    teleports.goHub();
    step(10);
    const pc = comp(player, 'PlayerCombat');
    check('the other worlds keep their own sky', Math.abs(game.renderer.sun.intensity - sunClear) < 0.01);
    check('powers switch off outside Hero city, fists back on', C.cfg.jumpHeight === 1.25 && C.cfg.gravity === 24 && pc.enabled && teleports.current === 'hub');
    C.placeAt(new T(pad.position[0], 0.14, pad.position[2] + 2.2), 0, 0);
    step(5);
    C.placeAt(new T(pad.position[0], 0.14, pad.position[2]), 0, 0);
    step(30);
    check('and come back when you return', teleports.current === 'heroes' && C.cfg.jumpHeight === 8 && !pc.enabled, `jumpHeight ${C.cfg.jumpHeight}`);
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
    const aimFrom = `(x, y, z, tx, ty, tz) => { const { C, T, step, aim } = X; C.placeAt(new T(x, y, z), 0, 0); step(5); aim(tx, ty, tz); }`;
    await shot('heroes-arrival', `(${aimFrom})(3000, 0.05, 8, 3000, 14, -50)`);
    await shot('heroes-stations', `(${aimFrom})(3000 - 2, 0.05, 4, 3000, 1, -3)`);
    await shot('heroes-captain', `(${aimFrom})(3000 - 11.5, 0.05, 7.5, 3000 - 14, 1.2, 3.5)`);
    await shot('heroes-skyline', `(${aimFrom})(3000 + 20, 45, 20, 3000, 30, -80)`);
    await shot('heroes-hq-top', `(${aimFrom})(3000 + 6, 80.05, -52, 3000 - 30, 0, 10)`);
    await shot('heroes-swing', `(() => { const { C, T, step, aim } = X; const hp = game.getSystem('hero-powers'); C.placeAt(new T(3000 + 3, 0.05, -14), 0, 0); step(5); aim(3000 + 3, 8, -40); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG' })); hp.swingFrom(C, hp.findAnchor(C)); step(25); })()`);
    await shot('heroes-fly', `(() => { const { C, T, step } = X; window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyG' })); const hp = game.getSystem('hero-powers'); C.placeAt(new T(3000 + 30, 75, 30), 0.3, 0); hp.fly(); C.pitch = -0.3; game.input.down.add('KeyW'); game.input.down.add('ShiftLeft'); step(60); })()`);
    await shot('heroes-lift', `(() => { const { C, T, step, aim } = X; const hp = game.getSystem('hero-powers'); game.input.down.clear(); const car = hp.throwables.find((t) => t.kind === 'car' && !hp.held); C.placeAt(new T(3000 + 16, 0.05, -24), 0, 0); step(5); hp.pickUp(car); step(20); C.pitch = 0.05; step(2); })()`);
    await shot('heroes-fire', `(() => { const { C, T, step, aim } = X; game.input.down.clear(); const hp = game.getSystem('hero-powers'); const em = game.getSystem('hero-emergencies'); if (hp.held) hp.drop(new T()); em.state.fire = 'waiting'; em.current = null; em.callNext(); step(1); const c = em.fire.cats[1].at; C.placeAt(new T(c.x + 16, c.y - 4, c.z + 6), 0, 0); hp.fly(); step(2); aim(c.x, c.y, c.z); })()`);
    await shot('heroes-race', `(() => { const { C, T, step, aim } = X; const hp = game.getSystem('hero-powers'); const em = game.getSystem('hero-emergencies'); em.current = null; em.state.fire = 'done'; em.state.race = 'waiting'; em.callNext(); step(1); C.placeAt(new T(3000, 8, 8), 0, 0); hp.fly(); step(2); const r = em.race.rings[1].position; aim(r.x, r.y, r.z); })()`);
    await shot('heroes-bus', `(() => { const { C, T, step, aim } = X; const em = game.getSystem('hero-emergencies'); em.current = null; em.state.race = 'done'; em.state.bus = 'waiting'; em.callNext(); em.bus.stopped = false; em.bus.pos.set(3000 + 10.8, 1.6, -135); em.bus.wait = 0; C.placeAt(new T(3000 + 10.8, 0.05, -28), Math.PI, 0); step(60 * 6); const b = em.bus.pos; aim(b.x, 1.5, b.z); })()`);
    await shot('heroes-liz', `(() => { const { C, T, step, aim } = X; const em = game.getSystem('hero-emergencies'); em.current = null; em.state.bus = 'done'; em.state.liz = 'waiting'; em.kaiju.calmed = false; em.kaiju.shrink = 0; em.callNext(); game.getSystem('hero-powers').render(); step(60 * 9); const l = em.kaiju.pos; C.placeAt(new T(l.x - 14, 0.05, l.z + 34), 0, 0); step(2); aim(l.x, 12, l.z); })()`);
    await shot('heroes-kitten', `(() => { const { C, T, step, aim } = X; const em = game.getSystem('hero-emergencies'); em.current = null; em.state.bus = 'done'; em.state.kitten = 'waiting'; em.callNext(); const k = em.kitten.root.position; C.placeAt(new T(k.x - 30, 0.05, k.z + 12), 0, 0); step(60 * 3.5); aim(k.x, k.y, k.z); })()`);
  }

  r.push(`${errors.length ? 'FAIL' : 'PASS'}  no errors  ${errors.slice(0, 3).join(' | ')}`);
  console.log(r.join('\n'));
  await browser.close();
  process.exit(r.some((l) => l.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => {
  console.log('FAIL  crashed: ' + e.message);
  process.exit(1);
});
