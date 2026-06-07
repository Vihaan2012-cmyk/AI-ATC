// Frequency congestion: occasionally a busy controller says "stand by" before getting to you.
// Deterministic — driven by a turn counter and the chatter level (no Math.random, so it's
// test-stable and reproducible). Higher chatter => more frequent "stand by".

export type ChatterLevel = 'off' | 'low' | 'medium' | 'high';

// Every Nth pilot transmission triggers a "stand by", by level. 0 = never.
const EVERY: Record<ChatterLevel, number> = { off: 0, low: 0, medium: 11, high: 6 };

/**
 * Should ATC say "stand by" for this transmission (given a 1-based turn counter)? Deterministic.
 * Never fires for readback turns (caller decides) — this is for fresh requests.
 */
export function isCongested(turnCount: number, level: ChatterLevel): boolean {
  const n = EVERY[level];
  return n > 0 && turnCount > 0 && turnCount % n === 0;
}

/** The brief "stand by" holding phrase. */
export function standbyPhrase(spokenCs: string): string {
  return `${spokenCs}, stand by.`;
}
