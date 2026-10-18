# Prototype B: Sideways Polarity Runner

Branch `proto-b`, live at https://fideliskaruri.github.io/magnet-drop/proto-b/. The plan it follows is in [prototype-ab-plan.md](prototype-ab-plan.md) (section "Prototype B").

## Movement

- The orb runs right on its own. The world scrolls at a base speed (`baseSpeed`, 190 px/s) that rises a little each difficulty tier (+5%, +10%, +17%).
- One input (tap, click, Space, Enter) flips polarity. **Red pulls up** toward the ceiling rail, **blue pulls down** toward the floor rail.
- The pull is an acceleration (`pull`) with drag (`damping`) and a speed cap (`maxVy`). Vertical speed changes smoothly, so every flip draws an arc. There is no impulse on a mid-air flip, which is what keeps it from feeling like Flappy Bird.
- Inside `railReach` of the attracting rail the orb grabs and **sticks**. Flipping while stuck **launches** off the rail at `launchSpeed` with a forward kick (`launchBoost`), plus a 60 ms hit-stop, a stretch trail and a camera kick.
- Hitting a gate face knocks the orb back (`backBounce`) instead of killing it. Whenever the orb is behind its home spot (36% across the screen), it gets extra forward speed (`recover`) to catch up.
- The playfield is landscape: 640x360 logical, letterboxed. On a portrait phone a short "Rotate for best view" hint shows, and the game stays playable letterboxed.

## Gates

`src/gates.ts` builds every gate from a small discrete spec, so `catalogue()` lists all 60 variants. Moving parts read the run clock, which keeps them deterministic for the simulator.

| Gate | What it does |
|---|---|
| Wall | An iron wall with one opening at the top, middle or bottom. Used in the tutorial. |
| Dual-polarity | A block splits the gate into upper and lower lanes. Each lane opens only for its colour; the wrong lane is barred. Variants alternate lane colours over time, invert them, or move the divider. |
| Pinball | Two polarity paddles hinged on the ceiling and floor. One colour swings the top paddle open, the other swings the bottom one. A closed paddle bounces you back or down. |
| Lane splitter | Upper, neutral middle (weak pull, hatched) and lower lanes. Some variants block one lane with iron or a grinder. |
| Magnetic tunnel | A narrow passage lined with magnets. The pull is weaker inside, so alternating polarity keeps you centred. Scraping the walls slows you down. |
| Repulsion door | Two door slabs in the door's colour. They part (repel) only while your polarity matches the door, so flip to its colour before you arrive. |
| Iron pendulum | A hanging iron mass swings toward the side your polarity favours. You either pass over it or skim the block beneath. Higher tiers mirror it and add a free swing. |
| Alternating rails | Three or four iron blocks, alternately on the ceiling and floor, so the route is a slalom. |

The first six gates are a fixed tutorial: upper pull, lower pull, switch mid-arc, a dual gate choice, a pinball gate, and a door that teaches recovery. Each one shows a hint. After that the stream is seeded and random within the current tier (tiers start at gates 14, 24 and 38), never repeating a family twice in a row. Moving dividers, alternating fields, narrow tunnels, mirrored pendulums and grinders arrive with the later tiers.

## Failure

- **Pushed off** (main cause): you're held or knocked back by a gate until the left edge of the screen passes you. The left edge glows and a danger sound rises as you get close.
- **Caught in the machine** (rare): you touch a grinder (orange hazard stripes and teeth).

Every other mistake can be recovered from. A tap 0.3 s after death restarts straight into a new run. Without a tap, the game returns to the menu after 1.6 s.

## Scoring

- +1 per gate passed.
- A centre pass (within the middle 30% of the free gap at the gate's key point) scores +2 instead, with a "+2 CENTRE" pop.
- The "CLEAN ×n" counter tracks gates cleared in a row without touching any machinery.
- Your best score is stored under `magnetdrop.proto-b.best`.

## Analytics

`src/analytics.ts` is local only: no network calls and no third parties. Events are appended to localStorage under `magnetdrop.proto-b.analytics`, keeping the last 5000. Each event is `{t, sessionId, event, ...data}`:

| Event | Data |
|---|---|
| `session_start` | Sent on the first event after 30 minutes idle. |
| `run_start` | |
| `gate_clear` | `{gate, type, clean, centre}` |
| `death` | `{cause: 'camera' or 'hazard', gate, gateType, score, runMs}`. `camera` means pushed off the left edge. |
| `restart` | `{msSinceDeath}` |

### Reading the stats

Open the tuning panel (gear button or T) and scroll to **Stats**. **Copy stats JSON** copies the summary and the raw events. **Clear stats** wipes them.

| Stat | Meaning |
|---|---|
| Runs per session | How many runs a sitting holds. Higher means "one more go". |
| Median gates cleared | Typical run length in gates. |
| Retry after death (10 s) | Share of deaths followed by a restart within 10 s. This is the main stickiness signal. |
| Median session | Typical session length. |
| Deaths before gate 3 | Share of deaths in the first three gates. High means the opening is too hard or unclear. |
| Deaths by gate type | Where runs end. One family dominating means it needs tuning. |
| Runs reaching 5 / 10 / 20 | The progression funnel. |
| Days played | Distinct days with a session, for return play. |

To compare with Prototype A, copy the JSON from each build after the same number of sessions.

## Checks

- `pnpm sim gates` drops the orb into every catalogue gate from 7 heights, both polarities and 2 speeds. Timed gates are also tried at 4 clock phases, for 2856 cases. A beam search over the real physics must clear each one; a case the narrow beam misses is retried with a wide beam before it counts as a failure.
- `pnpm sim runs 12` plays 12 seeded 45-gate courses with the camera, speed tiers and spacing exactly as in the game.
- `pnpm verify` runs headless Edge against `pnpm dev --port 5182 --strictPort`. It checks the movement, every gate, scoring, both deaths, restart, analytics, the panel and the frame budget, and saves screenshots to `%TEMP%\agent-scratch\magnet-drop-proto-b`.
