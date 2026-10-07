# TODO

- [x] Integrate the complete supplied Heliospur source archive and assets into the initialized Three.js game project while preserving runtime compatibility and its core on-rails shooter gameplay, enemy waves, and three-phase boss encounter.
- [x] Rename the game and main menu to **VOIDSTRIKE**, make the game experience English-only, show the explicit **PRESS SPACE TO DEPLOY** instruction, and make Space start play from the menu.
- [x] Add the supplied Operation Cryo Intro MP3 as looping menu music, with browser-gesture playback and existing music volume/mute settings respected; stop it on deployment and resume it on return to the menu.
- [x] Preserve the initialized project's Three.js/Vite runtime, development Tweak bridge, and the source game's existing offline game systems.
- [x] Replace the inherited loader mark/background with a VOIDSTRIKE-specific insignia over a solid game-colored field, retaining real progress and a readable status plus Retry on startup failure; record the matching game-specific favicon, title, description, and promotional cover in committed sharing metadata.
- [x] Make long startup waits visible and recoverable: change to indeterminate progress and a slow-load status after 10 seconds, show a working Retry after 30 seconds, and clear the watchdog on successful startup or startup failure.
