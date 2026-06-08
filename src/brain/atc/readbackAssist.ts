// Co-pilot readback assist (learning aid). Given the LAST instruction ATC issued, compose the
// textbook-correct PILOT readback — the exact words a sharp first officer would say back.
//
// This is a language-only helper: it does not invent facts. It only re-phrases the structured
// instruction the deterministic engine already produced (LastInstruction from explain.ts) into
// proper pilot phraseology. Key phraseology rules baked in:
//   - Pilots read back the mandatory items (altitude, heading, speed, squawk, direct-to fix).
//   - Altitudes are read back in full ("descend and maintain five thousand").
//   - Headings are three digits, spoken as individual digits ("heading two seven zero").
//   - Squawk codes are four octal digits, spoken individually ("squawk four five one seven").
//   - The pilot's callsign goes at the END of the readback (controller-first, pilot-last).

import { spokenAltitude, spokenDigits } from '../util/phraseology.js';
import type { LastInstruction } from './explain.js';

/** Extra items a controller may have assigned that aren't in LastInstruction (e.g. transponder code). */
export interface ReadbackExtras {
  /** 4-digit octal squawk code, e.g. "4517". */
  squawk?: string;
  /** Spoken pilot callsign appended to the end of the readback, e.g. "Southwest 1234". */
  spokenCallsign?: string;
}

/** Did the pilot (or the UI) ask us to read back the last clearance? */
export function isReadbackAssistRequest(text: string): boolean {
  return /\bread\s*back\b|\bhow do i read (that|this) back\b|what'?s the readback\b|correct readback\b/i.test(text);
}

/**
 * Format a heading as a textbook three-digit spoken readback.
 * 70 -> "zero seven zero"; 270 -> "two seven zero"; 5 -> "zero zero five".
 */
function spokenHeading(deg: number): string {
  const norm = ((Math.round(deg) % 360) + 360) % 360;
  return spokenDigits(String(norm).padStart(3, '0'));
}

/**
 * Compose the textbook-correct pilot readback for the last instruction.
 * Returns a complete radio-ready string (callsign last), or a graceful note if nothing to read back.
 *
 * Examples:
 *   composeReadback({ altitudeFt: 5000 }, { spokenCallsign: 'Southwest 1234' })
 *     => "Descend and maintain five thousand, Southwest 1234."
 *   composeReadback({ headingDeg: 270, speedKt: 210 }, { squawk: '4517', spokenCallsign: 'November 512 Sierra Romeo' })
 *     => "Fly heading two seven zero, maintain two one zero knots, squawk four five one seven, November 512 Sierra Romeo."
 */
export function composeReadback(
  last: LastInstruction | null,
  extras: ReadbackExtras = {},
): string {
  const tail = extras.spokenCallsign && extras.spokenCallsign.trim().length > 0
    ? `, ${extras.spokenCallsign.trim()}`
    : '';

  if (!last) {
    return `I have nothing to read back${tail}.`;
  }

  const parts: string[] = [];

  if (last.altitudeFt != null) {
    // We don't know from LastInstruction whether it was a climb or descent; "maintain" is the
    // phraseology that is always correct for an assigned altitude readback.
    parts.push(`maintain ${spokenAltitude(last.altitudeFt)}`);
  }
  if (last.headingDeg != null) {
    parts.push(`fly heading ${spokenHeading(last.headingDeg)}`);
  }
  if (last.speedKt != null) {
    parts.push(`maintain ${spokenDigits(String(Math.round(last.speedKt)))} knots`);
  }
  if (last.fix && last.fix.trim().length > 0) {
    parts.push(`direct ${last.fix.toUpperCase()}`);
  }
  if (extras.squawk && /^\d{4}$/.test(extras.squawk.trim())) {
    parts.push(`squawk ${spokenDigits(extras.squawk.trim())}`);
  }

  if (parts.length === 0) {
    // No structured items; fall back to echoing the raw clause as a wilco/roger readback.
    if (last.raw && last.raw.trim().length > 0) {
      return `${capitalize(last.raw.trim())}, wilco${tail}.`;
    }
    return `Wilco${tail}.`;
  }

  // Capitalize the first clause; join the rest with commas (standard readback cadence).
  const joined = parts.join(', ');
  return `${capitalize(joined)}${tail}.`;
}

/** Uppercase the first character of a string (leaves the rest untouched). */
function capitalize(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
