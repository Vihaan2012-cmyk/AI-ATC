// Composite navdata: an ordered fallback chain. For each query, the first source that
// has data wins. Lets the user choose where navdata comes from (MSFS default via
// SimConnect, a Navigraph/aircraft DFD, or the built-in mock) with graceful fallback.
import { existsSync } from 'node:fs';
import type { AirportInfo, Frequency, Navdata } from './navdata.js';
import { createDfdNavdata, createMockNavdata } from './navdata.js';
import { loadSimNavdata } from './simconnectNavdata.js';
import type { SimClient } from '../sim/simClient.js';
import type { FacilityCache } from '../sim/facilityCache.js';

export class CompositeNavdata implements Navdata {
  readonly kind = 'composite' as const;

  constructor(private sources: Navdata[]) {}

  /** The source kinds in order, for logging (e.g. "sim>dfd>mock"). */
  describe(): string {
    return this.sources.map((s) => s.kind).join('>');
  }

  getAirport(icao: string): AirportInfo | null {
    for (const s of this.sources) {
      const a = s.getAirport(icao);
      if (a) return a;
    }
    return null;
  }

  getFrequencies(icao: string): Frequency[] {
    for (const s of this.sources) {
      const f = s.getFrequencies(icao);
      if (f.length > 0) return f;
    }
    return [];
  }

  getRunways(icao: string): string[] {
    for (const s of this.sources) {
      const r = s.getRunways(icao);
      if (r.length > 0) return r;
    }
    return [];
  }

  private first(fn: (s: Navdata) => number | null): number | null {
    for (const s of this.sources) {
      const v = fn(s);
      if (v != null) return v;
    }
    return null;
  }

  getDeliveryFrequency(icao: string): number | null {
    return this.first((s) => s.getDeliveryFrequency(icao));
  }
  getGroundFrequency(icao: string): number | null {
    return this.first((s) => s.getGroundFrequency(icao));
  }
  getTowerFrequency(icao: string): number | null {
    return this.first((s) => s.getTowerFrequency(icao));
  }
  getDepartureFrequency(icao: string): number | null {
    return this.first((s) => s.getDepartureFrequency(icao));
  }
  getApproachFrequency(icao: string): number | null {
    return this.first((s) => s.getApproachFrequency(icao));
  }
}

export interface NavdataChainOptions {
  /** Ordered source names, e.g. ['sim','dfd','mock']. */
  sources: string[];
  /** Connected SimClient for the 'sim' source (null => served from cache only). */
  sim: SimClient | null;
  /** Disk cache for facility data. */
  cache?: FacilityCache;
  /** Airports to pre-load for the 'sim' source. */
  icaos: string[];
  /** Path to a DFD .s3db for the 'dfd' source. */
  dfdPath?: string;
}

/** Build the configured navdata fallback chain. Always yields a usable Navdata. */
export async function createNavdataChain(opts: NavdataChainOptions): Promise<Navdata> {
  const built: Navdata[] = [];
  for (const src of opts.sources) {
    if (src === 'sim') {
      built.push(await loadSimNavdata(opts.sim, opts.icaos, opts.cache));
    } else if (src === 'dfd') {
      if (opts.dfdPath && existsSync(opts.dfdPath)) {
        try {
          built.push(createDfdNavdata(opts.dfdPath));
        } catch (e) {
          console.error(`navdata(dfd): could not open ${opts.dfdPath}: ${(e as Error).message}`);
        }
      }
    } else if (src === 'mock') {
      built.push(createMockNavdata());
    } else {
      console.error(`navdata: unknown source "${src}" (skipped)`);
    }
  }
  if (built.length === 0) built.push(createMockNavdata());
  return built.length === 1 ? built[0]! : new CompositeNavdata(built);
}
