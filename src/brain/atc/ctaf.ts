// CTAF / uncontrolled-field self-announce. At a field with no tower, there is NO controller —
// pilots broadcast their own position/intentions in the blind on the Common Traffic Advisory
// Frequency (CTAF/Unicom). This module generates the player's self-announce pattern calls
// (taxiing, departing, downwind, base, final, clear of runway) plus plausible simulated
// other-traffic CTAF calls so the frequency feels alive.
//
// Fully deterministic: every call is a template keyed to airport name + runway (+ a rolling
// counter for the synthetic traffic). No randomness, no Date, no I/O. The LLM is not involved;
// CTAF phraseology is fixed and standardized (AIM 4-1-9). The engine owns all facts.
import { spokenRunway, spokenCallsign, spokenDigits } from '../util/phraseology.js';

/** The pilot pattern legs that warrant a self-announce on CTAF. */
export type CtafLeg =
  | 'taxi'        // taxiing to the active runway
  | 'departing'   // departing the runway (rolling)
  | 'crosswind'   // turning crosswind in the pattern
  | 'downwind'    // entering / on downwind
  | 'base'        // turning base
  | 'final'       // turning final / on final
  | 'clear'       // clear of the runway after landing
  | 'inbound'     // inbound to the field (10 mi out) for landing
  | 'departed';   // departed the area, frequency change

/** A single CTAF transmission: who is speaking and the spoken text. */
export interface CtafCall {
  /** Spoken station/aircraft label, e.g. "November Five One Two Sierra Romeo" or "Cessna 421SP". */
  from: string;
  /** Full spoken CTAF transmission text. */
  text: string;
}

/** Inputs that anchor every CTAF call to a specific field + runway + aircraft. */
export interface CtafContext {
  /** Spoken field name used in calls, e.g. "Sanderson" (from a short airport name). */
  fieldName: string;
  /** Active runway in use, e.g. "16R". When unknown, calls omit the runway gracefully. */
  runway?: string | null;
  /** The player's filed callsign, e.g. "N512SR". */
  callsign: string;
  /** Spoken telephony override if known (otherwise derived from the callsign). */
  telephony?: string;
}

/**
 * Detect whether a pilot transmission is a CTAF self-announce request, i.e. the pilot wants
 * the brain to broadcast a pattern call at an uncontrolled field. Matches "ctaf", "unicom",
 * "traffic advisory", "self announce", "announce <leg>", or a leg keyword alongside "traffic"/
 * "pattern". Deterministic regex; no side effects.
 */
export function isCtafRequest(text: string): boolean {
  const t = text.toLowerCase();
  if (/\bctaf\b|\buni ?com\b|\btraffic advisor/.test(t)) return true;
  if (/\bself[\s-]?announce\b|\bannounce(?:\s+(?:my|the))?\s+(?:position|traffic|pattern|intentions)\b/.test(t)) return true;
  // "announce downwind", "call my final", "broadcast departing", etc.
  if (/\b(?:announce|broadcast|call(?:ing)?|report(?:ing)?)\b/.test(t)
      && /\b(taxi|taxiing|departing|takeoff|crosswind|downwind|base|final|clear of|inbound|departed|pattern)\b/.test(t)) {
    return true;
  }
  return false;
}

/**
 * Map free pilot text to a specific pattern leg, defaulting to 'downwind' when a CTAF request
 * is detected but no leg is named. Deterministic keyword match (most specific first).
 */
export function detectLeg(text: string): CtafLeg {
  const t = text.toLowerCase();
  if (/\bclear(?:ed)? (?:of|the runway)\b|\bclear of\b|\bexit(?:ing|ed)? the runway\b/.test(t)) return 'clear';
  if (/\bfinal\b/.test(t)) return 'final';
  if (/\bbase\b/.test(t)) return 'base';
  if (/\bcross ?wind\b/.test(t)) return 'crosswind';
  if (/\bdown ?wind\b/.test(t)) return 'downwind';
  if (/\binbound\b|\b(?:ten|10)\s*(?:miles?|mi)\b|\bentering the (?:pattern|area)\b/.test(t)) return 'inbound';
  if (/\bdepart(?:ed|ing the area)\b|\bleaving the (?:pattern|area|frequency)\b|\bfrequency change\b/.test(t)) return 'departed';
  if (/\bdepart(?:ing)?\b|\btake ?off\b|\brolling\b/.test(t)) return 'departing';
  if (/\btaxi(?:ing)?\b/.test(t)) return 'taxi';
  return 'downwind';
}

