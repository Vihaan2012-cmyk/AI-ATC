// Scenario library: pre-built tricky situations as playable challenges.
//
// This is a richer cousin of scenarios.ts. Where a Scenario is a one-line training prompt,
// a Challenge is a fully specified, deterministic situation: a frozen environment (airport,
// weather, traffic, aircraft state), explicit, machine-checkable success criteria, and a
// SCRIPTED controller — an ordered list of steps that decide what ATC says next based purely
// on the pilot's transmission and how far through the script we are.
//
// Pure & deterministic: no I/O, no Date, no Math.random. Every function is a pure function of
// its inputs. The deterministic engine owns ALL facts here; the LLM only ever rewords output.
//
// Pattern (matches the repo): an `isChallengeRequest` detector + `composeChallengeBriefing`
// composer, plus a frozen `CHALLENGES` catalog and small pure helpers used by the server.

import type { ControllerKind, FlightRules } from '../types.js';
import { spokenDigits, spokenRunway } from '../util/phraseology.js';

/** Difficulty band, for the picker's sort/filter and the briefing. */
export type ChallengeDifficulty = 'easy' | 'moderate' | 'hard' | 'extreme';

/** The kind of complication a challenge centers on (drives the picker icon + filtering). */
export type ChallengeCategory =
  | 'low_visibility'
  | 'sequencing'
  | 'emergency'
  | 'engine_failure'
  | 'weather'
  | 'terrain'
  | 'wind'
  | 'systems';

/** Frozen weather for the challenge (no live METAR fetch — the challenge IS the conditions). */
export interface ChallengeWeather {
  /** A canned METAR-style string for display + ATIS. */
  metar: string;
  /** Reported visibility, statute miles. Use 0 for "below 600 RVR / CAT III only". */
  visibilitySm: number;
  /** Ceiling AGL in feet (broken/overcast layer base). 0 == indefinite/obscured. */
  ceilingFt: number;
  /** Surface wind, degrees true. */
  windDir: number;
  /** Surface wind speed, knots. */
  windKt: number;
  /** Gust, knots (>= windKt). 0 == no gust reported. */
  gustKt: number;
  /** Altimeter, inHg. */
  altimeterInHg: number;
}

/** A scripted piece of nearby traffic, for sequencing/conflict challenges. */
export interface ChallengeTraffic {
  callsign: string;
  /** Where they are relative to the player, plain language for the briefing. */
  position: string;
  /** What they're doing, e.g. "on a 4-mile final", "holding short 16L". */
  activity: string;
}

/** The aircraft's starting state for the challenge. */
export interface ChallengeAircraftState {
  /** Aircraft ICAO type, e.g. "B738", "C172". */
  aircraft: string;
  /** Filed/used callsign, e.g. "SWA1234". */
  callsign: string;
  /** Where the flight begins: which controller you first talk to. */
  startController: ControllerKind;
  /** Altitude AGL at start (0 == on the ground). */
  startAltitudeFt: number;
  /** Plain-language note about config/fuel/systems, shown in the briefing. */
  note: string;
  flightRules: FlightRules;
}

/** One machine-checkable success criterion. */
export interface SuccessCriterion {
  /** Stable id, e.g. "declare-emergency". */
  id: string;
  /** Human-readable goal, e.g. "Declare an emergency to ATC." */
  label: string;
  /**
   * Lowercased keyword groups the pilot's combined transcript must satisfy.
   * The criterion is met when, for EVERY inner group, at least ONE keyword appears
   * somewhere in the transcript. (AND across groups, OR within a group.)
   */
  requireAll: string[][];
}

/** One step of the scripted controller. Steps advance in order as the pilot completes them. */
export interface ScriptStep {
  /** Which controller is speaking this step. */
  controller: ControllerKind;
  /**
   * Keyword groups that ADVANCE the script to this step's reply. Same AND-of-ORs semantics
   * as SuccessCriterion.requireAll. An empty array means "any transmission advances it"
   * (used for the opening step / unconditional follow-ups).
   */
  trigger: string[][];
  /** Exactly what ATC says when this step fires (facts only — engine-owned). */
  reply: string;
  /** Does the pilot owe a readback after this reply? */
  expecting: 'readback' | 'none';
  /** Optional handoff to a new controller AFTER this step (mirrors Reply.handoff). */
  handoff?: ControllerKind;
}

