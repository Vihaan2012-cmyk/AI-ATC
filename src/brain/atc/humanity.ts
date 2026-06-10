// Humanity layer for the ATC controller — the imperfect, in-the-moment texture a real
// controller has on the radio. A single post-processor, humanize(), runs on the FINAL reply
// text right before it's returned, layering four human touches on top of the deterministic
// phraseology:
//
//   1. Mood & fatigue   — a slow-drifting disposition (fresh/relaxed → tired/terse) that colors
//                          warmth and pleasantries.
//   2. Small talk       — occasional human asides ("nice day up there", "how's the ride"),
//                          gated by workload + mood so it never interrupts busy frequencies.
//   3. Imperfections    — fillers ("uh, standby"), a weary note on a repeated say-again, the
//                          very occasional self-correction — the things that make it sound live.
//   4. Empathy & rapport— reacts to the pilot: encouragement after a clean run, patience with a
//                          struggling student, extra care in an emergency, light familiarity once
//                          you've been on frequency a while.
//
// HARD RULE: humanize() is purely ADDITIVE warmth. It must NEVER alter numbers, callsigns,
// runways, frequencies, headings, altitudes, squawks, or any safety-critical clearance content —
// it only prepends/appends soft phrases or tweaks pleasantries. Safety content is opaque to it.

/** The controller's slowly-drifting disposition over a session. */
export type Mood = 'fresh' | 'relaxed' | 'neutral' | 'weary' | 'frazzled';

/** Per-pilot rapport the controller accumulates over the flight. */
export interface Rapport {
  /** How many exchanges this controller has had with this pilot. */
  exchanges: number;
  /** Consecutive clean readbacks (resets on a flub). */
  cleanStreak: number;
  /** How many times the pilot has needed a "say again" / correction recently. */
  struggles: number;
  /** True once an emergency has been declared this session. */
  emergency: boolean;
}

export interface HumanityState {
  mood: Mood;
  /** 0..1 fatigue that climbs slowly over a session; pushes mood toward weary/frazzled. */
  fatigue: number;
  rapport: Rapport;
}

export interface HumanizeContext {
  /** Spoken callsign, e.g. "Cessna five one two sierra romeo". */
  spokenCs: string;
  /** Nearby traffic count (workload). High workload suppresses all flourishes. */
  trafficCount: number;
  /** Is this reply a fresh instruction expecting a readback? (don't clutter those with chatter) */
  expectingReadback: boolean;
  /** Was the pilot's last transmission a correct readback? drives encouragement / streaks. */
  readbackCorrect?: boolean;
  /** Did the pilot just ask for a repeat / get corrected? drives patience + struggle tracking. */
  struggled?: boolean;
  /** Emergency in progress — switches the controller into calm, focused, supportive mode. */
  emergency?: boolean;
  /** Is this the handoff/closing transmission? good place for a warm send-off. */
  closing?: boolean;
}

export function freshState(): HumanityState {
  return { mood: 'fresh', fatigue: 0, rapport: { exchanges: 0, cleanStreak: 0, struggles: 0, emergency: false } };
}

// Deterministic per-turn pseudo-random in [0,1) from a string seed (no Math.random — stable & testable).
function seeded(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}

function moodFromFatigue(fatigue: number, base: Mood): Mood {
  if (fatigue > 0.8) return 'frazzled';
  if (fatigue > 0.55) return 'weary';
  return base;
}

/**
 * Advance the controller's human state by one exchange. Call once per pilot transmission BEFORE
 * humanize(). Fatigue climbs slowly; mood drifts; rapport accumulates. Pure (returns a new state).
 */
export function advanceHumanity(s: HumanityState, ctx: HumanizeContext): HumanityState {
  const fatigue = Math.min(1, s.fatigue + 0.015 + (ctx.trafficCount >= 4 ? 0.02 : 0));
  const r = { ...s.rapport };
  r.exchanges += 1;
  if (ctx.readbackCorrect) r.cleanStreak += 1;
  if (ctx.struggled) { r.cleanStreak = 0; r.struggles += 1; }
  if (ctx.emergency) r.emergency = true;

  // Base mood from workload + rapport, then overlaid by fatigue.
  let base: Mood = 'neutral';
  if (ctx.trafficCount <= 1 && r.struggles === 0 && fatigue < 0.4) base = 'relaxed';
  if (r.exchanges <= 2 && fatigue < 0.2) base = 'fresh';
  const mood = ctx.emergency ? 'neutral' : moodFromFatigue(fatigue, base);
  return { mood, fatigue, rapport: r };
}

