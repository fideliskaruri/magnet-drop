# Magnet Drop

A one-tap vertical arcade prototype. Your orb falls through a field of magnets and spikes. Tap to flip its polarity:

- **Opposites attract.** A cyan orb is pulled toward red magnets. A red orb is pulled toward cyan magnets.
- **Same colours repel.**
- **Touch an attracting magnet and you stick to it.** Flip again to launch off it.
- Touch spikes and you die. If you stall too long, the screen catches you.

### Power-ups (this branch)

Glowing hexagon tokens float in the empty gaps between obstacle patterns. The gap right after the tutorial always has one; later gaps have one 60% of the time. Tokens near the orb drift into it, so you don't need a perfect line.

| Token | Look | What it does | How it ends |
|---|---|---|---|
| **Boost** | Green, double arrow | A straight power dive at nearly twice top speed. Magnets are ignored and spike rows you hit are smashed. | After 1.4 s it keeps diving until the next gap, then hands control back with a short moment of spike immunity. |
| **Shield** | White, shield crest | A bubble around the orb that saves you once: from spikes (you bounce off) or from the screen catching you (you drop back into play). | Stays until it saves you. |
| **Phase** | Purple, ghost | The orb turns see-through and spikes pass through it. Magnets still work, so you keep steering. | After 5 s. It never turns solid while inside spikes. |

Active power-ups show as badges under the score with a draining ring. Timed ones blink and tick in their last second. Best score is stored separately for this variant (`magnetdrop.powerups.best`).

Play it here: https://fideliskaruri.github.io/magnet-drop/

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
pnpm verify [url] # headless Edge end-to-end checks against a running dev server (default http://localhost:5194/); screenshots go to %TEMP%\agent-scratch\magnet-drop-powerups
```

All feel and tuning numbers are in `src/config.ts`. The patterns are in `src/patterns.ts`.

## Layout

| File | Purpose |
|---|---|
| `src/physics.ts` | Pure physics: magnet forces, sticking, launching, walls and spikes. Shared by the game and `sim`. Optional `StepMods` let power-ups skip magnets or spikes; without them it is the exact game `sim` checks. |
| `src/patterns.ts` | The 10 hand-authored obstacle patterns (the first 3 are the tutorial). |
| `src/world.ts` | Spawns and culls patterns and power-up tokens ahead of the camera. |
| `src/game.ts` | State machine, camera, stall pressure, power-ups, scoring and best score. |
| `src/render.ts` | Canvas renderer on a letterboxed 360x640 playfield. |
| `src/main.ts` | Boot, input and the fixed-step loop. |
| `src/debug.ts` | Dev-only `window.__md` hooks used by `verify`. They are not included in production builds. |

The design draft and the prototype plan are in [`docs/`](docs/).
