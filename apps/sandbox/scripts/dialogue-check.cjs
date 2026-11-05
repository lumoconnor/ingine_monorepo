// Dialogue / WorldState regression check. Start `npm run dev` first, then: node scripts/dialogue-check.cjs
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
  page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
  await page.goto(process.env.URL || 'http://localhost:5173/');
  await page.waitForFunction(() => window.game && window.game.world.find('player'), null, { timeout: 30000 });
  const out = await page.evaluate(() => {
    game.stop();
    const player = game.world.find('player');
    const comp = (e, n) => e.getAll().find((c) => c.constructor.name === n);
    const RB = comp(player, 'RigidBodyComponent');
    const C = comp(player, 'PlayerController');
    const IA = comp(player, 'PlayerInteractor');
    const D = dialogue;
    const S = game.state;
    const T = player.object3d.position.constructor;
    let elapsed = 0;
    const frame = () => {
      elapsed += 1 / 60;
      const t = { delta: 1 / 60, elapsed, alpha: 1 };
      game.world.update(t);
      D.update(t);
    };
    const step = (n) => { for (let i = 0; i < n; i++) { game.fixedStep(1 / 60); frame(); } };
    const down = (c) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c }));
    const up = (c) => window.dispatchEvent(new KeyboardEvent('keyup', { code: c }));
    const press = (c) => { down(c); step(1); up(c); step(1); };
    const tp = (x, y, z, yaw = 0) => { RB.teleport(new T(x, y, z)); C.velocity.set(0, 0, 0); C.yaw = yaw; C.pitch = 0; C.ladder = null; step(20); };
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
    const lines = [];
    const notes = [];
    game.events.on('dialogue:line', (l) => lines.push(l));
    game.events.on('notify', (n) => notes.push(n.text));
    const last = () => lines[lines.length - 1];
    const choiceTexts = () => last().choices.map((c) => c.text);
    const r = [];
    const check = (label, ok, extra = '') => r.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
    const talkTo = (id, from) => {
      const npc = game.world.find(id);
      const p = npc.object3d.position;
      tp(from[0], 0.05, from[1]);
      aim(p.x, p.y + 1.3, p.z);
      const pr = prompt();
      press('KeyE');
      return pr;
    };

    // 0. Validation rejects bad content with a useful message.
    let err = '';
    try {
      D.register({ id: 'bad', speaker: 'X', start: 'a', nodes: {
        a: { text: 'hi', choices: [{ text: 'go', next: 'nowhere', do: [{ do: 'giveItem', item: 'unicorn' }] }, { text: 'x', if: [{ if: 'flagg', flag: 'f' }] }] },
        orphan: { text: 'never shown' },
      } });
    } catch (e) { err = e.message; }
    check('validator rejects bad tree', /unknown node "nowhere"/.test(err) && /item id/.test(err) && /unknown condition "flagg"/.test(err) && /orphan: is unreachable/.test(err), JSON.stringify(err.split('\n').length + ' lines'));
    check('content trees registered', D.has('mira') && D.has('bram') && D.has('tess'));

    // 1. Mira: greeting, hub, seen choices, blocked movement, camera framing.
    const pm = talkTo('npc-mira', [3.2, 6.8]);
    check('looking at Mira offers Talk', pm === 'Talk to Mira', `prompt=${pm}`);
    check('E starts conversation at intro', D.isActive && D.currentNode === 'intro' && last().speaker === 'Mira', D.currentNode);
    check('gameplay input blocked', game.input.gameplayBlocked);
    C.yaw += 0.8; C.pitch = -0.5; // look away; the dialogue should pull the view back
    const before = C.feetPosition.clone();
    down('KeyW'); step(40); up('KeyW');
    check('W does not walk during dialogue', C.feetPosition.distanceTo(before) < 0.05, C.feetPosition.distanceTo(before).toFixed(3));
    const head = game.world.find('npc-mira').object3d.position.clone(); head.y += 1.62;
    const cam = game.renderer.camera.getWorldPosition(new T());
    const fwd = game.renderer.camera.getWorldDirection(new T());
    const off = fwd.angleTo(head.sub(cam).normalize());
    check('camera frames the speaker', off < 0.12, `angle=${off.toFixed(3)}`);
    check('intro has single Continue', choiceTexts().join() === 'Continue', choiceTexts().join('|'));
    press('KeyE');
    check('Continue goes to hub', D.currentNode === 'hub' && choiceTexts().length === 4, choiceTexts().join('|'));
    press('Digit1');
    check('1 picks first reply', D.currentNode === 'place');
    press('Space');
    check('back at hub; explored reply greyed', D.currentNode === 'hub' && last().choices[0].seen && !last().choices[1].seen && !last().choices[3].seen);
    press('Digit4');
    step(10);
    check('Leave ends conversation', !D.isActive && !game.input.gameplayBlocked);
    down('KeyW'); step(20); up('KeyW');
    check('can walk again after', C.feetPosition.distanceTo(before) > 0.3);
    talkTo('npc-mira', [3.2, 6.8]);
    check('Mira remembers you (starts at hub)', D.currentNode === 'hub', D.currentNode);
    // Esc / mouse release ends the conversation.
    game.events.emit('input:pointerlock', { locked: false });
    check('releasing the mouse ends it', !D.isActive);

    // 2. Tess before the task.
    talkTo('npc-tess', [-3.2, 6.8]);
    check('Tess talks about the lost key', D.currentNode === 'before' && /storeroom key/.test(last().text));
    press('Digit3');

    // 3. Bram gives the task.
    const pb = talkTo('npc-bram', [-28.6, 20.6]);
    check('Bram prompt', pb === 'Talk to Old Bram', `prompt=${pb}`);
    check('Bram intro', D.currentNode === 'intro', D.currentNode);
    press('Digit1'); press('Digit1');
    check('accepting sets quest flag + notify', S.hasFlag('quest_key_started') && notes.includes("New task: Find Bram's key"), notes.join('|'));
    check('no-choice node offers Leave', choiceTexts().join() === 'Leave');
    press('KeyE'); step(10);
    check('E that picked Leave does not reopen it', !D.isActive && !game.input.gameplayBlocked);
    talkTo('npc-bram', [-28.6, 20.6]);
    check('Bram now waiting', D.currentNode === 'waiting');
    // Walking away (teleport) drops the conversation.
    RB.teleport(new T(-22, 0.05, 20.6)); step(3);
    check('moving away ends it', !D.isActive);

    // 4. Pick up the key.
    tp(-36.45, 0.05, 16.4, 0);
    aim(-36.45, 0.82, 17.75);
    const pk = prompt();
    press('KeyE');
    check('pick up key', pk === 'Pick up Rusty key' && S.itemCount('key_rusty') === 1 && !game.world.find('pickup:key_rusty'), `prompt=${pk}`);

    // 5. Return it.
    talkTo('npc-bram', [-28.6, 20.6]);
    check('Bram sees the key', D.currentNode === 'has_key', D.currentNode);
    press('Digit2');
    check('"Finders keepers" loops back', D.currentNode === 'keepers');
    press('KeyE');
    press('Digit1');
    check('returning: key taken, 10 gold, flag', S.itemCount('key_rusty') === 0 && S.itemCount('gold') === 10 && S.hasFlag('key_returned'), JSON.stringify(S.toJSON().items));
    press('KeyE');
    talkTo('npc-bram', [-28.6, 20.6]);
    check('Bram thanks you afterwards', D.currentNode === 'thanks');
    press('Digit1');

    // 6. Tess changed.
    talkTo('npc-tess', [-3.2, 6.8]);
    check('Tess has new lines', D.currentNode === 'after' && choiceTexts()[0].includes('cider'), choiceTexts().join('|'));
    press('Digit1');
    check('buy cider: 5 gold, cider item, {item.gold} substituted', S.itemCount('gold') === 5 && S.itemCount('cider') === 1 && /You've got 5 gold left/.test(last().text), last().text);
    press('KeyE');
    check('can afford another', choiceTexts()[0].includes('cider'));
    press('Digit1'); press('KeyE');
    check('cider offer gone when broke', S.itemCount('gold') === 0 && S.itemCount('cider') === 2 && !choiceTexts().some((t) => t.includes('cider')), choiceTexts().join('|'));
    press('Digit1'); press('KeyE'); press('Digit2');
    check('Tess ends', !D.isActive);

    // 7. Mira's welcome back + save/load round trip.
    talkTo('npc-mira', [3.2, 6.8]);
    check('Mira welcome back', D.currentNode === 'welcome_back');
    press('Digit2');
    const snap = JSON.parse(JSON.stringify(S.toJSON()));
    S.reset();
    check('reset clears state', !S.hasFlag('key_returned'));
    S.load(snap);
    check('save/load round trip', S.hasFlag('key_returned') && S.itemCount('cider') === 2 && S.hasFlag('dialogue.visited.mira.intro'));
    return r;
  });
  console.log(out.join('\n'));
  const fails = out.filter((l) => l.startsWith('FAIL')).length;
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
