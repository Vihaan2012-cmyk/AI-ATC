# MSFS AI ATC

Text + voice AI air traffic control for Microsoft Flight Simulator 2020/2024, in the spirit of Beyond ATC.
You talk to ATC in a desktop app; a **local** AI (Qwen via Ollama, or any local model) replies with realistic
ATC across a full gate-to-gate flight. Everything runs on your machine — no cloud.

> **It's an ATC controller, not a chatbot.** The AI only handles air-traffic-control requests — it parses
> what you say into the closest valid pilot request and replies with controller phraseology. It won't answer
> general questions or act as a co-pilot/assistant. Off-topic input is mapped to the nearest ATC intent or
> politely asked to "say again."

## What works

- **Full controller chain**, gate to gate: Clearance Delivery → Ground → Tower → Departure → Center →
  Approach → Tower (landing) → Ground (taxi-in), with automatic handoffs and frequency changes.
- **Radar vectoring** on approach (heading/altitude/speed) with **readback compliance** checking.
- **Traffic sequencing** ("number two, follow the traffic"), **real taxi routing** from SimConnect, and
  **reactive ATC** that calls out altitude/descent/glidepath deviations from your live flight.
- **VFR** flight following + pattern work (touch-and-go, closed traffic), **emergencies**, and **holds**.
- **Real navdata from your sim** via SimConnect (frequencies + runways), disk-cached so it works offline once
  visited. **Auto-tune** sets your COM radio on handoff.
- **SimBrief** flight plans, live **weather/ATIS**, and **Hoppie CPDLC** datalink.
- **Voice**: system TTS or downloadable **Piper HD** voices cast per controller; **push-to-talk** speech input.
- **Local AI, your choice**: Ollama, or any OpenAI-compatible local server (LM Studio, llama.cpp, Jan,
  KoboldCpp, vLLM, GPT4All…).
- Persistent **logbook**, ambient radio chatter, and realism/strictness settings.

## Prerequisites

- **Windows** + **MSFS 2020/2024** (SimConnect is Windows-only)
- **A local AI**: [Ollama](https://ollama.com) + `ollama pull qwen2.5:14b` (the first-run wizard can do this
  for you), OR any OpenAI-compatible server
- Optional: a **SimBrief** username (for real flight plans)

### System requirements

The AI model runs locally, so it's the main cost on top of MSFS itself.

- **RAM:** 32 GB recommended (MSFS wants ~16 GB; `qwen2.5:14b` adds ~10–12 GB). With 16 GB you'll need a
  smaller model (e.g. `qwen2.5:7b`) or run the AI on a second machine / GPU.
- **Storage:** ~10 GB free — Ollama + `qwen2.5:14b` (~9 GB) plus the app (~200 MB). Add up to ~3 GB if you
  download the full Piper HD voice set (voices are optional and fetched on demand).
- **CPU/GPU:** any modern CPU works (the 14B model runs on CPU so MSFS keeps the GPU); a GPU speeds the AI up
  and is selectable in settings. A smaller model is much faster if responses feel slow.

## Install & run

1. Download the latest **`Air-Traffic-Control-Setup-*.exe`** from the
   [Releases](https://github.com/Vihaan2012-cmyk/AI-ATC/releases) page and run it.
2. On first launch, the **install wizard** checks for Ollama, pulls the AI model, and writes your config.
3. Launch a flight in MSFS, then start the app and call ATC.

> **Unsigned app — SmartScreen warning is expected.** The installer isn't code-signed (a signing
> certificate costs money), so Windows will show *"Windows protected your PC."* Click **More info →
> Run anyway**. This is normal for open-source apps; the source is right here if you'd rather build it
> yourself. **First launch needs internet** to download the AI model (~9 GB via Ollama); after that it
> runs fully offline.

Start with `"Delivery, <callsign>, request IFR clearance to <dest>, information Alpha."`, read back the
clearance (include the squawk), then talk to each controller as you're handed off. The app tracks state,
validates readbacks, and uses your sim's real frequencies and runways.

## Building from source

```powershell
npm install
npm run server          # the brain (SimConnect + AI + comms)
cd app && npm start     # the desktop app
```

Package an installer with `cd app && npm run dist` (requires an elevated shell on Windows).

## License

MIT — see [LICENSE](LICENSE). Fan project; not affiliated with Microsoft, Asobo, Navigraph, SimBrief, or
Beyond ATC. No proprietary data is redistributed — navdata comes live from each user's own sim, and `.env`,
`navdata/`, and `cache/` are gitignored.
