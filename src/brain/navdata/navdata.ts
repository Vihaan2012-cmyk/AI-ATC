// Navdata access. Prefers a Navigraph DFD (SQLite); falls back to a small mock
// so the harness runs without a navdata file.
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { config } from '../config.js';

export interface AirportInfo {
  icao: string;
  name: string;
}

export interface Frequency {
  type: string; // DFD communication_type, e.g. CLD, GND, TWR, DEP, APP, ATIS
  mhz: number;
}

export interface Navdata {
  readonly kind: 'dfd' | 'mock' | 'sim' | 'composite';
  getAirport(icao: string): AirportInfo | null;
  getFrequencies(icao: string): Frequency[];
  /** Runway identifiers, e.g. ["16L","34R","16C",...]. */
  getRunways(icao: string): string[];
  getDeliveryFrequency(icao: string): number | null;
  getGroundFrequency(icao: string): number | null;
  getTowerFrequency(icao: string): number | null;
  getDepartureFrequency(icao: string): number | null;
  getApproachFrequency(icao: string): number | null;
}

function pickByType(freqs: Frequency[], order: string[]): number | null {
  for (const type of order) {
    const hit = freqs.find((f) => f.type.toUpperCase() === type);
    if (hit) return hit.mhz;
  }
  return null;
}

class DfdNavdata implements Navdata {
  readonly kind = 'dfd' as const;
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
  }

  getAirport(icao: string): AirportInfo | null {
    try {
      const r = this.db
        .prepare('SELECT airport_identifier AS icao, airport_name AS name FROM tbl_airports WHERE airport_identifier = ?')
        .get(icao) as { icao?: string; name?: string } | undefined;
      return r?.icao ? { icao: r.icao, name: r.name ?? r.icao } : null;
    } catch {
      return null;
    }
  }

  getFrequencies(icao: string): Frequency[] {
    try {
      const rows = this.db
        .prepare('SELECT communication_type AS type, communication_frequency AS mhz FROM tbl_airport_communication WHERE airport_identifier = ?')
        .all(icao) as Array<{ type?: string; mhz?: number }>;
      return rows
        .filter((r) => r.type != null && r.mhz != null)
        .map((r) => ({ type: String(r.type), mhz: Number(r.mhz) }));
    } catch {
      return [];
    }
  }

  getRunways(icao: string): string[] {
    try {
      const rows = this.db
        .prepare('SELECT runway_identifier FROM tbl_runways WHERE airport_identifier = ?')
        .all(icao) as Array<{ runway_identifier?: string }>;
      return rows.map((r) => String(r.runway_identifier ?? '').replace(/^RW/, '')).filter(Boolean);
    } catch {
      return [];
    }
  }

  getDeliveryFrequency(icao: string): number | null {
    return pickByType(this.getFrequencies(icao), ['CLD', 'GND', 'TWR']);
  }

  getGroundFrequency(icao: string): number | null {
    return pickByType(this.getFrequencies(icao), ['GND', 'TWR']);
  }

  getTowerFrequency(icao: string): number | null {
    return pickByType(this.getFrequencies(icao), ['TWR']);
  }

  getDepartureFrequency(icao: string): number | null {
    return pickByType(this.getFrequencies(icao), ['DEP', 'APP']);
  }

  getApproachFrequency(icao: string): number | null {
    return pickByType(this.getFrequencies(icao), ['APP', 'DEP']);
  }
}

// Placeholder frequencies for offline dev only — install real navdata for accuracy.
interface MockEntry { name: string; delivery: number; ground: number; tower: number; departure: number; approach: number; runways: string[]; }
const MOCK: Record<string, MockEntry> = {
  KSEA: { name: 'Seattle Tacoma Intl', delivery: 121.65, ground: 121.7, tower: 119.9, departure: 119.2, approach: 119.2, runways: ['16L', '16C', '16R', '34L', '34C', '34R'] },
  KPDX: { name: 'Portland Intl', delivery: 121.3, ground: 121.9, tower: 118.7, departure: 124.35, approach: 124.35, runways: ['10L', '10R', '28L', '28R'] },
  KSLE: { name: 'Salem Municipal', delivery: 121.7, ground: 121.7, tower: 119.1, departure: 124.55, approach: 124.55, runways: ['13', '31', '16', '34'] },
};

class MockNavdata implements Navdata {
  readonly kind = 'mock' as const;

  getAirport(icao: string): AirportInfo | null {
    const e = MOCK[icao];
    return e ? { icao, name: e.name } : null;
  }

  getFrequencies(icao: string): Frequency[] {
    const e = MOCK[icao];
    if (!e) return [];
    return [
      { type: 'CLD', mhz: e.delivery },
      { type: 'GND', mhz: e.ground },
      { type: 'TWR', mhz: e.tower },
      { type: 'DEP', mhz: e.departure },
      { type: 'APP', mhz: e.approach },
    ];
  }

  getRunways(icao: string): string[] {
    return MOCK[icao]?.runways ?? [];
  }

  getDeliveryFrequency(icao: string): number | null {
    return MOCK[icao]?.delivery ?? null;
  }

  getGroundFrequency(icao: string): number | null {
    return MOCK[icao]?.ground ?? null;
  }

  getTowerFrequency(icao: string): number | null {
    return MOCK[icao]?.tower ?? null;
  }

  getDepartureFrequency(icao: string): number | null {
    return MOCK[icao]?.departure ?? null;
  }

  getApproachFrequency(icao: string): number | null {
    return MOCK[icao]?.approach ?? null;
  }
}

export function createNavdata(): Navdata {
  if (config.navdataPath && existsSync(config.navdataPath)) {
    try {
      return new DfdNavdata(config.navdataPath);
    } catch (e) {
      console.error('navdata: failed to open DFD, using mock:', (e as Error).message);
    }
  }
  return new MockNavdata();
}

export function createMockNavdata(): Navdata {
  return new MockNavdata();
}

/** Open a Navigraph DFD (or aircraft DFD) SQLite at `path`. Throws if it can't open. */
export function createDfdNavdata(path: string): Navdata {
  return new DfdNavdata(path);
}
