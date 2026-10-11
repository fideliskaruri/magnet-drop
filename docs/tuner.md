# Tuner

The `tuner` branch combines `easy`, `sound` and `juice` into one build. It adds a slider panel so the physics can be tuned live.

Open the panel with the gear button (top right) or the T key. The game pauses while the panel is open. Every change applies at once and is saved on the device, so a reload keeps it. **Reset to defaults** clears your changes. **Copy values** copies only the values that differ from the defaults, ready to paste back into `DEFAULTS` in `src/tune.ts`.

Pressing the game area while the panel is open just closes the panel. It never flips polarity.

## New defaults

Feedback on every earlier build:
- momentum was too fast
- magnetic zones were too big, sometimes touching each other
- the same-colour push was too strong

| Setting | Before | Now |
|---|---|---|
| Gravity | 700 | 560 |
| Max fall speed | 380 | 300 |
| Top speed | 900 | 700 |
| Launch speed | 620 | 520 |
| Side drag | 0.6 | 0.9 |
| Same colour push (share of the pull) | 1.0 | 0.65 |
| Same colour bounce | 0.6 | 0.45 |
| Round zone size (share of designed reach) | 1.0 | 0.75 |
| Rail zone size | 110 px | 80 px |
| Gap between zones | none (zones could overlap) | at least 16 px |
| Screen push | 60 px/s | 50 px/s |

Pull strength stays at 3000 (round) and 2600 (rail). The pull fades linearly to zero at the zone edge, so smaller zones already mean gentler pulls. The old values are kept as `ORIGINAL` in `src/tune.ts`.

## Sliders

| Group | Slider | What it does |
|---|---|---|
| Speed | Gravity | How hard the orb falls |
| Speed | Max fall speed | Falling eases toward this |
| Speed | Top speed | Hard cap on any movement |
| Speed | Launch speed | Kick when you flip off a magnet |
| Speed | Side drag | How fast sideways drift dies |
| Magnets | Round magnet pull | Force at the centre of a round magnet |
| Magnets | Rail pull | Force next to a rail |
| Magnets | Same colour push | Push strength as a share of the pull |
| Magnets | Round zone size | Share of each magnet's designed reach |
| Magnets | Rail zone size | Reach out from a rail, in pixels |
| Magnets | Gap between zones | Zones shrink to keep at least this far apart |
| Magnets | Same colour bounce | Bounce off a same-colour magnet |
| Run | Wall bounce | Bounce off the side walls |
| Run | Screen push | Slowest scroll speed, so you can't hang on a magnet forever |
| Run | Shield recharge | Patterns to clear before the shield comes back |
| Feel | Effects | Scales shake, flashes and zoom (0 turns them off) |
| Feel | Volume | Master volume |
| Feel | Show zone edges | Draws a dashed outline where each pull starts |

## Zones never touch

`src/zones.ts` fits zones whenever a pattern spawns, and again whenever a zone slider moves:

1. New magnets get their tuned reach: the designed reach times **Round zone size**, or **Rail zone size** for rails.
2. Any two zones closer than **Gap between zones** are shrunk in proportion to how much room each has. The check covers magnets in the same pattern and the pattern just above.
3. A zone never shrinks below the orb radius plus a few pixels around the core, so every magnet still pulls before you touch it.

Magnets that were already placed keep the reach they were fitted to. A later spawn can shrink them further but never grows them back.

## Pattern changes

With the smaller zones, five patterns could no longer be cleared from every entry point. Their layouts were re-searched until `pnpm sim` cleared them from all 18 entry points:

| Pattern | Change |
|---|---|
| Pull past | One larger blue magnet at (150, 180) instead of a small red plus a blue at the far edge; spikes 0 to 150 |
| Catch and fling | Single red magnet at (130, 170), reach 260; the extra blue magnet is gone |
| Rail slide | Red magnet moved to (250, 80) with reach 290; rail shortened to y 240 to 440 |
| Corridor | Rails moved out to x 90 and 270 |
| Slalom | Left magnets at x 60; narrower spike rows (150 to 210) |

`pnpm sim` fits each pattern between every possible pattern above and below it. It then simulates each pattern at the smallest zone it can end up with. It reports a clash if any two zones are ever closer than the gap.

`pnpm sim gravity=700 fieldScale=1` (any `key=value` pairs) checks other slider values the same way. The fairness guarantee only covers the defaults.
