# VOIDSTRIKE PvP server

Standalone authoritative Node.js 22 + `ws` service for the separate 1v1 Free-Flight mode. This is not the Manus-managed game server; Manus `server` and `database` remain disabled. It implements temporary match rooms only—not accounts, cloud saves, or the global campaign leaderboard, which are deferred by the current user request.

## Local development and test

From the repository root:

```sh
npm --prefix server ci
npm --prefix server test
npm --prefix server start
```

The service listens on `0.0.0.0:$PORT` (`3000` by default), exposes an unauthenticated health check at `/healthz`, and accepts WebSocket sessions at `/ws`. Its default exact-origin allowlist includes the published VOIDSTRIKE game and local Vite (`http://localhost:5173`), preview (`http://localhost:4173`), and port 3000 origins.

The committed `public/multiplayer/bootstrap.json` intentionally has an empty `signalingUrl`. For a local duel, temporarily set it to `ws://localhost:3000/ws` while running `pnpm dev`; restore the blank value before committing or publishing. The client accepts plaintext `ws://` only for local hosts and requires `wss://` for public hosts.

## User-managed Render deployment

`render.yaml` at the repository root is an **optional manual recipe only**. No Render resource has been created or deployed by this project workflow. To host PvP, the repository owner must connect the private GitHub repository in Render, open **New → Blueprint**, review the proposed service, and explicitly choose to deploy it. The manifest requests a Free Node Web Service in Singapore, `/healthz`, an exact `ALLOWED_ORIGINS` allowlist, and `autoDeployTrigger: off`; Git pushes do not auto-deploy the service. Change the region if players are centered elsewhere, and update `ALLOWED_ORIGINS` if the published game domain changes.

After Render creates the service:

1. Copy its generated hostname from the Render dashboard.
2. Set `signalingUrl` in `public/multiplayer/bootstrap.json` to the secure WebSocket URL, ending in `/ws`.
3. Keep the matching protocol and build fields:

   ```json
   {
     "protocol": "voidstrike-pvp-v1",
     "build": "voidstrike-pvp-0.2.0",
     "signalingUrl": "wss://YOUR-SERVICE.onrender.com/ws"
   }
   ```

4. Commit the endpoint configuration to the private repository and publish the static client through its normal game workflow.
5. Verify `/healthz`, WSS origin checks, and two real browser clients before calling public multiplayer ready.

Do not place room codes, reconnect tokens, API keys, or credentials in this public file. Until a real WSS endpoint is configured and tested, the client explicitly reports **server not configured** and refuses to simulate an online match.

## Protocol and gameplay

`voidstrike-pvp-v1` provides guest room creation, six-character invitation codes, two seats, first-to-five kills, respawns, server-authoritative movement, weapons and hits, class abilities, hull/shield, Health/Shield/Weapons pickups, 20 Hz snapshots, tab-scoped reconnect credentials, a 60-second reconnect grace period, a 10-minute idle-room expiry, and bounded message/input rates. The server does not accept client-supplied position, damage, score, or match state. Room codes invite a pilot; a random, temporary seat token is required only to resume the same session. There is no permanent player identity.

Keyboard/mouse: WASD or arrows fly forward/back and strafe; R/F climb/dive; mouse aims; hold left mouse or J to fire; Space/K/right mouse rolls; E activates the selected aircraft ability; Escape leaves. Gamepad: left stick flies, right stick aims, D-pad up/down climbs/dives, RT/RB/A fires, LT/X rolls, LB activates. Touch: drag the left stick to fly, use upward/downward touch zones to climb/dive, and use FIRE/ROLL/ABILITY buttons.

## Free-tier caveat

Render Free Web Services support WebSockets, but may spin down after 15 minutes without inbound traffic and take about a minute to wake. Inbound input/heartbeat messages keep an existing socket active. The filesystem is ephemeral and a Free service cannot attach a persistent disk, so rooms are memory-only and disappear on restart, redeploy, or spin-down. Treat this as an experimental hobby host, not a production availability promise. See [RENDER_NOTES.md](RENDER_NOTES.md) for official citations and the limits reviewed on 2026-10-08.
