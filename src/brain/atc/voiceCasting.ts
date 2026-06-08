// Controller voice casting: deterministically map (controllerKind, region) -> a Piper voice key,
// so Ground / Tower / Approach / Center sound like different people, and regional facilities use
// fitting accents (US -> American English voices, UK -> British, euro -> continental-flavoured EN).
//
// HYBRID rule: this is pure language/presentation layer. It NEVER invents or changes ATC facts —
// it only decides WHICH installed neural voice speaks a given reply. Selection is deterministic:
// the same (kind, region, installed-voice-set) always yields the same voice key, so a controller's
// voice stays stable for the whole flight without any persisted state.
//
// Pairs with:
//   - personality.ts / phraseologyProfile.ts (WHAT is said + regional wording)
//   - app/piper.js (the synth engine; voice "key" here == Piper manifest key, e.g. "en_GB-alan-medium")
//   - widget/atc-widget.html (calls PIPER.synth(text, key) — see wiring notes at bottom)

import type { ControllerKind } from '../types.js';
import type { Region } from './phraseologyProfile.js';

/** A single installed Piper voice, as surfaced by the widget catalog / piper.status(). */
export interface VoiceEntry {
  /** Piper manifest key, e.g. "en_US-amy-medium". This is what piper.synth(text, key) expects. */
  key: string;
  /** Whether the model is downloaded locally. Only installed voices are castable. */
  installed?: boolean;
  /** Optional human label from the catalog (unused for selection; handy for debugging). */
  label?: string;
}

/** Apparent gender bias of a voice slot — used so adjacent positions sound distinct. */
export type VoiceGender = 'm' | 'f' | 'any';

/**
 * Per-(region, role) casting preference. We don't hardcode voice KEYS (the installed set varies
 * per user) — instead we express WHAT we want (language locale + a gender lean) and resolve it
 * against whatever is installed, with a deterministic hash fallback.
 */
export interface CastPreference {
  /**
   * Ordered list of locale prefixes to prefer, most-fitting first, matched case-insensitively
   * against the START of the voice key (e.g. "en_GB", "en_US"). First locale with an installed
   * voice wins; if none match we fall back to any installed voice.
   */
  locales: string[];
  /** Preferred apparent gender for this slot, to spread roles across distinct-sounding voices. */
  gender: VoiceGender;
}

/** The six controller positions, in a stable order (mirrors the engine's ControllerKind). */
export const CONTROLLER_KINDS: readonly ControllerKind[] = [
  'delivery',
  'ground',
  'tower',
  'departure',
  'center',
  'approach',
] as const;

// Regional locale preference, most-fitting first. euro leans GB English (closest installed accent
// to continental ATC English) then falls through to US. Unknown regions default to US ordering.
const REGION_LOCALES: Record<Region, string[]> = {
  us: ['en_US', 'en_CA', 'en_GB'],
  uk: ['en_GB', 'en_US'],
  euro: ['en_GB', 'en_US'],
};

// Per-role gender lean so neighbouring positions on the same field sound like different people.
// (Purely cosmetic; if the preferred gender isn't installed we still pick deterministically.)
const ROLE_GENDER: Record<ControllerKind, VoiceGender> = {
  delivery: 'f',
  ground: 'm',
  tower: 'f',
  departure: 'm',
  center: 'm',
  approach: 'f',
};

// Lightweight gender inference from the Piper voice NAME inside the key (e.g. "en_US-amy-medium").
// This is a best-effort lexical hint only; "any"/unknown voices match any requested gender.
const FEMALE_NAMES = new Set([
  'amy', 'kathleen', 'lessac', 'libritts', 'libritts_r', 'hfc_female', 'jenny',
  'jenny_dioco', 'aru', 'kristin', 'ljspeech', 'semaine',
]);
const MALE_NAMES = new Set([
  'alan', 'ryan', 'joe', 'kusal', 'danny', 'arctic', 'bryce', 'john',
  'norman', 'hfc_male', 'l2arctic',
]);

/** Extract the speaker name token from a Piper key, e.g. "en_GB-alan-medium" -> "alan". */
function voiceName(key: string): string {
  const parts = key.split('-');
  return (parts[1] || '').toLowerCase();
}

/** Best-effort apparent gender of a voice from its key. Returns 'any' when unknown. */
export function voiceGenderOf(key: string): VoiceGender {
  const n = voiceName(key);
  if (FEMALE_NAMES.has(n)) return 'f';
  if (MALE_NAMES.has(n)) return 'm';
  return 'any';
}

