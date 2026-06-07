// Lightweight per-session conversational memory. Records the last N pilot requests + the ATC
// responses so the engine can resolve back-references ("same as before", "say again the last one").
// Deterministic store — no LLM required; the language layer can consult it.

export interface MemoryEntry {
  /** Raw pilot transmission text. */
  pilot: string;
  /** What ATC replied (text). */
  atc: string;
  /** Structured bits we extracted, for back-reference resolution. */
  altitudeFt?: number;
  fix?: string;
  speedKt?: number;
  headingDeg?: number;
  /** Coarse kind tag, e.g. 'clearance' | 'enroute' | 'hold' | 'traffic'. */
  kind?: string;
}

export class ConversationMemory {
  private entries: MemoryEntry[] = [];
  constructor(private readonly max = 12) {}

  /** Record one exchange. Oldest entries are dropped past `max`. */
  add(entry: MemoryEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.max) this.entries.shift();
  }

  /** The most recent exchange, or null. */
  last(): MemoryEntry | null {
    return this.entries.length ? this.entries[this.entries.length - 1]! : null;
  }

  /** The most recent entry that carried an assigned altitude (for "make it X instead"). */
  lastWithAltitude(): MemoryEntry | null {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i]!.altitudeFt != null) return this.entries[i]!;
    }
    return null;
  }

  /** The most recent entry that referenced a fix. */
  lastWithFix(): MemoryEntry | null {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i]!.fix) return this.entries[i]!;
    }
    return null;
  }

  /** All entries, oldest first (read-only view). */
  all(): readonly MemoryEntry[] {
    return this.entries;
  }

  clear(): void {
    this.entries = [];
  }
}

/** Does the text reference a prior instruction rather than stating a new one? */
export function isBackReference(text: string): boolean {
  return /\bsame as before\b|\bsame again\b|\bas before\b|\blike before\b|\bthat (fix|altitude|heading)\b/i.test(text);
}
