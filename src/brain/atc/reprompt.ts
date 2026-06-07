// Confidence-driven re-prompts: when the NLU is unsure, ask a clarifying question.
// Deterministic — no LLM. Helps the pilot confirm or rephrase their intent.

import { spokenCallsign } from '../util/phraseology.js';
import type { PilotIntentType } from '../types.js';

/**
 * Decide whether to ask for clarification based on confidence score.
 * @param confidence 0..1 from the NLU parse (parseIntent)
 * @param threshold optional confidence threshold (default 0.6); below this, ask for clarification
 * @returns true if a clarification question should be issued
 */
export function needsClarification(confidence: number, threshold?: number): boolean {
  const floor = threshold ?? 0.6;
  return confidence < floor;
}

/**
 * Compose a targeted clarification question.
 * @param spokenCallsign e.g. "Southwest 1234"
 * @param guessIntent optional intent guess to anchor the question (e.g. "request_taxi")
 * @returns a natural phrasing like "Southwest 1234, say again your request" or "Southwest 1234, confirm you are requesting lower?"
 */
export function composeClarify(spokenCs: string, guessIntent?: PilotIntentType): string {
  const cs = spokenCs.trim();
  if (!cs) return 'Say again your request.';

  // Generic fallback for truly unknown intents
  if (!guessIntent || guessIntent === 'unknown') {
    return `${cs}, say again your request.`;
  }

  // Specific targets for common low-confidence scenarios
  switch (guessIntent) {
    case 'request_ifr_clearance':
      return `${cs}, confirm you are requesting IFR clearance.`;
    case 'request_pushback':
      return `${cs}, confirm you are requesting pushback.`;
    case 'request_taxi':
      return `${cs}, confirm you are requesting taxi.`;
    case 'ready_for_departure':
      return `${cs}, confirm ready for takeoff.`;
    case 'go_around':
      return `${cs}, confirm you are going around.`;
    case 'request_flight_following':
      return `${cs}, confirm you are requesting flight following.`;
    case 'request_pattern':
      return `${cs}, confirm you want to remain in the pattern.`;
    case 'touch_and_go':
      return `${cs}, confirm you want to do a touch and go.`;
    case 'full_stop':
      return `${cs}, confirm landing to a full stop.`;
    case 'request_hold':
      return `${cs}, confirm you want to hold.`;
    case 'ready_with_traffic':
      return `${cs}, confirm traffic in sight.`;
    case 'readback':
      return `${cs}, I did not copy your readback; say again.`;
    default:
      // Fallback for any unexpected intent
      return `${cs}, say again your request.`;
  }
}
