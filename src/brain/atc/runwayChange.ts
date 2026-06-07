// Runway change logic: smart reassignment on the fly based on wind conditions.
// Deterministic — picks the runway that favors current wind, then composes ATC phraseology.
import { pickActiveRunway } from './separation.js';
import { spokenRunway } from '../util/phraseology.js';

/**
 * Determine if a runway change is warranted and return the new runway, or null if no change is needed.
 * Compares the current runway against all available runways using wind direction.
 * Returns the preferred runway if it differs from current; otherwise null.
 *
 * @param windDirDeg Wind direction in degrees (0..359) or null if unknown.
 * @param currentRunway Current assigned runway (e.g., "16L").
 * @param runways Available runways at the airport (e.g., ["16L", "34R"]).
 * @returns The new runway string if a change is warranted; null if current is optimal or wind is unknown.
 */
export function shouldChangeRunway(
  windDirDeg: number | null,
  currentRunway: string,
  runways: string[],
): string | null {
  // If wind is unknown or no runways available, no change.
  if (windDirDeg == null || runways.length === 0) return null;

  // Use the same logic as pickActiveRunway to find the best runway for current wind.
  const bestRunway = pickActiveRunway(runways, windDirDeg);

  // If the best runway differs from current, recommend the change.
  if (bestRunway && bestRunway !== currentRunway) {
    return bestRunway;
  }

  return null;
}

/**
 * Compose ATC phraseology for a runway change instruction.
 * Format: "<callsign>, expect runway <runway> now, winds favor it."
 *
 * @param spokenCs Spoken callsign (e.g., "Southwest one two three four").
 * @param newRwy New runway identifier (e.g., "34R").
 * @returns ATC instruction string.
 */
export function composeRunwayChange(spokenCs: string, newRwy: string): string {
  const spokenRwy = spokenRunway(newRwy);
  return `${spokenCs}, expect runway ${spokenRwy} now, winds favor it`;
}
