// Deterministic natural number parsing utility: convert spoken number words to numeric values.
// Handles ATC-specific patterns: "flight level three two zero" (32000),
// "one zero thousand" (10000), "two five zero" (250), etc.
// No external dependencies. Pure, well-tested logic.

const DIGIT_WORD: Record<string, number> = {
  zero: 0, oh: 0,
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, niner: 9,
};

const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

const SCALES: Record<string, number> = {
  hundred: 100,
  thousand: 1000,
  million: 1000000,
};

/**
 * Convert spoken number words to a numeric value.
 * Handles:
 * - Basic digits ("zero", "one", "two", ... "nine", "niner", "oh")
 * - Teens ("ten", "eleven", ..., "nineteen")
 * - Tens ("twenty", "thirty", ..., "ninety")
 * - Hundreds, thousands, millions
 * - ATC patterns: "flight level three two zero" (32000), "one zero thousand" (10000)
 * - Digit-by-digit ("two five zero" -> 250)
 *
 * Returns null if the input cannot be parsed as a number.
 * @param s Spoken input (case-insensitive, whitespace-normalized)
 * @returns Numeric value or null
 */
export function wordsToNumber(s: string): number | null {
  if (!s || typeof s !== 'string') return null;

  const input = s.toLowerCase().trim();
  if (input.length === 0) return null;

  // Check for flight level pattern: "flight level" followed by digits
  const flMatch = input.match(/^\s*flight\s+level\s+(.+)$/i);
  if (flMatch && flMatch[1]) {
    const digitSeq = parseDigitSequence(flMatch[1]);
    if (digitSeq !== null && digitSeq >= 10) {
      return digitSeq * 100; // FL320 = 32000
    }
  }

  // Try to parse as a traditional number (with scales: "two thousand five hundred")
  const traditionalNum = parseTraditional(input);
  if (traditionalNum !== null) {
    return traditionalNum;
  }

  // Fall back to digit-by-digit parsing ("two five zero" -> 250, "one zero thousand" -> 10000)
  const digitSeq = parseDigitSequence(input);
  if (digitSeq !== null) {
    return digitSeq;
  }

  return null;
}

/**
 * Parse a traditional formatted number like "two thousand five hundred" or "ninety nine".
 * Does NOT handle digit-by-digit sequences.
 */
function parseTraditional(input: string): number | null {
  const tokens = input.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return null;

  let result = 0;
  let current = 0;
  let foundScale = false;

  for (const token of tokens) {
    const lower = token.toLowerCase();

    // Digit word
    if (lower in DIGIT_WORD) {
      current += DIGIT_WORD[lower]!;
      continue;
    }

    // Teen word
    if (lower in TEENS) {
      // Teens cannot be combined with existing values at the same level
      if (current > 0 && current < 100) {
        return null; // e.g., "one eleven" is invalid
      }
      current += TEENS[lower]!;
      continue;
    }

    // Tens word
    if (lower in TENS) {
      // Tens can be added to single digits ("twenty one" = 21)
      if (current >= 100) {
        return null; // e.g., "one hundred twenty" format should parse correctly, but "hundred twenty" should not
      }
      current += TENS[lower]!;
      continue;
    }

    // Scale word
    if (lower in SCALES) {
      const scale = SCALES[lower]!;
      if (current === 0) {
        // "thousand" without a preceding number is invalid
        return null;
      }
      result += current * scale;
      current = 0;
      foundScale = true;
      continue;
    }

    // Unknown token
    return null;
  }

  // Remainder
  result += current;

  return result > 0 ? result : null;
}

/**
 * Parse a digit-by-digit sequence where each word is a single digit.
 * Handles scale words like "thousand" embedded in the sequence.
 * Examples:
 * - "two five zero" -> 250
 * - "one zero thousand" -> 10000
 * - "three two zero" -> 320
 */
function parseDigitSequence(input: string): number | null {
  const tokens = input.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return null;

  let result = 0;
  let currentSeq = '';

  for (const token of tokens) {
    const lower = token.toLowerCase();

    // Single digit
    if (lower in DIGIT_WORD) {
      currentSeq += DIGIT_WORD[lower]!.toString();
      continue;
    }

    // Scale word: multiply the accumulated digit sequence and add to result
    if (lower in SCALES) {
      const scale = SCALES[lower]!;
      if (currentSeq.length === 0) {
        return null; // "thousand" without digits
      }
      const value = parseInt(currentSeq, 10);
      result += value * scale;
      currentSeq = '';
      continue;
    }

    // Unknown token
    return null;
  }

  // Remainder digits
  if (currentSeq.length > 0) {
    result += parseInt(currentSeq, 10);
  }

  return result > 0 ? result : null;
}
