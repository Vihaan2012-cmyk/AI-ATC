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
 * Build a hold at the next waypoint (or destination) with an EFC `minutesAhead` from `nowUtc`.
 * `nowUtc` is passed in so callers control the clock (the brain uses real time).
 */
export function buildHold(fp: FlightPlan, nowUtcMinutes: number, minutesAhead = 15): HoldInstruction {
  // Choose a fix: last enroute waypoint, else the destination ICAO.
  const wp = (fp.waypoints && fp.waypoints.length > 0)
    ? fp.waypoints[Math.min(fp.waypoints.length - 1, Math.floor(fp.waypoints.length / 2))]!.ident
    : fp.destination;

  // Seed turn direction + radial deterministically from the callsign + fix.
  const seed = Math.abs([...(fp.callsign + wp)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0));
  const turns = seed % 2 === 0 ? 'right' : 'left';
  const radial = (seed % 36) * 10 || 360;
  const leg = seed % 3 === 0 ? 'one zero mile legs' : 'standard turns';

  const efcMin = (nowUtcMinutes + minutesAhead) % (24 * 60);
  const hh = Math.floor(efcMin / 60), mm = efcMin % 60;
  const efcZulu = `${pad(hh)}${pad(mm)}`;

  const text = `hold ${turns} of ${wp} on the ${spokenDigits(String(radial).padStart(3, '0'))} radial, `
    + `${turns} turns, ${leg}. Expect further clearance at ${spokenDigits(efcZulu)} Zulu.`;
  return { text, efcZulu };
}
