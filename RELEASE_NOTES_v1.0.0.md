# AI ATC for MSFS — v1.0.0

First stable release. Local, no-cloud AI air traffic control for MSFS 2020/2024: a deterministic
ATC engine that owns the facts, with a local LLM (via Ollama) handling language only. Text + voice.

## Additions

### Core ATC
- **Full gate-to-gate controller stack** — Clearance Delivery → Ground → Tower → Departure → Center →
  Approach → Tower → Ground, with monitor-vs-contact handoffs and handoff phrasing.
- **Free-flow conversational ATC** — natural back-and-forth, compound/multi-intent requests in one call.
- **Proactive ATC** — the controller initiates from live state instead of only reacting.
- **Persistent flight state** — resume a session across app/brain restarts.
- **Auto-squawk on clearance** + real SID/STAR pulled from the OFP.

### ATC procedures
- **Diversions** (pilot- and ATC-initiated) with nearest-airport routing.
- **Approaches** — go-around / missed approach, visual approach, circle-to-land, sidestep,
  conditional takeoff/landing clearances.
- **Enroute** — reroutes, pop-up VFR-to-IFR, holds with EFC times, crossing restrictions,
  pilot's-discretion, "unable" handling, top-of-descent prompt (3:1 rule).
- **Departure release-window** composer (void times).
- **Runway change** driven by wind; **wake-turbulence spacing** + smart runway-by-wind.
- **Special VFR**, **formation flight** (flight-of-two), **LAHSO**, **progressive taxi**.
- **VFR pattern sequencing** with deterministic position assignment.
- **"Expect" clearances + amendments**; **handback** ("remain this frequency").
- **Emergency scenarios** — engine, medical, depressurization, fuel, fire, control issues.

### Realism & language
- **Controller personality + regional phraseology** (template-driven); US / UK / Euro accent variants.
- **Deep-realism toggle** (off by default); workload-driven controller tone.
- **Pilot-deviation (Brasher) calls** on repeated altitude busts; explicit "readback correct".
- **Multi-intent splitting**, **pilot shorthand expansion**, context-aware **"say again"**.
- **Confidence-driven reprompt** when NLU confidence is low.
- **Phonetic-alphabet + ATC number tolerance** (niner/tree/fife, robust readbacks).
- **Stuck-mic / blocked-transmission** sim; **distance-based radio quality / readability**.

### Weather, traffic & nav data
- **Living traffic** — reads sim AI/MP aircraft for traffic-aware ATC + UI readout, with granular toggles.
- **Frequency congestion** ("stand by") and **separation** logic.
- **Winds-aloft** cruise-altitude suggestion; **TAF** trend forecasting (aviationweather.gov).
- **NOTAM / runway-closure** sim and **time-of-day ATIS** with loop playback.
- **Frequency reference card**; **nearest-airport** helper for diversions / flight-following.
- Frequencies + runways pulled live from the sim (SimConnect Facilities API).

### Flight School
- **In-app ATC trainer** — lessons, drills, a phrasebook, and "decode-it" exercises to learn the radio.

### UI, voice & dashboard
- **Game overlay** with global hotkeys (see Overlay below).
- **In-sim MSFS 2020/2024 toolbar panel** (Community package, mirrors all tabs).
- **COM1 active/standby radio panel** with swap; **flight progress strip**; **pinned clearance banner**;
  **clearance HUD strip** (alt/hdg/spd/squawk/next/expecting); compact + high-contrast modes.
- **Global push-to-talk** + TX indicator + audio ducking; say-again replay, subtle radio clicks,
  ambience toggle; **TTS off by default** (opt-in in Settings).
- **Live local dashboard** (career-site style) — raw SimBrief OFP, airport diagram (all runways),
  transcript replay viewer (play/pause/step/scrub), shareable flight report card (`/api/report`).
- **Per-aircraft profile memory** + **flight-track recording** for post-flight replay.
- **Ground services panel** (EFB redesign, auto-detected exits).

### Setup, distribution & model
- **Install wizard** — auto-installs prerequisites and pulls the ATC model; uninstaller can optionally
  remove user data + the Ollama model.
- **In-app "Restart brain"**, settings search, theme presets, **settings export/import** backup.
- **Custom ATC model** training pipeline (distill + QLoRA) with VRAM-budget controls and eval/early-stopping.
- Windows installer (electron-builder / NSIS), per-user, GitHub auto-update feed.

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
