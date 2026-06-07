// Deterministic handback logic: when ATC tells the pilot to stay on the current frequency.
// Used as an alternative to full handoffs (~20% of the time).

/**
 * Deterministic decision: should this handoff be a "remain this frequency" instead?
 * Based on a seed value (typically derived from callsign/context), returns true ~20% of the time.
 * @param seed - numeric input for determinism (e.g., hash of callsign + frequency)
 * @returns true if ATC should keep the pilot on the current frequency
 */
export function shouldRemainFrequency(seed: number): boolean {
  // Use modulo arithmetic for deterministic distribution.
  // seed % 5 yields 0,1,2,3,4 with equal probability if seed is well-distributed.
  // Return true for 0 (20%), false for 1-4 (80%).
  return (seed % 5) === 0;
}

/**
 * Compose a "remain this frequency" instruction.
 * @param spokenCs - spoken callsign, e.g. "Southwest 1234"
 * @param station - station label, e.g. "Departure" or "Center"
 * @returns phrase like "Southwest 1234, remain this frequency."
 */
export function composeRemain(spokenCs: string, station: string): string {
  return `${spokenCs}, remain this frequency.`;
}
