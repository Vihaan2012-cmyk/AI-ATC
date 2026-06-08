# MSFS ATC Panel (Community Package)

A real-time Air Traffic Control panel for Microsoft Flight Simulator 2020+ that connects to the local MSFS AI ATC brain.

## Installation (MSFS 2020)

MSFS 2020 only loads a toolbar panel if it is **compiled into an `.spb`** with the SDK — you cannot
just drop the raw HTML folder in Community (that's why nothing appears). Steps:

1. **Install the MSFS SDK** (enable Developer Mode in MSFS → SDK installer). It sets the `MSFS_SDK`
   environment variable.
2. From this `msfs-panel` folder, run **`build.bat`**. It:
   - regenerates the panel HTML from the desktop widget,
   - runs `fspackagetool.exe Build\atc-panel.xml` to compile `InGamePanel_ATCPanel.spb`,
   - copies the `.spb` into `InGamePanels\`.
3. Run **`node build-panel.mjs`** (or it runs in step 2) to refresh `layout.json`.
4. Copy this entire `msfs-panel` folder into your MSFS **Community** folder.
5. Ensure the **AI ATC desktop app** (or `npm run server`) is running so the panel can reach
   `ws://localhost:8742`.
6. Launch MSFS, load a flight, and look for the **AI ATC** button in the in-game toolbar.

### Why a build step is required
The toolbar button is declared in `Build/PackageSources/atc-panel.xml`
(`<InGamePanels.InGamePanelDefinition … buttonVisible="true">`). MSFS reads this only from a compiled
`.spb`, produced by `fspackagetool`. Structure mirrors the proven
[bymaximus/msfs2020-toolbar-window-template](https://github.com/bymaximus/msfs2020-toolbar-window-template).

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
