// Diversion clearances and offers: when a pilot needs to go to an alternate airport.
// Deterministic engine decides whether to clear the diversion or offer one proactively when
// the destination is below minimums. The LLM only handles the wording bridge.

import { spokenAltitude } from '../util/phraseology.js';

/**
 * Detect if a pilot has requested a diversion to an alternate airport.
 * Matches patterns like "request divert to", "unable destination", "divert to", "can't make it", etc.
 * Returns true if the request is clear enough to act on.
 */
export function isDiversionRequest(text: string): boolean {
  return /\brequest\s+divert(?:\s+to)?\b|\bunable\s+destination|\bdivert\s+to\b|\bcan['t]*\s+make\s+(?:it|destination)|\bdestination\s+below|\bheading\s+to\s+alternate/i.test(
    text,
  );
}

/**
 * Compose ATC's clearance when a pilot has requested to divert to an alternate.
 * Example: "Southwest 1234, roger, cleared to divert to Spokane, descend pilot's discretion, expect vectors."
 *
 * @param spokenCs The pilot's spoken callsign, e.g. "Southwest 1234"
 * @param alternate The ICAO code or name of the alternate airport, e.g. "Spokane" or "KGEG"
 * @returns The full clearance phrase
 */
export function composeDiversion(spokenCs: string, alternate: string): string {
  return `${spokenCs}, roger, cleared to divert to ${alternate}, descend pilot's discretion, expect vectors.`;
}

/**
 * Compose ATC's proactive offer of a diversion when the destination is below landing minimums.
 * This is controller-initiated, giving the pilot a chance to respond with intent.
 * Example: "United 737, Spokane is now below minimums, say intentions; Seattle is available."
 *
 * @param spokenCs The pilot's spoken callsign, e.g. "United 737"
 * @param alternate The ICAO code or name of the available alternate, e.g. "Seattle" or "KSEA"
 * @returns The offer phrase
 */
export function offerDiversion(spokenCs: string, alternate: string): string {
  // The destination name is inferred from context, so we keep it generic
  // Controllers phrasing: "[destination] is now below minimums, say intentions; [alternate] is available."
  return `${spokenCs}, destination is now below minimums, say your intentions; ${alternate} is available.`;
}
