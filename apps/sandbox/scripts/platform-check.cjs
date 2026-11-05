// Moving-platform regression check: walk into platform sides and off platform edges at random
// times and report any case where the player gets stuck. Start `npm run dev` first, then:
// node scripts/platform-check.cjs
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
  page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
  await page.goto('http://localhost:5173/');
  await page.waitForFunction(() => window.game && window.game.world.find('player'), null, { timeout: 30000 });
  const out = await page.evaluate(() => {
    game.stop();
    const C = game.world.find('player').getAll()[1];
    const RB = game.world.find('player').getAll()[0];
    const T = RB.entity.object3d.position.constructor;
    const step = (n) => { for (let i = 0; i < n; i++) game.fixedStep(1/60); };
    const down = (c) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c }));
    const up = (c) => window.dispatchEvent(new KeyboardEvent('keyup', { code: c }));
    const bp = (n) => game.world.find(n).getAll()[0].body.translation();
    const tp = (x,y,z,yaw=0) => { RB.teleport(new T(x,y,z)); C.velocity.set(0,0,0); C.yaw = yaw; C.groundCarrier = null; };
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const plats = ['platform-horizontal','platform-elevator','platform-diagonal','platform-orbit','platform-loop','platform-spinner'];
    const res = []; let fails = 0, total = 0;
    const flat = (p) => Math.hypot(p.x, p.z) < 50;
    for (const n of plats) {
      let f = 0;
      for (let t = 0; t < 30; t++) {
        step(Math.floor(rnd() * 400));
        const b = bp(n);
        const ang = rnd() * Math.PI * 2, d = 3.2 + rnd();
        const x = b.x + Math.cos(ang) * d, z = b.z + Math.sin(ang) * d;
        tp(x, 0.1, z, 0); step(5);
        { const cc = RB.colliders[0]; const hitStatic = game.physics.world.intersectionWithShape(cc.translation(), cc.rotation(), new (cc.shape.constructor)(cc.halfHeight(), 0.6), undefined, undefined, cc, RB.body, (o) => o.parent() && o.parent().isFixed() && game.physics.ownerOf(o)?.name !== 'terrain'); if (hitStatic) continue; }
        // face the platform
        const yawTo = Math.atan2(-(b.x - x), -(b.z - z)); C.yaw = yawTo;
        down('KeyW'); step(60); up('KeyW');
        const onIt = !!C.groundCarrier || C.feetPosition.y > 0.3;
        if (onIt) continue; // stepped/rode onto it: not a side test
        total++;
        // try to back away and strafe
        const p0 = C.feetPosition.clone();
        const trace = [];
        down('KeyS'); for (let i = 0; i < 36; i++) { step(1); if (i % 6 === 0) { const p = C.feetPosition; const kc=[]; for (let k=0;k<C.kcc.numComputedCollisions();k++){const cc=C.kcc.computedCollision(k); if (game.physics.ownerOf(cc.collider)?.name==='terrain') continue; kc.push(game.physics.ownerOf(cc.collider)?.name+':'+[cc.normal1.x,cc.normal1.y,cc.normal1.z].map(v=>v.toFixed(2)).join(','));} trace.push(`[${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)} v=${C.velocity.x.toFixed(1)},${C.velocity.z.toFixed(1)} ign=${0} g=${C.grounded} ${kc.join(';')}]`); } } up('KeyS');
        const p1 = C.feetPosition.clone();
        down('KeyA'); step(36); up('KeyA');
        const p2 = C.feetPosition.clone();
        const back = Math.hypot(p1.x - p0.x, p1.z - p0.z), side = Math.hypot(p2.x - p1.x, p2.z - p1.z);
        if (back < 1.2 || side < 1.2) { f++; fails++; if (f <= 2) res.push(`  STUCK ${n} back=${back.toFixed(2)} side=${side.toFixed(2)} y=${p0.y.toFixed(2)}/${p1.y.toFixed(2)} grounded=${C.grounded} carrier=${!!C.groundCarrier} plat=${JSON.stringify(bp(n))}\n    ${trace.join('\n    ')}`); }
      }
      res.push(`${n}: side fails ${f}`);
    }
    // edge walk-off stickiness: ride, then walk off; record frames with relative speed < 2.5 after 0.25s
    for (const n of plats) {
      let sticky = 0, trials = 0;
      for (let t = 0; t < 16; t++) {
        step(Math.floor(rnd() * 300));
        const b = bp(n); tp(b.x, b.y + 0.3, b.z, rnd() * Math.PI * 2); step(30);
        if (!C.groundCarrier) continue;
        trials++;
        down('KeyW'); let prev = C.feetPosition.clone(), prevB = { ...bp(n) }; let slow = 0;
        for (let i = 0; i < 70; i++) {
          step(1);
          const p = C.feetPosition, q = bp(n);
          const rel = Math.hypot((p.x - prev.x) - (q.x - prevB.x), (p.z - prev.z) - (q.z - prevB.z)) * 60;
          const abs = Math.hypot(p.x - prev.x, p.z - prev.z) * 60;
          const speed = C.groundCarrier ? rel : abs;
          if (i > 15 && speed < 2.5 && C.grounded && n !== 'platform-spinner') slow++;
          prev = p.clone(); prevB = { ...q };
        }
        up('KeyW'); step(20);
        if (slow > 3) { sticky++; res.push(`  STICKY-EDGE ${n} pos=${C.feetPosition.toArray().map(v=>v.toFixed(2))} slowFrames=${slow} y=${C.feetPosition.y.toFixed(2)} carrier=${!!C.groundCarrier}`); }
      }
      res.push(`${n}: edge sticky ${sticky}/${trials}`);
    }
    return res.join('\n');
  });
  console.log(out);
  await browser.close();
})();
