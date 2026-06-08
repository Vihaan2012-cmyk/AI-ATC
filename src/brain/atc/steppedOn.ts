// Stepped-on transmissions: occasionally two stations key up at once and their transmissions
// collide into a squeal / heterodyne, so neither is readable. The controller then either asks
// for a blanket "say again", or — when it can tell two stations stepped on each other — tells
// them to sort it out ("last station blocked, go ahead" / "two aircraft calling, say again").
//
// Extends blocked.ts (stuck-mic). The difference: blocked.ts is ONE transmission cut off;
// stepped-on is TWO transmissions colliding. This module is:
//   - Rate-limited: fires only every Nth turn, by level, and rarer than a stuck-mic block.
//   - Deterministic-with-seed: given the same (turnCount, level, seed) it ALWAYS produces the
//     same event, so it is test-stable and reproducible (no Math.random anywhere).
//
// Pure functions only. No I/O, no timers, no side effects. The deterministic engine owns the
// fact "a collision happened and who was involved"; the LLM is not consulted.

import { spokenCallsign } from '../util/phraseology.js';

/** Reuses the chatter/block level vocabulary so the same UI knob drives every realism feature. */
export type StepLevel = 'off' | 'low' | 'medium' | 'high';

// Every Nth pilot transmission can produce a stepped-on collision, by level. 0 = never.
// Rarer than a stuck-mic block (blocked.ts: every 18–25). At high realism it's the rarest of the
// interference events, so the channel still feels usable.
const EVERY: Record<StepLevel, number> = { off: 0, low: 0, medium: 34, high: 23 };

// Synthetic fleet that "steps on" the player. Same pool family as chatter.ts so collisions are
// believable against the ambient traffic the pilot already hears.
const FLEET: ReadonlyArray<string> = [
  'UAL482', 'DAL1190', 'AAL735', 'SWA2241', 'ASA619',
  'JBU904', 'SKW3380', 'FFT512', 'NKS221', 'ACA1208',
];

/** How the controller responds to the collision (selected deterministically from the seed). */
export type StepResolution =
  // Controller could not tell who called: blanket repeat request.
  | 'say_again'
  // Controller heard two carriers: invites one station to go ahead.
  | 'last_station_blocked'
  // Controller names both blocked stations and asks each to try again in turn.
  | 'two_calling';

/** A fully-described stepped-on event. All facts are owned by this deterministic module. */
export interface SteppedOnEvent {
  /** The synthetic station whose transmission collided with the pilot's. */
  intruderCallsign: string;
  /** Spoken form of the intruder, e.g. "United four eight two". */
  intruderSpoken: string;
  /** How the controller chose to resolve the collision. */
  resolution: StepResolution;
  /** The squeal/garble tag + controller phrase, ready for the transcript / TTS. */
  text: string;
}

/**
 * Deterministic, well-distributed hash of a seed string -> non-negative integer.
 * Same string always yields the same number (matches the seed() helper used across the atc/ modules).
 */
function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Pick an element from an array by a non-negative seed index (stable for a given seed). */
function pick<T>(arr: ReadonlyArray<T>, seedValue: number): T {
  return arr[seedValue % arr.length]!;
}

/**
 * Should this pilot transmission be stepped on (collide with a synthetic station) this turn?
 * Deterministic, keyed off a 1-based turn counter. Rarer than a stuck-mic block.
 * Never fires for readback turns (the caller decides which turns are "fresh requests").
 *
 * @param turnCount 1-based count of fresh pilot transmissions so far this session.
 * @param level Realism level (off/low disable the effect entirely).
 * @returns true when the two transmissions collide on this turn.
 */
export function isSteppedOn(turnCount: number, level: StepLevel): boolean {
  const n = EVERY[level];
  return n > 0 && turnCount > 0 && turnCount % n === 0;
}

/**
 * Deterministically choose which synthetic station stepped on the pilot for this collision.
 * Stable for a given (turnCount, seed): the same inputs always name the same intruder.
 *
 * @param turnCount The 1-based turn counter (varies the pick across the session).
 * @param seed A stability seed string (e.g. the pilot callsign + frequency). Defaults to a constant.
 * @returns The intruder's filed callsign, e.g. "UAL482".
 */
export function pickIntruder(turnCount: number, seed = 'stepped-on'): string {
  const s = hashSeed(`${seed}|${turnCount}`);
  return pick(FLEET, s);
}

/**
 * Compose the controller's response to a stepped-on collision. Pure & deterministic: the same
 * (ownSpoken, turnCount, seed) always yields the same event — including which station stepped on,
 * which resolution the controller used, and the exact phrase.
 *
 * The leading "[stepped on]" tag mirrors blocked.ts's "[blocked transmission]" so the transcript /
 * widget can render the squeal distinctly. The pilot's underlying request is NOT processed by the
 * caller when a collision fires — the pilot must transmit again.
 *
 * Examples (ownSpoken = "Skyhawk five one two sierra romeo"):
 *  - say_again:            "[stepped on] Skyhawk five one two sierra romeo, you were stepped on, say again."
 *  - last_station_blocked: "[stepped on] last station blocked, go ahead."
 *  - two_calling:          "[stepped on] two aircraft calling together, United four eight two and
 *                           Skyhawk five one two sierra romeo, say again in turn."
 *
 * @param ownSpoken The pilot's own spoken callsign (e.g. from spokenFlightCallsign(fp)).
 * @param turnCount The 1-based turn counter for this collision.
 * @param seed Stability seed (e.g. pilot callsign + active frequency). Defaults to a constant.
 * @returns A fully-described SteppedOnEvent.
 */
export function composeSteppedOn(
  ownSpoken: string,
  turnCount: number,
  seed = 'stepped-on',
): SteppedOnEvent {
  const own = (ownSpoken && ownSpoken.trim().length > 0) ? ownSpoken.trim() : 'last station';
  const intruderCallsign = pickIntruder(turnCount, seed);
  const intruderSpoken = spokenCallsign(intruderCallsign);

  // Deterministically choose the resolution from a second, independent slice of the seed so it
  // does not correlate with the intruder pick.
  const r = hashSeed(`${seed}|res|${turnCount}`) % 3;
  const resolution: StepResolution =
    r === 0 ? 'say_again' : r === 1 ? 'last_station_blocked' : 'two_calling';

  let text: string;
  switch (resolution) {
    case 'say_again':
      text = `[stepped on] ${own}, you were stepped on, say again.`;
      break;
    case 'last_station_blocked':
      text = '[stepped on] last station blocked, go ahead.';
      break;
    case 'two_calling':
      text = `[stepped on] two aircraft calling together, ${intruderSpoken} and ${own}, say again in turn.`;
      break;
    default:
      text = `[stepped on] ${own}, say again.`;
      break;
  }

  return { intruderCallsign, intruderSpoken, resolution, text };
}

/**
 * Convenience: the bare controller phrase for a stepped-on collision (no event object).
 * Equivalent to composeSteppedOn(...).text. Useful for callers that only need the string.
 */
export function steppedOnPhrase(ownSpoken: string, turnCount: number, seed = 'stepped-on'): string {
  return composeSteppedOn(ownSpoken, turnCount, seed).text;
}
