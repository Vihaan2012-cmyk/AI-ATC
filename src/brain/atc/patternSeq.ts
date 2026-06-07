// VFR pattern sequencing: deterministically compose realistic pattern-entry instructions
// with position numbers and traffic-to-follow callouts. Pure, deterministic functions.
// Follows the traffic.ts model: seeded PRNG for stable experience within a session.

import { sequenceWord, ordinalWord } from '../util/phraseology.js';

/**
 * Traffic descriptor for pattern sequencing: tells a pilot what aircraft to follow and where.
 * Used when composing position assignments (e.g., "traffic to follow, United 737 on left base").
 */
export interface PatternTraffic {
  /** Spoken callsign, e.g. "United seven three seven". */
  spoken: string;
  /** Where they are, e.g. "on left base", "turning final", "on short final". */
  where: string;
}

/**
 * Deterministic seeded hash for stable PRNG across the session.
 * Same seed always yields the same sequence.
 */
function seed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Pick an element from an array using a seeded index.
 * Same seed always picks the same element.
 */
function pick<T>(arr: T[], seedValue: number): T {
  return arr[seedValue % arr.length]!;
}

/**
 * Deterministically derive a position number (1..4) for a VFR pattern entry,
 * and optionally generate traffic-to-follow info from a seed.
 * Used to give consistent but varied pattern work experience.
 *
 * @param airport ICAO code, e.g. "KSEA"
 * @param ownCallsign Player's callsign, e.g. "N512SR"
 * @param seedStr Optional seed string to override default; if not provided uses airport+callsign
 * @returns { position, traffic: <PatternTraffic | null> }
 */
export function pickPatternPosition(
  airport: string,
  ownCallsign: string,
  seedStr?: string,
): { position: number; traffic: PatternTraffic | null } {
  const s = seedStr ? seed(seedStr) : seed(`${airport}|${ownCallsign}|pattern`);
  // Bias toward small patterns: 0,0,0,1,1,2 -> position 1,2,3
  const rawPos = s % 6;
  const position = (rawPos <= 2 ? 1 : rawPos <= 4 ? 2 : 3);

  let traffic: PatternTraffic | null = null;
  if (position > 1) {
    traffic = pickFollowingTraffic(s);
  }

  return { position, traffic };
}

/**
 * Pool of believable company/other traffic for pattern work.
 * Kept small so repeats feel organic (real life at a small field).
 */
const TRAFFIC_POOL: Array<{ spoken: string }> = [
  { spoken: 'Cessna seven three two' },
  { spoken: 'Cirrus two eight zero bravo' },
  { spoken: 'Beechcraft four one delta alpha' },
  { spoken: 'Piper Cherokee five four niner' },
  { spoken: 'Cessna one eight five' },
  { spoken: 'Diamond star one two three' },
  { spoken: 'Bonanza four four seven' },
  { spoken: 'Grumman nine zero delta' },
];

const PATTERN_POSITIONS = [
  'on left base',
  'turning final',
  'on short final',
  'on a one mile final',
  'on downwind',
  'on left downwind',
];

/**
 * Deterministically pick a traffic-to-follow for pattern work given a seed.
 * Returns the spoken callsign and position phrase.
 */
function pickFollowingTraffic(seedValue: number): PatternTraffic {
  const spoken = pick(TRAFFIC_POOL, seedValue >> 3).spoken;
  const where = pick(PATTERN_POSITIONS, seedValue >> 5);
  return { spoken, where };
}

/**
 * Compose a realistic pattern-entry call for a VFR pilot.
 * Example outputs:
 * - "Cessna seven three two, number one, enter left downwind runway two four, report midfield."
 * - "Cessna seven three two, number two, follow the Cessna on left base, enter left downwind runway two four."
 * - "Cessna seven three two, number three, follow the Cirrus turning final, enter left downwind runway two four."
 *
 * @param spokenCs Pilot's spoken callsign, e.g. "Cessna seven three two"
 * @param position Pattern position (1..4): 1=first, 2=second, 3=third, etc.
 * @param follow Traffic to follow (null if position 1), e.g. { spoken: "Cessna one eight five", where: "on left base" }
 * @param runway Spoken runway, e.g. "two four" or "zero nine"
 * @returns The instruction phrase, ready to speak to the pilot
 */
export function sequenceCall(
  spokenCs: string,
  position: number,
  follow: PatternTraffic | null,
  runway: string = 'the active runway',
): string {
  const posWord = position > 1 ? `, ${sequenceWord(position)}` : ', number one';
  const followPhrase = follow
    ? ` Follow the ${follow.spoken} ${follow.where}.`
    : '';
  const enterPhrase = `Enter left downwind ${runway}, report midfield.`;
  const fullInstruction = `${spokenCs}${posWord}${followPhrase} ${enterPhrase}`.trim();
  return fullInstruction;
}
