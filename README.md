# Magnet Drop

A one-tap vertical arcade prototype. Your orb falls through a field of magnets and spikes. Tap to flip its polarity:

- **Opposites attract.** A cyan orb is pulled toward red magnets. A red orb is pulled toward cyan magnets.
- **Same colours repel.**
- **Touch an attracting magnet and you stick to it.** Flip again to launch off it.
- Touch spikes and you die. If you stall too long, the screen catches you.

Play it here: https://fideliskaruri.github.io/magnet-drop/

This is the **endless-tuner** branch: the `tuner` build (forgiving physics, reworked sound, intense effects, live tuning sliders) on the `endless` procedural course. The course is generated as you fall, one gate at a time. Each gate is a spike barrier with one gap plus a few magnets. Every gap you drop through is a point. Gaps narrow and gates come closer as the score climbs (tiers start at gates 6, 16 and 30). Play it at https://fideliskaruri.github.io/magnet-drop/endless-tuner/

Sound is synthesised live with WebAudio (`src/audio.ts`); clearing a gate gives a short two-note blip. The speaker button (or M) mutes without flipping your orb.

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
pnpm verify [url] # headless Edge end-to-end checks against a running dev server; screenshots go to %TEMP%\agent-scratch\magnet-drop-endless-tuner
```

Speeds, forces, zone sizes and bounces are in `src/tune.ts` and can be changed live from the in-game tuning panel (gear button or T). See [docs/tuner.md](docs/tuner.md) for the defaults, the sliders and how zones are kept apart. Other constants are in `src/config.ts` (effect tunables are in `JUICE`). The gate generator is in `src/gates.ts`. Scores and settings are stored under `magnetdrop.endless-tuner.*`.

`pnpm sim` also takes `key=value` overrides, e.g. `pnpm sim gates gravity=700 fieldScale=1`, and `SIM_ONLY=twin,rail` limits the gate check to some families.

## Layout

| File | Purpose |
|---|---|
| `src/physics.ts` | Pure physics: magnet forces, sticking, launching, walls and spikes. Shared by the game and `sim`. |
| `src/gates.ts` | Pure gate generator: 6 gate families from small discrete choices, difficulty tiers, a seeded stream. Shared by the game and `sim`. |
| `src/world.ts` | Spawns and culls generated gates ahead of the camera and fits each new gate's zones against the one above. |
| `src/tune.ts` | Live tunables, their defaults, slider ranges and saved settings. |
| `src/zones.ts` | Fits magnet zones so no two come closer than the set gap. |
| `src/panel.ts` | The tuning panel: sliders, reset, copy values. Pauses the game while open. |
| `src/audio.ts` | Synthesised sound: continuous layers driven every frame plus capped one-shot voices, a mute switch and offline renders for `verify`. |
| `src/game.ts` | State machine, camera, stall pressure, scoring (one point per gate), shield and best score. |
| `src/fx.ts` | Effects: shake, camera kicks and zoom, flashes (at most 3 big ones per second), particles, pulses and run intensity. Tones down under reduced motion. |
| `src/render.ts` | Canvas renderer on a letterboxed 360x640 playfield, with pre-rendered glow sprites. |
| `src/main.ts` | Boot, input and the fixed-step loop. |
| `src/debug.ts` | Dev-only `window.__md` hooks used by `verify`. They are not included in production builds. |

The design draft and the prototype plan are in [`docs/`](docs/). Research behind the effects is in [`docs/juice-research.md`](docs/juice-research.md).
