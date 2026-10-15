# Configuration

Create a `.env` file beside your Compose file. Compose reads it when starting the service.

```dotenv
DASHBOARD_PORT=3000
APP_ORIGIN=https://printer.example.com
BAMBUDECK_VERSION=latest
```

| Variable                         | Purpose                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| `DASHBOARD_PORT`                 | Host port; defaults to `3000`.                                                                     |
| `APP_ORIGIN`                     | Exact external origin, including a nonstandard port. Set this when using a reverse proxy or HTTPS. |
| `BAMBUDECK_VERSION`              | Published image tag used by production Compose; defaults to `latest`.                              |
| `APP_ENCRYPTION_KEY`             | Optional base64-encoded 32-byte key. Otherwise the app creates `/data/secret.key`.                 |
| `TLS_CERT_FILE` / `TLS_KEY_FILE` | Container paths for direct HTTPS. Add them through a Compose override.                             |
| `DATA_DIR`                       | Server storage path; `/data` in Docker. Keep the persistent mount aligned with it.                 |

When supplying an encryption key, preserve exactly the same value across deployments. Changing or losing it prevents decryption of saved credentials. Keep environment files out of Git.

## Printer discovery

Use **Find printer** in the printer editor to listen for LAN announcements. Selecting a result fills the address and serial number; enter the LAN access code and save the profile yourself. Discovery does not retrieve access codes.

When a saved connection fails, BambuDeck makes one discovery attempt for that serial and retries if its address changed. An established connection gets a 15-second reconnect grace period before one recovery attempt per outage. The new address is saved only after the replacement MQTT connection succeeds; other profile fields stay unchanged.

`DISCOVERY_ENABLED` defaults to `true`; set it to `false` to disable discovery. `DISCOVERY_TIMEOUT_MS` defaults to `15000` and accepts 1000–60000 milliseconds. A targeted recovery scan returns as soon as the saved serial number is found.

The authenticated `POST /api/discovery/scan` endpoint accepts an empty JSON object and returns `{ "printers": [{ "host": "…", "serial": "…", "model": "…" }] }`. It requires the same Origin and `X-Requested-With: BambuDeck` headers as other mutations. Empty results mean no announcement arrived during the window, not that no printer exists.

Discovery listens on UDP 1990 and 2021 and can use either port when another application occupies one. The server must receive the printer’s LAN broadcast or multicast traffic. See [Linux host networking](./deployment.md#linux-host-networking-for-discovery) for Docker. Direct IP setup continues to work when discovery is unavailable.

## Storage and authentication

SQLite stores encrypted printer addresses, serial numbers, LAN codes, and Home Assistant broker credentials using AES-256-GCM. The dashboard password uses Argon2. Better Auth manages the single administrator and seven-day sessions using HttpOnly cookies. Its authentication tables are not encrypted; printer and broker credentials remain encrypted. Existing passwords migrate automatically, while existing browser sessions require signing in again. Public registration is disabled.

The generated key file has restricted permissions. Access to both the database and its key permits decryption, so protect the entire backup. The PWA caches static assets, not printer API responses or camera frames.

## Filament profiles

To enable profile search, mount a directory containing Bambu Studio filament profile JSON files. Create `compose.profiles.yaml`:

```yaml
services:
  dashboard:
    volumes:
      - ./filament-profiles:/data/filament-profiles:ro
```

```sh
docker compose -f compose.production.yaml -f compose.profiles.yaml up -d
```

Profiles can inherit settings from other profiles in the mounted directory. Filament properties can also be entered manually.

## Home Assistant

Enter your MQTT broker settings in Settings. BambuDeck publishes MQTT Discovery entities for printer status and supported controls. Saved printers reconnect at startup when a broker is configured. Keep the discovery prefix as `homeassistant` unless your Home Assistant broker uses a different prefix. Device identifiers and state topics use `bambudeck`.

## Development

Install Node.js 22 and Bun 1.4.2, then run:

```sh
bun install --frozen-lockfile
bun run dev:server
```

In another terminal:

```sh
bun run dev
```

Vite serves `http://localhost:5173` and proxies the API to Bun. Local data lives in `./data`.

```sh
bun run check
bun run typecheck
bun run build
bun run docs:dev
bun run docs:build
```

No automated tests are included. Builds, typechecking, and manual review are documented in [Verification](./VERIFICATION.md).
