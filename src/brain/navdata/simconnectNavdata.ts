// Navdata backed by SimConnect facility data (real frequencies + runways from the sim).
// Synchronous interface served from a pre-loaded cache; populate via loadSimNavdata().
import type { AirportInfo, Frequency, Navdata } from './navdata.js';
import type { AirportFacility, SimClient } from '../sim/simClient.js';
import type { FacilityCache } from '../sim/facilityCache.js';

function pick(freqs: Frequency[], order: string[]): number | null {
  for (const type of order) {
    const hit = freqs.find((f) => f.type.toUpperCase() === type);
    if (hit) return hit.mhz;
  }
  return null;
}

export class SimConnectNavdata implements Navdata {
  readonly kind = 'sim' as const;

  constructor(private cache: Map<string, AirportFacility>) {}

  getFacility(icao: string): AirportFacility | undefined {
    return this.cache.get(icao);
  }

  getAirport(icao: string): AirportInfo | null {
    const a = this.cache.get(icao);
    return a ? { icao, name: a.name } : null;
  }

  getFrequencies(icao: string): Frequency[] {
    const a = this.cache.get(icao);
    return a ? a.frequencies.map((f) => ({ type: f.type, mhz: f.mhz })) : [];
  }

  getRunways(icao: string): string[] {
    const a = this.cache.get(icao);
    if (!a) return [];
    return a.runways.flatMap((r) => [r.primary, r.secondary]).filter(Boolean);
  }

  // Facility frequency type names (not DFD codes): CLEARANCE/GROUND/TOWER/APPROACH/DEPARTURE.
  // NOTE: busy airports publish several of each type (split by sector/arrival direction);
  // we return the first for now. Refine later by runway / arrival fix. Returns null when an
  // airport's sim data omits the type (e.g. VOBL has no Approach/Departure) — callers fall back.
  getDeliveryFrequency(icao: string): number | null {
    return pick(this.getFrequencies(icao), ['CLEARANCE', 'GROUND', 'TOWER']);
  }

  getGroundFrequency(icao: string): number | null {
    return pick(this.getFrequencies(icao), ['GROUND', 'TOWER']);
  }

  getTowerFrequency(icao: string): number | null {
    return pick(this.getFrequencies(icao), ['TOWER']);
  }

  getDepartureFrequency(icao: string): number | null {
    return pick(this.getFrequencies(icao), ['DEPARTURE', 'APPROACH']);
  }

  getApproachFrequency(icao: string): number | null {
    return pick(this.getFrequencies(icao), ['APPROACH', 'DEPARTURE']);
  }
}

/**
 * Pre-load facility data for the given airports, then return a synchronous Navdata.
 * Resolution order per airport: fresh disk cache -> SimConnect fetch (then cache) ->
 * stale disk cache (offline fallback). `sim` may be null to run purely from cache.
 */
export async function loadSimNavdata(
  sim: SimClient | null,
  icaos: string[],
  cache?: FacilityCache,
): Promise<SimConnectNavdata> {
  const map = new Map<string, AirportFacility>();
  for (const icao of icaos) {
    if (!icao || map.has(icao)) continue;
    const cached = cache?.get(icao) ?? null;
    if (cached && !cached.stale) {
      map.set(icao, cached.facility);
      continue;
    }
    if (sim?.connected) {
      try {
        const fac = await sim.fetchAirport(icao);
        cache?.put(icao, fac);
        map.set(icao, fac);
        continue;
      } catch (e) {
        console.error(`navdata(sim): fetch failed for ${icao}: ${(e as Error).message}`);
      }
    }
    if (cached) {
      map.set(icao, cached.facility); // serve stale rather than nothing
    } else {
      console.error(`navdata(sim): no data for ${icao} (sim offline and not cached)`);
    }
  }
  return new SimConnectNavdata(map);
}