// --- Small-talk + imperfection phrase banks (warmth only, never safety content) ---------------

const SMALL_TALK = [
  'nice day up there', 'how\'s the ride', 'smooth sailing up top, looks like', 'enjoy the views',
  'pretty quiet up here today', 'good to have you with us',
];
const FILLERS = ['uh,', 'okay,', 'alright,', 'and,'];
const ENCOURAGEMENT = [
  'nicely flown', 'good job on that', 'textbook', 'that was a clean one', 'well flown',
];
const PATIENCE = [
  'no rush, take your time', 'no problem, happens to everyone', 'we\'ll get it sorted',
  'all good, no hurry',
];
const SENDOFFS = ['have a good one', 'safe flight', 'good day', 'enjoy the rest of your flight'];
const EMERGENCY_REASSURE = [
  'we\'ve got you', 'take your time, we\'re here for you', 'everyone\'s standing by for you',
  'we\'ll work this together',
];

function pick<T>(bank: T[], seed: string): T {
  return bank[Math.floor(seeded(seed) * bank.length) % bank.length]!;
}

/**
 * Apply the human touches to a finished reply. ADDITIVE only — soft phrases are prepended or
 * appended; the original instruction text is preserved verbatim in the middle.
 *
 * @param text   the fully-composed reply (callsign + clearance already in place)
 * @param state  the controller's current human state (from advanceHumanity)
 * @param ctx    this turn's context
 * @param seedKey a stable per-turn seed (e.g. callsign + exchange count) for deterministic variety
 */
export function humanize(text: string, state: HumanityState, ctx: HumanizeContext, seedKey: string): string {
  let out = text;
  const busy = ctx.trafficCount >= 4 || state.mood === 'frazzled';

  // EMERGENCY: calm, focused, supportive. Never jokey; add quiet reassurance, no fillers/banter.
  if (ctx.emergency || state.rapport.emergency) {
    if (!ctx.expectingReadback && seeded(seedKey + 'er') < 0.5) {
      out = `${out.replace(/\.\s*$/, '')}. ${cap(pick(EMERGENCY_REASSURE, seedKey + 'e'))}.`;
    }
    return out;
  }

  // 4) EMPATHY — encouragement after a clean run / streak; patience with a struggling pilot.
  if (ctx.struggled && !busy && seeded(seedKey + 'p') < 0.6) {
    out = `${cap(pick(PATIENCE, seedKey + 'pt'))}. ${out}`;
  } else if (ctx.readbackCorrect && state.rapport.cleanStreak >= 3 && !busy && !ctx.expectingReadback
             && seeded(seedKey + 'enc') < 0.35) {
    out = `${out.replace(/\.\s*$/, '')}, ${pick(ENCOURAGEMENT, seedKey + 'en')}.`;
  }

  // 3) IMPERFECTIONS — an occasional weary/relaxed filler at the very front (not on readback-critical
  //    instructions, not when busy). Frazzled/weary controllers do this more.
  const fillerChance = state.mood === 'frazzled' ? 0.22 : state.mood === 'weary' ? 0.14 : 0.05;
  if (!busy && !ctx.expectingReadback && seeded(seedKey + 'f') < fillerChance) {
    const filler = pick(FILLERS, seedKey + 'fl');
    // Insert after the callsign so it reads "Cessna 12SR, uh, ..." not before the callsign.
    out = out.replace(new RegExp('^(' + escapeRe(ctx.spokenCs) + ',?\\s*)', 'i'), `$1${filler} `);
  }

  // 2) SMALL TALK — only when relaxed/quiet and not expecting a readback. Mood-gated.
  const chatChance = state.mood === 'relaxed' ? 0.18 : state.mood === 'fresh' ? 0.10 : 0.0;
  if (!busy && !ctx.expectingReadback && state.rapport.exchanges >= 2 && seeded(seedKey + 's') < chatChance) {
    out = `${out.replace(/\.\s*$/, '')}. ${cap(pick(SMALL_TALK, seedKey + 'st'))}.`;
  }

  // 1) MOOD on closing — warm send-off when relaxed/fresh; terse controllers skip it.
  if (ctx.closing && !busy && (state.mood === 'relaxed' || state.mood === 'fresh' || state.mood === 'neutral')) {
    if (!/good day|safe flight|have a good/i.test(out) && seeded(seedKey + 'c') < 0.5) {
      out = `${out.replace(/\.\s*$/, '')}, ${pick(SENDOFFS, seedKey + 'so')}.`;
    }
  }

  return out;
}

function cap(s: string): string { return s.length ? s[0]!.toUpperCase() + s.slice(1) : s; }
function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
