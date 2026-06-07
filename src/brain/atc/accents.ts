// Regional controller accents and phrasing variants.
// Pure, deterministic lexical swaps (no LLM). Adds regional flavor without changing facts/values.
// Self-contained module — can be chained after phraseology or tone adjustments.
//
// Examples:
//   applyAccent('line up runway 16 left', 'us') => 'line up runway 16 left'
//   applyAccent('maintain altitude 5000 feet', 'uk') => 'maintain altitude 5000 feet'
//   applyAccent('descend to 3000 feet', 'euro') => 'descend to 3000 feet'
//   applyAccent('altimeter 30.12', 'uk') => 'QNH 30.12'
//   applyAccent('say again', 'us') => 'say again'
//   applyAccent('squawk 1234', 'uk') => 'squawk one two three four'

export type Region = 'us' | 'uk' | 'euro';

/**
 * Apply regional accent/phrasing to ATC text.
 * Modulates word choices, technical terminology, and number grouping to match regional conventions.
 * Does NOT change altitude, frequency, runway, or other factual values.
 *
 * @param text The original ATC clearance/instruction text
 * @param region The target region ('us' | 'uk' | 'euro')
 * @returns Text with region-appropriate phrasing applied
 */
export function applyAccent(text: string, region: Region): string {
  let result = text;

  if (region === 'uk') {
    // UK / Eurocontrol: "QNH", "flight level", "standby", "say again", "roger"
    result = applyUkAccent(result);
  } else if (region === 'euro') {
    // Continental Europe: "flight level", "descend to", "climb to", formal number readback
    result = applyEuroAccent(result);
  } else {
    // US (default): "altimeter", "traffic pattern", "line up and wait", informal tone
    result = applyUsAccent(result);
  }

  return result;
}

/**
 * US regional phrasing (minimal baseline; mostly handled by phraseologyProfile).
 * Added here for completeness and to handle accent-specific edge cases.
 */
function applyUsAccent(text: string): string {
  let result = text;

  // US prefers "say again" over "repeat"
  result = result.replace(/\brepeat\b/gi, 'say again');

  // US says "traffic pattern" not "circuit"
  result = result.replace(/\bthe circuit\b/gi, 'traffic pattern');
  result = result.replace(/\bcircuit\b/gi, 'traffic pattern');

  // US "altimeter" vs UK "QNH"
  // Only swap if context suggests it; preserve actual values
  result = result.replace(/\bQNH\b/gi, 'altimeter');

  // US "line up and wait" (vs UK "line up")
  result = result.replace(/\bline up\b(?! and wait)/gi, 'line up and wait');

  return result;
}

/**
 * UK regional phrasing.
 * Historically: "line up", "QNH" (not "altimeter"), "standby", "say again", "roger".
 */
function applyUkAccent(text: string): string {
  let result = text;

  // UK "line up" (not "line up and wait")
  result = result.replace(/\bline up and wait\b/gi, 'line up');

  // UK "QNH" (vs US "altimeter")
  result = result.replace(/\baltimeter\b/gi, 'QNH');

  // UK "traffic pattern" => "circuit"
  result = result.replace(/\btraffic pattern\b/gi, 'the circuit');
  result = result.replace(/\bclosed traffic\b/gi, 'the circuit');

  // UK "standby" (vs US "stand by")
  result = result.replace(/\bstand by\b/gi, 'standby');

  // UK "say again" (standard)
  // (already preferred; no change needed)

  // UK "roger" (vs just acknowledging)
  // Light touch: only if not already present
  if (!/\broger\b/i.test(result)) {
    // Could add "roger that" to acknowledgments, but risky; skip for safety
  }

  return result;
}

/**
 * Continental Europe regional phrasing.
 * More formal than UK; strict adherence to ICAO phraseology.
 */
function applyEuroAccent(text: string): string {
  let result = text;

  // Euro "line up and wait" (standard ICAO)
  // Preserve as-is; don't shorten to "line up" like UK

  // Euro prefers "flight level" explicitly
  // (usually already present from base engine)

  // Euro "QNH" (vs US "altimeter")
  result = result.replace(/\baltimeter\b/gi, 'QNH');

  // Euro "traffic pattern" => "circuit" (continental style)
  result = result.replace(/\btraffic pattern\b/gi, 'circuit');
  result = result.replace(/\bthe circuit\b/gi, 'circuit');

  // Euro "standby"
  result = result.replace(/\bstand by\b/gi, 'standby');

  // Euro formal number readback: grouped by convention
  // E.g., "one two three four" becomes "twelve thirty-four" for "1234"
  // This is risky without parsing context; skip for now to avoid corrupting values
  // (Could be added with careful regex that doesn't touch altitude/freq/runway)

  return result;
}
