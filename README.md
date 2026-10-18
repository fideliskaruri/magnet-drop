# Magnet Drop

A one-tap polarity arcade prototype set in a dark electromagnetic facility. Tap to flip your orb's polarity:

- **Opposites attract.** A rail or magnet of the other colour pulls you in. Hit it and you stick.
- **Same colours repel.**
- **Flip while stuck and you launch.**

Play it here: https://fideliskaruri.github.io/magnet-drop/

This is the **proto-b** branch: **Prototype B, the Sideways Polarity Runner**. The orb runs right on its own. Red pulls it up toward the ceiling rail and blue pulls it down toward the floor rail, and each flip draws a smooth arc. Gates are dual-polarity lanes, pinball paddles, lane splitters, magnetic tunnels, repulsion doors, iron pendulums and alternating rails. If a gate holds you back too long, the left edge of the screen pushes you off. It plays landscape (640x360, letterboxed). Play it at https://fideliskaruri.github.io/magnet-drop/proto-b/

See [docs/proto-b.md](docs/proto-b.md) for the movement, gates, failure, scoring and how to read the stats. The plan it follows is [docs/prototype-ab-plan.md](docs/prototype-ab-plan.md). Prototype A is built on its own branch with the same look (`src/theme.ts`), juice and analytics, so the two can be compared.

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
| `proto-b` | Sideways polarity runner (this branch) | https://fideliskaruri.github.io/magnet-drop/proto-b/ |

## Run locally

```sh
pnpm install
pnpm dev          # http://localhost:5180 (also reachable from your phone on the LAN)
```

## Check it

```sh
pnpm typecheck
pnpm build
pnpm sim [all|gates|runs] [seeds] [family=name]  # proves every catalogue gate clears from 7 heights x both polarities (timed gates at 4 clock phases), and seeded 45-gate runs clear with the screen pushing
pnpm verify [url] # headless Edge end-to-end checks; run `pnpm dev --port 5182 --strictPort` first. Screenshots go to %TEMP%\agent-scratch\magnet-drop-proto-b
```

Speeds, pulls, launch and bounce settings are in `src/tune.ts` and can be changed live from the in-game tuning panel (gear button or T). The panel also has a **Stats** section with the local play analytics. Other constants are in `src/config.ts` (effect tunables are in `JUICE`), and the shared colours are in `src/theme.ts`. The gate generator is in `src/gates.ts`. Scores, settings and analytics are stored under `magnetdrop.proto-b.*`.

`pnpm sim` also takes `key=value` overrides, e.g. `pnpm sim gates pull=900 damping=1`, and `family=tunnel` limits the gate check to one family.

## Layout

| File | Purpose |
|---|---|
| `src/physics.ts` | Pure physics: vertical pull with inertia, rail sticking and launching, gate collisions, knock-back and hazards. Shared by the game and `sim`. |
| `src/gates.ts` | Pure gate generator: 8 gate families from small discrete choices (`catalogue()` lists all of them), the tutorial, difficulty tiers and a seeded stream. Moving parts read the run clock. Shared by the game and `sim`. |
| `src/world.ts` | Spawns and culls generated gates ahead of the camera and updates their moving parts. |
| `src/tune.ts` | Live tunables, their defaults, slider ranges and saved settings. |
| `src/theme.ts` | The shared `THEME` colours (same values as Prototype A). |
| `src/analytics.ts` | Local-only play analytics: events in localStorage and the summary shown in the panel. No network. |
| `src/panel.ts` | The tuning panel: sliders, reset, copy values, and Stats (copy JSON, clear). Pauses the game while open. |
| `src/audio.ts` | Synthesised sound: continuous layers driven every frame plus capped one-shot voices, a mute switch and offline renders for `verify`. |
| `src/game.ts` | State machine, scrolling camera, push-off and hazard deaths, scoring (one point per gate, centre bonus, clean streak), best score and analytics events. |
| `src/fx.ts` | Effects: shake, camera kicks, hit-stop, flashes (at most 3 big ones per second), particles, field pulses and run intensity. Tones down under reduced motion. |
| `src/render.ts` | Canvas renderer on a letterboxed 640x360 landscape playfield: steel facility, magnet rails, field particles, machinery and the orb. It also toggles the portrait "rotate" hint. |
| `src/main.ts` | Boot, input and the fixed-step loop. |
| `src/debug.ts` | Dev-only `window.__md` hooks used by `verify`. They are not included in production builds. |

The design draft and the prototype plans are in [`docs/`](docs/). [`docs/tuner.md`](docs/tuner.md) describes the earlier vertical tuner's sliders; for this branch, see [`docs/proto-b.md`](docs/proto-b.md). Research behind the effects is in [`docs/juice-research.md`](docs/juice-research.md).
