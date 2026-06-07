// Free-flow NLU: extract MULTIPLE enroute requests from one natural transmission.
// e.g. "center, deviate 20 left for weather then direct DUMBA and climb to one zero thousand"
//   -> [{deviate, side:left, degrees:20}, {direct, fix:'DUMBA'}, {climb, altitudeFt:10000}]
//
// Deterministic + regex-based (instant, no LLM). The deterministic engine still owns the facts;
// this only turns messy compound speech into structured requests the engine can answer.
import type { EnrouteRequest } from '../types.js';

const WORD_NUM: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, niner: 9, ten: 10,
};

// Parse an altitude phrase: "one zero thousand", "10000", "flight level two four zero", "FL240".
function parseAltitude(s: string): number | undefined {
  // glued flight level: "FL240"
  const flGlued = s.match(/\bfl\s?(\d{2,3})\b/i);
  if (flGlued && flGlued[1]) return parseInt(flGlued[1], 10) * 100;
  // flight level: grab the run of digit-words/digits after "flight level"/"fl"
  const fl = s.match(/(?:flight level|fl)\s+((?:(?:zero|one|two|three|four|five|six|seven|eight|niner|nine)\s*){2,4}|\d{2,3})/i);
  if (fl && fl[1]) {
    const d = digits(fl[1]);
    if (d.length >= 2) return parseInt(d.slice(0, 3), 10) * 100;
  }
  const thou = s.match(/((?:(?:zero|one|two|three|four|five|six|seven|eight|niner|nine|ten)\s*)+|\d{1,2})\s*thousand/i);
  if (thou) {
    const d = digits(thou[1] ?? '');
    if (d) return parseInt(d, 10) * 1000;
  }
  const bare = s.match(/\b(\d{3,5})\b/);
  if (bare && bare[1]) return parseInt(bare[1], 10);
  return undefined;
}

function digits(s: string): string {
  return s.trim().split(/\s+/).map((w) => (w in WORD_NUM ? String(WORD_NUM[w]) : (/^\d+$/.test(w) ? w : ''))).join('');
}

function parseDegrees(s: string): number | undefined {
  const m = s.match(/(\d{1,3}|[a-z ]+?)\s*degrees?/i) || s.match(/\b(\d{1,3})\b/);
  if (!m) return undefined;
  const n = /^\d+$/.test(m[1]!.trim()) ? parseInt(m[1]!, 10) : parseInt(digits(m[1]!), 10);
  return Number.isFinite(n) && n > 0 && n <= 90 ? n : undefined;
}

/**
 * Extract all enroute requests from a transmission. Splits on conjunctions ("then", "and", ",")
 * so each clause is parsed independently (prevents numbers leaking across clauses), then de-dupes.
 */
export function parseEnrouteRequests(text: string): EnrouteRequest[] {
  const out: EnrouteRequest[] = [];
  const seen = new Set<string>();
  const add = (r: EnrouteRequest) => { const k = JSON.stringify(r); if (!seen.has(k)) { seen.add(k); out.push(r); } };

  // Split into clauses so "deviate 20 left then climb 10 thousand" doesn't mix the numbers.
  // Split on "then"/commas always, but only on "and" when it joins two SEPARATE requests
  // (i.e. "and" is followed by a request verb) — never on the "and maintain" verb glue,
  // which would strand the altitude in a verb-less clause.
  // NB: "maintain" is deliberately excluded — "climb and maintain", "descend and maintain"
  // are verb glue for a single request; splitting there would strand the altitude.
  const REQ_VERB = '(?:deviat\\w*|turn|climb\\w*|descend\\w*|direct|hold\\w*|reduce|slow|increase|speed|request|expedite|higher|lower)';
  const clauses = text.split(
    new RegExp(`\\bthen\\b|,|\\band\\s+(?=${REQ_VERB}\\b)`, 'i'),
  );
  for (const clauseRaw of clauses) {
    const clause = clauseRaw.trim();
    if (!clause) continue;
    const t = ' ' + clause.toLowerCase().replace(/\s+/g, ' ') + ' ';

    // direct to <FIX>  (preserve original case for the fix ident)
    const direct = clause.match(/\bdirect (?:to )?([A-Za-z]{2,5})\b/i);
    if (direct) { const f = (direct[1] ?? '').toUpperCase(); if (f && !['THE', 'TO', 'FOR'].includes(f)) add({ type: 'direct', fix: f }); }

    // hold at/over <FIX>. Exclude "holding short" (a ground-position report, not an enroute hold)
    // and other non-fix words that follow "hold".
    const hold = clause.match(/\bhold(?:ing)? (?:at |over )?([A-Za-z]{2,5})\b/i);
    if (hold) { const f = (hold[1] ?? '').toUpperCase(); if (f && !['THE', 'AT', 'AS', 'SHORT', 'POSITION', 'FOR', 'ON'].includes(f)) add({ type: 'hold_at', fix: f }); }

    // deviate / turn N left|right (for weather)
    if (/\bdeviat/.test(t) || (/\bturn\b/.test(t) && /weather|around|deviat/.test(t))) {
      const side = /right/.test(t) ? 'right' : /left/.test(t) ? 'left' : undefined;
      if (side) add({ type: 'deviate', side, degrees: parseDegrees(t) });
    }

    // climb / higher
    if (/\bclimb\b/.test(t) || /\bhigher\b/.test(t)) {
      const alt = parseAltitude(t);
      if (alt != null) add({ type: 'climb', altitudeFt: alt });
      else if (/\bhigher\b/.test(t)) add({ type: 'higher' });
    }
    // descend / lower
    if (/\bdescen\w+\b/.test(t) || /\blower\b/.test(t)) {
      const alt = parseAltitude(t);
      if (alt != null) add({ type: 'descend', altitudeFt: alt });
      else if (/\blower\b/.test(t)) add({ type: 'lower' });
    }

    // speed: "reduce to 250", "maintain 280 knots", "slow to two five zero". Collapse spoken
    // number-words to digits first so "two five zero knots" matches alongside "250 knots".
    if (/\b(?:reduce|slow|increase|maintain|speed)\b/.test(t) && /\bknots?|\bkts?\b/.test(t)) {
      // Convert spoken digit-words to digits, then glue runs of single digits ("2 5 0" -> "250").
      const td = t
        .replace(/\b(?:zero|one|two|three|four|five|six|seven|eight|niner|nine)\b/g, (w) => String(WORD_NUM[w] ?? ''))
        .replace(/\b\d(?:\s\d\b)+/g, (m) => m.replace(/\s/g, ''))
        .replace(/\s+/g, ' ');
      const spd = td.match(/\b(?:reduce|slow|increase|maintain|speed)\D{0,12}(\d{2,3})\s*(?:knots|kts|kt)?\b/);
      if (spd && spd[1]) { const k = parseInt(spd[1], 10); if (k >= 100 && k <= 400) add({ type: 'speed', speedKt: k }); }
    } else {
      const spd = t.match(/\b(?:reduce|slow|increase|maintain|speed)\D{0,12}(\d{2,3})\s*(?:knots|kts|kt)?\b/);
      if (spd && spd[1]) { const k = parseInt(spd[1], 10); if (k >= 100 && k <= 400) add({ type: 'speed', speedKt: k }); }
    }
  }

  return out;
}
