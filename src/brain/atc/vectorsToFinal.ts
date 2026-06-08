// Precise vectors-to-final: deterministic geometry that turns the player's live position
// (relative to a runway's extended centerline) into a base-leg / intercept heading plus an
// ILS/visual approach clearance. The engine owns all the facts here — the only "language"
// is template phraseology. No LLM, no randomness.
//
// Conventions match the rest of src/brain/atc/*: an `isXRequest` detector + a `composeX`
// composer, ES-module imports with .js extensions, named exports.

import { spokenDigits, spokenRunway } from '../util/phraseology.js';
import { distanceNm, bearingDeg, relativeAngle } from '../util/geo.js';

/** Standard ILS localizer intercept angle (degrees) for a clean, shallow capture. */
const STANDARD_INTERCEPT_DEG = 30;
/** Heading is offset from final by at most this many degrees on a base/downwind cut. */
const MAX_INTERCEPT_DEG = 45;

/** Live player state needed to compute a vector. Subset of FlightContext (kept local to stay pure). */
export interface VectorAircraft {
  lat: number;
  lon: number;
  /** Current magnetic/true heading the aircraft is flying (degrees, 0..360). */
  headingDeg: number;
  altitudeFt: number;
}

/** A runway end the aircraft is being vectored to. */
export interface RunwayTarget {
  /** Runway identifier, e.g. "28R". */
  ident: string;
  /** Latitude of the landing threshold (approach end). */
  thresholdLat: number;
  /** Longitude of the landing threshold (approach end). */
  thresholdLon: number;
  /** True course of the runway / final approach (degrees, 0..360). */
  courseTrue: number;
}

/** Which approach to clear for. */
export type ApproachType = 'ILS' | 'RNAV' | 'visual';

/** Where the aircraft sits relative to the localizer, and how to capture it. */
export interface VectorSolution {
  /** Heading (degrees, 0..360, integer) to assign for the intercept. */
  interceptHeadingDeg: number;
  /** Which way the aircraft turns to take up that heading, from its current heading. */
  turnDirection: 'left' | 'right';
  /** Magnitude of the turn in degrees (0..180). */
  turnDeg: number;
  /** Distance from the aircraft to the runway threshold, nautical miles. */
  distanceToThresholdNm: number;
  /** Perpendicular distance from the extended centerline, nautical miles (0 = on the localizer). */
  crossTrackNm: number;
  /** Side of the final the aircraft is on, looking outbound along the approach course. */
  side: 'left' | 'right' | 'centerline';
  /** True bearing from the aircraft to the threshold (degrees, 0..360). */
  bearingToThresholdDeg: number;
  /** True when the aircraft is established close enough to be cleared for the approach now. */
  establishedForClearance: boolean;
}

/**
 * Detect a pilot request that should trigger vectors to final / an approach clearance.
 * Matches "vectors to final", "request the ILS", "request vectors", "request the approach",
 * "established", "intercept the localizer", "request the visual", etc.
 */
export function isVectorsToFinalRequest(text: string): boolean {
  return /\bvectors?\s+(?:to\s+)?(?:the\s+)?(?:final|localizer|locali[sz]er|approach)\b|\brequest(?:ing)?\s+(?:the\s+)?(?:ils|rnav|gps|visual|approach|vectors?)\b|\bintercept(?:ing)?\s+the\s+(?:localizer|locali[sz]er|final)\b|\bestablished\b/i.test(
    text,
  );
}

/**
 * Detect which approach type the pilot asked for (defaults to ILS when only "approach"/"vectors").
 */
export function requestedApproachType(text: string): ApproachType {
  if (/\bvisual\b/i.test(text)) return 'visual';
  if (/\b(?:rnav|gps)\b/i.test(text)) return 'RNAV';
  return 'ILS';
}

/**
 * Wrap any heading to the 0..360 range (0 maps to 360 for spoken purposes; 360 kept as 360).
 * Internally we keep 0..359 then convert 0 -> 360 for ATC phraseology ("heading three six zero").
 */
