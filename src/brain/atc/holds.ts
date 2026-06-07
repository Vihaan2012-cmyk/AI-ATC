// Holding instructions: build a published-style hold clearance with entry, turns, leg length,
// and an Expect Further Clearance (EFC) time. Deterministic; the fix is taken from the route
// when available so the hold is plausible for the flight.
import { spokenDigits } from '../util/phraseology.js';
import type { FlightPlan } from '../types.js';

export interface HoldInstruction {
  text: string;
  /** EFC as "HHMM" Zulu (for display/logging). */
  efcZulu: string;
}

function pad(n: number): string { return String(n).padStart(2, '0'); }

/**
 * Compute EFC time as "HHMM" Zulu from a UTC minute offset.
 * `nowUtcMinutes` is the current time in UTC minutes since 00:00.
 * `minutesAhead` (default 15) is how far in the future the EFC should be.
 */
export function computeEfcZulu(nowUtcMinutes: number, minutesAhead = 15): string {
  const efcMin = (nowUtcMinutes + minutesAhead) % (24 * 60);
  const hh = Math.floor(efcMin / 60), mm = efcMin % 60;
  return `${pad(hh)}${pad(mm)}`;
}

/**
 * Classify the holding-pattern entry (direct / teardrop / parallel) per AIM, from the aircraft's
 * inbound heading and the hold's inbound course (= radial + 180) and turn direction. Deterministic.
 */
export function holdEntry(inboundHeadingDeg: number, holdRadialDeg: number, turns: 'left' | 'right'): 'direct' | 'teardrop' | 'parallel' {
  const inboundCourse = (holdRadialDeg + 180) % 360;
  let rel = ((inboundHeadingDeg - inboundCourse + 540) % 360) - 180;
  if (turns === 'left') rel = -rel; // mirror sectors for left-hand holds
  if (rel > 70 && rel < 110) return 'teardrop';
  if (rel >= 110 || rel <= -110) return 'parallel';
  return 'direct';
}

/**
 * Build a hold at the next waypoint (or destination) with an EFC `minutesAhead` from `nowUtc`.
 * `nowUtc` is passed in so callers control the clock (the brain uses real time). If `inboundHeading`
 * is given, the recommended entry (direct/teardrop/parallel) is appended as guidance.
 */
export function buildHold(fp: FlightPlan, nowUtcMinutes: number, minutesAhead = 15, inboundHeading?: number): HoldInstruction {
  // Choose a fix: last enroute waypoint, else the destination ICAO.
  const wp = (fp.waypoints && fp.waypoints.length > 0)
    ? fp.waypoints[Math.min(fp.waypoints.length - 1, Math.floor(fp.waypoints.length / 2))]!.ident
    : fp.destination;

  // Seed turn direction + radial deterministically from the callsign + fix.
  const seed = Math.abs([...(fp.callsign + wp)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0));
  const turns: 'left' | 'right' = seed % 2 === 0 ? 'right' : 'left';
  const radial = (seed % 36) * 10 || 360;
  const leg = seed % 3 === 0 ? 'one zero mile legs' : 'standard turns';

  const efcZulu = computeEfcZulu(nowUtcMinutes, minutesAhead);

  const entry = inboundHeading != null
    ? ` Recommended entry: ${holdEntry(inboundHeading, radial, turns)}.`
    : '';
  const text = `hold ${turns} of ${wp} on the ${spokenDigits(String(radial).padStart(3, '0'))} radial, `
    + `${turns} turns, ${leg}. Expect further clearance at ${spokenDigits(efcZulu)} Zulu.${entry}`;
  return { text, efcZulu };
}
