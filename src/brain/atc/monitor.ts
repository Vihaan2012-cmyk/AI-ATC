// Reactive ATC: watches live aircraft state and emits controller callouts when the pilot
// deviates from what's expected — altitude bust, no descent started near the field, high on
// the glidepath, excessive speed, etc. Stateful with cooldowns so it nudges, not nags.
import { spokenAltitude } from '../util/phraseology.js';
import type { FlightContext, FlightPlan } from '../types.js';

export interface Advisory {
  /** Spoken callout text (callsign is prepended by the caller). */
  text: string;
  /** A key used for cooldown dedup. */
  key: string;
}

export interface MonitorContext {
  /** Altitude the active controller last assigned (ft), or null. */
  assignedAltitudeFt: number | null;
  /** True once we're in the arrival/approach phase. */
  arriving: boolean;
  /** Great-circle distance to destination (nm), if known. */
  destDistNm: number | null;
}

const COOLDOWN_MS = 60000;       // don't repeat the same callout within a minute
const ALT_BUST_FT = 350;         // tolerance before "verify your altitude"
const DESCENT_TRIGGER_NM = 120;  // within this of dest and still at cruise => "start your descent"

function gcDistNm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 3440.065, t = Math.PI / 180;
  const dLat = (bLat - aLat) * t, dLon = (bLon - aLon) * t;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * t) * Math.cos(bLat * t) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export class ReactiveMonitor {
  private lastFired = new Map<string, number>();

  constructor(private fp: FlightPlan) {}

  /** Distance to destination in nm from a live sample, if the dest position is known. */
  destDistance(s: FlightContext): number | null {
    if (this.fp.destLat == null || this.fp.destLon == null) return null;
    return gcDistNm(s.latitude, s.longitude, this.fp.destLat, this.fp.destLon);
  }

  /**
   * Evaluate one sample. Returns at most one advisory (highest priority), or null.
   * `nowMs` is passed in (the brain has a clock; scripts/tests don't use Date.now()).
   */
  evaluate(s: FlightContext, ctx: MonitorContext, nowMs: number): Advisory | null {
    if (s.onGround) return null;
    const candidates: Advisory[] = [];

    // 1) Altitude bust vs. assignment (only when airborne and assigned something).
    if (ctx.assignedAltitudeFt != null) {
      const diff = s.altitudeFt - ctx.assignedAltitudeFt;
      if (Math.abs(diff) > ALT_BUST_FT && Math.abs(s.verticalSpeedFpm) < 500) {
        const dir = diff > 0 ? 'above' : 'below';
        candidates.push({
          key: 'alt_bust',
          text: `check altitude — you're ${Math.round(Math.abs(diff))} feet ${dir} your assigned ${spokenAltitude(ctx.assignedAltitudeFt)}.`,
        });
      }
    }

    // 2) Near the field at cruise with no descent => prompt descent.
    if (ctx.destDistNm != null && ctx.destDistNm < DESCENT_TRIGGER_NM
        && s.altitudeFt > this.fp.cruiseAltitudeFt - 1000 && s.verticalSpeedFpm > -300) {
      candidates.push({
        key: 'start_descent',
        text: `you're ${Math.round(ctx.destDistNm)} miles from ${this.fp.destination}, recommend you begin your descent.`,
      });
    }

    // 3) On approach, high + fast => glidepath/speed nudge.
    if (ctx.arriving && ctx.destDistNm != null && ctx.destDistNm < 15) {
      if (s.altitudeAglFt > 4000) {
        candidates.push({ key: 'high_gp', text: `you're high on the approach — verify you can make a stable descent, or advise.` });
      } else if (s.iasKt > 210) {
        candidates.push({ key: 'fast', text: `reduce speed, you're fast for the approach.` });
      }
    }

    // Pick the first candidate not in cooldown.
    for (const c of candidates) {
      const last = this.lastFired.get(c.key) ?? 0;
      if (nowMs - last >= COOLDOWN_MS) {
        this.lastFired.set(c.key, nowMs);
        return c;
      }
    }
    return null;
  }
}