export interface Challenge {
  /** Unique id, e.g. "catiii-ksfo". */
  id: string;
  /** Short title for the picker. */
  title: string;
  category: ChallengeCategory;
  difficulty: ChallengeDifficulty;
  /** One-paragraph setup the player reads before starting. */
  description: string;
  /** Departure ICAO. */
  origin: string;
  /** Arrival ICAO (may equal origin for pattern/return scenarios). */
  destination: string;
  weather: ChallengeWeather;
  /** Active runway in use for the challenge (display + ATIS), e.g. "28R". */
  activeRunway: string;
  traffic: ChallengeTraffic[];
  aircraft: ChallengeAircraftState;
  /** Ordered scripted controller behavior. */
  script: ScriptStep[];
  /** All criteria must be met to "pass" the challenge. */
  success: SuccessCriterion[];
  /** One-line coaching tip surfaced on completion. */
  tip: string;
}

/** Lowercase a transmission once, for matching. */
function norm(text: string): string {
  return text.toLowerCase();
}

/**
 * AND-of-ORs keyword match: every group must have at least one keyword present in `haystack`.
 * An empty `groups` array trivially matches (used for unconditional script steps).
 */
function matchesGroups(haystack: string, groups: string[][]): boolean {
  for (const group of groups) {
    if (group.length === 0) continue;
    let any = false;
    for (const kw of group) {
      if (haystack.includes(kw)) { any = true; break; }
    }
    if (!any) return false;
  }
  return true;
}

/**
 * Detect whether the pilot/user text is asking to start or pick a challenge.
 * Mirrors the repo's isXRequest detector convention.
 */
export function isChallengeRequest(text: string): boolean {
  return /\bchallenge(s)?\b|\bscenario library\b|\bplay (a )?(challenge|scenario)\b|\bstart (a )?challenge\b/i.test(
    text,
  );
}

/**
 * Compose a deterministic, player-facing briefing for a challenge: the situation, the
 * frozen weather, the traffic picture, the aircraft state, and the pass criteria.
 * Pure string assembly — safe to feed to the LLM only for tone, never for facts.
 */
export function composeChallengeBriefing(ch: Challenge): string {
  const wx = ch.weather;
  const windLine = wx.windKt === 0
    ? 'calm wind'
    : `wind ${spokenDigits(String(wx.windDir).padStart(3, '0'))} at ${spokenDigits(String(wx.windKt))}`
      + (wx.gustKt > wx.windKt ? ` gusting ${spokenDigits(String(wx.gustKt))}` : '');
  const visLine = wx.visibilitySm <= 0
    ? 'visibility below CAT III minima (RVR critical)'
    : `visibility ${wx.visibilitySm} statute ${wx.visibilitySm === 1 ? 'mile' : 'miles'}`;
  const ceilLine = wx.ceilingFt <= 0 ? 'sky obscured' : `ceiling ${wx.ceilingFt} broken`;

  const trafficLines = ch.traffic.length === 0
    ? ['No conflicting traffic reported.']
    : ch.traffic.map((t) => `  - ${t.callsign}: ${t.position}, ${t.activity}.`);

  const critLines = ch.success.map((c, i) => `  ${i + 1}. ${c.label}`);

  return [
    `CHALLENGE: ${ch.title}  [${ch.difficulty.toUpperCase()} / ${ch.category.replace(/_/g, ' ')}]`,
    ch.description,
    '',
    `Route: ${ch.origin} -> ${ch.destination}   Runway in use: ${ch.activeRunway}`,
    `Aircraft: ${ch.aircraft.aircraft} (${ch.aircraft.callsign}), ${ch.aircraft.flightRules}. ${ch.aircraft.note}`,
    `Weather: ${windLine}, ${visLine}, ${ceilLine}, altimeter ${ch.weather.altimeterInHg.toFixed(2)}.`,
    `METAR: ${ch.weather.metar}`,
    'Traffic:',
    ...trafficLines,
    'To pass:',
    ...critLines,
  ].join('\n');
}

