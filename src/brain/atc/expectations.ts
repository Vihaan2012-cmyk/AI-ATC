// Deterministic ATC phraseology for expectation clearances: "expect lower", "expect runway", etc.
// Pure function composition based on standard US ATC conventions.

import { spokenAltitude, spokenRunway } from '../util/phraseology.js';

/**
 * Compose a standardized "expect" clearance for future contingencies.
 * Kind='lower'|'higher'|'approach'|'runway' maps to the type of change expected.
 * Detail provides context (altitude in feet for lower/higher; approach name; runway identifier).
 * milesOrMin optionally specifies when to expect the change (distance in nm or time in minutes).
 *
 * Examples:
 *  - composeExpect('lower', '3000') => "expect lower to three thousand"
 *  - composeExpect('lower', '3000', 10) => "expect lower to three thousand in one zero miles"
 *  - composeExpect('higher', '24000', 20) => "expect higher to flight level two four zero in two zero miles"
 *  - composeExpect('approach', 'ILS') => "expect ILS approach"
 *  - composeExpect('runway', '16R') => "expect runway one six right"
 *  - composeExpect('runway', '10L', 5) => "expect runway one zero left in five minutes"
 */
export function composeExpect(
  kind: 'lower' | 'higher' | 'approach' | 'runway',
  detail: string,
  milesOrMin?: number,
): string {
  let baseClause: string;

  switch (kind) {
    case 'lower': {
      const detailNum = parseInt(detail, 10);
      const altSpoken = Number.isFinite(detailNum) ? spokenAltitude(detailNum) : detail;
      baseClause = `expect lower to ${altSpoken}`;
      break;
    }
    case 'higher': {
      const detailNum = parseInt(detail, 10);
      const altSpoken = Number.isFinite(detailNum) ? spokenAltitude(detailNum) : detail;
      baseClause = `expect higher to ${altSpoken}`;
      break;
    }
    case 'approach': {
      // detail is the approach type, e.g., "ILS", "VOR", "visual"
      const approachType = detail.trim();
      baseClause = `expect ${approachType} approach`;
      break;
    }
    case 'runway': {
      const rwySpoken = spokenRunway(detail);
      baseClause = `expect runway ${rwySpoken}`;
      break;
    }
  }

  // If timing is provided, append it
  if (milesOrMin != null && milesOrMin > 0) {
    const unit = kind === 'runway' && milesOrMin < 20 ? 'minutes' : 'miles';
    const timeSpoken = kind === 'runway' && milesOrMin < 20
      ? spokenMinutes(milesOrMin)
      : spokenDistance(milesOrMin);
    return `${baseClause} in ${timeSpoken} ${unit}`;
  }

  return baseClause;
}

/**
 * Helper: convert distance in nautical miles to spoken form.
 * 10 -> "one zero"; 5 -> "five"
 */
function spokenDistance(nm: number): string {
  const rounded = Math.round(nm);
  return rounded.toString().split('').map((d) => {
    const DIGIT: Record<string, string> = {
      '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
      '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'niner',
    };
    return DIGIT[d] ?? d;
  }).join(' ');
}

/**
 * Helper: convert time in minutes to spoken form.
 * 5 -> "five"; 10 -> "one zero"
 */
function spokenMinutes(min: number): string {
  const rounded = Math.round(min);
  return rounded.toString().split('').map((d) => {
    const DIGIT: Record<string, string> = {
      '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
      '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'niner',
    };
    return DIGIT[d] ?? d;
  }).join(' ');
}
