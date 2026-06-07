# AI ATC — v0.3.0

Local **text + voice AI air traffic control** for Microsoft Flight Simulator 2020/2024, in the spirit
of Beyond ATC. Everything runs on your machine — no cloud, no subscription.

It's an **ATC controller, not a chatbot**: a deterministic engine owns all the facts (frequencies,
runways, procedures, sequencing, and now *live traffic*), and a small local AI only turns what you say
into the closest valid pilot request.

### New in 0.3.0

- **Free-flow conversational ATC** — say a natural, compound request in one transmission and the
  controller answers each part, in order, with correct phraseology:
  > *"Center, deviate two zero left for weather, then direct DUMBA, and climb to one zero thousand."*
  Handles deviations, direct-to, holds, climb/descend, higher/lower, and speed — including spoken
  numbers ("flight level two four zero", "two five zero knots") and glued forms ("FL240").
- **Living traffic** — the controller now sees the **real AI/multiplayer aircraft your sim is
  rendering** and works them into the radio picture (no fabricated traffic):
  - Proactive **traffic advisories** when an aircraft is close and near your altitude —
    *"traffic, three o'clock, nine miles, two thousand feet above."*
  - Ask **"say traffic"** anytime for the current picture.
  - A **TRAFFIC** chip on the HUD strip shows the count and nearest range (and warns inside 5 nm).
- **Cleaner install** — the app installs as **`Air Traffic Control.exe`** and reliably shows up when
  you press the **Windows key** and type "Air Traffic Control" (proper Start Menu + desktop entry).

### Recently (0.2.x)
- Custom ATC model (`myaimodels/atc-nlu`), 3D-globe flight dashboard, approach vectoring + readback
  compliance, reactive ATC, VFR/pattern/emergencies/holds, real taxi routing, frequency awareness,
  auto-tune COM, Hoppie CPDLC, Piper HD voices, push-to-talk, logbook.
- Fixed the install-wizard loop and an MSFS-connect crash.

## Install

1. Download **`Air-Traffic-Control-Setup-0.3.0.exe`** below and run it.
2. The first-run **wizard** installs/finds [Ollama](https://ollama.com), pulls the AI model, and writes
   your config.
3. Start a flight in MSFS, launch the app, and call ATC.

> **Windows SmartScreen will warn** — the app isn't code-signed. Click **More info → Run anyway**.
> Normal for open-source; the full source is in this repo.
>
> **First launch needs internet** to pull the AI model via Ollama (~2 GB for the default `atc-nlu`).
> After that it runs fully offline.

## Using SimBrief flight plans

The app can pull your latest SimBrief OFP automatically (route, cruise, runways, weights, the full
briefing on the dashboard). To connect it:

1. Open the app's **Settings** (gear), find **SimBrief username**, and enter your SimBrief account
   username — *or* your numeric **SimBrief Pilot ID** (used first if both are set). Save.
2. On [simbrief.com](https://www.simbrief.com), **generate/dispatch a flight** as usual.
3. Launch (or restart) the app — it fetches your **most recent** OFP for that username and uses it as
   the active flight plan. The raw OFP is viewable per-flight on the dashboard
   (`localhost:8742/dashboard`).

> Find your username/ID on SimBrief under **Account → Settings** (the username) or the **Pilot ID**
> shown on your account page. With neither set, the app uses a built-in sample flight (KSEA→KPDX) so it
> still runs offline.

## Known limitations / honest notes

- **Windows only** (SimConnect is Windows-only). **Unsigned** — expect the SmartScreen prompt above.
- **Living traffic** reflects whatever AI/MP aircraft your sim is actually rendering — if you fly with
  AI traffic off, you'll (correctly) hear "no reported traffic."
- **SID/STAR/airways** use SimConnect + heuristics, not a full procedure database (Navigraph data is
  personal-use-licensed and intentionally not redistributed — the app reads your own sim's navdata).
- This is a **fan project**, not affiliated with Microsoft, Asobo, Navigraph, SimBrief, or Beyond ATC.

MIT licensed. Feedback and issues welcome.
