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
