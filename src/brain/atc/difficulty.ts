// Difficulty presets: ONE Casual->Realistic slider that bundles the individual realism knobs
// already present in the engine (readback strictness, deep-realism extras, on-screen hints,
// Brasher pilot-deviation calls, and readback tolerance). Pure & deterministic — this module
// only maps a preset name (or a 0..2 slider index) to a config object; the session/server read
// those fields and drive existing behavior. No facts are invented here.

import type { StrictnessLevel } from './compliance.js';

/** The three difficulty presets, low->high realism. The widget slider maps to these by index. */
export type DifficultyPreset = 'casual' | 'standard' | 'realistic';

/** Ordered low->high so a slider index (0,1,2) maps directly to a preset. */
export const DIFFICULTY_ORDER: readonly DifficultyPreset[] = ['casual', 'standard', 'realistic'] as const;

/**
 * Resolved bundle of knobs a preset turns on/off. These map 1:1 onto knobs the engine already
 * consumes:
 *  - strictness        -> ControllerSession / sub-controllers (compliance.checkReadback level)
 *  - deepRealism       -> CommsDeps.deepRealism + ControllerSession.setDeepRealism
 *  - hints             -> surface wrong-frequency / coaching hints in the widget
 *  - brasher           -> allow ReactiveMonitor pilot-deviation ("possible pilot deviation") calls
 *  - readbackTolerance -> how forgiving readback checking is (mirrors strictness, named for UI)
 */
export interface DifficultyConfig {
  /** Which preset produced this config. */
  preset: DifficultyPreset;
  /** Readback enforcement strictness fed to compliance.checkReadback. */
  strictness: StrictnessLevel;
  /** Deep-realism extras: handbacks, "expect" clearances, amendments, stuck-mic, multi-intent. */
  deepRealism: boolean;
  /** Show coaching/awareness hints (e.g. "you may be on the wrong frequency"). */
  hints: boolean;
  /** Allow Brasher pilot-deviation warnings on repeated uncorrected altitude busts. */
  brasher: boolean;
  /** Readback tolerance label, derived from strictness — exposed for the UI/summary. */
  readbackTolerance: 'lenient' | 'standard' | 'exact';
  /** Short human-readable label for the slider/summary. */
  label: string;
  /** One-line description of the experience for the UI. */
  description: string;
}

/** Map a strictness level to the matching readback-tolerance label. */
function toleranceFor(level: StrictnessLevel): DifficultyConfig['readbackTolerance'] {
  switch (level) {
    case 'relaxed':
      return 'lenient';
    case 'normal':
      return 'standard';
    case 'strict':
      return 'exact';
  }
}

/**
 * The preset table. Each entry fully specifies every bundled knob so there are no hidden
 * defaults — the resolver returns one of these verbatim (with the derived tolerance attached).
 */
const PRESET_KNOBS: Record<DifficultyPreset, {
  strictness: StrictnessLevel;
  deepRealism: boolean;
  hints: boolean;
  brasher: boolean;
  label: string;
  description: string;
}> = {
  casual: {
    strictness: 'relaxed',
    deepRealism: false,
    hints: true,
    brasher: false,
    label: 'Casual',
    description: 'Forgiving readbacks, plain phraseology, helpful hints, no deviation calls.',
  },
  standard: {
    strictness: 'normal',
    deepRealism: false,
    hints: true,
    brasher: false,
    label: 'Standard',
    description: 'Safety-critical readbacks enforced; hints on; relaxed extras.',
  },
  realistic: {
    strictness: 'strict',
    deepRealism: true,
    hints: false,
    brasher: true,
    label: 'Realistic',
    description: 'Full readbacks, deep-realism chatter, no hints, pilot-deviation calls active.',
  },
};

/**
 * Resolve a preset name into the full bundle of knobs.
 * Unknown names fall back to 'standard'.
 */
export function resolveDifficulty(preset: DifficultyPreset): DifficultyConfig {
  const knobs = PRESET_KNOBS[preset] ?? PRESET_KNOBS.standard;
  const chosen = PRESET_KNOBS[preset] ? preset : 'standard';
  return {
    preset: chosen,
    strictness: knobs.strictness,
    deepRealism: knobs.deepRealism,
    hints: knobs.hints,
    brasher: knobs.brasher,
    readbackTolerance: toleranceFor(knobs.strictness),
    label: knobs.label,
    description: knobs.description,
  };
}

/**
 * Resolve a slider value (0..2, low->high realism) into the full bundle of knobs.
 * Values are clamped/rounded to the valid range, so any numeric input is safe.
 */
export function resolveDifficultyFromSlider(value: number): DifficultyConfig {
  const idx = Number.isFinite(value)
    ? Math.min(DIFFICULTY_ORDER.length - 1, Math.max(0, Math.round(value)))
    : 1;
  // idx is clamped into [0, length-1], so this index is always defined.
  return resolveDifficulty(DIFFICULTY_ORDER[idx] ?? 'standard');
}

/** The slider index (0..2) for a given preset — for initializing the UI from a saved preset. */
export function sliderIndexOf(preset: DifficultyPreset): number {
  const idx = DIFFICULTY_ORDER.indexOf(preset);
  return idx >= 0 ? idx : DIFFICULTY_ORDER.indexOf('standard');
}

/** All three resolved presets, low->high — handy for documentation, tests, or a UI legend. */
export const ALL_DIFFICULTY_CONFIGS: readonly DifficultyConfig[] =
  DIFFICULTY_ORDER.map((p) => resolveDifficulty(p));
