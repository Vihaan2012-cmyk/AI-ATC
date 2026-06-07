// "Explain that" plain-English clarifier. When a pilot asks what an instruction means, re-state the
// LAST instruction in plain English. Deterministic mapping from the structured last instruction.

export interface LastInstruction {
  altitudeFt?: number;
  headingDeg?: number;
  speedKt?: number;
  fix?: string;
  /** A freeform fallback (the raw clause) if we can't structure it. */
  raw?: string;
}

/** Did the pilot ask for a plain-English explanation of the last instruction? */
export function isExplainRequest(text: string): boolean {
  return /\bexplain that\b|what (does|do) (that|you) mean|say again in plain english|\bin plain english\b|i don'?t understand/i.test(text);
}

/** Turn an altitude in feet into plain words: 8000 -> "eight thousand feet", FL240 -> "twenty-four thousand feet". */
function altWords(ft: number): string {
  const thousands = Math.round(ft / 1000);
  return `${thousands} thousand feet`;
}

/** Compose a plain-English restatement of the last instruction. */
export function explainInstruction(last: LastInstruction | null): string {
  if (!last) return 'I have no previous instruction to explain.';
  const parts: string[] = [];
  if (last.altitudeFt != null) parts.push(`I need you to fly at ${altWords(last.altitudeFt)}`);
  if (last.headingDeg != null) parts.push(`turn to point your nose at heading ${String(last.headingDeg).padStart(3, '0')}`);
  if (last.speedKt != null) parts.push(`slow down or speed up to ${last.speedKt} knots`);
  if (last.fix) parts.push(`fly straight toward the ${last.fix} waypoint`);
  if (parts.length === 0) return last.raw ? `In plain terms: ${last.raw}` : 'There is nothing further to explain — you are cleared as filed.';
  return `In plain terms: ${parts.join(', and ')}.`;
}
