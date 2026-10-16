# Features

| Area              | Implemented controls                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Monitoring        | MQTT status, print progress, remaining time, layers, temperatures, fan speeds, connection state, hardware messages, firmware details                                     |
| Print jobs        | Start uploaded or stored G-code/3MF, confirmed pause and stop, resume, skip objects from the preview, four speed profiles                                                |
| Print options     | Bed type, timelapse, bed leveling, flow calibration, vibration calibration, layer inspection, AMS                                                                        |
| Hardware          | Nozzle/bed/chamber temperature with model limits, cooling fans, light, nozzle configuration, sound, recovery, tangle detection, build-plate marker detection, raw G-code |
| AMS               | Tray status, humidity, load/unload, external spool, pause/resume/reset, startup/tray reads, remaining estimation, K factor, filament properties                          |
| Storage           | Browse, search current folder, sort by name/size/modified, upload, download, rename, delete, create folders, recursive ZIP download                                      |
| 3MF               | Plate metadata, objects, filament requirements, thumbnails, bounded archive extraction, planned toolpath and layer preview                                               |
| Filament profiles | Search mounted JSON profiles with inheritance resolution                                                                                                                 |
| Camera            | Shared JPEG tunnel or FFmpeg RTSP conversion, snapshot download, enlarged view, browser visibility pause and reconnection                                                |
| Home Assistant    | MQTT discovery, telemetry, print buttons, light, speed, temperature controls                                                                                             |
| Dashboard         | Multiple saved printers, encrypted SQLite credentials, password login, system/light/dark theme, expiring command confirmations, mobile layout, installable app shell     |
| Deployment        | Multi-stage Docker image, Compose, persistent volume, nonroot runtime, healthcheck, optional HTTPS                                                                       |

## Boundaries

Commands use LAN mode and depend on the printer model and firmware. Hardware capabilities are checked before sending temperature and fan commands. Unknown models use conservative limits.

The camera uses JPEG frames for browser compatibility. The printer determines available frame rate and camera access. RTSP conversion requires FFmpeg, included in Docker.

Printer preferences highlight the state the printer reports for automatic recovery, filament switching, tangle detection, sounds, and build plate marker detection. Options the printer reports as unsupported are hidden. After a change, BambuDeck requests a status refresh so the highlight follows the printer.

Hardware messages show reported codes and troubleshooting links. A bundled human-readable error-message catalogue is not included.

Filament profile search requires mounting a Bambu Studio profile directory. Profile settings can also be entered manually.

Offline mode caches the app shell. It does not queue printer commands, cache credentials, or simulate live telemetry.

Current-print previews use embedded 3MF thumbnails when the matching file is available in printer storage. The 3D preview displays planned extrusion paths from sliced 3MF or G-code. During a print it follows the reported layer: printed layers are solid, the current layer is highlighted, and the rest of the plate is faint. Dragging the layer slider updates the view immediately; select Live to follow the print again. When the printer doesn't report which plate is printing, the preview uses the sliced plate stored in the file, so a single plate exported from a multi-plate project previews correctly. STL previews display the mesh without sliced layers. Slice an unsliced 3MF before using its layer preview. Live toolhead coordinates are not available; the viewer shows planned paths, not the nozzle position.

## Skipping objects

Open Explore on the current print, then tap objects in the view or check them in the list. Select Skip and confirm. Skipped objects stop printing for the rest of the job and cannot be restored. They appear greyed out and are counted under the progress bar.

Skipping requires object labels in the sliced file. Turn on Exclude objects or object labelling in your slicer, then slice again. Files without labels show a notice instead of the list.

Skipping is available while the print is running or paused. Whether the printer accepts the command over LAN depends on its model and firmware. It has not been verified on P1S hardware. The raw object-ID form under Advanced controls has been removed.
