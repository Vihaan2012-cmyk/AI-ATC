// Dynamic ATC controller personality: modulates communication tone based on workload.
// Pure, deterministic function — busier skies = terser; quiet skies = chattier.
// Self-contained module. Intended to be called by session.ts or reply handlers
// before returning a Reply to the pilot.

/**
 * Determines the controller's tone based on traffic workload and transmission frequency.
 *
 * @param trafficCount Number of active aircraft in the vicinity (e.g., from liveTraffic.nearby.length)
 * @param msSinceLastTx Milliseconds since the controller's last transmission to the pilot
 * @returns Tone keyword: 'terse' (busy), 'standard' (normal), 'chatty' (quiet)
 *
 * Logic:
 * - High traffic (>= 4) or frequent transmissions (<30s) => 'terse' (drop pleasantries)
 * - Low traffic (<= 1) and infrequent transmissions (>180s) => 'chatty' (add warmth)
 * - Otherwise => 'standard' (professional, neutral)
 */
export function pickTone(
  trafficCount: number,
  msSinceLastTx: number,
): 'terse' | 'standard' | 'chatty' {
  // Busy conditions: high traffic or rapid-fire communications
  if (trafficCount >= 4 || msSinceLastTx < 30_000) {
    return 'terse';
  }

  // Quiet conditions: low traffic and long gaps between transmissions
  if (trafficCount <= 1 && msSinceLastTx > 180_000) {
    return 'chatty';
  }

  // Default: standard professional tone
  return 'standard';
}

/**
 * Lightly adjusts reply text to match the controller's tone.
 * Does NOT change meaning or critical information — only adds/removes soft touches.
 *
 * Terse removes:
 * - "good day"
 * - "thank you"
 * - "roger that"
 * - Greeting preambles
 *
 * Chatty adds:
 * - "good day" at handoff (if not present)
 * - Slightly warmer phrasing ("have a good flight" vs. bare handoff)
 *
 * Standard:
 * - Leaves text as-is (baseline ATC phrasing)
 *
 * @param text Original controller reply text
 * @param tone The personality tone to apply
 * @returns Adjusted text (same meaning, different warmth)
 */
export function toneAdjust(text: string, tone: 'terse' | 'standard' | 'chatty'): string {
  if (tone === 'standard') {
    return text;
  }

  if (tone === 'terse') {
    // Strip soft closings and greetings for speed
    let result = text
      .replace(/,?\s*good day\.?/gi, '.')
      .replace(/thank you,?\s*/gi, '')
      .replace(/roger that[,.]?\s*/gi, '')
      .replace(/well,\s*/gi, '')
      .replace(/ok,\s*/gi, '')
      .trim();
    // Ensure sentence ends with period if needed
    if (result && !result.endsWith('.')) {
      result += '.';
    }
    return result;
  }

  if (tone === 'chatty') {
    // Warm up the tone by adding/enhancing pleasantries
    // Add "good day" to handoff messages that mention next station
    if (/contact|frequency|approach|departure|center|tower|ground/i.test(text) && !/good day/i.test(text)) {
      // Insert before final period or at end
      const match = text.match(/(.+)\.?$/);
      if (match) {
        return `${match[1]}, good day.`;
      }
    }
    // Enhance generic clears with a touch more humanity
    if (/cleared to land|cleared for takeoff|cleared for the option/i.test(text)) {
      text = text.replace(/cleared (to land|for takeoff|for the option)/i, 'You\'re cleared $1');
    }
    return text;
  }

  return text;
}
