// Pure, deterministic module that extends the base achievement set (achievements.ts)
// with logbook-driven badges: streaks, perfect-readback runs, airport bingo, and
// night / IFR / emergency badges.
//
// Unlike achievements.ts (which works off the pre-aggregated AchievementStats),
// these evaluators need the raw, per-flight logbook entries so they can reason
// about ordering, time-of-day, consecutive runs, and per-flight flags. Everything
// here is a pure function of its inputs — no I/O, no randomness, and no reliance on
// the wall clock (time-of-day is read from the entry's own savedAt timestamp).
//
// The Badge shape is re-used verbatim from achievements.ts so the two badge lists
// concatenate cleanly and render through the same dashboard path.

import type { Badge } from './achievements.js';

export type { Badge };

/**
 * A single, normalized logbook entry as it is persisted by the Electron app
 * (newest-first) and read back by the server. Every field is optional because
 * older entries may predate a given field; evaluators must tolerate gaps.
 */
export interface LogbookEntry {
  /** Filed/ATC callsign, e.g. "SWA1234". */
  callsign?: string;
  /** Origin ICAO. */
  origin?: string;
  /** Destination ICAO. */
  destination?: string;
  /** Overall readback accuracy for the flight, 0..100. */
  readbackAccuracy?: number;
  /** Count of readbacks the pilot got right. */
  readbacksCorrect?: number;
  /** Count of readbacks ATC expected. */
  readbacksExpected?: number;
  /** True if an emergency was declared during the flight. */
  declaredEmergency?: boolean;
  /** Flight rules as saved by the app. */
  flightRules?: 'IFR' | 'VFR' | string;
  /** ISO 8601 timestamp the entry was saved (used to infer local time-of-day). */
  savedAt?: string;
  /** Aircraft ICAO type, e.g. "B738". */
  aircraft?: string;
  /** Cruise altitude in feet. */
  cruiseAltitudeFt?: number;
}

/** Hour-of-day window (local, inclusive of start, exclusive of end) treated as "night". */
const NIGHT_START_HOUR = 20; // 8pm
const NIGHT_END_HOUR = 6; // 6am

/** True when a readback score qualifies as "perfect" (every expected readback correct). */
function isPerfectReadback(e: LogbookEntry): boolean {
  // Prefer the exact correct/expected counts when present (most precise).
  if (typeof e.readbacksExpected === 'number' && e.readbacksExpected > 0) {
    return e.readbacksCorrect === e.readbacksExpected;
  }
  // Fall back to a 100% accuracy reading, but only if there was something to grade
  // (an accuracy of 100 with zero readbacks is vacuous, not a perfect run).
  return e.readbackAccuracy === 100 && (e.readbacksExpected ?? 0) > 0;
}

/** True when the entry's flight rules are IFR (case-insensitive). */
function isIfr(e: LogbookEntry): boolean {
  return typeof e.flightRules === 'string' && e.flightRules.toUpperCase() === 'IFR';
}

/**
 * Infer whether a flight occurred at night from its savedAt timestamp.
 * Uses the host's local time (the same machine the sim runs on), which is the best
 * available proxy without a per-flight time-of-day field. Returns false if there is
 * no parseable timestamp, so the badge can never be falsely awarded.
 */
function isNightEntry(e: LogbookEntry): boolean {
  if (typeof e.savedAt !== 'string') return false;
  const d = new Date(e.savedAt);
  const ms = d.getTime();
  if (Number.isNaN(ms)) return false;
  const hour = d.getHours();
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
}

/**
 * Compute the longest run of consecutive entries (in saved order) that satisfy a
 * predicate. The logbook is stored newest-first; order does not affect the maximum
 * run length, so this works regardless of direction.
 */
function longestRun(entries: LogbookEntry[], pred: (e: LogbookEntry) => boolean): number {
  let best = 0;
  let cur = 0;
  for (const e of entries) {
    if (pred(e)) {
      cur += 1;
      if (cur > best) best = cur;
    } else {
      cur = 0;
    }
  }
  return best;
}

/** Count entries that satisfy a predicate. */
function countWhere(entries: LogbookEntry[], pred: (e: LogbookEntry) => boolean): number {
  let n = 0;
  for (const e of entries) if (pred(e)) n += 1;
  return n;
}

/** Set of distinct airports (origins + destinations) seen across all entries. */
function distinctAirports(entries: LogbookEntry[]): Set<string> {
  const set = new Set<string>();
  for (const e of entries) {
    if (typeof e.origin === 'string' && e.origin) set.add(e.origin.toUpperCase());
    if (typeof e.destination === 'string' && e.destination) set.add(e.destination.toUpperCase());
  }
  return set;
}

/**
 * Compute the additional, logbook-driven achievement badges.
 *
 * @param entries Raw logbook entries (any order; newest-first as persisted is fine).
 * @returns Badge list with the same shape as computeAchievements(), ready to be
 *          concatenated onto the base badges and rendered identically.
 */
