# HTTPS & iPhone

Use a trusted HTTPS origin for PWA installation and service-worker support on a LAN address. Plain HTTP works as a browser dashboard but does not provide the full PWA experience.

## Reverse proxy

Point your reverse proxy at the dashboard's port 3000 and set `APP_ORIGIN` to the exact external origin, for example `https://printer.example.com`.

Preserve the request `Origin` header, allow long-lived connections, and disable response buffering for `/api/printers/*/b/events`. Permit uploads up to 1 GiB if you need that file size. Keep the upstream connection on HTTP when the proxy terminates TLS.

## Direct HTTPS

Use a trusted certificate for the hostname or IP you open on your phone. If you use a local certificate authority, install and trust it on the phone first.

Create `compose.https.yaml`:

```yaml
services:
  dashboard:
    volumes:
      - ./certs:/certs:ro
    environment:
      TLS_CERT_FILE: /certs/fullchain.pem
      TLS_KEY_FILE: /certs/privkey.pem
      APP_ORIGIN: https://printer.example.com:3000
```

Use your actual URL, including the port when it is not 443. The certificate and key must be readable by the container's `bun` user.

```sh
docker compose -f compose.production.yaml -f compose.https.yaml up -d
```

## Install on iPhone or iPad

Open the HTTPS URL in Safari, sign in, and choose **Share → Add to Home Screen**. When an app update is ready, the dashboard offers a reload; you can defer it.

## Camera behavior

The viewer fetches sequential JPEG snapshots from the same origin. This avoids dependence on native RTSP playback, autoplay permissions, or a persistent MJPEG response in Safari. The enlarged camera opens in a dialog rather than relying on the fullscreen API.

The server shares a camera connection between viewers and uses FFmpeg when RTSP conversion is needed. Frame rate and camera availability depend on the printer and firmware. A physical iPhone/iPad and live printer camera have not yet been verified; see [Verification](./VERIFICATION.md).
