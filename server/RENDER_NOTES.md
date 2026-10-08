# Render hosting facts used by VOIDSTRIKE

This file records the official Render documentation reviewed on 2026-10-08 for a user-managed, free WebSocket host. It is a deployment recipe only; this project does not create or deploy Render resources.

- [Deploy for Free](https://render.com/docs/free): Free Web Services support WebSockets. An idle free service spins down after 15 minutes with no inbound HTTP request or WebSocket message, then takes about one minute to spin back up on an HTTP request or new WebSocket connection. Free services may restart at any time. Their filesystem is ephemeral; local changes are lost after restart, redeploy, or spin-down. Free Web Services cannot attach persistent disks. The free plan includes 750 instance hours per workspace per calendar month and is intended for testing/hobby use, not production; bandwidth and build pipeline limits also apply.
- [Free services and WebSocket traffic update](https://render.com/changelog/free-web-services-now-remain-active-while-receiving-websocket-messages): inbound messages on an existing WebSocket now count as activity for free-service idle spin-down.
- [Persistent Disks](https://render.com/docs/disks): persistent disks attach to paid web services, private services, or workers, not free web services.
- [Free PostgreSQL expiration update](https://render.com/changelog/free-postgresql-instances-now-expire-after-30-days-previously-90): new free Render Postgres databases expire after 30 days; after expiration there is a further 14-day grace period before deletion. [Free-tier details](https://render.com/docs/free) state free Postgres has a 1 GB limit and no backups. This project does not use Render Postgres in the current PvP-only scope.
- [Blueprint YAML reference](https://render.com/docs/blueprint-spec): supports Node web services, the `free` plan, `healthCheckPath`, Singapore as a region, and `autoDeployTrigger: off` to opt out of automatic service deployments.
- [Render Blueprints](https://render.com/docs/infrastructure-as-code): a Blueprint file is a version-controlled resource definition; service resources are only created after the user submits the Render dashboard's deployment flow. `autoDeployTrigger: off` disables commit-triggered auto deploys.

## Design implications

- PvP rooms and match state exist only in server memory and are intentionally disposable across restarts/spin-down. Reconnect/room-loss UI must be honest and recoverable.
- The client sends a low-frequency inbound heartbeat in the waiting lobby; while a match is active, bounded input messages keep the WebSocket active. Idle service wake-up delay remains possible and must be surfaced.
- Do not use the Free service's filesystem, Free Postgres, or Free Key Value as durable account/save storage. Accounts, cloud saves, and a global leaderboard are explicitly deferred; the Manus-managed database/server also remain disabled.
