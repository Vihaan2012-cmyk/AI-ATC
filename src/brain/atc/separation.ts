// Separation helpers: wake-turbulence spacing minima and smart active-runway selection.
// Deterministic. The leader/follower wake categories drive required spacing; wind + aircraft type
// drive which runway is active. Used by tower/approach/clearance to phrase realistic instructions.
import { wakeCategory, type Wake } from '../util/aircraft.js';

/**
 * Wake-turbulence spacing minimum (nm) for a FOLLOWER behind a LEADER, by wake category.
 * Simplified ICAO/US matrix. 0 = standard radar separation (no extra wake spacing).
 */
export function wakeSpacingNm(leaderType: string, followerType: string): number {
  const lead: Wake = wakeCategory(leaderType);
  const follow: Wake = wakeCategory(followerType);
  // Super (A380) leader
  if (lead === 'J') {
    if (follow === 'J') return 0;
    if (follow === 'H') return 6;
    if (follow === 'M') return 7;
    return 8; // Light
  }
  // Heavy leader
  if (lead === 'H') {
    if (follow === 'H') return 4;
    if (follow === 'M') return 5;
    if (follow === 'L') return 6;
    return 0;
  }
  // Medium leader -> only Light needs extra
  if (lead === 'M' && follow === 'L') return 4;
  return 0;
}

/** Phrase a wake-caution when spacing applies, else empty. */
export function wakeCaution(leaderType: string, followerType: string): string {
  const nm = wakeSpacingNm(leaderType, followerType);
  if (nm <= 0) return '';
  const cat = wakeCategory(leaderType);
  const word = cat === 'J' ? 'super' : cat === 'H' ? 'heavy' : 'preceding';
  return `caution wake turbulence, ${word} aircraft; maintain ${nm} miles in trail`;
}

/**
 * Pick the active runway from available runways and wind direction (deg from). Chooses the runway
 * whose heading is most into the wind. Returns the first runway if wind unknown. Deterministic.
 */
export function pickActiveRunway(runways: string[], windDirDeg: number | null): string | null {
  if (runways.length === 0) return null;
  if (windDirDeg == null) return runways[0] ?? null;
  let best = runways[0]!;
  let bestDiff = 999;
  for (const r of runways) {
    const n = parseInt(r, 10);
    if (!Number.isFinite(n)) continue;
    // runway heading ~ n*10; difference from wind, folded to 0..180.
    const diff = Math.abs(((windDirDeg - n * 10 + 540) % 360) - 180);
    if (diff < bestDiff) { bestDiff = diff; best = r; }
  }
  return best;
}
