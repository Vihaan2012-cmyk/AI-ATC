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
  KoboldCpp, vLLM, GPT4All…) — plus an optional **custom ATC model** you can train yourself (see below).
- Persistent **logbook**, ambient radio chatter, and realism/strictness settings.
- **Flight dashboard** — a local web page with a 3D globe of your flown routes, stats, and per-flight OFPs.

## Prerequisites

- **Windows** + **MSFS 2020/2024** (SimConnect is Windows-only)
- **A local AI** via [Ollama](https://ollama.com) — either the light custom model
  `ollama pull myaimodels/atc-nlu` (~2 GB, recommended) or a general one like `ollama pull qwen2.5:14b`
  (~9 GB; the first-run wizard can fetch this for you). Any OpenAI-compatible server works too.
- Optional: a **SimBrief** username (for real flight plans)

### System requirements

The AI model runs locally, so it's the main cost on top of MSFS itself. **Which model you use sets
the bar** — and there's a tiny purpose-built one, so even modest PCs work:

| Setup | RAM | Free disk | Notes |
| --- | --- | --- | --- |
| **`myaimodels/atc-nlu`** (recommended) | **16 GB** | **~2.5 GB** | The custom 1.5B ATC model — fast, accurate for ATC, light. `ollama pull myaimodels/atc-nlu` |
| `qwen2.5:14b` (general, default in wizard) | 32 GB | ~10 GB | Most capable for free-form phrasing, but ~10–12 GB RAM and slower on CPU |
| `qwen2.5:7b` (middle ground) | 24 GB | ~6 GB | A compromise if you don't want the 14b |

- **CPU/GPU:** any modern CPU works — the model runs on CPU so MSFS keeps the GPU. A GPU speeds the AI
  up and is selectable in Settings. If responses feel slow, switch to the smaller `atc-nlu` model.
- **Storage extras:** the app itself is ~200 MB; the optional full Piper HD voice set adds up to ~3 GB
  (voices are fetched on demand, not bundled).
- MSFS itself wants ~16 GB RAM, so the RAM figures above are *total* (sim + model).

## Install & run

1. Download the latest **`Air-Traffic-Control-Setup-*.exe`** from the
   [Releases](https://github.com/Vihaan2012-cmyk/AI-ATC/releases) page and run it.
2. On first launch, the **install wizard** checks for Ollama, pulls the AI model, and writes your config.
3. Launch a flight in MSFS, then start the app and call ATC.

> **Unsigned app — SmartScreen warning is expected.** The installer isn't code-signed (a signing
> certificate costs money), so Windows will show *"Windows protected your PC."* Click **More info →
> Run anyway**. This is normal for open-source apps; the source is right here if you'd rather build it
> yourself. **First launch needs internet** to download the AI model via Ollama (~2 GB for the custom
> `atc-nlu`, or ~9 GB for `qwen2.5:14b`); after that it runs fully offline.

Start with `"Delivery, <callsign>, request IFR clearance to <dest>, information Alpha."`, read back the
clearance (include the squawk), then talk to each controller as you're handed off. The app tracks state,
validates readbacks, and uses your sim's real frequencies and runways.

## Flight dashboard

A local, career-style **flight dashboard** is served by the brain at
**`http://localhost:8742/dashboard`** (also opens from **Setup → Open flight dashboard**). It shows:

- a **3D globe** with your flown routes as arcs (one line per city-pair; thicker = more flights) and
  glowing airport pins,
- **stat cards** — total flights, airports visited, average readback accuracy, emergencies,
- **top routes** and a **flight log**, and
- a **full SimBrief OFP** per flight — click *View full OFP* to read the raw briefing (route, navlog,
  fuel/weights, procedures, weather) plus the radio transcript.

It's 100% local — no accounts, no cloud. Data comes from your own logbook (`%APPDATA%\Air Traffic
Control\logbook.json`); save a flight from the app to add it.

## Custom ATC model (optional, faster)

Because the deterministic engine owns all the facts, the LLM only has one narrow job (turn pilot
text → intent). You can **fine-tune a small model for just that**, getting a result that's *more
accurate on messy phrasing and several times faster* than the 14B — which matters since the model
runs on CPU while MSFS uses the GPU.

A reference 1.5B fine-tune hits **~97% on novel input at ~3× the speed of qwen2.5:14b**. Two ways
to use it:

**Just pull the pre-built one** (no training, ~2 GB download):

```powershell
ollama pull myaimodels/atc-nlu
```
Then set `OLLAMA_MODEL=myaimodels/atc-nlu` in `.env` (or Setup → AI model).

**Or train your own** — the [`training/`](training/) folder has the whole pipeline (synthetic data →
QLoRA → Ollama). See [training/README.md](training/README.md). Once built:
`ollama create atc-nlu -f training/Modelfile`, then set `OLLAMA_MODEL=atc-nlu`.

## Building from source

```powershell
npm install
npm run server          # the brain (SimConnect + AI + comms; serves the widget + dashboard)
cd app && npm start     # the desktop app
```

Package an installer with `cd app && npm run dist` (requires an elevated shell on Windows).

## License

MIT — see [LICENSE](LICENSE). Fan project; not affiliated with Microsoft, Asobo, Navigraph, SimBrief, or
Beyond ATC. No proprietary data is redistributed — navdata comes live from each user's own sim, and `.env`,
`navdata/`, and `cache/` are gitignored.
