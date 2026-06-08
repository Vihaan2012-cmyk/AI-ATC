// Ambient control: the controller talking TO the live AI/MP traffic around the player, and
// sequencing the player WITH that traffic. Unlike chatter.ts (which invents a synthetic fleet on
// the current frequency) this module is grounded ENTIRELY in the live TrafficPicture from
// liveTraffic.ts — every callsign, position, altitude and clock reference describes an aircraft the
// sim actually reports. The deterministic engine owns those facts; the language layer only phrases
// them, and we never invent an aircraft that isn't in the picture.
//
// Two products, both deterministic and rate-limited:
//   1. Background exchanges  — "United 482, descend flight level two four zero",
//                              "Speedbird 9, traffic two o'clock, six miles, opposite direction".
//   2. Player sequencing     — "you're number two, follow the 737 on a four-mile final".
//
// Rate-limiting is driven by a wall-clock timestamp + a rolling counter (like chatter.ts /
// congestion.ts) so output is reproducible in tests and never floods the channel.
import type { FlightContext } from '../types.js';
import type { RelativeTraffic, TrafficPicture } from './liveTraffic.js';
import { spokenCallsign, spokenAltitude, sequenceWord, spokenDigits } from '../util/phraseology.js';

/** How talkative the ambient-control layer is. Mirrors ChatterLevel naming for consistency. */
export type AmbientLevel = 'off' | 'low' | 'medium' | 'high';

/** Minimum seconds between emitted ambient exchanges, per level. 0 = never emit. */
const MIN_GAP_SEC: Record<AmbientLevel, number> = { off: 0, low: 70, medium: 40, high: 22 };

/** A single background controller<->aircraft transmission, grounded in a live aircraft. */
export interface AmbientExchange {
  /** Station label ("Center", "Approach", "Tower") or the AI aircraft's spoken callsign. */
  from: string;
  /** The transmission text. */
  text: string;
  /** Raw callsign of the live aircraft this exchange refers to (for de-dup / UI linking). */
  about: string;
  /** Coarse category, for the widget to tag/colour background traffic vs. the player. */
  kind: 'instruction' | 'advisory' | 'readback' | 'handoff';
}

/** The player's sequence relative to a specific live aircraft ahead. */
export interface AmbientSequence {
  /** 1 = you're first. */
  number: number;
  /** "number two" etc. (empty when number one). */
  word: string;
  /** The live aircraft you're sequenced behind, or null when you're number one. */
  ahead: RelativeTraffic | null;
  /** The full controller phrase, e.g. "you're number two, follow the 737 on a four-mile final". */
  text: string;
}

export interface AmbientControlOptions {
  /** Talkativeness. Defaults to 'low'. */
  level?: AmbientLevel;
  /** Station label to attribute controller instructions to (e.g. "Seattle Center"). */
  controller?: string;
  /**
   * Phase context: 'arrival' sequences the player onto final behind arriving traffic; 'enroute'
   * favours level/heading/traffic instructions; 'ground'/'departure' favour taxi/takeoff calls.
   */
  phase?: 'ground' | 'departure' | 'enroute' | 'arrival';
}

/** Result bundle from composeAmbientControl. */
export interface AmbientControlResult {
  /** Background controller<->AI exchanges to emit this tick (rate-limited; usually 0 or 1). */
  exchanges: AmbientExchange[];
  /** Player sequencing relative to live arrival traffic, if applicable. */
  sequence: AmbientSequence | null;
}