/** Compose the runway phrase ("runway one six right") or empty string when unknown. */
function rwyPhrase(runway?: string | null): string {
  return runway ? `runway ${spokenRunway(runway)}` : '';
}

/**
 * Compose ONE pilot self-announce CTAF call for the given leg.
 *
 * CTAF format is "FIELD traffic, AIRCRAFT, <position/intentions>, FIELD" — the field name is
 * stated first AND last so listeners on a shared CTAF know which airport you mean. Deterministic.
 *
 * Examples (field "Sanderson", runway "16R", N512SR):
 *  - composeSelfAnnounce('taxi', ctx)      => "Sanderson traffic, November Five One Two Sierra Romeo, taxiing to runway one six right, Sanderson."
 *  - composeSelfAnnounce('departing', ctx) => "Sanderson traffic, November Five One Two Sierra Romeo, departing runway one six right, climbing on course, Sanderson."
 *  - composeSelfAnnounce('downwind', ctx)  => "Sanderson traffic, November Five One Two Sierra Romeo, left downwind runway one six right, touch and go, Sanderson."
 *  - composeSelfAnnounce('clear', ctx)     => "Sanderson traffic, November Five One Two Sierra Romeo, clear of runway one six right, Sanderson."
 */
export function composeSelfAnnounce(leg: CtafLeg, ctx: CtafContext): string {
  const field = ctx.fieldName;
  const ac = spokenCallsign(ctx.callsign, ctx.telephony);
  const rwy = rwyPhrase(ctx.runway);
  const onRwy = rwy ? ` ${rwy}` : '';

  let body: string;
  switch (leg) {
    case 'taxi':
      body = `taxiing to${onRwy || ' the active'}`;
      break;
    case 'departing':
      body = rwy ? `departing ${rwy}, climbing on course` : 'departing, climbing on course';
      break;
    case 'crosswind':
      body = `left crosswind${onRwy}`;
      break;
    case 'downwind':
      body = `left downwind${onRwy}, touch and go`;
      break;
    case 'base':
      body = `left base${onRwy}`;
      break;
    case 'final':
      body = rwy ? `final ${rwy}, full stop` : 'final, full stop';
      break;
    case 'clear':
      body = rwy ? `clear of ${rwy}` : 'clear of the active';
      break;
    case 'inbound':
      body = rwy
        ? `one zero miles out, inbound for the ${rwy} pattern`
        : 'one zero miles out, inbound for landing';
      break;
    case 'departed':
      body = 'departing the area to the north, frequency change';
      break;
  }

  return `${field} traffic, ${ac}, ${body}, ${field}.`;
}

/**
 * Build the full self-announce sequence for a normal pattern: the ordered set of calls a pilot
 * makes for a touch-and-go circuit, taxi out through clear of the runway. Useful for a "talk me
 * through the pattern" briefing or to script the player's calls. Deterministic ordering.
 */
export function composePatternSequence(ctx: CtafContext): CtafCall[] {
  const ac = spokenCallsign(ctx.callsign, ctx.telephony);
  const legs: CtafLeg[] = ['taxi', 'departing', 'crosswind', 'downwind', 'base', 'final', 'clear'];
  return legs.map((leg) => ({ from: ac, text: composeSelfAnnounce(leg, ctx) }));
}

// --- Simulated other-traffic on the shared CTAF ----------------------------------------------

