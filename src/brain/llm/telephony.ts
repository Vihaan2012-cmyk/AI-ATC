// Custom callsign telephony learning. Maps an airline ICAO prefix (e.g. "SWA") or a full callsign
// (e.g. "N512SR") to a user-taught spoken form (e.g. "Cactus", "Experimental Five One Two Sierra
// Romeo"). Optional JSON persistence. Deterministic — consulted by spokenFlightCallsign().

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface TelephonyStore {
  /** ICAO airline prefix -> spoken telephony, e.g. { AAL: "American", SWA: "Southwest" }. */
  airlines: Record<string, string>;
  /** Full callsign -> spoken form override, e.g. { N512SR: "Cirrus Five One Two Sierra Romeo" }. */
  callsigns: Record<string, string>;
}

const EMPTY: TelephonyStore = { airlines: {}, callsigns: {} };

export class Telephony {
  private store: TelephonyStore = { airlines: {}, callsigns: {} };
  constructor(private readonly path?: string) {
    if (path) this.load();
  }

  private load(): void {
    try {
      const raw = JSON.parse(readFileSync(this.path!, 'utf8')) as Partial<TelephonyStore>;
      this.store = { airlines: raw.airlines ?? {}, callsigns: raw.callsigns ?? {} };
    } catch {
      this.store = { airlines: {}, callsigns: {} };
    }
  }

  private save(): void {
    if (!this.path) return;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify(this.store, null, 2));
    } catch { /* best-effort */ }
  }

  /** Teach a spoken form for a full callsign (overrides everything else for that callsign). */
  learnCallsign(callsign: string, spoken: string): void {
    this.store.callsigns[callsign.toUpperCase()] = spoken.trim();
    this.save();
  }

  /** Teach a spoken telephony for an airline ICAO prefix. */
  learnAirline(prefix: string, spoken: string): void {
    this.store.airlines[prefix.toUpperCase()] = spoken.trim();
    this.save();
  }

  /** Resolve a learned spoken form for a callsign, or null if none taught. */
  resolve(callsign: string): string | null {
    const cs = callsign.toUpperCase();
    if (this.store.callsigns[cs]) return this.store.callsigns[cs]!;
    const m = cs.match(/^([A-Z]{3})(\d.*)$/); // airline prefix + flight number
    if (m && this.store.airlines[m[1]!]) {
      return `${this.store.airlines[m[1]!]} ${m[2]}`;
    }
    return null;
  }
}

/** Parse a "say my callsign as ..." teach command from pilot text. Returns the spoken form, or null. */
export function parseTeachCallsign(text: string): string | null {
  const m = text.match(/say (?:my )?callsign as (.+)/i);
  return m ? m[1]!.trim().replace(/[.?!]+$/, '') : null;
}

export const EMPTY_TELEPHONY = EMPTY;
