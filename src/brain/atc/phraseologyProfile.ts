// Regional phraseology + controller tone — template-driven (no LLM), so it stays fast and
// deterministic. A profile tweaks word choices and sign-offs; tone adjusts verbosity. These are
// applied as light post-processing on the engine's reply text, never changing the facts.

export type Region = 'us' | 'uk' | 'euro';
export type Tone = 'standard' | 'terse' | 'chatty';

export interface PhraseologyProfile {
  region: Region;
  tone: Tone;
}

// Region-specific phrase substitutions (applied case-insensitively, word-boundary safe).
const REGION_SWAPS: Record<Region, Array<[RegExp, string]>> = {
  us: [],
  uk: [
    [/\bline up and wait\b/gi, 'line up'],
    [/\bcleared for takeoff\b/gi, 'cleared for take-off'],
    [/\btraffic pattern\b/gi, 'the circuit'],
    [/\bclosed traffic\b/gi, 'the circuit'],
    [/\bmaintain\b/gi, 'maintain'],
  ],
  euro: [
    [/\bline up and wait\b/gi, 'line up and wait'],
  ],
};

// A region-appropriate sign-off appended to handoff/closing calls.
const SIGNOFF: Record<Region, string> = { us: '', uk: ' Good day.', euro: ' Bye bye.' };

/** Apply a phraseology profile to a reply's text. Facts are untouched; only wording. */
export function applyPhraseology(text: string, p: PhraseologyProfile, isClosing = false): string {
  let out = text;
  for (const [re, rep] of REGION_SWAPS[p.region]) out = out.replace(re, rep);

  if (p.tone === 'terse') {
    // Trim courtesy fluff for a clipped, busy-controller feel.
    out = out
      .replace(/\bwhen ready,?\s*/gi, '')
      .replace(/\bplease\b/gi, '')
      .replace(/\bAdvise[^.]*\.\s*/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  } else if (p.tone === 'chatty' && isClosing && p.region === 'us') {
    out = out.replace(/\.$/, ', have a good flight.');
  }

  if (isClosing && SIGNOFF[p.region] && !/good day|bye bye/i.test(out)) {
    out = out.replace(/\s*$/, '') + SIGNOFF[p.region];
  }
  return out;
}
