// Hold-short / runway-incursion warnings. Deterministic engine: given the runways an aircraft
// has been cleared onto (takeoff / land / cross) versus its live position, decide whether the
// player is on or crossing a runway WITHOUT a clearance, and compose the corresponding ATC
// warning ("hold short! traffic on the runway") plus the Brasher follow-up that puts the pilot
// on notice of a possible pilot deviation.
//
// Pure functions only. The engine owns every fact (geometry, clearances, escalation); the LLM is
// never consulted here. Coordinates are degrees, distances nautical miles, headings degrees true.

import { distanceNm, relativeAngle } from '../util/geo.js';
import { spokenRunway } from '../util/phraseology.js';

/** A runway's physical extent, enough to test whether a point sits on the surface. */
export interface RunwaySurface {
  /** Primary ident, e.g. "16R". Used for clearance matching + spoken warnings. */
  ident: string;
  /** Reciprocal ident, e.g. "34L". Either end matches a clearance/crossing. */
  reciprocal?: string;
  /** Centre of the runway (midpoint), in degrees. */
  lat: number;
  lon: number;
  /** True heading of the primary end (0..360). The centreline lies along this axis. */
  headingTrue: number;
  /** Physical length, feet. Half-length sets the along-axis on-surface window. */
  lengthFt: number;
  /** Physical width, feet. Half-width (plus a small margin) sets the lateral window. */
  widthFt: number;
}

/** A minimal live position sample (subset of FlightContext) the detector needs. */
export interface IncursionPosition {
  latitude: number;
  longitude: number;
  /** Ground heading, degrees true. */
  headingTrue: number;
  /** Ground speed, knots — distinguishes "stopped at the hold" from "rolling onto it". */
  groundSpeedKt: number;
  onGround: boolean;
}

/** What the aircraft is authorised to do with respect to runways, from issued clearances. */
export interface RunwayClearances {
  /** Runway(s) cleared for takeoff (e.g. ["16R"]). Authorises being ON that surface. */
  takeoff?: string[];
  /** Runway(s) cleared to land / line up and wait. Authorises being ON that surface. */
  landOrLuaw?: string[];
  /** Runway(s) the aircraft is cleared to CROSS. Authorises transiting that surface. */
  cross?: string[];
}

/** A detected runway conflict (or the absence of one). */
export interface IncursionResult {
  /** True when the aircraft is on/entering a runway it is NOT cleared for. */
  incursion: boolean;
  /** The conflicting runway's primary ident, when incursion is true. */
  runway?: string;
  /** 'on_surface' = already on it; 'entering' = approaching the edge while rolling toward it. */
  severity?: 'entering' | 'on_surface';
  /** Lateral distance from the runway centreline, feet (for diagnostics / escalation tuning). */
  offsetFt?: number;
}

/** How close to the runway edge (feet, lateral) counts as "entering" while still rolling at it. */
const ENTERING_MARGIN_FT = 120;
/** Extra lateral slack beyond the painted width before a point is considered off the surface. */
const WIDTH_MARGIN_FT = 25;
/** Below this ground speed the aircraft is treated as stopped (correctly holding short). */
const ROLLING_KT = 3;
const FT_PER_NM = 6076.12;

/** Normalise a runway ident for comparison: keep digits + L/C/R only ("RWY 16R" -> "16R"). */
function rwyKey(ident: string): string {
  return ident.toUpperCase().replace(/[^0-9LCR]/g, '');
}

/** True if `ident` matches either end of `rwy` (primary or reciprocal). */
function matchesRunway(ident: string, rwy: RunwaySurface): boolean {
  const k = rwyKey(ident);
  return k === rwyKey(rwy.ident) || (rwy.reciprocal != null && k === rwyKey(rwy.reciprocal));
}

/** True if any ident in `list` refers to `rwy`. */
function listCovers(list: string[] | undefined, rwy: RunwaySurface): boolean {
  return !!list && list.some((id) => matchesRunway(id, rwy));
}

/** True when the issued clearances authorise the aircraft to be on/transit this runway. */
function isClearedFor(rwy: RunwaySurface, cl: RunwayClearances): boolean {
  return listCovers(cl.takeoff, rwy) || listCovers(cl.landOrLuaw, rwy) || listCovers(cl.cross, rwy);
}

/**
 * Decompose the aircraft's offset from a runway midpoint into along-axis and cross-axis feet.
 * along = distance projected onto the runway centreline; cross = perpendicular (lateral) offset.
 */