/**
 * Spoken ATIS line for the challenge field, built from its frozen weather + active runway.
 * Deterministic; used to seed the challenge's information broadcast.
 */
export function composeChallengeAtis(ch: Challenge, infoLetter: string): string {
  const wx = ch.weather;
  const wind = wx.windKt === 0
    ? 'wind calm'
    : `wind ${spokenDigits(String(wx.windDir).padStart(3, '0'))} at ${spokenDigits(String(wx.windKt))}`
      + (wx.gustKt > wx.windKt ? ` gusting ${spokenDigits(String(wx.gustKt))}` : '');
  const vis = wx.visibilitySm <= 0 ? 'visibility one quarter mile or less' : `visibility ${spokenDigits(String(wx.visibilitySm))}`;
  const alt = wx.altimeterInHg.toFixed(2).replace('.', '').replace(/^0+/, '');
  return `${ch.destination} information ${infoLetter.toUpperCase()}. ${wind}, ${vis}, `
    + `landing and departing runway ${spokenRunway(ch.activeRunway)}, altimeter ${spokenDigits(alt)}.`;
}

/**
 * The result of advancing a challenge's script by one pilot transmission.
 * `stepIndex` is the index of the step that fired (or the unchanged current index if none did).
 */
export interface ScriptAdvance {
  /** True if a step fired and ATC has something to say. */
  fired: boolean;
  /** The step that fired, if any. */
  step: ScriptStep | null;
  /** The new step pointer to remember for the next call. */
  stepIndex: number;
  /** True once the script pointer has run past the last step (challenge dialog complete). */
  complete: boolean;
}

/**
 * Advance a challenge's scripted controller. Pure: given the challenge, the current step
 * pointer, and the pilot's latest transmission, decide whether the NEXT step fires.
 *
 * A step fires only when its trigger keywords match the transmission (AND-of-ORs). Steps with
 * an empty trigger fire on any transmission. This keeps the controller deterministic and
 * order-driven without any hidden state beyond the integer pointer the caller holds.
 *
 * @param ch         the active challenge
 * @param currentIdx the pointer into ch.script returned from the previous call (start at 0)
 * @param pilotText  the latest pilot transmission
 */
export function advanceChallengeScript(
  ch: Challenge,
  currentIdx: number,
  pilotText: string,
): ScriptAdvance {
  const idx = Number.isFinite(currentIdx) && currentIdx > 0 ? Math.floor(currentIdx) : 0;
  if (idx >= ch.script.length) {
    return { fired: false, step: null, stepIndex: idx, complete: true };
  }
  const next = ch.script[idx];
  if (!next) {
    return { fired: false, step: null, stepIndex: idx, complete: true };
  }
  const hay = norm(pilotText);
  if (matchesGroups(hay, next.trigger)) {
    const newIdx = idx + 1;
    return { fired: true, step: next, stepIndex: newIdx, complete: newIdx >= ch.script.length };
  }
  return { fired: false, step: null, stepIndex: idx, complete: false };
}

/**
 * Evaluate the player's success against a challenge, given the full combined transcript of
 * everything they transmitted (joined with spaces). Pure and deterministic.
 *
 * @returns per-criterion booleans, the count met, and whether ALL criteria passed.
 */
export function evaluateChallenge(
  ch: Challenge,
  combinedTranscript: string,
): { results: Array<{ id: string; label: string; met: boolean }>; met: number; total: number; passed: boolean } {
  const hay = norm(combinedTranscript);
  const results = ch.success.map((c) => ({
    id: c.id,
    label: c.label,
    met: matchesGroups(hay, c.requireAll),
  }));
  const met = results.filter((r) => r.met).length;
  const total = results.length;
  return { results, met, total, passed: total > 0 && met === total };
}

