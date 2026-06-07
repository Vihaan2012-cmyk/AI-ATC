// Special VFR clearance. When a pilot in VFR conditions requests to enter Class D airspace,
// ATC can authorize Special VFR (no controlled flight rules, but maintains VFR separation).
// Deterministic.

/** Did the pilot request Special VFR entry? */
export function isSvfrRequest(text: string): boolean {
  return /\bspecial VFR\b|\bspecial vee eff are\b|\bsvfr\b/i.test(text);
}

/**
 * Compose a Special VFR clearance into Class D airspace. Pilot must maintain
 * Special VFR conditions (1000 ft AGL, 3 sm visibility) and report clear of surface area.
 * Deterministic.
 */
export function composeSvfr(spokenCallsign: string, field: string): string {
  return `${spokenCallsign}, cleared into the ${field} Class D as Special VFR, maintain Special VFR conditions, report clear of the surface area.`;
}
