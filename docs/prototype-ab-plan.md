Here are two clean handoff plans you can give another agent.

## Prototype A — Vertical Magnet Drop

### Goal
Test whether the original vertical loop is fun enough on its own:

> fall → get pulled/pushed by magnets → flip polarity → sling through magnetic gates → survive → repeat

This prototype should answer one question:

> Does vertical magnetic movement create enough “one more try” behavior?

### Core movement
The player is a metallic orb.

Gravity continuously pulls the orb downward.

The player has one input:

> tap / click / space = flip polarity

Polarity switches between two states, for example red and blue.

Opposite polarity attracts. Same polarity repels.

Momentum should matter. Flipping should curve or redirect the orb rather than instantly teleporting its path.

The player should sometimes be able to stick briefly to an attracting magnetic surface, then flip polarity to launch away.

### Main obstacle philosophy
Avoid generic spikes as the main source of failure.

Use **magnetic gates and deflectors** instead.

The game should mostly punish bad decisions through:

- bad trajectory
- being bounced away
- losing speed
- getting pushed into the wrong lane
- falling behind the camera

Instant death should exist, but be relatively rare.

### Gate types

**Polarity gate**  
A two-part gate with red and blue sections. Your current polarity determines which side opens or repels.

**Magnetic iris**  
Two hinged metal arms open when the player's polarity matches the gate condition.

**Pinball flippers**  
Magnetic paddles physically kick the orb depending on polarity.

**Rail gate**  
A magnetic rail attracts the player and lets them slide along it. Flipping launches them toward the exit.

**Alternating gate**  
A gate periodically changes polarity, so the player must read timing as well as their own state.

**Neutral iron gate**  
Heavy ferromagnetic structures that react to nearby magnets rather than directly to the player.

### Failure
Primary failure:

> camera catches the player because they lost too much downward progress or got trapped.

Secondary failure:

> collision with rare dangerous machinery.

This keeps the game about **movement mastery**, not avoiding random spikes.

### Scoring
Keep scoring simple:

> +1 per gate cleared

Then optionally:

- +1 bonus for a clean center pass
- combo for consecutive clean gates
- near-miss bonus later

Don't use distance as the main score if gates are the meaningful unit.

### Difficulty curve
First 3–5 gates teach one idea each:

1. attraction
2. repulsion
3. stick-and-launch
4. polarity gate
5. mixed gate

Then gradually introduce:

- smaller openings
- moving magnetic parts
- stronger fields
- alternating polarity
- combined gates

Avoid simply making everything faster.

### Camera
Portrait orientation.

Player sits around the upper-middle portion of the screen so they can see upcoming gates below.

Camera follows downward but also slowly advances so the player cannot wait forever.

### Art direction
Dark industrial sci-fi.

Player:
- metallic orb
- glowing red/blue core

Environment:
- iron
- dark steel
- magnetic machinery
- very limited neon accents

Magnetic fields:
- subtle particles and distortion
- directional streaks when attraction/repulsion is strong

The goal is not “neon geometry game.”
It should look like a strange electromagnetic machine.

### Juice
Keep feedback restrained.

Flip:
- tiny pulse
- soft haptic
- polarity sound

Strong launch:
- stronger haptic
- brief hit-stop
- trail stretch
- subtle camera shake

Clean gate:
- score pop
- short audio cue

Death:
- immediate feedback
- restart available in under one second

### Prototype scope
Build only:

- orb physics
- two polarities
- attraction/repulsion
- stick-and-launch
- 5–8 gate patterns
- gate scoring
- simple camera chase
- instant restart
- minimal sound/haptics
- analytics hooks

Do not build:

- shop
- skins
- upgrades
- powerups
- account system
- progression map
- ads

---

## Prototype B — Sideways Polarity Runner

### Goal
Test a more readable, web-friendly version where the player moves horizontally and polarity controls vertical movement.

The core loop becomes:

> auto-move right → flip polarity → get pulled toward ceiling/floor → pass through magnetic gates → recover → repeat

The key question:

> Is horizontal forward motion easier to read and more immediately playable than vertical falling?

### Core movement
The player automatically moves from left to right at a constant base speed.

The player has one input:

> tap / click / space = flip polarity

