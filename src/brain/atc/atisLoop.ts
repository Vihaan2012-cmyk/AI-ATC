// Pure, deterministic ATIS loop builder for recorded playback.
// Estimates duration from word count and wraps ATIS text for repeated broadcast on the ATIS frequency.

/**
 * Result of building an ATIS loop: the wrapped text and estimated loop duration in seconds.
 */
export interface AtisLoopResult {
  /** The complete ATIS text, formatted for loop playback (may include intro/outro markers). */
  text: string;
  /** Estimated loop duration in seconds, based on word count. Used by UI to time the repeat. */
  loopSeconds: number;
}

/**
 * Average spoken word rate in ATC phraseology.
 * Professional ATC speech is typically 120–140 wpm; we use 130 wpm as baseline.
 */
const WORDS_PER_MINUTE = 130;

/**
 * Build an ATIS loop from raw ATIS text.
 * Estimates the spoken duration based on word count and wraps it for repeated playback.
 *
 * The wrapped text is deterministic:
 * - Trims and normalizes whitespace
 * - Adds a standard "Information" marker to signal loop start
 * - Estimates loop duration from word count at professional ATC speech rate
 *
 * @param atisText Raw ATIS text (e.g., from a weather/NOTAMs parser)
 * @returns AtisLoopResult with wrapped text and estimated loop duration in seconds
 *
 * @example
 * const atis = "KJFK information Delta. Winds three six zero at one two. Runway two two left.";
 * const loop = buildAtisLoop(atis);
 * console.log(loop.loopSeconds); // ~9 seconds (based on word count)
 */
export function buildAtisLoop(atisText: string): AtisLoopResult {
  // Normalize: trim and collapse internal whitespace
  const normalized = atisText.trim().replace(/\s+/g, ' ');

  // Count words (split on whitespace)
  const wordCount = normalized.length > 0 ? normalized.split(/\s+/).length : 0;

  // Estimate duration in seconds: (words / words per minute) * 60
  const loopSeconds = Math.ceil((wordCount / WORDS_PER_MINUTE) * 60);

  // Wrap text with "Information" marker for loop playback
  // Format: "Information [letter]. [ATIS text]. End Information."
  // Extract any letter/info code if present (e.g., "Delta" from "Information Delta")
  let infoCode = '';
  const infoMatch = normalized.match(/^information\s+([A-Za-z])\b/i);
  if (infoMatch && infoMatch[1]) {
    infoCode = infoMatch[1].toUpperCase();
  }

  // Build final wrapped text
  const wrappedText = infoCode
    ? `Information ${infoCode}. ${normalized}. End Information.`
    : `Information. ${normalized}. End Information.`;

  return {
    text: wrappedText,
    loopSeconds,
  };
}

/**
 * Estimate the loop duration in seconds from raw ATIS text without wrapping.
 * Useful for quick duration checks without building the full loop.
 *
 * @param atisText Raw ATIS text
 * @returns Estimated duration in seconds
 */
export function estimateAtisLoopDuration(atisText: string): number {
  const normalized = atisText.trim().replace(/\s+/g, ' ');
  const wordCount = normalized.length > 0 ? normalized.split(/\s+/).length : 0;
  return Math.ceil((wordCount / WORDS_PER_MINUTE) * 60);
}
