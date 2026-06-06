// Persistent on-disk cache for SimConnect facility data (one JSON file per ICAO),
// so the brain can run without the sim. Size-capped with LRU eviction + optional TTL.
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, rmSync,
} from 'node:fs';
import { join } from 'node:path';
import type { AirportFacility } from './simClient.js';

interface IndexEntry {
  bytes: number;
  fetchedAt: number; // epoch ms
  lastUsed: number; // epoch ms
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class FacilityCache {
  private entries: Record<string, IndexEntry> = {};

  constructor(
    private dir: string,
    private maxBytes: number,
    private ttlDays: number,
  ) {
    mkdirSync(this.dir, { recursive: true });
    this.loadIndex();
  }

  /** Returns the cached facility (and whether it's past its TTL), or null if absent. */
  get(icao: string): { facility: AirportFacility; stale: boolean } | null {
    const e = this.entries[icao];
    const file = this.filePath(icao);
    if (!e || !existsSync(file)) return null;
    let facility: AirportFacility;
    try {
      facility = JSON.parse(readFileSync(file, 'utf8')) as AirportFacility;
    } catch {
      return null;
    }
    e.lastUsed = Date.now();
    this.saveIndex();
    const stale = this.ttlDays > 0 && Date.now() - e.fetchedAt > this.ttlDays * DAY_MS;
    return { facility, stale };
  }

  put(icao: string, facility: AirportFacility): void {
    const data = JSON.stringify(facility);
    try {
      writeFileSync(this.filePath(icao), data, 'utf8');
    } catch {
      return;
    }
    const now = Date.now();
    this.entries[icao] = { bytes: Buffer.byteLength(data, 'utf8'), fetchedAt: now, lastUsed: now };
    this.enforceCap();
    this.saveIndex();
  }

  stats(): { count: number; bytes: number } {
    return { count: Object.keys(this.entries).length, bytes: this.totalBytes() };
  }

  private totalBytes(): number {
    return Object.values(this.entries).reduce((sum, e) => sum + e.bytes, 0);
  }

  private enforceCap(): void {
    if (this.maxBytes <= 0) return;
    let total = this.totalBytes();
    if (total <= this.maxBytes) return;
    // evict least-recently-used first
    const lru = Object.entries(this.entries).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [icao, e] of lru) {
      if (total <= this.maxBytes) break;
      try { rmSync(this.filePath(icao)); } catch { /* ignore */ }
      delete this.entries[icao];
      total -= e.bytes;
    }
  }

  private filePath(icao: string): string {
    return join(this.dir, `${icao}.json`);
  }

  private indexPath(): string {
    return join(this.dir, '_index.json');
  }

  private loadIndex(): void {
    try {
      if (existsSync(this.indexPath())) {
        this.entries = JSON.parse(readFileSync(this.indexPath(), 'utf8')) as Record<string, IndexEntry>;
      }
    } catch {
      this.entries = {};
    }
  }

  private saveIndex(): void {
    try {
      writeFileSync(this.indexPath(), JSON.stringify(this.entries), 'utf8');
    } catch {
      /* ignore */
    }
  }
}
