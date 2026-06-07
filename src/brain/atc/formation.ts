// Formation flight / flight-of-two clearances: deterministic engine owns whether to authorize
// a formation request. Phraseology matches standard ATC formation flight conventions.

/**
 * Detect if a pilot transmission is requesting formation/flight-of-two clearance.
 * Matches patterns like "flight of two", "formation flight", "form up", etc.
 */
export function isFormationRequest(text: string): boolean {
  return /\bflight\s+of\s+(two|three|four)|formation\s+(flight|clearance)|form\s+(up|on)|flying\s+(as\s+)?a\s+formation/.test(text.toLowerCase());
}

/**
 * Compose a formation flight clearance clause.
 * @param spokenCs Spoken callsign, e.g. "Southwest 1234"
 * @param count Number of aircraft in the formation (typically 2–4)
 * @returns ATC phraseology for a formation clearance, e.g.
 *   "Southwest 1234 flight of two, cleared as a flight, maintain visual separation within the formation."
 */
export function composeFormation(spokenCs: string, count: number): string {
  const COUNTS = ['', 'one', 'two', 'three', 'four', 'five'];
  const countWord = COUNTS[count] ?? String(count);
  return `${spokenCs} flight of ${countWord}, cleared as a flight, maintain visual separation within the formation.`;
}
