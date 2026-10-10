# Magnet Drop — Core Game Draft

## High concept

**Magnet Drop** is a fast, one-touch vertical arcade game where the player controls the polarity of a falling metal orb.

You do **not** steer directly.

Instead, you tap to switch between:

- **Positive polarity**
- **Negative polarity**

Magnets placed throughout the level either attract or repel the player depending on the current polarity.

The challenge comes from manipulating those forces at the right moment to curve around hazards, squeeze through gaps, collect items, and keep falling.

The fundamental loop is:

> **Fall → read the magnets → flip polarity → alter trajectory → narrowly survive → repeat**

A run should be understandable within about **10 seconds**.

---

# Core Controls

There should initially be only **one input**.

### Tap

Switch polarity instantly.

For example:

**Blue state → Red state → Blue state → Red state**

No virtual joystick.

No movement buttons.

No jump button.

The player's skill comes entirely from **timing**.

That simplicity is one of the game's strongest attributes.

---

# Movement

The orb continuously falls because of gravity.

The player has some momentum, so changing polarity does not immediately snap them in another direction.

Instead, nearby magnetic forces curve the trajectory.

That gives us satisfying movements such as:

- slingshots
- arcs
- spirals
- near misses
- sudden accelerations

The movement should feel slightly exaggerated rather than physically accurate.

We're making something satisfying, not simulating electromagnetism.

---

# Magnetic Objects

## Standard magnet

The fundamental object.

For example, a red magnet could:

- attract the orb when the orb is blue
- repel the orb when the orb is red

A blue magnet does the reverse.

This should be extremely readable visually.

---

## Magnetic rail

A long strip creating a continuous field.

These could:

- pull the player alongside a wall
- push them through a narrow corridor
- create curved paths

Example:

```text
| RED RAIL |
      ●
       \
        \
```

Switching polarity near the rail launches you away.

---

## Dual magnets

Two opposing magnets create interesting traversal situations.

Example:

```text
BLUE       RED
  ◉         ◉

       ●
```

The player switches polarity to bounce between them.

This could become one of the game's signature interactions.

---

## Rotating magnets

Magnets rotate around a pivot.

Their field therefore constantly changes direction.

The player must time the polarity flip.

Good for later difficulty.

---

## Pulsing magnets

Magnetic field turns on and off rhythmically.

This introduces timing without introducing another control.

---

## Moving magnets

Magnets themselves travel horizontally or vertically.

Again, this changes the environment without changing the control scheme.

---

# Hazards

## Spikes

The most basic hazard.

Instant death.

Should be visually obvious.

---

## Electric barriers

Energy beams connecting two points.

Some might periodically turn off.

---

## Crushing walls

Two walls slowly close toward each other.

The player must quickly navigate through.

---

## Magnetic mines

Small objects attracted toward the player depending on polarity.

This creates an interesting situation:

> changing polarity changes both **your movement** and **the hazard's movement**.

That could be very good.

---

## Dead zones

Areas where magnetic forces disappear.

The player temporarily depends on existing momentum.

These could create moments of tension.

---

# Collectibles

The prototype probably doesn't need these, but later:

## Energy shards

Placed along risky trajectories.

Getting them increases score.

The player constantly decides:

> safe route  
> or  
> dangerous route with more points

---

## Combo pickups

Collect several without dying to build a multiplier.

Example:

`x1 → x2 → x3 → x5`

The higher the multiplier, the more visually intense the game becomes.

---

# Scoring

For an endless mode, I'd combine three things.

### Distance

The deeper you fall, the higher the score.

### Near misses

Passing very close to hazards grants bonuses.

### Chains

Successfully using several magnets without touching a neutral surface builds a combo.

Something like:

> **MAGNET CHAIN ×7**

That creates moments players want to screenshot/share.

---

# Difficulty progression

Difficulty shouldn't simply mean:

> everything moves faster.

We can progressively introduce new rules.

### Early

- static magnets
- wide gaps
- slow falling
- clear layouts

### Medium

- moving magnets
- magnetic rails
- narrow passages
- more momentum

### Advanced

- rotating magnets
- mines
- pulsing fields
- polarity gates
- dense combinations

Importantly, the player is still only:

> **tapping**

We're increasing the complexity of the **world**, not the controller.

---

# Potential signature mechanic: Overcharge

I think this might make the game more distinctive.

Using magnets charges the orb.

A meter gradually fills.

When fully charged:

> **OVERLOAD**

For a few seconds:

- gravity increases
- movement becomes faster
- score multiplier rises
- magnetic effects become exaggerated
- visual effects explode

Now the game naturally alternates between:

**precision**

and

**chaotic high-speed sequences**.

That could make runs much more exciting.

---

# Another possible mechanic: Perfect Flip

