// Oceanic / non-radar procedural control: position reports and "report next fix".
//
// In oceanic / remote airspace there is no radar (or ADS-C/CPDLC isn't modeled), so separation is
// PROCEDURAL: the controller knows where you are only from the position reports you make crossing
// compulsory reporting points. The deterministic engine owns all facts here — it parses the report
// the pilot gives, validates that the mandatory elements are present, composes the controller
// acknowledgement, and instructs the pilot to "report" the next compulsory fix. No facts invented.
//
// Standard ICAO position report format (Doc 4444):
//   "[callsign], position, [FIX] at [TIME] [FLIGHT LEVEL], estimating [NEXT FIX] at [ETA], [NEXT+1]"
// e.g. "Speedbird 283, position, 50 NORTH 040 WEST at 1432, flight level 360,
//       estimating 50 NORTH 050 WEST at 1510, next 50 NORTH 060 WEST."

import { spokenAltitude, spokenDigits } from '../util/phraseology.js';

/** Live state needed to decide whether procedural (non-radar) control applies. */
export interface OceanicContext {
  latitude: number;
  longitude: number;
  altitudeFt: number;
  /** Optional explicit radar-coverage flag from the sim/airspace data (overrides geometry). */
  radarCoverage?: boolean;
}

/** A parsed position report. Fields are null when the pilot omitted them. */
export interface PositionReport {
  /** The compulsory reporting fix just crossed (verbatim, e.g. "5040N" or "ALPHA"). */
  fix: string | null;
  /** Crossing time, 4-digit Zulu, e.g. "1432". */
  timeZulu: string | null;
  /** Reported altitude in feet (parsed from "flight level 360" / "FL360" / "36000"). */
  altitudeFt: number | null;
  /** The next compulsory fix the pilot is estimating. */
  nextFix: string | null;
  /** Estimated time at the next fix, 4-digit Zulu, e.g. "1510". */
  etaZulu: string | null;
  /** The fix after next ("next" element), when given. */
  nextNextFix: string | null;
}

/** Result of validating a position report against the mandatory elements. */
export interface ReportValidation {
  complete: boolean;
  /** Human-readable names of any missing mandatory elements. */
  missing: string[];
}

const REQUIRED_FIELDS: Array<{ key: keyof PositionReport; label: string }> = [
  { key: 'fix', label: 'present position' },
  { key: 'timeZulu', label: 'time' },
  { key: 'altitudeFt', label: 'altitude' },
  { key: 'nextFix', label: 'next fix' },
  { key: 'etaZulu', label: 'estimate for the next fix' },
];

/**
 * Decide whether the aircraft is in non-radar (procedural / oceanic) airspace.
 * Deterministic: an explicit radarCoverage flag wins; otherwise we fall back to geometry — far
 * from land over the major oceanic FIRs (North Atlantic, North/Central/South Pacific, etc.) and
 * at a typical oceanic cruising level there is no radar.
 *
 * The geometry test is intentionally conservative (large mid-ocean boxes) so it never reports
 * "non-radar" while the aircraft is plausibly within continental radar cover.
 */
export function isNonRadarAirspace(ctx: OceanicContext): boolean {
  if (ctx.radarCoverage === true) return false;
  if (ctx.radarCoverage === false) return true;

  const { latitude: lat, longitude: lon } = ctx;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;

  // Mid-ocean longitude bands where no continental radar reaches (deg, west = negative).
  const inAtlantic = lon <= -20 && lon >= -55 && lat >= 20 && lat <= 70;   // North Atlantic Track region
  const inPacific = (lon <= -130 || lon >= 150) && lat >= -55 && lat <= 60; // North/Central Pacific
  const inSouthAtlantic = lon <= -10 && lon >= -40 && lat <= 0 && lat >= -55;
  const inIndian = lon >= 55 && lon <= 95 && lat <= 0 && lat >= -45;        // South Indian Ocean

  return inAtlantic || inPacific || inSouthAtlantic || inIndian;
}

/** Did the pilot transmission look like an attempt at a position report? */
export function isPositionReport(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\bposition\s+report\b|\breporting\s+position\b|\bposition\b.*\b(at|estimating|flight level|fl\b)/.test(t) ||
    /\bestimating\b.*\b(at|by)\b/.test(t) ||
    // bare "FIX at TIME, FL..., estimating NEXT at TIME" without the word "position"
    /\bat\s+\d{3,4}z?\b.*\b(estimating|next)\b/.test(t)
  );
}

