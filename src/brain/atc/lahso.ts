// LAHSO (Land and Hold Short Operations) clearances and pilot acceptance/refusal detection.
// Pure, deterministic engine — the LLM only does language bridging if needed.

import { spokenDigits, spokenRunway } from '../util/phraseology.js';

/**
 * Compose a LAHSO (Land and Hold Short) clearance.
 *
 * @param spokenCs - The aircraft's spoken callsign (e.g., "United two seven four")
 * @param landRwy - Landing runway (e.g., "16L", "08")
 * @param holdShortOf - The obstacle or runway to hold short of (e.g., "runway 16R", "taxiway Alpha")
 * @param availableDistanceFt - Available landing distance in feet
 * @returns A complete LAHSO clearance string ready for voice synthesis
 *
 * Example:
 * composeLahso("United two seven four", "16L", "runway 16R", 4500)
 * => "United two seven four, cleared to land runway one six left, hold short of runway one six right, four thousand five hundred feet available."
 */
export function composeLahso(
  spokenCs: string,
  landRwy: string,
  holdShortOf: string,
  availableDistanceFt: number,
): string {
  const spokenLandRwy = spokenRunway(landRwy);
  const spokenHoldShort = formatHoldShortObstacle(holdShortOf);
  const spokenDist = spokenDistance(availableDistanceFt);

  return `${spokenCs}, cleared to land runway ${spokenLandRwy}, hold short of ${spokenHoldShort}, ${spokenDist} feet available.`;
}

/**
 * Format the hold-short obstacle name for spoken delivery.
 * Converts "runway 16R" => "runway one six right",
 * "taxiway Alpha" => "taxiway Alpha", etc.
 */
function formatHoldShortObstacle(obstacle: string): string {
  const upper = obstacle.toUpperCase().trim();

  // Handle "RUNWAY \d{2}[LCR]?" patterns
  if (upper.startsWith('RUNWAY')) {
    const rwyPart = upper.replace(/^RUNWAY\s*/, '').trim();
    return `runway ${spokenRunway(rwyPart)}`;
  }

  // Handle "TAXIWAY X" patterns — spell out the taxiway letter/name
  if (upper.startsWith('TAXIWAY')) {
    const taxiPart = upper.replace(/^TAXIWAY\s*/, '').trim();
    return `taxiway ${spokenDigits(taxiPart)}`;
  }

  // Default fallback (keep as-is)
  return obstacle;
}

/**
 * Convert a distance in feet to spoken form suitable for LAHSO.
 * 4500 => "four thousand five hundred"
 * 3000 => "three thousand"
 * 6800 => "six thousand eight hundred"
 */
function spokenDistance(ft: number): string {
  if (ft <= 0) return 'zero';

  const thousands = Math.floor(ft / 1000);
  const hundreds = Math.floor((ft % 1000) / 100);
  const parts: string[] = [];

  if (thousands > 0) {
    parts.push(`${spokenDigits(String(thousands))} thousand`);
  }
  if (hundreds > 0) {
    parts.push(`${spokenDigits(String(hundreds))} hundred`);
  }

  return parts.length > 0 ? parts.join(' ') : 'zero';
}

/**
 * Detect if a pilot transmission indicates acceptance of a LAHSO clearance.
 * Looks for "ready", "willing", "wilco", "accept", "can do", etc.
 *
 * @param text - The pilot's spoken transmission
 * @returns true if the pilot appears to accept the LAHSO clearance
 *
 * Examples:
 * - "yeah we can accept that" => true
 * - "ready for the approach" => true
 * - "wilco" => true
 * - "unable" => false
 */
export function isLahsoAccepted(text: string): boolean {
  const lower = text.toLowerCase();
  // Acceptance indicators
  if (/\b(ready|wilco|roger|affirmative|yes|yeah|yep|can do|we accept|we will|affrim)\b/.test(lower)) {
    // Filter out explicit refusal in the same transmission
    if (/\b(unable|negative|unable|cannot|can't|can not|no can do)\b/.test(lower)) {
      // If both acceptance and refusal appear, treat refusal as final unless acceptance is explicit
      // e.g., "we can accept" with "cannot" in a caveat should parse correctly
      const acceptIdx = lower.search(/\b(ready|wilco|roger|affirmative|yes|we accept|we will)\b/);
      const refuseIdx = lower.search(/\b(unable|negative|cannot)\b/);
      if (refuseIdx > -1 && (acceptIdx < 0 || refuseIdx > acceptIdx)) {
        return false;
      }
    }
    return true;
  }
  return false;
}

/**
 * Detect if a pilot transmission indicates refusal of a LAHSO clearance.
 * Looks for "unable", "negative", "can't", etc.
 *
 * @param text - The pilot's spoken transmission
 * @returns true if the pilot explicitly refuses the LAHSO clearance
 *
 * Examples:
 * - "unable, require full length" => true
 * - "negative" => true
 * - "we cannot accept that" => true
 * - "cleared to land, thank you" => false
 */
export function isLahsoRefused(text: string): boolean {
  const lower = text.toLowerCase();
  // Explicit refusal indicators
  if (/\b(unable|negative|nope|no|cannot|can't|can not|not willing|we cannot|no can do)\b/.test(lower)) {
    // Filter out false positives: "not a problem" or "no problem"
    if (/\b(not a problem|no problem)\b/.test(lower)) {
      return false;
    }
    return true;
  }
  // "Need full length" or "require full length" is an indirect refusal
  if (/\b(need|require|request)\s+(full|entire|complete)\s+length\b/.test(lower)) {
    return true;
  }
  return false;
}
