# Magnet Drop

A one-tap vertical arcade prototype. Your orb falls through a field of magnets and spikes. Tap to flip its polarity:

- **Opposites attract.** A cyan orb is pulled toward red magnets. A red orb is pulled toward cyan magnets.
- **Same colours repel.**
- **Touch an attracting magnet and you stick to it.** Flip again to launch off it.
- Touch spikes and you die. If you stall too long, the screen catches you.

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
pnpm verify [url] # headless Edge end-to-end checks against a running dev server; screenshots go to %TEMP%\agent-scratch\magnet-drop
```

All feel and tuning numbers are in `src/config.ts`. The patterns are in `src/patterns.ts`.

## Layout

| File | Purpose |
|---|---|
| `src/physics.ts` | Pure physics: magnet forces, sticking, launching, walls and spikes. Shared by the game and `sim`. |
| `src/patterns.ts` | The 10 hand-authored obstacle patterns (the first 3 are the tutorial). |
| `src/world.ts` | Spawns and culls patterns ahead of the camera. |
| `src/game.ts` | State machine, camera, stall pressure, scoring and best score. |
| `src/render.ts` | Canvas renderer on a letterboxed 360x640 playfield. |
| `src/main.ts` | Boot, input and the fixed-step loop. |
| `src/debug.ts` | Dev-only `window.__md` hooks used by `verify`. They are not included in production builds. |

The design draft and the prototype plan are in [`docs/`](docs/).
