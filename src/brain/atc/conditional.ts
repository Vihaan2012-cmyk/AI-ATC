// Conditional clearance clauses: "cleared for takeoff behind" and "cleared to land behind".
// Used when a pilot reports traffic in sight during sequencing.

import type { TrafficAhead } from './traffic.js';

/** Aircraft type descriptions for conditional clearances. */
const TYPE_DESC: Record<string, string> = {
  // Common type codes extracted from callsigns / known aircraft
  B737: 'Boeing', B738: 'Boeing', B739: 'Boeing',
  B747: 'Boeing', B777: 'Boeing', B787: 'Boeing',
  A320: 'Airbus', A321: 'Airbus', A330: 'Airbus', A380: 'Airbus',
  CRJ: 'Bombardier', E170: 'Embraer', E190: 'Embraer',
};

/**
 * Infer aircraft type from a spoken callsign (e.g., "United seven three seven" -> "Boeing").
 * Falls back to generic "traffic" if type is unknown.
 */
function inferAircraftType(spokenCallsign: string): string {
  // Parse "seven three seven" -> "B737"
  const match = spokenCallsign.match(/(?:seven|7)[- ]?(?:three|3)[- ]?(?:seven|7)|triple seven|triple eight/);
  if (match) {
    const lowered = spokenCallsign.toLowerCase();
    if (lowered.includes('seven') && lowered.includes('three') && lowered.includes('seven')) return 'Boeing';
    if (lowered.includes('seven') && lowered.includes('seven')) return 'Boeing';
  }
  if (/\bairbus\b|a320|a321|a330|a380/i.test(spokenCallsign)) return 'Airbus';
  if (/\bboeing\b|b7|triple seven|triple eight/i.test(spokenCallsign)) return 'Boeing';
  return 'traffic';
}

/**
 * Compose a conditional takeoff or landing clearance clause given traffic ahead.
 * Example outputs:
 * - "cleared for takeoff behind the departing Boeing"
 * - "cleared to land behind the landing Airbus on short final"
 */
export function composeConditionalClause(
  traffic: TrafficAhead,
  phase: 'takeoff' | 'landing',
): string {
  const type = inferAircraftType(traffic.spoken);
  const article = type === 'traffic' ? 'the ' : '';
  const typeLower = type.toLowerCase();
  const callsignPhrase = `${article}${typeLower}`;

  if (phase === 'takeoff') {
    // "cleared for takeoff behind the departing Boeing"
    return `cleared for takeoff behind the ${traffic.position} ${typeLower}`;
  } else {
    // "cleared to land behind the Airbus on short final"
    return `cleared to land behind the ${typeLower}${traffic.position ? ` ${traffic.position}` : ''}`;
  }
}

/**
 * Check if a pilot transmission indicates they have traffic in sight.
 * Matches patterns like "ready, traffic in sight", "traffic observed", etc.
 */
export function hasTrafficInSight(text: string): boolean {
  return /\b(ready|wilco).*traffic\s+(in\s+)?sight|traffic\s+(observed|in sight)|\bsee\s+traffic|\bhave\s+traffic|visual(ly|\s+on)|tally/.test(text.toLowerCase());
}
