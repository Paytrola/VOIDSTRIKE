# VOIDSTRIKE implementation plan

## Existing game to preserve

Keep the current Three.js / TypeScript / Vite game and its on-rails campaign intact: launch/tutorial flow, enemy waves, asteroid storm, BOREWARDEN checkpoint and three boss phases, local scores, browser-local save, supplied menu music, synthesized SFX, aircraft Hangar, and collectible power-ups. The game remains English-only. Version metadata lives in `package.json`, `VERSION.md`, and `CHANGELOG.md`.

## Current online scope

The current request narrows implementation to one new feature: a separate, guest-accessible **Free-Flight PvP** mode. Preserve the campaign as the default and independent mode. Reuse Wraith, Bulwark, and Tempest class data, their weapons/abilities, and Health/Shield/Weapons pickups. PvP MVP is a room-code 1v1 duel with bounded free-flight movement, respawns, and first-to-five kills.

Player accounts/login, a global online campaign leaderboard, and cross-device cloud saves are explicitly **deferred**. Keep those capabilities local/offline only for now: retain the existing browser-local score board and save, and do not add a login provider, cloud database, sync endpoints, or account data.

## Architecture

- Keep the existing static Three.js game and campaign logic; do not reinitialize or replace the project.
- Add `src/game/pvp/` for the lobby/session client, protocol validation, separate free-flight scene, authoritative snapshot interpolation and local-player anticipation. Reuse the game's `Ship`, aircraft profiles, `Input`, `Renderer`, and existing screen styling where appropriate.
- Extend `src/engine/input.ts` with a distinct 3D flight input vector while preserving all campaign bindings and movement semantics. PvP reads bounded intent only (strafe, climb/dive, forward/reverse, aim, fire, roll, ability); never sends client transforms as authority.
- Add `server/` as a standalone Node.js 22 + `ws` authoritative WebSocket service. It owns room codes/seats, player movement and arena bounds, weapon projectiles/hits, class abilities, shield/hull, pickups, death/respawn, score, and match transitions. Use a versioned protocol, two-seat capacity, server-issued room-scoped reconnect tokens (kept in tab-scoped storage and out of invitations/logs), message size/rate/membership checks, heartbeats, bounded reconnect grace, room expiry, and actionable failure states.
- Use local prediction only for the local ship's movement and smooth server correction; remote ships, shots, pickups, damage, scores, and match outcomes follow authoritative snapshots. No rollback, ranked identity, or account system is part of this MVP.
- Add root `render.yaml` as an **optional manual-deploy recipe** for a Render Free Web Service; `autoDeployTrigger: off` prevents Git pushes from deploying it. Bind to Render's `PORT` on `0.0.0.0`, expose `/healthz`, and serve WebSockets at `/ws`. A Render Free instance may sleep after 15 minutes without inbound traffic; client heartbeat/input messages keep an active socket warm, but an idle service takes about a minute to wake. In-memory matches are lost on restart/redeploy/spindown, so reconnect UI must explain room loss and let players create or join again.
- Do not create or deploy any Render resource in this task. Do not enable Manus-managed server or database. The current Webdev configuration was verified as `server: false`, `database: false`; leave it unchanged. The user will deploy the server from the private GitHub repo in Render.
- Keep `public/multiplayer/bootstrap.json` as a public, credential-free template with the matching protocol/build ID and an empty `signalingUrl`. The client maps this blank value to an actionable “server not configured” state; it must not invent an endpoint or simulate an online match. Only replace the blank endpoint after the user deploys Render and supplies the real WSS URL, then verify the published client connection.

## Render constraints and sources

- Render's official free-tier docs: https://render.com/docs/free — Free Web Services support WebSockets, spin down after 15 minutes with no inbound HTTP request or WebSocket message, and take about one minute to start on the next request/connection. Free service filesystems are ephemeral and free web services cannot attach persistent disks; a restart, redeploy, or spin-down loses local changes. Free Web Services have 750 instance hours/month and outbound/build usage limits.
- Render's official WebSocket update: https://render.com/changelog/free-web-services-now-remain-active-while-receiving-websocket-messages — inbound WebSocket messages from an existing connection delay idle spin-down.
- Render's official persistent-disk docs: https://render.com/docs/disks — disks are available for paid services, not Free Web Services.
- Free Postgres expiry (not used by this scope): https://render.com/changelog/free-postgresql-instances-now-expire-after-30-days-previously-90 — Free databases expire after 30 days and are deleted after a further 14-day grace period; the official free-tier docs also note no backups.
- Blueprint configuration format: https://render.com/docs/blueprint-spec — the service manifest can declare Node runtime, `plan: free`, health path, Singapore region, and `autoDeployTrigger: off`. The user can edit the region before deploying if the player population is elsewhere.

## Current prerequisites and scope boundaries

- The approved Game Blueprint revision records no Manus online integrations; its `nextAction` is implementation. The later direct user request explicitly approves a separate external Render-hosted PvP feature while keeping managed server/database disabled. No new Game Blueprint online integration or managed backend is being enabled.
- The user selected Render as the hosting target and asked to host it themselves. Source, tests, and manual deployment instructions may be prepared; do not sign into Render, create resources, or deploy on their behalf.
- `GET config` confirmed `features.server: false` and `features.database: false`; preserve both. The current repository is the private GitHub canonical source `Paytrola/VOIDSTRIKE`.
- No public Render WSS service URL is available yet. Build and test the server locally and keep the client connection unconfigured. Do not claim public multiplayer readiness until the user deploys the service, provides the URL, and the published client connects through WSS.
- Keep secrets out of source, static output, public bootstrap, invitations, and logs. The room token is temporary reconnect authority, not a persistent player identity.
- Publishing the static game is separate from user-managed Render deployment; follow the repository's current checkpoint/auto-publish configuration and report exactly which host components remain unconfigured.

## Project structure

| Area | Responsibility |
| --- | --- |
| `src/engine/` | Existing Three.js rendering, physics, input, audio, local storage, and simulation utilities |
| `src/game/` | Existing rail campaign, aircraft, power-ups; add `pvp/` for free-flight client and transport |
| `src/ui/` | Existing title/Hangar/HUD/settings/results; add PvP lobby, connection state, room code and duel HUD |
| `server/src/` | Standalone authoritative Node.js WebSocket service, shared profiles, protocol and simulation |
| `server/test/` | Node's built-in tests for authoritative simulation, validation, room lifecycle and two local clients |
| `scripts/pvp-browser-smoke.mjs` | Opt-in local two-browser client smoke using a temporary server and a restored `dist/` bootstrap |
| `render.yaml` | Optional Render Free Web Service recipe with manual deployment (not run by this task) |
| `public/multiplayer/bootstrap.json` | Public connection template; keep its WSS endpoint blank until the user supplies a real Render host |
| Root docs | `README.md`, `VERSION.md`, `CHANGELOG.md`, `TODO.md`, and this implementation plan |
