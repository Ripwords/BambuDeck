# Docker setup

## Requirements

Use Docker Engine with Compose on an AMD64 or ARM64 host that can reach your printer. Enable LAN mode on the printer and have its IP address, serial number, and LAN access code ready.

## Start BambuDeck

```sh
mkdir bambudeck
cd bambudeck
curl -fsSL https://raw.githubusercontent.com/Ripwords/BambuDeck/main/compose.production.yaml -o compose.production.yaml
docker compose -f compose.production.yaml up -d
```

Open `http://localhost:3000` on the Docker host, or `http://<docker-host-ip>:3000` from your phone. Create your dashboard password, then add a printer in Settings.

```sh
docker compose -f compose.production.yaml ps
docker compose -f compose.production.yaml logs -f dashboard
```

The container includes Bun and FFmpeg. No separate printer service is needed. If a tagged image has not yet been published, [build from source](#build-from-source).

## Keep your data

The named `dashboard-data` volume contains the database and encryption key. Keep the same Compose project directory or project name when upgrading so Compose reconnects the existing volume.

`docker compose -f compose.production.yaml down` preserves the volume. Adding `--volumes` deletes saved data. See [backup and restore](./deployment.md#backup-and-restore) before changing storage.

## Connect your printer

Select the printer from the shared header. Printer controls become available after connection. Uploading a file does not start a print: choose the file and print options separately.

Your Docker host must reach the printer on MQTT TLS port 8883, FTPS port 990 and its passive data connections, and the model's camera port. Internet port forwarding is not needed for printer connections.

Use [trusted HTTPS](./HTTPS.md) to install the dashboard as a PWA on your phone.

## Build from source

```sh
git clone https://github.com/Ripwords/BambuDeck.git
cd BambuDeck
docker compose up -d --build
```

This builds `bambudeck:local`. Use `compose.production.yaml` when you want to pull published images instead.
