// Winds-aloft and cruise altitude rules — deterministic, no live weather required.
// Implements hemispheric cruise-altitude rule for IFR flights:
// - Eastbound (045-224°): odd thousands (3000, 5000, 7000, ...)
// - Westbound (225-044°): even thousands (4000, 6000, 8000, ...)
// Suggests a sensible cruise altitude from a heading and base altitude.

/**
 * Suggest a cruise altitude based on heading, applying the IFR hemispheric rule.
 * Eastbound (045-224°): odd thousands; Westbound (225-044°): even thousands.
 * @param headingDeg Aircraft heading in degrees true (0..360).
 * @param baseFt Base/desired altitude in feet. Will be rounded to the nearest rule-compliant altitude.
 * @returns Suggested cruise altitude in feet.
 */
export function suggestCruiseAltitude(headingDeg: number, baseFt: number): number {
  // Normalize heading to [0, 360)
  const heading = ((headingDeg % 360) + 360) % 360;

  // Determine hemisphere: eastbound (045-224°) = odd thousands, westbound (225-044°) = even thousands
  const isEastbound = heading >= 45 && heading < 225;

  // Round to nearest 1000-ft increment
  const thousands = Math.round(baseFt / 1000);

  // Adjust to match hemispheric rule
  const remainder = thousands % 2;
  let suggested = thousands * 1000;

  if (isEastbound) {
    // Need odd thousands (1, 3, 5, 7, ...)
    if (remainder === 0) {
      // Even number; adjust ±1000 to get odd
      const up = (thousands + 1) * 1000;
      const down = Math.max(1000, (thousands - 1) * 1000);
      suggested = Math.abs(up - baseFt) < Math.abs(down - baseFt) ? up : down;
    }
  } else {
    // Need even thousands (2, 4, 6, 8, ...)
    if (remainder !== 0) {
      // Odd number; adjust ±1000 to get even
      const up = (thousands + 1) * 1000;
      const down = Math.max(2000, (thousands - 1) * 1000);
      suggested = Math.abs(up - baseFt) < Math.abs(down - baseFt) ? up : down;
    }
  }

  return suggested;
}
