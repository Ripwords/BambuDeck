# BambuDeck

Monitor and control Bambu Lab printers from your browser. Run one Docker container on your network; use the dashboard from your desktop or phone.

[Set up with Docker →](./getting-started.md)

## Screenshots

Desktop and mobile views with sample printer data. No live camera is connected in these previews.

![BambuDeck desktop dashboard with sample print progress](/screenshots/desktop.png)

<details>
<summary>Mobile dashboard</summary>

![BambuDeck mobile dashboard with sample print progress](/screenshots/mobile.png)

</details>

## In the dashboard

- Print progress, temperatures, layers, and camera.
- Start, pause, resume, and stop jobs.
- Upload files, inspect 3MF plates, and manage the SD card.
- Manage AMS filament and printer settings.
- Connect Home Assistant through MQTT Discovery.

See [feature coverage](./FEATURES.md) for the full list and model-dependent limits.

## Local storage

BambuDeck uses Bun, Elysia, and SQLite. Printer addresses, serial numbers, LAN access codes, and broker credentials are encrypted before storage. The Vue PWA caches its app shell; live printer operations require a connection to your server.

[Configure HTTPS](./HTTPS.md) for installation on iPhone and iPad. The camera uses same-origin JPEG frames, with FFmpeg included for printers using RTSP.

## Deployment

Images are published to [`ripwords/bambudeck`](https://hub.docker.com/r/ripwords/bambudeck). GitHub Actions builds the app, publishes releases, and deploys these docs. [Deployment guide →](./deployment.md)

Physical printer, Home Assistant, and iPhone camera verification remains outstanding. See the [verification record](./VERIFICATION.md).
