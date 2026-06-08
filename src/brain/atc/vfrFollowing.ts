// Expanded VFR flight following for GA / bush pilots who don't file IFR.
//
// Flight following is a workload-permitting radar advisory service: the controller assigns a
// discrete squawk, establishes "radar contact", and then volunteers traffic advisories until
// the pilot leaves the airspace, the squawk goes stale, or the service is terminated.
//
// HYBRID rule: this module is the deterministic ENGINE. It owns every fact (squawk codes,
// clock-position traffic geometry, whether the service can be provided). The LLM is never the
// source of any of these values — it may only smooth the surface wording downstream if desired.
// All functions here are PURE: same inputs -> same output, no I/O, no clock, no randomness
// except the shared allocateSquawk() (which is the project's single squawk authority).

import {
  spokenDigits,
  spokenFreq,
  spokenAltitude,
} from '../util/phraseology.js';
import { allocateSquawk } from './squawk.js';
import type { Reply, AssignedState } from '../types.js';

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Did the pilot ask to START / request VFR flight following (radar advisories)?
 * Matches: "request flight following", "request VFR advisories", "VFR flight following to ...",
 * "radar advisories", "request advisory service", "flight following to Boise", "request traffic
 * advisories", "request VFR services".
 */
export function isFlightFollowingRequest(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\bflight\s*follow(?:ing)?\b/.test(t) ||
    /\bvfr\s+(?:flight\s+following|advisor(?:y|ies)?|service|services)\b/.test(t) ||
    /\bradar\s+advisor(?:y|ies)\b/.test(t) ||
    /\brequest\s+(?:advisor(?:y|ies)?|advisory\s+service)\b/.test(t) ||
    /\brequest\s+traffic\s+advisor(?:y|ies)\b/.test(t)
  );
}

/**
 * Did the pilot ask to END flight following / cancel the radar service?
 * Matches: "cancel flight following", "terminate flight following", "cancel advisories",
 * "cancel radar service", "no longer require flight following", "terminate radar service".
 */
export function isFlightFollowingCancel(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\b(?:cancel|terminat\w*|end|stop)\b.*\b(?:flight\s*follow(?:ing)?|advisor(?:y|ies)?|radar\s+service)\b/.test(t) ||
    /\bno\s+longer\s+(?:require|need)\b.*\b(?:flight\s*follow(?:ing)?|advisor(?:y|ies)?|service)\b/.test(t)
  );
}

// ---------------------------------------------------------------------------
// Parsing — pull the destination out of a following request, if stated.
// ---------------------------------------------------------------------------

/**
 * Extract a stated destination ("... following TO Boise", "... to KBOI") from a following request.
 * Returns the raw token the pilot used (the caller resolves it against nav). Null if not stated;
 * the caller should fall back to the filed destination.
 */
