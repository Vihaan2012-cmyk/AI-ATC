// Small great-circle geometry helpers shared across the brain (traffic, monitoring, sequencing).
// Distances in nautical miles, bearings in degrees true (0..360).

const R_NM = 3440.065; // mean earth radius in nautical miles
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Great-circle distance between two lat/lon points, in nautical miles. */
export function distanceNm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = (bLat - aLat) * D2R;
  const dLon = (bLon - aLon) * D2R;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * D2R) * Math.cos(bLat * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial true bearing (degrees, 0..360) FROM point A TO point B. */
export function bearingDeg(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLon = (bLon - aLon) * D2R;
  const y = Math.sin(dLon) * Math.cos(bLat * D2R);
  const x = Math.cos(aLat * D2R) * Math.sin(bLat * D2R)
    - Math.sin(aLat * D2R) * Math.cos(bLat * D2R) * Math.cos(dLon);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

/** Smallest signed difference a - b mapped to (-180, 180]. Positive = a is clockwise of b. */
export function relativeAngle(a: number, b: number): number {
  return ((((a - b) % 360) + 540) % 360) - 180;
}

/** Clock position (1..12) of a target at `targetBearing` as seen from an aircraft on `ownHeading`. */
export function clockPosition(ownHeading: number, targetBearing: number): number {
  const rel = (relativeAngle(targetBearing, ownHeading) + 360) % 360; // 0..360 clockwise from nose
  const hour = Math.round(rel / 30) % 12;
  return hour === 0 ? 12 : hour;
}
