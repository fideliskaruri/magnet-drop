# Magnet Drop

A one-tap vertical arcade prototype. Your orb falls through a field of magnets and spikes. Tap to flip its polarity:

- **Opposites attract.** A cyan orb is pulled toward red magnets. A red orb is pulled toward cyan magnets.
- **Same colours repel.**
- **Touch an attracting magnet and you stick to it.** Flip again to launch off it.
- Touch spikes and you die. If you stall too long, the screen catches you.

This is the **endless** variant: the course is generated as you fall, one gate at a time. Each gate is a spike barrier with one gap plus a few magnets. Every gap you drop through is a point; the number is the reward. Gaps narrow and gates tighten as the score climbs (tiers start at gates 6, 16 and 30).

Play it here: https://fideliskaruri.github.io/magnet-drop/endless/ (the original is at https://fideliskaruri.github.io/magnet-drop/)

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
pnpm sim [all|gates|runs] [seeds]  # proves every gate the generator can make is beatable from 18 entries, and 60-gate generated runs clear with the camera chasing
pnpm verify [url] # headless Edge end-to-end checks against a running dev server; screenshots go to %TEMP%\agent-scratch\magnet-drop-endless
```

All feel and tuning numbers are in `src/config.ts`. The gate generator is in `src/gates.ts`. The best score is stored under `magnetdrop.endless.best`.

## Layout

| File | Purpose |
|---|---|
| `src/physics.ts` | Pure physics: magnet forces, sticking, launching, walls and spikes. Shared by the game and `sim`. |
| `src/gates.ts` | Pure gate generator: 6 gate families from small discrete choices, difficulty tiers, a seeded stream. Shared by the game and `sim`. |
| `src/world.ts` | Spawns and culls generated gates ahead of the camera. |
| `src/game.ts` | State machine, camera, stall pressure, scoring (one point per gate) and best score. |
| `src/render.ts` | Canvas renderer on a letterboxed 360x640 playfield. |
| `src/main.ts` | Boot, input and the fixed-step loop. |
| `src/debug.ts` | Dev-only `window.__md` hooks used by `verify`. They are not included in production builds. |

The design draft and the prototype plan are in [`docs/`](docs/).
