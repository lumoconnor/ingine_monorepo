// Procedural world check. Start `npm run dev` first, then: node scripts/worldgen-check.cjs
// (or `npm run check -- worldgen`). Covers: same seed = same world, the streamed
// heightfield colliders match the height map exactly, the player spawns on the
// ground and can walk and teleport across chunks, and detail streams in.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
  page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
  const base = (process.env.URL || 'http://localhost:5173/').replace(/\/?$/, '/');
  // SEED=n checks another world (the default seed is what CI checks).
  await page.goto(base + '?level=world' + (process.env.SEED ? '&seed=' + process.env.SEED : ''));
  await page.waitForFunction(() => window.game && window.game.world.find('player') && window.worldgen, null, { timeout: 60000 });
  const out = await page.evaluate(async () => {
    game.stop();
    const r = [];
    const check = (label, ok, extra = '') => r.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
    const map = worldgen.map;
    const player = game.world.find('player');
    const comp = (e, n) => e.getAll().find((c) => c.constructor.name === n);
    const C = comp(player, 'PlayerController');
    const streamer = comp(game.world.find('terrain'), 'TerrainStreamer');
    const V = player.object3d.position.constructor;
    const step = (n) => { for (let i = 0; i < n; i++) game.fixedStep(1 / 60); };
    const down = (c) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c }));
    const up = (c) => window.dispatchEvent(new KeyboardEvent('keyup', { code: c }));
    const above = () => C.feetPosition.y - map.heightAt(C.feetPosition.x, C.feetPosition.z);

    // 1. Determinism
    const { generateWorld } = await import('/src/levels/world/WorldGen.ts');
    const again = generateWorld({ seed: map.seed });
    const other = generateWorld({ seed: map.seed + 1 });
    check('same seed builds the same world', again.checksum() === map.checksum() && again.spawn.equals(map.spawn), `checksum=${map.checksum()}`);
    check('another seed builds a different world', other.checksum() !== map.checksum());
    check('generation is quick enough', map.genMs < 8000, `genMs=${map.genMs.toFixed(0)}`);

    step(1); // let the broad phase see the colliders built at load
    // 2. Colliders match the height map (same triangles, right orientation)
    const R = game.physics.world;
    let worst = 0, misses = 0;
    const sp = map.spawn;
    // Only the ground: skip tree trunks.
    const trunkBodies = new Set([...comp(game.world.find('forest'), 'Forest').bodies.values()].map((b) => b.handle));
    const groundOnly = (col) => !trunkBodies.has(col.parent()?.handle);
    for (let i = 0; i < 300; i++) {
      const x = sp.x + (Math.sin(i * 12.9898) * 0.5) * 220;
      const z = sp.z + (Math.cos(i * 78.233) * 0.5) * 220;
      const top = 600;
      const hit = R.castRay({ origin: { x, y: top, z }, dir: { x: 0, y: -1, z: 0 } }, 1000, true, undefined, undefined, undefined, undefined, groundOnly);
      if (!hit) { misses++; continue; }
      worst = Math.max(worst, Math.abs(top - hit.timeOfImpact - map.heightAt(x, z)));
    }
    check('heightfield colliders match the height map', misses === 0 && worst < 0.02, `worst=${worst.toFixed(4)} misses=${misses}`);

    // 3. Spawn
    step(120);
    check('spawns standing on the ground', C.grounded && Math.abs(above()) < 0.15, `above=${above().toFixed(3)} state=${C.state}`);

    // 4. Sprint across the land for 20 s, crossing chunk borders
    const start = C.feetPosition.clone();
    let lowest = Infinity, groundedFrames = 0;
    down('KeyW'); down('ShiftLeft');
    for (let i = 0; i < 1200; i++) {
      if (i % 240 === 0) C.yaw += 0.6;
      step(1);
      lowest = Math.min(lowest, above());
      if (C.grounded) groundedFrames++;
    }
    up('KeyW'); up('ShiftLeft'); step(30);
    const travelled = Math.hypot(C.feetPosition.x - start.x, C.feetPosition.z - start.z);
    check('walks across chunks without sinking', lowest > -0.3 && travelled > 60 && groundedFrames > 900,
      `travelled=${travelled.toFixed(0)}m lowest=${lowest.toFixed(3)} grounded=${groundedFrames}/1200 colliders=${streamer.colliderCount}`);

    // 5. Teleport far away: the collider there must exist before the player falls
    const far = [[-640, -560], [700, 520], [-300, 820]];
    for (const [x, z] of far) {
      C.placeAt(new V(x, map.heightAt(x, z) + 0.05, z), 0, 0);
      step(90);
      check(`teleport to (${x}, ${z}) lands on the ground`, Math.abs(above()) < 0.2 && C.feetPosition.y > -50, `above=${above().toFixed(3)} grounded=${C.grounded}`);
    }

    // 6. Detail streams in around the new position
    for (let i = 0; i < 400 && (streamer.pending || i < 2); i++) streamer.update({ delta: 1 / 60, elapsed: 0, alpha: 0 });
    const p = C.feetPosition;
    check('nearest chunk is at full detail after streaming', streamer.lodAt(p.x, p.z) === 0 && streamer.pending === 0, `lod=${streamer.lodAt(p.x, p.z)} pending=${streamer.pending}`);
    check('colliders are dropped far behind', streamer.colliderCount <= 16, `colliders=${streamer.colliderCount}`);

    // 8. Water: a lake, rivers that only run downhill and end in it, waterfalls
    const H = map.hydro;
    const live = H.rivers.filter((r) => r.points.length);
    let downhill = true, banked = true;
    for (const r of live) for (let i = 1; i < r.points.length; i++) if (r.points[i].level > r.points[i - 1].level + 1e-4) downhill = false;
    // (The foot of a waterfall is a rock face, so skip the few samples around each step.)
    for (const r of live) r.points.forEach((q, i) => {
      const up = r.points[Math.max(0, i - 4)], dn = r.points[Math.min(r.points.length - 1, i + 4)];
      if (up.level - dn.level < 1 && map.heightAt(q.x, q.z) > q.level - 0.3) banked = false;
    });
    const reach = live.filter((r) => r.joins === -1).every((r) => Math.abs(r.points.at(-1).level - H.lake.level) < 0.01);
    check('there is a lake', !!H.lake && H.lake.area > 5000, H.lake ? `area=${Math.round(H.lake.area)}m2 level=${H.lake.level.toFixed(1)}` : '');
    check('rivers run downhill into the lake', live.length >= 2 && downhill && reach, `rivers=${live.length}`);
    check('river beds are under their water', banked);
    check('there are waterfalls', H.falls.length >= 1 && H.falls.every((f) => f.drop > 1.5), `falls=${H.falls.length} tallest=${Math.max(...H.falls.map((f) => f.drop)).toFixed(0)}m`);
    const w0 = map.water.sample(map.spawn.x, map.spawn.y, map.spawn.z, 0);
    check('spawn is dry', !w0);

    // 9. Swim in the lake, get carried by a river
    C.placeAt(new V(H.lake.x, H.lake.level - 0.6, H.lake.z), 0, 0);
    step(120);
    check('swims in the lake', C.swimming && Math.abs(C.feetPosition.y - (H.lake.level - 1.4)) < 0.5, `state=${C.state} feet=${C.feetPosition.y.toFixed(2)} surface=${H.lake.level.toFixed(2)}`);
    const big = live.reduce((a, b) => (b.points.length > a.points.length ? b : a));
    // A calm stretch: no falls nearby.
    let ri = -1;
    for (let i = 40; i < big.points.length - 80 && ri < 0; i += 5) {
      if (big.points[i].level - big.points[i + 40].level < 1 && big.points[i - 20].level - big.points[i].level < 0.5 && big.points[i].width > 6) ri = i;
    }
    const a = big.points[ri], b = big.points[ri + 40];
    C.placeAt(new V(a.x, a.level - 0.5, a.z), 0, 0);
    step(360);
    const p2 = C.feetPosition;
    const along = ((p2.x - a.x) * (b.x - a.x) + (p2.z - a.z) * (b.z - a.z)) / Math.hypot(b.x - a.x, b.z - a.z);
    check('a river carries you downstream', along > 0.8 && C.waterDepth > 0, `drift=${along.toFixed(1)}m depth=${C.waterDepth.toFixed(2)} state=${C.state}`);

    // 10. Sites, roads and bridges
    const sites = map.sites, net = map.net;
    const kinds = (k) => sites.filter((x) => x.kind === k).length;
    check('sites: a town, villages, camps and ruins', kinds('town') === 1 && kinds('village') >= 3 && kinds('camp') >= 2 && kinds('ruin') >= 2,
      sites.map((x) => x.id).join(' '));
    const dry = sites.every((x) => !map.water.sample(x.x, x.y + 0.2, x.z, 0));
    const flat = sites.every((x) => [0, 1, 2, 3].every((k) => Math.abs(map.heightAt(x.x + Math.cos(k * 1.57) * x.radius * 0.8, x.z + Math.sin(k * 1.57) * x.radius * 0.8) - x.y) < 0.6));
    check('sites stand on dry, level ground', dry && flat);
    const linked = new Set(net.roads.flatMap((r) => [r.from, r.to]));
    check('every site is on the road network', sites.every((x) => linked.has(x.id)) && linked.has('spawn'), `roads=${net.roads.length}`);
    let worstRoad = 0, worstPath = 0, off = 0;
    for (const r of net.roads) for (let i = 1; i < r.points.length; i++) {
      const a = r.points[i - 1], b = r.points[i];
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      if (d < 0.5) continue;
      const g = Math.abs(b.y - a.y) / d;
      if (r.kind === 'road') worstRoad = Math.max(worstRoad, g); else worstPath = Math.max(worstPath, g);
      if (!b.bridge) off = Math.max(off, Math.abs(map.heightAt(b.x, b.z) - b.y));
    }
    check('roads are gentle and paths are walkable', worstRoad < 0.3 && worstPath < 0.75, `steepest road=${(worstRoad * 100).toFixed(0)}% path=${(worstPath * 100).toFixed(0)}%`);
    check('roads are pressed into the ground', off < 0.05, `worst=${off.toFixed(3)}`);
    check('there are bridges, above the water', net.bridges.length >= 1 && net.bridges.every((b) => b.y > b.water + 0.8), `bridges=${net.bridges.length}`);
    // Walk over the first bridge (some seeds have none).
    const br = net.bridges[0];
    if (br) {
    const bl = Math.hypot(br.bx - br.ax, br.bz - br.az), ux = (br.bx - br.ax) / bl, uz = (br.bz - br.az) / bl;
    const s0x = br.ax - ux * 4, s0z = br.az - uz * 4;
    C.placeAt(new V(s0x, Math.max(map.heightAt(s0x, s0z), br.y) + 0.3, s0z), Math.atan2(-ux, -uz), 0);
    step(30);
    let minY = Infinity, wet = false;
    down('KeyW');
    for (let i = 0; i < 60 * 12; i++) {
      step(1);
      C.yaw = Math.atan2(-ux, -uz);
      const p = C.feetPosition;
      const along = (p.x - br.ax) * ux + (p.z - br.az) * uz;
      if (along > 1 && along < bl - 1) minY = Math.min(minY, p.y);
      if (C.waterDepth > 0.2) wet = true;
      if (along > bl + 4) break;
    }
    up('KeyW');
    const endAlong = (C.feetPosition.x - br.ax) * ux + (C.feetPosition.z - br.az) * uz;
    check('you can walk across a bridge and stay dry', endAlong > bl + 2 && !wet && minY > br.water, `crossed=${endAlong.toFixed(1)}/${bl.toFixed(1)}m deckMin=${minY.toFixed(2)} water=${br.water.toFixed(2)}`);
    }

    // 11. Villages and the town
    const S = map.settlements;
    const townS = S.find((x) => x.site.startsWith('town'));
    check('every village and the town is built', S.length === sites.filter((x) => x.kind === 'village' || x.kind === 'town').length
      && townS.buildings.length >= 18 && S.every((x) => x.buildings.length >= 5 && x.villagers.length >= 3),
      S.map((x) => `${x.site}:${x.template}:${x.buildings.length}`).join(' '));
    // Rectangles: corners, and a separating-axis overlap test.
    const corners = (b, m = 0) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => {
      const lx = sx * (b.w / 2 + m), lz = sz * (b.d / 2 + m);
      return [b.x + lx * Math.cos(b.yaw) + lz * Math.sin(b.yaw), b.z - lx * Math.sin(b.yaw) + lz * Math.cos(b.yaw)];
    });
    const overlap = (A, B) => {
      for (const P of [A, B]) for (let i = 0; i < 4; i++) {
        const [x0, z0] = P[i], [x1, z1] = P[(i + 1) % 4];
        const nx = z0 - z1, nz = x1 - x0;
        const proj = (Q) => Q.map(([x, z]) => x * nx + z * nz);
        const a = proj(A), b = proj(B);
        if (Math.max(...a) <= Math.min(...b) || Math.max(...b) <= Math.min(...a)) return false;
      }
      return true;
    };
    const inside = (b, x, z, m = 0) => {
      const dx = x - b.x, dz = z - b.z;
      const lx = dx * Math.cos(b.yaw) - dz * Math.sin(b.yaw), lz = dx * Math.sin(b.yaw) + dz * Math.cos(b.yaw);
      return Math.abs(lx) < b.w / 2 + m && Math.abs(lz) < b.d / 2 + m;
    };
    let clashes = 0, onRoad = 0, wet2 = 0;
    for (const st of S) {
      const bs = st.buildings;
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) if (overlap(corners(bs[i], 0.4), corners(bs[j], 0.4))) clashes++;
      for (const b of bs) {
        if (map.water.sample(b.x, b.floorY + 0.2, b.z, 0)) wet2++;
        for (const r of net.roads) for (const q of r.points) if (!q.bridge && inside(b, q.x, q.z, r.width / 2 - 0.5)) { onRoad++; break; }
      }
    }
    check('buildings stand apart, off the roads and out of the water', clashes === 0 && onRoad === 0 && wet2 === 0, `overlaps=${clashes} onRoad=${onRoad} wet=${wet2}`);
    // Town walls leave the roads open (gates), and no building sits outside them.
    let blockedRoads = 0;
    for (const st of S) for (const w of st.walls) {
      const [ax, az] = w.from, [bx, bz] = w.to;
      const l2 = (bx - ax) ** 2 + (bz - az) ** 2;
      for (const r of net.roads) for (const q of r.points) {
        const t = Math.max(0, Math.min(1, ((q.x - ax) * (bx - ax) + (q.z - az) * (bz - az)) / l2));
        if (Math.hypot(q.x - ax - (bx - ax) * t, q.z - az - (bz - az) * t) < w.thickness / 2 + r.width / 2) blockedRoads++;
      }
    }
    check('town walls have gates where the roads come in', blockedRoads === 0, `${townS.template} walls=${townS.walls.length} towers=${townS.towers.length} blocked=${blockedRoads}`);

    // Walk in through a front door.
    const house = townS.buildings.find((b) => b.enterable && b.kind !== 'keep' && b.kind !== 'hall');
    const doorE = game.world.find('door:' + house.id);
    const fx = house.front[0], fz = house.front[1];
    C.placeAt(new V(fx, map.heightAt(fx, fz) + 0.05, fz), Math.atan2(-(house.x - fx), -(house.z - fz)), 0);
    step(20);
    comp(doorE, 'Door').activate('toggle', player);
    step(60);
    down('KeyW');
    for (let i = 0; i < 150; i++) { C.yaw = Math.atan2(-(house.x - C.feetPosition.x), -(house.z - C.feetPosition.z)); step(1); if (inside(house, C.feetPosition.x, C.feetPosition.z, -1)) break; }
    up('KeyW');
    step(20);
    const inHouse = inside(house, C.feetPosition.x, C.feetPosition.z, -0.3);
    check('you can open a door and walk into a house', inHouse && Math.abs(C.feetPosition.y - house.floorY) < 0.2,
      `${house.kind} inside=${inHouse} feet=${C.feetPosition.y.toFixed(2)} floor=${house.floorY.toFixed(2)}`);

    // Villagers walk their rounds on the ground; guards and merchants stand.
    C.placeAt(new V(townS.square.x + 4, map.heightAt(townS.square.x + 4, townS.square.z) + 0.05, townS.square.z), 0, 0);
    const people = game.world.all().filter((e) => e.name.startsWith('npc:' + townS.site));
    const walkers = people.map((e) => comp(e, 'Wander')).filter(Boolean);
    const startW = walkers.map((w) => w.walked);
    let worstFeet = 0;
    for (let i = 0; i < 900; i++) {
      step(1);
      if (i % 60 === 0) for (const e of people) {
        const p = comp(e, 'RigidBodyComponent').body.translation();
        worstFeet = Math.max(worstFeet, Math.abs(p.y - map.heightAt(p.x, p.z)));
      }
    }
    const moved = walkers.filter((w, i) => w.walked - startW[i] > 3).length;
    check('villagers walk about the town, feet on the ground', walkers.length >= 5 && moved >= walkers.length * 0.6 && worstFeet < 0.3,
      `people=${people.length} walkers=${walkers.length} moved=${moved} feetErr=${worstFeet.toFixed(2)}`);
    // Chat names the place.
    const talker = people.find((e) => comp(e, 'Npc').dialogue === 'villager-a') ?? people.find((e) => comp(e, 'Npc').dialogue.startsWith('villager'));
    let line = null;
    const unsub = game.events.on('dialogue:line', (l) => { if (!line) line = l; });
    const npcC = comp(talker, 'Npc');
    const tp = comp(talker, 'RigidBodyComponent').body.translation();
    C.placeAt(new V(tp.x + 1.5, tp.y + 0.05, tp.z), Math.PI / 2, 0);
    step(2);
    game.getSystem('dialogue').start(npcC.dialogue, talker, npcC);
    game.getSystem('dialogue').end();
    unsub();
    const placeName = sites.find((x) => x.id === townS.site).name;
    check('villagers talk about where they live', !!line && line.speaker === npcC.displayName && /\{/.test(line.text) === false && (line.text.includes(placeName) || npcC.dialogue !== 'villager-a'),
      line ? `${line.speaker}: "${line.text}"` : 'no line');

    // 12. Bandit camps and ruined fortresses
    const O = map.outposts;
    const camps = O.filter((o) => o.kind === 'camp'), ruins = O.filter((o) => o.kind === 'ruin');
    check('camps and ruins are built and guarded', camps.length === kinds('camp') && ruins.length === kinds('ruin')
      && camps.every((o) => o.tents.length >= 3 && o.walls.length >= 8 && o.fire && o.lookout && o.chest && o.guards.length >= 3)
      && ruins.every((o) => o.walls.length >= 10 && o.towers.length === 4 && o.chest && o.guards.length >= 3),
      O.map((o) => `${o.site}:${o.kind === 'camp' ? o.tents.length + 'tents' : o.towers.length + 'towers'}/${o.guards.length}guards`).join(' '));
    let shut = 0;
    for (const o of O) for (const w of o.walls) {
      const [ax, az] = w.from, [bx, bz] = w.to;
      const l2 = (bx - ax) ** 2 + (bz - az) ** 2;
      for (const r of net.roads) for (const q of r.points) {
        const t = Math.max(0, Math.min(1, ((q.x - ax) * (bx - ax) + (q.z - az) * (bz - az)) / l2));
        if (Math.hypot(q.x - ax - (bx - ax) * t, q.z - az - (bz - az) * t) < w.thickness / 2 + r.width / 2 - 0.3) shut++;
      }
    }
    check('palisades and ruined walls leave the path in open', shut === 0, `blocked=${shut}`);
    // Far-off bandits sleep (no ground under them out there); near ones wake on their feet.
    const dorm = comp(game.world.find('world-minder'), 'Dormancy');
    const enemyAt = (id) => game.world.find(id);
    const camp0 = camps[0];
    const site0 = sites.find((x) => x.id === camp0.site);
    const away = Math.atan2(site0.z - camp0.lookout.z, site0.x - camp0.lookout.x);
    const ox = site0.x + Math.cos(away) * 60, oz = site0.z + Math.sin(away) * 60;
    C.placeAt(new V(ox, map.heightAt(ox, oz) + 0.05, oz), 0, 0);
    step(90);
    let worstStand = 0;
    for (const g of camp0.guards) {
      const p = comp(enemyAt(g.id), 'RigidBodyComponent').body.translation();
      worstStand = Math.max(worstStand, Math.abs(p.y - g.y));
    }
    const farAsleep = O.filter((o) => o !== camp0).every((o) => o.guards.every((g) => {
      const e = enemyAt(g.id);
      const p = comp(e, 'RigidBodyComponent').body.translation();
      return Math.hypot(p.x - ox, p.z - oz) < 130 || !comp(e, 'EnemyBrain').enabled;
    }));
    check('bandits sleep far away and wake standing at their posts', farAsleep && dorm.awake >= camp0.guards.length && worstStand < 0.35,
      `awake=${dorm.awake} worst=${worstStand.toFixed(2)}`);
    // Walk into the camp: they come for you. (Senses read the drawn positions, so draw frames too.)
    let tFrame = 0;
    const stepDrawn = (n) => { for (let i = 0; i < n; i++) { game.fixedStep(1 / 60); tFrame += 1 / 60; game.world.update({ delta: 1 / 60, elapsed: tFrame, alpha: 1 }); } };
    C.placeAt(new V(site0.x + 1.5, map.heightAt(site0.x + 1.5, site0.z) + 0.05, site0.z), 0, 0);
    let engaged = 0;
    const pd = comp(player, 'Damageable');
    let hurt = 0;
    for (let i = 0; i < 240; i++) {
      stepDrawn(1);
      // Don't let the test die (a respawn would upset the checks after this one).
      if (!pd.dead) {
        hurt += pd.maxHealth - pd.health;
        pd.heal(1000);
      }
      if (i % 30 === 0) engaged = Math.max(engaged, camp0.guards.filter((g) => comp(enemyAt(g.id), 'EnemyBrain').activity === 'engage').length);
    }
    // (A musket ball can still drop you in one go: wait for the respawn.)
    for (let i = 0; i < 1200 && pd.dead; i++) step(1);
    check('walk into a camp and the bandits fight', engaged >= 2, `engaged=${engaged} damage taken=${hurt.toFixed(0)}`);
    // The lookout deck holds you.
    const lk = camp0.lookout;
    C.placeAt(new V(lk.x, lk.y + lk.deck + 0.3, lk.z), 0, 0);
    step(60);
    check('you can stand on the lookout', Math.abs(C.feetPosition.y - (lk.y + lk.deck)) < 0.15, `feet=${C.feetPosition.y.toFixed(2)} deck=${(lk.y + lk.deck).toFixed(2)}`);
    C.placeAt(new V(map.spawn.x, map.spawn.y, map.spawn.z), 0, 0);
    step(30);

    // 13. Forests: plenty of trees, kept off roads, sites and water
    const trees = map.trees;
    const treeKinds = [0, 1, 2].map((k) => trees.filter((t) => t.kind === k).length);
    check('forests are planted (pines, oaks, bushes)', trees.length > 10000 && treeKinds.every((n) => n > 500), `pines=${treeKinds[0]} oaks=${treeKinds[1]} bushes=${treeKinds[2]}`);
    const roadCells = new Map();
    for (const rd of map.net.roads) for (const q of rd.points) {
      const k = `${Math.floor(q.x / 8)},${Math.floor(q.z / 8)}`;
      if (!roadCells.has(k)) roadCells.set(k, []);
      roadCells.get(k).push({ x: q.x, z: q.z, w: rd.width ?? 3 });
    }
    let tOnRoad = 0, inSite = 0, wet = 0;
    for (const t of trees) {
      const cx = Math.floor(t.x / 8), cz = Math.floor(t.z / 8);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        for (const q of roadCells.get(`${cx + dx},${cz + dz}`) ?? []) if (Math.hypot(q.x - t.x, q.z - t.z) < q.w / 2) tOnRoad++;
      }
      if (map.sites.some((s) => Math.hypot(s.x - t.x, s.z - t.z) < s.radius)) inSite++;
      if (map.water.sample(t.x, t.y + 0.3, t.z, 0)) wet++;
    }
    check('no trees on roads, in sites or in water', tOnRoad + inSite + wet === 0, `road=${tOnRoad} site=${inSite} water=${wet}`);
    // Trunks are solid near you: walk straight at a lone tree. You slide round the bark, never through it.
    const forest = comp(game.world.find('forest'), 'Forest');
    const near = (t, r) => trees.some((u) => u !== t && Math.abs(u.x - t.x) < r && Math.abs(u.z - t.z) < r);
    const lone = trees.find((t) => t.kind !== 2 && Math.hypot(t.x - sp.x, t.z - sp.z) > 30 && !near(t, 6) &&
      Math.abs(map.heightAt(t.x + 4, t.z) - t.y) < 0.6 && !map.water.sample(t.x + 4, t.y + 0.3, t.z, 0));
    const trunkR = (lone.kind === 0 ? 0.24 : 0.32) * lone.scale;
    C.placeAt(new V(lone.x + 4, map.heightAt(lone.x + 4, lone.z) + 0.05, lone.z), Math.PI / 2, 0);
    step(30);
    const nearColliders = forest.colliderCount;
    const bark = R.castRay({ origin: { x: lone.x + 3, y: lone.y + 1, z: lone.z }, dir: { x: -1, y: 0, z: 0 } }, 6, true);
    let closest = Infinity;
    down('KeyW');
    for (let i = 0; i < 150; i++) { step(1); closest = Math.min(closest, Math.hypot(C.feetPosition.x - lone.x, C.feetPosition.z - lone.z)); }
    up('KeyW'); step(10);
    const passed = C.feetPosition.x < lone.x - 1;
    check('tree trunks are solid: you go round, not through', nearColliders > 0 && bark && Math.abs(3 - bark.timeOfImpact - trunkR) < 0.05 && passed && closest > trunkR + 0.2,
      `colliders=${nearColliders} closest=${closest.toFixed(2)} trunk=${trunkR.toFixed(2)}`);
    // ...and only near you.
    C.placeAt(new V(map.spawn.x, map.spawn.y, map.spawn.z), 0, 0);
    step(30);
    check('trunk colliders only near the player', forest.colliderCount < 1500, `colliders=${forest.colliderCount} of ${treeKinds[0] + treeKinds[1]} trees`);

    // 14. Hidden caches and indoor loot
    const caches = map.caches;
    let apart = Infinity;
    for (const a of caches) for (const b of caches) if (a !== b) apart = Math.min(apart, Math.hypot(a.x - b.x, a.z - b.z));
    const cacheOk = caches.every((c) => game.world.find('chest:' + c.id) && !map.water.sample(c.x, c.y + 0.3, c.z, 0) &&
      !trees.some((t) => Math.hypot(t.x - c.x, t.z - c.z) < 2.5) && c.contents.length > 0);
    check('hidden caches are placed apart, dry and clear of trees', caches.length >= 5 && apart > 200 && cacheOk,
      `caches=${caches.length} (${[...new Set(caches.map((c) => c.spot))].join(', ')}) closest=${apart.toFixed(0)}m`);
    const houseChests = game.world.findByTag('chest').filter((e) => e.name.endsWith(':chest'));
    const tablePickups = game.world.findByTag('pickup').filter((e) => e.name && comp(e, 'ItemPickup')?.spec.id?.endsWith(':table'));
    check('houses have chests and things on tables', houseChests.length > 3 && tablePickups.length > 3, `chests=${houseChests.length} table items=${tablePickups.length}`);

    // 7. The world edge holds
    const edge = map.grid.maxX - 20;
    C.placeAt(new V(edge, map.heightAt(edge, 0) + 2, 0), -Math.PI / 2, 0);
    down('KeyW'); step(300); up('KeyW');
    check('the border stops you leaving the map', C.feetPosition.x < map.grid.maxX - 4, `x=${C.feetPosition.x.toFixed(1)}`);

    // 15. Save: loot a chest, take a table item, open a door, drop a bandit, stand somewhere, save.
    const ia = (e) => comp(e, 'Interactable');
    const chestE = houseChests[0];
    ia(chestE).interact(player);
    const pickE = tablePickups[0];
    const pickId = comp(pickE, 'ItemPickup').spec.id;
    ia(pickE).interact(player);
    const saveDoor = game.world.findByTag('door').find((e) => e.name.startsWith('door:') && !comp(e, 'Door').isOn);
    ia(saveDoor).interact(player);
    const bandit = camps[1] ?? camps[0];
    const banditId = bandit.guards[0].id;
    comp(game.world.find(banditId), 'Damageable').applyHit({ attacker: player, packets: [{ type: 'pierce', amount: 9999 }], zone: null, source: 'check' });
    const cache0 = caches[0];
    C.placeAt(new V(cache0.x + 3, map.heightAt(cache0.x + 3, cache0.z) + 0.05, cache0.z), 0.7, 0);
    step(60);
    const stand = [C.feetPosition.x, C.feetPosition.y, C.feetPosition.z];
    const gold = game.state.itemCount('gold');
    const saved = saves.save(false);
    window.__saved = 1;
    return { r, s: { saved, chest: chestE.name.slice(6), pickId, door: saveDoor.name, banditId, stand, gold } };
  });
  console.log(out.r.join('\n'));

  // Reload the page (a fresh world from the same seed) and load the save.
  await page.reload();
  await page.waitForFunction(() => window.game && window.game.world.find('player') && window.worldgen, null, { timeout: 60000 });
  const after = await page.evaluate((s) => {
    game.stop();
    const r = [];
    const check = (label, ok, extra = '') => r.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
    const comp = (e, n) => e.getAll().find((c) => c.constructor.name === n);
    const player = game.world.find('player');
    const C = comp(player, 'PlayerController');
    const step = (n) => { for (let i = 0; i < n; i++) game.fixedStep(1 / 60); };
    const fresh = !game.state.hasFlag('world.looted.' + s.chest);
    const loaded = s.saved && saves.hasSave() && saves.load();
    step(60);
    const tableGone = !game.world.findByTag('pickup').some((e) => comp(e, 'ItemPickup')?.spec.id === s.pickId);
    const door = comp(game.world.find(s.door), 'Door');
    const brain = comp(game.world.find(s.banditId), 'EnemyBrain');
    const d = Math.hypot(C.feetPosition.x - s.stand[0], C.feetPosition.z - s.stand[2]);
    check('a reloaded page starts fresh until you load', fresh);
    check('loading brings back looted chests, taken items, gold and open doors',
      loaded && game.state.hasFlag('world.looted.' + s.chest) && tableGone && game.state.itemCount('gold') === s.gold && door.isOn,
      `gold=${game.state.itemCount('gold')}/${s.gold} tableGone=${tableGone} doorOpen=${door.isOn}`);
    check('dead bandits stay dead after loading', brain.activity === 'dead' && game.state.hasFlag('killed.' + s.banditId), `activity=${brain.activity}`);
    check('loading puts you back where you saved', d < 0.3 && Math.abs(C.feetPosition.y - s.stand[1]) < 0.3, `off=${d.toFixed(2)}`);
    saves.newGame();
    return r;
  }, out.s);
  console.log(after.join('\n'));
  await browser.close();
})();