/**
 * Deterministic string hash (matches the widget's hashStr so casting is stable across the
 * TS engine and the renderer). Same input -> same non-negative integer.
 */
export function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < (s || '').length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Casting preference for a (kind, region) pair. Pure lookup; no I/O. */
export function castPreferenceFor(kind: ControllerKind, region: Region): CastPreference {
  const locales = REGION_LOCALES[region] ?? REGION_LOCALES.us;
  const gender = ROLE_GENDER[kind] ?? 'any';
  return { locales, gender };
}

/** True when a voice key starts with the given locale prefix (case-insensitive). */
function matchesLocale(key: string, locale: string): boolean {
  return key.toLowerCase().startsWith(locale.toLowerCase());
}

/**
 * Pick a voice key for a controller position + region from the installed voice set.
 *
 * Algorithm (fully deterministic for a fixed installed set):
 *   1. Filter to installed voices. If none, return null (caller falls back to system TTS).
 *   2. Walk the region's locale preference list; for the first locale that has >=1 installed
 *      voice, build that locale's pool. If no locale matches, the pool is ALL installed voices.
 *   3. Within the pool, prefer voices whose inferred gender matches the role's lean; if that
 *      sub-pool is empty, keep the whole locale pool.
 *   4. Sort the chosen pool by key (stable, install-order-independent) and index into it with a
 *      hash of "atc:<region>:<kind>" offset by the role's position, so the six positions spread
 *      across distinct voices and never collapse onto the same one while voices remain.
 *
 * @param kind      Controller position (delivery/ground/tower/departure/center/approach).
 * @param region    Facility region ('us' | 'uk' | 'euro').
 * @param installed The installed Piper voices (from piper.status() / the widget catalog).
 * @returns The chosen Piper voice key, or null if nothing is installed.
 */
export function pickVoiceKey(
  kind: ControllerKind,
  region: Region,
  installed: VoiceEntry[],
): string | null {
  const pool0 = (installed || []).filter((v) => v && v.installed !== false && !!v.key);
  if (pool0.length === 0) return null;

  const pref = castPreferenceFor(kind, region);

  // Step 2: first locale with any installed voice; else all installed.
  let localePool: VoiceEntry[] = pool0;
  for (const loc of pref.locales) {
    const hits = pool0.filter((v) => matchesLocale(v.key, loc));
    if (hits.length > 0) {
      localePool = hits;
      break;
    }
  }

  // Step 3: gender-lean sub-pool, if non-empty.
  let genderPool = localePool;
  if (pref.gender !== 'any') {
    const hits = localePool.filter((v) => voiceGenderOf(v.key) === pref.gender);
    if (hits.length > 0) genderPool = hits;
  }

  // Step 4: stable sort + deterministic, position-spread index.
  const sorted = genderPool.slice().sort((a, b) => a.key.localeCompare(b.key));
  if (sorted.length === 0) return null;
  const roleIndex = Math.max(0, CONTROLLER_KINDS.indexOf(kind));
  const idx = (hashStr(`atc:${region}:${kind}`) + roleIndex) % sorted.length;
  const chosen = sorted[idx];
  return chosen ? chosen.key : null;
}

/**
 * Build the full casting table: every controller position -> a voice key for the given region and
 * installed set. Positions with no installable voice resolve to null. The widget can call this once
 * after a voice catalog refresh and then look up by kind per reply.
 */
export function buildCastMap(
  region: Region,
  installed: VoiceEntry[],
): Record<ControllerKind, string | null> {
  const map = {} as Record<ControllerKind, string | null>;
  for (const kind of CONTROLLER_KINDS) {
    map[kind] = pickVoiceKey(kind, region, installed);
  }
  return map;
}

/**
 * Convenience: resolve the voice key for one reply. Falls back to the first installed voice (then
 * null) when the preferred selection somehow yields nothing — so a reply always has *a* voice if
 * any are installed.
 *
 * @param kind      Controller position for this reply.
 * @param region    Facility region.
 * @param installed Installed Piper voices.
 */
export function voiceForReply(
  kind: ControllerKind,
  region: Region,
  installed: VoiceEntry[],
): string | null {
  const chosen = pickVoiceKey(kind, region, installed);
  if (chosen) return chosen;
  const first = (installed || []).find((v) => v && v.installed !== false && !!v.key);
  return first ? first.key : null;
}
