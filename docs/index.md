# BambuDeck

Monitor and control Bambu Lab printers from your browser. Run one Docker container on your network; use the dashboard from your desktop or phone.

[Set up with Docker →](./getting-started.md)

## Screenshots

The screenshots use sample telemetry. The previews show real geometry: Bambu Studio's bundled sample models sliced with its command-line slicer and rendered by BambuDeck's own parser. No camera is connected.

![BambuDeck desktop dashboard with a sample print at layer 104 of 240](/screenshots/desktop.png)

<details>
<summary>Mobile dashboard</summary>

![BambuDeck mobile dashboard with sample print progress](/screenshots/mobile.png)

</details>

## In the dashboard

- Print progress, temperatures, layers, AMS trays, and camera.
- A 3D layer preview of the sliced toolpath that follows the print. Scrub any layer and skip objects mid-print.
- Start, pause, resume, and stop jobs. Choose which plate of a multi-plate 3MF to print.
- Filament runout detection, with the reason a print paused.
- Upload files, preview STL and sliced 3MF, and manage the SD card.
- Find printers on the LAN, and recover automatically when a printer's address changes.
- Printer preferences that show the state the printer reports.
- Connect Home Assistant through MQTT Discovery.

See [feature coverage](./FEATURES.md) for the full list and model-dependent limits.

## Local storage

BambuDeck uses Bun, Elysia, and SQLite. Printer addresses, serial numbers, LAN access codes, and broker credentials are encrypted before storage. The Vue PWA caches its app shell; live printer operations require a connection to your server.

[Configure HTTPS](./HTTPS.md) for installation on iPhone and iPad. The camera uses same-origin JPEG frames, with FFmpeg included for printers using RTSP.

## Deployment

Images are published to [`ripwords/bambudeck`](https://hub.docker.com/r/ripwords/bambudeck). GitHub Actions builds the app, publishes releases, and deploys these docs. [Deployment guide →](./deployment.md)

Physical printer, Home Assistant, and iPhone camera verification remains outstanding. See the [verification record](./VERIFICATION.md).
