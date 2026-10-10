# Magnet Drop: Rise

The `rise` variant of Magnet Drop. Your orb is buoyant: it floats **up** through a field of magnets and spike ceilings. Tap to flip its polarity:

- **Opposites attract.** A cyan orb is pulled toward red magnets. A red orb is pulled toward cyan magnets.
- **Same colours repel.**
- **Touch an attracting magnet and you stick to it.** Flip again to launch off it.
- Touch spikes and you die. The view keeps climbing; sink off the bottom and you lose. The bottom edge glows brighter as you sink toward it.

What changes from the falling version:

- **Buoyancy instead of gravity**, a little floatier (`BUOYANCY` 600 and `TERMINAL_RISE` 340 vs 700 and 380), so there is more time to read what is coming.
- **Camera** keeps the orb low (65% down the view) so you see what is above you. It only ever climbs.
- **Spikes hang from ceilings** and point down at you. The patterns are the main ones mirrored top to bottom, re-checked by `pnpm sim`.
- **Stuck on a magnet**, you slide round to its top and rest there; hanging under one is the unstable spot.
- **Score** is height climbed and sits at the bottom of the screen, out of the way of incoming hazards. It fades when you sink toward it.
- Drifting motes at two depths sell the climb. Best score is stored under `magnetdrop.rise.best`.

Play it here: https://fideliskaruri.github.io/magnet-drop/rise/ (the original falling version: https://fideliskaruri.github.io/magnet-drop/)

### Variants

Each experiment lives on its own branch and deploys to its own URL. Every push to any of these branches rebuilds the whole site.

| Branch | Idea | URL |
|---|---|---|
| `rise` | The orb floats up instead of falling | https://fideliskaruri.github.io/magnet-drop/rise/ |
| `easy` | Same game, more forgiving | https://fideliskaruri.github.io/magnet-drop/easy/ |
| `endless` | Procedural, Flappy-style: score from obstacles passed | https://fideliskaruri.github.io/magnet-drop/endless/ |
| `powerups` | Boosters, shields and phasers in the arena | https://fideliskaruri.github.io/magnet-drop/powerups/ |
| `sound` | Reworked sound design | https://fideliskaruri.github.io/magnet-drop/sound/ |

## Run locally

```sh
pnpm install
pnpm dev          # http://localhost:5180 (also reachable from your phone on the LAN)
```

## Check it

```sh
pnpm typecheck
pnpm build
pnpm sim [n]      # proves every pattern (or only pattern n) can be cleared from every entry point
pnpm verify [url] # headless Edge end-to-end checks against a running dev server; screenshots go to %TEMP%\agent-scratch\magnet-drop-rise (defaults to http://localhost:5191/)
```

All feel and tuning numbers are in `src/config.ts`. The patterns are in `src/patterns.ts`.

## Layout

| File | Purpose |
|---|---|
| `src/physics.ts` | Pure physics: magnet forces, sticking, launching, walls and spikes. Shared by the game and `sim`. |
| `src/patterns.ts` | The 10 hand-authored obstacle patterns (the first 3 are the tutorial). The orb enters each at the bottom and leaves through the top. |
| `src/world.ts` | Spawns patterns above the camera and culls ones left below it. |
| `src/game.ts` | State machine, camera, stall pressure, scoring and best score. |
| `src/render.ts` | Canvas renderer on a letterboxed 360x640 playfield. |
| `src/main.ts` | Boot, input and the fixed-step loop. |
| `src/debug.ts` | Dev-only `window.__md` hooks used by `verify`. They are not included in production builds. |

The design draft and the prototype plan are in [`docs/`](docs/).
