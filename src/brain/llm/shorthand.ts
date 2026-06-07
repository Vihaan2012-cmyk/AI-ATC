// Pilot shorthand expansion — compress radio phrasing to fuller forms.
// Pure deterministic expansion; pilots use abbreviated check-ins, altitude callouts, etc.
// Feed output to NLU (parseIntent). Handles ATC-style digit-by-digit altitudes.

/**
 * Expand compressed pilot phrasing to fuller forms for downstream NLU.
 * Examples:
 *   "with you 10 thousand" -> "with you at 10 thousand feet"
 *   "passing 5 for 10" -> "passing 5 thousand for 10 thousand feet"
 *   "ready" (near a runway) -> stays "ready"
 *   "roger" -> stays as-is (not expanded)
 *
 * @param text Pilot transmission (raw, compressed)
 * @returns Expanded text ready for NLU/LLM processing
 */
export function expandShorthand(text: string): string {
  if (!text || typeof text !== 'string') return text;

  let result = text;

  // 1. Expand altitude check-ins: "with you <altitude>"
  //    "with you 10 thousand" -> "with you at 10 thousand feet"
  result = result.replace(
    /\bwith\s+you\s+(\w+(?:\s+\w+)*)\b/gi,
    (_match, alt: string) => {
      const expanded = expandAltitude(alt);
      return `with you at ${expanded}`;
    },
  );

  // 2. Expand level transitions: "passing <from> for <to>"
  //    "passing 5 for 10" -> "passing 5 thousand feet for 10 thousand feet"
  //    "passing five thousand for one zero thousand" stays as-is (already expanded)
  result = result.replace(
    /\bpassing\s+(\w+(?:\s+\w+)?(?:\s+thousand)?(?:\s+hundred)?)\s+for\s+(\w+(?:\s+\w+)?(?:\s+thousand)?(?:\s+hundred)?)\b/gi,
    (_match, from: string, to: string) => {
      const fromExp = expandAltitude(from);
      const toExp = expandAltitude(to);
      return `passing ${fromExp} for ${toExp}`;
    },
  );

  // 3. Expand simple altitude reports: "request <altitude>", "cleared <altitude>"
  //    "request 8 thousand" -> "request 8 thousand feet"
  result = result.replace(
    /\b(request|cleared|climb to|descend to|altitude)\s+(\w+(?:\s+\w+)?(?:\s+thousand)?(?:\s+hundred)?)\b/gi,
    (_match, prefix: string, alt: string) => {
      const expanded = expandAltitude(alt);
      return `${prefix} ${expanded}`;
    },
  );

  // 4. Expand frequency readbacks: "one two one point five" -> "one two one point five mhz" or similar
  //    Pattern: digit digit digit point/decimal digit digit?
  result = result.replace(
    /\b(one|two|three|four|five|six|seven|eight|nine|niner|zero)\s+(one|two|three|four|five|six|seven|eight|nine|niner|zero)\s+(one|two|three|four|five|six|seven|eight|nine|niner|zero)\s+(point|decimal)\s+(\w+)\b(?!\s*(?:mhz|megahertz))/gi,
    (_match) => {
      // If already has "mhz" or "megahertz", don't add it again
      return _match + ' mhz';
    },
  );

  // 5. Expand direction/vector prefixes: "heading <heading>"
  //    "heading 180" -> "heading one eight zero" (if numeric)
  result = result.replace(
    /\bheading\s+(\d{1,3})\b/gi,
    (_match, heading: string) => {
      return `heading ${digitsByDigit(heading)}`;
    },
  );

  // 6. Expand speed shorthand (e.g., "one five zero" or bare "150") in speed context
  //    This is tricky without semantic context, so we only expand if preceded by "speed" or "maintain"
  result = result.replace(
    /\b(speed|maintain|reduce\s+speed\s+to|increase\s+speed\s+to)\s+(\d{1,3})\b/gi,
    (_match, prefix: string, speed: string) => {
      return `${prefix} ${digitsByDigit(speed)} knots`;
    },
  );

  // 7. Expand runway readbacks: bare "16 right" -> "runway 16 right"
  //    Only if preceded by "runway", "line up", "cleared", "taxi to", etc.
  result = result.replace(
    /\b(runway|lined?\s+up\s+on|taking off|on|use|back course)\s+(\d{2})\s*(left|center|right)?\b/gi,
    (_match, prefix: string, num: string, side: string | undefined) => {
      const sideStr = side ? ` ${side}` : '';
      const runwayStr = `${digitsByDigit(num.padStart(2, '0'))}${sideStr}`;
      return `${prefix} ${runwayStr}`;
    },
  );

  return result;
}

/**
 * Helper: expand a single altitude phrase.
 * Input: "5", "10", "5 thousand", "one zero thousand", "flight level 320", etc.
 * Output: "5 thousand feet", "10 thousand feet", "flight level 320", etc.
 * Already expanded inputs (e.g., "5 thousand feet") pass through.
 */
function expandAltitude(altText: string): string {
  if (!altText || typeof altText !== 'string') return altText;

  const t = altText.trim();
  if (t.length === 0) return t;

  // If already says "feet" or "flight level", it's expanded; return as-is
  if (/\bfeet|flight\s+level/i.test(t)) {
    return t;
  }

  // If it ends with "thousand" or "hundred", append "feet"
  if (/\b(thousand|hundred)\b/i.test(t)) {
    return `${t} feet`;
  }

  // If it's a bare number (e.g., "5"), assume thousands and add "thousand feet"
  if (/^\d+$/.test(t)) {
    return `${t} thousand feet`;
  }

  // Digit-by-digit like "one zero" without "thousand" -> "one zero thousand feet"
  // Check if all words are digit-words
  const isAllDigits = /^(zero|one|two|three|four|five|six|seven|eight|nine|niner|oh)(?:\s+(zero|one|two|three|four|five|six|seven|eight|nine|niner|oh))*$/i.test(t);
  if (isAllDigits) {
    return `${t} thousand feet`;
  }

  // Otherwise, return unchanged
  return t;
}

/**
 * Helper: convert a numeric string to digit-by-digit spelling.
 * E.g., "180" -> "one eight zero", "16" -> "one six".
 */
function digitsByDigit(numStr: string): string {
  const DIGIT: Record<string, string> = {
    '0': 'zero',
    '1': 'one',
    '2': 'two',
    '3': 'three',
    '4': 'four',
    '5': 'five',
    '6': 'six',
    '7': 'seven',
    '8': 'eight',
    '9': 'niner',
  };
  return numStr
    .split('')
    .map((c) => DIGIT[c] ?? c)
    .join(' ');
}