function runwayOffsetsFt(pos: IncursionPosition, rwy: RunwaySurface): { alongFt: number; crossFt: number } {
  const distFt = distanceNm(pos.latitude, pos.longitude, rwy.lat, rwy.lon) * FT_PER_NM;
  if (distFt === 0) return { alongFt: 0, crossFt: 0 };
  // Bearing FROM the runway centre TO the aircraft (degrees true).
  const dLat = pos.latitude - rwy.lat;
  // Scale longitude by cos(lat) so the local tangent plane is roughly metric in both axes.
  const dLon = (pos.longitude - rwy.lon) * Math.cos((rwy.lat * Math.PI) / 180);
  const bearingToAcft = (Math.atan2(dLon, dLat) * 180) / Math.PI; // 0 = north, +east
  // Angle between that bearing and the runway axis.
  const rel = relativeAngle((bearingToAcft + 360) % 360, rwy.headingTrue);
  const relRad = (rel * Math.PI) / 180;
  return { alongFt: Math.abs(distFt * Math.cos(relRad)), crossFt: Math.abs(distFt * Math.sin(relRad)) };
}

/**
 * Is the aircraft physically on (or about to enter) the given runway surface?
 * Returns 'on_surface' when inside the painted box, 'entering' when just outside the edge while
 * still moving, or null when clear of the surface.
 */
function surfaceContact(pos: IncursionPosition, rwy: RunwaySurface): { state: 'entering' | 'on_surface'; crossFt: number } | null {
  const halfLen = rwy.lengthFt / 2;
  const halfWidth = rwy.widthFt / 2;
  const { alongFt, crossFt } = runwayOffsetsFt(pos, rwy);
  // Must be within the runway's length to be on it at all (plus a small overrun tolerance).
  if (alongFt > halfLen + 100) return null;
  if (crossFt <= halfWidth + WIDTH_MARGIN_FT) return { state: 'on_surface', crossFt };
  // Just outside the edge but rolling toward the centreline -> entering.
  if (crossFt <= halfWidth + WIDTH_MARGIN_FT + ENTERING_MARGIN_FT && pos.groundSpeedKt > ROLLING_KT) {
    return { state: 'entering', crossFt };
  }
  return null;
}

/**
 * Detect a runway incursion: the aircraft is on (or entering) a runway for which it holds no
 * takeoff / land / line-up / cross clearance. Checks every runway and returns the most severe
 * conflict ('on_surface' beats 'entering'). Airborne aircraft never incur (the warning is a
 * ground/surface-movement concept), so onGround=false short-circuits to no incursion.
 *
 * Deterministic: no randomness, no I/O.
 */
export function detectIncursion(
  pos: IncursionPosition,
  runways: RunwaySurface[],
  clearances: RunwayClearances,
): IncursionResult {
  if (!pos.onGround) return { incursion: false };
  let best: IncursionResult = { incursion: false };
  for (const rwy of runways) {
    if (isClearedFor(rwy, clearances)) continue; // authorised — not an incursion
    const contact = surfaceContact(pos, rwy);
    if (!contact) continue;
    const candidate: IncursionResult = {
      incursion: true,
      runway: rwy.ident,
      severity: contact.state,
      offsetFt: Math.round(contact.crossFt),
    };
    // Prefer the worst conflict: already on a surface outranks merely entering one.
    if (!best.incursion || (best.severity === 'entering' && candidate.severity === 'on_surface')) {
      best = candidate;
    }
  }
  return best;
}

/**
 * Compose the immediate ATC hold-short / stop warning for a detected incursion.
 * 'entering'   -> a sharp hold-short command before the aircraft is committed.
 * 'on_surface' -> an urgent "runway, hold position / get off" call, repeated for emphasis.
 *
 * Example (entering):  "Southwest 1234, hold short runway one six right! Traffic on the runway."
 * Example (on surface):"Southwest 1234, runway one six right, hold position! Hold position, traffic on the runway!"
 */
export function composeIncursionWarning(
  spokenCs: string,
  runwayIdent: string,
  severity: 'entering' | 'on_surface',
): string {
  const rwy = spokenRunway(runwayIdent);
  if (severity === 'entering') {
    return `${spokenCs}, hold short runway ${rwy}! Traffic on the runway.`;
  }
  return `${spokenCs}, runway ${rwy}, hold position! Hold position, traffic on the runway!`;
}

