// Context-aware "say again" partial repeats of ATC instructions.
// Pure, deterministic composition — returns only the missed element.
// Phrases typical ATC repeat patterns per FAA phraseology guide.

import { spokenAltitude, spokenDigits } from '../util/phraseology.js';

/** Last instruction issued by controller (all fields optional to permit partial updates). */
export interface LastInstruction {
  altitudeFt?: number;  // Cleared/assigned altitude in feet
  headingDeg?: number;  // Assigned heading in magnetic degrees
  speedKt?: number;     // Assigned speed in knots
  fix?: string;         // Fix/waypoint reference (e.g., "SEATTLE")
}

/** Which element the pilot missed (did not read back or requests repeat of). */
export type MissedElement = 'altitude' | 'heading' | 'speed' | 'fix' | 'all';

/**
 * Compose a partial "say again" response for a missed instruction element.
 * Returns a single ATC phrase that repeats ONLY the missed part (or all if 'all').
 *
 * Examples:
 * - missed='altitude': "I say again, descend and maintain eight thousand."
 * - missed='heading': "I say again, fly heading zero seven zero."
 * - missed='speed': "I say again, reduce speed to one two zero knots."
 * - missed='fix': "I say again, over Seattle."
 * - missed='all': Full repeat of all assigned values as a complete clearance.
 *
 * @param lastInstruction The last instruction issued (altitude, heading, speed, fix)
 * @param missed Which element was not understood or needs repetition (defaults to 'all')
 * @returns ATC phrase ready for text-to-speech, or null if the missed element has no value
 */
export function composePartialRepeat(
  lastInstruction: LastInstruction,
  missed: MissedElement = 'all'
): string | null {
  // Validate inputs
  if (!lastInstruction || typeof missed !== 'string') {
    return null;
  }

  switch (missed) {
    case 'altitude':
      if (lastInstruction.altitudeFt === undefined) return null;
      return `I say again, descend and maintain ${spokenAltitude(lastInstruction.altitudeFt)}.`;

    case 'heading':
      if (lastInstruction.headingDeg === undefined) return null;
      const headingStr = String(Math.round(lastInstruction.headingDeg)).padStart(3, '0');
      return `I say again, fly heading ${spokenDigits(headingStr)}.`;

    case 'speed':
      if (lastInstruction.speedKt === undefined) return null;
      const speedStr = String(Math.round(lastInstruction.speedKt));
      return `I say again, reduce speed to ${spokenDigits(speedStr)} knots.`;

    case 'fix':
      if (!lastInstruction.fix || lastInstruction.fix.trim().length === 0) return null;
      return `I say again, over ${lastInstruction.fix.toUpperCase()}.`;

    case 'all':
      // Compose full repeat of all assigned values in standard ATC order
      return composeFullRepeat(lastInstruction);

    default:
      return null;
  }
}

/**
 * Internal: compose a complete repeat of all assigned instruction elements.
 * Used when missed='all' or for a full readback confirmation.
 *
 * @param lastInstruction The full instruction set
 * @returns Complete ATC phrase with all assigned values, or null if all fields are empty
 */
function composeFullRepeat(lastInstruction: LastInstruction): string | null {
  const parts: string[] = ['I say again,'];
  let hasAny = false;

  // Standard ATC order: altitude, heading, speed, then fix
  if (lastInstruction.altitudeFt !== undefined) {
    parts.push(`descend and maintain ${spokenAltitude(lastInstruction.altitudeFt)},`);
    hasAny = true;
  }

  if (lastInstruction.headingDeg !== undefined) {
    const headingStr = String(Math.round(lastInstruction.headingDeg)).padStart(3, '0');
    parts.push(`fly heading ${spokenDigits(headingStr)},`);
    hasAny = true;
  }

  if (lastInstruction.speedKt !== undefined) {
    const speedStr = String(Math.round(lastInstruction.speedKt));
    parts.push(`reduce speed to ${spokenDigits(speedStr)} knots,`);
    hasAny = true;
  }

  if (lastInstruction.fix && lastInstruction.fix.trim().length > 0) {
    parts.push(`over ${lastInstruction.fix.toUpperCase()},`);
    hasAny = true;
  }

  if (!hasAny) return null;

  // Clean up punctuation: remove trailing comma from last element, add period
  const combined = parts.join(' ');
  return combined.replace(/,\s*$/, '.').replace(/,\s*$/, '.');
}

/**
 * Validate a LastInstruction object for completeness.
 * Returns an error message if any assigned value is malformed, or null if valid.
 *
 * @param instruction The instruction to validate
 * @returns Error message string, or null if all values are valid
 */
export function validateInstruction(instruction: LastInstruction): string | null {
  if (!instruction || typeof instruction !== 'object') {
    return 'instruction must be an object';
  }

  // Altitude: must be 500–50000 feet if present
  if (instruction.altitudeFt !== undefined) {
    const alt = instruction.altitudeFt;
    if (!Number.isFinite(alt) || alt < 500 || alt > 50000) {
      return 'altitudeFt must be between 500 and 50000 feet';
    }
  }

  // Heading: must be 0–359 degrees if present
  if (instruction.headingDeg !== undefined) {
    const hdg = instruction.headingDeg;
    if (!Number.isFinite(hdg) || hdg < 0 || hdg > 359) {
      return 'headingDeg must be between 0 and 359 degrees';
    }
  }

  // Speed: must be 0–600+ knots if present
  if (instruction.speedKt !== undefined) {
    const spd = instruction.speedKt;
    if (!Number.isFinite(spd) || spd < 0 || spd > 1000) {
      return 'speedKt must be between 0 and 1000 knots';
    }
  }

  // Fix: must be a non-empty string if present
  if (instruction.fix !== undefined && instruction.fix !== null) {
    if (typeof instruction.fix !== 'string' || instruction.fix.trim().length === 0) {
      return 'fix must be a non-empty string';
    }
  }

  return null;
}
