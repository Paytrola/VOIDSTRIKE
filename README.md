# VOIDSTRIKE — Shattered Ring Breakout

![VOIDSTRIKE cover](assets/share/og.png)

**VOIDSTRIKE** is a Three.js browser space shooter built from the Heliospur showcase. Fly an interceptor through a shattered planetary ring, chain kills, dodge enemy fire, and defeat **BOREWARDEN**, an autonomous deep-core mining platform, across three combat phases.

[Play the current build](https://voidstrike-kg4srpnu.manus.game)

## Current version and status

- **Game/package version:** `0.1.0` (`package.json`; details in [VERSION.md](VERSION.md)).
- **Current mode:** playable single-player rail-shooter campaign with local saves and a local leaderboard.
- **Language:** English-only player experience.
- **Online roadmap:** Free-Flight PvP, player accounts/login, global leaderboard, and cross-device cloud saves have been requested. They are **not implemented in this source version**. PvP hosting requires a selected Cloud Computer; online services have not yet been configured.

## Included features

- Original campaign structure: enemy waves, an asteroid-storm boost section, checkpoint, and a three-phase BOREWARDEN boss.
- **Aircraft Hangar** with persistent local selection:

  | Class | Hull | Speed | Weapon | Ability |
  | --- | ---: | ---: | --- | --- |
  | **Wraith** — interceptor | 80 HP | 1.25× | Twin Pulse, paired shots | Afterburn: 2.5 s speed/fire-rate boost; 12 s cooldown |
  | **Bulwark** — gunship | 140 HP | 0.78× | Siege Cannon, slow heavy shot | Aegis Field: 2.4 s damage immunity; 18 s cooldown |
  | **Tempest** — striker | 100 HP | 1.00× | Triad Spread, three-shot fan | EMP Pulse clears active hostile shots; 20 s cooldown |

- Collectible enemy drops, distributed in a predictable Health / Shield / Weapons sequence:
  - **Health Cell:** restores 22 hull, up to the selected aircraft's maximum.
  - **Shield Cell:** restores 30 shield, up to the existing 60-point cap.
  - **Weapons Uplink:** for 8 seconds, increases shot damage by 35% and fire rate by 25%; collecting another refreshes the timer instead of stacking effects.
- Synthesized in-game sound effects and the user-supplied **Operation Cryo Intro** title-menu track.
- Recoverable startup: an indeterminate slow-load state after 10 seconds and a Retry button after 30 seconds.
- Local campaign score history and versioned browser save data; no online account or cross-device sync in this version.

## Controls

| Action | Keyboard & mouse | Gamepad | Touch |
| --- | --- | --- | --- |
| Deploy from title | Space or **Deploy** button | A / Start | Tap **Deploy** |
| Steer | WASD / arrow keys | Left stick | Floating stick |
| Aim | Mouse | Right stick | Reticle ahead of the ship with aim assist |
| Fire | Left mouse button or J | RT / RB / A | **FIRE** |
| Aircraft ability | E | LB | No on-screen ability button |
| Roll dodge | Space or K; right-click also rolls | LT / X | **ROLL** |
| Pause | Esc or P | Start | Pause button |

Space deploys from the title menu and rolls once the mission is underway. Open **Aircraft Hangar** from the title menu to select an airframe; its selection is saved locally between sessions.

## Campaign outline

1. Launch cinematic and a short first-flight tutorial on the first run.
2. Scout screen: MITE drones and CHISEL cutters.
3. Asteroid storm with destructible rocks and a boost section.
4. Mining convoy: LANTERN gunships, mines, and mixed formations.
5. BOREWARDEN checkpoint and boss encounter:
   - **I · GRIND:** grinder-arm weak points, spark streams, drill spirals, and ore lobs.
   - **II · EXCAVATE:** exposed auger core, laser sweeps, ore showers, and gapped rings.
   - **III · MELTDOWN:** shed armour, nova spirals, drill lunge, shock ring, and laser pinwheel.

Campaign score combines kills, chain multiplier, grazes, and clear/hull bonuses. Results include a grade and can be stored in the local leaderboard.

## Run locally

Verified toolchain: Node.js `22.13.0` and pnpm `10.18.0`.

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm typecheck
pnpm test
pnpm build
```

Optional browser smoke run, after the development environment has its browser dependencies available:

```bash
pnpm smoke
```

The project is TypeScript + Vite, using Three.js and Rapier3D. `pnpm build` runs the project's Web build workflow. Unit/regression tests use Vitest.

### Menu soundtrack when running outside Manus

The supplied MP3 is included at `assets/audio/Operation_Cryo_Intro_music_BRM5_KLICKAUD.mp3`. In the managed game build, `src/main.ts` loads it from the project's `/manus-storage/` media route so the large track is not bundled into the static game build. A plain external clone does not have that project storage route; point `menuMusicUrl` in `src/main.ts` to a local or hosted copy when running outside the managed project. No storage credentials are included in this repository.

## Project map

| Path | Responsibility |
| --- | --- |
| `src/engine/loop.ts`, `timeline.ts`, `impact.ts` | Fixed-step simulation, reusable campaign timelines, hit-stop, slow motion, shake, and impact effects |
| `src/engine/input.ts` | Keyboard, mouse, gamepad, and touch input |
| `src/engine/physics.ts`, `renderer.ts`, `pool.ts` | Rapier queries, Three.js rendering/quality tiers, and pooled rendering objects |
| `src/engine/audio.ts`, `music.ts` | Audio mixer, synthesized effects, sequenced in-run score, and menu-track loading |
| `src/engine/save.ts`, `i18n.ts` | Versioned local save, local leaderboard, and English strings |
| `src/game/aircraft.ts`, `config.ts`, `powerups.ts` | Aircraft profiles, game tuning, and collectible pickup rules |
| `src/game/level.ts`, `boss.ts`, `enemies.ts`, `bullets.ts` | Mission timeline, BOREWARDEN, enemy behavior, projectiles, and effects |
| `src/ui/`, `src/styles/main.css` | Title menu, Hangar, HUD, pause/settings, local leaderboard, and results UI |
| `src/i18n/en.json` | Active player-facing text |
| `assets/audio/`, `assets/share/`, `public/fonts/` | Supplied soundtrack, game sharing art, and bundled fonts |
| `plan.md`, `TODO.md`, `VERSION.md`, `CHANGELOG.md` | Design/roadmap, tracked outcomes, and version history |

## Credits and licensing notes

The project began with the supplied Heliospur showcase source and assets. The title menu uses the user-supplied Operation Cryo Intro track; in-game effects are synthesized by the game. Bundled Sora, Figtree, and Noto Sans SC fonts include SIL Open Font License 1.1 notices in `public/fonts/`. Core dependencies include Three.js (MIT) and Rapier (Apache-2.0).

No project-level license has been declared. The presence of this private development source does not grant a new redistribution license for the supplied game assets or soundtrack; review the original source and asset terms before redistributing.
