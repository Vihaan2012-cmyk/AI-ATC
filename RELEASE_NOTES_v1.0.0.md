# AI ATC for MSFS — v1.0.0

The first stable release. A local, no-cloud AI air traffic controller for Microsoft Flight
Simulator 2020/2024: a deterministic ATC engine that owns all the facts, with a local LLM
(Qwen via Ollama) handling only the language. Text + voice, fully offline.

## Highlights

- **Free-flow ATC** — natural back-and-forth: clearances, taxi, takeoff/landing, handoffs,
  conditional clearances, go-arounds, visual/circle-to-land approaches, reroutes, diversions,
  holds, SVFR, formation, progressive taxi, and runway changes.
- **Game overlay** — the desktop widget runs as a borderless, always-on-top overlay over MSFS.
  Global hotkeys that work while the sim is focused:
  - `Ctrl+Shift+A` — show / hide the overlay
  - `Ctrl+Shift+C` — toggle click-through (overlay stays visible, mouse passes to the sim)
  - `Ctrl+Shift+Space` — push-to-talk
- **In-sim toolbar panel** — an MSFS 2020/2024 Community package that adds an **AI ATC** button to
  the in-game toolbar, mirroring the full UI and connecting to the brain over `ws://localhost:8742`.
- **Flight School** — learn ATC radio with lessons, drills, and a phrasebook.
- **Living traffic** — AI traffic on the map with range rings and granular per-category toggles.
- **SimBrief integration** — pull your real flight plan by SimBrief ID.
- **Local voice** — optional Piper HD voices; everything runs on your machine.

## Install

- **Desktop app:** run the installer; launch from the Start menu. Set your SimBrief ID in Setup.
- **In-sim panel (optional):** copy `msfs-panel` into your MSFS Community folder (see
  `msfs-panel/README.md`). The desktop app must be running for the panel to connect.

## Notes

- Requires Ollama running locally with the ATC model pulled (the installer wizard handles this).
- For the overlay to float over MSFS, run the sim in **Windowed** or **Borderless** display mode
  (not exclusive Full Screen).
