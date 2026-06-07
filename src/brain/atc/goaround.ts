// Go-around / missed-approach flow. When a pilot goes around, ATC issues the missed-approach
// instruction (climb on runway heading to a safe altitude, then expect re-sequencing). Deterministic.
import { spokenAltitude } from '../util/phraseology.js';

/** Did the pilot announce a go-around / missed approach? */
export function isGoAround(text: string): boolean {
  return /\bgo(?:ing)?[ -]?around\b|\bmissed approach\b|\bgo around\b/i.test(text);
}

export interface GoAroundContext {
  /** Arrival runway, if known (e.g. "16R"). */
  runway?: string;
  /** Field elevation (ft) if known, to set a sensible missed-approach altitude. */
  fieldElevationFt?: number;
}

/**
 * Compose the missed-approach instruction. Climbs to ~3000 ft above field (rounded), runway
 * heading, then vectors for re-sequence. Deterministic.
 */
export function composeGoAround(ctx: GoAroundContext): string {
  const base = ctx.fieldElevationFt ?? 0;
  const climbTo = Math.round((base + 3000) / 500) * 500;
  const rwy = ctx.runway ? `, fly runway heading ${spokenRunway(ctx.runway)}` : ', fly runway heading';
  return `roger, going around. Climb and maintain ${spokenAltitude(climbTo)}${rwy}, expect vectors for re-sequence.`;
}
