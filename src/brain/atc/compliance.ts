// Readback compliance: extract the key items from an ATC instruction, then check whether
// the pilot's readback contains them. Used to enforce correct readbacks at a configurable
// strictness. Deterministic — no LLM. Tolerant of digit words ("three thousand") and figures.

import { spokenDigits, spokenAltitude } from '../util/phraseology.js';

export type StrictnessLevel = 'relaxed' | 'normal' | 'strict';

export interface ReadbackItem {
  kind: 'altitude' | 'heading' | 'squawk' | 'runway' | 'frequency' | 'speed';
  /** Canonical numeric/string value the pilot must read back. */
  value: string;
  /** Spoken form, for the "I say again" correction. */
  spoken: string;
}

export interface ComplianceResult {
  ok: boolean;
  missed: ReadbackItem[];
}

const WORD_TO_DIGIT: Record<string, string> = {
  zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', niner: '9',
};

/** Normalize a transmission to a digit string + lowercased words for matching. */
function normalize(text: string): { digits: string; words: string } {
  const lower = text.toLowerCase();
  // Replace number words with digits so "three thousand" -> "3 thousand".
  const wordy = lower.replace(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine|niner)\b/g, (m) => WORD_TO_DIGIT[m] ?? m);
  // "three thousand" -> 3000, "flight level two four zero" handled by caller's value.
  const digits = wordy.replace(/[^0-9]/g, '');
  return { digits, words: wordy };
}

/** Does the readback contain this item? */
function contains(item: ReadbackItem, norm: { digits: string; words: string }): boolean {
  const v = item.value.replace(/\D/g, '');
  if (!v) return true;
  // Altitudes can be read as "3000" or "three thousand" (-> "3 thousand"): accept either.
  if (item.kind === 'altitude') {
    if (norm.digits.includes(v)) return true;
    const thousands = Math.floor(Number(item.value) / 1000);
    if (thousands > 0 && new RegExp(`${thousands}\\s*thousand`).test(norm.words)) return true;
    // flight levels: value like "24000" -> "240"
    if (norm.digits.includes(String(Math.round(Number(item.value) / 100)))) return true;
    return false;
  }
  return norm.digits.includes(v);
}

/** Build the readback items implied by a set of instruction values. */
export function readbackItems(spec: {
  altitudeFt?: number | null;
  headingDeg?: number | null;
  squawk?: string | null;
  runway?: string | null;
  frequencyMhz?: number | null;
  speedKt?: number | null;
}): ReadbackItem[] {
  const items: ReadbackItem[] = [];
  if (spec.altitudeFt != null) items.push({ kind: 'altitude', value: String(spec.altitudeFt), spoken: spokenAltitude(spec.altitudeFt) });
  if (spec.headingDeg != null) items.push({ kind: 'heading', value: String(spec.headingDeg).padStart(3, '0'), spoken: `heading ${spokenDigits(String(spec.headingDeg).padStart(3, '0'))}` });
  if (spec.squawk) items.push({ kind: 'squawk', value: spec.squawk, spoken: `squawk ${spokenDigits(spec.squawk)}` });
  if (spec.runway) items.push({ kind: 'runway', value: spec.runway.replace(/\D/g, ''), spoken: `runway ${spec.runway}` });
  if (spec.frequencyMhz != null) items.push({ kind: 'frequency', value: spec.frequencyMhz.toFixed(3), spoken: `${spec.frequencyMhz.toFixed(3)}` });
  if (spec.speedKt != null) items.push({ kind: 'speed', value: String(spec.speedKt), spoken: `${spec.speedKt} knots` });
  return items;
}

/**
 * Check a readback against required items at a given strictness.
 *  relaxed: never fail (anything is accepted)
 *  normal:  the safety-critical items (altitude, heading, squawk) must be read back
 *  strict:  ALL items must be read back
 */
export function checkReadback(text: string, items: ReadbackItem[], level: StrictnessLevel): ComplianceResult {
  if (level === 'relaxed' || items.length === 0) return { ok: true, missed: [] };
  const norm = normalize(text);
  const required = level === 'strict'
    ? items
    : items.filter((i) => i.kind === 'altitude' || i.kind === 'heading' || i.kind === 'squawk');
  const missed = required.filter((i) => !contains(i, norm));
  return { ok: missed.length === 0, missed };
}

/** Phrase the correction for missed items: "I say again: climb and maintain ..., squawk ...". */
export function correctionPhrase(missed: ReadbackItem[]): string {
  return missed.map((i) => i.spoken).join(', ');
}
