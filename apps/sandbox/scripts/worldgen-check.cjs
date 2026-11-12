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
  await page.goto(base + '?level=world');
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
    for (let i = 0; i < 300; i++) {
      const x = sp.x + (Math.sin(i * 12.9898) * 0.5) * 220;
      const z = sp.z + (Math.cos(i * 78.233) * 0.5) * 220;
      const top = 600;
      const hit = R.castRay({ origin: { x, y: top, z }, dir: { x: 0, y: -1, z: 0 } }, 1000, true);
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
    // Walk over the first bridge.
    const br = net.bridges[0];
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

    // 7. The world edge holds
    const edge = map.grid.maxX - 20;
    C.placeAt(new V(edge, map.heightAt(edge, 0) + 2, 0), -Math.PI / 2, 0);
    down('KeyW'); step(300); up('KeyW');
    check('the border stops you leaving the map', C.feetPosition.x < map.grid.maxX - 4, `x=${C.feetPosition.x.toFixed(1)}`);
    return r;
  });
  console.log(out.join('\n'));
  await browser.close();
})();
