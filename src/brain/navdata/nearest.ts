// Nearest-airport helper for diversions and flight-following.
// Pure deterministic module using great-circle distance and bearing calculations.

import { distanceNm, bearingDeg } from '../util/geo.js';

/** Airport coordinate record for nearest-airport search. */
export interface AirportRecord {
  icao: string;
  lat: number;
  lon: number;
}

/** Result of nearest-airport lookup: ICAO, distance in nautical miles, and true bearing. */
export interface NearestAirportResult {
  icao: string;
  distNm: number;
  bearingDeg: number;
}

/**
 * Find the nearest airport from a list of airports to a given lat/lon.
 * Returns the closest match with distance and bearing, or null if list is empty.
 * Uses great-circle distance (Haversine) for accuracy.
 *
 * @param lat - Latitude (degrees, -90 to 90)
 * @param lon - Longitude (degrees, -180 to 180)
 * @param airports - Array of airports with icao, lat, lon
 * @returns Nearest airport with distance (nm) and bearing (degrees true), or null
 */
export function nearestAirport(
  lat: number,
  lon: number,
  airports: AirportRecord[]
): NearestAirportResult | null {
  if (airports.length === 0) return null;

  let best: NearestAirportResult | null = null;

  for (const airport of airports) {
    const dist = distanceNm(lat, lon, airport.lat, airport.lon);
    // Update if first airport or closer than previous best
    if (best === null || dist < best.distNm) {
      best = {
        icao: airport.icao,
        distNm: dist,
        bearingDeg: bearingDeg(lat, lon, airport.lat, airport.lon),
      };
    }
  }

  return best;
}

/**
 * Find all airports within a given radius, sorted by distance.
 * Useful for finding suitable alternates or nearby navigation points.
 *
 * @param lat - Latitude (degrees, -90 to 90)
 * @param lon - Longitude (degrees, -180 to 180)
 * @param radiusNm - Search radius in nautical miles
 * @param airports - Array of airports with icao, lat, lon
 * @returns Array of airports within radius, sorted nearest-first
 */
export function airportsWithinRadius(
  lat: number,
  lon: number,
  radiusNm: number,
  airports: AirportRecord[]
): NearestAirportResult[] {
  const results: NearestAirportResult[] = [];

  for (const airport of airports) {
    const dist = distanceNm(lat, lon, airport.lat, airport.lon);
    if (dist <= radiusNm) {
      results.push({
        icao: airport.icao,
        distNm: dist,
        bearingDeg: bearingDeg(lat, lon, airport.lat, airport.lon),
      });
    }
  }

  // Sort by distance, nearest first
  results.sort((a, b) => a.distNm - b.distNm);
  return results;
}
