// Aircraft type helpers: wake-turbulence category, spoken callsign suffix, and
// reconciliation between the SimBrief OFP aircraft and the actually-loaded sim aircraft.
//
// Why reconciliation matters: the SimBrief fetcher returns your LATEST OFP regardless
// of aircraft. If the OFP is a 777 but you're flying an A320, ATC-relevant facts (wake
// category, the "heavy" suffix) would be wrong. We treat the LOADED SIM AIRCRAFT as
// ground truth for type/wake, and only take route/callsign/dest/altitudes from the OFP.
//
// Note on CEO vs NEO vs sharklets: for ATC, only the ICAO type designator and wake
// category matter. Sharklet vs non-sharklet does NOT change either (both A320, both
// Medium), so it's irrelevant here — we never use SimBrief's fuel/performance numbers.
// CEO (A320) vs NEO (A20N) ARE different ICAO types, so they're distinguished naturally.
import { spokenCallsign } from './phraseology.js';

export type Wake = 'L' | 'M' | 'H' | 'J'; // Light, Medium, Heavy, Super(J)

const SUPER = new Set(['A388', 'A124', 'A225']); // A380, An-124, An-225

const HEAVY = new Set([
  'B741', 'B742', 'B743', 'B744', 'B748', 'B74R', 'B74S',
  'B752', 'B753', // 757 is Heavy for wake purposes (US treats it specially)
  'B762', 'B763', 'B764',
  'B772', 'B773', 'B77L', 'B77W',
  'B788', 'B789', 'B78X',
  'A306', 'A30B', 'A310',
  'A332', 'A333', 'A338', 'A339',
  'A342', 'A343', 'A345', 'A346',
  'A359', 'A35K',
  'MD11', 'DC10', 'IL96', 'C5', 'C17',
]);

const LIGHT = new Set([
  'C150', 'C152', 'C162', 'C172', 'C72R', 'C177', 'C182', 'C206', 'C210',
  'P28A', 'P28R', 'P28T', 'PA18', 'PA32', 'PA44',
  'SR20', 'SR22', 'DA40', 'DA42', 'DA62', 'BE33', 'BE35', 'BE36', 'BE58',
  'TBM7', 'TBM8', 'TBM9', 'PC12', 'M20P', 'AA5',
]);

export function normalizeType(icaoType: string): string {
  return icaoType.trim().toUpperCase();
}

export function wakeCategory(icaoType: string): Wake {
  const t = normalizeType(icaoType);
  if (SUPER.has(t)) return 'J';
  if (HEAVY.has(t)) return 'H';
  if (LIGHT.has(t)) return 'L';
  return 'M'; // default: medium (most airliners/bizjets)
}

/** Spoken suffix appended to a callsign: " heavy", " super", or "". */
export function wakeSuffix(icaoType: string): string {
  switch (wakeCategory(icaoType)) {
    case 'J': return ' super';
    case 'H': return ' heavy';
    default: return '';
  }
}

/** Full spoken callsign including wake suffix, e.g. "Speedbird 287 heavy". */
export function spokenFlightCallsign(fp: {
  callsign: string;
  telephony?: string;
  aircraftIcao: string;
}): string {
  return `${spokenCallsign(fp.callsign, fp.telephony)}${wakeSuffix(fp.aircraftIcao)}`;
}

export type TypeMatchLevel = 'exact' | 'compatible' | 'mismatch';

export interface TypeReconciliation {
  level: TypeMatchLevel;
  /** What ATC should use for type/wake going forward. */
  effectiveType: string;
  message: string;
}

/**
 * Compare the OFP aircraft with the loaded sim aircraft.
 * - exact: same ICAO type (e.g. A320 == A320; any CEO OFP is fine for a CEO).
 * - compatible: same wake category but different type (e.g. A320 vs A20N) -> warn, allow.
 * - mismatch: different wake category (e.g. A320 vs B772) -> use the sim aircraft for type.
 * The route/callsign from the OFP are used regardless (they're not aircraft-dependent).
 */
export function reconcileAircraftType(ofpType: string, simType: string): TypeReconciliation {
  const a = normalizeType(ofpType);
  const b = normalizeType(simType);
  if (!a || !b) {
    return { level: 'compatible', effectiveType: b || a, message: 'aircraft type unknown; skipping check' };
  }
  if (a === b) {
    return { level: 'exact', effectiveType: a, message: `aircraft type matches (${a})` };
  }
  if (wakeCategory(a) === wakeCategory(b)) {
    return {
      level: 'compatible',
      effectiveType: b, // trust the loaded aircraft
      message: `OFP is ${a} but you're flying ${b} (same wake category) — using ${b}`,
    };
  }
  return {
    level: 'mismatch',
    effectiveType: b, // trust the loaded aircraft for type/wake
    message: `OFP aircraft (${a}) differs from loaded aircraft (${b}); using ${b} for type/wake. Consider re-generating the SimBrief OFP for ${b}.`,
  };
}
