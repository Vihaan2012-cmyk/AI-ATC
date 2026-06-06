// Flight-phase tracker: derive the phase of flight from live sim state.
// Stateful (uses the previous phase to disambiguate ground takeoff vs. landing rollout,
// and taxi-out vs. taxi-in). Thresholds are deliberately simple; tune as needed.

export type FlightPhase =
  | 'parked'
  | 'taxi_out'
  | 'takeoff'
  | 'climb'
  | 'cruise'
  | 'descent'
  | 'approach'
  | 'landing'
  | 'taxi_in'
  | 'unknown';

/** Subset of FlightContext the tracker needs (FlightContext satisfies this). */
export interface PhaseInput {
  onGround: boolean;
  groundSpeedKt: number;
  altitudeAglFt: number;
  verticalSpeedFpm: number;
  parkingBrakeOn: boolean;
}

const TAKEOFF_ROLL_KT = 40; // high ground speed => takeoff roll or landing rollout
const MOVING_KT = 1.5; // above this on the ground => taxiing
const VS_THRESHOLD_FPM = 300; // climb/descent vs. level
const APPROACH_AGL_FT = 3000; // descending below this => approach

// Phases that mean "we have been airborne this flight".
const HAS_FLOWN = new Set<FlightPhase>(['climb', 'cruise', 'descent', 'approach', 'landing', 'takeoff']);

export class FlightPhaseTracker {
  private phase: FlightPhase = 'unknown';

  get current(): FlightPhase {
    return this.phase;
  }

  /** Update with a new sample; returns the (possibly unchanged) current phase. */
  update(s: PhaseInput): FlightPhase {
    this.phase = this.classify(s);
    return this.phase;
  }

  private classify(s: PhaseInput): FlightPhase {
    const prev = this.phase;

    if (s.onGround) {
      if (s.groundSpeedKt >= TAKEOFF_ROLL_KT) {
        // distinguish accelerating for departure vs. decelerating after landing
        return HAS_FLOWN.has(prev) && prev !== 'takeoff' ? 'landing' : 'takeoff';
      }
      if (s.groundSpeedKt >= MOVING_KT) {
        return prev === 'landing' || prev === 'taxi_in' || HAS_FLOWN.has(prev) ? 'taxi_in' : 'taxi_out';
      }
      // essentially stationary
      if (prev === 'landing' || prev === 'taxi_in') return 'taxi_in';
      if (prev === 'takeoff') return 'takeoff'; // momentary stop on the roll
      return 'parked';
    }

    // airborne
    if (s.verticalSpeedFpm > VS_THRESHOLD_FPM) return 'climb';
    if (s.verticalSpeedFpm < -VS_THRESHOLD_FPM) {
      return s.altitudeAglFt < APPROACH_AGL_FT ? 'approach' : 'descent';
    }
    // roughly level
    if (s.altitudeAglFt < APPROACH_AGL_FT && (prev === 'approach' || prev === 'descent')) return 'approach';
    if ((prev === 'takeoff' || prev === 'climb') && s.altitudeAglFt < 1000) return 'climb';
    return 'cruise';
  }
}
