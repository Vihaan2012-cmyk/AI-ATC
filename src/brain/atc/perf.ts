// Aircraft performance profiles. Lookup table of climb/descent rates, cruise speeds, and
// weight categories for common ICAO types. Used by clearance, sequencing, and TOD logic.
// Deterministic, pure—no I/O or state.

export type AircraftCategory = 'light' | 'turboprop' | 'jet' | 'heavy';

export interface PerformanceProfile {
  climbFpm: number;      // Typical climb rate in feet per minute
  descentFpm: number;    // Typical descent rate in feet per minute
  cruiseKt: number;      // Typical cruise speed in knots
  category: AircraftCategory;
}

// Lookup table keyed by ICAO type designator. Covers most common civil types.
const PERF_TABLE: Record<string, PerformanceProfile> = {
  // Single-engine piston (light)
  'C172': { climbFpm: 700, descentFpm: 500, cruiseKt: 110, category: 'light' },
  'C182': { climbFpm: 1050, descentFpm: 600, cruiseKt: 140, category: 'light' },
  'PA28': { climbFpm: 750, descentFpm: 550, cruiseKt: 120, category: 'light' },
  'PA32': { climbFpm: 850, descentFpm: 600, cruiseKt: 140, category: 'light' },
  'SR22': { climbFpm: 1200, descentFpm: 650, cruiseKt: 160, category: 'light' },
  'DA40': { climbFpm: 900, descentFpm: 600, cruiseKt: 130, category: 'light' },
  'DA42': { climbFpm: 1100, descentFpm: 650, cruiseKt: 140, category: 'light' },

  // Turboprops (light to medium)
  'PC12': { climbFpm: 1500, descentFpm: 800, cruiseKt: 200, category: 'turboprop' },
  'TBM9': { climbFpm: 1800, descentFpm: 900, cruiseKt: 280, category: 'turboprop' },
  'TBM8': { climbFpm: 1700, descentFpm: 850, cruiseKt: 270, category: 'turboprop' },
  'TBM7': { climbFpm: 1600, descentFpm: 850, cruiseKt: 260, category: 'turboprop' },
  'C208': { climbFpm: 1050, descentFpm: 700, cruiseKt: 160, category: 'turboprop' },
  'BE20': { climbFpm: 2200, descentFpm: 1000, cruiseKt: 330, category: 'turboprop' },
  'LJ35': { climbFpm: 2400, descentFpm: 1100, cruiseKt: 350, category: 'turboprop' },

  // Regional jets and business jets
  'E75L': { climbFpm: 2100, descentFpm: 900, cruiseKt: 450, category: 'jet' },
  'E75S': { climbFpm: 2100, descentFpm: 900, cruiseKt: 450, category: 'jet' },
  'CRJ7': { climbFpm: 2200, descentFpm: 1000, cruiseKt: 460, category: 'jet' },
  'CRJ9': { climbFpm: 2100, descentFpm: 1000, cruiseKt: 460, category: 'jet' },
  'LJ45': { climbFpm: 2600, descentFpm: 1200, cruiseKt: 470, category: 'jet' },
  'C25A': { climbFpm: 2700, descentFpm: 1200, cruiseKt: 460, category: 'jet' },
  'GLF5': { climbFpm: 3000, descentFpm: 1400, cruiseKt: 470, category: 'jet' },
  'FA7X': { climbFpm: 3200, descentFpm: 1500, cruiseKt: 470, category: 'jet' },

  // Single-aisle transport (jet)
  'B738': { climbFpm: 2300, descentFpm: 1200, cruiseKt: 460, category: 'jet' },
  'B739': { climbFpm: 2300, descentFpm: 1200, cruiseKt: 460, category: 'jet' },
  'B73J': { climbFpm: 2300, descentFpm: 1200, cruiseKt: 460, category: 'jet' },
  'B73H': { climbFpm: 2300, descentFpm: 1200, cruiseKt: 460, category: 'jet' },
  'A319': { climbFpm: 2200, descentFpm: 1100, cruiseKt: 460, category: 'jet' },
  'A320': { climbFpm: 2200, descentFpm: 1100, cruiseKt: 460, category: 'jet' },
  'A21N': { climbFpm: 2200, descentFpm: 1100, cruiseKt: 460, category: 'jet' },
  'A20N': { climbFpm: 2200, descentFpm: 1100, cruiseKt: 460, category: 'jet' },
  'A321': { climbFpm: 2100, descentFpm: 1100, cruiseKt: 460, category: 'jet' },
  'A32N': { climbFpm: 2100, descentFpm: 1100, cruiseKt: 460, category: 'jet' },
  'DH4': { climbFpm: 2000, descentFpm: 1000, cruiseKt: 440, category: 'jet' },
  'E170': { climbFpm: 2100, descentFpm: 1000, cruiseKt: 450, category: 'jet' },
  'E190': { climbFpm: 2100, descentFpm: 1000, cruiseKt: 450, category: 'jet' },

  // Wide-body (heavy)
  'B772': { climbFpm: 2000, descentFpm: 1200, cruiseKt: 460, category: 'heavy' },
  'B77W': { climbFpm: 2000, descentFpm: 1200, cruiseKt: 460, category: 'heavy' },
  'B789': { climbFpm: 2500, descentFpm: 1300, cruiseKt: 465, category: 'heavy' },
  'B78X': { climbFpm: 2500, descentFpm: 1300, cruiseKt: 465, category: 'heavy' },
  'B788': { climbFpm: 2500, descentFpm: 1300, cruiseKt: 465, category: 'heavy' },
  'B787': { climbFpm: 2500, descentFpm: 1300, cruiseKt: 465, category: 'heavy' },
  'A330': { climbFpm: 1800, descentFpm: 1100, cruiseKt: 460, category: 'heavy' },
  'A339': { climbFpm: 1800, descentFpm: 1100, cruiseKt: 460, category: 'heavy' },
  'A340': { climbFpm: 1600, descentFpm: 1000, cruiseKt: 460, category: 'heavy' },
  'A342': { climbFpm: 1600, descentFpm: 1000, cruiseKt: 460, category: 'heavy' },
  'A343': { climbFpm: 1600, descentFpm: 1000, cruiseKt: 460, category: 'heavy' },
  'A350': { climbFpm: 2000, descentFpm: 1200, cruiseKt: 465, category: 'heavy' },
  'A359': { climbFpm: 2000, descentFpm: 1200, cruiseKt: 465, category: 'heavy' },
  'A388': { climbFpm: 1750, descentFpm: 1100, cruiseKt: 460, category: 'heavy' },
  'A380': { climbFpm: 1750, descentFpm: 1100, cruiseKt: 460, category: 'heavy' },
  'B747': { climbFpm: 1750, descentFpm: 1100, cruiseKt: 460, category: 'heavy' },
  'B744': { climbFpm: 1750, descentFpm: 1100, cruiseKt: 460, category: 'heavy' },
  'B748': { climbFpm: 1750, descentFpm: 1100, cruiseKt: 460, category: 'heavy' },
  'B74F': { climbFpm: 1750, descentFpm: 1100, cruiseKt: 460, category: 'heavy' },
  'B74D': { climbFpm: 1750, descentFpm: 1100, cruiseKt: 460, category: 'heavy' },
  'B763': { climbFpm: 2000, descentFpm: 1200, cruiseKt: 460, category: 'heavy' },
  'B764': { climbFpm: 2000, descentFpm: 1200, cruiseKt: 460, category: 'heavy' },
  'B76F': { climbFpm: 2000, descentFpm: 1200, cruiseKt: 460, category: 'heavy' },
  'MD11': { climbFpm: 1800, descentFpm: 1100, cruiseKt: 460, category: 'heavy' },
};