/**
 * Compose the Brasher warning — the standard FAA follow-up after a possible pilot deviation, which
 * puts the pilot on notice and gives them a phone number to call. Deterministic phrasing; the
 * facility name is provided by the caller (the engine knows the active field).
 *
 * Example: "Southwest 1234, possible pilot deviation entering runway one six right without
 *           clearance. Advise you contact Seattle Tower at five five five, one two three four."
 *
 * @param spokenCs    Spoken callsign, e.g. "Southwest 1234".
 * @param runwayIdent The runway involved, e.g. "16R".
 * @param facility    Spoken facility name to call, e.g. "Seattle Tower".
 * @param phone       Optional spoken phone digits; defaults to a generic FSDO-style number.
 */
export function composeBrasher(
  spokenCs: string,
  runwayIdent: string,
  facility: string,
  phone = 'the number provided',
): string {
  const rwy = spokenRunway(runwayIdent);
  const callPhrase = phone === 'the number provided' ? phone : `at ${phone}`;
  return `${spokenCs}, possible pilot deviation entering runway ${rwy} without clearance. `
    + `Advise you contact ${facility} ${callPhrase}.`;
}

/**
 * Stateful incursion warner: wraps the pure detector with edge-triggering + a cooldown so the
 * brain emits ONE warning per excursion (not on every position sample), and escalates to a Brasher
 * follow-up if the aircraft stays on the runway uncleared past the grace window.
 *
 * Designed to be driven from the live-position loop in comms/server.ts: call `evaluate` with each
 * sample and broadcast whatever text it returns.
 */
export interface IncursionEvent {
  /** Spoken warning text to broadcast (callsign already included). */
  text: string;
  /** 'warning' = first hold-short/stop call; 'brasher' = the deviation follow-up. */
  kind: 'warning' | 'brasher';
  /** The runway involved. */
  runway: string;
}

const WARNING_COOLDOWN_MS = 20000;   // don't repeat the hold-short call within this window
const BRASHER_DELAY_MS = 8000;       // still uncleared on the surface this long -> Brasher

export class IncursionWarner {
  private lastWarnAt = 0;
  /** True once any warning has fired for the current excursion (so the first one is never gated). */
  private warnedThisExcursion = false;
  /** When the current uncleared-on-surface excursion began (0 = not currently incurring). */
  private excursionStart = 0;
  /** Runway of the current excursion, so a new runway re-triggers immediately. */
  private excursionRunway = '';
  /** True once the Brasher has been issued for the current excursion (issue it only once). */
  private brasherDone = false;

  constructor(
    private spokenCs: string,
    private facility: string,
    private phone = 'the number provided',
  ) {}

  /** Update the facility/callsign if the active controller or flight changes mid-session. */
  setFacility(facility: string): void { this.facility = facility; }
  setCallsign(spokenCs: string): void { this.spokenCs = spokenCs; }

  /**
   * Evaluate one position sample. Returns a single event to broadcast, or null.
   * `nowMs` is injected (the brain owns the clock; tests pass a fixed value).
   */
  evaluate(
    pos: IncursionPosition,
    runways: RunwaySurface[],
    clearances: RunwayClearances,
    nowMs: number,
  ): IncursionEvent | null {
    const result = detectIncursion(pos, runways, clearances);
    if (!result.incursion || !result.runway || !result.severity) {
      // Cleared the surface (or got a clearance) — reset the excursion so the next one re-triggers.
      this.excursionStart = 0;
      this.excursionRunway = '';
      this.brasherDone = false;
      this.warnedThisExcursion = false;
      return null;
    }

    // A new runway (or the first detection) starts a fresh excursion.
    if (this.excursionRunway !== result.runway) {
      this.excursionStart = nowMs;
      this.excursionRunway = result.runway;
      this.brasherDone = false;
      this.warnedThisExcursion = false; // first warning for the new runway fires immediately
    }

    // Escalate to the Brasher once we've been uncleared on the surface past the grace window.
    if (
      !this.brasherDone
      && result.severity === 'on_surface'
      && nowMs - this.excursionStart >= BRASHER_DELAY_MS
    ) {
      this.brasherDone = true;
      this.lastWarnAt = nowMs;
      return {
        kind: 'brasher',
        runway: result.runway,
        text: composeBrasher(this.spokenCs, result.runway, this.facility, this.phone),
      };
    }

    // Otherwise emit the hold-short/stop warning. The first call of an excursion is never gated;
    // subsequent repeats are throttled by the cooldown.
    if (!this.warnedThisExcursion || nowMs - this.lastWarnAt >= WARNING_COOLDOWN_MS) {
      this.lastWarnAt = nowMs;
      this.warnedThisExcursion = true;
      return {
        kind: 'warning',
        runway: result.runway,
        text: composeIncursionWarning(this.spokenCs, result.runway, result.severity),
      };
    }
    return null;
  }
}