Instead of polarity meaning red/blue only, it maps directly to vertical force:

- one polarity pulls upward
- the opposite pulls downward

The player should not snap between ceiling and floor.

The orb keeps momentum, so each flip creates an arc.

That is very important.

Otherwise it risks becoming a Flappy Bird clone.

### Movement feel
Think:

- smooth vertical acceleration
- readable arcs
- inertia
- strong but not binary magnetic pull

The player should be able to:

- skim along ceiling or floor
- switch midway through an arc
- slingshot off magnetic rails
- recover from mistakes

### Main obstacle philosophy
The world scrolls toward the player.

Instead of spike walls, use gates that react to polarity.

This version should feel more like navigating a magnetic machine than dodging hazards.

### Gate types

**Dual-polarity gate**  
Top half prefers one polarity, bottom half the other.

Player must flip early enough to enter the correct lane.

**Pinball gate**  
Two magnetic paddles swing open or closed based on polarity.

Wrong polarity doesn't necessarily kill the player; it may bounce them backward or downward.

**Lane splitter**  
Three lanes:
- upper route
- middle neutral route
- lower route

Polarity determines which route is easiest to enter.

**Magnetic tunnel**  
A narrow passage lined with magnets. The player must alternate polarity to stay centered.

**Repulsion door**  
A door opens by repelling away from the player when the correct polarity is active.

**Iron pendulum**  
A hanging ferromagnetic mass swings toward whichever side is magnetically activated.

**Alternating ceiling/floor rails**  
The player sticks briefly to one side, then flips to launch across the screen.

### Failure
Primary failure should be:

> getting pushed off-screen to the left because the environment advances faster than you recover.

Secondary failure:

> hitting dangerous machinery or being crushed between gates.

Again, avoid making every mistake instant death.

### Scoring
Best initial scoring:

> +1 per gate passed

Then later:

- center-pass bonus
- no-contact streak
- polarity-perfect streak
- speed multiplier

### Difficulty curve
First sequence:

1. upper pull
2. lower pull
3. switch mid-arc
4. gate choice
5. pinball gate
6. recovery section

Then introduce:

- moving gates
- alternating polarity fields
- narrow tunnels
- sequences requiring two flips
- speed increases

### Camera
Landscape could work, but for mobile/web portrait is still possible.

I would test **landscape first on web** because it gives the player more look-ahead distance.

If targeting mobile later, compare:
- 16:9 landscape
- 9:16 portrait with compressed look-ahead

The web prototype should prioritize readability over eventual store format.

### Art direction
Same world as the vertical prototype so the mechanic identity stays consistent.

Dark industrial electromagnetic facility.

Ceiling and floor can contain large magnet rails.

The environment should clearly communicate:

- upper magnetic field
- lower magnetic field
- neutral safe zones
- polarity-reactive machinery

Use red and blue sparingly and consistently.

### Juice
Vertical polarity changes should feel physical.

Flip:
- quick field pulse from player
- background particles reverse direction
- brief pitch shift in sound

Strong surface launch:
- larger haptic
- stretch trail
- camera kick

Gate clear:
- compact score feedback

### Prototype scope
Build only:

- horizontal auto-scroll
- vertical magnetic force
- polarity flip
- inertia
- 5–8 gate types
- gate scoring
- recovery mechanics
- instant restart
- simple sound/haptics
- analytics hooks

Do not add:
- enemies
- currency
- cosmetics
- upgrades
- powerups
- missions

---

## Build both so they are actually comparable

Use the **same**:
- art style
- orb
- sound language
- scoring format
- restart behavior
- session analytics
- approximate difficulty

Then the main variable is the movement model:

**A:** vertical falling + 2D magnetic steering  
**B:** horizontal movement + vertical polarity steering

That gives you a real A/B concept test instead of comparing two totally different games.

Track:

- runs per session
- median gates cleared
- retry-after-death rate
- session length
- deaths before gate 3
- deaths by gate type
- percentage of players reaching 5 / 10 / 20 gates
- voluntary second session

If one version consistently produces more retries and longer sessions, that's the one you continue.

My expectation going in: **vertical is more distinctive**, but **sideways may be easier to understand immediately**. I would not choose between them before testing.