const W = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const CLOCK = ['twelve', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

function pick<T>(arr: T[], n: number): T {
  return arr[((n % arr.length) + arr.length) % arr.length]!;
}

/** Spoken whole-number miles, e.g. 6 -> "six", 12 -> "one two". */
function spokenMiles(n: number): string {
  if (n < 10) return W[n]!;
  return String(n).split('').map((d) => W[Number(d)]).join(' ');
}

/** Clock hour 1..12 -> spoken word. */
function clockSpoken(h: number): string {
  return CLOCK[h] ?? String(h);
}

/**
 * Derive a short, spoken aircraft-type descriptor from a sim model title for "follow the 737"
 * phrasing. The sim's title is a free-form model name (e.g. "Boeing 737-800 Delta",
 * "Airbus A320neo", "Cessna 172"). We pull a compact, controller-style noun. Falls back to a
 * generic "traffic" when nothing recognisable is found — never invents a type.
 */
export function spokenAircraftType(title: string): string {
  const t = (title || '').toLowerCase();
  // Boeing families: prefer the short "7x7" controllers actually say.
  if (/737/.test(t)) return '737';
  if (/747/.test(t)) return '747';
  if (/757/.test(t)) return '757';
  if (/767/.test(t)) return '767';
  if (/777/.test(t)) return '777';
  if (/787|dreamliner/.test(t)) return '787';
  if (/727/.test(t)) return '727';
  if (/707/.test(t) || /boeing/.test(t)) return 'Boeing';
  // Airbus families.
  if (/a3(?:18|19|20|21)|a32[01]neo|a20n|a19n|a21n/.test(t)) return 'Airbus';
  if (/a330|a33[0-9]/.test(t)) return 'A330';
  if (/a340|a34[0-9]/.test(t)) return 'A340';
  if (/a350|a35[0-9]/.test(t)) return 'A350';
  if (/a380|a38[0-9]/.test(t)) return 'A380';
  if (/airbus/.test(t)) return 'Airbus';
  // Regional / GA / bizjet.
  if (/embraer|e1[79][05]|erj|e-?jet/.test(t)) return 'Embraer';
  if (/crj|bombardier|challenger/.test(t)) return 'regional jet';
  if (/dash ?8|q400|dhc/.test(t)) return 'Dash 8';
  if (/atr ?\d/.test(t)) return 'ATR';
  if (/cessna|c1[0-9][0-9]|c2[0-9][0-9]/.test(t)) return 'Cessna';
  if (/piper|cherokee|pa-?\d/.test(t)) return 'Piper';
  if (/cirrus|sr2[02]/.test(t)) return 'Cirrus';
  if (/king ?air|be[0-9]/.test(t)) return 'King Air';
  if (/citation|learjet|gulfstream|falcon|tbm/.test(t)) return 'business jet';
  return 'traffic';
}

/**
 * Round an aircraft's altitude to a tidy assigned level and phrase it. Live AI aircraft drift off
 * exact levels, so a background instruction quantises to the nearest 1,000 ft (or 10 for FLs).
 */
function nearestAssignedAltitude(ft: number): number {
  if (ft <= 0) return 1000;
  if (ft >= 18000) return Math.round(ft / 1000) * 1000; // FLs are already 1000-ft multiples here
  return Math.max(1000, Math.round(ft / 1000) * 1000);
}

/** Coarse "miles, position" descriptor for an arrival aircraft, e.g. "on a four-mile final". */
function arrivalPosition(t: RelativeTraffic): string {
  const miles = Math.max(1, Math.round(t.rangeNm));
  if (t.onGround) return 'on the rollout';
  if (miles <= 2) return 'on short final';
  return `on a ${milesWord(miles)}-mile final`;
}

const ORD_MILES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
function milesWord(n: number): string {
  return ORD_MILES[n] ?? String(n);
}

/**
 * Compose ONE background controller<->AI exchange for a given live aircraft, varied deterministically
 * by `n`. Grounded entirely in the aircraft's reported state — altitude, clock, range. Never invents.
 */
export function composeExchange(t: RelativeTraffic, controller: string, n: number): AmbientExchange {
  const spoken = spokenCallsign(t.callsign);
  const aboutCs = t.callsign;

  // Pool of plausible, fact-grounded exchanges. Each references only data we actually have.
  const options: AmbientExchange[] = [];

  if (!t.onGround) {
    const lvl = spokenAltitude(nearestAssignedAltitude(t.altitudeFt));
    options.push({ from: controller, text: `${spoken}, descend and maintain ${lvl}.`, about: aboutCs, kind: 'instruction' });
    options.push({ from: controller, text: `${spoken}, climb and maintain ${lvl}.`, about: aboutCs, kind: 'instruction' });
    options.push({ from: spoken, text: `${lvl}, ${spoken}.`, about: aboutCs, kind: 'readback' });
    // Traffic call referencing the PLAYER as the other aircraft's traffic (clock is player-relative,
    // so from the AI's perspective we keep it generic but range-accurate).
    const miles = Math.max(1, Math.round(t.rangeNm));
    const unit = miles === 1 ? 'mile' : 'miles';
    options.push({
      from: controller,
      text: `${spoken}, traffic, ${clockSpoken(t.clock)} o'clock, ${spokenMiles(miles)} ${unit}.`,
      about: aboutCs, kind: 'advisory',
    });
    options.push({ from: spoken, text: `Looking for traffic, ${spoken}.`, about: aboutCs, kind: 'readback' });
    // Speed assignment, grounded in the aircraft's reported groundspeed (rounded to nearest 10).
    if (t.groundSpeedKt > 120) {
      const spd = spokenDigits(String(Math.round(t.groundSpeedKt / 10) * 10));
      options.push({ from: controller, text: `${spoken}, maintain ${spd} knots or greater.`, about: aboutCs, kind: 'instruction' });
    }
  } else {
    options.push({ from: controller, text: `${spoken}, continue taxi, give way to traffic ahead.`, about: aboutCs, kind: 'instruction' });
    options.push({ from: controller, text: `${spoken}, hold short of the runway.`, about: aboutCs, kind: 'instruction' });
    options.push({ from: spoken, text: `Holding short, ${spoken}.`, about: aboutCs, kind: 'readback' });
  }

  return pick(options, n);
}

/**
 * Sequence the PLAYER relative to live arrival traffic. The player is "number N" where N-1 is the
 * count of arriving aircraft that are closer to the field than the player (approximated by range
 * to the player + lower altitude / on final). The aircraft immediately ahead is the nearest such
 * arrival. Returns null when there's no arrival traffic to sequence behind (player is number one).
 *
 * `own` and `picture` come straight from the live model; the threshold values are conservative so a
 * lone, distant aircraft doesn't get called as "traffic to follow".
 */
export function composeSequence(picture: TrafficPicture, own: FlightContext): AmbientSequence | null {
  // Candidate arrival traffic: airborne, descending toward / below the player, ahead-ish, and close.
  const arrivals = picture.nearby.filter((t) => {
    if (t.onGround) return false;
    if (t.rangeNm > 12) return false;            // only sequence against nearby traffic
    if (t.relAltFt > 1500) return false;          // must be at/below us (ahead in the descent)
    // Ahead of us: within the forward ~150-degree arc (clock 9..3 through 12).
    const ahead = t.clock <= 3 || t.clock >= 9;
    return ahead;
  });
  if (arrivals.length === 0) return null;

  // Nearest such aircraft is the one we follow; queue depth = how many are ahead of us.
  arrivals.sort((a, b) => a.rangeNm - b.rangeNm);
  const ahead = arrivals[0]!;
  const number = arrivals.length + 1; // everyone ahead + us
  const word = number > 1 ? sequenceWord(number) : '';

  const type = spokenAircraftType(ahead.title);
  const pos = arrivalPosition(ahead);
  const follow = type === 'traffic'
    ? `follow the traffic ${pos}`
    : `follow the ${type} ${pos}`;
  const text = number > 1
    ? `you're ${word}, ${follow}.`
    : `cleared to continue, you're number one.`;

  return { number, word, ahead, text };
}

/**
 * Build a full ambient-control bundle for one tick: a rate-limited background exchange (if the
 * gate is open and there's live airborne traffic) plus player sequencing (always recomputed; cheap).
 * Pure given (picture, own, opts, now, lastEmitMs, counter) — see AmbientControlGenerator for the
 * stateful, time-gated wrapper used by the live loop.
 */
export function composeAmbientControl(
  picture: TrafficPicture,
  own: FlightContext,
  opts: AmbientControlOptions,
  now: number,
  lastEmitMs: number,
  counter: number,
): AmbientControlResult {
  const level = opts.level ?? 'low';
  const controller = opts.controller ?? 'Center';
  const phase = opts.phase ?? 'enroute';

  const sequence = phase === 'arrival' ? composeSequence(picture, own) : null;

  const exchanges: AmbientExchange[] = [];
  const gap = MIN_GAP_SEC[level];
  const gateOpen = gap > 0 && now - lastEmitMs >= gap * 1000;
  if (gateOpen) {
    // Choose a live aircraft to address: the primary conflict if any, else the nearest airborne
    // (or nearest on ground for ground/departure phases). Strictly from the live picture.
    const wantGround = phase === 'ground' || phase === 'departure';
    const candidate =
      picture.primary ??
      picture.nearby.find((t) => (wantGround ? t.onGround : !t.onGround)) ??
      picture.nearby[0] ??
      null;
    if (candidate) exchanges.push(composeExchange(candidate, controller, counter));
  }

  return { exchanges, sequence };
}

/**
 * Stateful, time-gated wrapper. Holds the last-emit timestamp + a rolling counter so the live
 * loop can simply call tick() each time it refreshes the traffic picture. Deterministic: the only
 * external input is wall-clock time (for rate-limiting) — phrase selection varies by the internal
 * counter, never Math.random. Returns the exchanges actually emitted this tick (0 or 1) plus the
 * current player sequence.
 */
export class AmbientControlGenerator {
  private lastEmitMs = 0;
  private counter = 11;

  constructor(private opts: AmbientControlOptions = {}) {}

  /** Update talkativeness / controller label / phase between ticks. */
  configure(opts: Partial<AmbientControlOptions>): void {
    this.opts = { ...this.opts, ...opts };
  }

  get level(): AmbientLevel {
    return this.opts.level ?? 'low';
  }

  get active(): boolean {
    return this.level !== 'off';
  }

  /**
   * Produce ambient control for this tick. `now` defaults to Date.now() but is injectable for tests.
   * When an exchange is emitted, the internal gate + counter advance so the next emission is spaced
   * by at least MIN_GAP_SEC and phrased differently.
   */
  tick(picture: TrafficPicture | null, own: FlightContext, now: number = Date.now()): AmbientControlResult {
    if (!picture || !this.active) return { exchanges: [], sequence: null };
    const res = composeAmbientControl(picture, own, this.opts, now, this.lastEmitMs, this.counter);
    if (res.exchanges.length > 0) {
      this.lastEmitMs = now;
      this.counter += 1;
    }
    return res;
  }

  /** Reset timing/counter (e.g. on a fresh flight). */
  reset(): void {
    this.lastEmitMs = 0;
    this.counter = 11;
  }
}
