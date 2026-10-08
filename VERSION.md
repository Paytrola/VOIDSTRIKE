# VOIDSTRIKE version information

- **Application/package version:** `0.1.0`
- **Version source of truth:** `package.json`
- **Version status:** private development snapshot; no GitHub release has been created for this version.
- **Source snapshot identity:** use the Git commit SHA in the repository history. Do not treat the package version alone as a unique build identifier.

## Verified toolchain

| Component | Version |
| --- | --- |
| Node.js | 22.13.0 |
| pnpm | 10.18.0 |
| Three.js | 0.186.1 |
| Rapier3D compatibility package | 0.21.0 |
| TypeScript | 5.9.3 |
| Vite | 8.3.1 |
| Vitest | 5.0.2 |
| Playwright | 1.63.0 |
| `@types/three` | 0.186.0 |

Exact dependency resolution is recorded in `pnpm-lock.yaml`; the version ranges in `package.json` are not a substitute for the lockfile.

## Versioning convention

Use semantic-version-style increments: patch for compatible fixes, minor for compatible features, and major for incompatible changes. Before a release, update `package.json` and add the user-visible changes to `CHANGELOG.md`. A release tag or hosted release should only be created when the project is intentionally released; the `0.1.0` development snapshot is not itself a public release.

## Feature boundary of 0.1.0

This snapshot contains the single-player rail-shooter campaign, persistent local Hangar selection, local saves/leaderboard, three aircraft classes, collectible combat power-ups, synthesized SFX, and the supplied title-menu soundtrack. Free-Flight PvP, player accounts/login, a global leaderboard, and cross-device cloud saves are requested follow-on features and are not included in version `0.1.0`.