// Defaults by category when type is unknown
const CATEGORY_DEFAULTS: Record<AircraftCategory, Omit<PerformanceProfile, 'category'>> = {
  'light': { climbFpm: 800, descentFpm: 550, cruiseKt: 130 },
  'turboprop': { climbFpm: 1400, descentFpm: 800, cruiseKt: 220 },
  'jet': { climbFpm: 2200, descentFpm: 1100, cruiseKt: 460 },
  'heavy': { climbFpm: 1800, descentFpm: 1100, cruiseKt: 460 },
};

/**
 * Infer aircraft category from ICAO type designator.
 * Returns 'jet' as default for unknown types (safer for spacing/clearance).
 */
function inferCategory(icaoType: string): AircraftCategory {
  const upper = icaoType.toUpperCase();

  // Explicit light piston: C1xx, PA2x/3x, SR2x, DA4x, etc.
  if (/^(C17|C18|PA2|PA3|SR2|DA4|DR4)/.test(upper)) return 'light';

  // Turboprops: PC, TBM, C2, B2, LJ3
  if (/^(PC|TBM|C2|BE2|LJ3)/.test(upper)) return 'turboprop';

  // Heavy: B7x, A3x0, A38, MD, B74, B76
  if (/^(B7[46789]|A3[34]|A38|A380|MD|B76)/.test(upper)) return 'heavy';

  // Everything else (regional jets, most singles/turboprops not caught above)
  return 'jet';
}

/**
 * Get performance profile for an aircraft by ICAO type designator.
 * Returns exact profile if in lookup table, otherwise infers category and returns sensible defaults.
 */
export function aircraftPerf(icaoType: string): PerformanceProfile {
  const upper = icaoType.toUpperCase();
  if (PERF_TABLE[upper]) return PERF_TABLE[upper]!;

  const category = inferCategory(upper);
  const defaults = CATEGORY_DEFAULTS[category]!;
  return { ...defaults, category };
}

/**
 * Estimate top-of-descent distance (nm) for an aircraft type flying from cruiseFt
 * down to fieldElevationFt. Uses a 3:1 rule (3 nm per 1000 ft to lose) scaled by
 * the aircraft's descent performance relative to a generic jet, plus 5 nm pad
 * for deceleration and approach setup.
 *
 * Example: a light aircraft at FL250 descending to sea level might need ~75 nm TOD,
 * while a heavy jet would need ~80 nm due to slower descent.
 */
export function todDistanceForType(icaoType: string, cruiseFt: number, fieldElevationFt: number): number {
  const toLose = Math.max(0, cruiseFt - fieldElevationFt);
  if (toLose === 0) return 0;

  const perf = aircraftPerf(icaoType);
  // Heavy jets descend more slowly; light aircraft descend faster (relatively).
  // Scale by ratio to a nominal 1100 fpm jet descent.
  const descentScale = perf.descentFpm / 1100;

  // 3 nm per 1000 ft base, scaled by descent performance, + 5 nm pad.
  return Math.round((toLose / 1000) * 3 * descentScale + 5);
}
