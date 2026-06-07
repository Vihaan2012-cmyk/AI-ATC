// Phonetic-alphabet + ATC number tolerance — deterministic speech normalization.
// Maps spoken ATC variants to standard digits and NATO alphabet to letters.
// Pure, self-contained; used by parsers to pre-normalize raw pilot/ATC input.

/**
 * Map of spoken ATC number variants to standard digits.
 * Handles non-standard pronunciations: "niner" vs "nine", "tree" vs "three", etc.
 */
const ATC_DIGIT_MAP: Record<string, string> = {
  // Standard pronunciations
  'zero': '0', 'oh': '0',
  'one': '1',
  'two': '2', 'to': '2', 'too': '2',
  'three': '3', 'tree': '3',
  'four': '4', 'fower': '4', 'fore': '4',
  'five': '5', 'fife': '5',
  'six': '6',
  'seven': '7',
  'eight': '8', 'ate': '8',
  'nine': '9', 'niner': '9',
};

/**
 * Map of NATO phonetic alphabet words (lower case) to letter.
 * Covers standard ICAO/FAA phonetic alphabet.
 */
const NATO_TO_LETTER: Record<string, string> = {
  'alpha': 'A', 'bravo': 'B', 'charlie': 'C', 'delta': 'D', 'echo': 'E',
  'foxtrot': 'F', 'golf': 'G', 'hotel': 'H', 'india': 'I', 'juliett': 'J',
  'juliet': 'J', // common alternate spelling
  'kilo': 'K', 'lima': 'L', 'mike': 'M', 'november': 'N', 'oscar': 'O',
  'papa': 'P', 'quebec': 'Q', 'romeo': 'R', 'sierra': 'S', 'tango': 'T',
  'uniform': 'U', 'victor': 'V', 'whiskey': 'W', 'whisky': 'W', // both spellings
  'xray': 'X', 'x-ray': 'X',
  'yankee': 'Y', 'zulu': 'Z',
};

/**
 * Normalize ATC speech input by mapping spoken variants to standard form.
 * - Converts ATC number variants ("niner" -> "nine", "tree" -> "three", etc.)
 * - Converts NATO phonetic alphabet words to letters ("alpha" -> "A", etc.)
 * - Preserves numeric digits as-is
 * - Case-insensitive input; letter output is uppercase
 *
 * Examples:
 *   normalizeAtcSpeech("niner") -> "nine"
 *   normalizeAtcSpeech("tree") -> "three"
 *   normalizeAtcSpeech("fife") -> "five"
 *   normalizeAtcSpeech("fower") -> "four"
 *   normalizeAtcSpeech("alpha") -> "A"
 *   normalizeAtcSpeech("bravo") -> "B"
 *   normalizeAtcSpeech("9") -> "9" (unchanged)
 */
export function normalizeAtcSpeech(text: string): string {
  const normalized: string[] = [];

  // Split on whitespace and punctuation, preserve structure
  const tokens = text.trim().split(/\s+/);

  for (const token of tokens) {
    const lower = token.toLowerCase();

    // Try ATC digit first
    if (ATC_DIGIT_MAP[lower]) {
      normalized.push(ATC_DIGIT_MAP[lower]);
      continue;
    }

    // Try NATO phonetic
    if (NATO_TO_LETTER[lower]) {
      normalized.push(NATO_TO_LETTER[lower]);
      continue;
    }

    // If it's already a digit or letter, keep as-is (uppercase if letter)
    if (/^\d+$/.test(token)) {
      normalized.push(token);
    } else if (/^[a-zA-Z]+$/.test(token)) {
      normalized.push(token.toUpperCase());
    } else {
      // Non-alphanumeric; skip or keep depending on context
      // For ATC, typically we skip punctuation
    }
  }

  return normalized.join(' ');
}

/**
 * Convert a string containing mixed spoken numbers and NATO words to normalized digits and letters.
 * Like normalizeAtcSpeech, but optimized for rapid parsing of callsigns, squawks, and idents.
 * Returns just the alphanumeric output without spaces.
 *
 * Examples:
 *   normalizeAtcIdent("alpha bravo charlie 1 2 3") -> "ABC123"
 *   normalizeAtcIdent("niner niner niner niner") -> "9999"
 */
export function normalizeAtcIdent(text: string): string {
  return normalizeAtcSpeech(text).replace(/\s+/g, '');
}

/**
 * Convenience: check if a word is a known ATC digit variant.
 */
export function isAtcDigitWord(word: string): boolean {
  return word.toLowerCase() in ATC_DIGIT_MAP;
}

/**
 * Convenience: check if a word is a known NATO phonetic word.
 */
export function isNatoWord(word: string): boolean {
  return word.toLowerCase() in NATO_TO_LETTER;
}