If the player changes polarity at exactly the right moment near a magnet:

> **PERFECT**

The magnet launches them much harder.

Like hitting the perfect timing window in a rhythm game.

Example:

`Normal flip → small push`

`Perfect flip → WHOOOOSH`

This adds depth without adding controls.

I really like this mechanic.

---

# Run structure

I wouldn't make individual levels initially.

Start with:

### Endless descent

Procedurally assembled chunks.

Each chunk contains a short magnetic challenge.

For example:

```text
Chunk A
simple slingshot

↓

Chunk B
two opposing magnets

↓

Chunk C
moving spikes

↓

Chunk D
rotating magnet

↓

Chunk E
rest section
```

Then repeat with increasingly difficult combinations.

This lets us build relatively few components while generating many runs.

---

# Art Direction

I'd avoid realistic metal/factory visuals.

They would make the game feel generic.

Instead I'd go for:

## Minimalist neon sci-fi

Dark background.

Very clean shapes.

Strong glowing colors.

Something somewhere between:

- futuristic laboratory
- abstract arcade
- synthwave
- high-tech electromagnetic visualization

The environment should almost look like you're travelling through some enormous experimental machine.

---

# Color language

Extremely important because polarity needs to be readable instantly.

### Positive

**Electric red/orange**

### Negative

**Electric cyan/blue**

### Neutral environment

Mostly:

- charcoal
- dark navy
- black
- muted grey

Hazards might use:

**yellow / white**

so they aren't confused with magnetic polarity.

The screen should never become visually noisy.

---

# The player

A simple metallic sphere.

Not a character.

Something like:

> dark chrome orb with glowing electromagnetic core.

When blue:

- cyan core
- cyan trail

When red:

- red core
- red trail

When switching:

A quick energy pulse runs across the ball.

Something like:

`BLUE ● → ⚡ → ● RED`

The response needs to be immediate.

---

# Magnetic fields

Do **not** show giant scientific field diagrams constantly.

Instead use subtle particles.

When the player approaches a magnet:

```text
magnet  )))))) ●
```

Particles bend toward or away from it.

The player subconsciously learns:

> I'm being pulled that way.

At high speeds these particles stretch into trails.

---

# Camera

Vertical portrait orientation.

Something like:

**9:16 mobile screen**

Player remains around the upper-middle of the screen while the environment moves upward.

This gives more visibility below, where the player is heading.

At high speed:

- camera zooms slightly out
- trails increase
- screen shake becomes stronger

---

# Juice

This genre lives or dies on **feel**.

Even the ugly prototype should eventually test some of these.

### Polarity flip

`tap`

→ tiny freeze frame  
→ pulse  
→ haptic tick  
→ polarity sound

### Perfect launch

→ stronger haptic  
→ camera shake  
→ chromatic distortion  
→ long particle trail

### Near miss

→ tiny slow-motion moment

### Death

Rather than simply disappearing:

> sphere destabilizes → electromagnetic explosion → instant restart

Restart should be **very fast**.

Ideally:

`death → 0.5–1 second → playing again`

---

# Audio

Minimal electronic soundscape.

Not necessarily music-heavy.

The gameplay itself generates rhythm:

**tap**
*chk*

**magnet activates**
*mmmmmmm*

**perfect flip**
*WHUMP*

**near miss**
*zzzip*

**combo**
*ding → ding → DING*

With enough audio feedback, the game almost becomes partly rhythmic.

---

# UI

Extremely sparse.

During gameplay:

```text
        12,840

         ×4
```

That's basically it.

Maybe polarity is represented through the player's color rather than a separate UI indicator.

No unnecessary buttons.

---

# Menu

Something ridiculously simple:

```text
MAGNET DROP

BEST
42,781

     ●
    TAP
```

Tap anywhere.

Game starts.

That simplicity fits the entire concept.

---

# Monetization later

I wouldn't design the prototype around monetization.

But the game naturally supports:

- orb skins
- trail effects
- electromagnetic themes
- environments
- rewarded continue
- one-time remove-ads purchase

No gameplay advantage necessary.

---

# What I'd actually prototype first

For the first **48-hour build**, almost all of this disappears.

We only build:

1. Falling sphere.
2. Tap switches polarity.
3. Two types of magnets.
4. Attraction/repulsion physics.
5. Spikes.
6. Score from distance.
7. Instant death/restart.
8. About 10 hand-made obstacle patterns.

No progression.

No shop.

No procedural system.

No skins.

No Overcharge.

No menus beyond **Play**.

The entire prototype exists to answer one question:

> **Does flipping polarity to slingshot a falling ball around obstacles feel fucking good?**

If the answer is yes, *then* Perfect Flips, combos, progression, procedural chunks and the stronger art direction become worth building.