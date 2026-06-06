# Architecture

## Goals

- Realistic, full-stack text ATC: Clearance Delivery -> Ground -> Tower -> Departure -> Center -> Approach -> Tower.
- Pilot types free text; system infers what's actually needed from the **transmission + live sim state**.
- 100% local: Qwen2.5-14B via Ollama on CPU. No cloud.
- In-sim UX: a toolbar widget in MSFS 2024.

## Non-negotiable design principle: hybrid, engine-authoritative

LLMs hallucinate frequencies, runways, and procedures. ATC cannot. So:

| Concern | Owner |
|---|---|
| Frequencies, runways, SIDs/STARs/approaches, airways, airspace | **Engine** (from navdata + flight plan) |
| Who controls you now, handoff timing, what clearance is valid | **Engine** (state machine) |
| Understanding messy pilot text -> structured intent | **LLM (NLU)** |
| Wording the controller's decision as natural phraseology | **LLM (NLG)**, or a template when routine |
| Readback correctness checking | **Engine** (compare readback intent vs. issued clearance) |

Routine, high-frequency exchanges ("readback correct", frequency changes) are **template-only** = instant.
The LLM is reserved for ambiguous parsing and natural phrasing.

## Components

```
+-----------------------------+        +--------------------------------------------------+
|  MSFS 2024 Toolbar Widget   |  text  |  THE BRAIN  (Node.js + TypeScript process)        |
|  (HTML / CSS / TS, Coherent)|<------>|                                                   |
|  - chat transcript          |  WS or |  comms server (WebSocket)                         |
|  - text input + send        | SimC.  |  sim client (node-simconnect): pos/alt/hdg/spd/   |
|  - active frequency display  | bridge |     on-ground / COM / active flight plan          |
|  (pure UI; no logic)        |        |  flight-phase tracker (parked..taxi..cruise..)    |
+-----------------------------+        |  ATC ENGINE (deterministic):                      |
                                       |     positions + handoffs + clearance rules        |
                                       |     world data: Navigraph DFD (SQLite)            |
                                       |  LLM layer (Ollama / Qwen2.5-14B):                |
                                       |     NLU pilot-text -> intent(JSON)                |
                                       |     NLG decision -> phraseology                   |
                                       +--------------------------------------------------+
```

- **Brain owns the SimConnect connection** = single source of truth for sim state. The widget is pure UI.
- **Procedures**: prefer the pilot's *loaded flight plan* (the sim already resolved the SID/STAR/approach
  from its own navdata); use the Navigraph DFD for everything else (frequencies, runways, alternates,
  airspace/FIR boundaries for Center/Approach handoffs, and validating/clearing procedures).

## The one real unknown: widget <-> brain comms

The MSFS panel runs in the Coherent GT sandbox. Whether it can open a `localhost` WebSocket is **the question
that decides the deployment shape**. Two paths:

- **Path A (simple):** panel networking works -> widget connects directly to the brain's WS server. Done.
- **Path B (robust):** panel networking is blocked -> bridge text through a small WASM gauge using a
  SimConnect **Client Data Area**. More work, but bulletproof.

Phase 0a is a throwaway panel that tries to reach `localhost` and reports the result. Everything else is built
to be agnostic to which path wins (the brain exposes the same message protocol either way).

## Message protocol (widget <-> brain), draft

```jsonc
// widget -> brain
{ "type": "pilot_tx", "text": "Ground, N512SR, request taxi", "ts": 1234567890 }

// brain -> widget
{ "type": "atc_tx", "from": "KSEA Ground", "freq": "121.700", "text": "N512SR, taxi to runway 16R via A, B.", "ts": ... }
{ "type": "state",  "activeController": "GROUND", "expecting": "readback", "freq": "121.700" }
```

## Phased plan (full stack is the goal; this is the order to get there safely)

- **Phase 0 - Spikes (de-risk, parallelizable)**
  - 0a. Toolbar panel can reach `localhost`? -> picks Path A vs B.
  - 0b. `node-simconnect`: read pos/alt/hdg/on-ground/COM + active flight plan. (`npm run spike:simconnect`)
  - 0c. Ollama/Qwen: reachable, tok/s on this CPU, reliable JSON intent. (`npm run spike:ollama`)
  - 0d. Navigraph DFD: open SQLite, query an airport's freqs/runways/procedures. (`npm run spike:navdata`)

- **Phase 1 - Standalone brain MVP (no sim UI)**
  - Navdata loader (Navigraph DFD) + airport/frequency/runway lookup.
  - Flight-phase tracker (from sim or mock).
  - One position end-to-end: **Clearance Delivery**. pilot text -> NLU -> engine -> NLG/template -> console.
  - A CLI/test harness so the whole loop is testable without the sim.

- **Phase 2 - Widget integration**
  - Build the toolbar panel UI; wire to the brain over the Phase-0a-chosen path.
  - First in-sim text exchange.

- **Phase 3 - Full controller stack**
  - Ground, Tower, Departure, Center, Approach with handoffs + frequency changes.
  - Phase-driven transitions; procedure awareness from the loaded flight plan.

- **Phase 4 - Realism polish**
  - Readback validation + "say again", per-flight controller memory, consistent phraseology,
    multiple airports, optional AI traffic awareness.

## Open questions / risks

- Panel networking (Phase 0a) — drives Path A vs B.
- Exact Navigraph DFD table/column names vary by export; the navdata loader will be written defensively.
- Qwen JSON reliability for NLU under messy input — mitigated with `format`-constrained output + validation +
  a deterministic fallback parser for common phrases.
- Phraseology consistency — may pin a system prompt + few-shot examples per position.
