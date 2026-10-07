# VOIDSTRIKE — Shattered Ring Breakout

An original 3D on-rails shooter for the browser (three.js + Rapier, TypeScript, Vite).
Fly the VOIDSTRIKE interceptor through a shattered planetary ring at full burn, chain kills for a
score multiplier, roll through bullet walls, and bring down **BOREWARDEN**, an autonomous
deep-core mining platform, across three phases.

```bash
pnpm install
pnpm dev      # dev server
pnpm build    # typecheck + production build + bundle budget
    pnpm test     # unit tests (rules, timeline, impact toolkit, aircraft, power-ups, save, i18n)
pnpm smoke    # after build: headless playthrough to Results + screenshots in shots/
```

## Controls

| Action | Keyboard & mouse | Gamepad | Touch (landscape) |
| --- | --- | --- | --- |
| Deploy from title | Space or click Deploy | A / Start | Tap Deploy |
| Fly | Mouse steers (ship follows the reticle) or WASD | Left stick | Left floating stick |
| Aim | Mouse | Right stick | Reticle rides ahead of the ship, with aim assist |
| Fire | Left button or J | RT | FIRE button |
| Activate aircraft ability | E | LB | — |
| Roll dodge (i-frames, in flight) | Space or K | LT | ROLL button |
| Pause | Esc | Start | Pause button |

Open **Aircraft Hangar** from the title menu to choose an airframe; selection is saved between sessions. Space still deploys directly with the currently selected aircraft.

## Aircraft classes

| Class | Hull | Speed | Weapon | Ability |
| --- | ---: | ---: | --- | --- |
| **Wraith** — interceptor | 80 HP | 1.25× | Twin Pulse: two quick shots | Afterburn: 2.5 s speed/fire-rate boost, 12 s cooldown |
| **Bulwark** — gunship | 140 HP | 0.78× | Siege Cannon: slow, heavy slug | Aegis Field: 2.4 s damage immunity, 18 s cooldown |
| **Tempest** — striker | 100 HP | 1.00× | Triad Spread: three-shot fan | EMP Pulse: clears active hostile shots, 20 s cooldown |

Each aircraft has a distinct shot color, weapon sound and ability sound. The existing hit, explosion, pickup, roll and boss cues remain active through the saved SFX-volume setting.

## The level

One level, paced entirely by the engine timeline (`src/game/level.ts`):

1. **Launch** cinematic, then a short first-flight tutorial (first play only).
2. **Wave 1 — scout screen**: MITE drones and CHISEL cutters in readable formations.
3. **Asteroid storm**: boost section with speed lines, star stretch and destructible rocks.
4. **Wave 2 — mining convoy**: LANTERN gunships, mines and mixed formations.
5. **BOREWARDEN** (checkpoint): warning band, reveal cinematic, then
   - **I · GRIND** — grinder arms are the weak points; sweeping spark streams, drill spirals, ore lobs.
   - **II · EXCAVATE** — drill petals open to expose the auger core; laser sweeps, ore showers, gapped rings.
   - **III · MELTDOWN** — armour sheds; nova spirals, drill lunge with a shock ring, laser pinwheel.

Score = kills × chain multiplier + grazes + clear and hull bonuses. Results show a grade
(S/A/B/C/D) and can be saved to the local leaderboard.

## Layout

| Path | Role |
| --- | --- |
| `src/engine/loop.ts` | Fixed 60 Hz simulation, interpolated rendering, global time scale (hit-stop / slow-mo) |
| `src/engine/timeline.ts` | **Timeline event system** — reusable pacing scripts (`wait`, `at`, `call`, `every`, loops) |
| `src/engine/impact.ts` | **Impact toolkit** — hit-stop, slow-mo, trauma shake, directional kick, screen flash, distortion pulse |
| `src/engine/pool.ts` | Allocation-free `ObjectPool` + `InstancedBatch` (one draw call per pooled kind) |
| `src/engine/input.ts` | Keyboard/mouse, dual-stick gamepad and touch unified into one action state |
| `src/engine/physics.ts` | Rapier world, kinematic targets, ray/segment queries for shots and aim |
| `src/engine/renderer.ts` | WebGL renderer, quality tiers, bloom + post (aberration, zoom, tint, vignette) |
| `src/engine/audio.ts`, `music.ts` | Mixer buses, synthesized SFX recipes, step-sequenced in-run music and the supplied menu track |
| `src/engine/save.ts`, `i18n.ts` | Versioned local save + leaderboard; English-only player interface |
| `src/game/config.ts`, `aircraft.ts` | Global tuning plus Wraith, Bulwark and Tempest class profiles |
| `src/game/powerups.ts` | Deterministic pickup distribution and pure Health, Shield and Weapons Uplink effects |
| `src/game/rules.ts` | Pure hull/shield/combo/score/grade rules (unit tested) |
| `src/game/level.ts` | The whole level as one timeline script |
| `src/game/boss.ts` | BOREWARDEN: model, parts, phase timelines and attack verbs |
| `src/game/enemies.ts`, `bullets.ts`, `fx.ts` | Pooled + instanced enemies, bullet patterns, particles |
| `src/game/ship.ts`, `rail.ts`, `env.ts`, `models.ts` | Player ship, rail spline + camera frame, sky/asteroids/speed field, procedural low-poly models |
| `src/ui/`, `src/styles/main.css` | HTML/CSS game UI (title, aircraft Hangar, HUD, pause, settings, leaderboard, results) and inherited touch controls |
| `src/i18n/en.json` | All active player-facing text |
| `assets/audio/Operation_Cryo_Intro_music_BRM5_KLICKAUD.mp3` | Supplied source track; loaded from project storage for the menu |

## Rules for changes

- **Simulation in `step()`, visuals in `render()`.** Gameplay state only changes in fixed steps;
  read presses there with `input.consume(action)`.
- **Rules stay pure.** Scoring, damage and grading live in `rules.ts` with tests.
- **Pacing goes through timelines, feel goes through `Impact`.** Neither engine module knows
  about gameplay; the level and the boss only provide verbs.
- **Every visible string is an i18n key** in `src/i18n/en.json`; the player experience is pinned to English.
- **UI is HTML/CSS**, keyboard/gamepad navigable (`data-nav` on focusable controls).
- Keep `pnpm build` within budget (`scripts/check-size.mjs`) and `pnpm smoke` green.

## Credits

The supplied Heliospur source provides the shooter, enemy/boss systems, procedural models, sound effects and in-run sequencer. The title menu uses the supplied Operation Cryo Intro track. Fonts: Sora, Figtree and Noto Sans SC — SIL Open Font License 1.1 (see `public/fonts/*-OFL.txt`). Libraries: three.js (MIT), Rapier (Apache-2.0).
