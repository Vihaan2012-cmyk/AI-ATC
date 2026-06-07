// Progressive taxi instructions: step-by-step guidance from one taxiway to the next.
// Pure, deterministic composition; no LLM required for the phraseology.

import { spokenTaxiway } from './groundControl.js';

/** Detect if pilot requested progressive taxi guidance: "progressive taxi", "request progressive", etc. */
export function isProgressiveRequest(text: string): boolean {
  return /\b(?:progressive\s+taxi|request\s+progressive|progressive\s+instructions?)\b/i.test(text);
}

/**
 * Compose step-by-step progressive taxi instructions from a list of taxiway names.
 * @param steps Ordered list of taxiway identifiers (e.g. ["A", "B2", "C"])
 * @param spokenCs Spoken callsign (e.g. "Southwest 1234")
 * @returns Natural ATC phraseology, e.g. "Southwest 1234, progressive taxi: turn left onto Alpha, hold short of Bravo, then continue to Charlie."
 */
export function composeProgressive(steps: string[], spokenCs: string): string {
  if (steps.length === 0) {
    return `${spokenCs}, unable to issue progressive taxi, no route defined.`;
  }

  const clauses: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const current = steps[i]!;
    const next = steps[i + 1];
    const isLast = i === steps.length - 1;

    // Determine turn direction (simplified: even index = left, odd = right, can be overridden by context).
    const turnDir = i % 2 === 0 ? 'left' : 'right';

    if (i === 0) {
      // First step: "turn [left|right] onto Alpha"
      clauses.push(`turn ${turnDir} onto ${spokenTaxiway(current)}`);
    } else if (isLast) {
      // Last step: "then continue to Charlie."
      clauses.push(`then continue to ${spokenTaxiway(current)}`);
    } else {
      // Middle steps: "hold short of Bravo"
      clauses.push(`hold short of ${spokenTaxiway(next!)}`);
      if (i < steps.length - 2) {
        // If there are more steps after, add "then" clause.
        clauses.push(`then turn ${i % 2 === 0 ? 'right' : 'left'} onto ${spokenTaxiway(steps[i + 1]!)}`);
        i++; // Skip the next step since we included it
      }
    }
  }

  return `${spokenCs}, progressive taxi: ${clauses.join(', ')}.`;
}

/**
 * Build a default progressive taxi route from a list of available taxiways.
 * Uses a deterministic seed-based selection to pick a plausible subset.
 * @param allTaxiways List of all available taxiway names at the airport (e.g. ["A", "B", "C", "D", ...])
 * @param seed Seed for deterministic selection (e.g. from flight plan callsign hash)
 * @param stepCount How many steps to include (default 3-4)
 * @returns Ordered list of taxiway steps for use with composeProgressive
 */
export function buildProgressiveRoute(allTaxiways: string[], seed: number, stepCount: number = 4): string[] {
  const usable = allTaxiways.filter((t) => /^[A-Z]{1,2}\d?$/.test(t));
  if (usable.length === 0) return [];

  const steps: string[] = [];
  const taken = new Set<string>();

  for (let i = 0; i < Math.min(stepCount, usable.length); i++) {
    let idx = (seed + i * 7) % usable.length;
    let attempts = 0;
    // Avoid duplicates: if we've seen this taxiway, skip to the next.
    while (taken.has(usable[idx]!) && attempts < usable.length) {
      idx = (idx + 1) % usable.length;
      attempts++;
    }
    if (attempts < usable.length) {
      steps.push(usable[idx]!);
      taken.add(usable[idx]!);
    }
  }

  return steps;
}
