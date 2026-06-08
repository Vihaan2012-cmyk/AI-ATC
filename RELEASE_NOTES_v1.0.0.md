# AI ATC for MSFS — v1.0.0

## Additions

### New ATC procedures
- **Diversions** — pilot-initiated and ATC-initiated diversion detection + nearest-airport routing.
- **Runway change** — deterministic runway reassignment driven by wind.
- **Special VFR (SVFR)** — Class D entry authorization.
- **Formation flight** — flight-of-two clearance composer.
- **LAHSO** — land-and-hold-short clearances with pilot accept/refuse detection.
- **Progressive taxi** — step-by-step ground guidance.
- **VFR pattern sequencing** — deterministic traffic-pattern position assignment.
- **"Expect" clearances + amendments** — expect-higher after intermediate climbs, mid-flight amendments.
- **Handback** — controller hands you back to the previous frequency ("remain this frequency").

### Realism & language
- **Deep-realism toggle** (off by default) for extra procedural detail.
- **Regional controller accents** — US / UK / Euro phrasing variants in the phraseology pipeline.
- **Workload-driven controller tone** + performance-tuned top-of-descent.
- **Multi-intent transmissions** — split combined pilot requests in one call.
- **Pilot shorthand expansion** and **context-aware "say again"** for partial repeats.
- **Confidence-driven reprompt** — asks for clarification when NLU confidence is low.
- **Phonetic-alphabet + ATC number tolerance** (niner/tree/fife, robust readback parsing).
- **Stuck-mic / blocked-transmission** simulation and **distance-based radio quality / readability**.

### Weather & navigation data
- **Winds-aloft** cruise-altitude suggestion (`/api/winds`).
- **TAF trend forecasting** (aviationweather.gov).
- **ATIS loop** with recorded-playback metadata.
- **Frequency reference card** in the dashboard.
- **Nearest-airport** helper for diversions and flight-following.

### UI & tooling
- **In-sim MSFS 2020/2024 toolbar panel** (Community package, mirrors all tabs).
- **Airport diagram** in the GROUND tab and dashboard — all runways with labels.
- **Transcript replay viewer** (play / pause / step / scrub) in the dashboard.
- **Per-aircraft profile memory** + **flight-track recording** for post-flight replay.
- **Game overlay** with global hotkeys (see Overlay below).

## Fixes
- **Radio "earrape" removed** — deleted the squelch oscillator + band filter that made the radio
  scream; fixed runaway traffic callouts (cooldown was re-keyed every tick → now keyed per aircraft).
- **SimBrief plan not loading** — the brain read config once at startup before `.env` had the ID;
  it now picks up the SimBrief ID correctly (restart the brain after changing it).
- **SimBrief ID not persisting** — the ID entered in Setup is now saved and reloaded across restarts.
- **MSFS crash on connect (living traffic)** — string fields (ATC ID / airline / title) in the
  traffic request destabilized the sim; traffic is now numeric-only and gated behind explicit toggles.
- **TTS staying on** — voice now respects the off state instead of continuing to speak.
- **HUD strip** — altitude/speed fields now render (blank when no data) instead of being hidden.
- **"one zero thousand" parsed as 1000** — number parser now yields 10000 (bails when two bare
  digit-words appear in a row).
- **Phonetic normalizer too aggressive** — no longer uppercases everything / rewrites "to"→"2";
  narrow normalization only (niner/tree/fife/fower, case preserved).

## In-sim toolbar panel (MSFS 2020/2024)
- **Toolbar button now registers** — the old raw-HTML / `InGamePanelsList.json` approach never
  worked in MSFS 2020; replaced with a real compiled `.spb` Community package built via the SDK.
- **Whole panel shows** — was only displaying the header + tabs; added panel-fit CSS so CoherentGT
  renders the full UI (CoherentGT collapses `position:fixed`, so it's pinned to `100vw/100vh`).
- **Blank toolbar icon fixed** — icon is now a 64×64 SVG in MSFS's `HIGHLIGHT` format so the sim
  recolors and shows it (a plain white/stroked SVG rendered blank).
- **Multi-page panel** — panel mirrors all widget tabs (COMMS/PLAN/GROUND/SCHOOL/SETUP), not just COMMS.
- **Full airport diagram** — GROUND tab draws all runways from `/api/airport`, not a single strip.
- `deploy.ps1` reassembles the Community package from the SDK build output + html_ui.

## Overlay
- The desktop app now works as a game overlay with global hotkeys usable while MSFS is focused:
  - `Ctrl+Shift+A` — show / hide the overlay
  - `Ctrl+Shift+C` — toggle click-through (overlay stays visible, mouse passes to the sim)
  - `Ctrl+Shift+Space` — push-to-talk
- For the overlay to appear over MSFS, run the sim in **Windowed/Borderless** (not exclusive fullscreen).
