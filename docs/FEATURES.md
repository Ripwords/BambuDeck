# Features

| Area | Implemented controls |
| --- | --- |
| Monitoring | MQTT status, print progress, remaining time, layers, temperatures, fan speeds, connection state, hardware messages, firmware details |
| Print jobs | Start uploaded or stored G-code/3MF, confirmed pause and stop, resume, skip objects, four speed profiles |
| Print options | Bed type, timelapse, bed leveling, flow calibration, vibration calibration, layer inspection, AMS |
| Hardware | Nozzle/bed/chamber temperature with model limits, cooling fans, light, nozzle configuration, sound, recovery, tangle detection, build-plate marker detection, raw G-code |
| AMS | Tray status, humidity, load/unload, external spool, pause/resume/reset, startup/tray reads, remaining estimation, K factor, filament properties |
| Storage | Browse, search current folder, sort by name/size/modified, upload, download, rename, delete, create folders, recursive ZIP download |
| 3MF | Plate metadata, objects, filament requirements, thumbnails, bounded archive extraction |
| Filament profiles | Search mounted JSON profiles with inheritance resolution |
| Camera | Shared JPEG tunnel or FFmpeg RTSP conversion, snapshot download, enlarged view, browser visibility pause and reconnection |
| Home Assistant | MQTT discovery, telemetry, print buttons, light, speed, temperature controls |
| Dashboard | Multiple saved printers, encrypted SQLite credentials, password login, system/light/dark theme, expiring command confirmations, mobile layout, installable app shell |
| Deployment | Multi-stage Docker image, Compose, persistent volume, nonroot runtime, healthcheck, optional HTTPS |

## Boundaries

Commands use LAN mode and depend on the printer model and firmware. Hardware capabilities are checked before sending temperature and fan commands. Unknown models use conservative limits.

The camera uses JPEG frames for browser compatibility. The printer determines available frame rate and camera access. RTSP conversion requires FFmpeg, included in Docker.

Hardware messages show reported codes and troubleshooting links. A bundled human-readable error-message catalogue is not included.

Filament profile search requires mounting a Bambu Studio profile directory. Profile settings can also be entered manually.

Offline mode caches the app shell. It does not queue printer commands, cache credentials, or simulate live telemetry.

Current-print previews use embedded 3MF thumbnails when the matching file is available in printer storage. Live toolhead coordinates are not currently available to the dashboard; a live print-path view is not included.
