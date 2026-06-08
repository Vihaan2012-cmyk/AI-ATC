# MSFS ATC Panel (Community Package)

A real-time Air Traffic Control panel for Microsoft Flight Simulator 2020+ that connects to the local MSFS AI ATC brain.

## Installation

1. Ensure the **Air Traffic Control desktop app** is running (see main project README).
2. Copy the `msfs-panel` folder into your MSFS Community folder:
   - Windows: `C:\Users\<YourUsername>\AppData\Local\Packages\Microsoft.FlightSimulator_<hash>\LocalState\packages\Community\msfs-panel`
   - Or: `%USERPROFILE%\AppData\Local\Packages\Microsoft.FlightSimulator_*\LocalState\packages\Community`
3. Launch MSFS and look for "ATC Panel" in your aircraft's toolbar (upper instrument area).

## Features

This panel is **generated from the desktop widget** (`widget/atc-widget.html` via `build-panel.mjs`),
so it mirrors the full UI — COMMS, PLAN, GROUND, Flight School, and Settings tabs — all driven by the
same `ws://localhost:8742` connection to the brain. Run `node msfs-panel/build-panel.mjs` after any
widget change to regenerate the panel (and its `layout.json`).

## Rebuilding the package (IMPORTANT)

MSFS will not load the package unless `layout.json` is an up-to-date index of every file. After ANY
change to files in `msfs-panel/`:

1. Run `node msfs-panel/build-panel.mjs` — this regenerates the panel HTML **and** runs
   `MSFSLayoutGenerator.exe` (looked up in your Downloads) to rebuild `layout.json`.
2. Or run the generator manually: drag `msfs-panel/layout.json` onto `MSFSLayoutGenerator.exe`.

## Requirements

- **Desktop App Running**: The main Air Traffic Control app must be running on your PC and connected to MSFS via SimConnect.
- **Network**: The panel connects to the brain over `ws://localhost:8742` (local, no internet needed).
- **MSFS 2020+**: Tested on MSFS 2020 and 2024; may work on earlier versions.

## Known Limitations (honest)

- **CoherentGT may block `ws://localhost`**: MSFS's UI engine restricts network access from panels.
  If the panel shows "start the desktop app" even when the brain is running, CoherentGT is blocking
  the WebSocket — in that case use the desktop widget. **This is the main unknown and needs in-sim
  testing.** The panel + WebSocket are confirmed working in a normal browser.
- **The PLAN map (Leaflet) loads from a CDN** and will likely not render in-sim (no internet in
  CoherentGT); it degrades gracefully to no-map. Everything else works without the CDN.
- **Audio/voice** plays through the desktop app, not the panel.
- **No 3D world overlay**: an HTML panel cannot draw taxi routes onto the actual taxiways — that
  requires an MSFS SDK gauge/scenery addon, not a toolbar panel. The GROUND tab shows a 2D diagram.

## Troubleshooting

### Panel doesn't appear
- Check that the desktop app is running and shows "online" in the status bar.
- Restart MSFS.
- Verify the folder is in the correct Community path.

### "Start the desktop app" message
- Ensure the desktop Air Traffic Control app is running on your PC.
- Check that it's connected to MSFS (see the widget status in the app).
- Open Developer Tools in MSFS (Ctrl+Shift+Z) and check the Console for WebSocket errors.

### Text input not working
- The text box only accepts input when the panel has focus and the brain is online.
- Click inside the text box first.

## Development

This panel is a standalone web component that runs inside MSFS's Chromium instance. It uses:
- Vanilla JavaScript (no frameworks or bundlers — for minimal latency).
- CSS Grid and Flexbox for responsive layout.
- WebSocket for real-time communication with the brain.

The core logic mirrors the desktop widget (`widget/atc-widget.html`) but excludes audio and mapping.

## License

Same as the main project.
