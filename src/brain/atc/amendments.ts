// Mid-flight clearance amendments: route changes, altitude changes, squawk changes.
// Pure, deterministic composition — the engine decides which changes are valid and phrases them.

import { spokenAltitude, spokenDigits, spokenRunway, spokenFreq } from '../util/phraseology.js';

/** An amendment type and its operand. */
export interface Amendment {
  type: 'route' | 'altitude' | 'squawk' | 'frequency';
  detail: string; // e.g., "15000" (altitude in feet), "2751" (squawk), "SEA" (routing fix), "119.5" (frequency MHz)
}

/**
 * Compose the initial amendment notification (preamble).
 * Always returns the same structure: pilot is asked to advise ready to copy.
 * Example: "Southwest 1234, I have an amended clearance, advise ready to copy."
 */
export function composeAmendment(spokenCs: string, change: Amendment): string {
  return `${spokenCs}, I have an amended clearance, advise ready to copy.`;
}

/**
 * Compose the amendment body (the actual change to be read after pilot acknowledges).
 * Returns a single natural sentence describing the change.
 * Examples:
 * - "Your new routing: direct Seattle, then as filed."
 * - "Amended clearance, descend and maintain flight level two five zero."
 * - "Amend your squawk to four five one seven."
 * - "Amend frequency to one one nine point five."
 */
export function composeAmendmentBody(change: Amendment): string | null {
  switch (change.type) {
    case 'altitude': {
      // Expect detail as a number string in feet, e.g., "15000".
      const ft = parseInt(change.detail, 10);
      if (isNaN(ft)) return null;
      return `amended clearance, descend and maintain ${spokenAltitude(ft)}.`;
    }
    case 'route': {
      // Expect detail as a fix name or routing string, e.g., "SEA" or "direct Seattle".
      // Always end with "as filed" pattern.
      const fix = change.detail.trim().toUpperCase();
      if (fix.length === 0) return null;
      if (fix.startsWith('DIRECT')) {
        // Already phrased as "direct X"
        return `your new routing: ${fix.toLowerCase()}, then as filed.`;
      }
      return `your new routing: direct ${fix}, then as filed.`;
    }
    case 'squawk': {
      // Expect detail as a 4-digit octal code, e.g., "2751".
      if (!/^\d{4}$/.test(change.detail)) return null;
      return `amend your squawk to ${spokenDigits(change.detail)}.`;
    }
    case 'frequency': {
      // Expect detail as a frequency string or number (MHz), e.g., "119.5" or "119500".
      let mhz: number;
      if (/\./.test(change.detail)) {
        // Already in MHz format (e.g., "119.5")
        mhz = parseFloat(change.detail);
      } else if (/^\d{5,6}$/.test(change.detail)) {
        // In kHz (e.g., "119500" or "11950") — convert to MHz
        mhz = parseInt(change.detail, 10) / 1000;
      } else {
        return null;
      }
      if (isNaN(mhz) || mhz < 118 || mhz > 137) return null;
      return `amend your frequency to ${spokenFreq(mhz)}.`;
    }
    default:
      return null;
  }
}

/**
 * Compose a complete amendment exchange (preamble + body) in one call.
 * Returns null if the amendment body cannot be composed.
 * Typically used when composing a full automated amendment sequence.
 */
export function composeFullAmendment(spokenCs: string, change: Amendment): string | null {
  const preamble = composeAmendment(spokenCs, change);
  const body = composeAmendmentBody(change);
  if (!body) return null;
  // Typically, the body is read after the pilot says "ready to copy" — but we compose both here.
  return `${preamble} ${body}`;
}

/**
 * Validate an amendment change object before composing.
 * Returns an error message if invalid, or null if the change is valid.
 */
export function validateAmendment(change: Amendment): string | null {
  if (!change.type || !['route', 'altitude', 'squawk', 'frequency'].includes(change.type)) {
    return 'amendment type must be one of: route, altitude, squawk, frequency';
  }
  if (!change.detail || change.detail.trim().length === 0) {
    return 'amendment detail cannot be empty';
  }
  // Type-specific validation
  switch (change.type) {
    case 'altitude':
      if (!/^\d+$/.test(change.detail)) return 'altitude must be a number (feet)';
      const ft = parseInt(change.detail, 10);
      if (ft < 500 || ft > 50000) return 'altitude must be between 500 and 50000 feet';
      break;
    case 'squawk':
      if (!/^[0-7]{4}$/.test(change.detail)) return 'squawk must be a 4-digit octal code';
      break;
    case 'frequency':
      let mhz: number;
      if (/\./.test(change.detail)) {
        mhz = parseFloat(change.detail);
      } else if (/^\d{5,6}$/.test(change.detail)) {
        mhz = parseInt(change.detail, 10) / 1000;
      } else {
        return 'frequency must be in MHz (e.g., 119.5) or kHz (e.g., 119500)';
      }
      if (isNaN(mhz) || mhz < 118 || mhz > 137) return 'frequency must be in valid VHF range (118.0–137.0 MHz)';
      break;
    // route: minimal validation (any non-empty string is accepted)
  }
  return null;
}
