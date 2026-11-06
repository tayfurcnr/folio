# Folio collaboration service

## Local network development

Run `npm run dev` from the repository root. The command starts the editor on port `5173`, the collaboration service on loopback port `4175`, and proxies `/api` requests and WebSocket upgrades through Vite. The browser uses its current origin, so a shared invite opened from another device on the same network continues through the same proxy.

Vite prints the network URL to use on the second device. If the machine firewall blocks the port, allow TCP `5173` on the private network. The collaboration service itself stays on loopback. Its durable data is stored under `.folio-data/collaboration`.

Environment overrides:

- `FOLIO_WEB_HOST` defaults to `0.0.0.0`; use `127.0.0.1` to keep the editor local to this machine.
- `FOLIO_WEB_PORT` defaults to `5173`.
- `FOLIO_COLLAB_PORT` defaults to `4175`.

## Public HTTPS deployment

1. Copy `.env.example` to `.env` and set `FOLIO_DOMAIN` and `FOLIO_PUBLIC_ORIGIN` to the same public HTTPS origin.
2. Point that domain's DNS at the server and allow inbound TCP ports 80 and 443.
3. Run `docker compose up --build -d` from the repository root.

Caddy serves the static editor, obtains and renews the HTTPS certificate, and forwards `/api/*` plus WebSocket upgrades to the private collaboration container. Folio uses the page origin for its API and WebSocket connection, so no separate client URL is required.

The collaboration container stores presentations and bearer-link hashes in the `folio-data` volume. Back up that volume. Caddy's certificate and configuration data persist in separate volumes. The app has no user accounts; anyone with an invite link has the permissions encoded by that link until the owner revokes it.

## Presenter remote control

While a presentation is open, choose **Uzaktan kumandayı paylaş** and send the generated link to the presenter’s phone or another device. That device receives the current slide preview and speaker notes and can navigate backward or forward. The temporary control token cannot read or modify the presentation document; it expires when the presentation window closes or after eight hours. The editor’s LAN or public HTTPS URL must be reachable from the controller device.
