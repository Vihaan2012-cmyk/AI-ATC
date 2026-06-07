// Departure release windows. For clearances at fields without continuous tower coverage, ATC may
// issue a release with a void time: "released for departure, clearance void if not off by <time>,
// if not off advise <facility> by <time+N>". Deterministic — times computed from a passed-in
// nowUtcMinutes (like buildHold), never Date.now(), so it stays test-stable.
import { spokenDigits } from '../util/phraseology.js';

/** Format minutes-since-midnight UTC as a 4-digit Zulu clock string, e.g. 95 -> "0135". */
function zulu(minOfDay: number): string {
  const m = ((minOfDay % 1440) + 1440) % 1440;
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}`;
}

export interface ReleaseContext {
  nowUtcMinutes: number;
  /** Facility to advise if not off (e.g. "Seattle Center"). */
  facility?: string;
  /** Minutes the clearance stays valid before voiding (default 10). */
  windowMin?: number;
}

/** Compose a departure-release clause with a void time. Deterministic. */
export function composeRelease(ctx: ReleaseContext): string {
  const window = ctx.windowMin ?? 10;
  const voidAt = ctx.nowUtcMinutes + window;
  const adviseBy = voidAt + 5;
  const fac = ctx.facility ?? 'Center';
  return `released for departure, clearance void if not off by ${spokenDigits(zulu(voidAt))} Zulu; `
    + `if not off by ${spokenDigits(zulu(voidAt))}, advise ${fac} by ${spokenDigits(zulu(adviseBy))} Zulu of intentions`;
}
