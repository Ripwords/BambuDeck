# BambuDeck

BambuDeck is a self-hosted, LAN-first dashboard for Bambu Lab printers. Keep the product minimal, mobile-friendly, and useful during a print. Prioritize camera, progress, files, and controls. Avoid marketing copy and redundant status panels.

## Working rules

- Implement authorized work through completion. Ask only for missing decisions that cannot be resolved from the code or environment.
- Use focused subagents for independent backend, frontend, and review work when useful. Give each ownership of different files; coordinate shared contracts before editing.
- Do not add or run automated tests unless the user changes this direction. Verify with typechecks, formatting/linting, production builds, manual API/browser review, and container health.
- Do not add source-code comments, HTML comments, CSS comments, or YAML comments. Use clear names and small modules. Markdown documentation is allowed.
- Keep private credentials, local databases, encryption keys, certificates, logs, temporary review scripts, and internal planning files out of Git and Docker build contexts.
- Use CodeGraph for structural lookup when the project index is available. Use `rg` for literal strings and direct reads for known files. Do not initialize an absent index without authorization.
- Never send real printer commands during verification without explicit authorization. Use isolated temporary data and browser-intercepted sample telemetry. Do not touch an active print to demonstrate a UI fix.
- Report physical-hardware limitations honestly. Browser simulation does not establish printer, camera, firmware, or iPhone compatibility.
- Preserve concurrent user changes. Do not reset history, move published tags, or force-push unless explicitly requested. Releases are immutable once published.

## Stack and commands

- Vue 3 Composition API, TypeScript, Vite, and vite-plugin-pwa.
- Bun 1.4.2 with Elysia and `bun:sqlite`; Node.js 22 is required for the Vue build toolchain.
- Zod schemas validate request data. Enable `zod/compile` before constructing server schemas; keep schemas at module scope, infer types, and keep refinements pure because failed compiled validation may fall back and evaluate them again. Avoid handwritten field-by-field parsers. Keep stateful checks, such as duplicate serial numbers, in services.
- Better Auth manages sessions. MQTT, implicit FTPS, camera transport, 3MF metadata, and MQTT discovery are implemented in TypeScript.
- Docker includes FFmpeg and runs as the nonroot `bun` user with persistent `/data` storage.
- VitePress documentation deploys at `https://ripwords.github.io/BambuDeck/`.

```sh
bun install --frozen-lockfile
bun run dev:server
bun run dev
bun run fmt
bun run lint
bun run check
bun run typecheck
bun run build
bun run docs:build
docker compose up -d --build
```

`bun run fmt` uses oxfmt. `bun run lint` uses oxlint and fails on warnings. `bun run check` checks formatting and linting without modifying files. Run the relevant checks once after a coherent change; repeat only when changes or failures justify it.

## Server boundaries

- `server/index.ts` owns process startup, listening, signal handling, and shutdown.
- `server/app.ts` composes Elysia routes and global authentication/error boundaries.
- `server/config.ts`, `http.ts`, `security.ts`, and `static.ts` own environment configuration, HTTP helpers, mutation protection, and static assets respectively.
- `server/auth/service.ts` configures Better Auth, schema migration, the single administrator, and existing-password migration. `auth/routes.ts` owns the password-only API and login throttling.
- `server/validation.ts` enables compiled Zod validation and translates invalid input into HTTP errors. Feature `model.ts` files define schemas and inferred input types.
- `server/printers/routes.ts` owns printer HTTP routes; `model.ts` validates profiles and preview queries; `service.ts` handles profile assembly and duplicate checks; `operations.ts` adapts control, files, metadata, camera, and streaming APIs.
- `server/settings/routes.ts` adapts settings requests; `model.ts` validates input; `service.ts` persists and serializes application of changes.
- `server/engine.ts` owns printer-session lifecycle and current-print metadata state. Keep HTTP response logic out of it.
- `server/printer.ts` owns MQTT transport, telemetry, capabilities, and command translation.
- `server/files.ts`, `metadata.ts`, and `camera.ts` own FTPS, bounded archive metadata, and shared camera transport.
- `server/preview.ts` owns bounded G-code/3MF layer parsing and temporary geometry caches. `src/preview/` and preview components own lazy 3D rendering, model loading, and resource disposal.
- `server/mqtt-integration.ts` publishes discovery and state to Home Assistant. Home Assistant is the actual external platform name. Its default discovery prefix is `homeassistant`; BambuDeck state topics and device identifiers use `bambudeck`.
- `server/store.ts` owns SQLite storage and credential encryption. Do not add an ORM solely to reorganize the code.

Group code by feature and responsibility. Prefer small public interfaces that hide real work. Avoid giant route dispatchers, generic service frameworks, one-line forwarding layers, and duplicated validation. Validate at external boundaries and keep protocol implementations separate from HTTP adapters.

## Authentication and storage

- Preserve the password-only setup/sign-in experience. Registration and native Better Auth signup/recovery routes are not public endpoints.
- Migrate an existing Argon2 password automatically. Existing browser sessions may require signing in again after an auth migration, but saved printer credentials must survive.
- Better Auth uses its own `auth_*` SQLite tables and a secret persisted in encrypted configuration. Password hashes and session records use Better Auth's storage schema; do not claim those tables are encrypted.
- Printer IP/host, serial number, LAN access code, and broker credentials use AES-256-GCM with `/data/secret.key` or `APP_ENCRYPTION_KEY` (base64, 32 bytes).
- Preserve the entire data directory and the correct encryption key during upgrades. Never silently replace an unreadable key or reset the database.
- Public printer responses expose masked credentials only. Credentials must not enter logs, URLs, screenshots, service-worker caches, or release assets.
- Mutations require the exact allowed Origin and `X-Requested-With: BambuDeck`. Set `APP_ORIGIN` for reverse proxies and HTTPS.
- Cookies are HttpOnly and SameSite Strict; use Secure when served through HTTPS. Preserve login throttling and request-size limits.