export function computeAchievementsPlus(entries: LogbookEntry[]): Badge[] {
  const log = Array.isArray(entries) ? entries : [];

  // --- Streaks ----------------------------------------------------------------
  // "Graded" = a flight that actually had readbacks to evaluate.
  const graded = (e: LogbookEntry) => (e.readbacksExpected ?? 0) > 0;
  // A clean flight: graded, no emergency, and a solid (>=90%) readback score.
  const clean = (e: LogbookEntry) =>
    graded(e) && !e.declaredEmergency && (e.readbackAccuracy ?? 0) >= 90;
  const cleanStreak = longestRun(log, clean);

  // --- Perfect-readback runs --------------------------------------------------
  const perfectStreak = longestRun(log, isPerfectReadback);
  const perfectTotal = countWhere(log, isPerfectReadback);

  // --- Airport bingo ----------------------------------------------------------
  const airports = distinctAirports(log);
  const airportCount = airports.size;

  // --- Per-category counts ----------------------------------------------------
  const nightFlights = countWhere(log, isNightEntry);
  const ifrFlights = countWhere(log, isIfr);
  const emergencyFlights = countWhere(log, (e) => !!e.declaredEmergency);
  // Handled cleanly = declared an emergency yet still kept readbacks sharp.
  const emergencyHandledClean = countWhere(
    log,
    (e) => !!e.declaredEmergency && (e.readbackAccuracy ?? 0) >= 90
  );

  const badges: Badge[] = [
    // ---- Streaks ----
    {
      id: 'clean-streak-3',
      title: 'On a Roll',
      description: 'Fly 3 clean flights in a row (90%+ readback, no emergency)',
      earned: cleanStreak >= 3,
    },
    {
      id: 'clean-streak-10',
      title: 'Unbroken',
      description: 'Fly 10 clean flights in a row (90%+ readback, no emergency)',
      earned: cleanStreak >= 10,
    },

    // ---- Perfect-readback runs ----
    {
      id: 'perfect-readback-1',
      title: 'Flawless',
      description: 'Complete a flight with every readback correct',
      earned: perfectTotal >= 1,
    },
    {
      id: 'perfect-run-5',
      title: 'Word Perfect',
      description: '5 perfect-readback flights in a row',
      earned: perfectStreak >= 5,
    },
    {
      id: 'perfect-total-25',
      title: 'Golden Mic',
      description: 'Log 25 perfect-readback flights in total',
      earned: perfectTotal >= 25,
    },

    // ---- Airport bingo ----
    {
      id: 'bingo-25',
      title: 'Airport Bingo',
      description: 'Visit 25 different airports',
      earned: airportCount >= 25,
    },
    {
      id: 'bingo-50',
      title: 'Frequent Visitor',
      description: 'Visit 50 different airports',
      earned: airportCount >= 50,
    },
    {
      id: 'bingo-100',
      title: 'Atlas',
      description: 'Visit 100 different airports',
      earned: airportCount >= 100,
    },

    // ---- Night badges ----
    {
      id: 'night-owl-1',
      title: 'Night Owl',
      description: 'Complete a flight at night (local time 8pm–6am)',
      earned: nightFlights >= 1,
    },
    {
      id: 'night-owl-10',
      title: 'Moonlighter',
      description: 'Complete 10 night flights',
      earned: nightFlights >= 10,
    },

    // ---- IFR badges ----
    {
      id: 'ifr-rated-1',
      title: 'IFR Rated',
      description: 'Complete a flight under IFR',
      earned: ifrFlights >= 1,
    },
    {
      id: 'ifr-pro-25',
      title: 'In the Soup',
      description: 'Complete 25 IFR flights',
      earned: ifrFlights >= 25,
    },

    // ---- Emergency badges ----
    {
      id: 'emergency-3',
      title: 'Under Pressure',
      description: 'Declare and handle 3 emergencies',
      earned: emergencyFlights >= 3,
    },
    {
      id: 'emergency-cool-head',
      title: 'Cool Head',
      description: 'Handle an emergency while keeping readbacks at 90%+',
      earned: emergencyHandledClean >= 1,
    },
  ];

  return badges;
}

/**
 * Convenience: the full badge set = base badges (from computeAchievements) merged
 * with the logbook-driven badges here. De-duplicates by id (base wins) so the two
 * lists can be passed in without fear of collisions. Pure; safe to call anywhere.
 *
 * @param baseBadges Result of computeAchievements(stats) from achievements.ts.
 * @param entries Raw logbook entries.
 */
export function mergeAchievements(baseBadges: Badge[], entries: LogbookEntry[]): Badge[] {
  const plus = computeAchievementsPlus(entries);
  const seen = new Set<string>(baseBadges.map((b) => b.id));
  const merged = [...baseBadges];
  for (const b of plus) {
    if (!seen.has(b.id)) {
      seen.add(b.id);
      merged.push(b);
    }
  }
  return merged;
}
