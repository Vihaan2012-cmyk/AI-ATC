// Per-aircraft profile memory. Maps aircraft ICAO codes to user-defined preferences.
// Optional JSON persistence following the telephony.ts pattern.
// Pure/deterministic store consulted by session/reply handlers to customize ATC behavior.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AircraftProfile {
  /** Aircraft ICAO type code (e.g. "B738", "A320"). */
  aircraftIcao: string;
  /** Preferred callsign for this aircraft type (e.g. "N512SR"). Optional; overrides flight plan. */
  callsign?: string;
  /** Spoken telephony for the callsign (e.g. "Experimental Five One Two Sierra Romeo"). */
  telephony?: string;
  /** Preferred voice for synthesis (e.g. "default", "female_calm"). */
  voice?: string;
  /** Enable deep-realism features specifically for this aircraft (e.g. advanced clearances). */
  deepRealism?: boolean;
}

export interface ProfileStoreData {
  /** ICAO type code -> profile. */
  profiles: Record<string, AircraftProfile>;
}

const EMPTY: ProfileStoreData = { profiles: {} };

export class ProfileStore {
  private store: ProfileStoreData = { profiles: {} };

  constructor(private readonly path?: string) {
    if (path) this.load();
  }

  private load(): void {
    try {
      const raw = JSON.parse(readFileSync(this.path!, 'utf8')) as Partial<ProfileStoreData>;
      this.store = { profiles: raw.profiles ?? {} };
    } catch {
      this.store = { profiles: {} };
    }
  }

  private save(): void {
    if (!this.path) return;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify(this.store, null, 2));
    } catch { /* best-effort */ }
  }

  /** Retrieve a profile for an aircraft ICAO code, or undefined if none saved. */
  get(icao: string): AircraftProfile | undefined {
    return this.store.profiles[icao.toUpperCase()];
  }

  /** Save or update a profile for an aircraft ICAO code. */
  set(profile: AircraftProfile): void {
    const key = profile.aircraftIcao.toUpperCase();
    this.store.profiles[key] = profile;
    this.save();
  }

  /** Delete a profile for an aircraft ICAO code. */
  delete(icao: string): void {
    const key = icao.toUpperCase();
    delete this.store.profiles[key];
    this.save();
  }

  /** List all stored profiles. */
  list(): AircraftProfile[] {
    return Object.values(this.store.profiles);
  }

  /** Export all profiles as JSON. */
  export(): ProfileStoreData {
    return JSON.parse(JSON.stringify(this.store));
  }
}

export const EMPTY_PROFILES = EMPTY;
