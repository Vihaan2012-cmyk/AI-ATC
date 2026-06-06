// Ambient traffic model: gives the player a realistic *sequence* and a "traffic to follow"
// without fabricating live sim state. The deterministic engine owns these facts; the LLM never
// invents them. Sequence numbers are derived from a stable per-airport seed so a given flight
// gets a consistent (but varied) experience across a session.
//
// This is intentionally lightweight: real per-runway AI enumeration via SimConnect SimObjects
// is expensive and unreliable across sceneries, so we synthesize plausible company/airline
// traffic instead. The phrasing matches what a controller would actually say.
import { spokenCallsign, sequenceWord, ordinalWord } from '../util/phraseology.js';

export interface TrafficAhead {
  /** Spoken callsign of the aircraft to follow, e.g. "United seven three seven". */
  spoken: string;
  /** Where it is, e.g. "on short final", "departing ahead of you", "on the taxiway". */
  position: string;
}

export interface Sequence {
  /** 1 = you're first. */
  number: number;
  /** "number two" etc. (empty when first). */
  word: string;
  /** "first"/"second" etc. for "first in line for departure". */
  ordinal: string;
  /** The aircraft immediately ahead, or null if you're number one. */
  ahead: TrafficAhead | null;
}

// A small pool of believable company/other traffic. Picked deterministically.
const POOL: Array<{ cs: string }> = [
  { cs: 'UAL482' }, { cs: 'DAL1190' }, { cs: 'AAL735' }, { cs: 'SWA2241' },
  { cs: 'ASA619' }, { cs: 'JBU904' }, { cs: 'SKW3380' }, { cs: 'FFT512' },
];

const ARRIVAL_POS = ['on short final', 'on a two mile final', 'on a four mile final', 'turning base'];
const DEPARTURE_POS = ['departing ahead of you', 'in position', 'holding short ahead of you'];
const TAXI_POS = ['ahead of you on the taxiway', 'crossing ahead of you', 'holding short ahead of you'];

function seed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function pick<T>(arr: T[], n: number): T {
  return arr[n % arr.length]!;
}

/**
 * Build a sequence for a phase at an airport. `phase` selects the position phrasing.
 * `ownCallsign` keeps the player's own traffic distinct. Returns sequence #1..#3.
 */
export function makeSequence(
  airport: string,
  ownCallsign: string,
  phase: 'arrival' | 'departure' | 'taxi',
): Sequence {
  const s = seed(`${airport}|${ownCallsign}|${phase}`);
  // 0,1,2 ahead of us -> we are number 1,2,3. Bias toward small queues.
  const ahead = s % 5 === 0 ? 2 : s % 2 === 0 ? 1 : 0;
  const number = ahead + 1;

  let aheadTraffic: TrafficAhead | null = null;
  if (ahead > 0) {
    const t = pick(POOL, s >> 3);
    const posList = phase === 'arrival' ? ARRIVAL_POS : phase === 'departure' ? DEPARTURE_POS : TAXI_POS;
    aheadTraffic = { spoken: spokenCallsign(t.cs), position: pick(posList, s >> 5) };
  }

  return {
    number,
    word: number > 1 ? sequenceWord(number) : '',
    ordinal: ordinalWord(number),
    ahead: aheadTraffic,
  };
}

/** "You're number two, traffic to follow is United seven three seven on short final." */
export function sequencePhrase(seq: Sequence): string {
  if (seq.number <= 1 || !seq.ahead) return '';
  return ` You're ${seq.word}, traffic to follow is ${seq.ahead.spoken} ${seq.ahead.position}.`;
}
