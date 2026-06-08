// Real tunable ATIS audio loop. Builds on atisLoop.ts.
//
// Produces the spoken ATIS broadcast string (TTS-ready) plus the current letter code, and gates
// clearance acceptance on the current ATIS letter: a pilot reporting "information Bravo" is rejected
// when the current broadcast is "Charlie", and is told the correct code to obtain.
//
// HYBRID rule: this module owns the FACTS (the current letter, the gating decision, the spoken text).
// The LLM is never used here. The widget plays the resulting text via the existing TTS path.
//
// Pure & deterministic. The only external input that varies is the supplied current letter / weather,
// which the caller (session) already derives deterministically (see Session.atisLetter()).

import { buildAtisLoop, type AtisLoopResult } from './atisLoop.js';
import { phonetic } from '../util/phraseology.js';
import { normalizeVariants } from '../util/phonetic.js';

/** NATO phonetic word for a single A–Z letter, e.g. "C" -> "Charlie". */
export function letterToPhonetic(letter: string): string {
  const ch = (letter ?? '').trim().charAt(0).toUpperCase();
  if (!/^[A-Z]$/.test(ch)) return '';
  // phonetic() handles a single letter cleanly ("C" -> "Charlie").
  return phonetic(ch);
}

/** One weather/runway field for the ATIS body. Caller supplies pre-spoken phrases. */
export interface AtisFields {
  /** Airport name as spoken, e.g. "Seattle Tacoma". */
  airportName: string;
  /** Spoken wind phrase, e.g. "wind two four zero at one zero knots" (omit if calm/unknown). */
  wind?: string;
  /** Spoken visibility phrase, e.g. "visibility one zero statute miles". */
  visibility?: string;
  /** Spoken sky/cloud phrase, e.g. "broken clouds at three thousand feet". */
  sky?: string;
  /** Spoken temperature/dew point phrase, e.g. "temperature one five, dew point one zero". */
  temperature?: string;
  /** Altimeter setting digits as spoken, e.g. "two niner niner two" (no "altimeter" prefix). */
  altimeter?: string;
  /** Active runway label(s), e.g. "16R" or "16L, 16C". Composed into a landing/departing line. */
  activeRunway?: string;
  /** Optional NOTAM / remarks sentence(s), already spoken-formatted, no trailing period required. */
  remarks?: string;
  /** Optional UTC observation time as 4 digits, e.g. "1853" -> "one eight five three Zulu". */
  observationZ?: string;
}

/** Result of composing the ATIS broadcast. */
export interface AtisBroadcast {
  /** The single-letter code, uppercased, e.g. "C". */
  code: string;
  /** NATO word for the code, e.g. "Charlie". */
  phoneticCode: string;
  /** TTS-ready spoken broadcast string for the looped playback. */
  text: string;
  /** Estimated loop duration in seconds (from atisLoop), used by the widget to time the repeat. */
  loopSeconds: number;
  /** ATIS frequency in MHz if known (for the tune-to-listen UI), else null. */
  freqMhz: number | null;
  /** The phrase the pilot must read back on first contact. */
  advisory: string;
}

const DIGIT_WORD: Record<string, string> = {
  '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
  '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'niner',
};

/** "1853" -> "one eight five three". Non-digits are dropped. */
function spokenDigits(s: string): string {
  return s
    .split('')
    .map((c) => DIGIT_WORD[c])
    .filter((w): w is string => Boolean(w))
    .join(' ');
}

