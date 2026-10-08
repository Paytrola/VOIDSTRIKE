# VOIDSTRIKE version information

- **Application/package version:** `0.2.0`
- **Version source of truth:** root `package.json`
- **PvP protocol:** `voidstrike-pvp-v1`
- **PvP client/server build ID:** `voidstrike-pvp-0.2.0`
- **Server package version:** `0.2.0` (`server/package.json`)
- **Version status:** private development snapshot; no GitHub release or version tag has been created for this version.
- **Deployment status:** client/source contain the guest PvP MVP and server, but no Render service has been created or deployed. The public WSS bootstrap remains blank.
- **Source identity:** use the Git commit SHA in the repository history; the package version alone is not a unique build identifier.

## Verified toolchain and dependency versions

| Component | Version |
| --- | --- |
| Node.js | 22.13.0 |
| pnpm | 10.18.0 |
| npm | 10.9.2 |
| Three.js | 0.186.1 |
| Rapier3D compatibility package | 0.21.0 |
| TypeScript | 5.9.3 |
| Vite | 8.3.1 |
| Vitest | 5.0.2 |
| Playwright | 1.63.0 |
| `@types/three` | 0.186.0 |
| PvP server `ws` | 8.22.0 |

Exact dependency resolutions are recorded in `pnpm-lock.yaml` and `server/package-lock.json`; version ranges in the package manifests are not a substitute for those lockfiles.

## Validation record (2026-10-08)

- `pnpm typecheck` — passed.
- `pnpm test` — 52 client tests and 11 authoritative server tests passed.
- `pnpm build` — passed; the emitted build includes the blank public multiplayer bootstrap.
- `pnpm smoke` — passed the existing campaign, English-only, and responsive-browser smoke.
- `pnpm smoke:pvp` — passed with two isolated browser clients, a server-generated room code, live duel state, and server-authoritative flight movement. Screenshot: `shots/08-pvp-local-duel.png`.
- `npm --prefix server audit --omit=dev` — 0 production dependency vulnerabilities.

## Versioning convention

Use semantic-version-style increments: patch for compatible fixes, minor for compatible features, and major for incompatible changes. Before a release, update the root `package.json` and add user-visible changes to `CHANGELOG.md`. A release tag or hosted release should only be created when the project is intentionally released. Version `0.2.0` is a private development snapshot, not a public release.

## Feature boundary of 0.2.0

This version preserves the single-player rail campaign and adds the source for a separate guest Free-Flight 1v1 mode, an authoritative Node.js + `ws` room server, a manual Render Free Service recipe with automatic server deployment disabled, and validated client/server protocol tests. Public multiplayer still requires a user-created Render service, a real WSS endpoint in `public/multiplayer/bootstrap.json`, a published client checkpoint, and live two-browser verification.

The campaign save and leaderboard remain browser-local. Player accounts/login, cloud saves, and a global online campaign leaderboard are explicitly deferred; Manus-managed server and database features remain disabled.
