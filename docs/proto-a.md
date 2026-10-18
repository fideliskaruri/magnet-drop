# Prototype A: Vertical Magnet Drop

Live: https://fideliskaruri.github.io/magnet-drop/proto-a/

The orb falls; one tap flips its polarity (red or blue). Opposites attract, same colours repel, touching an attracting magnet sticks you to it, and flipping launches you off it. The camera follows you down and also advances on its own, with the orb kept in the upper middle so the gates below are visible.

## Gates

Every gate is a family in `src/gates.ts`, built from small discrete choices so `catalogue()` can list every gate the game can make. Moving and timed parts are pure functions of a gate clock (`stepGate` / `poseGate`), so `pnpm sim` replays them deterministically.

| Gate | What it does |
|---|---|
| Polarity | A red half and a blue half. The half matching your colour pushes you away; the other half lets you through. |
| Iris | Two hinged arms with magnetic cores. They swing open while your polarity matches them and close otherwise. |
| Flipper | Magnetic paddles that kick the orb when it arrives with the same colour, sending it across to the exit. |
| Rail | A magnetic rail you stick to and slide along; flip at the right point to launch to the exit. |
| Alternating | The door's polarity cycles on a timer (with a tick cue). Read the timing and pass when it lets you. |
| Iron | A heavy neutral iron slab. It ignores you but is dragged by the magnets at its ends, which your polarity drives. |

The first 5 gates are a fixed tutorial, one idea each: attraction, repulsion, stick-and-launch, polarity gate, mixed gate. After that, tiers start at gates 12, 22 and 36. The ramp comes from smaller openings, moving parts, stronger fields, alternating polarity and combined gates, not from just going faster. Families do not repeat back to back.

Wrong choices mostly cost trajectory: you get bounced, pushed the wrong way or held up.

## Failure

- **Primary:** the camera catches you (you fell behind or got trapped). The crusher at the top glows orange as it closes in.
- **Secondary:** rare saw blades guarding some gates. A saw can sit just below an opening, so you can score the gate and then die on its saw; the death is recorded against that gate.
- You can restart after 0.35 s; the run auto-readies after 1.5 s.

## Scoring

- +1 for each gate cleared.
- +1 bonus for a clean pass through the centre half of the opening.
- A combo counter (`CLEAN ×n`) counts clean gates in a row.
- Every clear gives a score pop and a short cue.

## Analytics (local only)

`src/analytics.ts` appends events to localStorage key `magnetdrop.proto-a.analytics`, keeping the last 5000. Nothing is sent over the network. Each event is `{t, sessionId, event, ...data}`:

- `session_start`: a new session begins after 30 minutes idle.
- `run_start`
- `gate_clear {gate, type, clean}`
- `death {cause: 'camera'|'hazard', gate, gateType, score, runMs}`
- `restart {msSinceDeath}`

## Reading the stats

Open the tuning panel (gear or T) and scroll to **Stats**. "Copy stats JSON" copies the summary; "Clear stats" wipes the log.

| Stat | How to read it |
|---|---|
| Runs per session | High means people keep retrying. |
| Median gates cleared | Typical run length in gates. |
| Retry after death | Share of deaths followed by a restart within 10 s. This is the "one more go" signal. |
| Median session length | Minutes from first to last event in a session. |
| Deaths before gate 3 | High means the opening is too hard or unclear. |
| Deaths by cause / gate type | Which failure and which gate kills most. A gate type far above the rest needs tuning. |
| Runs reaching 5 / 10 / 20 gates | Shape of the difficulty curve. |
| Days with a session | More than 1 means a voluntary return on another day. |