## Frontend boundaries and behavior

- `src/App.vue` is the application shell, shared header, and navigation.
- `src/features/` contains auth, overview, files, filament, settings, and printer-editing UI with local state.
- `src/composables/` owns authentication, printer connections, feedback, appearance, and the typed dashboard context. Use injection for truly shared state; keep feature forms local.
- `src/components/` contains reusable camera, modal, advanced-control, and preview components. Shared domain types belong in `src/types.ts`.
- Preserve feature state across tab switches where users expect it. Abort stale requests and close event streams when switching printers or unmounting.
- The selected printer, connection state, and reconnect action belong in the shared header. Do not repeat them below each page title.
- Keep copy short. Show errors clearly; successful commands use a four-second toast. Repeating the same message must restart its expiry timer.
- Appearance has System, Light, and Dark modes. Default to System, react to OS appearance changes, and persist explicit choices.
- Fan sliders initialize from reported speed and follow updates until edited. Incoming telemetry must not overwrite an unsent adjustment. Reset edits when switching/reconnecting printers. The current protocol reports fan levels from 0 to 15; display rounded percentages.
- Pause and Stop require confirmation. Cancellation sends no command. Keep the modal open when a command fails.
- Display temperatures rounded up to whole degrees. Preserve the underlying telemetry values.
- Highlight chamber-light On/Off only when the printer reports a recognized state. Unknown or disconnected state remains neutral.
- Files support case-insensitive current-folder search and sortable Name, Size, and Modified columns. Keep folders first, natural filename ordering, keyboard access, and `aria-sort`. Distinguish an empty folder from no search matches.
- Model previews, embedded thumbnails, sliced toolpaths, and live coordinates are different things. Label planned geometry honestly. STL contains geometry but no sliced layers. Unsliced 3MF requires slicing before preview; do not load arbitrary compressed models through an unbounded client-side ZIP parser. Never animate an invented live toolhead position from percentage progress.
- Current-print metadata must stay separate from metadata for files opened in the file browser. Clear stale previews when the job changes. Resolve encoded project filenames carefully and refuse ambiguous matches.
- Keep archive parsing, downloads, geometry, and caches bounded. A missing file, unsupported format, or missing slice data must give useful feedback rather than a misleading blank preview.

## Camera and PWA

- Mobile Safari compatibility is required. Use same-origin JPEG snapshots; long-lived multipart streams and desktop fullscreen behavior are insufficient validation.
- Share backend camera connections per printer. Retain abort handling, idle cleanup, retry limits, and browser-visibility behavior.
- Use the native dialog for enlarged views rather than depending on the iPhone fullscreen API.
- The service worker caches the app shell only. Never cache printer API responses, camera frames, authentication, or credentials. Never queue commands offline.
- Prompt for app updates; do not force reload during a print or form edit.
- Trusted HTTPS is required for full LAN PWA installation. GitHub Pages hosts documentation only; it cannot run the dashboard backend.

## Review lessons

- Check widths 320, 390, and a desktop viewport. Prevent horizontal overflow and keep navigation reachable.
- Screenshots in docs use clearly labeled sample data and no real credentials. Do not fabricate a camera feed.
- Capture mobile screenshots in a fresh browser viewport. Resizing a desktop page produced a compositor artifact that duplicated the header over bottom navigation; inspect the actual image, not only DOM measurements.
- Exercise initial telemetry, later telemetry, manual edits, reconnects, printer switches, errors, and component remounts when reviewing state changes.
- Check authentication migrations against isolated copies of legacy-shaped data and confirm restart persistence.
- A successful typecheck does not prove FTPS, MQTT, hardware command acceptance, or camera delivery on a physical printer.

## Commits and releases

- Use Conventional Commits: `feat`, `fix`, `refactor`, `perf`, `docs`, `style`, `test`, `build`, `ci`, `chore`, or `revert`, with an optional scope. Keep headers at most 100 characters.
- Husky checks formatting/linting before commits and commitlint validates commit messages. CI validates new commit messages and PR titles as well as format/lint/build checks. Do not bypass hooks to hide failures.
- Use changelogen through the release script. Do not manually bump versions and tag as the normal release path.

```sh
bun run release --dry-run
bun run release --minor
```

The release script requires clean `main` matching `origin/main`, validates the app, generates the changelog, bumps the version, creates a Conventional Commit and annotated tag, and pushes atomically. `--patch`, `--minor`, and `--major` are literal increments even before version 1.0. Dry-run does not commit, tag, or push.

- GitHub Actions owns Docker publication and GitHub Release creation after a successful image push. Release notes come from the matching `CHANGELOG.md` section.
- Stable tags publish `ripwords/bambudeck` for AMD64/ARM64 with exact, minor, major, and `latest` tags. Prereleases must never replace `latest`. Manual main-branch publishing uses `edge`.
- Release assets include an exact-version Compose file and checksums. Production Compose pulls an image; development Compose builds locally.
- `DOCKERHUB_USERNAME` is the lowercase Docker ID `ripwords`. `DOCKERHUB_TOKEN` belongs in GitHub Actions secrets. A capitalized username caused a malformed authorization error during setup.
- Keep Node.js in the Docker build stage. Bun's Node fallback previously broke Vue typechecking in Linux. The runtime remains Bun with FFmpeg.
- Skip Husky installation in CI, production, and Docker builds without Git metadata. Preserve frozen lockfile installs.
- Keep configuration and data across container recreation. Never use `docker compose down -v` for routine upgrades.