export function parseFollowingDestination(text: string): string | null {
  // Stop at common trailing clauses so we don't swallow "to Boise at five thousand".
  const m = text.match(
    /\b(?:following|advisor(?:y|ies)?|service|services|landing|inbound)\s+(?:to|for|into)\s+([A-Za-z][A-Za-z .'-]*?)(?:\s+(?:at|maintaining|climbing|descending|level|squawk)\b|[,.]|$)/i,
  );
  if (m && m[1]) {
    const dest = m[1].trim();
    if (dest.length > 0) return dest;
  }
  // Bare ICAO form: "to KBOI" / "for KSUN".
  const icao = text.match(/\b(?:to|for|into)\s+([A-Z]{3,4})\b/);
  if (icao && icao[1]) return icao[1];
  return null;
}

// ---------------------------------------------------------------------------
// Traffic advisories — clock-position geometry (deterministic).
// ---------------------------------------------------------------------------

export interface TrafficTarget {
  /** Bearing TO the traffic, in degrees true (0..359). */
  bearingDeg: number;
  /** Range to the traffic in nautical miles. */
  rangeNm: number;
  /** Traffic's altitude in feet MSL, if known/Mode C. */
  altitudeFt?: number;
  /** Short description, e.g. "a Cessna", "type unknown", "a King Air". */
  description?: string;
  /** Movement relative to own ship, if known. */
  movement?: 'opposite direction' | 'same direction' | 'converging' | 'crossing' | 'maneuvering';
}

const CLOCK_WORD = [
  '', 'one', 'two', 'three', 'four', 'five', 'six',
  'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
];

/**
 * Convert a bearing-to-traffic and own heading into a clock position (1..12 o'clock).
 * 12 o'clock is dead ahead; 3 o'clock is the right wing; 6 is behind.
 */
export function clockPosition(bearingToTrafficDeg: number, ownHeadingDeg: number): number {
  let rel = (((bearingToTrafficDeg - ownHeadingDeg) % 360) + 360) % 360;
  // Each clock hour spans 30 degrees; round to nearest, with 0 deg => 12 o'clock.
  let hour = Math.round(rel / 30);
  if (hour === 0) hour = 12;
  return hour;
}

/** Spoken relative altitude phrase vs own altitude, e.g. "five hundred feet below". */
function relativeAltitudePhrase(trafficFt: number, ownAltFt: number): string {
  const diff = trafficFt - ownAltFt;
  const abs = Math.abs(diff);
  if (abs < 200) return 'altitude indicates your altitude';
  // Round to nearest 100 ft for the call.
  const rounded = Math.round(abs / 100) * 100;
  const where = diff > 0 ? 'above' : 'below';
  return `${spokenAltitude(rounded)} feet ${where}`;
}

/**
 * Compose a single traffic advisory clause (no callsign prefix).
 * Examples:
 *   "traffic, two o'clock, three miles, opposite direction, a Cessna, five hundred feet below"
 *   "traffic, ten o'clock, five miles, type and altitude unknown"
 */
export function composeTrafficAdvisory(
  target: TrafficTarget,
  ownHeadingDeg: number,
  ownAltitudeFt: number,
): string {
  const hour = clockPosition(target.bearingDeg, ownHeadingDeg);
  const oclock = `${CLOCK_WORD[hour] ?? String(hour)} o'clock`;
  const miles = Math.max(1, Math.round(target.rangeNm));
  const milesWord = `${spokenDigits(String(miles))} mile${miles === 1 ? '' : 's'}`;
  const parts: string[] = ['traffic', oclock, milesWord];
  if (target.movement) parts.push(target.movement);
  if (target.description) {
    parts.push(target.description);
  } else if (target.altitudeFt == null) {
    parts.push('type and altitude unknown');
  } else {
    parts.push('type unknown');
  }
  if (target.altitudeFt != null) {
    parts.push(relativeAltitudePhrase(target.altitudeFt, ownAltitudeFt));
  }
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// Reply composers — return full Reply objects.
// ---------------------------------------------------------------------------

export interface FollowingDeps {
  /** Spoken callsign, e.g. "Cessna five one two sierra romeo". */
  spokenCs: string;
  /** Station label, e.g. "Salt Lake Center" or "Boise Approach". */
  from: string;
  /** Active frequency in MHz (the freq the pilot is on). */
  freqMhz: number | null;
}

/** Result of establishing flight following: the reply plus the squawk that was assigned. */
export interface FollowingEstablished {
  reply: Reply;
  squawk: string;
}

/**
 * ESTABLISH flight following: assign a discrete squawk and declare radar contact once the pilot
 * is tagged. We assign the code in the same call (one transmission, realistic GA flow): the squawk
 * is allocated by the project's single squawk authority and carried in `assigned` so the cockpit
 * auto-sets the transponder and the HUD strip updates.
 *
 * @param deps        station / callsign / frequency context
 * @param destination spoken or short destination name (e.g. "Boise"); caller resolves the ICAO
 * @param altitudeFt  pilot's reported VFR altitude in feet MSL, if known (echoed for confirmation)
 */
export function composeEstablishFollowing(
  deps: FollowingDeps,
  destination: string,
  altitudeFt?: number,
): FollowingEstablished {
  const squawk = allocateSquawk();
  const altClause =
    altitudeFt != null && altitudeFt > 0 ? `, maintain VFR at ${spokenAltitude(altitudeFt)}` : ', maintain VFR';
  const text =
    `${deps.spokenCs}, ${deps.from.replace(/\s+(Center|Approach|Departure|Tower)$/i, '') || 'radar'} radar contact, ` +
    `squawk ${spokenDigits(squawk)}. Flight following to ${destination} approved${altClause}, ` +
    `altimeter on request, advise any altitude or routing changes.`;
  const assigned: AssignedState = { squawk };
  if (altitudeFt != null && altitudeFt > 0) assigned.altitudeFt = altitudeFt;
  return {
    reply: {
      from: deps.from,
      freqMhz: deps.freqMhz,
      text,
      expecting: 'readback',
      assigned,
    },
    squawk,
  };
}

/**
 * STANDALONE squawk (re)assignment, e.g. when the controller wants a different code or the pilot
 * was already on 1200. Returns the reply plus the new code.
 */
export function composeSquawkAssignment(deps: FollowingDeps): FollowingEstablished {
  const squawk = allocateSquawk();
  return {
    reply: {
      from: deps.from,
      freqMhz: deps.freqMhz,
      text: `${deps.spokenCs}, squawk ${spokenDigits(squawk)}.`,
      expecting: 'readback',
      assigned: { squawk },
    },
    squawk,
  };
}

/**
 * RADAR CONTACT after the pilot squawks the assigned code (when establishment is split into two
 * transmissions: assign code first, then confirm contact).
 */
export function composeRadarContact(deps: FollowingDeps, destination: string): Reply {
  return {
    from: deps.from,
    freqMhz: deps.freqMhz,
    text: `${deps.spokenCs}, radar contact, flight following to ${destination} approved, maintain VFR.`,
    expecting: 'none',
  };
}

/**
 * TRAFFIC ADVISORY reply: bundle one or more targets into a single transmission. The first target
 * is called precisely; additional targets are summarized as a count (matches real workload-limited
 * delivery). Caller supplies own heading + altitude so clock positions are computed correctly.
 */
export function composeTrafficReply(
  deps: FollowingDeps,
  targets: TrafficTarget[],
  ownHeadingDeg: number,
  ownAltitudeFt: number,
): Reply {
  if (targets.length === 0) {
    return {
      from: deps.from,
      freqMhz: deps.freqMhz,
      text: `${deps.spokenCs}, no observed traffic between you and your destination.`,
      expecting: 'none',
    };
  }
  const first = targets[0]!;
  const primary = composeTrafficAdvisory(first, ownHeadingDeg, ownAltitudeFt);
  const more = targets.length - 1;
  const tail =
    more > 0 ? ` Additional traffic, ${spokenDigits(String(more))} target${more === 1 ? '' : 's'} in your vicinity.` : '';
  return {
    from: deps.from,
    freqMhz: deps.freqMhz,
    text: `${deps.spokenCs}, ${primary}.${tail}`,
    expecting: 'none',
  };
}

/**
 * FREQUENCY CHANGE APPROVED: the GA pilot asks to leave the freq briefly (e.g. to get a weather
 * brief or call FBO) while keeping flight following. Standard reply is "frequency change approved,
 * report back on this frequency" (the squawk stays assigned).
 */
export function composeFreqChangeApproved(deps: FollowingDeps): Reply {
  return {
    from: deps.from,
    freqMhz: deps.freqMhz,
    text: `${deps.spokenCs}, frequency change approved, report back this frequency.`,
    expecting: 'none',
  };
}

/**
 * HANDOFF to the next sector/approach while keeping flight following (the service continues, the
 * code stays the same). Carries the next station + frequency in `assigned` for the HUD strip.
 */
export function composeFollowingHandoff(
  deps: FollowingDeps,
  nextStation: string,
  nextFreqMhz: number,
): Reply {
  return {
    from: deps.from,
    freqMhz: deps.freqMhz,
    text: `${deps.spokenCs}, contact ${nextStation} on ${spokenFreq(nextFreqMhz)}, they have your tag.`,
    expecting: 'readback',
    assigned: { nextStation, nextFreqMhz, nextAction: 'contact' },
  };
}

/**
 * RADAR SERVICE TERMINATED — controller-initiated, normal end of service: the pilot is leaving
 * coverage / approaching an uncontrolled field. Pilot reverts to 1200 and goes en-route freq.
 * `landingDestination` (optional, short name) lets us add the airport-advisory hint.
 */
export function composeRadarTerminated(
  deps: FollowingDeps,
  landingDestination?: string,
): Reply {
  const advisory = landingDestination
    ? ` For ${landingDestination}, monitor the airport advisory frequency.`
    : '';
  return {
    from: deps.from,
    freqMhz: deps.freqMhz,
    text:
      `${deps.spokenCs}, radar service terminated, squawk VFR, frequency change approved.${advisory}`,
    expecting: 'none',
    assigned: { squawk: '1200' },
  };
}

/**
 * RADAR CONTACT LOST — the target dropped below coverage or the squawk went stale. Controller asks
 * the pilot to recycle the transponder and say altitude so the tag can be re-acquired.
 */
export function composeRadarContactLost(deps: FollowingDeps): Reply {
  return {
    from: deps.from,
    freqMhz: deps.freqMhz,
    text:
      `${deps.spokenCs}, radar contact lost, recycle your transponder and say altitude.`,
    expecting: 'readback',
  };
}

/**
 * Pilot-initiated CANCEL acknowledgement: pilot no longer wants the service.
 */
export function composeFollowingCancelAck(deps: FollowingDeps): Reply {
  return {
    from: deps.from,
    freqMhz: deps.freqMhz,
    text: `${deps.spokenCs}, roger, radar service terminated, squawk VFR, good day.`,
    expecting: 'none',
    assigned: { squawk: '1200' },
  };
}
