// Blocked transmission / stuck-mic simulation: occasionally the pilot's transmission is cut off.
// Deterministic — driven by a turn counter and the chatter level (no Math.random, so it's
// test-stable and reproducible). Rarer than congestion; simulates radio interference or PTT issues.

export type BlockLevel = 'off' | 'low' | 'medium' | 'high';

// Every Nth pilot transmission results in a blocked/stuck-mic event, by level. 0 = never.
// Rarer than congestion (which is every 6–11 turns at high/medium); blocked is every 18–25 turns.
const EVERY: Record<BlockLevel, number> = { off: 0, low: 0, medium: 25, high: 18 };

/**
 * Should the pilot's transmission be blocked (stuck-mic / radio interference) for this turn?
 * Deterministic, keyed off 1-based turn counter. Much rarer than congestion.
 * Never fires for readback turns (caller decides) — this is for fresh requests.
 */
export function isBlocked(turnCount: number, level: BlockLevel): boolean {
  const n = EVERY[level];
  return n > 0 && turnCount > 0 && turnCount % n === 0;
}

/**
 * The brief "blocked transmission" response phrase ATC uses to tell the pilot to try again.
 * Includes the "[blocked transmission]" tag to clarify the blockage to the scenario.
 */
export function blockedPhrase(): string {
  return '[blocked transmission] say again.';
}
