# Juice research: how to make Magnet Drop feel intense

Goal for the `juice` variant: make every event hit hard and make deep runs feel like they are heating up, without changing physics or hiding hazards.

## What the sources say

| Source | Takeaway we used |
|---|---|
| Martin Jonasson and Petri Purho, "Juice it or lose it" (GDC Europe 2012) | Layer many small responses on every action: tweened scale pops, particles, colour flashes, trails, a reacting background. Juice is the sum of cheap layers, not one big effect. |
| Jan Willem Nijman (Vlambeer), "The art of screenshake" (INDIGO 2013) | Hit pause (freeze a few frames on impact), camera kick in the direction of force, more and bigger particles, impact flashes, afterimages, "fake fast" stretching of fast objects, and big layered explosions on death. Overdo it, then dial back. |
| Squirrel Eiserloh, "Juicing your cameras with math" (GDC 2016) | Trauma based shake: events add trauma (0..1), it decays linearly and shake amplitude is trauma squared, driven by smooth noise rather than white noise, with a little rotation. Small events stay subtle, big ones spike. |
| Steve Swink, "Game Feel" (2008) | Feel comes from tight input response plus "polish" that sells physical properties: squash on contact, stretch with speed, anticipation before release. |
| Celeste (Maddy Thorson, Noel Berry) | Very short freeze frames on dashes and deaths, directional screen shake, a death burst that pulls in then explodes, and an option to reduce shake. Readability first: effects never obscure hazards. |
| Downwell, Nuclear Throne, Hotline Miami, Super Hexagon, Geometry Dash | Intensity escalates with the run: colour and background shift, pulse to a beat, faster rhythm. Limited, saturated palette keeps hazards readable even when everything moves. |
| WCAG 2.3.1 "Three flashes or below threshold" | No more than three general flashes in any one second; large saturated (especially red) flashes are the most hazardous. Provide a reduced-motion path. |

## What we chose and why

- **Trauma shake with smooth noise and a little rotation** (Eiserloh). Flips add a touch, sticks a bit, launches a lot, deaths max it. Shake is squared, so flips never feel noisy.
- **Directional camera kick** (Nijman, Celeste): launches and sticks shove the camera along the impact direction, then it springs back.
- **Hit pause**: kept the 35 ms launch freeze and added an 18 ms freeze on hard sticks. During the freeze the orb renders as a white impact frame.
- **Zoom punch**: launches briefly zoom out (wider view, so nothing gets hidden), deaths zoom in (the run is over, so focus wins).
- **Squash and stretch**: the orb stretches along its velocity and wobbles flat against magnets on contact.
- **Anticipation**: while stuck, a charge ring winds up around the orb so the launch feels loaded.
- **Launch**: double shockwave, speed lines, a cone of sparks behind the orb, afterimages and a short red/cyan colour split on the orb (local chromatic aberration, cheap and readable, unlike a full screen split).
- **Flip cue**: the orb pops, and every magnet that now pulls you flashes a ring, so the flip reads instantly.
- **Pull tether**: a crackling arc links the orb to a strongly attracting magnet.
- **Near miss**: grazing spikes without dying gives sparks, a CLOSE popup and a small kick. Spikes near the orb glow hotter, so danger is easier to see, not harder.
- **Milestones**: every 100 points the score pops and a huge outlined number appears behind the playfield; every 500 also gets a soft screen flash.
- **Chains**: launches in quick succession show x2, x3 and heat things up.
- **Death**: impact frame, then shards, sparks, rings, a flash, max shake, a zoom in and slow motion for the debris while the world dims.
- **Restart**: an iris ring and a short zoom settle, so the new run starts with a bang.
- **Heat** (Downwell, Super Hexagon): depth, speed and chains feed a 0..1 heat value. Heat shifts the background toward violet, speeds up the grid beat pulse (96 to 160 BPM), adds rising speed streaks, strengthens the edge glow and scales particles and shake.
- **Stall danger**: when the camera is about to catch the orb, the top edge glows hot and shows hazard stripes.

## Safety and readability rules

- Big full screen flashes go through one limiter: at least 0.34 s apart, so never more than 3 per second, and they are soft (max 35% alpha, 8% with reduced motion).
- The grid beat pulse only changes thin line brightness; it is not a flash.
- Background effects (milestone numbers, streaks) draw behind magnets and spikes. Overlays (vignette, edge glow) only darken or tint the edges.
- `prefers-reduced-motion: reduce` scales shake to 20%, removes rotation, kicks, zoom punches and background streaks, and cuts flashes to 25%.

## Performance choices

- No per frame `shadowBlur` in gameplay: glows are pre-rendered radial sprites drawn with additive blending; the vignette and edge glows are small pre-rendered canvases stretched to the screen.
- Particles, pulses, popups, afterimages and the trail live in fixed pools and a ring buffer, so steady state play does not allocate objects.
- The `frameWork` budget (p95 update plus render under 8 ms) is checked with every effect firing continuously.
