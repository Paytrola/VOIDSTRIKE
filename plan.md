# VOIDSTRIKE implementation plan

## Existing game to preserve

Keep the current Three.js / TypeScript / Vite game and its on-rails campaign intact: the launch/tutorial flow, enemy waves, asteroid storm, BOREWARDEN checkpoint and three boss phases, local scores, local save data, music, aircraft Hangar, and collectible power-ups. The English-only player experience and user-supplied title music remain. The current implementation is version `0.1.0`; see `VERSION.md` and `CHANGELOG.md`.

## Newly requested online scope

The user explicitly selected all of these additions after the original Game Blueprint had been approved without online features:

1. **Free-Flight PvP:** a separate mode/menu destination, continuous open-arena flight rather than rail movement, with player-vs-player combat. Preserve the original rail campaign as a separate mode. Reuse Wraith, Bulwark, and Tempest with their current class profiles, weapons, abilities, and Health/Shield/Weapons pickups.
2. **Player accounts/login:** use the platform's supported game-login flow once the current project configuration records that selection. Keep a guest/offline path so the campaign remains playable when a player is signed out or disconnected.
3. **Global leaderboard:** preserve the existing local leaderboard and add an online global campaign-score view. Treat score submissions from a browser as untrusted; validate them server-side, use stable account identity, and make submissions idempotent. A client-only single-player run is tamperable, so document the leaderboard's anti-cheat limits unless the scoring path is made independently authoritative.
4. **Cloud save synchronization:** keep the current local save as an offline fallback and sync account-owned campaign/profile data across devices. A reasonable initial boundary is campaign progress, aircraft selection, and player statistics; keep device-specific controls/accessibility settings local. Version the save schema and handle sign-in, offline play, upload/download, and conflicts without deleting local progress.

## Architecture

- Keep the existing static Three.js game client and campaign logic; do not reinitialize or replace the project.
- Put PvP client networking, lobby/match UI state, and protocol adapters under `src/game/pvp/` (with account/save/leaderboard client adapters under a separate `src/game/online/` area if needed). Keep shared render/input code in the existing `src/engine/` and `src/ui/` modules.
- Add the independent Node.js WebSocket service in a root `server/` directory, adapting the installed authoritative Three.js multiplayer reference. The server owns rooms, player transforms, movement constraints, shots/hits, ability cooldowns, pickup state, health, deaths, respawns, scores, and match transitions; the client sends bounded input and renders accepted snapshots.
- Start with a 1v1 room-code duel, two seats, respawns, and first-to-five-kills. Room codes are invitations, not authentication. Use a versioned client/server protocol, server-issued room-scoped seat credentials, input/message size and rate limits, membership checks, heartbeat cleanup, bounded reconnect grace, and actionable full/disconnected/unavailable UI.
- Make the local player's movement feel immediate with local anticipation and smooth correction from server snapshots; remote players and all shared outcomes remain server-authoritative. Do not trust client coordinates, hit claims, pickups, or scores.
- Use the managed project's supported online services for the login, database-backed cloud save, and leaderboard work, following the installed authentication and leaderboard guides before implementation. The WebSocket server remains a separate Cloud Computer service; publishing the static game does not deploy it.

## Current prerequisites and scope boundaries

- The prior approved Game Blueprint revision records no online integrations. The newer explicit user request is the current product scope, but do not treat the old receipt as evidence that online services were provisioned. Before enabling server/database services, persist the current feature selection through the supported project configuration/approval flow and verify the resulting config.
- `GET game/multiplayer` previously returned no selected Cloud Computer (`pcId: null`). The user said they will create/start one. After it appears, list devices again, get the user's explicit choice for this project's multiplayer host, save that exact device using the latest multiplayer revision, and inspect its runtime, ports, and proxy before deploying. Never run the persistent authoritative server in the temporary Sandbox.
- Keep secrets out of source, the static bundle, `public/multiplayer/bootstrap.json`, invitations, and logs. The published client must use the verified WSS endpoint and a shared build/protocol ID; never invent an endpoint from an internal request host.
- Game publication is separate from Git repository connection. Do not publish a new game build unless the existing publication authorization or a later explicit request permits it. Claim production multiplayer only after two browser clients connect through the authorized published game URL and pass the installed RTT/jitter/reconnect checks.
- No payment integration is requested.

## Project structure

| Area | Responsibility |
| --- | --- |
| `src/engine/` | Existing Three.js rendering, physics, input, audio, local storage, and simulation utilities |
| `src/game/` | Existing campaign plus aircraft/power-up systems; add `pvp/` and, if required, `online/` without coupling PvP into the rail campaign |
| `src/ui/` | Existing menu/Hangar/HUD/settings/results; add sign-in/sync status, global leaderboard, lobby, and PvP match states |
| `server/` | Standalone authoritative Node.js WebSocket service, protocol, validation, room/simulation logic, and its own package/lockfile |
| `public/multiplayer/` | Public connection bootstrap only after a real, verified WSS host exists; never put credentials here |
| Root docs | `README.md` for usage/status, `VERSION.md` for version/toolchain, `CHANGELOG.md` for shipped changes, `TODO.md` for requested outcomes |
