// Top-of-descent computation. Uses the standard 3:1 rule (3 nm per 1000 ft to lose) plus a small
// pad, so the engine can prompt "begin descent" at the right distance from the field. Deterministic.

/**
 * Distance (nm) before the field at which descent should begin, to go from `cruiseFt` down to
 * `fieldElevationFt` at a 3:1 profile. Returns 0 if already at/below field elevation.
 */
export function todDistanceNm(cruiseFt: number, fieldElevationFt: number): number {
  const toLose = Math.max(0, cruiseFt - fieldElevationFt);
  // 3 nm per 1000 ft, + ~5 nm pad for deceleration/approach setup.
  return Math.round((toLose / 1000) * 3 + 5);
}

/**
 * Given current distance-to-field (nm) and the computed TOD distance, return a coarse phase:
 * 'cruise' (well before), 'approaching' (within 10 nm of TOD), 'at_tod' (at/past TOD).
 */
export function todPhase(distToFieldNm: number, todNm: number): 'cruise' | 'approaching' | 'at_tod' {
  if (distToFieldNm <= todNm) return 'at_tod';
  if (distToFieldNm <= todNm + 10) return 'approaching';
  return 'cruise';
}
