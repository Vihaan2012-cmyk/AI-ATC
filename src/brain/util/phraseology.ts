// Deterministic ATC phraseology helpers — the backbone of template-based NLG.
// (US-style "point" for frequencies; "niner" for 9.)

const NATO: Record<string, string> = {
  A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot',
  G: 'Golf', H: 'Hotel', I: 'India', J: 'Juliett', K: 'Kilo', L: 'Lima',
  M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo',
  S: 'Sierra', T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey', X: 'Xray',
  Y: 'Yankee', Z: 'Zulu',
};

const DIGIT: Record<string, string> = {
  '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
  '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'niner',
};

const AIRLINE: Record<string, string> = {
  SWA: 'Southwest', BAW: 'Speedbird', UAL: 'United', AAL: 'American',
  DAL: 'Delta', JBU: 'JetBlue', FFT: 'Frontier', NKS: 'Spirit', ASA: 'Alaska',
  ACA: 'Air Canada', UAE: 'Emirates', DLH: 'Lufthansa', AFR: 'Air France',
  KLM: 'KLM', RYR: 'Ryanair', EZY: 'Easy', QFA: 'Qantas', SIA: 'Singapore',
  QTR: 'Qatari', THY: 'Turkish', VIR: 'Virgin', WJA: 'Westjet', SKW: 'Skywest',
  AIC: 'Air India', IGO: 'IndiGo', VTI: 'Vistara', SEJ: 'Spicejet', AXB: 'Express India',
};

const DROP_WORDS = new Set([
  'INTL', 'INTERNATIONAL', 'INTERNATL', 'AIRPORT', 'RGNL', 'REGIONAL',
  'MUNI', 'MUNICIPAL', 'FIELD',
]);

/** "4517" -> "four five one seven" */
export function spokenDigits(s: string): string {
  return s.split('').map((c) => DIGIT[c] ?? c).join(' ');
}

/** "KSEA" -> "Kilo Sierra Echo Alpha"; mixed alnum handled too. */
export function phonetic(s: string): string {
  return s
    .toUpperCase()
    .split('')
    .map((c) => NATO[c] ?? DIGIT[c] ?? '')
    .filter((x) => x.length > 0)
    .join(' ');
}

/** 5000 -> "five thousand"; 11000 -> "one one thousand"; 24000 -> "flight level two four zero". */
export function spokenAltitude(ft: number): string {
  if (ft >= 18000) {
    const fl = Math.round(ft / 100).toString().padStart(3, '0');
    return `flight level ${spokenDigits(fl)}`;
  }
  const thousands = Math.floor(ft / 1000);
  const hundreds = Math.floor((ft % 1000) / 100);
  const parts: string[] = [];
  if (thousands > 0) parts.push(`${spokenDigits(String(thousands))} thousand`);
  if (hundreds > 0) parts.push(`${DIGIT[String(hundreds)] ?? String(hundreds)} hundred`);
  return parts.length > 0 ? parts.join(' ') : 'zero';
}

/**
 * Inverse of spokenAltitude: extract an altitude in feet from ATC text.
 * Handles "five thousand", "one one thousand", "flight level two four zero", and digits.
 * Returns null if no altitude phrase is found.
 */
export function parseSpokenAltitudeFt(text: string): number | null {
  const t = text.toLowerCase();
  // Flight level: "flight level two four zero" -> 24000
  const fl = t.match(/flight level ([a-z\s]+)/);
  if (fl && fl[1]) {
    const digits = wordsToDigits(fl[1]);
    if (digits.length >= 2) return parseInt(digits, 10) * 100;
  }
  // "<n> thousand [<m> hundred]"
  const thou = t.match(/([a-z\s]+?)\s*thousand(?:\s+([a-z\s]+?)\s*hundred)?/);
  if (thou) {
    const k = wordsToDigits(thou[1] ?? '');
    const h = thou[2] ? wordsToDigits(thou[2]) : '';
    const thousands = k ? parseInt(k, 10) : NaN;
    if (Number.isFinite(thousands)) return thousands * 1000 + (h ? parseInt(h, 10) * 100 : 0);
  }
  // Bare numeric like "3000" or "11000"
  const num = t.match(/\b(\d{3,5})\b/);
  if (num && num[1]) return parseInt(num[1], 10);
  return null;
}

const DIGIT_WORD: Record<string, string> = {
  zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4',
  five: '5', six: '6', seven: '7', eight: '8', nine: '9', niner: '9',
};
function wordsToDigits(s: string): string {
  return s.trim().split(/\s+/).map((w) => DIGIT_WORD[w] ?? (/^\d$/.test(w) ? w : '')).join('');
}

/** 121.7 -> "one two one point seven"; trailing zeros trimmed. */
export function spokenFreq(mhz: number): string {
  let s = mhz.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  if (!s.includes('.')) s += '.0';
  const parts = s.split('.');
  const intPart = parts[0] ?? '';
  const decPart = parts[1] ?? '';
  return `${spokenDigits(intPart)} point ${spokenDigits(decPart)}`;
}

const ORDINALS = [
  '', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh',
  'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth',
];

/** 1 -> "number one"; 2 -> "number two" ... used for landing/departure sequence. */
export function sequenceWord(n: number): string {
  const CARD = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'one one', 'one two'];
  return `number ${CARD[n] ?? String(n)}`;
}

/** 1 -> "first"; 2 -> "second" ... for "first in line for departure". */
export function ordinalWord(n: number): string {
  return ORDINALS[n] ?? `${n}th`;
}

/** "16R" -> "one six right"; "08" -> "zero eight". */
export function spokenRunway(rwy: string): string {
  const m = rwy.toUpperCase().trim().match(/^(\d{1,2})([LCR]?)$/);
  if (!m) return rwy;
  const num = (m[1] ?? '').padStart(2, '0');
  const side = m[2] ?? '';
  const sideWord = side === 'L' ? ' left' : side === 'C' ? ' center' : side === 'R' ? ' right' : '';
  return `${spokenDigits(num)}${sideWord}`;
}

/** "SWA1234" -> "Southwest one two three four"; "N512SR" -> phonetic tail. */
export function spokenCallsign(callsign: string, telephony?: string): string {
  if (telephony && telephony.trim().length > 0) return telephony;
  const cs = callsign.toUpperCase();
  const airline = cs.match(/^([A-Z]{3})(\d+[A-Z]?)$/);
  if (airline) {
    const code = airline[1] ?? '';
    const num = airline[2] ?? '';
    return `${AIRLINE[code] ?? phonetic(code)} ${spokenDigits(num)}`;
  }
  return phonetic(cs);
}

/** "SEATTLE TACOMA INTL" -> "Seattle Tacoma". Falls back to ICAO if no name. */
export function shortenAirportName(name: string | undefined, fallbackIcao: string): string {
  if (!name) return fallbackIcao;
  const words = name
    .split(/\s+/)
    .filter((w) => !DROP_WORDS.has(w.toUpperCase().replace(/[.,]/g, '')));
  const kept = words.length > 0 ? words : name.split(/\s+/);
  const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return kept
    .map((w) => w.split('-').map(titleCase).join('-')) // handle "Seattle-Tacoma"
    .join(' ');
}