/**
 * The curated challenge catalog. Frozen, deterministic, hand-authored.
 * Each entry is a complete, playable tricky situation.
 */
export const CHALLENGES: Challenge[] = [
  {
    id: 'catiii-ksfo',
    title: 'CAT III Approach in Fog at KSFO',
    category: 'low_visibility',
    difficulty: 'hard',
    description:
      'San Francisco is socked in with dense radiation fog. RVR is at CAT III minima and '
      + 'the approach is autoland only. Fly the ILS to runway 28R, coordinate a low-visibility '
      + 'arrival with Approach and Tower, and roll out under SMGCS procedures.',
    origin: 'KOAK',
    destination: 'KSFO',
    weather: {
      metar: 'KSFO 281256Z 00000KT 1/8SM R28R/0600FT FG VV001 11/11 A3012',
      visibilitySm: 0,
      ceilingFt: 0,
      windDir: 0,
      windKt: 0,
      gustKt: 0,
      altimeterInHg: 30.12,
    },
    activeRunway: '28R',
    traffic: [
      { callsign: 'UAL512', position: '2 miles ahead on the ILS', activity: 'rolling out runway 28R' },
      { callsign: 'AAL88', position: 'holding short 28R', activity: 'awaiting your landing' },
    ],
    aircraft: {
      aircraft: 'B738',
      callsign: 'SWA221',
      startController: 'approach',
      startAltitudeFt: 4000,
      note: 'Autoland armed, CAT III certified, on vectors for the ILS 28R.',
      flightRules: 'IFR',
    },
    script: [
      {
        controller: 'approach',
        trigger: [['approach', 'with you', 'checking in', 'descending']],
        reply:
          'Southwest 221, San Francisco Approach, RVR runway 28R six hundred, CAT three in progress, '
          + 'fly heading 280, maintain 4000 until established, cleared ILS runway 28R.',
        expecting: 'readback',
      },
      {
        controller: 'approach',
        trigger: [['established', 'localizer', 'ils', 'inbound']],
        reply: 'Southwest 221, contact Tower 120.5, monitor only, low visibility ops in effect.',
        expecting: 'none',
        handoff: 'tower',
      },
      {
        controller: 'tower',
        trigger: [['tower', 'with you', 'monitoring', 'short final', 'final']],
        reply: 'Southwest 221, San Francisco Tower, RVR six hundred, runway 28R, cleared to land, wind calm.',
        expecting: 'readback',
      },
      {
        controller: 'tower',
        trigger: [['clear', 'down', 'landed', 'rolling out', 'vacated', 'runway vacated']],
        reply: 'Southwest 221, good landing, turn left when able, contact Ground 121.8 for taxi to the gate, follow the green centerline lights.',
        expecting: 'none',
        handoff: 'ground',
      },
    ],
    success: [
      { id: 'cleared-ils', label: 'Read back the ILS 28R approach clearance.', requireAll: [['cleared', 'ils', 'established'], ['28r', 'two eight right', '28 right']] },
      { id: 'cleared-land', label: 'Acknowledge the landing clearance with the RVR.', requireAll: [['cleared to land', 'cleared land', 'clear to land']] },
      { id: 'report-clear', label: 'Report clear of the runway before requesting taxi.', requireAll: [['clear', 'vacated', 'off the runway']] },
    ],
    tip: 'In CAT III, the autopilot lands. Your job is precise readbacks and reporting clear of the runway so the next arrival can be cleared.',
  },
  {
    id: 'hub-rush-katl',
    title: 'Busy Hub Sequencing at KATL',
    category: 'sequencing',
    difficulty: 'moderate',
    description:
      'Atlanta during the afternoon push. Approach is sequencing a wall of arrivals onto runway 27R. '
      + 'Expect speed assignments, vectors, and a number-in-sequence. Fly it tight, read it back fast, '
      + 'and do not step on the frequency.',
    origin: 'KMCO',
    destination: 'KATL',
    weather: {
      metar: 'KATL 281853Z 25012KT 10SM FEW250 31/14 A2998',
      visibilitySm: 10,
      ceilingFt: 0,
      windDir: 250,
      windKt: 12,
      gustKt: 0,
      altimeterInHg: 29.98,
    },
    activeRunway: '27R',
    traffic: [
      { callsign: 'DAL1450', position: '3 miles ahead', activity: 'number 2 for 27R' },
      { callsign: 'DAL2201', position: 'overtaking from the left', activity: 'fast on the downwind' },
      { callsign: 'AAL995', position: 'behind you', activity: 'number 4, asked to slow' },
    ],
    aircraft: {
      aircraft: 'A320',
      callsign: 'DAL77',
      startController: 'approach',
      startAltitudeFt: 7000,
      note: 'Clean, descending into the arrival flow, fuel comfortable.',
      flightRules: 'IFR',
    },
    script: [
      {
        controller: 'approach',
        trigger: [['approach', 'with you', 'checking in', 'descending']],
        reply: 'Delta 77, Atlanta Approach, reduce speed to 210 knots, descend and maintain 5000, expect runway 27R.',
        expecting: 'readback',
      },
      {
        controller: 'approach',
        trigger: [['210', 'two ten', 'two one zero', 'slowing', 'reducing', '5000', 'five thousand']],
        reply: 'Delta 77, turn left heading 300, reduce 180 knots, you are number 3, traffic to follow is a heavy 767 on a 5-mile final.',
        expecting: 'readback',
      },
      {
        controller: 'approach',
        trigger: [['180', 'one eighty', 'one eight zero', 'heading 300', 'number 3', 'number three']],
        reply: 'Delta 77, 5 miles from CANUK, turn right heading 360, maintain 3000 until established, cleared ILS runway 27R, contact Tower 119.1.',
        expecting: 'readback',
        handoff: 'tower',
      },
      {
        controller: 'tower',
        trigger: [['tower', 'with you', 'final', 'established']],
        reply: 'Delta 77, Atlanta Tower, runway 27R, cleared to land, traffic departing prior to your arrival, caution wake turbulence.',
        expecting: 'readback',
      },
    ],
    success: [
      { id: 'speed-210', label: 'Read back the initial speed reduction to 210 knots.', requireAll: [['210', 'two ten', 'two one zero']] },
      { id: 'speed-180', label: 'Read back the slow to 180 and your sequence number.', requireAll: [['180', 'one eighty', 'one eight zero']] },
      { id: 'cleared-ils', label: 'Read back the ILS 27R approach clearance.', requireAll: [['cleared', 'ils', 'established'], ['27r', 'two seven right', '27 right']] },
      { id: 'cleared-land', label: 'Acknowledge the landing clearance.', requireAll: [['cleared to land', 'cleared land', 'clear to land']] },
    ],
    tip: 'On a busy hub, brevity wins. Read back only the numbers that changed (speed, heading, altitude) plus your callsign — skip the chatter.',
  },
  {
    id: 'engine-fail-dep-klga',
    title: 'Engine Failure on Departure at KLGA',
    category: 'engine_failure',
    difficulty: 'extreme',
    description:
      'Heavy jet, hot day, short runway at LaGuardia. Just after V1 the number 2 engine fails with '
      + 'a loud bang. You are committed to fly. Climb on the remaining engine, declare, and get vectors '
      + 'for an immediate return while you run the checklist.',
    origin: 'KLGA',
    destination: 'KLGA',
    weather: {
      metar: 'KLGA 281751Z 21010KT 10SM SCT040 33/19 A2992',
      visibilitySm: 10,
      ceilingFt: 4000,
      windDir: 210,
      windKt: 10,
      gustKt: 0,
      altimeterInHg: 29.92,
    },
    activeRunway: '13',
    traffic: [
      { callsign: 'JBU1102', position: 'holding short 13', activity: 'waiting on your departure' },
    ],
    aircraft: {
      aircraft: 'B738',
      callsign: 'AAL19',
      startController: 'tower',
      startAltitudeFt: 400,
      note: 'Single-engine, heavy, max takeoff weight, climbing on runway heading.',
      flightRules: 'IFR',
    },
    script: [
      {
        controller: 'tower',
        trigger: [['mayday', 'emergency', 'engine', 'failure', 'declaring']],
        reply: 'American 19, LaGuardia Tower, roger your emergency, climb runway heading, maintain 3000, fly the runway heading, say souls and fuel when able.',
        expecting: 'readback',
      },
      {
        controller: 'tower',
        trigger: [['souls', 'fuel', 'persons', 'pob', 'remaining']],
        reply: 'American 19, roger, contact New York Departure 120.4, they are expecting you, fly heading 040.',
        expecting: 'readback',
        handoff: 'departure',
      },
      {
        controller: 'departure',
        trigger: [['departure', 'with you', 'checking in', '040', 'climbing']],
        reply: 'American 19, New York Departure, radar contact, climb maintain 3000, fly heading 360, vectors for the ILS runway 13, say intentions.',
        expecting: 'readback',
      },
      {
        controller: 'departure',
        trigger: [['return', 'ils', 'land', 'back to', 'vectors', 'request']],
        reply: 'American 19, expect vectors for a 10-mile final runway 13, descend and maintain 2000, equipment is standing by, you are cleared for the approach.',
        expecting: 'readback',
        handoff: 'tower',
      },
    ],
    success: [
      { id: 'declare', label: 'Declare the emergency (mayday or "declaring an emergency").', requireAll: [['mayday', 'emergency', 'declaring']] },
      { id: 'souls-fuel', label: 'Pass souls on board and fuel remaining.', requireAll: [['souls', 'persons', 'pob'], ['fuel', 'pounds', 'minutes', 'hours']] },
      { id: 'climb-3000', label: 'Read back the climb to 3000 and assigned heading.', requireAll: [['3000', 'three thousand']] },
      { id: 'cleared-approach', label: 'Read back the approach clearance for the return.', requireAll: [['cleared', 'approach', 'ils'], ['13', 'one three']] },
    ],
    tip: 'Aviate, navigate, communicate — in that order. Fly the airplane first; ATC will wait. When you do talk, give souls and fuel so rescue can plan.',
  },
  {
    id: 'divert-low-fuel-kbos',
    title: 'Emergency Divert with Low Fuel',
    category: 'emergency',
    difficulty: 'hard',
    description:
      'Your destination Boston has just gone below minimums in a snow squall and you are now '
      + 'minimum fuel. Negotiate a divert to Providence with Center, get priority handling, and set '
      + 'up for the closest approach you can fly.',
    origin: 'KJFK',
    destination: 'KBOS',
    weather: {
      metar: 'KBOS 282054Z 03022G31KT 1/2SM +SN VV004 M02/M04 A2971',
      visibilitySm: 0,
      ceilingFt: 0,
      windDir: 30,
      windKt: 22,
      gustKt: 31,
      altimeterInHg: 29.71,
    },
    activeRunway: '33L',
    traffic: [
      { callsign: 'JBU623', position: 'ahead on the arrival', activity: 'also requesting divert' },
    ],
    aircraft: {
      aircraft: 'E190',
      callsign: 'JBU455',
      startController: 'center',
      startAltitudeFt: 11000,
      note: 'Minimum fuel, holding fuel for one approach and the divert only.',
      flightRules: 'IFR',
    },
    script: [
      {
        controller: 'center',
        trigger: [['minimum fuel', 'low fuel', 'divert', 'unable', 'request', 'mayday', 'fuel emergency']],
        reply: 'JetBlue 455, Boston Center, Boston is below minimums, say intentions, Providence is open and reporting better.',
        expecting: 'readback',
      },
      {
        controller: 'center',
        trigger: [['providence', 'kpvd', 'pvd', 'divert', 'request']],
        reply: 'JetBlue 455, roger, cleared to divert to Providence, descend and maintain 6000, expect the ILS runway 34, do you declare an emergency.',
        expecting: 'readback',
      },
      {
        controller: 'center',
        trigger: [['mayday', 'emergency', 'declaring', 'affirm', 'fuel']],
        reply: 'JetBlue 455, roger your emergency, you are number 1, contact Providence Approach 127.6, they have the equipment standing by.',
        expecting: 'readback',
        handoff: 'approach',
      },
      {
        controller: 'approach',
        trigger: [['approach', 'with you', 'checking in', 'descending']],
        reply: 'JetBlue 455, Providence Approach, radar contact, fly heading 010, maintain 3000 until established, cleared ILS runway 34.',
        expecting: 'readback',
      },
    ],
    success: [
      { id: 'state-intentions', label: 'State your intentions / request the divert to Providence.', requireAll: [['providence', 'pvd', 'divert']] },
      { id: 'declare', label: 'Declare an emergency for the fuel state.', requireAll: [['mayday', 'emergency', 'declaring', 'minimum fuel']] },
      { id: 'cleared-divert', label: 'Read back the divert clearance and descent.', requireAll: [['6000', 'six thousand', 'descend']] },
      { id: 'cleared-ils', label: 'Read back the ILS 34 approach clearance at Providence.', requireAll: [['cleared', 'ils', 'established'], ['34', 'three four']] },
    ],
    tip: '"Minimum fuel" is an advisory; "fuel emergency" / "mayday fuel" demands priority. Be explicit so the controller can move you to the front of the line.',
  },
  {
    id: 'mountain-circle-ktex',
    title: 'Circling Approach in Mountain Terrain at KTEX',
    category: 'terrain',
    difficulty: 'hard',
    description:
      'Telluride sits in a box canyon at 9,000 feet. The straight-in is not authorized today, so you '
      + 'must fly the VOR/DME and circle to land opposite the active in deteriorating mountain weather. '
      + 'Terrain awareness and a clean circling maneuver are everything.',
    origin: 'KDEN',
    destination: 'KTEX',
    weather: {
      metar: 'KTEX 281635Z 27015G22KT 4SM -SHSN BKN035 M05/M09 A3025',
      visibilitySm: 4,
      ceilingFt: 3500,
      windDir: 270,
      windKt: 15,
      gustKt: 22,
      altimeterInHg: 30.25,
    },
    activeRunway: '09',
    traffic: [],
    aircraft: {
      aircraft: 'C208',
      callsign: 'N512TX',
      startController: 'approach',
      startAltitudeFt: 13000,
      note: 'High-density-altitude airport, circling minima only, terrain on all quadrants.',
      flightRules: 'IFR',
    },
    script: [
      {
        controller: 'approach',
        trigger: [['approach', 'with you', 'checking in', 'inbound']],
        reply: 'November 512TX, Denver Center, cross the VOR at or above 13000, cleared VOR DME-C approach, circling east of the field, report the VOR inbound.',
        expecting: 'readback',
      },
      {
        controller: 'approach',
        trigger: [['vor', 'inbound', 'crossing', 'established', 'circling']],
        reply: 'November 512TX, roger, radar service terminated, change to advisory frequency approved, report cancelling IFR on this frequency or by phone.',
        expecting: 'none',
      },
      {
        controller: 'approach',
        trigger: [['cancel', 'cancelling', 'ifr', 'field in sight', 'runway in sight', 'landing assured']],
        reply: 'November 512TX, IFR cancellation received, no observed traffic, frequency change approved, good day.',
        expecting: 'none',
      },
    ],
    success: [
      { id: 'cleared-vordme', label: 'Read back the VOR/DME-C approach clearance with circling.', requireAll: [['cleared', 'vor', 'approach'], ['circling', 'circle']] },
      { id: 'cross-restriction', label: 'Read back the crossing restriction at the VOR.', requireAll: [['13000', 'one three thousand', 'thirteen thousand'], ['at or above', 'or above', 'cross']] },
      { id: 'cancel-ifr', label: 'Cancel IFR once the field/runway is in sight.', requireAll: [['cancel', 'cancelling'], ['ifr']] },
    ],
    tip: 'In box-canyon terrain, fly the published circling side and altitudes exactly. Cancel IFR only with the field truly in sight — terrain clearance is on you once you do.',
  },
  {
    id: 'crosswind-gusts-keagle',
    title: 'Gusty Crosswind Landing at KEGE',
    category: 'wind',
    difficulty: 'moderate',
    description:
      'Eagle County, a demanding mountain airport, with a strong gusty crosswind near the limits. '
      + 'Tower will offer the wind on short final and may send you around. Manage the approach, brief '
      + 'a possible go-around, and either grease the crosswind or execute a clean missed.',
    origin: 'KDEN',
    destination: 'KEGE',
    weather: {
      metar: 'KEGE 282153Z 16021G29KT 9SM FEW080 18/M01 A3001',
      visibilitySm: 9,
      ceilingFt: 0,
      windDir: 160,
      windKt: 21,
      gustKt: 29,
      altimeterInHg: 30.01,
    },
    activeRunway: '25',
    traffic: [
      { callsign: 'UAL2890', position: 'just went around', activity: 'climbing on the missed for 25' },
    ],
    aircraft: {
      aircraft: 'CRJ7',
      callsign: 'SKW5512',
      startController: 'tower',
      startAltitudeFt: 1500,
      note: 'On final, strong left crosswind gusting near demonstrated limits.',
      flightRules: 'IFR',
    },
    script: [
      {
        controller: 'tower',
        trigger: [['tower', 'with you', 'final', 'checking in']],
        reply: 'Skywest 5512, Eagle Tower, wind 160 at 21 gust 29, runway 25, cleared to land, previous arrival went around.',
        expecting: 'readback',
      },
      {
        controller: 'tower',
        trigger: [['go around', 'going around', 'missed', 'unable']],
        reply: 'Skywest 5512, roger going around, fly runway heading, climb maintain 11000, contact Departure 126.1.',
        expecting: 'readback',
        handoff: 'departure',
      },
      {
        controller: 'tower',
        trigger: [['clear', 'down', 'landed', 'vacated', 'on the ground']],
        reply: 'Skywest 5512, nicely done, turn right when able, contact Ground point niner for taxi to the ramp.',
        expecting: 'none',
        handoff: 'ground',
      },
    ],
    success: [
      { id: 'cleared-land', label: 'Read back the landing clearance with the wind.', requireAll: [['cleared to land', 'cleared land', 'clear to land']] },
      { id: 'resolve', label: 'Either land (report clear) OR go around cleanly.', requireAll: [['clear', 'vacated', 'down', 'go around', 'going around', 'missed']] },
    ],
    tip: 'Decide your go-around gates BEFORE short final. With gusts near the limit, a clean missed approach is a pass, not a failure.',
  },
];

/**
 * Look up a challenge by id. Returns null if not found.
 */
export function getChallenge(id: string): Challenge | null {
  return CHALLENGES.find((c) => c.id === id) ?? null;
}

/** All challenge ids, for a picker dropdown. */
export function listChallengeIds(): string[] {
  return CHALLENGES.map((c) => c.id);
}

/** Total number of challenges in the catalog. */
export function getChallengeCount(): number {
  return CHALLENGES.length;
}

/**
 * A compact, picker-friendly summary of every challenge (no script — that stays server-side
 * until a challenge is started). Safe to serve from GET /api/challenges.
 */
export function challengeCatalog(): Array<{
  id: string;
  title: string;
  category: ChallengeCategory;
  difficulty: ChallengeDifficulty;
  origin: string;
  destination: string;
  aircraft: string;
  activeRunway: string;
  description: string;
  criteria: number;
}> {
  return CHALLENGES.map((c) => ({
    id: c.id,
    title: c.title,
    category: c.category,
    difficulty: c.difficulty,
    origin: c.origin,
    destination: c.destination,
    aircraft: c.aircraft.aircraft,
    activeRunway: c.activeRunway,
    description: c.description,
    criteria: c.success.length,
  }));
}
