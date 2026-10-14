# Verification

## Completed

- Vue and server TypeScript compilation passed with `bun run typecheck`.
- Vite production build generated the app, manifest, and service worker.
- Docker multi-stage build passed on the local ARM64 Docker host. The build stage uses Node 22 for Vue typechecking; runtime uses Bun with FFmpeg.
- Docker started successfully and passed its healthcheck.
- Runtime user is UID 1000, not root.
- Manual API checks returned 200 for initial password setup, 201 for saving a dummy profile, and 401 for an unauthenticated profile request.
- Restarting the review container preserved the password and saved profile.
- SQLite credential rows did not contain the dummy IP address, serial, or access code in plaintext. The generated encryption key has mode 0600.
- Browser review covered overview, files, filament and settings at widths 320, 375, 414, 768 and 1440 pixels, without horizontal overflow. The final shared header was checked separately at all five widths.
- Browser setup, printer creation, offline error handling, page navigation, and credential masking were inspected.

## Version 0.2.0 browser checks

Simulated printer telemetry was used to inspect fan synchronization without overwriting edited values, Pause/Stop confirmation and cancellation, rounded temperature displays, chamber-light state, four-second toast expiry, theme persistence and system appearance changes, and file search/sorting at mobile and desktop widths. These checks did not send hardware commands.

## Not verified against hardware

No physical printer or Home Assistant broker was supplied. MQTT command acceptance, FTPS compatibility, live camera delivery, and Home Assistant discovery have been implemented and reviewed but not exercised against a real printer.

Camera delivery uses ordinary same-origin JPEG images and avoids Safari fullscreen and long-lived MJPEG requirements. Desktop browser behavior was reviewed; a physical iPhone/iPad and its printer camera connection were not available. Trusted HTTPS is required for full PWA installation on a LAN address.

No automated tests were added or run. The checks above were build, manual API, browser inspection, and container checks.
