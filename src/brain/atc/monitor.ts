// Reactive ATC: watches live aircraft state and emits controller callouts when the pilot
// deviates from what's expected — altitude bust, no descent started near the field, high on
// the glidepath, excessive speed, etc. Stateful with cooldowns so it nudges, not nags.
import { spokenAltitude } from '../util/phraseology.js';
import { distanceNm } from '../util/geo.js';
import { trafficAdvisory, type TrafficPicture } from './liveTraffic.js';
import { todDistanceNm, todPhase } from './tod.js';
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
  /** Current flight phase from the tracker (climb/cruise/descent/approach/...). */
  phase?: string;
  /** Active controller kind, for proactive station-appropriate prompts. */
  controller?: string;
  /** ms since the pilot last transmitted (proactive "go ahead" nudges). */
  msSincePilotTx?: number;
  /** Live traffic picture (from SimClient.fetchTraffic + buildTrafficPicture), if available. */
  traffic?: TrafficPicture | null;
}

const COOLDOWN_MS = 60000;       // don't repeat the same callout within a minute
const ALT_BUST_FT = 350;         // tolerance before "verify your altitude"

const TRAFFIC_ALERT_NM = 8;      // call live traffic when a co-altitude conflict is within this

export class ReactiveMonitor {
  private lastFired = new Map<string, number>();
  /** How many distinct altitude busts have been flagged this session (for escalation). */
  private altBusts = 0;
  /** True while currently busted, so we count each excursion once (not every sample). */
  private busted = false;

  constructor(private fp: FlightPlan) {}

  /** Distance to destination in nm from a live sample, if the dest position is known. */
  destDistance(s: FlightContext): number | null {
    if (this.fp.destLat == null || this.fp.destLon == null) return null;
    return distanceNm(s.latitude, s.longitude, this.fp.destLat, this.fp.destLon);
  }

  /**
   * Evaluate one sample. Returns at most one advisory (highest priority), or null.
   * `nowMs` is passed in (the brain has a clock; scripts/tests don't use Date.now()).
   */
  evaluate(s: FlightContext, ctx: MonitorContext, nowMs: number): Advisory | null {
    // Runway incursion: while on the ground and rolling, warn if other ground traffic is very
    // close (likely on/near the same runway). Runs BEFORE the airborne-only early return below.
    if (s.onGround && ctx.traffic && s.groundSpeedKt > 15) {
      const nearGround = ctx.traffic.nearby.find((t) => t.onGround && t.rangeNm <= 0.6);
      if (nearGround) {
        const last = this.lastFired.get('incursion') ?? 0;
        if (nowMs - last >= COOLDOWN_MS) {
          this.lastFired.set('incursion', nowMs);
          return { key: 'incursion', text: 'hold position — traffic on the runway, traffic on the runway.' };
        }
      }
    }
    if (s.onGround) return null;
    const candidates: Advisory[] = [];

    // 1) Altitude bust vs. assignment (only when airborne and assigned something).
    if (ctx.assignedAltitudeFt != null) {
      const diff = s.altitudeFt - ctx.assignedAltitudeFt;
      const isBust = Math.abs(diff) > ALT_BUST_FT && Math.abs(s.verticalSpeedFpm) < 500;
      if (isBust) {
        const dir = diff > 0 ? 'above' : 'below';
        // Count each excursion once (transition into busted state) for deviation escalation.
        if (!this.busted) { this.busted = true; this.altBusts += 1; }
        if (this.altBusts >= 2) {
          // Brasher warning — repeated uncorrected deviation.
          candidates.push({
            key: 'pilot_deviation',
            text: `possible pilot deviation, advise you contact ${this.fp.destination} approach at the number provided; maintain ${spokenAltitude(ctx.assignedAltitudeFt)}.`,
          });
        } else {
          candidates.push({
            key: 'alt_bust',
            text: `check altitude — you're ${Math.round(Math.abs(diff))} feet ${dir} your assigned ${spokenAltitude(ctx.assignedAltitudeFt)}.`,
          });
        }
      } else {
        this.busted = false; // back within tolerance — ready to count the next excursion
      }
    }

    // 1b) Live traffic: a real AI/MP aircraft is close and near our altitude -> issue an advisory.
    // Stable key (per conflicting aircraft) so the 60s cooldown actually throttles it — keying on
    // range/clock would change every tick as the target moves and fire on every sample (= nagging).
    const conflict = ctx.traffic?.primary ?? null;
    if (conflict && conflict.rangeNm <= TRAFFIC_ALERT_NM) {
      const adv = trafficAdvisory(conflict);
      if (adv) {
        const who = (conflict.callsign || conflict.title || 'unknown').replace(/\s+/g, '');
        candidates.push({ key: `traffic_${who}`, text: `${adv}.` });
      }
    }

    // 2) Top-of-descent prompt. Compute TOD distance from cruise (3:1 rule) and prompt as the
    // aircraft nears it, only while still up high and not yet descending.
    if (ctx.destDistNm != null && s.altitudeFt > this.fp.cruiseAltitudeFt - 1000 && s.verticalSpeedFpm > -300) {
      const todNm = todDistanceNm(this.fp.cruiseAltitudeFt, 0);
      const phase = todPhase(ctx.destDistNm, todNm);
      if (phase === 'approaching') {
        candidates.push({
          key: 'tod_approaching',
          text: `${Math.round(ctx.destDistNm - todNm)} miles to top of descent, expect lower shortly.`,
        });
      } else if (phase === 'at_tod') {
        candidates.push({
          key: 'start_descent',
          text: `you're ${Math.round(ctx.destDistNm)} miles from ${this.fp.destination}, begin descent now.`,
        });
      }
    }

    // 3) On approach, high + fast => glidepath/speed nudge.
    if (ctx.arriving && ctx.destDistNm != null && ctx.destDistNm < 15) {
      if (s.altitudeAglFt > 4000) {
        candidates.push({ key: 'high_gp', text: `you're high on the approach — verify you can make a stable descent, or advise.` });
      } else if (s.iasKt > 210) {
        candidates.push({ key: 'fast', text: `reduce speed, you're fast for the approach.` });
      }
    }

    // --- PROACTIVE: the controller initiates, rather than waiting for you ---

    // 4) Airborne & climbing on departure but never checked in -> prompt the handoff/check-in.
    if (ctx.controller === 'departure' && s.altitudeAglFt > 1500 && s.altitudeAglFt < 8000 && s.verticalSpeedFpm > 300) {
      candidates.push({ key: 'proactive_dep', text: `radar contact, identified. Report your assigned altitude.` });
    }

    // 5) Reached cruise -> Center proactively confirms and looks ahead.
    if (ctx.phase === 'cruise' && Math.abs(s.altitudeFt - this.fp.cruiseAltitudeFt) < 600) {
      candidates.push({ key: 'proactive_cruise', text: `level at cruise, maintain ${spokenAltitude(this.fp.cruiseAltitudeFt)}. We'll have lower for you shortly.` });
    }

    // 6) Established inbound (close + descending through ~6000 AGL) -> proactively send to Tower.
    if (ctx.arriving && ctx.destDistNm != null && ctx.destDistNm < 12 && s.altitudeAglFt < 6000 && s.altitudeAglFt > 1200) {
      candidates.push({ key: 'proactive_tower', text: `you're established inbound — contact Tower when ready.` });
    }

    // 7) You've gone silent at a point where ATC expects a call -> a gentle prompt.
    if (ctx.msSincePilotTx != null && ctx.msSincePilotTx > 120000 && !s.onGround) {
      candidates.push({ key: 'proactive_silent', text: `say intentions.` });
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
