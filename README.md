# MSFS AI ATC

Text-based AI air traffic control for Microsoft Flight Simulator 2020/2024, in the spirit of Beyond ATC.
You type to ATC in an in-sim toolbar widget; a **local** AI (Qwen via Ollama, or any local model) replies with
realistic ATC across a full gate-to-gate flight. Everything runs on your machine — no cloud.

## Design in one line

> A **deterministic ATC engine** owns the facts — frequencies, runways, sequencing, handoffs.
> The **LLM is only the language layer** (pilot free-text → intent, decision → phraseology).
> This keeps ATC correct and fast; routine calls never touch the LLM.

## What works

- **Full controller chain**, gate to gate: Clearance Delivery → Ground → Tower → Departure → Center →
  Approach → Tower (landing) → Ground (taxi-in), with automatic handoffs and frequency changes.
- **Real navdata from your sim** via SimConnect facilities (frequencies + runways), with a **disk cache**
  so it works offline once visited. Configurable fallback chain (`sim` / `dfd` / `mock`).
- **SimBrief** flight plans (by username), with aircraft-type reconciliation vs. the loaded aircraft.
- **Local AI, your choice**: Ollama, or any OpenAI-compatible local server (LM Studio, llama.cpp, Jan,
  KoboldCpp, vLLM, GPT4All…).
- **Setup GUI**, **CLI**, and a **WebSocket server** that the in-sim widget connects to.
- Live **flight-phase tracker** from sim state.

Still TODO (needs the MSFS SDK): packaging the widget as an actual toolbar panel + confirming panel
networking — see [widget/README.md](widget/README.md).

## Prerequisites

- **Windows** + **MSFS 2020/2024** (SimConnect is Windows-only)
- **Node ≥ 22** (`node -v`)
- **A local AI**: [Ollama](https://ollama.com) + `ollama pull qwen2.5:14b`, OR any OpenAI-compatible server
- Optional: a **SimBrief** username; the **MSFS SDK** (only for building the toolbar panel)

## Quick start

```powershell
npm install
npm run setup        # GUI wizard at localhost:8799 -> writes .env (AI, SimBrief, navdata)
npm run server       # brain + WebSocket comms; open widget/atc-widget.html in a browser to chat
```

Or drive it from the terminal:

```powershell
npm run brain        # interactive CLI; type your calls to ATC
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run setup` | GUI config wizard (writes `.env`) |
| `npm run server` | Brain + WebSocket comms for the widget |
| `npm run brain` | Interactive CLI ATC |
| `npm run demo` | Offline scripted gate-to-gate flight (no sim/LLM needed) |
| `npm run spike:ollama` | Test the LLM: reachable? tok/s? JSON intent |
| `npm run spike:simconnect` | Read live sim state |
| `npm run spike:facilities [ICAO]` | Pull real freqs/runways from the sim |
| `npm run phase-monitor` | Live flight-phase readout |
| `npm run comms-test` | Exercise the WebSocket protocol |
| `npm run typecheck` | TypeScript check |

## How a flight goes

Start with `"Delivery, <callsign>, request IFR clearance to <dest>, information Alpha."`, read back the
clearance (include the squawk), then talk to each controller as you're handed off. The engine tracks state,
validates readbacks, and uses your sim's real frequencies and runways.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and [widget/README.md](widget/README.md) for
the in-sim panel.

## Open source

Designed so **no proprietary data is redistributed** — navdata comes live from each user's own sim. Keep
`.env`, `navdata/`, and `cache/` out of git (already gitignored). A `LICENSE` is intentionally not chosen
yet — pick one (MIT / Apache-2.0 / GPL) before publishing. Fan project; not affiliated with Microsoft,
Asobo, Navigraph, SimBrief, or Beyond ATC.
