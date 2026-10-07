# VOIDSTRIKE implementation plan

## Product scope

Adapt the approved Heliospur source archive into the initialized Three.js/Vite game project without replacing its managed runtime. Preserve the on-rails space-shooter campaign, enemy waves, three-phase Borewarden boss, English-only player experience, and existing offline systems. Brand the title and main menu as **VOIDSTRIKE**, add the supplied MP3 as menu-only music, and let Space deploy from the title menu.

## Architecture and project structure

- `src/engine/`: retain the source game's Three.js/Rapier loop, audio mixer, input, saves, renderer, and music primitives.
- `src/game/`: integrate Heliospur's rail shooter, waves, boss, combat, and procedural source models. Keep the initialized project's tuning manager adapted to genuine Heliospur configuration parameters and keep the Vite preview tuning bridge.
- `src/ui/` and `src/styles/`: use the source game's DOM overlays and arcade UI; update the title, deployment prompt, English-only settings, and menu audio lifecycle.
- `src/i18n/`: use the existing English catalog as the only active game locale; no runtime locale detection or selector.
- `assets/audio/Operation_Cryo_Intro_music_BRM5_KLICKAUD.mp3`: preserve the supplied source in the checkpoint; fetch the same track at runtime through its project-managed `/manus-storage/...` path so it does not inflate the initial static game bundle.
- Root project files: preserve initialized package/dependency versions, Vite port/host configuration and Manus game-tuning plugin; use the source's game tests and size/smoke checks where compatible.

No backend or online integrations are in scope. Do not source or generate additional visual models; the supplied game archive is the source of gameplay and art. Keep the uploaded track unchanged.

## Design direction

- **Design movement:** preserve the source's high-contrast, arcade space-opera interface and fast 3D rail-shooter presentation.
- **Core principles:** legible combat-first composition; bold angular arcade hierarchy; kinetic but controlled transitions; all controls remain reachable by mouse, keyboard and gamepad.
- **Color philosophy:** retain the source's near-black violet space, warm amber/gold danger and reward cues, and cyan instrumentation, maintaining contrast against the game scene.
- **Layout paradigm:** keep the existing left-anchored title block over an animated 3D backdrop, with compact flight controls at the right and utility prompts along the bottom; do not recenter into a generic grid.
- **Signature elements:** the source's angular outlined wordmark, a new cyan strike cutting through a segmented amber ring for the loader/favicon, and cyan/amber flight-instrument accents.
- **Interaction philosophy:** deployment is immediate and unmistakable; Space and the visible launch control share the same action; preserve in-run Space roll behavior.
- **Animation:** preserve the source's short rise/pop screen transitions, subtle title-scene motion, and readable gameplay effects; respect reduced-motion controls.
- **Typography:** reuse bundled Sora for display, Figtree for body, and retain the existing bundled Noto Sans SC fallback only if needed by the inherited source assets; the live UI remains English.
- **Brand essence:** a high-speed on-rails space shooter about breaking through hostile orbital defenses. Personality: **kinetic, bold, precise**.
- **Brand voice:** terse mission language with strong verbs. Examples: “PRESS SPACE TO DEPLOY” and “Thread the ring. Break the machine.”
- **Wordmark & logo:** retain the source's large italic display treatment with the exact name VOIDSTRIKE; pair it with a compact, distinctive cyan strike/ring symbol used consistently in the loading screen and favicon.
- **Signature brand color:** electric cyan, used for navigation/instrument accents against the dark-violet void.

## Behavior decisions

- Load the provided MP3 asynchronously as a looping menu track only from project storage. Begin playback after the first user gesture (browser autoplay policy), respect saved music volume and mute settings, stop on deployment, and resume when returning to the title.
- On the title screen, Space starts the mission directly. Keep the original combat control mapping after deployment.
- Pin the runtime to English: no browser-language auto-detection and no language selector; keep the save format robust to existing data.
- Preserve the initialized Vite/Three.js runtime, package lock, host/port conventions, preview parent bridge, and game-owned Tweak integration.

## Source reference

- Published source archive supplied with the task: https://d1oupeiobkpcny.cloudfront.net/assets/dashboard/materials/2026/09/27/71db6ad986146262ff6891d9ec985c883ac43b2f577834827adc749eef8fe475.zip
- Original session reference: https://vida.butterfly-effect.dev/app/aHinap7VRoxkViy3AjvZtq
- The downloaded archive's package metadata matched the initialized project's Three.js, Rapier, TypeScript, Vite and pnpm versions; keep the initialized lockfile and Vite host/port/tuning integration.

## First-complete-game sharing and loader requirements

The first playable preview/checkpoint needs a VOIDSTRIKE-specific loading screen, a project favicon PNG and game-sharing metadata. The loader will retain its real progress behavior while replacing the inherited ship mark with the same cyan VOIDSTRIKE strike insignia as the favicon, on the game's solid dark-violet field. Create a separately AI-generated, optimized 16:9 1200×675 promotional cover with exact VOIDSTRIKE lettering; this is sharing art only, not an additional gameplay model or scene asset. Keep the cover, favicon, credits and any source-game references distinct and record the cover/icon paths in `game-sharing.json`.