/** Capitalize the first character of a sentence fragment. */
function cap(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * Compose the full ATIS broadcast for a given letter code and weather/runway fields.
 *
 * The body is assembled from the supplied (already pretty-printed) phrases, then wrapped by the
 * existing buildAtisLoop() so loop framing and duration estimation stay in one place.
 *
 * @param code     Current ATIS letter, A–Z (case-insensitive). Invalid input falls back to "A".
 * @param fields   Spoken weather/runway phrases.
 * @param freqMhz  ATIS frequency for tune-to-listen, or null if unknown.
 * @returns AtisBroadcast with the letter, phonetic, TTS text, loop duration, freq, and advisory.
 *
 * @example
 * const b = composeAtisBroadcast('C', {
 *   airportName: 'Seattle Tacoma',
 *   wind: 'wind two four zero at one zero knots',
 *   visibility: 'visibility one zero statute miles',
 *   altimeter: 'two niner niner two',
 *   activeRunway: '16R',
 * }, 118.0);
 * b.code;        // "C"
 * b.phoneticCode // "Charlie"
 * b.text;        // "Information Charlie. Seattle Tacoma ... Advise ... you have information Charlie. End Information."
 */
export function composeAtisBroadcast(
  code: string,
  fields: AtisFields,
  freqMhz: number | null = null,
): AtisBroadcast {
  const ch = (code ?? '').trim().charAt(0).toUpperCase();
  const letter = /^[A-Z]$/.test(ch) ? ch : 'A';
  const word = letterToPhonetic(letter);

  const body: string[] = [];
  // Lead-in identifies the field and the information code (also re-derived by buildAtisLoop).
  body.push(`${fields.airportName} information ${word}.`);
  if (fields.observationZ && /^\d{4}$/.test(fields.observationZ)) {
    body.push(`${cap(spokenDigits(fields.observationZ))} Zulu weather.`);
  }
  if (fields.wind && fields.wind.trim()) body.push(cap(fields.wind.trim()) + '.');
  if (fields.visibility && fields.visibility.trim()) body.push(cap(fields.visibility.trim()) + '.');
  if (fields.sky && fields.sky.trim()) body.push(cap(fields.sky.trim()) + '.');
  if (fields.temperature && fields.temperature.trim()) body.push(cap(fields.temperature.trim()) + '.');
  if (fields.altimeter && fields.altimeter.trim()) {
    body.push(`Altimeter ${fields.altimeter.trim()}.`);
  }
  if (fields.activeRunway && fields.activeRunway.trim()) {
    body.push(`Landing and departing runway ${fields.activeRunway.trim()}.`);
  }
  if (fields.remarks && fields.remarks.trim()) {
    body.push(cap(fields.remarks.trim().replace(/\.$/, '')) + '.');
  }
  const advisory = `Advise on initial contact you have information ${word}.`;
  body.push(advisory);

  // Reuse the existing loop builder for framing + duration. It re-detects the leading
  // "information <letter>" but our text already spells the phonetic word, so we pass the body
  // through and keep buildAtisLoop's duration/normalization. We then re-prefix the explicit
  // "Information <word>." marker for a clean spoken loop.
  const loop: AtisLoopResult = buildAtisLoop(body.join(' '));
  const text = `Information ${word}. ${loop.text}`;

  return {
    code: letter,
    phoneticCode: word,
    text,
    loopSeconds: loop.loopSeconds,
    freqMhz: freqMhz ?? null,
    advisory,
  };
}

/**
 * Extract the ATIS letter the pilot reported from a free-form transmission.
 * Accepts a NATO word ("information Bravo"), a bare letter ("information B" / "info B"), or
 * the trailing "with B" form. Returns the uppercased letter, or null if none found.
 *
 * @example
 * parseReportedAtis("Ground, N512SR, taxi with information Bravo"); // "B"
 * parseReportedAtis("ready to taxi, information C");                // "C"
 * parseReportedAtis("requesting clearance");                        // null
 */
export function parseReportedAtis(text: string): string | null {
  if (!text) return null;
  // Normalize non-standard digit words but keep NATO words intact for the matcher below.
  const t = normalizeVariants(text);
  // 1) "information <Word|Letter>" / "info <Word|Letter>".
  const info = t.match(/\binfo(?:rmation)?\s+([A-Za-z][a-z]*)\b/i);
  // 2) "with <Word|Letter>" near "ATIS"/end (fallback).
  const withTok = t.match(/\bwith\s+(?:information\s+|info\s+)?([A-Za-z][a-z]*)\b/i);
  const token = (info?.[1] ?? withTok?.[1] ?? '').trim();
  if (!token) return null;
  return natoOrLetter(token);
}

/** "Bravo" -> "B"; "b" -> "B"; "B" -> "B"; anything else -> null. */
function natoOrLetter(token: string): string | null {
  const NATO_TO_LETTER: Record<string, string> = {
    alpha: 'A', bravo: 'B', charlie: 'C', delta: 'D', echo: 'E', foxtrot: 'F',
    golf: 'G', hotel: 'H', india: 'I', juliett: 'J', juliet: 'J', kilo: 'K',
    lima: 'L', mike: 'M', november: 'N', oscar: 'O', papa: 'P', quebec: 'Q',
    romeo: 'R', sierra: 'S', tango: 'T', uniform: 'U', victor: 'V',
    whiskey: 'W', whisky: 'W', xray: 'X', yankee: 'Y', zulu: 'Z',
  };
  const lower = token.toLowerCase();
  if (NATO_TO_LETTER[lower]) return NATO_TO_LETTER[lower];
  if (/^[a-z]$/i.test(token)) return token.toUpperCase();
  return null;
}

/** Result of the ATIS gate check. */
export interface AtisGateResult {
  /** True when the reported code matches the current broadcast (clearance may proceed). */
  ok: boolean;
  /** Current letter code, uppercased. */
  currentCode: string;
  /** The reported code that was checked (uppercased), or null if none/invalid was supplied. */
  reportedCode: string | null;
  /**
   * Spoken correction when ok === false (empty string when ok === true). Tells the pilot the
   * current information code and, if a frequency is known, where to obtain it.
   */
  text: string;
}

/**
 * Gate clearance acceptance on the current ATIS letter.
 *
 * If the pilot's reported code matches the current code (case-insensitive, NATO word or letter),
 * the gate passes. Otherwise it fails and returns a spoken correction asking the pilot to obtain
 * the current information.
 *
 * @param reportedCode  What the pilot said they have ("Bravo", "B", or null if they said nothing).
 * @param currentCode   The current ATIS letter ("Charlie", "C").
 * @param freqMhz       Optional ATIS frequency, used to phrase "on <freq>".
 *
 * @example
 * composeAtisGate('Bravo', 'Charlie').ok;   // false
 * composeAtisGate('Bravo', 'Charlie').text; // "...current information is Charlie..."
 * composeAtisGate('C', 'Charlie').ok;       // true
 * composeAtisGate(null, 'Charlie').ok;      // false (pilot must report the current ATIS)
 */
export function composeAtisGate(
  reportedCode: string | null,
  currentCode: string,
  freqMhz: number | null = null,
): AtisGateResult {
  const curCh = (currentCode ?? '').trim().charAt(0).toUpperCase();
  const current = /^[A-Z]$/.test(curCh) ? curCh : 'A';
  const currentWord = letterToPhonetic(current);

  const reported = reportedCode ? natoOrLetter(reportedCode.trim()) : null;

  if (reported && reported === current) {
    return { ok: true, currentCode: current, reportedCode: reported, text: '' };
  }

  const freqPhrase = freqMhz != null ? ` on ${formatFreq(freqMhz)}` : '';
  const text = reported
    ? `Information ${letterToPhonetic(reported)} is no longer current, the current information is ${currentWord}. Obtain ${currentWord}${freqPhrase} and advise.`
    : `Say the current ATIS information code. The current information is ${currentWord}. Obtain ${currentWord}${freqPhrase} and advise.`;

  return { ok: false, currentCode: current, reportedCode: reported, text };
}

/** 118.0 -> "one one eight point zero"; tolerant of trailing-zero MHz values. */
function formatFreq(mhz: number): string {
  // Render to 2 decimals (then trim a trailing zero pair, e.g. 118.00 -> "118.0").
  let s = mhz.toFixed(3).replace(/0+$/, '').replace(/\.$/, '.0');
  if (!s.includes('.')) s = `${s}.0`;
  const [whole = '', frac = ''] = s.split('.');
  const wholeWords = whole.split('').map((c) => DIGIT_WORD[c] ?? c).join(' ');
  const fracWords = frac.split('').map((c) => DIGIT_WORD[c] ?? c).join(' ');
  return `${wholeWords} point ${fracWords}`;
}
