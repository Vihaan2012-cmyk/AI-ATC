# AI ATC — v0.2.5

Local **text + voice AI air traffic control** for Microsoft Flight Simulator 2020/2024, in the spirit
of Beyond ATC. Everything runs on your machine — no cloud, no subscription.

It's an **ATC controller, not a chatbot**: a deterministic engine owns all the facts (frequencies,
runways, procedures, sequencing), and a small local AI only turns what you say into the closest valid
pilot request.

### New in 0.2.5

- **Free-flow conversational ATC** — say a natural, compound request in one transmission and the
  controller answers each part, in order, with correct phraseology:
  > *"Center, deviate two zero left for weather, then direct DUMBA, and climb to one zero thousand."*
  Handles deviations, direct-to, holds, climb/descend, higher/lower, and speed — including spoken
  numbers ("flight level two four zero", "two five zero knots") and glued forms ("FL240").
- **Live flight HUD** — the clearance strip is now always visible and shows live **ALT / HDG / SPD**
  straight from the sim, alongside your assigned squawk, next frequency, and what ATC is expecting.
- **Living traffic (experimental, opt-in)** — the controller can read the **real AI/multiplayer
  aircraft your sim is rendering** and call them out (*"traffic, three o'clock, nine miles, two
  thousand feet above"*), with a **"say traffic"** query and a HUD **TRAFFIC** chip. It's **off by
  default** (set `LIVE_TRAFFIC=1` to enable) while it's hardened across different setups.
- **Cleaner install** — the app installs as **`Air Traffic Control.exe`** and reliably shows up when
  you press the **Windows key** and type "Air Traffic Control" (proper Start Menu + desktop entry).
- **Voice is now opt-in** — ATC is text-only on first launch; enable TTS in **SETUP → Appearance**.

### Fixed in 0.2.5
- **MSFS no longer crashes on connect.** Reading nearby AI traffic could destabilize the sim; the
  traffic read is now numeric-only and disabled by default.
- **No more harsh radio "beep."** Removed the squelch tone and radio-band filter — ATC voices play
  clean. Also fixed a bug where traffic advisories repeated every second instead of obeying their
  cooldown.
- **SimConnect auto-reconnects.** The app now keeps trying to connect until MSFS is in a flight, and
  recovers after a flight reload — no need to restart the app to get live data.
- **SimBrief username / Pilot ID now save automatically.** Previously you had to click the
  "Save connection & AI" button, which was easy to miss — entering your ID and closing the window lost
  it. Connection settings now persist the moment you click away from the field.

### Recently (0.2.x)
- Custom ATC model (`myaimodels/atc-nlu`), 3D-globe flight dashboard, approach vectoring + readback
  compliance, reactive ATC, VFR/pattern/emergencies/holds, real taxi routing, frequency awareness,
  auto-tune COM, Hoppie CPDLC, Piper HD voices, push-to-talk, logbook.
- Fixed the install-wizard loop and an MSFS-connect crash.

## Install

1. Download **`Air-Traffic-Control-Setup-0.2.5.exe`** below and run it.
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

1. Open the **SETUP** tab, find **SimBrief username**, and enter your SimBrief account username — *or*
   your numeric **SimBrief Pilot ID** (used first if both are set). It saves automatically when you
   click away from the field (you'll see "Saved ✓").
2. On [simbrief.com](https://www.simbrief.com), **generate/dispatch a flight** as usual.
3. Launch (or restart) the app — it fetches your **most recent** OFP for that username and uses it as
   the active flight plan. The raw OFP is viewable per-flight on the dashboard
   (`localhost:8742/dashboard`).

> Find your username/ID on SimBrief under **Account → Settings** (the username) or the **Pilot ID**
> shown on your account page. With neither set, the app uses a built-in sample flight (KSEA→KPDX) so it
> still runs offline.

## Known limitations / honest notes

- **Windows only** (SimConnect is Windows-only). **Unsigned** — expect the SmartScreen prompt above.
- **Living traffic is experimental and off by default** (enable with `LIVE_TRAFFIC=1`). When on, it
  reflects whatever AI/MP aircraft your sim is actually rendering.
- **SID/STAR/airways** use SimConnect + heuristics, not a full procedure database (Navigraph data is
  personal-use-licensed and intentionally not redistributed — the app reads your own sim's navdata).
- This is a **fan project**, not affiliated with Microsoft, Asobo, Navigraph, SimBrief, or Beyond ATC.

MIT licensed. Feedback and issues welcome.
