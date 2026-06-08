// Phraseology hints: when the pilot fumbles a call, inline-suggest the CORRECT phraseology.
//
// HYBRID-friendly and PURE/deterministic: this never invents facts and never calls the LLM. It
// only looks at the raw pilot text, the already-parsed intent + confidence (from the NLU /
// reprompt.ts pipeline), and the difficulty setting, then composes a gentle "try: '<correct call>'"
// coaching line. The engine still owns what actually happens; this is a learning overlay on top.
//
// Gating: hints are a training aid, so they are ON in 'casual' difficulty and OFF in 'realistic'
// (a real controller would not coach you on the radio). The caller decides difficulty and can map
// any existing config to it (e.g. deepRealism -> 'realistic').

import type { PilotIntent, PilotIntentType } from '../types.js';

/** Training difficulty. Hints are shown in 'casual' and suppressed in 'realistic'. */
export type Difficulty = 'casual' | 'realistic';

/** A composed phraseology hint, ready to surface as a coaching note in the widget. */
export interface PhraseologyHint {
  /** The canonical example call the pilot should have made, e.g. "Ground, N512SR, ready to taxi". */
  suggestion: string;
  /** A short, full coaching line wrapping the suggestion, e.g. "Tip - try: \"...\"". */
  text: string;
  /** Why the hint fired: 'low_confidence' (ATC was unsure) or 'malformed' (call shape is off). */
  reason: 'low_confidence' | 'malformed';
}

/**
 * Confidence at/under this is treated as a fumbled call worth coaching. Mirrors reprompt.ts's
 * default clarification floor (0.6) so a hint pairs naturally with a "say again" reprompt.
 */
const LOW_CONFIDENCE_FLOOR = 0.6;

// Canonical "correct call" templates per intent. Kept generic (no invented facts like specific
// runways/altitudes) — `{cs}` is replaced with the pilot's spoken/written callsign when known, or
// dropped cleanly when it is not. These follow standard US-style pilot phraseology.
const CORRECT_CALL: Record<PilotIntentType, string> = {
  request_ifr_clearance: 'Delivery, {cs}, IFR to destination, ready to copy.',
  request_pushback: 'Ground, {cs}, request push and start.',
  request_taxi: 'Ground, {cs}, ready to taxi with information {atis}.',
  ready_for_departure: 'Tower, {cs}, holding short, ready for departure.',
  ready_with_traffic: '{cs}, traffic in sight.',
  go_around: 'Tower, {cs}, going around.',
  request_flight_following: 'Approach, {cs}, request VFR flight following.',
  request_pattern: 'Tower, {cs}, request closed traffic.',
  touch_and_go: 'Tower, {cs}, request touch and go.',
  full_stop: 'Tower, {cs}, full stop.',
  request_hold: '{cs}, request holding instructions.',
  readback: '{cs}, <read back the assigned altitude, heading, and squawk>.',
  unknown: '<station>, {cs}, <your request>.',
};

/**
 * Fill a correct-call template with the callsign (and an ATIS letter placeholder when relevant),
 * then tidy spacing/punctuation so dropped slots never leave stray commas or double spaces.
 */
function fill(template: string, spokenCs: string, atisInfo: string | null): string {
  const cs = spokenCs.trim();
  let out = template;
  // Callsign: substitute, or remove the slot together with an adjacent comma if unknown.
  out = cs ? out.replace(/\{cs\}/g, cs) : out.replace(/\{cs\},?\s*/g, '');
  // ATIS letter: use the parsed letter if present, otherwise leave a clear placeholder.
  out = out.replace(/\{atis\}/g, atisInfo && atisInfo.length === 1 ? atisInfo.toUpperCase() : 'X');
  // Tidy: collapse repeated spaces and fix a leading ", " left by a dropped callsign slot.
  out = out.replace(/\s{2,}/g, ' ').replace(/^([A-Za-z]+),\s*,/, '$1,').trim();
  return out;
}

/**
 * Heuristic: does this raw transmission look malformed for a radio call, independent of confidence?
 * Pure + deterministic. We flag calls that are too short to carry a request, that read like prose
 * rather than phraseology ("um", "can you", "I want", "please"), or that omit a callsign entirely
 * on a non-trivial transmission. This catches fumbles the NLU still classified with high confidence.
 */
