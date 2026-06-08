# MSFS ATC Panel (Community Package)

A real-time Air Traffic Control panel for Microsoft Flight Simulator 2020+ that connects to the local MSFS AI ATC brain.

## Installation

1. Ensure the **Air Traffic Control desktop app** is running (see main project README).
2. Copy the `msfs-panel` folder into your MSFS Community folder:
   - Windows: `C:\Users\<YourUsername>\AppData\Local\Packages\Microsoft.FlightSimulator_<hash>\LocalState\packages\Community\msfs-panel`
   - Or: `%USERPROFILE%\AppData\Local\Packages\Microsoft.FlightSimulator_*\LocalState\packages\Community`
3. Launch MSFS and look for "ATC Panel" in your aircraft's toolbar (upper instrument area).

## Features

- **Live Communications Log**: See all ATC transmissions, your readbacks, and system messages in real time.
- **Quick-Action Buttons**: One-click requests for ATIS, clearance, pushback, taxi, ready, and traffic.
- **Clearance Readout**: Always-visible current altitude, heading, speed, squawk code, and next frequency.
- **Text Input**: Type your own transmissions if voice input isn't available in MSFS.
- **Offline Fallback**: Shows a friendly message if the desktop brain isn't running; reconnects automatically.

## Requirements

- **Desktop App Running**: The main Air Traffic Control app must be running on your PC and connected to MSFS via SimConnect.
- **Network**: The panel connects to the brain over `ws://localhost:8742` (local, no internet needed).
- **MSFS 2020+**: Tested on MSFS 2020 and 2024; may work on earlier versions.

## Known Limitations

- **No Audio**: CoherentGT (MSFS's rendering engine) blocks audio playback in in-sim panels. Voice transmissions are played via the desktop app instead.
- **No Map**: To keep the panel lightweight, the interactive map is only in the desktop widget.
- **Read-Only**: You cannot adjust frequencies, transponder codes, or flight-planned waypoints from the panel (use the desktop app or your avionics).

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
