# Magnet Drop: 48-hour prototype plan

Source: `magnet-drop-game-draft.md` (section "What I'd actually prototype first").
Goal: answer one question. Does flipping polarity to slingshot a falling ball around obstacles feel good?

## Decisions (owner-confirmed)

| Topic | Decision |
|---|---|
| Tech | Vite + TypeScript strict + HTML canvas 2D. No React, no engine. Playable in a phone browser. |
| Repo | New GitHub repo `fideliskaruri/magnet-drop`, cloned at `D:\code\magnet-drop`, registered with `create_project(path)`. |
| Magnet types | Point magnets and magnetic rails, each in red and blue. |
| Magnet contact | Magnets are solid. An attracted orb sticks to the magnet; flipping polarity launches it off. |

## Decisions I'm proposing (critic and owner can veto)

1. **Stall pressure.** Sticking to a magnet must not be a safe place to wait forever. The camera keeps scrolling down at a minimum speed. If the orb leaves the top of the screen, it dies. This is a tunable constant (`CAMERA_MIN_SPEED`, 0 disables it).
2. **No Tailwind or shadcn.** There's no DOM UI to speak of. The HUD, the Play screen and the death flash are drawn on the canvas. This departs from the personal stack on purpose.
3. **Hosting.** GitHub Pages via a GitHub Actions workflow, so the owner can open it on a phone. The local dev server uses `--host` for LAN testing too.
4. **Test hook.** In dev builds only (`import.meta.env.DEV`), expose a read-only `window.__md` snapshot (state, orb position and velocity, polarity, score, pattern index) plus `window.__md.seed(n)` for deterministic pattern order. Playwright uses it to assert real game state. It's stripped from production builds.

## Scope

In: falling orb, tap to flip polarity, point magnets, rails, attract/repel physics, solid magnet contact (stick and launch), spikes, side walls, score from distance, best score in `localStorage`, instant death and restart, 10 hand-made patterns, the minimum juice (flip pulse, colour trail, death burst, haptic tick), and a single Play screen.

Out (per the draft): progression, procedural generation, shop, skins, Overcharge, Perfect Flip, combos, near-miss scoring, collectibles, moving/rotating/pulsing magnets, mines, audio beyond one flip click and one death sound, and menus beyond Play.

## Architecture

