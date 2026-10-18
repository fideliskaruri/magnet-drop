# Magnet Drop

A one-tap vertical arcade prototype. Your orb falls through a machine of magnets and magnetic gates. Tap to flip its polarity:

- **Opposites attract.** A blue orb is pulled toward red magnets. A red orb is pulled toward blue magnets.
- **Same colours repel.**
- **Touch an attracting magnet and you stick to it.** Flip again to launch off it.
- Fall too slowly and the machine above catches you. Rare saw blades also kill.

Play it here: https://fideliskaruri.github.io/magnet-drop/

This is the **proto-a** branch: **Prototype A, Vertical Magnet Drop** (see [docs/proto-a.md](docs/proto-a.md) and the plan in [docs/prototype-ab-plan.md](docs/prototype-ab-plan.md)). Magnetic gates replace spike rows: polarity gates, magnetic irises, pinball flippers, rail gates, alternating gates and neutral iron gates. Wrong choices mostly cost you trajectory; you die when the camera catches you or, rarely, on a saw. +1 per gate, +1 for a clean centre pass, and a combo for clean gates in a row. The first 5 gates are a fixed tutorial. Play it at https://fideliskaruri.github.io/magnet-drop/proto-a/

The look is a dark industrial machine (shared with Prototype B through `THEME` in `src/theme.ts`). Analytics are recorded locally only (`src/analytics.ts`) and shown in the Stats section of the tuning panel.

Sound is synthesised live with WebAudio (`src/audio.ts`). The speaker button (or M) mutes without flipping your orb.

### Variants

Each experiment lives on its own branch and deploys to its own URL. Every push to any of these branches rebuilds the whole site.

| Branch | Idea | URL |
|---|---|---|
| `rise` | The orb floats up instead of falling | https://fideliskaruri.github.io/magnet-drop/rise/ |
| `easy` | Same game, more forgiving | https://fideliskaruri.github.io/magnet-drop/easy/ |
| `endless` | Procedural, Flappy-style: score from obstacles passed | https://fideliskaruri.github.io/magnet-drop/endless/ |
| `powerups` | Boosters, shields and phasers in the arena | https://fideliskaruri.github.io/magnet-drop/powerups/ |
| `sound` | Reworked sound design | https://fideliskaruri.github.io/magnet-drop/sound/ |
| `juice` | More intense visual effects | https://fideliskaruri.github.io/magnet-drop/juice/ |
| `tuner` | Easy + sound + juice combined, with live tuning sliders | https://fideliskaruri.github.io/magnet-drop/tuner/ |
| `endless-tuner` | Tuner combined with endless procedural gates | https://fideliskaruri.github.io/magnet-drop/endless-tuner/ |
| `proto-a` | Prototype A: vertical drop through magnetic gates | https://fideliskaruri.github.io/magnet-drop/proto-a/ |

## Run locally

```sh
pnpm install
pnpm dev          # http://localhost:5180 (also reachable from your phone on the LAN)
```

## Check it

```sh
pnpm typecheck
pnpm build
pnpm sim [all|gates|runs] [seeds]  # proves every catalogue gate (timed and moving ones on a fixed clock) is clearable from 18 entries, and 60-gate generated runs clear with the camera chasing
pnpm verify [url] # headless Edge end-to-end checks against a running dev server; screenshots go to %TEMP%\agent-scratch\magnet-drop-proto-a
```

Speeds, forces, zone sizes and bounces are in `src/tune.ts` and can be changed live from the in-game tuning panel (gear button or T). See [docs/tuner.md](docs/tuner.md) for the defaults, the sliders and how zones are kept apart. Other constants are in `src/config.ts` (effect tunables are in `JUICE`). The gate generator is in `src/gates.ts`. Scores and settings are stored under `magnetdrop.proto-a.*`.

`pnpm sim` also takes `key=value` overrides, e.g. `pnpm sim gates gravity=700 fieldScale=1`, and `SIM_ONLY=iris,rail` limits the gate check to some families.

## Layout

| File | Purpose |
|---|---|
| `src/theme.ts` | `THEME`: the shared industrial palette (also used by Prototype B). |
| `src/physics.ts` | Pure physics: magnet forces, sticking, launching, walls, gate machinery contacts and saws. Shared by the game and `sim`. |
| `src/gates.ts` | Pure gate generator: tutorial gates plus 6 magnetic gate families from small discrete choices, difficulty tiers, a seeded stream, and deterministic gate machinery steps. Shared by the game and `sim`. |
| `src/world.ts` | Spawns and culls generated gates ahead of the camera and fits each new gate's zones against the one above. |
| `src/tune.ts` | Live tunables, their defaults, slider ranges and saved settings. |
| `src/zones.ts` | Fits magnet zones so no two come closer than the set gap. |
| `src/panel.ts` | The tuning panel: sliders, reset, copy values, and the Stats section. Pauses the game while open. |
| `src/analytics.ts` | Local-only event log (`magnetdrop.proto-a.analytics`) and the stats summary. |
| `src/audio.ts` | Synthesised sound: continuous layers driven every frame plus capped one-shot voices, a mute switch and offline renders for `verify`. |
| `src/game.ts` | State machine, camera, stall pressure, scoring (gate, clean bonus, combo), deaths, analytics calls and best score. |
| `src/fx.ts` | Effects: shake, camera kicks and zoom, flashes (at most 3 big ones per second), particles, pulses and run intensity. Tones down under reduced motion. |
| `src/render.ts` | Canvas renderer on a letterboxed 360x640 playfield, with pre-rendered glow sprites. |
| `src/main.ts` | Boot, input and the fixed-step loop. |
| `src/debug.ts` | Dev-only `window.__md` hooks used by `verify`. They are not included in production builds. |

The design draft and the prototype plan are in [`docs/`](docs/). Research behind the effects is in [`docs/juice-research.md`](docs/juice-research.md).
