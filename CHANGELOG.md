# Changelog

## v0.5.3

[compare changes](https://github.com/Ripwords/BambuDeck/compare/v0.5.2...v0.5.3)

### 🚀 Enhancements

- **files:** Choose which sliced plate to print from a 3MF ([6e6e561](https://github.com/Ripwords/BambuDeck/commit/6e6e561))

### 🩹 Fixes

- **preview:** Reload when the next plate of a project starts ([d38cee2](https://github.com/Ripwords/BambuDeck/commit/d38cee2))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.5.2

[compare changes](https://github.com/Ripwords/BambuDeck/compare/v0.5.1...v0.5.2)

### 🩹 Fixes

- **preview:** Explain when slicers label objects for skipping ([45b19e0](https://github.com/Ripwords/BambuDeck/commit/45b19e0))
- **preview:** Name the Bambu Studio versions that label objects ([778f7d3](https://github.com/Ripwords/BambuDeck/commit/778f7d3))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.5.1

[compare changes](https://github.com/Ripwords/BambuDeck/compare/v0.5.0...v0.5.1)

### 🚀 Enhancements

- **settings:** Show reported printer preference states ([cb16064](https://github.com/Ripwords/BambuDeck/commit/cb16064))

### 🩹 Fixes

- **preview:** Use the sliced plate stored in the file when none is reported ([b87d724](https://github.com/Ripwords/BambuDeck/commit/b87d724))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.5.0

[compare changes](https://github.com/Ripwords/BambuDeck/compare/v0.4.0...v0.5.0)

### 🚀 Enhancements

- **preview:** Add shared binary toolpath format ([34d76e8](https://github.com/Ripwords/BambuDeck/commit/34d76e8))
- **preview:** Stream labelled binary toolpaths from the server ([9533824](https://github.com/Ripwords/BambuDeck/commit/9533824))
- **preview:** Scrub live toolpath layers and skip objects ([cadb0ee](https://github.com/Ripwords/BambuDeck/commit/cadb0ee))

### 💅 Refactors

- **printer:** Validate skipped object IDs with zod ([f158bea](https://github.com/Ripwords/BambuDeck/commit/f158bea))

### 📖 Documentation

- Describe live layers and object skipping ([2574af1](https://github.com/Ripwords/BambuDeck/commit/2574af1))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.4.0

[compare changes](https://github.com/Ripwords/BambuDeck/compare/v0.3.1...v0.4.0)

### 🚀 Enhancements

- **discovery:** Find LAN printers and recover changed addresses ([aec0712](https://github.com/Ripwords/BambuDeck/commit/aec0712))

### 🩹 Fixes

- **http:** Preserve static asset size in HEAD responses ([16b70c9](https://github.com/Ripwords/BambuDeck/commit/16b70c9))
- **pwa:** Refresh the Apple home screen icon URL ([3a9a064](https://github.com/Ripwords/BambuDeck/commit/3a9a064))

### 🏡 Chore

- **release:** V0.3.2 ([35ff0e6](https://github.com/Ripwords/BambuDeck/commit/35ff0e6))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

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
