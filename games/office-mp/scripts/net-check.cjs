// Multiplayer + voice check: three real browsers in one room over WebRTC.
// Run through `npm run check -w @ingine/office-mp` (starts the game and a local broker).
// SHOTS=dir saves screenshots.
const { chromium } = require('playwright');

const URL = process.env.URL || 'http://localhost:5174/';
const SIGNAL = process.env.SIGNAL || '127.0.0.1:9000';
const shots = process.env.SHOTS;
const r = [];
const check = (label, ok, extra = '') => r.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);

(async () => {
  const browser = await chromium.launch({
    args: [
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      // A fake microphone (a beeping tone) with no permission prompt.
      '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      // Let pages on the same machine connect by plain local addresses.
      '--disable-features=WebRtcHideLocalIpsWithMdns',
      // Several pages play at once; don't slow down the ones not in front.
      '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
    ],
  });
  const errors = [];
  const open = async (name, extra = '') => {
    const ctx = await browser.newContext({ viewport: shots ? { width: 1280, height: 720 } : { width: 480, height: 300 }, permissions: ['microphone'] });
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept()); // "Leave site?" once played
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(`${name} console: ${m.text()}`));
    await page.goto(`${URL}?signal=${SIGNAL}&name=${name}${extra}`);
    await page.waitForFunction(() => window.game && window.game.world.find('player') && document.querySelector('.mp-lobby'), null, { timeout: 30000 }).catch((e) => { throw new Error('line 33: ' + e.message); });
    return page;
  };
  // Test helpers inside each page.
  const helpers = () => {
    const comp = (e, n) => e.getAll().find((c) => c.constructor.name === n);
    const player = () => game.world.find('player');
    window.T = {
      comp,
      pickupIds: () => game.world.findByTag('pickup').map((e) => comp(e, 'ItemPickup').spec.id).sort(),
      take: (id) => {
        const e = game.world.findByTag('pickup').find((p) => comp(p, 'ItemPickup').spec.id === id);
        if (!e) return false;
        comp(e, 'Interactable').interact(player());
        return true;
      },
      place: (x, y, z, yaw = 0) => {
        const C = comp(player(), 'PlayerController');
        C.placeAt(new (player().object3d.position.constructor)(x, y, z), yaw, 0);
      },
    };
  };

  const host = await open('Hana');
  await host.evaluate(helpers);
  await host.click('.mp-host');
  await host.waitForFunction(() => window.net.room, null, { timeout: 20000 }).catch((e) => { throw new Error('line 59: ' + e.message); });
  const code = await host.evaluate(() => net.room.code);
  check('host opens a room with a code', /^[A-Z0-9]{5}$/.test(code), code);

  const cole = await open('Cole', `&room=${code}`);
  await cole.evaluate(helpers);
  const prefilled = await cole.inputValue('input[name=code]');
  await cole.click('.mp-join');
  await cole.waitForFunction(() => window.net.room, null, { timeout: 20000 }).catch(async (e) => {
    throw new Error(`join failed: "${await cole.textContent('.mp-status').catch(() => '?')}" ${e.message}`);
  });
  await host.waitForFunction(() => net.room.peers.size === 1, null, { timeout: 10000 }).catch((e) => { throw new Error('line 70: ' + e.message); });
  const roster = await cole.evaluate(() => net.room.everyone().map((p) => `${p.name}${p.isHost ? '*' : ''}`).join(','));
  check('invite link fills the code; client joins', prefilled === code && roster === 'Hana*,Cole', roster);
  check('lobby closes after joining', await cole.evaluate(() => !document.querySelector('.mp-lobby')));

  // --- Movement: each sees the other where they are.
  await host.evaluate(() => T.place(-8, 0.05, 1.2, 1.0));
  await cole.evaluate(() => T.place(2, 0.05, 2, -0.5));
  await host.waitForTimeout(800);
  const seen = await cole.evaluate(() => {
    const a = net.avatarList()[0];
    const p = a.entity.object3d.position;
    return { name: a.name, x: p.x, z: p.z, yaw: a.entity.object3d.rotation.y };
  });
  check('client sees host avatar at host position', seen.name === 'Hana' && Math.abs(seen.x + 8) < 0.2 && Math.abs(seen.z - 1.2) < 0.2 && Math.abs(seen.yaw - 1.0) < 0.1, JSON.stringify(seen));
  const seenBack = await host.evaluate(() => net.avatarList()[0].entity.object3d.position.toArray().map((v) => +v.toFixed(2)));
  check('host sees client avatar', Math.abs(seenBack[0] - 2) < 0.2 && Math.abs(seenBack[2] - 2) < 0.2, JSON.stringify(seenBack));
  // Walk a little: the avatar follows smoothly (in between samples, not jumping).
  await host.evaluate(() => {
    window.__walk = setInterval(() => {
      const p = game.world.find('player').object3d.position;
      T.place(p.x + 0.05, 0.05, p.z, 1.0);
    }, 16);
  });
  await host.waitForTimeout(600);
  const trail = await cole.evaluate(async () => {
    const xs = [];
    for (let i = 0; i < 20; i++) {
      xs.push(net.avatarList()[0].entity.object3d.position.x);
      await new Promise((r) => requestAnimationFrame(r));
    }
    return xs;
  });
  await host.evaluate(() => clearInterval(window.__walk));
  const steps = trail.slice(1).map((x, i) => x - trail[i]);
  check('remote movement is interpolated (moves every frame, no big jumps)', steps.filter((s) => s > 0).length >= 15 && Math.max(...steps) < 0.25, `steps max ${Math.max(...steps).toFixed(3)}`);

  // --- Pickups: the host decides.
  await cole.evaluate(() => T.take('mug-1'));
  await host.waitForFunction(() => !T.pickupIds().includes('mug-1'), null, { timeout: 5000 }).catch(() => {});
  const afterTake = {
    coleHas: await cole.evaluate(() => game.state.itemCount('mug')),
    hostHas: await host.evaluate(() => game.state.itemCount('mug')),
    goneHost: await host.evaluate(() => !T.pickupIds().includes('mug-1')),
    goneCole: await cole.evaluate(() => !T.pickupIds().includes('mug-1')),
  };
  check('client takes a mug: it is in their bag and gone for everyone', afterTake.coleHas === 1 && afterTake.hostHas === 0 && afterTake.goneHost && afterTake.goneCole, JSON.stringify(afterTake));

  // Both grab the same stapler at once: exactly one gets it.
  await Promise.all([host.evaluate(() => T.take('stapler-1')), cole.evaluate(() => T.take('stapler-1'))]);
  await host.waitForTimeout(600);
  const staplers = [await host.evaluate(() => game.state.itemCount('stapler')), await cole.evaluate(() => game.state.itemCount('stapler'))];
  check('two players grab the same stapler: exactly one gets it', staplers[0] + staplers[1] === 1, JSON.stringify(staplers));

  // Drop: the client puts the mug down in front of them; the host sees it and can take it.
  await cole.evaluate(() => T.place(4.5, 0.05, 2.0, Math.PI / 2));
  await cole.waitForTimeout(100);
  const dropped = await cole.evaluate(() => inventory.drop('mug'));
  await host.waitForFunction(() => T.pickupIds().some((id) => id.startsWith('drop-')), null, { timeout: 5000 }).catch(() => {});
  const dropId = await host.evaluate(() => T.pickupIds().find((id) => id.startsWith('drop-')));
  const coleSees = await cole.evaluate((id) => T.pickupIds().includes(id), dropId);
  check('client drops the mug: everyone sees it', dropped && !!dropId && coleSees, `${dropId}`);
  await host.evaluate((id) => T.take(id), dropId);
  await host.waitForTimeout(500);
  const hostMug = await host.evaluate(() => game.state.itemCount('mug'));
  const goneForCole = await cole.evaluate((id) => !T.pickupIds().includes(id), dropId);
  check('host picks up the dropped mug', hostMug === 1 && goneForCole, `host mugs ${hostMug}`);

  // --- A late joiner gets the world as it is now.
  const dee = await open('Dee', `&room=${code}`);
  await dee.evaluate(helpers);
  await dee.click('.mp-join');
  await dee.waitForFunction(() => window.net.room && net.room.peers.size === 2, null, { timeout: 20000 }).catch(async (e) => {
    throw new Error(`late join failed: "${await dee.textContent('.mp-status').catch(() => '(lobby gone)')}" ${e.message}`);
  });
  await dee.waitForTimeout(800);
  const [hIds, dIds] = [await host.evaluate(() => T.pickupIds().join()), await dee.evaluate(() => T.pickupIds().join())];
  check('late joiner sees the same items as the host', hIds === dIds && !dIds.includes('mug-1'), `${dIds.split(',').length} items`);
  const deeAvatars = await dee.evaluate(() => net.avatarList().map((a) => a.name).sort().join());
  const coleAvatars = await cole.evaluate(() => net.avatarList().map((a) => a.name).sort().join());
  check('everyone sees everyone (host relays)', deeAvatars === 'Cole,Hana' && coleAvatars === 'Dee,Hana', `${deeAvatars} / ${coleAvatars}`);

  // --- Voice.
  const voiceUp = async (page, peerCount) =>
    page.waitForFunction((n) => Object.values(voice.debugState()).filter((v) => v.connected).length === n, peerCount, { timeout: 15000 }).then(() => true, () => false);
  const allVoice = (await voiceUp(host, 2)) && (await voiceUp(cole, 2)) && (await voiceUp(dee, 2));
  check('voice: every pair connected (mesh of 3)', allVoice, JSON.stringify(await cole.evaluate(() => Object.values(voice.debugState()).map((v) => [v.name, v.connected]))));
  const hostId = await host.evaluate(() => net.room.self.id);
  const levelOf = (page, id, ms = 2500) =>
    page.evaluate(async ([id, ms]) => {
      let max = 0;
      const end = performance.now() + ms;
      while (performance.now() < end) {
        max = Math.max(max, voice.debugState()[id]?.level ?? 0);
        await new Promise((r) => setTimeout(r, 30));
      }
      return max;
    }, [id, ms]);
  // Host stands near Cole in the corridor. Push-to-talk (default): nothing goes out until V is held.
  await host.evaluate(() => T.place(-1, 0.05, 1.0, 0));
  await cole.evaluate(() => T.place(-1, 0.05, 3.0, 0));
  await host.waitForTimeout(1500); // let any earlier audio drain
  const silent = await levelOf(cole, hostId, 2000);
  await host.keyboard.down('KeyV');
  const hudLive = await host.evaluate(() => document.querySelector('.voice-hud').classList.contains('live'));
  await host.waitForTimeout(800);
  const talking = await levelOf(cole, hostId, 3000);
  const ring = await cole.evaluate(() => net.avatarList().find((a) => a.name === 'Hana').speaking);
  await host.keyboard.up('KeyV');
  check('push-to-talk: silent until V is held, then heard (and their ring lights)', silent < 0.005 && talking > 0.004 && hudLive, `silent ${silent.toFixed(4)} talking ${talking.toFixed(4)} hud ${hudLive} ring ${ring.toFixed(2)}`);
  await host.evaluate(() => voice.setMode('open'));
  await host.waitForTimeout(800);
  const openMic = await levelOf(cole, hostId, 3000);
  await host.evaluate(() => voice.setMuted(true));
  await host.waitForTimeout(1500);
  const muted = await levelOf(cole, hostId, 2000);
  await host.evaluate(() => voice.setMuted(false));
  check('open mic is heard; mute silences it', openMic > 0.004 && muted < 0.005, `open ${openMic.toFixed(4)} muted ${muted.toFixed(4)}`);

  // Spatial: the voice comes from the host's head, and walls muffle it.
  const settle = (pred) => cole.waitForFunction(([id, pred]) => { const v = voice.debugState()[id]; return v && new Function('v', 'return ' + pred)(v); }, [hostId, pred], { timeout: 8000 }).catch(() => {});
  await settle('Math.abs(v.distance - 2) < 0.3');
  const near = await cole.evaluate((id) => voice.debugState()[id], hostId);
  check('same room: clear voice at the right distance', !near.occluded && near.cutoff > 10000 && Math.abs(near.distance - 2) < 0.3, JSON.stringify({ d: +near.distance.toFixed(2), occ: near.occluded, cutoff: Math.round(near.cutoff) }));
  // Host into the meeting room, Cole outside its wall (not by the door).
  await host.evaluate(() => T.place(10, 0.05, -3.5, 0));
  await cole.evaluate(() => T.place(10, 0.05, -0.5, Math.PI));
  await settle('v.occluded && v.gain < 0.5 && v.cutoff < 1200');
  const walled = await cole.evaluate((id) => voice.debugState()[id], hostId);
  check('meeting room wall muffles the voice', walled.occluded && walled.cutoff < 1500 && walled.gain < 0.5, JSON.stringify({ occ: walled.occluded, cutoff: Math.round(walled.cutoff), gain: +walled.gain.toFixed(2) }));
  await cole.evaluate(() => T.place(9, 0.05, -3.5, -Math.PI / 2));
  await settle('!v.occluded && v.gain > 0.9 && v.cutoff > 10000');
  const inside = await cole.evaluate((id) => voice.debugState()[id], hostId);
  check('walk into the room: clear again', !inside.occluded && inside.cutoff > 10000 && inside.gain > 0.9, JSON.stringify({ occ: inside.occluded, cutoff: Math.round(inside.cutoff), gain: +inside.gain.toFixed(2) }));
  // The listener faces where the camera does (yaw -90° looks along +X).
  const pan = await cole.evaluate(() => {
    const L = voice.ctx.listener;
    return [L.forwardX.value, L.forwardZ.value].map((v) => +v.toFixed(2));
  });
  check('listener follows the camera', Math.abs(pan[0] - 1) < 0.1 && Math.abs(pan[1]) < 0.1, JSON.stringify(pan));

  if (shots) {
    // Cole by the open-plan desks, looking at Hana (talking) and Dee.
    await host.evaluate(() => T.place(-6.2, 0.05, 1.3, -2.2));
    await dee.evaluate(() => T.place(-5.0, 0.05, 2.0, 2.6));
    await cole.evaluate(() => T.place(-9.6, 0.05, 2.2, -1.35));
    await cole.evaluate(() => { game.world.find('player').getAll().find((c) => c.constructor.name === 'PlayerController').pitch = -0.12; });
    for (const p of [host, cole]) await p.evaluate(() => { game.input._locked = true; game.events.emit('input:pointerlock', { locked: true }); document.querySelector('.debug').classList.add('hidden'); });
    await host.evaluate(() => voice.setMode('open'));
    await cole.waitForFunction(() => net.avatarList().find((a) => a.name === 'Hana').speaking > 0, null, { timeout: 8000 }).catch(() => {});
    await cole.screenshot({ path: `${shots}/office-cole.png` });
    // Hana in the meeting room doorway, looking out at the corridor.
    await host.evaluate(() => T.place(6.6, 0.05, -2.6, Math.PI * 0.85));
    await host.waitForTimeout(1500);
    await host.screenshot({ path: `${shots}/office-host.png` });
  }

  // --- Leaving.
  await dee.close({ runBeforeUnload: true });
  await host.waitForFunction(() => net.room.peers.size === 1, null, { timeout: 10000 }).catch(() => {});
  const afterLeave = await host.evaluate(() => [net.room.peers.size, net.avatarList().length, Object.keys(voice.debugState()).length]);
  check('a player leaves: avatar and voice go too', afterLeave.join() === '1,1,1', afterLeave.join());
  await host.close({ runBeforeUnload: true });
  const closed = await cole.waitForFunction(() => !net.room && document.querySelector('.mp-closed:not(.hidden)'), null, { timeout: 10000 }).then(() => true, () => false);
  check('host leaves: the room closes for the others', closed);

  check('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  console.log(r.join('\n'));
  await browser.close();
  process.exit(r.some((l) => l.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => {
  console.log(r.join('\n'));
  console.log('FAIL  crashed: ' + e.stack);
  process.exit(1);
});
