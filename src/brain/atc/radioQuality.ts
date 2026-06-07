// Distance-based radio quality readability rating and helpers.
// Pure deterministic module; no side effects.
// Readability scale: 1 (unreadable) to 5 (crystal clear).
// Based on typical VHF line-of-sight propagation characteristics.

/** Readability level 1-5 with explanatory note. */
export interface RadioQualityResult {
  readability: 1 | 2 | 3 | 4 | 5;
  note: string;
}

/**
 * Estimate radio readability from distance in nautical miles.
 * Curve models typical VHF propagation at aviation altitudes:
 * - 0-10 nm: Crystal clear (R5)
 * - 10-25 nm: Very good (R4)
 * - 25-40 nm: Good (R3)
 * - 40-60 nm: Fair (R2)
 * - 60+ nm: Unreadable/marginal (R1)
 *
 * @param distNm Distance in nautical miles
 * @returns readability (1-5) and descriptive note
 */
export function radioQuality(distNm: number): RadioQualityResult {
  const d = Math.max(0, distNm);

  if (d <= 10) {
    return { readability: 5, note: 'Crystal clear' };
  }
  if (d <= 25) {
    return { readability: 4, note: 'Very good' };
  }
  if (d <= 40) {
    return { readability: 3, note: 'Good' };
  }
  if (d <= 60) {
    return { readability: 2, note: 'Fair; expect fading' };
  }
  return { readability: 1, note: 'Marginal or unreadable' };
}

/**
 * Speak a readability level in ATC style.
 * @param readability 1-5
 * @returns "readability one", "readability two", etc.
 */
export function spokenReadability(readability: 1 | 2 | 3 | 4 | 5): string {
  const words = ['', 'one', 'two', 'three', 'four', 'five'];
  return `readability ${words[readability] ?? ''}`;
}
