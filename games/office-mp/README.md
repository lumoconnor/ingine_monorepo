# Office floor (multiplayer test)

A small test game for multiplayer and spatial voice chat: one floor of an
office, with things lying on desks and tables to pick up. One player hosts,
friends join with a room code. There is no game server.

```bash
npm run dev:office     # from the repo root: http://localhost:5174
npm run check:office   # headless: three browsers in one room
```

## Playing together

1. Open the game, type a name, press **Host a room**. You get a five-letter code.
2. Press **Esc** to free the mouse and **Copy invite link** (top right), or just
   read the code out. A friend opens the link (or the game, and types the code)
   and presses **Join**.
3. Both browsers ask for the microphone. Headphones are best: voices are
   played through Web Audio for the 3D effect, and browsers' echo
   cancellation doesn't cover that, so speakers can feed back.

To try it alone, open two browser windows on the same machine.

### Hosted copy

`.github/workflows/office-pages.yml` publishes the game to GitHub Pages on
every push to main that touches it, so friends only need the link. One-time
setup: repo **Settings > Pages > Source: GitHub Actions** (Pages on a private
repo needs a paid GitHub plan; otherwise make the repo public). It can't be a
Claude artifact: artifact pages block the microphone and WebRTC.

| Input | Action |
|---|---|
| W A S D, mouse, Space, Shift, C | Move, look, jump, sprint, crouch |
| E | Pick up what you're looking at |
| Tab / I | Your bag: read, use or drop items |
| V (hold) | Talk (push-to-talk, the default) |
| B | Switch between push-to-talk and open mic |
| M | Mute your microphone |
| Esc | Free the mouse |

## What's shared and how

- **Who's in the room**: everyone connects to the host; the host relays.
- **Movement**: each player moves themselves and sends their position 20
  times a second. Others are drawn 100 ms behind, blended between updates,
  so they move smoothly. Players don't collide with each other yet.
- **Items**: the host decides who gets each item, so two people can't take
  the same mug. Dropped items are placed by the host for everyone. A player
  who joins late gets the items as they are now.
- **Voice**: each player's microphone goes straight to every other player.
  Each listener hears a voice from the speaker's head position: it turns
  as you turn, fades with distance (silent past 30 m), and goes muffled and
  quieter when a wall or closed door is between you. Try talking from inside
  the meeting room (north-east corner) while a friend stands in the corridor.

Your bag is your own and isn't saved; leaving the room ends the session.

## Signalling and networks

Browsers need an introduction before they can connect directly. By default
that's the free public PeerJS broker (0.peerjs.com), so nothing has to be
hosted. Add `?signal=host:port` to use a different broker; the checks run
their own on `127.0.0.1:9000` so they work offline.

Some home and office routers block direct connections. Those players need a
TURN relay, which isn't set up yet, so for now they can't join. Players never
deal with this themselves; it's a setting the game will ship with
(`iceServers` in `RoomOptions`).

## Files

```
src/main.ts          wires the engine, @ingine/multiplayer and @ingine/voice together
src/OfficeLevel.ts   the floor plan, furniture and item placement
src/content/         items.json, item models (mug, stapler, keycard, notebook), engine combat basics
scripts/net-check.cjs  three headless browsers: join, movement, items, voice, walls, leaving
```
