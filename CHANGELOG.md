# Changelog

Notable project changes are recorded here. The root package version in `package.json` remains the source of truth.

## 0.2.0 — guest Free-Flight PvP development milestone (2026-10-08)

### Included in source

- A separate Three.js free-flight 3D arena mode; the original on-rails campaign, Hangar, local saves, and local leaderboard remain available.
- Guest two-seat room-code duels, first-to-five scoring, respawns, and bounded reconnect grace.
- Standalone Node.js 22 + `ws` authoritative room server. It owns movement, shots/hits, hull/shield, aircraft abilities, pickups, respawns, scores, and match state; client transforms and scores are never trusted.
- Shared aircraft profiles and PvP movement/rules for the client and server, versioned protocol/build ID, exact Origin allowlist, message-size/rate checks, heartbeats, `/healthz`, and actionable lobby recovery states.
- A manual Render Free Web Service recipe with `autoDeployTrigger: off`; it does not create or deploy a Render service.
- Three.js PvP lobby and match HUD for keyboard/mouse, gamepad, and touch, plus pickup feedback and uplink timer.
- An opt-in Playwright smoke script for a local two-browser room and server-authoritative flight input; it restores the production bootstrap after the test.
- Client configuration defaults to a blank public WSS endpoint; no fake/local online fallback is used in the published experience.

### Deployment and account boundary

The Render WebSocket service has **not** been created or deployed. Public PvP is not ready until the user deploys it, configures the real WSS host, publishes the matching client build, and verifies two browser clients. Render Free rooms are in-memory and may be lost on spin-down or restart.

Player accounts/login, cross-device cloud saves, and a global online campaign leaderboard remain explicitly deferred. The campaign retains its existing local-only save and score history; Manus-managed server/database features remain disabled.

## 0.1.0 — development baseline (2026-10-08)

- Three.js / TypeScript conversion of the supplied Heliospur on-rails shooter, preserving enemy waves and the three-phase BOREWARDEN boss.
- VOIDSTRIKE branding, English-only player-facing experience, game-specific title artwork/favicon, and **PRESS SPACE TO DEPLOY**.
- User-supplied Operation Cryo Intro title-menu music, browser-gesture playback, and saved volume/mute settings.
- Persistent local Hangar with Wraith, Bulwark, and Tempest aircraft classes, distinct hull/speed/weapons/abilities, and synthesized combat SFX.
- Collectible Health Cells, Shield Cells, and Weapons Uplinks, deterministic drops, local saves/leaderboard, and clearer slow-start recovery.

Version `0.1.0` is a historical development baseline. Version `0.2.0` is also a private development snapshot; no GitHub release or version tag is implied.