/** Did the pilot ASK which fix to report next / request oceanic clearance acknowledgement? */
export function isReportNextRequest(text: string): boolean {
  return /\b(which|what|next)\s+(fix|point|position)\b.*\breport\b|\breport\s+(which|what|next)\b|\bnext\s+reporting\s+point\b/i.test(
    text,
  );
}

// Flight level ("flight level 360" / "FL360") or an explicit foot value ("36000 feet").
// The bare-number branch REQUIRES a feet/ft suffix so a 4-digit Zulu time (e.g. "1432")
// can never be misread as an altitude.
const FL_OR_ALT = /(?:flight\s+level\s+|fl\s*)(\d{2,3})\b|\b(\d{3,5})\s*(?:feet|ft)\b/i;
const TIME_4 = /\b([0-2]\d[0-5]\d)\s*z?\b/i;

/**
 * Parse a free-text position report into structured fields. Pure & deterministic.
 * Recognizes lat/long fixes ("50 north 040 west", "5040N", "50N40W"), named fixes,
 * 4-digit Zulu times, and flight levels / altitudes.
 */
export function parsePositionReport(text: string): PositionReport {
  const t = text.trim();
  const lower = t.toLowerCase();

  // Altitude: prefer "flight level NNN", else a 4–5 digit foot value.
  let altitudeFt: number | null = null;
  const altM = lower.match(FL_OR_ALT);
  if (altM) {
    if (altM[1]) altitudeFt = parseInt(altM[1], 10) * 100;
    else if (altM[2]) altitudeFt = parseInt(altM[2], 10);
  }

  // The two times in order: first = crossing time, second = ETA at next fix.
  const times: string[] = [];
  const timeRe = new RegExp(TIME_4.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = timeRe.exec(t)) !== null) {
    if (m[1]) times.push(m[1]);
  }
  const timeZulu = times[0] ?? null;
  const etaZulu = times[1] ?? null;

  // Fixes: split the report around the keywords. The present fix is the element that sits
  // between the word "position" and "at <time>"; if "position" is absent, fall back to the
  // comma-bounded segment just before "at <time>". Captured groups never cross a comma so the
  // callsign (which precedes the first comma) can never leak into the fix.
  const fix =
    extractFixBefore(t, /\bposition[, ]+([^,]+?)\s+at\s+[0-2]\d[0-5]\d/i) ??
    extractFixBefore(t, /(?:^|,)\s*([^,]+?)\s+at\s+[0-2]\d[0-5]\d/i) ??
    extractPositionFix(t);
  const nextFix = extractFixAfter(t, /\bestimating\s+(.+?)(?:\s+at\b|\s+by\b|,|$)/i);
  const nextNextFix = extractFixAfter(t, /\bnext\s+(?:fix\s+|reporting\s+point\s+)?(.+?)(?:,|\.|$)/i);

  return { fix, timeZulu, altitudeFt, nextFix, etaZulu, nextNextFix };
}

/** Validate that all mandatory position-report elements are present. */
export function validatePositionReport(rep: PositionReport): ReportValidation {
  const missing: string[] = [];
  for (const f of REQUIRED_FIELDS) {
    const v = rep[f.key];
    if (v === null || v === undefined || v === '') missing.push(f.label);
  }
  return { complete: missing.length === 0, missing };
}

/**
 * Compose the controller's acknowledgement of a COMPLETE position report, and the instruction to
 * report the next compulsory fix. Deterministic — echoes only the facts the pilot provided.
 *
 * Example:
 *  "Speedbird 283, roger, position 50 north 040 west at 1432, flight level 360,
 *   estimating 50 north 050 west at 1510. Report 50 north 050 west."
 */
