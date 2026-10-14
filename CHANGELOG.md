# Changelog

## v0.3.1

[compare changes](https://github.com/Ripwords/BambuDeck/compare/v0.3.0...v0.3.1)

### 🩹 Fixes

- **pwa:** Add mobile Safari favicon fallbacks ([3637d55](https://github.com/Ripwords/BambuDeck/commit/3637d55))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.3.0

[compare changes](https://github.com/Ripwords/BambuDeck/compare/v0.2.0...v0.3.0)

### 🚀 Enhancements

- **app:** Add layer previews, Better Auth, and compiled Zod validation ([221caf2](https://github.com/Ripwords/BambuDeck/commit/221caf2))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.2.0

[Compare changes](https://github.com/Ripwords/BambuDeck/compare/v0.1.0...v0.2.0)

### Features

- Add System, Light, and Dark appearance modes with persistent preferences.
- Add current-folder search and sortable Name, Size, and Modified columns.
- Display the reported chamber-light state.
- Add Pause confirmation and retain Stop confirmation.

### Fixes

- Synchronize fan sliders with telemetry without overwriting unsent adjustments.
- Load current-print previews from matching 3MF files, including encoded job names.
- Keep file-browser metadata separate from the active print preview.
- Expire command notifications after four seconds, resetting the timer for repeated commands.
- Round displayed temperatures up to whole degrees.

### Documentation

- Refresh desktop and mobile screenshots and document hardware verification limits.

## v0.1.0

### Features

- Introduce the mobile Vue PWA for local printer monitoring and control.
- Add encrypted printer credentials, camera snapshots, file management, AMS controls, and MQTT integration.
- Publish Docker images for AMD64 and ARM64 with GitHub Pages documentation.