export function looksMalformed(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return true;
  const words = t.split(/\s+/);
  // Very short, e.g. "taxi" or "push" — understandable but not a complete, proper call.
  if (words.length <= 2) return true;
  // Conversational filler / non-standard request framing.
  if (/\b(um+|uh+|er+|like|please|can you|could you|i (?:want|need|wanna|would like)|hey|hi there|sorry)\b/i.test(t)) {
    return true;
  }
  // No callsign-shaped token at all on a longer transmission (airline+number or N-tail or phonetics).
  // Spoken telephony spells the airline out ("Southwest 1234"), so accept a word immediately
  // followed by a flight number, the ICAO+number form ("SWA1234"), an N-tail, or spelled phonetics.
  const hasCallsignShape =
    /\b[A-Za-z]{2,}\s+\d{1,4}\b/.test(t) ||            // "Southwest 1234" / "Cessna 172"
    /\b[A-Za-z]{2,3}\d{1,4}[A-Za-z]?\b/.test(t) ||     // SWA1234 (ICAO + number, no space)
    /\bN\s*\d/i.test(t) ||                              // N512SR
    /\b(november|alpha|bravo|charlie|delta|echo|foxtrot|tail)\b/i.test(t);
  if (words.length >= 4 && !hasCallsignShape) return true;
  return false;
}

/**
 * Decide whether a phraseology hint should be offered for this transmission.
 * Returns false immediately on 'realistic' difficulty (gated off). Otherwise fires when the NLU
 * was not confident OR the raw text looks malformed.
 *
 * @param difficulty 'casual' (hints on) or 'realistic' (hints off)
 * @param intent the parsed PilotIntent (carries confidence + intent type)
 * @param rawText the original pilot transmission
 * @param floor optional confidence floor (default 0.6; matches reprompt.ts)
 */
export function shouldHint(
  difficulty: Difficulty,
  intent: PilotIntent,
  rawText: string,
  floor: number = LOW_CONFIDENCE_FLOOR,
): boolean {
  if (difficulty !== 'casual') return false;
  if (!rawText || rawText.trim().length === 0) return false;
  return intent.confidence < floor || looksMalformed(rawText);
}

/**
 * Compose a phraseology hint for a fumbled call, or null when none is warranted.
 *
 * Pure + deterministic. Pairs naturally with reprompt.ts: ATC asks "say again", and (in casual
 * mode) this adds a gentle example of the correct call. Never overrides the engine's reply — it is
 * a separate coaching line the caller surfaces alongside the ATC transmission.
 *
 * Examples:
 *  - casual, low-confidence taxi:
 *      composeHint('casual', {intent:'request_taxi', confidence:0.4, ...}, 'taxi', 'N512SR')
 *      -> { suggestion: 'Ground, N512SR, ready to taxi with information X.',
 *           text: 'Tip - try: "Ground, N512SR, ready to taxi with information X."', reason: 'malformed' }
 *  - realistic difficulty: returns null (hints suppressed).
 *
 * @param difficulty 'casual' (hints on) or 'realistic' (hints off)
 * @param intent the parsed PilotIntent (confidence + intent type)
 * @param rawText the original pilot transmission
 * @param spokenCs the pilot's spoken/written callsign, e.g. "N512SR" or "Southwest 1234" (optional)
 * @param floor optional confidence floor (default 0.6)
 * @returns a PhraseologyHint, or null if no hint should be shown
 */
export function composeHint(
  difficulty: Difficulty,
  intent: PilotIntent,
  rawText: string,
  spokenCs: string = '',
  floor: number = LOW_CONFIDENCE_FLOOR,
): PhraseologyHint | null {
  if (!shouldHint(difficulty, intent, rawText, floor)) return null;

  const template = CORRECT_CALL[intent.intent] ?? CORRECT_CALL.unknown;
  const suggestion = fill(template, spokenCs, intent.atisInfo);
  // Distinguish the trigger so the UI can phrase it (low confidence vs. an obviously off-shape call).
  const reason: PhraseologyHint['reason'] =
    intent.confidence < floor ? 'low_confidence' : 'malformed';

  return {
    suggestion,
    text: `Tip - try: "${suggestion}"`,
    reason,
  };
}