export function composePositionAck(spokenCs: string, rep: PositionReport): string {
  const parts: string[] = [`${spokenCs}, roger`];
  if (rep.fix) parts.push(`position ${speakFix(rep.fix)}`);
  if (rep.timeZulu) parts.push(`at ${spokenDigits(rep.timeZulu)}`);
  if (rep.altitudeFt != null) parts.push(spokenAltitude(rep.altitudeFt));
  if (rep.nextFix) {
    let est = `estimating ${speakFix(rep.nextFix)}`;
    if (rep.etaZulu) est += ` at ${spokenDigits(rep.etaZulu)}`;
    parts.push(est);
  }
  const ack = parts.join(', ') + '.';
  const reportFix = rep.nextFix ?? rep.nextNextFix;
  const reportInstr = reportFix
    ? ` ${composeReportNextFix(spokenCs, reportFix)}`
    : '';
  return ack + reportInstr;
}

/**
 * Compose a "say again — your position report is incomplete" prompt that names the missing
 * mandatory elements, so the pilot knows exactly what to add. Deterministic.
 */
export function composeIncompleteReport(spokenCs: string, missing: string[]): string {
  const list = joinList(missing);
  return `${spokenCs}, position report incomplete, say again with ${list}.`;
}

/**
 * Compose the standalone "report next fix" instruction. Used when the controller proactively asks
 * the pilot to report passing a given compulsory point, or in answer to "which fix do I report?".
 *
 * Example: "Speedbird 283, report 50 north 050 west."
 */
export function composeReportNextFix(spokenCs: string, fix: string): string {
  return `${spokenCs}, report ${speakFix(fix)}.`;
}

// ---------------------------------------------------------------------------
// Internal helpers (pure)
// ---------------------------------------------------------------------------

/** Pull the captured group of a regex if it matches and is non-empty, else null. */
function extractFixAfter(text: string, re: RegExp): string | null {
  const m = text.match(re);
  const g = m?.[1]?.trim();
  return g ? cleanFix(g) : null;
}

function extractFixBefore(text: string, re: RegExp): string | null {
  const m = text.match(re);
  const g = m?.[1]?.trim();
  return g ? cleanFix(g) : null;
}

/** Best-effort grab of a lat/long fix anywhere in the text (e.g. "5040N", "50N40W"). */
function extractPositionFix(text: string): string | null {
  const m = text.match(/\b(\d{2,4}\s*[ns]\s*\d{2,4}\s*[ew]|\d{2,4}[ns]\d{2,4}[ew])\b/i);
  return m?.[1] ? cleanFix(m[1]) : null;
}

/** Trim filler words a pilot might prepend ("the", "abeam", "at") and surrounding punctuation. */
function cleanFix(raw: string): string {
  return raw
    .replace(/^\s*(?:the|abeam|over|at|position|reporting|point)\s+/i, '')
    .replace(/[.,;]+$/, '')
    .trim();
}

/**
 * Speak a fix for readback. Lat/long fixes ("50 north 040 west", "5040N") are spoken digit-by-digit
 * with cardinal words; named fixes are passed through (upper-cased) for the LLG layer to voice.
 */
function speakFix(fix: string): string {
  const f = fix.trim();
  // Compact lat/long like "5040N040W" or "50N40W".
  const compact = f.match(/^(\d{2,4})\s*([ns])\s*(\d{2,4})\s*([ew])$/i);
  if (compact && compact[1] && compact[2] && compact[3] && compact[4]) {
    const latNum = spokenDigits(compact[1]);
    const latDir = compact[2].toUpperCase() === 'N' ? 'north' : 'south';
    const lonNum = spokenDigits(compact[3]);
    const lonDir = compact[4].toUpperCase() === 'E' ? 'east' : 'west';
    return `${latNum} ${latDir} ${lonNum} ${lonDir}`;
  }
  // Spelled lat/long like "50 north 040 west" — normalize spacing only.
  if (/\b[ns]\b|\bnorth\b|\bsouth\b/i.test(f) && /\b[ew]\b|\beast\b|\bwest\b/i.test(f)) {
    return f.replace(/\s+/g, ' ').toLowerCase();
  }
  return f.toUpperCase();
}

/** "a, b and c" — Oxford-free list join for spoken phraseology. */
function joinList(items: string[]): string {
  if (items.length === 0) return 'all required elements';
  if (items.length === 1) return items[0] ?? '';
  const head = items.slice(0, -1).join(', ');
  const tail = items[items.length - 1] ?? '';
  return `${head} and ${tail}`;
}