Single package (no monorepo, since it's one app).

```
magnet-drop/
  index.html              full-screen canvas, viewport meta, no scroll or zoom
  src/
    main.ts               boot, resize, start loop
    config.ts             every tuning constant in one place
    types.ts              Vec2, Polarity, Orb, PointMagnet, Rail, Spike, Pattern, GameState
    loop.ts               fixed timestep at 120 Hz with an accumulator; render once per frame
    input.ts              pointerdown anywhere = flip (also Space for desktop); ignores multi-touch repeats
    physics.ts            gravity, magnetic forces, integration, collisions, stick/launch
    world.ts              pattern stream: spawns patterns below the camera, culls ones above
    patterns.ts           the 10 hand-made patterns as data
    game.ts               state machine: ready -> playing -> dying -> ready
    render.ts             background, walls, magnets, rails, spikes, orb, trail, HUD
    fx.ts                 flip pulse, trail buffer, death particles, screen shake, freeze frame
    audio.ts              WebAudio: synthesised flip click and death sound (no asset files)
    debug.ts              dev-only window.__md hook
  .github/workflows/pages.yml
  AGENTS.md               repo rules (stack, no unit tests, how to verify)
  README.md
```

### Coordinates and scaling

- Logical playfield 360 x 640 (9:16). The canvas scales uniformly to fit the window, letterboxed, using devicePixelRatio for crisp lines.
- World y grows downward. The camera tracks the orb so the orb sits at 35% of screen height (upper-middle, per the draft). The camera only moves down, never up.
- Side walls at x = 0 and x = 360 are solid and neutral (the orb bounces with restitution 0.4).

### Physics (all values in `config.ts`, starting points to tune)

- Fixed step dt = 1/120 s.
- Gravity 700 px/s². Terminal fall speed 380 px/s. Max total speed 900 px/s.
- Horizontal air damping 0.6 per second, so sideways speed bleeds off and the orb settles back into falling.
- Orb radius 11.
- **Polarity rule.** Opposite colours attract, same colours repel. A red magnet attracts a blue orb and repels a red one. Sign s = +1 attract, -1 repel.
- **Point magnet force.** Body radius r_m (14 to 22), field radius R (130 to 180), strength k. With d = distance from orb centre to magnet centre and u = clamp(1 - d/R, 0, 1), the acceleration is `s * k * u^2` along the unit vector toward the magnet. The smooth falloff avoids infinite spikes near the core and is easy to tune by feel. Start with k = 2600 px/s².
- **Rail force.** A rail is a line segment with a thickness. Use the closest point on the segment, the same falloff with R around 90, and a direction perpendicular to the rail toward or away from it. Start with k = 2200 px/s².
- Forces from all magnets in range add up. Gravity always applies, except while stuck.
- **Flip.** Changing polarity takes effect immediately on the next physics step. There's no velocity snap, so momentum carries the curve.

### Solid contact: stick and launch

- If the orb overlaps a magnet body (circle-circle for points, circle-capsule for rails), push it out along the contact normal.
- If the magnet is attracting at that moment, the orb **sticks**. Velocity is zeroed and the orb is pinned to the contact point. Gravity is ignored while stuck.
- While the orb is stuck, a flip to repel **launches** it. The impulse is `LAUNCH_SPEED` (start at 620 px/s) along the contact normal, then the normal repel field keeps pushing. This is the slingshot moment, so it gets the strongest feedback.
- If the magnet is repelling at contact (rare, since the field pushes you away first), bounce with restitution 0.6.
- A stuck orb still dies if stall pressure pushes it off the top of the screen (decision 1).

### Hazards

- Spikes are rows of triangles with a solid base. Collision uses circle vs triangle (or a slightly shrunk hitbox for fairness, about 2 px of forgiveness). Touching one is instant death.
- Spikes are yellow/white so they're never confused with polarity colours.

### Game flow and timing

- **ready.** Shows the title "MAGNET DROP", BEST, the orb and "TAP". The first tap starts the run (that tap doesn't flip polarity).
- **playing.** Score = floor(max depth / 10). The HUD shows the score at top centre and nothing else.
- **dying.** A 60 ms freeze frame, then the orb bursts into particles and the screen shakes. After 600 ms, a tap restarts straight into **playing**. If there's no tap, it auto-returns to **ready** after 1.5 s. Death to playing again in under 1 s.
- Best score is saved to `localStorage` under the key `magnetdrop.best`.

### Patterns (the 10 hand-made obstacle chunks)

Each pattern is data: height, plus lists of point magnets, rails and spikes in pattern-local coordinates. The world stacks patterns vertically with a short gap (about 120 px) between them. Order: patterns 1 to 3 in fixed order as a tutorial, then random picks from 4 to 10 with no immediate repeats, using a seeded random so tests are deterministic.

| # | Name | What it teaches |
|---|---|---|
| 1 | Open drop | One red magnet to the side, no hazards. Flip and see the orb bend. |
| 2 | Pull past | A spike shelf on the left, a magnet on the right. Attract to clear the spikes. |
| 3 | Push past | Same layout, but the right side is the hazard. Repel to clear. |
| 4 | Catch and fling | A magnet sits above a spike floor that has a gap off to the side. Stick to the magnet, flip, launch through the gap. |
| 5 | Ping-pong | Blue and red magnets on opposite walls with spikes underneath. Flip to bounce between them toward the gap. |
| 6 | Rail slide | A vertical red rail along the left wall with a spiked ledge sticking out from the right wall. Ride the rail past it, then flip off. |
| 7 | Rail launch | A slanted rail ramps toward a gap in a spike floor. Stick, then flip to launch along the normal. |
| 8 | Corridor | Two rails form a narrow channel with spikes at its exit except one gap. Steer inside the channel. |
| 9 | Slalom | Alternating red and blue magnets left and right with spike nubs between them. Rhythmic flips. |
| 10 | Rest | Empty breather section with one harmless magnet to play with. |

Every pattern must be cleanable with correct timing, and each pattern must be lethal if you never flip (so the game can't be beaten by doing nothing). Exception: patterns 1 and 10.

### Rendering and the minimum juice

- Dark navy background with a faint scrolling grid for a sense of speed.
- Magnets: a glowing filled circle (red #ff4a2e / blue #2ee6ff) with a soft halo matching the field radius at very low alpha. Rails: glowing capsules in the same colours.
- Field hint: when the orb is inside a field, draw a few short particle streaks between the orb and the magnet, moving toward it (attract) or away (repel). This is the "particles bend" readability from the draft, cheaply done.
- Orb: dark chrome circle with a polarity-coloured core and a trail of the last 20 positions in the same colour.
- Flip: a ring pulse expands from the orb (120 ms), `navigator.vibrate(8)` where supported, and the flip click sound.
- Launch from stuck: a bigger pulse, a 6 px screen shake for 120 ms, and `vibrate(20)`.
- Death: freeze frame, 24 particles, shake, and `vibrate([30, 40, 30])`.
- Render runs once per animation frame. It interpolates between the last two physics states so motion stays smooth on 60, 90 and 120 Hz screens.

### Mobile details

- `touch-action: none`, no text selection, no double-tap zoom, no context menu.
- Use `pointerdown` (not click) for instant response.
- Pause the loop when the tab is hidden, and reset the accumulator on resume so there's no physics jump.
- AudioContext is created on the first tap (browser autoplay rules).

## Implementation lanes

Implementation agents run on GPT-6 Luna. Each lane is scoped to about 30 minutes. Every brief includes the owner's standing rules (worktrees under `D:\code\magnet-drop-worktrees\`, no `git add .`, `Refs:` trailers, Ops Tracker reporting, scratch files in `%TEMP%\agent-scratch`, headless Playwright, no unit tests, explicit sub-agent models).

| Lane | Work | Depends on |
|---|---|---|
| L0 (coordinator) | Create the repo and clone it to `D:\code\magnet-drop`. Register the project. Set up the Ops Tracker project and feature. Scaffold Vite + TS strict, `config.ts`, `types.ts` with the final interfaces, `AGENTS.md`. Push `main`. | none |
| L1 | Loop, input, camera, walls, orb rendering and trail, the ready/playing/dying state machine, score, best score, HUD, Play screen, dev hook. | L0 |
| L2 | `physics.ts`: gravity, point and rail forces, solid contact, stick and launch, spike collision. Plus magnet, rail and spike rendering and the field-hint particles. | L0 |
| L3 | `patterns.ts` (all 10) and `world.ts` (stacking, seeded order, culling). | L0 |
| L4 | `fx.ts`, `audio.ts`, haptics, render interpolation polish, GitHub Pages workflow. | L1 |

L1, L2 and L3 run in parallel against the shared `types.ts`. L4 starts once L1 lands. I merge each lane, review it for overcomplication, and check it in the browser before the next phase.

## Verification (real, no unit tests)

All checks use headless Playwright with a phone viewport (390 x 844, touch enabled). Screenshots go to `%TEMP%\agent-scratch\magnet-drop`.

1. **Boot.** The page loads with no console errors. The ready screen renders. Screenshot.
2. **Start and flip.** Tap starts the run (`__md.state === 'playing'`). Each later tap flips `__md.polarity`. Screenshot of each polarity.
3. **Attract and repel.** On pattern 1 with a fixed seed, sample the orb's x velocity for 300 ms in each polarity. It must point toward the magnet when attracting and away when repelling.
4. **Stick and launch.** Drive the orb onto the pattern 4 magnet. Assert `__md.stuck === true` and speed 0. Tap. Assert speed ≥ 600 and direction along the normal.
5. **Death and restart.** Never flip on pattern 2. Assert `dying`. Tap and assert `playing` again in under 1 s, with score reset and best preserved after reload.
6. **Stall pressure.** Stay stuck. Assert death once the orb leaves the top of the screen.
7. **Each pattern.** Screenshot all 10 patterns (using the seed) so I can check readability and fairness by eye.
8. **Performance.** Run the game for 30 s headless and check that the frame times stay steady with no growth in object counts (patterns get culled).
9. **Production build.** `pnpm build` passes `tsc --noEmit` strict, the dev hook is absent from the bundle, and the Pages deployment serves the game.

The final check is the owner playing it on a phone, since feel can't be verified by a script. I'll send the Pages URL.

## Risks

- **Feel tuning is the whole point.** The constants are guesses. Expect one dedicated tuning pass after it's playable, ideally with the owner on a phone. A dev-only `?tune` query flag could show sliders for gravity, k, R and launch speed. It's cheap and would speed up tuning a lot (proposed, not in scope unless approved).
- **Sticking can feel sticky in a bad way.** If the stick-and-launch loop feels slow, a short auto-release (for example 1.2 s) is the fallback.
- **Pattern fairness.** Hand-made patterns can be impossible at the tuned values. Each pattern needs a played clear before sign-off.