function wrapHeading(h: number): number {
  const w = ((h % 360) + 360) % 360;
  return w === 0 ? 360 : w;
}

/**
 * Core geometry: compute the intercept heading, turn direction, and how far/which side of the
 * extended centerline the aircraft is.
 *
 * The math:
 *  - bearing + distance from aircraft to threshold give a polar position.
 *  - The angle between (bearing aircraft->threshold) and the *reciprocal* of the final course
 *    tells us which side of the localizer we're on and how far laterally (cross-track) we are.
 *  - We aim the aircraft to cut the localizer at STANDARD_INTERCEPT_DEG (clamped), turning toward
 *    the centerline. When already nearly established, the intercept heading collapses to the
 *    final course itself.
 */
export function computeVector(ac: VectorAircraft, rwy: RunwayTarget): VectorSolution {
  const distanceToThresholdNm = distanceNm(ac.lat, ac.lon, rwy.thresholdLat, rwy.thresholdLon);
  const bearingToThresholdDeg = bearingDeg(ac.lat, ac.lon, rwy.thresholdLat, rwy.thresholdLon);

  // Approach course points FROM the threshold outbound is the reciprocal of the landing course.
  // The aircraft is somewhere out on (or beside) that extended centerline. The angle between the
  // bearing-to-threshold and the landing course, measured the right way, gives the lateral side.
  // relativeAngle(a, b) is positive when a is clockwise of b.
  const angleOffCourse = relativeAngle(bearingToThresholdDeg, rwy.courseTrue);

  // Cross-track distance: lateral offset from the extended centerline.
  // For a point at slant distance d whose bearing differs from the course by theta, the
  // perpendicular offset is d * sin(theta). Magnitude only; sign comes from `side`.
  const crossTrackNm = Math.abs(distanceToThresholdNm * Math.sin((angleOffCourse * Math.PI) / 180));

  // Which side of the final is the aircraft on (viewed by a pilot tracking the approach course)?
  // If the threshold bears clockwise of the runway course as seen from the aircraft, the aircraft
  // is to the LEFT of the localizer (it must turn right to get onto it), and vice-versa.
  let side: VectorSolution['side'];
  if (Math.abs(angleOffCourse) < 1 || crossTrackNm < 0.2) {
    side = 'centerline';
  } else if (angleOffCourse > 0) {
    side = 'left';
  } else {
    side = 'right';
  }

  // Choose an intercept heading. When essentially on the centerline, fly the final course.
  // Otherwise, offset from the final course toward the aircraft's side by the intercept angle,
  // so the aircraft converges on the localizer.
  let interceptHeadingRaw: number;
  let turnTowardCenterline: 'left' | 'right';
  if (side === 'centerline') {
    interceptHeadingRaw = rwy.courseTrue;
    // No meaningful turn toward centerline; resolve direction from current heading below.
    turnTowardCenterline = relativeAngle(rwy.courseTrue, ac.headingDeg) >= 0 ? 'right' : 'left';
  } else if (side === 'left') {
    // Aircraft left of course -> turn right onto a heading that cuts in from the left.
    interceptHeadingRaw = rwy.courseTrue + STANDARD_INTERCEPT_DEG;
    turnTowardCenterline = 'right';
  } else {
    // Aircraft right of course -> turn left onto a heading that cuts in from the right.
    interceptHeadingRaw = rwy.courseTrue - STANDARD_INTERCEPT_DEG;
    turnTowardCenterline = 'left';
  }

  // Tighten the intercept when very close laterally so we don't overshoot a near-established jet.
  if (side !== 'centerline' && crossTrackNm < 1) {
    const tighter = Math.max(5, Math.round(STANDARD_INTERCEPT_DEG * crossTrackNm));
    interceptHeadingRaw = side === 'left'
      ? rwy.courseTrue + tighter
      : rwy.courseTrue - tighter;
  }

  const interceptHeadingDeg = wrapHeading(Math.round(interceptHeadingRaw));

  // Determine the actual turn (direction + magnitude) from the aircraft's current heading.
  const delta = relativeAngle(interceptHeadingDeg, ac.headingDeg); // + = clockwise (right)
  const turnDirection: 'left' | 'right' = delta >= 0 ? 'right' : 'left';
  const turnDeg = Math.abs(Math.round(delta));

  // "Established": within ~MAX_INTERCEPT_DEG of the final course laterally AND inside a sane
  // intercept distance/altitude window so the clearance is realistic.
  const established =
    crossTrackNm < 1.5 &&
    Math.abs(angleOffCourse) < MAX_INTERCEPT_DEG &&
    distanceToThresholdNm < 18;

  return {
    interceptHeadingDeg,
    // When on centerline the "toward centerline" turn is ambiguous; report the real turn.
    turnDirection: side === 'centerline' ? turnDirection : turnTowardCenterline,
    turnDeg,
    distanceToThresholdNm,
    crossTrackNm,
    side,
    bearingToThresholdDeg,
    establishedForClearance: established,
  };
}