// A small synthetic fleet of GA/regional tails that share an uncontrolled field. Mixed N-numbers
// and a couple of make-prefixed callsigns, the way pilots actually self-identify on CTAF.
const CTAF_FLEET = [
  'N421SP', 'N73645', 'N8801Q', 'N512MD', 'N6647B',
  'N219CA', 'N9054T', 'N314PG', 'N77ER', 'N628RW',
];

// Spoken make prefixes for some tails, so traffic sounds like real CTAF ("Cessna Four Two One...").
const MAKE_PREFIX: Record<string, string> = {
  N421SP: 'Cessna', N73645: 'Cherokee', N8801Q: 'Skyhawk', N512MD: 'Bonanza',
  N6647B: 'Cirrus', N219CA: 'Archer', N9054T: 'Mooney', N314PG: 'Skylane',
  N77ER: 'Saratoga', N628RW: 'Diamond',
};

function pick<T>(arr: T[], n: number): T {
  return arr[((n % arr.length) + arr.length) % arr.length]!;
}

/**
 * Spoken label for a synthetic CTAF aircraft: "Cessna Four Two One Sierra Papa" (make + the
 * last 3 of the tail, spoken). Falls back to the full phonetic callsign if no make is known.
 */
function trafficLabel(tail: string): string {
  const make = MAKE_PREFIX[tail];
  if (make) {
    // Speak the last three characters (the common abbreviated CTAF form after first call).
    const suffix = tail.slice(-3);
    const spokenSuffix = suffix
      .split('')
      .map((c) => (/\d/.test(c) ? spokenDigits(c) : spokenCallsign(`N${c}`)))
      .join(' ')
      // spokenCallsign("NX") => "November X-phonetic"; strip the leading "November " we added.
      .replace(/November /g, '');
    return `${make} ${spokenSuffix}`.replace(/\s+/g, ' ').trim();
  }
  return spokenCallsign(tail);
}

/**
 * Generate ONE simulated other-traffic CTAF transmission, appropriate to an uncontrolled field.
 * `n` is a rolling counter that varies the leg + aircraft deterministically (no randomness),
 * exactly mirroring the ambient-chatter pattern used elsewhere in the codebase.
 *
 * Example (field "Sanderson", runway "16R", n=3):
 *   { from: "N512MD", text: "Sanderson traffic, Bonanza Two Em Dee, left base runway one six right, Sanderson." }
 */
export function composeTrafficCall(
  fieldName: string,
  runway: string | null | undefined,
  n: number,
): CtafCall {
  const tail = pick(CTAF_FLEET, n);
  const ac = trafficLabel(tail);
  const rwy = rwyPhrase(runway);
  const onRwy = rwy ? ` ${rwy}` : '';

  // Rotate through the realistic mix of calls heard on a shared CTAF.
  const bodies: string[] = [
    `taxiing to${onRwy || ' the active'}`,
    rwy ? `departing ${rwy}, straight out` : 'departing, straight out',
    `left downwind${onRwy}, full stop`,
    `left base${onRwy}`,
    rwy ? `final ${rwy}` : 'on final',
    rwy ? `clear of ${rwy}` : 'clear of the active',
    rwy ? `one zero miles to the south, inbound for ${rwy}` : 'one zero miles to the south, inbound for landing',
    'midfield crosswind for the downwind',
  ];
  const body = pick(bodies, n);
  return { from: tail, text: `${fieldName} traffic, ${ac}, ${body}, ${fieldName}.` };
}

/**
 * Build a short burst of simulated CTAF traffic (a few transmissions) for the active field, e.g.
 * to paint the picture when the player first checks in on CTAF. `seed` keeps it deterministic and
 * lets successive bursts differ. Returns `count` calls (default 3).
 */
export function composeTrafficBurst(
  fieldName: string,
  runway: string | null | undefined,
  seed: number,
  count = 3,
): CtafCall[] {
  const out: CtafCall[] = [];
  for (let i = 0; i < Math.max(1, count); i++) {
    out.push(composeTrafficCall(fieldName, runway, seed + i));
  }
  return out;
}
