# Magnet Drop

A one-tap vertical arcade prototype. Your orb falls through a field of magnets and spikes. Tap to flip its polarity:

- **Opposites attract.** A cyan orb is pulled toward red magnets. A red orb is pulled toward cyan magnets.
- **Same colours repel.**
- **Touch an attracting magnet and you stick to it.** Flip again to launch off it.
- Touch spikes and you die. If you stall too long, the screen catches you.

Play it here: https://fideliskaruri.github.io/magnet-drop/

This is the `sound` branch: same game, reworked sound. Play it at https://fideliskaruri.github.io/magnet-drop/sound/

### Sound

Everything is synthesised live with WebAudio (`src/audio.ts`); there are no audio files. Notes sit on A minor pentatonic so flips, launches and chimes always fit together.

- **Field hum** rises in pitch and brightness as an attracting magnet pulls you in. **Repel buzz** is a beating, uneasy tone when a same-colour magnet pushes.
- **Flip** is a plucked note. Blue is round, red is bright and a fifth higher. Quick flips climb the scale.
- **Stick** is a heavy metallic clank, louder on harder hits. While stuck, a held tone trembles faster the longer you hang on.
- **Launch** is a sub kick, a whoosh and a rising chord. Chained launches climb higher.
- **Danger** is a pulsing tritone that gets louder and faster near spikes or the top of the screen. Skimming spikes and surviving gives a whoosh and a ting.
- **Death** crunches on spikes and gets swallowed on a stall, then falls on a short sigh. Milestones every 100 points chime, and passing your best sparkles.
- Sounds pan with the orb, bounces boing and walls knock. A limiter on the output keeps everything under full scale.

The speaker button in the top right (or the M key) turns sound off without flipping your orb. It remembers your choice.

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
pnpm verify [url] # headless Edge end-to-end checks against a running dev server; screenshots go to %TEMP%\agent-scratch\magnet-drop-tuner
```

Speeds, forces, zone sizes and bounces are in `src/tune.ts` and can be changed live from the in-game tuning panel (gear button or T). See [docs/tuner.md](docs/tuner.md) for the defaults, the sliders and how zones are kept apart. Other constants are in `src/config.ts` (effect tunables are in `JUICE`). The patterns are in `src/patterns.ts`.

`pnpm sim` also takes `key=value` overrides, e.g. `pnpm sim gravity=700 fieldScale=1`.

## Layout

| File | Purpose |
|---|---|
| `src/physics.ts` | Pure physics: magnet forces, sticking, launching, walls and spikes. Shared by the game and `sim`. |
| `src/patterns.ts` | The 10 hand-authored obstacle patterns (the first 3 are the tutorial). |
| `src/world.ts` | Spawns and culls patterns ahead of the camera. |
| `src/tune.ts` | Live tunables, their defaults, slider ranges and saved settings. |
| `src/zones.ts` | Fits magnet zones so no two come closer than the set gap. |
| `src/panel.ts` | The tuning panel: sliders, reset, copy values. Pauses the game while open. |
| `src/audio.ts` | Synthesised sound: continuous layers driven every frame plus capped one-shot voices, a mute switch and offline renders for `verify`. |
| `src/game.ts` | State machine, camera, stall pressure, scoring and best score. |
| `src/fx.ts` | Effects: shake, camera kicks and zoom, flashes (at most 3 big ones per second), particles, pulses and run intensity. Tones down under reduced motion. |
| `src/render.ts` | Canvas renderer on a letterboxed 360x640 playfield, with pre-rendered glow sprites. |
| `src/main.ts` | Boot, input and the fixed-step loop. |
| `src/debug.ts` | Dev-only `window.__md` hooks used by `verify`. They are not included in production builds. |

The design draft and the prototype plan are in [`docs/`](docs/). Research behind the effects is in [`docs/juice-research.md`](docs/juice-research.md).
