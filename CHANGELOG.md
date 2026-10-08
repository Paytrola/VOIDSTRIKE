# Changelog

Notable project changes are recorded here. The package version in `package.json` remains the source of truth.

## 0.1.0 — development baseline (2026-10-08)

### Included

- Three.js / TypeScript conversion of the supplied Heliospur on-rails space-shooter source, preserving enemy waves and the three-phase BOREWARDEN boss encounter.
- VOIDSTRIKE branding, English-only player-facing experience, game-specific title artwork/favicon, and the **PRESS SPACE TO DEPLOY** title-menu action.
- User-supplied Operation Cryo Intro track on the title menu, with browser-gesture playback and saved volume/mute settings.
- Persistent local Hangar with Wraith, Bulwark, and Tempest aircraft classes, distinct hull/speed/weapons/abilities, and synthesized combat SFX.
- Collectible Health Cells, Shield Cells, and Weapons Uplinks, with deterministic drops and tested rules.
- Local save data and leaderboard, plus clearer slow-start feedback and a working Retry path.

### Not included in this snapshot

Free-Flight PvP, player accounts/login, a global online leaderboard, and cross-device cloud save synchronization have been requested as the next scope but are not implemented in `0.1.0`. PvP also requires a separately selected and configured Cloud Computer; the static game build does not host a WebSocket server.

This is a development baseline, not a published release. No GitHub release or version tag is implied by this changelog entry.
