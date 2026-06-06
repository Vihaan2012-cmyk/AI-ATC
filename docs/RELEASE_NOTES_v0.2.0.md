# AI ATC — v0.2.0

Local **text + voice AI air traffic control** for Microsoft Flight Simulator 2020/2024, in the spirit
of Beyond ATC. Everything runs on your machine — no cloud, no subscription.

It's an **ATC controller, not a chatbot**: a deterministic engine owns all the facts (frequencies,
runways, procedures, sequencing), and a small local AI only turns what you say into the closest valid
pilot request. Off-topic input is mapped to the nearest ATC intent or given a "say again."

### New in 0.2.0
- **Custom ATC model** (`myaimodels/atc-nlu`) — fast, purpose-built, now the default
- **Flight dashboard** with a 3D globe of your routes + full SimBrief OFP per flight
- Approach **vectoring + readback compliance**, **traffic sequencing**, **reactive ATC**
- **VFR** flight following + pattern work, **emergencies**, **holds**
- **Real taxi routing**, **frequency awareness**, **auto-tune COM**
- **Hoppie CPDLC**, **Piper HD voices**, **push-to-talk**, logbook, ambient chatter
- Installer now bundles everything and the uninstaller cleans up data + the model

## Install

1. Download **`Air-Traffic-Control-Setup-0.2.0.exe`** below and run it.
2. The first-run **wizard** installs/finds [Ollama](https://ollama.com), pulls the AI model, and writes
   your config.
3. Start a flight in MSFS, launch the app, and call ATC.

> **Windows SmartScreen will warn** — the app isn't code-signed. Click **More info → Run anyway**.
> Normal for open-source; the full source is in this repo.
>
> **First launch needs internet** to pull the AI model via Ollama (~2 GB for the default `atc-nlu`,
> or ~9 GB if you choose `qwen2.5:14b`). After that it runs fully offline.

## What's in it

**ATC engine — gate to gate**
- Full controller chain: Delivery → Ground → Tower → Departure → Center → Approach → Tower (landing)
  → Ground (taxi-in), with automatic handoffs and frequency changes
- Approach **radar vectoring** (heading/altitude/speed) with **readback-compliance** checking
- **Traffic sequencing** ("number two, follow the traffic")
- **Reactive ATC** — calls out altitude/descent/glidepath deviations from your live flight
- **VFR** flight following + **pattern work** (touch-and-go, closed traffic), **emergencies**, **holds**

**Real sim integration**
- Real **navdata** (frequencies + runways) from your sim via SimConnect, disk-cached for offline reuse
- **Real taxi routing** from SimConnect parking/taxiway data
- **Auto-tune** — sets your COM radio on handoff
- **Frequency awareness** — the active controller follows what COM1 is tuned to

**Data & comms**
- **SimBrief** flight plans, live **weather/ATIS**, **Hoppie CPDLC** datalink

**Voice**
- System TTS out of the box, or downloadable **Piper HD** voices cast per controller
- **Push-to-talk** speech input

**Extras**
- **Flight dashboard** — a local web page (`localhost:8742/dashboard`) with a 3D globe of your flown
  routes, stats, and the full SimBrief OFP per flight
- Persistent **logbook**, ambient radio chatter, realism/strictness settings
- **Custom ATC model** — a fast, purpose-built 1.5B model (`myaimodels/atc-nlu`) is the default;
  ~3× faster than `qwen2.5:14b` and more accurate on messy phrasing. Train your own from `training/`.

## Recommended specs

| Model (selectable) | RAM | Free disk |
| --- | --- | --- |
| `myaimodels/atc-nlu` (default) | 16 GB | ~2.5 GB |
| `qwen2.5:14b` (bigger, general) | 32 GB | ~10 GB |

The model runs on CPU so MSFS keeps the GPU (a GPU speeds the AI up and is selectable in Settings).

## Uninstalling

The uninstaller offers to also remove your settings/voices and the downloaded Ollama model, so it
cleans up fully. Ollama itself is left installed (other apps may use it).

## Known limitations / honest notes

- **Windows only** (SimConnect is Windows-only).
- **Unsigned** — expect the SmartScreen prompt above.
- **Hoppie CPDLC** needs a free Hoppie logon; it's optional and off unless you set one.
- **SID/STAR/airways** use SimConnect + heuristics, not a full procedure database (Navigraph data is
  personal-use-licensed and intentionally not redistributed — the app reads your own sim's navdata).
- This is a **fan project**, not affiliated with Microsoft, Asobo, Navigraph, SimBrief, or Beyond ATC.

MIT licensed. Feedback and issues welcome.
