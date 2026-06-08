# AI ATC for MSFS — v1.1.0

A feature release on top of v1.0. New modules were built for 21 requested features; the ones below
are **wired into the live app**. The rest ship as ready modules that need live-sim/hardware testing
before they're switched on (listed at the bottom, honestly).

## New & live

### ATC
- **Difficulty presets** — one Casual → Standard → Realistic setting that bundles readback strictness,
  deep-realism extras, and coaching hints. Set in **Setup → Realism**; an explicit strictness/deep-realism
  override still wins. (Restart the brain to apply.)
- **Co-pilot readback assist** — ask "read it back for me" and ATC gives the textbook-correct readback
  of the last clearance (a learning aid).
- **CTAF / uncontrolled-field self-announce** — pattern self-announce calls when there's no tower.
- **Oceanic / non-radar** — position reports and "report next fix" handling.
- **Scenario challenge library** — a catalog of tricky situations (low-vis, busy hub, emergencies)
  served at `/api/challenges`.
- **Expanded achievements** — streaks, perfect-readback runs, airport bingo, night/IFR/emergency
  badges, merged into the dashboard's achievements.

### UI / desktop
- **METAR HUD chip** — wind / altimeter / visibility on the HUD strip (`/api/metar`).
- **Handoff cue** — a short chime + "you're now with Approach" banner on every controller change.
- **Voice input (push-to-talk speech-to-text)** — speak to ATC instead of typing
  (`Ctrl+Shift+Space`). Uses the browser Web Speech API, with a local whisper.cpp server path.
- **Multi-monitor** — tear off the COMMS or MAP view into its own always-on-top window for a
  second screen.

## Built, not yet switched on (need in-sim/hardware testing)

These modules are complete and compile, but are **not auto-enabled** because they depend on live
SimConnect data, runway geometry plumbing, the LLM-confidence path, or hardware I can't verify
headlessly. They'll be enabled in a follow-up once tested in the sim:

- Live traffic chatter (ATC ↔ AI aircraft) · frequency gating (must be on the right COM) ·
  tunable ATIS audio · vectors-to-final geometry · runway-incursion warnings · phraseology hints ·
  richer VFR flight-following · stepped-on transmissions · regional voice casting ·
  shareable "ATC tape" export · enhanced CPDLC datalink panel.

## Notes
- Everything from v1.0 still applies (local, no-cloud; run MSFS Windowed/Borderless for the overlay).
- The in-sim panel now bundles the new widget add-on modules so they load in CoherentGT.