/** Spoken heading: 310 -> "three one zero"; 360 -> "three six zero". */
function spokenHeading(headingDeg: number): string {
  const h = wrapHeading(Math.round(headingDeg));
  return spokenDigits(String(h).padStart(3, '0'));
}

/** The approach-name clause for a clearance, e.g. "cleared ILS runway two eight right approach" / "cleared visual approach runway one six left". */
function approachClause(approach: ApproachType, runwayIdent: string): string {
  const rwy = spokenRunway(runwayIdent);
  switch (approach) {
    case 'ILS':
      return `cleared ILS runway ${rwy} approach`;
    case 'RNAV':
      return `cleared RNAV runway ${rwy} approach`;
    case 'visual':
      return `cleared visual approach runway ${rwy}`;
  }
}

/**
 * Compose the spoken vectors-to-final clearance from the computed geometry.
 *
 * Example (off the localizer): "Southwest 1234, turn left heading three one zero, intercept the
 *   localizer, cleared ILS runway two eight right approach."
 * Example (already established): "Southwest 1234, cleared ILS runway two eight right approach."
 *
 * @param spokenCs   Spoken callsign, e.g. "Southwest 1234".
 * @param solution   Output of computeVector.
 * @param runwayIdent Runway identifier, e.g. "28R".
 * @param approach   Approach type to clear for (default 'ILS').
 */
export function composeVectorsToFinal(
  spokenCs: string,
  solution: VectorSolution,
  runwayIdent: string,
  approach: ApproachType = 'ILS',
): string {
  const clearance = approachClause(approach, runwayIdent);
  const interceptNoun = approach === 'visual' ? 'join the final' : 'intercept the localizer';

  // Already lined up: skip the vector, just clear the approach.
  if (solution.establishedForClearance && solution.turnDeg <= 5) {
    return `${spokenCs}, ${clearance}.`;
  }

  const hdg = spokenHeading(solution.interceptHeadingDeg);

  // Established but still needs a small heading tweak — vector then clear.
  if (solution.establishedForClearance) {
    return `${spokenCs}, turn ${solution.turnDirection} heading ${hdg}, ${interceptNoun}, ${clearance}.`;
  }

  // Standard vector to final: turn onto the intercept heading, then the approach clearance.
  return `${spokenCs}, turn ${solution.turnDirection} heading ${hdg}, ${interceptNoun}, ${clearance}.`;
}

/**
 * One-shot convenience: detector-side helper that runs the geometry and composes the clearance.
 * Returns both the clearance text and the assigned heading (for AssignedState wiring in session.ts).
 */
export function buildVectorsToFinal(
  spokenCs: string,
  ac: VectorAircraft,
  rwy: RunwayTarget,
  approach: ApproachType = 'ILS',
): { text: string; headingDeg: number; solution: VectorSolution } {
  const solution = computeVector(ac, rwy);
  const text = composeVectorsToFinal(spokenCs, solution, rwy.ident, approach);
  return { text, headingDeg: solution.interceptHeadingDeg, solution };
}
